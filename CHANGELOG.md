# Changelog

All notable changes to **JobLine G-Code Intelligence** are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.1.0] — 2026-03-27

### Added

- **Syntax highlighting** — TextMate grammar covering G-codes, M-codes, addresses, macro variables, Siemens CYCLE calls, Okuma `$` program numbers, comments (parenthesized and semicolon), block skip, and N-line numbers across all five control dialects (Fanuc, Haas, Siemens, Mazak, Okuma).
- **Hover tooltips** — Rich descriptions for 100+ G-codes, M-codes, address letters, and Siemens CYCLE calls. Includes parameter lists and usage notes.
- **Control type selector** — Status bar indicator (`[Fanuc]`) that opens a quick-pick menu to switch the active CNC control dialect. Setting persists per workspace.
- **Live sidebar panel** — JobLine activity bar entry with five tree views (Operations, Tools, Offsets, Canned Cycles, Alarms & Warnings) that parse the active G-code document in real time.
- **3-stage parser pipeline** — Tokenizer → Block Parser → Program Model, validated against production fixture files for Fanuc, Haas, Siemens, and Okuma dialects.
- **Modal state machine** — Tracks spindle, coolant, feed rate, work offsets, tool compensation, canned cycle state, and absolute/incremental position across an entire program.
- **Macro B evaluator** — Resolves `#variable` references and bracket expressions (`[#1 + 0.5]`, `SIN[30]`, `SQRT[4]`) where possible; marks unresolvable branches without false positives.
- **Canned cycle detection** — Identifies G73–G89 cycles, links repeat-at-position blocks to their parent cycle definition, and counts total execution instances correctly.
- **Language configuration** — Bracket matching, auto-closing pairs, comment toggling, and word pattern for the `gcode` language ID.
- **File type association** — Automatic language detection for `.nc`, `.gcode`, `.ngc`, `.tap`, `.cnc`, `.mpf`, `.spf`, `.prg`, `.min`.
- **56 unit tests** across 15 suites — Tokenizer, Block Parser, Program Model, Modal State, Macro Evaluator, and 5 fixture file pipelines; 100% pass rate.

### Commands (placeholders — full implementation in upcoming releases)

- `JobLine: Validate Program` — Registered; full diagnostic squiggles ship in v0.2.
- `JobLine: Format G-Code` — Registered; formatter ships in v0.3.

---

## Upcoming

### [0.2.0] — Diagnostics
- Inline squiggles for canned cycle parameter errors (missing Z/R, invalid P/Q)
- Safety rule violations: missing safe-Z before tool change, spindle still running at M30
- Arc geometry validation for G02/G03

### [0.3.0] — Formatter
- Word spacing normalization (`G01X1.5` → `G01 X1.5`)
- Decimal place normalization
- Uppercase G/M code enforcement

### [0.4.0] — Navigation
- Go-to-definition for subprogram calls (M98, CALL OB)
- Cross-file subprogram resolution

### [1.0.0] — DNC Connectivity
- Direct file transfer to and from CNC controls over serial/Ethernet
