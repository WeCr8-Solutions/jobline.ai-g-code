/**
 * Machine preset library logic that does not need the VS Code API: built-in
 * presets, merging presets found in several places, the settings a preset
 * writes, and whether a program fits the machine it is being evaluated against.
 */

import type { ControlType, MachineType } from '../parser/types';
import {
  DEFAULT_CAPABILITIES,
  JblAxisName,
  JblMachineAxis,
  JobLineMachinePreset,
  machineClassForKind,
  normalizeMachinePreset,
  slugifyPresetId,
} from './jblMachine';

/**
 * Where a preset came from. Earlier entries win when two sources hold the same
 * id, so a job folder can pin its own copy of a shop machine.
 */
export const PRESET_SOURCE_ORDER = ['workspace', 'shared', 'library', 'builtin'] as const;
export type PresetSource = typeof PRESET_SOURCE_ORDER[number];

export const PRESET_SOURCE_LABELS: Record<PresetSource, string> = {
  workspace: 'This workspace',
  shared: 'Shared folders',
  library: 'My presets',
  builtin: 'Built-in',
};

export interface PresetEntry {
  preset: JobLineMachinePreset;
  source: PresetSource;
  /** Absolute file path for file-backed presets. */
  filePath?: string;
}

function builtin(raw: Partial<JobLineMachinePreset> & { name: string; control: JobLineMachinePreset['control'] }): JobLineMachinePreset {
  const result = normalizeMachinePreset({ capabilities: DEFAULT_CAPABILITIES, ...raw });
  if (!result.ok) throw new Error(`Bad built-in preset ${raw.name}: ${result.error}`);
  return result.preset;
}

/** Starting points that cover the controls the extension parses. Copy one to make your own. */
export const BUILTIN_PRESETS: readonly JobLineMachinePreset[] = [
  builtin({
    id: 'builtin-fanuc-3axis-mill', name: 'Fanuc 3-Axis Mill', machineKind: '3-Axis Vertical Mill',
    control: { family: 'fanuc', model: '0i-MF' }, units: 'inch',
    axes: [{ name: 'X', min: -20, max: 0 }, { name: 'Y', min: -16, max: 0 }, { name: 'Z', min: -20, max: 0 }],
  }),
  builtin({
    id: 'builtin-haas-vf-mill', name: 'Haas VF Mill', manufacturer: 'Haas', machineKind: '3-Axis Vertical Mill',
    control: { family: 'haas', model: 'NGC' }, units: 'inch', spindleMaxRpm: 8100, toolCapacity: 20,
    axes: [{ name: 'X', min: -30, max: 0 }, { name: 'Y', min: -16, max: 0 }, { name: 'Z', min: -20, max: 0 }],
    capabilities: { ...DEFAULT_CAPABILITIES, probing: true },
  }),
  builtin({
    id: 'builtin-haas-st-lathe', name: 'Haas ST Lathe', manufacturer: 'Haas', machineKind: 'Turn Center (2-Axis)',
    control: { family: 'haas', model: 'NGC' }, units: 'inch', spindleMaxRpm: 4000, toolCapacity: 12,
  }),
  builtin({
    id: 'builtin-fanuc-lathe', name: 'Fanuc 2-Axis Lathe', machineKind: 'Turn Center (2-Axis)',
    control: { family: 'fanuc', model: '0i-TF' }, units: 'inch',
  }),
  builtin({
    id: 'builtin-okuma-lathe', name: 'Okuma LB Lathe', manufacturer: 'Okuma', machineKind: 'Turn Center (2-Axis)',
    control: { family: 'okuma', model: 'OSP-P300L' }, units: 'inch',
  }),
  builtin({
    id: 'builtin-mazak-mill-turn', name: 'Mazak Integrex Mill-Turn', manufacturer: 'Mazak', machineKind: '5-Axis Mill-Turn',
    control: { family: 'mazak', model: 'SmoothX' }, units: 'metric',
    capabilities: { ...DEFAULT_CAPABILITIES, fourthAxis: true, fiveAxisSimultaneous: true, liveTooling: true, yAxisTurn: true, subSpindle: true },
  }),
  builtin({
    id: 'builtin-siemens-5axis', name: 'Siemens 5-Axis Trunnion', machineKind: '5-Axis Mill (Trunnion)',
    control: { family: 'siemens', model: 'Sinumerik 840D sl' }, units: 'metric',
    axes: [
      { name: 'X', min: -325, max: 325 }, { name: 'Y', min: -260, max: 260 }, { name: 'Z', min: -460, max: 0 },
      { name: 'A', min: -120, max: 120 }, { name: 'C', min: -360, max: 360 },
    ],
    capabilities: { ...DEFAULT_CAPABILITIES, fourthAxis: true, fiveAxisSimultaneous: true, probing: true },
  }),
  builtin({
    id: 'builtin-fanuc-robot', name: 'Fanuc Robot Cell', machineKind: 'Robot Cell', machineClass: 'mill',
    control: { family: 'fanuc-robot', model: 'R-30iB Plus' }, units: 'metric', workholding: 'none',
  }),
  builtin({
    id: 'builtin-abb-robot', name: 'ABB Robot Cell', machineKind: 'Robot Cell', machineClass: 'mill',
    control: { family: 'abb', model: 'OmniCore' }, units: 'metric', workholding: 'none',
  }),
];

/** One entry per id, the highest-priority source winning; sorted by source then name. */
export function mergePresetEntries(entries: PresetEntry[]): PresetEntry[] {
  const rank = (source: PresetSource): number => PRESET_SOURCE_ORDER.indexOf(source);
  const byId = new Map<string, PresetEntry>();
  for (const entry of entries) {
    const existing = byId.get(entry.preset.id);
    if (!existing || rank(entry.source) < rank(existing.source)) byId.set(entry.preset.id, entry);
  }
  return Array.from(byId.values()).sort((a, b) =>
    rank(a.source) - rank(b.source) || a.preset.name.localeCompare(b.preset.name));
}

