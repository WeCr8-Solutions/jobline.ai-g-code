/**
 * STL mesh import for the JobLine visualizer.
 *
 * Borrowed/adapted from jobline.ai-CAM's STL loader: the older g-code reader
 * measured bounds for verification, but a CAD/CAM-feeling viewport needs the
 * actual triangle positions so imported STL parts draw as solids.
 */

export interface StlMeshBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface LoadedStlMesh {
  format: 'ascii' | 'binary';
  triangleCount: number;
  /** x,y,z triples, 9 numbers per triangle, in the file's own coordinates. */
  positions: Float32Array;
  bounds: StlMeshBounds;
}

const EMPTY_BOUNDS: StlMeshBounds = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

function boundsOf(positions: Float32Array): StlMeshBounds {
  if (positions.length === 0) return { ...EMPTY_BOUNDS };

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function isBinaryStl(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 84) return false;
  const triangleCount = new DataView(buffer).getUint32(80, true);
  return 84 + triangleCount * 50 === buffer.byteLength;
}

function parseBinary(buffer: ArrayBuffer, maxTriangles: number): LoadedStlMesh {
  const view = new DataView(buffer);
  const declaredTriangleCount = view.getUint32(80, true);
  const triangleCount = Math.min(declaredTriangleCount, maxTriangles);
  const positions = new Float32Array(triangleCount * 9);

  let out = 0;
  for (let t = 0; t < triangleCount; t++) {
    const vertexBase = 84 + t * 50 + 12;
    for (let v = 0; v < 3; v++) {
      const o = vertexBase + v * 12;
      positions[out++] = view.getFloat32(o, true);
      positions[out++] = view.getFloat32(o + 4, true);
      positions[out++] = view.getFloat32(o + 8, true);
    }
  }

  return { format: 'binary', triangleCount, positions, bounds: boundsOf(positions) };
}

const VERTEX_RE =
  /vertex\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;

function parseAscii(buffer: ArrayBuffer, maxTriangles: number): LoadedStlMesh {
  const text = new TextDecoder('utf-8').decode(buffer);
  const values: number[] = [];
  const maxValues = maxTriangles * 9;

  VERTEX_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = VERTEX_RE.exec(text)) !== null && values.length < maxValues) {
    values.push(Number.parseFloat(match[1]), Number.parseFloat(match[2]), Number.parseFloat(match[3]));
  }

  const triangleCount = Math.floor(values.length / 9);
  const positions = new Float32Array(values.slice(0, triangleCount * 9));

  return { format: 'ascii', triangleCount, positions, bounds: boundsOf(positions) };
}

export function loadStlMesh(buffer: ArrayBuffer, maxTriangles = 50_000): LoadedStlMesh {
  return isBinaryStl(buffer) ? parseBinary(buffer, maxTriangles) : parseAscii(buffer, maxTriangles);
}

