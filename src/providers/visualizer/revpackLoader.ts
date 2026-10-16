/**
 * Finding and loading the RevPack that belongs to an open program.
 *
 * Kept free of the `vscode` module so the discovery rules and the message
 * set are unit-testable; extension.ts only wires the results into the
 * visualizer and the Problems panel.
 *
 * Discovery, nearest first:
 *   1. <program dir>/revpack.json
 *   2. <program dir>/revpack/revpack.json
 *   3. for each parent: <parent>/revpack/revpack.json, then
 *      <parent>/revpack/<sub>/revpack.json whose program.file is this program
 * A pack whose program.file names a DIFFERENT program is skipped, so a
 * folder of several programs never borrows the wrong setup. Discovery stops
 * at the workspace root (or 6 levels up) so it never scans the whole disk.
 *
 * "Load RevPack…" also opens a `.jbl` job file written by jobline.ai-CAM
 * (revpackPlacement.ts buildJbl): the pack as imported, the Setup / WCS made
 * on it and the target STL in one file. The pack is drawn through the same
 * Origin-panel session the setup describes, so VS Code shows CAM's origin,
 * G54 and stock.
 */

import * as fs from 'fs';
import * as path from 'path';
import { targetStlFile, validateRevPack, type RevPack } from './revpack';
import { correlateProgramWithRevPack, type CorrelationReport } from './revpackCorrelation';
import { buildRevPackSimulationMessages, type SimulationSetupMessage } from './simulationSetup';
import { buildRevPackGeometry, loadStl, type GeoMesh, type RevPackGeometry } from './revpackGeometry';
import type { VisualizerHarnessData } from './fixtureHarness';
import { tessellateSTEP } from './stepTessellator';
import { jblSession, jblTargetStl, parseJbl, transformPositions, type JblJob, type PlacementSession } from './revpackPlacement';
import { placedPack, type PlacementTarget } from './revpackPlacementHost';

export interface LoadedRevPack {
  pack: RevPack;
  /** Absolute path of the revpack.json (or the .jbl). */
  file: string;
  dir: string;
  /** A .jbl: the job file, its target STL bytes and the setup session it carries. */
  jbl?: JblJob;
  targetStl?: Uint8Array;
  placement?: PlacementSession;
}

const MAX_PARENT_LEVELS = 6;

function programMatches(pack: RevPack, programPath: string): boolean {
  const named = pack.program?.file;
  if (!named) return true;
  return path.basename(named).toLowerCase() === path.basename(programPath).toLowerCase();
}

export function readRevPack(file: string): LoadedRevPack {
  if (file.toLowerCase().endsWith('.jbl')) return readJbl(file);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const validation = validateRevPack(raw);
  if (!validation.ok) {
    throw new Error(`${path.basename(file)} is not a valid RevPack: ${validation.errors.join('; ')}`);
  }
  return { pack: raw as RevPack, file: path.resolve(file), dir: path.dirname(path.resolve(file)) };
}

/** A .jbl job file from jobline.ai-CAM: its pack, target STL and Setup / WCS session. */
export function readJbl(file: string): LoadedRevPack {
  const parsed = parseJbl(fs.readFileSync(file, 'utf8'));
  if (!parsed.ok) throw new Error(`${path.basename(file)} is not a JobLine .jbl: ${parsed.errors.join('; ')}`);
  const jbl = parsed.jbl;
  if (!jbl.pack) throw new Error(`${path.basename(file)} holds a part set up on its own (no RevPack): open its program with a RevPack, or upload the part in the visualizer`);
  const validation = validateRevPack(jbl.pack);
  if (!validation.ok) throw new Error(`${path.basename(file)} carries an invalid RevPack: ${validation.errors.join('; ')}`);
  return { pack: jbl.pack, file: path.resolve(file), dir: path.dirname(path.resolve(file)), jbl, targetStl: jblTargetStl(jbl), placement: jblSession(jbl) };
}

/**
 * A .jbl that holds a part set up on its own (CAM's Setup / WCS on an uploaded
 * STL, no RevPack): its target STL and setup session, or undefined when the
 * file carries a pack (use readJbl) or no part.
 */
