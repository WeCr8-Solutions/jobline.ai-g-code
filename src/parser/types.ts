/**
 * JobLine G-Code Parser — Core Types
 * Architecture v0.4.0 Section 3
 *
 * These types define the contract between the tokenizer, block parser,
 * program model, conditions engine, and all providers/views.
 */

// =============================================================================
// Token Types (Stage 1 output)
// =============================================================================

/** How a value was specified in the source */
export type TokenValue =
  | { kind: 'literal'; value: number }
  | { kind: 'variable'; variableNum: number }
  | { kind: 'expression'; raw: string; parts: MacroExpressionToken[] }
  | { kind: 'indirectG'; variableNum: number }
  | { kind: 'unresolvable' };

/** Subset of macro tokens within an expression */
export interface MacroExpressionToken {
  type: 'number' | 'variable' | 'operator' | 'function' | 'comparison' | 'open' | 'close';
  raw: string;
  value?: number;
}

export type GCodeTokenType =
  | 'G'
  | 'M'
  | 'address'
  | 'lineNumber'
  | 'programNumber'
  | 'comment'
  | 'blockSkip'
  | 'percentDelimiter'
  | 'macroAssignment'
  | 'controlFlow'
  | 'siemensCycle'
  | 'okumaCall'
  | 'unknown';

export interface GCodeToken {
  type: GCodeTokenType;
  letter?: string;
  code?: number;
  value: TokenValue;
  raw: string;
  startCol: number;
  endCol: number;
}

export interface TokenizedLine {
  lineNumber: number;
  tokens: GCodeToken[];
  raw: string;
  isEmpty: boolean;
  isComment: boolean;
}

// =============================================================================
// Block Types (Stage 2 output)
// =============================================================================

export interface ResolvedAddress {
  letter: string;
  rawValue: TokenValue;
  resolvedValue: number | null;
  isFullyResolved: boolean;
  startCol: number;
  endCol: number;
}

export interface GCode {
  code: number;
  subCode?: number;       // For G54.1, G90.1 etc.
  raw: string;
  startCol: number;
  endCol: number;
}

export interface MCode {
  code: number;
  raw: string;
  startCol: number;
  endCol: number;
}

export interface GCodeBlock {
  /** 0-based line number in the document */
  line: number;

  /** N-word if present */
  blockNumber?: number;

  /** All G-codes on this line */
  gCodes: GCode[];

  /** All M-codes on this line */
  mCodes: MCode[];

  /** Resolved addresses (X, Y, Z, F, S, etc.) */
  addresses: Map<string, ResolvedAddress>;

  /** Comment text (without delimiters) */
  comment?: string;

  /** Tool number if T-word present */
  toolNumber?: number;

  /** Raw source text */
  raw: string;

  /** Line starts with / */
  blockSkip: boolean;

  /** Program number (O or $) if this is a program header line */
  programNumber?: string;

  /** This is a position-only line under an active canned cycle */
  isCycleRepeat: boolean;

  /** Line number of the parent cycle definition (if isCycleRepeat) */
  parentCycleLineRef?: number;

  /** At least one address uses a macro expression */
  hasMacroExpressions: boolean;

  /** Macro variable assignment on this line (#n = expr) */
  macroAssignment?: {
    variableNum: number;
    expression: TokenValue;
  };

  /** Control flow statement (IF/GOTO/WHILE/DO/END) */
  controlFlow?: {
    type: 'IF' | 'GOTO' | 'WHILE' | 'DO' | 'END';
    target?: number;        // N-number for GOTO
    condition?: string;     // Raw condition text
  };
}

// =============================================================================
// Modal State (Stage 3 — maintained during program walk)
// =============================================================================

export interface ModalState {
  // Group 1: Motion
  activeMotion: number | null;

  // Group 2: Plane
  activePlane: 17 | 18 | 19;

  // Group 3: Positioning
  activePositioning: 90 | 91;

  // Group 4: Arc center mode
  arcCenterMode: 90.1 | 91.1;

  // Group 5: Feed mode
  activeFeedMode: 94 | 95;

  // Group 6: Units
  activeUnits: 20 | 21;

  // Group 13: Spindle speed mode
  spindleMode: 96 | 97;

  // Active values
  activeF: number | null;
  activeS: number | null;
  activeTool: number | null;
  activeToolDiameter: number | null;
  activeWorkOffset: string | null;
  activeToolOffset: { H: number | null; D: number | null };

  // Canned cycle state
  activeCannedCycle: number | null;
  cannedCycleParams: Map<string, number>;
  cycleWillBeCancelled: boolean;

  // Spindle
  spindleDirection: 'CW' | 'CCW' | 'OFF';
  maxSpindleClamp: number | null;

  // Coolant
  coolantState: 'flood' | 'mist' | 'off';

