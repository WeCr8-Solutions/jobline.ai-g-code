/**
 * Turning path tests.
 *
 * The toolpath parser had no lathe awareness at all, and three words mean
 * something different on a turning control:
 *
 *   X is DIAMETRAL. X2.1 puts the tool 1.05 from the centreline, so plotting it
 *     raw drew every turned profile at twice its true size - the path fell
 *     outside its own stock, and a student comparing the two would conclude the
 *     program was wrong when it was the drawing that was wrong.
 *   G90 on a Fanuc lathe is a turning CYCLE, not absolute mode.
 *   G99 on a lathe is feed-per-revolution, not a canned-cycle return mode.
 *
 * Run via: npm test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseGCodeToPath } from '../src/providers/visualizer/toolpathParser';

const TURNING = [
  '%',
  'O0400 (OD TURN)',
  'G20 G40 G80 G97 G99',
  'T0101',
  'G96 S600 M03',
  'G00 X2.0 Z0.1',
  'G01 Z-1.0 F.012',
  'G01 X3.0',
  'M30',
  '%',
].join('\n');

const MILLING = [
  '%',
  'O0401 (MILL)',
  'G20 G17 G90 G54',
  'T1 M06',
  'G00 X2.0 Y0.',
  'G01 Z-.1 F10.',
  'G01 X3.0 F20.',
  'M30',
  '%',
].join('\n');

function xs(gcode: string): number[] {
  return parseGCodeToPath(gcode).path.map(p => p.x);
}

describe('Turning programs are read as turning', () => {
  it('halves X, because a lathe programs diameter', () => {
    const values = xs(TURNING);
    assert.ok(values.includes(1.0), `X2.0 should plot at radius 1.0 (got: ${[...new Set(values)].join(', ')})`);
    assert.ok(values.includes(1.5), `X3.0 should plot at radius 1.5 (got: ${[...new Set(values)].join(', ')})`);
    assert.ok(!values.includes(3.0), 'X3.0 must not plot at 3.0 - that draws the part at twice size');
  });

  it('leaves a milling program alone', () => {
    const values = xs(MILLING);
    assert.ok(values.includes(2.0), 'a mill programs X directly');
    assert.ok(values.includes(3.0), 'a mill programs X directly');
  });

  it('does not treat lathe G90 as absolute mode', () => {
    // G90 here is a turning cycle. If it were read as distance mode the
    // subsequent moves would still be absolute, so assert on what actually
    // breaks: an incremental reading would compound X.
    const withG90 = TURNING.replace('G96 S600 M03', 'G96 S600 M03\nG90 X2.0 Z-1.0 F.012');
    const values = xs(withG90);
    assert.ok(Math.max(...values) <= 1.5 + 1e-9,
      `no point should exceed radius 1.5 (got max ${Math.max(...values)})`);
  });

  it('detects turning from G96 or a turning cycle, not from a comment', () => {
    // A mill program that merely mentions G96 in a comment must not be halved.
    const commented = MILLING.replace('O0401 (MILL)', 'O0401 (MILL - NOT G96 G71 TURNING)');
    const values = xs(commented);
    assert.ok(values.includes(3.0), 'a comment must not switch the program to diameter mode');
  });
});
