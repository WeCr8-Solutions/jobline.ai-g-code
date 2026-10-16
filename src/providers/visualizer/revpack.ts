/**
 * RevPack: the part/setup package a program is proven against.
 *
 * A program on its own says where the tool goes relative to a work offset. It
 * does not say where the part is, what holds it, which tools are in the
 * magazine, or what machine it runs on. A RevPack carries those, so a program
 * can be checked against the setup it will actually meet:
 *
 *   target       the finished part, for display and the target-vs-stock
 *                comparison: STEP (B-rep, read through OpenCascade where the
 *                host has it) with an STL beside it for hosts that do not
 *                (the hub and CAM), or STL / Parasolid text alone
 *   purpose      'seeded-errors' marks a test pack whose program carries
 *                deliberate mistakes; every UI says so next to its findings
 *   stock        the raw blank, in work (part) coordinates
 *   workholding  vise body, jaws, zero-point plate / riser, chuck jaws, clamps,
 *                in work coords; each its own solid with a role, so a move
 *                into a jaw is told apart from one into the vise body
 *   setup        where the stock sits: the target's bounds grown by stock on
 *                each side, grip depth in the jaws (stockFromSetup); the
 *                stock must equal it (checkStockSetup)
 *   workholdingSpec  the vise / chuck maker's published data (jaw width,
 *                recommended grip depth, clamping force) with sources
 *   workOffsets  where each G54.. zero sits in MACHINE coordinates
 *   tools        T number, H/D registers, type, diameter, gauge length
 *   machine      a built-in or inline machine preset: axes + travel limits,
 *                kinematics, controller dialect, spindle limit
 *
 * A 3D machine model is optional and never required. The checks and the
 * visualizer use the machine's axes, limits, kinematics and dialect.
 *
 * Schema id: "jobline.revpack/2". The v1 manifest (fixtureMode 'none', gcode +
 * goal models only) is still read by scripts/revpack-visualizer-harness.ts.
 */

export const REVPACK_SCHEMA = 'jobline.revpack/2';

export type RevPackUnits = 'in' | 'mm';
export type Vec3 = [number, number, number];

/**
 * What a workholding solid is. The checks report a move into each by role
 * (rapid-into-jaw vs rapid-into-vise-body), and the viewers colour and style
 * each role on its own (hardened jaws, darker body, riser / zero-point plate).
 */
export type WorkholdingRole =
  | 'vise-body' | 'jaw' | 'fixed-jaw' | 'moving-jaw' | 'zero-point' | 'riser'
  | 'parallel' | 'fixture' | 'chuck-jaw' | 'clamp';

export const WORKHOLDING_ROLES: WorkholdingRole[] = [
  'vise-body', 'jaw', 'fixed-jaw', 'moving-jaw', 'zero-point', 'riser', 'parallel', 'fixture', 'chuck-jaw', 'clamp',
];

/** The viewer object a role belongs to: jaws, the fixture / vise body, or the zero-point / riser stack. */
export type WorkholdingObject = 'jaws' | 'fixture' | 'zeroPoint';

export function workholdingObject(role: WorkholdingRole | undefined): WorkholdingObject {
  if (role === 'jaw' || role === 'fixed-jaw' || role === 'moving-jaw' || role === 'chuck-jaw') return 'jaws';
  if (role === 'zero-point' || role === 'riser') return 'zeroPoint';
  return 'fixture';
}

/** Axis-aligned box in work coordinates. */
export interface RevPackBox {
  name: string;
  min: Vec3;
  max: Vec3;
  /** What this solid is (workholding only). */
  role?: WorkholdingRole;
}

/** A turned blank or chuck jaw envelope: a cylinder on the spindle (Z) axis. */
export interface RevPackCylinder {
  name: string;
  /** Diameter, program units. */
  diameter: number;
  /** Z extent in work coordinates (zMin < zMax). */
  zMin: number;
  zMax: number;
  /** For a bore through the part / jaws that leave the centre open. */
  innerDiameter?: number;
  /** What this solid is (workholding only). */
  role?: WorkholdingRole;
}

/**
 * The published data of the workholding device, so the checks can hold the
 * setup to the maker's recommendation. Dimensions are in the pack's units.
 */
export interface RevPackWorkholdingSpec {
  manufacturer: string;
  model: string;
  /** Item number as the maker lists it. */
  itemNo?: string;
  kind: 'self-centering-vise' | 'vise' | 'chuck' | 'fixture';
  jawWidth?: number;
  /** Jaw top above the vise's bottom face. */
  overallHeight?: number;
  /** Recommended (minimum) depth the stock sits in the jaws. */
  recommendedGripDepth?: number;
  /** Form-fit grip (pre-stamped serration) rather than friction. */
  gripMethod?: 'form-fit-stamped' | 'serrated' | 'smooth' | 'dovetail';
  clampingRange?: [number, number];
  clampingForceN?: number;
  maxTorqueNm?: number;
  /** Where every number above came from. */
  sources: string[];
  notes?: string;
}

