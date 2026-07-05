#!/usr/bin/env node
'use strict';
/**
 * Syntax gate (Category not audited by number, but referenced throughout
 * CHANGES_THIS_PASS.md as "node --check passes on all 82 files"). This turns
 * that manual check into a permanent, automated one that runs in CI and
 * blocks a deploy on any syntax error — including a broken edit to
 * module_init.js's single-line minified body, which is otherwise very easy
 * to corrupt silently.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const JS_DIR = path.join(__dirname, '..', 'js');

function main() {
  const files = fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js')).sort();
  let failed = 0;

  console.log(`Syntax-checking ${files.length} files in js/ ...\n`);

  for (const file of files) {
    const full = path.join(JS_DIR, file);
    try {
      execFileSync(process.execPath, ['--check', full], { stdio: 'pipe' });
    } catch (err) {
      failed++;
      console.error(`\u274c ${file}`);
      console.error('   ' + String(err.stderr || err.message).trim().split('\n').join('\n   '));
    }
  }

  if (failed > 0) {
    console.error(`\n${failed}/${files.length} files failed node --check.`);
    process.exit(1);
  }

  console.log(`\u2705 All ${files.length} files pass node --check.`);
  process.exit(0);
}

main();
