import type { Bounds3D } from './gcodeGoalComparison';

export interface ParsedParasolidText {
  format: 'parasolid-text';
  pointCount: number;
  rawPointCount: number;
  bounds: Bounds3D;
}

interface Point3D {
  x: number;
  y: number;
  z: number;
}

const HEADER_TERMINATOR = '**END_OF_HEADER*****************************************************************';
const NUMBER_PATTERN = /[-+]?(?:\d+\.\d*|\.\d+|\d+(?:\.\d+)?[eE][-+]?\d+)/g;
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

function expandBounds(bounds: Bounds3D, point: Point3D): void {
  bounds.minX = Math.min(bounds.minX, point.x);
  bounds.maxX = Math.max(bounds.maxX, point.x);
  bounds.minY = Math.min(bounds.minY, point.y);
  bounds.maxY = Math.max(bounds.maxY, point.y);
  bounds.minZ = Math.min(bounds.minZ, point.z);
  bounds.maxZ = Math.max(bounds.maxZ, point.z);
}

function finalizeBounds(bounds: Bounds3D): Bounds3D {
  if (!Number.isFinite(bounds.minX)) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  }

  return bounds;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function getBodySection(source: string): string {
  const boundaryIndex = source.indexOf(HEADER_TERMINATOR);
  return boundaryIndex >= 0 ? source.slice(boundaryIndex + HEADER_TERMINATOR.length) : source;
}

function extractNumericValues(source: string): number[] {
  const body = getBodySection(source);
  const matches = body.match(NUMBER_PATTERN) ?? [];

  return matches
    .map(token => Number.parseFloat(token))
    .filter(value => Number.isFinite(value) && Math.abs(value) <= MAX_REASONABLE_COORDINATE);
}

function buildTriples(values: number[], offset: number): Point3D[] {
  const triples: Point3D[] = [];

  for (let index = offset; index + 2 < values.length; index += 3) {
    triples.push({
      x: values[index],
      y: values[index + 1],
      z: values[index + 2],
    });
  }

  return triples;
}

function filterDominantScale(points: Point3D[]): Point3D[] {
  if (points.length < 12) {
    return points;
  }

  const magnitudes = points.map(point => Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)));
  const medianMagnitude = median(magnitudes);
  const deviations = magnitudes.map(value => Math.abs(value - medianMagnitude));
  const mad = median(deviations);
  const threshold = medianMagnitude + Math.max(mad * 10, medianMagnitude * 0.5, 1e-6);
  const filtered = points.filter((point, index) => magnitudes[index] <= threshold);

  return filtered.length >= Math.max(12, Math.floor(points.length * 0.2)) ? filtered : points;
}

function selectBestPointCloud(values: number[]): { filtered: Point3D[]; rawCount: number } {
  let bestFiltered: Point3D[] = [];
  let bestRawCount = 0;

  for (let offset = 0; offset < 3; offset++) {
    const rawPoints = buildTriples(values, offset);
    const filtered = filterDominantScale(rawPoints);

    if (filtered.length > bestFiltered.length) {
      bestFiltered = filtered;
      bestRawCount = rawPoints.length;
    }
  }

  return { filtered: bestFiltered, rawCount: bestRawCount };
}

export function parseParasolidText(source: string): ParsedParasolidText {
  const values = extractNumericValues(source);
  const { filtered, rawCount } = selectBestPointCloud(values);
  const bounds = createEmptyBounds();

  for (const point of filtered) {
    expandBounds(bounds, point);
  }

  return {
    format: 'parasolid-text',
    pointCount: filtered.length,
    rawPointCount: rawCount,
    bounds: finalizeBounds(bounds),
  };
}