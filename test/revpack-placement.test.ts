/**
 * Part placement / work origin (revpackPlacement.ts, shared byte-identical
 * with jobline.ai-CAM and the hub): every mode of the Origin / Setup-WCS
 * panels, on synthetic solids and on the public packs' real targets.
 *
 *  - bounding box: the 27 points (8 corners, 12 edge midpoints, 6 face
 *    centres, centre) on the part box and the stock box, the Top / Bottom /
 *    Left / Right / Front / Back / Center buttons, the presets
 *  - feature picks: planar face (axis to face, origin on face, align to
 *    top / bottom), bore / boss centre (optionally axis to Z), vertex / edge
 *    point, two-point midpoint, three-point circle
 *  - orientation: rotate 90 about X / Y / Z, flip, align axis, numeric offset
 *    with rotation, undo, reset
 *  - stock: centre in stock, the target stays inside it, and the pack after a
 *    move keeps stock, G54, vise / jaw solids and grip depth consistent
 *
 * Run via: npm run test:revpack
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as P from '../src/providers/visualizer/revpackPlacement';
import { boxSolid, buildRevPackGeometry, cylinderSolid, loadStl, transformMesh } from '../src/providers/visualizer/revpackGeometry';
import { checkStockSetup, grippedRegion, targetStlFile, type RevPack, type RevPackBox } from '../src/providers/visualizer/revpack';
import { correlateProgramWithRevPack } from '../src/providers/visualizer/revpackCorrelation';

const root = path.join(__dirname, 'fixtures', 'revpack-public');
const loadPack = (dir: string) => {
  const pack = JSON.parse(fs.readFileSync(path.join(root, dir, 'revpack.json'), 'utf8')) as RevPack;
  const stl = targetStlFile(pack)!;
  const mesh = loadStl(fs.readFileSync(path.join(root, dir, stl)));
  const gcode = fs.readFileSync(path.join(root, dir, pack.program.file), 'utf8');
  return { pack, mesh, gcode };
};
const near = (a: number, b: number, tol = 1e-6, msg?: string) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} != ${b}`);
const nearV = (a: ArrayLike<number>, b: ArrayLike<number>, tol = 1e-6, msg?: string) => { for (let k = 0; k < 3; k++) near(a[k], b[k], tol, `${msg ?? ''}[${k}]`); };

// A 4 x 3 x 1 block sitting off-origin, like a model exported in its own CAD frame.
const BLOCK = boxSolid([10, 20, 5], [14, 23, 6]);
const blockInput = (): P.PlacementInput => ({ positions: BLOCK.positions, bounds: { min: [10, 20, 5], max: [14, 23, 6] }, setup: { stockOffsets: { xMin: 0.1, xMax: 0.3, yMin: 0.2, yMax: 0.2, zMin: 0.25, zMax: 0.05 } } });
const ctxOf = (input: P.PlacementInput): P.PlacementContext => ({ geometry: { positions: input.positions, bounds: input.bounds }, setup: input.setup, stockBounds: input.stockBounds, lathe: input.lathe });
const run = (s: P.PlacementSession, input: P.PlacementInput, op: P.PlacementOp) => {
  const r = P.runPlacementOp(s, input, op);
  assert.equal(r.error, undefined, `${op.op}: ${r.error}`);
  return r;
};
/** Index of the first triangle whose normal is `n`. */
function triWithNormal(positions: ArrayLike<number>, n: P.PVec3): number {
  for (let t = 0; t < positions.length / 9; t++) {
    const tn = P.triangleNormal(positions, t).normal;
    if (P.dot(tn, n) > 0.999) return t;
  }
  throw new Error('no triangle with that normal');
}

