import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { extractFusionPreview, parseFusionSetupArchive } from '../src/providers/visualizer/fusionArchiveParser';

const archivePath = process.env.JOBLINE_JUSTIN_F3D || 'C:/Users/zach/Downloads/Drawing1.f3d';
const archiveAvailable = fs.existsSync(archivePath);

describe('Fusion 360 CAM setup archive', () => {
  it('extracts Justin setup without inventing a fixture or exact origin', {
    skip: archiveAvailable ? false : 'Justin Fusion fixture is private and not present on this machine',
  }, () => {
    const setup = parseFusionSetupArchive(fs.readFileSync(archivePath));
    assert.equal(setup.setupName, 'Setup1');
    assert.ok(setup.operationNames.includes('2D Contour1'));
    assert.deepEqual(
      [setup.stock.width, setup.stock.depth, setup.stock.height].map(value => Number(value.toFixed(6))),
      [79.727922, 57, 48.727922],
    );
    assert.deepEqual(
      [setup.model.width, setup.model.depth, setup.model.height].map(value => Number(value.toFixed(6))),
      [77.727922, 55, 47.727922],
    );
    assert.equal(setup.stock.sideAllowance, 1);
    assert.equal(setup.stock.topAllowance, 1);
    assert.equal(setup.stock.bottomAllowance, 0);
    assert.equal(setup.workOffset.code, 'G54');
    assert.equal(setup.workOffset.inferred, true);
    assert.equal(setup.wcs.orientationMode, 'modelOrientation');
    assert.equal(setup.wcs.originMode, 'modelPoint');
    assert.equal(setup.wcs.originReferencePresent, false);
    assert.equal(setup.fixture.assigned, false);
    assert.equal(setup.fixture.radialClearance, 5);
    assert.equal(setup.fixture.axialClearance, 5);
    const preview = extractFusionPreview(fs.readFileSync(archivePath));
    assert.deepEqual(Array.from(preview.subarray(0, 4)), [0x89, 0x50, 0x4e, 0x47]);
    assert.ok(preview.length > 100_000, 'Fusion shaded preview should contain the actual model image');
  });
});
