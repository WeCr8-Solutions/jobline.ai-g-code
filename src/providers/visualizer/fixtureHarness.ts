import { BlockParser } from '../../parser/blockParser';
import { ProgramModelBuilder } from '../../parser/programModel';
import type { ProgramModel, ToolUsage } from '../../parser/types';
import { Tokenizer } from '../../parser/tokenizer';
import { insertOutline, parseInsertCode } from '../../parser/insertCode';

export type VisualizerToolType =
  | 'End Mill' | 'Ball End Mill' | 'Bull Nose End Mill'
  | 'Drill' | 'Spot Drill' | 'Tap' | 'Reamer' | 'Chamfer Mill'
  | 'Face Mill' | 'Boring Bar' | 'Slitting Saw' | 'Lathe Insert' | 'Custom';
export type VisualizerHolderType = 'CAT40' | 'CAT50' | 'BT40' | 'BT50' | 'HSK-A63' | 'R8' | 'None';

export interface VisualizerHarnessManifest {
  id: string;
  name: string;
  fixtureMode: 'none';
  dialect: string;
  gcode: string;
  goalModels: {
    parasolidText: string;
    stl?: string;
  };
}

export interface VisualizerToolDefinition {
  toolNumber: number;
  type: VisualizerToolType;
  diameter: number;
  length: number;
  stickOut: number;
  flutes: number;
  holder: VisualizerHolderType;
  description: string;
  color: string;
  unit: 'in' | 'mm';
  insertCode?: string;
  insertOutline?: Array<[number, number]>;
  insertThickness?: number;
  cornerRadius?: number;
}

export interface VisualizerSetupSummary {
  fixtureMode: 'none';
  programNumber?: string;
  machineType: string;
  workOffsets: string[];
  stockDimensions?: {
    width: number;
    depth: number;
    height: number;
  };
  operationCount: number;
  toolCount: number;
}

export interface VisualizerHarnessData {
  model: ProgramModel;
  setup: VisualizerSetupSummary;
  tools: VisualizerToolDefinition[];
  unit: 'in' | 'mm';
}

const tokenizer = new Tokenizer();
const blockParser = new BlockParser();
const modelBuilder = new ProgramModelBuilder();

function detectUnits(gcode: string): 'in' | 'mm' {
  return /\bG21\b/i.test(gcode) ? 'mm' : 'in';
}

function extractHeaderToolDescriptions(gcode: string): Map<number, string> {
  const descriptions = new Map<number, string>();

  for (const line of gcode.split(/\r?\n/)) {
    const match = line.match(/^\(T(\d+)\s*-[\s]*(.*?)\)$/i);
    if (!match) continue;

    const toolNumber = Number.parseInt(match[1], 10);
    const description = match[2].trim();
    if (Number.isFinite(toolNumber) && description.length > 0) {
      descriptions.set(toolNumber, description);
    }
  }

  return descriptions;
}

function uniqueWorkOffsets(model: ProgramModel): string[] {
  const offsets = new Set<string>();
  for (const state of model.stateAtBlock) {
    if (state.activeWorkOffset) offsets.add(state.activeWorkOffset);
  }
  return Array.from(offsets).sort();
}

