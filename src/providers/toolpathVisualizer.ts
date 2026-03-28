
import * as vscode from 'vscode';

export class ToolpathVisualizerPanel {
  public static currentPanel: ToolpathVisualizerPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  public static readonly viewType = 'jobline.toolpathVisualizer';

  public static show(extensionUri: vscode.Uri) {
    const column = vscode.ViewColumn.Beside;
    if (ToolpathVisualizerPanel.currentPanel) {
      ToolpathVisualizerPanel.currentPanel._panel.reveal(column);
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

  public postMessage(msg: any) {
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
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>G-Code Toolpath Visualizer</title>
  <style>
    body { background: #222; color: #eee; margin: 0; font-family: sans-serif; display: flex; }
    #sidebar { width: 280px; background: #181818; padding: 12px 8px; border-right: 1px solid #333; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; }
    #main { flex: 1; display: flex; flex-direction: column; }
    #canvas { width: 100%; flex: 1; display: block; background: #181818; }
    #info { padding: 8px; font-size: 0.9em; background: #222; border-bottom: 1px solid #333; }
    .toggle-row { display: flex; align-items: center; gap: 6px; font-size: 0.85em; }
    .toggle-row input[type="checkbox"] { flex-shrink: 0; }
    .toggle-row label { flex: 1; }
    .toggle-row input[type="color"] { width: 30px; height: 24px; cursor: pointer; flex-shrink: 0; }
    .section { margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid #333; }
    .section:last-child { border-bottom: none; }
    .group-label { font-size: 0.85em; color: #aaa; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
    button { background: #333; color: #eee; border: 1px solid #555; padding: 4px 8px; font-size: 0.8em; cursor: pointer; margin-top: 4px; width: 100%; }
    button:hover { background: #444; }
    input[type="file"] { font-size: 0.8em; }
    input[type="number"] { width: 100%; box-sizing: border-box; padding: 3px; background: #222; color: #eee; border: 1px solid #444; margin-bottom: 4px; }
    select { width: 100%; padding: 3px; background: #222; color: #eee; border: 1px solid #444; margin-bottom: 6px; }
    label { display: block; font-size: 0.8em; margin-bottom: 2px; }
    #viewButtons { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
    #viewButtons button { margin: 0; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/three@0.155.0/build/three.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.155.0/examples/js/loaders/STLLoader.js"></script>
</head>
<body>
  <div id="sidebar">
    <div class="section">
      <div class="group-label">Layers</div>
      <div class="toggle-row"><input type="checkbox" id="toggleHolder" checked><label for="toggleHolder">Holder</label><input type="color" id="colorHolder" value="#8844aa"></div>
      <div class="toggle-row"><input type="checkbox" id="toggleTool" checked><label for="toggleTool">Tool</label><input type="color" id="colorTool" value="#00ccff"></div>
      <div class="toggle-row"><input type="checkbox" id="togglePath" checked><label for="togglePath">Path</label><input type="color" id="colorPath" value="#ffff00"></div>
      <div class="toggle-row"><input type="checkbox" id="toggleStock" checked><label for="toggleStock">Stock</label><input type="color" id="colorStock" value="#4488ff"></div>
      <div class="toggle-row"><input type="checkbox" id="toggleFixture" checked><label for="toggleFixture">Fixture</label><input type="color" id="colorFixture" value="#ff8822"></div>
      <div class="toggle-row"><input type="checkbox" id="toggleJaws" checked><label for="toggleJaws">Jaws</label><input type="color" id="colorJaws" value="#44cc88"></div>
    </div>

    <div class="section">
      <div class="group-label">View</div>
      <div id="viewButtons">
        <button id="viewTop">Top</button>
        <button id="viewBottom">Bottom</button>
        <button id="viewFront">Front</button>
        <button id="viewBack">Back</button>
        <button id="viewLeft">Left</button>
        <button id="viewRight">Right</button>
        <button id="viewIso">Isometric</button>
      </div>
    </div>

    <div class="section" id="playbackSection">
      <div class="group-label">Playback</div>
      <div id="segmentReadout" style="font-size:1em; font-weight:bold; color:#fff; background:#111; border:1px solid #444; border-radius:4px; padding:4px 8px; margin-bottom:8px; text-align:center; letter-spacing:0.05em;">
        Segment &mdash; / &mdash;
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:4px; margin-bottom:4px;">
        <button id="jumpStartBtn" title="Jump to Start" style="font-size:1.3em; padding:6px 2px; text-align:center;">⏮</button>
        <button id="stepGroupBackBtn" title="Step Back Group" style="font-size:1.1em; padding:6px 2px; text-align:center;">&#x23EA;</button>
        <button id="stepBackBtn" title="Step Back 1 Line" style="font-size:1.1em; padding:6px 2px; text-align:center;">◀1</button>
      </div>
      <button id="playPauseBtn" style="font-size:1.6em; padding:8px; width:100%; background:#0e639c; color:#fff; border:none; border-radius:6px; cursor:pointer; margin-bottom:4px; text-align:center; font-weight:bold;">▶ Play</button>
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:4px; margin-bottom:8px;">
        <button id="stepFwdBtn" title="Step Forward 1 Line" style="font-size:1.1em; padding:6px 2px; text-align:center;">1▶</button>
        <button id="stepGroupFwdBtn" title="Step Forward Group" style="font-size:1.1em; padding:6px 2px; text-align:center;">&#x23E9;</button>
        <button id="jumpEndBtn" title="Jump to End" style="font-size:1.3em; padding:6px 2px; text-align:center;">⏭</button>
      </div>
      <div>
        <label style="display:block; font-size:0.85em; margin-bottom:4px; color:#aaa;">
          Speed: <span id="speedVal">1.0x</span>
        </label>
        <input type="range" id="speedSlider" min="0.1" max="5" step="0.1" value="1" style="width:100%; accent-color:#0e639c;">
      </div>
      <label style="display:flex; align-items:center; gap:4px; cursor:pointer; margin-top:8px;">
        <input type="checkbox" id="mStopToggle" checked>
        <span style="font-size:0.8em; color:#aaa;">Pause at M0/M1</span>
      </label>
    </div>

    <div class="section">
      <div class="group-label">Stock</div>
      <input type="file" id="importStock" accept=".stl">
      <button id="manualStock">Manual</button>
      <div id="stockForm" style="display:none;">
        <select id="stockShape"><option value="box">Box</option><option value="cylinder">Cylinder</option></select>
        <div id="stockBox">
          <label>Width (X): <input type="number" id="stockW" value="50" step="0.1"></label>
          <label>Depth (Y): <input type="number" id="stockD" value="50" step="0.1"></label>
          <label>Height (Z): <input type="number" id="stockH" value="50" step="0.1"></label>
          <label>X Offset: <input type="number" id="stockX" value="0" step="0.1"></label>
          <label>Y Offset: <input type="number" id="stockY" value="0" step="0.1"></label>
          <label>Z Offset: <input type="number" id="stockZ" value="0" step="0.1"></label>
        </div>
        <div id="stockCyl" style="display:none;">
          <label>Radius: <input type="number" id="stockR" value="25" step="0.1"></label>
          <label>Height (Z): <input type="number" id="stockH2" value="50" step="0.1"></label>
          <label>Z Offset: <input type="number" id="stockZ2" value="0" step="0.1"></label>
        </div>
        <button id="stockApply" type="button">Apply</button>
      </div>
    </div>

    <div class="section">
      <div class="group-label">Fixture</div>
      <input type="file" id="importFixture" accept=".stl">
      <button id="manualFixture">Manual</button>
      <div id="fixtureForm" style="display:none;">
        <select id="fixtureShape"><option value="box">Box</option><option value="cylinder">Cylinder</option></select>
        <div id="fixtureBox">
          <label>Width (X): <input type="number" id="fixtureW" value="100" step="0.1"></label>
          <label>Depth (Y): <input type="number" id="fixtureD" value="100" step="0.1"></label>
          <label>Height (Z): <input type="number" id="fixtureH" value="20" step="0.1"></label>
          <label>X Offset: <input type="number" id="fixtureX" value="0" step="0.1"></label>
          <label>Y Offset: <input type="number" id="fixtureY" value="0" step="0.1"></label>
          <label>Z Offset: <input type="number" id="fixtureZ" value="0" step="0.1"></label>
        </div>
        <div id="fixtureCyl" style="display:none;">
          <label>Radius: <input type="number" id="fixtureR" value="50" step="0.1"></label>
          <label>Height (Z): <input type="number" id="fixtureH2" value="20" step="0.1"></label>
          <label>Z Offset: <input type="number" id="fixtureZ2" value="0" step="0.1"></label>
        </div>
        <button id="fixtureApply" type="button">Apply</button>
      </div>
    </div>

    <div class="section">
      <div class="group-label">Jaws</div>
      <input type="file" id="importJaws" accept=".stl">
      <button id="manualJaws">Manual</button>
      <div id="jawsForm" style="display:none;">
        <select id="jawsShape"><option value="box">Box</option><option value="cylinder">Cylinder</option></select>
        <div id="jawsBox">
          <label>Width (X): <input type="number" id="jawsW" value="30" step="0.1"></label>
          <label>Depth (Y): <input type="number" id="jawsD" value="40" step="0.1"></label>
          <label>Height (Z): <input type="number" id="jawsH" value="25" step="0.1"></label>
          <label>X Offset: <input type="number" id="jawsX" value="0" step="0.1"></label>
          <label>Y Offset: <input type="number" id="jawsY" value="0" step="0.1"></label>
          <label>Z Offset: <input type="number" id="jawsZ" value="0" step="0.1"></label>
        </div>
        <div id="jawsCyl" style="display:none;">
          <label>Radius: <input type="number" id="jawsR" value="15" step="0.1"></label>
          <label>Height (Z): <input type="number" id="jawsH2" value="25" step="0.1"></label>
          <label>Z Offset: <input type="number" id="jawsZ2" value="0" step="0.1"></label>
        </div>
        <button id="jawsApply" type="button">Apply</button>
      </div>
    </div>
  </div>

  <div id="main">
    <div id="unitBar" style="display:flex; align-items:center; gap:6px; padding:4px 8px; background:#1a1a1a; border-bottom:1px solid #333; font-size:0.85em;">
      <span style="color:#aaa;">Units:</span>
      <button id="unitInBtn" class="unit-btn active" onclick="setSceneUnit('in')" style="background:#333; color:#eee; border:1px solid #555; padding:6px 10px; font-size:0.8em; cursor:pointer; margin:0;">in</button>
      <button id="unitMmBtn" class="unit-btn" onclick="setSceneUnit('mm')" style="background:#333; color:#eee; border:1px solid #555; padding:6px 10px; font-size:0.8em; cursor:pointer; margin:0;">mm</button>
      <span id="unitHint" style="color:#666; margin-left:4px; font-size:0.8em;">G20/G21 auto-detected</span>
    </div>
    <div id="info">Cutter Size: <span id="cutterSize">-</span> mm</div>
    <canvas id="canvas"></canvas>
  </div>

  <script>
    const vs = acquireVsCodeApi();
    let renderer, scene, camera;
    let orbitState = { down: false, x: 0, y: 0, rotX: 0, rotY: 0 };
    const canvas = document.getElementById('canvas');

    // Playback and visualization state
    let isPlaying = false;
    let currentUnit = 'in';
    let currentPathLength = 0;
    let currentPathIdx = 0;

    // Helper functions
    function setSceneUnit(unit) {
      currentUnit = unit;
      document.getElementById('unitInBtn').classList.toggle('active', unit === 'in');
      document.getElementById('unitMmBtn').classList.toggle('active', unit === 'mm');
      const hint = document.getElementById('unitHint');
      hint.textContent = unit === 'in' ? 'Inches (G20)' : 'Millimeters (G21)';
    }

    function updateToolCylinder(pt, cutterDiameter) {
      if (!pt) return;
      const radius = (cutterDiameter || 5) / 2;
      const geom = new THREE.CylinderGeometry(radius, radius, radius * 2, 16);
      const mat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(LAYERS.tool.color),
        transparent: true,
        opacity: 0.85
      });
      if (LAYERS.tool.mesh) scene.remove(LAYERS.tool.mesh);
      LAYERS.tool.mesh = new THREE.Mesh(geom, mat);
      LAYERS.tool.mesh.position.set(pt.x || 0, (pt.y || 0) + radius, pt.z || 0);
      LAYERS.tool.mesh.visible = LAYERS.tool.visible;
      scene.add(LAYERS.tool.mesh);
    }

    function drawCutTrail(path, upToIdx) {
      if (!path || upToIdx < 1) return;
      const slicedPath = path.slice(0, upToIdx);
      const geom = new THREE.BufferGeometry();
      const verts = slicedPath.flatMap(p => [p.x || 0, p.y || 0, p.z || 0]);
      geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xff8800, linewidth: 2 });
      const trail = new THREE.Line(geom, mat);
      if (window._cutTrail) scene.remove(window._cutTrail);
      scene.add(trail);
      window._cutTrail = trail;

      // Draw swept tube using current tool radius
      drawSweptTube(path, upToIdx, window._toolRadius || 0.125);
    }

    function drawSweptTube(path, upToIdx, toolRadius) {
      if (!path || upToIdx < 2) return;
      const pts = path.slice(0, upToIdx).map(p =>
        new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0)
      );
      // Use CatmullRom curve for smooth interpolation
      const curve = new THREE.CatmullRomCurve3(pts);
      const tubeGeom = new THREE.TubeGeometry(curve, upToIdx, toolRadius, 8, false);
      const tubeMat = new THREE.MeshPhongMaterial({
        color: 0xff6600,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const tube = new THREE.Mesh(tubeGeom, tubeMat);
      if (window._sweptTube) scene.remove(window._sweptTube);
      scene.add(tube);
      window._sweptTube = tube;
    }

    function handleStockSettings(msg) {
      if (!msg || !msg.w) return;
      const factor = msg.unit === 'mm' ? 1 / 25.4 : 1.0;
      const w = (msg.w || 4) * factor;
      const d = (msg.d || 4) * factor;
      const h = (msg.h || 2) * factor;
      if (LAYERS.stock.mesh) scene.remove(LAYERS.stock.mesh);
      const geom = new THREE.BoxGeometry(w, h, d);
      const mat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(msg.color || LAYERS.stock.color),
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      LAYERS.stock.mesh = new THREE.Mesh(geom, mat);
      LAYERS.stock.mesh.position.set(0, h / 2, 0);
      LAYERS.stock.mesh.visible = LAYERS.stock.visible;
      scene.add(LAYERS.stock.mesh);
    }

    function showMStopNotice(code) {
      const notice = document.getElementById('mStopNotice');
      const labels = { 'M0': 'Program Stop', 'M1': 'Optional Stop', 'M2': 'Program End', 'M30': 'End & Rewind' };
      notice.textContent = code + ' — ' + (labels[code] || 'Stop');
      notice.style.display = 'block';
      clearTimeout(notice._timer);
      notice._timer = setTimeout(() => { notice.style.display = 'none'; }, 3000);
    }

    const LAYERS = {
      holder:  { mesh: null, color: '#8844aa', visible: true },
      tool:    { mesh: null, color: '#00ccff', visible: true },
      path:    { mesh: null, color: '#ffff00', visible: true },
      stock:   { mesh: null, color: '#4488ff', visible: true, opacity: 0.5 },
      fixture: { mesh: null, color: '#ff8822', visible: true, opacity: 0.5 },
      jaws:    { mesh: null, color: '#44cc88', visible: true, opacity: 0.5 }
    };

    function initThree() {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setClearColor(0x181818);
      renderer.setPixelRatio(window.devicePixelRatio);
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 10000);
      camera.position.set(200, 200, 200);
      camera.lookAt(0, 0, 0);
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const light = new THREE.DirectionalLight(0xffffff, 0.7);
      light.position.set(200, 300, 200);
      light.castShadow = true;
      scene.add(light);
      onWindowResize();
      animate();
    }

    function animate() {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }

    function onWindowResize() {
      if (!renderer || !camera) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function setLayerVisibility(key, visible) {
      LAYERS[key].visible = visible;
      if (LAYERS[key].mesh) LAYERS[key].mesh.visible = visible;
    }

    function updateLayerColor(key, hex) {
      LAYERS[key].color = hex;
      if (LAYERS[key].mesh && LAYERS[key].mesh.material) {
        LAYERS[key].mesh.material.color.setStyle(hex);
      }
    }

    function setCamera(x, y, z) {
      camera.position.set(x, y, z);
      camera.lookAt(0, 0, 0);
    }

    function createBoxMesh(w, h, d, x, y, z, colorKey) {
      const geom = new THREE.BoxGeometry(w, h, d);
      const mat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(LAYERS[colorKey].color),
        opacity: LAYERS[colorKey].opacity,
        transparent: true
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(x, y, z);
      return mesh;
    }

    function createCylinderMesh(r, h, z, colorKey) {
      const geom = new THREE.CylinderGeometry(r, r, h, 32);
      const mat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(LAYERS[colorKey].color),
        opacity: LAYERS[colorKey].opacity,
        transparent: true
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.y = z;
      return mesh;
    }

    function drawToolpath(points, highlightIdx = -1) {
      if (LAYERS.path.mesh) scene.remove(LAYERS.path.mesh);
      if (!points || points.length < 2) return;
      const geom = new THREE.BufferGeometry();
      const verts = points.flatMap(p => [p.x || 0, p.y || 0, p.z || 0]);
      geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));

      // Color segments: rapids (blue), feed (green), highlight (red)
      const colors = [];
      for (let i = 0; i < points.length; i++) {
        let color;
        if (i === highlightIdx) {
          color = new THREE.Color(0xff0000); // Red for current segment
        } else if (points[i].isRapid) {
          color = new THREE.Color(0x0000ff); // Blue for rapids
        } else {
          color = new THREE.Color(LAYERS.path.color); // Yellow for feed
        }
        colors.push(color.r, color.g, color.b);
      }
      geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

      const mat = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 3 });
      LAYERS.path.mesh = new THREE.Line(geom, mat);
      LAYERS.path.mesh.visible = LAYERS.path.visible;
      scene.add(LAYERS.path.mesh);
    }

    function loadSTL(file, layerKey) {
      const reader = new FileReader();
      reader.onload = () => {
        const loader = new THREE.STLLoader();
        const geometry = loader.parse(reader.result);
        if (LAYERS[layerKey].mesh) scene.remove(LAYERS[layerKey].mesh);
        const mat = new THREE.MeshPhongMaterial({
          color: new THREE.Color(LAYERS[layerKey].color),
          opacity: LAYERS[layerKey].opacity,
          transparent: true
        });
        LAYERS[layerKey].mesh = new THREE.Mesh(geometry, mat);
        LAYERS[layerKey].mesh.visible = LAYERS[layerKey].visible;
        scene.add(LAYERS[layerKey].mesh);
      };
      reader.readAsArrayBuffer(file);
    }

    window.addEventListener('resize', onWindowResize);

    canvas.addEventListener('mousedown', e => {
      orbitState.down = true;
      orbitState.x = e.clientX;
      orbitState.y = e.clientY;
    });

    canvas.addEventListener('mousemove', e => {
      if (!orbitState.down) return;
      const dx = e.clientX - orbitState.x;
      const dy = e.clientY - orbitState.y;
      orbitState.rotY += dx * 0.005;
      orbitState.rotX += dy * 0.005;
      const r = Math.sqrt(camera.position.x ** 2 + camera.position.y ** 2 + camera.position.z ** 2);
      camera.position.x = r * Math.sin(orbitState.rotY) * Math.cos(orbitState.rotX);
      camera.position.y = r * Math.sin(orbitState.rotX);
      camera.position.z = r * Math.cos(orbitState.rotY) * Math.cos(orbitState.rotX);
      orbitState.x = e.clientX;
      orbitState.y = e.clientY;
    });

    canvas.addEventListener('mouseup', () => { orbitState.down = false; });

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const r = Math.sqrt(camera.position.x ** 2 + camera.position.y ** 2 + camera.position.z ** 2);
      const newR = Math.max(10, r + e.deltaY * 0.2);
      const scale = newR / r;
      camera.position.multiplyScalar(scale);
    }, { passive: false });

    ['holder', 'tool', 'path', 'stock', 'fixture', 'jaws'].forEach(key => {
      const togId = 'toggle' + key[0].toUpperCase() + key.slice(1);
      const colId = 'color' + key[0].toUpperCase() + key.slice(1);
      document.getElementById(togId).addEventListener('change', e => setLayerVisibility(key, e.target.checked));
      document.getElementById(colId).addEventListener('change', e => updateLayerColor(key, e.target.value));
    });

    document.getElementById('viewTop').addEventListener('click', () => setCamera(0, 300, 0));
    document.getElementById('viewBottom').addEventListener('click', () => setCamera(0, -300, 0));
    document.getElementById('viewFront').addEventListener('click', () => setCamera(0, 0, 300));
    document.getElementById('viewBack').addEventListener('click', () => setCamera(0, 0, -300));
    document.getElementById('viewLeft').addEventListener('click', () => setCamera(-300, 0, 0));
    document.getElementById('viewRight').addEventListener('click', () => setCamera(300, 0, 0));
    document.getElementById('viewIso').addEventListener('click', () => setCamera(200, 200, 200));

    // Play/Pause Toggle
    document.getElementById('playPauseBtn').addEventListener('click', () => {
      isPlaying = !isPlaying;
      const btn = document.getElementById('playPauseBtn');
      if (isPlaying) {
        btn.textContent = '⏸ Pause';
        btn.style.background = '#c9302c';
        const speed = parseFloat(document.getElementById('speedSlider').value);
        vs.postMessage({ command: 'jobline.gcode.play', speed });
      } else {
        btn.textContent = '▶ Play';
        btn.style.background = '#0e639c';
        vs.postMessage({ command: 'jobline.gcode.pause' });
      }
    });

    // Jump controls
    document.getElementById('jumpStartBtn').addEventListener('click', () => {
      isPlaying = false;
      document.getElementById('playPauseBtn').textContent = '▶ Play';
      document.getElementById('playPauseBtn').style.background = '#0e639c';
      vs.postMessage({ command: 'jobline.gcode.jumpToLine', arg: 0 });
    });

    document.getElementById('jumpEndBtn').addEventListener('click', () => {
      isPlaying = false;
      document.getElementById('playPauseBtn').textContent = '▶ Play';
      document.getElementById('playPauseBtn').style.background = '#0e639c';
      vs.postMessage({ command: 'jobline.gcode.jumpToLine', arg: 999999 });
    });

    // Step controls
    document.getElementById('stepBackBtn').addEventListener('click', () => {
      isPlaying = false;
      document.getElementById('playPauseBtn').textContent = '▶ Play';
      document.getElementById('playPauseBtn').style.background = '#0e639c';
      vs.postMessage({ command: 'jobline.gcode.stepBack' });
    });

    document.getElementById('stepFwdBtn').addEventListener('click', () => {
      isPlaying = false;
      document.getElementById('playPauseBtn').textContent = '▶ Play';
      document.getElementById('playPauseBtn').style.background = '#0e639c';
      vs.postMessage({ command: 'jobline.gcode.stepForward' });
    });

    // Group step controls (10 steps at a time)
    document.getElementById('stepGroupBackBtn').addEventListener('click', () => {
      for (let i = 0; i < 10; i++) {
        vs.postMessage({ command: 'jobline.gcode.stepBack' });
      }
    });

    document.getElementById('stepGroupFwdBtn').addEventListener('click', () => {
      for (let i = 0; i < 10; i++) {
        vs.postMessage({ command: 'jobline.gcode.stepForward' });
      }
    });

    // Speed slider
    document.getElementById('speedSlider').addEventListener('input', e => {
      const speed = parseFloat(e.target.value);
      document.getElementById('speedVal').textContent = speed.toFixed(1) + 'x';
    });

    document.getElementById('speedSlider').addEventListener('change', e => {
      const speed = parseFloat(e.target.value);
      vs.postMessage({ command: 'jobline.gcode.setSpeed', speed });
    });

    ['stock', 'fixture', 'jaws'].forEach(name => {
      const capName = name[0].toUpperCase() + name.slice(1);
      document.getElementById('manual' + capName).addEventListener('click', () => {
        const form = document.getElementById(name + 'Form');
        form.style.display = form.style.display === 'none' ? 'block' : 'none';
      });

      document.getElementById(name + 'Shape').addEventListener('change', e => {
        const boxDiv = document.getElementById(name + 'Box');
        const cylDiv = document.getElementById(name + 'Cyl');
        if (e.target.value === 'box') {
          boxDiv.style.display = 'block';
          cylDiv.style.display = 'none';
        } else {
          boxDiv.style.display = 'none';
          cylDiv.style.display = 'block';
        }
      });

      document.getElementById('import' + capName).addEventListener('change', e => {
        if (e.target.files[0]) loadSTL(e.target.files[0], name);
      });

      document.getElementById(name + 'Apply').addEventListener('click', () => {
        if (LAYERS[name].mesh) scene.remove(LAYERS[name].mesh);
        const shape = document.getElementById(name + 'Shape').value;
        if (shape === 'box') {
          const w = parseFloat(document.getElementById(name + 'W').value);
          const d = parseFloat(document.getElementById(name + 'D').value);
          const h = parseFloat(document.getElementById(name + 'H').value);
          const x = parseFloat(document.getElementById(name + 'X').value);
          const y = parseFloat(document.getElementById(name + 'Y').value);
          const z = parseFloat(document.getElementById(name + 'Z').value);
          LAYERS[name].mesh = createBoxMesh(w, h, d, x, y, z, name);
        } else {
          const r = parseFloat(document.getElementById(name + 'R').value);
          const h = parseFloat(document.getElementById(name + 'H2').value);
          const z = parseFloat(document.getElementById(name + 'Z2').value);
          LAYERS[name].mesh = createCylinderMesh(r, h, z, name);
        }
        LAYERS[name].mesh.visible = LAYERS[name].visible;
        scene.add(LAYERS[name].mesh);
      });
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'update') {
        // Update unit if provided
        if (msg.units) {
          setSceneUnit(msg.units);
        }

        // Update cutter size
        document.getElementById('cutterSize').textContent = msg.cutterSize ?? '-';

        // Update toolpath and visualization
        if (msg.path) {
          window._currentPath = msg.path;
          currentPathLength = msg.path.length;
          currentPathIdx = msg.highlightIdx ?? 0;
          window._currentPathIdx = currentPathIdx;

          drawToolpath(msg.path, currentPathIdx);
          drawCutTrail(msg.path, currentPathIdx);

          // Update current position tool
          if (currentPathIdx < msg.path.length) {
            const pt = msg.path[currentPathIdx];
            updateToolCylinder(pt, msg.cutterSize || 10);
          }

          // Update segment readout
          document.getElementById('segmentReadout').textContent =
            'Segment ' + (currentPathIdx + 1) + ' / ' + currentPathLength;

          // Check for M-stops and auto-pause if enabled
          if (currentPathIdx < msg.path.length) {
            const pt = msg.path[currentPathIdx];
            if (pt && pt.mStop && document.getElementById('mStopToggle').checked) {
              isPlaying = false;
              document.getElementById('playPauseBtn').textContent = '▶ Play';
              document.getElementById('playPauseBtn').style.background = '#0e639c';
              vs.postMessage({ command: 'jobline.gcode.pause' });
              showMStopNotice(pt.mStop);
            }
          }
        }
      }

      // Handle stock settings update
      if (msg.type === 'stockSettings') {
        handleStockSettings(msg);
      }

      // Handle tool data (dc → tool radius)
      if (msg.type === 'toolData' && msg.data && msg.data.dc) {
        window._toolRadius = msg.data.dc / 2;
        document.getElementById('cutterSize').textContent = msg.data.dc;
        if (window._currentPath && window._currentPathIdx > 1) {
          drawSweptTube(window._currentPath, window._currentPathIdx, window._toolRadius);
        }
      }

      // Handle stock origin
      if (msg.type === 'stockOrigin') {
        if (LAYERS.stock.mesh) {
          LAYERS.stock.mesh.position.set(msg.xOff || 0, (LAYERS.stock.mesh.geometry.parameters.height / 2) + (msg.zOff || 0), msg.yOff || 0);
        }
        if (window._originGizmo) scene.remove(window._originGizmo);
        const sphereGeom = new THREE.SphereGeometry(Math.max(1, (Math.abs(msg.xOff) + Math.abs(msg.yOff)) * 0.02), 12, 8);
        const sphereMat = new THREE.MeshBasicMaterial({ color: 0xff2222, depthTest: false });
        window._originGizmo = new THREE.Mesh(sphereGeom, sphereMat);
        window._originGizmo.position.set(0, 0, 0);
        scene.add(window._originGizmo);
      }

      // Handle layer visibility
      if (msg.type === 'layerToggle') {
        const layerMap = { tool: 'tool', toolHolder: 'toolHolder', stock: 'stock', path: 'path', sweptTube: 'sweptTube', origin: 'originGizmo' };
        const layer = layerMap[msg.layer];
        if (layer && LAYERS[layer]) {
          if (LAYERS[layer].mesh) LAYERS[layer].mesh.visible = msg.visible;
        } else if (msg.layer === 'sweptTube' && window._sweptTube) {
          window._sweptTube.visible = msg.visible;
        } else if (msg.layer === 'origin' && window._originGizmo) {
          window._originGizmo.visible = msg.visible;
        }
      }
    });

    initThree();
  </script>
  <div id="mStopNotice" style="display:none; position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:#8b3a3a; color:#fff; padding:12px 20px; border-radius:6px; font-weight:bold; z-index:1000; box-shadow:0 4px 12px rgba(0,0,0,0.5);">
  </div>
</body>
</html>
`;
  }
}
