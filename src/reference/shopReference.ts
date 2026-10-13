/**
 * The JobLine shop reference (tap drills, thread sizes, drill sizes, NPT,
 * cutting speeds), shared with the JobLine.ai shop app and jobline.ai-CAM.
 *
 * data/reference/jobline-shop-reference.json is a byte-for-byte copy of the
 * shop app's public/reference/jobline-shop-reference.json (generated there by
 * src/lib/reference/shopReference.ts and published at
 * https://jobline.ai/reference/jobline-shop-reference.json). Change the data
 * in the shop app and copy the file here; test/machine-presets.test.ts fails
 * when the copies differ, and test/shop-reference.test.ts pins the version and
 * spot-checks rows.
 *
 * Current copy: v1.2.1 (#10-32 is UNF only, tap drill #21; #10-24 is the only
 * #10 UNC thread, tap drill #25).
 */
import reference from '../../data/reference/jobline-shop-reference.json';

export interface TapDrillRow {
  thread: string;
  series: 'UNC' | 'UNF' | 'Metric';
  tpi?: number;
  pitchMm: number;
  basicMajor: number;
  basicPitch: number;
  basicMinor: number;
  units: 'in' | 'mm';
  tapDrill75: string;
  tapDrill75Dec: number;
  tapDrill50: string;
  tapDrill50Dec: number;
  stiTapDrill: string;
  stiTapDrillDec: number;
  /** Helical insert size the STI drill is for, e.g. "1/4-20×1D". */
  stiInsertSize?: string;
}

/** Form (roll) tap drill at 65% thread. */
export interface RollTapDrillRow {
  thread: string;
  series: 'UNC' | 'UNF' | 'Metric';
  units: 'in' | 'mm';
  drillExact: number;
  drill: string;
  drillDec: number;
}

export interface ShopReference {
  format: 'jobline-shop-reference';
  version: string;
  tapDrills: TapDrillRow[];
  rollTapDrills: RollTapDrillRow[];
  drillSizes: Array<{ name: string; series: 'number' | 'letter' | 'fraction'; inch: number; mm: number }>;
  npt: Array<{ size: string; tpi: number; pipeOd: number; tapDrill: string; tapDrillInch: number }>;
}

export const SHOP_REFERENCE = reference as unknown as ShopReference;

/** "1/4-20", "1/4 - 20 UNC", "#10-32" → "1/4-20"; "M6x1", "M6 X 1.0" → "M6×1.0". */
function threadKey(text: string): string | undefined {
  const t = text.toUpperCase();
  const metric = /\bM\s*(\d+(?:\.\d+)?)\s*[X×]\s*(\d+(?:\.\d+)?)/.exec(t);
  if (metric) {
    const pitch = Number(metric[2]);
    // The data writes whole pitches with one decimal: M6×1.0, M8×1.25.
    return `M${Number(metric[1])}×${Number.isInteger(pitch) ? pitch.toFixed(1) : String(pitch)}`;
  }
  const unified = /(#\d+|\d+\s*\/\s*\d+|\d+(?:-\d+\/\d+)?)\s*-\s*(\d+)/.exec(t);
  return unified ? `${unified[1].replace(/\s+/g, '')}-${unified[2]}` : undefined;
}

/** Tap drill row for a thread callout in a tool comment, e.g. "1/4-20 SPIRAL TAP". */
export function tapDrillFor(callout: string): TapDrillRow | undefined {
  const key = threadKey(callout);
  if (!key) return undefined;
  return SHOP_REFERENCE.tapDrills.find(row => row.thread.toUpperCase() === key.toUpperCase());
}
