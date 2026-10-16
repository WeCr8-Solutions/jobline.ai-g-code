/**
 * RevPack parity snapshot, shared by the JobLine G-Code extension,
 * jobline.ai-CAM and the JobLine.ai shop app (shift-handover-hub).
 *
 * Kept byte-for-byte identical in all three repositories beside revpack.ts,
 * revpackCorrelation.ts, revpackGeometry.ts and revpackPlacement.ts. Each repository's parity test
 * computes this snapshot for every public pack it carries and compares it with
 * revpack-geometry.golden.json, which is also identical in all three. If one
 * product draws or checks a pack differently, its test fails.
 */

import type { RevPack } from './revpack';
import { correlateProgramWithRevPack } from './revpackCorrelation';
import { buildRevPackGeometry, geometryDigest, loadStl, meshVolume } from './revpackGeometry';
import { placementDigest } from './revpackPlacement';

const round = (n: number): number => {
  const r = Math.round(n * 1e4) / 1e4;
  return Object.is(r, -0) ? 0 : r;
};

export function revPackParitySnapshot(pack: RevPack, gcode: string, targetStl?: ArrayBuffer | Uint8Array): Record<string, unknown> {
  const report = correlateProgramWithRevPack(gcode, pack);
  const geometry = buildRevPackGeometry(pack, { targetStl, segments: report.segments });
  const extents: Record<string, { min: number; max: number }> = {};
  for (const axis of Object.keys(report.machineExtents).sort()) {
    extents[axis] = { min: round(report.machineExtents[axis].min), max: round(report.machineExtents[axis].max) };
  }
  return {
    packId: pack.id,
    correlation: {
      summary: report.summary,
      findings: report.findings.map(finding => `${finding.line}:${finding.severity}:${finding.id}`),
      toolsUsed: report.toolsUsed,
      workOffsetsUsed: report.workOffsetsUsed,
      segments: report.segments.length,
      machineExtents: extents,
    },
    geometry: geometryDigest(geometry),
    // Part placement / work origin (revpackPlacement.ts): the 27 box points and
    // fixed placements applied to the pack - same origins, stock and G54 everywhere.
    placement: placementDigest(pack, geometry.target?.bounds, geometry.target?.positions),
  };
}

/**
 * Digest of one part file read through the shared STL reader: what every
 * product must agree on for an imported model (triangle count, wireframe edge
 * count, bounds and volume). Used for the AR4 real-part checks, whose files
 * stay local (their licence forbids redistribution) while the digests are
 * committed as ar4-parts.golden.json in all three repositories.
 */
export function meshFileDigest(stl: ArrayBuffer | Uint8Array): { format: string; triangles: number; edges: number; min: number[]; max: number[]; volume: number } {
  const mesh = loadStl(stl, 1_000_000);
  return {
    format: mesh.format,
    triangles: mesh.triangleCount,
    edges: mesh.edges.length / 6,
    min: mesh.bounds.min.map(round),
    max: mesh.bounds.max.map(round),
    volume: Math.round(meshVolume(mesh.positions) * 100) / 100,
  };
}
