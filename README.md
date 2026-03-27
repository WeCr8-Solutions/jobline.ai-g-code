# JobLine.ai G-Code Intelligence

VS Code extension for G-code intelligence, safety validation, and machine-ready workflow support across major CNC controls.

## Mission Statement

JobLine exists to help machinists and programmers prevent costly machine errors by turning raw G-code into clear, actionable intelligence: accurate parsing, visible tooling/cycle context, and safety-first validation before code reaches the control.

**Status:** Foundation complete and expanding. Core parser pipeline is production-validated in fixtures, and sidebar views now render live model data from the active G-code file.

## Quick Start

```bash
# Install dependencies (run once)
npm install

# Run tests (56 tests across 15 suites)
npm test

# Build/type-check core source
npx tsc -p ./

# Optional stricter type-check target
npm run test:typecheck

# Launch in VS Code debug mode
# Press F5 in VS Code (uses .vscode/launch.json)
```

Note: `npm run compile` currently runs a lint pre-step (`precompile`) and expects an ESLint config in the workspace.

## What Works Now

All modules have been tested end-to-end against real fixture files.

**Tokenizer** — 3-stage G-code tokenizer handles:

- G/M codes with sub-codes (G54.1), multiple per line (G90 G00 X0 Y0)
- Addresses with positive, negative, trailing decimal, missing leading zero
- Macro B: variable references (#100), expressions (Z[#1 + 0.5]), control flow (IF/GOTO/WHILE)
- Siemens CYCLE calls with positional parameters: CYCLE83(50, 0, 2, -30, , 5)
- Okuma $ program numbers, CALL OB subprogram syntax
- Comments (parenthesized + semicolon), inline comments, block skip, N-numbers

**Block Parser** — Converts tokens to structured GCodeBlock:

- Resolves literal addresses, marks macro expressions as unresolved
- Extracts tool numbers, program numbers, comments
- Detects control flow statements and macro assignments

**Program Model** — Full document semantic analysis:

- Detects operations (tool change boundaries) with descriptions from comments
- Tracks all tools with offsets, speeds, feeds
- Detects canned cycles (G73-G89) including cycle-repeat-at-position lines
- Links every repeat to its parent cycle definition
- Counts execution instances correctly (G83 with 5 position repeats = 6 executions)

**Modal State Machine** — Tracks cumulative machine state:

- Motion mode, plane, positioning (absolute/incremental), units
- Spindle direction/speed, coolant state, feed rate/mode
- Active canned cycle and parameters, R-plane tracking
- Position tracking (X/Y/Z/A/B/C) in absolute and incremental modes
- Safe Z tracking (G28/G30/G53 awareness)
- Work offsets (G54-G59), tool length/diameter compensation

**Macro B Evaluator** — Best-effort constant folding:

- Variable table (locals #1-#33, commons #100-#999, system #1000+)
- Expression evaluation: arithmetic, trig (SIN/COS/TAN/SQRT/ABS/ROUND)
- Unresolvable branches mark variables as uncertain

**Hover Provider** — Rich tooltips for G-codes, M-codes, addresses, Siemens cycles

**Syntax Highlighting** — TextMate grammar covering all 5 dialects

**Sidebar Views (Live Data)** — JobLine activity bar with:

- Operations
- Tools
- Offsets
- Canned Cycles
- Alarms and Warnings

The views parse the active `.nc/.gcode` document and now surface canned cycles such as `G81` with parameter context.

## Test Results

```text
56 tests, 15 suites, 56 pass, 0 fail (100ms)
5/5 fixture files pass full pipeline (tokenize → parse → model)
0 TypeScript type errors on core source
```

## Project Structure

```text
src/
├── extension.ts              # VS Code entry point
├── config.ts                 # Settings manager
├── parser/
│   ├── types.ts              # Core type definitions (375 lines)
│   ├── tokenizer.ts          # Stage 1: line → tokens (610 lines)
│   ├── blockParser.ts        # Stage 2: tokens → GCodeBlock (380 lines)
│   ├── programModel.ts       # Stage 3: blocks → ProgramModel (295 lines)
│   └── macroEvaluator.ts     # Macro B variable/expression resolver (379 lines)
├── utils/
│   └── modalState.ts         # Modal state machine (325 lines)
├── providers/
│   ├── hoverProvider.ts      # Hover tooltips
│   └── sidebarTreeProviders.ts # Sidebar tree providers (operations/tools/offsets/cycles/alarms)
data/
│   └── gcode-reference.json  # G/M code descriptions (100+ codes)
syntaxes/
│   └── gcode.tmLanguage.json # TextMate grammar (27 repo entries)
test/
├── parser.test.ts            # 56 tests across 15 suites
└── fixtures/
    ├── fanuc/drill-pattern.nc      # Production drill, G83/G81 + repeats
    ├── fanuc/macro-bolt-circle.nc  # Parametric Macro B (variables, WHILE, trig)
    ├── siemens/cycle83-drill.nc    # CYCLE83 positional parameter syntax
    ├── okuma/facing-od-rough.nc    # OSP $ prefix, CALL OB, G71/G70 lathe
    └── crash-scenarios/multiple-violations.nc  # Intentionally bad program
```

## Controls Supported

- **Fanuc** 0i / 30i / 31i
- **Haas** NGC
- **Siemens** Sinumerik 840D / 828D
- **Mazak** Smooth / Matrix
- **Okuma** OSP-P

## Improvement Plans

- Small and incremental plan: `docs/Improvement_Plans.md`
- Large strategic plan with JobLine dashboard integration (station/work center monitoring): `docs/Improvement_Plans.md`

## License

Proprietary — WeCr8 Solutions
