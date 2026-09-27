import { sendToolpathUpdate, parseGCodeToPath } from './providers/toolpathMessaging';
import { ToolpathVisualizerPanel } from './providers/toolpathVisualizer';
import { ToolPreviewPanel } from './providers/toolPreviewPanel';
/**
 * JobLine G-Code Intelligence — Extension Entry Point
 * Architecture v0.4.0
 *
 * Activates on gcode language, registers providers and views.
 */

import * as vscode from 'vscode';
import { loadConfig } from './config';
import { getHoverMarkdown } from './providers/hoverProvider';
import { registerSidebarTreeProviders, registerToolsCommands, getLastGCodeDoc } from './providers/sidebarTreeProviders';
import { registerCommandsTree } from './providers/commandsTreeProvider';
import { registerVisualizerSettings } from './providers/visualizerSettingsProvider';
import { isGCodeFile } from './utils/fileTypes';
import { selectPreferredGCodeDocument } from './utils/gcodeDocumentTracker';
import { openExplanationPanel } from './providers/explanationProvider';
import { ToolboxViewProvider, registerToolboxCommands } from './providers/toolboxProvider';
import { registerDiagnosticsProvider } from './providers/diagnosticsProvider';
import { registerFormatter } from './providers/formatterProvider';
import { registerSubprogramProvider } from './providers/subprogramProvider';
import { buildVisualizerHarnessData } from './providers/visualizer/fixtureHarness';
import { buildAutoSimulationMessages } from './providers/visualizer/simulationSetup';
import type { ToolpathPoint } from './providers/visualizer/toolpathParser';
import { reviewGCodeProgram } from './providers/visualizer/programReview';
import { loadStlMesh } from './providers/visualizer/stlMeshLoader';
import { parseSTEP } from './providers/visualizer/stepParser';
import { parseParasolidText } from './providers/visualizer/parasolidTextParser';
import { extractFusionPreview, parseFusionSetupArchive } from './providers/visualizer/fusionArchiveParser';
import type { Bounds3D } from './providers/visualizer/gcodeGoalComparison';

const LANGUAGE_ID = 'gcode';

