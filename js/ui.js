'use strict';

var ERP = window.ERP || {};

/* ── Shared stat-card design (originally Workshop Staff page) ──────────────
   Single place that renders the small icon + value + label "chart" cards
   used across all modules. Pass cards = [{icon,label,value,color,bg}] and
   optionally a column count / gap. Sizes are intentionally compact. */
window.renderStatCards = function (cards, opts) {
  opts = opts || {};
  var gap = opts.gap || 10;
  var html = (cards || []).map(function (c) {
    var attrs = (c.cls ? ' class="' + c.cls + '"' : '') +
      (c.dataAttrs ? ' ' + c.dataAttrs : '') +
      (c.onClick ? ' onclick="' + c.onClick + '"' : '');
    var badge = c.badgeText != null
      ? '<span' + (c.badgeId ? ' id="' + c.badgeId + '"' : '') + ' class="' + (c.badgeCls || 'sc-ch') + '" style="margin-left:auto;flex-shrink:0">' + c.badgeText + '</span>'
      : '';
    return '<div' + attrs + ' style="background:' + (c.bg || '#f8fafc') + ';border-radius:10px;padding:11px;display:flex;align-items:center;gap:10px;min-width:0' + (c.onClick ? ';cursor:pointer' : '') + '">' +
      '<div style="width:36px;height:36px;flex-shrink:0;background:' + (c.color || '#4338CA') + '22;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:16px">' + (c.icon || '') + '</div>' +
      '<div style="min-width:0"><div' + (c.id ? ' id="' + c.id + '"' : '') + (c.valCls ? ' class="' + c.valCls + '"' : '') + ' style="font-size:18px;font-weight:800;color:' + (c.color || '#4338CA') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (c.value != null ? c.value : '') + '</div><div' + (c.labelCls ? ' class="' + c.labelCls + '"' : '') + ' style="font-size:10.5px;color:var(--muted,#64748b);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (c.label || '') + '</div></div>' +
      badge +
    '</div>';
  }).join('');
  if (opts.wrap === false) return html;
  var cols = opts.cols || (cards && cards.length) || 4;
  return '<div' + (opts.gridCls ? ' class="' + opts.gridCls + '"' : '') + ' style="display:grid;grid-template-columns:repeat(' + cols + ',1fr);gap:' + gap + 'px;margin-bottom:' + (opts.marginBottom != null ? opts.marginBottom : 16) + 'px">' + html + '</div>';
};

