/**
 * Basic repost / dialect conversion — pure, framework-free.
 *
 * Converts an ISO (Fanuc-family) program into another control's dialect for
 * the common codes, and marks everything it did not convert. It is NOT a CAM
 * post-processor: there is no toolpath, kinematics or machine model behind
 * it, so it cannot re-post 5-axis motion, re-calculate feeds or move work
 * offsets. Every line it could not convert with confidence is kept as a
 * comment beginning "JL MANUAL" and listed in `notes`.
 *
 * Sources: Fanuc, Haas, Mazak EIA, Mitsubishi, Fadal Format 2, generic ISO.
 * Targets: the same Fanuc family, Siemens 840D (Siemens mode), Okuma OSP,
 *          Heidenhain Klartext.
 * Converting FROM Siemens, Okuma or Heidenhain is not supported: their
 * structured languages do not map back onto ISO line by line.
 */

import { CONTROL_PROFILES, ControlId, normalizeControl } from '../diagnostics/controlRules';

export const CONVERT_SOURCES: ControlId[] = ['fanuc', 'haas', 'mazak', 'mitsubishi', 'fadal', 'generic'];
export const CONVERT_TARGETS: ControlId[] = ['fanuc', 'haas', 'mazak', 'mitsubishi', 'siemens', 'okuma', 'heidenhain'];

export interface ConvertNote { line: number; message: string }
export interface ConvertResult {
  text: string;
  from: ControlId;
  to: ControlId;
  notes: ConvertNote[];
  /** Source lines changed by a rule. */
  converted: number;
  /** Source lines left as JL MANUAL comments. */
  manual: number;
}

interface Word { letter: string; value: string; num: number }

function words(code: string): Word[] {
  const out: Word[] = [];
  const re = /([A-Z])\s*([-+]?\d*\.?\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) out.push({ letter: m[1].toUpperCase(), value: m[2], num: parseFloat(m[2]) });
  return out;
}

function splitComment(raw: string): { code: string; comment: string } {
  const comments: string[] = [];
  const code = raw.replace(/\(([^)]*)\)?/g, (_m, c: string) => { comments.push(c.trim()); return ' '; }).replace(/\s+/g, ' ').trim();
  return { code, comment: comments.filter(Boolean).join(' ') };
}

const isMacro = (code: string) => /#|\b(IF|WHILE|GOTO|DO\s*\d|END\s*\d)\b|\[/i.test(code);

function fmt(n: number): string {
  const s = (Math.round(n * 10000) / 10000).toString();
  return s.includes('.') ? s : s + '.';
}

export function convertProgram(text: string, fromControl: string, toControl: string): ConvertResult {
  const from = normalizeControl(fromControl);
  const to = normalizeControl(toControl);
  if (!CONVERT_SOURCES.includes(from)) {
    throw new Error(`Converting from ${CONTROL_PROFILES[from].label} is not supported. JobLine converts from ISO (Fanuc-family) programs only.`);
  }
  if (!CONVERT_TARGETS.includes(to)) throw new Error(`Converting to ${CONTROL_PROFILES[to].label} is not supported.`);
  if (to === 'siemens') return toSiemens(text, from);
  if (to === 'okuma') return toOkuma(text, from);
  if (to === 'heidenhain') return toKlartext(text, from);
  return toFanucFamily(text, from, to);
}

// ── Fanuc family → Fanuc family ──────────────────────────────────────────────

