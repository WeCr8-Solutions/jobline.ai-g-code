/**
 * Tool-library import — pure, framework-free.
 *
 * Reads the tool lists a shop already has and turns them into one shape the
 * tool table and the checker can use:
 *
 *   - Autodesk Fusion tool library JSON (`.json`) and `.tools` (a ZIP holding
 *     that JSON). Fields: post-process.number / length-offset / diameter-offset,
 *     geometry.DC / LCF / LB / OAL / RE / assemblyGaugeLength, description, unit.
 *   - HSMWorks / Inventor CAM `.hsmlib` (XML, usually UTF-16 with a BOM):
 *     <tool unit=…><description/><nc number length-offset diameter-offset/>
 *     <body diameter flute-length body-length overall-length corner-radius/></tool>
 *   - A generic CSV/TSV/semicolon table with a header row. Columns are matched
 *     by name: T, H, D, diameter, flute length, gauge length, description
 *     (plus common spellings, and Fusion's CSV `Name (tool_xxx)` headers).
 *
 * Nothing here talks to a CAM system. These are files the user exports.
 */

import { readZipEntry } from '../providers/visualizer/fusionArchiveParser';

export type ToolLibraryFormat = 'fusion-json' | 'fusion-tools' | 'hsmlib' | 'csv' | 'setup-sheet-html' | 'setup-sheet-xml';
export type LengthUnit = 'mm' | 'in';

export interface LibraryTool {
  /** Pocket / T number the program calls. */
  number: number;
  /** Length offset register (H on Fanuc-family controls). */
  lengthOffset?: number;
  /** Diameter / cutter-comp offset register (D). */
  diameterOffset?: number;
  diameter?: number;
  fluteLength?: number;
  /** Gauge length / length below holder / stick-out, whichever the source gives. */
  gaugeLength?: number;
  overallLength?: number;
  cornerRadius?: number;
  type?: string;
  description?: string;
  unit?: LengthUnit;
}

export interface ToolLibrary {
  /** File name the library came from. */
  name: string;
  format: ToolLibraryFormat;
  tools: LibraryTool[];
  /** Rows that were skipped and why (no tool number, duplicate number, …). */
  warnings: string[];
}

// ── Format detection ─────────────────────────────────────────────────────────

/** Decode bytes as text, honouring UTF-16 / UTF-8 byte-order marks. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(bytes.subarray(3));
  // UTF-16 without a BOM: every other byte of ASCII XML is zero.
  if (bytes.length >= 4 && bytes[0] === 0x3c && bytes[1] === 0x00) return new TextDecoder('utf-16le').decode(bytes);
  return new TextDecoder().decode(bytes);
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

/**
 * Parse any supported tool-library file. The extension picks the reader;
 * when it is ambiguous the content decides (a `.json` can also be a ZIP named
 * wrongly, and an `.xml` may be an HSM library).
 */
