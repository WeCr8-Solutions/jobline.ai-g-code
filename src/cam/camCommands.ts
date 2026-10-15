/**
 * VS Code commands for tool-library import, CAM output integrations and
 * dialect conversion. The parsing and checking live in pure modules
 * (tooling/, cam/camSources.ts, post/dialectConvert.ts); this file is glue.
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import { parseToolLibrary, ToolLibrary } from '../tooling/toolLibrary';
import { ToolLibraryStore } from '../tooling/toolLibraryStore';
import {
  CAM_SYSTEMS, camSystem, detectCamSystem, findSetupSheetCandidates, isNcFileName,
  parseSetupSheet, extractToolsFromNcComments, NC_EXTENSIONS,
} from './camSources';
import { CONVERT_SOURCES, CONVERT_TARGETS, convertProgram } from '../post/dialectConvert';
import { CONTROL_PROFILES, ControlId, normalizeControl } from '../diagnostics/controlRules';
import { isGCodeFile } from '../utils/fileTypes';

function activeProgram(): vscode.TextDocument | undefined {
  const doc = vscode.window.activeTextEditor?.document;
  if (doc && isGCodeFile(doc)) return doc;
  return vscode.window.visibleTextEditors.map(e => e.document).find(d => isGCodeFile(d));
}

function libraryMessage(lib: ToolLibrary): string {
  return `${lib.tools.length} tool${lib.tools.length === 1 ? '' : 's'} from ${lib.name}${lib.warnings.length ? ` (${lib.warnings.length} skipped/duplicate — see Output › JobLine Tools)` : ''}`;
}

async function readBytes(uri: vscode.Uri): Promise<Uint8Array> {
  return vscode.workspace.fs.readFile(uri);
}

export function registerCamCommands(context: vscode.ExtensionContext, store: ToolLibraryStore): void {
  const output = vscode.window.createOutputChannel('JobLine Tools');
  context.subscriptions.push(output);
  const logWarnings = (lib: ToolLibrary) => {
    if (!lib.warnings.length) return;
    output.appendLine(`── ${lib.name} (${lib.format}) ──`);
    for (const w of lib.warnings) output.appendLine(`  ${w}`);
  };

  // ── Tool library ──────────────────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand('jobline.tools.importLibrary', async (uri?: vscode.Uri) => {
    const picked = uri ? [uri] : await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: 'Import tool library',
      filters: {
        'Tool libraries': ['json', 'tools', 'hsmlib', 'csv', 'tsv', 'txt'],
        'Fusion tool library': ['json', 'tools'],
        'HSMWorks / Inventor CAM': ['hsmlib'],
        'CSV (T, H, D, diameter, flute length, gauge length, description)': ['csv', 'tsv', 'txt'],
      },
    });
    if (!picked?.length) return;
    try {
      const lib = parseToolLibrary(path.basename(picked[0].fsPath), await readBytes(picked[0]));
      if (!lib.tools.length) {
        logWarnings(lib);
        void vscode.window.showWarningMessage(`JobLine: no tools with a tool number in ${lib.name}.`);
        return;
      }
      await store.setWorkspaceLibrary(lib);
      logWarnings(lib);
      const choice = await vscode.window.showInformationMessage(
        `JobLine: imported ${libraryMessage(lib)}. Programs are now checked for tools not in the library and T/H, T/D and diameter mismatches.`,
        ...(lib.warnings.length ? ['Show details'] : []),
      );
      if (choice === 'Show details') output.show(true);
    } catch (e) {
      void vscode.window.showErrorMessage(`JobLine: ${(e as Error).message}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jobline.tools.clearLibrary', async () => {
    const doc = activeProgram();
    const linked = doc ? store.linkFor(doc.uri) : undefined;
    if (linked && doc) {
      await store.link(doc.uri, undefined);
      void vscode.window.showInformationMessage(`JobLine: unlinked the setup sheet from ${path.basename(doc.fileName)}.`);
      return;
    }
    await store.setWorkspaceLibrary(undefined);
    void vscode.window.showInformationMessage('JobLine: tool library cleared.');
  }));

  // ── Setup sheets / CAM output ──────────────────────────────────────────────
  const linkDocument = async (doc: vscode.TextDocument, sheet?: vscode.Uri, quiet = false): Promise<boolean> => {
    const cam = detectCamSystem(doc.getText());
    let sheetUri = sheet;
    if (!sheetUri && doc.uri.scheme === 'file') {
      const dir = vscode.Uri.file(path.dirname(doc.fileName));
      const names = (await vscode.workspace.fs.readDirectory(dir)).filter(([, t]) => t === vscode.FileType.File).map(([n]) => n);
      const candidates = findSetupSheetCandidates(path.basename(doc.fileName), names);
      for (const c of candidates) {
        try {
          const lib = parseSetupSheet(c, await readBytes(vscode.Uri.joinPath(dir, c)));
          if (lib.tools.length) { sheetUri = vscode.Uri.joinPath(dir, c); await store.link(doc.uri, { library: lib, setupSheetPath: sheetUri.fsPath, camSystem: cam }); logWarnings(lib); break; }
        } catch (e) {
          output.appendLine(`${c}: ${(e as Error).message}`);
        }
      }
      if (sheetUri) {
        if (!quiet) void vscode.window.showInformationMessage(`JobLine: linked ${path.basename(sheetUri.fsPath)} to ${path.basename(doc.fileName)}${cam !== 'unknown' ? ` (${camSystem(cam)?.label})` : ''}.`);
        return true;
      }
    } else if (sheetUri) {
      try {
        const lib = parseSetupSheet(path.basename(sheetUri.fsPath), await readBytes(sheetUri));
        await store.link(doc.uri, { library: lib, setupSheetPath: sheetUri.fsPath, camSystem: cam });
        logWarnings(lib);
        if (!quiet) void vscode.window.showInformationMessage(`JobLine: linked ${libraryMessage(lib)} to ${path.basename(doc.fileName)}.`);
        return true;
      } catch (e) {
        if (!quiet) void vscode.window.showErrorMessage(`JobLine: ${(e as Error).message}`);
        return false;
      }
    }
    if (quiet) return false;
    const header = extractToolsFromNcComments(doc.getText(), `${path.basename(doc.fileName)} header`);
    const options = ['Choose setup sheet…', ...(header.tools.length ? [`Use the ${header.tools.length} tools in the program header`] : [])];
    const choice = await vscode.window.showInformationMessage(
      `JobLine: no setup sheet found beside ${path.basename(doc.fileName)} (looked for ${path.parse(doc.fileName).name}.html/.xml/.csv and *setup*/*tool* files).`,
      ...options,
    );
    if (choice === 'Choose setup sheet…') {
      const picked = await vscode.window.showOpenDialog({ canSelectMany: false, defaultUri: vscode.Uri.file(path.dirname(doc.fileName)), filters: { 'Setup sheet / tool list': ['html', 'htm', 'xml', 'csv', 'hsmlib'] } });
      if (picked?.length) return linkDocument(doc, picked[0]);
    } else if (choice && header.tools.length) {
      await store.link(doc.uri, { library: header, camSystem: cam, note: 'from program header comments' });
      return true;
    }
    return false;
  };

  context.subscriptions.push(vscode.commands.registerCommand('jobline.cam.linkSetupSheet', async (uri?: vscode.Uri) => {
    const doc = activeProgram();
    if (!doc) { void vscode.window.showWarningMessage('Open a G-code program first.'); return; }
    await linkDocument(doc, uri && !isNcFileName(uri.fsPath) ? uri : undefined);
  }));

  // Link automatically when a program opens and a matching sheet sits beside it.
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(doc => {
    if (!isGCodeFile(doc) || doc.uri.scheme !== 'file') return;
    if (!vscode.workspace.getConfiguration('jobline.cam').get<boolean>('autoLinkSetupSheets', true)) return;
    if (store.linkFor(doc.uri)) return;
    void linkDocument(doc, undefined, true).catch(() => undefined);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jobline.cam.showIntegrations', async () => {
    const items = CAM_SYSTEMS.map(s => ({
      label: s.label,
      description: s.setupSheets.length ? `Reads: NC output · ${s.setupSheets.join(' · ')}` : 'Reads: NC output',
      detail: `${s.does} Not included: ${s.doesNot}`,
      id: s.id,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'CAM integrations are file-based: NC output and setup sheets. None connects to a running CAM session.',
      matchOnDetail: true,
    });
    if (!picked) return;
    const action = await vscode.window.showInformationMessage(
      `${picked.label}: ${picked.detail}`,
      { modal: true },
      'Add output folder to watch…', 'Link a setup sheet to the open program',
    );
    if (action === 'Add output folder to watch…') await vscode.commands.executeCommand('jobline.cam.addWatchFolder');
    if (action === 'Link a setup sheet to the open program') await vscode.commands.executeCommand('jobline.cam.linkSetupSheet');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jobline.cam.addWatchFolder', async () => {
    const picked = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Watch this folder for CAM output' });
    if (!picked?.length) return;
    const cfg = vscode.workspace.getConfiguration('jobline.cam');
    const folders = cfg.get<string[]>('watchFolders', []);
    if (!folders.includes(picked[0].fsPath)) {
      await cfg.update('watchFolders', [...folders, picked[0].fsPath], vscode.ConfigurationTarget.Global);
    }
    void vscode.window.showInformationMessage(`JobLine: watching ${picked[0].fsPath} for posted programs.`);
  }));

  // ── Folder watchers ────────────────────────────────────────────────────────
  let watchers: vscode.Disposable[] = [];
  const recent = new Map<string, number>();
  const startWatchers = () => {
    for (const w of watchers) w.dispose();
    watchers = [];
    const folders = vscode.workspace.getConfiguration('jobline.cam').get<string[]>('watchFolders', []);
    for (const folder of folders) {
      const pattern = new vscode.RelativePattern(vscode.Uri.file(folder), `*.{${NC_EXTENSIONS.filter(e => e !== 'txt').join(',')}}`);
      const watcher = vscode.workspace.createFileSystemWatcher(pattern, false, false, true);
      const onPosted = async (uri: vscode.Uri) => {
        const now = Date.now();
        if ((recent.get(uri.fsPath) ?? 0) > now - 3000) return; // posts write in bursts
        recent.set(uri.fsPath, now);
        let label = 'CAM';
        try {
          const head = new TextDecoder().decode((await readBytes(uri)).subarray(0, 8000));
          const cam = detectCamSystem(head);
          label = cam === 'unknown' ? 'CAM' : (camSystem(cam)?.label ?? 'CAM');
        } catch { /* file still being written */ }
        const choice = await vscode.window.showInformationMessage(`JobLine: new ${label} output ${path.basename(uri.fsPath)}`, 'Open', 'Open and link setup sheet');
        if (!choice) return;
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
        if (choice === 'Open and link setup sheet') await linkDocument(doc);
      };
      watcher.onDidCreate(onPosted);
      watcher.onDidChange(onPosted);
      watchers.push(watcher);
    }
  };
  startWatchers();
  context.subscriptions.push(
    { dispose: () => watchers.forEach(w => w.dispose()) },
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('jobline.cam.watchFolders')) startWatchers(); }),
  );

  // ── Dialect conversion ────────────────────────────────────────────────────
  context.subscriptions.push(vscode.commands.registerCommand('jobline.convertDialect', async () => {
    const doc = activeProgram();
    if (!doc) { void vscode.window.showWarningMessage('Open a G-code program first.'); return; }
    let from = normalizeControl(vscode.workspace.getConfiguration().get<string>('jobline.controlType', 'fanuc'), doc.getText());
    if (!CONVERT_SOURCES.includes(from)) {
      const pick = await vscode.window.showQuickPick(CONVERT_SOURCES.map(id => ({ label: CONTROL_PROFILES[id].label, id })), {
        placeHolder: `${CONTROL_PROFILES[from].label} programs can't be converted. Which ISO dialect is this program written in?`,
      });
      if (!pick) return;
      from = pick.id;
    }
    const target = await vscode.window.showQuickPick(
      CONVERT_TARGETS.filter(id => id !== from).map(id => ({ label: CONTROL_PROFILES[id].label, id: id as ControlId })),
      { placeHolder: `Convert from ${CONTROL_PROFILES[from].label} to… (common codes only — not a CAM post-processor)` },
    );
    if (!target) return;
    try {
      const result = convertProgram(doc.getText(), from, target.id);
      const out = await vscode.workspace.openTextDocument({ content: result.text, language: 'gcode' });
      await vscode.window.showTextDocument(out, { preview: false });
      output.clear();
      output.appendLine(`Converted ${path.basename(doc.fileName)}: ${CONTROL_PROFILES[from].label} → ${CONTROL_PROFILES[target.id].label}`);
      output.appendLine(`${result.converted} line(s) rewritten, ${result.manual} line(s) left as JL MANUAL for you to finish.`);
      for (const n of result.notes) output.appendLine(`  L${n.line + 1}: ${n.message}`);
      const choice = await vscode.window.showWarningMessage(
        `JobLine: converted to ${CONTROL_PROFILES[target.id].label}. ${result.manual} line(s) need manual work. Prove it out on the control before cutting.`,
        'Show notes',
      );
      if (choice) output.show(true);
    } catch (e) {
      void vscode.window.showErrorMessage(`JobLine: ${(e as Error).message}`);
    }
  }));
}
