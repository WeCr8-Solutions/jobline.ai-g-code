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
  createDefaultModalState,
  cloneModalState,
} from './types';
import { ModalStateUpdater } from '../utils/modalState';

// Canned cycle G-codes
const CANNED_CYCLE_CODES = new Set([73, 74, 76, 81, 82, 83, 84, 85, 86, 87, 88, 89]);

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
      diagnostics: [],
      totalLines: blocks.length,
      dialect,
    };

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
          model.operations.push(currentOperation as Operation);
        }

        // Start new operation
        const toolNum = block.toolNumber ?? state.activeTool ?? 0;
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
          toolMap.set(toolNum, {
            toolNumber: toolNum,
            description: comment ?? undefined,
            lineNumbers: [],
          });
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
}