export function parseToolLibrary(name: string, bytes: Uint8Array): ToolLibrary {
  const ext = extOf(name);
  if (isZip(bytes)) {
    const json = decodeText(readZipEntry(bytes, '.json'));
    return { ...parseFusionToolLibraryJson(json, name), format: 'fusion-tools' };
  }
  const text = decodeText(bytes);
  const head = text.trimStart().slice(0, 400);
  if (ext === 'hsmlib' || /<tool-library\b/i.test(head) || (head.startsWith('<') && /<tool-library\b/i.test(text))) {
    return parseHsmLibrary(text, name);
  }
  if (ext === 'json' || ext === 'tools' || head.startsWith('{') || head.startsWith('[')) {
    return parseFusionToolLibraryJson(text, name);
  }
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return parseToolCsv(text, name);
  throw new Error(`Unsupported tool library "${name}". Use a Fusion .json/.tools, HSMWorks/Inventor CAM .hsmlib, or a CSV with a T column.`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function num(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const m = /-?\d*\.?\d+(?:e[-+]?\d+)?/i.exec(value.replace(/,(?=\d{3}\b)/g, ''));
  if (!m) return undefined;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : undefined;
}

function int(value: unknown): number | undefined {
  const n = num(value);
  return n === undefined ? undefined : Math.round(n);
}

export function unitFrom(value: unknown): LengthUnit | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  if (/^(mm|millimet(er|re)s?|metric)$/.test(v)) return 'mm';
  if (/^(in|inch|inches|imperial|")$/.test(v)) return 'in';
  return undefined;
}

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.replace(/\s+/g, ' ').trim();
  return t.length ? t : undefined;
}

function prune<T extends object>(obj: T): T {
  for (const key of Object.keys(obj) as (keyof T)[]) if (obj[key] === undefined) delete obj[key];
  return obj;
}

/** Keep the first tool per number; later duplicates become warnings. */
function finish(name: string, format: ToolLibraryFormat, tools: LibraryTool[], warnings: string[]): ToolLibrary {
  const seen = new Map<number, LibraryTool>();
  const dupes = new Map<number, number>();
  for (const tool of tools) {
    if (seen.has(tool.number)) {
      dupes.set(tool.number, (dupes.get(tool.number) ?? 1) + 1);
      continue;
    }
    seen.set(tool.number, tool);
  }
  for (const [n, count] of dupes) {
    warnings.push(`${count} entries use T${n}; kept the first. Vendor catalogues often leave every tool at number 1, so renumber them in the CAM library before importing.`);
  }
  const unique = [...seen.values()].sort((a, b) => a.number - b.number);
  return { name, format, tools: unique, warnings };
}

// ── Fusion JSON ──────────────────────────────────────────────────────────────

const FUSION_SKIP_TYPES = new Set(['holder', 'probe']);

export function parseFusionToolLibraryJson(text: string, name = 'tools.json'): ToolLibrary {
  let doc: unknown;
  try { doc = JSON.parse(text); } catch (e) { throw new Error(`${name}: not valid JSON (${(e as Error).message}).`); }
  const list: unknown[] = Array.isArray(doc)
    ? doc
    : (doc && typeof doc === 'object' && Array.isArray((doc as { data?: unknown }).data)) ? (doc as { data: unknown[] }).data : [];
  if (!list.length) throw new Error(`${name}: no "data" array of tools found. Is this a Fusion tool library?`);
  const tools: LibraryTool[] = [];
  const warnings: string[] = [];
  list.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const t = raw as Record<string, unknown>;
    const type = clean(t.type);
    if (type && FUSION_SKIP_TYPES.has(type.toLowerCase())) return;
    const pp = (t['post-process'] ?? {}) as Record<string, unknown>;
    const g = (t.geometry ?? {}) as Record<string, unknown>;
    const number = int(pp.number);
    const description = clean(t.description) ?? clean(pp.comment);
    if (number === undefined || number <= 0) {
      warnings.push(`Entry ${index + 1}${description ? ` (${description})` : ''} has no tool number (post-process.number is ${pp.number ?? 'missing'}); skipped.`);
      return;
    }
    tools.push(prune({
      number,
      lengthOffset: int(pp['length-offset']),
      diameterOffset: int(pp['diameter-offset']),
      diameter: num(g.DC),
      fluteLength: num(g.LCF),
      gaugeLength: num(g.assemblyGaugeLength) ?? num(g.LB),
      overallLength: num(g.OAL),
      cornerRadius: num(g.RE),
      type,
      description,
      unit: unitFrom(t.unit),
    }));
  });
  return finish(name, 'fusion-json', tools, warnings);
}

// ── XML helpers (no DOM in the extension host) ───────────────────────────────

export function xmlAttributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? '');
  return out;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&deg;/g, '°').replace(/&Oslash;|&oslash;/g, 'Ø')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function firstTag(xml: string, tag: string): Record<string, string> | undefined {
  const m = new RegExp(`<${tag}\\b([^>]*)/?>`, 'i').exec(xml);
  return m ? xmlAttributes(m[1]) : undefined;
}

function firstText(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return m ? clean(decodeEntities(m[1].replace(/<[^>]+>/g, ' '))) : undefined;
}

// ── HSMWorks / Inventor CAM .hsmlib ──────────────────────────────────────────

