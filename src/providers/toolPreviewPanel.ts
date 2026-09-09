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
  unit?: 'in' | 'mm';
}

export interface ToolPreviewInitData {
  toolNumber?: number;
  diameter?: number;
  lengthOfCut?: number;
  lengthOutOfHolder?: number;
  holder?: string;
}

export class ToolPreviewPanel {
  static instance: vscode.WebviewPanel | null = null;

  /** Last answer to requestVisualProbe(). See the visualizer panel for why. */
  static lastVisualProbe: {
    litPixels: number;
    sampledPixels: number;
    litRatio: number;
    width: number;
    height: number;
    toolType: string;
    error?: string;
    at: number;
  } | undefined;

  /** Switch the previewed tool type and wait for the panel to redraw. */
  static async setToolType(toolType: string): Promise<void> {
    if (!ToolPreviewPanel.instance) return;
    await ToolPreviewPanel.instance.webview.postMessage({ type: 'setToolType', toolType });
  }

  /**
   * Ask the preview to measure what it drew.
   *
   * The renderer asks for alpha:true but the scene sets an opaque background,
   * so every pixel ends up with alpha 1 and coverage cannot distinguish a drawn
   * tool from an empty view. Difference from that background colour can.
   */
  static async requestVisualProbe(timeoutMs = 5000): Promise<typeof ToolPreviewPanel.lastVisualProbe> {
    const panel = ToolPreviewPanel.instance;
    if (!panel) return undefined;
    const before = ToolPreviewPanel.lastVisualProbe?.at ?? 0;
    await panel.webview.postMessage({ type: 'requestVisualProbe' });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const probe = ToolPreviewPanel.lastVisualProbe;
      if (probe && probe.at > before) return probe;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return undefined;
  }

