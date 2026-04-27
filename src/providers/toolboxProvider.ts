/**
 * JobLine Machinist Toolbox v0.3.0
 *
 * WebviewViewProvider rendering one-click G-code editing tools in the sidebar.
 * All document edits are applied as atomic WorkspaceEdits (fully undoable).
 *
 * Sections:
 *  - Line Numbers (N-Words): Insert · Renumber · Remove
 *  - Code Editing: Uppercase G/M · Strip Comments · Remove Blank Lines · Remove Dwells
 *  - Feed & Speed: Scale Feed Rates · Scale Spindle Speeds · Clamp Max Feed
 *  - Coordinate Shift: Shift X · Shift Y · Shift Z
 *  - Block Skip (/): Add · Remove
 *  - Program Structure: Safety Header · Program End · Safe-Z Before TC · Coolant On/Off · Blank Lines Between Ops
 *  - Navigate: Next Tool Change · Next Canned Cycle · Plain-Language Explainer
 */

import * as vscode from 'vscode';
import { getLastGCodeDoc } from './sidebarTreeProviders';
import { isGCodeFile } from '../utils/fileTypes';

// =============================================================================
// Helper — resolve the G-code editor even when visualizer has focus
// =============================================================================

async function resolveGCodeEditor(): Promise<vscode.TextEditor | undefined> {
  // Prefer activeTextEditor when it is a gcode file
  const active = vscode.window.activeTextEditor;
  if (active && isGCodeFile(active.document)) return active;

  // Fall back: find any visible gcode editor
  const visible = vscode.window.visibleTextEditors.find(
    e => isGCodeFile(e.document)
  );
  if (visible) return visible;

  // Last resort: reveal the cached sidebar doc
  const doc = getLastGCodeDoc();
  if (!doc) return undefined;
  try {
    return await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
  } catch {
    return undefined;
  }
}

// =============================================================================
// Helper — apply a transform to the active document
// =============================================================================

async function applyTransform(
  transform: (lines: string[], selection: number[] | null) => string[]
): Promise<void> {
  const editor = await resolveGCodeEditor();
  if (!editor) {
    vscode.window.showWarningMessage('JobLine Toolbox: Open a G-code file first.');
    return;
  }

  const doc = editor.document;
  const text = doc.getText();
  const lines = text.split('\n');

  const sel = editor.selection;
  const selectedLines = !sel.isEmpty
    ? Array.from({ length: sel.end.line - sel.start.line + 1 }, (_, i) => sel.start.line + i)
    : null;

  const newLines = transform(lines, selectedLines);
  const newText = newLines.join('\n');

  if (newText === text) {
    vscode.window.showInformationMessage('JobLine Toolbox: No changes needed.');
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(text.length));
  edit.replace(doc.uri, fullRange, newText);
  await vscode.workspace.applyEdit(edit);
}

// =============================================================================
// Helper — extract code portion of a line (before inline comment)
// =============================================================================

function splitCodeComment(line: string): [string, string] {
  const idx = line.indexOf('(');
  if (idx >= 0) return [line.slice(0, idx), line.slice(idx)];
  const semiIdx = line.indexOf(';');
  if (semiIdx >= 0) return [line.slice(0, semiIdx), line.slice(semiIdx)];
  return [line, ''];
}

function isPureComment(line: string): boolean {
  const t = line.trim();
  return !t || t.startsWith('(') || t.startsWith(';') || t === '%';
}

// =============================================================================
// Line Number transforms
// =============================================================================

function insertLineNumbers(lines: string[], start: number, step: number): string[] {
  let n = start;
  return lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '%') return line;
    if (/^[Nn]\d+/.test(trimmed)) return line;
    const leading = line.match(/^(\s*)/)?.[1] ?? '';
    const result = `${leading}N${n} ${trimmed}`;
    n += step;
    return result;
  });
}

function removeLineNumbers(lines: string[]): string[] {
  return lines.map(line => line.replace(/^(\s*)[Nn]\d+\s*/, '$1'));
}

