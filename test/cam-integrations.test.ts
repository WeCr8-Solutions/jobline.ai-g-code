/**
 * CAM output integrations: detection, setup sheets, program links, folder connections.
 * Run: npm run test:cam-integrations
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CAM_SYSTEMS, detectCamSystem, extractToolsFromNcComments, parseSetupSheet, parseSetupSheetHtml,
  parseSetupSheetXml, findSetupSheetCandidates, htmlTables, isNcFileName,
} from '../src/cam/camSources';
import { FolderCamConnection, linkProgram, CamFolderIO } from '../src/cam/folderConnection';
import { EspritCamConnection, MastercamConnection, Fusion360Connection, GibbsCamConnection, HexagonCamConnection, CuraConnection } from '../src/providers/visualizer/cam';
import { connectToEspritCAM, connectToOtherCAM } from '../src/providers/visualizer/latheInserts/index';
import { checkProgramAgainstLibrary } from '../src/tooling/toolLibraryCheck';
import { Tokenizer } from '../src/parser/tokenizer';
import { BlockParser } from '../src/parser/blockParser';
import { ProgramModelBuilder } from '../src/parser/programModel';

const dir = path.resolve(__dirname, 'fixtures', 'cam-output');
const read = (n: string) => fs.readFileSync(path.join(dir, n), 'utf8');
const bytes = (n: string) => new Uint8Array(fs.readFileSync(path.join(dir, n)));

/** In-memory folder for connection tests. */
function memoryIO(files: Record<string, { text: string; mtime: number }>, folder = '/cam/out'): CamFolderIO {
  return {
    exists: p => p === folder,
    list: d => (d === folder ? Object.entries(files).map(([name, f]) => ({ name, mtimeMs: f.mtime })) : []),
    read: p => {
      const name = path.basename(p);
      if (!files[name]) throw new Error('ENOENT ' + p);
      return new TextEncoder().encode(files[name].text);
    },
  };
}

describe('CAM: system detection from the NC header', () => {
  it('recognises Mastercam, ESPRIT and Fusion posts', () => {
    assert.equal(detectCamSystem(read('1001.nc')), 'mastercam');
    assert.equal(detectCamSystem(read('LB-SHAFT.min')), 'esprit');
    assert.equal(detectCamSystem(read('2002.nc')), 'fusion');
  });
  it('recognises GibbsCAM, EDGECAM and slicers; unknown otherwise', () => {
    assert.equal(detectCamSystem('%\nO1 (GIBBSCAM 2024 POST)\nG0 X0\n'), 'gibbscam');
    assert.equal(detectCamSystem('(EDGECAM 2025.1)\nG0 X0\n'), 'hexagon');
    assert.equal(detectCamSystem(';FLAVOR:Marlin\n;Generated with Cura_SteamEngine 5.7\nG28\n'), 'slicer');
    assert.equal(detectCamSystem('O1 (OP1)\nG0 X0\n'), 'unknown');
    assert.equal(detectCamSystem('G0 X0\n'), 'unknown');
  });
  it('every integration states what it does and does not do', () => {
    for (const s of CAM_SYSTEMS) {
      assert.ok(s.does.length > 20, s.id);
      assert.match(s.doesNot, /^No |not /i, s.id);
    }
  });
});

describe('CAM: tool list from NC header comments', () => {
  it('Mastercam pipe format', () => {
    const lib = extractToolsFromNcComments(read('1001.nc'));
    assert.deepEqual(lib.tools.map(t => [t.number, t.lengthOffset, t.diameterOffset, t.diameter, t.description]), [
      [1, 1, 1, 0.5, '1/2 FLAT ENDMILL'],
      [2, 2, 2, 0.201, '#7 DRILL'],
      [3, 3, 3, 0.25, '1/4-20 TAP'],
    ]);
    assert.equal(lib.tools[0].unit, 'in');
  });
  it('Fusion "T1 D=10. CR=0." format', () => {
    const lib = extractToolsFromNcComments(read('2002.nc'));
    assert.deepEqual(lib.tools.map(t => [t.number, t.diameter, t.cornerRadius, t.description, t.unit]), [
      [1, 10, 0, 'FLAT END MILL', 'mm'],
      [5, 6, 3, 'BALL END MILL', 'mm'],
    ]);
  });
  it('ignores tool-change blocks and comments that do not start with T', () => {
    const lib = extractToolsFromNcComments('T1 M6 (T1 IS A DRILL)\n(NOTE T2 LATER)\n');
    assert.equal(lib.tools.length, 0);
  });
});

