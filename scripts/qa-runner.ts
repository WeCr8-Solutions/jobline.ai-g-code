/**
 * JobLine QA Runner
 *
 * Orchestrates:
 *   1. npm compile  — TypeScript compile check
 *   2. npm test     — existing parser unit tests (56 suites)
 *   3. diagnostics  — new engine accuracy tests
 *   4. Ollama QWEN  — CNC domain review of each fixture + its diagnostics
 *   5. qa-report.md — full findings written to project root
 *
 * Run locally: npx ts-node scripts/qa-runner.ts
 * Run in Docker: docker compose -f docker-compose.qa.yml up --abort-on-container-exit
 */

import { execSync, spawnSync } from 'node:child_process';
import * as fs   from 'node:fs';
import * as path from 'node:path';
import { Tokenizer }           from '../src/parser/tokenizer';
import { BlockParser }         from '../src/parser/blockParser';
import { ProgramModelBuilder } from '../src/parser/programModel';
import {
  runDiagnosticEngine,
  DEFAULT_CONFIG,
  EngineDiagnostic,
} from '../src/diagnostics/engine';

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT        = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.join(ROOT, 'test', 'fixtures', 'diagnostics');
const SAMPLE_DIR  = path.join(ROOT, 'samples');
const REPORT_FILE = path.join(ROOT, 'qa-report.md');
const OLLAMA_URL  = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5-coder:7b';

const tokenizer    = new Tokenizer();
const blockParser  = new BlockParser();
const modelBuilder = new ProgramModelBuilder();

// ── Types ─────────────────────────────────────────────────────────────────────

interface StepResult {
  name: string;
  passed: boolean;
  output: string;
}

interface FixtureReview {
  file: string;
  diagnostics: EngineDiagnostic[];
  ollamaReview: string;
  passed: boolean;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function log(msg: string): void {
  process.stdout.write(`[QA] ${msg}\n`);
}

function runShell(cmd: string, cwd = ROOT): { ok: boolean; output: string } {
  const result = spawnSync(cmd, { shell: true, cwd, encoding: 'utf-8', timeout: 120_000 });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  return { ok: result.status === 0, output };
}

function diagnoseFile(filePath: string): EngineDiagnostic[] {
  const text   = fs.readFileSync(filePath, 'utf-8');
  const blocks = blockParser.parseDocument(tokenizer.tokenizeDocument(text));
  const model  = modelBuilder.build(blocks, 'fanuc');
  return runDiagnosticEngine(blocks, model.stateAtBlock, DEFAULT_CONFIG);
}

async function ollamaReview(ncContent: string, diags: EngineDiagnostic[]): Promise<string> {
  const prompt = `You are an expert CNC machinist and safety engineer reviewing G-code programs.

Below is a G-code NC program and the automated diagnostics that JobLine generated for it.

Your task:
1. Review whether each diagnostic is CORRECT (true positive) or INCORRECT (false positive).
2. Identify any SAFETY ISSUES the tool MISSED (false negatives).
3. Rate overall diagnostic quality for aerospace/high-value machining on a scale of 1-10.
4. Keep your response concise — one paragraph per section.

---
G-CODE PROGRAM:
\`\`\`
${ncContent.slice(0, 3000)}
\`\`\`

JOBLINE DIAGNOSTICS (${diags.length} total):
${diags.length === 0
  ? '(none — tool reported this program as clean)'
  : diags.map(d => `  Line ${d.line + 1} [${d.severity.toUpperCase()}]: ${d.message}`).join('\n')}

---
Respond with:
**TRUE POSITIVES:** (diagnostics that are correct)
**FALSE POSITIVES:** (diagnostics that are wrong)
**MISSED ISSUES:** (safety problems the tool should have caught)
**QUALITY SCORE:** X/10
**NOTES:** (anything important for aerospace/high-value machining safety)
`;

  try {
    const body = JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.1, num_predict: 600 },
    });

    const result = spawnSync('curl', [
      '-s', '-X', 'POST',
      `${OLLAMA_URL}/api/generate`,
      '-H', 'Content-Type: application/json',
      '-d', body,
    ], { encoding: 'utf-8', timeout: 120_000 });

    if (result.status !== 0) return `[Ollama unavailable: ${result.stderr}]`;

    const parsed = JSON.parse(result.stdout) as { response?: string; error?: string };
    return parsed.response ?? parsed.error ?? '[empty response]';
  } catch (e) {
    return `[Review failed: ${e instanceof Error ? e.message : String(e)}]`;
  }
}

// ── Step runners ──────────────────────────────────────────────────────────────

function stepCompile(): StepResult {
  log('Step 1: TypeScript compile check...');
  const { ok, output } = runShell('npm run compile');
  log(ok ? '  PASS' : '  FAIL');
  return { name: 'TypeScript compile', passed: ok, output };
}

function stepUnitTests(): StepResult {
  log('Step 2: Parser unit tests...');
  const { ok, output } = runShell('npm test');
  log(ok ? '  PASS' : '  FAIL');
  return { name: 'Parser unit tests (56 suites)', passed: ok, output };
}

