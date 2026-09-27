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
  // These two declare STOCK, which is what makes the stock box and the jaws
  // appear at all. Without a case that declares it, both features render only
  // in theory - no fixture in the repo triggered them.
  { id: 'vise-jaws', fixture: 'test/fixtures/setup/vise-mill-stock.nc', expectedPoints: 16 },
  {
    id: 'chuck-jaws',
    fixture: 'test/fixtures/setup/chuck-lathe-stock.nc',
    expectedPoints: 13,
    captureAreas: ['visualizer', 'tool-corner'],
    controls: [
      { type: 'setActiveToolData', data: { toolNumber: 1, type: 'turning', insertCode: 'CNMG432', diameter: 0.5, stickOut: 1.25, length: 3, holder: 'OD Turning Holder', color: '#f6c85f' } },
    ],
    expect: { insertCode: 'CNMG432', turningToolVisible: true },
  },
  {
    id: 'vnmg-insert',
    fixture: 'test/fixtures/setup/chuck-lathe-stock.nc',
    expectedPoints: 13,
    captureAreas: ['visualizer', 'tool-corner'],
    controls: [
      { type: 'setActiveToolData', data: { toolNumber: 2, type: 'turning', insertCode: 'VNMG331', diameter: 0.375, stickOut: 1.1, length: 3, holder: 'Profile Turning Holder', color: '#ffcf5a' } },
      { type: 'setPresetView', view: 'front' },
    ],
    expect: { insertCode: 'VNMG331', turningToolVisible: true },
  },
  // Operator-facing view/control captures. These are not extra program parsers;
  // they drive the visualizer controls that make the extension feel closer to a
  // CAM backplotter: preset view cube, speed control, program selector, and a
  // translucent target model laid over the toolpath.
  {
    id: 'view-top-speed',
    fixture: 'test/fixtures/setup/vise-mill-stock.nc',
    expectedPoints: 16,
    captureAreas: ['visualizer', 'gnomon-corner', 'playback-panel', 'view-cube'],
    controls: [
      { type: 'setPresetView', view: 'top' },
      { type: 'setPlaybackSpeed', speed: 0.25 },
    ],
    expect: { playbackSpeed: 0.25, programOptionsAtLeast: 2 },
  },
  {
    id: 'view-right-target',
    fixture: 'test/fixtures/setup/vise-mill-stock.nc',
    expectedPoints: 16,
    captureAreas: ['visualizer', 'gnomon-corner', 'target-panel', 'view-cube'],
    targetModel: 'block',
    targetFile: 'test/fixtures/scene/target-part.stl',
    controls: [
      { type: 'setPresetView', view: 'right' },
      { type: 'setTargetOffset', x: 0.2, y: -0.1, z: 0.15 },
      { type: 'setViewOpacity', sliderId: 'target-opacity', layer: 'targetModel', value: 0.5 },
      { type: 'setTargetDisplayMode', mode: 'solid' },
    ],
    expect: { targetLoaded: true, targetDisplayMode: 'solid' },
  },
  {
    id: 'view-iso-target-transparent',
    fixture: 'test/fixtures/setup/chuck-lathe-stock.nc',
    expectedPoints: 13,
    captureAreas: ['visualizer', 'target-panel'],
    targetModel: 'block',
    targetFile: 'test/fixtures/scene/target-part.stl',
    controls: [
      { type: 'setPresetView', view: 'iso' },
      { type: 'setViewOpacity', sliderId: 'target-opacity', layer: 'targetModel', value: 0.2 },
      { type: 'setTargetDisplayMode', mode: 'wireframe' },
    ],
    expect: { targetLoaded: true, targetDisplayMode: 'wireframe' },
  },
  {
    id: 'multi-scene-vise-target',
    fixture: 'test/fixtures/setup/vise-mill-stock.nc',
    expectedPoints: 16,
    captureAreas: ['visualizer', 'target-panel', 'view-cube'],
    targetFiles: [
      { file: 'test/fixtures/scene/target-part.stl', role: 'target-part', targetId: 'target-part' },
      { file: 'test/fixtures/scene/center-vise-base.stl', role: 'fixture', targetId: 'fixture' },
      { file: 'test/fixtures/scene/center-vise-jaws.stl', role: 'jaws', targetId: 'jaws' },
      { file: 'test/fixtures/scene/tool-holder.stl', role: 'holder', targetId: 'holder' },
      { file: 'test/fixtures/scene/cutter.stl', role: 'tooling', targetId: 'tooling' },
    ],
    controls: [
      { type: 'setPresetView', view: 'iso' },
      { type: 'setTargetDisplayMode', mode: 'transparent' },
      { type: 'setViewOpacity', sliderId: 'target-opacity', layer: 'targetModel', value: 0.45 },
    ],
    expect: { targetLoaded: true, targetCountAtLeast: 5, targetDisplayMode: 'transparent' },
  },
];

const justinFusionArchive = process.env.JOBLINE_JUSTIN_F3D || 'C:/Users/zach/Downloads/Drawing1.f3d';
if (fs.existsSync(justinFusionArchive)) {
  visualCases.push({
    id: 'justin-fusion-g18',
    fixture: 'test/fixtures/diagnostics/issue-3-fusion-g18.nc',
    expectedPoints: 3282,
    externalTargetFile: justinFusionArchive,
    captureAreas: ['visualizer', 'target-panel'],
    expect: {
      targetLoaded: true,
      targetCountAtLeast: 1,
      targetName: 'Fusion model dimensional envelope',
      targetWidth: 77.727922061357845,
      targetDepth: 55.000000000000028,
      targetHeight: 47.727922061357901,
      activeToolNumber: 1,
      toolDiameter: 6,
      toolVisible: true,
      fusionWorkOffset: 'G54',
      fusionWorkOffsetInferred: true,
      fusionFixtureAssigned: false,
      stockWidth: 79.727922061357845,
      stockMinX: -1,
      stockMinY: -1,
      stockTop: 1,
      fusionPreviewVisible: true,
      fusionReferenceVisible: true,
    },
  });
}

