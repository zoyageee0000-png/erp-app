'use strict';
/**
 * Runs the full test suite. No test framework dependency — everything here
 * uses Node builtins (vm, assert), so `node test/run.js` works on a clean
 * checkout with nothing installed.
 *
 * Every suite loads the REAL, unmodified files from js/ into a vm sandbox
 * and exercises them directly — these are not re-implementations of the
 * logic under test, so a pass here means the shipped file itself works.
 */
const { describe, it, runAll } = require('./helpers/runner');

global.describe = describe;
global.it = it;

require('./rbac.test.js');
require('./uid.test.js');
require('./tax-engine.test.js');
require('./posting-engine-failclosed.test.js');
require('./storage-and-money.test.js');
require('./logger-esm-conversion.test.js');
require('./core-esm-conversion.test.js');

runAll().then((ok) => process.exit(ok ? 0 : 1));
