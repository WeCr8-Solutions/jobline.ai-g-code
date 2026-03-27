/**
 * JobLine G-Code Tokenizer — Stage 1
 * Architecture v0.4.0 Section 3.1
 *
 * Splits each line into typed tokens. Handles all 5 dialects including
 * Macro B expressions, Siemens CYCLE calls, and Okuma $ prefixes.
 *
 * Input:  raw text line
 * Output: TokenizedLine with typed GCodeToken[]
 */

import {
  GCodeToken,
  TokenizedLine,
  MacroExpressionToken,
} from './types';

// =============================================================================
// Regex patterns
// =============================================================================

/** Matches parenthesized comments: (anything) */
const PAREN_COMMENT = /\(([^)]*)\)/g;

/** Matches semicolon comments: ; to end of line */
const SEMI_COMMENT = /;(.*)$/;

/** Matches O-number program headers: O0001, O1234 */
const PROGRAM_NUM_O = /^[Oo](\d{1,8})/;

/** Matches Okuma $ program headers: $08684 */
const PROGRAM_NUM_DOLLAR = /^\$(\d{1,8})/;

/** Matches N-line numbers: N100, N10 */
const LINE_NUM = /[Nn](\d+)/;

/** Matches G-codes: G0, G01, G83, G54.1 */
const G_CODE = /[Gg]\s*(\d{1,3})(\.\d)?/;

/** Matches M-codes: M0, M03, M98 */
const M_CODE = /[Mm]\s*(\d{1,3})/;

/** Matches tool calls: T01, T12 */
const TOOL_CALL = /[Tt]\s*(\d{1,4})/;

/** Matches simple address letters: X, Y, Z, A, B, C, I, J, K, R, Q, F, S, H, D, P, L, U, W */
const ADDRESS_LETTER = /[XYZABCIJKRQFSHD PL UW]/i;

/** Matches numeric values: 1.5, -2.0, .5, 1. */
const NUMERIC = /[-+]?\d*\.?\d+/;

/** Matches macro variable: #100, #5021 */
const MACRO_VAR = /#(\d+)/;

/** Matches Okuma variable: #V1, #V100 */
const OKUMA_VAR = /#[Vv](\d+)/;

/** Matches Siemens CYCLE call: CYCLE83, CYCLE84 */
const SIEMENS_CYCLE = /\b(CYCLE\d{2,3}|MCALL|HOLES[12]|POCKET[1-4]|SLOT[12]|LONGHOLE|SWIVEL)\b/i;

/** Matches Okuma CALL: CALL OB1 */
const OKUMA_CALL = /\bCALL\s+(OB\d+)/i;

/** Matches control flow keywords */
const CONTROL_FLOW = /\b(IF|THEN|ELSE|ENDIF|GOTO|WHILE|DO|END)\b/i;

/** Matches % delimiter lines */
const PERCENT = /^\s*%\s*$/;

/** Matches block skip */
const BLOCK_SKIP = /^\s*\//;

// =============================================================================
// Tokenizer
// =============================================================================

