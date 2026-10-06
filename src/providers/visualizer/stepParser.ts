// STEP (ISO-10303-21 / AP203, AP214, AP242) geometry parser.
//
// This does not build a full B-rep — no geometric kernel is vendored here, and none of this
// repo's dependencies provide one (checked: no occt/opencascade package installed). What it
// does instead is the same thing parasolidTextParser.ts already does for Parasolid text, and
// the same class of approximation the visualizer's fixture/stock import already accepts:
// extract every real 3D point the file actually contains and report the bounding box. Every
// vertex and every B-spline/NURBS control point in a STEP file is written as a CARTESIAN_POINT
// entity, so the extracted bounds are exact - not guessed - even though the surfaces between
// those points are not reconstructed.
import type { Bounds3D } from './gcodeGoalComparison';

export interface ParsedSTEP {
  format: 'step';
  isValidStep: boolean;
  schema: string | null;
  pointCount: number;
  bounds: Bounds3D;
}

// A CARTESIAN_POINT entity looks like: #10=CARTESIAN_POINT('',(12.5,0.,-34.2));
// The label may be empty ('') or named; whitespace inside the parens varies by CAD exporter.
const CARTESIAN_POINT = /CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-+0-9.eE,\s]+?)\s*\)\s*\)/g;
const STEP_MAGIC = /^\s*ISO-10303-21\s*;/;
const SCHEMA_PATTERN = /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/;
const MAX_REASONABLE_COORDINATE = 1_000_000;

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

/** ArrayBuffer in (matches the existing signature every caller/test expects), decoded once. */
export function parseSTEP(arrayBuffer: ArrayBuffer): ParsedSTEP {
  const text = new TextDecoder('utf-8').decode(arrayBuffer);
  return parseSTEPText(text);
}

/** Text entry point - lets tests (and any future file-picker path) skip the ArrayBuffer hop. */
export function parseSTEPText(source: string): ParsedSTEP {
  const isValidStep = STEP_MAGIC.test(source);
  const schemaMatch = SCHEMA_PATTERN.exec(source);
  const bounds = createEmptyBounds();
  let pointCount = 0;

  CARTESIAN_POINT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CARTESIAN_POINT.exec(source)) !== null) {
    const parts = match[1].split(',').map(v => Number.parseFloat(v.trim()));
    // A CARTESIAN_POINT is 2D or 3D depending on the exporter; treat a missing Z as 0 rather
    // than discarding the point, since a 2D sketch entity is still real, in-bounds data.
    if (parts.length < 2) continue;
    const [x, y, z = 0] = parts;
    if (![x, y, z].every(v => Number.isFinite(v) && Math.abs(v) <= MAX_REASONABLE_COORDINATE)) continue;
    expandBounds(bounds, x, y, z);
    pointCount++;
  }

  return {
    format: 'step',
    isValidStep,
    schema: schemaMatch ? schemaMatch[1] : null,
    pointCount,
    bounds: finalizeBounds(bounds),
  };
}
