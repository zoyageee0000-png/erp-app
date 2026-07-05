'use strict';
/**
 * Bundles every ES-module-converted file (see scripts/esm-converted-files.js)
 * from js/ into dist/ using esbuild, format=iife.
 *
 * WHY IIFE, NOT native <script type="module">:
 * This app loads ~80 files as classic, synchronous <script> tags in a
 * specific dependency order. Native ES modules are always deferred and
 * execute AFTER all classic scripts, in module-graph order — switching
 * script tags to type="module" one at a time would silently break load
 * order for every classic <script> that still expects window.ERP (or any
 * other global) to be fully populated by the time it runs. Bundling to
 * IIFE sidesteps this entirely: the output is a plain synchronous script,
 * byte-for-byte behaviorally identical to the original at runtime, so the
 * <script src="..."> tag position in index.html never has to change.
 *
 * Run: node scripts/build.js
 */
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const { ESM_CONVERTED_FILES } = require('./esm-converted-files');

const JS_DIR = path.join(__dirname, '..', 'js');
const DIST_DIR = path.join(__dirname, '..', 'dist');

if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR);

let failed = false;
for (const file of ESM_CONVERTED_FILES) {
  const entry = path.join(JS_DIR, file);
  const outfile = path.join(DIST_DIR, file);
  try {
    esbuild.buildSync({
      entryPoints: [entry],
      bundle: true,
      format: 'iife',
      outfile,
      logLevel: 'warning'
    });
    console.log(`  \u2705 built dist/${file} from js/${file}`);
  } catch (e) {
    failed = true;
    console.error(`  \u274c failed to build ${file}:`, e.message);
  }
}

if (failed) process.exit(1);
