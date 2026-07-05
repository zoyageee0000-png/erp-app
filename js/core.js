'use strict';

window.DEBUG_MODE = false;

var ERP = window.ERP || {};

(function (ERP) {
  'use strict';

  var DateUtils = {
    today: function () {
      var d = new Date();
      return d.getFullYear() + '-'
        + String(d.getMonth() + 1).padStart(2, '0') + '-'
        + String(d.getDate()).padStart(2, '0');
    },
    now: function () { return new Date().toISOString(); },
    isValid: function (str) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
      var d = new Date(str);
      if (isNaN(d.getTime())) return false;
      var parts = str.split('-');
      var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), day = parseInt(parts[2], 10);
      return d.getUTCFullYear() === y && (d.getUTCMonth() + 1) === m && d.getUTCDate() === day;
    }
  };

  var _uidLastMs = 0, _uidSeq = 0;
  function uid() {
    var now = Date.now();
    if (now === _uidLastMs) { _uidSeq++; } else { _uidLastMs = now; _uidSeq = 0; }
    return 'UID-'
      + now.toString(36).toUpperCase()
      + '-'
      + _uidSeq.toString(36).toUpperCase()
      + '-'
      + Math.random().toString(36).slice(2, 7).toUpperCase();
  }


  function ValidationError(msg)       { Error.call(this, msg); this.name = 'ValidationError';       this.message = msg; if (Error.captureStackTrace) Error.captureStackTrace(this, ValidationError); }
  function ConcurrencyError(msg)      { Error.call(this, msg); this.name = 'ConcurrencyError';      this.message = msg; if (Error.captureStackTrace) Error.captureStackTrace(this, ConcurrencyError); }
  function DuplicatePostingError(msg) { Error.call(this, msg); this.name = 'DuplicatePostingError'; this.message = msg; if (Error.captureStackTrace) Error.captureStackTrace(this, DuplicatePostingError); }
  function InsufficientStockError(msg){ Error.call(this, msg); this.name = 'InsufficientStockError';this.message = msg; if (Error.captureStackTrace) Error.captureStackTrace(this, InsufficientStockError); }
  function PermissionError(msg)       { Error.call(this, msg); this.name = 'PermissionError';       this.message = msg; if (Error.captureStackTrace) Error.captureStackTrace(this, PermissionError); }
  function MigrationError(msg)        { Error.call(this, msg); this.name = 'MigrationError';        this.message = msg; if (Error.captureStackTrace) Error.captureStackTrace(this, MigrationError); }
  function WALRecoveryError(msg)      { Error.call(this, msg); this.name = 'WALRecoveryError';      this.message = msg; if (Error.captureStackTrace) Error.captureStackTrace(this, WALRecoveryError); }
  function IntegrityCheckError(msg)   { Error.call(this, msg); this.name = 'IntegrityCheckError';   this.message = msg; if (Error.captureStackTrace) Error.captureStackTrace(this, IntegrityCheckError); }
  // Added to absorb purchase_state.js's previously-independent error family
  // (was a local `class ... extends Error` hierarchy, now single-sourced here).
  function ERPError(msg)              { Error.call(this, msg); this.name = 'ERPError';              this.message = msg; if (Error.captureStackTrace) Error.captureStackTrace(this, ERPError); }
  function ConflictError(msg)         { Error.call(this, msg); this.name = 'ConflictError';         this.message = msg; if (Error.captureStackTrace) Error.captureStackTrace(this, ConflictError); }
  function NotFoundError(msg)         { Error.call(this, msg); this.name = 'NotFoundError';         this.message = msg; if (Error.captureStackTrace) Error.captureStackTrace(this, NotFoundError); }
  function StorageError(msg)          { Error.call(this, msg); this.name = 'StorageError';          this.message = msg; if (Error.captureStackTrace) Error.captureStackTrace(this, StorageError); }

  // Canonical error-enrichment helper — single source of truth for attaching
  // module/operation/documentId/txId/timestamp metadata onto ERP.errors.* instances.
  // posting_engine.js and sales_service.js previously had their own copies
  // (_err / _mkError) that could silently drift apart; they now delegate here.
  function mkError(Ctor, message, module, operation, documentId, txId) {
    var e = new Ctor(message);
    e.module     = module;
    e.operation  = operation;
    e.documentId = documentId || null;
    e.txId       = txId       || null;
    e.timestamp  = (DateUtils && typeof DateUtils.now === 'function') ? DateUtils.now() : new Date().toISOString();
    return e;
  }

  ValidationError.prototype       = Object.create(Error.prototype);
  ConcurrencyError.prototype      = Object.create(Error.prototype);
  DuplicatePostingError.prototype = Object.create(Error.prototype);
  InsufficientStockError.prototype= Object.create(Error.prototype);
  PermissionError.prototype       = Object.create(Error.prototype);
  MigrationError.prototype        = Object.create(Error.prototype);
  WALRecoveryError.prototype      = Object.create(Error.prototype);
  IntegrityCheckError.prototype   = Object.create(Error.prototype);
  ERPError.prototype              = Object.create(Error.prototype);
  ConflictError.prototype         = Object.create(Error.prototype);
  NotFoundError.prototype         = Object.create(Error.prototype);
  StorageError.prototype          = Object.create(Error.prototype);

  function _errCtx(err, ctx) {
    return Object.assign(err, {
      module:     ctx.module     || 'unknown',
      operation:  ctx.operation  || 'unknown',
      documentId: ctx.documentId || null,
      txId:       ctx.txId       || null,
      timestamp:  DateUtils.now()
    });
  }

  function requireTx(tx, callerModule, callerOp) {
    if (!tx || typeof tx !== 'object' || !tx.txId || !tx.actor) {
      throw _errCtx(new ValidationError('Transaction context (tx) required'), {
        module:    callerModule,
        operation: callerOp,
        txId:      null,
        documentId: null
      });
    }
  }

  function requireAdmin(tx, operation) {
    if (!tx || typeof tx !== 'object') {
      throw _errCtx(new ValidationError('Transaction context (tx) required'), {
        module:    'PermissionGuard',
        operation: operation,
        txId:      null,
        documentId: null
      });
    }
    if (!ERP.Auth || !ERP.Auth.isAdmin(tx.actor)) {
      throw _errCtx(new PermissionError('Admin role required for: ' + operation), {
        module:    'PermissionGuard',
        operation:  operation,
        documentId: tx.documentId || null,
        txId:       tx.txId
      });
    }
  }

  var _raw = {
    biz: { name: 'MH Autos', phone: '', address: '', gst: '', logo: null, currency: 'Rs.' },
    data: {
      sales: [], purchases: [], inventory: [], customers: [], suppliers: [],
      jobs: [], expenses: [], vehicles: [], appointments: [], bankTransactions: [],
      cheques: [], mechanics: [], stockMovements: [], stockBatches: [], images: [],
      users: [], templates: [], coa: [], batches: [], loans: [],
      estimates: [], saleOrders: [], saleReturns: [], deliveryChallans: [],
      purchaseOrders: [], purchaseReturns: [], payIn: [], payOut: [],
      customerLedger: [], paymentAllocations: [], customerPayOut: [],
      gstReturns: [], paymentIns: [], stockJournal: [],
      partReservations: {}
    },
    session: { loggedIn: false, user: null },
    settings: {
      allowNegativeStock: false, lowStockAlert: 5, autoBackup: true,
      backupInterval: 30, taxRate: 17, invoicePrefix: 'INV', jobPrefix: 'JOB'
    },
    ui: { page: 'dashboard', dark: false, loading: false },
    notifications: [],
    meta: {
      schemaVersion:          1,
      migrationVersion:       0,
      projectionVersion:      0,
      inventoryEngineVersion: 0,
      postingEngineVersion:   0,
      salesEngineVersion:     0,
      purchaseEngineVersion:  0,
      lastWalCleanup:         null,
      lastBackgroundReconcile: null
    }
  };

  var _undo = [], _redo = [], MAX_UNDO = 10;

  function _snapState() {
    return {
      data:          _clone(_raw.data),
      biz:           _clone(_raw.biz),
      session:       _clone(_raw.session),
      settings:      _clone(_raw.settings),
      ui:            _clone(_raw.ui),
      notifications: Array.isArray(_raw.notifications) ? _raw.notifications.slice() : [],
      meta:          _clone(_raw.meta)
    };
  }

  function _applySnap(snap) {
    _raw.data          = snap.data;
    _raw.biz           = snap.biz;
    _raw.session       = snap.session;
    _raw.settings      = snap.settings;
    _raw.ui            = snap.ui;
    _raw.notifications = snap.notifications;
    _raw.meta          = snap.meta || _raw.meta;
    // Migrate older saved businesses still using the ₨ symbol so currency
    // display stays consistent with the standardized "Rs." text format.
    if (_raw.biz && _raw.biz.currency === '₨') { _raw.biz.currency = 'Rs.'; }
  }

  var _renderReg = {};

  function registerRenderer(page, fn) {
    _renderReg[page] = fn;
  }

  function _clone(obj) {
    if (typeof structuredClone === 'function') {
      try { return structuredClone(obj); } catch (_) {}
    }
    try { return JSON.parse(JSON.stringify(obj)); }
    catch (e) {
      if (window.DEBUG_MODE) console.error('[_clone] JSON serialization failed:', e);
      throw new Error('Unable to clone object: ' + (e && e.message));
    }
  }

  function _deepFreeze(obj, _seen) {
    if (!obj || typeof obj !== 'object') return obj;
    _seen = _seen || new WeakSet();
    if (_seen.has(obj)) return obj;
    _seen.add(obj);
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (v && typeof v === 'object' && !Object.isFrozen(v)) _deepFreeze(v, _seen);
    });
    return Object.freeze(obj);
  }

  var _DATA_STORES = [
    'sales', 'purchases', 'inventory', 'customers', 'suppliers',
    'jobs', 'expenses', 'vehicles', 'appointments', 'bankTransactions',
    'cheques', 'mechanics', 'stockMovements', 'stockBatches', 'images',
    'users', 'templates', 'coa',
    'batches', 'loans',
    'estimates', 'saleOrders', 'saleReturns', 'deliveryChallans',
    'purchaseOrders', 'purchaseReturns', 'payIn', 'payOut',
    'customerLedger', 'paymentAllocations', 'customerPayOut',
    'gstReturns', 'paymentIns', 'stockJournal'
  ];

  var _REQUIRED_ARRAYS = _DATA_STORES.slice();

  function _enforceSchema(d) {
    for (var i = 0; i < _REQUIRED_ARRAYS.length; i++) {
      var k = _REQUIRED_ARRAYS[i];
      if (!Array.isArray(d[k])) {
        if (window.DEBUG_MODE) console.warn('[schema] ' + k + ' was not an array — reset to []');
        d[k] = [];
      } else {
        d[k] = d[k].filter(function (item) {
          var ok = _validateRecord(item, k);
          if (!ok && window.DEBUG_MODE) console.warn('[schema] ' + k + ': dropped invalid record', item);
          return ok;
        });
      }
    }
    return d;
  }

  function _normalizeData(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) { d = {}; }
    for (var i = 0; i < _DATA_STORES.length; i++) {
      var k = _DATA_STORES[i];
      if (!Array.isArray(d[k])) d[k] = [];
    }
    return _enforceSchema(d);
  }

  function _normalizeObj(val, fallback) {
    return (val && typeof val === 'object' && !Array.isArray(val)) ? val : _clone(fallback);
  }

  function _normalizeMeta(m) {
    var base = _raw.meta;
    if (!m || typeof m !== 'object') return _clone(base);
    return {
      schemaVersion:          typeof m.schemaVersion === 'number'          ? m.schemaVersion          : base.schemaVersion,
      migrationVersion:       typeof m.migrationVersion === 'number'       ? m.migrationVersion       : base.migrationVersion,
      projectionVersion:      typeof m.projectionVersion === 'number'      ? m.projectionVersion      : base.projectionVersion,
      inventoryEngineVersion: typeof m.inventoryEngineVersion === 'number' ? m.inventoryEngineVersion : base.inventoryEngineVersion,
      postingEngineVersion:   typeof m.postingEngineVersion === 'number'   ? m.postingEngineVersion   : base.postingEngineVersion,
      salesEngineVersion:     typeof m.salesEngineVersion === 'number'     ? m.salesEngineVersion     : base.salesEngineVersion,
      purchaseEngineVersion:  typeof m.purchaseEngineVersion === 'number'  ? m.purchaseEngineVersion  : base.purchaseEngineVersion,
      lastWalCleanup:         m.lastWalCleanup != null ? m.lastWalCleanup : null,
      lastBackgroundReconcile: m.lastBackgroundReconcile != null ? m.lastBackgroundReconcile : null
    };
  }

  function _validateRecord(record, store) {
    if (record === null || record === undefined || typeof record !== 'object' || Array.isArray(record)) {
      if (window.DEBUG_MODE) console.error('[validateRecord] ' + store + ': rejected invalid record', record);
      if (typeof ERP !== 'undefined' && ERP.ui && ERP.ui.toast)
        ERP.ui.toast('⚠️ Data error in ' + store + ' — record rejected', 'error');
      return false;
    }
    return true;
  }

  var _stateRev = 0;

  var _renderQueued = {};
  var _renderDirty  = {};

  function _scheduleRender(mod) {
    if (!mod) {
      mod = _raw.ui && _raw.ui.page;
      if (mod && window.DEBUG_MODE) console.warn('[scheduleRender] moduleName missing — falling back to current page:', mod);
    }
    if (!mod) return;
    var baseMod = mod.indexOf(':') !== -1 ? mod.split(':')[0] : mod;
    var lookupMod = _renderReg[mod] ? mod : baseMod;
    if (_renderQueued[lookupMod]) {
      _renderDirty[lookupMod] = true;
      return;
    }
    _renderQueued[lookupMod] = true;
    _renderDirty[lookupMod] = false;
    function _runPass() {
      requestAnimationFrame(function () {
        try {
          var fn = _renderReg[lookupMod];
          if (typeof fn === 'function') {
            try { fn(); } catch (e) {
              if (window.DEBUG_MODE) console.error('[render]', lookupMod, e);
              else console.warn('[render]', lookupMod, e && e.message || e);
            }
          }
        } finally {
          if (_renderDirty[lookupMod]) {
            _renderDirty[lookupMod] = false;
            _runPass();
          } else {
            _renderQueued[lookupMod] = false;
          }
        }
      });
    }
    _runPass();
  }

  function getState() {
    return _deepFreeze(_clone(_raw));
  }

  function setState(updaterFn, moduleName) {
    var _preSnap = _snapState();
    try {
      var draft = _clone(_raw);
      updaterFn(draft);
      _raw.data          = _normalizeData(_clone(draft.data));
      _raw.biz           = _normalizeObj(_clone(draft.biz), _raw.biz);
      _raw.session       = _normalizeObj(_clone(draft.session), _raw.session);
      _raw.settings      = _normalizeObj(_clone(draft.settings), _raw.settings);
      _raw.ui            = _normalizeObj(_clone(draft.ui), _raw.ui);
      _raw.notifications = Array.isArray(draft.notifications)
        ? _clone(draft.notifications)
        : _clone(_raw.notifications);
      _raw.meta = _normalizeMeta(_clone(draft.meta));
    } catch (e) {
      if (window.DEBUG_MODE) console.error('[setState] rolled back:', e);
      if (typeof ERP !== 'undefined' && ERP.ui && ERP.ui.toast)
        ERP.ui.toast('State error — rolled back', 'error');
      return false;
    }
    // Only commit undo/redo history and bump the revision counter once the
    // mutation has actually succeeded — a failed updaterFn never touched
    // _raw at all, so there is nothing to roll back and nothing that should
    // consume the user's redo history or invalidate cached derived state.
    _stateRev++;
    _undo.push(_preSnap);
    if (_undo.length > MAX_UNDO) _undo.shift();
    _redo = [];
    if (moduleName) _scheduleRender(moduleName);
    return true;
  }

  function undoState() {
    if (!_undo.length) return;
    _redo.push(_snapState());
    var snap = _undo.pop();
    _applySnap(snap);
    events.emit(EVENT_NAMES.STATE_UNDO);
  }

  function redoState() {
    if (!_redo.length) return;
    _undo.push(_snapState());
    var snap = _redo.pop();
    _applySnap(snap);
    events.emit(EVENT_NAMES.STATE_REDO);
  }

  var EVENT_NAMES = Object.freeze({
    STATE_UNDO:  'state:undo',
    STATE_REDO:  'state:redo',
    RENDER:      '[render]',
    EMIT:        '[emit]',
    SCHEDULE:    '[scheduleRender]',
    SET_STATE:   '[setState]'
  });

  var _evts = {};

  var events = {
    on: function (evt, fn) {
      if (!_evts[evt]) _evts[evt] = [];
      _evts[evt].push(fn);
    },
    off: function (evt, fn) {
      if (!_evts[evt]) return;
      _evts[evt] = _evts[evt].filter(function (f) { return f !== fn; });
    },
    emit: function (evt, data) {
      (_evts[evt] || []).forEach(function (fn) {
        try { fn(data); } catch (e) {
          if (window.DEBUG_MODE) console.error('[emit]', evt, e);
          else console.warn('[emit]', evt, e && e.message || e);
        }
      });
    },
    once: function (evt, fn) {
      var self = this;
      function _wrapper(data) {
        self.off(evt, _wrapper);
        try { fn(data); } catch (e) {
          if (window.DEBUG_MODE) console.error('[once]', evt, e);
          else console.warn('[once]', evt, e && e.message || e);
        }
      }
      self.on(evt, _wrapper);
    }
  };

  function escapeHtml(str) {
    return String(str != null ? str : '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Single source of truth for money parsing is ACC.Money (accounting_constants.js).
  // These wrappers delegate to it so ERP.toPaisa/ERP.fromPaisa never diverge from
  // the accounting-notation-aware parser used everywhere else. The inline fallback
  // only applies if this is somehow called before accounting_constants.js loads.
  function toPaisa(rupees) {
    var M = window.AccountingCore && window.AccountingCore.Money;
    if (M && typeof M.toPaisa === 'function') return M.toPaisa(rupees);
    var v = parseFloat(String(rupees || '').replace(/,/g, ''));
    return (isNaN(v) || !isFinite(v)) ? 0 : Math.round(v * 100);
  }
  function fromPaisa(paisa) {
    var M = window.AccountingCore && window.AccountingCore.Money;
    if (M && typeof M.fromPaisa === 'function') return M.fromPaisa(paisa);
    var n = Number(paisa);
    return (isNaN(n) || !isFinite(n)) ? 0 : Math.round(n) / 100;
  }
  function roundMoney(n) { return fromPaisa(toPaisa(n)); }

  function fmt(n) {
    var c = (_raw.biz && _raw.biz.currency) || 'Rs.';
    var v = parseFloat(String(n || '').replace(/,/g, ''));
    if (isNaN(v) || !isFinite(v)) v = 0;
    return c + v.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function safeRun(fn, mod) {
    try { fn(); }
    catch (e) {
      if (window.DEBUG_MODE) console.error('[safeRun] Error in ' + (mod || '?') + ':', e);
      if (typeof ERP !== 'undefined' && ERP.ui && ERP.ui.toast)
        ERP.ui.toast('Error in ' + (mod || 'module'), 'error');
    }
  }

  var _genIdLastMs = 0, _genIdSeq = 0;
  var _utils = {
    escapeHtml: function (str) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    },
    fmt: function (n) {
      var _s = getState();
      var c = (_s && _s.biz && _s.biz.currency) || 'Rs.';
      var v = parseFloat(n); if (isNaN(v) || !isFinite(v)) v = 0;
      return c + v.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
    safeRun: function (fn, moduleName) {
      try { fn(); } catch (e) {
        if (window.DEBUG_MODE) console.error('[safeRun] Error in ' + (moduleName || '?') + ':', e);
        if (typeof ERP !== 'undefined' && ERP.ui && ERP.ui.toast)
          ERP.ui.toast('Error in ' + (moduleName || 'module'), 'error');
      }
    },
    debounce: function (fn, ms) {
      var timer = null;
      return function () {
        var args = arguments;
        var ctx  = this;
        clearTimeout(timer);
        timer = setTimeout(function () { fn.apply(ctx, args); }, ms || 220);
      };
    },
    genId: function (prefix) {
      var now = Date.now();
      if (now === _genIdLastMs) { _genIdSeq++; } else { _genIdLastMs = now; _genIdSeq = 0; }
      return (prefix || 'ID') + '-'
        + now.toString(36).toUpperCase()
        + _genIdSeq.toString(36).toUpperCase()
        + Math.random().toString(36).slice(2, 7).toUpperCase();
    }
  };

  var STATUS = {
    'pending':       { l: 'Pending',        cls: 'b-blue' },
    'in-progress':   { l: 'In Progress',    cls: 'b-orange' },
    'waiting-parts': { l: 'Awaiting Parts', cls: 'b-purple' },
    'completed':     { l: 'Completed',      cls: 'b-green' },
    'delivered':     { l: 'Delivered',      cls: 'b-gray' },
    'cancelled':     { l: 'Cancelled',      cls: 'b-red' }
  };


  var RBAC = {
    Admin:      { pages: ['*'], actions: { addJob: 1, updateJob: 1, addSale: 1, addCustomer: 1, addExpense: 1, deleteSale: 1, deleteJob: 1, deleteCustomer: 1, voidPayment: 1, issueCreditReturn: 1, deleteVehicle: 1, deleteAppointment: 1 } },
    Manager:    { pages: ['dashboard','sales','purchase','inventory','customers','supplier','parties','repair','vehicle','appointment','expenses','bank','reports','estimates','saleorders','salereturns','payin','salespayout','payout','deliverychallan','purchaseorders','purchasereturn','loans','coa','gst','batchtrack','accounts'],
                  actions: { addJob: 1, updateJob: 1, addSale: 1, addCustomer: 1, addExpense: 1 } },
    Accountant: { pages: ['dashboard','sales','purchase','expenses','bank','reports','payin','salespayout','payout','loans','coa','gst','accounts'],
                  actions: { addSale: 1, addExpense: 1 } },
    Sales:      { pages: ['dashboard','sales','customers','parties','estimates','saleorders','payin','salespayout','salereturns','deliverychallan','inventory'],
                  actions: { addSale: 1, addCustomer: 1 } },
    Workshop:   { pages: ['dashboard','repair','vehicle','appointment','inventory'],
                  actions: { addJob: 1, updateJob: 1 } },
    Staff:      { pages: ['dashboard','sales','inventory','repair','customers'],
                  actions: { addJob: 1, updateJob: 1, addSale: 1, addCustomer: 1 } },
    Viewer:     { pages: ['dashboard'], actions: {} }
  };

  var _ROLE_PERMS = (function () {
    var out = {};
    Object.keys(RBAC).forEach(function (r) { out[r] = RBAC[r].actions || {}; });
    return out;
  })();

  var Auth = {
    isAdmin: function (actor) {
      var s = _raw.session;
      if (!s || !s.user) return false;
      if (s.user.username === actor && s.user.role === 'Admin') return true;
      return false;
    },
    // Canonical replacement for the 4 byte-for-byte duplicated
    // "_currentUser()" helpers found in erp.backup.engine.js, erp.feature.flags.js,
    // erp.period.lock.js, and erp.user.lifecycle.js.
    currentUser: function () {
      var s = _raw.session;
      return (s && s.user) ? s.user : null;
    },
    // Canonical replacement for the 4 byte-for-byte duplicated
    // "_isAdmin()" helpers in the same 4 files (role-string check on the
    // currently logged-in user, as opposed to isAdmin(actor) above which
    // verifies a specific named actor is the current admin session).
    isAdminRole: function () {
      var u = Auth.currentUser();
      var role = u && u.role;
      return typeof role === 'string' && role.toLowerCase() === 'admin';
    }
  };

  var _state = {
    get: function () {
      var s = getState();
      return (s && typeof s === 'object') ? s : {};
    },
    set: function (updaterFn, module) { setState(updaterFn, module); },
    undo: function () { undoState(); },
    redo: function () { redoState(); },
    STATUS: STATUS,
    selectors: {
      inventory:      function () { return (_state.get().data || {}).inventory      || []; },
      sales:          function () { return (_state.get().data || {}).sales          || []; },
      customers:      function () { return (_state.get().data || {}).customers      || []; },
      jobs:           function () { return (_state.get().data || {}).jobs           || []; },
      expenses:       function () { return (_state.get().data || {}).expenses       || []; },
      stockBatches:   function () { return (_state.get().data || {}).stockBatches   || []; },
      stockMovements: function () { return (_state.get().data || {}).stockMovements || []; },
      settings:       function () { return (_state.get() || {}).settings            || {}; },
      meta:           function () { return (_state.get() || {}).meta                || {}; }
    },
    derive: (function () {
      var _cache = null;
      return function () {
        var s        = _state.get();
        var data     = s.data     || {};
        var settings = s.settings || {};

        var sales = data.sales     || [];
        var jobs  = data.jobs      || [];
        var inv   = data.inventory || [];
        var custs = data.customers || [];
        var exps  = data.expenses  || [];
        var purs  = data.purchases || [];

        var today  = DateUtils.today();
        var curMo  = today.slice(0, 7);
        var _todayYear  = parseInt(today.slice(0, 4), 10);
        var _todayMonth = parseInt(today.slice(5, 7), 10);
        var _lmYear  = _todayMonth === 1 ? _todayYear - 1 : _todayYear;
        var _lmMonth = _todayMonth === 1 ? 12 : _todayMonth - 1;
        var lastMo = _lmYear + '-' + String(_lmMonth).padStart(2, '0');

        var todayKey = today;
        var contentHash = 0;
        for (var ci = 0; ci < Math.min(sales.length, 50); ci++) {
          var s = sales[ci];
          if (s && s.id) contentHash = (contentHash * 31 + s.id.charCodeAt(0)) | 0;
        }
        var fp = _stateRev + '|' + todayKey + '|' + sales.length + '|' + jobs.length + '|' + inv.length + '|' + contentHash;
        if (_cache && _cache.fp === fp) return _cache.val;

        var lowThreshold = settings.lowStockAlert || 5;

        var totalPaid = 0, totalOwed = 0, todaySales = 0, curMoSales = 0, lastMoSales = 0;
        for (var i = 0; i < sales.length; i++) {
          var sl  = sales[i];
          var amt = (typeof sl.grand === 'number' && !isNaN(sl.grand))
            ? sl.grand
            : (sl.items || []).reduce(function (a, it) { return a + (it.q || 1) * (it.p || 0) - (it.d || 0); }, 0);
          var sd = String(sl.date || '');
          var isPaid = sl.status === 'paid' || sl.status === 'partial';
          var isOwed = sl.status === 'credit' || sl.status === 'unpaid' || sl.status === 'partial';
          if (isPaid) {
            if (sd === today)             todaySales  += amt;
            if (sd.indexOf(curMo)  === 0) { totalPaid  += amt; curMoSales += amt; }
            if (sd.indexOf(lastMo) === 0)   lastMoSales += amt;
          }
          if (isOwed) {
            var owed = sl.status === 'partial'
              ? Math.max(0, amt - (sl.paid || 0))
              : amt;
            totalOwed += owed;
          }
        }

        var activeJobs = 0, pendingJobs = 0;
        for (var j = 0; j < jobs.length; j++) {
          var jst = jobs[j] && jobs[j].status;
          if (jst === 'pending' || jst === 'in-progress' || jst === 'waiting-parts') {
            activeJobs++;
            if (jst === 'pending') pendingJobs++;
          }
        }

        var invValue = 0, lowStockItems = [], outOfStockItems = [];
        var _valFull = (window.ERP && ERP.InventoryService && typeof ERP.InventoryService.getValuationFull === 'function')
          ? ERP.InventoryService.getValuationFull()
          : null;
        invValue = _valFull ? _valFull.totalPaisa : 0;
        for (var k = 0; k < inv.length; k++) {
          var p = inv[k];
          if (!_valFull) invValue += (p.st || 0) * (p.pp || 0);
          if ((p.st || 0) === 0)              outOfStockItems.push(p);
          else if ((p.st || 0) <= lowThreshold) lowStockItems.push(p);
        }

        var expMap = {};
        for (var e = 0; e < exps.length; e++) {
          var cat = exps[e].cat || 'Other';
          expMap[cat] = (expMap[cat] || 0) + (exps[e].amt || 0);
        }
        var totalPurchases = purs.reduce(function (a, pu) { return a + (pu.amt || 0); }, 0);
        if (totalPurchases > 0) expMap['Purchases'] = (expMap['Purchases'] || 0) + totalPurchases;

        var growth = lastMoSales > 0
          ? Number(((curMoSales - lastMoSales) / lastMoSales * 100).toFixed(0))
          : 0;

        var val = {
          totalPaid: totalPaid, totalOwed: totalOwed,
          todaySales: todaySales, curMoSales: curMoSales, lastMoSales: lastMoSales,
          salesGrowthPct: growth,
          activeJobs: activeJobs, pendingJobs: pendingJobs,
          inventoryValue: invValue,
          lowStockItems: lowStockItems, outOfStockItems: outOfStockItems,
          lowStockCount: lowStockItems.length + outOfStockItems.length,
          itemCount: inv.length,
          customerCount: custs.length,
          expenseByCategory: expMap,
          activeJobList: jobs.filter(function (jj) {
            return jj && (jj.status === 'pending' || jj.status === 'in-progress' || jj.status === 'waiting-parts');
          }).slice(0, 10)
        };

        _cache = { fp: fp, val: val };
        return val;
      };
    })()
  };

  function _invAmt(sale) {
    // FIX: same root-cause as dashboard.js's copy of this function -- prefer the
    // canonical, already paisa-rounded per-item taxAmt (from TaxEngine.calculateLineItem)
    // over recomputing tax from a raw float. This copy has no current caller (verified:
    // only dashboard.js's independent copy is actually used), but it's exported as
    // ERP._invAmt, so a future caller should get the correct number, not a latent bug.
    if (!sale || typeof sale !== 'object') return 0;
    var _liveSettings = (_raw.settings && typeof _raw.settings.taxRate === 'number') ? _raw.settings : null;
    var settingsTax = (_liveSettings && typeof _liveSettings.taxRate === 'number') ? _liveSettings.taxRate : 17;
    return (sale.items || []).reduce(function (a, i) {
      var lineBase = (i.q || 1) * (i.p || 0) - (i.d || 0);
      var taxAmt;
      if (typeof i.taxAmt === 'number' && !isNaN(i.taxAmt)) {
        taxAmt = i.taxAmt;
      } else {
        var taxPct = typeof i.tax === 'number' ? i.tax
                   : typeof sale.tax === 'number' ? sale.tax
                   : settingsTax;
        taxAmt = taxPct > 0 ? lineBase * taxPct / 100 : 0;
      }
      return a + lineBase + taxAmt;
    }, 0);
  }


  ERP._internal = {
    getRaw:           function ()       { return _raw; },
    getStoreNames:    function ()       { return _DATA_STORES; },
    getRenderReg:     function ()       { return _renderReg; },
    getStateRev:      function ()       { return _stateRev; },
    getState:         function ()       { return getState(); },
    setState:         function (fn, tag){ return setState(fn, tag); },
    safeRun:          function (fn, tag){ return safeRun(fn, tag); },
    escapeHtml:       function (s)      { return escapeHtml(s); },
    fmt:              function (n)      { return fmt(n); },
    registerRenderer: function (p, fn)  { return registerRenderer(p, fn); }
  };

  ERP.version          = '4.1.0';

  ERP.getState         = getState;
  ERP.setState         = setState;
  ERP.undoState        = undoState;
  ERP.redoState        = redoState;
  ERP.registerRenderer = registerRenderer;
  ERP.escapeHtml       = escapeHtml;
  ERP.fmt              = fmt;
  ERP.safeRun          = safeRun;
  ERP.toPaisa          = toPaisa;
  ERP.fromPaisa        = fromPaisa;
  ERP.roundMoney = function(n) {
    console.warn('[ERP] ERP.roundMoney deprecated — use ERP.toPaisa / ERP.fromPaisa');
    return roundMoney(n);
  };
  ERP._invAmt          = _invAmt;
  ERP.uid              = uid;

  ERP.DateUtils        = DateUtils;

  ERP.errors = Object.freeze({
    ValidationError:       ValidationError,
    ConcurrencyError:      ConcurrencyError,
    DuplicatePostingError: DuplicatePostingError,
    InsufficientStockError: InsufficientStockError,
    PermissionError:       PermissionError,
    MigrationError:        MigrationError,
    WALRecoveryError:      WALRecoveryError,
    IntegrityCheckError:   IntegrityCheckError,
    ERPError:              ERPError,
    ConflictError:         ConflictError,
    NotFoundError:         NotFoundError,
    StorageError:          StorageError
  });

  ERP.mkError    = mkError;
  ERP.errCtx     = _errCtx;
  ERP.requireTx  = requireTx;
  ERP.requireAdmin = requireAdmin;

  ERP.Auth       = Auth;

  ERP.state      = _state;
  ERP.utils      = _utils;
  ERP.STATUS     = STATUS;
  ERP.RBAC       = RBAC;
  ERP._ROLE_PERMS = _ROLE_PERMS;

  ERP._events_bus = {
    on:    function (evt, fn)   { events.on(evt, fn); },
    off:   function (evt, fn)   { events.off(evt, fn); },
    emit:  function (evt, data) { events.emit(evt, data); },
    NAMES: EVENT_NAMES
  };

  ERP.events = {
    NAMES: Object.freeze({
      INVENTORY_UPDATED: 'inventory:updated',
      STOCK_LOW:         'stock:low',
      STOCK_OUT:         'stock:out',
      BARCODE_SCANNED:   'barcode:scanned',
      SALE_ADDED:        'sales:added',
      SALE_UPDATED:      'sale:updated',
      JOB_ADDED:         'job:added',
      JOB_UPDATED:       'job:updated',
      STATE_UNDO:        'state:undo',
      STATE_REDO:        'state:redo',
      CUSTOMERS_UPDATED: 'customers:updated',
      SUPPLIERS_UPDATED: 'suppliers:updated',
      AUTH_LOGIN:        'auth:login',
      AUTH_LOGOUT:       'auth:logout',
      PAGE_CHANGED:      'page:changed',
      CAMERA_SNAP:       'camera:snap'
    }),
    on:   function (evt, fn)   { events.on(evt, fn); },
    off:  function (evt, fn)   { events.off(evt, fn); },
    emit: function (evt, data) { events.emit(evt, data); },
    once: function (evt, fn)   { events.once(evt, fn); },
    delegate: function (selector, eventType, handler, root) {
      var _root = root || document;
      function _listener(e) {
        var el = e.target;
        while (el && el !== _root) {
          if (el.matches && el.matches(selector)) { handler(e, el); return; }
          el = el.parentElement;
        }
      }
      _root.addEventListener(eventType, _listener);
      return function () { _root.removeEventListener(eventType, _listener); };
    }
  };

  ERP.ACTIONS = Object.freeze({
    INV_ADD:          'inv:add',
    INV_SAVE:         'inv:save',
    INV_SAVE_ANOTHER: 'inv:saveAnother',
    SALE_ADD:         'sale:add',
    REPAIR_ADD:       'repair:add',
    PURCHASE_ADD:     'purchase:add',
    EXPENSE_ADD:      'expense:add',
    BANK_ADD:         'bank:add',
    PARTY_ADD_CUST:   'party:addCustomer',
    PARTY_ADD_SUP:    'party:addSupplier',
    DB_BACKUP:        'db:backup',
    CAMERA_OPEN:      'camera:open',
    VOICE_TOGGLE:     'voice:toggle',
    NOTIFY_PANEL:     'notify:showPanel'
  });

  window.MH = ERP;

})(ERP);

window.ERP = ERP;

// --- Phase 1, Step 2 conversion (see MH_ERP migration plan) ---
// Purely additive: window.DEBUG_MODE / window.ERP / window.MH assignments
// above are UNCHANGED, so every not-yet-converted file that reads
// window.ERP.* keeps working exactly as before. This export exists only
// so that files converted AFTER this one can `import { ERP } from
// './core.js'` once bundled by esbuild, instead of reading window.ERP.
//
// PENDING CI VERIFICATION: this repo's sandbox environment has no network
// access to install esbuild, so `npm run verify` could not be run locally
// before this commit. The export was independently smoke-tested in native
// Node ESM (uid/fmt/RBAC/errors/getState/setState all confirmed working,
// and `ERP === window.ERP === window.MH` confirmed — one object, not a
// divergent copy) — see the PR description for the exact commands run.
// Do not merge to master or tag as complete until CI's `npm run verify`
// (which includes this file's dedicated regression test) is green.
export { ERP };
