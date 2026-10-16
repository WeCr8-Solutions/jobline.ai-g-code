import * as vscode from 'vscode';
import * as fs from 'fs';

const VISUALIZER_STATE_MESSAGE_TYPES = new Set([
  'toolData',
  'toolLibrary',
  'stockSettings',
  'stockOrigin',
  'workholdingSettings',
  'layerToggle',
  'machineType',
  'machineCapabilities',
  'programList',
  'targetModel',
  'fusionSetup',
  'review',
  'update',
  'revpackScene',
  'revpackInfo',
  'revpackWorkholding',
  'revpackFindings',
  'sceneRenderMode',
]);

export interface LayerProbeEntry {
  present: boolean;
  visible: boolean;
  meshes: number;
  lines: number;
  wireframeMeshes: number;
  solidMeshes: number;
  /** Lit pixels with ONLY this layer drawn (layer probe only). */
  litAlone: number;
}

export class ToolpathVisualizerPanel {
  public static currentPanel: ToolpathVisualizerPanel | undefined;
  public static renderStatus = { pathPoints: 0, reviewRendered: false };

  /** Last answer to 'requestVisualProbe'. See requestVisualProbe(). */
  public static lastVisualProbe: {
    litPixels: number;
    sampledPixels: number;
    litRatio: number;
    width: number;
    height: number;
    pathPoints: number;
    gnomonLit: number;
    gnomonTotal: number;
    targetLoaded?: boolean;
    targetCount?: number;
    activeTargetRole?: string;
    activeTargetName?: string;
    activeTargetBounds?: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null;
    activeTargetOffset?: { x: number; y: number; z: number } | null;
    stock?: { w: number; d: number; h: number } | null;
    stockOrigin?: { x: number; y: number; z: number };
    fusionSetup?: unknown;
    targetDisplayMode?: string;
    insertCode?: string;
    turningToolVisible?: boolean;
    programOptions?: number;
    playbackSpeed?: number;
    opacity: Record<string, number>;
    orbit: { theta: number; phi: number };
    renderMode?: string;
    revpackId?: string;
    revpackName?: string;
    revpackBadge?: string;
    revpackFindingsRendered?: number;
    revpackFindingsSummary?: { errors: number; warnings: number; infos: number; pass: boolean } | null;
    workholdingShapes?: number;
    sharedKernel?: { packId: string; workholding: number; tools: number; inProcess: boolean; removedVolume: number | null } | null;
    layers?: Record<string, LayerProbeEntry>;
    activeToolNumber?: number | null;
    toolDiameter?: number | null;
    toolVisible?: boolean;
    activeTargetSource?: string;
    activeTargetLoader?: string;
    activeTargetFormat?: string;
    activeTargetPointCount?: number;
    targetStlCrossCheck?: unknown;
    targetHuePixels?: number;
    targetOnly?: boolean;
    compareMode?: boolean;
    comparison?: { onSize: number; remaining: number; gouge: number; maxRemaining: number; maxGouge: number } | null;
    seededBanner?: string;
    fusionPreviewVisible?: boolean;
    fusionReferenceVisible?: boolean;
    /** Per-object layer styles (stock, target, fixture, jaws, zeroPoint, tool, holder, toolpath). */
    objectStylesActive?: boolean;
    objectStyles?: Record<string, { visible: boolean; mode: string; opacity: number }>;
    layerPreset?: string;
    /** Stock as drawn and the part inside it, G-code coordinates. */
    stockBounds?: { min: number[]; max: number[] } | null;
    targetPartBounds?: { min: number[]; max: number[] } | null;
    gripShown?: boolean;
    /** Workholding solids drawn red because an error finding names them. */
    hitSolids?: string[];
    packSetup?: { partZero: string; gripDepth?: number; recommendedGripDepth?: number; vise?: string } | null;
    /** Origin panel: open, pick mode, WCS label, triad / highlight drawn, target bounds as drawn (WORK). */
    placement?: { open: boolean; active: boolean; pickMode: string; label: string; anchor: string; wcsShown: boolean; highlightTriangles: number; hoverShown: boolean; featureKind: string; viewNormal: boolean; targetBounds: { min: number[]; max: number[] } | null; readout: string } | null;
    error?: string;
    at: number;
  } | undefined;

