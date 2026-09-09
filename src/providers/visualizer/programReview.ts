import { BlockParser } from '../../parser/blockParser';
import { ProgramModelBuilder } from '../../parser/programModel';
import { Tokenizer } from '../../parser/tokenizer';
import { DEFAULT_CONFIG, runDiagnosticEngine, type DiagnosticSeverity } from '../../diagnostics/engine';

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

  const macroLine = gcode.split(/\r?\n/).findIndex(line => /#\d+|\b(?:WHILE|IF|GOTO)\b/i.test(line));
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
