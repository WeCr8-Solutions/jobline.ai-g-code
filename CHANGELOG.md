# Changelog

All notable changes to **JobLine G-Code Intelligence** are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

## [0.3.14] - 2026-10-15

### Tool libraries, CAM output and per-control checks

- **Tool-library import** (was an empty stub): Fusion `.json` / `.tools`, HSMWorks / Inventor CAM `.hsmlib` (UTF-16 XML) and CSV (`T, H, D, diameter, flute length, gauge length, description`). Imported tools feed the Tools view and new checks: tools not in the library, T/H and T/D register mismatches, comment diameter vs library diameter (unit-aware). Lathe T0101 decoding is respected; Siemens/Heidenhain skip H/D register checks.
- **File-based CAM integrations** replace the ESPRIT, Mastercam, GibbsCAM, Hexagon, Fusion, Cura, laser and sheet-metal stubs: CAM detection from the NC header, tool lists from post header comments, setup-sheet readers (HTML column tables, per-tool key/value tables, XML, CSV), automatic linking of a same-name setup sheet, and output-folder watching. The UI says plainly that there is no live connection to the CAM application.
- **Per-control validation rules** for Fanuc, Haas NGC, Siemens 840D, Okuma OSP, Mazak EIA/ISO, Mitsubishi M8/M80, Heidenhain TNC (Klartext and ISO), Fadal and generic/LinuxCNC. Mitsubishi, Heidenhain, Fadal and generic are now selectable controls. Klartext programs skip the ISO rules.
- **Convert Program to Another Control**: common-code repost from ISO dialects to Haas, Mazak, Mitsubishi, Siemens 840D, Okuma OSP and Heidenhain Klartext, with every unconverted line marked `JL MANUAL`.

### Visualizer and listing

- Vise detail: each RevPack jaw now shows its serrated gripping edge (6 mm pitch) and jaw screws, the vise body its guide rib, centre spindle and spindle ends, and the zero-point plate its counterbores. Display only: the collision and grip checks still use the kernel's envelope solids, so CAM and the hub stay byte-identical. Jaws are bright steel and the body darker; the riser no longer z-fights the plate.
- Fix: the View panel stacks between the playback and RevPack panels instead of sliding under the playback controls (it was fixed at 112 px from the bottom). A benign ResizeObserver notice no longer shows the "could not start" banner.
- New webview controls for tests and captures: `setPanelOpen`, `zoomBy`, `panBy`.
- Marketplace README: rewritten for 0.3.14, led by Simulation, Code review with flags, and Toolbar and simulation controls. New screenshots captured from the Extension Development Host (`JOBLINE_VISUAL_MARKETPLACE=1`, 2x). Images are served from jobline.ai, not raw.githubusercontent.com.

### RevPacks

