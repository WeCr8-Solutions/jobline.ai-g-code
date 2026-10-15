/**
 * RevPack part placement / work origin kernel, shared by the JobLine G-Code
 * extension, jobline.ai-CAM and the JobLine.ai shop app (shift-handover-hub).
 *
 * Kept byte-for-byte identical in all three repositories beside revpack.ts,
 * revpackCorrelation.ts, revpackGeometry.ts and revpackParity.ts:
 *   g-code: src/providers/visualizer/revpackPlacement.ts
 *   CAM:    src/core/revpack/revpackPlacement.ts
 *   hub:    src/lib/jobline/revpack/revpackPlacement.ts
 * Same rule as jblMachine.ts: change it in one repository, copy it to the
 * others; the parity golden (revpack-geometry.golden.json, "placement" key of
 * every pack) proves the three compute the same origins.
 *
 * It has NO runtime imports (types only), uses no Node or DOM APIs, so the
 * compiled CommonJS file also loads as a plain <script> in the VS Code webview
 * (the visualizer defines `exports` first) and in a browser bundle.
 *
 * What it answers - "Set WCS / part to origin", the way Fusion, Mastercam and
 * ESPRIT do it:
 *   boxPoint / BOX_POINTS   the 27 points of a box: 8 corners, 12 edge
 *                           midpoints, 6 face centres, the centre
 *   placeAtBoxPoint         WCS at one of them, on the part box or the stock box
 *   placeAxisAtBox          one axis only (Top = Z on the top face, X/Y kept)
 *   placeAtPoint            WCS at a picked vertex / edge point / any point
 *   pickFeature             planar face or cylindrical bore / boss under a
 *                           picked triangle of a mesh (STL or tessellated STEP)
 *   fitPlane / fitCylinder / circleFrom3Points / midpoint
 *   centerOnAxis            centre the WCS on a bore / boss axis, optionally
 *                           turning that axis onto Z
 *   rotate90 / flip / alignVectorTo   re-orient the part about the WCS
 *   shiftOrigin             numeric X/Y/Z shift + rotation about Z
 *   fitTargetInStock        centre / keep the target inside a fixed stock
 *   applyPlacementToPack    the pack after a move: target transform, stock
 *                           from the setup, workholding following the stock,
 *                           G54 moved by the same amount, part-zero text
 *   buildJbl / parseJbl     the .jbl job file: the pack, the setup made on it
 *                           and the target STL in one file, re-applied the
 *                           same way by every host; setupDigest / needsRepost
 *                           say when the program must be re-posted
 *
 * Frame: PART coordinates are the model's own (as the pack / file states
 * them). A Placement maps them to WORK (program) coordinates:
 *     work = R * part - origin
 * R is a rotation (row-major 3x3), origin is the work-zero's position in the
 * rotated part frame. G-code axes: X right, Y away (back), Z up / spindle.
 * Names: left = -X, right = +X, front = -Y, back = +Y, bottom = -Z, top = +Z.
 */

import type { RevPack, RevPackBox, RevPackCylinder, RevPackSetup } from './revpack';

export const REVPACK_PLACEMENT_VERSION = '1.0';

export type PVec3 = [number, number, number];
/** Row-major 3x3 rotation. */
export type PMat3 = [number, number, number, number, number, number, number, number, number];
export interface PBounds { min: PVec3; max: PVec3 }
export type Axis = 0 | 1 | 2;
export type Side = -1 | 0 | 1;
export interface BoxPointSel { x: Side; y: Side; z: Side }
export type BoxRef = 'part' | 'stock';
export type AxisName = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';

/** The last thing the WCS was snapped to, so a re-orientation can re-apply it. */
export type PlacementAnchor =
  | { kind: 'box'; point: BoxPointSel; ref: BoxRef }
  | { kind: 'manual' };

export interface Placement {
  rotation: PMat3;
  origin: PVec3;
  anchor?: PlacementAnchor;
  /** What the WCS is on, in words (setup sheet / revpack setup.partZero). */
  label?: string;
}

/** The part as the kernel needs it: its triangles (optional) and bounds, PART coordinates. */
export interface PartGeometry {
  positions?: ArrayLike<number>;
  bounds: PBounds;
}

// ─── small vector / matrix helpers ───────────────────────────────────────────

const EPS = 1e-9;
export const IDENTITY: PMat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Round away float noise so goldens and UI readouts are stable (and never -0). */
export function clean(n: number, digits = 9): number {
  const k = Math.pow(10, digits);
  const r = Math.round(n * k) / k;
  return Object.is(r, -0) ? 0 : r;
}
const cleanV = (v: ArrayLike<number>, digits = 9): PVec3 => [clean(v[0], digits), clean(v[1], digits), clean(v[2], digits)];

export const add = (a: PVec3, b: PVec3): PVec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: PVec3, b: PVec3): PVec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: PVec3, k: number): PVec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: PVec3, b: PVec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: PVec3, b: PVec3): PVec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: PVec3): number => Math.sqrt(dot(a, a));
export function normalize(a: PVec3): PVec3 {
  const l = length(a);
  return l > EPS ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

export function mulMat(a: PMat3, b: PMat3): PMat3 {
  const r = new Array(9).fill(0) as PMat3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  }
  return snapMat(r);
}
export function mulVec(m: PMat3, v: PVec3): PVec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}
export function transpose(m: PMat3): PMat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}
/** Snap entries within 1e-12 of 0 / +-1 so 90-degree rotations stay exact. */
function snapMat(m: PMat3): PMat3 {
  return m.map(v => {
    if (Math.abs(v) < 1e-12) return 0;
    if (Math.abs(v - 1) < 1e-12) return 1;
    if (Math.abs(v + 1) < 1e-12) return -1;
    return v;
  }) as PMat3;
}

/** Rotation about a G-code axis by a multiple of 90 degrees (exact). */
export function rot90(axis: Axis, turns: number): PMat3 {
  const t = ((Math.round(turns) % 4) + 4) % 4;
  const c = [1, 0, -1, 0][t];
  const s = [0, 1, 0, -1][t];
  if (axis === 0) return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 1) return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** Rotation by `deg` about a unit axis (Rodrigues). */
export function rotAxisAngle(axis: PVec3, deg: number): PMat3 {
  const quarter = deg / 90;
  if (Math.abs(quarter - Math.round(quarter)) < 1e-12) {
    const n = normalize(axis);
    for (let k = 0 as Axis; k < 3; k = (k + 1) as Axis) {
      if (Math.abs(Math.abs(n[k]) - 1) < 1e-12) return rot90(k, Math.round(quarter) * Math.sign(n[k]));
    }
  }
  const [x, y, z] = normalize(axis);
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return snapMat([
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ]);
}

/** The rotation that turns unit vector `from` onto unit vector `to` (shortest arc). */
export function rotationAligning(from: PVec3, to: PVec3): PMat3 {
  const a = normalize(from), b = normalize(to);
  const c = dot(a, b);
  if (c > 1 - 1e-12) return [...IDENTITY] as PMat3;
  if (c < -1 + 1e-12) {
    // 180 degrees about any axis perpendicular to `a`; prefer a G-code axis so it stays exact.
    const helper: PVec3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const perp = normalize(cross(a, helper));
    return rotAxisAngle(perp, 180);
  }
  const axis = cross(a, b);
  const deg = (Math.atan2(length(axis), c) * 180) / Math.PI;
  return rotAxisAngle(axis, deg);
}

export function axisVector(name: AxisName): PVec3 {
  const k = name[1] === 'X' ? 0 : name[1] === 'Y' ? 1 : 2;
  const v: PVec3 = [0, 0, 0];
  v[k] = name[0] === '-' ? -1 : 1;
  return v;
}

/** Nearest G-code axis to a direction, with its sign. */
export function nearestAxis(v: PVec3): { axis: Axis; sign: 1 | -1; name: AxisName } {
  const a = [Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])];
  const axis = (a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2) as Axis;
  const sign = v[axis] < 0 ? -1 : 1;
  return { axis, sign, name: `${sign < 0 ? '-' : '+'}${'XYZ'[axis]}` as AxisName };
}

// ─── boxes and the 27 box points ─────────────────────────────────────────────

