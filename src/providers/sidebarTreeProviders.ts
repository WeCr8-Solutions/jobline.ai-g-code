import * as vscode from 'vscode';
import { Tokenizer } from '../parser/tokenizer';
import { BlockParser } from '../parser/blockParser';
import { ProgramModelBuilder } from '../parser/programModel';
import { MachineType, ProgramModel, ToolUsage } from '../parser/types';
import { isGCodeFile } from '../utils/fileTypes';
import { selectPreferredGCodeDocument } from '../utils/gcodeDocumentTracker';
import { buildMacroSidebarEntries } from './visualizer/macroSidebar';
import { getAdjacentSectionIndex, getSectionLineNumbers, SidebarSection } from './sidebarNavigation';

class JobLineTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly description?: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
    lineNumber?: number
  ) {
    super(label, collapsibleState);
    this.description = description;
    if (typeof lineNumber === 'number' && lineNumber >= 0) {
      this.command = {
        command: 'jobline.goToLine',
        title: 'Go To Line',
        arguments: [lineNumber],
      };
    }
  }
}

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
    this.command = {
      command: 'jobline.tools.goToTool',
      title: 'Go To Tool',
      arguments: [this],
    };
  }
}

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

type SidebarSnapshot = {
  operations: vscode.TreeItem[];
  tools: vscode.TreeItem[];
  offsets: vscode.TreeItem[];
  cycles: vscode.TreeItem[];
  probing: vscode.TreeItem[];
  macros: vscode.TreeItem[];
  alarms: vscode.TreeItem[];
};

const tokenizer = new Tokenizer();
const blockParser = new BlockParser();
const modelBuilder = new ProgramModelBuilder();

const MACHINE_CYCLE_CATALOG: Record<MachineType, number[]> = {
  mill: [73, 81, 82, 83, 84, 85, 86, 88, 89],
  lathe: [74, 76, 81, 83, 84, 85, 86],
  'mill-turn': [73, 74, 76, 81, 82, 83, 84, 85, 86, 88, 89],
  grinder: [81, 82],
};

function isGCodeDocument(document: vscode.TextDocument | undefined): boolean {
  return !!document && isGCodeFile(document);
}

function getCurrentMachineType(): MachineType {
  const machineType = vscode.workspace.getConfiguration().get<string>('jobline.machineType', 'mill');
  if (machineType === 'lathe' || machineType === 'mill-turn' || machineType === 'grinder') {
    return machineType;
  }
  return 'mill';
}

let _lastGCodeDoc: vscode.TextDocument | undefined;
const _sectionNavigationState = new Map<string, number>();

function rememberGCodeDocument(document: vscode.TextDocument | undefined): vscode.TextDocument | undefined {
  if (document && isGCodeDocument(document)) {
    _lastGCodeDoc = document;
  }
  return _lastGCodeDoc;
}

export function getLastGCodeDoc(): vscode.TextDocument | undefined {
  const preferred = selectPreferredGCodeDocument({
    activeDocument: vscode.window.activeTextEditor?.document,
    lastDocument: _lastGCodeDoc,
    visibleDocuments: vscode.window.visibleTextEditors.map(editor => editor.document),
    openDocuments: vscode.workspace.textDocuments,
    isGCodeDocument,
  });

  return rememberGCodeDocument(preferred);
}

async function getGCodeEditor(): Promise<vscode.TextEditor | undefined> {
  const trackedDocument = getLastGCodeDoc();
  if (!trackedDocument) return undefined;
  const visible = vscode.window.visibleTextEditors.find(
    editor => editor.document.uri.toString() === trackedDocument.uri.toString()
  );
  if (visible) return visible;
  try {
    return await vscode.window.showTextDocument(trackedDocument, { preview: false, preserveFocus: false });
  } catch {
    return undefined;
  }
}

