/* eslint-env node, mocha */
/* global require, suite, suiteSetup, suiteTeardown, test */

const assert = require('node:assert/strict');
const vscode = require('vscode');

const SETTINGS = ['machinePreset', 'controlType', 'machineType', 'units', 'detectedMachineType'];

suite('JobLine machine presets', function () {
  this.timeout(60000);

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension('WeCr8-Solutions.jobline-gcode');
    assert.ok(extension);
    await extension.activate();
  });

  suiteTeardown(async () => {
    const cfg = vscode.workspace.getConfiguration('jobline');
    for (const key of SETTINGS) await cfg.update(key, undefined, vscode.ConfigurationTarget.Workspace);
    await cfg.update('controlType', 'fanuc', vscode.ConfigurationTarget.Workspace);
  });

  test('registers the preset commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['switch', 'apply', 'setDefault', 'create', 'import', 'export', 'edit', 'delete', 'refresh']) {
      assert.ok(commands.includes(`jobline.presets.${id}`), `jobline.presets.${id} should be registered`);
    }
  });

  test('applying a preset sets control, machine type and units for the workspace', async () => {
    await vscode.commands.executeCommand('jobline.presets.apply', 'builtin-okuma-lathe');
    const cfg = vscode.workspace.getConfiguration('jobline');
    const inspected = cfg.inspect('machinePreset');
    assert.equal(inspected.workspaceValue, 'builtin-okuma-lathe');
    assert.equal(cfg.get('controlType'), 'okuma');
    assert.equal(cfg.get('machineType'), 'lathe');
    assert.equal(cfg.get('detectedMachineType'), 'Turn Center (2-Axis)');
  });

  test('switching presets replaces the previous machine', async () => {
    await vscode.commands.executeCommand('jobline.presets.apply', 'builtin-siemens-5axis');
    const cfg = vscode.workspace.getConfiguration('jobline');
    assert.equal(cfg.get('machinePreset'), 'builtin-siemens-5axis');
    assert.equal(cfg.get('controlType'), 'siemens');
    assert.equal(cfg.get('units'), 'metric');
    assert.equal(cfg.get('machineType'), 'mill');
  });
});
