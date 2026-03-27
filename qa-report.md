# JobLine QA Report

**Date:** 2026-03-27T19:47:55.619Z
**Model:** qwen2.5-coder:7b  **Ollama:** http://localhost:11434
**Duration:** 70.8s
**Overall:** ❌ FAIL

---

## Build & Test Steps

### ✅ TypeScript compile

```
> jobline-gcode@0.3.0 precompile
> npm run lint


> jobline-gcode@0.3.0 lint
> eslint src --ext ts


> jobline-gcode@0.3.0 compile
> tsc -p ./
```

### ✅ Parser unit tests (56 suites)

```
> jobline-gcode@0.3.0 test
> node -e "require('ts-node').register({transpileOnly:true,compilerOptions:{module:'commonjs',target:'ES2020',esModuleInterop:true,resolveJsonModule:true,strict:false}});require('./test/parser.test.ts');"

▶ Tokenizer: G-codes
  ✔ G01 (1.5112ms)
  ✔ G0 (no leading zero) (0.2762ms)
  ✔ G54.1 sub-code (0.1289ms)
  ✔ multiple G-codes on one line (0.1422ms)
  ✔ G83 with all params yields >=6 address tokens (0.1089ms)
✔ Tokenizer: G-codes (2.7428ms)
▶ Tokenizer: M-codes
  ✔ M03 (0.139ms)
  ✔ M06 (0.1474ms)
✔ Tokenizer: M-codes (0.3736ms)
▶ Tokenizer: addresses
  ✔ positive X1.5 (0.2959ms)
  ✔ negative Z-1.25 (0.0873ms)
  ✔ trailing decimal Z1. (0.1284ms)
  ✔ missing leading zero X.5 (0.0728ms)
  ✔ tool number T12 (0.1068ms)
✔ Tokenizer: addresses (0.8293ms)
▶ Tokenizer: comments
  ✔ parenthesized comment-only line (0.1261ms)
  ✔ semicolon comment-only line (0.0472ms)
  ✔ inline comment preserves addresses after it (0.0899ms)
  ✔ empty line (0.0315ms)
✔ Tokenizer: comments (0.358ms)
▶ Tokenizer: program structure
  ✔ % delimiter (0.0603ms)
  ✔ O-number (0.0645ms)
  ✔ Okuma $-number (0.0462ms)
  ✔ N-line number (0.0699ms)
  ✔ block skip / (0.0749ms)
✔ Tokenizer: program structure (0.4104ms)
▶ Tokenizer: Macro B
  ✔ variable address Z#5 is unresolved (0.1274ms)
  ✔ expression address Z[#1 + 0.5] (0.255ms)
  ✔ IF keyword (0.1324ms)
  ✔ WHILE keyword (0.0692ms)
✔ Tokenizer: Macro B (0.6529ms)
▶ Tokenizer: Siemens
  ✔ CYCLE83 token (0.0783ms)
  ✔ CYCLE83 positional params parsed (0.1908ms)
✔ Tokenizer: Siemens (0.3263ms)
▶ Tokenizer: Okuma
  ✔ CALL OB1 token (0.0664ms)
✔ Tokenizer: Okuma (0.0961ms)
▶ Fixture: fanuc/drill-pattern.nc
  ✔ tokenizes every non-empty line (0.3923ms)
✔ Fixture: fanuc/drill-pattern.nc (0.4272ms)
▶ Fixture: fanuc/macro-bolt-circle.nc
  ✔ tokenizes and finds macro variables (0.4789ms)
✔ Fixture: fanuc/macro-bolt-circle.nc (0.5224ms)
▶ Fixture: siemens/cycle83-drill.nc
  ✔ finds CYCLE83 token (0.2668ms)
✔ Fixture: siemens/cycle
```

### ✅ Diagnostics engine tests