export function boundsOfPoints(positions: ArrayLike<number>): PBounds {
  const min: PVec3 = [Infinity, Infinity, Infinity];
  const max: PVec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

export function boxCorners(b: PBounds): PVec3[] {
  const out: PVec3[] = [];
  for (const z of [b.min[2], b.max[2]]) for (const y of [b.min[1], b.max[1]]) for (const x of [b.min[0], b.max[0]]) out.push([x, y, z]);
  return out;
}

export function boxPoint(b: PBounds, sel: BoxPointSel): PVec3 {
  const pick = (k: number, s: Side) => (s < 0 ? b.min[k] : s > 0 ? b.max[k] : (b.min[k] + b.max[k]) / 2);
  return [pick(0, sel.x), pick(1, sel.y), pick(2, sel.z)];
}

export type BoxPointKind = 'corner' | 'edge' | 'face' | 'center';

/** Words for a box point, the way a setup sheet says it: "top-front-left corner". */
export function boxPointLabel(sel: BoxPointSel): string {
  const words: string[] = [];
  if (sel.z) words.push(sel.z > 0 ? 'top' : 'bottom');
  if (sel.y) words.push(sel.y > 0 ? 'back' : 'front');
  if (sel.x) words.push(sel.x > 0 ? 'right' : 'left');
  const kind = boxPointKind(sel);
  if (kind === 'center') return 'center';
  if (kind === 'face') return `${words[0]} face center`;
  if (kind === 'edge') return `${words.join('-')} edge midpoint`;
  return `${words.join('-')} corner`;
}

export function boxPointKind(sel: BoxPointSel): BoxPointKind {
  const n = (sel.x ? 1 : 0) + (sel.y ? 1 : 0) + (sel.z ? 1 : 0);
  return n === 3 ? 'corner' : n === 2 ? 'edge' : n === 1 ? 'face' : 'center';
}

export function boxPointId(sel: BoxPointSel): string {
  const s = (v: Side) => (v < 0 ? 'n' : v > 0 ? 'p' : '0');
  return `${s(sel.x)}${s(sel.y)}${s(sel.z)}`;
}

/** All 27 box points, top layer first (z = +1, 0, -1), then back to front, left to right. */
export const BOX_POINTS: Array<{ id: string; sel: BoxPointSel; kind: BoxPointKind; label: string }> = (() => {
  const out: Array<{ id: string; sel: BoxPointSel; kind: BoxPointKind; label: string }> = [];
  for (const z of [1, 0, -1] as Side[]) for (const y of [1, 0, -1] as Side[]) for (const x of [-1, 0, 1] as Side[]) {
    const sel = { x, y, z };
    out.push({ id: boxPointId(sel), sel, kind: boxPointKind(sel), label: boxPointLabel(sel) });
  }
  return out;
})();

/** The shop's most common zeros, as one-click presets. */
export const PLACEMENT_PRESETS: Array<{ id: string; label: string; sel: BoxPointSel }> = [
  { id: 'top-center', label: 'Top center', sel: { x: 0, y: 0, z: 1 } },
  { id: 'top-front-left', label: 'Top-front-left corner', sel: { x: -1, y: -1, z: 1 } },
  { id: 'top-back-left', label: 'Top-back-left corner', sel: { x: -1, y: 1, z: 1 } },
  { id: 'bottom-center', label: 'Bottom center', sel: { x: 0, y: 0, z: -1 } },
  { id: 'bottom-front-left', label: 'Bottom-front-left corner', sel: { x: -1, y: -1, z: -1 } },
  { id: 'center', label: 'Center', sel: { x: 0, y: 0, z: 0 } },
];

/** Quick face buttons: they move ONE axis to that face (Top = Z on the top, X/Y kept). */
export const FACE_BUTTONS: Array<{ id: 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back'; axis: Axis; side: Side }> = [
  { id: 'top', axis: 2, side: 1 }, { id: 'bottom', axis: 2, side: -1 },
  { id: 'left', axis: 0, side: -1 }, { id: 'right', axis: 0, side: 1 },
  { id: 'front', axis: 1, side: -1 }, { id: 'back', axis: 1, side: 1 },
];

/** Bounds of the part after rotation R (exact from the triangles when given, else from the box corners). */
export function rotatedBounds(geometry: PartGeometry, rotation: PMat3): PBounds {
  const isIdentity = rotation.every((v, i) => v === IDENTITY[i]);
  if (isIdentity) return { min: [...geometry.bounds.min] as PVec3, max: [...geometry.bounds.max] as PVec3 };
  const axisAligned = rotation.every(v => v === 0 || v === 1 || v === -1);
  const pts: PVec3[] = [];
  if (!axisAligned && geometry.positions && geometry.positions.length >= 9) {
    const p = geometry.positions;
    const out = new Float64Array(p.length);
    for (let i = 0; i + 2 < p.length; i += 3) {
      const v = mulVec(rotation, [p[i], p[i + 1], p[i + 2]]);
      out[i] = v[0]; out[i + 1] = v[1]; out[i + 2] = v[2];
    }
    return boundsOfPoints(out);
  }
  for (const c of boxCorners(geometry.bounds)) pts.push(mulVec(rotation, c));
  return boundsOfPoints(pts.flat());
}

/** The part's bounds in WORK coordinates under a placement. */
export function placedBounds(geometry: PartGeometry, p: Placement): PBounds {
  const b = rotatedBounds(geometry, p.rotation);
  return { min: sub(b.min, p.origin), max: sub(b.max, p.origin) };
}

/**
 * The stock box the setup states around target bounds - the same envelope as
 * revpack.ts stockFromSetup (proven equal by the parity test), repeated here
 * so this file stays import-free. Bar stock is its bounding box on the
 * spindle axis (X0 Y0).
 */
export function setupStockBounds(setup: Pick<RevPackSetup, 'stockOffsets' | 'barOffsets'> | undefined, target: PBounds): PBounds | undefined {
  if (setup?.stockOffsets) {
    const o = setup.stockOffsets;
    return { min: [target.min[0] - o.xMin, target.min[1] - o.yMin, target.min[2] - o.zMin], max: [target.max[0] + o.xMax, target.max[1] + o.yMax, target.max[2] + o.zMax] };
  }
  if (setup?.barOffsets) {
    const o = setup.barOffsets;
    const radius = Math.max(Math.abs(target.min[0]), Math.abs(target.max[0]), Math.abs(target.min[1]), Math.abs(target.max[1])) + o.radial;
    return { min: [-radius, -radius, target.min[2] - o.zMin], max: [radius, radius, target.max[2] + o.zMax] };
  }
  return undefined;
}

/** The box a box-point snap measures on: the rotated part, or the stock around it. */
export function referenceBox(geometry: PartGeometry, rotation: PMat3, ref: BoxRef, setup?: Pick<RevPackSetup, 'stockOffsets' | 'barOffsets'>, stockPartBounds?: PBounds): PBounds {
  const part = rotatedBounds(geometry, rotation);
  if (ref === 'part') return part;
  const fromSetup = setupStockBounds(setup, part);
  if (fromSetup) return fromSetup;
  // A fixed stock (no setup offsets) turns with the part.
  if (stockPartBounds) return rotatedBounds({ bounds: stockPartBounds }, rotation);
  return part;
}

// ─── placements ──────────────────────────────────────────────────────────────

export function identityPlacement(label?: string): Placement {
  return { rotation: [...IDENTITY] as PMat3, origin: [0, 0, 0], anchor: { kind: 'manual' }, ...(label ? { label } : {}) };
}

export interface PlacementContext {
  geometry: PartGeometry;
  setup?: Pick<RevPackSetup, 'stockOffsets' | 'barOffsets'>;
  /** A fixed stock's bounds in PART coordinates (used when the setup states no offsets). */
  stockBounds?: PBounds;
  /** Lathe / bar work: the zero must stay on the spindle axis, only Z moves. */
  lathe?: boolean;
}

function finish(p: Placement, ctx?: PlacementContext): Placement {
  let origin = cleanV(p.origin);
  if (ctx?.lathe) origin = [0, 0, origin[2]];
  return { ...p, rotation: snapMat(p.rotation), origin };
}

/** WCS at one of the 27 points of the part box or the stock box. */
export function placeAtBoxPoint(p: Placement, ctx: PlacementContext, sel: BoxPointSel, ref: BoxRef = 'part'): Placement {
  const box = referenceBox(ctx.geometry, p.rotation, ref, ctx.setup, ctx.stockBounds);
  const label = `${boxPointLabel(sel)} of the ${ref === 'stock' ? 'stock' : 'part'}`;
  return finish({ rotation: p.rotation, origin: boxPoint(box, sel), anchor: { kind: 'box', point: sel, ref }, label }, ctx);
}

/** One axis only: Top = Z0 on the top face of the box, X and Y stay where they are. */
export function placeAxisAtBox(p: Placement, ctx: PlacementContext, axis: Axis, side: Side, ref: BoxRef = 'part'): Placement {
  const box = referenceBox(ctx.geometry, p.rotation, ref, ctx.setup, ctx.stockBounds);
  const origin = [...p.origin] as PVec3;
  origin[axis] = side < 0 ? box.min[axis] : side > 0 ? box.max[axis] : (box.min[axis] + box.max[axis]) / 2;
  const anchor: PlacementAnchor = p.anchor?.kind === 'box'
    ? { kind: 'box', ref, point: { ...p.anchor.point, [('xyz')[axis]]: side } as BoxPointSel }
    : { kind: 'manual' };
  const face = [['left', 'center', 'right'], ['front', 'center', 'back'], ['bottom', 'center', 'top']][axis][side + 1];
  const label = anchor.kind === 'box'
    ? `${boxPointLabel(anchor.point)} of the ${ref === 'stock' ? 'stock' : 'part'}`
    : `${'XYZ'[axis]}0 on the ${face}${side === 0 ? '' : ' face'} of the ${ref === 'stock' ? 'stock' : 'part'}`;
  return finish({ rotation: p.rotation, origin, anchor, label }, ctx);
}

/**
 * WCS at a point given in the CURRENT work coordinates (a picked vertex, an
 * edge point, a face point). `axes` limits which axes move (face pick: Z only).
 */
export function placeAtPoint(p: Placement, workPoint: PVec3, axes: [boolean, boolean, boolean] = [true, true, true], label?: string, ctx?: PlacementContext): Placement {
  const origin = [...p.origin] as PVec3;
  for (let k = 0; k < 3; k++) if (axes[k]) origin[k] += workPoint[k];
  return finish({ rotation: p.rotation, origin, anchor: { kind: 'manual' }, label: label ?? p.label }, ctx);
}

/** Re-apply a box anchor after the part was re-oriented (rotate / flip / align). */
function reanchor(p: Placement, ctx?: PlacementContext): Placement {
  if (ctx && p.anchor?.kind === 'box') return placeAtBoxPoint(p, ctx, p.anchor.point, p.anchor.ref);
  return finish(p, ctx);
}

/** Turn the part about the WCS: work' = Q * work. A box anchor is re-applied. */
export function rotateAboutOrigin(p: Placement, q: PMat3, ctx?: PlacementContext, label?: string): Placement {
  return reanchor({ rotation: mulMat(q, p.rotation), origin: mulVec(q, p.origin), anchor: p.anchor, label: label ?? p.label }, ctx);
}

export function rotate90(p: Placement, axis: Axis, turns = 1, ctx?: PlacementContext): Placement {
  return rotateAboutOrigin(p, rot90(axis, turns), ctx);
}

/** Flip the part over (180 degrees about X by default): op 2 / second side. */
export function flip(p: Placement, axis: Axis = 0, ctx?: PlacementContext): Placement {
  return rotateAboutOrigin(p, rot90(axis, 2), ctx);
}

/** Turn a direction given in WORK coordinates (a picked face normal, a bore axis) onto a G-code axis. */
export function alignVectorTo(p: Placement, workVector: PVec3, to: AxisName, ctx?: PlacementContext): Placement {
  return rotateAboutOrigin(p, rotationAligning(workVector, axisVector(to)), ctx);
}

/**
 * Centre the WCS on an axis (a bore or boss), in WORK coordinates. The two
 * axes across the feature move onto it; the one along it is kept. With
 * `align`, the feature axis is first turned onto +Z (pointing out of the
 * material for a boss, into the hole for a bore is the caller's choice of
 * sign), so the centre lands on X0 Y0, and Z0 goes on the part's new top.
 */
export function centerOnAxis(p: Placement, axisPoint: PVec3, axisDir: PVec3, options: { align?: boolean; ctx?: PlacementContext } = {}): Placement {
  let cur = p;
  let point = axisPoint;
  let dir = normalize(axisDir);
  if (options.align) {
    const q2 = rotationAligning(dir, [0, 0, 1]);
    cur = { rotation: mulMat(q2, p.rotation), origin: mulVec(q2, p.origin), anchor: { kind: 'manual' }, label: p.label };
    point = mulVec(q2, axisPoint);
    dir = [0, 0, 1];
  }
  const along = nearestAxis(dir).axis;
  const origin = [...cur.origin] as PVec3;
  // Exact for an axis-parallel feature; otherwise move to the axis point projected along it.
  const t = Math.abs(dir[along]) > EPS ? -point[along] / dir[along] : 0;
  const onAxis = add(point, scale(dir, t));
  for (let k = 0; k < 3; k++) if (k !== along) origin[k] += onAxis[k];
  // Turned onto Z, the part now stands differently: Z0 goes on its new top face.
  if (options.align && options.ctx) origin[2] = rotatedBounds(options.ctx.geometry, cur.rotation).max[2];
  return finish({ rotation: cur.rotation, origin, anchor: { kind: 'manual' }, label: 'on the picked bore/boss axis' }, options.ctx);
}

/**
 * Numeric entry: shift the zero by d (WORK coordinates; the part appears to
 * move by -d), then turn the part by `rotZDeg` about the new zero's Z.
 */
export function shiftOrigin(p: Placement, d: PVec3, rotZDeg = 0, ctx?: PlacementContext): Placement {
  const shifted = finish({ rotation: p.rotation, origin: add(p.origin, d), anchor: { kind: 'manual' }, label: p.label }, ctx);
  if (!rotZDeg) return shifted;
  return rotateAboutOrigin({ ...shifted, anchor: { kind: 'manual' } }, rotAxisAngle([0, 0, 1], rotZDeg), ctx);
}

/**
 * A fixed stock (WORK bounds) and the target's WORK bounds: the move of the
 * TARGET that centres it ('center' XY and Z, 'center-xy' XY with the top
 * kept, 'top-center' XY centred and tops flush) or keeps it inside ('inside':
 * the smallest move, 0 when it already fits).
 */
export function fitTargetInStock(target: PBounds, stock: PBounds, mode: 'center' | 'center-xy' | 'top-center' | 'inside'): PVec3 {
  const d: PVec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const tc = (target.min[k] + target.max[k]) / 2, sc = (stock.min[k] + stock.max[k]) / 2;
    if (mode === 'inside') {
      if (target.max[k] - target.min[k] > stock.max[k] - stock.min[k]) d[k] = sc - tc;
      else if (target.min[k] < stock.min[k]) d[k] = stock.min[k] - target.min[k];
      else if (target.max[k] > stock.max[k]) d[k] = stock.max[k] - target.max[k];
    } else if (k < 2 || mode === 'center') {
      d[k] = sc - tc;
    } else if (mode === 'top-center') {
      d[k] = stock.max[k] - target.max[k];
    }
  }
  return cleanV(d);
}

