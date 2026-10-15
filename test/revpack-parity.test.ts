/**
 * RevPack parity: the extension, jobline.ai-CAM and the JobLine.ai hub build
 * and check every public pack identically.
 *
 * 1. The snapshot (correlation findings + every geometry layer's triangle
 *    count, wireframe edge count, bounds and volume, tool/holder solids and
 *    the in-process Z-map stock) must equal test/fixtures/revpack-geometry.golden.json.
 *    CAM and the hub commit the same golden file and run the same check.
 * 2. When CAM / the hub are checked out beside this repo (or JOBLINE_CAM_ROOT /
 *    JOBLINE_HUB_ROOT point at them), the shared kernel files and the golden
 *    file must be byte-identical to theirs.
 *
 * Run via: npm run test:revpack
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { revPackParitySnapshot } from '../src/providers/visualizer/revpackParity';
import { targetStlFile } from '../src/providers/visualizer/revpack';

const repo = path.join(__dirname, '..');
const packs = path.join(__dirname, 'fixtures', 'revpack-public');
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'revpack-geometry.golden.json'), 'utf8'));

describe('RevPack parity snapshot', () => {
  for (const dir of fs.readdirSync(packs).sort()) {
    it(`${dir}: matches the shared golden`, () => {
      const pack = JSON.parse(fs.readFileSync(path.join(packs, dir, 'revpack.json'), 'utf8'));
      const gcode = fs.readFileSync(path.join(packs, dir, pack.program.file), 'utf8');
      const stl = targetStlFile(pack);
      const target = stl ? fs.readFileSync(path.join(packs, dir, stl)) : undefined;
      assert.deepEqual(JSON.parse(JSON.stringify(revPackParitySnapshot(pack, gcode, target))), golden[dir]);
    });
  }
  it('golden covers every public pack', () => {
    assert.deepEqual(Object.keys(golden).sort(), fs.readdirSync(packs).sort());
  });
});

const SHARED = ['revpack.ts', 'revpackCorrelation.ts', 'revpackGeometry.ts', 'revpackParity.ts'];
const mine = (file: string) => path.join(repo, 'src', 'providers', 'visualizer', file);
const siblings: Array<{ name: string; roots: string[]; kernel: string; golden: string; packs: string }> = [
  {
    name: 'jobline.ai-CAM',
    roots: [process.env.JOBLINE_CAM_ROOT ?? '', path.join(repo, '..', 'jobline.ai-CAM')],
    kernel: 'src/core/revpack', golden: 'src/core/revpack/__tests__/revpack-geometry.golden.json', packs: 'samples/revpack-public',
  },
  {
    name: 'shift-handover-hub',
    roots: [process.env.JOBLINE_HUB_ROOT ?? '', path.join(repo, '..', 'shift-handover-hub')],
    kernel: 'src/lib/jobline/revpack', golden: 'src/lib/jobline/revpack/__tests__/revpack-geometry.golden.json', packs: 'public/revpack',
  },
];

for (const sibling of siblings) {
  const root = sibling.roots.find(candidate => candidate && fs.existsSync(path.join(candidate, sibling.kernel)));
  describe(`shared with ${sibling.name}`, () => {
    for (const file of SHARED) {
      it(`${file} is byte-identical`, { skip: !root && `${sibling.name} not checked out beside this repo` }, () => {
        assert.equal(fs.readFileSync(path.join(root!, sibling.kernel, file), 'utf8'), fs.readFileSync(mine(file), 'utf8'));
      });
    }
    it('golden is byte-identical', { skip: !root && `${sibling.name} not checked out` }, () => {
      assert.equal(fs.readFileSync(path.join(root!, sibling.golden), 'utf8'),
        fs.readFileSync(path.join(__dirname, 'fixtures', 'revpack-geometry.golden.json'), 'utf8'));
    });
    it('public packs are byte-identical', { skip: !root && `${sibling.name} not checked out` }, () => {
      for (const dir of fs.readdirSync(packs)) {
        for (const file of fs.readdirSync(path.join(packs, dir))) {
          assert.ok(fs.readFileSync(path.join(root!, sibling.packs, dir, file)).equals(fs.readFileSync(path.join(packs, dir, file))), `${dir}/${file}`);
        }
      }
    });
  });
}
