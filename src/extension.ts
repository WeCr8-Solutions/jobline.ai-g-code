import { sendToolpathUpdate, parseGCodeToPath } from './providers/toolpathMessaging';
import { ToolpathVisualizerPanel } from './providers/toolpathVisualizer';
/**
 * JobLine G-Code Intelligence — Extension Entry Point
 * Architecture v0.4.0
 *
 * Activates on gcode language, registers providers and views.
 */

import * as vscode from 'vscode';
import { loadConfig } from './config';
import { getHoverContent } from './providers/hoverProvider';
import { registerSidebarTreeProviders, registerToolsCommands, registerCommandsTree } from './providers/sidebarTreeProviders';
import { openExplanationPanel } from './providers/explanationProvider';
import { ToolboxViewProvider, registerToolboxCommands } from './providers/toolboxProvider';
import { registerDiagnosticsProvider } from './providers/diagnosticsProvider';
import { registerFormatter } from './providers/formatterProvider';
import { registerSubprogramProvider } from './providers/subprogramProvider';

const LANGUAGE_ID = 'gcode';

export function activate(context: vscode.ExtensionContext): void {
        // Playback state
        const playback = {
          path: [] as ReturnType<typeof parseGCodeToPath>,
          cutterSize: 10,
          idx: 0,
          timer: undefined as undefined | NodeJS.Timeout,
          playing: false
        };

        function updateVisualizerAt(idx: number) {
          if (!playback.path.length) return;
          sendToolpathUpdate(playback.path, playback.cutterSize, idx);
        }

        function loadPathFromEditor() {
          const editor = vscode.window.activeTextEditor;
          if (!editor || editor.document.languageId !== 'gcode') return false;
          try {
            playback.path = parseGCodeToPath(editor.document.getText());
            playback.idx = 0;
            return true;
          } catch (err) {
            vscode.window.showErrorMessage('JobLine: Failed to parse G-code: ' + String(err));
            return false;
          }
        }

        function stopPlayback() {
          playback.playing = false;
          if (playback.timer) clearTimeout(playback.timer);
          playback.timer = undefined;
        }

        // Play command
        const playCmd = vscode.commands.registerCommand('jobline.gcode.play', () => {
          if (!ToolpathVisualizerPanel.currentPanel) {
            vscode.window.showWarningMessage('Open the visualizer first (click the 3D icon in the toolbar).');
            return;
          }
          if (!loadPathFromEditor()) {
            vscode.window.showWarningMessage('Open a G-code file to play.');
            return;
          }
          stopPlayback();
          playback.playing = true;
          function step() {
            if (!playback.playing || !ToolpathVisualizerPanel.currentPanel) {
              stopPlayback();
              return;
            }
            updateVisualizerAt(playback.idx);
            playback.idx++;
            if (playback.idx < playback.path.length) {
              playback.timer = setTimeout(step, 350); // 350ms per step
            } else {
              stopPlayback();
            }
          }
          step();
        });
        context.subscriptions.push(playCmd);

        // Pause command
        const pauseCmd = vscode.commands.registerCommand('jobline.gcode.pause', () => {
          stopPlayback();
        });
        context.subscriptions.push(pauseCmd);

        // Step Forward command
        const stepFwdCmd = vscode.commands.registerCommand('jobline.gcode.stepForward', () => {
          if (!playback.path.length) loadPathFromEditor();
          if (!playback.path.length) return;
          stopPlayback();
          if (playback.idx < playback.path.length - 1) playback.idx++;
          updateVisualizerAt(playback.idx);
        });
        context.subscriptions.push(stepFwdCmd);

        // Step Back command
        const stepBackCmd = vscode.commands.registerCommand('jobline.gcode.stepBack', () => {
          if (!playback.path.length) loadPathFromEditor();
          if (!playback.path.length) return;
          stopPlayback();
          if (playback.idx > 0) playback.idx--;
          updateVisualizerAt(playback.idx);
        });
        context.subscriptions.push(stepBackCmd);

        // Jump to Line command
        const jumpCmd = vscode.commands.registerCommand('jobline.gcode.jumpToLine', async () => {
          if (!playback.path.length) loadPathFromEditor();
          if (!playback.path.length) return;
          stopPlayback();
          const val = await vscode.window.showInputBox({ prompt: 'Enter toolpath point index (0-based)', validateInput: v => isNaN(Number(v)) ? 'Enter a number' : undefined });
          if (val === undefined) return;
          const idx = Math.max(0, Math.min(playback.path.length - 1, Number(val)));
          playback.idx = idx;
          updateVisualizerAt(playback.idx);
        });
        context.subscriptions.push(jumpCmd);
      // Example: Command to send current editor G-code to visualizer
      const updateVisualizerCmd = vscode.commands.registerCommand('jobline.gcode.updateVisualizer', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'gcode') {
          vscode.window.showWarningMessage('Open a G-code file to visualize.');
          return;
        }
        const gcode = editor.document.getText();
        const path = parseGCodeToPath(gcode);
        // Use fixed cutter size; highlight last point if path exists
        const highlightIdx = path.length > 0 ? path.length - 1 : 0;
        sendToolpathUpdate(path, 10, highlightIdx);
        vscode.window.showInformationMessage('Toolpath visualizer updated.');
      });
      context.subscriptions.push(updateVisualizerCmd);
    // Register Toolpath Visualizer command
    const showVisualizerCmd = vscode.commands.registerCommand('jobline.gcode.showVisualizer', () => {
      ToolpathVisualizerPanel.show(context.extensionUri);
    });
    context.subscriptions.push(showVisualizerCmd);
  // Register static sidebar trees so contributed views always have data providers.
  registerSidebarTreeProviders(context);

  // Register the Commands panel tree
  registerCommandsTree(context);

  // Register tools tree commands (Add / Go-To / Remove tool change)
  registerToolsCommands(context);

  // Register diagnostic squiggles provider
  registerDiagnosticsProvider(context);

  // Register G-Code formatter
  registerFormatter(context);

  // Register subprogram navigation (Go to Definition, Document Links, Workspace Symbols)
  registerSubprogramProvider(context);

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
        { label: '$(circuit-board) Fanuc CNC',    description: '0i / 30i / 31i series',           id: 'fanuc' },
        { label: '$(circuit-board) Haas',          description: 'NGC controls',                    id: 'haas' },
        { label: '$(circuit-board) Siemens',       description: 'Sinumerik 840D / 828D',           id: 'siemens' },
        { label: '$(circuit-board) Mazak',         description: 'Smooth / Matrix controls',        id: 'mazak' },
        { label: '$(circuit-board) Okuma',         description: 'OSP-P controls',                  id: 'okuma' },
        { label: '$(robot) Fanuc Robot',           description: 'TP / LS teach-pendant programs',  id: 'fanuc-robot' },
        { label: '$(robot) ABB RAPID',             description: 'ABB robot RAPID .mod programs',   id: 'abb' },
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
    fanuc: 'Fanuc CNC',
    haas: 'Haas',
    siemens: 'Siemens',
    mazak: 'Mazak',
    okuma: 'Okuma',
    'fanuc-robot': 'Fanuc Robot',
    abb: 'ABB RAPID',
  };
  const icon = (controlType === 'fanuc-robot' || controlType === 'abb') ? '$(robot)' : '$(tools)';
  item.text = `${icon} [${labels[controlType] ?? controlType}]`;
  item.tooltip = 'JobLine: Click to change CNC / robot control type';
}