if (process.env.JOBLINE_VISUAL_CASE) {
  const selected = visualCases.filter(item => item.id === process.env.JOBLINE_VISUAL_CASE);
  if (!selected.length) throw new Error('Unknown JOBLINE_VISUAL_CASE');
  visualCases.splice(0, visualCases.length, ...selected);
}

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

function screenshotClip(metrics, area) {
  const viewport = metrics.viewport || { x: 0, y: 0, width: 1280, height: 720 };
  const webview = metrics.webview || viewport;
  const clamp = (clip) => ({
    x: Math.max(0, Math.floor(clip.x)),
    y: Math.max(0, Math.floor(clip.y)),
    width: Math.max(40, Math.floor(Math.min(clip.width, viewport.width - clip.x))),
    height: Math.max(40, Math.floor(Math.min(clip.height, viewport.height - clip.y))),
    scale: 1,
  });

  if (area === 'gnomon-corner') {
    return clamp({ x: webview.x, y: webview.y, width: Math.min(230, webview.width), height: Math.min(170, webview.height) });
  }
  if (area === 'tool-corner') {
    return clamp({
      x: webview.x + Math.max(0, webview.width - 360),
      y: webview.y + Math.max(0, webview.height - 360),
      width: Math.min(350, webview.width),
      height: Math.min(350, webview.height),
    });
  }
  if (area === 'target-panel') {
    const width = Math.min(260, webview.width);
    return clamp({
      x: webview.x + Math.max(0, webview.width - width - 8),
      y: webview.y + Math.max(0, webview.height - 420),
      width,
      height: Math.min(360, webview.height),
    });
  }
  if (area === 'playback-panel') {
    return clamp({ x: webview.x, y: webview.y + Math.max(0, webview.height - 165), width: 270, height: 155 });
  }
  if (area === 'view-cube') {
    return clamp({ x: webview.x + Math.max(0, webview.width - 175), y: webview.y + Math.max(0, webview.height - 265), width: 165, height: 155 });
  }
  return clamp({ x: webview.x, y: webview.y, width: webview.width, height: webview.height });
}

async function capturePage(webSocketDebuggerUrl, area) {
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
        const metricsResult = await call('Runtime.evaluate', {
          returnByValue: true,
          expression: `(() => {
            const viewport = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
            const candidates = Array.from(document.querySelectorAll('iframe, webview, .webview, [id*="webview"], [class*="webview"]'))
              .map(el => {
                const r = el.getBoundingClientRect();
                return { x: r.x, y: r.y, width: r.width, height: r.height, area: r.width * r.height };
              })
              .filter(r => r.width > 300 && r.height > 250)
              .sort((a, b) => b.area - a.area);
            return { viewport, webview: candidates[0] || viewport };
          })()`,
        });
        const clip = screenshotClip(metricsResult.result.value, area);
        const result = await call('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false,
          fromSurface: true,
          clip,
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
    await waitForFile(readyFile, 90000);
    // Allow the WebGL render loop two frames after the fixture signals readiness.
    await delay(1000);
    const target = await findWorkbenchTarget(30000);
    const captureAreas = visualCase.captureAreas || ['visualizer'];
    const screenshots = [];
    for (const area of captureAreas) {
      const screenshotFile = path.join(artifactDir, `${visualCase.id}-${area}.png`);
      const png = await capturePage(target.webSocketDebuggerUrl, area);
      if (png.length < 500 || png.subarray(1, 4).toString('ascii') !== 'PNG') {
        throw new Error(`Captured ${visualCase.id}/${area} image is invalid or unexpectedly small (${png.length} bytes)`);
      }
      fs.writeFileSync(screenshotFile, png);
      screenshots.push({ area, file: path.relative(root, screenshotFile), bytes: png.length });
    }
    results.push({ ...visualCase, screenshots });
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
    path.join(artifactDir, visualCase.id + '.png'),
  ]);
  for (const file of [...protocolFiles, path.join(artifactDir, 'visual-matrix.json')]) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }

  const capture = captureWhenReady();
  const userDataDir = path.join(artifactDir, `vscode-profile-${process.pid}`);
  const tests = runTests({
    version: process.env.JOBLINE_VSCODE_TEST_VERSION || '1.96.4',
    extensionDevelopmentPath: process.env.JOBLINE_EXTENSION_UNDER_TEST || root,
    extensionTestsPath: path.join(root, 'test', 'visual', 'runTest.js'),
    launchArgs: [root, '--new-window', '--disable-updates', '--skip-welcome', '--skip-release-notes', '--window-size=1600,1000', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${debugPort}`],
    extensionTestsEnv: {
      JOBLINE_VISUAL_ARTIFACT_DIR: artifactDir,
      JOBLINE_VISUAL_CASES: JSON.stringify(visualCases),
      JOBLINE_EXTENSION_UNDER_TEST: process.env.JOBLINE_EXTENSION_UNDER_TEST || root,
    },
  });

  await Promise.all([tests, capture]);
  console.log(`Visual E2E screenshots: ${visualCases.map(item => `${item.id}:{${(item.captureAreas || ['visualizer']).join(',')}}`).join(', ')}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
