/**
 * Tool Preview Panel — 3D Tool Geometry Viewer + Editor
 *
 * Two-column webview: left = form, right = 3D Three.js canvas
 * Renders End Mill, Drill, Face Mill, Boring Bar, Lathe Insert
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ToolpathVisualizerPanel } from './toolpathVisualizer';

export interface ToolPreviewData {
  toolNumber?: number;
  type: 'End Mill' | 'Drill' | 'Tap' | 'Face Mill' | 'Boring Bar' | 'Lathe Insert' | 'Custom';
  diameter: number;
  length: number;
  stickOut: number;
  flutes: number;
  holder: 'CAT40' | 'CAT50' | 'BT40' | 'BT50' | 'HSK-A63' | 'R8' | 'None';
  description: string;
  color: string;
}

export class ToolPreviewPanel {
  static instance: vscode.WebviewPanel | null = null;

  static show(context: vscode.ExtensionContext) {
    if (ToolPreviewPanel.instance) {
      ToolPreviewPanel.instance.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'jobline.toolPreview',
      'Tool Preview',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png');
    panel.webview.html = ToolPreviewPanel.getHtml();

    panel.onDidDispose(() => {
      ToolPreviewPanel.instance = null;
    });

    panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'applyTool') {
        // Forward to simulation panel (if open)
        ToolpathVisualizerPanel.currentPanel?.postMessage({
          type: 'toolData',
          data: msg.data
        });
      }
    });

    ToolPreviewPanel.instance = panel;
  }

  private static getHtml(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #1e1e1e;
      color: #e0e0e0;
      display: grid;
      grid-template-columns: 350px 1fr;
      height: 100vh;
      gap: 1px;
      background-color: #333;
    }
    .form-panel {
      background: #252526;
      padding: 16px;
      overflow-y: auto;
      border-right: 1px solid #3e3e42;
    }
    .canvas-panel {
      background: #1a1a1a;
      position: relative;
    }
    canvas { display: block; width: 100%; height: 100%; }
    .form-group {
      margin-bottom: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    label {
      font-size: 12px;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 500;
    }
    input, select {
      background: #3c3c3c;
      border: 1px solid #555;
      color: #e0e0e0;
      padding: 6px 8px;
      font-size: 13px;
      border-radius: 3px;
    }
    input:focus, select:focus {
      outline: none;
      border-color: #0e639c;
      box-shadow: 0 0 0 2px rgba(14, 99, 156, 0.2);
    }
    .button-group {
      display: flex;
      gap: 8px;
      margin-top: 16px;
    }
    button {
      flex: 1;
      background: #0e639c;
      color: #fff;
      border: none;
      padding: 8px;
      font-size: 13px;
      border-radius: 3px;
      cursor: pointer;
      font-weight: 500;
    }
    button:hover { background: #1177bb; }
    button:active { background: #0d47a1; }
    #colorInput {
      width: 100%;
      height: 32px;
      cursor: pointer;
    }
    .heading {
      font-size: 14px;
      font-weight: 600;
      margin-top: 12px;
      margin-bottom: 8px;
      color: #cccccc;
      border-bottom: 1px solid #444;
      padding-bottom: 6px;
    }
  </style>
</head>
<body>
  <div class="form-panel">
    <h2 style="margin-bottom: 16px; font-size: 16px;">Tool Setup</h2>

    <div class="form-group">
      <label>Tool Number (T-word)</label>
      <input type="number" id="toolNumber" placeholder="e.g., 1, 5" min="0" max="9999">
    </div>

    <div class="form-group">
      <label>Tool Type</label>
      <select id="toolType">
        <option>End Mill</option>
        <option>Drill</option>
        <option>Tap</option>
        <option>Face Mill</option>
        <option>Boring Bar</option>
        <option>Lathe Insert</option>
        <option>Custom</option>
      </select>
    </div>

    <div class="form-group">
      <label>Diameter (in)</label>
      <input type="number" id="diameter" step="0.001" min="0" value="0.5">
    </div>

    <div class="form-group">
      <label>Overall Length (in)</label>
      <input type="number" id="length" step="0.01" min="0" value="3.0">
    </div>

    <div class="form-group">
      <label>Stick-out from Holder (in)</label>
      <input type="number" id="stickOut" step="0.01" min="0" value="1.5">
    </div>

    <div class="form-group">
      <label>Flutes Count</label>
      <input type="number" id="flutes" min="1" max="12" value="2">
    </div>

    <div class="heading">Holder</div>

    <div class="form-group">
      <label>Holder Type</label>
      <select id="holder">
        <option>CAT40</option>
        <option>CAT50</option>
        <option>BT40</option>
        <option>BT50</option>
        <option>HSK-A63</option>
        <option>R8</option>
        <option>None</option>
      </select>
    </div>

    <div class="heading">Details</div>

    <div class="form-group">
      <label>Description</label>
      <input type="text" id="description" placeholder="Flute notes, TiN coating, etc.">
    </div>

    <div class="form-group">
      <label>Color</label>
      <input type="color" id="colorInput" value="#ff6600">
    </div>

    <div class="button-group">
      <button onclick="refreshPreview()">🔄 Refresh</button>
      <button onclick="applyToSimulation()">✓ Apply</button>
    </div>
  </div>

  <div class="canvas-panel">
    <canvas id="canvas"></canvas>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // Three.js CDN — must match the version in extension
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r155/three.min.js';
    document.head.appendChild(script);

    script.onload = () => {
      setupScene();
      refreshPreview();
    };

    let scene, camera, renderer;

    function setupScene() {
      const canvas = document.getElementById('canvas');
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a1a1a);

      camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
      camera.position.set(0, 0, 3);

      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setSize(canvas.clientWidth, canvas.clientHeight);
      renderer.setPixelRatio(window.devicePixelRatio);

      // Lights
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
      scene.add(ambientLight);

      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
      directionalLight.position.set(5, 5, 5);
      scene.add(directionalLight);

      // Grid
      const gridHelper = new THREE.GridHelper(5, 10, 0x333333, 0x222222);
      gridHelper.position.z = -2;
      scene.add(gridHelper);

      // Orbit controls (simplified)
      let isDragging = false;
      let previousMousePosition = { x: 0, y: 0 };

      canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        previousMousePosition = { x: e.clientX, y: e.clientY };
      });

      canvas.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const deltaX = e.clientX - previousMousePosition.x;
        const deltaY = e.clientY - previousMousePosition.y;
        previousMousePosition = { x: e.clientX, y: e.clientY };

        camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), deltaX * 0.01);
        camera.position.applyAxisAngle(
          new THREE.Vector3(1, 0, 0),
          deltaY * 0.01
        );
        camera.lookAt(0, 0, 0);
      });

      canvas.addEventListener('mouseup', () => {
        isDragging = false;
      });

      window.addEventListener('resize', () => {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      });

      renderer.render(scene, camera);
    }

    function refreshPreview() {
      // Clear old tool
      scene.children = scene.children.filter(
        (c) => !(c instanceof THREE.Mesh && c.userData.isTool)
      );

      const type = document.getElementById('toolType').value;
      const dia = parseFloat(document.getElementById('diameter').value) || 0.5;
      const len = parseFloat(document.getElementById('length').value) || 3;
      const stick = parseFloat(document.getElementById('stickOut').value) || 1.5;
      const flutes = parseInt(document.getElementById('flutes').value) || 2;
      const color = document.getElementById('colorInput').value;

      const toolGeom = buildToolGeometry(type, dia, len, stick, flutes, color);
      toolGeom.userData.isTool = true;
      scene.add(toolGeom);

      renderer.render(scene, camera);
    }

    function buildToolGeometry(type, dia, len, stick, flutes, color) {
      const group = new THREE.Group();
      const colorNum = parseInt(color.slice(1), 16);
      const holderType = document.getElementById('holder').value;

      // Cutting portion (stick-out)
      if (type === 'End Mill') {
        const cuttingGeom = new THREE.CylinderGeometry(dia / 2, dia / 2, stick, 16);
        const cuttingMesh = new THREE.Mesh(
          cuttingGeom,
          new THREE.MeshPhongMaterial({ color: colorNum })
        );
        cuttingMesh.position.z = stick / 2;
        group.add(cuttingMesh);

        // Flutes (helix lines)
        for (let i = 0; i < flutes; i++) {
          const angle = (i / flutes) * Math.PI * 2;
          const points = [];
          for (let j = 0; j < stick * 20; j++) {
            const z = (j / (stick * 20)) * stick;
            const x = (dia / 2) * Math.cos(angle + z * 2);
            const y = (dia / 2) * Math.sin(angle + z * 2);
            points.push(new THREE.Vector3(x, y, z));
          }
          const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
          const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: 0x333333 }));
          group.add(line);
        }

        // Shank
        const shankRad = dia / 2.5;
        const shankGeom = new THREE.CylinderGeometry(shankRad, shankRad, len - stick, 16);
        const shankMesh = new THREE.Mesh(shankGeom, new THREE.MeshPhongMaterial({ color: 0x888888 }));
        shankMesh.position.z = stick + (len - stick) / 2;
        group.add(shankMesh);
      } else if (type === 'Drill') {
        // Cylinder + cone tip
        const geom = new THREE.CylinderGeometry(dia / 2, dia / 2, stick * 0.9, 16);
        const mesh = new THREE.Mesh(geom, new THREE.MeshPhongMaterial({ color: colorNum }));
        mesh.position.z = (stick * 0.9) / 2;
        group.add(mesh);

        // Tip (cone)
        const tipGeom = new THREE.ConeGeometry(dia / 2, stick * 0.2, 16);
        const tipMesh = new THREE.Mesh(tipGeom, new THREE.MeshPhongMaterial({ color: colorNum }));
        tipMesh.position.z = stick;
        group.add(tipMesh);

        // Flute lines (2)
        for (let i = 0; i < 2; i++) {
          const angle = (i / 2) * Math.PI;
          const points = [];
          for (let j = 0; j < stick * 10; j++) {
            const z = (j / (stick * 10)) * stick;
            const x = (dia / 2) * Math.cos(angle);
            const y = (dia / 2) * Math.sin(angle) * (z / stick);
            points.push(new THREE.Vector3(x, y, z));
          }
          const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
          const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: 0x333333 }));
          group.add(line);
        }

        // Shank
        const shankRad = dia / 3;
        const shankGeom = new THREE.CylinderGeometry(shankRad, shankRad, len - stick, 16);
        const shankMesh = new THREE.Mesh(shankGeom, new THREE.MeshPhongMaterial({ color: 0x888888 }));
        shankMesh.position.z = stick + (len - stick) / 2;
        group.add(shankMesh);
      } else if (type === 'Face Mill') {
        // Flat disc
        const discGeom = new THREE.CylinderGeometry(dia / 2, dia / 2, dia * 0.3, 32);
        const discMesh = new THREE.Mesh(discGeom, new THREE.MeshPhongMaterial({ color: colorNum }));
        discMesh.position.z = stick - dia * 0.15;
        group.add(discMesh);

        // Shank
        const shankRad = dia / 4;
        const shankGeom = new THREE.CylinderGeometry(shankRad, shankRad, len - stick, 16);
        const shankMesh = new THREE.Mesh(shankGeom, new THREE.MeshPhongMaterial({ color: 0x888888 }));
        shankMesh.position.z = stick + (len - stick) / 2;
        group.add(shankMesh);
      } else {
        // Generic cylinder
        const geom = new THREE.CylinderGeometry(dia / 2, dia / 2, len, 16);
        const mesh = new THREE.Mesh(geom, new THREE.MeshPhongMaterial({ color: colorNum }));
        mesh.position.z = len / 2;
        group.add(mesh);
      }

      // Holder (generic for all types)
      const holderGeom = new THREE.CylinderGeometry(dia / 1.5, dia / 1.5, len * 0.3, 16);
      const holderMesh = new THREE.Mesh(holderGeom, new THREE.MeshPhongMaterial({ color: 0xcccccc }));
      holderMesh.position.z = len + len * 0.15;
      group.add(holderMesh);

      return group;
    }

    function applyToSimulation() {
      const data = {
        toolNumber: parseInt(document.getElementById('toolNumber').value) || 0,
        type: document.getElementById('toolType').value,
        diameter: parseFloat(document.getElementById('diameter').value) || 0.5,
        length: parseFloat(document.getElementById('length').value) || 3,
        stickOut: parseFloat(document.getElementById('stickOut').value) || 1.5,
        flutes: parseInt(document.getElementById('flutes').value) || 2,
        holder: document.getElementById('holder').value,
        description: document.getElementById('description').value,
        color: document.getElementById('colorInput').value,
      };
      vscode.postMessage({ type: 'applyTool', data });
    }
  </script>
</body>
</html>`;
  }
}
