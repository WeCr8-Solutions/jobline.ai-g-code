/**
 * RevPack wiring: the pack beside a program is found, and the visualizer
 * receives the pack's stock, EVERY workholding shape, target mesh, tools with
 * gauge lengths, machine, badge and correlation findings.
 *
 * Run via: npm run test:revpack
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildRevPackScene, findRevPackForProgram, readRevPack, clearRevPackMessages } from '../src/providers/visualizer/revpackLoader';

const root = path.join(__dirname, 'fixtures', 'revpack-public');
const packDir = (dir: string) => path.join(root, dir);

function programOf(dir: string): string {
  const pack = JSON.parse(fs.readFileSync(path.join(packDir(dir), 'revpack.json'), 'utf8'));
  return path.join(packDir(dir), pack.program.file);
}

describe('RevPack discovery', () => {
  for (const dir of ['haas-umc750-5axis', 'haas-umc750-5axis-seeded', 'haas-vf2-vise', 'okuma-lb3000-lathe', 'trumpf-trulaser3030']) {
    it(`${dir}: revpack.json beside the program is found`, () => {
      const found = findRevPackForProgram(programOf(dir));
      assert.ok(found, 'pack not found');
      assert.equal(found.dir, packDir(dir));
    });
  }

  it('finds a parent revpack/ folder and skips a pack for a different program', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'revpack-'));
    try {
      fs.mkdirSync(path.join(tmp, 'revpack'));
      fs.mkdirSync(path.join(tmp, 'programs', 'op10'), { recursive: true });
      const pack = JSON.parse(fs.readFileSync(path.join(packDir('haas-vf2-vise'), 'revpack.json'), 'utf8'));
      fs.writeFileSync(path.join(tmp, 'revpack', 'revpack.json'), JSON.stringify(pack));
      fs.writeFileSync(path.join(tmp, 'programs', 'op10', 'O01001.nc'), '%\nO01001\n%\n');
      fs.writeFileSync(path.join(tmp, 'programs', 'op10', 'O09999.nc'), '%\nO09999\n%\n');
      const found = findRevPackForProgram(path.join(tmp, 'programs', 'op10', 'O01001.nc'), tmp);
      assert.ok(found, 'parent revpack/ not found');
      assert.equal(found.pack.id, 'haas-vf2-vise-plate');
      assert.equal(findRevPackForProgram(path.join(tmp, 'programs', 'op10', 'O09999.nc'), tmp), undefined,
        'a pack naming another program must not be borrowed');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects an invalid pack with the validation errors', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'revpack-bad-'));
    try {
      const file = path.join(tmp, 'revpack.json');
      fs.writeFileSync(file, JSON.stringify({ schema: 'jobline.revpack/2', id: 'x' }));
      assert.throws(() => readRevPack(file), /not a valid RevPack/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('RevPack scene for the visualizer', () => {
  for (const dir of ['haas-umc750-5axis', 'haas-umc750-5axis-seeded', 'haas-vf2-vise', 'okuma-lb3000-lathe']) {
    it(`${dir}: stock, all workholding, target, tools, machine and badge come from the pack`, () => {
      const loaded = findRevPackForProgram(programOf(dir))!;
      const scene = buildRevPackScene(loaded, fs.readFileSync(programOf(dir), 'utf8'));
      const types = scene.setup.map(message => message.type);
      for (const type of ['machineType', 'stockSettings', 'stockOrigin', 'revpackWorkholding', 'toolLibrary', 'toolData', 'revpackInfo']) {
        assert.ok(types.includes(type as never), `${type} missing`);
      }
      const holding = scene.setup.find(message => message.type === 'revpackWorkholding') as Extract<typeof scene.setup[number], { type: 'revpackWorkholding' }>;
      assert.equal(holding.shapes.length, loaded.pack.workholding.length, 'every workholding shape is sent, not just the first');
      const library = scene.setup.find(message => message.type === 'toolLibrary') as Extract<typeof scene.setup[number], { type: 'toolLibrary' }>;
      for (const tool of loaded.pack.tools) {
        const sent = library.tools.find(entry => entry.toolNumber === tool.t);
        assert.ok(sent, `T${tool.t} missing from the library`);
        assert.equal(sent.length, tool.gaugeLength, `T${tool.t} gauge length`);
        assert.equal(sent.diameter, tool.diameter);
      }
      const info = scene.setup.find(message => message.type === 'revpackInfo') as Extract<typeof scene.setup[number], { type: 'revpackInfo' }>;
      assert.equal(info.id, loaded.pack.id);
      assert.equal(info.source, loaded.file);
      assert.deepEqual(info.workOffsets, loaded.pack.workOffsets);
      assert.ok(scene.target, 'target STL loads');
      assert.ok(scene.target.meshVertices.length >= 9);
      assert.equal(scene.findings.packId, loaded.pack.id);
      assert.equal(scene.sceneMessage.workholding.length, loaded.pack.workholding.length, 'every workholding solid comes from the shared kernel');
      assert.equal(scene.sceneMessage.tools.length, loaded.pack.tools.length);
      assert.ok(scene.sceneMessage.stock.positions.length >= 9 * 12);
      assert.ok(scene.sceneMessage.stock.edges.length >= 6 * 12, 'stock wireframe edges');
    });
  }

  it('a turned bar is drawn back from its face, so the origin is zMax', () => {
    const loaded = findRevPackForProgram(programOf('okuma-lb3000-lathe'))!;
    const scene = buildRevPackScene(loaded, fs.readFileSync(programOf('okuma-lb3000-lathe'), 'utf8'));
    const origin = scene.setup.find(message => message.type === 'stockOrigin') as { zOff: number };
    assert.equal(origin.zOff, 1);
    const holding = scene.setup.find(message => message.type === 'revpackWorkholding') as { shapes: Array<{ kind: string }> };
    assert.equal(holding.shapes[0].kind, 'cylinder');
  });

  it('seeded UMC-750 findings carry 1-based program lines for diagnostics', () => {
    const program = programOf('haas-umc750-5axis-seeded');
    const scene = buildRevPackScene(findRevPackForProgram(program)!, fs.readFileSync(program, 'utf8'));
    const lines = fs.readFileSync(program, 'utf8').split(/\r?\n/).length;
    assert.ok(scene.findings.findings.length >= 9);
    assert.ok(scene.report.summary.errors > 0);
    for (const finding of scene.findings.findings) assert.ok(finding.line >= 1 && finding.line <= lines, `${finding.id} line ${finding.line}`);
  });

  it('the clear set removes badge, fixture and findings', () => {
    const types = clearRevPackMessages().map(message => (message as { type: string }).type);
    assert.deepEqual(types, ['revpackInfo', 'revpackScene', 'revpackWorkholding', 'revpackFindings']);
  });
});
