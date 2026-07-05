'use strict';

(function (ERP) {

  function _esc(s) {
    if (ERP.escapeHtml && typeof ERP.escapeHtml === 'function') return ERP.escapeHtml(s);
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _safeLogo(url) {
    if (!url || typeof url !== 'string') return '';
    if (/^(https?:\/\/)/i.test(url)) return url;
    if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,/i.test(url)) return url;
    return '';
  }

  function _round2(n) {
    var num = Number(n);
    if (isNaN(num)) num = 0;
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  function _fmt(n) {
    var num = _round2(n);
    if (ERP.fmt && typeof ERP.fmt === 'function') return ERP.fmt(num);
    var biz = (ERP._salesState && ERP._salesState.getBiz) ? ERP._salesState.getBiz() : {};
    var currency = biz.currency || 'Rs';
    var locale = biz.locale || (typeof navigator !== 'undefined' ? navigator.language : 'en-PK') || 'en-PK';
    try {
      return currency + ' ' + num.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch (e) {
      return currency + ' ' + num.toFixed(2);
    }
  }
  ERP._salesFmt = _fmt;

  function _fmtDateWithFormat(d, fmt) {
    if (!d) return '';
    var dt = new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    var dd = String(dt.getDate()).padStart(2, '0');
    var mm = String(dt.getMonth() + 1).padStart(2, '0');
    var yy = dt.getFullYear();
    var mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (fmt === 'mm/dd/yyyy') return mm + '/' + dd + '/' + yy;
    if (fmt === 'dd-Mon-yyyy') return dd + '-' + mons[dt.getMonth()] + '-' + yy;
    return dd + '/' + mm + '/' + yy;
  }

  var _BADGE_MAP = {
    'paid': 'b-green', 'credit': 'b-orange', 'partial': 'b-blue', 'unpaid': 'b-red', 'overpaid': 'b-purple',
    'returned': 'b-gray', 'pending': 'b-orange', 'approved': 'b-green', 'fulfilled': 'b-green',
    'cancelled': 'b-red', 'delivered': 'b-green', 'invoiced': 'b-teal', 'refunded': 'b-purple'
  };
  var _BADGE_STYLE = {
    'invoiced': 'background:#ccfbf1;color:#0d9488', 'refunded': 'background:#f3e8ff;color:#7c3aed',
    'credit': 'background:#ffedd5;color:#ea580c', 'partial': 'background:#dbeafe;color:#1d4ed8',
    'pending': 'background:#ffedd5;color:#ea580c', 'unpaid': 'background:#fee2e2;color:#dc2626',
    'paid': 'background:#dcfce7;color:#16a34a', 'returned': 'background:#f1f5f9;color:#64748b',
    'approved': 'background:#dcfce7;color:#16a34a', 'fulfilled': 'background:#dcfce7;color:#16a34a',
    'cancelled': 'background:#fee2e2;color:#dc2626', 'delivered': 'background:#dcfce7;color:#16a34a',
    'overpaid': 'background:#f3e8ff;color:#7c3aed'
  };
  function _badge(st) { return _BADGE_MAP[st] || 'b-gray'; }
  function _badgeStyle(st) { var s = _BADGE_STYLE[st]; return s ? ' style="' + s + '"' : ''; }

  function _taxBreakdown(taxAmt) {
    if (!taxAmt || taxAmt <= 0) return '';
    var half = _round2(taxAmt / 2);
    var other = _round2(taxAmt - half);
    return '<div style="font-size:10px;color:#0284c7;margin-top:2px">CGST: ' + _fmt(half) + ' | SGST: ' + _fmt(other) + '</div>';
  }

  function _calcItemAmt(it) {
    var q = Number(it.q) || 0;
    var p = Number(it.p) || 0;
    var d = Number(it.d) || 0;
    var tax = Number(it.taxAmt) || 0;
    return _round2((q * p) - d + tax);
  }

  function _discDisp(it) {
    if (it.discPct) return it.discPct + '%';
    var d = Number(it.d) || 0;
    return d > 0 ? _fmt(d) : '—';
  }

  function _lightTable(inv, color, f) {
    var totalQty = (inv.items || []).reduce(function (a, i) { return a + (Number(i.q) || 0); }, 0);
    var rows = (inv.items || []).map(function (it, idx) {
      var amt = _calcItemAmt(it);
      return '<tr style="background:' + (idx % 2 === 0 ? '#fff' : '#f8fafc') + ';border-bottom:1px solid #f1f5f9">' +
        '<td style="padding:8px 12px;color:#94a3b8;font-size:11px;text-align:center">' + (idx + 1) + '</td>' +
        '<td style="padding:8px 12px;font-weight:600;color:var(--text,#1e293b);font-size:12px">' + _esc(it.n || '') + '</td>' +
        '<td style="padding:8px 12px;text-align:center;color:var(--muted,#64748b);font-size:11px">' + _esc(it.hsn || '—') + '</td>' +
        '<td style="padding:8px 12px;text-align:center;font-weight:600;color:#334155">' + (Number(it.q) || 0) + '</td>' +
        '<td style="padding:8px 12px;text-align:right;color:#475569;font-size:11px">' + _fmt(it.p || 0) + '</td>' +
        '<td style="padding:8px 12px;text-align:right;color:#dc2626;font-size:11px">' + _discDisp(it) + '</td>' +
        '<td style="padding:8px 12px;text-align:right;color:#0284c7;font-size:11px">' + ((Number(it.taxAmt) || 0) > 0 ? _fmt(it.taxAmt) : '—') + '</td>' +
        '<td style="padding:8px 12px;text-align:right;font-weight:700;color:' + color + '">' + _fmt(amt) + '</td>' +
        '</tr>';
    }).join('');
    return '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<thead><tr style="background:' + color + '">' +
      '<th style="padding:9px 12px;color:#fff;text-align:center;font-size:10px;font-weight:700;width:28px">#</th>' +
      '<th style="padding:9px 12px;color:#fff;text-align:left;font-size:10px;font-weight:700">Item</th>' +
      '<th style="padding:9px 12px;color:rgba(255,255,255,.8);text-align:center;font-size:10px;font-weight:700">HSN/SAC</th>' +
      '<th style="padding:9px 12px;color:rgba(255,255,255,.8);text-align:center;font-size:10px;font-weight:700">Qty</th>' +
      '<th style="padding:9px 12px;color:rgba(255,255,255,.8);text-align:right;font-size:10px;font-weight:700">Price/Unit</th>' +
      '<th style="padding:9px 12px;color:rgba(255,255,255,.8);text-align:right;font-size:10px;font-weight:700">Discount</th>' +
      '<th style="padding:9px 12px;color:rgba(255,255,255,.8);text-align:right;font-size:10px;font-weight:700">GST</th>' +
      '<th style="padding:9px 12px;color:#fff;text-align:right;font-size:10px;font-weight:700">Amount</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tfoot><tr style="background:var(--bg,#f8fafc);border-top:2px solid #e2e8f0">' +
      '<td colspan="3" style="padding:10px 12px;font-weight:700;font-size:12px;color:var(--text,#0f172a)">Total</td>' +
      '<td style="padding:10px 12px;text-align:center;font-weight:700;color:var(--text,#0f172a)">' + totalQty + '</td>' +
      '<td></td>' +
      '<td style="padding:10px 12px;text-align:right;font-weight:700;color:#dc2626">' + _fmt(f.disc) + '</td>' +
      '<td style="padding:10px 12px;text-align:right;font-weight:700;color:#0284c7">' + _fmt(f.tax) + '</td>' +
      '<td style="padding:10px 12px;text-align:right;font-weight:800;color:' + color + ';font-size:13px">' + _fmt(f.grand) + '</td>' +
      '</tr></tfoot>' +
      '</table>';
  }

  function _lightTotals(f, color) {
    var showBalRow = Math.abs(f.bal) > 0.001;
    return '<div style="display:flex;flex-direction:column;gap:2px">' +
      '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed #e2e8f0"><span style="font-size:12px;color:var(--muted,#64748b)">Sub Total</span><span style="font-size:12px;font-weight:600;color:var(--text,#0f172a)">' + _fmt(f.sub) + '</span></div>' +
      (f.disc > 0 ? '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed #e2e8f0"><span style="font-size:12px;color:#dc2626">Discount</span><span style="font-size:12px;font-weight:600;color:#dc2626">-' + _fmt(f.disc) + '</span></div>' : '') +
      (f.tax > 0 ? '<div style="display:flex;flex-direction:column;padding:8px 0;border-bottom:1px dashed #e2e8f0"><div style="display:flex;justify-content:space-between"><span style="font-size:12px;color:#0284c7">Tax (GST)</span><span style="font-size:12px;font-weight:600;color:#0284c7">' + _fmt(f.tax) + '</span></div>' + _taxBreakdown(f.tax) + '</div>' : '') +
      '<div style="display:flex;justify-content:space-between;padding:10px 14px;margin:6px 0;border-radius:8px;background:' + color + '"><span style="font-size:14px;font-weight:800;color:#fff">Total</span><span style="font-size:16px;font-weight:900;color:#fff">' + _fmt(f.grand) + '</span></div>' +
      (f.paid > 0 ? '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed #e2e8f0"><span style="font-size:12px;color:#16a34a">Paid</span><span style="font-size:12px;font-weight:600;color:#16a34a">' + _fmt(f.paid) + '</span></div>' : '') +
      (showBalRow ? '<div style="display:flex;justify-content:space-between;padding:8px 0"><span style="font-size:13px;font-weight:700;color:var(--text,#0f172a)">Balance Due</span><span style="font-size:14px;font-weight:800;color:' + (f.bal > 0 ? '#dc2626' : '#16a34a') + '">' + _fmt(f.bal) + '</span></div>' : '') +
      '</div>';
  }

  function _lightFooter(inv, biz, f, numWords, borderColor, textColor, mutedColor) {
    borderColor = borderColor || '#e2e8f0';
    textColor = textColor || '#0f172a';
    mutedColor = mutedColor || '#64748b';
    var wordsStr = '';
    try {
      wordsStr = numWords && typeof numWords === 'function' ? numWords(f.grand) : (ERP._salesSvc && ERP._salesSvc._numWords ? ERP._salesSvc._numWords(f.grand) : '');
    } catch (e) { wordsStr = ''; }
    var _showQR = biz ? biz.showQROnPrint !== false : true;
    var _showSig = biz ? biz.showSignatureBox === true : false;
    var _showStamp = biz ? biz.showStampOnPrint !== false : true;
    var qrSrc = inv.qrCode || (biz && biz.qrCode) || '';
    var qr = (_showQR && qrSrc)
      ? '<div style="text-align:center;margin-top:10px"><img src="' + qrSrc + '" style="width:80px;height:80px;border:1px solid ' + borderColor + ';border-radius:6px;object-fit:contain" onerror="this.style.display=\'none\'"><div style="font-size:9px;color:' + mutedColor + ';margin-top:3px;font-weight:600">Scan to Pay</div></div>'
      : '';
    var bankBlock = (biz && (biz.bankName || biz.bankAcc || biz.bankUpi))
      ? '<div style="margin-top:12px;padding:10px 12px;background:var(--bg,#f8fafc);border:1px solid ' + borderColor + ';border-radius:8px">'
      + '<div style="font-weight:700;color:' + textColor + ';font-size:10px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Payment Details</div>'
      + (biz.bankName ? '<div style="font-size:11px;color:#374151"><b>Bank:</b> ' + _esc(biz.bankName) + '</div>' : '')
      + (biz.bankTitle ? '<div style="font-size:11px;color:#374151"><b>Account:</b> ' + _esc(biz.bankTitle) + '</div>' : '')
      + (biz.bankAcc ? '<div style="font-size:11px;color:#374151"><b>No:</b> ' + _esc(biz.bankAcc) + '</div>' : '')
      + (biz.bankIban ? '<div style="font-size:11px;color:#374151"><b>IBAN:</b> ' + _esc(biz.bankIban) + '</div>' : '')
      + (biz.bankUpi ? '<div style="font-size:11px;color:#374151"><b>EasyPaisa/JazzCash:</b> ' + _esc(biz.bankUpi) + '</div>' : '')
      + '</div>'
      : '';
    return '<div style="font-size:11px;line-height:1.7;border-top:1px solid ' + borderColor + ';padding-top:14px;margin-top:12px">' +
      '<div style="font-weight:700;color:' + textColor + ';margin-bottom:2px;font-size:10px;text-transform:uppercase;letter-spacing:.5px">Amount In Words</div>' +
      '<div style="font-style:italic;color:' + mutedColor + ';margin-bottom:10px">' + wordsStr + ' Rupees only</div>' +
      (inv.terms ? '<div style="font-weight:700;color:' + textColor + ';margin-bottom:2px;font-size:10px;text-transform:uppercase;letter-spacing:.5px">Terms &amp; Conditions</div><div style="color:' + mutedColor + '">' + _esc(inv.terms) + '</div>' : '') +
      bankBlock +
      qr +
      (_showStamp && f.bal <= 0 && f.grand > 0
        ? '<div style="position:relative;margin:20px 0 0"><div style="display:inline-block;border:3px solid #166534;color:#166534;font-size:22px;font-weight:900;padding:6px 18px;border-radius:6px;letter-spacing:4px;transform:rotate(-8deg);opacity:.85">&#10003; PAID</div></div>'
        : '') +
      (_showSig
        ? '<div style="margin-top:32px;display:flex;justify-content:flex-end"><div style="border-top:1px solid ' + borderColor + ';width:200px;padding-top:4px;text-align:center;font-size:10px;color:' + mutedColor + '">Authorized Signature</div></div>'
        : '<div style="margin-top:32px;border-top:1px solid ' + borderColor + ';padding-top:6px;font-size:10px;color:' + mutedColor + ';text-align:right;font-style:italic">For ' + _esc(biz.name) + ' — Authorized Signatory</div>') +
      '</div>';
  }

  function _darkTable(inv, accentColor, rowEven, rowOdd, headerBg, textColor, mutedColor, f) {
    var totalQty = (inv.items || []).reduce(function (a, i) { return a + (Number(i.q) || 0); }, 0);
    var rows = (inv.items || []).map(function (it, idx) {
      var amt = _calcItemAmt(it);
      return '<tr style="background:' + (idx % 2 === 0 ? rowEven : rowOdd) + ';border-bottom:1px solid rgba(255,255,255,.04)">' +
        '<td style="padding:8px 12px;color:' + mutedColor + ';font-size:11px;text-align:center">' + (idx + 1) + '</td>' +
        '<td style="padding:8px 12px;font-weight:600;color:' + textColor + ';font-size:12px">' + _esc(it.n || '') + '</td>' +
        '<td style="padding:8px 12px;text-align:center;color:' + mutedColor + ';font-size:11px">' + _esc(it.hsn || '—') + '</td>' +
        '<td style="padding:8px 12px;text-align:center;color:rgba(255,255,255,.65);font-size:11px">' + (Number(it.q) || 0) + '</td>' +
        '<td style="padding:8px 12px;text-align:right;color:rgba(255,255,255,.55);font-size:11px">' + _fmt(it.p || 0) + '</td>' +
        '<td style="padding:8px 12px;text-align:right;color:#f87171;font-size:11px">' + _discDisp(it) + '</td>' +
        '<td style="padding:8px 12px;text-align:right;color:#60a5fa;font-size:11px">' + ((Number(it.taxAmt) || 0) > 0 ? _fmt(it.taxAmt) : '—') + '</td>' +
        '<td style="padding:8px 12px;text-align:right;font-weight:700;color:' + accentColor + ';font-size:12px">' + _fmt(amt) + '</td>' +
        '</tr>';
    }).join('');
    return '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<thead><tr style="background:' + headerBg + ';border-bottom:1px solid ' + accentColor + '44">' +
      '<th style="padding:9px 12px;color:' + accentColor + ';text-align:center;font-size:10px;font-weight:700;width:28px;letter-spacing:1px">#</th>' +
      '<th style="padding:9px 12px;color:' + accentColor + ';text-align:left;font-size:10px;font-weight:700;letter-spacing:1px">ITEM</th>' +
      '<th style="padding:9px 12px;color:' + mutedColor + ';text-align:center;font-size:10px;font-weight:700;letter-spacing:1px">HSN/SAC</th>' +
      '<th style="padding:9px 12px;color:' + mutedColor + ';text-align:center;font-size:10px;font-weight:700;letter-spacing:1px">QTY</th>' +
      '<th style="padding:9px 12px;color:' + mutedColor + ';text-align:right;font-size:10px;font-weight:700;letter-spacing:1px">PRICE</th>' +
      '<th style="padding:9px 12px;color:' + mutedColor + ';text-align:right;font-size:10px;font-weight:700;letter-spacing:1px">DISC</th>' +
      '<th style="padding:9px 12px;color:' + mutedColor + ';text-align:right;font-size:10px;font-weight:700;letter-spacing:1px">GST</th>' +
      '<th style="padding:9px 12px;color:' + accentColor + ';text-align:right;font-size:10px;font-weight:700;letter-spacing:1px">AMOUNT</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tfoot><tr style="background:' + headerBg + ';border-top:1px solid ' + accentColor + '33">' +
      '<td colspan="3" style="padding:10px 12px;font-weight:700;font-size:12px;color:' + textColor + '">Total</td>' +
      '<td style="padding:10px 12px;text-align:center;font-weight:700;color:' + textColor + '">' + totalQty + '</td>' +
      '<td></td>' +
      '<td style="padding:10px 12px;text-align:right;font-weight:700;color:#f87171">' + _fmt(f.disc) + '</td>' +
      '<td style="padding:10px 12px;text-align:right;font-weight:700;color:#60a5fa">' + _fmt(f.tax) + '</td>' +
      '<td style="padding:10px 12px;text-align:right;font-weight:900;color:' + accentColor + ';font-size:14px">' + _fmt(f.grand) + '</td>' +
      '</tr></tfoot>' +
      '</table>';
  }

  function _darkTotals(f, accentColor) {
    var brd = 'rgba(255,255,255,.1)';
    var showBalRow = Math.abs(f.bal) > 0.001;
    return '<div style="display:flex;flex-direction:column;gap:2px">' +
      '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed ' + brd + '"><span style="font-size:12px;color:rgba(255,255,255,.4)">Sub Total</span><span style="font-size:12px;font-weight:600;color:rgba(255,255,255,.7)">' + _fmt(f.sub) + '</span></div>' +
      (f.disc > 0 ? '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed ' + brd + '"><span style="font-size:12px;color:#f87171">Discount</span><span style="font-size:12px;font-weight:600;color:#f87171">-' + _fmt(f.disc) + '</span></div>' : '') +
      (f.tax > 0 ? '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed ' + brd + '"><span style="font-size:12px;color:#60a5fa">Tax (GST)</span><span style="font-size:12px;font-weight:600;color:#60a5fa">' + _fmt(f.tax) + '</span></div>' : '') +
      '<div style="display:flex;justify-content:space-between;padding:10px 14px;margin:6px 0;border-radius:8px;background:' + accentColor + '"><span style="font-size:14px;font-weight:800;color:#fff">Total</span><span style="font-size:16px;font-weight:900;color:#fff">' + _fmt(f.grand) + '</span></div>' +
      (f.paid > 0 ? '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed ' + brd + '"><span style="font-size:12px;color:#4ade80">Paid</span><span style="font-size:12px;font-weight:600;color:#4ade80">' + _fmt(f.paid) + '</span></div>' : '') +
      (showBalRow ? '<div style="display:flex;justify-content:space-between;padding:8px 0"><span style="font-size:13px;font-weight:700;color:#f1f5f9">Balance Due</span><span style="font-size:14px;font-weight:800;color:' + (f.bal > 0 ? '#f87171' : '#4ade80') + '">' + _fmt(f.bal) + '</span></div>' : '') +
      '</div>';
  }

  function _darkFooter(inv, biz, f, numWords, accentColor, mutedColor) {
    var wordsStr = '';
    try {
      wordsStr = numWords && typeof numWords === 'function' ? numWords(f.grand) : (ERP._salesSvc && ERP._salesSvc._numWords ? ERP._salesSvc._numWords(f.grand) : '');
    } catch (e) { wordsStr = ''; }
    return '<div style="font-size:11px;line-height:1.7;border-top:1px solid rgba(255,255,255,.08);padding-top:14px;margin-top:12px">' +
      '<div style="font-weight:700;color:' + accentColor + ';margin-bottom:2px;font-size:9px;text-transform:uppercase;letter-spacing:1px">Amount In Words</div>' +
      '<div style="font-style:italic;color:' + mutedColor + ';margin-bottom:10px">' + wordsStr + ' Rupees only</div>' +
      (inv.terms ? '<div style="font-weight:700;color:' + accentColor + ';margin-bottom:2px;font-size:9px;text-transform:uppercase;letter-spacing:1px">Terms</div><div style="color:' + mutedColor + '">' + _esc(inv.terms) + '</div>' : '') +
      '<div style="margin-top:32px;border-top:1px solid rgba(255,255,255,.1);padding-top:6px;font-size:10px;color:' + mutedColor + ';text-align:right;font-style:italic">For ' + _esc(biz.name) + ' — Authorized Signatory</div>' +
      '</div>';
  }

  function _retroTable(inv, f) {
    var totalQty = (inv.items || []).reduce(function (a, i) { return a + (Number(i.q) || 0); }, 0);
    var rows = (inv.items || []).map(function (it, idx) {
      var amt = _calcItemAmt(it);
      return '<tr style="background:' + (idx % 2 === 0 ? '#f5f0e8' : '#ede8dc') + ';border-bottom:1px solid #d4c4a0">' +
        '<td style="padding:7px 10px;color:#8b7355;font-size:11px;text-align:center">' + (idx + 1) + '</td>' +
        '<td style="padding:7px 10px;font-weight:700;color:#2c1a0e;font-size:12px">' + _esc(it.n || '') + '</td>' +
        '<td style="padding:7px 10px;text-align:center;color:#6b5a44;font-size:11px">' + _esc(it.hsn || '—') + '</td>' +
        '<td style="padding:7px 10px;text-align:center;font-weight:700;color:#2c1a0e">' + (Number(it.q) || 0) + '</td>' +
        '<td style="padding:7px 10px;text-align:right;color:#4a3728;font-size:11px">' + _fmt(it.p || 0) + '</td>' +
        '<td style="padding:7px 10px;text-align:right;color:#8b3a3a;font-size:11px">' + _discDisp(it) + '</td>' +
        '<td style="padding:7px 10px;text-align:right;color:#3a5a8b;font-size:11px">' + ((Number(it.taxAmt) || 0) > 0 ? _fmt(it.taxAmt) : '—') + '</td>' +
        '<td style="padding:7px 10px;text-align:right;font-weight:900;color:#2c1a0e;font-size:12px">' + _fmt(amt) + '</td>' +
        '</tr>';
    }).join('');
    return '<table style="width:100%;border-collapse:collapse;font-size:12px;font-family:\'Courier New\',Courier,monospace">' +
      '<thead><tr style="background:#8b7355">' +
      '<th style="padding:8px 10px;color:#f5f0e8;text-align:center;font-size:9px;font-weight:700;width:28px;letter-spacing:1px">#</th>' +
      '<th style="padding:8px 10px;color:#f5f0e8;text-align:left;font-size:9px;font-weight:700;letter-spacing:1px">ITEM DESCRIPTION</th>' +
      '<th style="padding:8px 10px;color:#e8dfc8;text-align:center;font-size:9px;font-weight:700;letter-spacing:1px">HSN/SAC</th>' +
      '<th style="padding:8px 10px;color:#e8dfc8;text-align:center;font-size:9px;font-weight:700;letter-spacing:1px">QTY</th>' +
      '<th style="padding:8px 10px;color:#e8dfc8;text-align:right;font-size:9px;font-weight:700;letter-spacing:1px">RATE</th>' +
      '<th style="padding:8px 10px;color:#e8dfc8;text-align:right;font-size:9px;font-weight:700;letter-spacing:1px">DISC</th>' +
      '<th style="padding:8px 10px;color:#e8dfc8;text-align:right;font-size:9px;font-weight:700;letter-spacing:1px">TAX</th>' +
      '<th style="padding:8px 10px;color:#f5f0e8;text-align:right;font-size:9px;font-weight:700;letter-spacing:1px">AMOUNT</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tfoot><tr style="background:#ede8dc;border-top:2px solid #8b7355">' +
      '<td colspan="3" style="padding:9px 10px;font-weight:900;font-size:12px;color:#2c1a0e">TOTAL</td>' +
      '<td style="padding:9px 10px;text-align:center;font-weight:900;color:#2c1a0e">' + totalQty + '</td>' +
      '<td></td>' +
      '<td style="padding:9px 10px;text-align:right;font-weight:700;color:#8b3a3a">' + _fmt(f.disc) + '</td>' +
      '<td style="padding:9px 10px;text-align:right;font-weight:700;color:#3a5a8b">' + _fmt(f.tax) + '</td>' +
      '<td style="padding:9px 10px;text-align:right;font-weight:900;color:#2c1a0e;font-size:14px">' + _fmt(f.grand) + '</td>' +
      '</tr></tfoot>' +
      '</table>';
  }

  function _elegantTable(inv, f) {
    var totalQty = (inv.items || []).reduce(function (a, i) { return a + (Number(i.q) || 0); }, 0);
    var rows = (inv.items || []).map(function (it, idx) {
      var amt = _calcItemAmt(it);
      return '<tr style="background:' + (idx % 2 === 0 ? '#fffdf5' : '#faf8ef') + ';border-bottom:1px solid #e8d5a0">' +
        '<td style="padding:9px 12px;color:#a0875a;font-size:11px;text-align:center;font-style:italic">' + (idx + 1) + '</td>' +
        '<td style="padding:9px 12px;font-weight:600;color:#1a1a1a;font-size:12px">' + _esc(it.n || '') + '</td>' +
        '<td style="padding:9px 12px;text-align:center;color:#8b7a4a;font-size:11px">' + _esc(it.hsn || '—') + '</td>' +
        '<td style="padding:9px 12px;text-align:center;font-weight:600;color:#2d2d2d">' + (Number(it.q) || 0) + '</td>' +
        '<td style="padding:9px 12px;text-align:right;color:#5a5a3a;font-size:11px">' + _fmt(it.p || 0) + '</td>' +
        '<td style="padding:9px 12px;text-align:right;color:#a05030;font-size:11px">' + _discDisp(it) + '</td>' +
        '<td style="padding:9px 12px;text-align:right;color:#305080;font-size:11px">' + ((Number(it.taxAmt) || 0) > 0 ? _fmt(it.taxAmt) : '—') + '</td>' +
        '<td style="padding:9px 12px;text-align:right;font-weight:700;color:#1a1a1a;font-size:13px">' + _fmt(amt) + '</td>' +
        '</tr>';
    }).join('');
    return '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<thead><tr style="background:linear-gradient(to right,#1a1a1a,#2d2d2d);border-bottom:2px solid #b8960c">' +
      '<th style="padding:10px 12px;color:#f0c040;text-align:center;font-size:9px;font-weight:700;width:28px;letter-spacing:1.5px">#</th>' +
      '<th style="padding:10px 12px;color:#f0c040;text-align:left;font-size:9px;font-weight:700;letter-spacing:1.5px">ITEM DESCRIPTION</th>' +
      '<th style="padding:10px 12px;color:#b8960c;text-align:center;font-size:9px;font-weight:700;letter-spacing:1.5px">HSN/SAC</th>' +
      '<th style="padding:10px 12px;color:#b8960c;text-align:center;font-size:9px;font-weight:700;letter-spacing:1.5px">QTY</th>' +
      '<th style="padding:10px 12px;color:#b8960c;text-align:right;font-size:9px;font-weight:700;letter-spacing:1.5px">RATE</th>' +
      '<th style="padding:10px 12px;color:#b8960c;text-align:right;font-size:9px;font-weight:700;letter-spacing:1.5px">DISC</th>' +
      '<th style="padding:10px 12px;color:#b8960c;text-align:right;font-size:9px;font-weight:700;letter-spacing:1.5px">TAX</th>' +
      '<th style="padding:10px 12px;color:#f0c040;text-align:right;font-size:9px;font-weight:700;letter-spacing:1.5px">AMOUNT</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tfoot><tr style="background:#faf8ef;border-top:2px solid #b8960c">' +
      '<td colspan="3" style="padding:10px 12px;font-weight:700;font-size:12px;color:#1a1a1a;font-style:italic">Total</td>' +
      '<td style="padding:10px 12px;text-align:center;font-weight:700;color:#1a1a1a">' + totalQty + '</td>' +
      '<td></td>' +
      '<td style="padding:10px 12px;text-align:right;font-weight:700;color:#a05030">' + _fmt(f.disc) + '</td>' +
      '<td style="padding:10px 12px;text-align:right;font-weight:700;color:#305080">' + _fmt(f.tax) + '</td>' +
      '<td style="padding:10px 12px;text-align:right;font-weight:900;color:#1a1a1a;font-size:14px">' + _fmt(f.grand) + '</td>' +
      '</tr></tfoot>' +
      '</table>';
  }

  function _getLogoBlock(safeLogoUrl, bizName, isLight) {
    var initials = (bizName || 'MH').substring(0, 2);
    if (safeLogoUrl) {
      var borderColor = isLight ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.15)';
      var radius = isLight ? '10px' : '8px';
      return '<img src="' + safeLogoUrl + '" style="width:54px;height:54px;border-radius:' + radius + ';object-fit:cover;border:2px solid ' + borderColor + '" onerror="this.style.display=\'none\'">';
    }
    var bg = isLight ? 'rgba(255,255,255,.2)' : 'rgba(255,255,255,.08)';
    var color = isLight ? '#fff' : 'rgba(255,255,255,.6)';
    return '<div style="width:54px;height:54px;border-radius:12px;background:' + bg + ';display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:' + color + '">' + initials + '</div>';
  }

  function _getDocLabels(docType) {
    var _isEst = docType === 'estimate';
    var _isSO = docType === 'so';
    return {
      isEst: _isEst,
      isSO: _isSO,
      docBadge: _isEst ? 'ESTIMATE / QUOTATION' : _isSO ? 'SALE ORDER' : 'Invoice',
      docBadgeUC: _isEst ? 'ESTIMATE / QUOTATION' : _isSO ? 'SALE ORDER' : 'INVOICE',
      docWord: _isEst ? 'ESTIMATE' : _isSO ? 'SALE ORDER' : 'INVOICE',
      billToLbl: _isEst ? 'Quote For' : _isSO ? 'Order For' : 'Bill To',
      detailsLbl: _isEst ? 'Estimate Details' : _isSO ? 'Order Details' : 'Invoice Details'
    };
  }

  function buildInvoiceHTML(inv, theme, color, biz, totals, numWords, docType) {
    if (!inv || !inv.items) return '<p style="color:red;padding:20px">Invalid invoice</p>';
    color = color || '#4338CA';
    theme = theme || 'modern';

    var _t = totals || (ERP._salesSvc && ERP._salesSvc._totals ? ERP._salesSvc._totals(inv.items || []) : { sub: 0, disc: 0, tax: 0, grand: 0 });
    var f = {
      sub: isNaN(_t.sub) ? 0 : _round2(_t.sub),
      disc: isNaN(_t.disc) ? 0 : _round2(_t.disc),
      tax: isNaN(_t.tax) ? 0 : _round2(_t.tax),
      grand: isNaN(_t.grand) ? 0 : _round2(_t.grand),
      isCredit: _t.isCredit
    };
    f.paid = (typeof inv.paid === 'number' && !isNaN(inv.paid)) ? _round2(inv.paid) : 0;
    f.bal = _round2(f.grand - f.paid);

    docType = docType || 'invoice';
    var labels = _getDocLabels(docType);
    var _extraInfo = labels.isEst && inv.validTill
      ? '<br>Valid Till: <b style="color:var(--text,#0f172a)">' + _esc(inv.validTill) + '</b>'
      : '';
    var _footerNote = (labels.isEst || labels.isSO)
      ? '<div style="font-size:10px;color:#94a3b8;text-align:center;margin-top:6px;font-style:italic">'
      + (labels.isEst ? 'This is an estimate. Final invoice may vary.' : 'Payment due upon delivery / invoice.')
      + '</div>'
      : '';

    var safeLogoUrl = _safeLogo(biz && biz.logo ? biz.logo : '');
    var bizName = biz && biz.name ? biz.name : '';

    if (theme === 'modern') {
      var tbl = _lightTable(inv, color, f);
      var tots = _lightTotals(f, color);
      var ftr = _lightFooter(inv, biz, f, numWords);
      return (
        '<div style="font-family:\'Segoe UI\',Arial,sans-serif;max-width:820px;margin:0 auto;background:#fff;print-color-adjust:exact;-webkit-print-color-adjust:exact;border:1px solid #e2e8f0;border-radius:4px;overflow:hidden">' +
        '<div style="background:linear-gradient(135deg,' + color + ' 0%,' + color + 'cc 100%);padding:28px 32px;display:flex;justify-content:space-between;align-items:flex-start">' +
        '<div style="display:flex;align-items:center;gap:14px">' + _getLogoBlock(safeLogoUrl, bizName, true) +
        '<div>' +
        '<div style="color:#fff;font-size:22px;font-weight:900;letter-spacing:-.5px">' + _esc(biz && biz.name) + '</div>' +
        '<div style="color:rgba(255,255,255,.7);font-size:11px;margin-top:3px">' + _esc(biz && (biz.addr || biz.address) || '') + '</div>' +
        '<div style="color:rgba(255,255,255,.7);font-size:11px">' + _esc(biz && biz.phone) + (biz && biz.gst ? '  |  GST: ' + _esc(biz.gst) : '') + '</div>' +
        '</div>' +
        '</div>' +
        '<div style="text-align:right">' +
        '<div style="background:rgba(255,255,255,.15);border-radius:8px;padding:14px 18px">' +
        '<div style="color:rgba(255,255,255,.75);font-size:10px;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">' + labels.docBadge + '</div>' +
        '<div style="color:#fff;font-size:20px;font-weight:900;letter-spacing:-.5px">' + _esc(inv.id || '') + '</div>' +
        '<div style="color:rgba(255,255,255,.75);font-size:11px;margin-top:3px">' + _fmtDateWithFormat(inv.date, biz && biz.dateFormat) + '</div>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;padding:16px 28px;background:var(--bg,#f8fafc);border-bottom:1px solid #e2e8f0;gap:16px">' +
        '<div>' +
        '<div style="font-size:9px;font-weight:700;color:#94a3b8;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:5px">' + labels.billToLbl + '</div>' +
        '<div style="font-size:15px;font-weight:800;color:var(--text,#0f172a)">' + _esc(inv.customer || '') + '</div>' +
        (inv.ph ? '<div style="font-size:11px;color:var(--muted,#64748b);margin-top:2px">' + _esc(inv.ph) + '</div>' : '') +
        '</div>' +
        '<div style="text-align:right">' +
        '<div style="font-size:9px;font-weight:700;color:#94a3b8;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:5px">' + labels.detailsLbl + '</div>' +
        '<div style="font-size:11px;color:#475569;line-height:1.9">' +
        'No: <b style="color:var(--text,#0f172a)">' + _esc(inv.id || '') + '</b><br>' +
        'Date: ' + _fmtDateWithFormat(inv.date, biz && biz.dateFormat) +
        (inv.veh ? '<br>Vehicle: ' + _esc(inv.veh) : '') +
        (inv.state ? '<br>State: ' + _esc(inv.state) : '') +
        '<br>Payment: <b style="color:var(--text,#0f172a)">' + _esc(inv.pay || 'Cash') + '</b>' +
        _extraInfo +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div style="padding:0 24px">' + tbl + '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;padding:20px 28px;gap:28px"><div>' + ftr + '</div><div>' + tots + _footerNote + '</div></div>' +
        '</div>'
      );
    }

    if (theme === 'classic') {
      var tbl = _lightTable(inv, '#1a1a1a', f);
      var tots = _lightTotals(f, '#1a1a1a');
      var ftr = _lightFooter(inv, biz, f, numWords, '#d1d5db', '#111827', '#6b7280');
      var logoCls = safeLogoUrl
        ? '<img src="' + safeLogoUrl + '" style="width:56px;height:56px;border-radius:4px;object-fit:cover;border:2px solid #1a1a1a" onerror="this.style.display=\'none\'">'
        : '<div style="width:56px;height:56px;border:2px solid #1a1a1a;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:#1a1a1a;font-family:Georgia,serif">' + (bizName || 'MH').substring(0, 2) + '</div>';
      return (
        '<div style="font-family:\'Times New Roman\',Georgia,serif;max-width:820px;margin:0 auto;background:#fff;print-color-adjust:exact;-webkit-print-color-adjust:exact;border:3px solid #1a1a1a;overflow:hidden">' +
        '<div style="padding:20px 28px;border-bottom:6px double #1a1a1a;display:flex;justify-content:space-between;align-items:center">' +
        '<div style="display:flex;align-items:center;gap:14px">' + logoCls +
        '<div>' +
        '<div style="font-size:24px;font-weight:900;color:#111827;letter-spacing:-.5px">' + _esc(biz && biz.name) + '</div>' +
        '<div style="font-size:10px;color:var(--muted,#64748b);margin-top:2px;letter-spacing:.5px">' + _esc(biz && (biz.addr || biz.address) || '') + ' \u00b7 ' + _esc(biz && biz.phone) + '</div>' +
        '</div>' +
        '</div>' +
        '<div style="text-align:right;border:2px solid #1a1a1a;padding:10px 16px">' +
        '<div style="font-size:9px;color:var(--muted,#64748b);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">' + labels.docBadge + '</div>' +
        '<div style="font-size:22px;font-weight:900;color:#111827">' + _esc(inv.id || '') + '</div>' +
        '<div style="font-size:10px;color:var(--muted,#64748b);margin-top:2px">' + _fmtDateWithFormat(inv.date, biz && biz.dateFormat) + '</div>' +
        '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:2px solid #1a1a1a">' +
        '<div style="padding:12px 28px;border-right:2px solid #1a1a1a">' +
        '<div style="font-size:9px;font-weight:700;color:var(--muted,#64748b);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px">Billed To</div>' +
        '<div style="font-size:14px;font-weight:700;color:#111827">' + _esc(inv.customer || '') + '</div>' +
        (inv.ph ? '<div style="font-size:11px;color:var(--muted,#64748b);margin-top:2px">' + _esc(inv.ph) + '</div>' : '') +
        '</div>' +
        '<div style="padding:12px 28px;background:#f9fafb">' +
        '<div style="font-size:9px;font-weight:700;color:var(--muted,#64748b);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px">' + labels.detailsLbl + '</div>' +
        '<div style="font-size:11px;color:#374151;line-height:1.9">' +
        (inv.veh ? 'Vehicle: <b>' + _esc(inv.veh) + '</b><br>' : '') +
        'Payment: <b>' + _esc(inv.pay || 'Cash') + '</b>' +
        (inv.state ? '<br>State: ' + _esc(inv.state) : '') +
        _extraInfo +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div style="padding:0 28px">' + tbl + '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:20px 28px;border-top:4px double #1a1a1a"><div>' + ftr + '</div><div>' + tots + _footerNote + '</div></div>' +
        '<div style="padding:8px 28px;background:#111827;text-align:center">' +
        '<div style="color:#fff;font-size:10px;letter-spacing:3px">\u2726 THANK YOU FOR YOUR BUSINESS \u2726</div>' +
        '</div>' +
        '</div>'
      );
    }

    if (theme === 'minimal') {
      var tbl = _lightTable(inv, color, f);
      var tots = _lightTotals(f, color);
      var ftr = _lightFooter(inv, biz, f, numWords);
      return (
        '<div style="font-family:\'Segoe UI\',system-ui,sans-serif;max-width:820px;margin:0 auto;background:#fff;print-color-adjust:exact;-webkit-print-color-adjust:exact;border-left:5px solid ' + color + ';border:1px solid #e2e8f0;border-left:5px solid ' + color + ';overflow:hidden">' +
        '<div style="padding:32px 36px 20px;display:flex;justify-content:space-between;align-items:flex-start">' +
        '<div>' +
        '<div style="font-size:24px;font-weight:900;color:var(--text,#0f172a);letter-spacing:-.5px">' + _esc(biz && biz.name) + '</div>' +
        '<div style="font-size:11px;color:#94a3b8;margin-top:4px">' + _esc(biz && (biz.addr || biz.address) || '') + '</div>' +
        '<div style="font-size:11px;color:#94a3b8">' + _esc(biz && biz.phone) + '</div>' +
        '</div>' +
        '<div style="text-align:right">' +
        '<div style="font-size:10px;color:' + color + ';font-weight:700;letter-spacing:3px;text-transform:uppercase;margin-bottom:6px">' + labels.docWord + '</div>' +
        '<div style="font-size:22px;font-weight:900;color:var(--text,#0f172a);font-family:\'Courier New\',monospace">' + _esc(inv.id || '') + '</div>' +
        '<div style="font-size:11px;color:#94a3b8;margin-top:4px">' + _fmtDateWithFormat(inv.date, biz && biz.dateFormat) + '</div>' +
        '</div>' +
        '</div>' +
        '<div style="height:1px;background:linear-gradient(to right,' + color + '80,transparent);margin:0 36px"></div>' +
        '<div style="padding:16px 36px;display:flex;justify-content:space-between;align-items:flex-start">' +
        '<div>' +
        '<div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:2px;margin-bottom:5px">' + labels.billToLbl + '</div>' +
        '<div style="font-size:15px;font-weight:800;color:var(--text,#0f172a)">' + _esc(inv.customer || '') + '</div>' +
        (inv.ph ? '<div style="font-size:11px;color:var(--muted,#64748b);margin-top:2px">' + _esc(inv.ph) + '</div>' : '') +
        '</div>' +
        '<div style="text-align:right;font-size:11px;color:var(--muted,#64748b);line-height:1.9">' +
        (inv.veh ? '<span style="color:#94a3b8">Vehicle</span> ' + _esc(inv.veh) + '<br>' : '') +
        '<span style="color:#94a3b8">Payment</span> ' + _esc(inv.pay || 'Cash') +
        (inv.state ? '<br><span style="color:#94a3b8">State</span> ' + _esc(inv.state) : '') +
        (_extraInfo ? '<br>' + _extraInfo : '') +
        '</div>' +
        '</div>' +
        '<div style="padding:0 20px">' + tbl + '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;padding:20px 36px"><div>' + ftr + '</div><div>' + tots + _footerNote + '</div></div>' +
        '</div>'
      );
    }

    if (theme === 'corporate') {
      var tbl = _lightTable(inv, color, f);
      var tots = _lightTotals(f, color);
      var ftr = _lightFooter(inv, biz, f, numWords);
      var logoSide = safeLogoUrl
        ? '<img src="' + safeLogoUrl + '" style="width:64px;height:64px;border-radius:8px;object-fit:cover;border:3px solid rgba(255,255,255,.35);margin-bottom:14px" onerror="this.style.display=\'none\'">'
        : '<div style="width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:900;color:#fff;margin-bottom:14px">' + (bizName || 'MH').substring(0, 2) + '</div>';
      return (
        '<div style="font-family:\'Segoe UI\',Arial,sans-serif;max-width:820px;margin:0 auto;background:#fff;print-color-adjust:exact;-webkit-print-color-adjust:exact;display:flex;min-height:850px;border:1px solid #e2e8f0;overflow:hidden">' +
        '<div style="width:210px;background:' + color + ';flex-shrink:0;display:flex;flex-direction:column;padding:28px 20px">' +
        '<div style="text-align:center;margin-bottom:20px">' + logoSide +
        '<div style="color:#fff;font-size:16px;font-weight:700;line-height:1.3">' + _esc(biz && biz.name) + '</div>' +
        '</div>' +
        '<div style="border-top:1px solid rgba(255,255,255,.2);padding-top:14px;margin-bottom:14px">' +
        '<div style="color:rgba(255,255,255,.55);font-size:8px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">Contact</div>' +
        '<div style="color:rgba(255,255,255,.85);font-size:10px;line-height:1.9">' + _esc(biz && (biz.addr || biz.address) || '') + '</div>' +
        '<div style="color:rgba(255,255,255,.85);font-size:10px">' + _esc(biz && biz.phone) + '</div>' +
        '</div>' +
        '<div style="border-top:1px solid rgba(255,255,255,.2);padding-top:14px;margin-bottom:14px">' +
        '<div style="color:rgba(255,255,255,.55);font-size:8px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">' + labels.billToLbl + '</div>' +
        '<div style="color:#fff;font-size:13px;font-weight:700">' + _esc(inv.customer || '') + '</div>' +
        (inv.ph ? '<div style="color:rgba(255,255,255,.7);font-size:10px;margin-top:3px">' + _esc(inv.ph) + '</div>' : '') +
        '</div>' +
        '<div style="border-top:1px solid rgba(255,255,255,.2);padding-top:14px">' +
        '<div style="color:rgba(255,255,255,.55);font-size:8px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">Payment</div>' +
        '<div style="color:#fff;font-size:10px">' + _esc(inv.pay || 'Cash') + '</div>' +
        (inv.veh ? '<div style="color:rgba(255,255,255,.7);font-size:10px;margin-top:3px">Vehicle: ' + _esc(inv.veh) + '</div>' : '') +
        (_extraInfo ? '<div style="color:rgba(255,255,255,.7);font-size:10px;margin-top:3px">' + _extraInfo.replace(/<br>/g, ' ') + '</div>' : '') +
        '</div>' +
        '<div style="margin-top:auto;border-top:1px solid rgba(255,255,255,.2);padding-top:14px">' +
        '<div style="background:rgba(255,255,255,.15);border-radius:8px;padding:12px;text-align:center">' +
        '<div style="color:rgba(255,255,255,.65);font-size:8px;text-transform:uppercase;letter-spacing:1.5px">Balance Due</div>' +
        '<div style="color:#fff;font-size:20px;font-weight:900;margin-top:4px">' + _fmt(f.bal) + '</div>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div style="flex:1;display:flex;flex-direction:column;min-width:0">' +
        '<div style="padding:24px 28px 16px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #f1f5f9">' +
        '<div>' +
        '<div style="font-size:34px;font-weight:900;color:#111827;letter-spacing:-1.5px">' + labels.docWord + '</div>' +
        '</div>' +
        '<div style="text-align:right;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px 16px">' +
        '<div style="font-size:10px;color:#9ca3af;margin-bottom:2px">Invoice No.</div>' +
        '<div style="font-size:18px;font-weight:900;color:#111827">' + _esc(inv.id || '') + '</div>' +
        '<div style="font-size:10px;color:#9ca3af;margin-top:4px">Date: ' + _fmtDateWithFormat(inv.date, biz && biz.dateFormat) + '</div>' +
        '</div>' +
        '</div>' +
        '<div style="padding:0 28px;flex:1">' + tbl + '</div>' +
        '<div style="padding:16px 28px;display:grid;grid-template-columns:1fr 1fr;gap:24px;border-top:1px solid #f1f5f9"><div>' + ftr + '</div><div>' + tots + _footerNote + '</div></div>' +
        '</div>' +
        '</div>'
      );
    }

    if (theme === 'elegant') {
      var tbl = _elegantTable(inv, f);
      var logoEleg = safeLogoUrl
        ? '<img src="' + safeLogoUrl + '" style="width:58px;height:58px;border-radius:4px;object-fit:cover;border:2px solid #b8960c" onerror="this.style.display=\'none\'">'
        : '<div style="width:58px;height:58px;border:2px solid #b8960c;display:flex;align-items:center;justify-content:center;color:#f0c040;font-size:22px;font-weight:700;font-family:Georgia,serif">' + (bizName || 'MH').substring(0, 2) + '</div>';
      var elegTots =
        '<div style="display:flex;flex-direction:column;gap:2px">' +
        '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed #e8d5a0"><span style="font-size:12px;color:#8b7a4a;font-style:italic">Sub Total</span><span style="font-size:12px;font-weight:600;color:#1a1a1a">' + _fmt(f.sub) + '</span></div>' +
        (f.disc > 0 ? '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed #e8d5a0"><span style="font-size:12px;color:#a05030;font-style:italic">Discount</span><span style="font-size:12px;font-weight:600;color:#a05030">-' + _fmt(f.disc) + '</span></div>' : '') +
        (f.tax > 0 ? '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed #e8d5a0"><span style="font-size:12px;color:#305080;font-style:italic">Tax (GST)</span><span style="font-size:12px;font-weight:600;color:#305080">' + _fmt(f.tax) + '</span></div>' : '') +
        '<div style="display:flex;justify-content:space-between;padding:10px 14px;margin:6px 0;background:linear-gradient(to right,#1a1a1a,#2d2d2d);border-top:2px solid #b8960c"><span style="font-size:14px;font-weight:700;color:#f0c040;font-style:italic">Grand Total</span><span style="font-size:16px;font-weight:900;color:#f0c040">' + _fmt(f.grand) + '</span></div>' +
        (f.paid > 0 ? '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed #e8d5a0"><span style="font-size:12px;color:#2d6a2d;font-style:italic">Paid</span><span style="font-size:12px;font-weight:600;color:#2d6a2d">' + _fmt(f.paid) + '</span></div>' : '') +
        '<div style="display:flex;justify-content:space-between;padding:8px 0"><span style="font-size:13px;font-weight:700;color:#1a1a1a">Balance Due</span><span style="font-size:14px;font-weight:800;color:' + (f.bal > 0 ? '#8b2020' : '#2d6a2d') + '">' + _fmt(f.bal) + '</span></div>' +
        '</div>';
      var wordsE = '';
      try {
        wordsE = numWords && typeof numWords === 'function' ? numWords(f.grand) : (ERP._salesSvc && ERP._salesSvc._numWords ? ERP._salesSvc._numWords(f.grand) : '');
      } catch (e) { wordsE = ''; }
      var elegFtr =
        '<div style="font-size:11px;line-height:1.7;border-top:1px solid #e8d5a0;padding-top:14px;margin-top:12px;font-family:Georgia,serif">' +
        '<div style="font-weight:700;color:#b8960c;margin-bottom:2px;font-size:9px;text-transform:uppercase;letter-spacing:2px">Amount In Words</div>' +
        '<div style="font-style:italic;color:#6b6b6b;margin-bottom:10px">' + wordsE + ' Rupees only</div>' +
        (inv.terms ? '<div style="font-weight:700;color:#b8960c;margin-bottom:2px;font-size:9px;text-transform:uppercase;letter-spacing:2px">Terms</div><div style="color:#6b6b6b;font-style:italic">' + _esc(inv.terms) + '</div>' : '') +
        '<div style="margin-top:32px;border-top:1px solid #e8d5a0;padding-top:6px;font-size:10px;color:#8b7a4a;text-align:right;font-style:italic">For ' + _esc(biz && biz.name) + ' \u2014 Authorized Signatory</div>' +
        '</div>';
      return (
        '<div style="font-family:Georgia,\'Palatino Linotype\',serif;max-width:820px;margin:0 auto;background:#fffdf5;print-color-adjust:exact;-webkit-print-color-adjust:exact;border:1px solid #e8d5a0;overflow:hidden">' +
        '<div style="background:linear-gradient(135deg,#1a1a1a,#2d2d2d);padding:28px 32px;position:relative">' +
        '<div style="position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#b8960c,#f0c040,#b8960c)"></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<div style="display:flex;align-items:center;gap:16px">' + logoEleg +
        '<div>' +
        '<div style="color:#f0c040;font-size:22px;font-weight:700;font-style:italic;letter-spacing:.5px">' + _esc(biz && biz.name) + '</div>' +
        '<div style="color:rgba(255,255,255,.4);font-size:10px;margin-top:4px;letter-spacing:2px;text-transform:uppercase">Premium Services</div>' +
        '<div style="color:rgba(255,255,255,.4);font-size:10px;margin-top:2px">' + _esc(biz && (biz.addr || biz.address) || '') + ' \u00b7 ' + _esc(biz && biz.phone) + '</div>' +
        '</div>' +
        '</div>' +
        '<div style="text-align:right;border-left:1px solid rgba(240,192,64,.25);padding-left:20px">' +
        '<div style="color:rgba(255,255,255,.35);font-size:8px;letter-spacing:2.5px;text-transform:uppercase">' + labels.docBadge + '</div>' +
        '<div style="color:#f0c040;font-size:22px;font-weight:700;margin:4px 0">' + _esc(inv.id || '') + '</div>' +
        '<div style="color:rgba(255,255,255,.4);font-size:10px">' + _fmtDateWithFormat(inv.date, biz && biz.dateFormat) + '</div>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;padding:16px 32px;gap:16px;background:#faf8ef;border-bottom:1px solid #e8d5a0">' +
        '<div>' +
        '<div style="font-size:8px;color:#b8960c;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:5px">Billed To</div>' +
        '<div style="font-size:15px;font-weight:700;color:#1a1a1a;font-style:italic">' + _esc(inv.customer || '') + '</div>' +
        (inv.ph ? '<div style="font-size:11px;color:#8b7a4a;margin-top:2px">' + _esc(inv.ph) + '</div>' : '') +
        '</div>' +
        '<div style="text-align:right">' +
        '<div style="font-size:8px;color:#b8960c;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:5px">Details</div>' +
        '<div style="font-size:11px;color:#6b6b6b;line-height:1.9;font-style:italic">' +
        (inv.veh ? 'Vehicle: ' + _esc(inv.veh) + '<br>' : '') +
        'Payment: ' + _esc(inv.pay || 'Cash') +
        (inv.state ? '<br>State: ' + _esc(inv.state) : '') +
        _extraInfo +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div style="padding:0 20px">' + tbl + '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:20px 32px;border-top:1px solid #e8d5a0"><div>' + elegFtr + '</div><div>' + elegTots + _footerNote + '</div></div>' +
        '<div style="background:#1a1a1a;padding:10px 32px;text-align:center">' +
        '<div style="color:#b8960c;font-size:9px;letter-spacing:3px;text-transform:uppercase;font-style:italic">Thank you for choosing us \u00b7 \u0634\u06a9\u0631\u06cc\u06c1 \u00b7 Excellence in Every Transaction</div>' +
        '</div>' +
        '</div>'
      );
    }

    if (theme === 'neon') {
      var neon = color || '#00f5ff';
      var tbl = _darkTable(inv, neon, '#0a0a1a', '#060614', '#0d0d24', '#e0e8ff', '#3a3a6a', f);
      var tots = _darkTotals(f, neon);

      var neonBank = (biz && (biz.bankName || biz.bankAcc || biz.bankUpi))
        ? '<div style="margin-top:14px;padding:12px 14px;border:1px solid ' + neon + '22;border-radius:6px;background:' + neon + '05">' +
        '<div style="color:' + neon + ';font-size:8px;letter-spacing:3px;text-transform:uppercase;margin-bottom:8px">Payment Details</div>' +
        (biz.bankName ? '<div style="font-size:10px;color:#a0a0d0"><span style="opacity:.6">Bank: </span>' + _esc(biz.bankName) + '</div>' : '') +
        (biz.bankTitle ? '<div style="font-size:10px;color:#a0a0d0"><span style="opacity:.6">Account: </span>' + _esc(biz.bankTitle) + '</div>' : '') +
        (biz.bankAcc ? '<div style="font-size:10px;color:#a0a0d0"><span style="opacity:.6">No: </span>' + _esc(biz.bankAcc) + '</div>' : '') +
        (biz.bankIban ? '<div style="font-size:10px;color:#a0a0d0"><span style="opacity:.6">IBAN: </span>' + _esc(biz.bankIban) + '</div>' : '') +
        (biz.bankUpi ? '<div style="font-size:10px;color:#a0a0d0"><span style="opacity:.6">EasyPaisa/JazzCash: </span>' + _esc(biz.bankUpi) + '</div>' : '') +
        '</div>'
        : '';

      var qrSrcN = inv.qrCode || (biz && biz.qrCode) || '';
      var neonQR = qrSrcN
        ? '<div style="text-align:center;margin-top:12px"><div style="display:inline-block;padding:6px;border:1px solid ' + neon + '44;border-radius:6px;background:#060614"><img src="' + qrSrcN + '" style="width:72px;height:72px;display:block;object-fit:contain"></div><div style="font-size:9px;color:' + neon + '77;letter-spacing:2px;text-transform:uppercase;margin-top:4px">Scan to Pay</div></div>'
        : '';

      var wordsN = '';
      try {
        wordsN = numWords && typeof numWords === 'function' ? numWords(f.grand) : (ERP._salesSvc && ERP._salesSvc._numWords ? ERP._salesSvc._numWords(f.grand) : '');
      } catch (e) { wordsN = ''; }

      return (
        '<div style="font-family:\'Segoe UI\',\'Inter\',Arial,sans-serif;max-width:820px;margin:0 auto;background:#060614;print-color-adjust:exact;-webkit-print-color-adjust:exact;border:1px solid ' + neon + '33;border-radius:4px;overflow:hidden">' +

        '<div style="padding:28px 32px;background:linear-gradient(135deg,#0d0d28,#060614);display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid ' + neon + '33">' +
        '<div>' +
        (safeLogoUrl ? '<img src="' + safeLogoUrl + '" style="width:52px;height:52px;border-radius:8px;object-fit:cover;border:1.5px solid ' + neon + '44;margin-bottom:10px;display:block" onerror="this.style.display=\'none\'">' : '') +
        '<div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:.5px;text-shadow:0 0 20px ' + neon + '44">' + _esc(biz && biz.name) + '</div>' +
        '<div style="color:#5a5a9a;font-size:11px;margin-top:3px">' + _esc(biz && (biz.addr || biz.address) || '') + '</div>' +
        '<div style="color:#5a5a9a;font-size:11px">' + _esc(biz && biz.phone || '') + '</div>' +
        (biz && biz.gst ? '<div style="color:#5a5a9a;font-size:10px;margin-top:2px">GST: ' + _esc(biz.gst) + '</div>' : '') +
        '</div>' +
        '<div style="text-align:right">' +
        '<div style="display:inline-block;padding:4px 12px;border:1px solid ' + neon + '55;border-radius:20px;color:' + neon + ';font-size:9px;letter-spacing:3px;text-transform:uppercase;margin-bottom:10px">' + labels.docBadgeUC + '</div>' +
        '<div style="color:' + neon + ';font-size:26px;font-weight:800;letter-spacing:2px;text-shadow:0 0 16px ' + neon + '66;display:block">' + _esc(inv.id || '') + '</div>' +
        '<div style="color:#5a5a9a;font-size:11px;margin-top:4px">Date: ' + _fmtDateWithFormat(inv.date, biz && biz.dateFormat) + '</div>' +
        (inv.due ? '<div style="color:#5a5a9a;font-size:11px">Due: ' + _esc(inv.due) + '</div>' : '') +
        '</div>' +
        '</div>' +

        '<div style="display:grid;grid-template-columns:1fr 1fr;background:#0a0a1a;border-bottom:1px solid ' + neon + '1a;padding:16px 32px;gap:24px">' +
        '<div>' +
        '<div style="color:' + neon + ';font-size:8px;letter-spacing:3px;text-transform:uppercase;margin-bottom:5px">' + labels.billToLbl + '</div>' +
        '<div style="color:#e0e8ff;font-size:15px;font-weight:700">' + _esc(inv.customer || 'Walk-in Customer') + '</div>' +
        (inv.ph ? '<div style="color:#5a5a9a;font-size:11px;margin-top:2px">' + _esc(inv.ph) + '</div>' : '') +
        '</div>' +
        '<div style="text-align:right">' +
        '<div style="color:' + neon + ';font-size:8px;letter-spacing:3px;text-transform:uppercase;margin-bottom:5px">Payment</div>' +
        '<div style="display:inline-block;padding:3px 12px;border-radius:20px;background:' + (inv.pay === 'Credit' ? '#3d0a0a' : '#0a2818') + ';border:1px solid ' + (inv.pay === 'Credit' ? '#f8717155' : '#4ade8055') + ';color:' + (inv.pay === 'Credit' ? '#f87171' : '#4ade80') + ';font-size:12px;font-weight:700">' + _esc(inv.pay || 'Cash') + '</div>' +
        (inv.veh ? '<div style="color:#5a5a9a;font-size:11px;margin-top:4px">Ref: ' + _esc(inv.veh) + '</div>' : '') +
        (_extraInfo ? '<div style="color:#5a5a9a;font-size:11px;margin-top:4px">' + _extraInfo.replace(/<[^>]+>/g, '').trim() + '</div>' : '') +
        '</div>' +
        '</div>' +

        '<div style="padding:0 16px;background:#060614">' + tbl + '</div>' +

        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:20px 32px;background:#0a0a1a;border-top:1px solid ' + neon + '1a">' +
        '<div>' +
        '<div style="color:#5a5a9a;font-style:italic;font-size:11px;margin-bottom:8px">' + _esc(wordsN) + ' only</div>' +
        (inv.terms ? '<div style="font-size:10px;color:' + neon + '88;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Terms</div><div style="font-size:11px;color:#5a5a9a;margin-bottom:8px">' + _esc(inv.terms) + '</div>' : '') +
        neonBank + neonQR +
        '</div>' +
        '<div>' + tots + _footerNote + '</div>' +
        '</div>' +

        '<div style="padding:8px 32px;background:#060614;border-top:1px solid ' + neon + '1a;display:flex;justify-content:space-between;align-items:center">' +
        '<div style="color:' + neon + '44;font-size:8px;letter-spacing:3px;text-transform:uppercase">&#9670; MH AUTOS ERP &#9670;</div>' +
        '<div style="color:#3a3a5a;font-size:9px">Authorized Signatory: ____________</div>' +
        '</div>' +

        '</div>'
      );
    }

    if (theme === 'retro') {
      var tbl = _retroTable(inv, f);
      var retroTots =
        '<div style="display:flex;flex-direction:column;gap:2px;font-family:\'Courier New\',monospace">' +
        '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px dashed #b0986a"><span style="font-size:12px;color:#6b5a44">Sub Total</span><span style="font-size:12px;font-weight:700;color:#2c1a0e">' + _fmt(f.sub) + '</span></div>' +
        (f.disc > 0 ? '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px dashed #b0986a"><span style="font-size:12px;color:#8b3a3a">Discount</span><span style="font-size:12px;font-weight:700;color:#8b3a3a">-' + _fmt(f.disc) + '</span></div>' : '') +
        (f.tax > 0 ? '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px dashed #b0986a"><span style="font-size:12px;color:#3a5a8b">Tax</span><span style="font-size:12px;font-weight:700;color:#3a5a8b">' + _fmt(f.tax) + '</span></div>' : '') +
        '<div style="display:flex;justify-content:space-between;padding:10px 12px;margin:6px 0;background:#2c1a0e;border:2px solid #8b7355"><span style="font-size:14px;font-weight:900;color:#f5f0e8">TOTAL</span><span style="font-size:16px;font-weight:900;color:#f5f0e8">' + _fmt(f.grand) + '</span></div>' +
        (f.paid > 0 ? '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px dashed #b0986a"><span style="font-size:12px;color:#2d6a2d">Paid</span><span style="font-size:12px;font-weight:700;color:#2d6a2d">' + _fmt(f.paid) + '</span></div>' : '') +
        '<div style="display:flex;justify-content:space-between;padding:7px 0"><span style="font-size:13px;font-weight:700;color:#2c1a0e">Balance</span><span style="font-size:14px;font-weight:900;color:' + (f.bal > 0 ? '#8b2020' : '#2d6a2d') + '">' + _fmt(f.bal) + '</span></div>' +
        '</div>';
      var wordsR = '';
      try {
        wordsR = numWords && typeof numWords === 'function' ? numWords(f.grand) : (ERP._salesSvc && ERP._salesSvc._numWords ? ERP._salesSvc._numWords(f.grand) : '');
      } catch (e) { wordsR = ''; }
      var retroFtr =
        '<div style="font-size:11px;line-height:1.8;border-top:2px solid #8b7355;padding-top:12px;margin-top:12px;font-family:\'Courier New\',monospace;color:#4a3728">' +
        '<div style="font-weight:700;color:#2c1a0e;margin-bottom:2px;font-size:9px;text-transform:uppercase;letter-spacing:2px">Amount In Words</div>' +
        '<div style="font-style:italic;color:#6b5a44;margin-bottom:10px">' + wordsR + ' Rupees only</div>' +
        (inv.terms ? '<div style="font-weight:700;color:#2c1a0e;margin-bottom:2px;font-size:9px;text-transform:uppercase;letter-spacing:2px">Terms</div><div style="color:#6b5a44">' + _esc(inv.terms) + '</div>' : '') +
        '<div style="margin-top:36px;border-top:1px solid #b0986a;padding-top:6px;font-size:10px;color:#8b7355;text-align:right;font-style:italic">For ' + _esc(biz && biz.name) + ' \u2014 Authorized Signatory</div>' +
        '</div>';
      var logoRet = safeLogoUrl
        ? '<img src="' + safeLogoUrl + '" style="width:52px;height:52px;border:2px solid #8b7355;object-fit:cover" onerror="this.style.display=\'none\'">'
        : '<div style="width:52px;height:52px;border:2px solid #8b7355;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;color:#8b7355;font-family:\'Courier New\'">' + (bizName || 'MH').substring(0, 2) + '</div>';
      return (
        '<div style="font-family:\'Courier New\',Courier,monospace;max-width:820px;margin:0 auto;background:#f5f0e8;print-color-adjust:exact;-webkit-print-color-adjust:exact;border:3px solid #8b7355;box-shadow:5px 5px 0 #8b7355;overflow:hidden">' +
        '<div style="padding:22px 28px;border-bottom:4px double #8b7355;display:flex;justify-content:space-between;align-items:flex-start">' +
        '<div style="display:flex;align-items:flex-start;gap:14px">' + logoRet +
        '<div>' +
        '<div style="display:inline-block;background:#2c1a0e;color:#f5f0e8;font-size:8px;letter-spacing:4px;text-transform:uppercase;padding:3px 10px;margin-bottom:8px">' + labels.docBadgeUC + '</div>' +
        '<div style="font-size:22px;font-weight:900;color:#2c1a0e;letter-spacing:-1px">' + _esc(biz && biz.name) + '</div>' +
        '<div style="font-size:10px;color:#6b5a44;margin-top:3px;border-top:1px solid #b0986a;padding-top:3px">' + _esc(biz && (biz.addr || biz.address) || '') + ' \u00b7 ' + _esc(biz && biz.phone) + '</div>' +
        '</div>' +
        '</div>' +
        '<div style="text-align:right;border:2px solid #8b7355;padding:10px 14px;background:#ede8dc">' +
        '<div style="font-size:8px;color:#8b7355;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">Invoice No.</div>' +
        '<div style="font-size:22px;font-weight:900;color:#2c1a0e">' + _esc(inv.id || '') + '</div>' +
        '<div style="font-size:10px;color:#6b5a44;margin-top:4px">' + _fmtDateWithFormat(inv.date, biz && biz.dateFormat) + '</div>' +
        '</div>' +
        '</div>' +
        '<div style="padding:12px 28px;border-bottom:1px dashed #b0986a;background:#ede8dc;display:flex;justify-content:space-between">' +
        '<div>' +
        '<span style="font-size:9px;font-weight:700;color:#8b7355;text-transform:uppercase;letter-spacing:1px">Billed To: </span>' +
        '<span style="font-size:13px;font-weight:700;color:#2c1a0e">' + _esc(inv.customer || '') + '</span>' +
        (inv.ph ? ' <span style="font-size:10px;color:#6b5a44">\u00b7 ' + _esc(inv.ph) + '</span>' : '') +
        '</div>' +
        '<div style="font-size:10px;color:#6b5a44;text-align:right">' +
        (inv.veh ? 'Veh: ' + _esc(inv.veh) + '<br>' : '') +
        'Pay: ' + _esc(inv.pay || 'Cash') +
        (_extraInfo ? '<br>' + _extraInfo.replace(/<[^>]*style="[^"]*">/g, '').replace(/<\/b>/g, '').replace(/<b>/g, '') : '') +
        '</div>' +
        '</div>' +
        '<div style="padding:0 18px">' + tbl + '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:18px 28px;border-top:4px double #8b7355"><div>' + retroFtr + '</div><div>' + retroTots + _footerNote + '</div></div>' +
        '<div style="padding:8px 28px;border-top:1px dashed #b0986a;text-align:center;background:#ede8dc">' +
        '<div style="font-size:10px;color:#8b7355;letter-spacing:3px">\u2605 THANK YOU FOR YOUR BUSINESS \u00b7 \u0622\u067e \u06a9\u0627 \u0634\u06a9\u0631\u06cc\u06c1 \u2605</div>' +
        '</div>' +
        '</div>'
      );
    }

    if (theme === 'pastel') {
      var tbl = _lightTable(inv, color, f);
      var tots = _lightTotals(f, color);
      var ftr = _lightFooter(inv, biz, f, numWords, '#e5e7eb', '#1e1b4b', '#9ca3af');
      var logoPas = safeLogoUrl
        ? '<img src="' + safeLogoUrl + '" style="width:50px;height:50px;border-radius:12px;object-fit:cover;border:2px solid ' + color + '55" onerror="this.style.display=\'none\'">'
        : '<div style="width:50px;height:50px;border-radius:12px;background:' + color + ';display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:#fff">' + (bizName || 'MH').substring(0, 2) + '</div>';
      return (
        '<div style="font-family:\'Segoe UI\',system-ui,sans-serif;max-width:820px;margin:0 auto;background:#f0f4ff;print-color-adjust:exact;-webkit-print-color-adjust:exact;padding:16px;border-radius:20px;border:1px solid #c7d2fe;overflow:hidden">' +
        '<div style="background:var(--white,#fff);border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.07)">' +
        '<div style="background:linear-gradient(135deg,' + color + '18,' + color + '06);padding:24px 28px;border-bottom:1px solid ' + color + '1a">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<div style="display:flex;align-items:center;gap:14px">' + logoPas +
        '<div>' +
        '<div style="font-size:20px;font-weight:800;color:#1e1b4b">' + _esc(biz && biz.name) + '</div>' +
        '<div style="font-size:11px;color:#9ca3af;margin-top:2px">' + _esc(biz && (biz.addr || biz.address) || '') + '</div>' +
        '<div style="font-size:11px;color:#9ca3af">' + _esc(biz && biz.phone) + '</div>' +
        '</div>' +
        '</div>' +
        '<div style="background:var(--white,#fff);border-radius:12px;padding:12px 18px;text-align:right;box-shadow:0 2px 10px rgba(0,0,0,.06);border:1px solid ' + color + '22">' +
        '<div style="font-size:9px;font-weight:700;color:' + color + ';letter-spacing:2px;text-transform:uppercase">' + labels.docWord + '</div>' +
        '<div style="font-size:18px;font-weight:900;color:#1e1b4b;margin-top:2px">' + _esc(inv.id || '') + '</div>' +
        '<div style="font-size:10px;color:#9ca3af;margin-top:2px">' + _fmtDateWithFormat(inv.date, biz && biz.dateFormat) + '</div>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #f3f4f6">' +
        '<div style="padding:14px 28px;border-right:1px solid #f3f4f6">' +
        '<div style="font-size:8px;font-weight:700;color:' + color + ';letter-spacing:2px;text-transform:uppercase;margin-bottom:5px">' + labels.billToLbl + '</div>' +
        '<div style="font-size:14px;font-weight:700;color:#1e1b4b">' + _esc(inv.customer || '') + '</div>' +
        (inv.ph ? '<div style="font-size:11px;color:#9ca3af;margin-top:2px">' + _esc(inv.ph) + '</div>' : '') +
        '</div>' +
        '<div style="padding:14px 28px">' +
        '<div style="font-size:8px;font-weight:700;color:' + color + ';letter-spacing:2px;text-transform:uppercase;margin-bottom:5px">Details</div>' +
        '<div style="font-size:11px;color:var(--muted,#64748b);line-height:1.9">' +
        (inv.veh ? 'Vehicle: ' + _esc(inv.veh) + '<br>' : '') +
        'Payment: ' + _esc(inv.pay || 'Cash') +
        (inv.state ? '<br>State: ' + _esc(inv.state) : '') +
        _extraInfo +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div style="padding:0 16px">' + tbl + '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:18px 28px;background:#fafafa;border-top:1px solid #f3f4f6"><div>' + ftr + '</div><div>' + tots + _footerNote + '</div></div>' +
        '</div>' +
        '</div>'
      );
    }

    var tbl = _darkTable(inv, color, '#1e293b', '#0f172a', '#0a1628', '#f1f5f9', 'rgba(255,255,255,.28)', f);
    var tots = _darkTotals(f, color);
    var ftr = _darkFooter(inv, biz, f, numWords, color, 'rgba(255,255,255,.3)');
    return (
      '<div style="font-family:\'Segoe UI\',Arial,sans-serif;max-width:820px;margin:0 auto;background:#0f172a;print-color-adjust:exact;-webkit-print-color-adjust:exact;border:1px solid rgba(255,255,255,.1);border-left:4px solid ' + color + ';overflow:hidden">' +
      '<div style="padding:26px 28px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid rgba(255,255,255,.06)">' +
      '<div style="display:flex;align-items:center;gap:14px">' + _getLogoBlock(safeLogoUrl, bizName, false) +
      '<div>' +
      '<div style="color:#fff;font-size:20px;font-weight:900">' + _esc(biz && biz.name) + '</div>' +
      '<div style="color:rgba(255,255,255,.4);font-size:11px;margin-top:2px">' + _esc(biz && (biz.addr || biz.address) || '') + '</div>' +
      '<div style="color:rgba(255,255,255,.4);font-size:11px">' + _esc(biz && biz.phone) + '</div>' +
      '</div>' +
      '</div>' +
      '<div style="text-align:right">' +
      '<div style="color:' + color + ';font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">' + labels.docBadge + '</div>' +
      '<div style="color:#fff;font-size:20px;font-weight:900">' + _esc(inv.id || '') + '</div>' +
      '<div style="color:rgba(255,255,255,.4);font-size:11px;margin-top:2px">' + _fmtDateWithFormat(inv.date, biz && biz.dateFormat) + '</div>' +
      '</div>' +
      '</div>' +
      '<div style="background:#1e293b;padding:14px 28px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid rgba(255,255,255,.04)">' +
      '<div>' +
      '<div style="color:' + color + ';font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-bottom:4px">' + labels.billToLbl + '</div>' +
      '<div style="color:#fff;font-size:14px;font-weight:700">' + _esc(inv.customer || '') + '</div>' +
      (inv.ph ? '<div style="color:rgba(255,255,255,.4);font-size:11px;margin-top:2px">' + _esc(inv.ph) + '</div>' : '') +
      '</div>' +
      '<div style="text-align:right;font-size:11px;color:rgba(255,255,255,.4)">' +
      'Payment: <b style="color:rgba(255,255,255,.7)">' + _esc(inv.pay || 'Cash') + '</b>' +
      (inv.veh ? '<br>Vehicle: <b style="color:rgba(255,255,255,.7)">' + _esc(inv.veh) + '</b>' : '') +
      (inv.state ? '<br>State: <b style="color:rgba(255,255,255,.7)">' + _esc(inv.state) + '</b>' : '') +
      (_extraInfo ? '<br><b style="color:rgba(255,255,255,.7)">' + _extraInfo.replace(/<[^>]+>/g, '').replace(/Valid Till: /, 'Valid Till: ') + '</b>' : '') +
      '</div>' +
      '</div>' +
      '<div style="padding:0 16px;background:#0f172a">' + tbl + '</div>' +
      '<div style="background:#0a1628;display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:18px 28px;border-top:1px solid rgba(255,255,255,.05)"><div>' + ftr + '</div><div>' + tots + _footerNote + '</div></div>' +
      '</div>'
    );
  }

  function buildThermalHTML(inv, biz, totals) {
    biz = biz || {};
    var _t = totals || (ERP._salesSvc && ERP._salesSvc._totals ? ERP._salesSvc._totals(inv.items || []) : { sub: 0, disc: 0, tax: 0, grand: 0 });
    var f = { sub: _round2(_t.sub), disc: _round2(_t.disc), tax: _round2(_t.tax), grand: _round2(_t.grand), isCredit: _t.isCredit };
    if (inv.roundOff === true) f.grand = Math.round(f.grand);
    f.paid = (typeof inv.paid === 'number' && !isNaN(inv.paid)) ? _round2(inv.paid) : 0;
    f.bal = _round2(f.grand - f.paid);

    var isCreditNote = inv.type === 'credit_note' || inv.status === 'returned';

    var w = biz.thermalWidth || 576;
    var footerTxt = biz.thermalFooter || 'Thank you! \u0622\u067e \u06a9\u0627 \u0634\u06a9\u0631\u06cc\u06c1';
    var headerTxt = biz.thermalHeader || '';
    var showLogo = biz.showLogoOnPrint !== false;
    var showQR = biz.showQROnPrint !== false;
    var showStamp = biz.showStampOnPrint !== false;
    var showSig = biz.showSignatureBox === true;
    var lang = biz.printLanguage || 'en';
    var datefmt = biz.dateFormat || 'dd/mm/yyyy';

    var fsMap = { small: '10px', medium: '12px', large: '14px' };
    var fs = fsMap[biz.thermalFontSize] || '12px';
    var fsLg = biz.thermalFontSize === 'small' ? '14px' : biz.thermalFontSize === 'large' ? '18px' : '16px';
    var fsSm = biz.thermalFontSize === 'small' ? '9px' : biz.thermalFontSize === 'large' ? '12px' : '10px';
    var fsMd = biz.thermalFontSize === 'small' ? '10px' : biz.thermalFontSize === 'large' ? '13px' : '11px';

    function _fmtDateThermal(d) {
      if (!d) return '';
      var dt = new Date(d);
      if (isNaN(dt.getTime())) return String(d);
      var dd = dt.getDate().toString().padStart(2, '0');
      var mm = (dt.getMonth() + 1).toString().padStart(2, '0');
      var yy = dt.getFullYear();
      var mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      if (datefmt === 'mm/dd/yyyy') return mm + '/' + dd + '/' + yy;
      if (datefmt === 'dd-Mon-yyyy') return dd + '-' + mons[dt.getMonth()] + '-' + yy;
      return dd + '/' + mm + '/' + yy;
    }

    var L = {
      cust: lang === 'ur' ? '\u06af\u0627\u06c1\u06a9' : lang === 'both' ? 'Cust / \u06af\u0627\u06c1\u06a9' : 'Cust',
      date: lang === 'ur' ? '\u062a\u0627\u0631\u06cc\u062e' : lang === 'both' ? 'Date / \u062a\u0627\u0631\u06cc\u062e' : 'Date',
      phone: lang === 'ur' ? '\u0641\u0648\u0646' : 'Ph',
      veh: lang === 'ur' ? '\u06af\u0627\u0691\u06cc' : 'Veh',
      disc: lang === 'ur' ? '\u0631\u0639\u0627\u06cc\u062a' : lang === 'both' ? 'Disc/\u0631\u0639\u0627\u06cc\u062a' : 'Discount',
      gst: lang === 'ur' ? '\u062c\u06cc\u0627\u0633\u0679\u06cc' : 'GST',
      total: lang === 'ur' ? '\u06a9\u0644 \u0631\u0642\u0645' : lang === 'both' ? 'TOTAL/\u06a9\u0644' : 'TOTAL',
      paid: lang === 'ur' ? '\u0627\u062f\u0627 \u06a9\u06cc\u0627' : lang === 'both' ? 'Paid/\u0627\u062f\u0627' : 'Paid',
      balance: lang === 'ur' ? '\u0628\u0627\u0642\u06cc' : lang === 'both' ? 'Balance/\u0628\u0627\u0642\u06cc' : 'Balance'
    };

    var logoBlock = '';
    if (showLogo && biz.logo && /^(https?:\/\/|data:image\/)/.test(biz.logo)) {
      logoBlock = '<div style="text-align:center;margin-bottom:6px">'
        + '<img src="' + biz.logo + '" style="height:48px;max-width:' + (w - 20) + 'px;object-fit:contain" onerror="this.style.display=\'none\'">'
        + '</div>';
    }

    var stampBlock = '';
    if (showStamp && f.bal <= 0 && f.grand > 0 && !isCreditNote) {
      stampBlock = '<div style="border:3px solid #166534;color:#166534;font-size:' + (parseFloat(fs) + 6) + 'px;font-weight:900;text-align:center;'
        + 'padding:4px;margin:8px 0;border-radius:4px;letter-spacing:4px">&#10003; PAID</div>';
    }

    var sigBlock = showSig
      ? '<div style="margin-top:12px;border-top:1px dashed #000;padding-top:6px;text-align:center;font-size:' + fsSm + '">'
        + (lang === 'ur' ? '\u062f\u0633\u062e\u0637' : 'Signature') + ': _____________________</div>'
      : '';

    var qrBlock = '';
    if (showQR) {
      var qrSrc = inv.qrCode || biz.qrCode || '';
      var bank = (biz.bankName || biz.bankAcc || biz.bankUpi) ? true : false;
      if (qrSrc || bank) {
        qrBlock = '<div style="border-top:1px dashed #000;margin-top:6px;padding-top:6px">';
        if (bank) {
          qrBlock += '<div style="font-size:' + fsSm + ';text-align:center">';
          if (biz.bankName) qrBlock += (lang === 'ur' ? '\u0628\u06cc\u0646\u06a9' : 'Bank') + ': ' + _esc(biz.bankName) + '<br>';
          if (biz.bankTitle) qrBlock += _esc(biz.bankTitle) + '<br>';
          if (biz.bankAcc) qrBlock += (lang === 'ur' ? '\u0627\u06a9\u0627\u0624\u0646\u0679' : 'Acc') + ': ' + _esc(biz.bankAcc) + '<br>';
          if (biz.bankIban) qrBlock += 'IBAN: ' + _esc(biz.bankIban) + '<br>';
          if (biz.bankUpi) qrBlock += 'EasyPaisa/JazzCash: ' + _esc(biz.bankUpi);
          qrBlock += '</div>';
        }
        if (qrSrc) {
          qrBlock += '<div style="text-align:center;margin-top:4px">'
            + '<img src="' + _esc(qrSrc) + '" style="width:70px;height:70px;margin:0 auto;display:block" onerror="this.style.display=\'none\'">'
            + '</div>';
        }
        qrBlock += '</div>';
      }
    }

    return (
      '<div style="font-family:\'Courier New\',monospace;font-size:' + fs + ';max-width:' + w + 'px;margin:0 auto;padding:8px;background:#fff;color:#000">' +
      logoBlock +
      '<div style="text-align:center;font-size:' + fsLg + ';font-weight:900;border-bottom:1px dashed #000;padding-bottom:6px;margin-bottom:4px">' + _esc(biz.name) + '</div>' +
      (headerTxt ? '<div style="text-align:center;font-size:' + fsSm + ';margin-bottom:3px;font-style:italic">' + _esc(headerTxt) + '</div>' : '') +
      '<div style="text-align:center;font-size:' + fsSm + ';margin-bottom:4px">' + _esc(biz.addr || biz.address || '') + (biz.phone ? '<br>' + _esc(biz.phone) : '') + (biz.gst ? '<br>GST: ' + _esc(biz.gst) : '') + '</div>' +
      '<div style="text-align:center;border-top:1px dashed #000;border-bottom:1px dashed #000;padding:3px 0;margin:4px 0;font-weight:700;font-size:' + fsMd + '">' + (isCreditNote ? 'CREDIT NOTE' : (lang === 'ur' ? '\u0648\u0627\u0686\u0631' : 'INVOICE')) + ' ' + _esc(inv.id || '') + '</div>' +
      '<div style="font-size:' + fsMd + ';margin-bottom:4px">' + L.cust + ': <b>' + _esc(inv.customer || '') + '</b><br>' + L.date + ': ' + _fmtDateThermal(inv.date || '') + (inv.ph ? '<br>' + L.phone + ': ' + _esc(inv.ph) : '') + (inv.veh ? '<br>' + L.veh + ': ' + _esc(inv.veh) : '') + '</div>' +
      '<div style="border-top:1px dashed #000;padding-top:4px;font-size:' + fsSm + '">' +
      (inv.items || []).map(function (i) {
        var lineTotal = (Number(i.q) || 0) * (Number(i.p) || 0) - (Number(i.d) || 0) + (Number(i.taxAmt) || 0);
        var cur = biz.currency || 'Rs';
        return _esc(i.n) + '<br>  ' + (Number(i.q) || 0) + ' x ' + cur + ' ' + _fmt(i.p) + ' = <b>' + cur + ' ' + _fmt(lineTotal) + '</b>' + ((Number(i.d) || 0) > 0 ? ' (-' + _fmt(i.d) + ')' : '') + ((Number(i.taxAmt) || 0) > 0 ? '<br>  GST: ' + cur + ' ' + _fmt(i.taxAmt) : '');
      }).join('<br>') +
      '</div>' +
      '<div style="border-top:1px dashed #000;margin-top:4px;padding-top:4px">' +
      (f.disc > 0 ? '<div style="display:flex;justify-content:space-between;font-size:' + fsSm + '"><span>' + L.disc + ':</span><span>-' + _fmt(f.disc) + '</span></div>' : '') +
      (f.tax > 0 ? '<div style="display:flex;justify-content:space-between;font-size:' + fsSm + '"><span>' + L.gst + ':</span><span>' + _fmt(f.tax) + '</span></div>' : '') +
      '<div style="display:flex;justify-content:space-between;font-weight:900;font-size:' + (parseFloat(fs) + 2) + 'px;margin-top:2px;border-top:1px solid #000;padding-top:2px"><span>' + L.total + '</span><span>' + (biz.currency || 'Rs') + ' ' + _fmt(f.grand) + '</span></div>' +
      (f.paid > 0 ? '<div style="display:flex;justify-content:space-between;color:#166534;font-size:' + fsMd + '"><span>' + L.paid + ':</span><span>' + _fmt(f.paid) + '</span></div>' : '') +
      (f.bal > 0 ? '<div style="display:flex;justify-content:space-between;color:red;font-weight:700;font-size:' + fsMd + '"><span>' + L.balance + ':</span><span>' + _fmt(f.bal) + '</span></div>' : '') +
      '</div>' +
      stampBlock +
      qrBlock +
      sigBlock +
      '<div style="text-align:center;margin-top:8px;font-size:' + fsSm + ';border-top:1px dashed #000;padding-top:4px">' + _esc(footerTxt) + '</div>' +
      '</div>'
    );
  }

  function invoiceRowHTML(s, fmt) {
    fmt = fmt || _fmt;
    var _g = (typeof s.grand === 'number' && !isNaN(s.grand)) ? s.grand : (ERP._salesSvc && ERP._salesSvc._totals ? ERP._salesSvc._totals(s.items || []).grand : 0);
    if (s.roundOff) _g = Math.round(_g);
    var allReturns = [];
    if (ERP._internal && ERP._internal.getState) {
      try {
        var state = ERP._internal.getState();
        allReturns = (state.data && state.data.saleReturns || []).filter(function (r) { return r.originalInv === s.id && !r.voided; });
      } catch (e) { allReturns = []; }
    }
    var totalReturnedVal = allReturns.reduce(function (sum, r) { return sum + (Number(r.returnGrand) || 0); }, 0);
    var effectiveTotal = s.status === 'returned' ? 0 : Math.max(0, _round2(_g - totalReturnedVal));
    var total = effectiveTotal;

    var _storedPaid = (typeof s.paid === 'number' && !isNaN(s.paid)) ? s.paid : 0;
    var paid = _storedPaid;
    if (paid === 0 && ERP._internal && ERP._internal.getState) {
      try {
        var st = ERP._internal.getState();
        var _allocs = (st.data && st.data.paymentAllocations || [])
          .filter(function (a) {
            if (a.invoiceId !== s.id) return false;
            var _pi = (st.data && st.data.payIn || []).find(function (x) { return x.id === a.paymentId; });
            return !(_pi && _pi.voided);
          });
        if (_allocs.length > 0) {
          paid = _round2(_allocs.reduce(function (acc, a) { return acc + (Number(a.amountAllocated) || 0); }, 0));
        }
      } catch(e){ if(window.DEBUG_MODE) console.error(e); }
    }
    var rawRemaining = _round2(total - paid);
    var remaining = Math.max(0, rawRemaining);
    var creditDue = rawRemaining < 0 ? Math.abs(rawRemaining) : 0;
    var calcStatus = s.status === 'returned' ? 'returned'
      : (creditDue > 0 ? 'overpaid'
        : (paid >= total && total > 0) ? 'paid'
          : (paid > 0) ? 'partial'
            : 'unpaid');
    var status = calcStatus;
    var sid = _esc(s.id || '');
    var itms = (s.items || []).slice(0, 2).map(function (i) { return _esc(i.n || ''); }).join(', ') +
      (s.items && s.items.length > 2 ? ' +more' : '');
    return '<tr data-inv-id="' + sid + '">' +
      '<td class="mono" style="font-weight:700;color:#4338CA;cursor:pointer" onclick="ERP.sales.view(\'' + sid + '\')">' + sid + '</td>' +
      '<td style="font-weight:600">' + _esc(s.customer || s.cust || '') + '</td>' +
      '<td style="color:var(--muted);font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + itms + '</td>' +
      '<td class="mono" style="color:#f59e0b;font-weight:700">' + fmt(total) + '</td>' +
      '<td class="mono" style="color:#22c55e;font-weight:600">' + (paid > 0 ? fmt(paid) : '<span class="muted">\u2014</span>') + '</td>' +
      '<td class="mono">' + (creditDue > 0 ? '<span style="color:#7c3aed;font-weight:700">\u21a9 CR ' + fmt(creditDue) + '</span>' : remaining > 0 ? '<span style="color:#dc2626;font-weight:600">' + fmt(remaining) + '</span>' : '<span style="color:#22c55e">\u2014</span>') + '</td>' +
      '<td><span class="badge b-blue">' + _esc(s.pay || 'Cash') + '</span></td>' +
      '<td><span class="badge ' + _badge(status) + '">' + _esc(status.toUpperCase()) + '</span></td>' +
      '<td style="color:var(--muted);font-size:11px">' + _esc(s.date || '') + '</td>' +
      '<td><div style="display:flex;gap:4px">' +
      '<button class="btn btn-ghost btn-sm" title="View/Print" onclick="ERP.sales.view(\'' + sid + '\')"><svg><use href="#ic-eye"/></svg></button>' +
      '<button class="btn btn-ghost btn-sm" title="Print" onclick="ERP.sales._printFromList(\'' + sid + '\')" style="font-size:14px">\ud83d\udda8\ufe0f</button>' +
      '<button class="btn btn-wa btn-sm" title="WhatsApp" onclick="ERP.sales._waFromList(\'' + sid + '\')"><svg style="width:12px;height:12px"><use href="#ic-whatsapp"/></svg></button>' +
      '<button class="btn btn-ghost btn-sm" title="Edit" onclick="ERP.sales.openEdit(\'' + sid + '\')"><svg><use href="#ic-edit"/></svg></button>' +
      (s._paymentRecordPending
        ? '<button class="btn btn-sm" style="background:#dc2626;color:#fff;border-color:#dc2626;font-size:10px;padding:2px 7px" title="Payment record failed to save \u2014 click to retry" onclick="ERP.sales._retryPendingPayment(\'' + sid + '\')">\u26a0\ufe0f Retry Payment</button>'
        : '') +
      (status === 'overpaid'
        ? '<button class="btn btn-sm" style="background:#7c3aed;color:#fff;border-color:#7c3aed;font-size:10px;padding:2px 7px" title="Pay Refund to Customer" onclick="ERP.sales.openPayOutModal(\'' + _esc(s.customer || '') + '\',' + creditDue.toFixed(2) + ')">\ud83d\udcb8 Refund</button>'
        : '') +
      '<button class="btn btn-danger btn-sm" title="Delete" onclick="ERP.sales._deleteSaleUI(\'' + sid + '\')"><svg><use href="#ic-trash"/></svg></button>' +
      '</div></td>' +
      '</tr>';
  }

  function estimateRowHTML(e) {
    var amt = (typeof e.grand === 'number' && !isNaN(e.grand))
      ? e.grand
      : (ERP._salesSvc && ERP._salesSvc._totals ? ERP._salesSvc._totals(e.items || []).grand : 0);
    var eid = _esc(e.id || '');
    var today = ERP._salesToday && typeof ERP._salesToday === 'function' ? ERP._salesToday() : '';
    var isExpired = false;
    if (e.validTill && today) {
      try {
        var vdt = new Date(e.validTill);
        var tdt = new Date(today);
        if (!isNaN(vdt.getTime()) && !isNaN(tdt.getTime())) {
          isExpired = vdt < tdt;
        }
      } catch (err) { isExpired = false; }
    }
    var stClass = isExpired && e.status !== 'approved' ? 'b-red' : _badge(e.status || 'pending');
    var stText = isExpired && e.status !== 'approved' ? 'EXPIRED' : (e.status || 'pending').toUpperCase();
    return '<tr>' +
      '<td class="mono" style="font-weight:700;color:#4338CA">' + eid + '</td>' +
      '<td style="font-weight:600">' + _esc(e.customer || '') + '</td>' +
      '<td style="color:var(--muted);font-size:11px">' + _esc(e.date || '') + '</td>' +
      '<td style="color:var(--muted);font-size:11px">' + _esc(e.validTill || '\u2014') + (isExpired ? ' <span style="color:#dc2626">\u26a0\ufe0f</span>' : '') + '</td>' +
      '<td class="mono" style="color:#f59e0b;font-weight:700">' + _fmt(amt) + '</td>' +
      '<td><span class="badge ' + stClass + '">' + stText + '</span></td>' +
      '<td><div style="display:flex;gap:4px">' +
      (!e.converted && !isExpired ? '<button class="btn btn-primary btn-sm" onclick="ERP.sales._convEst(\'' + eid + '\')">\u2192 Invoice</button>' : (e.converted ? '<span class="badge b-teal" style="align-self:center">\u2713 Done</span>' : '')) +
      '<button class="btn btn-ghost btn-sm" onclick="ERP.sales._printEst(\'' + eid + '\')">\ud83d\udda8\ufe0f</button>' +
      '<button class="btn btn-danger btn-sm" onclick="ERP.sales._deleteEstUI(\'' + eid + '\')"><svg><use href="#ic-trash"/></svg></button>' +
      '</div></td>' +
      '</tr>';
  }

  function soRowHTML(o) {
    var amt = (typeof o.grand === 'number' && !isNaN(o.grand))
      ? o.grand
      : (ERP._salesSvc && ERP._salesSvc._totals ? ERP._salesSvc._totals(o.items || []).grand : 0);
    var oid = _esc(o.id || '');
    var itms = (o.items || []).slice(0, 2).map(function (i) { return _esc(i.n || ''); }).join(', ') + (o.items && o.items.length > 2 ? ' +more' : '');
    return '<tr>' +
      '<td class="mono" style="font-weight:700;color:#4338CA">' + oid + '</td>' +
      '<td style="font-weight:600">' + _esc(o.customer || '') + '</td>' +
      '<td style="color:var(--muted);font-size:11px">' + _esc(o.date || '') + '</td>' +
      '<td style="color:var(--muted);font-size:11px">' + itms + '</td>' +
      '<td class="mono" style="color:#f59e0b;font-weight:700">' + _fmt(amt) + '</td>' +
      '<td><span class="badge ' + _badge(o.status || 'pending') + '">' + _esc((o.status || 'pending').toUpperCase()) + '</span></td>' +
      '<td><div style="display:flex;gap:4px">' +
      (!o.converted ? '<button class="btn btn-success btn-sm" onclick="ERP.sales._fulfillSO(\'' + oid + '\')">\u2192 Fulfill</button>' : '<span class="badge b-teal" style="align-self:center">\u2713 Done</span>') +
      '<button class="btn btn-ghost btn-sm" onclick="ERP.sales._printSO(\'' + oid + '\')">\ud83d\udda8\ufe0f</button>' +
      '<button class="btn btn-danger btn-sm" onclick="ERP.sales._deleteSOUI(\'' + oid + '\')"><svg><use href="#ic-trash"/></svg></button>' +
      '</div></td>' +
      '</tr>';
  }

  function payinRowHTML(p) {
    var pid = _esc(p.id || '');
    var allAllocations = [];
    if (ERP._internal && ERP._internal.getState) {
      try {
        var st = ERP._internal.getState();
        allAllocations = (st.data && st.data.paymentAllocations || []);
      } catch (e) { allAllocations = []; }
    }
    var myAllocs = allAllocations.filter(function (a) { return a.paymentId === p.id && !a.voided; });
    var invoiceRefs = myAllocs.length ? myAllocs.map(function (a) { return _esc(a.invoiceId || ''); }).join(', ') : (p.against ? _esc(p.against) : '\u2014');
    var allocated = myAllocs.reduce(function (s, a) { return s + (Number(a.amountAllocated) || 0); }, 0);
    var unallocated = typeof p.unallocatedAmount === 'number' ? p.unallocatedAmount : Math.max(0, (Number(p.amount) || 0) - allocated);
    var custBalance = 0;
    if (ERP._Ledger && ERP._Ledger.getBalance && p.customerId) {
      try { custBalance = ERP._Ledger.getBalance(String(p.customerId)); } catch (e) { custBalance = 0; }
    }
    var balColor = custBalance > 0 ? '#dc2626' : custBalance < 0 ? '#16a34a' : '';
    var balText = custBalance !== 0 ? _fmt(Math.abs(custBalance)) + (custBalance < 0 ? ' Cr' : ' Dr') : '\u2014';
    var voidedStyle = p.voided ? 'opacity:0.5;text-decoration:line-through;' : '';
    return '<tr style="' + voidedStyle + '">' +
      '<td class="mono" style="font-weight:700;color:#4338CA">' + pid + (p.voided ? ' <span class="badge b-red" style="font-size:9px">VOID</span>' : '') + '</td>' +
      '<td style="font-weight:600">' + _esc(p.party || '') + '</td>' +
      '<td class="mono" style="color:#16a34a;font-weight:700">' + _fmt(p.amount || 0) + '</td>' +
      '<td><span class="badge b-blue">' + _esc(p.mode || 'Cash') + '</span></td>' +
      '<td style="color:var(--muted);font-size:11px">' + _esc(p.date || '') + '</td>' +
      '<td style="color:var(--muted);font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis">' + invoiceRefs + '</td>' +
      '<td class="mono" style="color:#22c55e">' + (allocated > 0 ? _fmt(allocated) : '\u2014') + '</td>' +
      '<td class="mono" style="color:#f59e0b">' + (unallocated > 0 ? _fmt(unallocated) : '\u2014') + '</td>' +
      '<td class="mono" style="color:' + balColor + ';font-size:11px">' + balText + '</td>' +
      '<td style="color:var(--muted);font-size:11px">' + _esc(p.notes || '') + '</td>' +
      '<td style="display:flex;gap:4px">' +
      (!p.voided ? '<button class="btn btn-sm" style="background:#f0fdf4;border:1px solid #bbf7d0;color:#16a34a" title="Print Receipt" onclick="ERP.sales._printPayIn(\'' + pid + '\')">\ud83d\udda8\ufe0f</button>' : '') +
      '<button class="btn btn-danger btn-sm" title="' + (p.voided ? 'Already Voided' : 'Void Payment') + '" ' + (p.voided ? 'disabled' : '') + ' onclick="ERP.sales._deletePayInUI(\'' + pid + '\')"><svg><use href="#ic-trash"/></svg></button>' +
      '</td>' +
      '</tr>';
  }

  function dcRowHTML(c) {
    var cid = _esc(c.id || '');
    var itms = (c.items || []).slice(0, 2).map(function (i) { return _esc(i.n || ''); }).join(', ') + (c.items && c.items.length > 2 ? ' +more' : '');
    return '<tr>' +
      '<td class="mono" style="font-weight:700;color:#0284c7">' + cid + '</td>' +
      '<td style="font-weight:600">' + _esc(c.customer || '') + '</td>' +
      '<td style="color:var(--muted);font-size:11px">' + _esc(c.date || '') + '</td>' +
      '<td style="color:var(--muted);font-size:11px">' + itms + '</td>' +
      '<td style="color:var(--muted);font-size:11px">' + _esc(c.addr || '') + '</td>' +
      '<td><span class="badge ' + _badge(c.converted ? 'fulfilled' : 'pending') + '">' + (c.converted ? 'CONVERTED' : 'PENDING') + '</span></td>' +
      '<td><div style="display:flex;gap:4px">' +
      '<button class="btn btn-ghost btn-sm" onclick="ERP.sales._viewChallan(\'' + cid + '\')">\ud83d\udc41\ufe0f</button>' +
      (!c.converted ? '<button class="btn btn-success btn-sm" onclick="ERP.sales._convChallan(\'' + cid + '\')">\u2192 Invoice</button>' : '<span class="badge b-teal" style="align-self:center">\u2713 Done</span>') +
      '</div></td>' +
      '</tr>';
  }

  function retRowHTML(r) {
    var rid = _esc(r.id || '');
    var displayAmt = Number(r.returnGrand) || Number(r.amount) || 0;
    var cashOut = Number(r.cashPaidOut) || 0;
    var itemsSummary = (r.items || []).map(function (i) {
      return _esc((i.n || '').substring(0, 18)) + ' \u00d7' + (Number(i.q) || 1);
    }).join(' | ') || '\u2014';
    var modeLower = (r.mode || '').toLowerCase();
    var modeColor = modeLower.indexOf('cash') >= 0 ? '#16a34a'
      : modeLower.indexOf('bank') >= 0 ? '#0284c7' : '#7c3aed';
    var modeBg = modeLower.indexOf('cash') >= 0 ? '#dcfce7'
      : modeLower.indexOf('bank') >= 0 ? '#dbeafe' : '#f3e8ff';
    var cashCell = cashOut > 0
      ? '<span style="color:#16a34a;font-weight:700">' + _fmt(cashOut) + '</span>'
      : '<span style="color:#94a3b8;font-size:11px">\u2014</span>';
    return '<tr>' +
      '<td class="mono" style="font-weight:700;color:#7c3aed">' + rid + '</td>' +
      '<td style="font-weight:600">' + _esc(r.customer || '') + '</td>' +
      '<td class="mono">' + _esc(r.originalInv || '\u2014') + '</td>' +
      '<td style="font-size:11px;color:var(--muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + _esc(itemsSummary) + '">' + itemsSummary + '</td>' +
      '<td class="mono" style="font-weight:700"><span style="color:#dc2626">' + _fmt(displayAmt) + '</span></td>' +
      '<td><span style="background:' + modeBg + ';color:' + modeColor + ';border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700">' + _esc(r.mode || 'Cash Refund') + '</span></td>' +
      '<td>' + cashCell + '</td>' +
      '<td style="color:var(--muted);font-size:11px">' + _esc(r.date || '') + '</td>' +
      '<td style="color:var(--muted);font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis">' + _esc(r.reason || '\u2014') + '</td>' +
      '<td><div style="display:flex;gap:4px">' +
      '<button class="btn btn-ghost btn-sm" onclick="ERP.sales._viewCreditNote && ERP.sales._viewCreditNote(\'' + rid + '\')" title="View">\ud83d\udc41\ufe0f</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="ERP.sales._printCreditNote && ERP.sales._printCreditNote(\'' + rid + '\')" title="Print">\ud83d\udda8\ufe0f</button>' +
      '<button class="btn btn-danger btn-sm" onclick="ERP.sales._deleteRetUI(\'' + rid + '\')"><svg><use href="#ic-trash"/></svg></button>' +
      '</div></td>' +
      '</tr>';
  }

  function subRowHTML(prefix, idx, row) {
    var i = parseInt(idx, 10);
    if (isNaN(i)) i = 0;
    return '<tr>' +
      '<td style="padding:4px 8px;color:#94a3b8;text-align:center;font-size:11px">' + (i + 1) + '</td>' +
      '<td style="padding:4px 8px"><input class="fi sm" style="min-width:150px" value="' + _esc(row.n || '') + '" id="' + prefix + '-item-' + i + '" name="' + prefix + '-item" list="' + prefix + '-inv-dl" data-pfx="' + prefix + '" data-idx="' + i + '" oninput="ERP.sales._subFillPriceEl(this)" placeholder="Item / service\u2026"></td>' +
      '<td style="padding:4px 8px"><input class="fi sm" type="number" name="' + prefix + '-qty-' + i + '" value="' + Math.abs(Number(row.q) || 1) + '" style="width:65px" onkeydown="if(event.key===\'Enter\'){event.preventDefault();}" oninput="ERP.sales._subData.' + prefix + '[' + i + '].q=+this.value;var tc=document.getElementById(\'' + prefix + '-tot-' + i + '\');if(tc){tc.textContent=ERP._salesFmt((ERP.sales._subData.' + prefix + '[' + i + '].q||1)*(ERP.sales._subData.' + prefix + '[' + i + '].p||0));}"></td>' +
      (row.hasPrice !== false
        ? '<td style="padding:4px 8px"><input id="' + prefix + '-p-' + i + '" class="fi sm" type="number" value="' + Math.abs(Number(row.p) || 0) + '" style="width:90px" onkeydown="if(event.key===\'Enter\'){event.preventDefault();}" oninput="ERP.sales._subData.' + prefix + '[' + i + '].p=+this.value;var tc=document.getElementById(\'' + prefix + '-tot-' + i + '\');if(tc){tc.textContent=ERP._salesFmt((ERP.sales._subData.' + prefix + '[' + i + '].q||1)*(ERP.sales._subData.' + prefix + '[' + i + '].p||0));}"></td>' +
        '<td id="' + prefix + '-tot-' + i + '" style="padding:4px 8px;font-weight:700;color:#4338CA;font-size:12px;min-width:70px">' + _fmt((Number(row.q) || 1) * (Number(row.p) || 0)) + '</td>'
        : '<td colspan="2"></td>') +
      '<td style="padding:4px 8px"><button type="button" onclick="ERP.sales._subSyncFromDOM(\'' + prefix + '\');ERP.sales._subData.' + prefix + '.splice(' + i + ',1);ERP.sales._subRefresh(\'' + prefix + '\')" style="background:none;border:none;color:#cbd5e1;cursor:pointer;font-size:15px;width:26px;height:26px;border-radius:50%" onmouseover="this.style.color=\'#ef4444\';this.style.background=\'#fee2e2\'" onmouseout="this.style.color=\'#cbd5e1\';this.style.background=\'none\'">\u2715</button></td>' +
      '</tr>';
  }

  function buildEstimateHTML(est, theme, color, biz, totals, numWords) {
    var doc = Object.assign({}, est, { paid: 0 });
    return buildInvoiceHTML(doc, theme, color, biz, totals, numWords, 'estimate');
  }

  function buildSOHTML(so, theme, color, biz, totals, numWords) {
    var doc = Object.assign({}, so, { paid: 0 });
    return buildInvoiceHTML(doc, theme, color, biz, totals, numWords, 'so');
  }

  function buildReceiptHTML(pi, biz) {
    biz = biz || {};
    var bizName = _esc(biz.name || 'MH Autos');
    var bizPhone = _esc(biz.phone || '');
    var bizAddr = _esc(biz.addr || biz.address || '');
    var logo = _safeLogo(biz.logo) || '';
    var amount = Number(pi.amount) || 0;
    var color = '#16a34a';
    return '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      '<style>*{box-sizing:border-box;margin:0;padding:0}' +
      'body{font-family:Segoe UI,Inter,system-ui,Arial,sans-serif;background:#f8fafc;display:flex;justify-content:center;padding:30px}' +
      '.receipt{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);width:360px;overflow:hidden}' +
      '.hdr{background:linear-gradient(135deg,#16a34a,#15803d);padding:24px;text-align:center;color:#fff}' +
      '.hdr .ic{width:56px;height:56px;background:rgba(255,255,255,.2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto 10px}' +
      '.hdr h1{font-size:22px;font-weight:900;letter-spacing:-.5px}' +
      '.hdr p{font-size:12px;opacity:.8;margin-top:2px}' +
      '.body{padding:20px}' +
      '.amount-box{background:#f0fdf4;border:2px solid #bbf7d0;border-radius:12px;padding:16px;text-align:center;margin-bottom:18px}' +
      '.amount-box .lbl{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;font-weight:600}' +
      '.amount-box .val{font-size:36px;font-weight:900;color:#16a34a;letter-spacing:-1px;margin-top:4px}' +
      '.row{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px dashed #f1f5f9}' +
      '.row:last-child{border-bottom:none}' +
      '.row .k{font-size:12px;color:#9ca3af;font-weight:600}' +
      '.row .v{font-size:12px;color:#1e293b;font-weight:700}' +
      '.ftr{background:#f8fafc;border-top:1px solid #f1f5f9;padding:14px;text-align:center}' +
      '.ftr .biz{font-size:14px;font-weight:700;color:#1e293b}' +
      '.ftr .sub{font-size:11px;color:#9ca3af;margin-top:2px}' +
      '.stamp{display:inline-block;border:3px solid #16a34a;border-radius:8px;padding:4px 16px;color:#16a34a;font-weight:900;font-size:16px;letter-spacing:2px;margin-top:12px;transform:rotate(-3deg)}' +
      '@media print{body{background:none;padding:0}.receipt{box-shadow:none;border-radius:0;width:100%}}' +
      '</style></head><body>' +
      '<div class="receipt">' +
      '<div class="hdr">' +
      (logo ? '<img src="' + _esc(logo) + '" style="height:48px;object-fit:contain;margin-bottom:8px;border-radius:6px">' : '<div class="ic">\ud83d\udcb5</div>') +
      '<h1>Payment Receipt</h1>' +
      '<p>' + bizName + '</p>' +
      '</div>' +
      '<div class="body">' +
      '<div class="amount-box">' +
      '<div class="lbl">Amount Received</div>' +
      '<div class="val">' + _fmt(amount) + '</div>' +
      '</div>' +
      '<div class="row"><span class="k">Receipt No.</span><span class="v">' + _esc(pi.id || '\u2014') + '</span></div>' +
      '<div class="row"><span class="k">Date</span><span class="v">' + _esc(pi.date || '\u2014') + '</span></div>' +
      '<div class="row"><span class="k">Received From</span><span class="v">' + _esc(pi.party || pi.customer || '\u2014') + '</span></div>' +
      (pi.against ? '<div class="row"><span class="k">Against Invoice</span><span class="v">' + _esc(pi.against) + '</span></div>' : '') +
      '<div class="row"><span class="k">Payment Mode</span><span class="v">' + _esc(pi.mode || pi.method || 'Cash') + '</span></div>' +
      (pi.notes ? '<div class="row"><span class="k">Reference</span><span class="v">' + _esc(pi.notes) + '</span></div>' : '') +
      '<div style="text-align:center;margin-top:16px"><div class="stamp">PAID</div></div>' +
      '</div>' +
      '<div class="ftr">' +
      '<div class="biz">' + bizName + '</div>' +
      (bizPhone ? '<div class="sub">\ud83d\udcde ' + bizPhone + '</div>' : '') +
      (bizAddr ? '<div class="sub">\ud83d\udccd ' + bizAddr + '</div>' : '') +
      '<div class="sub" style="margin-top:6px;font-size:10px">Thank you for your payment!</div>' +
      '</div>' +
      '</div>' +
      '</body></html>';
  }

  function payoutRowHTML(p) {
    var pid = _esc(p.id || '');
    var voidedStyle = p.voided ? 'opacity:0.5;text-decoration:line-through;' : '';
    return '<tr style="' + voidedStyle + '">' +
      '<td class="mono" style="font-weight:700;color:#7c3aed">' + pid + (p.voided ? ' <span class="badge b-red" style="font-size:9px">VOID</span>' : '') + '</td>' +
      '<td style="font-weight:600">' + _esc(p.customer || '') + '</td>' +
      '<td class="mono" style="color:#dc2626;font-weight:700">' + _fmt(p.amount || 0) + '</td>' +
      '<td><span class="badge b-purple">' + _esc(p.mode || 'Cash') + '</span></td>' +
      '<td style="color:var(--muted);font-size:11px">' + _esc(p.date || '') + '</td>' +
      '<td class="mono" style="color:#7c3aed;font-size:11px">' + _esc(p.cnRef || '\u2014') + '</td>' +
      '<td style="color:var(--muted);font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis">' + _esc(p.notes || '\u2014') + '</td>' +
      '<td>' +
      (!p.voided
        ? '<button class="btn btn-danger btn-sm" onclick="ERP.sales._voidPayOut(\'' + pid + '\')" title="Void Refund"><svg><use href="#ic-trash"/></svg></button>'
        : '<button class="btn btn-sm" disabled style="opacity:.4"><svg><use href="#ic-trash"/></svg></button>') +
      '</td>' +
      '</tr>';
  }

  ERP._salesTemplates = {
    buildInvoiceHTML: buildInvoiceHTML,
    buildEstimateHTML: buildEstimateHTML,
    buildSOHTML: buildSOHTML,
    buildReceiptHTML: buildReceiptHTML,
    buildThermalHTML: buildThermalHTML,
    invoiceRowHTML: invoiceRowHTML,
    estimateRowHTML: estimateRowHTML,
    soRowHTML: soRowHTML,
    payinRowHTML: payinRowHTML,
    payoutRowHTML: payoutRowHTML,
    dcRowHTML: dcRowHTML,
    retRowHTML: retRowHTML,
    subRowHTML: subRowHTML,
    badge: _badge,
    badgeStyle: _badgeStyle,
    esc: _esc,
    fmt: _fmt
  };

})(window.ERP = window.ERP || {});
