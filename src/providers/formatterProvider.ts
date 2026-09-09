/**
 * JobLine G-Code Formatter Provider
 *
 * Implements the `jobline.formatDocument` command and registers as a
 * DocumentFormattingEditProvider for the 'gcode' language.
 *
 * The rules themselves live in ../formatter/formatterRules, which imports no
 * vscode API so it can be unit tested. This file is the VS Code binding only.
 */

import * as vscode from 'vscode';
import { formatText, type FormatterConfig } from '../formatter/formatterRules';

// ---------------------------------------------------------------------------
// Core format function
// ---------------------------------------------------------------------------

function formatDocument(document: vscode.TextDocument): vscode.TextEdit[] {
  const cfg = vscode.workspace.getConfiguration();
  const config: FormatterConfig = {
    wordSpacing: cfg.get<boolean>('jobline.formatter.wordSpacing', true),
    uppercaseGM: cfg.get<boolean>('jobline.formatter.uppercaseGM', true),
    decimalPlaces: cfg.get<number | null>('jobline.formatter.decimalPlaces', null),
  };

  const text = document.getText();
  const newText = formatText(text, config);
  if (newText === null) return [];

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
