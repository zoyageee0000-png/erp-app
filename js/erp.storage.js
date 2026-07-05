/*
 * erp.storage.js — CONSOLIDATED (was 5 files: db.js, storage_adapter.js,
 * erp.persistence.js, erp.storage.guardian.js, sales.storage.adapter.js)
 * ============================================================================
 * Audit finding (Category B, #9): "Five separate files do overlapping
 * 'storage' work ... ~2,489 lines across 5 files for what should be one
 * persistence boundary." This file is that boundary. It is a physical merge,
 * not a logic rewrite — every section below is byte-for-byte the same code
 * that used to live in its own file, verified against every real call site
 * in the app (ERP._db, window.StorageAdapter, ERP.Persistence,
 * ERP.StorageGuardian, ERP._salesStorage — all still exported under the
 * exact same names, so no other file in this app needed to change).
 * The five files are merged in the same relative order they always loaded
 * in (each depends on the one(s) before it being ready), so behavior is
 * unchanged; only the file count and the "which file owns what" confusion
 * are fixed.
 *
 * OWNERSHIP MAP (read this before touching any section below):
 *   SECTION 1 — IndexedDB primitives (open/save/load/delete/backup/hydrate).
 *               The actual persistence primitive. Exports: ERP._db, ERP.storage.
 *   SECTION 2 — localStorage fast-cache snapshot + cross-tab BroadcastChannel
 *               sync + debounced writes. Exports: window.StorageAdapter.
 *   SECTION 3 — THE single choke point every other module should call to
 *               persist something: registry-driven (ERP._internal.getStoreNames()),
 *               so it can never forget a store. Exports: ERP.Persistence.
 *               If you are adding a new call site anywhere in this app that
 *               needs to save/load data, call ERP.Persistence — not Section 1
 *               or Section 2 directly.
 *   SECTION 4 — localStorage quota monitoring/alerting (separate concern:
 *               watches usage, not writes). Exports: ERP.StorageGuardian.
 *   SECTION 5 — Sales-domain small-key storage (theme/color prefs, cross-tab
 *               sync for a handful of sales UI keys). Narrower scope than
 *               Sections 1-3 on purpose — not a fourth general persistence
 *               layer, just small UI preference keys under an 'erp_' prefix.
 *               Exports: ERP._salesStorage.
 *
 * NOT YET DONE (flagging honestly rather than silently leaving it): the two
 * remaining architectural complaints from the audit are not eliminated by
 * this merge, only made visible in one place —
 *   (a) IndexedDB and localStorage are still both live backends simultaneously
 *       (Section 1 + Section 2), with fallback logic rather than one adapter
 *       picking a backend;
 *   (b) Section 4 (StorageGuardian) and erp.concurrency.guard.js (a separate
 *       file, not merged here — it guards concurrency, not storage capacity,
 *       a genuinely different concern) still run independent polling
 *       intervals over related concerns.
 * Both are real design decisions, not bugs, and are out of scope for a file
 * merge — changing either means changing behavior, which needs the app
 * running to verify, not just reading the source.
 */

/* ============================== SECTION 1 — IndexedDB primitives (was db.js) ============================== */
'use strict';

var ERP = window.ERP || {};

