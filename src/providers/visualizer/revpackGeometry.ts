/**
 * RevPack geometry kernel, shared by the JobLine G-Code extension,
 * jobline.ai-CAM and the JobLine.ai shop app (shift-handover-hub).
 *
 * This file is kept byte-for-byte identical in all three repositories,
 * beside its two siblings revpack.ts and revpackCorrelation.ts:
 *   g-code: src/providers/visualizer/revpackGeometry.ts
 *   CAM:    src/core/revpack/revpackGeometry.ts
 *   hub:    src/lib/jobline/revpack/revpackGeometry.ts
 * Same rule as jblMachine.ts: change it in one repository, copy it to the
 * others. Every repository runs the parity test against the shared golden
 * file (revpack-geometry.golden.json), so the extension, CAM and the hub are
 * proven to build and check the same pack identically.
 *
 * It only imports its sibling revpack.ts, uses no Node or DOM APIs, and
 * returns plain typed arrays, so it runs in the VS Code extension host, a
 * browser bundle, Electron and Vitest alike. Renderers (Three.js in the
 * extension and CAM, SVG in the hub) only draw what it returns:
 *
 *   loadStl            STL (ascii/binary) -> triangle soup + bounds
 *   boxSolid           closed box, part coordinates
 *   cylinderSolid      closed cylinder / annulus on the Z (spindle) axis
 *   featureEdges       wireframe: boundary + crease edges of any mesh
 *   toolSolids         cutter + holder from a RevPack tool (gauge length)
 *   zmapStock          in-process stock for 3-axis cuts (Z-map removal)
 *   compareStockToTarget   remaining material vs gouge, per Z-map cell
 *   buildRevPackGeometry   every layer for one pack
 *   geometryDigest     rounded numbers two implementations must agree on
 *
 * Coordinates are always the program's PART (work) coordinates, G-code axes:
 * X right, Y away, Z up / spindle axis. Mapping to a renderer's axes is the
 * renderer's job.
 *
 * STEP targets are read by the extension through OpenCascade (occt-import-js);
 * every pack with a STEP target also carries an STL of the same solid
 * (target.stl), which is what this kernel, CAM and the hub load. Exact
 * Parasolid B-rep is not read (only a bounds envelope).
 */

import { isCylinder, targetStlFile, type RevPack, type RevPackTool, type Vec3 } from './revpack';

export const REVPACK_GEOMETRY_VERSION = '1.1';

export interface GeoBounds { min: Vec3; max: Vec3 }

export interface GeoMesh {
  /** Triangle soup: 9 numbers per triangle. */
  positions: Float32Array;
  /** Line pairs: 6 numbers per edge. The wireframe of this solid. */
  edges: Float32Array;
  triangleCount: number;
  bounds: GeoBounds;
}

const EMPTY: GeoBounds = { min: [0, 0, 0], max: [0, 0, 0] };

export function boundsOf(positions: ArrayLike<number>): GeoBounds {
  if (positions.length < 3) return { min: [...EMPTY.min] as Vec3, max: [...EMPTY.max] as Vec3 };
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

function makeMesh(tris: number[], edges?: number[]): GeoMesh {
  const positions = new Float32Array(tris);
  return {
    positions,
    edges: edges ? new Float32Array(edges) : featureEdges(positions),
    triangleCount: Math.floor(positions.length / 9),
    bounds: boundsOf(positions),
  };
}

// ---------------------------------------------------------------------------
// STL
// ---------------------------------------------------------------------------

function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof Uint8Array) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }
  return data;
}

/**
 * A binary STL is exactly 84 + 50 * triangleCount bytes; the "solid" prefix
 * is not a reliable discriminator because some binary writers put it in the
 * header. Same rule as CAM's stlLoader and the extension's stlMeshLoader.
 */
export function isBinaryStl(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 84) return false;
  const count = new DataView(buffer).getUint32(80, true);
  return 84 + count * 50 === buffer.byteLength;
}

const VERTEX_RE = /vertex\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;

