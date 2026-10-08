---
id: preset-travel-tests
title: Cover more machine travel input formats
role: test
files: [src/presets/presetLibrary.ts, test/machine-presets.test.ts]
checks: [typecheck, unit]
maxAttempts: 4
---
`parseTravelInput` in src/presets/presetLibrary.ts reads axis travel the way a
machinist types it in the New Machine Setup wizard.

Add tests to test/machine-presets.test.ts for inputs that are not covered yet:
decimal travel ("X30.5 Y16.25 Z20"), commas ("30, 16, 20"), "=" between axis
and value ("X=30 Y=16"), lower-case rotaries ("x30 b90"), and negative values
(which should be treated as the same travel as positive ones).

Only change the test file unless a test shows a real bug; if it does, fix it in
presetLibrary.ts and say so in the test name.