export function readPartOnlyJbl(file: string): { jbl: JblJob; targetStl: Uint8Array; placement: PlacementSession; name: string } | undefined {
  const parsed = parseJbl(fs.readFileSync(file, 'utf8'));
  if (!parsed.ok) throw new Error(`${path.basename(file)} is not a JobLine .jbl: ${parsed.errors.join('; ')}`);
  const jbl = parsed.jbl;
  if (jbl.pack) return undefined;
  const targetStl = jblTargetStl(jbl);
  if (!targetStl || targetStl.length < 84) throw new Error(`${path.basename(file)} has no pack and no part to show`);
  return { jbl, targetStl, placement: jblSession(jbl), name: jbl.target?.file ?? path.basename(file, path.extname(file)) + '.stl' };
}

/** The pack's target STL: inside a .jbl, or the file the pack names. */
function targetStlBytes(loaded: LoadedRevPack): { bytes: Uint8Array; name: string } | undefined {
  if (loaded.targetStl) return { bytes: loaded.targetStl, name: loaded.jbl?.target?.file ?? 'target.stl' };
  const stl = targetStlFile(loaded.pack);
  if (!stl) return undefined;
  const file = path.resolve(loaded.dir, stl);
  if (!fs.existsSync(file)) return undefined;
  return { bytes: fs.readFileSync(file), name: path.basename(file) };
}

function tryRead(file: string, programPath: string): LoadedRevPack | undefined {
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return undefined;
    const loaded = readRevPack(file);
    return programMatches(loaded.pack, programPath) ? loaded : undefined;
  } catch {
    return undefined;
  }
}

