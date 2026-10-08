/**
 * "Machine Setup" sidebar view: the machine the open programs are evaluated
 * against, and every preset available to switch to.
 */

import * as vscode from 'vscode';
import { CONTROL_LABELS, JobLineMachinePreset, describeMachinePreset } from '../presets/jblMachine';
import { PRESET_SOURCE_LABELS, PRESET_SOURCE_ORDER, PresetEntry, PresetSource, presetOverrides } from '../presets/presetLibrary';
import { MachinePresetStore } from '../presets/presetStore';

type Node =
  | { kind: 'active' }
  | { kind: 'detail'; label: string; value: string; icon: string; tooltip?: string }
  | { kind: 'group'; source: PresetSource }
  | { kind: 'preset'; entry: PresetEntry }
  | { kind: 'problems' }
  | { kind: 'problem'; filePath: string; error: string };

/** Tree item for a preset. Commands receive it and read `entry`. */
export class PresetTreeItem extends vscode.TreeItem {
  constructor(public readonly entry: PresetEntry, active: boolean, isDefault: boolean) {
    super(entry.preset.name, vscode.TreeItemCollapsibleState.None);
    const tags = [active ? 'active' : '', isDefault ? 'default' : ''].filter(Boolean).join(', ');
    this.description = tags ? `${tags} · ${describeMachinePreset(entry.preset)}` : describeMachinePreset(entry.preset);
    this.iconPath = new vscode.ThemeIcon(active ? 'pass-filled' : isDefault ? 'star-full' : 'server-process');
    this.contextValue = entry.filePath ? 'presetItem.file' : 'presetItem.builtin';
    this.tooltip = presetTooltip(entry);
    this.command = active ? undefined : { command: 'jobline.presets.apply', title: 'Use This Machine', arguments: [this] };
  }
}

function formatAxes(preset: JobLineMachinePreset): string {
  const unit = preset.units === 'metric' ? 'mm' : 'in';
  return preset.axes
    .map(axis => /[ABC]/.test(axis.name)
      ? `${axis.name} ${axis.min}…${axis.max}°`
      : `${axis.name} ${+(axis.max - axis.min).toFixed(3)}`)
    .join('  ') + (preset.axes.some(axis => /[XYZ]/.test(axis.name)) ? ` ${unit}` : '');
}

function capabilityList(preset: JobLineMachinePreset): string {
  const caps = preset.capabilities;
  return [
    caps.fiveAxisSimultaneous ? '5-axis simultaneous' : caps.fourthAxis ? '4th axis' : '',
    caps.liveTooling ? 'live tooling' : '',
    caps.yAxisTurn ? 'Y-axis turning' : '',
    caps.subSpindle ? 'sub-spindle' : '',
    caps.probing ? 'probing' : '',
    caps.throughSpindleCoolant ? 'TSC' : '',
    caps.barFeeder ? 'bar feeder' : '',
  ].filter(Boolean).join(', ');
}

function presetTooltip(entry: PresetEntry): vscode.MarkdownString {
  const preset = entry.preset;
  const lines = [
    `**${preset.name}**`,
    '',
    `- Control: ${CONTROL_LABELS[preset.control.family]}${preset.control.model ? ` ${preset.control.model}` : ''}`,
    `- Machine: ${preset.machineKind} (${preset.machineClass})`,
    `- Units: ${preset.units}`,
  ];
  if (preset.axes.length) lines.push(`- Travel: ${formatAxes(preset)}`);
  if (preset.spindleMaxRpm) lines.push(`- Spindle: ${preset.spindleMaxRpm} rpm max`);
  const caps = capabilityList(preset);
  if (caps) lines.push(`- Options: ${caps}`);
  if (preset.postProcessor) lines.push(`- Post: ${preset.postProcessor}`);
  lines.push('', `_${PRESET_SOURCE_LABELS[entry.source]}${entry.filePath ? ` — ${entry.filePath}` : ''}_`);
  const md = new vscode.MarkdownString(lines.join('\n'));
  md.supportThemeIcons = true;
  return md;
}

class MachineSetupTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly store: MachinePresetStore) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      const roots: Node[] = [{ kind: 'active' }];
      for (const source of PRESET_SOURCE_ORDER) {
        if (this.store.list().some(entry => entry.source === source)) roots.push({ kind: 'group', source });
      }
      if (this.store.loadProblems().length) roots.push({ kind: 'problems' });
      return roots;
    }
    if (node.kind === 'active') return this.activeDetails();
    if (node.kind === 'group') {
      return this.store.list().filter(entry => entry.source === node.source).map(entry => ({ kind: 'preset', entry }));
    }
    if (node.kind === 'problems') {
      return this.store.loadProblems().map(problem => ({ kind: 'problem', ...problem }));
    }
    return [];
  }

  private activeDetails(): Node[] {
    const active = this.store.active();
    const current = this.store.currentSettings();
    if (!active) {
      return [
        { kind: 'detail', label: 'Control', value: CONTROL_LABELS[current.controlType ?? 'fanuc'] ?? String(current.controlType), icon: 'circuit-board' },
        { kind: 'detail', label: 'Machine', value: current.detectedMachineType || String(current.machineType ?? 'mill'), icon: 'vm' },
        { kind: 'detail', label: 'Units', value: String(current.units ?? 'inch'), icon: 'symbol-ruler' },
      ];
    }
    const preset = active.preset;
    const overridden = new Set(presetOverrides(preset, current));
    const mark = (key: string, value: string): string => overridden.has(key as never) ? `${value} — overridden in settings` : value;
    const nodes: Node[] = [
      {
        kind: 'detail', label: 'Control', icon: 'circuit-board',
        value: mark('controlType', `${CONTROL_LABELS[preset.control.family]}${preset.control.model ? ` ${preset.control.model}` : ''}`),
      },
      { kind: 'detail', label: 'Machine', value: mark('detectedMachineType', preset.machineKind), icon: 'vm' },
      { kind: 'detail', label: 'Units', value: mark('units', preset.units), icon: 'symbol-ruler' },
      { kind: 'detail', label: 'Workholding', value: preset.workholding, icon: 'lock' },
    ];
    if (preset.axes.length) nodes.push({ kind: 'detail', label: 'Travel', value: formatAxes(preset), icon: 'move' });
    if (preset.spindleMaxRpm) nodes.push({ kind: 'detail', label: 'Spindle', value: `${preset.spindleMaxRpm} rpm`, icon: 'sync' });
    const caps = capabilityList(preset);
    if (caps) nodes.push({ kind: 'detail', label: 'Options', value: caps, icon: 'extensions' });
    nodes.push({
      kind: 'detail', label: 'Source', icon: 'file',
      value: PRESET_SOURCE_LABELS[active.source], tooltip: active.filePath,
    });
    return nodes;
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case 'active': {
        const active = this.store.active();
        const item = new vscode.TreeItem(
          active ? active.preset.name : 'No machine preset',
          vscode.TreeItemCollapsibleState.Expanded,
        );
        item.description = active
          ? (this.store.defaultId() === active.preset.id ? 'default' : 'this workspace')
          : 'using individual settings — click to choose';
        item.iconPath = new vscode.ThemeIcon(active ? 'pass-filled' : 'circle-large-outline');
        item.contextValue = active ? 'activePreset' : 'noActivePreset';
        item.command = { command: 'jobline.presets.switch', title: 'Switch Machine' };
        if (active) item.tooltip = presetTooltip(active);
        return item;
      }
      case 'detail': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.description = node.value;
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.tooltip = node.tooltip ?? `${node.label}: ${node.value}`;
        return item;
      }
      case 'group': {
        const count = this.store.list().filter(entry => entry.source === node.source).length;
        const item = new vscode.TreeItem(
          PRESET_SOURCE_LABELS[node.source],
          node.source === 'builtin' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded,
        );
        item.description = String(count);
        item.iconPath = new vscode.ThemeIcon(
          node.source === 'workspace' ? 'folder' : node.source === 'shared' ? 'organization' : node.source === 'library' ? 'home' : 'library',
        );
        item.contextValue = `presetGroup.${node.source}`;
        return item;
      }
      case 'preset':
        return new PresetTreeItem(node.entry, node.entry.preset.id === this.store.activeId(), node.entry.preset.id === this.store.defaultId());
      case 'problems': {
        const item = new vscode.TreeItem('Unreadable preset files', vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon('warning');
        item.description = String(this.store.loadProblems().length);
        return item;
      }
      case 'problem': {
        const item = new vscode.TreeItem(node.filePath.split(/[\\/]/).pop() ?? node.filePath, vscode.TreeItemCollapsibleState.None);
        item.description = node.error;
        item.tooltip = `${node.filePath}\n${node.error}`;
        item.iconPath = new vscode.ThemeIcon('error');
        item.command = { command: 'vscode.open', title: 'Open File', arguments: [vscode.Uri.file(node.filePath)] };
        return item;
      }
    }
  }
}

export function registerMachineSetupTree(context: vscode.ExtensionContext, store: MachinePresetStore): void {
  const provider = new MachineSetupTreeProvider(store);
  const view = vscode.window.createTreeView('jobline.machineSetupTree', { treeDataProvider: provider, showCollapseAll: true });
  const updateBadge = (): void => {
    const active = store.active();
    view.description = active ? active.preset.name : undefined;
  };
  updateBadge();
  context.subscriptions.push(
    view,
    store.onDidChange(() => {
      provider.refresh();
      updateBadge();
    }),
  );
}
