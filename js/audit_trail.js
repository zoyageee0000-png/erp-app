'use strict';

(function _auditTrailModule() {

  const AUDIT_LS_KEY      = 'mh_audit_log';
  const AUDIT_IDB_STORE   = 'auditLog';
  const AUDIT_LS_MAX      = 500;
  const VALID_SEVERITIES  = ['info', 'warning', 'error', 'critical'];

  function _now() {
    try {
      if (typeof ERP !== 'undefined' && ERP.DateUtils && typeof ERP.DateUtils.now === 'function') {
        return ERP.DateUtils.now();
      }
    } catch (_e) {
      console.warn('[AuditLog] _now(): ERP.DateUtils.now() failed, falling back to Date.now()', _e);
    }
    return Date.now();
  }

  function _uid() {
    // FIX (root cause, audit #61-62): every one of the 7-8 files with this
    // pattern used to keep its own differently-shaped fallback for when
    // ERP.uid() "might" be unavailable. core.js (which defines ERP.uid) is the
    // very first script loaded in index.html -- before all other 91 scripts --
    // so if it's missing, the whole app has already failed to boot; a local
    // fallback here bought nothing but a second, weaker ID scheme. Always use
    // the one canonical, collision-safe generator; keep the domain prefix for
    // readability when scanning stored data.
    return 'AL-' + ERP.uid();
  }

  function _actor() {
    try {
      if (typeof ERP !== 'undefined' && ERP._internal && ERP._internal.getState) {
        const sess = ERP._internal.getState().session;
        return (sess && sess.user && sess.user.username) || 'system';
      }
    } catch (_e) {
      console.warn('[AuditLog] _actor(): failed to read session, defaulting to "system"', _e);
    }
    return 'system';
  }

  function _auditLsKey() {
    return (typeof ERP !== 'undefined' && ERP.CONSTANTS && ERP.CONSTANTS.STORAGE_KEYS)
      ? ERP.CONSTANTS.STORAGE_KEYS.AUDIT
      : AUDIT_LS_KEY;
  }

  function _djb2(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
  }

  function _lastChainHash() {
    try {
      const raw = localStorage.getItem(_auditLsKey());
      let list = [];
      try {
        list = raw ? JSON.parse(raw) : [];
      } catch (_pe) {
        console.warn('[AuditLog] _lastChainHash(): failed to parse stored audit log JSON', _pe);
        list = [];
      }
      if (Array.isArray(list) && list.length) {
        const last = list[list.length - 1];
        return (last && last.hash) || 'GENESIS';
      }
    } catch (_e) {
      console.warn('[AuditLog] _lastChainHash(): failed to read localStorage', _e);
    }
    return 'GENESIS';
  }

  function _idbAppend(entry) {
    try {
      // Route through ERP._db (db.js) rather than opening our own separate
      // IndexedDB connection here. The previous approach called
      // indexedDB.open(dbName, dbVersion) directly with an EMPTY
      // onupgradeneeded handler. If that connection happened to be the first
      // one to open the database (e.g. on a fresh profile, racing ahead of
      // db.js's own open() during boot), IndexedDB only grants the
      // schema-creation callback to whichever open() call gets there first —
      // and this one created no object stores. Once that happens the database
      // is left at its target version with no stores at all, permanently
      // (onupgradeneeded only fires again on a version bump, not on reload),
      // so every future write silently falls back to localStorage-only forever.
      //
      // db.js owns the actual schema (DB_STORES, _DB_KEY_MAP) and is the only
      // module that should ever run indexedDB.open() for this database.
      var idb = (typeof ERP !== 'undefined') ? ERP._db : null;
      if (!idb || typeof idb.save !== 'function') return;
      if (typeof idb._isOpen === 'function' && !idb._isOpen()) return;

      Promise.resolve(idb.save(AUDIT_IDB_STORE, entry)).catch(function (e) {
        console.warn('[AuditLog] _idbAppend(): db.save() failed:', e);
      });
    } catch (_e) {
      console.warn('[AuditLog] _idbAppend(): unexpected error', _e);
    }
  }

  function _lsAppend(entry) {
    try {
      const key = (typeof ERP !== 'undefined' && ERP.CONSTANTS && ERP.CONSTANTS.STORAGE_KEYS)
                ? ERP.CONSTANTS.STORAGE_KEYS.AUDIT
                : AUDIT_LS_KEY;

      const raw  = localStorage.getItem(key);
      let list = [];
      try {
        list = raw ? JSON.parse(raw) : [];
      } catch (_pe) {
        console.warn('[AuditLog] _lsAppend(): failed to parse stored audit log JSON, resetting', _pe);
        list = [];
      }
      if (!Array.isArray(list)) list = [];

      list.push(entry);

      if (list.length > AUDIT_LS_MAX) {
        list = list.slice(list.length - AUDIT_LS_MAX);
      }

      try {
        localStorage.setItem(key, JSON.stringify(list));
      } catch (_q) {
        console.warn('[AuditLog] _lsAppend(): localStorage.setItem failed (quota?), trimming to last 100', _q);
        try {
          localStorage.setItem(key, JSON.stringify(list.slice(-100)));
        } catch (_q2) {
          console.warn('[AuditLog] _lsAppend(): trimmed write also failed', _q2);
        }
      }
    } catch (_e) {
      console.warn('[AuditLog] _lsAppend(): unexpected error', _e);
    }
  }

  function _idbClear() {
    try {
      // Same fix as _idbAppend(): route through ERP._db (db.js) instead of a
      // separate indexedDB.open() call, so this can't race db.js's schema
      // creation. db.js's save() runs an objectStore.clear() automatically
      // when given an array, so passing [] clears the store without needing
      // a dedicated clear() method on the public db API.
      var idb = (typeof ERP !== 'undefined') ? ERP._db : null;
      if (!idb || typeof idb.save !== 'function') return;
      if (typeof idb._isOpen === 'function' && !idb._isOpen()) return;

      Promise.resolve(idb.save(AUDIT_IDB_STORE, [])).catch(function (e) {
        console.warn('[AuditLog] _idbClear(): db.save() failed:', e);
      });
    } catch (_e) {
      console.warn('[AuditLog] _idbClear(): unexpected error', _e);
    }
  }

  var AuditLog = {

    write: function (opts) {
      try {
        if (!opts || typeof opts !== 'object') return;

        const id       = opts.id        || _uid();
        const severity = (opts.severity && VALID_SEVERITIES.indexOf(opts.severity) !== -1)
                       ? opts.severity : 'info';

        const entry = {
          id:         id,
          txId:       opts.txId       || id,
          actor:      opts.actor      || _actor(),
          action:     opts.action     || 'unknown',
          module:     opts.module     || 'unknown',
          documentId: opts.documentId || null,
          before:     opts.before     !== undefined ? opts.before : null,
          after:      opts.after      !== undefined ? opts.after  : null,
          timestamp:  opts.timestamp  || _now(),
          severity:   severity,
          prevHash:   _lastChainHash(),
        };
        entry.hash = _djb2(JSON.stringify(entry));

        _lsAppend(entry);

        _idbAppend(entry);

      } catch (_e) {
        if (typeof window !== 'undefined' && window !== null && window.DEBUG_MODE) {
          console.warn('[AuditLog] write() internal error:', _e);
        }
      }
    },

    record: function (category, recordId, action, before, after, actor) {
      AuditLog.write({
        module:     category,
        documentId: recordId,
        action:     action,
        before:     before,
        after:      after,
        actor:      actor,
      });
    },

    getAll: function () {
      try {
        const raw = localStorage.getItem(_auditLsKey());
        let list = [];
        try {
          list = raw ? JSON.parse(raw) : [];
        } catch (_pe) {
          console.warn('[AuditLog] getAll(): failed to parse stored audit log JSON', _pe);
          list = [];
        }
        return Array.isArray(list) ? list : [];
      } catch (_e) {
        console.warn('[AuditLog] getAll(): failed to read localStorage', _e);
        return [];
      }
    },

    verifyChain: function () {
      return new Promise(function (resolve) {
        try {
          const list = AuditLog.getAll();
          const breaks = [];
          let expectedPrev = null;
          list.forEach(function (e, i) {
            if (!e || !e.hash) {
              breaks.push({ index: i, id: e && e.id, reason: 'MISSING_HASH' });
              return;
            }
            if (expectedPrev !== null && e.prevHash !== expectedPrev) {
              breaks.push({ index: i, id: e.id, reason: 'CHAIN_BREAK' });
            }
            const core = Object.assign({}, e);
            const storedHash = core.hash;
            delete core.hash;
            const recomputed = _djb2(JSON.stringify(core));
            if (recomputed !== storedHash) {
              breaks.push({ index: i, id: e.id, reason: 'HASH_MISMATCH' });
            }
            expectedPrev = storedHash;
          });
          resolve({ ok: breaks.length === 0, breaks: breaks });
        } catch (e) {
          resolve({ ok: false, breaks: [{ reason: 'VERIFY_ERROR', error: e && e.message }] });
        }
      });
    },

    query: function (filter) {
      try {
        const key = (typeof ERP !== 'undefined' && ERP.CONSTANTS && ERP.CONSTANTS.STORAGE_KEYS)
                  ? ERP.CONSTANTS.STORAGE_KEYS.AUDIT : AUDIT_LS_KEY;
        const raw  = localStorage.getItem(key);
        let list = [];
        try {
          list = raw ? JSON.parse(raw) : [];
        } catch (_pe) {
          console.warn('[AuditLog] query(): failed to parse stored audit log JSON', _pe);
          list = [];
        }
        if (!Array.isArray(list)) return [];

        const f = filter || {};
        const limit = Math.min(Number(f.limit) || 200, 500);

        const result = list.filter(function (e) {
          if (f.module   && e.module   !== f.module)                    return false;
          if (f.actor    && e.actor    !== f.actor)                     return false;
          if (f.severity && e.severity !== f.severity)                  return false;
          if (f.action   && (e.action || '').indexOf(f.action) !== 0)   return false;
          if (f.since    && e.timestamp < f.since)                      return false;
          return true;
        });

        result.sort(function (a, b) { return b.timestamp - a.timestamp; });
        return result.slice(0, limit);
      } catch (_e) {
        console.warn('[AuditLog] query(): unexpected error', _e);
        return [];
      }
    },

    export: function () {
      try {
        const key = (typeof ERP !== 'undefined' && ERP.CONSTANTS && ERP.CONSTANTS.STORAGE_KEYS)
                  ? ERP.CONSTANTS.STORAGE_KEYS.AUDIT : AUDIT_LS_KEY;
        const raw  = localStorage.getItem(key) || '[]';
        const blob = new Blob([raw], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = 'audit-log-' + _now() + '.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 200);
      } catch (_e) {
        if (typeof window !== 'undefined' && window !== null && window.DEBUG_MODE) {
          console.warn('[AuditLog] export() failed:', _e);
        }
      }
    },

    clear: function () {
      try {
        const key = (typeof ERP !== 'undefined' && ERP.CONSTANTS && ERP.CONSTANTS.STORAGE_KEYS)
                  ? ERP.CONSTANTS.STORAGE_KEYS.AUDIT : AUDIT_LS_KEY;
        localStorage.removeItem(key);
      } catch (_e) {
        console.warn('[AuditLog] clear(): failed to remove audit log from localStorage', _e);
      }
      _idbClear();
    },
  };

  const root = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : {});
  root.ERP = root.ERP || {};
  if (!root.ERP.AuditLog) {
    root.ERP.AuditLog = AuditLog;
  }
  if (!root.AuditTrail) {
    root.AuditTrail = root.ERP.AuditLog;
  }

}());