describe('Bounding box: the 27 points', () => {
  it('8 corners, 12 edge midpoints, 6 face centres and the centre, each with a unique id and a setup-sheet label', () => {
    assert.equal(P.BOX_POINTS.length, 27);
    const kinds = P.BOX_POINTS.reduce((acc, p) => ({ ...acc, [p.kind]: (acc[p.kind] ?? 0) + 1 }), {} as Record<string, number>);
    assert.deepEqual(kinds, { corner: 8, edge: 12, face: 6, center: 1 });
    assert.equal(new Set(P.BOX_POINTS.map(p => p.id)).size, 27);
    assert.equal(P.boxPointLabel({ x: -1, y: -1, z: 1 }), 'top-front-left corner');
    assert.equal(P.boxPointLabel({ x: 0, y: 0, z: 1 }), 'top face center');
    assert.equal(P.boxPointLabel({ x: 1, y: 0, z: -1 }), 'bottom-right edge midpoint');
    assert.equal(P.boxPointLabel({ x: 0, y: 0, z: 0 }), 'center');
  });

  it('every point of the PART box becomes X0 Y0 Z0', () => {
    const input = blockInput();
    for (const bp of P.BOX_POINTS) {
      const r = run(P.newPlacementSession(), input, { op: 'boxPoint', sel: bp.sel });
      const placed = P.placedBounds(input, r.session.placement);
      const zero = P.boxPoint(placed, bp.sel);
      nearV(zero, [0, 0, 0], 1e-9, bp.id);
      assert.match(r.session.placement.label!, new RegExp(`${bp.label} of the part`));
    }
  });

  it('every point of the STOCK box (setup offsets around the part) becomes X0 Y0 Z0', () => {
    const input = blockInput();
    const o = input.setup!.stockOffsets!;
    for (const bp of P.BOX_POINTS) {
      const r = run(P.newPlacementSession(), input, { op: 'boxPoint', sel: bp.sel, ref: 'stock' });
      const part = P.placedBounds(input, r.session.placement);
      const stock = P.setupStockBounds(input.setup, part)!;
      nearV(P.boxPoint(stock, bp.sel), [0, 0, 0], 1e-9, bp.id);
    }
    // Stock top-front-left: the part sits xMin / yMin in from the corner and zMax below the top.
    const r = run(P.newPlacementSession(), input, { op: 'preset', id: 'top-front-left', ref: 'stock' });
    const part = P.placedBounds(input, r.session.placement);
    nearV(part.min, [o.xMin, o.yMin, -o.zMax - 1], 1e-9);
  });

  it('a fixed stock (no setup offsets) is measured on its own box', () => {
    const input: P.PlacementInput = { positions: BLOCK.positions, bounds: { min: [10, 20, 5], max: [14, 23, 6] }, stockBounds: { min: [9, 19, 4], max: [15, 24, 6.5] } };
    const r = run(P.newPlacementSession(), input, { op: 'boxPoint', sel: { x: -1, y: -1, z: 1 }, ref: 'stock' });
    nearV(r.session.placement.origin, [9, 19, 6.5]);
  });

  it('quick buttons move ONE axis: Top = Z0 on top, X/Y kept; Left / Right / Front / Back / Bottom likewise; Center = box centre', () => {
    const input = blockInput();
    let s = run(P.newPlacementSession(), input, { op: 'preset', id: 'top-front-left' }).session;
    s = run(s, input, { op: 'face', face: 'right' }).session;
    nearV(s.placement.origin, [14, 20, 6]);
    assert.equal(s.placement.label, 'top-front-right corner of the part');
    s = run(s, input, { op: 'face', face: 'back' }).session;
    nearV(s.placement.origin, [14, 23, 6]);
    s = run(s, input, { op: 'face', face: 'bottom' }).session;
    nearV(s.placement.origin, [14, 23, 5]);
    s = run(s, input, { op: 'face', face: 'left' }).session;
    s = run(s, input, { op: 'face', face: 'front' }).session;
    s = run(s, input, { op: 'face', face: 'top' }).session;
    nearV(s.placement.origin, [10, 20, 6]);
    s = run(s, input, { op: 'face', face: 'center' }).session;
    nearV(s.placement.origin, [12, 21.5, 5.5]);
    // From a manual origin, Top only moves Z.
    let m = run(P.newPlacementSession(), input, { op: 'offset', d: [11, 21, 0] }).session;
    m = run(m, input, { op: 'face', face: 'top' }).session;
    nearV(m.placement.origin, [11, 21, 6]);
    assert.match(m.placement.label!, /Z0 on the top face of the part/);
  });

  it('presets: Top center and Top-front-left corner', () => {
    const input = blockInput();
    nearV(run(P.newPlacementSession(), input, { op: 'preset', id: 'top-center' }).session.placement.origin, [12, 21.5, 6]);
    nearV(run(P.newPlacementSession(), input, { op: 'preset', id: 'top-front-left' }).session.placement.origin, [10, 20, 6]);
    assert.ok(P.PLACEMENT_PRESETS.some(p => p.id === 'top-center') && P.PLACEMENT_PRESETS.some(p => p.id === 'top-front-left'));
    assert.match(P.runPlacementOp(P.newPlacementSession(), input, { op: 'preset', id: 'nope' }).error!, /unknown preset/);
  });
});