function parseFraction(text: string): number | null {
  const match = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return null;
  const numerator = Number.parseFloat(match[1]);
  const denominator = Number.parseFloat(match[2]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

function parseDiameter(description: string): number | undefined {
  const explicitDiameterMatches = Array.from(description.matchAll(/\bD\s*0*([0-9]+(?:\.[0-9]+)?)/gi));
  const explicitDiameter = explicitDiameterMatches.at(-1)?.[1];
  if (explicitDiameter) {
    const value = Number.parseFloat(explicitDiameter);
    if (Number.isFinite(value) && value > 0) return value;
  }

  const fraction = parseFraction(description);
  if (fraction !== null) return fraction;

  const decimalDiameter = description.match(/(?:^|[\s(])(\d+(?:\.\d+)?)\s*(?:BALL|BULL|FLAT|FACE|DRILL|TAP|REAM(?:ER)?|CHAMFER|ENDMILL|END MILL|SPOT\s*DRILL|SPOTDRILL|SLOTTING|SAW)/i);
  if (decimalDiameter) {
    const value = Number.parseFloat(decimalDiameter[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }

  return undefined;
}

function parseHolder(description: string, holder?: string): VisualizerHolderType {
  const raw = holder ?? description.match(/\b(CAT40|CAT50|BT40|BT50|HSK-A63|R8)\b/i)?.[1];
  switch ((raw ?? '').toUpperCase()) {
    case 'CAT40':
      return 'CAT40';
    case 'CAT50':
      return 'CAT50';
    case 'BT40':
      return 'BT40';
    case 'BT50':
      return 'BT50';
    case 'HSK-A63':
      return 'HSK-A63';
    case 'R8':
      return 'R8';
    default:
      return 'None';
  }
}

function inferToolType(description: string, insertCode?: string): VisualizerToolType {
  const upper = description.toUpperCase();
  if (insertCode) return 'Lathe Insert';
  if (upper.includes('TAP')) return 'Tap';
  if (/SPOT\s*DRILL|CENTER\s*DRILL/.test(upper)) return 'Spot Drill';
  if (upper.includes('DRILL')) return 'Drill';
  if (upper.includes('REAM')) return 'Reamer';
  if (/CHAMFER|COUNTERSINK/.test(upper)) return 'Chamfer Mill';
  if (/FACE\s*MILL|SHELL\s*MILL/.test(upper)) return 'Face Mill';
  if (upper.includes('BORING')) return 'Boring Bar';
  if (upper.includes('LATHE') || upper.includes('TURNING INSERT')) return 'Lathe Insert';
  if (upper.includes('BALL')) return 'Ball End Mill';
  if (/BULL|CORNER\s*RADIUS/.test(upper)) return 'Bull Nose End Mill';
  if (upper.includes('SAW') || upper.includes('SLOTTING')) return 'Slitting Saw';
  if (!/END\s*MILL|ENDMILL|FLAT/.test(upper) && /^T\d+$/i.test(description.trim())) return 'Custom';
  return 'End Mill';
}

function inferFlutes(description: string, type: VisualizerToolType): number {
  const fluteMatch = description.match(/\b(\d+)\s*FLUTE/i);
  if (fluteMatch) {
    const value = Number.parseInt(fluteMatch[1], 10);
    if (Number.isFinite(value) && value > 0) return value;
  }

  if (type === 'Drill' || type === 'Spot Drill' || type === 'Tap') return 2;
  if (type === 'Reamer') return 6;
  if (type === 'Face Mill') return 5;
  return 4;
}

function toolColor(type: VisualizerToolType): string {
  switch (type) {
    case 'Drill':
    case 'Spot Drill':
      return '#4da3ff';
    case 'Tap':
      return '#40c463';
    case 'Face Mill':
    case 'Slitting Saw':
      return '#ff8c42';
    case 'Boring Bar':
      return '#c792ea';
    case 'Lathe Insert':
      return '#f78c6c';
    case 'Custom':
      return '#8b949e';
    default:
      return '#ff6600';
  }
}

function convertTool(tool: ToolUsage, unit: 'in' | 'mm', headerDescription?: string): VisualizerToolDefinition {
  const description = headerDescription ?? tool.description ?? `T${tool.toolNumber}`;
  const type = inferToolType(description, tool.insertCode);
  const parsedInsert = tool.insertCode ? parseInsertCode(tool.insertCode) : null;
  const insertScale = parsedInsert?.units === unit
    ? 1
    : parsedInsert?.units === 'mm' ? 1 / 25.4
      : parsedInsert?.units === 'in' ? 25.4 : 1;
  const insertIc = parsedInsert?.icSize !== undefined ? parsedInsert.icSize * insertScale : undefined;
  const diameter = insertIc ?? tool.diameter ?? parseDiameter(description) ?? (unit === 'in' ? 0.25 : 6.35);
  const stickOut = tool.lengthOutOfHolder ?? Math.max(diameter * 4, unit === 'in' ? 1 : 25);
  const lengthOfCut = tool.lengthOfCut ?? Math.max(diameter * 1.5, stickOut * 0.4);
  const length = Math.max(stickOut + diameter * 2, lengthOfCut + stickOut);

  return {
    toolNumber: tool.toolNumber,
    type,
    diameter,
    length,
    stickOut,
    flutes: inferFlutes(description, type),
    holder: parseHolder(description, tool.holder),
    description,
    color: toolColor(type),
    unit,
    insertCode: tool.insertCode,
    insertOutline: parsedInsert?.icSize !== undefined
      ? insertOutline(
        parsedInsert.shape.code,
        parsedInsert.icSize * insertScale,
        (parsedInsert.cornerRadius ?? 0) * insertScale,
      )
      : undefined,
    insertThickness: parsedInsert?.thickness !== undefined ? parsedInsert.thickness * insertScale : undefined,
    cornerRadius: parsedInsert?.cornerRadius !== undefined ? parsedInsert.cornerRadius * insertScale : undefined,
  };
}

export function buildVisualizerHarnessData(gcode: string, dialect = 'fanuc'): VisualizerHarnessData {
  const blocks = blockParser.parseDocument(tokenizer.tokenizeDocument(gcode));
  const model = modelBuilder.build(blocks, dialect);
  const unit = detectUnits(gcode);
  const headerToolDescriptions = extractHeaderToolDescriptions(gcode);

  return {
    model,
    unit,
    setup: {
      fixtureMode: 'none',
      programNumber: model.programNumber,
      machineType: model.detectedMachineType,
      workOffsets: uniqueWorkOffsets(model),
      stockDimensions: model.stockDimensions,
      operationCount: model.operations.length,
      toolCount: model.tools.length,
    },
    tools: model.tools.map(tool => convertTool(tool, unit, headerToolDescriptions.get(tool.toolNumber))),
  };
}
