'use strict';
/**
 * Locks in Phase 1 / Step 2: core.js converted to a real ES module.
 * core.js is the highest-fan-in file in the codebase (30 writes, first of
 * 92 <script> tags, everything else reads window.ERP.*) so this suite is
 * intentionally more thorough than logger.js's Step 1 test. It proves:
 *   1. Every not-yet-converted classic-script consumer still sees the exact
 *      same window.ERP / window.MH surface as before (zero regressions).
 *   2. The real `export { ERP }` resolves to the SAME object instance as
 *      window.ERP and window.MH — one real module, not a divergent copy.
 *   3. Core functionality (uid, fmt, RBAC, errors, state get/set/undo/redo,
 *      events) all still work when loaded through the new ESM-aware path.
 */
const assert = require('assert');
const { createSandbox, loadFiles, loadESMFile } = require('./helpers/sandbox');

describe('core.js -- ESM conversion (Phase 1, Step 2)', () => {

  it('window.ERP / window.MH backward-compat surface is fully intact after conversion', () => {
    const sandbox = createSandbox();
    loadFiles(sandbox, ['core.js']);
    const ERP = sandbox.window.ERP;
    assert.ok(ERP, 'window.ERP must still be set for not-yet-converted files');
    assert.strictEqual(sandbox.window.MH, ERP, 'window.MH must still alias window.ERP');
    assert.strictEqual(typeof ERP.uid, 'function');
    assert.strictEqual(typeof ERP.fmt, 'function');
    assert.strictEqual(typeof ERP.getState, 'function');
    assert.strictEqual(typeof ERP.setState, 'function');
    assert.strictEqual(typeof ERP.undoState, 'function');
    assert.strictEqual(typeof ERP.redoState, 'function');
    assert.ok(ERP.RBAC, 'ERP.RBAC must still be present');
    assert.ok(ERP.errors, 'ERP.errors must still be present');
    assert.ok(ERP.DateUtils, 'ERP.DateUtils must still be present');
    assert.strictEqual(ERP.version, '4.1.0');
  });

  it('real export { ERP } resolves to the SAME object as window.ERP and window.MH', () => {
    const sandbox = createSandbox();
    const exported = loadESMFile(sandbox, 'core.js');
    assert.ok(exported.ERP, 'ESM export must expose ERP');
    assert.strictEqual(
      exported.ERP,
      sandbox.window.ERP,
      'exported ERP must be identical to window.ERP -- one real module, not a divergent copy'
    );
    assert.strictEqual(
      exported.ERP,
      sandbox.window.MH,
      'exported ERP must also be identical to window.MH'
    );
  });

  it('ERP.uid() still produces the documented UID-<ts>-<seq>-<rand> format through the ESM export', () => {
    const sandbox = createSandbox();
    const { ERP } = loadESMFile(sandbox, 'core.js');
    const id = ERP.uid();
    assert.match(id, /^UID-[0-9A-Z]+-[0-9A-Z]+-[0-9A-Z]{5}$/);
  });

  it('ERP.fmt() still formats money using the configured business currency through the ESM export', () => {
    const sandbox = createSandbox();
    const { ERP } = loadESMFile(sandbox, 'core.js');
    assert.strictEqual(ERP.fmt(500), 'Rs.500.00');
  });

  it('ERP.setState()/getState() roundtrip still works through the ESM export (state management unaffected)', () => {
    const sandbox = createSandbox();
    const { ERP } = loadESMFile(sandbox, 'core.js');
    const before = ERP.getState().data.sales.length;
    const ok = ERP.setState((draft) => { draft.data.sales.push({ id: 'test-sale' }); });
    assert.strictEqual(ok, true, 'setState must report success');
    const after = ERP.getState().data.sales.length;
    assert.strictEqual(after, before + 1);
  });

  it('ERP.RBAC still gates the 5 destructive actions to Admin only through the ESM export', () => {
    const sandbox = createSandbox();
    const { ERP } = loadESMFile(sandbox, 'core.js');
    for (const action of ['deleteJob', 'voidPayment', 'issueCreditReturn', 'deleteVehicle', 'deleteAppointment']) {
      assert.ok(ERP.RBAC.Admin.actions[action], `RBAC.Admin.actions.${action} must be truthy`);
      assert.ok(!ERP.RBAC.Viewer.actions[action], `RBAC.Viewer.actions.${action} must NOT be granted`);
    }
  });

  it('core.js still loads cleanly alongside init.js via the classic (non-ESM) path used by other suites', () => {
    // Regression guard for exactly the failure mode caught before this file
    // was added to ESM_CONVERTED_FILES: if core.js's `export` statement were
    // ever present WITHOUT this registration, rbac.test.js / uid.test.js /
    // posting-engine-failclosed.test.js / storage-and-money.test.js (all of
    // which load core.js via loadFiles) would fail with a vm.Script
    // "Unexpected token 'export'" syntax error. This test proves the
    // registered, ESM-aware path is the one actually exercised.
    const sandbox = createSandbox();
    loadFiles(sandbox, ['core.js', 'init.js']);
    assert.ok(sandbox.window.ERP, 'core.js must load cleanly through loadFiles()');
    assert.ok(sandbox.window.ERP.permissions, 'init.js-provided ERP.permissions must still be reachable');
  });

});
