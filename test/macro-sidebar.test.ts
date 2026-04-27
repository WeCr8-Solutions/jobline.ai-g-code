import { describe, expect, it } from 'vitest';
import { Tokenizer } from '../src/parser/tokenizer';
import { BlockParser } from '../src/parser/blockParser';
import { ProgramModelBuilder } from '../src/parser/programModel';
import { buildMacroSidebarEntries } from '../src/providers/visualizer/macroSidebar';
import { getAdjacentSectionIndex, getSectionLineNumbers } from '../src/providers/sidebarNavigation';
import { selectPreferredGCodeDocument } from '../src/utils/gcodeDocumentTracker';

describe('Macro sidebar navigation', () => {
  it('builds clickable entries for assignments, flow control, and macro expressions', () => {
    const gcode = [
      '#100 = 5',
      'IF [#100 GT 3] GOTO 120',
      'WHILE [#100 LT 10] DO1',
      'G01 X[#100] Y1.',
      'END1',
    ].join('\n');

    const tokenizer = new Tokenizer();
    const blockParser = new BlockParser();
    const modelBuilder = new ProgramModelBuilder();
    const tokenized = tokenizer.tokenizeDocument(gcode);
    const blocks = blockParser.parseDocument(tokenized);
    const model = modelBuilder.build(blocks, 'fanuc');

    const entries = buildMacroSidebarEntries(model);

    expect(entries).toContainEqual({ label: '#100', description: 'L1 assignment', line: 0 });
    expect(entries).toContainEqual({ label: 'IF', description: 'L2 IF [#100 GT 3] GOTO N120', line: 1 });
    expect(entries).toContainEqual({ label: 'WHILE', description: 'L3 WHILE [#100 LT 10]', line: 2 });
    expect(entries).toContainEqual({ label: 'Macro Expression', description: 'L4 runtime-evaluated address', line: 3 });
    expect(entries).toContainEqual({ label: 'END', description: 'L5 END1', line: 4 });
  });
});

describe('Sidebar section navigation', () => {
  it('cycles through repeatable sections in both directions', () => {
    const gcode = [
      '(STOCK: W=4 D=4 H=2)',
      'T1 M06',
      'G81 X1. Y1. Z-0.5 R0.1 F10.',
      'X2. Y2.',
      'G80',
      'G31 Z-1. F5.',
      '#100 = 5',
      'IF [#100 GT 3] GOTO 120',
      'T2 M06',
      'G02 X1. Y1. I0.25',
    ].join('\n');

    const tokenizer = new Tokenizer();
    const blockParser = new BlockParser();
    const modelBuilder = new ProgramModelBuilder();
    const tokenized = tokenizer.tokenizeDocument(gcode);
    const blocks = blockParser.parseDocument(tokenized);
    const model = modelBuilder.build(blocks, 'fanuc');

    model.diagnostics.push({
      line: 9,
      startCol: 0,
      endCol: 1,
      severity: 'warning',
      message: 'Arc check',
      source: 'arc',
      ruleId: 'arc-test',
    });

    expect(getSectionLineNumbers(model, 'operations')).toEqual([1, 8]);
    expect(getSectionLineNumbers(model, 'tools')).toEqual([1, 8]);
    expect(getSectionLineNumbers(model, 'cycles')).toEqual([2, 3]);
    expect(getSectionLineNumbers(model, 'probing')).toEqual([5]);
    expect(getSectionLineNumbers(model, 'macros')).toEqual([6, 7]);
    expect(getSectionLineNumbers(model, 'alarms')).toEqual([9]);

    expect(getAdjacentSectionIndex(undefined, 2, 1)).toBe(0);
    expect(getAdjacentSectionIndex(0, 2, 1)).toBe(1);
    expect(getAdjacentSectionIndex(1, 2, 1)).toBe(0);
    expect(getAdjacentSectionIndex(undefined, 2, -1)).toBe(1);
    expect(getAdjacentSectionIndex(1, 2, -1)).toBe(0);
    expect(getAdjacentSectionIndex(0, 2, -1)).toBe(1);
  });
});

describe('Preferred G-code document tracking', () => {
  it('falls back to the last visible or open G-code document when focus leaves the editor', () => {
    const gcodeDoc = { fileName: 'part.nc', languageId: 'plaintext' };
    const secondGcodeDoc = { fileName: 'backup.tap', languageId: 'plaintext' };
    const nonGcodeDoc = { fileName: 'notes.md', languageId: 'markdown' };

    const isGCodeDocument = (document: { fileName: string; languageId: string }) =>
      /\.(nc|tap)$/i.test(document.fileName) || document.languageId === 'gcode';

    expect(selectPreferredGCodeDocument({
      activeDocument: nonGcodeDoc,
      lastDocument: gcodeDoc,
      visibleDocuments: [nonGcodeDoc],
      openDocuments: [nonGcodeDoc, gcodeDoc],
      isGCodeDocument,
    })).toBe(gcodeDoc);

    expect(selectPreferredGCodeDocument({
      activeDocument: nonGcodeDoc,
      visibleDocuments: [nonGcodeDoc, secondGcodeDoc],
      openDocuments: [nonGcodeDoc, secondGcodeDoc],
      isGCodeDocument,
    })).toBe(secondGcodeDoc);
  });
});