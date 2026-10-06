# User-feedback regression matrix

Run: npm run test:feedback-matrix

Current result for 0.3.12 (2026-10-06): **75/75 motion cases pass**, `npm run test:all` exits zero, and **15/15 rendered smoke tests pass**. The extracted VSIX also passes STEP tessellation and visualizer rendering checks at widths 1440 and 390. These checks do not resolve every reported visual behavior; see the additional coverage below.

## Historical baseline before the fixes

The initial parser run had 72 cases: 23 passed and 49 failed. The table below records that pre-fix result, not the current release status.

| Coverage | Cases | Result |
| --- | ---: | --- |
| G00/G01 × G90/G91 × G20/G21 × decimal spellings | 16 | pass (endpoints/flags only) |
| G02/G03 full circles × G17/G18/G19 × G90/G91 × G20/G21 × diameters 2/1.25 | 48 | fail: omitted motion |
| Explicit endpoint arcs × planes × directions | 6 | pass (radius/geometry; direction still needs assertion) |
| Feed then rapid retract/traverse | 1 | pass (parser flags; color not certified) |
| Milling G73 X-coordinate | 1 | fail: interpreted as lathe diameter |

Primary semantic references: [Haas mill circular interpolation](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dmill.value%3DG03.html), [Haas mill G73](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dmill.value%3DG73.html). These do not establish universal controller compatibility.

## Required additional coverage
- Controller-specific fixtures: Fanuc, Haas, Siemens, Mazak, Okuma; do not duplicate ISO text under different labels and call dialects validated.
- Radius arcs (short/long), direction, helices, offsets, rotary kinematics, malformed/unsupported instructions.
- Controller-specific drilling, peck, tapping and pocket cycles; macro/subprogram expansion.
- Rendered time-based linear movement, air rapid/cut color changes, pause/resume, seek, speed settings.
- Small→large→small program/tool switches in both units, explicit and missing metadata.
- N-number maintenance: structural edits, comments, block skip, leading zeros, references, undo/redo. Submitted code is issue #4; no integration claimed.

Existing test:smoke exercises rendered extension controls and is tracked separately. Passing source-text UI tests does not prove rendered behavior. No hardware execution is part of this matrix.

## Historical rendered smoke baseline
Fresh compile passed. Existing VS Code smoke suite: 13 passed, 2 failed. Failures: diagnostics population timed out; gnomon off/on rendering assertion failed. These are additional triage items, not evidence that the reported color/interpolation/tool-switch bugs are fixed. Logs: C:/Users/zach/.openclaw/workspace/reports/jobline-feedback-smoke.log.


## Verified fixes — 2026-10-06
- Full circles now count nonzero center offsets in the active plane as motion even without XYZ words.
- G73 alone no longer selects lathe diameter coordinates; its P/Q contour form remains turning evidence.
- Three additional negative/turning cases added: feedback matrix is now 75/75 passing; existing core suite 117/117 and representative simulation suite 3/3 pass.
- Rendered smoke suite now passes 15/15. Gnomon probe measures the overlay's pixel contribution rather than underlying scene geometry. Diagnostic test uses the dedicated invalid public peck fixture, retaining its specific G83 assertion.
- Restored missing STEP box fixture with upstream provenance and license; npm run test:all now exits zero. TypeScript/compile pass.
- Feedback matrix is included in test:all. No publication performed. Smooth linear playback, color contact semantics, automatic numbering and cross-program tool resizing are still separate work.
