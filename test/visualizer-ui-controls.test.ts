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
