/**
 * JobLine Modal State Machine
 * Architecture v0.4.0 Section 8
 *
 * Tracks the cumulative machine state as blocks are processed sequentially.
 * Every G-code, M-code, and address potentially changes the modal state.
 * The state at any line tells you exactly what the machine "knows" at that point.
 */

import {
  ModalState,
  GCodeBlock,
  GCode,
  MCode,
  cloneModalState,
} from '../parser/types';

// =============================================================================
// Modal group definitions — which G-codes cancel which
// =============================================================================

/** Group 1: Motion mode (mutually exclusive) */
const MOTION_CODES = new Set([0, 1, 2, 3, 73, 74, 76, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89]);

/** Group 2: Plane selection */
const PLANE_CODES = new Map<number, 17 | 18 | 19>([[17, 17], [18, 18], [19, 19]]);

/** Group 3: Absolute/incremental */
const POSITIONING_CODES = new Map<number, 90 | 91>([[90, 90], [91, 91]]);

/** Group 5: Feed mode */
const FEED_MODE_CODES = new Map<number, 94 | 95>([[94, 94], [95, 95]]);

/** Group 6: Units */
const UNIT_CODES = new Map<number, 20 | 21>([[20, 20], [21, 21]]);

/** Canned cycle codes */
const CANNED_CYCLE_CODES = new Set([73, 74, 76, 81, 82, 83, 84, 85, 86, 87, 88, 89]);

/** Codes that indicate safe Z retract */
const SAFE_Z_CODES = new Set([28, 30]);

/** Spindle mode codes */
const SPINDLE_MODE_CODES = new Map<number, 96 | 97>([[96, 96], [97, 97]]);

// =============================================================================
// State updater
// =============================================================================

export class ModalStateUpdater {
  /**
   * Update modal state based on a parsed block.
   * Returns the new state (original is not mutated).
   */
  updateState(currentState: ModalState, block: GCodeBlock): ModalState {
    const state = cloneModalState(currentState);

    // Process G-codes (order matters: plane before motion, etc.)
    for (const g of block.gCodes) {
      this.applyGCode(state, g, block);
    }

    // Process M-codes
    for (const m of block.mCodes) {
      this.applyMCode(state, m);
    }

    // Process addresses (F, S, T, H, D, positions)
    this.applyAddresses(state, block);

    // Track safe Z status
    this.updateSafeZTracking(state, block);

    return state;
  }

  // ===========================================================================
  // G-code application
  // ===========================================================================

  private applyGCode(state: ModalState, g: GCode, block: GCodeBlock): void {
    const code = g.code;
    const intCode = Math.floor(code);

    // Motion mode (Group 1)
    if (MOTION_CODES.has(intCode)) {
      state.activeMotion = intCode;

      // Canned cycle activation
      if (CANNED_CYCLE_CODES.has(intCode)) {
        state.activeCannedCycle = intCode;
        // Capture canned cycle parameters
        state.cannedCycleParams = new Map();
        for (const [letter, addr] of block.addresses) {
          if (addr.resolvedValue !== null) {
            state.cannedCycleParams.set(letter, addr.resolvedValue);
          }
        }
        // Track R-plane
        const rAddr = block.addresses.get('R');
        if (rAddr && rAddr.resolvedValue !== null) {
          state.lastRPlane = rAddr.resolvedValue;
        }
      }

      // G80 cancels canned cycle
      if (intCode === 80) {
        state.activeCannedCycle = null;
        state.cannedCycleParams = new Map();
      }
    }

    // Plane (Group 2)
    if (PLANE_CODES.has(intCode)) {
      state.activePlane = PLANE_CODES.get(intCode)!;
    }

    // Positioning (Group 3)
    if (POSITIONING_CODES.has(intCode)) {
      state.activePositioning = POSITIONING_CODES.get(intCode)!;
    }

    // Arc center mode (G90.1 / G91.1)
    if (code === 90.1) state.arcCenterMode = 90.1;
    if (code === 91.1) state.arcCenterMode = 91.1;

    // Feed mode (Group 5)
    if (FEED_MODE_CODES.has(intCode)) {
      state.activeFeedMode = FEED_MODE_CODES.get(intCode)!;
    }

    // Units (Group 6)
    if (UNIT_CODES.has(intCode)) {
      state.activeUnits = UNIT_CODES.get(intCode)!;
    }

    // Spindle mode (Group 13)
    if (SPINDLE_MODE_CODES.has(intCode)) {
      state.spindleMode = SPINDLE_MODE_CODES.get(intCode)!;
      if (intCode === 97) {
        // Switching to constant RPM clears CSS clamp
        state.maxSpindleClamp = null;
      }
    }

    // G50 max spindle clamp (lathe)
    if (intCode === 50) {
      const sAddr = block.addresses.get('S');
      if (sAddr && sAddr.resolvedValue !== null) {
        state.maxSpindleClamp = sAddr.resolvedValue;
      }
    }

    // Safe Z codes (G28, G30)
    if (SAFE_Z_CODES.has(intCode)) {
      state.isAtSafeZ = true;
    }

    // G53 with Z move — also safe Z
    if (intCode === 53) {
      const zAddr = block.addresses.get('Z');
      if (zAddr) {
        state.isAtSafeZ = true;
      }
    }

    // Work offset (G54-G59, G54.1)
    if (intCode >= 54 && intCode <= 59) {
      state.activeWorkOffset = `G${code}`;
    }

    // Compensation
    if (intCode === 43) {
      const hAddr = block.addresses.get('H');
      if (hAddr && hAddr.resolvedValue !== null) {
        state.activeToolOffset = { ...state.activeToolOffset, H: hAddr.resolvedValue };
      }
    }
    if (intCode === 49) {
      state.activeToolOffset = { H: null, D: null };
    }
    if (intCode === 41 || intCode === 42) {
      const dAddr = block.addresses.get('D');
      if (dAddr && dAddr.resolvedValue !== null) {
        state.activeToolOffset = { ...state.activeToolOffset, D: dAddr.resolvedValue };
      }
    }
    if (intCode === 40) {
      state.activeToolOffset = { ...state.activeToolOffset, D: null };
    }
  }

