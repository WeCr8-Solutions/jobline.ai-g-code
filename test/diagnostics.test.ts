/**
 * JobLine Diagnostics Engine — Accuracy Tests
 *
 * Tests the pure engine (src/diagnostics/engine.ts) against isolated fixture
 * files. Each fixture exercises exactly ONE rule so failures are unambiguous.
 *
 * Run: npm test (uses the same ts-node runner as parser.test.ts)
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Tokenizer }           from '../src/parser/tokenizer';
import { BlockParser }         from '../src/parser/blockParser';
import { ProgramModelBuilder } from '../src/parser/programModel';
import { runDiagnosticEngine, DEFAULT_CONFIG, EngineDiagnostic } from '../src/diagnostics/engine';

// ── Helpers ───────────────────────────────────────────────────────────────────

const tokenizer    = new Tokenizer();
const blockParser  = new BlockParser();
const modelBuilder = new ProgramModelBuilder();

function fixtureDir(): string {
  return path.resolve(__dirname, 'fixtures', 'diagnostics');
}

function diagnose(filename: string): EngineDiagnostic[] {
  const text   = fs.readFileSync(path.join(fixtureDir(), filename), 'utf-8');
  const tokens = tokenizer.tokenizeDocument(text);
  const blocks = blockParser.parseDocument(tokens);
  const model  = modelBuilder.build(blocks, 'fanuc');
  return runDiagnosticEngine(blocks, model.stateAtBlock, DEFAULT_CONFIG);
}

function errorsOnly(diags: EngineDiagnostic[]): EngineDiagnostic[] {
  return diags.filter(d => d.severity === 'error');
}

function warningsOnly(diags: EngineDiagnostic[]): EngineDiagnostic[] {
  return diags.filter(d => d.severity === 'warning');
}

function hasMsg(diags: EngineDiagnostic[], substring: string): boolean {
  return diags.some(d => d.message.includes(substring));
}

// ── Clean program — zero diagnostics ─────────────────────────────────────────

describe('Diagnostics: clean programs produce no noise', () => {
  it('clean-mill.nc → 0 diagnostics', () => {
    const diags = diagnose('clean-mill.nc');
    assert.strictEqual(diags.length, 0,
      `Expected 0 diagnostics, got:\n${JSON.stringify(diags, null, 2)}`);
  });

  it('arc-valid.nc → 0 diagnostics (full circle with valid I,J)', () => {
    const diags = diagnose('arc-valid.nc');
    assert.strictEqual(diags.length, 0,
      `Expected 0 diagnostics, got:\n${JSON.stringify(diags, null, 2)}`);
  });
});

// ── Canned cycle: missing Z ───────────────────────────────────────────────────

describe('Diagnostics: canned cycle — missing Z', () => {
  it('fires exactly 1 error', () => {
    const errs = errorsOnly(diagnose('cycle-missing-z.nc'));
    assert.strictEqual(errs.length, 1,
      `Expected 1 error, got ${errs.length}: ${JSON.stringify(errs)}`);
  });

  it('error message mentions Z', () => {
    const errs = errorsOnly(diagnose('cycle-missing-z.nc'));
    assert.ok(hasMsg(errs, 'requires Z'),
      `Expected "requires Z" in: ${errs.map(d => d.message).join(', ')}`);
  });

  it('no warnings generated', () => {
    assert.strictEqual(warningsOnly(diagnose('cycle-missing-z.nc')).length, 0);
  });
});

// ── Canned cycle: missing R ───────────────────────────────────────────────────

describe('Diagnostics: canned cycle — missing R', () => {
  it('fires exactly 1 error', () => {
    const errs = errorsOnly(diagnose('cycle-missing-r.nc'));
    assert.strictEqual(errs.length, 1,
      `Expected 1 error, got ${errs.length}: ${JSON.stringify(errs)}`);
  });

  it('error message mentions R', () => {
    assert.ok(hasMsg(errorsOnly(diagnose('cycle-missing-r.nc')), 'requires R'));
  });

  it('no warnings generated', () => {
    assert.strictEqual(warningsOnly(diagnose('cycle-missing-r.nc')).length, 0);
  });
});

// ── Peck cycle: missing Q ─────────────────────────────────────────────────────

describe('Diagnostics: G83 peck cycle — missing Q', () => {
  it('fires exactly 1 error', () => {
    const errs = errorsOnly(diagnose('peck-missing-q.nc'));
    assert.strictEqual(errs.length, 1,
      `Expected 1 error, got ${errs.length}: ${JSON.stringify(errs)}`);
  });

  it('error message mentions Q', () => {
    assert.ok(hasMsg(errorsOnly(diagnose('peck-missing-q.nc')), 'requires Q'));
  });

  it('error message identifies G83', () => {
    assert.ok(hasMsg(errorsOnly(diagnose('peck-missing-q.nc')), 'G83'));
  });

  it('no warnings generated', () => {
    assert.strictEqual(warningsOnly(diagnose('peck-missing-q.nc')).length, 0);
  });
});

// ── Tapping cycle: missing F ──────────────────────────────────────────────────

describe('Diagnostics: G84 tap cycle — missing F', () => {
  it('fires exactly 1 error', () => {
    const errs = errorsOnly(diagnose('tap-missing-f.nc'));
    assert.strictEqual(errs.length, 1,
      `Expected 1 error, got ${errs.length}: ${JSON.stringify(errs)}`);
  });

  it('error message mentions F', () => {
    assert.ok(hasMsg(errorsOnly(diagnose('tap-missing-f.nc')), 'requires F'));
  });

  it('error message identifies G84', () => {
    assert.ok(hasMsg(errorsOnly(diagnose('tap-missing-f.nc')), 'G84'));
  });
});

// ── Safety: unsafe tool change ────────────────────────────────────────────────

describe('Diagnostics: safety — M06 without safe-Z retract', () => {
  it('fires exactly 1 warning', () => {
    const warns = warningsOnly(diagnose('unsafe-toolchange.nc'));
    assert.strictEqual(warns.length, 1,
      `Expected 1 warning, got ${warns.length}: ${JSON.stringify(warns)}`);
  });

  it('warning message mentions unsafe tool change', () => {
    assert.ok(hasMsg(warningsOnly(diagnose('unsafe-toolchange.nc')), 'unsafe tool change'));
  });

  it('no errors generated (safety rule is warning, not error)', () => {
    assert.strictEqual(errorsOnly(diagnose('unsafe-toolchange.nc')).length, 0);
  });
});

// ── Safety: spindle on at M30 ────────────────────────────────────────────────

describe('Diagnostics: safety — spindle running at M30', () => {
  it('fires exactly 1 warning', () => {
    const warns = warningsOnly(diagnose('spindle-at-m30.nc'));
    assert.strictEqual(warns.length, 1,
      `Expected 1 warning, got ${warns.length}: ${JSON.stringify(warns)}`);
  });

  it('warning message mentions spindle', () => {
    assert.ok(hasMsg(warningsOnly(diagnose('spindle-at-m30.nc')), 'Spindle may still be running'));
  });

  it('no errors generated', () => {
    assert.strictEqual(errorsOnly(diagnose('spindle-at-m30.nc')).length, 0);
  });
});

// ── Safety: coolant on at M30 ────────────────────────────────────────────────

describe('Diagnostics: safety — coolant on at M30', () => {
  it('fires exactly 1 warning', () => {
    const warns = warningsOnly(diagnose('coolant-at-m30.nc'));
    assert.strictEqual(warns.length, 1,
      `Expected 1 warning, got ${warns.length}: ${JSON.stringify(warns)}`);
  });

  it('warning message mentions coolant', () => {
    assert.ok(hasMsg(warningsOnly(diagnose('coolant-at-m30.nc')), 'Coolant may still be on'));
  });

  it('no errors generated', () => {
    assert.strictEqual(errorsOnly(diagnose('coolant-at-m30.nc')).length, 0);
  });
});

// ── Arc geometry: radius mismatch ────────────────────────────────────────────

describe('Diagnostics: arc geometry — center-offset radius mismatch', () => {
  it('fires exactly 1 error', () => {
    const errs = errorsOnly(diagnose('arc-mismatch.nc'));
    assert.strictEqual(errs.length, 1,
      `Expected 1 error, got ${errs.length}: ${JSON.stringify(errs)}`);
  });

  it('error message mentions radius error', () => {
    assert.ok(hasMsg(errorsOnly(diagnose('arc-mismatch.nc')), 'radius error'));
  });

  it('reports radius error > 0.001 (our tolerance)', () => {
    const msg = errorsOnly(diagnose('arc-mismatch.nc'))[0]?.message ?? '';
    const match = /radius error: ([\d.]+)/.exec(msg);
    assert.ok(match, `No radius value in: ${msg}`);
    const delta = parseFloat(match[1]);
    assert.ok(delta > 0.001, `Expected delta > 0.001, got ${delta}`);
  });
});

// ── Fixture files against known production programs ──────────────────────────

describe('Diagnostics: production fixture regression (existing fixtures)', () => {
  it('fanuc/drill-pattern.nc → 0 errors (well-formed program)', () => {
    const text    = fs.readFileSync(
      path.resolve(__dirname, 'fixtures', 'fanuc', 'drill-pattern.nc'), 'utf-8');
    const blocks  = blockParser.parseDocument(tokenizer.tokenizeDocument(text));
    const model   = modelBuilder.build(blocks, 'fanuc');
    const errs    = errorsOnly(runDiagnosticEngine(blocks, model.stateAtBlock, DEFAULT_CONFIG));
    assert.strictEqual(errs.length, 0,
      `drill-pattern.nc should be clean, got:\n${JSON.stringify(errs, null, 2)}`);
  });

  it('crash-scenarios/multiple-violations.nc → ≥3 diagnostics (intentionally bad)', () => {
    const text   = fs.readFileSync(
      path.resolve(__dirname, 'fixtures', 'crash-scenarios', 'multiple-violations.nc'), 'utf-8');
    const blocks = blockParser.parseDocument(tokenizer.tokenizeDocument(text));
    const model  = modelBuilder.build(blocks, 'fanuc');
    const diags  = runDiagnosticEngine(blocks, model.stateAtBlock, DEFAULT_CONFIG);
    assert.ok(diags.length >= 3,
      `Expected ≥3 diagnostics in crash file, got ${diags.length}:\n${JSON.stringify(diags, null, 2)}`);
  });
});

// ── Config flag: disable safety checks ───────────────────────────────────────

describe('Diagnostics: config flags respected', () => {
  it('enableSafetyChecks=false suppresses M06 warning', () => {
    const text   = fs.readFileSync(path.join(fixtureDir(), 'unsafe-toolchange.nc'), 'utf-8');
    const blocks = blockParser.parseDocument(tokenizer.tokenizeDocument(text));
    const model  = modelBuilder.build(blocks, 'fanuc');
    const diags  = runDiagnosticEngine(blocks, model.stateAtBlock,
      { ...DEFAULT_CONFIG, enableSafetyChecks: false });
    assert.strictEqual(warningsOnly(diags).length, 0,
      'Expected 0 warnings when safety checks disabled');
  });

  it('enableArcValidation=false suppresses arc error', () => {
    const text   = fs.readFileSync(path.join(fixtureDir(), 'arc-mismatch.nc'), 'utf-8');
    const blocks = blockParser.parseDocument(tokenizer.tokenizeDocument(text));
    const model  = modelBuilder.build(blocks, 'fanuc');
    const diags  = runDiagnosticEngine(blocks, model.stateAtBlock,
      { ...DEFAULT_CONFIG, enableArcValidation: false });
    assert.strictEqual(errorsOnly(diags).length, 0,
      'Expected 0 errors when arc validation disabled');
  });

  it('arcTolerance=1.0 suppresses small arc mismatch', () => {
    const text   = fs.readFileSync(path.join(fixtureDir(), 'arc-mismatch.nc'), 'utf-8');
    const blocks = blockParser.parseDocument(tokenizer.tokenizeDocument(text));
    const model  = modelBuilder.build(blocks, 'fanuc');
    const diags  = runDiagnosticEngine(blocks, model.stateAtBlock,
      { ...DEFAULT_CONFIG, arcTolerance: 1.0 });
    assert.strictEqual(errorsOnly(diags).length, 0,
      'Expected 0 errors with loose tolerance of 1.0');
  });
});
