---
id: cam-bench-workholding
title: Draw the CAM test bench's Lang vise in the visualizer
role: develop
files: [src/providers/visualizer/simulationSetup.ts, test/workholding.test.ts, test/fixtures/cam-bench/haas-vf2-lang-makrogrip.json]
checks: [typecheck, lint, unit]
---
The visualizer draws generic vise jaws sized from the stock. CAM's test bench
setup (test/fixtures/cam-bench/haas-vf2-lang-makrogrip.json) has the real
Lang Makro-Grip 77 48120-77 sizes: 77 mm jaw width, 3 mm grip, part 62 mm
above a 27 mm Quick-Point plate.

Add an optional workholding spec to buildAutoSimulationMessages (jaw width,
jaw height above the part's bottom, grip depth, plate size) and use it for
the jaw dimensions when given, converting millimetres to the program's units.
Test it with the bench file: the jaws' grip depth must come out as
3 mm (0.118 in). Keep the current behaviour when no spec is given.
