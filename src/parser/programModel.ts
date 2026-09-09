/**
 * JobLine Program Model — Stage 3
 * Architecture v0.4.0 Section 3.3
 *
 * Walks all parsed blocks sequentially, maintaining the modal state machine.
 * Detects operations (tool change boundaries), tool usage, canned cycles
 * (including repeat-at-position), and generates the full ProgramModel.
 *
 * Input:  GCodeBlock[]
 * Output: ProgramModel
 */

import {
  GCodeBlock,
  ModalState,
  ProgramModel,
  Operation,
  ToolUsage,
  CannedCycleInstance,
  ProbeInstance,
  createDefaultModalState,
  cloneModalState,
} from './types';
import { ModalStateUpdater } from '../utils/modalState';

// Canned cycle G-codes
const CANNED_CYCLE_CODES = new Set([73, 74, 76, 81, 82, 83, 84, 85, 86, 87, 88, 89]);

// Probing G-codes (G31 = skip function, G38.x = standard probing)
const PROBE_TOWARD_CODES = new Set([31, 38.2, 38.3]);
const PROBE_ERROR_CODES = new Set([38.2, 38.4]); // alarm if contact not achieved/lost

// Position-only address letters (for cycle repeat detection)
const POSITION_LETTERS_MILL = new Set(['X', 'Y']);
const POSITION_LETTERS_LATHE = new Set(['X', 'Z']);

export class ProgramModelBuilder {
  private stateUpdater = new ModalStateUpdater();

  /**
   * Build the full program model from parsed blocks.
   */
  build(blocks: GCodeBlock[], dialect: string = 'fanuc'): ProgramModel {
    const model: ProgramModel = {
      blocks,
      stateAtBlock: [],
      operations: [],
      tools: [],
      cannedCycles: [],
      probingInstances: [],
      diagnostics: [],
      totalLines: blocks.length,
      dialect,
      detectedMachineType: this.detectMachineType(blocks, dialect),
      stockDimensions: this.extractStockDimensions(blocks),
    };

    // On lathes (Okuma OSP, Fanuc lathe, etc.) the T-word encodes both tool
    // number AND offset register: T0101 = tool 1, offset 1.  Extract the
    // actual tool number by dropping the last two offset digits.
    const isLatheDialect = dialect === 'okuma' || dialect.includes('lathe');
    const decodeToolNum = (rawNum: number): number =>
      isLatheDialect && rawNum >= 100 ? Math.floor(rawNum / 100) : rawNum;

    let state = createDefaultModalState();
    let currentOperation: Partial<Operation> | null = null;
    let currentCycle: CannedCycleInstance | null = null;
    const toolMap = new Map<number, ToolUsage>();

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];

      // -----------------------------------------------------------------------
      // Cycle repeat detection (BEFORE state update)
      // -----------------------------------------------------------------------
      this.detectCycleRepeat(block, state, model);

      // -----------------------------------------------------------------------
      // Update modal state
      // -----------------------------------------------------------------------
      state = this.stateUpdater.updateState(state, block);
      model.stateAtBlock.push(cloneModalState(state));

      // -----------------------------------------------------------------------
      // Program number detection
      // -----------------------------------------------------------------------
      if (block.programNumber && !model.programNumber) {
        model.programNumber = block.programNumber;
      }

