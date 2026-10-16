/**
 * G-code ⇄ RevPack tool-movement correlation.
 *
 * Steps a program block by block against the RevPack it is meant for and
 * reports where the tool movements disagree with the setup:
 *
 *   travel        every axis stays inside the machine's travel limits
 *                 (spindle gauge line for X/Y/Z, degrees for rotaries)
 *   collision     no rapid into remaining stock; no move of any kind into
 *                 workholding (tool body checked along its axis), named by
 *                 the solid's role: rapid-into-jaw, feed-into-vise-body ...
 *   workholding   grip depth at least the vise maker's recommendation; no
 *                 feed into the gripped stock region; with the tool tilted,
 *                 the shank and holder clear the jaws and vise (the reach a
 *                 5-sided setup needs)
 *   offsets       only work offsets the RevPack defines; one is active
 *                 before the first move
 *   tools         every T is in the RevPack; the length register matches
 *                 the loaded tool (G43/G234 H), and is re-stated after a change
 *   spindle/feed  spindle on and F set before cutting; S inside machine and
 *                 tool limits
 *   tool change   spindle at tool-change height before M06 (mill) or turret
 *                 clear before indexing (lathe)
 *   5-axis        simultaneous rotary + linear feed only with TCPC; rotaries
 *                 never index with the tool near the part; TCPC/DWO codes
 *                 match the controller
 *   dialect/units program dialect and G20/G21 match the machine and pack
 *
 * Material is tracked so a rapid through air the program already cut is not
 * flagged: a heightmap over the stock for vertical-tool milling, a radius
 * profile along Z for turning.
 *
 * Assumptions (stated so a reviewer can disagree with them):
 *   - For rotary machines the work zero sits on the rotary centreline
 *     intersection (Haas MRZP practice with G234/G254). Packs that set the
 *     zero elsewhere need machine.rotaryCenter.
 *   - Holders are not modelled; the cutter is a cylinder of the tool
 *     diameter over its flute length (or 3×D when the pack gives none).
 *   - No 3D machine model is used, and none is needed.
 */

import { grippedRegion, isCylinder, type RevPack, type RevPackBox, type RevPackCylinder, type RevPackTool, type Vec3, type WorkholdingRole } from './revpack';
import { toolEnvelope } from './revpackGeometry';

export type CorrelationSeverity = 'error' | 'warning' | 'info';
export type CorrelationCategory =
  | 'travel' | 'collision' | 'offsets' | 'tools' | 'spindle-feed' | 'tool-change' | 'five-axis' | 'dialect' | 'program' | 'workholding';

export interface CorrelationFinding {
  id: string;
  category: CorrelationCategory;
  severity: CorrelationSeverity;
  /** 1-based program line. */
  line: number;
  message: string;
  /** The workholding solid a collision or clearance finding is about. */
  object?: string;
}

export interface CorrelationSegment {
  /** Tool tip in PART coordinates. */
  from: Vec3;
  to: Vec3;
  rapid: boolean;
  tool: number | null;
  line: number;
  /** True when the tool axis was tilted off part +Z on this move. */
  tilted: boolean;
  /** Tool axis (tip toward holder) in PART coordinates. */
  axis: Vec3;
}

export interface CorrelationReport {
  packId: string;
  machine: string;
  dialect: string;
  kinematics: string;
  findings: CorrelationFinding[];
  segments: CorrelationSegment[];
  /** Min/max machine position reached per axis. */
  machineExtents: Record<string, { min: number; max: number }>;
  toolsUsed: number[];
  workOffsetsUsed: string[];
  checks: Record<CorrelationCategory, { checked: number; failed: number }>;
  summary: { errors: number; warnings: number; infos: number; pass: boolean };
}

// ─── small vector helpers ────────────────────────────────────────────────────

type M3 = [Vec3, Vec3, Vec3];
const deg = (value: number) => (value * Math.PI) / 180;
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const mul = (m: M3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
const transpose = (m: M3): M3 => [
  [m[0][0], m[1][0], m[2][0]],
  [m[0][1], m[1][1], m[2][1]],
  [m[0][2], m[1][2], m[2][2]],
];
const matmul = (a: M3, b: M3): M3 => {
  const out: M3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return out;
};
const IDENTITY: M3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** Rotation by `angle` degrees about unit vector `axis` (Rodrigues). */
function rotation(axis: Vec3, angle: number): M3 {
  const [x, y, z] = axis;
  const c = Math.cos(deg(angle));
  const s = Math.sin(deg(angle));
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

// ─── block parsing ───────────────────────────────────────────────────────────

interface Block {
  line: number;
  g: number[];
  m: number[];
  words: Map<string, number>;
  raw: string;
}

function stripComments(line: string): string {
  let out = '';
  let depth = 0;
  for (const ch of line) {
    if (ch === '(') depth++;
    else if (ch === ')' && depth > 0) depth--;
    else if (ch === ';' && depth === 0) break;
    else if (depth === 0) out += ch;
  }
  return out.toUpperCase();
}

function parseBlock(text: string, line: number): Block | null {
  const code = stripComments(text).trim();
  if (!code || code.startsWith('%')) return null;
  const g: number[] = [];
  const m: number[] = [];
  const words = new Map<string, number>();
  const re = /([A-Z])\s*([+-]?(?:\d+\.?\d*|\.\d+))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(code)) !== null) {
    const letter = match[1];
    const value = Number.parseFloat(match[2]);
    if (letter === 'G') g.push(Math.round(value * 10) / 10);
    else if (letter === 'M') m.push(value);
    else if (letter === 'N' || letter === 'O') continue;
    else words.set(letter, value);
  }
  return { line, g, m, words, raw: code };
}

// ─── material models ─────────────────────────────────────────────────────────

