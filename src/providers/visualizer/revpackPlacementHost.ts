/**
 * Part placement / work origin in the VS Code extension: the per-target
 * sessions behind the visualizer's Origin panel and the jobline.placement.*
 * commands. Kept free of the `vscode` module so it is unit-testable; every
 * calculation is the shared kernel's (revpackPlacement.ts, identical in CAM
 * and the hub), this file only keeps state and shapes messages.
 *
 * A target is either the RevPack's target (the scene is rebuilt from the
 * placed pack: target transform, stock from the setup, vise / jaws following
 * the stock, G54 moved) or a part uploaded on its own (the AR4 parts): its
 * triangles are moved and the webview's stock-around-the-part follows them.
 */

import {
  applyPlacementToPack, boxPointId, isIdentityPlacement, newPlacementSession, originReadout, placedBounds, placementMatrix,
  runPlacementOp, targetInsideStock, transformPositions, triangleAdjacency,
  type FeatureView, type PBounds, type PlacementInput, type PlacementOp, type PlacementResult, type PlacementSession,
} from './revpackPlacement';
import { uploadSetup, type RevPack } from './revpack';

export interface PlacementTarget {
  /** 'revpack:<pack file>' or 'upload:<target id>'. */
  key: string;
  kind: 'revpack' | 'upload';
  name: string;
  units: 'in' | 'mm';
  /** Triangles as the webview draws them (STL, or the STEP tessellation once it arrived), PART coordinates. */
  positions: Float32Array;
  bounds: PBounds;
  pack?: RevPack;
}

export interface PlacementPanelMessage {
  type: 'revpackPlacement';
  active: boolean;
  key: string;
  kind: 'revpack' | 'upload' | '';
  name: string;
  units: 'in' | 'mm';
  label: string;
  rotation: number[];
  origin: number[];
  identity: boolean;
  /** The box point the WCS is snapped to (boxPointId, e.g. '00p' = top centre), for the 27-point picker. */
  anchor?: { id: string; ref: 'part' | 'stock' };
  canUndo: boolean;
  readout?: ReturnType<typeof originReadout>;
  workOffset?: { name: string; x: number; y: number; z: number };
  /** Target and stock boxes in WORK coordinates. */
  partBox?: PBounds;
  stockBox?: PBounds;
  insideStock?: boolean;
  stockOffsets?: PlacementSession['stockOffsets'];
  notes: string[];
  feature?: FeatureView;
  error?: string;
  /** Webview: turn the view normal to the feature's face / axis. */
  view?: 'normal';
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;
const roundB = (b: PBounds): PBounds => ({ min: b.min.map(round) as PBounds['min'], max: b.max.map(round) as PBounds['max'] });

export class PlacementSessions {
  private readonly sessions = new Map<string, PlacementSession>();
  private readonly adjacency = new Map<string, { positions: Float32Array; adj: number[][] }>();
  /** The target the panel and the commands act on. */
  current?: PlacementTarget;

  session(key: string): PlacementSession {
    return this.sessions.get(key) ?? newPlacementSession();
  }

  has(key: string): boolean {
    const s = this.sessions.get(key);
    return !!s && (!isIdentityPlacement(s.placement) || !!s.stockOffsets || s.history.length > 0);
  }

  /** Start a target from a saved setup (a .jbl from jobline.ai-CAM). */
  seed(key: string, session: PlacementSession): void {
    this.sessions.set(key, session);
  }

  clear(key: string): void {
    this.sessions.delete(key);
    this.adjacency.delete(key);
  }

  input(target: PlacementTarget): PlacementInput {
    let cached = this.adjacency.get(target.key);
    if (!cached || cached.positions !== target.positions) {
      cached = { positions: target.positions, adj: triangleAdjacency(target.positions) };
      this.adjacency.set(target.key, cached);
    }
    const pack = target.pack;
    const bar = !!pack && typeof (pack.stock as { diameter?: number }).diameter === 'number';
    return {
      positions: target.positions,
      bounds: target.bounds,
      adjacency: cached.adj,
      setup: pack?.setup ?? (target.kind === 'upload' ? uploadSetup(target.units) : undefined),
      stockBounds: pack && !bar ? { min: [...(pack.stock as { min: number[] }).min] as PBounds['min'], max: [...(pack.stock as { max: number[] }).max] as PBounds['max'] } : undefined,
      lathe: bar || pack?.machine.machineClass === 'lathe',
    };
  }

