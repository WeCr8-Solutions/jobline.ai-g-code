/**
 * JobLine Hover Provider
 * Architecture v0.4.0 Section 8.2
 *
 * Shows rich tooltips when hovering over G-codes, M-codes,
 * and address letters. Displays code name, description,
 * and parameter info from the reference data.
 */

import { Tokenizer } from '../parser/tokenizer';
import { GCodeToken } from '../parser/types';

// Load reference data
import * as gcodeRef from '../../data/gcode-reference.json';

interface CodeInfo {
  name: string;
  desc: string;
  group?: string;
}

const gCodeData = gcodeRef.gcodes as Record<string, CodeInfo>;
const mCodeData = gcodeRef.mcodes as Record<string, CodeInfo>;

// Address descriptions
const ADDRESS_INFO: Record<string, string> = {
  X: 'X-axis position',
  Y: 'Y-axis position',
  Z: 'Z-axis position',
  A: 'A-axis (rotary around X)',
  B: 'B-axis (rotary around Y)',
  C: 'C-axis (rotary around Z)',
  I: 'Arc center offset in X (or thread lead on lathe)',
  J: 'Arc center offset in Y',
  K: 'Arc center offset in Z',
  R: 'Canned cycle retract plane / Arc radius',
  Q: 'Peck depth (canned cycles) / Shift amount',
  F: 'Feed rate (IPM, mm/min, IPR, or mm/rev depending on G94/G95)',
  S: 'Spindle speed (RPM or SFM/m-min depending on G96/G97)',
  T: 'Tool number',
  H: 'Tool length offset number',
  D: 'Tool diameter/radius compensation number',
  P: 'Dwell time / Subprogram number / Parameter',
  L: 'Loop count (number of repetitions)',
  N: 'Sequence (line) number',
  O: 'Program number',
  U: 'Incremental X (lathe) / Dwell (some cycles)',
  W: 'Incremental Z (lathe)',
};

const tokenizer = new Tokenizer();

/**
 * Get hover content for a position in a line.
 * Returns markdown string or null if nothing to show.
 */
export function getHoverContent(
  lineText: string,
  lineNumber: number,
  column: number
): string | null {
  const tokenized = tokenizer.tokenizeLine(lineText, lineNumber);

  // Find the token at the cursor position
  const token = tokenized.tokens.find(
    t => column >= t.startCol && column < t.endCol
  );

  if (!token) return null;

  switch (token.type) {
    case 'G':
      return formatGCodeHover(token);
    case 'M':
      return formatMCodeHover(token);
    case 'address':
      return formatAddressHover(token);
    case 'siemensCycle':
      return formatSiemensCycleHover(token);
    case 'comment':
      return null;
    default:
      return null;
  }
}

function formatGCodeHover(token: GCodeToken): string | null {
  const code = token.code;
  if (code === undefined) return null;

  // For subcoded G-codes (G38.2, G54.1, G90.1 etc.), extract from raw text
  const subcodeMatch = token.raw.match(/[Gg]\s*(\d{1,3})(\.\d)/);
  const key = subcodeMatch ? `${subcodeMatch[1]}${subcodeMatch[2]}` : String(code);
  const info = gCodeData[key] ?? gCodeData[String(code)];

  if (!info) {
    return `**G${code}** — Unknown G-code`;
  }

  let md = `**G${code}** — ${info.name}\n\n${info.desc}`;

  // Add parameter hints for canned cycles and probing
  const paramHints = getCycleParameters(code, token.raw);
  if (paramHints) {
    md += `\n\n**Parameters:**\n${paramHints}`;
  }

  return md;
}

function formatMCodeHover(token: GCodeToken): string | null {
  const code = token.code;
  if (code === undefined) return null;

  const key = String(code);
  const info = mCodeData[key];

  if (!info) {
    return `**M${code}** — Unknown M-code`;
  }

  return `**M${code}** — ${info.name}\n\n${info.desc}`;
}

function formatAddressHover(token: GCodeToken): string | null {
  const letter = token.letter?.toUpperCase();
  if (!letter) return null;

  const desc = ADDRESS_INFO[letter];
  if (!desc) return null;

  let md = `**${letter}** — ${desc}`;

  // Show resolved value for macro variables
  if (token.value.kind === 'variable') {
    md += `\n\nMacro variable #${token.value.variableNum}`;
  } else if (token.value.kind === 'expression') {
    md += `\n\nMacro expression (value resolved at runtime)`;
  }

  return md;
}

function formatSiemensCycleHover(token: GCodeToken): string | null {
  const name = token.raw.toUpperCase();

  const siemensCycles: Record<string, string> = {
    'CYCLE81': 'Drilling — Feed to final depth, rapid retract',
    'CYCLE82': 'Drilling with Dwell — Feed to depth, dwell, rapid retract',
    'CYCLE83': 'Deep Hole Drilling — Peck drilling with chip-break or full retract',
    'CYCLE84': 'Rigid Tapping — Synchronized spindle/feed tapping',
    'CYCLE85': 'Boring — Feed in and feed out',
    'CYCLE86': 'Boring with Spindle Stop — Feed in, stop, rapid out',
    'CYCLE97': 'Thread Cutting — Lathe threading cycle',
    'MCALL': 'Modal Cycle Call — Makes next cycle modal (repeats at each position)',
  };

  const desc = siemensCycles[name] ?? 'Siemens cycle call';
  return `**${name}** — ${desc}\n\nSiemens positional parameter syntax: ${name}(param1, param2, ...)`;
}

function getCycleParameters(code: number, raw?: string): string | null {
  // For G38.x, use raw token text to distinguish subcode
  if (Math.floor(code) === 38 && raw) {
    const m = raw.match(/G38\.(\d)/i);
    const sub = m ? parseInt(m[1]) : 2;
    const probeParams: Record<number, string> = {
      2: '`X` `Y` `Z` target position · `F` feed rate · **Alarm** if no contact made',
      3: '`X` `Y` `Z` target position · `F` feed rate · Silent if no contact made',
      4: '`X` `Y` `Z` target position · `F` feed rate · **Alarm** if contact not lost',
      5: '`X` `Y` `Z` target position · `F` feed rate · Silent if contact not lost',
    };
    return probeParams[sub] ?? '`X` `Y` `Z` target · `F` feed rate';
  }

  const params: Record<number, string> = {
    31:  '`X` `Y` `Z` target position · `F` feed rate · Contact result stored in #5061–#5066',
    73: '`Z` final depth · `R` retract plane · `Q` peck depth · `F` feed rate',
    81: '`Z` final depth · `R` retract plane · `F` feed rate',
    82: '`Z` final depth · `R` retract plane · `P` dwell (sec) · `F` feed rate',
    83: '`Z` final depth · `R` retract plane · `Q` peck depth (must be > 0) · `F` feed rate',
    84: '`Z` final depth · `R` retract plane · `F` feed (= S × pitch) · `S` spindle speed',
    85: '`Z` final depth · `R` retract plane · `F` feed rate',
    86: '`Z` final depth · `R` retract plane · `F` feed rate',
    87: '`Z` final depth · `R` retract plane · `F` feed rate',
    88: '`Z` final depth · `R` retract plane · `P` dwell · `F` feed rate',
    89: '`Z` final depth · `R` retract plane · `P` dwell · `F` feed rate',
  };

  return params[code] ?? null;
}
