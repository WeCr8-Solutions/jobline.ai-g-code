// CAM integration and tooling extraction layer.
//
// Integrations are file-based: they read posted NC programs, exported setup
// sheets and tool libraries. None of them opens a live session with the CAM
// application (that needs each vendor's licensed SDK). See src/cam/camSources.ts.

import { FolderCamConnection, CamConnection, CamTool, libraryToolToCamTool } from '../../cam/folderConnection';
import { parseToolLibrary } from '../../tooling/toolLibrary';
import { extractToolsFromNcComments } from '../../cam/camSources';
import { Tokenizer } from '../../parser/tokenizer';
import { BlockParser } from '../../parser/blockParser';
import { ProgramModelBuilder } from '../../parser/programModel';

export type { CamConnection, CamTool };

// Import all specific CAM connections
export * from './cam';

/**
 * Generic folder connection for any CAM system or post not listed by name.
 * The argument is the folder the post writes to (it used to be an API URL,
 * which was never implemented).
 */
export class GenericCamConnection extends FolderCamConnection {
  constructor(folder = '') { super('unknown', folder); }
}

/** Import tool info from a tool library file (Fusion JSON/.tools, .hsmlib, CSV). */
export async function importToolLibrary(file: { name: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<CamTool[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return parseToolLibrary(file.name, bytes).tools.map(libraryToolToCamTool);
}

/**
 * Tools a program calls, with whatever its comments say about them. Header
 * tool-list comments (Fusion, Mastercam posts) fill in what the T-line lacks.
 */
export function extractToolsFromGCode(gcode: string, dialect = 'fanuc'): CamTool[] {
  const blocks = new BlockParser().parseDocument(new Tokenizer().tokenizeDocument(gcode));
  const model = new ProgramModelBuilder().build(blocks, dialect);
  const header = new Map(extractToolsFromNcComments(gcode).tools.map(t => [t.number, t] as const));
  return model.tools.filter(t => t.toolNumber > 0).map(t => {
    const h = header.get(t.toolNumber);
    return {
      id: `T${t.toolNumber}`,
      type: model.detectedMachineType.includes('Turn') ? 'lathe' : 'mill',
      insertType: t.insertCode,
      size: t.diameter ?? h?.diameter,
      noseRadius: h?.cornerRadius,
      description: t.description ?? h?.description,
      number: t.toolNumber,
      lengthOffset: t.offsetH ?? h?.lengthOffset,
      diameterOffset: t.offsetD ?? h?.diameterOffset,
    };
  });
}

// Manual tool info input
export function manualToolInput(tools: CamTool[]): CamTool[] {
  return tools;
}

// Digital tool model for visualization and validation
export class DigitalToolLibrary {
  private tools: CamTool[] = [];
  addTool(tool: CamTool) { this.tools.push(tool); }
  getTools() { return this.tools; }
  clear() { this.tools = []; }
}
