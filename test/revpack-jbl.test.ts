/**
 * CAM -> .jbl -> VS Code round trip. test/fixtures/jbl/*.jbl were written by
 * jobline.ai-CAM's Setup / WCS exporter (wcsJblText; CAM commits the same
 * files as src/core/revpack/__tests__/jbl/) for the placements its Playwright
 * check makes: VF-2 bore centre, UMC-750 bore axis to Z. Opened here through
 * the extension's own loader ("Load RevPack…" -> readRevPack -> Origin panel
 * session -> buildRevPackScene), each must show the origin, readout, G54,
 * part zero and stock CAM wrote. JOBLINE_CAM_JBL_DIR adds .jbl files exported
 * from the running CAM app (its e2e saves them in test-results/cam-wcs-ui/).
 *
 * Run via: npm run test:revpack
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildRevPackScene, readRevPack } from '../src/providers/visualizer/revpackLoader';
import { PlacementSessions, placementPanelMessage } from '../src/providers/visualizer/revpackPlacementHost';
import { checkStockSetup } from '../src/providers/visualizer/revpack';

const fixtures = path.join(__dirname, 'fixtures', 'jbl');
const packs = path.join(__dirname, 'fixtures', 'revpack-public');
const CAM_JBL = path.join('src', 'core', 'revpack', '__tests__', 'jbl');
const camRoot = [process.env.JOBLINE_CAM_ROOT ?? '', path.join(__dirname, '..', '..', 'jobline.ai-CAM'), path.join(__dirname, '..', '..', 'jl-cam-laser')]
  .find(root => root && fs.existsSync(path.join(root, CAM_JBL)));
const camFixtures = camRoot ? path.join(camRoot, CAM_JBL) : '';
const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} != ${b}`);
const nearV = (a: ArrayLike<number>, b: ArrayLike<number>, tol: number, msg: string) => { assert.equal(a.length, b.length, msg); for (let k = 0; k < a.length; k++) near(a[k], b[k], tol, `${msg}[${k}]`); };

const files = [
  ...fs.readdirSync(fixtures).filter(f => f.endsWith('.jbl')).map(f => path.join(fixtures, f)),
  ...(process.env.JOBLINE_CAM_JBL_DIR && fs.existsSync(process.env.JOBLINE_CAM_JBL_DIR)
    ? fs.readdirSync(process.env.JOBLINE_CAM_JBL_DIR).filter(f => f.endsWith('.jbl')).map(f => path.join(process.env.JOBLINE_CAM_JBL_DIR!, f))
    : []),
];

describe('.jbl from jobline.ai-CAM opens with the same Setup / WCS', () => {
  it('has the CAM fixtures', () => assert.ok(files.length >= 2, 'test/fixtures/jbl has the CAM-exported jobs'));
  for (const file of files) {
    if (!JSON.parse(fs.readFileSync(file, 'utf8')).pack) {
      // A part set up on its own in CAM (an upload, no RevPack): the extension
      // says so instead of guessing a machine and setup.
      it(`${path.basename(file)} (exported by the CAM app, no RevPack): refused with the reason`, () => {
        assert.throws(() => readRevPack(file), /no RevPack/);
      });
      continue;
    }
    it(`${path.basename(file)}${file.startsWith(fixtures) ? '' : ' (exported by the CAM app)'}: origin, readout, G54, part zero and stock match`, () => {
      const loaded = readRevPack(file);
      const jbl = loaded.jbl!;
      assert.ok(jbl, 'read as a .jbl');
      assert.ok(loaded.placement, 'carries a session');
      assert.ok(loaded.targetStl && loaded.targetStl.length > 84, 'carries its target STL');
      // Load RevPack… seeds the Origin panel with the job's setup.
      const sessions = new PlacementSessions();
      const key = `revpack:${loaded.file}`;
      sessions.seed(key, loaded.placement!);
      assert.ok(sessions.has(key));
      const programFile = path.join(packs, loaded.pack.id, loaded.pack.program.file);
      const gcode = fs.existsSync(programFile) ? fs.readFileSync(programFile, 'utf8') : '';
      const scene = buildRevPackScene(loaded, gcode, [], sessions.session(key));
      assert.ok(scene.placementTarget, 'the target is pickable');
      assert.ok(scene.targetTransform, 'the target is drawn moved');
      nearV(scene.targetTransform!, jbl.setup.targetTransform, 1e-9, 'target transform');
      const panel = placementPanelMessage(scene.placementTarget, sessions.session(key));
      // The Origin panel readout = what CAM's Setup / WCS panel showed.
      assert.equal(panel.label, jbl.setup.readout.label);
      nearV(panel.readout!.fromPartMin, jbl.setup.readout.fromPartMin, 1e-6, 'from part min');
      nearV(panel.readout!.fromPartCenter, jbl.setup.readout.fromPartCenter, 1e-6, 'from part centre');
      nearV(panel.readout!.partSize, jbl.setup.readout.partSize, 1e-6, 'part size');
      assert.equal(panel.workOffset?.name, jbl.setup.workOffset?.name);
      nearV([panel.workOffset!.x, panel.workOffset!.y, panel.workOffset!.z], [jbl.setup.workOffset!.x, jbl.setup.workOffset!.y, jbl.setup.workOffset!.z], 1e-6, 'G54');
      nearV(panel.partBox!.min, jbl.setup.partBox.min, 1e-5, 'part box min');
      nearV(panel.partBox!.max, jbl.setup.partBox.max, 1e-5, 'part box max');
      nearV(panel.stockBox!.min, jbl.setup.stockBox.min, 1e-5, 'stock box min');
      nearV(panel.stockBox!.max, jbl.setup.stockBox.max, 1e-5, 'stock box max');
      assert.equal(panel.insideStock, true);
      // The scene draws the placed pack: G54, part zero and stock offsets as CAM wrote them.
      const info = scene.setup.find(m => (m as { type: string }).type === 'revpackInfo') as unknown as Record<string, unknown> | undefined;
      assert.ok(info, 'revpackInfo message');
      const g54 = jbl.placedPack!.workOffsets.G54;
      nearV([panel.workOffset!.x, panel.workOffset!.y, panel.workOffset!.z], [g54.x, g54.y ?? 0, g54.z], 1e-6, 'placed pack G54');
      assert.deepEqual(scene.geometry.target ? [scene.geometry.target.bounds.min, scene.geometry.target.bounds.max].flat().map(v => Math.round(v * 1e4) / 1e4) : [], [...jbl.setup.partBox.min, ...jbl.setup.partBox.max].map(v => Math.round(v * 1e4) / 1e4));
      const check = checkStockSetup(jbl.placedPack!, jbl.setup.partBox);
      assert.deepEqual(check.errors, []);
      assert.equal(jbl.placedPack!.setup?.partZero, jbl.setup.partZero);
      // The job says the program must be re-posted after the move.
      assert.equal(jbl.post.needsRepost, true);
    });
  }
  it('fixtures are byte-identical to CAM\'s when CAM is checked out beside this repo', (t) => {
    if (!camFixtures) { t.skip('CAM not beside this repo'); return; }
    for (const f of fs.readdirSync(fixtures).filter(n => n.endsWith('.jbl'))) {
      assert.ok(fs.readFileSync(path.join(fixtures, f)).equals(fs.readFileSync(path.join(camFixtures, f))), `${f} differs from CAM's copy`);
    }
  });
  it('a .jbl without a RevPack or with a bad schema is refused with the reason', () => {
    const tmp = path.join(os.tmpdir(), `jbl-${process.pid}`);
    fs.mkdirSync(tmp, { recursive: true });
    const bad = path.join(tmp, 'bad.jbl');
    fs.writeFileSync(bad, '{"schema":"x"}');
    assert.throws(() => readRevPack(bad), /not a JobLine \.jbl/);
    const upload = JSON.parse(fs.readFileSync(path.join(fixtures, fs.readdirSync(fixtures).find(f => f.endsWith('.jbl'))!), 'utf8'));
    delete upload.pack;
    const noPack = path.join(tmp, 'part.jbl');
    fs.writeFileSync(noPack, JSON.stringify(upload));
    assert.throws(() => readRevPack(noPack), /no RevPack/);
  });
});
