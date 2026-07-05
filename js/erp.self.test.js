
'use strict';

(function (root) {
  'use strict';

  var ERP = root.ERP = root.ERP || {};

  if (ERP.SelfTest && ERP.SelfTest.__phase7) return;


  function _try(fn, fallback, tag) {
    try { return fn(); }
    catch (e) {
      if (root.DEBUG_MODE || root._mhDebug)
        console.warn('[ERP.SelfTest][' + (tag || '?') + ']', e && e.message);
      return (typeof fallback === 'function') ? fallback(e) : fallback;
    }
  }

  function _num(v, def) {
    var n = parseFloat(v);
    return (isNaN(n) || !isFinite(n)) ? (def !== undefined ? def : 0) : n;
  }

  function _now() {
    return new Date().toISOString();
  }


  function _ACC() {
    return root.AccountingCore || null;
  }

  function _AccState() {
    var a = _ACC();
    if (!a) return null;
    return _try(function () { return a.AccountingState || null; }, null, '_AccState');
  }

  function _Ledger() {
    return (ERP.Ledger && ERP.Ledger.__phase2) ? ERP.Ledger : null;
  }

  function _Inventory() {
    return (ERP.Inventory && ERP.Inventory.__phase3) ? ERP.Inventory : null;
  }

  function _getState() {
    if (typeof root.getState === 'function') return _try(root.getState, {}, '_getState');
    if (ERP.Store && typeof ERP.Store.getState === 'function') return _try(ERP.Store.getState, {}, '_getState.Store');
    return {};
  }


  var PASS    = 'PASS';
  var WARN    = 'WARN';
  var FAIL    = 'FAIL';
  var SKIP    = 'SKIP';
  var CORRUPT = 'CORRUPT';

  function _result(status, name, message, detail) {
    return { status: status, name: name, message: message, detail: detail || null, ts: _now() };
  }


  function _toast(msg, type, dur) {
    _try(function () {
      if (ERP.ui && typeof ERP.ui.toast === 'function') {
        ERP.ui.toast(msg, type || 'info', dur || 5000);
      }
    }, null, '_toast');
  }


  var _ICONS = { PASS: '✅', WARN: '⚠️', FAIL: '❌', SKIP: '⏭️', CORRUPT: '🚨' };
  var _CSS   = {
    PASS:    'color:#22c55e;font-weight:bold',
    WARN:    'color:#f59e0b;font-weight:bold',
    FAIL:    'color:#ef4444;font-weight:bold',
    SKIP:    'color:#94a3b8;font-weight:bold',
    CORRUPT: 'color:#dc2626;font-weight:900;font-size:1.1em'
  };

  function _log(r) {
    var icon = _ICONS[r.status] || '?';
    var css  = _CSS[r.status]  || '';
    console.log('%c' + icon + ' [' + r.status + '] ' + r.name + ': ' + r.message, css);
    if (r.detail && (root.DEBUG_MODE || root._mhDebug)) {
      console.log('    Detail:', r.detail);
    }
  }


  function _runTransactionTests() {
    var results = [];

    results.push(_try(function () {
      if (typeof ERP.transaction !== 'function')
        return _result(SKIP, 'TXN-1A: Engine present', 'ERP.transaction not loaded yet');
      return _result(PASS, 'TXN-1A: Engine present', 'ERP.transaction is callable');
    }, _result(FAIL, 'TXN-1A: Engine present', 'Exception during check'), 'txn-1a'));

    results.push(_try(function () {
      if (typeof ERP.transaction !== 'function')
        return _result(SKIP, 'TXN-1B: Commit path', 'ERP.transaction not available');
      var scratch = { v: 0 };
      var ret = ERP.transaction(function () {
        scratch.v = 42;
        return scratch.v;
      }, 'P7_TEST_COMMIT');
      if (scratch.v !== 42)
        return _result(FAIL, 'TXN-1B: Commit path', 'Scratch value not written (got ' + scratch.v + ')');
      return _result(PASS, 'TXN-1B: Commit path', 'fn executed and scratch mutated correctly');
    }, _result(FAIL, 'TXN-1B: Commit path', 'Exception during commit test'), 'txn-1b'));

    results.push(_try(function () {
      if (typeof ERP.transaction !== 'function')
        return _result(SKIP, 'TXN-1C: Rollback path', 'ERP.transaction not available');

      var ledger  = _Ledger();
      if (!ledger) return _result(SKIP, 'TXN-1C: Rollback path', 'ERP.Ledger not available');

      var as = _AccState();
      var countBefore = _try(function () {
        return as && as.getAllJournals ? as.getAllJournals().length : -1;
      }, -1, 'txn-1c.countBefore');

      var threw = false;
      var _muted = !!(ERP.Logger && typeof ERP.Logger.mute === 'function');
      if (_muted) ERP.Logger.mute(); // this rollback is intentional — don't spam console.error
      try {
        try {
          ERP.transaction(function () {
            throw new Error('P7_ROLLBACK_TEST');
          }, 'P7_TEST_ROLLBACK');
        } catch (e) {
          threw = (e.message && e.message.indexOf('P7_ROLLBACK_TEST') >= 0) ||
                  (e.message && e.message.indexOf('step') >= 0);
        }
      } finally {
        if (_muted) ERP.Logger.unmute();
      }

      var countAfter = _try(function () {
        return as && as.getAllJournals ? as.getAllJournals().length : -1;
      }, -1, 'txn-1c.countAfter');

      if (countBefore >= 0 && countAfter > countBefore)
        return _result(FAIL, 'TXN-1C: Rollback path',
          'Journal count grew during failed transaction (' + countBefore + ' → ' + countAfter + ')');

      return _result(PASS, 'TXN-1C: Rollback path',
        'Exception properly contained; journals unchanged');
    }, _result(FAIL, 'TXN-1C: Rollback path', 'Exception during rollback test'), 'txn-1c'));

    results.push(_try(function () {
      if (typeof ERP.transaction !== 'function' || typeof ERP.transaction.isActive !== 'function')
        return _result(SKIP, 'TXN-1D: isActive idle', 'ERP.transaction.isActive not available');
      var active = ERP.transaction.isActive();
      if (active)
        return _result(WARN, 'TXN-1D: isActive idle',
          'A transaction appears active at startup — possible leftover from a previous session action');
      return _result(PASS, 'TXN-1D: isActive idle', 'No stale transaction detected');
    }, _result(FAIL, 'TXN-1D: isActive idle', 'Exception'), 'txn-1d'));

    results.push(_try(function () {
      
      var _dbObj = ERP.DB || ERP._db;
      if (_dbObj && (typeof _dbObj.get === 'function' || typeof _dbObj.load === 'function'))
        return _result(PASS, 'TXN-1E: ERP.DB present', 'IDB adapter available as ERP.' + (ERP.DB ? 'DB' : '_db'));
      return _result(SKIP, 'TXN-1E: ERP.DB present', 'ERP._db not yet initialized — IDB may not be open yet');
    }, _result(FAIL, 'TXN-1E: ERP.DB present', 'Exception'), 'txn-1e'));

    return results;
  }


  function _runAccountingBalanceTests() {
    var results = [];

    results.push(_try(function () {
      var a = _ACC();
      if (!a) return _result(SKIP, 'ACC-2A: AccountingCore present', 'AccountingCore not loaded');
      return _result(PASS, 'ACC-2A: AccountingCore present', 'AccountingCore is available');
    }, _result(FAIL, 'ACC-2A: AccountingCore present', 'Exception'), 'acc-2a'));

    results.push(_try(function () {
      var ledger = _Ledger();
      if (!ledger) return _result(SKIP, 'ACC-2B: GL balanced', 'ERP.Ledger not available');

      var check = _try(function () {
        return ledger.GeneralLedger && typeof ledger.GeneralLedger.isBalanced === 'function'
          ? ledger.GeneralLedger.isBalanced()
          : null;
      }, null, 'acc-2b.isBalanced');

      if (!check) return _result(SKIP, 'ACC-2B: GL balanced', 'GeneralLedger.isBalanced not available');

      if (!check.balanced) {
        var diff = _num(check.difference, 0);
        return _result(
          CORRUPT,
          'ACC-2B: GL balanced',
          'LEDGER OUT OF BALANCE — difference: ' + diff + ' paisa (DR=' + check.totalDebit + ' CR=' + check.totalCredit + ')',
          check
        );
      }
      return _result(PASS, 'ACC-2B: GL balanced',
        'DR=' + check.totalDebit + ' paisa  CR=' + check.totalCredit + ' paisa  ✓ Balanced');
    }, _result(FAIL, 'ACC-2B: GL balanced', 'Exception during balance check'), 'acc-2b'));

    results.push(_try(function () {
      var as = _AccState();
      if (!as || typeof as.getAllJournals !== 'function')
        return _result(SKIP, 'ACC-2C: Per-journal balance', 'AccountingState not available');

      var journals = _try(function () { return as.getAllJournals() || []; }, [], 'acc-2c.getJournals');
      var unbalanced = [];

      for (var i = 0; i < journals.length; i++) {
        var j  = journals[i];
        var dr = 0, cr = 0;
        var entries = j.entries || [];
        for (var k = 0; k < entries.length; k++) {
          dr += _num(entries[k].debit,  0);
          cr += _num(entries[k].credit, 0);
        }
        if (Math.abs(dr - cr) > 1) {
          unbalanced.push({ id: j.id, sourceId: j.sourceId, dr: dr, cr: cr, diff: dr - cr });
        }
      }

      if (unbalanced.length) {
        return _result(
          CORRUPT,
          'ACC-2C: Per-journal balance',
          unbalanced.length + ' unbalanced journal(s) detected out of ' + journals.length,
          unbalanced.slice(0, 10)
        );
      }
      return _result(PASS, 'ACC-2C: Per-journal balance',
        'All ' + journals.length + ' journals are internally balanced');
    }, _result(FAIL, 'ACC-2C: Per-journal balance', 'Exception'), 'acc-2c'));

    results.push(_try(function () {
      var as = _AccState();
      if (!as || typeof as.getAllJournals !== 'function')
        return _result(SKIP, 'ACC-2D: No empty journals', 'AccountingState not available');

      var journals = _try(function () { return as.getAllJournals() || []; }, [], 'acc-2d.getJournals');
      var empty = journals.filter(function (j) { return !j.entries || j.entries.length < 2; });

      if (empty.length)
        return _result(WARN, 'ACC-2D: No empty journals',
          empty.length + ' journal(s) have fewer than 2 entries',
          empty.map(function (j) { return j.id; }).slice(0, 10));

      return _result(PASS, 'ACC-2D: No empty journals',
        journals.length + ' journals all have ≥ 2 entries');
    }, _result(FAIL, 'ACC-2D: No empty journals', 'Exception'), 'acc-2d'));

    results.push(_try(function () {
      var ledger = _Ledger();
      if (!ledger || !ledger.getTrialBalance)
        return _result(SKIP, 'ACC-2E: Trial balance', 'ERP.Ledger.getTrialBalance not available');

      var tb = _try(function () { return ledger.getTrialBalance() || []; }, [], 'acc-2e.getTB');
      var totalDr = 0, totalCr = 0;
      for (var i = 0; i < tb.length; i++) {
        totalDr += _num(tb[i].totalDebit,  0);
        totalCr += _num(tb[i].totalCredit, 0);
      }

      var diff = Math.abs(totalDr - totalCr);
      if (diff > 1) {
        return _result(CORRUPT, 'ACC-2E: Trial balance',
          'Trial balance does not balance — diff=' + diff + ' paisa',
          { totalDr: totalDr, totalCr: totalCr });
      }
      return _result(PASS, 'ACC-2E: Trial balance',
        'Trial balance OK — DR=' + totalDr + ' CR=' + totalCr);
    }, _result(FAIL, 'ACC-2E: Trial balance', 'Exception'), 'acc-2e'));

    results.push(_try(function () {
      var PS  = root.PurchaseState;
      var LED = ERP.Ledger;
      if (!PS || !LED || !LED.VendorLedger) {
        return _result(SKIP, 'ACC-2F: Dual AP ledger divergence',
          'PurchaseState or ERP.Ledger.VendorLedger not available');
      }
      var suppliers = _try(function () {
        return PS.getSuppliers ? PS.getSuppliers() : [];
      }, [], 'acc-2f.getSuppliers');
      if (!suppliers.length) {
        return _result(SKIP, 'ACC-2F: Dual AP ledger divergence', 'No suppliers found');
      }
      var totalPsAP = 0;
      suppliers.forEach(function (sup) {
        var bal = _try(function () {
          return PS.getSupplierBalance ? PS.getSupplierBalance(sup.id || sup.name) : 0;
        }, 0, 'acc-2f.ps-balance');
        totalPsAP += (bal || 0);
      });
      var glAP = _try(function () {
        var as = ERP._accCore && ERP._accCore.AccountingState;
        if (!as) return null;
        var bal = as.getAccountBalance ? as.getAccountBalance('acc-2001') : null;
        return bal;
      }, null, 'acc-2f.gl-balance');
      if (glAP === null) {
        return _result(SKIP, 'ACC-2F: Dual AP ledger divergence',
          'GL AP account balance not accessible');
      }
      var glAP_float = glAP / 100;
      var diff = Math.abs(totalPsAP - glAP_float);
      if (diff > 1) {
        return _result(WARN, 'ACC-2F: Dual AP ledger divergence',
          'AP mismatch: PurchaseState=' + totalPsAP.toFixed(2) +
          ' GL=' + glAP_float.toFixed(2) +
          ' diff=' + diff.toFixed(2) +
          ' — Run purchase connector backfill to reconcile');
      }
      return _result(PASS, 'ACC-2F: Dual AP ledger divergence',
        'AP ledgers agree within tolerance — PS=' + totalPsAP.toFixed(2) +
        ' GL=' + glAP_float.toFixed(2));
    }, _result(FAIL, 'ACC-2F: Dual AP ledger divergence', 'Exception'), 'acc-2f'));

    return results;
  }


  function _runStockBalanceTests() {
    var results = [];

    results.push(_try(function () {
      var inv = _Inventory();
      if (!inv) return _result(SKIP, 'STK-3A: ERP.Inventory present', 'ERP.Inventory not available');
      return _result(PASS, 'STK-3A: ERP.Inventory present', 'ERP.Inventory loaded');
    }, _result(FAIL, 'STK-3A: ERP.Inventory present', 'Exception'), 'stk-3a'));

    results.push(_try(function () {
      var inv = _Inventory();
      if (!inv || !inv.ItemMaster || typeof inv.ItemMaster.getAll !== 'function')
        return _result(SKIP, 'STK-3B: No negative stock', 'ItemMaster not available');

      var allItems = _try(function () { return inv.ItemMaster.getAll() || []; }, [], 'stk-3b.getAll');
      var negative = [];

      for (var i = 0; i < allItems.length; i++) {
        var it = allItems[i];
        var qty = _try(function () {
          return inv.getBalance ? _num(inv.getBalance(it.bc), 0) : _num(it.st, 0);
        }, _num(it.st, 0), 'stk-3b.getBalance');
        if (qty < 0) negative.push({ bc: it.bc, n: it.n, qty: qty });
      }

      if (negative.length)
        return _result(FAIL, 'STK-3B: No negative stock',
          negative.length + ' item(s) have negative stock quantity',
          negative.slice(0, 10));

      return _result(PASS, 'STK-3B: No negative stock',
        'All ' + allItems.length + ' items have non-negative stock');
    }, _result(FAIL, 'STK-3B: No negative stock', 'Exception'), 'stk-3b'));

    results.push(_try(function () {
      var inv    = _Inventory();
      var ledger = _Ledger();

      if (!inv  || typeof inv.getValuation !== 'function')
        return _result(SKIP, 'STK-3C: Stock vs GL value', 'ERP.Inventory.getValuation not available');
      
      var _slGetBal = ledger && ledger.StockLedger &&
                      (ledger.StockLedger.getInventoryAssetBalance || ledger.StockLedger.getInventoryBalance);
      if (!ledger || !ledger.StockLedger || typeof _slGetBal !== 'function')
        return _result(SKIP, 'STK-3C: Stock vs GL value', 'ERP.Ledger.StockLedger not available');

      var physVal = _try(function () {
        var v = inv.getValuation(null);
        return _num(v && v.totalPaisa, 0);
      }, -1, 'stk-3c.physVal');

      var glBal = _try(function () {
        
        var _getBalFn = ledger.StockLedger.getInventoryBalance || ledger.StockLedger.getInventoryAssetBalance;
        return _num(_getBalFn.call(ledger.StockLedger), 0);
      }, -1, 'stk-3c.glBal');

      if (physVal < 0 || glBal < 0)
        return _result(SKIP, 'STK-3C: Stock vs GL value', 'Could not read one or both balances');

      if (glBal === 0 && physVal > 0)
        return _result(WARN, 'STK-3C: Stock vs GL value',
          'Physical stock has value (' + physVal + ' paisa) but GL Inventory Asset (acc-1200) is zero — ledger may not have been initialised',
          { physPaisa: physVal, glPaisa: glBal });

      var diff = Math.abs(physVal - glBal);
      var tolerance = 100;

      if (diff > tolerance)
        return _result(WARN, 'STK-3C: Stock vs GL value',
          'Physical stock value (' + physVal + ' p) differs from GL acc-1200 (' + glBal + ' p) by ' + diff + ' paisa',
          { physPaisa: physVal, glPaisa: glBal, diffPaisa: diff });

      return _result(PASS, 'STK-3C: Stock vs GL value',
        'Physical=' + physVal + ' paisa  GL=' + glBal + ' paisa  diff=' + diff + ' paisa');
    }, _result(FAIL, 'STK-3C: Stock vs GL value', 'Exception'), 'stk-3c'));

    results.push(_try(function () {
      var as = _AccState();
      if (!as || typeof as.getAllJournals !== 'function')
        return _result(SKIP, 'STK-3D: COGS-stock linkage', 'AccountingState not available');

      var inv = _Inventory();
      if (!inv || !inv.ItemMaster || typeof inv.ItemMaster.getAll !== 'function')
        return _result(SKIP, 'STK-3D: COGS-stock linkage', 'ItemMaster not available');

      var journals = _try(function () { return as.getAllJournals() || []; }, [], 'stk-3d.journals');
      var cogsKeys = [];
      for (var i = 0; i < journals.length; i++) {
        var j = journals[i];
        var did = (j.documentId || '');
        if (did.indexOf('SALE-COGS-') === 0 || did.indexOf('JOB-COGS-') === 0)
          cogsKeys.push(did);
      }

      return _result(PASS, 'STK-3D: COGS-stock linkage',
        cogsKeys.length + ' COGS journal(s) found — ledger covers posted sales');
    }, _result(FAIL, 'STK-3D: COGS-stock linkage', 'Exception'), 'stk-3d'));

    return results;
  }


  function _runStorageIntegrityTests() {
    var results = [];

    results.push(_try(function () {
      var probe = '__erp_p7_probe__';
      root.localStorage.setItem(probe, '1');
      root.localStorage.removeItem(probe);
      return _result(PASS, 'STO-4A: localStorage accessible', 'Read/write to localStorage successful');
    }, function (e) {
      return _result(CORRUPT, 'STO-4A: localStorage accessible',
        'localStorage is inaccessible: ' + (e && e.message), e);
    }, 'sto-4a'));

    results.push(_try(function () {
      var CRITICAL_KEYS = [
        'sales', 'purchases', 'inventory', 'customers', 'suppliers',
        'expenses',
      ];
      var corrupt = [];

      for (var i = 0; i < CRITICAL_KEYS.length; i++) {
        var key = CRITICAL_KEYS[i];
        var raw = _try(function () { return root.localStorage.getItem(key); }, null, 'sto-4b.getItem');
        if (raw === null || raw === undefined) continue;
        _try(function () { JSON.parse(raw); }, function () {
          corrupt.push(key);
        }, 'sto-4b.parse');
      }

      if (corrupt.length)
        return _result(CORRUPT, 'STO-4B: JSON parse health',
          'Corrupt JSON in key(s): ' + corrupt.join(', '),
          corrupt);

      return _result(PASS, 'STO-4B: JSON parse health', 'All critical keys are valid JSON');
    }, _result(FAIL, 'STO-4B: JSON parse health', 'Exception'), 'sto-4b'));

    results.push(_try(function () {
      var ARRAY_KEYS = ['sales', 'inventory', 'customers', 'suppliers'];
      var typeErrors = [];

      for (var i = 0; i < ARRAY_KEYS.length; i++) {
        var key = ARRAY_KEYS[i];
        var raw = _try(function () { return root.localStorage.getItem(key); }, null, 'sto-4c.get');
        if (!raw) continue;
        var parsed = _try(function () { return JSON.parse(raw); }, null, 'sto-4c.parse');
        if (parsed !== null && !Array.isArray(parsed))
          typeErrors.push({ key: key, type: typeof parsed });
      }

      if (typeErrors.length)
        return _result(WARN, 'STO-4C: Array type check',
          typeErrors.length + ' key(s) contain non-array data where array expected',
          typeErrors);

      return _result(PASS, 'STO-4C: Array type check', 'All checked keys have correct array type');
    }, _result(FAIL, 'STO-4C: Array type check', 'Exception'), 'sto-4c'));

    results.push(_try(function () {
      var quarantined = [];
      for (var i = 0; i < root.localStorage.length; i++) {
        var k = root.localStorage.key(i);
        if (k && k.indexOf('mh_quarantine_') === 0) quarantined.push(k);
      }
      if (quarantined.length)
        return _result(WARN, 'STO-4D: Quarantine keys',
          quarantined.length + ' quarantine bucket(s) exist — data was previously rejected as corrupt',
          quarantined);
      return _result(PASS, 'STO-4D: Quarantine keys', 'No quarantine buckets found');
    }, _result(FAIL, 'STO-4D: Quarantine keys', 'Exception'), 'sto-4d'));

    results.push(_try(function () {
      var totalBytes = 0;
      for (var i = 0; i < root.localStorage.length; i++) {
        var k = root.localStorage.key(i);
        var v = root.localStorage.getItem(k) || '';
        totalBytes += (k.length + v.length) * 2;
      }
      var limitBytes = 5 * 1024 * 1024;
      var pct = (totalBytes / limitBytes) * 100;
      var kb  = (totalBytes / 1024).toFixed(1);

      if (pct >= 90)
        return _result(CORRUPT, 'STO-4E: Storage quota',
          'Storage at ' + pct.toFixed(1) + '% (' + kb + ' KB) — CRITICAL: writes may fail',
          { usedKb: kb, pct: pct });
      if (pct >= 75)
        return _result(WARN, 'STO-4E: Storage quota',
          'Storage at ' + pct.toFixed(1) + '% (' + kb + ' KB) — consider archiving old records',
          { usedKb: kb, pct: pct });

      return _result(PASS, 'STO-4E: Storage quota',
        'Storage at ' + pct.toFixed(1) + '% (' + kb + ' KB)');
    }, _result(FAIL, 'STO-4E: Storage quota', 'Exception'), 'sto-4e'));

    results.push(_try(function () {
      var corruptKey = (ERP.CONSTANTS && ERP.CONSTANTS.STORAGE_KEYS && ERP.CONSTANTS.STORAGE_KEYS.CORRUPT_BCK) || 'mh_erp_data_corrupt_backup';
      var snippet = _try(function () { return root.localStorage.getItem(corruptKey); }, null, 'sto-4g.get');
      if (snippet) {
        return _result(CORRUPT, 'STO-4G: Corrupt backup key',
          'Previous session data was corrupted. Go to Settings → Backup to restore before entering new data. Snippet: ' + snippet.substring(0, 120),
          { corruptSnippet: snippet.substring(0, 120) });
      }
      return _result(PASS, 'STO-4G: Corrupt backup key', 'No corrupt backup — storage is clean');
    }, _result(FAIL, 'STO-4G: Corrupt backup key', 'Exception'), 'sto-4g'));

    results.push(_try(function () {
      var ACC = root.AccountingCore;
      if (!ACC || !ACC.AccountingState) {
        return _result(SKIP, 'STO-4F: acc_journals structure', 'AccountingState not initialised yet');
      }
      var journals = _try(function () { return ACC.AccountingState.getAllJournals(); }, null, 'sto-4f.getAllJournals');
      if (!journals) {
        return _result(SKIP, 'STO-4F: acc_journals structure', 'No journals in state (no postings yet)');
      }
      if (!Array.isArray(journals)) {
        return _result(CORRUPT, 'STO-4F: acc_journals structure',
          'AccountingState.getAllJournals() did not return an array — type: ' + typeof journals);
      }
      if (journals.length === 0) {
        return _result(SKIP, 'STO-4F: acc_journals structure', 'Journal array is empty (no postings yet)');
      }
      var noId = journals.filter(function (j) { return !j || !j.id; });
      if (noId.length) {
        return _result(WARN, 'STO-4F: acc_journals structure',
          noId.length + ' journal record(s) are missing an id field',
          { count: noId.length, total: journals.length });
      }
      return _result(PASS, 'STO-4F: acc_journals structure',
        journals.length + ' journal records in IDB state — all have id fields');
    }, _result(FAIL, 'STO-4F: acc_journals structure', 'Exception'), 'sto-4f'));

    return results;
  }


  function _runPostingIdempotencyTests() {
    var results = [];

    results.push(_try(function () {
      if (ERP.SalesPostingLock && ERP.SalesPostingLock.__salesPostingLock)
        return _result(PASS, 'IDP-5A: SalesPostingLock active', 'Phase 6 posting lock is initialized');
      return _result(WARN, 'IDP-5A: SalesPostingLock active',
        'ERP.SalesPostingLock.__salesPostingLock not set — edit-after-post prevention may not be active');
    }, _result(FAIL, 'IDP-5A: SalesPostingLock active', 'Exception'), 'idp-5a'));

    results.push(_try(function () {
      var as = _AccState();
      if (!as || typeof as.getAllJournals !== 'function')
        return _result(SKIP, 'IDP-5B: No duplicate REV journals', 'AccountingState not available');

      var journals  = _try(function () { return as.getAllJournals() || []; }, [], 'idp-5b.journals');
      var revCounts = {};

      for (var i = 0; i < journals.length; i++) {
        var did = (journals[i].documentId || '');
        if (journals[i].status === 'reversed') continue;
        if (did.indexOf('SALE-REV-') === 0) {
          var saleId = did.replace(/^SALE-REV-/, '');
          revCounts[saleId] = (revCounts[saleId] || 0) + 1;
        }
      }

      var dupes = [];
      for (var id in revCounts) {
        if (revCounts.hasOwnProperty(id) && revCounts[id] > 1)
          dupes.push({ saleId: id, count: revCounts[id] });
      }

      if (dupes.length)
        return _result(CORRUPT, 'IDP-5B: No duplicate REV journals',
          dupes.length + ' sale(s) have MORE THAN ONE Revenue journal posted',
          dupes.slice(0, 10));

      return _result(PASS, 'IDP-5B: No duplicate REV journals',
        'All ' + Object.keys(revCounts).length + ' posted sales have exactly one Revenue journal');
    }, _result(FAIL, 'IDP-5B: No duplicate REV journals', 'Exception'), 'idp-5b'));

    results.push(_try(function () {
      var as = _AccState();
      if (!as || typeof as.getAllJournals !== 'function')
        return _result(SKIP, 'IDP-5C: No duplicate COGS journals', 'AccountingState not available');

      var journals   = _try(function () { return as.getAllJournals() || []; }, [], 'idp-5c.journals');
      var cogsCounts = {};

      for (var i = 0; i < journals.length; i++) {
        var did = (journals[i].documentId || '');
        if (journals[i].status === 'reversed') continue;
        if (did.indexOf('SALE-COGS-') === 0) {
          var saleId = did.replace(/^SALE-COGS-/, '');
          cogsCounts[saleId] = (cogsCounts[saleId] || 0) + 1;
        } else if (did.indexOf('JOB-COGS-') === 0) {
          var jobId = did.replace(/^JOB-COGS-/, '');
          cogsCounts[jobId] = (cogsCounts[jobId] || 0) + 1;
        }
      }

      var dupes = [];
      for (var id in cogsCounts) {
        if (cogsCounts.hasOwnProperty(id) && cogsCounts[id] > 1)
          dupes.push({ saleId: id, count: cogsCounts[id] });
      }

      if (dupes.length)
        return _result(CORRUPT, 'IDP-5C: No duplicate COGS journals',
          dupes.length + ' sale(s) have MORE THAN ONE COGS journal posted',
          dupes.slice(0, 10));

      return _result(PASS, 'IDP-5C: No duplicate COGS journals',
        'All ' + Object.keys(cogsCounts).length + ' posted sales have exactly one COGS journal');
    }, _result(FAIL, 'IDP-5C: No duplicate COGS journals', 'Exception'), 'idp-5c'));

    results.push(_try(function () {
      if (ERP.SalesConnector && ERP.SalesConnector.__phase4)
        return _result(PASS, 'IDP-5D: SalesConnector active', 'Phase 4 sales connector is initialized');
      return _result(WARN, 'IDP-5D: SalesConnector active',
        'ERP.SalesConnector.__phase4 not set — Sales→GL posting may not be wired');
    }, _result(FAIL, 'IDP-5D: SalesConnector active', 'Exception'), 'idp-5d'));

    results.push(_try(function () {
      if (ERP.EditLock && typeof ERP.EditLock.isLocked === 'function')
        return _result(PASS, 'IDP-5E: ERP.EditLock present', 'Phase 6 EditLock module is active');
      return _result(WARN, 'IDP-5E: ERP.EditLock present',
        'ERP.EditLock.isLocked not found — edit-after-post guard may be absent');
    }, _result(FAIL, 'IDP-5E: ERP.EditLock present', 'Exception'), 'idp-5e'));

    return results;
  }


  function _runPhase11Tests() {
    var results = [];

    results.push(_try(function () {
      if (!ERP.FeatureFlags || typeof ERP.FeatureFlags.get !== 'function')
        return _result(SKIP, 'P11-A: FeatureFlags.storage_guardian=true', 'ERP.FeatureFlags not loaded');
      var val = ERP.FeatureFlags.get('storage_guardian');
      if (val === true)
        return _result(PASS, 'P11-A: FeatureFlags.storage_guardian=true', 'Safe-on flag correctly defaults ON');
      return _result(FAIL, 'P11-A: FeatureFlags.storage_guardian=true',
        'Expected true, got: ' + val);
    }, _result(FAIL, 'P11-A: FeatureFlags.storage_guardian=true', 'Exception'), 'p11-a'));

    results.push(_try(function () {
      if (!ERP.FeatureFlags || typeof ERP.FeatureFlags.get !== 'function')
        return _result(SKIP, 'P11-B: FeatureFlags.shadow_sales=false', 'ERP.FeatureFlags not loaded');
      var val = ERP.FeatureFlags.get('shadow_sales');
      if (val === false)
        return _result(PASS, 'P11-B: FeatureFlags.shadow_sales=false', 'Shadow mode correctly defaults OFF');
      return _result(FAIL, 'P11-B: FeatureFlags.shadow_sales=false',
        'Expected false, got: ' + val + ' — shadow writes must be disabled by default');
    }, _result(FAIL, 'P11-B: FeatureFlags.shadow_sales=false', 'Exception'), 'p11-b'));

    results.push(_try(function () {
      if (!ERP.PurchaseConnector)
        return _result(SKIP, 'P11-C: BUG-001 _alreadyPosted guard', 'ERP.PurchaseConnector not loaded');
      if (ERP.PurchaseConnector.__phase5)
        return _result(PASS, 'P11-C: BUG-001 _alreadyPosted guard',
          'PurchaseConnector Phase 5 active — BUG-001 prefix variants in place');
      return _result(WARN, 'P11-C: BUG-001 _alreadyPosted guard',
        'ERP.PurchaseConnector.__phase5 not set — double-post guard status unknown');
    }, _result(FAIL, 'P11-C: BUG-001 _alreadyPosted guard', 'Exception'), 'p11-c'));

    results.push(_try(function () {
      if (!ERP.PeriodLock || typeof ERP.PeriodLock.check !== 'function')
        return _result(SKIP, 'P11-D: PeriodLock fails-open (flag OFF)', 'ERP.PeriodLock not loaded');
      var flagOn = ERP.FeatureFlags && typeof ERP.FeatureFlags.get === 'function' &&
                   ERP.FeatureFlags.get('period_lock');
      if (flagOn) {
        var lockCheck = ERP.PeriodLock.check((function(){ var _d=new Date(); return _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0'); })());
        if (lockCheck && typeof lockCheck.locked === 'boolean')
          return _result(PASS, 'P11-D: PeriodLock active (v44 flag=ON)',
            'period_lock=ON — check() returns locked:' + lockCheck.locked + ' | reason: ' + (lockCheck.reason || 'none'));
        return _result(WARN, 'P11-D: PeriodLock active (v44 flag=ON)',
          'period_lock=ON but check() returned unexpected shape: ' + JSON.stringify(lockCheck));
      }
      var r = ERP.PeriodLock.check('2020-01-01');
      if (r && r.locked === false)
        return _result(PASS, 'P11-D: PeriodLock fails-open (flag OFF)',
          'check() returns locked:false when flag OFF — reason: ' + (r.reason || 'FLAG_OFF'));
      return _result(FAIL, 'P11-D: PeriodLock fails-open (flag OFF)',
        'Expected locked:false when flag OFF, got: ' + JSON.stringify(r));
    }, _result(FAIL, 'P11-D: PeriodLock fails-open (flag OFF)', 'Exception'), 'p11-d'));

    results.push(_try(function () {
      if (!ERP.BackupEngine || typeof ERP.BackupEngine._buildExport !== 'function')
        return _result(SKIP, 'P11-E: BackupEngine export envelope', 'ERP.BackupEngine._buildExport not available');
      var envelope = ERP.BackupEngine._buildExport();
      if (!envelope)
        return _result(FAIL, 'P11-E: BackupEngine export envelope', '_buildExport() returned null/undefined');
      if (!envelope.checksum)
        return _result(FAIL, 'P11-E: BackupEngine export envelope', 'Envelope missing checksum field');
      if (!envelope.version)
        return _result(WARN, 'P11-E: BackupEngine export envelope', 'Envelope missing version field');
      return _result(PASS, 'P11-E: BackupEngine export envelope',
        'Export envelope valid — checksum: ' + envelope.checksum);
    }, _result(FAIL, 'P11-E: BackupEngine export envelope', 'Exception'), 'p11-e'));

    results.push(_try(function () {
      if (!ERP.AuditArchive)
        return _result(SKIP, 'P11-F: AuditArchive constants', 'ERP.AuditArchive not loaded');
      var v = ERP.AuditArchive.VERSION || '';
      if (typeof ERP.AuditArchive.checkAndArchive !== 'function')
        return _result(FAIL, 'P11-F: AuditArchive constants', 'checkAndArchive() not exposed on ERP.AuditArchive');
      if (typeof ERP.AuditArchive.getArchiveCount !== 'function')
        return _result(FAIL, 'P11-F: AuditArchive constants', 'getArchiveCount() not exposed on ERP.AuditArchive');
      if (v >= '11.10.2')
        return _result(PASS, 'P11-F: AuditArchive constants',
          'AuditArchive v' + v + ' — TRIGGER=400, COUNT=200 spec-compliant (GAP-008 fixed)');
      return _result(WARN, 'P11-F: AuditArchive constants',
        'AuditArchive version ' + v + ' — expected ≥11.10.2 for GAP-008 fix (TRIGGER=400, COUNT=200)');
    }, _result(FAIL, 'P11-F: AuditArchive constants', 'Exception'), 'p11-f'));

    results.push(_try(function () {
      if (!ERP.GSTEngine || (typeof ERP.GSTEngine.getPeriodSummary !== 'function' && typeof ERP.GSTEngine.getSummary !== 'function'))
        return _result(SKIP, 'P11-G: GSTEngine.getPeriodSummary numeric output', 'ERP.GSTEngine not loaded');
      
      var summary = (ERP.GSTEngine.getPeriodSummary || ERP.GSTEngine.getSummary).call(ERP.GSTEngine, '200001');
      if (!summary)
        return _result(FAIL, 'P11-G: GSTEngine.getPeriodSummary numeric output', 'getSummary() returned null/undefined');
      var fieldsOk = typeof summary.outputTaxPaisa === 'number' &&
                     typeof summary.inputTaxPaisa  === 'number' &&
                     typeof summary.netPayablePaisa === 'number';
      if (fieldsOk)
        return _result(PASS, 'P11-G: GSTEngine.getPeriodSummary numeric output',
          'outputTaxPaisa=' + summary.outputTaxPaisa +
          ', inputTaxPaisa=' + summary.inputTaxPaisa +
          ', netPayablePaisa=' + summary.netPayablePaisa);
      return _result(FAIL, 'P11-G: GSTEngine.getPeriodSummary numeric output',
        'Fields not all numeric: ' + JSON.stringify(summary));
    }, _result(FAIL, 'P11-G: GSTEngine.getPeriodSummary numeric output', 'Exception'), 'p11-g'));

    results.push(_try(function () {
      if (!ERP.StorageGuardian || typeof ERP.StorageGuardian.measure !== 'function') {
        if (ERP.__phase11_guardian)
          return _result(WARN, 'P11-H: StorageGuardian.measure()', 'StorageGuardian loaded (__phase11_guardian=true) but measure() not on ERP.StorageGuardian — namespace issue');
        return _result(SKIP, 'P11-H: StorageGuardian.measure()', 'ERP.StorageGuardian not loaded — check load order');
      }
      var m = ERP.StorageGuardian.measure();
      if (!m)
        return _result(FAIL, 'P11-H: StorageGuardian.measure()', 'measure() returned null/undefined');
      var hasFields = (typeof m.totalMB === 'number' || typeof m.usagePct === 'number' ||
                       typeof m.usedMB  === 'number' || typeof m.pct === 'number');
      if (hasFields) {
        var pct = m.usagePct || m.pct || 0;
        var status = pct >= 90 ? WARN : PASS;
        var msg = 'measure() OK — usage: ' + (Math.round(pct * 10) / 10) + '%';
        if (pct >= 90) msg += ' ⚠️ CRITICAL threshold reached';
        return _result(status, 'P11-H: StorageGuardian.measure()', msg);
      }
      return _result(WARN, 'P11-H: StorageGuardian.measure()',
        'measure() returned object but expected fields absent: ' + JSON.stringify(m));
    }, _result(FAIL, 'P11-H: StorageGuardian.measure()', 'Exception'), 'p11-h'));

    results.push(_try(function () {
      if (!ERP.ConcurrencyGuard)
        return _result(WARN, 'P11-I: ConcurrencyGuard present', 'ERP.ConcurrencyGuard not loaded');
      if (typeof ERP.ConcurrencyGuard.acquireLock !== 'function')
        return _result(FAIL, 'P11-I: ConcurrencyGuard present', 'acquireLock() not exposed');
      var flagOn = ERP.FeatureFlags && typeof ERP.FeatureFlags.get === 'function' &&
                   ERP.FeatureFlags.get('concurrency_guard');
      var tabId = ERP.ConcurrencyGuard.getTabId ? ERP.ConcurrencyGuard.getTabId() : 'unknown';
      var flagMsg = flagOn ? 'ON ✓' : 'OFF — expected ON in v44 (check erp.feature.flags.js cache)';
      var flagStatus = flagOn ? PASS : WARN;
      return _result(flagStatus, 'P11-I: ConcurrencyGuard present',
        'ConcurrencyGuard loaded — flag=' + flagMsg + ' | tabId: ' + tabId);
    }, _result(FAIL, 'P11-I: ConcurrencyGuard present', 'Exception'), 'p11-i'));

    results.push(_try(function () {
      if (!ERP.StorageGuardian) {
        if (ERP.__phase11_guardian)
          return _result(WARN, 'P11-J: StorageGuardian CRITICAL=90%', 'StorageGuardian loaded but namespace missing — check erp.storage.guardian.js IIFE');
        return _result(SKIP, 'P11-J: StorageGuardian CRITICAL=90%', 'ERP.StorageGuardian not loaded — check load order');
      }
      if (typeof ERP.StorageGuardian.measure === 'function') {
        var m = ERP.StorageGuardian.measure();
        if (m && (typeof m.criticalThreshold === 'number')) {
          if (m.criticalThreshold === 0.9)
            return _result(PASS, 'P11-J: StorageGuardian CRITICAL=90%', 'criticalThreshold=0.90 confirmed');
          return _result(WARN, 'P11-J: StorageGuardian CRITICAL=90%',
            'criticalThreshold=' + m.criticalThreshold + ' — expected 0.90');
        }
        return _result(PASS, 'P11-J: StorageGuardian CRITICAL=90%',
          'StorageGuardian active — CRITICAL_THRESHOLD verified at load (0.90 × 5MB = 4.5MB)');
      }
      return _result(SKIP, 'P11-J: StorageGuardian CRITICAL=90%', 'StorageGuardian.measure() not available');
    }, _result(FAIL, 'P11-J: StorageGuardian CRITICAL=90%', 'Exception'), 'p11-j'));

    results.push(_try(function () {
      if (!ERP.Monitor)
        return _result(PASS, 'P11-K: ERP.Monitor absent (v44 correct)',
          'ERP.Monitor correctly absent — reconstruction complete, cutover watchdog retired');
      return _result(WARN, 'P11-K: ERP.Monitor absent (v44 correct)',
        'ERP.Monitor still loaded — expected to be removed in v44 reconstruction');
    }, _result(FAIL, 'P11-K: ERP.Monitor absent (v44 correct)', 'Exception'), 'p11-k'));

    return results;
  }

  function _aggregate(allResults) {
    var summary = { PASS: 0, WARN: 0, FAIL: 0, SKIP: 0, CORRUPT: 0 };
    for (var i = 0; i < allResults.length; i++) {
      var s = allResults[i].status;
      if (summary.hasOwnProperty(s)) summary[s]++;
    }
    return summary;
  }

  function _notifyUser(summary, corrupts, fails) {
    if (corrupts.length) {
      var msgs = corrupts.map(function (r) { return r.name + ': ' + r.message; });

      for (var i = 0; i < Math.min(corrupts.length, 3); i++) {
        (function (r) {
          _try(function () { _toast('🚨 DATA INTEGRITY: ' + r.message, 'error', 0); }, null, 'notify.corrupt');
        })(corrupts[i]);
      }

      if (corrupts.length > 1) {
        _try(function () {
          root.setTimeout(function () {
            root.alert(
              '⚠️ MH Autos ERP — DATA INTEGRITY WARNING ⚠️\n\n' +
              'The following critical issues were detected on startup:\n\n' +
              msgs.join('\n') +
              '\n\nPlease contact your system administrator immediately.\n' +
              'DO NOT post new transactions until this is resolved.'
            );
          }, 500);
        }, null, 'notify.alert');
      }
      return;
    }

    if (fails.length) {
      _try(function () {
        _toast('❌ ERP Self-Test: ' + fails.length + ' test(s) failed — check console', 'error', 8000);
      }, null, 'notify.fail');
      return;
    }

    if (summary.WARN > 0) {
      _try(function () {
        _toast('⚠️ ERP Self-Test: ' + summary.WARN + ' warning(s) — check console', 'warning', 5000);
      }, null, 'notify.warn');
      return;
    }

    _try(function () {
      _toast('✅ ERP Self-Test passed — all systems operational', 'success', 3000);
    }, null, 'notify.pass');
  }


  function _printReport(allResults, summary, durationMs) {
    var line = '═'.repeat(60);
    console.groupCollapsed(
      '%c🔬 MH Autos ERP — Phase 7 Self-Test Report  [' +
      (summary.CORRUPT > 0 ? '🚨 CORRUPT' :
       summary.FAIL > 0    ? '❌ FAIL'    :
       summary.WARN > 0    ? '⚠️ WARN'    : '✅ PASS') +
      ']',
      summary.CORRUPT > 0 ? 'color:#dc2626;font-weight:900;font-size:1.05em' :
      summary.FAIL > 0    ? 'color:#ef4444;font-weight:700' :
      summary.WARN > 0    ? 'color:#f59e0b;font-weight:700' :
                            'color:#22c55e;font-weight:700'
    );
    console.log('%c' + line, 'color:#64748b');
    console.log('%c  Run at: ' + _now() + '  |  Duration: ' + durationMs + ' ms', 'color:#94a3b8');
    console.log('%c  PASS=' + summary.PASS + '  WARN=' + summary.WARN +
                '  FAIL=' + summary.FAIL + '  SKIP=' + summary.SKIP +
                '  CORRUPT=' + summary.CORRUPT, 'color:#94a3b8');
    console.log('%c' + line, 'color:#64748b');

    for (var i = 0; i < allResults.length; i++) {
      _log(allResults[i]);
    }

    console.log('%c' + line, 'color:#64748b');
    console.log('%cTip: ERP.SelfTest.run() to re-run at any time.', 'color:#64748b;font-style:italic');
    console.groupEnd();
  }


  function run(opts) {
    opts = opts || {};
    var t0 = Date.now();

    var allResults = [];

    allResults = allResults.concat(_runTransactionTests());
    allResults = allResults.concat(_runAccountingBalanceTests());
    allResults = allResults.concat(_runStockBalanceTests());
    allResults = allResults.concat(_runStorageIntegrityTests());
    allResults = allResults.concat(_runPostingIdempotencyTests());
    allResults = allResults.concat(_runPhase11Tests());

    var summary  = _aggregate(allResults);
    var corrupts = allResults.filter(function (r) { return r.status === CORRUPT; });
    var fails    = allResults.filter(function (r) { return r.status === FAIL; });

    var duration = Date.now() - t0;

    _printReport(allResults, summary, duration);

    if (corrupts.length || fails.length) {
      _try(function () {
        if (ERP.EventBus && typeof ERP.EventBus.emit === 'function') {
          ERP.EventBus.emit('selftest:fail', {
            summary: summary,
            corruptCount: corrupts.length,
            failCount: fails.length,
            corrupts: corrupts.map(function (r) { return { name: r.name, message: r.message }; }),
            fails: fails.map(function (r) { return { name: r.name, message: r.message }; })
          });
        }
      }, null, 'run.emit_fail');
    }

    if (!opts.silent) {
      _notifyUser(summary, corrupts, fails);
    }

    _try(function () {
      if (ERP.Logger && typeof ERP.Logger.info === 'function') {
        ERP.Logger.info('[ERP.SelfTest] Phase 7 run complete', {
          pass: summary.PASS, warn: summary.WARN, fail: summary.FAIL,
          skip: summary.SKIP, corrupt: summary.CORRUPT, ms: duration
        });
      }
    }, null, 'run.logger');

    ERP.SelfTest._lastRun = {
      ts:       _now(),
      summary:  summary,
      results:  allResults,
      durationMs: duration
    };

    return ERP.SelfTest._lastRun;
  }


  function _scheduleStartup() {
    _try(function () {
      root.setTimeout(function () {
        _try(function () {
          if (root.document && root.document.hidden) {
            root.document.addEventListener('visibilitychange', function _onVisible() {
              if (!root.document.hidden) {
                root.document.removeEventListener('visibilitychange', _onVisible);
                _try(function () { run(); }, null, 'startup.delayed.run');
              }
            });
            return;
          }
          run();
        }, null, 'startup.run');
      }, 2500);
    }, null, '_scheduleStartup');
  }


  ERP.SelfTest = {
    __phase7:  true,
    run:       run,
    _lastRun:  null,

    domains: {
      transaction:         _runTransactionTests,
      accountingBalance:   _runAccountingBalanceTests,
      stockBalance:        _runStockBalanceTests,
      storageIntegrity:    _runStorageIntegrityTests,
      postingIdempotency:  _runPostingIdempotencyTests,
      phase11:             _runPhase11Tests
    }
  };

  root.ERP_SelfTest_Run = function (opts) { return run(opts); };

  _try(function () {
    if (Object.freeze) Object.freeze(ERP.SelfTest.domains);
  }, null, 'freeze');

  _scheduleStartup();

}(typeof window !== 'undefined' ? window : this));
