'use strict';

var ERP = window.ERP || {};

(function (ERP) {

  var _getState = function () {
    return (ERP._internal && ERP._internal.getState) ? ERP._internal.getState() : {};
  };

  var _setState = function (fn, tag) {
    if (ERP._internal && ERP._internal.setState) ERP._internal.setState(fn, tag);
  };

  function _esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\//g, '&#x2F;')
      .replace(/`/g, '&#96;');
  }

  function _escNum(v) {
    var n = Number(v);
    return isNaN(n) ? _esc(v) : String(n);
  }

  function _fmtNum(v) {
    var n = Number(v);
    return isNaN(n) ? '0' : n.toLocaleString('en-PK');
  }

  var _THERMAL_WIDTHS = { '2inch': 384, '3inch': 576, '4inch': 768 };
  var _DEFAULT_THERMAL_SIZE = '3inch';

  var _printerService = {

    get: function () {
      var biz = (_getState().biz) || {};
      var size = biz.printerSize || _DEFAULT_THERMAL_SIZE;
      var tw = biz.thermalWidth;
      if (tw == null || isNaN(tw)) {
        tw = _THERMAL_WIDTHS[size] || 576;
      }
      return {
        printerType:       biz.printerType       || 'thermal',
        printerSize:       size,
        thermalWidth:      tw,
        defaultPrintMode:  biz.defaultPrintMode  || 'auto',
        autoPrint:         biz.autoPrint         !== false,
        showLogoOnPrint:   biz.showLogoOnPrint   !== false,
        showQROnPrint:     biz.showQROnPrint     !== false,
        thermalFooter:     biz.thermalFooter     || 'Thank you!',
        thermalHeader:     biz.thermalHeader     || '',
        paperMargin:       biz.paperMargin       || 'normal',
        paperOrientation:  biz.paperOrientation  || 'portrait',
        printCopies:       biz.printCopies       || 1,
        printLanguage:     biz.printLanguage     || 'en',
        thermalFontSize:   biz.thermalFontSize   || 'medium',
        invoiceTemplate:   biz.invoiceTemplate   || 'modern',
        dateFormat:        biz.dateFormat        || 'dd/mm/yyyy',
        showStampOnPrint:  biz.showStampOnPrint  !== false,
        showSignatureBox:  biz.showSignatureBox  === true,
        connectionType:    biz.connectionType    || 'default',
        networkPrinterIP:  biz.networkPrinterIP  || ''
      };
    },

    save: function (patch) {
      var perm = (window.ERP && ERP.UserLifecycle && ERP.UserLifecycle.check && ERP.UserLifecycle.check('change_settings')) || {};
      if (!perm.allowed) {
        if (ERP.ui && ERP.ui.toast) ERP.ui.toast('Only Admin can change printer settings.', 'error', 5000);
        return false;
      }
      if (patch.printerType === 'thermal' && patch.printerSize) {
        patch.thermalWidth = _THERMAL_WIDTHS[patch.printerSize] || 576;
      }
      if (ERP.settings && ERP.settings.saveBiz) {
        ERP.settings.saveBiz(patch);
      }
      _setState(function (s) {
        s.biz = s.biz || {};
        Object.assign(s.biz, patch);
      }, 'printer:save');
      var records = Object.keys(patch).map(function (k) {
        return { key: 'biz.' + k, value: patch[k] };
      });
      if (ERP._db && ERP._db.save) {
        Promise.all(records.map(function (r) { return ERP._db.save('settings', r); }))
          .then(function () {
            if (ERP.ui && ERP.ui.toast) ERP.ui.toast('Printer settings saved!', 'success');
          })
          .catch(function (e) {
            console.warn('[printer:save]', e);
            if (ERP.ui && ERP.ui.toast) ERP.ui.toast('Settings saved locally but DB sync failed.', 'warning', 4000);
          });
      } else {
        if (ERP.ui && ERP.ui.toast) ERP.ui.toast('Printer settings saved!', 'success');
      }
      return true;
    }
  };

  function _stepTab(num, label, icon, active) {
    return '<div style="flex:1;padding:8px 4px;text-align:center;background:' + (active ? '#4338CA' : '#f8fafc') + ';color:' + (active ? '#fff' : '#94a3b8') + '">'
      + '<div style="font-size:14px">' + icon + '</div>'
      + '<div style="font-size:10px;font-weight:700;margin-top:2px">' + label + '</div>'
      + '</div>';
  }

  function _typeCard(val, label, icon, sub, active) {
    var border = active ? '2px solid #4338CA' : '2px solid #e2e8f0';
    var bg = active ? 'rgba(27,79,140,.07)' : '#fff';
    var shadow = active ? '0 2px 12px rgba(27,79,140,.15)' : '0 1px 3px rgba(0,0,0,.04)';
    var lblColor = active ? '#4338CA' : '#0f172a';
    var badge = active ? '<div data-prt-badge style="margin-top:6px;font-size:9px;background:#4338CA;color:#fff;border-radius:10px;padding:2px 8px;display:inline-block;font-weight:700">ACTIVE</div>' : '';
    return '<div data-prt-type="' + val + '" onclick="ERP.printer._selectType(\'' + val + '\')" '
      + 'style="border:' + border + ';border-radius:12px;padding:16px 10px;cursor:pointer;text-align:center;transition:all .15s;background:' + bg + ';box-shadow:' + shadow + '">'
      + '<div style="font-size:30px;margin-bottom:8px">' + icon + '</div>'
      + '<div data-prt-label style="font-size:13px;font-weight:700;color:' + lblColor + '">' + label + '</div>'
      + '<div style="font-size:11px;color:#94a3b8;margin-top:3px">' + sub + '</div>'
      + badge
      + '</div>';
  }

  function _connCard(val, label, sub, current) {
    var active = (val === current);
    return '<div data-prt-conn="' + val + '" onclick="ERP.printer._selectConn(\'' + val + '\')" '
      + 'style="border:2px solid ' + (active ? '#4338CA' : '#e2e8f0') + ';border-radius:10px;padding:10px 6px;cursor:pointer;text-align:center;transition:all .15s;background:' + (active ? 'rgba(27,79,140,.07)' : '#fff') + '">'
      + '<div style="font-size:14px;font-weight:700;color:' + (active ? '#4338CA' : '#0f172a') + '">' + label + '</div>'
      + '<div style="font-size:10px;color:#94a3b8;margin-top:2px">' + sub + '</div>'
      + '</div>';
  }

  function _sizeBtn(val, label, current) {
    var active = (val === current);
    return '<button data-prt-size="' + val + '" onclick="ERP.printer._selectSize(\'' + val + '\')" '
      + 'style="flex:1;padding:12px 6px;border:2px solid ' + (active ? '#4338CA' : '#e2e8f0') + ';'
      + 'border-radius:10px;background:' + (active ? 'rgba(27,79,140,.07)' : '#fff') + ';'
      + 'font-size:11px;font-weight:' + (active ? '700' : '500') + ';'
      + 'color:' + (active ? '#4338CA' : '#475569') + ';cursor:pointer;white-space:pre-line;line-height:1.6;transition:all .15s">'
      + label + '</button>';
  }

  function _fontBtn(val, label, sub, current) {
    var active = (val === current);
    return '<div data-prt-font="' + val + '" onclick="ERP.printer._selectFont(\'' + val + '\')" '
      + 'style="flex:1;padding:10px 8px;border:2px solid ' + (active ? '#4338CA' : '#e2e8f0') + ';'
      + 'border-radius:10px;background:' + (active ? 'rgba(27,79,140,.07)' : '#fff') + ';cursor:pointer;text-align:center;transition:all .15s">'
      + '<div style="font-size:13px;font-weight:700;color:' + (active ? '#4338CA' : '#0f172a') + '">' + label + '</div>'
      + '<div style="font-size:10px;color:#94a3b8;margin-top:2px">' + sub + '</div>'
      + '</div>';
  }

  function _marginBtn(val, label, current) {
    var active = (val === current);
    return '<button data-prt-margin="' + val + '" onclick="ERP.printer._selectMargin(\'' + val + '\')" '
      + 'style="flex:1;padding:10px 6px;border:2px solid ' + (active ? '#4338CA' : '#e2e8f0') + ';'
      + 'border-radius:10px;background:' + (active ? 'rgba(27,79,140,.07)' : '#fff') + ';'
      + 'font-size:12px;font-weight:' + (active ? '700' : '500') + ';'
      + 'color:' + (active ? '#4338CA' : '#475569') + ';cursor:pointer;transition:all .15s">'
      + label + '</button>';
  }

  function _orientBtn(val, label, sub, current) {
    var active = (val === current);
    return '<div data-prt-orient="' + val + '" onclick="ERP.printer._selectOrient(\'' + val + '\')" '
      + 'style="flex:1;padding:10px 8px;border:2px solid ' + (active ? '#4338CA' : '#e2e8f0') + ';'
      + 'border-radius:10px;background:' + (active ? 'rgba(27,79,140,.07)' : '#fff') + ';cursor:pointer;text-align:center;transition:all .15s">'
      + '<div style="font-size:13px;font-weight:700;color:' + (active ? '#4338CA' : '#0f172a') + '">' + label + '</div>'
      + '<div style="font-size:10px;color:#94a3b8;margin-top:2px">' + sub + '</div>'
      + '</div>';
  }

  function _templateCard(val, icon, label, sub, current) {
    var active = (val === current);
    return '<div data-prt-tmpl="' + val + '" onclick="ERP.printer._selectTemplate(\'' + val + '\')" '
      + 'style="border:2px solid ' + (active ? '#4338CA' : '#e2e8f0') + ';border-radius:10px;padding:10px 6px;cursor:pointer;text-align:center;background:' + (active ? 'rgba(27,79,140,.07)' : '#fff') + ';transition:all .15s">'
      + '<div style="font-size:22px">' + icon + '</div>'
      + '<div style="font-size:12px;font-weight:700;color:' + (active ? '#4338CA' : '#0f172a') + ';margin-top:4px">' + label + '</div>'
      + '<div style="font-size:10px;color:#94a3b8;margin-top:2px">' + sub + '</div>'
      + '</div>';
  }

  function _langBtn(val, label, sub, current) {
    var active = (val === current);
    return '<div data-prt-lang="' + val + '" onclick="ERP.printer._selectLang(\'' + val + '\')" '
      + 'style="flex:1;padding:10px 8px;border:2px solid ' + (active ? '#4338CA' : '#e2e8f0') + ';'
      + 'border-radius:10px;background:' + (active ? 'rgba(27,79,140,.07)' : '#fff') + ';cursor:pointer;text-align:center;transition:all .15s">'
      + '<div style="font-size:13px;font-weight:700;color:' + (active ? '#4338CA' : '#0f172a') + '">' + label + '</div>'
      + '<div style="font-size:10px;color:#94a3b8;margin-top:2px">' + sub + '</div>'
      + '</div>';
  }

  function _dateBtn(val, preview, current) {
    var active = (val === current);
    return '<button data-prt-date="' + val + '" onclick="ERP.printer._selectDate(\'' + val + '\')" '
      + 'style="padding:8px 14px;border:2px solid ' + (active ? '#4338CA' : '#e2e8f0') + ';'
      + 'border-radius:8px;background:' + (active ? 'rgba(27,79,140,.07)' : '#fff') + ';'
      + 'font-size:12px;font-weight:' + (active ? '700' : '500') + ';'
      + 'color:' + (active ? '#4338CA' : '#475569') + ';cursor:pointer;transition:all .15s">'
      + preview + '</button>';
  }

  function _modeBtn(val, label, sub, current) {
    var active = (val === current);
    return '<div data-prt-mode="' + val + '" onclick="ERP.printer._selectMode(\'' + val + '\')" '
      + 'style="flex:1;padding:10px 8px;border:2px solid ' + (active ? '#4338CA' : '#e2e8f0') + ';'
      + 'border-radius:10px;background:' + (active ? 'rgba(27,79,140,.07)' : '#fff') + ';cursor:pointer;text-align:center;transition:all .15s">'
      + '<div style="font-size:13px;font-weight:700;color:' + (active ? '#4338CA' : '#0f172a') + '">' + label + '</div>'
      + '<div style="font-size:10px;color:#94a3b8;margin-top:3px">' + sub + '</div>'
      + '</div>';
  }

  function _copiesBtn(val, label, sub, current) {
    var active = (val === current);
    return '<div data-prt-copies="' + val + '" onclick="ERP.printer._selectCopies(' + val + ')" '
      + 'style="flex:1;padding:10px 8px;border:2px solid ' + (active ? '#4338CA' : '#e2e8f0') + ';'
      + 'border-radius:10px;background:' + (active ? 'rgba(27,79,140,.07)' : '#fff') + ';cursor:pointer;text-align:center;transition:all .15s">'
      + '<div style="font-size:20px;font-weight:900;color:' + (active ? '#4338CA' : '#0f172a') + '">' + val + '</div>'
      + '<div style="font-size:12px;font-weight:700;color:' + (active ? '#4338CA' : '#475569') + '">' + label + '</div>'
      + '<div style="font-size:10px;color:#94a3b8;margin-top:2px">' + sub + '</div>'
      + '</div>';
  }

  function _toggle(id, val, label, hint) {
    return '<label style="display:flex;align-items:flex-start;gap:12px;cursor:pointer;padding:8px 10px;border-radius:8px;border:1px solid #f1f5f9;background:#fafbfc;transition:background .1s" onmouseover="this.style.background=\'#f0f9ff\'" onmouseout="this.style.background=\'#fafbfc\'">'
      + '<input type="checkbox" id="' + id + '" ' + (val ? 'checked' : '') + ' '
      + 'style="width:16px;height:16px;accent-color:#4338CA;margin-top:2px;flex-shrink:0">'
      + '<span style="display:grid;gap:2px">'
      + '<span style="font-size:13px;font-weight:600;color:#0f172a">' + label + '</span>'
      + '<span style="font-size:11px;color:#94a3b8">' + hint + '</span>'
      + '</span>'
      + '</label>';
  }

  var _sel = {};

  function _bindTypeCards() {
    var cfg = _printerService.get();
    _sel.type       = cfg.printerType;
    _sel.size       = cfg.printerSize;
    _sel.margin     = cfg.paperMargin;
    _sel.orient     = cfg.paperOrientation;
    _sel.mode       = cfg.defaultPrintMode;
    _sel.copies     = cfg.printCopies;
    _sel.lang       = cfg.printLanguage;
    _sel.font       = cfg.thermalFontSize;
    _sel.template   = cfg.invoiceTemplate;
    _sel.date       = cfg.dateFormat;
    _sel.conn       = cfg.connectionType;
  }

  function _activeStyle(el, isActive) {
    el.style.border = '2px solid ' + (isActive ? '#4338CA' : '#e2e8f0');
    el.style.background = isActive ? 'rgba(27,79,140,.07)' : '#fff';
  }

  function _updateTypeLabel(val) {
    var labelMap = { 'thermal': 'Thermal / POS', 'a4': 'A4 Paper', 'a5': 'A5 Paper' };
    var labelEl = document.getElementById('prt-type-label');
    if (labelEl) labelEl.textContent = (labelMap[val] || 'Unknown') + ' — Active';
  }

  function _updatePixelInfo(val) {
    var infoEl = document.getElementById('prt-pixel-info');
    if (!infoEl) return;
    var map = { '2inch': '384px', '3inch': '576px', '4inch': '768px' };
    var html = 'Pixels: ';
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var isSel = (k === val);
      html += (isSel ? '<b style="color:#4338CA">' : '') + k.replace('inch', '\"') + '=' + map[k] + (isSel ? '</b>' : '');
      if (i < keys.length - 1) html += ' · ';
    }
    infoEl.innerHTML = html;
  }

  function _selectType(val) {
    _sel.type = val;
    var isThermal = (val === 'thermal');
    document.querySelectorAll('[data-prt-type]').forEach(function (el) {
      var a = el.getAttribute('data-prt-type') === val;
      _activeStyle(el, a);
      var lbl = el.querySelector('[data-prt-label]');
      if (lbl) lbl.style.color = a ? '#4338CA' : '#0f172a';
      var badge = el.querySelector('[data-prt-badge]');
      if (badge) badge.style.display = a ? 'inline-block' : 'none';
    });
    _updateTypeLabel(val);
    var pnlT = document.getElementById('pnl-thermal');
    var pnlP = document.getElementById('pnl-paper');
    var prevT = document.getElementById('prt-prev-thermal');
    var prevA = document.getElementById('prt-prev-a4');
    if (pnlT) pnlT.style.display = isThermal ? '' : 'none';
    if (pnlP) pnlP.style.display = isThermal ? 'none' : '';
    if (prevT) prevT.style.display = isThermal ? '' : 'none';
    if (prevA) prevA.style.display = isThermal ? 'none' : '';
  }

  function _selectConn(val) {
    _sel.conn = val;
    document.querySelectorAll('[data-prt-conn]').forEach(function (el) {
      _activeStyle(el, el.getAttribute('data-prt-conn') === val);
    });
    var ipPnl = document.getElementById('pnl-network-ip');
    if (ipPnl) ipPnl.style.display = (val === 'network') ? '' : 'none';
  }

  function _selectSize(val) {
    _sel.size = val;
    document.querySelectorAll('[data-prt-size]').forEach(function (el) {
      var a = el.getAttribute('data-prt-size') === val;
      _activeStyle(el, a);
      el.style.color = a ? '#4338CA' : '#475569';
      el.style.fontWeight = a ? '700' : '500';
    });
    _updatePixelInfo(val);
  }

  function _selectFont(val) {
    _sel.font = val;
    document.querySelectorAll('[data-prt-font]').forEach(function (el) {
      _activeStyle(el, el.getAttribute('data-prt-font') === val);
    });
  }

  function _selectMargin(val) {
    _sel.margin = val;
    document.querySelectorAll('[data-prt-margin]').forEach(function (el) {
      var a = el.getAttribute('data-prt-margin') === val;
      _activeStyle(el, a);
      el.style.color = a ? '#4338CA' : '#475569';
    });
  }

  function _selectOrient(val) {
    _sel.orient = val;
    document.querySelectorAll('[data-prt-orient]').forEach(function (el) {
      _activeStyle(el, el.getAttribute('data-prt-orient') === val);
    });
  }

  function _selectTemplate(val) {
    _sel.template = val;
    document.querySelectorAll('[data-prt-tmpl]').forEach(function (el) {
      _activeStyle(el, el.getAttribute('data-prt-tmpl') === val);
    });
  }

  function _selectLang(val) {
    _sel.lang = val;
    document.querySelectorAll('[data-prt-lang]').forEach(function (el) {
      _activeStyle(el, el.getAttribute('data-prt-lang') === val);
    });
  }

  function _selectDate(val) {
    _sel.date = val;
    document.querySelectorAll('[data-prt-date]').forEach(function (el) {
      var a = el.getAttribute('data-prt-date') === val;
      _activeStyle(el, a);
      el.style.color = a ? '#4338CA' : '#475569';
      el.style.fontWeight = a ? '700' : '500';
    });
  }

  function _selectMode(val) {
    _sel.mode = val;
    document.querySelectorAll('[data-prt-mode]').forEach(function (el) {
      _activeStyle(el, el.getAttribute('data-prt-mode') === val);
    });
  }

  function _selectCopies(val) {
    _sel.copies = val;
    document.querySelectorAll('[data-prt-copies]').forEach(function (el) {
      _activeStyle(el, parseInt(el.getAttribute('data-prt-copies')) === val);
    });
  }

  function _validateIP(ip) {
    if (!ip) return true;
    var parts = ip.split('.');
    if (parts.length !== 4) return false;
    for (var i = 0; i < 4; i++) {
      var n = parseInt(parts[i], 10);
      if (isNaN(n) || n < 0 || n > 255 || String(n) !== parts[i]) return false;
    }
    return true;
  }

  function _save() {
    var cfg    = _printerService.get();
    var type   = _sel.type     || cfg.printerType;
    var size   = _sel.size     || cfg.printerSize;
    var margin = _sel.margin   || cfg.paperMargin;
    var orient = _sel.orient   || cfg.paperOrientation;
    var mode   = _sel.mode     || cfg.defaultPrintMode;
    var copies = _sel.copies   || cfg.printCopies;
    var lang   = _sel.lang     || cfg.printLanguage;
    var font   = _sel.font     || cfg.thermalFontSize;
    var tmpl   = _sel.template || cfg.invoiceTemplate;
    var datefmt = _sel.date    || cfg.dateFormat;
    var conn   = _sel.conn     || cfg.connectionType;

    var footerEl  = document.getElementById('prt-thermal-footer');
    var headerEl  = document.getElementById('prt-thermal-header');
    var networkEl = document.getElementById('prt-network-ip');
    var autoEl    = document.getElementById('prt-auto-print');
    var logoEl    = document.getElementById('prt-logo-print');
    var qrEl      = document.getElementById('prt-qr-print');
    var stampEl   = document.getElementById('prt-stamp-print');
    var sigEl     = document.getElementById('prt-signature-box');

    var networkIP = networkEl ? networkEl.value.trim() : cfg.networkPrinterIP;
    if (conn === 'network' && networkIP && !_validateIP(networkIP)) {
      if (ERP.ui && ERP.ui.toast) ERP.ui.toast('Invalid IP address format.', 'error', 4000);
      return;
    }

    var patch = {
      printerType:       type,
      printerSize:       size,
      defaultPrintMode:  mode,
      autoPrint:         autoEl    ? autoEl.checked  : cfg.autoPrint,
      showLogoOnPrint:   logoEl    ? logoEl.checked  : cfg.showLogoOnPrint,
      showQROnPrint:     qrEl      ? qrEl.checked    : cfg.showQROnPrint,
      showStampOnPrint:  stampEl   ? stampEl.checked : cfg.showStampOnPrint,
      showSignatureBox:  sigEl     ? sigEl.checked   : cfg.showSignatureBox,
      thermalFooter:     footerEl  ? footerEl.value.trim()  : cfg.thermalFooter,
      thermalHeader:     headerEl  ? headerEl.value.trim()  : cfg.thermalHeader,
      paperMargin:       margin,
      paperOrientation:  orient,
      printCopies:       copies,
      printLanguage:     lang,
      thermalFontSize:   font,
      invoiceTemplate:   tmpl,
      dateFormat:        datefmt,
      connectionType:    conn,
      networkPrinterIP:  networkIP
    };

    if (type === 'thermal') {
      patch.thermalWidth = _THERMAL_WIDTHS[size] || 576;
    } else {
      patch.thermalWidth = null;
    }

    var ok = _printerService.save(patch);
    if (ok) { setTimeout(render, 300); }
  }

  function _resetDefaults() {
    var _prtConfirm = (window.ERP && typeof window.ERP.confirmDialog === 'function' && window.ERP.confirmDialog) || function(msg, ok) { if (window.confirm(msg)) ok(); };
    _prtConfirm('Printer settings default par reset karen?', function() {
      _printerService.save({
        printerType:       'thermal',
        printerSize:       '3inch',
        thermalWidth:      576,
        defaultPrintMode:  'auto',
        autoPrint:         true,
        showLogoOnPrint:   true,
        showQROnPrint:     true,
        showStampOnPrint:  true,
        showSignatureBox:  false,
        thermalFooter:     'Thank you!',
        thermalHeader:     '',
        paperMargin:       'normal',
        paperOrientation:  'portrait',
        printCopies:       1,
        printLanguage:     'en',
        thermalFontSize:   'medium',
        invoiceTemplate:   'modern',
        dateFormat:        'dd/mm/yyyy',
        connectionType:    'default',
        networkPrinterIP:  ''
      });
      setTimeout(render, 300);
    });
  }

  function _showSummary() {
    var cfg = _printerService.get();
    var rows = [
      ['Printer Type',       cfg.printerType],
      ['Paper Size',         cfg.printerType === 'thermal' ? cfg.printerSize : cfg.printerType.toUpperCase()],
      ['Connection',         cfg.connectionType],
      ['Print Mode',         cfg.defaultPrintMode],
      ['Copies',             cfg.printCopies],
      ['Language',           cfg.printLanguage],
      ['Font Size',          cfg.thermalFontSize],
      ['Invoice Template',   cfg.invoiceTemplate],
      ['Date Format',        cfg.dateFormat],
      ['Orientation',        cfg.paperOrientation],
      ['Auto Print',         cfg.autoPrint ? 'On' : 'Off'],
      ['Show Logo',          cfg.showLogoOnPrint ? 'On' : 'Off'],
      ['Show QR',            cfg.showQROnPrint ? 'On' : 'Off'],
      ['PAID Stamp',         cfg.showStampOnPrint ? 'On' : 'Off'],
      ['Signature Box',      cfg.showSignatureBox ? 'On' : 'Off'],
      ['Header',             cfg.thermalHeader || '(none)'],
      ['Footer',             cfg.thermalFooter]
    ];

    var tableRows = rows.map(function (r) {
      return '<tr><td style="padding:7px 12px;font-size:12px;font-weight:600;color:#64748b;white-space:nowrap">' + r[0] + '</td>'
        + '<td style="padding:7px 12px;font-size:13px;font-weight:700;color:#0f172a">' + _esc(r[1]) + '</td></tr>';
    }).join('');

    var pw = window.open('', '_blank', 'width=420,height=600');
    if (!pw) { if (ERP.ui && ERP.ui.toast) ERP.ui.toast('Pop-ups blocked', 'error', 3000); return; }
    pw.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Printer Config Summary</title>'
      + '<style>body{font-family:Segoe UI,sans-serif;background:#f8fafc;margin:0;padding:20px}'
      + 'table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}'
      + 'tr:nth-child(even){background:#f8fafc}tr:hover{background:#f0f9ff}'
      + 'h2{color:#4338CA;font-size:16px;margin-bottom:16px}</style></head><body>'
      + '<h2>Printer Configuration Summary</h2>'
      + '<table>' + tableRows + '</table>'
      + '<p style="font-size:11px;color:#94a3b8;margin-top:14px;text-align:center">MH Autos ERP · Printer Module v2.1</p>'
      + '</body></html>');
    pw.document.close();
  }

  function _testThermal() {
    var cfg = _printerService.get();
    var biz = (_getState().biz) || {};
    var mockInv = {
      id: 'TEST-001', date: new Date().toLocaleDateString('en-PK'),
      customer: 'Ahmed Khan (Test)', ph: '0300-1234567', veh: 'ABC-123', paid: 3200,
      items: [
        { n: 'Engine Oil 5W-30',     q: 2, p: 1200, d: 0,  taxAmt: 0 },
        { n: 'Oil Filter',            q: 1, p:  350, d: 0,  taxAmt: 0 },
        { n: 'Labour / Workshop Fee', q: 1, p:  500, d: 50, taxAmt: 0 }
      ]
    };
    var printBiz = Object.assign({}, biz, {
      name:         biz.name    || 'MH Autos',
      addr:         biz.address || 'Karachi, Pakistan',
      phone:        biz.phone   || '021-XXXXXXX',
      thermalWidth: cfg.thermalWidth || 576
    });
    var html = '';
    if (ERP.sales && ERP.sales.buildThermalHTML) {
      html = ERP.sales.buildThermalHTML(mockInv, printBiz);
    } else {
      html = _fallbackThermalHTML(mockInv, printBiz, cfg);
    }
    _openPrintWindow(html, 'Thermal Preview (' + cfg.printerSize + ')',
      'width=' + (cfg.thermalWidth + 80) + ',height=700', '#fff', 'Thermal Receipt — Test Print');
  }

  function _testA4() {
    var cfg = _printerService.get();
    var biz = (_getState().biz) || {};
    var mockInv = {
      id: 'TEST-A4-001', date: new Date().toLocaleDateString('en-PK'),
      customer: 'Ahmed Khan (Test)',
      items: [
        { n: 'Engine Oil 5W-30', q: 2, p: 1200, d: 0,  taxAmt: 0 },
        { n: 'Oil Filter',        q: 1, p:  350, d: 0,  taxAmt: 0 },
        { n: 'Workshop Labour',   q: 1, p:  500, d: 50, taxAmt: 0 }
      ],
      paid: 3200
    };
    var html = (ERP.sales && ERP.sales.buildInvoiceHTML)
      ? ERP.sales.buildInvoiceHTML(mockInv, cfg.invoiceTemplate || 'modern', '#4338CA', biz)
      : _fallbackA4HTML(mockInv, biz, cfg);
    _openPrintWindow(html, 'A4 Preview', 'width=950,height=750', '#f3f4f6', 'A4 Invoice — Test Print');
  }

  function _openPrintWindow(html, title, dims, bg, pageTitle) {
    var pw = window.open('', '_blank', dims);
    if (!pw) {
      if (ERP.ui && ERP.ui.toast) ERP.ui.toast('Pop-ups blocked — please allow pop-ups for preview', 'error', 4000);
      return;
    }
    pw.document.write(
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + _esc(pageTitle || title || 'Print') + '</title>'
      + '<style>*{box-sizing:border-box;margin:0;padding:0}body{background:' + _esc(bg || '#fff') + ';padding:12px}'
      + '@media print{.no-print{display:none!important}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}'
      + '</style></head><body>'
      + '<div class="no-print" style="text-align:center;padding:12px 0 14px;display:flex;gap:8px;justify-content:center">'
      + '<button onclick="window.print()" style="background:#4338CA;color:#fff;border:none;padding:9px 22px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">Print / Save PDF</button>'
      + '<button onclick="window.close()" style="background:#64748b;color:#fff;border:none;padding:9px 16px;border-radius:8px;font-size:13px;cursor:pointer">Close</button>'
      + '<span style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d;border-radius:6px;padding:6px 12px;font-size:12px;font-weight:600">Test Print</span>'
      + '</div>'
      + html
      + '</body></html>'
    );
    pw.document.close();
    setTimeout(function () { try { pw.print(); } catch (e) { } }, 800);
  }

  function _fallbackThermalHTML(inv, biz, cfg) {
    var w   = cfg.thermalWidth || 576;
    var fs  = cfg.thermalFontSize === 'small' ? '10px' : cfg.thermalFontSize === 'large' ? '14px' : '12px';
    var items = Array.isArray(inv.items) ? inv.items : [];
    var sub = items.reduce(function (s, i) { return s + (Number(i.q || 0) * Number(i.p || 0) - Number(i.d || 0)); }, 0);
    var bal = Math.max(0, sub - Number(inv.paid || 0));
    var hdr = cfg.thermalHeader ? '<div style="text-align:center;font-size:10px;margin-bottom:4px">' + _esc(cfg.thermalHeader) + '</div>' : '';
    var stamp = (cfg.showStampOnPrint && inv.paid >= sub && sub > 0)
      ? '<div style="border:3px solid #166534;color:#166534;font-size:18px;font-weight:900;text-align:center;padding:4px;margin:8px 0;border-radius:4px;letter-spacing:4px">PAID</div>'
      : '';
    var itemsHtml = items.map(function (i) {
      var lineTotal = Number(i.q || 0) * Number(i.p || 0) - Number(i.d || 0);
      return _esc(i.n) + '<br>  ' + _escNum(i.q) + ' x ' + _escNum(i.p) + ' = <b>' + _fmtNum(lineTotal) + '</b>';
    }).join('<br>');
    return (
      '<div style="font-family:Courier New,monospace;font-size:' + fs + ';max-width:' + w + 'px;margin:0 auto;padding:8px;background:#fff;color:#000">'
      + '<div style="text-align:center;font-size:16px;font-weight:900;border-bottom:1px dashed #000;padding-bottom:6px;margin-bottom:4px">' + _esc(biz.name || 'Business Name') + '</div>'
      + hdr
      + '<div style="text-align:center;font-size:10px;margin-bottom:4px">' + _esc(biz.addr || '') + '<br>' + _esc(biz.phone || '') + '</div>'
      + '<div style="text-align:center;border-top:1px dashed #000;border-bottom:1px dashed #000;padding:3px 0;margin:4px 0;font-weight:700;font-size:11px">INVOICE ' + _esc(inv.id) + '</div>'
      + '<div style="font-size:11px;margin-bottom:4px">Cust: <b>' + _esc(inv.customer) + '</b><br>Date: ' + _esc(inv.date) + '</div>'
      + '<div style="border-top:1px dashed #000;padding-top:4px">'
      + itemsHtml
      + '</div>'
      + '<div style="border-top:1px dashed #000;margin-top:4px;padding-top:4px">'
      + '<div style="display:flex;justify-content:space-between;font-weight:900;font-size:14px;border-top:1px solid #000;padding-top:2px"><span>TOTAL:</span><span>' + _fmtNum(sub) + '</span></div>'
      + (inv.paid > 0 ? '<div style="display:flex;justify-content:space-between;color:#166534"><span>Paid:</span><span>' + _fmtNum(inv.paid) + '</span></div>' : '')
      + (bal > 0 ? '<div style="display:flex;justify-content:space-between;color:red;font-weight:700"><span>Balance:</span><span>' + _fmtNum(bal) + '</span></div>' : '')
      + '</div>'
      + stamp
      + (cfg.showSignatureBox ? '<div style="margin-top:12px;border-top:1px dashed #000;padding-top:4px;font-size:10px;text-align:center">Signature: _______________</div>' : '')
      + '<div style="text-align:center;margin-top:8px;font-size:10px;border-top:1px dashed #000;padding-top:4px">' + _esc(cfg.thermalFooter || 'Thank you!') + '</div>'
      + '</div>'
    );
  }

  function _fallbackA4HTML(inv, biz, cfg) {
    var items = Array.isArray(inv.items) ? inv.items : [];
    var sub  = items.reduce(function (s, i) { return s + (Number(i.q || 0) * Number(i.p || 0) - Number(i.d || 0)); }, 0);
    var bal  = Math.max(0, sub - Number(inv.paid || 0));
    var accentColors = { classic: '#0f172a', modern: '#4338CA', minimal: '#374151', bold: '#dc2626' };
    var accent = accentColors[cfg.invoiceTemplate] || '#4338CA';
    var stamp = (cfg.showStampOnPrint && inv.paid >= sub && sub > 0)
      ? '<div style="position:absolute;top:40px;right:40px;border:4px solid #166534;color:#166534;font-size:32px;font-weight:900;padding:8px 16px;border-radius:6px;letter-spacing:4px;transform:rotate(-15deg);opacity:.85">PAID</div>'
      : '';
    var itemsHtml = items.map(function (i, idx) {
      var lineTotal = Number(i.q || 0) * Number(i.p || 0) - Number(i.d || 0);
      return '<tr style="background:' + (idx % 2 === 0 ? '#fff' : '#f8fafc') + ';border-bottom:1px solid #f1f5f9">'
        + '<td style="padding:10px;font-size:13px">' + _esc(i.n) + '</td>'
        + '<td style="padding:10px;font-size:13px;text-align:right">' + _escNum(i.q) + '</td>'
        + '<td style="padding:10px;font-size:13px;text-align:right">' + _escNum(i.p) + '</td>'
        + '<td style="padding:10px;font-size:13px;font-weight:700;text-align:right">' + _fmtNum(lineTotal) + '</td></tr>';
    }).join('');
    return (
      '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:800px;margin:0 auto;background:#fff;padding:40px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.08);position:relative">'
      + stamp
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px">'
      + '<div><div style="font-size:26px;font-weight:900;color:' + accent + '">' + _esc(biz.name || 'Business Name') + '</div>'
      + (cfg.thermalHeader ? '<div style="font-size:12px;color:#64748b;margin-top:2px;font-style:italic">' + _esc(cfg.thermalHeader) + '</div>' : '')
      + '<div style="font-size:13px;color:#64748b;margin-top:4px">' + _esc(biz.address || '') + ' · ' + _esc(biz.phone || '') + '</div></div>'
      + '<div style="text-align:right"><div style="font-size:20px;font-weight:800;color:#0f172a">INVOICE</div>'
      + '<div style="font-size:13px;color:' + accent + ';font-weight:700">#' + _esc(inv.id) + '</div>'
      + '<div style="font-size:12px;color:#64748b">' + _esc(inv.date) + '</div></div>'
      + '</div>'
      + '<div style="margin-bottom:20px"><span style="font-size:12px;color:#64748b">Bill To: </span>'
      + '<span style="font-size:14px;font-weight:700">' + _esc(inv.customer) + '</span></div>'
      + '<table style="width:100%;border-collapse:collapse;margin-bottom:24px">'
      + '<thead><tr style="background:' + accent + ';color:#fff">'
      + '<th style="padding:10px;font-size:11px;text-align:left">ITEM</th>'
      + '<th style="padding:10px;font-size:11px;text-align:right">QTY</th>'
      + '<th style="padding:10px;font-size:11px;text-align:right">PRICE</th>'
      + '<th style="padding:10px;font-size:11px;text-align:right">AMOUNT</th></tr></thead>'
      + '<tbody>'
      + itemsHtml
      + '</tbody></table>'
      + '<div style="display:flex;justify-content:flex-end"><div style="min-width:220px">'
      + '<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:16px;font-weight:900;border-top:3px solid ' + accent + ';color:' + accent + '"><span>TOTAL</span><span>' + _fmtNum(sub) + '</span></div>'
      + (inv.paid > 0 ? '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#166534"><span>Paid</span><span>' + _fmtNum(inv.paid) + '</span></div>' : '')
      + (bal > 0 ? '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;font-weight:700;color:#dc2626"><span>Balance Due</span><span>' + _fmtNum(bal) + '</span></div>' : '')
      + '</div></div>'
      + (cfg.showSignatureBox ? '<div style="margin-top:40px;display:flex;justify-content:flex-end"><div style="border-top:1px solid #0f172a;width:200px;text-align:center;padding-top:4px;font-size:11px;color:#64748b">Authorized Signature</div></div>' : '')
      + '<div style="margin-top:32px;text-align:center;font-size:12px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:12px">' + _esc(cfg.thermalFooter || 'Thank you for your business!') + '</div>'
      + '</div>'
    );
  }

  function render() {
    var pv = document.getElementById('pv-printer');
    if (!pv) return;

    var cfg = _printerService.get();
    var isThermal = cfg.printerType === 'thermal';
    var isA4      = cfg.printerType === 'a4';
    var isA5      = cfg.printerType === 'a5';

    pv.innerHTML =
      '<div class="page-head">'
      + '<h1 class="page-title">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px"><use href="#ic-print"/></svg>'
      + ' Printer Configuration'
      + '</h1>'
      + '<span style="font-size:11px;background:linear-gradient(135deg,#4338CA,#0ea5e9);color:#fff;padding:3px 10px;border-radius:20px;font-weight:700;letter-spacing:.5px">v2.1 PRO</span>'
      + '</div>'

      + '<div style="padding:0 20px 28px;max-width:860px">'

      + '<div style="display:flex;gap:0;margin-bottom:20px;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">'
      + _stepTab('1', 'Hardware', '&#x1F5A8;', true)
      + _stepTab('2', 'Paper & Size', '&#x1F4D0;', false)
      + _stepTab('3', 'Content', '&#x1F4DD;', false)
      + _stepTab('4', 'Behaviour', '&#x2699;', false)
      + '</div>'

      + '<div style="margin-bottom:6px;font-size:11px;font-weight:800;color:#4338CA;text-transform:uppercase;letter-spacing:1px">Hardware Setup</div>'

      + '<div class="panel" style="margin-bottom:14px">'
      + '<div class="panel-head" style="display:flex;align-items:center;justify-content:space-between">'
      + '<span class="panel-title">Printer Type</span>'
      + '<span id="prt-type-label" style="font-size:10px;background:#f0f9ff;color:#0284c7;border:1px solid #bae6fd;padding:2px 8px;border-radius:20px;font-weight:700">'
      + (isThermal ? 'Thermal / POS' : (isA4 ? 'A4 Paper' : 'A5 Paper'))
      + ' — Active</span>'
      + '</div>'
      + '<div class="modal-body">'
      + '<p style="font-size:12px;color:#64748b;margin:0 0 14px">Apna printer type select karein. Thermal slip printers (POS) ya standard A4/A5 paper printers ke liye alag settings hain.</p>'
      + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:4px">'
      + _typeCard('thermal', 'Thermal / POS', '&#x1F9FE;', '2\" · 3\" · 4\" slip',   isThermal)
      + _typeCard('a4',      'A4 Paper',          '&#x1F4C4;', 'Standard full-page',   isA4)
      + _typeCard('a5',      'A5 Paper',          '&#x1F4CB;', 'Half-page compact',    isA5)
      + '</div>'
      + '</div></div>'

      + '<div class="panel" style="margin-bottom:14px">'
      + '<div class="panel-head"><span class="panel-title">Printer Connection</span></div>'
      + '<div class="modal-body">'
      + '<p style="font-size:12px;color:#64748b;margin:0 0 12px">Apna printer connection type select karein. Network printers ke liye IP address bhi darj karein.</p>'
      + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px">'
      + _connCard('default',   'Default',   'OS default printer',    cfg.connectionType)
      + _connCard('usb',       'USB',       'Direct USB cable',      cfg.connectionType)
      + _connCard('network',   'Network',   'LAN / WiFi printer',    cfg.connectionType)
      + _connCard('bluetooth', 'Bluetooth', 'Wireless BT printer',   cfg.connectionType)
      + '</div>'
      + '<div id="pnl-network-ip" style="' + (cfg.connectionType !== 'network' ? 'display:none' : '') + '">'
      + '<label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:5px">Network Printer IP Address</label>'
      + '<input class="a-input" id="prt-network-ip" type="text" placeholder="192.168.1.100" value="' + _esc(cfg.networkPrinterIP) + '" style="max-width:260px">'
      + '<p style="font-size:11px;color:#94a3b8;margin:4px 0 0">Format: 192.168.x.x — LAN mein printer ka IP address</p>'
      + '</div>'
      + '</div></div>'

      + '<div style="margin-bottom:6px;margin-top:4px;font-size:11px;font-weight:800;color:#4338CA;text-transform:uppercase;letter-spacing:1px">Paper & Size Settings</div>'

      + '<div id="pnl-thermal" class="panel" style="margin-bottom:14px;' + (!isThermal ? 'display:none' : '') + '">'
      + '<div class="panel-head"><span class="panel-title">Thermal Printer Settings</span></div>'
      + '<div class="modal-body" style="display:grid;gap:16px">'

      + '<div>'
      + '<label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:8px">Paper Width (Roll Size)</label>'
      + '<div style="display:flex;gap:10px">'
      + _sizeBtn('2inch', '2 Inch\n(58mm)', cfg.printerSize)
      + _sizeBtn('3inch', '3 Inch\n(80mm)', cfg.printerSize)
      + _sizeBtn('4inch', '4 Inch\n(112mm)', cfg.printerSize)
      + '</div>'
      + '<p id="prt-pixel-info" style="font-size:11px;color:#94a3b8;margin:6px 0 0"></p>'
      + '</div>'

      + '<div>'
      + '<label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:8px">Thermal Font Size</label>'
      + '<div style="display:flex;gap:10px">'
      + _fontBtn('small',  'Small',  'Zyada items fit hon', cfg.thermalFontSize)
      + _fontBtn('medium', 'Medium', 'Balanced (default)',  cfg.thermalFontSize)
      + _fontBtn('large',  'Large',  'Easy to read',        cfg.thermalFontSize)
      + '</div>'
      + '</div>'

      + '</div></div>'

      + '<div id="pnl-paper" class="panel" style="margin-bottom:14px;' + (isThermal ? 'display:none' : '') + '">'
      + '<div class="panel-head"><span class="panel-title">Paper Printer Settings</span></div>'
      + '<div class="modal-body" style="display:grid;gap:16px">'

      + '<div>'
      + '<label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:8px">Page Margins</label>'
      + '<div style="display:flex;gap:10px">'
      + _marginBtn('normal', 'Normal',    cfg.paperMargin)
      + _marginBtn('narrow', 'Narrow',    cfg.paperMargin)
      + _marginBtn('none',   'No Margin', cfg.paperMargin)
      + '</div>'
      + '</div>'

      + '<div>'
      + '<label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:8px">Page Orientation</label>'
      + '<div style="display:flex;gap:10px">'
      + _orientBtn('portrait',  'Portrait',  'Vertical (default)', cfg.paperOrientation)
      + _orientBtn('landscape', 'Landscape', 'Horizontal',         cfg.paperOrientation)
      + '</div>'
      + '</div>'

      + '<div>'
      + '<label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:8px">Invoice Template Style</label>'
      + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">'
      + _templateCard('classic', '&#x1F3DB;',  'Classic',  'Traditional layout',   cfg.invoiceTemplate)
      + _templateCard('modern',  '&#x2728;',  'Modern',   'Clean & professional',  cfg.invoiceTemplate)
      + _templateCard('minimal', '&#x2B1C;',  'Minimal',  'Simple & fast',         cfg.invoiceTemplate)
      + _templateCard('bold',    '&#x1F4AA;',  'Bold',     'High contrast colors',  cfg.invoiceTemplate)
      + '</div>'
      + '</div>'

      + '</div></div>'

      + '<div style="margin-bottom:6px;margin-top:4px;font-size:11px;font-weight:800;color:#4338CA;text-transform:uppercase;letter-spacing:1px">Content & Language</div>'

      + '<div class="panel" style="margin-bottom:14px">'
      + '<div class="panel-head"><span class="panel-title">Language & Format</span></div>'
      + '<div class="modal-body" style="display:grid;gap:16px">'

      + '<div>'
      + '<label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:8px">Print Language</label>'
      + '<div style="display:flex;gap:10px">'
      + _langBtn('en',   'English', 'English only',          cfg.printLanguage)
      + _langBtn('ur',   'Urdu',    'Urdu sirf',             cfg.printLanguage)
      + _langBtn('both', 'Both',     'English + Urdu labels', cfg.printLanguage)
      + '</div>'
      + '</div>'

      + '<div>'
      + '<label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:8px">Date Format</label>'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap">'
      + _dateBtn('dd/mm/yyyy',   '25/05/2026',      cfg.dateFormat)
      + _dateBtn('mm/dd/yyyy',   '05/25/2026',      cfg.dateFormat)
      + _dateBtn('dd-Mon-yyyy',  '25-May-2026',     cfg.dateFormat)
      + '</div>'
      + '</div>'

      + '</div></div>'

      + '<div class="panel" style="margin-bottom:14px">'
      + '<div class="panel-head"><span class="panel-title">Receipt / Invoice Content</span></div>'
      + '<div class="modal-body" style="display:grid;gap:14px">'

      + '<div>'
      + '<label for="prt-thermal-header" style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:5px">Receipt Header / Tagline</label>'
      + '<input class="a-input" id="prt-thermal-header" type="text" maxlength="80" placeholder="e.g. Best Service in Town" value="' + _esc(cfg.thermalHeader) + '">'
      + '<p style="font-size:11px;color:#94a3b8;margin:4px 0 0">Business name ke neeche tagline / slogan print hoga (optional)</p>'
      + '</div>'

      + '<div>'
      + '<label for="prt-thermal-footer" style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:5px">Receipt Footer Text</label>'
      + '<input class="a-input" id="prt-thermal-footer" type="text" maxlength="120" placeholder="Thank you!" value="' + _esc(cfg.thermalFooter) + '">'
      + '<p style="font-size:11px;color:#94a3b8;margin:4px 0 0">Har receipt ke neeche print hoga</p>'
      + '</div>'

      + _toggle('prt-stamp-print',     cfg.showStampOnPrint,  'Show "PAID" Stamp',          'Paid invoices par bada PAID stamp print karo')
      + _toggle('prt-signature-box',   cfg.showSignatureBox,  'Show Signature Box',         'Receipt ke neeche signature line print karo')
      + _toggle('prt-logo-print',      cfg.showLogoOnPrint,   'Show Business Logo',         'Business logo print par aaye (agar set hai)')
      + _toggle('prt-qr-print',        cfg.showQROnPrint,     'Show QR / Payment Info',     'QR code aur bank details invoice par print hon')

      + '</div></div>'

      + '<div style="margin-bottom:6px;margin-top:4px;font-size:11px;font-weight:800;color:#4338CA;text-transform:uppercase;letter-spacing:1px">Print Behaviour</div>'

      + '<div class="panel" style="margin-bottom:14px">'
      + '<div class="panel-head"><span class="panel-title">Print Mode & Copies</span></div>'
      + '<div class="modal-body" style="display:grid;gap:16px">'

      + '<div>'
      + '<label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:8px">Default Print Mode</label>'
      + '<div style="display:flex;gap:10px">'
      + _modeBtn('auto',    'Auto',    'Type ke hisaab se decide', cfg.defaultPrintMode)
      + _modeBtn('thermal', 'Thermal', 'Hamesha thermal template', cfg.defaultPrintMode)
      + _modeBtn('a4',      'A4/A5',   'Hamesha full-page',        cfg.defaultPrintMode)
      + '</div>'
      + '</div>'

      + '<div>'
      + '<label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:8px">Print Copies</label>'
      + '<div style="display:flex;gap:10px">'
      + _copiesBtn(1, '1 Copy',     'Single receipt',            cfg.printCopies)
      + _copiesBtn(2, '2 Copies',   'Customer + Office',         cfg.printCopies)
      + _copiesBtn(3, '3 Copies',   'Customer + Office + Store', cfg.printCopies)
      + '</div>'
      + '<p style="font-size:11px;color:#94a3b8;margin:6px 0 0">Har print job mein automatically itni copies print hongi</p>'
      + '</div>'

      + _toggle('prt-auto-print', cfg.autoPrint, 'Auto-Print on Save', 'Invoice save hone ke baad print dialog khud khule')

      + '</div></div>'

      + '<div class="panel" style="margin-bottom:16px">'
      + '<div class="panel-head"><span class="panel-title">Live Preview & Test</span></div>'
      + '<div class="modal-body">'
      + '<p style="font-size:12px;color:#64748b;margin:0 0 12px">Pehle settings save karein, phir test print karein.</p>'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap">'
      + '<button class="btn btn-ghost" onclick="ERP.printer._testThermal()" id="prt-prev-thermal" style="' + (!isThermal ? 'display:none' : '') + '">Test Thermal Print</button>'
      + '<button class="btn btn-ghost" onclick="ERP.printer._testA4()"      id="prt-prev-a4"      style="' + (isThermal  ? 'display:none' : '') + '">Test A4/A5 Print</button>'
      + '<button class="btn btn-ghost" onclick="ERP.printer._showSummary()" style="margin-left:auto">View Config Summary</button>'
      + '</div>'
      + '</div></div>'

      + '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px">'
      + '<button class="btn btn-primary" onclick="ERP.printer._save()" style="padding:10px 24px;font-size:14px;font-weight:700">Save All Settings</button>'
      + '<button class="btn btn-ghost"   onclick="ERP.printer._resetDefaults()">Reset Defaults</button>'
      + '<span style="margin-left:auto;font-size:11px;color:#94a3b8">Changes save karne ke baad agar dialog auto-open na ho to browser pop-up allow karein</span>'
      + '</div>'

      + '</div>';

    _bindTypeCards();
    _updatePixelInfo(cfg.printerSize);
  }

  ERP.printer = {
    render:           render,
    _save:            _save,
    _resetDefaults:   _resetDefaults,
    _selectType:      _selectType,
    _selectConn:      _selectConn,
    _selectSize:      _selectSize,
    _selectFont:      _selectFont,
    _selectMargin:    _selectMargin,
    _selectOrient:    _selectOrient,
    _selectTemplate:  _selectTemplate,
    _selectLang:      _selectLang,
    _selectDate:      _selectDate,
    _selectMode:      _selectMode,
    _selectCopies:    _selectCopies,
    _testThermal:     _testThermal,
    _testA4:          _testA4,
    _showSummary:     _showSummary,
    getConfig:        function () { return _printerService.get(); },
    isThermalMode:    function () {
      var cfg = _printerService.get();
      return cfg.printerType === 'thermal' || cfg.defaultPrintMode === 'thermal';
    },
    getThermalWidth:  function () { return _printerService.get().thermalWidth || 576; },
    getPrintCopies:   function () { return _printerService.get().printCopies  || 1;   },
    getDateFormat:    function () { return _printerService.get().dateFormat; },
    getLanguage:      function () { return _printerService.get().printLanguage; },
    getTemplate:      function () { return _printerService.get().invoiceTemplate; }
  };

  function _register() {
    if (ERP.registerRenderer) {
      ERP.registerRenderer('printer', render);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _register);
  } else {
    _register();
  }

})(ERP);

window.ERP = ERP;
