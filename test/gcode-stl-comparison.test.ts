import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractGCodeCutBounds, compareBounds } from '../src/providers/visualizer/gcodeGoalComparison';
import { parseParasolidText } from '../src/providers/visualizer/parasolidTextParser';
import { parseSTL } from '../src/providers/visualizer/stlParser';

function loadFixture(relativePath: string): Buffer {
  return fs.readFileSync(path.join(__dirname, 'fixtures', 'verification', relativePath));
}

function loadRevpackFixture(relativePath: string): Buffer {
  return fs.readFileSync(path.join(__dirname, 'fixtures', 'revpack', relativePath));
}

describe('G-code to STL verification', () => {
  it('matches the rectangle profile NC fixture to its goal STL', () => {
    const gcode = loadFixture('rectangle-profile.nc').toString('utf8');
    const stlBuffer = loadFixture('rectangle-profile-goal.stl');
    const envelope = extractGCodeCutBounds(gcode);
    const stl = parseSTL(stlBuffer.buffer.slice(stlBuffer.byteOffset, stlBuffer.byteOffset + stlBuffer.byteLength));
    const comparison = compareBounds(envelope.bounds, stl.bounds, 0.000001);

    assert.equal(envelope.units, 'in');
    assert.equal(envelope.cutMoveCount, 5);
    assert.equal(stl.triangleCount, 12);
    assert.equal(comparison.matches, true);
  });

  it('uses simulation semantics for incremental moves and ignores comments', () => {
    const envelope = extractGCodeCutBounds('(G91 X99)\nG90 G0 X1 Y1\nG91 G1 X.5 Y-.25\n; G1 X50');
    assert.equal(envelope.cutMoveCount, 1);
    assert.equal(envelope.bounds.minX, 1);
    assert.equal(envelope.bounds.maxX, 1.5);
    assert.equal(envelope.bounds.minY, 0.75);
    assert.equal(envelope.bounds.maxY, 1);
  });

  it('extracts stable bounds from the revpack Parasolid text fixture', () => {
    const parasolid = parseParasolidText(loadRevpackFixture('REVGRIPS STEM-50-35-PRO.x_t').toString('utf8'));

    assert.equal(parasolid.format, 'parasolid-text');
    assert.ok(parasolid.pointCount > 1000);
    assert.ok(parasolid.rawPointCount >= parasolid.pointCount);
    assert.ok(Math.abs(parasolid.bounds.minX - (-0.20791169081776)) < 1e-12);
    assert.ok(Math.abs(parasolid.bounds.maxX - 0.229074362437515) < 1e-12);
    assert.ok(Math.abs(parasolid.bounds.minY - (-0.2072022090111075)) < 1e-12);
    assert.ok(Math.abs(parasolid.bounds.maxY - 0.2290743624374395) < 1e-12);
    assert.ok(Math.abs(parasolid.bounds.minZ - (-0.2087142340285675)) < 1e-12);
    assert.ok(Math.abs(parasolid.bounds.maxZ - 0.2237997565123925) < 1e-12);
  });
});
