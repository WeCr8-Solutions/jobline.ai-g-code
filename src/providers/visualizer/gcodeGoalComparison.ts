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

function readAxis(line: string, axis: 'X' | 'Y' | 'Z'): number | null {
  const match = line.match(new RegExp(`\\b${axis}([-+]?\\d*\\.?\\d+)`, 'i'));
  return match ? Number.parseFloat(match[1]) : null;
}

export function extractGCodeCutBounds(gcode: string): GCodeEnvelope {
  const lines = gcode.split(/\r?\n/);
  const bounds = createEmptyBounds();
  let units: 'in' | 'mm' = 'in';
  let x = 0;
  let y = 0;
  let z = 0;
  let motionMode = 0;
  let cutMoveCount = 0;

  for (const rawLine of lines) {
    const line = rawLine.toUpperCase();
    if (/\bG20\b/.test(line)) units = 'in';
    if (/\bG21\b/.test(line)) units = 'mm';

    const motionMatch = line.match(/\bG0*([0123])\b/);
    if (motionMatch) {
      motionMode = Number.parseInt(motionMatch[1], 10);
    }

    const xVal = readAxis(line, 'X');
    const yVal = readAxis(line, 'Y');
    const zVal = readAxis(line, 'Z');
    const hasMove = xVal !== null || yVal !== null || zVal !== null;
    if (!hasMove) continue;

    const nextX = xVal ?? x;
    const nextY = yVal ?? y;
    const nextZ = zVal ?? z;

    if (motionMode !== 0) {
      expandBounds(bounds, x, y, z);
      expandBounds(bounds, nextX, nextY, nextZ);
      cutMoveCount += 1;
    }

    x = nextX;
    y = nextY;
    z = nextZ;
  }

  return {
    units,
    bounds: finalizeBounds(bounds),
    cutMoveCount,
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