export function loadStl(data: ArrayBuffer | Uint8Array, maxTriangles = 200_000): GeoMesh & { format: 'ascii' | 'binary' } {
  const buffer = toArrayBuffer(data);
  if (isBinaryStl(buffer)) {
    const view = new DataView(buffer);
    const count = Math.min(view.getUint32(80, true), maxTriangles);
    const tris: number[] = new Array(count * 9);
    let out = 0;
    for (let t = 0; t < count; t++) {
      const base = 84 + t * 50 + 12;
      for (let v = 0; v < 3; v++) {
        const o = base + v * 12;
        tris[out++] = view.getFloat32(o, true);
        tris[out++] = view.getFloat32(o + 4, true);
        tris[out++] = view.getFloat32(o + 8, true);
      }
    }
    return { ...makeMesh(tris), format: 'binary' };
  }
  const text = new TextDecoder('utf-8').decode(buffer);
  const values: number[] = [];
  VERTEX_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = VERTEX_RE.exec(text)) !== null && values.length < maxTriangles * 9) {
    values.push(Number.parseFloat(match[1]), Number.parseFloat(match[2]), Number.parseFloat(match[3]));
  }
  const count = Math.floor(values.length / 9);
  return { ...makeMesh(values.slice(0, count * 9)), format: 'ascii' };
}

// ---------------------------------------------------------------------------
// Wireframe
// ---------------------------------------------------------------------------

/**
 * Boundary edges and creases sharper than `creaseDeg`. Vertices are welded on
 * a grid of 1e-6 of the mesh diagonal, so a triangle soup (STL) gives the same
 * wireframe as an indexed solid.
 */