(function (ERP) {
  'use strict';

  var _db     = null;
  var _openPromise = null;
  var DB_NAME = 'MHAutosDB';
  // ARCHITECTURAL REFACTOR: bumped 9 -> 10 to add 'objectSnapshots' — a
  // generic store for object/dictionary-shaped data (like PurchaseState's
  // supplier ledger, keyed by supplier id — not an array-snapshot, not a
  // single record, a whole dictionary) that didn't fit either of
  // ERP.Persistence's two existing primitives. onupgradeneeded only ever
  // creates missing stores (see below) — this does not touch any existing
  // data in any other store.
  var DB_VER  = 10;

  var _DATA_STORES = ERP._internal.getStoreNames();

  var _ACC_STORES = [
    'acc_journals', 'acc_ledger', 'acc_loans',
    'acc_bankAccounts', 'acc_bankTransactions',
    'acc_auditLog', 'acc_periods', 'acc_coa',
    'acc_expenses',
    'walEntries', 'walArchive', 'reversalIndex'
  ];

  var DB_STORES = _DATA_STORES.concat(['settings', 'backups', 'erp_invoice_guard', 'auditArchive', 'auditLog', 'mh_bio_creds_v1', 'erp_edit_locks', 'objectSnapshots']).concat(_ACC_STORES);

  // ARCHITECTURAL FIX: built lazily via function (not a top-level const array)
  // because db.js loads before constants.js in index.html — ERP.CONSTANTS
  // wouldn't exist yet at module-init time. Safe here since the only actual
  // usage (below) happens inside a function called at backup time, well
  // after all scripts have loaded.
  function _lsBackupKeys() {
    var mainKey  = (ERP.CONSTANTS && ERP.CONSTANTS.STORAGE_KEYS && ERP.CONSTANTS.STORAGE_KEYS.MAIN)  || 'mh_erp_data';
    var auditKey = (ERP.CONSTANTS && ERP.CONSTANTS.STORAGE_KEYS && ERP.CONSTANTS.STORAGE_KEYS.AUDIT) || 'mh_audit_log';
    return [
      mainKey, auditKey, 'mh_supplier_ledger', 'mh_purchase_store',
      'mh_purchase_meta', 'mh_paymentOuts', 'mh_mechanics', 'mh_biz_info',
      'erp_guard_invoices_v1', 'erp_edit_locks_v1', 'mh_session',
      'mh_payment_allocations_out'
    ];
  }

  var _DB_KEY_MAP = {
    inventory:          { keyPath:'bc' },
    vehicles:           { keyPath:'plate' },
    settings:           { keyPath:'key' },
    users:              { keyPath:'username' },
    backups:            { keyPath:'id', autoIncrement:true },
    erp_invoice_guard:  { keyPath:'key' },
    auditLog:           { keyPath:'id', autoIncrement:true },
    mh_bio_creds_v1:    { keyPath:'id' },
    erp_edit_locks:     { keyPath:'id' },
    objectSnapshots:    { keyPath:'key' }
  };

  var _usersMigrationFn = null;

  function _lsGet(k) {
    try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; }
  }
  function _lsDel(k) {
    try { localStorage.removeItem(k); } catch (e) { if (window.DEBUG_MODE) console.warn('[db._lsDel]', k, e); }
  }

  function _toast(msg, type, dur) {
    if (ERP.ui && ERP.ui.toast) ERP.ui.toast(msg, type, dur);
    else console.warn('[db toast]', msg);
  }
  function _spinner(show, msg) {
    if (ERP.ui && ERP.ui.spinner) ERP.ui.spinner(show, msg);
  }

  var _SCHEMA = {
    sales:            { id:'string', date:'string' },
    saleReturns:      { id:'string', date:'string' },
    saleOrders:       { id:'string', date:'string' },
    estimates:        { id:'string', date:'string' },
    deliveryChallans: { id:'string', date:'string' },
    payIn:            { id:'string', date:'string' },
    payOut:           { id:'string', date:'string' },
    purchases:        { id:'string', date:'string' },
    purchaseOrders:   { id:'string', date:'string' },
    purchaseReturns:  { id:'string', date:'string' },
    inventory:        { bc:'string', n:'string' },
    customers:        { id:'string', n:'string' },
    suppliers:        { id:'string', n:'string' },
    jobs:             { id:'string', status:'string' },
    expenses:         { id:'string', date:'string' },
    vehicles:         { plate:'string' },
    appointments:     { id:'string', date:'string' },
    bankTransactions: { id:'string', date:'string' },
    cheques:          { id:'string' },
    mechanics:        { id:'string', n:'string' },
    stockMovements:   { id:'string', type:'string' },
    stockBatches:     { id:'string', bc:'string' },
    loans:            { id:'string', date:'string' },
    customerLedger:      { id:'string', customerId:'string', type:'string', date:'string' },
    paymentAllocations:  { id:'string', paymentId:'string', invoiceId:'string' },
    customerPayOut:      { id:'string', date:'string' }
  };

  var _DEFAULTS = {
    sales:            { disc:0, paid:0, items:[], status:'unpaid' },
    saleReturns:      { items:[], refund:0, reason:'' },
    saleOrders:       { items:[], status:'draft', note:'' },
    estimates:        { items:[], status:'draft', validDays:30 },
    deliveryChallans: { items:[], status:'draft', note:'' },
    payIn:            { amount:0, method:'cash', note:'' },
    payOut:           { amount:0, method:'cash', note:'' },
    purchases:        { items:[], paid:0, status:'received' },
    purchaseOrders:   { items:[], status:'draft', note:'' },
    purchaseReturns:  { items:[], refund:0, reason:'' },
    inventory:        { st:0, pp:0, sp:0, loc:'', cat:'', minSt:5 },
    customers:        { ph:'', bal:0, balType:'dr', credit:0 },
    suppliers:        { ph:'', bal:0, balType:'cr' },
    jobs:             { status:'pending', parts:[], labour:0, mileage:'' },
    expenses:         { cat:'', note:'', amt:0 },
    vehicles:         { make:'', model:'', year:'', color:'', vin:'' },
    appointments:     { status:'pending', note:'' },
    bankTransactions: { type:'', amount:0, note:'' },
    cheques:          { status:'pending', amount:0 },
    mechanics:        { ph:'', speciality:'' },
    stockMovements:   { qty:0, note:'' },
    stockBatches:     { remainQty:0, costPerUnit:0, ref:'' },
    loans:            { amount:0, paid:0, status:'active', note:'' },
    customerLedger:   { debit:0, credit:0, balance:0, ref:'', note:'', createdAt:'' },
    paymentAllocations: { amountAllocated:0, date:'', createdAt:'' },
    customerPayOut:   { amount:0, mode:'Cash', notes:'', voided:false }
  };

  function _validateStrict(arr, name) {
    if (!Array.isArray(arr)) {
      if (window.DEBUG_MODE) console.warn('[hydrate] ' + name + ': not array');
      return { ok: false, dropped: 0 };
    }
    var schema = _SCHEMA[name] || {};
    var schemaFields = Object.keys(schema);
    var originalCount = arr.length;
    var valid = arr.filter(function(item) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        if (window.DEBUG_MODE) console.warn('[hydrate] ' + name + ': non-object record dropped');
        return false;
      }
      for (var f = 0; f < schemaFields.length; f++) {
        var field        = schemaFields[f];
        var expectedType = schema[field];
        if (item[field] === undefined || item[field] === null) {
          if (window.DEBUG_MODE) console.warn('[hydrate] ' + name + ': missing field ' + field + ' — record dropped');
          return false;
        }
        var actualType = typeof item[field];
        if (actualType !== expectedType) {
          if (expectedType === 'string' && (actualType === 'number' || actualType === 'boolean')) {
            item[field] = String(item[field]);
          } else {
            if (window.DEBUG_MODE) console.warn('[hydrate] ' + name + ': field ' + field + ' wrong type — record dropped');
            return false;
          }
        }
      }
      return true;
    });
    arr.length = 0;
    valid.forEach(function(r) { arr.push(r); });
    for (var k = 0; k < arr.length; k++) {
      var rec = arr[k];
      var keys = Object.keys(rec);
      for (var m = 0; m < keys.length; m++) {
        if (typeof rec[keys[m]] === 'number' && isNaN(rec[keys[m]])) {
          if (window.DEBUG_MODE) console.warn('[hydrate] ' + name + '[' + k + ']: NaN in field "' + keys[m] + '" — sanitized to 0');
          rec[keys[m]] = 0;
        }
      }
    }
    return { ok: true, dropped: originalCount - arr.length };
  }

  function _applyDefaults(arr, name) {
    var defs = _DEFAULTS[name] || {};
    return arr.map(function (item) {
      var out = {};
      for (var dk in defs) {
        out[dk] = Array.isArray(defs[dk]) ? defs[dk].slice()
                : (defs[dk] && typeof defs[dk] === 'object') ? Object.assign({}, defs[dk])
                : defs[dk];
      }
      for (var ik in item) { out[ik] = item[ik]; }
      return out;
    });
  }

  function _migrateFromLocalStorage() {
    var currentVersion = (ERP.getState().settings && ERP.getState().settings.dataVersion) || null;
    if (currentVersion === '2B') return;
    ERP.setState(function (s) { s.settings.dataVersion = '2B'; });

    var _LS_MIGRATION_MAP = {
      'mh_saleReturns':      'saleReturns',
      'mh_saleOrders':       'saleOrders',
      'mh_orders':           'saleOrders',
      'mh_estimates':        'estimates',
      'mh_challans':         'deliveryChallans',
      'mh_deliveryChallans': 'deliveryChallans',
      'mh_payIn':            'payIn',
      'mh_payOut':           'payOut',
      'mh_templates':        'templates',
      'erp_sales':              'sales',
      'erp_purchases':          'purchases',
      'erp_customers':          'customers',
      'erp_estimates':          'estimates',
      'erp_saleReturns':        'saleReturns',
      'erp_saleOrders':         'saleOrders',
      'erp_deliveryChallans':   'deliveryChallans',
      'erp_payIn':              'payIn',
      'erp_payOut':             'payOut',
      'erp_inventory':          'inventory'
    };

    var _byStateKey = {};
    Object.keys(_LS_MIGRATION_MAP).forEach(function (lsKey) {
      var stateKey = _LS_MIGRATION_MAP[lsKey];
      if (!_byStateKey[stateKey]) _byStateKey[stateKey] = [];
      _byStateKey[stateKey].push(lsKey);
    });

    var _migrated = [];
    Object.keys(_byStateKey).forEach(function (stateKey) {
      var lsKeys = _byStateKey[stateKey];
      var existing = (ERP.getState().data && ERP.getState().data[stateKey]) || [];
      if (existing.length > 0) {
        lsKeys.forEach(function (lsKey) { _lsDel(lsKey); });
        return;
      }

      var merged = [];
      lsKeys.forEach(function (lsKey) {
        var raw = _lsGet(lsKey);
        if (Array.isArray(raw) && raw.length > 0) {
          merged = merged.concat(raw.filter(function (r) { return r && typeof r === 'object' && !Array.isArray(r); }));
        }
        _lsDel(lsKey);
      });

      if (!merged.length) return;

      ERP.setState(function (s) { s.data[stateKey] = merged.concat(s.data[stateKey] || []); });
      db.save(stateKey, ERP.getState().data[stateKey])
        .catch(function (e) { console.warn('[migrate] save failed:', stateKey, e); });
      _migrated.push(stateKey);
    });

    ERP.setState(function (s) { s.settings.dataVersion = '2B'; });
    db.save('settings', { key:'dataVersion', value:'2B' })
      .catch(function (e) { console.warn('[migrate] version stamp failed', e); });

    if (_migrated.length && window.DEBUG_MODE) {
      if(window.DEBUG_MODE)console.log('[migrate] 2B: imported from LS:', _migrated.join(', '));
    }
  }

  var db = {

    open: function () {
      if (_openPromise) return _openPromise;
      _openPromise = new Promise(function (resolve, reject) {
        try {
          var probe = indexedDB.open('__mh_probe__');
          probe.onerror = function () { reject('IndexedDB blocked (private mode?)'); };
          probe.onblocked = function () { reject('IndexedDB probe blocked — another tab may be holding an older version open'); };
          probe.onsuccess = function () {
            probe.result.close();
            var _delReq = indexedDB.deleteDatabase('__mh_probe__');
        _delReq.onerror = function() { if (window.DEBUG_MODE) console.warn('[DB] probe DB deletion failed — may persist'); };

            var req = indexedDB.open(DB_NAME, DB_VER);

            req.onerror = function (e) {
              reject('DB open error: ' + (e.target.error || e));
            };

            req.onblocked = function () {
              reject('DB open blocked — please close other tabs running this app and reload');
            };

            req.onsuccess = function (e) {
              _db = e.target.result;
              _db.onversionchange = function () { _db.close(); };
              try {
                if (!localStorage.getItem('_erp_db_cleanup_v9')) {
                  indexedDB.deleteDatabase('mh_erp_db');
                  indexedDB.deleteDatabase('ERP_sales_v1');
                  localStorage.setItem('_erp_db_cleanup_v9', '1');
                }
              } catch (_) {}
              resolve(_db);
            };

            req.onupgradeneeded = function (e) {
              var dbi = e.target.result;
              var txn = e.target.transaction;
              DB_STORES.forEach(function (name) {
                var store;
                if (!dbi.objectStoreNames.contains(name)) {
                  var opts = _DB_KEY_MAP[name] || { keyPath:'id', autoIncrement:true };
                  store = dbi.createObjectStore(name, opts);
                } else {
                  store = txn.objectStore(name);
                }
                var _safeIdx = function(s, idxName, keyPath, options) {
                  try {
                    if (!s.indexNames.contains(idxName)) s.createIndex(idxName, keyPath, options || {});
                  } catch (_) {}
                };
                if (name === 'sales') {
                  _safeIdx(store, 'by_date',     'date');
                  _safeIdx(store, 'by_customer', 'customer');
                  _safeIdx(store, 'by_status',   'status');
                }
                if (name === 'purchases') {
                  _safeIdx(store, 'by_date',     'date');
                  _safeIdx(store, 'by_supplier', 'supplierId');
                }
                if (name === 'payIn' || name === 'payOut') {
                  _safeIdx(store, 'by_date',     'date');
                }
              });
            };
          };
        } catch (e) { reject('IDB not supported: ' + e); }
      });
      _openPromise.catch(function () { _openPromise = null; });
      return _openPromise;
    },

    save: function (storeName, data) {
      return new Promise(function (resolve, reject) {
        if (!_db) {
          if (window.DEBUG_MODE) console.warn('[DB.save] DB not open — skipping persist for:', storeName);
          try { if (window.ERP && window.ERP.Logger) window.ERP.Logger.warn('[DB.save] DB not open yet — save deferred', { store: storeName }); } catch(_) {}
          reject('DB not open — cannot save store: ' + storeName);
          return;
        }
        if (!_db.objectStoreNames.contains(storeName)) {
          if (window.DEBUG_MODE) console.warn('[DB.save] store not found (needs DB upgrade?):', storeName);
          resolve({ success: true, skipped: true });
          return;
        }
        try {
          var tx    = _db.transaction([storeName], 'readwrite');
          var store = tx.objectStore(storeName);
          var _settled = false;
          // FIX (root-cause, was a real bug found by tracing this file): a record
          // missing its key field used to be silently `return`-ed out of the
          // forEach below with only a DEBUG_MODE console.warn, while tx.oncomplete
          // still resolved plain {success:true} — the caller had no way to know a
          // record never made it into the store. Now the skip is tracked and
          // surfaced on the resolved result, and always logged via ERP.Logger
          // (not gated on DEBUG_MODE), since a silently-dropped record is exactly
          // the kind of failure a user only discovers much later, at reconciliation
          // time, when it's expensive to trace back.
          var _skippedItems = [];
          tx.oncomplete = function () {
            if (_settled) return;
            _settled = true;
            if (_skippedItems.length) {
              try {
                if (window.ERP && window.ERP.Logger) {
                  window.ERP.Logger.warn('[DB.save] ' + storeName + ': ' + _skippedItems.length +
                    ' record(s) skipped — missing key field', { store: storeName, skipped: _skippedItems });
                }
              } catch(_) {}
              resolve({ success: true, skippedCount: _skippedItems.length, skipped: _skippedItems });
            } else {
              resolve({ success: true });
            }
          };
          tx.onerror    = function (e) {
            if (_settled) return;
            _settled = true;
            var msg = 'TX error: ' + (e.target.error || e);
            try { if (window.ERP && window.ERP.Logger) window.ERP.Logger.error('[DB.save] ' + msg, { store: storeName }); } catch(_) {}
            reject(msg);
          };
          tx.onabort    = function (e) {
            if (_settled) return;
            _settled = true;
            var msg = 'TX abort: ' + (e.target.error || e);
            try { if (window.ERP && window.ERP.Logger) window.ERP.Logger.error('[DB.save] ' + msg, { store: storeName }); } catch(_) {}
            reject(msg);
          };
          if (Array.isArray(data)) {
            store.clear();
            var _keyInfo  = _DB_KEY_MAP[storeName] || { keyPath:'id', autoIncrement:true };
            var _keyField = _keyInfo.keyPath || 'id';
            data.forEach(function (item) {
              if (!item) return;
              if (item[_keyField] === undefined || item[_keyField] === null) {
                if (_keyField === 'id') {
                  item.id = 'ID-' + ERP.uid(); // FIX (root cause, audit #61-62): was Date.now()+Math.random(); route through the one canonical generator.
                } else if (!_keyInfo.autoIncrement) {
                  _skippedItems.push({ reason: 'missing key field "' + _keyField + '"', item: item });
                  if (window.DEBUG_MODE) console.warn('[DB.save] ' + storeName + ': record missing key field "' + _keyField + '" — skipped', item);
                  return;
                }
              }
              store.put(item);
            });
          } else if (data) {
            var keyField = (_DB_KEY_MAP[storeName] && _DB_KEY_MAP[storeName].keyPath) || 'id';
            if (data[keyField] !== undefined && data[keyField] !== null) {
              store.put(data);
            } else {
              _settled = true;
              reject('Cannot save to store "' + storeName + '" — missing key field "' + keyField + '"');
              return;
            }
          }
        } catch (e) {
          try { if (window.ERP && window.ERP.Logger) window.ERP.Logger.error('[DB.save] exception', { store: storeName, error: e && e.message }); } catch(_) {}
          reject(e);
        }
      });
    },

    load: function (storeName) {
      return new Promise(function (resolve, reject) {
        if (!_db) { reject('DB not open'); return; }
        if (!_db.objectStoreNames.contains(storeName)) {
          if (window.DEBUG_MODE) console.warn('[DB.load] store not found (needs DB upgrade?):', storeName);
          resolve([]);
          return;
        }
        try {
          var tx  = _db.transaction([storeName], 'readonly');
          var req = tx.objectStore(storeName).getAll();
          req.onsuccess = function () { resolve(req.result || []); };
          req.onerror   = function (e) { reject('Load error: ' + (e.target.error || e)); };
        } catch (e) { reject(e); }
      });
    },

    // ARCHITECTURAL REFACTOR: this primitive didn't exist before, so callers
    // that checked `typeof db.delete === 'function'` (e.g. accounting_store.js)
    // always fell through to a manual indexedDB.open()+transaction fallback.
    delete: function (storeName, id) {
      return new Promise(function (resolve, reject) {
        if (!_db) { reject('DB not open'); return; }
        if (!_db.objectStoreNames.contains(storeName)) { resolve({ success: true, skipped: true }); return; }
        try {
          var tx  = _db.transaction([storeName], 'readwrite');
          var req = tx.objectStore(storeName).delete(id);
          req.onsuccess = function () { resolve({ success: true }); };
          req.onerror   = function (e) { reject('Delete error: ' + (e.target.error || e)); };
        } catch (e) { reject(e); }
      });
    },

    hydrate: async function () {
      if (!_db) {
        if (window.DEBUG_MODE) console.warn('[hydrate] DB not open');
        return;
      }
      if (db._hydrateCompleted) {
        if (window.DEBUG_MODE) console.warn('[hydrate] Already completed — skipping duplicate call');
        return;
      }

      // ARCHITECTURAL FIX (root-level persistence refactor): this used to be a
      // hand-maintained object, and it had already silently missed 3 stores
      // (stockJournal, gstReturns, paymentIns) before this fix — writes to
      // IndexedDB happened, but boot never read them back. Building this from
      // the single canonical store registry (same one storage_adapter.js and
      // ERP.Persistence use) means a future new store is covered automatically
      // the moment it's added to core.js's data model — no list to remember.
      var _storeNames = (ERP._internal && typeof ERP._internal.getStoreNames === 'function')
        ? ERP._internal.getStoreNames()
        : ['inventory','customers','suppliers','sales','purchases','jobs','expenses',
           'vehicles','appointments','bankTransactions','cheques','mechanics',
           'stockMovements','stockBatches','images','users','templates','coa',
           'batches','loans','estimates','saleOrders','saleReturns','deliveryChallans',
           'purchaseOrders','purchaseReturns','payIn','payOut','customerLedger',
           'paymentAllocations','customerPayOut','gstReturns','paymentIns','stockJournal'];
      var map = {};
      _storeNames.forEach(function (name) { map[name] = name; });

      var _hydrated = 0, _repaired = 0, _failed = 0;

      for (var store in map) {
        try {
          var data = await db.load(store);
          if (!Array.isArray(data)) {
            if (window.DEBUG_MODE) console.warn('[hydrate] ' + store + ': expected array, got ' + typeof data + ' — defaulting to []');
            data = [];
          }
          var _defaulted = _applyDefaults(data, store);
          var _result = _validateStrict(_defaulted, store);
          if (_result.ok) {
            (function (key, d) {
              ERP.setState(function (s) { s.data[key] = d; });
            })(map[store], _defaulted);
            try { await db.save(store, _defaulted); } catch (_rse) {}
            if (_result.dropped > 0) {
              try {
                localStorage.setItem('mh_quarantine_' + store,
                  JSON.stringify({ ts: new Date().toISOString(), data: data }));
              } catch (qe) { if (window.DEBUG_MODE) console.warn('[hydrate] quarantine write failed:', store, qe); }
              _toast('⚠️ ' + store + ': ' + _result.dropped + ' invalid record(s) removed. Check backup.', 'warning', 7000);
              _repaired++;
            }
            _hydrated++;
          } else {
            try {
              localStorage.setItem('mh_quarantine_' + store,
                JSON.stringify({ ts: new Date().toISOString(), data: data }));
            } catch (qe) { if (window.DEBUG_MODE) console.warn('[hydrate] quarantine write failed:', store, qe); }
            (function (key) {
              ERP.setState(function (s) { s.data[key] = []; });
            })(map[store]);
            _toast('⚠️ ' + store + ' data issue — quarantined. Check backup.', 'warning', 7000);
            _repaired++;
          }
        } catch (e) {
          if (window.DEBUG_MODE) console.warn('[hydrate] ' + store + ' failed:', e);
          (function (key) {
            ERP.setState(function (s) { if (!Array.isArray(s.data[key])) s.data[key] = []; });
          })(map[store]);
          _failed++;
        }
      }

      if (_failed === 0) db._hydrateCompleted = true;

      // FIX (data-loss bug #2, part 2): stockJournal and balanceProjection have
      // no IndexedDB object store of their own (see storage_adapter.js
      // IDB_STORES) and are never persisted anywhere — they always come back
      // empty/undefined after a reload. BalanceProjection.getBalance() is what
      // every stock mutation uses as "qtyBefore", so leaving it empty means the
      // very next purchase/sale after a reload silently computes from 0 instead
      // of the real quantity (e.g. "0 + 10 = 10" instead of "2 + 10 = 12"),
      // quietly losing whatever stock existed before that reload. Since
      // inventory.st IS reliably persisted (fixed above), reseed the balance
      // cache from it right after inventory loads so it starts every session
      // in sync with the real, persisted quantities.
      try {
        ERP.setState(function (s) {
          var inv = (s.data && s.data.inventory) || [];
          var proj = {};
          for (var bi = 0; bi < inv.length; bi++) {
            var it = inv[bi];
            if (it && it.bc) proj[it.bc] = Number(it.st) || 0;
          }
          s.data.balanceProjection = proj;
          s.data.balanceProjectionAppliedKeys = {};
        });
      } catch (e) { console.warn('[hydrate] balanceProjection reseed failed', e); }

      try {
        var sArr = await db.load('settings');
        (sArr || []).forEach(function (s) {
          if (s.key && s.value !== undefined) {
            ERP.setState(function (st) { st.settings[s.key] = s.value; });
          }
        });
      } catch (e) { console.warn('[hydrate] settings parse error', e); }

      try { _migrateFromLocalStorage(); } catch (e) { console.warn('[hydrate] migration error', e); }

      try {
        if (typeof _usersMigrationFn === 'function') _usersMigrationFn();
      } catch (e) { console.warn('[hydrate] users migration error', e); }

      try {
        var _idbUsers = await db.load('users');
        if (Array.isArray(_idbUsers) && _idbUsers.length > 0) {
          if (typeof db._setUsersCache === 'function') db._setUsersCache(_idbUsers);
          try { localStorage.setItem('mh_users_v1', JSON.stringify(_idbUsers)); } catch (_) {}
        }
      } catch (e) { if (window.DEBUG_MODE) console.warn('[hydrate] users load error', e); }

      if (window.DEBUG_MODE) {
        if(window.DEBUG_MODE)console.log('[hydrate] done — loaded:', _hydrated, '| repaired:', _repaired, '| failed:', _failed);
      }

      try {
        var _synced = ERP.getState().data;

        var _globalKeys = [
          'purchases', 'purchaseOrders', 'purchaseReturns', 'payOut',
          'inventory', 'customers', 'suppliers', 'expenses',
          'bankTransactions', 'cheques', 'stockMovements', 'stockBatches',
          'mechanics', 'loans', 'saleReturns', 'saleOrders', 'estimates',
          'deliveryChallans', 'payIn', 'customerLedger', 'paymentAllocations', 'customerPayOut'
        ];
        _globalKeys.forEach(function(k) {
          if (Array.isArray(_synced[k])) window[k] = _synced[k].slice();
        });

        if (window.JobState && typeof window.JobState.setJobs === 'function' && Array.isArray(_synced.jobs)) {
          window.JobState.setJobs(_synced.jobs);
        }
        if (window.VehicleState && typeof window.VehicleState.setVehicles === 'function' && Array.isArray(_synced.vehicles)) {
          window.VehicleState.setVehicles(_synced.vehicles);
        }
        if (window.AppointmentState && typeof window.AppointmentState.setAppointments === 'function' && Array.isArray(_synced.appointments)) {
          window.AppointmentState.setAppointments(_synced.appointments);
        }
        if (typeof _synced.invCount === 'number' && _synced.invCount > 0) {
          window.invCount  = _synced.invCount;
          window._invCount = _synced.invCount;
        }

        if (window.DEBUG_MODE) console.log('[hydrate] post-sync done');
      } catch (_se) {
        if (window.DEBUG_MODE) console.warn('[hydrate] post-sync error (non-fatal):', _se);
      }
    },

    backup: async function (silent) {
      if (!silent) _spinner(true, 'Creating backup...');
      try {
        if (!_db) throw new Error('DB not open');
        var bk = {
          id:        'BKP-' + ERP.uid(), // FIX (root cause, audit #61-62): was an independent Date.now+random scheme; route through the one canonical generator.
          timestamp: Date.now(),
          date:      new Date().toISOString(),
          version:   DB_VER,
          data:      {}
        };
        for (var i = 0; i < DB_STORES.length; i++) {
          var s = DB_STORES[i];
          try {
            var storeData = await db.load(s);
            if (s === 'users') {
              storeData = (storeData || []).map(function (u) {
                var safe = Object.assign({}, u);
                delete safe.pwdHash;
                delete safe.pinHash;
                return safe;
              });
            } else if (s === 'mh_bio_creds_v1') {
              storeData = (storeData || []).map(function (b) { return { id: b.id }; });
            }
            bk.data[s] = storeData;
          } catch (e) { bk.data[s] = []; }
        }
        bk.data.__localStorage = {};
        _lsBackupKeys().forEach(function (k) {
          try {
            var raw = localStorage.getItem(k);
            if (raw !== null) bk.data.__localStorage[k] = raw;
          } catch (e) { if (window.DEBUG_MODE) console.warn('[backup] localStorage read failed:', k, e); }
        });
        await db.save('backups', bk);
        await new Promise(function(resolve) {
          function _serialize() {
            var blob = new Blob([JSON.stringify(bk)], { type:'application/json' });
            var a    = document.createElement('a');
            a.href   = URL.createObjectURL(blob);
            if (!silent) { a.download = 'mh-backup-' + Date.now() + '.json'; a.click(); }
            URL.revokeObjectURL(a.href);
            if (!silent) _toast('Backup ready ✅', 'success');
            resolve();
          }
          if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(_serialize, { timeout: 3000 });
          } else {
            setTimeout(_serialize, 0);
          }
        });
      } catch (e) {
        _toast('Backup failed: ' + e, 'error');
      } finally {
        _spinner(false);
      }
    },

    _autoBackupStarted: false,
    _autoBackupTimer:   null,
    startAutoBackup: function () {
      if (db._autoBackupStarted) return;
      db._autoBackupStarted = true;
      var mins = (ERP.getState().settings && ERP.getState().settings.backupInterval) || 30;
      db._autoBackupTimer = ERP.TimerRegistry.start('storage.autoBackup', function () {
        if (!_db) return;
        if (window.requestIdleCallback) {
          requestIdleCallback(function () {
            db.backup(true).catch(function (e) { console.warn('[autoBackup]', e); });
          }, { timeout: 10000 });
        } else {
          setTimeout(function () {
            db.backup(true).catch(function (e) { console.warn('[autoBackup]', e); });
          }, 0);
        }
      }, mins * 60 * 1000);
    },

    stopAutoBackup: function () {
      if (db._autoBackupTimer) { ERP.TimerRegistry.clear('storage.autoBackup'); db._autoBackupTimer = null; }
      db._autoBackupStarted = false;
    },


    _registerUsersMigration: function (fn) {
      _usersMigrationFn = fn;
    },

    _registerSetUsersCache: function (fn) {
      db._setUsersCache = fn;
    },

    _isOpen: function () { return !!_db; }
  };

  var _backupService = {

    create: function (silent) { return db.backup(silent); },

    export: function () {
      var state = ERP.getState ? ERP.getState().data : {};
      var blob  = new Blob([JSON.stringify(state, null, 2)], { type:'application/json' });
      var a     = document.createElement('a');
      a.href    = URL.createObjectURL(blob);
      a.download = 'erp-export-' + Date.now() + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    },

    import: function () {
      var inp   = document.createElement('input');
      inp.type  = 'file';
      inp.accept = '.json';
      inp.onchange = function () {
        var file = inp.files && inp.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          try {
            var parsed = JSON.parse(ev.target.result);
            if (parsed && typeof parsed === 'object' && parsed.data && typeof parsed.data === 'object') {
              var _importKeys = Object.keys(parsed.data);
              var _storesRestored = 0;
              var _storesFailed = 0;
              var _saveValidated = function (storeName, arr) {
                var cleaned = _applyDefaults(arr, storeName);
                _validateStrict(cleaned, storeName);
                return db.save(storeName, cleaned).then(function () {
                  _storesRestored++;
                }).catch(function (e) {
                  _storesFailed++;
                  console.warn('[import] store failed:', storeName, e);
                });
              };
              var _importPromises = _importKeys.map(function(k) {
                if (k === '__mh_erp_db' && parsed.data[k] && typeof parsed.data[k] === 'object') {
                  var _legacyPromises = [];
                  Object.keys(parsed.data[k]).forEach(function(storeName) {
                    var storeArr = parsed.data[k][storeName];
                    if (!Array.isArray(storeArr)) return;
                    if (DB_STORES.indexOf(storeName) === -1) return;
                    _legacyPromises.push(_saveValidated(storeName, storeArr));
                  });
                  return Promise.all(_legacyPromises);
                }
                var arr = parsed.data[k];
                if (!Array.isArray(arr)) return Promise.resolve();
                if (DB_STORES.indexOf(k) === -1) return Promise.resolve();
                return _saveValidated(k, arr);
              });
              var _lsRestored = 0;
              if (parsed.data.__localStorage && typeof parsed.data.__localStorage === 'object') {
                Object.keys(parsed.data.__localStorage).forEach(function (k) {
                  try {
                    localStorage.setItem(k, parsed.data.__localStorage[k]);
                    _lsRestored++;
                  } catch (e) { console.warn('[import] localStorage key failed:', k, e); }
                });
              }
              Promise.all(_importPromises).then(function() {
                if (db.hydrate) db.hydrate();
                var msg = '✅ Import — ' + _storesRestored + ' store(s), ' + _lsRestored + ' setting key(s) restored.';
                if (_storesFailed > 0) msg += ' ' + _storesFailed + ' store(s) failed — check console.';
                _toast(msg + ' Reload to apply.', _storesFailed > 0 ? 'warning' : 'success', 6000);
              }).catch(function(e) { _toast('❌ Import write failed: ' + e, 'error'); });
            } else {
              _toast('❌ Import failed: file is not a recognized backup format', 'error');
            }
          } catch (e) { _toast('❌ Import failed: invalid file', 'error'); }
        };
        reader.readAsText(file);
      };
      inp.click();
    },

    clearAll: function (onlyTransactions) {
      var txStores = ['sales','payIn','saleReturns','paymentAllocations','customerLedger','customerPayOut',
                      'estimates','saleOrders','deliveryChallans','purchases','purchaseOrders',
                      'purchaseReturns','payOut','jobs','expenses','bankTransactions','cheques',
                      'stockMovements','stockBatches','loans','batches',
                      'acc_journals','acc_ledger','acc_loans','acc_bankTransactions','acc_expenses',
                      'walEntries','walArchive','reversalIndex'];
      var allStores = txStores.concat(['inventory','customers','suppliers','vehicles',
                      'appointments','mechanics','coa','templates','images',
                      'acc_bankAccounts','acc_periods','acc_coa','acc_auditLog']);
      var stores = onlyTransactions ? txStores : allStores;

      var promises = stores.map(function(s) {
        return new Promise(function(resolve) {
          try {
            if (!_db || !_db.objectStoreNames || !_db.objectStoreNames.contains(s)) { resolve(); return; }
            var tx = _db.transaction([s], 'readwrite');
            tx.objectStore(s).clear();
            tx.oncomplete = function() { resolve(); };
            tx.onerror    = function() { resolve(); };
          } catch(e) { resolve(); }
        });
      });

      Promise.all(promises).then(function() {
        if (ERP._internal && ERP._internal.setState) {
          ERP._internal.setState(function(s) {
            stores.forEach(function(k) {
              if (k.indexOf('acc_') === 0) return;
              if (k === 'walEntries' || k === 'walArchive' || k === 'reversalIndex') return;
              s.data[k] = [];
            });
          }, 'clearAll:reset');
        }
        setTimeout(function() { window.location.reload(); }, 300);
      }).catch(function(e) {
        if (window.DEBUG_MODE) console.error('[clearAll]', e);
        window.location.reload();
      });
    }
  };


  ERP.storage = {
    save:       function (store, data) { return db.save(store, data); },
    load:       function (store)       { return db.load(store); },
    delete:     function (store, id)    { return db.delete(store, id); },
    backup:     function (silent)      { return db.backup(silent); },
    hydrate:    function ()            { return db.hydrate(); },
    clearAll:   function (onlyTx)      { return _backupService.clearAll(onlyTx); },
    exportJSON: function ()            { return _backupService.export(); },
    importJSON: function ()            { return _backupService.import(); }
  };

  ERP._db = db;

  if (!ERP._services) ERP._services = {};
  ERP._services.backup = _backupService;

  ERP._DB_VER = DB_VER;

  if (typeof indexedDB !== 'undefined') {
    db.open().catch(function (e) {
      if (window.DEBUG_MODE) console.warn('[DB] Early open attempt failed — will retry after login:', e);
    });
  }

})(ERP);

