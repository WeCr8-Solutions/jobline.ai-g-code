/**
 * RevPack ⇄ G-code correlation tests.
 *
 * These run on every clone: the packs under test/fixtures/revpack-public/ are
 * synthetic and committed, so nothing here skips. Each pack carries its target,
 * stock, workholding, work-offset locations, tool list and machine, and the
 * program is stepped against all of it.
 *
 * Run via: npm run test:revpack
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateRevPack, type RevPack } from '../src/providers/visualizer/revpack';
import { correlateProgramWithRevPack } from '../src/providers/visualizer/revpackCorrelation';
import { buildRevPackSimulationMessages } from '../src/providers/visualizer/simulationSetup';
import { BUILTIN_PRESETS } from '../src/presets/presetLibrary';

const root = path.join(__dirname, 'fixtures', 'revpack-public');
const load = (dir: string) => {
  const pack = JSON.parse(fs.readFileSync(path.join(root, dir, 'revpack.json'), 'utf8')) as RevPack;
  const gcode = fs.readFileSync(path.join(root, dir, pack.program.file), 'utf8');
  return { pack, gcode };
};
const ids = (report: ReturnType<typeof correlateProgramWithRevPack>) => report.findings.map(finding => finding.id);

describe('RevPack fixtures', () => {
  for (const dir of fs.readdirSync(root)) {
    it(`${dir}: is a complete jobline.revpack/2 pack`, () => {
      const { pack } = load(dir);
      const validation = validateRevPack(pack);
      assert.ok(validation.ok, validation.errors.join('; '));
      assert.ok(pack.workOffsets && Object.keys(pack.workOffsets).length > 0);
      assert.ok(pack.machine.axes.length >= 2);
      if (pack.machine.presetId) {
        assert.ok(BUILTIN_PRESETS.some(preset => preset.id === pack.machine.presetId), `${pack.machine.presetId} is not a built-in preset`);
      }
    });

    it(`${dir}: meets its expectation`, () => {
      const { pack, gcode } = load(dir);
      const report = correlateProgramWithRevPack(gcode, pack);
      if (pack.expect?.clean) assert.equal(report.summary.errors, 0, report.findings.map(f => `${f.line} ${f.id}`).join('\n'));
      for (const id of pack.expect?.findingIds ?? []) {
        assert.ok(ids(report).some(found => found.startsWith(id)), `expected ${id}; got ${ids(report).join(', ')}`);
      }
    });

    it(`${dir}: feeds the visualizer stock and workholding from the pack, not the program`, () => {
      const { pack } = load(dir);
      const messages = buildRevPackSimulationMessages(pack);
      assert.ok(messages.some(message => message.type === 'stockSettings'));
      assert.ok(messages.some(message => message.type === 'workholdingSettings'));
      assert.ok(messages.some(message => message.type === 'toolLibrary'));
    });
  }
});

describe('Haas UMC-750 5-axis correlation', () => {
  it('runs the clean program inside travel with TCPC and DWO from the Haas dialect', () => {
    const { pack, gcode } = load('haas-umc750-5axis');
    const report = correlateProgramWithRevPack(gcode, pack);
    assert.equal(report.summary.errors, 0);
    assert.deepEqual(report.toolsUsed, [1, 2, 3]);
    assert.ok(report.machineExtents.B.max === 90, 'the 3+2 drill runs at B90');
    assert.ok(report.segments.some(segment => segment.tilted && !segment.rapid), 'simultaneous TCPC moves are tilted');
    assert.ok(report.checks['five-axis'].checked > 0);
  });

  it('catches every seeded error', () => {
    const { pack, gcode } = load('haas-umc750-5axis-seeded');
    const found = ids(correlateProgramWithRevPack(gcode, pack));
    for (const id of ['undefined-work-offset-G55', 'rapid-into-stock', 'unsafe-tool-change', 'tool-length-mismatch-T2',
      'simultaneous-5x-without-tcpc', 'tool-not-in-revpack-T4', 'over-travel-B', 'rpm-over-machine', 'rapid-into-jaw']) {
      assert.ok(found.includes(id), `missing ${id}: ${found.join(', ')}`);
    }
  });

  it('rejects the Fanuc TCPC code on the Haas control', () => {
    const { pack, gcode } = load('haas-umc750-5axis');
    const report = correlateProgramWithRevPack(gcode.replace('G234 H02', 'G43.4 H02'), pack);
    assert.ok(ids(report).includes('foreign-5x-code-G43.4'));
  });

  it('flags Z over-travel when the work offset sits too deep for the tool', () => {
    const { pack, gcode } = load('haas-umc750-5axis');
    const deep = { ...pack, workOffsets: { G54: { x: -15, y: -10, z: -24.5 } } };
    assert.ok(ids(correlateProgramWithRevPack(gcode, deep)).includes('over-travel-Z'));
  });
});

describe('Okuma Spaceturn LB3000 EX II (OSP) correlation', () => {
  it('turns and grooves the shaft clean with OSP T-words (offset, tool, nose-R)', () => {
    const { pack, gcode } = load('okuma-lb3000-lathe');
    const report = correlateProgramWithRevPack(gcode, pack);
    assert.equal(report.summary.errors, 0, report.findings.map(f => f.id).join(', '));
    assert.deepEqual(report.toolsUsed, [1, 3, 5]);
  });

  it('flags a Fanuc-posted program on the OSP machine (the seed-e2e "LB3000 (Fanuc-post)" case)', () => {
    const { pack, gcode } = load('okuma-lb3000-lathe');
    const fanucPost = { ...pack, program: { ...pack.program, dialect: 'fanuc' } };
    assert.ok(ids(correlateProgramWithRevPack(gcode, fanucPost)).includes('dialect-mismatch'));
  });

  it('flags a rapid into the bar and an index next to the part', () => {
    const { pack, gcode } = load('okuma-lb3000-lathe');
    const bad = gcode
      .replace('G00 X85. Z0. M08', 'G00 X60. Z-10. M08')
      .replace('G00 X400. Z200. M09\nNAT02', 'G00 X100. Z5. M09\nNAT02');
    const found = ids(correlateProgramWithRevPack(bad, pack));
    assert.ok(found.includes('rapid-into-stock'), found.join(', '));
    assert.ok(found.includes('unsafe-tool-index'), found.join(', '));
  });

  it('flags the turret running into the chuck jaws', () => {
    const { pack, gcode } = load('okuma-lb3000-lathe');
    const bad = gcode.replace('G01 Z-60. F0.25', 'G01 Z-95. F0.25');
    assert.ok(ids(correlateProgramWithRevPack(bad, pack)).includes('feed-into-chuck-jaw'));
  });
});

describe('Laser platform correlation', () => {
  it('runs the TruLaser nest without spindle or tool-length rules', () => {
    const { pack, gcode } = load('trumpf-trulaser3030');
    const report = correlateProgramWithRevPack(gcode, pack);
    assert.equal(report.summary.errors, 0, report.findings.map(f => f.id).join(', '));
  });

  it('flags a nest that runs off the 3000 x 1500 table', () => {
    const { pack, gcode } = load('trumpf-trulaser3030');
    const far = { ...pack, workOffsets: { G54: { x: 2200, y: 100, z: 10 } } };
    assert.ok(ids(correlateProgramWithRevPack(gcode, far)).includes('over-travel-X'));
  });
});

describe('Haas VF-2 vise correlation', () => {
  it('drills and taps clear of the parallels and jaws', () => {
    const { pack, gcode } = load('haas-vf2-vise');
    assert.equal(correlateProgramWithRevPack(gcode, pack).summary.errors, 0);
  });

  it('flags a drill through the plate into a parallel under the hole', () => {
    const { pack, gcode } = load('haas-vf2-vise');
    const underHoles = { ...pack, workholding: [...pack.workholding, { name: 'Center parallel', min: [-2, -1, -2] as [number, number, number], max: [2, 1, -0.75] as [number, number, number] }] };
    assert.ok(ids(correlateProgramWithRevPack(gcode, underHoles)).some(id => id.endsWith('into-workholding')));
  });

  it('flags a missing G43 before the first Z move', () => {
    const { pack, gcode } = load('haas-vf2-vise');
    const bad = gcode.replace('G43 H01 Z1.0 M08', 'Z1.0 M08');
    assert.ok(ids(correlateProgramWithRevPack(bad, pack)).includes('no-tool-length-after-change'));
  });

  it('flags cutting before the spindle starts', () => {
    const { pack, gcode } = load('haas-vf2-vise');
    const bad = gcode.replace('S4000 M03', 'S4000');
    assert.ok(ids(correlateProgramWithRevPack(bad, pack)).includes('feed-with-spindle-off'));
  });
});
