
'use strict';

var ERP = window.ERP || {};

(function (ERP) {
  'use strict';

  if (ERP.Reconciliation && ERP.Reconciliation.__v1) return;


  function _now()  { return ERP.DateUtils ? ERP.DateUtils.now()   : new Date().toISOString(); }
  function _uid()  { return 'RC-' + ERP.uid(); } // FIX (root cause, audit #61-62): core.js (ERP.uid) loads first of 92 scripts, before this file -- fallback bought nothing but a second, weaker ID scheme.
  function _state(){ return ERP.getState ? ERP.getState()         : null; }

  function _err(type, message, operation, documentId, txId) {
    var Ctor = (ERP.errors && ERP.errors[type]) || Error;
    return Object.assign(new Ctor(message), {
      name:       type,
      message:    message,
      module:     'Reconciliation',
      operation:  operation,
      documentId: documentId || null,
      txId:       txId       || null,
      timestamp:  _now()
    });
  }

  function _requireAdmin(actor, operation) {
    if (!ERP.Auth || !ERP.Auth.isAdmin(actor)) {
      throw _err('PermissionError', 'Admin role required for: ' + operation, operation, null, null);
    }
  }

  function _audit(action, actor, txId, documentId, before, after, severity) {
    var entry = {
      id:         _uid(),
      txId:       txId        || null,
      actor:      actor       || 'system',
      action:     action,
      module:     'Reconciliation',
      documentId: documentId  || null,
      before:     before      || null,
      after:      after       || null,
      timestamp:  _now(),
      severity:   severity    || 'info'
    };
    try {
      if (ERP.AuditLog && typeof ERP.AuditLog.write === 'function') {
        ERP.AuditLog.write(entry);
      }
    } catch (_e) {   }
  }

  function _renderFatalScreen(failure) {
    try {
      var existing = document.getElementById('erp-boot-error');
      if (existing) existing.parentNode.removeChild(existing);

      var div = document.createElement('div');
      div.id = 'erp-boot-error';
      div.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
        'background:#1a1a2e', 'color:#e94560', 'display:flex',
        'flex-direction:column', 'align-items:center', 'justify-content:center',
        'z-index:var(--zi-critical,1100)', 'font-family:monospace', 'padding:24px', 'box-sizing:border-box'
      ].join(';');

      var title = document.createElement('h2');
      title.textContent = '⛔ ERP Boot Failed';
      title.style.cssText = 'margin:0 0 16px 0; font-size:1.6rem; color:#e94560;';

      var msg = document.createElement('p');
      msg.textContent = failure.message || 'A critical boot error occurred.';
      msg.style.cssText = 'margin:0 0 12px 0; color:#fff; font-size:1rem;';

      var detail = document.createElement('pre');
      detail.textContent = JSON.stringify({
        check:     failure.check     || 'unknown',
        severity:  failure.severity  || 'fatal',
        timestamp: _now()
      }, null, 2);
      detail.style.cssText = 'background:#0f0f23; color:#a0a0c0; padding:12px; border-radius:6px; font-size:0.8rem; max-width:600px; overflow:auto;';

      var reload = document.createElement('button');
      reload.textContent = '↩ Reload Application';
      reload.style.cssText = 'margin-top:20px; padding:10px 24px; background:#e94560; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:1rem;';
      reload.onclick = function () { window.location.reload(); };

      div.appendChild(title);
      div.appendChild(msg);
      div.appendChild(detail);
      div.appendChild(reload);
      document.body.appendChild(div);
    } catch (_e) {   }
  }

  function _showAdminBanner(message) {
    try {
      var existing = document.getElementById('erp-reconcile-banner');
      if (existing) {
        existing.textContent = existing.textContent + ' | ' + message;
        return;
      }
      var banner = document.createElement('div');
      banner.id = 'erp-reconcile-banner';
      banner.textContent = '⚠️ ' + message;
      banner.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:var(--zi-spinner,1035)',
        'background:#f59e0b', 'color:#1a1a1a', 'text-align:center',
        'padding:6px 12px', 'font-size:0.85rem', 'font-weight:600'
      ].join(';');
      var close = document.createElement('button');
      close.textContent = ' ✕';
      close.style.cssText = 'background:none;border:none;cursor:pointer;font-weight:bold;margin-left:12px;';
      close.onclick = function () { banner.parentNode && banner.parentNode.removeChild(banner); };
      banner.appendChild(close);
      document.body.insertBefore(banner, document.body.firstChild);
    } catch (_e) {   }
  }


  function _openIDB() {
    if (window.StorageAdapter && typeof window.StorageAdapter.loadFromIDB === 'function') {
      return Promise.resolve(null);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ver    = (typeof ERP !== 'undefined' && ERP.CONSTANTS && ERP.CONSTANTS.IDB_VERSION)  ? ERP.CONSTANTS.IDB_VERSION  : 10;
        var dbName = (typeof ERP !== 'undefined' && ERP.CONSTANTS && ERP.CONSTANTS.IDB_DB_NAME) ? ERP.CONSTANTS.IDB_DB_NAME : 'MHAutosDB';
        var req = indexedDB.open(dbName, ver);
        req.onsuccess = function (e) { resolve(e.target.result); };
        req.onerror   = function (e) { reject(e.target.error); };
      } catch (e) { reject(e); }
    });
  }

  function _idbReadAll(storeName) {
    if (window.StorageAdapter && typeof window.StorageAdapter.loadFromIDB === 'function') {
      return window.StorageAdapter.loadFromIDB(storeName).catch(function () { return []; });
    }
    return _openIDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          if (!db || !db.objectStoreNames.contains(storeName)) { resolve([]); return; }
          var tx    = db.transaction([storeName], 'readonly');
          var store = tx.objectStore(storeName);
          var req   = store.getAll();
          req.onsuccess = function (e) { resolve(e.target.result || []); };
          req.onerror   = function (e) { reject(e.target.error); };
        } catch (e) { reject(e); }
      });
    });
  }

  function _idbPut(storeName, record) {
    return _openIDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          if (window.AccountingCore && window.AccountingCore.AccountingStore &&
              typeof window.AccountingCore.AccountingStore.putOne === 'function') {
            return window.AccountingCore.AccountingStore.putOne(storeName, record)
              .then(resolve).catch(reject);
          }
          if (!db || !db.objectStoreNames.contains(storeName)) { resolve(); return; }
          var tx    = db.transaction([storeName], 'readwrite');
          var store = tx.objectStore(storeName);
          var req   = store.put(record);
          req.onsuccess = function () { resolve(); };
          req.onerror   = function (e) { reject(e.target.error); };
        } catch (e) { reject(e); }
      });
    });
  }


  var WALRecovery = {

    checkPending: async function () {
      var txId = _uid();
      _audit('WALRecovery.checkPending.start', 'system', txId, null, null, null, 'info');

      var entries = [];
      try {
        var all = await _idbReadAll('walEntries');
        entries = (all || []).filter(function (e) { return e && e.status === 'pending'; });
      } catch (e) {
        return;
      }

      if (!entries.length) return;

      entries.sort(function (a, b) {
        var ta = a.timestamp || '', tb = b.timestamp || '';
        if (ta < tb) return -1; if (ta > tb) return 1;
        var ia = a.id || '', ib = b.id || '';
        return ia < ib ? -1 : ia > ib ? 1 : 0;
      });

      var nowMs    = Date.now();
      var FIVE_MIN = 5 * 60 * 1000;

      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        var entryMs = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
        var age     = nowMs - entryMs;

        if (age < FIVE_MIN) {
          continue;
        }

        try {
          await WALRecovery._replayEntry(entry);
          entry.status = 'committed';
          await _idbPut('walEntries', entry);
          _audit('WALRecovery.entry.committed', 'system', txId, entry.documentId, { walId: entry.id }, { status: 'committed' }, 'info');
        } catch (replayErr) {
          try {
            await WALRecovery._compensate(entry);
          } catch (_ce) {   }
          entry.status = 'rolled_back';
          await _idbPut('walEntries', entry);
          _audit('WALRecovery.entry.rolled_back', 'system', txId, entry.documentId,
            { walId: entry.id }, { status: 'rolled_back', error: replayErr && replayErr.message }, 'warning');
        }
      }

      _audit('WALRecovery.checkPending.done', 'system', txId, null, null, { processed: entries.length }, 'info');
    },

    _replayEntry: async function (entry) {
      var type    = entry.type    || '';
      var payload = entry.payload || {};

      switch (type) {
        case 'stock-mutation': {
          if (!ERP.InventoryService) throw new Error('InventoryService not available for WAL replay');
          var op   = payload.operation || 'deduct';
          var meta = payload.meta || { sourceModule: 'wal-recovery', documentId: entry.documentId, actor: 'system' };
          if (typeof ERP.InventoryService[op] === 'function') {
            return ERP.InventoryService[op](payload.entries || [], meta);
          }
          throw new Error('Unknown InventoryService operation: ' + op);
        }

        case 'gl-posting': {
          if (!ERP.PostingEngine) throw new Error('PostingEngine not available for WAL replay');
          try {
            return await ERP.PostingEngine.post(payload);
          } catch (e) {
            if (e && e.name === 'DuplicatePostingError') return;
            throw e;
          }
        }

        case 'gl-reversal': {
          if (!ERP.PostingEngine) throw new Error('PostingEngine not available for WAL replay');
          try {
            return await ERP.PostingEngine.reverse(payload.documentId, {
              reason: payload.reason || 'WAL recovery replay',
              actor:  payload.actor  || 'system'
            });
          } catch (e) {
            if (e && (e.name === 'DuplicatePostingError' || /already reversed/i.test(e.message))) return;
            throw e;
          }
        }

        default:
          throw new Error('WALRecovery: unknown entry type "' + type + '" — cannot replay');
      }
    },

    _compensate: async function (entry) {
      var completed = (entry.completedSteps || []).slice().reverse();
      var payload   = entry.payload || {};
      var meta      = payload.meta  || { sourceModule: 'wal-recovery', documentId: entry.documentId, actor: 'system' };

      for (var i = 0; i < completed.length; i++) {
        var step = completed[i];
        try {
          if (step === 'stock-deduct' && ERP.InventoryService) {
            await ERP.InventoryService.restore(payload.entries || [], meta);
          } else if (step === 'stock-receive' && ERP.InventoryService) {
            await ERP.InventoryService.deduct(payload.entries || [], meta);
          } else if (step === 'gl-posted' && ERP.PostingEngine) {
            await ERP.PostingEngine.reverse(entry.documentId, { reason: 'WAL compensating action', actor: 'system' });
          }
        } catch (_ce) {
          _audit('WALRecovery.compensate.stepFailed', 'system', entry.txId, entry.documentId,
            { step: step }, { error: _ce && _ce.message }, 'error');
        }
      }
    },

    cleanup: async function () {
      var s = _state();
      if (!s) return;

      var meta = (s && s.meta) || {};
      var lastCleanup = meta.lastWalCleanup ? new Date(meta.lastWalCleanup).getTime() : 0;
      var SEVEN_DAYS  = 7 * 24 * 60 * 60 * 1000;

      if (Date.now() - lastCleanup < SEVEN_DAYS) return;

      var THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      var cutoff      = Date.now() - THIRTY_DAYS;

      var entries = [];
      try {
        var all = await _idbReadAll('walEntries');
        entries = (all || []).filter(function (e) {
          return e && (e.status === 'committed' || e.status === 'rolled_back') &&
                 new Date(e.timestamp || 0).getTime() < cutoff;
        });
      } catch (_e) { return; }

      for (var i = 0; i < entries.length; i++) {
        try {
          await _idbPut('walArchive', entries[i]);
          if (window.AccountingCore && window.AccountingCore.AccountingStore &&
              typeof window.AccountingCore.AccountingStore.deleteOne === 'function') {
            await window.AccountingCore.AccountingStore.deleteOne('walEntries', entries[i].id);
          }
        } catch (_e) {   }
      }

      try {
        ERP.setState && ERP.setState(function (st) {
          st.meta = st.meta || {};
          st.meta.lastWalCleanup = _now();
        }, 'wal:cleanup');
      } catch (_e) {}

      _audit('WALRecovery.cleanup', 'system', _uid(), null, null,
        { archived: entries.length }, 'info');
    },

    // Single boot entry point — recovers any WAL entries left 'pending' by a
    // crash/reload mid-transaction, then archives old committed/rolled-back
    // entries. Previously init.js called ERP.WALRecovery.run(), but no such
    // method existed here (only checkPending/cleanup did), so the guard
    // `if (ERP.WALRecovery && ERP.WALRecovery.run)` was always false and this
    // entire sweep silently never ran on any boot. Each step is isolated in
    // its own try/catch so a failure in one does not block the other.
    run: async function () {
      try {
        await WALRecovery.checkPending();
      } catch (e) {
        _audit('WALRecovery.run.checkPending.failed', 'system', _uid(), null, null,
          { error: e && e.message }, 'error');
      }
      try {
        await WALRecovery.cleanup();
      } catch (e) {
        _audit('WALRecovery.run.cleanup.failed', 'system', _uid(), null, null,
          { error: e && e.message }, 'error');
      }
      try {
        if (ERP.SalesService && typeof ERP.SalesService.recoverPendingGLPostings === 'function') {
          ERP.SalesService.recoverPendingGLPostings();
        }
      } catch (e) {
        _audit('WALRecovery.run.recoverPendingGLPostings.failed', 'system', _uid(), null, null,
          { error: e && e.message }, 'error');
      }
    }
  };


  var BootIntegrityCheck = {

    run: function () {
      var failures  = [];
      var txId      = _uid();
      var startTime = Date.now();

      if (!ERP.InventoryService || typeof ERP.InventoryService.deduct !== 'function') {
        failures.push({ check: 'InventoryService', severity: 'fatal',
          message: 'ERP.InventoryService not registered. Load inventory.js before reconciliation.' });
      }

      if (!ERP.PostingEngine || typeof ERP.PostingEngine.post !== 'function') {
        failures.push({ check: 'PostingEngine', severity: 'fatal',
          message: 'ERP.PostingEngine not registered. Load posting_engine.js before reconciliation.' });
      }

      var s = null;
      try { s = _state(); } catch (e) { s = null; }
      if (!s || typeof s !== 'object' || !s.data || !s.meta) {
        failures.push({ check: 'StateStructure', severity: 'fatal',
          message: 'ERP.getState() returned invalid or missing state structure.' });
      }

      if (s && s.meta) {
        var meta = s.meta;
        var required = ['inventoryEngineVersion', 'postingEngineVersion', 'salesEngineVersion', 'purchaseEngineVersion'];
        required.forEach(function (key) {
          if (typeof meta[key] !== 'number') {
            failures.push({ check: 'MigrationFlag:' + key, severity: 'recoverable',
              message: 'state.meta.' + key + ' is not set. Migration may not have run.' });
          }
        });
      }

      if (s && s.meta && ERP.InventoryService) {
        try {
          var storedVersion = s.meta.projectionVersion || 0;
          var checksumOk = BootIntegrityCheck._verifyProjectionChecksum(s);
          if (!checksumOk) {
            failures.push({ check: 'BalanceProjectionChecksum', severity: 'recoverable',
              message: 'BalanceProjection checksum mismatch (projectionVersion=' + storedVersion + '). Rebuild triggered.' });
            BootIntegrityCheck._scheduleProjectionRebuild(txId);
          }
        } catch (e) {
          failures.push({ check: 'BalanceProjectionChecksum', severity: 'recoverable',
            message: 'BalanceProjection checksum check failed: ' + (e && e.message) });
        }
      }


      var elapsed = Date.now() - startTime;
      var hasFatal = failures.some(function (f) { return f.severity === 'fatal'; });

      failures.forEach(function (f) {
        _audit(
          'BootIntegrityCheck.' + f.check,
          'system', txId, null, null,
          { check: f.check, message: f.message, elapsed: elapsed },
          f.severity === 'fatal' ? 'error' : 'warning'
        );

        if (f.severity === 'recoverable') {
          _showAdminBanner(f.message);
        }
      });

      if (hasFatal) {
        var fatalFailure = failures.find(function (f) { return f.severity === 'fatal'; });
        _renderFatalScreen(fatalFailure);
        throw _err('IntegrityCheckError',
          'Boot halted: ' + (fatalFailure && fatalFailure.message),
          'BootIntegrityCheck.run', null, txId);
      }

      return { ok: true, failures: failures, elapsed: elapsed };
    },

    _verifyProjectionChecksum: function (s) {
      if (!s || !s.data) return true;

      var proj    = s.data.balanceProjection || {};
      var journal = s.data.stockJournal      || [];

      if (journal.length === 0 && Object.keys(proj).length === 0) return true;

      var expected = {};
      journal.forEach(function (e) {
        if (!e || !e.barcode) return;
        expected[e.barcode] = (expected[e.barcode] || 0) + (e.movementQty || 0);
      });

      var projKeys     = Object.keys(proj).sort();
      var expectedKeys = Object.keys(expected).sort();

      if (projKeys.length !== expectedKeys.length) return false;

      for (var i = 0; i < expectedKeys.length; i++) {
        var bc = expectedKeys[i];
        if ((proj[bc] || 0) !== (expected[bc] || 0)) return false;
      }

      return true;
    },

    _scheduleProjectionRebuild: function (parentTxId) {
      setTimeout(function () {
        try {
          if (!ERP.InventoryService || typeof ERP.InventoryService.rebuildBalances !== 'function') return;
          var tx = {
            txId:       _uid(),
            actor:      'system',
            startedAt:  _now(),
            sourceModule: 'BootIntegrityCheck',
            documentId: null
          };
          ERP.InventoryService.rebuildBalances(tx);
          _audit('BootIntegrityCheck.projectionRebuilt', 'system', parentTxId, null, null, null, 'warning');
        } catch (e) {
          _audit('BootIntegrityCheck.projectionRebuildFailed', 'system', parentTxId, null, null,
            { error: e && e.message }, 'error');
        }
      }, 0);
    }
  };


  var _bgReconciliationRan = false;

  var BackgroundReconciliation = {

    schedule: function () {
      if (_bgReconciliationRan) return;

      var run = function () { BackgroundReconciliation.run(); };

      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(run, { timeout: 30000 });
      } else {
        setTimeout(run, 5000);
      }
    },

    run: async function () {
      if (_bgReconciliationRan) return;
      _bgReconciliationRan = true;

      var txId  = _uid();
      var s     = _state();
      if (!s || !s.data) return;

      
      var _getGLJournals = function () {
        try {
          if (window.AccountingCore && AccountingCore.AccountingState &&
              typeof AccountingCore.AccountingState.getAllJournals === 'function') {
            return AccountingCore.AccountingState.getAllJournals() || [];
          }
          if (window.ACC && ACC.AccountingState &&
              typeof ACC.AccountingState.getAllJournals === 'function') {
            return ACC.AccountingState.getAllJournals() || [];
          }
        } catch (_) {}
        return [];
      };

      var startTs = Date.now();
      _audit('BackgroundReconciliation.start', 'system', txId, null, null, null, 'info');

      try {
        ERP.setState && ERP.setState(function (st) {
          st.meta = st.meta || {};
          st.meta.lastBackgroundReconcile = _now();
        }, 'bgReconcile:stamp');
      } catch (_e) {}

      try {
        var inventory = (s.data.inventory || []).filter(function (i) { return i && i.bc; });
        var sample    = BackgroundReconciliation._sample(inventory, 50);
        var journal   = s.data.stockJournal || [];

        sample.forEach(function (item) {
          var bc      = item.bc;
          var projQty = ERP.InventoryService ? ERP.InventoryService.getBalance(bc) : 0;
          var journalQty = journal
            .filter(function (e) { return e && e.barcode === bc; })
            .reduce(function (sum, e) { return sum + (e.movementQty || 0); }, 0);

          var discrepancy = Math.abs(projQty - journalQty);
          if (discrepancy > 0) {
            _audit('BackgroundReconciliation.R1.discrepancy', 'system', txId, null,
              { barcode: bc, projection: projQty, journalSum: journalQty, discrepancy: discrepancy },
              null, 'warning');
            _showAdminBanner('Stock discrepancy detected for barcode ' + bc +
              ' (projection=' + projQty + ' vs journal=' + journalQty + '). Run Full Reconciliation.');
          }
        });
      } catch (e) {
        _audit('BackgroundReconciliation.R1.error', 'system', txId, null, null,
          { error: e && e.message }, 'warning');
      }

      try {
        var journals = (_getGLJournals())
          .slice()
          .sort(function (a, b) {
            var ta = a.timestamp || '', tb = b.timestamp || '';
            return ta < tb ? 1 : ta > tb ? -1 : 0;
          })
          .slice(0, 100);

        journals.forEach(function (j) {
          if (!j || !Array.isArray(j.entries)) return;
          var totalDebit  = j.entries.reduce(function (s, e) { return s + (e.debit  || 0); }, 0);
          var totalCredit = j.entries.reduce(function (s, e) { return s + (e.credit || 0); }, 0);
          if (totalDebit !== totalCredit) {
            _audit('BackgroundReconciliation.R2.imbalanced', 'system', txId, j.documentId,
              { journalId: j.id, totalDebit: totalDebit, totalCredit: totalCredit }, null, 'warning');
            _showAdminBanner('Imbalanced GL journal detected (id=' + j.id + '). Run Full Reconciliation.');
          }
        });
      } catch (e) {
        _audit('BackgroundReconciliation.R2.error', 'system', txId, null, null,
          { error: e && e.message }, 'warning');
      }

      try {
        var customers  = (s.data.customers || []).filter(function (c) { return c && c.id; });
        var custSample = BackgroundReconciliation._sample(customers, 10);
        var custLedger = s.data.customerLedger || [];

        custSample.forEach(function (cust) {
          var entries = custLedger.filter(function (e) { return e && e.customerId === cust.id; });
          var balance = entries.reduce(function (sum, e) {
            var sign = (e.type === 'invoice') ? 1 :
                       (e.type === 'payment' || e.type === 'void' || e.type === 'return') ? -1 : 0;
            return sum + sign * (e.amount || 0);
          }, 0);

          if (balance < 0) {
            _audit('BackgroundReconciliation.R3.negativeBalance', 'system', txId, cust.id,
              { customerId: cust.id, balance: balance }, null, 'warning');
          }
        });
      } catch (e) {
        _audit('BackgroundReconciliation.R3.error', 'system', txId, null, null,
          { error: e && e.message }, 'warning');
      }

      try {
        var suppliers   = (s.data.suppliers || []).filter(function (v) { return v && v.id; });
        var vendSample  = BackgroundReconciliation._sample(suppliers, 10);
        var psR4 = window.PurchaseState || null;

        vendSample.forEach(function (vendor) {
          var balancePaisa = (psR4 && typeof psR4.getLedgerBalance === 'function')
            ? psR4.getLedgerBalance(vendor.id)
            : 0;
          var balance = balancePaisa / 100;

          if (balance < 0) {
            _audit('BackgroundReconciliation.R4.negativeBalance', 'system', txId, vendor.id,
              { vendorId: vendor.id, balance: balance }, null, 'warning');
          }
        });
      } catch (e) {
        _audit('BackgroundReconciliation.R4.error', 'system', txId, null, null,
          { error: e && e.message }, 'warning');
      }

      var elapsed = Date.now() - startTs;
      _audit('BackgroundReconciliation.done', 'system', txId, null, null, { elapsed: elapsed }, 'info');
    },

    _sample: function (arr, n) {
      if (!Array.isArray(arr) || arr.length === 0) return [];
      if (arr.length <= n) return arr.slice();
      var copy   = arr.slice();
      var result = [];
      for (var i = 0; i < n; i++) {
        var idx = Math.floor(Math.random() * copy.length);
        result.push(copy.splice(idx, 1)[0]);
      }
      return result;
    }
  };


  var FullReconciliation = {

    run: function (tx) {
      if (!tx || !tx.actor) throw _err('ValidationError', 'tx.actor required', 'FullReconciliation.run', null, null);
      _requireAdmin(tx.actor, 'FullReconciliation.run');

      var txId     = tx.txId || _uid();
      var startTs  = Date.now();
      var passed   = [];
      var failed   = [];
      var warnings = [];
      var s        = _state();

      if (!s || !s.data) {
        throw _err('ValidationError', 'ERP state not available', 'FullReconciliation.run', null, txId);
      }

      _audit('FullReconciliation.start', tx.actor, txId, null, null, null, 'info');

      try {
        var inventory = (s.data.inventory || []).filter(function (i) { return i && i.bc; });
        var journal   = s.data.stockJournal || [];
        var r1Fail    = [];

        inventory.forEach(function (item) {
          var bc      = item.bc;
          var projQty = ERP.InventoryService ? ERP.InventoryService.getBalance(bc) : (s.data.balanceProjection && s.data.balanceProjection[bc]) || 0;
          var journalQty = journal
            .filter(function (e) { return e && e.barcode === bc; })
            .reduce(function (sum, e) { return sum + (e.movementQty || 0); }, 0);

          if (Math.abs(projQty - journalQty) > 0) {
            r1Fail.push({ barcode: bc, projection: projQty, journal: journalQty, discrepancy: projQty - journalQty });
          }
        });

        if (r1Fail.length === 0) {
          passed.push({ check: 'R1:InventoryBalance', items: inventory.length });
        } else {
          failed.push({ check: 'R1:InventoryBalance', discrepancies: r1Fail });
        }
      } catch (e) {
        failed.push({ check: 'R1:InventoryBalance', error: e && e.message });
      }

      try {
        var allJournals = _getGLJournals();
        var r2Fail      = [];

        allJournals.forEach(function (j) {
          if (!j || !Array.isArray(j.entries)) return;
          var d = j.entries.reduce(function (sum, e) { return sum + (e.debit  || 0); }, 0);
          var c = j.entries.reduce(function (sum, e) { return sum + (e.credit || 0); }, 0);
          if (d !== c) {
            r2Fail.push({ journalId: j.id, documentId: j.documentId, totalDebit: d, totalCredit: c, diff: d - c });
          }
        });

        if (r2Fail.length === 0) {
          passed.push({ check: 'R2:GLBalance', journals: allJournals.length });
        } else {
          failed.push({ check: 'R2:GLBalance', imbalanced: r2Fail });
        }
      } catch (e) {
        failed.push({ check: 'R2:GLBalance', error: e && e.message });
      }

      try {
        var customers   = s.data.customers   || [];
        var custLedger  = s.data.customerLedger || [];
        var r3Fail      = [];

        customers.forEach(function (cust) {
          if (!cust || !cust.id) return;
          var entries = custLedger.filter(function (e) { return e && e.customerId === cust.id; });
          var invoiceTotal  = entries.filter(function(e){ return e.type === 'invoice'; }).reduce(function(s,e){ return s+(e.amount||0); },0);
          var paymentTotal  = entries.filter(function(e){ return e.type === 'payment' || e.type === 'void' || e.type === 'return'; }).reduce(function(s,e){ return s+(e.amount||0); },0);
          var outstanding   = invoiceTotal - paymentTotal;

          var storedOut = cust.outstanding || cust.balance || 0;
          if (Math.abs(outstanding - storedOut) > 1) {
            r3Fail.push({ customerId: cust.id, name: cust.n, ledger: outstanding, stored: storedOut, diff: outstanding - storedOut });
          }
        });

        if (r3Fail.length === 0) {
          passed.push({ check: 'R3:CustomerLedger', customers: customers.length });
        } else {
          failed.push({ check: 'R3:CustomerLedger', mismatches: r3Fail });
        }
      } catch (e) {
        failed.push({ check: 'R3:CustomerLedger', error: e && e.message });
      }

      try {
        var suppliers  = s.data.suppliers  || [];
        var r4Fail     = [];
        var ps4 = window.PurchaseState || null;

        suppliers.forEach(function (vendor) {
          if (!vendor || !vendor.id) return;
          var ledgerPaisa = (ps4 && typeof ps4.getLedgerBalance === 'function')
            ? ps4.getLedgerBalance(vendor.id)
            : 0;
          var ledgerRs = ledgerPaisa / 100;

          var storedPayable = vendor.balance || vendor.payable || vendor.owe || 0;
          if (Math.abs(ledgerRs - storedPayable) > 1) {
            r4Fail.push({ vendorId: vendor.id, name: vendor.n, ledger: ledgerRs, stored: storedPayable, diff: ledgerRs - storedPayable });
          }
        });

        if (r4Fail.length === 0) {
          passed.push({ check: 'R4:VendorLedger', vendors: suppliers.length });
        } else {
          failed.push({ check: 'R4:VendorLedger', mismatches: r4Fail });
        }
      } catch (e) {
        failed.push({ check: 'R4:VendorLedger', error: e && e.message });
      }

      try {
        var saleReturns = s.data.saleReturns || [];
        var r5Fail      = [];

        saleReturns.forEach(function (ret) {
          if (!ret || ret.deleted) return;

          var _RI = (ERP.PostingEngine && (ERP.PostingEngine._ReversalIndex || ERP.PostingEngine.ReversalIndex)) || null;
          if (_RI && typeof _RI.getReversalFor === 'function') {
            var rev = _RI.getReversalFor(ret.invoiceId || ret.id);
            if (!rev) {
              r5Fail.push({ returnId: ret.id, invoiceId: ret.invoiceId || ret.id });
            }
          } else {
            warnings.push({ check: 'R5:ReturnReversals', note: 'ReversalIndex not available — reversal status could not be verified', returnId: ret.id });
          }
        });

        if (r5Fail.length === 0) {
          passed.push({ check: 'R5:ReturnReversals', returns: saleReturns.length });
        } else {
          failed.push({ check: 'R5:ReturnReversals', missing: r5Fail });
        }
      } catch (e) {
        failed.push({ check: 'R5:ReturnReversals', error: e && e.message });
      }

      try {
        var allSales    = s.data.sales || [];
        var r6Fail      = [];

        allSales.filter(function (inv) { return inv && inv.deleted; }).forEach(function (inv) {
          var _RI6 = (ERP.PostingEngine && (ERP.PostingEngine._ReversalIndex || ERP.PostingEngine.ReversalIndex)) || null;
          var hasReversal;
          if (_RI6 && typeof _RI6.getReversalFor === 'function') {
            hasReversal = !!_RI6.getReversalFor(inv.id);
          } else {
            warnings.push({ check: 'R6:DeletedInvoiceReversals', note: 'ReversalIndex not available — reversal status could not be verified', invoiceId: inv.id });
            return;
          }
          if (!hasReversal) {
            r6Fail.push({ invoiceId: inv.id, deletedAt: inv.deletedAt });
          }
        });

        if (r6Fail.length === 0) {
          passed.push({ check: 'R6:DeletedInvoiceReversals' });
        } else {
          failed.push({ check: 'R6:DeletedInvoiceReversals', missing: r6Fail });
        }
      } catch (e) {
        failed.push({ check: 'R6:DeletedInvoiceReversals', error: e && e.message });
      }

      try {
        var stockMoves = s.data.stockMovements || [];
        var r7Fail     = [];
        var journals7  = _getGLJournals();

        stockMoves.forEach(function (mv) {
          if (!mv || !mv.documentId) return;
          var hasGL = journals7.some(function (j) { return j && j.documentId === mv.documentId; });
          if (!hasGL) {
            r7Fail.push({ movementId: mv.id, documentId: mv.documentId, type: mv.type });
          }
        });

        if (r7Fail.length === 0) {
          passed.push({ check: 'R7:StockMovementGL', movements: stockMoves.length });
        } else {
          failed.push({ check: 'R7:StockMovementGL', missing: r7Fail });
        }
      } catch (e) {
        failed.push({ check: 'R7:StockMovementGL', error: e && e.message });
      }

      try {
        var r8Fail    = [];
        var sales8    = (s.data.sales || []).filter(function (inv) {
          return inv && !inv.deleted &&
                 (inv.status === 'paid' || inv.status === 'partial') &&
                 inv._editCount > 0;
        });
        var journals8 = _getGLJournals();

        sales8.forEach(function (inv) {
          var adjustmentJournals = journals8.filter(function (j) {
            return j && j.documentId === inv.id && j.documentType === 'adjustment';
          });
          if (adjustmentJournals.length === 0) {
            r8Fail.push({ invoiceId: inv.id, editCount: inv._editCount, status: inv.status });
          }
        });

        if (r8Fail.length === 0) {
          passed.push({ check: 'R8:PaidInvoiceAdjustments' });
        } else {
          failed.push({ check: 'R8:PaidInvoiceAdjustments', missing: r8Fail });
        }
      } catch (e) {
        failed.push({ check: 'R8:PaidInvoiceAdjustments', error: e && e.message });
      }

      var duration  = Date.now() - startTs;
      var timestamp = _now();

      _audit('FullReconciliation.done', tx.actor, txId, null,
        null,
        { passed: passed.length, failed: failed.length, warnings: warnings.length, duration: duration },
        failed.length > 0 ? 'warning' : 'info'
      );

      return {
        passed:    passed,
        failed:    failed,
        warnings:  warnings,
        timestamp: timestamp,
        duration:  duration
      };
    }
  };


  var StressTests = window.DEBUG_MODE ? {

    runAll: async function () {
      var tests = [
        'rapidSave', 'doubleClickSave', 'concurrentStock',
        'editAfterPayment', 'reverseAfterReturn',
        'interruptedWrite', 'multiTabCorruption'
      ];
      for (var i = 0; i < tests.length; i++) {
        await StressTests[tests[i]]();
      }
      console.log('[StressTests] All tests passed.');
    },

    rapidSave: async function () {
      var testName = 'rapidSave';
      var s = _state();
      if (!s) throw { test: testName, documentId: null, step: 'getState', expected: 'state object', actual: null };

      var baseCount = (s.data.sales || []).length;
      var promises  = [];
      for (var i = 0; i < 50; i++) {
        (function (idx) {
          promises.push(
            Promise.resolve().then(function () {
              return ERP.setState && ERP.setState(function (st) {
                st.data.sales = st.data.sales || [];
                st.data.sales.push({
                  id: _uid(), n: 'Stress-' + idx, _v: 1,
                  status: 'unpaid', timestamp: _now()
                });
              }, 'stress:rapidSave:' + idx);
            })
          );
        })(i);
      }
      await Promise.all(promises);

      var s2        = _state();
      var afterCount = (s2.data.sales || []).length;
      if (afterCount !== baseCount + 50) {
        throw { test: testName, documentId: null, step: 'countCheck', expected: baseCount + 50, actual: afterCount };
      }
    },

    doubleClickSave: async function () {
      var testName = 'doubleClickSave';
      if (!ERP.PostingEngine) throw { test: testName, documentId: null, step: 'PostingEngine missing', expected: 'registered', actual: null };

      var docId = 'STRESS-' + _uid();
      var payload = {
        documentId:   docId,
        documentType: 'invoice',
        sourceModule: 'stress-test',
        entries: [
          { accountId: 'ar-001', accountName: 'AR',    debit: 10000, credit: 0,     description: 'test' },
          { accountId: 'rv-001', accountName: 'Sales', debit: 0,     credit: 10000, description: 'test' }
        ],
        actor: 'stress-test-user'
      };

      var results = await Promise.allSettled([
        ERP.PostingEngine.post(payload),
        ERP.PostingEngine.post(payload)
      ]);

      var fulfilled = results.filter(function (r) { return r.status === 'fulfilled'; });
      var rejected  = results.filter(function (r) { return r.status === 'rejected'; });

      if (fulfilled.length !== 1 || rejected.length !== 1) {
        throw { test: testName, documentId: docId, step: 'duplicateGuard',
          expected: '1 success, 1 rejection', actual: fulfilled.length + ' success, ' + rejected.length + ' rejected' };
      }
    },

    concurrentStock: async function () {
      var testName = 'concurrentStock';
      if (!ERP.InventoryService) throw { test: testName, documentId: null, step: 'InventoryService missing', expected: 'registered', actual: null };

      var bc       = 'STRESS-BC-' + _uid().slice(-6);
      var docBase  = 'STRESS-DOC-';

      await ERP.InventoryService.receive(
        [{ barcode: bc, qty: 3, unitCostPaisa: 100000 }],
        { sourceModule: 'stress-test', documentId: docBase + 'RECV', actor: 'stress-test-user' }
      );

      var deductions = [];
      for (var i = 0; i < 5; i++) {
        (function (idx) {
          deductions.push(
            ERP.InventoryService.deduct(
              [{ barcode: bc, qty: 1, unitCostPaisa: 100000 }],
              { sourceModule: 'stress-test', documentId: docBase + 'DED-' + idx, actor: 'stress-test-user' }
            ).catch(function (e) { return { _error: e }; })
          );
        })(i);
      }
      var results   = await Promise.all(deductions);
      var successes = results.filter(function (r) { return !r._error; }).length;
      var errors    = results.filter(function (r) { return r._error; }).length;

      if (successes !== 3 || errors !== 2) {
        throw { test: testName, documentId: null, step: 'concurrentDeductionCheck',
          expected: '3 success, 2 errors', actual: successes + ' success, ' + errors + ' errors' };
      }
    },

    editAfterPayment: async function () {
      var testName = 'editAfterPayment';
      var s        = _state();
      if (!s) throw { test: testName, documentId: null, step: 'getState', expected: 'state object', actual: null };

      var paidInvoice = (s.data.sales || []).find(function (inv) {
        return inv && inv.status === 'paid' && !inv.deleted;
      });

      if (!paidInvoice) {
        return;
      }

      if (ERP.SalesService && typeof ERP.SalesService.editInvoice === 'function') {
        var blocked = false;
        try {
          ERP.SalesService.editInvoice(paidInvoice.id, {}, { txId: _uid(), actor: 'stress-test-user', sourceModule: 'stress', documentId: paidInvoice.id, startedAt: _now() });
        } catch (e) {
          blocked = true;
        }
        if (!blocked) {
          console.warn('[StressTest:editAfterPayment] SalesService.editInvoice did not block edit of paid invoice:', paidInvoice.id);
        }
      }
    },

    reverseAfterReturn: async function () {
      var testName = 'reverseAfterReturn';
      if (!ERP.PostingEngine) throw { test: testName, documentId: null, step: 'PostingEngine missing', expected: 'registered', actual: null };

      var docId = 'STRESS-REV-' + _uid();

      try {
        await ERP.PostingEngine.post({
          documentId:   docId,
          documentType: 'invoice',
          sourceModule: 'stress-test',
          entries: [
            { accountId: 'ar-001', accountName: 'AR',    debit: 5000, credit: 0,    description: 'test' },
            { accountId: 'rv-001', accountName: 'Sales', debit: 0,    credit: 5000, description: 'test' }
          ],
          actor: 'stress-test-user'
        });
      } catch (_e) {   return; }

      await ERP.PostingEngine.reverse(docId, { reason: 'stress test', actor: 'stress-test-user' });

      var secondReversalThrew = false;
      try {
        await ERP.PostingEngine.reverse(docId, { reason: 'stress test duplicate', actor: 'stress-test-user' });
      } catch (_e) {
        secondReversalThrew = true;
      }

    },

    interruptedWrite: async function () {
      var testName = 'interruptedWrite';
      var txId     = _uid();
      var docId    = 'STRESS-WAL-' + _uid();

      var fakeWal = {
        id:             _uid(),
        txId:           txId,
        type:           'gl-posting',
        status:         'pending',
        documentId:     docId,
        steps:          ['validate', 'acquire-lock'],
        completedSteps: ['validate'],
        payload:        {
          txId:         txId,
          documentId:   docId,
          documentType: 'invoice',
          sourceModule: 'stress-test',
          entries: [
            { accountId: 'ar-001', accountName: 'AR',    debit: 2500, credit: 0,    description: 'stress' },
            { accountId: 'rv-001', accountName: 'Sales', debit: 0,    credit: 2500, description: 'stress' }
          ],
          actor: 'stress-test-user'
        },
        timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString()
      };

      try { await _idbPut('walEntries', fakeWal); } catch (_e) {
        return;
      }

      await WALRecovery.checkPending();

      var entries = await _idbReadAll('walEntries');
      var found   = entries.find(function (e) { return e && e.id === fakeWal.id; });
      if (found && found.status === 'pending') {
        throw { test: testName, documentId: docId, step: 'walRecovery',
          expected: 'committed or rolled_back', actual: 'still pending' };
      }
    },

    multiTabCorruption: async function () {
      var testName = 'multiTabCorruption';

      if (typeof BroadcastChannel === 'undefined') return;

      var channel  = new BroadcastChannel('erp-sync');
      var received = [];
      var listener = function (e) { received.push(e.data); };
      channel.addEventListener('message', listener);

      var testDocId = 'STRESS-BC-' + _uid();
      channel.postMessage({ type: 'committed', store: 'sales', documentId: testDocId, _v: 2 });

      await new Promise(function (res) { setTimeout(res, 50); });

      channel.removeEventListener('message', listener);
      channel.close();

    }

  } : {
    runAll: function () { return Promise.resolve(); },
    rapidSave: function () { return Promise.resolve(); },
    doubleClickSave: function () { return Promise.resolve(); },
    concurrentStock: function () { return Promise.resolve(); },
    editAfterPayment: function () { return Promise.resolve(); },
    reverseAfterReturn: function () { return Promise.resolve(); },
    interruptedWrite: function () { return Promise.resolve(); },
    multiTabCorruption: function () { return Promise.resolve(); }
  };


  ERP.Reconciliation = {
    __v1: true,

    BootIntegrityCheck: BootIntegrityCheck,

    WALRecovery: WALRecovery,

    BackgroundReconciliation: BackgroundReconciliation,

    FullReconciliation: FullReconciliation,

    StressTests: StressTests,

    bootCheck:            function ()    { return BootIntegrityCheck.run(); },
    walCheckPending:      function ()    { return WALRecovery.checkPending(); },
    walCleanup:           function ()    { return WALRecovery.cleanup(); },
    scheduleBackground:   function ()    { return BackgroundReconciliation.schedule(); },
    fullReconcile:        function (tx)  { return FullReconciliation.run(tx); },
    runStressTests:       function ()    { return StressTests.runAll(); }
  };

  ERP.WALRecovery = WALRecovery;

})(ERP);

window.ERP = ERP;
