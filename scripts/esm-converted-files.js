'use strict';
/**
 * Single source of truth: which js/ files have been converted to real ES
 * modules (i.e. contain `export` statements) as part of the module-system
 * migration (see MH_ERP_CORRECTED_AST_VERIFIED_PLAN.md).
 *
 * Both the production build (scripts/build.js) and the test harness
 * (test/helpers/sandbox.js) read this SAME list, so it's impossible for
 * them to drift apart and silently test something different from what
 * ships to the browser.
 *
 * Add a filename here ONLY after: (1) the file has real `export` statements
 * added, (2) `window.X = X` backward-compat assignments are still present
 * for not-yet-converted consumers, (3) `npm run verify` passes with the
 * new file's dedicated regression test included.
 */
const ESM_CONVERTED_FILES = [
  'logger.js',
  'core.js'
];

module.exports = { ESM_CONVERTED_FILES };
