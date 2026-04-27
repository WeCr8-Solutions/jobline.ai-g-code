import type { ProgramModel } from '../parser/types';
import { buildMacroSidebarEntries } from './visualizer/macroSidebar';

export type SidebarSection = 'operations' | 'tools' | 'cycles' | 'probing' | 'macros' | 'alarms';

function uniqueSorted(lines: number[]): number[] {
  return Array.from(new Set(lines)).sort((left, right) => left - right);
}

export function getSectionLineNumbers(model: ProgramModel, section: SidebarSection): number[] {
  switch (section) {
    case 'operations':
      return uniqueSorted(model.operations.map(operation => operation.startLine));
    case 'tools':
      return uniqueSorted(model.tools.flatMap(tool => tool.lineNumbers));
    case 'cycles':
      return uniqueSorted(model.cannedCycles.flatMap(cycle => [cycle.line, ...cycle.repeatLines]));
    case 'probing':
      return uniqueSorted(model.probingInstances.map(instance => instance.line));
    case 'macros':
      return uniqueSorted(buildMacroSidebarEntries(model).map(entry => entry.line));
    case 'alarms':
      return uniqueSorted(model.diagnostics.map(diagnostic => diagnostic.line));
  }
}

export function getAdjacentSectionIndex(currentIndex: number | undefined, total: number, direction: 1 | -1): number {
  if (total <= 0) {
    return -1;
  }

  if (currentIndex === undefined || currentIndex < 0 || currentIndex >= total) {
    return direction > 0 ? 0 : total - 1;
  }

  const nextIndex = currentIndex + direction;
  if (nextIndex < 0) {
    return total - 1;
  }
  if (nextIndex >= total) {
    return 0;
  }
  return nextIndex;
}