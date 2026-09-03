import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reviewGCodeProgram } from '../src/providers/visualizer/programReview';

describe('Simulation program review', () => {
  it('flags missing setup and end codes with actionable suggestions', () => {
    const review = reviewGCodeProgram('G0 X0 Y0\nG1 X1 F10');
    const ids = review.findings.map(finding => finding.id);
    assert.ok(ids.includes('missing-units'));
    assert.ok(ids.includes('missing-distance-mode'));
    assert.ok(ids.includes('missing-plane'));
    assert.ok(ids.includes('missing-work-offset'));
    assert.ok(ids.includes('missing-program-end'));
    assert.ok(review.findings.every(finding => finding.id.startsWith('diagnostic-') || finding.suggestion));
  });

  it('does not report setup omissions for an explicit safe header', () => {
    const review = reviewGCodeProgram('G20 G17 G90 G54\nM30');
    assert.equal(review.findings.filter(finding => finding.id.startsWith('missing-')).length, 0);
  });

  it('warns that macro-driven paths are approximated', () => {
    const review = reviewGCodeProgram('G20 G17 G90 G54\n#1=1\nG1 X#1 F10\nM30');
    assert.ok(review.findings.some(finding => finding.id === 'simulation-macro-approximation'));
  });
});