```
▶ Diagnostics: clean programs produce no noise
  ✔ clean-mill.nc → 0 diagnostics (3.3363ms)
  ✔ arc-valid.nc → 0 diagnostics (full circle with valid I,J) (0.4427ms)
✔ Diagnostics: clean programs produce no noise (4.2659ms)
▶ Diagnostics: canned cycle — missing Z
  ✔ fires exactly 1 error (0.3683ms)
  ✔ error message mentions Z (0.3387ms)
  ✔ no warnings generated (0.3321ms)
✔ Diagnostics: canned cycle — missing Z (1.1725ms)
▶ Diagnostics: canned cycle — missing R
  ✔ fires exactly 1 error (0.3484ms)
  ✔ error message mentions R (0.3215ms)
  ✔ no warnings generated (0.3653ms)
✔ Diagnostics: canned cycle — missing R (2.211ms)
▶ Diagnostics: G83 peck cycle — missing Q
  ✔ fires exactly 1 error (0.4157ms)
  ✔ error message mentions Q (0.3161ms)
  ✔ error message identifies G83 (0.2432ms)
  ✔ no warnings generated (0.2054ms)
✔ Diagnostics: G83 peck cycle — missing Q (1.2826ms)
▶ Diagnostics: G84 tap cycle — missing F
  ✔ fires exactly 1 error (0.3522ms)
  ✔ error message mentions F (0.242ms)
  ✔ error message identifies G84 (0.2844ms)
✔ Diagnostics: G84 tap cycle — missing F (0.9555ms)
▶ Diagnostics: safety — M06 without safe-Z retract
  ✔ fires exactly 1 warning (0.4003ms)
  ✔ warning message mentions unsafe tool change (0.2762ms)
  ✔ no errors generated (safety rule is warning, not error) (0.2594ms)
✔ Diagnostics: safety — M06 without safe-Z retract (1.0053ms)
▶ Diagnostics: safety — spindle running at M30
  ✔ fires exactly 1 warning (0.26ms)
  ✔ warning message mentions spindle (0.2256ms)
  ✔ no errors generated (0.2356ms)
✔ Diagnostics: safety — spindle running at M30 (0.7921ms)
▶ Diagnostics: safety — coolant on at M30
  ✔ fires exactly 1 warning (0.2861ms)
  ✔ warning message mentions coolant (0.2271ms)
  ✔ no errors generated (0.2678ms)
✔ Diagnostics: safety — coolant on at M30 (0.8432ms)
▶ Diagnostics: arc geometry — center-offset radius mismatch
  ✔ fires exactly 1 error (0.3435ms)
  ✔ error message mentions radius error (0.3161ms)
  ✔ reports radius error > 0.0
```

---

## Ollama QWEN Domain Reviews

### ✅ `test\fixtures\diagnostics\arc-mismatch.nc`

**Diagnostics:** 1 error(s), 0 warning(s)

| Line | Severity | Message |
|------|----------|---------|
| 15 | error | Arc endpoint doesn't match center offset (radius error: 0.381966) |

**QWEN Review:**

**TRUE POSITIVES:**
- Line 15 [ERROR]: Arc endpoint doesn't match center offset (radius error: 0.381966)

**FALSE POSITIVES:**
- None identified.

**MISSED ISSUES:**
- The program does not include a check for the tool's maximum allowable deviation from the programmed path, which could lead to potential collisions or damage if the actual path deviates significantly.
- There is no verification of the tool's wear and tear status, which could affect the accuracy of the machining process.

**QUALITY SCORE:** 8/10

**NOTES:**
- For aerospace/high-value machining, it is crucial to ensure that the tool does not exceed its maximum allowable deviation from the programmed path. This can be addressed by implementing a toolpath verification step before actual machining.
- Regular checks of the tool's wear and tear status are essential to maintain consistent quality and prevent potential failures during production.

---

### ✅ `test\fixtures\diagnostics\arc-valid.nc`

**Diagnostics:** 0 error(s), 0 warning(s)

**QWEN Review:**

**TRUE POSITIVES:** None. The diagnostics report this program as clean, which is correct based on the G-code provided.

**FALSE POSITIVES:** None. There are no diagnostics that incorrectly flag issues in the program.

**MISSED ISSUES:** 
1. Lack of toolpath verification: The program does not include any checks to ensure the toolpath is within the machine's physical limits or avoids collisions with fixtures, which could be critical for aerospace parts.
2. No collision detection: There are no G-code commands like `G43` (tool length offset) that might indicate a need for collision detection during the machining process.

**QUALITY SCORE:** 5/10

**NOTES:** For aerospace/high-value machining, it is crucial to have thorough toolpath verification and collision detection. The absence of these checks in this program could lead to significant safety risks and potential damage to both the machine and the workpiece.

---

### ✅ `test\fixtures\diagnostics\clean-mill.nc`

**Diagnostics:** 0 error(s), 0 warning(s)

**QWEN Review:**