export function activate(context: vscode.ExtensionContext): void {
        function getPreferredGCodeDoc(): vscode.TextDocument | undefined {
          return selectPreferredGCodeDocument({
            activeDocument: vscode.window.activeTextEditor?.document,
            lastDocument: getLastGCodeDoc(),
            visibleDocuments: vscode.window.visibleTextEditors.map(editor => editor.document),
            openDocuments: vscode.workspace.textDocuments,
            isGCodeDocument: isGCodeFile,
          });
        }

        // Playback state
        const playback = {
          path: [] as ToolpathPoint[],
          // Diameter in program units. A shop-scale default avoids turning the
          // swept-path preview into a machine-sized solid when no tool metadata exists.
          cutterSize: 0.25,
          idx: 0,
          timer: undefined as undefined | NodeJS.Timeout,
          playing: false,
          speed: 1.0,
          units: 'in' as 'in' | 'mm',
          sourceUri: '',
          sourceVersion: -1,
        };

        const playbackLineDecoration = vscode.window.createTextEditorDecorationType({
          isWholeLine: true,
          backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
          borderColor: new vscode.ThemeColor('editorOverviewRuler.currentContentForeground'),
          borderStyle: 'solid',
          borderWidth: '0 0 0 2px',
          overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.currentContentForeground'),
          overviewRulerLane: vscode.OverviewRulerLane.Full,
        });
        context.subscriptions.push(playbackLineDecoration);
        let revealingPlaybackSource = false;

        function highlightPlaybackSourceLine(idx: number): void {
          const doc = vscode.workspace.textDocuments.find(candidate => candidate.uri.toString() === playback.sourceUri);
          if (!doc) return;
          const point = playback.path[Math.max(0, Math.min(idx, playback.path.length - 1))];
          const followingPoint = playback.path.slice(Math.max(0, idx)).find(candidate => candidate.lineNumber !== undefined);
          const sourceLine = Math.max(0, Math.min(doc.lineCount - 1, point?.lineNumber ?? followingPoint?.lineNumber ?? 0));
          const range = doc.lineAt(sourceLine).range;
          const decorate = (editor: vscode.TextEditor) => {
            for (const visibleEditor of vscode.window.visibleTextEditors) {
              if (visibleEditor !== editor) visibleEditor.setDecorations(playbackLineDecoration, []);
            }
            editor.setDecorations(playbackLineDecoration, [range]);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
          };
          const visibleEditor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === playback.sourceUri);
          if (visibleEditor) {
            decorate(visibleEditor);
            return;
          }
          if (revealingPlaybackSource) return;
          revealingPlaybackSource = true;
          void vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.One,
            preview: false,
            preserveFocus: true,
          }).then(editor => {
            revealingPlaybackSource = false;
            if (editor.document.uri.toString() === playback.sourceUri) decorate(editor);
          }, () => {
            revealingPlaybackSource = false;
          });
        }

        function updateVisualizerAt(idx: number) {
          if (!playback.path.length) return;
          sendToolpathUpdate(playback.path, playback.cutterSize, idx, playback.units);
          highlightPlaybackSourceLine(idx);
        }

        function updateProgramList(): void {
          const docs = vscode.workspace.textDocuments.filter(isGCodeFile);
          ToolpathVisualizerPanel.queueMessage({
            type: 'programList',
            activeUri: playback.sourceUri || vscode.window.activeTextEditor?.document.uri.toString() || '',
            programs: docs.map(document => ({
              uri: document.uri.toString(),
              name: document.uri.path.split(/[\\/]/).pop() || document.fileName,
              path: document.fileName,
            })),
          });
        }

        function loadPathFromEditor(resetPosition = true) {
          const doc = getPreferredGCodeDoc();
          if (!doc) return false;
          try {
            const sourceChanged = playback.sourceUri !== doc.uri.toString();
            const result = parseGCodeToPath(doc.getText());
            playback.path = result.path;
            playback.units = result.units;
            playback.sourceUri = doc.uri.toString();
            playback.sourceVersion = doc.version;
            if (resetPosition || sourceChanged) playback.idx = 0;
            else playback.idx = Math.min(playback.idx, Math.max(0, playback.path.length - 1));
            return true;
          } catch (err) {
            vscode.window.showErrorMessage('JobLine: Failed to parse G-code: ' + String(err));
            return false;
          }
        }

        function loadSimulationSetupFromEditor(): boolean {
          const doc = getPreferredGCodeDoc();
          return doc ? loadSimulationSetupFromDocument(doc) : false;
        }

        function loadSimulationSetupFromDocument(doc: vscode.TextDocument): boolean {
          if (!doc) return false;
          try {
            const controlType = vscode.workspace.getConfiguration().get<string>('jobline.controlType', 'fanuc');
            const harness = buildVisualizerHarnessData(doc.getText(), controlType);
            playback.cutterSize = harness.tools[0]?.diameter || (harness.unit === 'mm' ? 6 : 0.25);
            machineStatusBar.text = `$(vm) ${harness.setup.machineType}`;
            machineStatusBar.tooltip = 'Auto-detected from the active G-code program; click to override';
            for (const message of buildAutoSimulationMessages(harness)) {
              ToolpathVisualizerPanel.queueMessage(message);
            }
            ToolpathVisualizerPanel.queueMessage({ type: 'review', review: reviewGCodeProgram(doc.getText(), controlType) });
            return true;
          } catch (err) {
            vscode.window.showWarningMessage('JobLine: Unable to auto-load stock/tool setup: ' + String(err));
            return false;
          }
        }

        function refreshVisualizerForDocument(doc: vscode.TextDocument, resetPosition = true): boolean {
          if (!isGCodeFile(doc) || !ToolpathVisualizerPanel.currentPanel) return false;
          try {
            const sourceChanged = playback.sourceUri !== doc.uri.toString();
            const result = parseGCodeToPath(doc.getText());
            playback.path = result.path;
            playback.units = result.units;
            playback.sourceUri = doc.uri.toString();
            playback.sourceVersion = doc.version;
            if (resetPosition || sourceChanged) playback.idx = 0;
            else playback.idx = Math.min(playback.idx, Math.max(0, playback.path.length - 1));
            sendToolpathUpdate(playback.path, playback.cutterSize, playback.idx, playback.units);
            loadSimulationSetupFromDocument(doc);
            updateProgramList();
            return true;
          } catch {
            return false;
          }
        }

        function stopPlayback() {
          playback.playing = false;
          if (playback.timer) clearTimeout(playback.timer);
          playback.timer = undefined;
        }

        // Play command
        const playCmd = vscode.commands.registerCommand('jobline.gcode.play', (speed?: number) => {
          if (speed !== undefined) playback.speed = Math.max(0.25, Math.min(4, Number(speed) || 1));
          if (!ToolpathVisualizerPanel.currentPanel) {
            vscode.window.showWarningMessage('Open the visualizer first (click the 3D icon in the toolbar).');
            return;
          }
          if (!loadPathFromEditor(false)) {
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
            const point = playback.path[playback.idx];
            playback.idx++;
            if (playback.idx < playback.path.length) {
              const baseMs = point?.isRapid ? 500 : 350;
              const stepMs = Math.max(50, baseMs / playback.speed);
              playback.timer = setTimeout(step, stepMs);
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

        // Stop is distinct from pause: it cancels playback and returns the
        // viewer to the beginning so the next Play starts a fresh run.
        const stopCmd = vscode.commands.registerCommand('jobline.gcode.stop', () => {
          stopPlayback();
          if (!playback.path.length) loadPathFromEditor();
          playback.idx = 0;
          updateVisualizerAt(playback.idx);
        });
        context.subscriptions.push(stopCmd);

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
        const jumpCmd = vscode.commands.registerCommand('jobline.gcode.jumpToLine', async (arg?: number) => {
          if (!playback.path.length) loadPathFromEditor();
          if (!playback.path.length) return;
          stopPlayback();
          let idx: number;
          if (typeof arg === 'number') {
            idx = Math.max(0, Math.min(playback.path.length - 1, arg));
          } else {
            const val = await vscode.window.showInputBox({ prompt: 'Enter G-code source line number (1-based)', validateInput: v => !Number.isInteger(Number(v)) || Number(v) < 1 ? 'Enter a positive whole number' : undefined });
            if (val === undefined) return;
            const sourceLine = Number(val) - 1;
            const matchingIndex = playback.path.findIndex(point => point.lineNumber !== undefined && point.lineNumber >= sourceLine);
            idx = matchingIndex >= 0 ? matchingIndex : playback.path.length - 1;
          }
          playback.idx = idx;
          updateVisualizerAt(playback.idx);
        });
        context.subscriptions.push(jumpCmd);

        const importTargetModelCmd = vscode.commands.registerCommand('jobline.gcode.importTargetModel', async (uriText?: string | vscode.Uri | vscode.Uri[] | { uri?: string | vscode.Uri; role?: string; targetId?: string }) => {
          if (!ToolpathVisualizerPanel.currentPanel) {
            ToolpathVisualizerPanel.show(context.extensionUri);
          }
          let uris: vscode.Uri[] = [];
          const role = typeof uriText === 'object' && !(uriText instanceof vscode.Uri) && !Array.isArray(uriText)
            ? uriText.role || 'target-part'
            : 'target-part';
          const targetId = typeof uriText === 'object' && !(uriText instanceof vscode.Uri) && !Array.isArray(uriText)
            ? uriText.targetId || role
            : role;
          const suppliedUri = typeof uriText === 'object' && !(uriText instanceof vscode.Uri) && !Array.isArray(uriText)
            ? uriText.uri
            : uriText;
          if (Array.isArray(suppliedUri)) {
            uris = suppliedUri;
          } else if (suppliedUri instanceof vscode.Uri) {
            uris = [suppliedUri];
          } else if (typeof suppliedUri === 'string' && suppliedUri.trim()) {
            uris = [vscode.Uri.parse(suppliedUri)];
          } else {
            const picked = await vscode.window.showOpenDialog({
              title: 'Import scene models for JobLine visualizer',
              canSelectMany: true,
              filters: {
                'Scene model or Fusion setup': ['stl', 'stp', 'step', 'x_t', 'x_b', 'xmt_txt', 'xmt', 'f3d'],
                'Fusion 360 setup': ['f3d'],
                'STL': ['stl'],
                'STEP': ['stp', 'step'],
                'Parasolid text': ['x_t', 'xmt_txt', 'xmt'],
                'All files': ['*'],
              },
            });
            uris = picked || [];
          }
          if (!uris.length) return;
          let loaded = 0;
          for (const [index, uri] of uris.entries()) {
            try {
              const bytes = await vscode.workspace.fs.readFile(uri);
              const ext = uri.fsPath.toLowerCase().split('.').pop() || '';
              const supportedExtensions = new Set(['stl', 'stp', 'step', 'x_t', 'x_b', 'xmt_txt', 'xmt', 'f3d']);
              if (!supportedExtensions.has(ext)) {
                vscode.window.showErrorMessage(
                  `JobLine: ${ext ? `.${ext}` : 'This file'} is not a supported scene model. Export STL, STEP, or Parasolid text from the CAD system first.`
                );
                continue;
              }
              const buffer = bytes.slice().buffer;
              if (ext === 'f3d') {
                const setup = parseFusionSetupArchive(bytes);
                const preview = extractFusionPreview(bytes);
                const cuttingPoints = playback.path.filter(point => !point.isRapid && Number.isFinite(point.x) && Number.isFinite(point.y));
                // Fusion's default relative stock is the model envelope plus
                // the declared allowances. This setup posts from the model's
                // top/min-X/min-Y datum, so preserve that WCS instead of
                // centering stock on lead-in and lead-out tool-center moves.
                const stockMinX = -setup.stock.sideAllowance;
                const stockMinY = -setup.stock.sideAllowance;
                const stockMinZ = setup.stock.topAllowance - setup.stock.height;
                ToolpathVisualizerPanel.queueMessage({
                  type: 'stockSettings',
                  w: setup.stock.width,
                  d: setup.stock.depth,
                  h: setup.stock.height,
                  unit: setup.units,
                  color: '#4488ff',
                });
                ToolpathVisualizerPanel.queueMessage({
                  type: 'stockOrigin',
                  xOff: stockMinX,
                  yOff: stockMinY,
                  zOff: stockMinZ,
                  preset: 'custom',
                });
                ToolpathVisualizerPanel.queueMessage({
                  type: 'workholdingSettings',
                  mode: 'none',
                  jawHeight: 25.4,
                  jawThickness: 19.05,
                  gripDepth: 0,
                  color: '#c0704f',
                });
                ToolpathVisualizerPanel.queueMessage({
                  type: 'fusionSetup',
                  name: uri.path.split(/[\\/]/).pop() || uri.fsPath,
                  setup,
                  previewDataUrl: `data:image/png;base64,${Buffer.from(preview).toString('base64')}`,
                });
                ToolpathVisualizerPanel.queueMessage({
                  type: 'targetModel',
                  id: 'fusion-model-envelope',
                  targetId: 'target-part',
                  role: 'target-part',
                  displayMode: 'transparent',
                  opacity: 0.22,
                  name: 'Fusion model dimensional envelope',
                  format: 'Fusion CAM model bounds (mm); shaded preview is reference-only',
                  pointCount: cuttingPoints.length,
                  bounds: {
                    minX: 0, maxX: setup.model.width,
                    minY: 0, maxY: setup.model.depth,
                    minZ: -setup.model.height, maxZ: 0,
                  },
                  offset: { x: 0, y: 0, z: 0 },
                });
                loaded += 1;
                continue;
              }
              let bounds: Bounds3D;
              let format = ext.toUpperCase();
              let pointCount: number | undefined;
              let meshVertices: number[] | undefined;
              if (ext === 'stl') {
                const parsed = loadStlMesh(buffer);
                bounds = parsed.bounds;
                format = `STL ${parsed.format}`;
                pointCount = parsed.triangleCount * 3;
                meshVertices = Array.from(parsed.positions);
              } else if (ext === 'stp' || ext === 'step') {
                const parsed = parseSTEP(buffer);
                bounds = parsed.bounds;
                format = parsed.schema ? `STEP ${parsed.schema}` : 'STEP';
                pointCount = parsed.pointCount;
              } else {
                const text = Buffer.from(bytes).toString('utf8');
                const parsed = parseParasolidText(text);
                bounds = parsed.bounds;
                format = 'Parasolid text';
                pointCount = parsed.pointCount;
              }
              ToolpathVisualizerPanel.queueMessage({
                type: 'targetModel',
                id: uris.length === 1 ? targetId : `${targetId}-${index + 1}`,
                targetId: uris.length === 1 ? targetId : `${targetId}-${index + 1}`,
                role,
                displayMode: role === 'fixture' || role === 'jaws' || role === 'holder' ? 'wireframe' : 'transparent',
                opacity: role === 'target-part' ? 0.35 : 0.55,
                name: uri.path.split(/[\\/]/).pop() || uri.fsPath,
                format,
                pointCount,
                meshVertices,
                bounds,
                offset: { x: 0, y: 0, z: 0 },
              });
              loaded += 1;
            } catch (err) {
              vscode.window.showErrorMessage('JobLine: Could not import scene model: ' + String(err));
            }
          }
          if (loaded > 0) {
            vscode.window.showInformationMessage(`JobLine: Loaded ${loaded} scene model(s). Select each item in the visualizer to set role, transparency, wireframe, hidden/solid, and XYZ offset.`);
          }
        });
        context.subscriptions.push(importTargetModelCmd);

        const openProgramCmd = vscode.commands.registerCommand('jobline.gcode.openProgramInVisualizer', async (uriText?: string) => {
          if (!uriText) return;
          const doc = vscode.workspace.textDocuments.find(candidate => candidate.uri.toString() === uriText);
          if (!doc || !isGCodeFile(doc)) return;
          stopPlayback();
          await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
          refreshVisualizerForDocument(doc, true);
        });
        context.subscriptions.push(openProgramCmd);

        const revealLineCmd = vscode.commands.registerCommand('jobline.gcode.revealLine', async (line?: number) => {
          const doc = getPreferredGCodeDoc();
          if (!doc || typeof line !== 'number') return;
          const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
          const target = Math.max(0, Math.min(doc.lineCount - 1, line));
          editor.selection = new vscode.Selection(target, 0, target, 0);
          editor.revealRange(new vscode.Range(target, 0, target, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        });
        context.subscriptions.push(revealLineCmd);
      // Example: Command to send current editor G-code to visualizer
      const updateVisualizerCmd = vscode.commands.registerCommand('jobline.gcode.updateVisualizer', () => {
        const doc = getPreferredGCodeDoc();
        if (!doc) {
          vscode.window.showWarningMessage('Open a G-code file to visualize.');
          return;
        }
        const gcode = doc.getText();
        const result = parseGCodeToPath(gcode);
        // Use fixed cutter size; highlight last point if path exists
        const highlightIdx = result.path.length > 0 ? result.path.length - 1 : 0;
        sendToolpathUpdate(result.path, 10, highlightIdx, result.units);
        vscode.window.showInformationMessage('Toolpath visualizer updated.');
      });
      context.subscriptions.push(updateVisualizerCmd);
    // Register Toolpath Visualizer command — open and immediately send the current path
    const showVisualizerCmd = vscode.commands.registerCommand('jobline.gcode.showVisualizer', () => {
      ToolpathVisualizerPanel.show(context.extensionUri, vscode.ViewColumn.Beside);
      // Delay one tick so the webview has time to register its message listener
      setTimeout(() => {
        if (loadPathFromEditor()) {
          sendToolpathUpdate(playback.path, playback.cutterSize, 0, playback.units);
        }
        loadSimulationSetupFromEditor();
        updateProgramList();
      }, 300);
    });
    context.subscriptions.push(showVisualizerCmd);
  // Register static sidebar trees so contributed views always have data providers.
  registerSidebarTreeProviders(context);

  // Register the Commands panel tree
  registerCommandsTree(context);

  // Register the Visualizer Settings sidebar panel
  registerVisualizerSettings(context);

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
      const markdown = getHoverMarkdown(line.text, position.line, position.character, context.extensionUri);

      if (markdown) {
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

  // Tool Preview command
  const toolPreviewCmd = vscode.commands.registerCommand(
    'jobline.openToolPreview',
    () => ToolPreviewPanel.show(context)
  );
  context.subscriptions.push(toolPreviewCmd);

  // Simulation command
  const simulationCmd = vscode.commands.registerCommand(
    'jobline.openSimulation',
    async () => {
      await vscode.commands.executeCommand('jobline.gcode.showVisualizer');
    }
  );
  context.subscriptions.push(simulationCmd);

  const simulationFullWindowCmd = vscode.commands.registerCommand(
    'jobline.openSimulationFullWindow',
    async () => {
      ToolpathVisualizerPanel.show(context.extensionUri, vscode.ViewColumn.One);
    }
  );
  context.subscriptions.push(simulationFullWindowCmd);

  // Select machine type command
  const machineSelectCmd = vscode.commands.registerCommand(
    'jobline.selectMachineType',
    async () => {
      const machineTypes = [
        '3-Axis Vertical Mill',
        '4-Axis Mill',
        '5-Axis Mill (Trunnion)',
        '5-Axis Mill (Rotary Table)',
        'Turn Center (2-Axis)',
        '5-Axis Mill-Turn',
        'Multi-Spindle Transfer',
        'Grinding Center',
      ];
      const selected = await vscode.window.showQuickPick(machineTypes, {
        placeHolder: 'Select machine type',
      });
      if (selected) {
        const activeFolder = vscode.window.activeTextEditor
          ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
          : undefined;
        const cfgTarget = activeFolder
          ? vscode.ConfigurationTarget.WorkspaceFolder
          : vscode.ConfigurationTarget.Global;
        await vscode.workspace.getConfiguration('jobline', activeFolder?.uri).update('detectedMachineType', selected, cfgTarget);
        machineStatusBar.text = `$(vm) ${selected}`;
      }
    }
  );
  context.subscriptions.push(machineSelectCmd);

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

  // Machine type status bar
  const machineStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99
  );
  machineStatusBar.command = 'jobline.selectMachineType';
  machineStatusBar.text = '$(vm) 3-Axis Vertical Mill';
  machineStatusBar.tooltip = 'Click to change detected machine type';
  machineStatusBar.show();
  context.subscriptions.push(machineStatusBar);

  // Insert stock header command
  const insertStockCmd = vscode.commands.registerCommand(
    'jobline.insertStockHeader',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isGCodeFile(editor.document)) {
        vscode.window.showWarningMessage('Open a G-code file first.');
        return;
      }

      const w = await vscode.window.showInputBox({
        prompt: 'Stock Width (X) in inches',
        value: '4',
      });
      if (w === undefined) return;

      const d = await vscode.window.showInputBox({
        prompt: 'Stock Depth (Y) in inches',
        value: '4',
      });
      if (d === undefined) return;

      const h = await vscode.window.showInputBox({
        prompt: 'Stock Height (Z) in inches',
        value: '2',
      });
      if (h === undefined) return;

      const header = `( STOCK: W=${w} D=${d} H=${h} )\n`;
      editor.edit((editBuilder) => {
        editBuilder.insert(new vscode.Position(0, 0), header);
      });

      vscode.window.showInformationMessage('Stock header inserted.');
    }
  );
  context.subscriptions.push(insertStockCmd);

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

  // =========================================================================
  // Watch for G-code file changes — auto-reload visualizer
  // =========================================================================
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e: vscode.TextDocumentChangeEvent) => {
      if (isGCodeFile(e.document) && ToolpathVisualizerPanel.currentPanel) {
        try {
          const preferredDocument = getPreferredGCodeDoc();
          if (!preferredDocument || preferredDocument.uri.toString() !== e.document.uri.toString()) return;
          const result = parseGCodeToPath(e.document.getText());
          playback.path = result.path;
          playback.units = result.units;
          playback.sourceUri = e.document.uri.toString();
          playback.sourceVersion = e.document.version;
          playback.idx = Math.min(playback.idx, Math.max(0, result.path.length - 1));
          sendToolpathUpdate(result.path, playback.cutterSize, playback.idx, result.units);
          const controlType = vscode.workspace.getConfiguration().get<string>('jobline.controlType', 'fanuc');
          for (const message of buildAutoSimulationMessages(buildVisualizerHarnessData(e.document.getText(), controlType))) {
            ToolpathVisualizerPanel.queueMessage(message);
          }
          ToolpathVisualizerPanel.queueMessage({ type: 'review', review: reviewGCodeProgram(e.document.getText(), controlType) });
        } catch (err) {
          // Silently ignore parse errors during auto-reload
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor: vscode.TextEditor | undefined) => {
      if (!ToolpathVisualizerPanel.currentPanel) return;
      updateProgramList();
      if (!editor || !isGCodeFile(editor.document)) return;
      stopPlayback();
      refreshVisualizerForDocument(editor.document, true);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document: vscode.TextDocument) => {
      if (ToolpathVisualizerPanel.currentPanel && isGCodeFile(document)) updateProgramList();
    }),
    vscode.workspace.onDidCloseTextDocument((document: vscode.TextDocument) => {
      if (ToolpathVisualizerPanel.currentPanel && isGCodeFile(document)) updateProgramList();
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