async function revealLine(lineNumber: number): Promise<void> {
  const editor = await getGCodeEditor();
  if (!editor) return;
  const pos = new vscode.Position(lineNumber, 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

function buildModelFromDocument(doc: vscode.TextDocument): ProgramModel | null {
  const text = doc.getText();
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

function buildToolDescription(tool: ToolUsage): string {
  if (tool.description) return tool.description;
  const parts: string[] = [];
  if (tool.diameter !== undefined) parts.push(`Ø${tool.diameter}`);
  if (tool.offsetH !== undefined) parts.push(`H${tool.offsetH}`);
  if (tool.offsetD !== undefined) parts.push(`D${tool.offsetD}`);
  if (tool.maxSpindleSpeed !== undefined) parts.push(`${tool.maxSpindleSpeed} RPM`);
  if (tool.feedRange !== undefined) parts.push(`F${tool.feedRange.min}–${tool.feedRange.max}`);
  return parts.length > 0 ? parts.join('  ') : `L${tool.lineNumbers[0] + 1}`;
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

function buildSnapshot(): SidebarSnapshot {
  const defaultSnapshot: SidebarSnapshot = {
    operations: [new JobLineTreeItem('Open .nc/.gcode file', 'Parse operations from active program')],
    tools: [new JobLineTreeItem('No tools parsed yet')],
    offsets: [new JobLineTreeItem('No work offsets detected')],
    cycles: [new JobLineTreeItem('No canned cycles detected', 'Open a program with G81/G83/etc.')],
    probing: [new JobLineTreeItem('No probing cycles detected', 'Open a program with G31/G38.x')],
    macros: [new JobLineTreeItem('No macro calls detected', 'Open a program with Macro B / control flow')],
    alarms: [new JobLineTreeItem('No alarms', 'Validation results will appear here')],
  };

  const doc = _lastGCodeDoc ?? vscode.window.activeTextEditor?.document;
  const model = doc && isGCodeDocument(doc) ? buildModelFromDocument(doc) : null;
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
    ? model.operations.map(operation =>
        new JobLineTreeItem(
          operation.name,
          `T${operation.toolNumber} L${operation.startLine + 1}-${operation.endLine + 1}`,
          vscode.TreeItemCollapsibleState.None,
          operation.startLine
        )
      )
    : [new JobLineTreeItem('No operations detected')];

  const validTools = model.tools.filter(tool => tool.toolNumber > 0);
  const tools: vscode.TreeItem[] = validTools.length > 0
    ? validTools.map(tool =>
        new ToolTreeItem(tool.toolNumber, tool.lineNumbers, `T${tool.toolNumber}`, buildToolDescription(tool))
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
      const description = paramSummary.length > 0 ? `L${cycle.line + 1} ${paramSummary}` : `L${cycle.line + 1}`;
      cycles.push(new JobLineTreeItem(`G${cycle.code}`, description, vscode.TreeItemCollapsibleState.None, cycle.line));
    }
  } else {
    cycles.unshift(new JobLineTreeItem('No canned cycles found in active file'));
  }

  const probing: vscode.TreeItem[] = [];
  if (model.probingInstances.length > 0) {
    for (const probe of model.probingInstances) {
      const codeName = probe.code === 31 ? 'G31' : `G${probe.code}`;
      const coords = Object.entries(probe.targetPosition)
        .filter(([, value]) => value !== undefined)
        .map(([axis, value]) => `${axis}${value}`)
        .join(' ');
      const feed = probe.feedRate !== null ? ` F${probe.feedRate}` : '';
      probing.push(new JobLineTreeItem(codeName, `L${probe.line + 1} ${coords}${feed}`, vscode.TreeItemCollapsibleState.None, probe.line));
    }
  } else {
    probing.push(new JobLineTreeItem('No probing cycles found', 'G31 / G38.2–G38.5'));
  }

  const macroEntries = buildMacroSidebarEntries(model);
  const macros = macroEntries.length > 0
    ? macroEntries.map(entry => new JobLineTreeItem(entry.label, entry.description, vscode.TreeItemCollapsibleState.None, entry.line))
    : [new JobLineTreeItem('No macro calls found', 'Macro assignments, IF/GOTO, WHILE, expressions')];

  const alarms = model.diagnostics.length > 0
    ? model.diagnostics.map(diagnostic =>
        new JobLineTreeItem(
          `[${diagnostic.severity}] L${diagnostic.line + 1}`,
          diagnostic.message,
          vscode.TreeItemCollapsibleState.None,
          diagnostic.line
        )
      )
    : [new JobLineTreeItem('No alarms', 'Validation results will appear here')];

  return { operations, tools, offsets, cycles, probing, macros, alarms };
}

export function registerSidebarTreeProviders(context: vscode.ExtensionContext): void {
  let snapshot = buildSnapshot();

  const operationsProvider = new DynamicTreeDataProvider(() => snapshot.operations);
  const toolsProvider = new DynamicTreeDataProvider(() => snapshot.tools);
  const offsetsProvider = new DynamicTreeDataProvider(() => snapshot.offsets);
  const cannedCyclesProvider = new DynamicTreeDataProvider(() => snapshot.cycles);
  const probingProvider = new DynamicTreeDataProvider(() => snapshot.probing);
  const macrosProvider = new DynamicTreeDataProvider(() => snapshot.macros);
  const alarmsProvider = new DynamicTreeDataProvider(() => snapshot.alarms);

  const refreshAll = (): void => {
    rememberGCodeDocument(getLastGCodeDoc());
    snapshot = buildSnapshot();
    operationsProvider.refresh();
    toolsProvider.refresh();
    offsetsProvider.refresh();
    cannedCyclesProvider.refresh();
    probingProvider.refresh();
    macrosProvider.refresh();
    alarmsProvider.refresh();
  };

  const goToSectionItem = async (section: SidebarSection, direction: 1 | -1): Promise<void> => {
    const doc = getLastGCodeDoc();
    if (!doc) return;
    const model = buildModelFromDocument(doc);
    if (!model) return;

    const lines = getSectionLineNumbers(model, section);
    if (lines.length === 0) {
      vscode.window.showInformationMessage(`JobLine: No ${section} entries found in this program.`);
      return;
    }

    const stateKey = `${doc.uri.toString()}:${section}`;
    const nextIndex = getAdjacentSectionIndex(_sectionNavigationState.get(stateKey), lines.length, direction);
    if (nextIndex < 0) return;

    _sectionNavigationState.set(stateKey, nextIndex);
    await revealLine(lines[nextIndex]);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('jobline.goToLine', async (lineNumber: number) => {
      await revealLine(lineNumber);
    }),
    vscode.commands.registerCommand('jobline.sidebar.prevOperation', async () => goToSectionItem('operations', -1)),
    vscode.commands.registerCommand('jobline.sidebar.nextOperation', async () => goToSectionItem('operations', 1)),
    vscode.commands.registerCommand('jobline.sidebar.prevTool', async () => goToSectionItem('tools', -1)),
    vscode.commands.registerCommand('jobline.sidebar.nextTool', async () => goToSectionItem('tools', 1)),
    vscode.commands.registerCommand('jobline.sidebar.prevCycle', async () => goToSectionItem('cycles', -1)),
    vscode.commands.registerCommand('jobline.sidebar.nextCycle', async () => goToSectionItem('cycles', 1)),
    vscode.commands.registerCommand('jobline.sidebar.prevProbe', async () => goToSectionItem('probing', -1)),
    vscode.commands.registerCommand('jobline.sidebar.nextProbe', async () => goToSectionItem('probing', 1)),
    vscode.commands.registerCommand('jobline.sidebar.prevMacro', async () => goToSectionItem('macros', -1)),
    vscode.commands.registerCommand('jobline.sidebar.nextMacro', async () => goToSectionItem('macros', 1)),
    vscode.commands.registerCommand('jobline.sidebar.prevAlarm', async () => goToSectionItem('alarms', -1)),
    vscode.commands.registerCommand('jobline.sidebar.nextAlarm', async () => goToSectionItem('alarms', 1))
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('jobline.operationsTree', operationsProvider),
    vscode.window.registerTreeDataProvider('jobline.toolsTree', toolsProvider),
    vscode.window.registerTreeDataProvider('jobline.offsetsTree', offsetsProvider),
    vscode.window.registerTreeDataProvider('jobline.cannedCyclesTree', cannedCyclesProvider),
    vscode.window.registerTreeDataProvider('jobline.probingTree', probingProvider),
    vscode.window.registerTreeDataProvider('jobline.macrosTree', macrosProvider),
    vscode.window.registerTreeDataProvider('jobline.alarmsTree', alarmsProvider),
    vscode.window.onDidChangeActiveTextEditor(editor => {
      rememberGCodeDocument(editor?.document);
      refreshAll();
    }),
    vscode.window.onDidChangeVisibleTextEditors(editors => {
      const preferred = selectPreferredGCodeDocument({
        activeDocument: vscode.window.activeTextEditor?.document,
        lastDocument: _lastGCodeDoc,
        visibleDocuments: editors.map(editor => editor.document),
        openDocuments: vscode.workspace.textDocuments,
        isGCodeDocument,
      });
      rememberGCodeDocument(preferred);
      refreshAll();
    }),
    vscode.workspace.onDidOpenTextDocument(doc => {
      rememberGCodeDocument(doc);
      if (isGCodeDocument(doc)) {
        refreshAll();
      }
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      const trackedDocument = getLastGCodeDoc();
      if (trackedDocument && event.document.uri.toString() === trackedDocument.uri.toString()) {
        refreshAll();
      }
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('jobline.controlType') || event.affectsConfiguration('jobline.machineType')) {
        refreshAll();
      }
    }),
    vscode.workspace.onDidCloseTextDocument(doc => {
      if (_lastGCodeDoc && doc.uri.toString() === _lastGCodeDoc.uri.toString()) {
        _sectionNavigationState.clear();
        _lastGCodeDoc = selectPreferredGCodeDocument({
          activeDocument: vscode.window.activeTextEditor?.document,
          visibleDocuments: vscode.window.visibleTextEditors
            .map(editor => editor.document)
            .filter(document => document.uri.toString() !== doc.uri.toString()),
          openDocuments: vscode.workspace.textDocuments.filter(document => document.uri.toString() !== doc.uri.toString()),
          excludeDocuments: [doc],
          isGCodeDocument,
        });
      }
      refreshAll();
    })
  );

  refreshAll();
}

async function goToTool(item: ToolTreeItem): Promise<void> {
  if (!item?.toolLineNumbers?.length) return;
  await revealLine(item.toolLineNumbers[0]);
}

async function removeToolChange(item: ToolTreeItem): Promise<void> {
  if (!item?.toolNumber) return;
  const editor = await getGCodeEditor();
  if (!editor) return;

  const doc = editor.document;
  const lines = doc.getText().split('\n');
  const tPattern = new RegExp(`\\bT0*${item.toolNumber}\\b`, 'i');
  const m06Pattern = /\bM0*6\b/i;

  const matchingLines: number[] = lines
    .map((line, idx) => ({ line, idx }))
    .filter(({ line }) => tPattern.test(line) && m06Pattern.test(line))
    .map(({ idx }) => idx);

  if (matchingLines.length === 0) {
    vscode.window.showInformationMessage(`JobLine: No T${item.toolNumber} M06 line found in this program.`);
    return;
  }

  const answer = await vscode.window.showWarningMessage(
    `Remove T${item.toolNumber} M06 tool change line${matchingLines.length > 1 ? 's' : ''}? (${matchingLines.length} line${matchingLines.length > 1 ? 's' : ''})`,
    { modal: true },
    'Remove'
  );
  if (answer !== 'Remove') return;

  const edit = new vscode.WorkspaceEdit();
  for (const lineIdx of [...matchingLines].reverse()) {
    const start = new vscode.Position(lineIdx, 0);
    const end = lineIdx < lines.length - 1
      ? new vscode.Position(lineIdx + 1, 0)
      : new vscode.Position(lineIdx, lines[lineIdx].length);
    edit.delete(doc.uri, new vscode.Range(start, end));
  }
  await vscode.workspace.applyEdit(edit);
}

async function addToolChange(): Promise<void> {
  const editor = await getGCodeEditor();
  if (!editor) {
    vscode.window.showWarningMessage('JobLine: Open a G-code file first.');
    return;
  }

  const toolNumStr = await vscode.window.showInputBox({
    prompt: 'Tool number to insert',
    placeHolder: 'e.g. 1',
    validateInput: value => (/^\d+$/.test(value.trim()) ? null : 'Enter a positive integer'),
  });
  if (!toolNumStr) return;

  const toolNum = parseInt(toolNumStr.trim(), 10);
  const doc = editor.document;
  const lines = doc.getText().split('\n');
  let insertLine = editor.selection.active.line;

  if (insertLine === 0 && editor.selection.isEmpty) {
    insertLine = lines.length;
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();
      if (/[Mm]30/.test(trimmed) || trimmed === '%') {
        insertLine = i;
      }
    }
  }

  const edit = new vscode.WorkspaceEdit();
  edit.insert(doc.uri, new vscode.Position(insertLine, 0), `T${toolNum} M06\n`);
  await vscode.workspace.applyEdit(edit);

  const pos = new vscode.Position(insertLine, 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

export function registerToolsCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('jobline.tools.goToTool', goToTool),
    vscode.commands.registerCommand('jobline.tools.removeToolChange', removeToolChange),
    vscode.commands.registerCommand('jobline.tools.addToolChange', addToolChange)
  );
}
