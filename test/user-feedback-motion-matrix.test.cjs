const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', target: 'ES2020' } });
const { parseGCodeToPath } = require('../src/providers/visualizer/toolpathParser');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, String(actual) + ' != ' + expected);

// ISO motion geometry only. These tests do not certify controller-specific cycles.
for (const unit of ['G20', 'G21']) for (const mode of ['G90', 'G91']) {
  for (const motion of ['G00', 'G01']) for (const decimal of ['0.75', '.75']) {
    test([unit, mode, motion, decimal, 'linear coordinates and motion flag'].join(' '), () => {
      const code = unit + ' G90 G17\nG0 X1 Y2 Z3\n' + mode + '\n' + motion + ' X' + decimal + ' Y-' + decimal + ' Z' + decimal + ' F100';
      const result = parseGCodeToPath(code);
      const p = result.path[result.path.length - 1];
      close(p.x, (mode === 'G91' ? 1 : 0) + .75);
      close(p.y, (mode === 'G91' ? 2 : 0) - .75);
      close(p.z, (mode === 'G91' ? 3 : 0) + .75);
      assert.equal(p.isRapid, motion === 'G00');
      assert.equal(result.units, unit === 'G20' ? 'in' : 'mm');
    });
  }
  for (const plane of [17, 18, 19]) for (const motion of ['G02', 'G03']) for (const diameter of [2, 1.25]) {
    test([unit, mode, 'G' + plane, motion, 'full circle diameter', diameter].join(' '), () => {
      const r = diameter / 2;
      const firstAxis = plane === 19 ? 'Y' : 'X';
      const offset = plane === 19 ? 'J' : 'I';
      const result = parseGCodeToPath(unit + ' G90 G' + plane + '\nG0 ' + firstAxis + r + '\n' + mode + '\n' + motion + ' ' + offset + (-r) + ' F100');
      const circle = result.path.filter(p => p.lineNumber === 3);
      assert.ok(circle.length >= 36, 'full circle must contain interpolated motion');
      for (const p of circle) {
        const a = plane === 19 ? p.y : p.x;
        const b = plane === 17 ? p.y : p.z;
        close(Math.hypot(a, b), r);
        assert.equal(p.isRapid, false);
      }
      close(circle[circle.length - 1][firstAxis.toLowerCase()], r);
    });
  }
}
for (const plane of [17, 18, 19]) for (const motion of ['G02', 'G03']) {
  test('explicit endpoint arc G' + plane + ' ' + motion, () => {
    const axes = plane === 17 ? ['X', 'Y', 'I'] : plane === 18 ? ['X', 'Z', 'I'] : ['Y', 'Z', 'J'];
    const path = parseGCodeToPath('G90 G' + plane + '\nG0 ' + axes[0] + '1\n' + motion + ' ' + axes[0] + '0 ' + axes[1] + '1 ' + axes[2] + '-1 F100').path.filter(p => p.lineNumber === 2);
    assert.ok(path.length >= 36);
    for (const p of path) close(Math.hypot(p[axes[0].toLowerCase()], p[axes[1].toLowerCase()]), 1);
  });
}
test('feed then rapid retract retains rapid flags above part', () => {
  const p = parseGCodeToPath('G90 G17\nG0 X0 Y0 Z1\nG1 Z-.25 F10\nG0 Z1\nX2').path;
  assert.deepEqual(p.slice(-3).map(x => x.isRapid), [false, true, true]);
});
test('mill G73 peck cycle does not halve X as lathe diameter mode', () => {
  const p = parseGCodeToPath('G90 G17 G21\nG0 X0 Y0 Z5\nG73 X10 Y4 Z-5 R1 Q1 F100\nG80').path;
  assert.ok(p.some(x => x.x === 10 && x.y === 4 && x.z === -5 && !x.isRapid));
});

test('out-of-plane offsets do not invent a full circle', () => {
  const p = parseGCodeToPath('G90 G17\nG0 X1 Y0\nG2 K1 F100').path;
  assert.equal(p.filter(x => x.lineNumber === 2).length, 0);
});
test('feed-only modal arc line does not repeat a circle', () => {
  const p = parseGCodeToPath('G90 G17\nG0 X1 Y0\nG2 I-1 F100\nF200').path;
  assert.equal(p.filter(x => x.lineNumber === 3).length, 0);
});
test('G73 contour form retains lathe diameter interpretation', () => {
  const p = parseGCodeToPath('G18\nG0 X10 Z1\nG73 P100 Q200 U1 W1').path;
  assert.ok(p.some(x => x.x === 5));
});
