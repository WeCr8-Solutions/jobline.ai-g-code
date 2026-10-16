/**
 * File-based CAM connection: the honest replacement for the old stubs.
 *
 * A "connection" here is a folder the CAM system posts into. connect() checks
 * the folder exists, getCode() returns the newest NC program in it, and
 * getTools() returns the tool table from the setup sheet that belongs to that
 * program (or, failing that, from the program's header comments).
 * No vendor API is called; see CAM_SYSTEMS in camSources.ts for the wording
 * shown to users.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CamSystemId, CamSystemInfo, camSystem, detectCamSystem, extractToolsFromNcComments,
  findSetupSheetCandidates, isNcFileName, parseSetupSheet,
} from './camSources';
import type { LibraryTool, ToolLibrary } from '../tooling/toolLibrary';

export interface CamTool {
  id: string;
  type: string;
  insertType?: string;
  size?: number;
  noseRadius?: number;
  description?: string;
  [key: string]: unknown;
}

export interface CamConnection {
  connect(): Promise<boolean>;
  getTools(): Promise<CamTool[]>;
  getCode(): Promise<string>;
}

/** Minimal file-system surface, injectable for tests. */
export interface CamFolderIO {
  exists(p: string): boolean;
  list(dir: string): Array<{ name: string; mtimeMs: number }>;
  read(p: string): Uint8Array;
}

export const nodeFolderIO: CamFolderIO = {
  exists: p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
  list: dir => fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => ({ name: e.name, mtimeMs: fs.statSync(path.join(dir, e.name)).mtimeMs })),
  read: p => new Uint8Array(fs.readFileSync(p)),
};

export interface LinkedProgram {
  programPath: string;
  camSystem: CamSystemId;
  setupSheetPath?: string;
  library?: ToolLibrary;
  /** Why no setup sheet was linked, or what was used instead. */
  note?: string;
}

export function libraryToolToCamTool(tool: LibraryTool): CamTool {
  return {
    id: `T${tool.number}`,
    type: tool.type ?? 'tool',
    size: tool.diameter,
    noseRadius: tool.cornerRadius,
    description: tool.description,
    number: tool.number,
    lengthOffset: tool.lengthOffset,
    diameterOffset: tool.diameterOffset,
    fluteLength: tool.fluteLength,
    gaugeLength: tool.gaugeLength,
    unit: tool.unit,
  };
}

/**
 * Link one NC program to its setup sheet. Reads the folder, picks the best
 * matching sheet, parses it; falls back to the program's header comments.
 */
export function linkProgram(programPath: string, io: CamFolderIO = nodeFolderIO, programText?: string): LinkedProgram {
  const dir = path.dirname(programPath);
  const text = programText ?? new TextDecoder().decode(io.read(programPath));
  const cam = detectCamSystem(text);
  const siblings = io.exists(dir) ? io.list(dir).map(f => f.name) : [];
  const errors: string[] = [];
  for (const candidate of findSetupSheetCandidates(path.basename(programPath), siblings)) {
    const sheetPath = path.join(dir, candidate);
    try {
      const library = parseSetupSheet(candidate, io.read(sheetPath));
      if (library.tools.length) return { programPath, camSystem: cam, setupSheetPath: sheetPath, library };
    } catch (e) {
      errors.push(`${candidate}: ${(e as Error).message}`);
    }
  }
  const fromHeader = extractToolsFromNcComments(text, `${path.basename(programPath)} header`);
  if (fromHeader.tools.length) {
    return { programPath, camSystem: cam, library: fromHeader, note: `No setup sheet${errors.length ? ' could be read' : ' found'}; using the tool list in the program header.${errors.length ? ' ' + errors.join(' ') : ''}` };
  }
  return { programPath, camSystem: cam, note: `No setup sheet${errors.length ? ' could be read' : ' found'} beside the program and no tool list in its header.${errors.length ? ' ' + errors.join(' ') : ''}` };
}

export class FolderCamConnection implements CamConnection {
  constructor(public readonly system: CamSystemId, public folder = '', protected io: CamFolderIO = nodeFolderIO) {}

  info(): CamSystemInfo | undefined { return camSystem(this.system); }

  /** True when the output folder exists. There is no session to log in to. */
  async connect(): Promise<boolean> {
    return !!this.folder && this.io.exists(this.folder);
  }

  /** Newest NC program in the folder, or undefined. */
  latestProgram(): string | undefined {
    if (!this.folder || !this.io.exists(this.folder)) return undefined;
    const nc = this.io.list(this.folder).filter(f => isNcFileName(f.name)).sort((a, b) => b.mtimeMs - a.mtimeMs);
    return nc.length ? path.join(this.folder, nc[0].name) : undefined;
  }

  async getCode(): Promise<string> {
    const p = this.latestProgram();
    return p ? new TextDecoder().decode(this.io.read(p)) : '';
  }

  async getTools(): Promise<CamTool[]> {
    const p = this.latestProgram();
    if (!p) return [];
    const linked = linkProgram(p, this.io);
    return linked.library?.tools.map(libraryToolToCamTool) ?? [];
  }
}
