import { BlockParser } from '../../parser/blockParser';
import { ProgramModelBuilder } from '../../parser/programModel';
import { Tokenizer } from '../../parser/tokenizer';
import { DEFAULT_CONFIG, runDiagnosticEngine, type DiagnosticSeverity } from '../../diagnostics/engine';
import { tapDrillFor } from '../../reference/shopReference';
import type { ToolUsage } from '../../parser/types';

export interface ProgramReviewFinding {
  id: string;
  line: number;
  severity: DiagnosticSeverity;
  category: 'syntax' | 'safety' | 'setup' | 'simulation';
  message: string;
  suggestion?: string;
}

export interface ProgramReview {
  findings: ProgramReviewFinding[];
  summary: { errors: number; warnings: number; infos: number };
}

const tokenizer = new Tokenizer();
const blockParser = new BlockParser();
const modelBuilder = new ProgramModelBuilder();

function executableText(text: string): string {
  return text
    .replace(/\([^)]*\)/g, ' ')
    .replace(/;[^\r\n]*/g, ' ')
    .toUpperCase();
}

function advisory(id: string, message: string, suggestion: string): ProgramReviewFinding {
  return { id, line: 0, severity: 'warning', category: 'setup', message, suggestion };
}

/** How close a drill must be to the reference tap drill, per program unit. */
const TAP_DRILL_TOLERANCE = { in: 0.003, mm: 0.08 } as const;

/**
 * A tap whose comment names its thread ("1/4-20 TAP") needs a hole drilled at
 * the tap drill size. The sizes come from the JobLine shop reference shared
 * with the shop app's tap drill chart and CAM, so all three agree.
 */
export function tapDrillFindings(tools: ToolUsage[], units: 'in' | 'mm'): ProgramReviewFinding[] {
  const findings: ProgramReviewFinding[] = [];
  const drills = tools.filter(tool => tool.diameter && !/\btap\b/i.test(tool.description ?? ''));
  for (const tap of tools) {
    if (!/\btap\b/i.test(tap.description ?? '')) continue;
    const row = tapDrillFor(tap.description ?? '');
    if (!row) continue;
    const toProgram = (value: number) => (row.units === units ? value : row.units === 'in' ? value * 25.4 : value / 25.4);
    const wanted = [row.tapDrill75Dec, row.tapDrill50Dec, row.stiTapDrillDec].map(toProgram);
    const matched = drills.some(drill => wanted.some(size => Math.abs((drill.diameter ?? 0) - size) <= TAP_DRILL_TOLERANCE[units]));
    if (matched) continue;
    const digits = units === 'in' ? 4 : 2;
    findings.push({
      id: `tap-drill-missing-T${tap.toolNumber}`,
      line: tap.lineNumbers[0] ?? 0,
      severity: 'info',
      category: 'setup',
      message: `T${tap.toolNumber} taps ${row.thread}, but no tool in this program drills its tap drill: ${row.tapDrill75} (${toProgram(row.tapDrill75Dec).toFixed(digits)}) for 75% thread or ${row.tapDrill50} (${toProgram(row.tapDrill50Dec).toFixed(digits)}) for 50%.`,
      suggestion: 'Check that the hole is drilled in an earlier operation, or that the drill comment states its size.',
    });
  }
  return findings;
}

export function reviewGCodeProgram(gcode: string, dialect = 'fanuc'): ProgramReview {
  const blocks = blockParser.parseDocument(tokenizer.tokenizeDocument(gcode));
  const model = modelBuilder.build(blocks, dialect);
  const findings: ProgramReviewFinding[] = runDiagnosticEngine(blocks, model.stateAtBlock, {
    ...DEFAULT_CONFIG,
    controlType: dialect,
  }).map((diagnostic, index) => ({
    id: `diagnostic-${diagnostic.line}-${index}`,
    line: diagnostic.line,
    severity: diagnostic.severity,
    category: diagnostic.severity === 'error' ? 'syntax' : 'safety',
    message: diagnostic.message,
  }));

  const code = executableText(gcode);
  if (!/G0*(20|21)(?=[A-Z+\-\s]|$)/.test(code)) {
    findings.push(advisory('missing-units', 'No explicit unit mode found (G20/G21).', 'Add G20 for inch or G21 for metric near the safety start block.'));
  }
  // The next three are MILL conventions. Raising them against a turn center
  // told the operator a perfectly correct lathe program was deficient, three
  // times over, which is worse than saying nothing - especially to someone
  // learning the language from what this panel reports.
  //
  //   G90/G91  - on a Fanuc lathe G90 is a turning CYCLE, not absolute mode.
  //              Absolute and incremental are X/Z versus U/W there.
  //   G17/G18/G19 - a 2-axis turn center works in ZX by definition. There is no
  //              plane to declare.
  //   G54-G59  - lathes commonly carry the offset on the T word (T0101 is tool 1,
  //              offset 1) or set the datum with G50, so no G54 is expected.
  const isTurning = /lathe|turn/i.test(model.detectedMachineType) ||
    dialect === 'okuma' || dialect.includes('lathe');

  if (!isTurning) {
    if (!/G0*(90|91)(?=[A-Z+\-\s]|$)/.test(code)) {
      findings.push(advisory('missing-distance-mode', 'No explicit distance mode found (G90/G91).', 'Declare G90 or G91 before the first positioning move.'));
    }
    if (!/G0*(17|18|19)(?=[A-Z+\-\s]|$)/.test(code)) {
      findings.push(advisory('missing-plane', 'No explicit working plane found (G17/G18/G19).', 'Declare the intended plane before arcs or canned cycles.'));
    }
    if (!/G(?:5[4-9]|54\.1)(?=[A-Z+\-\s]|$)/.test(code)) {
      findings.push(advisory('missing-work-offset', 'No work coordinate system selection found (G54-G59/G54.1).', 'Select the verified work offset before cutting.'));
    }
  } else if (!/G0*50(?=[A-Z+\-\s]|$)/.test(code) && !/\bT\d{4}\b/.test(code)) {
    // The turning equivalent: the datum has to come from somewhere.
    findings.push(advisory(
      'missing-turning-datum',
      'No turning work datum found (no G50 and no four-digit T word).',
      'Set the datum with G50, or call the tool with its offset register such as T0101.'
    ));
  }
  if (!/M0*(2|30)(?=[A-Z+\-\s%]|$)/.test(code)) {
    findings.push(advisory('missing-program-end', 'No explicit program end found (M02/M30).', 'Add the control-appropriate program end after spindle and coolant shutdown.'));
  }

  findings.push(...tapDrillFindings(model.tools, /G0*21(?=[A-Z+\-\s]|$)/.test(code) ? 'mm' : 'in'));

  // Comments are text, not code: a "#7 drill" in one is not a macro variable.
  const codeOnly = (line: string) => line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '');
  const macroLine = gcode.split(/\r?\n/).findIndex(line => /#\d+|\b(?:WHILE|IF|GOTO)\b/i.test(codeOnly(line)));
  if (macroLine >= 0) {
    findings.push({
      id: 'simulation-macro-approximation',
      line: macroLine,
      severity: 'info',
      category: 'simulation',
      message: 'Macro or conditional flow detected; the displayed path may be incomplete.',
      suggestion: 'Verify resolved variables and loop execution at the control before release.',
    });
  }

  findings.sort((a, b) => a.line - b.line || a.severity.localeCompare(b.severity));
  return {
    findings,
    summary: {
      errors: findings.filter(finding => finding.severity === 'error').length,
      warnings: findings.filter(finding => finding.severity === 'warning').length,
      infos: findings.filter(finding => finding.severity === 'info').length,
    },
  };
}
