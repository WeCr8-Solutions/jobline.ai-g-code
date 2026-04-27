/**
 * JobLine G-Code Diagnostics Provider — VS Code wrapper
 *
 * Thin adapter: reads VS Code configuration, calls the pure diagnostic
 * engine (src/diagnostics/engine.ts), then converts plain EngineDiagnostic
 * objects into vscode.Diagnostic instances with ranges and source tags.
 */

import * as vscode from 'vscode';
import { Tokenizer } from '../parser/tokenizer';
import { BlockParser } from '../parser/blockParser';
import { ProgramModelBuilder } from '../parser/programModel';
import { runDiagnosticEngine, DiagnosticConfig } from '../diagnostics/engine';
import { isGCodeFile } from '../utils/fileTypes';

const tokenizer    = new Tokenizer();
const blockParser  = new BlockParser();
const modelBuilder = new ProgramModelBuilder();

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function isGCodeDocument(document: vscode.TextDocument): boolean {
  return isGCodeFile(document);
}

function runDiagnostics(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection,
): void {
  if (!isGCodeDocument(document)) { collection.delete(document.uri); return; }

  const cfg = vscode.workspace.getConfiguration();
  const engineConfig: DiagnosticConfig = {
    controlType:        cfg.get<string>('jobline.controlType', 'fanuc'),
    arcTolerance:       cfg.get<number>('jobline.validation.arcTolerance', 0.001),
    enableSafetyChecks: cfg.get<boolean>('jobline.validation.enableSafetyChecks', true),
    enableArcValidation:cfg.get<boolean>('jobline.validation.enableArcValidation', true),
  };

  const text = document.getText();
  const lines = text.split(/\r?\n/);

  let blocks; let stateAtBlock;
  try {
    const tokenized = tokenizer.tokenizeDocument(text);
    blocks = blockParser.parseDocument(tokenized);
    const model = modelBuilder.build(blocks, engineConfig.controlType);
    stateAtBlock = model.stateAtBlock;
  } catch {
    collection.delete(document.uri);
    return;
  }

  const engineDiags = runDiagnosticEngine(blocks, stateAtBlock, engineConfig);

  const vsDiags = engineDiags.map(d => {
    const lineText = lines[d.line] ?? '';
    const range = new vscode.Range(
      new vscode.Position(d.line, 0),
      new vscode.Position(d.line, lineText.length),
    );
    const severity = d.severity === 'error'
      ? vscode.DiagnosticSeverity.Error
      : vscode.DiagnosticSeverity.Warning;
    const diag = new vscode.Diagnostic(range, d.message, severity);
    diag.source = 'JobLine';
    return diag;
  });

  collection.set(document.uri, vsDiags);
}

export function registerDiagnosticsProvider(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection('jobline');
  context.subscriptions.push(collection);

  function scheduleUpdate(document: vscode.TextDocument): void {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runDiagnostics(document, collection), 500);
  }

  for (const editor of vscode.window.visibleTextEditors) {
    runDiagnostics(editor.document, collection);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(doc => {
      if (isGCodeDocument(doc)) runDiagnostics(doc, collection);
    }),
    vscode.workspace.onDidChangeTextDocument(e => scheduleUpdate(e.document)),
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (isGCodeDocument(doc)) runDiagnostics(doc, collection);
    }),
    vscode.workspace.onDidCloseTextDocument(doc => collection.delete(doc.uri)),
  );
}
