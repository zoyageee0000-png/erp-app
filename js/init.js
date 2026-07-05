'use strict';

var ERP = window.ERP || {};

(function (ERP) {
  'use strict';

  function _gs()              { return ERP.getState ? ERP.getState() : {}; }
  function _toast(m, t, d)   { if (ERP.ui && ERP.ui.toast) ERP.ui.toast(m, t, d); }
  function _safeRun(fn, tag) {
    if (ERP.safeRun) ERP.safeRun(fn, tag);
    else { try { fn(); } catch (e) { console.error(tag, e); } }
  }

  var _invActions = {
    openAdd:      function ()           { _safeRun(function () { if (ERP.inventory && ERP.inventory.openAdd) { if (!document.getElementById('inv-tbody') && ERP.inventory.render) ERP.inventory.render(); ERP.inventory.openAdd(); } else _toast('Inventory not loaded', 'warning'); }, 'inv:openAdd'); },
    openEdit:     function (bc)         { _safeRun(function () { if (ERP.inventory && ERP.inventory.openEdit)     ERP.inventory.openEdit(bc);    else _toast('Inventory not loaded', 'warning'); }, 'inv:openEdit'); },
    saveFromForm: function (andAnother) {
      _safeRun(function () {
        if (ERP._invUI && ERP.inventory && ERP.inventory.saveItem) {
          var data = ERP._invUI.readForm();
          if (data && data.error) { _toast(data.error, 'error'); return; }
          var mode = ERP._invUI.readSaveMode();
          var result = ERP.inventory.saveItem(data, andAnother || false, mode);
          if (result && result.ok === false && result.error) { _toast(result.error, 'error'); }
        } else { _toast('Inventory module not ready — please refresh the page.', 'error'); }
      }, 'inv:saveFromForm');
    },
    saveItem:     function (d, a, m)    { _safeRun(function () { if (ERP.inventory && ERP.inventory.saveItem)    ERP.inventory.saveItem(d, a, m); }, 'inv:saveItem'); },
    deleteItem:   function (bc)         { _safeRun(function () { if (ERP.inventory && ERP.inventory.deleteItem)  ERP.inventory.deleteItem(bc);  }, 'inv:deleteItem'); },
    render:       function ()           { _safeRun(function () { if (ERP.inventory && ERP.inventory.render)      ERP.inventory.render();        }, 'inv:render'); },
    canSell:      function (bc, q)      { return ERP.inventory ? ERP.inventory.canSell(bc, q)     : false; },
    deductStock:  function (items)      { return ERP.inventory ? ERP.inventory.deductStock(items) : { ok: false, error: 'not loaded' }; },
    restoreStock: function (items)      { return ERP.inventory ? ERP.inventory.restoreStock(items): { ok: false, error: 'not loaded' }; },
    addBatch:     function (b)          { return ERP.inventory ? ERP.inventory.addBatch(b)        : { ok: false, error: 'not loaded' }; }
  };

  var _salesActions = {
    openModal:  function ()     { _safeRun(function () { if (ERP.sales && ERP.sales.openAdd)  ERP.sales.openAdd();  else _toast('Sales module not loaded yet', 'warning'); }, 'sale:openModal'); },
    openEdit:   function (id)   { _safeRun(function () { if (ERP.sales && ERP.sales.openEdit) ERP.sales.openEdit(id); }, 'sale:openEdit'); },
    closeModal: function ()     { _safeRun(function () { if (ERP.sales && ERP.sales.closeModal) ERP.sales.closeModal(); }, 'sale:closeModal'); },
    render:     function ()     { _safeRun(function () { if (ERP.sales && ERP.sales.render)    ERP.sales.render();   }, 'sale:render'); },
    save:       function (s)    { _safeRun(function () { if (ERP._services && ERP._services.sales) ERP._services.sales.add(s); else _toast('Sales service not loaded', 'error'); }, 'sale:save'); },
    update:     function (id, p){ _safeRun(function () { if (ERP._services && ERP._services.sales) ERP._services.sales.update(id, p); else _toast('Sales service not loaded', 'error'); }, 'sale:update'); },
    deleteSale: function (id)   { _safeRun(function () { if (ERP._services && ERP._services.sales) ERP._services.sales.delete(id); else _toast('Sales service not loaded', 'error'); }, 'sale:delete'); },
    getAll:     function ()     { return (ERP._services && ERP._services.sales) ? ERP._services.sales.getAll() : []; },
    search:     function (q)    {
      var results = (ERP._services && ERP._services.sales) ? ERP._services.sales.search(q) : [];
      if      (ERP.sales && ERP.sales.renderFiltered) ERP.sales.renderFiltered(results);
      else if (ERP.sales && ERP.sales.render)          ERP.sales.render();
      return results;
    }
  };

  var _repairActions = {
    openModal:  function ()          { _safeRun(function () { if (ERP.repair && ERP.repair.openAdd)  ERP.repair.openAdd();  else _toast('Repair module not loaded', 'warning'); }, 'repair:openModal'); },
    openEdit:   function (id)        { _safeRun(function () { if (ERP.repair && ERP.repair.openEdit) ERP.repair.openEdit(id); }, 'repair:openEdit'); },
    updateJob:  function (id, patch) { _safeRun(function () { if (ERP._services && ERP._services.jobs) ERP._services.jobs.update(id, patch); else _toast('Jobs service not loaded', 'error'); }, 'repair:updateJob'); },
    deleteJob:  function (id)        { _safeRun(function () { if (ERP.repair && ERP.repair.delete)   ERP.repair.delete(id); }, 'repair:delete'); },
    render:     function ()          { _safeRun(function () { if (ERP.repair && ERP.repair.render)   ERP.repair.render();  }, 'repair:render'); },
    addJob:     function (job)       { _safeRun(function () { if (ERP._services && ERP._services.jobs) ERP._services.jobs.add(job); else _toast('Jobs service not loaded', 'error'); }, 'repair:addJob'); }
  };

  var _partiesActions = {
    openAdd:       function (type) { _safeRun(function () { if (ERP.parties && ERP.parties.openAdd)       ERP.parties.openAdd(type);       }, 'parties:openAdd'); },
    openEdit:      function (id)   { _safeRun(function () { if (ERP.parties && ERP.parties.openEdit)      ERP.parties.openEdit(id);        }, 'parties:openEdit'); },
    switchTab:     function (tab)  { _safeRun(function () { if (ERP.parties && ERP.parties.switchTab)     ERP.parties.switchTab(tab);      }, 'parties:switchTab'); },
    filterList:    function (val)  { _safeRun(function () { if (ERP.parties && ERP.parties.filterList)    ERP.parties.filterList(val);     }, 'parties:filterList'); },
    selectParty:   function (idx)  { _safeRun(function () { if (ERP.parties && ERP.parties.selectParty)  ERP.parties.selectParty(idx);    }, 'parties:select'); },
    adjustBalance: function ()     { _safeRun(function () { if (ERP.parties && ERP.parties.adjustBalance) ERP.parties.adjustBalance();     }, 'parties:adjust'); },
    render:        function ()     { _safeRun(function () { if (ERP.parties && ERP.parties.renderPage)    ERP.parties.renderPage();        }, 'parties:render'); }
  };

  var _purchaseActions = {
    openModal: function () { _safeRun(function () { if (ERP.purchase && ERP.purchase.openModal) ERP.purchase.openModal(); else _toast('Purchase module not loaded yet', 'warning'); }, 'purchase:openModal'); },
    render:    function () { _safeRun(function () { if (ERP.purchase && ERP.purchase.render)    ERP.purchase.render();   }, 'purchase:render'); }
  };

  var _expensesActions = {
    openModal: function ()    { _safeRun(function () { if (ERP.expenses && ERP.expenses.openAdd) ERP.expenses.openAdd(); else _toast('Expenses module not loaded', 'warning'); }, 'expenses:openModal'); },
    add:       function (exp) { _safeRun(function () { if (ERP._services && ERP._services.expenses) ERP._services.expenses.add(exp); else _toast('Expenses service not loaded', 'error'); }, 'expenses:add'); },
    render:    function ()    { _safeRun(function () { if (ERP.expenses && ERP.expenses.render)  ERP.expenses.render();  }, 'expenses:render'); }
  };

  var _bankActions = {
    openModal: function () { _safeRun(function () { if (ERP.bank && ERP.bank.openAdd) ERP.bank.openAdd(); else _toast('Banking module not loaded', 'warning'); }, 'bank:openModal'); },
    render:    function () { _safeRun(function () { if (ERP.bank && ERP.bank.render)  ERP.bank.render(); }, 'bank:render'); }
  };

  var _dashActions = {
    render:        function () { _safeRun(function () { if (ERP.dash && ERP.dash.render)        ERP.dash.render();        }, 'dash:render'); },
    refreshCharts: function () { _safeRun(function () { if (ERP.dash && ERP.dash.refreshCharts) ERP.dash.refreshCharts(); }, 'dash:refreshCharts'); }
  };

  var _navActions = {
    go: function (page, el) {
      if (ERP.go) {
        window._erpUserNav = true;
        try {
          ERP.go(page, el);
        } finally {
          window._erpUserNav = false;
        }
        if (ERP.events && ERP.events.emit) ERP.events.emit(ERP.events.NAMES.PAGE_CHANGED, { page: page });
      }
    }
  };

  var _authActions = {
    login:       function () { if (ERP.auth && ERP.auth.doLogin)     ERP.auth.doLogin(); },
    logout:      function () { if (ERP.auth && ERP.auth.logout)      ERP.auth.logout(); },
    lockScreen:  function () { if (ERP.auth && ERP.auth.lockScreen)  ERP.auth.lockScreen(); },
    showAudit:   function () { if (ERP.auth && ERP.auth.showAudit)   ERP.auth.showAudit(); },
    exportAudit: function () { if (ERP.auth && ERP.auth.exportAudit) ERP.auth.exportAudit(); }
  };

  var _searchActions = {
    query: function (q) { if (ERP.search && ERP.search.query) ERP.search.query(q); },
    hide:  function ()  { if (ERP.search && ERP.search.hide)  ERP.search.hide(); }
  };

  var _reportsActions  = { render: function () { _safeRun(function () { if (ERP.reports && ERP.reports.render) ERP.reports.render(); }, 'reports:render'); } };
  var _settingsActions = { render: function () { _safeRun(function () { if (ERP.settings && ERP.settings.render) ERP.settings.render(); }, 'settings:render'); } };

  var _utilitiesActions = {
    render: function () {
      var pv = document.getElementById('pv-utilities');
      if (!pv) return;
      pv.innerHTML = '';
      function card(title, desc, actionLabel, actionKey, variant) {
        var wrap = document.createElement('div');
        wrap.className = 'panel';
        wrap.style.cssText = 'margin-bottom:12px;padding:16px';
        var h = document.createElement('div'); h.className = 'panel-head';
        var t = document.createElement('span'); t.className = 'panel-title'; t.textContent = title;
        h.appendChild(t); wrap.appendChild(h);
        if (desc) { var d = document.createElement('p'); d.style.cssText = 'color:var(--muted);font-size:13px;margin:6px 0 10px'; d.textContent = desc; wrap.appendChild(d); }
        var btn = document.createElement('button');
        btn.className = 'btn btn-' + (variant || 'primary') + ' btn-sm';
        btn.setAttribute('data-action', actionKey); btn.textContent = actionLabel;
        wrap.appendChild(btn);
        return wrap;
      }
      pv.appendChild(card('💾 Backup Data',     'Download a full JSON backup.',            'Download Backup',     'db:backup'));
      pv.appendChild(card('📤 Export Data',      'Export all records to a JSON file.',      'Export JSON',         'db:export',  'ghost'));
      pv.appendChild(card('📥 Import / Restore', 'Restore from a previously exported file.','Choose File & Import','db:import',  'ghost'));
      pv.appendChild(card('🗑️ Clear All Data',    'Permanently erase all data.',             'Clear All Data',      'db:clear',   'danger'));
    }
  };

  var _services = {
    backup: {
      create:   function (s) { return ERP._db && ERP._db.backup(s); },
      export:   function ()  { return ERP.storage && ERP.storage.exportJSON && ERP.storage.exportJSON(); },
      import:   function ()  { return ERP.storage && ERP.storage.importJSON && ERP.storage.importJSON(); },
      clearAll: function ()  { return ERP.storage && ERP.storage.clearAll   && ERP.storage.clearAll(); }
    },
    auth: {
      login:          function (u, p)    { return ERP.auth && ERP.auth.login(u, p); },
      logout:         function ()        { return ERP.auth && ERP.auth.logout(); },
      lockScreen:     function ()        { return ERP.auth && ERP.auth.lockScreen(); },
      getUsers:       function ()        { return ERP.auth && ERP.auth.getUsers(); },
      addUser:        function (u,p,n,r) { return ERP.auth && ERP.auth.addUser(u,p,n,r); },
      changePassword: function (u,o,n)   { return ERP.auth && ERP.auth.changePassword(u,o,n); }
    },
    notify: {
      add:         function (type, msg) { return ERP.notify && ERP.notify.add(type, msg); },
      check:       function ()          { return ERP.notify && ERP.notify.check(); },
      showPanel:   function ()          { return ERP.notify && ERP.notify.showPanel(); },
      updateBadge: function ()          { return ERP.notify && ERP.notify.updateBadge(); }
    },
    get jobs()           { return ERP._services && ERP._services.jobs; },
    get sales()          { return ERP._services && ERP._services.sales; },
    get purchase()       { return ERP._services && ERP._services.purchase; },
    get purchaseOrders() { return ERP._services && ERP._services.purchaseOrders; },
    get purchaseReturns(){ return ERP._services && ERP._services.purchaseReturns; },
    get payOut()         { return ERP._services && ERP._services.payOut; },
    get customers()      { return ERP._services && ERP._services.customers; },
    get expenses()       { return ERP._services && ERP._services.expenses; },
    get inventory()      { return ERP._invService || null; }
  };

  function _bootWarn(context, message) {
    console.warn('[ERP.boot] RECOVERABLE:', context, '—', message);
    try {
      if (ERP.AuditLog && ERP.AuditLog.write) {
        ERP.AuditLog.write({
          action: 'boot:recoverable', module: 'Boot', documentId: null,
          before: null, after: { context: context, message: message },
          severity: 'warning'
        });
      }
    } catch (_) {}
  }

  function _runMigrationChecks() {
    try {
      var meta = ERP.getState ? (ERP.getState().meta || {}) : {};
      if ((meta.inventoryEngineVersion || 0) < 2 && ERP.InventoryService && ERP.InventoryService.runMigration) {
        ERP.InventoryService.runMigration(2);
      }
      if ((meta.postingEngineVersion || 0) < 2 && ERP.PostingEngine && ERP.PostingEngine.runMigration) {
        ERP.PostingEngine.runMigration(2);
      }
      if ((meta.salesEngineVersion || 0) < 2 && ERP.SalesService && ERP.SalesService.runMigration) {
        ERP.SalesService.runMigration(2);
      }
      if ((meta.purchaseEngineVersion || 0) < 2 && ERP.PurchaseService && ERP.PurchaseService.runMigration) {
        ERP.PurchaseService.runMigration(2);
      }
    } catch (e) {
      var MigrationErrorCtor = (ERP.errors && ERP.errors.MigrationError) ? ERP.errors.MigrationError : Error;
      throw Object.assign(
        new MigrationErrorCtor('[Boot] Migration failed: ' + e.message),
        { module: 'Boot', operation: '_runMigrationChecks', documentId: null, txId: null,
          timestamp: ERP.DateUtils ? ERP.DateUtils.now() : Date.now(),
          severity: 'fatal' }
      );
    }
  }

  function _bootIntegrityCheck() {
    var failures = [];

    if (!ERP.PostingEngine)    failures.push({ name: 'PostingEngine',   severity: 'fatal' });
    if (!ERP.InventoryService) failures.push({ name: 'InventoryService', severity: 'fatal' });

    try {
      var wal = localStorage.getItem('mh_erp_tx_pending');
      if (wal) {
        try {
          var walInfo = JSON.parse(wal);
          var walTs   = walInfo.timestamp || walInfo.ts || 0;
          var walType = walInfo.type      || walInfo.op  || '?';
          var ageMs   = Date.now() - walTs;
          if (ageMs < 60000) {
            failures.push({
              name: 'WAL_PENDING',
              severity: 'recoverable',
              detail: 'Incomplete write from last session (type: ' + walType + ', id: ' + (walInfo.id || '?') + '). Data integrity check triggered.'
            });
          }
        } finally {
          try { localStorage.removeItem('mh_erp_tx_pending'); } catch (_) {}
        }
      }
    } catch (_) {}

    try {
      var corruptSnippet = localStorage.getItem((ERP.CONSTANTS && ERP.CONSTANTS.STORAGE_KEYS && ERP.CONSTANTS.STORAGE_KEYS.CORRUPT_BCK) || 'mh_erp_data_corrupt_backup');
      if (corruptSnippet) {
        failures.push({
          name: 'CORRUPT_BACKUP',
          severity: 'recoverable',
          detail: 'Previous session data was corrupted. Restore from a backup before entering new data.'
        });
      }
    } catch (_) {}

    try {
      if (ERP.BalanceProjection && ERP.BalanceProjection.verifyChecksum) {
        var csOk = ERP.BalanceProjection.verifyChecksum();
        if (!csOk) {
          failures.push({ name: 'PROJECTION_CHECKSUM', severity: 'recoverable',
            detail: 'BalanceProjection checksum mismatch — rebuild triggered.' });
          if (ERP.BalanceProjection.rebuild) ERP.BalanceProjection.rebuild();
        }
      }
    } catch (_) {}

    var hasFatal = false;
    failures.forEach(function (f) {
      if (f.severity === 'fatal') {
        hasFatal = true;
        _bootWarn(f.name, f.detail || 'Required engine missing');
        var app = document.getElementById('app');
        if (app) {
          app.innerHTML =
            '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;'
            + 'min-height:100vh;gap:16px;color:#dc2626;text-align:center;padding:32px">'
            + '<div style="font-size:48px">⛔</div>'
            + '<div style="font-size:20px;font-weight:700">ERP Boot Failure</div>'
            + '<div style="font-size:14px;max-width:420px;color:#374151">Required engine not registered: <code>'
            + f.name + '</code><br>Please reload or contact support.</div>'
            + '</div>';
        }
      } else {
        _bootWarn(f.name, f.detail || 'Non-critical boot warning');
        ERP._bootWarnings = ERP._bootWarnings || [];
        ERP._bootWarnings.push(f);
      }
    });

    if (hasFatal) {
      var IntegrityErrorCtor = (ERP.errors && ERP.errors.IntegrityCheckError) ? ERP.errors.IntegrityCheckError : Error;
      throw Object.assign(
        new IntegrityErrorCtor(
          '[Boot] Fatal integrity check failure — see console'
        ),
        { module: 'Boot', operation: 'BootIntegrityCheck', documentId: null, txId: null,
          timestamp: ERP.DateUtils ? ERP.DateUtils.now() : Date.now() }
      );
    }
  }

  function _injectPrinterTab() {
    var tabBar = document.getElementById('sets-tabs');
    if (!tabBar || tabBar.querySelector('[data-sets-tab="printer"]')) return;

    var btn = document.createElement('button');
    btn.setAttribute('data-sets-tab', 'printer');
    btn.setAttribute('data-action', 'settings:switchTab');
    btn.setAttribute('data-tab', 'printer');
    btn.style.cssText = [
      'flex:1','border:none','background:transparent','padding:11px 8px',
      'font-size:12px','font-weight:400','color:#64748b','cursor:pointer',
      'border-bottom:2px solid transparent','transition:all .15s',
      'white-space:nowrap','display:flex','align-items:center',
      'justify-content:center','gap:4px'
    ].join(';');
    btn.innerHTML = '🖨️ <span>Printer</span>';
    tabBar.appendChild(btn);

    if (!document.getElementById('sets-pnl-printer')) {
      var container = tabBar.parentElement;
      if (!container) return;
      var panel = document.createElement('div');
      panel.id        = 'sets-pnl-printer';
      panel.className = 'sets-panel';
      panel.style.display = 'none';
      panel.innerHTML =
        '<div style="margin-bottom:16px">'
        + '<div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.6px;margin-bottom:12px">🖨️ Printer Configuration</div>'
        + '<div class="panel"><div class="modal-body" style="padding:12px 0 0">'
        + '<div style="background:#dbeafe;border:1px solid #93c5fd;border-radius:10px;padding:12px 16px;margin-bottom:14px;font-size:12px;color:#4338CA">'
        + '💡 Full printer settings alag page par hain.</div>'
        + '<button class="btn btn-primary" data-action="nav:go" data-page="printer">🖨️ Open Full Printer Settings</button>'
        + '</div></div></div>';
      container.appendChild(panel);
    }
  }

  var _actionMapCache = null;
  var _clickBound     = false;

  function _getActionMap() {
    if (_actionMapCache) return _actionMapCache;
    _actionMapCache = {
      'ui:toggleDark':      function () { if (ERP.ui) ERP.ui.toggleDark(); },
      'ui:toggleSidebar':   function () { if (ERP.sidebar) ERP.sidebar.toggle(); },
      'ui:toggleShortcuts': function () { if (ERP.ui) ERP.ui.toggleShortcuts(); },
      'ui:toggleUserMenu':  function () { if (ERP.ui) ERP.ui.toggleUserMenu(); },
      'ui:closeUserMenu':   function () { if (ERP.ui) ERP.ui.closeUserMenu(); },
      'ui:print':           function () { if (window.RTP && window.RTP._print) { window.RTP._print(document.title); } else { window.print(); } },
      'ui:topAction':       function () { if (ERP.topAction) ERP.topAction(); },

      'camera:open':      function () { if (ERP.camera) ERP.camera.open(); },
      'camera:close':     function () { if (ERP.camera) ERP.camera.close(); },
      'camera:snap':      function () { if (ERP.camera) ERP.camera.snap(); },
      'camera:switchCam': function () { if (ERP.camera) ERP.camera.switchCam(); },

      'voice:toggle': function () { if (ERP.voice) ERP.voice.toggle(); },

      'dash:refreshCharts': function () { _dashActions.refreshCharts(); },

      'loan:add':    function ()   { if (ERP.loans && ERP.loans.openAdd)  ERP.loans.openAdd(); },

      'batch:add':   function ()   { if (ERP.batch && ERP.batch.openAdd)  ERP.batch.openAdd(); },
      'batch:close': function ()   { if (ERP.batch && ERP.batch.closeAdd) ERP.batch.closeAdd(); },
      'batch:save':  function ()   { if (ERP.batch && ERP.batch.save)     ERP.batch.save(); },
      'batch:del':   function (el) { var i = parseInt(el.dataset.idx, 10); if (!isNaN(i) && ERP.batch) ERP.batch.del(i, el); },

      'party:edit':          function ()   { if (ERP.parties && ERP.parties.editSelected)  ERP.parties.editSelected(); },
      'party:statement':     function ()   { if (ERP.parties && ERP.parties.showStatement) ERP.parties.showStatement(); },
      'party:select':        function (el) { var idx = parseInt(el.getAttribute('data-idx'), 10); if (!isNaN(idx)) _partiesActions.selectParty(idx); },
      'party:switchTab':     function (el) { var tab = el.getAttribute('data-tab'); if (tab) _partiesActions.switchTab(tab); },
      'party:closeAdd':      function ()   { if (ERP.parties && ERP.parties.closeAdd) ERP.parties.closeAdd(); },
      'party:closeBgAdd':    function (el) { if (el && el.id === 'addPartyModal-bg' && ERP.parties && ERP.parties.closeAdd) ERP.parties.closeAdd(); },
      'party:apmTab':        function (el) { var tab = el.getAttribute('data-tab'); if (tab && ERP.parties && ERP.parties._switchApmTab) ERP.parties._switchApmTab(tab); },
      'party:saveNew':       function ()   { if (ERP.parties && ERP.parties.saveNew) ERP.parties.saveNew(); },
      'party:addCustomer':   function ()   { _partiesActions.openAdd('customer'); },
      'party:addSupplier':   function ()   { _partiesActions.openAdd('supplier'); },
      'party:adjustBalance': function ()   { _partiesActions.adjustBalance(); },
      'party:whatsapp':      function (el) {
        // FIX (root-cause, was a real bug — audit finding #96): this handler used to just
        // strip non-digits and never add the '92' country code, so a local number like
        // '03001234567' produced a broken wa.me link here while every other WhatsApp
        // button in the app (parties.js, sup:wa, reports.js) correctly normalized it to
        // '923001234567'. Now uses the one shared, correct implementation everywhere.
        var phone = el.getAttribute('data-phone') || '';
        if (ERP.WhatsAppLink && typeof ERP.WhatsAppLink.open === 'function') {
          ERP.WhatsAppLink.open(phone);
        } else {
          var ph = phone.replace(/\D/g, '');
          if (ph.length === 10) ph = '92' + ph; else if (ph.charAt(0) === '0') ph = '92' + ph.slice(1);
          if (ph) { var u = 'https://wa.me/' + ph; var w = window.open(u, '_blank', 'noopener,noreferrer'); if (!w) window.location.href = u; }
        }
      },

      'cust:sendBirthdayWishes':   function ()   { if (ERP.cust && ERP.cust.sendBirthdayWishes)   ERP.cust.sendBirthdayWishes(); },
      'cust:sendServiceReminders': function ()   { if (ERP.cust && ERP.cust.sendServiceReminders) ERP.cust.sendServiceReminders(); },
      'cust:filterVIP':            function ()   { if (ERP.cust && ERP.cust.filterVIP)            ERP.cust.filterVIP(); },
      'cust:filterCredit':         function ()   { if (ERP.cust && ERP.cust.filterCredit)         ERP.cust.filterCredit(); },
      'cust:ledger':               function (el) { var i = parseInt(el.dataset.idx, 10); if (!isNaN(i) && ERP.cust) ERP.cust.viewLedger(i); },
      'cust:wa':                   function (el) { var i = parseInt(el.dataset.idx, 10); if (!isNaN(i) && ERP.cust) ERP.cust.sendWA(i); },
      'cust:edit':                 function (el) { var i = parseInt(el.dataset.idx, 10); if (!isNaN(i) && ERP.cust) ERP.cust.openEdit(i); },
      'cust:del':                  function (el) { var i = parseInt(el.dataset.idx, 10); if (!isNaN(i) && ERP.cust) ERP.cust.del(i, el); },

      'sup:view':                  function (el) { var i = parseInt(el.dataset.idx, 10); if (!isNaN(i) && ERP.sup) ERP.sup.viewDetail(i); },
      'sup:ledger':                function (el) { var i = parseInt(el.dataset.idx, 10); if (!isNaN(i) && ERP.sup) ERP.sup.viewLedger(i); },
      'sup:edit':                  function (el) { var i = parseInt(el.dataset.idx, 10); if (!isNaN(i) && ERP.sup) ERP.sup.openEdit(i); },
      'sup:del':                   function (el) { var i = parseInt(el.dataset.idx, 10); if (!isNaN(i) && ERP.sup) ERP.sup.del(i, el); },
      'sup:wa':                    function (el) {
        var i = parseInt(el.dataset.idx, 10);
        if (isNaN(i)) return;
        var st   = (ERP.state && ERP.state.get) ? ERP.state.get() : null;
        var sups = (st && st.data && st.data.suppliers) || [];
        var s = sups[i];
        if (!s) return;
        var ph = String(s.ph || s.phone || '').replace(/\D/g, '');
        if (ph.length === 10) {
          ph = '92' + ph;
        } else if (ph.length === 11 && ph.charAt(0) === '0') {
          ph = '92' + ph.slice(1);
        }
        if (!ph) { if (ERP.ui && ERP.ui.toast) ERP.ui.toast('Phone number not found', 'error'); return; }
        var msg = 'Assalam o Alaikum ' + (s.n || '') + ' sahab,\nApka purchase record update hai.\nShukriya.';
        // FIX (root cause, audit #96): this second handler in the same file was still an
        // independent wa.me build, missed when init.js's other 'party:whatsapp' handler
        // was migrated. Route through the one canonical builder/opener.
        if (ERP.WhatsAppLink && typeof ERP.WhatsAppLink.open === 'function') {
          ERP.WhatsAppLink.open(ph, msg);
        } else {
          var u = 'https://wa.me/' + ph + '?text=' + encodeURIComponent(msg);
          var w = window.open(u, '_blank', 'noopener,noreferrer');
          if (!w) window.location.href = u;
        }
      },

      'sidebar:close':      function ()   { if (ERP.sidebar) ERP.sidebar.close(); },
      'sidebar:toggle':     function ()   { if (ERP.sidebar) ERP.sidebar.toggle(); },
      'sidebar:grpToggle':  function (el) { if (ERP.sidebar && ERP.sidebar.grpToggle) ERP.sidebar.grpToggle(el.getAttribute('data-grp'), el.getAttribute('data-hdr')); },

      'nav:go': function (el) {
        var page = el.getAttribute('data-page');
        if (page) _navActions.go(page, el);
      },
      'nav:goSettings': function () { _navActions.go('settings'); },

      'auth:doLogin':             function ()   { if (ERP.auth && ERP.auth.doLogin) ERP.auth.doLogin(); },
      'auth:showLogin':           function ()   { if (ERP.auth && ERP.auth.showPanel) ERP.auth.showPanel('login'); },
      'auth:togglePwd':           function (el) { if (ERP.auth && ERP.auth.togglePassword) ERP.auth.togglePassword(el.getAttribute('data-input') === 's-pass' ? 'setup' : 'login'); },
      'auth:login':               function ()   { _authActions.login(); },
      'auth:logout':              function ()   { _authActions.logout(); },
      'auth:lockScreen':          function ()   { _authActions.lockScreen(); },
      'auth:showAudit':           function ()   { _authActions.showAudit(); },
      'auth:exportAudit':         function ()   { _authActions.exportAudit(); },
      'auth:clearAudit':          function ()   { if (ERP.auth && ERP.auth.clearAudit) ERP.auth.clearAudit(); },
      'auth:closeAudit':          function ()   { if (ERP.auth && ERP.auth.closeAudit) ERP.auth.closeAudit(); },
      'auth:extendSession':       function ()   { if (ERP.auth && ERP.auth.extendSession) ERP.auth.extendSession(); },
      'auth:pinKey':              function (el) { if (ERP.auth && ERP.auth.pinKey) ERP.auth.pinKey(el.getAttribute('data-key') || el.textContent.trim()); },
      'auth:pinSetupKey':         function (el) { if (ERP.auth && ERP.auth.pinSetupKey) ERP.auth.pinSetupKey(el.getAttribute('data-key') || el.textContent.trim()); },
      'auth:showPinSetup':        function ()   { if (ERP.auth && ERP.auth.showPinSetup) ERP.auth.showPinSetup(); },
      'auth:closePinSetup':       function ()   { if (ERP.auth && ERP.auth.closePinSetup) ERP.auth.closePinSetup(); },
      'auth:removePin':           function ()   { if (ERP.auth && ERP.auth.removePin) ERP.auth.removePin(); },
      'auth:showSetup':           function ()   { if (ERP.auth && ERP.auth.showSetup) ERP.auth.showSetup(); },
      'auth:createAdmin':         function ()   { if (ERP.auth && ERP.auth.createAdmin) ERP.auth.createAdmin(); },
      'auth:showForgot':          function ()   { if (ERP.auth && ERP.auth.showPanel) ERP.auth.showPanel('forgot'); },
      'auth:frgtStep1':           function ()   { if (ERP.auth && ERP.auth.frgtStep1) ERP.auth.frgtStep1(); },
      'auth:frgtStep2':           function ()   { if (ERP.auth && ERP.auth.frgtStep2) ERP.auth.frgtStep2(); },
      'auth:frgtStep3':           function ()   { if (ERP.auth && ERP.auth.frgtStep3) ERP.auth.frgtStep3(); },
      'auth:frgtBack':            function ()   { if (ERP.auth && ERP.auth.frgtBack) ERP.auth.frgtBack(); },
      'auth:toggleFrgtUnameHint': function ()   { if (ERP.auth && ERP.auth.toggleFrgtUnameHint) ERP.auth.toggleFrgtUnameHint(); },

      'search:clear': function ()   { if (ERP.search && ERP.search.hide) ERP.search.hide(); },
      'search:hide':  function ()   { if (ERP.search && ERP.search.hide) ERP.search.hide(); },

      'db:backup': function () {
        if (ERP.BackupEngine && typeof ERP.BackupEngine.exportToFile === 'function') {
          ERP.BackupEngine.exportToFile();
        } else if (ERP._db && ERP._db.backup) {
          ERP._db.backup();
        }
      },
      'db:export': function () { if (ERP.storage && ERP.storage.exportJSON) ERP.storage.exportJSON(); },
      'db:import': function () { if (ERP.storage && ERP.storage.importJSON) ERP.storage.importJSON(); },
      'db:clear':  function () { if (ERP.storage && ERP.storage.clearAll)   ERP.storage.clearAll(); },

      'settings:clearAll':         function () { if (ERP.settings && ERP.settings.clearAll)          ERP.settings.clearAll(); },
      'settings:clearTransactions': function () { if (ERP.settings && ERP.settings.clearTransactions) ERP.settings.clearTransactions(); },

      'inv:add':        function ()   { _invActions.openAdd(); },
      'inv:save':       function ()   { _invActions.saveFromForm(false); },
      'inv:saveAnother':function ()   { _invActions.saveFromForm(true); },
      'inv:edit':       function (el) { _invActions.openEdit(el.getAttribute('data-bc')); },
      'inv:delete':     function (el) { _invActions.deleteItem(el.getAttribute('data-bc')); },

      'sale:add':       function ()   { _salesActions.openModal(); },
      'sale:edit':      function (el) { _salesActions.openEdit(el.getAttribute('data-id')); },
      'sale:close':     function ()   { _salesActions.closeModal(); },

      'repair:add':     function ()   { _repairActions.openModal(); },
      'repair:edit':    function (el) { _repairActions.openEdit(el.getAttribute('data-id')); },

      'purchase:add':   function ()   { _purchaseActions.openModal(); },

      'expense:add':    function ()   { _expensesActions.openModal(); },

      'bank:add':       function ()   { _bankActions.openModal(); },

      'notify:showPanel': function () { if (ERP.notify && ERP.notify.showPanel) ERP.notify.showPanel(); },
      'notify:clearAll':  function () { if (ERP.notify && ERP.notify.clearAll) ERP.notify.clearAll(); },

      'settings:switchTab': function (el) {
        var tab = el.getAttribute('data-tab') || el.getAttribute('data-sets-tab');
        if (tab && ERP.settings && ERP.settings._switchTab) ERP.settings._switchTab(tab);
      },

      'jobs:openModal':       function () { ERP.actions.jobs.openModal(); },
      'jobs:addVehicle':      function () { ERP.actions.jobs.addVehicle(); },
      'jobs:bookAppointment': function () { ERP.actions.jobs.bookAppointment(); },

      'modal:closeLedger': function () {
        var m = document.getElementById('ledgerModal');
        if (m) { m.classList.remove('open'); document.body.style.overflow = ''; }
      },

      'modal:stop': function (el, e) { if (e) e.stopPropagation(); },

      'inv:exportItemsCSV':   function () {
        if (ERP.inventory && typeof ERP.inventory.exportCSV === 'function') {
          ERP.inventory.exportCSV();
        } else { _toast('Inventory module not loaded', 'warning'); }
      },
      'inv:importCSV': function () {
        if (ERP.inventory && typeof ERP.inventory.importCSV === 'function') {
          ERP.inventory.importCSV();
        } else { _toast('Inventory module not loaded', 'warning'); }
      },
      'inv:downloadTemplate': function () {
        if (ERP.inventory && typeof ERP.inventory.downloadTemplate === 'function') {
          ERP.inventory.downloadTemplate();
        } else { _toast('Inventory module not loaded', 'warning'); }
      },

      'party:exportCSV': function () {
        if (ERP.parties && typeof ERP.parties.exportCSV === 'function') {
          ERP.parties.exportCSV();
        } else { _toast('Parties module not loaded', 'warning'); }
      },
      'party:importCSV': function () {
        if (ERP.parties && typeof ERP.parties.importCSV === 'function') {
          ERP.parties.importCSV();
        } else { _toast('Parties module not loaded', 'warning'); }
      },
      'party:downloadTemplate': function () {
        if (ERP.parties && typeof ERP.parties.downloadTemplate === 'function') {
          ERP.parties.downloadTemplate();
        } else { _toast('Parties module not loaded', 'warning'); }
      },

      'cust:creditReturn': function (el) {
        var custName = el.getAttribute('data-cust-name') || '';
        if (ERP.sales && typeof ERP.sales.openPayOutModal === 'function') {
          ERP.sales.openPayOutModal(custName);
        } else {
          _toast('Sales module not loaded — cannot open refund form', 'warning');
        }
      }
    };
    return _actionMapCache;
  }

  (function _bindClicks() {
    if (_clickBound) return;
    _clickBound = true;
    document.addEventListener('click', function (e) {
      var el = e.target;
      while (el && el !== document.body) {
        if (el.getAttribute && el.getAttribute('data-action')) break;
        el = el.parentElement;
      }
      if (!el || !el.getAttribute) return;
      var action = el.getAttribute('data-action');
      if (!action) return;
      var map = _getActionMap();
      var fn  = map[action];
      if (fn) {
        if (el.classList.contains('modal-bg') && e.target !== el) return;
        _safeRun(function () { fn(el, e); }, '[ERP data-action] ' + action);
      } else {
        if (window.DEBUG_MODE) console.error('[ERP] Unknown data-action: "' + action + '"', el);
      }
    });
  })();

  (function () {
    var _inputMap = {
      'auth:focusPass':            function ()  { var p = document.getElementById('l-pass'); if (p) p.focus(); },
      'auth:frgtClearErr':         function ()  { if (ERP.auth && ERP.auth.frgtClearErr)         ERP.auth.frgtClearErr(); },
      'auth:frgtValidateStrength': function ()  { if (ERP.auth && ERP.auth.frgtValidateStrength) ERP.auth.frgtValidateStrength(); },
      'auth:frgtStep1':            function ()  { if (ERP.auth && ERP.auth.frgtStep1)            ERP.auth.frgtStep1(); },
      'auth:frgtStep2':            function ()  { if (ERP.auth && ERP.auth.frgtStep2)            ERP.auth.frgtStep2(); },
      'auth:frgtStep3':            function ()  { if (ERP.auth && ERP.auth.frgtStep3)            ERP.auth.frgtStep3(); },
      'search:query':  function (el) { if (ERP.search && ERP.search.query) ERP.search.query(el.value); },
      'search:clear':  function (el) { el.value = ''; if (ERP.search && ERP.search.hide) ERP.search.hide(); },
      'cust:search':   function (el) { if (ERP.cust && ERP.cust.search) ERP.cust.search(el.value); },
      'sup:search':    function (el) { if (ERP.sup  && ERP.sup.search)  ERP.sup.search(el.value); },
      'parties:filter': function (el) { if (ERP.parties && ERP.parties.filterList) ERP.parties.filterList(el.value); },
      'parties:apmClearErr': function (el) {
        var f = el.getAttribute('data-field');
        if (f && ERP.parties && ERP.parties._apmClearErr) ERP.parties._apmClearErr(f);
      }
    };
    document.addEventListener('input', function (e) {
      var el = e.target;
      var action = el.getAttribute('data-erp-input');
      if (!action) return;
      var fn = _inputMap[action];
      if (fn) try { fn(el); } catch (err) { if (window.DEBUG_MODE) console.warn('[erp:input] ' + action, err); }
    });
    document.addEventListener('keydown', function (e) {
      var el = e.target;
      if (e.key === 'Enter') {
        var act = el.getAttribute('data-erp-enter');
        if (act) { var fn = _inputMap[act]; if (fn) try { fn(el); } catch (err) { if (window.DEBUG_MODE) console.warn('[erp:enter] ' + act, err); } }
      }
      if (e.key === 'Escape') {
        var escAct = el.getAttribute('data-erp-escape');
        if (escAct) { var escFn = _inputMap[escAct]; if (escFn) try { escFn(el); } catch (err) { if (window.DEBUG_MODE) console.warn('[erp:escape] ' + escAct, err); } }
      }
    });
  })();

  document.addEventListener('keydown', function (e) {
    var tag   = (e.target.tagName || '').toLowerCase();
    var inInp = (tag === 'input' || tag === 'textarea' || tag === 'select');
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && !inInp) {
      e.preventDefault();
      if (ERP.undoState) { ERP.undoState(); _toast('Undo ✓', 'info', 1500); }
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && !inInp) {
      e.preventDefault();
      if (ERP.redoState) { ERP.redoState(); _toast('Redo ✓', 'info', 1500); }
    }
  });

  var _REQUIRED_PV_IDS = [
    'pv-dashboard','pv-sales','pv-purchase','pv-inventory',
    'pv-batchtrack','pv-repair','pv-vehicle','pv-appointment',
    'pv-reports','pv-settings','pv-parties','pv-customers',
    'pv-supplier','pv-expenses','pv-bank','pv-loans',
    'pv-accounts','pv-estimates','pv-invoice','pv-printer',
    'pv-themes','pv-utilities'
  ];

  ERP._partialLoadErrors = [];

  function _loadPartials() {
    var missing = [];
    _REQUIRED_PV_IDS.forEach(function (pvId) {
      if (!document.getElementById(pvId)) {
        missing.push(pvId);
        ERP._partialLoadErrors.push({ pvId: pvId, error: 'Container not found in DOM' });
      }
    });
    if (missing.length) {
      console.warn('[ERP partials] ⚠️ Missing DOM containers: ' + missing.join(', '));
    } else if (window.DEBUG_MODE) {
      console.log('[ERP partials] ✅ All ' + _REQUIRED_PV_IDS.length + ' containers verified.');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {

    if (!ERP.DateUtils) {
      console.error('[Boot] FATAL: ERP.DateUtils not registered — core.js not loaded or load order wrong.');
      return;
    }
    if (!ERP.CONSTANTS) {
      _bootWarn('CONSTANTS', 'ERP.CONSTANTS not registered — constants.js may not have loaded yet. Retrying attachment...');
      try {
        if (typeof MH_CONSTANTS !== 'undefined') {
          Object.defineProperty(ERP, 'CONSTANTS', { value: MH_CONSTANTS, writable: false, configurable: false, enumerable: true });
        }
      } catch (_) {}
    }

    if (!ERP.AuditLog) {
      _bootWarn('AuditLog', 'ERP.AuditLog not registered — audit_trail.js may not have loaded. Audit writes will be silently dropped.');
    }

    if (!ERP.StorageAdapter && !ERP.storage) {
      _bootWarn('StorageAdapter', 'ERP.StorageAdapter / ERP.storage not registered — persistence may be unavailable.');
    }

    try {
      if (ERP.WALRecovery && ERP.WALRecovery.run) {
        ERP.WALRecovery.run();
      }
    } catch (walErr) {
      _bootWarn('WALRecovery', 'WAL recovery threw: ' + walErr.message);
    }

    var _engineChecks = [
      { name: 'InventoryService', val: ERP.InventoryService, fatal: true },
      { name: 'PostingEngine',    val: ERP.PostingEngine,    fatal: true },
      { name: 'SalesService',     val: ERP.SalesService,     fatal: false },
      { name: 'PurchaseService',  val: ERP.PurchaseService,  fatal: false },
      { name: 'ReportQuery',      val: ERP.ReportQuery || window.ReportQuery, fatal: false }
    ];
    var _bootHalted = false;
    _engineChecks.forEach(function (check) {
      if (!check.val) {
        if (check.fatal) {
          var app = document.getElementById('app');
          if (app) {
            app.innerHTML =
              '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;'
              + 'min-height:100vh;gap:16px;color:#dc2626;text-align:center;padding:32px">'
              + '<div style="font-size:48px">⛔</div>'
              + '<div style="font-size:20px;font-weight:700">ERP Boot Failure</div>'
              + '<div style="font-size:14px;max-width:420px;color:#374151">'
              + 'Required engine not registered: <code>' + check.name + '</code><br>'
              + 'Check script load order in index.html.</div></div>';
          }
          console.error('[Boot] FATAL: Required engine not registered:', check.name);
          _bootHalted = true;
        } else {
          _bootWarn(check.name, check.name + ' not registered — some features will be unavailable.');
        }
      }
    });
    if (_bootHalted) return;

    try {
      if (window.PurchaseState && typeof window.PurchaseState.getQuarantinedRecords === 'function') {
        var _qRecords = window.PurchaseState.getQuarantinedRecords();
        if (_qRecords && _qRecords.length) {
          _bootWarn('PurchaseState', _qRecords.length + ' purchase record(s) failed to load and were quarantined — check PurchaseState.getQuarantinedRecords().');
        }
      }
    } catch (qCheckErr) {
      _bootWarn('PurchaseState', 'Quarantine check threw: ' + qCheckErr.message);
    }

    try {
      _runMigrationChecks();
    } catch (migErr) {
      console.error('[Boot] FATAL: Migration failed —', migErr.message);
      _toast('⛔ Migration failed — data may be in an inconsistent state. Please contact support.', 'error', 0);
      return;
    }

    try {
      _bootIntegrityCheck();
    } catch (intErr) {
      console.error('[Boot] FATAL: BootIntegrityCheck threw:', intErr.message);
      return;
    }

    if (ERP._bootWarnings && ERP._bootWarnings.length) {
      ERP._bootWarnings.forEach(function (w) {
        _toast('⚠️ ' + w.name + ': ' + (w.detail || 'Non-critical boot warning'), 'warning', 8000);
      });
    }

    (function _checkPrivateMode() {
      try {
        var _ssKey = '__mh_priv_chk__';
        sessionStorage.getItem(_ssKey);
        try { sessionStorage.setItem(_ssKey, '1'); } catch (_e) {}
        if (!window.indexedDB) { _showPrivateBanner(); return; }
        var probe = window.indexedDB.open('__mh_priv_probe__');
        probe.onerror = function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); _showPrivateBanner(); };
        probe.onsuccess = function () {
          try { probe.result.close(); window.indexedDB.deleteDatabase('__mh_priv_probe__'); } catch (_e) {}
        };
      } catch (_e) { _showPrivateBanner(); }

      function _showPrivateBanner() {
        var msg = '🔴 Private/Incognito mode detected — ALL data will be lost when this window closes. Open ERP in a normal browser window.';
        if (ERP.ui && ERP.ui.toast) {
          ERP.ui.toast(msg, 'error', 0);
        } else {
          var banner = document.createElement('div');
          banner.style.cssText = 'position:fixed;top:0;left:0;width:100%;z-index:var(--zi-critical,1100);background:#c0392b;color:#fff;padding:10px 16px;font-size:14px;font-weight:bold;text-align:center;';
          banner.textContent = msg;
          document.body.insertBefore(banner, document.body.firstChild);
        }
      }
    }());

    (function _checkCorruptBackup() {
      try {
        var snippet = localStorage.getItem((ERP.CONSTANTS && ERP.CONSTANTS.STORAGE_KEYS && ERP.CONSTANTS.STORAGE_KEYS.CORRUPT_BCK) || 'mh_erp_data_corrupt_backup');
        if (snippet) {
          _toast('⚠️ Previous session data was corrupted. Go to Settings → Backup to restore before entering new data.', 'warning', 0);
          console.warn('[ERP.boot] Corrupt backup key found. Snippet:', snippet.substring(0, 200));
        }
      } catch (_e) {}
    }());

    (function _sanitizeLogoURL() {
      try {
        var _mainKeyLogo = (ERP.CONSTANTS && ERP.CONSTANTS.STORAGE_KEYS && ERP.CONSTANTS.STORAGE_KEYS.MAIN) || 'mh_erp_data';
        ['mh_erp_biz','mh_biz','biz', _mainKeyLogo].forEach(function (k) {
          try {
            var raw = localStorage.getItem(k);
            if (!raw) return;
            var parsed = JSON.parse(raw);
            var logo = parsed && (parsed.logo || (parsed.biz && parsed.biz.logo));
            if (!logo || /^(https?:\/\/|data:image\/)/i.test(logo)) return;
            if (parsed.logo) parsed.logo = '';
            if (parsed.biz && parsed.biz.logo) parsed.biz.logo = '';
            try { localStorage.setItem(k, JSON.stringify(parsed)); } catch (_e) {}
            console.warn('[ERP.boot] Cleared invalid logo URL:', String(logo).substring(0, 80));
          } catch (_e) {}
        });
        if (ERP.getState) {
          var s = ERP.getState();
          if (s && s.biz && s.biz.logo && !/^(https?:\/\/|data:image\/)/i.test(s.biz.logo)) {
            if (ERP._internal && ERP._internal.setState) {
              ERP._internal.setState(function (st) { if (st.biz) st.biz.logo = ''; }, 'boot:sanitizeLogo');
            }
          }
        }
      } catch (_e) {}
    }());

    _loadPartials();

    if (ERP.ui && ERP.ui.updateDate) {
      ERP.ui.updateDate();
      ERP._dateInterval = ERP.TimerRegistry.start('init.dateUpdate', ERP.ui.updateDate, 60000);
    }

    try {
      if (localStorage.getItem('sb_collapsed') === '1') {
        var sb = document.getElementById('sb');
        var mc = document.getElementById('main') || document.getElementById('main-content') || document.getElementById('app');
        if (sb) { sb.classList.add('sb-collapsed'); }
        if (mc) mc.classList.add('sb-collapsed');
      }
    } catch (e) { if (window.DEBUG_MODE) console.warn('[init] sidebar restore failed', e); }

    (function _initAccountingCore() {
      try {
        var ACC = window.AccountingCore;
        if (!ACC || !ACC.AccountingState) {
          _bootWarn('AccountingCore', 'AccountingCore not loaded — accounting modules may be unavailable.');
          return;
        }
        if (!ACC.AccountingState.isInitialized()) {
          ACC.AccountingState.initialize();
          if (window.DEBUG_MODE) console.log('[init] AccountingState initialized');
        }
        if (ACC.AccountingStore && ACC.AccountingStore.hydrateAll) {
          ACC.AccountingStore.hydrateAll().then(function (restored) {
            if (!restored) return;
            var hasData = (restored.journals && restored.journals.length > 0)
                       || (restored.bankAccounts && restored.bankAccounts.length > 0);
            if (hasData) {
              try {
                ACC.AccountingState.restoreFromPersistence(restored);
                if (window.DEBUG_MODE) console.log('[init] AccountingState hydrated:', (restored.journals || []).length, 'journals');
                var _allCOA = ACC.AccountingState.getAllCOAAccounts();
                var _restoredIds = Object.keys(restored.coa || {});
                _allCOA.forEach(function (acct) {
                  if (acct.isSystem && _restoredIds.indexOf(acct.id) === -1) {
                    try {
                      var _putResult = ACC.AccountingStore.putOne(ACC.IDB_STORES.COA, acct);
                      if (_putResult && typeof _putResult.catch === 'function') {
                        _putResult.catch(function (e) { if (window.DEBUG_MODE) console.warn('[init] COA IDB write failed:', e); });
                      }
                    } catch (e) { if (window.DEBUG_MODE) console.warn('[init] COA IDB write failed:', e); }
                  }
                });
              } catch (e) { if (window.DEBUG_MODE) console.warn('[init] hydration error:', e); }
            }
          }).catch(function (e) { if (window.DEBUG_MODE) console.warn('[init] IDB hydration failed:', e); });
        }
      } catch (e) { if (window.DEBUG_MODE) console.warn('[init] AccountingState boot error:', e); }
    }());

    if (ERP.auth && ERP.auth.init) ERP.auth.init();

    var _lastActivityTs = 0;
    function _onActivity() {
      var session = _gs().session;
      if (!session || !session.loggedIn) return;
      var now = Date.now();
      if (now - _lastActivityTs < 10000) return;
      _lastActivityTs = now;
      if (ERP._auth_internal && ERP._auth_internal.startTimer) {
        ERP._auth_internal.startTimer();
      } else if (ERP.auth && ERP.auth._startTimer) {
        ERP.auth._startTimer();
      }
    }
    ['mousemove','keydown','touchstart','click'].forEach(function (ev) {
      document.addEventListener(ev, _onActivity, { passive: true });
    });

    (function _hookPrinterTabIntoSettings() {
      var _origSettings = ERP.settings;
      if (_origSettings && _origSettings.render) {
        var _origRender = _origSettings.render.bind(_origSettings);
        _origSettings.render = function () {
          _origRender();
          _injectPrinterTab();
        };
      }
      if (ERP.events && ERP.events.on && ERP.events.NAMES) {
        ERP.events.on(ERP.events.NAMES.PAGE_CHANGED, function (data) {
          if (data && data.page === 'settings') {
            requestAnimationFrame(_injectPrinterTab);
          }
        });
      }
    }());
  });

  (function () {
    if (typeof ERP.registerRenderer !== 'function') return;
    var _stubMsg = {
      sales:            { icon: '🧾', title: 'Sales / Invoices',  msg: 'Sales module loading…' },
      purchase:         { icon: '🚚', title: 'Purchase',           msg: 'Purchase module loading…' },
      settings:         { icon: '⚙️',  title: 'Settings',           msg: 'Settings module loading…' },
      reports:          { icon: '📊', title: 'Reports',            msg: 'Reports module loading…' },
      invoice:          { icon: '🖨️', title: 'Invoice Preview',    msg: '🚧 Coming Soon.' },
      'import-items':   { icon: '📥', title: 'Import Items',       msg: '🚧 Coming Soon — CSV/Excel item import not yet implemented.' },
      'import-parties': { icon: '📥', title: 'Import Parties',     msg: '🚧 Coming Soon — Customer/supplier bulk import not yet implemented.' },
      'export-items':   { icon: '📤', title: 'Export Items',       msg: '🚧 Coming Soon.' }
    };
    Object.keys(_stubMsg).forEach(function (page) {
      var reg = ERP._internal && ERP._internal.getRenderReg && ERP._internal.getRenderReg();
      var existing = reg && reg[page];
      if (typeof existing === 'function') return;
      var cfg = _stubMsg[page];
      ERP.registerRenderer(page, (function (p, c) {
        return function () {
          var pv = document.getElementById('pv-' + p);
          if (!pv || pv.querySelector('.erp-stub')) return;
          pv.innerHTML =
            '<div class="erp-stub" style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:260px;gap:12px;color:var(--muted);text-align:center;padding:32px">'
            + '<div style="font-size:40px">' + c.icon + '</div>'
            + '<div style="font-size:16px;font-weight:700;color:var(--text)">' + c.title + '</div>'
            + '<div style="font-size:13px;max-width:340px">' + c.msg + '</div>'
            + '</div>';
        };
      })(page, cfg));
    });
    ERP.registerRenderer('utilities', function () {
      if (ERP.actions && ERP.actions.utilities) ERP.actions.utilities.render();
    });
  })();

  if (typeof window.openModal !== 'function') {
    window.openModal = function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (el._escHandler) document.removeEventListener('keydown', el._escHandler);
      if (el._bgClickHandler) el.removeEventListener('click', el._bgClickHandler);
      el.style.display = 'flex';
      el.classList.add('open');
      document.body.style.overflow = 'hidden';
      var _escH = function (e) { if (e.key === 'Escape') { window.closeModal(id); document.removeEventListener('keydown', _escH); } };
      document.addEventListener('keydown', _escH);
      el._escHandler = _escH;
      var _bgH = function (e) { if (e.target === el) window.closeModal(id); };
      el.addEventListener('click', _bgH);
      el._bgClickHandler = _bgH;
    };
  }
  if (typeof window.closeModal !== 'function') {
    window.closeModal = function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (el._escHandler) { document.removeEventListener('keydown', el._escHandler); el._escHandler = null; }
      if (el._bgClickHandler) { el.removeEventListener('click', el._bgClickHandler); el._bgClickHandler = null; }
      el.style.display = 'none';
      el.classList.remove('open');
      var anyOpen = document.querySelector('.modal-bg.open, .modal-overlay.open');
      if (!anyOpen) document.body.style.overflow = '';
    };
  }

  if (typeof window.renderPaymentOutPage !== 'function') {
    window.renderPaymentOutPage = function () {
      try {
        var pvp = document.getElementById('pv-payout');
        if (pvp && !pvp.classList.contains('active')) pvp.classList.add('active');
        if (window.ERP && ERP._salesUI && ERP._salesUI.payOut && typeof ERP._salesUI.payOut.render === 'function') { ERP._salesUI.payOut.render(); return; }
        var reg = ERP._internal && ERP._internal.getRenderReg && ERP._internal.getRenderReg();
        if (reg && typeof reg['payout'] === 'function') { reg['payout'](); return; }
      } catch (_) {}
      var pv = document.getElementById('pv-payout');
      if (pv) pv.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:260px;gap:12px;color:var(--muted);text-align:center;padding:32px"><div style="font-size:40px">💸</div><div style="font-size:16px;font-weight:700;color:var(--text)">Payment Out</div><div style="font-size:13px;max-width:340px">Reload karein — module load nahi hua.</div></div>';
    };
  }

  ERP.version = ERP.version || '4.1.0';

  Object.defineProperty(ERP, 'isClickBound', { get: function () { return _clickBound; }, configurable: true });

  ERP.services = _services;

  ERP.actions = {
    inventory:  _invActions,
    sales:      _salesActions,
    purchase:   _purchaseActions,
    repair:     _repairActions,
    jobs: {
      openModal:       function () { if (window.openJobModal)         window.openJobModal();         else if (ERP.repair && ERP.repair.openAdd) ERP.repair.openAdd(); else _toast('Job module loading…', 'info'); },
      addVehicle:      function () { if (window.openVehicleModal)     window.openVehicleModal();     else _toast('Vehicle module loading…', 'info'); },
      bookAppointment: function () { if (window.openAppointmentModal) window.openAppointmentModal(); else _toast('Appointment module loading…', 'info'); }
    },
    parties:    _partiesActions,
    expenses:   _expensesActions,
    bank:       _bankActions,
    dashboard:  _dashActions,
    navigation: _navActions,
    auth:       _authActions,
    search:     _searchActions,
    camera:     { open: function () { if (ERP.camera) ERP.camera.open(); }, close: function () { if (ERP.camera) ERP.camera.close(); }, snap: function () { if (ERP.camera) ERP.camera.snap(); }, switchCam: function () { if (ERP.camera) ERP.camera.switchCam(); } },
    voice:      { toggle: function () { if (ERP.voice) ERP.voice.toggle(); }, start: function () { if (ERP.voice) ERP.voice.start(); }, stop: function () { if (ERP.voice) ERP.voice.stop(); } },
    reports:    _reportsActions,
    settings:   _settingsActions,
    utilities:  _utilitiesActions,
    customers: {
      render:     function ()         { if (ERP.parties && ERP.parties.renderPage) ERP.parties.renderPage('customer'); },
      openAdd:    function ()         { if (ERP.parties && ERP.parties.openAdd)    ERP.parties.openAdd('customer'); },
      openEdit:   function (idx)      { if (ERP.parties && ERP.parties.openEdit)   ERP.parties.openEdit('customer', idx); },
      del:        function (idx, btn) { if (ERP.parties && ERP.parties.del)        ERP.parties.del('customer', idx, btn); },
      search:     function (q)        { if (ERP.parties && ERP.parties.filterList) ERP.parties.filterList(q); },
      viewLedger: function (idx)      { if (ERP.parties && ERP.parties.viewLedger) ERP.parties.viewLedger('customer', idx); }
    },
    suppliers: {
      render:     function ()         { if (ERP.parties && ERP.parties.renderPage) ERP.parties.renderPage('supplier'); },
      openAdd:    function ()         { if (ERP.parties && ERP.parties.openAdd)    ERP.parties.openAdd('supplier'); },
      openEdit:   function (idx)      { if (ERP.parties && ERP.parties.openEdit)   ERP.parties.openEdit('supplier', idx); },
      del:        function (idx, btn) { if (ERP.parties && ERP.parties.del)        ERP.parties.del('supplier', idx, btn); },
      search:     function (q)        { if (ERP.parties && ERP.parties.filterList) ERP.parties.filterList(q); },
      viewLedger: function (idx)      { if (ERP.parties && ERP.parties.viewLedger) ERP.parties.viewLedger('supplier', idx); }
    }
  };

  ERP.nav = {
    go:        function (page, el) { return _navActions.go(page, el); },
    topAction: function ()         { return ERP.topAction ? ERP.topAction() : undefined; }
  };

  ERP.permissions = {
    get roles() { return ERP.RBAC || {}; },
    canPage: function (page) {
      var s = _gs().session;
      if (!s || !s.loggedIn || !s.user) return false;
      var rbac  = ERP.RBAC || {};
      var entry = rbac[s.user.role];
      if (!entry) return false;
      var pages = entry.pages || [];
      return pages[0] === '*' || pages.indexOf(page) !== -1;
    },
    canDo: function (action) {
      var s = _gs().session;
      if (!s || !s.loggedIn || !s.user) return false;
      var role  = s.user.role || 'Viewer';
      if (role === 'Admin') return true;
      var rbac  = ERP.RBAC || {};
      var entry = rbac[role];
      return !!(entry && entry.actions && entry.actions[action]);
    }
  };

  ERP.core = Object.freeze({
    get sidebar() { return ERP.sidebar; },
    get search()  { return ERP.search; },
    get notify()  { return ERP.notify; },
    get dash()    { return ERP.dash; }
  });

  window.MH = ERP;

  window.addEventListener('load', function () {
    ERP.selfTest = function () {
      var pass = 0, fail = 0, results = [];
      function test(name, fn) {
        try { var ok = fn(); if (ok) { pass++; results.push('  ✅ ' + name); } else { fail++; results.push('  ❌ FAIL: ' + name); } }
        catch (e) { fail++; results.push('  ❌ ERROR: ' + name + ' → ' + e.message); }
      }

      test('T1:  sidebar:close on backdrop, no onclick',         function () { var el = document.getElementById('sb-backdrop'); return el && el.getAttribute('data-action') === 'sidebar:close' && !el.hasAttribute('onclick'); });
      test('T2:  shortcuts-btn uses data-action, no onclick',    function () { var el = document.getElementById('shortcuts-btn'); return el && el.getAttribute('data-action') === 'ui:toggleShortcuts' && !el.hasAttribute('onclick'); });
      test('T3:  tn-user uses data-action, no onclick',          function () { var el = document.getElementById('tn-user'); return el && el.getAttribute('data-action') === 'ui:toggleUserMenu' && !el.hasAttribute('onclick'); });
      test('T4:  btn-new-sale is nav:go data-page=sales',        function () { var el = document.getElementById('btn-new-sale'); return el && el.getAttribute('data-action') === 'nav:go' && el.getAttribute('data-page') === 'sales'; });
      test('T5:  btn-new-purchase is nav:go data-page=purchase', function () { var el = document.getElementById('btn-new-purchase'); return el && el.getAttribute('data-action') === 'nav:go' && el.getAttribute('data-page') === 'purchase'; });
      test('T6:  all sidebar nav items use data-action, zero onclick', function () { var items = document.querySelectorAll('.sb-item[id^="nav-"], .sb-ch[id^="nav-"]'); var bad = 0; items.forEach(function (el) { if (el.hasAttribute('onclick')) bad++; if (el.getAttribute('data-action') !== 'nav:go') bad++; }); return bad === 0 && items.length > 0; });
      test('T7:  sidebar group headers use sidebar:grpToggle',   function () { var hdrs = document.querySelectorAll('.sb-grp-hdr[id^="gh-"]'); var bad = 0; hdrs.forEach(function (el) { if (el.hasAttribute('onclick')) bad++; if (el.getAttribute('data-action') !== 'sidebar:grpToggle') bad++; }); return bad === 0 && hdrs.length > 0; });
      test('T8:  12 PIN buttons use auth:pinKey, zero onclick',  function () { var pins = document.querySelectorAll('.pk[data-action="auth:pinKey"]'); var leg = document.querySelectorAll('.pk[onclick]'); return pins.length === 12 && leg.length === 0; });
      test('T9:  PIN setup buttons use auth:pinSetupKey',        function () { var pins = document.querySelectorAll('.ps-pk[data-action="auth:pinSetupKey"]'); var leg = document.querySelectorAll('.ps-pk[onclick]'); return pins.length >= 11 && leg.length === 0; });
      test('T10: ERP.version === "4.1.0"',                       function () { return ERP.version === '4.1.0'; });
      test('T11: single click listener (isClickBound)',          function () { return ERP.isClickBound === true; });
      test('T12: main-head buttons have no onclick',             function () { return document.querySelectorAll('.main-head button[onclick]').length === 0; });
      test('T13: mobile bottom nav items have no onclick',       function () { return document.querySelectorAll('.mbn-item[onclick]').length === 0; });
      test('T14: inventory save action functional',              function () { return typeof ERP.actions.inventory.saveFromForm === 'function'; });
      test('T15: timeout-bar buttons have no onclick',           function () { var bar = document.getElementById('timeout-bar'); if (!bar) return true; return bar.querySelectorAll('[onclick]').length === 0; });
      test('T16: ERP.permissions.canPage exists',                function () { return typeof ERP.permissions === 'object' && typeof ERP.permissions.canPage === 'function'; });
      test('T17: ERP.storage.save is a function',                function () { return typeof ERP.storage === 'object' && typeof ERP.storage.save === 'function'; });
      test('T18: ERP.actions.customers and suppliers registered',function () { return typeof ERP.actions.customers === 'object' && typeof ERP.actions.suppliers === 'object'; });
      test('T19: ERP.actions.customers.render is a function',    function () { return typeof ERP.actions.customers.render === 'function'; });
      test('T20: ERP.permissions.roles has Admin wildcard',      function () { var roles = ERP.permissions && ERP.permissions.roles; return typeof roles === 'object' && Array.isArray(roles.Admin && roles.Admin.pages) && roles.Admin.pages[0] === '*'; });
      test('T21: window.ERP is sole runtime owner',              function () { return typeof window.ERP === 'object' && typeof window.ERP.state === 'object'; });
      test('T22: window.MH is alias of window.ERP',              function () { return window.MH === window.ERP; });
      test('T23: ERP.nav.go is a function',                      function () { return typeof ERP.nav === 'object' && typeof ERP.nav.go === 'function'; });
      test('T24: ERP.core has sidebar and search',               function () { return typeof ERP.core === 'object' && ERP.core.sidebar && ERP.core.search; });
      test('T25: ERP.auth is exposed directly',                  function () { return typeof ERP.auth === 'object' && typeof ERP.auth.login === 'function'; });
      test('T26: ERP.getState() returns live state',             function () { var s = ERP.getState(); return typeof s === 'object' && typeof s.session === 'object'; });
      test('T27: ERP.registerRenderer is a function',            function () { return typeof ERP.registerRenderer === 'function'; });
      test('T28: auth:frgtValidateStrength wired',               function () { return typeof ERP.auth === 'object' && typeof ERP.auth.frgtValidateStrength === 'function'; });
      test('T29: ERP.reports.getSummary returns object',         function () { return typeof ERP.reports === 'object' && typeof ERP.reports.getSummary === 'function'; });
      test('T30: ERP._services.purchase is wired',               function () { return typeof ERP._services === 'object' && typeof ERP._services.purchase === 'object'; });
      test('T31: ERP.DateUtils.today() returns YYYY-MM-DD',      function () { return /^\d{4}-\d{2}-\d{2}$/.test(ERP.DateUtils.today()); });
      test('T32: ERP.DateUtils.now() returns ISO string',        function () { return typeof ERP.DateUtils.now() === 'string' && ERP.DateUtils.now().indexOf('T') > 0; });
      test('T33: ERP.uid() returns unique string',               function () { return typeof ERP.uid() === 'string' && ERP.uid() !== ERP.uid(); });
      test('T34: ERP.CONSTANTS is frozen',                       function () { return ERP.CONSTANTS && Object.isFrozen(ERP.CONSTANTS); });
      test('T35: ERP.CONSTANTS.JOB_STATUS.IN_PROGRESS exists',   function () { return ERP.CONSTANTS && ERP.CONSTANTS.JOB_STATUS && ERP.CONSTANTS.JOB_STATUS.IN_PROGRESS === 'in-progress'; });
      test('T36: ERP.CONSTANTS.INVOICE_STATUS.PAID exists',      function () { return ERP.CONSTANTS && ERP.CONSTANTS.INVOICE_STATUS && ERP.CONSTANTS.INVOICE_STATUS.PAID === 'paid'; });
      test('T37: ERP.errors.ValidationError is a function',      function () { return typeof ERP.errors.ValidationError === 'function'; });
      test('T38: ERP.getState().meta has schemaVersion',         function () { var m = ERP.getState().meta; return m && typeof m.schemaVersion === 'number'; });
      test('T39: window.sales/inventory NOT on window (RULE 6)', function () { return window.sales === undefined && window.inventory === undefined; });
      test('T40: ERP.requireTx throws ValidationError on empty', function () { try { ERP.requireTx(null, 'Test', 'test'); return false; } catch (e) { return e.name === 'ValidationError'; } });

      var total = pass + fail;
      var label = '[ERP Self-Tests] ' + pass + '/' + total + ' passed';
      if (window.DEBUG_MODE) {
        if (typeof console.group === 'function') {
          console.group('%c' + label, fail === 0 ? 'color:#16a34a;font-weight:bold' : 'color:#dc2626;font-weight:bold');
          results.forEach(function (r) { console.log(r); });
          if (fail === 0) console.log('%c✅ All tests passed!', 'color:#16a34a;font-weight:bold');
          else            console.warn('⚠️ ' + fail + ' failure(s) — check above');
          console.groupEnd();
        } else {
          console.log(label);
          results.forEach(function (r) { console.log(r); });
        }
      }
      return { pass: pass, fail: fail, total: total };
    };

    if (window.DEBUG_MODE) {
      var _testDelay = 800;
      var _testTimer = setTimeout(function () {
        if (ERP && ERP.selfTest) {
          var r = ERP.selfTest();
          if (r.fail === 0) console.log('[ERP] ✅ All ' + r.total + ' self-tests passed');
          else              console.warn('[ERP] ⚠️ ' + r.fail + '/' + r.total + ' tests failed');
        }
      }, _testDelay);
      window.addEventListener('beforeunload', function () { clearTimeout(_testTimer); });
    }
  });

})(ERP);

window.ERP = ERP;
