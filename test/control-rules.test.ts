/**
 * Per-control validation rules.
 * Run: npm run test:control-rules
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  runControlRules, normalizeControl, isHeidenhainKlartext, isHeidenhainIso, CONTROL_PROFILES, genericRulesApply, looksLikeMazatrol,
} from '../src/diagnostics/controlRules';
import { runDiagnosticEngine, DEFAULT_CONFIG } from '../src/diagnostics/engine';
import { Tokenizer } from '../src/parser/tokenizer';
import { BlockParser } from '../src/parser/blockParser';
import { ProgramModelBuilder } from '../src/parser/programModel';
import type { EngineDiagnostic } from '../src/diagnostics/engine';

const dir = path.resolve(__dirname, 'fixtures', 'controls');
const read = (n: string) => fs.readFileSync(path.join(dir, n), 'utf8');
const lines = (d: EngineDiagnostic[], sev?: string) => d.filter(x => !sev || x.severity === sev).map(x => x.line + 1);
const has = (d: EngineDiagnostic[], line: number, re: RegExp) => d.some(x => x.line + 1 === line && re.test(x.message));

function engine(text: string, controlType: string) {
  const blocks = new BlockParser().parseDocument(new Tokenizer().tokenizeDocument(text));
  const model = new ProgramModelBuilder().build(blocks, controlType);
  return runDiagnosticEngine(blocks, model.stateAtBlock, { ...DEFAULT_CONFIG, controlType, sourceText: text });
}

describe('Control rules: control selection', () => {
  it('normalises settings and .jblmachine families', () => {
    assert.equal(normalizeControl('Sinumerik 840D'), 'siemens');
    assert.equal(normalizeControl('OSP-P300'), 'okuma');
    assert.equal(normalizeControl('Meldas M80'), 'mitsubishi');
    assert.equal(normalizeControl('TNC 640'), 'heidenhain');
    assert.equal(normalizeControl('linuxcnc'), 'generic');
    assert.equal(normalizeControl(undefined), 'fanuc');
    assert.equal(normalizeControl('fanuc', read('heidenhain-klartext.h')), 'heidenhain', 'content wins for Klartext');
  });
  it('every control has its own profile and summary', () => {
    const ids = Object.keys(CONTROL_PROFILES);
    for (const id of ['fanuc', 'haas', 'siemens', 'okuma', 'mazak', 'fadal', 'mitsubishi', 'heidenhain', 'generic']) assert.ok(ids.includes(id), id);
    assert.equal(new Set(Object.values(CONTROL_PROFILES).map(p => p.summary)).size, ids.length);
  });
  it('the same program gets different results on different controls', () => {
    const text = 'O1000\nT1 M6\nG43 H1 Z1.\n#100=1\nG81 Z-1. R.1 F10.\nG80\nM30\n';
    const fanuc = runControlRules(text, 'fanuc').filter(d => d.severity !== 'info');
    const siemens = runControlRules(text, 'siemens');
    const okuma = runControlRules(text, 'okuma');
    assert.equal(fanuc.length, 0, JSON.stringify(fanuc));
    assert.ok(has(siemens, 3, /not tool length compensation on 840D/));
    assert.ok(has(siemens, 4, /Fanuc # variables are not valid in Siemens mode/));
    assert.ok(has(siemens, 5, /use CYCLE81/));
    assert.ok(has(okuma, 3, /use G56/));
    assert.ok(has(okuma, 4, /V variables/));
  });
});

describe('Control rules: Fanuc Macro B', () => {
  const d = runControlRules(read('fanuc-macro-bad.nc'), 'fanuc');
  it('program number, variable ranges, brackets', () => {
    assert.ok(has(d, 2, /O123456 is longer than 4 digits/));
    assert.ok(has(d, 3, /#50 is not a Fanuc/));
    assert.ok(has(d, 4, /#1001 is a read-only interface input/));
    assert.ok(has(d, 5, /Unbalanced \[ \]/));
  });
  it('loops, GOTO targets, group conflicts, M-code count', () => {
    assert.ok(has(d, 7, /DO 1 is already open on line 6/));
    assert.ok(has(d, 10, /GOTO 900: there is no N900/));
    assert.ok(has(d, 11, /G0 and G1 are both motion codes/));
    assert.ok(has(d, 12, /G90 and G91/));
    assert.ok(has(d, 13, /G43 without H/));
    assert.ok(has(d, 14, /4 M-codes in one block/));
    assert.ok(has(d, 15, /END 2 closes DO 1/));
  });
  it('a well-formed macro program is error-free', () => {
    const ok = runControlRules('O0001\n#1=0\nWHILE [#1 LT 3] DO1\n#1=#1+1\nIF [#1 EQ 2] GOTO 10\nEND1\nN10 M30\n', 'fanuc');
    assert.deepEqual(lines(ok, 'error'), []);
  });
  it('unknown G-codes are information only', () => {
    const r = runControlRules('G0 X0\nG999 X1\n', 'fanuc');
    assert.deepEqual(r.map(x => x.severity), ['info']);
  });
  it('writable output signals (#1100+) and common variables are allowed', () => {
    assert.deepEqual(lines(runControlRules('#1100=1\n#500=2\n#33=1\n', 'fanuc'), 'error'), []);
  });
});

describe('Control rules: Haas NGC', () => {
  const d = runControlRules(read('haas-m97.nc'), 'haas');
  it('M97 must point at an N label in the same program', () => {
    assert.deepEqual(lines(d, 'error'), [5]);
    assert.ok(has(d, 5, /M97 P2000: there is no N2000/));
  });
  it('Haas-only codes are known on Haas, M97 is flagged elsewhere', () => {
    assert.ok(!d.some(x => /G234/.test(x.message)));
    const f = runControlRules('M97 P10\nN10 M99\n', 'fanuc');
    assert.ok(has(f, 1, /M97 is a Haas local-subprogram call/));
  });
  it('5-digit program numbers are fine on Haas', () => {
    assert.equal(runControlRules('O01234\nM30\n', 'haas').length, 0);
  });
});

describe('Control rules: Siemens 840D', () => {
  it('a valid structured program has no errors', () => {
    const d = runControlRules(read('siemens-good.mpf'), 'siemens');
    assert.deepEqual(d.filter(x => x.severity !== 'info'), []);
  });
  it('finds DEF placement, Fanuc-isms, R range, unclosed IF, labels, MCALL', () => {
    const d = runControlRules(read('siemens-bad.mpf'), 'siemens');
    assert.ok(has(d, 3, /DEF must come before/));
    assert.ok(has(d, 4, /G43 is not tool length/));
    assert.ok(has(d, 5, /Fanuc # variables/));
    assert.ok(has(d, 6, /G81 is an ISO canned cycle/));
    assert.ok(has(d, 7, /MCALL is still active/));
    assert.ok(has(d, 9, /IF is never closed/));
    assert.ok(has(d, 10, /R1000/));
    assert.ok(has(d, 11, /GOTOB NOWHERE: label not found/));
    assert.ok(has(d, 12, /M98 is ISO-mode/));
    assert.ok(has(d, 13, /CYCLE call without its parameter list/));
    assert.ok(d.some(x => /no end/.test(x.message)));
  });
  it('GOTOF to a label above is an error', () => {
    const d = runControlRules('TOP: G0 X0\nGOTOF TOP\nM30\n', 'siemens');
    assert.ok(has(d, 2, /GOTOF searches forward/));
  });
  it('G291 ISO mode switches the Siemens rules off for that section', () => {
    const d = runControlRules('G291\nG43 H1 Z1\n#100=1\nG290\nM30\n', 'siemens');
    assert.deepEqual(d, []);
  });
  it('the existing CYCLE83 fixture only gets the G43 note', () => {
    const d = runControlRules(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'siemens', 'cycle83-drill.nc'), 'utf8'), 'siemens');
    assert.deepEqual(d.filter(x => x.severity !== 'info').map(x => x.line + 1), [6]);
  });
});

describe('Control rules: Okuma OSP', () => {
  const d = runControlRules(read('okuma-bad.min'), 'okuma');
  it('G43, # variables, missing N-label, called sub without RTS', () => {
    assert.ok(has(d, 3, /use G56/));
    assert.ok(has(d, 4, /V variables/));
    assert.ok(has(d, 7, /Jump to NEND/));
    assert.ok(has(d, 10, /O2000 is called but has no RTS/));
    assert.ok(!d.some(x => /O3000|O1000/.test(x.message)), 'O3000 ends in RTS; O1000 is not called');
  });
  it('the existing OSP lathe fixture has no errors', () => {
    const r = runControlRules(fs.readFileSync(path.resolve(__dirname, 'fixtures', 'okuma', 'facing-od-rough.nc'), 'utf8'), 'okuma');
    assert.deepEqual(lines(r, 'error'), []);
  });
});

describe('Control rules: Fadal, Mazak, Mitsubishi, generic', () => {
  it('Fadal macro labels, V range, Macro B flagged', () => {
    const d = runControlRules(read('fadal-macro.nc'), 'fadal');
    assert.ok(has(d, 8, /GOTO :MISSING/));
    assert.ok(!d.some(x => /:LOOP/.test(x.message)));
    assert.ok(has(d, 9, /V1–V100/));
    assert.ok(has(d, 10, /Fanuc Macro B syntax/));
    assert.ok(has(d, 11, /G43 without H/));
  });
  it('Mazak: 8-digit program numbers allowed; Mazatrol detected and skipped', () => {
    assert.deepEqual(runControlRules('O12345678\nG0 X0\nM30\n', 'mazak'), []);
    const maz = 'UNo. MAT INITIAL-D MAX-D\n' + '\x01\x02\x03'.repeat(10);
    assert.ok(looksLikeMazatrol(maz));
    assert.match(runControlRules(maz, 'mazak')[0].message, /Mazatrol/);
    assert.equal(genericRulesApply('mazak', maz), false);
  });
  it('Mitsubishi: own G list, 4 M-codes allowed, variable ranges', () => {
    const d = runControlRules(read('mitsubishi.nc'), 'mitsubishi');
    assert.ok(!d.some(x => /G120\.1|G66|M-codes/.test(x.message)), JSON.stringify(d));
    assert.ok(has(d, 4, /#60 is not a Mitsubishi/));
    assert.ok(has(d, 6, /G999 is not in JobLine's Mitsubishi/));
    const f = runControlRules('G120.1 X0\n', 'fanuc');
    assert.ok(f.some(x => /G120\.1/.test(x.message)), 'G120.1 is Mitsubishi-only');
  });
  it('LinuxCNC O-word structure', () => {
    const d = runControlRules(read('linuxcnc.ngc'), 'generic');
    assert.ok(has(d, 11, /o300 endif closes o300 while/));
    assert.ok(has(d, 12, /look for a file named 400\.ngc/));
    assert.ok(!d.some(x => x.line + 1 < 10 && x.severity === 'error'));
  });
});

describe('Control rules: Heidenhain', () => {
  it('detects Klartext and ISO', () => {
    assert.ok(isHeidenhainKlartext(read('heidenhain-klartext.h')));
    assert.ok(isHeidenhainIso(read('heidenhain-iso.i')));
    assert.ok(!isHeidenhainKlartext('G0 X0\n'));
  });
  it('a valid Klartext program (contours, arcs, cycle, labels) is clean', () => {
    const d = runControlRules(read('heidenhain-klartext.h'), 'heidenhain');
    assert.deepEqual(d, []);
  });
  it('finds Klartext structure and syntax errors', () => {
    const d = runControlRules(read('heidenhain-bad.h'), 'heidenhain');
    assert.ok(has(d, 2, /TOOL CALL without a spindle axis/));
    assert.ok(has(d, 3, /ISO G-word in a Klartext program/));
    assert.ok(has(d, 4, /needs a circle centre/));
    assert.ok(has(d, 5, /CR needs a radius/));
    assert.ok(has(d, 6, /Q2500/));
    assert.ok(has(d, 7, /CALL LBL 7: there is no LBL 7/));
    assert.ok(has(d, 8, /LBL 2 is not closed/));
    assert.ok(has(d, 9, /END PGM WRONG does not match BEGIN PGM BAD/));
    assert.ok(has(d, 9, /INCH but BEGIN PGM is MM/));
  });
  it('Heidenhain ISO header/footer and block checks', () => {
    const d = runControlRules(read('heidenhain-iso.i'), 'heidenhain');
    assert.deepEqual(d.map(x => x.line + 1), [6]);
    const bad = runControlRules('%P1 G71 *\nG00 X1 *\nN99 %P2 G70 *\n', 'heidenhain');
    assert.ok(has(bad, 2, /start with an N block number/));
    assert.ok(has(bad, 3, /%P2 does not match %P1/));
    assert.ok(has(bad, 3, /G70 but the header is G71/));
  });
  it('a G-code program with Heidenhain selected says no checks ran', () => {
    assert.match(runControlRules('G0 X0\n', 'heidenhain')[0].message, /no Heidenhain checks ran/);
  });
});

describe('Control rules: wired into the diagnostics engine', () => {
  it('Klartext skips the ISO rules entirely (no false canned-cycle or arc errors)', () => {
    const d = engine(read('heidenhain-klartext.h'), 'heidenhain');
    assert.deepEqual(d, []);
  });
  it('engine adds control rules when sourceText is given, and not otherwise', () => {
    const text = 'T1 M6\nG43 H1 Z1.\n#100=1\nM30\n';
    const blocks = new BlockParser().parseDocument(new Tokenizer().tokenizeDocument(text));
    const model = new ProgramModelBuilder().build(blocks, 'siemens');
    const without = runDiagnosticEngine(blocks, model.stateAtBlock, { ...DEFAULT_CONFIG, controlType: 'siemens' });
    const withRules = engine(text, 'siemens');
    assert.ok(withRules.length > without.length);
    assert.ok(withRules.some(x => /Fanuc # variables/.test(x.message)));
  });
  it('existing generic results are unchanged for Fanuc programs', () => {
    const text = fs.readFileSync(path.resolve(__dirname, 'fixtures', 'diagnostics', 'cycle-missing-r.nc'), 'utf8');
    const d = engine(text, 'fanuc');
    assert.ok(d.some(x => /requires R/.test(x.message)));
  });
});
