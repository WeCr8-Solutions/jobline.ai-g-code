/**
 * The extension reads what jobline.ai-CAM produces.
 *
 * CAM's Haas VF-2 / Lang Makro-Grip test bench programs a part, posts it for
 * the Haas, and writes a summary. Copies live in test/fixtures/cam-bench/
 * (kept identical to CAM's samples/testbench/ by the sync test). Here the
 * extension parses the same program and must agree with CAM about it: the
 * tools and their diameters, the stock, the drilling cycle, how deep the
 * program goes, and that it is clean. When the two disagree, one of them
 * reads or writes G-code wrong.
 *
 * Run via: npm test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Tokenizer } from '../src/parser/tokenizer';
import { BlockParser } from '../src/parser/blockParser';
import { ProgramModelBuilder } from '../src/parser/programModel';
import { runDiagnosticEngine, DEFAULT_CONFIG } from '../src/diagnostics/engine';
import { reviewGCodeProgram } from '../src/providers/visualizer/programReview';
import { buildVisualizerHarnessData } from '../src/providers/visualizer/fixtureHarness';
import { parseGCodeToPath } from '../src/providers/visualizer/toolpathParser';

const dir = path.join(__dirname, 'fixtures', 'cam-bench');
const id = 'haas-vf2-lang-makrogrip';
const program = fs.readFileSync(path.join(dir, `${id}.nc`), 'utf8');
const setup = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));
const summary = JSON.parse(fs.readFileSync(path.join(dir, `${id}.summary.json`), 'utf8'));
const dialect = 'haas';

const blocks = new BlockParser().parseDocument(new Tokenizer().tokenizeDocument(program));
const model = new ProgramModelBuilder().build(blocks, dialect);

describe('CAM test bench program, read by the extension', () => {
  it('sees the same tools, with the diameters CAM programmed', () => {
    const harness = buildVisualizerHarnessData(program, dialect);
    assert.deepEqual(model.tools.map(t => t.toolNumber), setup.tools.map((t: { number: number }) => t.number));
    assert.deepEqual(
      harness.tools.map(t => [t.toolNumber, t.diameter]),
      setup.tools.map((t: { number: number; diameter: number }) => [t.number, t.diameter]),
    );
  });

  it('reads the stock size from the header', () => {
    assert.deepEqual(model.stockDimensions, { width: setup.stock.length, depth: setup.stock.width, height: setup.stock.height });
  });

  it('finds one drilling cycle per hole', () => {
    const holes = setup.operations.find((op: { type: string }) => op.type === 'drill').points.length;
    assert.deepEqual(model.cannedCycles.map(c => [c.code, 1 + c.repeatLines.length]), [[81, holes]]);
  });

  it('agrees with CAM on how deep and how wide the program goes', () => {
    const { path: points, units } = parseGCodeToPath(program);
    assert.equal(units, setup.units === 'inch' ? 'in' : 'mm');
    const minZ = Math.min(...points.map(p => p.z));
    const camMinZ = Math.min(...summary.operations.map((op: { minZ: number }) => op.minZ));
    assert.ok(Math.abs(minZ - camMinZ) < 1e-4, `extension min Z ${minZ}, CAM min Z ${camMinZ}`);
    // Every move stays within the clearance plane CAM used.
    assert.ok(Math.max(...points.map(p => p.z)) <= setup.clearance + 1e-9);
  });

  it('is a mill program with no diagnostics and a clean review', () => {
    assert.equal(model.detectedMachineType, '3-Axis Vertical Mill');
    const diagnostics = runDiagnosticEngine(blocks, model.stateAtBlock, DEFAULT_CONFIG);
    assert.deepEqual(diagnostics.map(d => `${d.severity} line ${d.line + 1}: ${d.message}`), []);
    const review = reviewGCodeProgram(program, dialect);
    assert.deepEqual(review.findings.map(f => `${f.severity}: ${f.message}`), []);
  });
});

describe('tool comments the bench exposed', () => {
  const diameterOf = (comment: string) => {
    const text = `(${comment})\nT1 M06\n`;
    const b = new BlockParser().parseDocument(new Tokenizer().tokenizeDocument(text));
    return buildVisualizerHarnessData(text, dialect).tools[0]?.diameter ?? new ProgramModelBuilder().build(b, dialect).tools[0]?.diameter;
  };

  it('a tap drill named for its thread keeps the drill size', () => {
    assert.equal(diameterOf('T1 #7 .201 DRILL FOR 1/4-20'), 0.201);
  });

  it('a tap still takes its size from the thread', () => {
    assert.equal(diameterOf('T1 1/4-20 TAP'), 0.25);
  });

  it('a # in a comment is not a macro variable', () => {
    const review = reviewGCodeProgram('%\nO1000\n(#7 DRILL)\nG00 G90 X0 Y0\nM30\n%\n', dialect);
    assert.equal(review.findings.some(f => f.id === 'simulation-macro-approximation'), false);
  });
});
