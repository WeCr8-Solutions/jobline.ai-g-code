/* eslint-env node */
/* global require, __dirname, console */

const path = require('path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..');
  const extensionTestsPath = path.resolve(__dirname, '..', 'test', 'smoke', 'runTest.js');

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [extensionDevelopmentPath, '--disable-extensions'],
    });
  } catch (error) {
    console.error('Extension smoke tests failed.');
    throw error;
  }
}

main();