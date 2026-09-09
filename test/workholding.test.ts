/**
 * Workholding selection tests.
 *
 * Jaws are drawn from the stock, so they only appear once a stock size is
 * known, and the mode decides whether they are vise jaws or chuck jaws.
 *
 * Run via: npm test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { workholdingModeFor, buildAutoSimulationMessages } from '../src/providers/visualizer/simulationSetup';
import type { VisualizerHarnessData } from '../src/providers/visualizer/fixtureHarness';

describe('Workholding mode selection', () => {
  it('puts a turn center in a chuck', () => {
    assert.equal(workholdingModeFor('Turn Center (2-Axis)'), 'chuck');
    assert.equal(workholdingModeFor('CNC Lathe'), 'chuck');
  });

  it('puts a mill in a vise', () => {
    assert.equal(workholdingModeFor('3-Axis Vertical Mill'), 'vise');
    assert.equal(workholdingModeFor('5-Axis Mill'), 'vise');
  });

  it('honours an explicit override, including switching it off', () => {
    assert.equal(workholdingModeFor('3-Axis Vertical Mill', 'chuck'), 'chuck');
    assert.equal(workholdingModeFor('Turn Center (2-Axis)', 'vise'), 'vise');
    assert.equal(workholdingModeFor('3-Axis Vertical Mill', 'none'), 'none');
  });

  it('ignores a nonsense override rather than drawing nothing', () => {
    assert.equal(workholdingModeFor('3-Axis Vertical Mill', 'banana'), 'vise');
  });
});

function harness(machineType: string, withStock: boolean): VisualizerHarnessData {
  return {
    model: {} as VisualizerHarnessData['model'],
    unit: 'in',
    setup: {
      fixtureMode: 'none',
      programNumber: 'O0001',
      machineType,
      workOffsets: ['G54'],
      stockDimensions: withStock ? { width: 4, depth: 2.75, height: 2 } : undefined,
      operationCount: 1,
      toolCount: 1,
    },
    tools: [],
  } as unknown as VisualizerHarnessData;
}

describe('Workholding setup messages', () => {
  it('emits jaws once a stock size is known', () => {
    const msgs = buildAutoSimulationMessages(harness('3-Axis Vertical Mill', true));
    const wh = msgs.find(m => m.type === 'workholdingSettings');
    assert.ok(wh, 'expected a workholdingSettings message');
    assert.equal((wh as { mode: string }).mode, 'vise');
  });

  it('emits no jaws when the stock size is unknown', () => {
    // Without stock there is nothing to derive jaw position from, so drawing
    // them would be an invention rather than a view of the setup.
    const msgs = buildAutoSimulationMessages(harness('3-Axis Vertical Mill', false));
    assert.equal(msgs.find(m => m.type === 'workholdingSettings'), undefined);
  });

  it('selects chuck jaws for a turn center', () => {
    const msgs = buildAutoSimulationMessages(harness('Turn Center (2-Axis)', true));
    const wh = msgs.find(m => m.type === 'workholdingSettings') as { mode: string } | undefined;
    assert.equal(wh?.mode, 'chuck');
  });

  it('never grips deeper than the stock is tall', () => {
    const msgs = buildAutoSimulationMessages(harness('3-Axis Vertical Mill', true));
    const wh = msgs.find(m => m.type === 'workholdingSettings') as { gripDepth: number } | undefined;
    assert.ok(wh);
    assert.ok(wh!.gripDepth <= 2 / 2, `gripDepth ${wh!.gripDepth} exceeds half the 2in stock height`);
  });
});