describe('CAM: setup sheets', () => {
  it('Mastercam-style HTML column table', () => {
    const lib = parseSetupSheet('1001.html', bytes('1001.html'));
    assert.equal(lib.format, 'setup-sheet-html');
    assert.deepEqual(lib.tools.map(t => [t.number, t.diameter, t.fluteLength, t.gaugeLength, t.lengthOffset, t.diameterOffset, t.unit]), [
      [1, 0.5, 1, 1.75, 1, 1, 'in'],
      [2, 0.201, 1.2, 2, 2, 2, 'in'],
      [3, 0.25, 0.6, 1.8, 3, 3, 'in'],
    ]);
    assert.equal(lib.tools[0].description, '1/2 FLAT ENDMILL');
  });
  it('Fusion-style HTML with one key/value table per tool', () => {
    const lib = parseSetupSheet('2002-setup-sheet.html', bytes('2002-setup-sheet.html'));
    assert.deepEqual(lib.tools.map(t => [t.number, t.diameter, t.lengthOffset, t.fluteLength, t.cornerRadius, t.unit]), [
      [1, 10, 1, 22, 0, 'mm'],
      [5, 6, 5, 12, 3, 'mm'],
    ]);
  });
  it('ESPRIT-style XML tool list', () => {
    const lib = parseSetupSheet('LB-SHAFT_setup.xml', bytes('LB-SHAFT_setup.xml'));
    assert.equal(lib.format, 'setup-sheet-xml');
    assert.deepEqual(lib.tools.map(t => [t.number, t.description, t.cornerRadius, t.lengthOffset, t.type, t.unit]), [
      [1, 'OD ROUGH CNMG432', 0.8, 1, 'Turning', 'mm'],
      [2, 'OD FINISH VNMG331', 0.4, 2, 'Turning', 'mm'],
    ]);
  });
  it('XML with attributes instead of child elements', () => {
    const lib = parseSetupSheetXml('<tools><tool number="4" diameter="8" lengthoffset="4" description="D8 EM"/></tools>');
    assert.deepEqual({ ...lib.tools[0] }, { number: 4, diameter: 8, lengthOffset: 4, description: 'D8 EM' });
  });
  it('a sheet without a tool table is an error that says what is missing', () => {
    assert.throws(() => parseSetupSheetHtml('<html><table><tr><td>Program</td><td>1</td></tr></table></html>'), /no tool table/);
  });
  it('htmlTables handles colspan, entities and unclosed cells', () => {
    const t = htmlTables('<table><tr><th colspan="2">A&amp;B</th><td>&Oslash;10<tr><td>x</td></table>');
    assert.deepEqual(t[0], [['A&B', '', 'Ø10'], ['x']]);
  });
});

