/**
 * The AR4 real-part set used for solid-import checks (Annin Robotics AR4
 * servo gripper SG1, STEP + STL pairs as Annin publishes them).
 *
 * Licence: Annin Robotics Open Source Non-Commercial License v1.1 (2025),
 * https://github.com/Annin-Robotics/ar4-hmi/blob/main/LICENSE.txt - section 2
 * allows educational/research/personal non-commercial use and forbids
 * redistributing the design files, so they stay local and gitignored
 * (test/fixtures/external-local/ar4/, with the licence text beside them).
 * Only their digests (ar4-parts.golden.json) are committed.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface Ar4Part { id: string; stl: string; step?: string; what: string }

export const AR4_PARTS: Ar4Part[] = [
  { id: 'sg1-base', stl: 'AR4_SG1_base.STL', step: 'AR4_SG1_base.STEP', what: 'gripper base: pocketed plate, bores, slots' },
  { id: 'sg1-carriage', stl: 'AR4_SG1_carriage.STL', step: 'AR4_SG1_carriage.STEP', what: 'jaw carriage: rack teeth, rod bores, multi-feature' },
  { id: 'sg1-gear', stl: 'AR4_SG1_gear.STL', step: 'AR4_SG1_gear.STEP', what: 'spur gear: involute teeth, hub, curved' },
  { id: 'sg1-jaw1', stl: 'AR4_SG1_jaw1.STL', step: 'AR4_SG1_jaw1.STEP', what: 'gripper jaw: stepped, angled faces, holes' },
  { id: 'sg1-center-bar', stl: 'AR4_SG1_center_bar.STL', step: 'AR4_SG1_center_bar.STEP', what: 'centre bar: slotted bar with bores' },
];

/** Folder holding the AR4 files, or undefined (the checks then skip). */
export function ar4Dir(): string | undefined {
  const candidates = [process.env.JOBLINE_AR4_DIR ?? '', path.join(__dirname, 'fixtures', 'external-local', 'ar4')];
  return candidates.find(dir => dir && AR4_PARTS.every(part => fs.existsSync(path.join(dir, part.stl))));
}
