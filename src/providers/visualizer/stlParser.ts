export interface STLBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface ParsedSTL {
  format: 'ascii' | 'binary';
  triangleCount: number;
  bounds: STLBounds;
}

function createEmptyBounds(): STLBounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  };
}

function expandBounds(bounds: STLBounds, x: number, y: number, z: number): void {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxY = Math.max(bounds.maxY, y);
  bounds.minZ = Math.min(bounds.minZ, z);
  bounds.maxZ = Math.max(bounds.maxZ, z);
}

function finalizeBounds(bounds: STLBounds): STLBounds {
  if (!Number.isFinite(bounds.minX)) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  }
  return bounds;
}

function isBinarySTL(arrayBuffer: ArrayBufferLike): boolean {
  if (arrayBuffer.byteLength < 84) return false;
  const view = new DataView(arrayBuffer);
  const triangleCount = view.getUint32(80, true);
  return 84 + triangleCount * 50 === arrayBuffer.byteLength;
}

function parseBinarySTL(arrayBuffer: ArrayBufferLike): ParsedSTL {
  const view = new DataView(arrayBuffer);
  const triangleCount = view.getUint32(80, true);
  const bounds = createEmptyBounds();

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
    const baseOffset = 84 + triangleIndex * 50 + 12;
    for (let vertexIndex = 0; vertexIndex < 3; vertexIndex++) {
      const vertexOffset = baseOffset + vertexIndex * 12;
      const x = view.getFloat32(vertexOffset, true);
      const y = view.getFloat32(vertexOffset + 4, true);
      const z = view.getFloat32(vertexOffset + 8, true);
      expandBounds(bounds, x, y, z);
    }
  }

  return {
    format: 'binary',
    triangleCount,
    bounds: finalizeBounds(bounds),
  };
}

function parseAsciiSTL(arrayBuffer: ArrayBufferLike): ParsedSTL {
  const text = Buffer.from(arrayBuffer).toString('utf8');
  const vertexPattern = /vertex\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
  const bounds = createEmptyBounds();

  let triangleCount = 0;
  let vertexInFacet = 0;
  let match: RegExpExecArray | null;

  while ((match = vertexPattern.exec(text)) !== null) {
    const x = Number.parseFloat(match[1]);
    const y = Number.parseFloat(match[2]);
    const z = Number.parseFloat(match[3]);
    expandBounds(bounds, x, y, z);
    vertexInFacet += 1;
    if (vertexInFacet === 3) {
      triangleCount += 1;
      vertexInFacet = 0;
    }
  }

  return {
    format: 'ascii',
    triangleCount,
    bounds: finalizeBounds(bounds),
  };
}

export function parseSTL(arrayBuffer: ArrayBufferLike): ParsedSTL {
  return isBinarySTL(arrayBuffer) ? parseBinarySTL(arrayBuffer) : parseAsciiSTL(arrayBuffer);
}
