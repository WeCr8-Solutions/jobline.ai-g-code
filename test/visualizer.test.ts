/**
 * Visualizer Smoke Tests — basic functionality for toolpath parsing and visual runner
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

// Inline the parser to avoid vscode import issues in tests
function parseGCodeToPath(gcode: string) {
  interface ToolpathPoint {
    x: number;
    y: number;
    z?: number;
    isRapid?: boolean;
  }

  const lines = gcode.split(/\r?\n/);
  let x = 0, y = 0, z = 0;
  const pathPoints: ToolpathPoint[] = [{ x, y, z }];
  for (const line of lines) {
    const gMatch = line.match(/\bG(\d{2})/i);
    const xMatch = line.match(/\bX([-+]?\d*\.?\d*)/i);
    const yMatch = line.match(/\bY([-+]?\d*\.?\d*)/i);
    const zMatch = line.match(/\bZ([-+]?\d*\.?\d*)/i);

    if (xMatch) x = parseFloat(xMatch[1]);
    if (yMatch) y = parseFloat(yMatch[1]);
    if (zMatch) z = parseFloat(zMatch[1]);

    if (xMatch || yMatch || zMatch) {
      const isRapid = gMatch ? gMatch[1] === '00' : undefined;
      pathPoints.push({ x, y, z, isRapid });
    }
  }
  return pathPoints;
}

describe('Visualizer', () => {
  describe('parseGCodeToPath — 3D parsing', () => {
    it('parses G01 X10 Y20 Z-5 to 3D point', () => {
      const gcode = 'G01 X10 Y20 Z-5 F100';
      const path = parseGCodeToPath(gcode);
      expect(path).toHaveLength(2);
      expect(path[1]).toEqual({ x: 10, y: 20, z: -5, isRapid: false });
    });

    it('marks G00 rapid moves with isRapid flag', () => {
      const gcode = 'G00 X5 Y5 Z10';
      const path = parseGCodeToPath(gcode);
      expect(path[1]).toEqual({ x: 5, y: 5, z: 10, isRapid: true });
    });

    it('tracks Z axis across multiple moves', () => {
      const gcode = `
        G01 X0 Y0 Z0
        G01 X10 Y10 Z-5
        G00 X20 Y20 Z5
      `;
      const path = parseGCodeToPath(gcode);
      expect(path).toHaveLength(4); // start + 3 moves
      expect(path[3].z).toBe(5);
    });

    it('returns initial point at origin', () => {
      const gcode = 'G01 X10 Y10';
      const path = parseGCodeToPath(gcode);
      expect(path[0]).toEqual({ x: 0, y: 0, z: 0 });
    });
  });

  describe('Visual Test Runner — infrastructure', () => {
    it('visual test runner script exists', () => {
      const runnerPath = path.join(__dirname, '..', 'scripts', 'visual-test-runner.ts');
      expect(fs.existsSync(runnerPath)).toBe(true);
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