  /** Last answer to 'requestLayerProbe': each layer drawn alone. */
  public static lastLayerProbe: {
    renderMode: string; revpackId: string; layers: Record<string, LayerProbeEntry>;
    /** Each object drawn alone, with its style. */
    objects?: Record<string, { present: boolean; visible?: boolean; mode?: string; opacity?: number; litAlone: number }>;
    error?: string; at: number;
  } | undefined;

  public static async requestLayerProbe(timeoutMs = 8000): Promise<typeof ToolpathVisualizerPanel.lastLayerProbe> {
    const panel = ToolpathVisualizerPanel.currentPanel;
    if (!panel) return undefined;
    const before = ToolpathVisualizerPanel.lastLayerProbe?.at ?? 0;
    panel._panel.webview.postMessage({ type: 'requestLayerProbe' });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const probe = ToolpathVisualizerPanel.lastLayerProbe;
      if (probe && probe.at > before) return probe;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return undefined;
  }

  /**
   * Ask the webview to measure what it actually drew, and wait for the answer.
   *
   * The visual gate used to capture a screenshot of the whole VS Code window
   * and assert only that the PNG was over 10 KB. The editor text alone clears
   * that, so an empty 3D viewport passed. This asks the render loop to read its
   * own drawing buffer instead, which is the only signal that separates a drawn
   * scene from a blank one.
   */
  /** Send a transient (non-replayed) control message to the open panel. */
  public static sendControl(msg: unknown): void {
    ToolpathVisualizerPanel.currentPanel?._panel.webview.postMessage(msg);
  }

  public static async requestVisualProbe(timeoutMs = 5000): Promise<typeof ToolpathVisualizerPanel.lastVisualProbe> {
    const panel = ToolpathVisualizerPanel.currentPanel;
    if (!panel) return undefined;
    const before = ToolpathVisualizerPanel.lastVisualProbe?.at ?? 0;
    // Deliberately not postMessage(): that caches by type for replay on reopen,
    // and a probe request is transient, not state.
    panel._panel.webview.postMessage({ type: 'requestVisualProbe' });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const probe = ToolpathVisualizerPanel.lastVisualProbe;
      if (probe && probe.at > before) return probe;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return undefined;
  }
  private static readonly _stateMessages = new Map<string, unknown>();
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  public static readonly viewType = 'jobline.toolpathVisualizer';

  public static show(extensionUri: vscode.Uri, column: vscode.ViewColumn = vscode.ViewColumn.Beside) {
    if (ToolpathVisualizerPanel.currentPanel) {
      ToolpathVisualizerPanel.currentPanel._panel.reveal(column, true); // preserveFocus=true
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      ToolpathVisualizerPanel.viewType,
      'G-Code Toolpath Visualizer',
      { viewColumn: column, preserveFocus: true },
      {
        enableScripts: true,
        // Allow the webview to load files from both the extension root and
        // the media/ subfolder where Three.js is bundled locally.
        localResourceRoots: [
          extensionUri,
          vscode.Uri.joinPath(extensionUri, 'media'),
        ]
      }
    );
    ToolpathVisualizerPanel.renderStatus = { pathPoints: 0, reviewRendered: false };
    ToolpathVisualizerPanel.currentPanel = new ToolpathVisualizerPanel(panel, extensionUri);
  }

  public static queueMessage(msg: unknown) {
    const typed = msg as { type?: string } | undefined;
    if (typed?.type) {
      const replayKey = typed.type === 'targetModel' && typeof (typed as { id?: unknown }).id === 'string'
        ? `${typed.type}:${(typed as { id: string }).id}`
        : typed.type;
      ToolpathVisualizerPanel._stateMessages.set(replayKey, msg);
    }
    ToolpathVisualizerPanel.currentPanel?.postMessage(msg);
  }

