;(function (global) {
  'use strict';

  if (typeof global.go !== 'function' && global.ERP && typeof global.ERP.go === 'function') {
    global.go = function (page, el) { global.ERP.go(page, el); };
  }
  if (typeof global.showToast !== 'function' && global.ERP && global.ERP.ui) {
    global.showToast = function (msg, type, dur) { global.ERP.ui.toast(msg, type, dur); };
  }

  const _toast = (msg, type, dur) => {
    if (typeof global.showToast === 'function') {
      try { global.showToast(msg, type, dur); } catch (e) { console.error('[purchase.events] showToast threw:', e); }
    } else {
      const log = type === 'error' ? console.error : type === 'warning' ? console.warn : console.log;
      log('[purchase.events] toast:', msg);
    }
  };

  const _safe = (fn, label) => {
    try {
      return fn();
    } catch (e) {
      console.error(`[purchase.events] ${label}:`, e.message, e.stack);
      _toast(label + ' failed: ' + (e && e.message ? e.message : 'Unknown error'), 'error');
    }
  };

  const _go = (page) => {
    try {
      if (typeof global.go === 'function') { global.go(page, null); return; }
      console.warn('[purchase.events] _go: go() not found for page', page);
    } catch (e) {
      console.error('[purchase.events] _go:', e.message);
    }
  };

  const _call = (name, ...args) => {
    const fn = global && global[name];
    if (typeof fn === 'function') return fn(...args);
    console.warn('[purchase.events] _call: function not found:', name);
  };

  (() => {

    if (typeof global._m99Render === 'function' && global._m99Render.__purchaseEventsWrapped) return;

    const _orig = typeof global._m99Render === 'function' ? global._m99Render : null;

    global._m99Render = function (page) {
      let result;
      if (_orig) {
        try { result = _orig.call(this, page); } catch (e) { console.warn('[purchase.events] _m99Render orig:', e.message); }
      }

      switch (page) {
        case 'purchase':
          _safe(() => { if (typeof renderPurchaseStats === 'function') renderPurchaseStats(); }, 'renderPurchaseStats');
          break;
        case 'payout':
          _safe(() => { if (typeof renderPaymentOutPage === 'function') renderPaymentOutPage(); }, 'renderPaymentOutPage');
          break;
        case 'purchaseorders':
          _safe(() => { if (typeof renderPurchaseOrdersPage === 'function') renderPurchaseOrdersPage(); }, 'renderPurchaseOrdersPage');
          break;
        case 'purchasereturn':
          _safe(() => { if (typeof renderPurchaseReturnPage === 'function') renderPurchaseReturnPage(); }, 'renderPurchaseReturnPage');
          break;
        case 'supplier':
          _safe(() => {
            if (ERP.events && ERP.events.emit) ERP.events.emit('suppliers:updated');
            if (typeof renderPurchaseStats === 'function') renderPurchaseStats();
          }, 'renderSuppliers');
          break;
      }
      return result;
    };
    global._m99Render.__purchaseEventsWrapped = true;
  })();

  (() => {
    if (typeof document === 'undefined') return;

    const _ctrlNMap = {
      purchase: 'openPurModal',
      payout: 'openPaymentOutModal',
      purchaseorders: 'openPurchaseOrderModal',
      purchasereturn: 'openPurchaseReturnModal',
    };

    const _altKeyMap = {
      p: 'purchase',
      u: 'supplier',
    };

    const _getActivePage = () => {
      const el = document.querySelector('.pv.active');
      if (!el || !el.id) return null;
      return (el.id || '').replace('pv-', '') || null;
    };

    const _isTyping = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      const role = el.getAttribute('role');
      if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true;
      return el.isContentEditable === true;
    };

    document.addEventListener('keydown', function (e) {
      if (_isTyping()) return;

      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === 'n') {
        const activePage = _getActivePage();
        const modalFn = activePage ? _ctrlNMap[activePage] : null;
        if (modalFn) {
          e.preventDefault();
          _safe(() => _call(modalFn), `Ctrl+N ${modalFn}`);
        }
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const key = e.key.toLowerCase();
        const page = _altKeyMap[key];
        if (page) {
          e.preventDefault();
          const current = _getActivePage();
          if (current !== page) {
            _go(page);
            _toast(`⌨️ ${page}`, 'info', 1200);
          }
        }
      }
    }, { capture: false });
  })();

  const _boundElements = new WeakMap();

  const _isBound = (el) => _boundElements.has(el);
  const _markBound = (el) => _boundElements.set(el, true);

  const _bindPurTbody = () => {
    const tbody = document.getElementById('pur-tbody');
    if (!tbody || _isBound(tbody)) return;
    _markBound(tbody);

    tbody.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;

      const tr = btn.closest('tr');
      const id = btn.dataset.id || tr?.dataset?.id || '';
      if (!id) { console.warn('[purchase.events] Missing data-id on button'); return; }
      const idx = btn.dataset.idx !== undefined ? (parseInt(btn.dataset.idx, 10) || -1) : -1;
      const action = btn.dataset.action;

      switch (action) {
        case 'view':
          _safe(() => _call('viewPurchaseOrder', id), 'view PO');
          break;
        case 'print':
          _safe(() => _call('printPurchaseOrder', id), 'print PO');
          break;
        case 'complete':
          _safe(() => _call('completePurchase', id), 'complete PO');
          break;
        case 'pay':
          _safe(() => _call('openPaymentOutModalForPO', id), 'pay PO');
          break;
        case 'edit':
          _safe(() => _call('openPurModal', id), 'edit PO');
          break;
        case 'delete':
          _safe(() => _call('deletePurchase', id), 'delete PO');
          break;
      }
    });
  };

  const _bindPorTbody = () => {
    const tbody = document.getElementById('por-tbody');
    if (!tbody || _isBound(tbody)) return;
    _markBound(tbody);

    tbody.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;

      const tr = btn.closest('tr');
      const id = btn.dataset.id || tr?.dataset?.id || '';
      if (!id) { console.warn('[purchase.events] Missing data-id on button'); return; }
      const action = btn.dataset.action;

      switch (action) {
        case 'receive':
          _safe(() => _call('receivePurchaseOrder', id), 'receive PO');
          break;
        case 'view':
          _safe(() => { if (global.PurchaseOrders && typeof global.PurchaseOrders.view === 'function') global.PurchaseOrders.view(id); }, 'view order');
          break;
        case 'print':
          _safe(() => { if (global.PurchaseOrders && typeof global.PurchaseOrders.printPO === 'function') global.PurchaseOrders.printPO(id); }, 'print order');
          break;
        case 'delete':
          _safe(() => {
            if (confirm('Delete this purchase order? This cannot be undone.')) _call('deletePurchaseOrder', id);
          }, 'delete order');
          break;
        case 'edit':
          _safe(() => { if (global.PurchaseOrders && typeof global.PurchaseOrders.openEdit === 'function') global.PurchaseOrders.openEdit(id); }, 'edit order');
          break;
        case 'cancel':
          _safe(() => { if (global.PurchaseOrders && typeof global.PurchaseOrders.cancel === 'function') global.PurchaseOrders.cancel(id); }, 'cancel order');
          break;
      }
    });
  };

  const _bindPoutTbody = () => {
    const tbody = document.getElementById('pout-tbody');
    if (!tbody || _isBound(tbody)) return;
    _markBound(tbody);

    tbody.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;

      const tr = btn.closest('tr');
      const id = btn.dataset.id || tr?.dataset?.id || '';
      if (!id) { console.warn('[purchase.events] Missing data-id on button'); return; }
      const action = btn.dataset.action;

      switch (action) {
        case 'delete':
          _safe(() => {
            if (confirm('Delete this payment out? This cannot be undone.')) _call('deletePaymentOut', id);
          }, 'delete payment out');
          break;
        case 'void':
          _safe(() => {
            if (typeof PurchasePayments?.voidPaymentOut === 'function') PurchasePayments.voidPaymentOut(id);
            else _call('voidPaymentOut', id);
          }, 'void payment out');
          break;
        case 'print':
          _safe(() => _call('printPaymentOut', id), 'print payment out');
          break;
        case 'view':
          _safe(() => _call('viewPaymentOut', id), 'view payment out');
          break;
      }
    });
  };

  const _bindPretTbody = () => {
    const tbody = document.getElementById('pur-ret-tbody') || document.getElementById('pret-page-tbody');
    if (!tbody || _isBound(tbody)) return;
    _markBound(tbody);

    tbody.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;

      const tr = btn.closest('tr');
      const id = btn.dataset.id || tr?.dataset?.id || '';
      if (!id) { console.warn('[purchase.events] Missing data-id on button'); return; }
      const action = btn.dataset.action;

      switch (action) {
        case 'delete':
          _safe(() => {
            if (confirm('Delete this purchase return? This cannot be undone.')) {
              if (typeof PurchaseReturns?.deleteReturn === 'function') PurchaseReturns.deleteReturn(id);
              else _call('deletePurchaseReturn', id);
            }
          }, 'delete return');
          break;
        case 'view':
          _safe(() => {
            if (typeof PurchaseReturns?.view === 'function') PurchaseReturns.view(id);
            else _call('viewPurchaseReturn', id);
          }, 'view return');
          break;
      }
    });
  };

  const _bindSearchInputs = () => {
    const purSearch = document.getElementById('pur-search');
    if (purSearch && !_isBound(purSearch)) {
      _markBound(purSearch);
      purSearch.addEventListener('input', function () {
        _safe(() => _call('searchPurchases', this.value), 'searchPurchases');
      });
    }

    const supSearch = document.getElementById('sup-search');
    if (supSearch && !_isBound(supSearch)) {
      _markBound(supSearch);
      supSearch.addEventListener('input', function () {
        _safe(() => {
          if (typeof global.searchSuppliers === 'function') _call('searchSuppliers', this.value);
        }, 'searchSuppliers');
      });
    }

    const pretSearch = document.getElementById('pret-page-search');
    if (pretSearch && !_isBound(pretSearch)) {
      _markBound(pretSearch);
      pretSearch.addEventListener('input', function () {
        _safe(() => {
          if (typeof PurchaseReturns?.search === 'function') PurchaseReturns.search(this.value);
          else _call('searchPurchaseReturns', this.value);
        }, 'searchReturns');
      });
    }
  };

  let _tabDelegationBound = false;
  const _bindPurchaseTabs = () => {
    if (_tabDelegationBound) return;
    const root = document.getElementById('pv-purchase');
    if (!root) return;
    root.addEventListener('click', function (e) {
      const tab = e.target.closest('.tab[data-status]');
      if (!tab || !root.contains(tab)) return;
      root.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      _safe(() => _call('filterPurchases', tab.dataset.status, tab), 'filterPurchases tab');
    });
    _tabDelegationBound = true;
  };

  const _bindPmParty = () => {
    const pmParty = document.getElementById('pm-party');
    if (!pmParty || _isBound(pmParty)) return;
    _markBound(pmParty);
    pmParty.addEventListener('change', function () { _safe(() => _call('pmFillPhone', this), 'pmFillPhone change'); });
  };

  const _bindRoundoff = () => {
    const ro = document.getElementById('pm-roundoff');
    if (!ro || _isBound(ro)) return;
    _markBound(ro);
    ro.addEventListener('change', function () { _safe(() => _call('pmCalc'), 'pmCalc roundoff'); });
  };

  const _bindModalDismiss = () => {
    const modalIds = ['purModal', 'paymentOutModal', 'purchaseOrderModal', 'purchReturnModalBg'];
    modalIds.forEach(id => {
      const modal = document.getElementById(id);
      if (!modal || _isBound(modal)) return;
      _markBound(modal);
      modal.addEventListener('click', function (e) {
        if (e.target === modal) {
          const closeFn = id === 'purModal' ? 'closePurModal' :
                          id === 'paymentOutModal' ? 'closePurchasePaymentModal' :
                          id === 'purchaseOrderModal' ? 'closePurchaseOrderModal' :
                          id === 'purchReturnModalBg' ? 'closePurchaseReturnModal' : 'closePurModal';
          _safe(() => _call(closeFn), `click-outside ${closeFn}`);
        }
      });
    });
  };

  let _domReadyBound = false;

  function bindAll() {
    if (!document) return { bound: false, reason: 'no document' };
    _bindPurTbody();
    _bindPorTbody();
    _bindPoutTbody();
    _bindPretTbody();
    _bindSearchInputs();
    _bindPurchaseTabs();
    _bindPmParty();
    _bindRoundoff();
    _bindModalDismiss();
    return { bound: true };
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        if (!_domReadyBound) { _domReadyBound = true; bindAll(); }
      });
    } else {
      if (!_domReadyBound) { _domReadyBound = true; bindAll(); }
    }
  }

  (() => {
    var _bindTimer = null;
    document.addEventListener('purchaserendered', function () {
      if (_bindTimer) clearTimeout(_bindTimer);
      _bindTimer = setTimeout(function () {
        _bindTimer = null;
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(function () { bindAll(); });
        } else {
          bindAll();
        }
      }, 50);
    });
  })();

  global.PurchaseEvents = Object.freeze({
    bindAll,
  });

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : this);
