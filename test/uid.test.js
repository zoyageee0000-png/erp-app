'use strict';
const { describe, it, assert } = require('./helpers/runner');
const { createSandbox, loadFiles } = require('./helpers/sandbox');

describe('ERP.uid() (core.js, real file) — single canonical ID generator', () => {
  it('produces zero collisions across 100,000 rapid-fire calls (worst case: same tick)', () => {
    const sandbox = createSandbox();
    loadFiles(sandbox, ['core.js']);
    const uid = sandbox.window.ERP.uid;
    const seen = new Set();
    for (let i = 0; i < 100000; i++) {
      const id = uid();
      assert.ok(!seen.has(id), `collision detected at call ${i}: ${id}`);
      seen.add(id);
    }
    assert.strictEqual(seen.size, 100000);
  });

  it('always returns the UID-<ms>-<seq>-<rand> shape', () => {
    const sandbox = createSandbox();
    loadFiles(sandbox, ['core.js']);
    const uid = sandbox.window.ERP.uid;
    for (let i = 0; i < 50; i++) {
      assert.match(uid(), /^UID-[0-9A-Z]+-[0-9A-Z]+-[0-9A-Z]{5}$/);
    }
  });

  it('is the only ID generator: no dead ERP.ID module remains in erp.system.guard.js', () => {
    const { readSource } = require('./helpers/sandbox');
    const src = readSource('erp.system.guard.js');
    assert.ok(!/ERP\.ID\s*=/.test(src),
      'erp.system.guard.js should not redefine a competing ERP.ID generator');
  });
});
