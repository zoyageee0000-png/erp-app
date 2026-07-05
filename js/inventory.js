'use strict';
var ERP = window.ERP = window.ERP || {};

(function (ERP) {
  'use strict';

  function _getState()      { return ERP.getState(); }
  function _setState(fn, m) { return ERP.setState(fn, m); }
  function _escapeHtml(s)   { return ERP.escapeHtml(s); }
  function _stateRev()      { return ERP._internal.getStateRev(); }
  function _db()            { return ERP._db; }
  function _toast(m, t, d)  { if (ERP.ui) ERP.ui.toast(m, t, d); }
  function _safeRun(fn, tag){ return ERP.safeRun(fn, tag); }
  function _uid()           { return ERP.uid(); } // FIX (root cause, audit #61-62): core.js (ERP.uid) loads first of 92 scripts, before this file -- fallback bought nothing but a second, weaker ID scheme.
  function _now()           { return ERP.DateUtils ? ERP.DateUtils.now() : (function(){ var d=new Date(); var pad=function(n){return String(n).padStart(2,'0');}; return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds()); })(); }
  function _today()         { return ERP.DateUtils ? ERP.DateUtils.today() : (function(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })(); }
  function _logger()        { return ERP.Logger || { info: function(){}, warn: function(){}, error: function(){} }; }
  function _ledger()        { return (ERP && ERP.Ledger && ERP.Ledger.__phase2) ? ERP.Ledger : null; }
  function _money() {
    if (window.AccountingCore && window.AccountingCore.Money) return window.AccountingCore.Money;
    return {
      toPaisa:   function (r) { return Math.round((parseFloat(r) || 0) * 100); },
      toDisplay: function (p) {
        // FIX (root cause, audit #75): was a hardcoded 'Rs.' duplicate of ERP.fmt();
        // fallback kept only for a genuine load-order fluke.
        var rupees = (parseFloat(p) || 0) / 100;
        return (window.ERP && typeof window.ERP.fmt === 'function') ? window.ERP.fmt(rupees) : 'Rs.' + rupees.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      },
      add:       function (a, b) { return (a || 0) + (b || 0); },
      subtract:  function (a, b) { return (a || 0) - (b || 0); },
      sum:       function (arr) { return (arr || []).reduce(function (s, v) { return s + (v || 0); }, 0); }
    };
  }

  function _isAdmin(actor) { return actor === 'System' || !!(ERP.Auth && ERP.Auth.isAdmin(actor)); }

  // FIX (data-loss bug): stock mutations previously only reached disk via the
  // browser's 'beforeunload' event. If the tab crashed, the browser was
  // killed (common on mobile), or the event simply didn't fire, any stock
  // change from a purchase/sale/return/job-part was silently lost on next
  // load even though the underlying sale/purchase/job record was saved fine.
  // This helper schedules an explicit, debounced persist to localStorage/
  // IndexedDB right after every successful stock mutation, independent of
  // beforeunload.
  // ARCHITECTURAL REFACTOR (root-level persistence unification): single
  // choke point for all IndexedDB + localStorage writes across the app.
  function _persistInventory() {
    ERP.Persistence.schedule();
  }

  function _settings() {
    try {
      return (ERP.state && ERP.state.selectors && ERP.state.selectors.settings && ERP.state.selectors.settings()) || {};
    } catch (e) {
      _logger().warn('[Inventory] settings() unavailable, using empty defaults:', e && e.message || e);
      return {};
    }
  }

  function _num(v, def) {
    var n = parseFloat(v);
    return (isNaN(n) || !isFinite(n)) ? (def || 0) : n;
  }

  function _round2(v) { return Math.round((_num(v, 0) + Number.EPSILON) * 100) / 100; }

  var _warnDeprecatedOnce = (function() {
    var warned = Object.create(null);
    var count = 0;
    var MAX_TRACKED = 200;

    return function(oldName, newName) {
      if (!warned[oldName]) {
        if (count >= MAX_TRACKED) {

          _logger().warn('[DEPRECATED] ' + oldName + ' is deprecated. Use ' + newName + ' instead.');
          return;
        }
        warned[oldName] = true;
        count++;
        _logger().warn('[DEPRECATED] ' + oldName + ' is deprecated. Use ' + newName + ' instead.');
      }
    };
  })();

  function _requireTx(tx, module, operation) {
    if (!tx || !tx.txId || !tx.actor) {
      throw Object.assign(new ERP.ValidationError('Transaction context (tx) required'), {
        module: module, operation: operation, documentId: null, txId: null, timestamp: _now()
      });
    }
  }

  function _resolveActor(explicit) {
    if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
    var u = window.currentUser;
    if (u && typeof u === 'object') {
      if (typeof u.name === 'string' && u.name.trim()) return u.name.trim();
      if (typeof u.username === 'string' && u.username.trim()) return u.username.trim();
      if (u.id !== undefined && u.id !== null && u.id !== '') return 'User#' + u.id;
    }
    _logger().warn('[Inventory] actor identity could not be resolved from window.currentUser for this operation; recording as Unknown-actor instead of silently attributing it to "System".');
    return 'Unknown-actor';
  }

  var _KNOWN_SOURCE_MODULES = {
    'inventory': 1, 'purchase': 1, 'purchase_inventory': 1, 'purchase_delete': 1,
    'purchase_edit': 1, 'purchase_edit_rollback': 1, 'purchase_return': 1,
    'purchase_return_delete': 1, 'deductStock': 1, 'restoreStock': 1,
    'removeBatch': 1, 'boot:migration': 1, 'jobService': 1, 'admin_adjustment': 1,
    'manual': 1, 'system_integrity': 1,
    'sales': 1, 'sales_partial_return': 1, 'sales_return_delete': 1, 'sale_return_delete': 1
  };

  function _isKnownSourceModule(name) {
    return !!(name && typeof name === 'string' && _KNOWN_SOURCE_MODULES[name]);
  }

  function _registerSourceModule(name) {
    if (name && typeof name === 'string' && name.trim()) {
      _KNOWN_SOURCE_MODULES[name.trim()] = 1;
      return true;
    }
    return false;
  }

  // Single source: delegate to the canonical ERP.errors.* registry (core.js)
  // instead of defining local constructors. Previously these fallbacks always
  // fired (ERP.ValidationError etc. was never set at the top level — only
  // nested under ERP.errors.*), so inventory.js was silently throwing its own
  // separate error classes, distinct from the ones posting_engine.js/
  // sales_service.js use (same .name string, but not the same identity —
  // `instanceof ERP.errors.ValidationError` would fail for inventory errors).
  ERP.ValidationError        = ERP.ValidationError        || (ERP.errors && ERP.errors.ValidationError);
  ERP.InsufficientStockError = ERP.InsufficientStockError || (ERP.errors && ERP.errors.InsufficientStockError);
  ERP.ConcurrencyError       = ERP.ConcurrencyError       || (ERP.errors && ERP.errors.ConcurrencyError);
  ERP.PermissionError        = ERP.PermissionError        || (ERP.errors && ERP.errors.PermissionError);

  var InventoryValidator = {

    validateEntry: function (entry) {
      if (!entry || typeof entry !== 'object')
        throw Object.assign(new ERP.ValidationError('entry: object required'), {
          module: 'InventoryValidator', operation: 'validateEntry', documentId: null, txId: null, timestamp: _now()
        });
      if (!entry.barcode || typeof entry.barcode !== 'string' || !entry.barcode.trim() || entry.barcode.trim().length < 2)
        throw Object.assign(new ERP.ValidationError('entry.barcode: non-empty string required (min 2 characters, matching item barcode rules)'), {
          module: 'InventoryValidator', operation: 'validateEntry', documentId: null, txId: null, timestamp: _now()
        });
      if (typeof entry.qty !== 'number' || !isFinite(entry.qty) || entry.qty <= 0)
        throw Object.assign(new ERP.ValidationError('entry.qty: positive finite number required'), {
          module: 'InventoryValidator', operation: 'validateEntry', documentId: null, txId: null, timestamp: _now()
        });
      if (typeof entry.unitCostPaisa !== 'number' || !Number.isInteger(entry.unitCostPaisa) || entry.unitCostPaisa < 0)
        throw Object.assign(new ERP.ValidationError('entry.unitCostPaisa: non-negative integer required'), {
          module: 'InventoryValidator', operation: 'validateEntry', documentId: null, txId: null, timestamp: _now()
        });
    },

    validateItemData: function (data) {
      var settings = _settings();
      if (!data || typeof data !== 'object') return 'Invalid data object.';
      if (!data.n || typeof data.n !== 'string' || data.n.trim().length < 2)
        return 'Item name required (min 2 characters).';
      if (!data.bc || typeof data.bc !== 'string' || data.bc.trim().length < 2)
        return 'Barcode/code required (min 2 characters).';
      if (typeof data.sp !== 'number' || isNaN(data.sp) || data.sp <= 0)
        return 'Sale price must be greater than zero.';
      if (typeof data.pp !== 'number' || isNaN(data.pp) || data.pp < 0)
        return 'Purchase price must be a non-negative number.';
      if (typeof data.st !== 'number' || isNaN(data.st))
        return 'Stock quantity must be a number.';
      if (data.st < 0 && !settings.allowNegativeStock)
        return 'Stock cannot be negative (allowNegativeStock is off).';
      if (typeof data.minSt !== 'number' || isNaN(data.minSt) || data.minSt < 0)
        return 'Min stock must be a non-negative number.';

      if (data.tax !== undefined && data.tax !== null && (typeof data.tax !== 'number' || isNaN(data.tax) || data.tax < 0 || data.tax > 100))
        return 'Tax must be between 0 and 100.';

      if (data.mrp !== undefined && data.mrp !== null && (typeof data.mrp !== 'number' || isNaN(data.mrp) || data.mrp < 0))
        return 'MRP cannot be negative.';

      if (data.sku && String(data.sku).trim().length > 60)
        return 'SKU / Part No. too long (max 60 characters).';

      if (data.cat && data.cat.trim().length > 40)
        return 'Category name too long (max 40 characters).';
      return null;
    }
  };

  var StockJournalWriter = {

    write: function (journalEntry) {

      if (!journalEntry || typeof journalEntry.idempotencyKey !== 'string' || !journalEntry.idempotencyKey.trim())
        throw new Error('StockJournalWriter.write: idempotencyKey required (non-empty string)');

      var existing = StockJournalWriter._findByKey(journalEntry.idempotencyKey);
      if (existing) return existing;

      _setState(function (s) {
        s.data.stockJournal = s.data.stockJournal || [];
        s.data.stockJournal.push(journalEntry);
      }, 'stockJournal:write');

      return journalEntry;
    },

    _findByKey: function (key) {
      var s = _getState();
      var j = (s.data && s.data.stockJournal) ? s.data.stockJournal : [];
      for (var i = 0; i < j.length; i++) {
        if (j[i].idempotencyKey === key) return j[i];
      }
      return null;
    },

    getByBarcode: function (barcode) {

      if (!barcode) return [];
      var s = _getState();
      var j = (s.data && s.data.stockJournal) ? s.data.stockJournal : [];
      return j.filter(function (e) { return e.barcode === barcode; });
    },

    getByDocument: function (documentId) {

      if (!documentId) return [];
      var s = _getState();
      var j = (s.data && s.data.stockJournal) ? s.data.stockJournal : [];
      return j.filter(function (e) { return e.documentId === documentId; });
    }
  };

  var BalanceProjection = {

    getBalance: function (barcode) {
      if (!barcode) return 0;
      var s = _getState();
      var proj = (s.data && s.data.balanceProjection) ? s.data.balanceProjection : {};
      return _num(proj[barcode], 0);
    },

    update: function (barcode, delta, idempotencyKey) {

      if (typeof delta !== 'number' || !isFinite(delta) || isNaN(delta)) {
        _logger().error('BalanceProjection.update: delta must be a finite number, got:', delta);
        return false;
      }
      var applied = true;
      _setState(function (s) {
        if (idempotencyKey) {
          s.data.balanceProjectionAppliedKeys = s.data.balanceProjectionAppliedKeys || {};
          if (s.data.balanceProjectionAppliedKeys[idempotencyKey]) {
            applied = false;
            return;
          }
          s.data.balanceProjectionAppliedKeys[idempotencyKey] = true;
        }
        s.data.balanceProjection = s.data.balanceProjection || {};
        var current = _num(s.data.balanceProjection[barcode], 0);
        s.data.balanceProjection[barcode] = current + delta;
      }, 'balanceProjection:update');
      return applied;
    },

    rebuild: function (tx) {
      _requireTx(tx, 'BalanceProjection', 'rebuild');
      if (!_isAdmin(tx.actor))
        throw Object.assign(new ERP.PermissionError('Admin role required for: BalanceProjection.rebuild'), {
          module: 'BalanceProjection', operation: 'rebuild',
          documentId: tx.documentId, txId: tx.txId, timestamp: _now()
        });

      _setState(function (s) {
        s.data.stockJournal = s.data.stockJournal || [];
        var proj = {};

        var journal = s.data.stockJournal;
        var positionById = {};
        for (var pi = 0; pi < journal.length; pi++) {
          var pid = journal[pi] && journal[pi].id;
          if (pid !== undefined && pid !== null) positionById[pid] = pi;
        }

        var sorted = journal.slice().sort(function (a, b) {

          var ta = a.timestamp ? (Date.parse(a.timestamp) || 0) : 0;
          var tb = b.timestamp ? (Date.parse(b.timestamp) || 0) : 0;
          if (ta < tb) return -1;
          if (ta > tb) return 1;

          var pa = (a.id !== undefined && a.id !== null && positionById[a.id] !== undefined) ? positionById[a.id] : -1;
          var pb = (b.id !== undefined && b.id !== null && positionById[b.id] !== undefined) ? positionById[b.id] : -1;
          if (pa !== pb) return pa - pb;

          var ia = a.id || '';
          var ib = b.id || '';
          return ia < ib ? -1 : ia > ib ? 1 : 0;
        });

        for (var i = 0; i < sorted.length; i++) {
          var e = sorted[i];

          if (typeof e.movementQty !== 'number') {
            _logger().warn('BalanceProjection.rebuild: entry has invalid movementQty:', e);
            continue;
          }
          proj[e.barcode] = _num(proj[e.barcode], 0) + _num(e.movementQty, 0);
        }

        s.data.balanceProjection = proj;
        s.data.balanceProjectionAppliedKeys = {};
        s.meta = s.meta || {};
        s.meta.projectionVersion = _num(s.meta.projectionVersion, 0) + 1;
      }, 'balanceProjection:rebuild');

      ERP.AuditLog && ERP.AuditLog.write({
        id: _uid(), txId: tx.txId, actor: tx.actor,
        action: 'BalanceProjection.rebuild', module: 'BalanceProjection',
        documentId: tx.documentId || null, before: null, after: null,
        timestamp: _now(), severity: 'warning'
      });
    },

    checksum: function () {
      var s = _getState();
      var proj = (s.data && s.data.balanceProjection) ? s.data.balanceProjection : {};
      var keys = Object.keys(proj).sort();
      var hash = 0;
      for (var i = 0; i < keys.length; i++) {
        var str = keys[i] + '=' + proj[keys[i]];
        for (var c = 0; c < str.length; c++) {
          hash = ((hash << 5) - hash) + str.charCodeAt(c);
          hash |= 0;
        }
      }
      return hash;
    }
  };

  var _decreaseMutex = Object.create(null);

  var InventoryService = {

    deduct: function (entries, meta) {
      return _stockMutation('deduct', entries, meta, false);
    },

    reduce: function (entries, meta) {
      _warnDeprecatedOnce('InventoryService.reduce', 'InventoryService.deduct');
      return _stockMutation('deduct', entries, meta, false);
    },

    receive: function (entries, meta) {
      return _stockMutation('receive', entries, meta, false);
    },

    add: function (entries, meta) {
      _warnDeprecatedOnce('InventoryService.add', 'InventoryService.receive');
      return _stockMutation('receive', entries, meta, false);
    },

    restore: function (entries, meta) {
      return _stockMutation('restore', entries, meta, false);
    },

    purchaseReturn: function (entries, meta) {
      return _stockMutation('purchase-return', entries, meta, false);
    },

    adjust: function (entries, meta) {
      if (!meta || !meta.actor)
        return { ok: false, error: 'meta.actor required for adjust.' };
      if (!_isAdmin(meta.actor))
        return { ok: false, error: 'Admin role required for adjust.' };
      return _stockMutation('adjust', entries, meta, true);
    },

    getBalance: function (barcode) {
      return BalanceProjection.getBalance(barcode);
    },

    getValuation: function (barcode) {
      return _MAC.getMAC(barcode) * BalanceProjection.getBalance(barcode);
    },

    rebuildBalances: function (tx) {
      BalanceProjection.rebuild(tx);
      return { ok: true };
    },

    canSell: function (barcode, qty) {
      var q = _num(qty, NaN);
      if (!isFinite(q) || q <= 0) return false;
      var settings = _settings();
      if (settings.allowNegativeStock) return true;
      return BalanceProjection.getBalance(barcode) >= q;
    },

    findByBarcode: function (barcode) {
      var lc = (barcode || '').trim().toLowerCase();
      if (!lc) return null;
      return ERP.state.selectors.inventory().find(function (i) { return !i._archived && (i.bc || '').toLowerCase() === lc; }) || null;
    },

    getAll: function () {
      return ERP.state.selectors.inventory().filter(function (i) { return !i._archived; });
    },

    computeRestorations: function (items, alreadyReturnedMap) {
      var orderedTotals = {};
      var order = [];
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (!item.bc || !item.bc.trim())
          throw new Error('computeRestorations: barcode missing on item: ' + item.n);
        var bc = item.bc.trim();
        var orderedQty = _num(item.qty !== undefined ? item.qty : item.q, 0);
        if (!Object.prototype.hasOwnProperty.call(orderedTotals, bc)) {
          orderedTotals[bc] = 0;
          order.push(bc);
        }
        orderedTotals[bc] += orderedQty;
      }

      var result = {};
      for (var j = 0; j < order.length; j++) {
        var code = order[j];
        var alreadyReturned = _num(alreadyReturnedMap && alreadyReturnedMap[code], 0);
        var delta = Math.max(0, orderedTotals[code] - alreadyReturned);
        if (delta > 0) result[code] = delta;
      }
      return result;
    }
  };

  function _normalizeBarcodeCase(bc) {
    if (!bc) return bc;
    var canonical = ERP.state.selectors.inventory().find(function (i) {
      return (i.bc || '').toLowerCase() === bc.toLowerCase();
    });
    return canonical ? canonical.bc : bc;
  }

  function _consolidateEntries(rawEntries) {
    var order = [];
    var map = {};
    for (var mi = 0; mi < rawEntries.length; mi++) {
      var re = rawEntries[mi] || {};
      var bc = _normalizeBarcodeCase(re.barcode || re.bc || '');
      var q  = _num(re.qty || re.q, 0);
      var cpu = (re.unitCostPaisa !== undefined && re.unitCostPaisa !== null)
                  ? _num(re.unitCostPaisa, 0)
                  : Math.round(_num(re.pp || re.costPerUnit || re.cpu, 0) * 100);
      var signedQ = (re.direction === 'decrease') ? -q : q;
      if (!map[bc]) {
        map[bc] = { barcode: bc, signedQty: 0, costWeighted: 0, reversalReference: null, hasDirection: false };
        order.push(bc);
      }
      map[bc].signedQty += signedQ;
      map[bc].costWeighted += q * cpu;
      if (re.reversalReference) map[bc].reversalReference = re.reversalReference;
      if (re.direction === 'increase' || re.direction === 'decrease') map[bc].hasDirection = true;
    }
    return order.map(function (bc) {
      var m = map[bc];
      var qtyMagnitude = Math.abs(m.signedQty);
      var result = {
        barcode:           m.barcode,
        qty:               qtyMagnitude,
        unitCostPaisa:     qtyMagnitude > 0 ? Math.round(m.costWeighted / qtyMagnitude) : 0,
        reversalReference: m.reversalReference
      };
      if (m.hasDirection) {
        result.direction = m.signedQty < 0 ? 'decrease' : 'increase';
      }
      return result;
    });
  }

  function _stockMutation(type, entries, meta, skipStockCheck) {
    if (!Array.isArray(entries) || entries.length === 0)
      return { ok: false, error: type + ': entries array required.' };
    if (!meta || !meta.sourceModule || !meta.documentId || !meta.actor)
      return { ok: false, error: type + ': meta.{sourceModule, documentId, actor} required.' };
    if (!_isKnownSourceModule(meta.sourceModule))
      return { ok: false, error: type + ': meta.sourceModule "' + meta.sourceModule + '" is not registered. Call InventoryService.registerSourceModule() first.' };

    var tx = {
      txId:         _uid(),
      actor:        meta.actor,
      startedAt:    _now(),
      sourceModule: meta.sourceModule,
      documentId:   meta.documentId
    };

    var mergedEntries = _consolidateEntries(entries);

    var walEntry = {
      id:             _uid(),
      txId:           tx.txId,
      type:           'stock-mutation',
      status:         'pending',
      mutationType:   type,
      entries:        entries,
      mergedEntries:  mergedEntries,
      meta:           meta,
      steps:          [],
      completedSteps: [],
      timestamp:      _now()
    };
    _walWrite(walEntry);

    var settings   = _settings();
    var journalIds = [];
    var compensate = [];

    var heldMutexes = [];

    try {
      for (var i = 0; i < mergedEntries.length; i++) {
        var entry = mergedEntries[i];

        InventoryValidator.validateEntry(entry);

        var entryIsDecrease = (type === 'deduct' || type === 'purchase-return') ||
                               (type === 'adjust' && entry.direction === 'decrease');
        var entryIsIncrease = (type === 'receive' || type === 'restore') ||
                               (type === 'adjust' && entry.direction === 'increase');

        var iKey = JSON.stringify([meta.sourceModule, meta.documentId, entry.barcode]);
        var existing = StockJournalWriter._findByKey(iKey);
        if (existing) { journalIds.push(existing.id); continue; }

        var mutexAcquired = false;
        if (entryIsDecrease && !skipStockCheck) {
          if (_decreaseMutex[entry.barcode])
            throw Object.assign(new ERP.ConcurrencyError('Concurrent deduction in progress for barcode: ' + entry.barcode), {
              module: 'InventoryService', operation: 'deduct',
              documentId: meta.documentId, txId: tx.txId, timestamp: _now()
            });
          _decreaseMutex[entry.barcode] = true;
          mutexAcquired = true;
          heldMutexes.push(entry.barcode);
        }

        try {
          var qtyBefore   = BalanceProjection.getBalance(entry.barcode);
          var movementQty = entryIsDecrease ? -entry.qty : entry.qty;

          if (entryIsDecrease && !settings.allowNegativeStock && (qtyBefore + movementQty) < 0) {
            if (type === 'adjust') {
              throw Object.assign(new ERP.ValidationError('Adjustment would take stock below zero for barcode: ' + entry.barcode + ' (current: ' + qtyBefore + ', requested decrease: ' + entry.qty + '). Enable allowNegativeStock in settings if negative stock is intentional for this business.'), {
                module: 'InventoryService', operation: 'adjust',
                documentId: meta.documentId, txId: tx.txId, timestamp: _now()
              });
            }
            if (!skipStockCheck) {
              throw Object.assign(new ERP.InsufficientStockError('Insufficient stock for barcode: ' + entry.barcode), {
                module: 'InventoryService', operation: 'deduct',
                documentId: meta.documentId, txId: tx.txId, timestamp: _now()
              });
            }
          }

          var qtyAfter  = qtyBefore + movementQty;
          var valImpact = movementQty * entry.unitCostPaisa;

          var jEntry = {
            id:                 _uid(),
            idempotencyKey:     iKey,
            sourceModule:       meta.sourceModule,
            documentId:         meta.documentId,
            barcode:            entry.barcode,
            qtyBefore:          qtyBefore,
            qtyAfter:           qtyAfter,
            movementQty:        movementQty,
            unitCostPaisa:      entry.unitCostPaisa,
            valuationImpact:    valImpact,
            timestamp:          _now(),
            actor:              meta.actor,
            reversalReference:  entry.reversalReference || null,
            _v:                 1
          };

          StockJournalWriter.write(jEntry);
          walEntry.completedSteps.push('journal:' + entry.barcode);
          _walSync(walEntry.id);

          if (entryIsIncrease) {
            _MAC._applyReceipt(entry.barcode, qtyBefore, entry.qty, entry.unitCostPaisa / 100);
          }

          _setState(function (s) {
            s.data.balanceProjection = s.data.balanceProjection || {};
            s.data.balanceProjection[entry.barcode] = _num(s.data.balanceProjection[entry.barcode], 0) + movementQty;

            s.data.inventory = s.data.inventory || [];
            var idx = -1;
            for (var k = 0; k < s.data.inventory.length; k++) {
              if (s.data.inventory[k] && s.data.inventory[k].bc === jEntry.barcode) { idx = k; break; }
            }
            if (idx >= 0) {
              s.data.inventory[idx].st = jEntry.qtyAfter;
              s.data.inventory[idx].lastMoved = jEntry.timestamp;
            } else {
              _logger().error('[Inventory._stockMutation] state-sync failed: barcode not found in inventory array: ' + jEntry.barcode);
              try {
                ERP.AuditLog && ERP.AuditLog.write({
                  id: _uid(), txId: tx.txId, actor: meta.actor,
                  action: 'stock_state_sync_failed', module: 'InventoryService',
                  documentId: meta.documentId,
                  before: null,
                  after: { barcode: jEntry.barcode, qtyAfter: jEntry.qtyAfter, reason: 'barcode not found in inventory master list — display cache left stale, journal/balance are still correct' },
                  timestamp: _now(), severity: 'warning'
                });
              } catch (_auditErr) {   }
            }
          }, 'inventory:mutation-commit');

          ERP.AuditLog && ERP.AuditLog.write({
            id: _uid(), txId: tx.txId, actor: meta.actor,
            action: 'stock:' + type, module: 'InventoryService',
            documentId: meta.documentId,
            before: { barcode: entry.barcode, qty: qtyBefore },
            after:  { barcode: entry.barcode, qty: qtyAfter },
            timestamp: _now(), severity: 'info'
          });

          journalIds.push(jEntry.id);
          compensate.push({ barcode: entry.barcode, reversalOf: jEntry.id, qty: entry.qty, unitCostPaisa: entry.unitCostPaisa, movementQty: movementQty, mutexRelevant: (entryIsDecrease && !skipStockCheck) });

        } finally {
          if (mutexAcquired) {
            delete _decreaseMutex[entry.barcode];
            var hmIdx = heldMutexes.indexOf(entry.barcode);
            if (hmIdx !== -1) heldMutexes.splice(hmIdx, 1);
          }
        }
      }

      _walCommit(walEntry.id);

      _LedgerBridge.postMutation(type, mergedEntries, meta, tx);

      try {
        if (ERP.events && ERP.events.emit) ERP.events.emit(ERP.events.NAMES.INVENTORY_UPDATED);
      } catch (_) {}
      _persistInventory();

      return { ok: true, journalIds: journalIds };

    } catch (err) {

      for (var c = compensate.length - 1; c >= 0; c--) {
        var comp = compensate[c];
        var compQty = -comp.movementQty;
        var compMutexAcquired = false;
        if (comp.mutexRelevant) {
          if (!_decreaseMutex[comp.barcode]) {
            _decreaseMutex[comp.barcode] = true;
            compMutexAcquired = true;
          } else {
            _logger().warn('[Inventory._stockMutation] compensation for barcode "' + comp.barcode +
              '" could not acquire mutex (held by another op) — proceeding anyway to avoid leaving the rollback incomplete.');
          }
        }
        try {
          var compQtyBefore = BalanceProjection.getBalance(comp.barcode);
          BalanceProjection.update(comp.barcode, compQty, 'COMP:' + comp.reversalOf);
          var compQtyAfter = BalanceProjection.getBalance(comp.barcode);

          _setState(function (s) {
            s.data.inventory = s.data.inventory || [];
            for (var ci = 0; ci < s.data.inventory.length; ci++) {
              if (s.data.inventory[ci] && s.data.inventory[ci].bc === comp.barcode) {
                s.data.inventory[ci].st = compQtyAfter;
                s.data.inventory[ci].lastMoved = _now();
                break;
              }
            }
          }, 'inventory:mutation-compensate-cache');

          StockJournalWriter.write({
            id:              _uid(),
            idempotencyKey:  'COMP:' + comp.reversalOf,
            sourceModule:    meta.sourceModule,
            documentId:      meta.documentId,
            barcode:         comp.barcode,
            qtyBefore:       compQtyBefore,
            qtyAfter:        compQtyAfter,
            movementQty:     compQty,
            unitCostPaisa:   comp.unitCostPaisa || 0,
            valuationImpact: compQty * (comp.unitCostPaisa || 0),
            timestamp:       _now(),
            actor:           meta.actor,
            reversalReference: comp.reversalOf,
            _v: 1
          });
        } catch (_compErr) {
          _logger().error('[Inventory._stockMutation] compensation FAILED for barcode "' + comp.barcode +
            '" while rolling back tx ' + tx.txId + ' — balance/journal may now be inconsistent for this barcode:', _compErr && _compErr.message || _compErr);
          try {
            ERP.AuditLog && ERP.AuditLog.write({
              id: _uid(), txId: tx.txId, actor: meta.actor,
              action: 'stock_compensation_failed', module: 'InventoryService',
              documentId: meta.documentId,
              before: null,
              after: { barcode: comp.barcode, reversalOf: comp.reversalOf, error: (_compErr && _compErr.message) || String(_compErr) },
              timestamp: _now(), severity: 'error'
            });
          } catch (_auditErr2) {}
        } finally {
          if (compMutexAcquired) delete _decreaseMutex[comp.barcode];
        }
      }

      for (var h = 0; h < heldMutexes.length; h++) {
        delete _decreaseMutex[heldMutexes[h]];
      }
      _walRollback(walEntry.id);
      return { ok: false, error: (err.message || String(err)), name: err.name };
    }
  }

  var _walStore = {};

  function _walLocalStorageMirror(mutateFn) {
    try {
      var lsKey = 'erp_wal_pending';
      var existing = [];
      try { existing = JSON.parse(localStorage.getItem(lsKey) || '[]'); } catch (_) {}
      existing = mutateFn(existing) || existing;
      localStorage.setItem(lsKey, JSON.stringify(existing));
    } catch (_) {}
  }

  function _walPersistEntry(entry) {
    if (!entry) return;
    if (!window.ERP || !ERP.Persistence || typeof ERP.Persistence.saveRecord !== 'function') {
      _logger().warn('[Inventory.WAL] ERP.Persistence unavailable — WAL entry ' + entry.id + ' relying on in-memory/localStorage mirror only.');
      return;
    }
    ERP.Persistence.saveRecord('walEntries', entry, { retries: 5, silent: true }).catch(function (e) {
      _logger().error('[Inventory.WAL] durable IDB persistence failed after retries for entry ' + entry.id + ':', e && (e.message || e));
    });
  }

  function _walDeleteEntry(id) {
    if (!window.ERP || !ERP.Persistence || typeof ERP.Persistence.deleteRecord !== 'function') return;
    ERP.Persistence.deleteRecord('walEntries', id).catch(function (e) {
      _logger().warn('[Inventory.WAL] durable delete failed for entry ' + id + ':', e && (e.message || e));
    });
  }

  function _walWrite(entry) {
    _walStore[entry.id] = entry;
    _setState(function (s) {
      s.data.walEntries = s.data.walEntries || [];
      s.data.walEntries.push(entry);
    }, 'wal:write');
    _walLocalStorageMirror(function (existing) { existing.push(entry); return existing; });
    _walPersistEntry(entry);
  }

  function _walSync(id) {
    var entry = _walStore[id];
    _walLocalStorageMirror(function (existing) {
      for (var i = 0; i < existing.length; i++) {
        if (existing[i].id === id && entry) { existing[i] = entry; break; }
      }
      return existing;
    });
    if (entry) _walPersistEntry(entry);
  }

  function _walCommit(id) {
    var committed = null;
    if (_walStore[id]) { _walStore[id].status = 'committed'; committed = _walStore[id]; delete _walStore[id]; }
    _setState(function (s) {
      s.data.walEntries = s.data.walEntries || [];
      for (var i = 0; i < s.data.walEntries.length; i++) {
        if (s.data.walEntries[i].id === id) {
          s.data.walEntries[i].status = 'committed';
          if (!committed) committed = s.data.walEntries[i];
          break;
        }
      }
      if (s.data.walEntries.length > 50) {
        s.data.walEntries = s.data.walEntries.filter(function(e) {
          return e.status !== 'committed' && e.status !== 'rolled_back';
        });
      }
    }, 'wal:commit');
    _walLocalStorageMirror(function (existing) { return existing.filter(function (e) { return e.id !== id; }); });
    if (committed) _walPersistEntry(committed); else _walDeleteEntry(id);
  }

  function _walRollback(id) {
    var rolledBack = null;
    if (_walStore[id]) { _walStore[id].status = 'rolled_back'; rolledBack = _walStore[id]; delete _walStore[id]; }
    _setState(function (s) {
      s.data.walEntries = s.data.walEntries || [];
      for (var i = 0; i < s.data.walEntries.length; i++) {
        if (s.data.walEntries[i].id === id) {
          s.data.walEntries[i].status = 'rolled_back';
          if (!rolledBack) rolledBack = s.data.walEntries[i];
          break;
        }
      }
      if (s.data.walEntries.length > 50) {
        s.data.walEntries = s.data.walEntries.filter(function(e) {
          return e.status !== 'committed' && e.status !== 'rolled_back';
        });
      }
    }, 'wal:rollback');
    _walLocalStorageMirror(function (existing) { return existing.filter(function (e) { return e.id !== id; }); });
    if (rolledBack) _walPersistEntry(rolledBack); else _walDeleteEntry(id);
  }

  function _walCleanup() {
    try {
      var s = _getState();
      if (!s || !s.meta) return;
      var last = s.meta.lastWalCleanup;
      var nowMs     = Date.now();
      var cutoff30Ms = nowMs - 30 * 86400000;
      var cutoff7Ms  = nowMs - 7  * 86400000;

      var lastMs = last ? Date.parse(last) : NaN;
      if (!isNaN(lastMs) && lastMs > cutoff7Ms) return;

      var archived = [];
      _setState(function (st) {
        st.data.walEntries = st.data.walEntries || [];
        st.data.walArchive = st.data.walArchive || [];
        var active = [];
        for (var i = 0; i < st.data.walEntries.length; i++) {
          var w = st.data.walEntries[i];
          var done = (w.status === 'committed' || w.status === 'rolled_back');
          var wMs  = w.timestamp ? Date.parse(w.timestamp) : NaN;
          if (done && !isNaN(wMs) && wMs < cutoff30Ms) {
            st.data.walArchive.push(w);
            archived.push(w);
          } else {
            active.push(w);
          }
        }
        st.data.walEntries = active;
        if (st.data.walArchive && st.data.walArchive.length > 500) {
          st.data.walArchive = st.data.walArchive.slice(-500);
        }
        st.meta = st.meta || {};
        st.meta.lastWalCleanup = _now();
      }, 'wal:cleanup');
      archived.forEach(function (w) {
        if (window.ERP && ERP.Persistence && typeof ERP.Persistence.saveRecord === 'function') {
          ERP.Persistence.saveRecord('walArchive', w, { retries: 3, silent: true }).catch(function () {});
        }
        _walDeleteEntry(w.id);
      });
    } catch (e) {
      _logger().warn('[Inventory._walCleanup]', e && e.message || e);
    }
  }

  var _MAC = {

    getMAC: function (barcode) {
      if (!barcode) return 0;
      try {
        var s = _getState();
        var macMap = (s.data && s.data.macCost) ? s.data.macCost : {};
        if (Object.prototype.hasOwnProperty.call(macMap, barcode) && typeof macMap[barcode] === 'number' && isFinite(macMap[barcode])) {
          return macMap[barcode];
        }
        var item = InventoryService.findByBarcode(barcode);
        return item ? _round2(_num(item.pp, 0)) : 0;
      } catch (_) { return 0; }
    },

    // FIX (root-cause): the weighted-average-cost math below used to run on float
    // rupees (oldQty*oldMAC + newQty*newCPU, then round2()) — the one piece of
    // financial arithmetic in this file that hadn't been moved onto the integer-paisa
    // pattern already used everywhere else in this codebase (ACC.Money). Floating-point
    // rupee multiplication/division can misround at the cent boundary (e.g. a
    // combined/total that lands on x.xx5), and unlike a single conversion, MAC is
    // recalculated on every receipt — so any misrounding compounds over the item's
    // life instead of staying a one-off cent. Converting to integer paisa for the
    // actual averaging removes that class of error; behavior/contract (inputs and
    // return value in rupees) is unchanged for all existing callers.
    _applyReceipt: function (barcode, oldQty, newQty, newCPU) {
      try {
        var safeOld = Math.max(0, _num(oldQty, 0));
        var safeNew = _num(newQty, 0);
        if (safeNew <= 0) return;
        var oldMACPaisa = _money().toPaisa(_MAC.getMAC(barcode));
        var newCPUPaisa = _money().toPaisa(_num(newCPU, 0));
        var combinedPaisa = Math.round((safeOld * oldMACPaisa) + (safeNew * newCPUPaisa));
        var total = safeOld + safeNew;
        var newMACPaisa = total > 0 ? Math.round(combinedPaisa / total) : newCPUPaisa;
        var newMAC = newMACPaisa / 100;
        _setState(function (s) {
          s.data.macCost = s.data.macCost || {};
          s.data.macCost[barcode] = newMAC;
        }, 'inventory:mac-update');
      } catch (e) {
        _logger().error('[MAC._applyReceipt]', e.message || e);
      }
    },

    recalcAfterReceipt: function (barcode, newQty, newCPU) {
      try {

        if (_num(newQty, 0) < 0) {
          throw new Error('recalcAfterReceipt: newQty cannot be negative, got: ' + newQty);
        }
        var safeNew = _num(newQty, 0);
        if (safeNew <= 0) return _MAC.getMAC(barcode);
        var currentTotal = InventoryService.getBalance(barcode);

        if (currentTotal < safeNew) {
          _logger().warn('recalcAfterReceipt: Balance lower than receipt qty — barcode:', barcode, 'balance:', currentTotal, 'newQty:', safeNew);
        }
        var oldQty = Math.max(0, currentTotal - safeNew);
        var oldMACPaisa = _money().toPaisa(_MAC.getMAC(barcode));
        var newCPUPaisa = _money().toPaisa(_num(newCPU, 0));
        var combinedPaisa = Math.round((oldQty * oldMACPaisa) + (safeNew * newCPUPaisa));
        var total = oldQty + safeNew;
        var resultPaisa = total > 0 ? Math.round(combinedPaisa / total) : newCPUPaisa;
        return resultPaisa / 100;
      } catch (e) { _logger().error('[MAC.recalcAfterReceipt]', e.message || e); return _num(newCPU, 0); }
    }
  };

  function _resolveWriteOffCost(bc, item) {
    var mac = _MAC.getMAC(bc);
    if (typeof mac === 'number' && isFinite(mac) && mac > 0) return mac;
    var fallback = _num(item && item.pp, 0);
    if (fallback > 0) {
      _logger().warn('[Inventory] MAC unavailable for "' + bc + '"; using current purchase price as write-off cost.');
      return fallback;
    }
    return 0;
  }

  // ARCHITECTURAL REFACTOR (root-level persistence unification): kept as a
  // stable name for the many existing call sites in this file — the actual
  // retry/failure-toast logic now lives once, in ERP.Persistence.save().
  function _persistInventoryWithRetry(maxRetries) {
    return ERP.Persistence.save('inventory', ERP.state.selectors.inventory(), { retries: maxRetries });
  }

  function _retryQueuedPersistFailures() {
    try {
      var s = _getState();
      var failures = (s.data && s.data._persistFailures) || [];
      var inventoryFailures = failures.filter(function (f) { return f.collection === 'inventory'; });
      if (!inventoryFailures.length) return;
      _persistInventoryWithRetry(3).then(function () {
        _setState(function (st) {
          st.data._persistFailures = (st.data._persistFailures || []).filter(function (f) { return f.collection !== 'inventory'; });
        }, 'inventory:persist-failure-cleared');
      }).catch(function () {  });
    } catch (_) {}
  }

  function _recordGLMismatch(kind, bc, ref, payload, err) {
    var errMsg = (err && (err.message || String(err))) || 'unknown error';
    try {
      localStorage.setItem('erp_ledger_mismatch_' + encodeURIComponent(kind) + '_' + encodeURIComponent(ref) + '_' + encodeURIComponent(bc), JSON.stringify({
        kind: kind, bc: bc, ref: ref, payload: payload, ts: _now(), error: errMsg
      }));
    } catch (_) {}
    try {
      ERP.AuditLog && ERP.AuditLog.write({
        id: _uid(), actor: 'System', action: 'gl:postMutation:failed', module: 'LedgerBridge',
        documentId: ref, before: null, after: payload,
        timestamp: _now(), severity: 'error', error: errMsg
      });
    } catch (_) {}
    _toast('⚠️ GL posting failed for ' + bc + ' (' + kind + ') — saved for reconciliation', 'warning', 8000);
  }

  var _pendingGLPosts = {};

  function _trackPendingGLPost(id, promise) {
    _pendingGLPosts[id] = { startedAt: _now(), promise: promise };
    promise.then(function (failures) {
      delete _pendingGLPosts[id];
      if (failures && failures.length) {
        try {
          var s = ERP._internal && ERP._internal.getState && ERP._internal.getState();
          if (s && s.data) {
            if (!s.data.glPostFailures) s.data.glPostFailures = [];
            s.data.glPostFailures.push({ id: id, failures: failures, ts: _now() });
          }
        } catch (_) {}
      }
    }).catch(function () { delete _pendingGLPosts[id]; });
  }

  var _LedgerBridge = {

    postMutation: function (type, entries, meta, tx) {
      var postPromises = [];
      if (meta && meta.skipGLBridge) return Promise.resolve([]);
      try {
        var ledger = _ledger();
        if (!ledger) return Promise.resolve([]);
        var M = _money();
        entries.forEach(function (rawEntry) {
          var bc  = rawEntry.barcode || rawEntry.bc || '';
          var qty = _num(rawEntry.qty || rawEntry.q, 0);
          if (!bc || !qty) return;

          var p;
          if (type === 'deduct') {
            var mac       = _MAC.getMAC(bc);
            var costPaisa = M.toPaisa(mac * qty);
            if (costPaisa <= 0) return;
            var stableRef = meta.documentId || '';
            p = ledger.StockLedger.postStockConsumption({
              sourceId:  'COGS-' + stableRef + '-' + bc,
              costPaisa: costPaisa,
              itemCode:  bc, qty: qty,
              memo:      'COGS: ' + bc + ' x' + qty + (stableRef ? ' [' + stableRef + ']' : '')
            }, meta.actor || 'System').catch(function (e) {
              _logger().warn('[LedgerBridge.postConsumption]', e.message || e);
              _recordGLMismatch('COGS', bc, stableRef, { qty: qty, costPaisa: costPaisa }, e);
              return { failed: true, bc: bc, type: 'COGS', error: e.message || String(e) };
            });

          } else if (type === 'receive') {
            var cpu;
            if (rawEntry.unitCostPaisa !== undefined && rawEntry.unitCostPaisa !== null) {
              cpu = _num(rawEntry.unitCostPaisa, 0) / 100;
            } else {
              cpu = _num(rawEntry.costPerUnit || rawEntry.pp, 0);
            }
            var amountPaisa = M.toPaisa(cpu * qty);
            if (amountPaisa <= 0) return;
            p = ledger.StockLedger.postStockReceipt({
              sourceId:    'RECV-' + meta.documentId + '-' + bc,
              amountPaisa: amountPaisa,
              itemCode: bc, qty: qty, costPerUnit: cpu,
              memo: 'Stock receipt: ' + bc + ' x' + qty + ' [' + meta.documentId + ']'
            }, meta.actor || 'System').catch(function (e) {
              _logger().warn('[LedgerBridge.postReceipt]', e.message || e);
              _recordGLMismatch('RECEIPT', bc, meta.documentId, { qty: qty, amountPaisa: amountPaisa }, e);
              return { failed: true, bc: bc, type: 'RECEIPT', error: e.message || String(e) };
            });

          } else if (type === 'restore') {
            var restorePaisa, restoreCpu;
            if (rawEntry.unitCostPaisa !== undefined && rawEntry.unitCostPaisa !== null && _num(rawEntry.unitCostPaisa, 0) > 0) {
              restorePaisa = Math.round(_num(rawEntry.unitCostPaisa, 0) * qty);
              restoreCpu   = restorePaisa / qty / 100;
            } else {
              restoreCpu   = _MAC.getMAC(bc) || _num(rawEntry.pp, 0);
              restorePaisa = M.toPaisa(restoreCpu * qty);
            }
            if (restorePaisa <= 0) return;
            var restoreRef = meta.documentId || '';
            var restoreMemo = 'Stock restore (sale return — reversing COGS): ' + bc + ' x' + qty + (restoreRef ? ' [' + restoreRef + ']' : '');

            if (ledger.StockLedger && typeof ledger.StockLedger.postCOGSReversal === 'function') {
              p = ledger.StockLedger.postCOGSReversal({
                sourceId:    'RESTORE-' + restoreRef + '-' + bc,
                costPaisa:   restorePaisa,
                itemCode: bc, qty: qty,
                memo: restoreMemo
              }, meta.actor || 'System').catch(function (e) {
                _logger().warn('[LedgerBridge.postRestore]', e.message || e);
                _recordGLMismatch('RESTORE', bc, restoreRef, { qty: qty, amountPaisa: restorePaisa }, e);
                return { failed: true, bc: bc, type: 'RESTORE', error: e.message || String(e) };
              });
            } else {
              _logger().error('[LedgerBridge.postRestore] ledger.StockLedger.postCOGSReversal is not available — ' +
                'falling back to postStockReceipt, which does NOT reverse the original COGS entry. ' +
                'This restore will leave COGS overstated until postCOGSReversal is implemented in the ledger module.');
              _recordGLMismatch('RESTORE_COGS_NOT_REVERSED', bc, restoreRef, { qty: qty, amountPaisa: restorePaisa },
                new Error('postCOGSReversal unavailable on ledger.StockLedger'));
              p = ledger.StockLedger.postStockReceipt({
                sourceId:    'RESTORE-' + restoreRef + '-' + bc,
                amountPaisa: restorePaisa,
                itemCode: bc, qty: qty, costPerUnit: restoreCpu,
                memo: restoreMemo
              }, meta.actor || 'System').catch(function (e) {
                _logger().warn('[LedgerBridge.postRestore]', e.message || e);
                _recordGLMismatch('RESTORE', bc, restoreRef, { qty: qty, amountPaisa: restorePaisa }, e);
                return { failed: true, bc: bc, type: 'RESTORE', error: e.message || String(e) };
              });
            }

          } else if (type === 'purchase-return') {
            var prCpu;
            if (rawEntry.unitCostPaisa !== undefined && rawEntry.unitCostPaisa !== null) {
              prCpu = _num(rawEntry.unitCostPaisa, 0) / 100;
            } else {
              prCpu = _num(rawEntry.costPerUnit || rawEntry.pp, 0);
            }
            var prPaisa = M.toPaisa(prCpu * qty);
            if (prPaisa <= 0) return;
            var prRef  = meta.documentId || '';
            var prMemo = 'Purchase return (reversing receipt — credit inventory, debit payable/cash): ' + bc + ' x' + qty + (prRef ? ' [' + prRef + ']' : '');

            if (ledger.StockLedger && typeof ledger.StockLedger.postPurchaseReturn === 'function') {
              p = ledger.StockLedger.postPurchaseReturn({
                sourceId:    'PURCRET-' + prRef + '-' + bc,
                amountPaisa: prPaisa,
                itemCode: bc, qty: qty, costPerUnit: prCpu,
                memo: prMemo
              }, meta.actor || 'System').catch(function (e) {
                _logger().warn('[LedgerBridge.postPurchaseReturn]', e.message || e);
                _recordGLMismatch('PURCHASE_RETURN', bc, prRef, { qty: qty, amountPaisa: prPaisa }, e);
                return { failed: true, bc: bc, type: 'PURCHASE_RETURN', error: e.message || String(e) };
              });
            } else {
              _logger().error('[LedgerBridge.postPurchaseReturn] ledger.StockLedger.postPurchaseReturn is not available — ' +
                'GL post skipped rather than wrongly booking this as COGS or a fresh receipt. ' +
                'This purchase return will not appear in the GL until postPurchaseReturn is implemented in the ledger module.');
              _recordGLMismatch('PURCHASE_RETURN_NOT_POSTED', bc, prRef, { qty: qty, amountPaisa: prPaisa },
                new Error('postPurchaseReturn unavailable on ledger.StockLedger'));
            }

          } else if (type === 'adjust') {
            var adjCpu   = _MAC.getMAC(bc) || _num(rawEntry.pp, 0);
            var adjPaisa = M.toPaisa(adjCpu * qty);
            if (adjPaisa <= 0) return;
            var dir = rawEntry.direction;
            if (dir !== 'increase' && dir !== 'decrease') {
              _logger().error('[LedgerBridge.postAdjustment] invalid or missing direction for ' + bc + ': "' + rawEntry.direction + '" — GL post skipped.');
              _recordGLMismatch('ADJUST', bc, meta.documentId, { qty: qty, direction: rawEntry.direction }, new Error('invalid direction'));
              return;
            }
            p = ledger.StockLedger.postStockAdjustment({
              sourceId:    'ADJ-' + meta.documentId + '-' + bc,
              amountPaisa: adjPaisa, direction: dir,
              memo: 'Adjustment: ' + bc + ' x' + qty + ' [' + meta.documentId + ']'
            }, meta.actor || 'System').catch(function (e) {
              _logger().warn('[LedgerBridge.postAdjustment]', e.message || e);
              _recordGLMismatch('ADJUST', bc, meta.documentId, { qty: qty, amountPaisa: adjPaisa, direction: dir }, e);
              return { failed: true, bc: bc, type: 'ADJUST', error: e.message || String(e) };
            });
          }
          if (p) postPromises.push(p);
        });
      } catch (e) {
        _logger().warn('[LedgerBridge.postMutation]', e.message || e);
      }
      var settled = Promise.all(postPromises).then(function (results) {
        return results.filter(function (r) { return r && r.failed; });
      }).catch(function (e) {
        _logger().warn('[LedgerBridge.postMutation] unexpected rejection while settling GL posts:', e && e.message || e);
        return [];
      });
      _trackPendingGLPost((meta.documentId || _uid()) + ':' + type, settled);
      return settled;
    },

    getPendingCount: function () { return Object.keys(_pendingGLPosts).length; },
    getPendingIds:   function () { return Object.keys(_pendingGLPosts); }
  };

  var _invService = {

    validate: function (data) {
      return InventoryValidator.validateItemData(data);
    },

    barcodeExists: function (bc) {
      var lc = (bc || '').trim().toLowerCase();
      if (!lc) return false;
      return ERP.state.selectors.inventory().some(function (i) { return (i.bc || '').toLowerCase() === lc; });
    },

    nameExists: function (name) {
      var lc = (name || '').toLowerCase();
      return ERP.state.selectors.inventory().some(function (i) {
        return !i._archived && (i.n || '').toLowerCase() === lc;
      });
    },

    getAll: function () { return ERP.state.selectors.inventory().filter(function (i) { return !i._archived; }); },

    findByBarcode: function (bc) {
      var lc = (bc || '').trim().toLowerCase();
      if (!lc) return null;
      return ERP.state.selectors.inventory().find(function (i) { return !i._archived && (i.bc || '').toLowerCase() === lc; }) || null;
    },

    renameBarcode: function (oldBc, newBcRaw, actor) {
      var oldNorm = (oldBc || '').trim();
      var newBc   = (newBcRaw || '').trim();
      if (!oldNorm || oldNorm.length < 2) return { ok: false, error: 'Invalid current barcode.' };
      if (!newBc || newBc.length < 2)     return { ok: false, error: 'New barcode/code required (min 2 characters).' };
      if (newBc.toLowerCase() === oldNorm.toLowerCase()) return { ok: true, unchanged: true };

      var item = ERP.state.selectors.inventory().find(function (i) { return i.bc === oldNorm; });
      if (!item) return { ok: false, error: 'Item not found: ' + oldNorm };
      if (_invService.barcodeExists(newBc)) return { ok: false, error: 'Barcode "' + newBc + '" already exists — please choose a different code.' };

      var resolvedActor = _resolveActor(actor);

      _setState(function (s) {
        s.data.inventory = (s.data.inventory || []).map(function (i) {
          return i.bc === oldNorm ? Object.assign({}, i, { bc: newBc }) : i;
        });
        s.data.stockBatches = (s.data.stockBatches || []).map(function (b) {
          return b.bc === oldNorm ? Object.assign({}, b, { bc: newBc }) : b;
        });
        if (s.data.balanceProjection && Object.prototype.hasOwnProperty.call(s.data.balanceProjection, oldNorm)) {
          s.data.balanceProjection[newBc] = s.data.balanceProjection[oldNorm];
          delete s.data.balanceProjection[oldNorm];
        }
        s.data.stockJournal = (s.data.stockJournal || []).map(function (j) {
          return j.barcode === oldNorm ? Object.assign({}, j, { barcode: newBc }) : j;
        });
      }, 'inventory:renameBarcode');

      try {
        ERP.AuditLog && ERP.AuditLog.write({
          id: _uid(), actor: resolvedActor, action: 'inventory:barcode_renamed', module: 'InventoryService',
          documentId: newBc, before: { bc: oldNorm }, after: { bc: newBc },
          timestamp: _now(), severity: 'warning'
        });
      } catch (_) {}

      // FIX (root-level persistence audit): renameBarcode() also mutates
      // stockBatches and stockJournal (see above), but _persistInventoryWithRetry()
      // only flushes the 'inventory' store. Use the full _persistInventory()
      // wrapper instead so the renamed barcode is reflected in stockBatches/
      // stockJournal on disk too, not just in memory until some unrelated
      // stock mutation happens to flush them later.
      _persistInventory();
      return { ok: true };
    },

    save: function (data, andAnother, mode) {
      try {
        var err = _invService.validate(data);
        if (err) return { ok: false, error: err };

        data = Object.assign({}, data);

        var saveMode = mode || 'add';

        if (saveMode === 'add') {
          if (_invService.barcodeExists(data.bc))
            return { ok: false, error: 'Barcode already exists — please generate a new one.' };
          if (_invService.nameExists(data.n))
            return { ok: false, error: '"' + data.n + '" already exists.' };

          data.createdAt = _now();
          if (!data.id) {
            // FIX (root cause): was preferring ERP.ID.generate('INV') -- a
            // whole separate, undocumented ID-generator module living in
            // erp.system.guard.js that duplicated ERP.uid()'s job with a
            // different (weaker, non-monotonic) algorithm. Traced its full
            // API: 3 of its 4 methods (opKey/isValid/fromSeed) had zero
            // callers anywhere in the app, and this was one of only two real
            // callers of the 4th. Removing the module (see
            // erp.system.guard.js) and using the one canonical generator.
            data.id = 'INV-' + _uid();
          }

          _setState(function (s) {
            s.data.inventory = s.data.inventory || [];
            s.data.inventory.unshift(data);
          }, 'inventory');

          _toast('\u2705 ' + data.n + ' added!', 'success');

          if (data.st > 0) {
            _invService.addBatch({
              bc:          data.bc,
              qty:         data.st,
              costPerUnit: data.pp || 0,
              purchaseRef: 'OPENING',
              note:        'Opening stock'
            });
          }

          ERP.events.emit(ERP.events.NAMES.INVENTORY_UPDATED);
          if (data.st > 0 && data.st <= data.minSt) ERP.events.emit(ERP.events.NAMES.STOCK_LOW, data);
          _persistInventory();

        } else {
          var editBC = saveMode.indexOf('edit:') === 0 ? saveMode.slice(5) : saveMode;
          var newBcRequested = (data.bc || '').trim();

          if (newBcRequested && newBcRequested !== editBC) {
            var renameResult = _invService.renameBarcode(editBC, newBcRequested);
            if (!renameResult.ok) return { ok: false, error: renameResult.error };
            editBC = newBcRequested;
          }

          _setState(function (s) {
            var idx = (s.data.inventory || []).findIndex(function (i) { return i.bc === editBC; });
            if (idx !== -1) {

              var editData = Object.assign({}, data);
              delete editData.st;
              delete editData.bc;
              s.data.inventory[idx] = Object.assign({}, s.data.inventory[idx], editData, { bc: editBC });
            }
          }, 'inventory');
          _toast('\u2705 ' + data.n + ' updated!', 'success');
          ERP.events.emit(ERP.events.NAMES.INVENTORY_UPDATED);
          _persistInventory();
        }

        _persistInventoryWithRetry(2)
          .then(function () {
            if (andAnother) {
              _invUI.openAdd();
            } else {
              _invUI._filtered = null;
              _invUI.closeModal();
              _invUI.render();
            }
          })
          .catch(function () {
            if (!andAnother) { _invUI._filtered = null; _invUI.closeModal(); _invUI.render(); }
          });

        return { ok: true };

      } catch (erpErr) {
        if (window.DEBUG_MODE) console.error('[ERP] inventory.save failed:', erpErr);
        _toast('\u26a0\ufe0f Unexpected error saving item. Please try again.', 'error');
        return { ok: false, error: 'ERP inventory.save failed: ' + erpErr.message };
      }
    },

    deleteItem: function (bc, actor) {
      if (!bc || typeof bc !== 'string' || bc.trim().length < 2)
        return { ok: false, error: 'Invalid barcode.' };
      var item = ERP.state.selectors.inventory().find(function (i) { return i.bc === bc; });
      if (!item) return { ok: false, error: 'Item not found: ' + bc };
      if (item._archived) return { ok: false, error: 'Item already deleted.' };

      var resolvedActor = _resolveActor(actor);

      var currentBalance = (ERP.InventoryService && typeof ERP.InventoryService.getBalance === 'function')
        ? ERP.InventoryService.getBalance(bc) : (item.st || 0);

      if (currentBalance > 0) {
        var writeOffCost  = _resolveWriteOffCost(bc, item);
        var writeOffPaisa = Math.round(currentBalance * writeOffCost * 100);

        var zeroOutResult = _stockMutation('deduct', [{
          barcode:       bc,
          qty:           currentBalance,
          unitCostPaisa: Math.round(writeOffCost * 100)
        }], {
          sourceModule: 'inventory',
          documentId:   'ITEM-DEL-' + bc,
          actor:        resolvedActor,
          skipGLBridge: true
        }, true);

        if (!zeroOutResult.ok) {
          return { ok: false, error: 'Could not write off remaining stock before deletion: ' + zeroOutResult.error };
        }

        if (writeOffPaisa > 0) {
          try {
            var ledger = (window.ERP && ERP.Ledger) || window.ledger || null;
            if (ledger && ledger.StockLedger && typeof ledger.StockLedger.postStockWriteOff === 'function') {
              ledger.StockLedger.postStockWriteOff({ sourceId: bc, amountPaisa: writeOffPaisa, memo: 'Item deleted: ' + bc, date: _now() }, resolvedActor).catch(function (e) {
                _recordGLMismatch('WRITEOFF', bc, 'ITEM-DEL-' + bc, { writeOffPaisa: writeOffPaisa }, e);
              });
            } else if (window.ERP && ERP.PostingEngine) {
              var sa = (window.ERP && ERP.AccountingState && ERP.AccountingState.getAccounts) ? ERP.AccountingState.getAccounts() : null;
              if (!sa || !sa.INVENTORY_WRITEOFF || !sa.INVENTORY) {
                _recordGLMismatch('WRITEOFF', bc, 'ITEM-DEL-' + bc, { writeOffPaisa: writeOffPaisa }, new Error('INVENTORY_WRITEOFF/INVENTORY account not configured — write-off NOT posted to avoid misclassifying it as COGS'));
              } else {
                ERP.PostingEngine.post({
                  documentId:   'ITEM-DEL-' + bc,
                  documentType: 'inventory_writeoff',
                  sourceModule: 'inventory',
                  date:         _now(),
                  memo:         'Item deleted (write-off): ' + bc,
                  actor:        resolvedActor,
                  entries: [
                    { accountId: sa.INVENTORY_WRITEOFF, debit: writeOffPaisa, credit: 0, description: 'Stock write-off on deletion' },
                    { accountId: sa.INVENTORY, debit: 0, credit: writeOffPaisa, description: 'Inventory CR — item deleted' }
                  ]
                }).catch(function (e) { _recordGLMismatch('WRITEOFF', bc, 'ITEM-DEL-' + bc, { writeOffPaisa: writeOffPaisa }, e); });
              }
            } else {
              _recordGLMismatch('WRITEOFF', bc, 'ITEM-DEL-' + bc, { writeOffPaisa: writeOffPaisa }, new Error('No ledger/PostingEngine available to post write-off'));
            }
          } catch (glErr) { _recordGLMismatch('WRITEOFF', bc, 'ITEM-DEL-' + bc, { writeOffPaisa: writeOffPaisa }, glErr); }
        }
      }

      _setState(function (s) {
        s.data.inventory = (s.data.inventory || []).map(function (i) {
          if (i.bc !== bc) return i;
          return Object.assign({}, i, { _archived: true, _archivedAt: _now(), st: 0 });
        });
      }, 'inventory:delete:soft');

      if (window.StorageAdapter && typeof window.StorageAdapter.schedule === 'function') {
        try {
          var _p = (typeof window._erpGetProviders === 'function')
            ? window._erpGetProviders()
            : { inventory: function () { return ERP.state.selectors.inventory(); } };
          window.StorageAdapter.schedule(_p);
        } catch (_e) {}
      }
      _persistInventoryWithRetry(3).catch(function () {  });
      return { ok: true };
    },

    search: function (query) { _invUI.search(query); },

    addBatch: function (opts) {
      if (!opts || typeof opts !== 'object')
        return { ok: false, error: 'addBatch: opts required.' };
      var bc  = (opts.bc  || '').trim();
      var qty = Number(opts.qty);
      var cpu = Number(opts.costPerUnit);
      if (!bc  || bc.length < 2)   return { ok: false, error: 'addBatch: barcode required.' };
      if (!qty || qty <= 0)        return { ok: false, error: 'addBatch: qty must be > 0.' };
      if (isNaN(cpu) || cpu < 0)   return { ok: false, error: 'addBatch: costPerUnit must be >= 0.' };

      var _ref = opts.ref || opts.purchaseRef || '';
      if (_ref) {
        var _existing = ERP.state.selectors.stockBatches ? ERP.state.selectors.stockBatches() : [];
        var _dupBatch = _existing.find(function(b) { return b.purchaseRef === _ref && b.bc === bc; });
        if (_dupBatch) {
          var _qtyMismatch  = Math.abs(_num(_dupBatch.qty, 0) - qty) > 0.0001;
          var _costMismatch = Math.abs(_num(_dupBatch.costPerUnit, 0) - cpu) > 0.0001;
          if (_qtyMismatch || _costMismatch) {
            _logger().error('[Inventory.addBatch] duplicate purchaseRef "' + _ref + '" for barcode "' + bc +
              '" was resubmitted with DIFFERENT qty/cost (existing qty=' + _dupBatch.qty + ' cpu=' + _dupBatch.costPerUnit +
              ' vs new qty=' + qty + ' cpu=' + cpu + ') — rejecting to avoid masking a real data discrepancy.');
            return { ok: false, error: 'A batch for ref "' + _ref + '" already exists with different qty/cost. Use a new reference or correct the existing batch instead of resubmitting.' };
          }
          return { ok: true, duplicate: true };
        }
      }

      var existingItem = ERP.state.selectors.inventory().find(function (i) { return i.bc === bc; });
      if (!existingItem) return { ok: false, error: 'addBatch: item not found: ' + bc };

      _setState(function (s) {
        s.data.stockBatches = s.data.stockBatches || [];
        s.data.stockBatches.push({
          id:          _uid(),
          bc:          bc,
          qty:         qty,
          remaining:   qty,
          costPerUnit: cpu,
          purchaseRef: opts.ref   || opts.purchaseRef || '',
          note:        opts.note  || '',
          createdAt:   _now()
        });
      }, 'inventory:addBatch');

      var meta = {
        sourceModule: opts.sourceModule || (opts.purchaseRef ? 'purchase' : 'inventory'),
        documentId:   opts.ref || opts.purchaseRef || ('BATCH-' + bc + '-' + _uid()),
        actor:        _resolveActor(opts.actor),
        skipGLBridge:  opts.skipGLBridge || false
      };
      InventoryService.receive([{
        barcode:       bc,
        qty:           qty,
        unitCostPaisa: Math.round(cpu * 100)
      }], meta);

      return { ok: true };
    },

    deductStock: function (items) {
      if (!Array.isArray(items) || items.length === 0)
        return { ok: false, error: 'deductStock: items array required.' };

      var entries = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var bc = it.bc || it.barcode || '';
        if (!bc) { console.warn('[deductStock] no barcode for item:', it.n || '?'); continue; }
        var _macCost = _MAC ? _MAC.getMAC(bc) : 0;
        entries.push({ barcode: bc, qty: _num(it.qty || it.q, 0), unitCostPaisa: Math.round((_macCost || 0) * 100) });
      }

      var meta = {
        sourceModule: 'deductStock',
        documentId:   'DEDUCT-' + _uid(),
        actor:        _resolveActor()
      };
      return InventoryService.deduct(entries, meta);
    },

    restoreStock: function (items) {
      if (!Array.isArray(items) || items.length === 0)
        return { ok: false, error: 'restoreStock: items array required.' };

      var entries = [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var safeQty = Math.max(0, parseFloat(it.qty) || 0);
        if (!safeQty) continue;
        var bc = it.bc || it.barcode || '';
        if (!bc) continue;
        var _macCostR = _MAC ? _MAC.getMAC(bc) : 0;
        entries.push({ barcode: bc, qty: safeQty, unitCostPaisa: Math.round((_macCostR || 0) * 100) });
      }

      if (!entries.length) return { ok: true };

      var meta = {
        sourceModule: 'restoreStock',
        documentId:   'RESTORE-' + _uid(),
        actor:        _resolveActor()
      };
      return InventoryService.restore(entries, meta);
    },

    canSell: function (bc, qty) {
      return InventoryService.canSell(bc, qty);
    }
  };

  var _invUI = {

    readForm: function () {
      function _v(id) { var el = document.getElementById(id); return el ? el.value : ''; }
      function _n(id) { return parseFloat(_v(id)) || 0; }
      var cat = _v('if-cat').trim();
      if (!cat) cat = 'Other';
      return {
        n    : _v('if-name').trim(),
        bc   : _v('if-bc').trim(),
        sku  : _v('if-sku').trim(),
        cat  : cat,
        sp   : _n('if-sp'),
        pp   : _n('if-pp'),
        st   : _n('if-st'),
        minSt: _n('if-minSt'),
        unit : _v('if-unit'),
        mrp  : _n('if-mrp'),
        tax  : _n('if-tax'),
        hsn  : _v('if-hsn').trim(),
        loc  : _v('if-loc').trim(),
        serial: _v('if-serial').trim(),
        desc : _v('if-desc').trim(),
        image: null
      };
    },

    readSaveMode: function () {
      var btn = document.getElementById('_inv-save-btn') || document.getElementById('inv-save-btn');
      return btn ? (btn.getAttribute('data-mode') || 'add') : 'add';
    },

    _page:     1,
    _filtered: null,
    _sTimer:   null,
    _pendingDel: null,
    _pendingDelTimer: null,
    _delegationBound: false,
    _dlStamp:  null,
    _catsCache: null,
    _sortCol:  null,
    _sortDir:  'asc',

    _PAGE: 20,
    _CATS_DEFAULT: ['Engine Parts','Brakes','Electrical','Filters','Body Parts',
                    'Tyres','Lubricants','Tools','Accessories','Services','Other'],
    _UNITS: ['PCS','KG','LITRE','METER','BOX','DOZEN','PAIR','SET',
             'BAG','BOTTLE','GRAM','TON','FOOT','INCH','SQ.FT','SQ.MTR'],

    _e: function (s) { return _escapeHtml(s); },
    _inv: function () { return ERP.state.selectors.inventory().filter(function (i) { return !i._archived; }); },
    _sets: function () { return _settings(); },

    _allCats: function () {
      var inv   = this._inv();
      var rev   = _stateRev();
      var stamp = rev + '|' + inv.length;
      if (this._catsCache && this._catsCache.stamp === stamp) return this._catsCache.val;
      var defs   = this._CATS_DEFAULT;
      var custom = [];
      inv.forEach(function (p) {
        var c = (p.cat || '').trim();
        if (c && defs.indexOf(c) === -1 && custom.indexOf(c) === -1) custom.push(c);
      });
      var val = defs.concat(custom.sort());
      this._catsCache = { stamp: stamp, val: val };
      return val;
    },

    _genBC: function () {
      var self = this;
      for (var attempt = 0; attempt < 20; attempt++) {
        var candidate = 'ERP-' + Date.now().toString(36).toUpperCase()
          + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
        if (!ERP._invService.barcodeExists(candidate)) return candidate;
      }

      return 'ERP-' + _uid().toUpperCase();
    },

    _applySort: function (arr) {
      var self = this;
      if (!self._sortCol) return arr;
      var col = self._sortCol;
      var dir = self._sortDir === 'desc' ? -1 : 1;
      var numericCols = { st: true, sp: true, pp: true, minSt: true };
      return arr.slice().sort(function (a, b) {
        var av = a[col], bv = b[col];
        if (numericCols[col]) {
          av = parseFloat(av) || 0;
          bv = parseFloat(bv) || 0;
          return dir * (av - bv);
        }
        av = (av || '').toString().toLowerCase();
        bv = (bv || '').toString().toLowerCase();
        return dir * av.localeCompare(bv);
      });
    },

    sortBy: function (col) {
      var self = this;
      if (self._sortCol === col) {
        self._sortDir = self._sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        self._sortCol = col;
        self._sortDir = 'asc';
      }
      var base = self._filtered !== null ? self._filtered : self._inv();
      self.render(self._applySort(base));
    },

    _stockBadge: function (p) {
      var st  = p.st  || 0;
      var min = p.minSt || 5;
      if (st <= 0)    return ['b-red',    'Out of Stock'];
      if (st <= min)  return ['b-orange', 'Low Stock'];
      return ['b-green', 'In Stock'];
    },

    _txt: function (id, val) {
      var el = document.getElementById(id);
      if (el) el.textContent = val;
    },

    _row: function (p) {
      var _e   = this._e.bind(this);
      var sb   = this._stockBadge(p);
      var today = _today();
      var expBadge = '';
      if (p.expiry) {
        expBadge = p.expiry < today
          ? '<span class="badge b-red" style="margin-right:4px">EXPIRED</span>'
          : '<span class="badge b-orange" style="margin-right:4px">EXP:' + _e(p.expiry) + '</span>';
      }
      var safeBC = _e(p.bc || '');
      return '<tr>'
        + '<td style="width:40px">'
          + (p.image && /^(https?:\/\/|\.?\/|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(p.image)
            ? '<img src="' + _e(p.image) + '" style="width:36px;height:36px;border-radius:6px;object-fit:cover;border:1px solid var(--border)">'
            : '<div style="width:36px;height:36px;border-radius:6px;background:var(--bg);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:16px">📦</div>')
        + '</td>'
        + '<td><div style="font-weight:600;font-size:13px">' + expBadge + _e(p.n || '') + '</div>'
          + (p.serial ? '<div style="font-size:10px;color:var(--muted)">S/N: ' + _e(p.serial) + '</div>' : '')
        + '</td>'
        + '<td><span style="font-family:var(--font-mono);font-size:11px;background:var(--bg);padding:2px 8px;border-radius:4px;border:1px solid var(--border)">'
          + safeBC + '</span></td>'
        + '<td><span class="badge b-blue">' + _e(p.cat || 'Other') + '</span></td>'
        + '<td style="text-align:center">'
          + '<span style="font-weight:700;color:' + ((p.st || 0) <= (p.minSt || 5) ? 'var(--danger)' : 'var(--text)') + '">' + (p.st || 0) + '</span>'
          + '<small style="color:var(--muted);margin-left:3px">/ ' + (p.minSt || 5) + '</small>'
        + '</td>'
        + '<td style="font-family:var(--font-mono);color:var(--warning);font-weight:600">' + ((window.ERP && typeof window.ERP.fmt === 'function') ? window.ERP.fmt(p.sp || 0) : 'Rs.' + (p.sp || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + '</td>'
        + '<td><span class="badge ' + sb[0] + '">' + sb[1] + '</span></td>'
        + '<td>'
          + '<div style="display:flex;gap:4px">'
          + '<button class="au-btn au-btn-ghost erp-inv-act" style="height:28px;padding:0 8px;font-size:11px" data-act="edit" data-bc="' + safeBC + '" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-3px"><use href="#ic-edit"/></svg></button>'
          + '<button class="au-btn au-btn-ghost erp-inv-act" style="height:28px;padding:0 8px;font-size:11px" data-act="label" data-bc="' + safeBC + '" title="Print Label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-3px"><use href="#ic-print"/></svg></button>'
          + '<button class="au-btn erp-inv-act" style="height:28px;padding:0 8px;font-size:11px;color:var(--danger);border-color:#fee2e2" data-act="del" data-bc="' + safeBC + '" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-3px"><use href="#ic-trash"/></svg></button>'
          + '</div>'
        + '</td>'
        + '</tr>';
    },

    _renderPager: function (total, pages) {
      var el = document.getElementById('inv-pager');
      if (!el) return;
      if (pages <= 1) { el.innerHTML = ''; return; }
      var self = this;
      var btns = '';
      btns += '<button class="btn btn-ghost btn-sm" data-erp-page="' + (self._page - 1) + '"' + (self._page <= 1 ? ' disabled' : '') + '>‹ Prev</button>';
      var start = Math.max(1, self._page - 2);
      var end   = Math.min(pages, self._page + 2);
      for (var i = start; i <= end; i++) {
        btns += '<button class="btn ' + (i === self._page ? 'btn-primary' : 'btn-ghost') + ' btn-sm" data-erp-page="' + i + '">' + i + '</button>';
      }
      btns += '<button class="btn btn-ghost btn-sm" data-erp-page="' + (self._page + 1) + '"' + (self._page >= pages ? ' disabled' : '') + '>Next ›</button>';
      btns += '<span style="font-size:11px;color:var(--muted);margin-left:8px">' + total + ' items, page ' + self._page + '/' + pages + '</span>';
      el.innerHTML = btns;
    },

    _shell: function () {
      var _e      = this._e.bind(this);
      var allCats = this._allCats();
      var catOpts = allCats.map(function (c) {
        return '<option value="' + _e(c) + '">' + _e(c) + '</option>';
      }).join('');
      return ''

        + '<div id="inv-list-view">'
        +   window.renderStatCards([
              { icon:'📦', id:'inv-total',   value:0,     label:'Total Items',   color:'#4338CA', bg:'#eff6ff' },
              { icon:'⚠️', id:'inv-low-cnt', value:0,     label:'Low Stock',     color:'#d97706', bg:'#fffbeb' },
              { icon:'❌', id:'inv-out-cnt', value:0,     label:'Out of Stock',  color:'#dc2626', bg:'#fef2f2' },
              { icon:'💰', id:'inv-val',     value:'\u20a80', label:'Stock Value', color:'#16a34a', bg:'#f0fdf4' },
            ])
        +   '<div class="au-toolbar">'
        +     '<div class="au-toolbar-left">'
        +       '<div class="au-search"><svg><use href="#ic-search"/></svg><input id="inv-search" placeholder="Search name / barcode\u2026" data-erp-action="inv:search"></div>'
        +       '<select class="au-select" id="inv-cat-filter" data-erp-action="inv:filterCat"><option value="">All Categories</option>' + catOpts + '</select>'
        +       '<select class="au-select" id="inv-stock-filter" data-erp-action="inv:filterStock"><option value="">All Stock</option><option value="low">Low / Critical</option><option value="out">Out of Stock</option><option value="ok">In Stock</option></select>'
        +     '</div>'
        +     '<div class="au-toolbar-right">'
        +       '<button class="au-btn au-btn-ghost" data-erp-action="inv:exportCSV"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#ic-dl"/></svg> Export</button>'
        +       '<button class="au-btn au-btn-ghost" data-erp-action="inv:importCSV"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#ic-box"/></svg> Import</button>'
        +       '<button class="au-btn au-btn-primary" data-erp-action="inv:openAdd"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Item</button>'
        +     '</div>'
        +   '</div>'
        +   '<div class="au-panel">'
        +     '<div class="au-tbl-wrap">'
        +       '<table class="au-tbl"><thead><tr>'
        +         '<th style="width:50px"></th>'
        +         '<th style="cursor:pointer;user-select:none" onclick="ERP.inventory.sortBy(\'n\')">Item Name <span id="inv-sort-n">\u2195</span></th>'
        +         '<th>Code / Barcode</th>'
        +         '<th>Category</th>'
        +         '<th style="text-align:center;cursor:pointer;user-select:none" onclick="ERP.inventory.sortBy(\'st\')">Stock <span id="inv-sort-st">\u2195</span></th>'
        +         '<th style="cursor:pointer;user-select:none" onclick="ERP.inventory.sortBy(\'sp\')">Sale Price <span id="inv-sort-sp">\u2195</span></th>'
        +         '<th>Status</th>'
        +         '<th>Actions</th>'
        +       '</tr></thead>'
        +       '<tbody id="inv-tbody"></tbody>'
        +     '</table>'
        +     '</div>'
        +     '<div id="inv-pager" style="display:flex;gap:4px;align-items:center;padding:10px 16px;border-top:1px solid var(--border-l)"></div>'
        +   '</div>'
        + '</div>'

        + '';
    },

    _formHTML: function (item) {
      var _e      = this._e.bind(this);
      var v       = item || {};
      var allCats = this._allCats();
      var catDlOpts = allCats.map(function (c) { return '<option value="' + _e(c) + '">'; }).join('');
      var unitOpts  = this._UNITS.map(function (u) {
        return '<option value="' + u + '"' + (v.unit === u ? ' selected' : '') + '>' + u + '</option>';
      }).join('');
      var _fi = 'im-fi';
      var _lbl = 'im-lbl';
      return ''
        + '<div class="im-full"><label class="' + _lbl + '" for="if-name">Item Name <span style="color:#ef4444">*</span></label>'
        + '<input class="' + _fi + '" id="if-name" placeholder="e.g. Engine Oil Filter" value="' + _e(v.n || '') + '" required autocomplete="off"></div>'
        + '<div><label class="' + _lbl + '" for="if-bc">Barcode / Code <span style="color:#ef4444">*</span></label>'
        + '<div style="display:flex;gap:6px">'
        + '<input class="' + _fi + '" id="if-bc" placeholder="Auto-generated" value="' + _e(v.bc || '') + '">'
        + (!item ? '<button type="button" data-erp-action="inv:genBC" title="Generate" style="padding:5px 9px;border:0.5px solid #d1d5db;border-radius:6px;background:var(--bg,#f8fafc);color:#4338CA;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap">⚡ Gen</button>' : '')
        + '</div>'
        + (item ? '<small style="color:var(--muted,#64748b);font-size:10px;margin-top:3px;display:block">⚠️ Changing this re-links all stock history to the new code — only fix typos, don\u2019t reuse it for a different item.</small>' : '')
        + '</div>'
        + '<div><label class="' + _lbl + '" for="if-sku">SKU / Part No.</label>'
        + '<input class="' + _fi + '" id="if-sku" value="' + _e(v.sku || '') + '" placeholder="Optional"></div>'
        + '<div><label class="' + _lbl + '" for="if-cat">Category</label>'
        + '<input class="' + _fi + '" id="if-cat" list="inv-cat-dl" value="' + _e(v.cat || '') + '" placeholder="Engine Parts">'
        + '<datalist id="inv-cat-dl">' + catDlOpts + '</datalist></div>'
        + '<div><label class="' + _lbl + '" for="if-sp">Sale Price (Rs.) <span style="color:#ef4444">*</span></label>'
        + '<input class="' + _fi + '" id="if-sp" type="number" min="0" value="' + (v.sp || 0) + '"></div>'
        + '<div><label class="' + _lbl + '" for="if-pp">Purchase Price (Rs.)</label>'
        + '<input class="' + _fi + '" id="if-pp" type="number" min="0" value="' + (v.pp || 0) + '"></div>'
        + '<div>'
        + (item
            ? '<label class="' + _lbl + '" for="if-st" style="display:flex;align-items:center;gap:6px">Current Stock <span style="font-size:9px;background:var(--bg,#f1f5f9);color:var(--muted,#64748b);padding:1px 5px;border-radius:3px;font-weight:600;text-transform:none;letter-spacing:0">Read-Only</span></label>'
              + '<input class="' + _fi + '" id="if-st" type="number" value="' + (v.st || 0) + '" readonly title="Stock changes via sales &amp; purchases only.">'
              + '<small style="color:var(--muted,#64748b);font-size:10px;margin-top:3px;display:block">🔒 Updates via Sales &amp; Purchases only</small>'
              + (_isAdmin(_resolveActor())
                  ? '<button type="button" data-erp-action="inv:correctStock" data-bc="' + _e(item.bc) + '" title="Manually correct stock after a system error or data corruption — posts an audited adjustment, not a silent edit" style="margin-top:6px;padding:4px 9px;border:0.5px solid #d1d5db;border-radius:6px;background:var(--bg,#f8fafc);color:#b45309;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap">🛠️ Correct Stock (Admin)</button>'
                  : '')
            : '<label class="' + _lbl + '" for="if-st">Opening Stock</label>'
              + '<input class="' + _fi + '" id="if-st" type="number" value="' + (v.st || 0) + '">'
          )
        + '</div>'
        + '<div><label class="' + _lbl + '" for="if-minSt">Min Stock Alert</label>'
        + '<input class="' + _fi + '" id="if-minSt" type="number" min="0" value="' + (v.minSt || 5) + '"></div>'
        + '<div><label class="' + _lbl + '" for="if-unit">Unit</label>'
        + '<select class="' + _fi + '" id="if-unit">' + unitOpts + '</select></div>'
        + '<div><label class="' + _lbl + '" for="if-mrp">MRP (Rs.)</label>'
        + '<input class="' + _fi + '" id="if-mrp" type="number" min="0" value="' + (v.mrp || 0) + '"></div>'
        + '<div><label class="' + _lbl + '" for="if-tax">Tax %</label>'
        + '<input class="' + _fi + '" id="if-tax" type="number" min="0" max="100" value="' + (v.tax || 0) + '"></div>'
        + '<div><label class="' + _lbl + '" for="if-hsn">HSN Code</label>'
        + '<input class="' + _fi + '" id="if-hsn" value="' + _e(v.hsn || '') + '" placeholder="6-digit HSN"></div>'
        + '<div><label class="' + _lbl + '" for="if-loc">Location / Rack</label>'
        + '<input class="' + _fi + '" id="if-loc" value="' + _e(v.loc || '') + '" placeholder="e.g. A-12"></div>'
        + '<div><label class="' + _lbl + '" for="if-serial">Serial / Batch No.</label>'
        + '<input class="' + _fi + '" id="if-serial" value="' + _e(v.serial || '') + '" placeholder="Optional"></div>'
        + '<div class="im-full"><label class="' + _lbl + '" for="if-desc">Description</label>'
        + '<input class="' + _fi + '" id="if-desc" value="' + _e(v.desc || '') + '" placeholder="Optional"></div>'
        + '';
    },

    _attachDelegation: function () {
      if (this._delegationBound) return;
      this._delegationBound = true;
      var self = this;
      var pv   = document.getElementById('pv-inventory');
      if (!pv) return;

      pv.addEventListener('click', function (e) {
        var btn = e.target.closest('.erp-inv-act');
        if (btn) {
          var bc  = btn.getAttribute('data-bc');
          var act = btn.getAttribute('data-act');
          if (bc && act) {
            if (act === 'edit')  self.openEdit(bc);
            if (act === 'label') self.printLabel(bc);
            if (act === 'del')   self.del(bc);
          }
          return;
        }

        var pgBtn = e.target.closest('[data-erp-page]');
        if (pgBtn) {
          var p = parseInt(pgBtn.getAttribute('data-erp-page'), 10);
          if (!isNaN(p)) self.setPage(p);
          return;
        }

        var el = e.target.closest('[data-erp-action]');
        if (el) {
          var a = el.getAttribute('data-erp-action');
          if (a === 'inv:closeModal')  { self.closeModal();  return; }
          if (a === 'inv:genBC')       { self.genBC();       return; }
          if (a === 'inv:exportCSV')   { self.exportCSV();   return; }
          if (a === 'inv:openAdd')     { self.openAdd();     return; }
          if (a === 'inv:importCSV')   { self.importCSV();   return; }
        }

});

      pv.addEventListener('change', function (e) {
        var el = e.target.closest('[data-erp-action]');
        if (!el) return;
        var a = el.getAttribute('data-erp-action');
        if (a === 'inv:filterCat')   self.filterCat(el.value);
        if (a === 'inv:filterStock') self.filterStock(el.value);
      });

      pv.addEventListener('input', function (e) {
        var el = e.target.closest('[data-erp-action]');
        if (!el) return;
        if (el.getAttribute('data-erp-action') === 'inv:search') self.search(el.value);
      });
    },

    render: function (list) {
      var self = this;
      var pv   = document.getElementById('pv-inventory');
      if (!pv) return;

      if (!document.getElementById('inv-tbody')) {
        pv.innerHTML = self._shell();
        self._attachDelegation();
      }

      var _e      = self._e.bind(self);
      var fullInv = self._inv();
      var all     = list !== undefined ? list : (self._filtered !== null ? self._filtered : fullInv);
      var total   = all.length;
      var pages   = Math.max(1, Math.ceil(total / self._PAGE));
      self._page  = Math.min(self._page, pages);
      var slice   = all.slice((self._page - 1) * self._PAGE, self._page * self._PAGE);

      self._txt('inv-total',   fullInv.length);
      self._txt('inv-low-cnt', fullInv.filter(function (p) { return (p.st || 0) > 0 && (p.st || 0) <= (p.minSt || 5); }).length);
      self._txt('inv-out-cnt', fullInv.filter(function (p) { return (p.st || 0) <= 0; }).length);
      var _vf  = (window.ERP && ERP.InventoryService && typeof ERP.InventoryService.getValuationFull === 'function') ? ERP.InventoryService.getValuationFull() : null;
      var val  = _vf ? (_vf.totalPaisa / 100) : fullInv.reduce(function (a, p) { return a + (p.st || 0) * (p.pp || 0); }, 0);
      // FIX (root cause, audit #75): the >=100000 "lakh" shorthand branch is a
      // deliberate, distinct display convention (not something ERP.fmt() does)
      // -- left untouched. Only the standard-formatting branch was a hardcoded
      // 'Rs.' duplicate of ERP.fmt(), migrated here.
      self._txt('inv-val', val >= 100000 ? 'Rs.' + (val / 100000).toFixed(1) + 'L' : ((window.ERP && typeof window.ERP.fmt === 'function') ? window.ERP.fmt(val) : 'Rs.' + val.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })));

      var tbody = document.getElementById('inv-tbody');
      if (tbody) {
        tbody.innerHTML = slice.length
          ? slice.map(function (p) { return self._row(p); }).join('')
          : '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--muted)">'
            + '<div style="font-size:28px;margin-bottom:8px">📦</div>'
            + '<div style="font-weight:600">No items found</div>'
            + '<div style="font-size:11px;margin-top:4px">Try clearing the search or filter</div>'
            + '</td></tr>';
      }

      var catFilter = document.getElementById('inv-cat-filter');
      var iDl       = document.getElementById('inv-datalist');
      var rev       = _stateRev();
      var dlStamp   = rev + '|' + fullInv.length;
      if (dlStamp !== self._dlStamp) {
        self._dlStamp = dlStamp;
        var allCats = self._allCats();
        if (catFilter) {
          var cur  = catFilter.value;
          var opts = '<option value="">All Categories</option>';
          allCats.forEach(function (c) {
            opts += '<option value="' + _e(c) + '"' + (cur === c ? ' selected' : '') + '>' + _e(c) + '</option>';
          });
          catFilter.innerHTML = opts;
        }
        if (iDl) {
          iDl.innerHTML = fullInv.map(function (p) {
            var stk = (p.st || 0) <= 0 ? '❌ OUT' : '📦 ' + p.st;
            return '<option value="' + _e(p.n || '') + '" data-bc="' + _e(p.bc || '') + '" data-price="' + (p.sp || 0) + '" data-cost="' + (p.pp || 0) + '" data-stock="' + (p.st || 0) + '">'
              + stk + ' | ' + ((window.ERP && typeof window.ERP.fmt === 'function') ? window.ERP.fmt(p.sp || 0) : 'Rs.' + (p.sp || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + ' | ' + _e(p.cat || '') + '</option>';
          }).join('');
        }
      }

      self._renderPager(total, pages);
    },

    _showFormPage: function (item, mode) {
      var self = this;

      var _stale = document.getElementById('invItemModal');
      if (_stale) _stale.remove();

      var isEdit   = !!item;
      var title    = isEdit ? ('Edit Item: ' + this._e(item.n || '')) : 'Add New Item';
      var subtitle = isEdit ? 'Update item details below' : 'Fill in item details to add to inventory';

      var overlay = document.createElement('div');
      overlay.id = 'invItemModal';
      overlay.style.cssText = 'display:flex;position:fixed;inset:0;z-index:var(--zi-modal-bg,1000);background:rgba(0,0,0,.45);align-items:flex-start;justify-content:center;overflow-y:auto;padding:16px 0';

      overlay.innerHTML =
        '<style>' +
          '#invItemModal .im-lbl{font-size:10px;font-weight:600;color:var(--muted,#6b7280);text-transform:uppercase;letter-spacing:.45px;display:block;margin-bottom:3px}' +
          '#invItemModal .im-sec{font-size:10px;font-weight:600;color:var(--muted,#6b7280);text-transform:uppercase;letter-spacing:.55px;padding:7px 16px;background:var(--hover,#f8f9fa);border-top:0.5px solid var(--border,#e5e7eb);border-bottom:0.5px solid var(--border,#e5e7eb);display:flex;align-items:center;gap:6px}' +
          '#invItemModal .im-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;padding:14px 16px}' +
          '#invItemModal .im-full{grid-column:1/-1}' +
          '@media(max-width:640px){#invItemModal .im-grid{grid-template-columns:1fr 1fr!important}}' +
        '</style>' +

        '<div style="background:var(--white,#fff);border-radius:10px;width:98vw;max-width:900px;margin:auto;overflow:hidden;border:0.5px solid #e5e7eb">' +

          '<div style="background:#4338CA;padding:12px 16px;display:flex;align-items:center;justify-content:space-between">' +
            '<div style="display:flex;align-items:center;gap:10px">' +
              '<div style="width:32px;height:32px;border-radius:7px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:17px;height:17px;color:#fff"><path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
              '</div>' +
              '<div>' +
                '<div style="color:#fff;font-size:14px;font-weight:600">' + title + '</div>' +
                '<div style="color:rgba(255,255,255,.7);font-size:11px">' + subtitle + '</div>' +
              '</div>' +
            '</div>' +
            '<button id="_inv-close-btn" style="width:30px;height:30px;border-radius:7px;border:0.5px solid rgba(255,255,255,.3);background:rgba(255,255,255,.12);color:#fff;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</button>' +
          '</div>' +

          '<div class="im-sec"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/></svg> Basic Information</div>' +
          '<div class="im-grid" id="inv-form-body"></div>' +

          '<div style="padding:11px 16px;display:flex;justify-content:flex-end;gap:8px;background:var(--bg);border-top:0.5px solid #e5e7eb">' +
            '<button id="_inv-cancel-btn" style="padding:8px 16px;border-radius:7px;border:0.5px solid #d1d5db;background:var(--white,#fff);color:#374151;font-weight:500;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:5px">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Cancel' +
            '</button>' +
            (isEdit ? '' :
            '<button id="_inv-save-another-btn" style="padding:8px 16px;border-radius:7px;border:0.5px solid #d1d5db;background:var(--white,#fff);color:#374151;font-weight:500;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:5px">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><use href="#ic-plus"/></svg> Save &amp; Add Another' +
            '</button>') +
            '<button id="_inv-save-btn" data-mode="' + mode + '" style="padding:8px 20px;border-radius:7px;border:none;background:#4338CA;color:#fff;font-weight:600;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:5px">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><polyline points="20 6 9 17 4 12"/></svg> ' + (isEdit ? 'Update Item' : 'Save Item') +
            '</button>' +
          '</div>' +

        '</div>';

      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';

      var body = overlay.querySelector('#inv-form-body');
      if (body) body.innerHTML = self._formHTML(item);

      var closeModal = function () {
        overlay.remove();
        document.body.style.overflow = '';
        try { if (ERP.events && ERP.events.emit) ERP.events.emit('inventory:modalClosed'); } catch (_) {}
      };
      var closeBtn   = overlay.querySelector('#_inv-close-btn');
      var cancelBtn  = overlay.querySelector('#_inv-cancel-btn');
      if (closeBtn)  closeBtn.addEventListener('click', closeModal);
      if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });

      overlay.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && document.querySelectorAll('#invItemModal').length === 1) {
          closeModal();
        }
      });

      var saveBtn = overlay.querySelector('#_inv-save-btn');
      if (saveBtn) {
        saveBtn.addEventListener('click', function () {
          if (ERP._invActions && ERP._invActions.saveFromForm) ERP._invActions.saveFromForm(false);
        });
      }
      var saveAnotherBtn = overlay.querySelector('#_inv-save-another-btn');
      if (saveAnotherBtn) {
        saveAnotherBtn.addEventListener('click', function () {
          if (ERP._invActions && ERP._invActions.saveFromForm) ERP._invActions.saveFromForm(true);
        });
      }

      overlay.addEventListener('click', function (e) {
        var el = e.target.closest('[data-erp-action]');
        if (!el) return;
        var act = el.getAttribute('data-erp-action');
        if (act === 'inv:genBC') { self.genBC(); }
        if (act === 'inv:correctStock') { self.correctStockPrompt(el.getAttribute('data-bc')); }
      });

      if (!item) self.genBC();

      setTimeout(function () {
        var f = overlay.querySelector('#if-name');
        if (f) f.focus();
      }, 50);
    },

    openAdd: function () {
      this._showFormPage(null, 'add');
    },

    openEdit: function (bc) {
      var item = _invService.findByBarcode(bc);
      if (!item) { _toast('Item not found: ' + bc, 'error'); return; }
      this._showFormPage(item, 'edit:' + bc);
    },

    closeModal: function () {
      var overlay = document.getElementById('invItemModal');
      if (overlay) overlay.remove();
      document.body.style.overflow = '';
      try {
        if (ERP.events && ERP.events.emit) ERP.events.emit('inventory:modalClosed');
      } catch (_) {}
    },

    genBC: function () {
      var el = document.getElementById('if-bc');
      if (el && !el.readOnly) el.value = this._genBC();
    },

    correctStockPrompt: function (bc) {
      var item = _invService.findByBarcode(bc);
      if (!item) { _toast('Item not found: ' + bc, 'error'); return; }

      var actor = _resolveActor();
      if (!_isAdmin(actor)) { _toast('Admin role required to correct stock.', 'error'); return; }

      var currentQty = ERP.InventoryService.getBalance(item.bc);
      var input = window.prompt(
        'Correct Stock — "' + item.n + '"\nCurrent system stock: ' + currentQty +
        '\nEnter the correct stock quantity (this posts an audited adjustment):',
        String(currentQty)
      );
      if (input === null) return;

      var target = parseFloat(input);
      if (isNaN(target) || !isFinite(target)) { _toast('Enter a valid number.', 'error'); return; }

      var delta = _round2(target - currentQty);
      if (delta === 0) { _toast('No change — stock is already ' + currentQty + '.', 'info'); return; }

      var direction = delta > 0 ? 'increase' : 'decrease';
      var qty = Math.abs(delta);
      var cpu = (ERP.InventoryService.getAvgCost ? ERP.InventoryService.getAvgCost(item.bc) : 0) || _num(item.pp, 0);

      var meta = {
        sourceModule: 'admin_adjustment',
        documentId:   'STOCKFIX-' + item.bc + '-' + _uid(),
        actor:        actor
      };

      var result = ERP.InventoryService.adjust([{
        barcode:       item.bc,
        qty:           qty,
        unitCostPaisa: Math.round(cpu * 100),
        direction:     direction
      }], meta);

      if (!result || !result.ok) {
        _toast('Stock correction failed: ' + ((result && result.error) || 'unknown error'), 'error');
        return;
      }

      _toast('Stock corrected: ' + item.n + ' → ' + target + ' (was ' + currentQty + ').', 'info');
      ERP.events.emit(ERP.events.NAMES.INVENTORY_UPDATED);
      _persistInventory();
      this.closeModal();
    },

    search: function (q) {
      var self = this;
      clearTimeout(self._sTimer);
      self._sTimer = setTimeout(function () {
        var lq = (q || '').toLowerCase().trim();
        if (!lq) { self._filtered = null; self._page = 1; self.render(self._applySort(self._inv())); return; }
        self._filtered = self._inv().filter(function (p) {
          return (p.n    || '').toLowerCase().indexOf(lq) !== -1
              || (p.bc   || '').toLowerCase().indexOf(lq) !== -1
              || (p.sku  || '').toLowerCase().indexOf(lq) !== -1
              || (p.cat  || '').toLowerCase().indexOf(lq) !== -1
              || (p.hsn  || '').toLowerCase().indexOf(lq) !== -1
              || (p.loc  || '').toLowerCase().indexOf(lq) !== -1
              || (p.desc || '').toLowerCase().indexOf(lq) !== -1;
        });
        self._page = 1;
        self.render(self._applySort(self._filtered));
      }, 200);
    },

    filterCat: function (cat) {
      var lc = (cat || '').toLowerCase();
      this._filtered = !cat ? null : this._inv().filter(function (p) {
        return (p.cat || '').toLowerCase() === lc;
      });
      this._page = 1;
      this.render(this._applySort(this._filtered || this._inv()));
    },

    filterStock: function (type) {
      if (!type) { this._filtered = null; this._page = 1; this.render(this._applySort(this._inv())); return; }
      this._filtered = this._inv().filter(function (p) {
        if (type === 'out') return (p.st || 0) <= 0;
        if (type === 'low') return (p.st || 0) > 0 && (p.st || 0) <= (p.minSt || 5);
        if (type === 'ok')  return (p.st || 0) > (p.minSt || 5);
        return true;
      });
      this._page = 1;
      this.render(this._applySort(this._filtered));
    },

    setPage: function (p) {
      var base   = this._filtered !== null ? this._filtered : this._inv();
      var sorted = this._applySort(base);
      var pages  = Math.max(1, Math.ceil(sorted.length / this._PAGE));
      this._page = Math.max(1, Math.min(p, pages));
      this.render(sorted);
    },

    exportCSV: function () {
      var rows = [['Name', 'Barcode', 'Category', 'Sale Price', 'Cost Price', 'Stock', 'Min Stock', 'Unit', 'HSN', 'Location']];
      this._inv().forEach(function (p) {
        rows.push([p.n || '', p.bc || '', p.cat || '', p.sp || 0, p.pp || 0, p.st || 0, p.minSt || 5, p.unit || '', p.hsn || '', p.loc || '']);
      });
      var csv = rows.map(function (r) {

        return r.map(function (v) {
          var escaped = String(v).replace(/"/g, '""');
          return '"' + escaped + '"';
        }).join(',');
      }).join('\n');
      var a   = document.createElement('a');
      a.href  = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      a.download = 'inventory-' + Date.now() + '.csv';
      a.click();
      _toast('Inventory exported ✅', 'success');
    },

    downloadTemplate: function () {
      var header = ['Name', 'Barcode', 'Category', 'Sale Price', 'Cost Price',
                    'Stock', 'Min Stock', 'Unit', 'HSN', 'Location'];
      var sample = ['Engine Oil Filter', 'ENG-001', 'Engine Parts', '450', '280',
                    '10', '5', 'pcs', '841329', 'A-12'];
      var csv = [header, sample].map(function (r) {
        return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
      }).join('\n');
      var a  = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      a.download = 'inventory-template.csv';
      a.click();
      _toast('Template downloaded — fill it and use Import ✅', 'success');
    },

    importCSV: function () {
      var self = this;
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv,text/csv';
      input.style.display = 'none';
      document.body.appendChild(input);

      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        input.remove();
        if (!file) return;

        var reader = new FileReader();
        reader.onload = function (ev) {
          try {
            var lines  = (ev.target.result || '').split(/\r?\n/).filter(Boolean);
            if (lines.length < 2) { _toast('CSV is empty or has only headers', 'error'); return; }

            function parseRow(line) {
              var result = [], cur = '', inQ = false;
              for (var i = 0; i < line.length; i++) {
                var ch = line[i];
                if (ch === '"') {
                  if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
                  else inQ = !inQ;
                } else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
                else cur += ch;
              }
              result.push(cur.trim());
              return result;
            }

            var headers = parseRow(lines[0]).map(function (h) { return h.toLowerCase().replace(/\s+/g, ''); });
            var col = function (name) { return headers.indexOf(name); };
            var nIdx   = col('name'),      bcIdx  = col('barcode'),   catIdx = col('category');
            var spIdx  = col('saleprice'), ppIdx  = col('costprice'), stIdx  = col('stock');
            var minIdx = col('minstock'),  unitIdx= col('unit'),      hsnIdx = col('hsn'), locIdx = col('location');

            if (nIdx === -1) { _toast('CSV must have a "Name" column', 'error'); return; }

            var added = 0, skipped = 0, errors = [];
            var existing = self._inv();
            var seenNames = {};
            var seenBarcodes = {};
            existing.forEach(function (p) {
              if (p.n) seenNames[(p.n || '').toLowerCase()] = true;
              if (p.bc) seenBarcodes[(p.bc || '').toLowerCase()] = true;
            });

            lines.slice(1).forEach(function (line, rowNum) {
              if (!line.trim()) return;
              var r    = parseRow(line);
              var name = r[nIdx] || '';
              if (!name) { skipped++; return; }

              var importedBC = (r[bcIdx] || '').trim();
              var nameKey = name.toLowerCase();
              var bcKey   = importedBC.toLowerCase();

              if (seenNames[nameKey]) {
                skipped++; return;
              }
              if (importedBC && seenBarcodes[bcKey]) {
                skipped++; return;
              }

              var item = {
                n:     name,
                bc:    importedBC || ('IMP-' + Date.now() + '-' + rowNum + '-' + Math.random().toString(36).slice(2, 7)),
                cat:   r[catIdx] || '',
                sp:    parseFloat(r[spIdx])  || 0,
                pp:    parseFloat(r[ppIdx])  || 0,
                st:    parseFloat(r[stIdx])  || 0,
                minSt: parseFloat(r[minIdx]) || 5,
                unit:  r[unitIdx] || 'pcs',
                hsn:   r[hsnIdx]  || '',
                loc:   r[locIdx]  || ''
              };

              try {
                var saveResult = _invService.save(item, false, 'add');
                if (saveResult && saveResult.ok) {
                  added++;
                  seenNames[nameKey] = true;
                  seenBarcodes[item.bc.toLowerCase()] = true;
                }
                else errors.push('Row ' + (rowNum + 2) + ': ' + ((saveResult && saveResult.error) || 'save failed'));
              }
              catch (e) { errors.push('Row ' + (rowNum + 2) + ': ' + (e && e.message || e)); }
            });

            if (errors.length) console.warn('[inv:importCSV] Errors:', errors);
            _persistInventoryWithRetry(2)
              .catch(function (e) { console.warn('[inv:importCSV] persist failed after retries', e); });
            self.render();
            _toast('✅ Import complete — ' + added + ' added, ' + skipped + ' skipped'
                   + (errors.length ? ', ' + errors.length + ' errors (see console)' : ''), 'success', 5000);
          } catch (err) {
            _toast('CSV parse failed: ' + (err && err.message || err), 'error');
          }
        };
        reader.readAsText(file);
      });

      input.click();
    },

    _code39Svg: function (text) {

      var BAR_WEIGHT_TO_POSITIONS = {
        1: [0, 4], 2: [1, 4], 3: [0, 1], 4: [2, 4], 5: [0, 2],
        6: [1, 2], 7: [3, 4], 8: [0, 3], 9: [1, 3], 10: [2, 3]
      };

      var GROUP_SPACE_INDEX = { 0: 1, 10: 2, 20: 3, 30: 0 };

      function charSpec(ch) {
        if (ch >= '1' && ch <= '9') return { group: 0,  num: ch.charCodeAt(0) - '0'.charCodeAt(0) };
        if (ch === '0')              return { group: 0,  num: 10 };
        if (ch >= 'A' && ch <= 'J')  return { group: 10, num: ch.charCodeAt(0) - 'A'.charCodeAt(0) + 1 };
        if (ch >= 'K' && ch <= 'T')  return { group: 20, num: ch.charCodeAt(0) - 'K'.charCodeAt(0) + 1 };
        if (ch >= 'U' && ch <= 'Z')  return { group: 30, num: ch.charCodeAt(0) - 'U'.charCodeAt(0) + 1 };
        if (ch === '-')               return { group: 30, num: 7 };
        if (ch === '.')               return { group: 30, num: 8 };
        if (ch === ' ')               return { group: 30, num: 9 };
        if (ch === '*')               return { group: 30, num: 10 };
        return null;
      }

      function elementsFor(ch) {
        var spec = charSpec(ch) || charSpec('*');
        var bars = [0, 0, 0, 0, 0];
        var widePositions = BAR_WEIGHT_TO_POSITIONS[spec.num];
        bars[widePositions[0]] = 1;
        bars[widePositions[1]] = 1;
        var spaces = [0, 0, 0, 0];
        spaces[GROUP_SPACE_INDEX[spec.group]] = 1;

        return [bars[0], spaces[0], bars[1], spaces[1], bars[2], spaces[2], bars[3], spaces[3], bars[4]];
      }

      var clean = String(text || '').toUpperCase().replace(/[^0-9A-Z\-\. ]/g, '');
      var chars = ('*' + clean + '*').split('');
      var unit = 2;
      var x = 0, bars = '';
      for (var i = 0; i < chars.length; i++) {
        var elements = elementsFor(chars[i]);
        for (var j = 0; j < elements.length; j++) {
          var isBar  = (j % 2 === 0);
          var w      = elements[j] ? unit * 2 : unit;
          if (isBar) bars += '<rect x="' + x + '" y="0" width="' + w + '" height="60" fill="#000"/>';
          x += w;
        }
        x += unit;
      }
      return '<svg viewBox="0 0 ' + (x + 4) + ' 60" width="100%" height="70" xmlns="http://www.w3.org/2000/svg">' + bars + '</svg>';
    },

    _labelHtml: function (p, barcodeSvg) {
      var _e = this._e.bind(this);
      return '<div class="name">' + _e(p.n) + '</div>'
        + '<div>' + barcodeSvg + '</div>'
        + '<div class="bc-text">' + _e(p.bc) + '</div>'
        + '<div class="price">' + ((window.ERP && typeof window.ERP.fmt === 'function') ? window.ERP.fmt(p.sp || 0) : 'Rs.' + (p.sp || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + '</div>'
        + '<div style="font-size:11px;color:#666">Stock: ' + (p.st || 0) + ' ' + _e(p.unit || '') + '</div>';
    },

    _labelStyle: 'body{font-family:sans-serif;padding:20px;text-align:center}'
      + '.bc-text{font-size:13px;font-weight:600;letter-spacing:2px;margin-top:4px}'
      + '.name{font-size:16px;font-weight:700}'
      + '.price{font-size:20px;font-weight:700;color:#4338CA}',

    printLabel: function (bc) {
      var self = this;
      var p = _invService.findByBarcode(bc);
      if (!p) return;
      var barcodeSvg = this._code39Svg(p.bc);

      var w = window.open('', '_blank', 'width=400,height=300');
      if (w) {
        w.document.write(
          '<html><head><title>Label</title>'
          + '<style>' + this._labelStyle + '</style></head><body>'
          + this._labelHtml(p, barcodeSvg)
          + '<script>window.print();window.close();<\/script>'
          + '</body></html>'
        );
        w.document.close();
        return;
      }

      self._printInline(p, barcodeSvg);
    },

    _printInline: function (p, barcodeSvg) {
      var styleId = '_inv-print-label-style';
      if (!document.getElementById(styleId)) {
        var style = document.createElement('style');
        style.id = styleId;
        style.textContent =
          '@media print {'
          + '  body > *:not(#_inv-print-label-region) { display: none !important; }'
          + '  #_inv-print-label-region { display: block !important; position: static !important; }'
          + '}'
          + '#_inv-print-label-region { position: fixed; top: -9999px; left: -9999px; }'
          + '#_inv-print-label-region ' + this._labelStyle.replace(/body\{/, 'div{');
        document.head.appendChild(style);
      }

      var region = document.getElementById('_inv-print-label-region');
      if (!region) {
        region = document.createElement('div');
        region.id = '_inv-print-label-region';
        document.body.appendChild(region);
      }
      region.innerHTML = this._labelHtml(p, barcodeSvg);

      _toast('Pop-up blocked — printing from this page instead. Choose "Save as PDF" in the print dialog if you don\u2019t have a label printer set up.', 'warning', 6000);

      setTimeout(function () {
        window.print();
        setTimeout(function () { if (region) region.innerHTML = ''; }, 500);
      }, 50);
    },

    del: function (bc) {
      var self = this;
      var item = _invService.findByBarcode(bc);
      if (!item) { _toast('Item not found for barcode: ' + bc + ' — page reload karein', 'error'); return; }

      if (item._archived) { _toast('Item already deleted', 'warning'); return; }

      if (self._pendingDel === bc) {

        clearTimeout(self._pendingDelTimer);
        self._pendingDel = null;
        self._pendingDelTimer = null;

        var delResult = _invService.deleteItem(bc);
        if (!delResult || !delResult.ok) {
          _toast('Delete failed: ' + ((delResult && delResult.error) || 'unknown error'), 'error');
          return;
        }

        ERP.events.emit(ERP.events.NAMES.INVENTORY_UPDATED);
        _persistInventory();
        _toast(self._e(item.n) + ' deleted.', 'info');
        self._filtered = null;
        self.render();
      } else {

        self._pendingDel = bc;
        clearTimeout(self._pendingDelTimer);
        self._pendingDelTimer = setTimeout(function () { self._pendingDel = null; }, 3000);
        _toast('⚠️ "' + self._e(item.n) + '" — click Delete again within 3s to confirm.', 'warning', 3000);
      }
    },

    allCats: function () { return this._allCats(); },
    allCategories: function () { return this._allCats(); }
  };

  var _invActions = {

    openAdd: function () {
      _safeRun(function () {
        if (!document.getElementById('inv-tbody')) _invUI.render();
        _invUI.openAdd();
      }, 'inventory.openAdd');
    },

    openEdit: function (barcode) {
      _safeRun(function () { _invUI.openEdit(barcode); }, 'inventory.openEdit');
    },

    saveItem: function (data, andAnother, mode) {
      _safeRun(function () {
        var saveMode = (mode !== undefined && mode !== null) ? mode : 'add';
        var result   = _invService.save(data, andAnother, saveMode);
        if (!result.ok) {

          if (typeof result.error === 'string' && result.error.indexOf('Barcode already') !== -1) {
            _toast(result.error, 'error');
            _invUI.genBC();
          } else {
            _toast(result.error, (typeof result.error === 'string' && result.error.indexOf('already exists') !== -1) ? 'warning' : 'error');
          }
          return;
        }
        ERP.events.emit(ERP.events.NAMES.INVENTORY_UPDATED, data);
        _persistInventory();
      }, 'inventory.saveItem');
    },

    saveFromForm: function (andAnother) {
      _safeRun(function () {
        var data = _invUI.readForm();
        var mode = _invUI.readSaveMode();
        _invActions.saveItem(data, andAnother || false, mode);
      }, 'inventory.saveFromForm');
    },

    deleteItem: function (barcode) {
      _safeRun(function () {
        var result = _invService.deleteItem(barcode);
        if (!result.ok) { _toast(result.error, 'error'); return; }
        ERP.events.emit(ERP.events.NAMES.INVENTORY_UPDATED);
        _persistInventory();
      }, 'inventory.deleteItem');
    },

    sortBy: function (col) { _invUI.sortBy(col); },

    canSell: function (barcode, qty) { return InventoryService.canSell(barcode, qty); },

    deductStock: function (items) {
      _warnDeprecatedOnce('deductStock', 'ERP.InventoryService.deduct');
      return _invService.deductStock(items);
    },

    restoreStock: function (items) {
      _warnDeprecatedOnce('restoreStock', 'ERP.InventoryService.restore');
      return _invService.restoreStock(items);
    },

    addBatch: function (batch) {
      _warnDeprecatedOnce('addBatch', 'ERP.InventoryService.receive');
      return _invService.addBatch(batch);
    },

    removeBatch: function (opts) {
      if (!opts || (!opts.bc && !opts.barcode) || !opts.qty)
        return { ok: false, error: 'removeBatch: bc and qty required.' };
      var bc  = (opts.bc || opts.barcode || '').trim();
      var qty = _num(opts.qty, 0);
      if (!bc || qty <= 0) return { ok: false, error: 'removeBatch: invalid bc or qty.' };
      var meta = {
        sourceModule: 'removeBatch',
        documentId:   opts.ref || ('RB-' + bc + '-' + _uid()),
        actor:        _resolveActor(opts.actor)
      };

      var mac = _MAC ? _MAC.getMAC(bc) : 0;
      var cost = (mac !== undefined && mac !== null && !isNaN(mac) && mac > 0) ? mac : _num(opts.pp || opts.costPerUnit || 0, 0);
      return InventoryService.deduct([{ barcode: bc, qty: qty, unitCostPaisa: Math.round(cost * 100) }], meta);
    },

    getLowStockItems:    function () { return ERP.state.derive().lowStockItems; },
    getOutOfStockItems:  function () { return ERP.state.derive().outOfStockItems; },
    getCategories:       function () { return _invUI.allCats(); },
    render:              function () { _invUI.render(); },
    search:              function (q) { _invService.search(q); }
  };

  var _Reservations = {

    reserve: function (opts) {
      try {
        var bc    = (opts.bc  || '').trim();
        var qty   = Math.max(0, Number(opts.qty)   || 0);
        var jobId = (opts.jobId || '').trim();
        if (!bc || !jobId || qty <= 0) return { ok: false, error: 'bc, jobId, qty required' };
        var total     = InventoryService.getBalance(bc);
        var reserved  = _Reservations.getReserved(bc);
        var available = total - reserved;
        if (available < qty)
          return { ok: false, error: '"' + bc + '" available stock ' + available + ', requested ' + qty, available: available };
        _setState(function (s) {
          s.data = s.data || {};
          var rsvs = JSON.parse(JSON.stringify((s.data.partReservations || {})));
          if (!rsvs[bc]) rsvs[bc] = {};
          rsvs[bc][jobId] = (rsvs[bc][jobId] || 0) + qty;
          s.data.partReservations = rsvs;
        }, 'reservations:reserve');
        return { ok: true, reserved: qty, available: available - qty };
      } catch (e) { return { ok: false, error: 'reserve: ' + e.message }; }
    },

    unreserve: function (opts) {
      try {
        var bc    = (opts.bc    || '').trim();
        var jobId = (opts.jobId || '').trim();
        if (!bc || !jobId) return { ok: false, error: 'bc and jobId required' };
        _setState(function (s) {
          s.data = s.data || {};
          var rsvs = JSON.parse(JSON.stringify((s.data.partReservations || {})));
          if (rsvs[bc]) {
            delete rsvs[bc][jobId];
            if (Object.keys(rsvs[bc]).length === 0) delete rsvs[bc];
          }
          s.data.partReservations = rsvs;
        }, 'reservations:unreserve');
        return { ok: true };
      } catch (e) { return { ok: false, error: 'unreserve: ' + e.message }; }
    },

    getReserved: function (bc) {
      try {
        var d = _getState();
        if (!d || !d.data) return 0;
        var rsvs = d.data.partReservations || {};
        var bcRsv = rsvs[(bc || '').trim()] || {};

        return Object.keys(bcRsv).reduce(function (s, k) { return s + (Number(bcRsv[k]) || 0); }, 0);
      } catch (_) { return 0; }
    },

    getAvailableStock: function (bc) {
      return Math.max(0, InventoryService.getBalance((bc || '').trim()) - _Reservations.getReserved(bc));
    }
  };

  function _bootMigration() {
    try {
      var s = _getState();
      if (!s || !s.meta) return;

      var tx = {
        txId:         _uid(),
        actor:        'System',
        startedAt:    _now(),
        sourceModule: 'boot:migration',
        documentId:   'migration-v2'
      };

      var hasSt      = _getState();
      var journal    = (hasSt && hasSt.data && hasSt.data.stockJournal) || [];
      var hasJournal = journal.length > 0;
      var hasProj    = hasSt && hasSt.data && hasSt.data.balanceProjection &&
                       Object.keys(hasSt.data.balanceProjection).length > 0;

      var needsRebuild = false;
      if (hasJournal && !hasProj) {
        needsRebuild = true;
      } else if (hasJournal && hasProj) {

        var journalSums = {};
        journal.forEach(function(mv) {

          var bc = mv.bc || mv.barcode;
          if (!bc) return;
          var delta;
          if (typeof mv.movementQty === 'number') {
            delta = mv.movementQty;
          } else {
            delta = (mv.type === 'IN' || mv.type === 'receive' || mv.type === 'OPEN' || mv.type === 'restore')
              ? _num(mv.qty, 0) : -_num(mv.qty, 0);
          }
          journalSums[bc] = (journalSums[bc] || 0) + delta;
        });
        var proj = hasSt.data.balanceProjection;
        var barcodes = Object.keys(journalSums);
        for (var _bi = 0; _bi < barcodes.length; _bi++) {
          var _bc = barcodes[_bi];
          var journalQty = Math.round(journalSums[_bc] * 1000);
          var projQty    = Math.round((_num(proj[_bc], 0)) * 1000);

          var tolerance = Math.max(1, Math.abs(journalQty) * 0.001);
          if (Math.abs(journalQty - projQty) > tolerance) {
            needsRebuild = true;
            if (window.DEBUG_MODE) console.warn('[Inventory] Projection checksum mismatch for ' + _bc +
              ': journal=' + journalSums[_bc] + ' proj=' + (proj[_bc] || 0) + ' — rebuilding...');
            break;
          }
        }
      }

      if (needsRebuild) {
        try { BalanceProjection.rebuild(tx); } catch (_) {}
      }

      if (_num(s.meta.inventoryEngineVersion, 0) < 2) {
        _setState(function (st) {
          st.meta = st.meta || {};
          st.meta.inventoryEngineVersion = 2;
        }, 'boot:migration');
      }

    } catch (_) {}
  }

  function _reconcileStockCache() {
    try {
      var drift = [];
      _setState(function (s) {
        s.data.inventory = s.data.inventory || [];
        var proj = s.data.balanceProjection || {};
        for (var i = 0; i < s.data.inventory.length; i++) {
          var it = s.data.inventory[i];
          if (!it || it._archived || !it.bc) continue;
          var trueBalance = _num(proj[it.bc], 0);
          if (_num(it.st, 0) !== trueBalance) {
            drift.push({ bc: it.bc, cached: it.st, actual: trueBalance });
            it.st = trueBalance;
          }
        }
      }, 'inventory:reconcile-cache');
      if (drift.length) {
        _logger().warn('[Inventory] reconciled ' + drift.length + ' item(s) whose cached stock had drifted from the ledger-derived balance:', drift);
        try {
          ERP.AuditLog && ERP.AuditLog.write({
            id: _uid(), actor: 'System', action: 'inventory:cache_reconciled', module: 'InventoryService',
            documentId: null, before: null, after: { drift: drift },
            timestamp: _now(), severity: 'warning'
          });
        } catch (_) {}
      }

      try {
        var s2 = _getState();
        var newChecksum = BalanceProjection.checksum();
        var prevChecksum = s2 && s2.meta && s2.meta.balanceProjectionChecksum;
        if (typeof prevChecksum === 'number' && prevChecksum !== newChecksum && !drift.length) {
          _logger().warn('[Inventory] balanceProjection checksum changed (' + prevChecksum + ' -> ' + newChecksum +
            ') without any detected per-item drift — possible unaudited write to balanceProjection.');
        }
        _setState(function (st) {
          st.meta = st.meta || {};
          st.meta.balanceProjectionChecksum = newChecksum;
        }, 'inventory:checksum-recorded');
      } catch (_csErr) {}

      return drift;
    } catch (e) { _logger().error('[Inventory._reconcileStockCache]', e.message || e); return []; }
  }

  function _boot() {
    try {
      _walCleanup();
      _bootMigration();
      _retryQueuedPersistFailures();
      _reconcileStockCache();
    } catch (e) {
      _logger().warn('[Inventory._boot]', e.message || e);
    }
  }

  if (ERP.registerRenderer && typeof ERP.registerRenderer === 'function') {
    ERP.registerRenderer('inventory', function () { _invUI.render(); });
  }

  if (typeof window !== 'undefined' && typeof window.renderInventory !== 'function') {
    window.renderInventory = function () {
      try { _invUI.render(); } catch (_) {}
    };
  }

  if (!ERP._inventoryUIListenerInstalled) {
    ERP._inventoryUIListenerInstalled = true;
    ERP.events.on(ERP.events.NAMES.INVENTORY_UPDATED, function () {

      try { window._erpInventoryCache = ERP.state.selectors.inventory(); } catch (_) {}
      var page = (_getState().ui || {}).page;
      if (page === 'inventory') _invUI.render();
    });
  }

  if (!ERP._stockLowListenerInstalled) {
    ERP._stockLowListenerInstalled = true;
    ERP.events.on(ERP.events.NAMES.STOCK_LOW, function (item) {
      if (!item) return;
      var name  = item.n  || item.name  || 'Item';
      var stock = item.st !== undefined ? item.st : '?';
      var minSt = item.minSt !== undefined ? item.minSt : '?';

      try {
        if (window.ToastManager) {
          window.ToastManager.show('warning', '⚠️ Low Stock Alert',
            '"' + name + '" — only ' + stock + ' units left (min: ' + minSt + ')', 8000);
        } else if (ERP._salesToast) {
          ERP._salesToast('⚠️ Low Stock: "' + name + '" = ' + stock + ' units (min ' + minSt + ')', 'warning', 8000);
        }
      } catch (_) {}

      try {
        var badge = document.getElementById('inv-low-badge');
        if (badge) {
          var inv   = (ERP.getState && ERP.getState().data && ERP.getState().data.inventory) || [];
          var count = inv.filter(function(p){ return (p.st || 0) > 0 && (p.st || 0) <= (p.minSt || 5); }).length;
          badge.textContent = count;
          badge.style.display = count > 0 ? 'inline-flex' : 'none';
        }
      } catch (_) {}
    });
  }

  setTimeout(function _tryBoot() {
    try {
      if (ERP.getState && ERP.getState()) { _boot(); }
      else { setTimeout(_tryBoot, 200); }
    } catch (_) {}
  }, 0);

  ERP.InventoryService  = InventoryService;
  ERP.Inventory         = InventoryService;
  ERP.inventory         = _invActions;
  ERP._invService       = _invService;
  ERP._invUI            = _invUI;
  ERP._invActions       = _invActions;

  ERP.InventoryService.reserve           = _Reservations.reserve.bind(_Reservations);
  ERP.InventoryService.unreserve         = _Reservations.unreserve.bind(_Reservations);
  ERP.InventoryService.getReserved       = _Reservations.getReserved.bind(_Reservations);
  ERP.InventoryService.getAvailableStock = _Reservations.getAvailableStock.bind(_Reservations);

  ERP.InventoryService.getPendingGLPosts  = function () { return _LedgerBridge.getPendingIds(); };
  ERP.InventoryService.getPendingGLCount  = function () { return _LedgerBridge.getPendingCount(); };
  ERP.InventoryService.getGLPostFailures  = function () {
    try {
      var s = ERP._internal && ERP._internal.getState && ERP._internal.getState();
      return (s && s.data && s.data.glPostFailures) || [];
    } catch (_) { return []; }
  };
  ERP.InventoryService.clearGLPostFailure = function (id) {
    try {
      var s = ERP._internal && ERP._internal.getState && ERP._internal.getState();
      if (s && s.data && s.data.glPostFailures) {
        s.data.glPostFailures = s.data.glPostFailures.filter(function (f) { return f.id !== id; });
      }
    } catch (_) {}
  };

  ERP.InventoryService.getAvgCost    = function (bc) { return _MAC.getMAC(bc); };
  ERP.InventoryService.resolveActor       = _resolveActor;
  ERP.InventoryService.registerSourceModule = _registerSourceModule;
  ERP.InventoryService.reconcileStockCache  = _reconcileStockCache;
  ERP.InventoryService.getValuationFull = function () {
    var M = _money();
    var inv = ERP.state.selectors.inventory().filter(function (i) { return !i._archived; });
    var totalPaisa = 0;
    var items = inv.map(function (it) {
      var mac  = _MAC.getMAC(it.bc) || _num(it.pp, 0);
      var val  = _round2(_num(it.st, 0) * mac);
      var p    = M.toPaisa(val);
      totalPaisa = M.add(totalPaisa, p);
      return { bc: it.bc, n: it.n || '', stock: _num(it.st, 0), mac: mac, totalRupees: val, totalPaisa: p };
    });
    return { totalPaisa: totalPaisa, totalRupees: _round2(totalPaisa / 100), items: items };
  };

  window.updateStockOnSale = function (items, jobId) {
    function _safeToast(msg, type) {
      try {
        if (window.ERP && window.ERP.ui) window.ERP.ui.toast(msg, type || 'error');
        else if (window.ToastManager) window.ToastManager.show(type || 'error', msg);
      } catch (_) {}
    }
    try {
      if (!Array.isArray(items) || !items.length) return;
      if (!ERP || !ERP.InventoryService) {
        _safeToast('⚠️ Stock deduct nahi hua — inventory system ready nahi (page reload karein)', 'warning');
        return;
      }

      var inv = ERP.state && ERP.state.selectors ? ERP.state.selectors.inventory() : [];
      var toDeduct = [];

      items.forEach(function (item) {

        if (!item) return;
        if (item._isLabour) return;
        var bc = item.bc || item.barcode || item.sku || '';
        var invItem = bc
          ? inv.find(function (i) { return (i.bc || '').toLowerCase() === bc.toLowerCase(); })
          : null;
        if (!invItem) {

          if (!item.n || item.n.toLowerCase().indexOf('labour') >= 0) return;
          _safeToast('⚠️ Stock not deducted for "' + (item.n || '?') + '" — no barcode match found (item may need its barcode fixed)', 'warning');
          return;
        }
        var unitCostPaisa = Math.round((_num(invItem.pp, 0)) * 100);
        if (ERP.InventoryService && typeof ERP.InventoryService.getAvgCost === 'function') {
          var mac = ERP.InventoryService.getAvgCost(invItem.bc);
          if (mac > 0) unitCostPaisa = Math.round(mac * 100);
        }

        var qty = (item.q !== undefined && item.q !== null && item.q !== '') ? _num(item.q, 1) : 1;
        toDeduct.push({ barcode: invItem.bc, qty: qty, unitCostPaisa: unitCostPaisa, reversalReference: null });
      });

      if (toDeduct.length) {

        var stableJobId = jobId || ('JOB-' + (items[0] && typeof items[0].jobId !== 'undefined' ? items[0].jobId : Date.now().toString(36)));

        var actor = (ERP.InventoryService && ERP.InventoryService.resolveActor) ? ERP.InventoryService.resolveActor() : 'Unknown-actor';
        var meta = {
          sourceModule: 'jobService',
          documentId:   stableJobId,
          actor:        actor
        };
        var result = ERP.InventoryService.deduct(toDeduct, meta);
        if (result && !result.ok) {
          console.warn('[updateStockOnSale] Deduction warning:', result.error);
        }
      }
    } catch (e) {
      console.warn('[updateStockOnSale] error:', e);
    }
  };

})(ERP);
