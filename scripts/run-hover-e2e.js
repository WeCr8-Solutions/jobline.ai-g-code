/* eslint-env node */
/* global require, __dirname, process, console, fetch, WebSocket, setTimeout */

const fs = require('node:fs');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

const root = path.resolve(__dirname, '..');
const artifactDir = path.join(root, 'test-results', 'hover');
const debugPort = 9335;

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
  for (const id of ['hover-g1', 'hover-g83']) {
    const readyFile = path.join(artifactDir, `${id}.ready`);
    const capturedFile = path.join(artifactDir, `${id}.captured`);
    const screenshotFile = path.join(artifactDir, `${id}.png`);
    await waitForFile(readyFile, 90000);
    const target = await findWorkbenchTarget(30000);
    const png = await capturePage(target.webSocketDebuggerUrl);
    if (png.length < 10_000 || png.subarray(1, 4).toString('ascii') !== 'PNG') {
      throw new Error(`Captured ${id} hover image is invalid or unexpectedly small (${png.length} bytes)`);
    }
    fs.writeFileSync(screenshotFile, png);
    fs.writeFileSync(capturedFile, 'ok');
  }
}

async function main() {
  delete process.env.ELECTRON_RUN_AS_NODE;
  fs.mkdirSync(artifactDir, { recursive: true });
  for (const name of ['hover-g1.ready', 'hover-g1.captured', 'hover-g1.png', 'hover-g83.ready', 'hover-g83.captured', 'hover-g83.png']) {
    const file = path.join(artifactDir, name);
    if (fs.existsSync(file)) fs.rmSync(file);
  }

  const capture = captureWhenReady();
  const userDataDir = path.join(artifactDir, `vscode-profile-${process.pid}`);
  const tests = runTests({
    version: process.env.JOBLINE_VSCODE_TEST_VERSION || '1.96.4',
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'test', 'visual', 'runTestHover.js'),
    launchArgs: [root, '--disable-updates', '--skip-welcome', '--skip-release-notes', `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${debugPort}`],
    extensionTestsEnv: {
      JOBLINE_HOVER_ARTIFACT_DIR: artifactDir,
    },
  });

  await Promise.all([tests, capture]);
  console.log('Hover E2E screenshots: test-results/hover/hover-g1.png, test-results/hover/hover-g83.png');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
