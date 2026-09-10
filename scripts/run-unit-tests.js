#!/usr/bin/env node
// Same suite as `npm test`, runnable as a plain `node <file>` with no shell and no
// quoting - fleet agents can only exec a resolved binary with argv, never `npm.cmd`.
const path = require('node:path');
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', target: 'ES2020', esModuleInterop: true, resolveJsonModule: true, strict: false },
});
for (const t of ['parser', 'formatter', 'tool-extraction', 'workholding', 'lathe-review', 'turning-path', 'insert-code']) {
  require(path.join(__dirname, '..', 'test', `${t}.test.ts`));
}