**TRUE POSITIVES:** None. The diagnostics report this program as clean, which is correct based on the G-code provided.

**FALSE POSITIVES:** None. There are no diagnostics that incorrectly flag the program as problematic.

**MISSED ISSUES:** 
1. **Toolpath Overhang:** The tool path overhangs the part at X=2.0, Y=1.0, which could lead to potential collisions or damage if not properly managed.
2. **Spindle Speed Change:** There is a significant change in spindle speed from 3000 RPM to 5000 RPM without proper acceleration/deceleration, which could cause vibration and potentially damage the part or tool.

**QUALITY SCORE:** 8/10

**NOTES:** For aerospace/high-value machining, it's crucial to ensure that toolpaths do not overhang parts to prevent collisions. Additionally, spindle speed changes should be gradual to avoid vibrations and potential damage.

---

### ✅ `test\fixtures\diagnostics\coolant-at-m30.nc`

**Diagnostics:** 0 error(s), 1 warning(s)

| Line | Severity | Message |
|------|----------|---------|
| 16 | warning | Coolant may still be on at program end |

**QWEN Review:**

**TRUE POSITIVES:**
- Line 16 [WARNING]: Coolant may still be on at program end

**FALSE POSITIVES:**
- None identified.

**MISSED ISSUES:**
- The G-code does not include a coolant stop command (M09) before the M30 end-of-program command. This could lead to coolant leakage or damage to the machine and workpiece if left on.

**QUALITY SCORE:** 8/10

**NOTES:** 
- Ensure that all coolant-related commands are properly included in your G-code, especially for aerospace/high-value machining where precision and safety are paramount.

---

### ✅ `test\fixtures\diagnostics\cycle-missing-r.nc`

**Diagnostics:** 1 error(s), 0 warning(s)

| Line | Severity | Message |
|------|----------|---------|
| 10 | error | Canned cycle requires R (R-plane) |

**QWEN Review:**

**TRUE POSITIVES:**
- Line 10 [ERROR]: Canned cycle requires R (R-plane)

**FALSE POSITIVES:**
- None identified.

**MISSED ISSUES:**
- The program does not include a `G82` canned cycle, which is commonly used for drilling operations. This could lead to potential safety issues if the intention was to perform a peck drilling operation.
- The tool path defined by `G81 X1.0 Y1.0 Z-0.5 F10.0` does not specify an R value, which is required for the G81 canned cycle.

**QUALITY SCORE:** 7/10

**NOTES:**
- Ensure that all canned cycles used in aerospace/high-value machining include necessary parameters such as `R`.
- Verify that the tool path definitions are complete and correct to prevent potential safety hazards.

---

### ✅ `test\fixtures\diagnostics\cycle-missing-z.nc`

**Diagnostics:** 1 error(s), 0 warning(s)

| Line | Severity | Message |
|------|----------|---------|
| 10 | error | Canned cycle requires Z (depth) |

**QWEN Review:**

**TRUE POSITIVES:**
- Line 10 [ERROR]: Canned cycle requires Z (depth)

**FALSE POSITIVES:**
- None identified.

**MISSED ISSUES:**
- The program does not include a dwell time after the tool reaches the specified depth in the canned cycle (G81). This could lead to rapid retraction and potential damage if the workpiece is not fully engaged.
- There is no check for proper coolant flow before starting the spindle, which is crucial in aerospace/high-value machining to prevent overheating or material deformation.

**QUALITY SCORE:** 7/10

**NOTES:**
- Ensure that all canned cycles include a dwell time to allow sufficient engagement with the workpiece.
- Verify that coolant flow is properly monitored and controlled before starting the spindle.

---

### ✅ `test\fixtures\diagnostics\peck-missing-q.nc`

**Diagnostics:** 1 error(s), 0 warning(s)

| Line | Severity | Message |
|------|----------|---------|
| 10 | error | G83 peck cycle requires Q (peck depth) |

**QWEN Review:**

**TRUE POSITIVES:**
- Line 10 [ERROR]: G83 peck cycle requires Q (peck depth)

**FALSE POSITIVES:**
- None identified.

**MISSED ISSUES:**
- The program does not include a tool length offset check before the peck cycle starts. This could lead to incorrect cutting depths if the tool has changed since the last setup.
- There is no verification of the spindle speed or direction, which could be critical for safety in aerospace applications.

**QUALITY SCORE:** 8/10

