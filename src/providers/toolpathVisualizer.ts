import * as vscode from 'vscode';
import * as fs from 'fs';

const VISUALIZER_STATE_MESSAGE_TYPES = new Set([
  'toolData',
  'stockSettings',
  'stockOrigin',
  'layerToggle',
  'machineType',
  'machineCapabilities',
  'review',
  'update',
]);

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
    error?: string;
    at: number;
  } | undefined;

  /**
   * Ask the webview to measure what it actually drew, and wait for the answer.
   *
   * The visual gate used to capture a screenshot of the whole VS Code window
   * and assert only that the PNG was over 10 KB. The editor text alone clears
   * that, so an empty 3D viewport passed. This asks the render loop to read its
   * own drawing buffer instead, which is the only signal that separates a drawn
   * scene from a blank one.
   */
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

  public static show(extensionUri: vscode.Uri) {
    const column = vscode.ViewColumn.Beside;
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
      ToolpathVisualizerPanel._stateMessages.set(typed.type, msg);
    }
    ToolpathVisualizerPanel.currentPanel?.postMessage(msg);
  }

  public postMessage(msg: unknown) {
    const typed = msg as { type?: string } | undefined;
    if (typed?.type) {
      ToolpathVisualizerPanel._stateMessages.set(typed.type, msg);
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
          error: typeof msg.error === 'string' ? msg.error : undefined,
          at: Date.now(),
        };
      } else if (typeof msg?.type === 'string' && VISUALIZER_STATE_MESSAGE_TYPES.has(msg.type)) {
        // Forward sidebar messages to visualizer webview
        this.postMessage(msg);
      } else if (msg.command) {
        // Pass speed along with command if present
        vscode.commands.executeCommand(msg.command, msg.speed);
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
