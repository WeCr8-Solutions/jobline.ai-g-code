/**
 * Real-part import checks with AR4 robot parts (see test/ar4Parts.ts for the
 * set and its licence). For each part:
 *   - the STL through the shared kernel's reader (the same code CAM and the
 *     hub run) matches ar4-parts.golden.json, which is byte-identical in all
 *     three repositories (their tests check the same digests);
 *   - the STEP through OpenCascade (the extension's STEP path) has the STL's
 *     extent on every axis: same units (mm) and orientation, no axis swap
 *     (Annin's STLs are moved to positive space, so positions differ);
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
      it(`${part.id}: STEP through OpenCascade has the STL's size and orientation, in mm`, { skip }, async () => {
        const t = await tessellateSTEP(new Uint8Array(fs.readFileSync(path.join(dir!, part.step!))), { linearUnit: 'millimeter' });
        const stl = golden[part.id].stl;
        const size = Math.max(...stl.max.map((v: number, k: number) => v - stl.min[k]));
        const tol = Math.max(0.05, size * 0.002);
        // Annin's STL files were exported "moved to positive space" (min corner
        // at 0,0,0) while the STEP keeps the design origin, so the two are
        // compared by extent per axis (units and orientation: a swapped axis
        // or an inch/mm mix-up changes the extents) and the STEP by its own
        // golden position.
        const stepMin = [t.bounds.minX, t.bounds.minY, t.bounds.minZ];
        const stepMax = [t.bounds.maxX, t.bounds.maxY, t.bounds.maxZ];
        for (let k = 0; k < 3; k++) {
          const stepExtent = stepMax[k] - stepMin[k];
          const stlExtent = stl.max[k] - stl.min[k];
          assert.ok(Math.abs(stepExtent - stlExtent) <= tol, `axis ${k} extent: STEP ${stepExtent} vs STL ${stlExtent}`);
          assert.ok(Math.abs(stepMin[k] - golden[part.id].step.min[k]) <= 1e-3 && Math.abs(stepMax[k] - golden[part.id].step.max[k]) <= 1e-3, `STEP position axis ${k}`);
        }
        assert.equal(t.triangleCount, golden[part.id].step.triangles);
      });
    }
  }
});
