import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tessellateSTEP } from '../src/providers/visualizer/stepTessellator';

describe('STEP tessellation', () => {
  it('creates real triangles for a STEP target', async () => {
    const file = path.join(__dirname, 'fixtures', 'step', 'box.step');
    const result = await tessellateSTEP(fs.readFileSync(file));
    assert.ok(result.triangleCount >= 12);
    assert.equal(result.meshVertices.length, result.triangleCount * 9);
    assert.ok(result.bounds.maxX > result.bounds.minX);
  });
});