- New: RevPack v2 setups. A program is checked against its pack (travel, rapids into stock or workholding, offsets, tools and gauge lengths, spindle limits, TCPC/DWO) and drawn from it: auto-detected `revpack.json` beside a program, **JobLine: Load RevPack...** / **Clear RevPack**, stock, every workholding solid, tools at gauge length and the in-process stock from the shared kernel, correlation findings as diagnostics with click-to-line.
- **Real target parts.** Every public pack's target is now a solid of what its program cuts, as STEP (B-rep, loaded through OpenCascade in the pack's units) with an STL of the same solid beside it: the UMC-750 bracket (faced top, R0.25 pocket, two side holes drilled at B90, 0.09 x 45 deg chamfers on two top edges), the VF-2 vise plate (faced, four 1/4-20 tap-drill holes), the LB3000 shaft (dia 50 / 70, 2 x 45 chamfer, two 3 mm grooves) and the TruLaser nest (six 200 x 150 x 3 parts). They replace placeholder boxes. Generator: `scripts/revpack-targets/generate_targets.py` (CadQuery).
- The UMC-750 sample now drills two side holes and its chamfer pass actually reaches the edges (it stopped 0.19 in short before); the LB3000 sample grooves the shaft with a new T05 3 mm grooving insert. Both packs still check clean.
- The target draws as an opaque gold solid with the stock translucent over it (RevPack fixtures in steel grey), feature edges only in Wireframe.
- **Target only** shows just the finished part. **Compare** colours the in-process stock against the target: on size, remaining material, gouge (seen from +Z, with the cell counts and largest values).
- The seeded-error pack is labelled everywhere: its name, a "Seeded test pack: errors are intentional" banner on the panel, and the same text on each of its Problems entries.
- **5-axis workholding.** The UMC-750 packs hold the part in a LANG Makro-Grip 77 5-axis self-centering vise (48120-77) on a Quick-Point 52 zero-point plate, built parametrically from LANG's published numbers (130 x 77 x 65 mm, 77 mm jaws, base body 38 mm and jaw top 62 mm above the vise bottom, 0-120 mm clamping range, 14,000 N at 60 Nm, 3 mm clamping depth on a pre-stamped blank), not from LANG CAD. The vise body, both moving jaws, the zero-point plate and the riser are separate solids with roles; the blank (now 3.0 x 2.0 x 1.65 in) sits 3 mm deep in the jaws and the gripped region is its own highlighted solid. Sources are in each pack's `workholdingSpec.sources` and in `docs/revpack-workholding.md`.
- Collisions are named by what they hit: `rapid-into-jaw`, `feed-into-vise-body`, `rapid-into-zero-point`, `feed-into-chuck-jaw`... with the solid's name (the seeded pack's rapid now goes into the +Y jaw). New `workholding` checks: grip depth below the vise maker's recommendation (`grip-depth-below-recommended`), a feed into the gripped stock at a clamped face (`feed-into-grip-zone`), and a tilted tool whose shank or holder reaches the jaws or vise (`tilted-tool-hits-jaw`, the clearance 5-sided access needs). The clean O05001 stays at zero findings.
- **Stock where it really sits.** A pack states its setup: part zero, stock offsets around the target, grip depth. The stock must equal the target's bounds grown by those offsets, with the target inside; every public pack is checked (and the AR4 uploads against the upload setup: 3 mm sides, 1 mm top, 3 mm grip + 1 mm below). A part opened without a pack gets its stock around it instead of a placeholder box at the origin.
- **Per-object layer styles.** Stock, target, fixture / vise body, jaws, zero-point / riser, tool, holder and toolpath each have their own visibility and Solid / Transparent (with an opacity slider) / Wireframe style in the View panel, with **All solid**, **Inspect part** (workholding transparent) and **Workholding only** presets, remembered for the session. By default the stock is 50% transparent and the target a solid inside it; jaws draw hardened grey-blue, the vise body darker, the gripped region magenta. Solid, Wireframe, Target only and Compare work as before.

