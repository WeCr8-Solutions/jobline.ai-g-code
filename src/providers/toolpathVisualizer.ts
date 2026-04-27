import * as vscode from 'vscode';
import * as fs from 'fs';

const VISUALIZER_STATE_MESSAGE_TYPES = new Set([
  'toolData',
  'stockSettings',
  'stockOrigin',
  'layerToggle',
  'machineType',
  'machineCapabilities',
  'update',
]);

export class ToolpathVisualizerPanel {
  public static currentPanel: ToolpathVisualizerPanel | undefined;
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

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._panel.webview.html = this._getHtmlForWebview(extensionUri);
    setTimeout(() => {
      for (const msg of ToolpathVisualizerPanel._stateMessages.values()) {
        this._panel.webview.postMessage(msg);
      }
    }, 150);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from webview (playback commands)
    this._panel.webview.onDidReceiveMessage(msg => {
      if (typeof msg?.type === 'string' && VISUALIZER_STATE_MESSAGE_TYPES.has(msg.type)) {
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
        .replace('{{CSP_SOURCE}}', this._panel.webview.cspSource)
        .replace('{{THREE_JS_URI}}', threeUri.toString());
    } catch (err) {
      return `<html><body><h2>Error loading Visualizer UI</h2><pre>${err}</pre></body></html>`;
    }
  }
}
