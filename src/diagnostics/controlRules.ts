/**
 * Per-control validation rules — pure, framework-free.
 *
 * The generic engine (engine.ts) checks what every ISO control shares: canned
 * cycle Z/R/Q, arc geometry, spindle/coolant at end, travel. This module adds
 * the rules that differ by control: which G-codes exist, macro / parameter
 * syntax and ranges, loop and jump structure, subprogram calls, program
 * numbers and per-block limits. Heidenhain Klartext is not G-code at all and
 * gets its own reader here.
 *
 * Code lists are JobLine's lists, built from the public programming manuals.
 * Machines differ by option and parameter, so "not in the list" is reported
 * as information, never as an error. Hard errors are kept for things that
 * cannot run on that control (unbalanced loops, a jump to a label that does
 * not exist, a variable outside the control's ranges).
 */

import type { EngineDiagnostic } from './engine';

export type ControlId =
  | 'fanuc' | 'haas' | 'siemens' | 'okuma' | 'mazak' | 'fadal'
  | 'mitsubishi' | 'heidenhain' | 'generic';

export interface ControlProfile {
  id: ControlId;
  label: string;
  /** Recognised G-codes as strings ("43.4"). Undefined = no code-list check. */
  gCodes?: Set<string>;
  /** Max M-codes in one block (undefined = not checked). */
  maxMPerBlock?: number;
  /** Max digits in an O program number (undefined = not checked). */
  programNumberDigits?: number;
  /** Macro language used for variables and control flow. */
  macro: 'macroB' | 'siemens' | 'okuma' | 'fadal' | 'linuxcnc' | 'heidenhain';
  /** What the user sees as a summary of the rule set. */
  summary: string;
}

// ── G-code lists ─────────────────────────────────────────────────────────────

function codes(spec: string): Set<string> {
  const out = new Set<string>();
  for (const part of spec.split(/[\s,]+/).filter(Boolean)) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) for (let i = +range[1]; i <= +range[2]; i++) out.add(String(i));
    else out.add(String(parseFloat(part)));
  }
  return out;
}

/** Fanuc 0i/30i M + T series (standard and common options). */
const FANUC_G = codes(`0-4 5 5.1 5.4 7 7.1 8 9 10 10.6 11 12.1 13.1 15 16 17 18 19 20 21 22 23 25 26 27 28 29 30 30.1 31 31.8 32 33 34 35 36 37 37.1 38 39
  40 41 42 40.1 41.1 42.1 41.2 41.3 42.2 43 44 43.1 43.4 43.5 43.7 45 46 47 48 49 49.1 50 50.1 50.2 50.3 51 51.1 51.2 52 53 53.1 54 54.1 54.2 55 56 57 58 59
  60 61 62 63 64 65 66 66.1 67 68 68.1 68.2 69 69.1 70 71 72 73 74 75 76 77 78 79 80 80.4 81 81.4 82 83 84 84.2 84.3 85 86 87 88 89 90 91 91.1 92 92.1 93 94 95 96 96.1 96.2 96.3 96.4 97 98 99
  107 112 113 160 161`);

/** Haas NGC mill + lathe (Haas operator manuals, G-code chapter). */
const HAAS_G = codes(`0-4 9 10 12 13 14 15 17 18 19 20 21 28 29 31 32 35 36 37 40 41 42 43 43.4 44 47 49 50 51 52 53 54 54.1 55 56 57 58 59 60 61 64 65 68 68.2 69
  70 71 72 73 74 75 76 77 80 81 82 83 84 85 86 87 88 89 90 91 92 93 94 95 96 97 98 99 100 101 103 105 107 110-129 136 141 143 150 151 154 174 184 186 187 195 196 200 211 212 234 241 242 243 249 250 253 254 255 266 268 269`);

/** Mitsubishi M8 / M80 (Fanuc-compatible list plus Mitsubishi extras). */
const MITSUBISHI_G = new Set([...FANUC_G, ...codes('5.1 6.2 7.1 10.3 11.3 12.1 13.1 16 30.1 30.2 30.3 30.4 30.5 43.1 44.1 50.2 51.2 54.4 60 65 66 66.1 67 68.1 69.1 114.1 114.2 114.3 115 116 120.1 121 122 127 160')]);

/** Mazak EIA/ISO on Smooth / Matrix (Fanuc-compatible list plus Mazak extras). */
const MAZAK_G = new Set([...FANUC_G, ...codes('5.1 6.1 6.2 10.9 11 12.1 13.1 15 16 43.4 43.5 47.1 61.1 68.2 109 110 111 112 113 122 123 136 140 141')]);

/** Siemens 840D/828D in Siemens mode (G290). */
const SIEMENS_G = codes(`0-4 9 17 18 19 25 26 33 331 332 34 35 40 41 42 53 54 55 56 57 58 59 60 63 64 70 71 74 75 90 91 93 94 95 96 97 110 111 112 140 141 142 143
  147 148 153 247 248 340 341 347 348 450 451 460 461 462 500 505-599 601 602 603 641 642 643 644 645 700 710 810-819 820-829 931 942 952 961 962 971 972 973`);

