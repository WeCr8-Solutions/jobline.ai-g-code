/**
 * `.jblmachine` — the JobLine machine setup file, shared by the g-code extension
 * and jobline.ai-CAM.
 *
 * This file is kept byte-for-byte identical in both repositories:
 *   g-code: src/presets/jblMachine.ts
 *   CAM:    src/core/persistence/jblMachine.ts
 * It has no imports so it compiles under either toolchain. Change it in one
 * repository, copy it to the other, and bump JBL_MACHINE_FORMAT_VERSION when a
 * field changes meaning. The JSON Schema for the file lives at
 * schemas/jblmachine.schema.json in both repositories.
 *
 * A file holds one machine preset inside CAM's JobLineMachineEnvelope:
 *
 *   { "version": "1.0", "savedAt": 1767225600000, "fileType": "machine",
 *     "extension": ".jblmachine", "machine": { ...JobLineMachinePreset } }
 *
 * The reader is deliberately forgiving: it also accepts a bare preset object
 * (no envelope) and fills defaults for anything optional, so a hand-written file
 * or one from an older build still loads. It only rejects a file it cannot turn
 * into a usable preset, and says why.
 */

export const JBL_MACHINE_EXTENSION = '.jblmachine';
export const JBL_MACHINE_FORMAT_VERSION = '1.0';

/** Control dialects both tools understand. Matches the extension's ControlType. */
export const JBL_CONTROL_FAMILIES = [
  'fanuc', 'haas', 'siemens', 'mazak', 'okuma', 'mitsubishi', 'heidenhain',
  'manual', 'unknown', 'fanuc-robot', 'abb',
] as const;
export type JblControlFamily = typeof JBL_CONTROL_FAMILIES[number];

/** Broad machine profile. Matches the extension's `jobline.machineType` setting. */
export const JBL_MACHINE_CLASSES = ['mill', 'lathe', 'mill-turn', 'grinder'] as const;
export type JblMachineClass = typeof JBL_MACHINE_CLASSES[number];

export type JblUnits = 'inch' | 'metric';
export type JblWorkholding = 'none' | 'vise' | 'chuck';
export type JblAxisName = 'X' | 'Y' | 'Z' | 'A' | 'B' | 'C';

/** Same shape as CAM's MachineAxis. Limits are in the preset's units (degrees for rotaries). */
export interface JblMachineAxis {
  name: JblAxisName;
  min: number;
  max: number;
}

export interface JblMachineCapabilities {
  fourthAxis: boolean;
  fiveAxisSimultaneous: boolean;
  liveTooling: boolean;
  yAxisTurn: boolean;
  subSpindle: boolean;
  probing: boolean;
  throughSpindleCoolant: boolean;
  barFeeder: boolean;
}

export interface JobLineMachinePreset {
  /** Stable id, unique within a library. Lowercase slug. */
  id: string;
  /** What the machinist calls it, e.g. "Cell 3 — Haas VF-2". */
  name: string;
  manufacturer?: string;
  model?: string;
  machineClass: JblMachineClass;
  /** Detailed kind, e.g. "3-Axis Vertical Mill", "Turn Center (2-Axis)". */
  machineKind: string;
  control: {
    family: JblControlFamily;
    /** Specific control model, e.g. "31i-B", "NGC", "840D sl". */
    model?: string;
  };
  units: JblUnits;
  axes: JblMachineAxis[];
  spindleMaxRpm?: number;
  toolCapacity?: number;
  capabilities: JblMachineCapabilities;
  workholding: JblWorkholding;
  /** Post processor id the CAM side should use for this machine. */
  postProcessor?: string;
  notes?: string;
}

export interface JobLineMachineFile {
  version: string;
  savedAt: number;
  fileType: 'machine';
  extension: '.jblmachine';
  machine: JobLineMachinePreset;
}

export type JblMachineParseResult =
  | { ok: true; preset: JobLineMachinePreset; warnings: string[] }
  | { ok: false; error: string };

export const DEFAULT_CAPABILITIES: JblMachineCapabilities = {
  fourthAxis: false,
  fiveAxisSimultaneous: false,
  liveTooling: false,
  yAxisTurn: false,
  subSpindle: false,
  probing: false,
  throughSpindleCoolant: false,
  barFeeder: false,
};