  // Position tracking (multi-axis)
  currentPosition: Position;

  // Safety tracking
  isAtSafeZ: boolean;
  lastRPlane: number | null;

  // Subprogram stack
  callStack: SubprogramFrame[];
}

export interface Position {
  X: number;
  Y: number;
  Z: number;
  A?: number;
  B?: number;
  C?: number;
}

export interface SubprogramFrame {
  calledFrom: number;      // Line number of M98/CALL
  programId: string;       // O-number or subprogram name
  returnLine: number;      // Line to return to on M99
}

// =============================================================================
// Program Model (full document representation)
// =============================================================================

export interface ProgramModel {
  /** All parsed blocks */
  blocks: GCodeBlock[];

  /** Modal state at end of each block (index = block index) */
  stateAtBlock: ModalState[];

  /** Detected operations (tool change boundaries) */
  operations: Operation[];

  /** All unique tools used */
  tools: ToolUsage[];

  /** All canned cycle instances (including repeats) */
  cannedCycles: CannedCycleInstance[];

  /** All diagnostics from conditions + safety + arc validators */
  diagnostics: GCodeDiagnostic[];

  /** Program metadata */
  programNumber?: string;
  totalLines: number;
  dialect: string;
}

export interface Operation {
  name: string;             // From comment or "Op N"
  toolNumber: number;
  startLine: number;
  endLine: number;
  workOffset?: string;
  spindleSpeed?: number;
  feedRange?: { min: number; max: number };
  cycleTypes: string[];     // G-codes used in this operation
  estimatedSeconds?: number;
}

export interface ToolUsage {
  toolNumber: number;
  description?: string;     // From comment near T-call
  offsetH?: number;
  offsetD?: number;
  maxSpindleSpeed?: number;
  feedRange?: { min: number; max: number };
  lineNumbers: number[];    // All lines where this tool is referenced
}

export interface CannedCycleInstance {
  code: number;             // G73, G83, G84, etc.
  line: number;
  parameters: Map<string, ResolvedAddress>;
  repeatCount: number;      // Including repeat-at-position lines
  repeatLines: number[];
  conditionResults: ConditionResult[];
}

export interface ConditionResult {
  conditionId: string;
  passed: boolean;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

// =============================================================================
// Diagnostics
// =============================================================================

export interface GCodeDiagnostic {
  line: number;
  startCol: number;
  endCol: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  source: 'conditions' | 'safety' | 'arc' | 'encoding' | 'parser';
  ruleId: string;
  quickFix?: QuickFix;
}

export interface QuickFix {
  title: string;
  insertText?: string;
  insertLine?: number;       // Line to insert before
  replaceRange?: { startLine: number; startCol: number; endLine: number; endCol: number };
  replaceText?: string;
}

// =============================================================================
// Dialect Types
// =============================================================================

export type ControlType = 'fanuc' | 'haas' | 'siemens' | 'mazak' | 'okuma';
export type MachineType = 'mill' | 'lathe' | 'mill-turn' | 'grinder';

// =============================================================================
// Configuration
// =============================================================================

export interface JobLineConfig {
  controlType: ControlType;
  machineType: MachineType;
  units: 'inch' | 'metric';
  validation: {
    enableSafetyChecks: boolean;
    enableArcValidation: boolean;
    arcTolerance: number;
  };
  formatter: {
    wordSpacing: boolean;
    decimalPlaces: number | null;
    uppercaseGM: boolean;
  };
}

// =============================================================================
// Helpers
// =============================================================================

/** Create default modal state (power-on defaults for most controls) */
export function createDefaultModalState(): ModalState {
  return {
    activeMotion: null,
    activePlane: 17,
    activePositioning: 90,
    arcCenterMode: 91.1,
    activeFeedMode: 94,
    activeUnits: 20,
    spindleMode: 97,
    activeF: null,
    activeS: null,
    activeTool: null,
    activeToolDiameter: null,
    activeWorkOffset: null,
    activeToolOffset: { H: null, D: null },
    activeCannedCycle: null,
    cannedCycleParams: new Map(),
    cycleWillBeCancelled: false,
    spindleDirection: 'OFF',
    maxSpindleClamp: null,
    coolantState: 'off',
    currentPosition: { X: 0, Y: 0, Z: 0 },
    isAtSafeZ: true,         // Assume safe at program start
    lastRPlane: null,
    callStack: [],
  };
}

/** Clone modal state (deep copy maps) */
export function cloneModalState(state: ModalState): ModalState {
  return {
    ...state,
    activeToolOffset: { ...state.activeToolOffset },
    cannedCycleParams: new Map(state.cannedCycleParams),
    currentPosition: { ...state.currentPosition },
    callStack: state.callStack.map(f => ({ ...f })),
  };
}
