%
O00100 (JOBLINE G-CODE INTELLIGENCE - QUICK START SAMPLE)
(MACHINE  : FANUC 31i VMC - MILL)
(MATERIAL : 6061-T6 ALUMINUM)
(UNITS    : INCH / G20)
(FIXTURE  : G54)
(=========================================================)
(  HOVER OVER ANY CODE WORD FOR A TOOLTIP DESCRIPTION    )
(  OPEN THE JOBLINE SIDEBAR (JL ICON) TO SEE:            )
(    - OPERATIONS  - TOOLS  - OFFSETS                    )
(    - CANNED CYCLES  - PROBING  - ALARMS                )
(  FORMAT THIS FILE WITH SHIFT+ALT+F                     )
(  PRESS CTRL+T AND TYPE "O" TO SEARCH ALL SUBPROGRAMS   )
(=========================================================)

(--- SAFE START ---)
N10  G17 G20 G40 G49 G54 G80 G90
N15  G91 G28 Z0.
N16  G90

(=========================================================)
(  OP 1: CENTER DRILL                                    )
(=========================================================)
N20  T01 M06                      (NO.4 CENTER DRILL)
N30  G90 G54
N40  G43 H01 Z1.0
N50  M03 S4000
N60  M08
N70  G81 X1.0 Y1.0 Z-0.08 R0.1 F15.0
N80      X2.0 Y1.0
N90      X3.0 Y1.0
N100     X3.0 Y2.5
N110     X2.0 Y2.5
N120     X1.0 Y2.5
N130 G80
N140 M09
N150 G91 G28 Z0.
N160 M05

(=========================================================)
(  OP 2: PECK DRILL THRU 0.250                          )
(=========================================================)
N170 T02 M06                      (0.250 DRILL)
N180 G90 G54
N190 G43 H02 Z1.0
N200 M03 S3500
N210 M08
N220 G83 X1.0 Y1.0 Z-0.85 R0.1 Q0.125 F12.0
N230     X2.0 Y1.0
N240     X3.0 Y1.0
N250     X3.0 Y2.5
N260     X2.0 Y2.5
N270     X1.0 Y2.5
N280 G80
N290 M09
N300 G91 G28 Z0.
N310 M05

(=========================================================)
(  OP 3: CIRCULAR PROFILE - ARCS + CUTTER COMP          )
(=========================================================)
N320 T03 M06                      (3/8 END MILL)
N330 G90 G54
N340 G43 H03 Z1.0
N350 M03 S5000
N360 M08
N370 G00 X2.0 Y-0.4              (APPROACH OUTSIDE PART)
N380 G01 Z-0.2 F10.0             (PLUNGE)
N390 G41 D03                     (CUTTER COMP LEFT)
N400 G01 Y0. F30.0               (LEAD-IN)
N410 G02 X3.0 Y1.0 I0. J1.0     (QUARTER ARC - VALID R=1.0)
N420 G02 X2.0 Y2.0 I-1.0 J0.    (QUARTER ARC - VALID R=1.0)
N430 G02 X1.0 Y1.0 I0. J-1.0    (QUARTER ARC - VALID R=1.0)
N440 G02 X2.0 Y0. I1.0 J0.      (QUARTER ARC - VALID R=1.0 - CLOSES CIRCLE)
N450 G40                         (CANCEL COMP)
N460 G00 Z1.0
N470 M09
N480 G91 G28 Z0.
N490 G28 Y0.
N500 M05

(=========================================================)
(  OP 4: PROBING CYCLE                                   )
(=========================================================)
N510 T04 M06                      (RENISHAW PROBE)
N520 G90 G54
N530 G43 H04 Z1.0
N540 G00 X2.0 Y1.5
N550 G38.2 Z-0.5 F5.0            (PROBE SURFACE - TRIGGERS PROBING PANEL)
N560 G91 G28 Z0.
N570 G90

N580 M30
%