class HeightMap {
  readonly cells: number;
  private readonly top: Float64Array;
  constructor(private readonly box: RevPackBox, private readonly step: number) {
    const nx = Math.max(1, Math.ceil((box.max[0] - box.min[0]) / step));
    const ny = Math.max(1, Math.ceil((box.max[1] - box.min[1]) / step));
    this.nx = nx;
    this.ny = ny;
    this.cells = nx * ny;
    this.top = new Float64Array(nx * ny).fill(box.max[2]);
  }
  private nx: number;
  private ny: number;
  private forEachCell(x: number, y: number, radius: number, fn: (index: number) => void): void {
    const i0 = Math.max(0, Math.floor((x - radius - this.box.min[0]) / this.step));
    const i1 = Math.min(this.nx - 1, Math.floor((x + radius - this.box.min[0]) / this.step));
    const j0 = Math.max(0, Math.floor((y - radius - this.box.min[1]) / this.step));
    const j1 = Math.min(this.ny - 1, Math.floor((y + radius - this.box.min[1]) / this.step));
    // The cell the point itself is in always counts. Without it a zero-radius
    // (unknown) tool sitting on a cell corner touched no cell at all, so a
    // rapid straight down through the stock went unreported.
    const ic = Math.floor((x - this.box.min[0]) / this.step);
    const jc = Math.floor((y - this.box.min[1]) / this.step);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const cx = this.box.min[0] + (i + 0.5) * this.step;
        const cy = this.box.min[1] + (j + 0.5) * this.step;
        if ((i === ic && j === jc) || (cx - x) ** 2 + (cy - y) ** 2 <= (radius + this.step * 0.5) ** 2) fn(i * this.ny + j);
      }
    }
  }
  /** Remove material under a flat tool of `radius` with its tip at z. */
  cut(x: number, y: number, z: number, radius: number): void {
    this.forEachCell(x, y, radius, index => {
      if (z < this.top[index]) this.top[index] = z;
    });
  }
  /** Highest remaining material under the tool footprint, or -Infinity outside the stock. */
  highestUnder(x: number, y: number, radius: number): number {
    let highest = -Infinity;
    this.forEachCell(x, y, radius, index => {
      if (this.top[index] > highest) highest = this.top[index];
    });
    return highest;
  }
}

class RadiusProfile {
  private readonly radius: Float64Array;
  private readonly bins: number;
  constructor(private readonly stock: RevPackCylinder, private readonly step: number) {
    this.bins = Math.max(1, Math.ceil((stock.zMax - stock.zMin) / step));
    this.radius = new Float64Array(this.bins).fill(stock.diameter / 2);
  }
  private bin(z: number): number | null {
    if (z < this.stock.zMin || z > this.stock.zMax) return null;
    return Math.min(this.bins - 1, Math.floor((z - this.stock.zMin) / this.step));
  }
  cut(r: number, z: number): void {
    const index = this.bin(z);
    if (index === null) return;
    // A turning tool removes everything outside its tip radius at this Z, and
    // (fed in from the free end) everything outside that radius toward +Z.
    for (let i = index; i < this.bins; i++) {
      if (r < this.radius[i]) this.radius[i] = Math.max(0, r);
    }
  }
  remaining(z: number): number {
    const index = this.bin(z);
    return index === null ? 0 : this.radius[index];
  }
}

// ─── geometry tests ──────────────────────────────────────────────────────────

function insideBox(p: Vec3, box: RevPackBox, grow: number): boolean {
  return p[0] > box.min[0] - grow && p[0] < box.max[0] + grow
    && p[1] > box.min[1] - grow && p[1] < box.max[1] + grow
    && p[2] > box.min[2] - grow && p[2] < box.max[2] + grow;
}

/**
 * A cutter of `radius` with its tip at p and its axis vertical: grow the box
 * sideways by the radius only. The flat end does not reach below the tip, so
 * growing Z by the radius (a sphere test) would flag a face mill passing well
 * above a vise jaw.
 */
function cutterInBox(p: Vec3, box: RevPackBox, radius: number, vertical: boolean): boolean {
  if (!vertical) return insideBox(p, box, radius - TOL);
  const grow = radius - TOL;
  return p[0] > box.min[0] - grow && p[0] < box.max[0] + grow
    && p[1] > box.min[1] - grow && p[1] < box.max[1] + grow
    && p[2] > box.min[2] + TOL && p[2] < box.max[2] - TOL;
}

function insideCylinder(p: Vec3, cyl: RevPackCylinder, grow: number): boolean {
  // Lathe frame: X is the radius direction (we store radius in p[0]), Z is the spindle axis.
  const r = Math.abs(p[0]);
  const inner = (cyl.innerDiameter ?? 0) / 2;
  return p[2] > cyl.zMin - grow && p[2] < cyl.zMax + grow && r < cyl.diameter / 2 + grow && r > inner - grow;
}

// ─── the correlator ──────────────────────────────────────────────────────────

const TOL = 1e-4;

/** Finding-id word for a workholding role (rapid-into-jaw, feed-into-vise-body, ...). */
function roleSlug(role: WorkholdingRole | undefined): string {
  if (!role) return 'workholding';
  if (role === 'fixed-jaw' || role === 'moving-jaw' || role === 'jaw') return 'jaw';
  return role;
}

const ROLE_WORDS: Record<WorkholdingRole, string> = {
  'vise-body': 'vise body', jaw: 'jaw', 'fixed-jaw': 'fixed jaw', 'moving-jaw': 'moving jaw', 'zero-point': 'zero-point plate',
  riser: 'riser', parallel: 'parallel', fixture: 'fixture', 'chuck-jaw': 'chuck jaw', clamp: 'clamp',
};

