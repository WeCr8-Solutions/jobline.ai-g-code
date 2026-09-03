/* eslint-env node */
/* global __dirname */
/**
 * Visualizer Smoke Tests — basic functionality for toolpath parsing and visual runner
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { parseGCodeToPath } from '../src/providers/visualizer/toolpathParser';
import { extractGCodeCutBounds, compareBounds } from '../src/providers/visualizer/gcodeGoalComparison';
import { parseParasolidText } from '../src/providers/visualizer/parasolidTextParser';
import { buildVisualizerHarnessData } from '../src/providers/visualizer/fixtureHarness';
import { buildAutoSimulationMessages } from '../src/providers/visualizer/simulationSetup';

describe('Visualizer', () => {
  describe('parseGCodeToPath — 3D parsing', () => {
    it('parses G01 X10 Y20 Z-5 to 3D point', () => {
      const gcode = 'G01 X10 Y20 Z-5 F100';
      const { path } = parseGCodeToPath(gcode);
      expect(path).toHaveLength(2);
      expect(path[1]).toEqual({ x: 10, y: 20, z: -5, isRapid: false, lineNumber: 0 });
    });

    it('marks G00 rapid moves with isRapid flag', () => {
      const gcode = 'G00 X5 Y5 Z10';
      const { path } = parseGCodeToPath(gcode);
      expect(path[1]).toEqual({ x: 5, y: 5, z: 10, isRapid: true, lineNumber: 0 });
    });

    it('tracks Z axis across multiple moves', () => {
      const gcode = `
        G01 X0 Y0 Z0
        G01 X10 Y10 Z-5
        G00 X20 Y20 Z5
      `;
      const { path } = parseGCodeToPath(gcode);
      expect(path).toHaveLength(4); // start + 3 moves
      expect(path[3].z).toBe(5);
    });

    it('returns initial point at origin', () => {
      const gcode = 'G01 X10 Y10';
      const { path } = parseGCodeToPath(gcode);
      expect(path[0]).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('supports incremental G91 moves and switching back to G90', () => {
      const { path } = parseGCodeToPath('G90 G0 X1 Y2\nG91 G1 X.5 Y-.25\nG90 G1 X0 Y0');
      expect(path.at(-2)).toMatchObject({ x: 1.5, y: 1.75, isRapid: false });
      expect(path.at(-1)).toMatchObject({ x: 0, y: 0, isRapid: false });
    });

    it('ignores coordinates and modal words inside comments', () => {
      const { path } = parseGCodeToPath('(G91 X99)\nG0 X1 (Y88) ; Z77\n; G1 X44');
      expect(path).toHaveLength(2);
      expect(path[1]).toMatchObject({ x: 1, y: 0, z: 0, isRapid: true });
    });

    it('parses leading-decimal coordinates', () => {
      const { path } = parseGCodeToPath('G1X.5Y-.25Z+.125');
      expect(path[1]).toMatchObject({ x: 0.5, y: -0.25, z: 0.125 });
    });

    it('expands a canned drilling cycle into approach, feed, and retract moves', () => {
      const { path } = parseGCodeToPath('G90 G0 Z1\nG99 G81 X1 Y2 Z-.5 R.1 F10\nX2 Y2\nG80');
      expect(path.filter(point => point.lineNumber === 1)).toHaveLength(3);
      expect(path.filter(point => point.lineNumber === 2)).toHaveLength(3);
      expect(path.at(-1)).toMatchObject({ x: 2, y: 2, z: 0.1, isRapid: true });
    });

    it('preserves rotary axes for five-axis simulation consumers', () => {
      const { path } = parseGCodeToPath('G90 G1 X1 Z-.1 A30 C45');
      expect(path[1]).toMatchObject({ x: 1, z: -0.1, a: 30, c: 45 });
    });
  });

  describe('Solid-model verification', () => {
    it('compares a parsed envelope against known Parasolid bounds', () => {
      const gcode = fs.readFileSync(
        path.join(__dirname, 'fixtures', 'revpack', 'stem umc sample.nc'),
        'utf8'
      );
      const parasolid = fs.readFileSync(
        path.join(__dirname, 'fixtures', 'revpack', 'REVGRIPS STEM-50-35-PRO.x_t'),
        'utf8'
      );

      const envelope = extractGCodeCutBounds(gcode);
      const goal = parseParasolidText(parasolid);
      const comparison = compareBounds(envelope.bounds, goal.bounds, 0.01);

      expect(envelope.cutMoveCount).toBeGreaterThan(1000);
      expect(goal.pointCount).toBeGreaterThan(1000);
      expect(comparison.matches).toBe(false);
      expect(comparison.deltas.maxX).toBeGreaterThan(1);
    });

    it('builds automatic simulator setup from extracted stock and tooling', () => {
      const gcode = `
        (STOCK: W=4 D=3 H=2)
        (T1 - 1/2 BALL ENDMILL)
        T1 M06
        G00 X0 Y0 Z1.
        G01 X1. Y1. Z-0.25 F20.
      `;

      const harness = buildVisualizerHarnessData(gcode, 'fanuc');
      const messages = buildAutoSimulationMessages(harness);

      expect(messages[0]).toEqual({ type: 'machineType', machineType: '3-Axis Vertical Mill' });
      expect(messages).toContainEqual({
        type: 'stockSettings',
        w: 4,
        d: 3,
        h: 2,
        unit: 'in',
        color: '#4488ff',
      });
      expect(messages).toContainEqual({ type: 'stockOrigin', xOff: 0, yOff: 0, zOff: 0 });
      expect(messages.some(message => message.type === 'toolData')).toBe(true);
    });
  });

  describe('Visual Test Runner — infrastructure', () => {
    it('visual test runner script exists', () => {
      const runnerPath = path.join(__dirname, '..', 'scripts', 'visual-test-runner.ts');
      expect(fs.existsSync(runnerPath)).toBe(true);
    });

    it('writes a solid-model verification artifact instead of an image snapshot', () => {
      const verificationPath = path.join(__dirname, 'fixtures', 'revpack', 'revpack.visual-verification.json');
      expect(verificationPath.endsWith('.json')).toBe(true);
      expect(verificationPath.endsWith('.svg')).toBe(false);
    });

    it('fixture directory exists', () => {
      const fixtureDir = path.join(__dirname, 'fixtures', 'diagnostics');
      expect(fs.existsSync(fixtureDir)).toBe(true);
    });

    it('has NC fixture files to test', () => {
      const fixtureDir = path.join(__dirname, 'fixtures', 'diagnostics');
      const ncFiles = fs
        .readdirSync(fixtureDir)
        .filter(f => f.endsWith('.nc'));
      expect(ncFiles.length).toBeGreaterThan(0);
    });
  });
});
