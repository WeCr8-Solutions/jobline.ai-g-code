import * as vscode from 'vscode';
import { Tokenizer } from '../parser/tokenizer';
import { BlockParser } from '../parser/blockParser';
import { ProgramModelBuilder } from '../parser/programModel';
import { MachineType, ProgramModel, ToolUsage } from '../parser/types';

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
