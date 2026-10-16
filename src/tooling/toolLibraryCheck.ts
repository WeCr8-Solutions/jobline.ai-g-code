/**
 * Check a parsed program against an imported tool library — pure.
 *
 * Findings:
 *   - a tool the program calls that is not in the library
 *   - T/H mismatch: the length offset called with a tool differs from the
 *     library's length-offset register (or from T when the library has none)
 *   - T/D mismatch: cutter-comp register differs from the library
 *   - the diameter written in the tool-call comment differs from the library
 *
 * Siemens 840D and Heidenhain carry length and radius in the tool call itself
 * (D / TOOL CALL), so H/D register checks are skipped for those controls.
 */

import type { GCodeBlock, ModalState, ToolUsage } from '../parser/types';
import type { EngineDiagnostic } from '../diagnostics/engine';
import type { LibraryTool, ToolLibrary, LengthUnit } from './toolLibrary';

export type ToolStatus = 'ok' | 'missing' | 'mismatch';

export interface ToolLibraryCheckResult {
  diagnostics: EngineDiagnostic[];
  /** Per program tool number. */
  status: Map<number, { status: ToolStatus; library?: LibraryTool; notes: string[] }>;
}

export interface ToolLibraryCheckInput {
  blocks: GCodeBlock[];
  stateAtBlock: ModalState[];
  tools: ToolUsage[];
  library: ToolLibrary;
  controlType?: string;
  /** True when T-words carry an offset (T0101 = tool 1, offset 1). */
  lathe?: boolean;
}

const NO_REGISTER_CONTROLS = new Set(['siemens', 'heidenhain']);

function toMm(value: number, unit: LengthUnit): number {
  return unit === 'in' ? value * 25.4 : value;
}

export function decodeToolNumber(raw: number, lathe: boolean): number {
  return lathe && raw >= 100 ? Math.floor(raw / 100) : raw;
}

export function checkProgramAgainstLibrary(input: ToolLibraryCheckInput): ToolLibraryCheckResult {
  const { blocks, stateAtBlock, tools, library } = input;
  const control = (input.controlType ?? 'fanuc').toLowerCase();
  const lathe = input.lathe ?? false;
  const byNumber = new Map(library.tools.map(t => [t.number, t] as const));
  const diagnostics: EngineDiagnostic[] = [];
  const status: ToolLibraryCheckResult['status'] = new Map();
  const src = `tool library "${library.name}"`;

  const mark = (tool: number, s: ToolStatus, note?: string) => {
    const entry = status.get(tool) ?? { status: 'ok' as ToolStatus, library: byNumber.get(tool), notes: [] };
    if (s === 'missing' || (s === 'mismatch' && entry.status === 'ok')) entry.status = s;
    if (note) entry.notes.push(note);
    status.set(tool, entry);
  };

  // 1. Tools not in the library, and comment diameter vs library diameter.
  for (const usage of tools) {
    if (!(usage.toolNumber > 0)) continue;
    const lib = byNumber.get(usage.toolNumber);
    const line = usage.lineNumbers[0] ?? 0;
    if (!lib) {
      mark(usage.toolNumber, 'missing', 'not in the library');
      diagnostics.push(diag(line, 'warning', `T${usage.toolNumber} is not in the ${src}. Check the tool number or add it to the library.`));
      continue;
    }
    mark(usage.toolNumber, 'ok');
    if (usage.diameter !== undefined && lib.diameter !== undefined) {
      const programUnit: LengthUnit = (stateAtBlock[line]?.activeUnits ?? 20) === 21 ? 'mm' : 'in';
      const libUnit: LengthUnit = lib.unit ?? programUnit;
      const a = toMm(usage.diameter, programUnit);
      const b = toMm(lib.diameter, libUnit);
      if (Math.abs(a - b) > 0.0125) {
        const note = `comment says Ø${usage.diameter}${programUnit === 'mm' ? ' mm' : '"'}, library says Ø${lib.diameter}${libUnit === 'mm' ? ' mm' : '"'}`;
        mark(usage.toolNumber, 'mismatch', note);
        diagnostics.push(diag(line, 'warning', `T${usage.toolNumber} diameter mismatch: ${note}.`));
      }
    }
  }

  // 2. Offset registers, block by block.
  if (!NO_REGISTER_CONTROLS.has(control)) {
    const lengthCodes = control === 'okuma' ? new Set([56, 43]) : new Set([43, 44]);
    const reported = new Set<string>();
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const state = stateAtBlock[i];
      if (!state) continue;
      const rawTool = block.toolNumber ?? state.activeTool;
      if (rawTool === null || rawTool === undefined || rawTool <= 0) continue;
      const tool = decodeToolNumber(rawTool, lathe);
      const lib = byNumber.get(tool);
      if (!lib) continue;
      const g = block.gCodes.map(c => Math.floor(c.code));
      const h = block.addresses.get('H')?.resolvedValue;
      if (h !== null && h !== undefined && g.some(c => lengthCodes.has(c))) {
        const expected = lib.lengthOffset ?? tool;
        const key = `H:${tool}:${h}`;
        if (h !== expected && !reported.has(key)) {
          reported.add(key);
          const why = lib.lengthOffset !== undefined ? `the library sets H${expected}` : `the library has no length offset, so H${expected} (= T) was expected`;
          mark(tool, 'mismatch', `H${h} called, expected H${expected}`);
          diagnostics.push(diag(block.line, 'warning', `T/H mismatch: T${tool} uses H${h} but ${why}.`));
        }
      }
      const d = block.addresses.get('D')?.resolvedValue;
      if (d !== null && d !== undefined && g.some(c => c === 41 || c === 42) && lib.diameterOffset !== undefined) {
        const key = `D:${tool}:${d}`;
        if (d !== lib.diameterOffset && !reported.has(key)) {
          reported.add(key);
          mark(tool, 'mismatch', `D${d} called, library sets D${lib.diameterOffset}`);
          diagnostics.push(diag(block.line, 'warning', `T/D mismatch: T${tool} uses D${d} but the library sets D${lib.diameterOffset}.`));
        }
      }
    }
  }

  diagnostics.sort((a, b) => a.line - b.line);
  return { diagnostics, status };
}

function diag(line: number, severity: EngineDiagnostic['severity'], message: string): EngineDiagnostic {
  return { line, severity, message, source: 'JobLine' };
}