      // -----------------------------------------------------------------------
      // Tool change → operation boundary
      // -----------------------------------------------------------------------
      if (block.toolNumber !== undefined || block.mCodes.some(m => m.code === 6)) {
        // Close previous operation
        if (currentOperation && currentOperation.startLine !== undefined) {
          currentOperation.endLine = Math.max(i - 1, currentOperation.startLine);

          // Suppress stub ops: a T-word-only line immediately before an M06
          // line for the same tool should not appear as a separate operation.
          // e.g.  T01       ← this would otherwise be its own 1-line «stub» op
          //       M06       ← the real operation starts here
          const parentBlock = blocks[currentOperation.startLine];
          const rawToolNum = block.toolNumber !== undefined
            ? decodeToolNum(block.toolNumber)
            : (state.activeTool ?? 0);
          const isStubOp =
            currentOperation.endLine === currentOperation.startLine &&
            parentBlock?.toolNumber !== undefined &&
            !parentBlock.mCodes.some(m => m.code === 6) &&
            block.mCodes.some(m => m.code === 6) &&
            currentOperation.toolNumber === rawToolNum;

          if (!isStubOp) {
            model.operations.push(currentOperation as Operation);
          }
        }

        // Start new operation — apply lathe T-word decode
        const toolNum = block.toolNumber !== undefined
          ? decodeToolNum(block.toolNumber)
          : (state.activeTool ? decodeToolNum(state.activeTool) : 0);
        const comment = block.comment ?? this.findNearbyComment(blocks, i);

        currentOperation = {
          name: comment ?? `Op ${model.operations.length + 1}`,
          toolNumber: toolNum,
          startLine: i,
          endLine: i,
          cycleTypes: [],
        };

        // Track tool usage
        if (!toolMap.has(toolNum)) {
          const toolData = {
            toolNumber: toolNum,
            description: comment ?? undefined,
            lineNumbers: [],
          };
          // Extract tool specs from comment if present
          if (comment) {
            this.extractToolSpecs(comment, toolData);
          }
          toolMap.set(toolNum, toolData);
        }
        toolMap.get(toolNum)!.lineNumbers.push(i);
      }

      // -----------------------------------------------------------------------
      // Track work offset in operation
      // -----------------------------------------------------------------------
      if (currentOperation && state.activeWorkOffset) {
        currentOperation.workOffset = state.activeWorkOffset;
      }

      // -----------------------------------------------------------------------
      // Track spindle/feed in operation
      // -----------------------------------------------------------------------
      if (currentOperation) {
        if (state.activeS !== null) {
          currentOperation.spindleSpeed = state.activeS;
        }
        if (state.activeF !== null) {
          if (!currentOperation.feedRange) {
            currentOperation.feedRange = { min: state.activeF, max: state.activeF };
          } else {
            currentOperation.feedRange.min = Math.min(currentOperation.feedRange.min, state.activeF);
            currentOperation.feedRange.max = Math.max(currentOperation.feedRange.max, state.activeF);
          }
        }
      }

      // -----------------------------------------------------------------------
      // Track tool offsets
      // -----------------------------------------------------------------------
      if (state.activeTool !== null && toolMap.has(state.activeTool)) {
        const tool = toolMap.get(state.activeTool)!;
        if (state.activeToolOffset.H !== null) tool.offsetH = state.activeToolOffset.H;
        if (state.activeToolOffset.D !== null) tool.offsetD = state.activeToolOffset.D;
        if (state.activeS !== null) {
          tool.maxSpindleSpeed = Math.max(tool.maxSpindleSpeed ?? 0, state.activeS);
        }
        if (state.activeF !== null) {
          if (!tool.feedRange) {
            tool.feedRange = { min: state.activeF, max: state.activeF };
          } else {
            tool.feedRange.min = Math.min(tool.feedRange.min, state.activeF);
            tool.feedRange.max = Math.max(tool.feedRange.max, state.activeF);
          }
        }
      }

      // -----------------------------------------------------------------------
      // Canned cycle detection
      // -----------------------------------------------------------------------
      for (const g of block.gCodes) {
        if (CANNED_CYCLE_CODES.has(Math.floor(g.code))) {
          // Close previous cycle if any
          if (currentCycle) {
            model.cannedCycles.push(currentCycle);
          }

          currentCycle = {
            code: Math.floor(g.code),
            line: i,
            parameters: new Map(block.addresses),
            repeatCount: 1,
            repeatLines: [],
            conditionResults: [],
          };

          // Track in operation
          if (currentOperation) {
            const cycleStr = `G${Math.floor(g.code)}`;
            if (!currentOperation.cycleTypes!.includes(cycleStr)) {
              currentOperation.cycleTypes!.push(cycleStr);
            }
          }
        }

        // G80 closes current cycle
        if (Math.floor(g.code) === 80 && currentCycle) {
          model.cannedCycles.push(currentCycle);
          currentCycle = null;
        }
      }

