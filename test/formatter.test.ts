/**
 * JobLine Formatter Tests
 *
 * The formatter had no tests at all, which is how it shipped a rule that
 * corrupted ordinary Fanuc output: `X5.` became `X5.000.`, a word with two
 * decimal points. These cases pin every numeric form a control emits.
 *
 * Run via: npm test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  applyWordSpacing,
  applyUppercaseGM,
  applyDecimalNormalization,
  formatLine,
  formatText,
  type FormatterConfig,
} from '../src/formatter/formatterRules';

const cfg = (over: Partial<FormatterConfig> = {}): FormatterConfig => ({
  wordSpacing: true,
  uppercaseGM: true,
  decimalPlaces: null,
  ...over,
});

/** No formatter output may ever contain a number with two decimal points. */
function assertNoDoubleDecimal(out: string) {
  assert.ok(
    !/\d*\.\d*\./.test(out.replace(/\([^)]*\)/g, '')),
    `formatter produced a malformed number: ${JSON.stringify(out)}`
  );
}

describe('Formatter — decimal normalization', () => {
  it('keeps trailing-decimal words intact (X5. must not become X5.000.)', () => {
    const out = applyDecimalNormalization('X5.', 3);
    assert.equal(out, 'X5.000');
    assertNoDoubleDecimal(out);
  });

  it('adds the leading zero on leading-decimal words', () => {
    assert.equal(applyDecimalNormalization('X.5', 3), 'X0.500');
    assert.equal(applyDecimalNormalization('X-.5', 3), 'X-0.500');
    assert.equal(applyDecimalNormalization('Z-.0625', 4), 'Z-0.0625');
  });

  it('rounds ordinary decimals', () => {
    assert.equal(applyDecimalNormalization('X1.23456', 3), 'X1.235');
  });

  it('leaves integers, program, tool, feed and spindle words alone', () => {
    assert.equal(applyDecimalNormalization('G01', 3), 'G01');
    assert.equal(applyDecimalNormalization('O0001', 3), 'O0001');
    assert.equal(applyDecimalNormalization('T1', 3), 'T1');
    assert.equal(applyDecimalNormalization('F20.', 3), 'F20.');
    assert.equal(applyDecimalNormalization('S3000', 3), 'S3000');
    assert.equal(applyDecimalNormalization('N10', 3), 'N10');
  });

  it('normalizes a whole block without corrupting it', () => {
    const out = applyDecimalNormalization('G01 X5. Y-.5 Z.25 F20.', 3);
    assert.equal(out, 'G01 X5.000 Y-0.500 Z0.250 F20.');
    assertNoDoubleDecimal(out);
  });

  it('handles arc offsets and radius', () => {
    const out = applyDecimalNormalization('G03 X.25 Y2.25 R.5', 3);
    assert.equal(out, 'G03 X0.250 Y2.250 R0.500');
  });
});

describe('Formatter — word spacing', () => {
  it('splits words jammed after a digit', () => {
    assert.equal(applyWordSpacing('G01X1.5Y2.0'), 'G01 X1.5 Y2.0');
  });

  it('splits words jammed after a trailing decimal point', () => {
    // X5.Y2. is valid G-code; the character before Y is '.', not a digit.
    assert.equal(applyWordSpacing('X5.Y2.'), 'X5. Y2.');
  });

  it('leaves already-spaced code alone', () => {
    assert.equal(applyWordSpacing('G01 X1.5 Y2.0'), 'G01 X1.5 Y2.0');
  });
});

describe('Formatter — uppercase G/M', () => {
  it('uppercases g and m codes', () => {
    assert.equal(applyUppercaseGM('g01 m03'), 'G01 M03');
  });
});

describe('Formatter — line and document', () => {
  it('preserves comments and does not touch pure comment lines', () => {
    assert.equal(formatLine('(ROUGH POCKET)', cfg()), '(ROUGH POCKET)');
    assert.equal(
      formatLine('G01X5.(FEED IN)', cfg({ decimalPlaces: 3 })),
      'G01 X5.000(FEED IN)'
    );
  });

  it('does not touch macro assignments', () => {
    assert.equal(formatLine('#100=5.0', cfg({ decimalPlaces: 3 })), '#100=5.0');
  });

  it('returns null when nothing changes', () => {
    assert.equal(formatText('G01 X1.5 Y2.0\nM30', cfg()), null);
  });

  it('formats a realistic program without producing a malformed number', () => {
    const program = [
      '%',
      'O0001 (LEADING DECIMAL POCKET)',
      'G20 G17 G40 G49 G80 G90',
      'T1 M06',
      'G54 G00 X.75 Y.75',
      'G43 H01 Z1.',
      'G01 Z-.0625 F10.',
      'G01X3.5F20.',
      'G03 X.25 Y2.25 R.5',
      'G00 Z1.',
      'M30',
      '%',
    ].join('\n');

    const out = formatText(program, cfg({ decimalPlaces: 4 }));
    assert.ok(out !== null, 'expected the program to be reformatted');
    for (const line of (out as string).split('\n')) {
      assertNoDoubleDecimal(line);
    }
    assert.ok((out as string).includes('X0.7500'), 'leading decimal should gain its zero');
    assert.ok((out as string).includes('Z1.0000'), 'trailing decimal should normalize cleanly');
  });
});
