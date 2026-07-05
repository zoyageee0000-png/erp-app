'use strict';
const { describe, it, assert } = require('./helpers/runner');
const { createSandbox, loadFiles, JS_DIR } = require('./helpers/sandbox');
const fs = require('fs');
const path = require('path');

describe('Storage consolidation (Category B, #9) — 5 files merged into erp.storage.js', () => {
  it('the 5 old storage files no longer exist on disk (deleted, not left as dead files)', () => {
    for (const f of ['db.js', 'storage_adapter.js', 'erp.persistence.js', 'erp.storage.guardian.js', 'sales.storage.adapter.js']) {
      assert.ok(!fs.existsSync(path.join(JS_DIR, f)), `${f} should have been deleted`);
    }
  });

  it('erp.storage.js exists and loads cleanly with no top-level errors', () => {
    const sandbox = createSandbox();
    assert.doesNotThrow(() => loadFiles(sandbox, ['core.js', 'erp.storage.js']));
  });

  it('all 5 original exports are still present under their exact original names', () => {
    const sandbox = createSandbox();
    loadFiles(sandbox, ['core.js', 'erp.storage.js']);
    const ERP = sandbox.window.ERP;
    assert.strictEqual(typeof ERP._db, 'object', 'ERP._db must still exist');
    assert.strictEqual(typeof sandbox.window.StorageAdapter, 'object', 'window.StorageAdapter must still exist');
    assert.strictEqual(typeof ERP.Persistence, 'object', 'ERP.Persistence must still exist');
    assert.strictEqual(typeof ERP.StorageGuardian, 'object', 'ERP.StorageGuardian must still exist');
    assert.strictEqual(typeof ERP._salesStorage, 'object', 'ERP._salesStorage must still exist');
  });

  it('index.html references erp.storage.js exactly once and none of the 5 old filenames', () => {
    const html = fs.readFileSync(path.join(JS_DIR, '..', 'index.html'), 'utf8');
    const storageRefs = (html.match(/src="js\/erp\.storage\.js"/g) || []).length;
    assert.strictEqual(storageRefs, 1, 'erp.storage.js should be included exactly once');
    for (const f of ['db.js', 'storage_adapter.js', 'erp.persistence.js', 'erp.storage.guardian.js', 'sales.storage.adapter.js']) {
      assert.ok(!html.includes(`src="js/${f}"`), `index.html should not reference deleted file ${f}`);
    }
  });
});

describe('Money-formatting bypass regression lock (Category L, #75) — coa.ui.js, job_service.js, sales_controller.js', () => {
  const { readSource } = require('./helpers/sandbox');

  it('coa.ui.js\'s _fmtBal() checks window.ERP.fmt before falling back to a hardcoded format', () => {
    const src = readSource('coa.ui.js');
    const fnMatch = src.match(/function _fmtBal\([^)]*\)\s*\{[\s\S]*?\n    \}/);
    assert.ok(fnMatch, '_fmtBal function body not found');
    assert.match(fnMatch[0], /window\.ERP\s*&&\s*typeof\s*window\.ERP\.fmt\s*===\s*['"]function['"]/,
      '_fmtBal must check ERP.fmt() before its hardcoded fallback');
  });

  it('job_service.js and sales_controller.js no longer hardcode the rupee symbol with a bare toLocaleString (the 15-site bug)', () => {
    for (const f of ['job_service.js', 'sales_controller.js']) {
      const src = readSource(f);
      const bypassPattern = /[₨\u20a8][^;{}]{0,40}toLocaleString\(\s*\)/; // bare, no locale/options = the bug shape
      const matches = src.match(new RegExp(bypassPattern, 'g')) || [];
      // Two sites are a deliberate, documented exception (a K-scale dashboard
      // widget and a static input-field label) — anything beyond that is a
      // regression of the fixed bug.
      assert.ok(matches.length <= 2,
        `${f}: found ${matches.length} raw rupee+bare-toLocaleString sites, expected <=2 (documented exceptions). Sites: ${JSON.stringify(matches)}`);
    }
  });
});
