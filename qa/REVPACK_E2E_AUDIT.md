# RevPack E2E audit — 2026-10-14

Scope: does the end-to-end G-code harness load a RevPack (target, stock,
workholding, work offsets, tools, machine) and check the posted program's tool
movements against it? Branch `feat/revpack-e2e-correlation-2026-10-14`.

## Before (main @ 255cd67)

| Area | Finding |
| --- | --- |
| Where RevPack lives | `scripts/revpack-visualizer-harness.ts`, `test/revpack-visualizer-harness.test.ts`, manifest type `VisualizerHarnessManifest` in `src/providers/visualizer/fixtureHarness.ts`. |
| Fixture availability | `test/fixtures/revpack/` is **gitignored** (private shop program + REVGRIPS STEM CAD). It is absent on Zach's laptop checkout and every clean clone, so both harness tests **skip** everywhere. `npm run test:all` reports it as green. |
| Target | Only the target's bounding box is compared with the G-code cut envelope (`compareBounds`). |
| Stock | Not part of the manifest. Visualizer guesses it from a `STOCK` comment in the program, if any. |
| Workholding | Hard-coded `fixtureMode: 'none'`; the test asserts it. Jaws are a default vise/chuck guessed from the machine type. |
| Work offsets | Only the *names* used (G54) are listed; where the offset sits on the machine is never known. |
| Tools | Parsed from program comments; no T/H/D registers, no gauge lengths, no check that H matches T. |
| Machine | None. `machineType` is whatever the parser detects from the program text. No axes, limits, kinematics, dialect or spindle limit. |
| G-code vs RevPack | No check: travel, rapids into stock/workholding, offsets, tool lengths, spindle/feed, retracts, TCPC — none were exercised. |
| Cross-repo parity tests | 79 tests skip unless jobline.ai-CAM and shift-handover-hub are checked out next to the repo. |

## After (this branch)

* `src/providers/visualizer/revpack.ts` — `jobline.revpack/2` schema: target,
  stock (box or bar), workholding (boxes/cylinders), work-offset machine
  locations, tool list with H/D and gauge lengths, machine (preset id, axes +
  limits, kinematics, rotary vectors + MRZP, dialect, TCPC/DWO codes, spindle
  max, tool-change Z / turret clear point). 3D machine model optional.
* `src/providers/visualizer/revpackCorrelation.ts` — steps the program against
  the pack: travel (gauge line + rotaries), rapids vs remaining stock
  (heightmap / turned profile), any move vs workholding, undefined offsets,
  motion before an offset, T not in pack, H≠T, no G43 after M06, spindle off /
  no F on a cut, S over machine/tool, M06 below tool-change Z, G28 in G90,
  turret index near the part, simultaneous 5-axis without TCPC, rotary index
  near the part, TCPC+DWO together, foreign TCPC/DWO codes, dialect mismatch,
  units mismatch, program end.
* `buildRevPackSimulationMessages()` — the visualizer's stock, jaws and tool
  library now come from the pack instead of being guessed from the program.
* Committed public packs (`test/fixtures/revpack-public/`): Haas UMC-750 5-axis
  (clean + seeded-error), Haas VF-2 vise plate, Okuma Spaceturn LB3000 EX II
  shaft (OSP T-words), TRUMPF TruLaser 3030 nest. They never skip.
* `npm run test:revpack` (29 tests, in `test:all`), `npm run revpack:e2e`
  writes `qa/revpack-e2e/*.after.svg|png`, `*.before.svg|png`, report.json and
  SUMMARY.md.

## Still open

* The private REVGRIPS pack is still a v1 manifest; `revpack:e2e` reports it
  as needing conversion. Zach needs to supply stock, fixture, offsets and the
  real tool lengths for it.
* Holders/spindle nose are not modelled; tool body = cutter cylinder over its
  flute length.
* UMC-750 MRZP values in the sample are illustrative, not probed. B is taken
  as rotating about Y (Haas MRZP: B centreline measured from X and Z home).
* The webview still draws one vise/chuck jaw pair; multi-box workholding is
  checked but only the first box is drawn in VS Code.
* Real VS Code webview screenshots for these packs need the extension host
  (`npm run test:e2e:visual`), which was not run in this pass.