      // -----------------------------------------------------------------------
      // Probing instance detection (G31, G38.2–G38.5)
      // -----------------------------------------------------------------------
      for (const g of block.gCodes) {
        const intCode = Math.floor(g.code);
        if (intCode === 31 || intCode === 38) {
          const isToward = PROBE_TOWARD_CODES.has(g.code) || intCode === 31;
          const isError = g.code === 31 || PROBE_ERROR_CODES.has(g.code);
          const probe: ProbeInstance = {
            code: g.code,
            line: i,
            direction: isToward ? 'toward' : 'away',
            errorOnNoContact: isError,
            targetPosition: {
              X: block.addresses.get('X')?.resolvedValue ?? undefined,
              Y: block.addresses.get('Y')?.resolvedValue ?? undefined,
              Z: block.addresses.get('Z')?.resolvedValue ?? undefined,
            },
            feedRate: block.addresses.get('F')?.resolvedValue ?? state.activeF,
          };
          model.probingInstances.push(probe);
        }
      }

      // If this block is a cycle repeat, add to current cycle
      if (block.isCycleRepeat && currentCycle) {
        currentCycle.repeatCount++;
        currentCycle.repeatLines.push(i);
      }
    }

    // Close final operation
    if (currentOperation && currentOperation.startLine !== undefined) {
      currentOperation.endLine = blocks.length - 1;
      model.operations.push(currentOperation as Operation);
    }

    // Close final cycle
    if (currentCycle) {
      model.cannedCycles.push(currentCycle);
    }

    // Convert tool map to array
    model.tools = Array.from(toolMap.values()).sort((a, b) => a.toolNumber - b.toolNumber);

    return model;
  }

  // ===========================================================================
  // Cycle repeat detection
  // ===========================================================================

  /**
   * Detect if a block is a cycle repeat: position-only line under active canned cycle.
   *
   * When a canned cycle is active (G83, G84, etc.), subsequent lines containing
   * only X/Y (mill) or X/Z (lathe) coordinates execute the cycle at that position.
   * These blocks have no G-code but ARE canned cycle executions.
   *
   * Example:
   *   G83 X1.0 Y1.0 Z-0.75 R0.1 Q0.15 F12.0  ← parent cycle
   *   X2.0 Y1.0                                  ← cycle repeat
   *   X3.0 Y1.0                                  ← cycle repeat
   *   G80                                         ← cancel
   */
  private detectCycleRepeat(
    block: GCodeBlock,
    state: ModalState,
    model: ProgramModel
  ): void {
    // Must have an active canned cycle
    if (state.activeCannedCycle === null) return;

    // Must have no G-codes or M-codes (position-only)
    if (block.gCodes.length > 0 || block.mCodes.length > 0) return;

    // Must have at least one position address
    if (block.addresses.size === 0) return;

    // Check if all addresses are position letters
    const addressLetters = new Set(block.addresses.keys());
    const isPositionOnly = Array.from(addressLetters).every(
      letter => POSITION_LETTERS_MILL.has(letter) || POSITION_LETTERS_LATHE.has(letter)
    );

    if (!isPositionOnly) return;

    // This IS a cycle repeat
    block.isCycleRepeat = true;

    // Find the parent cycle line
    const parentCycleLine = this.findParentCycleLine(block.line, model);
    if (parentCycleLine !== null) {
      block.parentCycleLineRef = parentCycleLine;
    }
  }

  /**
   * Walk backwards to find the line that defined the active canned cycle.
   */
  private findParentCycleLine(currentLine: number, model: ProgramModel): number | null {
    for (let i = currentLine - 1; i >= 0; i--) {
      const b = model.blocks[i];
      if (b && b.gCodes.some(g => CANNED_CYCLE_CODES.has(Math.floor(g.code)))) {
        return i;
      }
    }
    return null;
  }

  /**
   * Look at nearby lines for a comment that describes the tool/operation.
   * Checks the line itself, one line before, and one line after.
   */
  private findNearbyComment(blocks: GCodeBlock[], index: number): string | null {
    // Check current line
    if (blocks[index].comment) return blocks[index].comment!;

    // Check line before
    if (index > 0 && blocks[index - 1].comment) {
      return blocks[index - 1].comment!;
    }

    // Check line after
    if (index < blocks.length - 1 && blocks[index + 1].comment) {
      return blocks[index + 1].comment!;
    }

    return null;
  }

  /**
   * A number in any form a shop writes one: 5, 5.0, 5. and .201
   *
   * `\d+\.?\d*` cannot read `.201` - it needs a digit before the point - so a
   * leading-decimal diameter was previously read as 201.
   */
  private static readonly NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)`;

  private static readonly HOLDER =
    String.raw`CAT\d+|HSK-[A-Z]\d+|BT\d+|KM\d+|ER\d+|Capto|Weldon|Shrink|Hydraulic|R8`;

  /** Read a labelled value written either way round: "DIA 0.5", "0.5 DIA", "DIA=0.5". */
  private static readLabelled(text: string, label: string): number | undefined {
    const N = ProgramModelBuilder.NUM;
    for (const re of [
      new RegExp(String.raw`\b(?:${label})\b\s*[:=]?\s*(${N})`, 'i'),
      new RegExp(String.raw`(${N})\s*(?:${label})\b`, 'i'),
    ]) {
      const m = text.match(re);
      if (m) {
        const v = Number.parseFloat(m[1]);
        if (Number.isFinite(v) && v > 0) return v;
      }
    }
    return undefined;
  }

  /** "1/2" -> 0.5, "3/8" -> 0.375. Also handles the "1/4-20" tap form. */
  private static readFraction(text: string): number | undefined {
    const m = text.match(/(?:^|[\s(-])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])/);
    if (!m) return undefined;
    const n = Number.parseInt(m[1], 10);
    const d = Number.parseInt(m[2], 10);
    if (!d || !Number.isFinite(n)) return undefined;
    const v = n / d;
    return v > 0 ? v : undefined;
  }

  /**
   * Extract tool specs from a comment near the T-call.
   *
   * The comment is shop prose, not a schema, so the order of attempts matters:
   * an explicit label beats a fraction, a fraction beats a bare number, and the
   * positional guess is a last resort.
   *
   * The tool number is stripped first. It used to be the FIRST number in the
   * comment, so the positional fallback assigned it as the diameter - "T5 - .201
   * DIA DRILL - 118 DEG" produced diameter 5, length-of-cut 201 and stick-out
   * 118 (the drill point angle). Every tool in a program came out with its
   * diameter equal to its tool number, which is the wrong cutter width in the
   * simulation and the wrong tool on screen.
   */
  private extractToolSpecs(comment: string, tool: ToolUsage): void {
    const N = ProgramModelBuilder.NUM;
    const H = ProgramModelBuilder.HOLDER;

    // Drop the tool number, and the drill point angle, before reading numbers.
    const text = comment
      .replace(/\bT\s*0*\d+\b/gi, ' ')
      .replace(/\b\d{2,3}\s*(?:DEG|DEGREE|°)\b/gi, ' ');

    // Pattern 1: the fully specified form, "0.5 dia, 1.5 lc, 3.0 oh, CAT40"
    const full = text.match(new RegExp(
      String.raw`(${N})\s*d(?:ia)?[\s,]*(${N})\s*(?:lc|length.?cut)[\s,]*(${N})\s*(?:oh|loh|length.?holder|stick)?[\s,]*(${H})`,
      'i'
    ));
    if (full) {
      tool.diameter = parseFloat(full[1]);
      tool.lengthOfCut = parseFloat(full[2]);
      tool.lengthOutOfHolder = parseFloat(full[3]);
      tool.holder = full[4];
      return;
    }

    // Pattern 2: labelled values, in either order and with or without '='.
    // The old regexes were mis-grouped - /lc|lengthcut\s*=\s*(\d+)/ alternates
    // on a BARE "lc", so any comment containing those two letters (CALC, BLOCK)
    // matched with no capture group and set the spec to NaN.
    const dia =
      ProgramModelBuilder.readLabelled(text, String.raw`dia(?:meter)?|dc|[oø]d`) ??
      ProgramModelBuilder.readFraction(text) ??
      ProgramModelBuilder.readLabelled(
        text,
        String.raw`ball|bull|flat|face\s*mill|end\s*?mill|endmill|drill|tap|reamer|spot\s*drill|chamfer`
      );
    const lc = ProgramModelBuilder.readLabelled(text, String.raw`lc|loc|length\s*of\s*cut|flute\s*length`);
    const oh = ProgramModelBuilder.readLabelled(
      text,
      String.raw`oh|loh|stick\s*-?\s*out|stickout|length\s*out\s*of\s*holder|gauge\s*length`
    );
    const holder = text.match(new RegExp(String.raw`(?:holder\s*[:=]?\s*)?(${H})`, 'i'));

    if (dia !== undefined) tool.diameter = dia;
    if (lc !== undefined) tool.lengthOfCut = lc;
    if (oh !== undefined) tool.lengthOutOfHolder = oh;
    if (holder) tool.holder = holder[1];

    // Pattern 3: positional guess, only when nothing was labelled at all and the
    // comment is a bare spec list like "0.5 1.5 3.0". Requires exactly three
    // numbers so that prose such as "1/2 FLAT ENDMILL - 4FL" cannot reach here.
    if (dia === undefined && lc === undefined && oh === undefined) {
      const nums = text.match(new RegExp(N, 'g'));
      if (nums && nums.length === 3 && !/[a-z]/i.test(text.replace(new RegExp(N, 'g'), ''))) {
        tool.diameter = parseFloat(nums[0]);
        tool.lengthOfCut = parseFloat(nums[1]);
        tool.lengthOutOfHolder = parseFloat(nums[2]);
      }
    }
  }

  /**
   * Extract stock dimensions from comments (STOCK: W=4 D=4 H=2)
   */
  private extractStockDimensions(blocks: GCodeBlock[]): { width: number; depth: number; height: number } | undefined {
    for (const block of blocks) {
      if (!block.comment) continue;
      // Same number forms as everywhere else: 4, 4.0, 4. and .75. The previous
      // `\d+\.?\d*` needed a digit before the point, so a stock declared as
      // W=.75 was not seen at all - and with no stock there is no stock box and
      // no jaws, silently.
      const N = ProgramModelBuilder.NUM;
      const match = block.comment.match(
        new RegExp(String.raw`STOCK:\s*W[=\s]*(${N})\s*D[=\s]*(${N})\s*H[=\s]*(${N})`, 'i')
      );
      if (match) {
        return {
          width: parseFloat(match[1]),
          depth: parseFloat(match[2]),
          height: parseFloat(match[3]),
        };
      }
    }
    return undefined;
  }

  /**
   * Auto-detect machine type from G-code patterns
   */
  private detectMachineType(blocks: GCodeBlock[], dialect: string): string {
    let hasA = false, hasB = false, hasC = false;
    let hasTurningCycles = false;
    let hasMillingCycles = false;
    let hasSurfaceSpeed = false;

    for (const block of blocks) {
      if (block.addresses.has('A')) hasA = true;
      if (block.addresses.has('B')) hasB = true;
      if (block.addresses.has('C')) hasC = true;

      for (const g of block.gCodes) {
        const code = g.code;
        // G70–G76: turning/threading cycles
        if (code >= 70 && code <= 76) hasTurningCycles = true;
        // G96/G97: constant surface speed and its cancel. These are spindle
        // modes that only exist on a turning machine.
        if (code === 96 || code === 97) hasSurfaceSpeed = true;
        // G12.1 / G14: mill-turn
        if (code === 12.1 || code === 14) return '5-Axis Mill-Turn';
        // G81–G89: milling canned cycles
        if (code >= 81 && code <= 89) hasMillingCycles = true;
      }
    }

    // Lathe. Turning cycles are the clearest signal, but plenty of real lathe
    // work is a plain face-and-turn in G0/G1 with no canned cycle at all, and
    // that was being reported as a 3-axis mill - which then put vise jaws on a
    // chucked part. G96/G97 and the Okuma dialect close that gap without
    // guessing: both only occur on a turning machine.
    if (hasTurningCycles || hasSurfaceSpeed || dialect === 'okuma' || dialect.includes('lathe')) {
      return 'Turn Center (2-Axis)';
    }

    // 5-axis: any two distinct rotary axes accompany XYZ motion.
    if (Number(hasA) + Number(hasB) + Number(hasC) >= 2) return '5-Axis Mill (Trunnion)';

    // 4-axis: has A (or B/C single)
    if (hasA || hasB || hasC) return '4-Axis Mill';

    // Default 3-axis mill
    return '3-Axis Vertical Mill';
  }
}
