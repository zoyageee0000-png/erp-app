
'use strict';

(function (root) {
  'use strict';

  if (root.ERP && root.ERP.__phase11_concurrency) return;

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
    catch (e) {
      _logger().warn('[ERP.ConcurrencyGuard] _try: ' + (e && e.message || e));
      return (fallback !== undefined ? fallback : null);
    }
  }

  var LOCK_KEY_PREFIX = 'erp_concurrency_lock:';
  var LOCK_TTL_MS   = 15000;
  var ACQUIRE_TIMEOUT_MS = 3000;
  var BC_CHANNEL    = 'erp_tab_coord';

  function _lockKeyFor(label) {
    return LOCK_KEY_PREFIX + (label || 'unknown');
  }

  var _TAB_ID = 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

  var _bc = null;
  var _keyChangeHandlers = {};

  function _initBC() {
    _try(function () {
      if (typeof BroadcastChannel !== 'undefined') {
        _bc = new BroadcastChannel(BC_CHANNEL);
        _bc.onmessage = function (evt) {
          _try(function () {
            var msg = evt.data;
            if (!msg || !msg.type) return;
            if (msg.type === 'key:changed' && msg.key) {
              var handlers = _keyChangeHandlers[msg.key] || [];
              handlers.forEach(function (h) {
                _try(function () { h(msg.key, msg.value); });
              });
            }
          });
        };
        _logger().info('[ERP.ConcurrencyGuard] BroadcastChannel active — tab: ' + _TAB_ID);
      } else {
        _logger().warn('[ERP.ConcurrencyGuard] BroadcastChannel unavailable — single-tab mode.');
      }
    });
  }

  function _bcSend(msg) {
    _try(function () {
      if (_bc) _bc.postMessage(msg);
    });
  }

  function _readLock(lockKey) {
    return _try(function () {
      var raw = localStorage.getItem(lockKey);
      if (!raw) return null;
      return JSON.parse(raw);
    }, null);
  }

  function _writeLock(lockKey, lockData) {
    _try(function () {
      localStorage.setItem(lockKey, JSON.stringify(lockData));
    });
  }

  function _clearLock(lockKey) {
    _try(function () {
      localStorage.removeItem(lockKey);
    });
  }

  function _isLockExpired(lock) {
    if (!lock || !lock.ts) return true;
    return (Date.now() - lock.ts) > LOCK_TTL_MS;
  }

  function _isMyLock(lock) {
    return lock && lock.tabId === _TAB_ID;
  }

  var _heldLocks = {};

  ERP.ConcurrencyGuard = {
    __phase11_concurrency: true,
    VERSION: '11.8.1',

    acquireLock: function (operationLabel, timeoutMs) {
      return new Promise(function (resolve) {
        var flagOn = _try(function () {
          return ERP.FeatureFlags &&
                 typeof ERP.FeatureFlags.get === 'function' &&
                 ERP.FeatureFlags.get('concurrency_guard');
        }, false);

        if (!flagOn) {
          return resolve({ acquired: true, lockId: 'passthrough', error: null });
        }

        var label = (operationLabel || '').toString().trim();
        if (!label) {
          _logger().warn('[ERP.ConcurrencyGuard] acquireLock called with empty label — rejecting');
          return resolve({ acquired: false, lockId: null, error: 'EMPTY_LABEL' });
        }

        var lockKey   = _lockKeyFor(label);
        var lockId    = _TAB_ID + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        var startTime = Date.now();
        var maxWaitMs = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs : ACQUIRE_TIMEOUT_MS;

        function _attempt() {
          if (Date.now() - startTime > maxWaitMs) {
            _logger().warn('[ERP.ConcurrencyGuard] Lock timeout for: ' + label);
            return resolve({ acquired: false, lockId: null, error: 'TIMEOUT' });
          }

          var existing = _readLock(lockKey);

          if (!existing || _isLockExpired(existing) || _isMyLock(existing)) {
            _writeLock(lockKey, { tabId: _TAB_ID, lockId: lockId, ts: Date.now(), op: label });

            var verify = _readLock(lockKey);
            if (verify && verify.lockId === lockId) {
              _heldLocks[lockKey] = lockId;
              _logger().info('[ERP.ConcurrencyGuard] Lock acquired: ' + label + ' [' + lockId + ']');
              resolve({ acquired: true, lockId: lockId, error: null });
            } else {
              setTimeout(_attempt, 100 + Math.random() * 100);
            }

          } else {
            setTimeout(_attempt, 150 + Math.random() * 100);
          }
        }

        _attempt();
      });
    },

    releaseLock: function (lockId) {
      if (!lockId || lockId === 'passthrough') return;
      _try(function () {
        for (var lockKey in _heldLocks) {
          if (!Object.prototype.hasOwnProperty.call(_heldLocks, lockKey)) continue;
          if (_heldLocks[lockKey] !== lockId) continue;
          var existing = _readLock(lockKey);
          if (existing && (existing.lockId === lockId || _isMyLock(existing))) {
            _clearLock(lockKey);
          }
          delete _heldLocks[lockKey];
          _logger().info('[ERP.ConcurrencyGuard] Lock released: ' + lockId);
          return;
        }
      });
    },

    isLockHolder: function (operationLabel) {
      return _try(function () {
        if (operationLabel) {
          var lockKey = _lockKeyFor(operationLabel);
          var lockId = _heldLocks[lockKey];
          if (!lockId) return false;
          var existing = _readLock(lockKey);
          return !!(existing && existing.lockId === lockId && !_isLockExpired(existing));
        }
        for (var key in _heldLocks) {
          if (!Object.prototype.hasOwnProperty.call(_heldLocks, key)) continue;
          var heldId = _heldLocks[key];
          var lock = _readLock(key);
          if (lock && lock.lockId === heldId && !_isLockExpired(lock)) return true;
        }
        return false;
      }, false);
    },

    onKeyChanged: function (key, handler) {
      _try(function () {
        if (!_keyChangeHandlers[key]) _keyChangeHandlers[key] = [];
        if (_keyChangeHandlers[key].indexOf(handler) === -1) {
          _keyChangeHandlers[key].push(handler);
        }
      });
    },

    notifyKeyChanged: function (key, newValue) {
      _try(function () {
        _bcSend({ type: 'key:changed', key: key, value: newValue, tabId: _TAB_ID, changed: true });
      });
    },

    getTabId: function () {
      return _TAB_ID;
    }
  };

  ERP.__phase11_concurrency = true;

  window.addEventListener('beforeunload', function () {
    _try(function () {
      for (var lockKey in _heldLocks) {
        if (!Object.prototype.hasOwnProperty.call(_heldLocks, lockKey)) continue;
        ERP.ConcurrencyGuard.releaseLock(_heldLocks[lockKey]);
      }
      ERP.TimerRegistry.clear('concurrencyGuard.lockRefresh');
      _refreshIntervalId = null;
    });
  });

  var _refreshIntervalId = ERP.TimerRegistry.start('concurrencyGuard.lockRefresh', function () {
    _try(function () {
      for (var lockKey in _heldLocks) {
        if (!Object.prototype.hasOwnProperty.call(_heldLocks, lockKey)) continue;
        var lockId = _heldLocks[lockKey];
        var existing = _readLock(lockKey);
        if (existing && existing.lockId === lockId) {
          existing.ts = Date.now();
          _writeLock(lockKey, existing);
        } else {
          _logger().warn('[ERP.ConcurrencyGuard] Held lock no longer valid in storage, dropping: ' + lockKey);
          delete _heldLocks[lockKey];
        }
      }
    });
  }, Math.floor(LOCK_TTL_MS / 2));

  _initBC();

  _logger().info('[ERP.ConcurrencyGuard] Phase 11.8 loaded — v11.8.1 | Tab: ' + _TAB_ID);

}(window));
