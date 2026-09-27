const path = require('node:path');
const Mocha = require('mocha');

async function run() {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 120000 });
  mocha.addFile(path.resolve(__dirname, 'hover-screenshot.test.js'));
  return await new Promise((resolve, reject) => {
    mocha.run(failures => failures ? reject(new Error(`${failures} hover screenshot test(s) failed`)) : resolve());
  });
}

module.exports = { run };
