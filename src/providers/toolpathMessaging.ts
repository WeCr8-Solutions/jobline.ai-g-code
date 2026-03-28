import { ToolpathVisualizerPanel } from './toolpathVisualizer';

export interface ToolpathPoint {
  x: number;
  y: number;
  z?: number;
  isRapid?: boolean;
}

export function sendToolpathUpdate(
  path: ToolpathPoint[],
  cutterSize: number,
  highlightIdx: number
) {
  if (ToolpathVisualizerPanel.currentPanel) {
    ToolpathVisualizerPanel.currentPanel.postMessage({
      type: 'update',
      path,
      cutterSize,
      highlightIdx
    });
  }
}

// G-code to path parser (3D, ignores arcs, linear approximation only)
export function parseGCodeToPath(gcode: string): ToolpathPoint[] {
  const lines = gcode.split(/\r?\n/);
  let x = 0, y = 0, z = 0;
  const path: ToolpathPoint[] = [{ x, y, z }];
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
      path.push({ x, y, z, isRapid });
    }
  }
  return path;
}
