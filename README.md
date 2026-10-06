# JobLine G-Code Intelligence

G-code editing, program inspection, and 3D toolpath review in VS Code, built by **WeCr8 Solutions, LLC**.

**Current package: 0.3.12.** Includes live diagnostics, formatting, a machining toolbox, plain-language explanations, and a visualizer with stock, tools, fixtures, and target models. See [release notes](CHANGELOG.md).

## Get started

Requires **VS Code 1.85 or newer**. To install a local release, run **Extensions: Install from VSIX...** and select `jobline-gcode-0.3.12.vsix`.

1. Open an NC program, such as a `.nc`, `.gcode`, `.ngc`, `.tap`, or `.cnc` file.
2. Run **JobLine: Select CNC / Robot Control Type** and **JobLine: Select Machine Type** to match the program.
3. Open the **JobLine** Activity Bar panel to inspect operations, tools, offsets, cycles, probing, macros, and warnings.
4. Run **Show Toolpath Visualizer** or **JobLine: Open Simulation Full Window** to review the path.
5. Use **JobLine: Format G-Code** or the **JobLine Toolbox** commands to edit the program.

Additional built-in file associations are listed in [package.json](package.json). Use `jobline.additionalExtensions` for shop-specific extensions.

## Current features

| Area | Available behavior |
| --- | --- |
| Editor | Syntax highlighting, reference hover cards, formatting, and live diagnostics |
| Inspection | Operations, tools, work offsets, canned cycles, probing, macro/control-flow views, and plain-language explanations |
| Toolbox | Insert/remove/renumber N-lines; comment and block-skip edits; feed/spindle scaling; axis shifts; program header/end helpers |
| Toolpath | Linear and circular paths, G17/G18/G19 planes, G20/G21 units, G90/G91 coordinates, playback/step/seek controls, and source-line navigation |
| Scene | Stock settings, tool/holder visuals, multiple model roles, camera presets, visibility, opacity, and color controls |
| Imports | STL geometry, tessellated STEP target geometry, and Fusion F3D setup metadata/model dimensional reference |
| Repository tools | G-code review, fixture review, and manufacturing-pipeline checks |

CNC control choices are **Fanuc, Haas, Siemens, Mazak, and Okuma**. **Fanuc Robot TP/LS** and **ABB RAPID** also have language/control entries. Coverage varies by dialect and program type; these entries do not imply complete controller emulation or robot kinematics.

The sidebar includes Operations, Tools, Offsets, Canned Cycles, Probing, Macros & Flow, Toolbox, Alarms & Warnings, Commands, and Visualizer Settings.

## Visualizer and imports

Use **G-Code: Import Target Model** to add reference geometry. Scene roles distinguish target parts, fixtures, jaws, holders, and tools. Fusion setup import supplies stock/model dimensions and setup metadata; its dimensional reference is not a complete reconstruction of the CAD solid. STEP imports use a bundled OpenCascade JavaScript/WebAssembly runtime.

Version 0.3.12 fixes full-circle G02/G03 moves whose endpoints are omitted and preserves milling G73 X coordinates instead of treating them as lathe diameters. The motion regression matrix covers three planes, both unit systems, absolute/incremental coordinates, and circle diameters of 2 and 1.25.

Playback is available, but smooth time-based G00/G01 interpolation remains open work. Rendering a path does not establish that a pocket or hole has been accurately simulated as removed material.

## Common commands

Open the Command Palette and search for **JobLine**, **G-Code**, or **Toolpath**.

| Command | Purpose |
| --- | --- |
| JobLine: Select CNC / Robot Control Type | Choose the control dialect |
| JobLine: Select Machine Type | Choose mill, lathe, mill-turn, or grinder |
| JobLine: Format G-Code | Format the active program |
| JobLine: Open Plain Language Explanation | Explain program operations |
| Show Toolpath Visualizer | Open the 3D view |
| G-Code: Open Program in Visualizer | Select a program for review |
| G-Code: Import Target Model | Import reference geometry |
| G-Code: Play / Pause / Stop | Control playback |
| G-Code: Step Forward / Step Back / Jump to Line | Navigate the path |
| JobLine Toolbox: Insert Line Numbers / Remove Line Numbers / Renumber Lines | Apply explicit numbering edits |

**JobLine: Validate Program still displays a placeholder message.** Diagnostics run through the live diagnostic provider; the command is not an additional verification gate.

## Settings

Find these under **Settings → JobLine G-Code**.

| Setting | Default | Purpose |
| --- | --- | --- |
| `jobline.controlType` | `fanuc` | CNC or robot dialect |
| `jobline.machineType` | `mill` | Machine profile |
| `jobline.units` | `inch` | Default units; G20/G21 can override |
| `jobline.additionalExtensions` | `[]` | Extra G-code file extensions |
| `jobline.validation.enableSafetyChecks` | `true` | Enable safety-related diagnostic rules |
| `jobline.validation.enableArcValidation` | `true` | Check arc geometry |
| `jobline.validation.arcTolerance` | `0.001` | Arc tolerance in current units |
| `jobline.formatter.wordSpacing` | `true` | Separate words with spaces |
| `jobline.formatter.decimalPlaces` | `null` | Preserve decimals unless configured |
| `jobline.formatter.uppercaseGM` | `true` | Uppercase G/M codes |

## Known limitations and next work

- Automatic N-number maintenance while typing is not integrated. Explicit insert/remove/renumber commands are available.
- Reported persistent green cutting color during air rapids and tool-size reset after switching large/small programs still need targeted fixes and rendered regression tests.
- Smooth linear playback and cutout/material-removal accuracy remain under development.
- Controller-specific cycles, macro/subprogram execution, rotary motion, and robot motion need broader coverage. Generic ISO tests do not certify every dialect.
- Machine connectivity/DNC remains planning work, not a shipped transfer feature.

The preview and diagnostics support program review; they are not machine collision certification.

## Development and verification

See [SETUP.md](SETUP.md) for installation, debugging, test commands, and packaging. The [feedback matrix](docs/testing/USER_FEEDBACK_MATRIX.md) distinguishes parser checks from rendered behavior and remaining gaps.

For the 0.3.12 working tree verified on **2026-10-06**, `npm run test:all` passed, including the 75-case motion matrix; the rendered extension smoke suite passed 15 tests. The VSIX check exercised STEP tessellation and visualizer rendering at desktop and narrow widths. These results cover those fixtures, not every machine or reported issue.

## Feedback and project information

Report problems through [GitHub Issues](https://github.com/WeCr8-Solutions/jobline.ai-g-code/issues). Include the extension version, controller and machine type, units, a minimal NC example, expected behavior, and a screenshot or recording for visual problems. Include relevant model/tool dimensions for import or sizing problems.

- [Changelog](CHANGELOG.md)
- [Contributor setup](SETUP.md)
- [Current test coverage and gaps](docs/testing/USER_FEEDBACK_MATRIX.md)
- [Integration review](docs/JOBLINE_INTEGRATION_REVIEW.md)

Extension code is MIT-licensed; bundled dependencies retain their own licenses. The STEP runtime includes OpenCascade/occt-import-js license notices.
