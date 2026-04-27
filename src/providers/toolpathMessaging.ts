import { ToolpathVisualizerPanel } from './toolpathVisualizer';
export { parseGCodeToPath, type ToolpathPoint } from './visualizer/toolpathParser';
import type { ToolpathPoint } from './visualizer/toolpathParser';

export function sendToolpathUpdate(
  path: ToolpathPoint[],
  cutterSize: number,
  highlightIdx: number,
  units: 'in' | 'mm' = 'in'
) {
  ToolpathVisualizerPanel.queueMessage({
    type: 'update',
    path,
    cutterSize,
    highlightIdx,
    units
  });
}