export const CONTROL_PROFILES: Record<ControlId, ControlProfile> = {
  fanuc: {
    id: 'fanuc', label: 'Fanuc 0i / 30i', gCodes: FANUC_G, maxMPerBlock: 3, programNumberDigits: 4, macro: 'macroB',
    summary: 'Fanuc M/T G-code list, Macro B (#1–#33 local, #100–#999 common, #1000+ system), WHILE/DO/END 1–3, GOTO targets, O1–O9999, up to 3 M-codes per block (parameter M3B).',
  },
  haas: {
    id: 'haas', label: 'Haas NGC', gCodes: HAAS_G, maxMPerBlock: 3, programNumberDigits: 5, macro: 'macroB',
    summary: 'Haas NGC mill/lathe G-code list (G47, G150, G187, G234, G254…), Macro B, M97 local subprogram targets, O00000–O99999, up to 3 M-codes per block.',
  },
  mazak: {
    id: 'mazak', label: 'Mazak EIA/ISO', gCodes: MAZAK_G, programNumberDigits: 8, macro: 'macroB',
    summary: 'Mazak Smooth/Matrix EIA/ISO G-code list, Macro B, 8-digit program numbers. Mazatrol conversational programs are detected and not checked.',
  },
  mitsubishi: {
    id: 'mitsubishi', label: 'Mitsubishi M8 / M80', gCodes: MITSUBISHI_G, maxMPerBlock: 4, programNumberDigits: 8, macro: 'macroB',
    summary: 'Mitsubishi M8/M80 G-code list (G65/G66/G66.1 macro calls, G120.1…), user macro variables, up to 4 M-codes per block, 8-digit program numbers.',
  },
  fadal: {
    id: 'fadal', label: 'Fadal (Format 2)', macro: 'fadal',
    summary: 'Fadal Format 2: Fadal macro statements (#V1=…, #IF … THEN GOTO :LABEL, :LABEL), G43 needs H, Fanuc Macro B flagged.',
  },
  okuma: {
    id: 'okuma', label: 'Okuma OSP', macro: 'okuma',
    summary: 'Okuma OSP: V variables (VC/VS/V), IF […] N-label and GOTO N-label targets, CALL O-name subprograms ending in RTS, G56 tool length (G43 flagged), # variables flagged.',
  },
  siemens: {
    id: 'siemens', label: 'Siemens 840D / 828D', gCodes: SIEMENS_G, maxMPerBlock: 5, macro: 'siemens',
    summary: 'Siemens mode: R parameters, DEF before the first statement, IF/ENDIF, WHILE/ENDWHILE, FOR/ENDFOR, LOOP/ENDLOOP, REPEAT/UNTIL, GOTOF/GOTOB labels, MCALL cancelled, CYCLExx instead of G81–G89, D-number tool length, up to 5 M per block. G291 ISO mode switches to ISO rules.',
  },
  heidenhain: {
    id: 'heidenhain', label: 'Heidenhain TNC (Klartext / ISO)', macro: 'heidenhain',
    summary: 'Klartext: BEGIN/END PGM name and units, block numbers, TOOL CALL axis, L/C/CC/CR/CT, LBL/LBL 0 and CALL LBL targets, Q0–Q1999, no ISO G-words. Heidenhain ISO: %name G70/G71 header and footer.',
  },
  generic: {
    id: 'generic', label: 'Generic / LinuxCNC', macro: 'linuxcnc',
    summary: 'LinuxCNC O-word structure (sub/endsub, if/endif, while/endwhile, repeat/endrepeat), call targets, bracket balance, group conflicts.',
  },
};

/** Map a setting or .jblmachine family to a rule set. */
export function normalizeControl(controlType: string | undefined, text?: string): ControlId {
  if (text && isHeidenhainKlartext(text)) return 'heidenhain';
  if (text && isHeidenhainIso(text)) return 'heidenhain';
  const c = (controlType ?? 'fanuc').toLowerCase();
  if (c in CONTROL_PROFILES) return c as ControlId;
  if (/haas/.test(c)) return 'haas';
  if (/siemens|sinumerik|840|828/.test(c)) return 'siemens';
  if (/okuma|osp/.test(c)) return 'okuma';
  if (/mazak|mazatrol/.test(c)) return 'mazak';
  if (/fadal/.test(c)) return 'fadal';
  if (/mitsubishi|meldas/.test(c)) return 'mitsubishi';
  if (/heidenhain|tnc|klartext/.test(c)) return 'heidenhain';
  if (/linuxcnc|generic|grbl|marlin/.test(c)) return 'generic';
  return 'fanuc';
}

/**
 * The control a program says it was written for, or null when it doesn't say.
 * Reads the header comments (CAM posts write "HAAS MILL NGC", "OKUMA OSP-P300",
 * "SIEMENS 840D"…) and a few codes only one control uses. The earliest brand
 * named in the header wins, so "(POST: FANUC TO HAAS)" style notes are rare
 * edge cases rather than the rule.
 */