/** Detailed kinds offered in pickers. Any other string is still accepted. */
export const JBL_MACHINE_KINDS: ReadonlyArray<{ kind: string; machineClass: JblMachineClass }> = [
  { kind: '3-Axis Vertical Mill', machineClass: 'mill' },
  { kind: '4-Axis Mill', machineClass: 'mill' },
  { kind: '5-Axis Mill (Trunnion)', machineClass: 'mill' },
  { kind: '5-Axis Mill (Rotary Table)', machineClass: 'mill' },
  { kind: 'Turn Center (2-Axis)', machineClass: 'lathe' },
  { kind: '5-Axis Mill-Turn', machineClass: 'mill-turn' },
  { kind: 'Multi-Spindle Transfer', machineClass: 'mill-turn' },
  { kind: 'Grinding Center', machineClass: 'grinder' },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Lowercase slug usable as a preset id and a file name. */
export function slugifyPresetId(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'machine';
}

/** Broad class a detailed kind belongs to, e.g. "Turn Center (2-Axis)" → "lathe". */
export function machineClassForKind(kind: string): JblMachineClass {
  const known = JBL_MACHINE_KINDS.find(entry => entry.kind.toLowerCase() === kind.trim().toLowerCase());
  if (known) return known.machineClass;
  const text = kind.toLowerCase();
  if (/mill[\s-]*turn|multi[\s-]*spindle|swiss/.test(text)) return 'mill-turn';
  if (/lathe|turn/.test(text)) return 'lathe';
  if (/grind/.test(text)) return 'grinder';
  return 'mill';
}

/** Default detailed kind for a broad class. */
export function defaultKindForClass(machineClass: JblMachineClass): string {
  switch (machineClass) {
    case 'lathe': return 'Turn Center (2-Axis)';
    case 'mill-turn': return '5-Axis Mill-Turn';
    case 'grinder': return 'Grinding Center';
    default: return '3-Axis Vertical Mill';
  }
}

/**
 * Control family from a free-form control name, as CAM's MachineRecord.control,
 * the hub's MachineLibraryEntry.control_type, or a person types it:
 * "Fanuc 31i" → fanuc, "HAAS" → haas, "Sinumerik 840D" → siemens.
 */
export function controlFamilyFromName(name: string | undefined | null): JblControlFamily {
  const text = String(name ?? '').trim().toLowerCase();
  if (!text) return 'unknown';
  if ((JBL_CONTROL_FAMILIES as readonly string[]).includes(text)) return text as JblControlFamily;
  if (/fanuc.*(robot|r-30)|r-30i/.test(text)) return 'fanuc-robot';
  if (/\babb\b|rapid|irc5|omnicore/.test(text)) return 'abb';
  if (/fanuc/.test(text)) return 'fanuc';
  if (/haas|ngc/.test(text)) return 'haas';
  if (/siemens|sinumerik/.test(text)) return 'siemens';
  if (/mazak|mazatrol|smooth/.test(text)) return 'mazak';
  if (/okuma|osp/.test(text)) return 'okuma';
  if (/mitsubishi|meldas/.test(text)) return 'mitsubishi';
  if (/heidenhain|tnc/.test(text)) return 'heidenhain';
  if (/manual|dro/.test(text)) return 'manual';
  return 'unknown';
}

function defaultWorkholding(machineClass: JblMachineClass): JblWorkholding {
  return machineClass === 'lathe' || machineClass === 'mill-turn' ? 'chuck' : 'vise';
}

const AXIS_NAMES: readonly JblAxisName[] = ['X', 'Y', 'Z', 'A', 'B', 'C'];

function readAxes(value: unknown, warnings: string[]): JblMachineAxis[] {
  if (!Array.isArray(value)) return [];
  const axes: JblMachineAxis[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const name = str(raw.name)?.toUpperCase() as JblAxisName | undefined;
    const min = num(raw.min);
    const max = num(raw.max);
    if (!name || !AXIS_NAMES.includes(name) || min === undefined || max === undefined) {
      warnings.push(`Skipped an axis entry that is not {name: X|Y|Z|A|B|C, min, max}.`);
      continue;
    }
    if (axes.some(axis => axis.name === name)) {
      warnings.push(`Axis ${name} is listed twice; kept the first.`);
      continue;
    }
    axes.push({ name, min: Math.min(min, max), max: Math.max(min, max) });
  }
  return axes;
}

function readCapabilities(value: unknown, axes: JblMachineAxis[]): JblMachineCapabilities {
  const caps: JblMachineCapabilities = { ...DEFAULT_CAPABILITIES };
  if (isRecord(value)) {
    for (const key of Object.keys(caps) as Array<keyof JblMachineCapabilities>) {
      if (typeof value[key] === 'boolean') caps[key] = value[key] as boolean;
    }
  }
  // A rotary axis in the travel table is a fourth axis whatever the flags say.
  if (axes.some(axis => axis.name === 'A' || axis.name === 'B' || axis.name === 'C')) caps.fourthAxis = true;
  return caps;
}

/** Turn any preset-shaped object into a complete, valid preset. */
export function normalizeMachinePreset(raw: unknown): JblMachineParseResult {
  if (!isRecord(raw)) return { ok: false, error: 'Machine preset must be a JSON object.' };
  const warnings: string[] = [];

  const name = str(raw.name);
  if (!name) return { ok: false, error: 'Machine preset needs a "name".' };

  const rawControl = raw.control;
  let family: JblControlFamily;
  let controlModel: string | undefined;
  if (isRecord(rawControl)) {
    family = controlFamilyFromName(str(rawControl.family));
    controlModel = str(rawControl.model);
  } else {
    // CAM MachineRecord / MachineDefinition store control as one string.
    family = controlFamilyFromName(str(rawControl));
    controlModel = str(rawControl);
  }
  if (family === 'unknown') warnings.push('Control family not recognised; dialect checks will use generic rules.');

  const rawClass = str(raw.machineClass);
  const rawKind = str(raw.machineKind);
  let machineClass: JblMachineClass;
  if (rawClass && (JBL_MACHINE_CLASSES as readonly string[]).includes(rawClass)) {
    machineClass = rawClass as JblMachineClass;
  } else {
    if (rawClass) warnings.push(`Unknown machineClass "${rawClass}"; derived it from machineKind.`);
    machineClass = rawKind ? machineClassForKind(rawKind) : 'mill';
  }
  const machineKind = rawKind ?? defaultKindForClass(machineClass);

  const units: JblUnits = raw.units === 'metric' || raw.units === 'mm' ? 'metric' : 'inch';
  const axes = readAxes(raw.axes ?? raw.axisConfiguration, warnings);
  const workholding: JblWorkholding =
    raw.workholding === 'none' || raw.workholding === 'vise' || raw.workholding === 'chuck'
      ? raw.workholding
      : defaultWorkholding(machineClass);

  const preset: JobLineMachinePreset = {
    id: slugifyPresetId(str(raw.id) ?? name),
    name,
    machineClass,
    machineKind,
    control: controlModel ? { family, model: controlModel } : { family },
    units,
    axes,
    capabilities: readCapabilities(raw.capabilities, axes),
    workholding,
  };
  const manufacturer = str(raw.manufacturer);
  const model = str(raw.model);
  const spindleMaxRpm = num(raw.spindleMaxRpm);
  const toolCapacity = num(raw.toolCapacity);
  const postProcessor = str(raw.postProcessor);
  const notes = str(raw.notes);
  if (manufacturer) preset.manufacturer = manufacturer;
  if (model) preset.model = model;
  if (spindleMaxRpm !== undefined && spindleMaxRpm > 0) preset.spindleMaxRpm = spindleMaxRpm;
  if (toolCapacity !== undefined && toolCapacity >= 0) preset.toolCapacity = Math.round(toolCapacity);
  if (postProcessor) preset.postProcessor = postProcessor;
  if (notes) preset.notes = notes;

  return { ok: true, preset, warnings };
}

/** Parse the text of a `.jblmachine` file (enveloped or bare). */
export function parseJblMachine(text: string): JblMachineParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (err) {
    return { ok: false, error: `Not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (isRecord(data) && 'machine' in data) {
    if (data.fileType !== undefined && data.fileType !== 'machine') {
      return { ok: false, error: `This is a "${String(data.fileType)}" file, not a machine file.` };
    }
    const result = normalizeMachinePreset(data.machine);
    if (result.ok && typeof data.version === 'string' && data.version.split('.')[0] !== JBL_MACHINE_FORMAT_VERSION.split('.')[0]) {
      result.warnings.push(`File format ${data.version} is newer than ${JBL_MACHINE_FORMAT_VERSION}; unknown fields were ignored.`);
    }
    return result;
  }
  return normalizeMachinePreset(data);
}

/** Wrap a preset in the shared envelope. */
export function toJblMachineFile(preset: JobLineMachinePreset, savedAt: number = Date.now()): JobLineMachineFile {
  return {
    version: JBL_MACHINE_FORMAT_VERSION,
    savedAt,
    fileType: 'machine',
    extension: '.jblmachine',
    machine: preset,
  };
}

/** Text for a `.jblmachine` file. */
export function serializeJblMachine(preset: JobLineMachinePreset, savedAt?: number): string {
  return JSON.stringify(toJblMachineFile(preset, savedAt), null, 2) + '\n';
}

/** File name for a preset, e.g. "cell-3-haas-vf-2.jblmachine". */
export function jblMachineFileName(preset: Pick<JobLineMachinePreset, 'id'>): string {
  return `${slugifyPresetId(preset.id)}${JBL_MACHINE_EXTENSION}`;
}

/** One-line description, e.g. "Haas NGC · 3-Axis Vertical Mill · inch". */
export function describeMachinePreset(preset: JobLineMachinePreset): string {
  const label = CONTROL_LABELS[preset.control.family];
  const model = preset.control.model;
  // "Fanuc 31i-B", but not "Fanuc Fanuc 31i-B" when the model already names it.
  const control = !model ? label : model.toLowerCase().includes(label.toLowerCase()) ? model : `${label} ${model}`;
  return [control, preset.machineKind, preset.units].filter(Boolean).join(' · ');
}

export const CONTROL_LABELS: Record<JblControlFamily, string> = {
  fanuc: 'Fanuc',
  haas: 'Haas',
  siemens: 'Siemens',
  mazak: 'Mazak',
  okuma: 'Okuma',
  mitsubishi: 'Mitsubishi',
  heidenhain: 'Heidenhain',
  manual: 'Manual',
  unknown: 'Generic',
  'fanuc-robot': 'Fanuc Robot',
  abb: 'ABB RAPID',
};