- **Part to origin / Set WCS** (Origin panel in the visualizer, and **JobLine: Part to Origin…** commands), the way Fusion, Mastercam and ESPRIT set a work origin, for a RevPack target or a part imported on its own (the AR4 uploads):
  - Bounding box: the WCS at any of the 27 box points (8 corners, 12 edge midpoints, 6 face centres, centre) from a 3 x 3 x 3 picker, on the **part box** or the **stock box**; **Top / Bottom / Left / Right / Front / Back** move one axis to that face (Top = Z0 on the top, X/Y kept), **Center**; presets **Top center** and **Top-front-left corner**.
  - Picks in 3D: planar face (that axis to the face, origin at the face centre, turn the face to the top or bottom), bore or boss (centre on its fitted cylinder axis, optionally turning that axis onto Z), vertex / edge point, two-point midpoint, three-point circle centre. Hover highlights the triangle under the cursor; the picked face or bore stays highlighted.
  - Orientation: rotate 90 deg about X / Y / Z, flip, align an axis; numeric offset (X Y Z + rotation about Z); **Undo** (50 steps) and **Reset**; **Center in stock** (XY or XYZ).
  - The pack is redrawn and re-checked as placed: target moved, stock rebuilt from the setup around it (the target always inside), vise / jaw / zero-point solids following the stock (same grip depth, same collision solids, stock still 50% transparent), the active work offset (G54) moved the other way, `setup.partZero` updated. Lathe / bar stock keeps X0 on the spindle axis.
  - Views: **View normal to face**, a WCS triad at the work origin, and a readout of the origin against the part box and on the machine (G54).
  - All maths is in the new framework-free `revpackPlacement.ts`, byte-identical in jobline.ai-CAM and the JobLine.ai hub and proven by the shared parity golden (each pack's `placement` key: 27 box points, fixed placements, first bore centred and turned to Z, a face turned up, centre in stock). New `test/revpack-placement.test.ts` covers every mode; the visual E2E adds corner, top-center, bore-center and face-align cases on the UMC-750, VF-2 and an uploaded AR4 gear.
- **Open a `.jbl` from jobline.ai-CAM.** **JobLine: Load RevPack…** also opens a `.jbl` job file: the pack, the Setup / WCS made on it in CAM and the target STL in one file. The Origin panel starts on CAM's setup, so the origin, readout, G54, part zero and stock match what CAM showed (shared `revpackPlacement.ts` `buildJbl` / `parseJbl`, proven by a CAM-exported fixture in `test:revpack`). The file also says when the program must be re-posted after the move.

### Fixed

- RevPack checker: a rapid that crashed into stock was reported a second time on the retract out of it; the crash path now counts as cut.
- RevPack checker: a tool with no known diameter sitting exactly on a heightmap cell corner touched no cell, so a rapid straight down through the stock went unreported.
- In-process stock: a tap removed a full cylinder of its major diameter (shown as a gouge against the tap-drill bore); TCPC passes tilted up to 30 deg are now cut instead of skipped.
- Visual E2E: the window is forced to 1600 x 1000 (VS Code ignored `--window-size` and captured at 1024 x 768).
- Visualizer: the legend sat under the view cube's preset buttons; it now sits left of the cube.
- Visualizer: a preset view (ISO, Top...) counted as the user moving the camera, so a part that loaded after it (a slow STEP) stayed framed for the empty scene and was clipped (AR4 gear, jaw1). A preset now sets the angle and new geometry is framed again at it.

## [0.3.13] - 2026-10-13

### Marketplace listing

- Rewrote the Marketplace README. The published 0.3.12 listing still described v0.1: it called Validate Program and Format G-Code placeholders, listed diagnostics (0.2), the formatter (0.3) and subprogram navigation as future work, and never mentioned robot languages, probing, machine presets, the Toolbox, model imports or tap drill checks. It now documents the shipped features, real known issues and the current roadmap.
- Commands and Settings tables are generated from package.json by `scripts/gen-readme-tables.cjs` (`--check` fails when they drift).
- README images use absolute https URLs so they render on the Marketplace.
- New description, keywords (Fanuc TP, ABB RAPID, Macro B, machinist and others; dropped "dnc", which is not shipped), the Visualization category, a gallery banner that matches the icon, and a jobline.ai homepage link.
- Added a free machining calculators section (jobline.ai/tools) with Marketplace UTM tags.
- The sidebar shop link now opens jobline.ai/shops tagged `utm_source=vscode&utm_medium=extension` instead of /founding-shop.

### Added

- Machine presets: save a machine (control, machine type, units, travel, options, workholding) once and reuse it for every program. Choose per workspace or set a default for all workspaces.
- **Machine Setup** sidebar view with the active machine, presets grouped by source, and inline use / set-default actions; status bar and Visualizer Settings pickers.
- Preset wizard (**JobLine: New Machine Setup**), import, export, edit, duplicate and delete commands.
- Presets are `.jblmachine` files shared with jobline.ai-CAM: same codec, JSON Schema and default library folder (`~/.jobline/machines`), plus workspace files and shared shop folders.
- A prompt to switch machine when a program uses features the active preset lacks (turning codes on a mill, rotary moves on a 3-axis, robot vs. CNC programs).

### Changed

- Synced `data/reference/jobline-shop-reference.json` to v1.2.1 from the JobLine shop app (shift-handover-hub PRs #184 and #185): corrected 50% tap drills, NPT tap drills and carbide milling SFM; a larger cutting-speed table; and #10-32 is now UNF only (75% tap drill #21), with #10-24 the only #10 UNC thread (#25). The earlier bundle also listed #10-32 under UNC.
- The Commands view is grouped into Machine Setup, Check & Explain, Edit Program and Navigate.
- The visualizer uses the active preset's machine type and workholding when the program text alone cannot tell (e.g. a plain G0/G1 lathe program).
- **Select Machine Type** also sets the broad `jobline.machineType` profile, so cycle lists and lathe T-word decoding follow the pick.

### Fixed

- The Visualizer Settings machine-type override sent a message field the visualizer never read, so changing it had no effect.

## [0.3.12] - 2026-10-06

### Fixed

- Render full-circle G02/G03 moves with in-plane center offsets even when XYZ endpoints are omitted.
- Avoid interpreting milling G73 peck drilling as lathe diameter coordinates; retain P/Q contour-form detection.
- Accept variable-peck I/J/K parameters in peck-cycle diagnostics.

### Added

- Tessellated STEP target geometry through the OpenCascade importer.
- A 75-case motion regression matrix covering planes, units, coordinate modes, circle sizes and rapid/feed flags.

### Testing

- Restored the STEP cube fixture and corrected rendered overlay measurements and the diagnostics smoke fixture.
- Full test suite and 15 rendered smoke tests pass. Smooth linear playback, automatic N-number maintenance and other reported visualizer issues remain separate work.

### Documentation and packaging

- Updated the README and contributor setup for current features, commands, verification steps, and known limitations; labeled original roadmaps and baseline results as historical.
- Include the STEP JavaScript/WebAssembly runtime and license notices in the VSIX, with an extracted-package tessellation check.

## [0.3.11] - 2026-09-27

### Added

- Fusion 360 setup import with bounded ZIP/Zstandard decoding, model and stock
  dimensions, G54 setup metadata, and shaded model reference.
- Multi-model scene roles for target parts, fixtures, jaws, holders, and tools.
- ISO insert-aware mill and lathe tool visuals plus active-tool playback updates.
- Packaged VSIX rendering checks at desktop and narrow viewport sizes, including
  Justin's Fusion/G-code stock, target, WCS, and 6 mm tool registration.

### Fixed

- Correct G18/G19 arc validation and visualization for Fusion-posted programs.
- Register Fusion model and stock in millimeters at program X0/Y0 with Z0 on the
  part top instead of centering them on lead-in and lead-out tool-center moves.
- Keep playback controls reachable in small windows and correlate playback with
  the highlighted source row.
- Collapse target controls by default so setup UI does not obscure the scene.
- Include the Fusion Zstandard runtime in the VSIX so clean installations can
  open compressed F3D setup metadata.

## [0.3.8] - 2026-09-11

### Fixed

- **A program's real insert selection was silently discarded.** `ProgramModelBuilder`
  already parses a genuine ISO 1832 insert designation (CNMG432 and similar) out of
  the tool-call comment - `ToolUsage.insertCode` - but that field was write-only:
  computed, stored, and read by nothing anywhere in the extension. Wired it into the
  Plain Language panel, so a tool line now reads "T1 — CNMG432 (Rhombic 80 deg, 0.5"
  IC)" instead of silently dropping what the program actually said was loaded.
- **`samples/lathe-turning.nc` never exercised insert detection at all.** Its tool
  comments said "TNMG INSERT" / "VNMG INSERT" - shape and clearance letters with no
  size code - and the parser correctly requires a full designation (`CNMG432`, not
  "CNMG 432" or "CNMG") to reject ordinary prose. Updated the sample to real,
  correctly-sized designations (CNMG432 rough, VNMG331 finish) so the feature the
  sample is meant to demonstrate actually fires.
## [0.3.7] - 2026-09-11

### Fixed

Found by testing the Plain Language explainer against this extension's own bundled
sample programs, read line by line as a beginner would. Every item below reproduced
on a real bundled sample before the fix, and was re-verified after:

- **Nested parentheses in a comment corrupted parsing.** The comment regex closed on
  the FIRST `)`, so `(T02 - 0.201 DRILL (13/64) S4500 F12.0)` (word for word from
  `samples/mill-comprehensive.nc`) left `S4500 F12.0)` unstripped, which then
  tokenized as real S/F addresses on that line. Replaced with a depth-counting
  matcher in the tokenizer.
- **G98/G99 (the lathe feed-mode pair) were not tracked at all.** Every feed rate on
  a G99 (feed-per-revolution) lathe program was mislabeled IPM instead of IPR - about
  two orders of magnitude off from the real cutting speed. `samples/lathe-turning.nc`
  is G99 throughout; every one of its feed lines was wrong. Now tracked as its own
  modal state alongside G94/G95.
- **Lathe T-words showed a station number that doesn't exist.** T0101 (tool 1,
  offset 1 - standard Fanuc/Haas lathe T-word format) narrated as "T101". The correct
  decode already existed for the internal Operations list; it never reached the text
  a reader actually sees. Also corrected the phrasing: a lathe T-word indexes the
  turret immediately, it does not wait on a separate M6 the way a mill does.
  Detected from the program's own G96/G97/G70-G76 content, not the dialect setting -
  so this now works for Fanuc and Haas lathes, not only a dialect literally named
  "lathe" or "okuma".
