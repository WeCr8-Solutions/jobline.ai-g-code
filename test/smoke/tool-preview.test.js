/* eslint-env node, mocha */
/* global require, __dirname, setTimeout, suite, suiteSetup, test */

/**
 * Tool Preview smoke tests.
 *
 * This panel had no coverage of any kind, and it is one of the two webviews
 * named in the "Three.js failed to load" report - so nothing proved it renders.
 * It is a separate renderer from the toolpath visualizer, with its own lights
 * and its own alpha:true context, so the visualizer passing says nothing about
 * it.
 *
 * The dropdown offers seven tool types. These walk all seven.
 */

const assert = require('node:assert/strict');
const path = require('path');
const vscode = require('vscode');

const workspaceRoot = path.resolve(__dirname, '..', '..');
const previewModulePath = path.join(workspaceRoot, 'out', 'src', 'providers', 'toolPreviewPanel.js');

const TOOL_TYPES = ['End Mill', 'Drill', 'Tap', 'Face Mill', 'Boring Bar', 'Lathe Insert', 'Custom'];

function getPanelClass() {
  return require(previewModulePath).ToolPreviewPanel;
}

async function delay(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

suite('Tool Preview', function () {
  this.timeout(120000);

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension('WeCr8-Solutions.jobline-gcode');
    assert.ok(extension, 'JobLine extension must be discoverable');
    await extension.activate();
  });

  test('opens and renders a tool', async () => {
    await vscode.commands.executeCommand('jobline.openToolPreview');
    const ToolPreviewPanel = getPanelClass();

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && !ToolPreviewPanel.instance) await delay(100);
    assert.ok(ToolPreviewPanel.instance, 'Tool Preview panel should open');

    // The panel is created with preserveFocus in a background column, and a
    // hidden webview has no layout size - so it must be revealed before it can
    // draw anything. This is the same path a user takes when the preview opens
    // behind another tab.
    ToolPreviewPanel.instance.reveal(undefined, false);
    await delay(2000);
    const probe = await ToolPreviewPanel.requestVisualProbe(10000);
    assert.ok(probe, 'Tool Preview did not answer the visual probe');
    assert.ok(!probe.error, `Tool Preview probe failed: ${probe.error}`);
    assert.ok(probe.width > 0 && probe.height > 0, 'Tool Preview canvas has no size');
    assert.ok(
      probe.litRatio > 0.005,
      `Tool Preview drew nothing: ${probe.litPixels}/${probe.sampledPixels} pixels have coverage`
    );
  });

  test('draws the real ISO insert shape from a designation', async () => {
    await vscode.commands.executeCommand('jobline.openToolPreview');
    const ToolPreviewPanel = getPanelClass();
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && !ToolPreviewPanel.instance) await delay(100);
    assert.ok(ToolPreviewPanel.instance, 'Tool Preview panel should open');
    ToolPreviewPanel.instance.reveal(undefined, false);
    await delay(2000);

    // A turner tells a C from a V by shape, so the two must not draw the same.
    const shapes = {};
    for (const code of ['CNMG432', 'VNGP331', 'TCMT32.51', 'RCMT1204', 'SNMG432']) {
      await ToolPreviewPanel.instance.webview.postMessage({ type: 'setInsertCode', code });
      await delay(900);
      const probe = await ToolPreviewPanel.requestVisualProbe(10000);
      assert.ok(probe, `no probe answer for ${code}`);
      assert.ok(probe.litRatio > 0.005, `${code} drew nothing`);
      shapes[code] = probe.litPixels;
      // eslint-disable-next-line no-console
      console.log(`      ${code.padEnd(11)} ${probe.litPixels}/${probe.sampledPixels}`);
    }
    assert.notEqual(shapes['CNMG432'], shapes['VNGP331'],
      'an 80 degree C and a 35 degree V must not draw the same silhouette');
    assert.notEqual(shapes['CNMG432'], shapes['RCMT1204'],
      'a rhombic and a round insert must not draw the same silhouette');
  });

  test('renders every tool type the dropdown offers', async () => {
    await vscode.commands.executeCommand('jobline.openToolPreview');
    const ToolPreviewPanel = getPanelClass();
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && !ToolPreviewPanel.instance) await delay(100);
    assert.ok(ToolPreviewPanel.instance, 'Tool Preview panel should open');
    ToolPreviewPanel.instance.reveal(undefined, false);
    await delay(2000);

    const seen = [];
    for (const toolType of TOOL_TYPES) {
      await ToolPreviewPanel.setToolType(toolType);
      await delay(700);
      const probe = await ToolPreviewPanel.requestVisualProbe(10000);
      assert.ok(probe, `no probe answer for ${toolType}`);
      assert.ok(!probe.error, `probe failed for ${toolType}: ${probe.error}`);
      assert.ok(
        probe.litRatio > 0.005,
        `${toolType} drew nothing: ${probe.litPixels}/${probe.sampledPixels} pixels have coverage`
      );
      seen.push({ toolType, lit: probe.litPixels, ratio: probe.litRatio });
      // eslint-disable-next-line no-console
      console.log(`      ${toolType.padEnd(13)} ${probe.litPixels}/${probe.sampledPixels} (${(probe.litRatio * 100).toFixed(2)}%)`);
    }

    // Types that render as identical silhouettes are worth knowing about: the
    // dropdown promises seven distinct tools. This does not fail the build,
    // because a generic cylinder is a deliberate fallback rather than a break -
    // it reports so the gap stays visible.
    const byShape = new Map();
    for (const s of seen) {
      const key = String(s.lit);
      if (!byShape.has(key)) byShape.set(key, []);
      byShape.get(key).push(s.toolType);
    }
    const duplicates = [...byShape.values()].filter(group => group.length > 1);
    if (duplicates.length) {
      // eslint-disable-next-line no-console
      console.log('      NOTE - types drawing an identical silhouette: ' +
        duplicates.map(g => g.join(' = ')).join('; '));
    }
  });
});