export function correlateProgramWithRevPack(gcode: string, pack: RevPack): CorrelationReport {
  const machine = pack.machine;
  const turning = machine.machineClass === 'lathe';
  const laser = machine.machineClass === 'laser';
  const findings: CorrelationFinding[] = [];
  const segments: CorrelationSegment[] = [];
  const checks = Object.fromEntries(
    (['travel', 'collision', 'offsets', 'tools', 'spindle-feed', 'tool-change', 'five-axis', 'dialect', 'program', 'workholding'] as CorrelationCategory[])
      .map(category => [category, { checked: 0, failed: 0 }]),
  ) as CorrelationReport['checks'];
  const seen = new Set<string>();
  const report = (category: CorrelationCategory, severity: CorrelationSeverity, id: string, line: number, message: string, once = true, object?: string) => {
    const key = once ? id : `${id}@${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (severity !== 'info') checks[category].failed++;
    findings.push(object ? { id, category, severity, line, message, object } : { id, category, severity, line, message });
  };
  const check = (category: CorrelationCategory) => { checks[category].checked++; };

  const unitScale = pack.units === 'mm' ? 25.4 : 1;
  const clearance = pack.clearance ?? 0.05 * unitScale;
  const toolByNumber = new Map<number, RevPackTool>(pack.tools.map(tool => [tool.t, tool]));
  const toolByH = new Map<number, RevPackTool>(pack.tools.map(tool => [tool.h ?? tool.t, tool]));
  const axisLimit = new Map(machine.axes.map(axis => [axis.name, axis]));
  const extents: Record<string, { min: number; max: number }> = {};
  const toolsUsed = new Set<number>();
  const offsetsUsed = new Set<string>();

  // Dialect and units are properties of the whole program.
  check('dialect');
  if (pack.program.dialect.toLowerCase() !== machine.dialect.toLowerCase()) {
    report('dialect', 'error', 'dialect-mismatch', 1,
      `Program is posted for "${pack.program.dialect}" but the RevPack machine ${machine.name} runs "${machine.dialect}"${machine.controlModel ? ` (${machine.controlModel})` : ''}.`);
  }

  // Grip: the stock must sit at least as deep in the jaws as the vise maker
  // recommends (LANG Makro-Grip: 3 mm, form-fit on a pre-stamped blank).
  const recommendedGrip = pack.workholdingSpec?.recommendedGripDepth;
  const gripDepth = pack.setup?.gripDepth;
  if (recommendedGrip !== undefined && gripDepth !== undefined) {
    check('workholding');
    if (gripDepth < recommendedGrip - TOL) {
      const spec = pack.workholdingSpec!;
      report('workholding', 'warning', 'grip-depth-below-recommended', 1,
        `The stock sits ${gripDepth} ${pack.units} deep in the jaws; ${spec.manufacturer} ${spec.model} recommends at least ${recommendedGrip} ${pack.units}${spec.gripMethod === 'form-fit-stamped' ? ' (form-fit on a pre-stamped blank)' : ''}.`);
    }
  }
  const grip = grippedRegion(pack);

  // Material models.
  const stockBox = isCylinder(pack.stock) ? null : pack.stock;
  const stockCyl = isCylinder(pack.stock) ? pack.stock : null;
  const heightMap = stockBox ? new HeightMap(stockBox, 0.05 * unitScale) : null;
  const profile = stockCyl ? new RadiusProfile(stockCyl, 0.02 * unitScale) : null;

  // Modal state.
  let absolute = true;
  let motion = 0;
  let plane: 17 | 18 | 19 = turning ? 18 : 17;
  let units: 20 | 21 | null = null;
  // A lathe usually carries its zero in the control (Okuma ZERO SET, Fanuc
  // geometry offsets) rather than a G54 in the program, so a turning pack's
  // first offset is the one in force until the program selects another.
  let wcs: string | null = turning ? Object.keys(pack.workOffsets)[0] ?? null : null;
  let preselected: number | null = null;
  let loaded: number | null = null;
  let hReg: number | null = null;
  let hStatedSinceChange = turning || laser;
  let tcpc = false;
  let dwo = false;
  let spindleOn = false;
  let rpm: number | null = null;
  let feed: number | null = null;
  let cycle: number | null = null;
  let cycleR: number | null = null;
  let cycleZ: number | null = null;
  let returnInitial = true;
  let sawEnd = false;
  let movedBeforeOffset = false;
  // Position: programmed (work) coordinates and rotaries.
  let pos: Vec3 = [0, 0, 0];
  const rot: Record<'A' | 'B' | 'C', number> = { A: 0, B: 0, C: 0 };
  // Machine gauge position, starting at home.
  const home: Vec3 = [
    axisLimit.get('X')?.max ?? 0,
    axisLimit.get('Y')?.max ?? 0,
    machine.toolChangeZ ?? axisLimit.get('Z')?.max ?? 0,
  ];
  let gauge: Vec3 = [...home];
  let gaugeKnown = true; // at home before the first move
  let lastTip: Vec3 | null = null;
  /** True while the current block commands Z (a TLO is needed before Z moves). */
  let zCommanded = false;

  const firstOffset = Object.values(pack.workOffsets)[0];
  const offsetOf = (name: string | null): Vec3 => {
    // An offset the pack does not define is already reported; fall back to the
    // pack's first one so a single wrong G55 does not cascade into a page of
    // false over-travel findings.
    const offset = (name ? pack.workOffsets[name] : undefined) ?? (name ? firstOffset : undefined);
    return offset ? [offset.x, offset.y ?? 0, offset.z] : [0, 0, 0];
  };
  const rotaryMatrix = (): M3 => {
    // Table rotation that maps PART coordinates to machine-aligned coordinates.
    let m = IDENTITY;
    for (const axis of machine.rotaries ?? []) {
      const angle = rot[axis.name];
      if (!angle) continue;
      // A table axis turns the part; seen from the machine it is the forward rotation.
      m = matmul(rotation(axis.axis, axis.table ? angle : -angle), m);
    }
    return m;
  };
  const toolLength = (tool: RevPackTool | undefined) => (tool && !turning && !laser ? tool.gaugeLength : 0);
  const loadedTool = () => (loaded !== null ? toolByNumber.get(loaded) : undefined);

  const recordExtent = (axis: string, value: number) => {
    const entry = extents[axis] ?? (extents[axis] = { min: value, max: value });
    if (value < entry.min) entry.min = value;
    if (value > entry.max) entry.max = value;
  };

  const checkTravel = (line: number, machinePos: Vec3) => {
    const names: Array<'X' | 'Y' | 'Z'> = ['X', 'Y', 'Z'];
    names.forEach((name, index) => {
      const limit = axisLimit.get(name);
      if (!limit) return;
      check('travel');
      recordExtent(name, machinePos[index]);
      if (machinePos[index] < limit.min - TOL || machinePos[index] > limit.max + TOL) {
        report('travel', 'error', `over-travel-${name}`, line,
          `${name} reaches ${machinePos[index].toFixed(4)} in machine coordinates; ${machine.name} travel is ${limit.min} to ${limit.max}.`);
      }
    });
    for (const name of ['A', 'B', 'C'] as const) {
      const limit = axisLimit.get(name);
      if (!limit) continue;
      check('travel');
      recordExtent(name, rot[name]);
      if (rot[name] < limit.min - TOL || rot[name] > limit.max + TOL) {
        report('travel', 'error', `over-travel-${name}`, line,
          `${name} goes to ${rot[name]}°; ${machine.name} allows ${limit.min}° to ${limit.max}°.`);
      }
    }
  };

  /**
   * Tool tip in part coordinates and the tool axis, for a programmed point.
   *
   * Machine coordinates are the control's: where the spindle gauge line sits
   * with no length offset. C is the rotary centre (Haas MRZP).
   *   TCPC (G234/G43.4): programmed XYZ are PART coordinates; the control turns
   *       them with the table:  tip = C + R(O + p - C)
   *   DWO (G254): the work zero follows the table, axes stay machine-aligned:
   *       tip = C + R(O - C) + p
   *   neither: plain linear axes:  tip = O + p
   * Gauge = tip + the length in the APPLIED register; the real tip is gauge
   * minus the LOADED tool's length, so a wrong H shows up as a real error.
   */
  const resolveTip = (programmed: Vec3): { gaugeMachine: Vec3; tipPart: Vec3; axisPart: Vec3 } => {
    const offset = offsetOf(wcs);
    if (turning) {
      // Lathe: X is diameter in the program; keep radius in the part frame.
      const machinePos: Vec3 = [offset[0] + programmed[0], 0, offset[2] + programmed[2]];
      return { gaugeMachine: machinePos, tipPart: [programmed[0] / 2, 0, programmed[2]], axisPart: [1, 0, 0] };
    }
    const R = rotaryMatrix();
    const Rt = transpose(R);
    const center: Vec3 = machine.rotaryCenter ?? offset;
    const commandedTip: Vec3 = tcpc
      ? add(center, mul(R, sub(add(offset, programmed), center)))
      : dwo
        ? add(add(center, mul(R, sub(offset, center))), programmed)
        : add(offset, programmed);
    const registerLength = hReg !== null ? toolLength(toolByH.get(hReg)) : 0;
    const actualLength = toolLength(loadedTool());
    const gaugeMachine = add(commandedTip, [0, 0, registerLength]);
    const actualTip = sub(gaugeMachine, [0, 0, actualLength]);
    const tipPart = sub(add(center, mul(Rt, sub(actualTip, center))), offset);
    return { gaugeMachine, tipPart, axisPart: mul(Rt, [0, 0, 1]) };
  };

  /** Programmed point that puts the gauge line where it is now, in the current frame. */
  const programmedFromGauge = (g: Vec3): Vec3 => {
    const offset = offsetOf(wcs);
    if (turning) return [g[0] - offset[0], 0, g[2] - offset[2]];
    const registerLength = hReg !== null ? toolLength(toolByH.get(hReg)) : 0;
    const tip = sub(g, [0, 0, registerLength]);
    const R = rotaryMatrix();
    const center: Vec3 = machine.rotaryCenter ?? offset;
    if (tcpc) return sub(add(center, mul(transpose(R), sub(tip, center))), offset);
    if (dwo) return sub(tip, add(center, mul(R, sub(offset, center))));
    return sub(tip, offset);
  };

  const toolRadius = () => (loadedTool()?.diameter ?? 0) / 2;
  const envelopeOf = new Map<number, ReturnType<typeof toolEnvelope>>();
  const loadedEnvelope = () => {
    const tool = loadedTool();
    if (!tool) return undefined;
    if (!envelopeOf.has(tool.t)) envelopeOf.set(tool.t, toolEnvelope(tool, machine.machineClass, pack.units));
    return envelopeOf.get(tool.t);
  };
  const rotaryText = () => (['A', 'B', 'C'] as const).filter(name => axisLimit.has(name)).map(name => `${name}${rot[name]}`).join(' ');
  const cuttingLength = () => {
    const tool = loadedTool();
    return tool ? (tool.fluteLength ?? tool.diameter * 3) : 0;
  };

  const collide = (line: number, from: Vec3, to: Vec3, axisPart: Vec3, rapid: boolean) => {
    if (laser) return;
    const radius = toolRadius();
    const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const steps = Math.max(1, Math.ceil(length / (0.02 * unitScale)));
    const vertical = axisPart[2] > 0.9999;
    // Backing straight out along the tool axis retraces the way the tool went
    // in (a drill cycle's retract), so it never meets uncut stock.
    const retract = length > 0 && ((to[0] - from[0]) * axisPart[0] + (to[1] - from[1]) * axisPart[1] + (to[2] - from[2]) * axisPart[2]) / length > 0.999;
    // One finding per hazard per move. After a rapid hits the stock, the
    // rest of that move is cut out of the material model: the crash already
    // happened, so the retract out of it must not be reported a second time.
    let stockHit = false;
    for (let k = 0; k <= steps; k++) {
      const p = add(from, scale(sub(to, from), k / steps));
      if (stockHit && heightMap && vertical) heightMap.cut(p[0], p[1], p[2], radius);
      if (stockHit && profile) profile.cut(Math.abs(p[0]), p[2]);
      // Workholding: tip and body, every move. Each solid is reported by its
      // role, so a rapid into a jaw reads differently from one into the body.
      for (const holder of pack.workholding) {
        check('collision');
        const bodySamples = [0, 0.5, 1].map(f => add(p, scale(axisPart, f * cuttingLength())));
        const hit = bodySamples.some(sample => isCylinder(holder)
          ? insideCylinder(sample, holder, radius)
          : cutterInBox(sample, holder, radius, vertical));
        if (hit) {
          const slug = roleSlug(holder.role);
          report('collision', 'error', `${rapid ? 'rapid' : 'feed'}-into-${slug}`, line,
            `${rapid ? 'Rapid' : 'Feed'} move puts T${loaded ?? '?'} into ${holder.name}${holder.role ? ` (${ROLE_WORDS[holder.role]})` : ''} at part (${p.map(v => v.toFixed(3)).join(', ')}).`, false, holder.name);
          return;
        }
      }
      // A feed into the gripped stock cuts the material the jaws hold: the
      // bottom gripDepth of the stock, within gripDepth of a clamped face (a
      // through-hole in the middle of a plate is not in the jaws).
      if (grip && !rapid) {
        check('workholding');
        const k = pack.setup?.clampAxis === 'X' ? 0 : 1;
        const band = (pack.setup?.gripDepth ?? 0) + radius;
        const nearFace = p[k] - grip.min[k] < band || grip.max[k] - p[k] < band;
        if (nearFace && cutterInBox(p, grip, radius, vertical)) {
          report('workholding', 'warning', 'feed-into-grip-zone', line,
            `Feed move takes T${loaded ?? '?'} into the gripped stock (the bottom ${pack.setup?.gripDepth} ${pack.units} held in the jaws) at part (${p.map(v => v.toFixed(3)).join(', ')}).`, false);
        }
      }
      // Tilted tool: the shank and holder above the flutes must clear the
      // jaws and vise body - the reach a 5-sided setup needs.
      if (!vertical && !turning) {
        const env = loadedEnvelope();
        if (env) {
          const from = cuttingLength();
          const span = env.gaugeLength - from;
          const n = Math.max(1, Math.ceil(span / (0.05 * unitScale)));
          for (const holder of pack.workholding) {
            if (isCylinder(holder)) continue;
            check('workholding');
            let reach = -1;
            for (let i = 0; i <= n && reach < 0; i++) {
              const along = from + (span * i) / n;
              const r = along <= env.stickOut ? radius : env.holderDiameter / 2;
              if (insideBox(add(p, scale(axisPart, along)), holder, r - TOL)) reach = along;
            }
            if (reach >= 0) {
              const part = reach <= env.stickOut ? 'shank' : `holder (Ø${env.holderDiameter})`;
              report('workholding', 'warning', `tilted-tool-hits-${roleSlug(holder.role)}`, line,
                `With the tool tilted (${rotaryText()}), T${loaded ?? '?'}'s ${part} ${reach.toFixed(3)} ${pack.units} up from the tip reaches into ${holder.name}; 5-sided access needs more stick-out than ${env.stickOut.toFixed(3)} ${pack.units}, less tilt, or a taller riser.`, false, holder.name);
            }
          }
        }
      }
      if (stockHit) continue;
      // Stock: rapids only, against what is left.
      if (heightMap && stockBox) {
        if (rapid) {
          check('collision');
          if (vertical) {
            const highest = heightMap.highestUnder(p[0], p[1], radius);
            if (highest > -Infinity && p[2] < highest - 0.002 * unitScale) {
              report('collision', 'error', 'rapid-into-stock', line,
                `Rapid takes T${loaded ?? '?'} to Z${p[2].toFixed(4)} where uncut stock stands at Z${highest.toFixed(4)}.`, false);
              stockHit = true;
              heightMap.cut(p[0], p[1], p[2], radius);
              continue;
            }
          } else if (!retract && insideBox(p, stockBox, radius * 0.5)) {
            report('collision', 'warning', 'rapid-near-stock-tilted', line,
              `Rapid with the tool tilted passes inside the stock envelope at part (${p.map(v => v.toFixed(3)).join(', ')}); check the approach.`, false);
            return;
          }
        } else if (vertical) {
          heightMap.cut(p[0], p[1], p[2], radius);
        }
      }
      if (profile && stockCyl) {
        const r = Math.abs(p[0]);
        if (rapid) {
          check('collision');
          const remaining = profile.remaining(p[2]);
          if (remaining > 0 && r < remaining - 0.002 * unitScale && r >= (stockCyl.innerDiameter ?? 0) / 2) {
            report('collision', 'error', 'rapid-into-stock', line,
              `Rapid takes T${loaded ?? '?'} to X${(r * 2).toFixed(4)} Z${p[2].toFixed(4)}, inside uncut stock (dia ${(remaining * 2).toFixed(4)}).`, false);
            stockHit = true;
            profile.cut(r, p[2]);
            continue;
          }
        } else {
          profile.cut(r, p[2]);
        }
      }
    }
  };

  const moveTo = (line: number, programmed: Vec3, rapid: boolean, rotaryChanged: boolean, linearChanged: boolean) => {
    if (!wcs && !movedBeforeOffset) {
      movedBeforeOffset = true;
      check('offsets');
      report('offsets', 'error', 'move-before-work-offset', line, 'Axis motion before any work offset (G54-G59) is selected.');
    }
    if (!rapid) {
      check('spindle-feed');
      if (!spindleOn && !laser) report('spindle-feed', 'error', 'feed-with-spindle-off', line, `Cutting move with the spindle off (T${loaded ?? '?'}).`, false);
      if (!feed || feed <= 0) report('spindle-feed', 'error', 'feed-without-f', line, 'Cutting move with no feed rate (F) set.', false);
    }
    if (!turning && !laser && loaded !== null && zCommanded) {
      check('tools');
      if (!hStatedSinceChange) {
        report('tools', 'error', 'no-tool-length-after-change', line,
          `T${loaded} moves before its tool length is applied (no G43/G234 H${toolByNumber.get(loaded)?.h ?? loaded} after the tool change).`);
      }
    }
    if (rotaryChanged && (machine.rotaries?.length ?? 0) >= 2) {
      check('five-axis');
      if (!rapid && linearChanged && !tcpc) {
        report('five-axis', 'error', 'simultaneous-5x-without-tcpc', line,
          `Simultaneous rotary + linear feed without TCPC (${machine.tcpcOn ?? 'TCPC'}) active: the tool tip will not follow the programmed path.`, false);
      }
      if (lastTip && stockBox && insideBox(lastTip, stockBox, clearance + toolRadius()) && rapid) {
        report('five-axis', 'error', 'rotary-index-near-part', line,
          `Rotary index with T${loaded ?? '?'} still within ${clearance} of the stock; retract before indexing.`, false);
      }
    }
    const { gaugeMachine, tipPart, axisPart } = resolveTip(programmed);
    checkTravel(line, gaugeMachine);
    const from = lastTip ?? tipPart;
    collide(line, from, tipPart, axisPart, rapid);
    segments.push({ from, to: tipPart, rapid, tool: loaded, line, tilted: !turning && axisPart[2] < 0.9999, axis: axisPart });
    lastTip = tipPart;
    gauge = gaugeMachine;
    gaugeKnown = true;
  };

  const lines = gcode.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const lineNo = index + 1;
    const block = parseBlock(lines[index], lineNo);
    if (!block) continue;
    const { g, m, words } = block;
    const has = (code: number) => g.includes(code);
    const frameBefore = `${wcs}|${hReg}|${tcpc}|${dwo}`;

    // Units.
    if (has(20) || has(21) || (machine.dialect === 'siemens' && (has(70) || has(71)))) {
      units = has(20) || has(70) ? 20 : 21;
      check('program');
      const expected = pack.units === 'in' ? 20 : 21;
      if (units !== expected) {
        report('program', 'error', 'units-mismatch', lineNo, `Program sets ${units === 20 ? 'inch' : 'metric'} units but the RevPack is in ${pack.units}.`);
      }
    }
    if (has(90)) absolute = true;
    if (has(91)) absolute = false;
    if (has(17)) plane = 17;
    if (has(18)) plane = 18;
    if (has(19)) plane = 19;
    if (has(98)) returnInitial = true;
    if (has(99)) returnInitial = false;

    // Controller-specific codes.
    if (has(234) || has(43.4) || has(254) || has(68.2)) {
      check('dialect');
      const code = has(234) ? 'G234' : has(43.4) ? 'G43.4' : has(254) ? 'G254' : 'G68.2';
      const expected = [machine.tcpcOn, machine.dwoOn].filter(Boolean);
      if (expected.length > 0 && !expected.includes(code)) {
        report('dialect', 'error', `foreign-5x-code-${code}`, lineNo,
          `${code} is not how ${machine.name} (${machine.dialect}${machine.controlModel ? ` ${machine.controlModel}` : ''}) turns on TCPC/DWO; it uses ${expected.join(' / ')}.`);
      }
    }

    // Work offsets.
    const offsetCode = g.find(code => code >= 54 && code <= 59.9) ?? g.find(code => code >= 110 && code <= 129);
    if (offsetCode !== undefined) {
      const name = offsetCode === 54.1 ? `G54.1P${words.get('P') ?? 1}` : `G${offsetCode}`;
      check('offsets');
      offsetsUsed.add(name);
      if (!pack.workOffsets[name]) {
        report('offsets', 'error', `undefined-work-offset-${name}`, lineNo,
          `${name} is selected but the RevPack defines only ${Object.keys(pack.workOffsets).join(', ')}.`);
      }
      wcs = name;
    }

    // Spindle, feed.
    if (words.has('S') && !has(50) && !has(92) && !has(96)) {
      rpm = words.get('S')!;
      check('spindle-feed');
      if (machine.spindleMaxRpm && rpm > machine.spindleMaxRpm) {
        report('spindle-feed', 'error', 'rpm-over-machine', lineNo, `S${rpm} exceeds ${machine.name}'s ${machine.spindleMaxRpm} rpm.`, false);
      }
      const tool = loadedTool() ?? (preselected !== null ? toolByNumber.get(preselected) : undefined);
      if (tool?.maxRpm && rpm > tool.maxRpm) {
        report('spindle-feed', 'warning', 'rpm-over-tool', lineNo, `S${rpm} exceeds T${tool.t}'s rated ${tool.maxRpm} rpm.`, false);
      }
    }
    if (words.has('F')) feed = words.get('F')!;
    if (m.includes(3) || m.includes(4)) spindleOn = true;
    if (m.includes(5)) spindleOn = false;

    // Tool select / change.
    if (words.has('T')) {
      const raw = Math.round(words.get('T')!);
      let toolNumber = raw;
      if (turning) {
        const digits = String(raw).length;
        // Okuma OSP: T□□○○△△ = offset, tool, nose-R. Fanuc/Haas: T○○□□ = tool, offset.
        if (machine.dialect === 'okuma' && digits >= 5) toolNumber = Math.floor(raw / 100) % 100;
        else if (digits >= 3) toolNumber = Math.floor(raw / 100);
      }
      check('tools');
      if (!toolByNumber.has(toolNumber)) {
        report('tools', 'error', `tool-not-in-revpack-T${toolNumber}`, lineNo,
          `T${toolNumber} is called but the RevPack tool list has ${pack.tools.map(tool => `T${tool.t}`).join(', ')}.`);
      }
      preselected = toolNumber;
      if (turning || laser) {
        // A turret indexes on the T word; check it is clear of the part first.
        if (turning && loaded !== null && toolNumber !== loaded && machine.toolChangePosition) {
          check('tool-change');
          const tcp = machine.toolChangePosition;
          if (pos[0] < tcp.x - TOL || pos[2] < tcp.z - TOL) {
            report('tool-change', 'error', 'unsafe-tool-index', lineNo,
              `Turret indexes to T${toolNumber} at X${pos[0]} Z${pos[2]}; it must clear X${tcp.x} Z${tcp.z} first.`, false);
          }
        }
        loaded = toolNumber;
        toolsUsed.add(toolNumber);
      }
    }
    if (m.includes(6) && !turning) {
      check('tool-change');
      const changeZ = machine.toolChangeZ ?? axisLimit.get('Z')?.max ?? 0;
      if (gaugeKnown && gauge[2] < changeZ - TOL) {
        report('tool-change', 'error', 'unsafe-tool-change', lineNo,
          `M06 with the spindle at machine Z${gauge[2].toFixed(4)}; retract to Z${changeZ} (G28 G91 Z0 or G53 Z0) first.`, false);
      }
      if (spindleOn) {
        report('tool-change', 'info', 'tool-change-spindle-running', lineNo, 'M06 with the spindle still commanded on; the control stops it, but M05 first reads clearer.', false);
      }
      loaded = preselected;
      if (loaded !== null) toolsUsed.add(loaded);
      hStatedSinceChange = false;
      // The control is at tool-change height now.
      gauge = [gauge[0], gauge[1], changeZ];
      lastTip = null;
    }

    // Tool length / TCPC / DWO.
    if (has(43) || has(43.4) || has(234)) {
      const h = words.get('H');
      if (h !== undefined) {
        hReg = h;
        hStatedSinceChange = true;
        check('tools');
        const tool = loadedTool();
        const expectedH = tool ? (tool.h ?? tool.t) : null;
        if (expectedH !== null && h !== expectedH) {
          report('tools', 'error', `tool-length-mismatch-T${tool!.t}`, lineNo,
            `T${tool!.t} is in the spindle but the program applies H${h}${toolByH.get(h) ? ` (T${toolByH.get(h)!.t}'s length)` : ''}; expected H${expectedH}.`, false);
        }
      }
      if (has(43.4) || has(234)) tcpc = true;
    }
    if (has(49)) { hReg = null; tcpc = false; }
    if (has(254) || has(68.2)) dwo = true;
    if (has(255) || has(69)) dwo = false;
    if (tcpc && dwo) {
      check('five-axis');
      report('five-axis', 'error', 'tcpc-and-dwo', lineNo, 'TCPC and DWO are both active; cancel one before using the other.');
    }

    // A new work offset, length register, TCPC or DWO changes the frame, not
    // the machine: axes this block does not command stay where they are.
    if (`${wcs}|${hReg}|${tcpc}|${dwo}` !== frameBefore && gaugeKnown) pos = programmedFromGauge(gauge);
    zCommanded = words.has('Z') || (turning && words.has('W'));

    // Machine-coordinate moves.
    if (has(53) || has(28)) {
      const z = words.get('Z');
      const x = words.get('X');
      const y = words.get('Y');
      if (has(28) && !absolute && z === 0) gauge = [gauge[0], gauge[1], machine.toolChangeZ ?? axisLimit.get('Z')?.max ?? 0];
      else if (has(28) && absolute && z !== undefined) {
        check('tool-change');
        report('tool-change', 'warning', 'g28-absolute', lineNo, `G28 in G90 travels through work Z${z} on its way home; use G28 G91 Z0 or G53 Z0.`, false);
        gauge = [gauge[0], gauge[1], machine.toolChangeZ ?? axisLimit.get('Z')?.max ?? 0];
      } else if (has(53)) {
        gauge = [x ?? gauge[0], y ?? gauge[1], z ?? gauge[2]];
        checkTravel(lineNo, gauge);
      }
      if (has(28) && !absolute) {
        if (x === 0) gauge = [axisLimit.get('X')?.max ?? 0, gauge[1], gauge[2]];
        if (y === 0) gauge = [gauge[0], axisLimit.get('Y')?.max ?? 0, gauge[2]];
      }
      lastTip = null;
      // Keep the programmed position in step with where the spindle went, so the
      // next move starts from the right place (exact when no rotary is tilted).
      pos = programmedFromGauge(gauge);
      continue;
    }

    // Motion mode and canned cycles.
    const motionCode = g.find(code => code === 0 || code === 1 || code === 2 || code === 3);
    if (motionCode !== undefined) { motion = motionCode; cycle = null; }
    if (has(80)) cycle = null;
    const cycleCode = g.find(code => [73, 81, 82, 83, 84, 85, 86, 89].includes(code));
    if (cycleCode !== undefined && !turning) {
      cycle = cycleCode;
      if (words.has('R')) cycleR = words.get('R')!;
      if (words.has('Z')) cycleZ = words.get('Z')!;
    } else if (cycle !== null) {
      if (words.has('R')) cycleR = words.get('R')!;
      if (words.has('Z')) cycleZ = words.get('Z')!;
    }

    const next: Vec3 = [...pos];
    const axes: Array<[string, number]> = [['X', 0], ['Y', 1], ['Z', 2]];
    let linearChanged = false;
    for (const [letter, i] of axes) {
      if (!words.has(letter)) continue;
      if (cycle !== null && letter === 'Z') continue;
      const value = words.get(letter)!;
      next[i] = absolute ? value : pos[i] + value;
      linearChanged = true;
    }
    if (turning && words.has('U')) { next[0] = pos[0] + words.get('U')!; linearChanged = true; }
    if (turning && words.has('W')) { next[2] = pos[2] + words.get('W')!; linearChanged = true; }
    let rotaryChanged = false;
    for (const name of ['A', 'B', 'C'] as const) {
      if (!words.has(name) || (turning && name === 'C')) continue;
      const value = words.get(name)!;
      const target = absolute ? value : rot[name] + value;
      if (target !== rot[name]) rotaryChanged = true;
      rot[name] = target;
    }

    if (cycle !== null && !turning && (words.has('X') || words.has('Y')) && cycleR !== null && cycleZ !== null) {
      const initialZ = pos[2];
      const hole: Vec3 = [next[0], next[1], initialZ];
      moveTo(lineNo, hole, true, rotaryChanged, true);
      moveTo(lineNo, [hole[0], hole[1], cycleR], true, false, true);
      moveTo(lineNo, [hole[0], hole[1], cycleZ], false, false, true);
      const retract = returnInitial ? Math.max(initialZ, cycleR) : cycleR;
      moveTo(lineNo, [hole[0], hole[1], retract], true, false, true);
      pos = [hole[0], hole[1], retract];
      continue;
    }

    if (!linearChanged && !rotaryChanged) {
      if (m.includes(30) || m.includes(2)) sawEnd = true;
      continue;
    }

    if ((motion === 2 || motion === 3) && linearChanged) {
      // Arc: tessellate in the active plane.
      const [ia, ib] = plane === 17 ? [0, 1] : plane === 18 ? [2, 0] : [1, 2];
      const centerWords = plane === 17 ? ['I', 'J'] : plane === 18 ? ['K', 'I'] : ['J', 'K'];
      let ca: number;
      let cb: number;
      const r = words.get('R');
      const xScale = turning ? 0.5 : 1;
      const sa = pos[ia] * (ia === 0 ? xScale : 1);
      const sb = pos[ib] * (ib === 0 ? xScale : 1);
      const ea = next[ia] * (ia === 0 ? xScale : 1);
      const eb = next[ib] * (ib === 0 ? xScale : 1);
      if (r !== undefined) {
        const dx = ea - sa;
        const dy = eb - sb;
        const chord = Math.hypot(dx, dy);
        const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
        const mx = (sa + ea) / 2;
        const my = (sb + eb) / 2;
        const sign = (motion === 2 ? -1 : 1) * (r < 0 ? -1 : 1);
        ca = mx - (sign * h * dy) / (chord || 1);
        cb = my + (sign * h * dx) / (chord || 1);
      } else {
        ca = sa + (words.get(centerWords[0]) ?? 0);
        cb = sb + (words.get(centerWords[1]) ?? 0);
      }
      const radius = Math.hypot(sa - ca, sb - cb);
      const a0 = Math.atan2(sb - cb, sa - ca);
      let a1 = Math.atan2(eb - cb, ea - ca);
      if (motion === 2 && a1 >= a0) a1 -= 2 * Math.PI;
      if (motion === 3 && a1 <= a0) a1 += 2 * Math.PI;
      if (Math.abs(ea - sa) < TOL && Math.abs(eb - sb) < TOL) a1 = a0 + (motion === 2 ? -2 : 2) * Math.PI;
      const sweep = a1 - a0;
      const steps = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 36)));
      const start: Vec3 = [...pos];
      for (let k = 1; k <= steps; k++) {
        const angle = a0 + (sweep * k) / steps;
        const point: Vec3 = [...start];
        point[ia] = (ca + radius * Math.cos(angle)) / (ia === 0 ? xScale : 1);
        point[ib] = (cb + radius * Math.sin(angle)) / (ib === 0 ? xScale : 1);
        const other = 3 - ia - ib;
        point[other] = start[other] + ((next[other] - start[other]) * k) / steps;
        moveTo(lineNo, point, false, k === 1 && rotaryChanged, true);
      }
    } else {
      moveTo(lineNo, next, motion === 0, rotaryChanged, linearChanged);
    }
    pos = next;
    if (m.includes(30) || m.includes(2)) sawEnd = true;
  }

  check('program');
  if (!sawEnd && !/M0*(2|30)\b/i.test(gcode.replace(/\([^)]*\)/g, ''))) {
    report('program', 'warning', 'no-program-end', lines.length, 'No M30/M02 program end.');
  }
  check('tools');
  for (const tool of pack.tools) {
    if (!toolsUsed.has(tool.t)) report('tools', 'info', `revpack-tool-unused-T${tool.t}`, 1, `RevPack lists T${tool.t} (${tool.type}) but the program never calls it.`);
  }

  findings.sort((a, b) => a.line - b.line || a.id.localeCompare(b.id));
  const errors = findings.filter(finding => finding.severity === 'error').length;
  const warnings = findings.filter(finding => finding.severity === 'warning').length;
  return {
    packId: pack.id,
    machine: machine.name,
    dialect: machine.dialect,
    kinematics: machine.kinematics,
    findings,
    segments,
    machineExtents: extents,
    toolsUsed: Array.from(toolsUsed).sort((a, b) => a - b),
    workOffsetsUsed: Array.from(offsetsUsed).sort(),
    checks,
    summary: { errors, warnings, infos: findings.length - errors - warnings, pass: errors === 0 },
  };
}
