import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadStlMesh } from '../src/providers/visualizer/stlMeshLoader';

const ASCII_STL = `solid box
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid box`;

describe('STL mesh loader', () => {
  it('returns triangle positions for an ASCII STL solid', () => {
    const bytes = Buffer.from(ASCII_STL, 'utf8');
    const stl = loadStlMesh(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

    assert.equal(stl.format, 'ascii');
    assert.equal(stl.triangleCount, 1);
    assert.equal(stl.positions.length, 9);
    assert.deepEqual(Array.from(stl.positions), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    assert.deepEqual(stl.bounds, { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 0 });
  });

  it('caps very large imports by triangle count', () => {
    const bytes = Buffer.from(`${ASCII_STL}\n${ASCII_STL}`, 'utf8');
    const stl = loadStlMesh(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 1);

    assert.equal(stl.triangleCount, 1);
    assert.equal(stl.positions.length, 9);
  });
});

