export interface Bounds3D {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface GCodeEnvelope {
  units: 'in' | 'mm';
  bounds: Bounds3D;
  cutMoveCount: number;
}

export interface BoundsComparisonResult {
  matches: boolean;
  tolerance: number;
  deltas: Bounds3D;
}

function createEmptyBounds(): Bounds3D {
  return {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  };
}

function expandBounds(bounds: Bounds3D, x: number, y: number, z: number): void {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxY = Math.max(bounds.maxY, y);
  bounds.minZ = Math.min(bounds.minZ, z);
  bounds.maxZ = Math.max(bounds.maxZ, z);
}

function finalizeBounds(bounds: Bounds3D): Bounds3D {
  if (!Number.isFinite(bounds.minX)) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  }
  return bounds;
}

export function extractGCodeCutBounds(gcode: string): GCodeEnvelope {
  const parsed = parseGCodeToPath(gcode);
  const bounds = createEmptyBounds();
  const cutLines = new Set<number>();
  for (let index = 1; index < parsed.path.length; index++) {
    const start = parsed.path[index - 1];
    const end = parsed.path[index];
    if (end.isRapid) continue;
    expandBounds(bounds, start.x, start.y, start.z ?? 0);
    expandBounds(bounds, end.x, end.y, end.z ?? 0);
    if (end.lineNumber !== undefined) cutLines.add(end.lineNumber);
  }

  return {
    units: parsed.units,
    bounds: finalizeBounds(bounds),
    cutMoveCount: cutLines.size,
  };
}

export function compareBounds(actual: Bounds3D, expected: Bounds3D, tolerance: number): BoundsComparisonResult {
  const deltas: Bounds3D = {
    minX: Math.abs(actual.minX - expected.minX),
    maxX: Math.abs(actual.maxX - expected.maxX),
    minY: Math.abs(actual.minY - expected.minY),
    maxY: Math.abs(actual.maxY - expected.maxY),
    minZ: Math.abs(actual.minZ - expected.minZ),
    maxZ: Math.abs(actual.maxZ - expected.maxZ),
  };

  const matches = Object.values(deltas).every(delta => delta <= tolerance);
  return { matches, tolerance, deltas };
}
import { parseGCodeToPath } from './toolpathParser';