function renumberLines(lines: string[], start: number, step: number): string[] {
  let n = start;
  return lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '%') return line;
    const leading = line.match(/^(\s*)/)?.[1] ?? '';
    const stripped = trimmed.replace(/^[Nn]\d+\s*/, '');
    n += step;
    return `${leading}N${n - step} ${stripped}`;
  });
}

// =============================================================================
// Code Editing transforms
// =============================================================================

function stripComments(lines: string[]): string[] {
  return lines.map(line =>
    line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trimEnd()
  );
}

function uppercaseGM(lines: string[]): string[] {
  return lines.map(line =>
    line.replace(/\b([gGmM])(\d)/g, (_, letter, digit) => letter.toUpperCase() + digit)
  );
}

function removeBlankLines(lines: string[]): string[] {
  const result: string[] = [];
  let lastWasBlank = false;
  for (const line of lines) {
    const isBlank = !line.trim();
    if (isBlank && lastWasBlank) continue;
    result.push(line);
    lastWasBlank = isBlank;
  }
  return result;
}

/**
 * Remove lines whose primary purpose is a G04/G4 dwell.
 * Lines that also contain axis motion words are kept intact.
 */
function removeDwells(lines: string[]): string[] {
  return lines.filter(line => {
    if (!/\bG0?4\b/i.test(line)) return true;
    // Keep lines that have coordinate motion mixed in (e.g. unusual compound blocks)
    return /\b[XYZABC][-+]?\d/.test(line);
  });
}

// =============================================================================
// Feed & Speed transforms
// =============================================================================

function scaleFeedRates(lines: string[], scalePct: number): string[] {
  const factor = scalePct / 100;
  return lines.map(line => {
    if (isPureComment(line)) return line;
    const [code, comment] = splitCodeComment(line);
    const newCode = code.replace(/\bF(\d+(?:\.\d+)?)\b/gi, (_, val) => {
      const newVal = Math.round(parseFloat(val) * factor * 10) / 10;
      return `F${newVal}`;
    });
    return newCode + comment;
  });
}

function scaleSpindleSpeeds(lines: string[], scalePct: number): string[] {
  const factor = scalePct / 100;
  return lines.map(line => {
    if (isPureComment(line)) return line;
    const [code, comment] = splitCodeComment(line);
    const newCode = code.replace(/\bS(\d+(?:\.\d+)?)\b/gi, (_, val) => {
      const newVal = Math.round(parseFloat(val) * factor);
      return `S${newVal}`;
    });
    return newCode + comment;
  });
}

function clampFeedRates(lines: string[], maxFeed: number): string[] {
  return lines.map(line => {
    if (isPureComment(line)) return line;
    const [code, comment] = splitCodeComment(line);
    const newCode = code.replace(/\bF(\d+(?:\.\d+)?)\b/gi, (_, val) => {
      const newVal = Math.min(parseFloat(val), maxFeed);
      return `F${newVal}`;
    });
    return newCode + comment;
  });
}

// =============================================================================
// Coordinate Shift transforms
// =============================================================================

/**
 * Shift all occurrences of a given axis letter by `offset`.
 * Skips macro assignment lines, pure comments, and any address followed by
 * a bracket expression (macro variable) so macro programs are not broken.
 */
function shiftAxis(lines: string[], axis: string, offset: number): string[] {
  const re = new RegExp(`\\b(${axis})([-+]?\\d+(?:\\.\\d+)?)(?![\\[#\\d])`, 'gi');
  return lines.map(line => {
    if (isPureComment(line)) return line;
    // Skip macro variable assignments (#n = ...)
    if (/^\s*#\d+\s*=/.test(line)) return line;
    const [code, comment] = splitCodeComment(line);
    const newCode = code.replace(re, (_, letter, val) => {
      const newVal = Math.round((parseFloat(val) + offset) * 100000) / 100000;
      return `${letter}${newVal}`;
    });
    return newCode + comment;
  });
}

// =============================================================================
// Block Skip transforms
// =============================================================================

function addBlockSkip(lines: string[], selectedOnly: number[] | null): string[] {
  return lines.map((line, i) => {
    if (selectedOnly && !selectedOnly.includes(i)) return line;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('/')) return line;
    const leading = line.match(/^(\s*)/)?.[1] ?? '';
    return `${leading}/${trimmed}`;
  });
}