describe('Orientation', () => {
  it('rotate 90 about X, Y and Z: four turns are the identity, and a box anchor is re-applied after every turn', () => {
    const input = blockInput();
    for (const axis of [0, 1, 2] as P.Axis[]) {
      let s = run(P.newPlacementSession(), input, { op: 'preset', id: 'top-center' }).session;
      for (let i = 0; i < 4; i++) {
        s = run(s, input, { op: 'rotate', axis }).session;
        const placed = P.placedBounds(input, s.placement);
        nearV(P.boxPoint(placed, { x: 0, y: 0, z: 1 }), [0, 0, 0], 1e-9, `axis ${axis} turn ${i}`);
      }
      assert.deepEqual(s.placement.rotation, P.IDENTITY);
    }
    // 90 about Z swaps the 4 x 3 footprint to 3 x 4.
    const s = run(run(P.newPlacementSession(), input, { op: 'preset', id: 'top-center' }).session, input, { op: 'rotate', axis: 2 }).session;
    const b = P.placedBounds(input, s.placement);
    nearV([b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]], [3, 4, 1]);
  });

  it('flip (op 2): the bottom becomes the top, Z0 stays on the new top', () => {
    const input = blockInput();
    const s = run(run(P.newPlacementSession(), input, { op: 'preset', id: 'top-center' }).session, input, { op: 'flip' }).session;
    const tri = triWithNormal(BLOCK.positions, [0, 0, -1]);
    const n = P.partDirToWork(s.placement, P.triangleNormal(BLOCK.positions, tri).normal);
    nearV(n, [0, 0, 1]);
    near(P.placedBounds(input, s.placement).max[2], 0);
  });

  it('align axis: +X of the part onto +Z', () => {
    const s = run(P.newPlacementSession(), blockInput(), { op: 'alignAxis', from: '+X', to: '+Z' }).session;
    nearV(P.mulVec(s.placement.rotation, [1, 0, 0]), [0, 0, 1]);
  });

  it('numeric offset: shift the zero and turn the part about it', () => {
    const input = blockInput();
    let s = run(P.newPlacementSession(), input, { op: 'preset', id: 'top-front-left' }).session;
    s = run(s, input, { op: 'offset', d: [0.5, 0.25, -0.1] }).session;
    nearV(s.placement.origin, [10.5, 20.25, 5.9]);
    s = run(s, input, { op: 'offset', d: [0, 0, 0], rotZ: 90 }).session;
    nearV(P.mulVec(s.placement.rotation, [1, 0, 0]), [0, 1, 0]);
    // The zero did not move under the turn: the part corner that was at (-0.5, -0.25) is now at (0.25, -0.5).
    nearV(P.partToWork(s.placement, [10, 20, 6]), [0.25, -0.5, 0.1]);
    // Non-quarter angles are exact to 1e-9.
    const t = run(P.newPlacementSession(), input, { op: 'offset', d: [0, 0, 0], rotZ: 30 }).session;
    near(t.placement.rotation[0], Math.cos(Math.PI / 6), 1e-12);
  });

  it('undo steps back one operation at a time; reset returns to the file origin', () => {
    const input = blockInput();
    let s = P.newPlacementSession();
    s = run(s, input, { op: 'preset', id: 'top-center' }).session;
    s = run(s, input, { op: 'rotate', axis: 2 }).session;
    s = run(s, input, { op: 'offset', d: [1, 0, 0] }).session;
    assert.equal(s.history.length, 3);
    s = run(s, input, { op: 'undo' }).session;
    s = run(s, input, { op: 'undo' }).session;
    nearV(s.placement.origin, [12, 21.5, 6]);
    s = run(s, input, { op: 'reset' }).session;
    assert.ok(P.isIdentityPlacement(s.placement));
    s = run(s, input, { op: 'undo' }).session;
    nearV(s.placement.origin, [12, 21.5, 6]);
    s = run(s, input, { op: 'undo' }).session;
    assert.equal(P.runPlacementOp(s, input, { op: 'undo' }).error, 'nothing to undo');
    // The history is bounded.
    let h = P.newPlacementSession();
    for (let i = 0; i < 80; i++) h = run(h, input, { op: 'offset', d: [0.01, 0, 0] }).session;
    assert.equal(h.history.length, 50);
  });
});