window.ERP = ERP;

/* ============================== SECTION 2 — localStorage fast-cache + cross-tab sync (was storage_adapter.js) ============================== */

const StorageAdapter = (function () {
  'use strict';


  // ARCHITECTURAL FIX: resolved lazily (not as a top-level const) because
  // this file loads before constants.js in index.html — ERP.CONSTANTS
  // wouldn't exist yet at module-init time. Resolving at call time (after
  // all scripts have loaded) avoids that, same pattern as erp.audit.archive.js
  // uses for the audit-log key. Fallback literal keeps behavior identical
  // if this file is ever loaded standalone.
  function _lsKey() {
    return (window.ERP && window.ERP.CONSTANTS && window.ERP.CONSTANTS.STORAGE_KEYS && window.ERP.CONSTANTS.STORAGE_KEYS.MAIN)
      || 'mh_erp_data';
  }
  function _lsKeyMini() {
    return (window.ERP && window.ERP.CONSTANTS && window.ERP.CONSTANTS.STORAGE_KEYS && window.ERP.CONSTANTS.STORAGE_KEYS.MINI)
      || 'mh_erp_data_mini';
  }
  const LS_VERSION_KEY  = 'mh_dataVersion';
  const LS_TABID_KEY    = 'mh_dataTabId';
  const BC_CHANNEL      = 'mh_erp_sync';
  const DB_NAME         = 'MHAutosDB';
  const DB_VERSION      = 9;
  const DEBOUNCE_MS     = 200;  
  const IDB_DELAY_MS    = 5000;

  // ARCHITECTURAL FIX (root-level persistence refactor): this used to be a
  // hand-maintained array. Every store that existed in core.js's data model
  // but got missed here silently lost its IndexedDB backup — 'vehicles' and
  // 'stockJournal' were like this, and 'stockBatches'/'paymentIns' were even
  // worse (whitelisted here but with no provider in getProviders(), so they
  // got overwritten with [] on every sync). A hand-maintained list can always
  // be forgotten again in the future by any new store, so instead this is now
  // derived directly from the single canonical store registry
  // (ERP._internal.getStoreNames(), defined once in core.js) — the same list
  // ERP.Persistence and db.js's hydrate() use. Adding a new store to core.js's
  // data model + a provider in getProviders() is now enough; no whitelist to
  // remember to update.
  const _IDB_STORES_FALLBACK = [
    'jobs', 'appointments', 'mechanics', 'customers', 'suppliers', 'sales',
    'purchases', 'expenses', 'bankTransactions', 'cheques', 'stockMovements',
    'saleReturns', 'purchaseReturns', 'gstReturns', 'purchaseOrders',
    'paymentIns', 'stockBatches', 'vehicles', 'stockJournal'
  ];

  function _idbStores() {
    try {
      if (window.ERP && window.ERP._internal && typeof window.ERP._internal.getStoreNames === 'function') {
        var names = window.ERP._internal.getStoreNames();
        if (Array.isArray(names) && names.length) return names;
      }
    } catch (e) {}
    return _IDB_STORES_FALLBACK;
  }

  // Computed once at load time (core.js's canonical list is a fixed array,
  // not runtime-dynamic) so every existing reference to `IDB_STORES` elsewhere
  // in this file keeps working unchanged.
  var IDB_STORES = _idbStores();

  const IDB_STORE_SET = new Set(IDB_STORES);


  let _tabId            = null;
  let _onExternalChange = null;

  let _dbState          = 'idle';
  let _db               = null;
  let _dbOpenPromise    = null;

  let _bc               = null;
  let _debounceTimer    = null;
  let _pendingProviders = null;
  let _savePending      = false;

  let _idbSyncTimer     = null;
  let _lastSaveVersion  = 0;

  let _bcThrottleTimer  = null;
  const BC_THROTTLE_MS  = 500;


  function _openDB() {
    if (_dbState === 'open' && _db) return Promise.resolve(_db);
    if (_dbOpenPromise) return _dbOpenPromise;
    _dbState = 'opening';
    _dbOpenPromise = new Promise(function (resolve, reject) {
      var _attempts = 0;
      var _maxAttempts = 40;
      var _openTriggered = false;
      function _poll() {
        _attempts++;
        if (window.ERP && window.ERP._db && typeof window.ERP._db.load === 'function') {
          if (!_openTriggered && typeof window.ERP._db.open === 'function' && window.ERP._db._isOpen && !window.ERP._db._isOpen()) {
            _openTriggered = true;
            window.ERP._db.open().then(function () {
              _dbState       = 'open';
              _db            = true;
              _dbOpenPromise = null;
              resolve(true);
            }).catch(function () {
              _dbState       = 'open';
              _db            = true;
              _dbOpenPromise = null;
              resolve(true);
            });
            return;
          }
          _dbState       = 'open';
          _db            = true;
          _dbOpenPromise = null;
          resolve(true);
          return;
        }
        if (_attempts >= _maxAttempts) {
          _dbState       = 'idle';
          _dbOpenPromise = null;
          reject(new Error('[StorageAdapter] MHAutosDB not ready after ' + (_maxAttempts * 250) + 'ms'));
          return;
        }
        setTimeout(_poll, 250);
      }
      _poll();
    });
    return _dbOpenPromise;
  }

  // ARCHITECTURAL REFACTOR: single choke point for all IndexedDB writes.
  // retries:0/silent:true because _idbWriteWithRetry() below already
  // provides its own retry+backoff loop tuned for background sync — we
  // don't want two retry loops stacking.
  function _idbWrite(storeName, data) {
    return _openDB().then(function () {
      if (!Array.isArray(data)) {
        return Promise.reject(new Error('[StorageAdapter] _idbWrite: expected Array for "' + storeName + '", got ' + typeof data));
      }
      return window.ERP.Persistence.save(storeName, data, { retries: 0, silent: true });
    });
  }
  function _idbWriteWithRetry(storeName, data, attempt) {
    attempt = attempt || 0;
    const MAX_ATTEMPTS = 3;
    const BACKOFF_MS   = [0, 500, 2000];

    return _idbWrite(storeName, data).catch(function (e) {
      if (attempt >= MAX_ATTEMPTS - 1) {
        return Promise.reject(e);
      }
      const delay = BACKOFF_MS[attempt + 1] || 2000;
      console.warn('[StorageAdapter] IDB write retry #' + (attempt + 1) + ' for "' + storeName + '" in ' + delay + 'ms:', e.message);
      return new Promise(function (resolve) { setTimeout(resolve, delay); })
        .then(function () { return _idbWriteWithRetry(storeName, data, attempt + 1); });
    });
  }


  // ARCHITECTURAL REFACTOR: single choke point for all IndexedDB reads too.
  function _idbRead(storeName) {
    return _openDB().then(function () {
      return window.ERP.Persistence.load(storeName);
    });
  }

  function _buildSnapshot(dataProviders) {
    if (!dataProviders || typeof dataProviders !== 'object') {
      throw new TypeError('[StorageAdapter] dataProviders must be a non-null object of functions');
    }

    function _safeCall(key, fallback) {
      try {
        const fn = dataProviders[key];
        if (typeof fn !== 'function') return fallback;
        const val = fn();
        return (val !== undefined && val !== null) ? val : fallback;
      } catch (e) {
        console.warn('[StorageAdapter] dataProviders["' + key + '"]() threw:', e);
        return fallback;
      }
    }

    function _arr(key) {
      const v = _safeCall(key, []);
      return Array.isArray(v) ? v : [];
    }

    function _obj(key) {
      const v = _safeCall(key, {});
      return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    }

    function _numVal(key) {
      const v = _safeCall(key, 0);
      return (typeof v === 'number' && isFinite(v)) ? v : 0;
    }

    // FIX (root-cause, was a real bug found by tracing this file): this used to be
    // its own hand-maintained object literal, independent of the canonical store
    // registry (ERP._internal.getStoreNames(), exposed here as IDB_STORES) — the
    // exact hand-maintained-list pattern that this file's own IDB_STORES fix
    // (see the comment above _IDB_STORES_FALLBACK) already fixed for IndexedDB
    // sync once before. It had quietly recurred here: 15 stores that exist in the
    // canonical registry — stockJournal, customerLedger, paymentAllocations,
    // customerPayOut, loans, payIn, payOut, estimates, saleOrders,
    // deliveryChallans, users, templates, coa, batches, images — were never in
    // this literal, so the localStorage fast-cache snapshot silently never
    // included them (IndexedDB writes for these still happened correctly via
    // ERP.Persistence.saveAll(), which was already registry-driven; only this
    // snapshot builder had drifted). Building the array-store portion from
    // IDB_STORES means no future store can be forgotten here either.
    var snapshot = {};
    IDB_STORES.forEach(function (name) {
      snapshot[name] = _arr(name);
    });

    // These aren't IndexedDB array stores (they're object/number/derived fields
    // on ERP.state), so they stay explicit rather than registry-driven.
    snapshot.partyOpeningBalances = _obj('partyOpeningBalances');
    snapshot.partReservations     = _obj('partReservations');
    snapshot.notifications        = _arr('notifications').slice(0, 50);
    snapshot.invCount             = _numVal('invCount');
    snapshot.jobCount             = _numVal('jobCount');
    snapshot.partCount            = _numVal('partCount');
    snapshot.gstSettings          = _obj('gstSettings');
    snapshot.chartOfAccounts      = _arr('chartOfAccounts');
    snapshot.printerSettings      = _obj('printerSettings');
    snapshot.ts                   = Date.now();
    snapshot._schemaVersion       = DB_VERSION;

    return snapshot;
  }


  function _lsSet(key, value) {
    try {
      try { localStorage.setItem(key, value); } catch (e) { if (e.name === "QuotaExceededError") console.warn("[StorageAdapter] localStorage quota exceeded for", key); }
      return { ok: true, error: null };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  function _lsGet(key) {
    try {
      const value = localStorage.getItem(key);
      return { found: value !== null, value: value, error: null };
    } catch (e) {
      return { found: false, value: null, error: e };
    }
  }

  function _stampVersion() {
    const ts  = Date.now();
    const uid = ts + '-' + (
      typeof performance !== 'undefined'
        ? Math.round(performance.now() * 1000)
        : Math.random().toString(36).slice(2)
    );
    _lsSet(LS_VERSION_KEY, uid);
    _lsSet(LS_TABID_KEY, _tabId);
    _lastSaveVersion = ts;
  }


  function _initBC() {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      _bc = new BroadcastChannel(BC_CHANNEL);

      _bc.onmessage = function (ev) {
        try {
          const d = ev && ev.data;
          if (!d || d.src === _tabId) return;
          if (d.type === 'sync') {
            if (typeof _onExternalChange === 'function') {
              try {
                _onExternalChange('broadcast');
              } catch (cbErr) {
                console.error('[StorageAdapter] onExternalChange(broadcast) threw:', cbErr);
              }
            }
          }
        } catch (e) {
          console.error('[StorageAdapter] BroadcastChannel message handler error:', e);
        }
      };
      _bc.onmessageerror = function (e) {
        console.warn('[StorageAdapter] BroadcastChannel messageerror:', e);
      };

    } catch (e) {
      _bc = null;
      console.warn('[StorageAdapter] BroadcastChannel init failed:', e);
    }
  }

  function _bcNotify() {
    if (!_bc) return;
    if (_bcThrottleTimer) clearTimeout(_bcThrottleTimer);

    _bcThrottleTimer = setTimeout(function () {
      _bcThrottleTimer = null;
      try {
        _bc.postMessage({ type: 'sync', src: _tabId });
      } catch (e) {
        console.warn('[StorageAdapter] BroadcastChannel postMessage failed:', e);
      }
    }, BC_THROTTLE_MS);
  }


  function _initStorageListener() {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

    window.addEventListener('storage', function (e) {
      try {
        if (e.key !== LS_VERSION_KEY) return;
        if (!e.newValue) return;

        const tabResult = _lsGet(LS_TABID_KEY);
        if (tabResult.error) return;
        if (!tabResult.found) return;
        if (tabResult.value === _tabId) return;

        if (typeof _onExternalChange === 'function') {
          try {
            _onExternalChange('storage');
          } catch (cbErr) {
            console.error('[StorageAdapter] onExternalChange(storage) threw:', cbErr);
          }
        }
      } catch (err) {
        console.error('[StorageAdapter] storage event handler error:', err);
      }
    });
  }


  function _syncAllToIDB(dataProviders) {
    let snapshot;
    try {
      snapshot = _buildSnapshot(dataProviders);
    } catch (e) {
      return Promise.reject(new Error('[StorageAdapter] _syncAllToIDB: snapshot failed — ' + e.message));
    }

    const failures = [];

    const writes = IDB_STORES.map(function (key) {
      const data = snapshot[key];
      if (!Array.isArray(data)) return Promise.resolve();

      return _idbWriteWithRetry(key, data).catch(function (e) {
        const msg = '[StorageAdapter] IDB sync error for "' + key + '": ' + (e && e.message || e);
        console.error(msg, e);
        failures.push(msg);
      });
    });

    return Promise.all(writes).then(function () {
      if (failures.length) {
        throw new Error('[StorageAdapter] IDB sync had ' + failures.length + ' failure(s):\n' + failures.join('\n'));
      }
    });
  }

  function _scheduleIDBSync(dataProviders) {
    if (_idbSyncTimer) clearTimeout(_idbSyncTimer);

    _idbSyncTimer = setTimeout(function () {
      _idbSyncTimer = null;

      const doSync = function () {
        _syncAllToIDB(dataProviders).catch(function (e) {
          console.warn('[StorageAdapter] Background IDB sync error:', e);
        });
      };

      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(doSync, { timeout: 2000 });
      } else {
        setTimeout(doSync, 100);
      }
    }, IDB_DELAY_MS);
  }


  function _isQuotaError(e) {
    if (!e) return false;
    if (e.name === 'QuotaExceededError')         return true;
    if (e.name === 'NS_ERROR_DOM_QUOTA_REACHED')  return true;
    if (e.code === 22)                            return true;
    if (e.code === 1014)                          return true;
    if (typeof e.message === 'string' &&
        e.message.toLowerCase().includes('quota')) return true;
    return false;
  }


  function init(tabId, onExternalChange) {
    _tabId = (tabId && typeof tabId === 'string')
      ? tabId
      : (Math.random().toString(36).slice(2) + Date.now());
    _onExternalChange = typeof onExternalChange === 'function' ? onExternalChange : null;

    try {
      var _wal = localStorage.getItem('mh_erp_tx_pending');
      if (_wal) {
        var _walObj = JSON.parse(_wal);
        var _walAge = Date.now() - (_walObj.timestamp || 0);
        if (_walAge < 300000) {
          console.warn('[StorageAdapter] WAL recovery: stale tx_pending found (age ' + Math.round(_walAge/1000) + 's). Previous write may have been interrupted.');
        }
        localStorage.removeItem('mh_erp_tx_pending');
      }
    } catch (_walErr) {}

    _openDB().catch(function (e) {
      console.warn('[StorageAdapter] IDB pre-warm failed (retried on next use):', e);
    });

    _initBC();
    _initStorageListener();

    
    try {
      var _txCommitHandler = null;
      function _attachTxHook() {
        if (_txCommitHandler) return;
        var bus = (window.ERP && window.ERP.EventBus) || window.EventBus;
        if (!bus || typeof bus.on !== 'function') return;
        _txCommitHandler = function () {
          setTimeout(function () {
            if (_pendingProviders && _savePending) {
              if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
              schedule(_pendingProviders);
            }
          }, 0);
        };
        bus.on('transaction:commit', _txCommitHandler);
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _attachTxHook);
      } else {
        setTimeout(_attachTxHook, 0);
      }
    } catch (_e) {   }
  }

  function buildSnapshot(dataProviders) {
    return _buildSnapshot(dataProviders);
  }

  function saveImmediate(dataProviders) {
    try {
      const snapshot = _buildSnapshot(dataProviders);

      let json;
      try {
        json = JSON.stringify(snapshot);
      } catch (serErr) {
        console.error('[StorageAdapter] JSON.stringify failed:', serErr);
        try {
          const _seen = new WeakSet();
          json = JSON.stringify(snapshot, function(key, value) {
            if (typeof value === 'object' && value !== null) {
              if (_seen.has(value)) {
                console.warn('[StorageAdapter] Circular reference removed at key:', key);
                return undefined;
              }
              _seen.add(value);
            }
            if (typeof value === 'bigint') return value.toString();
            return value;
          });
        } catch (serErr2) {
          console.error('[StorageAdapter] Safe serialization also failed:', serErr2);
          throw new Error('[StorageAdapter] Cannot serialize state: ' + (serErr2.message || serErr.message));
        }
      }

      var _walId = (ERP.uid ? ERP.uid() : ('WAL-' + Date.now()));
      try {
        localStorage.setItem('mh_erp_tx_pending', JSON.stringify({
          id:             _walId,
          txId:           _walId,
          type:           'erp_data_save',
          status:         'pending',
          steps:          ['serialize', 'ls_write_primary', 'ls_write_mini', 'version_stamp'],
          completedSteps: ['serialize'],
          payload:        null,
          timestamp:      Date.now()
        }));
      } catch (_e) {}

      const primary = _lsSet(_lsKey(), json);

      if (!primary.ok) {
        if (_isQuotaError(primary.error)) {
          const trimmed = Object.assign({}, snapshot);
          trimmed.stockMovements  = Array.isArray(trimmed.stockMovements)  ? trimmed.stockMovements.slice(-500)  : [];
          trimmed.saleReturns     = Array.isArray(trimmed.saleReturns)     ? trimmed.saleReturns.slice(-500)     : [];
          trimmed.purchaseReturns = Array.isArray(trimmed.purchaseReturns) ? trimmed.purchaseReturns.slice(-500) : [];
          trimmed.gstReturns      = Array.isArray(trimmed.gstReturns)      ? trimmed.gstReturns.slice(-200)      : [];
          trimmed.notifications   = Array.isArray(trimmed.notifications)   ? trimmed.notifications.slice(-20)   : [];
          // FIX (root-level persistence audit): stockJournal is an ever-growing
          // audit trail (one entry per stock movement, forever) and is now part
          // of the regular snapshot — without a trim here it could itself be the
          // thing that pushes localStorage over quota on this exact fallback path.
          trimmed.stockJournal    = Array.isArray(trimmed.stockJournal)    ? trimmed.stockJournal.slice(-1000)   : [];

          let retryJson;
          try { retryJson = JSON.stringify(trimmed); } catch (e) { retryJson = null; }

          if (retryJson) {
            const retry = _lsSet(_lsKey(), retryJson);
            if (!retry.ok) {
              _lsSet(_lsKeyMini(), JSON.stringify({ error: 'quota', ts: Date.now() }));
              throw retry.error || new Error('[StorageAdapter] Quota exceeded — failed after trim');
            }
            _stampVersion();
            _bcNotify();
          } else {
            _lsSet(_lsKeyMini(), JSON.stringify({ error: 'quota', ts: Date.now() }));
            throw primary.error || new Error('[StorageAdapter] Quota exceeded — serialize failed after trim');
          }

        } else {
          throw primary.error || new Error('[StorageAdapter] localStorage write failed');
        }
      } else {
        _stampVersion();
        _bcNotify();
      }

      try { localStorage.removeItem('mh_data'); } catch (e) {   }
      try { localStorage.removeItem('mh_erp_tx_pending'); } catch (_e) {}

      return true;

    } catch (e) {
      console.error('[StorageAdapter] saveImmediate error:', e);
      try {
        var _isQuota = _isQuotaError(e);
        var _msg = _isQuota
          ? '⚠️ Storage full! Data may not be saved. Please export a backup immediately.'
          : '⚠️ Data save failed. Please check browser storage and try again.';
        if (window.ERP && window.ERP.ui && typeof window.ERP.ui.toast === 'function') {
          window.ERP.ui.toast(_msg, 'error', 0);
        } else if (window.showToast && typeof window.showToast === 'function') {
          window.showToast(_msg, 'error');
        } else {
          console.warn('[StorageAdapter] SAVE FAILED:', _msg);
        }
      } catch (_te) {   }
      return false;
    }
  }

  function schedule(dataProviders) {
    _pendingProviders = dataProviders;
    _savePending      = true;

    if (_debounceTimer) clearTimeout(_debounceTimer);

    _debounceTimer = setTimeout(function () {
      _debounceTimer = null;
      if (!_savePending) return;
      _savePending = false;

      const providers   = _pendingProviders;
      _pendingProviders = null;

      const flush = function () {
        try {
          const ok = saveImmediate(providers);
          if (!ok) {
            console.error('[StorageAdapter] schedule: saveImmediate returned false');
          }
          _scheduleIDBSync(providers);
        } catch (e) {
          console.error('[StorageAdapter] schedule flush error:', e);
        }
      };

      Promise.resolve().then(flush).catch(function(e) {
        console.error('[StorageAdapter] schedule flush error:', e);
      });
    }, DEBOUNCE_MS);
  }

  function forceSync(dataProviders) {
    if (!dataProviders || typeof dataProviders !== 'object') {
      return Promise.reject(new TypeError(
        '[StorageAdapter] forceSync: dataProviders must be a non-null object of functions'
      ));
    }
    return _syncAllToIDB(dataProviders);
  }


  var _MIG_FLAG = 'mh_erp_ids_migrated_v1';
  function _migrateIds(parsed) {
    try {
      if (!parsed || typeof parsed !== 'object') return;
      if (localStorage.getItem(_MIG_FLAG) === '1') return;

      var dirty = false;

      var _stamp = function (arr, storeName) {
        if (!Array.isArray(arr)) return;
        arr.forEach(function (rec, i) {
          if (!rec || typeof rec !== 'object' || rec.id) return;
          if (storeName === 'inventory' && (rec.n || rec.name)) {
            rec.id = 'INV-' + (rec.n || rec.name).trim().replace(/\s+/g, '-').toUpperCase() + '-' + i;
          } else if (storeName === 'customers' && (rec.name || rec.ph || rec.phone)) {
            rec.id = 'CUST-' + (rec.name || 'X').trim().replace(/\s+/g, '-').toUpperCase()
                   + '-' + (rec.phone || rec.ph || i);
          } else if (storeName === 'vehicles' && rec.plate) {
            rec.id = 'VEH-' + rec.plate.trim().toUpperCase();
          } else if ((storeName === 'mechanics' || storeName === 'staff') && (rec.name || rec.n)) {
            rec.id = 'STAFF-' + (rec.name || rec.n).trim().replace(/\s+/g, '-').toUpperCase() + '-' + i;
          } else {
            rec.id = storeName.toUpperCase() + '-' + ERP.uid(); // FIX (root cause, audit #61-62): was an independent index+Date.now() scheme; route through the one canonical generator.
          }
          dirty = true;
        });
      };

      ['inventory', 'customers', 'vehicles', 'mechanics', 'staff',
       'suppliers', 'jobs', 'sales', 'purchases', 'expenses'].forEach(function (store) {
        _stamp(parsed[store], store);
      });

      if (dirty) {
        _lsSet(_lsKey(), JSON.stringify(parsed));
        if (window.DEBUG_MODE) console.log('[StorageAdapter] _migrateIds: id backfill written to localStorage');
      }
      try { localStorage.setItem(_MIG_FLAG, '1'); } catch (e) { if (e.name === 'QuotaExceededError') console.warn('[StorageAdapter] Migration flag write failed'); }
    } catch (e) {
      if (window.DEBUG_MODE) console.warn('[StorageAdapter] _migrateIds failed:', e);
    }
  }

  function load() {
    const result = _lsGet(_lsKey());

    if (result.error) {
      console.warn('[StorageAdapter] load(): localStorage unavailable:', result.error);
      return { data: null, source: null, error: result.error };
    }

    if (!result.found || !result.value) {
      return { data: null, source: null, error: null };
    }

    try {
      const parsed = JSON.parse(result.value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        _lsSet(_lsKey() + '_corrupt_backup', result.value.substring(0, 1000));
        console.error('[StorageAdapter] load(): snapshot is not a plain object — backed up and clearing');
        return {
          data:   null,
          source: 'localStorage',
          error:  new Error('[StorageAdapter] load(): snapshot corrupted — safe empty state returned'),
        };
      }
      if (parsed._schemaVersion && parsed._schemaVersion > DB_VERSION) {
        console.warn(
          '[StorageAdapter] load(): stored _schemaVersion (' + parsed._schemaVersion +
          ') > current DB_VERSION (' + DB_VERSION + ') — possible downgrade'
        );
      }
      _migrateIds(parsed);
      return { data: parsed, source: 'localStorage', error: null };
    } catch (parseErr) {
      try { _lsSet(_lsKey() + '_corrupt_backup', result.value.substring(0, 1000)); } catch (e) {}
      return {
        data:   null,
        source: 'localStorage',
        error:  new Error('[StorageAdapter] load(): JSON parse failed — corrupted data backed up, safe empty state returned'),
      };
    }
  }

  function loadFromIDB(storeName) {
    return _idbRead(storeName);
  }

  function loadAllFromIDB() {
    return _openDB().then(function () {
      const reads = IDB_STORES.map(function (name) {
        return _idbRead(name)
          .then(function (data) {
            if (!Array.isArray(data)) {
              console.warn('[StorageAdapter] loadAllFromIDB: "' + name + '" returned non-array — using []');
              return { name: name, data: [], error: null, missing: false };
            }
            return { name: name, data: data, error: null, missing: false };
          })
          .catch(function (e) {
            console.warn('[StorageAdapter] loadAllFromIDB: failed to load "' + name + '":', e);
            return { name: name, data: [], error: e, missing: true };
          });
      });

      return Promise.all(reads).then(function (results) {
        const out = {};
        results.forEach(function (r) { out[r.name] = r.data; });
        return out;
      });
    });
  }


  
  function isSavePending() { return _savePending; }

  
  (function _installUnloadGuard() {
    if (typeof window === 'undefined') return;
    if (window._mh_unload_guard_installed) return;
    window._mh_unload_guard_installed = true;
    window.addEventListener('beforeunload', function (e) {
      if (!_savePending) return;
      var _wasPending = _savePending;
      try {
        if (_pendingProviders) {
          saveImmediate(_pendingProviders);
          _savePending = false;
        }
      } catch (_) {   }
      if (_wasPending && _savePending) {
        var msg = 'Data is still being saved. Leaving now may cause data loss.';
        e.preventDefault();
        e.returnValue = msg;
        return msg;
      }
    });
  })();

  return {
    init,
    buildSnapshot,
    saveImmediate,
    schedule,
    forceSync,
    load,
    loadFromIDB,
    loadAllFromIDB,
    isSavePending,
  };

})();

