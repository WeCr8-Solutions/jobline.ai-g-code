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

function generateHtml(explanations: LineExplanation[], _webview: vscode.Webview): string {
  const rows = explanations.map(e => {
    const rawEscaped = escHtml(e.raw || '\u00a0'); // nbsp for empty lines
    const explanationEscaped = escHtml(e.explanation || '\u00a0');
    const hasContent = e.explanation.trim().length > 0;
    return `<div class="line-row${hasContent ? '' : ' empty'}" data-line="${e.lineNum - 1}">
  <span class="ln">${e.lineNum}</span>
  <span class="raw">${rawEscaped}</span>
  <span class="expl">${explanationEscaped}</span>
</div>`;
  }).join('\n');

  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
  :root {
    --bg: var(--vscode-editor-background, #1e1e1e);
    --fg: var(--vscode-editor-foreground, #d4d4d4);
    --border: var(--vscode-editorGroup-border, #444);
    --ln-fg: var(--vscode-editorLineNumber-foreground, #858585);
    --raw-fg: var(--vscode-textPreformat-foreground, #9cdcfe);
    --expl-fg: var(--vscode-editor-foreground, #d4d4d4);
    --hl-bg: var(--vscode-editor-lineHighlightBackground, rgba(255,255,255,0.06));
    --font: var(--vscode-editor-font-family, 'Consolas', monospace);
    --font-size: var(--vscode-editor-font-size, 13px);
    --line-height: 1.5;
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
  #container { width: 100%; }
  .line-row {
    display: grid;
    grid-template-columns: 3.5em 1fr 1fr;
    gap: 0 1em;
    padding: 0 0.5em;
    min-height: calc(var(--font-size) * var(--line-height));
    align-items: baseline;
    border-bottom: 1px solid transparent;
  }
  .line-row:hover  { background: var(--hl-bg); }
  .line-row.active { background: var(--hl-bg); border-left: 2px solid var(--vscode-focusBorder, #007acc); }
  .line-row.empty .expl { opacity: 0.3; }
  .ln {
    color: var(--ln-fg);
    text-align: right;
    user-select: none;
    flex-shrink: 0;
    font-size: 0.9em;
  }
  .raw {
    color: var(--raw-fg);
    white-space: pre;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--font);
  }
  .expl {
    color: var(--expl-fg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  #header {
    position: sticky;
    top: 0;
    background: var(--vscode-titleBar-activeBackground, #3c3c3c);
    color: var(--vscode-titleBar-activeForeground, #ccc);
    font-size: 0.85em;
    padding: 4px 0.5em;
    display: grid;
    grid-template-columns: 3.5em 1fr 1fr;
    gap: 0 1em;
    border-bottom: 1px solid var(--border);
    user-select: none;
    z-index: 10;
  }
  #header span { font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
</style>
</head>
<body>
<div id="header">
  <span></span>
  <span>G-Code</span>
  <span>Plain Language</span>
</div>
<div id="container">
${rows}
</div>
<script>
  const vscode = acquireVsCodeApi();

  // Scroll sync: receive first-visible-line from extension
  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'scroll') {
      const firstLine = msg.firstLine;
      const el = document.querySelector('[data-line="' + firstLine + '"]');
      if (el) {
        // Remove previous active marker
        document.querySelectorAll('.active').forEach(e => e.classList.remove('active'));
        el.classList.add('active');
        // Scroll so this element is near the top
        const containerTop = document.getElementById('header').offsetHeight;
        const elTop = el.getBoundingClientRect().top + window.scrollY - containerTop;
        window.scrollTo({ top: elTop, behavior: 'smooth' });
      }
    }
    if (msg.type === 'refresh') {
      // Full refresh: reload via command
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

  // Scroll sync: listen to editor visible range changes
  scrollListener = vscode.window.onDidChangeTextEditorVisibleRanges(event => {
    if (!activePanel) return;
    const editor = event.textEditor;
    if (!isGCodeDoc(editor.document)) return;
    const firstLine = event.visibleRanges[0]?.start.line ?? 0;
    activePanel.webview.postMessage({ type: 'scroll', firstLine });
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

  activePanel.webview.html = generateHtml(explanations, activePanel.webview);

  // Scroll to current editor position after render
  const firstLine = editor.visibleRanges[0]?.start.line ?? 0;
  setTimeout(() => {
    activePanel?.webview.postMessage({ type: 'scroll', firstLine });
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
