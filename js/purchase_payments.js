;(function (global) {
  'use strict';

  const _el  = (id) => document.getElementById(id);
  const _esc = (s) => {
    if (typeof escapeHtml === 'function') return escapeHtml(String(s ?? ''));
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  };
  const _num  = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  const _lc   = (s) => (s || '').toString().toLowerCase().trim().replace(/\s+/g, ' '); // FIX: collapse internal whitespace so 'Ali  Traders' and 'Ali Traders' resolve to the same supplier key instead of silently forking into two ledger rows
  const _fmt  = (n) => (typeof ERP !== 'undefined' && ERP.fmt) ? ERP.fmt(n) : Math.round(n).toLocaleString();
  const _fmtPrecise = (n) => {
    const r = Math.round((n || 0) * 100) / 100;
    return Number.isInteger(r) ? r.toLocaleString() : r.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const _today = () => {
    if (typeof global.ERP !== 'undefined' && global.ERP.DateUtils && typeof global.ERP.DateUtils.today === 'function')
      return global.ERP.DateUtils.today();
    const d = new Date();
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const pkTime = new Date(utc + (5 * 60 * 60000));
    return `${pkTime.getFullYear()}-${String(pkTime.getMonth() + 1).padStart(2, '0')}-${String(pkTime.getDate()).padStart(2, '0')}`;
  };
  const _toast = (msg, type = 'info', dur = 3500) => {
    try { showToast(msg, type, dur); } catch (_) { console.log(`[TOAST ${type}]`, msg); }
  };
  const _ps = () => global.PurchaseState || null;
  const _suppliers = () => {
    const s = (typeof ERP !== 'undefined' && ERP.getState) ? ERP.getState() : {};
    const d = s.data || s;
    return Array.isArray(d.suppliers) ? d.suppliers : [];
  };
  const _purchases = () => {
    const ps = _ps();
    if (ps && typeof ps.getAllPurchases === 'function') return ps.getAllPurchases();
    const s = (typeof ERP !== 'undefined' && ERP.getState) ? ERP.getState() : {};
    const d = s.data || s;
    return Array.isArray(d.purchases) ? d.purchases : [];
  };
  const _normSupKey = (s) => (s || '').toString().toLowerCase().trim().replace(/\s+/g, ' ');
  const _findExistingSupId = (name) => {
    const key = _normSupKey(name);
    if (!key) return null;
    const match = _suppliers().find(s => _normSupKey(s.n || s.name) === key);
    return match ? String(match.id) : null;
  };
  const _resolveSupId = (name) => {
    try {
      if (typeof ERP !== 'undefined' && ERP.parties && typeof ERP.parties.resolveSupplierId === 'function') {
        return ERP.parties.resolveSupplierId(name);
      }
    } catch (_) {}
    return _lc(name);
  };
  const _pendingPurchasesForSupplier = (supplierName) => {
    const trueId = _findExistingSupId(supplierName);
    const nameKey = _lc(supplierName);
    if (!trueId && !nameKey) return [];
    // NOTE: previously excluded purchases with workflow status 'complete'/'completed'. That field means
    // "stock received", not "fully paid" — a bill can be status=complete (stock already received) and
    // still have money owed on it. Filter on the actual remaining balance instead so every bill that
    // still has money owed shows up here, regardless of whether its stock was received.
    return _purchases().filter(p => {
      if (p._deleted) return false;
      const pSid = _lc(p.supplierId || '');
      const pName = _lc(p.supplierName || p.sup || '');
      const matches = (trueId && pSid === _lc(trueId)) || (!trueId && pName === nameKey) || (pSid && pSid === nameKey);
      if (!matches) return false;
      const st = (p.status || p.st || '').toLowerCase();
      if (st === 'cancelled' || st === 'returned') return false;
      const remainingPaisa = typeof p.remainingPaisa === 'number'
        ? p.remainingPaisa
        : Math.round(((p.total || p.amt || 0) - (p.paid || p.paidAmount || 0)) * 100);
      return remainingPaisa > 0;
    });
  };
  const _renderReferenceOptions = (supplierName) => {
    const refEl = _el('pom-reference');
    if (!refEl) return;
    const pending = _pendingPurchasesForSupplier(supplierName);
    refEl.innerHTML = '<option value="">— General payment —</option>' +
      pending.map(p =>
        `<option value="${_esc(p.id)}">${_esc(p.id)} — ${_esc(p.supplierName||p.sup||'')} (${_fmt(p.total||p.amt||0)})</option>`
      ).join('');
  };

  function _injectModal() {
    const existing = _el('paymentOutModal');
    if (existing) existing.remove();
    const sups = _suppliers();
    const supOpts = sups.map(s => `<option value="${_esc(s.n||s.name||'')}">${_esc(s.n||s.name||'')}${s.ph ? ' — '+_esc(s.ph) : ''}</option>`).join('');

    const div = document.createElement('div');
    div.innerHTML = `
<div id="paymentOutModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:var(--zi-modal-bg,1000);align-items:center;justify-content:center">
  <div style="background:var(--white,#fff);border-radius:12px;width:min(480px,96vw);max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.18)">
    <div style="padding:16px 20px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:16px;font-weight:700;color:var(--primary)">💸 Payment Out</div>
      <button onclick="closePurchasePaymentModal()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--gray-l);line-height:1">×</button>
    </div>
    <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
      <div>
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Supplier *</label>
        <select id="pom-supplier" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--white,#fff);outline:none">
          <option value="">— Select Supplier —</option>
          ${supOpts}
        </select>
      </div>
      <div>
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Amount (Rs.) *</label>
        <input id="pom-amount" type="number" min="1" step="1" placeholder="0" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:14px;font-weight:700;outline:none;box-sizing:border-box">
      </div>
      <div style="display:flex;gap:12px">
        <div style="flex:1">
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Date</label>
          <input id="pom-date" type="date" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;outline:none;box-sizing:border-box">
        </div>
        <div style="flex:1">
          <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Method</label>
          <select id="pom-method" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--white,#fff);outline:none">
            <option value="cash">Cash</option>
            <option value="bank">Bank Transfer</option>
            <option value="cheque">Cheque</option>
            <option value="upi">UPI</option>
          </select>
        </div>
      </div>
      <div>
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Against Bill (optional)</label>
        <select id="pom-reference" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--white,#fff);outline:none">
          <option value="">— General payment —</option>
        </select>
      </div>
      <div>
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Notes</label>
        <input id="pom-notes" type="text" maxlength="200" placeholder="Cheque no., bank ref..." style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;outline:none;box-sizing:border-box">
      </div>
      <div id="pom-balance-info" style="font-size:12px;color:var(--muted);min-height:18px"></div>
    </div>
    <div style="padding:12px 20px 18px;border-top:1px solid #f0f0f0;display:flex;gap:8px;justify-content:flex-end">
      <button onclick="closePurchasePaymentModal()" class="btn btn-ghost">Cancel</button>
      <button onclick="savePaymentOut()" class="btn btn-primary" style="padding:8px 24px">💾 Save Payment</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(div.firstElementChild);

    const supSel = _el('pom-supplier');
    if (supSel) supSel.addEventListener('change', () => { _updateBalanceInfo(); _renderReferenceOptions(supSel.value); });

    const dateEl = _el('pom-date');
    if (dateEl) dateEl.value = _today();
  }

  function _updateBalanceInfo() {
    const supName = (_el('pom-supplier')?.value || '').trim();
    const infoEl  = _el('pom-balance-info');
    if (!infoEl) return;
    if (!supName) { infoEl.textContent = ''; return; }
    const ps = _ps();
    if (ps && typeof ps.getLedgerBalance === 'function') {
      const balPaisa = ps.getLedgerBalance(_findExistingSupId(supName) || _lc(supName));
      const balRs = Math.round(balPaisa) / 100;
      infoEl.innerHTML = balRs > 0
        ? `<span style="color:var(--danger);font-weight:700">Outstanding: ${_fmt(balRs)}</span>`
        : balRs < 0
          ? `<span style="color:#1565c0;font-weight:700">&#128994; Advance Credit: ${_fmt(Math.abs(balRs))}</span>`
          : `<span style="color:#2e7d32;font-weight:700">✅ No outstanding balance</span>`;
    }
  }

  function openPaymentOutModal(supplierName) {
    _injectModal();
    const m = _el('paymentOutModal');
    if (!m) return;

    const dateEl = _el('pom-date');
    if (dateEl) dateEl.value = _today();
    const amtEl = _el('pom-amount');
    if (amtEl) amtEl.value = '';
    const notesEl = _el('pom-notes');
    if (notesEl) notesEl.value = '';
    const supSel = _el('pom-supplier');
    if (supSel) {
      const sups = _suppliers();
      supSel.innerHTML = '<option value="">— Select Supplier —</option>' +
        sups.map(s => `<option value="${_esc(s.n||s.name||'')}">${_esc(s.n||s.name||'')}${s.ph ? ' — '+_esc(s.ph) : ''}</option>`).join('');
      if (supplierName) {
        supSel.value = supplierName;
        if (supSel.value !== supplierName) {
          console.warn('[PurchasePayments] openPaymentOutModal: could not pre-select supplier "' + supplierName + '"');
          _toast('Supplier "' + supplierName + '" pre-select nahi ho saka', 'warning', 4000);
        }
      }
    }
    _updateBalanceInfo();
    _renderReferenceOptions(supSel ? supSel.value : '');

    m.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    setTimeout(() => { const a = _el('pom-amount'); if (a) a.focus(); }, 100);
  }

  // Opens the Payment Out modal pre-targeted at ONE specific purchase bill, so the payment is
  // guaranteed to apply to that bill instead of falling back to oldest-first FIFO across the supplier.
  // This is the fix for: "full payment ki phir bhi Partial dikhi" — paying via the generic Payment Out
  // screen without picking a bill applies FIFO to the oldest unpaid bill for that supplier, which can
  // leave the bill you actually meant to pay still showing Partial/Unpaid.
  function openPaymentOutModalForPO(poId) {
    const ps = _ps();
    const po = ps && typeof ps.getAllPurchases === 'function' ? ps.getAllPurchases().find(p => p.id === poId) : null;
    if (!po) { _toast('❌ Purchase ' + poId + ' not found', 'error'); return; }
    const supplierName = po.supplierName || po.sup || '';
    openPaymentOutModal(supplierName);
    setTimeout(() => {
      const refEl = _el('pom-reference');
      if (refEl) {
        _renderReferenceOptions(supplierName);
        refEl.value = poId;
      }
      const remainingPaisa = typeof po.remainingPaisa === 'number' ? po.remainingPaisa
        : Math.round(((po.total || po.amt || 0) - (po.paid || po.paidAmount || 0)) * 100);
      const amtEl = _el('pom-amount');
      if (amtEl && remainingPaisa > 0) amtEl.value = String(Math.round(remainingPaisa) / 100);
      const infoEl = _el('pom-balance-info');
      if (infoEl) {
        infoEl.innerHTML = '<span style="color:var(--primary,#4338CA);font-weight:700">Paying against bill ' + _esc(poId) +
          ' — outstanding on this bill: ' + _fmt(Math.round(remainingPaisa) / 100) + '</span>';
      }
    }, 60);
  }

  function closePurchasePaymentModal() {
    const m = _el('paymentOutModal');
    if (m) { m.style.display = 'none'; document.body.style.overflow = ''; }
  }

  function savePaymentOut() {
    try {
      const supplierName = (_el('pom-supplier')?.value || '').trim();
      if (!supplierName) { _toast('⚠️ Supplier is required', 'warning'); return; }

      const amount = _num(_el('pom-amount')?.value, 0);
      if (amount <= 0) { _toast('⚠️ Amount must be > 0', 'warning'); return; }

      const date = _el('pom-date')?.value || _today();
      const method = _el('pom-method')?.value || 'cash';
      const reference = _el('pom-reference')?.value || '';
      const notes = _el('pom-notes')?.value || '';

      const ps = _ps();
      if (!ps || typeof ps.addPayment !== 'function') {
        _toast('❌ PurchaseState not loaded', 'error'); return;
      }

      const supplierId = _resolveSupId(supplierName);

      if (typeof ps.getLedgerBalance === 'function') {
        const outstandingPaisa = ps.getLedgerBalance(supplierId);
        if (outstandingPaisa > 0) {
          const outstandingRs = outstandingPaisa / 100;
          if (amount > outstandingRs) {
            const advance = (amount - outstandingRs);
            if (!confirm('Outstanding balance is ' + _fmt(outstandingRs) + '. This payment of ' + _fmt(amount) +
                ' will create a supplier advance of ' + _fmt(advance) + '. Continue?')) {
              return;
            }
          }
        }
      }

      const payload = {
        supplierName,
        supplierId: supplierId,
        amount,
        date,
        method,
        reference,
        notes,
      };

      const r = ps.addPayment(payload);
      if (!r || !r.ok) { _toast('❌ Save failed: ' + (r?.error || 'unknown'), 'error'); return; }

      try {
        const pe = global.ERP?.PostingEngine || global.PostingEngine;
        if (pe && typeof pe.post === 'function') {
          const amtPaisa = Math.round(amount * 100);
          const _glAcc = (function(m) {
            m = (m || '').toLowerCase().trim();
            const isBankLike = m === 'bank' || m === 'bank transfer' || m.indexOf('bank') !== -1 || m === 'cheque' || m === 'check' || m === 'upi' || m === 'online';
            return isBankLike ? { id: 'acc-1002', desc: 'Bank Account' } : { id: 'acc-1001', desc: 'Cash in Hand' };
          })(method);
          const cashBankId   = _glAcc.id;
          const cashBankDesc = _glAcc.desc;
          pe.post({
            documentId   : r.id,
            documentType : 'PAYMENT_OUT',
            date         : date,
            description  : 'Payment Out: ' + r.id + ' to ' + supplierName + (reference ? ' (' + reference + ')' : ''),
            entries      : [
              { accountId: 'acc-2001', description: 'Accounts Payable', debit: amtPaisa, credit: 0 },
              { accountId: cashBankId, description: cashBankDesc,        debit: 0,        credit: amtPaisa }
            ]
          }).catch(function(glPostErr) {
            console.error('[savePaymentOut] GL post async rejection:', glPostErr && glPostErr.message || glPostErr);
          });
        }
      } catch (glErr) { console.error('[savePaymentOut] GL post error:', glErr); }

      try { if (global.PurchaseBridge?.syncToERPState) global.PurchaseBridge.syncToERPState(); } catch (_) {}
      try { document.dispatchEvent(new CustomEvent('purchase:data:changed', { detail: { id: r.id } })); } catch (_) {}

      try { if (typeof renderPurchases         === 'function') renderPurchases(); }         catch (_) {}
      try { if (typeof renderPurchaseLedger    === 'function') renderPurchaseLedger(); }     catch (_) {}
      try { if (typeof renderPaymentOutPage    === 'function') renderPaymentOutPage(); }     catch (_) {}
      try { if (typeof renderDashWidgets       === 'function') renderDashWidgets(); }        catch (_) {}

      closePurchasePaymentModal();
      _toast('✅ Payment saved: ' + r.id, 'success');
      return r.record;

    } catch (e) {
      console.error('[savePaymentOut]', e);
      _toast('❌ Payment save error: ' + e.message, 'error');
    }
  }

  function voidPaymentOut(id) {
    try {
      const ps = _ps();
      if (!ps) { _toast('❌ PurchaseState not loaded', 'error'); return; }
      const _voidConfirm = (window.ERP && window.ERP.confirmDialog) || function(msg, ok) { if (window.confirm(msg)) ok(); };
      _voidConfirm('Void payment ' + id + '? This will reverse the supplier ledger entry.', function() {
        (async function() {
          try {
            const r = ps.voidPayment(id);
            if (!r || !r.ok) { _toast('❌ Void failed: ' + (r?.error || 'unknown'), 'error'); return; }

            let glWarning = null;
            try {
              const pe = global.ERP?.PostingEngine || global.PostingEngine;
              if (pe && typeof pe.reverse === 'function') {
                const isPostedInMemory = typeof pe.isPosted === 'function' ? pe.isPosted(id) : true;
                const journalExists = !isPostedInMemory && typeof pe.journalExistsForSource === 'function'
                  ? pe.journalExistsForSource(id)
                  : isPostedInMemory;
                if (journalExists || isPostedInMemory) {
                  try {
                    await pe.reverse(id, { reason: 'Payment voided: ' + id, actor: 'system' });
                  } catch (glErr) {
                    if (!(glErr && glErr.message && glErr.message.includes('not found'))) {
                      console.error('[voidPaymentOut] GL reverse failed:', glErr && glErr.message);
                      glWarning = (glErr && glErr.message) || 'Unknown GL error';
                    }
                  }
                }
              }
            } catch (glErr) {
              console.error('[voidPaymentOut] GL reverse error:', glErr);
              glWarning = glErr && glErr.message;
            }

            try { if (global.PurchaseBridge?.syncToERPState) global.PurchaseBridge.syncToERPState(); } catch (_) {}
            try { if (typeof renderPaymentOutPage === 'function') renderPaymentOutPage(); } catch (_) {}

            if (glWarning) {
              _toast('⚠️ Payment ' + id + ' voided, but GL reversal failed (' + glWarning + '). Reconcile manually.', 'warning', 8000);
            } else {
              _toast('✅ Payment ' + id + ' voided', 'success');
            }
          } catch (e) {
            console.error('[voidPaymentOut]', e);
            _toast('❌ Void error: ' + e.message, 'error');
          }
        })();
      });
    } catch (e) {
      console.error('[voidPaymentOut outer]', e);
      _toast('❌ Void error: ' + e.message, 'error');
    }
  }

  function printPaymentOut(id) {
    try {
      const ps = _ps();
      const pmts = ps ? ps.getAllPayments() : [];
      const pmt  = pmts.find(p => p.id === id);
      if (!pmt) { _toast('❌ Payment not found', 'error'); return; }

      let bN = '';
      try {
        const _erpState = global.ERP && typeof global.ERP.getState === 'function' ? global.ERP.getState() : null;
        bN = (_erpState && (_erpState.bizName || (_erpState.data && _erpState.data.bizName))) || '';
        if (!bN) { const b = JSON.parse(localStorage.getItem('mh_biz_info') || '{}'); bN = b.name || ''; }
      } catch (_) {}
      if (!bN) bN = 'Business';

      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${_esc(id)}</title>
<style>body{font-family:Arial,sans-serif;padding:24px;font-size:13px;color:#222}
h2{margin:0 0 4px}p{margin:2px 0;color:var(--muted)}.row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #eee}
.lbl{color:#666}.val{font-weight:700}.total{font-size:16px;font-weight:800;color:var(--primary)}
@media print{.np{display:none}}</style></head><body>
<h2>${_esc(bN)}</h2>
<p style="color:var(--gray-l);font-size:12px">Payment Voucher</p>
<hr style="margin:12px 0">
<div class="row"><span class="lbl">Pay #</span><span class="val">${_esc(id)}</span></div>
<div class="row"><span class="lbl">Supplier</span><span class="val">${_esc(pmt.supplierName||pmt.supplierId||'—')}</span></div>
<div class="row"><span class="lbl">Date</span><span class="val">${_esc(pmt.date||'—')}</span></div>
<div class="row"><span class="lbl">Method</span><span class="val">${_esc(pmt.method||'Cash')}</span></div>
${pmt.reference ? `<div class="row"><span class="lbl">Against Bill</span><span class="val">${_esc(pmt.reference)}</span></div>` : ''}
${pmt.notes ? `<div class="row"><span class="lbl">Notes</span><span class="val">${_esc(pmt.notes)}</span></div>` : ''}
<div class="row" style="border-bottom:2px solid var(--primary);margin-top:6px"><span class="lbl total">Amount Paid</span><span class="val total">${_fmt(pmt.amount||0)}</span></div>
<div class="np" style="margin-top:20px;text-align:center">
<button onclick="window.print()" style="background:var(--primary);color:#fff;border:none;padding:9px 24px;border-radius:4px;font-size:14px;cursor:pointer;margin-right:8px">Print</button>
<button onclick="window.close()" style="background:#757575;color:#fff;border:none;padding:9px 24px;border-radius:4px;font-size:14px;cursor:pointer">Close</button>
</div></body></html>`;

      const pw = window.open('', '_blank', 'width=480,height=600');
      if (pw) { pw.document.write(html); pw.document.close(); setTimeout(() => { try { pw.print(); } catch (_) {} }, 500); }
    } catch (e) { console.warn('[printPaymentOut]', e); }
  }

  function _registerPurchaseService() {
    try {
      if (typeof ERP === 'undefined') return;
      if (ERP.PurchaseService) return;
      const ps = _ps();
      ERP.PurchaseService = Object.freeze({
        getAllPurchases  : () => ps ? ps.getAllPurchases()  : [],
        getAllPayments   : () => ps ? ps.getAllPayments()   : [],
        getAllReturns    : () => ps ? ps.getAllReturns()    : [],
        getAllOrders          : () => ps ? ps.getAllPurchaseOrders() : [],
        getAllPurchaseOrders  : () => ps ? ps.getAllPurchaseOrders() : [],
        addPurchase      : (p) => ps ? ps.addPurchase(p)   : { ok:false, error:'PurchaseState not loaded' },
        updatePurchase   : (id, patch) => ps ? ps.updatePurchase(id, patch) : { ok:false },
        addPayment       : (p) => ps ? ps.addPayment(p)    : { ok:false, error:'PurchaseState not loaded' },
        getLedgerBalance : (id) => ps ? ps.getLedgerBalance(id) : 0,
        runMigration     : (v) => { if (window.DEBUG_MODE) console.log('[PurchaseService] migration v' + v + ' — no-op'); },
      });
    } catch (e) { console.warn('[purchase_payments] _registerPurchaseService:', e.message); }
  }

  _registerPurchaseService();
  if (typeof window !== 'undefined') {
    const _prevHook = typeof window.onModuleLoginSuccess === 'function' ? window.onModuleLoginSuccess : null;
    window.onModuleLoginSuccess = function () {
      if (_prevHook) { try { _prevHook(); } catch (_e) {} }
      _registerPurchaseService();
    };
  }

  function renderPaymentOutPage() {
    const pv = _el('pv-payout');
    if (!pv) return;

    const ps       = _ps();
    const payments = ps ? ps.getAllPayments() : [];
    const active   = payments.filter(p => !p.voided);
    const total    = active.reduce((a, p) => a + (p.amount || 0), 0);
    const todayStr = _today();
    const todayAmt = active.filter(p => p.date === todayStr).reduce((a, p) => a + (p.amount || 0), 0);

    const rows = payments.length
      ? payments.map(p => {
          const voided = p.voided;
          const rowStyle = voided ? ' style="opacity:.5;text-decoration:line-through"' : '';
          const badge    = voided
            ? '<span style="background:var(--danger);color:#fff;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:700">VOID</span>'
            : '<span style="background:#e8f5e9;color:#2e7d32;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:700">Active</span>';
          const actions = !voided
            ? `<button class="btn btn-xs btn-ghost" onclick="if(typeof printPaymentOut==='function')printPaymentOut('${_esc(p.id)}')" title="Print">🖨</button> `
              + `<button class="btn btn-xs" style="background:var(--danger);color:#fff;border-color:var(--danger)" onclick="if(typeof voidPaymentOut==='function')voidPaymentOut('${_esc(p.id)}')" title="Void">Void</button>`
            : '—';
          return `<tr${rowStyle}>` +
            `<td style="font-weight:600;color:#0284c7">${_esc(p.id || '—')}</td>` +
            `<td>${_esc(p.supplierName || p.supplierId || '—')}</td>` +
            `<td style="font-weight:700">${_fmt(p.amount || 0)}</td>` +
            `<td>${_esc(p.method || 'Cash')}</td>` +
            `<td>${_esc(p.date || '—')}</td>` +
            `<td>${_esc(p.reference || '—')}</td>` +
            `<td>${_esc(p.notes || '—')}</td>` +
            `<td>${badge}</td>` +
            `<td style="white-space:nowrap">${actions}</td>` +
            `</tr>`;
        }).join('')
      : `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--muted)">` +
        `<div style="font-size:32px;opacity:.4;margin-bottom:10px">💸</div>` +
        `<div style="font-size:14px;font-weight:600">No supplier payments yet</div>` +
        `<div style="font-size:12px;margin-top:6px">Click "+ New Payment" to add one</div>` +
        `</td></tr>`;

    const filterFn = "(function(q){var t=document.getElementById('pv-payout');if(!t)return;var rows=t.querySelectorAll('tbody tr');var lq=(q||'').toLowerCase().trim();rows.forEach(function(r){r.style.display=lq===''||r.textContent.toLowerCase().includes(lq)?'':'none';});}).call(this,this.value)";

    pv.innerHTML =
      window.renderStatCards([
        { icon:'💰', value:`${_fmt(total)}`,    label:'Total Paid Out',   color:'#7c3aed', bg:'#f5f3ff' },
        { icon:'🧾', value:active.length,           label:'Active Payments', color:'#4338CA', bg:'#eff6ff' },
        { icon:'📅', value:`${_fmt(todayAmt)}`, label:'Today',            color:'#d97706', bg:'#fffbeb' },
      ]) +
      `<div class="toolbar">` +
        `<div class="search-box"><svg><use href="#ic-search"/></svg><input id="search-sup-payouts" name="search-sup-payouts" placeholder="Search payments…" oninput="${filterFn}"></div>` +
        `<button class="btn btn-sm" style="background:#0284c7;color:#fff;border-color:#0284c7;font-weight:700" onclick="if(typeof openPaymentOutModal==='function')openPaymentOutModal()"><svg><use href="#ic-plus"/></svg> New Payment</button>` +
      `</div>` +
      `<div class="panel"><table class="dt"><thead><tr>` +
        `<th>Pay #</th><th>Supplier</th><th>Amount</th><th>Method</th><th>Date</th><th>Reference</th><th>Notes</th><th>Status</th><th></th>` +
      `</tr></thead><tbody id="pout-tbody">${rows}</tbody></table></div>`;
  }

  function deletePaymentOut(id) {
    try {
      const ps = _ps();
      if (!ps) { _toast('❌ PurchaseState not loaded', 'error'); return; }
      const pmt = (ps.getAllPayments ? ps.getAllPayments() : []).find(p => p.id === id);
      if (!pmt) { _toast('❌ Payment not found', 'error'); return; }
      if (pmt.voided) { _toast('Voided payments cannot be deleted', 'warning'); return; }
      const _delConfirm = (window.ERP && window.ERP.confirmDialog) || function(msg, ok) { if (window.confirm(msg)) ok(); };
      _delConfirm('Delete payment ' + id + '? This cannot be undone.', function() {
        try {
          const pe = global.ERP?.PostingEngine || global.PostingEngine;
          const glDocId = id;
          const _doRemove = function() {
            if (typeof ps.removePayment !== 'function') {
              _toast('❌ Delete not supported: PurchaseState has no removePayment() method', 'error');
              return;
            }
            const r = ps.removePayment(id);
            if (!r || !r.ok) { _toast('❌ Delete failed: ' + (r?.error || 'unknown'), 'error'); return; }
            try { if (typeof renderPaymentOutPage === 'function') renderPaymentOutPage(); } catch (_) {}
            try { if (global.PurchaseBridge?.syncToERPState) global.PurchaseBridge.syncToERPState(); } catch (_) {}
            _toast('Payment ' + id + ' deleted', 'success');
          };
          if (pe && typeof pe.isPosted === 'function' && pe.isPosted(glDocId)) {
            pe.reverse(glDocId, { reason: 'Payment deleted: ' + id, actor: 'system' })
              .then(_doRemove)
              .catch(function(e) { _toast('Delete failed — GL error: ' + (e && e.message || 'unknown'), 'error'); });
          } else {
            _doRemove();
          }
        } catch (e) { _toast('❌ Delete error: ' + e.message, 'error'); }
      });
    } catch (e) { console.warn('[deletePaymentOut]', e); }
  }

  function viewPaymentOut(id) {
    try {
      const ps = _ps();
      const pmt = (ps && ps.getAllPayments ? ps.getAllPayments() : []).find(p => p.id === id);
      if (!pmt) { _toast('❌ Payment not found', 'error'); return; }
      const _esc2 = function(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
      const html = '<div style="font-family:Segoe UI,Arial,sans-serif;padding:24px;max-width:440px">' +
        '<div style="font-size:18px;font-weight:800;color:var(--primary);margin-bottom:16px">💳 Payment — ' + _esc2(id) + '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px">' +
        '<div><div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:2px">SUPPLIER</div><div style="font-weight:600">' + _esc2(pmt.supplierName || pmt.supplierId || '—') + '</div></div>' +
        '<div><div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:2px">DATE</div><div>' + _esc2(pmt.date || '—') + '</div></div>' +
        '<div><div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:2px">METHOD</div><div>' + _esc2(pmt.method || 'Cash') + '</div></div>' +
        '<div><div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:2px">AMOUNT</div><div style="font-weight:800;color:var(--primary);font-size:15px">' + _fmt(pmt.amount || 0) + '</div></div>' +
        (pmt.reference ? '<div><div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:2px">AGAINST BILL</div><div>' + _esc2(pmt.reference) + '</div></div>' : '') +
        (pmt.notes ? '<div style="grid-column:1/-1"><div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:2px">NOTES</div><div>' + _esc2(pmt.notes) + '</div></div>' : '') +
        (pmt.voided ? '<div style="grid-column:1/-1"><span style="background:var(--danger);color:#fff;border-radius:4px;padding:2px 10px;font-size:11px;font-weight:700">VOIDED</span></div>' : '') +
        '</div></div>';
      const old = document.getElementById('payViewBg');
      if (old) old.remove();
      const wrap = document.createElement('div');
      wrap.id = 'payViewBg';
      wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1100;display:flex;align-items:center;justify-content:center';
      wrap.innerHTML = '<div style="background:#fff;border-radius:12px;width:min(480px,96vw);max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.18)">' +
        html +
        '<div style="padding:12px 24px;border-top:1px solid #f0f0f0;text-align:right">' +
        '<button onclick="document.getElementById(\'payViewBg\').remove()" style="background:var(--primary);color:#fff;border:none;border-radius:6px;padding:8px 20px;font-size:13px;font-weight:700;cursor:pointer">Close</button>' +
        '</div></div>';
      wrap.addEventListener('click', function(e) { if (e.target === wrap) wrap.remove(); });
      document.body.appendChild(wrap);
    } catch (e) { console.warn('[viewPaymentOut]', e); }
  }

  global.openPaymentOutModal        = openPaymentOutModal;
  global.openPaymentOutModalForPO   = openPaymentOutModalForPO;
  global.closePurchasePaymentModal  = closePurchasePaymentModal;
  global.savePaymentOut             = savePaymentOut;
  global.voidPaymentOut             = voidPaymentOut;
  global.printPaymentOut            = printPaymentOut;
  global.deletePaymentOut           = deletePaymentOut;
  global.viewPaymentOut             = viewPaymentOut;
  global.renderPaymentOutPage       = renderPaymentOutPage;

  if (typeof ERP !== 'undefined' && typeof ERP.registerRenderer === 'function') {
    ERP.registerRenderer('payout', renderPaymentOutPage);
  } else {
    const _prevPayoutLogin = typeof window.onModuleLoginSuccess === 'function'
      ? window.onModuleLoginSuccess : null;
    window.onModuleLoginSuccess = function () {
      if (_prevPayoutLogin) { try { _prevPayoutLogin(); } catch (_e) {} }
      if (typeof ERP !== 'undefined' && typeof ERP.registerRenderer === 'function')
        ERP.registerRenderer('payout', renderPaymentOutPage);
    };
  }

  global.PurchasePayments = Object.freeze({
    openModal     : openPaymentOutModal,
    closeModal    : closePurchasePaymentModal,
    save          : savePaymentOut,
    voidPaymentOut: voidPaymentOut,
    print         : printPaymentOut,
    deletePayment : deletePaymentOut,
    view          : viewPaymentOut,
    render        : renderPaymentOutPage,
  });

  if (typeof window !== 'undefined' && window.DEBUG_MODE)
    console.log('[PurchasePayments] ready — openPaymentOutModal, savePaymentOut, PurchaseService registered');

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
