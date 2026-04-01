import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class ToolpathVisualizerPanel {
  public static currentPanel: ToolpathVisualizerPanel | undefined;
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
        localResourceRoots: [extensionUri]
      }
    );
    ToolpathVisualizerPanel.currentPanel = new ToolpathVisualizerPanel(panel, extensionUri);
  }

  public postMessage(msg: unknown) {
    this._panel.webview.postMessage(msg);
  }

  private constructor(panel: vscode.WebviewPanel, _extensionUri: vscode.Uri) {
    this._panel = panel;
    this._panel.webview.html = this._getHtmlForWebview();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from webview (playback commands)
    this._panel.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'toolData' || msg.type === 'stockOrigin' || msg.type === 'layerToggle') {
        // Forward sidebar messages to visualizer webview
        this._panel.webview.postMessage(msg);
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

  private _getHtmlForWebview(): string {
    // Load HTML from external file for maintainability and to avoid size limits
    const htmlPath = path.join(__dirname, 'toolpathVisualizerWebview.html');
    try {
      return fs.readFileSync(htmlPath, 'utf8');
    } catch (err) {
      return `<html><body><h2>Error loading Visualizer UI</h2><pre>${err}</pre></body></html>`;
    }
  }
}
