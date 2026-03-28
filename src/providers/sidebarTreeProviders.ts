import * as vscode from 'vscode';
import { Tokenizer } from '../parser/tokenizer';
import { BlockParser } from '../parser/blockParser';
import { ProgramModelBuilder } from '../parser/programModel';
import { MachineType, ProgramModel, ToolUsage } from '../parser/types';
import { ToolpathVisualizerPanel } from './toolpathVisualizer';

// ---------------------------------------------------------------------------
// Tree item types
// ---------------------------------------------------------------------------

class JobLineTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly description?: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    super(label, collapsibleState);
    this.description = description;
  }
}

/** Tree item that represents a single tool usage — carries tool data for commands. */
export class ToolTreeItem extends vscode.TreeItem {
  constructor(
    public readonly toolNumber: number,
    public readonly toolLineNumbers: number[],
    label: string,
    description?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.contextValue = 'toolItem';
    // Clicking the row navigates to the first occurrence in the editor
    this.command = {
      command: 'jobline.tools.goToTool',
      title: 'Go To Tool',
      arguments: [this],
    };
  }
}

// ---------------------------------------------------------------------------
// Generic tree data provider
// ---------------------------------------------------------------------------

class DynamicTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly itemsFactory: () => vscode.TreeItem[]) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(_element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    return Promise.resolve(this.itemsFactory());
  }
}

// ---------------------------------------------------------------------------
// Snapshot type
// ---------------------------------------------------------------------------

type SidebarSnapshot = {
  operations: vscode.TreeItem[];
  tools: vscode.TreeItem[];
  offsets: vscode.TreeItem[];
  cycles: vscode.TreeItem[];
  probing: vscode.TreeItem[];
  alarms: vscode.TreeItem[];
};

// ---------------------------------------------------------------------------
// Parser singletons
// ---------------------------------------------------------------------------

const tokenizer = new Tokenizer();
const blockParser = new BlockParser();
const modelBuilder = new ProgramModelBuilder();