if (typeof window !== 'undefined') window.StorageAdapter = StorageAdapter;

/* ============================== SECTION 3 — single persistence choke point (was erp.persistence.js) ============================== */
/*
 * erp.persistence.js — ARCHITECTURAL REFACTOR (root-level persistence unification)
 * ---------------------------------------------------------------------------
 * Before this file existed, IndexedDB writes happened from 7 different places
 * in the codebase, each with its own logic:
 *   1. StorageAdapter's debounced full-snapshot sync (IDB_STORES whitelist)
 *   2. inventory.js's own explicit db.save('inventory', ...) + retry logic
 *   3. sales_service.js's _persist()/_atomicSave() -> Storage().save()
 *   4. batch.js's own explicit db.save('batches', ...)
 *   5. auth.js's own explicit db.save('users', ...)
 *   6. purchase.js's legacy explicit db.save('payOut'/'purchaseReturns', ...)
 *   7. accounting_store.js's own putOne() (a genuinely different, per-record
 *      data model for the AccountingCore subsystem — journals/ledger/loans/
 *      coa under the 'acc_' prefix). Now migrated to call
 *      ERP.Persistence.saveRecord() below instead of ERP._db.save()
 *      directly — same file, same underlying primitive, record-shaped entry
 *      point instead of array-shaped, because that's the correct fit for a
 *      double-entry ledger (one journal at a time, never a full-store
 *      replace). See the note near the bottom of this file.
 *
 * Each of (1)-(6) independently decided "which stores exist" and "how to
 * write one" — which is exactly how stockBatches ended up being silently
 * wiped to [] on every sync (whitelisted in one place, but with no data
 * source registered anywhere else) and how vehicles/stockJournal never
 * reached IndexedDB at all (missing from a whitelist that had no single
 * source of truth).
 *
 * ERP.Persistence is now that single source of truth. Every one of (2)-(6)
 * has been rewritten to delegate here instead of calling db.save() directly.
 * (1) — StorageAdapter's background sync — also delegates its actual
 * IndexedDB writes here now; it still owns the localStorage snapshot, which
 * is a distinct, legitimate responsibility (fast synchronous cache).
 *
 * There are still two call *shapes*, because they solve genuinely different
 * problems, not because of leftover duplication:
 *   - ERP.Persistence.save(store, data)      -> one store, immediate, used by
 *     code that needs a real success/failure result right now (e.g. atomic
 *     multi-step transactions with rollback).
 *   - ERP.Persistence.schedule()             -> "something changed, sync
 *     everything" — debounced, used by UI-driven mutations that fire often.
 * Both funnel through the same save() primitive at the bottom, and both
 * always cover every store in ERP._internal.getStoreNames() — there is no
 * whitelist left anywhere in the app for either path to forget a store from.
 */
