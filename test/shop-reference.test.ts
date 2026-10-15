/**
 * The shop reference shared with the JobLine.ai shop app (tap drill chart) and
 * jobline.ai-CAM, and the program review check that uses it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SHOP_REFERENCE, tapDrillFor } from '../src/reference/shopReference';
import { reviewGCodeProgram } from '../src/providers/visualizer/programReview';

describe('shop reference', () => {
  it('finds the tap drill from a tool comment', () => {
    assert.equal(tapDrillFor('1/4-20 SPIRAL TAP')?.tapDrill75, '#7');
    assert.equal(tapDrillFor('TAP 1/4 - 28 UNF')?.thread, '1/4-28');
    assert.equal(tapDrillFor('#10-32 TAP')?.thread, '#10-32');
    assert.equal(tapDrillFor('#10-32 TAP')?.series, 'UNF');
    assert.equal(tapDrillFor('#10-32 TAP')?.tapDrill75, '#21');
    assert.equal(tapDrillFor('#10-24 TAP')?.series, 'UNC');
    assert.equal(tapDrillFor('#10-24 TAP')?.tapDrill75, '#25');
    assert.equal(tapDrillFor('M6x1 TAP')?.tapDrill75, '5.0mm');
    assert.equal(tapDrillFor('M8 X 1.25 FORM TAP')?.thread, 'M8×1.25');
    assert.equal(tapDrillFor('1/2 END MILL'), undefined);
  });

  it('is the shared bundle format', () => {
    assert.equal(SHOP_REFERENCE.format, 'jobline-shop-reference');
    assert.ok(SHOP_REFERENCE.drillSizes.length >= 170);
    assert.ok(SHOP_REFERENCE.rollTapDrills.length > 0);
  });

  // Byte-for-byte equality with the shop app and CAM copies is checked in
  // test/machine-presets.test.ts. These pin the version this copy was synced to.
  it('is synced to shop reference v1.2.1', () => {
    assert.equal(SHOP_REFERENCE.version, '1.2.1');
  });

  it('has #10-32 as UNF only and #10-24 as the only #10 UNC thread', () => {
    const ten = SHOP_REFERENCE.tapDrills.filter(row => row.thread.startsWith('#10-'));
    assert.deepEqual(ten.map(row => `${row.thread} ${row.series} ${row.tapDrill75} ${row.tapDrill75Dec}`),
      ['#10-24 UNC #25 0.1495', '#10-32 UNF #21 0.159']);
    const rollTen = SHOP_REFERENCE.rollTapDrills.filter(row => row.thread.startsWith('#10-'));
    assert.deepEqual(rollTen.map(row => `${row.thread} ${row.series}`), ['#10-24 UNC', '#10-32 UNF']);
  });

  it('has one tap drill row per thread', () => {
    const threads = SHOP_REFERENCE.tapDrills.map(row => row.thread);
    assert.equal(new Set(threads).size, threads.length);
  });
});

const program = (tools: string) => `%
O1000 (TAP CHECK)
G20 G17 G40 G49 G80 G90
${tools}
G54
M30
%`;

describe('tap drill review', () => {
  it('flags a tap whose tap drill is not in the program', () => {
    const review = reviewGCodeProgram(program('T1 M06 (1/4 END MILL)\nT2 M06 (1/4-20 TAP)'));
    const finding = review.findings.find(f => f.id === 'tap-drill-missing-T2');
    assert.ok(finding, JSON.stringify(review.findings));
    assert.match(finding.message, /#7 \(0\.2010\)/);
    assert.equal(finding.severity, 'info');
  });

  it('is satisfied by the 75% tap drill', () => {
    const review = reviewGCodeProgram(program('T1 M06 (.201 DRILL)\nT2 M06 (1/4-20 TAP)'));
    assert.equal(review.findings.some(f => f.id.startsWith('tap-drill-missing')), false, JSON.stringify(review.findings));
  });

  it('accepts the #21 drill for a #10-32 tap (UNF)', () => {
    const review = reviewGCodeProgram(program('T1 M06 (.159 DRILL)\nT2 M06 (#10-32 TAP)'));
    assert.equal(review.findings.some(f => f.id.startsWith('tap-drill-missing')), false, JSON.stringify(review.findings));
  });

  it('converts an inch thread for a metric program', () => {
    const review = reviewGCodeProgram(program('T1 M06 (5.1 DRILL)\nT2 M06 (1/4-20 TAP)').replace('G20', 'G21'));
    assert.equal(review.findings.some(f => f.id.startsWith('tap-drill-missing')), false, JSON.stringify(review.findings));
  });
});