- **M29 (rigid tap mode)** and **G75 (peck grooving cycle)** produced no explanation
  at all. Both are used in this extension's own bundled samples.
- **O-number program headers were never shown.** A bare `O8000` line explained as
  nothing; `O00200 (TITLE)` explained as only "Comment: TITLE" with the program
  number itself silently dropped.

5 new tests (`test/step-parser.test.ts`, `test/cross-format-import.test.ts`) plus
manual verification against every bundled sample cover the STEP/STL/Parasolid and
explainer fixes; the existing 113-test suite stays green throughout.
## [0.3.6] - 2026-09-11

### Fixed

- **STEP (.stp/.step) files now actually parse.** `stepParser.ts` was a 5-line placeholder
  that returned nothing (`TODO: Implement STEP parsing logic`) - calling it did not error,
  it just silently produced no geometry, no bounds, nothing. It now reads real
  `CARTESIAN_POINT` entities out of the ISO-10303-21 file (every vertex and B-spline/NURBS
  control point in a STEP file is written as one) and reports an exact bounding box, the same
  approach already used for Parasolid text import. This is not a full B-rep import - no
  geometric kernel is vendored - so surfaces between points are still not reconstructed, but a
  STEP file dropped into the visualizer now measures correctly instead of silently doing
  nothing. 5 new tests in `test/step-parser.test.ts` against a synthetic fixture.

