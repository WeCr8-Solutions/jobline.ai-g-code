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
- <sup>6</sup> Since 0.3.14: RevPack v2 loads target, stock, workholding, tools and machine. STEP targets go through OpenCascade and are cross-checked against the paired STL. Its AR4 real-part checks compare STEP and STL digests from local, gitignored Annin AR4 files.
- <sup>7</sup> Development harness only (`npm run visualizer:harness:revpack`), not a user command.

### G-code and control dialects

JobLine's equivalent of a CAD reader: the program formats the extension opens, checks and explains. Any G-code file also gets highlighting, the toolpath visualizer, the explainer and the Toolbox edits.

| Control | Program files | Models named in the app | Read | Validate | Post | Dialect-specific parsing |
|---|---|---|:---:|:---:|:---:|---|
| **Fanuc** | \*.nc, \*.tap, \*.sub, \*.lib | 0i / 30i / 31i | ✓ | ✓<sup>8</sup> | <sup>9</sup> | Macro B variables and expressions. Since 0.3.14: Fanuc G list, variable ranges, WHILE/DO/END and GOTO targets, O-number and M-per-block limits |
| **Haas** | \*.nc, \*.5ax, \*.ncc, \*.ncp, \*.ncf, \*.nc1 | NGC | ✓ | ✓<sup>8</sup> | <sup>9</sup> | Fanuc-style; Haas Classic not separate. Since 0.3.14: Haas G list (G47, G150, G187, G234…), M97 P→N targets, 5-digit O |
| **Siemens Sinumerik** | \*.mpf, \*.spf | 840D / 828D | ✓ | ✓<sup>8</sup> | <sup>9</sup> | CYCLExx, MCALL, HOLES1/2, POCKET1–4, SLOT1/2, LONGHOLE, SWIVEL; R-parameters. Since 0.3.14: DEF placement, IF/WHILE/FOR/LOOP/REPEAT pairing, GOTOF/GOTOB labels, R range, MCALL left on, ISO-isms, G291/G290 |
| **Okuma OSP** | \*.min, \*.prg | OSP-P | ✓ | ✓<sup>8</sup> | <sup>9</sup> | $ program headers, #V variables, CALL OBn; lathe detection. Since 0.3.14: V-not-# variables, G56 tool length, N-label jumps, RTS on called subs |
| **Mazak** | \*.eia, \*.iso | Smooth / Matrix (EIA/ISO) | ✓ | ✓<sup>8</sup> | <sup>9</sup> | EIA/ISO G-code only. Since 0.3.14: Mazak G list, 8-digit O; Mazatrol detected and skipped, not read |
| **Fadal** | \*.fgc | Format 2 | ✓ | ✓<sup>8</sup> | <sup>9</sup> | Since 0.3.14: Fadal macros (#V1=…, #IF … THEN GOTO :LABEL), V1–V100, label targets |
| **Generic / LinuxCNC** | \*.gcode, \*.ngc, \*.g, \*.cnc, \*.dnc | — | ✓ | ✓<sup>8</sup> | <sup>9</sup> | Since 0.3.14: O-word sub/if/while/repeat structure and call targets |
| **Heidenhain TNC** | \*.h (Klartext), \*.i (ISO; add .i under JobLine additional extensions), \*.cyc, \*.tab | Klartext / ISO | ✓<sup>10</sup> | ✓<sup>10</sup> | <sup>9</sup> | Since 0.3.14: Klartext BEGIN/END PGM, block numbers, TOOL CALL axis, L/C/CC/CR, Q0–Q1999, LBL / CALL LBL; ISO %name G71 header and footer. Released 0.3.12: family name only |
| **Mitsubishi** | \*.nc | M8 / M80 | ✓ | ✓<sup>10</sup> | <sup>9</sup> | Since 0.3.14: Mitsubishi G list (G66.1, G120.1…), variable ranges, up to 4 M per block. Released 0.3.12: family name only |
| **Fanuc Robot** | \*.ls, \*.tp | TP / LS | ✓<sup>11</sup> |  |  | Language and control entry; no robot kinematics |
| **ABB RAPID** | \*.mod, \*.pgf | RAPID | ✓<sup>11</sup> |  |  | Language and control entry; no robot kinematics |
| **KUKA KRL / CL data** | \*.src, \*.ptp, \*.apt, \*.cls | — | <sup>12</sup> |  |  | Opened as G-code; KRL and CL/APT are not interpreted |

- <sup>8</sup> Released 0.3.12: one generic ISO/Fanuc-style rule set for every control (canned-cycle Z/R/Q, arc validity, spindle and coolant at program end, axis travel against the machine preset). Since 0.3.14: each control also gets its own rule set, listed per row; unknown G-codes are information only because options differ by machine. Rules check syntax and structure, not execution, and are tested on JobLine-written fixtures, not certified on each control.
- <sup>9</sup> No CAM post-processor; posting is in jobline.ai-CAM (Haas NGC mill). Since 0.3.14: **Convert Program to Another Control** rewrites common codes from ISO dialects to Haas, Mazak, Mitsubishi, Siemens 840D (G81/G82 → CYCLE81/82, G43 → D), Okuma OSP (G54 → G15 H, G43 → G56) and Heidenhain Klartext (L/C/CR, G81–G83 → CYCL DEF 200). Macros, tapping/boring cycles and anything else it can't map are left as `JL MANUAL` comments. Converting from Siemens, Okuma or Heidenhain is not supported.
- <sup>10</sup> Since 0.3.14, Heidenhain and Mitsubishi are offered in **Select CNC / Robot Control Type** and validated. Klartext programs skip the ISO rules. \*.h is already treated as G-code by file name; `0 BEGIN PGM` is recognised as a G-code first line.
- <sup>11</sup> Syntax highlighting (shared G-code grammar) and a control entry for preset matching only.
- <sup>12</sup> Registered as G-code extensions, so they get highlighting and the generic G-code reader only.

### Tool libraries and CAM output (in 0.3.14)

Since 0.3.14. Imported tools feed the Tools view and the checks: tools not in the library, T/H and T/D register mismatches, comment diameter vs library diameter.

| Source | Format | Fields read | Read | Write | Linked to program | Status |
|---|---|---|:---:|:---:|:---:|---|
| **Fusion tool library** | \*.json, \*.tools | T, H, D, DC, LCF, gauge length / LB, OAL, RE, unit | ✓<sup>13</sup> |  | ✓ | Since 0.3.14 |
| **HSMWorks / Inventor CAM** | \*.hsmlib (UTF-16 XML) | nc number, length / diameter offset, body diameter, flute, body and overall length, corner radius | ✓<sup>13</sup> |  | ✓ | Since 0.3.14 |
| **Generic tool list** | \*.csv, \*.tsv | T, H, D, diameter, flute length, gauge length, description (common spellings, Fusion CSV headers) | ✓<sup>13</sup> |  | ✓ | Since 0.3.14 |
| **CAM setup sheets** | \*.html, \*.htm, \*.xml, \*.csv | Tool tables from ESPRIT, Mastercam, Fusion, GibbsCAM and similar sheets (column or per-tool layout) | ✓<sup>14</sup> |  | ✓<sup>14</sup> | Since 0.3.14 |
| **Posted NC header** | Program comments | CAM system name; tool list comments (Mastercam, Fusion style) | ✓<sup>14</sup> |  | ✓ | Since 0.3.14 |
| **Live CAM session / native CAM files** | \*.esp, \*.mcam, \*.vnc, .f3d toolpaths | — |  |  |  | Not built<sup>15</sup> |

- <sup>13</sup> Holders and probes are skipped. Tools with no number, and duplicate numbers (vendor catalogues often leave every tool at 1), are listed instead of imported.
- <sup>14</sup> A sheet with the program's name in the same folder (1001.html, 1001_setup.xml, Setup Sheet 1001.htm) links automatically; otherwise the post's header tool list is used. Fixtures are written in the usual template shape, not real vendor exports; setup-sheet templates are user-editable, so real sheets may need new column names.
- <sup>15</sup> A live link or native file reading needs each vendor's licensed SDK (ESPRIT API, Mastercam NET-Hook, GibbsCAM SDK, Fusion API inside Fusion, NX Open). Not possible from a VS Code extension without them.

> ⚠ **Not in the 0.3.12 release: tool-library import, CAM output integrations, per-control validation and dialect conversion are in 0.3.14 (not merged). No live CAM connection is planned without vendor SDKs. DXF, IGES, SolidWorks and other native CAD formats are not read.**

---

_JobLine G-Code for VS Code 0.3.12 · WeCr8-Solutions/jobline.ai-g-code main @ 255cd67 · October 15, 2026 · WeCr8 Solutions, LLC_  
_PDF rendering: `CAD_READERS.pdf` in this folder._
