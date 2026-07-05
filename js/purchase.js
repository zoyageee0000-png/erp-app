'use strict';

var ERP = window.ERP = window.ERP || {};

(function (ERP) {

  var getState = function () {
    return (ERP._internal && typeof ERP._internal.getState === 'function')
      ? ERP._internal.getState()
      : { session: { loggedIn: false }, data: {} };
  };
  var setState  = function (fn, tag) {
    if (ERP._internal && typeof ERP._internal.setState === 'function')
      return ERP._internal.setState(fn, tag);
  };

  var _purchaseService = {

    add: function (purchase) {
      if (!getState().session.loggedIn) return;
      var ps = window.PurchaseState;
      if (ps && ps.addPurchase) {
        var result = ps.addPurchase(purchase);
        if (!result.ok) console.warn('[ERP purchase:add] PurchaseState.addPurchase failed:', result.error);
        return;
      }
      setState(function (s) { s.data.purchases = [purchase].concat(s.data.purchases || []); }, 'purchase');
    },

    update: function (id, patch) {
      var ps = window.PurchaseState;
      if (ps && ps.updatePurchase) { var r = ps.updatePurchase(id, patch); return r; }
      setState(function (s) {
        var arr = s.data.purchases || [];
        var i = arr.findIndex(function (x) { return x.id === id; });
        if (i !== -1) arr[i] = Object.assign({}, arr[i], patch);
      }, 'purchase');
    },

    delete: function (id) {
      if (typeof window.deletePurchase === 'function') { window.deletePurchase(id); return; }
      var ps = window.PurchaseState;
      if (ps && ps.removePurchase) { var r = ps.removePurchase(id, { hardDelete: true, force: true }); return r; }
      setState(function (s) {
        s.data.purchases = (s.data.purchases || []).filter(function (x) { return x.id !== id; });
      }, 'purchase');
    },

    getAll: function () {
      var ps = window.PurchaseState;
      if (ps && ps.getAllPurchases) return ps.getAllPurchases();
      return getState().data.purchases || [];
    },

    search: function (q) {
      var all = this.getAll();
      if (!q) return all;
      var lq = q.toLowerCase();
      return all.filter(function (p) {
        return (p.supplierName || p.supplier || '').toLowerCase().includes(lq)
          || (p.id || '').toLowerCase().includes(lq)
          || (p.billNo || p.bill_no || p.invoiceNo || '').toLowerCase().includes(lq)
          || (p.total !== undefined && p.total !== null && String(Math.round(Number(p.total))) === q.trim());
      });
    }
  };

  var _purchaseActions = {

    render: function () {
      var pv = document.getElementById('pv-purchase');
      if (!pv) return;
      if (pv.querySelector('[id^="pur-"]')) return;

      pv.innerHTML =
        window.renderStatCards([
          { icon:'🧾', id:'sup-monthly-pur',      value:'Rs.0.00', label:'This Month',      color:'#4338CA', bg:'#eff6ff' },
          { icon:'⏰', id:'sup-pending-orders',    value:0,      label:'Pending',         color:'#d97706', bg:'#fffbeb' },
          { icon:'💰', id:'sup-payable',           value:'Rs.0.00', label:'Total Payable',   color:'#dc2626', bg:'#fef2f2' },
          { icon:'✅', id:'sup-completed-orders',  value:0,      label:'Completed',       color:'#16a34a', bg:'#f0fdf4' },
        ]) +
        '<div class="toolbar">' +
          '<div class="search-box"><svg><use href="#ic-search"/></svg>' +
            '<input id="pur-search" name="pur-search" placeholder="Search purchases…" oninput="searchPurchases&&searchPurchases(this.value)"></div>' +
          '<div style="display:flex;gap:8px">' +
            '<button class="btn btn-sm" onclick="openPurModal&&openPurModal()" style="background:var(--primary);color:#fff;font-weight:700">' +
              '<svg><use href="#ic-plus"/></svg> New Purchase</button>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;padding:0 0 12px 0;flex-wrap:wrap">' +
          '<button class="btn btn-sm tab active" data-status="all" style="font-size:11px">All</button>' +
          '<button class="btn btn-sm tab" data-status="draft" style="font-size:11px">Pending</button>' +
          '<button class="btn btn-sm tab" data-status="partial" style="font-size:11px">Partial</button>' +
          '<button class="btn btn-sm tab" data-status="complete" style="font-size:11px">Completed</button>' +
          '<button class="btn btn-sm tab" data-status="returned" style="font-size:11px">Returned</button>' +
          '<button class="btn btn-sm tab" data-status="cancelled" style="font-size:11px">Cancelled</button>' +
        '</div>' +
        '<div class="panel">' +
          '<table class="dt"><thead><tr>' +
            '<th style="width:40px">IMG</th><th>ID</th><th>Supplier</th>' +
            '<th>Date</th><th>Items</th><th>Amount</th><th>Status</th><th>Actions</th>' +
          '</tr></thead>' +
          '<tbody id="pur-tbody"><tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted)">Loading…</td></tr></tbody>' +
          '</table>' +
        '</div>';

      if (typeof renderPurchases === 'function') {
        try {
          renderPurchases();
        } catch (e) {
          console.warn('[purchase.render]', e);
          var tb = document.getElementById('pur-tbody');
          if (tb) tb.innerHTML =
            '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--danger)">' +
              'Could not load purchases. ' +
              '<a href="#" onclick="if(typeof renderPurchases===\'function\'){try{renderPurchases();}catch(e){console.warn(\'[purchase.render.retry]\',e);}}return false;">Retry</a>' +
            '</td></tr>';
        }
      }
      if (typeof window.PurchaseEvents !== 'undefined' && typeof window.PurchaseEvents.bindAll === 'function') {
        try { window.PurchaseEvents.bindAll(); } catch(e) {}
      }
    },

    openModal: function () {
      if (typeof window.openPurModal === 'function') { window.openPurModal(); return; }
      ERP.ui.toast('Purchase module not loaded yet', 'warning');
    },

    getAll: function () { return _purchaseService.getAll(); }
  };

  var _poService = {
    add: function (po) {
      if (!getState().session.loggedIn) return;
      var PS = window.PurchaseState;
      if (PS && typeof PS.addPO === 'function') {
        var result = PS.addPO(po);
        if (!result.ok) console.warn('[ERP po:add] PurchaseState.addPO failed:', result.error);
      } else {
        setState(function (s) { s.data.purchaseOrders = [po].concat(s.data.purchaseOrders || []); }, 'purchaseorders');
        ERP.Persistence.save('purchaseOrders', getState().data.purchaseOrders).catch(function (e) { console.warn('[ERP po:add legacy]', e); });
      }
    },
    getAll: function () {
      var PS = window.PurchaseState;
      return (PS && typeof PS.getAllPurchaseOrders === 'function') ? PS.getAllPurchaseOrders() : (getState().data.purchaseOrders || []);
    }
  };

  var _prService = {
    add: function (pr) {
      if (!getState().session.loggedIn) return;
      var PS = window.PurchaseState;
      if (PS && typeof PS.addReturn === 'function') {
        var result = PS.addReturn(pr);
        if (!result.ok) console.warn('[ERP pr:add] PurchaseState.addReturn failed:', result.error);
      } else {
        setState(function (s) { s.data.purchaseReturns = [pr].concat(s.data.purchaseReturns || []); }, 'purchasereturn');
        ERP.Persistence.save('purchaseReturns', getState().data.purchaseReturns).catch(function (e) { console.warn('[ERP pr:add legacy]', e); });
      }
    },
    getAll: function () {
      var PS = window.PurchaseState;
      return (PS && typeof PS.getAllReturns === 'function') ? PS.getAllReturns() : (getState().data.purchaseReturns || []);
    }
  };

  var _payoutService = {
    add: function (p) {
      if (!getState().session.loggedIn) return;
      var PS = window.PurchaseState;
      if (PS && typeof PS.addPayment === 'function') {
        var result = PS.addPayment(p);
        if (!result.ok) console.warn('[ERP payout:add] PurchaseState.addPayment failed:', result.error);
      } else {
        setState(function (s) { s.data.payOut = [p].concat(s.data.payOut || []); }, 'payout');
        ERP.Persistence.save('payOut', getState().data.payOut).catch(function (e) { console.warn('[ERP payout:add legacy]', e); });
      }
    },
    getAll: function () {
      var PS = window.PurchaseState;
      return (PS && typeof PS.getAllPayments === 'function') ? PS.getAllPayments() : (getState().data.payOut || []);
    }
  };

  if (ERP.registerRenderer) {
    ERP.registerRenderer('purchase',       function () { _purchaseActions.render(); });
    ERP.registerRenderer('purchaseorders', function () {
      if (typeof renderPurchaseOrdersPage === 'function') {
        try { renderPurchaseOrdersPage(); return; } catch (e) { console.warn('[ERP purchaseorders renderer]', e); }
      }
      if (window.PurchaseOrders && typeof window.PurchaseOrders.render === 'function') {
        try { window.PurchaseOrders.render(); return; } catch (e) { console.warn('[ERP purchaseorders renderer]', e); }
      }
      var pv = document.getElementById('pv-purchaseorders');
      if (pv && !pv.querySelector('.erp-stub')) pv.innerHTML =
        '<div class="erp-stub" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:260px;gap:12px;color:var(--muted);text-align:center;padding:32px">'
        + '<div style="font-size:40px">📋</div>'
        + '<div style="font-size:16px;font-weight:700;color:var(--text)">Purchase Orders</div>'
        + '<div style="font-size:13px;max-width:340px">Purchase Orders module loading…</div>'
        + '</div>';
    });

    var _existingReg = ERP._internal && typeof ERP._internal.getRenderReg === 'function'
      ? ERP._internal.getRenderReg() : null;
    if (!_existingReg || typeof _existingReg.purchasereturn !== 'function') {
      ERP.registerRenderer('purchasereturn', function () {
        if (typeof renderPurchaseReturnPage === 'function') {
          try { renderPurchaseReturnPage(); return; } catch (e) { console.warn('[ERP purchasereturn renderer]', e); }
        }
        if (typeof renderReturnsPage === 'function') {
          try { renderReturnsPage(); return; } catch (e) { console.warn('[ERP purchasereturn renderer]', e); }
        }
        var pv = document.getElementById('pv-purchasereturn');
        if (pv && !pv.querySelector('.erp-stub')) pv.innerHTML =
          '<div class="erp-stub" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:260px;gap:12px;color:var(--muted);text-align:center;padding:32px">'
          + '<div style="font-size:40px">↩️</div>'
          + '<div style="font-size:16px;font-weight:700;color:var(--text)">Purchase Return</div>'
          + '<div style="font-size:13px;max-width:340px">Purchase Return module loading…</div>'
          + '</div>';
      });
    }
  }

  ERP._services               = ERP._services || {};
  ERP._services.purchase      = _purchaseService;
  ERP._services.purchaseOrders = _poService;
  ERP._services.purchaseReturns = _prService;
  ERP._services.payOut        = _payoutService;

  ERP.actions                 = ERP.actions || {};
  ERP.actions.purchase        = _purchaseActions;

  ERP.purchase                = _purchaseActions;

})(ERP);
