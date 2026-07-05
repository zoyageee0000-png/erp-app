(function (global) {
  'use strict';

  (function _installSharedDateUtils() {
    const root = global;
    if (typeof root.ERP === 'undefined' || root.ERP === null) root.ERP = {};
    const existing = root.ERP.DateUtils;
    if (existing && typeof existing.today === 'function' && typeof existing.now === 'function') return;
    const _pkDate = () => {
      const d = new Date();
      const utcMs = d.getTime() + (d.getTimezoneOffset() * 60000);
      return new Date(utcMs + (5 * 60 * 60000));
    };
    root.ERP.DateUtils = Object.assign({}, existing, {
      today: () => {
        const pk = _pkDate();
        return `${pk.getFullYear()}-${String(pk.getMonth() + 1).padStart(2, '0')}-${String(pk.getDate()).padStart(2, '0')}`;
      },
      now: () => _pkDate().toISOString(),
    });
  })();

  const STORE_KEY  = 'mh_purchase_store';
  const META_KEY   = 'mh_purchase_meta';
  const STAMP_KEY  = 'mh_purchase_stamp';
  const QUARANTINE_KEY = 'mh_purchase_quarantine';
  const STORE_VER  = 2;
  const LEDGER_KEY = 'mh_supplier_ledger';
  const ALLOC_KEY  = 'mh_payment_allocations_out';
  // ARCHITECTURAL FIX: resolved lazily, not as a top-level const — this file
  // loads before constants.js in index.html, so ERP.CONSTANTS wouldn't exist
  // yet at module-init time. Same pattern as storage_adapter.js/
  // erp.audit.archive.js use for their storage keys.
  function _legacyErpKey() {
    return (ERP && ERP.CONSTANTS && ERP.CONSTANTS.STORAGE_KEYS && ERP.CONSTANTS.STORAGE_KEYS.MAIN) || 'mh_erp_data';
  }
  const LEGACY_PAY_KEY = 'mh_paymentOuts';
  const LEGACY_POR_KEY = 'mh_purchaseOrders';
  const LEGACY_RET_KEY = 'mh_purchaseReturns';
  const PREFIX_PUR = 'PUR';
  const PREFIX_PO  = 'PO';
  const PREFIX_PR  = 'PR';
  const PREFIX_PAY = 'PAY';
  const MAX_ITEMS_PER_RECORD = 500;
  const MAX_ID_INPUT_LEN     = 64;
  const MIN_YEAR             = 1900;
  const MAX_YEAR             = 2100;
  const MAX_AMOUNT           = 1e12;
  const BILL_DATE_FUTURE_GRACE_DAYS = 3;

  const VALID_PAYMENT_TYPES = new Set(['cash','credit','cheque','upi','bank transfer','bank','online']);

  const VALID_LEDGER_TYPES = new Set([
    'OPENING_BALANCE','PURCHASE_BILL','PAYMENT_OUT',
    'PAYMENT_VOID','ADVANCE_USED','DEBIT_NOTE','ADJUSTMENT','PURCHASE_DELETE',
    'PURCHASE_RETURN','PO_RECEIVED'
  ]);

  const STATUS_MAP = {
    completed:'complete', complete:'complete', partial:'partial',
    pending:'draft', draft:'draft', returned:'returned', cancelled:'cancelled',
  };

  const VALID_TRANSITIONS = {
    draft    : new Set(['draft','partial','complete','cancelled']),
    partial  : new Set(['partial','complete','cancelled']),
    complete : new Set(['complete','returned']),
    returned : new Set(['returned','complete','partial','draft']),
    cancelled: new Set(['cancelled']),
  };

  const PO_VALID_TRANSITIONS = {
    draft    : new Set(['draft','pending','confirmed','cancelled']),
    pending  : new Set(['pending','confirmed','partial','received','cancelled']),
    confirmed: new Set(['pending','confirmed','partial','received','cancelled']),
    partial  : new Set(['partial','received','cancelled']),
    received : new Set([]),
    cancelled: new Set([]),
  };

  // ARCHITECTURAL FIX: these used to be a fully independent local error
  // hierarchy (own ERPError/ValidationError/ConflictError/NotFoundError/
  // StorageError classes, separate from the canonical ERP.errors registry —
  // ValidationError even name-collided with ERP.errors.ValidationError).
  // Now single-sourced: classes come from core.js's frozen registry, and
  // metadata enrichment (module/operation/documentId/txId/timestamp) goes
  // through the same ERP.mkError() helper posting_engine.js/sales_service.js
  // already use. All ~54 call sites below (`new ValidationError(msg, meta)`
  // etc.) are unchanged — a factory function returning an object works
  // identically under `new` (the returned object is used instead of `this`),
  // so no call-site edits were needed.
  if (!ERP.errors) throw new Error('[PurchaseState] ERP.errors missing. Load core.js first.');
  function _mkPurchaseError(Ctor) {
    return function (message, meta) {
      meta = meta || {};
      return ERP.mkError(Ctor, message,
        meta.module    || 'purchase_state',
        meta.operation || '',
        meta.documentId || null,
        meta.txId       || null);
    };
  }
  var ERPError        = _mkPurchaseError(ERP.errors.ERPError);
  var ValidationError = _mkPurchaseError(ERP.errors.ValidationError);
  var ConflictError    = _mkPurchaseError(ERP.errors.ConflictError);
  var NotFoundError    = _mkPurchaseError(ERP.errors.NotFoundError);
  var StorageError     = _mkPurchaseError(ERP.errors.StorageError);

  let _purchases       = [];
  let _purchaseOrders  = [];
  let _purchaseReturns = [];
  let _paymentOuts     = [];
  let _deletedRecords  = [];

  let _supplierLedger        = {};
  let _paymentAllocationsOut = {};

  let _idx = { purchaseById:{}, poById:{}, returnById:{}, paymentById:{} };
  let _meta = { purchaseSeq:0, poSeq:0, returnSeq:0, paymentSeq:0 };
  let _writeStamp = 0;
  let _onExternalUpdateCb = null;
  let _syncToDBCb = null;

  const _erpToday = () => global.ERP.DateUtils.today();
  const _erpNow   = () => global.ERP.DateUtils.now();

  const _num = (v, fallback = 0) => {
    const n = parseFloat(v);
    return (Number.isFinite(n) && Math.abs(n) <= MAX_AMOUNT) ? n : fallback;
  };
  const _numNonNeg = (v, fallback = 0) => {
    const n = parseFloat(v);
    return (Number.isFinite(n) && n >= 0 && n <= MAX_AMOUNT) ? n : fallback;
  };

  const _round2 = (n) => Math.round(n * 100) / 100;

  // Single source of truth: delegates to ACC.Money (accounting_constants.js),
  // which loads before this file. Previously this was a naive comma-strip
  // parser that didn't handle parentheses-negative accounting notation.
  const _toPaisa = (floatRupees) => {
    const ACC = global.AccountingCore;
    if (!ACC || !ACC.Money) throw new Error('[PurchaseState] ACC.Money missing. Load accounting_constants.js first.');
    return ACC.Money.toPaisa(floatRupees);
  };

  const _fromPaisa = (paisa) => {
    const ACC = global.AccountingCore;
    if (!ACC || !ACC.Money) throw new Error('[PurchaseState] ACC.Money missing. Load accounting_constants.js first.');
    return ACC.Money.fromPaisa(paisa);
  };

  // FIX (root cause, audit #61-66): core.js (ERP.uid) is the first of 92
  // scripts loaded, before this file -- a missing-ERP.uid fallback bought
  // nothing but a second, weaker ID scheme for financial purchase records.
  // Matches this file's own existing convention (see ACC.Money check above)
  // of throwing rather than silently degrading when a required dependency
  // isn't loaded.
  const _genId = () => {
    if (typeof ERP === 'undefined' || typeof ERP.uid !== 'function') {
      throw new Error('[PurchaseState] ERP.uid unavailable. Load core.js first.');
    }
    return ERP.uid();
  };

  const _deepClone = (rec) => {
    if (typeof structuredClone === 'function') return structuredClone(rec);
    return JSON.parse(JSON.stringify(rec));
  };

  const _clone    = (rec) => _deepClone(rec);
  const _cloneAll = (arr) => arr.map(_clone);

  const _SAFE_OBJ_BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);
  const _safeObj = (obj) => {
    if (!obj || typeof obj !== 'object') return Object.create(null);
    const safe = Object.create(null);
    for (const k of Object.keys(obj)) {
      if (!_SAFE_OBJ_BLOCKED.has(k)) safe[k] = obj[k];
    }
    return safe;
  };

  const _validateDate = (dateStr, { allowFuture = false, futureGraceDays = 0 } = {}) => {
    if (!dateStr) return '';
    if (dateStr instanceof Date) {
      if (isNaN(dateStr.getTime())) return '';
      const y = dateStr.getFullYear();
      const m = String(dateStr.getMonth() + 1).padStart(2, '0');
      const d = String(dateStr.getDate()).padStart(2, '0');
      dateStr = `${y}-${m}-${d}`;
    }
    if (typeof dateStr !== 'string') return '';
    const str = dateStr.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return '';
    const d = new Date(str + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    if (y < MIN_YEAR || y > MAX_YEAR) return '';
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const canon = `${d.getFullYear()}-${mm}-${dd}`;
    if (canon !== str) return '';
    if (!allowFuture) {
      const now = new Date();
      const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const maxAllowed = new Date(todayLocal);
      if (futureGraceDays > 0) maxAllowed.setDate(maxAllowed.getDate() + futureGraceDays);
      if (d > maxAllowed) return '';
    }
    return str;
  };

  const _numericSuffix = (id) => {
    if (!id || typeof id !== 'string') return 0;
    const safe = id.length > MAX_ID_INPUT_LEN ? id.slice(-MAX_ID_INPUT_LEN) : id;
    const m = safe.match(/(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
  };

  const _scanMax = (arr) =>
    arr.reduce((max, rec) => Math.max(max, _numericSuffix(rec.id || '')), 0);

  const _fmtId = (prefix, n) => `${prefix}-${String(n).padStart(6,'0')}`;

  const _dedup = (arr) => {
    const seen = new Set();
    return arr.filter(r => {
      if (!r) return false;
      const id = r.id;
      if (id === undefined || id === null || id === '') return false;
      if (seen.has(id)) return false;
      seen.add(id); return true;
    });
  };

  const _checksum = (str) => {
    let h = 5381;
    for (let i = 0; i < str.length; i++) { h = ((h << 5) + h) ^ str.charCodeAt(i); h = h >>> 0; }
    return h.toString(16);
  };

  let _lsAvailableCache = null;
  const _localStorageAvailable = () => {
    if (_lsAvailableCache !== null) return _lsAvailableCache;
    try { const k='__mh_ls_test__'; localStorage.setItem(k,'1'); localStorage.removeItem(k); _lsAvailableCache=true; }
    catch (_) { _lsAvailableCache=false; }
    return _lsAvailableCache;
  };

  const _saWrite = (key, value) => {
    const erp = typeof ERP !== 'undefined' ? ERP : null;
    if (erp && erp.StorageAdapter && typeof erp.StorageAdapter.set === 'function') {
      erp.StorageAdapter.set(key, value);
      return;
    }
    if (_localStorageAvailable()) localStorage.setItem(key, value);
  };

  const _saRead = (key) => {
    const erp = typeof ERP !== 'undefined' ? ERP : null;
    if (erp && erp.StorageAdapter && typeof erp.StorageAdapter.get === 'function')
      return erp.StorageAdapter.get(key);
    if (_localStorageAvailable()) return localStorage.getItem(key);
    return null;
  };

  const _saRemove = (key) => {
    const erp = typeof ERP !== 'undefined' ? ERP : null;
    if (erp && erp.StorageAdapter && typeof erp.StorageAdapter.remove === 'function') {
      erp.StorageAdapter.remove(key);
      return;
    }
    if (_localStorageAvailable()) localStorage.removeItem(key);
  };

  const _QUARANTINE_MAX = 200;
  const _quarantine = (recordType, raw, errorMsg) => {
    try {
      const list = JSON.parse(_saRead(QUARANTINE_KEY) || '[]');
      const safeRaw = raw && typeof raw === 'object'
        ? { id: raw.id, date: raw.date, total: raw.total, status: raw.status }
        : String(raw).slice(0, 200);
      list.push({ recordType, raw: safeRaw, error: errorMsg, quarantinedAt: _erpNow() });
      if (list.length > _QUARANTINE_MAX) list.splice(0, list.length - _QUARANTINE_MAX);
      _saWrite(QUARANTINE_KEY, JSON.stringify(list));
    } catch (qErr) {
      console.error('[PurchaseState] _quarantine: failed to persist quarantined record:', qErr.message);
    }
  };

  const getQuarantinedRecords = () => {
    try { return JSON.parse(_saRead(QUARANTINE_KEY) || '[]'); } catch (e) { return []; }
  };

  const clearQuarantinedRecords = () => { _saRemove(QUARANTINE_KEY); };

  const WAL_KEY = 'mh_erp_wal_purchase';

  const _walBegin = (txId, steps) => {
    const wal = { txId, steps, completedSteps: [], status: 'in_progress', timestamp: _erpNow() };
    try { _saWrite(WAL_KEY, JSON.stringify(wal)); } catch (_) {}
    return wal;
  };

  const _walStep = (wal, step) => {
    wal.completedSteps.push(step);
    try { _saWrite(WAL_KEY, JSON.stringify(wal)); } catch (_) {}
  };

  const _walCommit = (wal) => {
    wal.status = 'committed';
    try { _saRemove(WAL_KEY); } catch (_) {}
  };

  const _walAbort = (wal) => {
    wal.status = 'aborted';
    try { _saWrite(WAL_KEY, JSON.stringify(wal)); } catch (_) {}
  };

  const _auditWrite = (event, details) => {
    try {
      const erp = typeof ERP !== 'undefined' ? ERP : null;
      if (erp && erp.AuditLog && typeof erp.AuditLog.write === 'function') {
        erp.AuditLog.write({ module: 'purchase_state', event, ...details, timestamp: _erpNow() });
      }
    } catch (_) {}
  };

  const deriveStatus = (remainingPaisa, totalPaisa) => {
    if (totalPaisa <= 0) return 'PAID';
    if (remainingPaisa <= 0)          return 'PAID';
    if (remainingPaisa >= totalPaisa) return 'UNPAID';
    return 'PARTIAL';
  };

  const _syncWorkflowStatusFromPayStatus = (clone) => {
    const cur = (clone.status || clone.st || 'draft').toLowerCase();
    if (cur === 'returned' || cur === 'cancelled') return;
    const next = clone.payStatus === 'PAID' ? 'complete'
      : clone.payStatus === 'PARTIAL' ? 'partial'
      : 'draft';
    if (next !== cur) { clone.status = next; clone.st = next; }
  };

  const removeLedgerEntry = (supplierId, entryId) => {
    const key = (supplierId || '').toLowerCase().trim();
    if (!_supplierLedger[key]) return { ok: false, error: 'supplier ledger not found' };
    const before = _supplierLedger[key].length;
    _supplierLedger[key] = _supplierLedger[key].filter(e => e.id !== entryId);
    if (_supplierLedger[key].length === before)
      return { ok: false, error: 'entry not found' };
    _saveLedger();
    recalculate(key);
    return { ok: true };
  };

  const getLedgerBalance = (supplierId) => {
    const key = (supplierId || '').toLowerCase().trim();
    const entries = _supplierLedger[key] || [];
    return entries.reduce((sum, e) => sum + (e.credit || 0) - (e.debit || 0), 0);
  };

  const getSupplierLedgerEntries = (supplierId) => {
    const key     = (supplierId || '').toLowerCase().trim();
    const entries = _supplierLedger[key] || [];
    return _cloneAll(entries).sort((a, b) => {
      const d = (a.date || '').localeCompare(b.date || '');
      return d !== 0 ? d : (a.createdAt || '').localeCompare(b.createdAt || '');
    });
  };

  const writeLedgerEntry = (entry) => {
    try {
      const { supplierId, type, debit, credit, referenceId, date, note } = entry;
      if (!supplierId)                         return { ok:false, error:'writeLedgerEntry: supplierId required' };
      if (!VALID_LEDGER_TYPES.has(type))       return { ok:false, error:`writeLedgerEntry: invalid type "${type}"` };
      if (!Number.isInteger(debit)  || debit  < 0) return { ok:false, error:'writeLedgerEntry: debit must be non-negative integer paisa' };
      if (!Number.isInteger(credit) || credit < 0) return { ok:false, error:'writeLedgerEntry: credit must be non-negative integer paisa' };
      if (debit === 0 && credit === 0)         return { ok:false, error:'writeLedgerEntry: debit and credit cannot both be zero' };
      if (!_validateDate(date || ''))          return { ok:false, error:'writeLedgerEntry: invalid date' };

      const id = _genId();
      const normSupplierId = (supplierId || '').toLowerCase().trim().replace(/\s+/g, ' ');
      const newEntry = {
        id, supplierId: normSupplierId, type,
        debit  : debit  || 0,
        credit : credit || 0,
        referenceId : referenceId || '',
        date,
        createdAt  : _erpNow(),
        note       : note || '',
        runningBal : 0,
      };

      if (!_supplierLedger[normSupplierId]) _supplierLedger[normSupplierId] = [];
      _supplierLedger[normSupplierId].push(newEntry);
      recalculate(normSupplierId);

      _auditWrite('ledger_entry_written', {
        supplierId: normSupplierId, type, referenceId: referenceId || '', entryId: id,
      });

      return { ok:true, id };
    } catch (e) {
      return { ok:false, error:`writeLedgerEntry: ${e.message}` };
    }
  };

  const renameLedgerKey = (oldId, newId) => {
    const oldKey = (oldId || '').toLowerCase().trim().replace(/\s+/g, ' ');
    const newKey = (newId || '').toLowerCase().trim().replace(/\s+/g, ' ');
    if (!oldKey || !newKey || oldKey === newKey) return { ok: true, moved: 0 };
    const oldEntries = _supplierLedger[oldKey];
    if (!oldEntries || !oldEntries.length) return { ok: true, moved: 0 };
    const moved = oldEntries.map(e => Object.assign({}, e, { supplierId: newKey }));
    _supplierLedger[newKey] = (_supplierLedger[newKey] || []).concat(moved);
    delete _supplierLedger[oldKey];
    recalculate(newKey);
    _saveLedger();
    _auditWrite('ledger_key_renamed', { oldId: oldKey, newId: newKey, count: moved.length });
    return { ok: true, moved: moved.length };
  };

  const recalculate = (supplierId) => {
    const key = (supplierId || '').toLowerCase().trim();
    if (!_supplierLedger[key]) return;
    _supplierLedger[key].sort((a, b) => {
      const d = (a.date || '').localeCompare(b.date || '');
      return d !== 0 ? d : (a.createdAt || '').localeCompare(b.createdAt || '');
    });
    let running = 0;
    for (const entry of _supplierLedger[key]) {
      running += (entry.credit || 0) - (entry.debit || 0);
      entry.runningBal = running;
    }
    _saveLedger();
  };

  const fifoAllocate = (paymentId, supplierId, paymentAmountPaisa, targetPurchaseId) => {
    const sidLc = (supplierId || '').toLowerCase().trim();
    const unpaidBills = _purchases
      .filter(p =>
        !p._deleted &&
        (
          (p.supplierId && (p.supplierId || '').toLowerCase().trim() === sidLc) ||
          (!p.supplierId && (p.supplierName || '').toLowerCase().trim() === sidLc)
        ) &&
        p.payStatus !== 'PAID'
      )
      .sort((a, b) => {
        const d = (a.date || '').localeCompare(b.date || '');
        return d !== 0 ? d : (a.createdAt || '').localeCompare(b.createdAt || '');
      });

    if (targetPurchaseId) {
      const tIdx = unpaidBills.findIndex(p => p.id === targetPurchaseId);
      if (tIdx > 0) {
        const [target] = unpaidBills.splice(tIdx, 1);
        unpaidBills.unshift(target);
      }
    }

    if (!_paymentAllocationsOut[paymentId]) _paymentAllocationsOut[paymentId] = [];

    let remaining = paymentAmountPaisa;
    const allocations = [];
    const mutations = [];

    for (const purchase of unpaidBills) {
      if (remaining <= 0) break;
      const purchaseRemaining = purchase.remainingPaisa || 0;
      if (purchaseRemaining <= 0) continue;

      const allocate = Math.min(remaining, purchaseRemaining);
      const alloc = { paymentId, purchaseId: purchase.id, amountAllocated: allocate };
      allocations.push(alloc);

      const clone = Object.assign({}, purchase);
      clone.paidPaisa      = Math.min((clone.paidPaisa || 0) + allocate, clone.totalPaisa || 0);
      clone.remainingPaisa = (clone.totalPaisa || 0) - clone.paidPaisa;
      if (clone.remainingPaisa < 0) clone.remainingPaisa = 0;
      clone.payStatus = deriveStatus(clone.remainingPaisa, clone.totalPaisa || 0);
      _syncWorkflowStatusFromPayStatus(clone);
      clone.paid      = _fromPaisa(clone.paidPaisa);
      clone.remaining = _fromPaisa(clone.remainingPaisa);
      clone.balance   = clone.remaining;
      mutations.push(clone);

      remaining -= allocate;
    }

    if (allocations.length > 0) {
      const originals = [];
      for (const clone of mutations) {
        const i = _purchases.findIndex(p => p.id === clone.id);
        if (i >= 0) {
          originals.push({ i, orig: _deepClone(_purchases[i]) });
          _purchases[i] = clone;
          _idx.purchaseById[clone.id] = _purchases[i];
        }
      }

      _paymentAllocationsOut[paymentId].push(...allocations);
      _saveAllocations();
      const sr = _save();
      if (!sr.ok) {
        for (const { i, orig } of originals) {
          _purchases[i] = orig;
          _idx.purchaseById[orig.id] = _purchases[i];
        }
        _paymentAllocationsOut[paymentId] = (_paymentAllocationsOut[paymentId] || []).filter(
          a => !allocations.find(al => al.purchaseId === a.purchaseId && al.paymentId === a.paymentId && al.amountAllocated === a.amountAllocated)
        );
        _saveAllocations();
        throw new StorageError('[PurchaseState] fifoAllocate: _save() failed — allocations rolled back', { operation: 'fifoAllocate' });
      }
    }

    return allocations;
  };

  const reverseAllocations = (paymentId, opts) => {
    const allocs = _paymentAllocationsOut[paymentId] || [];
    const mutations = [];
    let totalReversedPaisa = 0;

    for (const alloc of allocs) {
      const purchase = _idx.purchaseById[alloc.purchaseId];
      if (!purchase) continue;

      const clone = Object.assign({}, purchase);
      clone.paidPaisa      = Math.max(0, (clone.paidPaisa || 0) - alloc.amountAllocated);
      clone.remainingPaisa = (clone.totalPaisa || 0) - clone.paidPaisa;
      if (clone.remainingPaisa < 0) clone.remainingPaisa = 0;
      clone.payStatus = deriveStatus(clone.remainingPaisa, clone.totalPaisa || 0);
      _syncWorkflowStatusFromPayStatus(clone);
      clone.paid      = _fromPaisa(clone.paidPaisa);
      clone.remaining = _fromPaisa(clone.remainingPaisa);
      clone.balance   = clone.remaining;
      mutations.push(clone);
      totalReversedPaisa += alloc.amountAllocated;
    }

    const allocBackup = _deepClone(_paymentAllocationsOut[paymentId] || []);
    delete _paymentAllocationsOut[paymentId];

    const originals = [];
    for (const clone of mutations) {
      const i = _purchases.findIndex(p => p.id === clone.id);
      if (i >= 0) {
        originals.push({ i, orig: _deepClone(_purchases[i]) });
        _purchases[i] = clone;
        _idx.purchaseById[clone.id] = _purchases[i];
      }
    }

    _saveAllocations();
    const sr = _save();
    if (!sr.ok) {
      for (const { i, orig } of originals) {
        _purchases[i] = orig;
        _idx.purchaseById[orig.id] = _purchases[i];
      }
      _paymentAllocationsOut[paymentId] = allocBackup;
      _saveAllocations();
      throw new StorageError('[PurchaseState] reverseAllocations: _save() failed', { operation: 'reverseAllocations' });
    }

    if (!opts || !opts.skipLedgerEntry) {
      if (totalReversedPaisa > 0) {
        const payment = _idx.paymentById[paymentId];
        if (payment) {
          writeLedgerEntry({
            type:       'PAYMENT_VOID',
            supplierId: payment.supplierId || payment.supplierName || '',
            debit:      0,
            credit:     totalReversedPaisa,
            date:       _erpToday(),
            referenceId: paymentId,
            note:       'Payment void reversal for ' + paymentId,
          });
        }
      }
    }
  };

  const _saveLedger = () => {
    if (_ledgerSaveDeferred) return;
    try { _saWrite(LEDGER_KEY, JSON.stringify(_supplierLedger)); }
    catch (e) { console.error('[PurchaseState] _saveLedger:', e.message); }
    // ARCHITECTURAL REFACTOR: also mirror to IndexedDB via ERP.Persistence
    // (single choke point for all IndexedDB writes) — localStorage remains
    // the primary, synchronous, authoritative store for this ledger; this is
    // an additional durability backup, fire-and-forget so it never blocks or
    // changes the existing synchronous save behavior above.
    try {
      if (window.ERP && ERP.Persistence && typeof ERP.Persistence.saveObject === 'function') {
        ERP.Persistence.saveObject('supplierLedger', _supplierLedger, { silent: true }).catch(function () {});
      }
    } catch (e) {}
  };

  const _saveAllocations = () => {
    try { _saWrite(ALLOC_KEY, JSON.stringify(_paymentAllocationsOut)); }
    catch (e) { console.error('[PurchaseState] _saveAllocations:', e.message); }
    try {
      if (window.ERP && ERP.Persistence && typeof ERP.Persistence.saveObject === 'function') {
        ERP.Persistence.saveObject('supplierPaymentAllocationsOut', _paymentAllocationsOut, { silent: true }).catch(function () {});
      }
    } catch (e) {}
  };

  const _loadLedger = () => {
    try {
      const raw = _saRead(LEDGER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) || {};
        _supplierLedger = {};
        for (const k of Object.keys(parsed)) {
          const lk = k.toLowerCase().trim();
          if (!Array.isArray(parsed[k])) continue;
          if (!_supplierLedger[lk]) _supplierLedger[lk] = [];
          _supplierLedger[lk] = _supplierLedger[lk].concat(parsed[k]);
        }
      }
    } catch (e) { console.warn('[PurchaseState] _loadLedger:', e.message); _supplierLedger = {}; }
  };

  const _loadAllocations = () => {
    try {
      const raw = _saRead(ALLOC_KEY);
      if (raw) _paymentAllocationsOut = JSON.parse(raw) || {};
    } catch (e) { console.warn('[PurchaseState] _loadAllocations:', e.message); _paymentAllocationsOut = {}; }
  };

  const _rebuildIndexes = () => {
    _idx = { purchaseById:{}, poById:{}, returnById:{}, paymentById:{} };
    for (const r of _purchases)       _idx.purchaseById[r.id] = r;
    for (const r of _purchaseOrders)  _idx.poById[r.id]       = r;
    for (const r of _purchaseReturns) _idx.returnById[r.id]   = r;
    for (const r of _paymentOuts)     _idx.paymentById[r.id]  = r;
  };

  const _validateMeta = (m) => {
    const v = {};
    for (const k of ['purchaseSeq','poSeq','returnSeq','paymentSeq']) {
      const n = parseInt(m[k], 10);
      v[k] = (Number.isFinite(n) && n >= 0) ? n : 0;
    }
    return v;
  };

  const _calcItemAmount = (item) => {
    const qty = item.qty || 0;
    const rate = item.rate || 0;
    const base = _round2(qty * rate);
    const discPct = Math.max(0, Math.min(100, item.discPct || 0));
    const discAmt = discPct > 0 ? _round2(base * discPct / 100) : (item.discAmt || 0);
    const afterDisc = _round2(Math.max(0, base - discAmt));
    const taxPct = Math.max(0, item.taxPct || 0);
    const taxAmt = taxPct > 0 ? _round2(afterDisc * taxPct / 100) : (item.taxAmt || 0);
    const afterTax = afterDisc + taxAmt;
    return _round2(Math.max(0, afterTax));
  };

  const _calcPurchaseTotals = (items, discount, tax) => {
    const subtotal = _round2(items.reduce((s, i) => s + _calcItemAmount(i), 0));
    const discVal = _round2(_num(discount, 0));
    const taxVal = _round2(_num(tax, 0));
    const total = _round2(Math.max(0, subtotal - discVal + taxVal));
    return { subtotal, tax: taxVal, discount: discVal, total };
  };

  const _normalisePurchase = (raw, { isUpdate = false, currentStatus = null, migrate = false } = {}) => {
    if (!raw || typeof raw !== 'object')
      throw new ValidationError('normalisePurchase: payload must be an object', { operation: 'normalisePurchase' });

    const safe = _safeObj(raw);
    const id           = (safe.id   || '').trim();
    const date         = _validateDate((safe.date || _erpToday()).trim(), { allowFuture: migrate, futureGraceDays: BILL_DATE_FUTURE_GRACE_DAYS }) || (migrate ? _erpToday() : '');
    const supplierName = (safe.supplierName || safe.sup || '').trim();
    const supplierId   = (safe.supplierId   || supplierName).toLowerCase().trim();

    if (!id)         throw new ValidationError('normalisePurchase: id is required', { operation: 'normalisePurchase', documentId: id });
    if (!date)       throw new ValidationError('normalisePurchase: date is invalid or out of range', { operation: 'normalisePurchase', documentId: id });
    if (!supplierId) throw new ValidationError('normalisePurchase: supplierId is required', { operation: 'normalisePurchase', documentId: id });

    const billNoToCheck = (safe.billNo || '').trim();
    if (!migrate && billNoToCheck && billNoToCheck !== id) {
      const dupBill = _purchases.find(p =>
        p.id !== id &&
        !p._deleted &&
        (p.supplierId || '').toLowerCase().trim() === supplierId &&
        (p.billNo || '').trim() === billNoToCheck
      );
      if (dupBill) {
        throw new ConflictError(`normalisePurchase: duplicate bill number "${billNoToCheck}" already exists for this supplier (existing: ${dupBill.id})`, { operation: 'normalisePurchase', documentId: id });
      }
    }

    const rawItems = Array.isArray(safe.itemsList) ? safe.itemsList
                   : Array.isArray(safe.items)     ? safe.items : [];
    if (rawItems.length > MAX_ITEMS_PER_RECORD)
      throw new ValidationError(`normalisePurchase: too many items (max ${MAX_ITEMS_PER_RECORD})`, { operation: 'normalisePurchase', documentId: id });

    const items = rawItems
      .filter(i => i && (i.name || i.n))
      .map(i => {
        const qty = _numNonNeg(i.qty ?? i.q ?? 0, 0);
        if (qty <= 0) {
          console.warn(`[PurchaseState] normalisePurchase: item qty <= 0 skipped for "${i.name || i.n}" in ${id}`);
          return null;
        }
        const rate = _numNonNeg(i.rate || i.price || i.p, 0);
        const discPct = _round2(_numNonNeg(i.discPct, 0));
        if (discPct > 100) throw new ValidationError('normalisePurchase: item discPct cannot exceed 100%', { operation: 'normalisePurchase', documentId: id });
        const taxPct = _round2(_numNonNeg(i.taxPct, 0));
        if (taxPct > 100) throw new ValidationError('normalisePurchase: item taxPct cannot exceed 100%', { operation: 'normalisePurchase', documentId: id });
        const itemObj = {
          itemId   : (i.itemId || i.bc    || '').trim(),
          name     : (i.name   || i.n     || '').trim(),
          qty, rate: _round2(rate),
          unit     : (i.unit   || 'NONE').trim(),
          colour   : (i.colour || '').trim(),
          discPct,
          discAmt  : _round2(_numNonNeg(i.discAmt, 0)),
          taxPct,
          taxLabel : (i.taxLabel || 'NONE').trim(),
          taxAmt   : _round2(_numNonNeg(i.taxAmt, 0)),
          amount   : _round2(_numNonNeg(i.lineAmt || i.amount, 0)),
          image    : i.image || null,
        };
        const calcAmt = _calcItemAmount(itemObj);
        if (itemObj.amount !== calcAmt) {
          itemObj.amount = calcAmt;
        }
        return itemObj;
      }).filter(i => i !== null);

    const inputSubtotal = safe.subtotal !== undefined ? _round2(_num(safe.subtotal, 0)) : (safe.sub !== undefined ? _round2(_num(safe.sub, 0)) : null);
    const inputTax = safe.tax !== undefined ? _round2(_num(safe.tax, 0)) : null;
    const inputDiscount = safe.discount !== undefined ? _round2(_num(safe.discount, 0)) : (safe.disc !== undefined ? _round2(_num(safe.disc, 0)) : (safe.discAmt !== undefined ? _round2(_num(safe.discAmt, 0)) : null));
    const inputTotal = safe.total !== undefined ? _round2(_num(safe.total, 0)) : (safe.amt !== undefined ? _round2(_num(safe.amt, 0)) : null);

    const computed = _calcPurchaseTotals(items, inputDiscount !== null ? inputDiscount : 0, inputTax !== null ? inputTax : 0);

    const subtotal = inputSubtotal !== null ? inputSubtotal : computed.subtotal;
    const tax      = inputTax !== null ? inputTax : computed.tax;
    const discount = inputDiscount !== null ? inputDiscount : computed.discount;
    const total    = inputTotal !== null ? inputTotal : computed.total;

    if (Math.abs(subtotal - computed.subtotal) > 0.01) {
      console.warn(`[PurchaseState] subtotal mismatch: input=${subtotal}, computed=${computed.subtotal} for ${id}`);
    }
    if (Math.abs(total - computed.total) > 0.01) {
      console.warn(`[PurchaseState] total mismatch: input=${total}, computed=${computed.total} for ${id}`);
    }

    const totalPaisa = _toPaisa(total);

    const paidPaisa = Number.isInteger(safe.paidPaisa)
      ? Math.min(Math.max(0, safe.paidPaisa), totalPaisa)
      : _toPaisa(Math.min(_numNonNeg(safe.paid ?? safe.paidAmount, 0), total));

    const remainingPaisa = Math.max(0, totalPaisa - paidPaisa);
    const payStatus = deriveStatus(remainingPaisa, totalPaisa);

    const paid      = _fromPaisa(paidPaisa);
    const remaining = _fromPaisa(remainingPaisa);
    const balance   = remaining;

    const rawStatus = (safe.status || safe.st || 'draft').toLowerCase();
    const status = STATUS_MAP[rawStatus] || 'draft';

    if (isUpdate && currentStatus && currentStatus !== status) {
      const allowed = VALID_TRANSITIONS[currentStatus];
      if (allowed && !allowed.has(status))
        throw new ValidationError(`normalisePurchase: invalid status transition "${currentStatus}" → "${status}"`, { operation: 'normalisePurchase', documentId: id });
    }

    const dueDate = _validateDate((safe.dueDate || '').trim(), { allowFuture: true });
    const rawPT   = (safe.payType || safe.paymentType || 'cash').trim().toLowerCase();
    const paymentType = VALID_PAYMENT_TYPES.has(rawPT) ? rawPT : 'cash';

    return {
      id,
      billNo        : (safe.billNo || id).trim(),
      date,
      createdAt     : safe.createdAt || _erpNow(),
      dueDate       : dueDate || '',
      stateOfSupply : (safe.state || safe.stateOfSupply || '').trim(),
      supplierId, supplierName,
      supplierPhone : (safe.ph || safe.supplierPhone || '').trim(),
      items,
      subtotal, tax, discount, total,
      totalPaisa, paidPaisa, remainingPaisa, payStatus,
      paid, remaining,
      balance,
      paymentType, status,
      notes    : (safe.notes || '').trim(),
      _deleted : safe._deleted === true,
      _v       : Number.isInteger(safe._v) ? safe._v : 0,
    };
  };

  const _normalisePO = (raw, { isUpdate = false, currentStatus = null, migrate = false } = {}) => {
    if (!raw || typeof raw !== 'object') throw new ValidationError('normalisePO: payload must be an object', { operation: 'normalisePO' });
    const safe = _safeObj(raw);
    const id           = (safe.id   || '').trim();
    const date         = _validateDate((safe.date || _erpToday()).trim(), { allowFuture: migrate }) || (migrate ? _erpToday() : '');
    const supplierName = (safe.supplierName || safe.sup || '').trim();
    const supplierId   = (safe.supplierId   || supplierName).toLowerCase().trim();
    if (!id)         throw new ValidationError('normalisePO: id is required', { operation: 'normalisePO', documentId: id });
    if (!date)       throw new ValidationError('normalisePO: date is invalid', { operation: 'normalisePO', documentId: id });
    if (!supplierId) throw new ValidationError('normalisePO: supplierId is required', { operation: 'normalisePO', documentId: id });

    const rawItems = Array.isArray(safe.items) ? safe.items : [];
    if (rawItems.length > MAX_ITEMS_PER_RECORD)
      throw new ValidationError(`normalisePO: too many items (max ${MAX_ITEMS_PER_RECORD})`, { operation: 'normalisePO', documentId: id });
    const items = rawItems.filter(i => i && (i.name || i.n)).map(i => {
      const qty = _numNonNeg(i.qty ?? i.q ?? 0, 0);
      if (qty <= 0) throw new ValidationError('normalisePO: item qty must be > 0', { operation: 'normalisePO', documentId: id });
      return {
        itemId : (i.itemId || i.bc || '').trim(),
        name   : (i.name   || i.n  || '').trim(),
        qty, rate: _round2(_num(i.rate || i.p, 0)),
        unit   : (i.unit || 'NONE').trim(),
      };
    });

    const rawTotal = safe.total !== undefined ? _num(safe.total, -1) : (safe.amt !== undefined ? _num(safe.amt, -1) : -1);
    const computedTotal = _round2(items.reduce((s, i) => s + i.qty * i.rate, 0));
    const total = rawTotal >= 0 ? _round2(rawTotal) : computedTotal;

    if (Math.abs(total - computedTotal) > 0.01 && rawTotal >= 0) {
      console.warn(`[PurchaseState] PO total mismatch: input=${total}, computed=${computedTotal} for ${id}`);
    }

    const rawStatus = (safe.status || 'pending').toLowerCase();
    const status = PO_VALID_TRANSITIONS[rawStatus] ? rawStatus : 'pending';

    if (isUpdate && currentStatus && currentStatus !== status) {
      const allowed = PO_VALID_TRANSITIONS[currentStatus];
      if (allowed && !allowed.has(status))
        throw new ValidationError(`normalisePO: invalid status transition "${currentStatus}" → "${status}"`, { operation: 'normalisePO', documentId: id });
    }

    const expectedDate = _validateDate((safe.expectedDate || safe.expected || '').trim(), { allowFuture: true });
    return {
      id, date, expectedDate: expectedDate || '',
      supplierId, supplierName, items, total, status,
      received   : safe.received === true,
      receivedAt : (safe.receivedAt || '').trim(),
      notes      : (safe.notes || '').trim(),
    };
  };

  const _getCallerUser = () => {
    try {
      if (typeof ERP !== 'undefined' && ERP.Auth && typeof ERP.Auth.currentUser === 'function')
        return ERP.Auth.currentUser().name || 'System';
      return (window.ERP && window.ERP.getState && window.ERP.getState().session.user && window.ERP.getState().session.user.username) || (global.window && global.window.currentUser && global.window.currentUser.name) || 'System';
    } catch (_) { return 'System'; }
  };

  const _normaliseReturn = (raw, { migrate = false } = {}) => {
    if (!raw || typeof raw !== 'object') throw new ValidationError('normaliseReturn: payload must be an object', { operation: 'normaliseReturn' });
    const safe = _safeObj(raw);
    const id           = (safe.id   || '').trim();
    const date         = _validateDate((safe.date || _erpToday()).trim(), { allowFuture: migrate }) || (migrate ? _erpToday() : '');
    const supplierName = (safe.supplierName || safe.sup || '').trim();
    const supplierId   = (safe.supplierId   || supplierName).toLowerCase().trim();
    if (!id)         throw new ValidationError('normaliseReturn: id is required', { operation: 'normaliseReturn', documentId: id });
    if (!date)       throw new ValidationError('normaliseReturn: date is invalid', { operation: 'normaliseReturn', documentId: id });
    if (!supplierId) throw new ValidationError('normaliseReturn: supplierId is required', { operation: 'normaliseReturn', documentId: id });
    const purchaseId = (safe.originalPO || safe.purchaseId || '').trim();
    const isFreeReturn = (safe.returnType || '').trim() === 'free';
    if (!migrate && !purchaseId && !isFreeReturn) throw new ValidationError('normaliseReturn: purchaseId is required', { operation: 'normaliseReturn', documentId: id });
    if (!migrate && purchaseId && !_idx.purchaseById[purchaseId])
      throw new ValidationError('normaliseReturn: purchaseId "' + purchaseId + '" not found', { operation: 'normaliseReturn', documentId: id });

    const rawItems = Array.isArray(safe.items) ? safe.items
      : (safe.items && typeof safe.items === 'object') ? [safe.items] : null;
    let items;
    if (rawItems) {
      if (rawItems.length > MAX_ITEMS_PER_RECORD)
        throw new ValidationError(`normaliseReturn: too many items (max ${MAX_ITEMS_PER_RECORD})`, { operation: 'normaliseReturn', documentId: id });
      items = rawItems.map(i => {
        const qty = _numNonNeg(i.qty ?? 0, 0);
        if (qty <= 0) throw new ValidationError('normaliseReturn: item qty must be > 0', { operation: 'normaliseReturn', documentId: id });
        const rate = _num(i.rate || i.price, 0);
        const amount = _round2(_num(i.amount || i.amt, qty * rate));
        const bc = (i.bc || i.barcode || '').trim();
        const out = { itemId:(i.itemId||'').trim(), name:(i.name||i.item||'').trim(), qty, rate:_round2(rate), amount, bc };
        if (Number.isFinite(i.unitCostPaisa) && i.unitCostPaisa >= 0) out.unitCostPaisa = Math.round(i.unitCostPaisa);
        return out;
      });
    } else if (safe.item) {
      const qty = _numNonNeg(safe.qty ?? 0, 0);
      if (qty <= 0) throw new ValidationError('normaliseReturn: item qty must be > 0', { operation: 'normaliseReturn', documentId: id });
      const rate = _num(safe.rate || safe.price, 0);
      const amount = _round2(_num(safe.amount || safe.amt, qty * rate));
      items = [{ itemId:'', name:(safe.item||'').trim(), qty, rate:_round2(rate), amount }];
    } else { items = []; }

    const computedTotal = items.length ? _round2(items.reduce((s,i) => s+i.amount,0)) : 0;
    const rawTotal = safe.total !== undefined ? _num(safe.total, -1) : (safe.amount !== undefined ? _num(safe.amount, -1) : (safe.amt !== undefined ? _num(safe.amt, -1) : -1));
    const total = rawTotal >= 0 ? _round2(rawTotal) : computedTotal;

    if (Math.abs(total - computedTotal) > 0.01 && rawTotal >= 0) {
      console.warn(`[PurchaseState] return total mismatch: input=${total}, computed=${computedTotal} for ${id}`);
    }

    return { id, date, supplierId, supplierName, purchaseId, returnType:(safe.returnType||'po').trim(), items, total, reason:(safe.reason||'').trim(), notes:(safe.notes||'').trim(), createdBy:(safe.createdBy||_getCallerUser()).trim(), _deleted: safe._deleted === true };
  };

  const _normalisePayment = (raw, { migrate = false } = {}) => {
    if (!raw || typeof raw !== 'object') throw new ValidationError('normalisePayment: payload must be an object', { operation: 'normalisePayment' });
    const safe = _safeObj(raw);
    const id           = (safe.id   || '').trim();
    const date         = _validateDate((safe.date || _erpToday()).trim(), { allowFuture: migrate }) || (migrate ? _erpToday() : '');
    const supplierName = (safe.supplierName || safe.party || '').trim();
    const supplierId   = (safe.supplierId   || supplierName).toLowerCase().trim();
    if (!id)         throw new ValidationError('normalisePayment: id is required', { operation: 'normalisePayment', documentId: id });
    if (!date)       throw new ValidationError('normalisePayment: date is invalid', { operation: 'normalisePayment', documentId: id });
    if (!supplierId) throw new ValidationError('normalisePayment: supplierId is required', { operation: 'normalisePayment', documentId: id });

    const rawAmt = parseFloat(safe.amount);
    if (!Number.isFinite(rawAmt) || rawAmt <= 0 || rawAmt > MAX_AMOUNT)
      throw new ValidationError(`normalisePayment: amount must be a finite positive number ≤ ${MAX_AMOUNT}`, { operation: 'normalisePayment', documentId: id });
    const amount = _round2(rawAmt);

    const mMap = { cash:'cash', bank:'bank', 'bank transfer':'bank', cheque:'cheque', check:'cheque', upi:'upi', online:'upi' };
    const method = mMap[(safe.method || safe.mode || 'cash').toLowerCase().trim()] || 'cash';

    const reference     = (safe.reference     || safe.against || '').trim();
    const referenceType = (safe.referenceType || (reference.startsWith('PUR') ? 'purchase' : reference.startsWith('PO') ? 'po' : '')).trim();

    if (!migrate && reference && reference.startsWith(PREFIX_PUR) && id !== 'VALIDATE-000000') {
      const refPurchase = _idx.purchaseById[reference];
      if (!refPurchase)
        throw new ValidationError(`normalisePayment: reference "${reference}" does not exist in purchases`, { operation: 'normalisePayment', documentId: id });
      const refSupplierId = (refPurchase.supplierId || refPurchase.supplierName || '').toLowerCase().trim();
      if (refSupplierId && refSupplierId !== supplierId)
        throw new ValidationError(`normalisePayment: reference "${reference}" belongs to a different supplier`, { operation: 'normalisePayment', documentId: id });
    }

    if (!migrate && reference && reference.startsWith(PREFIX_PO) && id !== 'VALIDATE-000000') {
      const refPO = _idx.poById[reference];
      if (!refPO)
        throw new ValidationError(`normalisePayment: reference "${reference}" does not exist in purchase orders`, { operation: 'normalisePayment', documentId: id });
      const refPOSupplierId = (refPO.supplierId || refPO.supplierName || '').toLowerCase().trim();
      if (refPOSupplierId && refPOSupplierId !== supplierId)
        throw new ValidationError(`normalisePayment: reference "${reference}" belongs to a different supplier`, { operation: 'normalisePayment', documentId: id });
    }

    return {
      id, date, supplierId, supplierName, amount, method,
      reference, referenceType,
      voided   : safe.voided === true,
      voidedAt : (safe.voidedAt || '').trim(),
      notes    : (safe.notes || '').trim(),
    };
  };

  const _recalcMeta = () => {
    _meta.purchaseSeq = _scanMax(_purchases);
    _meta.poSeq       = _scanMax(_purchaseOrders);
    _meta.returnSeq   = _scanMax(_purchaseReturns);
    _meta.paymentSeq  = _scanMax(_paymentOuts);
  };

  let _saving = false;
  let _saveQueued = false;
  let _pendingExternalReload = false;
  let _ledgerSaveDeferred = false;

  const _save = () => {
    if (_saving) {
      _saveQueued = true;
      return { ok:true, deferred:true,
        error:'save: deferred — another save was already in progress; latest state will be flushed automatically' };
    }

    if (!_localStorageAvailable() &&
        !(typeof ERP !== 'undefined' && ERP && ERP.StorageAdapter &&
          typeof ERP.StorageAdapter.set === 'function')) {
      console.error('[PurchaseState._save] Storage unavailable — data cannot be persisted');
      return { ok:false, error:'save: storage unavailable — data will be lost on reload', storageUnavailable:true };
    }

    _saving = true;

    const txId = _genId();
    const wal  = _walBegin(txId, ['staging','promote_chk','promote_store','promote_meta','promote_stamp','cleanup']);
    let stagingWritten = false;

    try {
      let storedStamp = 0;
      try { storedStamp = parseInt(_saRead(STAMP_KEY) || '0', 10) || 0; } catch (_) {}
      if (storedStamp > _writeStamp) {
        _walAbort(wal);
        try {
          var _bc = new BroadcastChannel('erp_purchase_state');
          _bc.postMessage({ type: 'STAMP_MISMATCH', tabStamp: _writeStamp, storedStamp: storedStamp });
          _bc.close();
        } catch (_) {}
        console.error('[PurchaseState._save] STAMP MISMATCH — another tab wrote newer data. ' +
          'Save ABORTED to prevent data loss. This tab must reload to sync latest state.');
        return { ok: false, error: 'STAMP_MISMATCH', needsReload: true,
          message: 'Another tab has updated purchase data. Please reload this tab before saving.' };
      }

      _writeStamp = Date.now();
      const payload = {
        storageVersion : STORE_VER,
        savedAt        : _writeStamp,
        data           : { purchases:_purchases, purchaseOrders:_purchaseOrders, purchaseReturns:_purchaseReturns, paymentOuts:_paymentOuts },
      };
      const safeReplacer = (key, val) => {
        if (typeof val === 'function') return undefined;
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) return _safeObj(val);
        return val;
      };
      const serialised = JSON.stringify(payload, safeReplacer);
      const sizeBytes  = new Blob([serialised]).size;
      if (sizeBytes > 4.5 * 1024 * 1024)
        return { ok:false, error:`save: data size ${(sizeBytes/1024/1024).toFixed(2)}MB exceeds quota`, quota:true };

      const checksum = _checksum(serialised);
      const STAGING_KEY = STORE_KEY + '_staging';
      const stagingPayload = JSON.stringify({ serialised, checksum, meta: JSON.stringify(_meta), stamp: String(_writeStamp) });

      _saWrite(STAGING_KEY, stagingPayload);
      stagingWritten = true;
      _walStep(wal, 'staging');

      _saWrite(STORE_KEY + '_chk', checksum);
      _walStep(wal, 'promote_chk');

      _saWrite(STORE_KEY, serialised);
      _walStep(wal, 'promote_store');

      _saWrite(META_KEY, JSON.stringify(_meta));
      _walStep(wal, 'promote_meta');

      _saWrite(STAMP_KEY, String(_writeStamp));
      _walStep(wal, 'promote_stamp');

      try { _saRemove(STAGING_KEY); } catch (_) {}
      _walStep(wal, 'cleanup');

      try { _saWrite(LEGACY_PAY_KEY, JSON.stringify(_paymentOuts));     } catch (_) {}
      try { _saWrite(LEGACY_POR_KEY, JSON.stringify(_purchaseOrders));  } catch (_) {}
      try { _saWrite(LEGACY_RET_KEY, JSON.stringify(_purchaseReturns)); } catch (_) {}

      _walCommit(wal);

      if (typeof _syncToDBCb === 'function') { try { _syncToDBCb(); } catch (_) {} }
      return { ok:true };
    } catch (e) {
      _walAbort(wal);
      if (stagingWritten) {
        try { _saRemove(STORE_KEY + '_staging'); } catch (_) {}
      }
      if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')
        return { ok:false, error:'save: localStorage quota exceeded', quota:true };
      return { ok:false, error:`save: ${e.message}` };
    } finally {
      _saving = false;
      if (_saveQueued) {
        _saveQueued = false;
        if (typeof queueMicrotask === 'function') queueMicrotask(_save);
        else setTimeout(_save, 0);
      } else if (_pendingExternalReload) {
        _pendingExternalReload = false;
        if (typeof queueMicrotask === 'function') queueMicrotask(_load);
        else setTimeout(_load, 0);
      }
    }
  };

  const _backupBeforeMigration = (raw) => {
    try {
      const stamp = Date.now();
      _saWrite(`${STORE_KEY}_backup_${stamp}`, raw);
      try {

        const backupKeys = [];
        const erp = typeof ERP !== 'undefined' ? ERP : null;
        const useAdapter = erp && erp.StorageAdapter && typeof erp.StorageAdapter.get === 'function';
        if (!useAdapter && typeof localStorage !== 'undefined') {
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && k.indexOf(STORE_KEY + '_backup_') === 0) backupKeys.push(k);
          }
        } else {

          const oldKey = `${STORE_KEY}_backup_${stamp - 4 * 86400000}`;
          try { _saRemove(oldKey); } catch (_) {}
        }
        if (backupKeys.length > 3) {
          backupKeys.sort();
          backupKeys.slice(0, backupKeys.length - 3).forEach(dk => { try { _saRemove(dk); } catch(_) {} });
        }
      } catch (_) {}
    } catch (_) {}
  };

  const _migrateV1ToV2 = (data) => ({
    ...data,
    purchases       : (data.purchases || []).map(p => ({ _deleted:false, ...p })),
    purchaseReturns : (data.purchaseReturns || []).map(r => ({ createdBy:'migrated', ...r })),
  });

  const _migrateLegacy = () => {
    const acc = { purchases:[], purchaseOrders:[], purchaseReturns:[], paymentOuts:[] };
    const errors = [];
    const _tryParse = (key) => { try { return JSON.parse(_saRead(key) || 'null'); } catch (e) { errors.push(`parse ${key}: ${e.message}`); return null; } };

    const snap = _tryParse(_legacyErpKey());
    if (snap) {
      for (const r of (snap.purchases       || [])) { try { acc.purchases.push(_normalisePurchase(r, { migrate: true }));  } catch (e) { errors.push(`purchase: ${e.message}`); _quarantine('purchase', r, e.message); } }
      for (const r of (snap.purchaseReturns || [])) { try { acc.purchaseReturns.push(_normaliseReturn(r, { migrate: true })); } catch (e) { errors.push(`return: ${e.message}`); _quarantine('purchaseReturn', r, e.message); } }
    }
    const pos  = _tryParse(LEGACY_POR_KEY);
    if (Array.isArray(pos))  for (const r of pos)  { try { acc.purchaseOrders.push(_normalisePO(r, { migrate: true })); } catch (e) { errors.push(`po: ${e.message}`); _quarantine('purchaseOrder', r, e.message); } }
    const rets = _tryParse(LEGACY_RET_KEY);
    if (Array.isArray(rets)) for (const r of rets) { try { acc.purchaseReturns.push(_normaliseReturn(r, { migrate: true })); } catch (e) { errors.push(`return: ${e.message}`); _quarantine('purchaseReturn', r, e.message); } }
    _purchases = acc.purchases;
    _purchaseOrders = acc.purchaseOrders;
    _rebuildIndexes();
    const pays = _tryParse(LEGACY_PAY_KEY);
    if (Array.isArray(pays)) for (const r of pays) { try { acc.paymentOuts.push(_normalisePayment(r, { migrate: true })); } catch (e) { errors.push(`payment: ${e.message}`); _quarantine('paymentOut', r, e.message); } }

    if (errors.length) console.warn('[PurchaseState] _migrateLegacy: some records skipped —', errors);
    const data = { purchases:_dedup(acc.purchases), purchaseOrders:_dedup(acc.purchaseOrders), purchaseReturns:_dedup(acc.purchaseReturns), paymentOuts:_dedup(acc.paymentOuts) };
    return { data, recordCount: data.purchases.length + data.purchaseOrders.length + data.purchaseReturns.length + data.paymentOuts.length, errors };
  };

  const _walRecoverStale = () => {
    try {
      const raw = _saRead(WAL_KEY);
      if (!raw) return;
      const wal = JSON.parse(raw);
      if (!wal || wal.status !== 'in_progress') { _saRemove(WAL_KEY); return; }
      console.warn('[PurchaseState] WAL: detected an interrupted save from a previous session (txId=' + wal.txId +
        ', completed=' + (wal.completedSteps || []).join(',') + '). Storage will be re-validated via checksum.');
      _auditWrite('wal_interrupted_save_detected', { txId: wal.txId, completedSteps: wal.completedSteps });
      _saRemove(WAL_KEY);
    } catch (_) { try { _saRemove(WAL_KEY); } catch (__) {} }
  };

  const _load = () => {
    try {
      _walRecoverStale();
      _loadLedger();
      _loadAllocations();
      // ARCHITECTURAL REFACTOR: recovery-only IndexedDB check. localStorage
      // remains the fast, synchronous, primary source loaded above — this
      // only kicks in if localStorage came back empty (e.g. it was cleared
      // or this is a fresh browser profile), and only ever fills in data,
      // never overwrites whatever localStorage already had.
      try {
        if (window.ERP && ERP.Persistence && typeof ERP.Persistence.loadObject === 'function') {
          if (!_supplierLedger || Object.keys(_supplierLedger).length === 0) {
            ERP.Persistence.loadObject('supplierLedger').then(function (obj) {
              if (obj && typeof obj === 'object' && Object.keys(obj).length &&
                  (!_supplierLedger || Object.keys(_supplierLedger).length === 0)) {
                _supplierLedger = obj;
                console.warn('[PurchaseState] supplier ledger recovered from IndexedDB backup (localStorage was empty)');
              }
            }).catch(function () {});
          }
          if (!_paymentAllocationsOut || Object.keys(_paymentAllocationsOut).length === 0) {
            ERP.Persistence.loadObject('supplierPaymentAllocationsOut').then(function (obj) {
              if (obj && typeof obj === 'object' && Object.keys(obj).length &&
                  (!_paymentAllocationsOut || Object.keys(_paymentAllocationsOut).length === 0)) {
                _paymentAllocationsOut = obj;
                console.warn('[PurchaseState] supplier payment allocations recovered from IndexedDB backup (localStorage was empty)');
              }
            }).catch(function () {});
          }
        }
      } catch (e) {}

      const raw = _saRead(STORE_KEY);
      if (raw) {
        const storedChecksum = _saRead(STORE_KEY + '_chk');
        if (storedChecksum && _checksum(raw) !== storedChecksum) {
          console.error('[PurchaseState] load: checksum mismatch — data may be corrupted, attempting recovery from staging');
          try {
            const stagingRaw = _saRead(STORE_KEY + '_staging');
            if (stagingRaw) {
              const staged = JSON.parse(stagingRaw);
              if (staged && staged.serialised && _checksum(staged.serialised) === staged.checksum) {
                console.log('[PurchaseState] load: recovered from staging');
                _saWrite(STORE_KEY, staged.serialised);
                _saWrite(STORE_KEY + '_chk', staged.checksum);
                if (staged.meta) _saWrite(META_KEY, staged.meta);
                if (staged.stamp) _saWrite(STAMP_KEY, staged.stamp);
                return _load();
              }
            }
          } catch (e) {
            console.error('[PurchaseState] load: staging recovery failed:', e.message);
          }
        }

        const payload = JSON.parse(raw);
        if (payload.storageVersion === STORE_VER && payload.data) {
          try { const stamp = parseInt(_saRead(STAMP_KEY)||'0',10); if(stamp>_writeStamp) _writeStamp=stamp; } catch (_) {}
          const d = payload.data;
          const tmp = { purchases:[], purchaseOrders:[], purchaseReturns:[], paymentOuts:[] };
          const errs = [];
          for (const r of (d.purchases       || [])) { try { tmp.purchases.push(_normalisePurchase(r));     } catch (e) { errs.push(e.message); _quarantine('purchase', r, e.message); } }
          for (const r of (d.purchaseOrders  || [])) { try { tmp.purchaseOrders.push(_normalisePO(r));      } catch (e) { errs.push(e.message); _quarantine('purchaseOrder', r, e.message); } }
          for (const r of (d.purchaseReturns || [])) { try { tmp.purchaseReturns.push(_normaliseReturn(r)); } catch (e) { errs.push(e.message); _quarantine('purchaseReturn', r, e.message); } }
          for (const r of (d.paymentOuts     || [])) { try { tmp.paymentOuts.push(_normalisePayment(r));   } catch (e) { errs.push(e.message); _quarantine('paymentOut', r, e.message); } }
          _purchases=tmp.purchases; _purchaseOrders=tmp.purchaseOrders; _purchaseReturns=tmp.purchaseReturns; _paymentOuts=tmp.paymentOuts;
          try { const rawMeta=JSON.parse(_saRead(META_KEY)||'{}'); Object.assign(_meta,_validateMeta({..._meta,...rawMeta})); } catch (_) {}
          _recalcMeta(); _rebuildIndexes();
          if (errs.length) console.warn('[PurchaseState] load: some records skipped —', errs);
          return { ok:true, warnings: errs.length ? errs : undefined };
        }

        if (payload.storageVersion === 1 && payload.data) {
          _backupBeforeMigration(raw);
          const md = _migrateV1ToV2(payload.data);
          const tmp = { purchases:[], purchaseOrders:[], purchaseReturns:[], paymentOuts:[] };
          const v1errs = [];
          for (const r of (md.purchases       || [])) { try { tmp.purchases.push(_normalisePurchase(r));     } catch (e) { v1errs.push(`purchase: ${e.message}`); _quarantine('purchase', r, e.message); } }
          for (const r of (md.purchaseOrders  || [])) { try { tmp.purchaseOrders.push(_normalisePO(r));      } catch (e) { v1errs.push(`po: ${e.message}`); _quarantine('purchaseOrder', r, e.message); } }
          for (const r of (md.purchaseReturns || [])) { try { tmp.purchaseReturns.push(_normaliseReturn(r)); } catch (e) { v1errs.push(`return: ${e.message}`); _quarantine('purchaseReturn', r, e.message); } }
          for (const r of (md.paymentOuts     || [])) { try { tmp.paymentOuts.push(_normalisePayment(r));    } catch (e) { v1errs.push(`payment: ${e.message}`); _quarantine('paymentOut', r, e.message); } }
          _purchases=tmp.purchases; _purchaseOrders=tmp.purchaseOrders; _purchaseReturns=tmp.purchaseReturns; _paymentOuts=tmp.paymentOuts;
          _recalcMeta(); _rebuildIndexes(); _save();
          if (v1errs.length) console.warn('[PurchaseState] load v1->v2 migration: some records skipped —', v1errs);
          return { ok:true, migrated:true, warnings: v1errs.length ? v1errs : undefined };
        }

        if (raw) _backupBeforeMigration(raw);
      }

      const { data, recordCount, errors } = _migrateLegacy();
      _purchases=data.purchases; _purchaseOrders=data.purchaseOrders; _purchaseReturns=data.purchaseReturns; _paymentOuts=data.paymentOuts;
      _recalcMeta(); _rebuildIndexes();
      if (recordCount > 0) _save();
      return { ok:true, migrated:recordCount>0, recordCount, warnings:errors.length?errors:undefined };
    } catch (e) {
      console.error('[PurchaseState] load critical error:', e.message);
      return { ok:false, error:`load: ${e.message}` };
    }
  };

  if (typeof global.addEventListener === 'function') {
    global.addEventListener('storage', (e) => {
      if (e.key === STORE_KEY && e.newValue && e.newValue !== e.oldValue) {
        const newStamp = parseInt(e.newValue ? JSON.parse(e.newValue).savedAt || 0 : 0, 10);
        if (newStamp > _writeStamp) {
          if (_saving) {
            console.warn('[PurchaseState] Multi-tab: external update detected but save in progress — reload deferred');
            _pendingExternalReload = true;
            return;
          }
          _load();
          if (typeof _onExternalUpdateCb === 'function') { try { _onExternalUpdateCb(); } catch (_) {} }
        }
      }
    });
  }

  const getAllPurchases  = () => _cloneAll(_purchases.filter(p => !p._deleted));
  const getPurchaseById = (id) => { const r = _idx.purchaseById[id]; return (r && !r._deleted) ? _clone(r) : null; };

  const _safePreview = (prefix, seq, arr) => _fmtId(prefix, Math.max(seq, _scanMax(arr)) + 1);

  const addPurchase = (payload) => {
    try {
      const preview = _safePreview(PREFIX_PUR, _meta.purchaseSeq, _purchases);
      const rec = _normalisePurchase({ ..._safeObj(payload), id: preview, _v: 0 });
      const prevSeq = _meta.purchaseSeq;
      _meta.purchaseSeq = _numericSuffix(rec.id);
      _purchases.unshift(rec);
      _idx.purchaseById[rec.id] = rec;
      const sr = _save();
      if (!sr.ok) { _purchases.shift(); delete _idx.purchaseById[rec.id]; _meta.purchaseSeq = prevSeq; return { ok:false, error:'addPurchase: '+sr.error }; }
      _auditWrite('purchase_added', { documentId: rec.id, supplierId: rec.supplierId, total: rec.total });
      return { ok:true, id:rec.id, record:rec };
    } catch (e) { return { ok:false, error:e.message }; }
  };

  const updatePurchase = (id, patch) => {
    try {
      const i = _purchases.findIndex(r => r.id === id && !r._deleted);
      if (i === -1) throw new NotFoundError(`updatePurchase: '${id}' not found`, { operation: 'updatePurchase', documentId: id });
      const existing = _purchases[i];
      const backup   = _deepClone(existing);
      if (Number.isInteger(patch._v) && patch._v !== existing._v)
        throw new ConflictError(`updatePurchase: concurrency conflict on '${id}' — expected _v=${existing._v}, got _v=${patch._v}`, { operation: 'updatePurchase', documentId: id });
      const merged   = _normalisePurchase({ ..._deepClone(existing), ..._safeObj(patch), id, _v: (existing._v || 0) + 1 }, { isUpdate:true, currentStatus:existing.status });
      _purchases[i] = merged; _idx.purchaseById[id] = merged;
      const sr = _save();
      if (!sr.ok) { _purchases[i]=backup; _idx.purchaseById[id]=backup; return { ok:false, error:'updatePurchase: '+sr.error }; }
      _auditWrite('purchase_updated', { documentId: id, patch });
      return { ok:true };
    } catch (e) { return { ok:false, error:e.message }; }
  };

  const removePurchase = (id, { force=false, hardDelete=false } = {}) => {
    const target = _idx.purchaseById[id];
    if (!target || target._deleted) return { ok:false, error:`removePurchase: '${id}' not found` };
    const linkedR = _purchaseReturns.filter(r => r.purchaseId === id && !r._deleted);
    const linkedP = _paymentOuts.filter(p => p.reference === id && !p.voided);
    const linkedAllocs = Object.values(_paymentAllocationsOut).flat().filter(a => a.purchaseId === id);
    if (!force && (linkedR.length || linkedP.length || linkedAllocs.length))
      return { ok:false, error:`removePurchase: '${id}' has ${linkedR.length} return(s), ${linkedP.length} payment(s), and ${linkedAllocs.length} allocation(s). Pass { force:true } to delete anyway.`, linkedReturns:linkedR.map(r=>r.id), linkedPayments:linkedP.map(p=>p.id), linkedAllocations: linkedAllocs.map(a => a.paymentId) };
    if (hardDelete) {
      for (const alloc of linkedAllocs) {
        try { reverseAllocations(alloc.paymentId); } catch (e) { console.error('[PurchaseState] removePurchase: reverseAllocations failed:', e.message); }
      }
      _purchases=_purchases.filter(r=>r.id!==id); delete _idx.purchaseById[id];
      const supplierId = (target.supplierId || target.supplierName || '').toLowerCase().trim();
      if (supplierId && _supplierLedger[supplierId]) {
        _supplierLedger[supplierId] = _supplierLedger[supplierId].filter(
          e => !(e.referenceId === id && e.type === 'PURCHASE_BILL')
        );
        _saveLedger();
        recalculate(supplierId);
      }
    }
    else { const idx=_purchases.findIndex(r=>r.id===id); if(idx!==-1){ _purchases[idx]={..._purchases[idx],_deleted:true,_deletedAt:_erpNow()}; _idx.purchaseById[id]=_purchases[idx]; } }
    _save();
    _auditWrite('purchase_removed', { documentId: id, hardDelete });
    return { ok:true, softDeleted:!hardDelete };
  };

  const restorePurchase = (id) => {
    const idx = _purchases.findIndex(r => r.id===id && r._deleted);
    if (idx===-1) return { ok:false, error:`restorePurchase: '${id}' not found` };
    const rec = _purchases[idx];
    const billNoToCheck = (rec.billNo || '').trim();
    if (billNoToCheck && billNoToCheck !== id) {
      const supplierId = (rec.supplierId || '').toLowerCase().trim();
      const dup = _purchases.find(p =>
        p.id !== id &&
        !p._deleted &&
        (p.supplierId || '').toLowerCase().trim() === supplierId &&
        (p.billNo || '').trim() === billNoToCheck
      );
      if (dup) return { ok:false, error:`restorePurchase: bill number "${billNoToCheck}" already exists (${dup.id})` };
    }
    _purchases[idx]={ ..._purchases[idx], _deleted:false, _deletedAt:undefined };
    _idx.purchaseById[id]=_purchases[idx]; _save();
    _auditWrite('purchase_restored', { documentId: id });
    return { ok:true };
  };

  const setPurchases = (arr) => {
    const list = Array.isArray(arr) ? arr : [];
    const normalised = [];
    const seenIds = new Set();
    const duplicateIds = [];
    for (const r of list) {
      let rec;
      try { rec = _normalisePurchase(_safeObj(r)); } catch (_) { continue; }
      if (seenIds.has(rec.id)) { duplicateIds.push(rec.id); continue; }
      seenIds.add(rec.id);
      normalised.push(rec);
    }
    _purchases = normalised;
    _meta.purchaseSeq = _scanMax(_purchases);
    _rebuildIndexes();
    if (duplicateIds.length) {
      console.warn(`[PurchaseState] setPurchases: ${duplicateIds.length} duplicate id(s) dropped —`, duplicateIds.slice(0, 50));
      _auditWrite('purchases_bulk_set_duplicates_dropped', { duplicateCount: duplicateIds.length, duplicateIds: duplicateIds.slice(0, 50) });
    }
    return { ok: true, count: _purchases.length, duplicatesDropped: duplicateIds.length, duplicateIds };
  };
  const addPurchases = (payloads) => (payloads || []).map(addPurchase);

  const getAllPurchaseOrders = () => _cloneAll(_purchaseOrders);
  const getPOById            = (id) => { const r=_idx.poById[id]; return r?_clone(r):null; };

  const addPO = (payload) => {
    try {
      const preview = _safePreview(PREFIX_PO, _meta.poSeq, _purchaseOrders);
      const rec = _normalisePO({ ..._safeObj(payload), id: preview });
      const prevSeq = _meta.poSeq;
      _meta.poSeq = _numericSuffix(rec.id);
      _purchaseOrders.unshift(rec); _idx.poById[rec.id] = rec;
      const sr = _save();
      if (!sr.ok) { _purchaseOrders.shift(); delete _idx.poById[rec.id]; _meta.poSeq = prevSeq; return { ok:false, error:'addPO: '+sr.error }; }
      _auditWrite('po_added', { documentId: rec.id, supplierId: rec.supplierId });
      return { ok:true, id:rec.id, record:rec };
    } catch (e) { return { ok:false, error:e.message }; }
  };

  const updatePO = (id, patch) => {
    try {
      const i = _purchaseOrders.findIndex(r => r.id===id);
      if (i===-1) throw new NotFoundError(`updatePO: '${id}' not found`, { operation: 'updatePO', documentId: id });
      const existing=_purchaseOrders[i]; const backup=_deepClone(existing);
      const merged=_normalisePO({..._deepClone(existing),..._safeObj(patch),id}, { isUpdate: true, currentStatus: existing.status });
      _purchaseOrders[i]=merged; _idx.poById[id]=merged;
      const sr=_save();
      if (!sr.ok) { _purchaseOrders[i]=backup; _idx.poById[id]=backup; return { ok:false, error:'updatePO: '+sr.error }; }
      _auditWrite('po_updated', { documentId: id });
      return { ok:true };
    } catch (e) { return { ok:false, error:e.message }; }
  };

  const removePO = (id) => {
    const po = _idx.poById[id];
    if (!po) return { ok:false, error:`removePO: '${id}' not found` };
    if (po.status==='received' || po.received || po.receivedAt) return { ok:false, error:`removePO: PO '${id}' already received` };
    if (po.status==='partial') return { ok:false, error:`removePO: PO '${id}' is partially received — cannot delete. Cancel it instead.` };
    _purchaseOrders=_purchaseOrders.filter(r=>r.id!==id); delete _idx.poById[id]; _save();
    _auditWrite('po_removed', { documentId: id });
    return { ok:true };
  };

  const setPurchaseOrders = (arr) => {
    _purchaseOrders=[];
    for (const r of (arr||[])) { try { _purchaseOrders.push(_normalisePO(_safeObj(r))); } catch (_) {} }
    _meta.poSeq=_scanMax(_purchaseOrders); _rebuildIndexes();
  };

  const getAllReturns = ({ includeDeleted = false } = {}) =>
    _cloneAll(includeDeleted ? _purchaseReturns : _purchaseReturns.filter(r => !r._deleted));
  const getReturnById         = (id) => { const r=_idx.returnById[id]; return r?_clone(r):null; };
  const getReturnsByPurchaseId = (purchaseId) => _cloneAll(_purchaseReturns.filter(r=>r.purchaseId===purchaseId && !r._deleted));

  const _getCumulativeReturnedQty = (purchaseId, itemName, itemId) =>
    _purchaseReturns.filter(r=>r.purchaseId===purchaseId && !r._deleted)
      .reduce((sum,r) => {
        const it = itemId
          ? (r.items||[]).find(i => (i.itemId||i.bc||'') === itemId)
          : (r.items||[]).find(i=>(i.name||'').toLowerCase()===(itemName||'').toLowerCase());
        return sum+(it?it.qty:0);
      }, 0);

  const _getCumulativeReturnedTotal = (purchaseId, excludeId) =>
    _purchaseReturns.filter(r=>r.purchaseId===purchaseId && !r._deleted && r.id !== excludeId)
      .reduce((s,r)=>s+_toPaisa(r.total||0),0);

  const _validateReturnAgainstPurchase = (rec, excludeId) => {
    if (!rec.purchaseId) return;
    const purchase = _idx.purchaseById[rec.purchaseId];
    if (!purchase) return;
    const existingReturnedPaisa = _getCumulativeReturnedTotal(rec.purchaseId, excludeId);
    const newReturnPaisa = _toPaisa(rec.total || 0);
    const purchaseTotalPaisa = purchase.totalPaisa || _toPaisa(purchase.total || 0);
    if (existingReturnedPaisa + newReturnPaisa > purchaseTotalPaisa) {
      throw new ValidationError(`addReturn: return total exceeds purchase total (${purchase.total})`, { operation: 'addReturn', documentId: rec.id });
    }
    if (rec.items && rec.items.length > 0 && purchase.items) {
      for (const retItem of rec.items) {
        const pi = purchase.items.find(pi =>
          (retItem.itemId && pi.itemId && pi.itemId === retItem.itemId) ||
          (pi.name || '').toLowerCase() === (retItem.name || '').toLowerCase()
        );
        if (pi) {
          const already = _getCumulativeReturnedQty(rec.purchaseId, retItem.name, retItem.itemId || pi.itemId);
          if (already + retItem.qty > pi.qty) {
            throw new ValidationError(`addReturn: cumulative return qty for "${retItem.name}" would exceed purchased qty`, { operation: 'addReturn', documentId: rec.id });
          }
        }
      }
    }
  };

  const addReturn = (payload) => {
    try {
      const safe=_safeObj(payload);
      const callerReturnId = (safe.id || '').trim();
      if (callerReturnId && _idx.returnById[callerReturnId])
        throw new ConflictError(`addReturn: id "${callerReturnId}" already exists`, { operation: 'addReturn', documentId: callerReturnId });
      const resolvedReturnId = callerReturnId || _safePreview(PREFIX_PR,_meta.returnSeq,_purchaseReturns);
      const rec=_normaliseReturn({...safe,id:resolvedReturnId});
      const prevSeq = _meta.returnSeq;
      _meta.returnSeq=_numericSuffix(rec.id);
      _validateReturnAgainstPurchase(rec, rec.id);
      _purchaseReturns.unshift(rec); _idx.returnById[rec.id]=rec;
      const sr=_save();
      if (!sr.ok) { _purchaseReturns.shift(); delete _idx.returnById[rec.id]; _meta.returnSeq = prevSeq; return { ok:false, error:'addReturn: '+sr.error }; }
      _auditWrite('return_added', { documentId: rec.id, purchaseId: rec.purchaseId, supplierId: rec.supplierId, total: rec.total });
      return { ok:true, id:rec.id, record:rec };
    } catch (e) { return { ok:false, error:e.message }; }
  };

  const updateReturn = (id, patch) => {
    try {
      const i=_purchaseReturns.findIndex(r=>r.id===id);
      if (i===-1) throw new NotFoundError(`updateReturn: '${id}' not found`, { operation: 'updateReturn', documentId: id });
      const backup=_deepClone(_purchaseReturns[i]);
      const merged=_normaliseReturn({..._deepClone(_purchaseReturns[i]),..._safeObj(patch),id});
      _validateReturnAgainstPurchase(merged, id);
      _purchaseReturns[i]=merged; _idx.returnById[id]=merged;
      const sr=_save();
      if (!sr.ok) { _purchaseReturns[i]=backup; _idx.returnById[id]=backup; return { ok:false, error:'updateReturn: '+sr.error }; }

      const oldTotalPaisa = Math.round((backup.total || 0) * 100);
      const newTotalPaisa = Math.round((merged.total || 0) * 100);
      if (oldTotalPaisa !== newTotalPaisa) {
        const sid = (merged.supplierId || merged.supplierName || '').toLowerCase().trim();
        if (sid) {
          try {

            if (oldTotalPaisa > 0) {
              writeLedgerEntry({ type:'ADJUSTMENT', supplierId:sid, debit:0, credit:oldTotalPaisa,
                date:_erpToday(), referenceId:id, note:'Return update: reverse old amount for '+id });
            }

            if (newTotalPaisa > 0) {
              writeLedgerEntry({ type:'PURCHASE_RETURN', supplierId:sid, debit:newTotalPaisa, credit:0,
                date:merged.date||_erpToday(), referenceId:id, note:'Return update: revised amount for '+id });
            }
          } catch (ledgErr) { console.error('[PurchaseState] updateReturn: ledger update failed:', ledgErr.message); }
        }
      }

      _auditWrite('return_updated', { documentId: id });
      return { ok:true };
    } catch (e) { return { ok:false, error:e.message }; }
  };

  const removeReturn = (id) => {
    const idx = _purchaseReturns.findIndex(r => r.id === id);
    if (idx === -1) return { ok:false, error:`removeReturn: '${id}' not found` };
    const rec = _purchaseReturns[idx];
    _purchaseReturns[idx] = { ...rec, _deleted: true, _deletedAt: _erpNow() };
    _idx.returnById[id] = _purchaseReturns[idx];
    _save();

    const totalPaisa = Math.round((rec.total || 0) * 100);
    const sid = (rec.supplierId || rec.supplierName || '').toLowerCase().trim();
    if (sid && totalPaisa > 0) {
      try {
        writeLedgerEntry({
          type: 'ADJUSTMENT', supplierId: sid,
          debit: 0, credit: totalPaisa,
          date: _erpToday(), referenceId: id,
          note: 'Return deleted: ledger reversal for ' + id,
        });
      } catch (e) { console.error('[PurchaseState] removeReturn: ledger reversal failed:', e.message); }
    }

    if (rec.purchaseId) {
      const purchase = _idx.purchaseById[rec.purchaseId];
      const curStatus = purchase && (purchase.status || purchase.st || '').toLowerCase();
      if (purchase && !purchase._deleted && curStatus === 'returned') {
        const stillReturned = getReturnsByPurchaseId(rec.purchaseId).length > 0;
        if (!stillReturned) {
          const totalP = purchase.totalPaisa || _toPaisa(purchase.total || 0);
          const paidP  = purchase.paidPaisa || 0;
          const remP   = Math.max(0, totalP - paidP);
          const restored = deriveStatus(remP, totalP) === 'PAID' ? 'complete'
            : deriveStatus(remP, totalP) === 'PARTIAL' ? 'partial' : 'draft';
          const ur = updatePurchase(rec.purchaseId, { status: restored });
          if (!ur.ok) console.error('[PurchaseState] removeReturn: status restore failed:', ur.error);
        }
      }
    }

    _auditWrite('return_removed', { documentId: id, softDeleted: true });
    return { ok:true, softDeleted: true };
  };

  const restoreReturn = (id) => {
    const idx = _purchaseReturns.findIndex(r => r.id === id && r._deleted);
    if (idx === -1) return { ok:false, error:`restoreReturn: '${id}' not found` };
    _purchaseReturns[idx] = { ..._purchaseReturns[idx], _deleted: false, _deletedAt: undefined };
    _idx.returnById[id] = _purchaseReturns[idx];
    _save();
    _auditWrite('return_restored', { documentId: id });
    return { ok:true };
  };

  const setPurchaseReturns = (arr) => {
    _purchaseReturns=[];
    for (const r of (arr||[])) { try { _purchaseReturns.push(_normaliseReturn(_safeObj(r))); } catch (_) {} }
    _meta.returnSeq=_scanMax(_purchaseReturns); _rebuildIndexes();
  };

  const getAllPayments  = () => _cloneAll(_paymentOuts);
  const getPaymentById = (id) => { const r=_idx.paymentById[id]; return r?_clone(r):null; };

  const addPayment = (payload) => {
    try {
      const safe=_safeObj(payload);
      const incomingAmount=_round2(_numNonNeg(safe.amount,0));
      const incomingDate=_validateDate((safe.date||_erpToday()).trim());
      const reference=(safe.reference||safe.against||'').trim();
      const incomingSupId = (safe.supplierId||safe.supplierName||'').toLowerCase().trim();
      const dup = _paymentOuts.find(p =>
        !p.voided &&
        (p.supplierId || '').toLowerCase() === incomingSupId &&
        p.amount === incomingAmount &&
        p.date === incomingDate &&
        (p.reference || '').trim() === reference
      );
      if (dup) throw new ConflictError(`addPayment: duplicate payment detected — existing id="${dup.id}"`, { operation: 'addPayment' });

      const callerSuppliedId = (safe.id || '').trim();
      if (callerSuppliedId && _idx.paymentById[callerSuppliedId])
        throw new ConflictError(`addPayment: id "${callerSuppliedId}" already exists — cannot reuse`, { operation: 'addPayment', documentId: callerSuppliedId });
      const resolvedId = callerSuppliedId || _safePreview(PREFIX_PAY,_meta.paymentSeq,_paymentOuts);
      const rec=_normalisePayment({...safe,id:resolvedId});
      const prevSeq = _meta.paymentSeq;
      _meta.paymentSeq=_numericSuffix(rec.id);
      _paymentOuts.unshift(rec); _idx.paymentById[rec.id]=rec;
      const sr=_save();
      if (!sr.ok) { _paymentOuts.shift(); delete _idx.paymentById[rec.id]; _meta.paymentSeq = prevSeq; return { ok:false, error:'addPayment: '+sr.error }; }

      const supId = (rec.supplierId || rec.supplierName || '').toLowerCase().trim();
      const paymentPaisa = _toPaisa(rec.amount || 0);
      if (!supId || paymentPaisa <= 0) {
        _paymentOuts.shift(); delete _idx.paymentById[rec.id]; _meta.paymentSeq = prevSeq; _save();
        return { ok:false, error:'addPayment: invalid supplierId or amount for ledger entry' };
      }

      const ledgerResult = writeLedgerEntry({
        supplierId  : supId,
        type        : 'PAYMENT_OUT',
        debit       : paymentPaisa,
        credit      : 0,
        referenceId : rec.id,
        date        : rec.date,
        note        : 'Payment out: ' + rec.id + (rec.reference ? ' against ' + rec.reference : '') + (rec.notes ? ' — ' + rec.notes : ''),
      });
      if (!ledgerResult.ok) {
        _paymentOuts.shift(); delete _idx.paymentById[rec.id]; _meta.paymentSeq = prevSeq; _save();
        return { ok:false, error:'addPayment: '+ledgerResult.error };
      }

      try {
        fifoAllocate(rec.id, supId, paymentPaisa, rec.referenceType === 'purchase' ? rec.reference : undefined);
      } catch (allocErr) {
        console.warn('[PurchaseState] addPayment: fifoAllocate failed (non-blocking):', allocErr.message);
      }

      _auditWrite('payment_added', { documentId: rec.id, supplierId: rec.supplierId, amount: rec.amount });
      try {
        var _erp2 = (typeof ERP !== 'undefined' ? ERP : null);
        if (_erp2) {
          if (_erp2.EventBus && typeof _erp2.EventBus.emit === 'function')
            _erp2.EventBus.emit('purchase:payment:saved', { payment: rec });
          if (_erp2.events && _erp2.events !== _erp2.EventBus && typeof _erp2.events.emit === 'function')
            _erp2.events.emit('purchase:payment:saved', { payment: rec });
        }
      } catch (_) {}
      return { ok:true, id:rec.id, record:rec };
    } catch (e) { return { ok:false, error:e.message }; }
  };

  const updatePayment = (id, patch) => {
    try {
      const i=_paymentOuts.findIndex(r=>r.id===id);
      if (i===-1) throw new NotFoundError(`updatePayment: '${id}' not found`, { operation: 'updatePayment', documentId: id });
      const backup=_deepClone(_paymentOuts[i]);
      const oldAmount = backup.amount;
      const merged=_normalisePayment({..._deepClone(_paymentOuts[i]),..._safeObj(patch),id});
      _paymentOuts[i]=merged; _idx.paymentById[id]=merged;
      const sr=_save();
      if (!sr.ok) { _paymentOuts[i]=backup; _idx.paymentById[id]=backup; return { ok:false, error:'updatePayment: '+sr.error }; }
      if (merged.amount !== oldAmount && _paymentAllocationsOut[id] && _paymentAllocationsOut[id].length > 0) {
        try { reverseAllocations(id); } catch (e) { console.error('[PurchaseState] updatePayment: reverseAllocations failed:', e.message); }
        try {
          const supId = merged.supplierId || merged.supplierName || '';
          const paymentPaisa = _toPaisa(merged.amount || 0);
          if (supId && paymentPaisa > 0) {
            fifoAllocate(id, supId, paymentPaisa);
          }
        } catch (allocErr) {
          console.error('[PurchaseState] updatePayment: fifoAllocate failed:', allocErr.message);
        }
      }
      _auditWrite('payment_updated', { documentId: id });
      return { ok:true };
    } catch (e) { return { ok:false, error:e.message }; }
  };

  const voidPayment = (id) => {
    try {
      const i = _paymentOuts.findIndex(r => r.id === id);
      if (i === -1) throw new NotFoundError(`voidPayment: '${id}' not found`, { operation: 'voidPayment', documentId: id });
      const backup = _deepClone(_paymentOuts[i]);
      if (backup.voided) return { ok:false, error:`voidPayment: '${id}' already voided` };

      try {
        reverseAllocations(id, { skipLedgerEntry: true });
      } catch (e) {
        return { ok:false, error:'voidPayment: reverseAllocations failed — '+e.message };
      }

      const merged = _normalisePayment({ ..._deepClone(_paymentOuts[i]), voided:true, voidedAt:_erpNow(), id });
      _paymentOuts[i] = merged; _idx.paymentById[id] = merged;
      const sr = _save();
      if (!sr.ok) { _paymentOuts[i] = backup; _idx.paymentById[id] = backup; return { ok:false, error:'voidPayment: '+sr.error }; }
      try {
        const fullPaisa = _toPaisa(backup.amount || 0);
        if (fullPaisa > 0) {
          writeLedgerEntry({
            type:       'PAYMENT_VOID',
            supplierId: backup.supplierId || backup.supplierName || '',
            debit:      0,
            credit:     fullPaisa,
            date:       _erpToday(),
            referenceId: id,
            note:       'Payment void reversal for ' + id,
          });
        }
      } catch (e) { console.error('[PurchaseState] voidPayment: ledger reversal failed:', e.message); }
      _auditWrite('payment_voided', { documentId: id });
      return { ok:true, id, record:merged };
    } catch (e) { return { ok:false, error:e.message }; }
  };

  const removePayment = (id) => {
    const payment = _idx.paymentById[id];
    if (!payment) return { ok:false, error:`removePayment: '${id}' not found` };
    try {
      reverseAllocations(id);
    } catch (e) {
      return { ok:false, error:`removePayment: reverseAllocations failed — ${e.message}` };
    }
    const backup = _deepClone(payment);
    _paymentOuts=_paymentOuts.filter(r=>r.id!==id);
    delete _idx.paymentById[id];
    const sr = _save();
    if (!sr.ok) {
      _paymentOuts.unshift(backup); _idx.paymentById[id] = backup;
      return { ok:false, error:'removePayment: '+sr.error };
    }
    _auditWrite('payment_removed', { documentId: id });
    return { ok:true };
  };

  const setPaymentOuts = (arr) => {
    _paymentOuts=[];
    for (const r of (arr||[])) { try { _paymentOuts.push(_normalisePayment(_safeObj(r))); } catch (_) {} }
    _meta.paymentSeq=_scanMax(_paymentOuts); _rebuildIndexes();
  };

  const getDashboardStats = (monthYYYYMM) => {
    let mo=(monthYYYYMM||'').trim();
    if (!mo) { mo = _erpToday().slice(0, 7); }
    const validMonth=/^\d{4}-\d{2}$/.test(mo);
    const [moYear,moMonth]=validMonth?mo.split('-').map(Number):[];
    const monthlyTotal=validMonth?_purchases.filter(p=>{
      if (!p.date||p._deleted) return false;
      const d=new Date(p.date+'T00:00:00');
      return !isNaN(d.getTime())&&d.getFullYear()===moYear&&(d.getMonth()+1)===moMonth;
    }).reduce((s,p)=>s+p.total,0):0;
    return {
      monthlyTotal   : _round2(monthlyTotal),
      pendingOrders  : _purchaseOrders.filter(o=>o.status==='pending').length,
      receivedOrders : _purchaseOrders.filter(o=>o.status==='received').length,
      totalPayable   : _round2(
        Math.max(0, Object.keys(_supplierLedger).reduce((sum,sid) => sum + getLedgerBalance(sid), 0)) / 100
      ),
    };
  };

  const getPurchasesBySupplier = (supplierIdOrName) => {
    const key=(supplierIdOrName||'').trim().toLowerCase();
    if (!key) return [];
    return _cloneAll(_purchases.filter(p=>!p._deleted&&((p.supplierId||'').trim().toLowerCase()===key||(p.supplierName||'').trim().toLowerCase()===key)));
  };

  const getSupplierBalance = (supplierIdOrName) => {
    const key=(supplierIdOrName||'').trim().toLowerCase();
    if (!key) return 0;
    const rawSid = _purchases.find(p=>!p._deleted&&((p.supplierId||'').toLowerCase()===key||(p.supplierName||'').toLowerCase()===key))?.supplierId || supplierIdOrName;
    const sid = (rawSid || '').toLowerCase().trim();
    return _round2(getLedgerBalance(sid) / 100);
  };

  const getEffectiveBalance = (purchaseId) => {
    const purchase=_idx.purchaseById[purchaseId];
    if (!purchase) return null;
    const totalReturns=_purchaseReturns.filter(r=>r.purchaseId===purchaseId && !r._deleted).reduce((s,r)=>s+_toPaisa(r.total||0),0);
    const effectivePaisa = Math.max(0, (purchase.totalPaisa || _toPaisa(purchase.total || 0)) - (purchase.paidPaisa || 0) - totalReturns);
    return _fromPaisa(effectivePaisa);
  };

  const getPaidByPurchaseId = (purchaseId) => {

    const allAllocs = Object.values(_paymentAllocationsOut).flat();
    const allocatedPaymentIds = new Set(
      allAllocs.filter(a => a.purchaseId === purchaseId).map(a => a.paymentId)
    );
    const allocPaid = _round2(
      allAllocs.filter(a => a.purchaseId === purchaseId)
               .reduce((s, a) => s + _fromPaisa(a.amountAllocated), 0)
    );
    const directOnly = _round2(
      _paymentOuts
        .filter(p => p.reference === purchaseId && !p.voided && !allocatedPaymentIds.has(p.id))
        .reduce((s, p) => s + p.amount, 0)
    );
    return _round2(allocPaid + directOnly);
  };

  const getPurchasesPaginated = (page=1, pageSize=50) => {
    const visible=_purchases.filter(p=>!p._deleted);
    const start=(page-1)*pageSize;
    return { data:_cloneAll(visible.slice(start,start+pageSize)), total:visible.length, page, pageSize };
  };

  const exportJSON = ({ includeLedger = false } = {}) => {
    try {
      const data = {
        exportedAt: _erpNow(),
        storageVersion: STORE_VER,
        purchases: _cloneAll(_purchases),
        purchaseOrders: _cloneAll(_purchaseOrders),
        purchaseReturns: _cloneAll(_purchaseReturns),
        paymentOuts: _cloneAll(_paymentOuts),
        paymentAllocationsOut: _deepClone(_paymentAllocationsOut),
      };
      if (includeLedger) {
        data.supplierLedger = _deepClone(_supplierLedger);
      }
      return { ok:true, json:JSON.stringify(data,null,2), filename:`purchase_backup_${_erpToday()}.json` };
    } catch (e) { return { ok:false, error:`exportJSON: ${e.message}` }; }
  };

  const importJSON = (json, { replace=false }={}) => {
    try {
      const data=JSON.parse(json);
      if (!data||!data.storageVersion) throw new ValidationError('Invalid export format', { operation: 'importJSON' });
      const _bk = {
        p: [..._purchases], o: [..._purchaseOrders],
        r: [..._purchaseReturns], py: [..._paymentOuts],
        sl: JSON.parse(JSON.stringify(_supplierLedger)),
        pa: JSON.parse(JSON.stringify(_paymentAllocationsOut))
      };
      if (replace) { _purchases=[]; _purchaseOrders=[]; _purchaseReturns=[]; _paymentOuts=[]; _rebuildIndexes(); }
      const counts={ purchases:0, purchaseOrders:0, purchaseReturns:0, paymentOuts:0 };
      for (const r of (data.purchases||[])) { if (!_idx.purchaseById[r.id]) { try { _purchases.push(_normalisePurchase(r)); counts.purchases++; } catch (_) {} } }
      for (const r of (data.purchaseOrders||[])) { if (!_idx.poById[r.id]) { try { _purchaseOrders.push(_normalisePO(r)); counts.purchaseOrders++; } catch (_) {} } }
      for (const r of (data.purchaseReturns||[])) { if (!_idx.returnById[r.id]) { try { _purchaseReturns.push(_normaliseReturn(r)); counts.purchaseReturns++; } catch (_) {} } }

      _recalcMeta(); _rebuildIndexes();
      for (const r of (data.paymentOuts||[])) { if (!_idx.paymentById[r.id]) { try { _paymentOuts.push(_normalisePayment(r)); counts.paymentOuts++; } catch (_) {} } }
      if (data.supplierLedger && typeof data.supplierLedger==='object') {
        const _isValidImportedLedgerEntry = (e) =>
          !!e && typeof e === 'object'
          && typeof e.id === 'string' && e.id.trim() !== ''
          && VALID_LEDGER_TYPES.has(e.type)
          && Number.isInteger(e.debit)  && e.debit  >= 0
          && Number.isInteger(e.credit) && e.credit >= 0
          && !(e.debit === 0 && e.credit === 0)
          && !!_validateDate(e.date || '', { allowFuture: true });
        for (const k of Object.keys(data.supplierLedger)) {
          const lk = k.toLowerCase().trim();
          if (!_supplierLedger[lk]) _supplierLedger[lk] = [];
          const existingIds = new Set(_supplierLedger[lk].map(e => e.id));
          const newEntries = (data.supplierLedger[k] || []).filter(e => _isValidImportedLedgerEntry(e) && !existingIds.has(e.id));
          _supplierLedger[lk] = _supplierLedger[lk].concat(newEntries);
        }
      }
      if (data.paymentAllocationsOut && typeof data.paymentAllocationsOut==='object') {
        for (const pid of Object.keys(data.paymentAllocationsOut)) {
          const incoming = Array.isArray(data.paymentAllocationsOut[pid]) ? data.paymentAllocationsOut[pid] : [];
          if (!_paymentAllocationsOut[pid]) {
            _paymentAllocationsOut[pid] = incoming;
          } else {
            const existingSet = new Set(_paymentAllocationsOut[pid].map(a => a.purchaseId + ':' + a.amountAllocated));
            const newEntries  = incoming.filter(a => !existingSet.has(a.purchaseId + ':' + a.amountAllocated));
            _paymentAllocationsOut[pid] = _paymentAllocationsOut[pid].concat(newEntries);
          }
        }
      }
      _recalcMeta(); _rebuildIndexes();

      const existingLedgerIds = new Set();
      for (const entries of Object.values(_supplierLedger)) {
        for (const e of entries) { if (e.referenceId) existingLedgerIds.add(e.referenceId); }
      }
      _ledgerSaveDeferred = true;
      for (const p of _purchases) {
        if (!p._deleted && !existingLedgerIds.has(p.id)) {
          try {
            const sid = (p.supplierId || p.supplierName || '').toLowerCase().trim();
            const totalPaisa = Math.round((p.total || p.grand || 0) * 100);
            if (sid && totalPaisa > 0) {
              writeLedgerEntry({ type:'PURCHASE_BILL', supplierId:sid, debit:0, credit:totalPaisa, date:p.date||_erpToday(), referenceId:p.id, note:'Imported purchase: '+p.id });
            }
          } catch (_) {}
        }
      }
      for (const r of _purchaseReturns) {
        if (!r._deleted && !existingLedgerIds.has(r.id)) {
          try {
            const sid = (r.supplierId || r.supplierName || '').toLowerCase().trim();
            const totalPaisa = Math.round((r.total || 0) * 100);
            if (sid && totalPaisa > 0) {
              writeLedgerEntry({ type:'PURCHASE_RETURN', supplierId:sid, debit:totalPaisa, credit:0, date:r.date||_erpToday(), referenceId:r.id, note:'Imported return: '+r.id });
            }
          } catch (_) {}
        }
      }
      for (const pay of _paymentOuts) {
        if (!existingLedgerIds.has(pay.id)) {
          try {
            const sid = (pay.supplierId || pay.supplierName || '').toLowerCase().trim();
            const amtPaisa = Math.round((pay.amount || 0) * 100);
            if (sid && amtPaisa > 0) {
              writeLedgerEntry({ type:'PAYMENT_OUT', supplierId:sid, debit:amtPaisa, credit:0, date:pay.date||_erpToday(), referenceId:pay.id, note:'Imported payment: '+pay.id });
            }
          } catch (_) {}
        }
      }
      const sr=_save();
      _ledgerSaveDeferred = false;
      if (!sr.ok) {
        _purchases=_bk.p; _purchaseOrders=_bk.o; _purchaseReturns=_bk.r; _paymentOuts=_bk.py;
        _supplierLedger=_bk.sl; _paymentAllocationsOut=_bk.pa;
        _rebuildIndexes();
        return { ok:false, error:'importJSON: save failed — '+sr.error };
      }
      _saveLedger(); _saveAllocations();
      _auditWrite('import_completed', { counts });
      return { ok:true, imported:counts };
    } catch (e) { _ledgerSaveDeferred = false; return { ok:false, error:`importJSON: ${e.message}` }; }
  };

  const save  = () => _save();
  const load  = () => _load();

  const reset = () => {
    _purchases=[]; _purchaseOrders=[]; _purchaseReturns=[]; _paymentOuts=[];
    _supplierLedger={}; _paymentAllocationsOut={};
    _meta={ purchaseSeq:0, poSeq:0, returnSeq:0, paymentSeq:0 };
    _rebuildIndexes(); return { ok:true };
  };

  const clearStorage = ({ confirmed=false }={}) => {
    if (!confirmed) return { ok:false, error:'clearStorage: pass { confirmed:true } to confirm full data wipe' };
    reset();
    [STORE_KEY,META_KEY,STAMP_KEY,STORE_KEY+'_chk',LEDGER_KEY,ALLOC_KEY,_legacyErpKey(),LEGACY_PAY_KEY,LEGACY_POR_KEY,LEGACY_RET_KEY]
      .forEach(k=>{ try { _saRemove(k); } catch (_) {} });
    _supplierLedger={}; _paymentAllocationsOut={};
    return { ok:true };
  };

  const previewNextPurchaseId = () => _safePreview(PREFIX_PUR, _meta.purchaseSeq, _purchases);
  const previewNextPOId       = () => _safePreview(PREFIX_PO,  _meta.poSeq,       _purchaseOrders);
  const previewNextReturnId   = () => _safePreview(PREFIX_PR,  _meta.returnSeq,   _purchaseReturns);
  const previewNextPaymentId  = () => _safePreview(PREFIX_PAY, _meta.paymentSeq,  _paymentOuts);

  const validatePurchase = (raw) => _normalisePurchase({ ..._safeObj(raw), id: raw.id||'VALIDATE-000000' });
  const validatePO       = (raw) => _normalisePO({ ..._safeObj(raw),       id: raw.id||'VALIDATE-000000' });
  const validateReturn   = (raw) => {
    const safe=_safeObj(raw);
    const purchaseId=(safe.purchaseId||safe.originalPO||'').trim();
    const isFreeReturn = (safe.returnType || '').trim() === 'free';
    if (!purchaseId && !isFreeReturn) throw new ValidationError('validateReturn: purchaseId is required', { operation: 'validateReturn' });
    return _normaliseReturn({ ...safe, id:safe.id||'VALIDATE-000000', purchaseId });
  };
  const validatePayment  = (raw) => _normalisePayment({ ..._safeObj(raw), id:raw.id||'VALIDATE-000000' });

  const PurchaseParties = {
    getSuppliers() {
      if (typeof this._impl?.getSuppliers === 'function') return this._impl.getSuppliers();
      try {
        const erp = typeof ERP !== 'undefined' ? ERP : null;
        if (erp && erp.getState) {
          const state = erp.getState();
          const sup = (state && state.data && Array.isArray(state.data.suppliers)) ? state.data.suppliers : (Array.isArray(state && state.suppliers) ? state.suppliers : null);
          if (sup) return sup.map(s=>({..._safeObj(s)}));
        }
        const raw=(window.ERP && window.ERP.getState && window.ERP.getState().data && window.ERP.getState().data.suppliers) || (global.window && global.window.suppliers) || global.suppliers;
        if (!Array.isArray(raw)) return []; return raw.map(s=>({..._safeObj(s)}));
      } catch (_) { return []; }
    },
    getSupplierByName(name) {
      const lc=(name||'').toLowerCase().trim();
      return this.getSuppliers().find(s=>(s.n||s.name||'').toLowerCase().trim()===lc)||null;
    },
    addSupplier(supplierData) {
      if (typeof this._impl?.addSupplier === 'function') return this._impl.addSupplier(supplierData);
      const name=(supplierData?.n||supplierData?.name||'').trim();
      if (!name) return { ok:false, error:'addSupplier: name is required' };
      const existing=this.getSupplierByName(name);
      if (existing) return { ok:false, duplicate:true, error:`addSupplier: supplier "${name}" already exists` };
      throw new ERPError('[PurchaseParties.addSupplier] No supplier-add impl registered — register one via PurchaseParties.register()', { module:'purchase_state', operation:'addSupplier' });
    },
    openNewSupplier(prefill) {
      if (typeof this._impl?.openNewSupplier === 'function') return this._impl.openNewSupplier(prefill);
      try { if (typeof global.openAddPartyModal==='function') global.openAddPartyModal('supplier'); } catch (_) {}
    },
    _impl:null,
    register(impl) { this._impl = impl; },
  };

  const PurchaseInventory = {
    getItems() {
      if (typeof this._impl?.getItems === 'function') return this._impl.getItems();
      try {
        const erp = typeof ERP !== 'undefined' ? ERP : null;
        if (erp && erp.getState) {
          const state = erp.getState();
          if (Array.isArray(state?.data?.inventory))
            return state.data.inventory.map(i=>({ bc:(i.bc||'').trim(), n:(i.n||i.name||'').trim(), st:_numNonNeg(i.st,0), cp:_round2(_numNonNeg(i.cp||i.pp||i.sp,0)), pp:_round2(_numNonNeg(i.pp||i.cp,0)), sp:_round2(_numNonNeg(i.sp||i.pp,0)), unit:(i.unit||'NONE').trim() }));
        }
        const raw=(window.ERP && window.ERP.getState && window.ERP.getState().data && window.ERP.getState().data.inventory) || (global.window && global.window.inventory) || global.inventory;
        if (!Array.isArray(raw)) return [];
        return raw.map(i=>({ bc:(i.bc||'').trim(), n:(i.n||i.name||'').trim(), st:_numNonNeg(i.st,0), cp:_round2(_numNonNeg(i.cp||i.pp||i.sp,0)), pp:_round2(_numNonNeg(i.pp||i.cp,0)), sp:_round2(_numNonNeg(i.sp||i.pp,0)), unit:(i.unit||'NONE').trim() }));
      } catch (_) { return []; }
    },
    findItem(nameOrBarcode) {
      const lc=(nameOrBarcode||'').toLowerCase();
      return this.getItems().find(i=>i.n.toLowerCase()===lc||i.bc===nameOrBarcode)||null;
    },
    increaseStock(itemId, qty, batchInfo) {
      if (typeof this._impl?.increaseStock === 'function') return this._impl.increaseStock(itemId, qty, batchInfo);
      throw new ERPError('[PurchaseInventory.increaseStock] InventoryService not ready — register an impl via PurchaseInventory.register()', { module:'purchase_state', operation:'increaseStock' });
    },
    decreaseStock(itemId, qty, opts) {
      if (typeof this._impl?.decreaseStock === 'function') {
        try {
          const r = this._impl.decreaseStock(itemId, qty, opts);
          if (r && typeof r === 'object' && 'ok' in r) return r;
          return { ok:false, error:'PurchaseInventory.decreaseStock (_impl): implementation returned no confirmation — stock deduction could not be verified' };
        } catch (e) { return {ok:false,error:`PurchaseInventory.decreaseStock (_impl): ${e.message}`}; }
      }
      throw new ERPError('[PurchaseInventory.decreaseStock] InventoryService not ready — register an impl via PurchaseInventory.register()', { module:'purchase_state', operation:'decreaseStock' });
    },
    addBatch(batchData) {
      if (typeof this._impl?.addBatch === 'function') return this._impl.addBatch(batchData);
      throw new ERPError('[PurchaseInventory.addBatch] InventoryService not ready — register an impl via PurchaseInventory.register()', { module:'purchase_state', operation:'addBatch' });
    },
    addMovement(movementData) {
      if (typeof this._impl?.addMovement === 'function') return this._impl.addMovement(movementData);
      throw new ERPError('[PurchaseInventory.addMovement] InventoryService not ready — register an impl via PurchaseInventory.register()', { module:'purchase_state', operation:'addMovement' });
    },
    _impl:null,
    register(impl) { this._impl = impl; },
  };

  const PurchaseState = ({
    load, save, reset, clearStorage,

    getAllPurchases, getPurchaseById,
    addPurchase, addPurchases, updatePurchase, removePurchase, restorePurchase, setPurchases,
    getPurchasesPaginated,

    getAllPurchaseOrders, getPOById, addPO, updatePO, removePO, setPurchaseOrders,

    getAllReturns, getReturnById, getReturnsByPurchaseId,
    addReturn, updateReturn, removeReturn, restoreReturn, setPurchaseReturns,

    getAllPayments, getPaymentById,
    addPayment, updatePayment, removePayment, voidPayment, setPaymentOuts,

    getDashboardStats,
    getPurchasesBySupplier,
    getSupplierBalance,
    getEffectiveBalance,
    getPaidByPurchaseId,

    getLedgerBalance,
    getSupplierLedgerEntries,
    removeLedgerEntry,
    writeLedgerEntry,
    renameLedgerKey,
    recalculate,
    fifoAllocate,
    reverseAllocations,
    deriveStatus,

    exportJSON, importJSON,

    getQuarantinedRecords, clearQuarantinedRecords,

    previewNextPurchaseId, previewNextPOId, previewNextReturnId, previewNextPaymentId,
    validatePurchase, validatePO, validateReturn, validatePayment,

    PurchaseParties, PurchaseInventory,

    ERPError, ValidationError, ConflictError, NotFoundError, StorageError,

    STORE_KEY, META_KEY, LEDGER_KEY, ALLOC_KEY, STORE_VER,
    PREFIX_PUR, PREFIX_PO, PREFIX_PR, PREFIX_PAY,
    MAX_AMOUNT,

    setOnExternalUpdate : (fn) => { _onExternalUpdateCb = (typeof fn==='function') ? fn : null; },
    setSyncToDB         : (fn) => { _syncToDBCb         = (typeof fn==='function') ? fn : null; },
  });

  global.PurchaseState = PurchaseState;
  PurchaseState.load();

  if (typeof window !== 'undefined' && window.DEBUG_MODE) console.log(
    '[PurchaseState] ready |',
    'pur=' + PurchaseState.getAllPurchases().length,
    'po='  + PurchaseState.getAllPurchaseOrders().length,
    'ret=' + PurchaseState.getAllReturns().length,
    'pay=' + PurchaseState.getAllPayments().length,
    '| ledger keys=' + Object.keys(_supplierLedger).length
  );

}(typeof globalThis !== 'undefined' ? globalThis : window));
