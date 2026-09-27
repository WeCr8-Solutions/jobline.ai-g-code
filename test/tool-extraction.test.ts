/**
 * Tool extraction tests.
 *
 * These pin the specs read from the comment beside a T-call. There was no
 * coverage here, and the positional fallback was assigning the TOOL NUMBER as
 * the diameter: "T5 - .201 DIA DRILL - 118 DEG" produced diameter 5,
 * length-of-cut 201 and stick-out 118. Every tool in a program came out with
 * its diameter equal to its tool number, which draws the wrong tool and
 * simulates the wrong cutter width.
 *
 * Run via: npm test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Tokenizer } from '../src/parser/tokenizer';
import { BlockParser } from '../src/parser/blockParser';
import { ProgramModelBuilder } from '../src/parser/programModel';
import { buildVisualizerHarnessData } from '../src/providers/visualizer/fixtureHarness';

const tokenizer = new Tokenizer();
const blockParser = new BlockParser();
const modelBuilder = new ProgramModelBuilder();

/** Build a one-tool program from a comment and return the extracted tool. */
function toolFrom(comment: string, toolNumber = 1) {
  const src = `(${comment})\nT${toolNumber} M06\nG43 H${toolNumber} Z1.\n`;
  const model = modelBuilder.build(blockParser.parseDocument(tokenizer.tokenizeDocument(src)), 'fanuc');
  const tool = model.tools.find(t => t.toolNumber === toolNumber);
  assert.ok(tool, `no tool T${toolNumber} extracted from ${JSON.stringify(comment)}`);
  return tool!;
}

describe('Tool extraction — diameter', () => {
  it('never takes the tool number as the diameter', () => {
    for (const n of [1, 5, 7, 12]) {
      const tool = toolFrom(`T${n} - 1/2 FLAT ENDMILL`, n);
      assert.equal(tool.diameter, 0.5, `T${n} diameter should be 0.5, not the tool number`);
    }
  });

  it('reads a fractional diameter', () => {
    assert.equal(toolFrom('T1 - 1/2 FLAT ENDMILL').diameter, 0.5);
    assert.equal(toolFrom('T2 - 3/8 BALL ENDMILL').diameter, 0.375);
  });

  it('reads a leading-decimal diameter', () => {
    // .201 must not read as 201.
    assert.equal(toolFrom('T5 - .201 DIA DRILL - 118 DEG').diameter, 0.201);
  });

  it('reads a tap diameter from the thread callout', () => {
    assert.equal(toolFrom('T7 - 1/4-20 TAP').diameter, 0.25);
  });

  it('reads a decimal diameter stated before the tool type', () => {
    assert.equal(toolFrom('T12 - 2.0 FACE MILL - 5 FLUTE').diameter, 2.0);
  });

  it('reads an explicitly labelled diameter in either order', () => {
    assert.equal(toolFrom('T1 - DIA 0.75 ENDMILL').diameter, 0.75);
    assert.equal(toolFrom('T1 - dia=0.625 endmill').diameter, 0.625);
    assert.equal(toolFrom('T1 - 0.375 DIA').diameter, 0.375);
  });
});

describe('Tool extraction — length of cut and stick-out', () => {
  it('reads labelled LOC and STICKOUT', () => {
    const tool = toolFrom('T1 - 1/2 FLAT ENDMILL - LOC 1.25 - STICKOUT 2.0');
    assert.equal(tool.diameter, 0.5);
    assert.equal(tool.lengthOfCut, 1.25);
    assert.equal(tool.lengthOutOfHolder, 2.0);
  });

  it('does not mistake a drill point angle for stick-out', () => {
    const tool = toolFrom('T5 - .201 DIA DRILL - 118 DEG');
    assert.notEqual(tool.lengthOutOfHolder, 118);
    assert.notEqual(tool.lengthOfCut, 118);
  });

  it('does not mistake a flute count for a length', () => {
    const tool = toolFrom('T12 - 2.0 FACE MILL - 5 FLUTE');
    assert.notEqual(tool.lengthOutOfHolder, 5);
  });

  it('still reads the fully specified form with a holder', () => {
    const tool = toolFrom('T3 - 0.5 dia, 1.5 lc, 3.0 oh, CAT40', 3);
    assert.equal(tool.diameter, 0.5);
    assert.equal(tool.lengthOfCut, 1.5);
    assert.equal(tool.lengthOutOfHolder, 3.0);
    assert.equal(tool.holder, 'CAT40');
  });

  it('never assigns NaN from a stray letter pair', () => {
    // The old key=value regexes alternated on a bare "lc" / "oh", so any comment
    // containing those letters matched with no capture and produced NaN.
    for (const c of ['T1 - CALC POCKET CLEARANCE', 'T1 - ROUGH BLOCK OH BOY', 'T1 - 1/2 EM']) {
      const tool = toolFrom(c);
      for (const k of ['diameter', 'lengthOfCut', 'lengthOutOfHolder'] as const) {
        const v = tool[k];
        assert.ok(v === undefined || Number.isFinite(v), `${k} is NaN for ${JSON.stringify(c)}`);
      }
    }
  });

  it('reads a bare positional spec list', () => {
    const tool = toolFrom('T1 - 0.5 1.5 3.0');
    assert.equal(tool.diameter, 0.5);
    assert.equal(tool.lengthOfCut, 1.5);
    assert.equal(tool.lengthOutOfHolder, 3.0);
  });
});

describe('Visualizer tool families', () => {
  it('keeps common mill and lathe geometries distinct', () => {
    const descriptions = [
      '1/2 FLAT END MILL',
      '3/8 BALL END MILL',
      '1/2 BULL NOSE END MILL',
      '.201 DIA DRILL',
      '1/4 SPOT DRILL',
      '1/4-20 TAP',
      '3/8 REAMER',
      '1/2 CHAMFER MILL',
      '2.0 FACE MILL',
      '1.0 SLITTING SAW',
      'CNMG120408 ROUGH OD',
    ];
    const expected = [
      'End Mill', 'Ball End Mill', 'Bull Nose End Mill', 'Drill', 'Spot Drill',
      'Tap', 'Reamer', 'Chamfer Mill', 'Face Mill', 'Slitting Saw', 'Lathe Insert',
    ];
    const lines: string[] = ['%', 'O9001'];
    descriptions.forEach((description, index) => {
      const toolNumber = index + 1;
      lines.push(`(T${toolNumber} - ${description})`, `T${toolNumber} M06`);
    });
    lines.push('M30', '%');

    const tools = buildVisualizerHarnessData(lines.join('\n')).tools;
    assert.deepEqual(tools.map(tool => tool.type), expected);
    const insert = tools.at(-1)!;
    assert.equal(insert.insertCode, 'CNMG120408');
    assert.ok(Math.abs(insert.diameter - 0.5) < 1e-9, 'metric ISO insert is normalized into the G20 program unit');
    assert.ok(Math.abs(insert.insertThickness! - 4.76 / 25.4) < 1e-9);
    assert.ok(Math.abs(insert.cornerRadius! - 0.8 / 25.4) < 1e-9);
    assert.ok(insert.insertOutline && insert.insertOutline.length === 4);
  });

  it('keeps metric insert dimensions in millimetres for a G21 program', () => {
    const data = buildVisualizerHarnessData('%\nO9002\nG21\n(T1 - CNMG120408 ROUGH OD)\nT0101\nM30\n%');
    assert.equal(data.tools[0].diameter, 12.7);
    assert.equal(data.tools[0].insertThickness, 4.76);
    assert.equal(data.tools[0].cornerRadius, 0.8);
  });
});
