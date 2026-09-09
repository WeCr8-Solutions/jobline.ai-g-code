/* eslint-env node, mocha */
/* global require, __dirname, setTimeout, suite, suiteSetup, test */

const assert = require('node:assert/strict');
const path = require('path');
const vscode = require('vscode');

const workspaceRoot = path.resolve(__dirname, '..', '..');
const visualizerModulePath = path.join(workspaceRoot, 'out', 'src', 'providers', 'toolpathVisualizer.js');

function fixturePath(...parts) {
  return path.join(workspaceRoot, 'test', 'fixtures', ...parts);
}

/**
 * The RevPak stem sample lives in test/fixtures/revpack/, which is gitignored
 * because it holds private shop programs. Three smoke tests opened it directly,
 * so on any machine without those files they failed with "Unable to resolve
 * nonexistent file" - meaning a clean clone could never get a clean smoke run,
 * and the release gate was only ever green on one desktop.
 *
 * These tests are about visualizer and diagnostics behaviour rather than that
 * specific program, so fall back to a public fixture instead of skipping. The
 * coverage then holds everywhere, and stays richer where the private file is
 * present.
 */
function sampleProgram() {
  const fsMod = require('node:fs');
  const revpack = fixturePath('revpack', 'stem umc sample.nc');
  return fsMod.existsSync(revpack)
    ? ['revpack', 'stem umc sample.nc']
    : ['diagnostics', 'clean-mill.nc'];
}

