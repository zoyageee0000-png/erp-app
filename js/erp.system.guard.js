
'use strict';

(function (root) {
  'use strict';

  var ERP = root.ERP = root.ERP || {};

  if (ERP.__systemGuardV1) return;

  function _try(fn, fallback, tag) {
    try { return fn(); }
    catch (e) {
      if (root.DEBUG_MODE || root._mhDebug)
        console.warn('[ERP.SystemGuard][' + (tag || '?') + ']', e && e.message);
      return (typeof fallback === 'function') ? fallback(e) : fallback;
    }
  }

  function _ok()        { return { ok: true,  error: null  }; }
  function _fail(msg)   { return { ok: false,  error: msg   }; }

  function _logger() {
    return ERP.Logger || {
      info:  function () {},
      warn:  function () {},
      error: function () {}
    };
  }

  // REMOVED (root cause, audit #61-66): ERP.ID was a whole second,
  // undocumented ID-generator module living in a "system guard" file, with
  // its own timestamp+random+counter algorithm competing directly with
  // core.js's ERP.uid(). Traced every real caller app-wide before removing:
  // opKey(), isValid(), and fromSeed() had zero callers anywhere; generate()
  // had exactly two callers (erp.import.export.js, inventory.js), both of
  // which already fell back to ERP.uid()-based generation if this module was
  // "unavailable" -- so the module was pure duplication, never load-bearing.
  // Both callers now use ERP.uid() directly.

  if (!ERP.InvoiceGuard) {

    ERP.InvoiceGuard = (function () {
      'use strict';

      var _STORE_KEY   = 'erp_guard_invoices_v1';
      var _sessionSet  = Object.create(null);
      var _persistKeys = Object.create(null);

      var _igBC = null;
      var _igBCThrottle = null;
      (function _initInvoiceGuardBC() {
        _try(function () {
          if (typeof BroadcastChannel === 'undefined') return;
          _igBC = new BroadcastChannel('mh_erp_invoice_guard_sync');
          _igBC.onmessage = function (ev) {
            _try(function () {
              var d = ev && ev.data;
              if (!d || d.type !== 'ig_sync') return;
              var raw  = root.localStorage && root.localStorage.getItem(_STORE_KEY);
              var data = raw ? JSON.parse(raw) : {};
              if (data && typeof data === 'object') {
                Object.keys(data).forEach(function (k) {
                  _persistKeys[k] = true;
                  _sessionSet[k]  = true;
                });
              }
            }, null, 'InvoiceGuard.BC.onmessage');
          };
          _igBC.onmessageerror = function () {};
        }, null, '_initInvoiceGuardBC');
      }());

      function _bcNotifyGuard() {
        if (!_igBC) return;
        if (_igBCThrottle) return;
        _igBCThrottle = setTimeout(function () {
          _igBCThrottle = null;
          _try(function () { _igBC.postMessage({ type: 'ig_sync' }); }, null, '_bcNotifyGuard');
        }, 100);
      }

      function _loadPersisted() {
        _try(function () {
          var raw  = root.localStorage && root.localStorage.getItem(_STORE_KEY);
          var data = raw ? JSON.parse(raw) : {};
          if (data && typeof data === 'object') {
            Object.keys(data).forEach(function (k) { _persistKeys[k] = true; });
          }
        }, null, '_loadPersisted.ls');
        _try(function () {
          var db = root.ERP && root.ERP._db;
          if (!db || typeof db.load !== 'function') return;
          if (typeof db._isOpen === 'function' && !db._isOpen()) return;
          db.load('erp_invoice_guard').then(function (rows) {
            var data = (Array.isArray(rows) && rows[0] && rows[0].payload) ? rows[0].payload
                     : (rows && !Array.isArray(rows) && typeof rows === 'object') ? rows
                     : null;
            if (data && typeof data === 'object') {
              Object.keys(data).forEach(function (k) {
                if (k === 'key') return;
                _persistKeys[k] = true;
                _sessionSet[k]  = true;
              });
            }
          }).catch(function (e) { if (root.DEBUG_MODE) console.warn('[SystemGuard] invoice guard IDB load failed:', e && e.message || e); });
        }, null, '_loadPersisted.idb');
      }

      function _savePersisted() {
        _try(function () {
          if (!root.localStorage) return;
          root.localStorage.setItem(_STORE_KEY, JSON.stringify(_persistKeys));
          _bcNotifyGuard();
        }, null, '_savePersisted.ls');
        _try(function () {
          var db = root.ERP && root.ERP._db;
          if (!db || typeof db.save !== 'function') return;
          if (typeof db._isOpen === 'function' && !db._isOpen()) return;
          db.save('erp_invoice_guard', { key: '__mh_invoice_guard__', payload: _persistKeys }).catch(function (e) { if (root.DEBUG_MODE) console.warn('[SystemGuard] invoice guard IDB save failed (localStorage copy already saved):', e && e.message || e); });
        }, null, '_savePersisted.idb');
      }

      function _makeKey(id, type) {
        return (type ? type + ':' : '') + String(id).trim();
      }

      function _seedFromState() {
        _try(function () {
          var s = ERP._internal && typeof ERP._internal.getState === 'function'
                ? ERP._internal.getState()
                : (typeof ERP.getState === 'function' ? ERP.getState() : {});

          var d = s.data || {};

          function _seedArr(arr, type) {
            if (!Array.isArray(arr)) return;
            for (var i = 0; i < arr.length; i++) {
              var rec = arr[i];
              if (rec && rec.id && !rec._deleted && !rec.voided) {
                var k = _makeKey(rec.id, type);
                _sessionSet[k]  = true;
                _persistKeys[k] = true;
              }
            }
          }

          _seedArr(d.sales,            'sale');
          _seedArr(d.estimates,        'estimate');
          _seedArr(d.saleOrders,       'so');
          _seedArr(d.deliveryChallans, 'dc');
          _seedArr(d.saleReturns,      'cn');
          _seedArr(d.payIns,           'payin');

          _savePersisted();
        }, null, '_seedFromState');
      }

      function isDuplicate(id, type) {
        if (!id) return false;
        var k = _makeKey(id, type);
        return !!(_sessionSet[k] || _persistKeys[k]);
      }

      function register(id, type) {
        if (!id) return;
        var k = _makeKey(id, type);
        _sessionSet[k]  = true;
        _persistKeys[k] = true;
        _savePersisted();
      }

      function assertUnique(id, type) {
        if (!id)              return _fail('ID zaroori hai');
        if (isDuplicate(id, type)) {
          return _fail('Duplicate ' + (type || 'record') + ' ID: ' + id +
                       ' — yeh pehle se save ho chuka hai.');
        }
        return _ok();
      }

      function clear(id, type) {
        if (!id) return;
        var k = _makeKey(id, type);
        delete _sessionSet[k];
        delete _persistKeys[k];
        _savePersisted();
      }

      function stats() {
        return {
          sessionCount:   Object.keys(_sessionSet).length,
          persistedCount: Object.keys(_persistKeys).length
        };
      }

      _loadPersisted();
      if (typeof document !== 'undefined') {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
          setTimeout(_seedFromState, 200);
        } else {
          document.addEventListener('DOMContentLoaded', function () {
            setTimeout(_seedFromState, 200);
          });
        }
      } else {
        _seedFromState();
      }

      return {
        __invoiceGuard: true,
        isDuplicate:    isDuplicate,
        register:       register,
        assertUnique:   assertUnique,
        clear:          clear,
        stats:          stats
      };
    })();

    _logger().info('[ERP.SystemGuard] ERP.InvoiceGuard initialized.');
  }

  if (!ERP.EditLock) {

    ERP.EditLock = (function () {
      'use strict';

      var _lockedIds   = Object.create(null);
      var _STORE_KEY   = 'erp_edit_locks_v1';

      function _load() {
        _try(function () {
          var raw  = root.localStorage && root.localStorage.getItem(_STORE_KEY);
          var data = raw ? JSON.parse(raw) : {};
          if (data && typeof data === 'object') {
            Object.keys(data).forEach(function (k) { _lockedIds[k] = data[k] || 'locked'; });
          }
        }, null, '_load.ls');
        _try(function () {
          var db = root.ERP && root.ERP._db;
          if (!db || typeof db.load !== 'function') return;
          if (typeof db._isOpen === 'function' && !db._isOpen()) return;
          db.load('erp_edit_locks').then(function (data) {
            if (data && typeof data === 'object') {
              Object.keys(data).forEach(function (k) { _lockedIds[k] = data[k] || 'locked'; });
            }
          }).catch(function (e) { if (root.DEBUG_MODE) console.warn('[SystemGuard] edit locks IDB load failed:', e && e.message || e); });
        }, null, '_load.idb');
      }

      function _save() {
        _try(function () {
          if (!root.localStorage) return;
          root.localStorage.setItem(_STORE_KEY, JSON.stringify(_lockedIds));
        }, null, '_save.ls');
        _try(function () {
          var db = root.ERP && root.ERP._db;
          if (!db || typeof db.save !== 'function') return;
          if (typeof db._isOpen === 'function' && !db._isOpen()) return;
          db.save('erp_edit_locks', _lockedIds).catch(function (e) { if (root.DEBUG_MODE) console.warn('[SystemGuard] edit locks IDB save failed (localStorage copy already saved):', e && e.message || e); });
        }, null, '_save.idb');
      }

      function _glPostedCheck(id) {
        if (!id) return false;
        if (ERP.SalesPostingLock && typeof ERP.SalesPostingLock.isPosted === 'function') {
          var r = _try(function () { return ERP.SalesPostingLock.isPosted(id); }, null, '_glPostedCheck');
          if (r && r.anyPosted) return true;
        }
        return false;
      }

      function _recordLocked(record) {
        if (!record || typeof record !== 'object') return false;
        if (record._glPosted  === true)    return true;
        if (record._locked    === true)    return true;
        if (record.status     === 'posted') return true;
        return false;
      }

      function getLockReason(id, record) {
        if (!id && (!record || !record.id)) return null;
        var rid = id || (record && record.id);

        if (_lockedIds[rid])               return _lockedIds[rid];
        if (_glPostedCheck(rid))           return 'GL-posted — edit blocked';
        if (record && _recordLocked(record)) {
          if (record._glPosted)            return 'GL-posted (stamped)';
          if (record.status === 'posted')  return 'Status: posted';
          return 'Record is locked';
        }
        return null;
      }

      function isLocked(id, record) {
        return !!getLockReason(id, record);
      }

      function lock(id, reason) {
        if (!id) return;
        _lockedIds[id] = reason || 'locked';
        _save();
      }

      function unlock(id) {
        if (!id) return;
        var lifecycle = (root.ERP && root.ERP.UserLifecycle);
        var isAdmin = lifecycle ? lifecycle.isAdmin() : false;
        if (!isAdmin) {
          _logger().warn('[ERP.EditLock] unlock BLOCKED — Admin required. Attempted by non-Admin on id: ' + id);
          if (root.ERP && root.ERP.ui && root.ERP.ui.toast) {
            root.ERP.ui.toast('⛔ Only Admin can release the edit lock.', 'error', 5000);
          }
          return;
        }
        delete _lockedIds[id];
        _save();
        _logger().warn('[ERP.EditLock] Admin unlock: ' + id);
      }

      function assertEditable(id, record) {
        var reason = getLockReason(id, record);
        if (reason) {
          return _fail('Edit blocked — ' + reason +
                       (id ? ' (' + id + ')' : ''));
        }
        return _ok();
      }

      _load();

      return {
        __editLock:      true,
        isLocked:        isLocked,
        lock:            lock,
        unlock:          unlock,
        assertEditable:  assertEditable,
        getLockReason:   getLockReason,
        _lockedIds:      _lockedIds
      };
    })();

    _logger().info('[ERP.SystemGuard] ERP.EditLock initialized.');
  }

  if (!ERP.Schema) {

    ERP.Schema = (function () {
      'use strict';

      var SCHEMAS = {

        SALE: {
          id:        { type: 'string',  required: true  },
          customer:  { type: 'string',  required: false },
          items:     { type: 'array',   required: true,  min: 1 },
          date:      { type: 'date',    required: false },
          grandTotal:{ type: 'number',  required: false, min: 0 }
        },

        CUSTOMER: {
          id:    { type: 'string', required: true  },
          name:  { type: 'string', required: true, min: 1, max: 200 }
        },

        PURCHASE: {
          id:     { type: 'string', required: true },
          vendor: { type: 'string', required: false },
          items:  { type: 'array',  required: true, min: 1 },
          date:   { type: 'date',   required: false }
        },

        INVENTORY: {
          id:   { type: 'string', required: true },
          name: { type: 'string', required: true,  min: 1, max: 200 },
          qty:  { type: 'number', required: false, min: 0 }
        },

        JOURNAL: {
          id:       { type: 'string', required: true },
          date:     { type: 'date',   required: true },
          entries:  { type: 'array',  required: true, min: 2 }
        }
      };

      function isKnownType(type) {
        return !!(type && SCHEMAS[type.toUpperCase()]);
      }

      function validate(type, record) {
        if (!type || !record || typeof record !== 'object')
          return { ok: false, error: 'Type aur record dono zaroori hain', warnings: [] };

        var schema = SCHEMAS[type.toUpperCase()];
        if (!schema)
          return { ok: false, error: 'Unknown schema type: ' + type, warnings: [] };

        var warnings = [];
        var errors   = [];

        Object.keys(schema).forEach(function (field) {
          var rule = schema[field];
          var val  = record[field];
          var res;

          if (rule.required && (val === null || val === undefined || val === '')) {
            errors.push(field + ' zaroori hai (' + type + ' record)');
            return;
          }
          if (val === null || val === undefined || val === '') {
            if (rule.required) errors.push(field + ' missing hai');
            else               warnings.push(field + ' missing (optional)');
            return;
          }

          switch (rule.type) {
            case 'string':
              if (typeof val !== 'string' || !val.trim())
                errors.push(field + ' valid string hona chahiye');
              else if (rule.min && val.trim().length < rule.min)
                errors.push(field + ' bahut chota hai');
              else if (rule.max && val.trim().length > rule.max)
                errors.push(field + ' bahut bara hai');
              break;
            case 'number':
              var n = parseFloat(val);
              if (isNaN(n) || !isFinite(n)) errors.push(field + ' valid number hona chahiye');
              else if (rule.min !== undefined && n < rule.min)
                errors.push(field + ' ' + rule.min + ' se kam nahi ho sakta');
              else if (rule.max !== undefined && n > rule.max)
                errors.push(field + ' ' + rule.max + ' se zyada nahi ho sakta');
              break;
            case 'date':
              if (!/^\d{4}-\d{2}-\d{2}$/.test(String(val)))
                errors.push(field + ' valid date hona chahiye (YYYY-MM-DD)');
              break;
            case 'array':
              if (!Array.isArray(val)) errors.push(field + ' array hona chahiye');
              else if (rule.min !== undefined && val.length < rule.min)
                errors.push(field + ' mein kam az kam ' + rule.min + ' items honay chahiye');
              break;
          }
        });

        if (record._deleted === true && record._locked === true)
          warnings.push('Record deleted aur locked dono hai — unexpected state');

        return {
          ok:       errors.length === 0,
          error:    errors.length > 0 ? errors[0] : null,
          errors:   errors,
          warnings: warnings
        };
      }

      var DEFAULTS = {
        SALE:      { items: [], grandTotal: 0, tax: 0, _deleted: false, voided: false },
        CUSTOMER:  { phone: '', email: '', address: '', balance: 0, _deleted: false },
        PURCHASE:  { items: [], totalCost: 0, _deleted: false },
        INVENTORY: { qty: 0, price: 0, _deleted: false },
        JOURNAL:   { entries: [], posted: false, reversed: false }
      };

      function sanitize(type, record) {
        if (!record || typeof record !== 'object') return {};
        var schema  = type && SCHEMAS[type.toUpperCase()];
        var defs    = (type && DEFAULTS[type.toUpperCase()]) || {};
        var out     = {};

        Object.keys(record).forEach(function (k) { out[k] = record[k]; });

        Object.keys(defs).forEach(function (k) {
          if (out[k] === undefined || out[k] === null) out[k] = defs[k];
        });

        if (schema) {
          Object.keys(schema).forEach(function (k) {
            if (schema[k].type === 'number' && out[k] !== undefined) {
              var n = parseFloat(out[k]);
              if (isNaN(n) || !isFinite(n)) out[k] = 0;
            }
          });
        }

        return out;
      }

      return {
        __schemaModule: true,
        SCHEMAS:        SCHEMAS,
        isKnownType:    isKnownType,
        validate:       validate,
        sanitize:       sanitize
      };
    })();

    _logger().info('[ERP.SystemGuard] ERP.Schema initialized.');
  }

  if (!ERP.Safe) {

    ERP.Safe = (function () {
      'use strict';

      function _parse(v) {
        if (v === null || v === undefined || v === '') return NaN;
        if (typeof v === 'number')  return v;
        if (typeof v === 'boolean') return v ? 1 : 0;
        var s = String(v).trim();
        s = s.replace(/[^\d.\-]/g, '');
        var parts = s.split('.');
        if (parts.length > 2) {
          s = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
        }
        return parseFloat(s);
      }

      function num(v, fallback) {
        var def = (fallback !== undefined && fallback !== null) ? fallback : 0;
        var n   = _parse(v);
        return (isNaN(n) || !isFinite(n)) ? def : n;
      }

      function int(v, fallback) {
        var n = num(v, fallback !== undefined ? fallback : 0);
        return n < 0 ? Math.ceil(n) : Math.floor(n);
      }

      function pct(v) {
        var n = num(v, 0);
        return Math.min(100, Math.max(0, n));
      }

      function money(v) {
        return round(num(v, 0), 2);
      }

      function round(v, decimals) {
        var d = (decimals !== undefined && decimals !== null) ? int(decimals, 2) : 2;
        var f = Math.pow(10, d);
        return Math.round(num(v, 0) * f) / f;
      }

      function add() {
        var sum = 0;
        for (var i = 0; i < arguments.length; i++) {
          var n = _parse(arguments[i]);
          if (!isNaN(n) && isFinite(n)) sum += n;
        }
        return round(sum, 10);
      }

      function mul(a, b) {
        return round(num(a, 0) * num(b, 0), 10);
      }

      function div(a, b, fallback) {
        var den = num(b, 0);
        if (den === 0) return (fallback !== undefined) ? fallback : 0;
        return round(num(a, 0) / den, 10);
      }

      function clamp(v, min, max) {
        var n   = num(v, min);
        var lo  = num(min, -Infinity);
        var hi  = num(max,  Infinity);
        return Math.min(hi, Math.max(lo, n));
      }

      function isZero(v) {
        return Math.abs(num(v, 0)) < 0.001;
      }

      function fmt(v, decimals) {
        var n = num(v, 0);
        var d = (decimals !== undefined) ? int(decimals, 2) : 2;
        return _try(
          function () { return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }); },
          function () { return n.toFixed(d); },
          'fmt'
        );
      }

      return {
        __safeModule: true,
        num:   num,
        int:   int,
        pct:   pct,
        money: money,
        round: round,
        add:   add,
        mul:   mul,
        div:   div,
        clamp: clamp,
        isZero:isZero,
        fmt:   fmt,
        _parse: _parse
      };
    })();

    _logger().info('[ERP.SystemGuard] ERP.Safe initialized.');
  }

  (function _installAdapters() {

    _try(function () {
      if (!ERP.EventBus || typeof ERP.EventBus.on !== 'function') return;
      if (ERP.__systemGuardSalesListener) return;

      function _onSaleAdd(payload) {
        var sale = payload && (payload.sale || payload.record || payload);
        if (sale && sale.id && !sale._deleted && !sale.voided) {
          ERP.InvoiceGuard.register(sale.id, 'sale');
        }
      }

      ERP.EventBus.on('sales:added', _onSaleAdd);
      if (ERP.events && ERP.events !== ERP.EventBus && typeof ERP.events.on === 'function') {
        ERP.events.on('sales:added', _onSaleAdd);
      }
      ERP.__systemGuardSalesListener = true;
    }, null, '_installAdapters.salesListener');

    _try(function () {
      if (!ERP.EventBus || typeof ERP.EventBus.on !== 'function') return;
      if (ERP.__systemGuardLockListener) return;

      function _onGLPosted(payload) {
        var id = payload && (payload.documentId || payload.saleId || payload.id);
        if (id) ERP.EditLock.lock(id, 'GL-posted');
      }

      ERP.EventBus.on('posting:journal:posted', _onGLPosted);
      ERP.__systemGuardLockListener = true;
    }, null, '_installAdapters.lockListener');

    if (!ERP._safeNum) {
      ERP._safeNum = function (v, fallback) { return ERP.Safe.num(v, fallback); };
    }

  })();

  ERP.SystemGuard = {
    __systemGuardV1: true,

    diagnostics: function () {
      return {
        modules: {
          // ID removed (see root-cause note above) -- it was a duplicate of
          // ERP.uid(), not a module this diagnostic needs to track anymore.
          InvoiceGuard:  !!(ERP.InvoiceGuard && ERP.InvoiceGuard.__invoiceGuard),
          EditLock:      !!(ERP.EditLock && ERP.EditLock.__editLock),
          Schema:        !!(ERP.Schema && ERP.Schema.__schemaModule),
          Safe:          !!(ERP.Safe && ERP.Safe.__safeModule)
        },
        invoiceStats:   ERP.InvoiceGuard ? ERP.InvoiceGuard.stats() : null,
        editLockCount:  ERP.EditLock ? Object.keys(ERP.EditLock._lockedIds).length : 0,
        adapters: {
          salesListener: !!ERP.__systemGuardSalesListener,
          lockListener:  !!ERP.__systemGuardLockListener,
          safeNumAlias:  typeof ERP._safeNum === 'function'
        }
      };
    }
  };

  ERP.__systemGuardV1 = true;

  _logger().info('[ERP.SystemGuard] Phase 6 System-Wide Protections fully initialized.', {
    modules: ['ERP.InvoiceGuard', 'ERP.EditLock', 'ERP.Schema', 'ERP.Safe']
  });

})(typeof window !== 'undefined' ? window : globalThis);
