/**
 * ISO / ANSI turning insert designations (ISO 1832).
 *
 * A turner reads CNMG432 the way a programmer reads a type signature, and the
 * designation is usually the only place a program records what is actually
 * cutting. Parsing it lets the preview draw the real insert instead of a
 * generic shape, and lets the geometry be pulled straight out of the program.
 *
 * Positions:
 *   1  shape                C = 80 deg rhombic, T = 60 deg triangle, ...
 *   2  clearance angle      N = 0 deg, C = 7 deg, P = 11 deg, ...
 *   3  tolerance class      M, G, A, ...
 *   4  type                 hole and chipbreaker form
 *   5+ size, thickness, corner radius
 *
 * Inch designations use eighths for the inscribed circle, sixteenths for
 * thickness and sixty-fourths for the corner radius: CNMG432 is a 1/2 inch IC,
 * 3/16 thick, 1/32 nose. Metric spells all three out in tenths of a millimetre
 * for the radius: CNMG120408 is 12.7 mm IC, 4.76 thick, 0.8 nose.
 */

export interface InsertShapeInfo {
  /** ISO shape letter. */
  code: string;
  /** Human name, as a machinist would say it. */
  name: string;
  /**
   * Included angle at the cutting corner, in degrees. Undefined for shapes
   * where the idea does not apply, such as round.
   */
  includedAngle?: number;
  /** Number of sides for the outline, or 0 for round. */
  sides: number;
}

export interface ParsedInsertCode {
  /** The designation as written. */
  designation: string;
  shape: InsertShapeInfo;
  clearanceDeg?: number;
  clearanceCode?: string;
  toleranceCode?: string;
  typeCode?: string;
  /** Inscribed circle. */
  icSize?: number;
  thickness?: number;
  cornerRadius?: number;
  units?: 'in' | 'mm';
}

/** ISO 1832 shape letters. */
export const INSERT_SHAPES: Record<string, InsertShapeInfo> = {
  C: { code: 'C', name: 'Rhombic 80 deg', includedAngle: 80, sides: 4 },
  D: { code: 'D', name: 'Rhombic 55 deg', includedAngle: 55, sides: 4 },
  E: { code: 'E', name: 'Rhombic 75 deg', includedAngle: 75, sides: 4 },
  M: { code: 'M', name: 'Rhombic 86 deg', includedAngle: 86, sides: 4 },
  V: { code: 'V', name: 'Rhombic 35 deg', includedAngle: 35, sides: 4 },
  W: { code: 'W', name: 'Trigon 80 deg', includedAngle: 80, sides: 6 },
  T: { code: 'T', name: 'Triangle 60 deg', includedAngle: 60, sides: 3 },
  S: { code: 'S', name: 'Square 90 deg', includedAngle: 90, sides: 4 },
  R: { code: 'R', name: 'Round', sides: 0 },
  A: { code: 'A', name: 'Parallelogram 85 deg', includedAngle: 85, sides: 4 },
  B: { code: 'B', name: 'Parallelogram 82 deg', includedAngle: 82, sides: 4 },
  K: { code: 'K', name: 'Parallelogram 55 deg', includedAngle: 55, sides: 4 },
  L: { code: 'L', name: 'Rectangle', includedAngle: 90, sides: 4 },
  H: { code: 'H', name: 'Hexagon', includedAngle: 120, sides: 6 },
  O: { code: 'O', name: 'Octagon', includedAngle: 135, sides: 8 },
  P: { code: 'P', name: 'Pentagon', includedAngle: 108, sides: 5 },
};

/** ISO 1832 clearance angle letters, in degrees. */
const CLEARANCE: Record<string, number> = {
  N: 0, A: 3, B: 5, C: 7, P: 11, D: 15, E: 20, F: 25, G: 30,
};

const TOLERANCE_CODES = new Set(['A', 'C', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'U']);

/**
 * Position 4 is deliberately NOT checked against a closed list.
 *
 * ISO 1832 names a set, but manufacturers extend it - VNGP and similar are
 * ordinary catalogue items - and rejecting them would refuse real inserts a
 * turner is holding. The shape, clearance and tolerance letters are strict, and
 * those three together already reject prose: ROUGH fails on clearance O,
 * FINISH on shape F, SPINDLE on tolerance I.
 */

/**
 * Parse an insert designation.
 *
 * Returns null rather than guessing when the first four characters are not a
 * plausible designation - a tool comment is prose, and a false positive would
 * draw a confidently wrong insert.
 */