(function (root) {
  'use strict';

  var ERP = root.ERP;
  if (!ERP) { console.error('[ERP.Persistence] ERP core not loaded yet'); return; }

  var DEBOUNCE_MS = 200;
  var _debounceTimer = null;
  var _pending = false;

  function _storeNames() {
    try {
      if (ERP._internal && typeof ERP._internal.getStoreNames === 'function') {
        var names = ERP._internal.getStoreNames();
        if (Array.isArray(names) && names.length) return names;
      }
    } catch (e) {}
    return [];
  }

  function _providers() {
    return (typeof root._erpGetProviders === 'function') ? root._erpGetProviders() : null;
  }

  // The current live value for one store, wherever it actually lives
  // (a legacy window global via getProviders(), or ERP.state directly).
  function _currentValue(storeName) {
    var providers = _providers();
    if (providers && typeof providers[storeName] === 'function') {
      try {
        var v = providers[storeName]();
        if (Array.isArray(v)) return v;
      } catch (e) {
        console.warn('[ERP.Persistence] provider threw for', storeName, e);
      }
    }
    try {
      var s = ERP.getState();
      if (s && s.data && Array.isArray(s.data[storeName])) return s.data[storeName];
    } catch (e) {}
    return [];
  }

  function _recordFailure(storeName, msg) {
    try {
      ERP.setState(function (s) {
        s.data._persistFailures = (s.data._persistFailures || []).filter(function (f) {
          return f.collection !== storeName;
        });
        s.data._persistFailures.push({ collection: storeName, ts: Date.now(), error: msg });
      }, storeName + ':persist-failure-queued');
    } catch (e) {}
  }

  function _clearFailure(storeName) {
    try {
      ERP.setState(function (s) {
        if (!s.data._persistFailures) return;
        s.data._persistFailures = s.data._persistFailures.filter(function (f) {
          return f.collection !== storeName;
        });
      }, storeName + ':persist-failure-cleared');
    } catch (e) {}
  }

  function _toast(msg, type, dur) {
    try { if (typeof root.showToast === 'function') root.showToast(msg, type, dur); } catch (e) {}
  }

  /**
   * THE single choke point for writing one store to IndexedDB.
   * data is optional — if omitted, the current live value is looked up via
   * the provider registry (same registry StorageAdapter's snapshot uses).
   */
  function save(storeName, data, opts) {
    opts = opts || {};
    var retries = (typeof opts.retries === 'number') ? opts.retries : 3;
    var silent  = !!opts.silent;
    var value   = (data === undefined) ? _currentValue(storeName) : data;

    if (!Array.isArray(value)) {
      return Promise.reject(new Error('[ERP.Persistence] save(' + storeName + '): value is not an array'));
    }

    function attempt(retriesLeft, delay) {
      if (!ERP._db || typeof ERP._db.save !== 'function') {
        return Promise.reject(new Error('DB layer not available'));
      }
      return ERP._db.save(storeName, value).then(function (r) {
        if (!silent) _clearFailure(storeName);
        return r;
      }).catch(function (e) {
        var msg = e && (e.message || String(e));
        if (retriesLeft > 0) {
          return new Promise(function (resolve) {
            setTimeout(function () { resolve(attempt(retriesLeft - 1, delay + 400)); }, delay);
          });
        }
        if (!silent) {
          console.error('[ERP.Persistence] save failed after retries:', storeName, msg);
          _recordFailure(storeName, msg);
          _toast('\u26a0\ufe0f ' + storeName + ' save failed after retries — change is kept this session and will retry automatically next time the app loads.', 'error', 10000);
        }
        throw e;
      });
    }

    return attempt(retries, 400);
  }

  /**
   * Save every known store. This is the full-snapshot write — the same job
   * StorageAdapter's background IDB sync used to do with its own whitelist;
   * now it (and everything else) calls this instead.
   */
  function saveAll(opts) {
    var stores = _storeNames();
    var failures = [];
    return Promise.all(stores.map(function (key) {
      return save(key, undefined, Object.assign({ silent: true }, opts)).catch(function (e) {
        failures.push({ store: key, error: e && e.message });
      });
    })).then(function () {
      // Keep the localStorage snapshot (fast cache, separate concern) in sync too.
      try {
        var providers = _providers();
        if (root.StorageAdapter && providers && typeof root.StorageAdapter.saveImmediate === 'function') {
          root.StorageAdapter.saveImmediate(providers);
        }
      } catch (e) {}
      if (failures.length) {
        console.warn('[ERP.Persistence] saveAll: ' + failures.length + ' store(s) failed:', failures);
      }
      return { ok: failures.length === 0, failures: failures };
    });
  }

  /**
   * Debounced "something changed, sync everything" entry point — this is
   * what UI-driven mutations should call. Replaces StorageAdapter.schedule()
   * as the thing modules reach for; StorageAdapter itself now uses this too.
   */
  function schedule() {
    _pending = true;
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(function () {
      _debounceTimer = null;
      if (!_pending) return;
      _pending = false;
      var run = function () {
        saveAll().catch(function (e) {
          console.error('[ERP.Persistence] scheduled saveAll failed:', e);
        });
      };
      if (typeof requestIdleCallback !== 'undefined') requestIdleCallback(run, { timeout: 2000 });
      else setTimeout(run, 50);
    }, DEBOUNCE_MS);
  }

  function load(storeName) {
    if (!ERP._db || typeof ERP._db.load !== 'function') {
      return Promise.reject(new Error('DB layer not available'));
    }
    return ERP._db.load(storeName);
  }

  /**
   * Boot-time: load every known store from IndexedDB. db.js's hydrate()
   * already does this with schema validation/defaults applied per store —
   * this is exposed here mainly so other code has one obvious place to look,
   * and for stores added in the future that don't need special validation.
   */
  function hydrateAll() {
    var stores = _storeNames();
    return Promise.all(stores.map(function (key) {
      return load(key).then(function (data) {
        if (!Array.isArray(data)) return;
        ERP.setState(function (s) { s.data[key] = data; }, key + ':hydrate');
      }).catch(function (e) {
        console.warn('[ERP.Persistence] hydrateAll: failed for', key, e);
      });
    }));
  }

  /**
   * Per-record save — the other half of what the underlying ERP._db.save()
   * primitive supports (it's dual-mode: array -> full-snapshot replace,
   * single object -> put-one-record). Used by subsystems with a genuine
   * per-record data model (AccountingCore's journals/ledger/loans/coa) where
   * forcing the array-snapshot model above would be the wrong fit, not a
   * cleanup. This still means literally every IndexedDB write in the app —
   * both shapes — funnels through this one file.
   */
  function saveRecord(storeName, record, opts) {
    opts = opts || {};
    var retries = (typeof opts.retries === 'number') ? opts.retries : 2;
    var silent  = !!opts.silent;

    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return Promise.reject(new Error('[ERP.Persistence] saveRecord(' + storeName + '): expected a single record object'));
    }

    function attempt(retriesLeft, delay) {
      if (!ERP._db || typeof ERP._db.save !== 'function') {
        return Promise.reject(new Error('DB layer not available'));
      }
      return ERP._db.save(storeName, record).catch(function (e) {
        if (retriesLeft > 0) {
          return new Promise(function (resolve) {
            setTimeout(function () { resolve(attempt(retriesLeft - 1, delay + 400)); }, delay);
          });
        }
        if (!silent) {
          console.error('[ERP.Persistence] saveRecord failed after retries:', storeName, e && e.message);
        }
        throw e;
      });
    }

    return attempt(retries, 400);
  }

  function loadRecord(storeName, id) {
    return load(storeName).then(function (records) {
      if (!Array.isArray(records)) return null;
      return records.find(function (r) { return r && r.id === id; }) || null;
    });
  }

  function deleteRecord(storeName, id) {
    if (!ERP._db || typeof ERP._db.delete !== 'function') {
      return Promise.reject(new Error('DB layer not available'));
    }
    return ERP._db.delete(storeName, id);
  }

  /**
   * Object/dictionary-shaped save — the third legitimate data shape in this
   * app, alongside array-snapshot (save/saveAll) and per-record
   * (saveRecord). Used for things like PurchaseState's supplier ledger: a
   * whole dictionary keyed by supplier id, not a list of records and not one
   * record. Stored as {key, value} in the 'objectSnapshots' store (keyPath
   * 'key' — see db.js's _DB_KEY_MAP), reusing the same db.save()/db.load()
   * primitives as everything else in the app.
   */
  function saveObject(key, obj, opts) {
    opts = opts || {};
    var retries = (typeof opts.retries === 'number') ? opts.retries : 2;
    var silent  = !!opts.silent;
    var record  = { key: key, value: obj };

    function attempt(retriesLeft, delay) {
      if (!ERP._db || typeof ERP._db.save !== 'function') {
        return Promise.reject(new Error('DB layer not available'));
      }
      return ERP._db.save('objectSnapshots', record).catch(function (e) {
        if (retriesLeft > 0) {
          return new Promise(function (resolve) {
            setTimeout(function () { resolve(attempt(retriesLeft - 1, delay + 400)); }, delay);
          });
        }
        if (!silent) console.error('[ERP.Persistence] saveObject failed after retries:', key, e && e.message);
        throw e;
      });
    }

    return attempt(retries, 400);
  }

  function loadObject(key) {
    return load('objectSnapshots').then(function (records) {
      if (!Array.isArray(records)) return null;
      var rec = records.find(function (r) { return r && r.key === key; });
      return rec ? rec.value : null;
    });
  }

  ERP.Persistence = {
    save: save,
    saveAll: saveAll,
    schedule: schedule,
    load: load,
    hydrateAll: hydrateAll,
    saveRecord: saveRecord,
    loadRecord: loadRecord,
    deleteRecord: deleteRecord,
    saveObject: saveObject,
    loadObject: loadObject
  };

  /*
   * Note on AccountingCore (accounting_store.js / loans.service.js / etc.):
   * that subsystem persists per-record (one journal/loan/ledger-line at a
   * time) rather than per-store-array-snapshot, because it's a real
   * double-entry ledger engine with its own journals/periods/reversal-index
   * concerns — forcing it through the array-snapshot save()/saveAll() above
   * would be a worse fit, not a cleanup (it would replace the whole store
   * with just the one record being saved). Instead it now calls
   * ERP.Persistence.saveRecord() — the same single file, same underlying
   * ERP._db.save() primitive, just the record-shaped entry point instead of
   * the array-shaped one. There is no code left anywhere in the app that
   * calls ERP._db.save()/load() directly except this file.
   */
})(window);

