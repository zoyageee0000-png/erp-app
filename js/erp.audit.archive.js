
'use strict';

(function (root) {
  'use strict';

  if (root.ERP && root.ERP.__phase11_auditArchive) return;

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
      _logger().warn('[ERP.AuditArchive] _try: ' + (e && e.message || e));
      return (fallback !== undefined ? fallback : null);
    }
  }

  function _auditTrail() {
    return root.AuditTrail || null;
  }

  // Single source of truth for the audit-log localStorage key: same
  // resolution order audit_trail.js itself uses (ERP.CONSTANTS.STORAGE_KEYS.AUDIT,
  // falling back to the literal key). Avoids a hardcoded 'mh_audit_log' string
  // here silently drifting from the canonical key if it's ever reconfigured.
  function _auditLsKey() {
    return (ERP && ERP.CONSTANTS && ERP.CONSTANTS.STORAGE_KEYS && ERP.CONSTANTS.STORAGE_KEYS.AUDIT)
      || 'mh_audit_log';
  }

  function _db() {
    return (ERP && ERP._db) ? ERP._db : null;
  }

  var ARCHIVE_TRIGGER   = 400;
  var ARCHIVE_COUNT     = 200;
  var IDB_STORE         = 'auditArchive';
  var CHECK_INTERVAL_MS = 60000;
  var _intervalId       = null;

  function _idbSave(entries) {
    return new Promise(function (resolve, reject) {
      _try(function () {
        var db = _db();
        if (!db || typeof db.save !== 'function') {
          return reject(new Error('IDB_UNAVAILABLE'));
        }
        db.load(IDB_STORE).then(function (existing) {
          var archive = Array.isArray(existing) ? existing : [];
          archive = archive.concat(entries);
          return db.save(IDB_STORE, archive);
        }).then(function () {
          resolve(entries.length);
        }).catch(function (e) {
          reject(e);
        });
      });
    });
  }

  function _idbLoad() {
    return new Promise(function (resolve) {
      try {
        var db = _db();
        if (!db || typeof db.load !== 'function') { resolve([]); return; }
        db.load(IDB_STORE).then(function (data) {
          resolve(Array.isArray(data) ? data : []);
        }).catch(function () { resolve([]); });
      } catch (e) { resolve([]); }
    });
  }

  function _doArchive() {
    return new Promise(function (resolve) {
      _try(function () {
        var AT = _auditTrail();
        if (!AT || typeof AT.getAll !== 'function') {
          return resolve({ archived: 0, remaining: 0, error: 'AUDIT_TRAIL_UNAVAILABLE' });
        }

        var allEntries = AT.getAll();
        if (!Array.isArray(allEntries) || allEntries.length < ARCHIVE_TRIGGER) {
          return resolve({ archived: 0, remaining: allEntries ? allEntries.length : 0 });
        }

        var toArchive = allEntries.slice(0, ARCHIVE_COUNT);
        var toKeep    = allEntries.slice(ARCHIVE_COUNT);

        var archivedAt = new Date().toISOString();
        toArchive = toArchive.map(function (e) {
          return Object.assign({}, e, { _archivedAt: archivedAt });
        });

        _idbSave(toArchive).then(function (count) {
          _try(function () {
            var AT3 = _auditTrail();
            var currentEntries = (AT3 && typeof AT3.getAll === 'function') ? AT3.getAll() : null;

            if (Array.isArray(currentEntries)) {
              // The audit log is append-only, so the N entries we archived are
              // necessarily still the oldest N entries in the live log (new entries
              // can only have been appended after them, never inserted before).
              // Dropping by count from the front avoids the previous approach's bug:
              // deriving a fallback key from timestamp+action+actor and matching by
              // that key, which could collide between an archived entry and a
              // different live entry (e.g. two entries logged in the same
              // millisecond with the same action and actor), silently deleting
              // un-archived data.
              //
              // Guard against the live log having shrunk to fewer entries than we
              // archived (e.g. a concurrent reset) — in that case dropping by count
              // would be wrong, so fail safe and leave the log untouched.
              if (currentEntries.length < toArchive.length) {
                _logger().error('[ERP.AuditArchive] Live audit log shrank below archived count (' +
                  currentEntries.length + ' < ' + toArchive.length + ') — leaving mh_audit_log untouched.');
                toKeep = currentEntries;
              } else {
                var stillRemaining = currentEntries.slice(toArchive.length);
                localStorage.setItem(_auditLsKey(), JSON.stringify(stillRemaining));
                toKeep = stillRemaining;
              }
            } else {
              localStorage.setItem(_auditLsKey(), JSON.stringify(toKeep));
            }
          });

          _try(function () {
            var AT2 = _auditTrail();
            if (AT2 && typeof AT2.record === 'function') {
              AT2.record('system', 'audit_archive', 'archive',
                { count: count, archivedAt: archivedAt }, null, 'System');
            }
          });

          _logger().info('[ERP.AuditArchive] Archived ' + count + ' entries to IDB. Remaining: ' + toKeep.length);
          resolve({ archived: count, remaining: toKeep.length });

        }).catch(function (e) {
          _logger().error('[ERP.AuditArchive] IDB write failed — entries kept in localStorage: ' + (e && e.message || e));
          resolve({ archived: 0, remaining: allEntries.length, error: 'IDB_WRITE_FAILED' });
        });
      });
    });
  }

  function _checkAndArchive() {
    return _try(function () {
      var flagOff = ERP.FeatureFlags &&
                    typeof ERP.FeatureFlags.get === 'function' &&
                    ERP.FeatureFlags.get('audit_archive') === false;
      if (flagOff) return Promise.resolve({ archived: 0, remaining: 0, flagOff: true });

      var AT = _auditTrail();
      if (!AT || typeof AT.getAll !== 'function') return Promise.resolve({ archived: 0, remaining: 0 });

      var entries = AT.getAll();
      if (!Array.isArray(entries) || entries.length < ARCHIVE_TRIGGER) {
        return Promise.resolve({ archived: 0, remaining: entries ? entries.length : 0 });
      }

      return _doArchive();
    }) || Promise.resolve({ archived: 0, remaining: 0 });
  }

  ERP.AuditArchive = {
    __phase11_auditArchive: true,
    VERSION: '11.10.3',

    checkAndArchive: function () {
      return _checkAndArchive();
    },

    archiveNow: function () {
      return _doArchive();
    },

    search: function (filter) {
      filter = filter || {};
      return new Promise(function (resolve) {
        var live = _try(function () {
          var AT = _auditTrail();
          return AT && typeof AT.getAll === 'function' ? AT.getAll() : [];
        }, []);

        _idbLoad().then(function (archived) {
          var all = (archived || []).concat(live || []);

          var filtered = all.filter(function (e) {
            if (!e) return false;
            if (filter.domain   && e.module     !== filter.domain)   return false;
            if (filter.recordId && e.documentId !== filter.recordId) return false;
            if (filter.action   && e.action     !== filter.action)   return false;
            if (filter.user     && e.actor      !== filter.user)     return false;
            if (filter.fromDate && (e.timestamp || 0) < filter.fromDate) return false;
            if (filter.toDate   && (e.timestamp || 0) > filter.toDate)   return false;
            return true;
          });

          filtered.sort(function (a, b) {
            var at = a.timestamp || 0;
            var bt = b.timestamp || 0;
            return at < bt ? -1 : at > bt ? 1 : 0;
          });

          resolve(filtered);
        }).catch(function () {
          resolve(live || []);
        });
      });
    },

    exportAll: function () {
      return ERP.AuditArchive.search({});
    },

    startMonitoring: function (checkIntervalMs) {
      if (_intervalId) {
        _logger().warn('[ERP.AuditArchive] startMonitoring called while already running — ignoring new interval.');
        return;
      }
      var ms = (typeof checkIntervalMs === 'number' && checkIntervalMs > 0)
               ? checkIntervalMs : CHECK_INTERVAL_MS;
      _intervalId = ERP.TimerRegistry.start('auditArchive.periodicCheck', function () {
        _checkAndArchive().catch(function (e) { _logger().warn('[ERP.AuditArchive] background archive check failed:', e && e.message || e); });
      }, ms);
      _logger().info('[ERP.AuditArchive] Monitoring started (every ' + Math.round(ms / 1000) + 's).');
    },

    stopMonitoring: function () {
      if (_intervalId) {
        ERP.TimerRegistry.clear('auditArchive.periodicCheck');
        _intervalId = null;
        _logger().info('[ERP.AuditArchive] Monitoring stopped.');
      }
    },

    getArchiveCount: function () {
      return _idbLoad().then(function (arr) { return arr.length; }).catch(function () { return 0; });
    }
  };

  ERP.__phase11_auditArchive = true;

  function _installEventListener() {
    _try(function () {
      if (ERP.EventBus && typeof ERP.EventBus.on === 'function') {
        ERP.EventBus.on('audit:nearCap', function () {
          var flagOff = ERP.FeatureFlags &&
                        typeof ERP.FeatureFlags.get === 'function' &&
                        ERP.FeatureFlags.get('audit_archive') === false;
          if (flagOff) return;
          _checkAndArchive().catch(function (e) { _logger().warn('[ERP.AuditArchive] background archive check failed:', e && e.message || e); });
        });

        ERP.EventBus.on('flag:changed', function (data) {
          if (!data || data.flag !== 'audit_archive') return;
          if (data.newValue === false) {
            ERP.AuditArchive.stopMonitoring();
          } else if (data.newValue === true) {
            ERP.AuditArchive.startMonitoring(CHECK_INTERVAL_MS);
            _checkAndArchive().catch(function (e) { _logger().warn('[ERP.AuditArchive] background archive check failed:', e && e.message || e); });
          }
        });
      }
    });
  }

  function _autoStart() {
    _try(function () {
      _installEventListener();

      var flagOff = ERP.FeatureFlags &&
                    typeof ERP.FeatureFlags.get === 'function' &&
                    ERP.FeatureFlags.get('audit_archive') === false;
      if (flagOff) return;
      ERP.AuditArchive.startMonitoring(CHECK_INTERVAL_MS);
      setTimeout(function () { _checkAndArchive().catch(function (e) { _logger().warn('[ERP.AuditArchive] background archive check failed:', e && e.message || e); }); }, 3000);
    });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(_autoStart, 0);
  } else {
    document.addEventListener('DOMContentLoaded', _autoStart);
  }

  _logger().info('[ERP.AuditArchive] Phase 11.10 loaded — v11.10.3');

}(window));