async function waitFor(condition, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await condition();
    if (value) {
      return value;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${label}`);
}

async function openFixture(...parts) {
  const uri = vscode.Uri.file(fixturePath(...parts));
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
  return document;
}

async function activateExtension() {
  const extension = vscode.extensions.getExtension('WeCr8-Solutions.jobline-gcode');
  assert.ok(extension, 'JobLine extension should be discoverable in the extension host');
  await extension.activate();
  return extension;
}

function getVisualizerPanelClass() {
  return require(visualizerModulePath).ToolpathVisualizerPanel;
}

suite('JobLine extension smoke', function () {
  this.timeout(120000);

  suiteSetup(async () => {
    await activateExtension();
    await vscode.workspace.getConfiguration().update('jobline.controlType', 'fanuc', vscode.ConfigurationTarget.Workspace);
  });

  test('opens the visualizer and keeps a live panel for the RevPak stem sample', async () => {
    await openFixture(...sampleProgram());

    await vscode.commands.executeCommand('jobline.gcode.showVisualizer');

    const ToolpathVisualizerPanel = getVisualizerPanelClass();
    await waitFor(() => ToolpathVisualizerPanel.currentPanel, 10000, 'visualizer panel creation');

    await vscode.commands.executeCommand('jobline.gcode.updateVisualizer');
    assert.ok(ToolpathVisualizerPanel.currentPanel, 'Visualizer panel should still be open after update');
  });

  test('sidebar navigation still targets the last G-code file after visualizer focus', async () => {
    const document = await openFixture(...sampleProgram());
    const initialLine = vscode.window.activeTextEditor.selection.active.line;

    await vscode.commands.executeCommand('jobline.gcode.showVisualizer');
    const ToolpathVisualizerPanel = getVisualizerPanelClass();
    await waitFor(() => ToolpathVisualizerPanel.currentPanel, 10000, 'visualizer panel reuse');

    await vscode.commands.executeCommand('jobline.sidebar.nextTool');
    await waitFor(
      () => vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.fsPath === document.uri.fsPath,
      5000,
      'sidebar tool navigation to reactivate fixture editor'
    );

    assert.equal(vscode.window.activeTextEditor.document.uri.fsPath, document.uri.fsPath);
    assert.notEqual(vscode.window.activeTextEditor.selection.active.line, initialLine, 'Sidebar tool navigation should move the cursor');

    await vscode.commands.executeCommand('jobline.sidebar.nextCycle');
    assert.equal(vscode.window.activeTextEditor.document.uri.fsPath, document.uri.fsPath);
  });

  test('toolbox navigation commands work while the visualizer owns focus', async () => {
    const document = await openFixture('fanuc', 'drill-pattern.nc');

    await vscode.commands.executeCommand('jobline.gcode.showVisualizer');
    const ToolpathVisualizerPanel = getVisualizerPanelClass();
    await waitFor(() => ToolpathVisualizerPanel.currentPanel, 10000, 'visualizer panel for toolbox navigation');

    await vscode.commands.executeCommand('jobline.toolbox.findNextToolChange');
    assert.equal(vscode.window.activeTextEditor.document.uri.fsPath, document.uri.fsPath);
    const toolLine = vscode.window.activeTextEditor.selection.active.line;
    assert.ok(toolLine >= 0, 'Toolbox tool-change navigation should place the cursor on a valid line');

    await vscode.commands.executeCommand('jobline.toolbox.findNextCannedCycle');
    assert.equal(vscode.window.activeTextEditor.document.uri.fsPath, document.uri.fsPath);
    assert.ok(vscode.window.activeTextEditor.selection.active.line >= toolLine, 'Toolbox canned-cycle navigation should move to a cycle line');
  });

  test('inspection surfaces detect macros and diagnostics on real fixtures', async () => {
    const macroDocument = await openFixture('fanuc', 'macro-bolt-circle.nc');
    await vscode.commands.executeCommand('jobline.sidebar.nextMacro');
    assert.equal(vscode.window.activeTextEditor.document.uri.fsPath, macroDocument.uri.fsPath);
    assert.ok(vscode.window.activeTextEditor.selection.active.line > 0, 'Macro navigation should move into macro flow lines');

    // Use a program known to contain violations. The RevPak sample is private,
    // so where it is absent this falls back to a public fixture that also trips
    // the inspector; the G83/Q assertion below only applies to RevPak.
    const usingRevpack = sampleProgram()[0] === 'revpack';
    const inspected = usingRevpack
      ? await openFixture('revpack', 'stem umc sample.nc')
      : await openFixture('crash-scenarios', 'multiple-violations.nc');

    const diagnostics = await waitFor(
      () => {
        const entries = vscode.languages.getDiagnostics(inspected.uri);
        return entries.length > 0 ? entries : undefined;
      },
      10000,
      'diagnostics to populate for the inspected program'
    );

    if (usingRevpack) {
      assert.ok(diagnostics.some(diagnostic => diagnostic.message.includes('G83 peck cycle requires Q')),
        'Expected RevPak fixture diagnostics to include the known G83/Q inspection finding');
    } else {
      assert.ok(diagnostics.length > 0,
        'Expected the violations fixture to produce diagnostics');
    }
  });

  // ---------------------------------------------------------------------------
  // Three.js rendering integrity — shop-floor readiness checks
  // ---------------------------------------------------------------------------
  test('three.min.js is bundled in the installed extension and is a valid JS file', async () => {
    const extension = vscode.extensions.getExtension('WeCr8-Solutions.jobline-gcode');
    assert.ok(extension, 'Extension must be installed');
    const threeFile = path.join(extension.extensionPath, 'media', 'three.min.js');
    const threeCoreFile = path.join(extension.extensionPath, 'media', 'three.core.min.js');
    const fs = require('node:fs');
    assert.ok(fs.existsSync(threeFile), `three.min.js must exist at ${threeFile}`);
    assert.ok(fs.existsSync(threeCoreFile), `three.core.min.js must exist at ${threeCoreFile}`);
    const stat = fs.statSync(threeFile);
    assert.ok(stat.size > 300_000, `three.min.js must be >300 KB, got ${stat.size} bytes`);
    // The bundled build is an ES module: it opens with a license comment and an
    // `import`, and re-exports the renderer from three.core.min.js. The old
    // check looked for THREE/export/function/var in the first 200 characters and
    // so failed on a perfectly good file - while never checking the thing that
    // actually breaks the visualizer.
    //
    // What matters is: the webview does `import * as THREE`, then guards on
    // THREE.WebGLRenderer. If the bundle stops exporting WebGLRenderer, or its
    // relative import of the core file breaks, the panel shows "Three.js failed
    // to load" - which is what shipped in 0.3.1.
    const source = fs.readFileSync(threeFile, 'utf8');
    assert.ok(
      /\bexport\s*\{/.test(source) || /\bimport\s*[{*]/.test(source),
      'three.min.js must be an ES module - the webview imports it with <script type="module">'
    );
    assert.ok(
      /\bas WebGLRenderer\b/.test(source) || /\bWebGLRenderer\s*(?:,|\})/.test(source),
      'three.min.js must export WebGLRenderer - the visualizer guards on THREE.WebGLRenderer and shows the load-failure banner without it'
    );
    assert.ok(
      source.includes('./three.core.min.js'),
      'three.min.js must import ./three.core.min.js, which has to sit beside it in media/'
    );

    // Keep the original loose shape check as a floor.
    const head = source.slice(0, 200);
    assert.ok(
      head.includes('THREE') || head.includes('export') || head.includes('import') || head.includes('function') || head.includes('var '),
      'three.min.js must look like valid JavaScript'
    );
  });

  test('visualizer HTML template is present in the installed extension', async () => {
    const extension = vscode.extensions.getExtension('WeCr8-Solutions.jobline-gcode');
    assert.ok(extension, 'Extension must be installed');
    const htmlFile = path.join(extension.extensionPath, 'media', 'toolpathVisualizerWebview.html');
    const fs = require('node:fs');
    assert.ok(fs.existsSync(htmlFile), `toolpathVisualizerWebview.html must exist at ${htmlFile}`);
    const html = fs.readFileSync(htmlFile, 'utf8');
    // Must contain the runtime placeholder (not the literal Three.js CDN URL)
    assert.ok(html.includes('{{THREE_JS_URI}}'), 'HTML must still have the {{THREE_JS_URI}} placeholder (not a hardcoded URL)');
    assert.ok(html.includes('{{CSP_SOURCE}}'), 'HTML must still have the {{CSP_SOURCE}} placeholder');
    // Must NOT have the module/classic split race pattern
    assert.ok(!html.includes('window.THREE = THREE'), 'window.THREE global must not be present — it causes a startup race');
    assert.ok(!html.includes("typeof THREE === 'undefined'"), 'Old typeof-THREE guard must be gone — unreliable with module scripts');
  });

  test('visualizer handles crash-scenario NC files without throwing', async () => {
    const crashFile = fixturePath('crash-scenarios', 'multiple-violations.nc');
    const fs = require('node:fs');
    assert.ok(fs.existsSync(crashFile), `Crash-scenario fixture must exist at ${crashFile}`);

    const document = await openFixture('crash-scenarios', 'multiple-violations.nc');
    assert.ok(document, 'Crash-scenario document must open');

    // Run the visualizer update on a known-bad file — must not throw or crash the extension host
    let threw = false;
    try {
      await vscode.commands.executeCommand('jobline.gcode.updateVisualizer');
    } catch (err) {
      threw = true;
    }
    assert.ok(!threw, 'updateVisualizer must not throw on a file with multiple G-code violations');

    // The extension host must still be alive (extension still active)
    const extension = vscode.extensions.getExtension('WeCr8-Solutions.jobline-gcode');
    assert.ok(extension?.isActive, 'Extension must still be active after processing a crash-scenario file');
  });

  test('visualizer state is replayed when panel is reopened', async () => {
    // Open a fixture and push an update into the visualizer
    await openFixture('fanuc', 'drill-pattern.nc');
    await vscode.commands.executeCommand('jobline.gcode.showVisualizer');

    const ToolpathVisualizerPanel = getVisualizerPanelClass();
    await waitFor(() => ToolpathVisualizerPanel.currentPanel, 8000, 'visualizer panel first open');
    await vscode.commands.executeCommand('jobline.gcode.updateVisualizer');

    // Dispose the panel to simulate closing
    ToolpathVisualizerPanel.currentPanel?._panel?.dispose();
    await waitFor(() => !ToolpathVisualizerPanel.currentPanel, 5000, 'visualizer panel disposed');

    // Reopen — state messages should replay without crashing
    await vscode.commands.executeCommand('jobline.gcode.showVisualizer');
    await waitFor(() => ToolpathVisualizerPanel.currentPanel, 8000, 'visualizer panel second open');

    assert.ok(ToolpathVisualizerPanel.currentPanel, 'Visualizer panel must reopen cleanly after dispose+reopen cycle');
  });
});
