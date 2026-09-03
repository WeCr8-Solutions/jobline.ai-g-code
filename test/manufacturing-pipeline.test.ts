import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { describe, it } from 'node:test';

describe('Manufacturing pipeline acceptance gate', () => {
  it('reports loaded inputs but refuses to call visualization a true simulation', () => {
    const root = path.resolve(__dirname, '..');
    const result = spawnSync(process.execPath, ['-r', 'ts-node/register', path.join(root, 'scripts/verify-manufacturing-pipeline.ts'), '--report-only'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.complete, false);
    assert.equal(report.stages.find((stage: { id: string }) => stage.id === 'gcode-load').status, 'pass');
    assert.equal(report.stages.find((stage: { id: string }) => stage.id === 'goal-model-load').status, 'pass');
    assert.equal(report.stages.find((stage: { id: string }) => stage.id === 'material-removal').status, 'fail');
  });
});
