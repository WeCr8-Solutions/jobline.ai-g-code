%
O09001 (JOBLINE DIAGNOSTICS TEST - INTENTIONAL ERRORS)
(THIS FILE INTENTIONALLY CONTAINS ERRORS TO VERIFY SQUIGGLE DETECTION)
(OPEN THIS FILE AND CONFIRM RED/YELLOW SQUIGGLES ON THE MARKED LINES)
(DO NOT USE THIS PROGRAM ON A MACHINE)

(=========================================================)
(  SECTION 1: CANNED CYCLE ERRORS - EXPECT RED SQUIGGLES )
(=========================================================)
N10 G17 G20 G40 G49 G54 G80 G90
N20 T01 M06
N30 G43 H01 Z1.0
N40 M03 S3000
N50 M08

(--- TEST 1A: G81 MISSING Z ---  EXPECT: "Canned cycle requires Z")
N60 G81 X1.0 Y1.0 R0.1 F10.0
N70 G80

(--- TEST 1B: G83 MISSING R ---  EXPECT: "Canned cycle requires R")
N80 G83 X2.0 Y1.0 Z-0.5 Q0.1 F12.0
N90 G80

(--- TEST 1C: G83 MISSING Q ---  EXPECT: "G83 peck cycle requires Q")
N100 G83 X3.0 Y1.0 Z-0.5 R0.1 F12.0
N110 G80

(--- TEST 1D: G84 MISSING F ---  EXPECT: "Tapping cycle G84 requires F")
(    NOTE: remove F from this block AND ensure no modal F is active above)
N120 T02 M06
N130 G43 H02 Z1.0
N140 M29 S500
N150 G84 X1.0 Y1.0 Z-0.4 R0.15
N160 G80

(=========================================================)
(  SECTION 2: SAFETY WARNINGS - EXPECT YELLOW SQUIGGLES  )
(=========================================================)

(--- TEST 2A: M06 WITHOUT PRECEDING SAFE-Z ---           )
(    EXPECT: "Possible unsafe tool change: no safe-Z retract found before M06")
(    NOTE: no G28/G30/G53 Z in the 5 lines above this M06)
N170 G00 X5.0 Y5.0               (MOVING AROUND - NO SAFE Z RETRACT)
N180 G01 X4.0 F30.0
N190 G01 Y4.0
N200 G00 X3.0
N210 T03 M06                     (<-- YELLOW SQUIGGLE HERE: no safe-Z above)
N220 G43 H03 Z1.0
N230 M03 S2000

(--- TEST 2B: SPINDLE STILL ON AT M30 ---)
(    EXPECT: "Spindle may still be running at program end" on M30 line)
(    NOTE: M03 is on, no M05 before M30)
N240 M08
N250 G81 X0.5 Y0.5 Z-0.25 R0.1 F8.0
N260 G80
N270 M09
(NO M05 HERE - SPINDLE STILL RUNNING)
N280 G91 G28 Z0.

(--- TEST 2C: COOLANT STILL ON AT M30 ---)
(    RE-ENABLE COOLANT WITHOUT CLOSING IT)
N290 M08                         (COOLANT ON AGAIN)
(NO M09 BEFORE M30)

N300 M30                         (<-- YELLOW SQUIGGLE: spindle on + coolant on)
%

(=========================================================)
(  SECTION 3: ARC GEOMETRY ERROR - EXPECT RED SQUIGGLE   )
(=========================================================)
(  SEPARATE PROGRAM BLOCK - ARC ENDPOINT MISMATCH        )
%
O09002 (ARC GEOMETRY TEST)
N10 G17 G20 G40 G49 G54 G80 G90
N20 T01 M06
N30 G43 H01 Z1.0
N40 M03 S5000
N50 M08
N60 G00 X0. Y0.
N70 G01 Z-0.1 F10.0

(--- TEST 3A: ARC WITH I,J THAT DON'T MATCH ENDPOINT ---)
(    START: X0 Y0 / CENTER: X0+1.5 Y0+0 = X1.5 Y0     )
(    START RADIUS: sqrt((0-1.5)^2 + (0-0)^2) = 1.5     )
(    END X1.0 Y1.0: RADIUS = sqrt((1.0-1.5)^2+(1.0-0)^2) = sqrt(0.25+1.0) = ~1.118)
(    MISMATCH = 1.5 - 1.118 = 0.382 >> 0.001 TOLERANCE )
(    EXPECT: "Arc endpoint doesn't match center offset (radius error: 0.38xxxx)")
N80 G02 X1.0 Y1.0 I1.5 J0. F20.0  (<-- RED SQUIGGLE: arc radius mismatch)

(--- TEST 3B: VALID ARC - NO SQUIGGLE EXPECTED ---)
(    START: X1.0 Y1.0 / CENTER X1.0+0 Y1.0+(-1.0) = X1.0 Y0.0)
(    R_start = sqrt((1.0-1.0)^2+(1.0-0.0)^2) = 1.0)
(    END X2.0 Y0.0: R_end = sqrt((2.0-1.0)^2+(0.0-0.0)^2) = 1.0)
(    MATCH WITHIN TOLERANCE - CLEAN)
N90 G02 X2.0 Y0. I0. J-1.0 F20.0  (<-- NO SQUIGGLE: valid arc)
N100 G00 Z1.0
N110 M09
N120 G91 G28 Z0.
N130 M05
N140 M30
%
