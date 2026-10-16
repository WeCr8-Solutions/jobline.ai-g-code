/**
 * The new commands and settings are contributed in package.json and registered in code.
 * Run: npm run test:cam-integrations (loaded with it)
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const src = ['src/cam/camCommands.ts', 'src/extension.ts'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');

describe('Contributions: tool library, CAM, control rules, convert', () => {
  const commands: string[] = pkg.contributes.commands.map((c: { command: string }) => c.command);
  for (const id of ['jobline.tools.importLibrary', 'jobline.tools.clearLibrary', 'jobline.cam.linkSetupSheet', 'jobline.cam.addWatchFolder', 'jobline.cam.showIntegrations', 'jobline.convertDialect']) {
    it(`${id} is contributed and registered`, () => {
      assert.ok(commands.includes(id), 'contributed');
      assert.ok(src.includes(`'${id}'`), 'registered');
    });
  }
  it('controlType offers every control with a rule set', () => {
    const e: string[] = pkg.contributes.configuration.properties['jobline.controlType'].enum;
    for (const c of ['fanuc', 'haas', 'siemens', 'mazak', 'okuma', 'mitsubishi', 'heidenhain', 'fadal', 'generic']) assert.ok(e.includes(c), c);
    assert.equal(e.length, pkg.contributes.configuration.properties['jobline.controlType'].enumDescriptions.length);
  });
  it('new settings exist', () => {
    const p = pkg.contributes.configuration.properties;
    assert.equal(p['jobline.validation.controlSpecificRules'].default, true);
    assert.deepEqual(p['jobline.cam.watchFolders'].default, []);
    assert.equal(p['jobline.cam.autoLinkSetupSheets'].default, true);
  });
  it('Klartext first line is recognised as G-code language', () => {
    const lang = pkg.contributes.languages.find((l: { id: string }) => l.id === 'gcode');
    assert.ok(new RegExp(lang.firstLine).test('0 BEGIN PGM PLATE MM'));
  });
});