const MACHINE_CYCLE_CATALOG: Record<MachineType, number[]> = {
  mill: [73, 81, 82, 83, 84, 85, 86, 88, 89],
  lathe: [74, 76, 81, 83, 84, 85, 86],
  'mill-turn': [73, 74, 76, 81, 82, 83, 84, 85, 86, 88, 89],
  grinder: [81, 82],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isGCodeDocument(document: vscode.TextDocument | undefined): boolean {
  if (!document) return false;
  if (document.languageId === 'gcode') return true;
  return /\.(nc|gcode|ngc|tap|cnc|mpf|spf|prg|min)$/i.test(document.fileName);
}

function getCurrentMachineType(): MachineType {
  const machineType = vscode.workspace.getConfiguration().get<string>('jobline.machineType', 'mill');
  if (machineType === 'lathe' || machineType === 'mill-turn' || machineType === 'grinder') {
    return machineType;
  }
  return 'mill';
}

function buildModelFromActiveDocument(): ProgramModel | null {
  const editor = vscode.window.activeTextEditor;
  if (!isGCodeDocument(editor?.document)) return null;

  const text = editor?.document.getText();
  if (!text) return null;

  try {
    const controlType = vscode.workspace.getConfiguration().get<string>('jobline.controlType', 'fanuc');
    const tokenized = tokenizer.tokenizeDocument(text);
    const blocks = blockParser.parseDocument(tokenized);
    return modelBuilder.build(blocks, controlType);
  } catch {
    return null;
  }
}

function uniqueWorkOffsets(model: ProgramModel): string[] {
  const offsets = new Set<string>();
  for (const state of model.stateAtBlock) {
    if (state.activeWorkOffset) offsets.add(state.activeWorkOffset);
  }
  return Array.from(offsets);
}

function formatCycleParams(parameters: Map<string, { resolvedValue: number | null }>): string {
  const orderedLetters = ['X', 'Y', 'Z', 'R', 'Q', 'P', 'F', 'L', 'K', 'I', 'J'];
  const parts: string[] = [];
  for (const letter of orderedLetters) {
    const value = parameters.get(letter)?.resolvedValue;
    if (value !== undefined && value !== null) {
      parts.push(`${letter}${value}`);
    }
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Snapshot builder
// ---------------------------------------------------------------------------

function buildSnapshot(): SidebarSnapshot {
  const defaultSnapshot: SidebarSnapshot = {
    operations: [new JobLineTreeItem('Open .nc/.gcode file', 'Parse operations from active program')],
    tools: [new JobLineTreeItem('No tools parsed yet')],
    offsets: [new JobLineTreeItem('No work offsets detected')],
    cycles: [new JobLineTreeItem('No canned cycles detected', 'Open a program with G81/G83/etc.')],
    probing: [new JobLineTreeItem('No probing cycles detected', 'Open a program with G31/G38.x')],
    alarms: [new JobLineTreeItem('No alarms', 'Validation results will appear here')],
  };

  const model = buildModelFromActiveDocument();
  const machineType = getCurrentMachineType();
  const supportedCycles = MACHINE_CYCLE_CATALOG[machineType].map(code => `G${code}`).join(', ');

  if (!model) {
    defaultSnapshot.cycles = [
      new JobLineTreeItem('No canned cycles detected', 'Open a program with G81/G83/etc.'),
      new JobLineTreeItem(`Supported (${machineType})`, supportedCycles),
    ];
    return defaultSnapshot;
  }

  const operations = model.operations.length > 0
    ? model.operations.map(op =>
      new JobLineTreeItem(
        op.name,
        `T${op.toolNumber} L${op.startLine + 1}-${op.endLine + 1}`
      )
    )
    : [new JobLineTreeItem('No operations detected')];

  // Build ToolTreeItems so inline buttons and click-navigation work
  const tools: vscode.TreeItem[] = model.tools.length > 0
    ? model.tools.map((t: ToolUsage) =>
        new ToolTreeItem(
          t.toolNumber,
          t.lineNumbers,
          `T${t.toolNumber}`,
          t.description ?? 'Tool usage detected'
        )
      )
    : [new JobLineTreeItem('No tools detected')];

  const offsetsList = uniqueWorkOffsets(model);
  const offsets = offsetsList.length > 0
    ? offsetsList.map(offset => new JobLineTreeItem(offset, 'Detected in active program'))
    : [new JobLineTreeItem('No work offsets detected')];

  const cycles = [new JobLineTreeItem(`Supported (${machineType})`, supportedCycles)];
  if (model.cannedCycles.length > 0) {
    for (const cycle of model.cannedCycles) {
      const paramSummary = formatCycleParams(cycle.parameters);
      const description = paramSummary.length > 0
        ? `L${cycle.line + 1} ${paramSummary}`
        : `L${cycle.line + 1}`;
      cycles.push(new JobLineTreeItem(`G${cycle.code}`, description));
    }
  } else {
    cycles.unshift(new JobLineTreeItem('No canned cycles found in active file'));
  }

  const probing: vscode.TreeItem[] = [];
  if (model.probingInstances.length > 0) {
    for (const p of model.probingInstances) {
      const codeName = p.code === 31 ? 'G31' : `G${p.code}`;
      const coords = Object.entries(p.targetPosition)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}${v}`)
        .join(' ');
      const feed = p.feedRate !== null ? ` F${p.feedRate}` : '';
      probing.push(new JobLineTreeItem(codeName, `L${p.line + 1} ${coords}${feed}`));
    }
  } else {
    probing.push(new JobLineTreeItem('No probing cycles found', 'G31 / G38.2–G38.5'));
  }

  const alarms = model.diagnostics.length > 0
    ? model.diagnostics.map(d => new JobLineTreeItem(`[${d.severity}] L${d.line + 1}`, d.message))
    : [new JobLineTreeItem('No alarms', 'Validation results will appear here')];

  return { operations, tools, offsets, cycles, probing, alarms };
}

// ---------------------------------------------------------------------------
// Register sidebar tree providers
// ---------------------------------------------------------------------------

export function registerSidebarTreeProviders(context: vscode.ExtensionContext): void {
  let snapshot = buildSnapshot();

  const operationsProvider = new DynamicTreeDataProvider(() => snapshot.operations);
  const toolsProvider = new DynamicTreeDataProvider(() => snapshot.tools);
  const offsetsProvider = new DynamicTreeDataProvider(() => snapshot.offsets);
  const cannedCyclesProvider = new DynamicTreeDataProvider(() => snapshot.cycles);
  const probingProvider = new DynamicTreeDataProvider(() => snapshot.probing);
  const alarmsProvider = new DynamicTreeDataProvider(() => snapshot.alarms);

  const refreshAll = (): void => {
    snapshot = buildSnapshot();
    operationsProvider.refresh();
    toolsProvider.refresh();
    offsetsProvider.refresh();
    cannedCyclesProvider.refresh();
    probingProvider.refresh();
    alarmsProvider.refresh();
  };

  // Register goToLine command for sidebar items
  context.subscriptions.push(
    vscode.commands.registerCommand('jobline.goToLine', (lineNumber: number) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const pos = new vscode.Position(lineNumber, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    })
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('jobline.operationsTree', operationsProvider),
    vscode.window.registerTreeDataProvider('jobline.toolsTree', toolsProvider),
    vscode.window.registerTreeDataProvider('jobline.offsetsTree', offsetsProvider),
    vscode.window.registerTreeDataProvider('jobline.cannedCyclesTree', cannedCyclesProvider),
    vscode.window.registerTreeDataProvider('jobline.probingTree', probingProvider),
    vscode.window.registerTreeDataProvider('jobline.alarmsTree', alarmsProvider),
    vscode.window.onDidChangeActiveTextEditor(() => refreshAll()),
    vscode.workspace.onDidChangeTextDocument(event => {
      if (
        vscode.window.activeTextEditor &&
        event.document.uri.toString() === vscode.window.activeTextEditor.document.uri.toString()
      ) {
        refreshAll();
      }
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (
        event.affectsConfiguration('jobline.controlType') ||
        event.affectsConfiguration('jobline.machineType')
      ) {
        refreshAll();
      }
    })
  );

  refreshAll();
}

// ---------------------------------------------------------------------------
// Tools tree commands
// ---------------------------------------------------------------------------

/**
 * Navigate the active editor to the first line where a tool is referenced.
 * Accepts either a ToolTreeItem (from inline button / row click) or
 * a bare { toolNumber, line } object for future programmatic use.
 */
async function goToTool(item: ToolTreeItem): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !item?.toolLineNumbers?.length) return;

  const line = item.toolLineNumbers[0];
  const pos = new vscode.Position(line, 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

/**
 * Remove the T{n} M06 line(s) for a specific tool after user confirmation.
 * Only lines that contain the tool word (e.g. T3 or T03) AND M06 are removed
 * so we don't accidentally delete lines that merely reference the tool mid-cut.
 */
async function removeToolChange(item: ToolTreeItem): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !item?.toolNumber) return;

  const doc = editor.document;
  const lines = doc.getText().split('\n');

  // Find lines that are the actual tool-change call: contain T{n} and M06
  const tPattern = new RegExp(`\\bT0*${item.toolNumber}\\b`, 'i');
  const m06Pattern = /\bM0*6\b/i;

  const matchingLines: number[] = lines
    .map((line, idx) => ({ line, idx }))
    .filter(({ line }) => tPattern.test(line) && m06Pattern.test(line))
    .map(({ idx }) => idx);

  if (matchingLines.length === 0) {
    vscode.window.showInformationMessage(
      `JobLine: No T${item.toolNumber} M06 line found in this program.`
    );
    return;
  }

  const answer = await vscode.window.showWarningMessage(
    `Remove T${item.toolNumber} M06 tool change line${matchingLines.length > 1 ? 's' : ''}? (${matchingLines.length} line${matchingLines.length > 1 ? 's' : ''})`,
    { modal: true },
    'Remove'
  );
  if (answer !== 'Remove') return;

  const edit = new vscode.WorkspaceEdit();
  // Delete from highest line first to avoid index shifting
  for (const lineIdx of [...matchingLines].reverse()) {
    const start = new vscode.Position(lineIdx, 0);
    // Include the newline by starting at col 0 of next line, unless it's the last line
    const end = lineIdx < lines.length - 1
      ? new vscode.Position(lineIdx + 1, 0)
      : new vscode.Position(lineIdx, lines[lineIdx].length);
    edit.delete(doc.uri, new vscode.Range(start, end));
  }
  await vscode.workspace.applyEdit(edit);
}

/**
 * Prompt for a tool number, then insert a T{n} M06 block at the cursor
 * position (or before M30 if there is no active selection).
 */
async function addToolChange(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('JobLine: No active editor.');
    return;
  }

  const toolNumStr = await vscode.window.showInputBox({
    prompt: 'Tool number to insert',
    placeHolder: 'e.g. 1',
    validateInput: v => (/^\d+$/.test(v.trim()) ? null : 'Enter a positive integer'),
  });
  if (!toolNumStr) return;

  const toolNum = parseInt(toolNumStr.trim(), 10);
  const doc = editor.document;
  const lines = doc.getText().split('\n');

  // Insert at cursor line if editor has focus, otherwise find a sensible spot
  let insertLine = editor.selection.active.line;

  // If cursor is at line 0 (no meaningful selection) fall back to before M30/%
  if (insertLine === 0 && editor.selection.isEmpty) {
    insertLine = lines.length;
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();
      if (/[Mm]30/.test(trimmed) || trimmed === '%') {
        insertLine = i;
      }
    }
  }

  const newBlock = `T${toolNum} M06\n`;
  const edit = new vscode.WorkspaceEdit();
  edit.insert(doc.uri, new vscode.Position(insertLine, 0), newBlock);
  await vscode.workspace.applyEdit(edit);

  // Move cursor to the newly inserted line
  const pos = new vscode.Position(insertLine, 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

export function registerToolsCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('jobline.tools.goToTool', goToTool),
    vscode.commands.registerCommand('jobline.tools.removeToolChange', removeToolChange),
    vscode.commands.registerCommand('jobline.tools.addToolChange', addToolChange),
  );
}

// ---------------------------------------------------------------------------
// Commands tree
// ---------------------------------------------------------------------------

interface CommandItem {
  label: string;
  command: string;
  icon: string;
  description?: string;
}

const COMMANDS_TREE_ITEMS: CommandItem[] = [
  { label: 'Select Control Type',        command: 'jobline.selectControl',                    icon: '$(circuit-board)', description: 'CNC dialect' },
  { label: 'Validate Program',           command: 'jobline.validateProgram',                  icon: '$(shield)',        description: 'Check for errors' },
  { label: 'Format G-Code',             command: 'jobline.formatDocument',                   icon: '$(symbol-keyword)',description: 'Shift+Alt+F' },
  { label: 'Open Explainer',             command: 'jobline.openExplainer',                    icon: '$(comment)',       description: 'Plain language' },
  { label: 'Insert Line Numbers',        command: 'jobline.toolbox.insertLineNumbers',         icon: '$(list-ordered)',  description: 'N-words' },
  { label: 'Remove Line Numbers',        command: 'jobline.toolbox.removeLineNumbers',         icon: '$(list-unordered)',description: 'Remove N-words' },
  { label: 'Strip Comments',            command: 'jobline.toolbox.stripComments',             icon: '$(comment)',       description: 'Remove all comments' },
  { label: 'Uppercase G/M Codes',       command: 'jobline.toolbox.uppercaseGM',              icon: '$(case-sensitive)',description: 'Normalize case' },
  { label: 'Scale Feed Rates',          command: 'jobline.toolbox.scaleFeedRates',            icon: '$(dashboard)',     description: 'Feed rate %' },
  { label: 'Scale Spindle Speeds',      command: 'jobline.toolbox.scaleSpindleSpeeds',        icon: '$(settings-gear)', description: 'Spindle speed %' },
  { label: 'Shift X Axis',             command: 'jobline.toolbox.shiftX',                    icon: '$(move)',          description: 'Offset X coords' },
  { label: 'Shift Y Axis',             command: 'jobline.toolbox.shiftY',                    icon: '$(move)',          description: 'Offset Y coords' },
  { label: 'Shift Z Axis',             command: 'jobline.toolbox.shiftZ',                    icon: '$(move)',          description: 'Offset Z coords' },
  { label: 'Insert Safe-Z Before TCs', command: 'jobline.toolbox.insertSafeZ',               icon: '$(shield)',        description: 'G91 G28 Z0.' },
  { label: 'Add Coolant On/Off',        command: 'jobline.toolbox.addCoolant',               icon: '$(droplet)',       description: 'M08 / M09' },
  { label: 'Find Next Tool Change',     command: 'jobline.toolbox.findNextToolChange',        icon: '$(search)',        description: 'Navigate M06' },
  { label: 'Find Next Canned Cycle',   command: 'jobline.toolbox.findNextCannedCycle',       icon: '$(search)',        description: 'Navigate G7x/G8x' },
];

class CommandTreeItem extends vscode.TreeItem {
  constructor(item: CommandItem) {
    super(item.label, vscode.TreeItemCollapsibleState.None);
    this.description = item.description;
    this.iconPath = new vscode.ThemeIcon(
      item.icon.replace(/^\$\(/, '').replace(/\)$/, '')
    );
    this.command = {
      command: item.command,
      title: item.label,
    };
    this.tooltip = item.label;
  }
}

class CommandsTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(_element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    return Promise.resolve(
      COMMANDS_TREE_ITEMS.map(item => new CommandTreeItem(item))
    );
  }
}

export function registerCommandsTree(context: vscode.ExtensionContext): void {
  const provider = new CommandsTreeDataProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('jobline.commandsTree', provider)
  );
}

// ---------------------------------------------------------------------------
// Visualizer Tree Data Provider
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Visualizer Settings Sidebar Provider
// ---------------------------------------------------------------------------

export class VisualizerSettingsProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'jobline.visualizerSettings';

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._getHtml();

    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg.command) {
        vscode.commands.executeCommand(msg.command, msg.arg);
        return;
      }
      if (msg.type === 'stockSettings') {
        ToolpathVisualizerPanel.currentPanel?.postMessage(msg);
      }
    });
  }

  private _getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  :root {
    --bg: var(--vscode-sideBar-background, #252526);
    --fg: var(--vscode-foreground, #cccccc);
    --btn-bg: var(--vscode-button-background, #0e639c);
    --btn-fg: var(--vscode-button-foreground, #ffffff);
    --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
    --btn2-bg: transparent;
    --btn2-border: var(--vscode-widget-border, #454545);
    --btn2-hover: var(--vscode-sideBarSectionHeader-background, #2d2d2d);
    --input-bg: var(--vscode-input-background, #3c3c3c);
    --input-fg: var(--vscode-input-foreground, #cccccc);
    --input-border: var(--vscode-input-border, #3c3c3c);
    --sec-bg: var(--vscode-sideBarSectionHeader-background, #2d2d2d);
    --sec-fg: var(--vscode-sideBarSectionHeader-foreground, #bbb);
    --border: var(--vscode-widget-border, #454545);
    --hint-fg: var(--vscode-descriptionForeground, #999);
    --font: var(--vscode-font-family, sans-serif);
    --fs: var(--vscode-font-size, 13px);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--fg); font-family: var(--font); font-size: var(--fs); }
  .sec-hdr {
    background: var(--sec-bg); color: var(--sec-fg);
    font-size: 0.78em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
    padding: 5px 8px; border-top: 1px solid var(--border); user-select: none;
  }
  .sec { padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .row { display: flex; gap: 6px; align-items: center; }
  .row label { font-size: 0.82em; min-width: 5.5em; color: var(--hint-fg); }
  input[type=number] {
    background: var(--input-bg); color: var(--input-fg);
    border: 1px solid var(--input-border); border-radius: 3px;
    padding: 3px 5px; flex: 1;
    font-size: var(--fs); font-family: var(--font);
  }
  input[type=color] {
    width: 32px; height: 28px; border: 1px solid var(--border);
    background: var(--input-bg); cursor: pointer; border-radius: 3px;
  }
  button {
    background: var(--btn-bg); color: var(--btn-fg);
    border: none; border-radius: 3px; padding: 5px 10px;
    cursor: pointer; font-size: var(--fs); font-family: var(--font);
    width: 100%; text-align: left;
  }
  button:hover { background: var(--btn-hover); }
  button.sec { background: var(--btn2-bg); color: var(--fg); border: 1px solid var(--btn2-border); text-align: center; }
  button.sec:hover { background: var(--btn2-hover); }
  button.sec.active {
    background: var(--btn-bg); color: var(--btn-fg); border-color: var(--btn-bg);
  }
  .unit-row { display: flex; gap: 4px; }
  .unit-row button { flex: 1; text-align: center; }
</style>
</head>
<body>
<div class="sec-hdr">Launch</div>
<div class="sec">
  <button onclick="launchToolPreview()">🔧 Tools Preview</button>
  <button onclick="launchSimulation()">▶ Open Simulation</button>
</div>
<div class="sec-hdr">Machine</div>
<div class="sec">
  <select id="machineType" onchange="changeMachine()">
    <option>3-Axis Vertical Mill</option>
    <option>4-Axis Mill</option>
    <option>5-Axis Mill (Trunnion)</option>
    <option>5-Axis Mill (Rotary Table)</option>
    <option>Turn Center (2-Axis)</option>
    <option>5-Axis Mill-Turn</option>
    <option>Multi-Spindle Transfer</option>
    <option>Grinding Center</option>
  </select>
  <div style="font-size: 0.75em; color: var(--hint-fg); margin-top: 4px;">
    <label style="display: flex; align-items: center; gap: 4px;">
      <input type="checkbox" id="capLiveTool" onchange="updateCaps()"> Live Tool
    </label>
    <label style="display: flex; align-items: center; gap: 4px;">
      <input type="checkbox" id="capProbing" onchange="updateCaps()"> Probing
    </label>
    <label style="display: flex; align-items: center; gap: 4px;">
      <input type="checkbox" id="cap4thAxis" onchange="updateCaps()"> 4th Axis
    </label>
    <label style="display: flex; align-items: center; gap: 4px;">
      <input type="checkbox" id="cap5thAxis" onchange="updateCaps()"> 5th Axis
    </label>
  </div>
</div>
<div class="sec-hdr">Visualizer</div>
<div class="sec">
  <button onclick="openViz()">👁️ Open 3D Visualizer</button>
</div>
<div class="sec-hdr">Stock Dimensions</div>
<div class="sec">
  <div class="unit-row">
    <button class="sec active" id="unitIn" onclick="setUnit('in')">Inches (in)</button>
    <button class="sec" id="unitMm" onclick="setUnit('mm')">Metric (mm)</button>
  </div>
  <div class="row"><label>Width (X)</label><input type="number" id="stockW" value="4" step="0.001" min="0.001"></div>
  <div class="row"><label>Depth (Y)</label><input type="number" id="stockD" value="4" step="0.001" min="0.001"></div>
  <div class="row"><label>Height (Z)</label><input type="number" id="stockH" value="2" step="0.001" min="0.001"></div>
  <div class="row">
    <label>Color</label>
    <input type="color" id="stockColor" value="#4488ff">
  </div>
  <button onclick="applyStock()">Apply to Visualizer</button>
</div>
<div class="sec-hdr">Stock Origin (WCS Zero)</div>
<div class="sec">
  <div class="row">
    <label>Preset</label>
    <select id="originPreset" onchange="onOriginPresetChange()" style="flex:1; background:var(--input-bg); color:var(--input-fg); border:1px solid var(--input-border); border-radius:3px; padding:3px 5px; font-size:var(--fs);">
      <option value="cornerFL">Corner (X0 Y0 at front-left)</option>
      <option value="centerTop">Center top</option>
      <option value="centerBottom">Center bottom</option>
      <option value="custom">Custom</option>
    </select>
  </div>
  <div id="originCustom" style="display:none;">
    <div class="row"><label>X offset</label><input type="number" id="originX" value="0" step="0.001"></div>
    <div class="row"><label>Y offset</label><input type="number" id="originY" value="0" step="0.001"></div>
    <div class="row"><label>Z offset</label><input type="number" id="originZ" value="0" step="0.001"></div>
  </div>
  <button onclick="applyOrigin()" style="margin-top:6px;">Apply Origin</button>
</div>
<div class="sec-hdr">Layer Filters</div>
<div class="sec">
  <label style="font-size:0.82em; display:flex; gap:4px; align-items:center;"><input type="checkbox" id="cbTool" checked onchange="toggleLayer('tool')"> Tool</label>
  <label style="font-size:0.82em; display:flex; gap:4px; align-items:center;"><input type="checkbox" id="cbToolHolder" checked onchange="toggleLayer('toolHolder')"> Tool Holder</label>
  <label style="font-size:0.82em; display:flex; gap:4px; align-items:center;"><input type="checkbox" id="cbStock" checked onchange="toggleLayer('stock')"> Stock</label>
  <label style="font-size:0.82em; display:flex; gap:4px; align-items:center;"><input type="checkbox" id="cbPath" checked onchange="toggleLayer('path')"> Toolpath</label>
  <label style="font-size:0.82em; display:flex; gap:4px; align-items:center;"><input type="checkbox" id="cbSweptTube" checked onchange="toggleLayer('sweptTube')"> Swept Tube</label>
  <label style="font-size:0.82em; display:flex; gap:4px; align-items:center;"><input type="checkbox" id="cbOrigin" checked onchange="toggleLayer('origin')"> Origin Marker</label>
</div>
<script>
  const vs = acquireVsCodeApi();
  let currentUnit = 'in';

  function launchToolPreview() {
    vs.postMessage({ command: 'jobline.openToolPreview' });
  }

  function launchSimulation() {
    vs.postMessage({ command: 'jobline.openSimulation' });
  }

  function changeMachine() {
    const machine = document.getElementById('machineType').value;
    vs.postMessage({ type: 'machineType', value: machine });
  }

  function updateCaps() {
    const caps = {
      liveTool: document.getElementById('capLiveTool').checked,
      probing: document.getElementById('capProbing').checked,
      fourthAxis: document.getElementById('cap4thAxis').checked,
      fifthAxis: document.getElementById('cap5thAxis').checked,
    };
    vs.postMessage({ type: 'machineCapabilities', value: caps });
  }

  function openViz() {
    vs.postMessage({ command: 'jobline.gcode.showVisualizer' });
  }

  function setUnit(unit) {
    currentUnit = unit;
    document.getElementById('unitIn').classList.toggle('active', unit === 'in');
    document.getElementById('unitMm').classList.toggle('active', unit === 'mm');
  }

  function applyStock() {
    const w = parseFloat(document.getElementById('stockW').value) || 4;
    const d = parseFloat(document.getElementById('stockD').value) || 4;
    const h = parseFloat(document.getElementById('stockH').value) || 2;
    const color = document.getElementById('stockColor').value;
    vs.postMessage({ type: 'stockSettings', w, d, h, unit: currentUnit, color });
  }

  function onOriginPresetChange() {
    const preset = document.getElementById('originPreset').value;
    document.getElementById('originCustom').style.display = preset === 'custom' ? 'block' : 'none';
  }

  function applyOrigin() {
    const preset = document.getElementById('originPreset').value;
    const w = parseFloat(document.getElementById('stockW').value) || 4;
    const d = parseFloat(document.getElementById('stockD').value) || 4;
    const h = parseFloat(document.getElementById('stockH').value) || 2;
    let xOff = 0, yOff = 0, zOff = 0;

    if (preset === 'cornerFL') {
      xOff = w / 2; yOff = d / 2; zOff = 0;
    } else if (preset === 'centerTop') {
      xOff = 0; yOff = 0; zOff = 0;
    } else if (preset === 'centerBottom') {
      xOff = 0; yOff = 0; zOff = -h;
    } else {
      xOff = parseFloat(document.getElementById('originX').value) || 0;
      yOff = parseFloat(document.getElementById('originY').value) || 0;
      zOff = parseFloat(document.getElementById('originZ').value) || 0;
    }
    vs.postMessage({ type: 'stockOrigin', preset, xOff, yOff, zOff });
  }

  function toggleLayer(layer) {
    const checked = document.getElementById('cb' + layer.charAt(0).toUpperCase() + layer.slice(1)).checked;
    vs.postMessage({ type: 'layerToggle', layer, visible: checked });
  }
</script>
</body>
</html>`;
  }
}

export function registerVisualizerSettings(context: vscode.ExtensionContext): void {
  const provider = new VisualizerSettingsProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VisualizerSettingsProvider.viewId, provider)
  );
}