  /** Drop a replayed state message, e.g. a previous program's RevPack target. */
  public static forgetMessage(key: string): void {
    ToolpathVisualizerPanel._stateMessages.delete(key);
  }

  public postMessage(msg: unknown) {
    const typed = msg as { type?: string } | undefined;
    if (typed?.type) {
      const replayKey = typed.type === 'targetModel' && typeof (typed as { id?: unknown }).id === 'string'
        ? `${typed.type}:${(typed as { id: string }).id}`
        : typed.type;
      ToolpathVisualizerPanel._stateMessages.set(replayKey, msg);
    }
    this._panel.webview.postMessage(msg);
  }

  private replayState(): void {
    for (const msg of ToolpathVisualizerPanel._stateMessages.values()) {
      this._panel.webview.postMessage(msg);
    }
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._panel.webview.html = this._getHtmlForWebview(extensionUri);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from webview (playback commands)
    this._panel.webview.onDidReceiveMessage(msg => {
      if (msg?.type === 'webviewReady') {
        this.replayState();
      } else if (msg?.type === 'renderReady') {
        ToolpathVisualizerPanel.renderStatus = {
          pathPoints: Number(msg.pathPoints) || ToolpathVisualizerPanel.renderStatus.pathPoints,
          reviewRendered: Boolean(msg.reviewRendered) || ToolpathVisualizerPanel.renderStatus.reviewRendered,
        };
      } else if (msg?.type === 'visualProbe') {
        // Answer from the webview's render loop: how many sampled pixels differ
        // from the clear colour. The visual test bed asserts on this, because a
        // screenshot of the workbench is a large valid PNG even when the 3D
        // viewport drew nothing.
        ToolpathVisualizerPanel.lastVisualProbe = {
          litPixels: Number(msg.litPixels) || 0,
          sampledPixels: Number(msg.sampledPixels) || 0,
          litRatio: Number(msg.litRatio) || 0,
          width: Number(msg.width) || 0,
          height: Number(msg.height) || 0,
          pathPoints: Number(msg.pathPoints) || 0,
          gnomonLit: Number(msg.gnomonLit) || 0,
          gnomonTotal: Number(msg.gnomonTotal) || 0,
          targetLoaded: Boolean(msg.targetLoaded),
          targetCount: Number(msg.targetCount) || 0,
          activeTargetRole: typeof msg.activeTargetRole === 'string' ? msg.activeTargetRole : '',
          activeTargetName: typeof msg.activeTargetName === 'string' ? msg.activeTargetName : '',
          activeTargetBounds: msg.activeTargetBounds ?? null,
          activeTargetOffset: msg.activeTargetOffset ?? null,
          stock: msg.stock ?? null,
          stockOrigin: msg.stockOrigin ?? { x: 0, y: 0, z: 0 },
          fusionSetup: msg.fusionSetup ?? null,
          targetDisplayMode: typeof msg.targetDisplayMode === 'string' ? msg.targetDisplayMode : '',
          insertCode: typeof msg.insertCode === 'string' ? msg.insertCode : '',
          turningToolVisible: Boolean(msg.turningToolVisible),
          programOptions: Number(msg.programOptions) || 0,
          playbackSpeed: Number(msg.playbackSpeed) || 0,
          opacity: (msg.opacity ?? {}) as Record<string, number>,
          orbit: (msg.orbit ?? { theta: 0, phi: 0 }) as { theta: number; phi: number },
          renderMode: typeof msg.renderMode === 'string' ? msg.renderMode : '',
          revpackId: typeof msg.revpackId === 'string' ? msg.revpackId : '',
          revpackName: typeof msg.revpackName === 'string' ? msg.revpackName : '',
          revpackBadge: typeof msg.revpackBadge === 'string' ? msg.revpackBadge : '',
          revpackFindingsRendered: Number(msg.revpackFindingsRendered) || 0,
          revpackFindingsSummary: msg.revpackFindingsSummary ?? null,
          workholdingShapes: Number(msg.workholdingShapes) || 0,
          sharedKernel: msg.sharedKernel ?? null,
          layers: msg.layers ?? {},
          activeToolNumber: Number(msg.activeToolNumber) || null,
          toolDiameter: Number(msg.toolDiameter) || null,
          toolVisible: Boolean(msg.toolVisible),
          // Target / RevPack view state the visual gate asserts on (STEP loader,
          // STL cross-check, gold pixels, Target only, Compare, seeded banner).
          activeTargetSource: typeof msg.activeTargetSource === 'string' ? msg.activeTargetSource : '',
          activeTargetLoader: typeof msg.activeTargetLoader === 'string' ? msg.activeTargetLoader : '',
          activeTargetFormat: typeof msg.activeTargetFormat === 'string' ? msg.activeTargetFormat : '',
          activeTargetPointCount: Number(msg.activeTargetPointCount) || 0,
          targetStlCrossCheck: msg.targetStlCrossCheck ?? null,
          targetHuePixels: Number(msg.targetHuePixels) || 0,
          targetOnly: Boolean(msg.targetOnly),
          compareMode: Boolean(msg.compareMode),
          comparison: msg.comparison ?? null,
          seededBanner: typeof msg.seededBanner === 'string' ? msg.seededBanner : '',
          fusionPreviewVisible: Boolean(msg.fusionPreviewVisible),
          fusionReferenceVisible: Boolean(msg.fusionReferenceVisible),
          objectStylesActive: Boolean(msg.objectStylesActive),
          objectStyles: msg.objectStyles ?? undefined,
          layerPreset: typeof msg.layerPreset === 'string' ? msg.layerPreset : '',
          stockBounds: msg.stockBounds ?? null,
          targetPartBounds: msg.targetPartBounds ?? null,
          gripShown: Boolean(msg.gripShown),
          hitSolids: Array.isArray(msg.hitSolids) ? msg.hitSolids.map(String) : [],
          packSetup: msg.packSetup ?? null,
          placement: msg.placement ?? null,
          error: typeof msg.error === 'string' ? msg.error : undefined,
          at: Date.now(),
        };
      } else if (msg?.type === 'layerProbe') {
        ToolpathVisualizerPanel.lastLayerProbe = {
          renderMode: String(msg.renderMode || ''),
          revpackId: String(msg.revpackId || ''),
          layers: msg.layers ?? {},
          objects: msg.objects ?? undefined,
          error: typeof msg.error === 'string' ? msg.error : undefined,
          at: Date.now(),
        };
      } else if (typeof msg?.type === 'string' && VISUALIZER_STATE_MESSAGE_TYPES.has(msg.type)) {
        // Forward sidebar messages to visualizer webview
        this.postMessage(msg);
      } else if (msg.command) {
        // Pass the webview command payload through. Playback buttons send
        // `speed`; review/finding clicks send `arg` (usually a source line).
        vscode.commands.executeCommand(msg.command, msg.arg ?? msg.speed);
      }
    });
  }

  public dispose() {
    ToolpathVisualizerPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }

  private _getHtmlForWebview(extensionUri: vscode.Uri): string {
    // Resolve Three.js to a webview-safe URI from the bundled media/ folder.
    // This means the visualizer works fully offline — no CDN required.
    const threeUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'three.min.js')
    );

    // Load the HTML template from media/ (bundled in the VSIX) and inject the
    // webview-safe Three.js URI in place of the {{THREE_JS_URI}} placeholder.
    const htmlPath = vscode.Uri.joinPath(extensionUri, 'media', 'toolpathVisualizerWebview.html').fsPath;
    try {
      const html = fs.readFileSync(htmlPath, 'utf8');
      return html
        .split('{{CSP_SOURCE}}').join(this._panel.webview.cspSource)
        .split('{{THREE_JS_URI}}').join(threeUri.toString());
    } catch (err) {
      return `<html><body><h2>Error loading Visualizer UI</h2><pre>${err}</pre></body></html>`;
    }
  }
}
