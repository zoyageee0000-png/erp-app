;(function (global) {
  'use strict';

  if (!global.PurchaseState)
    throw new Error('[PurchaseBridge] PurchaseState not loaded. Load purchase_state.js first.');

  const PS = global.PurchaseState;

  const ValidationError = PS.ValidationError;
  const ERPError        = PS.ERPError;

  const _r2  = (n) => { const v = parseFloat(n); if (!Number.isFinite(v)) return 0; return Math.round((v + Number.EPSILON) * 100) / 100; };
  const _lc  = (s) => (s || '').toString().toLowerCase().trim();
  const _esc = (s) => {
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(String(s ?? ''));
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  };
  const _num = (v, def) => { const n = parseFloat(v); return Number.isFinite(n) ? n : (def === undefined ? 0 : def); };
  const _isPosFinite = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0; };

  const _erpToday = () => {
    if (typeof global.ERP !== 'undefined' && global.ERP.DateUtils && typeof global.ERP.DateUtils.today === 'function')
      return global.ERP.DateUtils.today();
    const d = new Date();
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const pkTime = new Date(utc + (5 * 60 * 60000));
    return `${pkTime.getFullYear()}-${String(pkTime.getMonth() + 1).padStart(2, '0')}-${String(pkTime.getDate()).padStart(2, '0')}`;
  };

  const _erpNow = () => {
    if (typeof ERP !== 'undefined' && ERP && ERP.DateUtils && typeof ERP.DateUtils.now === 'function')
      return ERP.DateUtils.now();
    return new Date().toISOString();
  };

  const _toast = (msg, type, dur) => {
    try { showToast(msg, type || 'info', dur === undefined ? 3500 : dur); } catch (_) { if (typeof window !== 'undefined' && window.DEBUG_MODE) console.log('[TOAST ' + (type || 'info') + ']', msg); }
  };

  const _erpState  = () => { try { return (typeof ERP !== 'undefined' && ERP && ERP.getState) ? ERP.getState() : {}; } catch (_) { return {}; } };
  const _suppliers = () => {
    const s = _erpState();
    if (Array.isArray(s.suppliers)) return s.suppliers;
    if (s.data && Array.isArray(s.data.suppliers)) return s.data.suppliers;
    return [];
  };

  const _findSup = (name) => {
    const key = _lc(name);
    return _suppliers().find(function(s) {
      return _lc(s.n || s.name || '') === key || _lc(s.id || '') === key;
    }) || null;
  };

  const _auditWrite = (event, details) => {
    try {
      const erp = typeof ERP !== 'undefined' ? ERP : null;
      if (erp && erp.AuditLog && typeof erp.AuditLog.write === 'function')
        erp.AuditLog.write({ module: 'purchase_bridge', event: event, details: details || {}, timestamp: _erpNow() });
    } catch (_) {}
  };

  const _persist = () => {
    const r = PS.save();
    if (r && !r.ok) {
      if (r.quota) _toast('⚠️ Storage full! Export and clear old data.', 'error', 8000);
      else {
        console.error('[PurchaseBridge] PS.save() failed:', r.error);
        _toast('❌ Purchase data could not be saved: ' + (r.error || 'Unknown error') + '. Do NOT close this tab.', 'error', 0);
      }
    }
  };

  const _saveSuppliersToERP = (suppliers) => {
    try {
      if (typeof ERP !== 'undefined' && ERP && typeof ERP.setState === 'function') {
        ERP.setState(function(draft) {
          if (!draft.data) draft.data = {};
          draft.data.suppliers = suppliers;
        }, 'purchase_bridge:suppliers_sync');
      }
      if (typeof saveErpData === 'function') saveErpData();
      else _persist();
    } catch (e) {
      _persist();
    }
  };

  function addSupplier(supplierData) {
    try {
      if (!supplierData || typeof supplierData !== 'object')
        return { ok: false, error: 'addSupplier: supplierData must be an object' };

      const name = (supplierData.n || supplierData.name || '').trim();
      if (!name) return { ok: false, error: 'addSupplier: name zaroori hai' };

      if (_findSup(name)) {
        _toast('⚠️ Supplier "' + _esc(name) + '" pehle se exist karta hai!', 'warning');
        return { ok: false, duplicate: true, error: 'addSupplier: "' + name + '" already exists' };
      }

      const rawId = (supplierData.id || name).toString().trim();
      const sup = {
        n           : name,
        phone       : (supplierData.phone || supplierData.ph || '').trim(),
        email       : (supplierData.email || '').trim(),
        address     : (supplierData.address || '').trim(),
        creditLimit : _num(supplierData.creditLimit || supplierData.credit_limit || supplierData.limit, 0),
        id          : rawId,
        createdAt   : _erpNow(),
      };

      const arr = _suppliers().concat([sup]);

      const openingBalance = _num(supplierData.openingBalance || supplierData.opening, 0);
      const supplierId = _lc(rawId);

      if (openingBalance !== 0 && Number.isFinite(openingBalance)) {
        const absPaisa = Math.round(Math.abs(openingBalance) * 100);
        const entry    = openingBalance > 0
          ? { type:'OPENING_BALANCE', debit:0,        credit:absPaisa }
          : { type:'OPENING_BALANCE', debit:absPaisa, credit:0        };

        const result = PS.writeLedgerEntry({
          supplierId  : supplierId,
          type        : entry.type,
          debit       : entry.debit,
          credit      : entry.credit,
          referenceId : '',
          date        : _erpToday(),
          note        : 'Opening balance on account creation — ' + name,
        });

        if (!result || !result.ok) {
          console.error('[addSupplier] writeLedgerEntry failed:', result && result.error);
          _toast('⚠️ Opening balance ledger entry fail: ' + (result && result.error || 'Unknown'), 'warning');
        } else {
          _auditWrite('supplier_opening_balance', { supplierId: supplierId, openingBalance: openingBalance, entryId: result.id });
        }
      }

      _saveSuppliersToERP(arr);

      try { if (ERP && ERP.events && ERP.events.emit) ERP.events.emit('suppliers:updated'); } catch (_) {}
      try { if (typeof populateSupplierDropdowns === 'function') populateSupplierDropdowns(); } catch (_) {}

      _auditWrite('supplier_added', { supplierId: supplierId, name: name, openingBalance: openingBalance });
      const _obLabel = openingBalance > 0 ? ' Opening balance (Payable): ' + ERP.fmt(openingBalance)
                      : openingBalance < 0 ? ' Opening balance (Advance from us): ' + ERP.fmt(Math.abs(openingBalance))
                      : '';
      _toast('✅ Supplier "' + _esc(name) + '" add ho gaya!' + _obLabel, 'success');
      return { ok: true, supplier: sup };

    } catch (e) {
      console.error('[addSupplier]', e);
      _toast('❌ Supplier add failed: ' + e.message, 'error');
      return { ok: false, error: e.message };
    }
  }

  function editSupplier(nameOrId, patch) {
    try {
      const sup = _findSup(nameOrId);
      if (!sup) return { ok: false, error: 'editSupplier: "' + nameOrId + '" not found' };

      const BLOCKED = new Set(['owe','balance','credit','payable','purchases','purchasesTotal','openingBalance','id']);
      for (const k of Object.keys(patch || {})) {
        if (BLOCKED.has(k)) {
          const msg = 'editSupplier: field "' + k + '" cannot be edited directly — use ledger entry for balance adjustments';
          console.error('[editSupplier]', msg);
          return { ok: false, error: msg };
        }
      }

      const oldId = _lc(sup.id || sup.n || nameOrId);
      const allowed = ['phone','ph','email','address','creditLimit','n','name'];
      for (const k of allowed) {
        if (patch[k] !== undefined) {
          if (k === 'n' || k === 'name') sup.n = (patch[k] || '').trim();
          else sup[k] = patch[k];
        }
      }
      const newId = _lc(sup.n || sup.id || nameOrId);

      if (newId && newId !== oldId && typeof PS.renameLedgerKey === 'function') {
        try {
          PS.renameLedgerKey(oldId, newId);
        } catch (_renameErr) {
          console.error('[editSupplier] ledger key rename failed:', _renameErr);
          _toast('⚠️ Supplier renamed, but ledger entries could not be relinked to the new id.', 'warning');
        }

        try {
          var newName = (sup.n || '').trim();
          var _migFailCount = 0;
          var allPurchases = PS.getAllPurchases ? PS.getAllPurchases() : [];
          for (var _pi = 0; _pi < allPurchases.length; _pi++) {
            var _p = allPurchases[_pi];
            if (_lc(_p.supplierId || _p.supplierName || '') === oldId) {
              if (typeof PS.updatePurchase === 'function') {
                try {
                  var _pr = PS.updatePurchase(_p.id, { supplierId: newId, supplierName: newName });
                  if (!_pr || !_pr.ok) _migFailCount++;
                } catch (_) { _migFailCount++; }
              }
            }
          }
          var allPOs = PS.getAllPurchaseOrders ? PS.getAllPurchaseOrders() : [];
          for (var _oi = 0; _oi < allPOs.length; _oi++) {
            var _o = allPOs[_oi];
            if (_lc(_o.supplierId || _o.supplierName || '') === oldId) {
              if (typeof PS.updatePO === 'function') {
                try {
                  var _por = PS.updatePO(_o.id, { supplierId: newId, supplierName: newName });
                  if (!_por || !_por.ok) _migFailCount++;
                } catch (_) { _migFailCount++; }
              }
            }
          }
          if (_migFailCount > 0) {
            console.error('[editSupplier] ' + _migFailCount + ' purchase/PO record(s) could not be migrated to the new supplier id — they may still reference "' + oldId + '"');
            _toast('⚠️ Supplier renamed, but ' + _migFailCount + ' old record(s) could not be relinked. Purchase history may be incomplete.', 'warning');
          }
        } catch (_migErr) { console.warn('[editSupplier] purchase migration failed:', _migErr); }
      }

      _saveSuppliersToERP(_suppliers());
      try { if (ERP && ERP.events && ERP.events.emit) ERP.events.emit('suppliers:updated'); } catch (_) {}
      _auditWrite('supplier_edited', { supplierId: newId, oldSupplierId: oldId, patch: Object.keys(patch || {}) });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  function getSupplierLedger(supplierId) {
    try {
      const sidNorm = _lc(supplierId);
      const entries = typeof PS.getSupplierLedgerEntries === 'function'
        ? PS.getSupplierLedgerEntries(sidNorm)
        : [];
      var balance = 0;
      try { balance = PS.getLedgerBalance(sidNorm); } catch (_) { balance = 0; }
      return {
        supplierId    : sidNorm,
        entries       : entries || [],
        balance       : balance || 0,
        balanceRupees : _r2((balance || 0) / 100),
        isAdvance     : (balance || 0) < 0,
        isPayable     : (balance || 0) > 0,
      };
    } catch (e) {
      console.error('[getSupplierLedger]', e.message);
      return { entries: [], balance: 0, balanceRupees: 0, isAdvance: false, isPayable: false };
    }
  }

  function writeManualAdjustment(opts) {
    try {
      var supplierId = opts && opts.supplierId;
      var amount = opts && opts.amount;
      var direction = opts && opts.direction;
      var date = opts && opts.date;
      var note = opts && opts.note;

      if (!supplierId) return { ok: false, error: 'supplierId required' };
      supplierId = _lc(supplierId);

      var amtVal = parseFloat(amount);
      if (!Number.isFinite(amtVal) || amtVal <= 0)
        return { ok: false, error: 'amount must be a positive finite number' };

      var dir = _lc(direction);
      if (dir !== 'credit' && dir !== 'debit')
        return { ok: false, error: 'direction must be "credit" or "debit"' };

      var amtPaisa = Math.round(amtVal * 100);
      var d = date || _erpToday();
      var entry = dir === 'credit'
        ? { debit: 0,        credit: amtPaisa }
        : { debit: amtPaisa, credit: 0        };

      var result = PS.writeLedgerEntry({
        supplierId  : supplierId,
        type        : 'ADJUSTMENT',
        debit       : entry.debit,
        credit      : entry.credit,
        referenceId : '',
        date        : d,
        note        : note || 'Manual adjustment',
      });

      if (!result || !result.ok) return result || { ok: false, error: 'writeLedgerEntry failed' };
      PS.recalculate(supplierId);
      _auditWrite('manual_adjustment', { supplierId: supplierId, amtPaisa: amtPaisa, direction: dir, date: d, entryId: result.id });
      return { ok: true, id: result.id };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  function reconcileSupplier(supplierId) {
    try {
      var sidLc = _lc(supplierId);
      var ledgerBalance = 0;
      try { ledgerBalance = PS.getLedgerBalance(sidLc); } catch (_) { ledgerBalance = 0; }

      var allPurchases = (typeof PS.getAllPurchases === 'function' ? PS.getAllPurchases() : []).filter(function(p) {
        return !p._deleted && (
          _lc(p.supplierId || '') === sidLc || _lc(p.supplierName || '') === sidLc
        );
      });
      var allPayments = (typeof PS.getAllPayments === 'function' ? PS.getAllPayments() : []).filter(function(p) {
        return !p.voided && (
          _lc(p.supplierId || '') === sidLc || _lc(p.supplierName || '') === sidLc
        );
      });
      var allReturns = (typeof PS.getAllReturns === 'function' ? PS.getAllReturns() : []).filter(function(r) {
        return !r._deleted && (
          _lc(r.supplierId || '') === sidLc || _lc(r.supplierName || '') === sidLc
        );
      });
      var allReceivedPOs = (typeof PS.getAllPurchaseOrders === 'function' ? PS.getAllPurchaseOrders() : []).filter(function(o) {
        return _lc((o.status || o.st) || '') === 'received' && (
          _lc(o.supplierId || '') === sidLc || _lc(o.supplierName || '') === sidLc
        );
      });

      var totalBillsPaisa    = allPurchases.reduce(function(s, p) {
        var tp = p.totalPaisa;
        if (tp !== undefined && tp !== null && Number.isFinite(tp)) return s + tp;
        return s + Math.round(_num(p.total, 0) * 100);
      }, 0);
      var totalPaymentsPaisa = allPayments.reduce(function(s, p) {
        if (p.amountPaisa !== undefined && p.amountPaisa !== null && Number.isFinite(+p.amountPaisa)) {
          return s + Math.round(+p.amountPaisa);
        }
        return s + Math.round(_num(p.amount || p.amountRs, 0) * 100);
      }, 0);
      var totalReturnsPaisa  = allReturns.reduce(function(s, r) {
        return s + Math.round(_num(r.total, 0) * 100);
      }, 0);
      var totalPOReceivedPaisa = allReceivedPOs.reduce(function(s, o) {
        return s + Math.round(_num(o.total, 0) * 100);
      }, 0);

      var computedBalance = totalBillsPaisa + totalPOReceivedPaisa - totalPaymentsPaisa - totalReturnsPaisa;
      var delta           = ledgerBalance - computedBalance;

      if (Math.abs(delta) > 0) {
        console.warn('[RECONCILIATION MISMATCH]', {
          supplierId    : supplierId,
          ledgerBalance : ledgerBalance,
          computedBalance: computedBalance,
          delta         : delta,
          ledgerRupees  : _r2(ledgerBalance    / 100),
          computedRupees: _r2(computedBalance  / 100),
          deltaRupees   : _r2(delta / 100),
        });

        var erp = typeof ERP !== 'undefined' ? ERP : null;
        var debugMode = false;
        try {
          debugMode = (erp && erp.getState && typeof erp.getState === 'function' ? erp.getState().__ERP_DEBUG__ : false)
                   || (typeof window !== 'undefined' && window.__ERP_DEBUG__)
                   || (typeof localStorage !== 'undefined' && localStorage.getItem('erp_debug') === '1');
        } catch (_) { debugMode = false; }

        if (debugMode) _showReconciliationBanner(supplierId, ledgerBalance, computedBalance, delta);

        _auditWrite('reconciliation_mismatch', { supplierId: sidLc, ledgerBalance: ledgerBalance, computedBalance: computedBalance, delta: delta });
        return { ok: false, delta: delta, supplierId: supplierId };
      }

      return { ok: true, supplierId: supplierId };
    } catch (e) {
      console.error('[reconcileSupplier]', e.message);
      return { ok: false, error: e.message, supplierId: supplierId };
    }
  }

  function _diagnoseSupplierMismatch(sid) {
    var ledgerBalance = 0;
    try { ledgerBalance = PS.getLedgerBalance(sid); } catch (_) { ledgerBalance = 0; }

    var allPayments = typeof PS.getAllPayments === 'function' ? PS.getAllPayments() : [];
    var supplierPayments = allPayments.filter(function(p) {
      return _lc(p.supplierId || '') === sid || _lc(p.supplierName || '') === sid;
    });

    var allPurchases = (typeof PS.getAllPurchases === 'function' ? PS.getAllPurchases() : []).filter(function(p) {
      return !p._deleted && (
        _lc(p.supplierId || '') === sid || _lc(p.supplierName || '') === sid
      );
    });
    var activePayments = supplierPayments.filter(function(p) { return !p.voided; });
    var voidedPayments  = supplierPayments.filter(function(p) { return !!p.voided; });
    var allReturns = (typeof PS.getAllReturns === 'function' ? PS.getAllReturns() : []).filter(function(r) {
      return !r._deleted && (
        _lc(r.supplierId || '') === sid || _lc(r.supplierName || '') === sid
      );
    });
    var allReceivedPOs = (typeof PS.getAllPurchaseOrders === 'function' ? PS.getAllPurchaseOrders() : []).filter(function(o) {
      return _lc((o.status || o.st) || '') === 'received' && (
        _lc(o.supplierId || '') === sid || _lc(o.supplierName || '') === sid
      );
    });

    var totalBillsPaisa = allPurchases.reduce(function(s, p) {
      var tp = p.totalPaisa;
      if (tp !== undefined && tp !== null && Number.isFinite(tp)) return s + tp;
      return s + Math.round(_num(p.total, 0) * 100);
    }, 0);
    var totalPaymentsPaisa = activePayments.reduce(function(s, p) {
      if (p.amountPaisa !== undefined && p.amountPaisa !== null && Number.isFinite(+p.amountPaisa)) {
        return s + Math.round(+p.amountPaisa);
      }
      return s + Math.round(_num(p.amount || p.amountRs, 0) * 100);
    }, 0);
    var totalReturnsPaisa = allReturns.reduce(function(s, r) {
      return s + Math.round(_num(r.total, 0) * 100);
    }, 0);
    var totalPOReceivedPaisa = allReceivedPOs.reduce(function(s, o) {
      return s + Math.round(_num(o.total, 0) * 100);
    }, 0);

    var computedBalance = totalBillsPaisa + totalPOReceivedPaisa - totalPaymentsPaisa - totalReturnsPaisa;
    var delta = ledgerBalance - computedBalance;

    var suspectVoidedPayments = voidedPayments.filter(function(p) {
      var amtPaisa = (p.amountPaisa !== undefined && p.amountPaisa !== null && Number.isFinite(+p.amountPaisa))
        ? Math.round(+p.amountPaisa)
        : Math.round(_num(p.amount || p.amountRs, 0) * 100);
      return amtPaisa > 0 && Math.abs(amtPaisa - Math.abs(delta)) <= 1;
    });

    return {
      supplierId: sid,
      ledgerBalance: ledgerBalance,
      computedBalance: computedBalance,
      delta: delta,
      suspectVoidedPayments: suspectVoidedPayments.map(function(p) { return p.id; }),
      billCount: allPurchases.length,
      activePaymentCount: activePayments.length,
      voidedPaymentCount: voidedPayments.length,
      returnCount: allReturns.length,
    };
  }

  function diagnoseMismatches() {
    try {
      var suppliers = (PS.PurchaseParties && typeof PS.PurchaseParties.getSuppliers === 'function')
        ? PS.PurchaseParties.getSuppliers() : [];
      var report = [];

      suppliers.forEach(function(s) {
        var sid = _lc(s.id || s.name || s.n || '');
        if (!sid) return;

        var diag = _diagnoseSupplierMismatch(sid);
        if (Math.abs(diag.delta) === 0) return;
        report.push(diag);
      });

      return report;
    } catch (e) {
      console.error('[diagnoseMismatches]', e.message);
      return [];
    }
  }

  function repairSupplierMismatch(supplierId, confirm) {
    if (confirm !== true) {
      return { ok: false, error: 'repairSupplierMismatch requires explicit confirm=true from the caller.' };
    }
    try {
      var sid = _lc(supplierId);
      if (!sid) return { ok: false, error: 'supplierId required' };

      var diag = _diagnoseSupplierMismatch(sid);
      if (Math.abs(diag.delta) === 0) {
        return { ok: true, supplierId: sid, repaired: false, reason: 'No mismatch found.' };
      }

      if (diag.suspectVoidedPayments.length) {
        return {
          ok: false,
          supplierId: sid,
          repaired: false,
          delta: diag.delta,
          error: 'Mismatch matches a voided payment (' + diag.suspectVoidedPayments.join(', ') +
            ') rather than an unexplained discrepancy. Correct that payment record directly instead of posting a blind adjustment.',
          suspectVoidedPayments: diag.suspectVoidedPayments,
        };
      }

      var now = _erpNow();
      var today = now.slice(0, 10);
      var absDelta = Math.abs(diag.delta);
      var entry = {
        supplierId  : sid,
        type        : 'ADJUSTMENT',
        date        : today,
        referenceId : 'REPAIR-' + sid + '-' + now.replace(/\D/g, '').slice(0, 14),
        note        : 'Ledger repair (admin-confirmed): ledger ' + ERP.fmt(_r2(diag.ledgerBalance / 100)) +
                      ' vs computed ' + ERP.fmt(_r2(diag.computedBalance / 100)) +
                      ', correcting delta ' + ERP.fmt(_r2(absDelta / 100)) + (diag.delta > 0 ? ' (debit)' : ' (credit)'),
      };
      if (diag.delta > 0) {
        entry.debit  = absDelta;
        entry.credit = 0;
      } else {
        entry.debit  = 0;
        entry.credit = absDelta;
      }

      var result = PS.writeLedgerEntry(entry);
      if (!result || !result.ok) {
        return { ok: false, supplierId: sid, repaired: false, delta: diag.delta, error: (result && result.error) || 'writeLedgerEntry failed' };
      }
      if (typeof PS.recalculate === 'function') PS.recalculate(sid);

      _showReconciliationBanner(sid, diag.ledgerBalance, diag.computedBalance, diag.delta);
      _auditWrite('reconciliation_repair', {
        supplierId: sid,
        ledgerBalanceBefore: diag.ledgerBalance,
        computedBalance: diag.computedBalance,
        delta: diag.delta,
        entryId: result.id,
        billCount: diag.billCount,
        activePaymentCount: diag.activePaymentCount,
        voidedPaymentCount: diag.voidedPaymentCount,
        returnCount: diag.returnCount,
      });
      _toast('\u2705 Ledger correction posted for supplier "' + _esc(sid) + '": ' + ERP.fmt(_r2(absDelta / 100)), 'success', 6000);

      return { ok: true, supplierId: sid, repaired: true, delta: diag.delta, entryId: result.id };
    } catch (e) {
      console.error('[repairSupplierMismatch]', e.message);
      return { ok: false, supplierId: supplierId, repaired: false, error: e.message };
    }
  }

  function _showReconciliationBanner(supplierId, ledger, computed, delta) {
    try {
      var banner = document.getElementById('erp-recon-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'erp-recon-banner';
        banner.style.cssText = [
          'position:fixed','bottom:0','left:0','right:0','z-index:var(--zi-critical,1100)',
          'background:#b71c1c','color:#fff','font-size:13px','font-family:monospace',
          'padding:8px 16px','max-height:160px','overflow-y:auto',
        ].join(';');
        document.body.appendChild(banner);
      }
      var line = document.createElement('div');
      line.textContent =
        '⚠️ RECON MISMATCH [' + supplierId + '] ' +
        'Ledger: ' + ERP.fmt(_r2(ledger/100)) + ' | Computed: ' + ERP.fmt(_r2(computed/100)) + ' | Delta: ' + ERP.fmt(_r2(delta/100));
      banner.appendChild(line);
    } catch (_) {}
  }

  function reconcileAll(opts) {
    opts = opts || {};
    try {
      var allPurchases = typeof PS.getAllPurchases === 'function' ? PS.getAllPurchases() : [];
      var fromSuppliers = (PS.PurchaseParties && typeof PS.PurchaseParties.getSuppliers === 'function')
        ? PS.PurchaseParties.getSuppliers().map(function(s) { return (s.id || s.name || s.n || ''); })
        : [];
      var fromPurchases = allPurchases.filter(function(p) { return !p._deleted; }).map(function(p) { return (p.supplierId || p.supplierName || ''); });
      var fromPayments  = (typeof PS.getAllPayments === 'function' ? PS.getAllPayments() : []).map(function(p) { return (p.supplierId || p.supplierName || ''); });
      var fromReturns   = (typeof PS.getAllReturns  === 'function' ? PS.getAllReturns()  : []).map(function(r) { return (r.supplierId || r.supplierName || ''); });
      var supplierIds = [];
      var seen = {};
      [].concat(fromSuppliers, fromPurchases, fromPayments, fromReturns).forEach(function(x) {
        var key = _lc(x);
        if (key && !seen[key]) { seen[key] = true; supplierIds.push(key); }
      });

      if (!supplierIds.length) return [];

      var mismatches = 0;
      var results = [];
      for (var i = 0; i < supplierIds.length; i++) {
        var result = reconcileSupplier(supplierIds[i]);
        results.push(result);
        if (!result.ok && typeof result.delta === 'number') mismatches++;
      }

      try {
        var _glLedger = global.ERP && global.ERP.Ledger;
        if (_glLedger && typeof _glLedger.getBalance === 'function') {
          var _glAP = _glLedger.getBalance('acc-2001');
          var _subLedgerTotal = 0;
          for (var _si = 0; _si < supplierIds.length; _si++) {
            try { _subLedgerTotal += PS.getLedgerBalance(supplierIds[_si]); } catch (_) {}
          }
          var _crossDelta = Math.abs(_glAP - _subLedgerTotal);
          if (_crossDelta > 100) {
            console.warn('[PurchaseBridge] Cross-system AP mismatch: GL acc-2001=' + _r2(_glAP / 100) +
              ' sub-ledger total=' + _r2(_subLedgerTotal / 100) +
              ' delta=' + _r2(_crossDelta / 100) +
              '. writeLedgerEntry and pe.post are out of sync.');
            _auditWrite('cross_system_ap_mismatch', { glAP: _glAP, subLedgerTotal: _subLedgerTotal, delta: _crossDelta });
            _toast('\u26a0\ufe0f Supplier AP cross-system mismatch (GL vs sub-ledger). Settings \u2192 Diagnostics.', 'warning', 0);
          }
        }
      } catch (_csErr) { console.warn('[PurchaseBridge] cross-system check error:', _csErr && _csErr.message); }

      if (mismatches > 0) {
        console.warn('[PurchaseBridge] reconcileAll: ' + mismatches + ' mismatch(es) found.');
        if (!opts.silent) {
          _toast('\u26a0\ufe0f ' + mismatches + ' supplier ledger mismatch(es) found. Settings \u2192 Diagnostics \u2192 Reconcile Suppliers to review.', 'warning', 8000);
        }
      } else {
        if (typeof window !== 'undefined' && window.DEBUG_MODE)
          console.log('[PurchaseBridge] reconcileAll: all ' + supplierIds.length + ' supplier(s) balanced ✅');
      }
      return results;
    } catch (e) {
      console.error('[reconcileAll]', e.message);
      return [];
    }
  }

  function getPurchaseSummaryForSales(supplierId) {
    var sidLc = _lc(supplierId);
    var bal = 0;
    try { bal = PS.getLedgerBalance(sidLc); } catch (_) { bal = 0; }
    return {
      totalBills    : (typeof PS.getAllPurchases === 'function' ? PS.getAllPurchases() : []).filter(function(p) {
        return !p._deleted && (_lc(p.supplierId || '') === sidLc || _lc(p.supplierName || '') === sidLc);
      }).length,
      outstandingRs : _r2(bal / 100),
    };
  }

  function getSupplierBalance(nameOrId) {
    var sup = _findSup(nameOrId);
    var supplierId = _lc(sup && (sup.id || sup.n) || nameOrId);
    var bal = 0;
    try { bal = PS.getLedgerBalance(supplierId); } catch (_) { bal = 0; }
    return _r2(bal / 100);
  }

  global.addSupplier       = addSupplier;
  global.editSupplier      = editSupplier;
  global.getSupplierLedger = getSupplierLedger;

  if (typeof global.getSupplierBalance !== 'function' ||
      !global.getSupplierBalance.__isLedgerDelegate) {
    getSupplierBalance.__isLedgerDelegate = true;
    global.getSupplierBalance = getSupplierBalance;
  }
  global.writeManualAdjustment = writeManualAdjustment;

  global.PurchaseState.syncToGlobals = function syncToGlobalsRemoved() {
    console.error(
      '[PurchaseBridge] syncToGlobals() has been removed. ' +
      'All data access must go through ERP.getState(). ' +
      'Remove this call site.',
      new Error().stack
    );
  };

  global.PurchaseBridge = Object.freeze({
    addSupplier            : addSupplier,
    editSupplier           : editSupplier,
    getSupplierLedger      : getSupplierLedger,
    getSupplierBalance     : getSupplierBalance,
    writeManualAdjustment  : writeManualAdjustment,
    reconcileSupplier      : reconcileSupplier,
    reconcileAll           : reconcileAll,
    diagnoseMismatches     : diagnoseMismatches,
    repairSupplierMismatch : repairSupplierMismatch,
    getPurchaseSummaryForSales : getPurchaseSummaryForSales,
    syncToERPState         : _syncPurchaseStateToERPState,
  });

  function _syncPurchaseStateToERPState() {
    try {
      if (!global.ERP || typeof global.ERP.setState !== 'function') return;
      var ps = global.PurchaseState;
      if (!ps) return;
      global.ERP.setState(function(draft) {
        if (!draft.data) draft.data = {};
        draft.data.purchases       = ps.getAllPurchases      ? ps.getAllPurchases()       : (draft.data.purchases || []);
        draft.data.purchaseOrders  = ps.getAllPurchaseOrders ? ps.getAllPurchaseOrders()  : (draft.data.purchaseOrders || []);
        draft.data.purchaseReturns = ps.getAllReturns        ? ps.getAllReturns()         : (draft.data.purchaseReturns || []);
        draft.data.payOut          = ps.getAllPayments       ? ps.getAllPayments()        : (draft.data.payOut || []);
      }, 'purchase_bridge:sync');
    } catch(e) { console.warn('[PurchaseBridge] _syncPurchaseStateToERPState failed:', e.message); }
  }

  function _retryGLBacklog() {
    var k = 'erp_p5_retry_failed';
    var bl = [];
    try { bl = JSON.parse(localStorage.getItem(k) || '[]'); } catch(_) { bl = []; }
    if (!bl.length) return;
    console.warn('[PurchaseBridge] GL backlog: retrying', bl.length, 'queued GL entries');
    if (typeof showToast === 'function') {
      showToast('⚠️ ' + bl.length + ' GL posting(s) pending — retrying…', 'warning', 5000);
    }
    var remaining = [];
    var promises = [];
    bl.forEach(function(entry) {
      if (!global.ERP || !global.ERP.PostingEngine) {
        remaining.push(entry);
        return;
      }
      if (entry._isReversal === true) {
        if (typeof global.ERP.PostingEngine.reverse === 'function') {
          var p = global.ERP.PostingEngine.reverse(entry.documentId, {
            reason: entry.reason || ('Purchase return deleted (retry): ' + entry.returnId),
            actor : entry.actor  || 'system',
          }).catch(function(e) {
            console.error('[PurchaseBridge] GL reversal retry failed for', entry.returnId, e && e.message);
            remaining.push(entry);
          });
          promises.push(p);
        } else {
          remaining.push(entry);
        }
      } else {
        var entryId   = entry.id;
        var entryType = entry.type || 'bill';
        var PS2 = global.PurchaseState;
        if (!PS2) { remaining.push(entry); return; }
        if (entryType === 'payment') {
          var pmt = typeof PS2.getAllPayments === 'function'
            ? PS2.getAllPayments().find(function(p){ return p.id === entryId; })
            : null;
          if (pmt && typeof global.ERP.PostingEngine.post === 'function') {
            var pp = global.ERP.PostingEngine.post(pmt).catch(function(e) {
              console.error('[PurchaseBridge] GL backlog retry failed for payment', entryId, e && e.message);
              remaining.push(entry);
            });
            promises.push(pp);
          } else {
            remaining.push(entry);
          }
        } else {
          var bill = typeof PS2.getAllPurchases === 'function'
            ? PS2.getAllPurchases().find(function(b){ return b.id === entryId; })
            : null;
          if (bill && typeof global.ERP.PostingEngine.post === 'function') {
            var bp = global.ERP.PostingEngine.post(bill).catch(function(e) {
              console.error('[PurchaseBridge] GL backlog retry failed for', entryId, e && e.message);
              remaining.push(entry);
            });
            promises.push(bp);
          } else {
            remaining.push(entry);
          }
        }
      }
    });
    Promise.all(promises).then(function() {
      try { localStorage.setItem(k, JSON.stringify(remaining)); } catch(_) {}
    });
  }

  function _retryPayInGLBacklog() {

  }

  function _retryCashRefundGLBacklog() {
    var k = 'erp_cashrefund_gl_pending';
    var queue = [];
    try { queue = JSON.parse(localStorage.getItem(k) || '[]'); } catch(_) { queue = []; }
    if (!queue.length) return;
    console.warn('[PurchaseBridge] Cash Refund GL backlog: retrying', queue.length, 'queued entries');
    if (typeof showToast === 'function') {
      showToast('⚠️ ' + queue.length + ' Cash Refund GL posting(s) pending — retrying…', 'warning', 5000);
    }
    var remaining = [];
    var promises = [];
    queue.forEach(function(entry) {
      if (!global.ERP || !global.ERP.Ledger || !global.ERP.Ledger.VendorLedger ||
          typeof global.ERP.Ledger.VendorLedger.postCashRefund !== 'function') {
        remaining.push(entry);
        return;
      }
      var p = global.ERP.Ledger.VendorLedger.postCashRefund({
        sourceId    : entry.sourceId,
        party       : entry.party,
        amountPaisa : entry.amountPaisa,
        mode        : entry.mode || 'Cash Refund',
        date        : entry.date,
        reference   : entry.sourceId,
        memo        : 'Sale return cash refund (retry): ' + entry.party + ' — ' + entry.sourceId,
      }, 'system').catch(function(e) {
        console.error('[PurchaseBridge] Cash Refund GL retry failed for', entry.sourceId, e && e.message);
        remaining.push(entry);
      });
      promises.push(p);
    });
    Promise.all(promises).then(function() {
      try { localStorage.setItem(k, JSON.stringify(remaining)); } catch(_) {}
    });
  }

  function _retryPOGLBacklog() {

  }

  if (typeof window !== 'undefined') {
    var _prevBridgeHook = typeof window.onModuleLoginSuccess === 'function'
      ? window.onModuleLoginSuccess : null;
    window.onModuleLoginSuccess = function () {
      if (_prevBridgeHook) { try { _prevBridgeHook(); } catch (_e) {} }
      var _loginHookAttempts = 0;
      var _loginHookMaxMs    = 15000;
      var _loginHookInterval = 200;
      var _loginHookTimer = null;
      function _runLoginHook() {
        try {
          var psReady = global.PurchaseState && typeof global.PurchaseState.getAllPurchases === 'function';
          if (!psReady && _loginHookAttempts * _loginHookInterval < _loginHookMaxMs) {
            _loginHookAttempts++;
            _loginHookTimer = setTimeout(_runLoginHook, _loginHookInterval);
            return;
          }
          try {
          if (global.PurchaseState && global.PurchaseState.PurchaseInventory &&
              !global.PurchaseState.PurchaseInventory._impl) {
            global.PurchaseState.PurchaseInventory.register({
              addBatch: function(opts) {
                return (global.ERP && global.ERP.inventory && typeof global.ERP.inventory.addBatch === 'function')
                  ? global.ERP.inventory.addBatch(opts)
                  : { ok: false, error: 'ERP.inventory not ready' };
              },
              increaseStock: function(itemId, qty, batchInfo) {
                return (global.ERP && global.ERP.inventory && typeof global.ERP.inventory.addBatch === 'function')
                  ? global.ERP.inventory.addBatch({
                      bc: itemId,
                      qty: qty,
                      costPerUnit: (batchInfo && batchInfo.costPerUnit) || 0,
                      ref: (batchInfo && batchInfo.ref) || '',
                      skipGLBridge: (batchInfo && batchInfo.skipGLBridge) || false
                    })
                  : { ok: false, error: 'ERP.inventory not ready' };
              },
              decreaseStock: function(itemId, qty, opts) {
                if (!global.ERP || !global.ERP.InventoryService || typeof global.ERP.InventoryService.getAll !== 'function')
                  return { ok: false, error: 'ERP.InventoryService not ready' };
                var all = global.ERP.InventoryService.getAll();
                var item = all.find(function(i){ return _lc(i.n || i.name || '') === _lc(itemId) || i.bc === itemId; });
                if (!item) return { ok: false, error: 'Item "' + itemId + '" not found' };
                var bc = item.bc;
                if (!bc) return { ok: false, error: 'Barcode missing for "' + itemId + '"' };
                var docId = (opts && opts.ref) ? opts.ref + '-' + bc : 'pi-rollback-' + _lc(bc);
                return global.ERP.InventoryService.deduct(
                  [{ barcode: bc, qty: qty, unitCostPaisa: 0 }],
                  { sourceModule: 'purchase_inventory', documentId: docId, actor: 'system',
                    skipGLBridge: (opts && opts.skipGLBridge) || false }
                );
              },
              getItems: function() {
                return (global.ERP && global.ERP.InventoryService && typeof global.ERP.InventoryService.getAll === 'function')
                  ? global.ERP.InventoryService.getAll()
                  : [];
              },
            });
          }

          if (global.PurchaseState && typeof global.PurchaseState.setSyncToDB === 'function' && !global._purchaseDbSyncWired) {
            global._purchaseDbSyncWired = true;
            var _pdbSyncTimer = null;
            global.PurchaseState.setSyncToDB(function () {
              if (_pdbSyncTimer) clearTimeout(_pdbSyncTimer);
              _pdbSyncTimer = setTimeout(function () {
                _pdbSyncTimer = null;
                if (!global.ERP || !global.ERP.Persistence) return;
                var ps = global.PurchaseState;
                // ARCHITECTURAL REFACTOR: single choke point for all
                // IndexedDB writes.
                var _mirror = function (storeName, getterName) {
                  try {
                    var data = (typeof ps[getterName] === 'function') ? ps[getterName]() : null;
                    if (Array.isArray(data)) {
                      global.ERP.Persistence.save(storeName, data, { retries: 0, silent: true }).catch(function (e) {
                        console.warn('[PurchaseBridge] IDB mirror failed for', storeName, e);
                      });
                    }
                  } catch (e) { console.warn('[PurchaseBridge] IDB mirror error for', storeName, e); }
                };
                _mirror('purchases',       'getAllPurchases');
                _mirror('purchaseOrders',  'getAllPurchaseOrders');
                _mirror('purchaseReturns', 'getAllReturns');
                _mirror('payOut',          'getAllPayments');
              }, 1500);
            });
          }

          _syncPurchaseStateToERPState();

          (function _bulkSyncSupplierStats() {
            try {
              var ps  = global.PurchaseState;
              var erp = global.ERP;
              if (!ps || !erp || typeof erp.setState !== 'function') return;
              var sups = (erp.getState ? erp.getState().data.suppliers : null) || [];
              if (!sups.length) return;

              var changed = false;
              var updatedSups = sups.map(function(sup) {
                try {
                  var sidLc = _lc(sup.id || sup.n || sup.name || '');
                  if (!sidLc) return sup;

                  var owePaisa = 0;
                  try { owePaisa = ps.getLedgerBalance(sidLc); } catch (_) { owePaisa = 0; }
                  var owe = _r2(owePaisa / 100);

                  var totalPurchases = 0;
                  if (ps.getAllPurchases) {
                    var allP = ps.getAllPurchases();
                    totalPurchases = allP
                      .filter(function(p) {
                        return !p._deleted && (
                          _lc(p.supplierId || '') === sidLc || _lc(p.supplierName || '') === sidLc
                        );
                      })
                      .reduce(function(sum, p) { return sum + _num(p.total || p.grand || p.amt, 0); }, 0);
                  }

                  if (sup.owe !== owe || sup.purchases !== totalPurchases) {
                    changed = true;
                    return Object.assign({}, sup, {
                      owe: owe, bal: owe, balance: owe,
                      purchases: totalPurchases, totalPurchases: totalPurchases,
                    });
                  }
                } catch (_) {}
                return sup;
              });

              if (changed) {
                erp.setState(function(draft) {
                  if (!draft.data) draft.data = {};
                  draft.data.suppliers = updatedSups;
                }, 'purchase_bridge:supplier_stats_sync');
                if (erp.storage && typeof erp.storage.save === 'function') {
                  erp.storage.save('suppliers', updatedSups).catch(function(e) {
                    console.warn('[PurchaseBridge] bulk supplier sync persist failed:', e && e.message);
                  });
                }
              }
            } catch (e) {
              console.warn('[PurchaseBridge] _bulkSyncSupplierStats failed:', e.message);
            }
          }());

          _retryGLBacklog();
          _retryPayInGLBacklog();
          _retryCashRefundGLBacklog();
          _retryPOGLBacklog();

          var results = reconcileAll({ silent: true });
          var hadMismatches = results && results.some(function(r){ return !r.ok && typeof r.delta === 'number'; });
          if (hadMismatches) {
            _syncPurchaseStateToERPState();
          }
        } catch (e) { console.error('[PurchaseBridge] login hook:', e.message); }
        } catch (outerE) { console.error('[PurchaseBridge] login hook outer:', outerE.message); }
      }
      _loginHookTimer = setTimeout(_runLoginHook, 200);
    };
  }

  if (typeof window !== 'undefined' && window.DEBUG_MODE)
    console.log('[PurchaseBridge] ready | adjustBalance neutered | ledger-backed | reconciler armed | syncToGlobals removed');

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
