/**
 * JobLine G-Code Block Parser — Stage 2
 * Architecture v0.4.0 Section 3.2
 *
 * Converts TokenizedLine into GCodeBlock with semantic structure:
 * G-codes, M-codes, resolved addresses, comments, macro assignments,
 * and control flow detection.
 *
 * Input:  TokenizedLine
 * Output: GCodeBlock
 */

import {
  TokenizedLine,
  GCodeToken,
  GCodeBlock,
  GCode,
  MCode,
  ResolvedAddress,
  TokenValue,
} from './types';

export class BlockParser {
  /**
   * Parse a single tokenized line into a structured block.
   */
  parseBlock(tokenized: TokenizedLine): GCodeBlock {
    const block: GCodeBlock = {
      line: tokenized.lineNumber,
      gCodes: [],
      mCodes: [],
      addresses: new Map(),
      raw: tokenized.raw,
      blockSkip: false,
      isCycleRepeat: false,
      hasMacroExpressions: false,
    };

    if (tokenized.isEmpty || tokenized.isComment) {
      if (tokenized.isComment) {
        block.comment = this.extractCommentText(tokenized.tokens);
      }
      return block;
    }

    for (const token of tokenized.tokens) {
      switch (token.type) {
        case 'G':
          this.processGCode(token, block);
          break;

        case 'M':
          this.processMCode(token, block);
          break;

        case 'address':
          this.processAddress(token, block);
          break;

        case 'lineNumber':
          if (token.value.kind === 'literal') {
            block.blockNumber = token.value.value;
          }
          break;

        case 'programNumber':
          if (token.value.kind === 'literal') {
            block.programNumber = token.raw;
          }
          break;

        case 'comment':
          if (!block.comment) {
            block.comment = this.extractSingleComment(token);
          } else {
            block.comment += ' ' + this.extractSingleComment(token);
          }
          break;

        case 'blockSkip':
          block.blockSkip = true;
          break;

        case 'controlFlow':
          this.processControlFlow(token, tokenized.tokens, block);
          break;

        case 'siemensCycle':
          this.processSiemensCycle(token, tokenized, block);
          break;

        case 'okumaCall':
          block.controlFlow = {
            type: 'GOTO',
            target: undefined,
            condition: token.raw,
          };
          break;

        case 'macroAssignment':
        case 'percentDelimiter':
        case 'unknown':
          // Handled or skipped
          break;
      }
    }

    // Detect macro assignments: #100 = value
    this.detectMacroAssignment(tokenized.tokens, block);

    return block;
  }

  /**
   * Parse an entire tokenized document into blocks.
   */
  parseDocument(tokenizedLines: TokenizedLine[]): GCodeBlock[] {
    return tokenizedLines.map(line => this.parseBlock(line));
  }

  // ===========================================================================
  // Private processing methods
  // ===========================================================================

  private processGCode(token: GCodeToken, block: GCodeBlock): void {
    if (token.code === undefined) return;

    const code = token.code;
    const intPart = Math.floor(code);
    const hasSub = code !== intPart;

    const gCode: GCode = {
      code: hasSub ? code : intPart,
      subCode: hasSub ? code : undefined,
      raw: token.raw,
      startCol: token.startCol,
      endCol: token.endCol,
    };

    block.gCodes.push(gCode);
  }

  private processMCode(token: GCodeToken, block: GCodeBlock): void {
    if (token.code === undefined) return;

    const mCode: MCode = {
      code: token.code,
      raw: token.raw,
      startCol: token.startCol,
      endCol: token.endCol,
    };

    block.mCodes.push(mCode);
  }

  private processAddress(token: GCodeToken, block: GCodeBlock): void {
    const letter = token.letter?.toUpperCase();
    if (!letter) return;

    // Special case: T (tool number)
    if (letter === 'T') {
      if (token.value.kind === 'literal') {
        block.toolNumber = token.value.value;
      }
    }

    const resolved: ResolvedAddress = {
      letter,
      rawValue: token.value,
      resolvedValue: token.value.kind === 'literal' ? token.value.value : null,
      isFullyResolved: token.value.kind === 'literal',
      startCol: token.startCol,
      endCol: token.endCol,
    };

    if (!resolved.isFullyResolved) {
      block.hasMacroExpressions = true;
    }

    // Store by letter — last one wins if duplicated (rare but possible)
    block.addresses.set(letter, resolved);
  }

  private processControlFlow(
    token: GCodeToken,
    allTokens: GCodeToken[],
    block: GCodeBlock
  ): void {
    const keyword = token.letter?.toUpperCase();
    if (!keyword) return;

    switch (keyword) {
      case 'GOTO': {
        // Find the target N-number after GOTO
        const gotoTarget = this.findNumberAfterToken(token, allTokens);
        block.controlFlow = {
          type: 'GOTO',
          target: gotoTarget ?? undefined,
        };
        break;
      }
      case 'IF': {
        // IF [condition] GOTO nnn or IF [condition] THEN
        block.controlFlow = {
          type: 'IF',
          condition: this.extractConditionText(token, allTokens),
        };
        // Look for GOTO within the IF line
        const gotoInIf = allTokens.find(
          t => t.type === 'controlFlow' && t.letter?.toUpperCase() === 'GOTO'
        );
        if (gotoInIf) {
          block.controlFlow.target = this.findNumberAfterToken(gotoInIf, allTokens) ?? undefined;
        }
        break;
      }
      case 'WHILE':
        block.controlFlow = {
          type: 'WHILE',
          condition: this.extractConditionText(token, allTokens),
        };
        break;
      case 'DO':
        block.controlFlow = { type: 'DO' };
        break;
      case 'END':
        block.controlFlow = { type: 'END' };
        break;
    }
  }

