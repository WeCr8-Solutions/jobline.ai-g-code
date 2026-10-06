// Same solid, three CAD formats. Zach asked to test STL, STEP and Parasolid together, so this
// builds one known box (0-10 x, 0-20 y, 0-5 z) as a real ASCII STL, a real ISO-10303-21 STEP
// file, and a real Parasolid-text body, and proves all three parsers agree on its bounds.
//
// This is also the first test on this machine that actually EXECUTES parseParasolidText -
// gcode-stl-comparison.test.ts's Parasolid case only runs against the real RevGrips part,
// which is gitignored and absent by design (allowed_for_ingest: false), so that assertion has
// never fired locally. These fixtures are synthetic geometry, not customer/vendor CAD, so they
// ship with the repo - unlike the real part, they are safe to commit.
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseSTL } from '../src/providers/visualizer/stlParser';
import { parseSTEPText } from '../src/providers/visualizer/stepParser';
import { parseParasolidText } from '../src/providers/visualizer/parasolidTextParser';

function loadFixture(name: string): Buffer {
  return fs.readFileSync(path.join(__dirname, 'fixtures', 'cross-format', name));
}

const EXPECTED_BOUNDS = { minX: 0, maxX: 10, minY: 0, maxY: 20, minZ: 0, maxZ: 5 };

describe('Cross-format solid import (STL, STEP, Parasolid text)', () => {
  it('STL: 12-triangle box parses to the expected bounds', () => {
    const buf = loadFixture('box.stl');
    const result = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    assert.equal(result.format, 'ascii');
    assert.equal(result.triangleCount, 12);
    assert.deepEqual(result.bounds, EXPECTED_BOUNDS);
  });

  it('STEP: same box, 8 CARTESIAN_POINT corners, parses to the expected bounds', () => {
    const result = parseSTEPText(loadFixture('box.stp').toString('utf8'));
    assert.equal(result.isValidStep, true);
    assert.equal(result.pointCount, 8);
    assert.deepEqual(result.bounds, EXPECTED_BOUNDS);
  });

  it('Parasolid text: same box, 8 point-cloud corners, parses to the expected bounds', () => {
    const result = parseParasolidText(loadFixture('box-parasolid.txt').toString('utf8'));
    assert.equal(result.format, 'parasolid-text');
    assert.equal(result.pointCount, 8);
    assert.deepEqual(result.bounds, EXPECTED_BOUNDS);
  });

  it('all three formats agree exactly on the bounds of the identical solid', () => {
    const stlBuf = loadFixture('box.stl');
    const stl = parseSTL(stlBuf.buffer.slice(stlBuf.byteOffset, stlBuf.byteOffset + stlBuf.byteLength));
    const step = parseSTEPText(loadFixture('box.stp').toString('utf8'));
    const parasolid = parseParasolidText(loadFixture('box-parasolid.txt').toString('utf8'));

    assert.deepEqual(stl.bounds, step.bounds);
    assert.deepEqual(step.bounds, parasolid.bounds);
    assert.deepEqual(stl.bounds, EXPECTED_BOUNDS);
  });
});
