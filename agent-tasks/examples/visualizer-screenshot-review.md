---
id: lathe-chuck-visual-check
title: Lathe programs show chuck jaws in the visualizer
role: develop
files: [src/providers/visualizer/simulationSetup.ts, test/workholding.test.ts]
checks: [typecheck, unit, visual]
review: true
screenshots: true
---
With a lathe machine preset active, the visualizer should draw chuck jaws for
a plain G0/G1 turning program. Confirm the behaviour with a unit test, then let
the visual check capture screenshots so the reviewer can see the jaws.

Do not change how mills are drawn.
