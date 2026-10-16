/**
 * Field findings from Zach's Oct 16 2026 check of 0.3.14 on a Haas program
 * (CIMCO "HAAS MILL NGC" sample O1000, trimmed) and a Renishaw WCS probe
 * subprogram (O80001, trimmed). Run: npm run test:field
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runDiagnosticEngine, DEFAULT_CONFIG } from '../src/diagnostics/engine';
import { detectControlFromProgram } from '../src/diagnostics/controlRules';
import { Tokenizer } from '../src/parser/tokenizer';
import { BlockParser } from '../src/parser/blockParser';
import { ProgramModelBuilder } from '../src/parser/programModel';
import { reviewGCodeProgram } from '../src/providers/visualizer/programReview';
import { buildVisualizerHarnessData } from '../src/providers/visualizer/fixtureHarness';

const dir = path.resolve(__dirname, 'fixtures', 'field-2026-10-16');
const haas = fs.readFileSync(path.join(dir, 'haas-o1000-circular.nc'), 'utf8');
const probe = fs.readFileSync(path.join(dir, 'renishaw-o80001-probe.nc'), 'utf8');

function run(text: string, controlType: string) {
  const blocks = new BlockParser().parseDocument(new Tokenizer().tokenizeDocument(text));
  const model = new ProgramModelBuilder().build(blocks, controlType);
  const diags = runDiagnosticEngine(blocks, model.stateAtBlock, { ...DEFAULT_CONFIG, controlType });
  return { model, diags };
}
const lineOf = (text: string, needle: string) => text.split(/\r?\n/).findIndex(l => l.includes(needle));

describe('Field 2026-10-16: arcs', () => {
  it('a G91 incremental arc is checked as incremental (no false radius error)', () => {
    const { diags } = run(haas, 'haas');
    assert.equal(diags.filter(d => /Arc endpoint/.test(d.message)).length, 0);
  });
  it('a real G91 arc error is still caught', () => {
    const bad = haas.replace('G91 G3 Y0.0984 J0.0492', 'G91 G3 Y0.0700 J0.0492');
    const { diags } = run(bad, 'haas');
    const arc = diags.find(d => /Arc endpoint/.test(d.message));
    assert.ok(arc, 'radius error reported');
    assert.equal(arc!.line, lineOf(bad, 'G91 G3'));
  });
  it('G90.1 absolute arc centres are honoured', () => {
    const prog = 'G20 G17 G90 G90.1\nG0 X1. Y0.\nG2 X0. Y-1. I0. J0. F10.\nM30\n';
    assert.equal(run(prog, 'fanuc').diags.filter(d => /Arc endpoint/.test(d.message)).length, 0);
  });
});

describe('Field 2026-10-16: macro calls and program end', () => {
  it('G65 arguments (A13.) are not an A axis: the probe program is a 3-axis mill', () => {
    const { model } = run(probe, 'haas');
    assert.equal(model.detectedMachineType, '3-Axis Vertical Mill');
  });
  it('G65 X/Y/Z arguments do not move the tracked position', () => {
    const { model } = run(probe, 'haas');
    const i = lineOf(probe, 'G65 P9995');
    assert.equal(model.stateAtBlock[i].currentPosition.X, 0);
    assert.equal(model.stateAtBlock[i].currentPosition.Z, 0.1);
  });
  it('M99 counts as a program end for a subprogram', () => {
    const review = reviewGCodeProgram(probe, 'haas');
    assert.equal(review.findings.filter(f => f.id === 'missing-program-end').length, 0);
    const none = reviewGCodeProgram(probe.replace('M99', ''), 'haas');
    assert.equal(none.findings.filter(f => f.id === 'missing-program-end').length, 1);
  });
});

describe('Field 2026-10-16: Haas dialect', () => {
  it('detects Haas from the header and from Haas-only codes', () => {
    assert.equal(detectControlFromProgram(haas), 'haas');
    assert.equal(detectControlFromProgram('O1234\nG0 G90 G54\nG187 P1\nM30\n'), 'haas');
    assert.equal(detectControlFromProgram('(OKUMA OSP-P300 LB3000)\nG0 X0\n'), 'okuma');
    assert.equal(detectControlFromProgram('(SINUMERIK 840D)\nG0 X0\n'), 'siemens');
    assert.equal(detectControlFromProgram('O1000\nG0 X0\nM30\n'), null);
  });
  it('Haas M06 without G28 is a note, not a warning; Fanuc keeps the warning', () => {
    const t1 = lineOf(haas, 'T1 M6');
    const h = run(haas, 'haas').diags.filter(d => d.line === t1 && /tool change|M06/.test(d.message));
    assert.equal(h.length, 1);
    assert.equal(h[0].severity, 'info');
    const f = run(haas, 'fanuc').diags.filter(d => d.line === t1 && /unsafe tool change/.test(d.message));
    assert.equal(f.length, 1);
    assert.equal(f[0].severity, 'warning');
  });
});

describe('Field 2026-10-16: feeds and coolant', () => {
  it('flags F1000. on a straight Z plunge', () => {
    const { diags } = run(haas, 'haas');
    const i = lineOf(haas, 'G1 Z-0.1 F1000.');
    assert.ok(diags.some(d => d.line === i && d.severity === 'warning' && /Plunge feed F1000/.test(d.message)));
  });
  it('does not flag a normal plunge feed', () => {
    const { diags } = run(haas.replace('F1000.', 'F10.'), 'haas');
    assert.equal(diags.filter(d => /Plunge feed/.test(d.message)).length, 0);
  });
  it('flags a feed carried across a tool change (no F after T2 M6)', () => {
    const { diags } = run(haas, 'haas');
    const i = lineOf(haas, 'G1 Z-0.05');
    assert.ok(diags.some(d => d.line === i && /carried over from the previous tool/.test(d.message)));
  });
  it('notes a program that runs the spindle with no coolant, but not a probe program', () => {
    assert.ok(run(haas, 'haas').diags.some(d => d.severity === 'info' && /No coolant/.test(d.message)));
    assert.ok(!run(haas.replace(/S10000 M3/g, 'S10000 M3 M8'), 'haas').diags.some(d => /No coolant/.test(d.message)));
    assert.ok(!run(probe, 'haas').diags.some(d => /No coolant/.test(d.message)));
  });
});

describe('Field 2026-10-16: tools', () => {
  it('a Renishaw probe is typed Probe, not End Mill', () => {
    const harness = buildVisualizerHarnessData(probe, 'haas');
    const t31 = harness.tools.find(t => t.toolNumber === 31);
    assert.equal(t31?.type, 'Probe');
  });
  it('a T word on the G43 line is a preselect, not a cutting tool', () => {
    const { model } = run(probe, 'haas');
    assert.deepEqual(model.tools.map(t => t.toolNumber), [31]);
    assert.equal(model.tools[0].offsetH, 31);
    assert.equal(model.operations.length, 1);
  });
  it('a preselected tool loaded by a bare M06 still becomes an operation', () => {
    const prog = 'G20 G90\nT1 M6\nG43 H1 Z1. T2\nG1 Z0 F10.\nG91 G28 Z0\nM6\nG43 H2 Z1.\nM30\n';
    const { model } = run(prog, 'fanuc');
    assert.deepEqual(model.tools.map(t => t.toolNumber), [1, 2]);
    assert.deepEqual(model.operations.map(o => o.toolNumber), [1, 2]);
  });
});
