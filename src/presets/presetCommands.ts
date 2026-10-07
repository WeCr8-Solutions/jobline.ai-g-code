/**
 * Commands for choosing, creating and sharing machine presets, and the prompt
 * that offers to switch when a program does not fit the active machine.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { BlockParser } from '../parser/blockParser';
import { ProgramModelBuilder } from '../parser/programModel';
import { Tokenizer } from '../parser/tokenizer';
import { isGCodeFile } from '../utils/fileTypes';
import {
  CONTROL_LABELS,
  JBL_CONTROL_FAMILIES,
  JBL_MACHINE_EXTENSION,
  JBL_MACHINE_KINDS,
  JblControlFamily,
  JobLineMachinePreset,
  describeMachinePreset,
  machineClassForKind,
  normalizeMachinePreset,
  parseJblMachine,
  serializeJblMachine,
  jblMachineFileName,
} from './jblMachine';
import {
  PRESET_SOURCE_LABELS,
  PRESET_SOURCE_ORDER,
  PresetEntry,
  parseTravelInput,
  presetFromSettings,
  programPresetMismatch,
  uniquePresetId,
} from './presetLibrary';
import { MachinePresetStore } from './presetStore';

type PresetPick = vscode.QuickPickItem & { entry?: PresetEntry; action?: 'create' | 'import' | 'clear' };

/** Tree items and webview messages pass either an entry, an item holding one, or an id. */
function entryFrom(store: MachinePresetStore, arg: unknown): PresetEntry | undefined {
  if (typeof arg === 'string') return store.find(arg);
  if (arg && typeof arg === 'object') {
    const candidate = arg as { kind?: string; entry?: PresetEntry; preset?: JobLineMachinePreset };
    if (candidate.kind === 'active') return store.active();
    if (candidate.entry?.preset) return store.find(candidate.entry.preset.id) ?? candidate.entry;
    if (candidate.preset?.id) return store.find(candidate.preset.id) ?? (candidate as PresetEntry);
  }
  return undefined;
}

function presetPicks(store: MachinePresetStore, extras: boolean): PresetPick[] {
  const activeId = store.activeId();
  const defaultId = store.defaultId();
  const picks: PresetPick[] = [];
  if (extras) {
    picks.push(
      { label: '$(add) New machine setup…', description: 'Name it once, reuse it for every program', action: 'create' },
      { label: `$(folder-opened) Import ${JBL_MACHINE_EXTENSION}…`, description: 'From jobline.ai-CAM or a shop share', action: 'import' },
    );
    if (activeId) picks.push({ label: '$(close) No preset for this workspace', action: 'clear' });
  }
  for (const source of PRESET_SOURCE_ORDER) {
    const group = store.list().filter(entry => entry.source === source);
    if (group.length === 0) continue;
    picks.push({ label: PRESET_SOURCE_LABELS[source], kind: vscode.QuickPickItemKind.Separator });
    for (const entry of group) {
      const tags = [entry.preset.id === activeId ? 'active' : '', entry.preset.id === defaultId ? 'default' : ''].filter(Boolean);
      picks.push({
        label: `${entry.preset.id === activeId ? '$(check)' : '$(server-process)'} ${entry.preset.name}`,
        description: tags.length ? `${tags.join(', ')} · ${describeMachinePreset(entry.preset)}` : describeMachinePreset(entry.preset),
        detail: entry.filePath,
        entry,
      });
    }
  }
  return picks;
}

async function pickPreset(store: MachinePresetStore, placeHolder: string): Promise<PresetEntry | undefined> {
  const picked = await vscode.window.showQuickPick(presetPicks(store, false), { placeHolder, matchOnDescription: true });
  return picked?.entry;
}

async function applyEntry(store: MachinePresetStore, entry: PresetEntry, scope: 'workspace' | 'default'): Promise<void> {
  await store.apply(entry.preset, scope);
  const where = scope === 'default' ? 'default for all workspaces' : 'this workspace';
  vscode.window.setStatusBarMessage(`$(check) JobLine: ${entry.preset.name} — ${where}`, 4000);
}