  // ===========================================================================
  // M-code application
  // ===========================================================================

  private applyMCode(state: ModalState, m: MCode): void {
    switch (m.code) {
      // Spindle
      case 3:
        state.spindleDirection = 'CW';
        break;
      case 4:
        state.spindleDirection = 'CCW';
        break;
      case 5:
        state.spindleDirection = 'OFF';
        break;

      // Coolant
      case 7:
        state.coolantState = 'mist';
        break;
      case 8:
        state.coolantState = 'flood';
        break;
      case 9:
        state.coolantState = 'off';
        break;

      // Tool change
      case 6:
        // Tool number updated via T address
        break;

      // Program end — reset modal state to defaults
      case 2:
      case 30:
        state.spindleDirection = 'OFF';
        state.coolantState = 'off';
        state.activeCannedCycle = null;
        state.cannedCycleParams = new Map();
        state.isAtSafeZ = true;
        break;

      // Subprogram call
      case 98:
        // Handled by program model (push call stack)
        break;
      case 99:
        // Handled by program model (pop call stack)
        break;
    }
  }

  // ===========================================================================
  // Address application
  // ===========================================================================

  private applyAddresses(state: ModalState, block: GCodeBlock): void {
    // Feed rate
    const fAddr = block.addresses.get('F');
    if (fAddr && fAddr.resolvedValue !== null) {
      state.activeF = fAddr.resolvedValue;
    }

    // Spindle speed
    const sAddr = block.addresses.get('S');
    if (sAddr && sAddr.resolvedValue !== null) {
      state.activeS = sAddr.resolvedValue;
    }

    // Tool number
    if (block.toolNumber !== undefined) {
      state.activeTool = block.toolNumber;
    }

    // Position tracking — only for resolved literal coordinates
    this.updateAxis(state, block, 'X');
    this.updateAxis(state, block, 'Y');
    this.updateAxis(state, block, 'Z');
    this.updateAxis(state, block, 'A');
    this.updateAxis(state, block, 'B');
    this.updateAxis(state, block, 'C');
  }

  // ===========================================================================
  // Position axis helper
  // ===========================================================================

  private updateAxis(state: ModalState, block: GCodeBlock, axis: string): void {
    const addr = block.addresses.get(axis);
    if (!addr || addr.resolvedValue === null) return;

    const key = axis as keyof typeof state.currentPosition;
    if (state.activePositioning === 90) {
      state.currentPosition[key] = addr.resolvedValue;
    } else {
      const current = state.currentPosition[key] ?? 0;
      state.currentPosition[key] = current + addr.resolvedValue;
    }
  }

  // ===========================================================================
  // Safe Z tracking
  // ===========================================================================

  private updateSafeZTracking(state: ModalState, block: GCodeBlock): void {
    // Any cutting move or rapid below certain Z clears safe Z
    const hasMotion = block.gCodes.some(g => [0, 1, 2, 3].includes(Math.floor(g.code)));
    if (!hasMotion) return;

    // If we have a Z move in a cutting mode (G01/G02/G03), we're not at safe Z
    const zAddr = block.addresses.get('Z');
    if (zAddr && state.activeMotion !== null && state.activeMotion !== 0) {
      state.isAtSafeZ = false;
    }

    // Rapid moves don't necessarily mean unsafe, but G00 Z below R-plane does
    if (state.activeMotion === 0 && zAddr && zAddr.resolvedValue !== null) {
      if (state.lastRPlane !== null && zAddr.resolvedValue < state.lastRPlane) {
        state.isAtSafeZ = false;
      }
    }

    // G28/G30/G53 Z already handled in applyGCode
  }
}