  static show(context: vscode.ExtensionContext, initData?: ToolPreviewInitData) {
    if (ToolPreviewPanel.instance) {
      ToolPreviewPanel.instance.reveal(vscode.ViewColumn.Beside, true); // preserveFocus=true
      if (initData) {
        ToolPreviewPanel.instance.webview.postMessage({ type: 'loadTool', data: initData });
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'jobline.toolPreview',
      'Tool Preview',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          context.extensionUri,
          vscode.Uri.joinPath(context.extensionUri, 'media'),
        ],
      }
    );

    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png');
    const threeUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'media', 'three.min.js')
    );
    const cspSource = panel.webview.cspSource;
    panel.webview.html = ToolPreviewPanel.getHtml(threeUri.toString(), cspSource);

    if (initData) {
      panel.webview.postMessage({ type: 'loadTool', data: initData });
    }

    panel.onDidDispose(() => {
      ToolPreviewPanel.instance = null;
    });

    panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'visualProbe') {
        ToolPreviewPanel.lastVisualProbe = {
          litPixels: Number(msg.litPixels) || 0,
          sampledPixels: Number(msg.sampledPixels) || 0,
          litRatio: Number(msg.litRatio) || 0,
          width: Number(msg.width) || 0,
          height: Number(msg.height) || 0,
          toolType: typeof msg.toolType === 'string' ? msg.toolType : '',
          error: typeof msg.error === 'string' ? msg.error : undefined,
          at: Date.now(),
        };
      } else if (msg.type === 'applyTool') {
        // Forward to simulation panel (if open)
        ToolpathVisualizerPanel.queueMessage({
          type: 'toolData',
          data: msg.data
        });
      }
    });

    ToolPreviewPanel.instance = panel;
  }

  private static getHtml(threeUri: string, cspSource: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    /* The form column was a fixed 350px against a 1fr canvas. Opened with
       ViewColumn.Beside the panel is only ~360px wide, so the canvas column
       collapsed to zero and the 3D view vanished completely - form only, no
       tool, at every ordinary side-panel width.

       minmax(0, …) lets the form shrink instead of starving the canvas, and
       below 620px the two stack so the tool is always visible. */
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #1e1e1e;
      color: #e0e0e0;
      display: grid;
      grid-template-columns: minmax(180px, 350px) minmax(0, 1fr);
      height: 100vh;
      gap: 1px;
      background-color: #333;
    }
    @media (max-width: 620px) {
      body {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr) minmax(220px, 45vh);
      }
      .form-panel { border-right: none; border-bottom: 1px solid #3e3e42; }
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

    <div class="unit-row" style="display: flex; gap: 4px; margin-bottom: 12px;">
      <button class="sec active" id="unitIn" onclick="setUnit('in')" style="flex:1; text-align:center; background:transparent; border:1px solid #555; color:#ccc; padding:6px; cursor:pointer;">Inches</button>
      <button class="sec" id="unitMm" onclick="setUnit('mm')" style="flex:1; text-align:center; background:transparent; border:1px solid #555; color:#ccc; padding:6px; cursor:pointer;">Metric (mm)</button>
    </div>

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

  <!-- Three.js — bundled locally, no internet required -->
  <script type="module">
    import * as THREE from '${threeUri}';
    const vscode = acquireVsCodeApi();

    // Visual probe. This renderer is created with alpha:true, so the cleared
    // buffer is TRANSPARENT rather than a known colour - the toolpath
    // visualizer's "differs from the clear colour" test would call every pixel
    // lit here. Opacity is the signal instead: a drawn tool writes alpha, an
    // empty scene does not.
    let probeRequested = false;

    function readToolProbe() {
      if (!renderer) return { type: 'visualProbe', error: 'no renderer' };
      const gl = renderer.getContext();
      const w = renderer.domElement.width;
      const h = renderer.domElement.height;
      if (!w || !h) return { type: 'visualProbe', litPixels: 0, sampledPixels: 0, litRatio: 0, width: w, height: h };
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      // scene.background is an opaque 0x1a1a1a, so every pixel has alpha 1 and
      // alpha coverage cannot tell a drawn tool from an empty scene. Difference
      // from that background colour is the usable signal, as in the visualizer.
      let lit = 0;
      let total = 0;
      for (let i = 0; i < buf.length; i += 16 * 4) {
        total++;
        const dr = Math.abs(buf[i] - 0x1a);
        const dg = Math.abs(buf[i + 1] - 0x1a);
        const db = Math.abs(buf[i + 2] - 0x1a);
        if (dr + dg + db > 12) lit++;
      }
      return {
        type: 'visualProbe',
        litPixels: lit,
        sampledPixels: total,
        litRatio: total ? lit / total : 0,
        width: w,
        height: h,
        toolType: document.getElementById('toolType') ? document.getElementById('toolType').value : ''
      };
    }
    let scene, camera, renderer;
    let isDragging = false;
    let cameraRotation = { x: 0.3, y: 0.5 };
    let previousMousePosition = { x: 0, y: 0 };
    let animationId;
    let pendingToolData = null;
    const threeReady = !!(THREE && THREE.WebGLRenderer);

    if (!threeReady) {
      document.querySelector('.canvas-panel').innerHTML =
        '<div style="color:#f88;padding:20px;font-family:monospace;">Three.js failed to load — check that media/three.min.js is present in the extension.</div>';
    }

    // Unit tracking
    let currentUnit = 'in';

    function setUnit(unit) {
      currentUnit = unit;
      document.getElementById('unitIn').style.background = unit === 'in' ? '#0e639c' : 'transparent';
      document.getElementById('unitMm').style.background = unit === 'mm' ? '#0e639c' : 'transparent';
      document.getElementById('unitIn').style.color = unit === 'in' ? '#fff' : '#ccc';
      document.getElementById('unitMm').style.color = unit === 'mm' ? '#fff' : '#ccc';
      localStorage.setItem('toolPreviewUnit', unit);
    }

    // Load saved unit preference
    const savedUnit = localStorage.getItem('toolPreviewUnit') || 'in';
    setUnit(savedUnit);

    // Init scene — Three.js loaded via module import above
    if (threeReady) {
      setupScene();
      refreshPreview();
      if (pendingToolData) { loadTool(pendingToolData); pendingToolData = null; }
    }

    function setupScene() {
      const canvas = document.getElementById('canvas');
      if (!canvas) {
        console.error('[ToolPreview] Canvas element not found');
        return;
      }

      console.log('[ToolPreview] Setting up scene, canvas:', canvas.clientWidth, 'x', canvas.clientHeight);

      try {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1a1a1a);

        camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
        camera.position.set(2, 1.5, 2);
        camera.lookAt(0, 0.5, 0);

        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.shadowMap.enabled = true;
        console.log('[ToolPreview] Renderer created');
      } catch (err) {
        console.error('[ToolPreview] Error setting up renderer:', err);
        return;
      }

      try {
        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
        directionalLight.position.set(5, 8, 5);
        directionalLight.castShadow = true;
        directionalLight.shadow.camera.left = -10;
        directionalLight.shadow.camera.right = 10;
        directionalLight.shadow.camera.top = 10;
        directionalLight.shadow.camera.bottom = -10;
        scene.add(directionalLight);

        // Grid
        const gridHelper = new THREE.GridHelper(4, 8, 0x444444, 0x222222);
        gridHelper.position.y = -0.05;
        scene.add(gridHelper);
        console.log('[ToolPreview] Scene setup complete');
      } catch (err) {
        console.error('[ToolPreview] Error setting up scene objects:', err);
        return;
      }

      // Mouse controls
      canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        previousMousePosition = { x: e.clientX, y: e.clientY };
      });

      canvas.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const deltaX = e.clientX - previousMousePosition.x;
        const deltaY = e.clientY - previousMousePosition.y;
        previousMousePosition = { x: e.clientX, y: e.clientY };

        cameraRotation.y += deltaX * 0.005;
        cameraRotation.x += deltaY * 0.005;
        cameraRotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cameraRotation.x));

        const distance = 3;
        camera.position.x = Math.sin(cameraRotation.y) * Math.cos(cameraRotation.x) * distance;
        camera.position.y = Math.sin(cameraRotation.x) * distance + 1;
        camera.position.z = Math.cos(cameraRotation.y) * Math.cos(cameraRotation.x) * distance;
        camera.lookAt(0, 0.5, 0);
      });

      canvas.addEventListener('mouseup', () => {
        isDragging = false;
      });

      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const distance = camera.position.length();
        const newDistance = Math.max(1, Math.min(10, distance + e.deltaY * 0.001));
        const scale = newDistance / distance;
        camera.position.multiplyScalar(scale);
      }, { passive: false });

      // Resize handling.
      //
      // A webview panel opened beside the editor is often not laid out when the
      // scene is built, so canvas.clientWidth/Height are 0: camera.aspect
      // becomes NaN and the renderer is sized 0x0. Recovery depended on a
      // window 'resize' event, which does not necessarily arrive when a hidden
      // panel is later revealed - so the preview could stay blank for good,
      // which reads exactly like "the 3D view is broken".
      //
      // A ResizeObserver on the canvas fires when the element actually gets a
      // size, including the first layout, so the view repairs itself.
      function applyCanvasSize() {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (!w || !h) return;            // never divide by zero into camera.aspect
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }

      window.addEventListener('resize', applyCanvasSize);
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(applyCanvasSize).observe(canvas);
      }
      applyCanvasSize();

      // Animation loop
      try {
        function animate() {
          animationId = requestAnimationFrame(animate);
          if (renderer && scene && camera) {
            renderer.render(scene, camera);
            if (probeRequested) {
              probeRequested = false;
              try {
                vscode.postMessage(readToolProbe());
              } catch (perr) {
                vscode.postMessage({ type: 'visualProbe', error: String(perr && perr.message || perr) });
              }
            }
          }
        }
        animate();
        console.log('[ToolPreview] Animation loop started');
      } catch (err) {
        console.error('[ToolPreview] Error starting animation loop:', err);
      }
    }

    function refreshPreview() {
      if (!threeReady || !scene) {
        console.warn('[ToolPreview] Scene not ready, skipping refresh');
        return;
      }

      try {
        // Clear old tool (and its children)
        const toRemove = [];
        scene.traverse((obj) => {
          if (obj.userData.isTool || (obj.parent && obj.parent.userData.isTool)) {
            toRemove.push(obj);
          }
        });
        toRemove.forEach((obj) => {
          if (obj.parent) obj.parent.remove(obj);
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        });

        const type = document.getElementById('toolType').value;
        let dia = parseFloat(document.getElementById('diameter').value) || 0.5;
        let len = parseFloat(document.getElementById('length').value) || 3;
        let stick = parseFloat(document.getElementById('stickOut').value) || 1.5;
        const flutes = parseInt(document.getElementById('flutes').value) || 2;
        const color = document.getElementById('colorInput').value;

        // Convert mm to inches for 3D rendering (all internal units are inches)
        const mmToInchConversion = currentUnit === 'mm' ? 1 / 25.4 : 1;
        dia *= mmToInchConversion;
        len *= mmToInchConversion;
        stick *= mmToInchConversion;

        const toolGeom = buildToolGeometry(type, dia, len, stick, flutes, color);
        toolGeom.userData.isTool = true;
        scene.add(toolGeom);
        console.log('[ToolPreview] Tool geometry created:', type, 'unit:', currentUnit);
      } catch (err) {
        console.error('[ToolPreview] Error in refreshPreview:', err);
      }
    }

    function buildToolGeometry(type, dia, len, stick, flutes, color) {
      const group = new THREE.Group();
      const colorNum = parseInt(color.slice(1), 16);
      const holderType = document.getElementById('holder').value;

      // Position tool so tip is at origin, extends upward along Z
      // This way we can see it centered and properly scaled
      const toolOffsetZ = len / 2; // Center of tool at origin Z

      // Cutting portion (stick-out) — the working end of the tool
      if (type === 'End Mill') {
        const cuttingGeom = new THREE.CylinderGeometry(dia / 2, dia / 2, stick, 16);
        const cuttingMat = new THREE.MeshPhongMaterial({
          color: colorNum,
          shininess: 80,
          side: THREE.DoubleSide
        });
        const cuttingMesh = new THREE.Mesh(cuttingGeom, cuttingMat);
        cuttingMesh.castShadow = true;
        cuttingMesh.receiveShadow = true;
        // Position: tip at -stick/2, base at +stick/2, so stick-out extends upward from holder
        cuttingMesh.position.z = -toolOffsetZ + stick / 2;
        group.add(cuttingMesh);

        // Flutes (helix lines) — visible spiral grooves
        for (let i = 0; i < flutes; i++) {
          const angle = (i / flutes) * Math.PI * 2;
          const points = [];
          for (let j = 0; j < Math.max(2, stick * 10); j++) {
            const t = j / Math.max(1, stick * 10 - 1);
            const z = -toolOffsetZ + (t * stick);
            const helix = angle + t * Math.PI * 4;
            const x = (dia / 2 * 0.95) * Math.cos(helix);
            const y = (dia / 2 * 0.95) * Math.sin(helix);
            points.push(new THREE.Vector3(x, y, z));
          }
          if (points.length > 1) {
            const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
            const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: 0x555555, linewidth: 2 }));
            group.add(line);
          }
        }

        // Shank (the part that fits in the holder)
        const shankRad = dia / 2.5;
        const shankLen = len - stick;
        const shankGeom = new THREE.CylinderGeometry(shankRad, shankRad, shankLen, 16);
        const shankMat = new THREE.MeshPhongMaterial({
          color: 0x888888,
          shininess: 60,
          side: THREE.DoubleSide
        });
        const shankMesh = new THREE.Mesh(shankGeom, shankMat);
        shankMesh.castShadow = true;
        shankMesh.receiveShadow = true;
        // Position shank above cutting portion
        shankMesh.position.z = -toolOffsetZ + stick + shankLen / 2;
        group.add(shankMesh);
      } else if (type === 'Drill') {
        // Drill body (cylindrical)
        const bodyLen = stick * 0.85;
        const bodyGeom = new THREE.CylinderGeometry(dia / 2, dia / 2, bodyLen, 16);
        const bodyMat = new THREE.MeshPhongMaterial({
          color: colorNum,
          shininess: 80,
          side: THREE.DoubleSide
        });
        const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
        bodyMesh.castShadow = true;
        bodyMesh.receiveShadow = true;
        bodyMesh.position.z = -toolOffsetZ + bodyLen / 2;
        group.add(bodyMesh);

        // Drill tip (cone with sharp point)
        const tipLen = stick * 0.15;
        const tipGeom = new THREE.ConeGeometry(dia / 2, tipLen, 16);
        const tipMat = new THREE.MeshPhongMaterial({
          color: colorNum,
          shininess: 100,
          side: THREE.DoubleSide
        });
        const tipMesh = new THREE.Mesh(tipGeom, tipMat);
        tipMesh.castShadow = true;
        tipMesh.receiveShadow = true;
        tipMesh.position.z = -toolOffsetZ - tipLen / 2;
        group.add(tipMesh);

        // Flute lines (2 straight flutes for drill)
        for (let i = 0; i < 2; i++) {
          const angle = (i / 2) * Math.PI;
          const points = [];
          for (let j = 0; j < 15; j++) {
            const t = j / 14;
            const z = -toolOffsetZ + (t * bodyLen);
            const x = (dia / 2 * 0.9) * Math.cos(angle);
            const y = (dia / 2 * 0.9) * Math.sin(angle);
            points.push(new THREE.Vector3(x, y, z));
          }
          const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
          const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: 0x555555, linewidth: 2 }));
          group.add(line);
        }

        // Shank
        const shankRad = dia / 3;
        const shankLen = len - stick;
        const shankGeom = new THREE.CylinderGeometry(shankRad, shankRad, shankLen, 16);
        const shankMat = new THREE.MeshPhongMaterial({
          color: 0x888888,
          shininess: 60,
          side: THREE.DoubleSide
        });
        const shankMesh = new THREE.Mesh(shankGeom, shankMat);
        shankMesh.castShadow = true;
        shankMesh.receiveShadow = true;
        shankMesh.position.z = -toolOffsetZ + stick + shankLen / 2;
        group.add(shankMesh);
      } else if (type === 'Face Mill') {
        // Cutting head (flat disc with inserts)
        const headRad = dia / 2;
        const headThick = dia * 0.25;
        const discGeom = new THREE.CylinderGeometry(headRad, headRad, headThick, 32);
        const discMat = new THREE.MeshPhongMaterial({
          color: colorNum,
          shininess: 70,
          side: THREE.DoubleSide
        });
        const discMesh = new THREE.Mesh(discGeom, discMat);
        discMesh.castShadow = true;
        discMesh.receiveShadow = true;
        discMesh.position.z = -toolOffsetZ + stick - headThick / 2;
        group.add(discMesh);

        // Shank
        const shankRad = dia / 4;
        const shankLen = len - stick;
        const shankGeom = new THREE.CylinderGeometry(shankRad, shankRad, shankLen, 16);
        const shankMat = new THREE.MeshPhongMaterial({
          color: 0x888888,
          shininess: 60,
          side: THREE.DoubleSide
        });
        const shankMesh = new THREE.Mesh(shankGeom, shankMat);
        shankMesh.castShadow = true;
        shankMesh.receiveShadow = true;
        shankMesh.position.z = -toolOffsetZ + stick + shankLen / 2;
        group.add(shankMesh);
      } else {
        // Generic cylinder (default/custom tool type)
        const geom = new THREE.CylinderGeometry(dia / 2, dia / 2, stick, 16);
        const mat = new THREE.MeshPhongMaterial({
          color: colorNum,
          shininess: 70,
          side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.z = -toolOffsetZ + stick / 2;
        group.add(mesh);

        // Shank
        const shankRad = dia / 2.5;
        const shankLen = len - stick;
        const shankGeom = new THREE.CylinderGeometry(shankRad, shankRad, shankLen, 16);
        const shankMat = new THREE.MeshPhongMaterial({
          color: 0x888888,
          shininess: 60,
          side: THREE.DoubleSide
        });
        const shankMesh = new THREE.Mesh(shankGeom, shankMat);
        shankMesh.castShadow = true;
        shankMesh.receiveShadow = true;
        shankMesh.position.z = -toolOffsetZ + stick + shankLen / 2;
        group.add(shankMesh);
      }

      // Holder/Coupling body (visible at top of shank)
      const holderRad = Math.max(dia / 1.2, 0.4);
      const holderLen = (len - (len - stick)) * 0.4; // Proportional to overall size
      const holderGeom = new THREE.CylinderGeometry(holderRad * 1.2, holderRad, holderLen, 24);
      const holderMat = new THREE.MeshPhongMaterial({
        color: 0xbbbbbb,
        shininess: 50,
        side: THREE.DoubleSide
      });
      const holderMesh = new THREE.Mesh(holderGeom, holderMat);
      holderMesh.castShadow = true;
      holderMesh.receiveShadow = true;
      holderMesh.position.z = -toolOffsetZ + len - holderLen / 2;
      group.add(holderMesh);

      return group;
    }

    function loadTool(data) {
      if (data.toolNumber) document.getElementById('toolNumber').value = data.toolNumber;
      if (data.diameter) document.getElementById('diameter').value = data.diameter;
      if (data.lengthOfCut) document.getElementById('length').value = data.lengthOfCut;
      if (data.lengthOutOfHolder) document.getElementById('stickOut').value = data.lengthOutOfHolder;
      if (data.holder) document.getElementById('holder').value = data.holder;
      refreshPreview();
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
        unit: currentUnit,
      };
      vscode.postMessage({ type: 'applyTool', data });
    }

    // Listen for messages from extension
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'loadTool') {
        if (scene) {
          loadTool(msg.data);
        } else {
          pendingToolData = msg.data;
        }
      } else if (msg.type === 'setToolType') {
        // Drives the dropdown from outside so the visual bed can walk every
        // type the panel offers, rather than only the default one.
        const sel = document.getElementById('toolType');
        if (sel) {
          sel.value = msg.toolType;
          sel.dispatchEvent(new Event('change'));
        }
        if (typeof refreshPreview === 'function') refreshPreview();
      } else if (msg.type === 'requestVisualProbe') {
        probeRequested = true;
      }
    });
  </script>
</body>
</html>`;
  }
}
