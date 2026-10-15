/**
 * Tool-library import + checker tests.
 * Run: npm run test:tool-library
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseToolLibrary, parseToolCsv, parseFusionToolLibraryJson, parseHsmLibrary, headerField,
  decodeText, describeLibraryTool, parseDelimited,
} from '../src/tooling/toolLibrary';
import { checkProgramAgainstLibrary } from '../src/tooling/toolLibraryCheck';
import { importToolLibrary, extractToolsFromGCode } from '../src/providers/visualizer/camIntegration';
import { Tokenizer } from '../src/parser/tokenizer';
import { BlockParser } from '../src/parser/blockParser';
import { ProgramModelBuilder } from '../src/parser/programModel';

const dir = path.resolve(__dirname, 'fixtures', 'tool-library');
const bytes = (name: string) => new Uint8Array(fs.readFileSync(path.join(dir, name)));

function model(text: string, dialect = 'fanuc') {
  const blocks = new BlockParser().parseDocument(new Tokenizer().tokenizeDocument(text));
  return { blocks, ...new ProgramModelBuilder().build(blocks, dialect) };
}

describe('Tool library: Fusion JSON', () => {
  it('reads number, H, D, diameter, flute and gauge length, unit', () => {
    const lib = parseToolLibrary('fusion-library.json', bytes('fusion-library.json'));
    assert.equal(lib.format, 'fusion-json');
    assert.deepEqual(lib.tools.map(t => t.number), [1, 2, 3]);
    const t1 = lib.tools[0];
    assert.equal(t1.lengthOffset, 1);
    assert.equal(t1.diameterOffset, 1);
    assert.equal(t1.diameter, 0.5);
    assert.equal(t1.fluteLength, 1);
    assert.equal(t1.gaugeLength, 3.25, 'assemblyGaugeLength wins over LB');
    assert.equal(t1.unit, 'in');
    assert.equal(lib.tools[1].gaugeLength, 2, 'LB used when no assembly gauge length');
    assert.equal(lib.tools[2].lengthOffset, 13);
  });
  it('skips holders silently and warns about unnumbered tools', () => {
    const lib = parseToolLibrary('fusion-library.json', bytes('fusion-library.json'));
    assert.equal(lib.warnings.length, 1);
    assert.match(lib.warnings[0], /Unnumbered chamfer mill.*no tool number/);
  });
  it('reads a .tools archive (ZIP holding the JSON)', () => {
    const lib = parseToolLibrary('library.tools', bytes('library.tools'));
    assert.equal(lib.format, 'fusion-tools');
    assert.equal(lib.tools.length, 3);
  });
  it('accepts a bare array and reports duplicates once per number', () => {
    const text = JSON.stringify([1, 2, 3].map(() => ({ description: 'Vendor tool', 'post-process': { number: 1 }, geometry: { DC: 3 } })));
    const lib = parseFusionToolLibraryJson(text, 'vendor.json');
    assert.equal(lib.tools.length, 1);
    assert.equal(lib.warnings.length, 1);
    assert.match(lib.warnings[0], /3 entries use T1/);
  });
  it('rejects JSON that is not a tool library', () => {
    assert.throws(() => parseFusionToolLibraryJson('{"foo":1}', 'x.json'), /no "data" array/);
    assert.throws(() => parseFusionToolLibraryJson('{oops', 'x.json'), /not valid JSON/);
  });
});

describe('Tool library: HSMWorks / Inventor CAM .hsmlib', () => {
  it('decodes UTF-16 with BOM and reads nc + body', () => {
    const lib = parseToolLibrary('library.hsmlib', bytes('library.hsmlib'));
    assert.equal(lib.format, 'hsmlib');
    assert.deepEqual(lib.tools.map(t => t.number), [1, 4], 'probe skipped');
    const t4 = lib.tools[1];
    assert.equal(t4.description, 'R3 BALL & NECK');
    assert.equal(t4.diameter, 6);
    assert.equal(t4.cornerRadius, 3);
    assert.equal(t4.fluteLength, 12);
    assert.equal(t4.gaugeLength, 30);
    assert.equal(t4.unit, 'mm');
    assert.equal(lib.tools[0].unit, 'in');
  });
  it('does not mistake <tool-library> for a tool', () => {
    const lib = parseHsmLibrary('<tool-library><tool type="drill" unit="inches"><nc number="9" length-offset="9"/><body diameter="0.25"/></tool></tool-library>');
    assert.equal(lib.tools.length, 1);
    assert.equal(lib.tools[0].number, 9);
  });
  it('decodeText handles BOM-less UTF-16 XML', () => {
    const s = '<x/>';
    const b = new Uint8Array(Buffer.from(s, 'utf16le'));
    assert.equal(decodeText(b), s);
  });
});

describe('Tool library: CSV', () => {
  it('reads T, H, D, diameter, flute length, gauge length, description below a title row', () => {
    const lib = parseToolLibrary('generic-tools.csv', bytes('generic-tools.csv'));
    assert.equal(lib.format, 'csv');
    assert.deepEqual(lib.tools.map(t => t.number), [1, 2, 3]);
    assert.deepEqual(
      { ...lib.tools[1] },
      { number: 2, lengthOffset: 2, diameterOffset: 2, diameter: 0.201, fluteLength: 1.2, gaugeLength: 4.1, description: '#7 DRILL' },
    );
    assert.equal(lib.tools[0].description, '1/2 FLAT ENDMILL, 3FL', 'quoted comma kept');
    assert.equal(lib.tools[2].description, '1/4-20 TAP "SPIRAL POINT"', 'doubled quotes unescaped');
    assert.equal(lib.warnings.length, 1, 'non-numeric tool row reported');
  });
  it('detects semicolon delimiters and alternative header names', () => {
    const lib = parseToolLibrary('semicolon-tools.csv', bytes('semicolon-tools.csv'));
    assert.deepEqual({ ...lib.tools[0] }, { number: 5, lengthOffset: 5, diameterOffset: 5, diameter: 10, fluteLength: 22, gaugeLength: 45, description: 'D10 END MILL' });
  });
  it('reads Fusion CSV export headers "Label (tool_id)"', () => {
    const lib = parseToolLibrary('fusion-export.csv', bytes('fusion-export.csv'));
    assert.deepEqual({ ...lib.tools[0] }, { number: 7, lengthOffset: 7, diameterOffset: 7, diameter: 12, fluteLength: 26, gaugeLength: 40, description: 'D12 ROUGHER', unit: 'mm' });
  });
  it('explains what columns it needs when there is no tool column', () => {
    assert.throws(() => parseToolCsv('a,b\n1,2', 'bad.csv'), /tool-number column/);
  });
  it('header mapping keeps H and D apart from diameter', () => {
    assert.equal(headerField('H'), 'lengthOffset');
    assert.equal(headerField('D'), 'diameterOffset');
    assert.equal(headerField('Dia.'), 'diameter');
    assert.equal(headerField('Diameter'), 'diameter');
    assert.equal(headerField('Tool #'), 'number');
    assert.equal(headerField('Gauge Length'), 'gaugeLength');
    assert.equal(headerField('Flute Length'), 'fluteLength');
    assert.equal(headerField('Spindle'), undefined);
  });
  it('parseDelimited handles CRLF and embedded newlines', () => {
    assert.deepEqual(parseDelimited('T,Desc\r\n1,"two\nlines"\r\n'), [['T', 'Desc'], ['1', 'two\nlines']]);
  });
  it('unsupported extension is an error', () => {
    assert.throws(() => parseToolLibrary('x.pdf', new Uint8Array([1, 2, 3])), /Unsupported tool library/);
  });
  it('describeLibraryTool summarises a tool for the tool table', () => {
    const lib = parseToolLibrary('fusion-library.json', bytes('fusion-library.json'));
    assert.equal(describeLibraryTool(lib.tools[0]), '1/2 FLAT ENDMILL · Ø0.5" FL 1 GL 3.25 H1 D1');
  });
});

describe('Tool library: camIntegration stubs are now real', () => {
  it('importToolLibrary returns CamTools from a File-like object', async () => {
    const data = bytes('generic-tools.csv');
    const tools = await importToolLibrary({ name: 'generic-tools.csv', arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer });
    assert.equal(tools.length, 3);
    assert.equal(tools[0].id, 'T1');
    assert.equal(tools[0].size, 0.5);
  });
  it('extractToolsFromGCode reads T-calls and the header tool list', () => {
    const tools = extractToolsFromGCode('(T1 D=10. CR=0. - FLAT END MILL)\nG21\nT1 M6\nG43 H1 Z10\nM30\n');
    assert.equal(tools.length, 1);
    assert.equal(tools[0].size, 10);
    assert.equal(tools[0].lengthOffset, 1);
  });
});

describe('Tool library checker', () => {
  const lib = parseToolLibrary('generic-tools.csv', bytes('generic-tools.csv'));
  const check = (text: string, controlType = 'fanuc') => {
    const m = model(text, controlType);
    return checkProgramAgainstLibrary({ blocks: m.blocks, stateAtBlock: m.stateAtBlock, tools: m.tools, library: lib, controlType });
  };

  it('a matching program is clean', () => {
    const r = check('G20\nT1 M6\nG43 H1 Z1.\nG41 D1 X1.\nT3 M6\nG43 H13 Z1.\nM30\n');
    assert.equal(r.diagnostics.length, 0, JSON.stringify(r.diagnostics));
    assert.equal(r.status.get(1)?.status, 'ok');
  });
  it('flags a tool that is not in the library', () => {
    const r = check('T9 M6\nG43 H9 Z1.\nM30\n');
    assert.equal(r.status.get(9)?.status, 'missing');
    assert.match(r.diagnostics[0].message, /T9 is not in the tool library "generic-tools.csv"/);
    assert.equal(r.diagnostics[0].line, 0);
  });
  it('flags T/H mismatch against the library register', () => {
    const r = check('T3 M6\nG43 H3 Z1.\nM30\n');
    assert.equal(r.diagnostics.length, 1);
    assert.match(r.diagnostics[0].message, /T\/H mismatch: T3 uses H3 but the library sets H13/);
    assert.equal(r.diagnostics[0].line, 1);
    assert.equal(r.status.get(3)?.status, 'mismatch');
  });
  it('flags T/D mismatch on cutter comp', () => {
    const r = check('T1 M6\nG43 H1 Z1.\nG41 D11 X1.\nM30\n');
    assert.match(r.diagnostics[0].message, /T\/D mismatch: T1 uses D11 but the library sets D1/);
  });
  it('flags a comment diameter that disagrees with the library', () => {
    const r = check('G20\nT1 M6 (0.375 DIA ENDMILL)\nG43 H1 Z1.\nM30\n');
    assert.ok(r.diagnostics.some(d => /T1 diameter mismatch/.test(d.message)), JSON.stringify(r.diagnostics));
  });
  it('compares diameters across units', () => {
    const metric = parseToolLibrary('fusion-export.csv', bytes('fusion-export.csv')); // T7 Ø12 mm
    const m = model('G20\nT7 M6 (0.4724 DIA)\nG43 H7 Z1.\nM30\n');
    const r = checkProgramAgainstLibrary({ blocks: m.blocks, stateAtBlock: m.stateAtBlock, tools: m.tools, library: metric });
    assert.equal(r.diagnostics.length, 0, JSON.stringify(r.diagnostics));
  });
  it('skips H/D register checks on Siemens (length comes from D)', () => {
    const r = check('T3 D1\nM6\nG43 H3 Z1.\nM30\n', 'siemens');
    assert.ok(!r.diagnostics.some(d => /T\/H/.test(d.message)));
  });
  it('reports one T/H mismatch per tool/register pair, not per block', () => {
    const r = check('T3 M6\nG43 H3 Z1.\nG43 H3 Z2.\nM30\n');
    assert.equal(r.diagnostics.filter(d => /T\/H/.test(d.message)).length, 1);
  });
  it('decodes lathe T0101 to tool 1', () => {
    const r = checkProgramAgainstLibrary({ ...(() => { const m = model('G96 S200 M3\nT0101\nG0 X50 Z2\nM30\n'); return { blocks: m.blocks, stateAtBlock: m.stateAtBlock, tools: m.tools }; })(), library: lib, lathe: true });
    assert.ok(!r.diagnostics.some(d => /T101/.test(d.message)), JSON.stringify(r.diagnostics));
    assert.equal(r.status.get(1)?.status, 'ok');
  });
});
