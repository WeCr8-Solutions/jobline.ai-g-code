/**
 * Block classification helpers shared by the modal-state walker, the program
 * model and the diagnostics engine.
 */

import type { GCodeBlock } from './types';

/** G65 / G66 / G66.1 macro calls: every letter on the block is a macro argument. */
export function isMacroCallBlock(block: GCodeBlock): boolean {
  return block.gCodes.some(g => {
    const c = Math.floor(g.code);
    return c === 65 || c === 66;
  });
}

/**
 * Blocks whose X/Y/Z/A/B/C words are arguments or settings rather than motion:
 * macro calls (G65 P9995 A13. …), offset setting (G10 L2 P1 X… Y…) and dwell
 * (G04 X1.5 is 1.5 seconds, not an X position).
 */
export function isNonMotionAddressBlock(block: GCodeBlock): boolean {
  return isMacroCallBlock(block) || block.gCodes.some(g => {
    const c = Math.floor(g.code);
    return c === 10 || c === 4;
  });
}
