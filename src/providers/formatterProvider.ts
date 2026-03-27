/**
 * JobLine G-Code Formatter Provider
 *
 * Implements the `jobline.formatDocument` command and registers as a
 * DocumentFormattingEditProvider for the 'gcode' language.
 *
 * Rules applied in order:
 *  1. Word spacing: insert space between consecutive G/M/address words
 *  2. Uppercase G/M: make all G and M codes uppercase
 *  3. Decimal normalization: round coordinates to `jobline.formatter.decimalPlaces`
 *     (only when not null)
 *
 * Comment lines and macro assignment lines are left untouched.
 */

import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPureComment(line: string): boolean {
  const t = line.trim();
  return !t || t.startsWith('(') || t.startsWith(';') || t === '%';
}

function isMacroAssignment(line: string): boolean {
  return /^\s*#\d+\s*=/.test(line);
}

/**
 * Split a line into its code portion and trailing comment.
 * Returns [codePart, commentPart].
 */
function splitCodeComment(line: string): [string, string] {
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

/**
 * Rule 1 — Word spacing.
 * Inserts a space between consecutive address words that are jammed together.
 * Pattern: after any complete word (letter+digits/decimal), insert space before next letter.
 * E.g., G01X1.5Y2.0 → G01 X1.5 Y2.0
 */
function applyWordSpacing(code: string): string {
  // Insert space before any letter that is preceded by a digit or decimal point
  // This separates words like G01X1.5 → G01 X1.5
  return code.replace(/(\d)([A-Za-z])/g, '$1 $2');
}

/**
 * Rule 2 — Uppercase G/M codes.
 * Makes all G and M letter codes uppercase.
 */
function applyUppercaseGM(code: string): string {
  return code.replace(/\b([gGmM])(\d)/g, (_, letter: string, digit: string) =>
    letter.toUpperCase() + digit
  );
}

/**
 * Rule 3 — Decimal normalization.
 * Rounds all numeric coordinate values (after axis letters) to decimalPlaces.
 * Handles: X1.23456 → X1.235 (with decimalPlaces=3)
 */
function applyDecimalNormalization(code: string, decimalPlaces: number): string {
  // Match address letter followed by an optional sign and a number
  return code.replace(
    /([A-Za-z])\s*([-+]?\d*\.?\d+)/g,
    (match, letter: string, numStr: string) => {
      // Skip non-coordinate addresses: program/line numbers, G/M codes, tool/offset
      // words, feed rate (F), spindle speed (S) — these should not be decimal-normalised
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

function formatLine(line: string, config: {
  wordSpacing: boolean;
  uppercaseGM: boolean;
  decimalPlaces: number | null;
}): string {
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

// ---------------------------------------------------------------------------
// Core format function
// ---------------------------------------------------------------------------

function formatDocument(document: vscode.TextDocument): vscode.TextEdit[] {
  const cfg = vscode.workspace.getConfiguration();
  const wordSpacing = cfg.get<boolean>('jobline.formatter.wordSpacing', true);
  const uppercaseGM = cfg.get<boolean>('jobline.formatter.uppercaseGM', true);
  const decimalPlaces = cfg.get<number | null>('jobline.formatter.decimalPlaces', null);

  const config = { wordSpacing, uppercaseGM, decimalPlaces };

  const text = document.getText();
  const lines = text.split(/\r?\n/);
  const formattedLines = lines.map(line => formatLine(line, config));
  const newText = formattedLines.join('\n');

  if (newText === text) return [];

  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(text.length)
  );

  return [vscode.TextEdit.replace(fullRange, newText)];
}

// ---------------------------------------------------------------------------
// Public registration function
// ---------------------------------------------------------------------------

export function registerFormatter(context: vscode.ExtensionContext): void {
  // Register as a command
  context.subscriptions.push(
    vscode.commands.registerCommand('jobline.formatDocument', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('JobLine Formatter: No active editor.');
        return;
      }

      const edits = formatDocument(editor.document);
      if (edits.length === 0) {
        vscode.window.showInformationMessage('JobLine Formatter: No formatting changes needed.');
        return;
      }

      const workspaceEdit = new vscode.WorkspaceEdit();
      workspaceEdit.set(editor.document.uri, edits);
      await vscode.workspace.applyEdit(workspaceEdit);
      vscode.window.showInformationMessage('JobLine Formatter: Document formatted.');
    })
  );

  // Register as a DocumentFormattingEditProvider for gcode language
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider('gcode', {
      provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
        return formatDocument(document);
      }
    })
  );
}