function toFanucFamily(text: string, from: ControlId, to: ControlId): ConvertResult {
  const notes: ConvertNote[] = [];
  const target = CONTROL_PROFILES[to];
  const out: string[] = [];
  let converted = 0, manual = 0;
  text.split(/\r?\n/).forEach((raw, i) => {
    const { code } = splitComment(raw);
    let line = raw;
    const o = /^(\s*)O\s*(\d+)/i.exec(raw);
    if (o && target.programNumberDigits) {
      const n = o[2].replace(/^0+(?=\d)/, '');
      if (n.length > target.programNumberDigits) {
        notes.push({ line: i, message: `O${o[2]} has more digits than ${target.label} allows (${target.programNumberDigits}); renumber it.` });
      } else {
        const padded = to === 'haas' ? n.padStart(5, '0') : n.padStart(4, '0');
        line = raw.replace(/O\s*\d+/i, `O${padded}`);
        if (line !== raw) converted++;
      }
    }
    // Haas TCPC/DWO ↔ Fanuc TCP.
    if (to !== 'haas' && /\bG234\b/i.test(code)) { line = line.replace(/\bG234\b/i, 'G43.4'); converted++; notes.push({ line: i, message: 'G234 (Haas TCPC) → G43.4 (TCP). Check the TCP option and H register.' }); }
    if (to === 'haas' && /\bG43\.4\b/i.test(code)) { line = line.replace(/\bG43\.4\b/i, 'G234'); converted++; notes.push({ line: i, message: 'G43.4 → G234 (Haas TCPC).' }); }
    if (/\bM97\b/i.test(code) && to !== 'haas') {
      out.push(`(JL MANUAL: ${raw.replace(/[()]/g, '')})`); manual++;
      notes.push({ line: i, message: 'M97 local subprogram is Haas-only. Move the subprogram to its own O-number and call it with M98.' });
      return;
    }
    if (target.gCodes) {
      for (const g of code.match(/(?<![A-Z#])G\s*\d+(?:\.\d+)?/gi) ?? []) {
        const n = String(parseFloat(g.slice(1)));
        if (!target.gCodes.has(n) && !(n === '43.4' && to !== 'haas')) notes.push({ line: i, message: `G${n} is not in JobLine's ${target.label} list; check it on the target control.` });
      }
    }
    out.push(line);
  });
  return { text: out.join('\n'), from, to, notes, converted, manual };
}

// ── Fanuc family → Siemens 840D ──────────────────────────────────────────────

function toSiemens(text: string, from: ControlId): ConvertResult {
  const notes: ConvertNote[] = [];
  const out: string[] = [];
  let converted = 0, manual = 0;
  let z = 0, initialZ = 0;
  let retractInitial = true; // G98
  let cycle: null | { code: number; feed?: string } = null;
  let absolute = true;

  text.split(/\r?\n/).forEach((raw, i) => {
    const trimmed = raw.trim();
    if (trimmed === '%') { converted++; return; }
    const { code, comment } = splitComment(raw);
    const cmt = comment ? ` ; ${comment}` : '';
    if (!code) { out.push(comment ? `; ${comment}` : ''); if (comment) converted++; return; }
    if (isMacro(code)) {
      out.push(`; JL MANUAL: ${trimmed}`); manual++;
      notes.push({ line: i, message: 'Macro B statement not converted. Rewrite with R parameters / DEF variables and IF/WHILE.' });
      return;
    }
    const o = /^O\s*(\d+)/i.exec(code);
    if (o) { out.push(`; PROGRAM O${o[1]}${cmt}`); converted++; notes.push({ line: i, message: `Save as O${o[1]}.MPF (main) or .SPF (subprogram); 840D names programs by file name.` }); return; }

    const ws = words(code);
    const gs = ws.filter(w => w.letter === 'G').map(w => w.num);
    const nWord = ws.find(w => w.letter === 'N');
    const prefix = nWord ? `N${nWord.value} ` : '';
    if (nWord) ws.splice(ws.indexOf(nWord), 1);
    if (gs.includes(90)) absolute = true;
    if (gs.includes(91)) absolute = false;
    if (gs.includes(98)) retractInitial = true;
    if (gs.includes(99)) retractInitial = false;

    // Reference return.
    if (gs.includes(28)) {
      const axes = ws.filter(w => 'XYZ'.includes(w.letter)).map(w => `${w.letter}1=0`).join(' ') || 'Z1=0';
      const mKeep = ws.filter(w => w.letter === 'M').map(w => ` M${w.value}`).join('');
      out.push(`${prefix}G75 ${axes}${mKeep}${cmt} ; was: ${code}`); converted++;
      notes.push({ line: i, message: 'G28 → G75 (fixed-point approach). Check fixed point 1 is the tool-change/home position on this machine.' });
      return;
    }

    // Cycle cancel: MCALL on its own block, then the rest of the block is rewritten below.
    if (gs.includes(80)) {
      cycle = null;
      out.push(`${prefix}MCALL`);
      converted++;
      const keep = ws.filter(w => !(w.letter === 'G' && w.num === 80) && w.letter !== 'N');
      if (!keep.length) { if (cmt) out.push(cmt.trim()); return; }
      ws.length = 0; ws.push(...keep);
    }

    // Drilling cycles that map cleanly.
    const cyc = gs.find(g => g === 81 || g === 82);
    if (cyc !== undefined) {
      const W = (l: string) => ws.find(w => w.letter === l);
      const zw = W('Z'), rw = W('R'), fw = W('F'), pw = W('P');
      if (!absolute || !zw || !rw) {
        out.push(`; JL MANUAL: ${trimmed}`); manual++;
        notes.push({ line: i, message: `G${cyc} needs absolute Z and R on the cycle block to convert.` });
        return;
      }
      initialZ = z;
      const rtp = retractInitial ? initialZ : rw.num;
      const params = cyc === 81
        ? `${fmt(rtp)},${fmt(rw.num)},0,${fmt(zw.num)}`
        : `${fmt(rtp)},${fmt(rw.num)},0,${fmt(zw.num)},,${fmt((pw?.num ?? 0) / 1000)}`;
      if (fw) out.push(`${prefix}F${fw.value}`);
      out.push(`${fw ? '' : prefix}MCALL CYCLE${cyc}(${params})${cmt}`);
      const pos = ws.filter(w => 'XY'.includes(w.letter)).map(w => w.letter + w.value).join(' ');
      if (pos) out.push(pos);
      cycle = { code: cyc };
      converted++;
      notes.push({ line: i, message: `G${cyc} → MCALL CYCLE${cyc}(RTP=${fmt(rtp)}, RFP=R, SDIS=0, DP=Z). RFP is the Fanuc R plane, so the feed starts at R as before.` });
      return;
    }
    const unmapped = gs.find(g => [73, 74, 76, 83, 84, 85, 86, 87, 88, 89].includes(g));
    if (unmapped !== undefined) {
      out.push(`; JL MANUAL: ${trimmed}`); manual++;
      notes.push({ line: i, message: `G${unmapped} not converted: write the matching CYCLE8x call (${unmapped === 84 || unmapped === 74 ? 'CYCLE84 rigid tapping' : unmapped === 83 || unmapped === 73 ? 'CYCLE83 deep-hole drilling' : 'CYCLE85–89 boring'}) and its parameters by hand.` });
      return;
    }

    // Word-by-word rewrite.
    const parts: string[] = [];
    let hadG43 = false;
    for (const w of ws) {
      if (w.letter === 'G' && (w.num === 43 || w.num === 44)) { hadG43 = true; continue; }
      if (w.letter === 'H' && (hadG43 || gs.includes(43) || gs.includes(44))) continue;
      if (w.letter === 'G' && w.num === 49) { parts.push('D0'); continue; }
      if (w.letter === 'G' && w.num === 20) { parts.push('G70'); continue; }
      if (w.letter === 'G' && w.num === 21) { parts.push('G71'); continue; }
      if (w.letter === 'G' && (w.num === 98 || w.num === 99)) continue;
      if (w.letter === 'M' && w.num === 98) {
        const p = ws.find(x => x.letter === 'P');
        if (p) parts.push(`L${parseInt(p.value, 10)}`);
        continue;
      }
      if (w.letter === 'P' && ws.some(x => x.letter === 'M' && x.num === 98)) continue;
      if (w.letter === 'M' && w.num === 99) { parts.push('M17'); continue; }
      parts.push(w.letter + w.value);
    }
    if (hadG43) {
      // The tool length now comes from the D number on the tool's cutting edge.
      if (!parts.some(p => /^D\d/.test(p))) parts.push('D1');
      notes.push({ line: i, message: 'G43 H… removed: 840D applies length from the active D number (D1 added).' });
    }
    if (gs.includes(49)) notes.push({ line: i, message: 'G49 → D0 (tool offset off).' });
    if (ws.some(w => w.letter === 'M' && w.num === 98)) notes.push({ line: i, message: 'M98 P… → L… subprogram call. The subprogram must be saved as L<n>.SPF.' });
    const lineOut = parts.join(' ') + cmt;
    if (lineOut.trim() !== code.trim()) converted++;
    out.push(lineOut);
    const zw = ws.find(w => w.letter === 'Z');
    if (zw && !cycle) z = absolute ? zw.num : z + zw.num;
  });
  if (cycle) notes.push({ line: Math.max(0, out.length - 1), message: 'A cycle was still active at the end; MCALL cancel added.' }), out.push('MCALL');
  return { text: out.join('\n'), from, to: 'siemens', notes, converted, manual };
}

// ── Fanuc family → Okuma OSP ─────────────────────────────────────────────────

function toOkuma(text: string, from: ControlId): ConvertResult {
  const notes: ConvertNote[] = [];
  const out: string[] = [];
  let converted = 0, manual = 0;
  text.split(/\r?\n/).forEach((raw, i) => {
    const { code } = splitComment(raw);
    if (!code) { out.push(raw); return; }
    if (isMacro(code)) {
      out.push(`(JL MANUAL: ${raw.trim().replace(/[()]/g, '')})`); manual++;
      notes.push({ line: i, message: 'Macro B not converted. OSP uses V variables and IF [..] N-label.' });
      return;
    }
    let line = raw;
    const before = line;
    // Work offsets first, so the G56 written for tool length isn't re-read as a work offset.
    line = line.replace(/\bG5([4-9])\b(?!\.)/gi, (_m, d) => `G15 H${parseInt(d, 10) - 3}`);
    line = line.replace(/\bG4([34])(\s*)H/gi, (_m, _d, sp) => `G56${sp}H`);
    line = line.replace(/\bG49\b/gi, 'G53');
    if (/\bM98\b/i.test(line)) {
      line = line.replace(/\bM98\s*P\s*0*(\d+)/i, (_m, p) => `CALL O${p}`);
      notes.push({ line: i, message: 'M98 P… → CALL O…; the subprogram must end with RTS.' });
    }
    line = line.replace(/\bM99\b/gi, 'RTS');
    if (/\bG28\b/i.test(code)) {
      out.push(`(JL MANUAL: ${raw.trim().replace(/[()]/g, '')})`); manual++;
      const mKeep = (code.match(/\bM\d+/gi) ?? []).join(' ');
      if (mKeep) out.push(mKeep);
      notes.push({ line: i, message: 'G28 not converted: OSP returns to zero with G30 P… (pallet/tool change positions differ by machine).' });
      return;
    }
    if (/\bG8[1-9]\b|\bG7[34]\b/i.test(code)) notes.push({ line: i, message: 'Fixed cycle kept as written. OSP uses the same G81–G89 numbers, but check R and the return level (G71 Z…) on the machine.' });
    if (line !== before) {
      converted++;
      if (/G56/.test(line) && !/G56/.test(before)) notes.push({ line: i, message: 'G43 H… → G56 H… (OSP tool length offset).' });
      if (/G15 H/.test(line) && !/G15 H/.test(before)) notes.push({ line: i, message: 'G54–G59 → G15 H1–H6 (OSP work coordinate select).' });
    }
    out.push(line);
  });
  return { text: out.join('\n'), from, to: 'okuma', notes, converted, manual };
}

// ── Fanuc family → Heidenhain Klartext ───────────────────────────────────────

function sign(n: number): string { return (n >= 0 ? '+' : '') + fmt(n).replace(/\.$/, ''); }

function toKlartext(text: string, from: ControlId): ConvertResult {
  const notes: ConvertNote[] = [];
  const body: string[] = [];
  let converted = 0, manual = 0;
  const pos = { X: 0, Y: 0, Z: 0 };
  let motion = 0, absolute = true, comp = 'R0', feed: string | undefined, plane = 17;
  let units: 'MM' | 'INCH' = /\bG20\b/i.test(text) ? 'INCH' : 'MM';
  let name = 'JOBLINE';
  let pendingTool: { n: number; s?: string; line: number } | null = null;
  let cycle: null | { code: number } = null;
  let initialZ = 0, retractInitial = true;

  const flushTool = () => {
    if (!pendingTool) return;
    body.push(`TOOL CALL ${pendingTool.n} Z${pendingTool.s ? ' S' + pendingTool.s : ''}`);
    pendingTool = null;
  };

  text.split(/\r?\n/).forEach((raw, i) => {
    const trimmed = raw.trim();
    const { code, comment } = splitComment(raw);
    if (trimmed === '%') return;
    if (!code) { if (comment) body.push(`; ${comment}`); return; }
    const o = /^O\s*(\d+)/i.exec(code);
    if (o) { name = `O${o[1]}`; converted++; return; }
    if (isMacro(code)) { flushTool(); body.push(`; JL MANUAL: ${trimmed}`); manual++; notes.push({ line: i, message: 'Macro not converted: use Q parameters and FN functions.' }); return; }
    const ws = words(code);
    const W = (l: string) => ws.find(w => w.letter === l);
    const gs = ws.filter(w => w.letter === 'G').map(w => w.num);
    const ms = ws.filter(w => w.letter === 'M').map(w => w.num);
    if (gs.includes(20)) units = 'INCH';
    if (gs.includes(21)) units = 'MM';
    if (gs.includes(90)) absolute = true;
    if (gs.includes(91)) absolute = false;
    if (gs.includes(98)) retractInitial = true;
    if (gs.includes(99)) retractInitial = false;
    if (gs.includes(40)) comp = 'R0';
    if (gs.includes(41)) comp = 'RL';
    if (gs.includes(42)) comp = 'RR';
    for (const p of [17, 18, 19]) if (gs.includes(p)) plane = p;
    const f = W('F'); if (f) feed = f.value;

    // Tool change: TOOL CALL picks up the S that usually follows on the next block.
    const t = W('T');
    if (t && (ms.includes(6) || !ws.some(w => 'XYZ'.includes(w.letter)))) {
      flushTool();
      pendingTool = { n: Math.round(t.num), s: W('S')?.value, line: i };
      converted++;
      const mRest = ms.filter(m => m !== 6);
      if (mRest.length) body.push(...mRest.map(m => `M${m}`));
      return;
    }
    const s = W('S');
    if (pendingTool && s && !pendingTool.s) pendingTool.s = s.value;
    else if (s && !pendingTool) body.push(`TOOL CALL Z S${s.value}`);

    if (gs.includes(28) || gs.includes(53)) {
      flushTool();
      body.push(`L Z${units === 'MM' ? '+250' : '+10'} R0 FMAX M91 ; JL: was ${code} — check the safe height`); converted++;
      const mKeep = ms.filter(m => m !== 6);
      if (mKeep.length) body.push(mKeep.map(m => `M${m}`).join(' '));
      notes.push({ line: i, message: `${gs.includes(28) ? 'G28' : 'G53'} → L Z… R0 FMAX M91 (machine coordinates). Set the safe Z for this machine.` });
      return;
    }
    if (gs.includes(80)) { cycle = null; converted++; return; }

    const cyc = gs.find(g => [81, 82, 83].includes(g));
    if (cyc !== undefined) {
      flushTool();
      const zw = W('Z'), rw = W('R'), qw = W('Q'), pw = W('P');
      if (!absolute || !zw || !rw) { body.push(`; JL MANUAL: ${trimmed}`); manual++; notes.push({ line: i, message: `G${cyc} needs absolute Z and R to convert.` }); return; }
      initialZ = pos.Z;
      const depth = zw.num - rw.num;
      const peck = cyc === 83 && qw ? Math.abs(qw.num) : Math.abs(depth);
      body.push('CYCL DEF 200 DRILLING ~');
      body.push('  Q200=+0 ;SET-UP CLEARANCE ~');
      body.push(`  Q201=${sign(depth)} ;DEPTH ~`);
      body.push(`  Q206=+${feed ?? '100'} ;FEED RATE FOR PLNGNG ~`);
      body.push(`  Q202=+${fmt(peck).replace(/\.$/, '')} ;PLUNGING DEPTH ~`);
      body.push('  Q210=+0 ;DWELL TIME AT TOP ~');
      body.push(`  Q203=${sign(rw.num)} ;SURFACE COORDINATE ~`);
      body.push(`  Q204=${sign(retractInitial ? Math.max(0, initialZ - rw.num) : 0)} ;2ND SET-UP CLEARANCE ~`);
      body.push(`  Q211=+${fmt((pw?.num ?? 0) / 1000).replace(/\.$/, '')} ;DWELL TIME AT DEPTH`);
      cycle = { code: cyc };
      converted++;
      notes.push({ line: i, message: `G${cyc} → CYCL DEF 200 (Q203 surface = R plane, Q200 = 0, Q201 = Z − R${cyc === 83 ? ', Q202 = Q peck' : ''}). Positions call it with M99.` });
      const xy = ws.filter(w => 'XY'.includes(w.letter));
      if (xy.length) body.push(`L ${xy.map(w => `${w.letter}${sign(w.num)}`).join(' ')} R0 FMAX M99`);
      return;
    }
    if (gs.some(g => [73, 74, 76, 84, 85, 86, 87, 88, 89].includes(g))) {
      flushTool(); body.push(`; JL MANUAL: ${trimmed}`); manual++;
      notes.push({ line: i, message: 'Tapping/boring cycle not converted: use CYCL DEF 207/209 (tapping) or 201–204 (boring) by hand.' });
      return;
    }

    const g = gs.find(x => [0, 1, 2, 3].includes(x));
    if (g !== undefined) motion = g;
    if ((gs.includes(43) || gs.includes(44)) && !notes.some(n => /TOOL CALL applies/.test(n.message))) {
      notes.push({ line: i, message: 'G43 H… dropped: on the TNC, TOOL CALL applies the tool length from the tool table.' });
    }
    const axes = ws.filter(w => 'XYZ'.includes(w.letter));
    const mText = ms.filter(m => m !== 6).map(m => ` M${m}`).join('');

    if (cycle && axes.length && !axes.some(a => a.letter === 'Z')) {
      body.push(`L ${axes.map(a => `${a.letter}${sign(a.num)}`).join(' ')} R0 FMAX M99${mText}`);
      converted++;
      return;
    }
    if (!axes.length) {
      flushTool();
      if (ms.length) { body.push(ms.filter(m => m !== 6).map(m => `M${m}`).join(' ')); converted++; }
      return;
    }
    flushTool();
    const next = { ...pos };
    for (const a of axes) (next as Record<string, number>)[a.letter] = absolute ? a.num : (pos as Record<string, number>)[a.letter] + a.num;
    const target = axes.map(a => `${absolute ? '' : 'I'}${a.letter}${sign(a.num)}`).join(' ');
    if (motion === 0) body.push(`L ${target} ${comp} FMAX${mText}`);
    else if (motion === 1) body.push(`L ${target} ${comp}${feed ? ' F' + feed : ''}${mText}`);
    else {
      if (plane !== 17) { body.push(`; JL MANUAL: ${trimmed}`); manual++; notes.push({ line: i, message: 'Arcs outside G17 not converted.' }); return; }
      const dr = motion === 2 ? 'DR-' : 'DR+';
      const r = W('R');
      const end = ['X', 'Y'].map(l => `${l}${sign((next as Record<string, number>)[l])}`).join(' ');
      if (r) body.push(`CR ${end} R${sign(r.num)} ${dr} ${comp}${feed ? ' F' + feed : ''}${mText}`);
      else {
        const I = W('I')?.num ?? 0, J = W('J')?.num ?? 0;
        body.push(`CC X${sign(pos.X + I)} Y${sign(pos.Y + J)}`);
        body.push(`C ${end} ${dr} ${comp}${feed ? ' F' + feed : ''}${mText}`);
      }
    }
    Object.assign(pos, next);
    converted++;
  });
  flushTool();
  const lines = [`BEGIN PGM ${name} ${units}`, ...body, `END PGM ${name} ${units}`];
  // Q-parameter continuation lines ("  Q200=…") don't take a block number.
  let k = 0;
  const final = lines.map(l => (l.startsWith('  Q') ? l : `${k++} ${l}`));
  notes.unshift({ line: 0, message: 'Klartext output is a starting point: check BLK FORM, tool axis (Z assumed), safe heights and feed units on the TNC before running.' });
  return { text: final.join('\n'), from, to: 'heidenhain', notes, converted, manual };
}
