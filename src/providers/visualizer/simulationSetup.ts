import type { VisualizerHarnessData } from './fixtureHarness';

export type SimulationSetupMessage =
  | { type: 'machineType'; machineType: string }
  | { type: 'stockSettings'; w: number; d: number; h: number; unit: 'in' | 'mm'; color: string }
  | { type: 'stockOrigin'; xOff: number; yOff: number; zOff: number }
  | { type: 'toolData'; data: VisualizerHarnessData['tools'][number] };

export function buildAutoSimulationMessages(harness: VisualizerHarnessData): SimulationSetupMessage[] {
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
  }

  if (harness.tools.length > 0) {
    messages.push({
      type: 'toolData',
      data: harness.tools[0],
    });
  }

  return messages;
}