/** Setup offsets with the target centred in the same stock (left = right, front = back; with 'xyz' also top = bottom). */
export function centeredStockOffsets(o: NonNullable<RevPackSetup['stockOffsets']>, axes: 'xy' | 'xyz' = 'xy'): NonNullable<RevPackSetup['stockOffsets']> {
  const x = (o.xMin + o.xMax) / 2, y = (o.yMin + o.yMax) / 2, z = (o.zMin + o.zMax) / 2;
  return { xMin: clean(x), xMax: clean(x), yMin: clean(y), yMax: clean(y), zMin: axes === 'xyz' ? clean(z) : o.zMin, zMax: axes === 'xyz' ? clean(z) : o.zMax };
}

// ─── transforms ──────────────────────────────────────────────────────────────

/** Row-major 3x4 [R | t] that maps PART to WORK coordinates. */
export function placementMatrix(p: Placement): number[] {
  const r = p.rotation, o = p.origin;
  return [r[0], r[1], r[2], -o[0], r[3], r[4], r[5], -o[1], r[6], r[7], r[8], -o[2]].map(v => clean(v, 12));
}

/** Column-major 4x4 (Three.js Matrix4.fromArray / elements order) of a placement. */
export function placementMatrix4(p: Placement): number[] {
  const m = placementMatrix(p);
  return [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, m[3], m[7], m[11], 1];
}

export function partToWork(p: Placement, v: PVec3): PVec3 { return sub(mulVec(p.rotation, v), p.origin); }
export function workToPart(p: Placement, v: PVec3): PVec3 { return mulVec(transpose(p.rotation), add(v, p.origin)); }
/** A direction (normal, axis) from PART to WORK coordinates. */
export function partDirToWork(p: Placement, v: PVec3): PVec3 { return mulVec(p.rotation, v); }

/** Apply a row-major 3x4 transform to a flat xyz array. */
export function transformPositions(positions: ArrayLike<number>, m: number[]): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    out[i] = m[0] * x + m[1] * y + m[2] * z + m[3];
    out[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
    out[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
  }
  return out;
}

export function isIdentityPlacement(p: Placement): boolean {
  return p.rotation.every((v, i) => v === IDENTITY[i]) && p.origin.every(v => v === 0);
}

// ─── feature fits ────────────────────────────────────────────────────────────

export function triangleNormal(positions: ArrayLike<number>, tri: number): { normal: PVec3; area: number; centroid: PVec3 } {
  const i = tri * 9;
  const a: PVec3 = [positions[i], positions[i + 1], positions[i + 2]];
  const b: PVec3 = [positions[i + 3], positions[i + 4], positions[i + 5]];
  const c: PVec3 = [positions[i + 6], positions[i + 7], positions[i + 8]];
  const n = cross(sub(b, a), sub(c, a));
  const l = length(n);
  return { normal: l > 0 ? scale(n, 1 / l) : [0, 0, 0], area: l / 2, centroid: scale(add(add(a, b), c), 1 / 3) };
}

export function midpoint(a: PVec3, b: PVec3): PVec3 { return cleanV(scale(add(a, b), 0.5)); }

/** Circle through three points: centre, radius and the plane normal; undefined when collinear. */
export function circleFrom3Points(a: PVec3, b: PVec3, c: PVec3): { center: PVec3; radius: number; normal: PVec3 } | undefined {
  const ab = sub(b, a), ac = sub(c, a);
  const n = cross(ab, ac);
  const nn = dot(n, n);
  if (nn < EPS * EPS) return undefined;
  const term = add(scale(cross(n, ab), dot(ac, ac)), scale(cross(ac, n), dot(ab, ab)));
  const center = add(a, scale(term, 1 / (2 * nn)));
  return { center: cleanV(center), radius: clean(length(sub(center, a))), normal: cleanV(normalize(n)) };
}

/** Symmetric 3x3 eigen-decomposition (Jacobi), eigenvalues ascending with unit eigenvectors. */
export function symmetricEigen(m: number[]): { values: PVec3; vectors: PVec3[] } {
  const a = [[m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-15) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-18) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  return {
    values: order.map(i => a[i][i]) as PVec3,
    vectors: order.map(i => canonicalDir([v[0][i], v[1][i], v[2][i]])),
  };
}

/** A direction with a stable sign: its largest component positive. */
export function canonicalDir(v: PVec3): PVec3 {
  const n = normalize(v);
  const k = nearestAxis(n).axis;
  return n[k] < 0 ? scale(n, -1) : n;
}

