;(function (global) {
  'use strict';

  if (!global.PurchaseState) {
    throw new Error('[PurchaseOrders] PurchaseState not loaded. Load purchase_state.js first.');
  }

  const PS = global.PurchaseState;

  const MAX_ITEM_RATE = typeof global.MAX_PO_ITEM_RATE === 'number'
    ? global.MAX_PO_ITEM_RATE : 10000000;

  const MIN_ORDER_VALUE = typeof global.MIN_PO_ORDER_VALUE === 'number'
    ? global.MIN_PO_ORDER_VALUE : 100;

  const _getCreditLimit = (supplierIdOrName) => {
    if (!supplierIdOrName) return Infinity;
    const tbl = global.SUPPLIER_CREDIT_LIMITS;
    if (tbl && typeof tbl === 'object') {
      const key = String(supplierIdOrName).toLowerCase().trim();
      const limit = tbl[key] ?? tbl[supplierIdOrName];
      if (typeof limit === 'number') return limit;
    }
    const sups = global.window?.suppliers || global.suppliers || [];
    const sup = sups.find(s =>
      (s.n || s.name || '').toLowerCase().trim() === String(supplierIdOrName).toLowerCase().trim() ||
      s.id === supplierIdOrName
    );
    if (sup && typeof sup.creditLimit === 'number') return sup.creditLimit;
    return Infinity;
  };

  const PO_TRANSITIONS = {
    draft: new Set(['draft', 'pending', 'confirmed', 'cancelled']),
    pending: new Set(['pending', 'confirmed', 'partial', 'received', 'cancelled']),
    confirmed: new Set(['pending', 'confirmed', 'partial', 'received', 'cancelled']),
    partial: new Set(['partial', 'received', 'cancelled']),
    received: new Set([]),
    cancelled: new Set([]),
  };

  const _validatePOTransition = (from, to) => {
    const allowed = PO_TRANSITIONS[from];

    if (!allowed) return false;
    return allowed.has(to);
  };

  const _esc = (s) => {
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(String(s ?? ''));
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  const _today = () => {
    if (typeof global.ERP !== 'undefined' && global.ERP.DateUtils && typeof global.ERP.DateUtils.today === 'function')
      return global.ERP.DateUtils.today();
    const d = new Date();
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const pkTime = new Date(utc + (5 * 60 * 60000));
    return `${pkTime.getFullYear()}-${String(pkTime.getMonth() + 1).padStart(2, '0')}-${String(pkTime.getDate()).padStart(2, '0')}`;
  };

  const _lc = (s) => (s || '').toString().toLowerCase().trim().replace(/\s+/g, ' ');
  const _num = (v, def = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : def; };
  const _r2 = (n) => Math.round(n * 100) / 100;
  const _fmt = (n) => (typeof global.ERP !== 'undefined' && global.ERP.fmt) ? global.ERP.fmt(n) : 'Rs.' + _num(n, 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const _toast = (msg, type = 'info') => {
    if (typeof global.showToast === 'function') global.showToast(msg, type);
    else if (window.DEBUG_MODE) console.log(`[PurchaseOrders][${type}] ${msg}`);
  };

  const _el = (id) => document.getElementById(id);
  const _val = (id) => ((_el(id) || {}).value || '').trim();

  const _persist = () => {
    const r = PS.save();
    if (r && !r.ok) {
      if (r.quota) _toast('Storage full! Export and clear old data.', 'error');
      else console.error('[PurchaseOrders] PS.save() failed:', r.error);
    }
  };

  const _hasPermission = (requiredRole = 'user') => {
    const roleLevel = { admin: 3, manager: 2, user: 1, viewer: 0 };
    const userRole = _lc(global.window?.currentUser?.role || global.currentUser?.role || 'viewer');
    const required = roleLevel[requiredRole] ?? 1;
    const actual = roleLevel[userRole] ?? 0;
    return actual >= required;
  };

  let _searchQuery = '';
  let _activeFilter = 'all';
  let _editingPOId = null;

  const _regexEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const _applyFilterSearch = (orders) => {
    const byStatus = _activeFilter === 'all'
      ? orders
      : orders.filter(o => _lc((o.status || o.st) || '') === _lc(_activeFilter));

    if (!_searchQuery) return byStatus;
    const pattern = new RegExp(_regexEscape(_searchQuery), 'i');
    return byStatus.filter(o => {
      if (pattern.test(o.id || '')) return true;
      if (pattern.test(o.supplierName || '')) return true;
      if (pattern.test(o.supplierId || '')) return true;
      if (pattern.test(o.date || '')) return true;
      if (pattern.test((o.status || o.st) || '')) return true;
      if (Array.isArray(o.items)) {
        for (const item of o.items) {
          if (pattern.test(item.name || '')) return true;
        }
      }
      return false;
    });
  };

  const _computePOStats = (orders) => {
    const pending = orders.filter(o => _lc((o.status || o.st) || '') === 'pending').length;
    const received = orders.filter(o => _lc((o.status || o.st) || '') === 'received').length;
    const total = orders.reduce((s, o) => s + _num((o.total || o.amt), 0), 0);
    const ACTIVE_STATUSES = new Set(['pending', 'confirmed', 'partial']);
    const overdue = orders.filter(o => {
      const st = _lc((o.status || o.st) || '');
      return ACTIVE_STATUSES.has(st) && o.expectedDate && o.expectedDate < _today();
    }).length;
    return { pending, received, total, overdue };
  };

  const _buildStatCards = (s) => window.renderStatCards([
    { icon:'📋', value:_esc(String(s.pending)),               label:'Pending Orders', color:'#4338CA', bg:'#eff6ff' },
    { icon:'✅', value:_esc(String(s.received)),               label:'Received',       color:'#16a34a', bg:'#f0fdf4' },
    { icon:'💰', value:_fmt(s.total), label:'Total Value',    color:'#d97706', bg:'#fffbeb' },
    { icon:'⚠️', value:_esc(String(s.overdue)),                label:'Overdue',        color: s.overdue > 0 ? '#dc2626' : '#6b7280', bg: s.overdue > 0 ? '#fef2f2' : '#f9fafb' },
  ], { gridCls:'stat-grid' });

  const _statusBadge = (st) => {
    const map = {
      pending: 'b-blue',
      received: 'b-green',
      partial: 'b-orange',
      cancelled: 'b-red',
      confirmed: 'b-purple',
      draft: 'b-gray',
    };
    return '<span class="badge ' + (map[_lc(st)] || 'b-gray') + '">' + _esc(st || 'pending') + '</span>';
  };

  const _buildTableRows = (orders) => {
    if (!orders.length) {
      return '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted)">No purchase orders found</td></tr>';
    }
    return orders.map(o => {
      const id = _esc(o.id || '—');
      const sup = _esc((o.supplierName || o.sup) || '—');
      const date = _esc(o.date || '—');
      const expected = _esc(o.expectedDate || o.due || '—');
      const total = _fmt(_num((o.total || o.amt), 0));
      const st = _lc((o.status || o.st) || 'pending');
      const isOverdue = (st === 'pending' || st === 'confirmed' || st === 'partial') && o.expectedDate && o.expectedDate < _today();
      const safePid = _esc(o.id || '');
      const overdueFlag = isOverdue
        ? ' <span style="color:var(--danger,#ef4444);font-size:10px;font-weight:700">⚠️ OVERDUE</span>'
        : '';

      return '<tr' + (isOverdue ? ' style="background:var(--danger-light,#fef2f2)"' : '') + '>' +
        '<td class="mono fw">' + id + '</td>' +
        '<td class="fw">' + sup + '</td>' +
        '<td>' + date + '</td>' +
        '<td>' + expected + overdueFlag + '</td>' +
        '<td class="mono" style="color:var(--gold);font-weight:700">' + total + '</td>' +
        '<td>' + _statusBadge((o.status || o.st) || 'pending') + '</td>' +
        '<td><div style="display:flex;gap:4px;flex-wrap:wrap">' +
        '<button class="btn btn-ghost btn-sm" type="button" onclick="PurchaseOrders.view(\'' + safePid + '\')" title="View">👁</button>' +
        '<button class="btn btn-primary btn-sm" type="button" onclick="PurchaseOrders.printPO(\'' + safePid + '\')" title="Print">🖨</button>' +
        (st === 'pending' || st === 'confirmed' || st === 'partial' ? '<button class="btn btn-success btn-sm" type="button" onclick="PurchaseOrders.receive(\'' + safePid + '\')" title="Mark Received">✅</button>' : '') +
        (st !== 'received' && st !== 'cancelled' && st !== 'returned' ? '<button class="btn btn-ghost btn-sm" type="button" data-action="edit" data-id="' + safePid + '" title="Edit">✏️</button>' : '') +
        (st !== 'received' && st !== 'cancelled' ? '<button class="btn btn-ghost btn-sm" type="button" data-action="cancel" data-id="' + safePid + '" title="Cancel">🚫</button>' : '') +
        '<button class="btn btn-danger btn-sm" type="button" onclick="PurchaseOrders.deleteOrder(\'' + safePid + '\')" title="Delete">🗑</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');
  };

  const renderPurchaseOrderPage = () => {
    const el = _el('pv-purchaseorders') || _el('pv-purchase-orders');
    if (!el) return;

    const allOrders = PS.getAllPurchaseOrders();
    const stats = _computePOStats(allOrders);
    const display = _applyFilterSearch(allOrders);
    const ACTIVE_ST = new Set(['pending', 'confirmed', 'partial']);
    const overdueList = allOrders.filter(o =>
      ACTIVE_ST.has(_lc((o.status || o.st) || '')) && o.expectedDate && o.expectedDate < _today()
    );
    if (overdueList.length > 0) {
      console.warn(`[PurchaseOrders] ${overdueList.length} PO(s) are overdue:`, overdueList.map(o => o.id));
    }

    el.innerHTML = (
      _buildStatCards(stats) +
      '<div class="toolbar">' +
      '<div class="search-box">' +
      '<svg><use href="#ic-search"/></svg>' +
      '<input id="por-search-input" placeholder="Search purchase orders..." ' +
      'oninput="PurchaseOrders.search(this.value)" ' +
      'value="' + _esc(_searchQuery) + '" autocomplete="off">' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
      ['all','draft','pending','confirmed','partial','received','cancelled'].map(f =>
        '<button type="button" class="filter-btn' + (_activeFilter === f ? ' active' : '') +
        '" onclick="PurchaseOrders.filter(\'' + _esc(f) + '\')">' + _esc(f.charAt(0).toUpperCase() + f.slice(1)) + '</button>'
      ).join('') +
      '</div>' +
      '<button class="btn btn-danger btn-sm" type="button" onclick="PurchaseOrders.openNew()">' +
      '<svg><use href="#ic-plus"/></svg> New PO' +
      '</button>' +
      '</div>' +
      '<div class="panel">' +
      '<table class="dt">' +
      '<thead><tr>' +
      '<th>PO #</th><th>Supplier</th><th>Date</th><th>Expected</th>' +
      '<th>Total</th><th>Status</th><th>Actions</th>' +
      '</tr></thead>' +
      '<tbody id="por-tbody">' + _buildTableRows(display) + '</tbody>' +
      '</table>' +
      '</div>'
    );
    try { document.dispatchEvent(new CustomEvent('purchaserendered')); } catch (_) {}
  };

  const _refreshList = () => {
    const tbody = _el('por-tbody');
    if (!tbody) { renderPurchaseOrderPage(); return; }
    const orders = PS.getAllPurchaseOrders();
    const stats = _computePOStats(orders);
    const sc = document.querySelector('#pv-purchaseorders .stat-grid') || document.querySelector('#pv-purchase-orders .stat-grid');
    if (sc) {

      const tmp = document.createElement('div');
      tmp.innerHTML = _buildStatCards(stats);
      const newSc = tmp.firstElementChild;
      if (newSc) sc.parentNode.replaceChild(newSc, sc);
    }
    tbody.innerHTML = _buildTableRows(_applyFilterSearch(orders));
    try { document.dispatchEvent(new CustomEvent('purchaserendered')); } catch (_) {}
  };

  const _buildModalHTML = (existing) => {
    const sups = global.window?.suppliers || global.suppliers || [];
    const supOpts = sups.map(s => '<option value="' + _esc(s.n || '') + '"></option>').join('');
    const isEdit = !!existing;
    const title = _esc(isEdit ? '✏️ Edit Purchase Order' : '📋 New Purchase Order');

    const items = isEdit && Array.isArray(existing.items) ? existing.items : [];

    const itemRows = (items.length > 0 ? items : [{}]).map((it, i) =>
      '<tr id="por-item-row-' + i + '">' +
      '<td style="padding:3px 4px;color:#999;font-size:11px;text-align:center">' + (i + 1) + '</td>' +
      '<td style="padding:3px 6px"><input class="fi" type="text" placeholder="Item..." maxlength="200" ' +
      'value="' + _esc(it.name || '') + '" style="width:100%" list="pm-inv-list" ' +
      'oninput="PurchaseOrders.onItemInput(this)" onchange="PurchaseOrders.onItemInput(this)">' +
      '<div class="por-item-hint" style="font-size:10px;margin-top:2px"></div></td>' +
      '<td style="padding:3px 6px"><input class="fi" type="number" placeholder="Qty" min="0.01" ' +
      'value="' + _esc(String(it.qty || 1)) + '" style="width:64px" oninput="PurchaseOrders.calcRow(this)"></td>' +
      '<td style="padding:3px 6px"><input class="fi" type="number" placeholder="Rate" min="0" ' +
      'max="' + _esc(String(MAX_ITEM_RATE)) + '" ' +
      'value="' + _esc(String(it.rate || 0)) + '" style="width:90px" oninput="PurchaseOrders.calcRow(this)"></td>' +
      '<td style="padding:3px 6px"><input class="fi" type="text" readonly value="' +
      _esc(String(_r2((it.qty || 1) * (it.rate || 0)))) + '" style="width:80px;background:var(--bg,#f8fafc)"></td>' +
      '<td style="padding:3px 4px">' +
      '<button type="button" class="btn btn-ghost btn-sm" onclick="PurchaseOrders.removeItemRow(this)" title="Remove row" ' +
      'style="padding:2px 6px;font-size:11px">✕</button>' +
      '</td>' +
      '</tr>'
    ).join('');

    return (
      '<div class="modal-overlay" id="purchaseOrderModal">' +
      '<div class="modal lg">' +
      '<div class="modal-head">' +
      '<h2>' + title + '</h2>' +
      '<button class="modal-close" type="button" onclick="PurchaseOrders.closeModal()">✕</button>' +
      '</div>' +
      '<div class="modal-body" style="padding:16px;display:flex;flex-direction:column;gap:10px">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '<div class="fgrp">' +
      '<label for="por-sup">Supplier <span style="color:red">*</span></label>' +
      '<input class="fi" id="por-sup" list="por-sup-list" placeholder="Supplier name" autocomplete="off" ' +
      'oninput="PurchaseOrders.onSupInput(this)" onchange="PurchaseOrders.onSupInput(this)" onblur="PurchaseOrders.onSupInput(this)" ' +
      'value="' + _esc(existing?.supplierName || '') + '">' +
      '<datalist id="por-sup-list">' + supOpts + '</datalist>' +
      '<div id="por-sup-hint" style="font-size:11px;margin-top:3px"></div>' +
      '</div>' +
      '<div class="fgrp">' +
      '<label for="por-date">Date</label>' +
      '<input class="fi" id="por-date" type="date" value="' + _esc(existing?.date || _today()) + '">' +
      '</div>' +
      '<div class="fgrp">' +
      '<label for="por-expected">Expected Delivery</label>' +
      '<input class="fi" id="por-expected" type="date" value="' + _esc(existing?.expectedDate || '') + '">' +
      '</div>' +
      '<div class="fgrp">' +
      '<label for="por-notes">Notes</label>' +
      '<input class="fi" id="por-notes" placeholder="Optional..." maxlength="500" value="' + _esc(existing?.notes || '') + '">' +
      '</div>' +
      '</div>' +
      '<div style="font-weight:700;font-size:13px;margin-top:4px">Items</div>' +
      '<table class="dt" style="font-size:12px">' +
      '<thead><tr>' +
      '<th style="width:30px">#</th>' +
      '<th>Item Name</th><th>Qty</th><th>Rate</th><th>Amount</th><th></th>' +
      '</tr></thead>' +
      '<tbody id="por-items-tbody">' + itemRows + '</tbody>' +
      '</table>' +
      '<button type="button" class="btn btn-ghost btn-sm" onclick="PurchaseOrders.addItemRow()" ' +
      'style="align-self:flex-start">+ Add Item</button>' +
      '<div style="display:flex;justify-content:flex-end">' +
      '<div style="background:var(--light,#f8fafc);border-radius:8px;padding:12px 20px;text-align:right">' +
      '<div style="font-size:12px;color:var(--muted)">Grand Total</div>' +
      '<div id="por-grand-total" style="font-size:20px;font-weight:800;color:var(--gold)">Rs.0.00</div>' +
      '</div>' +
      '</div>' +
      '<div id="por-credit-warning" style="display:none;background:var(--danger-light,#fef2f2);' +
      'border:1px solid var(--danger,#ef4444);border-radius:8px;padding:10px;font-size:12px;color:var(--danger,#ef4444)">' +
      '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
      '<button class="btn btn-ghost" type="button" onclick="PurchaseOrders.closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" type="button" id="por-save-btn" onclick="PurchaseOrders.savePO()">💾 ' +
      (isEdit ? 'Update PO' : 'Create PO') +
      '</button>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  };

  const _openModal = () => {
    try {
      if (typeof global.openModal === 'function') global.openModal('purchaseOrderModal');
    } catch (_) {}
  };

  const _closeModal = () => {
    _editingPOId = null;
    try {
      if (typeof global.closeModal === 'function') global.closeModal('purchaseOrderModal');
    } catch (_) {
      const m = _el('purchaseOrderModal');
      if (m) m.remove();
    }
  };

  const openNew = () => {
    _editingPOId = null;
    const old = _el('purchaseOrderModal');
    if (old) old.remove();
    document.body.insertAdjacentHTML('beforeend', _buildModalHTML(null));
    _openModal();
    _recalcGrand();
  };

  const openEdit = (id) => {
    const po = PS.getPOById(id);
    if (!po) { _toast('Purchase order not found', 'error'); return; }
    const st = _lc((po.status || po.st) || '');
    if (st === 'received' || st === 'cancelled' || st === 'returned') {
      _toast('Received/Cancelled/Returned POs cannot be edited', 'warning'); return;
    }
    const html = _buildModalHTML(po);
    _editingPOId = id;
    const old = _el('purchaseOrderModal');
    if (old) old.remove();
    document.body.insertAdjacentHTML('beforeend', html);
    _openModal();
    _recalcGrand();
  };

  const closeModal = _closeModal;

  const onItemInput = (inp) => {
    try {
      const name = (inp.value || '').trim();
      const hint = inp.parentNode ? inp.parentNode.querySelector('.por-item-hint') : null;
      if (!hint) return;
      hint.innerHTML = '';
      if (!name) return;

      const inv = (() => {
        try {
          const st = ERP && typeof ERP.getState === 'function' ? ERP.getState() : null;
          return (st && st.data && st.data.inventory) || [];
        } catch (_) { return []; }
      })();

      const found = inv.find(p => (p.n || '').toLowerCase() === name.toLowerCase() || (p.bc || '') === name);
      if (!found) {
        const link = document.createElement('span');
        link.style.cssText = 'font-size:10px;cursor:pointer;font-weight:700;display:inline-flex;align-items:center;gap:3px;padding:1px 7px;background:#e8f5e9;color:#2e7d32;border:1px solid #a5d6a7;border-radius:4px;';
        link.innerHTML = '&#x2795; Add <b style="margin:0 2px">' + _esc(name) + '</b> to Inventory';
        link.addEventListener('click', function() {
          if (typeof ERP !== 'undefined' && ERP.inventory && typeof ERP.inventory.openAdd === 'function') {
            ERP.inventory.openAdd();
            const invBg = document.getElementById('invItemModal');
            if (invBg) { document.body.appendChild(invBg); invBg.style.zIndex = 'var(--zi-top,1200)'; }
          }
          try {
            if (ERP && ERP.events && ERP.events.once) {
              ERP.events.once('inventory:updated', function() {
                if (typeof pmRefreshInvList === 'function') pmRefreshInvList();
                hint.innerHTML = '';
              });
            }
          } catch (_) {}
        });
        hint.appendChild(link);
      } else {
        const row = inp.closest('tr');
        if (row) {
          const rateInput = row.querySelectorAll('input[type="number"]')[1];
          if (rateInput && (!rateInput.value || rateInput.value === '0')) {
            rateInput.value = found.cp || found.pp || 0;
            if (typeof PurchaseOrders !== 'undefined' && PurchaseOrders.calcRow) PurchaseOrders.calcRow(rateInput);
          }
        }
      }
    } catch (e) {}
  };

  const onSupInput = (inp) => {
    try {
      const rawName = (inp.value || '').trim();
      const hint = document.getElementById('por-sup-hint');
      if (!hint) return;
      hint.innerHTML = '';
      if (!rawName) return;

      const sups = (() => {
        try {
          const st = ERP && typeof ERP.getState === 'function' ? ERP.getState() : null;
          return (st && st.data && st.data.suppliers) || [];
        } catch (_) { return []; }
      })();

      const found = sups.find(s => (s.n || s.name || '').toLowerCase() === rawName.toLowerCase());
      if (!found) {
        const link = document.createElement('span');
        link.style.cssText = 'font-size:11px;cursor:pointer;font-weight:700;display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:var(--hover-blue);color:var(--primary);border:1px solid var(--primary);border-radius:4px;margin-top:2px';
        link.innerHTML = '&#x2795; Add <b style="margin:0 2px">' + _esc(rawName) + '</b> as Supplier';
        link.addEventListener('click', function() {
          if (typeof ERP !== 'undefined' && ERP.parties && typeof ERP.parties.openAdd === 'function') {
            ERP.parties.openAdd('supplier');
            setTimeout(function() {
              const n = document.getElementById('apm-name');
              if (n) n.value = rawName;
              let partyModal = document.getElementById('addPartyModal') ||
                document.getElementById('addPartyModal-bg') ||
                document.getElementById('apm-modal') ||
                document.getElementById('party-add-modal');
              if (!partyModal) {
                document.querySelectorAll('.modal-overlay, [id*="arty"][id*="odal"]').forEach(function(m) {
                  if (m.style.display === 'flex' || m.classList.contains('open')) { partyModal = m; }
                });
              }
              if (partyModal) partyModal.style.zIndex = 'var(--zi-overlay,1110)';
            }, 80);
          }
          try {
            if (ERP && ERP.events && ERP.events.once) {
              ERP.events.once('suppliers:updated', function() {
                const dl = document.getElementById('por-sup-list');
                const s2 = (() => {
                  try {
                    const st = ERP && typeof ERP.getState === 'function' ? ERP.getState() : null;
                    return (st && st.data && st.data.suppliers) || window.suppliers || [];
                  } catch (_) { return []; }
                })();
                if (dl) dl.innerHTML = s2.map(function(s) { return '<option value="' + _esc(s.n || '') + '">'; }).join('');
                inp.value = rawName;
                hint.innerHTML = '';
              });
            }
          } catch (_) {}
        });
        hint.appendChild(link);
      }
    } catch (e) {}
  };

  const addItemRow = () => {
    const tbody = _el('por-items-tbody');
    if (!tbody) return;
    const rowCount = tbody.querySelectorAll('tr').length;
    const tr = document.createElement('tr');
    tr.id = 'por-item-row-' + (Date.now()) + '-' + rowCount;
    tr.innerHTML = (
      '<td style="padding:3px 4px;color:#999;font-size:11px;text-align:center">' + (rowCount + 1) + '</td>' +
      '<td style="padding:3px 6px">' +
      '<input class="fi" type="text" placeholder="Item..." maxlength="200" style="width:100%" list="pm-inv-list"' +
      ' oninput="PurchaseOrders.onItemInput(this)" onchange="PurchaseOrders.onItemInput(this)">' +
      '<div class="por-item-hint" style="font-size:10px;margin-top:2px"></div>' +
      '</td>' +
      '<td style="padding:3px 6px"><input class="fi" type="number" placeholder="Qty" min="0.01" value="1" style="width:64px" oninput="PurchaseOrders.calcRow(this)"></td>' +
      '<td style="padding:3px 6px"><input class="fi" type="number" placeholder="Rate" min="0" max="' + _esc(String(MAX_ITEM_RATE)) + '" value="0" style="width:90px" oninput="PurchaseOrders.calcRow(this)"></td>' +
      '<td style="padding:3px 6px"><input class="fi" type="text" readonly value="0" style="width:80px;background:var(--bg,#f8fafc)"></td>' +
      '<td style="padding:3px 4px">' +
      '<button type="button" class="btn btn-ghost btn-sm" onclick="PurchaseOrders.removeItemRow(this)" style="padding:2px 6px;font-size:11px">✕</button>' +
      '</td>'
    );
    tbody.appendChild(tr);
  };

  const removeItemRow = (btn) => {
    const tr = btn.closest('tr');
    if (!tr) return;
    tr.remove();
    const tbody = _el('por-items-tbody');
    if (tbody) {
      tbody.querySelectorAll('tr').forEach((row, i) => {
        const num = row.querySelector('td:first-child');
        if (num) num.textContent = i + 1;
      });
    }
    _recalcGrand();
  };

  const calcRow = (inp) => {
    try {
      const row = inp.closest('tr');
      if (!row) return;
      const nums = row.querySelectorAll('input[type="number"]');
      let qty = Math.max(0, _num(nums[0]?.value, 0));
      let rate = Math.max(0, _num(nums[1]?.value, 0));
      if (rate > MAX_ITEM_RATE) {
        rate = MAX_ITEM_RATE;
        if (nums[1]) nums[1].value = rate;
        _toast('⚠️ Rate capped at maximum ' + MAX_ITEM_RATE.toLocaleString(), 'warning');
      }
      const amt = _r2(qty * rate);
      const readonlyInput = row.querySelectorAll('input')[3];
      if (readonlyInput) readonlyInput.value = amt;
      _recalcGrand();
    } catch (e) { console.warn('[PurchaseOrders.calcRow]', e); }
  };

  const _recalcGrand = () => {
    try {
      let grand = 0;
      const tbody = _el('por-items-tbody');
      if (tbody) {
        tbody.querySelectorAll('tr').forEach(row => {
          const readonlyInput = row.querySelectorAll('input')[3];
          grand += _num(readonlyInput?.value, 0);
        });
      }
      const el = _el('por-grand-total');
      if (el) el.textContent = '' + _fmt(_r2(grand));
      _checkCreditLimit(grand);
      return grand;
    } catch (_) { return 0; }
  };

  const _checkCreditLimit = (newOrderTotal) => {
    const warning = _el('por-credit-warning');
    if (!warning) return;
    const supName = _val('por-sup');
    if (!supName) { warning.style.display = 'none'; return; }

    const limit = _getCreditLimit(supName);
    if (!isFinite(limit)) { warning.style.display = 'none'; return; }

    const _lcSupName = supName.toLowerCase().trim();
    const allOrders = PS.getAllPurchaseOrders();
    const outstanding = allOrders.reduce((sum, o) => {

      if (_editingPOId && o.id === _editingPOId) return sum;
      const oSup = (o.supplierName || o.sup || '').toLowerCase().trim();
      if (oSup === _lcSupName) {
        const st = _lc((o.status || o.st) || '');
        if (st !== 'cancelled' && st !== 'received') return sum + _num((o.total || o.amt), 0);
      }
      return sum;
    }, 0);
    const projected = outstanding + newOrderTotal;
    if (projected > limit) {
      warning.style.display = 'block';
      warning.innerHTML = '⚠️ Credit limit exceeded for <strong>' + _esc(supName) + '</strong>. ' +
        'Limit: ' + _fmt(limit) + ' | Outstanding: ' + _fmt(outstanding) +
        ' | This PO: ' + _fmt(_r2(newOrderTotal)) +
        ' | Projected: ' + _fmt(_r2(projected));
    } else {
      warning.style.display = 'none';
    }
  };

  let _poSaving = false;
  let _creditOverride = false;

  function _confirmDialog(msg, onConfirm) {
    if (typeof _Modal !== 'undefined' && _Modal && typeof _Modal.confirm === 'function') {
      _Modal.confirm(msg, onConfirm);
      return;
    }
    const dlg = document.createElement('dialog');
    const safe = String(msg).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    dlg.innerHTML = '<form method="dialog" style="padding:1.2rem;max-width:360px"><p style="margin:0 0 1rem;white-space:pre-wrap">' + safe + '</p><div style="display:flex;gap:.6rem;justify-content:flex-end"><button value="cancel" style="padding:.4rem .9rem">Cancel</button><button value="ok" autofocus style="padding:.4rem .9rem;background:var(--primary,#4338CA);color:#fff;border:none;border-radius:4px">Confirm</button></div></form>';
    document.body.appendChild(dlg);
    dlg.showModal && dlg.showModal();
    dlg.addEventListener('close', function() { if (dlg.returnValue === 'ok') onConfirm(); document.body.removeChild(dlg); });
  }

  const savePO = () => {
    if (_poSaving) { _toast('⚠️ PO save in progress', 'warning'); return false; }
    _poSaving = true;
    const _poSaveBtn = document.getElementById('por-save-btn');
    if (_poSaveBtn) { _poSaveBtn.disabled = true; _poSaveBtn.textContent = 'Saving…'; }

    try {
      const supplierName = _val('por-sup');
      const date = _val('por-date') || _today();
      const expectedDate = _val('por-expected') || '';
      const notes = _val('por-notes') || '';

      if (!supplierName) {
        _toast('❌ Supplier name is required', 'error');
        _el('por-sup')?.focus();
        return false;
      }

      const tbody = _el('por-items-tbody');
      const items = [];
      if (tbody) {
        tbody.querySelectorAll('tr').forEach(row => {
          const inputs = row.querySelectorAll('input');
          const name = (inputs[0]?.value || '').trim();
          if (!name) return;
          const qty = Math.max(0, _num(inputs[1]?.value, 0));
          let rate = Math.max(0, _num(inputs[2]?.value, 0));
          if (qty <= 0) {
            _toast('❌ Qty must be > 0 for item "' + name + '"', 'error');
            throw new Error('invalid qty');
          }
          if (rate > MAX_ITEM_RATE) {
            rate = MAX_ITEM_RATE;
            _toast('⚠️ Rate capped at ' + MAX_ITEM_RATE.toLocaleString() + ' for "' + name + '"', 'warning');
          }
          items.push({ name, qty, rate: _r2(rate) });
        });
      }

      if (items.length === 0) {
        _toast('❌ At least one item is required', 'error');
        return false;
      }

      const total = _r2(items.reduce((s, i) => s + i.qty * i.rate, 0));

      if (total < MIN_ORDER_VALUE) {
        _toast('❌ Order total (' + _fmt(total) + ') is below minimum ' + _fmt(MIN_ORDER_VALUE), 'error');
        return false;
      }

      const creditLimit = _getCreditLimit(supplierName);
      if (isFinite(creditLimit) && !_creditOverride) {
        const outstanding = PS.getSupplierBalance(supplierName);
        const projected = outstanding + total;
        if (projected > creditLimit) {
          _confirmDialog(
            'Credit limit warning!\nSupplier "' + supplierName + '" limit: ' + _fmt(creditLimit) + '\n' +
            'Outstanding: ' + _fmt(outstanding) + '\nThis PO: ' + _fmt(total) + '\n' +
            'Projected balance: ' + _fmt(projected) + '\n\nProceed anyway?',
            function() {
              _creditOverride = true;
              savePO();
            }
          );
          return false;
        }
      }

      const payload = {
        supplierName,
        supplierId: (typeof ERP !== 'undefined' && ERP.parties && typeof ERP.parties.resolveSupplierId === 'function')
          ? ERP.parties.resolveSupplierId(supplierName)
          : _lc(supplierName),
        date, expectedDate, items, total, notes
      };

      if (_editingPOId) {
        const existing = PS.getPOById(_editingPOId);
        if (existing) {
          const currentStatus = _lc(existing.status || existing.st || 'pending');
          const NON_EDITABLE = new Set(['received', 'cancelled', 'returned']);
          if (NON_EDITABLE.has(currentStatus)) {
            _toast('❌ PO "' + _editingPOId + '" cannot be edited in status "' + currentStatus + '"', 'error');
            return false;
          }
        }
        const r = PS.updatePO(_editingPOId, payload);
        if (!r.ok) { _toast('❌ Update failed: ' + r.error, 'error'); return false; }
        _toast('✅ PO ' + _editingPOId + ' updated', 'success');
      } else {
        const r = PS.addPO(payload);
        if (!r.ok) {
          if (r.error && (r.error.includes('duplicate') || r.error.includes('already exists'))) {
            _toast('❌ Duplicate PO ID — please try again', 'error');
          } else {
            _toast('❌ Create failed: ' + r.error, 'error');
          }
          return false;
        }
        _toast('✅ Purchase Order ' + r.id + ' created', 'success');
      }

      _persist();
      _closeModal();
      _refreshList();
      return true;
    } catch (e) {
      if (e.message !== 'invalid qty') {
        _toast('❌ Save error: ' + e.message, 'error');
        console.error('[PurchaseOrders.savePO]', e);
      }
      return false;
    } finally {
      _creditOverride = false;
      _poSaving = false;
      if (_poSaveBtn) { _poSaveBtn.disabled = false; _poSaveBtn.textContent = _editingPOId ? '💾 Update PO' : '💾 Save PO'; }
    }
  };

  const receivePO = (id) => {
    try {      const po = PS.getPOById(id);
      if (!po) { _toast('PO not found', 'error'); return; }

      const currentStatus = _lc((po.status || po.st) || 'pending');

      if (!_validatePOTransition(currentStatus, 'received')) {
        _toast('❌ Cannot mark PO "' + id + '" as received from status "' + currentStatus + '"', 'error');
        return;
      }

      const _doReceive = function() {
        const today = _today();
        const pi = PS.PurchaseInventory;
        const applied = [];
        let stockFailed = false;

        const _poItems = po.items || [];
        for (let _itemIdx = 0; _itemIdx < _poItems.length; _itemIdx++) {
          const item = _poItems[_itemIdx];
          try {
            let bc = item.barcode || item.bc || item.sku || '';
            let matchedItem = null;
            if (!bc) {
              const invItems = (typeof global.ERP !== 'undefined' && global.ERP.InventoryService && typeof global.ERP.InventoryService.getAll === 'function')
                ? global.ERP.InventoryService.getAll()
                : [];
              matchedItem = invItems.find(function(i) { return (i.n || '').toLowerCase() === (item.name || '').toLowerCase(); });
              if (matchedItem && matchedItem.bc) bc = matchedItem.bc.trim();
            }
            if (!bc) throw new Error('Item "' + item.name + '" ka barcode set nahi hai — inventory mein barcode add karein');
            const idempotencyKey = 'STOCK-RCV-' + id + '-' + _itemIdx + '-' + bc;
            pi.increaseStock(bc, item.qty, { date: today, poId: id, price: item.rate, idempotencyKey: idempotencyKey, itemName: item.name, skipGLBridge: true, ref: 'PO-RCV-' + id + '-' + _itemIdx + '-' + bc });
            applied.push({ name: item.name, bc: bc, qty: item.qty });
          } catch (stockErr) {
            if (pi && typeof pi.decreaseStock === 'function') {
              for (const rb of applied) {
                try { pi.decreaseStock(rb.bc || rb.name, rb.qty, { skipGLBridge: true, ref: 'PO-RCV-ROLLBACK-' + id }); } catch (_) {}
              }
            }
            _toast('❌ Stock update failed for "' + item.name + '": ' + stockErr.message + '. PO status unchanged.', 'error');
            stockFailed = true;
            break;
          }
        }

        if (stockFailed) return;

        if (!applied.length) {
          _toast('⚠️ No items could be matched to inventory — stock not updated', 'warning');
          return;
        }

        const r = PS.updatePO(id, { status: 'received', received: true, receivedAt: today });
        if (!r.ok) {
          if (pi && typeof pi.decreaseStock === 'function') {
            for (const rb of applied) { try { pi.decreaseStock(rb.bc || rb.name, rb.qty, { skipGLBridge: true, ref: 'PO-RCV-ROLLBACK-' + id }); } catch (_) {} }
          }
          _toast('❌ Status update failed: ' + r.error + ' — stock rolled back', 'error');
          return;
        }

        _persist();

        const _rcvTotalPaisa = Math.round(_num(po.total, 0) * 100);
        const _rcvSupplierId = (po.supplierId || po.supplierName || '').toLowerCase().trim();

        if (_rcvSupplierId && _rcvTotalPaisa > 0 && typeof PS.writeLedgerEntry === 'function') {
          try {
            const _existingEntries = typeof PS.getSupplierLedgerEntries === 'function'
              ? PS.getSupplierLedgerEntries(_rcvSupplierId) : [];
            const _alreadyWritten = _existingEntries.some(e => e.type === 'PO_RECEIVED' && e.referenceId === id);
            if (!_alreadyWritten) {
              const _ledRes = PS.writeLedgerEntry({
                supplierId: _rcvSupplierId,
                type: 'PO_RECEIVED',
                debit: 0,
                credit: _rcvTotalPaisa,
                referenceId: id,
                date: today,
                note: 'Purchase Order received: ' + id,
              });
              if (!_ledRes || !_ledRes.ok) {
                console.error('[PurchaseOrders.receivePO] PO_RECEIVED ledger write failed:', _ledRes && _ledRes.error);
              }
              if (typeof PS.recalculate === 'function') PS.recalculate(_rcvSupplierId);
            }
          } catch (_) {}
        }

        try {
          const pe = global.ERP?.PostingEngine || global.PostingEngine;
          if (pe && typeof pe.isPosted === 'function' && !pe.isPosted(id) && _rcvTotalPaisa > 0) {
            pe.post({
              documentId: id,
              documentType: 'PURCHASE_ORDER',
              date: today,
              memo: 'PO received: ' + id + ' from ' + (po.supplierName || ''),
              entries: [
                { accountId: 'acc-1200', description: 'Inventory Asset', debit: _rcvTotalPaisa, credit: 0 },
                { accountId: 'acc-2001', description: 'Accounts Payable', debit: 0, credit: _rcvTotalPaisa },
              ],
            }).catch(function(glErr) {
              console.error('[PurchaseOrders.receivePO] GL post failed:', glErr && glErr.message);
              try {
                if (global.ERP && global.ERP.PurchaseConnector && typeof global.ERP.PurchaseConnector._addRetryFailed === 'function') {
                  global.ERP.PurchaseConnector._addRetryFailed(id, 'po-receive');
                }
              } catch (_) {}
            });
          }
        } catch (_glSyncErr) {
          console.error('[PurchaseOrders.receivePO] GL post error:', _glSyncErr);
        }

        try {
          document.dispatchEvent(new CustomEvent('purchase:po:received', { detail: { id: id, po: PS.getPOById(id) || po } }));
        } catch (_) {}

        _toast('✅ PO ' + id + ' marked as received — stock updated', 'success');
        _refreshList();
      };

      if (typeof _Modal !== 'undefined' && _Modal && typeof _Modal.confirm === 'function') {
        _Modal.confirm('Mark PO ' + id + ' as received? This will add stock to inventory.', _doReceive);
      } else {
        const dlg = document.createElement('dialog');
        dlg.innerHTML = '<form method="dialog" style="padding:1.2rem;max-width:340px"><p style="margin:0 0 1rem">Mark PO <b>' + id + '</b> as received? This will add stock to inventory.</p><div style="display:flex;gap:.6rem;justify-content:flex-end"><button value="cancel" style="padding:.4rem .9rem">Cancel</button><button value="ok" autofocus style="padding:.4rem .9rem;background:var(--primary,#4338CA);color:#fff;border:none;border-radius:4px">Confirm</button></div></form>';
        document.body.appendChild(dlg);
        dlg.showModal && dlg.showModal();
        dlg.addEventListener('close', function() { if (dlg.returnValue === 'ok') _doReceive(); document.body.removeChild(dlg); });
      }
    } catch (e) {
      _toast('Failed to receive PO: ' + e.message, 'error');
      console.error('[PurchaseOrders.receivePO]', e);
    }
  };

  const cancelPO = (id) => {
    try {
      const po = PS.getPOById(id);
      if (!po) { _toast('PO not found', 'error'); return; }

      const currentStatus = _lc((po.status || po.st) || 'pending');

      if (!_validatePOTransition(currentStatus, 'cancelled')) {
        _toast('❌ Cannot cancel PO "' + id + '" — status is "' + currentStatus + '". Received POs cannot be cancelled.', 'error');
        return;
      }

      _confirmDialog('Cancel PO ' + id + '? This action cannot be undone.', function() {
        try {
          const r = PS.updatePO(id, { status: 'cancelled' });
          if (!r.ok) { _toast('❌ Cancel failed: ' + r.error, 'error'); return; }
          _persist();
          _toast('🚫 PO ' + id + ' cancelled', 'info');
          _refreshList();
        } catch (e) { _toast('Cancel error: ' + e.message, 'error'); }
      });
    } catch (e) { _toast('Cancel error: ' + e.message, 'error'); }
  };

  const deletePurchaseOrder = (id) => {
    try {
      if (!_hasPermission('manager')) {
        _toast('❌ You do not have permission to delete purchase orders. Manager role required.', 'error');
        return;
      }

      const po = PS.getPOById(id);
      if (!po) { _toast('PO not found', 'error'); return; }

      const currentStatus = _lc((po.status || po.st) || 'pending');

      if (currentStatus === 'received' || po.received || po.receivedAt) {
        _toast('❌ PO "' + id + '" has already been received and cannot be deleted. This would cause inventory inconsistency.', 'error');
        return;
      }

      if (currentStatus === 'partial') {
        _toast('❌ PO "' + id + '" is partially received and cannot be deleted. Cancel it instead to preserve the received inventory.', 'error');
        return;
      }

      _confirmDialog('Delete Purchase Order ' + id + '?\n\nThis cannot be undone.', function() {
        try {
          const r = PS.removePO(id);
          if (!r.ok) { _toast('❌ Delete failed: ' + r.error, 'error'); return; }
          _persist();
          _toast('🗑️ PO ' + id + ' deleted', 'info');
          _refreshList();
        } catch (e) { _toast('Delete error: ' + e.message, 'error'); }
      });
    } catch (e) { _toast('Delete error: ' + e.message, 'error'); }
  };

  const viewPO = (id) => {
    try {
      const po = PS.getPOById(id);
      if (!po) { _toast('PO not found', 'error'); return; }
      const currentStatus = _lc((po.status || po.st) || 'pending');
      const isOverdue = (currentStatus === 'pending' || currentStatus === 'confirmed' || currentStatus === 'partial') && po.expectedDate && po.expectedDate < _today();

      const itemRows = (po.items || []).map((it, i) =>
        '<tr>' +
        '<td style="padding:8px">' + _esc(String(i + 1)) + '</td>' +
        '<td style="padding:8px;font-weight:600">' + _esc(it.name || '') + '</td>' +
        '<td style="padding:8px;text-align:center">' + _esc(String(it.qty || 0)) + '</td>' +
        '<td style="padding:8px;text-align:right">' + _fmt(_num(it.rate, 0)) + '</td>' +
        '<td style="padding:8px;text-align:right;font-weight:700">' + _fmt(_esc(_r2((it.qty || 0) * (it.rate || 0)))) + '</td>' +
        '</tr>'
      ).join('') || '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--muted)">No items</td></tr>';

      const html = (
        '<div style="padding:16px">' +
        (isOverdue ? '<div style="background:#fef2f2;border:1px solid #ef4444;border-radius:8px;padding:10px;margin-bottom:12px;color:#dc2626;font-weight:700">⚠️ This PO is OVERDUE (expected: ' + _esc(po.expectedDate) + ')</div>' : '') +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">' +
        '<div><strong>PO #:</strong> ' + _esc(po.id) + '</div>' +
        '<div><strong>Supplier:</strong> ' + _esc(po.supplierName || '') + '</div>' +
        '<div><strong>Date:</strong> ' + _esc(po.date || '') + '</div>' +
        '<div><strong>Expected:</strong> ' + _esc(po.expectedDate || 'TBD') + '</div>' +
        '<div><strong>Status:</strong> ' + _statusBadge(po.status || po.st) + '</div>' +
        '<div><strong>Notes:</strong> ' + _esc(po.notes || '—') + '</div>' +
        '</div>' +
        '<table class="dt" style="font-size:13px">' +
        '<thead><tr><th>#</th><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>' +
        '<tbody>' + itemRows + '</tbody>' +
        '</table>' +
        '<div style="display:flex;justify-content:flex-end;margin-top:12px">' +
        '<div style="background:var(--light,#f8fafc);border-radius:8px;padding:12px 20px">' +
        '<div style="font-size:12px;color:var(--muted)">Grand Total</div>' +
        '<div style="font-size:20px;font-weight:800;color:var(--gold)">' + _fmt(_num(po.total, 0)) + '</div>' +
        '</div>' +
        '</div>' +
        '</div>'
      );

      const poPreviewEl  = _el('po-view-preview');
      const invPreviewEl = _el('inv-full-preview');
      const previewEl = poPreviewEl || invPreviewEl;
      if (previewEl) {
        previewEl.innerHTML = html;
        const modalId = poPreviewEl ? 'poViewModal' : 'invPrintModal';
        try { if (typeof global.openModal === 'function') global.openModal(modalId); } catch (_) {}
      } else {

        const staleWrapper = document.getElementById('po-view-modal-temp');
        if (staleWrapper) staleWrapper.remove();

        const modalDiv = document.createElement('div');
        modalDiv.id = 'po-view-modal-temp';
        modalDiv.innerHTML = '<div class="modal-overlay" id="poViewModal" style="display:flex;z-index:1100"><div class="modal lg" style="max-width:700px">' +
          '<div class="modal-head"><h2>📋 Purchase Order Details</h2><button class="modal-close" onclick="document.getElementById(\'po-view-modal-temp\') && document.getElementById(\'po-view-modal-temp\').remove()">✕</button></div>' +
          '<div class="modal-body">' + html + '</div></div></div>';
        document.body.appendChild(modalDiv);
      }
    } catch (e) { console.error('[PurchaseOrders.viewPO]', e); }
  };

  const printPO = (id) => {
    try {
      const po = PS.getPOById(id);
      if (!po) { _toast('PO not found', 'error'); return; }

      let bizName = 'Business';
      try { bizName = JSON.parse(localStorage.getItem('mh_biz_info') || '{}').name || bizName; } catch (_) {}

      const itemRows = (po.items || []).map((it, i) =>
        '<tr>' +
        '<td>' + _esc(String(i + 1)) + '</td>' +
        '<td style="font-weight:600">' + _esc(it.name || '') + '</td>' +
        '<td style="text-align:center">' + _esc(String(it.qty || 0)) + '</td>' +
        '<td style="text-align:right">' + _fmt(_num(it.rate, 0)) + '</td>' +
        '<td style="text-align:right;font-weight:700">' + _fmt(_esc(_r2((it.qty || 0) * (it.rate || 0)))) + '</td>' +
        '</tr>'
      ).join('');

      const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
        '<title>PO ' + _esc(po.id) + '</title>' +
        '<style>body{font-family:Arial,sans-serif;padding:24px;font-size:13px;color:#222;max-width:800px;margin:0 auto}' +
        'h1{font-size:18px;margin:0}table{width:100%;border-collapse:collapse;margin:12px 0}' +
        'th{background:var(--primary);color:#fff;padding:8px 10px;text-align:left;font-size:11px}' +
        'td{padding:7px 10px;border-bottom:1px solid #eee}.noprint{display:none}' +
        '@media print{.noprint{display:none}}</style></head><body>' +
        '<h1>' + _esc(bizName) + '</h1>' +
        '<div style="color:#666;margin-bottom:16px;font-size:12px">PURCHASE ORDER</div>' +
        '<table style="width:auto;border:none;margin-bottom:16px"><tbody>' +
        '<tr><td style="border:none;padding:2px 0;font-weight:600">PO #:</td><td style="border:none;padding:2px 8px">' + _esc(po.id || '') + '</td></tr>' +
        '<tr><td style="border:none;padding:2px 0;font-weight:600">Supplier:</td><td style="border:none;padding:2px 8px">' + _esc(po.supplierName || '') + '</td></tr>' +
        '<tr><td style="border:none;padding:2px 0;font-weight:600">Date:</td><td style="border:none;padding:2px 8px">' + _esc(po.date || '') + '</td></tr>' +
        '<tr><td style="border:none;padding:2px 0;font-weight:600">Expected:</td><td style="border:none;padding:2px 8px">' + _esc(po.expectedDate || 'TBD') + '</td></tr>' +
        '<tr><td style="border:none;padding:2px 0;font-weight:600">Status:</td><td style="border:none;padding:2px 8px">' + _esc(po.status || 'pending') + '</td></tr>' +
        '</tbody></table>' +
        '<table><thead><tr><th>#</th><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>' +
        '<tbody>' + itemRows + '</tbody></table>' +
        '<div style="display:flex;justify-content:flex-end;margin-top:12px">' +
        '<div style="background:var(--bg);padding:12px 20px;border-radius:6px">' +
        '<span style="font-weight:600">Grand Total: </span>' +
        '<span style="font-size:18px;font-weight:800;color:var(--primary)">' + _fmt(_num(po.total, 0)) + '</span>' +
        '</div>' +
        '</div>' +
        (po.notes ? '<div style="margin-top:16px;padding:10px;background:#f9f9f9;border-radius:4px"><strong>Notes:</strong> ' + _esc(po.notes) + '</div>' : '') +
        '<div class="noprint" style="text-align:center;margin-top:20px">' +
        '<button onclick="window.print()" style="background:var(--primary);color:#fff;border:none;padding:9px 24px;border-radius:4px;font-size:14px;cursor:pointer;margin-right:8px">🖨 Print</button>' +
        '<button onclick="window.close()" style="background:#757575;color:#fff;border:none;padding:9px 24px;border-radius:4px;font-size:14px;cursor:pointer">✕ Close</button>' +
        '</div></body></html>';

      const pw = global.open('', '_blank', 'width=900,height=700');
      if (!pw) {
        _toast('Pop-ups blocked. Please allow pop-ups to print.', 'error');
        return;
      }
      pw.document.write(html);
      pw.document.close();
      setTimeout(() => { try { pw.print(); } catch (_) {} }, 500);
    } catch (e) { console.error('[PurchaseOrders.printPO]', e); }
  };

  let _searchTimer = null;

  const searchOrders = (query) => {
    _searchQuery = (query || '').trim();
    if (_searchTimer) clearTimeout(_searchTimer);
    _searchTimer = setTimeout(_refreshList, 200);
  };

  const filterOrders = (status) => {
    _activeFilter = status || 'all';
    _refreshList();
  };

  const PurchaseOrders = Object.freeze({
    render: renderPurchaseOrderPage,
    openNew,
    openEdit,
    closeModal,
    onSupInput,
    onItemInput,
    savePO,
    receive: receivePO,
    cancel: cancelPO,
    deleteOrder: deletePurchaseOrder,
    view: viewPO,
    printPO,
    search: searchOrders,
    filter: filterOrders,
    addItemRow,
    removeItemRow,
    calcRow,
  });

  global.PurchaseOrders = PurchaseOrders;

  global.renderPurchaseOrderPage = renderPurchaseOrderPage;
  global.renderPurchaseOrdersPage = renderPurchaseOrderPage;
  global.savePurchaseOrder = savePO;
  global.deletePurchaseOrder = deletePurchaseOrder;
  global.receivePurchaseOrder = receivePO;
  global.cancelPurchaseOrder = cancelPO;
  global.printPurchaseOrderById = printPO;
  global.openPurchaseOrderModal = openNew;
  global.closePurchaseOrderModal = _closeModal;

  if (window.DEBUG_MODE) console.log('[PurchaseOrders] ready');

  try { document.dispatchEvent(new CustomEvent('purchaseorders:ready')); } catch (_) {}

  if (typeof ERP !== 'undefined' && ERP.PurchaseConnector && typeof ERP.PurchaseConnector._diagnostics === 'function') {
    try {
      if (typeof window._installPurchaseOrdersHook === 'function') {
        window._installPurchaseOrdersHook();
      } else if (ERP.PurchaseConnector._installPurchaseOrdersHook) {
        ERP.PurchaseConnector._installPurchaseOrdersHook();
      }
    } catch (_) {}
  }

})(typeof globalThis !== 'undefined' ? globalThis : window);