export function detectControlFromProgram(text: string): ControlId | null {
  if (!text) return null;
  if (isHeidenhainKlartext(text) || isHeidenhainIso(text)) return 'heidenhain';
  const head = text.split(/\r?\n/).slice(0, 40);
  const comments = head
    .map(line => [...line.matchAll(/\(([^)]*)\)?/g)].map(m => m[1]).join(' ') + ' ' + (line.match(/;(.*)$/)?.[1] ?? ''))
    .join(' \n ')
    .toUpperCase();
  const brands: Array<[RegExp, ControlId]> = [
    [/\bHAAS\b/, 'haas'],
    [/\bOKUMA\b|\bOSP-?[PE]?\d{2,3}/, 'okuma'],
    [/\bMAZAK\b|\bMAZATROL\b/, 'mazak'],
    [/\bSIEMENS\b|\bSINUMERIK\b|\b8[24]0D\b|\b828D\b/, 'siemens'],
    [/\bFADAL\b/, 'fadal'],
    [/\bMITSUBISHI\b|\bMELDAS\b/, 'mitsubishi'],
    [/\bHEIDENHAIN\b|\bTNC\s?\d{3}\b/, 'heidenhain'],
    [/\bLINUXCNC\b|\bGRBL\b/, 'generic'],
    [/\bFANUC\b/, 'fanuc'],
  ];
  let best: { at: number; id: ControlId } | null = null;
  for (const [re, id] of brands) {
    const m = re.exec(comments);
    if (m && (best === null || m.index < best.at)) best = { at: m.index, id };
  }
  if (best) return best.id;

  // Codes only one control family writes.
  const code = text.slice(0, 20000).replace(/\([^)]*\)?/g, ' ').replace(/;.*$/gm, ' ').toUpperCase();
  if (/\bG187\b|\bG154\s*P\d|\bM97\s*P\d/.test(code)) return 'haas';
  if (/\bCYCLE\d{2,3}\s*\(|\bMSG\s*\(|\bTRANS\b|\bG291\b/.test(code)) return 'siemens';
  return null;
}

export function isHeidenhainKlartext(text: string): boolean {
  return /^\s*\d+\s+BEGIN\s+PGM\s+\S+\s+(MM|INCH)\b/im.test(text.slice(0, 2000));
}

export function isHeidenhainIso(text: string): boolean {
  return /^\s*%\s*[\w-]+\s+G7[01]\s*\*?\s*$/m.test(text.split(/\r?\n/).find(l => l.trim()) ?? '');
}

/** Mazatrol programs are binary/conversational; a text EIA reader can't check them. */
export function looksLikeMazatrol(text: string): boolean {
  const sample = text.slice(0, 2000);
  // eslint-disable-next-line no-control-regex
  const binary = (sample.match(/[\x00-\x08\x0e-\x1f]/g) ?? []).length;
  return binary > 20 || /\bUNo\.\s+MAT\b|\bMAZATROL\b/i.test(sample);
}

/** The generic ISO rule set (engine.ts) does not apply to Klartext. */
export function genericRulesApply(controlType: string, text?: string): boolean {
  return !(text && isHeidenhainKlartext(text)) && !(text && looksLikeMazatrol(text));
}

// ── Shared helpers ───────────────────────────────────────────────────────────

interface Line { index: number; raw: string; code: string }

function info(line: number, message: string): EngineDiagnostic { return { line, severity: 'info', message, source: 'JobLine' }; }
function warn(line: number, message: string): EngineDiagnostic { return { line, severity: 'warning', message, source: 'JobLine' }; }
function err(line: number, message: string): EngineDiagnostic { return { line, severity: 'error', message, source: 'JobLine' }; }

/** Strip comments the way the given family writes them. */
function splitLines(text: string, family: 'iso' | 'siemens' | 'semicolon'): Line[] {
  return text.split(/\r?\n/).map((raw, index) => {
    let code = raw;
    if (family === 'iso') code = code.replace(/\([^)]*\)?/g, ' ').replace(/;.*$/, '');
    else code = code.replace(/;.*$/, '');
    return { index, raw, code: code.trim() };
  });
}