/* ============================== SECTION 4 — localStorage quota monitoring (was erp.storage.guardian.js) ============================== */

'use strict';

(function (root) {
  'use strict';

  if (root.ERP && root.ERP.__phase11_guardian) return;

  var ERP = root.ERP = root.ERP || {};

  function _logger() {
    return root.Logger || ERP.Logger || {
      info:  function () {},
      warn:  function (m) { console.warn(m); },
      error: function (m) { console.error(m); }
    };
  }

  function _try(fn, fallback) {
    try { return fn(); }
    catch (e) { return (fallback !== undefined ? fallback : null); }
  }

  var QUOTA_ESTIMATE_BYTES = 5 * 1024 * 1024;

  function _initQuotaEstimate() {
    if (navigator && navigator.storage && typeof navigator.storage.estimate === 'function') {
      navigator.storage.estimate().then(function(est) {
        if (est && est.quota && est.quota > 0) {
          QUOTA_ESTIMATE_BYTES = Math.floor(est.quota * 0.9);
        }
      }).catch(function(e) { if (window.DEBUG_MODE) console.warn('[StorageGuardian] quota estimate failed:', e && e.message || e); });
    }
  }
  _initQuotaEstimate();
  var WARN_THRESHOLD       = 0.70;
  var CRITICAL_THRESHOLD   = 0.90;
  var CHECK_INTERVAL_MS    = 30000;

  // ARCHITECTURAL FIX: built lazily via function (not a top-level const array)
  // because this file loads before constants.js in index.html — ERP.CONSTANTS
  // wouldn't exist yet at module-init time. Safe since the only usage (below)
  // happens inside a function called later, after all scripts have loaded.
  function _monitoredKeys() {
    var mainKey = (root.ERP.CONSTANTS && root.ERP.CONSTANTS.STORAGE_KEYS && root.ERP.CONSTANTS.STORAGE_KEYS.MAIN) || 'mh_erp_data';
    var miniKey = (root.ERP.CONSTANTS && root.ERP.CONSTANTS.STORAGE_KEYS && root.ERP.CONSTANTS.STORAGE_KEYS.MINI) || 'mh_erp_data_mini';
    return [
      { key: mainKey,                  classification: 'CRITICAL'   },
      { key: 'mh_audit_log',          classification: 'CRITICAL'   },
      { key: 'mh_supplier_ledger',    classification: 'CRITICAL'   },
      { key: 'mh_purchase_store',     classification: 'CRITICAL'   },
      { key: 'mh_purchase_meta',      classification: 'IMPORTANT'  },
      { key: 'mh_paymentOuts',        classification: 'CRITICAL'   },
      { key: 'mh_mechanics',          classification: 'IMPORTANT'  },
      { key: 'mh_session',            classification: 'IMPORTANT'  },
      { key: 'mh_biz_info',           classification: 'IMPORTANT'  },
      { key: 'erp_guard_invoices_v1', classification: 'IMPORTANT'  },
      { key: 'erp_edit_locks_v1',     classification: 'IMPORTANT'  },
      { key: 'erp_feature_flags',     classification: 'IMPORTANT'  },
      { key: 'erp_kernel_log',        classification: 'CACHE'      },
      { key: miniKey,                 classification: 'CACHE'      }
    ];
  }

  var _intervalId      = null;
  var _lastStatus      = 'OK';
  var _lastUsagePct    = 0;
  var _auditCapNotified = false;

  function _measureUsage() {
    return _try(function () {
      var totalBytes = 0;
      var keys = [];

      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        var v = localStorage.getItem(k);
        var bytes = v ? (v.length * 2) : 0;
        totalBytes += bytes;
        keys.push({ key: k, bytes: bytes, kb: Math.round(bytes / 1024 * 10) / 10 });
      }

      keys.sort(function (a, b) { return b.bytes - a.bytes; });

      var knownMap = {};
      _monitoredKeys().forEach(function (m) { knownMap[m.key] = m.classification; });
      keys.forEach(function (k) {
        k.classification = knownMap[k.key] || 'UNKNOWN';
      });

      var usagePct = totalBytes / QUOTA_ESTIMATE_BYTES;

      return {
        totalBytes:       totalBytes,
        totalKB:          Math.round(totalBytes / 1024 * 10) / 10,
        totalMB:          Math.round(totalBytes / 1024 / 1024 * 100) / 100,
        quotaEstimateKB:  Math.round(QUOTA_ESTIMATE_BYTES / 1024),
        usagePct:         Math.round(usagePct * 1000) / 10,
        keys:             keys
      };
    }, { totalBytes: 0, totalKB: 0, totalMB: 0, quotaEstimateKB: 5120, usagePct: 0, keys: [], error: 'measurement_failed' });
  }

  function _calcStatus(usagePct) {
    var pct = usagePct / 100;
    if (pct >= CRITICAL_THRESHOLD) return 'CRITICAL';
    if (pct >= WARN_THRESHOLD)     return 'WARNING';
    return 'OK';
  }

  function _runCheck() {
    return _try(function () {
      var usage   = _measureUsage();
      var status  = _calcStatus(usage.usagePct);
      var changed = status !== _lastStatus;

      _lastStatus   = status;
      _lastUsagePct = usage.usagePct;

      if (status === 'CRITICAL') {
        _logger().error(
          '[ERP.StorageGuardian] CRITICAL: localStorage ' + usage.usagePct + '% full (' +
          usage.totalMB + 'MB / ' + Math.round(QUOTA_ESTIMATE_BYTES / 1024 / 1024) + 'MB). ' +
          'Export backup immediately.'
        );
        if (changed) {
          ERP.EventBus && ERP.EventBus.emit &&
            ERP.EventBus.emit('storage:critical', { usage: usage });
          ERP.EventBus && ERP.EventBus.emit &&
            ERP.EventBus.emit('backup:reminder', { reason: 'storage_critical', usage: usage });
        }

      } else if (status === 'WARNING') {
        _logger().warn(
          '[ERP.StorageGuardian] WARNING: localStorage ' + usage.usagePct + '% full (' +
          usage.totalMB + 'MB). Consider exporting a backup.'
        );
        if (changed) {
          ERP.EventBus && ERP.EventBus.emit &&
            ERP.EventBus.emit('storage:warning', { usage: usage });
        }

      } else if (changed) {
        _logger().info('[ERP.StorageGuardian] Storage OK — ' + usage.usagePct + '% used (' + usage.totalMB + 'MB).');
      }

      _try(function () {
        var auditRaw = localStorage.getItem('mh_audit_log');
        if (!auditRaw) { _auditCapNotified = false; return; }
        var entries = JSON.parse(auditRaw);
        var overCap = Array.isArray(entries) && entries.length >= 450;
        if (overCap && !_auditCapNotified) {
          _auditCapNotified = true;
          ERP.EventBus && ERP.EventBus.emit &&
            ERP.EventBus.emit('audit:nearCap', { count: entries.length });
        } else if (!overCap) {
          _auditCapNotified = false;
        }
      });

      return usage;
    }, null);
  }

  ERP.StorageGuardian = {
    __phase11_guardian: true,
    VERSION: '11.7.0',

    getUsage: function () {
      return _try(_measureUsage, {
        totalBytes: 0, totalKB: 0, totalMB: 0,
        quotaEstimateKB: 5120, usagePct: 0,
        keys: [], error: 'measurement_failed'
      });
    },

    getStatus: function () {
      return _try(function () { return _lastStatus; }, 'UNKNOWN');
    },

    startMonitoring: function (intervalMs) {
      if (_intervalId) return;
      var ms = (typeof intervalMs === 'number' && intervalMs > 0) ? intervalMs : CHECK_INTERVAL_MS;
      if (navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then(function() { _runCheck(); }).catch(function() { _runCheck(); });
      } else {
        setTimeout(_runCheck, 0);
      }
      _intervalId = ERP.TimerRegistry.start('storageGuardian.usageCheck', _runCheck, ms);
      try { if (typeof ERP !== 'undefined') ERP._storageInterval = _intervalId; } catch (_) {}
      _logger().info('[ERP.StorageGuardian] Monitoring started (every ' + Math.round(ms / 1000) + 's).');
    },

    stopMonitoring: function () {
      if (_intervalId) {
        ERP.TimerRegistry.clear('storageGuardian.usageCheck');
        _intervalId = null;
        try { if (typeof ERP !== 'undefined') ERP._storageInterval = null; } catch (_) {}
        _logger().info('[ERP.StorageGuardian] Monitoring stopped.');
      }
    },

    check: function () {
      var usage = _runCheck();
      return usage || this.getUsage();
    },

    measure: function () {
      return this.getUsage();
    }
  };

  ERP.__phase11_guardian = true;

  function _autoStart() {
    _try(function () {
      var flagOff = ERP.FeatureFlags &&
                    typeof ERP.FeatureFlags.get === 'function' &&
                    ERP.FeatureFlags.get('storage_guardian') === false;
      if (!flagOff) {
        ERP.StorageGuardian.startMonitoring(CHECK_INTERVAL_MS);
      }

      if (ERP.EventBus && typeof ERP.EventBus.on === 'function') {
        ERP.EventBus.on('flag:changed', function (data) {
          if (!data || data.flag !== 'storage_guardian') return;
          if (data.newValue === false) {
            ERP.StorageGuardian.stopMonitoring();
          } else if (data.newValue === true) {
            ERP.StorageGuardian.startMonitoring(CHECK_INTERVAL_MS);
          }
        });
      }
    });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(_autoStart, 0);
  } else {
    document.addEventListener('DOMContentLoaded', _autoStart);
  }

  _logger().info('[ERP.StorageGuardian] Phase 11.7 loaded — v11.7.0');

}(window));

