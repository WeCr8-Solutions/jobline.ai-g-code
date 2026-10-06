/* eslint-env mocha */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for screenshot capture: ${file}`);
}

suite('JobLine hover card screenshot', function () {
  this.timeout(120000);

  const artifactDir = process.env.JOBLINE_HOVER_ARTIFACT_DIR || path.resolve(__dirname, '..', '..', 'test-results', 'hover');

  async function showHoverFor(pattern, id, label) {
    fs.mkdirSync(artifactDir, { recursive: true });
    const fixture = path.resolve(__dirname, '..', '..', 'samples', 'mill-comprehensive.nc');
    const document = await vscode.workspace.openTextDocument(fixture);
    const editor = await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });

    const targetLine = [...Array(document.lineCount).keys()]
      .find(line => pattern.test(document.lineAt(line).text));
    assert.notEqual(targetLine, undefined, `fixture should contain ${label} for the hover card`);

    const codeColumn = document.lineAt(targetLine).text.search(/G\d+/i);
    assert.ok(codeColumn >= 0, 'target line should expose the hovered G-code token column');
    const position = new vscode.Position(targetLine, codeColumn + 1);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    await delay(500);
    await vscode.commands.executeCommand('editor.action.showHover');
    await delay(2500);

    const readyFile = path.join(artifactDir, `${id}.ready`);
    const capturedFile = path.join(artifactDir, `${id}.captured`);
    fs.writeFileSync(readyFile, 'ready');
    await waitForFile(capturedFile, 90000);

    const screenshot = path.join(artifactDir, `${id}.png`);
    assert.ok(fs.existsSync(screenshot), 'Hover screenshot should be retained as an artifact');
    assert.ok(fs.statSync(screenshot).size > 10_000, 'Hover screenshot should contain rendered editor hover UI');
  }

  test('shows the JobLine natural-language hover inside the G-code editor', async () => {
    await showHoverFor(/G0?1\s+Z/i, 'hover-g1', 'a G1/G01 Z move');
  });

  test('shows a canned drilling cycle hover inside the G-code editor', async () => {
    await showHoverFor(/G83\b/i, 'hover-g83', 'a G83 peck drilling cycle');
  });
});