export function parseHsmLibrary(text: string, name = 'library.hsmlib'): ToolLibrary {
  if (!/<tool-library\b/i.test(text)) throw new Error(`${name}: no <tool-library> element. Is this an HSMWorks/Inventor CAM .hsmlib?`);
  const tools: LibraryTool[] = [];
  const warnings: string[] = [];
  const re = /<tool(?![\w-])([^>]*)>([\s\S]*?)<\/tool>/gi;
  let m: RegExpExecArray | null;
  let index = 0;
  while ((m = re.exec(text))) {
    index++;
    const attrs = xmlAttributes(m[1]);
    const inner = m[2];
    const nc = firstTag(inner, 'nc') ?? {};
    const body = firstTag(inner, 'body') ?? {};
    const type = clean(attrs.type);
    if (type && FUSION_SKIP_TYPES.has(type.toLowerCase())) continue;
    const description = firstText(inner, 'description') ?? firstText(inner, 'comment');
    const number = int(nc.number);
    if (number === undefined || number <= 0) {
      warnings.push(`Tool ${index}${description ? ` (${description})` : ''} has no nc number; skipped.`);
      continue;
    }
    tools.push(prune({
      number,
      lengthOffset: int(nc['length-offset']),
      diameterOffset: int(nc['diameter-offset']),
      diameter: num(body.diameter),
      fluteLength: num(body['flute-length']),
      gaugeLength: num(body['body-length']),
      overallLength: num(body['overall-length']),
      cornerRadius: num(body['corner-radius']),
      type,
      description,
      unit: unitFrom(attrs.unit),
    }));
  }
  return finish(name, 'hsmlib', tools, warnings);
}

// ── Column mapping shared by CSV and setup-sheet tables ──────────────────────

export type ToolField = 'number' | 'lengthOffset' | 'diameterOffset' | 'diameter' | 'fluteLength' | 'gaugeLength' | 'overallLength' | 'cornerRadius' | 'type' | 'description' | 'unit';

