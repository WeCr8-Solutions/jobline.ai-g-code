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

// CAM connections live in src/cam (file-based: NC output + setup sheets).
// These names are kept for callers of the old placeholders; each returns a
// plain statement of what the integration does instead of "Not implemented".
import { camSystem } from '../../../cam/camSources';

function describeCam(id: Parameters<typeof camSystem>[0], fallback: string): string {
  const info = camSystem(id);
  return info ? `${info.label}: ${info.does} ${info.doesNot}` : fallback;
}
export function connectToEspritCAM() { return describeCam('esprit', 'ESPRIT'); }
export function connectToMastercam() { return describeCam('mastercam', 'Mastercam'); }
export function connectToGibbsCAM() { return describeCam('gibbscam', 'GibbsCAM'); }
export function connectToHexagonCAM() { return describeCam('hexagon', 'Hexagon'); }
export function connectToOtherCAM(name: string) {
  return `${name}: file-based only. Point JobLine at the folder the post writes to; it reads NC output and setup sheets. No live connection.`;
}
