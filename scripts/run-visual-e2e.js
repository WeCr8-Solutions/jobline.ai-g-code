/* eslint-env node */
/* global require, __dirname, process, console, fetch, WebSocket, setTimeout */

const fs = require('node:fs');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

const root = path.resolve(__dirname, '..');
const artifactDir = path.join(root, 'test-results', 'visual');
const debugPort = 9333;
// Workbench size for every capture. --window-size alone is not honoured by
// VS Code (it restores its own 1024x768), so the size is also forced through
// the DevTools protocol once the window is up.
const windowWidth = Number(process.env.JOBLINE_VISUAL_WIDTH || 1600);
const windowHeight = Number(process.env.JOBLINE_VISUAL_HEIGHT || 1000);
// expectedPoints pins each case to its OWN program. The panel is reused across
// cases, and the probe used to read whatever was still on screen: case 2
// reported case 1's 195 points and case 3 reported case 2's 17, so only the
// first case was ever really tested. Waiting for the expected count is what
// makes each case measure its own render.
const visualCases = [
  { id: 'clean-mill', fixture: 'test/fixtures/diagnostics/clean-mill.nc', expectedPoints: 195, captureAreas: ['visualizer', 'workbench'] },
  {
    id: 'clean-mill-solid-target',
    fixture: 'test/fixtures/diagnostics/clean-mill.nc',
    expectedPoints: 195,
    targetFile: 'test/fixtures/scene/target-part.stl',
    captureAreas: ['visualizer', 'workbench'],
    controls: [
      { type: 'setTargetDisplayMode', mode: 'solid' },
      { type: 'setLayerVisible', layer: 'sweptTube', visible: false },
    ],
    expect: { targetLoaded: true, targetCountAtLeast: 1, targetDisplayMode: 'solid', targetName: 'target-part.stl' },
  },
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
    fixture: 'test/fixtures/scene/visual-import-only.nc',
    expectedPoints: 1,
    importOnly: true,
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
    fixture: 'test/fixtures/scene/visual-import-only.nc',
    expectedPoints: 1,
    importOnly: true,
    captureAreas: ['visualizer', 'target-panel'],
    targetModel: 'block',
    targetFile: 'test/fixtures/scene/target-part.stl',
    controls: [
      { type: 'setPresetView', view: 'iso' },
      { type: 'setViewOpacity', sliderId: 'target-opacity', layer: 'targetModel', value: 0.2 },
      { type: 'setTargetDisplayMode', mode: 'transparent' },
    ],
    expect: { targetLoaded: true, targetDisplayMode: 'transparent' },
  },
  {
    id: 'multi-scene-vise-target',
    fixture: 'test/fixtures/scene/visual-import-only.nc',
    expectedPoints: 1,
    importOnly: true,
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

// RevPack cases: the program is opened from its pack folder, so the extension
// must AUTO-DETECT revpack.json and draw the pack's target, stock (in-process
// where the shared kernel cuts it), every workholding solid and the tool, in
// both Solid and Wireframe layer modes. Each layer is also rendered alone to
// prove it is on screen, and the correlation findings must reach the Problems
// panel and the visualizer list.
const revpackCases = [
  { pack: 'haas-umc750-5axis', id: 'umc750-clean', clean: true, inProcess: true },
  { pack: 'haas-umc750-5axis-seeded', id: 'umc750-seeded', clean: false, inProcess: true, problems: true },
  { pack: 'haas-vf2-vise', id: 'vf2-vise', clean: true, inProcess: true },
  { pack: 'okuma-lb3000-lathe', id: 'lb3000', clean: true, inProcess: false },
  { pack: 'trumpf-trulaser3030', id: 'trulaser3030', clean: true, inProcess: false },
];
// Extra views of one mode: Target only (every other layer hidden) and the
// remaining-material vs gouge colouring of the in-process stock.
const revpackExtras = revpackCases.flatMap(rp => [
  { pack: rp.pack, id: `${rp.id}-targetonly`, base: rp.id, mode: 'solid', controls: [{ type: 'setTargetOnly', on: true }], targetOnly: true },
  // Compare colours the in-process stock cell by cell, so it needs a pack the
  // shared kernel cuts (the lathe and laser packs have no in-process stock and
  // the panel disables the Compare button for them).
  ...(rp.inProcess ? [{ pack: rp.pack, id: `${rp.id}-compare`, base: rp.id, mode: 'solid', controls: [{ type: 'setCompareMode', on: true }], compare: true }] : []),
]);
// The Makro-Grip vise on the UMC-750: each layer preset, plus the seeded
// rapid into the +Y jaw shown with the workholding see-through.
revpackExtras.push(
  { pack: 'haas-umc750-5axis', id: 'umc750-vise-allsolid', base: 'umc750-clean', mode: 'solid', controls: [{ type: 'applyLayerPreset', preset: 'all-solid' }], preset: 'all-solid' },
  { pack: 'haas-umc750-5axis', id: 'umc750-vise-inspect', base: 'umc750-clean', mode: 'solid', controls: [{ type: 'applyLayerPreset', preset: 'inspect' }], preset: 'inspect' },
  { pack: 'haas-umc750-5axis', id: 'umc750-vise-workholding', base: 'umc750-clean', mode: 'solid', controls: [{ type: 'applyLayerPreset', preset: 'workholding' }], preset: 'workholding' },
  { pack: 'haas-umc750-5axis', id: 'umc750-vise-jaws-wire', base: 'umc750-clean', mode: 'solid', controls: [{ type: 'setObjectStyle', object: 'jaws', mode: 'wireframe' }, { type: 'setObjectStyle', object: 'fixture', mode: 'transparent', opacity: 0.3 }], objectModes: { jaws: 'wireframe', fixture: 'transparent' } },
  { pack: 'haas-umc750-5axis-seeded', id: 'umc750-seeded-jawhit', base: 'umc750-seeded', mode: 'solid', controls: [{ type: 'applyLayerPreset', preset: 'inspect' }, { type: 'setPresetView', view: 'right' }], preset: 'inspect', jawHit: true },
);
/** Stock bounds the shared kernel draws for a pack (a bar is its bounding box). */
function packStockBounds(stock) {
  if (typeof stock.diameter === 'number') { const r = stock.diameter / 2; return { min: [-r, -r, stock.zMin], max: [r, r, stock.zMax] }; }
  return { min: stock.min, max: stock.max };
}
function revpackCase(rp, mode, extra) {
  const packJson = JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures', 'revpack-public', rp.pack, 'revpack.json'), 'utf8'));
  return {
    id: `revpack-${extra ? extra.id : rp.id + '-' + mode}`,
    fixture: `test/fixtures/revpack-public/${rp.pack}/${packJson.program.file}`,
    expectedPoints: null,
    captureAreas: ['visualizer', 'workbench'],
    controls: [
      { type: 'setPresetView', view: 'iso' },
      // The cut solid would sit over the pack's in-process stock; the
      // screenshots are about the pack's target, stock, fixture and tool.
      { type: 'setLayerVisible', layer: 'sweptTube', visible: false },
      { type: 'setSceneRenderMode', mode },
      ...(extra ? extra.controls : []),
    ],
    revpack: {
      id: packJson.id,
      name: packJson.name,
      mode,
      clean: rp.clean,
      seeded: packJson.purpose === 'seeded-errors',
      workholding: packJson.workholding.length,
      tools: packJson.tools.length,
      inProcess: rp.inProcess,
      stepTarget: packJson.target?.format === 'step',
      targetOnly: !!extra?.targetOnly,
      compare: !!extra?.compare,
      preset: extra?.preset || '',
      objectModes: extra?.objectModes || null,
      jawHit: !!extra?.jawHit,
      showProblems: !!rp.problems && (!extra || !!extra.jawHit),
      // The stock exactly where the setup puts it, with the target inside.
      stockBounds: packStockBounds(packJson.stock),
      vise: !!packJson.workholdingSpec,
      grip: !!packJson.setup?.gripDepth && typeof packJson.stock.diameter !== 'number',
    },
    expect: { targetLoaded: true },
  };
}
for (const rp of revpackCases) {
  for (const mode of ['solid', 'wireframe']) visualCases.push(revpackCase(rp, mode));
}
for (const extra of revpackExtras) visualCases.push(revpackCase(revpackCases.find(rp => rp.id === extra.base), extra.mode, extra));

// Part to origin / Set WCS (Origin panel): the shared placement kernel run
// through jobline.placement.run on the UMC-750 and VF-2 packs and on an AR4
// part uploaded on its own - top-front-left corner, top centre, bore centre
// and a face turned to the top with the view normal to it. Each case checks
// where the target is drawn, that it stays inside the stock, and the WCS
// triad / feature highlight on screen.
const ORIGIN_OPS = {
  corner: () => ({ ops: [{ op: 'preset', id: 'top-front-left' }], expect: { corner: true, label: /top-front-left corner of the part/ } }),
  'top-center': () => ({ ops: [{ op: 'preset', id: 'top-center' }], expect: { topCenter: true, label: /top face center of the part/ } }),
};
const originPackCases = [
  { pack: 'haas-umc750-5axis', id: 'umc750', bore: { point: [-1.280193 + 0.15, 0.5 + 0.1005, -0.75], align: true }, face: { point: [0, -1, -0.8] } },
  { pack: 'haas-vf2-vise', id: 'vf2', bore: { point: [1.25 + 0.1005, 0.75, -0.385], align: false }, face: { point: [0, -1.5, -0.4] } },
];
for (const oc of originPackCases) {
  const packJson = JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures', 'revpack-public', oc.pack, 'revpack.json'), 'utf8'));
  const modes = {
    ...ORIGIN_OPS,
    'bore-center': () => ({ ops: [{ op: 'preset', id: 'top-center' }, { op: 'pickCylinder', pick: { tri: -1, point: oc.bore.point }, align: oc.bore.align }], expect: { feature: 'cylinder', label: /bore axis/ } }),
    'face-align': () => ({ ops: [{ op: 'preset', id: 'top-center' }, { op: 'pickFace', pick: { tri: -1, point: oc.face.point }, action: 'alignTop', view: 'normal' }], expect: { feature: 'plane', viewNormal: true, featureNormal: [0, 0, 1], hover: true } }),
  };
  for (const [mode, make] of Object.entries(modes)) {
    const spec = make();
    visualCases.push({
      id: `origin-${oc.id}-${mode}`,
      fixture: `test/fixtures/revpack-public/${oc.pack}/${packJson.program.file}`,
      expectedPoints: null,
      captureAreas: ['visualizer'],
      controls: [
        { type: 'setPresetView', view: 'iso' },
        { type: 'setLayerVisible', layer: 'sweptTube', visible: false },
        { type: 'setSceneRenderMode', mode: 'solid' },
        // Looking straight down a face, the tool parked over the part would hide it.
        ...(mode === 'face-align' ? [{ type: 'setLayerVisible', layer: 'tool', visible: false }, { type: 'setLayerVisible', layer: 'toolHolder', visible: false }] : []),
      ],
      origin: { pack: packJson.id, packName: packJson.name, stepTarget: packJson.target?.format === 'step', mode, ops: spec.ops, expect: { ...spec.expect, label: spec.expect.label ? spec.expect.label.source : '' } },
    });
  }
}

// AR4 real parts (local only - the Annin licence forbids redistributing the
// files; see test/ar4Parts.ts). Each part is imported through the STEP
// (OpenCascade) path and the STL path, in solid and wireframe, and its bounds
// are checked against ar4-parts.golden.json.
const ar4Root = process.env.JOBLINE_AR4_DIR || path.join(root, 'test', 'fixtures', 'external-local', 'ar4');
const ar4GoldenFile = path.join(root, 'test', 'fixtures', 'ar4-parts.golden.json');
const AR4_VISUAL_PARTS = [
  { id: 'sg1-base', stl: 'AR4_SG1_base.STL', step: 'AR4_SG1_base.STEP' },
  { id: 'sg1-carriage', stl: 'AR4_SG1_carriage.STL', step: 'AR4_SG1_carriage.STEP' },
  { id: 'sg1-gear', stl: 'AR4_SG1_gear.STL', step: 'AR4_SG1_gear.STEP' },
  { id: 'sg1-jaw1', stl: 'AR4_SG1_jaw1.STL', step: 'AR4_SG1_jaw1.STEP' },
  { id: 'sg1-center-bar', stl: 'AR4_SG1_center_bar.STL', step: 'AR4_SG1_center_bar.STEP' },
];
if (fs.existsSync(ar4GoldenFile) && AR4_VISUAL_PARTS.every(part => fs.existsSync(path.join(ar4Root, part.stl)))) {
  const ar4Golden = JSON.parse(fs.readFileSync(ar4GoldenFile, 'utf8'));
  for (const part of AR4_VISUAL_PARTS) {
    for (const format of ['step', 'stl']) {
      for (const mode of ['solid', 'wireframe']) {
        visualCases.push({
          id: `ar4-${part.id}-${format}-${mode}`,
          fixture: 'test/fixtures/scene/visual-import-only.nc',
          expectedPoints: 1,
          importOnly: true,
          targetFile: path.join(ar4Root, part[format]),
          targetModel: `ar4-${part.id}`,
          captureAreas: ['visualizer'],
          controls: [
            { type: 'setPresetView', view: 'iso' },
            { type: 'setSceneRenderMode', mode },
            { type: 'setTargetDisplayMode', mode },
          ],
          ar4: { part: part.id, format, mode, golden: ar4Golden[part.id] },
          expect: { targetLoaded: true, targetDisplayMode: mode },
        });
      }
    }
  }
}

// An AR4 part uploaded on its own (no pack), placed with the Origin panel.
if (fs.existsSync(path.join(ar4Root, 'AR4_SG1_gear.STL'))) {
  for (const [mode, ops, expect] of [
    ['corner', [{ op: 'preset', id: 'top-front-left' }], { corner: true, label: 'top-front-left corner of the part' }],
    ['top-center', [{ op: 'preset', id: 'top-center' }], { topCenter: true, label: 'top face center of the part' }],
    ['bore-center', [{ op: 'preset', id: 'top-center' }, { op: 'pickCylinder', pick: { tri: -1, point: 'gear-bore' }, align: true }], { feature: 'cylinder', label: 'axis' }],
    ['face-align', [{ op: 'preset', id: 'top-center' }, { op: 'pickFace', pick: { tri: -1, point: 'side-face' }, action: 'alignTop', view: 'normal' }], { feature: 'plane', viewNormal: true, featureNormal: [0, 0, 1], hover: true }],
  ]) {
    visualCases.push({
      id: `origin-ar4-gear-${mode}`,
      fixture: 'test/fixtures/scene/visual-import-only.nc',
      expectedPoints: 1,
      importOnly: true,
      targetFile: path.join(ar4Root, 'AR4_SG1_gear.STL'),
      targetModel: 'ar4-sg1-gear',
      captureAreas: ['visualizer'],
      controls: [
        { type: 'setPresetView', view: 'iso' },
        { type: 'setSceneRenderMode', mode: 'solid' },
        { type: 'setTargetDisplayMode', mode: 'solid' },
        ...(mode === 'face-align' ? [{ type: 'setLayerVisible', layer: 'tool', visible: false }, { type: 'setLayerVisible', layer: 'toolHolder', visible: false }] : []),
      ],
      origin: { upload: true, mode, ops, expect },
      expect: { targetLoaded: true },
    });
  }
}

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

const revgripsRoot = process.env.JOBLINE_REVGRIPS_FIXTURE
  || path.join(root, 'test', 'fixtures', 'revpack');
const revgripsProgram = path.join(revgripsRoot, 'stem umc sample.nc');
const revgripsTarget = path.join(revgripsRoot, 'REVGRIPS STEM-50-35-PRO.x_t');
if (fs.existsSync(revgripsProgram) && fs.existsSync(revgripsTarget)) {
  visualCases.unshift({
    id: 'revgrips-stem-50-35-pro',
    fixture: path.relative(root, revgripsProgram).replace(/\\/g, '/'),
    expectedPoints: 116056,
    targetModel: 'revgrips-stem-50-35-pro',
    targetFile: revgripsTarget,
    captureAreas: ['visualizer', 'target-panel', 'view-cube'],
    controls: [
      { type: 'setPresetView', view: 'iso' },
      { type: 'setTargetDisplayMode', mode: 'solid' },
      { type: 'setLayerVisible', layer: 'sweptTube', visible: false },
    ],
    expect: {
      targetLoaded: true,
      targetCountAtLeast: 1,
      targetDisplayMode: 'solid',
      targetName: 'REVGRIPS STEM-50-35-PRO.x_t',
      targetWidth: 0.436986053255275,
      targetDepth: 0.436276571448547,
      targetHeight: 0.43251399054096,
    },
  });
}

if (process.env.JOBLINE_VISUAL_REVPACK_ONLY) {
  visualCases.splice(0, visualCases.length, ...visualCases.filter(item => item.revpack || item.origin || (process.env.JOBLINE_VISUAL_AR4 !== '0' && item.ar4)));
}
if (process.env.JOBLINE_VISUAL_ORIGIN_ONLY) {
  visualCases.splice(0, visualCases.length, ...visualCases.filter(item => item.origin));
}
if (process.env.JOBLINE_VISUAL_AR4_ONLY) {
  visualCases.splice(0, visualCases.length, ...visualCases.filter(item => item.ar4));
}
if (process.env.JOBLINE_VISUAL_CASE) {
  const wanted = process.env.JOBLINE_VISUAL_CASE.split(',').map(id => id.trim());
  const selected = visualCases.filter(item => wanted.includes(item.id));
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

  if (area === 'workbench') return clamp(viewport);

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
  if (typeof WebSocket === 'undefined') {
    throw new Error(`Screenshot capture needs the global WebSocket (Node 22 or newer); this is Node ${process.version}.`);
  }
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

let sizeSession = null;
/**
 * Resize the real window (Browser.setWindowBounds); if the screen cannot fit
 * it, keep a DevTools session open that emulates the size, so the workbench
 * lays out at windowWidth x windowHeight for every case.
 */
async function forceWindowSize() {
  const target = await findWorkbenchTarget(120000);
  const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
  const browserCall = (method, params) => new Promise((resolve, reject) => {
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.addEventListener('message', event => { const m = JSON.parse(String(event.data)); if (m.id === 1) { socket.close(); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } });
    socket.addEventListener('error', () => reject(new Error('browser socket failed')));
  });
  try {
    const { windowId } = await browserCall('Browser.getWindowForTarget', { targetId: target.id });
    await browserCall('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await browserCall('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0, width: windowWidth, height: windowHeight } });
  } catch (error) {
    console.warn('Browser.setWindowBounds failed:', error.message);
  }
  await delay(800);
  sizeSession = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { sizeSession.addEventListener('open', resolve); sizeSession.addEventListener('error', reject); });
  let id = 1;
  const call = (method, params = {}) => new Promise(resolve => {
    const myId = id++;
    const onMessage = event => { const m = JSON.parse(String(event.data)); if (m.id === myId) { sizeSession.removeEventListener('message', onMessage); resolve(m.result || m.error); } };
    sizeSession.addEventListener('message', onMessage);
    sizeSession.send(JSON.stringify({ id: myId, method, params }));
  });
  const inner = await call('Runtime.evaluate', { returnByValue: true, expression: '[window.innerWidth, window.innerHeight]' });
  const [w, h] = inner?.result?.value || [0, 0];
  if (w < windowWidth || h < windowHeight) {
    await call('Emulation.setDeviceMetricsOverride', { width: windowWidth, height: windowHeight, deviceScaleFactor: 1, mobile: false });
    console.log(`Workbench was ${w}x${h}; emulating ${windowWidth}x${windowHeight} for the captures.`);
  } else {
    sizeSession.close();
    sizeSession = null;
    console.log(`Workbench is ${w}x${h}.`);
  }
}

