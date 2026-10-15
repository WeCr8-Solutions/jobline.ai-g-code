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
 */

import * as fs from 'fs';
import * as path from 'path';
import { targetStlFile, validateRevPack, type RevPack } from './revpack';
import { correlateProgramWithRevPack, type CorrelationReport } from './revpackCorrelation';
import { buildRevPackSimulationMessages, type SimulationSetupMessage } from './simulationSetup';
import { buildRevPackGeometry, loadStl, type GeoMesh, type RevPackGeometry } from './revpackGeometry';
import type { VisualizerHarnessData } from './fixtureHarness';
import { tessellateSTEP } from './stepTessellator';

export interface LoadedRevPack {
  pack: RevPack;
  /** Absolute path of the revpack.json. */
  file: string;
  dir: string;
}

const MAX_PARENT_LEVELS = 6;

function programMatches(pack: RevPack, programPath: string): boolean {
  const named = pack.program?.file;
  if (!named) return true;
  return path.basename(named).toLowerCase() === path.basename(programPath).toLowerCase();
}

export function readRevPack(file: string): LoadedRevPack {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const validation = validateRevPack(raw);
  if (!validation.ok) {
    throw new Error(`${path.basename(file)} is not a valid RevPack: ${validation.errors.join('; ')}`);
  }
  return { pack: raw as RevPack, file: path.resolve(file), dir: path.dirname(path.resolve(file)) };
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
  const stl = targetStlFile(loaded.pack);
  if (!stl) return undefined;
  const file = path.resolve(loaded.dir, stl);
  if (!fs.existsSync(file)) return undefined;
  // The shared kernel's STL reader - the same triangles CAM and the hub draw.
  const mesh = loadStl(fs.readFileSync(file));
  return {
    type: 'targetModel',
    id: 'revpack-target',
    targetId: 'target-part',
    role: 'target-part',
    displayMode: 'solid',
    opacity: 1,
    name: `${path.basename(file)} (RevPack target)`,
    format: `STL ${mesh.format}`,
    pointCount: mesh.triangleCount * 3,
    meshVertices: Array.from(mesh.positions),
    bounds: toMsgBounds(mesh.bounds),
    offset: { x: 0, y: 0, z: 0 },
    source: 'revpack',
    loader: 'stl',
  };
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
export async function revPackStepTargetMessage(loaded: LoadedRevPack): Promise<RevPackTargetMessage | undefined> {
  const target = loaded.pack.target;
  if (!target || target.format !== 'step') return undefined;
  const file = path.resolve(loaded.dir, target.file);
  if (!fs.existsSync(file)) return undefined;
  const step = await tessellateSTEP(new Uint8Array(fs.readFileSync(file)), { linearUnit: loaded.pack.units === 'in' ? 'inch' : 'millimeter' });
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
  workholding: Array<{ name: string } & WireMesh>;
  tools: Array<{ t: number; kind: string; gaugeLength: number; stickOut: number; cutter: WireMesh; holder?: WireMesh }>;
}

export function revPackSceneMessage(geometry: RevPackGeometry): RevPackSceneMessage {
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
    workholding: geometry.workholding.map(item => ({ name: item.name, ...wire(item.mesh) })),
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
}

/** Everything the visualizer needs from a pack for one program. */
export function buildRevPackScene(loaded: LoadedRevPack, gcode: string, harnessTools: VisualizerHarnessData['tools'] = []): RevPackScene {
  const setup = buildRevPackSimulationMessages(loaded.pack, harnessTools);
  for (const message of setup) {
    if (message.type === 'revpackInfo') message.source = loaded.file;
  }
  const report = correlateProgramWithRevPack(gcode, loaded.pack);
  const stl = targetStlFile(loaded.pack);
  const targetFile = stl ? path.resolve(loaded.dir, stl) : undefined;
  const geometry = buildRevPackGeometry(loaded.pack, {
    targetStl: targetFile && fs.existsSync(targetFile) ? fs.readFileSync(targetFile) : undefined,
    segments: report.segments,
  });
  const first = report.toolsUsed[0];
  const firstTool = loaded.pack.tools.find(tool => tool.t === first) ?? loaded.pack.tools[0];
  return {
    setup,
    geometry,
    sceneMessage: revPackSceneMessage(geometry),
    target: revPackTargetMessage(loaded),
    findings: revPackFindingsMessage(report),
    report,
    cutterSize: firstTool?.diameter || (loaded.pack.units === 'mm' ? 6 : 0.25),
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
