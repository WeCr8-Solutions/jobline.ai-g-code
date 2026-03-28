# JobLine G-Code Intelligence

**Deep G-code intelligence for VS Code** — syntax highlighting, rich hover tooltips, live canned cycle detection, Macro B support, a real-time sidebar, and 3D toolpath visualization for Fanuc, Haas, Siemens, Mazak, and Okuma CNC controls.

---

## Features

### Syntax Highlighting
Full dialect-aware highlighting for all five major CNC control families. G-codes, M-codes, addresses, macro variables, comments, and program structure are all individually colored so code is readable at a glance.

Supported file extensions: `.nc` `.gcode` `.ngc` `.tap` `.cnc` `.mpf` `.spf` `.prg` `.min`

---

### Rich Hover Tooltips
Hover over any G-code, M-code, or address word to see a full description, parameter list, and usage notes — without leaving your editor.

| Hover over | You see |
|---|---|
| `G83` | Peck Drilling Cycle — Z, R, Q, P, F parameters |
| `G02` | Circular Interpolation CW — I, J, K, R |
| `M06` | Tool Change |
| `G54` | Work Coordinate System 1 |
| `X`, `Y`, `Z` | Axis description |
| `F`, `S`, `T`, `H`, `D` | Feed / spindle / tool / offset descriptions |

Siemens CYCLE calls (e.g. `CYCLE83`, `CYCLE840`) are also recognized with positional parameter descriptions.

---

### Live Sidebar — JobLine Panel
Open the **JobLine** icon in the Activity Bar to see five live views that update as you type:

| View | Shows |
|---|---|
| **Operations** | Each tool change as a named operation with line range |
| **Tools** | All tools called in the program (T-number + description) |
| **Offsets** | Work coordinate offsets in use (G54–G59) |
| **Canned Cycles** | Every G81/G82/G83/etc. with its parameters |
| **Alarms & Warnings** | Diagnostic results (expands in future releases) |

---

### Control Type Selector
Click the `[Fanuc]` indicator in the VS Code status bar (bottom-left) to instantly switch the active control dialect. The sidebar and hover system adapt accordingly.

Supported controls:
- **Fanuc** — 0i / 30i / 31i series
- **Haas** — NGC controls
- **Siemens** — Sinumerik 840D / 828D
- **Mazak** — Smooth / Matrix controls
- **Okuma** — OSP-P controls

---

### Macro B Parser
Variables (`#1`, `#100`, `#5041`), expressions (`Z[#1 + 0.5]`), and control flow (`IF`, `WHILE`, `GOTO`) are tokenized and evaluated where possible. Unresolvable macro expressions are tracked but never cause false positives.

---

### G-Code Toolpath Visualizer
Open a live 3D preview of your G-code path with full setup geometry support:

**Visualize:**
- Toolpath (XYZ linear moves as a 3D line)
- Cutting tool and holder
- Stock material (imported STL or manual box/cylinder)
- Fixture and jaws (imported STL or manual geometry)

**Interactive controls:**
- 7 camera view presets: Top, Bottom, Front, Back, Left, Right, Isometric
- Drag to orbit the scene; scroll to zoom
- Per-layer visibility toggles and live color pickers
- Import STL files or enter custom dimensions for any geometry

Access via the **G-Code: Show Toolpath Visualizer** command.

---

## Requirements

- VS Code **1.85** or newer
- No other extensions required

---

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `jobline.controlType` | `fanuc` | Active CNC control dialect |
| `jobline.machineType` | `mill` | Machine profile (mill / lathe / mill-turn / grinder) |
| `jobline.units` | `inch` | Default unit system (overridden by G20/G21 in file) |
| `jobline.validation.enableSafetyChecks` | `true` | Crash-prevention safety rules |
| `jobline.validation.enableArcValidation` | `true` | G02/G03 arc geometry validation |
| `jobline.validation.arcTolerance` | `0.001` | Arc endpoint tolerance (current units) |
| `jobline.formatter.wordSpacing` | `true` | Add spaces between G-code words |
| `jobline.formatter.decimalPlaces` | `null` | Normalize coordinate decimal places |
| `jobline.formatter.uppercaseGM` | `true` | Uppercase G and M codes |

---

## Commands

Open the Command Palette (`Ctrl+Shift+P`) and type **JobLine** or **G-Code**:

| Command | Description |
|---|---|
| `JobLine: Select CNC Control Type` | Switch the active control dialect |
| `JobLine: Validate Program` | Run safety and arc validation |
| `JobLine: Format G-Code` | Apply formatter rules to the active file |
| `G-Code: Show Toolpath Visualizer` | Open the 3D toolpath visualization panel |
| `G-Code: Update Toolpath Visualizer` | Refresh the visualizer with the current file's path |
| `G-Code: Play` | Animate the toolpath playback (350ms per step) |
| `G-Code: Pause` | Pause toolpath playback |
| `G-Code: Step Forward` | Advance one step in the toolpath |
| `G-Code: Step Back` | Go back one step in the toolpath |
| `G-Code: Jump to Line` | Jump to a specific step in the toolpath |

---

## Roadmap

The current release (v0.1) establishes the full parsing foundation. Upcoming releases add:

- **v0.2** — Diagnostic squiggles: canned cycle parameter errors, arc geometry violations, and safety rule violations highlighted inline
- **v0.3** — G-code formatter (word spacing, decimal normalization, uppercase)
- **v0.4** — Subprogram resolution and cross-file navigation
- **v1.0** — DNC machine connectivity for direct CNC file transfer

---

## Known Issues

- `JobLine: Validate Program` and `JobLine: Format G-Code` commands are placeholders in v0.1 — full implementations ship in v0.2 and v0.3 respectively.
- Siemens CYCLE parameter hover descriptions cover the most common cycles; less-common cycles show a generic tooltip.

---

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for the full release history.

---

## About

Built by **WeCr8 Solutions, LLC** — [github.com/WeCr8-Solutions](https://github.com/WeCr8-Solutions)

Issues and feature requests: [github.com/WeCr8-Solutions/jobline.ai-g-code/issues](https://github.com/WeCr8-Solutions/jobline.ai-g-code/issues)
