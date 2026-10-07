/**
 * Machine preset tests.
 *
 * A preset is chosen once and then trusted for every program, so a file that
 * loads wrong, a source that wins when it should lose, or a mismatch check that
 * cries wolf would all quietly undo the point of having one. The `.jblmachine`
 * format is shared with jobline.ai-CAM, so the codec is also checked against
 * the shapes CAM writes.
 *
 * Run via: npm test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import {
  controlFamilyFromName,
  describeMachinePreset,
  machineClassForKind,
  normalizeMachinePreset,
  parseJblMachine,
  serializeJblMachine,
  slugifyPresetId,
} from '../src/presets/jblMachine';
import {
  BUILTIN_PRESETS,
  PresetEntry,
  mergePresetEntries,
  parseTravelInput,
  presetFromSettings,
  presetOverrides,
  programPresetMismatch,
  settingsForPreset,
  uniquePresetId,
} from '../src/presets/presetLibrary';

const root = path.join(__dirname, '..');

function mustParse(text: string) {
  const result = parseJblMachine(text);
  if (!result.ok) throw new Error(result.error);
  return result;
}

function preset(raw: Record<string, unknown>) {
  const result = normalizeMachinePreset(raw);
  if (!result.ok) throw new Error(result.error);
  return result.preset;
}

describe('.jblmachine codec', () => {
  it('round-trips a preset through the shared envelope', () => {
    const original = BUILTIN_PRESETS.find(item => item.id === 'builtin-siemens-5axis')!;
    const text = serializeJblMachine(original, 1767225600000);
    const envelope = JSON.parse(text);
    assert.equal(envelope.fileType, 'machine');
    assert.equal(envelope.extension, '.jblmachine');
    assert.equal(envelope.version, '1.0');
    assert.deepEqual(mustParse(text).preset, original);
  });

  it('loads the sample files without warnings', () => {
    const folder = path.join(root, 'samples', 'machines');
    const files = fs.readdirSync(folder).filter(name => name.endsWith('.jblmachine'));
    assert.ok(files.length >= 2);
    for (const name of files) {
      const result = mustParse(fs.readFileSync(path.join(folder, name), 'utf8'));
      assert.deepEqual(result.warnings, [], name);
      assert.equal(`${result.preset.id}.jblmachine`, name);
    }
  });

  it('accepts a bare preset with no envelope and fills defaults', () => {
    const { preset: loaded } = mustParse(JSON.stringify({ name: 'Doosan Puma', machineKind: 'Turn Center (2-Axis)', control: { family: 'fanuc' } }));
    assert.equal(loaded.id, 'doosan-puma');
    assert.equal(loaded.machineClass, 'lathe');
    assert.equal(loaded.workholding, 'chuck');
    assert.equal(loaded.units, 'inch');
    assert.equal(loaded.capabilities.liveTooling, false);
  });

  it("reads CAM's MachineDefinition shape (control string, axisConfiguration)", () => {
    const { preset: loaded } = mustParse(JSON.stringify({
      version: '1.0', fileType: 'machine', extension: '.jblmachine', savedAt: 0,
      machine: {
        id: 'DMU 50', name: 'DMU 50', control: 'Heidenhain TNC 640', spindleMaxRpm: 14000,
        axisConfiguration: [{ name: 'X', min: 0, max: 650 }, { name: 'B', min: -5, max: 110 }, { name: 'C', min: -360, max: 360 }],
      },
    }));
    assert.equal(loaded.id, 'dmu-50');
    assert.equal(loaded.control.family, 'heidenhain');
    assert.equal(loaded.control.model, 'Heidenhain TNC 640');
    assert.equal(loaded.axes.length, 3);
    assert.equal(loaded.capabilities.fourthAxis, true, 'a rotary in the travel table is a fourth axis');
    assert.equal(loaded.spindleMaxRpm, 14000);
  });

  it('rejects files it cannot use, and says why', () => {
    const notJson = parseJblMachine('{ nope');
    assert.equal(notJson.ok, false);
    const wrongType = parseJblMachine(JSON.stringify({ fileType: 'tools', machine: { name: 'x' } }));
    assert.equal(wrongType.ok, false);
    assert.match(!wrongType.ok ? wrongType.error : '', /tools/);
    const noName = parseJblMachine(JSON.stringify({ machine: { control: 'fanuc' } }));
    assert.equal(noName.ok, false);
  });

  it('keeps going past bad axis rows, but warns', () => {
    const result = mustParse(JSON.stringify({ name: 'M', control: 'fanuc', axes: [{ name: 'Q', min: 0, max: 1 }, { name: 'X', min: 0, max: -20 }, { name: 'X', min: 0, max: 5 }] }));
    assert.deepEqual(result.preset.axes, [{ name: 'X', min: -20, max: 0 }]);
    assert.equal(result.warnings.length, 2);
  });

  it('warns on a newer major version instead of refusing it', () => {
    const result = mustParse(JSON.stringify({ version: '2.3', fileType: 'machine', machine: { name: 'M', control: { family: 'haas' } } }));
    assert.equal(result.warnings.length, 1);
  });

  it('maps control names from CAM, the hub and people to a dialect', () => {
    assert.equal(controlFamilyFromName('Fanuc 31i'), 'fanuc');
    assert.equal(controlFamilyFromName('HAAS'), 'haas');
    assert.equal(controlFamilyFromName('Sinumerik 840D sl'), 'siemens');
    assert.equal(controlFamilyFromName('Mazatrol SmoothX'), 'mazak');
    assert.equal(controlFamilyFromName('OSP-P300L'), 'okuma');
    assert.equal(controlFamilyFromName('Fanuc R-30iB Plus'), 'fanuc-robot');
    assert.equal(controlFamilyFromName('ABB OmniCore'), 'abb');
    assert.equal(controlFamilyFromName(''), 'unknown');
    assert.equal(controlFamilyFromName('Brother CNC-C00'), 'unknown');
  });

  it('maps detailed machine kinds to the broad profile', () => {
    assert.equal(machineClassForKind('Turn Center (2-Axis)'), 'lathe');
    assert.equal(machineClassForKind('5-Axis Mill-Turn'), 'mill-turn');
    assert.equal(machineClassForKind('Swiss-type'), 'mill-turn');
    assert.equal(machineClassForKind('Grinding Center'), 'grinder');
    assert.equal(machineClassForKind('4-Axis Mill'), 'mill');
  });

  it('makes ids that are safe file names', () => {
    assert.equal(slugifyPresetId('Cell 3 — Haas VF-2'), 'cell-3-haas-vf-2');
    assert.equal(slugifyPresetId('///'), 'machine');
  });

  it('describes a preset without repeating the control name', () => {
    assert.equal(describeMachinePreset(preset({ name: 'a', control: { family: 'haas', model: 'NGC' } })), 'Haas NGC · 3-Axis Vertical Mill · inch');
    assert.equal(describeMachinePreset(preset({ name: 'a', control: { family: 'fanuc', model: 'Fanuc 31i' } })), 'Fanuc 31i · 3-Axis Vertical Mill · inch');
  });
});

describe('Preset library', () => {
  it('has unique, valid built-ins', () => {
    const ids = BUILTIN_PRESETS.map(item => item.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('lets a workspace copy win over the same id elsewhere', () => {
    const shop = preset({ id: 'vf2', name: 'VF-2 (shop)', control: 'haas' });
    const job = preset({ id: 'vf2', name: 'VF-2 (this job)', control: 'haas' });
    const mine = preset({ id: 'mine', name: 'Mine', control: 'fanuc' });
    const entries: PresetEntry[] = [
      { preset: shop, source: 'library', filePath: '/lib/vf2.jblmachine' },
      { preset: mine, source: 'library', filePath: '/lib/mine.jblmachine' },
      { preset: job, source: 'workspace', filePath: '/job/.jobline/machines/vf2.jblmachine' },
    ];
    const merged = mergePresetEntries(entries);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].preset.name, 'VF-2 (this job)');
    assert.equal(merged[0].source, 'workspace');
  });

  it('never hands out a taken id', () => {
    assert.equal(uniquePresetId('Haas VF-2', []), 'haas-vf-2');
    assert.equal(uniquePresetId('Haas VF-2', ['haas-vf-2', 'haas-vf-2-2']), 'haas-vf-2-3');
  });

  it('writes the settings the rest of the extension already reads', () => {
    const lathe = BUILTIN_PRESETS.find(item => item.id === 'builtin-okuma-lathe')!;
    assert.deepEqual(settingsForPreset(lathe), {
      controlType: 'okuma', machineType: 'lathe', units: 'inch', detectedMachineType: 'Turn Center (2-Axis)',
    });
  });

  it('notices when a setting was changed by hand after applying', () => {
    const mill = BUILTIN_PRESETS.find(item => item.id === 'builtin-haas-vf-mill')!;
    assert.deepEqual(presetOverrides(mill, settingsForPreset(mill)), []);
    assert.deepEqual(presetOverrides(mill, { ...settingsForPreset(mill), controlType: 'fanuc' }), ['controlType']);
  });

  it('builds a starting preset from current settings', () => {
    const fromSettings = presetFromSettings('Bench lathe', { controlType: 'fanuc', machineType: 'lathe', units: 'metric', detectedMachineType: '' });
    assert.equal(fromSettings.machineKind, 'Turn Center (2-Axis)');
    assert.equal(fromSettings.units, 'metric');
  });

  it('reads travel the way machinists type it', () => {
    assert.deepEqual(parseTravelInput('X30 Y16 Z20'), [
      { name: 'X', min: -30, max: 0 }, { name: 'Y', min: -16, max: 0 }, { name: 'Z', min: -20, max: 0 },
    ]);
    assert.deepEqual(parseTravelInput('x30y16z20 a120'), parseTravelInput('X30 Y16 Z20 A120'));
    assert.deepEqual(parseTravelInput('30x16x20'), parseTravelInput('X30 Y16 Z20'));
    assert.deepEqual(parseTravelInput('A120'), [{ name: 'A', min: -120, max: 120 }]);
    assert.deepEqual(parseTravelInput(''), []);
    assert.equal(parseTravelInput('thirty'), undefined);
    assert.equal(parseTravelInput('30 16 20 40'), undefined, 'a fourth bare number has no axis');
  });
});

describe('Program vs. machine preset', () => {
  const mill = BUILTIN_PRESETS.find(item => item.id === 'builtin-haas-vf-mill')!;
  const lathe = BUILTIN_PRESETS.find(item => item.id === 'builtin-haas-st-lathe')!;
  const fiveAxis = BUILTIN_PRESETS.find(item => item.id === 'builtin-siemens-5axis')!;
  const robot = BUILTIN_PRESETS.find(item => item.id === 'builtin-fanuc-robot')!;
  const gcode = (detectedMachineType: string) => ({ detectedMachineType, languageId: 'gcode' });

  it('stays quiet when the program fits', () => {
    assert.equal(programPresetMismatch(mill, gcode('3-Axis Vertical Mill')), undefined);
    assert.equal(programPresetMismatch(lathe, gcode('Turn Center (2-Axis)')), undefined);
    assert.equal(programPresetMismatch(fiveAxis, gcode('5-Axis Mill (Trunnion)')), undefined);
  });

  it('does not argue with a lathe over a program with no machine-specific codes', () => {
    // The detector's fallback for "nothing found" is a 3-axis mill.
    assert.equal(programPresetMismatch(lathe, gcode('3-Axis Vertical Mill')), undefined);
  });

  it('flags turning codes on a mill', () => {
    assert.match(programPresetMismatch(mill, gcode('Turn Center (2-Axis)')) ?? '', /turning/);
  });

  it('flags rotary moves on a machine without rotaries', () => {
    assert.match(programPresetMismatch(mill, gcode('4-Axis Mill')) ?? '', /rotary axis/);
    assert.match(programPresetMismatch(mill, gcode('5-Axis Mill (Trunnion)')) ?? '', /two rotary/);
  });

  it('flags mill-turn work on a plain lathe', () => {
    assert.match(programPresetMismatch(lathe, gcode('5-Axis Mill-Turn')) ?? '', /live tooling/);
  });

  it('flags robot and CNC programs on the wrong kind of controller', () => {
    assert.ok(programPresetMismatch(mill, { detectedMachineType: '', languageId: 'fanuc-tp' }));
    assert.ok(programPresetMismatch(robot, gcode('3-Axis Vertical Mill')));
    assert.equal(programPresetMismatch(robot, { detectedMachineType: '', languageId: 'fanuc-tp' }), undefined);
  });
});

describe('Shared with jobline.ai-CAM', () => {
  const camRoot = path.join(root, '..', 'jobline.ai-CAM');
  const pairs: Array<[string, string]> = [
    ['src/presets/jblMachine.ts', 'src/core/persistence/jblMachine.ts'],
    ['schemas/jblmachine.schema.json', 'schemas/jblmachine.schema.json'],
  ];
  for (const [mine, theirs] of pairs) {
    it(`${mine} matches the CAM copy`, (t) => {
      const other = path.join(camRoot, theirs);
      if (!fs.existsSync(other)) {
        t.skip('jobline.ai-CAM is not checked out next to this repository');
        return;
      }
      assert.equal(fs.readFileSync(path.join(root, mine), 'utf8'), fs.readFileSync(other, 'utf8'));
    });
  }
});