describe('Feature picks', () => {
  it('planar face: the axis along its normal gets 0 on it; origin on the face centre', () => {
    const input = blockInput();
    const right = triWithNormal(BLOCK.positions, [1, 0, 0]);
    const r = run(P.newPlacementSession(), input, { op: 'pickFace', pick: { tri: right }, action: 'axis' });
    nearV(r.session.placement.origin, [14, 0, 0]);
    assert.equal(r.feature?.kind, 'plane');
    nearV(r.feature!.normal!, [1, 0, 0]);
    assert.equal(r.feature!.triangles.length, 2);
    const top = triWithNormal(BLOCK.positions, [0, 0, 1]);
    const o = run(P.newPlacementSession(), input, { op: 'pickFace', pick: { tri: top }, action: 'origin' });
    nearV(o.session.placement.origin, [12, 21.5, 6]);
  });

  it('planar face: align to top / bottom turns its normal to +Z / -Z', () => {
    const input = blockInput();
    const front = triWithNormal(BLOCK.positions, [0, -1, 0]);
    let s = run(P.newPlacementSession(), input, { op: 'preset', id: 'top-center' }).session;
    const up = run(s, input, { op: 'pickFace', pick: { tri: front }, action: 'alignTop' });
    nearV(up.feature!.normal!, [0, 0, 1]);
    // The box anchor is kept: Z0 is on the new top (the old front face).
    near(P.placedBounds(input, up.session.placement).max[2], 0, 1e-9);
    s = run(up.session, input, { op: 'pickFace', pick: { tri: front }, action: 'alignBottom' }).session;
    nearV(P.partDirToWork(s.placement, [0, -1, 0]), [0, 0, -1]);
  });

  it('bore: centre X/Y on its axis (VF-2 plate, vertical bores)', () => {
    const { pack, mesh } = loadPack('haas-vf2-vise');
    const input: P.PlacementInput = { positions: mesh.positions, bounds: mesh.bounds, setup: pack.setup };
    const tri = 700; // a facet of the -X -Y bore (see the golden's placement.features)
    const r = run(P.newPlacementSession(), input, { op: 'pickCylinder', pick: { tri } });
    assert.equal(r.feature?.kind, 'cylinder');
    assert.equal(r.feature!.bore, true);
    near(r.feature!.radius!, 0.1005, 1e-4);
    nearV(r.session.placement.origin, [-1.25, -0.75, 0], 1e-6);
    nearV([r.feature!.point[0], r.feature!.point[1], 0], [0, 0, 0], 1e-6);
    assert.match(r.session.placement.label!, /bore axis \(dia 0\.201\)/);
    // A planar pick is refused as a bore.
    const flat = triWithNormal(mesh.positions, [0, 0, 1]);
    assert.match(P.runPlacementOp(P.newPlacementSession(), input, { op: 'pickCylinder', pick: { tri: flat } }).error!, /not on a bore or boss/);
  });

  it('bore along X turned onto Z (UMC-750 side bore): its axis becomes Z and the centre X0 Y0', () => {
    const { pack, mesh } = loadPack('haas-umc750-5axis');
    const input: P.PlacementInput = { positions: mesh.positions, bounds: mesh.bounds, setup: pack.setup };
    const r = run(P.newPlacementSession(), input, { op: 'pickCylinder', pick: { tri: 292 }, align: true });
    nearV(P.normalize(r.feature!.axisDir!).map(Math.abs), [0, 0, 1], 1e-9);
    near(r.feature!.point[0], 0, 1e-6);
    near(r.feature!.point[1], 0, 1e-6);
    assert.match(r.session.placement.label!, /axis turned to Z, Z0 on top/);
    near(P.placedBounds(input, r.session.placement).max[2], 0, 1e-9);
  });

  it('boss and bore on a turned shaft are told apart; the fits are exact on a 48-facet cylinder', () => {
    const shaft = cylinderSolid(2, 0, 3, 1, 48);
    const input: P.PlacementInput = { positions: shaft.positions, bounds: shaft.bounds };
    let boss: P.CylinderFit | undefined, bore: P.CylinderFit | undefined;
    for (let t = 0; t < shaft.triangleCount && (!boss || !bore); t++) {
      const f = P.pickFeature(shaft.positions, t);
      if (f?.kind === 'cylinder') { if (f.bore) bore ??= f; else boss ??= f; }
    }
    assert.ok(boss && bore);
    near(boss!.radius, 1, 2e-3); near(bore!.radius, 0.5, 2e-3);
    assert.ok(boss!.residual < 0.01 && bore!.residual < 0.01);
    const r = run(P.newPlacementSession(), input, { op: 'pickCylinder', pick: { tri: boss!.triangles[0] } });
    nearV([r.session.placement.origin[0], r.session.placement.origin[1], 0], [0, 0, 0], 1e-6);
  });

  it('vertex / edge pick snaps to the nearest vertex or edge midpoint of the picked triangle', () => {
    const input = blockInput();
    const top = triWithNormal(BLOCK.positions, [0, 0, 1]);
    const r = run(P.newPlacementSession(), input, { op: 'pickPoint', pick: { tri: top, point: [10.05, 20.02, 6] } });
    nearV(r.session.placement.origin, [10, 20, 6]);
    assert.equal(r.feature?.kind, 'point');
  });

  it('two-point midpoint and three-point circle centre', () => {
    const input = blockInput();
    const top = triWithNormal(BLOCK.positions, [0, 0, 1]);
    const mid = run(P.newPlacementSession(), input, { op: 'midpoint', picks: [{ tri: top, point: [10, 20, 6] }, { tri: top, point: [14, 23, 6] }] });
    nearV(mid.session.placement.origin, [12, 21.5, 6]);
    nearV(P.circleFrom3Points([1, 0, 0], [0, 1, 0], [-1, 0, 0])!.center, [0, 0, 0]);
    near(P.circleFrom3Points([1, 0, 0], [0, 1, 0], [-1, 0, 0])!.radius, 1);
    assert.equal(P.circleFrom3Points([0, 0, 0], [1, 0, 0], [2, 0, 0]), undefined);
    // Three vertices on the rim of a bore of the shaft: centre on the spindle axis.
    const shaft = cylinderSolid(2, 0, 3, 1, 48);
    const sIn: P.PlacementInput = { positions: shaft.positions, bounds: shaft.bounds };
    const rim: P.PlacementPick[] = [];
    for (let t = 0; t < shaft.triangleCount && rim.length < 3; t++) {
      for (let k = 0; k < 3 && rim.length < 3; k++) {
        const i = t * 9 + k * 3;
        const v: P.PVec3 = [shaft.positions[i], shaft.positions[i + 1], shaft.positions[i + 2]];
        if (Math.abs(v[2] - 3) < 1e-6 && Math.abs(Math.hypot(v[0], v[1]) - 1) < 1e-6 && !rim.some(p => P.length(P.sub(p.point!, v)) < 0.3)) rim.push({ tri: t, point: v });
      }
    }
    assert.equal(rim.length, 3);
    const c = run(P.newPlacementSession(), sIn, { op: 'circle3', picks: rim as [P.PlacementPick, P.PlacementPick, P.PlacementPick] });
    nearV([c.session.placement.origin[0], c.session.placement.origin[1], 0], [0, 0, 0], 1e-5);
    near(c.feature!.radius!, 1, 1e-5);
  });

  it('a pick given as a point on the part (no triangle index) finds the triangle under it - STEP or STL alike', () => {
    const { pack, mesh } = loadPack('haas-vf2-vise');
    const input: P.PlacementInput = { positions: mesh.positions, bounds: mesh.bounds, setup: pack.setup };
    // A point on the wall of the +X +Y bore, half way down.
    const r = run(P.newPlacementSession(), input, { op: 'pickCylinder', pick: { tri: -1, point: [1.25 + 0.1005, 0.75, -0.385] } });
    nearV(r.session.placement.origin, [1.25, 0.75, 0], 1e-6);
    nearV(P.closestPointOnTriangle([0, 0, 1], [0, 0, 0], [1, 0, 0], [0, 1, 0]), [0, 0, 0]);
    nearV(P.closestPointOnTriangle([2, 2, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0]), [0.5, 0.5, 0]);
  });

  it('inspect reports the feature (view normal to face) and changes nothing', () => {
    const input = blockInput();
    const s = run(P.newPlacementSession(), input, { op: 'preset', id: 'top-center' }).session;
    const r = P.runPlacementOp(s, input, { op: 'inspect', pick: { tri: triWithNormal(BLOCK.positions, [-1, 0, 0]) } });
    assert.equal(r.changed, false);
    assert.equal(r.session, s);
    nearV(r.feature!.normal!, [-1, 0, 0]);
  });
});

