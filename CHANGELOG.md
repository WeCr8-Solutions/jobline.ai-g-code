# Changelog

All notable changes to **JobLine G-Code Intelligence** are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.3.4] - 2026-09-09

First published build to carry the 0.3.3 fixes. 0.3.3 was tagged but never
released, so the Marketplace still served 0.3.1 and both open issues stayed live
for every user.

### Fixed

- **Visualizer and Tool Preview failed to open** with "Three.js failed to load"
  and `Uncaught SyntaxError: Unexpected token 'export'`. The shipped 0.3.1 loaded
  an ES module build of Three.js r183 through a classic `<script src>` tag. Both
  panels now load it as a module. (#1)
- **Coordinates written without a leading zero were silently dropped.** The
  visualizer's address regex required a digit before the decimal point, so
  `X.75`, `Z-.25`, `Z-.0625` and `R.5` never matched, the axis was treated as
  unchanged, and the toolpath came out wrong with no warning. This form is
  near-universal in Fanuc and Haas output. (#2)
- **Every tool came out with its diameter equal to its tool number.** The spec
  reader fell back to "first three numbers in the comment", and the tool number
  is itself the first number. `T5 - .201 DIA DRILL - 118 DEG` produced diameter
  5, length-of-cut 201 and stick-out 118 - the last of those being the drill
  point angle. The wrong cutter width was then simulated and the wrong tool
  drawn. Diameters are now read from fractions (`1/2`, `1/4-20`), leading
  decimals (`.201`), and labelled values in either order (`DIA 0.5`, `0.5 DIA`,
  `dia=0.5`), with the tool number and any point angle removed first.
- **Tool spec labels could set NaN.** `/lc|lengthcut\s*=\s*(\d+)/` alternates on
  a bare `lc`, so any comment containing those two letters - CALC, BLOCK -
  matched with no capture group and stored NaN.
- **The formatter corrupted trailing-decimal words.** With
  `jobline.formatter.decimalPlaces` set, `X5.` became `X5.000.` - a word with two
  decimal points, which a control rejects or misreads. `X5.` is ordinary Fanuc
  output. Word spacing also failed to split `X5.Y2.`, because the character
  before `Y` is a decimal point rather than a digit.

### Added

- `.cmx` recognised as G-code, and every registered extension now also matches
  its uppercase form (`PROGRAM.MIN`, `PART.CMX`) - CNC controls routinely write
  uppercase filenames.
- Content-based detection for unregistered extensions: a file opening with `%`,
  an O-number or colon program header, or a numbered G/M/T block is treated as
  G-code whatever it is called.
- Formatter unit tests. The formatter previously had none, which is how the
  trailing-decimal bug shipped.

### Security

- `.claude/settings.local.json` is no longer published in the extension package
  or tracked in git. It carried developer usernames, absolute `D:\MajorProjects`
  paths and local tooling details, and this is a public repository. It contained
  no credentials. Note that it remains in git history; rewriting that is a
  separate decision.

### Changed

- Formatter rules moved to `src/formatter/formatterRules.ts`, which imports no
  VS Code API so it can be tested directly.
- Tests that depend on the private `test/fixtures/revpack/` directory now skip
  when it is absent instead of failing. That directory is gitignored, so the
  suite previously passed only on the one machine holding those files and failed
  on every clean clone.

---

## [0.3.3] — 2026-04-26

### Added

- **Commands sidebar panel** — clickable tree with every JobLine action (validate, format, toolbox transforms, navigate) accessible from the activity bar without remembering command names
- **ISO 13399 Tool Preview Panel** — 3D tool geometry viewer and editor; renders End Mill, Drill, Tap, Face Mill, Boring Bar, and Lathe Insert with CAT/BT/HSK holder geometry
- **Auto-extract tool specs from comments** — diameter, length of cut, stick-out, and holder type parsed directly from NC file comment blocks and pre-populated in the Tool Preview form
- **Stock origin control** in Visualizer Settings sidebar — set X/Y/Z stock origin without editing the NC file
- **Layer filters** in Visualizer Settings sidebar — toggle rapids, cuts, arcs, and canned cycles independently
- **`VisualizerSettings` sidebar panel** — stock dimensions, machine type, layer toggles, and unit selection consolidated in one always-visible panel
- **Operator-friendly error banner** in the 3D visualizer — if Three.js fails to load, a visible banner gives actionable instructions ("Reload VS Code", "Reinstall JobLine", "Check antivirus/group policy") instead of a blank canvas
- **JS error + unhandledrejection listeners** in visualizer webview — any runtime JS fault surfaces in the operator banner with the exact error message
- **Shared `fileTypes.ts`** — single source of truth for all G-code extension matching; eliminates duplicated regex across 5 files

### Fixed

- **Tool Preview 3D rendering** — proper lights, animation loop, and visible holder geometry on first open
- **Tool Preview Three.js loading** — loads from bundled `media/three.min.js`; added error handling and debug logging to diagnose future load failures
- **Unit conversion in Tool Preview** — inch and metric dimensions now convert correctly when switching units
- **Webview focus** — opening the Visualizer or Tool Preview no longer steals keyboard focus from the active editor

### Technical

- `vitest.config.ts` added — restricts `npx vitest run` to the 3 native vitest test files, eliminating 5 spurious failures from mocha/ts-node suites being accidentally picked up
- 9 Three.js contract tests in `test/visualizer-controls.test.ts` — cover bundle size, module script structure, guard pattern, CSP placeholder count, and runtime placeholder injection
- 4 smoke tests in `test/smoke/smoke.test.js` — verify `three.min.js` is bundled and valid JS, visualizer HTML template integrity, crash-scenario NC handling, and panel reopen state replay
- `src/utils/gcodeDocumentTracker.ts` — tracks last active G-code document across panel focus changes

---

## [0.3.2] — 2026-04-09

### Added

- **3D Toolpath Visualizer** — fully functional Three.js webview (bundled offline, no CDN)
  - Color-coded toolpath: blue = rapid, green = cut, orange = M-stop, yellow = current line
  - Orbit (left drag), pan (right drag), zoom (scroll), fit-view (`F` key)
  - HUD showing point count, current X/Y/Z, units
  - Auto-loads path when visualizer opens; live-reloads on file edit
- **Arc tessellation** — G2/G3 arcs properly rendered as smooth curves (IJK + R format, G17/18/19 plane-aware, helical interpolation)
- **HAAS 5-axis G/M code support** — hover tooltips and parameter hints for:
  - G187 Smoothing / corner accuracy (P mode, E tolerance)
  - G234 TCPC — Tool Center Point Control
  - G254 / G255 Dynamic Work Offset (DWO) activate / cancel
  - G98 / G99 canned cycle return plane modes
  - M10 / M11 4th axis clamp / unclamp
  - M12 / M13 5th axis clamp / unclamp
- **G254 tracked as work offset** in sidebar (previously showed empty)
- **Expanded file extension support** — syntax highlighting, diagnostics, hover, and sidebar now activate on: `.5ax` `.ncc` `.ncp` `.ncf` `.nc1` `.eia` `.iso` `.fgc` `.dnc` `.apt` `.cls` `.cyc` `.sub` `.lib` `.src` `.ptp` and more
- **`jobline.additionalExtensions` setting** — add any shop-specific extensions (e.g. `[".001", ".cpp"]`) without waiting for an update
- **Sidebar stays active** while visualizer is open — toolbox edits, navigation, and diagnostics work with any panel focused

### Fixed

- **Toolbox buttons** fail when 3D visualizer has focus — all transforms and navigation now fall back to last known G-code document
- **Tool Preview Panel** loaded Three.js from CDN — now uses bundled `media/three.min.js` (works offline / behind shop firewalls)
- **Stock header insert** command failed when visualizer had focus

### Technical

- `src/utils/fileTypes.ts` — single source of truth for all G-code extension matching; eliminates duplicated regex across 5 files
- Arc tessellation: 360 segments/circle resolution, correct sweep direction for CW/CCW, full-circle detection

---

## [0.3.1] — 2026-03-27

### Added

#### Multi-Language Support

- **Internationalization (i18n)** infrastructure using VS Code's native `vscode.l10n` API
  - Language files in `l10n/` directory for English, Spanish, German, French, Chinese, and Japanese
  - Multi-language G-code reference data in `data/gcode-reference-i18n.json` covering common G/M codes in all supported languages
  - Community contribution guide for adding new languages (see GitHub issues)
- **G-code reference translations** — hover tooltips and sidebar descriptions now available in 6 languages
- Full internationalization scaffolding ready for extension UI strings

### Fixed

- **Multi-O-program spindle/coolant false negatives** — spindle-running and coolant-on checks now fire and reset at each M30/M02, correctly flagging missing M05/M09 in earlier sub-programs
- **G76 threading false positive** — removed G76 from the canned-cycle code set. Fanuc G76 uses a 2-line format where the first line carries no Z, preventing incorrect "Canned cycle requires Z" flags
- **5-axis sample unsafe tool-change warning** — added `G91 G28 Z0.` / `G90` safe-Z retract to `samples/mill-5axis.nc` before the first T01 M06

### Technical

- Updated `package.json` to include `@vscode/l10n` dependency for localization support

---

## [0.3.0] — 2026-03-27

First full-featured release. Consolidates all development from the initial parser
foundation through diagnostics, formatting, and subprogram navigation into a single
production-ready package.

### Added

#### Parser & Intelligence Core

- **3-stage parser pipeline** — Tokenizer → Block Parser → Program Model validated
  against production fixture files for Fanuc, Haas, Siemens, and Okuma dialects.
- **Modal state machine** — Tracks spindle, coolant, feed rate, work offsets, tool
  compensation, canned cycle state, and absolute/incremental position across an entire
  program.
- **Macro B evaluator** — Resolves `#variable` references and bracket expressions
  (`[#1 + 0.5]`, `SIN[30]`, `SQRT[4]`) where possible; marks unresolvable branches
  without false positives.
- **Canned cycle detection** — Identifies G73–G89 cycles, links repeat-at-position
  blocks to their parent cycle, and counts total execution instances correctly.

#### Live Sidebar

- **JobLine activity bar panel** with eight tree views:
  - **Operations** — operation summaries with tool, work offset, feed range, spindle speed.
  - **Tools** — per-tool usage with Add / Go-To / Remove inline actions.
  - **Offsets** — active work coordinate offsets (G54–G59, G54.1 Pn).
  - **Canned Cycles** — cycle list tailored to the active machine type profile.
  - **Probing** — G31 and G38.x probe instances with target position and feed rate.
  - **Toolbox** — webview sidebar for one-click editing tools (see below).
  - **Alarms & Warnings** — mirrors diagnostics with severity badges.
  - **Commands** — one-click access to all major commands without the command palette.
- Sidebar trees refresh live on document change and on configuration change.
- **Machine type setting** (`jobline.machineType`) — selects cycle catalog (mill,
  lathe, mill-turn, grinder).

#### Diagnostic Squiggles

- Inline diagnostics via `vscode.languages.createDiagnosticCollection`, debounced 500 ms.
- **Canned cycle errors** (red): missing `Z` depth, missing `R` R-plane, missing `Q`
  peck depth (G83/G73), missing `F` feed rate for G84/G74 tapping cycles.
- **Safety warnings** (yellow): M06 without a G28/G53 Z retract in the preceding 15
  lines; spindle still running at M30; coolant still on at M30.
- **Arc geometry errors** (red): G02/G03 where I,J,K center offset produces a start
  radius that doesn't match the endpoint radius within `jobline.validation.arcTolerance`
  (default 0.001).

#### G-Code Formatter

- `jobline.formatDocument` command — also registered as `DocumentFormattingEditProvider`
  so **Shift+Alt+F** works.
- **Word spacing**: `G01X1.5Y2.0` → `G01 X1.5 Y2.0`.
- **Uppercase G/M codes**: `g01` → `G01`, `m06` → `M06`.
- **Decimal normalization**: rounds coordinates to `jobline.formatter.decimalPlaces`
  (null = off). Coordinate-like addresses only; O, N, G, M, T, H, D, F, S are excluded.
- Comment lines and macro assignment lines are left untouched.

#### Subprogram Navigation

- **Go to Definition** for M98 Pxxx — Ctrl+click on a `P` word in an M98 call jumps
  to the `Oxxx` definition in the same file first, then workspace search.
- **Document Links** — M98 P-words are underlined; clicking opens the subprogram file.
- **Workspace Symbol Provider** — all `Oxxx` program numbers in G-code files appear
  in workspace symbol search (Ctrl+T).

#### Machinist Toolbox

- Insert / remove / renumber N-words (line numbers).
- Strip comments; uppercase G/M codes.
- Add / remove block skip (`/`).
- Add safety header (`G17 G40 G49 G80`); append program end (`M30 + %`).
- Remove extra blank lines; add blank separators between operations.
- **Feed rate scaling** — scale all F-words by percentage or clamp to a maximum.
- **Spindle speed scaling** — scale all S-words by percentage.
- **Coordinate shift X / Y / Z** — add a signed offset to every coordinate of a chosen
  axis. Macro-assignment lines and bracket expressions are untouched.
- **Insert Safe-Z before tool changes** — inserts `G91 G28 Z0.` / `G90` before every
  M06; skips lines that already have it.
- **Add Coolant On/Off** — inserts M08 after each tool change, M09 before M30/M02.
- **Remove All Dwells** — removes every G04/G4 dwell line in one click.
- **Navigate: Next Tool Change / Next Canned Cycle** — jump to next M06 or G7x/G8x
  line with wrap-around.
- **Plain-Language Explainer** button directly in the Toolbox panel.

#### Plain-Language Explainer

- Webview panel with a human-readable summary: operations, tools, cycle types, work
  offsets, probing usage.
- Independent scrolling; sticky header (program number, file name, line count).
- Click any row to move the editor cursor to that line.

#### Hover Tooltips

- Rich descriptions for 100+ G-codes, M-codes, address letters, and Siemens CYCLE calls,
  including parameter lists and usage notes.

#### Robot Control Support

- **Fanuc Robot (TP / LS)** — `.ls` / `.tp` files open with G-code syntax highlighting
  and the full JobLine sidebar. Hover tooltips cover Fanuc TP motion codes (J, L, C).
- **ABB RAPID** — `.mod` / `.pgf` files registered as `abb-rapid`. Select "ABB RAPID"
  in the control picker to activate.
- **Robot icon in status bar** — `$(robot)` icon when a robot dialect is active.

#### Language Support

- **Syntax highlighting** — TextMate grammar covering G/M-codes, addresses, macro
  variables, Siemens CYCLE calls, Okuma `$` program numbers, comments, block skip, and
  N-line numbers across all five CNC dialects plus Fanuc Robot TP and ABB RAPID.
- **File associations** — `.nc`, `.gcode`, `.ngc`, `.tap`, `.cnc`, `.mpf`, `.spf`,
  `.prg`, `.min`, `.ls`, `.tp`, `.mod`, `.pgf`.
- **Language configuration** — bracket matching, auto-closing pairs, comment toggling,
  and word pattern for the `gcode` language ID.
- **Control type selector** — status bar indicator that opens a quick-pick to switch
  CNC dialect; persists per workspace.

#### UX

- **"JL" monogram** activity-bar icon — bold L + J with quarter-circle hook, readable
  at all VS Code zoom levels.
- `$(circuit-board)` icons for CNC dialects, `$(robot)` icons for robot dialects in
  the control picker.

### Fixed

- **Multi-O-program spindle/coolant false negatives** — spindle-running and coolant-on
  checks now fire and reset at each M30/M02, so missing M05/M09 in earlier sub-programs
  are no longer masked by a later sub-program that shuts down correctly.
- **G76 threading false positive** — removed G76 from the canned-cycle code set. Fanuc
  G76 uses a 2-line format where the first line carries no Z, so it was incorrectly
  flagged as "Canned cycle requires Z (depth)".
- **5-axis sample unsafe tool-change warning** — added `G91 G28 Z0.` / `G90` safe-Z
  retract to `samples/mill-5axis.nc` before the first T01 M06.

---

## Upcoming

### [1.0.0] — DNC Connectivity

- Direct file transfer to and from CNC controls over RS-232 / Ethernet via the
  JobLine MachineConnect service.
- Transfer status and machine health visible inside VS Code.
