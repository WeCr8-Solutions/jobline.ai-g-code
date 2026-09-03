/* eslint-env node */
/* global require, __dirname, module */

const path = require('node:path');
const Mocha = require('mocha');

async function run() {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 120000 });
  mocha.addFile(path.resolve(__dirname, 'visualizer-screenshot.test.js'));
  await new Promise((resolve, reject) => {
    mocha.run(failures => failures ? reject(new Error(`${failures} visual E2E test(s) failed.`)) : resolve());
  });
}

module.exports = { run };