async function promptControl(initial?: JblControlFamily): Promise<JblControlFamily | undefined> {
  const picks = JBL_CONTROL_FAMILIES.filter(family => family !== 'unknown').map(family => ({
    label: CONTROL_LABELS[family],
    description: family === initial ? 'current' : undefined,
    family,
  }));
  const picked = await vscode.window.showQuickPick(picks, { placeHolder: 'Control on this machine', title: 'New machine setup (2/6)' });
  return picked?.family;
}

async function createPresetWizard(store: MachinePresetStore, seed?: JobLineMachinePreset): Promise<PresetEntry | undefined> {
  const base = seed ?? presetFromSettings('New machine', store.currentSettings());

  const name = await vscode.window.showInputBox({
    title: 'New machine setup (1/6)',
    prompt: 'Name this machine as your shop knows it',
    placeHolder: 'e.g. Cell 3 — Haas VF-2',
    value: seed ? `${seed.name} (copy)` : '',
    validateInput: value => value.trim() ? undefined : 'A name is required',
  });
  if (!name) return undefined;

  const family = await promptControl(base.control.family);
  if (!family) return undefined;

  const controlModel = await vscode.window.showInputBox({
    title: 'New machine setup (3/6)',
    prompt: `${CONTROL_LABELS[family]} control model (optional)`,
    placeHolder: 'e.g. 31i-B, NGC, 840D sl',
    value: family === base.control.family ? base.control.model ?? '' : '',
  });
  if (controlModel === undefined) return undefined;

  const kindPick = await vscode.window.showQuickPick(
    JBL_MACHINE_KINDS.map(entry => ({ label: entry.kind, description: entry.kind === base.machineKind ? 'current' : entry.machineClass })),
    { title: 'New machine setup (4/6)', placeHolder: 'Machine type' },
  );
  if (!kindPick) return undefined;

  const unitPick = await vscode.window.showQuickPick(
    [{ label: 'inch', description: 'G20' }, { label: 'metric', description: 'G21' }],
    { title: 'New machine setup (5/6)', placeHolder: 'Default units' },
  );
  if (!unitPick) return undefined;

  const unitWord = unitPick.label === 'metric' ? 'mm' : 'in';
  const travel = await vscode.window.showInputBox({
    title: 'New machine setup (6/6)',
    prompt: `Axis travel in ${unitWord} (optional) — used to flag moves past the machine limits`,
    placeHolder: 'e.g. X30 Y16 Z20  or  30 16 20  (add A120 for a rotary)',
    value: base.axes.length && base.units === unitPick.label
      ? base.axes.map(axis => `${axis.name}${Math.max(Math.abs(axis.min), Math.abs(axis.max))}`).join(' ')
      : '',
    validateInput: value => parseTravelInput(value) ? undefined : 'Use X30 Y16 Z20 or three numbers',
  });
  if (travel === undefined) return undefined;

  const result = normalizeMachinePreset({
    ...base,
    id: uniquePresetId(name, store.list().map(entry => entry.preset.id)),
    name: name.trim(),
    control: { family, model: controlModel.trim() || undefined },
    machineKind: kindPick.label,
    machineClass: machineClassForKind(kindPick.label),
    units: unitPick.label,
    axes: parseTravelInput(travel) ?? [],
    workholding: undefined,
  });
  if (!result.ok) {
    vscode.window.showErrorMessage(`JobLine: ${result.error}`);
    return undefined;
  }

  const workspaceFolder = store.workspaceMachinesFolder();
  const locations = [
    { label: '$(home) My presets', description: store.libraryPath(), detail: 'Available in every workspace and in jobline.ai-CAM', folder: store.libraryPath() },
    ...(workspaceFolder ? [{ label: '$(folder) This workspace', description: workspaceFolder, detail: 'Travels with the job folder (commit it with the programs)', folder: workspaceFolder }] : []),
    ...store.sharedFolders().map(folder => ({ label: '$(organization) Shared folder', description: folder, detail: 'Everyone pointing at this folder gets it', folder })),
  ];
  const location = locations.length === 1
    ? locations[0]
    : await vscode.window.showQuickPick(locations, { placeHolder: 'Where should this preset live?' });
  if (!location) return undefined;

  const filePath = await store.save(result.preset, location.folder);
  const entry = store.find(result.preset.id) ?? { preset: result.preset, source: 'library', filePath };
  await applyEntry(store, entry, 'workspace');
  return entry;
}

