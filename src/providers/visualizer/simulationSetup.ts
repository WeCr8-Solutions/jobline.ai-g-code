import type { VisualizerHarnessData } from './fixtureHarness';
import { isCylinder, isSeededTestPack, SEEDED_TEST_PACK_LABEL, type RevPack } from './revpack';

export type SimulationSetupMessage =
  | { type: 'machineType'; machineType: string }
  | { type: 'stockSettings'; w: number; d: number; h: number; unit: 'in' | 'mm'; color: string }
  | { type: 'stockOrigin'; xOff: number; yOff: number; zOff: number; rotX?: number; rotY?: number; rotZ?: number }
  | {
      type: 'workholdingSettings';
      mode: 'none' | 'vise' | 'chuck';
      jawHeight: number;
      jawThickness: number;
      gripDepth: number;
      color: string;
    }
  | { type: 'toolData'; data: VisualizerHarnessData['tools'][number] }
  | { type: 'toolLibrary'; tools: VisualizerHarnessData['tools'] }
  | {
      /**
       * Every workholding shape in the pack, in WORK coordinates. The legacy
       * workholdingSettings message can only describe one vise/chuck jaw pair
       * derived from the stock; a pack can hold jaws + parallels + a fixture
       * plate, so the webview draws these instead whenever they are present.
       */
      type: 'revpackWorkholding';
      units: 'in' | 'mm';
      shapes: Array<
        | { kind: 'box'; name: string; min: [number, number, number]; max: [number, number, number] }
        | { kind: 'cylinder'; name: string; diameter: number; innerDiameter?: number; zMin: number; zMax: number }
      >;
    }
  | {
      /** Badge + machine summary for the panel. Not geometry. */
      type: 'revpackInfo';
      id: string;
      name: string;
      units: 'in' | 'mm';
      machine: string;
      dialect: string;
      kinematics: string;
      presetId?: string;
      workOffsets: Record<string, { x: number; y?: number; z: number }>;
      tools: Array<{ t: number; h?: number; type: string; diameter: number; gaugeLength: number; description?: string }>;
      source?: string;
      /** 'seeded-errors' for a harness pack whose findings are intentional. */
      purpose?: string;
      seededLabel?: string;
    };

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

/**
 * `machineTypeOverride` is the active machine preset's kind. The machine the
 * program will actually run on beats what the program text suggests - a plain
 * face-and-turn in G0/G1 reads as a mill, but on a lathe preset it is a lathe.
 */
export function buildAutoSimulationMessages(
  harness: VisualizerHarnessData,
  workholdingOverride?: string,
  machineTypeOverride?: string,
): SimulationSetupMessage[] {
  const machineType = machineTypeOverride || harness.setup.machineType;
  const messages: SimulationSetupMessage[] = [
    { type: 'machineType', machineType },
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
    const mode = workholdingModeFor(machineType, workholdingOverride);
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
      type: 'toolLibrary',
      tools: harness.tools,
    });
    messages.push({
      type: 'toolData',
      data: harness.tools[0],
    });
  }

  return messages;
}

/**
 * Visualizer setup straight from a RevPack, instead of guessing it from the
 * program text. The program can say STOCK in a comment or nothing at all; the
 * RevPack says what the shop actually clamps, so it wins.
 *
 * Box stock is sent as W×D×H with its origin offset from the work zero; a
 * turned blank as diameter × length. Workholding is reduced to the jaw message
 * the webview draws today (vise for boxes, chuck for cylinders); the full
 * boxes stay in the RevPack for the correlation check. No machine model is
 * needed: machineType carries the preset kind, and the axes/limits/dialect
 * travel with the pack.
 */
