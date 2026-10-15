/**
 * RevPack: the part/setup package a program is proven against.
 *
 * A program on its own says where the tool goes relative to a work offset. It
 * does not say where the part is, what holds it, which tools are in the
 * magazine, or what machine it runs on. A RevPack carries those, so a program
 * can be checked against the setup it will actually meet:
 *
 *   target       the finished part (STL / Parasolid text), for display and the
 *                cut-envelope comparison
 *   stock        the raw blank, in work (part) coordinates
 *   workholding  vise jaws, chuck jaws, clamps, fixture plates, in work coords
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

/** Axis-aligned box in work coordinates. */
export interface RevPackBox {
  name: string;
  min: Vec3;
  max: Vec3;
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
  target?: { file: string; format: 'stl' | 'parasolid-text' };
  /** Box stock (mill) or a cylinder (lathe). */
  stock: RevPackBox | RevPackCylinder;
  workholding: Array<RevPackBox | RevPackCylinder>;
  /** Work offset name -> machine coordinates of that work zero. */
  workOffsets: Record<string, { x: number; y?: number; z: number }>;
  tools: RevPackTool[];
  machine: RevPackMachine;
  /** Clearance kept above stock for rapids/approaches, program units. */
  clearance?: number;
  /** What the harness expects of this pack. */
  expect?: { clean?: boolean; findingIds?: string[] };
}

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
  for (const tool of pack.tools ?? []) {
    if (!(tool.diameter > 0)) errors.push(`T${tool.t}: diameter must be > 0`);
    if (pack.machine?.machineClass !== 'laser' && !(tool.gaugeLength > 0)) errors.push(`T${tool.t}: gaugeLength must be > 0`);
  }
  return { ok: errors.length === 0, errors };
}
