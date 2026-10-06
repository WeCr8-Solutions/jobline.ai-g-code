/* eslint-env node, mocha */
/* global require, __dirname, process, suite, test, setTimeout */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

function firstExistingFile(files) {
  return files.find(file => fs.existsSync(file));
}

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for screenshot capture: ${file}`);
}

async function applyVisualCaseControls(Panel, visualCase) {
  Panel.sendControl({ type: 'resetVisualScene' });
  await new Promise(resolve => setTimeout(resolve, 300));
  if (visualCase.externalTargetFile) {
    const archive = fs.readFileSync(visualCase.externalTargetFile);
    assert.ok(archive.length > 4, 'Justin Fusion archive must not be empty');
    assert.equal(archive[0], 0x50, 'Fusion archive must begin with ZIP magic P');
    assert.equal(archive[1], 0x4b, 'Fusion archive must begin with ZIP magic K');
  }
  if (visualCase.targetFiles?.length) {
    const root = path.resolve(__dirname, '..', '..');
    for (const target of visualCase.targetFiles) {
      const targetFile = firstExistingFile([
        target.file && path.resolve(root, ...String(target.file).split('/')),
      ].filter(Boolean));
      assert.ok(targetFile, `Target model fixture must exist for ${visualCase.id}: ${target.file}`);
      await vscode.commands.executeCommand('jobline.gcode.importTargetModel', {
        uri: vscode.Uri.file(targetFile),
        role: target.role,
        targetId: target.targetId,
      });
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    await new Promise(resolve => setTimeout(resolve, 1200));
  } else if (!visualCase.externalTargetFile && (visualCase.targetModel || visualCase.targetFile)) {
    const root = path.resolve(__dirname, '..', '..');
    const targetFile = firstExistingFile([
      visualCase.targetFile && path.resolve(root, ...String(visualCase.targetFile).split('/')),
      path.resolve('C:/tmp/jobline-review/jobline.ai-CAM/src/renderer/public/fixtures/local/part.stl'),
      path.resolve('C:/tmp/jobline-review/jobline.ai-CAM/src/renderer/public/fixtures/rectangle-profile-goal.stl'),
      path.join(root, 'test', 'fixtures', 'cross-format', 'box.stl'),
    ].filter(Boolean));
    assert.ok(targetFile, 'A real STL/STP/Parasolid target model fixture must be available for visual testing');
    await vscode.commands.executeCommand('jobline.gcode.importTargetModel', vscode.Uri.file(targetFile));
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  if (visualCase.externalTargetFile) {
    await vscode.commands.executeCommand('jobline.gcode.importTargetModel', vscode.Uri.file(visualCase.externalTargetFile));
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  for (const control of visualCase.controls || []) {
    if (control.type === 'setActiveToolData') {
      Panel.queueMessage({ type: 'toolData', data: control.data });
    } else {
      Panel.sendControl(control);
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  const expect = visualCase.expect || {};
  if (expect.insertCode || expect.targetLoaded || expect.targetDisplayMode || expect.playbackSpeed != null || expect.targetCountAtLeast != null || expect.fusionWorkOffset) {
    const deadline = Date.now() + 8000;
    const activeToolControl = (visualCase.controls || []).find(control => control.type === 'setActiveToolData');
    while (Date.now() < deadline) {
      if (activeToolControl && expect.insertCode) {
        Panel.queueMessage({ type: 'toolData', data: activeToolControl.data });
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      const probe = await Panel.requestVisualProbe(2000);
      if (!probe) continue;
      const insertOk = !expect.insertCode || probe.insertCode === expect.insertCode;
      const targetOk = !expect.targetLoaded || probe.targetLoaded === true;
      const targetCountOk = expect.targetCountAtLeast == null || (probe.targetCount || 0) >= expect.targetCountAtLeast;
      const modeOk = !expect.targetDisplayMode || probe.targetDisplayMode === expect.targetDisplayMode;
      const speedOk = expect.playbackSpeed == null || probe.playbackSpeed === expect.playbackSpeed;
      const fusionOffsetOk = !expect.fusionWorkOffset || probe.fusionSetup?.workOffset?.code === expect.fusionWorkOffset;
      const fusionInferredOk = expect.fusionWorkOffsetInferred == null || probe.fusionSetup?.workOffset?.inferred === expect.fusionWorkOffsetInferred;
      const fusionFixtureOk = expect.fusionFixtureAssigned == null || probe.fusionSetup?.fixture?.assigned === expect.fusionFixtureAssigned;
      const stockOk = expect.stockWidth == null || Math.abs((probe.stock?.w || 0) - expect.stockWidth) < 1e-6;
      const stockXOk = expect.stockMinX == null || Math.abs((probe.stockOrigin?.x || 0) - expect.stockMinX) < 1e-6;
      const stockYOk = expect.stockMinY == null || Math.abs((probe.stockOrigin?.y || 0) - expect.stockMinY) < 1e-6;
      const stockTopOk = expect.stockTop == null || Math.abs(((probe.stockOrigin?.z || 0) + (probe.stock?.h || 0)) - expect.stockTop) < 1e-6;
      const targetNameOk = !expect.targetName || probe.activeTargetName === expect.targetName;
      const targetWidthOk = expect.targetWidth == null || Math.abs(((probe.activeTargetBounds?.maxX || 0) - (probe.activeTargetBounds?.minX || 0)) - expect.targetWidth) < 1e-6;
      const targetDepthOk = expect.targetDepth == null || Math.abs(((probe.activeTargetBounds?.maxY || 0) - (probe.activeTargetBounds?.minY || 0)) - expect.targetDepth) < 1e-6;
      const targetHeightOk = expect.targetHeight == null || Math.abs(((probe.activeTargetBounds?.maxZ || 0) - (probe.activeTargetBounds?.minZ || 0)) - expect.targetHeight) < 1e-6;
      const toolNumberOk = expect.activeToolNumber == null || probe.activeToolNumber === expect.activeToolNumber;
      const toolDiameterOk = expect.toolDiameter == null || Math.abs((probe.toolDiameter || 0) - expect.toolDiameter) < 1e-6;
      const toolVisibleOk = expect.toolVisible == null || probe.toolVisible === expect.toolVisible;
      const fusionPreviewOk = expect.fusionPreviewVisible == null || probe.fusionPreviewVisible === expect.fusionPreviewVisible;
      const fusionReferenceOk = expect.fusionReferenceVisible == null || probe.fusionReferenceVisible === expect.fusionReferenceVisible;
      if (insertOk && targetOk && targetCountOk && modeOk && speedOk && fusionOffsetOk && fusionInferredOk && fusionFixtureOk && stockOk && stockXOk && stockYOk && stockTopOk && targetNameOk && targetWidthOk && targetDepthOk && targetHeightOk && toolNumberOk && toolDiameterOk && toolVisibleOk && fusionPreviewOk && fusionReferenceOk) return;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
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
    const expectedModule = path.join(extension.extensionPath, 'out', 'src', 'providers', 'toolpathVisualizer.js').replace(/\\/g, '/').toLowerCase();
    // Windows drive casing can create a second CommonJS instance with empty static state.
    const loaded = Object.values(require.cache).find(item => item.filename.replace(/\\/g, '/').toLowerCase() === expectedModule && item.exports.ToolpathVisualizerPanel?.currentPanel);
    assert.ok(loaded, 'The activated extension must own the visualizer panel');
    const ToolpathVisualizerPanel = loaded.exports.ToolpathVisualizerPanel;
    // Wait for THIS case's program, not merely for "some" toolpath. The panel is
    // reused between cases, so a bare "pathPoints > 1" was satisfied instantly by
    // the previous case's render still on screen - case 2 measured case 1 and
    // case 3 measured case 2, and only the first case was ever really tested.
    const expected = visualCase.expectedPoints;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const status = ToolpathVisualizerPanel.renderStatus;
      const pointsReady = expected != null ? status.pathPoints === expected : status.pathPoints > 1;
      if (pointsReady && status.reviewRendered) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (expected != null) {
      assert.equal(
        ToolpathVisualizerPanel.renderStatus.pathPoints,
        expected,
        `Visualizer is showing a different program for ${visualCase.id}: expected ${expected} path points, got ${ToolpathVisualizerPanel.renderStatus.pathPoints}`
      );
    }
    if (visualCase.importOnly) {
      assert.equal(
        ToolpathVisualizerPanel.renderStatus.pathPoints,
        1,
        `Import-only case ${visualCase.id} must contain only the parser's origin seed and no motion segments`
      );
    } else {
      assert.ok(ToolpathVisualizerPanel.renderStatus.pathPoints > 1, 'Visualizer must render toolpath points before capture');
    }
    assert.ok(ToolpathVisualizerPanel.renderStatus.reviewRendered, 'Program review must render before capture');

    await applyVisualCaseControls(ToolpathVisualizerPanel, visualCase);

    // Those two only prove the DATA reached the webview - a dead GL context
    // still posts renderReady, and the screenshot below is of the whole
    // workbench, so the editor text alone clears its size check. Ask the render
    // loop what it actually drew.
    const probeTimeout = visualCase.expectedPoints > 100000 ? 30000 : 10000;
    const probe = await ToolpathVisualizerPanel.requestVisualProbe(probeTimeout);
    assert.ok(probe, `Visualizer did not answer the visual probe for ${visualCase.id}`);
    assert.ok(!probe.error, `Visual probe failed for ${visualCase.id}: ${probe.error}`);
    assert.ok(probe.width > 0 && probe.height > 0, `Visualizer canvas has no size for ${visualCase.id}`);
    assert.ok(
      probe.litRatio > 0.005,
      `Visualizer drew a blank scene for ${visualCase.id}: only ${probe.litPixels} of ${probe.sampledPixels} sampled pixels differ from the clear colour (${(probe.litRatio * 100).toFixed(3)}%)`
    );
    if (!visualCase.targetModel && !visualCase.targetFile && !visualCase.targetFiles?.length && !visualCase.externalTargetFile) {
      assert.equal(probe.targetLoaded, false, `G-code-only case ${visualCase.id} retained an unrelated target model`);
    }
    const commands = await vscode.commands.getCommands(true);
    if (commands.includes('notifications.clearAll')) {
      await vscode.commands.executeCommand('notifications.clearAll');
    }
    await new Promise(resolve => setTimeout(resolve, 500));

    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, `${visualCase.id}.ready`), 'ready');
    await waitForFile(path.join(artifactDir, `${visualCase.id}.captured`), 60000);

    if (visualCase.expect?.targetLoaded) {
      assert.equal(probe.targetLoaded, true, `Target model was not loaded for ${visualCase.id}`);
    }
    if (visualCase.expect?.targetCountAtLeast != null) {
      assert.ok(
        (probe.targetCount || 0) >= visualCase.expect.targetCountAtLeast,
        `Expected at least ${visualCase.expect.targetCountAtLeast} scene target(s) for ${visualCase.id}, got ${probe.targetCount || 0}`
      );
    }
    if (visualCase.expect?.targetOpacity != null) {
      assert.equal(
        Math.round((probe.opacity?.targetModel ?? -1) * 100),
        Math.round(visualCase.expect.targetOpacity * 100),
        `Target opacity did not apply for ${visualCase.id}`
      );
    }
    if (visualCase.expect?.targetDisplayMode) {
      assert.equal(probe.targetDisplayMode, visualCase.expect.targetDisplayMode, `Target display mode did not apply for ${visualCase.id}`);
    }
    if (visualCase.expect?.playbackSpeed != null) {
      assert.equal(probe.playbackSpeed, visualCase.expect.playbackSpeed, `Playback speed did not apply for ${visualCase.id}`);
    }
    if (visualCase.expect?.insertCode) {
      assert.equal(probe.insertCode, visualCase.expect.insertCode, `Insert code did not render for ${visualCase.id}`);
    }
    if (visualCase.expect?.turningToolVisible) {
      assert.equal(probe.turningToolVisible, true, `Turning insert tool was not visible for ${visualCase.id}`);
    }
    if (visualCase.expect?.programOptionsAtLeast != null) {
      assert.ok(
        probe.programOptions >= visualCase.expect.programOptionsAtLeast,
        `Program selector was not populated for ${visualCase.id}: ${probe.programOptions} option(s)`
      );
    }
    // eslint-disable-next-line no-console
    console.log(`      ${visualCase.id}: ${probe.litPixels}/${probe.sampledPixels} lit (${(probe.litRatio * 100).toFixed(2)}%), ${probe.pathPoints} path points, canvas ${probe.width}x${probe.height}, target=${!!probe.targetLoaded}, insert=${probe.insertCode || 'none'}, speed=${probe.playbackSpeed || 1}x`);

    for (const area of visualCase.captureAreas || ['visualizer']) {
      const screenshot = path.join(artifactDir, `${visualCase.id}-${area}.png`);
      assert.ok(fs.existsSync(screenshot), `Targeted ${area} screenshot should be retained as an artifact`);
      assert.ok(fs.statSync(screenshot).size > 500, `Targeted ${area} screenshot should contain rendered UI`);
    }
  });
});
