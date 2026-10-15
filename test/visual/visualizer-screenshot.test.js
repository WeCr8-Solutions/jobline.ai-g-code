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

async function applyVisualCaseControls(Panel, visualCase, document) {
  Panel.sendControl({ type: 'resetVisualScene' });
  await new Promise(resolve => setTimeout(resolve, 300));
  if (visualCase.revpack) {
    // Give the visualizer the room a user would: no Explorer, even split.
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
    await vscode.commands.executeCommand('workbench.action.evenEditorWidths');
    // The reset cleared the previous case's scene; re-open the program so the
    // extension auto-detects its RevPack again, exactly as a user opening it.
    await vscode.commands.executeCommand('jobline.gcode.openProgramInVisualizer', document.uri.toString());
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
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
    assert.ok(visualCase.targetFile, `Explicit targetFile required for ${visualCase.id}`);
    const targetFile = path.isAbsolute(visualCase.targetFile)
      ? path.resolve(visualCase.targetFile)
      : path.resolve(root, ...String(visualCase.targetFile).split('/'));
    assert.ok(fs.existsSync(targetFile), `Requested target model missing for ${visualCase.id}: ${targetFile}`);
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
      const targetOffsetOk = !expect.targetOffset || ['x', 'y', 'z'].every(axis => Math.abs((probe.activeTargetOffset?.[axis] ?? NaN) - expect.targetOffset[axis]) < 1e-6);
      const targetWidthOk = expect.targetWidth == null || Math.abs(((probe.activeTargetBounds?.maxX || 0) - (probe.activeTargetBounds?.minX || 0)) - expect.targetWidth) < 1e-6;
      const targetDepthOk = expect.targetDepth == null || Math.abs(((probe.activeTargetBounds?.maxY || 0) - (probe.activeTargetBounds?.minY || 0)) - expect.targetDepth) < 1e-6;
      const targetHeightOk = expect.targetHeight == null || Math.abs(((probe.activeTargetBounds?.maxZ || 0) - (probe.activeTargetBounds?.minZ || 0)) - expect.targetHeight) < 1e-6;
      const toolNumberOk = expect.activeToolNumber == null || probe.activeToolNumber === expect.activeToolNumber;
      const toolDiameterOk = expect.toolDiameter == null || Math.abs((probe.toolDiameter || 0) - expect.toolDiameter) < 1e-6;
      const toolVisibleOk = expect.toolVisible == null || probe.toolVisible === expect.toolVisible;
      const fusionPreviewOk = expect.fusionPreviewVisible == null || probe.fusionPreviewVisible === expect.fusionPreviewVisible;
      const fusionReferenceOk = expect.fusionReferenceVisible == null || probe.fusionReferenceVisible === expect.fusionReferenceVisible;
      if (insertOk && targetOk && targetCountOk && modeOk && speedOk && fusionOffsetOk && fusionInferredOk && fusionFixtureOk && stockOk && stockXOk && stockYOk && stockTopOk && targetNameOk && targetOffsetOk && targetWidthOk && targetDepthOk && targetHeightOk && toolNumberOk && toolDiameterOk && toolVisibleOk && fusionPreviewOk && fusionReferenceOk) return;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
}

/**
 * RevPack checks, run in the real extension host: the pack beside the program
 * was auto-detected, its badge is on the panel, every layer renders from the
 * pack in the requested mode (each layer drawn ALONE must light pixels), the
 * correlation reached the Problems panel and the findings list, and clicking a
 * finding moves the editor to that line.
 */
async function verifyRevPackCase(Panel, document, visualCase, artifactDir) {
  const rp = visualCase.revpack;
  const deadline = Date.now() + 40000;
  let probe;
  while (Date.now() < deadline) {
    probe = await Panel.requestVisualProbe(3000);
    // A STEP target arrives after OpenCascade has tessellated it.
    const stepOk = !rp.stepTarget || probe?.activeTargetLoader === 'step-occt';
    const modesOk = probe?.targetOnly === rp.targetOnly && probe?.compareMode === rp.compare;
    if (probe && probe.revpackId === rp.id && probe.renderMode === rp.mode && probe.sharedKernel?.packId === rp.id && probe.targetLoaded && stepOk && modesOk) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(probe?.revpackId, rp.id, `RevPack ${rp.id} was not auto-detected for ${visualCase.id}`);
  assert.equal(probe.revpackBadge, `RevPack: ${rp.name}`, 'RevPack badge is not shown on the panel');
  assert.equal(probe.renderMode, rp.mode, 'layer render mode did not apply');
  assert.equal(probe.sharedKernel.workholding, rp.workholding, 'every workholding solid must come from the shared kernel');
  assert.equal(probe.sharedKernel.tools, rp.tools, 'tool solids from the shared kernel');
  assert.equal(probe.sharedKernel.inProcess, rp.inProcess, 'in-process stock');
  assert.equal(probe.workholdingShapes, rp.workholding);
  // The finished part: the pack's own target, read through OpenCascade when it
  // is STEP, cross-checked against its STL, and visibly gold on screen with the
  // stock over it (pixels of the target hue in the composite frame).
  assert.equal(probe.activeTargetSource, 'revpack', 'target must be the pack target');
  if (rp.stepTarget) {
    assert.equal(probe.activeTargetLoader, 'step-occt', 'STEP target must load through OpenCascade');
    assert.ok(probe.targetStlCrossCheck?.ok, `STEP vs STL bounds disagree: ${JSON.stringify(probe.targetStlCrossCheck)}`);
  }
  const minTargetPixels = rp.mode === 'wireframe' ? 150 : 2500;
  assert.ok(probe.targetHuePixels >= minTargetPixels,
    `target not visibly distinguishable in ${rp.mode} for ${visualCase.id}: ${probe.targetHuePixels} gold pixels (< ${minTargetPixels})`);
  assert.equal(probe.targetOnly, rp.targetOnly, 'Target only toggle state');
  if (rp.compare) {
    assert.ok(probe.compareMode && probe.comparison, 'compare colouring is on');
    if (rp.clean) assert.equal(probe.comparison.gouge, 0, 'clean pack gouges the target');
  }
  if (rp.seeded) {
    assert.equal(probe.seededBanner, 'Seeded test pack: errors are intentional', 'seeded pack banner');
  } else {
    assert.equal(probe.seededBanner, '', 'only a seeded pack shows the seeded banner');
  }

  const layerProbe = await Panel.requestLayerProbe(15000);
  assert.ok(layerProbe && !layerProbe.error, `layer probe failed: ${layerProbe?.error}`);
  const results = {};
  const layersToCheck = rp.targetOnly ? ['targetModel'] : ['targetModel', 'stock', ...(rp.workholding ? ['workholding'] : []), 'tool', 'path'];
  if (rp.targetOnly) {
    for (const layer of ['stock', 'workholding', 'tool', 'path']) {
      assert.ok(!layerProbe.layers[layer]?.visible, `Target only must hide ${layer}`);
    }
  }
  for (const layer of layersToCheck) {
    const entry = layerProbe.layers[layer];
    results[layer] = entry;
    assert.ok(entry && entry.present && entry.visible, `${layer} layer missing in ${rp.mode} for ${visualCase.id}`);
    assert.ok(entry.litAlone > 0, `${layer} layer drew nothing on its own in ${rp.mode} for ${visualCase.id}`);
    if (layer === 'path') continue;
    if (rp.mode === 'wireframe') {
      assert.equal(entry.solidMeshes, 0, `${layer} still has shaded solids in wireframe mode (${visualCase.id})`);
      assert.ok(entry.lines > 0 || entry.wireframeMeshes > 0, `${layer} has no wireframe in ${visualCase.id}`);
    } else {
      assert.ok(entry.solidMeshes > 0, `${layer} has no shaded solid in solid mode (${visualCase.id})`);
    }
  }

  const diagnostics = vscode.languages.getDiagnostics(document.uri).filter(item => item.source === 'JobLine RevPack');
  const errors = diagnostics.filter(item => item.severity === vscode.DiagnosticSeverity.Error);
  if (rp.clean) assert.equal(errors.length, 0, `clean pack produced RevPack errors: ${errors.map(item => item.code).join(', ')}`);
  else assert.ok(errors.length > 0, 'seeded pack produced no RevPack error diagnostics');
  if (rp.seeded) {
    for (const item of diagnostics) assert.match(item.message, /Seeded test pack: errors are intentional/, 'every seeded finding says it is intentional');
  }
  // Everything in the Problems panel for this file, every source, so a
  // finding from the extension's own checks is not mistaken for the pack's.
  const allDiagnostics = vscode.languages.getDiagnostics(document.uri);
  assert.equal(probe.revpackFindingsRendered, diagnostics.length, 'findings list and Problems panel disagree');

  let clicked = null;
  if (diagnostics.length) {
    const first = diagnostics.find(item => item.severity === vscode.DiagnosticSeverity.Error) || diagnostics[0];
    const line1 = first.range.start.line + 1;
    Panel.sendControl({ type: 'clickRevPackFinding', line: line1 });
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      const editor = vscode.window.visibleTextEditors.find(item => item.document.uri.toString() === document.uri.toString());
      if (editor && editor.selection.active.line === first.range.start.line) { clicked = line1; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(clicked, line1, 'clicking a RevPack finding did not reveal its line');
  }
  if (rp.showProblems) {
    await vscode.commands.executeCommand('workbench.actions.view.problems');
    await new Promise(resolve => setTimeout(resolve, 600));
  }
  fs.writeFileSync(path.join(artifactDir, `${visualCase.id}.revpack.json`), JSON.stringify({
    id: visualCase.id, pack: rp.id, mode: rp.mode, badge: probe.revpackBadge, sharedKernel: probe.sharedKernel,
    findingsSummary: probe.revpackFindingsSummary, diagnostics: diagnostics.map(item => ({ line: item.range.start.line + 1, severity: item.severity, code: item.code, message: item.message })),
    clickToLine: clicked, layers: results,
    target: { loader: probe.activeTargetLoader, format: probe.activeTargetFormat, bounds: probe.activeTargetBounds, stlCrossCheck: probe.targetStlCrossCheck, huePixels: probe.targetHuePixels },
    targetOnly: probe.targetOnly, compareMode: probe.compareMode, comparison: probe.comparison, seededBanner: probe.seededBanner,
    canvas: { width: probe.width, height: probe.height },
    problemsPanel: allDiagnostics.map(item => ({ line: item.range.start.line + 1, severity: item.severity, source: item.source, code: typeof item.code === 'object' ? item.code.value : item.code, message: item.message })),
  }, null, 2));
}

/** AR4 real part, imported through the STEP (OpenCascade) or STL path, in solid or wireframe. */
async function verifyAr4Case(Panel, visualCase, artifactDir) {
  const a = visualCase.ar4;
  let probe;
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    probe = await Panel.requestVisualProbe(3000);
    if (probe?.targetLoaded && probe.targetDisplayMode === a.mode && probe.renderMode === a.mode) break;
    if (probe?.targetLoaded) {
      // A slow STEP can land after the mode controls; apply them again.
      Panel.sendControl({ type: 'setSceneRenderMode', mode: a.mode });
      Panel.sendControl({ type: 'setTargetDisplayMode', mode: a.mode });
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(probe?.targetLoaded, `AR4 ${a.part} (${a.format}) did not load`);
  assert.match(probe.activeTargetFormat || '', a.format === 'step' ? /^STEP/ : /^STL/, 'loaded through the requested path');
  const b = probe.activeTargetBounds;
  const want = a.golden.stl;
  const size = Math.max(...want.max.map((v, k) => v - want.min[k]));
  const tol = Math.max(0.05, size * 0.002);
  const got = [b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ];
  [...want.min, ...want.max].forEach((v, k) => assert.ok(Math.abs(got[k] - v) <= tol, `${a.part} ${a.format} bound ${k}: ${got[k]} vs ${v} (mm, part orientation)`));
  const layerProbe = await Panel.requestLayerProbe(15000);
  const entry = layerProbe?.layers?.targetModel;
  assert.ok(entry && entry.present && entry.litAlone > 0, `${a.part} drew nothing`);
  if (a.mode === 'wireframe') assert.equal(entry.solidMeshes, 0, `${a.part} still shaded in wireframe`);
  else assert.ok(entry.solidMeshes > 0, `${a.part} has no shaded solid`);
  fs.writeFileSync(path.join(artifactDir, `${visualCase.id}.ar4.json`), JSON.stringify({
    id: visualCase.id, part: a.part, format: probe.activeTargetFormat, mode: a.mode, bounds: b, expected: want, tolerance: tol,
    triangles: probe.activeTargetPointCount ? probe.activeTargetPointCount / 3 : null, layer: entry,
  }, null, 2));
}

async function verifyRevgripsSetup(Panel, document, artifactDir) {
  const steps = [];
  // G54 identifies the work coordinate system; its measured machine datum is
  // external to the NC file and must still be entered/verified at the machine.
  assert.match(document.getText(), /\bG54\b/i, 'RevGrips program must select G54');
  steps.push({ step: 'G54 program selection', ok: true });

  const loaded = await Panel.requestVisualProbe(30000);
  assert.equal(loaded?.activeTargetName, 'REVGRIPS STEM-50-35-PRO.x_t');
  assert.equal(loaded?.targetLoaded, true);
  steps.push({ step: 'Exact Parasolid target loaded', ok: true, target: loaded.activeTargetName });

  Panel.sendControl({ type: 'setTargetOffset', x: 0.125, y: -0.25, z: 0.375 });
  await new Promise(resolve => setTimeout(resolve, 300));
  const placed = await Panel.requestVisualProbe(30000);
  assert.deepEqual(placed?.activeTargetOffset, { x: 0.125, y: -0.25, z: 0.375 });
  steps.push({ step: 'Manual target XYZ placement', ok: true, offset: placed.activeTargetOffset });

  for (const [view, theta, phi] of [['top', 0, 0.0001], ['right', Math.PI / 2, Math.PI / 2], ['iso', Math.PI / 4, Math.PI / 3.5]]) {
    Panel.sendControl({ type: 'clickViewCube', view });
    await new Promise(resolve => setTimeout(resolve, 250));
    const probe = await Panel.requestVisualProbe(30000);
    assert.ok(probe?.orbit && Math.abs(probe.orbit.theta - theta) < 0.001 && Math.abs(probe.orbit.phi - phi) < 0.001,
      `ViewCube ${view} did not move the camera`);
    steps.push({ step: `ViewCube ${view}`, ok: true, orbit: probe.orbit });
  }

  Panel.sendControl({ type: 'setTargetOffset', x: 0, y: 0, z: 0 });
  await new Promise(resolve => setTimeout(resolve, 250));
  fs.writeFileSync(path.join(artifactDir, 'revgrips-setup-steps.json'), JSON.stringify(steps, null, 2));
}

suite('JobLine visualizer screenshot matrix', function () {
  this.timeout(120000);

  const visualCases = JSON.parse(process.env.JOBLINE_VISUAL_CASES || '[]');
  for (const visualCase of visualCases) test(`renders ${visualCase.id}`, async () => {
    try {
      await renderCase(visualCase);
    } catch (error) {
      // Tell the capture side this case will never be ready, with the reason,
      // so the runner reports it instead of timing out on the screenshot.
      const dir = process.env.JOBLINE_VISUAL_ARTIFACT_DIR;
      if (dir) fs.writeFileSync(path.join(dir, `${visualCase.id}.error`), String(error && error.stack || error));
      throw error;
    }
  });

  async function renderCase(visualCase) {
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
    if (visualCase.id === 'clean-mill') {
      await vscode.commands.executeCommand('workbench.view.extension.jobline-explorer');
    }
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

    await applyVisualCaseControls(ToolpathVisualizerPanel, visualCase, document);
    if (visualCase.revpack) {
      await verifyRevPackCase(ToolpathVisualizerPanel, document, visualCase, artifactDir);
    }
    if (visualCase.ar4) {
      await verifyAr4Case(ToolpathVisualizerPanel, visualCase, artifactDir);
    }
    if (visualCase.id === 'revgrips-stem-50-35-pro') {
      await verifyRevgripsSetup(ToolpathVisualizerPanel, document, artifactDir);
    }

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
    if (!visualCase.revpack && !visualCase.targetModel && !visualCase.targetFile && !visualCase.targetFiles?.length && !visualCase.externalTargetFile) {
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
    if (visualCase.expect?.targetName) {
      assert.equal(probe.activeTargetName, visualCase.expect.targetName, `Wrong target model rendered for ${visualCase.id}`);
    }
    if (visualCase.expect?.targetOffset) {
      for (const axis of ['x', 'y', 'z']) {
        assert.ok(Math.abs((probe.activeTargetOffset?.[axis] ?? NaN) - visualCase.expect.targetOffset[axis]) < 1e-6,
          `Target ${axis.toUpperCase()} placement did not apply for ${visualCase.id}`);
      }
    }
    for (const [axis, low, high] of [['targetWidth', 'minX', 'maxX'], ['targetDepth', 'minY', 'maxY'], ['targetHeight', 'minZ', 'maxZ']]) {
      if (visualCase.expect?.[axis] != null) {
        assert.ok(Math.abs(((probe.activeTargetBounds?.[high] ?? NaN) - (probe.activeTargetBounds?.[low] ?? NaN)) - visualCase.expect[axis]) < 1e-6,
          `${axis} of the imported model did not match for ${visualCase.id}`);
      }
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
  }
});
