import * as vscode from 'vscode';
import { ToolpathVisualizerPanel } from './toolpathVisualizer';
import { describeMachinePreset } from '../presets/jblMachine';
import { MachinePresetStore } from '../presets/presetStore';

export class VisualizerSettingsProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'jobline.visualizerSettings';

  private view: vscode.WebviewView | undefined;

  constructor(private readonly _extensionUri: vscode.Uri, private readonly store: MachinePresetStore) {}

  /** Send the preset list and the active preset's machine to the webview. */
  postPresets(): void {
    if (!this.view) return;
    const active = this.store.active()?.preset;
    void this.view.webview.postMessage({
      type: 'presets',
      activeId: active?.id ?? '',
      presets: this.store.list().map(entry => ({
        id: entry.preset.id,
        name: entry.preset.name,
        description: describeMachinePreset(entry.preset),
      })),
      active: active ? { machineKind: active.machineKind, units: active.units, capabilities: active.capabilities } : null,
    });
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.view = webviewView;
    webviewView.onDidDispose(() => { this.view = undefined; });
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getVisualizerSettingsHtml();

    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'ready') {
        this.postPresets();
        return;
      }
      if (msg.type === 'applyPreset' && typeof msg.id === 'string') {
        void vscode.commands.executeCommand('jobline.presets.apply', msg.id);
        return;
      }
      if (msg.command) {
        vscode.commands.executeCommand(msg.command, msg.arg);
        return;
      }
      if (
        msg.type === 'stockSettings' ||
        msg.type === 'stockOrigin' ||
        msg.type === 'layerToggle' ||
        msg.type === 'machineType' ||
        msg.type === 'machineCapabilities'
      ) {
        ToolpathVisualizerPanel.queueMessage(msg);
      }
    });
  }
}

const VISUALIZER_SETTINGS_STYLES = `
  :root {
    --bg: var(--vscode-sideBar-background, #252526);
    --fg: var(--vscode-foreground, #cccccc);
    --btn-bg: var(--vscode-button-background, #0e639c);
    --btn-fg: var(--vscode-button-foreground, #ffffff);
    --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
    --btn2-bg: transparent;
    --btn2-border: var(--vscode-widget-border, #454545);
    --btn2-hover: var(--vscode-sideBarSectionHeader-background, #2d2d2d);
    --input-bg: var(--vscode-input-background, #3c3c3c);
    --input-fg: var(--vscode-input-foreground, #cccccc);
    --input-border: var(--vscode-input-border, #3c3c3c);
    --sec-bg: var(--vscode-sideBarSectionHeader-background, #2d2d2d);
    --sec-fg: var(--vscode-sideBarSectionHeader-foreground, #bbb);
    --border: var(--vscode-widget-border, #454545);
    --hint-fg: var(--vscode-descriptionForeground, #999);
    --font: var(--vscode-font-family, sans-serif);
    --fs: var(--vscode-font-size, 13px);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; min-width: 0; height: 100%; }
  body {
    background: var(--bg); color: var(--fg); font-family: var(--font); font-size: var(--fs);
    overflow-x: hidden; overflow-y: auto; scrollbar-gutter: stable;
  }
  .settings-group { min-width: 0; border: 0; }
  .settings-group > summary {
    background: var(--sec-bg); color: var(--sec-fg);
    font-size: 0.78em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
    padding: 6px 8px; border-top: 1px solid var(--border); user-select: none;
    cursor: pointer; position: sticky; top: 0; z-index: 1;
  }
  .settings-group > summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .sec { padding: 8px; display: flex; min-width: 0; flex-direction: column; gap: 6px; }
  .row { display: flex; min-width: 0; gap: 6px; align-items: center; }
  .row label { font-size: 0.82em; min-width: 5.5em; color: var(--hint-fg); }
  .caps { font-size: 0.75em; color: var(--hint-fg); margin-top: 4px; }
  .caps label,
  .layer-toggle { font-size: 0.82em; display: flex; gap: 4px; align-items: center; }
  .origin-apply { margin-top: 6px; }
  .select-input {
    flex: 1; background: var(--input-bg); color: var(--input-fg);
    border: 1px solid var(--input-border); border-radius: 3px; padding: 3px 5px; font-size: var(--fs);
  }
  .origin-custom { display: block; }
  input[type=number] {
    background: var(--input-bg); color: var(--input-fg);
    border: 1px solid var(--input-border); border-radius: 3px;
    padding: 3px 5px; flex: 1; min-width: 0;
    font-size: var(--fs); font-family: var(--font);
  }
  input[type=color] {
    width: 32px; height: 28px; border: 1px solid var(--border);
    background: var(--input-bg); cursor: pointer; border-radius: 3px;
  }
  button {
    background: var(--btn-bg); color: var(--btn-fg);
    border: none; border-radius: 3px; padding: 5px 10px;
    cursor: pointer; font-size: var(--fs); font-family: var(--font);
    width: 100%; text-align: left;
  }
  button:hover { background: var(--btn-hover); }
  button.sec { background: var(--btn2-bg); color: var(--fg); border: 1px solid var(--btn2-border); text-align: center; }
  button.sec:hover { background: var(--btn2-hover); }
  button.sec.active {
    background: var(--btn-bg); color: var(--btn-fg); border-color: var(--btn-bg);
  }
  .unit-row { display: flex; gap: 4px; }
  .unit-row button { flex: 1; text-align: center; }
  @media (max-width: 210px) {
    .row { align-items: stretch; flex-direction: column; }
    .row label { min-width: 0; }
    .unit-row { flex-direction: column; }
  }
`;