async function importPreset(store: MachinePresetStore): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: true,
    openLabel: 'Import',
    filters: { 'JobLine machine': ['jblmachine'], JSON: ['json'] },
  });
  if (!uris?.length) return;
  let imported: JobLineMachinePreset | undefined;
  for (const uri of uris) {
    const result = parseJblMachine(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'));
    if (!result.ok) {
      vscode.window.showErrorMessage(`JobLine: ${path.basename(uri.fsPath)} — ${result.error}`);
      continue;
    }
    for (const warning of result.warnings) vscode.window.showWarningMessage(`JobLine: ${path.basename(uri.fsPath)} — ${warning}`);
    await store.save(result.preset);
    imported = result.preset;
  }
  if (!imported) return;
  const choice = await vscode.window.showInformationMessage(
    `JobLine: Imported ${uris.length === 1 ? imported.name : `${uris.length} presets`} to My presets.`,
    'Use Now',
  );
  if (choice === 'Use Now') await store.apply(imported, 'workspace');
}

async function exportPreset(store: MachinePresetStore, entry: PresetEntry): Promise<void> {
  const defaultFolder = store.workspaceMachinesFolder() ?? store.libraryPath();
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(defaultFolder, jblMachineFileName(entry.preset))),
    filters: { 'JobLine machine': ['jblmachine'] },
    saveLabel: 'Export',
  });
  if (!uri) return;
  await vscode.workspace.fs.writeFile(uri, Buffer.from(serializeJblMachine(entry.preset), 'utf8'));
  vscode.window.showInformationMessage(`JobLine: Exported ${entry.preset.name} → ${uri.fsPath}`);
}

