/**
 * JobLine Macro B Evaluator
 * Architecture v0.4.0 Section 4
 *
 * Tracks variable assignments, resolves expressions via constant folding,
 * and marks addresses as resolved/unresolvable for the conditions engine.
 *
 * Design principle: best-effort forward-walk. We evaluate what we can
 * statically and mark everything else as unresolvable. This handles
 * 80%+ of real-world programs without attempting full symbolic execution.
 */

import {
  GCodeBlock,
  TokenValue,
  MacroExpressionToken,
  ResolvedAddress,
} from './types';

// =============================================================================
// Variable table
// =============================================================================

export interface VariableTable {
  /** Local variables #1-#33 (per-subprogram scope) */
  locals: Map<number, number | null>;
  /** Common variables #100-#199, #500-#999 */
  commons: Map<number, number | null>;
  /** System variables #1000+ (read-only) */
  system: Map<number, SystemVarInfo>;
  /** Siemens R-parameters R0-R299 */
  siemensR: Map<number, number | null>;
  /** Variables marked uncertain (set inside unresolvable branches) */
  uncertain: Set<number>;
}

export interface SystemVarInfo {
  name: string;
  description: string;
  writable: boolean;
}

// =============================================================================
// Common system variables
// =============================================================================

const SYSTEM_VARS: Map<number, SystemVarInfo> = new Map([
  [3000, { name: 'Alarm', description: 'Trigger alarm', writable: true }],
  [4001, { name: 'Group 1 modal', description: 'Active G-code group 1 (motion)', writable: false }],
  [4003, { name: 'Sequence number', description: 'Current N number', writable: false }],
  [4014, { name: 'Active F', description: 'Current feed rate', writable: false }],
  [4015, { name: 'Active S', description: 'Current spindle speed', writable: false }],
  [4119, { name: 'Active T', description: 'Current tool number', writable: false }],
  [5001, { name: 'End point X', description: 'Previous block endpoint X', writable: false }],
  [5002, { name: 'End point Y', description: 'Previous block endpoint Y', writable: false }],
  [5003, { name: 'End point Z', description: 'Previous block endpoint Z', writable: false }],
  [5021, { name: 'Machine pos X', description: 'Current machine coordinate X', writable: false }],
  [5022, { name: 'Machine pos Y', description: 'Current machine coordinate Y', writable: false }],
  [5023, { name: 'Machine pos Z', description: 'Current machine coordinate Z', writable: false }],
  [5041, { name: 'Work pos X', description: 'Current work coordinate X', writable: false }],
  [5042, { name: 'Work pos Y', description: 'Current work coordinate Y', writable: false }],
  [5043, { name: 'Work pos Z', description: 'Current work coordinate Z', writable: false }],
]);

// =============================================================================
// Evaluator
// =============================================================================

export class MacroEvaluator {
  private variables: VariableTable;

  constructor() {
    this.variables = this.createEmptyTable();
  }

  /** Reset for a new program */
  reset(): void {
    this.variables = this.createEmptyTable();
  }

  /** Get a snapshot of the current variable table */
  snapshot(): VariableTable {
    return {
      locals: new Map(this.variables.locals),
      commons: new Map(this.variables.commons),
      system: this.variables.system, // Shared reference (read-only)
      siemensR: new Map(this.variables.siemensR),
      uncertain: new Set(this.variables.uncertain),
    };
  }

  /**
   * Process a block: handle assignments, resolve addresses where possible.
   * Call this for each block during the program model walk.
   */
  processBlock(block: GCodeBlock): void {
    // Handle variable assignment: #100 = [expression]
    if (block.macroAssignment) {
      const { variableNum, expression } = block.macroAssignment;
      const value = this.resolveTokenValue(expression);
      this.setVariable(variableNum, value);
    }

    // Try to resolve unresolved addresses using current variable table
    if (block.hasMacroExpressions) {
      for (const [, addr] of block.addresses) {
        if (!addr.isFullyResolved) {
          const resolved = this.tryResolveAddress(addr);
          if (resolved !== null) {
            addr.resolvedValue = resolved;
            addr.isFullyResolved = true;
          }
        }
      }
    }

    // Handle control flow — mark variables as uncertain after branches
    if (block.controlFlow) {
      this.handleControlFlow(block);
    }
  }

