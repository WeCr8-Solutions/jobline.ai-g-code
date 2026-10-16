/**
 * Holds the imported tool library and the setup sheets linked to programs.
 *
 * Two sources, most specific first:
 *   1. A setup sheet linked to one program (CAM integrations, per file).
 *   2. The workspace tool library (Import Tool Library), used for every program.
 * Both persist in workspace state so they survive a reload.
 */

import * as vscode from 'vscode';
import type { ToolLibrary } from './toolLibrary';
import type { CamSystemId } from '../cam/camSources';

export interface ProgramLink {
  library: ToolLibrary;
  setupSheetPath?: string;
  camSystem: CamSystemId;
  note?: string;
}

const LIBRARY_KEY = 'jobline.toolLibrary.v1';
const LINKS_KEY = 'jobline.programLinks.v1';

export class ToolLibraryStore implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private library: ToolLibrary | undefined;
  private links = new Map<string, ProgramLink>();

  constructor(private readonly state?: vscode.Memento) {
    this.library = state?.get<ToolLibrary>(LIBRARY_KEY);
    const saved = state?.get<Record<string, ProgramLink>>(LINKS_KEY) ?? {};
    for (const [k, v] of Object.entries(saved)) this.links.set(k, v);
  }

  workspaceLibrary(): ToolLibrary | undefined { return this.library; }

  async setWorkspaceLibrary(library: ToolLibrary | undefined): Promise<void> {
    this.library = library;
    await this.state?.update(LIBRARY_KEY, library);
    this.emitter.fire();
  }

  linkFor(uri: vscode.Uri | string): ProgramLink | undefined {
    return this.links.get(typeof uri === 'string' ? uri : uri.toString());
  }

  async link(uri: vscode.Uri | string, link: ProgramLink | undefined): Promise<void> {
    const key = typeof uri === 'string' ? uri : uri.toString();
    if (link) this.links.set(key, link); else this.links.delete(key);
    await this.state?.update(LINKS_KEY, Object.fromEntries(this.links));
    this.emitter.fire();
  }

  /** The library that applies to a program: its linked setup sheet, else the workspace library. */
  libraryFor(uri: vscode.Uri | string | undefined): ToolLibrary | undefined {
    if (uri !== undefined) {
      const linked = this.linkFor(uri);
      if (linked) return linked.library;
    }
    return this.library;
  }

  dispose(): void { this.emitter.dispose(); }
}

let current: ToolLibraryStore | undefined;

/** Shared instance; the extension creates it on activation. */
export function getToolLibraryStore(): ToolLibraryStore | undefined { return current; }
export function setToolLibraryStore(store: ToolLibraryStore | undefined): void { current = store; }