## [0.3.5] - 2026-09-09

Type-safety hardening on top of 0.3.4. No user-facing behaviour changes: this
build makes the visualizer and parser modules compile with zero TypeScript
errors, where 0.3.4 shipped with 24. Cut so students and users get one clean,
current package instead of a stale Marketplace build.

### Changed

- **Visualizer geometry helpers are now typed.** `manualGeometry.ts`,
  `fixtureVisualizer.ts`, `stockVisualizer.ts`, `toolpathVisualizerCore.ts`,
  `threeSetup.ts`, `stepParser.ts`, `camIntegration.ts` and `visualizerMessages.ts`
  used `any` and `{}` placeholders throughout. They now carry real `three` types
  (`BufferGeometry` and friends). These modules are internal scaffolding - the
  live 3D rendering runs in `media/toolpathVisualizerWebview.html` and is
  unchanged - but the loose types were hiding a class of `undefined` and
  type-confusion bugs from the compiler.
- **CAM import stubs keep their parameter names.** `importToolLibrary(_file)` and
  `extractToolsFromGCode(_gcode)` rather than a bare `_`, so the public signature
  still documents what each argument is.

### Fixed

- **Unit-test runner is now tracked.** `scripts/run-unit-tests.js` - the
  shell-free entry point the CI gate runs - existed only on disk. It is committed,
  so a fresh clone or CI checkout can run the suite.

### Security

- Regenerated `package-lock.json` to clear the fixable transitive advisories
  (10 high, 7 moderate down to 3 and 2). The three that remain - `markdown-it`,
  `serialize-javascript`, `linkify-it` - are **build-time only**: they come in
  through `@vscode/vsce` and `mocha`, are not in the extension's runtime
  dependencies, and are excluded from the `.vsix`. Their fixes are major version
  bumps of the tooling and are left for a deliberate upgrade.

### Verified

- `tsc --noEmit`: clean. 113 unit tests passing. 0 lint problems.

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

### Fixed — lathe

- **Turned parts were drawn at twice their true size.** The toolpath parser had
  no lathe awareness, and X on a turning control is DIAMETRAL: `X2.1` puts the
  tool 1.05 from the centreline, not 2.1. Every turned profile was plotted at
  double scale, so the path fell outside its own stock - and a student comparing
  the two would conclude the program was wrong when it was the drawing that was
  wrong. Turning is detected from G96/G97 or a G70-G76 cycle, checked against
  executable text so a comment cannot trigger it.
