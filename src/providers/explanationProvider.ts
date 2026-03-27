/**
 * JobLine Plain-Language Explanation Panel
 *
 * Opens a scroll-synchronized webview panel beside the active G-code editor.
 * Each line of the G-code is shown alongside its plain-English description.
 * Scrolling in the editor updates the webview to match the visible range.
 *
 * Adapted concept from g-code_analyzer (WeCr8/g-code_analyzer) SynchronizedView.tsx
 * reimplemented as a VS Code WebviewPanel with native scroll-sync.
 */

import * as vscode from 'vscode';
import { Tokenizer } from '../parser/tokenizer';
import { BlockParser } from '../parser/blockParser';
import { ProgramModelBuilder } from '../parser/programModel';
import { GCodeBlock, ModalState } from '../parser/types';
import { narrateBlock } from '../engine/narrateLine';

const tokenizer = new Tokenizer();
const blockParser = new BlockParser();
const modelBuilder = new ProgramModelBuilder();

// ---------------------------------------------------------------------------
// Build explanation data from the active document
// ---------------------------------------------------------------------------

interface LineExplanation {
  lineNum: number;    // 1-based for display
  raw: string;
  explanation: string;
}

function buildExplanations(text: string, dialect: string): LineExplanation[] {
  try {
    const tokenized = tokenizer.tokenizeDocument(text);
    const blocks = blockParser.parseDocument(tokenized);
    const model = modelBuilder.build(blocks, dialect);

    return blocks.map((block: GCodeBlock, i: number) => {
      const state: ModalState = model.stateAtBlock[i] ?? model.stateAtBlock[model.stateAtBlock.length - 1];
      return {
        lineNum: i + 1,
        raw: block.raw,
        explanation: narrateBlock(block, state),
      };
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

function generateHtml(
  explanations: LineExplanation[],
  _webview: vscode.Webview,
  programName: string,
  totalLines: number
): string {
  const rows = explanations.map(e => {
    const rawEscaped = escHtml(e.raw || '\u00a0'); // nbsp for empty lines
    const explanationEscaped = escHtml(e.explanation || '\u00a0');
    const hasContent = e.explanation.trim().length > 0;
    return `<div class="line-row${hasContent ? '' : ' empty'}" data-line="${e.lineNum - 1}" title="${rawEscaped}">
  <span class="ln">${e.lineNum}</span>
  <span class="expl">${explanationEscaped}</span>
</div>`;
  }).join('\n');

  const headerTitle = escHtml(programName || 'G-Code Program');

  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  :root {
    --bg: var(--vscode-editor-background, #1e1e1e);
    --fg: var(--vscode-editor-foreground, #d4d4d4);
    --border: var(--vscode-editorGroup-border, #444);
    --ln-fg: var(--vscode-editorLineNumber-foreground, #858585);
    --expl-fg: var(--vscode-editor-foreground, #d4d4d4);
    --hl-bg: var(--vscode-editor-lineHighlightBackground, rgba(255,255,255,0.06));
    --accent: var(--vscode-focusBorder, #007acc);
    --font: var(--vscode-font-family, sans-serif);
    --editor-font: var(--vscode-editor-font-family, 'Consolas', monospace);
    --font-size: var(--vscode-font-size, 13px);
    --line-height: 1.5;
    --header-bg: var(--vscode-sideBarSectionHeader-background, #2d2d2d);
    --header-fg: var(--vscode-sideBarSectionHeader-foreground, #ccc);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font);
    font-size: var(--font-size);
    line-height: var(--line-height);
    overflow-x: hidden;
  }
  #sticky-header {
    position: sticky;
    top: 0;
    z-index: 20;
    background: var(--header-bg);
    color: var(--header-fg);
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    user-select: none;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  #sticky-header .prog-name {
    font-weight: 700;
    font-size: 0.9em;
    font-family: var(--editor-font);
    letter-spacing: 0.03em;
  }
  #sticky-header .prog-info {
    font-size: 0.78em;
    opacity: 0.7;
  }
  #col-header {
    position: sticky;
    top: 33px;
    z-index: 10;
    background: var(--vscode-titleBar-activeBackground, #3c3c3c);
    color: var(--vscode-titleBar-activeForeground, #aaa);
    font-size: 0.75em;
    padding: 3px 0.5em;
    display: grid;
    grid-template-columns: 3.5em 1fr;
    gap: 0 1em;
    border-bottom: 1px solid var(--border);
    user-select: none;
  }
  #col-header span { font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
  #container { width: 100%; }
  .line-row {
    display: grid;
    grid-template-columns: 3.5em 1fr;
    gap: 0 1em;
    padding: 1px 0.5em;
    min-height: calc(var(--font-size) * var(--line-height));
    align-items: baseline;
    cursor: pointer;
    border-left: 2px solid transparent;
  }
  .line-row:hover { background: var(--hl-bg); }
  .line-row.active {
    background: var(--hl-bg);
    border-left: 2px solid var(--accent);
  }
  .line-row.empty .expl { opacity: 0.35; }
  .ln {
    color: var(--ln-fg);
    text-align: right;
    user-select: none;
    font-size: 0.85em;
    font-family: var(--editor-font);
  }
  .expl {
    color: var(--expl-fg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
</head>
<body>
<div id="sticky-header">
  <span class="prog-name">${headerTitle}</span>
  <span class="prog-info">${totalLines} lines</span>
</div>
<div id="col-header">
  <span>#</span>
  <span>Plain Language</span>
</div>
<div id="container">
${rows}
</div>
<script>
  const vscode = acquireVsCodeApi();

  // Click to navigate editor to that line
  document.getElementById('container').addEventListener('click', function(e) {
    const row = e.target.closest('.line-row');
    if (!row) return;
    const lineNum = parseInt(row.getAttribute('data-line'), 10);
    vscode.postMessage({ type: 'goToLine', line: lineNum });
  });

  // Receive messages from extension
  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'highlight') {
      // Highlight a line without scrolling (independent scroll)
      document.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
      const el = document.querySelector('[data-line="' + msg.line + '"]');
      if (el) el.classList.add('active');
    }
    if (msg.type === 'refresh') {
      vscode.postMessage({ type: 'requestRefresh' });
    }
  });
</script>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Provider / panel management
// ---------------------------------------------------------------------------

let activePanel: vscode.WebviewPanel | undefined;
let scrollListener: vscode.Disposable | undefined;
let documentChangeListener: vscode.Disposable | undefined;

export function openExplanationPanel(context: vscode.ExtensionContext): void {
  // Reuse existing panel if open
  if (activePanel) {
    activePanel.reveal(vscode.ViewColumn.Beside, true);
    refreshPanel();
    return;
  }

  activePanel = vscode.window.createWebviewPanel(
    'jobline.explanation',
    'JobLine: Plain Language',
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    }
  );

  context.subscriptions.push(activePanel);

  refreshPanel();

  // Highlight the current editor line in the webview — but do NOT force scroll
  // The webview maintains its own independent scroll position
  scrollListener = vscode.window.onDidChangeTextEditorSelection(event => {
    if (!activePanel) return;
    const editor = event.textEditor;
    if (!isGCodeDoc(editor.document)) return;
    const activeLine = editor.selection.active.line;
    activePanel.webview.postMessage({ type: 'highlight', line: activeLine });
  });
  context.subscriptions.push(scrollListener);

  // Re-render on document changes
  documentChangeListener = vscode.workspace.onDidChangeTextDocument(event => {
    if (!activePanel) return;
    const editor = vscode.window.activeTextEditor;
    if (editor && event.document.uri.toString() === editor.document.uri.toString()) {
      refreshPanel();
    }
  });
  context.subscriptions.push(documentChangeListener);

  // Re-render when switching editors
  const editorChangeListener = vscode.window.onDidChangeActiveTextEditor(() => {
    if (activePanel) refreshPanel();
  });
  context.subscriptions.push(editorChangeListener);

  // Handle messages from the webview
  activePanel.webview.onDidReceiveMessage(msg => {
    if (msg.type === 'requestRefresh') refreshPanel();
    if (msg.type === 'goToLine') {
      const editor = vscode.window.activeTextEditor;
      if (editor && isGCodeDoc(editor.document)) {
        const pos = new vscode.Position(msg.line as number, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }
    }
  }, undefined, context.subscriptions);

  // Cleanup
  activePanel.onDidDispose(() => {
    activePanel = undefined;
  }, undefined, context.subscriptions);
}

function refreshPanel(): void {
  if (!activePanel) return;

  const editor = vscode.window.activeTextEditor;
  if (!editor || !isGCodeDoc(editor.document)) {
    activePanel.webview.html = placeholderHtml('Open a G-code file (.nc, .gcode, .ngc, etc.) to see the plain-language explanation.');
    return;
  }

  const text = editor.document.getText();
  const dialect = vscode.workspace.getConfiguration().get<string>('jobline.controlType', 'fanuc');
  const explanations = buildExplanations(text, dialect);

  if (explanations.length === 0) {
    activePanel.webview.html = placeholderHtml('Could not parse the active document.');
    return;
  }

  // Derive program name from first O-number line or file name
  const firstOLine = text.split(/\r?\n/).find(l => /^\s*[Oo]\d+/.test(l));
  const oMatch = firstOLine ? firstOLine.trim().match(/[Oo](\d+)/) : null;
  const fileName = editor.document.fileName.replace(/\\/g, '/').split('/').pop() ?? '';
  const programName = oMatch
    ? `O${oMatch[1]} — ${fileName}`
    : fileName;

  activePanel.webview.html = generateHtml(
    explanations,
    activePanel.webview,
    programName,
    explanations.length
  );

  // Highlight the current cursor line after render (no forced scroll)
  const activeLine = editor.selection.active.line;
  setTimeout(() => {
    activePanel?.webview.postMessage({ type: 'highlight', line: activeLine });
  }, 150);
}

function isGCodeDoc(document: vscode.TextDocument | undefined): boolean {
  if (!document) return false;
  if (document.languageId === 'gcode') return true;
  return /\.(nc|gcode|ngc|tap|cnc|mpf|spf|prg|min)$/i.test(document.fileName);
}

function placeholderHtml(message: string): string {
  return `<!DOCTYPE html><html><body style="
    background:var(--vscode-editor-background,#1e1e1e);
    color:var(--vscode-descriptionForeground,#aaa);
    font-family:var(--vscode-font-family,sans-serif);
    padding:2rem; font-size:14px;">
    <p>${escHtml(message)}</p>
  </body></html>`;
}
