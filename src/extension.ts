/**
 * JobLine G-Code Intelligence — Extension Entry Point
 * Architecture v0.4.0
 *
 * Activates on gcode language, registers providers and views.
 */

import * as vscode from 'vscode';
import { loadConfig } from './config';
import { getHoverContent } from './providers/hoverProvider';
import { registerSidebarTreeProviders } from './providers/sidebarTreeProviders';
import { openExplanationPanel } from './providers/explanationProvider';
import { ToolboxViewProvider, registerToolboxCommands } from './providers/toolboxProvider';

const LANGUAGE_ID = 'gcode';

export function activate(context: vscode.ExtensionContext): void {
  // Register static sidebar trees so contributed views always have data providers.
  registerSidebarTreeProviders(context);

  // =========================================================================
  // Register Toolbox WebviewView (sidebar panel)
  // =========================================================================
  const toolboxProvider = new ToolboxViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ToolboxViewProvider.viewId, toolboxProvider)
  );

  // Register toolbox commands (also accessible via command palette)
  registerToolboxCommands(context);

  // Load configuration
  const config = loadConfig(
    (key: string) => vscode.workspace.getConfiguration().get(key)
  );

  // =========================================================================
  // Register Hover Provider
  // =========================================================================
  const hoverProvider = vscode.languages.registerHoverProvider(LANGUAGE_ID, {
    provideHover(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken) {
      const line = document.lineAt(position.line);
      const content = getHoverContent(line.text, position.line, position.character);

      if (content) {
        const markdown = new vscode.MarkdownString(content);
        markdown.isTrusted = true;
        return new vscode.Hover(markdown);
      }
      return null;
    },
  });
  context.subscriptions.push(hoverProvider);

  // =========================================================================
  // Register Commands
  // =========================================================================

  // Select control type
  const selectControlCmd = vscode.commands.registerCommand(
    'jobline.selectControl',
    async () => {
      const controls = [
        { label: 'Fanuc', description: '0i / 30i / 31i series', id: 'fanuc' },
        { label: 'Haas', description: 'NGC controls', id: 'haas' },
        { label: 'Siemens', description: 'Sinumerik 840D / 828D', id: 'siemens' },
        { label: 'Mazak', description: 'Smooth / Matrix controls', id: 'mazak' },
        { label: 'Okuma', description: 'OSP-P controls', id: 'okuma' },
      ];

      const selected = await vscode.window.showQuickPick(controls, {
        placeHolder: 'Select CNC control type',
      });

      if (selected) {
        await vscode.workspace
          .getConfiguration()
          .update('jobline.controlType', selected.id, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`JobLine: Control set to ${selected.label}`);
      }
    }
  );
  context.subscriptions.push(selectControlCmd);

  // Open plain-language explanation panel
  const explainCmd = vscode.commands.registerCommand(
    'jobline.openExplainer',
    () => openExplanationPanel(context)
  );
  context.subscriptions.push(explainCmd);

  // Validate program (placeholder — full implementation in Phase 3)
  const validateCmd = vscode.commands.registerCommand(
    'jobline.validateProgram',
    () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
      }
      vscode.window.showInformationMessage(
        'JobLine: Full validation coming in Phase 3. Syntax highlighting and hover are active.'
      );
    }
  );
  context.subscriptions.push(validateCmd);

  // =========================================================================
  // Status Bar
  // =========================================================================
  const controlStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  controlStatusBar.command = 'jobline.selectControl';
  updateStatusBar(controlStatusBar, config.controlType);
  controlStatusBar.show();
  context.subscriptions.push(controlStatusBar);

  // =========================================================================
  // Watch for configuration changes
  // =========================================================================
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
      if (e.affectsConfiguration('jobline')) {
        const newConfig = loadConfig(
          (key: string) => vscode.workspace.getConfiguration().get(key)
        );
        updateStatusBar(controlStatusBar, newConfig.controlType);
      }
    })
  );

}

export function deactivate(): void {
  // intentionally empty — VS Code disposes subscriptions automatically
}

// =============================================================================
// Helpers
// =============================================================================

function updateStatusBar(item: vscode.StatusBarItem, controlType: string): void {
  const labels: Record<string, string> = {
    fanuc: 'Fanuc',
    haas: 'Haas',
    siemens: 'Siemens',
    mazak: 'Mazak',
    okuma: 'Okuma',
  };
  item.text = `$(tools) [${labels[controlType] ?? controlType}]`;
  item.tooltip = 'JobLine: Click to change CNC control type';
}
