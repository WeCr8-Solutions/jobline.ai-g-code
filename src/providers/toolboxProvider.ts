/**
 * JobLine Machinist Toolbox
 *
 * A WebviewViewProvider that renders a sidebar panel with one-click tools
 * for editing G-code programs. All operations work on the active editor
 * document and are applied as atomic WorkspaceEdits (fully undoable).
 *
 * Tools available:
 *  - Insert / Remove / Renumber line numbers (N-words)
 *  - Strip all comments
 *  - Uppercase G/M codes
 *  - Add / Remove block skip (/)
 *  - Add safety header (G17 G40 G49 G80 after O-word)
 *  - Append program end (M30 + %)
 *  - Remove blank lines
 */

import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// G-code text transformation helpers
// ---------------------------------------------------------------------------

/** Add N-words to lines that don't already have one. */
function insertLineNumbers(lines: string[], start: number, step: number): string[] {
  let n = start;
  return lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '%') return line;               // skip blank / delimiter
    if (/^[Nn]\d+/.test(trimmed)) return line;                 // already has N-word
    const leading = line.match(/^(\s*)/)?.[1] ?? '';
    const result = `${leading}N${n} ${trimmed}`;
    n += step;
    return result;
  });
}

/** Remove all N-words from every line. */
function removeLineNumbers(lines: string[]): string[] {
  return lines.map(line =>
    line.replace(/^(\s*)[Nn]\d+\s*/, '$1')
  );
}

/** Renumber all non-blank lines sequentially (replaces or adds N-words). */
function renumberLines(lines: string[], start: number, step: number): string[] {
  let n = start;
  return lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '%') return line;
    const leading = line.match(/^(\s*)/)?.[1] ?? '';
    const stripped = trimmed.replace(/^[Nn]\d+\s*/, '');
    const result = `${leading}N${n} ${stripped}`;
    n += step;
    return result;
  });
}

/** Remove all parenthetical and semicolon comments. */
function stripComments(lines: string[]): string[] {
  return lines.map(line =>
    line
      .replace(/\([^)]*\)/g, '')    // remove (...)
      .replace(/;.*$/, '')           // remove ;...
      .trimEnd()
  );
}

/** Uppercase all G and M words (G01 → G01, m3 → M3). */
function uppercaseGM(lines: string[]): string[] {
  return lines.map(line =>
    line.replace(/\b([gGmM])(\d)/g, (_, letter, digit) => letter.toUpperCase() + digit)
  );
}

/** Add a / block-skip prefix to all selected lines (or all lines if no selection). */
function addBlockSkip(lines: string[], selectedOnly: number[] | null): string[] {
  return lines.map((line, i) => {
    if (selectedOnly && !selectedOnly.includes(i)) return line;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('/')) return line;
    const leading = line.match(/^(\s*)/)?.[1] ?? '';
    return `${leading}/${trimmed}`;
  });
}

