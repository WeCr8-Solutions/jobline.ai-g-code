import * as vscode from 'vscode';
import { Tokenizer } from '../parser/tokenizer';
import { BlockParser } from '../parser/blockParser';
import { ProgramModelBuilder } from '../parser/programModel';
import { MachineType, ProgramModel } from '../parser/types';

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

class DynamicTreeDataProvider implements vscode.TreeDataProvider<JobLineTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<JobLineTreeItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly itemsFactory: () => JobLineTreeItem[]) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: JobLineTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(_element?: JobLineTreeItem): Thenable<JobLineTreeItem[]> {
    return Promise.resolve(this.itemsFactory());
  }
}

type SidebarSnapshot = {
  operations: JobLineTreeItem[];
  tools: JobLineTreeItem[];
  offsets: JobLineTreeItem[];
  cycles: JobLineTreeItem[];
  alarms: JobLineTreeItem[];
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

  try {
    const controlType = vscode.workspace.getConfiguration().get<string>('jobline.controlType', 'fanuc');
    const tokenized = tokenizer.tokenizeDocument(editor!.document.getText());
    const blocks = blockParser.parseDocument(tokenized);
    return modelBuilder.build(blocks, controlType);
  } catch (error) {
    console.error('JobLine sidebar parse failed:', error);
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

function buildSnapshot(): SidebarSnapshot {
  const defaultSnapshot: SidebarSnapshot = {
    operations: [new JobLineTreeItem('Open .nc/.gcode file', 'Parse operations from active program')],
    tools: [new JobLineTreeItem('No tools parsed yet')],
    offsets: [new JobLineTreeItem('No work offsets detected')],
    cycles: [new JobLineTreeItem('No canned cycles detected', 'Open a program with G81/G83/etc.')],
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

  const tools = model.tools.length > 0
    ? model.tools.map(t => new JobLineTreeItem(`T${t.toolNumber}`, t.description ?? 'Tool usage detected'))
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

  const alarms = model.diagnostics.length > 0
    ? model.diagnostics.map(d => new JobLineTreeItem(`[${d.severity}] L${d.line + 1}`, d.message))
    : [new JobLineTreeItem('No alarms', 'Validation results will appear here')];

  return { operations, tools, offsets, cycles, alarms };
}

export function registerSidebarTreeProviders(context: vscode.ExtensionContext): void {
  let snapshot = buildSnapshot();

  const operationsProvider = new DynamicTreeDataProvider(() => snapshot.operations);
  const toolsProvider = new DynamicTreeDataProvider(() => snapshot.tools);
  const offsetsProvider = new DynamicTreeDataProvider(() => snapshot.offsets);
  const cannedCyclesProvider = new DynamicTreeDataProvider(() => snapshot.cycles);
  const alarmsProvider = new DynamicTreeDataProvider(() => snapshot.alarms);

  const refreshAll = (): void => {
    snapshot = buildSnapshot();
    operationsProvider.refresh();
    toolsProvider.refresh();
    offsetsProvider.refresh();
    cannedCyclesProvider.refresh();
    alarmsProvider.refresh();
  };

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('jobline.operationsTree', operationsProvider),
    vscode.window.registerTreeDataProvider('jobline.toolsTree', toolsProvider),
    vscode.window.registerTreeDataProvider('jobline.offsetsTree', offsetsProvider),
    vscode.window.registerTreeDataProvider('jobline.cannedCyclesTree', cannedCyclesProvider),
    vscode.window.registerTreeDataProvider('jobline.alarmsTree', alarmsProvider),
    vscode.window.onDidChangeActiveTextEditor(() => refreshAll()),
    vscode.workspace.onDidChangeTextDocument(event => {
      if (vscode.window.activeTextEditor && event.document.uri.toString() === vscode.window.activeTextEditor.document.uri.toString()) {
        refreshAll();
      }
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('jobline.controlType') || event.affectsConfiguration('jobline.machineType')) {
        refreshAll();
      }
    })
  );

  refreshAll();
}
