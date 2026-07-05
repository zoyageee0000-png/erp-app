;(function (global) {
  'use strict';

  const _PS = () => global.PurchaseState || null;

  const _calcLine = function(qty, price, discPct, taxPct) {
    const fn = global.PurchaseCalc && typeof global.PurchaseCalc.calcLineAmt === 'function'
      ? global.PurchaseCalc.calcLineAmt
      : null;
    if (fn) return fn(qty, price, discPct, taxPct);
    const base     = Math.round(qty * price * 100) / 100;
    const dAmt     = Math.round(base * (Math.max(0, Math.min(100, discPct)) / 100) * 100) / 100;
    const taxable  = Math.round((base - dAmt) * 100) / 100;
    const tAmt     = Math.round(taxable * (Math.max(0, taxPct) / 100) * 100) / 100;
    return { dAmt, tAmt, lineAmt: Math.round((taxable + tAmt) * 100) / 100 };
  };

  const _esc = (s) => {
    if (typeof escapeHtml === 'function') return escapeHtml(String(s ?? ''));
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  const _lc = (s) => (s || '').toString().toLowerCase().trim().replace(/\s+/g, ' '); // FIX: collapse internal whitespace so 'Ali  Traders' and 'Ali Traders' resolve to the same supplier key instead of silently forking into two ledger rows
  const _findInvItem = (invList, item) => {
    const code = (item.itemId || item.bc || item.barcode || '').toString().trim();
    if (code) {
      const byCode = invList.find(function(i) { return (i.bc || '').toString().trim() === code; });
      if (byCode) return byCode;
    }
    const itemName = (item.name || item.n || '').toString().toLowerCase().trim();
    if (!itemName) return null;
    return invList.find(function(i) { return (i.n || '').toLowerCase().trim() === itemName; }) || null;
  };

  const _unitCostFromItem = (it) => {
    const qty = Number(it.qty || it.q || 0);
    const net = (it.lineAmt != null) ? it.lineAmt : (it.amount != null ? it.amount : null);
    if (net != null && qty > 0) return net / qty;
    return Number(it.rate || it.price || it.p || 0);
  };

  const _escJs = (s) => _esc(String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
  const _num = (v, def = 0) => { const n = parseFloat(v); return isNaN(n) ? def : n; };
  const _today = () => {
    if (typeof ERP !== 'undefined' && ERP.DateUtils && typeof ERP.DateUtils.today === 'function')
      return ERP.DateUtils.today();
    const d = new Date();
    const offset = 5 * 60;
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const pkTime = new Date(utc + (offset * 60000));
    return `${pkTime.getFullYear()}-${String(pkTime.getMonth()+1).padStart(2,'0')}-${String(pkTime.getDate()).padStart(2,'0')}`;
  };

  const _purchases = () => {
    if (typeof global.PurchaseState !== 'undefined' && typeof global.PurchaseState.getAllPurchases === 'function')
      return global.PurchaseState.getAllPurchases();
    const s = (typeof global.ERP !== 'undefined' && global.ERP.getState) ? global.ERP.getState() : {};
    const d = s.data || s;
    if (Array.isArray(d.purchases) && d.purchases.length > 0) return d.purchases;
    return [];
  };

  const _suppliers = () => {
    const s = (typeof global.ERP !== 'undefined' && global.ERP.getState) ? global.ERP.getState() : {};
    const d = s.data || s;
    if (Array.isArray(d.suppliers) && d.suppliers.length > 0) return d.suppliers;
    return global.window?.suppliers || (typeof suppliers !== 'undefined' ? suppliers : []);
  };

  const _inventory = () => {
    if (typeof global.ERP !== 'undefined' && global.ERP.InventoryService && typeof global.ERP.InventoryService.getAll === 'function')
      return global.ERP.InventoryService.getAll();
    const s = (typeof global.ERP !== 'undefined' && global.ERP.getState) ? global.ERP.getState() : {};
    const d = s.data || s;
    if (Array.isArray(d.inventory) && d.inventory.length > 0) return d.inventory;
    return global.window?.inventory || (typeof inventory !== 'undefined' ? inventory : []);
  };

  const _toast = (msg, type = 'info', dur = 3500) => {
    try { showToast(msg, type, dur); } catch (_) { if(window.DEBUG_MODE) console.log(`[TOAST ${type}]`, msg); }
  };

  const _persist = () => {
    const ps = global.PurchaseState;
    if (!ps?.save) {
      console.error('[purchase.ui] _persist: PurchaseState not available');
      return;
    }
    const r = ps.save();
    if (r && !r.ok) {
      if (r.quota) _toast('Storage full! Please export and clear old data.', 'error');
      else console.error('[purchase.ui] PS.save() failed:', r.error);
    }
  };

  const _safe = (fn, label) => { try { fn(); } catch (e) { console.warn(`[purchase.ui] ${label}:`, e); } };

  const _el = (id) => document.getElementById(id);
  const _set = (id, v) => { const e = _el(id); if (e) e.value = v ?? ''; };
  const _txt = (id, v) => { const e = _el(id); if (e) e.textContent = v ?? ''; };
  function _purReturnSearch(q) {
    var t = document.getElementById('pv-purchasereturn');
    if (!t) return;
    var lq = (q || '').toLowerCase().trim();
    t.querySelectorAll('tbody tr').forEach(function(r) {
      r.style.display = lq === '' || r.textContent.toLowerCase().includes(lq) ? '' : 'none';
    });
  }

    const _fmt = (n) => {
    if (typeof n !== 'number' || isNaN(n)) return '0';
    if (ERP && ERP.fmt) return ERP.fmt(n);
    return Math.round(n).toLocaleString();
  };

  let _pmRowN = 0;
  let _pmGrand = 0;
  let _escKeyHandler = null;
  let _clickOutHandler = null;

  const _showLoader = (msg = 'Processing...') => {
    let overlay = _el('pur-loading-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'pur-loading-overlay';
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.45);z-index:var(--zi-spinner,1035);display:flex;align-items:center;justify-content:center;';
      overlay.innerHTML = '<div style="background:var(--white,#fff);border-radius:12px;padding:24px 32px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.2)">' +
        '<div style="font-size:28px;margin-bottom:8px">&#9203;</div>' +
        '<div id="pur-loading-msg" style="font-size:14px;color:var(--muted)">' + _esc(msg) + '</div>' +
        '</div>';
      document.body.appendChild(overlay);
    } else {
      const msgEl = _el('pur-loading-msg');
      if (msgEl) msgEl.textContent = msg;
      overlay.style.display = 'flex';
    }
  };

  const _hideLoader = () => {
    const overlay = _el('pur-loading-overlay');
    if (overlay) overlay.style.display = 'none';
  };

  function _injectPurModal() {
    if (_el('purModal')) return;
    const states = ['Punjab','Sindh','KPK','Balochistan','Islamabad','AJK','GB'];
    const stateOpts = '<option value="">&#8212; Select &#8212;</option>' + states.map(s => `<option value="${_esc(s)}">${_esc(s)}</option>`).join('');
    const div = document.createElement('div');
    div.innerHTML = `
<div id="purModal" style="display:none;position:fixed;inset:0;z-index:var(--zi-modal-bg,1000);background:rgba(0,0,0,.5);align-items:flex-start;justify-content:center;overflow-y:auto;padding:20px 0">
  <div style="background:var(--white,#fff);border-radius:12px;width:98vw;max-width:1200px;margin:auto;position:relative;box-shadow:0 8px 40px rgba(0,0,0,.18)">
    <div style="background:linear-gradient(135deg,var(--primary),var(--primary-d));padding:14px 20px;border-radius:12px 12px 0 0;display:flex;align-items:center;justify-content:space-between">
      <div style="color:#fff;font-size:16px;font-weight:700">&#128230; New Purchase</div>
      <button onclick="closePurModal()" style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:6px;width:28px;height:28px;cursor:pointer;font-size:16px;line-height:1">&#10005;</button>
    </div>
    <div style="padding:14px 20px;border-bottom:1px solid #f0f0f0;display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr;gap:10px;align-items:end;flex-wrap:wrap">
      <div>
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Supplier *</label>
        <select id="pm-party-sel" onchange="pmOnPartySelect(this)" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:7px 10px;font-size:13px;background:var(--white,#fff);outline:none"></select>
        <input id="pm-party" type="hidden">
        <span id="pm-bal" style="font-size:11px;color:var(--gray-l);display:block;margin-top:3px"></span>
      </div>
      <div>
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Phone</label>
        <input id="pm-phone" type="text" maxlength="20" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:7px 10px;font-size:13px;outline:none;box-sizing:border-box">
      </div>
      <div>
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Date *</label>
        <input id="pm-date" type="date" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:7px 10px;font-size:13px;outline:none;box-sizing:border-box">
      </div>
      <div>
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Bill No</label>
        <input id="pm-billno" type="text" maxlength="50" placeholder="Optional" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:7px 10px;font-size:13px;outline:none;box-sizing:border-box">
      </div>
      <div>
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">State</label>
        <select id="pm-state" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:7px 10px;font-size:13px;background:var(--white,#fff);outline:none">${stateOpts}</select>
      </div>
      <div>
        <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Notes</label>
        <input id="pm-desc" type="text" maxlength="200" placeholder="Paid / Credit..." style="width:100%;border:1px solid var(--border);border-radius:6px;padding:7px 10px;font-size:13px;outline:none;box-sizing:border-box">
      </div>
    </div>
    <div style="overflow-x:auto;padding:0 8px">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:var(--bg);border-bottom:2px solid var(--border)">
            <th style="padding:8px 6px 8px 20px;text-align:center;width:32px;color:var(--gray-l);font-size:11px">#</th>
            <th style="padding:8px 6px;text-align:left;min-width:200px">Item</th>
            <th style="padding:8px 6px;text-align:left;width:90px">Colour</th>
            <th style="padding:8px 6px;text-align:center;width:80px">Qty</th>
            <th style="padding:8px 6px;text-align:left;width:80px">Unit</th>
            <th style="padding:8px 6px;text-align:right;width:120px">Price</th>
            <th style="padding:8px 6px;text-align:right;width:60px">Disc%</th>
            <th style="padding:8px 6px;text-align:right;width:90px">Disc Amt</th>
            <th style="padding:8px 6px;text-align:left;width:130px">Tax</th>
            <th style="padding:8px 6px;text-align:right;width:90px">Tax Amt</th>
            <th style="padding:8px 6px;text-align:right;width:100px">Amount</th>
            <th style="padding:8px 6px;width:28px"></th>
          </tr>
        </thead>
        <tbody id="pm-tbody"></tbody>
      </table>
    </div>
    <datalist id="pm-inv-list"></datalist>
    <div style="padding:8px 20px">
      <button type="button" onclick="pmAddRow()" style="background:var(--hover-blue);color:var(--primary);border:1px solid var(--primary);border-radius:6px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer">+ Add Row</button>
    </div>
    <div style="border-top:1px solid #f0f0f0;padding:14px 20px;display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;justify-content:space-between">
      <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:center">
        <div style="font-size:12px;color:var(--muted)">Qty: <strong id="pm-total-qty">0</strong> &nbsp;|&nbsp; Sub-total: <strong id="pm-total-amt">0</strong></div>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
          <input id="pm-roundoff" type="checkbox" onchange="pmCalc()"> Round off
        </label>
        <input id="pm-roundoff-val" type="number" readonly value="0" style="width:70px;border:1px solid var(--border);border-radius:4px;padding:4px 6px;font-size:12px;background:var(--bg);text-align:right">
        <div style="font-size:14px;font-weight:700;color:var(--primary)">Total: Rs.<input id="pm-total-input" type="number" readonly value="0" style="width:90px;border:none;background:transparent;font-size:14px;font-weight:700;color:var(--primary);outline:none;text-align:left"></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
          <input id="pm-paid-chk" type="checkbox" onchange="pmTogglePaid()">
          <span style="font-weight:600">Paid</span>
          <input id="pm-paid-amt" type="number" value="0" min="0" oninput="pmCalc()" onblur="pmCalc(true)" style="width:110px;border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:13px;text-align:right;outline:none">
        </label>
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:11px;color:var(--muted)">Pay Type</label>
          <select id="pm-paytype" style="border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-size:12px;outline:none;background:var(--white,#fff)">
            <option>Cash</option><option>Bank</option><option>Cheque</option><option>UPI</option><option>Online</option>
          </select>
        </div>
        <div id="pm-balance" style="font-size:13px;font-weight:700;color:var(--danger);min-height:20px"></div>
      </div>
    </div>
    <div style="padding:12px 20px 16px;border-top:1px solid #f0f0f0;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;align-items:center">
      <button type="button" onclick="closePurModal()" class="btn btn-ghost">Cancel</button>
      <div style="position:relative">
        <button id="pm-share-arr" type="button" onclick="pmShareMenu()" class="btn btn-ghost" style="display:flex;align-items:center;gap:4px">Share &#9662;</button>
        <div id="pm-share-menu" style="display:none;position:absolute;right:0;bottom:110%;background:var(--white,#fff);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.1);min-width:160px;z-index:var(--zi-dropdown,400)">
          <div onclick="pmSaveAndShare()" style="padding:10px 14px;cursor:pointer;font-size:13px">&#128241; WhatsApp</div>
        </div>
      </div>
      <button id="pm-save-btn" type="button" onclick="typeof pmSave===\'function\'?pmSave():undefined" class="btn btn-primary" style="padding:8px 24px">&#128190; Save Purchase</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(div.firstElementChild);
  }

  let _pmSupRefreshFn = null;
  function _pmSupRefresh() {
    if (_pmSupRefreshFn) _pmSupRefreshFn();
  }

  function openPurModal(editIdx) {
    _injectPurModal();

    const existingModal = _el('purModal');
    if (existingModal && existingModal.style.display === 'flex') {
      closePurModal();
    }

    const pmPartySel = _el('pm-party-sel');
    if (pmPartySel) {
      const supOpts = _suppliers().map(s =>
        '<option value="' + _esc(s.n || '') + '">' + _esc(s.n || '') + (s.ph ? ' &#8212; ' + _esc(s.ph) : '') + '</option>'
      ).join('');
      pmPartySel.innerHTML =
        '<option value="">Search by Name *</option>' +
        '<option value="__add_supplier__" style="color:var(--primary);font-weight:700">+ Add New Supplier</option>' +
        supOpts;
      const savedParty = _el('pm-party');
      if (savedParty && savedParty.value) pmPartySel.value = savedParty.value;
    }

    _pmSupRefreshFn = function() {
      var freshSups = _suppliers();
      var sel2 = _el('pm-party-sel');
      if (!sel2) { try { if (ERP.events && ERP.events.off) ERP.events.off('suppliers:updated', _pmSupRefresh); } catch(_) {} return; }
      sel2.innerHTML =
        '<option value="">Search by Name *</option>' +
        '<option value="__add_supplier__" style="color:var(--primary);font-weight:700">+ Add New Supplier</option>' +
        freshSups.map(function(s){ return '<option value="' + _esc(s.n || '') + '">' + _esc(s.n || '') + (s.ph ? ' &#8212; ' + _esc(s.ph) : '') + '</option>'; }).join('');
      if (freshSups.length) {
        var latest = freshSups[freshSups.length - 1];
        sel2.value = latest.n || '';
        var hid2 = _el('pm-party'); if (hid2) hid2.value = latest.n || '';
        var phEl2 = _el('pm-phone'); if (phEl2) phEl2.value = latest.supplierPhone || latest.ph || '';
      }
    };
    try {
      if (ERP.events) {
        if (ERP.events.off) ERP.events.off('suppliers:updated', _pmSupRefresh);
        if (ERP.events.on)  ERP.events.on('suppliers:updated', _pmSupRefresh);
      }
    } catch (_) {}

    pmRefreshInvList();

    _set('pm-party', ''); _set('pm-phone', ''); _set('pm-desc', 'Paid');
    var _pSel = document.getElementById('pm-party-sel');
    if (_pSel && _pSel.value && _pSel.value !== '__add_supplier__') { _pSel.value = ''; }
    _set('pm-billno', '');
    const _defaultState = (() => {
      try {
        if (typeof ERP !== 'undefined' && ERP.getState) {
          const d = ERP.getState(); return (d && d.settings && d.settings.defaultState) || '';
        }
        const b = JSON.parse(localStorage.getItem('mh_biz_info') || '{}');
        return b.state || b.province || '';
      } catch (_) { return ''; }
    })();
    _set('pm-state', _defaultState);
    const dateEl = _el('pm-date'); if (dateEl) dateEl.value = _today();
    const roEl = _el('pm-roundoff'); if (roEl) roEl.checked = false;
    const roValEl = _el('pm-roundoff-val'); if (roValEl) roValEl.value = '0';
    const pcEl = _el('pm-paid-chk'); if (pcEl) pcEl.checked = false;
    _set('pm-paid-amt', '0'); _set('pm-paytype', 'Cash');
    _txt('pm-bal', '');
    _set('pm-total-input', '0');
    _txt('pm-total-qty', '0');
    _txt('pm-total-amt', '0');
    const balEl = _el('pm-balance'); if (balEl) { balEl.textContent = '0'; balEl.style.color = ''; }

    const tb = _el('pm-tbody');
    if (tb) tb.innerHTML = '';
    _pmRowN = 0; _pmGrand = 0;
    pmAddRow(); pmAddRow(); pmAddRow();
    pmCalc();

    if (editIdx !== undefined) {
      const pArr = _purchases();
      const po = pArr.find(p => p.id === String(editIdx));

      if (po) {
        _set('pm-party', (po.supplierName || po.sup) || '');
        const _editSel = _el('pm-party-sel');
        if (_editSel) { _editSel.value = (po.supplierName || po.sup) || ''; }
        _set('pm-phone', po.supplierPhone || po.ph || '');
        _set('pm-date', po.date || '');
        _set('pm-billno', po.billNo || '');
        _set('pm-state', po.stateOfSupply || po.state || '');
        _set('pm-desc', po.notes || '');
        _set('pm-paytype', po.payType || 'Cash');

        const _editPaidAmt = Math.max(0, Math.round((po.paid != null ? po.paid : (po.paidAmount || 0)) * 100) / 100);
        const _editPaidChk = _el('pm-paid-chk');
        if (_editPaidChk) _editPaidChk.checked = _editPaidAmt > 0;
        _set('pm-paid-amt', _editPaidAmt > 0 ? _editPaidAmt : 0);

        if (tb) tb.innerHTML = '';
        _pmRowN = 0;
        const iList = po.itemsList || po.items || [];
        let _editRowsBeforeAdd = 0;
        for (let ri = 0; ri < Math.max(3, iList.length); ri++) {
          pmAddRow();
          const rows = tb?.querySelectorAll('tr');
          if (rows && rows.length === _editRowsBeforeAdd) {

            console.error('[openPurModal] purchase ' + po.id + ' has more items than the 50-row edit limit — remaining items were not loaded into the form');
            _toast('\u26a0\ufe0f This purchase has more than 50 items — only the first 50 have been loaded', 'warning', 6000);
            break;
          }
          _editRowsBeforeAdd = rows ? rows.length : _editRowsBeforeAdd;
          const row = rows?.[rows.length - 1];
          const it = iList[ri];
          if (!it || !row) continue;
          const allTexts = row.querySelectorAll('input[type="text"]');
          const ni = allTexts[0];
          const nums = row.querySelectorAll('input[type="number"]');
          const sels = row.querySelectorAll('select');
          if (ni) ni.value = it.name || '';
          if (allTexts[1]) allTexts[1].value = it.colour || it.color || '';
          if (nums[0]) nums[0].value = it.qty || 1;
          if (sels[0]) sels[0].value = it.unit || 'NONE';
          if (nums[1]) nums[1].value = it.rate || it.price || 0;
          if (nums[2]) nums[2].value = it.discPct || 0;
          if (nums[3]) nums[3].value = it.discAmt || 0;
          if (sels[1]) sels[1].value = (it.taxPct !== undefined ? it.taxPct + ':' + (it.taxLabel || 'NONE') : '0:NONE');
        }
        global.window._editingPurId = po.id;
        pmCalc();
      }
    } else {
      global.window._editingPurId = undefined;
    }

    const m = _el('purModal');
    if (m) { m.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        var e = _el('pm-party-sel');
        if (e) e.focus();
      });
    });

    _attachModalListeners();
  }

  function _attachModalListeners() {
    _detachModalListeners();

    _escKeyHandler = function (e) {
      const modals = [
        { id: 'purModal', closeFn: closePurModal },
        { id: 'purchaseOrderModal', closeFn: () => { try { if (typeof closePurchaseOrderModal === 'function') closePurchaseOrderModal(); } catch (_) {} } },
        { id: 'purchReturnModalBg', closeFn: () => { try { closePurchaseReturnModal(); } catch (_) {} } },
        { id: 'paymentOutModal', closeFn: () => { try { if (typeof global.PurchasePayments !== 'undefined' && typeof global.PurchasePayments.closeModal === 'function') global.PurchasePayments.closeModal(); } catch (_) {} } },
      ];

      if (e.key === 'Escape') {
        for (const { id, closeFn } of modals) {
          const el = _el(id);
          if (el && (el.style.display === 'flex' || el.classList.contains('open'))) {
            e.preventDefault();
            e.stopPropagation();
            closeFn();
            return;
          }
        }
      }

      const m = _el('purModal');
      if (m && m.style.display === 'flex' && e.ctrlKey && e.key === 's') {
        e.preventDefault();
        e.stopPropagation();
        try { pmSave(); } catch (_) {}
      }
    };

    _clickOutHandler = function (e) {
      const menu = _el('pm-share-menu');
      const arr = _el('pm-share-arr');
      if (menu && arr && !arr.contains(e.target)) menu.style.display = 'none';
    };

    document.addEventListener('keydown', _escKeyHandler, true);
    document.addEventListener('click', _clickOutHandler);
  }

  function _detachModalListeners() {
    if (_escKeyHandler) { document.removeEventListener('keydown', _escKeyHandler, true); _escKeyHandler = null; }
    if (_clickOutHandler) { document.removeEventListener('click', _clickOutHandler); _clickOutHandler = null; }
  }

  function closePurModal() {
    const m = _el('purModal');
    if (m) { m.style.display = 'none'; document.body.style.overflow = ''; }
    const menu = _el('pm-share-menu');
    if (menu) menu.style.display = 'none';
    _detachModalListeners();
    _set('pm-party', ''); _set('pm-phone', ''); _set('pm-desc', '');
    _set('pm-billno', ''); _set('pm-state', '');
    const tb = _el('pm-tbody');
    if (tb) tb.innerHTML = '';
    _pmRowN = 0; _pmGrand = 0;
    global.window._editingPurId = undefined;
  }

  function _openInvFromPurchase(onSaved) {
    if (typeof ERP === 'undefined' || !ERP.inventory || typeof ERP.inventory.openAdd !== 'function') {
      _toast('Inventory module failed to load', 'error');
      return;
    }
    ERP.inventory.openAdd();

    var invBg = document.getElementById('invItemModal');
    if (invBg) {
      document.body.appendChild(invBg);
      invBg.style.zIndex = 'var(--zi-top,1200)';
    }
    if (typeof onSaved === 'function') {
      try {
        if (ERP && ERP.events) {
          var _savedHandler = function(data) {
            try { onSaved(data); } catch(_) {}
          };
          ERP.events.on('inventory:updated', _savedHandler);
          ERP.events.once('inventory:modalClosed', function() {
            ERP.events.off('inventory:updated', _savedHandler);
          });
        }
      } catch(_) {}
    }
  }

  function pmAddRow() {
    const tb = _el('pm-tbody');
    if (!tb) return;
    const currentRows = tb.querySelectorAll('tr').length;
    if (currentRows >= 50) { _toast('Maximum 50 items allowed per purchase', 'warning'); return; }
    _pmRowN++;
    const n = _pmRowN;
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #f0f0f0';

    const tdNum = document.createElement('td');
    tdNum.style.cssText = 'padding:6px 8px 6px 20px;color:#999;font-size:12px;text-align:center;width:32px';
    tdNum.textContent = n;

    const tdItem = document.createElement('td');
    tdItem.style.cssText = 'padding:3px 6px;min-width:180px';
    const niItem = document.createElement('input');
    niItem.type = 'text';
    niItem.setAttribute('list', 'pm-inv-list');
    niItem.placeholder = 'Item name...';
    niItem.autocomplete = 'off';
    niItem.maxLength = 200;
    niItem.style.cssText = 'width:100%;border:1px solid var(--border);border-radius:3px;padding:6px 8px;font-size:13px;outline:none;box-sizing:border-box';
    niItem.addEventListener('input', () => pmFillItemPrice(niItem));
    niItem.addEventListener('change', () => pmFillItemPrice(niItem));
    tdItem.appendChild(niItem);

    const tdColour = document.createElement('td');
    tdColour.style.cssText = 'padding:3px 6px;width:90px';
    const niColour = document.createElement('input');
    niColour.type = 'text';
    niColour.maxLength = 50;
    niColour.style.cssText = 'width:82px;border:1px solid var(--border);border-radius:3px;padding:6px 6px;font-size:12px;outline:none';
    tdColour.appendChild(niColour);

    const tdQty = document.createElement('td');
    tdQty.style.cssText = 'padding:3px 6px;width:80px';
    const niQty = document.createElement('input');
    niQty.type = 'number'; niQty.value = '1'; niQty.min = '0';
    niQty.style.cssText = 'width:72px;border:1px solid var(--border);border-radius:3px;padding:6px;text-align:center;font-size:13px;outline:none';
    niQty.addEventListener('input', pmCalc);
    niQty.addEventListener('change', pmCalc);
    tdQty.appendChild(niQty);

    const tdUnit = document.createElement('td');
    tdUnit.style.cssText = 'padding:3px 6px;width:80px';
    const selUnit = document.createElement('select');
    selUnit.style.cssText = 'width:72px;border:1px solid var(--border);border-radius:3px;padding:5px 3px;font-size:12px;outline:none;background:#fff';
    ['NONE','pcs','Box','Pac','Set','Ltr','Kg','Mtr'].forEach(u => {
      const o = document.createElement('option'); o.value = u; o.textContent = u; selUnit.appendChild(o);
    });
    selUnit.addEventListener('change', pmCalc);
    tdUnit.appendChild(selUnit);

    const tdPrice = document.createElement('td');
    tdPrice.style.cssText = 'padding:3px 6px;width:120px';
    const niPrice = document.createElement('input');
    niPrice.type = 'number'; niPrice.value = '0'; niPrice.min = '0';
    niPrice.style.cssText = 'width:110px;border:1px solid var(--border);border-radius:3px;padding:6px;text-align:right;font-size:13px;outline:none';
    niPrice.addEventListener('input', pmCalc);
    niPrice.addEventListener('change', pmCalc);
    tdPrice.appendChild(niPrice);

    const tdDiscPct = document.createElement('td');
    tdDiscPct.style.cssText = 'padding:3px 6px;width:60px';
    const niDiscPct = document.createElement('input');
    niDiscPct.type = 'number'; niDiscPct.value = '0'; niDiscPct.min = '0'; niDiscPct.max = '100';
    niDiscPct.style.cssText = 'width:54px;border:1px solid var(--border);border-radius:3px;padding:6px 4px;text-align:right;font-size:12px;outline:none';
    niDiscPct.addEventListener('input', pmCalc);
    niDiscPct.addEventListener('change', pmCalc);
    tdDiscPct.appendChild(niDiscPct);

    const tdDiscAmt = document.createElement('td');
    tdDiscAmt.style.cssText = 'padding:3px 6px;width:90px';
    const niDiscAmt = document.createElement('input');
    niDiscAmt.type = 'number'; niDiscAmt.value = '0'; niDiscAmt.readOnly = true;
    niDiscAmt.style.cssText = 'width:82px;border:1px solid var(--border);border-radius:3px;padding:6px;text-align:right;font-size:12px;background:#fafafa;outline:none';
    tdDiscAmt.appendChild(niDiscAmt);

    const tdTax = document.createElement('td');
    tdTax.style.cssText = 'padding:3px 6px;width:130px';
    const selTax = document.createElement('select');
    selTax.style.cssText = 'width:122px;border:1px solid var(--border);border-radius:3px;padding:5px 3px;font-size:11px;outline:none;background:#fff';
    [['0:NONE','NONE'],['5:GST@5%','GST@5%'],['10:GST@10%','GST@10%'],['17:GST@17%','GST@17%'],['18:GST@18%','GST@18%']].forEach(([v,l]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = l; selTax.appendChild(o);
    });
    selTax.addEventListener('change', pmCalc);
    tdTax.appendChild(selTax);

    const tdTaxAmt = document.createElement('td');
    tdTaxAmt.style.cssText = 'padding:3px 6px;width:90px';
    const niTaxAmt = document.createElement('input');
    niTaxAmt.type = 'number'; niTaxAmt.value = '0'; niTaxAmt.readOnly = true;
    niTaxAmt.style.cssText = 'width:82px;border:1px solid var(--border);border-radius:3px;padding:6px;text-align:right;font-size:12px;background:#fafafa;outline:none';
    tdTaxAmt.appendChild(niTaxAmt);

    const tdAmt = document.createElement('td');
    tdAmt.className = 'pm-row-amt';
    tdAmt.style.cssText = 'padding:6px 8px;text-align:right;font-size:13px;font-weight:600;color:#333;width:100px';
    tdAmt.textContent = '0';

    const tdDel = document.createElement('td');
    tdDel.style.cssText = 'padding:3px 4px;width:28px';
    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.title = 'Delete row';
    btnDel.style.cssText = 'width:22px;height:22px;background:#fff;border:1px solid var(--border);border-radius:3px;color:#999;cursor:pointer;font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center';
    btnDel.innerHTML = '&#10005;';
    btnDel.addEventListener('click', function () {
      tr.remove();
      pmUpdateRowNums();
      pmCalc();
    });
    tdDel.appendChild(btnDel);

    tr.append(tdNum, tdItem, tdColour, tdQty, tdUnit, tdPrice, tdDiscPct, tdDiscAmt, tdTax, tdTaxAmt, tdAmt, tdDel);
    tb.appendChild(tr);
    pmUpdateRowNums();
  }

  function pmUpdateRowNums() {
    document.querySelectorAll('#pm-tbody tr').forEach((r, i) => {
      const nc = r.querySelector('td:first-child');
      if (nc) nc.textContent = i + 1;
    });
    _pmRowN = document.querySelectorAll('#pm-tbody tr').length;
  }

  function pmFillItemPrice(inp) {
    try {
      const name = (inp.value || '').trim();
      if (!name) return;

      if (name === '_add_item_' || name === '+ Add Item to Inventory') {
        inp.value = '';
        var _targetRow = inp;
        _openInvFromPurchase(function() {
          pmRefreshInvList();
          var lnk = _targetRow.parentNode ? _targetRow.parentNode.querySelector('.pm-add-item-link') : null;
          if (lnk) lnk.remove();
        });
        return;
      }

      const inv = _inventory();
      const part = inv.find(p => p.n === name) ||
        inv.find(p => _lc(p.n) === _lc(name)) ||
        inv.find(p => p.bc === name);
      const row = inp.closest('tr');
      if (row) {
        const old = row.querySelector('.pm-add-item-link');
        if (old) old.remove();
        row.dataset.bc = part ? (part.bc || '') : '';
        if (part) {
          const allNums = row.querySelectorAll('input[type="number"]');
          const rateEl = allNums[1];
          if (rateEl && (!rateEl.value || rateEl.value === '0')) {
            const costPrice = _num(part.cp || part.pp || part.price, 0);
            if (costPrice > 0) {
              rateEl.value = costPrice;
              pmCalc();
            }
          }
        } else if (name) {
          const link = document.createElement('span');
          link.className = 'pm-add-item-link';
          link.style.cssText = 'font-size:10px;cursor:pointer;font-weight:700;display:inline-flex;align-items:center;gap:3px;padding:1px 7px;background:#e8f5e9;color:#2e7d32;border:1px solid #a5d6a7;border-radius:4px;margin-top:2px;white-space:nowrap';
          link.innerHTML = '&#10133; Add <b style="margin:0 2px">' + _esc(name) + '</b> to Inventory';
          link.addEventListener('click', function() {
            var _inp2 = inp;
            _openInvFromPurchase(function() {
              pmRefreshInvList();
              var lnk2 = _inp2.parentNode ? _inp2.parentNode.querySelector('.pm-add-item-link') : null;
              if (lnk2) lnk2.remove();
            });
          });
          inp.parentNode.appendChild(link);
        }
      }
      pmCalc();
    } catch (e) { console.warn('[pmFillItemPrice]', e); }
  }

  function pmOnPartySelect(sel) {
    try {
      const v = sel.value;

      if (v === '__add_supplier__') {
        sel.value = '';
        if (typeof ERP !== 'undefined' && ERP.parties && typeof ERP.parties.openAdd === 'function') {
          ERP.parties.openAdd('supplier');
          setTimeout(function() {
            var partyBg = document.getElementById('addPartyModal') ||
                          document.getElementById('addPartyModal-bg') ||
                          document.getElementById('apm-modal') ||
                          document.getElementById('party-modal-bg') ||
                          document.getElementById('party-add-modal');
            if (!partyBg) {
              var allOverlays = document.querySelectorAll('.modal-bg, .modal-overlay, [id*="arty"][id*="odal"]');
              allOverlays.forEach(function(m) {
                if (m.id !== 'purModal' && (m.classList.contains('open') || m.style.display === 'flex')) {
                  partyBg = m;
                }
              });
            }
            if (partyBg) {
              document.body.appendChild(partyBg);
              partyBg.style.zIndex = 'var(--zi-top,1200)';
            }
          }, 80);
          var _refreshOnce = function() {
            try {
              if (ERP.events && ERP.events.off) ERP.events.off('suppliers:updated', _refreshOnce);
              var freshSups = _suppliers();
              var sel2 = _el('pm-party-sel');
              if (sel2) {
                sel2.innerHTML = '<option value="">Search by Name *</option>' +
                  '<option value="__add_supplier__" style="color:var(--primary);font-weight:700">+ Add New Supplier</option>' +
                  freshSups.map(function(s){ return '<option value="' + _esc(s.n||'') + '">' + _esc(s.n||'') + (s.ph ? ' &#8212; ' + _esc(s.ph) : '') + '</option>'; }).join('');
                if (freshSups.length) { sel2.value = freshSups[freshSups.length - 1].n || ''; }
              }
              var hid = _el('pm-party');
              if (hid && freshSups.length) hid.value = freshSups[freshSups.length - 1].n || '';
              var phEl = _el('pm-phone');
              if (phEl && freshSups.length) phEl.value = freshSups[freshSups.length - 1].ph || '';
            } catch(_) {}
          };
          try { if (ERP.events && ERP.events.on) ERP.events.on('suppliers:updated', _refreshOnce); } catch(_) {}
        }
        return;
      }

      const hidden = _el('pm-party');
      if (hidden) hidden.value = v;

      const sups = _suppliers();
      const s = sups.find(x => _lc(x.n) === _lc(v));
      const ph = _el('pm-phone');
      const bal = _el('pm-bal');
      if (s) {
        if (ph) ph.value = s.ph || '';
        if (bal) {
          let owe = 0;
          try {
            const PS = _PS();
            if (PS && typeof PS.getLedgerBalance === 'function') {
              owe = PS.getLedgerBalance(s.id || _lc(s.n) || '') / 100;
            } else if (PS && typeof PS.getAllPurchases === 'function') {
              owe = PS.getAllPurchases()
                .filter(p => _lc(p.supplierName || p.sup || '') === _lc(s.n || ''))
                .reduce((sum, p) => sum + (_num(p.remainingPaisa, 0) / 100), 0);
            }
          } catch (_) { owe = _num(s.owe, 0); }
          bal.textContent = 'BAL: ' + _fmt(Math.abs(owe)) + (owe > 0 ? ' (Payable)' : owe < 0 ? ' (Receivable)' : '');
          bal.style.color = owe > 0 ? 'var(--danger)' : owe < 0 ? '#2e7d32' : '#888';
        }
      } else {
        if (ph) ph.value = '';
        if (bal) bal.textContent = '';
      }
    } catch(e) { console.warn('[pmOnPartySelect]', e); }
  }

  function pmFillPhone(inp) {
    try {
      const hidden = _el('pm-party');
      if (hidden && inp && inp.value !== undefined) hidden.value = inp.value || '';
      const sel = _el('pm-party-sel');
      if (sel && inp && inp.value) sel.value = inp.value;
      if (sel) pmOnPartySelect(sel);
    } catch(e) {}
  }

  function pmCalc(forceClamp) {
    try {
      let totalQty = 0, totalAmt = 0;

      const rows = document.querySelectorAll('#pm-tbody tr');
      for (let ri = 0; ri < rows.length; ri++) {
        const row = rows[ri];
        const ni = row.querySelector('input[type="text"]');
        const nums = row.querySelectorAll('input[type="number"]');
        const sels = row.querySelectorAll('select');
        const amtC = row.querySelector('.pm-row-amt');

        if (!ni || !ni.value.trim()) { if (amtC) amtC.textContent = '0'; continue; }

        const qty = Math.max(0, _num(nums[0]?.value, 0));
        const price = Math.max(0, _num(nums[1]?.value, 0));
        const discPct = Math.max(0, Math.min(100, _num(nums[2]?.value, 0)));
        const taxSel = sels[1];
        const taxVal = (taxSel && taxSel.value && taxSel.value.includes(':')) ? taxSel.value : '0:NONE';
        const taxPct = _num(taxVal.split(':')[0], 0);

        const { dAmt, tAmt, lineAmt } = _calcLine(qty, price, discPct, taxPct);

        if (nums[3]) nums[3].value = dAmt.toFixed(0);
        if (nums[4]) nums[4].value = tAmt.toFixed(0);
        if (amtC) amtC.textContent = _fmt(lineAmt);

        if (qty > 0) { totalQty += qty; totalAmt += lineAmt; }
      }

      _txt('pm-total-qty', _fmt(totalQty));
      _txt('pm-total-amt', _fmt(totalAmt));

      let grand = Math.round(totalAmt * 100) / 100;
      let roundOffVal = 0;
      const roChk = _el('pm-roundoff');
      if (roChk?.checked) {
        const rounded = Math.round(grand);
        roundOffVal = rounded - grand;
        grand = rounded;
      }
      const roEl = _el('pm-roundoff-val');
      if (roEl) roEl.value = Math.round(roundOffVal * 100) / 100;
      _pmGrand = grand;

      const ti = _el('pm-total-input');
      if (ti) ti.value = Math.round(grand);

      const pChk = _el('pm-paid-chk');
      const pAmt = _el('pm-paid-amt');

      if (pChk && pChk.checked && pAmt && document.activeElement !== pAmt && _num(pAmt.value, 0) === 0) {
        pAmt.value = Math.round(grand);
      }

      let paid = (pChk && !pChk.checked) ? 0 : _num(pAmt?.value, 0);
      if (paid > grand) { paid = grand; if (pAmt && (forceClamp || document.activeElement !== pAmt)) pAmt.value = Math.round(grand); }
      if (paid < 0) { paid = 0; if (pAmt && (forceClamp || document.activeElement !== pAmt)) pAmt.value = 0; }

      const bal = Math.max(0, Math.round((grand - paid) * 100) / 100);
      const balEl = _el('pm-balance');
      if (balEl) {
        if (grand <= 0) {
          balEl.textContent = '';
          balEl.style.color = '';
        } else if (paid >= grand) {
          balEl.textContent = 'Fully Paid';
          balEl.style.color = '#2e7d32';
        } else if (paid > 0) {
          balEl.textContent = '' + _fmt(bal) + ' baki';
          balEl.style.color = 'var(--danger)';
        } else {
          balEl.textContent = '' + _fmt(grand) + ' pending';
          balEl.style.color = 'var(--danger)';
        }
      }
    } catch (e) { console.warn('[pmCalc]', e); }
  }

  function pmTogglePaid() {
    const pChk = _el('pm-paid-chk');
    const pAmt = _el('pm-paid-amt');
    if (pChk && pAmt) { pAmt.value = pChk.checked ? Math.round(_pmGrand) : 0; pmCalc(); }
  }

  function pmShareMenu() {
    const m = _el('pm-share-menu');
    if (m) m.style.display = m.style.display === 'none' ? 'block' : 'none';
  }

  function pmRefreshInvList() {
    let dl = _el('pm-inv-list');
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = 'pm-inv-list';
      document.body.appendChild(dl);
    }
    const inv = _inventory();
    dl.innerHTML = '';
    const addOpt = document.createElement('option');
    addOpt.value = '_add_item_';
    addOpt.textContent = '+ Add Item to Inventory';
    dl.appendChild(addOpt);
    inv.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.n || '';
      opt.dataset.price = p.cp || 0;
      opt.textContent = p.n || '';
      dl.appendChild(opt);
    });
  }

  function pmPrint(po) {
    try {
      let bN = 'MH Autos';
      try { const b = JSON.parse(localStorage.getItem('mh_biz_info') || '{}'); bN = b.name || bN; } catch (_) {}

      const _printItems = po.itemsList || po.items || [];
      const _printBaseSubtotal = _printItems.reduce((s, it) => s + ((it.qty || 0) * (it.rate || it.price || 0)), 0);
      const _printDiscTotal = _printItems.reduce((s, it) => s + (it.discAmt || 0), 0);
      const _printTaxTotal = _printItems.reduce((s, it) => s + (it.taxAmt || 0), 0);

      const html =
        '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + _esc(po.id) + '</title>' +
        '<style>body{font-family:Arial,sans-serif;padding:20px;font-size:13px;color:#222}' +
        'h1{font-size:18px}table{width:100%;border-collapse:collapse;margin:12px 0}' +
        'th{background:var(--primary-d);color:#fff;padding:7px 10px;text-align:left;font-size:11px}' +
        'td{padding:6px 10px;border-bottom:1px solid #eee}' +
        '.tot{text-align:right;font-weight:700}.sr{display:flex;justify-content:space-between;padding:3px 0}' +
        '.box{background:var(--bg);border-radius:4px;padding:12px;width:240px;margin-left:auto;margin-top:12px}' +
        '@media print{.np{display:none}}</style></head><body>' +
        '<h1>' + _esc(bN) + '</h1><p style="color:#666">Purchase Order</p>' +
        '<table style="width:auto;border:none;margin:0"><tr><td style="border:none;padding:2px 0"><b>Supplier:</b></td><td style="border:none;padding:2px 8px">' + _esc(po.supplierName || po.sup || '') + '</td></tr>' +
        ((po.supplierPhone || po.ph) ? '<tr><td style="border:none;padding:2px 0">Phone:</td><td style="border:none;padding:2px 8px">' + _esc(po.supplierPhone || po.ph) + '</td></tr>' : '') +
        '<tr><td style="border:none;padding:2px 0">PO #</td><td style="border:none;padding:2px 8px">' + _esc(po.id || '') + '</td></tr>' +
        '<tr><td style="border:none;padding:2px 0">Date:</td><td style="border:none;padding:2px 8px">' + _esc(po.date || '') + '</td></tr></table>' +
        '<table><thead><tr><th>#</th><th>Item</th><th>Qty</th><th>Unit</th><th>Price</th><th>Disc</th><th>Tax</th><th>Amount</th></tr></thead><tbody>' +
        _printItems.map((it, i) =>
          '<tr><td>' + (i + 1) + '</td><td>' + _esc(it.name || '') + '</td><td>' + _esc(String(it.qty || 0)) + '</td><td>' + _esc(it.unit || 'pcs') + '</td>' +
          '<td>' + _fmt((it.rate || it.price || 0)) + '</td>' +
          '<td>' + _fmt((it.discAmt || 0)) + '</td>' +
          '<td>' + _fmt((it.taxAmt || 0)) + '</td>' +
          '<td class="tot">' + _fmt(_esc(Math.round(it.amount || it.lineAmt || (it.qty * (it.rate || it.price)) || 0))) + '</td></tr>'
        ).join('') + '</tbody></table>' +
        '<div class="box">' +
        '<div class="sr"><span>Subtotal</span><span>' + _fmt(Math.round(_printBaseSubtotal)) + '</span></div>' +
        '<div class="sr"><span>Discount</span><span style="color:var(--danger)">-' + _fmt(Math.round(_printDiscTotal)) + '</span></div>' +
        '<div class="sr"><span>Tax</span><span>' + _fmt(Math.round(_printTaxTotal)) + '</span></div>' +
        '<div class="sr" style="font-weight:800;font-size:15px;border-top:1px solid #ccc;margin-top:4px;padding-top:6px"><span>Total</span><span>' + _fmt(Math.round(po.total || po.amt || 0)) + '</span></div>' +
        '<div class="sr" style="color:#2e7d32"><span>Paid</span><span>' + _fmt(Math.round(po.paid || 0)) + '</span></div>' +
        '<div class="sr" style="color:var(--danger);font-weight:700"><span>Balance</span><span>' + _fmt(Math.round(po.balance || 0)) + '</span></div>' +
        '</div>' +
        '<div class="np" style="margin-top:20px;text-align:center">' +
        '<button onclick="window.print()" style="background:var(--primary-d);color:#fff;border:none;padding:9px 24px;border-radius:4px;font-size:14px;cursor:pointer;margin-right:8px">Print</button>' +
        '<button onclick="window.close()" style="background:#757575;color:#fff;border:none;padding:9px 24px;border-radius:4px;font-size:14px;cursor:pointer">Close</button>' +
        '</div></body></html>';

      const pw = global.window.open('', '_blank', 'width=900,height=700');
      if (pw) { pw.document.write(html); pw.document.close(); setTimeout(() => { try { pw.print(); } catch (_) {} }, 600); }
    } catch (e) { console.warn('[pmPrint]', e); }
  }

  function printPurchaseOrder(id) {
    try {
      if (typeof global.PurchaseOrders !== 'undefined' && typeof global.PurchaseOrders.printPO === 'function') {
        global.PurchaseOrders.printPO(id);
        return;
      }
      const po = _purchases().find(p => p.id === id);
      if (!po) { _toast('Purchase order not found', 'error'); return; }
      pmPrint(po);
    } catch (e) { console.warn('[printPurchaseOrder]', e); }
  }

  function viewPurchaseOrder(id) {
    try {
      const po = _purchases().find(p => p.id === id);
      if (!po) return;

      const stColor = (po.status || po.st) === 'complete' ? '#16a34a'
        : (po.status || po.st) === 'draft' ? 'var(--secondary-dark,#d97706)'
        : 'var(--info,#4338CA)';
      const stBg = (po.status || po.st) === 'complete' ? 'var(--success-light,#dcfce7)'
        : (po.status || po.st) === 'draft' ? 'var(--warning-light,#fef3c7)'
        : 'var(--blue-m,#dbeafe)';

      const _biz = (() => { try { return JSON.parse(localStorage.getItem('mh_biz_info') || '{}'); } catch (_) { return {}; } })();
      const bizName = _biz.name || 'MH Autos';
      const bizAddr = _biz.addr || '';
      const bizPhone = _biz.phone || '';
      const bizCity = _biz.city || '';
      const bizLogo = (() => { try { return global.window.bizLogo || ''; } catch (_) { return ''; } })();

      const logoHtml = bizLogo?.startsWith('data:')
        ? (bizLogo ? '<img src="' + _esc(bizLogo) + '" style="width:52px;height:52px;object-fit:contain;border-radius:8px" onerror="this.style.display=none">' : '')
        : '<div style="width:52px;height:52px;background:rgba(255,255,255,0.2);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:24px">&#128295;</div>';

      const itemsRows = (po.itemsList || po.items || []).map((item, i) => {
        const rowBg = i % 2 === 0 ? '#ffffff' : '#f0fdf4';
        const imgHtml = (item.image && typeof item.image === 'string' && item.image.startsWith('data:image/'))
          ? `<img src="${_esc(item.image)}" style="width:32px;height:32px;object-fit:cover;border-radius:6px;cursor:pointer" onclick="if(typeof viewPhoto===\'function\')viewPhoto(this.src)" onerror="this.style.display=\'none\'">`
          : '<div style="width:32px;height:32px;background:var(--bg,#f1f5f9);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:14px">&#128230;</div>';
        return '<tr style="background:' + rowBg + '">' +
          '<td style="padding:10px 8px;border-bottom:1px solid #f0fdf4">' + imgHtml + '</td>' +
          '<td style="padding:10px 8px;border-bottom:1px solid #f0fdf4;font-weight:600;color:var(--dark,#1e293b)">' + _esc(item.name || '') + '</td>' +
          '<td style="padding:10px 8px;border-bottom:1px solid #f0fdf4;text-align:center;color:var(--gray-dark,#475569)">' + _esc(String(item.qty || 0)) + '</td>' +
          '<td style="padding:10px 8px;border-bottom:1px solid #f0fdf4;text-align:right;color:var(--gray-dark,#475569)">' + _fmt((item.rate || item.price || 0)) + '</td>' +
          '<td style="padding:10px 8px;border-bottom:1px solid #f0fdf4;text-align:right;color:#dc2626">' + _fmt((item.discAmt || 0)) + '</td>' +
          '<td style="padding:10px 8px;border-bottom:1px solid #f0fdf4;text-align:right;color:#0284c7">' + _fmt((item.taxAmt || 0)) + '</td>' +
          '<td style="padding:10px 8px;border-bottom:1px solid #f0fdf4;text-align:right;font-weight:700;color:#0f4c3a">' + _fmt(_esc((item.amount || item.lineAmt || ((item.qty || 0) * (item.rate || item.price || 0))))) + '</td>' +
          '</tr>';
      }).join('') || '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--gray-light,#94a3b8)">No items</td></tr>';

      const poHTML = '<div style="font-family:Segoe UI,Inter,system-ui,Arial,sans-serif;max-width:800px;margin:0 auto;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,0.1);border-radius:16px;overflow:visible">' +
        '<div style="background:linear-gradient(135deg,#0f4c3a 0%,#059669 100%);padding:28px 32px;display:flex;justify-content:space-between;align-items:flex-start">' +
        '<div style="display:flex;align-items:center;gap:14px">' + logoHtml +
        '<div><div style="color:#fff;font-size:20px;font-weight:800">' + _esc(bizName) + '</div>' +
        '<div style="color:rgba(255,255,255,0.75);font-size:12px;margin-top:2px">' + _esc(bizAddr) + '</div>' +
        '<div style="color:rgba(255,255,255,0.75);font-size:12px">' + _esc(bizPhone) + '</div></div></div>' +
        '<div style="text-align:right">' +
        '<div style="color:#6ee7b7;font-size:26px;font-weight:900;letter-spacing:-1px">PURCHASE INVOICE</div>' +
        '<div style="color:#fff;font-size:15px;font-weight:700;margin-top:4px">#' + _esc(po.id || '') + '</div>' +
        '<div style="background:' + stBg + ';color:' + stColor + ';padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;margin-top:6px;display:inline-block">' + _esc((((po.status || po.st) || 'draft')).toUpperCase()) + '</div>' +
        '</div></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;background:#f0fdf4;border-bottom:2px solid #d1fae5">' +
        '<div style="padding:16px 20px;border-right:1px solid #d1fae5">' +
        '<div style="font-size:10px;font-weight:700;color:var(--muted,#64748b);letter-spacing:0.8px;margin-bottom:6px">SUPPLIER</div>' +
        '<div style="font-weight:700;color:var(--dark,#1e293b);font-size:14px">&#127981; ' + _esc(po.supplierName || po.sup || '') + '</div></div>' +
        '<div style="padding:16px 20px;border-right:1px solid #d1fae5">' +
        '<div style="font-size:10px;font-weight:700;color:var(--muted,#64748b);letter-spacing:0.8px;margin-bottom:6px">ORDER DATE</div>' +
        '<div style="font-weight:700;color:var(--dark,#1e293b)">&#128197; ' + _esc(po.date || '&#8212;') + '</div>' +
        '<div style="font-size:10px;font-weight:700;color:var(--muted,#64748b);letter-spacing:0.8px;margin:10px 0 6px">EXPECTED DELIVERY</div>' +
        '<div style="font-weight:600;color:#dc2626">&#9200; ' + _esc(po.expectedDate || po.due || 'TBD') + '</div></div>' +
        '<div style="padding:16px 20px">' +
        '<div style="font-size:10px;font-weight:700;color:var(--muted,#64748b);letter-spacing:0.8px;margin-bottom:6px">TOTAL ITEMS</div>' +
        '<div style="font-weight:700;color:var(--dark,#1e293b)">&#128230; ' + _esc(String(Array.isArray(po.itemsList) ? po.itemsList.length : Array.isArray(po.items) ? po.items.length : (po.items || 0))) + ' items</div>' +
        '</div></div></div>' +
        '<div style="padding:20px 24px">' +
        '<table style="width:100%;border-collapse:collapse">' +
        '<thead><tr style="background:linear-gradient(135deg,#0f4c3a,#059669)">' +
        '<th style="padding:12px 8px;color:#fff;text-align:left;font-size:11px">IMG</th>' +
        '<th style="padding:12px 8px;color:#fff;text-align:left;font-size:11px">ITEM / PART</th>' +
        '<th style="padding:12px 8px;color:#fff;text-align:center;font-size:11px">QTY</th>' +
        '<th style="padding:12px 8px;color:#fff;text-align:right;font-size:11px">UNIT COST</th>' +
        '<th style="padding:12px 8px;color:#fff;text-align:right;font-size:11px">DISC</th>' +
        '<th style="padding:12px 8px;color:#fff;text-align:right;font-size:11px">TAX</th>' +
        '<th style="padding:12px 8px;color:#fff;text-align:right;font-size:11px">TOTAL</th>' +
        '</tr></thead><tbody>' + itemsRows + '</tbody></table>' +
        '<div style="display:flex;justify-content:flex-end;margin-top:16px">' +
        '<div style="background:linear-gradient(135deg,#0f4c3a,#059669);border-radius:12px;padding:14px 20px;display:flex;align-items:center;gap:20px">' +
        '<span style="color:rgba(255,255,255,0.8);font-size:13px">Grand Total</span>' +
        '<span style="color:#6ee7b7;font-weight:800;font-size:20px">' + _fmt((po.total || po.amt || 0)) + '</span>' +
        '</div></div>' +
        '<div style="margin-top:20px;padding:16px;background:#f0fdf4;border-radius:12px;border:1px solid #d1fae5">' +
        '<div style="font-size:11px;font-weight:700;color:#0f4c3a;margin-bottom:8px">&#128203; TERMS & CONDITIONS</div>' +
        '<ul style="margin:0;padding-left:18px;color:var(--gray-dark,#475569);font-size:12px;line-height:1.8">' +
        '<li>Payment due within 30 days of delivery</li>' +
        '<li>Goods to be inspected upon receipt within 48 hours</li>' +
        '<li>Return/exchange subject to prior approval</li>' +
        '<li>Subject to ' + _esc(bizCity || 'local') + ' jurisdiction</li>' +
        '</ul></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:24px;padding-top:20px;border-top:1px solid var(--border,#e2e8f0)">' +
        ['Authorized By', 'Order Confirmed', 'Supplier Signature'].map(label =>
          '<div style="text-align:center">' +
          '<div style="height:48px;border-bottom:1px solid var(--gray-light,#94a3b8);margin-bottom:8px"></div>' +
          '<div style="font-size:11px;font-weight:700;color:var(--muted,#64748b)">' + _esc(label) + '</div>' +
          '<div style="font-size:10px;color:var(--gray-light,#94a3b8);margin-top:2px">' + (label === 'Authorized By' ? _esc(bizName) : 'Date: ___________') + '</div>' +
          '</div>'
        ).join('') +
        '</div></div></div>';

      let purViewModal = document.getElementById('pur-view-modal');
      if (!purViewModal) {
        const mv = document.createElement('div');
        mv.id = 'pur-view-modal';
        mv.style.cssText = 'display:none;position:fixed;inset:0;z-index:var(--zi-top,1200);background:var(--bg,#f0f0f0);flex-direction:column;overflow:hidden';
        mv.innerHTML =
          '<div style="background:#2c3e50;padding:0 16px;height:48px;display:flex;align-items:center;gap:10px;flex-shrink:0">' +
          '<span id="pur-view-title" style="color:#fff;font-weight:700;font-size:14px;flex:1">&#128203; Purchase Invoice</span>' +
          '<button onclick="(function(){var m=document.getElementById(\'pur-view-modal\');if(m){m.style.display=\'none\';document.body.style.overflow=\'\'}})()" ' +
          'style="width:30px;height:30px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:5px;cursor:pointer;font-size:16px">&#10005;</button>' +
          '<button onclick="window.print()" style="background:#4338CA;color:#fff;border:none;border-radius:5px;padding:6px 14px;cursor:pointer;font-size:13px;font-weight:600">&#128424; Print</button>' +
          '</div>' +
          '<div style="flex:1;overflow-y:auto;padding:20px;display:flex;justify-content:center">' +
          '<div id="pur-view-preview" style="background:var(--white,#fff);border-radius:8px;box-shadow:0 2px 16px rgba(0,0,0,.15);width:100%;max-width:800px;min-height:400px;overflow:visible"></div>' +
          '</div>';
        document.body.appendChild(mv);
        purViewModal = mv;
        if (!global.__purViewEscBound) {
          global.__purViewEscBound = true;
          document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
              var vm = document.getElementById('pur-view-modal');
              if (vm && vm.style.display !== 'none') {
                vm.style.display = 'none';
                document.body.style.overflow = '';
              }
            }
          });
        }
      }
      const purPreview = document.getElementById('pur-view-preview');
      if (purPreview) purPreview.innerHTML = poHTML;
      const purTitle = document.getElementById('pur-view-title');
      if (purTitle) purTitle.textContent = '\u{1F4CB} Purchase: ' + (po.id || '');
      purViewModal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    } catch (e) { console.warn('[viewPurchaseOrder]', e); }
  }

  function _renderPurchaseList(list) {
    try {
      const tbody = _el('pur-tbody');
      if (!tbody) { _safe(renderPurchases, 'renderPurchases fallback'); return; }

      const stMap = { complete:'b-green', completed:'b-green', partial:'b-orange', pending:'b-blue', draft:'b-blue', returned:'b-red', cancelled:'b-gray' };
      const stLbl = { complete:'Completed', completed:'Completed', partial:'Partial', pending:'Pending', draft:'Pending', returned:'Returned', cancelled:'Cancelled' };
      const all = _purchases();

      tbody.innerHTML = (list.length ? list : []).map(p => {
        const itemsArr = Array.isArray(p.items) ? p.items : (Array.isArray(p.itemsList) ? p.itemsList : []);
        const firstImg = itemsArr.find(i => i.image && typeof i.image === 'string' && i.image.startsWith('data:image/')) || null;
        const imgHtml = firstImg
          ? '<img class="thumbnail" src="' + _esc(firstImg.image) + '" style="cursor:pointer" onclick="if(typeof viewPhoto===\'function\')viewPhoto(this.src)" onerror="this.style.display=\'none\'">'
          : '&#8212;';
        const safeId = _esc(p.id || '');
        const safeSup = _esc((p.supplierName || p.sup) || '');

        return '<tr data-pur-id="' + safeId + '">' +
          '<td><div class="item-image">' + imgHtml + '</div></td>' +
          '<td class="mono fw">' + safeId + '</td>' +
          '<td class="fw">' + safeSup + '</td>' +
          '<td class="muted">' + _esc(p.date || '') + '</td>' +
          '<td>' + _esc(String(itemsArr.length)) + ' items</td>' +
          '<td class="mono" style="color:var(--gold);font-weight:700">' + _fmt(_esc(((p.total || p.amt) || 0))) + '</td>' +
          '<td><span class="badge ' + (stMap[(p.status || p.st)] || 'b-gray') + '">' + _esc(stLbl[(p.status || p.st)] || p.status || p.st || '') + '</span></td>' +
          '<td><div style="display:flex;gap:4px;flex-wrap:wrap">' +
          '<button class="btn btn-ghost btn-sm" data-action="view" data-id="' + safeId + '"><svg><use href="#ic-eye"/></svg> View</button>' +
          '<button class="btn btn-primary btn-sm" data-action="print" data-id="' + safeId + '"><svg><use href="#ic-print"/></svg> Print</button>' +
          ((p.status||p.st) !== 'complete' && (p.status||p.st) !== 'completed' && (p.status||p.st) !== 'returned'
            ? '<button class="btn btn-success btn-sm" data-action="complete" data-id="' + safeId + '" title="Adds these items to inventory stock. This does NOT record a payment.">&#128230; Receive Stock</button>'
            : '') +
          ((_num(p.remainingPaisa, p.total || p.amt ? Math.round(((p.total||p.amt)-(p.paid||p.paidAmount||0))*100) : 0) > 0)
            ? '<button class="btn btn-sm" style="background:#0284c7;color:#fff;border-color:#0284c7" data-action="pay" data-id="' + safeId + '" title="Record a payment against THIS bill specifically">&#128176; Pay</button>'
            : '') +
          ((p.status||p.st) !== 'complete' && (p.status||p.st) !== 'completed' && (p.status||p.st) !== 'returned'
            ? '<button class="btn btn-ghost btn-sm" data-action="edit" data-id="' + safeId + '" title="Edit PO"><svg><use href="#ic-edit"/></svg></button>'
            : '') +
          '<button class="btn btn-danger btn-sm" data-action="delete" data-id="' + safeId + '" title="Delete PO"><svg><use href="#ic-trash"/></svg></button>' +
          '</div></td>' +
          '</tr>';
      }).join('') || '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--muted)">No purchases found</td></tr>';

    } catch (e) { console.warn('[_renderPurchaseList]', e); }
  }

  function renderPurchases() {
    try {
      _renderPurchaseList(_purchases());
      renderPurchaseStats();
      try { global.PurchaseReturns?.refreshReturnsTbody?.(); } catch (_) {}
    } catch (e) { console.warn('[renderPurchases]', e); }
    try { document.dispatchEvent(new CustomEvent('purchaserendered')); } catch (_) {}
  }

  function searchPurchases(query) {
    try {
      const q = (query || '').toLowerCase().trim();
      const all = _purchases();
      const list = q ? all.filter(p =>
        (p.id || '').toLowerCase().includes(q) ||
        (p.supplierName || p.sup || '').toLowerCase().includes(q) ||
        (p.billNo || p.bill_no || p.invoiceNo || '').toLowerCase().includes(q)
      ) : all;
      _renderPurchaseList(list);
    } catch (e) {}
  }

  function filterPurchases(status, el) {
    try {
      document.querySelectorAll('#pv-purchase .tab').forEach(t => t.classList.remove('active'));
      if (el) el.classList.add('active');
      const all = _purchases();
      const list = status === 'all' ? all : all.filter(p => (p.status || p.st || '').toLowerCase() === (status || '').toLowerCase());
      _renderPurchaseList(list);
    } catch (e) {}
  }

  function renderPurchaseLedger() {
    try {
      const tbody = _el('pur-ledger-tbody');
      if (!tbody) return;
      const ps = global.PurchaseState;
      if (!ps || typeof ps.getSupplierLedgerEntries !== 'function') return;

      const typeDesc = {
        PURCHASE_BILL   : 'Purchase Bill',
        PAYMENT_OUT     : 'Payment Out',
        PURCHASE_RETURN : 'Purchase Return',
        PAYMENT_VOID    : 'Payment Void',
        ADVANCE_USED    : 'Advance',
        ADJUSTMENT      : 'Adjustment',
        OPENING_BALANCE : 'Opening Balance',
        PURCHASE_DELETE : 'Purchase Deleted',
        DEBIT_NOTE      : 'Debit Note',
      };

      const allEntries = [];
      const seen = new Set();
      const sups = _suppliers();
      const sidKeys = new Set();

      _purchases().forEach(p => {
        const s = (p.supplierId || p.supplierName || '').toLowerCase().trim();
        if (s) sidKeys.add(s);
      });
      sups.forEach(s => {
        const k = (s.id || s.n || '').toLowerCase().trim();
        if (k) sidKeys.add(k);
      });

      sidKeys.forEach(sid => {
        ps.getSupplierLedgerEntries(sid).forEach(e => {
          if (!seen.has(e.id)) {
            seen.add(e.id);
            allEntries.push(e);
          }
        });
      });

      allEntries.sort((a, b) => {
        const d = (a.date || '').localeCompare(b.date || '');
        return d !== 0 ? d : (a.createdAt || '').localeCompare(b.createdAt || '');
      });

      const runningBySup = {};
      tbody.innerHTML = allEntries.map(e => {
        const sid = (e.supplierId || '').toLowerCase().trim();
        runningBySup[sid] = (runningBySup[sid] || 0) + (e.credit || 0) - (e.debit || 0);
        const running = runningBySup[sid];
        const balColor = running > 0 ? 'var(--red)' : 'var(--green)';
        const debitAmt  = e.debit  || 0;
        const creditAmt = e.credit || 0;
        return '<tr>' +
          '<td class="muted">' + _esc(e.date || '&#8212;') + '</td>' +
          '<td class="mono fw">' + _esc(e.referenceId || '&#8212;') + '</td>' +
          '<td class="fw">' + _esc(e.supplierId || '&#8212;') + '</td>' +
          '<td class="muted">' + _esc(typeDesc[e.type] || e.type || '') + '</td>' +
          '<td class="mono" style="color:var(--red)">' + (creditAmt > 0 ? '' + _fmt(Math.round(creditAmt / 100)) : '&#8212;') + '</td>' +
          '<td class="mono" style="color:var(--green)">' + (debitAmt  > 0 ? '' + _fmt(Math.round(debitAmt  / 100)) : '&#8212;') + '</td>' +
          '<td class="mono fw" style="color:' + balColor + '">' + '' + _fmt(Math.abs(Math.round(running / 100))) + '</td>' +
          '</tr>';}).join('') || '<tr><td colspan="7" style="text-align:center;padding:16px;color:var(--muted)">No purchase entries</td></tr>';

    } catch (e) { console.warn('[renderPurchaseLedger]', e); }
  }

  function renderPurchaseStats() {
    try {
      const pArr = _purchases();
      const sups = _suppliers();
      const currMo = _today().slice(0, 7);
      const monthlyPur = pArr.filter(p => (p.date || '').startsWith(currMo)).reduce((s, p) => s + (p.total || p.amt || 0), 0);
      const pendingPOs = pArr.filter(p => { const st = (p.status || p.st || ''); return st === 'draft' || st === 'partial' || st === 'pending'; }).length;
      const completedPOs = pArr.filter(p => (p.status || p.st) === 'complete').length;
      const totalPayable = (function() {
        const PS = _PS();
        if (PS && typeof PS.getLedgerBalance === 'function') {
          const allPurs = PS.getAllPurchases();
          const supIds = new Set(allPurs.map(p => (p.supplierId || p.supplierName || '').toLowerCase().trim()).filter(Boolean));
          return Math.round(Math.max(0, [...supIds].reduce((s, sid) => s + PS.getLedgerBalance(sid) / 100, 0)));
        }
        if (_PS()) {
          return Math.round(_PS().getAllPurchases().reduce((s, p) => s + (_num(p.remainingPaisa, 0) / 100), 0));
        }
        return sups.reduce((s, sup) => s + _num(sup.owe, 0), 0);
      })();

      const el1 = _el('sup-monthly-pur'); if (el1) el1.textContent = '' + _fmt(monthlyPur);
      const el2 = _el('sup-pending-orders'); if (el2) el2.textContent = pendingPOs;
      const el3 = _el('sup-payable'); if (el3) el3.textContent = '' + _fmt(totalPayable);
      const el4 = _el('sup-completed-orders');if (el4) el4.textContent = completedPOs;
    } catch (e) {}
  }

  function completePurchase(id) {
    const ps = global.PurchaseState;
    const pArr = ps ? ps.getAllPurchases() : _purchases();
    const po = pArr.find(p => p.id === id);
    if (!po) { _toast('Purchase order not found', 'error'); return; }

    const currentStatus = po.status || po.st || '';
    if (currentStatus === 'complete' || currentStatus === 'completed') {
      _toast('PO ' + id + ' is already completed', 'warning');
      return;
    }

    var _cmpConfirm = (window.ERP && window.ERP.confirmDialog) || function(msg, ok) { if (window.confirm(msg)) ok(); };
    _cmpConfirm('Receive stock for PO ' + id + '? This adds the items to inventory. Note: this does NOT record any payment — use the Pay button separately for that.', function() {
      _showLoader('Updating...');
      const today = _today();

      try {
        if (ps?.updatePurchase) {
          const r = ps.updatePurchase(id, { st: 'complete', status: 'complete', completedAt: today });
          if (r && !r.ok) {
            _toast('Failed to update purchase status: ' + r.error, 'error');
            _hideLoader();
            return;
          }
        } else {
          po.status = 'complete'; po.st = 'complete'; po.completedAt = today;
        }

        const invSvcCmp = global.ERP?.InventoryService || global.InventoryService;
        const itemList = po.itemsList || po.items || [];

        if (po._stockAdded) {
          _toast('Stock already added for this purchase', 'warning');
          _hideLoader();
          return;
        }

        const _allInvCmp = (invSvcCmp && typeof invSvcCmp.getAll === 'function')
          ? invSvcCmp.getAll()
          : ((global.ERP && global.ERP.getState) ? (global.ERP.getState().data.inventory || []).filter(function(i){ return !i._archived; }) : []);

        const cmpEntries = itemList.map(function(item) {
          const found = _findInvItem(_allInvCmp, item);
          if (!found || !found.bc) {
            throw new Error('Item "' + (item.name || item.n || '') + '" barcode not found in inventory — add barcode first');
          }
          const bc = found.bc;
          const qty = _num(item.qty || item.q, 0);
          const unitCost = _unitCostFromItem(item);
          return { barcode: bc, qty, unitCostPaisa: Math.round(unitCost * 100) };
        }).filter(function(e) { return e.barcode && e.qty > 0; });

        if (cmpEntries.length > 0) {
          try {
            const actorCmp = (global.window && global.window.currentUser && global.window.currentUser.name) || 'system';
            if (invSvcCmp && typeof invSvcCmp.receive === 'function') {
              invSvcCmp.receive(cmpEntries, { sourceModule: 'purchase', documentId: id, actor: actorCmp, skipGLBridge: true });
              try { ps?.updatePurchase(id, { _stockAdded: true }); } catch (_) {}
              if (!ps) { po._stockAdded = true; }
            } else {
              throw new Error('[completePurchase] InventoryService not available');
            }
          } catch (stockErr) {
            console.error('[completePurchase] stock error:', stockErr);
            try { ps?.updatePurchase(id, { st: currentStatus, status: currentStatus, completedAt: undefined, _stockAdded: false }); } catch (_) {}
            _toast('Stock update failed: ' + stockErr.message + '. Purchase reverted.', 'error', 7000);
            _hideLoader();
            return;
          }
        }

        _persist();
        _safe(() => renderPurchases(), 'renderPurchases');
        _safe(() => renderPurchaseLedger(), 'renderPurchaseLedger');
        try { if (typeof renderInventory === 'function') renderInventory(); } catch (_) {}
        try { if (typeof renderDashWidgets === 'function') renderDashWidgets(); } catch (_) {}

        const _cmpTotalPaisa = Math.round((po.total || po.grand || po.amt || 0) * 100);
        const _cmpSupplierId = (po.supplierId || po.supplierName || po.sup || '').toLowerCase().trim();
        const ps2 = global.PurchaseState;
        if (_cmpSupplierId && _cmpTotalPaisa > 0 && ps2 && typeof ps2.writeLedgerEntry === 'function') {
          try {
            const _existingEntries = typeof ps2.getSupplierLedgerEntries === 'function' ? ps2.getSupplierLedgerEntries(_cmpSupplierId) : [];
            const _billAlreadyWritten = _existingEntries.some(function(e) { return e.type === 'PURCHASE_BILL' && e.referenceId === id; });
            if (!_billAlreadyWritten) {
              ps2.writeLedgerEntry({
                supplierId: _cmpSupplierId,
                type: 'PURCHASE_BILL',
                debit: 0,
                credit: _cmpTotalPaisa,
                referenceId: id,
                date: today,
                note: 'Purchase completed: ' + id,
              });
              if (typeof ps2.recalculate === 'function') ps2.recalculate(_cmpSupplierId);
            }
          } catch (_) {}
        }
        try {
          const peCmp = global.ERP?.PostingEngine || global.PostingEngine;
          if (peCmp && typeof peCmp.isPosted === 'function' && !peCmp.isPosted(id) && _cmpTotalPaisa > 0) {
            peCmp.post({
              documentId: id,
              documentType: 'PURCHASE',
              date: today,
              memo: 'Purchase completed: ' + id + ' from ' + (po.supplierName || po.sup || ''),
              entries: [
                { accountId: 'acc-1200', description: 'Inventory Asset', debit: _cmpTotalPaisa, credit: 0 },
                { accountId: 'acc-2001', description: 'Accounts Payable', debit: 0, credit: _cmpTotalPaisa },
              ],
            }).catch(function(e) {
              console.error('[completePurchase] GL post failed:', e && e.message);
              try { if (global.ERP && global.ERP.PurchaseConnector && typeof global.ERP.PurchaseConnector._addRetryFailed === 'function') { global.ERP.PurchaseConnector._addRetryFailed(id, 'bill'); } } catch(_) {}
            });
          }
        } catch (_cmpGlErr) {
          console.error('[completePurchase] GL post error:', _cmpGlErr);
          try { if (global.ERP && global.ERP.PurchaseConnector && typeof global.ERP.PurchaseConnector._addRetryFailed === 'function') { global.ERP.PurchaseConnector._addRetryFailed(id, 'bill'); } } catch(_) {}
        }
      } catch (e) {
        _hideLoader();
        _toast('Failed to complete purchase: ' + e.message, 'error');
        return;
      } finally {
        _hideLoader();
      }
    });
  }

  function editPurchase(idOrIdx) {
    try {
      const pArr = _purchases();
      const p = typeof idOrIdx === 'string'
        ? pArr.find(x => x.id === idOrIdx)
        : pArr[idOrIdx];
      if (!p) { _toast('Purchase not found', 'error'); return; }
      const st = p.status || p.st || '';
      if (st === 'complete' || st === 'completed' || st === 'returned') { _toast('Completed/returned purchases cannot be edited', 'warning'); return; }
      openPurModal(p.id);
    } catch (e) { console.warn('[editPurchase]', e); }
  }

  function deletePurchase(idOrIdx) {
    try {
      const pArr = _purchases();
      const p = typeof idOrIdx === 'string'
        ? pArr.find(x => x.id === idOrIdx)
        : pArr[idOrIdx];
      if (!p) { _toast('Purchase not found', 'error'); return; }

      const ps = global.PurchaseState;
      if (ps) {
        const linkedReturns = ps.getAllReturns?.()?.filter(r => r.purchaseId === p.id) || [];
        const linkedPayments = ps.getAllPayments?.()?.filter(pay => pay.reference === p.id) || [];
        if (linkedReturns.length > 0 || linkedPayments.length > 0) {
          _toast(
            'Cannot delete PO ' + p.id + ':\n' +
            (linkedReturns.length > 0 ? '&#8226; ' + linkedReturns.length + ' return(s) linked\n' : '') +
            (linkedPayments.length > 0 ? '&#8226; ' + linkedPayments.length + ' payment(s) linked\n' : '') +
            'Delete linked records first.',
            'error'
          );
          return;
        }
      }

      var _delMsg = ((p.status || p.st) === 'complete' || (p.status || p.st) === 'completed')
        ? 'This PO is completed. Inventory will be reversed on delete. Continue?'
        : 'Delete Purchase Order ' + p.id + '?';
      var _delConfirm = (window.ERP && window.ERP.confirmDialog) || function(msg, ok) { if (window.confirm(msg)) ok(); };
      _delConfirm(_delMsg, function() {
        const _doDelete = function() {
          if (p._stockAdded) {
            try {
              const invSvc = global.ERP?.InventoryService || global.InventoryService;
              if (invSvc && typeof invSvc.deduct === 'function') {
                const _allInvDel = (global.ERP && global.ERP.InventoryService && typeof global.ERP.InventoryService.getAll === 'function')
                  ? global.ERP.InventoryService.getAll()
                  : ((global.ERP && global.ERP.getState) ? (global.ERP.getState().data.inventory || []).filter(function(i){ return !i._archived; }) : []);
                const itemList = p.itemsList || p.items || [];
                let _delSkipped = 0;
                const invEntries = itemList.map(function(it) {
                  const found = _findInvItem(_allInvDel, it);
                  if (!found || !found.bc) { _delSkipped++; return null; }
                  return { barcode: found.bc, qty: Number(it.qty || it.q || 0), unitCostPaisa: Math.round(_unitCostFromItem(it) * 100) };
                }).filter(function(e) { return e && e.barcode && e.qty > 0; });
                if (_delSkipped > 0) {
                  console.error('[deletePurchase] ' + _delSkipped + ' item(s) could not be matched to inventory — stock reversal skipped for those items');
                  _toast('\u26a0\ufe0f ' + _delSkipped + ' item(s) not found in inventory — stock not reversed for them', 'warning');
                }
                if (invEntries.length > 0) {
                  const actorDel = (global.window && global.window.currentUser && global.window.currentUser.name) || 'system';
                  const _delDeductRes = invSvc.deduct(invEntries, { sourceModule: 'purchase_delete', documentId: p.id, actor: actorDel, skipGLBridge: true });
                  if (_delDeductRes && !_delDeductRes.ok) {
                    console.error('[deletePurchase] stock reversal failed:', _delDeductRes.error);
                    _toast('\u26a0\ufe0f Purchase deleted but stock reversal failed: ' + (_delDeductRes.error || 'unknown'), 'warning');
                  }
                }
              }
            } catch (invErr) { console.error('[deletePurchase] inventory reverse error:', invErr); }
          }

          if (!ps?.removePurchase) { _toast('PurchaseState not available', 'error'); return; }
          const r = ps.removePurchase(p.id, { force: true, hardDelete: true });
          if (r && !r.ok) { _toast('Delete failed: ' + r.error, 'error'); return; }

          renderPurchases();
          renderPurchaseLedger();
          _persist();
          _toast('Purchase ' + p.id + ' deleted', 'success');
        };

        const pe = window.ERP && ERP.PostingEngine;
        const _liveGlDocIdDel = p._glDocId || p.id;
        if (pe && typeof pe.isPosted === 'function' && pe.isPosted(_liveGlDocIdDel)) {
          pe.reverse(_liveGlDocIdDel, { reason: 'Purchase deleted: ' + p.id, actor: 'system' })
            .then(_doDelete)
            .catch(function(e) {
              _toast('Delete failed &#8212; GL error: ' + (e && e.message || 'unknown'), 'error');
            });
        } else {
          _doDelete();
        }
      });
    } catch (e) { _toast('Failed to delete purchase', 'error'); }
  }

  var _pmSaveInProgress = {};
  var _pmNewSaveInProgress = false;
  function _pmSetSaveBtnDisabled(disabled) {
    try {
      var btn = document.getElementById('pm-save-btn');
      if (btn) btn.disabled = !!disabled;
    } catch (_) {}
  }
  function pmSave(doPrint) {
    let editId = null;
    try {
      const ps = global.PurchaseState;

      const supplierName = (_el('pm-party')?.value || '').trim();
      if (!supplierName) { _toast('Supplier is required', 'warning'); return; }

      // FIX (Accounts Payable / 3-parallel-sources bug): supplierId used to be
      // derived purely from the normalized supplier NAME, so two suppliers with
      // similar names could merge in reports, and renaming a supplier could
      // orphan its purchase history. It now resolves to the real, stable
      // party.id of the selected/typed supplier (auto-creating the party
      // record if the name doesn't match one yet).
      const supplierId = (global.ERP && global.ERP.parties && typeof global.ERP.parties.resolveSupplierId === 'function')
        ? global.ERP.parties.resolveSupplierId(supplierName)
        : _lc(supplierName);

      const date = (_el('pm-date')?.value || _today()).trim();
      const billNo = (_el('pm-billno')?.value || '').trim();
      const state = (_el('pm-state')?.value || '').trim();
      const notes = (_el('pm-desc')?.value || '').trim();
      const ph = (_el('pm-phone')?.value || '').trim();
      const ptEl = _el('pm-paytype');
      const payType = ptEl ? ptEl.value : 'Cash';

      const pChk = _el('pm-paid-chk');
      const pAmt = _el('pm-paid-amt');
      const paid = (pChk && pChk.checked) ? _num(pAmt?.value, 0) : 0;

      const rows = document.querySelectorAll('#pm-tbody tr');
      const items = [];
      let totalAmt = 0;

      for (const row of rows) {
        const ni = row.querySelector('input[type="text"]');
        const nums = row.querySelectorAll('input[type="number"]');
        const sels = row.querySelectorAll('select');
        if (!ni || !ni.value.trim()) continue;

        const name = ni.value.trim();
        const bc = (row.dataset.bc || '').trim();
        const qty = Math.max(0, _num(nums[0]?.value, 0));
        const price = Math.max(0, _num(nums[1]?.value, 0));
        const discPct = Math.max(0, Math.min(100, _num(nums[2]?.value, 0)));
        const unit = (sels[0]?.value || 'NONE');
        const taxVal = sels[1]?.value || '0:NONE';
        const taxPct = _num(taxVal.split(':')[0], 0);
        const taxLabel = taxVal.includes(':') ? taxVal.split(':')[1] : 'NONE';

        const { dAmt, tAmt, lineAmt } = _calcLine(qty, price, discPct, taxPct);

        const allTextInputs = row.querySelectorAll('input[type="text"]');
        const colour = allTextInputs[1]?.value?.trim() || '';

        if (qty > 0 && name) {
          items.push({ name, bc, qty, rate: price, price, unit, colour, discPct, discAmt: dAmt, taxPct, taxLabel, taxAmt: tAmt, lineAmt, amount: lineAmt });
          totalAmt += lineAmt;
        }
      }

      if (!items.length) { _toast('At least one item is required', 'warning'); return; }

      const roChk = _el('pm-roundoff');
      const subtotal = Math.round(totalAmt * 100) / 100;
      let grand = subtotal;
      if (roChk?.checked) grand = Math.round(grand);

      const advance = Math.max(0, Math.round((paid - grand) * 100) / 100);
      const paidClamped = Math.min(paid, grand);
      const grandPaisa = Math.round(grand * 100);
      const paidClampedPaisa = Math.round(paidClamped * 100);
      const status = paidClampedPaisa >= grandPaisa ? 'complete' : (paidClampedPaisa > 0 ? 'partial' : 'pending');

      const bill = {
        supplierName, supplierId: supplierId,
        ph, date, billNo, state, notes, payType,
        items, itemsList: items.map(it => Object.assign({}, it)),
        subtotal, total: grand, amt: grand,
        paid: paidClamped, paidAmount: paidClamped,
        balance: Math.max(0, Math.round((grand - paidClamped) * 100) / 100),
        advance: advance,
        status,
      };

      editId = global.window?._editingPurId;
      if (editId && _pmSaveInProgress[editId]) {
        _toast('The previous edit is still processing in GL, please wait...', 'warning');
        return;
      }
      if (!editId && _pmNewSaveInProgress) {
        _toast('Purchase save is still processing, please wait...', 'warning');
        return;
      }
      if (editId) _pmSaveInProgress[editId] = true;
      else _pmNewSaveInProgress = true;
      _pmSetSaveBtnDisabled(true);
      let _glChainStarted = false;
      let savedId, savedRecord;
      let oldRecord = null;
      let _stockDeductedEntries = undefined;
      let _shouldAddStock = true;

      if (editId && ps?.getAllPurchases) {
        oldRecord = ps.getAllPurchases().find(p => p.id === editId) || null;
      }

      if (editId && ps?.updatePurchase) {
        _stockDeductedEntries = null;
        if (oldRecord && oldRecord._stockAdded) {
          try {
            const invSvc = global.ERP?.InventoryService || global.InventoryService;
            if (invSvc && typeof invSvc.deduct === 'function') {
              const _allInv2 = (global.ERP && global.ERP.InventoryService && typeof global.ERP.InventoryService.getAll === 'function')
                ? global.ERP.InventoryService.getAll()
                : ((global.ERP && global.ERP.getState) ? (global.ERP.getState().data.inventory || []).filter(function(i){ return !i._archived; }) : []);
              const oldItems = oldRecord.itemsList || oldRecord.items || [];
              let _editSkipped = 0;
              const invEntries = oldItems.map(function(it) {
                const found = _findInvItem(_allInv2, it);
                if (!found || !found.bc) { _editSkipped++; return null; }
                return { barcode: found.bc, qty: Number(it.qty || it.q || 0), unitCostPaisa: Math.round(_unitCostFromItem(it) * 100) };
              }).filter(function(e) { return e && e.barcode && e.qty > 0; });
              if (_editSkipped > 0) {
                console.error('[pmSave] ' + _editSkipped + ' old item(s) could not be matched to inventory — stock reversal skipped for those items');
              }
              if (invEntries.length > 0) {
                const actor2 = (global.window && global.window.currentUser && global.window.currentUser.name) || 'purchase';
                const _deductRes = invSvc.deduct(invEntries, { sourceModule: 'purchase_edit', documentId: editId, actor: actor2, skipGLBridge: true });
                if (_deductRes && _deductRes.ok) {
                  _stockDeductedEntries = invEntries;
                } else {
                  console.error('[pmSave] Edit stock reversal failed:', _deductRes && _deductRes.error);
                  _toast('\u26a0\ufe0f Stock reversal incomplete — check inventory', 'warning');
                  _shouldAddStock = false;
                }
              }
            }
          } catch (invErr) { console.error('[pmSave] edit stock reverse error:', invErr); }
        }

        const r = ps.updatePurchase(editId, bill);
        if (!r || !r.ok) {
          if (_stockDeductedEntries) {
            try {
              const invSvcRb = global.ERP?.InventoryService || global.InventoryService;
              if (invSvcRb && typeof invSvcRb.receive === 'function') {
                const actorRb = (global.window && global.window.currentUser && global.window.currentUser.name) || 'purchase';
                invSvcRb.receive(_stockDeductedEntries, { sourceModule: 'purchase_edit_rollback', documentId: editId + '-rb', actor: actorRb, skipGLBridge: true });
              }
            } catch (_rbErr) {}
          }
          const errMsg = (r && r.error) || 'unknown';
          const helpMsg = (r && r.message) ? r.message : errMsg;
          if (errMsg.includes('STAMP_MISMATCH')) {
            _toast('⚠️ ' + helpMsg, 'warning', 6000);
          } else {
            _toast('Save failed: ' + errMsg, 'error');
          }
          if (editId) _pmSaveInProgress[editId] = false;
          _pmSetSaveBtnDisabled(false);
          return;
        }
        savedId = editId;
        savedRecord = ps.getAllPurchases().find(p => p.id === editId);
      } else if (ps?.addPurchase) {
        const r = ps.addPurchase(bill);
        if (!r || !r.ok) {
          const errMsg = (r && r.error) || 'unknown';
          const helpMsg = (r && r.message) ? r.message : errMsg;
          if (errMsg.includes('STAMP_MISMATCH')) {
            _toast('⚠️ ' + helpMsg, 'warning', 6000);
          } else {
            _toast('Save failed: ' + errMsg, 'error');
          }
          _pmNewSaveInProgress = false;
          _pmSetSaveBtnDisabled(false);
          return;
        }
        savedId = r.id;
        savedRecord = r.record;
      } else {
        _toast('\u274c Purchase could not be saved: PurchaseState module not loaded. Reload the app and try again.', 'error', 0);
        if (editId) _pmSaveInProgress[editId] = false;
        else _pmNewSaveInProgress = false;
        _pmSetSaveBtnDisabled(false);
        return;
      }

      if (ps?.writeLedgerEntry && savedId) {
        const totalPaisa = Math.round(grand * 100);
        const paidPaisa = Math.round(paidClamped * 100);
        if (!editId) {
          const _ledRes1 = ps.writeLedgerEntry({
            supplierId: supplierId,
            type: 'PURCHASE_BILL',
            debit: 0,
            credit: totalPaisa,
            referenceId: savedId,
            date: date,
            note: 'Purchase bill: ' + savedId,
          });
          if (_ledRes1 && !_ledRes1.ok) { console.error('[pmSave] PURCHASE_BILL ledger write failed:', _ledRes1.error); _queueLedgerRetry({ supplierId:supplierId, type:'PURCHASE_BILL', debit:0, credit:totalPaisa, referenceId:savedId, date:date, note:'Purchase bill: ' + savedId }); _toast('\u26a0\ufe0f Supplier balance not updated for ' + savedId + ' — will retry automatically.', 'warning', 6000); }
          if (paidPaisa > 0) {
            const _ledRes2 = ps.writeLedgerEntry({
              supplierId: supplierId,
              type: 'PAYMENT_OUT',
              debit: paidPaisa,
              credit: 0,
              referenceId: savedId,
              date: date,
              note: 'Payment on bill: ' + savedId + ' (' + payType + ')',
            });
            if (_ledRes2 && !_ledRes2.ok) { console.error('[pmSave] PAYMENT_OUT ledger write failed:', _ledRes2.error); _queueLedgerRetry({ supplierId:supplierId, type:'PAYMENT_OUT', debit:paidPaisa, credit:0, referenceId:savedId, date:date, note:'Payment on bill: ' + savedId + ' (' + payType + ')' }); _toast('\u26a0\ufe0f Payment recorded but supplier balance not updated for ' + savedId + ' — will retry automatically.', 'warning', 6000); }
          }
          const advancePaisa = Math.round(advance * 100);
          if (advancePaisa > 0) {
            const _ledAdv = ps.writeLedgerEntry({
              supplierId: supplierId,
              type: 'ADVANCE_USED',
              debit: advancePaisa,
              credit: 0,
              referenceId: savedId,
              date: date,
              note: 'Advance credit on bill: ' + savedId + ' (' + payType + ')',
            });
            if (_ledAdv && !_ledAdv.ok) { console.error('[pmSave] ADVANCE_USED ledger write failed:', _ledAdv.error); _queueLedgerRetry({ supplierId:supplierId, type:'ADVANCE_USED', debit:advancePaisa, credit:0, referenceId:savedId, date:date, note:'Advance credit on bill: ' + savedId + ' (' + payType + ')' }); }
          }
        } else if (oldRecord) {
          const oldSupplierId = (oldRecord.supplierId || oldRecord.supplierName || '').toLowerCase().trim();
          const newSupplierId = supplierId;
          const oldTotal = Math.round((oldRecord.grand || oldRecord.total || 0) * 100);
          if (oldSupplierId && oldSupplierId !== newSupplierId) {
            if (oldTotal > 0) {
              const _ledRev = ps.writeLedgerEntry({
                supplierId: oldSupplierId,
                type: 'ADJUSTMENT',
                debit: oldTotal,
                credit: 0,
                referenceId: savedId,
                date: date,
                note: 'Supplier change reversal: ' + savedId,
              });
              if (_ledRev && !_ledRev.ok) { console.error('[pmSave] supplier reversal ledger write failed:', _ledRev.error); _queueLedgerRetry({ supplierId:oldSupplierId, type:'ADJUSTMENT', debit:oldTotal, credit:0, referenceId:savedId, date:date, note:'Supplier change reversal: ' + savedId }); }
              try { if (typeof ps.recalculate === 'function') ps.recalculate(oldSupplierId); } catch (_) {}
            }
            if (totalPaisa > 0) {
              const _ledNew = ps.writeLedgerEntry({
                supplierId: newSupplierId,
                type: 'PURCHASE_BILL',
                debit: 0,
                credit: totalPaisa,
                referenceId: savedId,
                date: date,
                note: 'Purchase bill (supplier changed): ' + savedId,
              });
              if (_ledNew && !_ledNew.ok) { console.error('[pmSave] new supplier PURCHASE_BILL ledger write failed:', _ledNew.error); _queueLedgerRetry({ supplierId:newSupplierId, type:'PURCHASE_BILL', debit:0, credit:totalPaisa, referenceId:savedId, date:date, note:'Purchase bill (supplier changed): ' + savedId }); }
            }
          } else {
            const delta = totalPaisa - oldTotal;
            if (delta !== 0) {
              const _ledRes3 = ps.writeLedgerEntry({
                supplierId: newSupplierId,
                type: 'ADJUSTMENT',
                debit: delta < 0 ? Math.abs(delta) : 0,
                credit: delta > 0 ? delta : 0,
                referenceId: savedId,
                date: date,
                note: 'Bill edit adjustment: ' + savedId,
              });
              if (_ledRes3 && !_ledRes3.ok) { console.error('[pmSave] ADJUSTMENT ledger write failed:', _ledRes3.error); _queueLedgerRetry({ supplierId:newSupplierId, type:'ADJUSTMENT', debit: delta < 0 ? Math.abs(delta) : 0, credit: delta > 0 ? delta : 0, referenceId:savedId, date:date, note:'Bill edit adjustment: ' + savedId }); }
            }
          }
        }
        if (typeof ps.recalculate === 'function') ps.recalculate(supplierId);
      }

      if (savedRecord && items.length > 0 && (!editId || _shouldAddStock)) {
        try {
          const invSvc = global.ERP?.InventoryService || global.InventoryService;
          if (invSvc && typeof invSvc.receive === 'function') {
            const _allInv = (global.ERP && global.ERP.InventoryService && typeof global.ERP.InventoryService.getAll === 'function')
              ? global.ERP.InventoryService.getAll()
              : ((global.ERP && global.ERP.getState) ? (global.ERP.getState().data.inventory || []).filter(function(i){ return !i._archived; }) : []);
            let _rcvSkipped = 0;
            const _skippedNames = [];
            const invEntries = items.map(function(it) {
              const found = _findInvItem(_allInv, it);
              if (!found || !found.bc) { _rcvSkipped++; _skippedNames.push(it.name || it.n || '(unnamed)'); return null; }
              return {
                barcode: found.bc,
                qty: Number(it.qty) || 0,
                unitCostPaisa: Math.round(_unitCostFromItem(it) * 100)
              };
            }).filter(function(e) { return e && e.barcode && e.qty > 0; });
            if (_rcvSkipped > 0) {
              console.error('[pmSave] ' + _rcvSkipped + ' item(s) not found in inventory — add barcode first to update their stock:', _skippedNames);
              // A brief toast is easy to miss for something this important (stock silently NOT updated),
              // so also surface a persistent, hard-to-miss notice naming exactly which items were skipped.
              _toast('\u26a0\uFE0F Stock NOT updated for: ' + _skippedNames.join(', ') + ' — item(s) not found in Inventory. Add them to Inventory first, then edit this purchase to re-save.', 'warning', 12000);
              try {
                const _notice = 'Stock was NOT added for ' + _rcvSkipped + ' item(s) on this purchase, because they don\u2019t exist in Inventory yet:\n\n\u2022 ' + _skippedNames.join('\n\u2022 ') +
                  '\n\nAdd these items to Inventory first (Inventory \u2192 Add Item), then edit and re-save this purchase so their stock gets updated correctly.';
                if (window.ERP && typeof window.ERP.confirmDialog === 'function') {
                  window.ERP.confirmDialog(_notice, function(){});
                } else {
                  setTimeout(function(){ alert(_notice); }, 300);
                }
              } catch (_noticeErr) {}
            }
            if (invEntries.length > 0) {
              const actor = (global.window && global.window.currentUser && global.window.currentUser.name) || 'purchase';
              const _rcvRes = invSvc.receive(invEntries, { sourceModule: 'purchase', documentId: savedId, actor: actor, skipGLBridge: true });
              if (_rcvRes && _rcvRes.ok) {
                if (savedRecord) savedRecord._stockAdded = true;
                if (ps && typeof ps.updatePurchase === 'function') ps.updatePurchase(savedId, { _stockAdded: true });
              } else {
                console.error('[pmSave] Stock receive failed:', _rcvRes && _rcvRes.error);
                _toast('\u26a0\ufe0f Stock not updated: ' + (_rcvRes && _rcvRes.error || 'unknown'), 'warning');
              }
            }
          }
        } catch (invErr) { console.error('[pmSave] inventory add error:', invErr); }
      }

      if (savedId) {
        try {
          const pe = global.ERP?.PostingEngine || global.PostingEngine;
          if (pe && typeof pe.post === 'function') {
            _glChainStarted = true;
            const totalPaisa = Math.round(grand * 100);
            const glEntries = [
              { accountId: 'acc-1200', description: 'Inventory Asset', debit: totalPaisa, credit: 0 },
              { accountId: 'acc-2001', description: 'Accounts Payable', debit: 0, credit: totalPaisa }
            ];
            if (paidClamped > 0) {
              const paidPaisa = Math.round(paidClamped * 100);
              const _glAccSvc = (function(m) {
                m = (m || '').toLowerCase().trim();
                const isBankLike = m === 'bank' || m === 'bank transfer' || m.indexOf('bank') !== -1 || m === 'cheque' || m === 'check' || m === 'upi' || m === 'online';
                return isBankLike ? { id: 'acc-1002', desc: 'Bank Account' } : { id: 'acc-1001', desc: 'Cash in Hand' };
              })(payType);
              const cashBankId = _glAccSvc.id;
              const cashBankDesc = _glAccSvc.desc;
              glEntries.push(
                { accountId: 'acc-2001', description: 'Accounts Payable', debit: paidPaisa, credit: 0 },
                { accountId: cashBankId, description: cashBankDesc, debit: 0, credit: paidPaisa }
              );
            }
            const actor = (global.window && global.window.currentUser && global.window.currentUser.name) || 'system';
            if (editId && typeof pe.reverse === 'function') {
              const _liveGlDocId = (oldRecord && oldRecord._glDocId) || editId;
              const _doGLPost = function() {
                return pe.post({
                  documentId: _liveGlDocId,
                  documentType: 'PURCHASE',
                  date: date,
                  memo: 'Purchase: ' + savedId + ' from ' + supplierName,
                  entries: glEntries
                }).then(function(r) {
                  if (savedRecord) savedRecord._glDocId = _liveGlDocId;
                  if (ps?.updatePurchase) ps.updatePurchase(savedId, { _glDocId: _liveGlDocId });
                  return r;
                });
              };
              pe.reverse(_liveGlDocId, { reason: 'Purchase edited: ' + editId, actor: 'system' })
                .then(_doGLPost)
                .catch(function(glE) {
                  if (window.DEBUG_MODE) console.warn('[pmSave] GL reverse failed, attempting direct post:', glE && glE.message || glE);
                  return _doGLPost();
                })
                .catch(function(glPostErr) {
                  console.error('[pmSave] GL repost after reverse failed:', glPostErr && glPostErr.message || glPostErr);
                  try { if (global.ERP && global.ERP.PurchaseConnector && typeof global.ERP.PurchaseConnector._addRetryFailed === 'function') { global.ERP.PurchaseConnector._addRetryFailed(savedId, 'bill'); } } catch(_) {}
                })
                .finally(function() { if (editId) _pmSaveInProgress[editId] = false; _pmSetSaveBtnDisabled(false); });
            } else {
              const _glTimeout = new Promise(function(_, rej) {
                setTimeout(function() { rej(new Error('GL post timeout')); }, 15000);
              });
              const _postPromise = pe.post({
                documentId: savedId,
                documentType: 'PURCHASE',
                date: date,
                memo: 'Purchase: ' + savedId + ' from ' + supplierName,
                entries: glEntries
              }).then(function(r) {
                if (savedRecord) savedRecord._glDocId = savedId;
                if (ps?.updatePurchase) ps.updatePurchase(savedId, { _glDocId: savedId });
                return r;
              });
              Promise.race([_postPromise, _glTimeout]).catch(function(glPostErr) {
                console.error('[pmSave] GL post slow or failed (still verifying):', glPostErr && glPostErr.message || glPostErr);
                // IMPORTANT: Promise.race does not cancel the losing promise — _postPromise
                // may still be running/succeed after this catch fires. Only queue a retry
                // once we've confirmed via PostingEngine that nothing was actually posted,
                // to avoid double-posting the same bill.
                _postPromise.catch(function () {}).finally(function () {
                  const _isAlreadyPosted = typeof pe.isPosted === 'function' && pe.isPosted(savedId);
                  if (!_isAlreadyPosted) {
                    try { if (global.ERP && global.ERP.PurchaseConnector && typeof global.ERP.PurchaseConnector._addRetryFailed === 'function') { global.ERP.PurchaseConnector._addRetryFailed(savedId, 'bill'); } } catch(_) {}
                  } else {
                    if (savedRecord) savedRecord._glDocId = savedId;
                    if (ps?.updatePurchase) ps.updatePurchase(savedId, { _glDocId: savedId });
                  }
                });
              }).finally(function() { if (editId) _pmSaveInProgress[editId] = false; else _pmNewSaveInProgress = false; _pmSetSaveBtnDisabled(false); });
            }
          }
        } catch (glErr) {
          console.error('[pmSave] GL post error:', glErr);
          try { if (global.ERP && global.ERP.PurchaseConnector && typeof global.ERP.PurchaseConnector._addRetryFailed === 'function') { global.ERP.PurchaseConnector._addRetryFailed(savedId, 'bill'); } } catch(_) {}
          if (editId) _pmSaveInProgress[editId] = false;
          else _pmNewSaveInProgress = false;
          _pmSetSaveBtnDisabled(false);
        }
      }
      if (editId && !_glChainStarted) _pmSaveInProgress[editId] = false;
      if (!editId && !_glChainStarted) _pmNewSaveInProgress = false;
      if (!_glChainStarted) _pmSetSaveBtnDisabled(false);

      try { if (global.PurchaseBridge?.syncToERPState) global.PurchaseBridge.syncToERPState(); } catch (_) {}
      try { document.dispatchEvent(new CustomEvent('purchase:data:changed', { detail: { id: savedId } })); } catch (_) {}

      _safe(() => renderPurchases(), 'renderPurchases');
      _safe(() => renderPurchaseLedger(), 'renderPurchaseLedger');
      _safe(() => renderPurchaseStats(), 'renderPurchaseStats');
      try { if (typeof renderDashWidgets === 'function') renderDashWidgets(); } catch (_) {}
      try { if (ERP.events && ERP.events.emit) ERP.events.emit('suppliers:updated'); } catch (_) {}

      global.window._editingPurId = undefined;
      closePurModal();

      _toast('Purchase ' + (editId ? 'updated' : 'saved') + ': ' + savedId, 'success');

      if (doPrint !== false && savedRecord) {
        try { pmPrint(savedRecord); } catch (_) {}
      }

      return savedRecord;

    } catch (e) {
      console.error('[pmSave]', e);
      _toast('Save error: ' + e.message, 'error');
      if (editId) _pmSaveInProgress[editId] = false;
      else _pmNewSaveInProgress = false;
      _pmSetSaveBtnDisabled(false);
    }
  }

  function _pmSaveAndShareWA() {
    try {
      var selEl = document.getElementById('pm-party-sel');
      var supName = (selEl && selEl.value && selEl.value !== '__add_supplier__')
                    ? selEl.value
                    : (document.getElementById('pm-party') ? document.getElementById('pm-party').value : '');
      var rawPh = document.getElementById('pm-phone') ? document.getElementById('pm-phone').value : '';

      var ph = (rawPh || '').replace(/\D/g, '');

      if (ph.slice(0, 2) === '00') ph = ph.slice(2);
      if (ph.slice(0, 3) === '923') {  }
      else if (ph.slice(0, 2) === '92') {  }
      else if (ph.length === 11 && ph.charAt(0) === '0') ph = '92' + ph.slice(1);
      else if (ph.length === 10 && ph.charAt(0) === '3') ph = '92' + ph;
      else if (ph.length === 10 && ph.charAt(0) === '0') ph = '92' + ph.slice(1);

      if (!ph || ph.length < 10) {
        _toast('Supplier phone number is required for WhatsApp', 'warning', 3500);
        return;
      }

      var savedRecord = pmSave(false);
      if (!savedRecord) {
        return;
      }

      var total = (savedRecord.total != null ? savedRecord.total : (savedRecord.amt || 0));
      var date = savedRecord.date || '';

      var msg = 'Assalam o Alaikum ' + (supName || 'Sahab') + ',\n'
              + 'Humne aapka purchase record kar liya hai.\n'
              + 'Date: ' + (date || '') + '\n'
              + 'Total: ' + _fmt(total) + '\n'
              + 'Shukriya!';

      // FIX (root cause, audit #96): route through the one canonical wa.me builder/opener.
      if (global.ERP && ERP.WhatsAppLink && typeof ERP.WhatsAppLink.open === 'function') {
        ERP.WhatsAppLink.open(ph, msg);
      } else {
        var u = 'https://wa.me/' + ph + '?text=' + encodeURIComponent(msg);
        var w = window.open(u, '_blank', 'noopener,noreferrer');
        if (!w) window.location.href = u;
      }
    } catch (err) {
      console.error('[_pmSaveAndShareWA]', err);
    }
  }

  function viewPurchaseReturn(id) {
    const ps = global.PurchaseState;
    if (!ps) return;
    const r = ps.getAllReturns().find(x => x.id === id);
    if (!r) { _toast('Return record not found', 'error'); return; }
    const itemRows = (r.items || []).map(it =>
      '<tr>' +
        '<td style="padding:8px 10px;border-bottom:1px solid #f0f0f0">' + _esc(it.name || '') + '</td>' +
        '<td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;text-align:center">' + _esc(String(it.qty || 0)) + '</td>' +
        '<td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;text-align:right">' + _fmt(it.rate || 0) + '</td>' +
        '<td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700">' + _fmt(it.amount || 0) + '</td>' +
      '</tr>'
    ).join('') || '<tr><td colspan="4" style="text-align:center;padding:20px;color:#94a3b8">No items</td></tr>';
    const html =
      '<div style="font-family:Segoe UI,Inter,system-ui,Arial,sans-serif;padding:24px;max-width:560px">' +
        '<div style="font-size:18px;font-weight:800;color:var(--danger);margin-bottom:16px">&#8617; Purchase Return — ' + _esc(r.id) + '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">' +
          '<div><div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:2px">SUPPLIER</div><div style="font-weight:600">' + _esc(r.supplierName || r.supplierId) + '</div></div>' +
          '<div><div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:2px">DATE</div><div>' + _esc(r.date) + '</div></div>' +
          '<div><div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:2px">AGAINST BILL</div><div>' + _esc(r.purchaseId || '—') + '</div></div>' +
          '<div><div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:2px">TOTAL</div><div style="font-weight:700;color:var(--danger)">' + _fmt(r.total || 0) + '</div></div>' +
          (r.reason ? '<div style="grid-column:1/-1"><div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:2px">REASON</div><div>' + _esc(r.reason) + '</div></div>' : '') +
          (r.notes  ? '<div style="grid-column:1/-1"><div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:2px">NOTES</div><div>' + _esc(r.notes) + '</div></div>' : '') +
        '</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
          '<thead><tr style="background:#fef2f2">' +
            '<th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:700;color:#64748b">ITEM</th>' +
            '<th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:700;color:#64748b">QTY</th>' +
            '<th style="padding:8px 10px;text-align:right;font-size:10px;font-weight:700;color:#64748b">RATE</th>' +
            '<th style="padding:8px 10px;text-align:right;font-size:10px;font-weight:700;color:#64748b">AMOUNT</th>' +
          '</tr></thead><tbody>' + itemRows + '</tbody>' +
        '</table>' +
      '</div>';
    const old = document.getElementById('purRetViewBg');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.id = 'purRetViewBg';
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1100;display:flex;align-items:center;justify-content:center';
    wrap.innerHTML =
      '<div style="background:#fff;border-radius:12px;width:min(600px,96vw);max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.18)">' +
        html +
        '<div style="padding:12px 24px;border-top:1px solid #f0f0f0;text-align:right">' +
          '<button onclick="var _b=document.getElementById(\'purRetViewBg\');if(_b)_b.remove()" style="background:#0f4c3a;color:#fff;border:none;border-radius:6px;padding:8px 20px;font-size:13px;font-weight:700;cursor:pointer">Close</button>' +
        '</div>' +
      '</div>';
    wrap.addEventListener('click', function(e) { if (e.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);
  }

  function deletePurchaseReturn(id) {
    const ps = global.PurchaseState;
    if (!ps) return;
    const r = ps.getAllReturns().find(x => x.id === id);
    if (!r) { _toast('Return not found', 'error'); return; }
    if (!confirm('Return ' + id + ' delete karein? Ye wapas nahi hoga.')) return;

    let stockRestoreFailed = false;
    try {
      const invSvc = global.ERP?.InventoryService || global.InventoryService;
      if (!invSvc || typeof invSvc.receive !== 'function') {
        _toast('⚠️ InventoryService not available — return delete cancelled to prevent stock corruption.', 'error');
        return;
      }
      if (r.items && r.items.length) {
        const inv = ((global.ERP && global.ERP.getState && global.ERP.getState().data && global.ERP.getState().data.inventory) || []).filter(i => !i._archived);
        const entries = (r.items || []).map(it => {
          const found = inv.find(i => (i.n || '').toLowerCase() === (it.name || '').toLowerCase());
          const bc = (found && found.bc) || it.bc || '';
          const mac = (typeof it.unitCostPaisa === 'number') ? it.unitCostPaisa / 100
            : ((bc && invSvc.getAvgCost && invSvc.getAvgCost(bc)) || it.rate || 0);
          return { barcode: bc, qty: Number(it.qty) || 0, unitCostPaisa: Math.round(mac * 100) };
        }).filter(e => e.barcode && e.qty > 0);
        if (entries.length) {
          const _restoreRes = invSvc.receive(entries, { sourceModule: 'purchase_return_delete', documentId: 'RET-DEL-' + id, actor: 'system', skipGLBridge: true });
          if (_restoreRes && !_restoreRes.ok) {
            stockRestoreFailed = true;
            console.error('[deletePurchaseReturn] stock restore failed:', _restoreRes.error);
          }
        }
      }
    } catch (invErr) {
      stockRestoreFailed = true;
      console.error('[deletePurchaseReturn] stock restore error:', invErr);
    }

    if (stockRestoreFailed) {
      _toast('⚠️ Stock restore failed — return was not deleted. Please check inventory.', 'error');
      return;
    }

    const res = ps.removeReturn(id);
    if (!res || !res.ok) { _toast('Delete failed: ' + (res && res.error || 'unknown'), 'error'); return; }

    try {
      const pe = global.ERP?.PostingEngine || global.PostingEngine;
        if (pe && typeof pe.reverse === 'function' && r.id) {
        pe.reverse(r.id, { reason: 'Purchase return deleted: ' + id, actor: 'system' }).catch(glRevErr => {
          console.warn('[deletePurchaseReturn] GL reverse failed (may not have been posted):', glRevErr && glRevErr.message || glRevErr);
        });
      }
    } catch (glErr) { console.error('[deletePurchaseReturn] GL reverse error:', glErr); }

    renderPurchaseReturnPage();
    _toast('Return ' + id + ' delete ho gaya', 'success');
  }

  function renderPurchaseReturnPage() {
    const pv = _el('pv-purchasereturn');
    if (!pv) return;

    const ps = global.PurchaseState;
    const returns = (ps ? ps.getAllReturns() : []).filter(r => !r._deleted && !r._voided);
    const total = returns.reduce((s, r) => s + (r.total || 0), 0);
    const todayStr = _today();
    const todayAmt = returns.filter(r => r.date === todayStr).reduce((s, r) => s + (r.total || 0), 0);

    const rows = returns.length
      ? returns.map(r => {
          const safeId = _esc(r.id || '&#8212;');
          return '<tr>' +
            '<td style="font-weight:600;color:#0284c7">' + safeId + '</td>' +
            '<td>' + _esc(r.supplierName || r.supplierId || '&#8212;') + '</td>' +
            '<td>' + _esc(r.purchaseId || '&#8212;') + '</td>' +
            '<td>' + _esc(r.date || '&#8212;') + '</td>' +
            '<td style="font-weight:700">' + _fmt(r.total || 0) + '</td>' +
            '<td>' + _esc(r.reason || '&#8212;') + '</td>' +
            '<td>' + _esc(r.notes || '&#8212;') + '</td>' +
            '<td>' +
              '<button class="btn btn-xs btn-ghost" style="margin-right:4px" onclick="viewPurchaseReturn(\'' + _escJs(r.id) + '\')">&#128065; View</button>' +
              '<button class="btn btn-xs btn-ghost" style="color:var(--danger)" onclick="deletePurchaseReturn(\'' + _escJs(r.id) + '\')">&#128465;</button>' +
            '</td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--muted)">' +
        '<div style="font-size:32px;opacity:.4;margin-bottom:10px">&#8617;&#65039;</div>' +
        '<div style="font-size:14px;font-weight:600">No purchase returns yet</div>' +
        '<div style="font-size:12px;margin-top:6px">Click "+ New Return" to add one</div>' +
        '</td></tr>';

    pv.innerHTML =
      window.renderStatCards([
        { icon:'💰', value:'' + _fmt(total),    label:'Total Returned', color:'#dc2626', bg:'#fef2f2' },
        { icon:'🧾', value:returns.length,          label:'Total Returns',  color:'#4338CA', bg:'#eff6ff' },
        { icon:'📅', value:'' + _fmt(todayAmt),  label:'Today',          color:'#d97706', bg:'#fffbeb' },
      ]) +
      '<div class="toolbar">' +
        '<div class="search-box"><svg><use href="#ic-search"/></svg><input id="search-pur-returns" placeholder="Search returns..." oninput="_purReturnSearch(this.value)"></div>' +
        '<button class="btn btn-sm" style="background:var(--danger);color:#fff;border-color:var(--danger);font-weight:700" onclick="if(typeof openPurchaseReturnModal===\'function\')openPurchaseReturnModal()"><svg><use href="#ic-plus"/></svg> New Return</button>' +
      '</div>' +
      '<div class="panel"><table class="dt"><thead><tr>' +
        '<th>Return #</th><th>Supplier</th><th>Against PO</th><th>Date</th><th>Amount</th><th>Reason</th><th>Notes</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function openPurchaseReturnModal(purchaseId) {
    if (!_el('purchReturnModalBg')) {
      const div = document.createElement('div');
      div.innerHTML = `
<div id="purchReturnModalBg" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:var(--zi-modal-bg,1000);align-items:center;justify-content:center">
 <div style="background:var(--white,#fff);border-radius:12px;width:min(520px,96vw);max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.18)">
   <div style="padding:16px 20px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;justify-content:space-between">
     <div style="font-size:16px;font-weight:700;color:var(--danger)">&#8617;&#65039; Purchase Return</div>
     <button onclick="closePurchaseReturnModal()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--gray-l);line-height:1">&#215;</button>
   </div>
   <div style="padding:20px;display:flex;flex-direction:column;gap:14px">
     <div>
       <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Against Purchase Bill *</label>
       <select id="prm-po" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--white,#fff);outline:none">
         <option value="">&#8212; Select Purchase Bill &#8212;</option>
       </select>
     </div>
     <div style="display:flex;gap:12px">
       <div style="flex:1">
         <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Supplier *</label>
         <select id="prm-sup" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;background:var(--white,#fff);outline:none">
           <option value="">&#8212; Select &#8212;</option>
         </select>
       </div>
       <div style="flex:1">
         <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Date</label>
         <input id="prm-date" type="date" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;outline:none;box-sizing:border-box">
       </div>
     </div>
     <div>
       <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Items *</label>
       <div style="overflow-x:auto;border:1px solid #f0f0f0;border-radius:6px">
         <table style="width:100%;border-collapse:collapse;font-size:12px">
           <thead><tr style="background:var(--bg)">
             <th style="padding:6px 6px;text-align:left;min-width:140px">Item</th>
             <th style="padding:6px 6px;width:60px">Qty</th>
             <th style="padding:6px 6px;width:90px">Rate</th>
             <th style="padding:6px 6px;width:90px;text-align:right">Amount</th>
             <th style="padding:6px 4px;width:24px"></th>
           </tr></thead>
           <tbody id="prm-tbody"></tbody>
         </table>
       </div>
       <datalist id="prm-item-datalist"></datalist>
       <button type="button" onclick="prmAddRow()" style="margin-top:6px;background:#fef2f2;color:var(--danger);border:1px solid #fecaca;border-radius:6px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer">+ Add Item</button>
       <div style="text-align:right;font-weight:800;font-size:14px;color:var(--danger);margin-top:6px">Total: <span id="prm-total">Rs.0.00</span></div>
     </div>
     <div>
       <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Reason</label>
       <input id="prm-reason" type="text" maxlength="200" placeholder="e.g. Defective, Wrong item..." style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;outline:none;box-sizing:border-box">
     </div>
     <div>
       <label style="font-size:11px;font-weight:700;color:var(--muted);display:block;margin-bottom:4px">Notes</label>
       <input id="prm-notes" type="text" maxlength="200" placeholder="Additional notes..." style="width:100%;border:1px solid var(--border);border-radius:6px;padding:8px 10px;font-size:13px;outline:none;box-sizing:border-box">
     </div>
   </div>
   <div style="padding:12px 20px 18px;border-top:1px solid #f0f0f0;display:flex;gap:8px;justify-content:flex-end">
     <button onclick="closePurchaseReturnModal()" class="btn btn-ghost">Cancel</button>
     <button onclick="savePurchaseReturn()" class="btn btn-primary" style="padding:8px 24px;background:var(--danger);border-color:var(--danger)">&#8617; Save Return</button>
   </div>
 </div>
</div>`;
      document.body.appendChild(div.firstElementChild);
      const poSel = _el('prm-po');
      if (poSel) poSel.addEventListener('change', function() {
        const ps2 = global.PurchaseState;
        if (!ps2) return;
        const po = ps2.getAllPurchases().find(p => p.id === this.value);
        if (po) {
          const supEl = _el('prm-sup');
          if (supEl) supEl.value = po.supplierName || po.sup || '';
          const items = po.itemsList || po.items || [];
          const tb = _el('prm-tbody');
          if (tb) tb.innerHTML = '';
          if (items.length > 0) {
            items.forEach(function(it) {
              prmAddRow({ name: it.name || '', qty: it.qty || 1, rate: it.rate || it.price || 0 });
            });
          } else {
            prmAddRow();
          }
          _prmRefreshDatalist(items);
        }
      });
    }

    try {
      const ps5 = global.PurchaseState;
      const poSelFresh = _el('prm-po');
      if (poSelFresh && ps5) {
        const purchases5 = ps5.getAllPurchases().filter(function(p) { return !p._deleted; });
        const prevVal = poSelFresh.value;
        poSelFresh.innerHTML = '<option value="">&#8212; Select Purchase Bill &#8212;</option>' +
          purchases5.map(function(p) {
            return '<option value="' + _esc(p.id) + '">' + _esc(p.id) + ' &#8212; ' + _esc(p.supplierName || p.sup || '') + ' (' + _fmt(p.total || 0) + ')</option>';
          }).join('');
        if (prevVal) poSelFresh.value = prevVal;
      }
      const supSelFresh = _el('prm-sup');
      if (supSelFresh) {
        const prevSupVal = supSelFresh.value;
        supSelFresh.innerHTML = '<option value="">&#8212; Select &#8212;</option>' +
          _suppliers().map(function(s) {
            return '<option value="' + _esc(s.n || s.name || '') + '">' + _esc(s.n || s.name || '') + '</option>';
          }).join('');
        if (prevSupVal) supSelFresh.value = prevSupVal;
      }
    } catch (_refreshErr) { console.warn('[openPurchaseReturnModal] dropdown refresh error:', _refreshErr); }

    const m = _el('purchReturnModalBg');
    if (!m) return;
    const dateEl = _el('prm-date'); if (dateEl) dateEl.value = _today();
    const tb0 = _el('prm-tbody'); if (tb0) tb0.innerHTML = '';
    const resEl = _el('prm-reason'); if (resEl) resEl.value = '';
    const notEl = _el('prm-notes'); if (notEl) notEl.value = '';
    if (purchaseId) {
      const poSel = _el('prm-po');
      if (poSel) { poSel.value = purchaseId; poSel.dispatchEvent(new Event('change')); }
    } else {
      _prmRefreshDatalist([]);
      prmAddRow();
    }
    m.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    setTimeout(() => { const el = _el('prm-tbody')?.querySelector('input[type="text"]'); if (el) el.focus(); }, 100);
  }

  function _prmRefreshDatalist(poItems) {
    const dl = _el('prm-item-datalist');
    if (!dl) return;
    const names = new Set();
    (poItems || []).forEach(function(it) { if (it && it.name) names.add(it.name); });
    _inventory().forEach(function(p) { if (p && p.n) names.add(p.n); });
    dl.innerHTML = Array.from(names).map(function(n) { return '<option value="' + _esc(n) + '">'; }).join('');
  }

  function prmAddRow(prefill) {
    const tb = _el('prm-tbody');
    if (!tb) return;
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #f0f0f0';

    const tdName = document.createElement('td');
    tdName.style.cssText = 'padding:3px 4px';
    const niName = document.createElement('input');
    niName.type = 'text';
    niName.setAttribute('list', 'prm-item-datalist');
    niName.placeholder = 'Item name...';
    niName.maxLength = 200;
    niName.style.cssText = 'width:100%;border:1px solid var(--border);border-radius:4px;padding:5px 6px;font-size:12px;outline:none;box-sizing:border-box';
    if (prefill && prefill.name) niName.value = prefill.name;
    tdName.appendChild(niName);

    const tdQty = document.createElement('td');
    tdQty.style.cssText = 'padding:3px 4px;width:60px';
    const niQty = document.createElement('input');
    niQty.type = 'number'; niQty.min = '1'; niQty.step = '1';
    niQty.value = (prefill && prefill.qty) || 1;
    niQty.style.cssText = 'width:100%;border:1px solid var(--border);border-radius:4px;padding:5px 4px;font-size:12px;text-align:center;outline:none';
    tdQty.appendChild(niQty);

    const tdRate = document.createElement('td');
    tdRate.style.cssText = 'padding:3px 4px;width:90px';
    const niRate = document.createElement('input');
    niRate.type = 'number'; niRate.min = '0'; niRate.step = '0.01';
    niRate.value = (prefill && prefill.rate) || 0;
    niRate.style.cssText = 'width:100%;border:1px solid var(--border);border-radius:4px;padding:5px 4px;font-size:12px;text-align:right;outline:none';
    tdRate.appendChild(niRate);

    const tdAmt = document.createElement('td');
    tdAmt.className = 'prm-row-amt';
    tdAmt.style.cssText = 'padding:6px 4px;text-align:right;font-size:12px;font-weight:700;color:#333';
    tdAmt.textContent = '0';

    const tdDel = document.createElement('td');
    tdDel.style.cssText = 'padding:3px 2px;width:24px';
    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.title = 'Remove item';
    btnDel.innerHTML = '&#10005;';
    btnDel.style.cssText = 'width:20px;height:20px;border:1px solid var(--border);border-radius:3px;background:#fff;color:#999;cursor:pointer;font-size:11px;line-height:1';
    btnDel.addEventListener('click', function() { tr.remove(); prmCalcTotal(); });
    tdDel.appendChild(btnDel);

    [niQty, niRate].forEach(function(inp) {
      inp.addEventListener('input', prmCalcTotal);
      inp.addEventListener('change', prmCalcTotal);
    });
    niName.addEventListener('change', function() {
      if (!niRate.value || niRate.value === '0') {
        const inv = _inventory();
        const part = inv.find(function(p) { return (p.n || '').toLowerCase().trim() === niName.value.toLowerCase().trim(); });
        if (part) {
          const cp = _num(part.cp || part.pp || part.price, 0);
          if (cp > 0) { niRate.value = cp; prmCalcTotal(); }
        }
      }
    });

    tr.append(tdName, tdQty, tdRate, tdAmt, tdDel);
    tb.appendChild(tr);
    prmCalcTotal();
  }

  function prmCalcTotal() {
    const rows = document.querySelectorAll('#prm-tbody tr');
    let total = 0;
    rows.forEach(function(row) {
      const nums = row.querySelectorAll('input[type="number"]');
      const qty = Math.max(0, _num(nums[0]?.value, 0));
      const rate = Math.max(0, _num(nums[1]?.value, 0));
      const amt = Math.round(qty * rate * 100) / 100;
      const amtCell = row.querySelector('.prm-row-amt');
      if (amtCell) amtCell.textContent = _fmt(amt);
      total += amt;
    });
    const totalEl = _el('prm-total');
    if (totalEl) totalEl.textContent = _fmt(total);
    return Math.round(total * 100) / 100;
  }

  function closePurchaseReturnModal() {
    const m = _el('purchReturnModalBg');
    if (m) { m.style.display = 'none'; document.body.style.overflow = ''; }
  }

  const _LEDGER_RETRY_KEY = 'mh_purchase_ledger_retry_queue';

  function _queueLedgerRetry(entry) {
    try {
      var list = JSON.parse(localStorage.getItem(_LEDGER_RETRY_KEY) || '[]');
      list.push(Object.assign({ queuedAt: Date.now() }, entry));
      localStorage.setItem(_LEDGER_RETRY_KEY, JSON.stringify(list));
    } catch (_) {}
  }

  function _retryQueuedLedgerEntries() {
    try {
      var ps2 = global.PurchaseState;
      if (!ps2 || typeof ps2.writeLedgerEntry !== 'function') return;
      var list = JSON.parse(localStorage.getItem(_LEDGER_RETRY_KEY) || '[]');
      if (!list.length) return;
      var stillFailed = [];
      list.forEach(function (entry) {
        var res = ps2.writeLedgerEntry(entry);
        if (!res || !res.ok) stillFailed.push(entry);
      });
      localStorage.setItem(_LEDGER_RETRY_KEY, JSON.stringify(stillFailed));
      if (list.length !== stillFailed.length) {
        console.info('[PurchaseServices] Retried ' + (list.length - stillFailed.length) + ' pending supplier-ledger entr(y/ies).');
      }
    } catch (e) { console.warn('[PurchaseServices] _retryQueuedLedgerEntries error:', e); }
  }
  // Sweep any ledger entries that failed to save in a previous session as
  // soon as this module (and PurchaseState) are ready.
  try { setTimeout(_retryQueuedLedgerEntries, 1500); } catch (_) {}

  function savePurchaseReturn() {
    try {
      const ps = global.PurchaseState;
      if (!ps || typeof ps.addReturn !== 'function') {
        _toast('PurchaseState not loaded', 'error'); return;
      }
      const purchaseId = (_el('prm-po')?.value || '').trim();
      const supplierName = (_el('prm-sup')?.value || '').trim();
      if (!supplierName) { _toast('Supplier is required', 'warning'); return; }
      const supplierId = (global.ERP && global.ERP.parties && typeof global.ERP.parties.resolveSupplierId === 'function')
        ? global.ERP.parties.resolveSupplierId(supplierName)
        : _lc(supplierName);
      const date = (_el('prm-date')?.value || _today()).trim();
      const reason = (_el('prm-reason')?.value || '').trim();
      const notes = (_el('prm-notes')?.value || '').trim();

      const invSvc = global.ERP?.InventoryService || global.InventoryService;
      const inv = ((global.ERP && global.ERP.getState && global.ERP.getState().data && global.ERP.getState().data.inventory) || []).filter(function(i) { return !i._archived; });

      const rows = document.querySelectorAll('#prm-tbody tr');
      const items = [];
      let amount = 0;
      for (const row of rows) {
        const nameInp = row.querySelector('input[type="text"]');
        const nums = row.querySelectorAll('input[type="number"]');
        const name = (nameInp?.value || '').trim();
        if (!name) continue;
        const qty = Math.max(1, _num(nums[0]?.value, 1));
        const rate = Math.max(0, _num(nums[1]?.value, 0));
        const rowAmount = Math.round(qty * rate * 100) / 100;
        if (rowAmount <= 0) continue;

        const matchedInv = inv.find(function(i) { return (i.n || '').toLowerCase() === name.toLowerCase(); });
        const bc = (matchedInv && matchedInv.bc) || '';
        let unitCost = rate;
        if (!unitCost && bc && invSvc && typeof invSvc.getAvgCost === 'function') {
          unitCost = invSvc.getAvgCost(bc) || 0;
        }

        items.push({ name, bc, qty, rate, amount: rowAmount, unitCostPaisa: Math.round(unitCost * 100) });
        amount += rowAmount;
      }

      if (!items.length) { _toast('At least one item is required', 'warning'); return; }
      amount = Math.round(amount * 100) / 100;

      const payload = {
        purchaseId, supplierName,
        supplierId: supplierId,
        date, reason, notes,
        returnType: purchaseId ? 'po' : 'free',
        items,
        total: amount,
      };

      const r = ps.addReturn(payload);
      if (!r || !r.ok) { _toast('Save failed: ' + (r?.error || 'unknown'), 'error'); return; }

      const totalPaisa = Math.round(amount * 100);
      const retDocId = r.id;

      try {
        if (invSvc && typeof invSvc.deduct === 'function') {
          var entries = payload.items.map(function(it) {
            return { barcode: it.bc, qty: Number(it.qty) || 0, unitCostPaisa: it.unitCostPaisa };
          }).filter(function(e) { return e.barcode && e.qty > 0; });
          var _unmatchedRetItems = payload.items.filter(function(it){ return !it.bc; }).map(function(it){ return it.name; }).filter(Boolean);
          if (_unmatchedRetItems.length) {
            _toast('Stock not tracked for: ' + _unmatchedRetItems.join(', ') + '. Stock not adjusted for these.', 'warning', 6000);
          }
          if (entries.length) {
            const actorRet = (global.window && global.window.currentUser && global.window.currentUser.name) || 'system';
            const _retDeductRes = invSvc.deduct(entries, { sourceModule: 'purchase_return', documentId: retDocId, actor: actorRet, skipGLBridge: true });
            if (_retDeductRes && !_retDeductRes.ok) {
              console.error('[savePurchaseReturn] Stock deduct failed:', _retDeductRes.error);
              _toast('\u26a0\ufe0f Return stock not updated: ' + (_retDeductRes.error || 'unknown'), 'warning');
            }
          }
        }
      } catch (invErr) { console.error('[savePurchaseReturn] stock deduct error:', invErr); }

      const ledgerEntryPayload = {
        type: 'PURCHASE_RETURN',
        supplierId: payload.supplierId || payload.supplierName,
        debit: totalPaisa,
        credit: 0,
        date: date,
        referenceId: retDocId,
        note: 'Purchase return: ' + (reason || notes || ''),
      };
      const ledgerResult = ps.writeLedgerEntry(ledgerEntryPayload);
      if (!ledgerResult || !ledgerResult.ok) {
        const ledErr = (ledgerResult && ledgerResult.error) || 'unknown error';
        console.error('[savePurchaseReturn] writeLedgerEntry failed:', ledErr);
        _queueLedgerRetry(ledgerEntryPayload);
        _toast('⚠️ Return saved but supplier balance not updated — ' + ledErr + '. Will retry automatically; you can also check Settings for pending sync.', 'warning', 8000);
      }

      try {
        const pe = global.ERP?.PostingEngine || global.PostingEngine;
        if (pe && typeof pe.post === 'function') {
          pe.post({
            documentId: retDocId,
            documentType: 'PURCHASE_RETURN',
            date: date,
            memo: 'Purchase return: ' + (reason || notes || supplierName),
            entries: [
              { accountId: 'acc-2001', description: 'Accounts Payable', debit: totalPaisa, credit: 0 },
              { accountId: 'acc-1200', description: 'Inventory Asset', debit: 0, credit: totalPaisa }
            ]
          }).catch(function(glPostErr) {
            console.error('[savePurchaseReturn] GL post async rejection:', glPostErr && glPostErr.message || glPostErr);
          });
        }
      } catch (glErr) { console.error('[savePurchaseReturn] GL post error:', glErr); }

      try { if (global.PurchaseBridge?.syncToERPState) global.PurchaseBridge.syncToERPState(); } catch (_) {}
      try { document.dispatchEvent(new CustomEvent('purchase:return:saved', { detail: { id: r.id || r.data?.id } })); } catch (_) {}

      closePurchaseReturnModal();
      try { if (typeof renderPurchaseReturnPage === 'function') renderPurchaseReturnPage(); } catch (_) {}
      try { if (typeof renderPurchases === 'function') renderPurchases(); } catch (_) {}
      try { if (typeof renderPurchaseStats === 'function') renderPurchaseStats(); } catch (_) {}
      try { document.dispatchEvent(new CustomEvent('dashboard:refresh')); } catch (_) {}
      _toast('Return saved: ' + (r.id || r.data?.id), 'success');
    } catch (e) {
      _toast('Return save error: ' + e.message, 'error');
    }
  }

  const _claimedGlobals = (global.__purchaseServicesClaimed = global.__purchaseServicesClaimed || new Set());
  const _exposeGlobal = (name, fn) => {
    if (typeof fn !== 'function') return;
    if (global[name] === fn) return;
    if (typeof global[name] === 'function' && !_claimedGlobals.has(name)) {
      console.error('[purchase.ui] refused to overwrite foreign global: ' + name);
      return;
    }
    try {
      Object.defineProperty(global, name, { value: fn, writable: false, configurable: true, enumerable: true });
      _claimedGlobals.add(name);
    } catch (e) {
      console.error('[purchase.ui] failed to expose global: ' + name, e);
    }
  };

  _exposeGlobal('openPurModal', openPurModal);
  _exposeGlobal('closePurModal', closePurModal);
  _exposeGlobal('openPurchaseModal', openPurModal);
  _exposeGlobal('pmAddRow', pmAddRow);
  _exposeGlobal('pmUpdateRowNums', pmUpdateRowNums);
  _exposeGlobal('pmFillItemPrice', pmFillItemPrice);
  _exposeGlobal('pmCalc', pmCalc);
  _exposeGlobal('pmTogglePaid', pmTogglePaid);
  _exposeGlobal('pmFillPhone', pmFillPhone);
  _exposeGlobal('pmOnPartySelect', pmOnPartySelect);
  _exposeGlobal('pmRefreshInvList', pmRefreshInvList);
  _exposeGlobal('pmShareMenu', pmShareMenu);
  _exposeGlobal('purAddRow', pmAddRow);
  _exposeGlobal('addPurRow', pmAddRow);
  _exposeGlobal('purCalc', pmCalc);
  _exposeGlobal('calcPur', pmCalc);
  _exposeGlobal('pmSave', pmSave);
  _exposeGlobal('pmSaveAndShare', _pmSaveAndShareWA);
  _exposeGlobal('pmPrint', pmPrint);
  _exposeGlobal('printPurchaseOrder', printPurchaseOrder);
  _exposeGlobal('viewPurchaseOrder', viewPurchaseOrder);
  _exposeGlobal('editPurchase', editPurchase);
  _exposeGlobal('completePurchase', completePurchase);
  _exposeGlobal('deletePurchase', deletePurchase);
  _exposeGlobal('renderPurchases', renderPurchases);
  _exposeGlobal('renderPurchaseLedger', renderPurchaseLedger);
  _exposeGlobal('renderPurchaseStats', renderPurchaseStats);
  _exposeGlobal('searchPurchases', searchPurchases);
  _exposeGlobal('filterPurchases', filterPurchases);
  _exposeGlobal('_renderPurchaseList', _renderPurchaseList);
  function searchPurchaseReturns(query) {
    try {
      if (typeof global.PurchaseReturns !== 'undefined' && typeof global.PurchaseReturns.search === 'function') {
        global.PurchaseReturns.search(query);
        return;
      }
      const q = (query || '').toLowerCase().trim();
      const pv = _el('pv-purchasereturn');
      if (!pv) return;
      const rows = pv.querySelectorAll('tbody tr');
      rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = (!q || text.includes(q)) ? '' : 'none';
      });
    } catch (e) { console.warn('[searchPurchaseReturns]', e); }
  }

  _exposeGlobal('searchPurchaseReturns', searchPurchaseReturns);
  _exposeGlobal('openPurchaseReturnModal', openPurchaseReturnModal);
  _exposeGlobal('prmAddRow', prmAddRow);
  _exposeGlobal('closePurchaseReturnModal', closePurchaseReturnModal);
  _exposeGlobal('savePurchaseReturn', savePurchaseReturn);
  _exposeGlobal('viewPurchaseReturn', viewPurchaseReturn);
  _exposeGlobal('deletePurchaseReturn', deletePurchaseReturn);
  _exposeGlobal('_purReturnSearch', _purReturnSearch);

  global.PurchaseReturns = {
    view: viewPurchaseReturn,
    deleteReturn: deletePurchaseReturn,
    search: function(q) {
      const el = document.getElementById('search-pur-returns');
      if (el) { el.value = q || ''; el.dispatchEvent(new Event('input')); }
    },
    refresh: renderPurchaseReturnPage,
  };

  if (typeof ERP !== 'undefined' && typeof ERP.registerRenderer === 'function') {
    ERP.registerRenderer('purchasereturn', renderPurchaseReturnPage);
  } else {
    var _prevRetLogin = typeof window.onModuleLoginSuccess === 'function'
      ? window.onModuleLoginSuccess : null;
    window.onModuleLoginSuccess = function () {
      if (_prevRetLogin) { try { _prevRetLogin(); } catch (_e) {} }
      if (typeof ERP !== 'undefined' && typeof ERP.registerRenderer === 'function')
        ERP.registerRenderer('purchasereturn', renderPurchaseReturnPage);
    };
  }

  global.PurchaseUI = {
    openPurModal, closePurModal,
    pmSave,
    pmAddRow, pmCalc, pmTogglePaid, pmFillPhone, pmFillItemPrice, pmRefreshInvList, pmShareMenu,
    pmPrint, printPurchaseOrder,
    viewPurchaseOrder, editPurchase, completePurchase, deletePurchase,
    renderPurchases, renderPurchaseLedger, renderPurchaseStats,
    searchPurchases, filterPurchases,
    getPmGrand: () => _pmGrand,
    setPmGrand: (v) => { _pmGrand = v; },
  };

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