describe('Stock, G54 and workholding after a move', () => {
  it('centre in stock makes the offsets equal each side; the target stays inside the stock', () => {
    const input = blockInput();
    let s = run(P.newPlacementSession(), input, { op: 'preset', id: 'top-front-left', ref: 'stock' }).session;
    s = run(s, input, { op: 'centerInStock' }).session;
    assert.deepEqual(s.stockOffsets, { xMin: 0.2, xMax: 0.2, yMin: 0.2, yMax: 0.2, zMin: 0.25, zMax: 0.05 });
    // Still on the stock's top-front-left corner after the stock was re-centred.
    const part = P.placedBounds(input, s.placement);
    nearV(part.min, [0.2, 0.2, -1.05], 1e-9);
    const xyz = run(s, input, { op: 'centerInStock', axes: 'xyz' }).session;
    assert.equal(xyz.stockOffsets!.zMin, 0.15);
    assert.match(P.runPlacementOp(P.newPlacementSession(), { ...input, setup: undefined }, { op: 'centerInStock' }).error!, /no stock offsets/);
    assert.ok(P.targetInsideStock(part, P.setupStockBounds({ stockOffsets: s.stockOffsets }, part)!));
    assert.equal(P.targetInsideStock({ min: [0, 0, 0], max: [2, 1, 1] }, { min: [0, 0, 0], max: [1, 1, 1] }), false);
  });

  for (const dir of ['haas-vf2-vise', 'haas-umc750-5axis']) {
    it(`${dir}: stock rebuilt from the setup, vise / jaws follow the stock, G54 moves the other way, grip depth kept`, () => {
      const { pack, mesh } = loadPack(dir);
      const input: P.PlacementInput = { positions: mesh.positions, bounds: mesh.bounds, setup: pack.setup };
      const before = P.applyPlacementToPack(pack, mesh.bounds, P.identityPlacement(), { positions: mesh.positions });
      for (const op of [
        { op: 'preset', id: 'top-front-left' },
        { op: 'preset', id: 'top-front-left', ref: 'stock' },
        { op: 'rotate', axis: 2 },
        { op: 'pickCylinder', pick: { tri: dir === 'haas-vf2-vise' ? 700 : 292 } },
      ] as P.PlacementOp[]) {
        const s = run(P.newPlacementSession(), input, op).session;
        const placed = P.applyPlacementToPack(pack, mesh.bounds, s.placement, { positions: mesh.positions });
        const p = placed.pack as RevPack;
        assert.ok(P.targetInsideStock(placed.targetBounds, placed.stockBounds), `${op.op}: target inside stock`);
        assert.deepEqual(checkStockSetup(p, { min: placed.targetBounds.min, max: placed.targetBounds.max }).errors, [], `${op.op}: stock where the setup says`);
        // Every workholding solid moved by the same amount, keeping its size.
        pack.workholding.forEach((w, i) => {
          const a = w as RevPackBox, b = p.workholding[i] as RevPackBox;
          nearV(P.sub(b.min as P.PVec3, a.min as P.PVec3), placed.workholdingShift, 1e-6, `${w.name} min`);
          nearV(P.sub(b.max as P.PVec3, b.min as P.PVec3), P.sub(a.max as P.PVec3, a.min as P.PVec3), 1e-6, `${w.name} size`);
        });
        // G54 moved opposite to the vise in WORK coordinates, so the vise stays put on the table.
        const g = p.workOffsets.G54, g0 = pack.workOffsets.G54;
        nearV([g.x - g0.x, (g.y ?? 0) - (g0.y ?? 0), g.z - g0.z], P.scale(placed.workholdingShift, -1), 1e-6);
        // Grip depth: the gripped region is still gripDepth tall at the bottom of the stock.
        const grip = grippedRegion(p);
        if (pack.setup?.gripDepth) { near(grip!.max[2] - grip!.min[2], pack.setup.gripDepth, 1e-6); near(grip!.min[2], placed.stockBounds.min[2], 1e-6); }
        assert.match(p.setup!.partZero, /placed in JobLine/);
        // Stock size unchanged by a pure origin move (rotation about Z on a non-square part may change it).
        if (op.op !== 'rotate') nearV(P.sub(placed.stockBounds.max, placed.stockBounds.min), P.sub(before.stockBounds.max, before.stockBounds.min), 1e-6);
      }
    });
  }

  it('the target drawn through targetTransform lands where the placement says (shared geometry builder)', () => {
    const { pack, mesh, gcode } = loadPack('haas-vf2-vise');
    const s = run(P.newPlacementSession(), { positions: mesh.positions, bounds: mesh.bounds, setup: pack.setup }, { op: 'preset', id: 'top-front-left' }).session;
    const placed = P.applyPlacementToPack(pack, mesh.bounds, s.placement, { positions: mesh.positions });
    const report = correlateProgramWithRevPack(gcode, placed.pack as RevPack);
    const geometry = buildRevPackGeometry(placed.pack as RevPack, { targetStl: fs.readFileSync(path.join(root, 'haas-vf2-vise', 'target.stl')), targetTransform: placed.targetTransform, segments: report.segments });
    nearV(geometry.target!.bounds.min, placed.targetBounds.min, 1e-5);
    nearV(geometry.target!.bounds.max, placed.targetBounds.max, 1e-5);
    nearV(geometry.stock.bounds.min, placed.stockBounds.min, 1e-6);
    // 3x4 and Three.js column-major 4x4 agree; the mesh transform matches transformPositions.
    const m4 = P.placementMatrix4(s.placement), m = placed.targetTransform;
    assert.deepEqual([m4[0], m4[4], m4[8], m4[12]], [m[0], m[1], m[2], m[3]]);
    assert.deepEqual(Array.from(transformMesh(mesh, m).positions), Array.from(P.transformPositions(mesh.positions, m)));
  });

  it('lathe / bar stock keeps X0 on the spindle axis: only Z moves', () => {
    const { pack, mesh } = loadPack('okuma-lb3000-lathe');
    const input: P.PlacementInput = { positions: mesh.positions, bounds: mesh.bounds, setup: pack.setup, lathe: true };
    const s = run(P.newPlacementSession(), input, { op: 'preset', id: 'top-front-left' }).session;
    assert.deepEqual([s.placement.origin[0], s.placement.origin[1]], [0, 0]);
    near(s.placement.origin[2], mesh.bounds.max[2]);
    const placed = P.applyPlacementToPack(pack, mesh.bounds, { ...s.placement, origin: [5, 5, -10] }, { positions: mesh.positions });
    assert.ok(placed.notes.some(n => /spindle axis/.test(n)));
  });

  it('readout: the origin against the part box and on the machine', () => {
    const input = blockInput();
    const s = run(P.newPlacementSession(), input, { op: 'preset', id: 'top-front-left' }).session;
    const r = P.originReadout(input, s.placement, { x: -15, y: -8, z: -15.5 });
    nearV(r.fromPartMin, [0, 0, 1]);
    nearV(r.fromPartCenter, [-2, -1.5, 0.5]);
    nearV(r.partSize, [4, 3, 1]);
    nearV(r.machine!, [-15, -8, -15.5]);
    assert.equal(r.label, 'top-front-left corner of the part');
    void ctxOf;
  });
});