export interface PlaneFit { kind: 'plane'; normal: PVec3; point: PVec3; area: number; triangles: number[] }
export interface CylinderFit {
  kind: 'cylinder';
  /** Axis direction (canonical sign) and a point on it at the middle of the feature's length. */
  axisDir: PVec3;
  axisPoint: PVec3;
  radius: number;
  /** Length along the axis covered by the picked surface. */
  length: number;
  /** true: a hole (surface normals face the axis); false: a boss / shaft. */
  bore: boolean;
  /** RMS distance of the vertices from the fitted circle, relative to the radius. */
  residual: number;
  triangles: number[];
}
export type FeatureFit = PlaneFit | CylinderFit;

/** Area-weighted plane through a set of triangles (normal points out of the material). */
export function fitPlane(positions: ArrayLike<number>, triangles: number[]): PlaneFit {
  let n: PVec3 = [0, 0, 0], c: PVec3 = [0, 0, 0], area = 0;
  for (const t of triangles) {
    const tn = triangleNormal(positions, t);
    n = add(n, scale(tn.normal, tn.area));
    c = add(c, scale(tn.centroid, tn.area));
    area += tn.area;
  }
  const normal = normalize(n);
  const point = area > 0 ? scale(c, 1 / area) : [0, 0, 0] as PVec3;
  return { kind: 'plane', normal: cleanV(normal), point: cleanV(point), area: clean(area), triangles: [...triangles].sort((a, b) => a - b) };
}

/** Least-squares circle (Kasa) in 2D. */
function fitCircle2D(pts: Array<[number, number]>): { cx: number; cy: number; r: number; rms: number } | undefined {
  if (pts.length < 3) return undefined;
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= pts.length; my /= pts.length;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const [x, y] of pts) {
    const u = x - mx, v = y - my;
    suu += u * u; svv += v * v; suv += u * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-18) return undefined;
  const b1 = 0.5 * (suuu + suvv), b2 = 0.5 * (svvv + svuu);
  const uc = (b1 * svv - b2 * suv) / det, vc = (suu * b2 - suv * b1) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / pts.length);
  let e = 0;
  for (const [x, y] of pts) { const d = Math.hypot(x - mx - uc, y - my - vc) - r; e += d * d; }
  return { cx: uc + mx, cy: vc + my, r, rms: Math.sqrt(e / pts.length) };
}

/** Cylinder through a set of triangles: axis from the normals, circle from the projected vertices. */
export function fitCylinder(positions: ArrayLike<number>, triangles: number[]): CylinderFit | undefined {
  const m = new Array(9).fill(0);
  let wsum = 0;
  for (const t of triangles) {
    const { normal: n, area } = triangleNormal(positions, t);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] += area * n[i] * n[j];
    wsum += area;
  }
  if (wsum <= 0) return undefined;
  const eig = symmetricEigen(m.map(v => v / wsum));
  // A cylinder's normals all lie in the plane across its axis: one eigenvalue ~0, two clearly not.
  if (eig.values[0] > 0.02 || eig.values[1] < 0.05) return undefined;
  let axisDir = eig.vectors[0];
  const snapped = nearestAxis(axisDir);
  if (Math.abs(axisDir[snapped.axis]) > 1 - 1e-6) { axisDir = [0, 0, 0]; axisDir[snapped.axis] = 1; }
  const u = normalize(cross(axisDir, Math.abs(axisDir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const w = cross(axisDir, u);
  const seen = new Set<string>();
  const pts2: Array<[number, number]> = [];
  let tMin = Infinity, tMax = -Infinity;
  for (const t of triangles) {
    for (let k = 0; k < 3; k++) {
      const i = t * 9 + k * 3;
      const p: PVec3 = [positions[i], positions[i + 1], positions[i + 2]];
      const key = p.map(v => Math.round(v * 1e6)).join(',');
      const along = dot(p, axisDir);
      if (along < tMin) tMin = along;
      if (along > tMax) tMax = along;
      if (seen.has(key)) continue;
      seen.add(key);
      pts2.push([dot(p, u), dot(p, w)]);
    }
  }
  const circle = fitCircle2D(pts2);
  if (!circle || !(circle.r > 0)) return undefined;
  const residual = circle.rms / circle.r;
  if (residual > 0.05) return undefined;
  const mid = (tMin + tMax) / 2;
  const axisPoint = add(add(scale(u, circle.cx), scale(w, circle.cy)), scale(axisDir, mid));
  // Bore when the normals point toward the axis.
  let toward = 0;
  for (const t of triangles) {
    const tn = triangleNormal(positions, t);
    const radial = sub(tn.centroid, add(axisPoint, scale(axisDir, dot(sub(tn.centroid, axisPoint), axisDir))));
    toward += dot(tn.normal, radial) * tn.area;
  }
  return {
    kind: 'cylinder',
    axisDir: cleanV(axisDir),
    axisPoint: cleanV(axisPoint, 6),
    radius: clean(circle.r, 6),
    length: clean(tMax - tMin, 6),
    bore: toward < 0,
    residual: clean(residual, 6),
    triangles: [...triangles].sort((a, b) => a - b),
  };
}

/** Triangle adjacency of a triangle soup (vertices welded on a grid of `tol`). */
export function triangleAdjacency(positions: ArrayLike<number>, tol?: number): number[][] {
  const count = Math.floor(positions.length / 9);
  const b = boundsOfPoints(positions);
  const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 1e-9);
  const q = tol ?? size * 1e-6;
  const vkey = (i: number) => `${Math.round(positions[i] / q)},${Math.round(positions[i + 1] / q)},${Math.round(positions[i + 2] / q)}`;
  const edgeMap = new Map<string, number[]>();
  for (let t = 0; t < count; t++) {
    const k = [vkey(t * 9), vkey(t * 9 + 3), vkey(t * 9 + 6)];
    for (const [a, c] of [[0, 1], [1, 2], [2, 0]]) {
      const e = k[a] < k[c] ? `${k[a]}|${k[c]}` : `${k[c]}|${k[a]}`;
      const list = edgeMap.get(e);
      if (list) list.push(t); else edgeMap.set(e, [t]);
    }
  }
  const adj: number[][] = Array.from({ length: count }, () => []);
  for (const list of edgeMap.values()) {
    for (const a of list) for (const c of list) if (a !== c && !adj[a].includes(c)) adj[a].push(c);
  }
  return adj;
}

/**
 * The feature under a picked triangle: the planar face it lies on, or the
 * cylindrical bore / boss surface it is part of. `smoothDeg` is the largest
 * angle between neighbouring facets of one curved surface (a 16-segment
 * cylinder is 22.5 degrees); `planeDeg` the tolerance of one flat face.
 */
export function pickFeature(positions: ArrayLike<number>, tri: number, options: { adjacency?: number[][]; smoothDeg?: number; planeDeg?: number } = {}): FeatureFit | undefined {
  const count = Math.floor(positions.length / 9);
  if (!(tri >= 0 && tri < count)) return undefined;
  const adj = options.adjacency ?? triangleAdjacency(positions);
  const cosSmooth = Math.cos(((options.smoothDeg ?? 30) * Math.PI) / 180);
  const cosPlane = Math.cos(((options.planeDeg ?? 1) * Math.PI) / 180);
  const normals: PVec3[] = [];
  const nrm = (t: number): PVec3 => {
    if (!normals[t]) normals[t] = triangleNormal(positions, t).normal;
    return normals[t];
  };
  const seed = nrm(tri);
  const grow = (accept: (from: number, to: number) => boolean): number[] => {
    const seen = new Set<number>([tri]);
    const stack = [tri];
    while (stack.length) {
      const t = stack.pop()!;
      for (const n of adj[t]) {
        if (!seen.has(n) && accept(t, n)) { seen.add(n); stack.push(n); }
      }
    }
    return [...seen];
  };
  const flat = grow((_from, to) => dot(nrm(to), seed) >= cosPlane);
  const smooth = grow((from, to) => dot(nrm(to), nrm(from)) >= cosSmooth);
  if (smooth.length > flat.length && Math.abs(dot(seed, seed)) > 0) {
    const cyl = fitCylinder(positions, smooth);
    if (cyl && Math.abs(dot(seed, cyl.axisDir)) < 0.2) {
      // Keep only the facets of the curved surface itself (drop tangent flats and blends).
      const onSurface = (t: number) => {
        const c = triangleNormal(positions, t).centroid;
        const rel = sub(c, cyl.axisPoint);
        const radial = sub(rel, scale(cyl.axisDir, dot(rel, cyl.axisDir)));
        return Math.abs(length(radial) - cyl.radius) < 0.1 * cyl.radius && Math.abs(dot(nrm(t), cyl.axisDir)) < 0.2;
      };
      const curved = smooth.filter(onSurface);
      const refined = curved.length >= 3 && curved.length < smooth.length ? fitCylinder(positions, curved) : undefined;
      const fit = refined ?? cyl;
      const area = (list: number[]) => list.reduce((sum, t) => sum + triangleNormal(positions, t).area, 0);
      if (fit.triangles.includes(tri) && area(flat) < 0.5 * area(fit.triangles)) return fit;
    }
  }
  return fitPlane(positions, flat);
}

// ─── the pack after a move ───────────────────────────────────────────────────

type PackLike = Pick<RevPack, 'units' | 'stock' | 'workholding' | 'workOffsets' | 'setup'> & Partial<Pick<RevPack, 'id' | 'machine'>>;

export interface PlacedPack<P extends PackLike> {
  pack: P;
  /** Row-major 3x4 PART -> WORK for the target model (also buildRevPackGeometry's targetTransform). */
  targetTransform: number[];
  /** Target bounds in the new WORK coordinates. */
  targetBounds: PBounds;
  stockBounds: PBounds;
  /** Translation applied to every workholding solid (they follow the stock). */
  workholdingShift: PVec3;
  /** Change of the active work offset, machine coordinates (= -workholdingShift). */
  workOffsetShift: PVec3;
  workOffset?: string;
  notes: string[];
}

function shiftShape<T extends RevPackBox | RevPackCylinder>(shape: T, d: PVec3, units: 'in' | 'mm'): T {
  const r = (v: number) => clean(v, units === 'mm' ? 6 : 7);
  if (typeof (shape as RevPackCylinder).diameter === 'number') {
    const c = shape as RevPackCylinder;
    return { ...c, zMin: r(c.zMin + d[2]), zMax: r(c.zMax + d[2]) } as T;
  }
  const b = shape as RevPackBox;
  return { ...b, min: b.min.map((v, k) => r(v + d[k])) as PVec3, max: b.max.map((v, k) => r(v + d[k])) as PVec3 } as T;
}

function shapeBounds(shape: RevPackBox | RevPackCylinder): PBounds {
  if (typeof (shape as RevPackCylinder).diameter === 'number') {
    const c = shape as RevPackCylinder;
    const r = c.diameter / 2;
    return { min: [-r, -r, c.zMin], max: [r, r, c.zMax] };
  }
  const b = shape as RevPackBox;
  return { min: [...b.min] as PVec3, max: [...b.max] as PVec3 };
}

/**
 * The pack after a placement, with the existing stock-placement rules kept:
 *  - the target is drawn through targetTransform (PART -> new WORK);
 *  - a setup with stock offsets rebuilds the stock around the moved target
 *    (stockFromSetup), so checkStockSetup still passes; a fixed stock (no
 *    offsets) moves rigidly with the part;
 *  - the vise / chuck / zero-point solids follow the stock: they shift so
 *    the stock stays seated and centred between the jaws exactly as before
 *    (same grip depth, same collision solids, only translated);
 *  - the active work offset (G54 by default) moves by the opposite amount,
 *    because the vise does not move on the machine: the WCS does;
 *  - setup.partZero says where the zero now is.
 * Lathe / bar packs keep X0 on the spindle axis (only Z moves).
 */
export function applyPlacementToPack<P extends PackLike>(pack: P, targetPartBounds: PBounds, placement: Placement, options: { positions?: ArrayLike<number>; workOffset?: string } = {}): PlacedPack<P> {
  const notes: string[] = [];
  const bar = typeof (pack.stock as RevPackCylinder).diameter === 'number';
  const p = bar && (placement.origin[0] !== 0 || placement.origin[1] !== 0)
    ? { ...placement, origin: [0, 0, placement.origin[2]] as PVec3 }
    : placement;
  if (p !== placement) notes.push('bar stock: X0 stays on the spindle axis; only Z moved');
  const geometry: PartGeometry = { positions: options.positions, bounds: targetPartBounds };
  const targetBounds = placedBounds(geometry, p);
  const oldStock = shapeBounds(pack.stock);
  const r = (v: number) => clean(v, pack.units === 'mm' ? 6 : 7);
  let stock: RevPackBox | RevPackCylinder;
  const fromSetup = setupStockBounds(pack.setup, targetBounds);
  if (fromSetup && !bar) {
    stock = { ...(pack.stock as RevPackBox), min: fromSetup.min.map(r) as PVec3, max: fromSetup.max.map(r) as PVec3 };
  } else if (fromSetup && bar) {
    stock = { ...(pack.stock as RevPackCylinder), zMin: r(fromSetup.min[2]), zMax: r(fromSetup.max[2]) };
  } else if (bar) {
    stock = shiftShape(pack.stock, [0, 0, -p.origin[2]], pack.units);
  } else {
    const moved = placedBounds({ bounds: oldStock }, p);
    stock = { ...(pack.stock as RevPackBox), min: moved.min.map(r) as PVec3, max: moved.max.map(r) as PVec3 };
  }
  const newStock = shapeBounds(stock);
  // Seat anchor: XY centre and the bottom of the stock (where it sits on the parallels / jaw step).
  const anchor = (b: PBounds): PVec3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]];
  const shift = cleanV(sub(anchor(newStock), anchor(oldStock)), 7);
  const workholding = pack.workholding.map(shape => shiftShape(shape, shift, pack.units));
  const names = Object.keys(pack.workOffsets);
  const active = options.workOffset && pack.workOffsets[options.workOffset] ? options.workOffset : (pack.workOffsets.G54 ? 'G54' : names[0]);
  const workOffsets = { ...pack.workOffsets };
  const offsetShift: PVec3 = cleanV(scale(shift, -1), 7);
  if (active) {
    const w = workOffsets[active];
    workOffsets[active] = { ...w, x: r(w.x + offsetShift[0]), ...(w.y !== undefined ? { y: r(w.y + offsetShift[1]) } : {}), z: r(w.z + offsetShift[2]) };
  }
  const oldSize = sub(oldStock.max, oldStock.min), newSize = sub(newStock.max, newStock.min);
  if (Math.abs(oldSize[0] - newSize[0]) > 1e-6 || Math.abs(oldSize[1] - newSize[1]) > 1e-6) {
    notes.push(`stock is now ${clean(newSize[0], 4)} x ${clean(newSize[1], 4)} (was ${clean(oldSize[0], 4)} x ${clean(oldSize[1], 4)}): check the jaw opening`);
  }
  const rotated = !p.rotation.every((v, i) => v === IDENTITY[i]);
  if (rotated) notes.push('part re-oriented: the stock is rebuilt around it from the setup and the program was not re-posted');
  const zeroLabel = p.label ?? (isIdentityPlacement(p) ? undefined : 'part file origin, part re-oriented');
  const setup = pack.setup ? { ...pack.setup, partZero: zeroLabel ? `WCS on the ${zeroLabel} (placed in JobLine)` : pack.setup.partZero } : pack.setup;
  return {
    pack: { ...pack, stock, workholding, workOffsets, ...(setup ? { setup } : {}) },
    targetTransform: placementMatrix(p),
    targetBounds: { min: cleanV(targetBounds.min, 7), max: cleanV(targetBounds.max, 7) },
    stockBounds: newStock,
    workholdingShift: shift,
    workOffsetShift: offsetShift,
    workOffset: active,
    notes,
  };
}

