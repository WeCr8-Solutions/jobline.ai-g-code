/**
 * JobLine Parser Tests
 * Uses Node.js built-in test runner (node:test)
 * Run: npx ts-node --transpileOnly node_modules/.bin/... or node --test out/test/
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Tokenizer } from '../src/parser/tokenizer';
import { BlockParser } from '../src/parser/blockParser';
import { ProgramModelBuilder } from '../src/parser/programModel';
import { MacroEvaluator } from '../src/parser/macroEvaluator';
import { ModalStateUpdater } from '../src/utils/modalState';
import { TokenizedLine, GCodeBlock, createDefaultModalState } from '../src/parser/types';

const tokenizer = new Tokenizer();
const blockParser = new BlockParser();
const modelBuilder = new ProgramModelBuilder();

function fixturesDir(): string {
  return path.resolve(__dirname, '..', 'test', 'fixtures');
}

function loadFixture(relativePath: string): string {
  return fs.readFileSync(path.join(fixturesDir(), relativePath), 'utf-8');
}

function tok(text: string): TokenizedLine {
  return tokenizer.tokenizeLine(text, 0);
}

function blk(text: string): GCodeBlock {
  return blockParser.parseBlock(tokenizer.tokenizeLine(text, 0));
}

function parseDoc(text: string): GCodeBlock[] {
  return blockParser.parseDocument(tokenizer.tokenizeDocument(text));
}

// =============================================================================
// TOKENIZER
// =============================================================================

describe('Tokenizer: G-codes', () => {
  it('G01', () => {
    const g = tok('G01 X1.5 Y2.0 F12.0').tokens.find(t => t.type === 'G');
    assert.ok(g); assert.strictEqual(g.code, 1);
  });
  it('G0 (no leading zero)', () => {
    const g = tok('G0 X0 Y0 Z1.0').tokens.find(t => t.type === 'G');
    assert.ok(g); assert.strictEqual(g.code, 0);
  });
  it('G54.1 sub-code', () => {
    const g = tok('G54.1 P1').tokens.find(t => t.type === 'G');
    assert.ok(g); assert.strictEqual(g.code, 54.1);
  });
  it('multiple G-codes on one line', () => {
    const gs = tok('G90 G00 X0 Y0').tokens.filter(t => t.type === 'G');
    assert.strictEqual(gs.length, 2);
    assert.strictEqual(gs[0].code, 90);
    assert.strictEqual(gs[1].code, 0);
  });
  it('G83 with all params yields >=6 address tokens', () => {
    const addrs = tok('G83 X1.0 Y1.0 Z-0.75 R0.1 Q0.15 F12.0').tokens.filter(t => t.type === 'address');
    assert.ok(addrs.length >= 6, `got ${addrs.length}`);
  });
});

describe('Tokenizer: M-codes', () => {
  it('M03', () => {
    const m = tok('M03 S3500').tokens.find(t => t.type === 'M');
    assert.ok(m); assert.strictEqual(m.code, 3);
  });
  it('M06', () => {
    const m = tok('T01 M06').tokens.find(t => t.type === 'M');
    assert.ok(m); assert.strictEqual(m.code, 6);
  });
});

describe('Tokenizer: addresses', () => {
  it('positive X1.5', () => {
    const b = blk('G01 X1.5');
    const x = b.addresses.get('X');
    assert.ok(x); assert.strictEqual(x.resolvedValue, 1.5); assert.ok(x.isFullyResolved);
  });
  it('negative Z-1.25', () => {
    const z = blk('G01 Z-1.25').addresses.get('Z');
    assert.ok(z); assert.strictEqual(z.resolvedValue, -1.25);
  });
  it('trailing decimal Z1.', () => {
    const z = blk('G01 Z1.').addresses.get('Z');
    assert.ok(z); assert.strictEqual(z.resolvedValue, 1.0);
  });
  it('missing leading zero X.5', () => {
    const x = blk('G01 X.5').addresses.get('X');
    assert.ok(x); assert.strictEqual(x.resolvedValue, 0.5);
  });
  it('tool number T12', () => {
    assert.strictEqual(blk('T12 M06').toolNumber, 12);
  });
});

describe('Tokenizer: comments', () => {
  it('parenthesized comment-only line', () => {
    assert.ok(tok('(THIS IS A COMMENT)').isComment);
  });
  it('semicolon comment-only line', () => {
    assert.ok(tok('; Siemens comment').isComment);
  });
  it('inline comment preserves addresses after it', () => {
    const b = blk('G01 X1.0 (move) Y2.0');
    assert.ok(b.gCodes.length > 0);
    assert.ok(b.comment);
    assert.ok(b.addresses.has('Y'), 'Y after comment missing');
  });
  it('empty line', () => {
    const r = tok('');
    assert.ok(r.isEmpty); assert.strictEqual(r.tokens.length, 0);
  });
});

describe('Tokenizer: program structure', () => {
  it('% delimiter', () => {
    assert.ok(tok('%').tokens.find(t => t.type === 'percentDelimiter'));
  });
  it('O-number', () => {
    assert.strictEqual(blk('O01234 (DRILL)').programNumber, 'O01234');
  });
  it('Okuma $-number', () => {
    assert.strictEqual(blk('$08684 (OKUMA)').programNumber, '$08684');
  });
  it('N-line number', () => {
    assert.strictEqual(blk('N100 G01 X1.0').blockNumber, 100);
  });
  it('block skip /', () => {
    assert.ok(blk('/N100 G01 X1.0').blockSkip);
  });
});

describe('Tokenizer: Macro B', () => {
  it('variable address Z#5 is unresolved', () => {
    const b = blk('G83 Z#5 Q#1 F#2');
    const z = b.addresses.get('Z');
    assert.ok(z); assert.strictEqual(z.isFullyResolved, false);
    assert.ok(b.hasMacroExpressions);
  });
  it('expression address Z[#1 + 0.5]', () => {
    const z = blk('G01 Z[#1 + 0.5]').addresses.get('Z');
    assert.ok(z); assert.strictEqual(z.rawValue.kind, 'expression');
  });
  it('IF keyword', () => {
    assert.ok(tok('IF [#1 GT 0] GOTO 100').tokens.find(t => t.type === 'controlFlow'));
  });
  it('WHILE keyword', () => {
    assert.ok(tok('WHILE [#3 LT 10] DO 1').tokens.find(t => t.type === 'controlFlow' && t.letter === 'WHILE'));
  });
});

describe('Tokenizer: Siemens', () => {
  it('CYCLE83 token', () => {
    assert.ok(tok('CYCLE83(50, 0, 2, -30, , 5)').tokens.find(t => t.type === 'siemensCycle'));
  });
  it('CYCLE83 positional params parsed', () => {
    const b = blk('CYCLE83(50, 0, 2, -30, , 5)');
    const p0 = b.addresses.get('_P0');
    assert.ok(p0); assert.strictEqual(p0.resolvedValue, 50);
    const p3 = b.addresses.get('_P3');
    assert.ok(p3); assert.strictEqual(p3.resolvedValue, -30);
  });
});

describe('Tokenizer: Okuma', () => {
  it('CALL OB1 token', () => {
    assert.ok(tok('CALL OB1').tokens.find(t => t.type === 'okumaCall'));
  });
});

// =============================================================================
// FIXTURE FILES — tokenize every line without crashing
// =============================================================================

describe('Fixture: fanuc/drill-pattern.nc', () => {
  it('tokenizes every non-empty line', () => {
    const lines = tokenizer.tokenizeDocument(loadFixture('fanuc/drill-pattern.nc'));
    assert.ok(lines.length > 10);
    for (const l of lines) {
      if (!l.isEmpty) assert.ok(l.tokens.length > 0, `line ${l.lineNumber}: "${l.raw}"`);
    }
  });
});

describe('Fixture: fanuc/macro-bolt-circle.nc', () => {
  it('tokenizes and finds macro variables', () => {
    const lines = tokenizer.tokenizeDocument(loadFixture('fanuc/macro-bolt-circle.nc'));
    assert.ok(lines.length > 10);
    const hasVar = lines.some(l => l.tokens.some(t => t.value.kind === 'variable'));
    assert.ok(hasVar, 'no macro variables found');
  });
});

describe('Fixture: siemens/cycle83-drill.nc', () => {
  it('finds CYCLE83 token', () => {
    const lines = tokenizer.tokenizeDocument(loadFixture('siemens/cycle83-drill.nc'));
    assert.ok(lines.find(l => l.tokens.some(t => t.type === 'siemensCycle')), 'no CYCLE83');
  });
});

describe('Fixture: okuma/facing-od-rough.nc', () => {
  it('finds $ program number', () => {
    const lines = tokenizer.tokenizeDocument(loadFixture('okuma/facing-od-rough.nc'));
    assert.ok(lines.find(l => l.tokens.some(t => t.type === 'programNumber')), 'no $prog');
  });
});

// =============================================================================
// PROGRAM MODEL
// =============================================================================

describe('ProgramModel: fanuc drill pattern', () => {
  let blocks: GCodeBlock[];
  let model: ReturnType<ProgramModelBuilder['build']>;

  it('builds without error', () => {
    const text = loadFixture('fanuc/drill-pattern.nc');
    blocks = parseDoc(text);
    model = modelBuilder.build(blocks, 'fanuc');
    assert.ok(model);
  });

  it('detects program number O01234', () => {
    const text = loadFixture('fanuc/drill-pattern.nc');
    blocks = parseDoc(text);
    model = modelBuilder.build(blocks, 'fanuc');
    assert.strictEqual(model.programNumber, 'O01234');
  });

  it('detects >=2 operations (tool changes)', () => {
    const text = loadFixture('fanuc/drill-pattern.nc');
    blocks = parseDoc(text);
    model = modelBuilder.build(blocks, 'fanuc');
    assert.ok(model.operations.length >= 2, `ops: ${model.operations.length}`);
  });

  it('detects >=2 tools', () => {
    const text = loadFixture('fanuc/drill-pattern.nc');
    blocks = parseDoc(text);
    model = modelBuilder.build(blocks, 'fanuc');
    assert.ok(model.tools.length >= 2, `tools: ${model.tools.length}`);
  });

  it('finds G83 and G81 canned cycles', () => {
    const text = loadFixture('fanuc/drill-pattern.nc');
    blocks = parseDoc(text);
    model = modelBuilder.build(blocks, 'fanuc');
    assert.ok(model.cannedCycles.find(c => c.code === 83), 'no G83');
    assert.ok(model.cannedCycles.find(c => c.code === 81), 'no G81');
  });

  it('marks cycle repeat blocks with parentCycleLineRef', () => {
    const text = loadFixture('fanuc/drill-pattern.nc');
    blocks = parseDoc(text);
    model = modelBuilder.build(blocks, 'fanuc');
    const repeats = model.blocks.filter(b => b.isCycleRepeat);
    assert.ok(repeats.length > 0, 'no cycle repeats found');
    for (const r of repeats) {
      assert.ok(r.parentCycleLineRef !== undefined, `line ${r.line} missing parent ref`);
    }
  });
});

// =============================================================================
// MODAL STATE
// =============================================================================

describe('ModalState', () => {
  const updater = new ModalStateUpdater();

  it('spindle CW after M03', () => {
    let s = createDefaultModalState();
    s = updater.updateState(s, blk('M03 S3500'));
    assert.strictEqual(s.spindleDirection, 'CW');
    assert.strictEqual(s.activeS, 3500);
  });

  it('coolant flood after M08', () => {
    let s = createDefaultModalState();
    s = updater.updateState(s, blk('M08'));
    assert.strictEqual(s.coolantState, 'flood');
  });

  it('coolant off after M09', () => {
    let s = createDefaultModalState();
    s = updater.updateState(s, blk('M08'));
    s = updater.updateState(s, blk('M09'));
    assert.strictEqual(s.coolantState, 'off');
  });

  it('G90 sets absolute', () => {
    let s = createDefaultModalState();
    s = updater.updateState(s, blk('G91'));
    assert.strictEqual(s.activePositioning, 91);
    s = updater.updateState(s, blk('G90'));
    assert.strictEqual(s.activePositioning, 90);
  });

  it('G20/G21 units', () => {
    let s = createDefaultModalState();
    s = updater.updateState(s, blk('G21'));
    assert.strictEqual(s.activeUnits, 21);
    s = updater.updateState(s, blk('G20'));
    assert.strictEqual(s.activeUnits, 20);
  });

  it('tool number tracked', () => {
    let s = createDefaultModalState();
    s = updater.updateState(s, blk('T05 M06'));
    assert.strictEqual(s.activeTool, 5);
  });

  it('canned cycle activated by G83, cancelled by G80', () => {
    let s = createDefaultModalState();
    s = updater.updateState(s, blk('G83 X1.0 Y1.0 Z-0.75 R0.1 Q0.15 F12.0'));
    assert.strictEqual(s.activeCannedCycle, 83);
    s = updater.updateState(s, blk('G80'));
    assert.strictEqual(s.activeCannedCycle, null);
  });

  it('G28 sets isAtSafeZ', () => {
    let s = createDefaultModalState();
    s.isAtSafeZ = false;
    s = updater.updateState(s, blk('G91 G28 Z0'));
    assert.ok(s.isAtSafeZ);
  });

  it('feed rate tracked', () => {
    let s = createDefaultModalState();
    s = updater.updateState(s, blk('G01 X1.0 F25.0'));
    assert.strictEqual(s.activeF, 25.0);
  });

  it('work offset tracked', () => {
    let s = createDefaultModalState();
    s = updater.updateState(s, blk('G54'));
    assert.strictEqual(s.activeWorkOffset, 'G54');
    s = updater.updateState(s, blk('G55'));
    assert.strictEqual(s.activeWorkOffset, 'G55');
  });

  it('position tracked in absolute mode', () => {
    let s = createDefaultModalState();
    s = updater.updateState(s, blk('G90'));
    s = updater.updateState(s, blk('G01 X5.0 Y3.0 Z-1.0 F10.0'));
    assert.strictEqual(s.currentPosition.X, 5.0);
    assert.strictEqual(s.currentPosition.Y, 3.0);
    assert.strictEqual(s.currentPosition.Z, -1.0);
  });
});

// =============================================================================
// MACRO EVALUATOR
// =============================================================================

describe('MacroEvaluator', () => {
  it('resolves literal value', () => {
    const ev = new MacroEvaluator();
    assert.strictEqual(ev.resolveTokenValue({ kind: 'literal', value: 42 }), 42);
  });

  it('returns null for unknown variable', () => {
    const ev = new MacroEvaluator();
    assert.strictEqual(ev.resolveTokenValue({ kind: 'variable', variableNum: 500 }), null);
  });

  it('evaluates simple arithmetic [5 * 2]', () => {
    const ev = new MacroEvaluator();
    const r = ev.resolveTokenValue({
      kind: 'expression', raw: '[5 * 2]', parts: [
        { type: 'open', raw: '[' },
        { type: 'number', raw: '5', value: 5 },
        { type: 'operator', raw: '*' },
        { type: 'number', raw: '2', value: 2 },
        { type: 'close', raw: ']' },
      ],
    });
    assert.strictEqual(r, 10);
  });

  it('evaluates SIN[30] ≈ 0.5', () => {
    const ev = new MacroEvaluator();
    const r = ev.resolveTokenValue({
      kind: 'expression', raw: '[SIN[30]]', parts: [
        { type: 'open', raw: '[' },
        { type: 'function', raw: 'SIN' },
        { type: 'open', raw: '[' },
        { type: 'number', raw: '30', value: 30 },
        { type: 'close', raw: ']' },
        { type: 'close', raw: ']' },
      ],
    });
    assert.ok(r !== null);
    assert.ok(Math.abs(r! - 0.5) < 0.0001, `SIN[30]=${r}`);
  });

  it('evaluates COS[0] = 1', () => {
    const ev = new MacroEvaluator();
    const r = ev.resolveTokenValue({
      kind: 'expression', raw: '[COS[0]]', parts: [
        { type: 'open', raw: '[' },
        { type: 'function', raw: 'COS' },
        { type: 'open', raw: '[' },
        { type: 'number', raw: '0', value: 0 },
        { type: 'close', raw: ']' },
        { type: 'close', raw: ']' },
      ],
    });
    assert.ok(r !== null);
    assert.ok(Math.abs(r! - 1.0) < 0.0001, `COS[0]=${r}`);
  });

  it('evaluates SQRT[4] = 2', () => {
    const ev = new MacroEvaluator();
    const r = ev.resolveTokenValue({
      kind: 'expression', raw: '[SQRT[4]]', parts: [
        { type: 'open', raw: '[' },
        { type: 'function', raw: 'SQRT' },
        { type: 'open', raw: '[' },
        { type: 'number', raw: '4', value: 4 },
        { type: 'close', raw: ']' },
        { type: 'close', raw: ']' },
      ],
    });
    assert.strictEqual(r, 2);
  });

  it('returns null for unresolvable', () => {
    const ev = new MacroEvaluator();
    assert.strictEqual(ev.resolveTokenValue({ kind: 'unresolvable' }), null);
  });
});
