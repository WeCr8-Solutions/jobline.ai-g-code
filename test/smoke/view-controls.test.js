/* eslint-env node, mocha */
/* global require, __dirname, setTimeout, suite, suiteSetup, test */

/**
 * View control and gnomon tests.
 *
 * The View panel and the gnomon were both shipped on the evidence of a single
 * screenshot: the panel had been seen collapsed and the gnomon had been seen
 * drawn once, static. Neither had been shown to DO anything.
 *
 * These drive the real controls - the same slider input events and checkbox
 * change events a person triggers - and assert the rendered result moves.
 */

const assert = require('node:assert/strict');
const path = require('path');
const vscode = require('vscode');

const workspaceRoot = path.resolve(__dirname, '..', '..');


const visualizerModulePath = path.join(workspaceRoot, 'out', 'src', 'providers', 'toolpathVisualizer.js');

function panelClass() {
  return require(visualizerModulePath).ToolpathVisualizerPanel;
}

async function delay(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

/** Open a program that declares stock, so every layer has something to draw. */
async function openVisualizer() {
  const fixture = vscode.Uri.file(path.join(workspaceRoot, 'test', 'fixtures', 'setup', 'vise-mill-stock.nc'));
  const document = await vscode.workspace.openTextDocument(fixture);
  await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
  await vscode.commands.executeCommand('jobline.openSimulation');

  const Panel = panelClass();
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (Panel.currentPanel && Panel.renderStatus.pathPoints > 1) break;
    await delay(100);
  }
  assert.ok(Panel.currentPanel, 'visualizer panel should open');
  await delay(800);
  return Panel;
}

suite('View controls and gnomon', function () {
  this.timeout(120000);

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension('WeCr8-Solutions.jobline-gcode');
    assert.ok(extension, 'JobLine extension must be discoverable');
    await extension.activate();
  });

  test('the gnomon tracks the camera', async () => {
    const Panel = await openVisualizer();

    const before = await Panel.requestVisualProbe(10000);
    assert.ok(before, 'no probe answer before orbit');
    assert.ok(before.gnomonTotal > 0, 'gnomon region was not sampled');
    assert.ok(before.gnomonLit > 0, 'gnomon drew nothing');

    // Orbit a long way, so the triad must visibly re-orient.
    Panel.sendControl({ type: 'orbitBy', dTheta: 2.1, dPhi: 0.6 });
    await delay(700);

    const after = await Panel.requestVisualProbe(10000);
    assert.ok(after, 'no probe answer after orbit');
    assert.notEqual(
      after.orbit.theta, before.orbit.theta,
      'orbit did not actually change - the test proves nothing'
    );
    assert.notEqual(
      after.gnomonLit, before.gnomonLit,
      `gnomon did not change with the camera: ${before.gnomonLit} lit before and after. ` +
      'A static or dead indicator looks identical to a working one in a screenshot.'
    );
    // eslint-disable-next-line no-console
    console.log(`      gnomon ${before.gnomonLit} -> ${after.gnomonLit} lit of ${before.gnomonTotal} sampled`);
  });

  test('the gnomon can be switched off and back on', async () => {
    const Panel = await openVisualizer();
    const on = await Panel.requestVisualProbe(10000);
    assert.ok(on.gnomonLit > 0, 'gnomon should be drawing to start');

    Panel.sendControl({ type: 'setLayerVisible', layer: '__gnomon__', visible: false });
    // The gnomon toggle is a plain checkbox rather than a layer, so drive it
    // through the same DOM the user clicks.
    Panel.sendControl({ type: 'gnomonVisible', visible: false });
    await delay(500);
    const off = await Panel.requestVisualProbe(10000);
    assert.equal(off.gnomonLit, 0, `gnomon still drew ${off.gnomonLit} pixels after being switched off`);

    Panel.sendControl({ type: 'gnomonVisible', visible: true });
    await delay(500);
    const back = await Panel.requestVisualProbe(10000);
    assert.ok(back.gnomonLit > 0, 'gnomon did not come back');
  });

  test('the opacity sliders change what is drawn', async () => {
    const Panel = await openVisualizer();
    const before = await Panel.requestVisualProbe(10000);
    assert.ok(before.litPixels > 0, 'nothing drawn to begin with');

    // Take the cut solid to fully transparent through the real slider.
    Panel.sendControl({ type: 'setViewOpacity', sliderId: 'op-tube', layer: 'sweptTube', value: 0 });
    await delay(600);
    const clear = await Panel.requestVisualProbe(10000);
    assert.equal(clear.opacity.sweptTube, 0, 'slider did not reach the material');
    assert.ok(
      clear.litPixels < before.litPixels,
      `making the cut solid transparent did not reduce coverage: ${before.litPixels} -> ${clear.litPixels}`
    );

    // And back to solid.
    Panel.sendControl({ type: 'setViewOpacity', sliderId: 'op-tube', layer: 'sweptTube', value: 1 });
    await delay(600);
    const solid = await Panel.requestVisualProbe(10000);
    assert.equal(solid.opacity.sweptTube, 1, 'slider did not return to solid');
    assert.ok(
      solid.litPixels > clear.litPixels,
      `restoring the cut solid did not increase coverage: ${clear.litPixels} -> ${solid.litPixels}`
    );
    // eslint-disable-next-line no-console
    console.log(`      cut solid  opaque ${solid.litPixels}  transparent ${clear.litPixels}`);
  });

  test('layer toggles hide and restore geometry', async () => {
    const Panel = await openVisualizer();
    const before = await Panel.requestVisualProbe(10000);

    Panel.sendControl({ type: 'setLayerVisible', layer: 'workholding', visible: false });
    Panel.sendControl({ type: 'setLayerVisible', layer: 'stock', visible: false });
    await delay(600);
    const hidden = await Panel.requestVisualProbe(10000);
    assert.ok(
      hidden.litPixels < before.litPixels,
      `hiding stock and jaws did not reduce coverage: ${before.litPixels} -> ${hidden.litPixels}`
    );

    Panel.sendControl({ type: 'setLayerVisible', layer: 'workholding', visible: true });
    Panel.sendControl({ type: 'setLayerVisible', layer: 'stock', visible: true });
    await delay(600);
    const shown = await Panel.requestVisualProbe(10000);
    assert.ok(
      shown.litPixels > hidden.litPixels,
      `restoring stock and jaws did not increase coverage: ${hidden.litPixels} -> ${shown.litPixels}`
    );
    // eslint-disable-next-line no-console
    console.log(`      stock+jaws shown ${shown.litPixels}  hidden ${hidden.litPixels}`);
  });
});
