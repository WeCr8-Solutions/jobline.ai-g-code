/**
 * Writes test/fixtures/ar4-parts.golden.json: the shared-kernel digest of each
 * local AR4 part (Annin Robotics AR4 servo gripper STL files) plus, for the
 * extension only, the OpenCascade tessellation bounds of its STEP twin.
 *
 * The part files are NOT in the repository: the Annin Robotics licence (Open
 * Source Non-Commercial License v1.1, section 2.2) forbids redistributing the
 * design files. Put them in test/fixtures/external-local/ar4/ (gitignored) or
 * point JOBLINE_AR4_DIR at them; see docs/external-cad-fixture-sources.md.
 * The digests are numbers only and are committed in all three repositories.
 *
 * Run: npx ts-node --transpileOnly scripts/ar4-parts-golden.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { meshFileDigest } from '../src/providers/visualizer/revpackParity';
import { tessellateSTEP } from '../src/providers/visualizer/stepTessellator';
import { AR4_PARTS, ar4Dir } from '../test/ar4Parts';

async function main(): Promise<void> {
  const dir = ar4Dir();
  if (!dir) throw new Error('AR4 part files not found: set JOBLINE_AR4_DIR or fill test/fixtures/external-local/ar4');
  const out: Record<string, unknown> = {};
  for (const part of AR4_PARTS) {
    const stl = meshFileDigest(fs.readFileSync(path.join(dir, part.stl)));
    let step: unknown = null;
    if (part.step) {
      const t = await tessellateSTEP(new Uint8Array(fs.readFileSync(path.join(dir, part.step))), { linearUnit: 'millimeter' });
      const r = (n: number) => Math.round(n * 1e4) / 1e4;
      step = { triangles: t.triangleCount, min: [r(t.bounds.minX), r(t.bounds.minY), r(t.bounds.minZ)], max: [r(t.bounds.maxX), r(t.bounds.maxY), r(t.bounds.maxZ)] };
    }
    out[part.id] = { units: 'mm', stl, step };
  }
  const file = path.join(__dirname, '..', 'test', 'fixtures', 'ar4-parts.golden.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log('wrote', file);
}
void main();