- **`G90` and `G99` were read as mill modes on a lathe.** On a Fanuc lathe G90 is
  a turning *cycle*, not absolute mode, and G99 is feed-per-revolution, not a
  canned-cycle return.
- **Turning stock was drawn as a block from Z0 upward.** A turned blank is a bar
  on the spindle axis running back into the chuck in -Z, so stock and toolpath
  occupied different places entirely. It is now a cylinder of the programmed
  diameter, and the chuck jaws grip its OD at the chuck end.

### Added — inserts

- **ISO 1832 insert designations.** CNMG, CNGG, VNGP, VNGG, TCMT, DNMG, WNMG,
  SNMG, RCMT and the rest are parsed for shape, clearance angle, tolerance,
  inscribed circle, thickness and corner radius, in both inch (eighths,
  sixteenths, sixty-fourths) and metric forms. Sixteen shape letters are
  covered, including the round, trigon, hexagon and pentagon forms.
- **Designations are pulled out of the program.** A tool comment such as
  `(T3 - CNMG432 ROUGH OD)` now records the insert against that tool, and its
  inscribed circle is used when no diameter was stated. Scanning requires a size
  code, because without it ordinary words parse as inserts - SECOND is a valid
  looking S/E/C designation and ROUGHER an R/O/U one.
- **Inserts are viewable and editable.** Tool Preview has an insert field that
  draws the real ISO outline extruded to its own thickness. Verified distinct:
  an 80 degree C, a 35 degree V, a 60 degree T, a round R and a square S all
  draw different silhouettes, which is how a turner tells them apart.
- Parsing lives in one place, so the shape drawn in the preview cannot drift
  from what the program parser reads out of a comment.

### Added — tools

- **Tap, Boring Bar and Lathe Insert have their own geometry.** All three drew as
  a generic cylinder, so the dropdown offered seven tools and delivered three
  distinct shapes. A tap now shows its chamfered lead, thread crests and square
  drive; a boring bar its offset head and insert; a lathe insert its rhombic
  form on a shim and holder. Verified distinct: all seven silhouettes differ.


- **Mill setup rules were raised against turning programs.** A correct Okuma
  program collected all three - distance mode, working plane, work offset -
  telling the operator a good lathe program was deficient three times over. On a
  Fanuc lathe G90 is a turning *cycle*, not absolute mode; a 2-axis turn center
  works in ZX by definition; and lathes carry the offset on the T word (T0101 is
  tool 1, offset 1) or set the datum with G50. Turning programs are now asked for
  a turning datum instead.
- **A lathe was only recognised by its canned cycles.** Detection keyed on
  G70-G76, so a plain face-and-turn in G0/G1 reported as a 3-axis mill - which
  also put vise jaws on a chucked part. G96/G97 and the Okuma dialect now count.

### Fixed — visual

- **The scene had no lights.** The tool and holder are `MeshPhongMaterial`,
  which is shaded by lighting, so with none in the scene they rendered pure
  black - the cutter showed as a featureless dark cylinder. Everything else is
  line work or `MeshBasicMaterial`, which ignores lighting, which is why only
  the solids looked wrong. Added a hemisphere light plus a key light and a
  camera-follow light.
- **The cut solid was nearly invisible** at 0.18 opacity - it read as a faint
  smear rather than material removed. Now 0.55 by default and on a slider.

### Added — visual

- **View panel.** In-viewport sliders for cut-solid, stock, workholding, tool
  and toolpath opacity, plus per-layer visibility including the gnomon. Kept in
  the viewport rather than the settings pane so the effect of a slider is
  visible while you drag it, and re-applied whenever geometry rebuilds so the
  panel never stops describing what is on screen.


- **Workholding view.** Vise jaws for a mill, three chuck jaws for a turn
  center, drawn from the stock so you can see how much of the part is gripped
  and how much stands proud. Chosen from the detected machine type and
  overridable; nothing is drawn until a stock size is known, because without one
  the jaw position would be invented rather than shown.
- **Gnomon.** A fixed XYZ triad in the corner of the viewport that follows the
  camera's rotation only. The existing origin triad sits at part zero and pans
  away with the model - gone exactly when you have orbited far enough to need
  it.

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
