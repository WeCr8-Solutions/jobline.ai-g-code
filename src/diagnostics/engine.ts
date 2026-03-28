/**
 * JobLine Diagnostics Engine — Pure, framework-free rule runner
 *
 * No dependency on `vscode`. Takes parsed blocks + config, returns plain
 * diagnostic objects. This module is the single source of truth for all
 * diagnostic rules; both the VS Code provider and the headless test runner
 * import from here.
 */

import { GCodeBlock, ModalState } from '../parser/types';
import type { MachineLibraryEntry } from '../types/machineLibrary';

// ── Public types ─────────────────────────────────────────────────────────────

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface EngineDiagnostic {
  /** 0-based source line number (matches block.line) */
  line: number;
  severity: DiagnosticSeverity;
  message: string;
  source: 'JobLine';
}

export interface DiagnosticConfig {
  controlType: string;
  arcTolerance: number;
  enableSafetyChecks: boolean;
  enableArcValidation: boolean;
  /**
   * Optional machine profile loaded from the hub marketplace.
   * When present, axis travel limits are validated and warnings are emitted
   * for any motion block whose absolute position exceeds the machine's travel.
   * If absent, travel-limit checks are silently skipped (graceful no-op).
   */
  machineProfile?: MachineLibraryEntry;
}

export const DEFAULT_CONFIG: DiagnosticConfig = {
  controlType: 'fanuc',
  arcTolerance: 0.001,
  enableSafetyChecks: true,
  enableArcValidation: true,
};

// ── Canned cycle codes that require Z and R ───────────────────────────────────

// Note: G76 removed — Fanuc G76 uses 2-line format (line 1 has no Z)
const CANNED_CYCLE_CODES = new Set([73, 74, 81, 82, 83, 84, 85, 86, 87, 88, 89]);

// ── Main engine entry point ───────────────────────────────────────────────────

/**
 * Run all diagnostic rules against a parsed program.
 *
 * @param blocks      Output of BlockParser.parseDocument()
 * @param stateAtBlock Output of ProgramModelBuilder.build().stateAtBlock
 * @param config      Rule configuration (tolerances, feature flags)
 * @returns           Array of diagnostics sorted by line number
 */
export function runDiagnosticEngine(
  blocks: GCodeBlock[],
  stateAtBlock: ModalState[],
  config: DiagnosticConfig = DEFAULT_CONFIG,
): EngineDiagnostic[] {
  const diags: EngineDiagnostic[] = [];

  // End-of-program state tracking
  let spindleOn = false;
  let coolantOn = false;
  let seenM05 = false;
  let seenM09 = false;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const state: ModalState = stateAtBlock[i] ?? stateAtBlock[stateAtBlock.length - 1];

    // ── Track spindle / coolant state ────────────────────────────────────
    for (const m of block.mCodes) {
      if (m.code === 3 || m.code === 4) { spindleOn = true; seenM05 = false; }
      if (m.code === 5)                  { seenM05 = true; }
      if (m.code === 8 || m.code === 7)  { coolantOn = true; seenM09 = false; }
      if (m.code === 9)                  { seenM09 = true; }
      if (m.code === 30 || m.code === 2) {
        if (config.enableSafetyChecks) {
          const endLine = block.line;
          if (spindleOn && !seenM05) {
            diags.push(warn(endLine, 'Spindle may still be running at program end'));
          }
          if (coolantOn && !seenM09) {
            diags.push(warn(endLine, 'Coolant may still be on at program end'));
          }
          // Reset for next sub-program
          spindleOn = false; coolantOn = false; seenM05 = false; seenM09 = false;
        }
      }
    }

    // ── Rule set 1: Canned cycle parameter completeness ──────────────────
    for (const g of block.gCodes) {
      const intCode = Math.floor(g.code);

      if (CANNED_CYCLE_CODES.has(intCode)) {
        const hasZ = block.addresses.has('Z') || state.cannedCycleParams.has('Z');
        const hasR = block.addresses.has('R') || state.cannedCycleParams.has('R');
        const hasQ = block.addresses.has('Q') || state.cannedCycleParams.has('Q');
        const hasF = block.addresses.has('F') || state.activeF !== null;

        if (!hasZ) {
          diags.push(err(block.line, 'Canned cycle requires Z (depth)'));
        }
        if (!hasR) {
          diags.push(err(block.line, 'Canned cycle requires R (R-plane)'));
        }
        if ((intCode === 83 || intCode === 73) && !hasQ) {
          diags.push(err(block.line, `G${intCode} peck cycle requires Q (peck depth)`));
        }
        if ((intCode === 84 || intCode === 74) && !hasF) {
          diags.push(err(block.line, `Tapping cycle G${intCode} requires F (feed = pitch × RPM)`));
        }
      }
    }

    // ── Rule set 2: Safety — M06 without preceding safe-Z ────────────────
    // Looks back from the current M06, stopping at:
    //   (a) a previous M06 — so a G28 from an earlier operation isn't reused
    //   (b) 15 source lines — backstop for programs with no prior tool change
    if (config.enableSafetyChecks && block.mCodes.some(m => m.code === 6)) {
      let foundSafeZ = false;
      for (let j = i - 1; j >= 0; j--) {
        const prev = blocks[j];
        if (block.line - prev.line > 15) break;          // (b) line-distance backstop
        if (prev.mCodes.some(m => m.code === 6)) break;  // (a) previous tool change
        const hasG28  = prev.gCodes.some(g => Math.floor(g.code) === 28);
        const hasG30  = prev.gCodes.some(g => Math.floor(g.code) === 30);
        const hasG53Z = prev.gCodes.some(g => Math.floor(g.code) === 53) &&
          prev.addresses.has('Z');
        if (hasG28 || hasG30 || hasG53Z) { foundSafeZ = true; break; }
      }
      if (!foundSafeZ) {
        diags.push(warn(block.line,
          'Possible unsafe tool change: no safe-Z retract found before M06'));
      }
    }

    // ── Rule set 3: Arc geometry — G02/G03 center-offset radius check ────
    // stateAtBlock[i] is the state AFTER block i runs, so the entering
    // (start) position for block i is stateAtBlock[i-1].
    if (config.enableArcValidation) {
      for (const g of block.gCodes) {
        if (Math.floor(g.code) === 2 || Math.floor(g.code) === 3) {
          const enteringState = stateAtBlock[i > 0 ? i - 1 : 0];
          const arcDiag = checkArcGeometry(block, enteringState, config.arcTolerance);
          if (arcDiag) diags.push(arcDiag);
        }
      }
    }

    // ── Rule set 4: Machine travel limit check ────────────────────────────
    // Only runs when a machine profile is loaded (graceful no-op otherwise).
    // Checks absolute-mode motion blocks (G0, G1, G2, G3) against the
    // machine's max axis travel stored in the hub MachineLibraryEntry.
    //
    // Unit handling:
    //   G20 (activeUnits === 20) → program is in inches → multiply by 25.4
    //   G21 (activeUnits === 21) → program is in metric (mm) → use as-is
    //   Hub stores travel limits in mm.
    //
    // Limitation: positions are work-offset-relative (G54, etc.), not
    // machine-absolute. This heuristic is useful for catching obvious
    // out-of-range values but may produce false positives for large offsets.
    if (config.machineProfile && state.activePositioning === 90) {
      const isMotionBlock = block.gCodes.some(g => {
        const c = Math.floor(g.code);
        return c === 0 || c === 1 || c === 2 || c === 3;
      });

      if (isMotionBlock) {
        const travelDiags = checkTravelLimits(block.line, state, config.machineProfile);
        for (const d of travelDiags) diags.push(d);
      }
    }
  }

  // Tag source and sort
  for (const d of diags) d.source = 'JobLine';
  diags.sort((a, b) => a.line - b.line);

  return diags;
}