**NOTES:**
- Ensure that a tool length offset check (G43) is performed before any cutting operation to prevent incorrect depths.
- Verify that the spindle speed and direction are correctly set before starting the peck cycle.

---

### ✅ `test\fixtures\diagnostics\spindle-at-m30.nc`

**Diagnostics:** 0 error(s), 1 warning(s)

| Line | Severity | Message |
|------|----------|---------|
| 16 | warning | Spindle may still be running at program end |

**QWEN Review:**

**TRUE POSITIVES:**
- Line 16 [WARNING]: Spindle may still be running at program end

**FALSE POSITIVES:**
- None identified.

**MISSED ISSUES:**
- The G-code does not include a M05 command to stop the spindle before the M30 end-of-program command. This is a critical safety issue as leaving the spindle running can cause damage or injury.

**QUALITY SCORE:** 8/10

**NOTES:** 
- Ensure that all spindles are stopped before the end of the program, especially in aerospace/high-value machining where precision and safety are paramount.
- Consider implementing additional checks for proper tool change sequences to prevent similar issues.

---

### ✅ `test\fixtures\diagnostics\tap-missing-f.nc`

**Diagnostics:** 1 error(s), 0 warning(s)

| Line | Severity | Message |
|------|----------|---------|
| 11 | error | Tapping cycle G84 requires F (feed = pitch × RPM) |

**QWEN Review:**

**TRUE POSITIVES:**
- Line 11 [ERROR]: Tapping cycle G84 requires F (feed = pitch � RPM)

**FALSE POSITIVES:**
- None identified.

**MISSED ISSUES:**
- The program lacks a tool length offset check before the tapping operation. This could lead to incorrect tool engagement and potential damage to the part or tool.
- There is no verification of the spindle speed (S500) being within safe limits for the specific tool and material being used.

**QUALITY SCORE:** 8/10

**NOTES:**
- Ensure that all tools are properly indexed and checked before starting any machining operation, especially in aerospace applications where precision is critical.
- Verify that the spindle speed is appropriate for the tool and material to prevent overheating or damage.

---

### ✅ `test\fixtures\diagnostics\unsafe-toolchange.nc`

**Diagnostics:** 0 error(s), 1 warning(s)

| Line | Severity | Message |
|------|----------|---------|
| 15 | warning | Possible unsafe tool change: no safe-Z retract found before M06 |

**QWEN Review:**

**TRUE POSITIVES:**
- Line 15 [WARNING]: Possible unsafe tool change: no safe-Z retract found before M06

**FALSE POSITIVES:**
- None identified.

**MISSED ISSUES:**
- The G-code program lacks a safe-Z retract before the second tool change (lines 110 and 130). This could lead to an unsafe tool change if the machine is not properly prepared for the new tool. Additionally, the lack of a G91 G28 Z0. command after the first tool change (line 40) also poses a safety risk.

**QUALITY SCORE:** 7/10

**NOTES:**
- Ensure that all tool changes are preceded by a safe-Z retract to prevent collisions with the workpiece or other components.
- In aerospace/high-value machining, it is crucial to have precise control over the machine's movements and positions to avoid damage to parts and equipment.

---

### ❌ `samples\diagnostics-errors.nc`

**Diagnostics:** 5 error(s), 4 warning(s)

| Line | Severity | Message |
|------|----------|---------|
| 11 | warning | Possible unsafe tool change: no safe-Z retract found before M06 |
| 17 | error | Canned cycle requires Z (depth) |
| 21 | error | Canned cycle requires R (R-plane) |
| 25 | error | G83 peck cycle requires Q (peck depth) |
| 30 | warning | Possible unsafe tool change: no safe-Z retract found before M06 |
| 47 | warning | Possible unsafe tool change: no safe-Z retract found before M06 |
| 76 | warning | Possible unsafe tool change: no safe-Z retract found before M06 |
| 89 | error | Arc endpoint doesn't match center offset (radius error: 0.381966) |
| 96 | error | Arc endpoint doesn't match center offset (radius error: 0.414214) |

**QWEN Review:**

**TRUE POSITIVES:**
- Line 17 [ERROR]: Canned cycle requires Z (depth)
- Line 21 [ERROR]: Canned cycle requires R (R-plane)
- Line 25 [ERROR]: G83 peck cycle requires Q (peck depth)
- Line 89 [ERROR]: Arc endpoint doesn't match center offset (radius error: 0.381966)
- Line 96 [ERROR]: Arc endpoint doesn't match center offset (radius error: 0.414214)