async function editPreset(store: MachinePresetStore, entry: PresetEntry): Promise<void> {
  let filePath = entry.filePath;
  if (!filePath) {
    // Built-ins are read-only; editing one makes a personal copy first.
    const copy = { ...entry.preset, id: uniquePresetId(entry.preset.name, store.list().map(item => item.preset.id)), name: `${entry.preset.name} (copy)` };
    filePath = await store.save(copy);
    if (store.activeId() === entry.preset.id) await store.apply(copy, 'workspace');
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  await vscode.window.showTextDocument(document);
}

// ── Program vs. machine check ──────────────────────────────────────────────

const tokenizer = new Tokenizer();
const blockParser = new BlockParser();
const modelBuilder = new ProgramModelBuilder();
const promptedDocuments = new Set<string>();

function detectedMachineTypeOf(document: vscode.TextDocument, dialect: string): string | undefined {
  if (document.languageId !== 'gcode') return '';
  try {
    const blocks = blockParser.parseDocument(tokenizer.tokenizeDocument(document.getText()));
    return modelBuilder.build(blocks, dialect).detectedMachineType;
  } catch {
    return undefined;
  }
}

async function checkDocumentAgainstPreset(store: MachinePresetStore, document: vscode.TextDocument | undefined): Promise<void> {
  if (!document || !isGCodeFile(document)) return;
  if (!vscode.workspace.getConfiguration('jobline.presets').get<boolean>('warnOnMismatch', true)) return;
  const key = document.uri.toString();
  if (promptedDocuments.has(key)) return;
  const active = store.active();
  if (!active) return;

  const detected = detectedMachineTypeOf(document, active.preset.control.family);
  if (detected === undefined) return;
  const reason = programPresetMismatch(active.preset, { detectedMachineType: detected, languageId: document.languageId });
  if (!reason) return;
  promptedDocuments.add(key);

  const choice = await vscode.window.showWarningMessage(
    `JobLine: ${path.basename(document.fileName)} may not fit "${active.preset.name}" — ${reason}.`,
    'Switch Machine…',
    'New Machine Setup…',
    "Don't Ask Again",
  );
  if (choice === 'Switch Machine…') await vscode.commands.executeCommand('jobline.presets.switch');
  else if (choice === 'New Machine Setup…') await vscode.commands.executeCommand('jobline.presets.create');
  else if (choice === "Don't Ask Again") {
    await vscode.workspace.getConfiguration('jobline.presets').update('warnOnMismatch', false, vscode.ConfigurationTarget.Global);
  }
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerPresetCommands(context: vscode.ExtensionContext, store: MachinePresetStore): void {
  // The resolved preset, not just the setting: a file-backed preset only
  // resolves once the first reload finishes, and that is when to check.
  let lastCheckedPresetId = store.active()?.preset.id;
  const withEntry = (handler: (entry: PresetEntry) => Promise<void>, placeHolder: string) =>
    async (arg?: unknown): Promise<void> => {
      const entry = entryFrom(store, arg) ?? await pickPreset(store, placeHolder);
      if (entry) await handler(entry);
    };

  context.subscriptions.push(
    vscode.commands.registerCommand('jobline.presets.switch', async () => {
      const picked = await vscode.window.showQuickPick(presetPicks(store, true), {
        placeHolder: 'Machine this program runs on — remembered for this workspace',
        matchOnDescription: true,
      });
      if (!picked) return;
      if (picked.action === 'create') await createPresetWizard(store);
      else if (picked.action === 'import') await importPreset(store);
      else if (picked.action === 'clear') await store.clearWorkspace();
      else if (picked.entry) await applyEntry(store, picked.entry, 'workspace');
    }),
    vscode.commands.registerCommand('jobline.presets.apply',
      withEntry(entry => applyEntry(store, entry, 'workspace'), 'Use which machine in this workspace?')),
    vscode.commands.registerCommand('jobline.presets.setDefault',
      withEntry(entry => applyEntry(store, entry, 'default'), 'Default machine for every workspace')),
    vscode.commands.registerCommand('jobline.presets.create', async () => { await createPresetWizard(store); }),
    vscode.commands.registerCommand('jobline.presets.duplicate',
      withEntry(async entry => { await createPresetWizard(store, entry.preset); }, 'Copy which preset?')),
    vscode.commands.registerCommand('jobline.presets.edit',
      withEntry(entry => editPreset(store, entry), 'Edit which preset?')),
    vscode.commands.registerCommand('jobline.presets.import', () => importPreset(store)),
    vscode.commands.registerCommand('jobline.presets.export',
      withEntry(entry => exportPreset(store, entry), 'Export which preset?')),
    vscode.commands.registerCommand('jobline.presets.delete', withEntry(async entry => {
      if (!entry.filePath) {
        vscode.window.showInformationMessage('JobLine: Built-in presets cannot be deleted.');
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Delete machine preset "${entry.preset.name}"?`, { modal: true, detail: entry.filePath }, 'Delete');
      if (confirm !== 'Delete') return;
      await store.delete(entry);
      if (store.activeId() === entry.preset.id) await store.clearWorkspace();
    }, 'Delete which preset?')),
    vscode.commands.registerCommand('jobline.presets.saveCurrent', async () => {
      await createPresetWizard(store, store.active()?.preset);
    }),
    vscode.commands.registerCommand('jobline.presets.refresh', () => store.reload()),
    vscode.commands.registerCommand('jobline.presets.openLibrary', async () => {
      await fs.promises.mkdir(store.libraryPath(), { recursive: true });
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(store.libraryPath()));
    }),
    vscode.window.onDidChangeActiveTextEditor(editor => { void checkDocumentAgainstPreset(store, editor?.document); }),
    // A different machine is a new question for every open program.
    store.onDidChange(() => {
      const activeId = store.active()?.preset.id;
      if (activeId === lastCheckedPresetId) return;
      lastCheckedPresetId = activeId;
      promptedDocuments.clear();
      void checkDocumentAgainstPreset(store, vscode.window.activeTextEditor?.document);
    }),
  );
  void checkDocumentAgainstPreset(store, vscode.window.activeTextEditor?.document);
}
