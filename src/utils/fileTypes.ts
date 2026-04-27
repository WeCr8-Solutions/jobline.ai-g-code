/**
 * JobLine — Shared G-code file type helpers
 *
 * Single source of truth for which file extensions are treated as G-code.
 * Import GCODE_EXT_PATTERN and isGCodeFile everywhere instead of duplicating
 * the regex. To add extensions: update GCODE_EXTENSIONS below and package.json.
 */

import * as vscode from 'vscode';

/**
 * All extensions recognised as G-code / NC programs by default.
 *
 * Extension groups:
 *   Standard / universal:   .nc .gcode .ngc .tap .cnc .g
 *   Fanuc / Haas:           .nc (primary) .ncc .ncp
 *   Okuma OSP:              .min .prg
 *   Siemens Sinumerik:      .mpf .spf
 *   Mazak Smooth/Matrix:    .eia .iso
 *   Heidenhain TNC:         .h  .cyc  .tab  .hpp
 *   Fadal:                  .fgc
 *   DNC transfer:           .dnc
 *   CAM post outputs:       .ncf .cls .apt
 *   KUKA Robot:             .src .ptp
 *   Numeric program IDs:    (handled via languageId fallback)
 */
export const GCODE_EXTENSIONS: readonly string[] = [
  // Core / universal
  'nc', 'gcode', 'ngc', 'tap', 'cnc', 'g',
  // Okuma OSP
  'min', 'prg',
  // Siemens Sinumerik
  'mpf', 'spf',
  // Mazak / EIA / ISO standard
  'eia', 'iso',
  // Heidenhain TNC
  'h', 'cyc', 'tab', 'hpp',
  // Haas NGC — 5-axis and generic variants
  '5ax',    // Haas 5-axis programs (e.g. UMC-500, UMC-750)
  'ncc',    // Haas generic NC code
  'ncp',    // Haas NC program
  'ncf',    // NC file (various CAM posts targeting Haas)
  'nc1',    // Haas numbered program variant
  // Fadal
  'fgc',
  // DNC transfer files
  'dnc',
  // CAM post outputs (CATIA APT, NX .cls)
  'apt', 'cls',
  // KUKA Robot programs (.src also used by many CAM posts)
  'src', 'ptp',
  // Generic shop-floor post-processor outputs
  'sub',    // subprogram files (Fanuc/Haas)
  'lib',    // macro library files
];

/** Pre-compiled regex from the base extension list. */
export const GCODE_EXT_PATTERN = new RegExp(
  `\\.(${GCODE_EXTENSIONS.join('|')})$`,
  'i'
);

/**
 * Returns true if a document should be treated as G-code.
 * Checks in order:
 *   1. VS Code languageId assigned by package.json grammar contribution
 *   2. File extension matches base list
 *   3. User-configured additional extensions (jobline.additionalExtensions)
 */
export function isGCodeFile(document: vscode.TextDocument): boolean {
  if (document.languageId === 'gcode') return true;
  if (GCODE_EXT_PATTERN.test(document.fileName)) return true;

  // User-configured extras (e.g. shop-specific: ".001", ".cpp", ".sub")
  const extras = vscode.workspace.getConfiguration('jobline')
    .get<string[]>('additionalExtensions', []);
  if (extras.length > 0) {
    const extraPattern = new RegExp(
      `\\.(${extras.map(e => e.replace(/^\./, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`,
      'i'
    );
    if (extraPattern.test(document.fileName)) return true;
  }

  return false;
}

/**
 * Glob pattern for workspace file searches (subprogram provider, etc.)
 * Includes user-configured extras at call-time.
 */
export function gcodeGlobPattern(): string {
  const extras = vscode.workspace.getConfiguration('jobline')
    .get<string[]>('additionalExtensions', [])
    .map(e => e.replace(/^\./, ''));
  const all = extras.length > 0
    ? [...GCODE_EXTENSIONS, ...extras]
    : GCODE_EXTENSIONS;
  return `**/*.{${all.join(',')}}`;
}
