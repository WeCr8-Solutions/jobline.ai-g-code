# JobLine Extension — Setup & Testing Guide

## Prerequisites

- **VS Code** 1.85 or newer
- **Node.js** 18+ (check: `node --version`)
- **npm** (comes with Node)

---

## Step 1: Install Dependencies

Open a terminal in the `jobline-gcode/` folder and run:

```bash
npm install
```

This installs TypeScript, `@types/vscode`, `@types/node`, and the test tools. You should see a `node_modules/` folder appear.

**If `npm install` shows errors**, make sure you're in the `jobline-gcode/` directory (the one containing `package.json`).

---

## Step 2: Compile the Extension

```bash
npm run compile
```

This runs `tsc` and creates JavaScript output in the `out/` folder. You should see:

```
out/
├── src/
│   ├── extension.js
│   ├── config.js
│   ├── parser/
│   │   ├── tokenizer.js
│   │   ├── blockParser.js
│   │   ├── programModel.js
│   │   ├── macroEvaluator.js
│   │   └── types.js
│   ├── providers/
│   │   └── hoverProvider.js
│   └── utils/
│       └── modalState.js
└── data/
    └── gcode-reference.json
```

**If you get compile errors**, check that `npm install` completed successfully. The most common issue is a missing `node_modules/` folder.

---

## Step 3: Run Tests

```bash
npm test
```

You should see output ending with:

```
# tests 56
# suites 15
# pass 56
# fail 0
```

All 56 tests should pass. If any fail, something went wrong with the build.

---

## Step 4: Launch the Extension (F5)

This is the key step — it opens a **second VS Code window** where the extension is loaded.

1. **Open the `jobline-gcode/` folder in VS Code** (File → Open Folder)
2. Go to the **Run and Debug** panel (click the play-with-bug icon in the sidebar, or press `Ctrl+Shift+D`)
3. In the dropdown at the top, select **"Run Extension"**
4. Press **F5** (or click the green play button)

**What happens:**
- VS Code compiles the TypeScript (you may see a brief terminal flash)
- A **new VS Code window** opens with an orange/yellow title bar — this is the "Extension Development Host"
- The extension is loaded in this second window

**If F5 does nothing or shows an error:**
- Make sure the dropdown says "Run Extension" (not "Run Tests")
- Make sure `npm run compile` succeeds first
- Check the Debug Console (bottom panel) for errors

---

## Step 5: Test the Extension

In the **Extension Development Host window** (the second window that opened):

### Open a G-code file
- Open the included `sample.nc` file (File → Open File, navigate to the `jobline-gcode/` folder, open `sample.nc`)
- You can also open any `.nc`, `.gcode`, `.tap`, or `.cnc` file from your shop

### What you should see immediately
- **Syntax highlighting**: G-codes in one color, M-codes in another, comments dimmed, addresses colored, macro variables highlighted
- **Status bar**: Bottom-left shows `[Fanuc]` — click it to switch control types

### Test hover tooltips
Move your mouse cursor over these items and wait for the tooltip popup:

| Hover over | You should see |
|---|---|
| `G83` | **G83** — Peck Drilling + description + parameter list |
| `G01` | **G01** — Linear Interpolation |
| `M06` | **M6** — Tool Change |
| `M03` | **M3** — Spindle On CW |
| `G54` | **G54** — Work Coordinate System 1 |
| `G28` | **G28** — Return to Machine Home |
| `X1.0` | **X** — X-axis position |
| `Z-0.85` | **Z** — Z-axis position |
| `F12.0` | **F** — Feed rate description |
| `H01` | **H** — Tool length offset number |

### Test the control selector
- Click the `[Fanuc]` indicator in the bottom-left status bar
- A dropdown appears with all 5 control types
- Select "Siemens" — the status bar updates to `[Siemens]`
- Select "Okuma" — status bar shows `[Okuma]`

### Test with different file types
Open files from `test/fixtures/` to see highlighting across dialects:
- `test/fixtures/fanuc/drill-pattern.nc` — standard Fanuc production program
- `test/fixtures/fanuc/macro-bolt-circle.nc` — Macro B parametric code (variables, loops)
- `test/fixtures/siemens/cycle83-drill.nc` — Siemens CYCLE83 with semicolon comments
- `test/fixtures/okuma/facing-od-rough.nc` — Okuma $ program number and CALL OB

---

## Step 6: Watch Mode (Optional)

If you want to make code changes and see them live without restarting:

```bash
npm run watch
```

This keeps the TypeScript compiler running. After making a change to any `.ts` file, press `Ctrl+Shift+F5` in the Extension Development Host window to reload the extension.

---

## Troubleshooting

**"Cannot find module 'vscode'"** when compiling
→ Run `npm install` first. The `@types/vscode` package provides the types.

**F5 opens a window but extension doesn't activate**
→ Open a `.nc` file. The extension only activates when a G-code file is opened (`onLanguage:gcode`).

**No syntax highlighting**
→ Check bottom-right of VS Code — it should say "G-Code" as the language. If it says "Plain Text", click it and select "G-Code" from the list.

**Hover tooltips don't appear**
→ Make sure the file is recognized as G-Code (bottom-right language indicator). Hover directly over a G or M code character and wait 1-2 seconds.

**Tests fail with "Cannot find module 'ts-node'"**
→ Make sure you ran `npm install` in the `jobline-gcode/` directory, not a parent folder.

---

## What's Working Now

| Feature | Status |
|---|---|
| Syntax highlighting (5 dialects) | Working |
| Hover tooltips (G/M codes + addresses) | Working |
| Control type selector | Working |
| Tokenizer (all token types) | Working (28 tests) |
| Block parser | Working (3 tests) |
| Program model (ops, tools, cycles) | Working (6 tests) |
| Modal state machine | Working (11 tests) |
| Macro B evaluator (expressions, trig) | Working (7 tests) |
| Fixture file pipeline (5 files) | Working |

## What's Not Built Yet (Phase 2+)

- Tree views (Operations, Tools, Offsets, Canned Cycles, Alarms)
- Diagnostic squiggles (canned cycle validation, safety checks, arc validation)
- Code formatting
- DNC / machine connectivity
- Subprogram resolution
