/* eslint-env node, mocha */
/* global require, __dirname, process, suite, test, setTimeout */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
const visualizerModulePath = path.join(path.resolve(__dirname, '..', '..'), 'out', 'src', 'providers', 'toolpathVisualizer.js');

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for screenshot capture: ${file}`);
}

suite('JobLine visualizer screenshot matrix', function () {
  this.timeout(120000);

  const visualCases = JSON.parse(process.env.JOBLINE_VISUAL_CASES || '[]');
  for (const visualCase of visualCases) test(`renders ${visualCase.id}`, async () => {
    const artifactDir = process.env.JOBLINE_VISUAL_ARTIFACT_DIR;
    assert.ok(artifactDir, 'JOBLINE_VISUAL_ARTIFACT_DIR must be supplied by the visual runner');

    const root = path.resolve(__dirname, '..', '..');
    const fixture = vscode.Uri.file(path.join(root, ...visualCase.fixture.split('/')));
    const extension = vscode.extensions.getExtension('WeCr8-Solutions.jobline-gcode');
    assert.ok(extension, 'JobLine extension must be discoverable');
    await extension.activate();

    const document = await vscode.workspace.openTextDocument(fixture);
    await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
    await vscode.commands.executeCommand('jobline.openSimulation');
    const ToolpathVisualizerPanel = require(visualizerModulePath).ToolpathVisualizerPanel;
    // Wait for THIS case's program, not merely for "some" toolpath. The panel is
    // reused between cases, so a bare "pathPoints > 1" was satisfied instantly by
    // the previous case's render still on screen - case 2 measured case 1 and
    // case 3 measured case 2, and only the first case was ever really tested.
    const expected = visualCase.expectedPoints;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const status = ToolpathVisualizerPanel.renderStatus;
      const pointsReady = expected ? status.pathPoints === expected : status.pathPoints > 1;
      if (pointsReady && status.reviewRendered) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (expected) {
      assert.equal(
        ToolpathVisualizerPanel.renderStatus.pathPoints,
        expected,
        `Visualizer is showing a different program for ${visualCase.id}: expected ${expected} path points, got ${ToolpathVisualizerPanel.renderStatus.pathPoints}`
      );
    }
    assert.ok(ToolpathVisualizerPanel.renderStatus.pathPoints > 1, 'Visualizer must render toolpath points before capture');
    assert.ok(ToolpathVisualizerPanel.renderStatus.reviewRendered, 'Program review must render before capture');

    // Those two only prove the DATA reached the webview - a dead GL context
    // still posts renderReady, and the screenshot below is of the whole
    // workbench, so the editor text alone clears its size check. Ask the render
    // loop what it actually drew.
    const probe = await ToolpathVisualizerPanel.requestVisualProbe(10000);
    assert.ok(probe, `Visualizer did not answer the visual probe for ${visualCase.id}`);
    assert.ok(!probe.error, `Visual probe failed for ${visualCase.id}: ${probe.error}`);
    assert.ok(probe.width > 0 && probe.height > 0, `Visualizer canvas has no size for ${visualCase.id}`);
    assert.ok(
      probe.litRatio > 0.005,
      `Visualizer drew a blank scene for ${visualCase.id}: only ${probe.litPixels} of ${probe.sampledPixels} sampled pixels differ from the clear colour (${(probe.litRatio * 100).toFixed(3)}%)`
    );
    // eslint-disable-next-line no-console
    console.log(`      ${visualCase.id}: ${probe.litPixels}/${probe.sampledPixels} lit (${(probe.litRatio * 100).toFixed(2)}%), ${probe.pathPoints} path points, canvas ${probe.width}x${probe.height}`);
    const commands = await vscode.commands.getCommands(true);
    if (commands.includes('notifications.clearAll')) {
      await vscode.commands.executeCommand('notifications.clearAll');
    }
    await new Promise(resolve => setTimeout(resolve, 500));

    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, `${visualCase.id}.ready`), 'ready');
    await waitForFile(path.join(artifactDir, `${visualCase.id}.captured`), 60000);

    const screenshot = path.join(artifactDir, `${visualCase.id}.png`);
    assert.ok(fs.existsSync(screenshot), 'Visualizer screenshot should be retained as an artifact');
    assert.ok(fs.statSync(screenshot).size > 10_000, 'Visualizer screenshot should contain rendered UI');
  });
});