export class Tokenizer {
  /**
   * Tokenize a single line of G-code.
   */
  tokenizeLine(line: string, lineNumber: number): TokenizedLine {
    const trimmed = line.trim();

    // Empty lines
    if (trimmed.length === 0) {
      return { lineNumber, tokens: [], raw: line, isEmpty: true, isComment: false };
    }

    // % delimiter
    if (PERCENT.test(trimmed)) {
      return {
        lineNumber,
        tokens: [{
          type: 'percentDelimiter',
          value: { kind: 'literal', value: 0 },
          raw: '%',
          startCol: line.indexOf('%'),
          endCol: line.indexOf('%') + 1,
        }],
        raw: line,
        isEmpty: false,
        isComment: false,
      };
    }

    const tokens: GCodeToken[] = [];
    let isComment = false;

    // Strip and capture comments first, replacing with spaces to preserve positions
    let working = line;
    const comments: Array<{ text: string; start: number; end: number }> = [];

    // Semicolon comment — everything after ; is comment
    const semiMatch = SEMI_COMMENT.exec(working);
    if (semiMatch) {
      const start = working.indexOf(';');
      comments.push({ text: semiMatch[1], start, end: working.length });
      tokens.push({
        type: 'comment',
        value: { kind: 'literal', value: 0 },
        raw: semiMatch[0],
        startCol: start,
        endCol: working.length,
      });
      working = working.substring(0, start) + ' '.repeat(working.length - start);
    }

    // Parenthesized comments
    let parenMatch: RegExpExecArray | null;
    const parenRegex = new RegExp(PAREN_COMMENT.source, 'g');
    while ((parenMatch = parenRegex.exec(working)) !== null) {
      const start = parenMatch.index;
      const end = start + parenMatch[0].length;
      comments.push({ text: parenMatch[1], start, end });
      tokens.push({
        type: 'comment',
        value: { kind: 'literal', value: 0 },
        raw: parenMatch[0],
        startCol: start,
        endCol: end,
      });
      // Replace with spaces to preserve column positions
      working = working.substring(0, start) + ' '.repeat(end - start) + working.substring(end);
    }

    // Check if entire line is comment
    if (working.trim().length === 0 && comments.length > 0) {
      isComment = true;
      return { lineNumber, tokens, raw: line, isEmpty: false, isComment };
    }

    // Block skip
    if (BLOCK_SKIP.test(working)) {
      const idx = working.indexOf('/');
      tokens.push({
        type: 'blockSkip',
        value: { kind: 'literal', value: 0 },
        raw: '/',
        startCol: idx,
        endCol: idx + 1,
      });
      working = working.substring(0, idx) + ' ' + working.substring(idx + 1);
    }

    // Now scan the working string for code tokens
    let pos = 0;
    while (pos < working.length) {
      // Skip whitespace
      if (/\s/.test(working[pos])) {
        pos++;
        continue;
      }

      const remaining = working.substring(pos);
      let matched = false;

      // Program number (O or $) — only at start of meaningful content
      if (tokens.filter(t => t.type !== 'comment' && t.type !== 'blockSkip').length === 0) {
        const oMatch = PROGRAM_NUM_O.exec(remaining);
        if (oMatch) {
          tokens.push({
            type: 'programNumber',
            value: { kind: 'literal', value: parseInt(oMatch[1], 10) },
            raw: oMatch[0],
            startCol: pos,
            endCol: pos + oMatch[0].length,
          });
          pos += oMatch[0].length;
          matched = true;
        }
        if (!matched) {
          const dollarMatch = PROGRAM_NUM_DOLLAR.exec(remaining);
          if (dollarMatch) {
            tokens.push({
              type: 'programNumber',
              value: { kind: 'literal', value: parseInt(dollarMatch[1], 10) },
              raw: dollarMatch[0],
              startCol: pos,
              endCol: pos + dollarMatch[0].length,
            });
            pos += dollarMatch[0].length;
            matched = true;
          }
        }
      }

      // Control flow (IF, GOTO, WHILE, DO, END)
      if (!matched) {
        const cfMatch = CONTROL_FLOW.exec(remaining);
        if (cfMatch && cfMatch.index === 0) {
          tokens.push({
            type: 'controlFlow',
            value: { kind: 'literal', value: 0 },
            raw: cfMatch[0],
            letter: cfMatch[1].toUpperCase(),
            startCol: pos,
            endCol: pos + cfMatch[0].length,
          });
          pos += cfMatch[0].length;
          matched = true;
        }
      }

      // Siemens CYCLE call
      if (!matched) {
        const cycleMatch = SIEMENS_CYCLE.exec(remaining);
        if (cycleMatch && cycleMatch.index === 0) {
          tokens.push({
            type: 'siemensCycle',
            value: { kind: 'literal', value: 0 },
            raw: cycleMatch[0],
            startCol: pos,
            endCol: pos + cycleMatch[0].length,
          });
          pos += cycleMatch[0].length;
          matched = true;
        }
      }

      // Okuma CALL
      if (!matched) {
        const okumaMatch = OKUMA_CALL.exec(remaining);
        if (okumaMatch && okumaMatch.index === 0) {
          tokens.push({
            type: 'okumaCall',
            value: { kind: 'literal', value: 0 },
            raw: okumaMatch[0],
            startCol: pos,
            endCol: pos + okumaMatch[0].length,
          });
          pos += okumaMatch[0].length;
          matched = true;
        }
      }

      // N-line number
      if (!matched && /[Nn]/.test(remaining[0])) {
        const nMatch = LINE_NUM.exec(remaining);
        if (nMatch && nMatch.index === 0) {
          tokens.push({
            type: 'lineNumber',
            value: { kind: 'literal', value: parseInt(nMatch[1], 10) },
            raw: nMatch[0],
            startCol: pos,
            endCol: pos + nMatch[0].length,
          });
          pos += nMatch[0].length;
          matched = true;
        }
      }

      // G-code
      if (!matched && /[Gg]/.test(remaining[0])) {
        const gMatch = G_CODE.exec(remaining);
        if (gMatch && gMatch.index === 0) {
          const code = parseInt(gMatch[1], 10);
          const subCode = gMatch[2] ? parseFloat(gMatch[1] + gMatch[2]) : undefined;
          tokens.push({
            type: 'G',
            code: subCode ?? code,
            value: { kind: 'literal', value: subCode ?? code },
            raw: gMatch[0],
            startCol: pos,
            endCol: pos + gMatch[0].length,
          });
          pos += gMatch[0].length;
          matched = true;
        }
      }

      // M-code
      if (!matched && /[Mm]/.test(remaining[0])) {
        const mMatch = M_CODE.exec(remaining);
        if (mMatch && mMatch.index === 0) {
          tokens.push({
            type: 'M',
            code: parseInt(mMatch[1], 10),
            value: { kind: 'literal', value: parseInt(mMatch[1], 10) },
            raw: mMatch[0],
            startCol: pos,
            endCol: pos + mMatch[0].length,
          });
          pos += mMatch[0].length;
          matched = true;
        }
      }

      // Tool call
      if (!matched && /[Tt]/.test(remaining[0])) {
        const tMatch = TOOL_CALL.exec(remaining);
        if (tMatch && tMatch.index === 0) {
          tokens.push({
            type: 'address',
            letter: 'T',
            value: { kind: 'literal', value: parseInt(tMatch[1], 10) },
            raw: tMatch[0],
            startCol: pos,
            endCol: pos + tMatch[0].length,
          });
          pos += tMatch[0].length;
          matched = true;
        }
      }

      // Macro variable assignment: #100 = ... or R1 = ...
      if (!matched && remaining[0] === '#') {
        const macroToken = this.tokenizeMacroVariable(remaining, pos);
        if (macroToken) {
          tokens.push(macroToken);
          pos += macroToken.raw.length;
          matched = true;
        }
      }

      // Address letter followed by value, variable, or expression
      if (!matched && ADDRESS_LETTER.test(remaining[0])) {
        const addrToken = this.tokenizeAddress(remaining, pos);
        if (addrToken) {
          tokens.push(addrToken);
          pos += addrToken.raw.length;
          matched = true;
        }
      }

      // Macro expression in brackets (standalone, not after an address)
      if (!matched && remaining[0] === '[') {
        const exprEnd = this.findMatchingBracket(remaining, 0);
        if (exprEnd > 0) {
          const raw = remaining.substring(0, exprEnd + 1);
          tokens.push({
            type: 'unknown',
            value: { kind: 'expression', raw, parts: this.tokenizeExpression(raw) },
            raw,
            startCol: pos,
            endCol: pos + raw.length,
          });
          pos += raw.length;
          matched = true;
        }
      }

      // Standalone number (shouldn't normally happen in well-formed G-code)
      if (!matched && /[-+\d.]/.test(remaining[0])) {
        const numMatch = NUMERIC.exec(remaining);
        if (numMatch && numMatch.index === 0) {
          tokens.push({
            type: 'unknown',
            value: { kind: 'literal', value: parseFloat(numMatch[0]) },
            raw: numMatch[0],
            startCol: pos,
            endCol: pos + numMatch[0].length,
          });
          pos += numMatch[0].length;
          matched = true;
        }
      }

      // Unknown character — skip
      if (!matched) {
        pos++;
      }
    }

    // Sort tokens by position (comments were added first but may be mid-line)
    tokens.sort((a, b) => a.startCol - b.startCol);

    return { lineNumber, tokens, raw: line, isEmpty: false, isComment };
  }

