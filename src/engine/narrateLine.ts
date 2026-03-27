/**
 * JobLine Plain-Language Narration Engine
 *
 * Converts a GCodeBlock + ModalState into a human-readable English sentence.
 * Adapted from g-code_analyzer (WeCr8/g-code_analyzer) narrateLine.ts,
 * rewritten to work directly with JobLine's GCodeBlock and ModalState types
 * instead of the analyzer's event-based pipeline.
 *
 * Usage:
 *   const sentence = narrateBlock(block, stateAtBlock[i]);
 */

import { GCodeBlock, ModalState } from '../parser/types';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtNum(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(4).replace(/\.?0+$/, '');
}

function addrVal(block: GCodeBlock, letter: string): number | null {
  return block.addresses.get(letter)?.resolvedValue ?? null;
}

function fmtAddr(block: GCodeBlock, letter: string): string | null {
  const v = addrVal(block, letter);
  return v !== null ? `${letter}${fmtNum(v)}` : null;
}

function fmtPosition(block: GCodeBlock, axes: string[] = ['X', 'Y', 'Z']): string {
  return axes.map(a => fmtAddr(block, a)).filter(Boolean).join(' ');
}

function feedStr(block: GCodeBlock, state: ModalState): string {
  const f = addrVal(block, 'F') ?? state.activeF;
  if (f === null) return '';
  const unit = state.activeFeedMode === 95
    ? (state.activeUnits === 20 ? 'IPR' : 'mm/rev')
    : (state.activeUnits === 20 ? 'IPM' : 'mm/min');
  return ` at ${fmtNum(f)} ${unit}`;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Produce a plain-English sentence describing what a G-code block does.
 *
 * @param block   The parsed block (output of BlockParser)
 * @param state   The modal state AFTER this block is applied (stateAtBlock[i])
 */
export function narrateBlock(block: GCodeBlock, state: ModalState): string {
  // Blank line
  if (!block.raw.trim()) return '';

  // Percent delimiter
  if (block.raw.trim() === '%') return 'Program delimiter (%)';

  // Comment-only line
  if (
    block.gCodes.length === 0 &&
    block.mCodes.length === 0 &&
    block.addresses.size === 0 &&
    block.toolNumber === undefined &&
    !block.macroAssignment &&
    !block.controlFlow &&
    block.comment
  ) {
    return `Comment: ${block.comment}`;
  }

  const parts: string[] = [];

  // -------------------------------------------------------------------------
  // G-code descriptions
  // -------------------------------------------------------------------------
  for (const g of block.gCodes) {
    const intCode = Math.floor(g.code);

    switch (intCode) {
      case 0: {
        const pos = fmtPosition(block, ['X', 'Y', 'Z', 'A', 'B', 'C']);
        if (pos) parts.push(`Rapid to ${pos}`);
        break;
      }

      case 1: {
        const pos = fmtPosition(block, ['X', 'Y', 'Z', 'A', 'B', 'C']);
        if (pos) parts.push(`Feed to ${pos}${feedStr(block, state)}`);
        break;
      }

      case 2: {
        const pos = fmtPosition(block, ['X', 'Y', 'Z']);
        const arcP = (['I', 'J', 'K', 'R'] as const)
          .map(a => fmtAddr(block, a)).filter(Boolean).join(' ');
        if (pos) parts.push(`Clockwise arc to ${pos}${arcP ? ` (${arcP})` : ''}${feedStr(block, state)}`);
        break;
      }

      case 3: {
        const pos = fmtPosition(block, ['X', 'Y', 'Z']);
        const arcP = (['I', 'J', 'K', 'R'] as const)
          .map(a => fmtAddr(block, a)).filter(Boolean).join(' ');
        if (pos) parts.push(`Counter-clockwise arc to ${pos}${arcP ? ` (${arcP})` : ''}${feedStr(block, state)}`);
        break;
      }

      case 4: {
        const p = addrVal(block, 'P');
        parts.push(p !== null ? `Dwell for ${fmtNum(p)} sec` : 'Dwell');
        break;
      }

      case 10: parts.push('Programmable data input (G10)'); break;

      case 17: parts.push('Select XY plane (G17)'); break;
      case 18: parts.push('Select XZ plane (G18)'); break;
      case 19: parts.push('Select YZ plane (G19)'); break;
      case 20: parts.push('Set inch mode (G20)'); break;
      case 21: parts.push('Set metric mode (G21)'); break;

      case 28: {
        const pos = fmtPosition(block);
        parts.push(pos ? `Return to machine home via ${pos} (G28)` : 'Return to machine home (G28)');
        break;
      }

      case 30: parts.push('Return to 2nd reference position (G30)'); break;

      case 31: {
        const pos = fmtPosition(block, ['X', 'Y', 'Z']);
        const f = addrVal(block, 'F') ?? state.activeF;
        const feedPart = f !== null
          ? ` at ${fmtNum(f)} ${state.activeUnits === 20 ? 'IPM' : 'mm/min'}`
          : '';
        parts.push(pos
          ? `Probe toward ${pos}${feedPart} — result in #5061–#5066 (G31)`
          : `Probe cycle (G31)`);
        break;
      }

      case 38: {
        const pos = fmtPosition(block, ['X', 'Y', 'Z']);
        const f = addrVal(block, 'F') ?? state.activeF;
        const feedPart = f !== null
          ? ` at ${fmtNum(f)} ${state.activeUnits === 20 ? 'IPM' : 'mm/min'}`
          : '';
        const isToward = g.code === 38.2 || g.code === 38.3;
        const isError = g.code === 38.2 || g.code === 38.4;
        const dir = isToward ? 'toward' : 'away from';
        const errNote = isError ? '' : ' (no alarm if not found)';
        parts.push(`Probe ${dir} workpiece${pos ? ` to ${pos}` : ''}${feedPart}${errNote} (G${g.code})`);
        break;
      }

      case 40: parts.push('Cancel cutter compensation (G40)'); break;

      case 41: {
        const d = addrVal(block, 'D');
        parts.push(`Enable cutter compensation left${d !== null ? ` D${fmtNum(d)}` : ''} (G41)`);
        break;
      }

      case 42: {
        const d = addrVal(block, 'D');
        parts.push(`Enable cutter compensation right${d !== null ? ` D${fmtNum(d)}` : ''} (G42)`);
        break;
      }

      case 43: {
        const h = addrVal(block, 'H');
        parts.push(`Apply tool length offset${h !== null ? ` H${fmtNum(h)}` : ''} (G43)`);
        break;
      }

      case 49: parts.push('Cancel tool length compensation (G49)'); break;

      case 50: {
        const s = addrVal(block, 'S');
        parts.push(s !== null
          ? `Set max spindle speed ${fmtNum(s)} RPM (G50)`
          : 'Set max spindle speed (G50)');
        break;
      }

      case 53: parts.push('Move in machine coordinates (G53)'); break;

      case 54: case 55: case 56: case 57: case 58: case 59:
        parts.push(`Select work coordinate system G${intCode}`);
        break;

      case 65: {
        const p = addrVal(block, 'P');
        const l = addrVal(block, 'L');
        let desc = p !== null ? `Call macro program O${fmtNum(p)}` : 'Call macro program';
        if (l !== null && l > 1) desc += ` (repeat ${fmtNum(l)}×)`;
        parts.push(`${desc} (G65)`);
        break;
      }

      case 68: {
        const r = addrVal(block, 'R');
        const pos = fmtPosition(block, ['X', 'Y']);
        parts.push(`Enable coordinate rotation${r !== null ? ` ${fmtNum(r)}°` : ''}${pos ? ` around ${pos}` : ''} (G68)`);
        break;
      }

      case 69: parts.push('Cancel coordinate rotation (G69)'); break;

      case 70: parts.push('Lathe finishing cycle (G70)'); break;
      case 71: parts.push('Lathe longitudinal roughing (G71)'); break;
      case 72: parts.push('Lathe facing roughing (G72)'); break;

      case 73: {
        const pos = fmtPosition(block, ['X', 'Y']);
        const z = addrVal(block, 'Z'), r = addrVal(block, 'R'), q = addrVal(block, 'Q');
        let desc = `High-speed peck drill${pos ? ` at ${pos}` : ''}`;
        if (z !== null) desc += ` to Z${fmtNum(z)}`;
        if (r !== null) desc += `, R${fmtNum(r)}`;
        if (q !== null) desc += `, peck ${fmtNum(q)}`;
        parts.push(desc + feedStr(block, state));
        break;
      }

      case 74: {
        const pos = fmtPosition(block, ['X', 'Y']);
        const z = addrVal(block, 'Z'), r = addrVal(block, 'R');
        let desc = `Left-hand tap${pos ? ` at ${pos}` : ''}`;
        if (z !== null) desc += ` to Z${fmtNum(z)}`;
        if (r !== null) desc += `, R${fmtNum(r)}`;
        parts.push(desc + feedStr(block, state));
        break;
      }

      case 76: {
        const z = addrVal(block, 'Z'), f = addrVal(block, 'F') ?? state.activeF;
        let desc = 'Thread cutting cycle';
        if (z !== null) desc += ` to Z${fmtNum(z)}`;
        if (f !== null) desc += ` F${fmtNum(f)}`;
        parts.push(desc + ' (G76)');
        break;
      }

      case 80: parts.push('Cancel canned cycle (G80)'); break;

      case 81: {
        const pos = fmtPosition(block, ['X', 'Y']);
        const z = addrVal(block, 'Z'), r = addrVal(block, 'R');
        let desc = `Drill${pos ? ` at ${pos}` : ''}`;
        if (z !== null) desc += ` to Z${fmtNum(z)}`;
        if (r !== null) desc += `, R${fmtNum(r)}`;
        parts.push(desc + feedStr(block, state));
        break;
      }

      case 82: {
        const pos = fmtPosition(block, ['X', 'Y']);
        const z = addrVal(block, 'Z'), r = addrVal(block, 'R'), p = addrVal(block, 'P');
        let desc = `Drill with dwell${pos ? ` at ${pos}` : ''}`;
        if (z !== null) desc += ` to Z${fmtNum(z)}`;
        if (r !== null) desc += `, R${fmtNum(r)}`;
        if (p !== null) desc += `, dwell ${fmtNum(p)} sec`;
        parts.push(desc + feedStr(block, state));
        break;
      }

      case 83: {
        const pos = fmtPosition(block, ['X', 'Y']);
        const z = addrVal(block, 'Z'), r = addrVal(block, 'R'), q = addrVal(block, 'Q');
        let desc = `Peck drill${pos ? ` at ${pos}` : ''}`;
        if (z !== null) desc += ` to Z${fmtNum(z)}`;
        if (r !== null) desc += `, R${fmtNum(r)}`;
        if (q !== null) desc += `, peck ${fmtNum(q)}`;
        parts.push(desc + feedStr(block, state));
        break;
      }

      case 84: {
        const pos = fmtPosition(block, ['X', 'Y']);
        const z = addrVal(block, 'Z'), r = addrVal(block, 'R');
        let desc = `Rigid tap${pos ? ` at ${pos}` : ''}`;
        if (z !== null) desc += ` to Z${fmtNum(z)}`;
        if (r !== null) desc += `, R${fmtNum(r)}`;
        parts.push(desc + feedStr(block, state));
        break;
      }

      case 85: {
        const pos = fmtPosition(block, ['X', 'Y']);
        const z = addrVal(block, 'Z'), r = addrVal(block, 'R');
        let desc = `Bore, feed out${pos ? ` at ${pos}` : ''}`;
        if (z !== null) desc += ` to Z${fmtNum(z)}`;
        if (r !== null) desc += `, R${fmtNum(r)}`;
        parts.push(desc + feedStr(block, state));
        break;
      }

      case 86: {
        const pos = fmtPosition(block, ['X', 'Y']);
        const z = addrVal(block, 'Z'), r = addrVal(block, 'R');
        let desc = `Bore, spindle stop${pos ? ` at ${pos}` : ''}`;
        if (z !== null) desc += ` to Z${fmtNum(z)}`;
        if (r !== null) desc += `, R${fmtNum(r)}`;
        parts.push(desc + feedStr(block, state));
        break;
      }

      case 87: {
        const pos = fmtPosition(block, ['X', 'Y']);
        const z = addrVal(block, 'Z'), r = addrVal(block, 'R');
        let desc = `Back bore${pos ? ` at ${pos}` : ''}`;
        if (z !== null) desc += ` to Z${fmtNum(z)}`;
        if (r !== null) desc += `, R${fmtNum(r)}`;
        parts.push(desc + feedStr(block, state));
        break;
      }

      case 88: {
        const pos = fmtPosition(block, ['X', 'Y']);
        const z = addrVal(block, 'Z'), r = addrVal(block, 'R'), p = addrVal(block, 'P');
        let desc = `Bore with dwell${pos ? ` at ${pos}` : ''}`;
        if (z !== null) desc += ` to Z${fmtNum(z)}`;
        if (r !== null) desc += `, R${fmtNum(r)}`;
        if (p !== null) desc += `, dwell ${fmtNum(p)} sec`;
        parts.push(desc + feedStr(block, state));
        break;
      }

      case 89: {
        const pos = fmtPosition(block, ['X', 'Y']);
        const z = addrVal(block, 'Z'), r = addrVal(block, 'R'), p = addrVal(block, 'P');
        let desc = `Bore, dwell, feed out${pos ? ` at ${pos}` : ''}`;
        if (z !== null) desc += ` to Z${fmtNum(z)}`;
        if (r !== null) desc += `, R${fmtNum(r)}`;
        if (p !== null) desc += `, dwell ${fmtNum(p)} sec`;
        parts.push(desc + feedStr(block, state));
        break;
      }

      case 90:
        if (g.code === 90.1) parts.push('Set arc center absolute (G90.1)');
        else parts.push('Set absolute positioning (G90)');
        break;

      case 91:
        if (g.code === 91.1) parts.push('Set arc center incremental (G91.1)');
        else parts.push('Set incremental positioning (G91)');
        break;

      case 94: parts.push('Set feed per minute (G94)'); break;
      case 95: parts.push('Set feed per revolution (G95)'); break;

      case 96: {
        const s = addrVal(block, 'S') ?? state.activeS;
        const unit = state.activeUnits === 20 ? 'SFM' : 'm/min';
        parts.push(s !== null
          ? `Set constant surface speed ${fmtNum(s)} ${unit} (G96)`
          : 'Set constant surface speed (G96)');
        break;
      }

      case 97: {
        const s = addrVal(block, 'S') ?? state.activeS;
        parts.push(s !== null
          ? `Set constant ${fmtNum(s)} RPM (G97)`
          : 'Set constant RPM (G97)');
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // M-code descriptions
  // -------------------------------------------------------------------------
  for (const m of block.mCodes) {
    switch (m.code) {
      case 0:  parts.push('Program stop (M0)'); break;
      case 1:  parts.push('Optional stop (M1)'); break;
      case 2:  parts.push('End program (M2)'); break;

      case 3: {
        const s = addrVal(block, 'S') ?? state.activeS;
        parts.push(`Start spindle clockwise${s !== null ? ` at ${fmtNum(s)} RPM` : ''} (M3)`);
        break;
      }

      case 4: {
        const s = addrVal(block, 'S') ?? state.activeS;
        parts.push(`Start spindle counter-clockwise${s !== null ? ` at ${fmtNum(s)} RPM` : ''} (M4)`);
        break;
      }

      case 5:  parts.push('Stop spindle (M5)'); break;

      case 6: {
        const t = block.toolNumber ?? state.activeTool;
        parts.push(t !== null ? `Tool change to T${t} (M6)` : 'Tool change (M6)');
        break;
      }

      case 7:  parts.push('Mist coolant on (M7)'); break;
      case 8:  parts.push('Flood coolant on (M8)'); break;
      case 9:  parts.push('Coolant off (M9)'); break;
      case 19: parts.push('Orient spindle (M19)'); break;
      case 30: parts.push('End program and reset (M30)'); break;

      case 88: parts.push('Through-spindle coolant on (M88)'); break;
      case 89: parts.push('Through-spindle coolant off (M89)'); break;

      case 97: {
        const p = addrVal(block, 'P'), l = addrVal(block, 'L');
        let desc = p !== null ? `Call local subprogram N${fmtNum(p)}` : 'Call local subprogram';
        if (l !== null && l > 1) desc += ` (×${fmtNum(l)})`;
        parts.push(`${desc} (M97)`);
        break;
      }

      case 98: {
        const p = addrVal(block, 'P'), l = addrVal(block, 'L');
        let desc = p !== null ? `Call subprogram O${fmtNum(p)}` : 'Call subprogram';
        if (l !== null && l > 1) desc += ` (×${fmtNum(l)})`;
        parts.push(`${desc} (M98)`);
        break;
      }

      case 99: parts.push('Return from subprogram (M99)'); break;
    }
  }

  // -------------------------------------------------------------------------
  // Tool selection (T-word without M6)
  // -------------------------------------------------------------------------
  if (block.toolNumber !== undefined && !block.mCodes.some(m => m.code === 6)) {
    parts.push(`Select T${block.toolNumber} (load next; M6 executes change)`);
  }

  // -------------------------------------------------------------------------
  // Cycle repeat — position-only line under active canned cycle
  // -------------------------------------------------------------------------
  if (block.isCycleRepeat) {
    const pos = fmtPosition(block, ['X', 'Y', 'Z']);
    parts.push(pos ? `Repeat cycle at ${pos}` : 'Repeat cycle at current position');
    // Don't fall through to implicit motion for cycle repeats
    return parts.join(', ');
  }

  // -------------------------------------------------------------------------
  // Implicit motion: axis addresses with no G code, modal motion carried over
  // -------------------------------------------------------------------------
  if (block.gCodes.length === 0 && block.addresses.size > 0 && parts.length === 0) {
    const activeMotion = state.activeMotion;
    if (activeMotion !== null && [0, 1, 2, 3].includes(activeMotion)) {
      const pos = fmtPosition(block, ['X', 'Y', 'Z', 'A', 'B', 'C']);
      if (pos) {
        const motionNames: Record<number, string> = {
          0: 'Rapid', 1: 'Feed', 2: 'Arc CW', 3: 'Arc CCW',
        };
        const feed = activeMotion === 1 ? feedStr(block, state) : '';
        parts.push(`${motionNames[activeMotion]} to ${pos}${feed} (modal G${activeMotion})`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Macro assignment: #n = expr
  // -------------------------------------------------------------------------
  if (block.macroAssignment) {
    const { variableNum, expression } = block.macroAssignment;
    if (expression.kind === 'literal') {
      parts.push(`Set #${variableNum} = ${fmtNum(expression.value)}`);
    } else if (expression.kind === 'variable') {
      parts.push(`Set #${variableNum} = #${expression.variableNum}`);
    } else {
      parts.push(`Set #${variableNum} = [expression]`);
    }
  }

  // -------------------------------------------------------------------------
  // Control flow
  // -------------------------------------------------------------------------
  if (block.controlFlow) {
    const cf = block.controlFlow;
    switch (cf.type) {
      case 'IF':    parts.push(`IF [${cf.condition ?? '...'}]`); break;
      case 'GOTO':  parts.push(`GOTO N${cf.target ?? '...'}`); break;
      case 'WHILE': parts.push(`WHILE [${cf.condition ?? '...'}] DO`); break;
      case 'DO':    parts.push('DO loop start'); break;
      case 'END':   parts.push('END (loop)'); break;
    }
  }

  if (parts.length === 0) return '';

  const result = parts.join(', ');
  return result.charAt(0).toUpperCase() + result.slice(1);
}
