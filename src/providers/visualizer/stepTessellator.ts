import type { Bounds3D } from './gcodeGoalComparison';

export interface TessellatedSTEP {
  bounds: Bounds3D;
  triangleCount: number;
  meshVertices: number[];
}

const MAX_TRIANGLES = 300_000;

export async function tessellateSTEP(content: Uint8Array): Promise<TessellatedSTEP> {
  // occt-import-js ships without TypeScript declarations and initializes its WASM kernel asynchronously.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const createOcct = require('occt-import-js') as () => Promise<any>;
  const occt = await createOcct();
  const result = occt.ReadStepFile(content, {
    linearUnit: 'millimeter',
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: 0.001,
    angularDeflection: 0.5,
  });
  if (!result?.success || !Array.isArray(result.meshes) || result.meshes.length === 0) {
    throw new Error('OpenCascade could not tessellate the STEP geometry');
  }

  const meshVertices: number[] = [];
  const bounds: Bounds3D = {
    minX: Infinity, maxX: -Infinity,
    minY: Infinity, maxY: -Infinity,
    minZ: Infinity, maxZ: -Infinity,
  };
  let triangleCount = 0;

  for (const mesh of result.meshes) {
    const positions: number[] = mesh?.attributes?.position?.array ?? [];
    const indices: number[] = mesh?.index?.array ?? [];
    for (let i = 0; i + 2 < indices.length && triangleCount < MAX_TRIANGLES; i += 3) {
      for (const index of [indices[i], indices[i + 1], indices[i + 2]]) {
        const x = Number(positions[index * 3]);
        const y = Number(positions[index * 3 + 1]);
        const z = Number(positions[index * 3 + 2]);
        if (![x, y, z].every(Number.isFinite)) throw new Error('STEP tessellation returned invalid vertices');
        meshVertices.push(x, y, z);
        bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
        bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
        bounds.minZ = Math.min(bounds.minZ, z); bounds.maxZ = Math.max(bounds.maxZ, z);
      }
      triangleCount++;
    }
    if (triangleCount >= MAX_TRIANGLES) break;
  }
  if (triangleCount === 0) throw new Error('STEP tessellation produced no triangles');
  return { bounds, triangleCount, meshVertices };
}