(function (ERP) {


  var getState  = function () { return ERP._internal.getState(); };
  var setState  = function (fn, tag) { return ERP._internal.setState(fn, tag); };
  var safeRun   = function (fn, tag) { return ERP._internal.safeRun(fn, tag); };
  var escapeHtml= function (s) { return ERP._internal.escapeHtml(s); };
  var fmt       = function (n, c) { return ERP._internal.fmt(n, c); };

  var PAGE_CFG = {
    dashboard:       { title:'Dashboard',         add:false },
    sales:           { title:'Sales / Invoices',  add:'New Invoice',     fn:'openInvModal' },
    purchase:        { title:'Purchase',          add:'New Purchase',    fn:'openPurModal' },
    inventory:       { title:'Inventory',         add:'Add Item',        fn:'openItemModal' },
    customers:       { title:'Customers',         add:'Add Customer',    fn:'openCustomerModal' },
    supplier:        { title:'Suppliers',         add:'Add Supplier',    fn:'openSupplierModal' },
    parties:         { title:'Parties',           add:false },
    repair:          { title:'Repair Jobs',       add:'New Job',         fn:'openJobModal' },
    staff:           { title:'Workshop Staff',    add:'Add Staff',       fn:'openStaffModal' },
    vehicle:         { title:'Vehicles',          add:'Add Vehicle',     fn:'openVehicleModal' },
    appointment:     { title:'Servicing',         add:'New Appt',        fn:'openApptModal' },
    expenses:        { title:'Expenses',          add:'Add Expense',     fn:'openExpenseModal' },
    bank:            { title:'Banking',           add:'New Transaction', fn:'openBankModal' },
    loans:           { title:'Loans',             add:'New Loan',        fn:'openLoanModal' },
    coa:             { title:'Chart of Accounts', add:false },
    gst:             { title:'GST / Tax',         add:false },
    batchtrack:      { title:'Batch / HSN',       add:'Add Batch',       fn:'openBatchModal' },
    accounts:        { title:'Accounts',          add:false },
    estimates:       { title:'Estimates',         add:'New Estimate',    fn:'openEstimateModal' },
    saleorders:      { title:'Sale Orders',       add:'New Order',       fn:'openSaleOrderModal' },
    salereturns:     { title:'Sale Return',       add:false },
    payin:           { title:'Payment In',        add:'New Payment',     fn:'openPayInModal' },
    salespayout:     { title:'Payment Out',       add:'New Refund',      fn:'openPayOutModal' },
    payout:          { title:'Payment Out',       add:'New Payment',     fn:'openPaymentOutModal' },
    deliverychallan: { title:'Delivery Challan',  add:'New Challan',     fn:'openChallanModal' },
    purchaseorders:  { title:'Purchase Orders',   add:'New PO',          fn:'openPOModal' },
    purchasereturn:  { title:'Purchase Return',   add:false },
    reports:         { title:'Reports',           add:false },
    settings:        { title:'Settings',          add:false },
    printer:         { title:'Printer Config',    add:false },
    themes:          { title:'Themes',            add:false },
    utilities:       { title:'Utilities',         add:false },
    'import-items':  { title:'Import Items',      add:false },
    'import-parties':{ title:'Import Parties',    add:false },
    'export-items':  { title:'Export Items',      add:false },
    invoice:         { title:'Invoice',           add:false }
  };

  function _getRBAC() { return (window.ERP && ERP.RBAC) || {}; }

  function _getRolePerms() {
    var out = {};
    var rbac = _getRBAC();
    Object.keys(rbac).forEach(function (r) { out[r] = rbac[r].actions || {}; });
    return out;
  }

  function _hasPermission(page) {
    var s = getState().session;
    if (!s.loggedIn || !s.user) return false;
    var rbac  = _getRBAC();
    var entry = rbac[s.user.role];
    if (!entry) return false;
    var pages = entry.pages || [];
    return pages[0] === '*' || pages.indexOf(page) !== -1;
  }

  function _canDo(action) {
    var role = (getState().session.user && getState().session.user.role) || 'Viewer';
    var rbac    = _getRBAC();
    var actions = (rbac[role] && rbac[role].actions) || {};
    if (role === 'Admin') return true;
    if (!actions[action]) {
      var needRole = Object.keys(rbac).find(function (r) { return rbac[r].actions && rbac[r].actions[action]; });
      ui.toast('Permission denied: ' + action + (needRole ? ' requires ' + needRole + ' role' : ''), 'error');
      if (window.DEBUG_MODE) console.warn('[permissions] denied:', action, 'for role:', role);
      return false;
    }
    return true;
  }

  var _topFn = null;

  var ui = {

    toggleShortcuts: function () {
      var panel = document.getElementById('shortcuts-panel');
      if (!panel) return;
      var visible = panel.style.display !== 'none';
      panel.style.display = visible ? 'none' : 'block';
      if (!visible) {
        setTimeout(function () {
        document.removeEventListener('click', _close);
          document.addEventListener('click', function _close(e) {
            var btn = document.getElementById('shortcuts-btn');
            if (!panel.contains(e.target) && e.target !== btn && !(btn && btn.contains(e.target))) {
              panel.style.display = 'none';
              document.removeEventListener('click', _close);
            }
          });
        }, 0);
      }
    },

    toast: function (msg, type, dur) {
      var displayTitle, displayBody;

      var labels = { success:'Success', error:'Error', warning:'Warning', info:'Info' };
      var icons  = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };

      type = type || 'info';
      if (dur === undefined || dur === null) dur = 3500;

      displayTitle = labels[type] || 'Notice';
      displayBody  = msg || '';

      var box = document.getElementById('toast-box');
      if (!box) return;

      var persistent = (dur <= 0);

      var t = document.createElement('div');
      t.className = 'toast ' + type;
      t.style.position = 'relative';
      t.innerHTML =
        '<div class="toast-icon-strip">' + (icons[type] || 'ℹ️') + '</div>' +
        '<div class="toast-body">' +
          '<div class="toast-title">' + escapeHtml(displayTitle) + '</div>' +
          (displayBody ? '<div class="toast-msg">' + escapeHtml(displayBody) + '</div>' : '') +
        '</div>' +
        '<span class="toast-close" data-action="toast:close" role="button" aria-label="Dismiss" tabindex="0">×</span>' +
        (persistent ? '' : '<div class="toast-progress" style="animation-duration:' + dur + 'ms"></div>');

      var closeBtn = t.querySelector('.toast-close');
      if (closeBtn) closeBtn.addEventListener('click', function () { _removeToast(t); });

      var maxToasts = 5;
      while (box.children.length >= maxToasts) { box.removeChild(box.firstChild); }
      box.appendChild(t);

      function _removeToast(el) {
        el.classList.add('toast-hiding');
        setTimeout(function () { if (el.parentNode) el.remove(); }, 280);
      }
      if (!persistent) setTimeout(function () { _removeToast(t); }, dur);
    },

    spinner: function (show, msg) {
      var el = document.getElementById('spinner');
      var ml = document.getElementById('sp-msg');
      if (!el) return;
      if (show) {
        if (ml) ml.textContent = msg || 'Loading...';
        el.classList.add('show');
        document.body.style.overflow = 'hidden';
      } else {
        el.classList.remove('show');
        document.body.style.overflow = '';
      }
    },

    openModal: function (id) {
      var el = document.getElementById(id);
      if (el) { el.classList.add('open'); document.body.style.overflow = 'hidden'; }
    },

    closeModal: function (id) {
      var el = document.getElementById(id);
      if (el) { el.classList.remove('open'); document.body.style.overflow = ''; }
    },

    toggleDark: function () {
      var on = document.body.classList.toggle('dark');
      setState(function (s) { s.ui.dark = on; });
      try { localStorage.setItem('mh_dark', on ? '1' : '0'); } catch (e) {
        if (window.DEBUG_MODE) console.warn('[ls] dark pref write failed', e);
      }
      var btn = document.getElementById('dm-btn');
      if (btn) btn.textContent = on ? '☀️ Light' : '🌙 Dark';
    },

    togglePwdVisible: function (inputId, btnId) {
      var inp = document.getElementById(inputId);
      var btn = document.getElementById(btnId);
      if (!inp) return;
      inp.type = inp.type === 'password' ? 'text' : 'password';
      if (btn) btn.textContent = inp.type === 'password' ? '👁️' : '🙈';
    },

    toggleUserMenu: function () {
      var m = document.getElementById('user-menu');
      if (!m) return;
      var showing = m.style.display === 'block';
      m.style.display = showing ? 'none' : 'block';
      if (!showing) {
        function _close(e) {
          var tn = document.getElementById('tn-user');
          if (!m.contains(e.target) && !(tn && tn.contains(e.target))) {
            m.style.display = 'none';
            document.removeEventListener('click', _close);
          }
        }
        setTimeout(function () { document.addEventListener('click', _close); }, 10);
      }
    },

    closeUserMenu: function () {
      var m = document.getElementById('user-menu');
      if (m) m.style.display = 'none';
    },

    updateDate: function () {
      var el = document.getElementById('tn-date');
      if (!el) return;
      var d = new Date();
      var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      var mos  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      el.textContent = days[d.getDay()] + ', ' + d.getDate() + ' ' + mos[d.getMonth()] + ' ' + d.getFullYear();
    }
  };

  function go(page, el) {
    if (!page) return;

    // Safety: close any stray full-page overlay modals (e.g. Sale Return form)
    // that aren't part of the normal .pv routing, so they can't stay stuck
    // on top of whichever page the user navigates to next.
    ['saleReturnModal', 'mv'].forEach(function (mid) {
      var m = document.getElementById(mid);
      if (m && m.style.display !== 'none' && m.style.display !== '') {
        m.style.display = 'none';
        document.body.style.overflow = '';
      }
    });

    if (getState().session.loggedIn && page !== 'dashboard' && !_hasPermission(page)) {
      ui.toast('Access denied: ' + page, 'error');
      return;
    }

    if (ERP._internal.getRaw().ui.page === 'dashboard') {
      if (ERP.dash && typeof ERP.dash._destroyCharts === 'function') {
        ERP.dash._destroyCharts();
      }
    }

    document.querySelectorAll('.pv').forEach(function (p) { p.classList.remove('active'); });
    var pv = document.getElementById('pv-' + page);
    if (!pv) {
      var known = ['dashboard','sales','purchase','inventory','repair','customers',
                   'reports','accounting','banking','gst','loans','staff','vehicles',
                   'settings','expenses','appointments'];
      if (known.indexOf(page) === -1) {
        console.warn('[ERP.Router] Unknown page: "' + page + '" — redirecting to dashboard');
        ui.toast('⚠️ Page "' + page + '" nahi mili — dashboard par wapis aa rahe hain', 'warning', 3000);
        setTimeout(function () { go('dashboard'); }, 300);
        return;
      }
    }
    if (pv) pv.classList.add('active');

    document.querySelectorAll('.sb-item').forEach(function (i) { i.classList.remove('active'); });
    var navEl = el || document.getElementById('nav-' + page);
    if (navEl) navEl.classList.add('active');

    document.querySelectorAll('.mbn-item').forEach(function (i) { i.classList.remove('active'); });
    var mbnEl = document.getElementById('mbn-' + page);
    if (mbnEl) mbnEl.classList.add('active');

    var cfg = PAGE_CFG[page] || { title:page, add:false };
    var titleEl = document.getElementById('mh-title');
    if (titleEl) titleEl.textContent = cfg.title;
    var sepEl = document.getElementById('mh-sep');
    if (sepEl) sepEl.style.display = '';
    var addBtn = document.getElementById('top-add-btn');
    if (addBtn) {
      if (cfg.add) {
        addBtn.classList.remove('u-hide');
        var lbl = document.getElementById('top-add-lbl');
        if (lbl) lbl.textContent = cfg.add;
        _topFn = cfg.fn || null;
      } else {
        addBtn.classList.add('u-hide');
        _topFn = null;
      }
    }
    document.title = cfg.title + ' — MH Autos ERP';

    setState(function (s) { s.ui.page = page; });

    var _isUserNav = !!(window._erpUserNav);
    if (history.pushState) {
      if (_isUserNav) {
        history.pushState({ page:page }, '', '#' + page);
      } else {
        history.replaceState({ page:page }, '', '#' + page);
      }
    }
    setTimeout(function() { window._erpUserNav = false; }, 0);

    var _renderReg = ERP._internal.getRenderReg();
    var fn = _renderReg[page];
    if (typeof fn === 'function') safeRun(fn, page);

    if (window.innerWidth <= 768) sidebar.close();
  }

  function topAction() {
    if (!_topFn) return;

    if (_topFn === 'openInvModal')        { if (window.ERP.actions && window.ERP.actions.sales) window.ERP.actions.sales.openModal(); return; }
    if (_topFn === 'openPurModal')        { if (window.ERP.actions && window.ERP.actions.purchase) window.ERP.actions.purchase.openModal(); return; }
    if (_topFn === 'openItemModal')       { var sm=document.getElementById('invModal'); if(sm&&sm.style.display==='flex'&&ERP.sales&&ERP.sales._openAddItemOverlay){ ERP.sales._openAddItemOverlay(); return; } if (window.ERP.actions && window.ERP.actions.inventory) window.ERP.actions.inventory.openAdd(); return; }
    if (_topFn === 'openBatchModal')      { if (window.ERP.batch && window.ERP.batch.openAdd) window.ERP.batch.openAdd(); return; }
    if (_topFn === 'openCustomerModal')   { if (window.ERP.parties) window.ERP.parties.openAdd('customer'); return; }
    if (_topFn === 'openSupplierModal')   { if (window.ERP.parties) window.ERP.parties.openAdd('supplier'); return; }
    if (_topFn === 'openJobModal')        { if (typeof window.openJobModal === 'function') window.openJobModal(); else _toast('Job module not loaded yet', 'warning'); return; }
    if (_topFn === 'openStaffModal')      { if (window.WorkshopStaff) window.WorkshopStaff.openModal(); return; }
    if (_topFn === 'openVehicleModal')    { if (typeof window.openVehicleModal === 'function') window.openVehicleModal(); else _toast('Vehicle module not loaded yet', 'warning'); return; }
    if (_topFn === 'openApptModal')       { if (typeof window.openAppointmentModal === 'function') window.openAppointmentModal(); else _toast('Appointment module not loaded yet', 'warning'); return; }
    if (_topFn === 'openExpenseModal')    { if (window.ERP.expenses && window.ERP.expenses.openAdd) window.ERP.expenses.openAdd(); return; }
    if (_topFn === 'openBankModal')       { if (window.ERP.bank && window.ERP.bank.openAdd) window.ERP.bank.openAdd(); return; }
    if (_topFn === 'openLoanModal')       { if (window.ERP.loans && window.ERP.loans.openAdd) window.ERP.loans.openAdd(); return; }
    if (_topFn === 'openEstimateModal')   { if (window.ERP.sales && window.ERP.sales.openEstimateModal) window.ERP.sales.openEstimateModal(); else _toast('Sales module not loaded yet', 'warning'); return; }
    if (_topFn === 'openSaleOrderModal')  { if (window.ERP.sales && window.ERP.sales.openSaleOrderModal) window.ERP.sales.openSaleOrderModal(); else _toast('Sales module not loaded yet', 'warning'); return; }
    if (_topFn === 'openPayInModal')      { if (window.ERP.sales && window.ERP.sales.openPayInModal) window.ERP.sales.openPayInModal(); else _toast('Sales module not loaded yet', 'warning'); return; }
    if (_topFn === 'openPayOutModal')     { if (window.ERP && window.ERP.sales && window.ERP.sales.openPayOutModal) window.ERP.sales.openPayOutModal(); return; }
    if (_topFn === 'openPaymentOutModal') { if (typeof window.openPaymentOutModal === 'function') window.openPaymentOutModal(); return; }
    if (_topFn === 'openChallanModal')    { if (window.ERP.sales && window.ERP.sales.openChallanModal) window.ERP.sales.openChallanModal(); else _toast('Sales module not loaded yet', 'warning'); return; }
    if (_topFn === 'openPOModal')         { if (window.PurchaseOrders && window.PurchaseOrders.openNew) { window.PurchaseOrders.openNew(); return; } if (window.ERP.purchaseorders && window.ERP.purchaseorders.openAdd) window.ERP.purchaseorders.openAdd(); return; }
    if (window.DEBUG_MODE) console.warn('[topAction] unhandled _topFn:', _topFn);
  }

  var sidebar = {
    toggle: function () {
      var sb  = document.getElementById('sb');
      var bd  = document.getElementById('sb-backdrop');
      var mc  = document.getElementById('main') || document.getElementById('main-content') || document.getElementById('app');
      if (!sb) return;
      var isMobile = window.innerWidth <= 768;
      if (isMobile) {
        var open = sb.classList.toggle('open');
        if (bd) bd.classList.toggle('show', open);
        if (open) document.body.style.overflow = 'hidden';
        else       document.body.style.overflow = '';
      } else {
        var collapsed = sb.classList.toggle('sb-collapsed');
        if (mc) mc.classList.toggle('sb-collapsed', collapsed);
        try { localStorage.setItem('sb_collapsed', collapsed ? '1' : '0'); } catch (e) { if (e.name === 'QuotaExceededError') { console.warn('[sidebar] localStorage quota exceeded'); }
          if (window.DEBUG_MODE) console.warn('[ls] sidebar pref failed', e);
        }
      }
    },
    close: function () {
      var sb = document.getElementById('sb');
      var bd = document.getElementById('sb-backdrop');
      if (sb) sb.classList.remove('open');
      if (bd) bd.classList.remove('show');
      document.body.style.overflow = '';
    },
    grpToggle: function (grpId, hdrId) {
      var grp = document.getElementById(grpId);
      var hdr = document.getElementById(hdrId);
      if (!grp) return;
      var willOpen = !grp.classList.contains('open');
      // Accordion behavior — close all other groups first
      document.querySelectorAll('.sb-grp.open').forEach(function (g) {
        if (g.id !== grpId) {
          g.classList.remove('open');
          var h = document.getElementById('gh-' + g.id.replace('sg-', ''));
          if (h) h.classList.remove('open');
        }
      });
      grp.classList.toggle('open', willOpen);
      if (hdr) hdr.classList.toggle('open', willOpen);
    }
  };

  var _sTimer = null;
  var _sToken = 0;

  var search = {
    query: function (q) {
      clearTimeout(_sTimer);
      if (!q || q.length < 2) { search.hide(); return; }
      var token = ++_sToken;
      _sTimer = setTimeout(function () { search._run(q.toLowerCase().trim(), token); }, 220);
    },

    hide: function () {
      var d = document.getElementById('search-dropdown');
      if (d) d.style.display = 'none';
    },

    _show: function (results, q) {
      var dd = document.getElementById('search-dropdown');
      if (!dd) return;
      if (!results.length) {
        dd.innerHTML = '<div style="padding:12px 16px;color:var(--muted);font-size:13px;text-align:center">No results for "' + escapeHtml(q) + '"</div>';
        dd.style.display = 'block';
        setTimeout(search.hide, 2000);
        return;
      }
      dd.innerHTML = results.slice(0, 40).map(function (r, i) {
        return '<div class="sd-item" data-idx="' + i + '">'
          + '<span style="font-size:16px;flex-shrink:0">' + escapeHtml(r.icon) + '</span>'
          + '<div><div style="font-size:13px;font-weight:500">' + escapeHtml(r.title) + '</div>'
          + '<div style="font-size:11px;color:var(--muted)">' + escapeHtml(r.sub) + '</div></div></div>';
      }).join('');
      dd.querySelectorAll('.sd-item').forEach(function (el, i) {
        el.onclick = function () { search.hide(); if (results[i]) results[i].action(); };
      });
      dd.style.display = 'block';
    },

    _run: function (q, token) {
      var d = getState().data;
      var res = [];
      (d.customers || []).forEach(function (c) {
        if ((c.n || '').toLowerCase().indexOf(q) !== -1 || (c.ph || '').indexOf(q) !== -1)
          res.push({ icon:'👤', title:c.n || '', sub:c.ph || '', action:function () { go('customers'); } });
      });
      (d.inventory || []).forEach(function (p) {
        if ((p.n || '').toLowerCase().indexOf(q) !== -1 || (p.bc || '').toLowerCase().indexOf(q) !== -1)
          res.push({ icon:'📦', title:p.n || '', sub:'Stock:' + (p.st || 0) + ' ' + fmt(p.sp || 0), action:function () { go('inventory'); } });
      });
      (d.sales || []).forEach(function (sl) {
        if ((sl.id || '').toLowerCase().indexOf(q) !== -1 || (sl.cust || '').toLowerCase().indexOf(q) !== -1)
          res.push({ icon:'🧾', title:(sl.id || '') + ' — ' + (sl.cust || ''), sub:sl.date || '', action:function () { go('sales'); } });
      });
      (d.jobs || []).forEach(function (j) {
        if ((j.id || '').toLowerCase().indexOf(q) !== -1 || (j.car || '').toLowerCase().indexOf(q) !== -1 || (j.plate || '').toLowerCase().indexOf(q) !== -1)
          res.push({ icon:'🔧', title:(j.id || '') + ' ' + (j.car || ''), sub:j.plate || '', action:function () { go('repair'); } });
      });
      if (token !== _sToken) return;
      search._show(res, q);
    }
  };

  var notify = {
    add: function (type, msg) {
      setState(function (s) {
        // FIX (root cause, audit #61-63): bare Date.now() with zero randomness
        // -- two notifications added in the same millisecond (e.g. from a
        // batch action) would silently collide/overwrite each other in this
        // list. core.js (ERP.uid) loads first of 92 scripts, before this
        // file, so it's always available; use the one canonical,
        // collision-safe generator instead.
        var entry = { id:ERP.uid(), type:type, msg:msg, read:false, ts:new Date().toISOString() };
        s.notifications = [entry].concat((s.notifications || []).slice(0, 49));
      });
      notify.updateBadge();
      ui.toast(msg, type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info', 5000);
    },

    updateBadge: function () {
      var unread = (getState().notifications || []).filter(function (n) { return !n.read; }).length;
      var dot = document.getElementById('notif-dot');
      if (dot) dot.style.display = unread > 0 ? 'block' : 'none';
    },

    showPanel: function () {
      setState(function (s) {
        s.notifications = (s.notifications || []).map(function (n) { return Object.assign({}, n, { read: true }); });
      });
      notify.updateBadge();
      var first = (getState().notifications || [])[0];
      ui.toast(first ? first.msg : 'No new notifications', 'info');
    },

    check: function () {
      safeRun(function () {
        var d   = getState().data;
        var inv = d.inventory || [];
        var jobs= d.jobs      || [];
        var low = getState().settings.lowStockAlert || 5;
        var out  = inv.filter(function (p) { return (p.st || 0) === 0; });
        var lowI = inv.filter(function (p) { return (p.st || 0) > 0 && (p.st || 0) <= low; });
        if (out.length)       notify.add('error',   '⚠️ ' + out.length + ' item(s) OUT OF STOCK');
        else if (lowI.length) notify.add('warning', '📦 ' + lowI.length + ' item(s) low stock');
        var pending = jobs.filter(function (j) { return j && (j.status === 'pending' || j.status === 'waiting-parts'); }).length;
        if (pending) notify.add('info', '🔧 ' + pending + ' repair jobs pending');
        if (getState().ui.page === 'dashboard') {
          if (ERP.dash && typeof ERP.dash.refreshWidgets === 'function') {
            safeRun(function () { ERP.dash.refreshWidgets(); }, 'widgets');
          }
        }
      }, 'notify.check');
    }
  };

  window.addEventListener('hashchange', function () {
    var page = (window.location.hash || '#dashboard').slice(1);
    if (page) go(page);
  });

  window.addEventListener('popstate', function (e) {
    go((e.state && e.state.page) || 'dashboard');
  });

  document.addEventListener('click', function (e) {
    var dd   = document.getElementById('search-dropdown');
    var wrap = document.querySelector('.tn-search');
    if (!dd || dd.style.display === 'none') return;
    if (wrap && wrap.contains(e.target)) return;
    search.hide();
  });

  
  function _confirmDialog(msg, onConfirm, onCancel) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.style.cssText = 'z-index:9999';
    overlay.innerHTML =
      '<div class="modal" style="max-width:400px;padding:24px">' +
        '<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:var(--text)">' + String(msg) + '</p>' +
        '<div style="display:flex;justify-content:flex-end;gap:10px">' +
          '<button class="btn" id="_cdCancel" style="min-width:80px">Cancel</button>' +
          '<button class="btn btn-danger" id="_cdConfirm" style="min-width:80px">Confirm</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    function _close() { try { document.body.removeChild(overlay); } catch (_) {} }
    overlay.querySelector('#_cdConfirm').addEventListener('click', function() { _close(); if (typeof onConfirm === 'function') onConfirm(); });
    overlay.querySelector('#_cdCancel').addEventListener('click', function() { _close(); if (typeof onCancel === 'function') onCancel(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) { _close(); if (typeof onCancel === 'function') onCancel(); } });
  }

ERP.ui      = ui;
  ERP.go      = go;
  ERP.topAction = topAction;
  ERP.sidebar = sidebar;
  ERP.search  = search;
  ERP.notify  = notify;
  ERP.confirmDialog = _confirmDialog;

  ERP._ui_internal = {
    PAGE_CFG:      PAGE_CFG,
    get RBAC()        { return _getRBAC(); },
    get _ROLE_PERMS() { return _getRolePerms(); },
    _hasPermission: _hasPermission,
    _canDo:        _canDo,
    getTopFn:      function () { return _topFn; }
  };

})(ERP);

window.ERP = ERP;
