/* eslint-env node */
/* global require, __dirname, process, console, fetch, WebSocket, setTimeout */

const fs = require('node:fs');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

const root = path.resolve(__dirname, '..');
const artifactDir = path.join(root, 'test-results', 'visual');
const debugPort = 9333;
// expectedPoints pins each case to its OWN program. The panel is reused across
// cases, and the probe used to read whatever was still on screen: case 2
// reported case 1's 195 points and case 3 reported case 2's 17, so only the
// first case was ever really tested. Waiting for the expected count is what
// makes each case measure its own render.
const visualCases = [
  { id: 'clean-mill', fixture: 'test/fixtures/diagnostics/clean-mill.nc', expectedPoints: 195 },
  { id: 'unsafe-review', fixture: 'test/fixtures/crash-scenarios/multiple-violations.nc', expectedPoints: 17 },
  { id: 'lathe', fixture: 'test/fixtures/okuma/facing-od-rough.nc', expectedPoints: 13 },
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
  for (const visualCase of visualCases) {
    const readyFile = path.join(artifactDir, `${visualCase.id}.ready`);
    const capturedFile = path.join(artifactDir, `${visualCase.id}.captured`);
    const screenshotFile = path.join(artifactDir, `${visualCase.id}.png`);
    await waitForFile(readyFile, 90000);
    // Allow the WebGL render loop two frames after the fixture signals readiness.
    await delay(1000);
    const target = await findWorkbenchTarget(30000);
    const png = await capturePage(target.webSocketDebuggerUrl);
    if (png.length < 10_000 || png.subarray(1, 4).toString('ascii') !== 'PNG') {
      throw new Error(`Captured ${visualCase.id} image is invalid or unexpectedly small (${png.length} bytes)`);
    }
    fs.writeFileSync(screenshotFile, png);
    results.push({ ...visualCase, screenshot: path.relative(root, screenshotFile), bytes: png.length });
    fs.writeFileSync(capturedFile, 'ok');
  }
  fs.writeFileSync(path.join(artifactDir, 'visual-matrix.json'), JSON.stringify({
    capturedAt: new Date().toISOString(),
    cases: results,
  }, null, 2));
}

async function main() {
  delete process.env.ELECTRON_RUN_AS_NODE;
  fs.mkdirSync(artifactDir, { recursive: true });
  const protocolFiles = visualCases.flatMap(visualCase => [
    path.join(artifactDir, `${visualCase.id}.ready`),
    path.join(artifactDir, `${visualCase.id}.captured`),
    path.join(artifactDir, `${visualCase.id}.png`),
  ]);
  for (const file of [...protocolFiles, path.join(artifactDir, 'visual-matrix.json')]) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }

  const capture = captureWhenReady();
  const userDataDir = path.join(artifactDir, `vscode-profile-${process.pid}`);
  const tests = runTests({
    version: process.env.JOBLINE_VSCODE_TEST_VERSION || '1.96.4',
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'test', 'visual', 'runTest.js'),
    launchArgs: [root, '--disable-updates', '--skip-welcome', '--skip-release-notes', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${debugPort}`],
    extensionTestsEnv: {
      JOBLINE_VISUAL_ARTIFACT_DIR: artifactDir,
      JOBLINE_VISUAL_CASES: JSON.stringify(visualCases),
    },
  });

  await Promise.all([tests, capture]);
  console.log(`Visual E2E screenshots: ${visualCases.map(item => `${item.id}.png`).join(', ')}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
