'use strict';

(function (root) {
  'use strict';

  if (root.ERP && root.ERP.__kernelV1) return;

  var ERP = root.ERP = root.ERP || {};

  function _try(fn, fallback, tag) {
    try { return fn(); }
    catch (e) {
      if (root.DEBUG_MODE || root._mhDebug)
        console.warn('[ERP.Kernel][' + (tag || '?') + ']', e);
      return (typeof fallback === 'function') ? fallback(e) : fallback;
    }
  }

  function _serverNowISO() {
    return (ERP.ServerTime && typeof ERP.ServerTime.nowISO === 'function')
      ? ERP.ServerTime.nowISO()
      : new Date().toISOString();
  }

  function _deepCloneFallback(obj, seen) {
    if (obj === null || typeof obj !== 'object') return obj;
    seen = seen || new Map();
    if (seen.has(obj)) return seen.get(obj);
    if (Array.isArray(obj)) {
      var arrCopy = [];
      seen.set(obj, arrCopy);
      for (var i = 0; i < obj.length; i++) arrCopy[i] = _deepCloneFallback(obj[i], seen);
      return arrCopy;
    }
    var objCopy = {};
    seen.set(obj, objCopy);
    Object.keys(obj).forEach(function (k) {
      objCopy[k] = _deepCloneFallback(obj[k], seen);
    });
    return objCopy;
  }

  function _clone(obj) {
    return _try(function () { return JSON.parse(JSON.stringify(obj)); },
                function () { return _try(function () { return _deepCloneFallback(obj); }, obj, '_clone.fallback'); },
                '_clone');
  }

  function _isPlainObj(v) {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
    var proto = Object.getPrototypeOf(v);
    return proto === null || proto === Object.prototype;
  }

  function _setPath(obj, path, value) {
    var parts = path.split('.');
    var cur   = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      var key  = parts[i];
      var next = cur[key];
      if (Array.isArray(next)) {
        console.error('[ERP._setPath] refusing to traverse into array at segment "' + key + '" of path "' + path + '"');
        return obj;
      }
      if (!_isPlainObj(next)) {
        if (next !== undefined && next !== null) {
          console.warn('[ERP._setPath] overwriting non-object value at segment "' + key + '" of path "' + path + '"');
        }
        cur[key] = {};
      }
      cur = cur[key];
    }
    cur[parts[parts.length - 1]] = value;
    return obj;
  }

  function _getPath(obj, path) {
    var parts = path.split('.');
    var cur   = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  if (!ERP.Store) {

    ERP.Store = (function () {
      'use strict';

      var _subscribers = [];

      function getState() {
        if (typeof ERP.getState === 'function') {
          return _try(function () { return ERP.getState(); }, {}, 'Store.getState');
        }
        return {};
      }

      function setState(updaterFn, tag) {
        if (typeof ERP.setState !== 'function') {
          console.error('[ERP.Store.setState] ERP.setState not available');
          return;
        }
        if (typeof updaterFn !== 'function') {
          console.error('[ERP.Store.setState] updaterFn must be a function');
          return;
        }
        _try(function () {
          ERP.setState(updaterFn, tag);
          _notify(getState());
        }, null, 'Store.setState');
      }

      function update(path, value, tag) {
        if (typeof path !== 'string' || path === '') {
          console.error('[ERP.Store.update] path must be a non-empty string');
          return;
        }
        setState(function (draft) { _setPath(draft, path, value); }, tag);
      }

      function get(path) {
        if (typeof path !== 'string' || path === '') return getState();
        return _getPath(getState(), path);
      }

      function subscribe(fn) {
        if (typeof fn !== 'function') return function () {};
        if (_subscribers.indexOf(fn) === -1)
          _subscribers.push(fn);
        return function () {
          _subscribers = _subscribers.filter(function (f) { return f !== fn; });
        };
      }

      function _notify(state) {
        var snapshot = _subscribers.slice();
        for (var i = 0; i < snapshot.length; i++) {
          _try(function () { snapshot[i](state); }, null, 'Store.notify[' + i + ']');
        }
      }

      function readLegacyKey(key) {
        return _try(function () {
          var raw = localStorage.getItem(key);
          if (raw === null) return null;
          return JSON.parse(raw);
        }, null, 'Store.readLegacyKey(' + key + ')');
      }

      return {
        getState:     getState,
        setState:     setState,
        update:       update,
        get:          get,
        subscribe:    subscribe,
        readLegacyKey: readLegacyKey
      };
    })();

  }

  if (!ERP.EventBus) {

    ERP.EventBus = (function () {
      'use strict';

      var _local = {};
      var _migrated = false;

      function _findBus() {
        if (root.EventBus && typeof root.EventBus.on === 'function')
          return root.EventBus;
        if (ERP._events_bus && typeof ERP._events_bus.on === 'function')
          return ERP._events_bus;
        return null;
      }

      function _delegate() {
        var bus = _findBus();
        if (bus && !_migrated) {
          _migrated = true;
          _try(function () {
            Object.keys(_local).forEach(function (event) {
              _local[event].forEach(function (handler) {
                bus.on(event, handler);
              });
            });
          }, null, 'EventBus._migrate');
          _local = {};
        }
        return bus;
      }

      function on(event, handler) {
        if (typeof event !== 'string' || typeof handler !== 'function') return;
        var bus = _delegate();
        if (bus) {
          _try(function () { bus.on(event, handler); }, null, 'EventBus.on');
          return;
        }
        if (!_local[event]) _local[event] = [];
        if (_local[event].indexOf(handler) === -1)
          _local[event].push(handler);
      }

      function off(event, handler) {
        if (typeof event !== 'string' || typeof handler !== 'function') return;
        var bus = _delegate();
        if (bus) {
          _try(function () { bus.off(event, handler); }, null, 'EventBus.off');
          return;
        }
        if (_local[event])
          _local[event] = _local[event].filter(function (f) { return f !== handler; });
      }

      function emit(event, payload) {
        if (typeof event !== 'string') return;
        var bus = _delegate();
        if (bus) {
          _try(function () { bus.emit(event, payload); }, null, 'EventBus.emit');
          return;
        }
        var listeners = (_local[event] || []).slice();
        for (var i = 0; i < listeners.length; i++) {
          _try(function () { listeners[i](payload); }, null, 'EventBus.emit.local[' + i + ']');
        }
      }

      function once(event, handler) {
        if (typeof event !== 'string' || typeof handler !== 'function') return;
        var bus = _delegate();
        if (bus && typeof bus.once === 'function') {
          _try(function () { bus.once(event, handler); }, null, 'EventBus.once');
        } else {
          function _wrapper(payload) {
            off(event, _wrapper);
            _try(function () { handler(payload); }, null, 'EventBus.once.wrapper');
          }
          on(event, _wrapper);
        }
      }

      function _getEvents() {
        var merged = {};
        if (root.EventBus && root.EventBus.EVENTS)
          Object.assign(merged, root.EventBus.EVENTS);
        if (ERP.events && ERP.events.NAMES)
          Object.assign(merged, ERP.events.NAMES);
        if (ERP._events_bus && ERP._events_bus.NAMES)
          Object.assign(merged, ERP._events_bus.NAMES);
        return Object.freeze(merged);
      }

      var _busObj = { on: on, off: off, emit: emit, once: once };

      Object.defineProperty(_busObj, 'EVENTS', {
        get: _getEvents,
        enumerable: true,
        configurable: true
      });

      return _busObj;
    })();

  }

  if (!ERP.transaction) {

    ERP.transaction = (function () {
      'use strict';

      var _activeTx     = null;
      var _txLog        = [];
      var TX_LOG_MAX    = 100;

      function _isPromise(v) {
        return !!v && typeof v.then === 'function';
      }

      function run(fn, label) {
        if (typeof fn !== 'function') {
          console.error('[ERP.transaction] fn must be a function');
          return;
        }

        label = label || 'tx-' + Date.now();

        if (_activeTx) {
          return _try(fn, function (e) {
            _logEntry(label, 'nested-error', e.message);
            throw e;
          }, 'transaction.nested');
        }

        var snapshot = null;
        _try(function () {
          if (typeof ERP.getState === 'function')
            snapshot = _clone(ERP.getState());
        }, null, 'transaction.snapshot');

        _activeTx = { label: label, ts: Date.now() };

        var result;
        var success = false;

        try {
          result  = fn();
          if (_isPromise(result)) {
            console.error('[ERP.transaction] Error: fn() returned a Promise. Async transactions are not supported — transaction aborted.');
            throw new Error('Async transactions are not supported');
          }
          success = true;
        } catch (e) {
          if (snapshot !== null && typeof ERP.setState === 'function') {
            _try(function () {
              ERP.setState(function (draft) {
                Object.keys(draft).forEach(function (k) {
                  if (!Object.prototype.hasOwnProperty.call(snapshot, k)) delete draft[k];
                });
                Object.keys(snapshot).forEach(function (k) {
                  draft[k] = _clone(snapshot[k]);
                });
              }, '__tx_rollback__');
            }, null, 'transaction.rollback');
          }

          _logEntry(label, 'rollback', e.message);
          _activeTx = null;

          _try(function () {
            ERP.EventBus.emit('transaction:rollback', { label: label, error: e.message });
          }, null, 'transaction.emit.rollback');

          throw e;
        }

        _logEntry(label, 'commit', null);
        _activeTx = null;

        _try(function () {
          ERP.EventBus.emit('transaction:commit', { label: label });
        }, null, 'transaction.emit.commit');

        return result;
      }

      function begin(label) {
        label = label || 'tx-' + Date.now();

        var snapshot = null;
        _try(function () {
          if (typeof ERP.getState === 'function')
            snapshot = _clone(ERP.getState());
        }, null, 'transaction.begin.snapshot');

        var ownsActiveTx = false;
        if (!_activeTx) {
          _activeTx = { label: label, ts: Date.now() };
          ownsActiveTx = true;
        }

        var steps     = [];
        var committed = false;
        var rolled    = false;

        function _release() {
          if (ownsActiveTx) _activeTx = null;
        }

        var tx = {
          do: function (name, forward, undo) {
            if (committed || rolled)
              throw new Error('[ERP.transaction.begin] tx.do("' + name + '"): already ended');
            var result;
            try {
              result = forward();
              if (_isPromise(result)) {
                throw new Error('Async steps are not supported');
              }
            }
            catch (e) {
              var err = new Error('[ERP.transaction] step "' + name + '" failed: ' + e.message);
              err.cause = e;
              throw err;
            }
            steps.push({ name: name, undo: undo || null, result: result });
            return result;
          },

          commit: function () {
            if (rolled) throw new Error('[ERP.transaction.begin] commit(): already rolled back');
            if (committed) {
              _try(function () {
                if (ERP.Logger && typeof ERP.Logger.warn === 'function')
                  ERP.Logger.warn('[ERP.transaction.begin] commit(): already committed — no-op', { label: label });
              }, null, 'transaction.begin.commit.warn');
              return steps.map(function (s) { return s.result; });
            }
            committed = true;
            _logEntry(label, 'commit', null);
            _try(function () {
              ERP.EventBus.emit('transaction:commit', { label: label });
            }, null, 'transaction.begin.commit.emit');
            _release();
            return steps.map(function (s) { return s.result; });
          },

          rollback: function () {
            if (committed) {
              _try(function () {
                if (ERP.Logger && typeof ERP.Logger.warn === 'function')
                  ERP.Logger.warn('[ERP.transaction.begin] rollback(): already committed — no-op', { label: label });
              }, null, 'transaction.begin.rollback.warn');
              return;
            }
            if (rolled) return;
            rolled = true;

            for (var i = steps.length - 1; i >= 0; i--) {
              if (typeof steps[i].undo === 'function') {
                _try(steps[i].undo, null, 'transaction.begin.rollback[' + steps[i].name + ']');
              }
            }

            if (snapshot !== null && typeof ERP.setState === 'function') {
              _try(function () {
                ERP.setState(function (draft) {
                  Object.keys(draft).forEach(function (k) {
                    if (!Object.prototype.hasOwnProperty.call(snapshot, k)) delete draft[k];
                  });
                  Object.keys(snapshot).forEach(function (k) {
                    draft[k] = _clone(snapshot[k]);
                  });
                }, '__tx_rollback__');
              }, null, 'transaction.begin.rollback.stateRestore');
            }

            _logEntry(label, 'rollback', 'manual');
            _try(function () {
              ERP.EventBus.emit('transaction:rollback', { label: label, error: 'manual rollback' });
            }, null, 'transaction.begin.rollback.emit');
            _release();
          }
        };

        return tx;
      }

      function isActive() { return !!_activeTx; }

      function getLog()   { return _txLog.slice(); }

      function _logEntry(label, status, errMsg) {
        var entry = {
          ts:     _serverNowISO(),
          label:  label,
          status: status,
          error:  errMsg || null
        };
        _txLog.push(entry);
        if (_txLog.length > TX_LOG_MAX) _txLog.shift();

        if (ERP.Logger) {
          _try(function () {
            if (status === 'rollback' || status === 'nested-error') {
              ERP.Logger.error('[Transaction ' + status.toUpperCase() + '] ' + label, { error: errMsg });
            } else {
              ERP.Logger.info('[Transaction ' + status.toUpperCase() + '] ' + label);
            }
          }, null, 'transaction.logEntry.logger');
        }

        if (root.AuditTrail && typeof root.AuditTrail.record === 'function') {
          _try(function () {
            root.AuditTrail.record('transaction', label, status,
              status === 'rollback' ? { error: errMsg } : null,
              { status: status }, 'ERP.Kernel');
          }, null, 'transaction.auditTrail');
        }
      }

      run.run      = run;
      run.begin    = begin;
      run.isActive = isActive;
      run.getLog   = getLog;

      return run;
    })();

  }

  if (!ERP.DB) {

    ERP.DB = (function () {
      'use strict';

      var _pending  = Object.create(null);
      var _original = Object.create(null);

      function _lsGet(key) {
        return _try(function () {
          var raw = localStorage.getItem(key);
          if (raw === null || raw === undefined) return null;
          return JSON.parse(raw);
        }, null, 'DB._lsGet(' + key + ')');
      }

      function _lsSet(key, value) {
        return _try(function () {
          var str;
          try { str = JSON.stringify(value); }
          catch (e) {
            if (ERP.Logger) ERP.Logger.error('[ERP.DB] JSON serialization failed for key: ' + key, e);
            return false;
          }
          localStorage.setItem(key, str);
          return true;
        }, false, 'DB._lsSet(' + key + ')');
      }

      function _validate(data) {
        var serialized;
        try { serialized = JSON.stringify(data); }
        catch (e) {
          if (ERP.Logger) ERP.Logger.warn('[ERP.DB._validate] data not JSON-serializable: ' + (e && e.message));
          return false;
        }
        if (serialized === undefined) {
          if (ERP.Logger) ERP.Logger.warn('[ERP.DB._validate] data serializes to undefined (e.g. undefined, function, or Symbol)');
          return false;
        }
        return true;
      }

      function load(key) {
        if (typeof key !== 'string' || key === '') {
          if (ERP.Logger) ERP.Logger.warn('[ERP.DB.load] invalid key');
          return null;
        }
        if (Object.prototype.hasOwnProperty.call(_pending, key))
          return _clone(_pending[key]);
        return _lsGet(key);
      }

      var _batching = false;

      function save(key, data) {
        if (typeof key !== 'string' || key === '') {
          if (ERP.Logger) ERP.Logger.warn('[ERP.DB.save] invalid key');
          return false;
        }
        if (!_validate(data)) {
          if (ERP.Logger)
            ERP.Logger.error('[ERP.DB.save] data not JSON-serializable for key: ' + key);
          return false;
        }

        if (!Object.prototype.hasOwnProperty.call(_original, key))
          _original[key] = _lsGet(key);

        _pending[key] = _clone(data);

        if (!_batching) return commit();
        return true;
      }

      function beginBatch() { _batching = true; }

      function commit() {
        var keys    = Object.keys(_pending);
        var success = true;
        var failed  = Object.create(null);
        var failedOriginal = Object.create(null);
        for (var i = 0; i < keys.length; i++) {
          var ok = _lsSet(keys[i], _pending[keys[i]]);
          if (!ok) {
            success = false;
            failed[keys[i]] = _pending[keys[i]];
            if (Object.prototype.hasOwnProperty.call(_original, keys[i]))
              failedOriginal[keys[i]] = _original[keys[i]];
          }
        }
        _pending  = failed;
        _original = failedOriginal;
        _batching = false;

        if (ERP.Logger)
          ERP.Logger.info('[ERP.DB.commit] flushed ' + (keys.length - Object.keys(failed).length) + ' key(s)');
        if (!success && ERP.Logger)
          ERP.Logger.error('[ERP.DB.commit] ' + Object.keys(failed).length + ' key(s) failed to persist and remain staged for retry: ' + Object.keys(failed).join(', '));
        _try(function () {
          ERP.EventBus.emit('storage:saved', { ts: Date.now(), keys: keys.filter(function (k) { return !Object.prototype.hasOwnProperty.call(failed, k); }) });
        }, null, 'DB.commit.emit');

        return success;
      }

      function rollback() {
        var keys = Object.keys(_pending);
        _pending  = Object.create(null);
        _original = Object.create(null);
        _batching = false;
        if (ERP.Logger)
          ERP.Logger.warn('[ERP.DB.rollback] discarded ' + keys.length + ' staged write(s)');
        _try(function () {
          ERP.EventBus.emit('storage:rollback', { ts: Date.now() });
        }, null, 'DB.rollback.emit');
      }

      function idb(storeName) {
        return {
          load: function () {
            var _idb = ERP._db || null;
            if (!_idb || typeof _idb.load !== 'function')
              return Promise.resolve([]);
            return _try(function () { return _idb.load(storeName); },
                        Promise.resolve([]), 'DB.idb.load(' + storeName + ')');
          },
          save: function (record) {
            var _idb = ERP._db || null;
            if (!_idb || typeof _idb.save !== 'function')
              return Promise.resolve();
            return _try(function () { return _idb.save(storeName, record); },
                        Promise.resolve(), 'DB.idb.save(' + storeName + ')');
          }
        };
      }

      function exists(key) {
        return _try(function () {
          return localStorage.getItem(key) !== null;
        }, false, 'DB.exists(' + key + ')');
      }

      return {
        load:       load,
        save:       save,
        commit:     commit,
        rollback:   rollback,
        beginBatch: beginBatch,
        idb:        idb,
        exists:     exists
      };
    })();

  }

  if (!ERP.Logger) {

    ERP.Logger = (function () {
      'use strict';

      var LS_KEY      = 'erp_kernel_log';
      var MAX_ENTRIES = 200;
      var _entries    = [];
      var _loaded     = false;

      var LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
      var _muted = 0; // counter so nested mute()/unmute() calls stay safe

      var DEV_HOSTNAMES = (ERP.config && Array.isArray(ERP.config.devHostnames))
        ? ERP.config.devHostnames
        : ['localhost', '127.0.0.1', '::1', '0.0.0.0'];

      function _isDev() {
        return !!(root.DEBUG_MODE || root._mhDebug ||
                  (root.location && DEV_HOSTNAMES.indexOf(root.location.hostname) !== -1));
      }

      function _load() {
        if (_loaded) return;
        _loaded = true;
        _try(function () {
          var raw = localStorage.getItem(LS_KEY);
          if (raw) {
            var parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) _entries = parsed;
          }
        }, null, 'Logger._load');
      }

      function _persist() {
        _try(function () {
          if (_entries.length > MAX_ENTRIES)
            _entries = _entries.slice(-MAX_ENTRIES);
          localStorage.setItem(LS_KEY, JSON.stringify(_entries));
        }, null, 'Logger._persist');
      }

      function _log(level, levelName, args) {
        _load();

        var msg   = Array.prototype.slice.call(args, 0);
        var entry = {
          ts:    _serverNowISO(),
          lvl:   levelName,
          msg:   msg.map(function (a) {
                   if (typeof a === 'string') return a;
                   return _try(function () { return JSON.stringify(a); }, function () { return _try(function () { return String(a); }, '[object]', ''); }, '');
                 }).join(' ')
        };
        _entries.push(entry);
        _persist();

        if (!_muted) {
          var delegated = false;
          if (root.Logger && root.Logger !== ERP.Logger) {
            delegated = _try(function () {
              if (level >= LEVELS.ERROR && typeof root.Logger.error === 'function') {
                root.Logger.error.apply(root.Logger, msg);
                return true;
              }
              if (level >= LEVELS.WARN && typeof root.Logger.warn === 'function') {
                root.Logger.warn.apply(root.Logger, msg);
                return true;
              }
              if (_isDev() && typeof root.Logger.info === 'function') {
                root.Logger.info.apply(root.Logger, msg);
                return true;
              }
              return false;
            }, false, 'Logger.delegate');
          }

          if (!delegated) {
            var prefix = '[ERP ' + entry.ts.slice(11, 19) + '][' + levelName + ']';
            var _args = [prefix].concat(Array.prototype.slice.call(msg));
            if (level >= LEVELS.ERROR)      Function.prototype.apply.call(console.error, console, _args);
            else if (level >= LEVELS.WARN)  Function.prototype.apply.call(console.warn, console, _args);
            else if (_isDev())              Function.prototype.apply.call(console.log, console, _args);
          }
        }
      }

      function debug()  { _log(LEVELS.DEBUG, 'DEBUG', arguments); }
      function info()   { _log(LEVELS.INFO,  'INFO',  arguments); }
      function warn()   { _log(LEVELS.WARN,  'WARN',  arguments); }
      function error()  { _log(LEVELS.ERROR, 'ERROR', arguments); }

      function getLogs(level) {
        _load();
        if (!level) return _entries.slice();
        return _entries.filter(function (e) { return e.lvl === level; });
      }

      function clear() {
        _entries = [];
        _try(function () { localStorage.removeItem(LS_KEY); }, null, 'Logger.clear');
      }

      function setDebug(on) { root._mhDebug = !!on; }

      function mute()   { _muted++; }
      function unmute() { if (_muted > 0) _muted--; }

      _load();

      return {
        debug:   debug,
        info:    info,
        warn:    warn,
        error:   error,
        getLogs: getLogs,
        clear:   clear,
        setDebug: setDebug,
        mute:    mute,
        unmute:  unmute
      };
    })();

  }

  ERP.__kernelV1 = true;

  ERP.Logger.info('[ERP.Kernel] Phase 1 Core Kernel loaded — v1.0.0');

  if (!ERP._kernelBeforeUnloadHandler) {
    ERP._kernelBeforeUnloadHandler = function () {
      if (ERP.transaction && typeof ERP.transaction.isActive === 'function') {
        if (ERP.transaction.isActive()) {
          ERP.Logger.error('[ERP.Kernel] Page closed/refreshed while transaction was active — possible partial write. WAL flag will be checked on next boot.');
        }
      }
    };
    _try(function () {
      root.addEventListener('beforeunload', ERP._kernelBeforeUnloadHandler);
    }, null, 'kernel.beforeunload.guard');
  }

  setTimeout(function () {
    _try(function () {
      ERP.EventBus.emit('kernel:ready', {
        modules: ['Store', 'EventBus', 'transaction', 'DB', 'Logger'],
        ts: Date.now()
      });
      ERP.Logger.info('[ERP.Kernel] kernel:ready emitted');
    }, null, 'kernel:ready.emit');
  }, 0);

  root.ERP = ERP;

})(typeof window !== 'undefined' ? window : globalThis);
