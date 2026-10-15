/**
 * RevPack parity snapshot, shared by the JobLine G-Code extension,
 * jobline.ai-CAM and the JobLine.ai shop app (shift-handover-hub).
 *
 * Kept byte-for-byte identical in all three repositories beside revpack.ts,
 * revpackCorrelation.ts and revpackGeometry.ts. Each repository's parity test
 * computes this snapshot for every public pack it carries and compares it with
 * revpack-geometry.golden.json, which is also identical in all three. If one
 * product draws or checks a pack differently, its test fails.
 */

import type { RevPack } from './revpack';
import { correlateProgramWithRevPack } from './revpackCorrelation';
import { buildRevPackGeometry, geometryDigest } from './revpackGeometry';

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
  };
}
