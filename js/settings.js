'use strict';

var ERP = window.ERP || {};

(function (ERP) {

  var getState = function () { return ERP._internal.getState(); };
  var setState  = function (fn, tag) { return ERP._internal.setState(fn, tag); };

  function _esc(v) {
    return String((v === null || v === undefined) ? '' : v)
      .replace(/&/g,'&amp;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;');
  }

  function _escAttr(v) {
    return String((v === null || v === undefined) ? '' : v)
      .replace(/&/g,'&amp;')
      .replace(/"/g,'&quot;');
  }

  var _settingsService = {
    getBiz:    function () { return getState().biz      || {}; },
    getApp:    function () { return getState().settings || {}; },

    saveBiz: function (patch) {
      if (window.ERP && ERP.UserLifecycle && !ERP.UserLifecycle.check('change_settings').allowed) {
        ERP.ui.toast('\u26D4 Only Admin can change business settings.', 'error', 5000);
        return Promise.reject(new Error('PERMISSION_DENIED'));
      }
      setState(function (s) { Object.assign(s.biz, patch); }, 'settings');
      var bizData = getState().biz;
      var records = Object.keys(bizData).map(function(k){ return { key:'biz.'+k, value:bizData[k] }; });
      return Promise.all(records.map(function(r){ return ERP._db.save('settings', r); }))
        .then(function(){ ERP.ui.toast('\u2705 Business info saved!', 'success'); })
        .catch(function (e) { console.warn('[ERP settings:saveBiz]', e); throw e; });
    },

    saveSettings: function (patch) {
      if (window.ERP && ERP.UserLifecycle && !ERP.UserLifecycle.check('change_settings').allowed) {
        ERP.ui.toast('\u26D4 Only Admin can change settings.', 'error', 5000);
        return Promise.reject(new Error('PERMISSION_DENIED'));
      }
      setState(function (s) { Object.assign(s.settings, patch); }, 'settings');
      var records = Object.keys(patch).map(function(k){ return { key:k, value:patch[k] }; });
      return Promise.all(records.map(function(r){ return ERP._db.save('settings', r); }))
        .then(function(){ ERP.ui.toast('\u2705 Settings saved!', 'success'); })
        .catch(function (e) { console.warn('[ERP settings:save]', e); throw e; });
    }
  };

  function _updateHeader(biz) {
    biz = biz || _settingsService.getBiz();
    var tnBiz = document.getElementById('tn-biz');
    if (tnBiz) {
      var bizName = (biz.name || '').trim();
      if (bizName) {
        var parts = bizName.split(' ');
        if (parts.length > 1) {
          var lastWord = parts.pop();
          tnBiz.innerHTML = _esc(parts.join(' ')) + ' <span class="tn-autos">' + _esc(lastWord) + '</span>';
        } else { tnBiz.textContent = bizName; }
      } else { tnBiz.innerHTML = 'MH <span class="tn-autos">Autos</span>'; }
    }
    var tnSub = document.getElementById('tn-sub');
    if (tnSub) {
      tnSub.textContent = biz.address ? (biz.address.split(',')[0] || 'Workshop ERP') : 'Workshop ERP';
    }
    var logoImg = document.getElementById('tn-logo-img');
    var logoSvg = document.getElementById('tn-logo-svg');
    if (logoImg && logoSvg) {
      var src   = (biz.logo || '').trim();
      var valid = /^(https?:\/\/|data:image\/)/i.test(src);
      if (valid) { logoImg.src = src; logoImg.style.display = ''; logoSvg.style.display = 'none'; }
      else        { logoImg.style.display = 'none'; logoSvg.style.display = ''; logoImg.removeAttribute('src'); }
    }
    if (biz.name) document.title = biz.name + ' ERP';
  }

  var _PRESET_COLORS = [
    { name:'Ocean Blue',   hex:'#4338CA' },
    { name:'Forest Green', hex:'#16a34a' },
    { name:'Royal Purple', hex:'#7c3aed' },
    { name:'Sunset Red',   hex:'#dc2626' },
    { name:'Teal',         hex:'#0d9488' },
    { name:'Amber',        hex:'#d97706' },
    { name:'Indigo',       hex:'#4f46e5' },
    { name:'Rose',         hex:'#e11d48' }
  ];

  function _hexToRgb(hex) {
    var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return { r:r, g:g, b:b };
  }
  function _darken(hex, amt) {
    var c = _hexToRgb(hex);
    return '#' + [c.r, c.g, c.b].map(function(v){ return Math.max(0,v-amt).toString(16).padStart(2,'0'); }).join('');
  }
  function _lighten(hex, opacity) {
    var c = _hexToRgb(hex);
    return 'rgba('+c.r+','+c.g+','+c.b+','+opacity+')';
  }

  function _applyTheme(hex) {
    if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return;
    var root = document.documentElement;
    root.style.setProperty('--primary',   hex);
    root.style.setProperty('--primary-d', _darken(hex, 20));
    root.style.setProperty('--primary-l', _lighten(hex, 0.1));
    root.style.setProperty('--sidebar-active-text',   hex);
    root.style.setProperty('--sidebar-active-border', hex);
    try { localStorage.setItem('mh_theme_color', hex); } catch(e){ if(window.console&&console.error) console.error(e); }
  }

  function _loadTheme() {
    try {
      var saved = localStorage.getItem('mh_theme_color');
      if (saved && /^#[0-9A-Fa-f]{6}$/.test(saved)) _applyTheme(saved);
    } catch(e){ if(window.console&&console.error) console.error(e); }
  }
  _loadTheme();

  function _getStorageInfo(cb) {
    var lsBytes = 0, lsKeys = 0;
    try {
      for (var k in localStorage) {
        if (Object.prototype.hasOwnProperty.call(localStorage, k)) {
          lsBytes += (localStorage[k].length + k.length) * 2;
          lsKeys++;
        }
      }
    } catch(e){ if(window.console&&console.error) console.error(e); }
    var result = { ls: lsBytes, keys: lsKeys };
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function(est){
        try {
          result.quota = est;
          var qEl = document.getElementById('sets-storage-quota');
          if (qEl && est) qEl.textContent = _fmtBytes(est.usage||0) + ' / ' + _fmtBytes(est.quota||0);
          if (typeof cb === 'function') cb(result);
        } catch(e){ if (typeof cb === 'function') cb(result); }
      }).catch(function(){ if (typeof cb === 'function') cb(result); });
    } else {
      if (typeof cb === 'function') cb(result);
    }
    return result;
  }

  function _fmtBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
    return (b/1048576).toFixed(2) + ' MB';
  }

  var _activeTab = 'biz';

  function _tab(id, icon, label) {
    return '<button class="sets-tab" data-sets-tab="' + id + '" onclick="ERP.settings._switchTab(\'' + id + '\')">'
      + '<span class="sets-tab-ico">' + icon + '</span>'
      + '<span class="sets-tab-lbl">' + label + '</span>'
      + '</button>';
  }

  function _sectionLabel(txt) {
    return '<div class="sets-sect-lbl">' + txt + '</div>';
  }

  function _field(label, id, val, type) {
    var safeVal = (val === null || val === undefined) ? '' : val;
    var isNum = type === 'number';
    var attrVal = isNum ? String(safeVal) : _escAttr(String(safeVal));
    return '<div><label class="sets-field-lbl" for="' + id + '">' + label + '</label>'
      + '<input class="a-input" id="' + id + '" type="' + (type||'text') + '" value="' + attrVal + '"></div>';
  }

  function _toggleRow(id, val, label, hint) {
    return '<label class="sets-toggle-row">'
      + '<input type="checkbox" id="' + id + '" ' + (val ? 'checked' : '') + ' class="sets-toggle-chk">'
      + '<span><div class="sets-toggle-lbl">' + label + '</div>'
      + '<div class="sets-toggle-hint">' + hint + '</div></span>'
      + '</label>';
  }

  function _modeCard(val, icon, label, sub, active) {
    return '<div class="sets-mode-card' + (active ? ' active' : '') + '" onclick="ERP.settings._setDisplayMode(\'' + val + '\')" data-dm="' + val + '">'
      + '<div class="smc-ico">' + icon + '</div>'
      + '<div class="smc-lbl">' + label + '</div>'
      + '<div class="smc-sub">' + sub + '</div>'
      + (active ? '<div class="smc-badge">ACTIVE</div>' : '')
      + '</div>';
  }

  function _densityBtn(val, label, sub, active) {
    return '<div onclick="ERP.settings._setDensity(\'' + val + '\')" data-density="' + val + '" '
      + 'style="flex:1;padding:10px 8px;border:2px solid ' + (active?'var(--primary)':'#e2e8f0') + ';border-radius:10px;background:' + (active?'rgba(27,79,140,.06)':'#fff') + ';cursor:pointer;text-align:center;transition:all .15s">'
      + '<div style="font-size:13px;font-weight:700;color:' + (active?'var(--primary)':'#0f172a') + '">' + label + '</div>'
      + '<div style="font-size:10px;color:#94a3b8;margin-top:2px">' + sub + '</div>'
      + '</div>';
  }

  function _fontSizeBtn(val, label, active) {
    return '<button onclick="ERP.settings._setFontSize(\'' + val + '\')" data-fsize="' + val + '" '
      + 'style="flex:1;padding:10px;border:2px solid ' + (active?'var(--primary)':'#e2e8f0') + ';border-radius:10px;background:' + (active?'rgba(27,79,140,.06)':'#fff') + ';font-size:12px;font-weight:' + (active?'700':'500') + ';color:' + (active?'var(--primary,#4338CA)':'#475569') + ';cursor:pointer;transition:all .15s">'
      + label + '</button>';
  }

  function _flagRows(flags) {
    var FLAG_LABELS = {
      shadow_sales:          { label:'Sales Module',          hint:'Sales invoice processing engine' },
      shadow_purchase:       { label:'Purchase Module',       hint:'Purchase order processing engine' },
      shadow_inventory:      { label:'Inventory Module',      hint:'Stock tracking & management' },
      shadow_reports:        { label:'Reports Module',        hint:'Analytics & report generation' },
      period_lock:           { label:'Period Lock',           hint:'Prevent edits to closed periods (accounting control)' },
      tax_engine:            { label:'Tax Engine',            hint:'Advanced tax calculation engine' },
      storage_guardian:      { label:'Storage Guardian',      hint:'Data integrity monitoring (recommended ON)' },
      concurrency_guard:     { label:'Concurrency Guard',     hint:'Multi-tab race condition safety (recommended ON)' },
      backup_engine:         { label:'Backup Engine',         hint:'Automatic backup system' },
      audit_archive:         { label:'Audit Archive',         hint:'Extended audit log archiving' },
      gst_engine:            { label:'GST Engine',            hint:'GST/VAT tax filing & reports' },
      user_lifecycle:        { label:'User Lifecycle',        hint:'Advanced user management & RBAC' },
      backup_reminder:       { label:'Backup Reminders',      hint:'Periodic backup reminder alerts' },
      multi_tab_coordinator: { label:'Multi-Tab Coordinator', hint:'Sync data across multiple browser tabs' }
    };
    var FORCED_ON = ['concurrency_guard','storage_guardian','period_lock'];
    var flagKeys = Object.keys(flags || {});
    var rows = flagKeys.map(function(key){
      var info   = FLAG_LABELS[key] || { label:key, hint:'' };
      var isOn   = !!flags[key];
      var forced = FORCED_ON.indexOf(key) >= 0;
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #f1f5f9">'
        + '<div>'
        + '<div style="font-size:13px;font-weight:600;color:var(--text,#0f172a)">' + info.label
        + (forced ? ' <span style="font-size:9px;background:#f0fdf4;color:#166534;border:1px solid #86efac;border-radius:10px;padding:1px 6px;font-weight:700">LOCKED ON</span>' : '')
        + '</div>'
        + '<div style="font-size:11px;color:#94a3b8;margin-top:1px">' + info.hint + '</div>'
        + '</div>'
        + '<label style="position:relative;display:inline-block;width:42px;height:24px;flex-shrink:0" title="' + (forced?'This flag is required and cannot be disabled':'Toggle '+info.label) + '">'
        + '<input type="checkbox" ' + (isOn?'checked':'') + (forced?' disabled':'') + ' onchange="ERP.settings._toggleFlag(\'' + key + '\',this.checked)" style="opacity:0;width:0;height:0">'
        + '<span style="position:absolute;cursor:' + (forced?'not-allowed':'pointer') + ';inset:0;background:' + (isOn?'#16a34a':'#cbd5e1') + ';border-radius:24px;transition:.3s">'
        + '<span style="position:absolute;height:18px;width:18px;left:' + (isOn?'21px':'3px') + ';bottom:3px;background:#fff;border-radius:50%;transition:.3s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></span>'
        + '</span></label>'
        + '</div>';
    }).join('');
    return '<div>' + rows + '</div>';
  }

  function _renderAuditPreview() {
    try {
      var log = [];
      try {
        var raw = localStorage.getItem('mh_audit_log');
        log = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(log)) log = [];
      } catch(e){ log = []; }
      log = log.slice(-20).reverse();
      if (!log.length) return '<p style="font-size:12px;color:#94a3b8;padding:12px 0;text-align:center">No audit records yet</p>';
      return log.map(function(e){
        var ts = e.ts || e.timestamp || e.time;
        var dt = ts ? new Date(ts).toLocaleString('en-PK') : '\u2014';
        var icon = e.event && e.event.indexOf('login')>=0 ? '\u{1F511}' : e.event && e.event.indexOf('logout')>=0 ? '\u{1F6AA}' : '\u{1F4DD}';
        return '<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-bottom:1px solid #f1f5f9">'
          + '<span style="font-size:14px;flex-shrink:0;margin-top:1px">' + icon + '</span>'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-size:12px;font-weight:600;color:var(--text,#0f172a)">' + _esc(String(e.event||e.action||'event')) + ' \u2014 ' + _esc(String(e.username||e.user||'?')) + '</div>'
          + '<div style="font-size:11px;color:#94a3b8">' + dt + '</div>'
          + '</div></div>';
      }).join('');
    } catch(e){ return '<p style="font-size:12px;color:#dc2626">Could not load audit log</p>'; }
  }

  function _switchTab(id) {
    _activeTab = id;
    document.querySelectorAll('.sets-panel').forEach(function(p){ p.style.display = 'none'; });
    document.querySelectorAll('[data-sets-tab]').forEach(function(t){
      var isActive = t.getAttribute('data-sets-tab') === id;
      t.classList.toggle('active', isActive);
    });
    var pnl = document.getElementById('sets-pnl-' + id);
    if (pnl) pnl.style.display = '';
    if (id === 'security' || id === 'users') {
      setTimeout(function () {
        try {
          if (ERP.biometric && typeof ERP.biometric._updateSettingsPanel === 'function') {
            ERP.biometric._updateSettingsPanel();
          }
        } catch (e) { if(window.console&&console.error) console.error(e); }
      }, 80);
    }
  }

  function _bindTabs() { _switchTab(_activeTab); }

  function _getSavedDensity() {
    try { return localStorage.getItem('mh_density') || 'normal'; } catch(e){ return 'normal'; }
  }
  function _getSavedFontSize() {
    try { return localStorage.getItem('mh_fontsize') || 'md'; } catch(e){ return 'md'; }
  }

  function render() {
    var pv = document.getElementById('pv-settings');
    if (!pv) return;

    var biz  = _settingsService.getBiz();
    var sets = _settingsService.getApp();
    var authLoaded = !!(ERP.auth && ERP.auth.getUsers);
    var currentSessionUser = getState().session && getState().session.user;
    var isAdmin = authLoaded && !!(currentSessionUser && currentSessionUser.role === 'Admin');
    var currentColor = '';
    try { currentColor = localStorage.getItem('mh_theme_color') || '#4338CA'; } catch(e){ currentColor = '#4338CA'; }
    var isDark = document.body.classList.contains('dark');
    var storage = _getStorageInfo();
    var users = isAdmin ? (ERP.auth.getUsers() || []) : [];
    var flags = (ERP.FeatureFlags && ERP.FeatureFlags.getAll) ? ERP.FeatureFlags.getAll() : {};
    var appVersion = (window.ERP && ERP.VERSION) ? ERP.VERSION : '8.0';
    var savedDensity = _getSavedDensity();
    var savedFontSize = _getSavedFontSize();

    pv.innerHTML =
      '<div class="sets-hero">'
      + '<div class="sets-hero-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:22px;height:22px"><use href="#ic-cog"/></svg></div>'
      + '<div class="sets-hero-text"><h1>Settings</h1><p>Manage your business profile, app preferences and system configuration</p></div>'
      + '<span class="sets-ver-badge">v2.1 PRO</span>'
      + '</div>'

      + '<div class="sets-shell">'

      + '<div id="sets-tabs" class="sets-tabs">'
      + _tab('biz',      '\u{1F3E2}', 'Business')
      + _tab('app',      '\u2699\uFE0F', 'App')
      + _tab('appear',   '\u{1F3A8}', 'Appearance')
      + _tab('users',    '\u{1F465}', 'Users')
      + _tab('flags',    '\u{1F6A9}', 'Features')
      + _tab('data',     '\u{1F4BE}', 'Data')
      + _tab('security', '\u{1F510}', 'Security')
      + _tab('system',   '\u2139\uFE0F', 'System')
      + '</div>'

      + '<div class="sets-content">'

      + '<div id="sets-pnl-biz" class="sets-panel">'

      + _sectionLabel('\u{1F3E2} Business Information')
      + '<div class="panel" style="margin-bottom:14px"><div class="modal-body" style="display:grid;gap:14px">'
      + _field('Business Name',   'sets-biz-name',    biz.name    || '')
      + _field('Phone Number',    'sets-biz-phone',   biz.phone   || '')
      + _field('Address',         'sets-biz-address', biz.address || '')
      + _field('Email',           'sets-biz-email',   biz.email   || '', 'email')
      + _field('Website',         'sets-biz-website', biz.website || '', 'url')
      + _field('GST / Tax No.',   'sets-biz-gst',     biz.gst     || '')
      + _field('NTN / Reg. No.',  'sets-biz-ntn',     biz.ntn     || '')
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
      + _field('Currency Symbol', 'sets-biz-currency', biz.currency || 'Rs.')
      + _field('City / Region',   'sets-biz-city',     biz.city    || '')
      + '</div>'
      + '</div></div>'

      + _sectionLabel('\u{1F5BC}\uFE0F Business Logo')
      + '<div class="panel" style="margin-bottom:14px"><div class="modal-body">'
      + '<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">'
      + '<div id="sets-logo-preview-wrap" style="width:88px;height:88px;border:2px dashed #e2e8f0;border-radius:12px;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:var(--bg,#f8fafc)">'
      + (biz.logo && /^(https?:\/\/|data:image\/)/i.test(biz.logo)
          ? '<img id="sets-logo-preview-img" src="' + _escAttr(biz.logo) + '" style="width:100%;height:100%;object-fit:contain">'
          : '<span id="sets-logo-preview-fallback" style="font-size:28px;color:#cbd5e1">\u{1F4F7}</span>')
      + '</div>'
      + '<div style="flex:1;min-width:200px;display:grid;gap:8px">'
      + '<label style="font-size:12px;font-weight:600;color:var(--muted)">Logo URL atau Upload Image</label>'
      + '<input class="a-input" id="sets-logo-url" type="text" placeholder="https://... or data:image/..." value="' + _escAttr(biz.logo||'') + '">'
      + '<div style="display:flex;gap:8px">'
      + '<label class="btn btn-ghost" style="cursor:pointer;font-size:12px;padding:6px 12px">\u{1F4C1} Upload File'
      + '<input type="file" id="sets-logo-upload" accept="image/*" style="display:none" onchange="ERP.settings._handleLogoUpload(event)"></label>'
      + '<button class="btn btn-ghost" style="font-size:12px" onclick="ERP.settings._clearLogo()">\u{1F5D1}\uFE0F Clear</button>'
      + '</div>'
      + '<p style="font-size:11px;color:#94a3b8;margin:0">Supports: JPG, PNG, SVG, WebP \u2014 max 2MB recommended</p>'
      + '</div></div>'
      + '</div></div>'

      + _sectionLabel('\u{1F4B3} Payment & QR Details')
      + '<div class="panel" style="margin-bottom:14px"><div class="modal-body" style="display:grid;gap:14px">'
      + '<p style="font-size:12px;color:var(--muted,#64748b);margin:0">Yeh details invoices par print hongi taake customer payment kar sake.</p>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
      + _field('Bank Name',        'sets-bank-name',   biz.bankName  || '')
      + _field('Account Title',    'sets-bank-title',  biz.bankTitle || '')
      + _field('Account Number',   'sets-bank-acc',    biz.bankAcc   || '')
      + _field('IBAN',             'sets-bank-iban',   biz.bankIban  || '')
      + '</div>'
      + _field('EasyPaisa / JazzCash / UPI ID', 'sets-bank-upi', biz.bankUpi || '')
      + '<div>'
      + '<label style="font-size:12px;font-weight:600;color:var(--muted);display:block;margin-bottom:5px">QR Code Image</label>'
      + '<input class="a-input" id="sets-qr-url" type="text" placeholder="https://... QR code image URL" value="' + _escAttr(biz.qrCode||'') + '">'
      + (biz.qrCode ? '<img src="'+_escAttr(biz.qrCode)+'" style="width:70px;height:70px;margin-top:8px;border:1px solid #e2e8f0;border-radius:8px;object-fit:contain" id="sets-qr-preview">' : '')
      + '</div>'
      + '<button class="btn btn-primary" onclick="ERP.settings._savePayment()">\u{1F4BE} Save Payment Details</button>'
      + '</div></div>'

      + '<div style="display:flex;gap:10px;margin-top:4px">'
      + '<button class="btn btn-primary" onclick="ERP.settings._saveBiz()" style="padding:10px 24px;font-size:14px">\u{1F4BE} Save Business Info</button>'
      + '</div>'

      + '</div>'
      + '<div id="sets-pnl-app" class="sets-panel" style="display:none">'

      + _sectionLabel('\u{1F4E6} Inventory Settings')
      + '<div class="panel" style="margin-bottom:14px"><div class="modal-body" style="display:grid;gap:14px">'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
      + _field('Low Stock Alert (qty)', 'sets-low-stock',  sets.lowStockAlert !== undefined ? sets.lowStockAlert : 5,   'number')
      + _field('Tax Rate (%)',           'sets-tax-rate',   sets.taxRate !== undefined ? sets.taxRate : 17, 'number')
      + '</div>'
      + _toggleRow('sets-neg-stock',   sets.allowNegativeStock, 'Allow Negative Stock',       'Stock zero se neeche ja sake')
      + '</div></div>'

      + _sectionLabel('\u{1F4C5} Financial Year')
      + '<div class="panel" style="margin-bottom:14px"><div class="modal-body" style="display:grid;gap:14px">'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
      + _field('Year-End Month (1-12)', 'sets-ye-month', sets.yearEndMonth !== undefined ? sets.yearEndMonth : 6,  'number')
      + _field('Year-End Day (1-31)',   'sets-ye-day',   sets.yearEndDay   !== undefined ? sets.yearEndDay   : 30, 'number')
      + '</div>'
      + '<div style="font-size:11px;color:#94a3b8">Default 30 June. Update this if your business financial year ends on a different date.</div>'
      + '</div></div>'

      + _sectionLabel('\u{1F9FE} Invoice & Job Settings')
      + '<div class="panel" style="margin-bottom:14px"><div class="modal-body" style="display:grid;gap:14px">'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
      + _field('Invoice Prefix', 'sets-inv-pfx',   sets.invoicePrefix || 'INV')
      + _field('Job Card Prefix','sets-job-pfx',   sets.jobPrefix     || 'JOB')
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
      + _field('Payment Terms (days)', 'sets-pay-terms', sets.paymentTerms !== undefined ? sets.paymentTerms : 30, 'number')
      + _field('Default Discount (%)', 'sets-def-disc',  sets.defaultDiscount !== undefined ? sets.defaultDiscount : 0,  'number')
      + '</div>'
      + _toggleRow('sets-show-tax-invoice', sets.showTaxOnInvoice !== false, 'Show Tax Breakdown on Invoice', 'Invoice mein tax ki alag line dikhao')
      + _toggleRow('sets-req-cust-invoice',  sets.requireCustomer, 'Require Customer on Invoice', 'Sale mein customer select karna zaruri ho')
      + '</div></div>'

      + _sectionLabel('\u{1F504} Automation')
      + '<div class="panel" style="margin-bottom:14px"><div class="modal-body" style="display:grid;gap:14px">'
      + _toggleRow('sets-auto-backup',   sets.autoBackup !== false, 'Auto Backup',             'Roz automatically backup banao')
      + _toggleRow('sets-auto-print',    sets.autoPrintOnSave,      'Auto-Print on Invoice Save','Save karte hi print dialog khule')
      + _toggleRow('sets-low-stock-notif', sets.lowStockNotif !== false, 'Low Stock Notifications', 'Stock kam hone par alert aaye')
      + _toggleRow('sets-job-reminder',  sets.jobReminders !== false, 'Pending Job Reminders',  'Incomplete jobs ki reminder')
      + '</div></div>'

      + '<button class="btn btn-primary" onclick="ERP.settings._saveAppSettings()" style="padding:10px 24px;font-size:14px">\u{1F4BE} Save App Settings</button>'
      + '</div>'

      + '<div id="sets-pnl-appear" class="sets-panel" style="display:none">'

      + _sectionLabel('\u{1F319} Display Mode')
      + '<div class="panel" style="margin-bottom:14px"><div class="modal-body">'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
      + _modeCard('light', '\u2600\uFE0F', 'Light Mode', 'Default bright UI', !isDark)
      + _modeCard('dark',  '\u{1F319}', 'Dark Mode',  'Easy on the eyes',   isDark)
      + '</div>'
      + '</div></div>'

      + _sectionLabel('\u{1F3A8} Brand / Primary Color')
      + '<div class="panel" style="margin-bottom:14px"><div class="modal-body">'
      + '<p style="font-size:12px;color:var(--muted,#64748b);margin:0 0 12px">Apni brand color choose karein \u2014 sirf topnav, buttons, aur active states mein lagegi.</p>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">'
      + _PRESET_COLORS.map(function(c){
          var isActive = (c.hex.toLowerCase() === currentColor.toLowerCase());
          return '<button onclick="ERP.settings._setColor(\'' + c.hex + '\')" title="' + _escAttr(c.name) + '" '
            + 'style="width:34px;height:34px;border-radius:50%;background:' + c.hex + ';border:' + (isActive ? '3px solid #0f172a' : '2px solid #e2e8f0') + ';cursor:pointer;box-shadow:' + (isActive ? '0 0 0 2px '+c.hex+',0 0 0 4px #fff' : 'none') + ';transition:all .15s"></button>';
        }).join('')
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:10px">'
      + '<label style="font-size:12px;font-weight:600;color:var(--muted)">Custom Color:</label>'
      + '<input type="color" id="sets-custom-color" value="' + currentColor + '" style="width:44px;height:36px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;padding:2px" oninput="ERP.settings._setColor(this.value)">'
      + '<span id="sets-color-hex" style="font-size:12px;font-family:monospace;color:var(--muted,#64748b)">' + currentColor + '</span>'
      + '<button class="btn btn-ghost" style="font-size:12px" onclick="ERP.settings._resetColor()">\u21A9\uFE0F Reset Default</button>'
      + '</div>'
      + '</div></div>'

      + _sectionLabel('\u{1F524} Font & Density')
      + '<div class="panel" style="margin-bottom:14px"><div class="modal-body" style="display:grid;gap:14px">'
      + '<div>'
      + '<label style="font-size:12px;font-weight:600;color:var(--muted);display:block;margin-bottom:8px">UI Density</label>'
      + '<div style="display:flex;gap:10px">'
      + _densityBtn('compact',  '\u2B1B Compact',  'Zyada rows ek screen mein', savedDensity === 'compact')
      + _densityBtn('normal',   '\u25A3 Normal',   'Default spacing', savedDensity === 'normal')
      + _densityBtn('spacious', '\u25A1 Spacious', 'Airy, easy to read', savedDensity === 'spacious')
      + '</div>'
      + '</div>'
      + '<div>'
      + '<label style="font-size:12px;font-weight:600;color:var(--muted);display:block;margin-bottom:8px">Font Size</label>'
      + '<div style="display:flex;gap:10px">'
      + _fontSizeBtn('sm', 'Small (13px)', savedFontSize === 'sm')
      + _fontSizeBtn('md', 'Medium (14px)', savedFontSize === 'md')
      + _fontSizeBtn('lg', 'Large (15px)', savedFontSize === 'lg')
      + '</div>'
      + '</div>'
      + '</div></div>'

      + '</div>'

      + '<div id="sets-pnl-users" class="sets-panel" style="display:none">'

      + (!isAdmin
        ? _sectionLabel('\u{1F465} User Management')
          + '<div class="panel"><div class="modal-body" style="text-align:center;padding:32px;color:var(--muted,#64748b)">\u26D4 Sirf Admin user management dekh sakta hai.</div></div>'
        :

      _sectionLabel('\u{1F465} User Management')
      + '<div class="panel" style="margin-bottom:14px">'
      + '<div class="panel-head" style="display:flex;justify-content:space-between;align-items:center">'
      + '<span class="panel-title">Staff Accounts (' + users.length + ')</span>'
      + '<button class="btn btn-primary" onclick="ERP.settings._showAddUser()" style="font-size:12px;padding:6px 14px">\u2795 Add User</button>'
      + '</div>'
      + '<div class="modal-body" style="padding:0">'
      + '<table style="width:100%;border-collapse:collapse">'
      + '<thead><tr style="background:var(--bg,#f8fafc);border-bottom:2px solid #e2e8f0">'
      + '<th style="padding:10px 12px;font-size:11px;font-weight:700;color:var(--muted,#64748b);text-align:left">NAME</th>'
      + '<th style="padding:10px 12px;font-size:11px;font-weight:700;color:var(--muted,#64748b);text-align:left">USERNAME</th>'
      + '<th style="padding:10px 12px;font-size:11px;font-weight:700;color:var(--muted,#64748b);text-align:left">ROLE</th>'
      + '<th style="padding:10px 12px;font-size:11px;font-weight:700;color:var(--muted,#64748b);text-align:center">ACTIONS</th>'
      + '</tr></thead>'
      + '<tbody>'
      + (users.length ? users.map(function(u, i){
          var roleBadge = u.role === 'Admin'
            ? '<span style="background:#fef3c7;color:#92400e;border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700">Admin</span>'
            : '<span style="background:#f0f9ff;color:#0369a1;border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700">'+_esc(u.role||'Staff')+'</span>';
          var currentUser = getState().session && getState().session.user;
          var isSelf = currentUser && currentUser.username === u.username;
          var rolesArr = ['Staff','Manager','Admin'];
          var nextRole = rolesArr[(rolesArr.indexOf(u.role || 'Staff') + 1) % rolesArr.length];
          return '<tr style="border-bottom:1px solid #f1f5f9;' + (i%2===0?'':'background:#fafbfc') + '">'
            + '<td style="padding:10px 12px;font-size:13px;font-weight:600">' + _esc(u.name || u.username) + (isSelf ? ' <span style="font-size:9px;color:#4338CA">(you)</span>' : '') + '</td>'
            + '<td style="padding:10px 12px;font-size:12px;font-family:monospace;color:var(--muted,#64748b)">@' + _esc(u.username) + '</td>'
            + '<td style="padding:10px 12px">' + roleBadge + '</td>'
            + '<td style="padding:10px 12px;text-align:center">'
            + '<div style="display:flex;gap:6px;justify-content:center">'
            + '<button class="btn btn-ghost" style="font-size:11px;padding:4px 10px" onclick="ERP.settings._showChangePass(\'' + _escAttr(u.username) + '\')">\u{1F511} Password</button>'
            + (!isSelf ? '<button class="btn btn-ghost" style="font-size:11px;padding:4px 10px;color:#4338CA" onclick="ERP.settings._toggleRole(\'' + _escAttr(u.username) + '\',\'' + _escAttr(u.role || 'Staff') + '\')" title="Change to ' + _escAttr(nextRole) + '">\u{1F504} \u2192' + _esc(nextRole) + '</button>' : '')
            + (!isSelf ? '<button class="btn btn-ghost" style="font-size:11px;padding:4px 10px;color:#dc2626" onclick="ERP.settings._deleteUser(\'' + _escAttr(u.username) + '\')">\u{1F5D1}\uFE0F</button>' : '')
            + '</div>'
            + '</td>'
            + '</tr>';
        }).join('') : '<tr><td colspan="4" style="padding:20px;text-align:center;color:#94a3b8;font-size:13px">No users found</td></tr>')
      + '</tbody></table>'
      + '</div></div>'

      + '<div id="sets-add-user-form" class="panel" style="display:none;margin-bottom:14px;border:2px solid var(--primary)">'
      + '<div class="panel-head"><span class="panel-title">\u2795 New User Account</span></div>'
      + '<div class="modal-body" style="display:grid;gap:12px">'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
      + _field('Full Name',  'new-user-name',  '')
      + _field('Username',   'new-user-uname', '')
      + '</div>'
      + _field('Password', 'new-user-pwd', '', 'password')
      + '<div>'
      + '<label style="font-size:12px;font-weight:600;color:var(--muted);display:block;margin-bottom:5px">Role</label>'
      + '<select class="a-input" id="new-user-role">'
      + '<option value="Staff">Staff</option>'
      + '<option value="Manager">Manager</option>'
      + '<option value="Admin">Admin</option>'
      + '</select></div>'
      + '<div>'
      + '<label style="font-size:12px;font-weight:600;color:var(--muted);display:block;margin-bottom:5px">\u{1F510} Security Question</label>'
      + '<select class="a-input" id="new-user-secq" style="margin-bottom:8px">'
      + '<option value="">-- Select a question --</option>'
      + '<option value="q1">Aapki Ammi ka naam kya hai?</option>'
      + '<option value="q2">Aap ki pehli school ka naam?</option>'
      + '<option value="q3">Aapka favourite colour kya hai?</option>'
      + '<option value="q4">Aapki pehli car ka model?</option>'
      + '<option value="q5">Aapke gaon / shehar ka naam?</option>'
      + '</select>'
      + '<input class="a-input" id="new-user-seca" type="text" placeholder="Security answer" autocomplete="off" spellcheck="false">'
      + '</div>'
      + '<div style="display:flex;gap:8px">'
      + '<button class="btn btn-primary" onclick="ERP.settings._addUser()">\u2705 Create User</button>'
      + '<button class="btn btn-ghost" onclick="ERP.settings._hideAddUser()">Cancel</button>'
      + '</div>'
      + '</div></div>'
      )

      + '<div id="sets-change-pass-form" class="panel" style="display:none;margin-bottom:14px;border:2px solid #f59e0b">'
      + '<div class="panel-head"><span class="panel-title" id="sets-chpass-title">\u{1F511} Change Password</span></div>'
      + '<div class="modal-body" style="display:grid;gap:12px">'
      + _field('New Password',     'chpass-new', '',  'password')
      + _field('Confirm Password', 'chpass-cfm', '',  'password')
      + '<input type="hidden" id="chpass-username">'
      + '<div style="display:flex;gap:8px">'
      + '<button class="btn btn-primary" onclick="ERP.settings._doChangePass()">\u2705 Change Password</button>'
      + '<button class="btn btn-ghost" onclick="document.getElementById(\'sets-change-pass-form\').style.display=\'none\'">Cancel</button>'
      + '</div>'
      + '</div></div>'

      + _sectionLabel('\u{1F512} My Security (Current User)')
      + '<div class="panel" style="margin-bottom:14px"><div class="modal-body" style="display:grid;gap:10px">'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap">'
      + '<button class="btn btn-ghost" onclick="ERP.settings._showMyPassword()">\u{1F511} Change My Password</button>'
      + '<button class="btn btn-ghost" onclick="if(ERP.auth&&ERP.auth.showPinSetup)ERP.auth.showPinSetup()">\u{1F4F1} Set Screen Lock PIN</button>'
      + '</div>'
      + '</div></div>'

      + _sectionLabel('\u{1F4BB} Biometric Login (Fingerprint \u00B7 Face ID \u00B7 Windows Hello)')
      + '<div id="bio-settings-panel" class="panel" style="margin-bottom:14px">'
      + '<div class="modal-body" style="display:grid;gap:12px">'
      + '<div style="font-size:12px;color:var(--muted,#64748b);line-height:1.6">'
      + 'Biometric login se aap bina password ke fingerprint ya face se ERP mein login kar sakte hain. '
      + 'Aapka biometric data kabhi store nahi hota &mdash; sirf device ka cryptographic token save hota hai.'
      + '</div>'
      + '<div id="bio-creds-list" style="min-height:40px"><div style="color:#94a3b8;font-size:12px;text-align:center;padding:10px">Loading...</div></div>'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap">'
      + '<button class="btn btn-primary" onclick="ERP.biometric && ERP.biometric.registerFromSettings && ERP.biometric.registerFromSettings()">'
      + '\u{1F4BB} Register Biometric</button>'
      + '<button class="btn btn-ghost" style="color:#dc2626;border-color:#fecaca" '
      + 'onclick="var u=ERP._internal&&ERP._internal.getState&&ERP._internal.getState().session&&ERP._internal.getState().session.user&&ERP._internal.getState().session.user.username;if(u&&confirm(\'Sab biometric credentials remove hon ge?\')&&ERP.biometric&&ERP.biometric.removeCreds)ERP.biometric.removeCreds(u)">'
      + '\u{1F5D1}\uFE0F Remove All</button>'
      + '</div>'
      + '</div></div>'

      + '</div>'
      + '<div id="sets-pnl-flags" class="sets-panel" style="display:none">'
      + _sectionLabel('\u{1F6A9} Module Feature Flags')
      + '<div class="panel" style="margin-bottom:14px">'
      + '<div class="panel-head" style="display:flex;justify-content:space-between;align-items:center">'
      + '<span class="panel-title">Runtime Feature Toggles</span>'
      + '<button class="btn btn-ghost" style="font-size:12px" onclick="ERP.settings._resetFlags()">\u21A9\uFE0F Reset All</button>'
      + '</div>'
      + '<div class="modal-body" style="padding:0">'
      + '<div style="background:#fef3c7;border-left:3px solid #f59e0b;padding:10px 14px;margin-bottom:0;font-size:12px;color:#92400e">'
      + '\u26A0\uFE0F <b>Admin Only:</b> Yeh flags sirf advanced users ke liye hain. Galat toggle karne se modules band ho sakte hain. Page refresh zaruri ho sakta hai.'
      + '</div>'
      + _flagRows(flags)
      + '</div></div>'
      + '</div>'

      + '<div id="sets-pnl-data" class="sets-panel" style="display:none">'

      + _sectionLabel('\u{1F4E4} Import / Export')
      + '<div class="panel" style="margin-bottom:14px"><div class="modal-body" style="display:grid;gap:18px">'

      + '<div>'
      + '<div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">\u{1F4E6} Inventory Items</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
      + '<button class="btn btn-primary" data-action="inv:importCSV">\u{1F4E4} Import Items</button>'
      + '<button class="btn btn-ghost"   data-action="inv:exportItemsCSV">\u{1F4E5} Export Items</button>'
      + '<button class="btn btn-ghost"   data-action="inv:downloadTemplate">\u{1F4CB} Template</button>'
      + '</div>'
      + '<div style="font-size:11px;color:var(--muted);margin-top:8px">Columns: Name*, Barcode, SKU, Category, SalePrice*, PurchasePrice, Stock, MinStock, Unit, Tax%</div>'
      + '</div>'

      + '<div style="border-top:1px solid var(--border-l)"></div>'

      + '<div>'
      + '<div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">\u{1F465} Customers & Suppliers</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
      + '<button class="btn btn-primary" data-action="party:importCSV">\u{1F4E4} Import Parties</button>'
      + '<button class="btn btn-ghost"   data-action="party:exportCSV">\u{1F4E5} Export Parties</button>'
      + '<button class="btn btn-ghost"   data-action="party:downloadTemplate">\u{1F4CB} Template</button>'
      + '</div>'
      + '<div style="font-size:11px;color:var(--muted);margin-top:8px">Columns: Name*, Phone, Type* (customer|supplier), Address, Email, Vehicle, OpeningBalance</div>'
      + '</div>'

      + '<div style="border-top:1px solid var(--border-l)"></div>'

      + '<div>'
      + '<div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">\u{1F9FE} Expense Categories</div>'
      + '<button class="btn btn-primary" onclick="if(ERP.expenses&&ERP.go){ERP.go(\'expenses\');setTimeout(function(){var btn=document.getElementById(\'exp-cat-btn\');if(btn)btn.click();},500);}">\u2699\uFE0F Manage Expense Categories</button>'
      + '</div>'

      + '</div></div>'

      + _sectionLabel('\u{1F4BE} Backup & Restore')
      + '<div class="panel" style="margin-bottom:14px"><div class="modal-body">'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">'
      + '<button class="btn btn-primary" data-action="db:backup" style="display:flex;align-items:center;gap:6px">\u2B07\uFE0F Download Backup (JSON)</button>'
      + '<button class="btn btn-ghost"   data-action="db:import"  style="display:flex;align-items:center;gap:6px">\u2B06\uFE0F Restore from Backup</button>'
      + '</div>'
      + '<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:10px 12px;font-size:12px;color:#166534">'
      + '\u2705 <b>Last auto-backup:</b> ' + (sets.lastBackup ? new Date(sets.lastBackup).toLocaleString('en-PK') : 'Never') + ' &nbsp;\u00B7&nbsp; Auto-backup: ' + (sets.autoBackup !== false ? '<b>ON</b>' : 'OFF')
      + '</div>'
      + '</div></div>'

      + _sectionLabel('\u{1F5D1}\uFE0F Danger Zone')
      + '<div class="panel" style="margin-bottom:14px;border:1px solid #fecaca"><div class="modal-body">'
      + '<p style="font-size:12px;color:var(--muted,#64748b);margin:0 0 12px">Yeh actions reversible nahi hain. Pehle backup zaroor lein!</p>'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap">'
      + '<button class="btn btn-danger" onclick="if(ERP&&ERP.settings&&ERP.settings.clearTransactions)ERP.settings.clearTransactions()" style="background:#b45309;border-color:#b45309">\u{1F9F9} Clear Transactions Only</button>'
      + '<button class="btn btn-danger" onclick="if(ERP&&ERP.settings&&ERP.settings.clearAll)ERP.settings.clearAll()">\u{1F5D1}\uFE0F Clear ALL Data</button>'
      + '</div>'
      + '</div></div>'

      + '</div>'

      + '<div id="sets-pnl-security" class="sets-panel" style="display:none">'

      + _sectionLabel('\u23F1\uFE0F Session & Timeout')
      + '<div class="panel" style="margin-bottom:14px"><div class="modal-body" style="display:grid;gap:14px">'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
      + _field('Session Timeout (minutes)', 'sets-session-timeout', sets.sessionTimeout !== undefined ? sets.sessionTimeout : 30, 'number')
      + _field('PIN Lock After (minutes)',  'sets-pin-timeout',     sets.pinTimeout !== undefined ? sets.pinTimeout : 5,  'number')
      + '</div>'
      + _toggleRow('sets-pin-on-startup', sets.pinOnStartup, 'Require PIN on Startup', 'Login ke baad bhi PIN maango')
      + '<button class="btn btn-primary" onclick="ERP.settings._saveSecuritySettings()">\u{1F4BE} Save Security Settings</button>'
      + '</div></div>'

      + _sectionLabel('\u{1F4CB} Audit Log')
      + '<div class="panel" style="margin-bottom:14px">'
      + '<div class="panel-head" style="display:flex;justify-content:space-between;align-items:center">'
      + '<span class="panel-title">Recent Activity Log</span>'
      + '<div style="display:flex;gap:6px">'
      + '<button class="btn btn-ghost" style="font-size:12px" onclick="if(ERP.auth&&ERP.auth.exportAudit)ERP.auth.exportAudit()">\u2B07\uFE0F Export</button>'
      + '<button class="btn btn-ghost" style="font-size:12px;color:#dc2626" onclick="if(ERP.auth&&ERP.auth.clearAudit)ERP.auth.clearAudit()">\u{1F5D1} Clear</button>'
      + '</div>'
      + '</div>'
      + '<div id="sets-audit-log" style="max-height:280px;overflow-y:auto;padding:0 12px 12px">'
      + _renderAuditPreview()
      + '</div>'
      + '</div>'

      + _sectionLabel('\u{1F510} Login Security')
      + '<div class="panel" style="margin-bottom:14px"><div class="modal-body" style="display:grid;gap:10px">'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap">'
      + '<button class="btn btn-ghost" onclick="if(ERP.auth&&ERP.auth.showAudit)ERP.auth.showAudit()">\u{1F4CB} Full Login Audit Trail</button>'
      + '<button class="btn btn-ghost" onclick="if(ERP.auth&&ERP.auth.showPinSetup)ERP.auth.showPinSetup()">\u{1F4F1} Manage Screen Lock PIN</button>'
      + '</div>'
      + '</div></div>'

      + '</div>'

      + '<div id="sets-pnl-system" class="sets-panel" style="display:none">'

      + _sectionLabel('\u2139\uFE0F System Information')
      + '<div class="panel" style="margin-bottom:14px"><div class="modal-body" style="padding:0">'
      + '<table style="width:100%;border-collapse:collapse">'
      + [
          ['ERP Version',       'v' + appVersion],
          ['Browser',           navigator.userAgent.split(' ').slice(-2).join(' ')],
          ['Platform',          navigator.platform || 'Unknown'],
          ['Screen',            window.screen.width + '\u00D7' + window.screen.height],
          ['Storage (LS)',      _fmtBytes(storage.ls) + ' (' + (storage.keys||0) + ' keys)'],
          ['Storage (Quota)',   '<span id="sets-storage-quota">Calculating...</span>'],
          ['IndexedDB',         window.indexedDB ? '\u2705 Available' : '\u274C Not Available'],
          ['Online Status',     navigator.onLine ? '\u{1F7E2} Online' : '\u{1F534} Offline'],
          ['Language',          navigator.language || 'en'],
          ['Storage Type',      typeof localStorage !== 'undefined' ? '\u2705 localStorage' : '\u274C Unavailable']
        ].map(function(row, i){
          return '<tr style="border-bottom:1px solid #f1f5f9;' + (i%2===0?'':'background:#fafbfc') + '">'
            + '<td style="padding:9px 14px;font-size:12px;font-weight:600;color:var(--muted,#64748b);width:50%">' + row[0] + '</td>'
            + '<td style="padding:9px 14px;font-size:13px;font-weight:600;color:var(--text,#0f172a)">' + _esc(String(row[1])) + '</td>'
            + '</tr>';
        }).join('')
      + '</table>'
      + '</div></div>'

      + _sectionLabel('\u2328\uFE0F Keyboard Shortcuts')
      + '<div class="panel" style="margin-bottom:14px"><div class="modal-body" style="padding:0">'
      + '<table style="width:100%;border-collapse:collapse">'
      + [
          ['Alt + D', 'Dashboard'],
          ['Alt + S', 'Sales / Invoices'],
          ['Alt + P', 'Purchase'],
          ['Alt + I', 'Inventory'],
          ['Alt + R', 'Parties (Customers)'],
          ['Alt + E', 'Expenses'],
          ['Alt + T', 'Reports'],
          ['Alt + N', 'New Sale'],
          ['Alt + C', 'Add Customer'],
          ['Alt + M', 'Add Inventory Item'],
          ['Alt + B', 'Backup Data'],
          ['Alt + Backslash', 'Toggle Sidebar'],
          ['Ctrl + K', 'Focus Search'],
          ['Escape',  'Close Modal / Dropdown']
        ].map(function(row, i){
          return '<tr style="border-bottom:1px solid #f1f5f9;' + (i%2===0?'':'background:#fafbfc') + '">'
            + '<td style="padding:8px 14px;font-size:12px;width:40%"><kbd style="background:#0f172a;color:#fff;border-radius:4px;padding:2px 8px;font-size:11px;font-family:monospace">' + row[0] + '</kbd></td>'
            + '<td style="padding:8px 14px;font-size:13px;color:#374151">' + row[1] + '</td>'
            + '</tr>';
        }).join('')
      + '</table>'
      + '</div></div>'

      + _sectionLabel('\u{1F527} Health Check')
      + '<div class="panel" style="margin-bottom:14px"><div class="modal-body">'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap">'
      + '<button class="btn btn-ghost" onclick="if(ERP.selfTest)ERP.selfTest()">\u{1F52C} Run Self-Test</button>'
      + '<button class="btn btn-ghost" onclick="ERP.settings._showHealthStatus()">\u{1F48A} Check Health</button>'
      + '</div>'
      + '<div id="sets-health-result" style="margin-top:12px"></div>'
      + '</div></div>'

      + '</div>'   /* close sets-panel system */
      + '</div>'   /* close sets-content */

      + '</div>';  /* close sets-shell */

    _bindTabs();
  }

  function _saveBiz() {
    var logoRaw = (document.getElementById('sets-logo-url')||{}).value || '';
    var logoVal = '';
    if (logoRaw) {
      if (/^(https?:\/\/|data:image\/)/i.test(logoRaw)) {
        logoVal = logoRaw;
      } else {
        ERP.ui && ERP.ui.toast && ERP.ui.toast('\u26A0\uFE0F Logo URL must start with https:// or be an uploaded image', 'warning', 5000);
        return;
      }
    }

    var patch = {
      name:     ((document.getElementById('sets-biz-name')    ||{}).value || '').trim(),
      phone:    ((document.getElementById('sets-biz-phone')   ||{}).value || '').trim(),
      address:  ((document.getElementById('sets-biz-address') ||{}).value || '').trim(),
      email:    ((document.getElementById('sets-biz-email')   ||{}).value || '').trim(),
      website:  ((document.getElementById('sets-biz-website') ||{}).value || '').trim(),
      gst:      ((document.getElementById('sets-biz-gst')     ||{}).value || '').trim(),
      ntn:      ((document.getElementById('sets-biz-ntn')     ||{}).value || '').trim(),
      currency: ((document.getElementById('sets-biz-currency')||{}).value || 'Rs.').trim() || 'Rs.',
      city:     ((document.getElementById('sets-biz-city')    ||{}).value || '').trim(),
      logo:     logoVal
    };

    if (!patch.name) { ERP.ui.toast('\u274C Business Name cannot be empty', 'error'); return; }

    _settingsService.saveBiz(patch).then(function(){
      _updateHeader(patch);
      if (ERP.EventBus && ERP.EventBus.emit) {
        try { ERP.EventBus.emit('biz:updated', patch); } catch(e){ if(window.console&&console.error) console.error(e); }
      }
      if (patch.name) document.title = patch.name + ' ERP';
      render();
    }).catch(function(e){
      console.warn('[ERP settings:saveBiz]', e);
    });
  }

  function _handleLogoUpload(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var validTypes = ['image/jpeg','image/png','image/gif','image/svg+xml','image/webp'];
    if (validTypes.indexOf(f.type) < 0) {
      ERP.ui && ERP.ui.toast && ERP.ui.toast('\u26A0\uFE0F Invalid file type. Use JPG, PNG, SVG, WebP.', 'error', 4000);
      return;
    }
    if (f.size > 3 * 1024 * 1024) {
      ERP.ui && ERP.ui.toast && ERP.ui.toast('\u26A0\uFE0F Image too large \u2014 max 3MB recommended', 'warning', 4000);
    }
    var reader = new FileReader();
    reader.onload = function(ev) {
      var urlEl  = document.getElementById('sets-logo-url');
      var prevWp = document.getElementById('sets-logo-preview-wrap');
      if (urlEl)  urlEl.value = ev.target.result;
      if (prevWp) {
        prevWp.innerHTML = '<img id="sets-logo-preview-img" src="' + _escAttr(ev.target.result) + '" style="width:100%;height:100%;object-fit:contain">';
        var img = prevWp.querySelector('img');
        if (img) {
          img.onerror = function() {
            prevWp.innerHTML = '<span id="sets-logo-preview-fallback" style="font-size:28px;color:#cbd5e1">\u{1F4F7}</span>';
          };
        }
      }
      var logoImg = document.getElementById('tn-logo-img');
      var logoSvg = document.getElementById('tn-logo-svg');
      if (logoImg) { logoImg.src = ev.target.result; logoImg.style.display = ''; }
      if (logoSvg) logoSvg.style.display = 'none';
    };
    reader.onerror = function() {
      ERP.ui && ERP.ui.toast && ERP.ui.toast('\u274C Failed to read image file', 'error', 4000);
    };
    reader.readAsDataURL(f);
  }

  function _clearLogo() {
    var urlEl  = document.getElementById('sets-logo-url');
    var prevWp = document.getElementById('sets-logo-preview-wrap');
    if (urlEl)  urlEl.value = '';
    if (prevWp) prevWp.innerHTML = '<span id="sets-logo-preview-fallback" style="font-size:28px;color:#cbd5e1">\u{1F4F7}</span>';
    var logoImg = document.getElementById('tn-logo-img');
    var logoSvg = document.getElementById('tn-logo-svg');
    if (logoImg) { logoImg.style.display = 'none'; logoImg.removeAttribute('src'); }
    if (logoSvg) logoSvg.style.display = '';
    var biz = _settingsService.getBiz();
    if (biz.logo) {
      var patch = { logo: '' };
      setState(function(s){ if(s.biz) s.biz.logo = ''; }, 'settings');
      _settingsService.saveBiz(patch).catch(function(e){ console.warn('[ERP settings:clearLogo]', e); });
    }
  }

  function _savePayment() {
    var patch = {
      bankName:  (document.getElementById('sets-bank-name')  ||{}).value || '',
      bankTitle: (document.getElementById('sets-bank-title') ||{}).value || '',
      bankAcc:   (document.getElementById('sets-bank-acc')   ||{}).value || '',
      bankIban:  (document.getElementById('sets-bank-iban')  ||{}).value || '',
      bankUpi:   (document.getElementById('sets-bank-upi')   ||{}).value || '',
      qrCode:    (document.getElementById('sets-qr-url')     ||{}).value || ''
    };
    _settingsService.saveBiz(patch).then(function(){
      _updateHeader();
      if (ERP.EventBus && ERP.EventBus.emit) {
        try { ERP.EventBus.emit('biz:updated', patch); } catch(e){ if(window.console&&console.error) console.error(e); }
      }
      render();
    }).catch(function(e){
      console.warn('[ERP settings:savePayment]', e);
    });
  }

  function _saveAppSettings() {
    var rawTax  = parseFloat((document.getElementById('sets-tax-rate')    ||{}).value);
    var rawLow  = parseInt((document.getElementById('sets-low-stock')     ||{}).value);
    var rawPfx  = ((document.getElementById('sets-inv-pfx') ||{}).value || '').trim();
    var rawJob  = ((document.getElementById('sets-job-pfx') ||{}).value || '').trim();
    var rawPay  = parseInt((document.getElementById('sets-pay-terms')     ||{}).value);
    var rawDisc = parseFloat((document.getElementById('sets-def-disc')    ||{}).value);
    var rawYEM  = parseInt((document.getElementById('sets-ye-month')      ||{}).value);
    var rawYED  = parseInt((document.getElementById('sets-ye-day')        ||{}).value);

    if (isNaN(rawTax)||rawTax<0||rawTax>100)   { ERP.ui.toast('\u274C Tax Rate 0-100 hona chahiye','error'); return; }
    if (isNaN(rawLow)||rawLow<0||rawLow>100000){ ERP.ui.toast('\u274C Low Stock valid number hona chahiye','error'); return; }
    if (!rawPfx||rawPfx.length>10||!/^[A-Za-z0-9\-_]+$/.test(rawPfx)){ ERP.ui.toast('\u274C Invoice Prefix invalid (max 10 chars, letters/numbers only)','error'); return; }
    if (!rawJob||rawJob.length>10||!/^[A-Za-z0-9\-_]+$/.test(rawJob)) { ERP.ui.toast('\u274C Job Prefix invalid','error'); return; }
    if (isNaN(rawYEM)||rawYEM<1||rawYEM>12)    { ERP.ui.toast('\u274C Year-End Month 1-12 hona chahiye','error'); return; }
    var _maxDayInYEM = new Date(2024, rawYEM, 0).getDate();
    if (isNaN(rawYED)||rawYED<1||rawYED>_maxDayInYEM) { ERP.ui.toast('\u274C Year-End Day is invalid for the selected month','error'); return; }

    var prevTax = (getState().settings || {}).taxRate;
    var _cb = function(id){ return !!(document.getElementById(id) && document.getElementById(id).checked); };
    var autoPrintVal = _cb('sets-auto-print');

    _settingsService.saveSettings({
      lowStockAlert:      rawLow,
      taxRate:            rawTax,
      invoicePrefix:      rawPfx,
      jobPrefix:          rawJob,
      paymentTerms:       isNaN(rawPay)  ? 30 : rawPay,
      defaultDiscount:    isNaN(rawDisc) ? 0  : rawDisc,
      yearEndMonth:       rawYEM,
      yearEndDay:         rawYED,
      allowNegativeStock: _cb('sets-neg-stock'),
      showTaxOnInvoice:   _cb('sets-show-tax-invoice'),
      requireCustomer:    _cb('sets-req-cust-invoice'),
      autoBackup:         _cb('sets-auto-backup'),
      autoPrintOnSave:    autoPrintVal,
      lowStockNotif:      _cb('sets-low-stock-notif'),
      jobReminders:       _cb('sets-job-reminder')
    }).then(function(){
      try {
        if (ERP.printer && ERP.printer.getConfig && ERP.printer._save) {
          var pc = ERP.printer.getConfig();
          pc.autoPrint = autoPrintVal;
          ERP.printer._save(pc);
        }
      } catch(e) { if(window.console&&console.error) console.error(e); }
      try {
        if (ERP.inventory && ERP.inventory.render) {
          var invPanel = document.getElementById('pv-inventory');
          if (invPanel && window.getComputedStyle(invPanel).display !== 'none') {
            ERP.inventory.render();
          }
        }
      } catch(e) { if(window.console&&console.error) console.error(e); }
      if (rawTax !== prevTax) {
        ERP.ui.toast('\u2705 Saved! Tax rate changed \u2014 reloading the page...','success',2500);
        setTimeout(function(){ window.location.reload(); }, 2600);
      } else {
        render();
      }
    }).catch(function(e){
      console.warn('[ERP settings:saveApp]', e);
    });
  }

  function _setDisplayMode(mode) {
    var isDark = (mode === 'dark');
    if (isDark) document.body.classList.add('dark'); else document.body.classList.remove('dark');
    try { setState(function(s){ if(s.ui) s.ui.dark = isDark; }); } catch(e){ if(window.console&&console.error) console.error(e); }
    try { localStorage.setItem('mh_dark', isDark ? '1' : '0'); } catch(e){ if(window.console&&console.error) console.error(e); }
    var root = document.documentElement;
    if (isDark) {
      root.style.setProperty('--bg',       '#0f172a');
      root.style.setProperty('--surface',  '#1e293b');
      root.style.setProperty('--border-l', '#334155');
      root.style.setProperty('--text',     '#f1f5f9');
      root.style.setProperty('--muted',    '#94a3b8');
    } else {
      root.style.removeProperty('--bg');
      root.style.removeProperty('--surface');
      root.style.removeProperty('--border-l');
      root.style.removeProperty('--text');
      root.style.removeProperty('--muted');
    }
    if (ERP.EventBus && ERP.EventBus.emit) {
      try { ERP.EventBus.emit('ui:darkMode', { dark: isDark }); } catch(e){ if(window.console&&console.error) console.error(e); }
    }
    ERP.ui && ERP.ui.toast && ERP.ui.toast(isDark ? '\u{1F319} Dark mode on' : '\u2600\uFE0F Light mode on', 'success', 2000);
    document.querySelectorAll('[data-dm]').forEach(function(el){
      var a = el.getAttribute('data-dm') === mode;
      el.style.border     = '2px solid ' + (a ? 'var(--primary)' : '#e2e8f0');
      el.style.background = a ? 'rgba(27,79,140,.06)' : (isDark ? '#1e293b' : '#fff');
    });
  }

  function _setColor(hex) {
    if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return;
    _applyTheme(hex);
    var hexEl = document.getElementById('sets-color-hex');
    if (hexEl) hexEl.textContent = hex;
    var hexElThemes = document.getElementById('sets-color-hex-themes');
    if (hexElThemes) hexElThemes.textContent = hex;
    var picker = document.getElementById('sets-custom-color');
    if (picker) picker.value = hex;
    var pickerThemes = document.getElementById('sets-color-hex-themes-picker');
    if (pickerThemes) pickerThemes.value = hex;
    document.querySelectorAll('[onclick^="ERP.settings._setColor"]').forEach(function(btn){
      var btnHex = btn.getAttribute('onclick').match(/#[0-9A-Fa-f]{6}/);
      if (btnHex) btn.style.border = (btnHex[0].toLowerCase() === hex.toLowerCase()) ? '3px solid #0f172a' : '2px solid #e2e8f0';
    });
    ERP.ui && ERP.ui.toast && ERP.ui.toast('\u{1F3A8} Theme color applied!', 'success', 1500);
  }

  function _resetColor() { _setColor('#4338CA'); }

  function _setDensity(val) {
    try { localStorage.setItem('mh_density', val); } catch(e){ if(window.console&&console.error) console.error(e); }
    var sizes = { compact:'12px', normal:'14px', spacious:'15px' };
    document.body.style.fontSize = sizes[val] || '14px';
    document.querySelectorAll('[data-density]').forEach(function(el){
      var a = el.getAttribute('data-density') === val;
      el.style.border     = '2px solid ' + (a ? 'var(--primary)' : '#e2e8f0');
      el.style.background = a ? 'rgba(27,79,140,.06)' : '#fff';
    });
    ERP.ui && ERP.ui.toast && ERP.ui.toast('\u2705 Density: ' + val, 'success', 1500);
  }

  function _setFontSize(val) {
    try { localStorage.setItem('mh_fontsize', val); } catch(e){ if(window.console&&console.error) console.error(e); }
    var sizes = { sm:'13px', md:'14px', lg:'15px' };
    document.body.style.fontSize = sizes[val] || '14px';
    document.querySelectorAll('[data-fsize]').forEach(function(el){
      var a = el.getAttribute('data-fsize') === val;
      el.style.border     = '2px solid ' + (a ? 'var(--primary)' : '#e2e8f0');
      el.style.background = a ? 'rgba(27,79,140,.06)' : '#fff';
      el.style.fontWeight = a ? '700' : '500';
      el.style.color      = a ? 'var(--primary,#4338CA)' : '#475569';
    });
  }

  function _showAddUser()  { var f = document.getElementById('sets-add-user-form'); if(f) f.style.display = ''; }
  function _hideAddUser()  { var f = document.getElementById('sets-add-user-form'); if(f) f.style.display = 'none'; }

  function _addUser() {
    var name    = ((document.getElementById('new-user-name')  ||{}).value||'').trim();
    var uname   = ((document.getElementById('new-user-uname') ||{}).value||'').trim().toLowerCase();
    var pwd     = ((document.getElementById('new-user-pwd')   ||{}).value||'');
    var role    = ((document.getElementById('new-user-role')  ||{}).value||'Staff');
    var secqKey = ((document.getElementById('new-user-secq')  ||{}).value||'');
    var secaVal = ((document.getElementById('new-user-seca')  ||{}).value||'').trim();
    if (!name||!uname||!pwd) { ERP.ui.toast('\u274C Please fill all fields','error'); return; }
    if (pwd.length < 4)      { ERP.ui.toast('\u274C Password minimum 4 characters hona chahiye','error'); return; }
    if (!secqKey)            { ERP.ui.toast('\u274C Please select a security question','error'); return; }
    if (!secaVal)            { ERP.ui.toast('\u274C Please enter a security answer','error'); return; }
    if (!/^[a-z0-9_]+$/.test(uname)) { ERP.ui.toast('\u274C Username sirf letters, numbers, underscore hona chahiye','error'); return; }
    if (!ERP.auth || !ERP.auth.addUser) { ERP.ui.toast('\u274C Auth module not loaded','error'); return; }
    ERP.auth.addUser(uname, pwd, name, role, secqKey, secaVal)
      .then(function(){ ERP.ui.toast('\u2705 User "' + _esc(name) + '" created!', 'success'); _hideAddUser(); setTimeout(render, 200); })
      .catch(function(e){ ERP.ui.toast('\u274C ' + (e.message||'Error creating user'), 'error'); });
  }

  function _deleteUser(username) {
    var _cu = getState().session && getState().session.user;
    if (!_cu || (_cu.role || '').toLowerCase() !== 'admin') {
      ERP.ui.toast('\u274C Only Admin can delete users', 'error'); return;
    }
    var _delUsrConfirm = (window.ERP && window.ERP.confirmDialog) || function(msg, ok) { if (window.confirm(msg)) ok(); };
    _delUsrConfirm('User "' + _esc(username) + '" ko delete karein?\nYeh action reversible nahi hai.', function() {
      if (!ERP.auth || !ERP.auth.deleteUser) {
        ERP.ui.toast('\u274C Auth module is not updated \u2014 please reload the page', 'error'); return;
      }
      try {
        ERP.auth.deleteUser(username);
        ERP.ui.toast('\u2705 User "' + _esc(username) + '" deleted', 'success');
        setTimeout(render, 200);
      } catch(e) {
        ERP.ui.toast('\u274C ' + (e.message || 'Delete failed'), 'error');
      }
    });
  }

  function _toggleRole(username, currentRole) {
    var _cu2 = getState().session && getState().session.user;
    if (!_cu2 || (_cu2.role || '').toLowerCase() !== 'admin') {
      ERP.ui.toast('\u274C Only Admin can change roles', 'error'); return;
    }
    var rolesArr   = ['Staff', 'Manager', 'Admin'];
    var curIdx  = rolesArr.indexOf(currentRole);
    var newRole = rolesArr[(curIdx + 1) % rolesArr.length];
    var _roleConfirm = (window.ERP && window.ERP.confirmDialog) || function(msg, ok) { if (window.confirm(msg)) ok(); };
    _roleConfirm('User "' + _esc(username) + '" ka role:\n"' + _esc(currentRole) + '" \u2192 "' + _esc(newRole) + '"\n\nChange karein?', function() {
      if (!ERP.auth || !ERP.auth.updateRole) {
        ERP.ui.toast('\u274C Auth module is not updated \u2014 please reload the page', 'error'); return;
      }
      try {
        ERP.auth.updateRole(username, newRole);
        ERP.ui.toast('\u2705 Role changed: ' + _esc(username) + ' \u2192 ' + _esc(newRole), 'success', 3000);
        setTimeout(render, 200);
      } catch(e) {
        ERP.ui.toast('\u274C ' + (e.message || 'Role change failed'), 'error');
      }
    });
  }

  function _showChangePass(username) {
    var f = document.getElementById('sets-change-pass-form');
    var t = document.getElementById('sets-chpass-title');
    var u = document.getElementById('chpass-username');
    if (f) f.style.display = '';
    if (t) t.textContent = '\u{1F511} Change Password \u2014 @' + _esc(username);
    if (u) u.value = username;
    var el = document.getElementById('chpass-new'); if (el) { el.value=''; el.focus(); }
    var el2 = document.getElementById('chpass-cfm'); if (el2) el2.value='';
  }

  function _showMyPassword() {
    var currentUser = getState().session && getState().session.user;
    if (currentUser) _showChangePass(currentUser.username);
  }

  function _doChangePass() {
    var username = ((document.getElementById('chpass-username')||{}).value||'').trim();
    var newPwd   = ((document.getElementById('chpass-new')     ||{}).value||'');
    var cfmPwd   = ((document.getElementById('chpass-cfm')     ||{}).value||'');
    if (!username)                     { ERP.ui.toast('\u274C Username missing','error'); return; }
    if (!newPwd || newPwd.length < 4)  { ERP.ui.toast('\u274C Password minimum 4 characters','error'); return; }
    if (newPwd !== cfmPwd)             { ERP.ui.toast('\u274C Passwords do not match','error'); return; }
    if (!ERP.auth)                     { ERP.ui.toast('\u274C Auth module not ready','error'); return; }

    var currentUser = getState().session && getState().session.user;
    var isSelf      = currentUser && currentUser.username === username;

    function _closeForm() {
      var f = document.getElementById('sets-change-pass-form');
      if (f) f.style.display = 'none';
      var n = document.getElementById('chpass-new'); if (n) n.value = '';
      var c = document.getElementById('chpass-cfm'); if (c) c.value = '';
    }

    if (isSelf) {
      var oldPwd = prompt('Apna current password enter karein:');
      if (!oldPwd) return;
      ERP.auth.changePassword(username, oldPwd, newPwd)
        .then(function(){ ERP.ui.toast('\u2705 Password changed!', 'success'); _closeForm(); })
        .catch(function(e){ ERP.ui.toast('\u274C ' + (e.message || 'Wrong current password'), 'error'); });
    } else {
      if (!ERP.auth.adminResetPassword) {
        ERP.ui.toast('\u274C Admin reset not available \u2014 please reload the page', 'error'); return;
      }
      ERP.auth.adminResetPassword(username, newPwd)
        .then(function(){ ERP.ui.toast('\u2705 Password reset: @' + _esc(username), 'success'); _closeForm(); setTimeout(render, 200); })
        .catch(function(e){ ERP.ui.toast('\u274C ' + (e.message || 'Reset failed'), 'error'); });
    }
  }

  function _toggleFlag(key, val) {
    if (!ERP.FeatureFlags) { ERP.ui.toast('\u274C Feature flags module not loaded', 'error'); return; }
    var authLoaded = !!(ERP.auth && ERP.auth.getUsers);
    var currentUser = getState().session && getState().session.user;
    if (authLoaded && currentUser && currentUser.role !== 'Admin') {
      ERP.ui.toast('\u26D4 Only Admin can change feature flags.', 'error', 4000);
      _revertFlagCheckbox(key, !val);
      return;
    }
    var result = ERP.FeatureFlags.set(key, val);
    if (result.ok) {
      ERP.ui.toast('\u{1F6A9} Flag "' + _esc(key) + '": ' + (val ? 'ON' : 'OFF'), val ? 'success' : 'info', 2000);
      _updateFlagToggleUI(key, val);
      _applyFlagSideEffect(key, val);
    } else {
      if (result.error === 'PERMISSION_DENIED') {
        ERP.ui.toast('\u26D4 Permission denied \u2014 Admin role required.', 'error', 4000);
      } else {
        ERP.ui.toast('\u274C Flag change failed: ' + _esc(result.error), 'error');
      }
      _revertFlagCheckbox(key, !val);
    }
  }

  function _updateFlagToggleUI(key, isOn) {
    try {
      var inputs = document.querySelectorAll('input[onchange*="' + key + '"]');
      inputs.forEach(function (inp) {
        inp.checked = isOn;
        var track = inp.nextElementSibling;
        if (track) {
          track.style.background = isOn ? '#16a34a' : '#cbd5e1';
          var knob = track.querySelector('span');
          if (knob) knob.style.left = isOn ? '21px' : '3px';
        }
      });
    } catch (e) { if(window.console&&console.error) console.error(e); }
  }

  function _revertFlagCheckbox(key, prevVal) {
    try {
      var inp = document.querySelector('input[onchange*="' + key + '"]');
      if (inp) inp.checked = prevVal;
    } catch (e) { if(window.console&&console.error) console.error(e); }
  }

  function _applyFlagSideEffect(key, val) {
    try {
      switch (key) {
        case 'multi_tab_coordinator':
          _applyMultiTabCoordinator(val);
          break;
        case 'backup_engine':
          if (ERP.BackupEngine && ERP.BackupEngine.setEnabled) ERP.BackupEngine.setEnabled(val);
          break;
        case 'audit_archive':
          if (ERP.AuditArchive && ERP.AuditArchive.setEnabled) ERP.AuditArchive.setEnabled(val);
          break;
        case 'gst_engine':
          if (ERP.GSTEngine && ERP.GSTEngine.setEnabled) ERP.GSTEngine.setEnabled(val);
          break;
        case 'user_lifecycle':
          if (val && ERP.UserLifecycle && ERP.UserLifecycle.install) {
            try { ERP.UserLifecycle.install(); } catch(e) { if(window.console&&console.error) console.error(e); }
          }
          break;
        case 'shadow_sales':
        case 'shadow_purchase':
        case 'shadow_inventory':
        case 'shadow_reports':
        case 'tax_engine':
          ERP.ui && ERP.ui.toast && ERP.ui.toast(
            '\u26A0\uFE0F Module flag changed. Page reload ho ga 2 seconds mein...', 'warning', 2500
          );
          setTimeout(function () { window.location.reload(); }, 2600);
          break;
        default:
          break;
      }
    } catch (e) { if(window.console&&console.error) console.error(e); }
  }

  var _mtcChannel = null;
  var _mtcTabId = 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2);

  function _applyMultiTabCoordinator(enable) {
    try {
      if (enable) {
        if (typeof BroadcastChannel !== 'undefined' && !_mtcChannel) {
          _mtcChannel = new BroadcastChannel('mh_erp_multi_tab_coordinator');
          _mtcChannel.onmessage = function (ev) {
            try {
              var msg = ev.data;
              if (!msg || msg.source === _mtcTabId) return;
              if (msg.type === 'state_changed' && ERP.registerRenderer) {
                try {
                  var cur = ERP.getState && ERP.getState().ui && ERP.getState().ui.page;
                  if (cur && ERP._renderers && ERP._renderers[cur]) ERP._renderers[cur]();
                } catch(e2){ if(window.console&&console.error) console.error(e2); }
              }
            } catch (e) { if(window.console&&console.error) console.error(e); }
          };
          if (ERP.EventBus && ERP.EventBus.on) {
            ERP.EventBus.on('state:changed', function () {
              try {
                if (_mtcChannel) _mtcChannel.postMessage({ type: 'state_changed', source: _mtcTabId });
              } catch (e) { if(window.console&&console.error) console.error(e); }
            });
          }
          ERP.ui && ERP.ui.toast && ERP.ui.toast('\u{1F517} Multi-Tab Coordinator: ON', 'success', 2000);
        } else if (typeof BroadcastChannel === 'undefined') {
          ERP.ui && ERP.ui.toast && ERP.ui.toast('\u26A0\uFE0F BroadcastChannel not supported in this browser', 'warning', 4000);
        }
      } else {
        if (_mtcChannel) { try { _mtcChannel.close(); } catch (e) { if(window.console&&console.error) console.error(e); } _mtcChannel = null; }
        ERP.ui && ERP.ui.toast && ERP.ui.toast('\u{1F517} Multi-Tab Coordinator: OFF', 'info', 2000);
      }
    } catch (e) { if(window.console&&console.error) console.error(e); }
  }

  function _resetFlags() {
    var _flagConfirm = (window.ERP && window.ERP.confirmDialog) || function(msg, ok) { if (window.confirm(msg)) ok(); };
    _flagConfirm('Sare feature flags default values par reset karein?', function() {
      if (!ERP.FeatureFlags) { ERP.ui.toast('\u274C Feature flags not loaded', 'error'); return; }
      var authLoaded = !!(ERP.auth && ERP.auth.getUsers);
      var currentUser = getState().session && getState().session.user;
      if (authLoaded && currentUser && currentUser.role !== 'Admin') {
        ERP.ui.toast('\u26D4 Only Admin can perform a reset.', 'error', 4000);
        return;
      }
      var defaults = ERP.FeatureFlags.getDefaults ? ERP.FeatureFlags.getDefaults() : null;
      if (defaults) {
        var allKeys = Object.keys(defaults);
        allKeys.forEach(function (k) { ERP.FeatureFlags.set(k, defaults[k]); });
        ERP.ui.toast('\u2705 All flags reset to defaults', 'success');
        setTimeout(render, 200);
        return;
      }
      var r = ERP.FeatureFlags.resetAll ? ERP.FeatureFlags.resetAll() : { ok: false, error: 'resetAll not available' };
      if (r.ok) {
        ERP.ui.toast('\u2705 All flags reset to defaults', 'success');
        setTimeout(render, 200);
      } else {
        ERP.ui.toast('\u274C Reset failed: ' + _esc(r.error), 'error');
      }
    });
  }

  function _saveSecuritySettings() {
    var timeout = parseInt((document.getElementById('sets-session-timeout')||{}).value) || 30;
    var pinTo   = parseInt((document.getElementById('sets-pin-timeout')    ||{}).value) || 5;
    var pinSt   = !!(document.getElementById('sets-pin-on-startup') && document.getElementById('sets-pin-on-startup').checked);

    if (timeout < 1 || timeout > 480) { ERP.ui.toast('\u274C Session timeout: 1\u2013480 minutes', 'error'); return; }
    if (pinTo   < 1 || pinTo   > 60)  { ERP.ui.toast('\u274C PIN timeout: 1\u201360 minutes', 'error'); return; }

    _settingsService.saveSettings({ sessionTimeout: timeout, pinTimeout: pinTo, pinOnStartup: pinSt }).then(function(){
      try {
        if (ERP.auth) {
          if (ERP.auth.updateTimeout) {
            ERP.auth.updateTimeout(timeout * 60 * 1000);
          } else if (ERP.auth._startTimer) {
            ERP.auth._startTimer();
          }
        }
      } catch(e) { if(window.console&&console.error) console.error(e); }
      try {
        localStorage.setItem('mh_session_timeout', String(timeout));
        localStorage.setItem('mh_pin_timeout',     String(pinTo));
        localStorage.setItem('mh_pin_on_startup',  pinSt ? '1' : '0');
      } catch(e){ if(window.console&&console.error) console.error(e); }
      ERP.ui.toast('\u2705 Security settings saved! Timer updated live.', 'success', 3000);
    }).catch(function(e){
      console.warn('[ERP settings:saveSecurity]', e);
    });
  }

  function _dangerConfirm(msg, onYes) {
    var id = '_mh_danger_confirm';
    var existing = document.getElementById(id);
    if (existing) existing.remove();
    var modal = document.createElement('div');
    modal.id = id;
    modal.style.cssText = 'position:fixed;inset:0;z-index:var(--zi-critical,1100);background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px';
    modal.innerHTML =
      '<div style="background:var(--white,#fff);border-radius:16px;padding:24px;max-width:380px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.4)">'
      + '<div style="font-size:22px;text-align:center;margin-bottom:12px">\u26A0\uFE0F</div>'
      + '<div style="font-size:14px;color:var(--text,#0f172a);line-height:1.6;white-space:pre-line;margin-bottom:20px">' + _esc(msg) + '</div>'
      + '<div style="display:flex;gap:10px">'
      + '<button id="_mh_dc_no" style="flex:1;padding:11px;background:var(--bg,#f1f5f9);border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;color:#475569">Cancel</button>'
      + '<button id="_mh_dc_yes" style="flex:1;padding:11px;background:#dc2626;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer">Yes, Delete</button>'
      + '</div></div>';
    document.body.appendChild(modal);

    var _dcEscHandler = function(e){
      if (e.key === 'Escape') {
        var m = document.getElementById(id);
        if (m) m.remove();
        document.removeEventListener('keydown', _dcEscHandler);
      }
    };
    document.addEventListener('keydown', _dcEscHandler);

    document.getElementById('_mh_dc_no').onclick  = function(){ modal.remove(); document.removeEventListener('keydown', _dcEscHandler); };
    document.getElementById('_mh_dc_yes').onclick = function(){ modal.remove(); document.removeEventListener('keydown', _dcEscHandler); onYes(); };
    modal.onclick = function(e){ if(e.target===modal){ modal.remove(); document.removeEventListener('keydown', _dcEscHandler); } };
  }

  function _clearAll() {
    _dangerConfirm(
      'Sab kuch delete ho jaye ga:\nCustomers, Inventory, Invoices, Payments\n\nAudit Log preserve hogi.\n\nYeh action BILKUL reversible nahi hai!',
      async function() {
        ERP.ui.toast('\u{1F4BE} Creating safety backup before delete...', 'warning', 0);
        var _backupOk = false;
        try {
          if (ERP.BackupEngine && typeof ERP.BackupEngine.exportToFile === 'function') {
            var _bkRes = await Promise.race([
              ERP.BackupEngine.exportToFile(),
              new Promise(function(resolve){ setTimeout(function(){ resolve({ ok:false, error:'TIMEOUT' }); }, 15000); })
            ]);
            _backupOk = !!(_bkRes && _bkRes.ok);
          } else if (ERP._db && ERP._db.backup) {
            await ERP._db.backup();
            _backupOk = true;
          }
        } catch(e) { _backupOk = false; }
        if (!_backupOk) {
          ERP.ui.toast('\u274c Safety backup failed — delete cancelled. Fix the backup issue and retry.', 'error', 0);
          return;
        }
        ERP.ui.toast('\u{1F5D1}\uFE0F Deleting all data...', 'warning', 4000);
        setTimeout(function(){
          var _mainK = (ERP.CONSTANTS && ERP.CONSTANTS.STORAGE_KEYS && ERP.CONSTANTS.STORAGE_KEYS.MAIN) || 'mh_erp_data';
          var _miniK = (ERP.CONSTANTS && ERP.CONSTANTS.STORAGE_KEYS && ERP.CONSTANTS.STORAGE_KEYS.MINI) || 'mh_erp_data_mini';
          try { localStorage.removeItem(_mainK); }       catch(e){ if(window.console&&console.error) console.error(e); }
          try { localStorage.removeItem(_miniK); }  catch(e){ if(window.console&&console.error) console.error(e); }
          try { localStorage.removeItem('mh_erp_tx_pending'); } catch(e){ if(window.console&&console.error) console.error(e); }
          try { localStorage.removeItem('mh_dataVersion'); }    catch(e){ if(window.console&&console.error) console.error(e); }
          try { localStorage.removeItem('erp_gl_pending_sales'); }   catch(e){ if(window.console&&console.error) console.error(e); }
          try { localStorage.removeItem('erp_pe_wal_pending'); }     catch(e){ if(window.console&&console.error) console.error(e); }
          try { localStorage.removeItem('erp_pe_wal_committed'); }   catch(e){ if(window.console&&console.error) console.error(e); }
          try { localStorage.removeItem('erp_purret_gl_backlog'); }  catch(e){ if(window.console&&console.error) console.error(e); }
          try { localStorage.removeItem('erp_payin_gl_pending'); }   catch(e){ if(window.console&&console.error) console.error(e); }
          try { localStorage.removeItem('erp_cashrefund_gl_pending'); } catch(e){ if(window.console&&console.error) console.error(e); }
          try { localStorage.removeItem('erp_po_gl_backlog'); }      catch(e){ if(window.console&&console.error) console.error(e); }
          if (window.PurchaseState && PurchaseState.clearStorage) {
            try { PurchaseState.clearStorage({ confirmed: true }); } catch(e){ if(window.console&&console.error) console.error(e); }
          } else {
            ['mh_purchase_store','mh_purchase_meta','mh_purchase_stamp','mh_purchase_store_chk',
             'mh_supplier_ledger','mh_payment_allocations_out',
             'mh_paymentOuts','mh_purchaseOrders','mh_purchaseReturns'
            ].forEach(function(k){ try { localStorage.removeItem(k); } catch(e){ if(window.console&&console.error) console.error(e); } });
          }
          if (ERP.storage && ERP.storage.clearAll) {
            ERP.storage.clearAll(false);
          } else {
            setTimeout(function(){ window.location.reload(); }, 300);
          }
        }, 300);
      }
    );
  }

  function _clearTransactions() {
    _dangerConfirm(
      'Sirf transactions delete honge:\nInvoices, Payments, Returns, Ledger\n\nCustomers aur Inventory SAFE rahenge.\n\nConfirm?',
      async function() {
        ERP.ui.toast('\u{1F4BE} Creating safety backup before delete...', 'warning', 0);
        var _backupOk = false;
        try {
          if (ERP.BackupEngine && typeof ERP.BackupEngine.exportToFile === 'function') {
            var _bkRes = await Promise.race([
              ERP.BackupEngine.exportToFile(),
              new Promise(function(resolve){ setTimeout(function(){ resolve({ ok:false, error:'TIMEOUT' }); }, 15000); })
            ]);
            _backupOk = !!(_bkRes && _bkRes.ok);
          } else if (ERP._db && ERP._db.backup) {
            await ERP._db.backup();
            _backupOk = true;
          }
        } catch(e) { _backupOk = false; }
        if (!_backupOk) {
          ERP.ui.toast('\u274c Safety backup failed — delete cancelled. Fix the backup issue and retry.', 'error', 0);
          return;
        }
        ERP.ui.toast('\u{1F9F9} Clearing transactions...', 'warning', 3000);
        setTimeout(function(){
          try {
            var _txKeys = ['sales','payIn','saleReturns','paymentAllocations','customerLedger',
                           'customerPayOut','estimates','saleOrders','deliveryChallans','purchases',
                           'purchaseOrders','purchaseReturns','payOut','jobs','expenses',
                           'bankTransactions','cheques','stockMovements','stockBatches','loans','batches'];
            var _mainKey2 = (ERP.CONSTANTS && ERP.CONSTANTS.STORAGE_KEYS && ERP.CONSTANTS.STORAGE_KEYS.MAIN) || 'mh_erp_data';
            var _raw = localStorage.getItem(_mainKey2);
            if (_raw) {
              var _parsed = JSON.parse(_raw);
              _txKeys.forEach(function(k) { _parsed[k] = []; });
              localStorage.setItem(_mainKey2, JSON.stringify(_parsed));
            }
            localStorage.removeItem('mh_erp_tx_pending');
            try { localStorage.removeItem('erp_gl_pending_sales'); }      catch(e){ if(window.console&&console.error) console.error(e); }
            try { localStorage.removeItem('erp_pe_wal_pending'); }        catch(e){ if(window.console&&console.error) console.error(e); }
            try { localStorage.removeItem('erp_pe_wal_committed'); }      catch(e){ if(window.console&&console.error) console.error(e); }
            try { localStorage.removeItem('erp_purret_gl_backlog'); }     catch(e){ if(window.console&&console.error) console.error(e); }
            try { localStorage.removeItem('erp_payin_gl_pending'); }      catch(e){ if(window.console&&console.error) console.error(e); }
            try { localStorage.removeItem('erp_cashrefund_gl_pending'); } catch(e){ if(window.console&&console.error) console.error(e); }
            try { localStorage.removeItem('erp_po_gl_backlog'); }         catch(e){ if(window.console&&console.error) console.error(e); }
            if (window.PurchaseState) {
              try {
                PurchaseState.setPurchases([]);
                PurchaseState.setPurchaseOrders([]);
                PurchaseState.setPurchaseReturns([]);
                PurchaseState.setPaymentOuts([]);
                PurchaseState.save();
              } catch(_pe){ if(window.console&&console.error) console.error(_pe); }
            } else {
              try { localStorage.removeItem('mh_purchase_store'); }      catch(_pe2){ if(window.console&&console.error) console.error(_pe2); }
              try { localStorage.removeItem('mh_purchaseOrders'); }      catch(_e2){ if(window.console&&console.error) console.error(_e2); }
              try { localStorage.removeItem('mh_purchaseReturns'); }     catch(_e3){ if(window.console&&console.error) console.error(_e3); }
              try { localStorage.removeItem('mh_paymentOuts'); }         catch(_e4){ if(window.console&&console.error) console.error(_e4); }
            }
            try { localStorage.removeItem('mh_supplier_ledger'); }         catch(e){ if(window.console&&console.error) console.error(e); }
            try { localStorage.removeItem('mh_payment_allocations_out'); } catch(e){ if(window.console&&console.error) console.error(e); }
          } catch(_e){ if(window.console&&console.error) console.error(_e); }
          if (ERP.storage && ERP.storage.clearAll) {
            ERP.storage.clearAll(true);
          } else {
            setTimeout(function(){ window.location.reload(); }, 300);
          }
        }, 300);
      }
    );
  }

  function _showHealthStatus() {
    var el = document.getElementById('sets-health-result');
    if (!el) return;
    el.innerHTML = '<div style="font-size:12px;color:#4338CA;padding:8px 0">\u23F3 Running diagnostics...</div>';

    var basicChecks = [
      { name:'IndexedDB',        ok: !!window.indexedDB,                              hint:'Database storage' },
      { name:'LocalStorage',     ok: (function(){ try { localStorage.setItem('_t','1'); localStorage.removeItem('_t'); return true; } catch(e){ return false; } }()), hint:'Browser prefs storage' },
      { name:'ERP Core',         ok: !!(window.ERP && ERP._internal),                 hint:'Core state engine' },
      { name:'Auth Module',      ok: !!(ERP.auth && ERP.auth.getUsers),               hint:'User management' },
      { name:'Printer Module',   ok: !!(ERP.printer),                                 hint:'Print configuration' },
      { name:'Feature Flags',    ok: !!(ERP.FeatureFlags),                            hint:'Runtime toggles' },
      { name:'Inventory Module', ok: !!(ERP.inventory),                               hint:'Stock management' },
      { name:'Sales Module',     ok: !!(ERP.sales),                                   hint:'Invoice processing' },
      { name:'Notifications',    ok: !!(ERP.notify),                                  hint:'Alert system' },
      { name:'Reports Module',   ok: !!(ERP.reports),                                 hint:'Analytics engine' },
      { name:'EventBus',         ok: !!(ERP.EventBus && ERP.EventBus.emit),           hint:'Module communication' },
      { name:'Backup Engine',    ok: !!(ERP.FeatureFlags && ERP.FeatureFlags.get('backup_engine')), hint:'Auto-backup system' }
    ];

    var deepHtml = '';
    if (window.MH_Health && typeof window.MH_Health === 'object' && typeof MH_Health.storageUsage === 'function') {
      try {
        var usage = MH_Health.storageUsage();
        deepHtml = '<div style="margin-top:14px;padding:10px 12px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px">'
          + '<div style="font-size:11px;font-weight:800;color:#0284c7;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">\u{1F4CA} Storage Metrics</div>'
          + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">'
          + Object.keys(usage || {}).map(function(k){
              return '<div style="font-size:12px"><span style="color:var(--muted,#64748b)">' + _esc(k) + ':</span> <b>' + _esc(JSON.stringify(usage[k]).slice(0,30)) + '</b></div>';
            }).join('')
          + '</div></div>';
      } catch(e){ if(window.console&&console.error) console.error(e); }
    }

    var okCount = basicChecks.filter(function(c){ return c.ok; }).length;
    var statusColor = okCount === basicChecks.length ? '#166534' : okCount > basicChecks.length * 0.7 ? '#92400e' : '#dc2626';
    var statusBg    = okCount === basicChecks.length ? '#f0fdf4' : okCount > basicChecks.length * 0.7 ? '#fffbeb' : '#fef2f2';
    var statusIcon  = okCount === basicChecks.length ? '\u2705' : okCount > basicChecks.length * 0.7 ? '\u26A0\uFE0F' : '\u274C';

    el.innerHTML =
      '<div style="background:' + statusBg + ';border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:8px">'
      + '<span style="font-size:20px">' + statusIcon + '</span>'
      + '<div><div style="font-size:13px;font-weight:700;color:' + statusColor + '">' + okCount + '/' + basicChecks.length + ' modules healthy</div>'
      + '<div style="font-size:11px;color:var(--muted,#64748b)">System status check complete</div></div>'
      + '</div>'
      + '<div style="display:grid;gap:5px">'
      + basicChecks.map(function(c){
          return '<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;background:' + (c.ok?'#f0fdf4':'#fef2f2') + ';border:1px solid '+(c.ok?'#86efac':'#fca5a5')+';">'
            + '<span style="font-size:13px">' + (c.ok?'\u2705':'\u274C') + '</span>'
            + '<div style="flex:1"><div style="font-size:12px;font-weight:600;color:'+(c.ok?'#166534':'#dc2626')+'">' + _esc(c.name) + '</div>'
            + '<div style="font-size:10px;color:#94a3b8">' + _esc(c.hint) + '</div></div>'
            + '<span style="font-size:10px;background:' + (c.ok?'#dcfce7':'#fee2e2') + ';color:' + (c.ok?'#166534':'#dc2626') + ';border-radius:20px;padding:2px 8px;font-weight:700">' + (c.ok?'OK':'FAIL') + '</span>'
            + '</div>';
        }).join('')
      + '</div>'
      + deepHtml;
  }

  function _renderThemesPage() {
    var tpv = document.getElementById('pv-themes');
    if (!tpv) return;

    var currentColor = '';
    try { currentColor = localStorage.getItem('mh_theme_color') || '#4338CA'; } catch(e){ currentColor = '#4338CA'; }
    var isDark = document.body.classList.contains('dark');
    var savedDensity  = _getSavedDensity();
    var savedFontSize = _getSavedFontSize();

    tpv.innerHTML =
      '<div class="sets-hero">'
      + '<div class="sets-hero-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:22px;height:22px"><use href="#ic-edit"/></svg></div>'
      + '<div class="sets-hero-text"><h1>Themes</h1><p>App ka look aur feel customize karein \u2014 color, dark/light mode, density aur font size</p></div>'
      + '</div>'

      + _sectionLabel('\u{1F319} Display Mode')
      + '<div class="panel" style="margin-bottom:14px"><div class="modal-body">'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
      + _modeCard('light', '\u2600\uFE0F', 'Light Mode', 'Default bright UI', !isDark)
      + _modeCard('dark',  '\u{1F319}', 'Dark Mode',  'Easy on the eyes',   isDark)
      + '</div>'
      + '</div></div>'

      + _sectionLabel('\u{1F3A8} Brand / Primary Color')
      + '<div class="panel" style="margin-bottom:14px"><div class="modal-body">'
      + '<p style="font-size:12px;color:var(--muted,#64748b);margin:0 0 12px">Apni brand color choose karein \u2014 sirf topnav, buttons, aur active states mein lagegi.</p>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">'
      + _PRESET_COLORS.map(function(c){
          var isActive = (c.hex.toLowerCase() === currentColor.toLowerCase());
          return '<button onclick="ERP.settings._setColor(\'' + c.hex + '\')" title="' + _escAttr(c.name) + '" '
            + 'style="width:34px;height:34px;border-radius:50%;background:' + c.hex + ';border:' + (isActive ? '3px solid #0f172a' : '2px solid #e2e8f0') + ';cursor:pointer;box-shadow:' + (isActive ? '0 0 0 2px '+c.hex+',0 0 0 4px #fff' : 'none') + ';transition:all .15s"></button>';
        }).join('')
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:10px">'
      + '<label style="font-size:12px;font-weight:600;color:var(--muted)">Custom Color:</label>'
      + '<input type="color" id="sets-color-hex-themes-picker" value="' + currentColor + '" style="width:44px;height:36px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;padding:2px" oninput="ERP.settings._setColor(this.value)">'
      + '<span id="sets-color-hex-themes" style="font-size:12px;font-family:monospace;color:var(--muted,#64748b)">' + currentColor + '</span>'
      + '<button class="btn btn-ghost" style="font-size:12px" onclick="ERP.settings._resetColor()">\u21A9\uFE0F Reset Default</button>'
      + '</div>'
      + '</div></div>'

      + _sectionLabel('\u{1F524} Font & Density')
      + '<div class="panel" style="margin-bottom:14px"><div class="modal-body" style="display:grid;gap:14px">'
      + '<div>'
      + '<label style="font-size:12px;font-weight:600;color:var(--muted);display:block;margin-bottom:8px">UI Density</label>'
      + '<div style="display:flex;gap:10px">'
      + _densityBtn('compact',  '\u2B1B Compact',  'Zyada rows ek screen mein', savedDensity === 'compact')
      + _densityBtn('normal',   '\u25A3 Normal',   'Default spacing', savedDensity === 'normal')
      + _densityBtn('spacious', '\u25A1 Spacious', 'Airy, easy to read', savedDensity === 'spacious')
      + '</div>'
      + '</div>'
      + '<div>'
      + '<label style="font-size:12px;font-weight:600;color:var(--muted);display:block;margin-bottom:8px">Font Size</label>'
      + '<div style="display:flex;gap:10px">'
      + _fontSizeBtn('sm', 'Small (13px)', savedFontSize === 'sm')
      + _fontSizeBtn('md', 'Medium (14px)', savedFontSize === 'md')
      + _fontSizeBtn('lg', 'Large (15px)', savedFontSize === 'lg')
      + '</div>'
      + '</div>'
      + '</div></div>';
  }

  if (typeof ERP.registerRenderer === 'function') {
    ERP.registerRenderer('themes', _renderThemesPage);
  }

  ERP.settings = ERP.settings || {};
  Object.assign(ERP.settings, {
    updateHeader:     _updateHeader,
    saveBiz:          _settingsService.saveBiz.bind(_settingsService),
    _saveBiz:           _saveBiz,
    _savePayment:       _savePayment,
    _saveAppSettings:   _saveAppSettings,
    _saveSecuritySettings: _saveSecuritySettings,
    _handleLogoUpload:  _handleLogoUpload,
    _clearLogo:         _clearLogo,
    _switchTab:         _switchTab,
    _setDisplayMode:    _setDisplayMode,
    _setColor:          _setColor,
    _resetColor:        _resetColor,
    _setDensity:        _setDensity,
    _setFontSize:       _setFontSize,
    _showAddUser:       _showAddUser,
    _hideAddUser:       _hideAddUser,
    _addUser:           _addUser,
    _deleteUser:        _deleteUser,
    _toggleRole:        _toggleRole,
    _showChangePass:    _showChangePass,
    _showMyPassword:    _showMyPassword,
    _doChangePass:      _doChangePass,
    _toggleFlag:        _toggleFlag,
    _resetFlags:        _resetFlags,
    _updateFlagToggleUI: _updateFlagToggleUI,
    _applyFlagSideEffect: _applyFlagSideEffect,
    _applyMultiTabCoordinator: _applyMultiTabCoordinator,
    _clearAll:          _clearAll,
    _clearTransactions: _clearTransactions,
    clearAll:           _clearAll,
    clearTransactions:  _clearTransactions,
    _showHealthStatus:  _showHealthStatus,
    render:             render
  });

  var _settingsActions = {
    render:             render,
    saveBiz:            _saveBiz,
    savePayment:        _savePayment,
    saveAppSettings:    _saveAppSettings,
    clearAll:           _clearAll,
    clearTransactions:  _clearTransactions
  };

  ERP._services          = ERP._services || {};
  ERP._services.settings = _settingsService;
  ERP.actions            = ERP.actions    || {};
  ERP.actions.settings   = _settingsActions;

  (function _bootPrefs(){
    try {
      var d  = localStorage.getItem('mh_density');
      var f  = localStorage.getItem('mh_fontsize');
      var dk = localStorage.getItem('mh_dark');
      var sizes  = { compact:'12px', normal:'14px', spacious:'15px' };
      var fsizes = { sm:'13px', md:'14px', lg:'15px' };

      if (d && sizes[d])   document.body.style.fontSize = sizes[d];
      else if (f && fsizes[f]) document.body.style.fontSize = fsizes[f];

      if (dk === '1') {
        document.body.classList.add('dark');
        var root = document.documentElement;
        root.style.setProperty('--bg',       '#0f172a');
        root.style.setProperty('--surface',  '#1e293b');
        root.style.setProperty('--border-l', '#334155');
        root.style.setProperty('--text',     '#f1f5f9');
        root.style.setProperty('--muted',    '#94a3b8');
      }

      var st = parseInt(localStorage.getItem('mh_session_timeout'));
      var pt = parseInt(localStorage.getItem('mh_pin_timeout'));
      var ps = localStorage.getItem('mh_pin_on_startup') === '1';
      if (!isNaN(st) || !isNaN(pt)) {
        try {
          setState(function(s){
            if (!s.settings) s.settings = {};
            if (!isNaN(st)) s.settings.sessionTimeout = st;
            if (!isNaN(pt)) s.settings.pinTimeout     = pt;
            s.settings.pinOnStartup = ps;
          });
        } catch(e){ if(window.console&&console.error) console.error(e); }
      }
    } catch(e){ if(window.console&&console.error) console.error(e); }
  }());

  if (ERP.registerRenderer) {
    ERP.registerRenderer('settings', function () {
      render();
      try {
        var hash = window.location.hash || '';
        var m = hash.match(/#settings:([a-z]+)/);
        if (m && document.getElementById('sets-pnl-' + m[1])) {
          setTimeout(function(){ _switchTab(m[1]); }, 60);
        }
      } catch(e){ if(window.console&&console.error) console.error(e); }
    });
  }

  (function _bootMultiTab() {
    try {
      if (ERP.FeatureFlags && ERP.FeatureFlags.get('multi_tab_coordinator')) {
        _applyMultiTabCoordinator(true);
      }
    } catch(e) { if(window.console&&console.error) console.error(e); }
  }());

  (function _bindFlagChangedEvent() {
    try {
      if (ERP.EventBus && ERP.EventBus.on) {
        ERP.EventBus.on('flag:changed', function (data) {
          try {
            var flagsPanel = document.getElementById('sets-pnl-flags');
            if (flagsPanel && flagsPanel.style.display !== 'none' && data && data.flag) {
              _updateFlagToggleUI(data.flag, !!data.newValue);
            }
          } catch (e) { if(window.console&&console.error) console.error(e); }
        });
      }
    } catch(e) { if(window.console&&console.error) console.error(e); }
  }());

})(ERP);

window.ERP = ERP;
