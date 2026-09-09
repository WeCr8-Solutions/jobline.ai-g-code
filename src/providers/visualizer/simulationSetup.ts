import type { VisualizerHarnessData } from './fixtureHarness';

export type SimulationSetupMessage =
  | { type: 'machineType'; machineType: string }
  | { type: 'stockSettings'; w: number; d: number; h: number; unit: 'in' | 'mm'; color: string }
  | { type: 'stockOrigin'; xOff: number; yOff: number; zOff: number }
  | {
      type: 'workholdingSettings';
      mode: 'none' | 'vise' | 'chuck';
      jawHeight: number;
      jawThickness: number;
      gripDepth: number;
      color: string;
    }
  | { type: 'toolData'; data: VisualizerHarnessData['tools'][number] };

/**
 * Which workholding a program implies.
 *
 * A turn center holds the part in a chuck; a mill holds it in a vise. This is
 * the default only - `jobline.visualizer.workholding` overrides it, and the
 * webview draws nothing for 'none', so no jaws appear until a stock size is
 * known and a mode is actually chosen.
 */
export function workholdingModeFor(machineType: string, override?: string): 'none' | 'vise' | 'chuck' {
  if (override === 'none' || override === 'vise' || override === 'chuck') return override;
  return /lathe|turn/i.test(machineType) ? 'chuck' : 'vise';
}

export function buildAutoSimulationMessages(
  harness: VisualizerHarnessData,
  workholdingOverride?: string,
): SimulationSetupMessage[] {
  const messages: SimulationSetupMessage[] = [
    { type: 'machineType', machineType: harness.setup.machineType },
  ];

  if (harness.setup.stockDimensions) {
    messages.push({
      type: 'stockSettings',
      w: harness.setup.stockDimensions.width,
      d: harness.setup.stockDimensions.depth,
      h: harness.setup.stockDimensions.height,
      unit: harness.unit,
      color: '#4488ff',
    });
    messages.push({ type: 'stockOrigin', xOff: 0, yOff: 0, zOff: 0 });

    // Jaws are derived from the stock, so they are only meaningful once a stock
    // size is known - which is why this sits inside the stock branch.
    const mode = workholdingModeFor(harness.setup.machineType, workholdingOverride);
    const scale = harness.unit === 'mm' ? 25.4 : 1;
    messages.push({
      type: 'workholdingSettings',
      mode,
      jawHeight: 1.0 * scale,
      jawThickness: 0.75 * scale,
      gripDepth: Math.min(0.5 * scale, harness.setup.stockDimensions.height / 2),
      color: '#c0704f',
    });
  }

  if (harness.tools.length > 0) {
    messages.push({
      type: 'toolData',
      data: harness.tools[0],
    });
  }

  return messages;
}