  /**
   * Look up a variable value. Returns null if unknown/unset.
   */
  getVariable(num: number): number | null {
    if (this.variables.uncertain.has(num)) return null;
    if (num >= 1 && num <= 33) return this.variables.locals.get(num) ?? null;
    if (num >= 100 && num <= 999) return this.variables.commons.get(num) ?? null;
    return null; // System vars can't be resolved statically
  }

  /**
   * Get completions for # variables (for IntelliSense).
   */
  getVariableCompletions(): Array<{ num: number; value: number | null; label: string }> {
    const completions: Array<{ num: number; value: number | null; label: string }> = [];

    // Locals with known values
    for (const [num, val] of this.variables.locals) {
      if (val !== null) {
        completions.push({ num, value: val, label: `#${num} = ${val} (local)` });
      }
    }

    // Commons with known values
    for (const [num, val] of this.variables.commons) {
      if (val !== null) {
        completions.push({ num, value: val, label: `#${num} = ${val} (common)` });
      }
    }

    // System variables
    for (const [num, info] of SYSTEM_VARS) {
      completions.push({ num, value: null, label: `#${num} — ${info.name}: ${info.description}` });
    }

    return completions;
  }

  // ===========================================================================
  // Resolution
  // ===========================================================================

  /**
   * Try to resolve a TokenValue to a number using current variable table.
   */
  resolveTokenValue(tv: TokenValue): number | null {
    switch (tv.kind) {
      case 'literal':
        return tv.value;

      case 'variable':
        return this.getVariable(tv.variableNum);

      case 'expression':
        return this.evaluateExpressionTokens(tv.parts);

      case 'indirectG':
        return this.getVariable(tv.variableNum);

      case 'unresolvable':
        return null;
    }
  }

  /**
   * Try to resolve an address that has a macro expression.
   */
  private tryResolveAddress(addr: ResolvedAddress): number | null {
    return this.resolveTokenValue(addr.rawValue);
  }

  /**
   * Evaluate expression tokens (constant folding).
   * Returns null if any referenced variable is unknown.
   */
  private evaluateExpressionTokens(tokens: MacroExpressionToken[]): number | null {
    if (tokens.length === 0) return null;

    // Simple case: single number
    if (tokens.length === 1 && tokens[0].type === 'number') {
      return tokens[0].value ?? null;
    }

    // Simple case: single variable
    if (tokens.length === 1 && tokens[0].type === 'variable') {
      return this.getVariable(tokens[0].value ?? 0);
    }

    // Build a simple postfix evaluator for basic arithmetic
    try {
      return this.evalExpression(tokens, 0).value;
    } catch {
      return null;
    }
  }

