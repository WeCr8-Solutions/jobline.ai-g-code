/* eslint-env node, mocha */
/* global require, __dirname, process, suite, test, setTimeout */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for screenshot capture: ${file}`);
}

suite('JobLine Plain Language explainer screenshot matrix', function () {
  this.timeout(120000);

  const explainerCases = JSON.parse(process.env.JOBLINE_EXPLAINER_CASES || '[]');
  for (const explainerCase of explainerCases) test(`renders ${explainerCase.id}`, async () => {
    const artifactDir = process.env.JOBLINE_EXPLAINER_ARTIFACT_DIR;
    assert.ok(artifactDir, 'JOBLINE_EXPLAINER_ARTIFACT_DIR must be supplied by the explainer runner');

    const root = path.resolve(__dirname, '..', '..');
    const fixture = vscode.Uri.file(path.join(root, ...explainerCase.fixture.split('/')));
    const extension = vscode.extensions.getExtension('WeCr8-Solutions.jobline-gcode');
    assert.ok(extension, 'JobLine extension must be discoverable');
    await extension.activate();

    const document = await vscode.workspace.openTextDocument(fixture);
    await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
    await vscode.commands.executeCommand('jobline.openExplainer');
    // The panel is plain HTML, no WebGL render loop to poll - give the webview a
    // fixed settle window rather than inventing a fake "ready" signal.
    await new Promise(resolve => setTimeout(resolve, 1500));

    const commands = await vscode.commands.getCommands(true);
    if (commands.includes('notifications.clearAll')) {
      await vscode.commands.executeCommand('notifications.clearAll');
    }
    await new Promise(resolve => setTimeout(resolve, 300));

    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(path.join(artifactDir, `${explainerCase.id}.ready`), 'ready');
    await waitForFile(path.join(artifactDir, `${explainerCase.id}.captured`), 60000);

    const screenshot = path.join(artifactDir, `${explainerCase.id}.png`);
    assert.ok(fs.existsSync(screenshot), 'Explainer screenshot should be retained as an artifact');
    assert.ok(fs.statSync(screenshot).size > 10_000, 'Explainer screenshot should contain rendered UI');
  });
});