/**
 * Where the stock really sits, stated the way a setup sheet states it: the
 * target's bounds grown by stock on each side, with the grip (and any cut-off
 * allowance) below the part. The pack's stock must equal this envelope; the
 * viewers draw the stock from it and the parity tests prove it.
 */
export interface RevPackSetup {
  /** Where the work zero (G54...) is on the part, in words. */
  partZero: string;
  /** Box stock: material outside the target on each side (all >= 0). */
  stockOffsets?: { xMin: number; xMax: number; yMin: number; yMax: number; zMin: number; zMax: number };
  /** Bar stock: radial stock and stock past each end of the target. */
  barOffsets?: { radial: number; zMin: number; zMax: number };
  /** Depth the stock sits in the jaws, measured up from the stock bottom. */
  gripDepth?: number;
  /** Axis the jaws close along. */
  clampAxis?: 'X' | 'Y';
}

export interface RevPackTool {
  t: number;
  /** Tool-length register. Defaults to t. */
  h?: number;
  /** Cutter-comp register. */
  d?: number;
  type: string;
  diameter: number;
  /** Gauge length: spindle gauge line to tip. */
  gaugeLength: number;
  /** Flute / cutting length, for display only. */
  fluteLength?: number;
  maxRpm?: number;
  description?: string;
}

export interface RevPackRotaryAxis {
  name: 'A' | 'B' | 'C';
  /** Unit vector the axis turns about, in machine coordinates. */
  axis: Vec3;
  /** True for an axis that turns the TABLE (moves the part), false for a head axis. */
  table: boolean;
}

export interface RevPackMachine {
  /** Built-in preset id (src/presets/presetLibrary.ts) this machine is based on. */
  presetId?: string;
  name: string;
  /** Controller dialect: 'haas', 'fanuc', 'okuma', 'siemens', ... */
  dialect: string;
  controlModel?: string;
  machineClass: 'mill' | 'lathe' | 'mill-turn' | 'grinder' | 'laser';
  /** Travel limits in machine coordinates, program units (degrees for rotaries). */
  axes: Array<{ name: 'X' | 'Y' | 'Z' | 'A' | 'B' | 'C'; min: number; max: number }>;
  /** Kinematic chain, e.g. 'table-table B/C (C on B)'. Display + docs. */
  kinematics: string;
  /**
   * Rotary axes and the vector each turns about. Order matters: listed from
   * the part outward (C on B: C first). Used to map a TCPC point to machine
   * linear axes.
   */
  rotaries?: RevPackRotaryAxis[];
  /**
   * Where the rotary centrelines meet, in machine coordinates (Haas MRZP,
   * settings 255-257). Linear positions for tilted work are computed about it.
   */
  rotaryCenter?: Vec3;
  spindleMaxRpm?: number;
  /** Machine Z the spindle must be at (or above) before a tool change. Mill only. */
  toolChangeZ?: number;
  /** Lathe: the work-coordinate point the turret must clear before indexing. */
  toolChangePosition?: { x: number; z: number };
  /** G-code that turns TCPC on, e.g. 'G234' (Haas) or 'G43.4' (Fanuc). */
  tcpcOn?: string;
  /** Dynamic work offset code for 3+2, e.g. 'G254' (Haas) or 'G68.2' (Fanuc). */
  dwoOn?: string;
  /** Optional 3D model. Never required. */
  modelFile?: string;
}

export interface RevPack {
  schema: typeof REVPACK_SCHEMA;
  id: string;
  name: string;
  units: RevPackUnits;
  program: { file: string; dialect: string };
  target?: RevPackTarget;
  /**
   * 'seeded-errors': a harness pack whose program has deliberate mistakes so
   * the checks can be proven to catch them. UIs label it as a seeded test pack.
   */
  purpose?: 'part' | 'seeded-errors';
  /** Box stock (mill) or a cylinder (lathe). */
  stock: RevPackBox | RevPackCylinder;
  workholding: Array<RevPackBox | RevPackCylinder>;
  /** Work offset name -> machine coordinates of that work zero. */
  workOffsets: Record<string, { x: number; y?: number; z: number }>;
  tools: RevPackTool[];
  machine: RevPackMachine;
  /** Clearance kept above stock for rapids/approaches, program units. */
  clearance?: number;
  /** How the stock is placed around the target and held (see RevPackSetup). */
  setup?: RevPackSetup;
  /** Published data of the vise / chuck / fixture holding the part. */
  workholdingSpec?: RevPackWorkholdingSpec;
  /** What the harness expects of this pack. */
  expect?: { clean?: boolean; findingIds?: string[] };
}