/** Readout: the WCS relative to the part box (and the machine, when the pack states the work offset). */
export function originReadout(geometry: PartGeometry, p: Placement, workOffset?: { x: number; y?: number; z: number }): { fromPartMin: PVec3; fromPartCenter: PVec3; partSize: PVec3; machine?: PVec3; label: string } {
  const b = rotatedBounds(geometry, p.rotation);
  const center = scale(add(b.min, b.max), 0.5);
  return {
    fromPartMin: cleanV(sub(p.origin, b.min), 6),
    fromPartCenter: cleanV(sub(p.origin, center), 6),
    partSize: cleanV(sub(b.max, b.min), 6),
    ...(workOffset ? { machine: cleanV([workOffset.x, workOffset.y ?? 0, workOffset.z], 6) } : {}),
    label: p.label ?? 'part file origin',
  };
}

/**
 * The digest the parity golden commits for every pack: the 27 points of the
 * target box and the stock box, and a fixed set of placements applied to the
 * pack (top-center, top-front-left, rotate + flip re-anchored), so the three
 * products are proven to compute identical origins, stock and G54.
 */
export function placementDigest(pack: PackLike, targetPartBounds: PBounds | undefined, positions?: ArrayLike<number>): Record<string, unknown> {
  const round = (v: number) => clean(v, 4);
  const rv = (v: PVec3) => v.map(round);
  const part = targetPartBounds ?? shapeBounds(pack.stock);
  const geometry: PartGeometry = { positions, bounds: part };
  const ctx: PlacementContext = { geometry, setup: pack.setup, stockBounds: shapeBounds(pack.stock), lathe: typeof (pack.stock as RevPackCylinder).diameter === 'number' };
  const stockBox = referenceBox(geometry, IDENTITY, 'stock', pack.setup, shapeBounds(pack.stock));
  const points: Record<string, number[]> = {};
  for (const bp of BOX_POINTS) points[bp.id] = rv(boxPoint(part, bp.sel));
  const cases: Record<string, unknown> = {};
  const run = (name: string, pl: Placement) => {
    const placed = applyPlacementToPack(pack, part, pl, { positions });
    const offset = placed.workOffset ? placed.pack.workOffsets[placed.workOffset] : undefined;
    cases[name] = {
      origin: rv(pl.origin),
      rotation: pl.rotation.map(round),
      target: { min: rv(placed.targetBounds.min), max: rv(placed.targetBounds.max) },
      stock: { min: rv(placed.stockBounds.min), max: rv(placed.stockBounds.max) },
      workholdingShift: rv(placed.workholdingShift),
      workOffset: offset ? [round(offset.x), round(offset.y ?? 0), round(offset.z)] : null,
    };
  };
  const id = identityPlacement();
  run('top-center', placeAtBoxPoint(id, ctx, { x: 0, y: 0, z: 1 }));
  run('top-front-left', placeAtBoxPoint(id, ctx, { x: -1, y: -1, z: 1 }));
  run('stock-top-front-left', placeAtBoxPoint(id, ctx, { x: -1, y: -1, z: 1 }, 'stock'));
  run('rotZ90-top-center', rotate90(placeAtBoxPoint(id, ctx, { x: 0, y: 0, z: 1 }), 2, 1, ctx));
  run('flip-top-center', flip(placeAtBoxPoint(id, ctx, { x: 0, y: 0, z: 1 }), 0, ctx));
  // Session operations on the real triangles: the first bore / boss in the
  // mesh (centred, axis turned to Z), the first triangle's face to the top,
  // and the target centred in the setup's stock.
  const input: PlacementInput = { positions, bounds: part, setup: pack.setup, stockBounds: shapeBounds(pack.stock), lathe: ctx.lathe };
  const session = newPlacementSession();
  const triangles = positions ? Math.floor(positions.length / 9) : 0;
  const features: Record<string, unknown> = {};
  if (triangles) {
    const adjacency = triangleAdjacency(positions!);
    input.adjacency = adjacency;
    for (let t = 0; t < triangles; t++) {
      const fit = pickFeature(positions!, t, { adjacency });
      if (fit?.kind !== 'cylinder') continue;
      const r = runPlacementOp(session, input, { op: 'pickCylinder', pick: { tri: t }, align: true });
      run('bore-center-align', r.session.placement);
      features.cylinder = { tri: t, axisPoint: rv(fit.axisPoint), axisDir: rv(fit.axisDir), radius: round(fit.radius), bore: fit.bore, triangles: fit.triangles.length };
      break;
    }
    const face = runPlacementOp(session, input, { op: 'pickFace', pick: { tri: 0 }, action: 'alignTop' });
    if (face.feature) {
      run('tri0-face-align-top', face.session.placement);
      features.tri0Face = { normal: rv(face.feature.normal ?? [0, 0, 0]), triangles: face.feature.triangles.length };
    }
  }
  if (pack.setup?.stockOffsets) {
    const centred = runPlacementOp(session, input, { op: 'centerInStock' });
    const placed = applyPlacementToPack({ ...pack, setup: { ...pack.setup, stockOffsets: centred.session.stockOffsets } }, part, centred.session.placement, { positions });
    features.centerInStock = { offsets: centred.session.stockOffsets, stock: { min: rv(placed.stockBounds.min), max: rv(placed.stockBounds.max) }, inside: targetInsideStock(placed.targetBounds, placed.stockBounds) };
  }
  return {
    version: REVPACK_PLACEMENT_VERSION,
    partBox: { min: rv(part.min), max: rv(part.max) },
    stockBox: { min: rv(stockBox.min), max: rv(stockBox.max) },
    points,
    cases,
    features,
  };
}

