
;(function (global) {
  'use strict';

  if (global.__ERP_PRINT_BRIDGE_LOADED__) return;
  global.__ERP_PRINT_BRIDGE_LOADED__ = true;


  function _safe(fn, tag) {
    try { return fn(); }
    catch (e) {
      if (global.DEBUG_MODE) console.warn('[PrintBridge:' + (tag||'?') + ']', e);
    }
  }

  function _toast(msg, type, dur) {
    _safe(function () {
      if (global.ERP && ERP.ui && ERP.ui.toast) ERP.ui.toast(msg, type||'info', dur||3000);
      else if (global.ERP && ERP.toast && ERP.toast.show) ERP.toast.show(msg, type||'info');
    }, 'toast');
  }

  function _esc(s) {
    if (global.ERP && ERP.escapeHtml) return ERP.escapeHtml(s);
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _r(n) { var x = Number(n); return isNaN(x) ? 0 : Math.round(x); }
  function _fmt(n) { return _r(n).toLocaleString(); }


  function getCfg() {
    if (global.ERP && ERP.printer && typeof ERP.printer.getConfig === 'function') {
      var c = ERP.printer.getConfig();
      if (c && c.printerType) return c;
    }
    if (global.ERP && ERP._internal) {
      var biz = _safe(function(){ return ERP._internal.getState().biz; }, 'cfg-state') || {};
      if (biz.printerType) return biz;
    }
    return {
      printerType:'thermal', printerSize:'3inch', thermalWidth:576,
      defaultPrintMode:'auto', autoPrint:true, printCopies:1,
      printLanguage:'en', invoiceTemplate:'modern', dateFormat:'dd/mm/yyyy',
      paperMargin:'normal', paperOrientation:'portrait',
      thermalFontSize:'medium', connectionType:'default',
      showLogoOnPrint:true, showQROnPrint:true,
      showStampOnPrint:true, showSignatureBox:false,
      thermalHeader:'', thermalFooter:'Thank you! آپ کا شکریہ'
    };
  }

  function getBiz() {
    var stateBiz = _safe(function(){
      if (global.ERP && ERP._internal) return ERP._internal.getState().biz || {};
      return {};
    }, 'getBiz') || {};

    if (!stateBiz.name && global.ERP && ERP._services && ERP._services.settings) {
      stateBiz = _safe(function(){ return ERP._services.settings.getBiz() || {}; }, 'getBiz2') || stateBiz;
    }

    var cfg = getCfg();
    return Object.assign({}, stateBiz, {
      printerType:      cfg.printerType      || stateBiz.printerType,
      thermalWidth:     cfg.thermalWidth      || stateBiz.thermalWidth     || 576,
      printCopies:      cfg.printCopies       || stateBiz.printCopies      || 1,
      autoPrint:        cfg.autoPrint         !== undefined ? cfg.autoPrint : stateBiz.autoPrint,
      invoiceTemplate:  cfg.invoiceTemplate   || stateBiz.invoiceTemplate  || 'modern',
      dateFormat:       cfg.dateFormat        || stateBiz.dateFormat        || 'dd/mm/yyyy',
      printLanguage:    cfg.printLanguage     || stateBiz.printLanguage    || 'en',
      paperMargin:      cfg.paperMargin       || stateBiz.paperMargin      || 'normal',
      paperOrientation: cfg.paperOrientation  || stateBiz.paperOrientation || 'portrait',
      thermalFontSize:  cfg.thermalFontSize   || stateBiz.thermalFontSize  || 'medium',
      thermalHeader:    cfg.thermalHeader     || stateBiz.thermalHeader     || '',
      thermalFooter:    cfg.thermalFooter     || stateBiz.thermalFooter    || 'Thank you! آپ کا شکریہ',
      showLogoOnPrint:  cfg.showLogoOnPrint   !== false,
      showQROnPrint:    cfg.showQROnPrint     !== false,
      showStampOnPrint: cfg.showStampOnPrint  !== false,
      showSignatureBox: cfg.showSignatureBox  || false,
      connectionType:   cfg.connectionType    || 'default',
      networkPrinterIP: cfg.networkPrinterIP  || ''
    });
  }

  function isThermal() {
    var cfg = getCfg();
    var mode = cfg.defaultPrintMode || 'auto';
    var type = cfg.printerType || 'thermal';
    return mode === 'thermal' || (mode === 'auto' && type === 'thermal');
  }


  function openPrintWindow(bodyHtml, title, opts) {
    opts = opts || {};
    var biz    = opts.biz    || getBiz();
    var cfg    = opts.cfg    || getCfg();
    var therm  = opts.thermal !== undefined ? opts.thermal : isThermal();
    var copies = Math.max(1, parseInt(cfg.printCopies, 10) || 1);
    var label  = title || 'Print';

    var pagesHtml = '';
    for (var c = 0; c < copies; c++) {
      pagesHtml += bodyHtml;
      if (c < copies - 1)
        pagesHtml += '<div style="page-break-after:always;margin-bottom:8px"></div>';
    }

    var pageCSS;
    if (therm) {
      var tw = biz.thermalWidth || cfg.thermalWidth || 576;
      pageCSS =
        '@page{size:' + tw + 'px auto;margin:4mm}' +
        '*{box-sizing:border-box;margin:0;padding:0}' +
        'body{background:#fff;font-family:"Courier New",monospace}' +
        '@media print{.pb-np{display:none!important}*{-webkit-print-color-adjust:exact!important}}';
    } else {
      var marginMap = {normal:'15mm',narrow:'8mm',none:'0mm'};
      var margin    = marginMap[biz.paperMargin || cfg.paperMargin] || '15mm';
      var orient    = (biz.paperOrientation || cfg.paperOrientation) === 'landscape' ? 'landscape' : 'portrait';
      var paper     = (biz.printerType || cfg.printerType) === 'a5' ? 'A5' : 'A4';
      pageCSS =
        '@page{size:' + paper + ' ' + orient + ';margin:' + margin + '}' +
        '*{box-sizing:border-box;margin:0;padding:0}' +
        'body{font-family:"Segoe UI",Arial,sans-serif;background:#fff}' +
        '@media print{.pb-np{display:none!important}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}';
    }

    var tw2   = biz.thermalWidth || cfg.thermalWidth || 576;
    var winW  = therm ? Math.min(tw2 + 80, 640) : (opts.width  || 960);
    var winH  = therm ? 680                      : (opts.height || 740);
    var copLbl = copies > 1 ? ' (' + copies + ' copies)' : '';
    var copBadge = copies > 1
      ? '<span style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d;border-radius:6px;padding:5px 12px;font-size:12px;font-weight:700">' + copies + ' copies</span>'
      : '';

    var actionBar =
      '<div class="pb-np" style="text-align:center;padding:10px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;background:#f8fafc;border-bottom:1px solid #e2e8f0">' +
      '<button onclick="window.print()" style="background:#4338CA;color:#fff;border:none;padding:8px 20px;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer">🖨️ Print' + copLbl + '</button>' +
      '<button onclick="window.close()" style="background:#64748b;color:#fff;border:none;padding:8px 14px;border-radius:7px;font-size:13px;cursor:pointer">✕ Close</button>' +
      copBadge + '</div>';

    var pw = global.open('', '_blank', 'width=' + winW + ',height=' + winH + ',scrollbars=yes');
    if (!pw) {
      _safe(function(){
        var ifr = document.createElement('iframe');
        ifr.style.cssText = 'position:absolute;width:0;height:0;border:none;opacity:0';
        document.body.appendChild(ifr);
        var doc = ifr.contentWindow.document;
        doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' + pageCSS + '</style></head><body>' + pagesHtml + '</body></html>');
        doc.close();
        ifr.contentWindow.print();
        setTimeout(function(){ document.body.removeChild(ifr); }, 2000);
      }, 'ifr-fallback');
      _toast('Pop-ups blocked — printing via iframe', 'warning', 4000);
      return null;
    }

    pw.document.write(
      '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      '<title>' + _esc(label + copLbl) + '</title>' +
      '<style>' + pageCSS + '</style></head><body>' +
      actionBar + pagesHtml + '</body></html>'
    );
    pw.document.close();
    setTimeout(function(){ _safe(function(){ pw.print(); }, 'pw.print'); }, 700);
    return pw;
  }


  function _logoHtml(biz, size) {
    size = size || 52;
    var logo = biz.logo || '';
    var safe = /^(https?:\/\/|data:image\/)/.test(logo) ? logo : '';
    if (!safe) return '';
    return '<img src="' + _esc(safe) + '" style="width:' + size + 'px;height:' + size + 'px;object-fit:contain;border-radius:8px" onerror="this.style.display=\'none\'">';
  }

  function _thermalLetterhead(biz) {
    var logo = biz.showLogoOnPrint !== false ? _logoHtml(biz, 60) : '';
    var hdr  = biz.thermalHeader || '';
    return (
      '<div style="text-align:center;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:8px">' +
      (logo ? '<div style="margin-bottom:4px">' + logo + '</div>' : '') +
      '<div style="font-size:16px;font-weight:900">' + _esc(biz.name || 'Business') + '</div>' +
      (biz.address ? '<div style="font-size:11px">' + _esc(biz.address || biz.addr || '') + '</div>' : '') +
      (biz.phone ? '<div style="font-size:11px">📞 ' + _esc(biz.phone) + '</div>' : '') +
      (biz.gst ? '<div style="font-size:10px">GST: ' + _esc(biz.gst) + '</div>' : '') +
      (hdr ? '<div style="font-size:11px;margin-top:4px;font-style:italic">' + _esc(hdr) + '</div>' : '') +
      '</div>'
    );
  }

  function _thermalFooter(biz) {
    var ftr = biz.thermalFooter || 'Thank you! آپ کا شکریہ';
    var qrSrc = biz.showQROnPrint !== false ? (biz.qrCode || '') : '';
    var bankBlock = '';
    if (biz.showQROnPrint !== false && (biz.bankName || biz.bankAcc || biz.bankUpi)) {
      bankBlock =
        '<div style="border-top:1px dashed #000;padding-top:6px;margin-top:6px;font-size:10px">' +
        (biz.bankName  ? '<div>Bank: ' + _esc(biz.bankName) + '</div>' : '') +
        (biz.bankTitle ? '<div>Account: ' + _esc(biz.bankTitle) + '</div>' : '') +
        (biz.bankAcc   ? '<div>Acc No: ' + _esc(biz.bankAcc) + '</div>' : '') +
        (biz.bankUpi   ? '<div>EasyPaisa/JazzCash: ' + _esc(biz.bankUpi) + '</div>' : '') +
        (qrSrc ? '<div style="margin-top:6px;text-align:center"><img src="' + _esc(qrSrc) + '" style="width:70px;height:70px;object-fit:contain" onerror="this.style.display=\'none\'"></div>' : '') +
        '</div>';
    }
    var sigBox = biz.showSignatureBox
      ? '<div style="border-top:1px solid #000;margin-top:10px;padding-top:4px;font-size:10px;text-align:right">Authorized Signatory ___________</div>'
      : '';
    return (
      bankBlock + sigBox +
      '<div style="text-align:center;font-size:11px;margin-top:8px;border-top:1px dashed #000;padding-top:6px">' +
      _esc(ftr) + '</div>'
    );
  }

  function _a4Letterhead(biz, docType) {
    var logo = _logoHtml(biz, 56);
    return (
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:3px solid #4338CA">' +
      '<div>' +
      (logo ? '<div style="margin-bottom:8px">' + logo + '</div>' : '') +
      '<div style="font-size:22px;font-weight:800;color:#0f172a">' + _esc(biz.name || 'Business') + '</div>' +
      (biz.address || biz.addr ? '<div style="font-size:12px;color:#64748b">' + _esc(biz.address || biz.addr || '') + '</div>' : '') +
      (biz.city ? '<div style="font-size:12px;color:#64748b">' + _esc(biz.city) + '</div>' : '') +
      (biz.phone ? '<div style="font-size:12px;color:#64748b">📞 ' + _esc(biz.phone) + '</div>' : '') +
      (biz.email ? '<div style="font-size:12px;color:#64748b">✉️ ' + _esc(biz.email) + '</div>' : '') +
      (biz.gst ? '<div style="font-size:12px;color:#64748b">GST: ' + _esc(biz.gst) + '</div>' : '') +
      (biz.ntn ? '<div style="font-size:12px;color:#64748b">NTN: ' + _esc(biz.ntn) + '</div>' : '') +
      '</div>' +
      '<div style="text-align:right">' +
      '<div style="font-size:20px;font-weight:800;color:#4338CA">' + _esc(docType || 'DOCUMENT') + '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function _a4Footer(biz) {
    var qrSrc = biz.showQROnPrint !== false ? (biz.qrCode || '') : '';
    var bankBlock = '';
    if (biz.showQROnPrint !== false && (biz.bankName || biz.bankAcc || biz.bankUpi)) {
      bankBlock =
        '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin-top:16px;display:flex;gap:16px;align-items:flex-start">' +
        '<div style="flex:1;font-size:12px">' +
        '<div style="font-weight:700;color:#0f172a;margin-bottom:6px">Payment Details</div>' +
        (biz.bankName  ? '<div>Bank: <b>' + _esc(biz.bankName) + '</b></div>' : '') +
        (biz.bankTitle ? '<div>Account Title: <b>' + _esc(biz.bankTitle) + '</b></div>' : '') +
        (biz.bankAcc   ? '<div>Account No: <b>' + _esc(biz.bankAcc) + '</b></div>' : '') +
        (biz.bankIban  ? '<div>IBAN: <b>' + _esc(biz.bankIban) + '</b></div>' : '') +
        (biz.bankUpi   ? '<div>EasyPaisa/JazzCash: <b>' + _esc(biz.bankUpi) + '</b></div>' : '') +
        '</div>' +
        (qrSrc ? '<div><img src="' + _esc(qrSrc) + '" style="width:70px;height:70px;object-fit:contain;border:1px solid #e2e8f0;border-radius:6px" onerror="this.style.display=\'none\'"></div>' : '') +
        '</div>';
    }
    var sig = biz.showSignatureBox
      ? '<div style="display:flex;justify-content:flex-end;margin-top:20px"><div style="border-top:1px solid #0f172a;width:200px;text-align:center;padding-top:6px;font-size:11px;color:#64748b">Authorized Signatory</div></div>'
      : '';
    var stamp = biz.showStampOnPrint
      ? '<div style="display:flex;justify-content:flex-start;margin-top:20px"><div style="width:80px;height:80px;border:2px dashed #cbd5e1;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;color:#94a3b8">STAMP</div></div>'
      : '';
    return bankBlock + '<div style="display:flex;justify-content:space-between">' + stamp + sig + '</div>';
  }


  function printPurchase(po) {
    if (!po) { _toast('Purchase order not found', 'error'); return; }
    var biz   = getBiz();
    var therm = isThermal();
    var tw    = biz.thermalWidth || 576;
    var cur   = biz.currency || 'Rs';

    var itemsHtml;
    if (therm) {
      itemsHtml = (po.itemsList || po.items || []).map(function(it) {
        var amt = Math.round(it.amount || it.lineAmt || ((it.qty||0)*(it.rate||it.price||0)));
        return (
          '<div style="border-bottom:1px dashed #ccc;padding:3px 0;font-size:' + (biz.thermalFontSize === 'small' ? '11' : biz.thermalFontSize === 'large' ? '14' : '12') + 'px">' +
          '<div><b>' + _esc(it.name || '') + '</b>' + (it.taxLabel && it.taxLabel !== 'NONE' ? ' [' + _esc(it.taxLabel) + ']' : '') + '</div>' +
          '<div style="display:flex;justify-content:space-between">' +
          '<span>' + (it.qty||0) + ' ' + _esc(it.unit||'pcs') + ' × ' + cur + ' ' + _fmt(it.rate||it.price||0) + '</span>' +
          '<span><b>' + cur + ' ' + _fmt(amt) + '</b></span>' +
          '</div></div>'
        );
      }).join('');
    } else {
      itemsHtml =
        '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px">' +
        '<thead><tr style="background:#4338CA;color:#fff">' +
        '<th style="padding:7px 10px">#</th><th style="padding:7px 10px">Item</th>' +
        '<th style="padding:7px 10px;text-align:center">Qty</th><th style="padding:7px 10px">Unit</th>' +
        '<th style="padding:7px 10px;text-align:right">Rate</th><th style="padding:7px 10px;text-align:right">Disc</th>' +
        '<th style="padding:7px 10px;text-align:center">Tax</th><th style="padding:7px 10px;text-align:right">Amount</th>' +
        '</tr></thead><tbody>' +
        (po.itemsList || po.items || []).map(function(it, i) {
          return '<tr style="border-bottom:1px solid #f1f5f9;' + (i%2===0?'':'background:#fafbfc') + '">' +
            '<td style="padding:7px 10px;color:#94a3b8">' + (i+1) + '</td>' +
            '<td style="padding:7px 10px;font-weight:600">' + _esc(it.name||'') + '</td>' +
            '<td style="padding:7px 10px;text-align:center">' + (it.qty||0) + '</td>' +
            '<td style="padding:7px 10px">' + _esc(it.unit||'pcs') + '</td>' +
            '<td style="padding:7px 10px;text-align:right">' + cur + ' ' + _fmt(it.rate||it.price||0) + '</td>' +
            '<td style="padding:7px 10px;text-align:right;color:#dc2626">' + cur + ' ' + _fmt(it.discAmt||0) + '</td>' +
            '<td style="padding:7px 10px;text-align:center">' + _esc(it.taxLabel||'–') + '</td>' +
            '<td style="padding:7px 10px;text-align:right;font-weight:700">' + cur + ' ' + _fmt(it.amount||it.lineAmt||((it.qty||0)*(it.rate||it.price||0))) + '</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table>';
    }

    var totals =
      (therm ? '' : '<div style="display:flex;justify-content:flex-end;margin-bottom:16px"><div style="background:#f8fafc;border-radius:8px;padding:14px 20px;min-width:260px;border:1px solid #e2e8f0">') +
      '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px"><span>Subtotal</span><span>' + cur + ' ' + _fmt(po.sub||0) + '</span></div>' +
      (po.disc ? '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px;color:#dc2626"><span>Discount</span><span>-' + cur + ' ' + _fmt(po.disc||0) + '</span></div>' : '') +
      (po.tax ? '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px"><span>Tax</span><span>' + cur + ' ' + _fmt(po.tax||0) + '</span></div>' : '') +
      '<div style="display:flex;justify-content:space-between;padding:5px 0;font-weight:800;font-size:' + (therm?'15':'17') + 'px;border-top:2px solid #4338CA;margin-top:4px"><span>TOTAL</span><span>' + cur + ' ' + _fmt(po.total||po.amt||0) + '</span></div>' +
      (po.paid ? '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px;color:#16a34a;font-weight:600"><span>Paid</span><span>' + cur + ' ' + _fmt(po.paid||0) + '</span></div>' : '') +
      ((po.balance > 0) ? '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px;font-weight:700;color:#dc2626"><span>Balance</span><span>' + cur + ' ' + _fmt(po.balance||0) + '</span></div>' : '') +
      (therm ? '' : '</div></div>');

    var html;
    if (therm) {
      html =
        '<div style="width:' + tw + 'px;font-family:\'Courier New\',monospace;padding:10px">' +
        _thermalLetterhead(biz) +
        '<div style="font-size:13px;font-weight:700;text-align:center;margin-bottom:6px">PURCHASE ORDER</div>' +
        '<div style="font-size:12px;margin-bottom:6px">' +
        'PO#: <b>' + _esc(po.id||'') + '</b><br>' +
        'Date: ' + _esc(po.date||'') + '<br>' +
        'Supplier: <b>' + _esc(po.supplierName||po.sup||'') + '</b>' +
        (po.ph ? '<br>Ph: ' + _esc(po.ph) : '') +
        '</div>' +
        '<div style="border-top:1px dashed #000;padding-top:6px;margin-bottom:4px">' + itemsHtml + '</div>' +
        '<div style="border-top:2px solid #000;padding-top:6px;margin-top:4px">' + totals + '</div>' +
        _thermalFooter(biz) +
        '</div>';
    } else {
      html =
        '<div style="max-width:820px;margin:0 auto;padding:20px;font-family:\'Segoe UI\',Arial,sans-serif">' +
        _a4Letterhead(biz, 'PURCHASE ORDER') +
        '<div style="background:#f8fafc;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px;display:grid;grid-template-columns:1fr 1fr;gap:6px">' +
        '<div><b>PO#:</b> ' + _esc(po.id||'') + '</div>' +
        '<div><b>Date:</b> ' + _esc(po.date||'') + '</div>' +
        '<div><b>Supplier:</b> ' + _esc(po.supplierName||po.sup||'') + '</div>' +
        (po.ph ? '<div><b>Phone:</b> ' + _esc(po.ph) + '</div>' : '') +
        (po.status ? '<div><b>Status:</b> ' + _esc(po.status) + '</div>' : '') +
        '</div>' +
        itemsHtml + totals +
        _a4Footer(biz) +
        '<div style="margin-top:20px;border-top:1px solid #e2e8f0;padding-top:10px;text-align:center;font-size:11px;color:#94a3b8">' +
        _esc(biz.name||'Business') + ' — شکریہ</div>' +
        '</div>';
    }

    openPrintWindow(html, 'Purchase Order — ' + (po.id||''), { biz:biz, cfg:getCfg(), thermal:therm });
  }


  function printPurchaseReturn(ret) {
    if (!ret) { _toast('Return not found', 'error'); return; }
    var biz   = getBiz();
    var therm = isThermal();
    var cur   = biz.currency || 'Rs';
    var tw    = biz.thermalWidth || 576;

    var itemRows = (ret.items || []).map(function(i, idx) {
      var amt = Math.round(i.amount || ((i.qty||0)*(i.rate||0)));
      if (therm) {
        return '<div style="border-bottom:1px dashed #ccc;padding:3px 0;font-size:12px">' +
          '<div><b>' + _esc(i.name||'') + '</b></div>' +
          '<div style="display:flex;justify-content:space-between">' +
          '<span>' + (i.qty||0) + ' × ' + cur + ' ' + _fmt(i.rate||0) + '</span>' +
          '<span><b>' + cur + ' ' + _fmt(amt) + '</b></span></div></div>';
      }
      return '<tr style="border-bottom:1px solid #f1f5f9;' + (idx%2?'background:#fafbfc':'') + '">' +
        '<td style="padding:7px 10px;color:#94a3b8">' + (idx+1) + '</td>' +
        '<td style="padding:7px 10px;font-weight:600">' + _esc(i.name||'') + '</td>' +
        '<td style="padding:7px 10px;text-align:center">' + (i.qty||0) + '</td>' +
        '<td style="padding:7px 10px;text-align:right">' + cur + ' ' + _fmt(i.rate||0) + '</td>' +
        '<td style="padding:7px 10px;text-align:right;font-weight:700">' + cur + ' ' + _fmt(amt) + '</td></tr>';
    }).join('');

    var totalBox =
      '<div style="' + (therm ? 'border-top:2px solid #000;padding-top:6px;margin-top:4px' : 'display:flex;justify-content:flex-end;margin-top:12px') + '">' +
      '<div style="' + (therm ? '' : 'background:#fef2f2;padding:12px 20px;border-radius:8px;border:1px solid #fca5a5;min-width:220px') + '">' +
      '<div style="display:flex;justify-content:space-between;font-size:' + (therm?'15':'17') + 'px;font-weight:800;color:#c62828"><span>Return Total</span><span>' + cur + ' ' + _fmt(ret.total||0) + '</span></div>' +
      '</div></div>';

    var html;
    if (therm) {
      html =
        '<div style="width:' + tw + 'px;font-family:\'Courier New\',monospace;padding:10px">' +
        _thermalLetterhead(biz) +
        '<div style="font-size:13px;font-weight:700;text-align:center;margin-bottom:6px;color:#c62828">PURCHASE RETURN / DEBIT NOTE</div>' +
        '<div style="font-size:12px;margin-bottom:6px">' +
        'Return#: <b>' + _esc(ret.id||'') + '</b><br>' +
        'Date: ' + _esc(ret.date||'') + '<br>' +
        'Supplier: <b>' + _esc(ret.supplierName||'') + '</b><br>' +
        'Against PO: ' + _esc(ret.purchaseId||'—') + '<br>' +
        (ret.reason ? 'Reason: ' + _esc(ret.reason) : '') +
        '</div>' +
        '<div style="border-top:1px dashed #000;padding-top:6px;margin-bottom:4px">' + itemRows + '</div>' +
        totalBox + _thermalFooter(biz) + '</div>';
    } else {
      html =
        '<div style="max-width:820px;margin:0 auto;padding:20px;font-family:\'Segoe UI\',Arial,sans-serif">' +
        _a4Letterhead(biz, 'PURCHASE RETURN') +
        '<div style="background:#fef2f2;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px;border-left:4px solid #c62828;display:grid;grid-template-columns:1fr 1fr;gap:6px">' +
        '<div><b>Return#:</b> ' + _esc(ret.id||'') + '</div>' +
        '<div><b>Date:</b> ' + _esc(ret.date||'') + '</div>' +
        '<div><b>Supplier:</b> ' + _esc(ret.supplierName||'') + '</div>' +
        '<div><b>Against PO:</b> ' + _esc(ret.purchaseId||'—') + '</div>' +
        (ret.reason ? '<div style="grid-column:1/-1"><b>Reason:</b> ' + _esc(ret.reason) + '</div>' : '') +
        (ret.createdBy ? '<div><b>Created By:</b> ' + _esc(ret.createdBy) + '</div>' : '') +
        '</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px">' +
        '<thead><tr style="background:#c62828;color:#fff">' +
        '<th style="padding:7px 10px">#</th><th style="padding:7px 10px">Item</th>' +
        '<th style="padding:7px 10px;text-align:center">Qty</th>' +
        '<th style="padding:7px 10px;text-align:right">Rate</th>' +
        '<th style="padding:7px 10px;text-align:right">Amount</th></tr></thead>' +
        '<tbody>' + itemRows + '</tbody></table>' +
        totalBox +
        _a4Footer(biz) +
        '<div style="margin-top:16px;border-top:1px solid #e2e8f0;padding-top:10px;text-align:center;font-size:11px;color:#94a3b8">' +
        _esc(biz.name||'Business') + ' — Debit Note / Purchase Return</div></div>';
    }

    openPrintWindow(html, 'Purchase Return — ' + (ret.id||''), { biz:biz, cfg:getCfg(), thermal:therm });
  }


  function printPaymentOut(payment) {
    if (!payment) { _toast('Payment not found', 'error'); return; }
    var biz   = getBiz();
    var therm = isThermal();
    var cur   = biz.currency || 'Rs';
    var tw    = biz.thermalWidth || 576;

    var voidBanner = payment.voided
      ? '<div style="background:var(--danger);color:#fff;padding:8px;text-align:center;font-weight:900;font-size:16px;margin-bottom:8px">⛔ VOIDED</div>'
      : '';

    var html;
    if (therm) {
      html =
        '<div style="width:' + tw + 'px;font-family:\'Courier New\',monospace;padding:10px">' +
        _thermalLetterhead(biz) +
        voidBanner +
        '<div style="font-size:13px;font-weight:700;text-align:center;margin-bottom:6px">PAYMENT RECEIPT</div>' +
        '<div style="font-size:12px;margin-bottom:6px">' +
        'Receipt#: <b>' + _esc(payment.id||'') + '</b><br>' +
        'Date: ' + _esc(payment.date||'') + '<br>' +
        'Supplier: <b>' + _esc(payment.supplierName||payment.supplierId||'') + '</b><br>' +
        'Method: ' + _esc(payment.method||'Cash') +
        (payment.reference ? '<br>Against: ' + _esc(payment.reference) : '') +
        (payment.notes ? '<br>Notes: ' + _esc(payment.notes) : '') +
        '</div>' +
        '<div style="border-top:2px solid #000;padding-top:6px;font-size:18px;font-weight:900;text-align:center">' +
        cur + ' ' + _fmt(payment.amount||0) + '</div>' +
        _thermalFooter(biz) + '</div>';
    } else {
      html =
        '<div style="max-width:560px;margin:0 auto;padding:20px;font-family:\'Segoe UI\',Arial,sans-serif">' +
        _a4Letterhead(biz, 'PAYMENT RECEIPT') +
        voidBanner +
        '<div style="background:#f0f9ff;border-radius:8px;padding:14px 16px;margin-bottom:16px;font-size:13px;border-left:4px solid #4338CA">' +
        '<div style="display:flex;justify-content:space-between;border-bottom:1px solid #e0f2fe;padding-bottom:6px;margin-bottom:6px"><span style="color:#64748b">Receipt#</span><span style="font-weight:600">' + _esc(payment.id||'') + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;border-bottom:1px solid #e0f2fe;padding-bottom:6px;margin-bottom:6px"><span style="color:#64748b">Date</span><span>' + _esc(payment.date||'') + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;border-bottom:1px solid #e0f2fe;padding-bottom:6px;margin-bottom:6px"><span style="color:#64748b">Supplier</span><span style="font-weight:600">' + _esc(payment.supplierName||payment.supplierId||'') + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;border-bottom:1px solid #e0f2fe;padding-bottom:6px;margin-bottom:6px"><span style="color:#64748b">Method</span><span>' + _esc(payment.method||'Cash') + '</span></div>' +
        (payment.reference ? '<div style="display:flex;justify-content:space-between;border-bottom:1px solid #e0f2fe;padding-bottom:6px;margin-bottom:6px"><span style="color:#64748b">Against</span><span>' + _esc(payment.reference) + '</span></div>' : '') +
        (payment.notes ? '<div style="display:flex;justify-content:space-between;padding-bottom:6px;margin-bottom:6px"><span style="color:#64748b">Notes</span><span>' + _esc(payment.notes) + '</span></div>' : '') +
        '</div>' +
        '<div style="background:#4338CA;border-radius:10px;padding:16px 20px;text-align:center;color:#fff">' +
        '<div style="font-size:12px;opacity:.8;margin-bottom:4px">Amount Paid</div>' +
        '<div style="font-size:28px;font-weight:900">' + cur + ' ' + _fmt(payment.amount||0) + '</div>' +
        (payment.voided ? '<div style="margin-top:6px;font-size:13px;background:rgba(255,0,0,.3);border-radius:6px;padding:4px">VOIDED on ' + _esc(payment.voidedAt||'') + '</div>' : '') +
        '</div>' +
        _a4Footer(biz) +
        '<div style="margin-top:16px;text-align:center;font-size:11px;color:#94a3b8">' + _esc(biz.name||'Business') + ' — Payment Receipt</div></div>';
    }

    openPrintWindow(html, 'Payment Receipt — ' + (payment.id||''), { biz:biz, cfg:getCfg(), thermal:therm });
  }


  function printInventoryLabel(item) {
    if (!item) { _toast('Item not found', 'error'); return; }
    var biz   = getBiz();
    var therm = isThermal();
    var cur   = biz.currency || 'Rs';
    var tw    = biz.thermalWidth || 576;

    var html;
    if (therm) {
      html =
        '<div style="width:' + tw + 'px;font-family:\'Courier New\',monospace;padding:12px;text-align:center">' +
        '<div style="font-size:12px;font-weight:700;border-bottom:1px dashed #000;padding-bottom:6px;margin-bottom:6px">' + _esc(biz.name||'') + '</div>' +
        '<div style="font-size:15px;font-weight:800;margin-bottom:4px">' + _esc(item.n||item.name||'') + '</div>' +
        (item.category ? '<div style="font-size:10px;color:var(--muted);margin-bottom:4px">' + _esc(item.category) + '</div>' : '') +
        '<div style="font-size:22px;font-weight:900;letter-spacing:4px;border-top:1px solid #000;border-bottom:1px solid #000;padding:5px 0;margin:5px 0">||| ' + _esc(item.bc||item.barcode||'') + ' |||</div>' +
        '<div style="font-size:18px;font-weight:900;color:#000;margin:6px 0">' + cur + ' ' + _fmt(item.sp||item.salePrice||0) + '</div>' +
        (item.pp || item.purchasePrice ? '<div style="font-size:11px;color:var(--muted)">Cost: ' + cur + ' ' + _fmt(item.pp||item.purchasePrice||0) + '</div>' : '') +
        '<div style="font-size:11px;color:var(--muted)">Stock: ' + (item.st||item.stock||0) + ' ' + _esc(item.unit||'') + '</div>' +
        _thermalFooter(biz) + '</div>';
    } else {
      var lbl =
        '<div style="border:1px solid #cbd5e1;border-radius:8px;padding:12px;text-align:center;font-family:\'Segoe UI\',Arial,sans-serif;break-inside:avoid;page-break-inside:avoid">' +
        '<div style="font-size:10px;font-weight:600;color:#64748b;margin-bottom:4px">' + _esc(biz.name||'') + '</div>' +
        '<div style="font-size:14px;font-weight:800;color:#0f172a;margin-bottom:2px">' + _esc(item.n||item.name||'') + '</div>' +
        (item.category ? '<div style="font-size:9px;color:#94a3b8;margin-bottom:4px">' + _esc(item.category) + '</div>' : '') +
        '<div style="font-size:18px;font-weight:900;letter-spacing:3px;border:1px dashed #94a3b8;padding:4px;margin:5px 0;border-radius:4px">||| ' + _esc(item.bc||item.barcode||'') + ' |||</div>' +
        '<div style="font-size:16px;font-weight:800;color:#4338CA">' + cur + ' ' + _fmt(item.sp||item.salePrice||0) + '</div>' +
        '<div style="font-size:9px;color:#64748b;margin-top:2px">Stock: ' + (item.st||item.stock||0) + ' ' + _esc(item.unit||'') + '</div>' +
        '</div>';
      html = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:16px">' +
             lbl + lbl + lbl + lbl +
             '</div><div style="text-align:center;font-size:11px;color:#94a3b8;padding:10px">' +
             '4 labels — ' + _esc(item.n||item.name||'') + ' · ' + _esc(item.bc||item.barcode||'') + '</div>';
    }

    openPrintWindow(html, 'Label — ' + (item.bc||item.barcode||''), { biz:biz, cfg:getCfg(), thermal:therm });
  }


  function printJobCard(job) {
    if (!job) { _toast('Job not found', 'error'); return; }
    var biz   = getBiz();
    var therm = isThermal();
    var cur   = biz.currency || 'Rs';
    var tw    = biz.thermalWidth || 576;

    var parts   = job.parts || [];
    var labLines= job.labourLines || [];
    var partsTotal = parts.reduce(function(s,p){ return s+(Number(p.q)||0)*(Number(p.p)||0); }, 0);
    var labTotal   = labLines.length
      ? labLines.reduce(function(s,l){ return s+(l.amt!==undefined?Number(l.amt):(Number(l.hrs)||1)*(Number(l.rate||l.fixed)||0)); }, 0)
      : Number(job.lab||0);
    var discount   = Number(job.dis||0);
    var grand      = Math.max(0, partsTotal + labTotal - discount);
    var payH       = Array.isArray(job.paymentHistory) ? job.paymentHistory : [];
    var paid       = payH.reduce(function(s,p){ return s+(p.voided?0:Number(p.amount||0)); }, 0);
    var balance    = Math.max(0, grand - paid);

    if (therm) {
      var pRows = parts.map(function(p){
        return '<div style="border-bottom:1px dashed #ccc;padding:3px 0;font-size:12px;display:flex;justify-content:space-between">' +
          '<span>' + _esc(p.n||'') + ' ×' + (p.q||1) + '</span>' +
          '<span>' + cur + ' ' + _fmt((Number(p.q)||0)*(Number(p.p)||0)) + '</span></div>';
      }).join('');
      var lRows = labLines.map(function(l){
        var a = l.amt!==undefined?Number(l.amt):(Number(l.hrs)||1)*(Number(l.rate||l.fixed)||0);
        return '<div style="border-bottom:1px dashed #ccc;padding:3px 0;font-size:12px;display:flex;justify-content:space-between">' +
          '<span>' + _esc(l.desc||'Labour') + (l.mec?' ('+_esc(l.mec)+')':'') + '</span>' +
          '<span>' + cur + ' ' + _fmt(a) + '</span></div>';
      }).join('');

      var html =
        '<div style="width:' + tw + 'px;font-family:\'Courier New\',monospace;padding:10px">' +
        _thermalLetterhead(biz) +
        '<div style="font-size:13px;font-weight:700;text-align:center;margin-bottom:6px">🔧 JOB CARD</div>' +
        '<div style="font-size:12px;margin-bottom:6px">' +
        'Job#: <b>' + _esc(job.id||'') + '</b><br>' +
        'Date: ' + _esc(job.date||'') + '<br>' +
        (job.del ? 'Delivery: ' + _esc(job.del) + '<br>' : '') +
        'Customer: <b>' + _esc(job.cust||'') + '</b><br>' +
        (job.ph ? 'Ph: ' + _esc(job.ph) + '<br>' : '') +
        'Vehicle: <b>' + _esc(job.car||'') + '</b>' +
        (job.plate ? ' [' + _esc(job.plate) + ']' : '') + '<br>' +
        (job.mec ? 'Mechanic: ' + _esc(job.mec) + '<br>' : '') +
        (job.eng ? 'Engine: ' + _esc(job.eng) + '<br>' : '') +
        (job.prob ? '<div style="margin-top:4px;border-top:1px dashed #ccc;padding-top:4px">Work: ' + _esc(job.prob) + '</div>' : '') +
        '</div>' +
        (pRows ? '<div style="border-top:1px dashed #000;padding-top:4px;margin-bottom:4px"><b style="font-size:10px">PARTS</b>' + pRows + '</div>' : '') +
        (lRows ? '<div style="border-top:1px dashed #000;padding-top:4px;margin-bottom:4px"><b style="font-size:10px">LABOUR</b>' + lRows + '</div>' : '') +
        '<div style="border-top:2px solid #000;padding-top:6px">' +
        '<div style="display:flex;justify-content:space-between;font-size:12px"><span>Parts</span><span>' + cur + ' ' + _fmt(partsTotal) + '</span></div>' +
        '<div style="display:flex;justify-content:space-between;font-size:12px"><span>Labour</span><span>' + cur + ' ' + _fmt(labTotal) + '</span></div>' +
        (discount>0 ? '<div style="display:flex;justify-content:space-between;font-size:12px;color:#c62828"><span>Discount</span><span>-' + cur + ' ' + _fmt(discount) + '</span></div>' : '') +
        '<div style="display:flex;justify-content:space-between;font-size:16px;font-weight:900;border-top:1px solid #000;margin-top:3px;padding-top:3px"><span>TOTAL</span><span>' + cur + ' ' + _fmt(grand) + '</span></div>' +
        (paid>0 ? '<div style="display:flex;justify-content:space-between;font-size:12px;color:#16a34a;font-weight:600"><span>Paid</span><span>' + cur + ' ' + _fmt(paid) + '</span></div>' : '') +
        (balance>0 ? '<div style="display:flex;justify-content:space-between;font-size:13px;font-weight:800;color:#c62828"><span>BALANCE</span><span>' + cur + ' ' + _fmt(balance) + '</span></div>' : '') +
        '</div>' +
        _thermalFooter(biz) + '</div>';

      openPrintWindow(html, 'Job Card — ' + (job.id||''), { biz:biz, cfg:getCfg(), thermal:true });
    } else {
      var ST = (typeof SalesTemplates !== 'undefined') ? SalesTemplates
             : (global.ERP && ERP._salesTemplates) ? ERP._salesTemplates : null;
      if (ST && typeof ST.buildInvoiceHTML === 'function') {
        var theme = biz.invoiceTemplate || 'modern';
        var color = '#4338CA';
        _safe(function(){
          if(ERP.sales && ERP.sales._currentColor) color = ERP.sales._currentColor;
        }, 'color');
        var invObj = {
          id: job.invoiceId || job.id, date: job.date,
          customer: job.cust, ph: job.ph,
          items: parts.map(function(p){ return {n:p.n,q:p.q,p:p.p,tax:0}; }),
          sub: partsTotal + labTotal, dis: discount, tax: 0,
          total: grand, paid: paid, balance: balance,
          notes: job.prob, jobId: job.id, vehicleNo: job.plate, car: job.car
        };
        var html = ST.buildInvoiceHTML(invObj, theme, color, biz);
        openPrintWindow(html, 'Job Card — ' + (job.id||''), { biz:biz, cfg:getCfg(), thermal:false });
      } else {
        var pTbl = parts.map(function(p,i){
          return '<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:7px 10px;color:#94a3b8">'+(i+1)+'</td><td style="padding:7px 10px;font-weight:600">'+_esc(p.n||'')+'</td><td style="padding:7px 10px;text-align:center">'+(p.q||0)+'</td><td style="padding:7px 10px;text-align:right">'+cur+' '+_fmt(p.p||0)+'</td><td style="padding:7px 10px;text-align:right;font-weight:700">'+cur+' '+_fmt((Number(p.q)||0)*(Number(p.p)||0))+'</td></tr>';
        }).join('') || '<tr><td colspan="5" style="padding:12px;text-align:center;color:#94a3b8">No parts</td></tr>';
        var lTbl = labLines.map(function(l,i){
          var a=l.amt!==undefined?Number(l.amt):(Number(l.hrs)||1)*(Number(l.rate||l.fixed)||0);
          return '<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:7px 10px;color:#94a3b8">'+(i+1)+'</td><td style="padding:7px 10px;font-weight:600">'+_esc(l.desc||'Labour')+(l.mec?' ('+_esc(l.mec)+')':'')+'</td><td style="padding:7px 10px;text-align:center">'+(l.hrs?l.hrs+'h':'—')+'</td><td style="padding:7px 10px;text-align:right;font-weight:700" colspan="2">'+cur+' '+_fmt(a)+'</td></tr>';
        }).join('') || '<tr><td colspan="5" style="padding:12px;text-align:center;color:#94a3b8">No labour lines</td></tr>';

        var fhtml =
          '<div style="max-width:820px;margin:0 auto;padding:20px;font-family:\'Segoe UI\',Arial,sans-serif">' +
          _a4Letterhead(biz, '🔧 JOB CARD') +
          '<div style="background:#f8fafc;border-radius:8px;padding:12px 16px;margin-bottom:16px;display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">' +
          '<div><b>Job#:</b> '+_esc(job.id||'')+'</div><div><b>Date:</b> '+_esc(job.date||'')+'</div>' +
          '<div><b>Customer:</b> '+_esc(job.cust||'')+'</div><div><b>Phone:</b> '+_esc(job.ph||'')+'</div>' +
          '<div><b>Vehicle:</b> '+_esc(job.car||'')+'</div><div><b>Plate:</b> '+_esc(job.plate||'')+'</div>' +
          (job.mec?'<div><b>Mechanic:</b> '+_esc(job.mec)+'</div>':'') +
          (job.eng?'<div><b>Engine:</b> '+_esc(job.eng)+'</div>':'') +
          (job.del?'<div><b>Delivery:</b> '+_esc(job.del)+'</div>':'') +
          '</div>' +
          (job.prob?'<div style="background:#fff7ed;border-left:4px solid #f97316;padding:10px 14px;border-radius:6px;margin-bottom:16px;font-size:13px"><b>Problem / Work:</b><br>'+_esc(job.prob)+'</div>':'') +
          '<div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">Parts & Materials</div>' +
          '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px"><thead><tr style="background:#1e3a5f;color:#fff"><th style="padding:7px 10px">#</th><th style="padding:7px 10px">Part</th><th style="padding:7px 10px;text-align:center">Qty</th><th style="padding:7px 10px;text-align:right">Unit Price</th><th style="padding:7px 10px;text-align:right">Total</th></tr></thead><tbody>'+pTbl+'</tbody></table>' +
          '<div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">Labour</div>' +
          '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px"><thead><tr style="background:#1e3a5f;color:#fff"><th style="padding:7px 10px">#</th><th style="padding:7px 10px">Description</th><th style="padding:7px 10px;text-align:center">Hours</th><th style="padding:7px 10px;text-align:right" colspan="2">Amount</th></tr></thead><tbody>'+lTbl+'</tbody></table>' +
          '<div style="display:flex;justify-content:flex-end"><div style="background:#f8fafc;border-radius:8px;padding:14px 20px;min-width:260px;border:1px solid #e2e8f0">' +
          '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px"><span>Parts Total</span><span>'+cur+' '+_fmt(partsTotal)+'</span></div>' +
          '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px"><span>Labour</span><span>'+cur+' '+_fmt(labTotal)+'</span></div>' +
          (discount>0?'<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px;color:#dc2626"><span>Discount</span><span>-'+cur+' '+_fmt(discount)+'</span></div>':'') +
          '<div style="display:flex;justify-content:space-between;padding:5px 0;font-weight:800;font-size:17px;border-top:2px solid #1e3a5f;margin-top:4px"><span>GRAND TOTAL</span><span>'+cur+' '+_fmt(grand)+'</span></div>' +
          (paid>0?'<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px;color:#16a34a;font-weight:600"><span>Paid</span><span>'+cur+' '+_fmt(paid)+'</span></div>':'') +
          (balance>0?'<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:14px;font-weight:700;color:#ea580c"><span>Balance Due</span><span>'+cur+' '+_fmt(balance)+'</span></div>':'') +
          '</div></div>' +
          _a4Footer(biz) +
          '<div style="margin-top:16px;border-top:1px solid #e2e8f0;padding-top:10px;text-align:center;font-size:11px;color:#94a3b8">'+_esc(biz.name||'Business')+' — شکریہ</div></div>';

        openPrintWindow(fhtml, 'Job Card — ' + (job.id||''), { biz:biz, cfg:getCfg(), thermal:false });
      }
    }
  }


  function printReport(contentEl, reportLabel, bizNameOverride) {
    if (!contentEl) { _toast('Report content not found', 'error'); return; }
    var biz    = getBiz();
    var cfg    = getCfg();
    var bizName = bizNameOverride || biz.name || 'ERP Report';
    var logo    = _logoHtml(biz, 48);

    var clone = contentEl.cloneNode(true);
    clone.querySelectorAll('.rpt-actions,.rpt-header,.rpt-print-btn,.rpt-filter-strip,button,.btn,.pb-np').forEach(function(el){ el.remove(); });
    var reportHTML = clone.innerHTML;

    var rptStyle = '';
    var rptCssEl = document.getElementById('rpt-css');
    if (rptCssEl) rptStyle = rptCssEl.textContent || rptCssEl.innerText || '';

    var now   = new Date();
    var pad   = function(n){ return String(n).padStart(2,'0'); };
    var rDate = pad(now.getDate())+'-'+pad(now.getMonth()+1)+'-'+now.getFullYear();
    var rTime = pad(now.getHours())+':'+pad(now.getMinutes());

    var html =
      '<div style="max-width:100%;font-family:\'Segoe UI\',Arial,sans-serif">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;padding-bottom:10px;border-bottom:3px solid #4338CA">' +
      '<div style="display:flex;align-items:flex-start;gap:12px">' +
      (logo ? '<div>' + logo + '</div>' : '') +
      '<div>' +
      '<div style="font-size:22px;font-weight:900;color:#0f172a;line-height:1">' + _esc(bizName) + '</div>' +
      (biz.address || biz.addr ? '<div style="font-size:11px;color:#64748b;margin-top:2px">' + _esc(biz.address||biz.addr||'') + '</div>' : '') +
      (biz.phone ? '<div style="font-size:11px;color:#64748b">📞 ' + _esc(biz.phone) + '</div>' : '') +
      (biz.email ? '<div style="font-size:11px;color:#64748b">✉️ ' + _esc(biz.email) + '</div>' : '') +
      '</div></div>' +
      '<div style="text-align:right">' +
      '<div style="font-size:20px;font-weight:900;color:#4338CA">' + _esc(reportLabel||'Report') + '</div>' +
      '<div style="font-size:11px;color:#64748b;margin-top:4px">' + rDate + ' ' + rTime + '</div>' +
      '</div></div>' +
      '<hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 12px">' +
      '<style>' + rptStyle + '</style>' +
      '<div>' + reportHTML + '</div>' +
      '<div style="margin-top:16px;border-top:1px solid #e2e8f0;padding-top:10px;display:flex;justify-content:space-between;font-size:11px;color:#94a3b8">' +
      '<span>' + _esc(bizName) + ' — ' + _esc(reportLabel||'Report') + '</span>' +
      '<span>Printed: ' + rDate + ' ' + rTime + '</span>' +
      '</div></div>';

    openPrintWindow(html, bizName + ' — ' + (reportLabel||'Report'), {
      biz: biz, cfg: cfg, thermal: false, width: 1060, height: 800
    });
  }


  function _hookRTP() {
    if (!global.RTP) return false;

    var _origPrint = global.RTP._print;
    global.RTP._print = function(title) {
      var contentEl = document.getElementById('rpt-content') ||
                      document.querySelector('.rpt-body, #pv-reports .rpt-content');
      if (!contentEl) {
        if (_origPrint) _origPrint.call(global.RTP, title);
        else global.print();
        return;
      }
      printReport(contentEl, title);
    };
    return true;
  }


  function _hookPurchase() {
    if (typeof global.pmPrint === 'function') {
      try {
        Object.defineProperty(global, 'pmPrint', {
          value: function(po) { printPurchase(po); },
          writable: false, configurable: true, enumerable: true
        });
      } catch (e) { console.error('[erp.printer.integration] failed to hook pmPrint', e); }
    }
    if (typeof global.printPurchaseOrder === 'function') {
      try {
        Object.defineProperty(global, 'printPurchaseOrder', {
          value: function(id) {
            _safe(function(){
              var s = ERP._internal && ERP._internal.getState();
              var list = (s && s.data && (s.data.purchases || s.data.purchaseOrders)) || [];
              if (!list.length && typeof PurchaseState !== 'undefined' && PurchaseState.getAllPurchases)
                list = PurchaseState.getAllPurchases() || [];
              var po = list.find(function(p){ return p.id === id; });
              if (po) printPurchase(po);
              else _toast('Purchase order not found', 'error');
            }, 'printPO');
          },
          writable: false, configurable: true, enumerable: true
        });
      } catch (e) { console.error('[erp.printer.integration] failed to hook printPurchaseOrder', e); }
    }
    if (typeof global.printPaymentOut === 'function') {
      global.printPaymentOut = function(id) {
        _safe(function(){
          var payment;
          if (typeof PurchaseState !== 'undefined' && PurchaseState.getPaymentById)
            payment = PurchaseState.getPaymentById(id);
          if (!payment) {
            var s = ERP._internal && ERP._internal.getState();
            var list = (s && s.data && s.data.payOut) || [];
            payment = list.find(function(p){ return p.id === id; });
          }
          if (payment) printPaymentOut(payment);
          else _toast('Payment not found', 'error');
        }, 'printPayOut');
      };
    }
    if (typeof global.PurchaseReturns !== 'undefined' && typeof global.PurchaseReturns.printReturn === 'function') {
      try {
        Object.defineProperty(global.PurchaseReturns, 'printReturn', {
          writable: true,
          configurable: true,
          value: function(id) {
            _safe(function(){
              var ret;
              if (typeof PurchaseState !== 'undefined' && PurchaseState.getReturnById)
                ret = PurchaseState.getReturnById(id);
              if (ret) printPurchaseReturn(ret);
              else _toast('Return not found', 'error');
            }, 'printReturn');
          }
        });
      } catch(e) {
        if (global.DEBUG_MODE) console.warn('[PrintBridge] Could not override PurchaseReturns.printReturn:', e);
      }
    }
  }


  function _hookInventory() {
    if (global.ERP && ERP.inventory && typeof ERP.inventory.printLabel === 'function') {
      ERP.inventory.printLabel = function(bc) {
        _safe(function(){
          var inv = (ERP._internal && ERP._internal.getState().data.inventory) || [];
          var item = inv.find(function(i){ return i.bc === bc || i.barcode === bc; });
          if (!item) { _toast('Item not found: ' + bc, 'error'); return; }
          printInventoryLabel(item);
        }, 'invLabel');
      };
    }
  }


  function _hookWorkshop() {
    if (global.ERP && ERP.jobs) {
      ERP.jobs.printJobCardBridge = printJobCard;
    }
    if (global.ERP && ERP.jobService) {
      ERP.jobService.printJobCardBridge = printJobCard;
    }
  }


  function _hookReportButtons() {
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('.rpt-print-btn,[data-action="reports:print"]');
      if (!btn) return;
      var contentEl = document.getElementById('rpt-content') ||
                      document.querySelector('.rpt-body, #pv-reports .rpt-content, [id^="pv-reports"]');
      if (!contentEl) return;
      e.stopImmediatePropagation();
      var label   = btn.getAttribute('data-title') || btn.getAttribute('data-report') ||
                    (document.getElementById('rpt-title') || {}).textContent || 'Report';
      printReport(contentEl, label.trim());
    }, true);
  }


  var printBridge = {
    version:             '2.0.0',
    getCfg:              getCfg,
    getBiz:              getBiz,
    isThermal:           isThermal,
    openWindow:          openPrintWindow,
    printPurchase:       printPurchase,
    printPurchaseReturn: printPurchaseReturn,
    printPaymentOut:     printPaymentOut,
    printInventoryLabel: printInventoryLabel,
    printJobCard:        printJobCard,
    printReport:         printReport
  };


  function _init() {
    if (global.ERP) {
      global.ERP.printBridge = printBridge;
    }

    _hookPurchase();
    _hookInventory();
    _hookWorkshop();
    _hookReportButtons();

    if (!_hookRTP()) {
      var _rtpAttempts = 0;
      ERP.TimerRegistry.start('printerIntegration.hookRTP', function(){
        if (_hookRTP() || ++_rtpAttempts > 20) ERP.TimerRegistry.clear('printerIntegration.hookRTP');
      }, 300);
    }

    _safe(function(){
      if (ERP.events && ERP.events.emit) ERP.events.emit('printer:bridge:ready', { version:'2.0.0' });
    }, 'emit');

    if (global.DEBUG_MODE) {
      console.info('[PrintBridge v2.0.0] Ready');
      console.info('[PrintBridge] Config:', getCfg());
      console.info('[PrintBridge] Biz:', getBiz());
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

}(window));

;(function (global) {
  'use strict';

  if (global.__ERP_BIZ_PROXY_INSTALLED__) return;

  var _origGetItem = global.localStorage && global.localStorage.getItem
    ? global.localStorage.getItem.bind(global.localStorage)
    : null;
  if (!_origGetItem) return;

  global.__ERP_BIZ_PROXY_INSTALLED__ = true;

  var BIZ_KEY = 'mh_biz_info';

  global.localStorage.getItem = function(key) {
    if (key === BIZ_KEY) {
      try {
        if (global.ERP && global.ERP._internal) {
          var biz = global.ERP._internal.getState().biz || {};
          if (biz.name) {
            var cfg = (global.ERP.printer && global.ERP.printer.getConfig) ? global.ERP.printer.getConfig() : {};
            var merged = Object.assign({}, biz, cfg);
            if (!merged.addr && merged.address) merged.addr = merged.address;
            if (!merged.address && merged.addr)  merged.address = merged.addr;
            return JSON.stringify(merged);
          }
        }
        if (global.ERP && global.ERP.settings && global.ERP.settings.saveBiz) {
          var bizFromSvc = global.ERP.settings._settingsService
            ? (global.ERP.settings._settingsService.getBiz ? global.ERP.settings._settingsService.getBiz() : null)
            : null;
          if (bizFromSvc && bizFromSvc.name) return JSON.stringify(bizFromSvc);
        }
      } catch (e) {
        if (global.DEBUG_MODE) console.warn('[PrintBridge:bizProxy]', e);
      }
    }
    return _origGetItem(key);
  };

  if (global.DEBUG_MODE) console.info('[PrintBridge] BizProxy installed — mh_biz_info reads from live ERP state');

}(window));

;(function (global) {
  'use strict';

  function _hookPurchaseOrders() {
    var PO = global.PurchaseOrders;
    if (!PO || typeof PO.printPO !== 'function') return false;

    var _origPrintPO = PO.printPO;
    try {
      Object.defineProperty(PO, 'printPO', {
        writable: true,
        configurable: true,
        value: function(id) {
          try {
            var bridge = global.ERP && global.ERP.printBridge;
            if (!bridge) { _origPrintPO(id); return; }

            var po;
            if (typeof global.PurchaseState !== 'undefined' && global.PurchaseState.getPOById)
              po = global.PurchaseState.getPOById(id);
            if (!po && global.ERP && global.ERP._internal) {
              var list = (global.ERP._internal.getState().data || {}).purchases || [];
              po = list.find(function(p){ return p.id === id; });
            }

            if (po) bridge.printPurchase(po);
            else _origPrintPO(id);
          } catch(e) {
            if (global.DEBUG_MODE) console.warn('[PrintBridge:hookPO]', e);
            if (typeof _origPrintPO === 'function') _origPrintPO(id);
          }
        }
      });
    } catch(e) {
      if (global.DEBUG_MODE) console.warn('[PrintBridge] Could not override PurchaseOrders.printPO:', e);
    }

    if (typeof global.printPurchaseOrderById === 'function')
      global.printPurchaseOrderById = PO.printPO;

    return true;
  }

  if (!_hookPurchaseOrders()) {
    var _attempts = 0;
    ERP.TimerRegistry.start('printerIntegration.hookPurchaseOrders', function(){
      if (_hookPurchaseOrders() || ++_attempts > 30) ERP.TimerRegistry.clear('printerIntegration.hookPurchaseOrders');
    }, 250);
  }

}(window));

;(function (global) {
  'use strict';

  function _hookPurchaseReturns() {
    var PR = global.PurchaseReturns;
    if (!PR || typeof PR.printReturn !== 'function') return false;

    var _orig = PR.printReturn;
    try {
      Object.defineProperty(PR, 'printReturn', {
        writable: true,
        configurable: true,
        value: function(id) {
          try {
            var bridge = global.ERP && global.ERP.printBridge;
            if (!bridge) { _orig(id); return; }

            var ret;
            if (typeof global.PurchaseState !== 'undefined' && global.PurchaseState.getReturnById)
              ret = global.PurchaseState.getReturnById(id);
            if (!ret && global.ERP && global.ERP._internal) {
              var list = ((global.ERP._internal.getState().data || {}).purchaseReturns) || [];
              ret = list.find(function(r){ return r.id === id; });
            }

            if (ret) bridge.printPurchaseReturn(ret);
            else _orig(id);
          } catch(e) {
            if (global.DEBUG_MODE) console.warn('[PrintBridge:hookPR]', e);
            if (typeof _orig === 'function') _orig(id);
          }
        }
      });
    } catch(e) {
      if (global.DEBUG_MODE) console.warn('[PrintBridge] Could not hook PurchaseReturns.printReturn:', e);
      return false;
    }
    return true;
  }

  if (!_hookPurchaseReturns()) {
    // NOTE (found during timer migration, not fixed here -- flagging, not
    // silently changing behavior): _c2 is declared *inside* the interval
    // callback below, so it resets to 0 every tick and ++_c2 > 30 can never
    // be true. Unlike its sibling timers, this one never stops on an attempt
    // limit -- only if _hookPurchaseReturns() eventually succeeds. Preserved
    // as-is; worth a follow-up if you want it closed.
    ERP.TimerRegistry.start('printerIntegration.hookPurchaseReturns', function(){
      var _c2 = 0;
      if (_hookPurchaseReturns() || ++_c2 > 30) ERP.TimerRegistry.clear('printerIntegration.hookPurchaseReturns');
    }, 250);
  }

}(window));

;(function (global) {
  'use strict';

  function _hookPaymentOut() {
    if (typeof global.printPaymentOut !== 'function') return false;
    var _orig = global.printPaymentOut;
    global.printPaymentOut = function(id) {
      try {
        var bridge = global.ERP && global.ERP.printBridge;
        if (!bridge) { _orig(id); return; }

        var payment;
        if (typeof global.PurchaseState !== 'undefined' && global.PurchaseState.getPaymentById)
          payment = global.PurchaseState.getPaymentById(id);
        if (!payment) {
          var PP = global.PurchasePayments;
          if (PP && typeof PP.getPaymentById === 'function') payment = PP.getPaymentById(id);
        }
        if (!payment && global.ERP && global.ERP._internal) {
          var list = ((global.ERP._internal.getState().data || {}).payOut) || [];
          payment = list.find(function(p){ return p.id === id; });
        }

        if (payment) bridge.printPaymentOut(payment);
        else _orig(id);
      } catch(e) {
        if (global.DEBUG_MODE) console.warn('[PrintBridge:hookPayOut]', e);
        if (typeof _orig === 'function') _orig(id);
      }
    };
    if (global.PurchasePayments) {
      try {
        Object.defineProperty(global.PurchasePayments, 'printPaymentOut', {
          value: global.printPaymentOut, writable: true, configurable: true, enumerable: true
        });
      } catch (_e) {
        if (global.DEBUG_MODE) console.warn('[PrintBridge:hookPayOut] defineProperty failed', _e);
      }
    }
    return true;
  }

  if (!_hookPaymentOut()) {
    // NOTE (same pre-existing counter-reset bug as hookPurchaseReturns above):
    // _c3 resets every tick, so this never self-terminates on attempt count.
    ERP.TimerRegistry.start('printerIntegration.hookPaymentOut', function(){
      var _c3 = 0;
      if (_hookPaymentOut() || ++_c3 > 30) ERP.TimerRegistry.clear('printerIntegration.hookPaymentOut');
    }, 250);
  }

}(window));

;(function (global) {
  'use strict';

  function _hookPurchaseUI() {
    var changed = false;

    if (typeof global.pmPrint === 'function' && !global.pmPrint.__bridged__) {
      var _origPmPrint = global.pmPrint;
      var _bridgedPmPrint = function(po) {
        try {
          var bridge = global.ERP && global.ERP.printBridge;
          if (bridge && po) bridge.printPurchase(po);
          else _origPmPrint(po);
        } catch(e) { _origPmPrint(po); }
      };
      _bridgedPmPrint.__bridged__ = true;
      try {
        Object.defineProperty(global, 'pmPrint', {
          value: _bridgedPmPrint, writable: false, configurable: true, enumerable: true
        });
        changed = true;
      } catch (e) { console.error('[erp.printer.integration] failed to bridge pmPrint', e); }
    }

    if (typeof global.printPurchaseOrder === 'function' && !global.printPurchaseOrder.__bridged__) {
      var _origPPO = global.printPurchaseOrder;
      var _bridgedPPO = function(id) {
        try {
          var bridge = global.ERP && global.ERP.printBridge;
          if (!bridge) { _origPPO(id); return; }
          var po;
          if (global.PurchaseState && global.PurchaseState.getAllPurchases) {
            var list = global.PurchaseState.getAllPurchases() || [];
            po = list.find(function(p){ return p.id === id; });
          }
          if (!po && global.ERP && global.ERP._internal) {
            var s = global.ERP._internal.getState();
            var ls = (s.data && (s.data.purchases || s.data.purchaseOrders)) || [];
            po = ls.find(function(p){ return p.id === id; });
          }
          if (po) bridge.printPurchase(po);
          else _origPPO(id);
        } catch(e) { _origPPO(id); }
      };
      _bridgedPPO.__bridged__ = true;
      try {
        Object.defineProperty(global, 'printPurchaseOrder', {
          value: _bridgedPPO, writable: false, configurable: true, enumerable: true
        });
        changed = true;
      } catch (e) { console.error('[erp.printer.integration] failed to bridge printPurchaseOrder', e); }
    }

    return changed;
  }

  if (!_hookPurchaseUI()) {
    // NOTE (same pre-existing counter-reset bug): _c4 resets every tick.
    ERP.TimerRegistry.start('printerIntegration.hookPurchaseUI', function(){
      var _c4 = 0;
      if (_hookPurchaseUI() || ++_c4 > 30) ERP.TimerRegistry.clear('printerIntegration.hookPurchaseUI');
    }, 250);
  }

}(window));

;(function (global) {
  'use strict';

  global.printJobCardBridge = function(jobOrId) {
    var bridge = global.ERP && global.ERP.printBridge;
    if (!bridge) return;

    var job = (typeof jobOrId === 'object') ? jobOrId : null;
    if (!job) {
      var id = jobOrId;
      if (global.ERP && global.ERP._internal) {
        var list = ((global.ERP._internal.getState().data || {}).jobs) || [];
        job = list.find(function(j){ return j.id === id; });
      }
    }

    if (job) bridge.printJobCard(job);
    else if (global.ERP && global.ERP.ui && global.ERP.ui.toast)
      global.ERP.ui.toast('Job not found', 'error');
  };

}(window));

;(function (global) {
  'use strict';

  function _hookInvLabel() {
    if (!global.ERP || !global.ERP.inventory || typeof global.ERP.inventory.printLabel !== 'function') return false;
    if (global.ERP.inventory.printLabel.__bridged__) return true;

    var _orig = global.ERP.inventory.printLabel;
    global.ERP.inventory.printLabel = function(bc) {
      try {
        var bridge = global.ERP.printBridge;
        if (!bridge) { _orig(bc); return; }
        var inv = (global.ERP._internal && global.ERP._internal.getState().data.inventory) || [];
        var item = inv.find(function(i){ return i.bc === bc || i.barcode === bc; });
        if (item) bridge.printInventoryLabel(item);
        else _orig(bc);
      } catch(e) { _orig(bc); }
    };
    global.ERP.inventory.printLabel.__bridged__ = true;
    return true;
  }

  if (!_hookInvLabel()) {
    // NOTE (same pre-existing counter-reset bug): _c5 resets every tick.
    ERP.TimerRegistry.start('printerIntegration.hookInvLabel', function(){
      var _c5 = 0;
      if (_hookInvLabel() || ++_c5 > 30) ERP.TimerRegistry.clear('printerIntegration.hookInvLabel');
    }, 250);
  }

}(window));

;(function (global) {
  'use strict';

  function _hookRTP() {
    if (!global.RTP || typeof global.RTP._print !== 'function') return false;
    if (global.RTP._print.__bridged__) return true;

    var _orig = global.RTP._print;
    global.RTP._print = function(title) {
      try {
        var bridge = global.ERP && global.ERP.printBridge;
        if (!bridge) { _orig.call(global.RTP, title); return; }
        var contentEl = document.getElementById('rpt-content') ||
                        document.querySelector('.rpt-body, #pv-reports .rpt-content');
        if (!contentEl) { _orig.call(global.RTP, title); return; }
        bridge.printReport(contentEl, title);
      } catch(e) {
        if (global.DEBUG_MODE) console.warn('[PrintBridge:hookRTP]', e);
        _orig.call(global.RTP, title);
      }
    };
    global.RTP._print.__bridged__ = true;

    if (typeof global.printCurrentPage === 'function' && !global.printCurrentPage.__bridged__) {
      var _origPC = global.printCurrentPage;
      global.printCurrentPage = function(title) {
        try {
          var bridge = global.ERP && global.ERP.printBridge;
          if (!bridge) { _origPC(title); return; }
          var contentEl = document.getElementById('rpt-content') ||
                          document.querySelector('.rpt-body, #pv-reports .rpt-content');
          if (!contentEl) { _origPC(title); return; }
          bridge.printReport(contentEl, title || 'Report');
        } catch(e) { _origPC(title); }
      };
      global.printCurrentPage.__bridged__ = true;
    }

    return true;
  }

  if (!_hookRTP()) {
    // NOTE (same pre-existing counter-reset bug): _c6 resets every tick.
    // Named distinctly from the earlier hookRTP timer (different closure/IIFE).
    ERP.TimerRegistry.start('printerIntegration.hookRTP2', function(){
      var _c6 = 0;
      if (_hookRTP() || ++_c6 > 40) ERP.TimerRegistry.clear('printerIntegration.hookRTP2');
    }, 250);
  }

}(window));

;(function (global) {
  'use strict';

  function _syncBizToLocalStorage() {
    try {
      if (!global.ERP || !global.ERP._internal) return;
      var biz = global.ERP._internal.getState().biz || {};
      if (!biz.name) return;
      var cfg = (global.ERP.printer && global.ERP.printer.getConfig) ? global.ERP.printer.getConfig() : {};
      var merged = Object.assign({}, biz, cfg);
      if (!merged.addr && merged.address) merged.addr = merged.address;
      var realSetItem = global.Storage && global.Storage.prototype && global.Storage.prototype.setItem
        ? global.Storage.prototype.setItem.bind(global.localStorage)
        : function(k, v){ global.localStorage.setItem(k, v); };
      realSetItem('mh_biz_info', JSON.stringify(merged));
    } catch(e) {
      if (global.DEBUG_MODE) console.warn('[PrintBridge:syncBiz]', e);
    }
  }

  if (global.ERP && global.ERP.EventBus && global.ERP.EventBus.on) {
    global.ERP.EventBus.on('biz:updated', _syncBizToLocalStorage);
    global.ERP.EventBus.on('settings:saved', _syncBizToLocalStorage);
    global.ERP.EventBus.on('printer:saved', _syncBizToLocalStorage);
  } else {
    function _tryBindEvents() {
      if (global.ERP && global.ERP.EventBus && global.ERP.EventBus.on) {
        global.ERP.EventBus.on('biz:updated', _syncBizToLocalStorage);
        global.ERP.EventBus.on('settings:saved', _syncBizToLocalStorage);
        global.ERP.EventBus.on('printer:saved', _syncBizToLocalStorage);
      }
    }
    document.addEventListener('DOMContentLoaded', _tryBindEvents);
    setTimeout(_syncBizToLocalStorage, 1500);
  }

  setTimeout(_syncBizToLocalStorage, 2000);

}(window));

if (window.DEBUG_MODE) console.info('[PrintBridge v2.0.0] All sections loaded — full ERP print integration active');
