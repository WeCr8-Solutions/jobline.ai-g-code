#!/usr/bin/env node
/* eslint-env node */
/* global __dirname, process, console */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { BlockParser } from '../src/parser/blockParser';
import { Tokenizer } from '../src/parser/tokenizer';
import { DEFAULT_CONFIG, runDiagnosticEngine, type EngineDiagnostic } from '../src/diagnostics/engine';
import { buildVisualizerHarnessData, type VisualizerHarnessManifest } from '../src/providers/visualizer/fixtureHarness';
import { extractGCodeCutBounds, compareBounds, type BoundsComparisonResult, type GCodeEnvelope } from '../src/providers/visualizer/gcodeGoalComparison';
import { parseParasolidText } from '../src/providers/visualizer/parasolidTextParser';
import { parseSTL } from '../src/providers/visualizer/stlParser';

const ROOT = path.resolve(__dirname, '..');
const REVPACK_DIR = path.join(ROOT, 'test', 'fixtures', 'revpack');
const REPORT_PATH = path.join(ROOT, 'visual-qa-report.md');
const RESULT_PATH = path.join(REVPACK_DIR, 'revpack.visual-verification.json');
const tokenizer = new Tokenizer();
const blockParser = new BlockParser();

interface GoalModelVerification {
  label: string;
  path: string;
  format: 'parasolid-text' | 'stl';
  present: boolean;
  comparison: BoundsComparisonResult | null;
}

interface DiagnosticSummary {
  total: number;
  errors: number;
  warnings: number;
  infos: number;
  highestSeverity: 'error' | 'warning' | 'info' | 'none';
}

interface ReportInput {
  manifest: VisualizerHarnessManifest;
  gcodeEnvelope: GCodeEnvelope;
  toolCount: number;
  machineType: string;
  workOffsets: string[];
  goalModels: GoalModelVerification[];
  diagnostics: EngineDiagnostic[];
  diagnosticSummary: DiagnosticSummary;
}

