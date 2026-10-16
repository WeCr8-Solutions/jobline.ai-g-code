# JobLine G-Code Intelligence

**Simulate and review CNC programs in VS Code before they reach the machine.** A 3D toolpath simulator with the vise, jaws, stock and finished part, and a code review that flags problems on the line that causes them: live diagnostics, setup and tool checks, collision and grip warnings that name the jaw, tap drill checks and hover explanations. Fanuc, Haas, Siemens, Mazak and Okuma G-code, plus Fanuc Robot TP and ABB RAPID. Built by machinists at [JobLine.ai](https://jobline.ai/features/vscode-gcode?utm_source=vscode&utm_medium=marketplace&utm_campaign=jobline-gcode).

![A real sample program simulated on a Haas UMC-750 with a LANG Makro-Grip 5-axis vise: steel serrated jaws, the stock see-through, the finished part in gold, toolpath and tool](https://jobline.ai/vscode/gcode/hero-vise-sim.png)

Runs locally. Your programs are never uploaded.

## Get started

1. Install the extension (VS Code **1.85** or newer): `ext install WeCr8-Solutions.jobline-gcode`, then open an NC program: `.nc`, `.gcode`, `.ngc`, `.tap`, `.cnc`, `.mpf`, `.spf`, `.min`, `.prg`, `.eia` and [50+ more extensions](#supported-files).
2. Click the machine in the status bar, or run **JobLine: Switch Machine**, and pick or create a machine preset. It is remembered per workspace.
3. Click the eye icon in the editor title bar (**Show Toolpath Visualizer**) to simulate the program in 3D.
4. Fix what the Problems panel flags, then run **JobLine: Format G-Code** to clean up spacing and case.

![JobLine in VS Code: the program in the editor with the Play / Pause / Step buttons in the title bar, and the 3D simulation beside it](https://jobline.ai/vscode/gcode/workbench-editor-visualizer.png)

## Simulation

The visualizer draws the program's moves against the setup it will run in.

- **Toolpath:** G00 to G03 in G17, G18 and G19, G20 / G21, G90 / G91. Rapids and feeds are drawn differently, and the current line is highlighted in the editor as the tool moves.
- **Play, pause, step and speed:** Play / Resume, Pause, Stop / Reset, Step - and Step +, at 0.25x, 0.5x, 1x, 2x or 4x. **Jump to Line** moves the simulation to a source line.
- **The setup:** stock (box or bar), the cutting tool and holder (ISO insert-aware mill and lathe tools), fixtures and jaws. Import the finished part as **STL**, tessellated **STEP** (bundled OpenCascade), or **Fusion 360 F3D** setup data.
- **RevPack setups:** load a RevPack (`revpack.json` with the program, target part, stock, tools and workholding) and JobLine draws it all. The UMC-750 sample uses a **LANG Makro-Grip 77** self-centering 5-axis vise on a Quick-Point plate and riser, with a 3 mm grip on a pre-stamped blank. The vise body, each jaw, the plate, the riser and the stock are separate solids. The jaws show their serrated gripping edge, and the gripped band of stock is highlighted.
- **Per-object display:** set the stock, target, fixture / vise body, jaws, zero-point / riser, tool, holder and toolpath separately to **Solid**, **Transparent** (with an opacity slider) or **Wireframe**, or hide them. Presets: **All solid**, **Inspect part** (workholding see-through, part solid) and **Workholding only**. **Target only** and **Compare** (remaining stock vs gouge) are one click.
- **Views:** Top, Front, Right and Iso, three more angled views, a ViewCube, orbit, pan and zoom.

![Per-object display: the jaws in Wireframe, the vise body Transparent at 35%, the stock at 28%, the part Solid](https://jobline.ai/vscode/gcode/object-styles.png)

### Collision and grip warnings that name the solid

With a RevPack loaded, every rapid and feed is checked against the stock and each workholding solid. A rapid into the jaw is reported as a rapid into **Makro-Grip 77 jaw +Y**, not "a collision". The jaw turns red in the view, and clicking the finding jumps to the line. JobLine also warns when a feed enters the gripped zone, when the grip is shallower than the vise maker recommends, and when a tilted tool reaches a jaw or the vise body.

![The seeded test program rapids into the +Y jaw: the jaw is drawn red and the finding names it, with the line number](https://jobline.ai/vscode/gcode/jaw-collision.png)

### Part to origin / Set WCS

The **Origin / WCS** panel puts the work origin where the program expects it. Pick any of the 27 bounding-box points on the part or stock. Use the quick faces (Top, Bottom, Left, Right, Front, Back, Center) or a preset (Top center, Top-front-left corner). You can also pick on the part itself: a face, a bore or boss center, a bore axis to Z, a vertex or edge, a 2-point midpoint or a 3-point circle. Rotate or flip the part, enter an offset and Z rotation, center it in the stock, and undo or reset. The readout shows the offset from the part min and center, the part size, the machine G54 and the stock bounds.

![The Origin / WCS panel with the work origin on the top face center of the part](https://jobline.ai/vscode/gcode/origin-wcs.png)

## Code review with flags

Problems are underlined on the line as you type and listed in the Problems panel. **JobLine: Validate Program** re-runs every check and reports the error and warning counts.

![Flagged lines in the editor and the Problems panel for the seeded UMC-750 test program](https://jobline.ai/vscode/gcode/code-review-flags.png)

**Always on:**

- Canned cycles missing Z depth or R plane, peck cycles (G73 / G83) without Q or I/J/K, and tapping cycles without F
- Tool changes (M06) with no safe-Z retract (G28, G30 or G53 Z) before them
- G02 / G03 arcs whose endpoint does not match the center offset, in G17, G18 and G19
- Spindle or coolant possibly left on at program end
- Moves beyond the active machine preset's travel limits
- **Tap drill check:** a tap with no matching tap drill earlier in the program, with the right size (75%, 50% or STI) from the JobLine shop reference
- Macro expressions that cannot be resolved are tracked, never flagged as false errors

**With a RevPack loaded (the program checked against its machine, tools and setup):**

- A tool that is not in the tool list (`T4 is called but the RevPack tool list has T1, T2, T3`)
- A T/H mismatch (`T2 is in the spindle but the program applies H1`), or no length offset after a tool change
- Spindle speed over the machine or tool limit, a feed with the spindle off, or a feed move without F
- Rotary or linear over-travel (`B goes to -40°; Haas UMC-750 allows -35° to 120°`)
- A work offset the setup does not define, or a move before any work offset
- Codes from the wrong control (a dialect mismatch) and simultaneous 5-axis moves without TCPC
- Rapids into the stock, the jaws or the vise body, and grip-zone and grip-depth warnings

**Hover explanations:** hover any G-code, M-code or address word for a plain-language card covering what it does, its parameters and what to check. Drilling and motion codes include diagrams, and Siemens `CYCLE` calls show their parameters. **JobLine: Open Plain Language Explanation** narrates the whole program line by line.

![G83 peck-drilling hover card in the editor](https://jobline.ai/vscode/gcode/hover-g83.png)

**Formatter:** **JobLine: Format G-Code** (or **Format Document**) adds word spacing (`G01X1.5` becomes `G01 X1.5`), uppercases G/M codes and can apply fixed decimal places.

## Toolbar and simulation controls

![Labeled: the editor title-bar buttons and the visualizer's simulation, view, display and Origin / WCS controls](https://jobline.ai/vscode/gcode/toolbar.png)

**Editor title bar** (with an NC program open):

| Button | What it does |
| --- | --- |
| Eye: **Show Toolpath Visualizer** | Opens the 3D simulation beside the editor |
| **G-Code: Play** / **Pause** | Starts and pauses the simulation |
| **G-Code: Step Back** / **Step Forward** | Moves the simulation one move at a time |
| **G-Code: Jump to Line** | Asks for a source line number and moves the simulation there |
| Tools icon: **Open Tool Preview** | Shows the active tool and holder |
| **Open Simulation** / **Open Simulation Full Window** | Opens the visualizer beside the editor, or in the editor's own column |

**Visualizer panel:**

| Control | What it does |
| --- | --- |
| **Play / Resume**, **Pause**, **Stop / Reset**, **Step -**, **Step +** | Playback. Stop / Reset returns to the start (also **G-Code: Stop** in the Command Palette) |
| **0.25x 0.5x 1x 2x 4x** | Simulation speed |
| **Solid**, **Wireframe**, **Target only**, **Compare** | Whole-scene display modes |
| **All solid**, **Inspect part**, **Workholding only** | Per-object display presets |
| **View** panel | Each object Solid / Transparent / Wireframe, with opacity and visibility |
| **Top Front Right Iso XYZ ZYX YZX** and the ViewCube | Camera views |
| **Origin / WCS · Part to origin** | Box points, quick faces, presets, picks, rotate / flip, offset, center in stock, undo and reset |

**Command Palette:** **JobLine: Validate Program** (re-check and count findings), **JobLine: Format G-Code**, **JobLine: Load RevPack…**, **JobLine: Part to Origin / Set WCS**, and the full list under [Commands](#commands).

## Features

### Program sidebar

The **JobLine** Activity Bar panel updates as you edit:

| View | Shows |
| --- | --- |
| Machine Setup | Active machine preset, all presets by source, use / set-default / edit / export |
| Operations | Each tool change as an operation with its line range |
| Tools | Every tool called, with H offset, RPM and feed range; add, remove, or jump to a tool change |
| Offsets | Work offsets in use (G54 to G59) |
| Canned Cycles | Each G73/G74/G76/G81 to G89 cycle with its parameters |
| Probing | G31 skip and G38.x probing moves with target and feed |
| Macros & Flow | Macro B variables and `IF` / `WHILE` / `GOTO` control flow |
| Toolbox | One-click program edits (see below) |
| Alarms & Warnings | Diagnostic findings, click to jump to the line |
| Commands | Every JobLine command, grouped |
| Visualizer Settings | Machine type, stock, tool, and scene settings |

Previous / next buttons step through operations, tools, cycles, probes, macros, and alarms. **M98 P** subprogram calls are links: Go to Definition jumps to the matching `O` number in the same file or the workspace.

### Toolbox

Insert, remove, or renumber N-lines; strip comments; uppercase G/M codes; add or remove block skip (`/`); remove dwells; scale or clamp feeds and scale spindle speeds; shift X, Y, or Z; add a safety header, program end (M30 + %), safe-Z before tool changes, coolant on/off, or blank lines between operations; find the next tool change or canned cycle.

### Tap drill check

When a tool comment names a thread (`T3 M06 (1/4-20 TAP)`, `M8 X 1.25 FORM TAP`), the program review checks that an earlier tool drills a matching tap drill (75%, 50%, or STI size) and tells you the right size if none does. Sizes come from the JobLine shop reference (`jobline-shop-reference.json` v1.2.1: UNC, UNF, and metric tap drills, roll-tap drills, number/letter/fraction drill sizes, NPT, and cutting speeds), the same data behind the [tap drill chart](https://jobline.ai/tools/charts/tap-drill-chart?utm_source=vscode&utm_medium=marketplace&utm_campaign=jobline-gcode) on jobline.ai.

### Machine presets

A preset stores one machine: control and model, machine type, units, axis travel, spindle limit, options (4th/5th axis, live tooling, probing, sub-spindle), workholding, and CAM post. Pick it once and every program is read against it. If a program does not fit (turning codes on a mill, rotary moves on a 3-axis, a robot program on a CNC control), JobLine offers to switch.

- **JobLine: New Machine Setup** walks through name, control, machine type, units, and travel (`X30 Y16 Z20`).
- Presets are `.jblmachine` files, shared with **jobline.ai-CAM**, with schema validation and completion when you edit one.
- JobLine reads presets from the workspace (commit them with the job), `jobline.presets.sharedFolders` (a shop network share), and `jobline.presets.libraryPath` (default `~/.jobline/machines`), plus built-in starting points for each control. The workspace copy wins, then shared folders, then your library.

### Controls and languages

| Control | What you get |
| --- | --- |
| **Fanuc** (0i / 30i / 31i) | ISO G-code parsing, hover cards, diagnostics, formatter, sidebar, visualizer, and Macro B (`#1`, `#100`, `#5041`, `Z[#1+0.5]`, `IF` / `WHILE` / `GOTO`) |
| **Haas** (NGC) | The same ISO / Fanuc-style engine, with Haas file types (`.nc`, `.ncc`, `.ncp`, `.nc1`) |
| **Siemens** (Sinumerik 840D / 828D) | The same engine, `.mpf` / `.spf` files, and `CYCLE` hover cards |
| **Mazak** (Smooth / Matrix, EIA/ISO) | The same ISO engine for EIA programs (`.eia`) |
| **Okuma** (OSP-P) | The same engine with lathe conventions and `.min` files |
| **Fanuc Robot TP / LS** | `.ls` / `.tp` language mode with highlighting, a Fanuc Robot control type, and robot-vs-CNC preset checks |
| **ABB RAPID** | `.mod` / `.pgf` language mode with highlighting, an ABB control type, and robot-vs-CNC preset checks |

The CNC controls share one ISO / Fanuc-style engine; picking a control sets the dialect used for parsing and validation and shows it in the status bar. This is not full controller emulation.

Machine types: mill, lathe, mill-turn, and grinder. Lathe programs get diameter-mode X, T-word decoding, and turning cycle lists.

## Tool libraries, CAM output and per-control checks

- **JobLine: Import Tool Library** reads a Fusion tool library (`.json`, or `.tools`), an HSMWorks / Inventor CAM `.hsmlib`, or a CSV with a header row (`T, H, D, diameter, flute length, gauge length, description`; common spellings and Fusion CSV export headers are matched). The Tools view then shows the library data beside each tool and Problems lists tools that are not in the library, T/H and T/D register mismatches, and comment diameters that disagree with the library.
- **CAM integrations are file-based.** JobLine recognises ESPRIT, Mastercam, Fusion/HSM, GibbsCAM, Hexagon, SolidCAM, NX, CAMWorks and slicer output from the program header, reads the tool list a post writes into header comments, and reads the tool table from an exported setup sheet (HTML, XML or CSV) with the same name in the same folder. **JobLine: Watch CAM Output Folder** offers to open new posts. None of them talks to a running CAM session or reads native part files; that needs each vendor's licensed SDK. **JobLine: CAM Integrations** lists what each one reads.
- **Per-control validation.** Fanuc, Haas NGC, Siemens 840D, Okuma OSP, Mazak EIA/ISO, Mitsubishi M8/M80, Heidenhain TNC (Klartext and ISO), Fadal and generic/LinuxCNC each get their own rules on top of the shared ISO checks: G-code lists, macro / parameter syntax and ranges, loop and jump targets, subprogram calls, program-number length and M-codes per block. Unknown G-codes are information only, because options differ by machine.
- **JobLine: Convert Program to Another Control** rewrites common codes from an ISO (Fanuc-family) program to Haas, Mazak, Mitsubishi, Siemens 840D, Okuma OSP or Heidenhain Klartext, opens the result in a new tab and lists what it changed. Anything it can't map with confidence (macros, tapping/boring cycles, reference returns on OSP) is left as a `JL MANUAL` comment. It is not a CAM post-processor.

## Free machining calculators at jobline.ai/tools

The same team publishes free, no-signup shop calculators and charts:

- [Speed and feed calculator](https://jobline.ai/tools/speeds-and-feeds?utm_source=vscode&utm_medium=marketplace&utm_campaign=jobline-gcode): RPM from SFM, feed, chip load, chip thinning, MRR
- [Drill and tap calculator](https://jobline.ai/tools/drill-and-tap?utm_source=vscode&utm_medium=marketplace&utm_campaign=jobline-gcode): drilling speeds and feeds, point allowance, tap drill sizes
- [Thread size chart](https://jobline.ai/tools/thread-size-chart?utm_source=vscode&utm_medium=marketplace&utm_campaign=jobline-gcode): UNC, UNF, and metric, TPI to pitch, single-point threading feed
- [Machinist shop math](https://jobline.ai/tools/shop-math?utm_source=vscode&utm_medium=marketplace&utm_campaign=jobline-gcode): tolerance stackup, surface finish Ra, hardness conversion, right triangles
- [Reference charts](https://jobline.ai/tools/charts?utm_source=vscode&utm_medium=marketplace&utm_campaign=jobline-gcode): tap drill, roll tap, STI/Helicoil, drill size, NPT, cutting speed
- [G-Code Academy](https://jobline.ai/resources/gcode-academy?utm_source=vscode&utm_medium=marketplace&utm_campaign=jobline-gcode): learn and quiz yourself on codes

[All free tools](https://jobline.ai/tools?utm_source=vscode&utm_medium=marketplace&utm_campaign=jobline-gcode)

## Run your shop on JobLine

JobLine.ai is shift handoff and job tracking software for machine shops: notes, counts, and issues for every station, handed off cleanly between shifts. **[See JobLine for shops](https://jobline.ai/shops?utm_source=vscode&utm_medium=marketplace&utm_campaign=jobline-gcode)**. Machinists and programmers can also create a [free talent profile](https://jobline.ai/talent?utm_source=vscode&utm_medium=marketplace&utm_campaign=jobline-gcode).

## Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type **JobLine**, **G-Code**, or **Toolpath**.

<!-- commands:start -->

**Machine presets**

| Command | ID |
| --- | --- |
| JobLine: Select CNC / Robot Control Type | `jobline.selectControl` |
| JobLine: Select Machine Type (one-off) | `jobline.selectMachineType` |
| JobLine: Switch Machine | `jobline.presets.switch` |
| JobLine: New Machine Setup | `jobline.presets.create` |
| JobLine: Save Current Setup as Machine Preset | `jobline.presets.saveCurrent` |
| Use This Machine (sidebar menu only) | `jobline.presets.apply` |
| Set as Default Machine | `jobline.presets.setDefault` |
| Duplicate Machine Preset (sidebar menu only) | `jobline.presets.duplicate` |
| Edit Machine Preset File | `jobline.presets.edit` |
| JobLine: Import Machine Preset (.jblmachine) | `jobline.presets.import` |
| Export Machine Preset (.jblmachine) | `jobline.presets.export` |
| Delete Machine Preset | `jobline.presets.delete` |
| JobLine: Reload Machine Presets | `jobline.presets.refresh` |
| JobLine: Open Machine Preset Folder | `jobline.presets.openLibrary` |

**Check, explain and format**

| Command | ID |
| --- | --- |
| JobLine: Validate Program | `jobline.validateProgram` |
| JobLine: Format G-Code | `jobline.formatDocument` |
| JobLine: Open Plain Language Explanation | `jobline.openExplainer` |
| JobLine: Insert Stock Header | `jobline.insertStockHeader` |

**Toolpath visualizer and simulation**

| Command | ID |
| --- | --- |
| G-Code: Update Toolpath Visualizer | `jobline.gcode.updateVisualizer` |
| G-Code: Play | `jobline.gcode.play` |
| G-Code: Pause | `jobline.gcode.pause` |
| G-Code: Stop | `jobline.gcode.stop` |
| G-Code: Step Forward | `jobline.gcode.stepForward` |
| G-Code: Step Back | `jobline.gcode.stepBack` |
| G-Code: Jump to Line | `jobline.gcode.jumpToLine` |
| G-Code: Import Target Model | `jobline.gcode.importTargetModel` |
| G-Code: Open Program in Visualizer | `jobline.gcode.openProgramInVisualizer` |
| G-Code: Reveal Review Finding | `jobline.gcode.revealLine` |
| Show Toolpath Visualizer | `jobline.gcode.showVisualizer` |
| JobLine: Open Simulation Full Window | `jobline.openSimulationFullWindow` |
| JobLine: Open Tool Preview | `jobline.openToolPreview` |
| JobLine: Open Simulation | `jobline.openSimulation` |

**Toolbox (program edits)**

| Command | ID |
| --- | --- |
| JobLine Toolbox: Insert Line Numbers | `jobline.toolbox.insertLineNumbers` |
| JobLine Toolbox: Remove Line Numbers | `jobline.toolbox.removeLineNumbers` |
| JobLine Toolbox: Renumber Lines | `jobline.toolbox.renumberLines` |
| JobLine Toolbox: Strip Comments | `jobline.toolbox.stripComments` |
| JobLine Toolbox: Uppercase G/M Codes | `jobline.toolbox.uppercaseGM` |
| JobLine Toolbox: Remove All Dwells (G04/G4) | `jobline.toolbox.removeDwells` |
| JobLine Toolbox: Add Block Skip (/) | `jobline.toolbox.addBlockSkip` |
| JobLine Toolbox: Remove Block Skip (/) | `jobline.toolbox.removeBlockSkip` |
| JobLine Toolbox: Scale Feed Rates | `jobline.toolbox.scaleFeedRates` |
| JobLine Toolbox: Scale Spindle Speeds | `jobline.toolbox.scaleSpindleSpeeds` |
| JobLine Toolbox: Clamp Maximum Feed Rate | `jobline.toolbox.clampFeedRates` |
| JobLine Toolbox: Shift X Axis | `jobline.toolbox.shiftX` |
| JobLine Toolbox: Shift Y Axis | `jobline.toolbox.shiftY` |
| JobLine Toolbox: Shift Z Axis | `jobline.toolbox.shiftZ` |
| JobLine Toolbox: Add Safety Header | `jobline.toolbox.addSafetyHeader` |
| JobLine Toolbox: Add Program End (M30 + %) | `jobline.toolbox.addProgramEnd` |
| JobLine Toolbox: Remove Extra Blank Lines | `jobline.toolbox.removeBlankLines` |
| JobLine Toolbox: Insert Safe-Z Before Tool Changes | `jobline.toolbox.insertSafeZ` |
| JobLine Toolbox: Add Coolant On/Off (M08/M09) | `jobline.toolbox.addCoolant` |
| JobLine Toolbox: Add Blank Lines Between Operations | `jobline.toolbox.addBlanksBetweenOps` |
| JobLine Toolbox: Find Next Tool Change | `jobline.toolbox.findNextToolChange` |
| JobLine Toolbox: Find Next Canned Cycle | `jobline.toolbox.findNextCannedCycle` |

**Sidebar navigation and tools**

| Command | ID |
| --- | --- |
| Add Tool Change | `jobline.tools.addToolChange` |
| Go To Tool in Editor | `jobline.tools.goToTool` |
| Remove Tool Change | `jobline.tools.removeToolChange` |
| JobLine: Previous Operation | `jobline.sidebar.prevOperation` |
| JobLine: Next Operation | `jobline.sidebar.nextOperation` |
| JobLine: Previous Tool | `jobline.sidebar.prevTool` |
| JobLine: Next Tool | `jobline.sidebar.nextTool` |
| JobLine: Previous Canned Cycle | `jobline.sidebar.prevCycle` |
| JobLine: Next Canned Cycle | `jobline.sidebar.nextCycle` |
| JobLine: Previous Probe | `jobline.sidebar.prevProbe` |
| JobLine: Next Probe | `jobline.sidebar.nextProbe` |
| JobLine: Previous Macro | `jobline.sidebar.prevMacro` |
| JobLine: Next Macro | `jobline.sidebar.nextMacro` |
| JobLine: Previous Alarm | `jobline.sidebar.prevAlarm` |
| JobLine: Next Alarm | `jobline.sidebar.nextAlarm` |
| JobLine: Import Tool Library (Fusion .json/.tools, .hsmlib, CSV) | `jobline.tools.importLibrary` |
| JobLine: Clear Tool Library / Unlink Setup Sheet | `jobline.tools.clearLibrary` |

**Other**

| Command | ID |
| --- | --- |
| JobLine: Load RevPack… | `jobline.revpack.load` |
| JobLine: Clear RevPack | `jobline.revpack.clear` |
| JobLine: Part to Origin / Set WCS (Origin panel) | `jobline.placement.showPanel` |
| JobLine: Part to Origin: Preset (Top center, Top-front-left corner…) | `jobline.placement.preset` |
| JobLine: Part to Origin: Bounding Box Point (27 points, part or stock) | `jobline.placement.boxPoint` |
| JobLine: Part to Origin: Axis to Box Face (Top / Bottom / Left / Right / Front / Back / Center) | `jobline.placement.face` |
| JobLine: Part to Origin: Pick Face, Bore, Edge or Points in 3D | `jobline.placement.pick` |
| JobLine: Part to Origin: Rotate / Flip / Align Part | `jobline.placement.rotate` |
| JobLine: Part to Origin: Numeric Offset (XYZ + rotation) | `jobline.placement.offset` |
| JobLine: Part to Origin: Center Part in Stock | `jobline.placement.centerInStock` |
| JobLine: Part to Origin: Undo | `jobline.placement.undo` |
| JobLine: Part to Origin: Reset to File Origin | `jobline.placement.reset` |
| JobLine: Part to Origin: Run Operation | `jobline.placement.run` |
| JobLine: Part to Origin: Current State | `jobline.placement.state` |
| JobLine: Link CAM Setup Sheet to Program | `jobline.cam.linkSetupSheet` |
| JobLine: Watch CAM Output Folder | `jobline.cam.addWatchFolder` |
| JobLine: CAM Integrations (what each one reads) | `jobline.cam.showIntegrations` |
| JobLine: Convert Program to Another Control (common codes) | `jobline.convertDialect` |

_89 commands, generated from package.json for v0.3.14._

<!-- commands:end -->

## Settings

Find these under **Settings > Extensions > JobLine G-Code**.

<!-- settings:start -->

| Setting | Default | Description |
| --- | --- | --- |
| `jobline.ui.showLinks` | `true` | Show optional JobLine for shops and G-Code Academy links in the sidebar and hover cards. |
| `jobline.controlType` | `"fanuc"` | CNC or robot control dialect. Each CNC control has its own validation rules (codes, macro syntax, loops and jumps, limits). Values: `fanuc`, `haas`, `siemens`, `mazak`, `okuma`, `mitsubishi`, `heidenhain`, `fadal`, `generic`, `fanuc-robot`, `abb`. |
| `jobline.controlAutoDetect` | `true` | Check each program as the control its header names (a Haas post writes "HAAS MILL NGC"; Okuma, Mazak, Siemens, Fadal, Mitsubishi and Heidenhain are recognised too). A control set for this workspace or folder (Select CNC / Robot Control Type, or a machine preset) always wins. |
| `jobline.machineType` | `"mill"` | Machine type profile used to tailor cycle lists and axis assumptions in JobLine views. Values: `mill`, `lathe`, `mill-turn`, `grinder`, `laser`. |
| `jobline.units` | `"inch"` | Default unit system (can be overridden by G20/G21 in program). Values: `inch`, `metric`. |
| `jobline.validation.enableSafetyChecks` | `true` | Enable crash-prevention safety rules (safe Z before tool change, spindle stop, etc.). |
| `jobline.validation.enableArcValidation` | `true` | Validate G02/G03 arc endpoint geometry and plane correctness. |
| `jobline.validation.arcTolerance` | `0.001` | Arc endpoint tolerance in current units (default 0.001 inch). |
| `jobline.validation.controlSpecificRules` | `true` | Run the rule set for the selected control (Fanuc, Haas, Siemens, Okuma, Mazak, Mitsubishi, Heidenhain, Fadal, generic) in addition to the shared ISO checks. |
| `jobline.formatter.wordSpacing` | `true` | Add spaces between G-code words (G01X1.5 → G01 X1.5). |
| `jobline.formatter.decimalPlaces` | `null` | Fixed decimal places for coordinates (null = don't change). |
| `jobline.formatter.uppercaseGM` | `true` | Uppercase G and M codes. |
| `jobline.detectedMachineType` | `""` | Detailed machine type in use (e.g. "Turn Center (2-Axis)"). Set by machine presets and JobLine: Select Machine Type. |
| `jobline.additionalExtensions` | `[]` | Extra file extensions to treat as G-code (e.g. [".cpp", ".sub", ".001"]). Useful for shop-specific file naming conventions not covered by the built-in list. |
| `jobline.machinePreset` | `""` | Id of the active machine preset (`.jblmachine`). Set it in **User** settings to make it the default for every workspace; a workspace value overrides it. Use **JobLine: Switch Machine** rather than editing by hand — applying a preset also sets control type, machine type and units. |
| `jobline.presets.libraryPath` | `""` | Folder for your own machine presets. Empty uses `~/.jobline/machines`, the same default jobline.ai-CAM uses, so presets saved in either app appear in both. |
| `jobline.presets.sharedFolders` | `[]` | Extra folders of `.jblmachine` files to offer, e.g. a shop network share that jobline.ai-CAM also points at. |
| `jobline.presets.warnOnMismatch` | `true` | Offer to switch machine when a program uses features the active machine preset does not have (turning codes on a mill, rotary axes on a 3-axis, a robot program on a CNC). |
| `jobline.revpack.autoDetect` | `true` | When a G-code program opens in the visualizer, load revpack.json from the same folder (or a parent revpack/ folder) and take stock, workholding, work offsets, tools and machine from it. Correlation findings appear in the Problems panel. |
| `jobline.cam.watchFolders` | `[]` | Folders your CAM posts NC programs into. JobLine offers to open new programs and link their setup sheets. File-based only: no connection to the CAM application. |
| `jobline.cam.autoLinkSetupSheets` | `true` | When a program opens, link a setup sheet (HTML, XML or CSV) with the same name in the same folder, so its tool list feeds the tool checks. |

_21 settings, generated from package.json for v0.3.14._

<!-- settings:end -->

## Supported files

Opened as G-code automatically: `.nc .gcode .ngc .tap .cnc .g .min .prg .mpf .spf .eia .iso .ncc .ncp .ncf .nc1 .5ax .fgc .dnc .apt .cls .cyc .tab .ptp .src .sub .lib .cmx` (any case), plus any file whose first line looks like a program (`%`, `O1234`, `N10 G..`). Fanuc Robot: `.ls .tp`. ABB RAPID: `.mod .pgf`. Machine presets: `.jblmachine`. Add shop-specific extensions with `jobline.additionalExtensions`.

## Known issues

- **Robot programs are basic.** Fanuc TP and ABB RAPID files get a language mode, highlighting from the shared G-code grammar, and control/preset checks. Hover cards, diagnostics, the sidebar, and the visualizer are built for G-code and do not model robot instructions or kinematics yet.
- **Playback is step-based.** Smooth time-based G00/G01 interpolation is not done yet. Material removal is computed only for RevPack setups the shared kernel cuts (the Compare view). Collision and grip checks run against the RevPack's envelope solids; the jaw teeth, spindle and counterbores are drawn for recognition only. It is a review aid, not collision certification.
- Reported visual bugs still open: cutting color can stay green during air rapids, and tool size may not reset when switching between large and small programs.
- N-numbers are not maintained automatically while you type. Use the Toolbox insert / remove / renumber commands.
- Dialect coverage varies. Controller-specific cycles, macro and subprogram execution, and rotary motion need broader coverage; generic ISO tests do not certify every control.
- Fusion F3D import gives stock, model dimensions, and setup metadata, not a full reconstruction of the CAD solid. Parasolid targets are shown as a bounds envelope.
- Choosing the **Okuma** control applies lathe conventions (turret T-words, turning review rules) even to Okuma mill programs. Use the Fanuc control for Okuma machining centers for now.
- `.mod` is also used by other languages. If another extension claims it, use **Change Language Mode > ABB RAPID**.
- Per-control rules check syntax and structure, not execution: macros and subprograms are not run, and cycle parameters are checked for presence, not machine limits. Tests use JobLine-written fixtures, not programs certified on each control.
- Machine connectivity / DNC transfer is not included.

## Roadmap

Shipped so far: diagnostics and Validate Program (0.2), formatter (0.3), M98 subprogram navigation, the 3D visualizer with STL / STEP / Fusion imports, the Toolbox, probing and macro views, machine presets, tap drill checks (0.3.13), and RevPack setups with the Makro-Grip vise, per-object display, named collision / grip warnings and Part to origin / Set WCS (0.3.14).

Next:

- Smooth linear playback and fixes for the open visualizer bugs above, with rendered regression tests
- Automatic N-number maintenance
- Broader controller-specific cycle, macro/subprogram, rotary, and robot coverage
- Optional JobLine sign-in to link activity to a free talent profile
- Send a reviewed program and tool list to a JobLine shop job or work order, with revision and sender recorded
- Machine Connect: controlled program transfer and shop-floor feedback (planned, not started in this extension)

## Feedback

Report problems on [GitHub Issues](https://github.com/WeCr8-Solutions/jobline.ai-g-code/issues). Include the extension version, control and machine type, units, a short NC example, what you expected, and a screenshot for visual problems.

- [Changelog](https://github.com/WeCr8-Solutions/jobline.ai-g-code/blob/main/CHANGELOG.md)
- [Source and contributor setup](https://github.com/WeCr8-Solutions/jobline.ai-g-code/blob/main/SETUP.md)
- [Test coverage and known gaps](https://github.com/WeCr8-Solutions/jobline.ai-g-code/blob/main/docs/testing/USER_FEEDBACK_MATRIX.md)

Set `jobline.ui.showLinks` to `false` to hide the optional JobLine links in the sidebar and hover cards. Built by **WeCr8 Solutions, LLC**. Extension code is MIT-licensed; bundled dependencies (three.js, OpenCascade / occt-import-js, fzstd) keep their own licenses.
