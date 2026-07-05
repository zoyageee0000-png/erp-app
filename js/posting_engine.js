
(function (root) {
  'use strict';

  var ERP = root.ERP = root.ERP || {};
  if (ERP.PostingEngine && ERP.PostingEngine.__v2) return;

  var ACC = root.AccountingCore;
  if (!ACC) throw new Error('[PostingEngine] AccountingCore missing. Load accounting.constants.js first.');


  // Single source of truth: all error classes come from the canonical,
  // frozen ERP.errors registry defined in core.js. Do not redefine them here —
  // local copies previously drifted from the registry (different stack-capture
  // behavior) even though core.js loads before this file in index.html.
  if (!ERP.errors) throw new Error('[PostingEngine] ERP.errors missing. Load core.js first.');
  var ValidationError        = ERP.errors.ValidationError;
  var ConcurrencyError       = ERP.errors.ConcurrencyError;
  var DuplicatePostingError  = ERP.errors.DuplicatePostingError;
  var PermissionError        = ERP.errors.PermissionError;
  var WALRecoveryError       = ERP.errors.WALRecoveryError;

  // Thin wrapper kept for call-site compatibility; delegates enrichment
  // to the canonical ERP.mkError so metadata format never diverges.
  function _err(Ctor, message, module, operation, documentId, txId) {
    return ERP.mkError(Ctor, message, module, operation, documentId, txId);
  }


  function _state() {
    var st = ACC.AccountingState;
    if (!st) throw new Error('[PostingEngine] AccountingState is not initialized.');
    return st;
  }
  function _store() {
    var s = ACC.AccountingStore;
    if (!s) throw new Error('[PostingEngine] AccountingStore is not initialized.');
    return s;
  }
  function _events() { return ACC.AccountingEvents; }
  function _SA()     { return ACC.SYSTEM_ACCOUNTS; }
  function _SM()     { return ACC.SOURCE_MODULE; }

  var IDB_STORES        = ACC.IDB_STORES;
  var ACCOUNTING_EVENTS = ACC.ACCOUNTING_EVENTS;

  function _logger() {
    if (ERP.Logger) return ERP.Logger;
    return { info: function(){}, warn: function(){}, error: function(){} };
  }


  function _now() {
    if (ERP.DateUtils && typeof ERP.DateUtils.now === 'function') {
      return ERP.DateUtils.now();
    }
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var pkt = new Date(d.getTime() + (5 * 60 * 60 * 1000));
    return pkt.getUTCFullYear() + '-' + pad(pkt.getUTCMonth() + 1) + '-' + pad(pkt.getUTCDate()) +
           'T' + pad(pkt.getUTCHours()) + ':' + pad(pkt.getUTCMinutes()) + ':' + pad(pkt.getUTCSeconds()) +
           '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  function _today() {
    if (ERP.DateUtils && typeof ERP.DateUtils.today === 'function') {
      return ERP.DateUtils.today();
    }
    return _now().slice(0, 10);
  }

  function _isValidDateString(s) {
    if (!s || typeof s !== 'string') return false;
    return /^\d{4}-\d{2}-\d{2}/.test(s) && !isNaN(Date.parse(s));
  }


  // Delegates to the canonical ACC.Money.toPaisa (accounting_constants.js),
  // which is loaded before this file. No local parsing logic here anymore —
  // a local fallback would silently drift from the canonical parser again.
  function _toPaisa(v) {
    return ACC.Money.toPaisa(v);
  }


  // FIX (root cause, audit #61-66): this used to fall back to its own
  // crypto/Math.random-based ID scheme if ERP.uid was "unavailable" -- but
  // core.js (which defines ERP.uid) is the very first of 92 scripts loaded,
  // before posting_engine.js, so a missing ERP.uid here means core.js itself
  // failed to load, i.e. the app has already failed to boot. Financial
  // journal IDs and txIds are exactly the place this codebase's own
  // convention (Phase 0: fail-closed, not fail-open) applies most: refuse to
  // generate a posting ID from a second, undocumented scheme rather than
  // silently diverging from the one canonical generator every other module
  // uses for the same purpose.
  function _uid() {
    if (!ERP.uid || typeof ERP.uid !== 'function') {
      throw _err(ValidationError,
        'ERP.uid() is unavailable -- refusing to generate a posting id from a fallback scheme.',
        'PostingEngine', '_uid', null, null);
    }
    return 'PE-' + ERP.uid();
  }


  function _requireAdminOrSystem(actor, operation, documentId, txId) {
    var normalizedActor = (typeof actor === 'string') ? actor.toLowerCase() : '';
    if (normalizedActor === 'system') {
      var _sess = (ERP && ERP.Session) || (root.ERP && root.ERP.Session) || null;
      if (!_sess || typeof _sess.isSystemContext !== 'function') {
        _logger().warn('[PostingEngine] ERP.Session unavailable — cannot verify system context for: ' +
          operation + '. Falling back to Admin role check (fail-closed).');
      } else if (_sess.isSystemContext()) {
        return;
      } else {
        _logger().warn('[PostingEngine] actor=system claimed by non-system context for: ' + operation + '. Checking admin role.');
      }
    }
    var lifecycle = (ERP && ERP.UserLifecycle) ||
                    (root.ERP && root.ERP.UserLifecycle) || null;
    if (!lifecycle || typeof lifecycle.isAdmin !== 'function') {
      throw _err(PermissionError,
        'Cannot verify Admin role for: ' + operation + '. Actor: ' + actor +
        '. ERP.UserLifecycle is unavailable — GL posting denied (fail-closed).',
        'PostingEngine', operation, documentId, txId);
    }
    if (!lifecycle.isAdmin()) {
      throw _err(PermissionError,
        'Admin role required for: ' + operation + '. Current actor: ' + actor,
        'PostingEngine', operation, documentId, txId);
    }
  }


  var _walQueue = Promise.resolve();

  function _walLsWrite(entry, idbError) {
    return new Promise(function (resolve, reject) {
      _walQueue = _walQueue.then(function () {
        try {
          var lsKey    = 'erp_pe_wal_pending';
          var existing = [];
          try { existing = JSON.parse(localStorage.getItem(lsKey) || '[]'); } catch (_) { existing = []; }
          existing.push(entry);
          localStorage.setItem(lsKey, JSON.stringify(existing));
          resolve();
        } catch (lsErr) {
          var err = new Error('[WAL] Durable write failed — cannot proceed. IDB: ' +
            (idbError && idbError.message) + ' | LS: ' + (lsErr && lsErr.message));
          reject(err);
        }
      }).catch(function (qErr) {
        _walQueue = Promise.resolve();
        reject(qErr);
      });
    });
  }

  var WAL_STEPS = {
    'gl-posting':  ['lock_acquired', 'entries_validated', 'journal_built', 'journal_written', 'state_synced'],
    'gl-reversal': ['lock_acquired', 'originals_loaded', 'reversal_journals_written', 'reversal_index_written'],
  };

  async function _walWrite(type, documentId, payload) {
    var entry = {
      id:             _uid(),
      txId:           (payload.txId !== undefined && payload.txId !== null) ? payload.txId : _uid(),
      type:           type,
      status:         'pending',
      documentId:     documentId,
      steps:          WAL_STEPS[type] || [],
      completedSteps: [],
      payload:        payload,
      timestamp:      _now(),
    };
    try {
      await _store().putOne(IDB_STORES.WAL_ENTRIES || 'walEntries', entry);
    } catch (idbErr) {
      _logger().error('[PostingEngine][WAL] IDB write failed for', type, documentId, idbErr && idbErr.message);
      try {
        var _lsKey = 'erp_pe_wal_pending';
        var _lsExist = [];
        try { _lsExist = JSON.parse(localStorage.getItem(_lsKey) || '[]'); } catch (_) { _lsExist = []; }
        if (_lsExist.length > 200) {
          _lsExist = _lsExist.filter(function (e) { return e.status !== 'committed' && e.status !== 'rolled_back'; });
          if (_lsExist.length > 150) _lsExist = _lsExist.slice(-150);
          localStorage.setItem(_lsKey, JSON.stringify(_lsExist));
        }
      } catch (_) {}
      var backoffMs = 10;
      for (var retry = 0; retry < 5; retry++) {
        try {
          await _walLsWrite(entry, idbErr);
          break;
        } catch (lsErr) {
          if (retry === 4) throw lsErr;
          await new Promise(function(r) { setTimeout(r, backoffMs); });
          backoffMs *= 2;
        }
      }
    }
    return entry;
  }

  async function _walAdvanceStep(entry, stepName) {
    if (!entry) return entry;
    var updated = Object.assign({}, entry, {
      completedSteps: (entry.completedSteps || []).concat([stepName]),
    });
    try {
      await _store().putOne(IDB_STORES.WAL_ENTRIES || 'walEntries', updated);
    } catch (_) {}
    return updated;
  }

  var _walCommitCount = 0;
  var WAL_PRUNE_INTERVAL = 100;
  var WAL_MAX_COMMITTED = 500;

  async function _walPruneCommitted() {
    try {
      var lsKey = 'erp_pe_wal_pending';
      var existing = [];
      try { existing = JSON.parse(localStorage.getItem(lsKey) || '[]'); } catch (_) { existing = []; }
      var pruned = existing.filter(function (e) { return e.status !== 'committed' && e.status !== 'rolled_back'; });
      if (pruned.length < existing.length) {
        localStorage.setItem(lsKey, JSON.stringify(pruned));
      }
    } catch (_) {}
    try {
      var lsKeyCommitted = 'erp_pe_wal_committed';
      var existingC = [];
      try { existingC = JSON.parse(localStorage.getItem(lsKeyCommitted) || '[]'); } catch (_) { existingC = []; }
      if (existingC.length > WAL_MAX_COMMITTED) {
        localStorage.setItem(lsKeyCommitted, JSON.stringify(existingC.slice(-WAL_MAX_COMMITTED)));
      }
    } catch (_) {}
    try {
      if (_store().pruneWal && typeof _store().pruneWal === 'function') {
        await _store().pruneWal(IDB_STORES.WAL_ENTRIES || 'walEntries', WAL_MAX_COMMITTED);
      }
    } catch (_) {}
  }

  async function _walCommit(entry) {
    var committed = Object.assign({}, entry, { status: 'committed' });
    try {
      await _store().putOne(IDB_STORES.WAL_ENTRIES || 'walEntries', committed);
    } catch (e) {
      _logger().error('[PostingEngine][WAL] Commit failed for entry', committed.id, e && e.message);
      try {
        var lsKey = 'erp_pe_wal_committed';
        var existing = [];
        try { existing = JSON.parse(localStorage.getItem(lsKey) || '[]'); } catch (_) { existing = []; }
        existing.push(committed);
        if (existing.length > WAL_MAX_COMMITTED) existing = existing.slice(-WAL_MAX_COMMITTED);
        localStorage.setItem(lsKey, JSON.stringify(existing));
      } catch (_) {}
    }
    _walCommitCount++;
    if (_walCommitCount % WAL_PRUNE_INTERVAL === 0) {
      _walPruneCommitted().catch(function (_) {});
    }
    return committed;
  }

  async function _walRollback(entry) {
    var rolledBack = Object.assign({}, entry, { status: 'rolled_back' });
    try {
      await _store().putOne(IDB_STORES.WAL_ENTRIES || 'walEntries', rolledBack);
    } catch (e) {
      _logger().error('[PostingEngine][WAL] Rollback failed for entry', rolledBack.id, e && e.message);
    }
    return rolledBack;
  }


  async function _audit(txId, actor, action, module, documentId, before, after, severity) {
    var entry = {
      id:         _uid(),
      txId:       txId,
      actor:      actor,
      action:     action,
      module:     module,
      documentId: documentId,
      before:     before  || null,
      after:      after   || null,
      timestamp:  _now(),
      severity:   severity || 'info',
    };
    try {
      if (ERP.AuditLog && typeof ERP.AuditLog.write === 'function') {
        await ERP.AuditLog.write(entry);
      } else {
        await _store().putOne(IDB_STORES.AUDIT_LOG || 'auditLog', entry);
      }
    } catch (e) {
      _logger().error('[PostingEngine][Audit] Write failed:', e && e.message);
      _recordAuditFailure(documentId, txId, action, (e && e.message) || String(e));
    }
  }


  var _stateSyncFailures = [];

  function _recordStateSyncFailure(documentId, journalId, reason) {
    var failure = {
      documentId: documentId,
      journalId:  journalId,
      reason:     reason,
      timestamp:  _now(),
    };
    _stateSyncFailures.push(failure);
    if (_stateSyncFailures.length > 500) _stateSyncFailures.shift();
    try {
      if (ERP.EventBus && typeof ERP.EventBus.emit === 'function') {
        ERP.EventBus.emit('posting:state:sync:failure', failure);
      }
    } catch (_) {}
    return failure;
  }

  var _auditFailures = [];

  function _recordAuditFailure(documentId, txId, action, reason) {
    var failure = {
      documentId: documentId,
      txId:       txId,
      action:     action,
      reason:     reason,
      timestamp:  _now(),
    };
    _auditFailures.push(failure);
    if (_auditFailures.length > 500) _auditFailures.shift();
    try {
      if (ERP.EventBus && typeof ERP.EventBus.emit === 'function') {
        ERP.EventBus.emit('posting:audit:write:failure', failure);
      }
    } catch (_) {}
    return failure;
  }


  var PostingValidator = (function () {

    function validate(entries, documentId, txId) {
      if (!Array.isArray(entries) || entries.length < 2) {
        throw _err(ValidationError,
          'At least 2 journal entries required.',
          'PostingValidator', 'validate', documentId, txId);
      }

      var totalDebit  = 0;
      var totalCredit = 0;

      entries.forEach(function (e, i) {
        if (!e.accountId || typeof e.accountId !== 'string' || e.accountId.trim() === '') {
          throw _err(ValidationError,
            'Entry ' + i + ' missing accountId.',
            'PostingValidator', 'validate', documentId, txId);
        }

        var dr = Number.isInteger(e.debit)  ? e.debit  : _toPaisa(e.debit);
        var cr = Number.isInteger(e.credit) ? e.credit : _toPaisa(e.credit);

        if (Number.isInteger(e.debit) && e.debit > 0 && e.debit < 100) {
          _logger().warn('[PostingValidator] Entry ' + i + ' has a suspiciously small integer debit (' + e.debit +
            ' paisa = Rs ' + (e.debit / 100).toFixed(2) + ') for documentId ' + documentId +
            ' — if this value was meant as whole rupees, it is being silently misread as paisa. ' +
            'Pass amounts already converted to integer paisa, or a non-integer/string rupee value to trigger automatic conversion.');
        }
        if (Number.isInteger(e.credit) && e.credit > 0 && e.credit < 100) {
          _logger().warn('[PostingValidator] Entry ' + i + ' has a suspiciously small integer credit (' + e.credit +
            ' paisa = Rs ' + (e.credit / 100).toFixed(2) + ') for documentId ' + documentId +
            ' — if this value was meant as whole rupees, it is being silently misread as paisa. ' +
            'Pass amounts already converted to integer paisa, or a non-integer/string rupee value to trigger automatic conversion.');
        }

        if (dr < 0) throw _err(ValidationError,
          'Entry ' + i + ' debit cannot be negative.',
          'PostingValidator', 'validate', documentId, txId);
        if (cr < 0) throw _err(ValidationError,
          'Entry ' + i + ' credit cannot be negative.',
          'PostingValidator', 'validate', documentId, txId);
        if (dr === 0 && cr === 0) throw _err(ValidationError,
          'Entry ' + i + ' has zero debit and zero credit.',
          'PostingValidator', 'validate', documentId, txId);

        totalDebit  += dr;
        totalCredit += cr;
      });

      if (Math.abs(totalDebit - totalCredit) > 1) {
        throw _err(ValidationError,
          'Journal does not balance. DR=' + totalDebit + ' CR=' + totalCredit +
          ' (difference=' + (totalDebit - totalCredit) + ' paisa).',
          'PostingValidator', 'validate', documentId, txId);
      }

      return { ok: true };
    }

    function normalise(entries) {
      return entries.map(function (e) {
        var dr = Number.isInteger(e.debit)  ? e.debit  : _toPaisa(e.debit);
        var cr = Number.isInteger(e.credit) ? e.credit : _toPaisa(e.credit);
        return {
          accountId:   e.accountId,
          accountName: e.accountName || '',
          debit:       dr,
          credit:      cr,
          description: e.description || '',
        };
      });
    }

    return { validate: validate, normalise: normalise };
  })();


  var JournalWriter = (function () {

    async function write(journal) {
      try {
        var existing = await _store().getOne(IDB_STORES.JOURNALS, journal.id);
        if (existing) {
          throw _err(ConcurrencyError,
            'Journal with id ' + journal.id + ' already exists.',
            'JournalWriter', 'write', journal.documentId, null);
        }
      } catch (e) {
        if (e.name === 'ConcurrencyError') throw e;
        _logger().error('[JournalWriter] Pre-write existence check failed for journal ' + journal.id +
          ' — proceeding WITHOUT duplicate-ID verification (degraded safety). Reason: ' + (e && e.message));
      }

      var stamped = Object.freeze(Object.assign({}, journal, { _v: 1 }));
      try {
        await _store().putOne(IDB_STORES.JOURNALS, stamped);
      } catch (e) {
        throw _err(WALRecoveryError,
          'JournalWriter: IDB write failed for journal ' + journal.id + '. ' + (e && e.message),
          'JournalWriter', 'write', journal.documentId, null);
      }

      try {
        var written = await _store().getOne(IDB_STORES.JOURNALS, journal.id);
        if (written && written._v !== stamped._v) {
          throw _err(ConcurrencyError,
            'Concurrent write detected for journal id ' + journal.id + ' — record was overwritten.',
            'JournalWriter', 'write', journal.documentId, null);
        }
      } catch (e) {
        if (e.name === 'ConcurrencyError') throw e;
        _logger().error('[JournalWriter] Post-write concurrency verification failed for journal ' + journal.id +
          ' — could not confirm the write was not overwritten (degraded safety). Reason: ' + (e && e.message));
      }

      return stamped;
    }

    return { write: write };
  })();


  var ReversalIndex = (function () {

    var STORE = IDB_STORES.REVERSAL_INDEX || 'reversalIndex';
    var _reversedSet = Object.create(null);

    function _hydrate() {
      try {
        var raw = localStorage.getItem('erp_reversal_index_cache');
        if (raw) {
          var arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            arr.forEach(function (r) {
              if (r && r.originalJournalId && typeof r.originalJournalId === 'string') {
                _reversedSet[r.originalJournalId] = true;
              }
            });
          }
        }
      } catch (_) {}
    }
    _hydrate();

    async function write(entry) {
      if (!entry.originalJournalId || typeof entry.originalJournalId !== 'string') {
        _logger().warn('[ReversalIndex] write() called with missing/invalid originalJournalId — skipping.');
        return null;
      }

      if (_reversedSet[entry.originalJournalId] || isReversed(entry.originalJournalId)) {
        _logger().warn('[ReversalIndex] Journal ' + entry.originalJournalId + ' already reversed — skipping (idempotent).');
        return null;
      }

      var record = Object.assign({ id: _uid(), _v: 1 }, entry);
      try {
        await _store().putOne(STORE, record);
      } catch (e) {
        throw _err(WALRecoveryError,
          'ReversalIndex: IDB write failed. ' + (e && e.message),
          'ReversalIndex', 'write', entry.documentId, null);
      }
      await _audit(entry.txId || null, entry.actor || 'system', 'REVERSAL_INDEX_WRITE',
        'ReversalIndex', entry.documentId,
        { originalJournalId: entry.originalJournalId },
        { reversalJournalId: entry.reversalJournalId, reason: entry.reason },
        'info');

      var _rsKeys = Object.keys(_reversedSet);
      if (_rsKeys.length > 2000) {
        var _rsTrim = _rsKeys.slice(0, _rsKeys.length - 1500);
        for (var _ri = 0; _ri < _rsTrim.length; _ri++) { delete _reversedSet[_rsTrim[_ri]]; }
      }
      _reversedSet[entry.originalJournalId] = true;

      try {
        var existing = [];
        try { existing = JSON.parse(localStorage.getItem('erp_reversal_index_cache') || '[]'); } catch (_) { existing = []; }
        existing.push({ originalJournalId: entry.originalJournalId, ts: Date.now() });
        var MAX_CACHE = 500;
        if (existing.length > MAX_CACHE) {
          existing.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
          existing = existing.slice(existing.length - MAX_CACHE);
        }
        localStorage.setItem('erp_reversal_index_cache', JSON.stringify(existing));
      } catch (_) {}

      if (typeof _state().appendReversalEntry === 'function') {
        _state().appendReversalEntry(record);
      }
      return record;
    }

    function isReversed(journalId) {
      if (!journalId || typeof journalId !== 'string') return false;
      if (_reversedSet[journalId]) return true;
      if (typeof _state().isJournalReversed === 'function') {
        return _state().isJournalReversed(journalId);
      }
      var entries = (typeof _state().getAllReversalEntries === 'function')
        ? _state().getAllReversalEntries()
        : [];
      var found = entries.some(function (r) { return r.originalJournalId === journalId; });
      if (found) _reversedSet[journalId] = true;
      return found;
    }

    function getReversalFor(documentId) {
      var entries = (typeof _state().getAllReversalEntries === 'function')
        ? _state().getAllReversalEntries()
        : [];
      return entries.find(function (r) { return r.documentId === documentId; }) || null;
    }

    function invalidateIndex() {
      _reversedSet = Object.create(null);
      _hydrate();
    }

    return { write: write, isReversed: isReversed, getReversalFor: getReversalFor, invalidateIndex: invalidateIndex };
  })();


  var LockManager = (function () {

    var _held = Object.create(null);
    var _persistentIndex = Object.create(null);
    var _persistentIndexBuilt = false;
    var LOCK_STALE_MS = 30000;

    function _evictStaleLocks() {
      var now = Date.now();
      Object.keys(_held).forEach(function (docId) {
        var lock = _held[docId];
        if (lock && lock.acquiredAtMs && (now - lock.acquiredAtMs) > LOCK_STALE_MS) {
          _logger().warn('[LockManager] Evicting stale lock for documentId: ' + docId + ' (held ' + (now - lock.acquiredAtMs) + 'ms)');
          delete _held[docId];
        }
      });
    }

    function _buildPersistentIndex() {
      if (_persistentIndexBuilt) return;
      var st = ACC.AccountingState;
      if (!st) return;
      var journals = (typeof st.getAllJournals === 'function') ? st.getAllJournals() : [];
      journals.forEach(function (j) { if (j.documentId) _persistentIndex[j.documentId] = true; });
      _persistentIndexBuilt = true;
    }

    function _markPosted(documentId) {
      _persistentIndex[documentId] = true;
    }

    function invalidateIndex() {
      _persistentIndexBuilt = false;
      _persistentIndex = Object.create(null);
      ReversalIndex.invalidateIndex();
    }

    function acquire(documentId, txId) {
      _evictStaleLocks();
      if (_held[documentId]) {
        throw _err(DuplicatePostingError,
          'Posting lock already held for documentId: ' + documentId,
          'LockManager', 'acquire', documentId, txId);
      }
      if (isPostedPersistent(documentId)) {
        throw _err(DuplicatePostingError,
          'Journal already posted for documentId: ' + documentId,
          'LockManager', 'acquire', documentId, txId);
      }
      _held[documentId] = { acquiredAt: _now(), acquiredAtMs: Date.now(), txId: txId };
    }

    function acquireExclusive(documentId, txId) {
      _evictStaleLocks();
      if (_held[documentId]) {
        throw _err(DuplicatePostingError,
          'A posting or reversal operation is already in progress for documentId: ' + documentId,
          'LockManager', 'acquireExclusive', documentId, txId);
      }
      _held[documentId] = { acquiredAt: _now(), acquiredAtMs: Date.now(), txId: txId };
    }

    function release(documentId) {
      delete _held[documentId];
    }

    function isLocked(documentId) {
      return !!_held[documentId];
    }

    function isPostedPersistent(documentId) {
      _buildPersistentIndex();
      if (_persistentIndex[documentId]) {
        var jCheck = null;
        var st = ACC.AccountingState;
        if (!st) return false;
        if (typeof st.getJournalsByDocument === 'function') {
          jCheck = st.getJournalsByDocument(documentId);
        }
        if (!jCheck) {
          var allC = (typeof st.getAllJournals === 'function') ? st.getAllJournals() : [];
          jCheck = allC.filter(function (j) { return j.documentId === documentId; });
        }
        return jCheck.some(function (j) { return !ReversalIndex.isReversed(j.id); });
      }
      var st2 = ACC.AccountingState;
      if (!st2) return false;
      if (typeof st2.getJournalsByDocument === 'function') {
        var jrnls = st2.getJournalsByDocument(documentId);
        if (jrnls && jrnls.length) {
          var found = jrnls.some(function (j) { return !ReversalIndex.isReversed(j.id); });
          if (found) _persistentIndex[documentId] = true;
          return found;
        }
        return false;
      }
      if (typeof st2.journalExistsForDocument === 'function' && !st2.journalExistsForDocument(documentId)) {
        return false;
      }
      var allJ = (typeof st2.getAllJournals === 'function') ? st2.getAllJournals() : [];
      var docJournals = allJ.filter(function (j) { return j.documentId === documentId; });
      if (!docJournals.length) return false;
      var active = docJournals.some(function (j) { return !ReversalIndex.isReversed(j.id); });
      if (active) _persistentIndex[documentId] = true;
      return active;
    }

    return {
      acquire:           acquire,
      acquireExclusive:  acquireExclusive,
      release:           release,
      isLocked:          isLocked,
      isPostedPersistent: isPostedPersistent,
      markPosted:        _markPosted,
      invalidateIndex:   invalidateIndex,
    };
  })();


  var PostingEngine = (function () {

    async function post(payload) {
      if (!payload || !Array.isArray(payload.entries)) {
        throw _err(ValidationError,
          'post() requires payload with an entries array.',
          'PostingEngine', 'post', payload && payload.documentId, null);
      }

      var actor      = payload.actor || 'system';
      var documentId = payload.documentId;
      var txId       = _uid();

      _requireAdminOrSystem(actor, 'post', documentId, txId);

      var _postDate = payload.date || _today();
      if (!_isValidDateString(_postDate)) {
        _logger().warn('[PostingEngine.post] payload.date "' + _postDate + '" is not a recognised date string — using today instead (documentId: ' + documentId + ').');
        _postDate = _today();
      }

      if (!root.ERP || !ERP.PeriodLock || typeof ERP.PeriodLock.check !== 'function') {
        // FIX (root-cause, was fail-open): a missing PeriodLock module used to only log a
        // warning and let the post through. That made closed-period protection depend on
        // script load order instead of being a real guarantee. Refuse to post instead.
        throw _err(ValidationError,
          'PostingEngine.post: ERP.PeriodLock is not loaded — refusing to post ' + documentId +
          ' until period-lock protection is available. This is a safety stop, not a data error.',
          'PostingEngine', 'post', documentId, txId);
      }
      var _lockCheck = ERP.PeriodLock.check(_postDate);
      if (_lockCheck && _lockCheck.locked) {
        throw _err(ValidationError,
          'Cannot post to locked period ' + _lockCheck.periodId +
          ' (date: ' + _postDate + '). Unlock the period first.',
          'PostingEngine', 'post', documentId, txId);
      }

      var coaMap = null;
      var _coaUnavailableReason = null;
      try {
        var _stForCoa = ACC.AccountingState;
        if (_stForCoa && typeof _stForCoa.getCoaMap === 'function') {
          coaMap = _stForCoa.getCoaMap();
          if (!coaMap) _coaUnavailableReason = 'getCoaMap() returned empty/null';
        } else {
          _coaUnavailableReason = 'state.getCoaMap is not available';
        }
      } catch (coaErr) {
        _coaUnavailableReason = (coaErr && coaErr.message) || String(coaErr);
      }
      if (!coaMap) {
        // FIX (root-cause, was fail-open): a missing/unavailable Chart of Accounts used to
        // only log a warning and let the post through unvalidated. Refuse instead — an
        // unvalidated account reference in a ledger entry is exactly the kind of error that
        // is expensive to find later and easy to prevent here.
        throw _err(ValidationError,
          'PostingEngine.post: Chart of Accounts unavailable (' + (_coaUnavailableReason || 'unknown reason') +
          ') — refusing to post ' + documentId + ' until account validation is possible.',
          'PostingEngine', 'post', documentId, txId);
      }
      // FIX (root-cause, was audit finding #105): this used to throw on the *first* missing
      // account and never reach PostingValidator.validate(), so a payload with both a missing
      // account and a structural problem (e.g. debit != credit) only ever reported the missing
      // account. Fixing one error at a time and reloading to discover the next made cleaning up
      // a broken bulk import (erp.import.export.js) slower than it needed to be. Now we collect
      // *all* missing accounts across the whole payload, run the structural validator without
      // letting an early throw hide the COA problem, and report everything we found in one go.
      var _missingAccounts = [];
      for (var eIdx = 0; eIdx < payload.entries.length; eIdx++) {
        var ent = payload.entries[eIdx];
        if (!coaMap[ent.accountId]) {
          _missingAccounts.push('entry ' + eIdx + ': "' + ent.accountId + '"');
        }
      }

      var _structuralError = null;
      try {
        PostingValidator.validate(payload.entries, documentId, txId);
      } catch (valErr) {
        _structuralError = valErr;
      }

      if (_missingAccounts.length > 0) {
        var _combinedMsg = 'Account(s) not found in Chart of Accounts: ' + _missingAccounts.join(', ') + '.';
        if (_structuralError) {
          _combinedMsg += ' Additionally, journal is structurally invalid: ' +
            (_structuralError.message || String(_structuralError));
        }
        throw _err(ValidationError, _combinedMsg, 'PostingEngine', 'post', documentId, txId);
      }
      if (_structuralError) {
        throw _structuralError;
      }

      var normEntries = PostingValidator.normalise(payload.entries);

      if (!root.ERP || !ERP.ConcurrencyGuard || typeof ERP.ConcurrencyGuard.acquireLock !== 'function') {
        // FIX (root-cause, was fail-open): a missing ConcurrencyGuard used to silently skip
        // cross-tab locking (no throw, no warning even) and let the post proceed with only
        // the same-tab LockManager protecting it. Two open tabs could then post the same
        // documentId concurrently. Refuse to post instead.
        throw _err(ValidationError,
          'PostingEngine.post: ERP.ConcurrencyGuard is not loaded — refusing to post ' + documentId +
          ' until cross-tab locking is available.',
          'PostingEngine', 'post', documentId, txId);
      }
      var _cgLockId = null;
      var _cgResult;
      try {
        _cgResult = await ERP.ConcurrencyGuard.acquireLock('gl-post-' + documentId, 8000);
      } catch (cgErr) {
        throw _err(ValidationError,
          'GL posting blocked — another tab is already posting documentId: ' + documentId +
          '. Please wait and retry. (' + (cgErr && cgErr.message) + ')',
          'PostingEngine', 'post', documentId, txId);
      }
      if (!_cgResult || !_cgResult.acquired) {
        throw _err(ValidationError,
          'GL posting blocked — another tab is already posting documentId: ' + documentId + '. Please wait and retry.',
          'PostingEngine', 'post', documentId, txId);
      }
      _cgLockId = _cgResult.lockId;

      var walEntry, journal;
      try {
        LockManager.acquire(documentId, txId);

        walEntry = await _walWrite('gl-posting', documentId, {
          txId:         txId,
          documentId:   documentId,
          documentType: payload.documentType,
          sourceModule: payload.sourceModule,
          actor:        actor,
          entries:      normEntries,
          reference:    payload.reference,
          memo:         payload.memo,
          party:        payload.party,
          date:         _postDate,
        });
        walEntry = await _walAdvanceStep(walEntry, 'lock_acquired');

        for (var fe = 0; fe < normEntries.length; fe++) {
          var feEntry = normEntries[fe];
          if (!feEntry.accountId || typeof feEntry.debit !== 'number' || typeof feEntry.credit !== 'number') {
            throw _err(ValidationError,
              'Entry ' + fe + ' has invalid structure after normalisation.',
              'PostingEngine', 'post', documentId, txId);
          }
        }
        walEntry = await _walAdvanceStep(walEntry, 'entries_validated');

        journal = Object.freeze({
          id:           _uid(),
          documentId:   documentId,
          documentType: payload.documentType || 'invoice',
          sourceModule: payload.sourceModule || (_SM() ? _SM().MANUAL : 'manual'),
          date:         _postDate,
          reference:    payload.reference || documentId,
          memo:         payload.memo     || '',
          party:        payload.party    || '',
          periodId:     payload.periodId || null,
          entries:      Object.freeze(normEntries.map(Object.freeze)),
          actor:        actor,
          timestamp:    _now(),
          isReversal:   !!payload.isReversal,
          _v:           1,
        });
        walEntry = await _walAdvanceStep(walEntry, 'journal_built');

        try {
          await JournalWriter.write(journal);
          walEntry = await _walAdvanceStep(walEntry, 'journal_written');
        } catch (e) {
          await _walRollback(walEntry);
          throw e;
        }
      } catch (e) {
        LockManager.release(documentId);
        if (_cgLockId && root.ERP && ERP.ConcurrencyGuard) { try { ERP.ConcurrencyGuard.releaseLock(_cgLockId); } catch(_){} }
        throw e;
      }

      var _stateObj = ACC.AccountingState;
      if (_stateObj && typeof _stateObj.appendJournal === 'function') {
        try {
          _stateObj.appendJournal(journal);
          walEntry = await _walAdvanceStep(walEntry, 'state_synced');
        } catch (appendErr) {
          var _syncReason = (appendErr && appendErr.message) || String(appendErr);
          _logger().warn('[PostingEngine.post] appendJournal threw — journal written to IDB but not in-memory state. Error: ' + _syncReason);
          _recordStateSyncFailure(documentId, journal.id, _syncReason);
          _audit(txId, actor, 'STATE_SYNC_FAILURE', 'PostingEngine', documentId, null, { journalId: journal.id, reason: _syncReason }, 'warning');
        }
      } else {
        var _syncReason2 = 'AccountingState.appendJournal is unavailable — in-memory journal cache was not updated';
        _logger().warn('[PostingEngine.post] ' + _syncReason2 + ' (documentId: ' + documentId + ').');
        _recordStateSyncFailure(documentId, journal.id, _syncReason2);
        _audit(txId, actor, 'STATE_SYNC_FAILURE', 'PostingEngine', documentId, null, { journalId: journal.id, reason: _syncReason2 }, 'warning');
      }

      LockManager.release(documentId);
      LockManager.markPosted(documentId);
      if (_cgLockId && root.ERP && ERP.ConcurrencyGuard) { try { ERP.ConcurrencyGuard.releaseLock(_cgLockId); } catch(_){} }

      try {
        await _walCommit(walEntry);
      } catch (wce) {
        _logger().error('[PostingEngine.post] WAL commit failed after successful journal write:', documentId, wce && wce.message);
      }

      _audit(txId, actor, 'GL_POSTED', 'PostingEngine', documentId, null, journal, 'info');

      try {
        if (ERP.EventBus && typeof ERP.EventBus.emit === 'function') {
          ERP.EventBus.emit('posting:journal:posted', {
            journalId:    journal.id,
            documentId:   documentId,
            sourceModule: journal.sourceModule,
            timestamp:    journal.timestamp,
          });
        }
        if (typeof _events().emitAsync === 'function') {
          _events().emitAsync(ACCOUNTING_EVENTS.JOURNAL_POSTED, {
            journalId:    journal.id,
            documentId:   documentId,
            sourceModule: journal.sourceModule,
          });
        }
      } catch (_) {}

      _logger().info('[PostingEngine] Posted:', documentId, journal.id);
      return journal;
    }


    async function reverse(documentId, opts) {
      opts = (opts !== null && typeof opts === 'object') ? opts : {};
      var actor  = opts.actor  || 'system';
      var reason = opts.reason || 'Manual reversal of ' + documentId;
      var txId   = _uid();

      _requireAdminOrSystem(actor, 'reverse', documentId, txId);

      var _preCheckJournals = getByDocument(documentId).filter(function (j) {
        return !ReversalIndex.isReversed(j.id);
      });
      if (_preCheckJournals.length === 0) {
        throw _err(ValidationError,
          'No posted (non-reversed) journals found for documentId: ' + documentId,
          'PostingEngine', 'reverse', documentId, txId);
      }

      var _alreadyReversalJournals = _preCheckJournals.filter(function (j) { return j.isReversal; });
      if (_alreadyReversalJournals.length === _preCheckJournals.length) {
        throw _err(ValidationError,
          'documentId ' + documentId + ' refers to a reversal journal — reversals cannot themselves be reversed. ' +
          'Reverse the original document instead, or post a fresh correcting entry.',
          'PostingEngine', 'reverse', documentId, txId);
      }

      var reverseDate = opts.date || _today();
      if (!_isValidDateString(reverseDate)) {
        _logger().warn('[PostingEngine.reverse] opts.date "' + reverseDate + '" is invalid — using today.');
        reverseDate = _today();
      }

      LockManager.acquireExclusive(documentId, txId);

      try {

        var originals = _preCheckJournals.filter(function (j) { return !j.isReversal; });

        
        
        
        
        
        
        
        var latestOriginalDate = originals.reduce(function (max, j) {
          var d = (j.date || '').slice(0, 10);
          return d > max ? d : max;
        }, '');
        var reverseDateOnly = reverseDate.slice(0, 10);
        if (latestOriginalDate && reverseDateOnly < latestOriginalDate) {
          throw _err(ValidationError,
            'Reversal date ' + reverseDateOnly + ' is before the date of the journal(s) being reversed (' +
            latestOriginalDate + '). A reversal cannot be dated earlier than what it reverses.',
            'PostingEngine', 'reverse', documentId, txId);
        }

        var walEntry = await _walWrite('gl-reversal', documentId, {
          txId:       txId,
          documentId: documentId,
          actor:      actor,
          reason:     reason,
        });
        walEntry = await _walAdvanceStep(walEntry, 'lock_acquired');
        walEntry = await _walAdvanceStep(walEntry, 'originals_loaded');

        var reversalJournals = [];

        for (var i = 0; i < originals.length; i++) {
          var original = originals[i];

          var reversalPayload = {
            documentId:   'REV-' + original.id,
            documentType: 'reversal',
            sourceModule: original.sourceModule,
            date:         reverseDate,
            memo:         reason,
            party:        original.party,
            actor:        actor,
            isReversal:   true,
            entries:      original.entries.map(function (e) {
              return {
                accountId:   e.accountId,
                accountName: e.accountName,
                debit:       e.credit,
                credit:      e.debit,
                description: 'Reversal: ' + (e.description || ''),
              };
            }),
          };

          var reversalJournal;
          try {
            reversalJournal = await post(reversalPayload);
          } catch (e) {
            await _walRollback(walEntry);
            throw e;
          }
          walEntry = await _walAdvanceStep(walEntry, 'reversal_journals_written');

          await ReversalIndex.write({
            originalJournalId: original.id,
            reversalJournalId: reversalJournal.id,
            documentId:        documentId,
            reversedAt:        _now(),
            reason:            reason,
            actor:             actor,
            txId:              txId,
          });
          walEntry = await _walAdvanceStep(walEntry, 'reversal_index_written');

          reversalJournals.push(reversalJournal);
        }

        try {
          await _walCommit(walEntry);
        } catch (wce) {
          _logger().error('[PostingEngine.reverse] WAL commit failed after successful reversal:', documentId, wce && wce.message);
        }

        _audit(txId, actor, 'GL_REVERSED', 'PostingEngine', documentId,
          { originalCount: originals.length },
          { reversalJournalIds: reversalJournals.map(function (j) { return j.id; }) },
          'warning');

        try {
          if (ERP.EventBus && typeof ERP.EventBus.emit === 'function') {
            ERP.EventBus.emit('posting:journal:reversed', {
              documentId:         documentId,
              reversalJournalIds: reversalJournals.map(function (j) { return j.id; }),
            });
          }
          if (ACCOUNTING_EVENTS && ACCOUNTING_EVENTS.JOURNAL_REVERSED &&
              typeof _events().emitAsync === 'function') {
            _events().emitAsync(ACCOUNTING_EVENTS.JOURNAL_REVERSED, {
              documentId:         documentId,
              reversalJournalIds: reversalJournals.map(function (j) { return j.id; }),
            });
          }
        } catch (_) {}

        _logger().info('[PostingEngine] Reversed:', documentId,
          reversalJournals.map(function (j) { return j.id; }));
        return reversalJournals;

      } finally {
        LockManager.release(documentId);
      }
    }


    function validate(entries, documentId, txId) {
      return PostingValidator.validate(entries, documentId, txId);
    }


    function getByDocument(documentId) {
      var st = ACC.AccountingState;
      if (!st) return [];
      if (typeof st.getJournalsByDocument === 'function') {
        return st.getJournalsByDocument(documentId) || [];
      }
      var journals = (typeof st.getAllJournals === 'function') ? st.getAllJournals() : [];
      return journals.filter(function (j) { return j.documentId === documentId; });
    }


    function isPosted(documentId) {
      var journals = getByDocument(documentId);
      if (journals.length === 0) return false;
      return journals.some(function (j) { return !ReversalIndex.isReversed(j.id); });
    }


    function getBalance(accountId, periodId) {
      var st = ACC.AccountingState;
      if (!st) return 0;
      if (typeof st.getAccountBalance === 'function') {
        return st.getAccountBalance(accountId, periodId) || 0;
      }
      var journals = (typeof st.getAllJournals === 'function') ? st.getAllJournals() : [];
      var balance = 0;
      journals.forEach(function (j) {
        if (ReversalIndex.isReversed(j.id)) return;
        if (periodId && j.periodId && j.periodId !== periodId) return;
        (j.entries || []).forEach(function (e) {
          if (e.accountId === accountId) {
            balance += (e.debit || 0) - (e.credit || 0);
          }
        });
      });
      try {
        var coa = (typeof st.getCoaMap === 'function') ? st.getCoaMap() : null;
        var acct = coa ? coa[accountId] : null;
        if (acct) {
          var isDebitNormal = acct.type === 'asset' || acct.type === 'expense' || acct.type === 'contra-revenue';
          if (!isDebitNormal) balance = -balance;
        }
      } catch (_) {}
      return balance;
    }

    return {
      __v2:           true,
      post:           post,
      reverse:        reverse,
      validate:       validate,
      getByDocument:  getByDocument,
      isPosted:       isPosted,
      getBalance:     getBalance,
      getStateSyncFailures: function () { return _stateSyncFailures.slice(); },
      hasStateSyncFailures: function () { return _stateSyncFailures.length > 0; },
      getAuditFailures: function () { return _auditFailures.slice(); },
      hasAuditFailures: function () { return _auditFailures.length > 0; },
      _PostingValidator: PostingValidator,
      _JournalWriter:    JournalWriter,
      _ReversalIndex:    ReversalIndex,
      _LockManager:      LockManager,
    };
  })();


  var LedgerFacade = (function () {

    var GeneralLedger = {

      getBalance: function (accountId, periodId) {
        try {
          var st = ACC.AccountingState;
          if (!st) return 0;
          return st.getAccountBalance(accountId, periodId) || 0;
        } catch (_) { return 0; }
      },

      getBalances: function (accountIds, periodId) {
        var result = {};
        if (!Array.isArray(accountIds) || !accountIds.length) return result;
        try {
          var st = ACC.AccountingState;
          if (!st) { accountIds.forEach(function (id) { result[id] = 0; }); return result; }
          accountIds.forEach(function (id) {
            try {
              result[id] = (typeof st.getAccountBalance === 'function')
                ? (st.getAccountBalance(id, periodId) || 0)
                : 0;
            } catch (_) {
              result[id] = 0;
            }
          });
          return result;
        } catch (_) { return result; }
      },

      getTrialBalance: function (periodId) {
        try { return _state().getTrialBalance(periodId) || []; } catch (_) { return []; }
      },

      isBalanced: function (periodId) {
        try {
          var result = _state().isLedgerBalanced(periodId);
          if (result && typeof result === 'object') return result;
          return { balanced: !!result, difference: 0, totalDebit: 0, totalCredit: 0 };
        } catch (_) {
          return { balanced: false, difference: 0, totalDebit: 0, totalCredit: 0 };
        }
      },

      getChartOfAccounts: function () {
        try { return _state().getAllCOAAccounts() || []; } catch (_) { return []; }
      },

      getAccount: function (accountId) {
        try { return _state().getCOAAccount(accountId) || null; } catch (_) { return null; }
      },

      getAllJournals: function () {
        try { return _state().getAllJournals() || []; } catch (_) { return []; }
      },

      postJournal: function (data, actor) {
        var sm = _SM();
        if (!data || !data.sourceId) {
          return Promise.reject(_err(ValidationError,
            'GeneralLedger.postJournal: sourceId is required for idempotent posting.',
            'LedgerFacade', 'postJournal', data && data.sourceId, null));
        }
        return PostingEngine.post({
          documentId:   'GL-' + data.sourceId,
          documentType: 'adjustment',
          sourceModule: data.sourceModule || (sm ? sm.MANUAL : 'manual'),
          date:         data.date      || _today(),
          reference:    data.reference || '',
          memo:         data.memo      || '',
          party:        data.party     || '',
          entries:      data.entries,
          actor:        actor || 'system',
        });
      },
    };

    var StockLedger = {

      getInventoryBalance: function (periodId) {
        var sa = _SA();
        return GeneralLedger.getBalance(sa ? sa.INVENTORY || 'acc-1200' : 'acc-1200', periodId);
      },
      getInventoryAssetBalance: function (periodId) { return StockLedger.getInventoryBalance(periodId); },

      getCOGS: function (periodId) {
        var sa = _SA();
        return GeneralLedger.getBalance(sa ? sa.COGS || sa.PURCHASE_EXP || 'acc-5100' : 'acc-5100', periodId);
      },

      postStockReceipt: function (opts, actor) {
        var sa = _SA(); var sm = _SM();
        if (!opts || !opts.sourceId || !opts.amountPaisa) {
          return Promise.reject(_err(ValidationError,
            'StockLedger.postStockReceipt: sourceId and amountPaisa required.',
            'LedgerFacade', 'postStockReceipt', opts && opts.sourceId, null));
        }
        var creditAccount   = opts.cash ? (sa && sa.CASH || 'acc-1001') : (sa && sa.AP || 'acc-2001');
        var inventoryAccount = (sa && sa.INVENTORY) || 'acc-1200';
        return PostingEngine.post({
          documentId:   'STOCK-RCV-' + opts.sourceId,
          documentType: 'purchase',
          sourceModule: sm ? sm.PURCHASE : 'purchase',
          date:         opts.date || _today(),
          reference:    opts.reference || opts.sourceId,
          memo:         opts.memo || 'Stock Receipt',
          entries: [
            { accountId: inventoryAccount, debit: opts.amountPaisa, credit: 0,               description: 'Inventory received' },
            { accountId: creditAccount,    debit: 0,               credit: opts.amountPaisa, description: 'Stock receipt settlement' },
          ],
          actor: actor || 'system',
        });
      },

      postStockConsumption: function (opts, actor) {
        var sa = _SA(); var sm = _SM();
        if (!opts || !opts.sourceId || !opts.costPaisa) {
          return Promise.reject(_err(ValidationError,
            'StockLedger.postStockConsumption: sourceId and costPaisa required.',
            'LedgerFacade', 'postStockConsumption', opts && opts.sourceId, null));
        }
        var inventoryAccount = (sa && sa.INVENTORY) || 'acc-1200';
        return PostingEngine.post({
          documentId:   'STOCK-COGS-' + opts.sourceId,
          documentType: 'invoice',
          sourceModule: sm ? sm.SALES : 'sales',
          date:         opts.date || _today(),
          reference:    opts.reference || opts.sourceId,
          memo:         opts.memo || 'Cost of Goods Sold',
          entries: [
            { accountId: sa && sa.COGS || sa && sa.PURCHASE_EXP || 'acc-5100', debit: opts.costPaisa, credit: 0,            description: 'COGS posted' },
            { accountId: inventoryAccount,                                     debit: 0,              credit: opts.costPaisa, description: 'Inventory consumed' },
          ],
          actor: actor || 'system',
        });
      },

      postStockAdjustment: function (opts, actor) {
        var sa = _SA(); var sm = _SM();
        if (!opts || !opts.sourceId || !opts.amountPaisa || !opts.direction) {
          return Promise.reject(_err(ValidationError,
            'StockLedger.postStockAdjustment: sourceId, amountPaisa, and direction required.',
            'LedgerFacade', 'postStockAdjustment', opts && opts.sourceId, null));
        }
        var inventoryAccount = (sa && sa.INVENTORY) || 'acc-1200';
        var entries;
        if (opts.direction === 'increase') {
          entries = [
            { accountId: inventoryAccount,                            debit: opts.amountPaisa, credit: 0,               description: 'Stock adjustment increase' },
            { accountId: (sa && sa.STOCK_SURPLUS) || 'acc-3003',     debit: 0,               credit: opts.amountPaisa, description: 'Stock surplus reserve' },
          ];
        } else {
          entries = [
            { accountId: sa && sa.INVENTORY_WRITEOFF || sa.PURCHASE_EXP || 'acc-5102', debit: opts.amountPaisa, credit: 0,               description: 'Stock write-off expense' },
            { accountId: inventoryAccount,                                              debit: 0,               credit: opts.amountPaisa, description: 'Stock adjustment decrease' },
          ];
        }
        return PostingEngine.post({
          documentId:   'STOCK-ADJ-' + opts.sourceId,
          documentType: 'adjustment',
          sourceModule: sm ? sm.MANUAL : 'manual',
          date:         opts.date || _today(),
          reference:    'ADJ-' + opts.sourceId,
          memo:         opts.memo || ('Stock adjustment: ' + opts.direction),
          entries:      entries,
          actor:        actor || 'system',
        });
      },
    };

    var VendorLedger = {

      getPartyLedger: function (partyName) {
        try { return _state().getPartyLedger(partyName) || []; } catch (_) { return []; }
      },

      getTotalReceivable: function (periodId) {
        var sa = _SA();
        return GeneralLedger.getBalance(sa ? sa.AR || 'acc-1100' : 'acc-1100', periodId);
      },

      getTotalPayable: function (periodId) {
        var sa = _SA();
        return GeneralLedger.getBalance(sa ? sa.AP || 'acc-2001' : 'acc-2001', periodId);
      },

      postCustomerInvoice: function (opts, actor) {
        var sa = _SA(); var sm = _SM();
        if (!opts || !opts.sourceId || !opts.netPaisa || !opts.party) {
          return Promise.reject(_err(ValidationError,
            'VendorLedger.postCustomerInvoice: sourceId, party, and netPaisa required.',
            'LedgerFacade', 'postCustomerInvoice', opts && opts.sourceId, null));
        }
        var taxPaisa   = opts.taxPaisa || 0;
        var totalPaisa = opts.netPaisa + taxPaisa;
        var entries = [
          { accountId: sa && sa.AR        || 'acc-1100', debit: totalPaisa,    credit: 0,             description: 'Customer invoice: ' + opts.party },
          { accountId: sa && sa.SALES_REV || 'acc-4001', debit: 0,            credit: opts.netPaisa, description: 'Sales revenue' },
        ];
        if (taxPaisa > 0) {
          entries.push({ accountId: sa && sa.GST_PAYABLE || 'acc-2200', debit: 0, credit: taxPaisa, description: 'GST output tax collected' });
        }
        return PostingEngine.post({
          documentId:   'VL-INV-' + opts.sourceId,
          documentType: 'invoice',
          sourceModule: sm ? sm.SALES : 'sales',
          date:         opts.date || _today(),
          reference:    opts.reference || opts.sourceId,
          memo:         opts.memo || ('Invoice: ' + opts.party),
          party:        opts.party,
          entries:      entries,
          actor:        actor || 'system',
        });
      },

      postCustomerPayment: function (opts, actor) {
        var sa = _SA(); var sm = _SM();
        if (!opts || !opts.sourceId || !opts.amountPaisa || !opts.party) {
          return Promise.reject(_err(ValidationError,
            'VendorLedger.postCustomerPayment: sourceId, party, and amountPaisa required.',
            'LedgerFacade', 'postCustomerPayment', opts && opts.sourceId, null));
        }
        var debitAccount = opts.bank ? (sa && sa.BANK || 'acc-1002') : (sa && sa.CASH || 'acc-1001');
        return PostingEngine.post({
          documentId:   'VL-PMT-' + opts.sourceId,
          documentType: 'payment',
          sourceModule: sm ? sm.SALES : 'sales',
          date:         opts.date || _today(),
          reference:    opts.reference || opts.sourceId,
          memo:         opts.memo || ('Payment received: ' + opts.party),
          party:        opts.party,
          entries: [
            { accountId: debitAccount,                  debit: opts.amountPaisa, credit: 0,               description: 'Payment received' },
            { accountId: sa && sa.AR || 'acc-1100',     debit: 0,               credit: opts.amountPaisa, description: 'AR cleared: ' + opts.party },
          ],
          actor: actor || 'system',
        });
      },

      postVendorBill: function (opts, actor) {
        var sa = _SA(); var sm = _SM();
        if (!opts || !opts.sourceId || !opts.netPaisa || !opts.party) {
          return Promise.reject(_err(ValidationError,
            'VendorLedger.postVendorBill: sourceId, party, and netPaisa required.',
            'LedgerFacade', 'postVendorBill', opts && opts.sourceId, null));
        }
        if (opts.taxPaisa !== undefined && opts.taxPaisa !== null &&
            (opts.netPaisa + (opts.taxPaisa || 0)) !== (opts.totalPaisa || opts.netPaisa + (opts.taxPaisa || 0))) {
          _logger().warn('[LedgerFacade.VendorLedger] postVendorBill: netPaisa + taxPaisa does not match totalPaisa — using computed total. sourceId: ' + opts.sourceId);
        }
        var taxPaisa   = opts.taxPaisa || 0;
        var totalPaisa = opts.netPaisa + taxPaisa;
        var expAcct    = opts.expenseAccountId || (sa && sa.PURCHASE_EXP || 'acc-5101');
        var entries = [
          { accountId: expAcct,                         debit: opts.netPaisa, credit: 0,          description: 'Purchase: ' + opts.party },
          { accountId: sa && sa.AP || 'acc-2001',       debit: 0,            credit: totalPaisa,  description: 'Vendor bill payable' },
        ];
        if (taxPaisa > 0) {
          entries.push({ accountId: sa && sa.GST_RECEIVABLE || 'acc-1300', debit: taxPaisa, credit: 0, description: 'GST input tax recoverable' });
        }
        return PostingEngine.post({
          documentId:   'VL-BILL-' + opts.sourceId,
          documentType: 'purchase',
          sourceModule: sm ? sm.PURCHASE : 'purchase',
          date:         opts.date || _today(),
          reference:    opts.reference || opts.sourceId,
          memo:         opts.memo || ('Vendor bill: ' + opts.party),
          party:        opts.party,
          entries:      entries,
          actor:        actor || 'system',
        }).then(function (journal) {
          try {
            if (ACCOUNTING_EVENTS && ACCOUNTING_EVENTS.PURCHASE_POSTED &&
                typeof _events().emitAsync === 'function') {
              _events().emitAsync(ACCOUNTING_EVENTS.PURCHASE_POSTED, {
                sourceId:   opts.sourceId,
                party:      opts.party,
                netPaisa:   opts.netPaisa,
                taxPaisa:   taxPaisa,
                totalPaisa: totalPaisa,
              });
            }
          } catch (_) {}
          return Object.assign({}, journal, { apTotalPaisa: totalPaisa });
        });
      },

      postVendorPayment: function (opts, actor) {
        var sa = _SA(); var sm = _SM();
        if (!opts || !opts.sourceId || !opts.amountPaisa || !opts.party) {
          return Promise.reject(_err(ValidationError,
            'VendorLedger.postVendorPayment: sourceId, party, and amountPaisa required.',
            'LedgerFacade', 'postVendorPayment', opts && opts.sourceId, null));
        }
        if (opts.billSourceId) {
          try {
            var billJournals = PostingEngine.getByDocument('VL-BILL-' + opts.billSourceId);
            var billTotalPaisa = 0;
            billJournals.forEach(function (j) {
              (j.entries || []).forEach(function (e) {
                if (e.accountId === (sa && sa.AP || 'acc-2001')) billTotalPaisa += (e.credit || 0);
              });
            });
            if (billTotalPaisa > 0 && billTotalPaisa !== opts.amountPaisa) {
              _logger().warn('[LedgerFacade.VendorLedger] postVendorPayment amountPaisa (' + opts.amountPaisa +
                ') does not match bill AP total (' + billTotalPaisa + '). AP may carry a residual balance.');
            }
          } catch (_) {}
        }
        var creditAccount = opts.bank ? (sa && sa.BANK || 'acc-1002') : (sa && sa.CASH || 'acc-1001');
        return PostingEngine.post({
          documentId:   'VL-VPMT-' + opts.sourceId,
          documentType: 'payment',
          sourceModule: sm ? sm.PURCHASE : 'purchase',
          date:         opts.date || _today(),
          reference:    opts.reference || opts.sourceId,
          memo:         opts.memo || ('Payment to vendor: ' + opts.party),
          party:        opts.party,
          entries: [
            { accountId: sa && sa.AP || 'acc-2001', debit: opts.amountPaisa, credit: 0,               description: 'AP cleared: ' + opts.party },
            { accountId: creditAccount,             debit: 0,               credit: opts.amountPaisa, description: 'Payment disbursed' },
          ],
          actor: actor || 'system',
        });
      },

      postCashRefund: function (opts, actor) {
        var sa = _SA(); var sm = _SM();
        if (!opts || !opts.sourceId || !opts.amountPaisa || !opts.party) {
          return Promise.reject(_err(ValidationError,
            'VendorLedger.postCashRefund: sourceId, party, and amountPaisa required.',
            'LedgerFacade', 'postCashRefund', opts && opts.sourceId, null));
        }
        if (opts.wasCreditSale === undefined || opts.wasCreditSale === null) {
          _logger().warn('[LedgerFacade.VendorLedger] postCashRefund called without wasCreditSale for ' +
            opts.sourceId + ' — defaulting to credit-sale (AR debit). Pass wasCreditSale explicitly to avoid a phantom AR balance on cash sales.');
        }
        var wasCreditSale  = opts.wasCreditSale !== false;
        var creditAccount  = (opts.mode === 'Bank Transfer')
          ? (sa && sa.BANK || 'acc-1002')
          : (sa && sa.CASH || 'acc-1001');
        var debitSideAccount = wasCreditSale
          ? (sa && sa.AR || 'acc-1100')
          : (sa && sa.SALES_RETURNS || sa && sa.SALES_DISC || 'acc-4003');
        var debitSideDesc = wasCreditSale
          ? ('AR reduced — refund to customer: ' + opts.party)
          : ('Sales return — refund to customer: ' + opts.party);
        return PostingEngine.post({
          documentId:   'VL-REFUND-' + opts.sourceId,
          documentType: 'refund',
          sourceModule: sm ? sm.SALES : 'sales',
          date:         opts.date || _today(),
          reference:    opts.reference || opts.sourceId,
          memo:         opts.memo || ('Sale return cash refund: ' + opts.party + ' \u2014 ' + opts.sourceId),
          party:        opts.party,
          entries: [
            { accountId: debitSideAccount, debit: 0,               credit: opts.amountPaisa, description: debitSideDesc },
            { accountId: creditAccount,    debit: opts.amountPaisa, credit: 0,               description: 'Cash/Bank paid out \u2014 sale return: ' + opts.sourceId },
          ],
          actor: actor || 'system',
        });
      },
    };

    return {
      __phase2: true,

      GeneralLedger: GeneralLedger,
      StockLedger:   StockLedger,
      VendorLedger:  VendorLedger,

      postJournal: function (data, actor) {
        return GeneralLedger.postJournal(data, actor);
      },
      validateJournal: function (data) {
        return PostingValidator.validate(data.entries, data.documentId || data.sourceId);
      },
      getAccountBalance:        function (accountId, periodId) { return GeneralLedger.getBalance(accountId, periodId); },
      getSystemAccountBalances: function (periodId) {
        var sa = _SA();
        if (!sa) return {};
        return GeneralLedger.getBalances([
          sa.CASH || 'acc-1001', sa.BANK || 'acc-1002', sa.AR || 'acc-1100',
          sa.INVENTORY || 'acc-1200', sa.GST_RECEIVABLE || 'acc-1300', sa.AP || 'acc-2001',
          sa.BANK_LOANS || 'acc-2100', sa.GST_PAYABLE || 'acc-2200',
          sa.EQUITY || 'acc-3001', sa.SALES_REV || 'acc-4001',
          sa.COGS || 'acc-5100', sa.PURCHASE_EXP || 'acc-5101',
          sa.INVENTORY_WRITEOFF || 'acc-5102', sa.ADMIN || 'acc-5200',
          sa.LOAN_INT || 'acc-5300', sa.BANK_CHARGES || 'acc-5400',
        ], periodId);
      },
      isLedgerBalanced: function (periodId) {
        var result = GeneralLedger.isBalanced(periodId);
        return result ? result.balanced : false;
      },
      reverseJournal: function (journalId, reason, actor) {
        var st = ACC.AccountingState;
        var journals = (st && typeof st.getAllJournals === 'function') ? st.getAllJournals() : [];
        var j = journals.find(function (x) { return x.id === journalId; });
        if (!j) return Promise.reject(_err(ValidationError,
          'Journal not found: ' + journalId, 'LedgerFacade', 'reverseJournal', null, null));
        return PostingEngine.reverse(j.documentId, { reason: reason || 'Manual reversal', actor: actor || 'system' });
      },
      getChartOfAccounts: function () { return GeneralLedger.getChartOfAccounts(); },
      getTrialBalance:    function (periodId) { return GeneralLedger.getTrialBalance(periodId); },
    };
  })();


  var SalesConnector = (function () {

    function _getMAC(bc) {
      try {
        if (ERP.InventoryService && typeof ERP.InventoryService.getAvgCost === 'function') {
          var mac = ERP.InventoryService.getAvgCost(bc);
          if (mac !== null && mac !== undefined && parseFloat(mac) > 0) return parseFloat(mac);
        }
      } catch (_) {}
      try {
        if (ERP.Inventory && typeof ERP.Inventory.getMAC === 'function') {
          var mac2 = ERP.Inventory.getMAC(bc);
          if (mac2 !== null && mac2 !== undefined && parseFloat(mac2) > 0) return parseFloat(mac2);
        }
      } catch (_) {}
      try {
        var s       = ERP._internal && ERP._internal.getState ? ERP._internal.getState() : {};
        var batches = (s.data && s.data.stockBatches) ? s.data.stockBatches : [];
        var totalQty = 0; var totalCost = 0;
        for (var i = 0; i < batches.length; i++) {
          var b = batches[i];
          if (b.bc === bc && parseFloat(b.costPerUnit) > 0 && parseFloat(b.qty) > 0) {
            totalQty  += parseFloat(b.qty);
            totalCost += parseFloat(b.qty) * parseFloat(b.costPerUnit);
          }
        }
        if (totalQty > 0) return totalCost / totalQty;
      } catch (_) {}
      return 0;
    }

    function _findInvItem(nameOrSku) {
      var lower = (nameOrSku || '').toLowerCase();
      if (!lower) return null;
      try {
        var s   = ERP._internal && ERP._internal.getState ? ERP._internal.getState() : {};
        var inv = (s.data && s.data.inventory) ? s.data.inventory : [];
        for (var i = 0; i < inv.length; i++) {
          var it = inv[i];
          if (it._archived) continue;
          var itBc  = (it.bc  || '').toLowerCase();
          var itN   = (it.n   || '').toLowerCase();
          var itSku = (it.sku || '').toLowerCase();
          if ((itBc && itBc === lower) || (itN && itN === lower) || (itSku && itSku === lower)) return it;
        }
      } catch (_) {}
      return null;
    }

    function _isService(invItem) {
      if (!invItem) return false;
      return invItem.type === 'service'         ||
             invItem.isService === true         ||
             invItem.stockable === false        ||
             invItem.trackStock === false       ||
             invItem.inventoryTracked === false;
    }


    function _computeSaleTotals(sale) {
      // FIX (root-cause, was silent-divergence fail-open): this used to fall back to its
      // own re-implementation of sale totals (raw-float accumulate-then-round-once) when
      // ERP._salesSvc wasn't available, instead of the canonical sales_service.js._totals()
      // (which rounds each line to paisa before summing). The two methods can land on
      // different tax figures for the same sale (accumulate-then-round vs round-then-sum) —
      // exactly the "GST posted disagrees with GST shown elsewhere" failure mode this
      // codebase's audit flagged as its highest financial risk. There is only one correct
      // source for a sale's totals (sales_service.js); if it isn't loaded, refuse to post
      // rather than silently posting a ledger entry computed a different way.
      var svc = ERP._salesSvc;
      if (!svc || typeof svc._totals !== 'function') {
        throw _err(ValidationError,
          'PostingEngine._computeSaleTotals: ERP._salesSvc (sales_service.js) is not loaded — ' +
          'refusing to compute sale totals independently, since a fallback calculation can ' +
          'round differently than the canonical service and silently post a mismatched GST/total.',
          'PostingEngine', 'post', sale && sale.id, null);
      }
      var t          = svc._totals(sale.items || []);
      var grandTotal = parseFloat(t.grand) || 0;
      var taxTotal   = parseFloat(t.tax)   || 0;
      var subTotal   = parseFloat(t.sub)   || 0;
      var discTotal  = parseFloat(t.disc)  || 0;
      if (sale.roundOff) {
        grandTotal = Math.round(grandTotal);
        subTotal   = grandTotal - taxTotal + discTotal;
      }
      if (subTotal <= 0 && grandTotal > 0) subTotal = grandTotal - taxTotal + discTotal;
      return {
        grand: Math.round(grandTotal * 100) / 100,
        tax:   Math.round(taxTotal   * 100) / 100,
        sub:   Math.round(subTotal   * 100) / 100,
        disc:  Math.round(discTotal  * 100) / 100,
      };
    }


    function _buildRevenueEntries(sale, grandTotal, taxTotal, subTotal, discTotal) {
      var sa = _SA();
      if (!sa) return null;
      var grandPaisa = Math.round((parseFloat(grandTotal) || 0) * 100);
      var taxPaisa   = Math.round((parseFloat(taxTotal)   || 0) * 100);
      var discPaisa  = Math.round((parseFloat(discTotal)  || 0) * 100);
      var subTotalIsValid = (subTotal !== null && subTotal !== undefined && !isNaN(parseFloat(subTotal)));
      var subPaisa = subTotalIsValid ? Math.round(parseFloat(subTotal) * 100) : (grandPaisa - taxPaisa + discPaisa);
      if (subPaisa < 0) {
        _logger().warn('[SalesConnector] Negative subTotal computed for sale ' + sale.id +
          ' \u2014 discarding discount line to keep journal balanced.');
        subPaisa  = Math.max(0, grandPaisa - taxPaisa);
        discPaisa = 0;
      }
      if (grandPaisa <= 0) return null;

      var payMethod = sale.pay;
      if (payMethod === undefined || payMethod === null) {
        _logger().warn('[SalesConnector] sale.pay is missing for sale ' + sale.id + ' \u2014 defaulting to AR (credit). Pass pay field to avoid phantom AR on cash sales.');
      }
      var payLower  = (payMethod || '').toLowerCase();
      var isCredit  = (payLower === 'credit' || payLower === 'on account' || payLower === 'account' || payLower === '');
      var isCash    = !isCredit && (payLower === 'cash' || payLower.indexOf('cash') !== -1);
      var debitAcct = isCredit
        ? (sa.AR || 'acc-1100')
        : (isCash ? (sa.CASH || 'acc-1001') : (sa.BANK || 'acc-1002'));
      var debitDesc = isCredit
        ? ('Invoice receivable: ' + sale.id + (sale.customer ? ' \u2014 ' + sale.customer : ''))
        : (isCash
          ? ('Cash received: ' + sale.id + (sale.customer ? ' \u2014 ' + sale.customer : ''))
          : ('Payment received (' + (sale.pay || 'bank') + '): ' + sale.id + (sale.customer ? ' \u2014 ' + sale.customer : '')));
      var entries = [
        { accountId: debitAcct, debit: grandPaisa, credit: 0, description: debitDesc },
      ];
      if (subPaisa > 0) {
        entries.push({ accountId: sa.SALES_REV || 'acc-4001', debit: 0, credit: subPaisa, description: 'Sales revenue (gross): ' + sale.id });
      }
      if (discPaisa > 0) {
        entries.push({ accountId: sa.SALES_DISC || 'acc-4003', debit: discPaisa, credit: 0, description: 'Trade discount: ' + sale.id });
      }
      if (taxPaisa > 0) {
        entries.push({ accountId: sa.GST_PAYABLE || 'acc-2200', debit: 0, credit: taxPaisa, description: 'Output GST: ' + sale.id });
      }
      return { entries: entries, grandPaisa: grandPaisa, subPaisa: subPaisa, discPaisa: discPaisa, taxPaisa: taxPaisa };
    }

    function _buildCOGSEntries(sale) {
      var sa = _SA();
      if (!sa) return null;
      var items          = sale.items || [];
      var totalCostPaisa = 0;
      var lineCount      = 0;
      for (var i = 0; i < items.length; i++) {
        var si   = items[i];
        var name = si.n || si.sku || si.code || '';
        if (!name) continue;
        var qty  = parseFloat(si.q || si.qty) || 0;
        if (qty <= 0) continue;
        var invItem = _findInvItem(name);
        if (_isService(invItem)) continue;
        var bc  = (invItem && invItem.bc) ? invItem.bc : name;
        var mac = _getMAC(bc);
        if (mac <= 0) {
          mac = (invItem && invItem.pp) ? parseFloat(invItem.pp) || 0 : 0;
          if (mac <= 0) {
            _logger().warn('[SalesConnector] MAC=0 and no pp fallback for item:', name, '\u2014 COGS skipped for this line');
            continue;
          }
          _logger().warn('[SalesConnector] MAC=0 for item:', name, '\u2014 using pp as COGS fallback:', mac);
        }
        var costPaisa = Math.round(mac * 100) * Math.round(qty);
        if (costPaisa <= 0) continue;
        totalCostPaisa += costPaisa;
        lineCount++;
      }
      if (totalCostPaisa <= 0) return null;
      return {
        entries: [
          { accountId: sa.COGS || sa.PURCHASE_EXP || 'acc-5100', debit: totalCostPaisa, credit: 0,              description: 'COGS: ' + sale.id + ' (' + lineCount + ' line' + (lineCount === 1 ? '' : 's') + ')' },
          { accountId: sa.INVENTORY || 'acc-1200',                debit: 0,              credit: totalCostPaisa, description: 'Inventory consumed: ' + sale.id },
        ],
        totalCostPaisa: totalCostPaisa,
        lines: lineCount,
      };
    }


    var NON_POSTABLE_STATUSES = { draft: true, pending: true, void: true, voided: true, returned: true, cancelled: true, canceled: true };

    async function postSaleJournals(sale) {
      if (!sale || !sale.id) return Promise.resolve();
      var saleId = sale.id;

      if (sale.status && NON_POSTABLE_STATUSES[String(sale.status).toLowerCase()]) {
        _logger().info('[SalesConnector] Skipping posting \u2014 sale status is "' + sale.status + '":', saleId);
        return Promise.resolve();
      }

      var revDocId  = 'SALE-REV-'  + saleId;
      var cogsDocId = 'SALE-COGS-' + saleId;

      var revPosted  = PostingEngine.isPosted(revDocId);
      var cogsPosted = PostingEngine.isPosted(cogsDocId);

      if (revPosted && cogsPosted) {
        _logger().info('[SalesConnector] Already fully posted:', saleId);
        return Promise.resolve();
      }

      var sm = _SM();
      if (!sm) { _logger().warn('[SalesConnector] SOURCE_MODULE unavailable:', saleId); return Promise.resolve(); }

      var totals   = _computeSaleTotals(sale);
      var revData  = revPosted  ? null : _buildRevenueEntries(sale, totals.grand, totals.tax, totals.sub, totals.disc);
      var cogsData = cogsPosted ? null : _buildCOGSEntries(sale);

      if (!revData && !cogsData) {
        _logger().info('[SalesConnector] Nothing to post (zero value / all-service):', saleId);
        return Promise.resolve();
      }

      var postDate = (_isValidDateString(sale.date) ? sale.date : null) || _today();
      var party    = sale.customer || 'Walk-in Customer';

      var revJournals = null;

      if (revData) {
        try {
          revJournals = await PostingEngine.post({
            documentId:   revDocId,
            documentType: 'invoice',
            sourceModule: sm.SALES,
            date:         postDate,
            reference:    saleId,
            memo:         'Sales Invoice: ' + party + ' \u2014 ' + saleId,
            party:        party,
            entries:      revData.entries,
            actor:        'system',
          });
        } catch (e) {
          if (e.name === 'DuplicatePostingError') {
            _logger().info('[SalesConnector] Revenue already posted (idempotent):', saleId);
          } else {
            _logger().error('[SalesConnector] Revenue post failed:', saleId, e.message);
            throw e;
          }
        }
      }

      if (cogsData) {
        try {
          await PostingEngine.post({
            documentId:   cogsDocId,
            documentType: 'invoice',
            sourceModule: sm.SALES,
            date:         postDate,
            reference:    saleId,
            memo:         'COGS \u2014 ' + party + ': ' + saleId,
            party:        party,
            entries:      cogsData.entries,
            actor:        'system',
          });
        } catch (e) {
          if (e.name === 'DuplicatePostingError') {
            _logger().info('[SalesConnector] COGS already posted (idempotent):', saleId);
          } else {
            if (revJournals) {
              try {
                await PostingEngine.reverse(revDocId, {
                  reason: 'Compensating rollback \u2014 COGS post failed for ' + saleId,
                  actor:  'system',
                });
                _logger().warn('[SalesConnector] Revenue journal reversed (compensating):', saleId);
              } catch (revErr) {
                _logger().error('[SalesConnector] Compensating reversal FAILED:', saleId, revErr.message);
              }
            }
            _logger().error('[SalesConnector] COGS post failed:', saleId, e.message);
            throw e;
          }
        }
      }

      _logger().info('[SalesConnector] Journals posted for sale:', saleId);
      try {
        if (ACCOUNTING_EVENTS && ACCOUNTING_EVENTS.SALE_POSTED &&
            typeof _events().emitAsync === 'function') {
          _events().emitAsync(ACCOUNTING_EVENTS.SALE_POSTED, {
            saleId:  saleId,
            party:   party,
            date:    postDate,
          });
        }
      } catch (_) {}
    }


    function _notifyEditBlocked(saleId) {
      var msg = 'Invoice ' + saleId + ' has been posted to the General Ledger and cannot be edited. ' +
                'To make corrections, use a Credit Note or Return.';
      try {
        if (root.ToastManager && typeof root.ToastManager.error === 'function') {
          root.ToastManager.error('Edit Blocked \u2014 GL Posted', msg, 7000);
          return;
        }
        if (ERP.EventBus && typeof ERP.EventBus.emit === 'function') {
          ERP.EventBus.emit('ui:toast', { type: 'error', title: 'Edit Blocked \u2014 GL Posted', message: msg, duration: 7000 });
          return;
        }
        root.alert('Edit Blocked: ' + msg);
      } catch (_) {}
    }

    function _saleIsPosted(saleId) {
      if (!saleId) return false;
      return PostingEngine.isPosted('SALE-REV-' + saleId) ||
             PostingEngine.isPosted('SALE-COGS-' + saleId);
    }


    function _installOpenEditHook() {
      try {
        if (!ERP.sales || typeof ERP.sales.openEdit !== 'function') return;
        if (ERP.sales.openEdit._pe2Hooked) return;
        var _orig = ERP.sales.openEdit;
        ERP.sales.openEdit = function (id) {
          if (id && _saleIsPosted(id)) {
            _notifyEditBlocked(id);
            _logger().warn('[SalesConnector] openEdit blocked \u2014 GL posted:', id);
            return;
          }
          return _orig.apply(this, arguments);
        };
        ERP.sales.openEdit._pe2Hooked = true;
        ERP.sales.openEdit._origFn    = _orig;
        _logger().info('[SalesConnector] ERP.sales.openEdit hook installed.');
      } catch (_) {}
    }

    function _installActionsEditHook() {
      try {
        if (!ERP.actions || !ERP.actions.sales ||
            typeof ERP.actions.sales.openEdit !== 'function') return;
        if (ERP.actions.sales.openEdit._pe2Hooked) return;
        var _origA = ERP.actions.sales.openEdit;
        ERP.actions.sales.openEdit = function (id) {
          if (id && _saleIsPosted(id)) {
            _notifyEditBlocked(id);
            _logger().warn('[SalesConnector] actions.openEdit blocked \u2014 GL posted:', id);
            return;
          }
          return _origA.apply(this, arguments);
        };
        ERP.actions.sales.openEdit._pe2Hooked = true;
        ERP.actions.sales.openEdit._origFn    = _origA;
        _logger().info('[SalesConnector] ERP.actions.sales.openEdit hook installed.');
      } catch (_) {}
    }

    function _installSaveInvHook() {
      try {
        if (!ERP.sales || typeof ERP.sales._saveInv !== 'function') return;
        if (ERP.sales._saveInv._pe2Hooked) return;
        var _origSave = ERP.sales._saveInv;
        ERP.sales._saveInv = function () {
          var editId = null;
          try { editId = ERP.sales._currentInv && ERP.sales._currentInv.id; } catch (_) {}
          if (!editId) {
            try {
              var modal = document.getElementById('invModal');
              editId = modal ? (modal.dataset.editId || null) : null;
            } catch (_) {}
          }
          if (!editId) {
            try {
              var firstArg = arguments[0];
              if (firstArg && typeof firstArg === 'object' && firstArg.id) {
                editId = firstArg.id;
              } else if (typeof firstArg === 'string' || typeof firstArg === 'number') {
                editId = firstArg;
              }
            } catch (_) {}
          }
          if (editId && _saleIsPosted(editId)) {
            _notifyEditBlocked(editId);
            _logger().warn('[SalesConnector] _saveInv blocked \u2014 GL posted:', editId);
            return;
          }
          return _origSave.apply(this, arguments);
        };
        ERP.sales._saveInv._pe2Hooked = true;
        ERP.sales._saveInv._origFn    = _origSave;
        _logger().info('[SalesConnector] ERP.sales._saveInv hook installed.');
      } catch (_) {}
    }


    var _knownIds = Object.create(null);

    function _handleSaleAdd(payload) {
      var sale = payload && (payload.sale || payload.record);
      if (!sale) {
        if (payload && payload.id && Array.isArray(payload.items)) {
          sale = payload;
        } else {
          if (payload && payload.id) {
            _logger().warn('[SalesConnector] sales:added payload has no sale/record and no items array \u2014 skipping:', payload.id);
          }
          return;
        }
      }
      if (!sale.id) return;
      if (_knownIds[sale.id]) return;
      _knownIds[sale.id] = true;
      postSaleJournals(sale).catch(function (e) {
        _logger().error('[SalesConnector] postSaleJournals failed:', sale.id, e && e.message);
        delete _knownIds[sale.id];
      });
    }

    var _eventBusListenersInstalled = false;

    function _installEventBusListeners() {
      if (_eventBusListenersInstalled) return;
      try {
        if (ERP.EventBus && typeof ERP.EventBus.on === 'function') {
          ERP.EventBus.on('sales:added', _handleSaleAdd);
          _eventBusListenersInstalled = true;
        } else if (ERP.events && typeof ERP.events.on === 'function') {
          ERP.events.on('sales:added', _handleSaleAdd);
          _eventBusListenersInstalled = true;
        }
      } catch (_) {}
    }


    function backfill() {
      try {
        var s     = ERP._internal && ERP._internal.getState ? ERP._internal.getState() : {};
        var sales = (s.data && s.data.sales) ? s.data.sales : [];
        var queue = [];
        for (var i = 0; i < sales.length; i++) {
          var sale = sales[i];
          if (!sale || !sale.id) continue;
          if (sale.voided || sale._deleted || sale.deleted || sale.isDeleted || sale.removed) continue;
          if (sale.status && NON_POSTABLE_STATUSES[String(sale.status).toLowerCase()]) continue;
          if (!PostingEngine.isPosted('SALE-REV-' + sale.id) ||
              !PostingEngine.isPosted('SALE-COGS-' + sale.id)) {
            if (!_knownIds[sale.id]) {
              _knownIds[sale.id] = true;
              queue.push(sale);
            }
          }
        }
        if (!queue.length) return;
        _logger().info('[SalesConnector] Backfill queued:', queue.length, 'sale(s)');
        var idx = 0;
        function _processNext() {
          if (idx >= queue.length) return;
          var entry = queue[idx++];
          postSaleJournals(entry).then(function () {
            setTimeout(_processNext, 120);
          }).catch(function (e) {
            _logger().error('[SalesConnector] Backfill failed for sale:', entry.id, e && e.message);
            delete _knownIds[entry.id];
            setTimeout(_processNext, 120);
          });
        }
        setTimeout(_processNext, 0);
      } catch (_) {}
    }


    function init() {
      _installOpenEditHook();
      _installActionsEditHook();
      _installSaveInvHook();
      _installEventBusListeners();
      backfill();
      _logger().info('[SalesConnector] Initialized \u2014 atomic posting + edit-lock active.');
    }

    return {
      init:             init,
      backfill:         backfill,
      postSaleJournals: postSaleJournals,

      isPosted: function (saleId) {
        var rev  = PostingEngine.isPosted('SALE-REV-'  + saleId);
        var cogs = PostingEngine.isPosted('SALE-COGS-' + saleId);
        return { revenue: rev, cogs: cogs, anyPosted: rev || cogs };
      },

      adminUnlock: function (saleId, actor) {
        _requireAdminOrSystem(actor || 'system', 'adminUnlock', saleId, null);
        if (!saleId) return;
        LockManager.release('SALE-REV-'  + saleId);
        LockManager.release('SALE-COGS-' + saleId);
        _logger().warn('[SalesConnector] Admin unlock applied \u2014 edit re-enabled for:', saleId);
      },

      _diagnostics: function () {
        return {
          knownIdCount:   Object.keys(_knownIds).length,
          openEditHooked: !!(ERP.sales && ERP.sales.openEdit && ERP.sales.openEdit._pe2Hooked),
          saveInvHooked:  !!(ERP.sales && ERP.sales._saveInv && ERP.sales._saveInv._pe2Hooked),
          actionsHooked:  !!(ERP.actions && ERP.actions.sales &&
                             ERP.actions.sales.openEdit &&
                             ERP.actions.sales.openEdit._pe2Hooked),
          eventListeners: _eventBusListenersInstalled,
        };
      },
    };
  })();


  async function _runMigrationIfNeeded() {
    try {
      var st = ACC.AccountingState;
      if (!st) return;
      var meta = st.getMeta ? st.getMeta() : null;
      if (!meta) return;
      if ((meta.postingEngineVersion || 0) >= 2) return;

      _logger().info('[PostingEngine] Running migration to v2 \u2014 adding documentId to legacy journals...');

      var journals = (typeof st.getAllJournals === 'function') ? st.getAllJournals() : [];

      var count   = 0;
      var errCount = 0;
      for (var i = 0; i < journals.length; i++) {
        var j = journals[i];
        if (j.documentId) continue;

        var sid = j.sourceId || j.id;
        var derivedDocId;
        if (/^P\d+-REV-/.test(sid)) {
          derivedDocId = 'SALE-REV-' + sid.replace(/^P\d+-REV-/, '');
        } else if (/^P\d+-COGS-/.test(sid)) {
          derivedDocId = 'SALE-COGS-' + sid.replace(/^P\d+-COGS-/, '');
        } else {
          derivedDocId = sid;
        }

        var updated = Object.assign({}, j, {
          documentId: derivedDocId,
          _v: (j._v || 1) + 1,
        });
        try {
          await _store().putOne(IDB_STORES.JOURNALS, updated);
          if (typeof st.updateJournal === 'function') {
            st.updateJournal(updated);
          }
          count++;
        } catch (e) {
          errCount++;
          _logger().error('[PostingEngine] Migration: failed to update journal', j.id, e && e.message);
        }
      }

      if (errCount > 0) {
        _logger().warn('[PostingEngine] Migration completed with ' + errCount + ' error(s) — version NOT bumped. Will retry on next load.');
        return;
      }

      if (typeof st.setMetaField === 'function') {
        st.setMetaField('postingEngineVersion', 2);
      }

      _audit('migration', 'system', 'MIGRATION_V2', 'PostingEngine', null,
        { count: count }, { postingEngineVersion: 2 }, 'info');

      _logger().info('[PostingEngine] Migration complete \u2014', count, 'journals updated.');
    } catch (e) {
      _logger().error('[PostingEngine] Migration failed:', e && e.message);
    }
  }


  if (!ACC.JournalService) {
    ACC.JournalService = {
      post: function (data, actor) {
        if (root.DEBUG_MODE || root._mhDebug) {
          console.warn('[DEPRECATED] ACC.JournalService.post() \u2014 use ERP.PostingEngine.post()');
        }
        if (!data || !data.sourceId) {
          return Promise.reject(_err(ValidationError,
            'ACC.JournalService.post: sourceId is required for idempotent posting.',
            'JournalService', 'post', data && data.sourceId, null));
        }
        return PostingEngine.post({
          documentId:   'JS-' + data.sourceId,
          documentType: data.documentType || 'invoice',
          sourceModule: data.sourceModule,
          date:         data.date,
          reference:    data.reference,
          memo:         data.memo,
          party:        data.party,
          periodId:     data.periodId,
          entries:      data.entries,
          actor:        actor || 'system',
        });
      },
      reverse: function (journalId, reason, actor) {
        if (root.DEBUG_MODE || root._mhDebug) {
          console.warn('[DEPRECATED] ACC.JournalService.reverse() \u2014 use ERP.PostingEngine.reverse()');
        }
        var st = ACC.AccountingState;
        var journals = (st && typeof st.getAllJournals === 'function') ? st.getAllJournals() : [];
        var j = journals.find(function (x) { return x.id === journalId; });
        if (!j) return Promise.reject(new Error('[JournalService compat] Journal not found: ' + journalId));
        return PostingEngine.reverse(j.documentId, { reason: reason, actor: actor || 'system' });
      },
      isAlreadyPosted: function (sourceId) {
        return PostingEngine.isPosted(sourceId);
      },
    };
  }

  ERP.SalesPostingLock = {
    __salesPostingLock: true,
    isPosted:    function (saleId) { return SalesConnector.isPosted(saleId); },
    postSale:    function (sale)   { return SalesConnector.postSaleJournals(sale); },
    backfill:    function ()       { return SalesConnector.backfill(); },
    adminUnlock: function (saleId, actor) { return SalesConnector.adminUnlock(saleId, actor); },
    getPostedIds: function () {
      console.warn('[DEPRECATED] ERP.SalesPostingLock.getPostedIds() \u2014 no direct replacement; use PostingEngine.isPosted()');
      return [];
    },
    _diagnostics: function () { return SalesConnector._diagnostics(); },
  };

  ERP.PostingEngine  = PostingEngine;
  ERP.Ledger         = LedgerFacade;

  ERP.PostingEngine.ValidationError       = ValidationError;
  ERP.PostingEngine.DuplicatePostingError = DuplicatePostingError;
  ERP.PostingEngine.PermissionError       = PermissionError;
  ERP.PostingEngine.WALRecoveryError      = WALRecoveryError;
  ERP.PostingEngine.ConcurrencyError      = ConcurrencyError;

  var _salesConnectorInitialized = false;

  async function _boot() {
    try {
      await _runMigrationIfNeeded();
      if (!_salesConnectorInitialized) {
        _salesConnectorInitialized = true;
        SalesConnector.init();
      }
      try {
        if (ERP.EventBus && typeof ERP.EventBus.emit === 'function') {
          ERP.EventBus.emit('posting:engine:ready', {
            version: 2,
            modules: ['PostingValidator', 'JournalWriter', 'ReversalIndex',
                      'LockManager', 'PostingEngine', 'LedgerFacade', 'SalesConnector'],
          });
        }
      } catch (_) {}
      _logger().info('[PostingEngine] v2 ready \u2014 PostingEngine + LedgerFacade + SalesConnector loaded.');
    } catch (e) {
      _logger().error('[PostingEngine] Boot error:', e && e.message);
      if (!_salesConnectorInitialized) {
        _salesConnectorInitialized = true;
        try { SalesConnector.init(); } catch (ie) {
          _logger().error('[PostingEngine] SalesConnector.init() failed during boot recovery:', ie && ie.message);
        }
      }
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(_boot, 0);
    } else {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(_boot, 0); });
    }
  } else {
    _boot();
  }

  root.ERP = ERP;

})(typeof window !== 'undefined' ? window : globalThis);
