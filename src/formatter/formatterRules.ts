/**
 * JobLine G-Code Formatter — pure rules
 *
 * These are the string transforms behind `jobline.formatDocument`. They live
 * apart from formatterProvider.ts so they can be tested without a VS Code host:
 * this module must never import `vscode`.
 *
 * Rules applied in order:
 *  1. Word spacing: insert a space between address words that are jammed together
 *  2. Uppercase G/M: make all G and M codes uppercase
 *  3. Decimal normalization: round coordinates to `decimalPlaces` (when not null)
 *
 * Comment lines and macro assignment lines are left untouched.
 */

// ---------------------------------------------------------------------------
// Number forms
// ---------------------------------------------------------------------------

/**
 * A G-code numeric value, in every form a control actually emits.
 *
 * All four are ordinary Fanuc/Haas output and must be handled together:
 *
 *   5      integer
 *   5.0    full decimal
 *   5.     trailing decimal, no fraction   <- the one that used to corrupt
 *   .5     leading decimal, no integer     <- the one that used to be dropped
 *
 * The earlier pattern `[-+]?\d*\.?\d+` requires a digit AFTER the point, so on
 * `X5.` it matched only `5` and left the `.` behind in the line. Normalising
 * then produced `X5.000.` - a word with two decimal points, which a control
 * rejects or misreads. Order matters: `\d+\.?\d*` must come before `\.\d+` so
 * that `5.` is consumed whole rather than backtracking to a bare `5`.
 */
const NUMBER = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isPureComment(line: string): boolean {
  const t = line.trim();
  return !t || t.startsWith('(') || t.startsWith(';') || t === '%';
}

export function isMacroAssignment(line: string): boolean {
  return /^\s*#\d+\s*=/.test(line);
}

/**
 * Split a line into its code portion and trailing comment.
 * Returns [codePart, commentPart].
 */
export function splitCodeComment(line: string): [string, string] {
  // Find the first unmatched open paren or semicolon
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '(') {
      depth++;
      if (depth === 1) {
        return [line.slice(0, i), line.slice(i)];
      }
    } else if (line[i] === ')') {
      if (depth > 0) depth--;
    } else if (line[i] === ';' && depth === 0) {
      return [line.slice(0, i), line.slice(i)];
    }
  }
  return [line, ''];
}

// ---------------------------------------------------------------------------
// Rule 1 — Word spacing
// ---------------------------------------------------------------------------

/**
 * Inserts a space between consecutive address words that are jammed together.
 * E.g. `G01X1.5Y2.0` -> `G01 X1.5 Y2.0`
 *
 * The break is taken after a digit OR a decimal point, because `X5.Y2.` is
 * valid G-code and the character before `Y` there is `.`, not a digit.
 */
export function applyWordSpacing(code: string): string {
  return code.replace(/([\d.])([A-Za-z])/g, '$1 $2');
}

// ---------------------------------------------------------------------------
// Rule 2 — Uppercase G/M codes
// ---------------------------------------------------------------------------

export function applyUppercaseGM(code: string): string {
  return code.replace(/\b([gGmM])(\d)/g, (_, letter: string, digit: string) =>
    letter.toUpperCase() + digit
  );
}

// ---------------------------------------------------------------------------
// Rule 3 — Decimal normalization
// ---------------------------------------------------------------------------

/**
 * Rounds coordinate values to `decimalPlaces`.
 * Handles: X1.23456 -> X1.235 (with decimalPlaces=3)
 *
 * Program/line numbers, G/M codes, tool and offset words, feed and spindle are
 * deliberately skipped - rounding those changes meaning rather than precision.
 */
export function applyDecimalNormalization(code: string, decimalPlaces: number): string {
  return code.replace(
    new RegExp(String.raw`([A-Za-z])\s*(${NUMBER})`, 'g'),
    (match, letter: string, numStr: string) => {
      if (/^[ONGMTHDLPFSongmthdlpfs]$/.test(letter)) return match;
      const num = parseFloat(numStr);
      if (isNaN(num)) return match;
      return letter + num.toFixed(decimalPlaces);
    }
  );
}

// ---------------------------------------------------------------------------
// Format a single line
// ---------------------------------------------------------------------------

export interface FormatterConfig {
  wordSpacing: boolean;
  uppercaseGM: boolean;
  decimalPlaces: number | null;
}

export function formatLine(line: string, config: FormatterConfig): string {
  // Skip pure comment lines and macro assignments
  if (isPureComment(line) || isMacroAssignment(line)) return line;

  const [code, comment] = splitCodeComment(line);
  let result = code;

  if (config.wordSpacing) {
    result = applyWordSpacing(result);
  }

  if (config.uppercaseGM) {
    result = applyUppercaseGM(result);
  }

  if (config.decimalPlaces !== null) {
    result = applyDecimalNormalization(result, config.decimalPlaces);
  }

  return result + comment;
}

/** Format a whole program. Returns the new text, or null when nothing changed. */
export function formatText(text: string, config: FormatterConfig): string | null {
  const lines = text.split(/\r?\n/);
  const formatted = lines.map(line => formatLine(line, config)).join('\n');
  return formatted === text ? null : formatted;
}