describe('VS Code: Origin panel host, scene and commands', () => {
  // Imported lazily so the kernel tests above stay free of the loader's STEP reader.
  const host = require('../src/providers/visualizer/revpackPlacementHost') as typeof import('../src/providers/visualizer/revpackPlacementHost');
  const loader = require('../src/providers/visualizer/revpackLoader') as typeof import('../src/providers/visualizer/revpackLoader');

  for (const dir of ['haas-vf2-vise', 'haas-umc750-5axis']) {
    it(`${dir}: the scene is rebuilt from the placed pack (target, stock, vise, G54) and the panel reads it back`, () => {
      const loaded = loader.readRevPack(path.join(root, dir, 'revpack.json'));
      const gcode = fs.readFileSync(path.join(loaded.dir, loaded.pack.program.file), 'utf8');
      const base = loader.buildRevPackScene(loaded, gcode);
      assert.ok(base.placementTarget);
      assert.equal(base.targetTransform, undefined, 'nothing moved yet');
      const sessions = new host.PlacementSessions();
      const target = base.placementTarget!;
      const r = sessions.run(target, { op: 'preset', id: 'top-front-left' });
      assert.equal(r.error, undefined);
      assert.ok(sessions.has(target.key));
      const scene = loader.buildRevPackScene(loaded, gcode, [], sessions.session(target.key));
      const panel = host.placementPanelMessage(target, sessions.session(target.key));
      // Target drawn at the new zero: its top-front-left corner at X0 Y0 Z0.
      nearV([scene.target!.bounds.minX, scene.target!.bounds.minY, scene.target!.bounds.maxZ], [0, 0, 0], 1e-5);
      assert.ok(scene.target!.placed && scene.target!.partMeshVertices!.length === scene.target!.meshVertices.length);
      nearV(scene.geometry.stock.bounds.min, panel.stockBox!.min, 1e-6);
      assert.equal(panel.insideStock, true);
      assert.equal(panel.anchor?.id, 'nnp');
      assert.match(panel.label, /top-front-left corner of the part/);
      // Workholding solids moved with the stock; the scene message carries them.
      const shift = P.sub(panel.stockBox!.min, base.geometry.stock.bounds.min as P.PVec3);
      nearV(P.sub(scene.geometry.workholding[0].mesh.bounds.min as P.PVec3, base.geometry.workholding[0].mesh.bounds.min as P.PVec3), [shift[0], shift[1], shift[2]], 1e-5);
      // G54 in the readout moved the other way.
      const g0 = loaded.pack.workOffsets.G54;
      nearV([panel.workOffset!.x - g0.x, panel.workOffset!.y - (g0.y ?? 0), panel.workOffset!.z - g0.z], P.scale(shift, -1), 1e-5);
      assert.ok(panel.readout && panel.readout.machine);
      // Undo / reset bring back the pack as authored.
      sessions.run(target, { op: 'reset' });
      const back = loader.buildRevPackScene(loaded, gcode, [], sessions.session(target.key));
      assert.equal(back.targetTransform, undefined);
      assert.deepEqual(back.target!.bounds, base.target!.bounds);
    });
  }

  it('STEP target: the OpenCascade tessellation is moved by the same transform (and cached)', async () => {
    const loaded = loader.readRevPack(path.join(root, 'haas-vf2-vise', 'revpack.json'));
    const plain = (await loader.revPackStepTargetMessage(loaded))!;
    const s = run(P.newPlacementSession(), { positions: new Float32Array(plain.meshVertices), bounds: { min: [plain.bounds.minX, plain.bounds.minY, plain.bounds.minZ], max: [plain.bounds.maxX, plain.bounds.maxY, plain.bounds.maxZ] } }, { op: 'preset', id: 'top-center' }).session;
    const moved = (await loader.revPackStepTargetMessage(loaded, P.placementMatrix(s.placement)))!;
    near(moved.bounds.maxZ, 0, 1e-5);
    near((moved.bounds.minX + moved.bounds.maxX) / 2, 0, 1e-5);
    assert.deepEqual(moved.partMeshVertices, plain.meshVertices);
  });

  it('an uploaded part (no pack) is moved with its triangles; its stock is the upload setup around it', () => {
    const shaft = cylinderSolid(40, 0, 25, 20, 48);
    const message = { type: 'targetModel', id: 'target-part', meshVertices: Array.from(shaft.positions), bounds: { minX: -20, minY: -20, minZ: 0, maxX: 20, maxY: 20, maxZ: 25 } };
    const target: import('../src/providers/visualizer/revpackPlacementHost').PlacementTarget = { key: 'upload:target-part', kind: 'upload', name: 'gear.stl', units: 'mm', positions: shaft.positions, bounds: { min: [-20, -20, 0], max: [20, 20, 25] } };
    const sessions = new host.PlacementSessions();
    sessions.run(target, { op: 'preset', id: 'top-front-left' });
    const moved = host.placedUploadMessage(message, shaft.positions, sessions.session(target.key));
    nearV([moved.bounds.minX, moved.bounds.minY, moved.bounds.maxZ], [0, 0, 0], 1e-5);
    const panel = host.placementPanelMessage(target, sessions.session(target.key));
    nearV(panel.stockBox!.min, [-3, -3, -29], 1e-6);
    nearV(panel.stockBox!.max, [43, 43, 1], 1e-6);
    // The stock box of an upload is the upload setup's: its top-front-left corner works too.
    sessions.run(target, { op: 'preset', id: 'top-front-left', ref: 'stock' });
    const s2 = host.placementPanelMessage(target, sessions.session(target.key));
    near(s2.stockBox!.min[0], 0, 1e-6); near(s2.stockBox!.min[1], 0, 1e-6);
    near(s2.stockBox!.max[2], 0, 1e-6);
    // Bore centre on the uploaded ring: X0 Y0 on its axis.
    let boreTri = -1;
    for (let t = 0; t < shaft.triangleCount && boreTri < 0; t++) { const f = P.pickFeature(shaft.positions, t); if (f?.kind === 'cylinder' && f.bore) boreTri = t; }
    const r = sessions.run(target, { op: 'pickCylinder', pick: { tri: boreTri } });
    assert.equal(r.feature?.bore, true);
    nearV([r.session.placement.origin[0], r.session.placement.origin[1], 0], [0, 0, 0], 1e-4);
    assert.deepEqual(host.parseOffsetInput('0.5 0 -0.02 90'), { d: [0.5, 0, -0.02], rotZ: 90 });
    assert.equal(host.parseOffsetInput('a b'), undefined);
    assert.equal(host.placementPanelMessage(undefined, undefined).active, false);
  });

  it('every jobline.placement command is contributed and registered; the webview has the 27-point picker and every pick mode', () => {
    const repo = path.join(__dirname, '..');
    const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
    const ext = fs.readFileSync(path.join(repo, 'src', 'extension.ts'), 'utf8');
    const html = fs.readFileSync(path.join(repo, 'media', 'toolpathVisualizerWebview.html'), 'utf8');
    const ids = ['showPanel', 'preset', 'boxPoint', 'face', 'pick', 'rotate', 'offset', 'centerInStock', 'undo', 'reset', 'run', 'state'].map(c => `jobline.placement.${c}`);
    const contributed = new Set(pkg.contributes.commands.map((c: { command: string }) => c.command));
    for (const id of ids) {
      assert.ok(contributed.has(id), `${id} contributed`);
      assert.ok(ext.includes(`'${id}'`), `${id} registered`);
    }
    assert.match(html, /id="origin-panel"/);
    assert.match(html, /id="org-box27"/);
    for (const mode of ['face-axis', 'face-origin', 'face-top', 'face-bottom', 'bore', 'bore-z', 'point', 'mid2', 'circle3', 'view-normal']) assert.ok(html.includes(`data-org-pick="${mode}"`), mode);
    for (const face of ['top', 'bottom', 'left', 'right', 'front', 'back', 'center']) assert.ok(html.includes(`data-org-face="${face}"`), face);
    for (const preset of ['top-center', 'top-front-left']) assert.ok(html.includes(`data-org-preset="${preset}"`), preset);
    assert.match(html, /case 'revpackPlacement'/);
    assert.match(html, /function viewNormalTo/);
    assert.match(html, /function buildWcsTriad/);
  });
});