export function featureEdges(positions: Float32Array, creaseDeg = 30): Float32Array {
  const triCount = Math.floor(positions.length / 9);
  if (!triCount) return new Float32Array(0);
  const b = boundsOf(positions);
  const diag = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) || 1;
  const q = diag * 1e-6;
  const ids = new Map<string, number>();
  const verts: number[] = [];
  const vid = (i: number): number => {
    const key = `${Math.round(positions[i] / q)},${Math.round(positions[i + 1] / q)},${Math.round(positions[i + 2] / q)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = verts.length / 3;
      ids.set(key, id);
      verts.push(positions[i], positions[i + 1], positions[i + 2]);
    }
    return id;
  };
  const normals: number[] = [];
  const edgeFaces = new Map<string, number[]>();
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const a = vid(o), bId = vid(o + 3), c = vid(o + 6);
    const ux = positions[o + 3] - positions[o], uy = positions[o + 4] - positions[o + 1], uz = positions[o + 5] - positions[o + 2];
    const vx = positions[o + 6] - positions[o], vy = positions[o + 7] - positions[o + 1], vz = positions[o + 8] - positions[o + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len === 0 || a === bId || bId === c || a === c) { normals.push(0, 0, 0); continue; }
    nx /= len; ny /= len; nz /= len;
    normals.push(nx, ny, nz);
    for (const [p, r] of [[a, bId], [bId, c], [c, a]]) {
      const key = p < r ? `${p}_${r}` : `${r}_${p}`;
      const list = edgeFaces.get(key);
      if (list) list.push(t); else edgeFaces.set(key, [t]);
    }
  }
  const cosLimit = Math.cos((creaseDeg * Math.PI) / 180);
  const out: number[] = [];
  // Sorted keys so every implementation emits edges in the same order.
  for (const key of Array.from(edgeFaces.keys()).sort()) {
    const faces = edgeFaces.get(key)!;
    let keep = faces.length !== 2;
    if (!keep) {
      const [f, g] = faces;
      const dot = normals[f * 3] * normals[g * 3] + normals[f * 3 + 1] * normals[g * 3 + 1] + normals[f * 3 + 2] * normals[g * 3 + 2];
      keep = dot < cosLimit;
    }
    if (!keep) continue;
    const [p, r] = key.split('_').map(Number);
    out.push(verts[p * 3], verts[p * 3 + 1], verts[p * 3 + 2], verts[r * 3], verts[r * 3 + 1], verts[r * 3 + 2]);
  }
  return new Float32Array(out);
}

// ---------------------------------------------------------------------------
// Primitive solids
// ---------------------------------------------------------------------------

function quad(out: number[], a: Vec3, b: Vec3, c: Vec3, d: Vec3): void {
  out.push(...a, ...b, ...c, ...a, ...c, ...d);
}

export function boxSolid(min: Vec3, max: Vec3): GeoMesh {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const t: number[] = [];
  quad(t, [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]); // bottom
  quad(t, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); // top
  quad(t, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); // front
  quad(t, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]); // back
  quad(t, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]); // left
  quad(t, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]); // right
  const e: number[] = [];
  const corners: Vec3[] = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  for (const [p, r] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) {
    e.push(...corners[p], ...corners[r]);
  }
  return makeMesh(t, e);
}

/** Cylinder (or annulus when innerDiameter > 0) about Z, centred on X0 Y0. */
export function cylinderSolid(diameter: number, zMin: number, zMax: number, innerDiameter = 0, segments = 48): GeoMesh {
  const ro = Math.max(diameter / 2, 1e-9);
  const ri = Math.max(0, Math.min(innerDiameter / 2, ro * 0.999));
  const t: number[] = [];
  const e: number[] = [];
  const ring = (r: number, z: number, i: number): Vec3 => {
    const a = (2 * Math.PI * i) / segments;
    return [r * Math.cos(a), r * Math.sin(a), z];
  };
  for (let i = 0; i < segments; i++) {
    const j = i + 1;
    // outer wall
    quad(t, ring(ro, zMin, i), ring(ro, zMin, j), ring(ro, zMax, j), ring(ro, zMax, i));
    if (ri > 0) {
      quad(t, ring(ri, zMin, j), ring(ri, zMin, i), ring(ri, zMax, i), ring(ri, zMax, j));
      quad(t, ring(ri, zMax, i), ring(ro, zMax, i), ring(ro, zMax, j), ring(ri, zMax, j));
      quad(t, ring(ri, zMin, j), ring(ro, zMin, j), ring(ro, zMin, i), ring(ri, zMin, i));
    } else {
      t.push(0, 0, zMax, ...ring(ro, zMax, i), ...ring(ro, zMax, j));
      t.push(0, 0, zMin, ...ring(ro, zMin, j), ...ring(ro, zMin, i));
    }
    for (const r of ri > 0 ? [ro, ri] : [ro]) {
      e.push(...ring(r, zMax, i), ...ring(r, zMax, j), ...ring(r, zMin, i), ...ring(r, zMin, j));
    }
  }
  // Four silhouette generators so the wireframe reads as a cylinder.
  for (let i = 0; i < segments; i += segments / 4) {
    e.push(...ring(ro, zMin, i), ...ring(ro, zMax, i));
  }
  return makeMesh(t, e);
}

/** Cone frustum about Z from (zMin, rMin) to (zMax, rMax), closed. */
function frustumSolid(rBottom: number, rTop: number, zMin: number, zMax: number, segments = 32): GeoMesh {
  const t: number[] = [];
  const e: number[] = [];
  const at = (r: number, z: number, i: number): Vec3 => {
    const a = (2 * Math.PI * i) / segments;
    return [r * Math.cos(a), r * Math.sin(a), z];
  };
  for (let i = 0; i < segments; i++) {
    const j = i + 1;
    if (rBottom > 0) {
      quad(t, at(rBottom, zMin, i), at(rBottom, zMin, j), at(rTop, zMax, j), at(rTop, zMax, i));
      t.push(0, 0, zMin, ...at(rBottom, zMin, j), ...at(rBottom, zMin, i));
    } else {
      t.push(0, 0, zMin, ...at(rTop, zMax, j), ...at(rTop, zMax, i));
    }
    t.push(0, 0, zMax, ...at(rTop, zMax, i), ...at(rTop, zMax, j));
    e.push(...at(rTop, zMax, i), ...at(rTop, zMax, j));
    if (rBottom > 0) e.push(...at(rBottom, zMin, i), ...at(rBottom, zMin, j));
  }
  for (let i = 0; i < segments; i += segments / 4) e.push(...at(rBottom, zMin, i), ...at(rTop, zMax, i));
  return makeMesh(t, e);
}

function mergeMeshes(meshes: GeoMesh[]): GeoMesh {
  const total = meshes.reduce((n, m) => n + m.positions.length, 0);
  const totalEdges = meshes.reduce((n, m) => n + m.edges.length, 0);
  const positions = new Float32Array(total);
  const edges = new Float32Array(totalEdges);
  let p = 0, q = 0;
  for (const m of meshes) { positions.set(m.positions, p); p += m.positions.length; edges.set(m.edges, q); q += m.edges.length; }
  return { positions, edges, triangleCount: positions.length / 9, bounds: boundsOf(positions) };
}

// ---------------------------------------------------------------------------
// Tool and holder
// ---------------------------------------------------------------------------

export interface ToolSolids {
  t: number;
  /** Tip at the origin, axis +Z. */
  cutter: GeoMesh;
  holder?: GeoMesh;
  stickOut: number;
  gaugeLength: number;
  kind: 'mill' | 'drill' | 'chamfer' | 'turning' | 'laser';
}

function toolKind(tool: RevPackTool, machineClass: string): ToolSolids['kind'] {
  if (machineClass === 'laser') return 'laser';
  if (machineClass === 'lathe') return 'turning';
  const type = (tool.type || '').toLowerCase();
  if (/drill|tap|ream/.test(type) && !/spot/.test(type)) return 'drill';
  if (/spot|chamfer|countersink|center/.test(type)) return 'chamfer';
  return 'mill';
}

/**
 * Cutter and holder from a RevPack tool: the cutter's flute and shank run to
 * the stick-out, the holder from there to the gauge line, so the assembly is
 * exactly `gaugeLength` long - the number the correlation checks against.
 */
export function toolSolids(tool: RevPackTool, machineClass: RevPack['machine']['machineClass'], units: 'in' | 'mm'): ToolSolids {
  const kind = toolKind(tool, machineClass);
  const d = Math.max(tool.diameter, 1e-6);
  const r = d / 2;
  if (kind === 'laser') {
    const nozzle = units === 'mm' ? 6 : 0.25;
    return { t: tool.t, kind, stickOut: nozzle * 2, gaugeLength: nozzle * 2, cutter: frustumSolid(Math.max(r, nozzle * 0.1), nozzle, 0, nozzle * 2) };
  }
  if (kind === 'turning') {
    // 80 degree diamond insert, inscribed circle = tool diameter, in the XZ
    // turning plane with its nose at the origin.
    const ic = d;
    const half = (ic / 2) / Math.sin((40 * Math.PI) / 180);
    const thick = ic * 0.37;
    const pts: Array<[number, number]> = [[0, 0], [half * Math.cos(0.698), half * Math.sin(0.698)], [2 * half * Math.cos(0.698), 0], [half * Math.cos(0.698), -half * Math.sin(0.698)]];
    const t: number[] = [];
    const y0 = -thick / 2, y1 = thick / 2;
    // insert lies in X (radial) / Z (axial): map (u, v) -> (x = u, z = v)
    const P = (u: number, v: number, y: number): Vec3 => [u, y, v];
    t.push(...P(...pts[0], y1), ...P(...pts[1], y1), ...P(...pts[2], y1), ...P(...pts[0], y1), ...P(...pts[2], y1), ...P(...pts[3], y1));
    t.push(...P(...pts[0], y0), ...P(...pts[2], y0), ...P(...pts[1], y0), ...P(...pts[0], y0), ...P(...pts[3], y0), ...P(...pts[2], y0));
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      quad(t, P(a[0], a[1], y0), P(b[0], b[1], y0), P(b[0], b[1], y1), P(a[0], a[1], y1));
    }
    return { t: tool.t, kind, stickOut: 2 * half, gaugeLength: tool.gaugeLength, cutter: makeMesh(t) };
  }
  const flute = Math.max(tool.fluteLength ?? d * 3, d * 0.5);
  const stickOut = Math.min(Math.max(flute * 1.5, d * 4), tool.gaugeLength * 0.75);
  const tipLen = kind === 'drill' ? r / Math.tan((59 * Math.PI) / 180) : kind === 'chamfer' ? r : 0;
  const parts: GeoMesh[] = [];
  if (tipLen > 0) parts.push(frustumSolid(0, r, 0, tipLen));
  parts.push(cylinderSolid(d, tipLen, stickOut, 0, 32));
  const cutter = mergeMeshes(parts);
  let holder: GeoMesh | undefined;
  if (tool.gaugeLength > stickOut) {
    const holderD = Math.max(d * 2, units === 'mm' ? 32 : 1.25);
    const nose = Math.min((tool.gaugeLength - stickOut) * 0.35, holderD);
    holder = mergeMeshes([
      frustumSolid(Math.max(d * 0.75, holderD * 0.3), holderD / 2, stickOut, stickOut + nose),
      cylinderSolid(holderD, stickOut + nose, tool.gaugeLength, 0, 32),
    ]);
  }
  return { t: tool.t, kind, cutter, holder, stickOut, gaugeLength: tool.gaugeLength };
}

// ---------------------------------------------------------------------------
// In-process stock (Z-map)
// ---------------------------------------------------------------------------

/** The shape revpackCorrelation's segments already have. */
export interface CutSegmentLike {
  from: Vec3;
  to: Vec3;
  rapid: boolean;
  tool: number | null;
  tilted: boolean;
  /** Tool axis in part coordinates, when known. */
  axis?: Vec3;
}

/** Tilts up to this angle are cut as if vertical (no undercut is possible from above). */
export const ZMAP_MAX_TILT_DEG = 30;

export interface ZMapStock {
  nx: number;
  ny: number;
  x0: number;
  y0: number;
  cell: number;
  zTop: number;
  zBottom: number;
  /** nx*ny heights, row-major (y outer). */
  heights: Float32Array;
  stockVolume: number;
  removedVolume: number;
  /** Feed moves applied / skipped (tilted tool axis, unknown tool, outside stock). */
  applied: number;
  skippedTilted: number;
  /** Tilted moves within ZMAP_MAX_TILT_DEG, cut with the tool axis taken as vertical. */
  approxTilted: number;
  skippedNoTool: number;
  /** Tap moves: a tap cuts the thread form into the tap-drill bore, not a full cylinder. */
  threadMoves: number;
}

/**
 * Material removal for 3-axis cuts: a height field over the stock top. Each
 * feed move lowers every cell under the cutter to the tool's bottom at that
 * point (flat for end/face mills, a cone for drills, spot drills and
 * chamfers). A move tilted up to ZMAP_MAX_TILT_DEG (a TCPC chamfer or
 * swarf pass) is cut with its axis taken as vertical and counted in
 * approxTilted; steeper ones (3+2 side work) are counted, not cut: a Z-map
 * cannot represent undercuts, so they are reported as skipped rather than
 * drawn wrong.
 */
export function zmapStock(
  stock: { min: Vec3; max: Vec3 },
  segments: CutSegmentLike[],
  tools: RevPackTool[],
  machineClass: RevPack['machine']['machineClass'],
  resolution = 96,
): ZMapStock {
  const sx = stock.max[0] - stock.min[0];
  const sy = stock.max[1] - stock.min[1];
  const cell = Math.max(sx, sy) / resolution;
  const nx = Math.max(1, Math.round(sx / cell));
  const ny = Math.max(1, Math.round(sy / cell));
  const zTop = stock.max[2];
  const zBottom = stock.min[2];
  const heights = new Float32Array(nx * ny).fill(zTop);
  const byT = new Map(tools.map(tool => [tool.t, tool]));
  let applied = 0, skippedTilted = 0, approxTilted = 0, skippedNoTool = 0, threadMoves = 0;
  const minAxisZ = Math.cos((ZMAP_MAX_TILT_DEG * Math.PI) / 180);
  for (const seg of segments) {
    if (seg.rapid) continue;
    if (seg.tilted) {
      if (!seg.axis || seg.axis[2] < minAxisZ) { skippedTilted++; continue; }
      approxTilted++;
    }
    const tool = seg.tool == null ? undefined : byT.get(seg.tool);
    if (!tool) { skippedNoTool++; continue; }
    // A tap's diameter is the thread's major diameter; removing a full
    // cylinder of it would show the whole thread depth as cut (and as a gouge
    // against a target modelled at the tap-drill size). The bore is the drill's.
    if (/\btap\b/i.test(tool.type) && !/drill/i.test(tool.type)) { threadMoves++; continue; }
    const kind = toolKind(tool, machineClass);
    const r = tool.diameter / 2;
    const cone = kind === 'drill' ? Math.tan((59 * Math.PI) / 180) : kind === 'chamfer' ? 1 : 0;
    const len = Math.hypot(seg.to[0] - seg.from[0], seg.to[1] - seg.from[1], seg.to[2] - seg.from[2]);
    const steps = Math.max(1, Math.ceil(len / (cell * 0.5)));
    let touched = false;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const px = seg.from[0] + (seg.to[0] - seg.from[0]) * f;
      const py = seg.from[1] + (seg.to[1] - seg.from[1]) * f;
      const pz = seg.from[2] + (seg.to[2] - seg.from[2]) * f;
      if (pz >= zTop) continue;
      const i0 = Math.max(0, Math.floor((px - r - stock.min[0]) / cell));
      const i1 = Math.min(nx - 1, Math.floor((px + r - stock.min[0]) / cell));
      const j0 = Math.max(0, Math.floor((py - r - stock.min[1]) / cell));
      const j1 = Math.min(ny - 1, Math.floor((py + r - stock.min[1]) / cell));
      for (let j = j0; j <= j1; j++) {
        const cy = stock.min[1] + (j + 0.5) * cell;
        for (let i = i0; i <= i1; i++) {
          const cx = stock.min[0] + (i + 0.5) * cell;
          const dist = Math.hypot(cx - px, cy - py);
          if (dist > r) continue;
          const bottom = Math.max(zBottom, pz + (cone ? dist / cone : 0));
          const k = j * nx + i;
          if (bottom < heights[k]) { heights[k] = bottom; touched = true; }
        }
      }
    }
    if (touched) applied++;
  }
  let removed = 0;
  for (let k = 0; k < heights.length; k++) removed += (zTop - heights[k]) * cell * cell;
  return {
    nx, ny, x0: stock.min[0], y0: stock.min[1], cell, zTop, zBottom, heights,
    stockVolume: sx * sy * (zTop - zBottom), removedVolume: removed, applied, skippedTilted, approxTilted, skippedNoTool, threadMoves,
  };
}

/** Closed solid of the Z-map: cell tops, walls where neighbours differ, sides, bottom. */
export function zmapMesh(z: ZMapStock, cellClass?: Uint8Array): GeoMesh & { triClass?: Uint8Array } {
  const t: number[] = [];
  const cls: number[] = [];
  const { nx, ny, x0, y0, cell, zBottom, heights } = z;
  const h = (i: number, j: number): number => (i < 0 || j < 0 || i >= nx || j >= ny) ? zBottom : heights[j * nx + i];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const before = t.length;
      const xa = x0 + i * cell, xb = xa + cell, ya = y0 + j * cell, yb = ya + cell;
      const top = h(i, j);
      quad(t, [xa, ya, top], [xb, ya, top], [xb, yb, top], [xa, yb, top]);
      quad(t, [xa, ya, zBottom], [xa, yb, zBottom], [xb, yb, zBottom], [xb, ya, zBottom]);
      // +X and +Y walls to the neighbour (or the outside); -X/-Y walls only on the border.
      const hx = h(i + 1, j);
      if (hx !== top) quad(t, [xb, ya, Math.min(top, hx)], [xb, yb, Math.min(top, hx)], [xb, yb, Math.max(top, hx)], [xb, ya, Math.max(top, hx)]);
      const hy = h(i, j + 1);
      if (hy !== top) quad(t, [xa, yb, Math.min(top, hy)], [xa, yb, Math.max(top, hy)], [xb, yb, Math.max(top, hy)], [xb, yb, Math.min(top, hy)]);
      if (i === 0) quad(t, [xa, ya, zBottom], [xa, ya, top], [xa, yb, top], [xa, yb, zBottom]);
      if (j === 0) quad(t, [xa, ya, zBottom], [xb, ya, zBottom], [xb, ya, top], [xa, ya, top]);
      if (cellClass) for (let k = before; k < t.length; k += 9) cls.push(cellClass[j * nx + i]);
    }
  }
  const mesh = makeMesh(t);
  return cellClass ? { ...mesh, triClass: new Uint8Array(cls) } : mesh;
}

// ---------------------------------------------------------------------------
// Target vs in-process stock
// ---------------------------------------------------------------------------

/** Per-cell class codes of compareStockToTarget. */
export const CELL_ON_SIZE = 0;
export const CELL_REMAINING = 1;
export const CELL_GOUGE = 2;

export interface TargetComparison {
  /** nx*ny, row-major like the Z-map: CELL_ON_SIZE / CELL_REMAINING / CELL_GOUGE. */
  cellClass: Uint8Array;
  /** Highest target surface per cell (zBottom where the target has a hole or is absent). */
  targetTop: Float32Array;
  tolerance: number;
  onSize: number;
  remaining: number;
  gouge: number;
  /** Largest stock-above-target and stock-below-target heights. */
  maxRemaining: number;
  maxGouge: number;
}

/**
 * Remaining material vs gouge, seen from the spindle (+Z): for every Z-map
 * cell, the in-process stock height against the highest target surface over
 * the cell centre. Stock more than `tolerance` above the target is material
 * still to cut; stock more than `tolerance` below it is a gouge. What a
 * vertical tool cannot see from above (side holes, undercuts) is not judged.
 */
export function compareStockToTarget(z: ZMapStock, target: GeoMesh, tolerance: number): TargetComparison {
  const { nx, ny, x0, y0, cell, zBottom, heights } = z;
  const top = new Float32Array(nx * ny).fill(-Infinity);
  const p = target.positions;
  for (let o = 0; o + 8 < p.length; o += 9) {
    const ax = p[o], ay = p[o + 1], az = p[o + 2];
    const bx = p[o + 3], by = p[o + 4], bz = p[o + 5];
    const cx = p[o + 6], cy = p[o + 7], cz = p[o + 8];
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-12) continue; // vertical wall: no top surface
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / cell - 0.5));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / cell - 0.5));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - y0) / cell - 0.5));
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) - y0) / cell - 0.5));
    for (let j = j0; j <= j1; j++) {
      const py = y0 + (j + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * cell;
        const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
        const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
        const pz = l1 * az + l2 * bz + l3 * cz;
        const k = j * nx + i;
        if (pz > top[k]) top[k] = pz;
      }
    }
  }
  const cellClass = new Uint8Array(nx * ny);
  let onSize = 0, remaining = 0, gouge = 0, maxRemaining = 0, maxGouge = 0;
  for (let k = 0; k < nx * ny; k++) {
    const t = top[k] === -Infinity ? zBottom : Math.max(zBottom, top[k]);
    top[k] = t;
    const d = heights[k] - t;
    if (d > tolerance) { cellClass[k] = CELL_REMAINING; remaining++; if (d > maxRemaining) maxRemaining = d; }
    else if (d < -tolerance) { cellClass[k] = CELL_GOUGE; gouge++; if (-d > maxGouge) maxGouge = -d; }
    else { cellClass[k] = CELL_ON_SIZE; onSize++; }
  }
  return { cellClass, targetTop: top, tolerance, onSize, remaining, gouge, maxRemaining, maxGouge };
}

// ---------------------------------------------------------------------------
// A whole pack
// ---------------------------------------------------------------------------

export interface RevPackGeometry {
  version: string;
  packId: string;
  units: 'in' | 'mm';
  machineClass: RevPack['machine']['machineClass'];
  target?: GeoMesh;
  stock: GeoMesh;
  workholding: Array<{ name: string; mesh: GeoMesh }>;
  tools: ToolSolids[];
  inProcess?: { mesh: GeoMesh & { triClass?: Uint8Array }; zmap: ZMapStock; comparison?: TargetComparison };
}

export interface BuildGeometryOptions {
  /**
   * Bytes of the pack's target STL (target.file for an STL target, target.stl
   * beside a STEP/Parasolid one), read by the caller (fs, fetch, upload).
   */
  targetStl?: ArrayBuffer | Uint8Array;
  /** Remaining-vs-gouge tolerance, program units (default 0.002 in / 0.05 mm). */
  compareTolerance?: number;
  /** revpackCorrelation segments, for the in-process stock. */
  segments?: CutSegmentLike[];
  zmapResolution?: number;
}

export function buildRevPackGeometry(pack: RevPack, options: BuildGeometryOptions = {}): RevPackGeometry {
  const stock = isCylinder(pack.stock)
    ? cylinderSolid(pack.stock.diameter, pack.stock.zMin, pack.stock.zMax, pack.stock.innerDiameter ?? 0)
    : boxSolid(pack.stock.min, pack.stock.max);
  const workholding = pack.workholding.map(shape => ({
    name: shape.name,
    mesh: isCylinder(shape)
      ? cylinderSolid(shape.diameter, shape.zMin, shape.zMax, shape.innerDiameter ?? 0)
      : boxSolid(shape.min, shape.max),
  }));
  const tools = pack.tools.map(tool => toolSolids(tool, pack.machine.machineClass, pack.units));
  const geometry: RevPackGeometry = {
    version: REVPACK_GEOMETRY_VERSION,
    packId: pack.id,
    units: pack.units,
    machineClass: pack.machine.machineClass,
    stock,
    workholding,
    tools,
  };
  if (options.targetStl && targetStlFile(pack)) geometry.target = loadStl(options.targetStl);
  if (options.segments && !isCylinder(pack.stock) && (pack.machine.machineClass === 'mill' || pack.machine.machineClass === 'mill-turn')) {
    const zmap = zmapStock(pack.stock, options.segments, pack.tools, pack.machine.machineClass, options.zmapResolution);
    if (geometry.target) {
      const tolerance = options.compareTolerance ?? (pack.units === 'mm' ? 0.05 : 0.002);
      const comparison = compareStockToTarget(zmap, geometry.target, tolerance);
      geometry.inProcess = { zmap, comparison, mesh: zmapMesh(zmap, comparison.cellClass) };
    } else {
      geometry.inProcess = { zmap, mesh: zmapMesh(zmap) };
    }
  }
  return geometry;
}

// ---------------------------------------------------------------------------
// Parity
// ---------------------------------------------------------------------------

/** Signed-tetrahedron volume of a closed triangle soup. */
export function meshVolume(positions: Float32Array): number {
  let v = 0;
  for (let i = 0; i + 8 < positions.length; i += 9) {
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return Math.abs(v / 6);
}

const round = (n: number, places = 4): number => {
  const f = 10 ** places;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

function meshDigest(mesh: GeoMesh): { triangles: number; edges: number; min: number[]; max: number[]; volume: number } {
  return {
    triangles: mesh.triangleCount,
    edges: mesh.edges.length / 6,
    min: mesh.bounds.min.map(v => round(v)),
    max: mesh.bounds.max.map(v => round(v)),
    volume: round(meshVolume(mesh.positions)),
  };
}

/** The numbers every implementation must reproduce for the same pack. */
export function geometryDigest(geometry: RevPackGeometry): Record<string, unknown> {
  return {
    version: geometry.version,
    packId: geometry.packId,
    units: geometry.units,
    target: geometry.target ? meshDigest(geometry.target) : null,
    stock: meshDigest(geometry.stock),
    workholding: geometry.workholding.map(item => ({ name: item.name, ...meshDigest(item.mesh) })),
    tools: geometry.tools.map(tool => ({
      t: tool.t,
      kind: tool.kind,
      gaugeLength: round(tool.gaugeLength),
      stickOut: round(tool.stickOut),
      cutter: meshDigest(tool.cutter),
      holder: tool.holder ? meshDigest(tool.holder) : null,
    })),
    inProcess: geometry.inProcess ? {
      nx: geometry.inProcess.zmap.nx,
      ny: geometry.inProcess.zmap.ny,
      removedVolume: round(geometry.inProcess.zmap.removedVolume),
      stockVolume: round(geometry.inProcess.zmap.stockVolume),
      applied: geometry.inProcess.zmap.applied,
      skippedTilted: geometry.inProcess.zmap.skippedTilted,
      approxTilted: geometry.inProcess.zmap.approxTilted,
      skippedNoTool: geometry.inProcess.zmap.skippedNoTool,
      threadMoves: geometry.inProcess.zmap.threadMoves,
      mesh: meshDigest(geometry.inProcess.mesh),
      comparison: geometry.inProcess.comparison ? {
        onSize: geometry.inProcess.comparison.onSize,
        remaining: geometry.inProcess.comparison.remaining,
        gouge: geometry.inProcess.comparison.gouge,
        maxRemaining: round(geometry.inProcess.comparison.maxRemaining),
        maxGouge: round(geometry.inProcess.comparison.maxGouge),
      } : null,
    } : null,
  };
}

// ---------------------------------------------------------------------------
// 2D projection (the hub's SVG renderer uses this; Three.js renderers don't)
// ---------------------------------------------------------------------------

export type ViewName = 'top' | 'front' | 'right' | 'iso' | 'turn';

/** Part point -> [screenX, screenY (up), depth (toward viewer)]. */
export function projectPoint(view: ViewName, x: number, y: number, z: number): [number, number, number] {
  switch (view) {
    case 'top': return [x, y, z];
    case 'front': return [x, z, -y];
    case 'right': return [y, z, x];
    case 'turn': return [z, x, y];
    case 'iso':
    default: {
      // Standard isometric: azimuth -45 deg, elevation 35.264 deg.
      const c = Math.SQRT1_2;
      const sx = (x - y) * c;
      const sy = z * 0.8165 + (x + y) * 0.4082;
      const depth = -(x + y) * 0.5774 + z * 0.5774;
      return [sx, sy, depth];
    }
  }
}

export interface ProjectedTriangle { pts: [number, number, number, number, number, number]; depth: number; shade: number }

/**
 * Triangles projected for a view, back to front, each with a 0..1 shade from
 * a fixed light, so a flat SVG renderer can paint them as a lit solid.
 */
export function projectTriangles(view: ViewName, positions: Float32Array, offset: Vec3 = [0, 0, 0]): ProjectedTriangle[] {
  const out: ProjectedTriangle[] = [];
  for (let i = 0; i + 8 < positions.length; i += 9) {
    const a = projectPoint(view, positions[i] + offset[0], positions[i + 1] + offset[1], positions[i + 2] + offset[2]);
    const b = projectPoint(view, positions[i + 3] + offset[0], positions[i + 4] + offset[1], positions[i + 5] + offset[2]);
    const c = projectPoint(view, positions[i + 6] + offset[0], positions[i + 7] + offset[1], positions[i + 8] + offset[2]);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    const shade = Math.min(1, 0.35 + 0.65 * Math.abs((nx * 0.3 + ny * 0.6 + nz * 0.74) / len));
    out.push({ pts: [a[0], a[1], b[0], b[1], c[0], c[1]], depth: (a[2] + b[2] + c[2]) / 3, shade });
  }
  out.sort((p, q) => p.depth - q.depth);
  return out;
}

export function projectEdges(view: ViewName, edges: Float32Array, offset: Vec3 = [0, 0, 0]): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  for (let i = 0; i + 5 < edges.length; i += 6) {
    const a = projectPoint(view, edges[i] + offset[0], edges[i + 1] + offset[1], edges[i + 2] + offset[2]);
    const b = projectPoint(view, edges[i + 3] + offset[0], edges[i + 4] + offset[1], edges[i + 5] + offset[2]);
    out.push([a[0], a[1], b[0], b[1]]);
  }
  return out;
}
