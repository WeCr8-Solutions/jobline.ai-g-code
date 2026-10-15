/**
 * Basic repost / dialect conversion.
 * Run: npm run test:dialect-convert
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { convertProgram, CONVERT_SOURCES, CONVERT_TARGETS } from '../src/post/dialectConvert';
import { runControlRules } from '../src/diagnostics/controlRules';

const mill = fs.readFileSync(path.resolve(__dirname, 'fixtures', 'cam-output', '1001.nc'), 'utf8');
const errorsOn = (text: string, control: string) => runControlRules(text, control).filter(d => d.severity === 'error');

describe('Dialect convert: scope', () => {
  it('converts from ISO dialects only, and says so', () => {
    assert.ok(CONVERT_SOURCES.includes('fanuc'));
    assert.ok(!CONVERT_SOURCES.includes('siemens'));
    assert.throws(() => convertProgram('G0 X0', 'siemens', 'fanuc'), /from ISO \(Fanuc-family\) programs only/);
    assert.throws(() => convertProgram('G0 X0', 'heidenhain', 'fanuc'), /not supported/);
    for (const t of ['siemens', 'okuma', 'heidenhain', 'haas', 'fanuc']) assert.ok(CONVERT_TARGETS.includes(t as never));
  });
  it('every conversion output passes the target control rules without errors', () => {
    for (const to of ['siemens', 'okuma', 'heidenhain', 'haas', 'mazak', 'mitsubishi']) {
      const r = convertProgram(mill, 'fanuc', to);
      assert.deepEqual(errorsOn(r.text, to), [], `${to}: ${JSON.stringify(errorsOn(r.text, to))}`);
    }
  });
});

describe('Dialect convert: Fanuc → Siemens 840D', () => {
  const r = convertProgram(mill, 'fanuc', 'siemens');
  it('comments, units, length offset, reference return', () => {
    assert.match(r.text, /^; PROGRAM O1001 ; BRACKET OP1/m);
    assert.match(r.text, /^G70$/m, 'G20 → G70');
    const code = r.text.split('\n').filter(l => !l.startsWith(';')).map(l => l.replace(/;.*$/, '')).join('\n');
    assert.ok(!/G43|\bH\d/.test(code), 'G43 H removed from every block');
    assert.match(r.text, /^Z1 M8 D1$/m);
    assert.match(r.text, /^G0 G17 G40 D0 G90$/m, 'G49 → D0, G80 → MCALL on its own block');
    assert.match(r.text, /^G75 Z1=0 M9 ; was: G91 G28 Z0\. M9$/m, 'M9 kept');
  });
  it('G81 → MCALL CYCLE81 with RTP from the initial plane (G98)', () => {
    const lines = r.text.split('\n');
    const i = lines.indexOf('MCALL CYCLE81(1.,0.1,0,-0.5)');
    assert.ok(i > 0);
    assert.equal(lines[i - 1], 'F10');
    assert.equal(lines[i - 2], 'Z1 M8 D1', 'first hole is the position the tool is already at');
    assert.equal(lines[i + 1], 'X1.5');
    assert.equal(lines[i + 2], 'MCALL');
  });
  it('G99 uses the R plane as RTP', () => {
    const t = convertProgram('G90 G0 Z2.\nG99 G81 X1. Y1. Z-1. R.1 F5.\nG80\nM30\n', 'fanuc', 'siemens');
    assert.match(t.text, /MCALL CYCLE81\(0\.1,0\.1,0,-1\.\)/);
  });
  it('G84 is left for the programmer, with a note', () => {
    assert.match(r.text, /^; JL MANUAL: G98 G84 Z-\.4 R\.2 F25\.$/m);
    assert.equal(r.manual, 1);
    assert.ok(r.notes.some(n => /G84 not converted: write the matching CYCLE8x call \(CYCLE84 rigid tapping\)/.test(n.message)));
  });
  it('macros are not converted', () => {
    const t = convertProgram('#100=5\nG0 X#100\nM30\n', 'fanuc', 'siemens');
    assert.equal(t.manual, 2);
    assert.match(t.text, /JL MANUAL: #100=5/);
  });
  it('M98/M99 → L-call/M17', () => {
    const t = convertProgram('M98 P1234\nM99', 'fanuc', 'siemens');
    assert.deepEqual(t.text.split('\n'), ['L1234', 'M17']);
  });
});

describe('Dialect convert: Fanuc → Okuma OSP', () => {
  const r = convertProgram(mill, 'fanuc', 'okuma');
  it('G43 → G56, G54 → G15 H1, G49 → G53, without re-reading G56 as a work offset', () => {
    assert.match(r.text, /^G56 H1 Z1\. M8$/m);
    assert.match(r.text, /^G0 G90 G15 H1 X0\. Y0\. S6000 M3$/m);
    assert.match(r.text, /^G0 G17 G40 G53 G80 G90$/m);
    assert.ok(!/G15 H3/.test(r.text));
  });
  it('G28 left manual, its M-codes kept', () => {
    assert.match(r.text, /\(JL MANUAL: G91 G28 Z0\. M9\)\nM9/);
    assert.equal(r.manual, 3);
  });
  it('M98/M99 → CALL/RTS', () => {
    const t = convertProgram('M98 P100\nM99', 'fanuc', 'okuma');
    assert.deepEqual(t.text.split('\n'), ['CALL O100', 'RTS']);
  });
});

describe('Dialect convert: Fanuc → Heidenhain Klartext', () => {
  const r = convertProgram(mill, 'fanuc', 'heidenhain');
  const lines = r.text.split('\n');
  it('wraps in BEGIN/END PGM with units and numbers every block', () => {
    assert.equal(lines[0], '0 BEGIN PGM O1001 INCH');
    assert.match(lines[lines.length - 1], /^\d+ END PGM O1001 INCH$/);
    const numbered = lines.filter(l => !l.startsWith('  Q')).map(l => parseInt(l, 10));
    numbered.forEach((n, i) => assert.equal(n, i));
  });
  it('tool change, rapid, feed moves', () => {
    assert.ok(lines.some(l => /^\d+ TOOL CALL 1 Z S6000$/.test(l)));
    assert.ok(lines.some(l => /^\d+ L X\+0 Y\+0 R0 FMAX M3$/.test(l)));
    assert.ok(lines.some(l => /^\d+ L Z-0\.25 R0 F20$/.test(l)));
  });
  it('G81 → CYCL DEF 200 with depth from the R plane and M99 calls', () => {
    assert.ok(lines.some(l => /CYCL DEF 200 DRILLING ~$/.test(l)));
    assert.ok(lines.includes('  Q201=-0.6 ;DEPTH ~'));
    assert.ok(lines.includes('  Q203=+0.1 ;SURFACE COORDINATE ~'));
    assert.ok(lines.includes('  Q204=+0.9 ;2ND SET-UP CLEARANCE ~'));
    assert.ok(lines.some(l => /^\d+ L X\+1\.5 R0 FMAX M99$/.test(l)));
  });
  it('arcs: I/J → CC + C, R → CR', () => {
    const t = convertProgram('G21\nG90 G17\nG0 X0 Y0\nG1 X10 Y0 F100\nG2 X20 Y0 I5 J0\nG3 X30 Y0 R5\nM30\n', 'fanuc', 'heidenhain');
    assert.match(t.text, /CC X\+15 Y\+0\n\d+ C X\+20 Y\+0 DR- R0 F100/);
    assert.match(t.text, /CR X\+30 Y\+0 R\+5 DR\+ R0 F100/);
    assert.deepEqual(errorsOn(t.text, 'heidenhain'), []);
  });
});

describe('Dialect convert: within the Fanuc family', () => {
  it('Haas: 5-digit O-number, G43.4 → G234', () => {
    const t = convertProgram('O1001\nG43.4 H1 Z1.\nM30', 'fanuc', 'haas');
    assert.deepEqual(t.text.split('\n'), ['O01001', 'G234 H1 Z1.', 'M30']);
  });
  it('Haas → Fanuc: M97 left manual, G234 → G43.4', () => {
    const t = convertProgram('O01001\nM97 P100\nG234 H1 Z1.\nM30\nN100 M99\n', 'haas', 'fanuc');
    assert.match(t.text, /JL MANUAL: M97 P100/);
    assert.match(t.text, /G43\.4 H1 Z1\./);
    assert.match(t.text, /^O1001$/m);
  });
  it('program number too long for the target is a note, not a silent truncation', () => {
    const t = convertProgram('O123456\nM30\n', 'mazak', 'fanuc');
    assert.match(t.text, /^O123456$/m);
    assert.ok(t.notes.some(n => /more digits than Fanuc/.test(n.message)));
  });
});