**FALSE POSITIVES:**
- Line 11 [WARNING]: Possible unsafe tool change: no safe-Z retract found before M06
- Line 30 [WARNING]: Possible unsafe tool change: no safe-Z retract found before M06
- Line 47 [WARNING]: Possible unsafe tool change: no safe-Z retract found before M06
- Line 76 [WARNING]: Possible unsafe tool change: no safe-Z retract found before M06

**MISSED ISSUES:**
- Spindle still on at M30 (Line 280)
- Coolant still on at M30 (Line 290)

**QUALITY SCORE:** 7/10

**NOTES:** 
For aerospace/high-value machining, it's crucial to ensure that the spindle and coolant are properly turned off before the program ends. The missed issues related to the spindle and coolant could lead to significant safety hazards in a production environment.

---

### ✅ `samples\lathe-turning.nc`

**Diagnostics:** 1 error(s), 0 warning(s)

| Line | Severity | Message |
|------|----------|---------|
| 104 | error | Canned cycle requires Z (depth) |

**QWEN Review:**

**TRUE POSITIVES:**
- Line 104 [ERROR]: Canned cycle requires Z (depth)

**FALSE POSITIVES:**
- None identified.

**MISSED ISSUES:**
- The G-code program does not include a return to the safe position after each operation, which could lead to tool damage if it runs into obstacles.
- There is no check for proper coolant flow or pressure before starting operations.
- No safety checks are performed to ensure that the chuck is properly tightened and centered before starting any machining.

**QUALITY SCORE:** 7/10

**NOTES:**
- For aerospace/high-value machining, it's crucial to have a robust safety protocol in place. This includes regular coolant checks, proper tool alignment, and ensuring all operations are performed from a safe position.
- The lack of a return-to-safe-position command could be particularly dangerous in high-value applications where precision is paramount.
- Consider implementing additional diagnostics or checks that can be integrated into the G-code program to enhance safety and reliability.

---

### ✅ `samples\mill-5axis.nc`

**Diagnostics:** 0 error(s), 1 warning(s)

| Line | Severity | Message |
|------|----------|---------|
| 25 | warning | Possible unsafe tool change: no safe-Z retract found before M06 |

**QWEN Review:**

**TRUE POSITIVES:**
- Line 25 [WARNING]: Possible unsafe tool change: no safe-Z retract found before M06

**FALSE POSITIVES:**
- None identified.

**MISSED ISSUES:**
- The G-code program does not include a safe Z retraction for the tool change at line 25. This could lead to potential damage if the tool is lowered into the workpiece during a tool change, especially in aerospace/high-value machining where precision and safety are paramount.
- There is no check for proper tool orientation before starting operations (e.g., G43.4 or G43.5 commands) which could result in incorrect tool offsets.

**QUALITY SCORE:** 7/10

**NOTES:**
- Ensure that all tool changes include a safe Z retraction to prevent damage.
- Verify that the correct tool orientation is set before starting operations to avoid errors in tool offset calculations.
- Regularly review and update G-code programs to incorporate safety features specific to aerospace/high-value machining.

---

### ✅ `samples\mill-comprehensive.nc`

**Diagnostics:** 0 error(s), 0 warning(s)

**QWEN Review:**

**TRUE POSITIVES:** None

**FALSE POSITIVES:** None

**MISSED ISSUES:**
- **Tool Change Safety:** The program does not include a tool change safety check. It should pause after each tool change to ensure the operator has time to replace the tool safely.
- **Coolant Check:** There is no coolant check or verification before starting operations that require it, such as peck drilling and tapping.
- **Spindle Speed Verification:** The program does not verify that the spindle speed is within safe limits for the material being machined. This could lead to overheating or damage if speeds are too high.
- **Tool Length Offset Check:** While the program uses tool length offsets (G43 H01, G43 H02, etc.), it does not check if these offsets are correctly set up and verified before use.

**QUALITY SCORE:** 5/10

**NOTES:** The program lacks several critical safety checks that are essential in aerospace/high-value machining. It is crucial to ensure proper tool change procedures, coolant management, spindle speed verification, and correct tool length offset setup to prevent accidents and damage to both the machine and the workpiece.

---

## Summary

- Build steps: 3/3 passed
- NC file reviews: 13/14 passed
- Total elapsed: 70.8s