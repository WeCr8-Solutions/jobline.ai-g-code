/**
 * Visualizer fixes from Zach's Oct 16 2026 report: blurry view cube, part and
 * tools not placed on the first frame, legend overlapping the cube, tight
 * framing on flat parts (AR4 gear / jaw1), part-only .jbl not opening.
 * Run: npm run test:visualizer-fixes
 *
 * The webview checks are structural (the sandbox has no GPU browser); the
 * rendered before/after screenshots come from `npm run test:e2e:visual` on a
 * desktop with a display.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readPartOnlyJbl, readJbl } from '../src/providers/visualizer/revpackLoader';
import { loadStlMesh } from '../src/providers/visualizer/stlMeshLoader';

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'media', 'toolpathVisualizerWebview.html'), 'utf8');
const jblDir = path.join(root, 'test', 'fixtures', 'jbl');

describe('View cube is drawn at the display pixel density', () => {
  it('the renderer pixel ratio follows devicePixelRatio, including later changes', () => {
    assert.match(html, /function currentPixelRatio\(\)/);
    assert.match(html, /function syncPixelRatio\(\)/);
    assert.match(html, /matchMedia\('\(resolution: '/);
    // the resize handler re-reads the ratio before resizing
    assert.match(html, /renderer\.setPixelRatio\(currentPixelRatio\(\)\);\s*renderer\.setSize\(w, h\);/);
  });
  it('cube textures are mip-mapped with anisotropy, and nothing translucent covers the cube', () => {
    assert.match(html, /tex\.anisotropy = renderer\.capabilities\.getMaxAnisotropy\(\)/);
    assert.match(html, /#view-cube \{ backdrop-filter: none; -webkit-backdrop-filter: none; background: transparent;/);
    assert.doesNotMatch(html, /#view-cube \{ right: 8px; transform: scale/, 'the cube panel is not CSS-scaled away from its GL viewport');
  });
  it('the cube viewport is taken from the .cube-stage box, not a fixed offset', () => {
    assert.match(html, /document\.querySelector\('#view-cube \.cube-stage'\)/);
    assert.match(html, /window\.__joblineGnomonViewport/);
  });
});

describe('First frame is the placed setup', () => {
  it('the canvas stays hidden until scene messages settle, then fits and reveals', () => {
    assert.match(html, /renderer\.domElement\.style\.opacity = '0'/);
    assert.match(html, /function scheduleSettledFit\(\)/);
    for (const type of ['update', 'machineType', 'revpackScene', 'revpackWorkholding', 'revpackPlacement', 'targetModel', 'stockOrigin']) {
      assert.match(html, new RegExp(`SCENE_MESSAGES = new Set\\([^)]*'${type}'`), `${type} re-arms the settle`);
    }
    assert.match(html, /if \(msg\.type === 'resetVisualScene'\) resetSettle\(\);/);
    assert.match(html, /settleTimer = setTimeout\(revealCanvas, SETTLE_MAX_MS\)/, 'never left blank');
  });
  it('the settled fit runs after placement and rebuilds the origin triad', () => {
    const body = html.slice(html.indexOf('function scheduleSettledFit()'), html.indexOf('function resetSettle()'));
    assert.match(body, /fitCamera\(currentPath\);\s*didFit = true;\s*buildOrigin\(\);/);
    assert.match(body, /!userMovedCamera/);
  });
  it('mill tools are built along spindle Z (three Y) from the tip', () => {
    assert.match(html, /function gc3\(x, y, z\) \{\s*return new THREE\.Vector3\(x, z === undefined \? 0 : z, -\(y === undefined \? 0 : y\)\);/);
    assert.match(html, /group\.position\.copy\(tip\);/);
  });
});

describe('Framing and legend', () => {
  it('fit frames the bounding sphere against the narrower field of view', () => {
    assert.match(html, /const hFov = 2 \* Math\.atan\(Math\.tan\(vFov \/ 2\) \* Math\.max\(camera\.aspect, 0\.05\)\)/);
    assert.match(html, /orbitRadius = Math\.max\(maxDim \* fitFactor, sphereFit\)/);
  });
  it('sphere framing is looser than the old factor for a flat gear in a narrow panel', () => {
    // AR4 gear: ~ 100 x 100 x 12 mm, panel 600 x 900 (aspect 0.67), fov 45.
    const size = { x: 100, y: 12, z: 100 };
    const maxDim = 100;
    const vFov = 45 * Math.PI / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (600 / 900));
    const sphere = Math.hypot(size.x, size.y, size.z) / 2;
    const fit = sphere / Math.sin(Math.min(vFov, hFov) / 2) * 1.12;
    assert.ok(fit > maxDim * 2.2, `sphere fit ${fit.toFixed(1)} > old ${maxDim * 2.2}`);
  });
  it('the legend follows the cube width and drops the mouse help when it would overlap', () => {
    assert.match(html, /function layoutLegend\(\)/);
    assert.match(html, /legend\.style\.right = Math\.round\(\(cubeShown \? cubeWidth \+ 24 : 10\)\) \+ 'px'/);
    assert.match(html, /#legend\.legend-compact \.legend-controls/);
    assert.match(html, /layoutLegend\(\);\s*\}/);
  });
});

describe('Part-only .jbl opens', () => {
  it('readPartOnlyJbl returns the part STL and CAM setup when there is no pack', () => {
    const part = readPartOnlyJbl(path.join(jblDir, 'part-only-vise-plate.jbl'));
    assert.ok(part, 'part-only .jbl recognised');
    const mesh = loadStlMesh(part!.targetStl.slice().buffer);
    assert.ok(mesh.triangleCount > 10);
    assert.equal(part!.placement.placement.rotation.length, 9);
    assert.equal(part!.placement.placement.origin.length, 3);
  });
  it('a .jbl with a pack still goes through readJbl', () => {
    const file = path.join(jblDir, 'haas-vf2-vise-bore-center.jbl');
    assert.equal(readPartOnlyJbl(file), undefined);
    assert.ok(readJbl(file).pack);
  });
  it('Load RevPack… opens a part-only .jbl as an uploaded part with its setup', () => {
    const ext = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
    assert.match(ext, /const part = readPartOnlyJbl\(file\);/);
    assert.match(ext, /placementSessions\.seed\(`upload:\$\{id\}`, part\.placement\);/);
  });
});
