import * as vscode from 'vscode';

interface CommandItem {
  label: string;
  command: string;
  icon: string;
  description?: string;
}

const COMMANDS_TREE_ITEMS: CommandItem[] = [
  { label: 'Select Control Type', command: 'jobline.selectControl', icon: '$(circuit-board)', description: 'CNC dialect' },
  { label: 'Validate Program', command: 'jobline.validateProgram', icon: '$(shield)', description: 'Check for errors' },
  { label: 'Format G-Code', command: 'jobline.formatDocument', icon: '$(symbol-keyword)', description: 'Shift+Alt+F' },
  { label: 'Open Explainer', command: 'jobline.openExplainer', icon: '$(comment)', description: 'Plain language' },
  { label: 'Insert Line Numbers', command: 'jobline.toolbox.insertLineNumbers', icon: '$(list-ordered)', description: 'N-words' },
  { label: 'Remove Line Numbers', command: 'jobline.toolbox.removeLineNumbers', icon: '$(list-unordered)', description: 'Remove N-words' },
  { label: 'Strip Comments', command: 'jobline.toolbox.stripComments', icon: '$(comment)', description: 'Remove all comments' },
  { label: 'Uppercase G/M Codes', command: 'jobline.toolbox.uppercaseGM', icon: '$(case-sensitive)', description: 'Normalize case' },
  { label: 'Scale Feed Rates', command: 'jobline.toolbox.scaleFeedRates', icon: '$(dashboard)', description: 'Feed rate %' },
  { label: 'Scale Spindle Speeds', command: 'jobline.toolbox.scaleSpindleSpeeds', icon: '$(settings-gear)', description: 'Spindle speed %' },
  { label: 'Shift X Axis', command: 'jobline.toolbox.shiftX', icon: '$(move)', description: 'Offset X coords' },
  { label: 'Shift Y Axis', command: 'jobline.toolbox.shiftY', icon: '$(move)', description: 'Offset Y coords' },
  { label: 'Shift Z Axis', command: 'jobline.toolbox.shiftZ', icon: '$(move)', description: 'Offset Z coords' },
  { label: 'Insert Safe-Z Before TCs', command: 'jobline.toolbox.insertSafeZ', icon: '$(shield)', description: 'G91 G28 Z0.' },
  { label: 'Add Coolant On/Off', command: 'jobline.toolbox.addCoolant', icon: '$(droplet)', description: 'M08 / M09' },
  { label: 'Find Next Tool Change', command: 'jobline.toolbox.findNextToolChange', icon: '$(search)', description: 'Navigate M06' },
  { label: 'Find Next Canned Cycle', command: 'jobline.toolbox.findNextCannedCycle', icon: '$(search)', description: 'Navigate G7x/G8x' },
];

class CommandTreeItem extends vscode.TreeItem {
  constructor(item: CommandItem) {
    super(item.label, vscode.TreeItemCollapsibleState.None);
    this.description = item.description;
    this.iconPath = new vscode.ThemeIcon(item.icon.replace(/^\$\(/, '').replace(/\)$/, ''));
    this.command = { command: item.command, title: item.label };
    this.tooltip = item.label;
  }
}

class CommandsTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(_element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    return Promise.resolve(COMMANDS_TREE_ITEMS.map(item => new CommandTreeItem(item)));
  }
}

export function registerCommandsTree(context: vscode.ExtensionContext): void {
  const provider = new CommandsTreeDataProvider();
  context.subscriptions.push(vscode.window.registerTreeDataProvider('jobline.commandsTree', provider));
}