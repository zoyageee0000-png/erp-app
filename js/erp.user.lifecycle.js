
'use strict';

(function (root) {
  'use strict';

  if (root.ERP && root.ERP.__phase11_userLifecycle) return;

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
      _logger().warn('[ERP.UserLifecycle] _try: ' + (e && e.message || e));
      return (fallback !== undefined ? fallback : null);
    }
  }

  function _auth() {
    return root.auth || (ERP.auth) || null;
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

  function _auditRecord(action, recordId, before, after) {
    _try(function () {
      if (root.AuditTrail && typeof root.AuditTrail.record === 'function') {
        var u = _currentUser();
        root.AuditTrail.record('users', recordId, action,
          before, after, (u && u.username) || 'System');
      }
    });
  }

  var PERMISSIONS = {
    'view_reports':       'Staff',
    'create_invoice':     'Staff',
    'create_po':          'Staff',
    'export_backup':      'Staff',
    'close_period':       'Admin',
    'reopen_period':      'Admin',
    'void_invoice':       'Admin',
    'delete_record':      'Admin',
    'add_user':           'Admin',
    'remove_user':        'Admin',
    'toggle_flags':       'Admin',
    'view_audit_log':     'Admin',
    'import_backup':      'Admin',
    'change_settings':    'Admin'
  };

  // FIX (dormant defect, found while mapping this model against ui.js's RBAC for a
  // possible future merge — not merging the two systems here, just correcting this
  // one): ROLE_LEVELS only knew about 'Staff' and 'Admin'. ui.js's RBAC recognizes
  // 7 roles (Admin, Manager, Accountant, Sales, Workshop, Staff, Viewer). Any role
  // other than those two normalized to level 0 here — below Staff — regardless of
  // how much page access that role actually has under RBAC. This has had no visible
  // effect yet because every operation actually gated through _hasPermission() today
  // (change_settings, delete_record, void_invoice, add_user, remove_user) requires
  // 'Admin', and all non-Admin roles correctly fail a >=2 check either way. But the
  // 4 operations defined at 'Staff' level (view_reports, create_invoice, create_po,
  // export_backup) would have silently under-permissioned a Manager, Accountant,
  // Sales, or Workshop user the moment any of them got wired up to a real gate,
  // despite RBAC granting those roles page access to exactly those areas. Levels
  // below assign every non-Admin, non-Viewer role to the same tier as Staff
  // (consistent with RBAC treating them as working roles with real page access);
  // Viewer — RBAC's read-only, dashboard-only role — stays below Staff.
  var ROLE_LEVELS = { 'Viewer': 0, 'Staff': 1, 'Workshop': 1, 'Sales': 1, 'Accountant': 1, 'Manager': 1, 'Admin': 2 };

  var KNOWN_ROLES = Object.keys(ROLE_LEVELS);

  function _normalizeRole(role) {
    if (typeof role !== 'string') return role;
    for (var i = 0; i < KNOWN_ROLES.length; i++) {
      if (KNOWN_ROLES[i].toLowerCase() === role.toLowerCase()) return KNOWN_ROLES[i];
    }
    return role;
  }

  function _hasPermission(operation) {
    return _try(function () {
      var required = PERMISSIONS[operation];
      var u = _currentUser();
      if (!required) return !!u;
      if (!u) return false;
      var userLevel     = ROLE_LEVELS[_normalizeRole(u.role)]  || 0;
      var requiredLevel = ROLE_LEVELS[required]                 || 99;
      return userLevel >= requiredLevel;
    }, false);
  }

  var _addUserWrapped = false;

  function _wrapAddUser() {
    if (_addUserWrapped) return;
    var authObj = _auth();
    if (!authObj || typeof authObj.addUser !== 'function') return;

    var _original = authObj.addUser.bind(authObj);
    authObj.addUser = function (uname, pwd, name, role, secqKey, secaVal) {
      if (!_hasPermission('add_user')) {
        _logger().warn('[ERP.UserLifecycle] addUser blocked — Admin required.');
        return Promise.resolve({ ok: false, error: 'PERMISSION_DENIED' });
      }

      if (typeof role === 'string' && role.toLowerCase() === 'admin') {
        _logger().warn('[ERP.UserLifecycle] addUser: Admin role requires explicit confirmation. Assigning Staff by default.');
        role = 'Staff';
      }
      if (!role) role = 'Staff';

      var resultPromise = Promise.resolve(_original(uname, pwd, name, role, secqKey, secaVal));

      return resultPromise.then(function (result) {
        var succeeded = !(result && result.ok === false);
        if (succeeded) {
          _auditRecord('create', uname, null, { username: uname, role: role });
          _logger().info('[ERP.UserLifecycle] User created: ' + uname + ' role: ' + role);
        } else {
          _logger().warn('[ERP.UserLifecycle] addUser returned error — audit skipped: ' +
                        (result && result.error));
        }
        return result;
      });
    };

    _addUserWrapped = true;
    _logger().info('[ERP.UserLifecycle] addUser wrapped.');
  }

  var _deleteUserWrapped = false;

  function _wrapDeleteUser() {
    if (_deleteUserWrapped) return;
    var authObj = _auth();
    if (!authObj) return;

    var deleteFnName = typeof authObj.deleteUser === 'function' ? 'deleteUser'
                     : typeof authObj.removeUser === 'function' ? 'removeUser'
                     : null;
    if (!deleteFnName) return;

    var _original = authObj[deleteFnName].bind(authObj);

    authObj[deleteFnName] = function (username) {
      if (!_hasPermission('remove_user')) {
        _logger().warn('[ERP.UserLifecycle] deleteUser blocked — Admin required.');
        return { ok: false, error: 'PERMISSION_DENIED' };
      }

      var before = _try(function () {
        return authObj.findUser && authObj.findUser(username);
      }, null);

      var result = _original(username);
      var succeeded = !(result && result.ok === false);

      if (succeeded) {
        _try(function () {
          if (root.AuditTrail && typeof root.AuditTrail.record === 'function') {
            root.AuditTrail.record('users', username, 'delete',
              before, { status: 'user_deleted' },
              (_currentUser() || {}).username || 'System');
          }
        });

        _try(function () {
          ERP.EventBus && ERP.EventBus.emit &&
            ERP.EventBus.emit('user:deleted', { username: username, before: before });
        });

        _logger().info('[ERP.UserLifecycle] User deleted: ' + username);
      } else {
        _logger().warn('[ERP.UserLifecycle] deleteUser returned error — audit skipped: ' +
                      (result && result.error));
      }

      return result;
    };

    _deleteUserWrapped = true;
    _logger().info('[ERP.UserLifecycle] deleteUser wrapped.');
  }

  ERP.UserLifecycle = {
    __phase11_userLifecycle: true,
    VERSION: '11.12.1',

    check: function (operation) {
      return _try(function () {
        var allowed = _hasPermission(operation);
        var u       = _currentUser();
        return {
          allowed: allowed,
          reason:  allowed ? 'OK' : 'INSUFFICIENT_ROLE',
          user:    u ? u.username : null,
          role:    u ? u.role : null
        };
      }, { allowed: false, reason: 'CHECK_ERROR', user: null, role: null });
    },

    isAdmin: function () {
      return _isAdmin();
    },

    getPermissions: function () {
      return Object.assign({}, PERMISSIONS);
    },

    currentUser: function () {
      return _try(function () {
        var u = _currentUser();
        return u ? { username: u.username, name: u.name, role: u.role } : null;
      }, null);
    },

    install: function () {
      _wrapAddUser();
      _wrapDeleteUser();
    }
  };

  ERP.__phase11_userLifecycle = true;

  function _autoInstall() {
    _try(function () {
      if (ERP.EventBus && typeof ERP.EventBus.on === 'function') {
        ERP.EventBus.on('flag:changed', function (data) {
          if (data && data.flag === 'user_lifecycle' && data.newValue === true) {
            ERP.UserLifecycle.install();
          }
        });
      }

      var flagOn = ERP.FeatureFlags &&
                   typeof ERP.FeatureFlags.get === 'function' &&
                   ERP.FeatureFlags.get('user_lifecycle');
      if (!flagOn) return;

      ERP.UserLifecycle.install();
    });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(_autoInstall, 200);
  } else {
    document.addEventListener('DOMContentLoaded', _autoInstall);
  }

  _logger().info('[ERP.UserLifecycle] Phase 11.12 loaded — v11.12.1');

}(window));