export function buildRevPackSimulationMessages(pack: RevPack, tools: VisualizerHarnessData['tools'] = []): SimulationSetupMessage[] {
  const machineType = pack.machine.machineClass === 'lathe' ? 'Turn Center (2-Axis)'
    : pack.machine.machineClass === 'mill-turn' ? '5-Axis Mill-Turn'
      : pack.machine.machineClass === 'laser' ? 'CNC Laser Cutting System (2D Flatbed)'
        : (pack.machine.rotaries?.length ?? 0) >= 2 ? '5-Axis Mill (Trunnion)' : '3-Axis Vertical Mill';
  const messages: SimulationSetupMessage[] = [{ type: 'machineType', machineType }];
  const stock = pack.stock;
  if (isCylinder(stock)) {
    messages.push({ type: 'stockSettings', w: stock.diameter, d: stock.diameter, h: stock.zMax - stock.zMin, unit: pack.units, color: '#4488ff' });
    // The webview draws a turned bar BACK from its face (Three -Y from the
    // origin), so the origin is the face: zMax. Sending zMin put the bar a
    // whole bar-length behind the chuck.
    messages.push({ type: 'stockOrigin', xOff: 0, yOff: 0, zOff: stock.zMax });
  } else {
    messages.push({
      type: 'stockSettings',
      w: stock.max[0] - stock.min[0], d: stock.max[1] - stock.min[1], h: stock.max[2] - stock.min[2],
      unit: pack.units, color: '#4488ff',
    });
    messages.push({ type: 'stockOrigin', xOff: stock.min[0], yOff: stock.min[1], zOff: stock.min[2] });
  }
  const holder = pack.workholding[0];
  if (holder) {
    const cylinder = isCylinder(holder);
    const height = cylinder ? holder.zMax - holder.zMin : holder.max[2] - holder.min[2];
    const thickness = cylinder ? (holder.diameter - (holder.innerDiameter ?? 0)) / 2 : Math.min(holder.max[0] - holder.min[0], holder.max[1] - holder.min[1]);
    const stockHeight = isCylinder(stock) ? stock.zMax - stock.zMin : stock.max[2] - stock.min[2];
    const grip = cylinder ? holder.zMax - holder.zMin : Math.max(0, holder.max[2] - (isCylinder(stock) ? stock.zMin : stock.min[2]));
    messages.push({
      type: 'workholdingSettings',
      mode: cylinder ? 'chuck' : 'vise',
      jawHeight: height,
      jawThickness: thickness,
      gripDepth: Math.min(grip, stockHeight),
      color: '#c0704f',
    });
  } else {
    messages.push({ type: 'workholdingSettings', mode: 'none', jawHeight: 0, jawThickness: 0, gripDepth: 0, color: '#c0704f' });
  }
  messages.push({
    type: 'revpackWorkholding',
    units: pack.units,
    shapes: pack.workholding.map(shape => isCylinder(shape)
      ? { kind: 'cylinder' as const, name: shape.name, diameter: shape.diameter, innerDiameter: shape.innerDiameter, zMin: shape.zMin, zMax: shape.zMax }
      : { kind: 'box' as const, name: shape.name, min: [...shape.min] as [number, number, number], max: [...shape.max] as [number, number, number] }),
  });
  const library: VisualizerHarnessData['tools'] = pack.tools.map(tool => {
    const fromProgram = tools.find(entry => entry.toolNumber === tool.t);
    return {
      ...(fromProgram ?? {
        flutes: 2, holder: 'None' as const, color: '#ff6600', type: 'Custom' as const,
      }),
      toolNumber: tool.t,
      diameter: tool.diameter,
      length: tool.gaugeLength,
      stickOut: tool.fluteLength ? tool.fluteLength * 1.5 : tool.diameter * 4,
      description: tool.description ?? tool.type,
      unit: pack.units,
    } as VisualizerHarnessData['tools'][number];
  });
  if (library.length > 0) {
    messages.push({ type: 'toolLibrary', tools: library });
    messages.push({ type: 'toolData', data: library[0] });
  }
  messages.push(revPackInfoMessage(pack));
  return messages;
}

export function revPackInfoMessage(pack: RevPack, source?: string): Extract<SimulationSetupMessage, { type: 'revpackInfo' }> {
  return {
    type: 'revpackInfo',
    id: pack.id,
    name: pack.name || pack.id,
    units: pack.units,
    machine: pack.machine.name,
    dialect: pack.machine.dialect,
    kinematics: pack.machine.kinematics,
    presetId: pack.machine.presetId,
    workOffsets: pack.workOffsets,
    tools: pack.tools.map(tool => ({ t: tool.t, h: tool.h, type: tool.type, diameter: tool.diameter, gaugeLength: tool.gaugeLength, description: tool.description })),
    source,
    purpose: pack.purpose,
    seededLabel: isSeededTestPack(pack) ? SEEDED_TEST_PACK_LABEL : undefined,
  };
}
