%
O00200 (JOBLINE SAMPLE - MILL COMPREHENSIVE)
(MACHINE  : FANUC 31i-B VERTICAL MACHINING CENTER)
(MATERIAL : 6061-T6 ALUMINUM)
(UNITS    : INCH)
(FIXTURE  : KURT VISE - G54)
(PROGRAMMER: JOBLINE TEST)
(DATE     : 2026-03-27)

(=========================================================)
(  TOOLS USED                                             )
(  T01 - NO.3 CENTER DRILL       S6000 F15.0             )
(  T02 - 0.201 DRILL (13/64)     S4500 F12.0             )
(  T03 - 0.250-20 UNC TAP        S500  F0.05IN/REV        )
(  T04 - 3/8 2FL END MILL        S5000 F30.0             )
(  T05 - 0.500 4FL END MILL      S3800 F25.0             )
(=========================================================)

(--- SAFE START ---)
N10  G17 G20 G40 G49 G54 G80 G90
N15  G91 G28 Z0.
N16  G90

(=========================================================)
(  OPERATION 1: CENTER DRILL - 6 HOLE PATTERN            )
(=========================================================)
N20  T01 M06                      (NO.3 CENTER DRILL)
N30  G90 G54
N40  G43 H01 Z1.0
N50  M03 S6000
N60  M08
N70  G81 X0.5   Y0.5   Z-0.05 R0.1 F15.0   (HOLE 1)
N80      X1.5   Y0.5                        (HOLE 2)
N90      X2.5   Y0.5                        (HOLE 3)
N100     X2.5   Y2.0                        (HOLE 4)
N110     X1.5   Y2.0                        (HOLE 5)
N120     X0.5   Y2.0                        (HOLE 6)
N130 G80
N140 M09
N150 G91 G28 Z0.
N160 M05

(=========================================================)
(  OPERATION 2: PECK DRILL 0.201 THRU                    )
(=========================================================)
N170 T02 M06                      (0.201 DRILL)
N180 G90 G54
N190 G43 H02 Z1.0
N200 M03 S4500
N210 M08
N220 G83 X0.5   Y0.5   Z-0.75 R0.1 Q0.12 F12.0  (HOLE 1)
N230     X1.5   Y0.5                              (HOLE 2)
N240     X2.5   Y0.5                              (HOLE 3)
N250     X2.5   Y2.0                              (HOLE 4)
N260     X1.5   Y2.0                              (HOLE 5)
N270     X0.5   Y2.0                              (HOLE 6)
N280 G80
N290 M09
N300 G91 G28 Z0.
N310 M05

(=========================================================)
(  OPERATION 3: RIGID TAP 0.250-20 UNC                   )
(=========================================================)
N320 T03 M06                      (0.250-20 TAP)
N330 G90 G54
N340 G43 H03 Z1.0
N350 M29 S500                     (RIGID TAP MODE)
N360 M08
N370 G84 X0.5   Y0.5   Z-0.45 R0.15 F25.0  (HOLE 1 - F=PITCH*RPM: 1/20*500=25)
N380     X1.5   Y0.5                        (HOLE 2)
N390     X2.5   Y0.5                        (HOLE 3)
N400     X2.5   Y2.0                        (HOLE 4)
N410     X1.5   Y2.0                        (HOLE 5)
N420     X0.5   Y2.0                        (HOLE 6)
N430 G80
N440 M09
N450 G91 G28 Z0.
N460 M05

(=========================================================)
(  OPERATION 4: RECTANGULAR POCKET - 3/8 END MILL        )
(=========================================================)
N470 T04 M06                      (3/8 2FL END MILL)
N480 G90 G54
N490 G43 H04 Z1.0
N500 M03 S5000
N510 M08
N520 G00 X0.75 Y0.75             (POSITION OVER POCKET ENTRY)
N530 G01 Z-0.25 F10.0            (PLUNGE)
(POCKET PERIMETER - CLIMB CUT)
N540 G01 X2.25 F30.0             (EAST)
N550 G01 Y1.75                   (NORTH)
N560 G01 X0.75                   (WEST)
N570 G01 Y0.75                   (SOUTH - CLOSE)
(POCKET CLEAN-UP PASS WITH RADIUS CORNERS)
N580 G00 Z0.1
N590 G00 X0.85 Y0.85
N600 G01 Z-0.25 F10.0
N610 G01 X2.15 F30.0
N620 G02 X2.25 Y0.95 I0.0 J0.1  (SE CORNER ARC - R0.1)
N630 G01 Y1.65
N640 G02 X2.15 Y1.75 I-0.1 J0.0 (NE CORNER ARC - R0.1)
N650 G01 X0.85
N660 G02 X0.75 Y1.65 I0.0 J-0.1 (NW CORNER ARC - R0.1)
N670 G01 Y0.95
N680 G02 X0.85 Y0.85 I0.1 J0.0  (SW CORNER ARC - R0.1)
N690 G01 Z0.1 F20.0
N700 M09
N710 G91 G28 Z0.
N720 M05

(=========================================================)
(  OPERATION 5: PROFILE CONTOUR - 1/2 END MILL           )
(=========================================================)
N730 T05 M06                      (0.500 4FL END MILL)
N740 G90 G54
N750 G43 H05 Z1.0
N760 M03 S3800
N770 M08
(CALL PROFILE SUBPROGRAM)
N780 M98 P8000 L2               (RUN PROFILE TWICE - ROUGHING + FINISHING)
N790 M09
N800 G91 G28 Z0.
N810 G28 Y0.
N820 M05
N830 M30
%

(=========================================================)
(  O8000 - PROFILE SUBPROGRAM                            )
(  RECTANGULAR BOSS 0.5 ABOVE STOCK                      )
(=========================================================)
%
O8000
N10 G90 G54
N20 G00 X-0.3 Y-0.3            (APPROACH - OUTSIDE PART)
N30 G01 Z-0.1 F10.0            (PLUNGE)
N40 G41 D05                    (CUTTER COMP LEFT)
N50 G01 X3.3 F25.0             (SOUTH EDGE - EAST)
N60 G01 Y2.5                   (EAST EDGE - NORTH)
N70 G01 X-0.3                  (NORTH EDGE - WEST)
N80 G01 Y-0.3                  (WEST EDGE - SOUTH)
N90 G40                        (CANCEL COMP)
N100 G00 Z1.0
N110 M99
%
