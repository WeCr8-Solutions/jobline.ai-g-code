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
import * as path from 'path';
import { loadConfig } from './config';
import { getHoverMarkdown } from './providers/hoverProvider';
import { registerSidebarTreeProviders, registerToolsCommands, getLastGCodeDoc } from './providers/sidebarTreeProviders';
import { registerCommandsTree } from './providers/commandsTreeProvider';
import { registerVisualizerSettings } from './providers/visualizerSettingsProvider';
import { isGCodeFile } from './utils/fileTypes';
import { selectPreferredGCodeDocument } from './utils/gcodeDocumentTracker';
import { openExplanationPanel } from './providers/explanationProvider';
import { ToolboxViewProvider, registerToolboxCommands } from './providers/toolboxProvider';
import { registerDiagnosticsProvider, runDiagnostics } from './providers/diagnosticsProvider';
import { RatingState, recordRatingChoice, recordSuccessfulValidation } from './validationRating';
import { registerFormatter } from './providers/formatterProvider';
import { registerSubprogramProvider } from './providers/subprogramProvider';
import { buildVisualizerHarnessData } from './providers/visualizer/fixtureHarness';
import { resolveControl, resolveControlType } from './utils/controlResolve';
import { buildAutoSimulationMessages } from './providers/visualizer/simulationSetup';
import { buildRevPackScene, clearRevPackMessages, findRevPackForProgram, readPartOnlyJbl, readRevPack, revPackStepTargetMessage, type LoadedRevPack } from './providers/visualizer/revpackLoader';
import { isSeededTestPack, SEEDED_TEST_PACK_LABEL } from './providers/visualizer/revpack';
import type { CorrelationFinding } from './providers/visualizer/revpackCorrelation';
import { PlacementSessions, parseOffsetInput, placedUploadMessage, placementPanelMessage, type PlacementPanelMessage, type PlacementTarget } from './providers/visualizer/revpackPlacementHost';
import { BOX_POINTS, PLACEMENT_PRESETS, type PlacementOp } from './providers/visualizer/revpackPlacement';
import type { ToolpathPoint } from './providers/visualizer/toolpathParser';
import { reviewGCodeProgram } from './providers/visualizer/programReview';
import { loadStlMesh } from './providers/visualizer/stlMeshLoader';
import { parseSTEP } from './providers/visualizer/stepParser';
import { tessellateSTEP } from './providers/visualizer/stepTessellator';
import { parseParasolidText } from './providers/visualizer/parasolidTextParser';
import { extractFusionPreview, parseFusionSetupArchive } from './providers/visualizer/fusionArchiveParser';
import type { Bounds3D } from './providers/visualizer/gcodeGoalComparison';
import { MachinePresetStore } from './presets/presetStore';
import { registerPresetCommands } from './presets/presetCommands';
import { registerMachineSetupTree } from './providers/machineSetupTreeProvider';
import { machineClassForKind } from './presets/jblMachine';
import { ToolLibraryStore, setToolLibraryStore } from './tooling/toolLibraryStore';
import { registerCamCommands } from './cam/camCommands';
import { CONTROL_PROFILES } from './diagnostics/controlRules';

const LANGUAGE_ID = 'gcode';