/** The RevPack for `programPath`, or undefined when none is beside it. */
export function findRevPackForProgram(programPath: string, stopAt?: string): LoadedRevPack | undefined {
  const programDir = path.dirname(path.resolve(programPath));
  const direct = tryRead(path.join(programDir, 'revpack.json'), programPath)
    ?? tryRead(path.join(programDir, 'revpack', 'revpack.json'), programPath);
  if (direct) return direct;

  const stop = stopAt ? path.resolve(stopAt).toLowerCase() : undefined;
  let dir = path.dirname(programDir);
  for (let level = 0; level < MAX_PARENT_LEVELS; level++) {
    const packDir = path.join(dir, 'revpack');
    const top = tryRead(path.join(packDir, 'revpack.json'), programPath);
    if (top) return top;
    try {
      if (fs.existsSync(packDir) && fs.statSync(packDir).isDirectory()) {
        for (const entry of fs.readdirSync(packDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const nested = tryRead(path.join(packDir, entry.name, 'revpack.json'), programPath);
          if (nested && nested.pack.program?.file) return nested;
        }
      }
    } catch {
      // unreadable folder - keep walking up
    }
    if (stop && dir.toLowerCase() === stop) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export interface RevPackTargetMessage {
  type: 'targetModel';
  id: string;
  targetId: string;
  role: 'target-part';
  displayMode: 'transparent' | 'solid' | 'wireframe';
  opacity: number;
  name: string;
  format: string;
  pointCount: number;
  meshVertices: number[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  offset: { x: number; y: number; z: number };
  source: 'revpack';
  /** How the triangles were produced: the shared kernel's STL reader or OpenCascade (STEP). */
  loader: 'stl' | 'step-occt';
  /** Placed (Origin panel): the triangles before the move, PART coordinates. */
  partMeshVertices?: number[];
  placed?: boolean;
  /** STEP only: its tessellation's bounds against the pack's STL of the same solid. */
  stlCrossCheck?: { maxBoundsDelta: number; ok: boolean; stlTriangles: number; stepTriangles: number };
}

type MsgBounds = RevPackTargetMessage['bounds'];
const toMsgBounds = (b: { min: number[]; max: number[] }): MsgBounds =>
  ({ minX: b.min[0], minY: b.min[1], minZ: b.min[2], maxX: b.max[0], maxY: b.max[1], maxZ: b.max[2] });

/**
 * The pack's target as the visualizer's targetModel message, from its STL
 * (the target itself, or the STL beside a STEP target). Drawn as an opaque
 * solid: the stock goes translucent over it.
 */
export function revPackTargetMessage(loaded: LoadedRevPack): RevPackTargetMessage | undefined {
  const stl = targetStlBytes(loaded);
  if (!stl) return undefined;
  // The shared kernel's STL reader - the same triangles CAM and the hub draw.
  const mesh = loadStl(stl.bytes);
  return {
    type: 'targetModel',
    id: 'revpack-target',
    targetId: 'target-part',
    role: 'target-part',
    displayMode: 'solid',
    opacity: 1,
    name: `${stl.name} (RevPack target)`,
    format: `STL ${mesh.format}`,
    pointCount: mesh.triangleCount * 3,
    meshVertices: Array.from(mesh.positions),
    bounds: toMsgBounds(mesh.bounds),
    offset: { x: 0, y: 0, z: 0 },
    source: 'revpack',
    loader: 'stl',
  };
}

/** A target message moved by a row-major 3x4 placement transform (triangles, bounds; the part-coordinate triangles kept for picks). */
export function moveTargetMessage(message: RevPackTargetMessage | undefined, m: number[]): RevPackTargetMessage | undefined {
  if (!message) return undefined;
  const part = new Float32Array(message.meshVertices);
  const moved = transformPositions(part, m);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i + 2 < moved.length; i += 3) {
    minX = Math.min(minX, moved[i]); maxX = Math.max(maxX, moved[i]);
    minY = Math.min(minY, moved[i + 1]); maxY = Math.max(maxY, moved[i + 1]);
    minZ = Math.min(minZ, moved[i + 2]); maxZ = Math.max(maxZ, moved[i + 2]);
  }
  return { ...message, meshVertices: Array.from(moved), bounds: { minX, minY, minZ, maxX, maxY, maxZ }, partMeshVertices: message.meshVertices, placed: true };
}

/** Largest difference between two bounds, in model units. */
export function boundsDelta(a: MsgBounds, b: MsgBounds): number {
  return Math.max(...(['minX', 'minY', 'minZ', 'maxX', 'maxY', 'maxZ'] as const).map(k => Math.abs(a[k] - b[k])));
}

/**
 * A STEP target read through OpenCascade (occt-import-js), in the pack's
 * units, cross-checked against the pack's STL of the same solid. Undefined
 * when the pack's target is not STEP or the file is missing.
 */
const stepCache = new Map<string, { mtime: number; result: Awaited<ReturnType<typeof tessellateSTEP>> }>();

export async function revPackStepTargetMessage(loaded: LoadedRevPack, targetTransform?: number[]): Promise<RevPackTargetMessage | undefined> {
  const target = loaded.pack.target;
  if (!target || target.format !== 'step') return undefined;
  const file = path.resolve(loaded.dir, target.file);
  if (!fs.existsSync(file)) return undefined;
  // OpenCascade is slow; a placement change re-sends the same tessellation moved.
  const mtime = fs.statSync(file).mtimeMs;
  let step = stepCache.get(file)?.mtime === mtime ? stepCache.get(file)!.result : undefined;
  if (!step) {
    step = await tessellateSTEP(new Uint8Array(fs.readFileSync(file)), { linearUnit: loaded.pack.units === 'in' ? 'inch' : 'millimeter' });
    stepCache.set(file, { mtime, result: step });
  }
  if (targetTransform) return moveTargetMessage(await revPackStepTargetMessage(loaded), targetTransform);
  const message: RevPackTargetMessage = {
    type: 'targetModel',
    id: 'revpack-target',
    targetId: 'target-part',
    role: 'target-part',
    displayMode: 'solid',
    opacity: 1,
    name: `${path.basename(file)} (RevPack target)`,
    format: 'STEP (OpenCascade)',
    pointCount: step.triangleCount * 3,
    meshVertices: step.meshVertices,
    bounds: step.bounds,
    offset: { x: 0, y: 0, z: 0 },
    source: 'revpack',
    loader: 'step-occt',
  };
  const stl = revPackTargetMessage(loaded);
  if (stl && target.stl) {
    const delta = boundsDelta(stl.bounds, step.bounds);
    const size = Math.max(stl.bounds.maxX - stl.bounds.minX, stl.bounds.maxY - stl.bounds.minY, stl.bounds.maxZ - stl.bounds.minZ);
    message.stlCrossCheck = { maxBoundsDelta: delta, ok: delta <= size * 0.002, stlTriangles: stl.pointCount / 3, stepTriangles: step.triangleCount };
  }
  return message;
}

export interface RevPackFindingsMessage {
  type: 'revpackFindings';
  packId: string;
  summary: CorrelationReport['summary'];
  checks: CorrelationReport['checks'];
  /** line is 1-based, as the correlation reports it. */
  findings: CorrelationReport['findings'];
}

export function revPackFindingsMessage(report: CorrelationReport): RevPackFindingsMessage {
  return { type: 'revpackFindings', packId: report.packId, summary: report.summary, checks: report.checks, findings: report.findings };
}

/** A shared-kernel mesh as plain arrays, for postMessage. */
export interface WireMesh { positions: number[]; edges: number[]; triangles: number }

const wire = (mesh: GeoMesh): WireMesh => ({ positions: Array.from(mesh.positions), edges: Array.from(mesh.edges), triangles: mesh.triangleCount });

/**
 * Every solid layer the webview draws for a pack, built by the shared kernel
 * (revpackGeometry.ts, identical in CAM and the hub). The webview only turns
 * these arrays into Three.js meshes and line work; it builds no pack geometry
 * of its own.
 */
export interface RevPackSceneMessage {
  type: 'revpackScene';
  packId: string;
  units: 'in' | 'mm';
  machineClass: string;
  stock: WireMesh;
  inProcess?: WireMesh & {
    removedVolume: number; stockVolume: number; skippedTilted: number;
    /** Comparison class per in-process triangle (0 on size, 1 remaining, 2 gouge). */
    triClass?: number[];
    comparison?: { onSize: number; remaining: number; gouge: number; maxRemaining: number; maxGouge: number; tolerance: number };
  };
  /** Each workholding solid with its role and viewer object (jaws, fixture, zeroPoint). */
  workholding: Array<{ name: string; role?: string; object: string } & WireMesh>;
  /** The gripped stock region (bottom grip depth of the stock), when the setup states one. */
  grip?: WireMesh;
  /** Stock placement from the setup, for the panel. */
  setup?: { partZero: string; gripDepth?: number; recommendedGripDepth?: number; vise?: string };
  tools: Array<{ t: number; kind: string; gaugeLength: number; stickOut: number; cutter: WireMesh; holder?: WireMesh }>;
}

export function revPackSceneMessage(geometry: RevPackGeometry, pack?: RevPack): RevPackSceneMessage {
  return {
    type: 'revpackScene',
    packId: geometry.packId,
    units: geometry.units,
    machineClass: geometry.machineClass,
    stock: wire(geometry.stock),
    inProcess: geometry.inProcess ? {
      ...wire(geometry.inProcess.mesh),
      removedVolume: geometry.inProcess.zmap.removedVolume,
      stockVolume: geometry.inProcess.zmap.stockVolume,
      skippedTilted: geometry.inProcess.zmap.skippedTilted,
      triClass: geometry.inProcess.mesh.triClass ? Array.from(geometry.inProcess.mesh.triClass) : undefined,
      comparison: geometry.inProcess.comparison ? {
        onSize: geometry.inProcess.comparison.onSize,
        remaining: geometry.inProcess.comparison.remaining,
        gouge: geometry.inProcess.comparison.gouge,
        maxRemaining: geometry.inProcess.comparison.maxRemaining,
        maxGouge: geometry.inProcess.comparison.maxGouge,
        tolerance: geometry.inProcess.comparison.tolerance,
      } : undefined,
    } : undefined,
    workholding: geometry.workholding.map(item => ({ name: item.name, role: item.role, object: item.object, ...wire(item.mesh) })),
    grip: geometry.grip ? wire(geometry.grip) : undefined,
    setup: pack?.setup ? {
      partZero: pack.setup.partZero,
      gripDepth: pack.setup.gripDepth,
      recommendedGripDepth: pack.workholdingSpec?.recommendedGripDepth,
      vise: pack.workholdingSpec ? `${pack.workholdingSpec.manufacturer} ${pack.workholdingSpec.model}${pack.workholdingSpec.itemNo ? ` (${pack.workholdingSpec.itemNo})` : ''}` : undefined,
    } : undefined,
    tools: geometry.tools.map(tool => ({
      t: tool.t, kind: tool.kind, gaugeLength: tool.gaugeLength, stickOut: tool.stickOut,
      cutter: wire(tool.cutter), holder: tool.holder ? wire(tool.holder) : undefined,
    })),
  };
}

export interface RevPackScene {
  setup: SimulationSetupMessage[];
  geometry: RevPackGeometry;
  sceneMessage: RevPackSceneMessage;
  target?: RevPackTargetMessage;
  findings: RevPackFindingsMessage;
  report: CorrelationReport;
  /** Cutter size for the swept tube: the first tool the program calls. */
  cutterSize: number;
  /** The target as the Origin panel picks on it (STL triangles, PART coordinates). */
  placementTarget?: PlacementTarget;
  /** Set when the Origin panel moved the part: PART -> WORK for the STEP target too. */
  targetTransform?: number[];
}

/** Everything the visualizer needs from a pack for one program. */
export function buildRevPackScene(loaded: LoadedRevPack, gcode: string, harnessTools: VisualizerHarnessData['tools'] = [], placement?: PlacementSession): RevPackScene {
  const targetStl = targetStlBytes(loaded)?.bytes;
  // Origin panel: the pack as placed (target transform, stock from the
  // setup around the moved target, vise / jaws following the stock, G54
  // moved the other way). Everything below draws and checks that pack.
  const partTarget = targetStl ? loadStl(targetStl) : undefined;
  const placed = placement && partTarget ? placedPack(loaded.pack, partTarget.bounds, partTarget.positions, placement) : undefined;
  const pack = (placed?.pack as RevPack | undefined) ?? loaded.pack;
  const setup = buildRevPackSimulationMessages(pack, harnessTools);
  for (const message of setup) {
    if (message.type === 'revpackInfo') message.source = loaded.file;
  }
  const report = correlateProgramWithRevPack(gcode, pack);
  const geometry = buildRevPackGeometry(pack, {
    targetStl,
    segments: report.segments,
    targetTransform: placed?.targetTransform,
  });
  const first = report.toolsUsed[0];
  const firstTool = pack.tools.find(tool => tool.t === first) ?? pack.tools[0];
  const target = revPackTargetMessage(loaded);
  return {
    setup,
    geometry,
    sceneMessage: revPackSceneMessage(geometry, pack),
    target: placed ? moveTargetMessage(target, placed.targetTransform) : target,
    findings: revPackFindingsMessage(report),
    report,
    cutterSize: firstTool?.diameter || (pack.units === 'mm' ? 6 : 0.25),
    placementTarget: partTarget ? { key: `revpack:${loaded.file}`, kind: 'revpack', name: loaded.pack.name || loaded.pack.id, units: loaded.pack.units, positions: partTarget.positions, bounds: partTarget.bounds, pack: loaded.pack } : undefined,
    targetTransform: placed?.targetTransform,
  };
}

/** Messages that take a previous pack's badge, findings and fixture off the panel. */
export function clearRevPackMessages(): unknown[] {
  return [
    { type: 'revpackInfo', id: '', name: '' },
    { type: 'revpackScene', packId: '' },
    { type: 'revpackWorkholding', units: 'in', shapes: [] },
    { type: 'revpackFindings', packId: '', findings: [], summary: { errors: 0, warnings: 0, infos: 0, pass: true } },
  ];
}