export type RevPackTargetFormat = 'stl' | 'step' | 'parasolid-text';

export interface RevPackTarget {
  /** The preferred model, relative to the revpack.json. */
  file: string;
  format: RevPackTargetFormat;
  /** STL of the same solid, for hosts without a STEP/Parasolid reader. */
  stl?: string;
}

/** The STL a host without a B-rep reader should load, or undefined. */
export function targetStlFile(pack: Pick<RevPack, 'target'>): string | undefined {
  const target = pack.target;
  if (!target) return undefined;
  if (target.format === 'stl') return target.file;
  return target.stl;
}

/** True for a seeded-errors harness pack (its findings are intentional). */
export function isSeededTestPack(pack: Pick<RevPack, 'purpose' | 'expect'>): boolean {
  return pack.purpose === 'seeded-errors';
}

export const SEEDED_TEST_PACK_LABEL = 'Seeded test pack: errors are intentional';

export function isCylinder(shape: RevPackBox | RevPackCylinder): shape is RevPackCylinder {
  return typeof (shape as RevPackCylinder).diameter === 'number';
}

export interface RevPackValidation {
  ok: boolean;
  errors: string[];
}

/** Structural validation: what a harness needs before it can trust a pack. */
export function validateRevPack(raw: unknown): RevPackValidation {
  const errors: string[] = [];
  const pack = raw as Partial<RevPack>;
  if (!pack || typeof pack !== 'object') return { ok: false, errors: ['not an object'] };
  if (pack.schema !== REVPACK_SCHEMA) errors.push(`schema must be "${REVPACK_SCHEMA}"`);
  if (!pack.id) errors.push('id is required');
  if (pack.units !== 'in' && pack.units !== 'mm') errors.push('units must be "in" or "mm"');
  if (!pack.program?.file) errors.push('program.file is required');
  if (!pack.stock) errors.push('stock is required');
  if (!Array.isArray(pack.workholding)) errors.push('workholding must be an array (empty for none)');
  if (!pack.workOffsets || Object.keys(pack.workOffsets).length === 0) errors.push('at least one work offset is required');
  if (!Array.isArray(pack.tools) || pack.tools.length === 0) errors.push('tools must list every tool the program calls');
  const machine = pack.machine;
  if (!machine) {
    errors.push('machine is required');
  } else {
    if (!machine.dialect) errors.push('machine.dialect is required');
    if (!Array.isArray(machine.axes) || machine.axes.length < 2) errors.push('machine.axes needs travel limits');
    for (const axis of machine.axes ?? []) {
      if (!(axis.max > axis.min)) errors.push(`machine axis ${axis.name}: max must exceed min`);
    }
    if (!machine.kinematics) errors.push('machine.kinematics is required');
  }
  if (pack.target) {
    const formats: RevPackTargetFormat[] = ['stl', 'step', 'parasolid-text'];
    if (!pack.target.file) errors.push('target.file is required when target is given');
    if (!formats.includes(pack.target.format)) errors.push(`target.format must be one of ${formats.join(', ')}`);
  }
  if (pack.purpose !== undefined && pack.purpose !== 'part' && pack.purpose !== 'seeded-errors') {
    errors.push('purpose must be "part" or "seeded-errors"');
  }
  for (const shape of pack.workholding ?? []) {
    if (shape && shape.role !== undefined && !WORKHOLDING_ROLES.includes(shape.role)) errors.push(`workholding "${shape.name}": role must be one of ${WORKHOLDING_ROLES.join(', ')}`);
  }
  const offsets = pack.setup?.stockOffsets ?? pack.setup?.barOffsets;
  if (offsets && Object.values(offsets).some(v => !(typeof v === 'number' && v >= 0))) errors.push('setup stock offsets must be numbers >= 0');
  if (pack.setup?.gripDepth !== undefined && !(pack.setup.gripDepth >= 0)) errors.push('setup.gripDepth must be >= 0');
  for (const tool of pack.tools ?? []) {
    if (!(tool.diameter > 0)) errors.push(`T${tool.t}: diameter must be > 0`);
    if (pack.machine?.machineClass !== 'laser' && !(tool.gaugeLength > 0)) errors.push(`T${tool.t}: gaugeLength must be > 0`);
  }
  return { ok: errors.length === 0, errors };
}

// ─── stock from the setup ────────────────────────────────────────────────────

export interface Bounds3 { min: Vec3; max: Vec3 }