/** A preset id not already taken, e.g. "haas-vf-2-2". */
export function uniquePresetId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = slugifyPresetId(base);
  if (!used.has(root)) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** The extension settings a preset sets when it is applied. */
export interface PresetSettings {
  controlType: ControlType;
  machineType: MachineType;
  units: 'inch' | 'metric';
  detectedMachineType: string;
}

export function settingsForPreset(preset: JobLineMachinePreset): PresetSettings {
  return {
    controlType: preset.control.family,
    machineType: preset.machineClass,
    units: preset.units,
    detectedMachineType: preset.machineKind,
  };
}

/** Which of the preset's settings the current settings no longer match. */
export function presetOverrides(preset: JobLineMachinePreset, current: Partial<PresetSettings>): Array<keyof PresetSettings> {
  const wanted = settingsForPreset(preset);
  return (Object.keys(wanted) as Array<keyof PresetSettings>).filter(key =>
    current[key] !== undefined && current[key] !== '' && current[key] !== wanted[key]);
}

/** A starting preset built from whatever the settings currently say. */
export function presetFromSettings(name: string, current: Partial<PresetSettings>): JobLineMachinePreset {
  const kind = current.detectedMachineType || undefined;
  const result = normalizeMachinePreset({
    name,
    machineKind: kind,
    machineClass: current.machineType ?? (kind ? machineClassForKind(kind) : 'mill'),
    control: { family: current.controlType ?? 'fanuc' },
    units: current.units ?? 'inch',
  });
  if (!result.ok) throw new Error(result.error);
  return result.preset;
}

export interface ProgramEvidence {
  /** ProgramModel.detectedMachineType, e.g. "Turn Center (2-Axis)". */
  detectedMachineType: string;
  /** VS Code language id of the document. */
  languageId: string;
}

/**
 * Why a program does not fit the active machine, or undefined when it does.
 *
 * Only positive evidence counts. The detector falls back to "3-Axis Vertical
 * Mill" when it finds nothing machine-specific, so a plain G0/G1 program never
 * argues with a lathe preset; a G96 or G71 in a program run against a mill does.
 */
export function programPresetMismatch(preset: JobLineMachinePreset, evidence: ProgramEvidence): string | undefined {
  const family = preset.control.family;
  const isRobotPreset = family === 'fanuc-robot' || family === 'abb';
  if (evidence.languageId === 'fanuc-tp' && family !== 'fanuc-robot') return 'this is a Fanuc robot TP program';
  if (evidence.languageId === 'abb-rapid' && family !== 'abb') return 'this is an ABB RAPID program';
  if (evidence.languageId === 'gcode' && isRobotPreset) return 'this is a CNC G-code program, not a robot program';
  if (evidence.languageId !== 'gcode') return undefined;

  const detected = evidence.detectedMachineType;
  const programClass = machineClassForKind(detected);
  const turns = programClass === 'lathe' || programClass === 'mill-turn';
  const presetTurns = preset.machineClass === 'lathe' || preset.machineClass === 'mill-turn';
  if (turns && !presetTurns) return `it uses turning codes (looks like a ${detected})`;
  if (programClass === 'mill-turn' && preset.machineClass === 'lathe' && !preset.capabilities.liveTooling) {
    return 'it uses polar/cylindrical interpolation, which needs live tooling';
  }

  const rotaries = /5-axis/i.test(detected) ? 2 : /4-axis/i.test(detected) ? 1 : 0;
  if (rotaries > 0 && !presetTurns) {
    const presetRotaries = preset.capabilities.fiveAxisSimultaneous || /5-axis/i.test(preset.machineKind)
      ? 2
      : preset.capabilities.fourthAxis || /4-axis/i.test(preset.machineKind) ? 1 : 0;
    if (presetRotaries < rotaries) return `it programs ${rotaries === 2 ? 'two rotary axes' : 'a rotary axis'} (looks like a ${detected})`;
  }
  return undefined;
}

/**
 * Travel typed as "X30 Y16 Z20" or "30 16 20" → a travel table with machine zero
 * at the top of each linear axis, and rotaries symmetric about zero. Returns
 * undefined for input that is not travel, [] for blank input.
 */
export function parseTravelInput(text: string): JblMachineAxis[] | undefined {
  const trimmed = text.trim();
  if (!trimmed) return [];
  // Labelled ("X30Y16 Z20") when it starts with an axis letter; otherwise bare
  // numbers in X, Y, Z order ("30 16 20", "30x16x20").
  const pairs: Array<[JblAxisName, number]> = /^[XYZABC]/i.test(trimmed)
    ? Array.from(trimmed.matchAll(/([XYZABC])\s*=?\s*(-?\d+(?:\.\d+)?)/gi))
      .map(match => [match[1].toUpperCase() as JblAxisName, Number(match[2])])
    : trimmed.split(/[\s,x×]+/i).filter(Boolean)
      .map((value, index) => [(['X', 'Y', 'Z'] as JblAxisName[])[index], Number(value)]);
  if (pairs.length === 0) return undefined;
  if (pairs.some(([name, value]) => !name || !Number.isFinite(value) || value === 0)) return undefined;
  return pairs.map(([name, value]) => (name === 'A' || name === 'B' || name === 'C')
    ? { name, min: -Math.abs(value), max: Math.abs(value) }
    : { name, min: -Math.abs(value), max: 0 });
}
