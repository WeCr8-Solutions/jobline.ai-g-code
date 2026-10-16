import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'media', 'toolpathVisualizerWebview.html'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'scripts', 'run-visual-e2e.js'), 'utf8');
const visualTest = fs.readFileSync(path.join(root, 'test', 'visual', 'visualizer-screenshot.test.js'), 'utf8');
const provider = fs.readFileSync(path.join(root, 'src', 'providers', 'toolpathVisualizer.ts'), 'utf8');
const settingsProvider = fs.readFileSync(path.join(root, 'src', 'providers', 'visualizerSettingsProvider.ts'), 'utf8');
const extension = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('visualizer exposes operator controls for CAM-style review', () => {
  for (const id of ['program-select', 'play', 'pause', 'stop', 'step-back', 'step-forward', 'target-panel', 'import-target', 'target-list', 'target-role', 'target-opacity', 'target-x', 'target-y', 'target-z', 'stock-origin-preset', 'stock-home-x', 'stock-home-y', 'stock-home-z', 'stock-rot-x', 'stock-rot-y', 'stock-rot-z', 'view-cube']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} control is missing`);
  }
  for (const role of ['target-part', 'fixture', 'stock', 'jaws', 'tooling', 'holder', 'other']) {
    assert.match(html, new RegExp(`value="${role}"`), `${role} scene role is missing`);
  }
  assert.match(html, /id="target-display"/);
  for (const mode of ['solid', 'transparent', 'wireframe', 'hidden']) {
    assert.match(html, new RegExp(`value="${mode}"`), `${mode} target display mode is missing`);
  }
  for (const view of ['top', 'front', 'right', 'iso', 'xyz', 'zyx', 'yzx']) {
    assert.match(html, new RegExp(`data-view="${view}"`), `${view} preset view is missing`);
  }
  assert.match(html, /faceLabelTexture/);
  assert.match(html, /addCubeFace\('TOP'/);
  assert.match(html, /addCubeFace\('FRONT'/);
  assert.match(html, /addCubeFace\('RIGHT'/);
  for (const speed of ['0.25', '0.5', '1', '2', '4']) {
    assert.match(html, new RegExp(`data-speed="${speed}"`), `${speed} playback button is missing`);
  }
  assert.match(html, /axis-x/);
  assert.match(html, /axis-y/);
  assert.match(html, /axis-z/);
});

test('visualizer control messages exercise the same paths as user-facing controls', () => {
  assert.match(html, /case 'setPresetView'/);
  assert.match(html, /setPresetView\(msg\.view\)/);
  assert.match(html, /case 'setPlaybackSpeed'/);
  assert.match(html, /setPlaybackSpeed\(msg\.speed\)/);
  assert.match(html, /case 'setTargetOffset'/);
  assert.match(html, /case 'setTargetDisplayMode'/);
  assert.match(html, /case 'setActiveToolData'/);
  assert.match(html, /targetModels\.push/);
  assert.match(html, /targetCount/);
  assert.match(html, /activeTargetRole/);
  assert.match(html, /targetId/);
  assert.match(html, /buildTargetModel\(\)/);
  assert.match(html, /MeshPhongMaterial/);
  assert.match(html, /meshVertices/);
  assert.match(html, /buildTurningInsertTool/);
  assert.match(html, /function buildFusionReference/);
  assert.match(html, /data-layer="fusionReference"/);
  assert.match(html, /function buildMillingTool/);
  assert.match(html, /case 'toolLibrary'/);
  assert.match(html, /currentToolLibrary\.get\(Number\(b\.toolNumber\)\)/);
  assert.match(html, /insertOutlinePoints/);
  assert.match(html, /turningToolVisible/);
  assert.match(html, /function setLayerVisible\(layer, visible\)/);
  assert.match(html, /function applyStockTransform\(group\)/);
  assert.match(html, /rotX: stockRotation\.x/);
  assert.match(html, /setLayerVisible\(msg\.layer, msg\.visible\)/);
  assert.match(html, /Number\.isFinite\(Number\(item\.opacity\)\)/);
});

test('small viewports keep sidebar and playback controls reachable', () => {
  assert.match(settingsProvider, /overflow-y:\s*auto/);
  assert.match(settingsProvider, /<details class="settings-group"/);
  assert.match(settingsProvider, /<summary>Launch<\/summary>/);
  assert.match(settingsProvider, /@media \(max-width: 210px\)/);
  assert.match(html, /#playback-panel[^}]*max-height:\s*calc\(100vh - 16px\)/s);
  assert.match(html, /@media \(max-height: 520px\)/);
  assert.match(html, /#view-panel, #target-panel, #view-cube, #legend \{ display: none; \}/);
  assert.match(html, /<details id="target-panel"/);
  assert.doesNotMatch(html, /<details id="target-panel"[^>]*\sopen(?:\s|>)/);
});

test('playback highlights and reveals the correlated G-code source row', () => {
  assert.match(extension, /createTextEditorDecorationType/);
  assert.match(extension, /function highlightPlaybackSourceLine\(idx: number\)/);
  assert.match(extension, /point\?\.lineNumber \?\? followingPoint\?\.lineNumber/);
  assert.match(extension, /editor\.setDecorations\(playbackLineDecoration, \[range\]\)/);
  assert.match(extension, /TextEditorRevealType\.InCenterIfOutsideViewport/);
  assert.match(extension, /sendToolpathUpdate[\s\S]*highlightPlaybackSourceLine\(idx\)/);
});

test('extension contributes target-model import and multi-program visualizer commands', () => {
  const commands = new Set(pkg.contributes.commands.map((cmd: { command: string }) => cmd.command));
  assert.ok(commands.has('jobline.gcode.importTargetModel'));
  assert.ok(commands.has('jobline.gcode.openProgramInVisualizer'));
  assert.ok(commands.has('jobline.openSimulationFullWindow'));
  assert.match(provider, /\$\{typed\.type\}:\$\{/);
  assert.match(provider, /'programList'/);
  assert.match(provider, /'targetModel'/);
  assert.match(extension, /jobline\.gcode\.stop/);
  assert.match(extension, /canSelectMany:\s*true/);
  assert.match(extension, /is not a supported scene model/);
  assert.match(runner, /justin-fusion-g18/);
  assert.match(visualTest, /fusionWorkOffsetInferred/);
  assert.match(runner, /center-vise-jaws\.stl/);
  assert.match(extension, /ViewColumn\.One/);
});

test('visual screenshot matrix captures targeted regions, not full workbench screenshots', () => {
  for (const area of ['visualizer', 'gnomon-corner', 'target-panel', 'playback-panel', 'view-cube', 'tool-corner']) {
    assert.match(runner, new RegExp(area), `${area} screenshot crop is not configured`);
  }
  assert.match(runner, /CNMG432/);
  assert.match(runner, /VNMG331/);
  assert.match(runner, /setActiveToolData/);
  assert.match(runner, /setTargetDisplayMode/);
  assert.match(runner, /Page\.captureScreenshot/);
  assert.match(runner, /clip,/);
  assert.doesNotMatch(runner, /\$\{visualCase\.id\}\.png/);
  assert.match(visualTest, /\$\{visualCase\.id\}-\$\{area\}\.png/);
  assert.match(visualTest, /jobline\.gcode\.importTargetModel/);
  assert.match(runner, /multi-scene-vise-target/);
  assert.match(runner, /targetCountAtLeast:\s*5/);
  assert.match(runner, /test\/fixtures\/scene\/target-part\.stl/);
  assert.match(html, /case 'clearTargetModels'/);
  assert.match(html, /case 'resetVisualScene'/);
  assert.match(visualTest, /type: 'resetVisualScene'/);
  assert.doesNotMatch(runner, /jobline\.ai-CAM/);
});

test('per-object layer styles: every setup object, three styles, opacity, presets, session state', () => {
  const keys = html.match(/const OBJECT_KEYS = \[([^\]]+)\]/);
  assert.ok(keys, 'OBJECT_KEYS missing');
  assert.deepEqual(keys![1].split(',').map(k => k.trim().replace(/'/g, '')), ['stock', 'target', 'fixture', 'jaws', 'zeroPoint', 'tool', 'holder', 'toolpath']);
  for (const mode of ['Solid', 'Transparent', 'Wireframe']) assert.match(html, new RegExp(`<option value="${mode.toLowerCase()}">${mode}</option>`));
  assert.match(html, /<input type="range" min="5" max="100" aria-label="\$\{OBJECT_LABELS\[key\]\} opacity">/);
  for (const preset of ['all-solid', 'inspect', 'workholding']) assert.match(html, new RegExp(`data-layer-preset="${preset}"`));
  assert.match(html, />All solid</);
  assert.match(html, />Inspect part</);
  assert.match(html, />Workholding only</);
  // Defaults: stock 50% transparent, target solid inside it.
  assert.match(html, /stock: \{ visible: true, mode: 'transparent', opacity: 0\.5 \}/);
  assert.match(html, /target: \{ visible: true, mode: 'solid', opacity: 1 \}/);
  // Hardened jaws grey-blue, body darker, gripped region highlighted.
  assert.match(html, /fixture: '#4b5768', jaws: '#b3c0d1'/);
  assert.match(html, /grip: '#e05cff'/);
  // Display-only vise detail on the kernel envelopes: 6 mm-pitch serrated
  // teeth and screws on each jaw, spindle and guide rib on the body,
  // counterbores on the zero-point plate - added to every RevPack solid.
  assert.match(html, /const WH_DETAIL = \{ toothPitchMm: 6, toothHeightMm: 1\.2, screwDiaMm: 10 \}/);
  assert.match(html, /addWorkholdingDetail\(solid, item, '#' \+ shade\.getHexString\(\)\);/);
  for (const part of ['tooth', 'screw', 'centre spindle', 'guide rib', 'spindle end', 'counterbore']) assert.match(html, new RegExp('\\$\\{item\\.name\\} ' + part));
  // Detail meshes end in ' body' so the Wireframe style shows their edges, not their triangles.
  assert.match(html, /mesh\.name = name \+ ' detail body';/);
  // The riser is drawn a hair narrower so it does not z-fight the plate.
  assert.match(html, /if \(item\.role === 'riser'\) \{/);
  // Remembered for the session through the webview state.
  assert.match(html, /vscode\.setState\(Object\.assign\(\{\}, vscode\.getState\(\) \|\| \{\}, \{ objectStyles, layerPreset \}\)\)/);
  assert.match(html, /case 'setObjectStyle'/);
  assert.match(html, /case 'applyLayerPreset'/);
  // Existing modes stay: Solid / Wireframe / Target only / Compare.
  for (const id of ['btn-target-only', 'btn-compare']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /data-render-mode="solid"/);
  assert.match(html, /data-render-mode="wireframe"/);
});

test('an uploaded part gets its stock from the shared kernel\'s upload setup, around the part', async () => {
  const { uploadSetup } = await import('../src/providers/visualizer/revpack');
  const setup = uploadSetup('mm');
  const m = html.match(/const UPLOAD_STOCK_MM = \{ side: ([\d.]+), top: ([\d.]+), below: ([\d.]+), grip: ([\d.]+) \}/);
  assert.ok(m, 'UPLOAD_STOCK_MM missing');
  const [side, top, below, grip] = m!.slice(1).map(Number);
  const o = setup.stockOffsets!;
  assert.deepEqual([o.xMin, o.xMax, o.yMin, o.yMax], [side, side, side, side]);
  assert.equal(o.zMax, top);
  assert.equal(o.zMin, below);
  assert.equal(setup.gripDepth, grip);
  assert.match(html, /const upload = !stockIsDeclared && !isTurning \? uploadTarget\(\) : null;/);
});

test('the View panel re-stacks between the playback and RevPack panels', () => {
  assert.match(html, /function layoutSidePanels\(\)/);
  assert.match(html, /view\.style\.bottom = bottom \+ 'px';/);
  assert.match(html, /new ResizeObserver\(/);
  // Never observes the View panel it resizes (a ResizeObserver loop), and a benign loop notice never shows the error banner.
  assert.match(html, /for \(const id of \['playback-panel', 'revpack-panel'\]\) \{ const el = document\.getElementById\(id\); if \(el\) ro\.observe\(el\); \}/);
  assert.match(html, /if \(\/ResizeObserver loop\/\.test/);
  assert.match(html, /case 'setPanelOpen'/);
  assert.match(html, /case 'zoomBy'/);
  assert.match(html, /case 'panBy'/);
  // The depth range follows the view distance (no fixed 0.0001..1e6 z-fighting).
  assert.match(html, /const near = Math\.max\(1e-4, orbitRadius \/ 2000\);/);
  assert.match(html, /camera\.near = near; camera\.far = far; camera\.updateProjectionMatrix\(\);/);
});

test('the legend sits left of the view cube, not under its buttons', () => {
  const legend = html.match(/#legend \{\s*position: absolute; bottom: 8px; right: (\d+)px;/);
  const cube = html.match(/#view-cube \{\s*position: absolute; right: (\d+)px; bottom: \d+px; width: (\d+)px;/);
  assert.ok(legend && cube);
  assert.ok(Number(legend![1]) >= Number(cube![1]) + Number(cube![2]) + 8, 'legend overlaps the view cube column');
});