/** G words outside of variable references, e.g. "G43.4", but not G#1 or GOTO. */
function gWords(code: string): string[] {
  const out: string[] = [];
  const re = /(^|[^A-Z_#])G\s*(\d+(?:\.\d+)?)(?![\d.])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) out.push(String(parseFloat(m[2])));
  return out;
}

function mWords(code: string): string[] {
  const out: string[] = [];
  const re = /(^|[^A-Z_#])M\s*(\d+)(?![\d.])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) out.push(String(parseInt(m[2], 10)));
  return out;
}

function bracketBalance(code: string, open: string, close: string): number {
  let depth = 0;
  for (const ch of code) {
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth < 0) return -1; }
  }
  return depth;
}

/** Group conflicts every ISO-style control rejects. */
function groupConflicts(l: Line, gs: string[], out: EngineDiagnostic[]): void {
  const motion = gs.filter(g => ['0', '1', '2', '3'].includes(g));
  if (new Set(motion).size > 1) out.push(err(l.index, `G${motion.join(' and G')} are both motion codes (group 01); only one can be active in a block.`));
  if (gs.includes('90') && gs.includes('91')) out.push(err(l.index, 'G90 and G91 in one block: absolute and incremental conflict.'));
  if (gs.includes('20') && gs.includes('21')) out.push(err(l.index, 'G20 and G21 in one block: inch and metric conflict.'));
  if (gs.includes('41') && gs.includes('42')) out.push(err(l.index, 'G41 and G42 in one block: cutter compensation left and right conflict.'));
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function runControlRules(text: string, controlType: string): EngineDiagnostic[] {
  const control = normalizeControl(controlType, text);
  let diags: EngineDiagnostic[];
  if (control === 'heidenhain') {
    diags = isHeidenhainKlartext(text) ? klartextRules(text) : isHeidenhainIso(text) ? heidenhainIsoRules(text)
      : [info(0, 'Heidenhain selected, but this file has neither a Klartext "BEGIN PGM" line nor an ISO "%name G71" header; no Heidenhain checks ran.')];
  } else if (control === 'mazak' && looksLikeMazatrol(text)) {
    diags = [info(0, 'This looks like a Mazatrol conversational program. JobLine checks Mazak EIA/ISO G-code only.')];
  } else if (control === 'siemens') {
    diags = siemensRules(text);
  } else if (control === 'okuma') {
    diags = okumaRules(text);
  } else if (control === 'fadal') {
    diags = fadalRules(text);
  } else if (control === 'generic') {
    diags = linuxcncRules(text);
  } else {
    diags = macroBRules(text, CONTROL_PROFILES[control]);
  }
  return diags.sort((a, b) => a.line - b.line);
}

// ── Fanuc-family (Fanuc, Haas, Mazak EIA, Mitsubishi) ────────────────────────

function nNumbers(lines: Line[]): Set<number> {
  const set = new Set<number>();
  for (const l of lines) {
    const m = /^\/?\s*N\s*0*(\d+)/i.exec(l.code);
    if (m) set.add(parseInt(m[1], 10));
  }
  return set;
}

/** Fanuc Macro B variable ranges (0i/30i, Haas, Mazak, Mitsubishi share them). */
function macroVariableProblem(n: number, label: string): string | undefined {
  if (n === 0) return `#0 is the null variable and is read-only on ${label}.`;
  if (n >= 34 && n <= 99) return `#${n} is not a ${label} variable (local #1–#33, common #100–#199 and #500–#999, system #1000 and up).`;
  if (n >= 1000 && n <= 1099) return `#${n} is a read-only interface input signal on ${label} (#1000–#1035 inputs; outputs are #1100 and up).`;
  if (n >= 4000 && n <= 4999) return `#${n} is read-only modal information on ${label}.`;
  if (n >= 5001 && n <= 5108) return `#${n} is a read-only position variable on ${label}.`;
  return undefined;
}

function macroBRules(text: string, profile: ControlProfile): EngineDiagnostic[] {
  const out: EngineDiagnostic[] = [];
  const lines = splitLines(text, 'iso');
  const labels = nNumbers(lines);
  const loops: Array<{ id: number; line: number }> = [];
  const seenUnknown = new Set<string>();
  const label = profile.label;

  for (const l of lines) {
    if (!l.code || l.code === '%') continue;
    const code = l.code.toUpperCase();

    // Program number.
    const o = /^O\s*(\d+)/.exec(code);
    if (o && profile.programNumberDigits && o[1].replace(/^0+(?=\d)/, '').length > profile.programNumberDigits) {
      out.push(warn(l.index, `Program number O${o[1]} is longer than ${profile.programNumberDigits} digits, the ${label} limit${profile.id === 'fanuc' ? ' (8-digit O-numbers need the 30i option)' : ''}.`));
    }

    // Brackets.
    const bal = bracketBalance(code, '[', ']');
    if (bal !== 0) out.push(err(l.index, 'Unbalanced [ ] brackets in macro expression.'));

    // Variable writes.
    const assign = /^(?:N\d+\s*)?#\s*(\d+)\s*=/.exec(code);
    if (assign) {
      const problem = macroVariableProblem(parseInt(assign[1], 10), label);
      if (problem) out.push(err(l.index, problem));
    }
    // Variable reads outside the valid ranges (#34–#99 only; system reads are fine).
    for (const m of code.matchAll(/#\s*(\d+)/g)) {
      const n = parseInt(m[1], 10);
      if (n >= 34 && n <= 99 && !(assign && parseInt(assign[1], 10) === n)) {
        out.push(err(l.index, `#${n} is not a ${label} variable (local #1–#33, common #100–#199 and #500–#999).`));
        break;
      }
    }

    // WHILE / DO / END.
    const doM = /\bDO\s*(\d+)\b/.exec(code);
    if (doM) {
      const id = parseInt(doM[1], 10);
      if (id < 1 || id > 3) out.push(err(l.index, `DO ${id}: loop identifiers on ${label} are 1, 2 or 3.`));
      if (loops.some(lp => lp.id === id)) out.push(err(l.index, `DO ${id} is already open on line ${loops.find(lp => lp.id === id)!.line + 1}; nested loops need different identifiers.`));
      loops.push({ id, line: l.index });
      if (loops.length > 3) out.push(err(l.index, `Loops nested ${loops.length} deep; ${label} allows 3.`));
    }
    const endM = /(^|[^A-Z])END\s*(\d+)\b/.exec(code);
    if (endM) {
      const id = parseInt(endM[2], 10);
      const top = loops[loops.length - 1];
      if (!top) out.push(err(l.index, `END ${id} has no matching WHILE … DO ${id}.`));
      else if (top.id !== id) { out.push(err(l.index, `END ${id} closes DO ${top.id} (line ${top.line + 1}); loops must close innermost first.`)); loops.pop(); }
      else loops.pop();
    }

    // GOTO targets.
    const gotoM = /\bGOTO\s*(\d+)\b/.exec(code);
    if (gotoM && !labels.has(parseInt(gotoM[1], 10))) {
      out.push(err(l.index, `GOTO ${gotoM[1]}: there is no N${gotoM[1]} in this program.`));
    }

    const gs = gWords(code);
    const ms = mWords(code);
    groupConflicts(l, gs, out);

    // G43/G44 need an H on this block (Fanuc-family).
    if ((gs.includes('43') || gs.includes('44')) && !/\bH\s*[\d#[]/.test(code)) {
      out.push(warn(l.index, `G${gs.includes('43') ? 43 : 44} without H: ${label} applies the H register from the block, so name it (H = tool number by convention).`));
    }

    // M97 (Haas local subprogram).
    if (ms.includes('97')) {
      if (profile.id !== 'haas') out.push(warn(l.index, `M97 is a Haas local-subprogram call; ${label} uses M98.`));
      else {
        const p = /\bP\s*0*(\d+)/.exec(code);
        if (!p) out.push(err(l.index, 'M97 needs P (the N number of the local subprogram).'));
        else if (!labels.has(parseInt(p[1], 10))) out.push(err(l.index, `M97 P${p[1]}: there is no N${p[1]} in this program.`));
      }
    }
    if (profile.maxMPerBlock && ms.length > profile.maxMPerBlock) {
      out.push(warn(l.index, `${ms.length} M-codes in one block; ${label} accepts up to ${profile.maxMPerBlock}${profile.id === 'fanuc' ? ' (and only one unless parameter M3B is set)' : ''}.`));
    }
    if (profile.id === 'fanuc' && ms.length > 1 && ms.length <= 3) {
      out.push(info(l.index, `${ms.length} M-codes in one block: Fanuc needs parameter M3B (No. 3404#7) for more than one.`));
    }

    // Code list.
    if (profile.gCodes) {
      for (const g of gs) {
        if (!profile.gCodes.has(g) && !seenUnknown.has(g)) {
          seenUnknown.add(g);
          out.push(info(l.index, `G${g} is not in JobLine's ${label} G-code list. Check the control manual or machine options.`));
        }
      }
    }
  }
  for (const lp of loops) out.push(err(lp.line, `DO ${lp.id} is never closed with END ${lp.id}.`));
  return out;
}

// ── Siemens 840D / 828D ──────────────────────────────────────────────────────

function siemensRules(text: string): EngineDiagnostic[] {
  const out: EngineDiagnostic[] = [];
  const lines = splitLines(text, 'siemens');
  // Labels: "NAME:" at block start (after an optional N number), and N numbers.
  const labelAt = new Map<string, number>();
  for (const l of lines) {
    const m = /^(?:N\d+\s+)?([A-Z_][A-Z0-9_]{1,31}):(?!=)/i.exec(l.code);
    if (m && /^N\d+$/i.test(m[1])) continue;
    if (m) labelAt.set(m[1].toUpperCase(), l.index);
    const n = /^N\s*0*(\d+)/i.exec(l.code);
    if (n && !labelAt.has('N' + n[1])) labelAt.set('N' + n[1], l.index);
  }
  const stack: Array<{ kind: string; line: number }> = [];
  const closers: Record<string, string> = { ENDIF: 'IF', ENDWHILE: 'WHILE', ENDFOR: 'FOR', ENDLOOP: 'LOOP', UNTIL: 'REPEAT' };
  let iso = false;
  let firstStatementSeen = false;
  let mcallOpen: number | null = null;
  let hasEnd = false;
  const seenUnknown = new Set<string>();

  for (const l of lines) {
    if (!l.code || l.code === '%' || /^%_N_/i.test(l.code)) continue;
    const code = l.code.toUpperCase();
    // "N10 LABEL: …" and "LABEL: N10 …" are both valid.
    let body = code;
    for (let k = 0; k < 2; k++) body = body.replace(/^N\d+\s*/, '').replace(/^[A-Z_][A-Z0-9_]*:(?!=)\s*/, '');
    const gs = gWords(body);
    if (gs.includes('291')) { iso = true; continue; }
    if (gs.includes('290')) { iso = false; continue; }
    if (iso) continue; // ISO dialect mode: Fanuc rules would apply; not mixed here.
    if (!body) continue;

    // DEF placement.
    if (/^DEF\s/.test(body)) {
      if (firstStatementSeen) out.push(err(l.index, 'DEF must come before the first executable block of the program (840D alarm 12550-family).'));
      continue;
    }
    if (!/^(PROC|EXTERN)\b/.test(body)) firstStatementSeen = true;

    // Fanuc-isms.
    if (/#\s*\d/.test(body)) out.push(err(l.index, 'Fanuc # variables are not valid in Siemens mode. Use R parameters or DEF variables, or switch to ISO mode with G291.'));
    for (const g of gs) {
      const n = parseFloat(g);
      if (n === 43 || n === 44 || n === 49) out.push(warn(l.index, `G${g} is not tool length compensation on 840D: length and radius come from the D number (T1 D1).`));
      else if ((n >= 81 && n <= 89) || n === 73) out.push(warn(l.index, `G${g} is an ISO canned cycle. In Siemens mode use CYCLE${g === '73' ? '83' : g} (or switch to ISO mode with G291).`));
      else if (n === 20 || n === 21) out.push(warn(l.index, `G${g} is ISO-mode only; Siemens mode uses G70/G71 (or G700/G710).`));
      else if (!SIEMENS_G.has(g) && !seenUnknown.has(g)) { seenUnknown.add(g); out.push(info(l.index, `G${g} is not in JobLine's Siemens 840D G-code list.`)); }
    }
    groupConflicts(l, gs, out);
    const ms = mWords(body);
    if (ms.includes('98')) out.push(warn(l.index, 'M98 is ISO-mode. In Siemens mode call a subprogram by name (L123 or MYSUB) or with CALL.'));
    if (ms.includes('99')) out.push(warn(l.index, 'M99 is ISO-mode. End a Siemens subprogram with M17 or RET.'));
    if (ms.some(m => m === '30' || m === '2' || m === '17') || /\bRET\b/.test(body)) hasEnd = true;
    if (ms.length > 5) out.push(warn(l.index, `${ms.length} M functions in one block; 840D accepts up to 5.`));

    // R parameters.
    for (const m of body.matchAll(/(^|[^A-Z_$])R\s*\[?\s*(\d+)\s*\]?\s*=/g)) {
      const n = parseInt(m[2], 10);
      if (n > 999) out.push(err(l.index, `R${n}: R parameters go up to R999 at most (machine data 28050).`));
      else if (n > 99) out.push(info(l.index, `R${n} is beyond the default R0–R99; it needs machine data 28050 raised.`));
    }

    // Parentheses (expressions and cycle calls).
    if (bracketBalance(body, '(', ')') !== 0) out.push(err(l.index, 'Unbalanced ( ) in expression or cycle call.'));
    if (/\bCYCLE\d{2,3}\b(?!\s*\()/.test(body)) out.push(err(l.index, 'CYCLE call without its parameter list in ( ).'));

    // MCALL.
    if (/^MCALL\s*$/.test(body)) mcallOpen = null;
    else if (/^MCALL\s+\w/.test(body)) mcallOpen = l.index;

    // Jumps.
    const jump = /\bGOTO([FBC]?)\s+([A-Z_][A-Z0-9_]*|N\d+)\b/.exec(body);
    if (jump) {
      const target = jump[2].replace(/^N0*/, 'N');
      const at = labelAt.get(target);
      if (at === undefined) out.push(err(l.index, `GOTO${jump[1]} ${jump[2]}: label not found in this program.`));
      else if (jump[1] === 'F' && at < l.index) out.push(err(l.index, `GOTOF searches forward, but ${jump[2]} is above this block. Use GOTOB or GOTO.`));
      else if (jump[1] === 'B' && at > l.index) out.push(err(l.index, `GOTOB searches backward, but ${jump[2]} is below this block. Use GOTOF or GOTO.`));
    }

    // Structured control flow. "IF cond GOTOx label" is the one-line form.
    const kw = /^(IF|ELSE|ENDIF|WHILE|ENDWHILE|FOR|ENDFOR|LOOP|ENDLOOP|REPEAT|UNTIL)\b/.exec(body)?.[1];
    if (kw === 'IF' && !/\bGOTO[FBC]?\b/.test(body)) stack.push({ kind: 'IF', line: l.index });
    else if (kw === 'ELSE') {
      if (stack[stack.length - 1]?.kind !== 'IF') out.push(err(l.index, 'ELSE without an open IF.'));
    } else if (kw && ['WHILE', 'FOR', 'LOOP', 'REPEAT'].includes(kw)) stack.push({ kind: kw, line: l.index });
    else if (kw && closers[kw]) {
      const top = stack.pop();
      if (!top) out.push(err(l.index, `${kw} without an open ${closers[kw]}.`));
      else if (top.kind !== closers[kw]) out.push(err(l.index, `${kw} closes ${top.kind} (line ${top.line + 1}); structures must close innermost first.`));
    }
  }
  for (const s of stack) out.push(err(s.line, `${s.kind} is never closed.`));
  if (mcallOpen !== null) out.push(warn(mcallOpen, 'Modal MCALL is still active at the end of the program; cancel it with a bare MCALL.'));
  const lastLine = lines.filter(l => l.code).pop();
  if (!hasEnd && lastLine) out.push(warn(lastLine.index, 'No M30, M2, M17 or RET: the program has no end.'));
  return out;
}

// ── Okuma OSP ────────────────────────────────────────────────────────────────

function okumaRules(text: string): EngineDiagnostic[] {
  const out: EngineDiagnostic[] = [];
  const lines = splitLines(text, 'iso');
  const labels = new Set<string>();
  const subs = new Map<string, number>();
  const called = new Set<string>();
  for (const l of lines) {
    const n = /^(N[A-Z0-9]+)\b/i.exec(l.code);
    if (n) labels.add(n[1].toUpperCase());
    const o = /^O([A-Z0-9]+)\b/i.exec(l.code);
    if (o) subs.set(o[1].toUpperCase(), l.index);
    const c = /\bCALL\s+O([A-Z0-9]+)\b/i.exec(l.code);
    if (c) called.add(c[1].toUpperCase());
  }
  // A called O-block must end in RTS before the next O-block (or the file end).
  let block: { name: string; line: number; ended: boolean } | null = null;
  const closeBlock = () => {
    if (block && !block.ended && called.has(block.name)) out.push(warn(block.line, `Subprogram O${block.name} is called but has no RTS before the next O-block.`));
  };
  for (const l of lines) {
    if (!l.code || l.code === '%' || /^\$/.test(l.code)) continue;
    const code = l.code.toUpperCase();
    const o = /^O([A-Z0-9]+)\b/.exec(code);
    if (o) { closeBlock(); block = { name: o[1], line: l.index, ended: false }; }
    if (block && (/\bRTS\b/.test(code) || /\bM0?2\b|\bM30\b/.test(code))) block.ended = true;
    if (/#\s*\d/.test(code)) out.push(err(l.index, 'OSP uses V variables (VC1, V1, VS1), not Fanuc # variables.'));
    if (bracketBalance(code, '[', ']') !== 0) out.push(err(l.index, 'Unbalanced [ ] in an OSP expression.'));
    const gs = gWords(code);
    groupConflicts(l, gs, out);
    for (const g of gs) {
      if (g === '43' || g === '44' || g === '49') out.push(warn(l.index, `G${g} is not tool length offset on OSP: use G56 H… (and G53 to cancel).`));
    }
    const jump = /\b(?:GOTO|IF\s*\[[^\]]*\])\s*(N[A-Z0-9]+)\b/.exec(code);
    if (jump && !labels.has(jump[1])) out.push(err(l.index, `Jump to ${jump[1]}: that label is not in this program.`));
    const call = /\bCALL\s+O([A-Z0-9]+)\b/.exec(code);
    if (call && !subs.has(call[1])) out.push(info(l.index, `CALL O${call[1]}: not defined in this file; it must be in a registered subprogram file (.SSB/.SUB).`));
    if (/\bWHILE\b|\bDO\s*\d/.test(code)) out.push(warn(l.index, 'WHILE/DO is Fanuc Macro B; OSP loops are built with IF/GOTO and N-labels.'));
  }
  closeBlock();
  return out;
}

// ── Fadal (Format 2) ─────────────────────────────────────────────────────────

function fadalRules(text: string): EngineDiagnostic[] {
  const out: EngineDiagnostic[] = [];
  const lines = splitLines(text, 'iso');
  const labels = new Set<string>();
  for (const l of lines) {
    const m = /^#?\s*:([A-Z0-9_]+)/i.exec(l.code);
    if (m) labels.add(m[1].toUpperCase());
  }
  for (const l of lines) {
    if (!l.code || l.code === '%') continue;
    const code = l.code.toUpperCase();
    if (/^#\s*\d+\s*=/.test(code) || /\[\s*#\s*\d/.test(code)) {
      out.push(warn(l.index, 'Fanuc Macro B syntax: Fadal macros are written as #V1=…, #R1=…, #IF … THEN GOTO :LABEL.'));
      continue;
    }
    if (code.startsWith('#')) {
      const jump = /GOTO\s*:([A-Z0-9_]+)/.exec(code);
      if (jump && !labels.has(jump[1])) out.push(err(l.index, `GOTO :${jump[1]}: that label is not in this program.`));
      const v = /\bV(\d+)\s*=/.exec(code);
      if (v && (parseInt(v[1], 10) < 1 || parseInt(v[1], 10) > 100)) out.push(err(l.index, `V${v[1]}: Fadal macro variables are V1–V100.`));
      continue; // macro statement, not a motion block
    }
    const gs = gWords(code);
    groupConflicts(l, gs, out);
    if (gs.includes('43') && !/\bH\s*\d/.test(code)) out.push(warn(l.index, 'G43 without H: Fadal applies the H register from the block.'));
  }
  return out;
}

// ── Generic / LinuxCNC ───────────────────────────────────────────────────────

function linuxcncRules(text: string): EngineDiagnostic[] {
  const out: EngineDiagnostic[] = [];
  const lines = splitLines(text, 'iso');
  const stack: Array<{ label: string; kind: string; line: number }> = [];
  const subs = new Set<string>();
  const pairs: Record<string, string> = { endsub: 'sub', endif: 'if', endwhile: 'while', endrepeat: 'repeat' };
  for (const l of lines) {
    const m = /^O\s*(<[^>]+>|\d+)\s+sub\b/i.exec(l.code);
    if (m) subs.add(m[1].toLowerCase());
  }
  for (const l of lines) {
    if (!l.code || l.code === '%') continue;
    if (bracketBalance(l.code, '[', ']') !== 0) out.push(err(l.index, 'Unbalanced [ ] brackets.'));
    const m = /^O\s*(<[^>]+>|\d+)\s+(\w+)/i.exec(l.code);
    if (m) {
      const label = m[1].toLowerCase();
      const kw = m[2].toLowerCase();
      if (['sub', 'if', 'while', 'repeat', 'do'].includes(kw)) stack.push({ label, kind: kw, line: l.index });
      else if (kw === 'call') {
        if (!subs.has(label)) out.push(info(l.index, `o${m[1]} call: no "o${m[1]} sub" in this file; LinuxCNC will look for a file named ${m[1].replace(/[<>]/g, '')}.ngc.`));
      } else if (['elseif', 'else'].includes(kw)) {
        const top = stack[stack.length - 1];
        if (!top || top.kind !== 'if' || top.label !== label) out.push(err(l.index, `o${m[1]} ${kw} without a matching o${m[1]} if.`));
      } else if (kw === 'while' && stack[stack.length - 1]?.kind === 'do') {
        stack.pop();
      } else if (pairs[kw]) {
        const top = stack.pop();
        if (!top) out.push(err(l.index, `o${m[1]} ${kw} without an open o${m[1]} ${pairs[kw]}.`));
        else if (top.label !== label || top.kind !== pairs[kw]) out.push(err(l.index, `o${m[1]} ${kw} closes o${top.label} ${top.kind} (line ${top.line + 1}).`));
      }
      continue;
    }
    groupConflicts(l, gWords(l.code), out);
  }
  for (const s of stack) out.push(err(s.line, `o${s.label} ${s.kind} is never closed.`));
  return out;
}

// ── Heidenhain Klartext ──────────────────────────────────────────────────────

const KLARTEXT_STATEMENTS = /^(BEGIN PGM|END PGM|BLK FORM|TOOL CALL|TOOL DEF|L\b|LN\b|LP\b|C\b|CC\b|CR\b|CT\b|CP\b|CTP\b|CHF\b|RND\b|APPR\b|DEP\b|FPOL\b|FL\b|FLT\b|FC\b|FCT\b|FSELECT\b|CYCL DEF|CYCL CALL|LBL\b|CALL LBL|CALL PGM|FN\s*\d+|Q[LRS]?\d+\s*=|M\d+|STOP\b|PLANE\b|FUNCTION\b|DECLARE\b|SEL\b|TCH PROBE|PATTERN DEF|POLARKIN\b|TRANS\b|CONTOUR DEF|SPA\b|\*|;|PGM CALL|CALL\b|STRING\b|D\d+\b|SQL\b|PRESET\b|FEED\b|M\b)/;

function klartextRules(text: string): EngineDiagnostic[] {
  const out: EngineDiagnostic[] = [];
  const raw = text.split(/\r?\n/);
  const lines = raw.map((r, index) => ({ index, raw: r, code: r.replace(/;.*$/, '').trim() }));
  const nonEmpty = lines.filter(l => l.code || /^\s*\d+\s*;/.test(l.raw));
  const lbls = new Set<string>();
  for (const l of nonEmpty) {
    const m = /^\d+\s+LBL\s+("?[\w-]+"?)/i.exec(l.code);
    if (m) lbls.add(m[1].replace(/"/g, '').toUpperCase());
  }
  const first = nonEmpty[0];
  const last = nonEmpty[nonEmpty.length - 1];
  const begin = first && /^\d+\s+BEGIN\s+PGM\s+(\S+)\s+(MM|INCH)\b/i.exec(first.code);
  if (!begin) out.push(err(first?.index ?? 0, 'A Klartext program starts with "0 BEGIN PGM <name> MM|INCH".'));
  const end = last && /^\d+\s+END\s+PGM\s+(\S+)\s+(MM|INCH)\b/i.exec(last.code);
  if (!end) out.push(err(last?.index ?? 0, 'A Klartext program ends with "<n> END PGM <name> MM|INCH".'));
  else if (begin) {
    if (end[1].toUpperCase() !== begin[1].toUpperCase()) out.push(err(last.index, `END PGM ${end[1]} does not match BEGIN PGM ${begin[1]}.`));
    if (end[2].toUpperCase() !== begin[2].toUpperCase()) out.push(err(last.index, `END PGM is ${end[2]} but BEGIN PGM is ${begin[2]}.`));
  }

  let prevBlock: number | null = null;
  let hasCC = false;
  let lblOpen: { n: string; line: number } | null = null;
  const reportedSeq = { done: false };
  let continuation = false;
  for (const l of nonEmpty) {
    // A block ending in "~" continues on the next line (cycle Q parameters).
    const wasContinuation = continuation;
    continuation = /~\s*$/.test(l.raw.replace(/;[^~]*$/, '')) || /~\s*$/.test(l.code);
    if (wasContinuation) {
      for (const q of l.code.toUpperCase().matchAll(/\bQ(\d+)\b/g)) {
        if (parseInt(q[1], 10) > 1999) out.push(err(l.index, `Q${q[1]}: Q parameters run from Q0 to Q1999.`));
      }
      continue;
    }
    const m = /^(\d+)(?:\s+(.*))?$/.exec(l.code) ?? (/^\d+\s*;/.test(l.raw.trim()) ? [l.raw, /^\d+/.exec(l.raw.trim())![0], ''] as unknown as RegExpExecArray : null);
    if (!m) { out.push(err(l.index, 'Every Klartext block starts with a block number.')); continue; }
    const block = parseInt(m[1], 10);
    const body = (m[2] ?? '').trim().toUpperCase();
    if (prevBlock !== null && block !== prevBlock + 1 && !reportedSeq.done) {
      reportedSeq.done = true;
      out.push(info(l.index, `Block ${block} follows ${prevBlock}; the TNC renumbers on load, but out-of-sequence numbers usually mean a hand edit.`));
    }
    prevBlock = block;
    if (!body) continue;

    if (/(^|\s)G\d{1,3}(\s|$)/.test(body) && !/^(CYCL DEF|FN|Q)/.test(body)) {
      out.push(err(l.index, 'ISO G-word in a Klartext program. Heidenhain ISO is a separate .I program (%name G71 *).'));
      continue;
    }
    if (!KLARTEXT_STATEMENTS.test(body)) {
      out.push(info(l.index, `"${body.split(/\s+/).slice(0, 2).join(' ')}" is not a Klartext statement JobLine knows.`));
      continue;
    }
    if (/^TOOL CALL\b/.test(body)) {
      if (!/^TOOL CALL\s+("[^"]+"|\d+(\.\d+)?|Q[LR]?\d+)?\s*(X|Y|Z)\b/.test(body)) out.push(warn(l.index, 'TOOL CALL without a spindle axis (X, Y or Z): the TNC asks for one, e.g. TOOL CALL 1 Z S3000.'));
    }
    if (/^CC\b/.test(body)) hasCC = true;
    if (/^C\b/.test(body)) {
      if (!hasCC) out.push(err(l.index, 'C (circular arc) needs a circle centre: program CC before it.'));
      if (!/\bDR[+-]/.test(body)) out.push(err(l.index, 'C needs a direction: DR+ (counter-clockwise) or DR- (clockwise).'));
    }
    if (/^CR\b/.test(body)) {
      if (!/\bR[+-]?\d/.test(body)) out.push(err(l.index, 'CR needs a radius R.'));
      if (!/\bDR[+-]/.test(body)) out.push(err(l.index, 'CR needs a direction: DR+ or DR-.'));
    }
    if (/^L\b/.test(body) && /\bR[^LR0\d+-]/.test(body.replace(/\bRND\b/, ''))) {
      out.push(warn(l.index, 'Radius compensation on an L block is R0, RL or RR.'));
    }
    for (const q of body.matchAll(/\bQ(\d+)\b/g)) {
      if (parseInt(q[1], 10) > 1999) out.push(err(l.index, `Q${q[1]}: Q parameters run from Q0 to Q1999.`));
    }
    const lbl = /^LBL\s+("?[\w-]+"?)/.exec(body);
    if (lbl) {
      const n = lbl[1].replace(/"/g, '');
      if (n === '0') lblOpen = null;
      else lblOpen = { n, line: l.index };
    }
    const call = /^CALL LBL\s+("?[\w-]+"?)/.exec(body);
    if (call && !lbls.has(call[1].replace(/"/g, ''))) out.push(err(l.index, `CALL LBL ${call[1]}: there is no LBL ${call[1]} in this program.`));
  }
  if (lblOpen) out.push(warn(lblOpen.line, `LBL ${lblOpen.n} is not closed with LBL 0 before END PGM.`));
  return out;
}

// ── Heidenhain ISO (.I) ──────────────────────────────────────────────────────

function heidenhainIsoRules(text: string): EngineDiagnostic[] {
  const out: EngineDiagnostic[] = [];
  const lines = text.split(/\r?\n/).map((raw, index) => ({ index, code: raw.replace(/;.*$/, '').trim() })).filter(l => l.code);
  const head = /^%\s*([\w-]+)\s+G(7[01])/i.exec(lines[0]?.code ?? '');
  const foot = /^N\d+\s+%\s*([\w-]+)\s+G(7[01])/i.exec(lines[lines.length - 1]?.code ?? '');
  if (!head) return out;
  if (!foot) out.push(err(lines[lines.length - 1].index, `A Heidenhain ISO program ends with "N99999999 %${head[1]} G${head[2]} *".`));
  else {
    if (foot[1].toUpperCase() !== head[1].toUpperCase()) out.push(err(lines[lines.length - 1].index, `Program end %${foot[1]} does not match %${head[1]}.`));
    if (foot[2] !== head[2]) out.push(err(lines[lines.length - 1].index, `Program end is G${foot[2]} but the header is G${head[2]}.`));
  }
  for (const l of lines.slice(1, -1)) {
    if (!/^N\d+/i.test(l.code)) out.push(warn(l.index, 'Heidenhain ISO blocks start with an N block number.'));
    const gs = gWords(l.code);
    groupConflicts({ index: l.index, raw: l.code, code: l.code }, gs, out);
    if (gs.some(g => ['81', '83', '84'].includes(g))) out.push(info(l.index, 'G81/G83/G84 are older ISO cycles on the TNC; current cycles are G200 (drilling), G203 (universal drilling), G207 (rigid tapping).'));
  }
  return out;
}