  run(target: PlacementTarget, op: PlacementOp): PlacementResult {
    const result = runPlacementOp(this.session(target.key), this.input(target), op);
    if (result.changed) this.sessions.set(target.key, result.session);
    return result;
  }
}

/** The pack with the session's stock offsets (after a centre-in-stock). */
export function packWithSession(pack: RevPack, session: PlacementSession): RevPack {
  if (!session.stockOffsets || !pack.setup) return pack;
  return { ...pack, setup: { ...pack.setup, stockOffsets: session.stockOffsets } };
}

/** The pack after the session's placement, or undefined while nothing moved. */
export function placedPack(pack: RevPack, targetBounds: PBounds, positions: ArrayLike<number> | undefined, session: PlacementSession) {
  if (isIdentityPlacement(session.placement) && !session.stockOffsets) return undefined;
  return applyPlacementToPack(packWithSession(pack, session), targetBounds, session.placement, { positions });
}

/** What the Origin panel shows for a target. */
export function placementPanelMessage(target: PlacementTarget | undefined, session: PlacementSession | undefined, extra: { feature?: FeatureView; error?: string; view?: 'normal' } = {}): PlacementPanelMessage {
  if (!target || !session) {
    return { type: 'revpackPlacement', active: false, key: '', kind: '', name: '', units: 'mm', label: '', rotation: [], origin: [], identity: true, canUndo: false, notes: [] };
  }
  const p = session.placement;
  const geometry = { positions: target.positions, bounds: target.bounds };
  const partBox = roundB(placedBounds(geometry, p));
  let workOffset: PlacementPanelMessage['workOffset'];
  let stockBox: PBounds | undefined = target.kind === 'upload' ? uploadStockBox(partBox, target.units) : undefined;
  let notes: string[] = [];
  if (target.pack) {
    const placed = applyPlacementToPack(packWithSession(target.pack, session), target.bounds, p, { positions: target.positions });
    stockBox = roundB(placed.stockBounds);
    notes = placed.notes;
    if (placed.workOffset) {
      const w = placed.pack.workOffsets[placed.workOffset];
      workOffset = { name: placed.workOffset, x: round(w.x), y: round(w.y ?? 0), z: round(w.z) };
    }
  }
  return {
    type: 'revpackPlacement',
    active: true,
    key: target.key,
    kind: target.kind,
    name: target.name,
    units: target.units,
    label: p.label ?? (isIdentityPlacement(p) ? 'part file origin' : 'moved'),
    rotation: [...p.rotation],
    origin: [...p.origin],
    identity: isIdentityPlacement(p),
    anchor: p.anchor?.kind === 'box' ? { id: boxPointId(p.anchor.point), ref: p.anchor.ref } : undefined,
    canUndo: session.history.length > 0,
    readout: originReadout(geometry, p, workOffset),
    workOffset,
    partBox,
    stockBox,
    insideStock: stockBox ? targetInsideStock(partBox, stockBox, 1e-5) : undefined,
    stockOffsets: session.stockOffsets ?? target.pack?.setup?.stockOffsets,
    notes,
    feature: extra.feature,
    error: extra.error,
    view: extra.view,
  };
}

/** An uploaded part's targetModel message with its triangles and bounds moved by the placement. */
export function placedUploadMessage<M extends { meshVertices?: number[]; bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } }>(message: M, positions: Float32Array, session: PlacementSession): M {
  const m = placementMatrix(session.placement);
  const moved = transformPositions(positions, m);
  const b = placedBounds({ positions, bounds: boundsOfMessage(message) }, session.placement);
  return {
    ...message,
    // The webview keeps the user's display mode / opacity for a placement update.
    placementUpdate: true,
    meshVertices: Array.from(moved),
    bounds: { minX: b.min[0], minY: b.min[1], minZ: b.min[2], maxX: b.max[0], maxY: b.max[1], maxZ: b.max[2] },
  };
}

export function boundsOfMessage(message: { bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } }): PBounds {
  const b = message.bounds;
  return { min: [b.minX, b.minY, b.minZ], max: [b.maxX, b.maxY, b.maxZ] };
}

/**
 * Upload stock, same allowances as the webview draws around a part opened on
 * its own (revpack.ts uploadSetup: 3 mm sides, 1 mm top, 3 + 1 mm below).
 */
export function uploadStockBox(partBox: PBounds, units: 'in' | 'mm'): PBounds {
  const k = units === 'in' ? 1 / 25.4 : 1;
  const s = 3 * k, top = 1 * k, below = 4 * k;
  return roundB({ min: [partBox.min[0] - s, partBox.min[1] - s, partBox.min[2] - below], max: [partBox.max[0] + s, partBox.max[1] + s, partBox.max[2] + top] });
}

/** Parse "dx dy dz [rotZ]" typed into the offset box. */
export function parseOffsetInput(text: string): { d: [number, number, number]; rotZ: number } | undefined {
  const nums = text.split(/[\s,;]+/).filter(Boolean).map(Number);
  if (nums.length < 1 || nums.length > 4 || nums.some(n => !Number.isFinite(n))) return undefined;
  return { d: [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0], rotZ: nums[3] ?? 0 };
}
