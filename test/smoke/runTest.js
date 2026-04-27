/* eslint-env node */
/* global require, __dirname, module */

const path = require('path');
const Mocha = require('mocha');

async function run() {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 120000,
  });

  mocha.addFile(path.resolve(__dirname, 'smoke.test.js'));

  await new Promise((resolve, reject) => {
    mocha.run(failures => {
      if (failures > 0) {
        reject(new Error(`${failures} smoke test(s) failed.`));
        return;
      }
      resolve();
    });
  });
}

module.exports = { run };