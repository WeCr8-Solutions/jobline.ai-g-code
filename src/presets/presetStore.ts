/**
 * Machine preset store.
 *
 * Presets are plain `.jblmachine` files, so jobline.ai-CAM reads and writes the
 * very same files. They are collected from, in priority order:
 *
 *   workspace  any *.jblmachine in the open folders (e.g. .jobline/machines/)
 *   shared     each folder in `jobline.presets.sharedFolders` (a shop network share)
 *   library    `jobline.presets.libraryPath`, default ~/.jobline/machines — the
 *              same default folder jobline.ai-CAM uses, so presets made in one
 *              show up in the other with no setup
 *   builtin    starting points shipped with the extension
 *
 * The active preset is the `jobline.machinePreset` setting. Applying a preset
 * writes it, plus the control/machine/unit settings the preset implies, to the
 * workspace — or to user settings when it is made the default, which every
 * workspace without its own choice then inherits. That is what saves setting
 * the machine up again for each program: it is chosen once and remembered.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  JBL_MACHINE_EXTENSION,
  JobLineMachinePreset,
  jblMachineFileName,
  parseJblMachine,
  serializeJblMachine,
} from './jblMachine';
import {
  BUILTIN_PRESETS,
  PresetEntry,
  PresetSettings,
  PresetSource,
  mergePresetEntries,
  settingsForPreset,
} from './presetLibrary';

export const ACTIVE_PRESET_SETTING = 'machinePreset';

export function defaultLibraryPath(): string {
  return path.join(os.homedir(), '.jobline', 'machines');
}

function expandHome(folder: string): string {
  return folder.startsWith('~') ? path.join(os.homedir(), folder.slice(1)) : folder;
}

export interface PresetLoadProblem {
  filePath: string;
  error: string;
}

export class MachinePresetStore implements vscode.Disposable {
  private entries: PresetEntry[] = mergePresetEntries(BUILTIN_PRESETS.map(preset => ({ preset, source: 'builtin' as const })));
  private problems: PresetLoadProblem[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private folderWatchers: vscode.Disposable[] = [];
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;

  /** Fires after presets reload or the active preset changes. */
  readonly onDidChange = this.changeEmitter.event;

  constructor() {
    const workspaceWatcher = vscode.workspace.createFileSystemWatcher(`**/*${JBL_MACHINE_EXTENSION}`);
    this.disposables.push(
      workspaceWatcher,
      workspaceWatcher.onDidCreate(() => this.scheduleReload()),
      workspaceWatcher.onDidChange(() => this.scheduleReload()),
      workspaceWatcher.onDidDelete(() => this.scheduleReload()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleReload()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('jobline.presets')) {
          this.watchFolders();
          this.scheduleReload();
        } else if (
          event.affectsConfiguration(`jobline.${ACTIVE_PRESET_SETTING}`) ||
          event.affectsConfiguration('jobline.controlType') ||
          event.affectsConfiguration('jobline.machineType') ||
          event.affectsConfiguration('jobline.units') ||
          event.affectsConfiguration('jobline.detectedMachineType')
        ) {
          this.changeEmitter.fire();
        }
      }),
      this.changeEmitter,
    );
    this.watchFolders();
  }

  dispose(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    for (const disposable of [...this.folderWatchers, ...this.disposables]) disposable.dispose();
  }

  libraryPath(): string {
    const configured = vscode.workspace.getConfiguration('jobline.presets').get<string>('libraryPath', '').trim();
    return configured ? expandHome(configured) : defaultLibraryPath();
  }

  sharedFolders(): string[] {
    return vscode.workspace.getConfiguration('jobline.presets').get<string[]>('sharedFolders', [])
      .filter(folder => typeof folder === 'string' && folder.trim() !== '')
      .map(folder => expandHome(folder.trim()));
  }

  list(): PresetEntry[] {
    return this.entries;
  }

  loadProblems(): PresetLoadProblem[] {
    return this.problems;
  }

  find(id: string | undefined): PresetEntry | undefined {
    return id ? this.entries.find(entry => entry.preset.id === id) : undefined;
  }

  activeId(): string | undefined {
    const id = vscode.workspace.getConfiguration('jobline').get<string>(ACTIVE_PRESET_SETTING, '');
    return id || undefined;
  }

  active(): PresetEntry | undefined {
    return this.find(this.activeId());
  }

  /** Id of the preset in user settings — what a new workspace starts with. */
  defaultId(): string | undefined {
    const inspected = vscode.workspace.getConfiguration('jobline').inspect<string>(ACTIVE_PRESET_SETTING);
    return inspected?.globalValue || undefined;
  }

  currentSettings(): Partial<PresetSettings> {
    const cfg = vscode.workspace.getConfiguration('jobline');
    return {
      controlType: cfg.get('controlType'),
      machineType: cfg.get('machineType'),
      units: cfg.get('units'),
      detectedMachineType: cfg.get('detectedMachineType'),
    };
  }

  /**
   * Make a preset active. `scope: 'workspace'` remembers it for this folder;
   * `'default'` puts it in user settings so every workspace inherits it.
   */
  async apply(preset: JobLineMachinePreset, scope: 'workspace' | 'default'): Promise<void> {
    const target = scope === 'default' || !vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Global
      : vscode.ConfigurationTarget.Workspace;
    const cfg = vscode.workspace.getConfiguration('jobline');
    const settings = settingsForPreset(preset);
    await cfg.update(ACTIVE_PRESET_SETTING, preset.id, target);
    await cfg.update('controlType', settings.controlType, target);
    await cfg.update('machineType', settings.machineType, target);
    await cfg.update('units', settings.units, target);
    await cfg.update('detectedMachineType', settings.detectedMachineType, target);
    if (target === vscode.ConfigurationTarget.Global && vscode.workspace.workspaceFolders?.length) {
      // A workspace-level value would hide the new default here; clear it so
      // this workspace follows the default like a fresh one would.
      for (const key of [ACTIVE_PRESET_SETTING, 'controlType', 'machineType', 'units', 'detectedMachineType']) {
        if (cfg.inspect(key)?.workspaceValue !== undefined) {
          await cfg.update(key, undefined, vscode.ConfigurationTarget.Workspace);
        }
      }
    }
    this.changeEmitter.fire();
  }

  /** Stop using a preset in this workspace (falls back to the default, if any). */
  async clearWorkspace(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('jobline');
    if (cfg.inspect(ACTIVE_PRESET_SETTING)?.workspaceValue !== undefined) {
      await cfg.update(ACTIVE_PRESET_SETTING, undefined, vscode.ConfigurationTarget.Workspace);
    }
    this.changeEmitter.fire();
  }

  /** Folder for presets that belong to the open job: <first folder>/.jobline/machines. */
  workspaceMachinesFolder(): string | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder && folder.uri.scheme === 'file' ? path.join(folder.uri.fsPath, '.jobline', 'machines') : undefined;
  }

  /** Write a preset to a folder as `<id>.jblmachine` and reload. Returns the file path. */
  async save(preset: JobLineMachinePreset, folder: string = this.libraryPath()): Promise<string> {
    await fs.promises.mkdir(folder, { recursive: true });
    const filePath = path.join(folder, jblMachineFileName(preset));
    await fs.promises.writeFile(filePath, serializeJblMachine(preset), 'utf8');
    await this.reload();
    return filePath;
  }

  async delete(entry: PresetEntry): Promise<void> {
    if (!entry.filePath) throw new Error('Built-in presets cannot be deleted.');
    await vscode.workspace.fs.delete(vscode.Uri.file(entry.filePath), { useTrash: true });
    await this.reload();
  }

  private scheduleReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => { void this.reload(); }, 150);
  }

  private watchFolders(): void {
    for (const watcher of this.folderWatchers) watcher.dispose();
    this.folderWatchers = [];
    for (const folder of [this.libraryPath(), ...this.sharedFolders()]) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(folder), `*${JBL_MACHINE_EXTENSION}`),
      );
      this.folderWatchers.push(
        watcher,
        watcher.onDidCreate(() => this.scheduleReload()),
        watcher.onDidChange(() => this.scheduleReload()),
        watcher.onDidDelete(() => this.scheduleReload()),
      );
    }
  }

  async reload(): Promise<void> {
    const found: PresetEntry[] = BUILTIN_PRESETS.map(preset => ({ preset, source: 'builtin' as const }));
    const problems: PresetLoadProblem[] = [];

    const readFile = async (filePath: string, source: PresetSource): Promise<void> => {
      try {
        const result = parseJblMachine(await fs.promises.readFile(filePath, 'utf8'));
        if (result.ok) found.push({ preset: result.preset, source, filePath });
        else problems.push({ filePath, error: result.error });
      } catch (err) {
        problems.push({ filePath, error: err instanceof Error ? err.message : String(err) });
      }
    };
    const readFolder = async (folder: string, source: PresetSource): Promise<void> => {
      let names: string[];
      try {
        names = await fs.promises.readdir(folder);
      } catch {
        return; // a missing library or an offline share is not an error
      }
      await Promise.all(names
        .filter(name => name.toLowerCase().endsWith(JBL_MACHINE_EXTENSION))
        .map(name => readFile(path.join(folder, name), source)));
    };

    await readFolder(this.libraryPath(), 'library');
    for (const folder of this.sharedFolders()) await readFolder(folder, 'shared');
    if (vscode.workspace.workspaceFolders?.length) {
      const uris = await vscode.workspace.findFiles(`**/*${JBL_MACHINE_EXTENSION}`, '**/node_modules/**', 200);
      await Promise.all(uris.filter(uri => uri.scheme === 'file').map(uri => readFile(uri.fsPath, 'workspace')));
    }

    this.entries = mergePresetEntries(found);
    this.problems = problems;
    this.changeEmitter.fire();
  }
}