function removeBlockSkip(lines: string[], selectedOnly: number[] | null): string[] {
  return lines.map((line, i) => {
    if (selectedOnly && !selectedOnly.includes(i)) return line;
    return line.replace(/^(\s*)\//, '$1');
  });
}

// =============================================================================
// Program Structure transforms
// =============================================================================

function addSafetyHeader(lines: string[]): string[] {
  const safetyBlock = 'G17 G40 G49 G80 G90';
  const oLineIdx = lines.findIndex(l => /^\s*[Oo]\d+/.test(l));
  if (oLineIdx === -1) return [safetyBlock, ...lines];
  const nextFew = lines.slice(oLineIdx + 1, oLineIdx + 4).join(' ');
  if (/G40/i.test(nextFew) && /G49/i.test(nextFew)) return lines;
  const result = [...lines];
  result.splice(oLineIdx + 1, 0, safetyBlock);
  return result;
}

function addProgramEnd(lines: string[]): string[] {
  const result = [...lines];
  while (result.length > 0 && !result[result.length - 1].trim()) result.pop();
  const last = result[result.length - 1]?.trim() ?? '';
  if (last === '%') {
    const prev = result[result.length - 2]?.trim() ?? '';
    if (!/[Mm]30/.test(prev)) result.splice(result.length - 1, 0, 'M30');
  } else if (/[Mm]30/.test(last)) {
    result.push('%');
  } else {
    result.push('M30');
    result.push('%');
  }
  return result;
}

/**
 * Insert G91 G28 Z0. / G90 safe-Z retract before every M06 tool change.
 * Skips lines that already have a G28 on the preceding two lines.
 */
function insertSafeZ(lines: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\bM0*6\b/i.test(line)) {
      // Check if safe-Z is already present in the previous two lines
      const prev2 = result.slice(-2).join(' ');
      if (!/G28/i.test(prev2)) {
        result.push('G91 G28 Z0.');
        result.push('G90');
      }
    }
    result.push(line);
  }
  return result;
}

/**
 * Add M08 (coolant on) after each tool change and M09 (coolant off)
 * before M30/M02 program-end codes.  Skips if already present.
 */
function addCoolantControl(lines: string[]): string[] {
  const result: string[] = [];
  for (const line of lines) {
    // Inject M09 before program end
    if (/\b[Mm]0*(30|2)\b/.test(line) && !/\bM0*9\b/i.test(line)) {
      result.push('M09');
    }
    result.push(line);
    // Inject M08 after tool change
    if (/\bM0*6\b/i.test(line) && !/\bM0*8\b/i.test(line)) {
      result.push('M08');
    }
  }
  return result;
}

/**
 * Insert a blank separator line before each tool-change block so operations
 * are visually distinct. Skips if the preceding line is already blank.
 */
function addBlanksBetweenOps(lines: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\bM0*6\b/i.test(line) && i > 0 && result[result.length - 1].trim() !== '') {
      result.push('');
    }
    result.push(line);
  }
  return result;
}

// =============================================================================
// Navigation helpers (no document edit — just cursor movement)
// =============================================================================

