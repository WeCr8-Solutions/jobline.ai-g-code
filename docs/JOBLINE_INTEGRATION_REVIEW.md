# JobLine G-code, CAM, and Handover Integration Review

## Shared contract

The G-code product now emits `jobline.gcode-review/v1` JSON through:

```powershell
npm run review:gcode -- sample.nc --dialect fanuc --json review.json
```

CAM should consume the program, stock, tools, toolpath summary, and findings from this contract instead of maintaining a second NC parser. The handover hub can attach the same artifact to a work order, NCR, or shift note without needing VS Code.

Fixture automation emits a batch `jobline.fixture-review/v1` index and individual review artifacts with:

```powershell
npm run review:fixtures
```

The VS Code E2E matrix captures clean-mill, unsafe-review, and lathe states with:

```powershell
npm run test:e2e:visual
```

CI retains both sets of outputs as build artifacts. The unsafe fixtures intentionally contain findings, so fixture discovery is an evidence-generating check; use `--fail-on-errors` only for a curated production-safe corpus.

## CAM findings

1. The current simulation UI still uses `generateMockPocket()` rather than parsed NC data.
2. Material-removal verification is an estimate based only on segment count and stock volume; it is not collision or gouge verification.
3. CAM defines native `.jbltools`, `.jblmachine`, and project formats, but no adapter currently maps the G-code review artifact into those types.
4. `npm test -- --run` finds no tests because Vite/Vitest resolves its root to `src/renderer` while test files live elsewhere. Fix the test root/include before treating CAM CI as a release gate.
5. CAM has no screenshot E2E suite yet. Adopt the hub Playwright pattern: deterministic seeded state, explicit loaded-state checks, forbidden empty/error states, screenshots on failure, and retained traces.

## Handover hub findings

The hub provides the strongest E2E model of the three products. Its Playwright suites already wait for loaded UI, reject forbidden error/empty states, and retain screenshots/traces. G-code visual tests should follow that behavior. Review artifacts should be stored as versioned attachments or structured work-order evidence, not copied into handoff prose.

## Recommended boundary

- G-code owns NC parsing, controller dialect interpretation, review findings, and toolpath extraction.
- CAM owns geometry, stock removal, fixtures, kinematics, collision checks, and post-processing.
- The handover hub owns workflow, approvals, provenance, assignments, and durable review evidence.