/** Remove / block-skip prefix. */
function removeBlockSkip(lines: string[], selectedOnly: number[] | null): string[] {
  return lines.map((line, i) => {
    if (selectedOnly && !selectedOnly.includes(i)) return line;
    return line.replace(/^(\s*)\//, '$1');
  });
}

/** Insert a standard safety block after the first O-word line. */
function addSafetyHeader(lines: string[]): string[] {
  const safetyBlock = 'G17 G40 G49 G80 G90';
  // Find O-word line
  const oLineIdx = lines.findIndex(l => /^\s*[Oo]\d+/.test(l));
  if (oLineIdx === -1) {
    // No O-word — insert at top
    return [safetyBlock, ...lines];
  }
  // Check if safety block already present in next few lines
  const nextFew = lines.slice(oLineIdx + 1, oLineIdx + 4).join(' ');
  if (/G40/i.test(nextFew) && /G49/i.test(nextFew)) return lines; // already there
  const result = [...lines];
  result.splice(oLineIdx + 1, 0, safetyBlock);
  return result;
}

/** Ensure the file ends with M30 and %. */
function addProgramEnd(lines: string[]): string[] {
  const result = [...lines];
  // Remove trailing blank lines
  while (result.length > 0 && !result[result.length - 1].trim()) {
    result.pop();
  }
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

/** Remove consecutive blank lines (keep max 1). */
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

// ---------------------------------------------------------------------------
// Apply a line transformation to the active editor
// ---------------------------------------------------------------------------

async function applyTransform(transform: (lines: string[], selection: number[] | null) => string[]): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('JobLine Toolbox: No active editor.');
    return;
  }

  const doc = editor.document;
  const text = doc.getText();
  const lines = text.split('\n');

  // Determine if there's a meaningful selection
  const sel = editor.selection;
  const hasSelection = !sel.isEmpty;
  const selectedLines = hasSelection
    ? Array.from(
        { length: sel.end.line - sel.start.line + 1 },
        (_, i) => sel.start.line + i
      )
    : null;

  const newLines = transform(lines, selectedLines);
  const newText = newLines.join('\n');

  if (newText === text) {
    vscode.window.showInformationMessage('JobLine Toolbox: No changes needed.');
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(
    doc.positionAt(0),
    doc.positionAt(text.length)
  );
  edit.replace(doc.uri, fullRange, newText);
  await vscode.workspace.applyEdit(edit);
}

// ---------------------------------------------------------------------------
// WebviewViewProvider
// ---------------------------------------------------------------------------

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

    webviewView.webview.onDidReceiveMessage(async (msg: { command: string; start?: number; step?: number }) => {
      switch (msg.command) {
        case 'insertLineNumbers':
          await applyTransform((lines, _) =>
            insertLineNumbers(lines, msg.start ?? 10, msg.step ?? 10));
          break;
        case 'removeLineNumbers':
          await applyTransform((lines, _) => removeLineNumbers(lines));
          break;
        case 'renumberLines':
          await applyTransform((lines, _) =>
            renumberLines(lines, msg.start ?? 10, msg.step ?? 10));
          break;
        case 'stripComments':
          await applyTransform((lines, _) => stripComments(lines));
          break;
        case 'uppercaseGM':
          await applyTransform((lines, _) => uppercaseGM(lines));
          break;
        case 'addBlockSkip':
          await applyTransform((lines, sel) => addBlockSkip(lines, sel));
          break;
        case 'removeBlockSkip':
          await applyTransform((lines, sel) => removeBlockSkip(lines, sel));
          break;
        case 'addSafetyHeader':
          await applyTransform((lines, _) => addSafetyHeader(lines));
          break;
        case 'addProgramEnd':
          await applyTransform((lines, _) => addProgramEnd(lines));
          break;
        case 'removeBlankLines':
          await applyTransform((lines, _) => removeBlankLines(lines));
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
    --input-bg: var(--vscode-input-background, #3c3c3c);
    --input-fg: var(--vscode-input-foreground, #cccccc);
    --input-border: var(--vscode-input-border, #3c3c3c);
    --section-bg: var(--vscode-sideBarSectionHeader-background, #2d2d2d);
    --section-fg: var(--vscode-sideBarSectionHeader-foreground, #bbb);
    --border: var(--vscode-widget-border, #454545);
    --font: var(--vscode-font-family, sans-serif);
    --font-size: var(--vscode-font-size, 13px);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font);
    font-size: var(--font-size);
    padding: 0;
  }

  .section-header {
    background: var(--section-bg);
    color: var(--section-fg);
    font-size: 0.8em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 5px 8px;
    border-top: 1px solid var(--border);
    user-select: none;
  }
  .section { padding: 8px; display: flex; flex-direction: column; gap: 6px; }

  .row { display: flex; gap: 6px; align-items: center; }
  .row label { font-size: 0.85em; white-space: nowrap; min-width: 3.5em; }

  input[type=number] {
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--input-border);
    border-radius: 3px;
    padding: 3px 5px;
    width: 5em;
    font-size: var(--font-size);
    font-family: var(--font);
  }

  button {
    background: var(--btn-bg);
    color: var(--btn-fg);
    border: none;
    border-radius: 3px;
    padding: 5px 10px;
    cursor: pointer;
    font-size: var(--font-size);
    font-family: var(--font);
    width: 100%;
    text-align: left;
  }
  button:hover { background: var(--btn-hover); }

  .secondary {
    background: transparent;
    color: var(--fg);
    border: 1px solid var(--border);
  }
  .secondary:hover { background: var(--section-bg); }

  .hint {
    font-size: 0.78em;
    color: var(--section-fg);
    padding: 0 8px 4px;
    line-height: 1.3;
  }
</style>
</head>
<body>

<!-- ===== Line Numbers ===== -->
<div class="section-header">Line Numbers (N-Words)</div>
<div class="section">
  <div class="row">
    <label>Start</label>
    <input type="number" id="lnStart" value="10" min="1" step="1">
    <label>Step</label>
    <input type="number" id="lnStep" value="10" min="1" step="1">
  </div>
  <button onclick="send('insertLineNumbers')">Insert Line Numbers</button>
  <button onclick="send('renumberLines')">Renumber Lines</button>
  <button class="secondary" onclick="send('removeLineNumbers')">Remove Line Numbers</button>
</div>

<!-- ===== Code Editing ===== -->
<div class="section-header">Code Editing</div>
<div class="section">
  <button onclick="send('uppercaseGM')">Uppercase G/M Codes</button>
  <button onclick="send('stripComments')">Strip Comments</button>
  <button class="secondary" onclick="send('removeBlankLines')">Remove Extra Blank Lines</button>
</div>

<!-- ===== Block Skip ===== -->
<div class="section-header">Block Skip ( / )</div>
<div class="hint">Tip: Select lines first to limit to selection.</div>
<div class="section">
  <button onclick="send('addBlockSkip')">Add Block Skip to Lines</button>
  <button class="secondary" onclick="send('removeBlockSkip')">Remove Block Skip</button>
</div>

<!-- ===== Program Structure ===== -->
<div class="section-header">Program Structure</div>
<div class="section">
  <button onclick="send('addSafetyHeader')">Add Safety Header (G17 G40 G49 G80)</button>
  <button onclick="send('addProgramEnd')">Add Program End (M30 + %)</button>
</div>

<script>
  const vscode = acquireVsCodeApi();

  function send(command) {
    const start = parseInt(document.getElementById('lnStart')?.value) || 10;
    const step  = parseInt(document.getElementById('lnStep')?.value)  || 10;
    vscode.postMessage({ command, start, step });
  }
</script>
</body>
</html>`;
  }
}

// ---------------------------------------------------------------------------
// Command registrations (also callable from command palette)
// ---------------------------------------------------------------------------

export function registerToolboxCommands(context: vscode.ExtensionContext): void {
  const cmds: Array<[string, () => Promise<void>]> = [
    ['jobline.toolbox.insertLineNumbers',  () => applyTransform((l, _) => insertLineNumbers(l, 10, 10))],
    ['jobline.toolbox.removeLineNumbers',  () => applyTransform((l, _) => removeLineNumbers(l))],
    ['jobline.toolbox.renumberLines',      () => applyTransform((l, _) => renumberLines(l, 10, 10))],
    ['jobline.toolbox.stripComments',      () => applyTransform((l, _) => stripComments(l))],
    ['jobline.toolbox.uppercaseGM',        () => applyTransform((l, _) => uppercaseGM(l))],
    ['jobline.toolbox.addBlockSkip',       () => applyTransform((l, sel) => addBlockSkip(l, sel))],
    ['jobline.toolbox.removeBlockSkip',    () => applyTransform((l, sel) => removeBlockSkip(l, sel))],
    ['jobline.toolbox.addSafetyHeader',    () => applyTransform((l, _) => addSafetyHeader(l))],
    ['jobline.toolbox.addProgramEnd',      () => applyTransform((l, _) => addProgramEnd(l))],
    ['jobline.toolbox.removeBlankLines',   () => applyTransform((l, _) => removeBlankLines(l))],
  ];

  for (const [id, handler] of cmds) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }
}