export function activate(context: vscode.ExtensionContext): void {
        // Tool library / linked setup sheets: the sidebar and diagnostics read
        // these, so the store exists before either registers.
        const toolLibraryStore = new ToolLibraryStore(context.workspaceState);
        setToolLibraryStore(toolLibraryStore);
        context.subscriptions.push(toolLibraryStore, { dispose: () => setToolLibraryStore(undefined) });
        registerCamCommands(context, toolLibraryStore);

        // Machine presets come first: the sidebar, status bar and visualizer all
        // read the active machine from here.
        const presetStore = new MachinePresetStore();
        context.subscriptions.push(presetStore);
        registerPresetCommands(context, presetStore);
        registerMachineSetupTree(context, presetStore);
        void presetStore.reload();

        // RevPack state: packs the user pinned with "Load RevPack…", the pack
        // each open program is currently drawn from, and its correlation
        // findings in the Problems panel.
        const pinnedRevPacks = new Map<string, string>();
        const activeRevPacks = new Map<string, string>();
        // Part placement / work origin (Origin panel + jobline.placement.*):
        // one session per RevPack target or uploaded part, all maths in the
        // shared kernel (revpackPlacement.ts).
        const placementSessions = new PlacementSessions();
        /** Uploaded target parts (no pack): their message as imported, PART coordinates. */
        const uploadTargets = new Map<string, { message: { meshVertices?: number[]; bounds: Bounds3D } & Record<string, unknown>; positions: Float32Array }>();
        /** STEP targets' tessellations, PART coordinates, per pack (picks use the triangles on screen). */
        const stepPartPositions = new Map<string, Float32Array>();
        let placementExtra: { feature?: PlacementPanelMessage['feature']; error?: string; view?: 'normal' } = {};
        const revpackDiagnostics = vscode.languages.createDiagnosticCollection('jobline-revpack');
        context.subscriptions.push(revpackDiagnostics);
        context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(closed => revpackDiagnostics.delete(closed.uri)));

        /** What the active preset says about the machine, for the simulation. */
        function presetSimulationOverrides(): { workholding?: string; machineType?: string } {
          const preset = presetStore.active()?.preset;
          return preset ? { workholding: preset.workholding, machineType: preset.machineKind } : {};
        }

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
            sendSimulationSetup(doc);
            return true;
          } catch (err) {
            vscode.window.showWarningMessage('JobLine: Unable to auto-load stock/tool setup: ' + String(err));
            return false;
          }
        }

        /**
         * The pack for a program: one the user picked with "Load RevPack…"
         * wins, then a revpack.json beside the program (or in a parent
         * revpack/ folder). Undefined means "guess the setup from the program".
         */
        function revPackForDocument(doc: vscode.TextDocument): LoadedRevPack | undefined {
          if (doc.uri.scheme !== 'file') return undefined;
          const key = doc.uri.toString();
          const pinned = pinnedRevPacks.get(key);
          if (pinned) {
            try { return readRevPack(pinned); } catch (err) {
              pinnedRevPacks.delete(key);
              vscode.window.showWarningMessage('JobLine: RevPack could not be re-read: ' + String(err));
            }
          }
          if (!vscode.workspace.getConfiguration('jobline').get<boolean>('revpack.autoDetect', true)) return undefined;
          const folder = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;
          return findRevPackForProgram(doc.uri.fsPath, folder);
        }

        function publishRevPackDiagnostics(doc: vscode.TextDocument, findings: CorrelationFinding[], packName: string, seeded = false): void {
          const diagnostics = findings.map(finding => {
            const line = Math.max(0, Math.min(doc.lineCount - 1, finding.line - 1));
            const range = doc.lineAt(line).range;
            const severity = finding.severity === 'error' ? vscode.DiagnosticSeverity.Error
              : finding.severity === 'warning' ? vscode.DiagnosticSeverity.Warning
                : vscode.DiagnosticSeverity.Information;
            // A seeded test pack's program is wrong on purpose; say so on every
            // finding so nobody chases them as real problems.
            const label = seeded ? `${SEEDED_TEST_PACK_LABEL} - RevPack: ${packName}` : `RevPack: ${packName}`;
            const diagnostic = new vscode.Diagnostic(range, `${finding.message} [${label}]`, severity);
            diagnostic.source = 'JobLine RevPack';
            diagnostic.code = finding.id;
            return diagnostic;
          });
          revpackDiagnostics.set(doc.uri, diagnostics);
        }

        /** Stock, workholding, tools, machine and review for one program: from its RevPack when it has one. */
        function sendSimulationSetup(doc: vscode.TextDocument): void {
          const text = doc.getText();
          const controlType = resolveControlType(text, doc.uri);
          const harness = buildVisualizerHarnessData(text, controlType);
          const loaded = revPackForDocument(doc);
          if (loaded) {
            const placementKey = `revpack:${loaded.file}`;
            const scene = buildRevPackScene(loaded, text, harness.tools, placementSessions.has(placementKey) ? placementSessions.session(placementKey) : undefined);
            playback.cutterSize = scene.cutterSize;
            updateMachineStatusBar(`${loaded.pack.machine.name} (RevPack)`);
            // Shared-kernel solids first, so stock/workholding/tool build from them.
            ToolpathVisualizerPanel.queueMessage(scene.sceneMessage);
            for (const message of scene.setup) ToolpathVisualizerPanel.queueMessage(message);
            if (scene.target) ToolpathVisualizerPanel.queueMessage(scene.target);
            ToolpathVisualizerPanel.queueMessage(scene.findings);
            publishRevPackDiagnostics(doc, scene.report.findings, loaded.pack.name || loaded.pack.id, isSeededTestPack(loaded.pack));
            activeRevPacks.set(doc.uri.toString(), loaded.file);
            // A STEP target replaces the STL one once OpenCascade has
            // tessellated it (same id), unless the program moved on meanwhile.
            // Picks land on the triangles on screen: the STEP tessellation once it has arrived.
            const stepPositions = stepPartPositions.get(placementKey);
            placementSessions.current = scene.placementTarget && stepPositions ? { ...scene.placementTarget, positions: stepPositions } : scene.placementTarget;
            sendPlacementPanel();
            if (loaded.pack.target?.format === 'step') {
              const key = doc.uri.toString();
              revPackStepTargetMessage(loaded, scene.targetTransform).then(message => {
                if (message && activeRevPacks.get(key) === loaded.file) {
                  ToolpathVisualizerPanel.queueMessage(message);
                  // Picks now land on the STEP tessellation's triangles.
                  const current = placementSessions.current;
                  const positions = stepPartPositions.get(placementKey) ?? new Float32Array(message.partMeshVertices ?? message.meshVertices);
                  stepPartPositions.set(placementKey, positions);
                  if (current?.key === placementKey && current.positions !== positions) {
                    placementSessions.current = { ...current, positions };
                    sendPlacementPanel();
                  }
                }
              }, err => {
                console.warn('JobLine RevPack: STEP target could not be read, keeping its STL:', err);
              });
            }
          } else {
            playback.cutterSize = harness.tools[0]?.diameter || (harness.unit === 'mm' ? 6 : 0.25);
            updateMachineStatusBar(harness.setup.machineType);
            const overrides = presetSimulationOverrides();
            // A previous program's pack must not leave its target, fixture or
            // badge behind. User-imported targets are left alone.
            ToolpathVisualizerPanel.forgetMessage('targetModel:revpack-target');
            ToolpathVisualizerPanel.sendControl({ type: 'removeTargetModel', id: 'revpack-target' });
            for (const message of clearRevPackMessages()) ToolpathVisualizerPanel.queueMessage(message);
            for (const message of buildAutoSimulationMessages(harness, overrides.workholding, overrides.machineType)) {
              ToolpathVisualizerPanel.queueMessage(message);
            }
            revpackDiagnostics.delete(doc.uri);
            activeRevPacks.delete(doc.uri.toString());
            if (placementSessions.current?.kind === 'revpack') {
              // Back to the last uploaded part, if one is open.
              const last = [...uploadTargets.entries()].pop();
              placementSessions.current = last ? uploadPlacementTarget(last[0], last[1].message, last[1].positions) : undefined;
            }
            sendPlacementPanel();
          }
          ToolpathVisualizerPanel.queueMessage({ type: 'review', review: reviewGCodeProgram(text, controlType) });
        }

        function sendPlacementPanel(): PlacementPanelMessage {
          const target = placementSessions.current;
          const message = placementPanelMessage(target, target ? placementSessions.session(target.key) : undefined, placementExtra);
          placementExtra = {};
          ToolpathVisualizerPanel.queueMessage(message);
          return message;
        }

        /** An uploaded part, moved by its session (if any), back to the webview. */
        function resendUploadTarget(id: string, upload: { message: { meshVertices?: number[]; bounds: Bounds3D } & Record<string, unknown>; positions: Float32Array }): void {
          const key = `upload:${id}`;
          const message = placementSessions.has(key) ? placedUploadMessage(upload.message, upload.positions, placementSessions.session(key)) : { ...upload.message, placementUpdate: true };
          ToolpathVisualizerPanel.queueMessage(message);
        }

        function registerUploadTarget(id: string, message: { meshVertices?: number[]; bounds: Bounds3D; name?: unknown } & Record<string, unknown>): void {
          if (!message.meshVertices || message.meshVertices.length < 9) return;
          const positions = new Float32Array(message.meshVertices);
          uploadTargets.set(id, { message, positions });
          // A new upload starts from its file origin.
          placementSessions.clear(`upload:${id}`);
          if (placementSessions.current?.kind !== 'revpack') {
            placementSessions.current = uploadPlacementTarget(id, message, positions);
            sendPlacementPanel();
          }
        }

        function uploadPlacementTarget(id: string, message: { bounds: Bounds3D; name?: unknown }, positions: Float32Array): PlacementTarget {
          const b = message.bounds;
          return {
            key: `upload:${id}`, kind: 'upload', name: String(message.name ?? id), units: playback.units,
            positions, bounds: { min: [b.minX, b.minY, b.minZ], max: [b.maxX, b.maxY, b.maxZ] },
          };
        }

        /**
         * Run one Origin / WCS operation on the current target (RevPack
         * target or uploaded part) and redraw. Returns the panel state, so
         * tests and the webview see the same answer.
         */
        async function runPlacement(arg: (PlacementOp & { view?: 'normal' }) | undefined): Promise<PlacementPanelMessage | undefined> {
          const target: PlacementTarget | undefined = placementSessions.current;
          if (!arg || typeof arg !== 'object' || !('op' in arg)) return undefined;
          if (!target) {
            vscode.window.showWarningMessage('JobLine: open a program with a RevPack, or import a target part, before setting the work origin.');
            return undefined;
          }
          const { view, ...op } = arg;
          const result = placementSessions.run(target, op as PlacementOp);
          placementExtra = { feature: result.feature, error: result.error, view };
          if (result.error) vscode.window.setStatusBarMessage(`JobLine Origin: ${result.error}`, 4000);
          if (!result.changed) return sendPlacementPanel();
          if (target.kind === 'revpack') {
            const doc = getPreferredGCodeDoc();
            if (doc) sendSimulationSetup(doc);
            else sendPlacementPanel();
          } else {
            const id = target.key.slice('upload:'.length);
            const upload = uploadTargets.get(id);
            if (upload) resendUploadTarget(id, upload);
            sendPlacementPanel();
          }
          return placementPanelMessage(target, placementSessions.session(target.key), { feature: result.feature, error: result.error });
        }

        context.subscriptions.push(
          vscode.commands.registerCommand('jobline.placement.run', (arg?: PlacementOp & { view?: 'normal' }) => runPlacement(arg)),
          vscode.commands.registerCommand('jobline.placement.state', () => {
            const target = placementSessions.current;
            return placementPanelMessage(target, target ? placementSessions.session(target.key) : undefined);
          }),
          vscode.commands.registerCommand('jobline.placement.showPanel', async () => {
            if (!ToolpathVisualizerPanel.currentPanel) await vscode.commands.executeCommand('jobline.gcode.showVisualizer');
            ToolpathVisualizerPanel.sendControl({ type: 'showOriginPanel', open: true });
            sendPlacementPanel();
          }),
          vscode.commands.registerCommand('jobline.placement.boxPoint', async () => {
            const ref = await vscode.window.showQuickPick([{ label: 'Part box', ref: 'part' as const }, { label: 'Stock box', ref: 'stock' as const }], { title: 'Work origin on the bounding box of…' });
            if (!ref) return undefined;
            const point = await vscode.window.showQuickPick(BOX_POINTS.map(bp => ({ label: bp.label, description: bp.kind, bp })), { title: 'Work origin at (27 box points)' });
            if (!point) return undefined;
            return runPlacement({ op: 'boxPoint', sel: point.bp.sel, ref: ref.ref });
          }),
          vscode.commands.registerCommand('jobline.placement.preset', async () => {
            const items = PLACEMENT_PRESETS.flatMap(p => [
              { label: `${p.label} of the part`, op: { op: 'preset', id: p.id, ref: 'part' } as PlacementOp },
              { label: `${p.label} of the stock`, op: { op: 'preset', id: p.id, ref: 'stock' } as PlacementOp },
            ]);
            const pick = await vscode.window.showQuickPick(items, { title: 'Part to origin: preset' });
            return pick ? runPlacement(pick.op) : undefined;
          }),
          vscode.commands.registerCommand('jobline.placement.face', async () => {
            const faces = ['top', 'bottom', 'left', 'right', 'front', 'back', 'center'] as const;
            const pick = await vscode.window.showQuickPick(faces.map(face => ({ label: face[0].toUpperCase() + face.slice(1), face })), { title: 'Move one axis to a face of the part box (Top = Z0 on the top face)' });
            return pick ? runPlacement({ op: 'face', face: pick.face }) : undefined;
          }),
          vscode.commands.registerCommand('jobline.placement.rotate', async () => {
            const items: Array<{ label: string; op: PlacementOp }> = [];
            for (const [axis, name] of [[0, 'X'], [1, 'Y'], [2, 'Z']] as const) {
              items.push({ label: `Rotate +90° about ${name}`, op: { op: 'rotate', axis, turns: 1 } });
              items.push({ label: `Rotate -90° about ${name}`, op: { op: 'rotate', axis, turns: -1 } });
            }
            items.push({ label: 'Flip (180° about X, op 2)', op: { op: 'flip', axis: 0 } }, { label: 'Flip (180° about Y)', op: { op: 'flip', axis: 1 } });
            items.push({ label: 'Align part +X to Z', op: { op: 'alignAxis', from: '+X', to: '+Z' } }, { label: 'Align part +Y to Z', op: { op: 'alignAxis', from: '+Y', to: '+Z' } });
            const pick = await vscode.window.showQuickPick(items, { title: 'Re-orient the part about the work origin' });
            return pick ? runPlacement(pick.op) : undefined;
          }),
          vscode.commands.registerCommand('jobline.placement.offset', async () => {
            const text = await vscode.window.showInputBox({ title: 'Shift the work origin', prompt: 'dX dY dZ [rotate about Z, degrees] in program units, e.g. "0.5 0 -0.02 90"', validateInput: v => parseOffsetInput(v) ? undefined : 'Enter 1 to 4 numbers' });
            const parsed = text ? parseOffsetInput(text) : undefined;
            return parsed ? runPlacement({ op: 'offset', d: parsed.d, rotZ: parsed.rotZ }) : undefined;
          }),
          vscode.commands.registerCommand('jobline.placement.centerInStock', () => runPlacement({ op: 'centerInStock', axes: 'xy' })),
          vscode.commands.registerCommand('jobline.placement.pick', async () => {
            const modes = [
              { label: 'Face: set axis to face', mode: 'face-axis' }, { label: 'Face: origin at face centre', mode: 'face-origin' },
              { label: 'Face: align to top', mode: 'face-top' }, { label: 'Face: align to bottom', mode: 'face-bottom' },
              { label: 'Bore / boss: centre on axis', mode: 'bore' }, { label: 'Bore / boss: centre and turn axis to Z', mode: 'bore-z' },
              { label: 'Vertex / edge point', mode: 'point' }, { label: 'Two-point midpoint', mode: 'mid2' },
              { label: 'Three-point circle centre', mode: 'circle3' }, { label: 'View normal to a face', mode: 'view-normal' },
            ];
            const pick = await vscode.window.showQuickPick(modes, { title: 'Pick on the part in the 3D view' });
            if (!pick) return;
            if (!ToolpathVisualizerPanel.currentPanel) await vscode.commands.executeCommand('jobline.gcode.showVisualizer');
            ToolpathVisualizerPanel.sendControl({ type: 'showOriginPanel', open: true, pickMode: pick.mode });
          }),
          vscode.commands.registerCommand('jobline.placement.undo', () => runPlacement({ op: 'undo' })),
          vscode.commands.registerCommand('jobline.placement.reset', () => runPlacement({ op: 'reset' })),
        );

        const loadRevPackCmd = vscode.commands.registerCommand('jobline.revpack.load', async (arg?: vscode.Uri | string) => {
          const doc = getPreferredGCodeDoc();
          if (!doc) {
            vscode.window.showWarningMessage('JobLine: open a G-code program first, then load its RevPack.');
            return undefined;
          }
          let file: string | undefined = typeof arg === 'string' ? arg : arg instanceof vscode.Uri ? arg.fsPath : undefined;
          if (!file) {
            const picked = await vscode.window.showOpenDialog({
              canSelectMany: false,
              openLabel: 'Load RevPack',
              defaultUri: vscode.Uri.file(path.dirname(doc.uri.fsPath)),
              filters: { 'RevPack or JobLine job': ['json', 'jbl'] },
            });
            file = picked?.[0]?.fsPath;
          }
          if (!file) return undefined;
          // A part-only .jbl (Setup / WCS made in CAM on an uploaded part, no
          // RevPack) opens as an uploaded part with CAM's origin applied.
          if (file.toLowerCase().endsWith('.jbl')) {
            try {
              const part = readPartOnlyJbl(file);
              if (part) {
                if (!ToolpathVisualizerPanel.currentPanel) await vscode.commands.executeCommand('jobline.gcode.showVisualizer');
                const mesh = loadStlMesh(part.targetStl.slice().buffer);
                const id = 'jbl-part';
                const targetMessage = {
                  type: 'targetModel', id, targetId: id, role: 'target-part', displayMode: 'transparent', opacity: 0.35,
                  name: part.name, format: `JobLine job (.jbl) · STL ${mesh.format}`, pointCount: mesh.triangleCount * 3,
                  meshVertices: Array.from(mesh.positions), bounds: mesh.bounds, offset: { x: 0, y: 0, z: 0 },
                };
                registerUploadTarget(id, targetMessage);
                placementSessions.seed(`upload:${id}`, part.placement);
                const upload = uploadTargets.get(id);
                if (upload) resendUploadTarget(id, upload);
                else ToolpathVisualizerPanel.queueMessage(targetMessage);
                sendPlacementPanel();
                vscode.window.setStatusBarMessage(`JobLine: part "${part.name}" opened with its CAM setup`, 5000);
                return id;
              }
            } catch (err) {
              vscode.window.showErrorMessage('JobLine: ' + String(err instanceof Error ? err.message : err));
              return undefined;
            }
          }
          let loaded: LoadedRevPack;
          try {
            loaded = readRevPack(file);
          } catch (err) {
            vscode.window.showErrorMessage('JobLine: ' + String(err instanceof Error ? err.message : err));
            return undefined;
          }
          pinnedRevPacks.set(doc.uri.toString(), loaded.file);
          // A .jbl from jobline.ai-CAM carries its Setup / WCS: start the Origin panel there.
          if (loaded.placement) placementSessions.seed(`revpack:${loaded.file}`, loaded.placement);
          if (!ToolpathVisualizerPanel.currentPanel) {
            await vscode.commands.executeCommand('jobline.gcode.showVisualizer');
          } else {
            refreshVisualizerForDocument(doc, true);
          }
          vscode.window.setStatusBarMessage(`JobLine: RevPack "${loaded.pack.name}" loaded for ${path.basename(doc.uri.fsPath)}`, 5000);
          return loaded.pack.id;
        });
        context.subscriptions.push(loadRevPackCmd);

        const clearRevPackCmd = vscode.commands.registerCommand('jobline.revpack.clear', () => {
          const doc = getPreferredGCodeDoc();
          if (!doc) return;
          pinnedRevPacks.delete(doc.uri.toString());
          revpackDiagnostics.delete(doc.uri);
          refreshVisualizerForDocument(doc, false);
        });
        context.subscriptions.push(clearRevPackCmd);

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
                const tessellated = await tessellateSTEP(bytes);
                bounds = tessellated.bounds;
                format = parsed.schema ? `STEP ${parsed.schema} mesh` : 'STEP mesh';
                pointCount = tessellated.triangleCount * 3;
                meshVertices = tessellated.meshVertices;
              } else {
                const text = Buffer.from(bytes).toString('utf8');
                const parsed = parseParasolidText(text);
                bounds = parsed.bounds;
                format = 'Parasolid text';
                pointCount = parsed.pointCount;
              }
              const targetMessage = {
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
              };
              ToolpathVisualizerPanel.queueMessage(targetMessage);
              // A part opened on its own can be placed with the Origin panel.
              if (role === 'target-part') registerUploadTarget(targetMessage.id, targetMessage);
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
  registerVisualizerSettings(context, presetStore);

  // Register tools tree commands (Add / Go-To / Remove tool change)
  registerToolsCommands(context);

  // Register diagnostic squiggles provider
  const diagnosticCollection = registerDiagnosticsProvider(context);

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
      const cnc = (id: keyof typeof CONTROL_PROFILES, label: string, description: string) =>
        ({ label: `$(circuit-board) ${label}`, description, detail: CONTROL_PROFILES[id].summary, id });
      const controls = [
        cnc('fanuc', 'Fanuc CNC', '0i / 30i / 31i series'),
        cnc('haas', 'Haas', 'NGC controls'),
        cnc('siemens', 'Siemens', 'Sinumerik 840D / 828D'),
        cnc('mazak', 'Mazak', 'Smooth / Matrix EIA/ISO'),
        cnc('okuma', 'Okuma', 'OSP-P controls'),
        cnc('mitsubishi', 'Mitsubishi', 'M8 / M80 (Meldas)'),
        cnc('heidenhain', 'Heidenhain', 'TNC Klartext and ISO'),
        cnc('fadal', 'Fadal', 'Format 2'),
        cnc('generic', 'Generic / LinuxCNC', 'ISO G-code, LinuxCNC O-words'),
        { label: '$(robot) Fanuc Robot',           description: 'TP / LS teach-pendant programs',  id: 'fanuc-robot' },
        { label: '$(robot) ABB RAPID',             description: 'ABB robot RAPID .mod programs',   id: 'abb' },
      ];

      const selected = await vscode.window.showQuickPick(controls, {
        placeHolder: 'Select CNC control type — each has its own validation rules',
        matchOnDetail: true,
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

  // Explicitly re-run the same engine used by live diagnostics.
  const validateCmd = vscode.commands.registerCommand(
    'jobline.validateProgram',
    async () => {
      const document = getPreferredGCodeDoc();
      if (!document) {
        vscode.window.showWarningMessage('Open a G-code program to validate.');
        return;
      }
      const diagnostics = runDiagnostics(document, diagnosticCollection);
      if (!diagnostics) {
        vscode.window.showErrorMessage('JobLine: Could not parse this program for validation.');
        return;
      }
      const errors = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
      const warnings = diagnostics.length - errors;
      void vscode.commands.executeCommand('workbench.actions.view.problems');
      void vscode.window.showInformationMessage(`JobLine: Validation complete — ${errors} error(s), ${warnings} warning(s).`);
      if (errors > 0) return;
      const key = 'jobline.rating.v1';
      const result = recordSuccessfulValidation(context.globalState.get<RatingState>(key));
      await context.globalState.update(key, result.state);
      if (!result.prompt) return;
      const choice = await vscode.window.showInformationMessage(
        'JobLine helped validate your programs. Would you rate the extension?',
        'Rate', 'Later', 'Never'
      );
      await context.globalState.update(key, recordRatingChoice(result.state, choice));
      if (choice === 'Rate') {
        await vscode.env.openExternal(vscode.Uri.parse('https://marketplace.visualstudio.com/items?itemName=WeCr8-Solutions.jobline-gcode&ssr=false#review-details'));
      }
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
        'Multi-Axis Mill-Turn (B-Axis, Sub-Spindle)',
        'Turn/Mill (Y-Axis)',
        'Swiss',
        'Multi-Spindle Transfer',
        'Grinding Center',
        'CNC Laser Cutting System (2D Flatbed)',
        'CNC Laser Cutting System (Tube)',
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
        const cfg = vscode.workspace.getConfiguration('jobline', activeFolder?.uri);
        await cfg.update('detectedMachineType', selected, cfgTarget);
        // Keep the broad profile (cycle lists, lathe T-word decoding) in step with the pick.
        await cfg.update('machineType', machineClassForKind(selected), cfgTarget);
        updateMachineStatusBar();
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
  /** Show the control the active program is checked as (header auto-detect included). */
  const refreshControlStatus = (): void => {
    const doc = vscode.window.activeTextEditor?.document;
    const resolved = doc && isGCodeFile(doc)
      ? resolveControl(doc.getText(), doc.uri)
      : { controlType: vscode.workspace.getConfiguration().get<string>('jobline.controlType', config.controlType), detected: false };
    updateStatusBar(controlStatusBar, resolved.controlType, resolved.detected);
  };
  refreshControlStatus();
  controlStatusBar.show();
  context.subscriptions.push(controlStatusBar);
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => refreshControlStatus()));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(doc => {
    if (doc === vscode.window.activeTextEditor?.document) refreshControlStatus();
  }));

  // Machine type status bar
  const machineStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99
  );
  machineStatusBar.command = 'jobline.presets.switch';
  let lastDetectedMachineType: string | undefined;

  /** Active preset name when there is one; otherwise the machine type in use. */
  function updateMachineStatusBar(detectedMachineType?: string): void {
    if (detectedMachineType !== undefined) lastDetectedMachineType = detectedMachineType;
    const active = presetStore.active()?.preset;
    const detectedNote = lastDetectedMachineType ? `\nProgram looks like: ${lastDetectedMachineType}` : '';
    if (active) {
      machineStatusBar.text = `$(server-process) ${active.name}`;
      machineStatusBar.tooltip = `JobLine machine: ${active.name} (${active.machineKind})${detectedNote}\nClick to switch machine preset`;
    } else {
      const configured = vscode.workspace.getConfiguration('jobline').get<string>('detectedMachineType', '');
      machineStatusBar.text = `$(vm) ${configured || lastDetectedMachineType || '3-Axis Vertical Mill'}`;
      machineStatusBar.tooltip = `No machine preset chosen${detectedNote}\nClick to pick or create one so it is remembered`;
    }
  }
  updateMachineStatusBar();
  machineStatusBar.show();
  context.subscriptions.push(machineStatusBar);

  context.subscriptions.push(presetStore.onDidChange(() => {
    updateMachineStatusBar();
    const doc = getPreferredGCodeDoc();
    if (doc) refreshVisualizerForDocument(doc, false);
  }));

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
        loadConfig((key: string) => vscode.workspace.getConfiguration().get(key));
        refreshControlStatus();
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
          // Same path as opening the program, so an edit re-runs the RevPack
          // correlation and the diagnostics follow the text.
          sendSimulationSetup(e.document);
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

function updateStatusBar(item: vscode.StatusBarItem, controlType: string, detected = false): void {
  const labels: Record<string, string> = {
    fanuc: 'Fanuc CNC',
    haas: 'Haas',
    siemens: 'Siemens',
    mazak: 'Mazak',
    okuma: 'Okuma',
    mitsubishi: 'Mitsubishi',
    heidenhain: 'Heidenhain',
    fadal: 'Fadal',
    generic: 'Generic',
    'fanuc-robot': 'Fanuc Robot',
    abb: 'ABB RAPID',
  };
  const icon = (controlType === 'fanuc-robot' || controlType === 'abb') ? '$(robot)' : '$(tools)';
  item.text = `${icon} [${labels[controlType] ?? controlType}${detected ? ' · from header' : ''}]`;
  item.tooltip = detected
    ? 'JobLine: control detected from the program header (jobline.controlAutoDetect). Click to set the control for this workspace.'
    : 'JobLine: Click to change CNC / robot control type';
}
