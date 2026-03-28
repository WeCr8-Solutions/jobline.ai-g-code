import { ToolpathVisualizerPanel } from './toolpathVisualizer';

export interface ToolpathPoint {
  x: number;
  y: number;
  z?: number;
  isRapid?: boolean;
  mStop?: 'M0' | 'M1' | 'M2' | 'M30';
  lineNumber?: number;
}

export function sendToolpathUpdate(
  path: ToolpathPoint[],
  cutterSize: number,
  highlightIdx: number,
  units: 'in' | 'mm' = 'in'
) {
  if (ToolpathVisualizerPanel.currentPanel) {
    ToolpathVisualizerPanel.currentPanel.postMessage({
      type: 'update',
      path,
      cutterSize,
      highlightIdx,
      units
    });
  }
}

// G-code to path parser (3D, ignores arcs, linear approximation only)
export function parseGCodeToPath(gcode: string): { path: ToolpathPoint[]; units: 'in' | 'mm' } {
  const lines = gcode.split(/\r?\n/);
  let x = 0, y = 0, z = 0;
  let units: 'in' | 'mm' = 'in';
  const path: ToolpathPoint[] = [{ x, y, z }];

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];

    // Detect units: G20 = inches, G21 = metric
    if (/\bG20\b/i.test(line)) units = 'in';
    if (/\bG21\b/i.test(line)) units = 'mm';

    // Detect M-stops
    let mStop: ToolpathPoint['mStop'] | undefined;
    if (/\bM0\b|\bM00\b/i.test(line)) mStop = 'M0';
    if (/\bM1\b|\bM01\b/i.test(line)) mStop = 'M1';
    if (/\bM2\b|\bM02\b/i.test(line)) mStop = 'M2';
    if (/\bM30\b/i.test(line)) mStop = 'M30';

    const gMatch = line.match(/\bG0*(\d)/i); // Match G0, G1, G00, G01, etc.
    const xMatch = line.match(/\bX([-+]?\d+\.?\d*)/i); // Require at least 1 digit
    const yMatch = line.match(/\bY([-+]?\d+\.?\d*)/i); // Require at least 1 digit
    const zMatch = line.match(/\bZ([-+]?\d+\.?\d*)/i); // Require at least 1 digit

    if (xMatch) x = parseFloat(xMatch[1]);
    if (yMatch) y = parseFloat(yMatch[1]);
    if (zMatch) z = parseFloat(zMatch[1]);

    if (xMatch || yMatch || zMatch || mStop) {
      const isRapid = gMatch ? gMatch[1] === '0' || gMatch[1] === '00' : undefined;
      path.push({ x, y, z, isRapid, mStop, lineNumber: lineNum });
    }
  }
  return { path, units };
}
