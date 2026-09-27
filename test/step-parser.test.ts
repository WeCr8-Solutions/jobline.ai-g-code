import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseSTEP, parseSTEPText } from '../src/providers/visualizer/stepParser';

function loadFixture(relativePath: string): Buffer {
  return fs.readFileSync(path.join(__dirname, 'fixtures', 'step', relativePath));
}

describe('STEP (ISO-10303-21) parser', () => {
  it('recognizes a real STEP file and reads its schema', () => {
    const result = parseSTEPText(loadFixture('test-box.stp').toString('utf8'));
    assert.equal(result.isValidStep, true);
    assert.equal(result.schema, 'AUTOMOTIVE_DESIGN');
    assert.equal(result.format, 'step');
  });

  it('extracts exact bounds from every CARTESIAN_POINT, including a labeled one', () => {
    const result = parseSTEPText(loadFixture('test-box.stp').toString('utf8'));
    // 9 CARTESIAN_POINT entities in the fixture: 8 box corners plus one labeled outlier point
    // (-1.5, 3.25, 4) that must still be picked up and widen the bounds on X.
    assert.equal(result.pointCount, 9);
    assert.deepEqual(result.bounds, { minX: -1.5, maxX: 10, minY: 0, maxY: 20, minZ: 0, maxZ: 5 });
  });

  it('accepts the ArrayBuffer entry point identically to the text entry point', () => {
    const buffer = loadFixture('test-box.stp');
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const viaBuffer = parseSTEP(arrayBuffer);
    const viaText = parseSTEPText(buffer.toString('utf8'));
    assert.deepEqual(viaBuffer, viaText);
  });

  it('reports isValidStep=false and empty-but-safe bounds for a non-STEP file', () => {
    const result = parseSTEPText('this is not a step file at all');
    assert.equal(result.isValidStep, false);
    assert.equal(result.pointCount, 0);
    assert.deepEqual(result.bounds, { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 });
  });

  it('ignores a DIRECTION entity - different entity name, not a point - without corrupting bounds', () => {
    // The fixture's #9 is a DIRECTION entity, not a CARTESIAN_POINT - the regex matches on
    // entity name, so it must be skipped regardless of how many numbers it holds.
    const result = parseSTEPText(loadFixture('test-box.stp').toString('utf8'));
    assert.equal(result.pointCount, 9, 'DIRECTION entity must not inflate the point count');
  });
});
