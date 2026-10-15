/**
 * Real-part import checks with AR4 robot parts (see test/ar4Parts.ts for the
 * set and its licence). For each part:
 *   - the STL through the shared kernel's reader (the same code CAM and the
 *     hub run) matches ar4-parts.golden.json, which is byte-identical in all
 *     three repositories (their tests check the same digests);
 *   - the STEP through OpenCascade (the extension's STEP path) lands on the
 *     STL's bounds: same units (mm) and orientation, no axis swap;
 *   - the solid is closed enough to have a volume, and its wireframe has edges.
 * Skips when the local files are absent (they may not be redistributed).
 *
 * Run via: npm run test:revpack
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { meshFileDigest } from '../src/providers/visualizer/revpackParity';
import { tessellateSTEP } from '../src/providers/visualizer/stepTessellator';
import { AR4_PARTS, ar4Dir } from './ar4Parts';

const dir = ar4Dir();
const goldenFile = path.join(__dirname, 'fixtures', 'ar4-parts.golden.json');
const golden = fs.existsSync(goldenFile) ? JSON.parse(fs.readFileSync(goldenFile, 'utf8')) : {};
const skip = !dir && 'AR4 part files not present locally (licence forbids committing them)';

describe('AR4 real parts', () => {
  it('golden lists every part', () => {
    assert.deepEqual(Object.keys(golden).sort(), AR4_PARTS.map(p => p.id).sort());
  });
  for (const part of AR4_PARTS) {
    it(`${part.id}: STL through the shared kernel matches the shared golden`, { skip }, () => {
      const digest = meshFileDigest(fs.readFileSync(path.join(dir!, part.stl)));
      assert.deepEqual(digest, golden[part.id].stl);
      assert.ok(digest.triangles > 1000, 'a real part, not a primitive');
      assert.ok(digest.edges > 50, 'wireframe has feature edges');
      assert.ok(digest.volume > 0);
    });
    if (part.step) {
      it(`${part.id}: STEP through OpenCascade has the STL's bounds (units, orientation)`, { skip }, async () => {
        const t = await tessellateSTEP(new Uint8Array(fs.readFileSync(path.join(dir!, part.step!))), { linearUnit: 'millimeter' });
        const stl = golden[part.id].stl;
        const size = Math.max(...stl.max.map((v: number, k: number) => v - stl.min[k]));
        const got = [t.bounds.minX, t.bounds.minY, t.bounds.minZ, t.bounds.maxX, t.bounds.maxY, t.bounds.maxZ];
        const want = [...stl.min, ...stl.max];
        got.forEach((v, k) => assert.ok(Math.abs(v - want[k]) <= Math.max(0.05, size * 0.002), `bound ${k}: STEP ${v} vs STL ${want[k]}`));
        assert.deepEqual(golden[part.id].step.triangles, t.triangleCount);
      });
    }
  }
});