function readArrayBuffer(filePath: string): ArrayBufferLike {
  const buffer = fs.readFileSync(filePath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function loadGoalModelVerifications(
  manifest: VisualizerHarnessManifest,
  gcodeEnvelope: GCodeEnvelope,
  tolerance: number
): GoalModelVerification[] {
  const models: GoalModelVerification[] = [];
  const xTPath = path.join(REVPACK_DIR, manifest.goalModels.parasolidText);
  if (fs.existsSync(xTPath)) {
    const bounds = parseParasolidText(fs.readFileSync(xTPath, 'utf8')).bounds;
    models.push({
      label: 'Goal model (.x_t bounds)',
      path: path.relative(ROOT, xTPath),
      format: 'parasolid-text',
      present: true,
      comparison: compareBounds(gcodeEnvelope.bounds, bounds, tolerance),
    });
  } else {
    models.push({
      label: 'Goal model (.x_t bounds)',
      path: path.relative(ROOT, xTPath),
      format: 'parasolid-text',
      present: false,
      comparison: null,
    });
  }

  if (manifest.goalModels.stl) {
    const stlPath = path.join(REVPACK_DIR, manifest.goalModels.stl);
    if (fs.existsSync(stlPath)) {
      const bounds = parseSTL(readArrayBuffer(stlPath)).bounds;
      models.push({
        label: 'Goal model (.stl bounds)',
        path: path.relative(ROOT, stlPath),
        format: 'stl',
        present: true,
        comparison: compareBounds(gcodeEnvelope.bounds, bounds, tolerance),
      });
    } else {
      models.push({
        label: 'Goal model (.stl bounds)',
        path: path.relative(ROOT, stlPath),
        format: 'stl',
        present: false,
        comparison: null,
      });
    }
  }

  return models;
}

function summarizeDiagnostics(diagnostics: EngineDiagnostic[]): DiagnosticSummary {
  const errors = diagnostics.filter(diagnostic => diagnostic.severity === 'error').length;
  const warnings = diagnostics.filter(diagnostic => diagnostic.severity === 'warning').length;
  const infos = diagnostics.filter(diagnostic => diagnostic.severity === 'info').length;

  return {
    total: diagnostics.length,
    errors,
    warnings,
    infos,
    highestSeverity: errors > 0 ? 'error' : warnings > 0 ? 'warning' : infos > 0 ? 'info' : 'none',
  };
}

function writeReport(reportInput: ReportInput): void {
  const {
    manifest: currentManifest,
    gcodeEnvelope: currentEnvelope,
    toolCount: currentToolCount,
    machineType: currentMachineType,
    workOffsets: currentWorkOffsets,
    goalModels: currentGoalModels,
    diagnostics: currentDiagnostics,
    diagnosticSummary: currentDiagnosticSummary,
  } = reportInput;
  const resultLines = currentGoalModels.map(model => {
    if (!model.present) {
      return `- ${model.label}: missing (${model.path})`;
    }
    return `- ${model.label}: ${model.comparison?.matches ? 'PASS' : 'FAIL'} (${model.path})`;
  }).join('\n');

  const diagnosticLines = currentDiagnostics.length > 0
    ? currentDiagnostics.slice(0, 10).map(diagnostic =>
        `- [${diagnostic.severity.toUpperCase()}] L${diagnostic.line + 1}: ${diagnostic.message}`
      ).join('\n')
    : '- No safety or validation diagnostics emitted for this run';

  const report = `# Operator Verification Report

**Date:** ${new Date().toISOString()}

## Fixture
- Program: ${currentManifest.name}
- G-code: test/fixtures/revpack/${currentManifest.gcode}
- Fixture mode: none
- Machine type: ${currentMachineType}
- Work offsets: ${currentWorkOffsets.join(', ') || '(none)'}
- Tools extracted: ${currentToolCount}
- Goal models: ${currentGoalModels.map(model => model.label).join(', ') || 'none'}
- G-code units: ${currentEnvelope.units}
- Cut moves: ${currentEnvelope.cutMoveCount}
- Diagnostic severity: ${currentDiagnosticSummary.highestSeverity}
- Diagnostics: ${currentDiagnosticSummary.total} total (${currentDiagnosticSummary.errors} error, ${currentDiagnosticSummary.warnings} warning, ${currentDiagnosticSummary.infos} info)

## Output
- Verification artifact: ${path.relative(ROOT, RESULT_PATH)}

## Result
- Solid-model verification completed against available goal models.
${resultLines}

## Operator Risk Summary
${diagnosticLines}
`;

  fs.writeFileSync(REPORT_PATH, report, 'utf8');
}

async function runVisualTestRunner(): Promise<number> {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(REVPACK_DIR, 'revpack.visualizer-harness.json'), 'utf8')
  ) as VisualizerHarnessManifest;
  const gcodePath = path.join(REVPACK_DIR, manifest.gcode);
  const gcode = fs.readFileSync(gcodePath, 'utf8');
  const harness = buildVisualizerHarnessData(gcode, manifest.dialect);
  const blocks = blockParser.parseDocument(tokenizer.tokenizeDocument(gcode));
  const diagnostics = runDiagnosticEngine(blocks, harness.model.stateAtBlock, {
    ...DEFAULT_CONFIG,
    controlType: manifest.dialect,
  });
  const diagnosticSummary = summarizeDiagnostics(diagnostics);
  const gcodeEnvelope = extractGCodeCutBounds(gcode);
  const goalModels = loadGoalModelVerifications(manifest, gcodeEnvelope, 0.01);

  const verification = {
    manifest,
    setup: harness.setup,
    tools: harness.tools,
    gcodeEnvelope,
    diagnosticSummary,
    diagnostics,
    goalModels,
  };
  fs.writeFileSync(RESULT_PATH, JSON.stringify(verification, null, 2), 'utf8');

  writeReport({
    manifest,
    gcodeEnvelope,
    toolCount: harness.tools.length,
    machineType: harness.setup.machineType,
    workOffsets: harness.setup.workOffsets,
    goalModels,
    diagnostics,
    diagnosticSummary,
  });

  console.log(`Verification artifact: ${path.relative(ROOT, RESULT_PATH)}`);
  console.log(`Operator report: ${path.relative(ROOT, REPORT_PATH)}`);
  console.log(`Tools extracted: ${harness.tools.length}`);
  console.log(`Goal models checked: ${goalModels.filter(model => model.present).length}`);
  console.log(`Diagnostics: ${diagnosticSummary.total} (${diagnosticSummary.errors} error, ${diagnosticSummary.warnings} warning, ${diagnosticSummary.infos} info)`);

  return 0;
}

if (require.main === module) {
  runVisualTestRunner().then(code => process.exit(code));
}

export { runVisualTestRunner };