/* ============================== SECTION 5 — sales-domain small-key storage (was sales.storage.adapter.js) ============================== */
'use strict';

(function (ERP) {

  

  var _ok   = function(d, m){ return { success:true,  data:d||null, error:null,    meta:m||{} }; };
  var _fail  = function(e, m){ return { success:false, data:null,    error:e||null, meta:m||{} }; };

  var _SCHEMA_V     = 1;
  var _LS_WARN_BYTES = 4 * 1024 * 1024;

  var _idb = null;
  var _idbFailCount = 0;

  (function _initIDB(){
    var _attempts = 0;
    function _poll(){
      _attempts++;
      if(window.ERP && window.ERP._db && typeof window.ERP._db.save === 'function'){
        _idb = window.ERP._db;
        _idbFailCount = 0;
        return;
      }
      if(_attempts < 20) setTimeout(_poll, 250);
    }
    setTimeout(_poll, 0);
  })();

  // ARCHITECTURAL FIX: these used to call _idb.load()/_idb.save() directly
  // (_idb being a raw reference to ERP._db, set by the poll below) — the
  // same bypass-the-choke-point pattern as the old save() branch further
  // down. `_idb` is still used elsewhere in this file purely as an
  // "is IndexedDB available yet" readiness flag; the actual read/write now
  // always goes through ERP.Persistence, same as every other store in the
  // app.
  function _idbGet(key){
    if(!_idb || !window.ERP || !window.ERP.Persistence) return Promise.reject(new Error('IDB not ready'));
    return window.ERP.Persistence.load(key).then(function(arr){
      return Array.isArray(arr) ? arr : null;
    });
  }

  function _idbSet(key, val){
    if(!_idb || !window.ERP || !window.ERP.Persistence) return Promise.reject(new Error('IDB not ready'));
    var data = Array.isArray(val) ? val : (val !== null && val !== undefined ? [val] : []);
    return window.ERP.Persistence.save(key, data, { retries: 0, silent: true });
  }

  function _isQuotaError(e){
    if(!e) return false;
    var n = e.name || '';
    var m = (e.message || '').toLowerCase();
    return n === 'QuotaExceededError'
        || n === 'NS_ERROR_DOM_QUOTA_REACHED'
        || m.indexOf('quota') >= 0
        || m.indexOf('exceeded') >= 0;
  }

  function _evictOldData(){
    var evictable = ['erp_sales_theme','erp_sales_color','erp_ui_prefs'];
    var freed = 0;
    evictable.forEach(function(k){
      try{ var len=(localStorage.getItem(k)||'').length; localStorage.removeItem(k); freed+=len; }catch(e){ if(window.DEBUG_MODE) console.error(e); }
    });
    return freed;
  }

  
  function _retry(fn, attempts, delayMs){
    return fn().catch(function(e){
      if(attempts <= 1 || _isQuotaError(e)) return Promise.reject(e);
      return new Promise(function(res){ setTimeout(res, delayMs || 200); })
        .then(function(){ return _retry(fn, attempts - 1, delayMs); });
    });
  }

  var _crossTabRenderTimers = {};

  var StorageAdapter = {

    get: function(key){
      // NOTE: there used to be an `ERP.storage.get` branch here, but
      // db.js's ERP.storage never actually defines a `get` method (only
      // save/load/delete/backup/hydrate/clearAll/exportJSON/importJSON), so
      // this branch never fired — dead code, removed. Read path is
      // localStorage first (fast, synchronous), then ERP.Persistence.load()
      // as the IndexedDB fallback below.
      try{
        var raw = localStorage.getItem('erp_' + key);
        if(raw !== null) return Promise.resolve(_ok(JSON.parse(raw)));
      }catch(e){ if(window.DEBUG_MODE) console.error(e); }
      if(_idb){
        return _idbGet(key)
          .then(function(v){ return _ok(v !== null ? v : null); })
          .catch(function(){ return _fail('idb_error'); });
      }
      return Promise.resolve(_fail('no_storage_backend'));
    },

    save: function(key, val){
      if(val === null || val === undefined){
        
        return Promise.resolve(_ok(null, { skipped: true, reason: 'null_data' }));
      }
      var serialized;
      try{ serialized = JSON.stringify(val); }
      catch(e){ return Promise.resolve(_fail('json_serialize: ' + e.message)); }

      if(serialized.length > _LS_WARN_BYTES){
        if(window.DEBUG_MODE) console.warn('[storage] "'+key+'" is '+Math.round(serialized.length/1024)+'KB');
        try{ if(ERP.onStorageWarning) ERP.onStorageWarning({ key:key, dataSize:serialized.length, message:'Key "'+key+'" is '+Math.round(serialized.length/1024)+'KB — archive old records.' }); }catch(e){ if(window.DEBUG_MODE) console.error(e); }
      }

      var _lsSave = function(){
        return new Promise(function(resolve){
          try{
            localStorage.setItem('erp_' + key, serialized);
            resolve(_ok());
          }catch(e){
            if(_isQuotaError(e)){
              var freed = _evictOldData();
              if(freed > 0){
                try{ localStorage.setItem('erp_' + key, serialized); resolve(_ok({ evicted:true })); return; }
                catch(e2){ resolve(_fail('quota_exceeded_after_evict', { key:key, dataSize:serialized.length, message:'Storage full even after eviction. Archive old invoices.' })); }
              }
              resolve(_fail('quota_exceeded', { key:key, dataSize:serialized.length, message:'Storage full ('+Math.round(serialized.length/1024)+'KB). Archive old invoices.' }));
            } else {
              resolve(_fail(e.message || 'ls_write_error'));
            }
          }
        });
      };

      var _runLsFallback = function(dbErr){
        if(window.DEBUG_MODE && dbErr) console.warn('[storage] DB-backed save failed for "'+key+'", falling back to localStorage:', dbErr);
        return _retry(_lsSave, 3, 150).then(function(r){
          if(r.success){
            try{ localStorage.setItem('erp_v_' + key, _SCHEMA_V + ':' + Date.now()); }catch(e){ if(window.DEBUG_MODE) console.error(e); }
            if(_idb){
              _idbSet(key, val).then(function(){ _idbFailCount = 0; }).catch(function(e){

                _idbFailCount++;
                if(_idbFailCount >= 5){  _idb = null; }
              });
            }
          }
          if(!r.success && r.meta && r.meta.message){
            try{ if(ERP.onStorageWarning) ERP.onStorageWarning(r.meta); }catch(e){ if(window.DEBUG_MODE) console.error(e); }
          }
          return r;
        }).catch(function(e){
        if(window.DEBUG_MODE) console.error('[_runLsFallback]', e);
        return _fail((e && e.message) || 'storage_fallback_failed');
      });
      };

      // ARCHITECTURAL FIX: this used to be preceded by an
      // `if (ERP.storage && typeof ERP.storage.save === 'function')` branch
      // that called ERP.storage.save() (db.js's thin wrapper around
      // db.save()) directly. db.js always defines ERP.storage.save, so that
      // condition was *always* true — meaning the ERP.Persistence.save()
      // call below was permanently unreachable dead code, and every write
      // that went through this adapter (job_service.js's 'sales' IDB writes,
      // among others) was silently bypassing the single choke point. Not a
      // data-loss bug — ERP.storage.save and ERP.Persistence.save both
      // bottom out in the same db.save() primitive — but it meant this
      // path's writes never got ERP.Persistence's retry/backoff or
      // _persistFailures tracking. The branch is removed; this is the only
      // path now.
      //
      // retries:0/silent:true because this function already has its own
      // localStorage-fallback + retry (_runLsFallback/_retry below) and its
      // own richer failure reporting (ERP.onStorageWarning) — we don't want
      // two independent retry loops stacking, or a duplicate warning
      // surfaced.
      try{
        var persR = ERP.Persistence.save(key, val, { retries: 0, silent: true });
        return persR.then(function(v){ return _ok(v); }, function(e){ return _runLsFallback(e); });
      }catch(e){ if(window.DEBUG_MODE) console.error(e); }

      return _runLsFallback();
    },

    persist: function(stateKey, getStateFn, rollbackFn){
      var val;
      try{ val = getStateFn(); }
      catch(e){ return Promise.resolve(_fail(e.message || 'getState failed')); }
      var snapshot;
      try{ snapshot = JSON.parse(JSON.stringify(val || [])); }catch(e){ snapshot = null; }
      function doRollback(){
        if(snapshot !== null && typeof rollbackFn === 'function'){
          try{ rollbackFn(snapshot); }
          catch(re){ if(window.DEBUG_MODE) console.error(re); }
        }
      }
      return this.save(stateKey, val).then(function(res){
        if(!res.success) doRollback();
        return res;
      }).catch(function(e){ doRollback(); return _fail(e.message || 'persist_error'); });
    },

    recoverFromIDB: function(key){
      if(!_idb) return Promise.resolve(_fail('idb_not_available'));
      return _idbGet(key)
        .then(function(val){
          if(val === null || val === undefined) return _fail('idb_key_missing');
          try{ localStorage.setItem('erp_' + key, JSON.stringify(val)); }catch(e){ if(window.DEBUG_MODE) console.error(e); }
          return _ok(val);
        })
        .catch(function(e){ return _fail(e.message || 'idb_read_error'); });
    },

    getWriteMeta: function(key){
      try{
        var raw = localStorage.getItem('erp_v_' + key);
        if(!raw) return null;
        var parts = raw.split(':');
        return { version:parseInt(parts[0],10), timestamp:parseInt(parts[1],10) };
      }catch(e){ return null; }
    },

    getTotalUsage: function(){
      var total = 0; var erpKeys = [];
      try{
        for(var i=0; i<localStorage.length; i++){
          var k = localStorage.key(i);
          if(k && k.indexOf('erp_') === 0){
            var v = localStorage.getItem(k)||'';
            total += k.length + v.length;
            erpKeys.push({ key:k.replace('erp_',''), bytes:v.length });
          }
        }
      }catch(e){ if(window.DEBUG_MODE) console.error(e); }
      return { totalBytes:total, totalKB:Math.round(total/1024), keys:erpKeys.sort(function(a,b){ return b.bytes-a.bytes; }), warningZone:total>_LS_WARN_BYTES };
    },

    getTheme: function(){ return this.get('sales_theme').then(function(res){ return res.success ? res.data : null; }).catch(function(e){ if(window.DEBUG_MODE) console.error('[getTheme]', e); return null; }); },
    saveTheme: function(theme){ return this.save('sales_theme', theme); },
    getColor:  function(){ return this.get('sales_color').then(function(res){ return res.success ? res.data : null; }).catch(function(e){ if(window.DEBUG_MODE) console.error('[getColor]', e); return null; }); },
    saveColor: function(color){ return this.save('sales_color', color); }
  };

  if(typeof window !== 'undefined' && window.addEventListener){
    window.addEventListener('storage', function(e){
      if(!e.key || e.key.indexOf('erp_') !== 0 || e.key.indexOf('erp_v_') === 0) return;
      var stateKey = e.key.replace(/^erp_/, '');
      var validKeys = ['sales','estimates','saleOrders','payIn','saleReturns','deliveryChallans','customers','inventory'];
      if(validKeys.indexOf(stateKey) < 0) return;
      try{
        var newVal = e.newValue ? JSON.parse(e.newValue) : null;
        
        if(!Array.isArray(newVal)) return;
        if(ERP._internal && ERP._internal.setState){
          var currentArr = (ERP._internal.getState && ERP._internal.getState().data[stateKey]) || [];
          if(currentArr.length > 0 && currentArr.length - newVal.length > 10){
            
            return;
          }
          ERP._internal.setState(function(s){ s.data[stateKey] = newVal; }, 'storage:crossTab:' + stateKey);

          
          if(_crossTabRenderTimers[stateKey]) clearTimeout(_crossTabRenderTimers[stateKey]);
          _crossTabRenderTimers[stateKey] = setTimeout(function(){
            delete _crossTabRenderTimers[stateKey];
            var ui = ERP._salesUI;
            var renderMap = {
              sales:            function(){ if(ui && ui.sales && document.getElementById('pv-sales'))            ui.sales.render(); },
              estimates:        function(){ if(ui && ui.est   && document.getElementById('pv-estimates'))        ui.est.render(); },
              saleOrders:       function(){ if(ui && ui.so    && document.getElementById('pv-saleorders'))       ui.so.render(); },
              payIn:            function(){ if(ui && ui.payin && document.getElementById('pv-payin'))            ui.payin.render(); },
              saleReturns:      function(){ if(ui && ui.ret   && document.getElementById('pv-salereturns'))      ui.ret.render(); },
              deliveryChallans: function(){ if(ui && ui.dc    && document.getElementById('pv-deliverychallan'))  ui.dc.render(); },
              customers:        function(){ if(ERP.sales && typeof ERP.sales._refreshCustList === 'function') ERP.sales._refreshCustList(); },
              inventory:        function(){ if(typeof ERP._salesRefreshItemDL === 'function') ERP._salesRefreshItemDL(); }
            };
            if(renderMap[stateKey]) renderMap[stateKey]();
          }, 250);
        }
      }catch(err){ if(window.DEBUG_MODE) console.error(err); }
    });
  }

  ERP._salesStorage = StorageAdapter;

})(window.ERP = window.ERP || {});