export function parseInsertCode(raw: string): ParsedInsertCode | null {
  const text = String(raw).trim().toUpperCase();
  const match = text.match(/^([A-Z])([A-Z])([A-Z])([A-Z])[\s-]*([0-9.]*)/);
  if (!match) return null;

  const [, shapeCode, clearanceCode, toleranceCode, typeCode, digitsRaw] = match;

  const shape = INSERT_SHAPES[shapeCode];
  if (!shape) return null;
  // Clearance is the strongest confirmation that this is a designation rather
  // than an ordinary four-letter word in a comment.
  if (!(clearanceCode in CLEARANCE)) return null;
  if (!TOLERANCE_CODES.has(toleranceCode)) return null;

  const parsed: ParsedInsertCode = {
    designation: text.split(/\s/)[0],
    shape,
    clearanceCode,
    clearanceDeg: CLEARANCE[clearanceCode],
    toleranceCode,
    typeCode,
  };

  const digits = digitsRaw.replace(/\./g, '');
  if (digits.length >= 6) {
    // Metric: IC in mm, thickness in mm, corner radius in tenths of a mm.
    parsed.units = 'mm';
    parsed.icSize = Number.parseInt(digits.slice(0, 2), 10);
    parsed.thickness = Number.parseInt(digits.slice(2, 4), 10) * 1.5875 / 4;
    parsed.cornerRadius = Number.parseInt(digits.slice(4, 6), 10) / 10;
  } else if (digits.length >= 2) {
    // Inch: eighths, sixteenths, sixty-fourths.
    parsed.units = 'in';
    parsed.icSize = Number.parseInt(digits[0], 10) / 8;
    parsed.thickness = Number.parseInt(digits[1], 10) / 16;
    if (digits.length >= 3) {
      const radiusDigits = digits.slice(2);
      parsed.cornerRadius = Number.parseInt(radiusDigits, 10) / 64;
    }
  }

  return parsed;
}

/**
 * Find insert designations in free text, such as a tool-change comment.
 *
 * Scans word by word so that "T3 - CNMG432 ROUGH OD" yields CNMG432 and nothing
 * else. Duplicates are collapsed, first occurrence wins.
 */
export function findInsertCodes(text: string): ParsedInsertCode[] {
  const found: ParsedInsertCode[] = [];
  const seen = new Set<string>();
  for (const word of String(text).toUpperCase().split(/[^A-Z0-9.]+/)) {
    // Four letters then a size, and nothing else in the word. A real
    // designation always carries its size code, and requiring it is what keeps
    // ordinary prose out: SECOND is otherwise a valid-looking S/E/C insert, and
    // ROUGHER an R/O/U one. A human typing into the edit field can still enter a
    // bare CNMG - parseInsertCode stays lenient - but scanning a program must
    // not invent a tool from a word.
    if (!/^[A-Z]{4}[0-9][0-9.]*$/.test(word)) continue;
    const parsed = parseInsertCode(word);
    if (parsed && parsed.icSize !== undefined && !seen.has(parsed.designation)) {
      seen.add(parsed.designation);
      found.push(parsed);
    }
  }
  return found;
}

/**
 * Outline points for an insert shape, centred on the origin.
 *
 * Returned as plain numbers so the same geometry serves the extension, the
 * webview and any test, without any of them needing a 3D library.
 */
export function insertOutline(shapeCode: string, icSize: number, _cornerRadius = 0): Array<[number, number]> {
  const shape = INSERT_SHAPES[shapeCode] ?? INSERT_SHAPES.S;
  const r = Math.max(icSize, 0.0001) / 2;

  if (shape.sides === 0) {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return pts;
  }

  // Rhombic and parallelogram forms are described by their included angle at the
  // cutting corner rather than by a regular polygon.
  if (shape.sides === 4 && shape.includedAngle && shape.includedAngle !== 90) {
    const half = (shape.includedAngle * Math.PI) / 180 / 2;
    const long = r / Math.sin(half);
    const short = r / Math.cos(half);
    return [[0, long], [short, 0], [0, -long], [-short, 0]];
  }

  const n = shape.sides;
  const pts: Array<[number, number]> = [];
  // Circumradius from the inscribed circle, so IC means what it says.
  const R = r / Math.cos(Math.PI / n);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 2;
    pts.push([Math.cos(a) * R, Math.sin(a) * R]);
  }
  return pts;
}