  private processSiemensCycle(
    token: GCodeToken,
    tokenized: TokenizedLine,
    block: GCodeBlock
  ): void {
    // Extract cycle name (e.g., "CYCLE83")
    const cycleName = token.raw.toUpperCase();

    // Parse positional parameters from parentheses after the cycle name
    // CYCLE83(50, 0, 2, -30, , 5)
    const afterCycle = tokenized.raw.substring(token.endCol);
    const parenMatch = /^\s*\(([^)]*)\)/.exec(afterCycle);

    if (parenMatch) {
      const paramStr = parenMatch[1];
      const params = paramStr.split(',').map(p => p.trim());

      // Map positional params to synthetic address tokens
      // The specific mapping depends on the cycle — that's the dialect's job
      // For now, store as P0, P1, P2, etc.
      params.forEach((param, index) => {
        if (param.length === 0) return; // Empty parameter (skipped)

        const letter = `_P${index}`; // Synthetic positional key
        let value: TokenValue;

        const numVal = parseFloat(param);
        if (!isNaN(numVal)) {
          value = { kind: 'literal', value: numVal };
        } else if (/^R\d+$/i.test(param)) {
          // Siemens R-parameter reference
          value = { kind: 'variable', variableNum: parseInt(param.substring(1), 10) };
          block.hasMacroExpressions = true;
        } else {
          value = { kind: 'unresolvable' };
          block.hasMacroExpressions = true;
        }

        block.addresses.set(letter, {
          letter,
          rawValue: value,
          resolvedValue: value.kind === 'literal' ? value.value : null,
          isFullyResolved: value.kind === 'literal',
          startCol: token.endCol,
          endCol: token.endCol + parenMatch[0].length,
        });
      });
    }

    // Also add a synthetic G-code so the conditions engine can find it
    const cycleNum = parseInt(cycleName.replace(/\D/g, ''), 10);
    if (!isNaN(cycleNum)) {
      block.gCodes.push({
        code: cycleNum,
        raw: token.raw,
        startCol: token.startCol,
        endCol: token.endCol,
      });
    }
  }

  /**
   * Detect macro variable assignments: #100 = [expression]
   */
  private detectMacroAssignment(tokens: GCodeToken[], block: GCodeBlock): void {
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type !== 'address' || token.letter !== '#') continue;

      // Check if there's an '=' in the raw line after this token
      const afterToken = block.raw.substring(token.endCol);
      const eqMatch = /^\s*=\s*/.exec(afterToken);
      if (!eqMatch) continue;

      if (token.value.kind === 'variable') {
        // Find the value after '='
        const valueStart = token.endCol + eqMatch[0].length;
        const valueText = block.raw.substring(valueStart).trim();

        let exprValue: TokenValue;
        if (valueText.startsWith('[')) {
          exprValue = { kind: 'expression', raw: valueText, parts: [] };
        } else {
          const numVal = parseFloat(valueText);
          if (!isNaN(numVal)) {
            exprValue = { kind: 'literal', value: numVal };
          } else {
            exprValue = { kind: 'unresolvable' };
          }
        }

        block.macroAssignment = {
          variableNum: token.value.variableNum,
          expression: exprValue,
        };
        block.hasMacroExpressions = true;
      }
    }
  }

  // ===========================================================================
  // Utility helpers
  // ===========================================================================

  private extractCommentText(tokens: GCodeToken[]): string {
    return tokens
      .filter(t => t.type === 'comment')
      .map(t => this.extractSingleComment(t))
      .join(' ')
      .trim();
  }

  private extractSingleComment(token: GCodeToken): string {
    let text = token.raw;
    // Remove ( ) delimiters
    if (text.startsWith('(') && text.endsWith(')')) {
      text = text.substring(1, text.length - 1);
    }
    // Remove ; prefix
    if (text.startsWith(';')) {
      text = text.substring(1);
    }
    return text.trim();
  }

  private findNumberAfterToken(
    token: GCodeToken,
    allTokens: GCodeToken[]
  ): number | null {
    // Find the first numeric token after this token's position
    for (const t of allTokens) {
      if (t.startCol > token.endCol) {
        if (t.value.kind === 'literal' && typeof t.value.value === 'number') {
          return t.value.value;
        }
      }
    }
    return null;
  }

  private extractConditionText(
    token: GCodeToken,
    allTokens: GCodeToken[]
  ): string {
    // Find bracket expression after IF/WHILE
    for (const t of allTokens) {
      if (t.startCol > token.endCol && t.value.kind === 'expression') {
        return (t.value as { kind: 'expression'; raw: string }).raw;
      }
    }
    return '';
  }
}