async function findNextInEditor(
  pattern: RegExp,
  notFoundMsg: string
): Promise<void> {
  const editor = await resolveGCodeEditor();
  if (!editor) return;

  const lines = editor.document.getText().split('\n');
  const start = editor.selection.active.line + 1;

  for (let pass = 0; pass < 2; pass++) {
    const from = pass === 0 ? start : 0;
    const to   = pass === 0 ? lines.length : start;
    for (let i = from; i < to; i++) {
      if (pattern.test(lines[i])) {
        const pos = new vscode.Position(i, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        if (pass === 1) {
          vscode.window.showInformationMessage('JobLine: Wrapped to beginning of file.');
        }
        return;
      }
    }
  }
  vscode.window.showInformationMessage(notFoundMsg);
}

// =============================================================================
// WebviewViewProvider
// =============================================================================

export class ToolboxViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'jobline.toolboxView';
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtml();

    webviewView.webview.onDidReceiveMessage(async (msg: {
      command: string;
      start?: number; step?: number;
      feedScale?: number; spindleScale?: number; clampFeed?: number;
      shiftX?: number; shiftY?: number; shiftZ?: number;
    }) => {
      switch (msg.command) {
        // ----- Line Numbers -----
        case 'insertLineNumbers':
          await applyTransform(lines => insertLineNumbers(lines, msg.start ?? 10, msg.step ?? 10));
          break;
        case 'removeLineNumbers':
          await applyTransform(lines => removeLineNumbers(lines));
          break;
        case 'renumberLines':
          await applyTransform(lines => renumberLines(lines, msg.start ?? 10, msg.step ?? 10));
          break;

        // ----- Code Editing -----
        case 'uppercaseGM':
          await applyTransform(lines => uppercaseGM(lines));
          break;
        case 'stripComments':
          await applyTransform(lines => stripComments(lines));
          break;
        case 'removeBlankLines':
          await applyTransform(lines => removeBlankLines(lines));
          break;
        case 'removeDwells':
          await applyTransform(lines => removeDwells(lines));
          break;

        // ----- Feed & Speed -----
        case 'scaleFeedRates':
          await applyTransform(lines => scaleFeedRates(lines, msg.feedScale ?? 100));
          break;
        case 'scaleSpindleSpeeds':
          await applyTransform(lines => scaleSpindleSpeeds(lines, msg.spindleScale ?? 100));
          break;
        case 'clampFeedRates':
          await applyTransform(lines => clampFeedRates(lines, msg.clampFeed ?? 9999));
          break;

        // ----- Coordinate Shift -----
        case 'shiftX':
          await applyTransform(lines => shiftAxis(lines, 'X', msg.shiftX ?? 0));
          break;
        case 'shiftY':
          await applyTransform(lines => shiftAxis(lines, 'Y', msg.shiftY ?? 0));
          break;
        case 'shiftZ':
          await applyTransform(lines => shiftAxis(lines, 'Z', msg.shiftZ ?? 0));
          break;

        // ----- Block Skip -----
        case 'addBlockSkip':
          await applyTransform((lines, sel) => addBlockSkip(lines, sel));
          break;
        case 'removeBlockSkip':
          await applyTransform((lines, sel) => removeBlockSkip(lines, sel));
          break;

        // ----- Program Structure -----
        case 'addSafetyHeader':
          await applyTransform(lines => addSafetyHeader(lines));
          break;
        case 'addProgramEnd':
          await applyTransform(lines => addProgramEnd(lines));
          break;
        case 'insertSafeZ':
          await applyTransform(lines => insertSafeZ(lines));
          break;
        case 'addCoolant':
          await applyTransform(lines => addCoolantControl(lines));
          break;
        case 'addBlanksBetweenOps':
          await applyTransform(lines => addBlanksBetweenOps(lines));
          break;

        // ----- Navigate -----
        case 'findNextToolChange':
          await findNextInEditor(/\bM0*6\b/i, 'JobLine: No tool changes found in this file.');
          break;
        case 'findNextCannedCycle':
          await findNextInEditor(/\bG0?[78]\d\b/i, 'JobLine: No canned cycles found in this file.');
          break;
        case 'openExplainer':
          await vscode.commands.executeCommand('jobline.openExplainer');
          break;
      }
    });
  }

  private _getHtml(): string {
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  :root {
    --bg: var(--vscode-sideBar-background, #252526);
    --fg: var(--vscode-foreground, #cccccc);
    --btn-bg: var(--vscode-button-background, #0e639c);
    --btn-fg: var(--vscode-button-foreground, #ffffff);
    --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
    --btn2-bg: transparent;
    --btn2-border: var(--vscode-widget-border, #454545);
    --btn2-hover: var(--vscode-sideBarSectionHeader-background, #2d2d2d);
    --input-bg: var(--vscode-input-background, #3c3c3c);
    --input-fg: var(--vscode-input-foreground, #cccccc);
    --input-border: var(--vscode-input-border, #3c3c3c);
    --sec-bg: var(--vscode-sideBarSectionHeader-background, #2d2d2d);
    --sec-fg: var(--vscode-sideBarSectionHeader-foreground, #bbb);
    --border: var(--vscode-widget-border, #454545);
    --hint-fg: var(--vscode-descriptionForeground, #999);
    --font: var(--vscode-font-family, sans-serif);
    --fs: var(--vscode-font-size, 13px);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--fg); font-family: var(--font); font-size: var(--fs); }

  .sec-hdr {
    background: var(--sec-bg); color: var(--sec-fg);
    font-size: 0.78em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
    padding: 5px 8px; border-top: 1px solid var(--border); user-select: none;
  }
  .sec { padding: 8px; display: flex; flex-direction: column; gap: 6px; }

  .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .row label { font-size: 0.82em; white-space: nowrap; min-width: 3.2em; color: var(--hint-fg); }
  .row label.wide { min-width: 4.5em; }

  input[type=number] {
    background: var(--input-bg); color: var(--input-fg);
    border: 1px solid var(--input-border); border-radius: 3px;
    padding: 3px 5px; width: 5.5em;
    font-size: var(--fs); font-family: var(--font);
  }

  button {
    background: var(--btn-bg); color: var(--btn-fg);
    border: none; border-radius: 3px; padding: 5px 10px;
    cursor: pointer; font-size: var(--fs); font-family: var(--font);
    width: 100%; text-align: left;
  }
  button:hover { background: var(--btn-hover); }
  button.sec { background: var(--btn2-bg); color: var(--fg); border: 1px solid var(--btn2-border); }
  button.sec:hover { background: var(--btn2-hover); }

  .hint { font-size: 0.78em; color: var(--hint-fg); padding: 0 8px 4px; line-height: 1.4; }
  .danger { color: #f48771; }
</style>
</head>
<body>

<!-- ===== Line Numbers ===== -->
<div class="sec-hdr">Line Numbers (N-Words)</div>
<div class="sec">
  <div class="row">
    <label>Start</label>
    <input type="number" id="lnStart" value="10" min="1" step="1">
    <label>Step</label>
    <input type="number" id="lnStep" value="10" min="1" step="1">
  </div>
  <button onclick="send('insertLineNumbers')">Insert Line Numbers</button>
  <button onclick="send('renumberLines')">Renumber Lines</button>
  <button class="sec" onclick="send('removeLineNumbers')">Remove Line Numbers</button>
</div>

<!-- ===== Code Editing ===== -->
<div class="sec-hdr">Code Editing</div>
<div class="sec">
  <button onclick="send('uppercaseGM')">Uppercase G/M Codes</button>
  <button onclick="send('stripComments')">Strip All Comments</button>
  <button class="sec" onclick="send('removeBlankLines')">Remove Extra Blank Lines</button>
  <button class="sec" onclick="send('removeDwells')">Remove All Dwells (G04/G4)</button>
</div>

<!-- ===== Feed & Speed ===== -->
<div class="sec-hdr">Feed &amp; Speed</div>
<div class="sec">
  <div class="row">
    <label class="wide">Feed %</label>
    <input type="number" id="feedScale" value="100" min="1" max="500" step="1">
    <button style="width:auto;flex:1" onclick="send('scaleFeedRates')">Scale Feed Rates</button>
  </div>
  <div class="row">
    <label class="wide">Spindle %</label>
    <input type="number" id="spindleScale" value="100" min="1" max="500" step="1">
    <button style="width:auto;flex:1" onclick="send('scaleSpindleSpeeds')">Scale Spindle Speeds</button>
  </div>
  <div class="row">
    <label class="wide">Max Feed</label>
    <input type="number" id="clampFeed" value="200" min="1" step="1">
    <button style="width:auto;flex:1" onclick="send('clampFeedRates')">Clamp Max Feed</button>
  </div>
</div>
<div class="hint">Feed &amp; Speed tools skip comment lines and macro expressions.</div>

<!-- ===== Coordinate Shift ===== -->
<div class="sec-hdr">Coordinate Shift</div>
<div class="sec">
  <div class="row">
    <label>X offset</label>
    <input type="number" id="shiftX" value="0" step="0.001">
    <button style="width:auto;flex:1" onclick="send('shiftX')">Shift X</button>
  </div>
  <div class="row">
    <label>Y offset</label>
    <input type="number" id="shiftY" value="0" step="0.001">
    <button style="width:auto;flex:1" onclick="send('shiftY')">Shift Y</button>
  </div>
  <div class="row">
    <label>Z offset</label>
    <input type="number" id="shiftZ" value="0" step="0.001">
    <button style="width:auto;flex:1" onclick="send('shiftZ')">Shift Z</button>
  </div>
</div>
<div class="hint">Shifts all axis coordinates by the offset. Skips macro variable lines.</div>

<!-- ===== Block Skip ===== -->
<div class="sec-hdr">Block Skip ( / )</div>
<div class="hint">Select lines first to limit to selection.</div>
<div class="sec">
  <button onclick="send('addBlockSkip')">Add Block Skip to Lines</button>
  <button class="sec" onclick="send('removeBlockSkip')">Remove Block Skip</button>
</div>

<!-- ===== Program Structure ===== -->
<div class="sec-hdr">Program Structure</div>
<div class="sec">
  <button onclick="send('addSafetyHeader')">Add Safety Header (G17 G40 G49 G80)</button>
  <button onclick="send('addProgramEnd')">Add Program End (M30 + %)</button>
  <button onclick="send('insertSafeZ')">Insert Safe-Z Before Tool Changes</button>
  <button onclick="send('addCoolant')">Add Coolant On/Off (M08 / M09)</button>
  <button class="sec" onclick="send('addBlanksBetweenOps')">Add Blank Lines Between Operations</button>
</div>

<!-- ===== Navigate ===== -->
<div class="sec-hdr">Navigate &amp; Explain</div>
<div class="sec">
  <button onclick="send('findNextToolChange')">&#x27A1; Next Tool Change (M06)</button>
  <button onclick="send('findNextCannedCycle')">&#x27A1; Next Canned Cycle (G7x/G8x)</button>
  <button onclick="send('openExplainer')">&#x1F4AC; Open Plain-Language Explanation</button>
</div>
<div class="hint">Navigate wraps around the end of the file automatically.</div>

<script>
  const vscode = acquireVsCodeApi();

  function send(command) {
    vscode.postMessage({
      command,
      start:        parseInt(document.getElementById('lnStart')?.value)    || 10,
      step:         parseInt(document.getElementById('lnStep')?.value)     || 10,
      feedScale:    parseFloat(document.getElementById('feedScale')?.value)    || 100,
      spindleScale: parseFloat(document.getElementById('spindleScale')?.value) || 100,
      clampFeed:    parseFloat(document.getElementById('clampFeed')?.value)    || 9999,
      shiftX:       parseFloat(document.getElementById('shiftX')?.value)   || 0,
      shiftY:       parseFloat(document.getElementById('shiftY')?.value)   || 0,
      shiftZ:       parseFloat(document.getElementById('shiftZ')?.value)   || 0,
    });
  }
</script>
</body>
</html>`;
  }
}

// =============================================================================
// Command registrations (also callable from the command palette)
// =============================================================================

export function registerToolboxCommands(context: vscode.ExtensionContext): void {
  async function promptNumber(prompt: string, placeHolder: string): Promise<number | undefined> {
    const v = await vscode.window.showInputBox({ prompt, placeHolder, validateInput: s => isFinite(+s) ? null : 'Enter a number' });
    return v !== undefined ? +v : undefined;
  }

  const cmds: Array<[string, () => Promise<void>]> = [
    // Line numbers
    ['jobline.toolbox.insertLineNumbers',  () => applyTransform(l => insertLineNumbers(l, 10, 10))],
    ['jobline.toolbox.removeLineNumbers',  () => applyTransform(l => removeLineNumbers(l))],
    ['jobline.toolbox.renumberLines',      () => applyTransform(l => renumberLines(l, 10, 10))],
    // Code editing
    ['jobline.toolbox.stripComments',      () => applyTransform(l => stripComments(l))],
    ['jobline.toolbox.uppercaseGM',        () => applyTransform(l => uppercaseGM(l))],
    ['jobline.toolbox.removeBlankLines',   () => applyTransform(l => removeBlankLines(l))],
    ['jobline.toolbox.removeDwells',       () => applyTransform(l => removeDwells(l))],
    // Feed & Speed
    ['jobline.toolbox.scaleFeedRates', async () => {
      const pct = await promptNumber('Feed rate scale percentage (e.g. 80)', '80');
      if (pct !== undefined) await applyTransform(l => scaleFeedRates(l, pct));
    }],
    ['jobline.toolbox.scaleSpindleSpeeds', async () => {
      const pct = await promptNumber('Spindle speed scale percentage (e.g. 90)', '90');
      if (pct !== undefined) await applyTransform(l => scaleSpindleSpeeds(l, pct));
    }],
    ['jobline.toolbox.clampFeedRates', async () => {
      const max = await promptNumber('Maximum feed rate to allow', '200');
      if (max !== undefined) await applyTransform(l => clampFeedRates(l, max));
    }],
    // Coordinate Shift
    ['jobline.toolbox.shiftX', async () => {
      const off = await promptNumber('X offset to add to all X coordinates', '0');
      if (off !== undefined) await applyTransform(l => shiftAxis(l, 'X', off));
    }],
    ['jobline.toolbox.shiftY', async () => {
      const off = await promptNumber('Y offset to add to all Y coordinates', '0');
      if (off !== undefined) await applyTransform(l => shiftAxis(l, 'Y', off));
    }],
    ['jobline.toolbox.shiftZ', async () => {
      const off = await promptNumber('Z offset to add to all Z coordinates', '0');
      if (off !== undefined) await applyTransform(l => shiftAxis(l, 'Z', off));
    }],
    // Block Skip
    ['jobline.toolbox.addBlockSkip',       () => applyTransform((l, sel) => addBlockSkip(l, sel))],
    ['jobline.toolbox.removeBlockSkip',    () => applyTransform((l, sel) => removeBlockSkip(l, sel))],
    // Program Structure
    ['jobline.toolbox.addSafetyHeader',    () => applyTransform(l => addSafetyHeader(l))],
    ['jobline.toolbox.addProgramEnd',      () => applyTransform(l => addProgramEnd(l))],
    ['jobline.toolbox.insertSafeZ',        () => applyTransform(l => insertSafeZ(l))],
    ['jobline.toolbox.addCoolant',         () => applyTransform(l => addCoolantControl(l))],
    ['jobline.toolbox.addBlanksBetweenOps',() => applyTransform(l => addBlanksBetweenOps(l))],
    // Navigate
    ['jobline.toolbox.findNextToolChange',  () => findNextInEditor(/\bM0*6\b/i, 'JobLine: No tool changes found.')],
    ['jobline.toolbox.findNextCannedCycle', () => findNextInEditor(/\bG0?[78]\d\b/i, 'JobLine: No canned cycles found.')],
  ];

  for (const [id, handler] of cmds) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }
}