const VISUALIZER_SETTINGS_SCRIPT = `
  const vs = acquireVsCodeApi();
  let currentUnit = 'in';

  function launchToolPreview() { vs.postMessage({ command: 'jobline.openToolPreview' }); }
  function launchSimulation() { vs.postMessage({ command: 'jobline.openSimulation' }); }
  function changeMachine() {
    const machine = document.getElementById('machineType').value;
    vs.postMessage({ type: 'machineType', machineType: machine });
  }
  function applyPreset() {
    const id = document.getElementById('presetSelect').value;
    if (id) vs.postMessage({ type: 'applyPreset', id });
  }
  function switchPreset() { vs.postMessage({ command: 'jobline.presets.switch' }); }
  function newPreset() { vs.postMessage({ command: 'jobline.presets.create' }); }
  function renderPresets(msg) {
    const select = document.getElementById('presetSelect');
    select.textContent = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = msg.activeId ? '— choose a machine —' : '— no preset (individual settings) —';
    select.appendChild(none);
    for (const preset of msg.presets) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name;
      option.title = preset.description;
      select.appendChild(option);
    }
    select.value = msg.activeId || '';
    const hint = document.getElementById('presetHint');
    const current = msg.presets.find(p => p.id === msg.activeId);
    hint.textContent = current ? current.description : 'Pick a saved machine so control, machine type and units are set for every program.';
    if (!msg.active) return;
    const kind = document.getElementById('machineType');
    if (Array.from(kind.options).some(o => o.value === msg.active.machineKind || o.text === msg.active.machineKind)) {
      kind.value = msg.active.machineKind;
    }
    const caps = msg.active.capabilities || {};
    document.getElementById('capLiveTool').checked = !!caps.liveTooling;
    document.getElementById('capProbing').checked = !!caps.probing;
    document.getElementById('cap4thAxis').checked = !!caps.fourthAxis;
    document.getElementById('cap5thAxis').checked = !!caps.fiveAxisSimultaneous;
    setUnit(msg.active.units === 'metric' ? 'mm' : 'in');
  }
  window.addEventListener('message', event => {
    if (event.data && event.data.type === 'presets') renderPresets(event.data);
  });
  function updateCaps() {
    const caps = {
      liveTool: document.getElementById('capLiveTool').checked,
      probing: document.getElementById('capProbing').checked,
      fourthAxis: document.getElementById('cap4thAxis').checked,
      fifthAxis: document.getElementById('cap5thAxis').checked,
    };
    vs.postMessage({ type: 'machineCapabilities', value: caps });
  }
  function openViz() { vs.postMessage({ command: 'jobline.gcode.showVisualizer' }); }
  function setUnit(unit) {
    currentUnit = unit;
    document.getElementById('unitIn').classList.toggle('active', unit === 'in');
    document.getElementById('unitMm').classList.toggle('active', unit === 'mm');
  }
  function applyStock() {
    const w = parseFloat(document.getElementById('stockW').value) || 4;
    const d = parseFloat(document.getElementById('stockD').value) || 4;
    const h = parseFloat(document.getElementById('stockH').value) || 2;
    const color = document.getElementById('stockColor').value;
    vs.postMessage({ type: 'stockSettings', w, d, h, unit: currentUnit, color });
  }
  function onOriginPresetChange() {
    const preset = document.getElementById('originPreset').value;
    const w = parseFloat(document.getElementById('stockW').value) || 4;
    const d = parseFloat(document.getElementById('stockD').value) || 4;
    const h = parseFloat(document.getElementById('stockH').value) || 2;
    if (preset === 'cornerFL') {
      document.getElementById('originX').value = String(w / 2);
      document.getElementById('originY').value = String(d / 2);
      document.getElementById('originZ').value = '0';
    } else if (preset === 'centerTop') {
      document.getElementById('originX').value = '0';
      document.getElementById('originY').value = '0';
      document.getElementById('originZ').value = '0';
    } else if (preset === 'centerBottom') {
      document.getElementById('originX').value = '0';
      document.getElementById('originY').value = '0';
      document.getElementById('originZ').value = String(-h);
    }
  }
  function applyOrigin() {
    const preset = document.getElementById('originPreset').value;
    const xOff = parseFloat(document.getElementById('originX').value) || 0;
    const yOff = parseFloat(document.getElementById('originY').value) || 0;
    const zOff = parseFloat(document.getElementById('originZ').value) || 0;
    const rotX = parseFloat(document.getElementById('originRotX').value) || 0;
    const rotY = parseFloat(document.getElementById('originRotY').value) || 0;
    const rotZ = parseFloat(document.getElementById('originRotZ').value) || 0;
    vs.postMessage({ type: 'stockOrigin', preset, xOff, yOff, zOff, rotX, rotY, rotZ });
  }
  function toggleLayer(layer) {
    const checked = document.getElementById('cb' + layer.charAt(0).toUpperCase() + layer.slice(1)).checked;
    vs.postMessage({ type: 'layerToggle', layer, visible: checked });
  }
  vs.postMessage({ type: 'ready' });
`;

