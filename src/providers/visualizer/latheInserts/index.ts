// Barrel file for all ISO lathe insert shapes

import { getCInsertShape, C_INSERT_LABEL } from './C';
import { getDInsertShape, D_INSERT_LABEL } from './D';
import { getVInsertShape, V_INSERT_LABEL } from './V';
import { getSInsertShape, S_INSERT_LABEL } from './S';
import { getTInsertShape, T_INSERT_LABEL } from './T';
import { getWInsertShape, W_INSERT_LABEL } from './W';
import { getRInsertShape, R_INSERT_LABEL } from './R';

export type LatheInsertType = 'C' | 'D' | 'V' | 'S' | 'T' | 'W' | 'R';

export const LATHE_INSERT_TYPES: { code: LatheInsertType; name: string; }[] = [
  { code: 'C', name: C_INSERT_LABEL },
  { code: 'D', name: D_INSERT_LABEL },
  { code: 'V', name: V_INSERT_LABEL },
  { code: 'S', name: S_INSERT_LABEL },
  { code: 'T', name: T_INSERT_LABEL },
  { code: 'W', name: W_INSERT_LABEL },
  { code: 'R', name: R_INSERT_LABEL },
];

export function getLatheInsertShape(type: LatheInsertType, size: number, noseRadius: number = 0.4) {
  switch (type) {
    case 'C': return getCInsertShape(size, noseRadius);
    case 'D': return getDInsertShape(size, noseRadius);
    case 'V': return getVInsertShape(size, noseRadius);
    case 'S': return getSInsertShape(size, noseRadius);
    case 'T': return getTInsertShape(size, noseRadius);
    case 'W': return getWInsertShape(size, noseRadius);
    case 'R': return getRInsertShape(size, noseRadius);
    default: return getSInsertShape(size, noseRadius);
  }
}

// Placeholder for CAM software connect functions
export function connectToEspritCAM() {
  // TODO: Implement Esprit CAM connection
  return 'Not implemented';
}
export function connectToMastercam() {
  // TODO: Implement Mastercam connection
  return 'Not implemented';
}
export function connectToGibbsCAM() {
  // TODO: Implement GibbsCAM connection
  return 'Not implemented';
}
export function connectToHexagonCAM() {
  // TODO: Implement Hexagon connection
  return 'Not implemented';
}
export function connectToOtherCAM(name: string) {
  // TODO: Implement generic CAM connection
  return `Not implemented: ${name}`;
}