function stepDiagnosticsTests(): StepResult {
  log('Step 3: Diagnostics engine tests...');
  const cmd = [
    'node -e "',
    "require('ts-node').register({",
    "  transpileOnly:true,",
    "  compilerOptions:{module:'commonjs',target:'ES2020',",
    "    esModuleInterop:true,resolveJsonModule:true,strict:false}",
    "});",
    "require('./test/diagnostics.test.ts');",
    '"',
  ].join('');
  const { ok, output } = runShell(cmd);
  log(ok ? '  PASS' : '  FAIL');
  return { name: 'Diagnostics engine tests', passed: ok, output };
}

async function stepOllamaReviews(): Promise<FixtureReview[]> {
  log('Step 4: Ollama QWEN domain review...');

  const ncFiles: string[] = [];

  // Diagnostic fixtures
  for (const f of fs.readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.nc'))) {
    ncFiles.push(path.join(FIXTURE_DIR, f));
  }

  // Sample programs
  for (const f of fs.readdirSync(SAMPLE_DIR).filter(f => f.endsWith('.nc'))) {
    ncFiles.push(path.join(SAMPLE_DIR, f));
  }

  const reviews: FixtureReview[] = [];

  for (const filePath of ncFiles) {
    const filename = path.relative(ROOT, filePath);
    log(`  Reviewing ${filename}...`);

    let diags: EngineDiagnostic[] = [];
    let diagError = false;
    try {
      diags = diagnoseFile(filePath);
    } catch (e) {
      diagError = true;
      log(`    Parse error: ${e}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const review  = await ollamaReview(content, diags);

    // A review "passes" if Ollama didn't find missed critical safety issues
    // (heuristic: no "FALSE NEGATIVE" or "MISSED ISSUE" with high-severity language)
    const criticalMiss = /missed.{0,80}(crash|spindle|retract|collision|rapid.into)/i.test(review);
    reviews.push({
      file: filename,
      diagnostics: diags,
      ollamaReview: review,
      passed: !diagError && !criticalMiss,
    });
  }

  return reviews;
}

// ── Report writer ─────────────────────────────────────────────────────────────

function writeReport(
  steps: StepResult[],
  reviews: FixtureReview[],
  startMs: number,
): void {
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  const allPassed = steps.every(s => s.passed) && reviews.every(r => r.passed);

  const lines: string[] = [
    '# JobLine QA Report',
    '',
    `**Date:** ${new Date().toISOString()}`,
    `**Model:** ${OLLAMA_MODEL}  **Ollama:** ${OLLAMA_URL}`,
    `**Duration:** ${elapsed}s`,
    `**Overall:** ${allPassed ? '✅ PASS' : '❌ FAIL'}`,
    '',
    '---',
    '',
    '## Build & Test Steps',
    '',
  ];

  for (const s of steps) {
    lines.push(`### ${s.passed ? '✅' : '❌'} ${s.name}`);
    lines.push('');
    lines.push('```');
    lines.push(s.output.trim().slice(0, 2000));
    lines.push('```');
    lines.push('');
  }

  lines.push('---', '', '## Ollama QWEN Domain Reviews', '');

  for (const r of reviews) {
    const errorCount   = r.diagnostics.filter(d => d.severity === 'error').length;
    const warningCount = r.diagnostics.filter(d => d.severity === 'warning').length;
    lines.push(`### ${r.passed ? '✅' : '❌'} \`${r.file}\``);
    lines.push('');
    lines.push(`**Diagnostics:** ${errorCount} error(s), ${warningCount} warning(s)`);
    if (r.diagnostics.length > 0) {
      lines.push('');
      lines.push('| Line | Severity | Message |');
      lines.push('|------|----------|---------|');
      for (const d of r.diagnostics) {
        lines.push(`| ${d.line + 1} | ${d.severity} | ${d.message} |`);
      }
    }
    lines.push('');
    lines.push('**QWEN Review:**');
    lines.push('');
    lines.push(r.ollamaReview);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push('## Summary');
  lines.push('');
  lines.push(`- Build steps: ${steps.filter(s => s.passed).length}/${steps.length} passed`);
  lines.push(`- NC file reviews: ${reviews.filter(r => r.passed).length}/${reviews.length} passed`);
  lines.push(`- Total elapsed: ${elapsed}s`);

  fs.writeFileSync(REPORT_FILE, lines.join('\n'), 'utf-8');
  log(`\nReport written to: ${REPORT_FILE}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const start = Date.now();
  log(`JobLine QA Runner — ${new Date().toISOString()}`);
  log(`Ollama: ${OLLAMA_URL}  Model: ${OLLAMA_MODEL}`);
  log('');

  const steps: StepResult[] = [
    stepCompile(),
    stepUnitTests(),
    stepDiagnosticsTests(),
  ];

  const reviews = await stepOllamaReviews();

  writeReport(steps, reviews, start);

  const allPassed = steps.every(s => s.passed) && reviews.every(r => r.passed);
  log(allPassed ? '\n✅ QA PASSED' : '\n❌ QA FAILED — see qa-report.md for details');
  process.exit(allPassed ? 0 : 1);
}

main().catch(e => {
  console.error('[QA] Fatal:', e);
  process.exit(1);
});
