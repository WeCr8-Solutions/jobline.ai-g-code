import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { buildVisualizerHarnessData } from '../src/providers/visualizer/fixtureHarness';
import { parseGCodeToPath } from '../src/providers/visualizer/toolpathParser';

const root = path.resolve(__dirname, '..');
function load(relative: string): string { return fs.readFileSync(path.join(root, relative), 'utf8'); }

describe('Representative simulation matrix', () => {
  it('parses the comprehensive mill with tools and arc tessellation', () => {
    const gcode = load('samples/mill-comprehensive.nc');
    assert.ok(parseGCodeToPath(gcode).path.length > 1000);
    assert.ok(buildVisualizerHarnessData(gcode).tools.length >= 5);
  });

  it('detects and parses the lathe sample in the XZ plane', () => {
    const gcode = load('samples/lathe-turning.nc');
    assert.equal(buildVisualizerHarnessData(gcode).setup.machineType, 'Turn Center (2-Axis)');
    assert.ok(parseGCodeToPath(gcode).path.some(point => (point.z ?? 0) !== 0));
  });

  it('detects A+C motion as five-axis and retains rotary positions', () => {
    const gcode = load('samples/mill-5axis.nc');
    assert.equal(buildVisualizerHarnessData(gcode).setup.machineType, '5-Axis Mill (Trunnion)');
    assert.ok(parseGCodeToPath(gcode).path.some(point => point.a === 30 && point.c === 40));
  });
});