/** The stock envelope the setup states: the target's bounds grown by the offsets. */
export function stockFromSetup(setup: RevPackSetup, target: Bounds3): RevPackBox | RevPackCylinder | undefined {
  if (setup.stockOffsets) {
    const o = setup.stockOffsets;
    return {
      name: 'stock (from setup)',
      min: [target.min[0] - o.xMin, target.min[1] - o.yMin, target.min[2] - o.zMin],
      max: [target.max[0] + o.xMax, target.max[1] + o.yMax, target.max[2] + o.zMax],
    };
  }
  if (setup.barOffsets) {
    const o = setup.barOffsets;
    const radius = Math.max(Math.abs(target.min[0]), Math.abs(target.max[0]), Math.abs(target.min[1]), Math.abs(target.max[1]));
    return { name: 'stock (from setup)', diameter: 2 * (radius + o.radial), zMin: target.min[2] - o.zMin, zMax: target.max[2] + o.zMax };
  }
  return undefined;
}

/** Axis-aligned bounds of a pack stock (a bar is its bounding box). */
export function stockBounds(stock: RevPackBox | RevPackCylinder): Bounds3 {
  if (isCylinder(stock)) {
    const r = stock.diameter / 2;
    return { min: [-r, -r, stock.zMin], max: [r, r, stock.zMax] };
  }
  return { min: [...stock.min] as Vec3, max: [...stock.max] as Vec3 };
}

/**
 * The gripped stock region: the bottom `gripDepth` of a box stock, the
 * material the jaws' serration engages. Undefined without a grip depth.
 */
export function grippedRegion(pack: Pick<RevPack, 'stock' | 'setup'>): RevPackBox | undefined {
  const depth = pack.setup?.gripDepth;
  if (!depth || depth <= 0 || isCylinder(pack.stock)) return undefined;
  const s = pack.stock;
  return { name: 'gripped stock (in the jaws)', min: [s.min[0], s.min[1], s.min[2]], max: [s.max[0], s.max[1], Math.min(s.max[2], s.min[2] + depth)] };
}

export interface StockSetupCheck {
  /** Stock bounds contain the target bounds (within tol). */
  containsTarget: boolean;
  /** Stock equals the setup's envelope (within tol); true when the pack states no setup offsets. */
  matchesSetup: boolean;
  /** Largest difference between the stock and the setup envelope. */
  maxDelta: number;
  expected?: Bounds3;
  actual: Bounds3;
  errors: string[];
}

/** Is the pack's stock exactly where its setup says, with the target inside it? */
export function checkStockSetup(pack: Pick<RevPack, 'stock' | 'setup' | 'units'>, target: Bounds3, tol = pack.units === 'mm' ? 0.01 : 0.0005): StockSetupCheck {
  const actual = stockBounds(pack.stock);
  const errors: string[] = [];
  let containsTarget = true;
  for (let k = 0; k < 3; k++) {
    if (target.min[k] < actual.min[k] - tol || target.max[k] > actual.max[k] + tol) containsTarget = false;
  }
  if (!containsTarget) errors.push(`target ${JSON.stringify(target)} is not inside the stock ${JSON.stringify(actual)}`);
  const envelope = pack.setup ? stockFromSetup(pack.setup, target) : undefined;
  const expected = envelope ? stockBounds(envelope) : undefined;
  let maxDelta = 0;
  if (expected) {
    for (let k = 0; k < 3; k++) maxDelta = Math.max(maxDelta, Math.abs(expected.min[k] - actual.min[k]), Math.abs(expected.max[k] - actual.max[k]));
  }
  const matchesSetup = !expected || maxDelta <= tol;
  if (!matchesSetup) errors.push(`stock differs from the setup envelope by ${maxDelta}`);
  return { containsTarget, matchesSetup, maxDelta, expected, actual, errors };
}

/**
 * Default setup for a target uploaded without a pack (a shop part opened on
 * its own, e.g. the AR4 parts): 3 mm of stock on the sides, 1 mm on top, and
 * 3 mm grip + 1 mm cut-off allowance below - the Makro-Grip clamping depth.
 * The VS Code visualizer and the hub both draw an uploaded part's stock from it.
 */
export function uploadSetup(units: RevPackUnits): RevPackSetup {
  const k = units === 'mm' ? 1 : 1 / 25.4;
  const r = (v: number) => Math.round(v * k * 1e6) / 1e6;
  return {
    partZero: "the part file's own origin (an upload keeps the model's coordinates)",
    stockOffsets: { xMin: r(3), xMax: r(3), yMin: r(3), yMax: r(3), zMin: r(4), zMax: r(1) },
    gripDepth: r(3),
    clampAxis: 'Y',
  };
}
