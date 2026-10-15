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
import { checkProgramAgainstLibrary } from '../tooling/toolLibraryCheck';
import { getToolLibraryStore } from '../tooling/toolLibraryStore';

const tokenizer    = new Tokenizer();
const blockParser  = new BlockParser();
const modelBuilder = new ProgramModelBuilder();

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function isGCodeDocument(document: vscode.TextDocument): boolean {
  return isGCodeFile(document);
}

export function runDiagnostics(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection,
): vscode.Diagnostic[] | undefined {
  if (!isGCodeDocument(document)) { collection.delete(document.uri); return undefined; }

  const cfg = vscode.workspace.getConfiguration();
  const engineConfig: DiagnosticConfig = {
    controlType:        cfg.get<string>('jobline.controlType', 'fanuc'),
    arcTolerance:       cfg.get<number>('jobline.validation.arcTolerance', 0.001),
    enableSafetyChecks: cfg.get<boolean>('jobline.validation.enableSafetyChecks', true),
    enableArcValidation:cfg.get<boolean>('jobline.validation.enableArcValidation', true),
  };
  const text = document.getText();
  if (cfg.get<boolean>('jobline.validation.controlSpecificRules', true)) engineConfig.sourceText = text;
  const lines = text.split(/\r?\n/);

  let blocks; let stateAtBlock; let model;
  try {
    const tokenized = tokenizer.tokenizeDocument(text);
    blocks = blockParser.parseDocument(tokenized);
    model = modelBuilder.build(blocks, engineConfig.controlType);
    stateAtBlock = model.stateAtBlock;
  } catch {
    collection.delete(document.uri);
    return undefined;
  }

  const engineDiags = runDiagnosticEngine(blocks, stateAtBlock, engineConfig);

  // Imported tool library / linked setup sheet: T/H, T/D, missing tools, diameters.
  const library = getToolLibraryStore()?.libraryFor(document.uri);
  if (library && library.tools.length) {
    const lathe = engineConfig.controlType === 'okuma' || model.detectedMachineType.includes('Turn');
    const check = checkProgramAgainstLibrary({
      blocks, stateAtBlock, tools: model.tools, library, controlType: engineConfig.controlType, lathe,
    });
    engineDiags.push(...check.diagnostics);
  }

  const vsDiags = engineDiags.map(d => {
    const lineText = lines[d.line] ?? '';
    const range = new vscode.Range(
      new vscode.Position(d.line, 0),
      new vscode.Position(d.line, lineText.length),
    );
    const severity = d.severity === 'error'
      ? vscode.DiagnosticSeverity.Error
      : d.severity === 'info'
        ? vscode.DiagnosticSeverity.Information
        : vscode.DiagnosticSeverity.Warning;
    const diag = new vscode.Diagnostic(range, d.message, severity);
    diag.source = 'JobLine';
    return diag;
  });

  collection.set(document.uri, vsDiags);
  return vsDiags;
}

export function registerDiagnosticsProvider(context: vscode.ExtensionContext): vscode.DiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection('jobline');
  context.subscriptions.push(collection);

  function scheduleUpdate(document: vscode.TextDocument): void {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runDiagnostics(document, collection), 500);
  }

  for (const editor of vscode.window.visibleTextEditors) {
    runDiagnostics(editor.document, collection);
  }

  // Re-check open programs when a tool library is imported or a setup sheet linked.
  const store = getToolLibraryStore();
  if (store) {
    context.subscriptions.push(store.onDidChange(() => {
      for (const editor of vscode.window.visibleTextEditors) runDiagnostics(editor.document, collection);
    }));
  }
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('jobline.controlType') || e.affectsConfiguration('jobline.validation')) {
      for (const editor of vscode.window.visibleTextEditors) runDiagnostics(editor.document, collection);
    }
  }));

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
  return collection;
}
