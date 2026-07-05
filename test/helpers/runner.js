'use strict';
/**
 * Tiny dependency-free test runner. No npm install required — everything
 * uses Node builtins, so `node test/run.js` works on a clean checkout with
 * nothing else installed.
 */
const assert = require('assert');

let currentSuite = null;
const suites = [];

function describe(name, fn) {
  const suite = { name, tests: [] };
  suites.push(suite);
  const prevSuite = currentSuite;
  currentSuite = suite;
  fn();
  currentSuite = prevSuite;
}

function it(name, fn) {
  if (!currentSuite) throw new Error('it() called outside describe()');
  currentSuite.tests.push({ name, fn });
}

async function runAll() {
  let pass = 0, fail = 0;
  const failures = [];

  for (const suite of suites) {
    console.log('\n' + suite.name);
    for (const t of suite.tests) {
      try {
        await t.fn();
        console.log('  \u2705 ' + t.name);
        pass++;
      } catch (err) {
        console.log('  \u274c ' + t.name);
        console.log('     ' + (err && err.message ? err.message : String(err)));
        fail++;
        failures.push(suite.name + ' > ' + t.name);
      }
    }
  }

  console.log('\n' + '-'.repeat(60));
  console.log(`${pass} passed, ${fail} failed (${pass + fail} total)`);
  if (failures.length) {
    console.log('\nFailed:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  return fail === 0;
}

module.exports = { describe, it, runAll, assert };
