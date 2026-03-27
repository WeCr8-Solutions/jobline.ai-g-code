%
O00300 (JOBLINE SAMPLE - LATHE TURNING)
(MACHINE  : FANUC 31i-T CNC LATHE)
(MATERIAL : 1018 COLD ROLL STEEL - 2.5 DIA x 5.0 LONG)
(UNITS    : INCH)
(CHUCK    : 3-JAW CHUCK)
(PROGRAMMER: JOBLINE TEST)
(DATE     : 2026-03-27)

(=========================================================)
(  TOOLS USED                                             )
(  T01 - FACE / ROUGH TURN OD    TNMG INSERT             )
(  T02 - FINISH TURN OD          VNMG INSERT             )
(  T03 - 60-DEG THREADING TOOL   60 DEG INSERT           )
(  T04 - GROOVING TOOL           0.125 WIDE              )
(  T05 - CENTER DRILL / DRILL    NO.3 CENTER DRILL        )
(=========================================================)

(--- SAFE START ---)
N10 G18 G20 G40 G80 G99
(G18=ZX PLANE / G20=INCH / G40=CANCEL COMP / G80=CANCEL CYCLES / G99=FEED/REV)

(=========================================================)
(  OPERATION 1: FACE AND ROUGH TURN OD                   )
(=========================================================)
N20 T0101                         (ROUGH TURN INSERT, OFFSET 01)
N30 G96 S350 M03                  (CSS - 350 SFM)
N40 G50 S3000                     (CLAMP MAX RPM)
N50 G00 X2.6 Z0.05               (RAPID TO FACE START)
N60 M08

(FACE PASS)
N70 G01 X-0.07 F0.015            (FACE TO CENTER)
N80 G00 Z0.1
N90 G00 X2.6

(G71 STOCK REMOVAL IN TURNING CYCLE)
(G71 P__ Q__ U__ W__ D__ F__)
(P=FIRST BLOCK OF PROFILE / Q=LAST BLOCK / U=X LEAVE / W=Z LEAVE / D=DEPTH/PASS)
N100 G71 U0.1 R0.05              (DEPTH OF CUT 0.1, RETRACT 0.05)
N110 G71 P120 Q200 U0.02 W0.005 F0.018  (ROUGH CYCLE - LEAVE 0.02 X, 0.005 Z)

(PROFILE START - N120 TO N200)
N120 G00 X0.                     (PROFILE: START AT CENTER)
N130 G01 Z0. F0.01               (FACE SURFACE)
N140 G01 X0.875                  (STEP UP TO 0.875 DIA)
N150 G01 Z-0.75                  (TURN 0.875 DIA 0.75 LONG)
N160 G01 X1.0 Z-0.875            (CHAMFER 0.125x0.125)
N170 G01 Z-2.0                   (TURN 1.0 DIA 1.125 LONG)
N180 G02 X1.25 Z-2.125 I0.125 K0. (R0.125 BLEND RADIUS)
N190 G01 Z-3.5                   (TURN 1.25 DIA)
N200 G01 X2.55                   (STEP OFF FACE)

N210 G00 X3.0 Z1.0
N220 M09
N230 G97 S600                    (SWITCH TO RPM FOR INDEXING)
N240 G28 U0. W0.                 (HOME TURRET)
N250 M05

(=========================================================)
(  OPERATION 2: FINISH TURN OD                           )
(=========================================================)
N260 T0202                        (FINISH TURN INSERT, OFFSET 02)
N270 G96 S500 M03                 (CSS - 500 SFM)
N280 G50 S4000
N290 G00 X2.6 Z0.05
N300 M08

(G70 FINISH PASS USING SAME PROFILE N120-N200)
N310 G70 P120 Q200 F0.006        (FINISH PASS - 0.006 IN/REV)

N320 G00 X3.0 Z1.0
N330 M09
N340 G97 S500
N350 G28 U0. W0.
N360 M05

(=========================================================)
(  OPERATION 3: OD GROOVE - 0.125 WIDE x 0.125 DEEP     )
(=========================================================)
N370 T0404                        (GROOVING TOOL 0.125W, OFFSET 04)
N380 G97 S800 M03                 (800 RPM FOR GROOVING)
N390 G00 X1.1 Z-1.5              (RAPID TO GROOVE POSITION)
N400 M08
(G75 OD GROOVING CYCLE)
(G75 X__ Z__ P__ Q__ R__ F__)
(X=GROOVE FLOOR / Z=END OF GROOVE / P=X INFEED/PASS / Q=Z STEP / R=RETRACT)
N410 G75 X0.75 Z-1.625 P500 Q1250 R0.01 F0.004
N420 G00 X3.0 Z1.0
N430 M09
N440 G28 U0. W0.
N450 M05

(=========================================================)
(  OPERATION 4: OD THREAD 1.0-8 UNC 2A                  )
(=========================================================)
N460 T0303                        (60-DEG THREADING TOOL, OFFSET 03)
N470 G97 S600 M03                 (FIXED RPM FOR THREADING - CRITICAL)
N480 G00 X1.1 Z0.25              (APPROACH: START Z 0.25 CLEAR OF FACE)
N490 M08
(G76 THREADING CYCLE - TWO-LINE FORMAT)
(G76 P__  Q__  R__   = PASS COUNT, MIN DEPTH, COMPOUND ANGLE)
(G76 X__ Z__ P__ Q__ R__ F__ = MINOR DIA, END Z, THREAD HEIGHT, FIRST PASS, TAPER, PITCH)
N500 G76 P030060 Q0015 R0.003     (3 SPRING PASSES / 0.0015 MIN CUT / 60 DEG)
N510 G76 X0.8647 Z-1.75 P0676 Q0200 R0. F0.125  (1-8 UNC: MINOR=0.8647 / PITCH=0.125)
N520 G00 X3.0 Z1.0
N530 M09
N540 G28 U0. W0.
N550 M05
N560 M30
%