  /**
   * Recursive descent expression evaluator.
   * Handles: +, -, *, /, functions, nested brackets, variables.
   */
  private evalExpression(
    tokens: MacroExpressionToken[],
    start: number
  ): { value: number | null; end: number } {
    let result: number | null = null;
    let pos = start;
    let pendingOp: string | null = null;

    while (pos < tokens.length) {
      const tok = tokens[pos];

      if (tok.type === 'close') {
        break;
      }

      if (tok.type === 'open') {
        // Recurse into sub-expression
        const sub = this.evalExpression(tokens, pos + 1);
        const val = sub.value;
        pos = sub.end + 1; // Skip past ']'
        result = this.applyOp(result, val, pendingOp);
        pendingOp = null;
        continue;
      }

      if (tok.type === 'number') {
        const val = tok.value ?? null;
        result = this.applyOp(result, val, pendingOp);
        pendingOp = null;
        pos++;
        continue;
      }

      if (tok.type === 'variable') {
        const val = this.getVariable(tok.value ?? 0);
        if (val === null) return { value: null, end: pos };
        result = this.applyOp(result, val, pendingOp);
        pendingOp = null;
        pos++;
        continue;
      }

      if (tok.type === 'operator') {
        pendingOp = tok.raw;
        pos++;
        continue;
      }

      if (tok.type === 'function') {
        // Next token should be '[' opening the argument
        const fnName = tok.raw.toUpperCase();
        pos++;
        if (pos < tokens.length && tokens[pos].type === 'open') {
          const sub = this.evalExpression(tokens, pos + 1);
          if (sub.value === null) return { value: null, end: sub.end };
          const fnResult = this.evalFunction(fnName, sub.value);
          pos = sub.end + 1;
          result = this.applyOp(result, fnResult, pendingOp);
          pendingOp = null;
        }
        continue;
      }

      // Comparison operators — we can't statically evaluate these in general
      if (tok.type === 'comparison') {
        return { value: null, end: pos };
      }

      pos++;
    }

    return { value: result, end: pos };
  }

  private applyOp(left: number | null, right: number | null, op: string | null): number | null {
    if (right === null) return null;
    if (left === null) return right;
    if (op === null) return right;

    switch (op) {
      case '+': return left + right;
      case '-': return left - right;
      case '*': return left * right;
      case '/': return right !== 0 ? left / right : null;
      default: return null;
    }
  }

  private evalFunction(name: string, arg: number): number | null {
    const rad = arg * Math.PI / 180; // G-code trig uses degrees
    switch (name) {
      case 'SIN': return Math.sin(rad);
      case 'COS': return Math.cos(rad);
      case 'TAN': return Math.tan(rad);
      case 'ASIN': return Math.asin(arg) * 180 / Math.PI;
      case 'ACOS': return Math.acos(arg) * 180 / Math.PI;
      case 'ATAN': return Math.atan(arg) * 180 / Math.PI;
      case 'SQRT': return arg >= 0 ? Math.sqrt(arg) : null;
      case 'ABS': return Math.abs(arg);
      case 'ROUND': return Math.round(arg);
      case 'FIX': return Math.trunc(arg); // Toward zero
      case 'FUP': return arg >= 0 ? Math.ceil(arg) : Math.floor(arg); // Away from zero
      case 'LN': return arg > 0 ? Math.log(arg) : null;
      case 'EXP': return Math.exp(arg);
      default: return null;
    }
  }

  // ===========================================================================
  // Variable storage
  // ===========================================================================

  private setVariable(num: number, value: number | null): void {
    this.variables.uncertain.delete(num);
    if (num >= 1 && num <= 33) {
      this.variables.locals.set(num, value);
    } else if (num >= 100 && num <= 999) {
      this.variables.commons.set(num, value);
    }
    // System vars: ignore writes to read-only
  }

  // ===========================================================================
  // Control flow
  // ===========================================================================

  private handleControlFlow(block: GCodeBlock): void {
    if (!block.controlFlow) return;

    // After an IF/GOTO with an unresolvable condition, any variables
    // that could be modified in either branch become uncertain.
    // Conservative: we just mark locals modified after this point as uncertain
    // until we see them assigned again unconditionally.
    if (block.controlFlow.type === 'IF' || block.controlFlow.type === 'WHILE') {
      // We can't resolve the branch statically, so mark all locals as uncertain
      // This is conservative but safe — better to say "can't validate" than to
      // give wrong validation results
      for (const [num] of this.variables.locals) {
        this.variables.uncertain.add(num);
      }
    }
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  private createEmptyTable(): VariableTable {
    return {
      locals: new Map(),
      commons: new Map(),
      system: SYSTEM_VARS,
      siemensR: new Map(),
      uncertain: new Set(),
    };
  }
}