// ─── placement session: the operations every product's UI calls ────────────

/** A pick on the target: the triangle under the cursor and the hit point, WORK coordinates (tri -1: the triangle nearest the point). */
export interface PlacementPick { tri: number; point?: PVec3 }

export type FaceButton = 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back' | 'center';

/**
 * Everything the Origin / WCS panels can do, as data, so the VS Code webview,
 * the VS Code commands, CAM's Setup/WCS panel and the hub run the same code.
 * Picks name a triangle of the target mesh as drawn; triangle order never
 * changes under a placement, so the kernel fits the feature in PART
 * coordinates and answers in WORK coordinates.
 */
export type PlacementOp =
  | { op: 'boxPoint'; sel: BoxPointSel; ref?: BoxRef }
  | { op: 'preset'; id: string; ref?: BoxRef }
  | { op: 'face'; face: FaceButton; ref?: BoxRef }
  | { op: 'rotate'; axis: Axis; turns?: number }
  | { op: 'flip'; axis?: Axis }
  /** Planar face: 'axis' = the axis along its normal gets 0 on the face; 'origin' = WCS at the face centre; 'alignTop' / 'alignBottom' = turn its normal to +Z / -Z. */
  | { op: 'pickFace'; pick: PlacementPick; action: 'axis' | 'origin' | 'alignTop' | 'alignBottom' }
  /** Bore / boss: centre on its axis; align also turns that axis onto Z. */
  | { op: 'pickCylinder'; pick: PlacementPick; align?: boolean }
  /** Vertex / edge: WCS at the nearest vertex or edge midpoint of the picked triangle. */
  | { op: 'pickPoint'; pick: PlacementPick }
  | { op: 'midpoint'; picks: [PlacementPick, PlacementPick] }
  | { op: 'circle3'; picks: [PlacementPick, PlacementPick, PlacementPick]; align?: boolean }
  | { op: 'alignAxis'; from: AxisName; to: AxisName }
  | { op: 'offset'; d: PVec3; rotZ?: number }
  /** Centre the target in the stock the setup states (same stock size, equal offsets each side). */
  | { op: 'centerInStock'; axes?: 'xy' | 'xyz' }
  /** Look at a feature without moving anything (view normal to a face, hover highlight). */
  | { op: 'inspect'; pick: PlacementPick }
  | { op: 'undo' }
  | { op: 'reset' };

type StockOffsets = NonNullable<RevPackSetup['stockOffsets']>;

export interface PlacementSession {
  placement: Placement;
  /** Setup stock offsets after a centre-in-stock (undefined: the pack's own). */
  stockOffsets?: StockOffsets;
  history: Array<{ placement: Placement; stockOffsets?: StockOffsets }>;
}

/** The target as the session needs it, PART coordinates. */
export interface PlacementInput {
  positions?: ArrayLike<number>;
  bounds: PBounds;
  adjacency?: number[][];
  setup?: Pick<RevPackSetup, 'stockOffsets' | 'barOffsets'>;
  /** A fixed stock (no setup offsets), PART coordinates. */
  stockBounds?: PBounds;
  lathe?: boolean;
}

/** A picked feature, WORK coordinates after the operation (for highlight, view-normal and the readout). */
export interface FeatureView {
  kind: 'plane' | 'cylinder' | 'point';
  triangles: number[];
  point: PVec3;
  normal?: PVec3;
  axisDir?: PVec3;
  radius?: number;
  bore?: boolean;
  label: string;
}

export interface PlacementResult {
  session: PlacementSession;
  feature?: FeatureView;
  /** Why the operation did nothing (no triangles, not a cylinder, nothing to undo...). */
  error?: string;
  changed: boolean;
}

export function newPlacementSession(): PlacementSession {
  return { placement: identityPlacement(), history: [] };
}

const HISTORY_LIMIT = 50;

function contextOf(input: PlacementInput, session: PlacementSession): PlacementContext {
  const setup = input.setup ? { ...input.setup, ...(session.stockOffsets ? { stockOffsets: session.stockOffsets } : {}) } : (session.stockOffsets ? { stockOffsets: session.stockOffsets } : undefined);
  return { geometry: { positions: input.positions, bounds: input.bounds }, setup, stockBounds: input.stockBounds, lathe: input.lathe };
}

/** The pick's triangle vertices and edge midpoints, PART coordinates. */
function snapCandidates(positions: ArrayLike<number>, tri: number): PVec3[] {
  const i = tri * 9;
  const v: PVec3[] = [0, 1, 2].map(k => [positions[i + k * 3], positions[i + k * 3 + 1], positions[i + k * 3 + 2]] as PVec3);
  return [...v, midpoint(v[0], v[1]), midpoint(v[1], v[2]), midpoint(v[2], v[0])];
}

/** The vertex or edge midpoint of the picked triangle nearest the hit point, PART coordinates. */
export function snapPick(positions: ArrayLike<number>, placement: Placement, pick: PlacementPick): PVec3 | undefined {
  const count = Math.floor(positions.length / 9);
  if (!(pick.tri >= 0 && pick.tri < count)) return undefined;
  const cands = snapCandidates(positions, pick.tri);
  if (!pick.point) return cands[0];
  const hit = workToPart(placement, pick.point);
  let best = cands[0], bestD = Infinity;
  for (const c of cands) { const d = length(sub(c, hit)); if (d < bestD) { bestD = d; best = c; } }
  return best;
}

function featureView(fit: FeatureFit, p: Placement): FeatureView {
  if (fit.kind === 'plane') {
    const normal = cleanV(partDirToWork(p, fit.normal), 6);
    return { kind: 'plane', triangles: fit.triangles, point: cleanV(partToWork(p, fit.point), 6), normal, label: `planar face (normal ${nearestAxis(normal).name}${Math.abs(normal[nearestAxis(normal).axis]) > 1 - 1e-6 ? '' : ', tilted'})` };
  }
  const axisDir = cleanV(partDirToWork(p, fit.axisDir), 6);
  return {
    kind: 'cylinder', triangles: fit.triangles, point: cleanV(partToWork(p, fit.axisPoint), 6), axisDir, radius: fit.radius, bore: fit.bore,
    label: `${fit.bore ? 'bore' : 'boss'} dia ${clean(fit.radius * 2, 4)} (axis ${nearestAxis(axisDir).name.replace('+', '')})`,
  };
}

/** Closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5). */
export function closestPointOnTriangle(p: PVec3, a: PVec3, b: PVec3, c: PVec3): PVec3 {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scale(ab, d1 / (d1 - d3)));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scale(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, scale(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  const denom = 1 / (va + vb + vc);
  return add(a, add(scale(ab, vb * denom), scale(ac, vc * denom)));
}

/** The triangle nearest a point (PART coordinates): a pick given as a point on the part instead of a triangle index. */
export function nearestTriangle(positions: ArrayLike<number>, point: PVec3): number {
  let best = -1, bestD = Infinity;
  for (let t = 0; t + 8 < positions.length; t += 9) {
    const a: PVec3 = [positions[t], positions[t + 1], positions[t + 2]];
    const b: PVec3 = [positions[t + 3], positions[t + 4], positions[t + 5]];
    const c: PVec3 = [positions[t + 6], positions[t + 7], positions[t + 8]];
    const d = length(sub(closestPointOnTriangle(point, a, b, c), point));
    if (d < bestD - 1e-12) { bestD = d; best = t / 9; }
  }
  return best;
}

/** A pick by point only (tri < 0): the triangle under that WORK point. */
function resolvePick(pick: PlacementPick, positions: ArrayLike<number> | undefined, p: Placement): PlacementPick {
  if (pick.tri >= 0 || !pick.point || !positions) return pick;
  return { tri: nearestTriangle(positions, workToPart(p, pick.point)), point: pick.point };
}

/** Run one Origin / WCS operation. Pure: the session passed in is not changed. */
export function runPlacementOp(session: PlacementSession, input: PlacementInput, op: PlacementOp): PlacementResult {
  const cur = session.placement;
  if ('pick' in op && op.pick) op = { ...op, pick: resolvePick(op.pick, input.positions, cur) } as PlacementOp;
  if ('picks' in op && op.picks) op = { ...op, picks: op.picks.map(p => resolvePick(p, input.positions, cur)) } as PlacementOp;
  const ctx = contextOf(input, session);
  const done = (placement: Placement, feature?: FeatureView, stockOffsets: StockOffsets | undefined = session.stockOffsets): PlacementResult => {
    const history = [...session.history, { placement: cur, ...(session.stockOffsets ? { stockOffsets: session.stockOffsets } : {}) }].slice(-HISTORY_LIMIT);
    return { session: { placement, ...(stockOffsets ? { stockOffsets } : {}), history }, feature, changed: true };
  };
  const fail = (error: string): PlacementResult => ({ session, error, changed: false });
  const needMesh = (): ArrayLike<number> | undefined => (input.positions && input.positions.length >= 9 ? input.positions : undefined);
  const adjacency = () => input.adjacency ?? (input.adjacency = triangleAdjacency(input.positions!));
  const fitAt = (pick: PlacementPick): FeatureFit | undefined => pickFeature(input.positions!, pick.tri, { adjacency: adjacency() });

  switch (op.op) {
    case 'boxPoint':
      return done(placeAtBoxPoint(cur, ctx, op.sel, op.ref ?? 'part'));
    case 'preset': {
      const preset = PLACEMENT_PRESETS.find(item => item.id === op.id);
      if (!preset) return fail(`unknown preset ${op.id}`);
      return done(placeAtBoxPoint(cur, ctx, preset.sel, op.ref ?? 'part'));
    }
    case 'face': {
      if (op.face === 'center') return done(placeAtBoxPoint(cur, ctx, { x: 0, y: 0, z: 0 }, op.ref ?? 'part'));
      const button = FACE_BUTTONS.find(item => item.id === op.face)!;
      return done(placeAxisAtBox(cur, ctx, button.axis, button.side, op.ref ?? 'part'));
    }
    case 'rotate':
      return done(rotate90(cur, op.axis, op.turns ?? 1, ctx));
    case 'flip':
      return done(flip(cur, op.axis ?? 0, ctx));
    case 'alignAxis':
      return done(rotateAboutOrigin(cur, rotationAligning(axisVector(op.from), axisVector(op.to)), ctx));
    case 'offset':
      return done(shiftOrigin(cur, op.d, op.rotZ ?? 0, ctx));
    case 'centerInStock': {
      const offsets = session.stockOffsets ?? input.setup?.stockOffsets;
      if (!offsets) return fail('the setup states no stock offsets: the stock is fixed, so the target already moves with it');
      const centred = centeredStockOffsets(offsets, op.axes ?? 'xy');
      const next = { ...session, stockOffsets: centred };
      const reCtx = contextOf(input, next);
      const placement = cur.anchor?.kind === 'box' && cur.anchor.ref === 'stock' ? placeAtBoxPoint(cur, reCtx, cur.anchor.point, 'stock') : cur;
      return done(placement, undefined, centred);
    }
    case 'pickFace': {
      const mesh = needMesh();
      if (!mesh) return fail('no target triangles to pick');
      const fit = fitAt(op.pick);
      if (!fit) return fail('nothing under the pick');
      const plane = fit.kind === 'plane' ? fit : fitPlane(mesh, [op.pick.tri]);
      const nWork = partDirToWork(cur, plane.normal);
      const pWork = partToWork(cur, plane.point);
      let next: Placement;
      if (op.action === 'axis') {
        const ax = nearestAxis(nWork).axis;
        const mask: [boolean, boolean, boolean] = [ax === 0, ax === 1, ax === 2];
        next = placeAtPoint(cur, pWork, mask, `${'XYZ'[ax]}0 on the picked face`, ctx);
      } else if (op.action === 'origin') {
        next = placeAtPoint(cur, pWork, [true, true, true], 'picked face centre', ctx);
      } else {
        next = alignVectorTo(cur, nWork, op.action === 'alignTop' ? '+Z' : '-Z', ctx);
        next = { ...next, label: next.anchor?.kind === 'box' ? next.label : `picked face turned to the ${op.action === 'alignTop' ? 'top' : 'bottom'}` };
      }
      return done(next, featureView(plane, next));
    }
    case 'pickCylinder': {
      if (!needMesh()) return fail('no target triangles to pick');
      const fit = fitAt(op.pick);
      if (!fit || fit.kind !== 'cylinder') return fail('the pick is not on a bore or boss');
      const next = centerOnAxis(cur, partToWork(cur, fit.axisPoint), partDirToWork(cur, fit.axisDir), { align: op.align, ctx });
      return done({ ...next, label: `${fit.bore ? 'bore' : 'boss'} axis (dia ${clean(fit.radius * 2, 4)})${op.align ? ', axis turned to Z, Z0 on top' : ''}` }, featureView(fit, next));
    }
    case 'pickPoint': {
      const mesh = needMesh();
      if (!mesh) return fail('no target triangles to pick');
      const at = snapPick(mesh, cur, op.pick);
      if (!at) return fail('nothing under the pick');
      const next = placeAtPoint(cur, partToWork(cur, at), [true, true, true], 'picked vertex / edge point', ctx);
      return done(next, { kind: 'point', triangles: [op.pick.tri], point: cleanV(partToWork(next, at), 6), label: 'vertex / edge point' });
    }
    case 'midpoint': {
      const mesh = needMesh();
      if (!mesh) return fail('no target triangles to pick');
      const a = snapPick(mesh, cur, op.picks[0]), b = snapPick(mesh, cur, op.picks[1]);
      if (!a || !b) return fail('pick two points on the target');
      const m = midpoint(partToWork(cur, a), partToWork(cur, b));
      const next = placeAtPoint(cur, m, [true, true, true], 'midpoint of two picked points', ctx);
      return done(next, { kind: 'point', triangles: op.picks.map(p => p.tri), point: [0, 0, 0], label: 'two-point midpoint' });
    }
    case 'circle3': {
      const mesh = needMesh();
      if (!mesh) return fail('no target triangles to pick');
      const pts = op.picks.map(p => snapPick(mesh, cur, p));
      if (pts.some(p => !p)) return fail('pick three points on the target');
      const w = pts.map(p => partToWork(cur, p!));
      const circle = circleFrom3Points(w[0], w[1], w[2]);
      if (!circle) return fail('the three points are in a line');
      const next = centerOnAxis(cur, circle.center, circle.normal, { align: op.align, ctx });
      return done({ ...next, label: `centre of a circle through 3 points (dia ${clean(circle.radius * 2, 4)})` }, {
        kind: 'cylinder', triangles: op.picks.map(p => p.tri), point: cleanV(partToWork(next, workToPart(cur, circle.center)), 6),
        axisDir: cleanV(partDirToWork(next, mulVec(transpose(cur.rotation), circle.normal)), 6), radius: circle.radius, label: '3-point circle',
      });
    }
    case 'inspect': {
      if (!needMesh()) return fail('no target triangles to pick');
      const fit = fitAt(op.pick);
      if (!fit) return fail('nothing under the pick');
      return { session, feature: featureView(fit, cur), changed: false };
    }
    case 'undo': {
      const last = session.history[session.history.length - 1];
      if (!last) return fail('nothing to undo');
      return { session: { placement: last.placement, ...(last.stockOffsets ? { stockOffsets: last.stockOffsets } : {}), history: session.history.slice(0, -1) }, changed: true };
    }
    case 'reset':
      return done(identityPlacement());
    default:
      return fail(`unknown operation ${(op as { op?: string }).op}`);
  }
}

/** The target's WORK bounds sit inside the stock's (the rule every move keeps). */
export function targetInsideStock(target: PBounds, stock: PBounds, tol = 1e-6): boolean {
  for (let k = 0; k < 3; k++) if (target.min[k] < stock.min[k] - tol || target.max[k] > stock.max[k] + tol) return false;
  return true;
}

// ─── the .jbl job file ───────────────────────────────────────────────────────

/**
 * `.jbl`: a JobLine job as one file - the RevPack as imported, the setup made
 * on it (placement, stock offsets) and the target STL inside, so a part set up
 * in jobline.ai-CAM opens with the same origin in the VS Code extension and
 * the hub. Every host re-applies `setup.placement` to `pack` with
 * applyPlacementToPack (this kernel), so the stock, vise / jaws, G54 and
 * part-zero text are recomputed the same way everywhere; `placedPack` and the
 * readout are written too, for a person or a host without the kernel, and are
 * what the round-trip tests compare against.
 *
 * `post` says whether the program still matches the setup: a placement other
 * than the one the program was posted for means the program must be RE-POSTED
 * (re-checking the old program against the moved setup is not enough).
 */
export const JBL_SCHEMA = 'jobline.jbl/1';
export const JBL_EXTENSION = '.jbl';

export interface JblJob {
  schema: typeof JBL_SCHEMA;
  extension: '.jbl';
  name: string;
  units: 'in' | 'mm';
  createdBy?: string;
  /** The RevPack as imported, before this setup's move. Absent for a part uploaded on its own. */
  pack?: RevPack;
  setup: {
    placement: Placement;
    /** Stock offsets after a centre-in-stock (absent: the pack's / upload setup's own). */
    stockOffsets?: StockOffsets;
    /** Results of the placement, as computed by the host that wrote the file. */
    partZero: string;
    workOffset?: { name: string; x: number; y: number; z: number };
    /** Row-major 3x4 PART -> WORK for the target. */
    targetTransform: number[];
    partBox: PBounds;
    stockBox: PBounds;
    readout: ReturnType<typeof originReadout>;
  };
  /** The pack after the move: stock, workholding, work offsets and setup (partZero, stockOffsets). */
  placedPack?: RevPack;
  /** The target in PART coordinates (STL bytes, base64). */
  target?: { file: string; format: 'stl'; base64: string };
  post: {
    /** setupDigest of this setup. */
    setupDigest: string;
    /** setupDigest the program was posted for (absent: nothing posted yet). */
    postedDigest?: string;
    needsRepost: boolean;
    program?: string;
  };
}

/** A stable id of the WCS / orientation a program is posted for (rotation + origin, rounded). */
export function setupDigest(placement: Placement): string {
  const r = (v: number) => clean(v, 6);
  return `R${placement.rotation.map(r).join(',')};O${placement.origin.map(r).join(',')}`;
}

/** Whether a program posted for `postedDigest` must be re-posted for `placement`. */
export function needsRepost(placement: Placement, postedDigest: string | undefined): boolean {
  return postedDigest !== undefined && postedDigest !== setupDigest(placement);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64Encode(bytes: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

export function base64Decode(text: string): Uint8Array {
  const clean64 = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean64.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean64.length; i += 4) {
    const n = (B64.indexOf(clean64[i]) << 18) | (B64.indexOf(clean64[i + 1]) << 12) | ((i + 2 < clean64.length ? B64.indexOf(clean64[i + 2]) : 0) << 6) | (i + 3 < clean64.length ? B64.indexOf(clean64[i + 3]) : 0);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (i + 2 < clean64.length && o < out.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean64.length && o < out.length) out[o++] = n & 255;
  }
  return out;
}

export interface JblInput {
  name: string;
  units: 'in' | 'mm';
  pack?: RevPack;
  /** Setup of a part uploaded without a pack (revpack.ts uploadSetup). */
  uploadSetup?: Pick<RevPackSetup, 'stockOffsets' | 'barOffsets' | 'partZero'>;
  /** Target triangles and bounds, PART coordinates. */
  positions?: ArrayLike<number>;
  bounds: PBounds;
  targetStl?: ArrayLike<number>;
  targetFile?: string;
  session: Pick<PlacementSession, 'placement' | 'stockOffsets'>;
  /** setupDigest the program was posted for; a pack's own program defaults to the pack as imported. */
  postedDigest?: string;
  createdBy?: string;
}

/** The .jbl for a target and its setup session. */
export function buildJbl(input: JblInput): JblJob {
  const p = input.session.placement;
  const geometry: PartGeometry = { positions: input.positions, bounds: input.bounds };
  const posted = input.postedDigest ?? (input.pack?.program?.file ? setupDigest(identityPlacement()) : undefined);
  const placementOut: Placement = { rotation: [...p.rotation] as PMat3, origin: [...p.origin] as PVec3, ...(p.anchor ? { anchor: p.anchor } : {}), ...(p.label ? { label: p.label } : {}) };
  let setup: JblJob['setup'];
  let placedPackOut: RevPack | undefined;
  if (input.pack) {
    const pack = input.session.stockOffsets && input.pack.setup ? { ...input.pack, setup: { ...input.pack.setup, stockOffsets: input.session.stockOffsets } } : input.pack;
    const placed = applyPlacementToPack(pack, input.bounds, p, { positions: input.positions });
    const w = placed.workOffset ? placed.pack.workOffsets[placed.workOffset] : undefined;
    const workOffset = w && placed.workOffset ? { name: placed.workOffset, x: w.x, y: w.y ?? 0, z: w.z } : undefined;
    placedPackOut = placed.pack;
    setup = {
      placement: placementOut,
      ...(input.session.stockOffsets ? { stockOffsets: input.session.stockOffsets } : {}),
      partZero: placed.pack.setup?.partZero ?? (p.label ?? 'part file origin'),
      ...(workOffset ? { workOffset } : {}),
      targetTransform: placed.targetTransform,
      partBox: placed.targetBounds,
      stockBox: placed.stockBounds,
      readout: originReadout(geometry, p, workOffset),
    };
  } else {
    const partBox = placedBounds(geometry, p);
    const offsets = input.session.stockOffsets ?? input.uploadSetup?.stockOffsets;
    const stockBox = setupStockBounds(offsets ? { stockOffsets: offsets } : undefined, partBox) ?? partBox;
    setup = {
      placement: placementOut,
      ...(input.session.stockOffsets ? { stockOffsets: input.session.stockOffsets } : {}),
      partZero: isIdentityPlacement(p) ? (input.uploadSetup?.partZero ?? 'part file origin') : `WCS on the ${p.label ?? 'part, re-oriented'} (placed in JobLine)`,
      targetTransform: placementMatrix(p),
      partBox: { min: cleanV(partBox.min, 7), max: cleanV(partBox.max, 7) },
      stockBox: { min: cleanV(stockBox.min, 7), max: cleanV(stockBox.max, 7) },
      readout: originReadout(geometry, p),
    };
  }
  const digest = setupDigest(p);
  return {
    schema: JBL_SCHEMA,
    extension: '.jbl',
    name: input.name,
    units: input.units,
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    ...(input.pack ? { pack: input.pack } : {}),
    setup,
    ...(placedPackOut ? { placedPack: placedPackOut } : {}),
    ...(input.targetStl ? { target: { file: input.targetFile ?? 'target.stl', format: 'stl' as const, base64: base64Encode(input.targetStl) } } : {}),
    post: { setupDigest: digest, ...(posted ? { postedDigest: posted } : {}), needsRepost: needsRepost(p, posted), ...(input.pack?.program?.file ? { program: input.pack.program.file } : {}) },
  };
}

/** Text of a .jbl file. */
export function serializeJbl(jbl: JblJob): string {
  return JSON.stringify(jbl, null, 1) + '\n';
}

/** Read a .jbl file's text. */
export function parseJbl(text: string): { ok: true; jbl: JblJob } | { ok: false; errors: string[] } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (err) { return { ok: false, errors: [`not JSON: ${(err as Error).message}`] }; }
  const errors: string[] = [];
  const j = raw as Partial<JblJob>;
  if (!j || typeof j !== 'object') return { ok: false, errors: ['not an object'] };
  if (j.schema !== JBL_SCHEMA) errors.push(`schema must be "${JBL_SCHEMA}"`);
  if (j.units !== 'in' && j.units !== 'mm') errors.push('units must be "in" or "mm"');
  const pl = j.setup?.placement;
  if (!pl || !Array.isArray(pl.rotation) || pl.rotation.length !== 9 || !Array.isArray(pl.origin) || pl.origin.length !== 3 || [...pl.rotation, ...pl.origin].some(v => typeof v !== 'number' || !Number.isFinite(v))) errors.push('setup.placement needs rotation[9] and origin[3]');
  if (j.target && (j.target.format !== 'stl' || typeof j.target.base64 !== 'string')) errors.push('target must be { format: "stl", base64 }');
  if (j.pack && (typeof j.pack !== 'object' || !j.pack.stock || !j.pack.workOffsets)) errors.push('pack is not a RevPack');
  return errors.length ? { ok: false, errors } : { ok: true, jbl: j as JblJob };
}

/** The setup session a .jbl carries (no undo history). */
export function jblSession(jbl: JblJob): PlacementSession {
  const p = jbl.setup.placement;
  return { placement: { rotation: [...p.rotation] as PMat3, origin: [...p.origin] as PVec3, ...(p.anchor ? { anchor: p.anchor } : {}), ...(p.label ? { label: p.label } : {}) }, ...(jbl.setup.stockOffsets ? { stockOffsets: jbl.setup.stockOffsets } : {}), history: [] };
}

/** The target STL bytes inside a .jbl, or undefined. */
export function jblTargetStl(jbl: JblJob): Uint8Array | undefined {
  return jbl.target ? base64Decode(jbl.target.base64) : undefined;
}