// ── Arc geometry checker ──────────────────────────────────────────────────────

function checkArcGeometry(
  block: GCodeBlock,
  state: ModalState,
  tolerance: number,
): EngineDiagnostic | null {
  const I = block.addresses.get('I')?.resolvedValue ?? null;
  const J = block.addresses.get('J')?.resolvedValue ?? null;
  const K = block.addresses.get('K')?.resolvedValue ?? null;

  // Only validate center-offset arcs (I,J,K present)
  if (I === null && J === null && K === null) return null;

  const startX = state.currentPosition.X ?? 0;
  const startY = state.currentPosition.Y ?? 0;

  const endX = block.addresses.get('X')?.resolvedValue ?? startX;
  const endY = block.addresses.get('Y')?.resolvedValue ?? startY;

  const cx = startX + (I ?? 0);
  const cy = startY + (J ?? 0);

  const r1 = Math.sqrt((startX - cx) ** 2 + (startY - cy) ** 2);
  const r2 = Math.sqrt((endX   - cx) ** 2 + (endY   - cy) ** 2);
  const delta = Math.abs(r1 - r2);

  if (delta > tolerance) {
    return err(block.line,
      `Arc endpoint doesn't match center offset (radius error: ${delta.toFixed(6)})`);
  }
  return null;
}

// ── Travel limit checker ──────────────────────────────────────────────────────

/**
 * Checks X/Y/Z positions in the current modal state against the machine's
 * travel limits from the hub MachineLibraryEntry.
 *
 * Returns zero or more warning diagnostics — one per axis that exceeds its
 * limit. Warnings (not errors) are used because work-offset-relative positions
 * can legitimately appear large without truly exceeding machine travel.
 */
function checkTravelLimits(
  line: number,
  state: ModalState,
  profile: MachineLibraryEntry,
): EngineDiagnostic[] {
  const diags: EngineDiagnostic[] = [];

  // Conversion factor: hub stores travel in mm; G20 programs are in inches.
  const toMm = state.activeUnits === 20 ? 25.4 : 1;

  const axes: Array<{ letter: string; pos: number | undefined; limit: number | null }> = [
    { letter: 'X', pos: state.currentPosition.X, limit: profile.max_x_travel },
    { letter: 'Y', pos: state.currentPosition.Y, limit: profile.max_y_travel },
    { letter: 'Z', pos: state.currentPosition.Z, limit: profile.max_z_travel },
  ];

  for (const { letter, pos, limit } of axes) {
    if (pos === undefined || pos === null || limit === null) continue;
    const posMm = Math.abs(pos) * toMm;
    if (posMm > limit) {
      diags.push(warn(
        line,
        `${letter} position ${pos.toFixed(4)} exceeds machine travel limit ` +
        `(${letter}: ${limit} mm | profile: ${profile.manufacturer} ${profile.model})`,
      ));
    }
  }

  return diags;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function err(line: number, message: string): EngineDiagnostic {
  return { line, severity: 'error', message, source: 'JobLine' };
}

function warn(line: number, message: string): EngineDiagnostic {
  return { line, severity: 'warning', message, source: 'JobLine' };
}