const VISUALIZER_LAUNCH_SECTION = `
<details class="settings-group" open><summary>Launch</summary>
<div class="sec">
  <button onclick="launchToolPreview()">🔧 Tools Preview</button>
  <button onclick="launchSimulation()">▶ Open Simulation</button>
</div></details>`;

const VISUALIZER_MACHINE_SECTION = `
<details class="settings-group" open><summary>Machine</summary>
<div class="sec">
  <select id="presetSelect" class="select-input" onchange="applyPreset()" aria-label="Machine preset"></select>
  <div id="presetHint" class="caps"></div>
  <div class="unit-row">
    <button class="sec" onclick="switchPreset()">Switch…</button>
    <button class="sec" onclick="newPreset()">New…</button>
  </div>
  <div class="caps">Visualizer override (this session only)</div>
  <select id="machineType" class="select-input" onchange="changeMachine()" aria-label="Machine type override">
    <option>3-Axis Vertical Mill</option>
    <option>4-Axis Mill</option>
    <option>5-Axis Mill (Trunnion)</option>
    <option>5-Axis Mill (Rotary Table)</option>
    <option>Turn Center (2-Axis)</option>
    <option>5-Axis Mill-Turn</option>
    <option>Multi-Spindle Transfer</option>
    <option>Grinding Center</option>
  </select>
  <div class="caps">
    <label><input type="checkbox" id="capLiveTool" onchange="updateCaps()"> Live Tool</label>
    <label><input type="checkbox" id="capProbing" onchange="updateCaps()"> Probing</label>
    <label><input type="checkbox" id="cap4thAxis" onchange="updateCaps()"> 4th Axis</label>
    <label><input type="checkbox" id="cap5thAxis" onchange="updateCaps()"> 5th Axis</label>
  </div>
</div></details>`;

const VISUALIZER_OPEN_SECTION = `
<details class="settings-group" open><summary>Visualizer</summary>
<div class="sec">
  <button onclick="openViz()">👁️ Open 3D Visualizer</button>
</div></details>`;