async function captureWhenReady() {
  const results = [];
  await forceWindowSize().catch(error => console.warn('Could not force the window size:', error.message));
  for (const visualCase of visualCases) {
    const readyFile = path.join(artifactDir, `${visualCase.id}.ready`);
    const capturedFile = path.join(artifactDir, `${visualCase.id}.captured`);
    const errorFile = path.join(artifactDir, `${visualCase.id}.error`);
    const deadline = Date.now() + 150000;
    while (!fs.existsSync(readyFile) && !fs.existsSync(errorFile) && Date.now() < deadline) await delay(100);
    if (fs.existsSync(errorFile)) {
      const reason = fs.readFileSync(errorFile, 'utf8');
      console.error(`Visual case ${visualCase.id} FAILED in the extension host:\n${reason}`);
      results.push({ ...visualCase, failed: reason.split('\n')[0], screenshots: [] });
      continue;
    }
    if (!fs.existsSync(readyFile)) throw new Error(`Timed out waiting for ${path.basename(readyFile)}`);
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
  if (sizeSession) sizeSession.close();
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
    path.join(artifactDir, `${visualCase.id}.error`),
    path.join(artifactDir, visualCase.id + '.png'),
  ]);
  for (const file of [...protocolFiles, path.join(artifactDir, 'visual-matrix.json')]) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }

  // If capturing fails, every case would otherwise wait out its own timeout
  // (about ten minutes in all) before the real error is reported.
  const capture = captureWhenReady().catch(error => {
    console.error(error);
    process.exit(1);
  });
  const userDataDir = path.join(artifactDir, `vscode-profile-${process.pid}`);
  const tests = runTests({
    version: process.env.JOBLINE_VSCODE_TEST_VERSION || '1.96.4',
    extensionDevelopmentPath: process.env.JOBLINE_EXTENSION_UNDER_TEST || root,
    extensionTestsPath: path.join(root, 'test', 'visual', 'runTest.js'),
    launchArgs: [root, '--new-window', '--disable-updates', '--skip-welcome', '--skip-release-notes', `--window-size=${windowWidth},${windowHeight}`, '--use-gl=swiftshader', '--enable-unsafe-swiftshader', `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${debugPort}`],
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
