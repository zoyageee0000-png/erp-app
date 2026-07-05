
'use strict';

(function (root) {
  'use strict';

  if (root.ERP && root.ERP.__phase11_flags) return;

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
      _logger().warn('[ERP.FeatureFlags] _try: ' + (e && e.message || e));
      return (fallback !== undefined ? fallback : null);
    }
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

  var LS_KEY         = 'erp_feature_flags';
  var FLAG_VERSION   = 1;

  var FLAG_DEFAULTS = {
    shadow_sales:          false,
    shadow_purchase:       false,
    shadow_inventory:      false,
    shadow_reports:        false,
    period_lock:           true,
    tax_engine:            false,
    storage_guardian:      true,
    concurrency_guard:     true,
    backup_engine:         true,
    audit_archive:         true,
    gst_engine:            false,
    user_lifecycle:        false,
    backup_reminder:       true,
    multi_tab_coordinator: false
  };

  var FORCED_ON_FLAGS = {
    concurrency_guard: true,
    storage_guardian:  true,
    period_lock:       true
  };

  function _loadFlags() {
    return _try(function () {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return Object.assign({}, FLAG_DEFAULTS, FORCED_ON_FLAGS);

      var stored = JSON.parse(raw);

      if (stored.version && stored.version !== FLAG_VERSION) {
        _logger().warn('[ERP.FeatureFlags] Flag schema version mismatch (stored:' + stored.version + ' current:' + FLAG_VERSION + ') — resetting to defaults.');
        return Object.assign({}, FLAG_DEFAULTS, FORCED_ON_FLAGS);
      }

      var merged = Object.assign({}, FLAG_DEFAULTS, stored.flags || stored, FORCED_ON_FLAGS);

      var result = {};
      Object.keys(FLAG_DEFAULTS).forEach(function (k) {
        result[k] = merged[k];
      });
      Object.keys(FORCED_ON_FLAGS).forEach(function (k) {
        result[k] = FORCED_ON_FLAGS[k];
      });

      return result;
    }, Object.assign({}, FLAG_DEFAULTS));
  }

  function _saveFlags(flags) {
    return _try(function () {
      localStorage.setItem(LS_KEY, JSON.stringify({
        version:   FLAG_VERSION,
        updatedAt: new Date().toISOString(),
        flags:     flags
      }));
      return true;
    }, false);
  }

  var _flags = _loadFlags();

  ERP.FeatureFlags = {
    __phase11_flags: true,
    VERSION: '11.3.1',

    get: function (flagKey) {
      return _try(function () {
        if (!(flagKey in _flags) && !(flagKey in FLAG_DEFAULTS)) {
          _logger().warn('[ERP.FeatureFlags] Unknown flag: ' + flagKey + ' — returning false');
          return false;
        }
        return !!_flags[flagKey];
      }, false);
    },

    set: function (flagKey, value) {
      return _try(function () {
        if (!(flagKey in FLAG_DEFAULTS)) {
          _logger().warn('[ERP.FeatureFlags] set(' + flagKey + ') rejected — unknown flag.');
          return { ok: false, error: 'UNKNOWN_FLAG' };
        }

        var authLoaded = !!(ERP.auth || root.auth);
        var curUser = _currentUser();
        if (authLoaded && curUser && !_isAdmin()) {
          _logger().warn('[ERP.FeatureFlags] set(' + flagKey + ') blocked — Admin role required.');
          return { ok: false, error: 'PERMISSION_DENIED' };
        }
        if (authLoaded && !curUser) {
          _logger().warn('[ERP.FeatureFlags] set(' + flagKey + ') — no session, allowing (early boot).');
        }

        if (FORCED_ON_FLAGS[flagKey] && !value && !_isAdmin()) {
          _logger().warn('[ERP.FeatureFlags] ' + flagKey + ' is a safety-critical flag — only Admin can disable.');
          return { ok: false, error: 'FORCED_FLAG' };
        }

        var oldValue = _flags[flagKey];
        _flags[flagKey] = !!value;

        var saved = _saveFlags(_flags);
        if (!saved) {
          _flags[flagKey] = oldValue;
          return { ok: false, error: 'STORAGE_FAILED' };
        }

        _try(function () {
          if (root.AuditTrail && typeof root.AuditTrail.record === 'function') {
            var u = _currentUser();
            root.AuditTrail.record('feature_flags', flagKey, 'toggle',
              { value: oldValue }, { value: !!value },
              (u && u.username) || 'System');
          }
        });

        _try(function () {
          ERP.EventBus && ERP.EventBus.emit &&
            ERP.EventBus.emit('flag:changed', { flag: flagKey, oldValue: oldValue, newValue: !!value });
        });

        _logger().info('[ERP.FeatureFlags] ' + flagKey + ': ' + oldValue + ' → ' + !!value);
        return { ok: true, error: null };
      }, { ok: false, error: 'SET_EXCEPTION' });
    },

    getAll: function () {
      return _try(function () {
        return Object.assign({}, _flags);
      }, {});
    },

    reset: function (flagKey) {
      return _try(function () {
        if (!(flagKey in FLAG_DEFAULTS)) {
          return { ok: false, error: 'UNKNOWN_FLAG' };
        }
        return ERP.FeatureFlags.set(flagKey, FLAG_DEFAULTS[flagKey]);
      }, { ok: false, error: 'RESET_EXCEPTION' });
    },

    resetAll: function () {
      return _try(function () {
        var authLoaded = !!(ERP.auth);
        var user = _currentUser();
        if (authLoaded && user && !_isAdmin()) {
          return { ok: false, error: 'PERMISSION_DENIED' };
        }
        var previousFlags = Object.assign({}, _flags);
        _flags = Object.assign({}, FLAG_DEFAULTS, FORCED_ON_FLAGS);
        var saved = _saveFlags(_flags);
        if (!saved) {
          _flags = previousFlags;
          return { ok: false, error: 'STORAGE_FAILED' };
        }
        _logger().info('[ERP.FeatureFlags] All flags reset to defaults.');
        return { ok: true, error: null };
      }, { ok: false, error: 'RESET_ALL_EXCEPTION' });
    },

    getDefaults: function () {
      return Object.assign({}, FLAG_DEFAULTS);
    }
  };

  ERP.flags = ERP.FeatureFlags;

  ERP.__phase11_flags = true;

  _logger().info('[ERP.FeatureFlags] Phase 11.3 loaded — v11.3.1 | Flags: ' + JSON.stringify(_flags));

}(window));
