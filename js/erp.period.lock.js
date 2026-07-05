'use strict';

(function (root) {
  'use strict';

  if (root.ERP && root.ERP.__phase11_periodLock) return;

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
      _logger().warn('[ERP.PeriodLock] _try: ' + (e && e.message || e));
      return (fallback !== undefined ? fallback : null);
    }
  }

  function _asyncResult(executor, fallback) {
    return new Promise(function (resolve) {
      try {
        executor(resolve);
      } catch (e) {
        _logger().warn('[ERP.PeriodLock] _asyncResult: ' + (e && e.message || e));
        resolve(fallback || { ok: false, error: 'UNEXPECTED_ERROR' });
      }
    });
  }

  function _accCore() {
    return _try(function () {
      return root.AccountingCore;
    }, null);
  }

  // Single source of truth: delegates to ERP.Auth (core.js). This was
  // byte-for-byte duplicated across 4 files (erp.backup.engine.js,
  // erp.feature.flags.js, erp.period.lock.js, erp.user.lifecycle.js) —
  // a role-check rule change would have needed manual sync across all 4.
  function _currentUser() {
    return _try(function () { return ERP.Auth.currentUser(); }, null);
  }

  function _isAdmin() {
    return _try(function () { return ERP.Auth.isAdminRole(); }, false);
  }

  function _nowISO() {
    return _try(function () {
      var serverTime = root.ERP && root.ERP.ServerTime &&
        typeof root.ERP.ServerTime.now === 'function' ?
        root.ERP.ServerTime.now() : null;
      return serverTime ? new Date(serverTime).toISOString() : new Date().toISOString();
    }, new Date().toISOString());
  }

  function _auditRecord(action, periodId, before, after) {
    _try(function () {
      if (root.AuditTrail && typeof root.AuditTrail.record === 'function') {
        var u = _currentUser();
        root.AuditTrail.record('period_lock', periodId, action,
          before, after, (u && u.username) || 'System');
      }
    });
  }

  function _toYYYYMM(dateStr) {
    return _try(function () {
      if (!dateStr) return null;

      if (dateStr instanceof Date) {
        if (isNaN(dateStr.getTime())) return null;
        return dateStr.getFullYear() + '-' + String(dateStr.getMonth() + 1).padStart(2, '0');
      }

      var isoMatch = /^(\d{4})-(\d{2})(?:-\d{2})?/.exec(String(dateStr));
      if (isoMatch) return isoMatch[1] + '-' + isoMatch[2];

      var d = new Date(dateStr);
      if (isNaN(d.getTime())) return null;
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      return y + '-' + m;
    }, null);
  }

  function _getPeriods() {
    return _try(function () {
      var ACC = _accCore();
      if (!ACC || !ACC.AccountingState) return [];

      var periods = null;
      if (typeof ACC.AccountingState.getAllPeriods === 'function') {
        periods = ACC.AccountingState.getAllPeriods();
      } else if (typeof ACC.AccountingState.getPeriods === 'function') {
        periods = ACC.AccountingState.getPeriods();
      } else {
        var state = ACC.AccountingState.getState && ACC.AccountingState.getState();
        periods = state && state.periods;
      }
      return Array.isArray(periods) ? periods : [];
    }, []);
  }

  function _isPeriodClosed(period) {
    return !!(period && (String(period.status || '').toLowerCase() === 'closed' || period.locked));
  }

  function _applyPeriodUpdate(ACC, period, periodId, patch, txLabel) {
    return _try(function () {
      if (ERP.transaction && typeof ERP.transaction === 'function') {
        ERP.transaction(function () {
          if (typeof ACC.AccountingState.dispatch === 'function') {
            ACC.AccountingState.dispatch({
              type: 'UPDATE_PERIOD_STATUS',
              payload: Object.assign({ id: periodId }, patch)
            });
          } else {
            Object.assign(period, patch);
          }
        }, txLabel);
        return true;
      }

      if (ERP.setState) {
        ERP.setState(function (s) {
          var periods = (s.data && s.data.periods) || [];
          var p = periods.find(function (p) { return p.id === periodId; });
          if (p) Object.assign(p, patch);
        }, 'period.lock:update');
        return true;
      }

      if (typeof ACC.AccountingState.dispatch === 'function') {
        ACC.AccountingState.dispatch({
          type: 'UPDATE_PERIOD_STATUS',
          payload: Object.assign({ id: periodId }, patch)
        });
        return true;
      }

      Object.assign(period, patch);
      return true;
    }, false);
  }

  var _wrapperInstalled = false;

  ERP.PeriodLock = {
    __phase11_periodLock: true,
    VERSION: '11.5.3',

    check: function (dateStr) {
      return _try(function () {
        var yyyymm = _toYYYYMM(dateStr);
        if (!yyyymm) return { locked: false, periodId: null, reason: 'INVALID_DATE' };

        var periods = _getPeriods();
        if (!Array.isArray(periods) || periods.length === 0) {
          return { locked: false, periodId: null, reason: 'NO_PERIODS_DEFINED' };
        }

        var matched = false;
        for (var i = 0; i < periods.length; i++) {
          var p = periods[i];
          if (!p || !p.id) continue;
          var periodMonth = _toYYYYMM(p.startDate || p.date || p.id);
          if (periodMonth === yyyymm || p.id === yyyymm) {
            matched = true;
            if (_isPeriodClosed(p)) {
              return { locked: true, periodId: p.id, reason: 'PERIOD_CLOSED' };
            }
          }
        }

        if (matched) {
          return { locked: false, periodId: null, reason: 'PERIOD_OPEN' };
        }
        return { locked: false, periodId: null, reason: 'PERIOD_NOT_FOUND' };
      }, { locked: false, periodId: null, reason: 'ERROR_FAILED_OPEN' });
    },

    install: function () {
      return _try(function () {
        if (!ERP.Ledger || !ERP.Ledger.GeneralLedger ||
            typeof ERP.Ledger.GeneralLedger.postJournal !== 'function') {
          return { ok: false, error: 'ERP_LEDGER_NOT_READY' };
        }

        if (_wrapperInstalled && ERP.Ledger.GeneralLedger.postJournal.__periodLockWrapped) {
          return { ok: true, error: null };
        }

        var _original = ERP.Ledger.GeneralLedger.postJournal.bind(ERP.Ledger.GeneralLedger);

        var _wrapped = function (opts) {
          var dateStr = (opts && (opts.date || opts.postDate)) || _nowISO();
          var check   = ERP.PeriodLock.check(dateStr);

          if (check.locked) {
            var msg = '[PeriodLock] Post BLOCKED — period ' + check.periodId + ' is closed. Date: ' + dateStr;
            _logger().warn(msg);
            _auditRecord('post_blocked', check.periodId,
              { date: dateStr, sourceId: opts && opts.sourceId }, null);
            return Promise.reject(new Error('PERIOD_LOCKED: ' + check.periodId));
          }

          return _original(opts);
        };

        _wrapped.__periodLockWrapped = true;
        ERP.Ledger.GeneralLedger.postJournal = _wrapped;

        _wrapperInstalled = true;
        _logger().info('[ERP.PeriodLock] Wrapper installed on GeneralLedger.postJournal.');
        return { ok: true, error: null };
      }, { ok: false, error: 'INSTALL_EXCEPTION' });
    },

    closePeriod: function (periodId) {
      return _asyncResult(function (resolve) {
        if (!_isAdmin()) {
          return resolve({ ok: false, error: 'PERMISSION_DENIED' });
        }

        var ACC = _accCore();
        if (!ACC || !ACC.AccountingState) {
          return resolve({ ok: false, error: 'ACCOUNTING_NOT_READY' });
        }

        var periods = _getPeriods();
        var period  = periods.find(function (p) { return p && p.id === periodId; });
        if (!period) {
          return resolve({ ok: false, error: 'PERIOD_NOT_FOUND: ' + periodId });
        }
        if (_isPeriodClosed(period)) {
          return resolve({ ok: false, error: 'ALREADY_CLOSED' });
        }

        var before = Object.assign({}, period);

        var patch = {
          status: 'closed',
          locked: true,
          closedAt: _nowISO(),
          closedBy: (_currentUser() || {}).username || 'System'
        };

        var closed = _applyPeriodUpdate(ACC, period, periodId, patch, 'p11:period:close:' + periodId);

        if (!closed) {
          return resolve({ ok: false, error: 'CLOSE_FAILED' });
        }

        _auditRecord('close', periodId, before, { status: 'closed' });
        _logger().info('[ERP.PeriodLock] Period ' + periodId + ' closed.');
        resolve({ ok: true, error: null });
      }, { ok: false, error: 'UNEXPECTED_ERROR' });
    },

    reopenPeriod: function (periodId) {
      return _asyncResult(function (resolve) {
        if (!_isAdmin()) {
          return resolve({ ok: false, error: 'PERMISSION_DENIED' });
        }

        var ACC = _accCore();
        if (!ACC || !ACC.AccountingState) {
          return resolve({ ok: false, error: 'ACCOUNTING_NOT_READY' });
        }

        var periods = _getPeriods();
        var period  = periods.find(function (p) { return p && p.id === periodId; });
        if (!period) {
          return resolve({ ok: false, error: 'PERIOD_NOT_FOUND: ' + periodId });
        }
        if (!_isPeriodClosed(period)) {
          return resolve({ ok: true, error: null });
        }

        var before = Object.assign({}, period);

        var patch = {
          status: 'open',
          locked: false,
          reopenedAt: _nowISO(),
          reopenedBy: (_currentUser() || {}).username || 'System'
        };

        var reopened = _applyPeriodUpdate(ACC, period, periodId, patch, 'p11:period:reopen:' + periodId);

        if (!reopened) {
          return resolve({ ok: false, error: 'REOPEN_FAILED' });
        }

        _auditRecord('reopen', periodId, before, { status: 'open' });
        _logger().info('[ERP.PeriodLock] Period ' + periodId + ' reopened.');
        resolve({ ok: true, error: null });
      }, { ok: false, error: 'UNEXPECTED_ERROR' });
    },

    listPeriods: function () {
      return _try(function () {
        var periods = _getPeriods();
        var result = [];
        for (var i = 0; i < periods.length; i++) {
          var p = periods[i];
          var entry = _try(function () {
            if (!p || !p.id) return null;
            return {
              id:     p.id,
              status: p.status || 'open',
              locked: _isPeriodClosed(p),
              label:  p.label || p.name || p.id
            };
          }, null);
          if (entry) result.push(entry);
        }
        return result;
      }, []);
    },

    isInstalled: function () {
      return _wrapperInstalled;
    }
  };

  ERP.__phase11_periodLock = true;

  function _autoInstall() {
    _try(function () {
      var flagOn = ERP.FeatureFlags &&
                   typeof ERP.FeatureFlags.get === 'function' &&
                   ERP.FeatureFlags.get('period_lock');
      if (flagOn) {
        ERP.PeriodLock.install();
      }

      if (ERP.EventBus && typeof ERP.EventBus.on === 'function') {
        ERP.EventBus.on('flag:changed', function (data) {
          if (data && data.flag === 'period_lock' && data.newValue === true) {
            ERP.PeriodLock.install();
          }
        });
      }
    });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(_autoInstall, 100);
  } else {
    document.addEventListener('DOMContentLoaded', _autoInstall, { once: true });
  }

  _try(function () {
    _logger().info('[ERP.PeriodLock] Phase 11.5 loaded — v11.5.3');
  });

}(window));
