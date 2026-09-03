/* eslint-env node */
/* global require, __dirname, console */

const path = require('path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  // Some VS Code integrated terminals export this for helper processes. If it
  // leaks into the test launch, Electron starts as plain Node and extensions
  // cannot resolve the built-in `vscode` module.
  delete process.env.ELECTRON_RUN_AS_NODE;
  const extensionDevelopmentPath = path.resolve(__dirname, '..');
  const extensionTestsPath = path.resolve(__dirname, '..', 'test', 'smoke', 'runTest.js');
  const userDataDir = path.resolve(__dirname, '..', 'test-results', `smoke-profile-${process.pid}`);

  try {
    await runTests({
      version: process.env.JOBLINE_VSCODE_TEST_VERSION || '1.96.4',
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [extensionDevelopmentPath, '--disable-extensions', '--disable-updates', `--user-data-dir=${userDataDir}`],
    });
  } catch (error) {
    console.error('Extension smoke tests failed.');
    throw error;
  }
}

main();
