/**
 * RevPack workholding: separate solids per role (vise body, jaws, zero-point
 * plate, riser), the gripped stock region, grip depth against the vise maker's
 * recommendation, tilted-tool reach to the jaws, and stock placed exactly where
 * the setup says around the target - for every public pack and the AR4 uploads.
 *
 * The UMC-750 packs hold the part in a LANG Makro-Grip 77 5-axis vise
 * (48120-77) on a Quick-Point 52 plate, built parametrically from LANG's
 * published numbers (see the pack's workholdingSpec.sources).
 *
 * Run via: npm run test:revpack
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  checkStockSetup, grippedRegion, stockFromSetup, uploadSetup, validateRevPack, workholdingObject,
  type RevPack, type RevPackBox, type Vec3,
} from '../src/providers/visualizer/revpack';
import { correlateProgramWithRevPack } from '../src/providers/visualizer/revpackCorrelation';
import { buildRevPackGeometry, loadStl } from '../src/providers/visualizer/revpackGeometry';
import { targetStlFile } from '../src/providers/visualizer/revpack';
import { AR4_PARTS, ar4Dir } from './ar4Parts';

const root = path.join(__dirname, 'fixtures', 'revpack-public');
const load = (dir: string) => {
  const pack = JSON.parse(fs.readFileSync(path.join(root, dir, 'revpack.json'), 'utf8')) as RevPack;
  const gcode = fs.readFileSync(path.join(root, dir, pack.program.file), 'utf8');
  const stl = targetStlFile(pack);
  const target = stl ? loadStl(fs.readFileSync(path.join(root, dir, stl))) : undefined;
  return { pack, gcode, target };
};
const ids = (report: ReturnType<typeof correlateProgramWithRevPack>) => report.findings.map(f => f.id);
const MM = 1 / 25.4;

describe('RevPack workholding schema', () => {
  it('the UMC-750 packs carry the vise as separate solids, each with a role', () => {
    for (const dir of ['haas-umc750-5axis', 'haas-umc750-5axis-seeded']) {
      const { pack } = load(dir);
      const roles = pack.workholding.map(w => w.role);
      assert.deepEqual(roles.sort(), ['moving-jaw', 'moving-jaw', 'riser', 'vise-body', 'zero-point']);
      assert.equal(pack.workholdingSpec?.itemNo, '48120-77');
      assert.equal(pack.workholdingSpec?.kind, 'self-centering-vise');
      assert.ok((pack.workholdingSpec?.sources.length ?? 0) >= 3, 'specs cite their sources');
    }
  });

  it('maps each role to the viewer object that styles it', () => {
    assert.equal(workholdingObject('moving-jaw'), 'jaws');
    assert.equal(workholdingObject('fixed-jaw'), 'jaws');
    assert.equal(workholdingObject('chuck-jaw'), 'jaws');
    assert.equal(workholdingObject('vise-body'), 'fixture');
    assert.equal(workholdingObject('parallel'), 'fixture');
    assert.equal(workholdingObject('zero-point'), 'zeroPoint');
    assert.equal(workholdingObject('riser'), 'zeroPoint');
    assert.equal(workholdingObject(undefined), 'fixture');
  });

  it('rejects an unknown role and negative setup offsets', () => {
    const { pack } = load('haas-umc750-5axis');
    const bad = JSON.parse(JSON.stringify(pack));
    bad.workholding[0].role = 'magnet';
    bad.setup.stockOffsets.xMin = -1;
    const result = validateRevPack(bad);
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.includes('role must be one of')), result.errors.join('; '));
    assert.ok(result.errors.some(e => e.includes('offsets must be numbers >= 0')), result.errors.join('; '));
  });

  it('the vise is the published size: 77 mm jaws, body 38 mm, jaw top 62 mm, 130 mm long', () => {
    const { pack } = load('haas-umc750-5axis');
    const body = pack.workholding.find(w => w.role === 'vise-body') as RevPackBox;
    const jaws = pack.workholding.filter(w => w.role === 'moving-jaw') as RevPackBox[];
    const near = (a: number, b: number, tol = 0.001) => Math.abs(a - b) <= tol;
    assert.ok(near(body.max[0] - body.min[0], 77 * MM), 'body width 77 mm');
    assert.ok(near(body.max[1] - body.min[1], 130 * MM), 'body length 130 mm');
    assert.ok(near(body.max[2] - body.min[2], 38 * MM), 'body height 38 mm');
    for (const jaw of jaws) {
      assert.ok(near(jaw.max[0] - jaw.min[0], 77 * MM), 'jaw width 77 mm');
      assert.ok(near(jaw.max[2] - body.min[2], 62 * MM), 'jaw top 62 mm above the vise bottom');
    }
    // The blank rests on the jaws' 3 mm step: jaw top = stock bottom + grip depth.
    const stock = pack.stock as RevPackBox;
    assert.ok(near(jaws[0].max[2], stock.min[2] + pack.setup!.gripDepth!));
    assert.ok(near(pack.setup!.gripDepth!, 3 * MM), 'grip depth = LANG clamping depth 3 mm');
    // Self-centering: the jaws clamp the stock's two Y faces, symmetric about Y0.
    assert.ok(near(jaws[0].min[1], stock.max[1]) || near(jaws[1].min[1], stock.max[1]));
    assert.ok(near(jaws[0].max[1], stock.min[1]) || near(jaws[1].max[1], stock.min[1]));
  });
});

describe('Stock comes from the setup, with the target inside it', () => {
  for (const dir of fs.readdirSync(root).sort()) {
    it(`${dir}: stock bounds contain the target and equal the setup envelope`, () => {
      const { pack, target } = load(dir);
      assert.ok(pack.setup, 'every public pack states its setup');
      assert.ok(target, 'every public pack has a target');
      const check = checkStockSetup(pack, target!.bounds);
      assert.ok(check.containsTarget, check.errors.join('; '));
      assert.ok(check.matchesSetup, check.errors.join('; '));
      assert.ok(check.expected, 'the setup states the stock offsets');
    });
  }

  it('a stock moved off the setup is caught', () => {
    const { pack, target } = load('haas-umc750-5axis');
    const moved = { ...pack, stock: { ...(pack.stock as RevPackBox), min: [-1.4, -1.0, -1.65] as Vec3 } };
    const check = checkStockSetup(moved, target!.bounds);
    assert.ok(!check.containsTarget);
    assert.ok(!check.matchesSetup);
  });

  it('the gripped region is the bottom grip depth of the stock', () => {
    const { pack } = load('haas-umc750-5axis');
    const grip = grippedRegion(pack)!;
    const stock = pack.stock as RevPackBox;
    assert.deepEqual(grip.min, stock.min);
    assert.ok(Math.abs(grip.max[2] - (stock.min[2] + pack.setup!.gripDepth!)) < 1e-9);
    const geometry = buildRevPackGeometry(pack);
    assert.ok(geometry.grip && geometry.grip.triangleCount === 12);
    assert.deepEqual(geometry.workholding.map(w => w.object).sort(), ['fixture', 'jaws', 'jaws', 'zeroPoint', 'zeroPoint']);
  });

  const dir = ar4Dir();
  for (const part of AR4_PARTS) {
    it(`AR4 upload ${part.id}: the upload setup puts the stock around the part (3 mm sides, 1 mm top, 3 mm grip + 1 mm below)`,
      { skip: !dir && 'AR4 part files not present locally (licence forbids committing them)' }, () => {
        const mesh = loadStl(fs.readFileSync(path.join(dir!, part.stl)), 1_000_000);
        const setup = uploadSetup('mm');
        const stock = stockFromSetup(setup, mesh.bounds) as RevPackBox;
        const pack = { units: 'mm' as const, stock, setup };
        const check = checkStockSetup(pack, mesh.bounds);
        assert.ok(check.containsTarget && check.matchesSetup, check.errors.join('; '));
        assert.ok(Math.abs(stock.min[2] - (mesh.bounds.min[2] - 4)) < 1e-6);
        assert.ok(Math.abs(stock.max[0] - (mesh.bounds.max[0] + 3)) < 1e-6);
      });
  }
});

describe('Workholding collisions are named by the solid they hit', () => {
  it('the clean O05001 stays at zero findings in the Makro-Grip setup', () => {
    const { pack, gcode } = load('haas-umc750-5axis');
    const report = correlateProgramWithRevPack(gcode, pack);
    assert.deepEqual(report.findings.map(f => f.id), []);
    assert.ok(report.checks.workholding.checked > 0, 'the grip and reach checks ran');
  });

  it('the seeded rapid into workholding names the +Y jaw', () => {
    const { pack, gcode } = load('haas-umc750-5axis-seeded');
    const finding = correlateProgramWithRevPack(gcode, pack).findings.find(f => f.id === 'rapid-into-jaw');
    assert.ok(finding, 'rapid-into-jaw reported');
    assert.match(finding!.message, /jaw \+Y/);
    assert.equal(finding!.object, 'Makro-Grip 77 jaw +Y (moves, serrated)');
    assert.equal(finding!.line, gcode.split(/\r?\n/).findIndex(l => l.includes('INTO THE +Y JAW')) + 1);
  });

  const program = (body: string[]) => ['%', 'O09001', 'G20 G17 G40 G49 G80 G90', 'G28 G91 Z0.', 'G90', 'T1 M06', ...body, 'M05', 'G28 G91 Z0.', 'M30', '%'].join('\n');

  it('a rapid down beside the jaws into the vise body is rapid-into-vise-body, not a jaw', () => {
    const { pack } = load('haas-umc750-5axis');
    // X1.4 Y2.0: past the +Y jaw's outer face (Y1.47), over the body (to Y2.56).
    const report = correlateProgramWithRevPack(program(['G00 G90 G54 X1.4 Y2.0 B0. C0.', 'S5000 M03', 'G43 H01 Z1.0', 'G00 Z-2.6']), pack);
    const found = ids(report);
    assert.ok(found.includes('rapid-into-vise-body'), found.join(', '));
    assert.ok(!found.includes('rapid-into-jaw'), found.join(', '));
    assert.equal(report.findings.find(f => f.id === 'rapid-into-vise-body')!.object, 'Makro-Grip 77 base body 130x77x38');
  });

  it('a feed into the zero-point plate is feed-into-zero-point', () => {
    const { pack } = load('haas-umc750-5axis');
    const found = ids(correlateProgramWithRevPack(program(['G00 G90 G54 X2.0 Y2.8 B0. C0.', 'S5000 M03', 'G43 H01 Z1.0', 'G01 Z-4.2 F20.']), pack));
    assert.ok(found.includes('feed-into-zero-point'), found.join(', '));
  });

  it('a feed along the clamped face down into the gripped stock warns', () => {
    const { pack } = load('haas-umc750-5axis');
    const found = ids(correlateProgramWithRevPack(program(['G00 G90 G54 X-2.0 Y0.7 B0. C0.', 'S5000 M03', 'G43 H01 Z1.0', 'G01 Z-1.6 F20.', 'X0.', 'G00 Z1.0']), pack));
    assert.ok(found.includes('feed-into-grip-zone'), found.join(', '));
  });
});

describe('Grip depth against the vise maker\'s recommendation', () => {
  it('3 mm (the Makro-Grip clamping depth) passes', () => {
    const { pack, gcode } = load('haas-umc750-5axis');
    assert.ok(!ids(correlateProgramWithRevPack(gcode, pack)).includes('grip-depth-below-recommended'));
  });

  it('2 mm in the jaws warns, naming the recommendation', () => {
    const { pack, gcode } = load('haas-umc750-5axis');
    const shallow = { ...pack, setup: { ...pack.setup!, gripDepth: Math.round(2 * MM * 1e4) / 1e4 } };
    const finding = correlateProgramWithRevPack(gcode, shallow).findings.find(f => f.id === 'grip-depth-below-recommended');
    assert.ok(finding);
    assert.equal(finding!.severity, 'warning');
    assert.match(finding!.message, /LANG Technik Makro-Grip 77 5-axis vise recommends at least 0\.1181 in/);
  });
});

describe('Tilted tool reach to the jaws (5-sided access)', () => {
  const tilted = ['%', 'O09002', 'G20 G17 G40 G49 G80 G90', 'G28 G91 Z0.', 'G90', 'T1 M06',
    'G00 G90 G54 X0. Y0.6 B0. C0.', 'S5000 M03', 'G234 H01 Z1.0', 'G00 B60.', 'G01 Z-1.6 F10.', 'G00 Z1.0', 'G49', 'M05', 'G28 G91 Z0.', 'G00 B0.', 'M30', '%'].join('\n');

  it('the low Makro-Grip jaws clear a B60 side cut 0.4 in from the jaw', () => {
    const { pack } = load('haas-umc750-5axis');
    const found = ids(correlateProgramWithRevPack(tilted, pack));
    assert.ok(!found.some(id => id.startsWith('tilted-tool-hits')), found.join(', '));
  });

  it('a tall conventional jaw in the same place is hit by the tilted holder', () => {
    const { pack } = load('haas-umc750-5axis');
    const tall = {
      ...pack,
      workholding: pack.workholding.map(w => (w.name.includes('jaw +Y') ? { ...w, max: [(w as RevPackBox).max[0], (w as RevPackBox).max[1], 0.5] as Vec3 } : w)),
    };
    const finding = correlateProgramWithRevPack(tilted, tall).findings.find(f => f.id === 'tilted-tool-hits-jaw');
    assert.ok(finding, 'tilted-tool-hits-jaw reported');
    assert.equal(finding!.severity, 'warning');
    assert.match(finding!.message, /B60/);
    assert.match(finding!.message, /holder/);
  });
});