describe('CAM: linking a program to its setup sheet', () => {
  it('finds sheets by program name, best match first', () => {
    const names = ['1001.nc', '1001_setup.xml', '1001.html', 'Setup Sheet 1001.htm', '1002.html', 'notes.txt'];
    assert.deepEqual(findSetupSheetCandidates('1001.nc', names), ['1001.html', '1001_setup.xml', 'Setup Sheet 1001.htm']);
    assert.deepEqual(findSetupSheetCandidates('A.nc', ['B.html']), []);
    assert.deepEqual(findSetupSheetCandidates('A.nc', ['tool list.csv']), ['tool list.csv'], 'lone sheet offered last');
  });
  it('links the fixture folder and feeds the checker (T3 H33 vs H3)', () => {
    const real: CamFolderIO = {
      exists: p => fs.existsSync(p),
      list: d => fs.readdirSync(d).map(name => ({ name, mtimeMs: 0 })),
      read: p => new Uint8Array(fs.readFileSync(p)),
    };
    const link = linkProgram(path.join(dir, '1001.nc'), real);
    assert.equal(link.camSystem, 'mastercam');
    assert.equal(path.basename(link.setupSheetPath ?? ''), '1001.html');
    const text = read('1001.nc');
    const blocks = new BlockParser().parseDocument(new Tokenizer().tokenizeDocument(text));
    const m = new ProgramModelBuilder().build(blocks, 'fanuc');
    const r = checkProgramAgainstLibrary({ blocks, stateAtBlock: m.stateAtBlock, tools: m.tools, library: link.library!, controlType: 'fanuc' });
    assert.equal(r.diagnostics.length, 1, JSON.stringify(r.diagnostics));
    assert.match(r.diagnostics[0].message, /T\/H mismatch: T3 uses H33 but the library sets H3/);
  });
  it('links an Okuma lathe program to its ESPRIT XML and decodes T0101', () => {
    const real: CamFolderIO = {
      exists: p => fs.existsSync(p),
      list: d => fs.readdirSync(d).map(name => ({ name, mtimeMs: 0 })),
      read: p => new Uint8Array(fs.readFileSync(p)),
    };
    const link = linkProgram(path.join(dir, 'LB-SHAFT.min'), real);
    assert.equal(path.basename(link.setupSheetPath ?? ''), 'LB-SHAFT_setup.xml');
    const text = read('LB-SHAFT.min');
    const blocks = new BlockParser().parseDocument(new Tokenizer().tokenizeDocument(text));
    const m = new ProgramModelBuilder().build(blocks, 'okuma');
    const r = checkProgramAgainstLibrary({ blocks, stateAtBlock: m.stateAtBlock, tools: m.tools, library: link.library!, controlType: 'okuma', lathe: true });
    assert.equal(r.diagnostics.length, 0, JSON.stringify(r.diagnostics));
  });
  it('falls back to header comments when there is no sheet', () => {
    const io = memoryIO({ '2002.nc': { text: read('2002.nc'), mtime: 1 } });
    const link = linkProgram('/cam/out/2002.nc', io);
    assert.equal(link.setupSheetPath, undefined);
    assert.equal(link.library?.tools.length, 2);
    assert.match(link.note ?? '', /program header/);
  });
  it('reports an unreadable sheet instead of failing', () => {
    const io = memoryIO({ 'X.nc': { text: 'G0 X0\n', mtime: 1 }, 'X.html': { text: '<html>nothing</html>', mtime: 1 } });
    const link = linkProgram('/cam/out/X.nc', io);
    assert.equal(link.library, undefined);
    assert.match(link.note ?? '', /could be read.*X\.html/);
  });
});

describe('CAM: folder connections replace the stubs', () => {
  const files = {
    'old.nc': { text: '(MASTERCAM)\n( T9 | OLD | H9 )\nT9 M6\nM30\n', mtime: 1 },
    '1001.nc': { text: read('1001.nc'), mtime: 5 },
    '1001.html': { text: read('1001.html'), mtime: 5 },
    'readme.txt': { text: 'x', mtime: 9 },
  };
  it('connect() is true only when the output folder exists', async () => {
    assert.equal(await new MastercamConnection('/cam/out', memoryIO(files)).connect(), true);
    assert.equal(await new MastercamConnection('/nope', memoryIO(files)).connect(), false);
    assert.equal(await new MastercamConnection('', memoryIO(files)).connect(), false);
  });
  it('getCode() returns the newest NC program; getTools() its linked sheet', async () => {
    const c = new MastercamConnection('/cam/out', memoryIO(files));
    assert.match(await c.getCode(), /O1001/);
    const tools = await c.getTools();
    assert.deepEqual(tools.map(t => t.id), ['T1', 'T2', 'T3']);
    assert.equal(tools[0].size, 0.5);
  });
  it('every named connection is a FolderCamConnection with honest info()', () => {
    for (const C of [EspritCamConnection, MastercamConnection, Fusion360Connection, GibbsCamConnection, HexagonCamConnection, CuraConnection]) {
      const c = new C();
      assert.ok(c instanceof FolderCamConnection);
      assert.ok(c.info()?.doesNot, C.name);
    }
  });
  it('old connectTo* helpers describe the integration instead of "Not implemented"', () => {
    assert.match(connectToEspritCAM(), /^ESPRIT: .*No live link/);
    assert.match(connectToOtherCAM('Vectric'), /file-based only/);
  });
  it('isNcFileName excludes setup sheets and text files', () => {
    assert.equal(isNcFileName('A.NC'), true);
    assert.equal(isNcFileName('A.html'), false);
    assert.equal(isNcFileName('A.txt'), false);
  });
});
