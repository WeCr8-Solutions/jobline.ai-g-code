import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildVisualizerHarnessData, type VisualizerHarnessManifest } from '../src/providers/visualizer/fixtureHarness';
import { parseParasolidText } from '../src/providers/visualizer/parasolidTextParser';

const fixtureRoot = path.join(__dirname, 'fixtures', 'revpack');

/**
 * test/fixtures/revpack/ holds private shop programs and customer CAD. It is
 * gitignored and must stay that way, so it exists only on machines that were
 * given the files directly. These tests skip when it is absent rather than
 * fail, so a clean clone still yields a trustworthy run.
 */
const revpackAvailable = fs.existsSync(path.join(fixtureRoot, 'revpack.visualizer-harness.json'));
const skipReason = revpackAvailable
  ? false
  : 'private revpack fixture not present on this machine (test/fixtures/revpack/ is gitignored)';

describe('Revpack visualizer harness', () => {
  it('loads revpack manifest and extracts setup plus tools from gcode', { skip: skipReason }, () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(fixtureRoot, 'revpack.visualizer-harness.json'), 'utf8')
    ) as VisualizerHarnessManifest;
    const gcode = fs.readFileSync(path.join(fixtureRoot, manifest.gcode), 'utf8');
    const harness = buildVisualizerHarnessData(gcode, manifest.dialect);

    assert.equal(manifest.fixtureMode, 'none');
    assert.equal(harness.setup.fixtureMode, 'none');
    assert.ok(harness.setup.workOffsets.includes('G54'));
    assert.ok(harness.tools.length >= 10);

    const tool1 = harness.tools.find(tool => tool.toolNumber === 1);
    assert.ok(tool1);
    assert.equal(tool1?.type, 'End Mill');
    assert.equal(tool1?.diameter, 0.5);

    const drill53 = harness.tools.find(tool => tool.toolNumber === 53);
    assert.ok(drill53);
    assert.equal(drill53?.type, 'Drill');
  });

  it('accepts the revpack parasolid text goal model as a harness asset', { skip: skipReason }, () => {
    const xT = fs.readFileSync(path.join(fixtureRoot, 'REVGRIPS STEM-50-35-PRO.x_t'), 'utf8');
    const parsed = parseParasolidText(xT);

    assert.equal(parsed.format, 'parasolid-text');
    assert.ok(parsed.pointCount > 1000);
    assert.ok(parsed.bounds.maxX > parsed.bounds.minX);
  });
});