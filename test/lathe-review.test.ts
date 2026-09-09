/**
 * Setup-advisory tests, split by machine class.
 *
 * The three setup checks - distance mode, working plane, work offset - are MILL
 * conventions, and they were raised against every program. A correct Okuma
 * turning program collected all three, so the panel told the operator a good
 * lathe program was deficient three times over. That is worse than silence in
 * front of someone learning the language from what this reports.
 *
 * Run via: npm test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { reviewGCodeProgram } from '../src/providers/visualizer/programReview';

const MILL_ONLY = ['missing-distance-mode', 'missing-plane', 'missing-work-offset'];

function setupIds(gcode: string, dialect = 'fanuc'): string[] {
  return reviewGCodeProgram(gcode, dialect).findings
    .filter(f => f.category === 'setup')
    .map(f => f.id);
}

// A turning program with no G90/G91, no G17-G19 and no G54: all correct.
const LATHE = [
  '%',
  'O0200 (OD TURN)',
  'G20 G40 G80 G97 G99',
  'T0101',
  'G50 S3000',
  'G96 S600 M03',
  'G00 X2.1 Z0.1',
  'G01 X-.05 F.008',
  'G01 Z-2.5 F.012',
  'G00 X5. Z5.',
  'M30',
  '%',
].join('\n');

const MILL_MISSING_OFFSET = [
  '%',
  'O0300 (MILL, NO WORK OFFSET)',
  'G20 G17 G90 G40 G49 G80',
  'T1 M06',
  'G00 X0. Y0.',
  'G43 H01 Z1.',
  'G01 Z-.1 F10.',
  'G01 X1. F20.',
  'G00 Z1.',
  'M30',
  '%',
].join('\n');

describe('Setup advisories are machine-aware', () => {
  it('does not raise mill setup rules against a turning program', () => {
    const ids = setupIds(LATHE);
    for (const id of MILL_ONLY) {
      assert.ok(!ids.includes(id), `${id} should not be raised on a lathe program (got: ${ids.join(', ') || 'none'})`);
    }
  });

  it('still raises them for a mill', () => {
    const ids = setupIds(MILL_MISSING_OFFSET);
    assert.ok(ids.includes('missing-work-offset'),
      `a mill without G54-G59 should be flagged (got: ${ids.join(', ') || 'none'})`);
  });

  it('asks a turning program for its own datum instead', () => {
    // No G50 and no four-digit T word: the datum comes from nowhere.
    const noDatum = LATHE.replace('T0101', 'T1').replace('G50 S3000', 'S3000');
    const ids = setupIds(noDatum, 'okuma');
    assert.ok(ids.includes('missing-turning-datum'),
      `expected the turning datum advisory (got: ${ids.join(', ') || 'none'})`);
  });

  it('accepts a T word carrying its offset register as the datum', () => {
    const ids = setupIds(LATHE.replace('G50 S3000', 'S3000'), 'okuma');
    assert.ok(!ids.includes('missing-turning-datum'),
      'T0101 carries offset register 1, so the datum is declared');
  });

  it('keeps the checks that apply to both, such as units', () => {
    const ids = setupIds(LATHE.replace('G20 ', ''));
    assert.ok(ids.includes('missing-units'), 'units apply to every machine');
  });
});