const VISUALIZER_STOCK_SECTION = `
<details class="settings-group" open><summary>Stock Dimensions</summary>
<div class="sec">
  <div class="unit-row">
    <button class="sec active" id="unitIn" onclick="setUnit('in')">Inches (in)</button>
    <button class="sec" id="unitMm" onclick="setUnit('mm')">Metric (mm)</button>
  </div>
  <div class="row"><label>Width (X)</label><input type="number" id="stockW" value="4" step="0.001" min="0.001"></div>
  <div class="row"><label>Depth (Y)</label><input type="number" id="stockD" value="4" step="0.001" min="0.001"></div>
  <div class="row"><label>Height (Z)</label><input type="number" id="stockH" value="2" step="0.001" min="0.001"></div>
  <div class="row">
    <label>Color</label>
    <input type="color" id="stockColor" value="#4488ff">
  </div>
  <button onclick="applyStock()">Apply to Visualizer</button>
</div></details>`;

const VISUALIZER_ORIGIN_SECTION = `
<details class="settings-group" open><summary>Stock Origin (WCS Zero)</summary>
<div class="sec">
  <div class="row">
    <label>Preset</label>
    <select id="originPreset" onchange="onOriginPresetChange()" class="select-input">
      <option value="cornerFL">Corner (X0 Y0 at front-left)</option>
      <option value="centerTop">Center top</option>
      <option value="centerBottom">Center bottom</option>
      <option value="custom">Custom</option>
    </select>
  </div>
  <div id="originCustom" class="origin-custom">
    <div class="row"><label>X home</label><input type="number" id="originX" value="2" step="0.001"></div>
    <div class="row"><label>Y home</label><input type="number" id="originY" value="2" step="0.001"></div>
    <div class="row"><label>Z home</label><input type="number" id="originZ" value="0" step="0.001"></div>
    <div class="row"><label>Rotate X</label><input type="number" id="originRotX" value="0" step="1"></div>
    <div class="row"><label>Rotate Y</label><input type="number" id="originRotY" value="0" step="1"></div>
    <div class="row"><label>Rotate Z</label><input type="number" id="originRotZ" value="0" step="1"></div>
  </div>
  <button class="origin-apply" onclick="applyOrigin()">Apply Origin</button>
</div></details>`;

const VISUALIZER_LAYER_SECTION = `
<details class="settings-group"><summary>Layer Filters</summary>
<div class="sec">
  <label class="layer-toggle"><input type="checkbox" id="cbTool" checked onchange="toggleLayer('tool')"> Tool</label>
  <label class="layer-toggle"><input type="checkbox" id="cbToolHolder" checked onchange="toggleLayer('toolHolder')"> Tool Holder</label>
  <label class="layer-toggle"><input type="checkbox" id="cbStock" checked onchange="toggleLayer('stock')"> Stock</label>
  <label class="layer-toggle"><input type="checkbox" id="cbPath" checked onchange="toggleLayer('path')"> Toolpath</label>
  <label class="layer-toggle"><input type="checkbox" id="cbSweptTube" checked onchange="toggleLayer('sweptTube')"> Swept Tube</label>
  <label class="layer-toggle"><input type="checkbox" id="cbOrigin" checked onchange="toggleLayer('origin')"> Origin Marker</label>
</div></details>`;

function getVisualizerSettingsHtml(): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\';">',
    `<style>${VISUALIZER_SETTINGS_STYLES}</style>`,
    '</head>',
    '<body>',
    VISUALIZER_LAUNCH_SECTION,
    VISUALIZER_MACHINE_SECTION,
    VISUALIZER_OPEN_SECTION,
    VISUALIZER_STOCK_SECTION,
    VISUALIZER_ORIGIN_SECTION,
    VISUALIZER_LAYER_SECTION,
    `<script>${VISUALIZER_SETTINGS_SCRIPT}</script>`,
    '</body>',
    '</html>',
  ].join('');
}

export function registerVisualizerSettings(context: vscode.ExtensionContext, store: MachinePresetStore): void {
  const provider = new VisualizerSettingsProvider(context.extensionUri, store);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VisualizerSettingsProvider.viewId, provider),
    store.onDidChange(() => provider.postPresets()),
  );
}
