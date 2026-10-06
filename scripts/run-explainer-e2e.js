/* eslint-env node */
/* global require, __dirname, process, console, fetch, WebSocket, setTimeout */

// Real screenshot of the Plain Language explainer panel, using the exact same
// mechanism as run-visual-e2e.js (a real VS Code Extension Development Host,
// CDP screenshot) rather than a standalone HTML reconstruction. A hand-rewritten
// HTML+headless-Edge copy of the panel was tried first and silently produced
// Edge's own "file not found" error page as the "screenshot" twice in a row -
// this avoids that whole failure class by driving the real webview instead of
// approximating it.

const fs = require('node:fs');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

const root = path.resolve(__dirname, '..');
const artifactDir = path.join(root, 'test-results', 'explainer');
const debugPort = 9334; // different from run-visual-e2e.js's 9333 so both can run independently

const explainerCases = [
  { id: 'explainer-mill', fixture: 'samples/mill-comprehensive.nc' },
  { id: 'explainer-lathe', fixture: 'samples/lathe-turning.nc' },
];

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${path.basename(file)}`);
}

async function findWorkbenchTarget(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const target = targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl);
      if (target) return target;
    } catch {
      // VS Code has not opened its debugging endpoint yet.
    }
    await delay(200);
  }
  throw new Error('Timed out waiting for the VS Code Chromium debugging target');
}

async function capturePage(webSocketDebuggerUrl) {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const requests = new Map();
    let nextId = 1;

    const call = (method, params = {}) => new Promise((resolveCall, rejectCall) => {
      const id = nextId++;
      requests.set(id, { resolve: resolveCall, reject: rejectCall });
      socket.send(JSON.stringify({ id, method, params }));
    });

    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !requests.has(message.id)) return;
      const request = requests.get(message.id);
      requests.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    socket.addEventListener('error', () => reject(new Error('Chromium screenshot connection failed')));
    socket.addEventListener('open', async () => {
      try {
        await call('Page.enable');
        await call('Runtime.evaluate', {
          expression: `(() => {
            const style = document.createElement('style');
            style.textContent = '.notifications-toasts, .notifications-center { display: none !important; }';
            document.head.appendChild(style);
          })()`,
        });
        const result = await call('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false,
          fromSurface: true,
        });
        socket.close();
        resolve(Buffer.from(result.data, 'base64'));
      } catch (error) {
        socket.close();
        reject(error);
      }
    });
  });
}

async function captureWhenReady() {
  const results = [];
  for (const explainerCase of explainerCases) {
    const readyFile = path.join(artifactDir, `${explainerCase.id}.ready`);
    const capturedFile = path.join(artifactDir, `${explainerCase.id}.captured`);
    const screenshotFile = path.join(artifactDir, `${explainerCase.id}.png`);
    await waitForFile(readyFile, 90000);
    const target = await findWorkbenchTarget(30000);
    const png = await capturePage(target.webSocketDebuggerUrl);
    if (png.length < 10_000 || png.subarray(1, 4).toString('ascii') !== 'PNG') {
      throw new Error(`Captured ${explainerCase.id} image is invalid or unexpectedly small (${png.length} bytes)`);
    }
    fs.writeFileSync(screenshotFile, png);
    results.push({ ...explainerCase, screenshot: path.relative(root, screenshotFile), bytes: png.length });
    fs.writeFileSync(capturedFile, 'ok');
  }
}

async function main() {
  delete process.env.ELECTRON_RUN_AS_NODE;
  fs.mkdirSync(artifactDir, { recursive: true });
  const protocolFiles = explainerCases.flatMap(c => [
    path.join(artifactDir, `${c.id}.ready`),
    path.join(artifactDir, `${c.id}.captured`),
    path.join(artifactDir, `${c.id}.png`),
  ]);
  for (const file of protocolFiles) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }

  const capture = captureWhenReady();
  const userDataDir = path.join(artifactDir, `vscode-profile-${process.pid}`);
  const tests = runTests({
    version: process.env.JOBLINE_VSCODE_TEST_VERSION || '1.96.4',
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'test', 'visual', 'runTestExplainer.js'),
    launchArgs: [root, '--disable-updates', '--skip-welcome', '--skip-release-notes', `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${debugPort}`],
    extensionTestsEnv: {
      JOBLINE_EXPLAINER_ARTIFACT_DIR: artifactDir,
      JOBLINE_EXPLAINER_CASES: JSON.stringify(explainerCases),
    },
  });

  await Promise.all([tests, capture]);
  console.log(`Explainer E2E screenshots: ${explainerCases.map(item => `${item.id}.png`).join(', ')}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
