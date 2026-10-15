# CAD Readers and Data Exchange

## As of JobLine G-Code for VS Code 0.3.12

### Models and setup data

| CAD System / Data | Format | Version | Read | Write | Feature / Data Exchange | Sketch / 2D Data |
|---|---|---|:---:|:---:|:---:|:---:|
| **STEP** | \*.stp, \*.step | AP203 / AP214 / AP242 (ISO 10303-21) | ✓<sup>1</sup> |  |  |  |
| **STL** | \*.stl | ASCII and binary | ✓ |  |  |  |
| **Parasolid (text)** | \*.x_t, \*.xmt_txt, \*.xmt | Text transmit files | ✓<sup>2</sup> |  |  |  |
| **Parasolid (binary)** | \*.x_b | — | <sup>3</sup> |  |  |  |
| **Autodesk Fusion setup** | \*.f3d | Fusion archive (ZIP) | ✓<sup>4</sup> |  | ✓<sup>4</sup> |  |
| **JobLine machine** | \*.jblmachine (JSON) | Format 1.0 | ✓ | ✓ | ✓<sup>5</sup> |  |
| **RevPack** | revpack.json | `jobline.revpack/2` | <sup>6</sup> |  | <sup>6</sup> |  |
| **RevPack (v1 manifest)** | manifest JSON | v1 (gcode + goal models) | <sup>7</sup> |  |  |  |
| **Lathe insert codes** | ISO designation | Shapes C, D, R, S, T, V, W | ✓ |  |  |  |

- <sup>1</sup> Tessellated through OpenCascade (occt-import-js 0.0.23, at most 300,000 triangles) and shown as a scene or target model. The schema name comes from FILE_SCHEMA. Features, PMI and assembly structure are not read.
- <sup>2</sup> Bounds only: every 3D point in the file is collected and the bounding envelope is drawn. Surfaces are not rebuilt.
- <sup>3</sup> The import dialog lists \*.x_b, but the file is read as text, so binary Parasolid is not decoded. Treat it as not supported and export \*.x_t or STEP.
- <sup>4</sup> Reads the active setup's stock size and allowances, work offset, WCS orientation and origin, operation names, the model envelope and the preview PNG. The solid model and toolpaths are not read.
- <sup>5</sup> `.jblmachine` is byte-identical in the extension, jobline.ai-CAM and the JobLine.ai platform (`src/presets/jblMachine.ts`), so a machine exported from one opens in the others.
- <sup>6</sup> In draft PR #7, not released (0.3.14 on that branch): RevPack v2 loads target, stock, workholding, tools and machine. STEP targets go through OpenCascade and are cross-checked against the paired STL. Its AR4 real-part checks compare STEP and STL digests from local, gitignored Annin AR4 files.
- <sup>7</sup> Development harness only (`npm run visualizer:harness:revpack`), not a user command.

### G-code and control dialects

JobLine's equivalent of a CAD reader: the program formats the extension opens, checks and explains. Any G-code file also gets highlighting, the toolpath visualizer, the explainer and the Toolbox edits.

| Control | Program files | Models named in the app | Read | Validate | Post | Dialect-specific parsing |
|---|---|---|:---:|:---:|:---:|---|
| **Fanuc** | \*.nc, \*.tap, \*.sub, \*.lib | 0i / 30i / 31i | ✓ | ✓<sup>8</sup> | <sup>9</sup> | Macro B variables and expressions (common #100–#999, system #1000+ read-only) |
| **Haas** | \*.nc, \*.5ax, \*.ncc, \*.ncp, \*.ncf, \*.nc1 | NGC | ✓ | ✓<sup>8</sup> | <sup>9</sup> | Fanuc-style. Haas Classic is not handled separately |
| **Siemens Sinumerik** | \*.mpf, \*.spf | 840D / 828D | ✓ | ✓<sup>8</sup> | <sup>9</sup> | CYCLExx, MCALL, HOLES1/2, POCKET1–4, SLOT1/2, LONGHOLE, SWIVEL; R-parameters |
| **Okuma OSP** | \*.min, \*.prg | OSP-P | ✓ | ✓<sup>8</sup> | <sup>9</sup> | $ program headers, #V variables, CALL OBn; lathe detection |
| **Mazak** | \*.eia, \*.iso | Smooth / Matrix (EIA/ISO) | ✓ | ✓<sup>8</sup> | <sup>9</sup> | EIA/ISO G-code only. Mazatrol conversational is not read |
| **Fadal** | \*.fgc | — | ✓ | ✓<sup>8</sup> | <sup>9</sup> | Generic rules |
| **Generic / LinuxCNC** | \*.gcode, \*.ngc, \*.g, \*.cnc, \*.dnc | — | ✓ | ✓<sup>8</sup> | <sup>9</sup> | Generic rules |
| **Heidenhain TNC** | \*.cyc, \*.tab | — | <sup>10</sup> |  |  | Control family recognised in .jblmachine only; Klartext not parsed |
| **Mitsubishi** | — | — | <sup>10</sup> |  |  | Control family recognised in .jblmachine only |
| **Fanuc Robot** | \*.ls, \*.tp | TP / LS | ✓<sup>11</sup> |  |  | Language and control entry; no robot kinematics |
| **ABB RAPID** | \*.mod, \*.pgf | RAPID | ✓<sup>11</sup> |  |  | Language and control entry; no robot kinematics |
| **KUKA KRL / CL data** | \*.src, \*.ptp, \*.apt, \*.cls | — | <sup>12</sup> |  |  | Opened as G-code; KRL and CL/APT are not interpreted |

- <sup>8</sup> One generic ISO/Fanuc-style rule set for every control: canned-cycle Z/R/Q, arc validity, spindle and coolant still on at program end, and axis travel against the active machine preset. The chosen dialect changes tokenising, explanations and lathe detection. Generic tests don't certify every dialect.
- <sup>9</sup> The extension has no post-processor. It edits existing programs (formatter, renumbering, feed/speed scaling, axis shifts, safety header). Posting is in jobline.ai-CAM (Haas NGC mill).
- <sup>10</sup> Listed in the shared control-family list but not offered in **Select CNC / Robot Control Type*\*. \*.h / \*.hpp appear in `fileTypes.ts` but not in the language contribution.
- <sup>11</sup> Syntax highlighting (shared G-code grammar) and a control entry for preset matching only.
- <sup>12</sup> Registered as G-code extensions, so they get highlighting and the generic G-code reader only.

> ⚠ **Not in this release: tool-library import (JSON/CSV) and CAM connections (ESPRIT, Mastercam, GibbsCAM, Hexagon, Fusion API, Cura). Those classes are stubs that return nothing. DXF, IGES, SolidWorks and other native CAD formats are not read.**

---

_JobLine G-Code for VS Code 0.3.12 · WeCr8-Solutions/jobline.ai-g-code main @ 255cd67 · October 15, 2026 · WeCr8 Solutions, LLC_  
_PDF rendering: `CAD_READERS.pdf` in this folder._