  /**
   * Tokenize an entire document.
   */
  tokenizeDocument(text: string): TokenizedLine[] {
    const lines = text.split(/\r?\n/);
    return lines.map((line, i) => this.tokenizeLine(line, i));
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Tokenize a macro variable: #100, #[expr], #V1
   */
  private tokenizeMacroVariable(text: string, baseCol: number): GCodeToken | null {
    // #V variable (Okuma)
    const okumaMatch = OKUMA_VAR.exec(text);
    if (okumaMatch && okumaMatch.index === 0) {
      return {
        type: 'address',
        letter: '#V',
        value: { kind: 'variable', variableNum: parseInt(okumaMatch[1], 10) },
        raw: okumaMatch[0],
        startCol: baseCol,
        endCol: baseCol + okumaMatch[0].length,
      };
    }

    // #nnn
    const varMatch = MACRO_VAR.exec(text);
    if (varMatch && varMatch.index === 0) {
      return {
        type: 'address',
        letter: '#',
        value: { kind: 'variable', variableNum: parseInt(varMatch[1], 10) },
        raw: varMatch[0],
        startCol: baseCol,
        endCol: baseCol + varMatch[0].length,
      };
    }

    // #[expression]
    if (text.length > 1 && text[1] === '[') {
      const bracketEnd = this.findMatchingBracket(text, 1);
      if (bracketEnd > 0) {
        const raw = text.substring(0, bracketEnd + 1);
        const exprRaw = text.substring(1, bracketEnd + 1);
        return {
          type: 'address',
          letter: '#',
          value: { kind: 'expression', raw: exprRaw, parts: this.tokenizeExpression(exprRaw) },
          raw,
          startCol: baseCol,
          endCol: baseCol + raw.length,
        };
      }
    }

    return null;
  }

  /**
   * Tokenize an address: letter followed by value/variable/expression.
   * Examples: X1.5, Y-2.0, Z[#5], F#100, H01
   */
  private tokenizeAddress(text: string, baseCol: number): GCodeToken | null {
    const letter = text[0].toUpperCase();
    let valueText = text.substring(1);
    let offset = 1;

    // Skip whitespace between letter and value
    while (offset < text.length && /\s/.test(text[offset])) {
      offset++;
      valueText = text.substring(offset);
    }

    if (valueText.length === 0) {
      return null;
    }

    // Value is a macro expression: Z[#5 + 1.0]
    if (valueText[0] === '[') {
      const bracketEnd = this.findMatchingBracket(valueText, 0);
      if (bracketEnd > 0) {
        const exprRaw = valueText.substring(0, bracketEnd + 1);
        const raw = text.substring(0, offset + bracketEnd + 1);
        return {
          type: 'address',
          letter,
          value: { kind: 'expression', raw: exprRaw, parts: this.tokenizeExpression(exprRaw) },
          raw,
          startCol: baseCol,
          endCol: baseCol + raw.length,
        };
      }
    }

    // Value is a macro variable: F#100, Z#5
    if (valueText[0] === '#') {
      const varMatch = /^#(\d+)/.exec(valueText);
      if (varMatch) {
        const raw = text.substring(0, offset + varMatch[0].length);
        return {
          type: 'address',
          letter,
          value: { kind: 'variable', variableNum: parseInt(varMatch[1], 10) },
          raw,
          startCol: baseCol,
          endCol: baseCol + raw.length,
        };
      }
    }

    // Value is a negative/positive number
    const numMatch = NUMERIC.exec(valueText);
    if (numMatch && numMatch.index === 0) {
      const raw = text.substring(0, offset + numMatch[0].length);
      return {
        type: 'address',
        letter,
        value: { kind: 'literal', value: parseFloat(numMatch[0]) },
        raw,
        startCol: baseCol,
        endCol: baseCol + raw.length,
      };
    }

    // Letter with no recognizable value — return just the letter
    return null;
  }

  /**
   * Find matching closing bracket for an opening '['.
   * Returns index of ']' or -1.
   */
  private findMatchingBracket(text: string, openPos: number): number {
    let depth = 0;
    for (let i = openPos; i < text.length; i++) {
      if (text[i] === '[') depth++;
      else if (text[i] === ']') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  /**
   * Tokenize the contents of a macro expression [...] into sub-tokens.
   * This is a lightweight pass — full evaluation happens in the MacroEvaluator.
   */
  private tokenizeExpression(exprText: string): MacroExpressionToken[] {
    const tokens: MacroExpressionToken[] = [];
    let pos = 0;
    const text = exprText;

    while (pos < text.length) {
      if (/\s/.test(text[pos])) { pos++; continue; }

      const remaining = text.substring(pos);

      // Brackets
      if (text[pos] === '[') {
        tokens.push({ type: 'open', raw: '[' });
        pos++;
        continue;
      }
      if (text[pos] === ']') {
        tokens.push({ type: 'close', raw: ']' });
        pos++;
        continue;
      }

      // Macro variable
      const varMatch = /^#(\d+)/.exec(remaining);
      if (varMatch) {
        tokens.push({ type: 'variable', raw: varMatch[0], value: parseInt(varMatch[1], 10) });
        pos += varMatch[0].length;
        continue;
      }

      // Function names
      const fnMatch = /^(SIN|COS|TAN|ATAN|ASIN|ACOS|SQRT|ABS|ROUND|FIX|FUP|LN|EXP)/i.exec(remaining);
      if (fnMatch) {
        tokens.push({ type: 'function', raw: fnMatch[0] });
        pos += fnMatch[0].length;
        continue;
      }

      // Comparison operators (Fanuc style)
      const cmpMatch = /^(EQ|NE|GT|GE|LT|LE)/i.exec(remaining);
      if (cmpMatch) {
        tokens.push({ type: 'comparison', raw: cmpMatch[0] });
        pos += cmpMatch[0].length;
        continue;
      }

      // Arithmetic operators
      if (/^[+\-*/]/.test(remaining)) {
        tokens.push({ type: 'operator', raw: remaining[0] });
        pos++;
        continue;
      }

      // MOD operator
      const modMatch = /^MOD/i.exec(remaining);
      if (modMatch) {
        tokens.push({ type: 'operator', raw: modMatch[0] });
        pos += modMatch[0].length;
        continue;
      }

      // Number
      const numMatch = NUMERIC.exec(remaining);
      if (numMatch && numMatch.index === 0) {
        tokens.push({ type: 'number', raw: numMatch[0], value: parseFloat(numMatch[0]) });
        pos += numMatch[0].length;
        continue;
      }

      // Unknown — skip
      pos++;
    }

    return tokens;
  }
}
