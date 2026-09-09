/**
 * ISO insert designation tests.
 *
 * The designation is usually the only record in a program of what is actually
 * cutting, so reading it wrong draws a confidently wrong insert. These pin the
 * shapes a turner meets daily and the two size conventions.
 *
 * Run via: npm test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseInsertCode, findInsertCodes, insertOutline, INSERT_SHAPES } from '../src/parser/insertCode';

describe('Insert designations — shape', () => {
  it('reads the shapes named most often', () => {
    const cases: Array<[string, string, number | undefined]> = [
      ['CNMG432', 'C', 80],
      ['CNGG432', 'C', 80],
      ['VNGP331', 'V', 35],
      ['VNGG331', 'V', 35],
      ['TCMT32.51', 'T', 60],
      ['DNMG431', 'D', 55],
      ['WNMG432', 'W', 80],
      ['SNMG432', 'S', 90],
      ['RCMT1204', 'R', undefined],
    ];
    for (const [code, shape, angle] of cases) {
      const parsed = parseInsertCode(code);
      assert.ok(parsed, `${code} should parse`);
      assert.equal(parsed!.shape.code, shape, `${code} shape`);
      assert.equal(parsed!.shape.includedAngle, angle, `${code} included angle`);
    }
  });

  it('reads the clearance angle', () => {
    assert.equal(parseInsertCode('CNMG432')!.clearanceDeg, 0, 'N is 0 deg, a negative insert');
    assert.equal(parseInsertCode('TCMT32.51')!.clearanceDeg, 7, 'C is 7 deg, a positive insert');
    assert.equal(parseInsertCode('VPGT221')!.clearanceDeg, 11, 'P is 11 deg');
  });
});

describe('Insert designations — size', () => {
  it('reads inch sizing in eighths, sixteenths and sixty-fourths', () => {
    const c = parseInsertCode('CNMG432')!;
    assert.equal(c.units, 'in');
    assert.equal(c.icSize, 0.5, 'IC 4/8 inch');
    assert.equal(c.thickness, 3 / 16, 'thickness 3/16 inch');
    assert.equal(c.cornerRadius, 2 / 64, 'nose 2/64 inch');
  });

  it('reads metric sizing, with the corner radius in tenths of a millimetre', () => {
    const c = parseInsertCode('CNMG120408')!;
    assert.equal(c.units, 'mm');
    assert.equal(c.icSize, 12, 'IC 12 mm');
    assert.equal(c.cornerRadius, 0.8, 'nose 0.8 mm');
  });

  it('handles the decimal inch form', () => {
    const t = parseInsertCode('TCMT32.51')!;
    assert.equal(t.units, 'in');
    assert.equal(t.icSize, 3 / 8);
  });
});

describe('Insert designations — rejection', () => {
  it('refuses ordinary words rather than drawing a wrong insert', () => {
    for (const word of ['ROUGH', 'FINISH', 'TOOL', 'FACE', 'DRILL', 'STOCK', 'SPINDLE']) {
      assert.equal(parseInsertCode(word), null, `${word} must not parse as an insert`);
    }
  });

  it('refuses an impossible clearance or shape letter', () => {
    assert.equal(parseInsertCode('CZMG432'), null, 'Z is not a clearance angle');
    assert.equal(parseInsertCode('QNMG432'), null, 'Q is not a shape');
  });
});

describe('Insert designations — pulled from a program', () => {
  it('finds the designation in a tool-change comment', () => {
    const found = findInsertCodes('(T3 - CNMG432 ROUGH OD - 80 DEG)');
    assert.equal(found.length, 1);
    assert.equal(found[0].designation, 'CNMG432');
  });

  it('finds several across a program without duplicating', () => {
    const program = [
      '(T1 - CNMG432 ROUGH)',
      '(T2 - VNMG331 FINISH)',
      '(T3 - CNMG432 SECOND ROUGHER)',
    ].join('\n');
    const found = findInsertCodes(program).map(f => f.designation);
    assert.deepEqual(found, ['CNMG432', 'VNMG331']);
  });

  it('does not invent one from prose', () => {
    assert.deepEqual(findInsertCodes('(ROUGH THE OD THEN FINISH TO SIZE)'), []);
  });
});

describe('Insert outlines', () => {
  it('gives a triangle three points and a square four', () => {
    assert.equal(insertOutline('T', 0.5).length, 3);
    assert.equal(insertOutline('S', 0.5).length, 4);
    assert.equal(insertOutline('C', 0.5).length, 4);
  });

  it('makes a round insert round', () => {
    const pts = insertOutline('R', 0.5);
    assert.ok(pts.length > 20, 'round needs enough points to look round');
    for (const [x, y] of pts) {
      assert.ok(Math.abs(Math.hypot(x, y) - 0.25) < 1e-9, 'every point sits on the radius');
    }
  });

  it('makes a 35 degree V narrower than an 80 degree C at the same IC', () => {
    const widthOf = (code: string) => {
      const pts = insertOutline(code, 0.5);
      return Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0]));
    };
    assert.ok(widthOf('V') < widthOf('C'), 'a V insert is the pointed one');
  });

  it('covers every shape letter it advertises', () => {
    for (const code of Object.keys(INSERT_SHAPES)) {
      const pts = insertOutline(code, 0.5);
      assert.ok(pts.length >= 3, `${code} produced no usable outline`);
      for (const [x, y] of pts) {
        assert.ok(Number.isFinite(x) && Number.isFinite(y), `${code} produced a non-finite point`);
      }
    }
  });
});