/** Normalised header text → field. Order matters: first match wins. */
const HEADER_RULES: Array<[ToolField, RegExp]> = [
  ['lengthOffset', /^(h|hoffset|lengthoffset|lenoffset|lenoff|lengthoff|lo|toollengthoffset|lengthcomp|heightoffset|htool|lengthreg|tool_lengthoffset|loffset)$/],
  ['diameterOffset', /^(d|doffset|diameteroffset|diaoffset|diaoff|radiusoffset|cuttercomp|cutcom|diamoffset|tool_diameteroffset|dcomp|radoffset)$/],
  ['number', /^(t|tool|toolno|toolnumber|toolnum|tno|tnum|tool#|toolid|pocket|station|tool_number|number|no|#)$/],
  ['diameter', /^(diameter|dia|dc|tooldia|tooldiameter|cuttingdiameter|cutterdiameter|diam|tool_diameter|ø|size)$/],
  ['fluteLength', /^(flutelength|flutelen|flute|lcf|loc|lengthofcut|cutlength|cuttinglength|lc|tool_flutelength|flutes?length)$/],
  ['gaugeLength', /^(gaugelength|gauge|gl|stickout|stick|oh|overhang|lengthbelowholder|lb|bodylength|projection|toollength|length|tool_bodylength|assemblygaugelength|tool_gaugelength)$/],
  ['overallLength', /^(overalllength|oal|totallength|tool_overalllength)$/],
  ['cornerRadius', /^(cornerradius|cornerrad|corner|cr|re|noseradius|radius|rad|tool_cornerradius)$/],
  ['type', /^(type|tooltype|kind|tool_type)$/],
  ['description', /^(description|desc|comment|name|toolname|tooldescription|tool_description|tool_comment|toolcomment|notes?)$/],
  ['unit', /^(unit|units|tool_unit)$/],
];

/** Map one header label to a field, or undefined if it is not a tool column. */
export function headerField(label: string): ToolField | undefined {
  const raw = decodeEntities(label).trim();
  // Fusion CSV headers look like "Length offset (tool_lengthOffset)": try the
  // id inside the brackets first, then the readable label.
  const candidates: string[] = [];
  const inner = /\(([^)]+)\)\s*$/.exec(raw);
  if (inner) candidates.push(inner[1]);
  candidates.push(raw.replace(/\([^)]*\)\s*$/, ''));
  candidates.push(raw);
  for (const c of candidates) {
    const key = c.toLowerCase().replace(/\bnumber\b/g, 'number').replace(/[\s._\-:/]+/g, '').replace(/\.$/, '');
    const keyHash = key.replace(/#$/, '#');
    for (const [field, re] of HEADER_RULES) if (re.test(key) || re.test(keyHash)) return field;
  }
  return undefined;
}

/**
 * Turn a header row + data rows into tools. Used by the CSV reader and by the
 * setup-sheet table reader (ESPRIT, Mastercam, Fusion setup sheets).
 */
export function toolsFromTable(header: string[], rows: string[][], context: string, warnings: string[], defaultUnit?: LengthUnit): LibraryTool[] {
  const fields = header.map(headerField);
  if (!fields.includes('number')) return [];
  const tools: LibraryTool[] = [];
  rows.forEach((row, r) => {
    if (row.every(cell => !cell.trim())) return;
    const rec: Partial<Record<ToolField, string>> = {};
    fields.forEach((f, i) => { if (f && rec[f] === undefined && row[i] !== undefined) rec[f] = row[i]; });
    const tRaw = rec.number ?? '';
    // "T12", "12", "T0101" (lathe: tool 1 offset 1) all appear in the wild.
    const tm = /^\s*T?\s*0*(\d+)/i.exec(tRaw);
    if (!tm) {
      if (tRaw.trim()) warnings.push(`${context} row ${r + 1}: tool column "${tRaw.trim()}" is not a number; skipped.`);
      return;
    }
    const number = parseInt(tm[1], 10);
    if (!(number > 0)) { warnings.push(`${context} row ${r + 1}: tool number 0; skipped.`); return; }
    const hRaw = rec.lengthOffset?.replace(/^\s*H/i, '');
    const dRaw = rec.diameterOffset?.replace(/^\s*D/i, '');
    const unitFromCells = unitFrom(rec.unit) ?? (/\bmm\b/i.test(`${rec.diameter ?? ''}`) ? 'mm' : /("|\bin\b)/i.test(`${rec.diameter ?? ''}`) ? 'in' : undefined);
    tools.push(prune({
      number,
      lengthOffset: int(hRaw),
      diameterOffset: int(dRaw),
      diameter: num(rec.diameter),
      fluteLength: num(rec.fluteLength),
      gaugeLength: num(rec.gaugeLength),
      overallLength: num(rec.overallLength),
      cornerRadius: num(rec.cornerRadius),
      type: clean(rec.type),
      description: clean(rec.description),
      unit: unitFromCells ?? defaultUnit,
    }));
  });
  return tools;
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** RFC 4180-ish: quoted fields, doubled quotes, embedded newlines. */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const firstLine = text.split(/\r?\n/).find(l => l.trim()) ?? '';
  const delim = delimiter ?? ([',', ';', '\t'].map(d => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0]);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field.trim() === '') { quoted = true; field = ''; continue; }
    if (c === delim) { row.push(field); field = ''; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
      continue;
    }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

export function parseToolCsv(text: string, name = 'tools.csv'): ToolLibrary {
  const rows = parseDelimited(text.replace(/^\uFEFF/, ''));
  const warnings: string[] = [];
  // The header is the first row that names a tool-number column (some exports
  // put a title line or two above it).
  const headerIndex = rows.findIndex(r => r.map(headerField).includes('number'));
  if (headerIndex < 0) {
    throw new Error(`${name}: no header row with a tool-number column (T, Tool, Tool #, Number). Expected columns: T, H, D, diameter, flute length, gauge length, description.`);
  }
  const tools = toolsFromTable(rows[headerIndex], rows.slice(headerIndex + 1), name, warnings);
  return finish(name, 'csv', tools, warnings);
}

/** Re-export so setup-sheet readers can build a library with the same rules. */
export function buildLibrary(name: string, format: ToolLibraryFormat, tools: LibraryTool[], warnings: string[]): ToolLibrary {
  return finish(name, format, tools, warnings);
}

/** One-line human summary, used in the tool table tooltip and notifications. */
export function describeLibraryTool(tool: LibraryTool): string {
  const u = tool.unit === 'mm' ? ' mm' : tool.unit === 'in' ? '"' : '';
  const parts: string[] = [];
  if (tool.diameter !== undefined) parts.push(`Ø${round(tool.diameter)}${u}`);
  if (tool.fluteLength !== undefined) parts.push(`FL ${round(tool.fluteLength)}`);
  if (tool.gaugeLength !== undefined) parts.push(`GL ${round(tool.gaugeLength)}`);
  if (tool.cornerRadius) parts.push(`R${round(tool.cornerRadius)}`);
  if (tool.lengthOffset !== undefined) parts.push(`H${tool.lengthOffset}`);
  if (tool.diameterOffset !== undefined) parts.push(`D${tool.diameterOffset}`);
  const desc = tool.description ?? tool.type;
  return [desc, parts.join(' ')].filter(Boolean).join(' · ');
}

function round(n: number): string {
  return String(Math.round(n * 10000) / 10000);
}
