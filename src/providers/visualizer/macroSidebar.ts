import type { ProgramModel, GCodeBlock } from '../../parser/types';

export interface MacroSidebarEntry {
  label: string;
  description: string;
  line: number;
}

function formatControlFlow(block: GCodeBlock): string {
  if (!block.controlFlow) {
    return '';
  }

  const target = block.controlFlow.target !== undefined ? ` N${block.controlFlow.target}` : '';
  const condition = block.controlFlow.condition ? ` ${block.controlFlow.condition}` : '';
  return `${block.controlFlow.type}${target}${condition}`.trim();
}

function parseRawMacroFlow(block: GCodeBlock): { label: string; detail: string } | null {
  const raw = block.raw.trim();
  if (!raw) {
    return null;
  }

  const ifMatch = raw.match(/^IF\s*(\[[^\]]+\])(?:\s+GOTO\s*(\d+))?/i);
  if (ifMatch) {
    const target = ifMatch[2] ? ` GOTO N${ifMatch[2]}` : '';
    return {
      label: 'IF',
      detail: `IF ${ifMatch[1]}${target}`,
    };
  }

  const whileMatch = raw.match(/^WHILE\s*(\[[^\]]+\])/i);
  if (whileMatch) {
    return {
      label: 'WHILE',
      detail: `WHILE ${whileMatch[1]}`,
    };
  }

  const endMatch = raw.match(/^END\d*/i);
  if (endMatch) {
    return {
      label: 'END',
      detail: endMatch[0].toUpperCase(),
    };
  }

  const gotoMatch = raw.match(/^GOTO\s*(\d+)/i);
  if (gotoMatch) {
    return {
      label: 'GOTO',
      detail: `GOTO N${gotoMatch[1]}`,
    };
  }

  return null;
}

export function buildMacroSidebarEntries(model: ProgramModel): MacroSidebarEntry[] {
  const entries: MacroSidebarEntry[] = [];

  for (const block of model.blocks) {
    if (block.macroAssignment) {
      entries.push({
        label: `#${block.macroAssignment.variableNum}`,
        description: `L${block.line + 1} assignment`,
        line: block.line,
      });
    }

    const rawMacroFlow = parseRawMacroFlow(block);

    if (rawMacroFlow) {
      entries.push({
        label: rawMacroFlow.label,
        description: `L${block.line + 1} ${rawMacroFlow.detail}`,
        line: block.line,
      });
    } else if (block.controlFlow) {
      entries.push({
        label: block.controlFlow.type,
        description: `L${block.line + 1} ${formatControlFlow(block)}`,
        line: block.line,
      });
    }

    if (block.hasMacroExpressions && !block.macroAssignment && !block.controlFlow) {
      entries.push({
        label: 'Macro Expression',
        description: `L${block.line + 1} runtime-evaluated address`,
        line: block.line,
      });
    }
  }

  return entries;
}