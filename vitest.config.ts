// @ts-nocheck
export default {
  test: {
    // Only include test files that use vitest (import from 'vitest').
    // The mocha/ts-node test files (parser.test.ts, diagnostics.test.ts,
    // revpack-visualizer-harness.test.ts) and the extension-host smoke suite
    // (smoke/smoke.test.js) are excluded — they run via their own runners.
    include: [
      'test/visualizer.test.ts',
      'test/visualizer-controls.test.ts',
      'test/macro-sidebar.test.ts',
    ],
    globals: false,
  },
};
