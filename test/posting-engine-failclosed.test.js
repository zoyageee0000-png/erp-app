'use strict';
const { describe, it, assert } = require('./helpers/runner');
const { createSandbox, loadFiles } = require('./helpers/sandbox');

// posting_engine.js's post() is guarded by 4 safety layers: PeriodLock,
// Chart-of-Accounts validation, cross-tab ConcurrencyGuard, and the in-file
// LockManager. Before the fix, 3 of the 4 degraded to a console.warn and let
// the post through if their dependency hadn't loaded yet (audit #101-103) —
// a closed accounting period or an unknown GL account could silently get a
// real posting written into it. This suite proves each of those 3 now
// THROWS instead of warning, against the real file, not a description of it.

function baseSandbox(extraFiles) {
  const sandbox = createSandbox();
  loadFiles(sandbox, ['core.js', 'accounting_constants.js', 'accounting_store.js', 'accounting_state.js']);
  sandbox.window.AccountingCore.AccountingState.initialize(); // seeds Chart of Accounts from DEFAULT_COA
  loadFiles(sandbox, extraFiles || []);
  loadFiles(sandbox, ['posting_engine.js']);
  // Bypass the (separately-tested) admin/system actor check so we reach the
  // actual fail-open/fail-closed guards under test.
  sandbox.window.ERP.Session = { isSystemContext: () => true };
  return sandbox;
}

function samplePayload() {
  return {
    documentId: 'TEST-DOC-1',
    entries: [
      { accountId: 'acc-1001', debit: 10000, credit: 0 },
      { accountId: 'acc-4001', debit: 0, credit: 10000 }
    ],
    actor: 'system'
  };
}

describe('posting_engine.js — fail-closed guards (real file, Phase 0 fix)', () => {
  it('#101 — refuses to post (throws) when ERP.PeriodLock is not loaded, instead of warning and continuing', async () => {
    const sandbox = baseSandbox([]); // no erp.period.lock.js loaded
    let threw = null;
    try {
      await sandbox.window.ERP.PostingEngine.post(samplePayload());
    } catch (e) {
      threw = e;
    }
    assert.ok(threw, 'post() must throw when PeriodLock is unavailable');
    assert.match(String(threw.message || threw), /PeriodLock/i);
  });

  it('#102 — refuses to post (throws) when the Chart of Accounts is unavailable, instead of warning and continuing', async () => {
    const sandbox = baseSandbox(['erp.period.lock.js']);
    // Simulate COA not being ready yet (e.g. AccountingState loaded but its
    // getCoaMap has not been populated / is missing) — this is the exact
    // "unavailable dependency" scenario #102 describes.
    sandbox.window.AccountingCore.AccountingState.getCoaMap = function () { return null; };
    let threw = null;
    try {
      await sandbox.window.ERP.PostingEngine.post(samplePayload());
    } catch (e) {
      threw = e;
    }
    assert.ok(threw, 'post() must throw when Chart of Accounts is unavailable');
    assert.match(String(threw.message || threw), /Chart of Accounts/i);
  });

  it('#103 — refuses to post (throws) when ERP.ConcurrencyGuard is not loaded, instead of silently skipping the lock', async () => {
    const sandbox = baseSandbox(['erp.period.lock.js']); // no erp.timer.registry.js / erp.concurrency.guard.js loaded
    let threw = null;
    try {
      await sandbox.window.ERP.PostingEngine.post(samplePayload());
    } catch (e) {
      threw = e;
    }
    assert.ok(threw, 'post() must throw when ConcurrencyGuard is unavailable');
    assert.match(String(threw.message || threw), /ConcurrencyGuard/i);
  });

  it('#105 — reports BOTH a missing account AND a structural error in one throw, not just the first found', async () => {
    const sandbox = baseSandbox(['erp.period.lock.js', 'erp.timer.registry.js', 'erp.concurrency.guard.js']);
    const payload = {
      documentId: 'TEST-DOC-2',
      actor: 'system',
      entries: [
        { accountId: 'does-not-exist', debit: 500, credit: 0 }, // missing account
        { accountId: 'acc-1001', debit: 0, credit: 100 }        // unbalanced (debit != credit)
      ]
    };
    let threw = null;
    try {
      await sandbox.window.ERP.PostingEngine.post(payload);
    } catch (e) {
      threw = e;
    }
    assert.ok(threw, 'post() must throw on an invalid payload');
    const msg = String(threw.message || threw);
    assert.match(msg, /does-not-exist/, 'must mention the missing account');
    assert.match(msg, /structurally invalid|debit|credit|balance/i,
      'must ALSO mention the structural (debit≠credit) problem in the same error, not just the missing account');
  });
});
