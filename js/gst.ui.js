
'use strict';

(function (root) {
  'use strict';

  var ERP = root.ERP;
  if (!ERP) { console.error('[gst.ui] ERP namespace missing.'); return; }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function _fmt(n) {
    // FIX (root cause, audit #75): was a hardcoded 'Rs.' reimplementation of
    // ERP.fmt() -- duplication meant this would silently ignore a configured
    // non-default business currency. Fallback kept only for a genuine
    // load-order fluke (core.js loads before this file in normal operation).
    if (window.ERP && typeof window.ERP.fmt === 'function') return window.ERP.fmt(n);
    n = n || 0;
    return 'Rs.' + Number(n).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function _fmtPct(n) {
    return Number(n || 0).toFixed(1) + '%';
  }

  var _period = 'this_month';
  var _customFrom = '';
  var _customTo   = '';

  function _today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  
  function _curMonth() { return ERP.DateUtils.today().slice(0, 7); }
  function _lastMonth() {
    
    var today = ERP.DateUtils.today();
    var yr = parseInt(today.slice(0, 4), 10);
    var mo = parseInt(today.slice(5, 7), 10);
    var lmYr = mo === 1 ? yr - 1 : yr;
    var lmMo = mo === 1 ? 12 : mo - 1;
    return lmYr + '-' + String(lmMo).padStart(2, '0');
  }
  function _curYear() { return new Date().getFullYear().toString(); }

  function _inRange(dateStr) {
    if (!dateStr) return false;
    if (_period === 'this_month')  return dateStr.startsWith(_curMonth());
    if (_period === 'last_month')  return dateStr.startsWith(_lastMonth());
    if (_period === 'this_year')   return dateStr.startsWith(_curYear());
    if (_period === 'custom') {
      if (_customFrom && dateStr < _customFrom) return false;
      if (_customTo   && dateStr > _customTo)   return false;
      return true;
    }
    return false;
  }

  function _periodLabel() {
    if (_period === 'this_month')  return 'This Month (' + _curMonth() + ')';
    if (_period === 'last_month')  return 'Last Month (' + _lastMonth() + ')';
    if (_period === 'this_year')   return 'This Year (' + _curYear() + ')';
    if (_period === 'custom')      return (_customFrom || '?') + ' → ' + (_customTo || '?');
    return '';
  }

  function _getSettings() {
    try { return ERP.getState().settings || {}; } catch (e) { return {}; }
  }
  function _getBiz() {
    try { return ERP.getState().biz || {}; } catch (e) { return {}; }
  }
  function _getSales() {
    try { return (ERP.getState().data || {}).sales || []; } catch (e) { return []; }
  }
  function _getPurchases() {
    try { return (ERP.getState().data || {}).purchases || []; } catch (e) { return []; }
  }
  function _getACC() {
    try { return window.AccountingCore || null; } catch (e) { return null; }
  }

  function _computeGSTReportTotals() {
    var settings = _getSettings();
    var taxRate  = parseFloat(settings.taxRate) || 0;
    var ACC      = _getACC();

    if (ACC && ACC.AccountingState && ACC.AccountingState.isInitialized()) {
      return _computeFromGL(ACC, taxRate);
    }

    return _computeLegacy(taxRate);
  }

  function _computeFromGL(ACC, taxRate) {
    var ACCTS   = ACC.SYSTEM_ACCOUNTS;
    var journals = ACC.AccountingState.getAllJournals ? ACC.AccountingState.getAllJournals() : [];

    var outputTax    = 0;
    var inputTax     = 0;
    var taxableSales = 0;
    var totalSales   = 0;
    var totalPurchases = 0;
    var totalExpenses  = 0;
    var invoiceCount = 0;
    var purchaseCount  = 0;
    var expenseCount   = 0;
    var monthlyOutput = {};

    journals.forEach(function(j) {
      if (j.status === 'reversed') return;
      var jDate = (j.date || '').slice(0, 10);
      if (!_inRange(jDate)) return;

      var src = j.sourceModule || '';

      (j.entries || []).forEach(function(e) {
        var accId = e.accountId;

        if (accId === ACCTS.GST_PAYABLE) {
          outputTax += (e.credit || 0);
        }
        if (accId === ACCTS.GST_RECEIVABLE) {
          inputTax += (e.debit || 0);
        }
        if (accId === ACCTS.SALES_REV) {
          taxableSales += (e.credit || 0);
        }
        if (accId === ACCTS.PURCHASE_EXP && (src === 'purchase' || src === 'expenses')) {
          totalPurchases += (e.debit || 0);
        }
        if ((accId === ACCTS.ADMIN || accId === ACCTS.PURCHASE_EXP) && src === 'expenses') {
          totalExpenses += (e.debit || 0);
        }
      });

      if (src === 'sales')    invoiceCount++;
      if (src === 'purchase') purchaseCount++;
      if (src === 'expenses') expenseCount++;

      if (src === 'sales') {
        var mo = jDate.slice(0, 7);
        if (mo) {
          if (!monthlyOutput[mo]) monthlyOutput[mo] = { taxable: 0, tax: 0, invoices: 0 };
          var jSales = 0; var jTax = 0;
          (j.entries || []).forEach(function(e2) {
            if (e2.accountId === ACCTS.SALES_REV)    jSales += (e2.credit || 0);
            if (e2.accountId === ACCTS.GST_PAYABLE)  jTax   += (e2.credit || 0);
          });
          monthlyOutput[mo].taxable  += jSales;
          monthlyOutput[mo].tax      += jTax;
          monthlyOutput[mo].invoices += 1;
        }
      }
    });

    var p2r = function(p) { return p / 100; };
    totalSales = taxableSales + outputTax;

    return {
      source:         'gl',
      taxRate:        taxRate,
      totalSales:     p2r(totalSales),
      taxableSales:   p2r(taxableSales),
      outputTax:      p2r(outputTax),
      totalPurchases: p2r(totalPurchases),
      totalExpenses:  p2r(totalExpenses),
      inputTax:       p2r(inputTax),
      netPayable:     p2r(outputTax - inputTax),
      invoiceCount:   invoiceCount,
      purchaseCount:  purchaseCount,
      expenseCount:   expenseCount,
      monthlyOutput:  _convertMonthlyToRupees(monthlyOutput),
    };
  }

  function _convertMonthlyToRupees(monthly) {
    var out = {};
    Object.keys(monthly).forEach(function(mo) {
      out[mo] = {
        taxable:  monthly[mo].taxable  / 100,
        tax:      monthly[mo].tax      / 100,
        invoices: monthly[mo].invoices,
      };
    });
    return out;
  }

  function _computeLegacy(taxRate) {
    var sales     = _getSales();
    var purchases = _getPurchases();

    var outputTax    = 0;
    var taxableSales = 0;
    var totalSales   = 0;
    var invoiceCount = 0;

    var monthlyOutput = {};

    sales.forEach(function (s) {
      if (!_inRange(s.date)) return;
      invoiceCount++;

      var lineTotal = 0;
      var lineTax   = 0;
      (s.items || []).forEach(function (it) {
        var base = (it.q || 1) * (it.p || 0) - (it.d || 0);
        lineTotal += base;
        if (typeof it.taxAmt === 'number' && it.taxAmt > 0) {
          lineTax += it.taxAmt;
        } else if (taxRate > 0) {
          lineTax += base * taxRate / 100;
        }
      });

      totalSales   += lineTotal;
      taxableSales += lineTotal;
      outputTax    += lineTax;

      var mo = (s.date || '').slice(0, 7);
      if (mo) {
        if (!monthlyOutput[mo]) monthlyOutput[mo] = { taxable: 0, tax: 0, invoices: 0 };
        monthlyOutput[mo].taxable   += lineTotal;
        monthlyOutput[mo].tax       += lineTax;
        monthlyOutput[mo].invoices  += 1;
      }
    });

    var inputTax     = 0;
    var totalPurchases = 0;
    var purchaseCount  = 0;

    purchases.forEach(function (p) {
      if (!_inRange(p.date)) return;
      purchaseCount++;
      var amt = p.amt || 0;
      totalPurchases += amt;
      var storedTax = (typeof p.tax    === 'number' && p.tax    > 0) ? p.tax    :
                      (typeof p.taxAmt === 'number' && p.taxAmt > 0) ? p.taxAmt : null;
      if (storedTax !== null) {
        inputTax += storedTax;
      } else if (taxRate > 0) {
        inputTax += amt - (amt / (1 + taxRate / 100));
      }
    });

    return {
      source:         'legacy',
      taxRate:        taxRate,
      totalSales:     totalSales,
      taxableSales:   taxableSales,
      outputTax:      outputTax,
      totalPurchases: totalPurchases,
      totalExpenses:  0,
      inputTax:       inputTax,
      netPayable:     outputTax - inputTax,
      invoiceCount:   invoiceCount,
      purchaseCount:  purchaseCount,
      expenseCount:   0,
      monthlyOutput:  monthlyOutput,
    };
  }

  function _monthlyRows(monthly) {
    var months = Object.keys(monthly).sort().reverse();
    if (months.length === 0) {
      return '<tr><td colspan="4" style="text-align:center;padding:28px;color:var(--muted)">No data for selected period.</td></tr>';
    }
    return months.map(function (mo) {
      var d = monthly[mo];
      return '<tr style="border-bottom:1px solid var(--border-l)">' +
        '<td style="padding:10px 14px;font-weight:500">' + _esc(mo) + '</td>' +
        '<td style="padding:10px 14px;text-align:right">' + d.invoices + '</td>' +
        '<td style="padding:10px 14px;text-align:right">' + _fmt(d.taxable) + '</td>' +
        '<td style="padding:10px 14px;text-align:right;font-weight:700;color:#22c55e">' + _fmt(d.tax) + '</td>' +
      '</tr>';
    }).join('');
  }

  function render() {
    var pv = document.getElementById('pv-gst');
    if (!pv) return;

    var biz      = _getBiz();
    var settings = _getSettings();
    var totals   = _computeGSTReportTotals();

    var netColor = totals.netPayable >= 0 ? '#ef4444' : '#22c55e';
    var netLabel = totals.netPayable >= 0 ? 'Tax Payable' : 'Tax Refundable';
    var isGL     = totals.source === 'gl';
    var srcBadge = isGL
      ? '<span style="display:inline-block;background:#dcfce7;color:#16a34a;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;margin-left:8px">&#10003; GL Connected</span>'
      : '<span style="display:inline-block;background:#fef9c3;color:#b45309;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;margin-left:8px">&#9888; Legacy Mode</span>';

    var expRow = totals.totalExpenses > 0
      ? _returnRow('Expenses (' + (totals.expenseCount || 0) + ' entries)', _fmt(totals.totalExpenses), '#f59e0b')
      : '';
    var glNote = isGL
      ? '<div style="margin-top:6px;color:#16a34a">&#10003; Data from General Ledger (Sales + Purchases + Expenses)</div>'
      : '<div style="margin-top:6px;color:#b45309">&#9888; Save a new invoice/purchase to activate GL mode</div>';

    pv.innerHTML = '<div style="padding:16px;max-width:960px;margin:0 auto">'

      + '<div style="background:var(--card,#fff);border:1px solid var(--border);border-radius:10px;padding:16px 20px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">'
      +   '<div>'
      +     '<div style="font-size:16px;font-weight:700;color:var(--text)">' + _esc(biz.name || 'MH Autos') + srcBadge + '</div>'
      +     '<div style="font-size:12px;color:var(--muted);margin-top:2px">'
      +       (biz.gst ? 'NTN / GSTIN: <strong style="color:var(--text)">' + _esc(biz.gst) + '</strong>' : '<span style="color:#f59e0b">&#9888;&#65039; NTN not set — go to Settings &rarr; Business Info</span>')
      +     '</div>'
      +   '</div>'
      +   '<div style="text-align:right">'
      +     '<div style="font-size:12px;color:var(--muted)">Configured Tax Rate</div>'
      +     '<div style="font-size:22px;font-weight:700;color:var(--primary)">' + _fmtPct(totals.taxRate) + '</div>'
      +   '</div>'
      + '</div>'

      + '<div style="display:flex;gap:8px;align-items:center;margin-bottom:18px;flex-wrap:wrap">'
      +   '<span style="font-size:12px;color:var(--muted);font-weight:600">PERIOD:</span>'
      +   ['this_month', 'last_month', 'this_year', 'custom'].map(function (p) {
            var labels = { this_month: 'This Month', last_month: 'Last Month', this_year: 'This Year', custom: 'Custom' };
            var active = _period === p;
            return '<button class="au-btn gst-period-btn ' + (active ? 'au-btn-primary' : 'au-btn-ghost') + '" data-period="' + p + '" style="height:30px;font-size:12px;padding:0 12px">' + labels[p] + '</button>';
          }).join('')
      +   (_period === 'custom'
            ? '<input type="date" id="gst-from" value="' + _esc(_customFrom) + '" style="height:30px;border:1px solid var(--border);border-radius:6px;padding:0 8px;font-size:12px">'
            + '<span style="color:var(--muted);font-size:12px">&rarr;</span>'
            + '<input type="date" id="gst-to" value="' + _esc(_customTo) + '" style="height:30px;border:1px solid var(--border);border-radius:6px;padding:0 8px;font-size:12px">'
            + '<button id="gst-custom-apply" class="btn btn-sm btn-primary" style="font-size:12px;padding:4px 10px">Apply</button>'
            : '')
      + '</div>'

      + '<div style="font-size:12px;color:var(--muted);margin-bottom:14px">Showing: <strong>' + _esc(_periodLabel()) + '</strong></div>'

      + window.renderStatCards([
          { icon:'⬇️', value:_fmt(totals.outputTax), label:'Output Tax', color:'#16a34a', bg:'#f0fdf4' },
          { icon:'🚚', value:_fmt(totals.inputTax),  label:'Input Tax',  color:'#4338CA', bg:'#eff6ff' },
          { icon:'💰', value:_fmt(Math.abs(totals.netPayable)), label:netLabel, color: totals.netPayable >= 0 ? '#dc2626' : '#16a34a', bg: totals.netPayable >= 0 ? '#fef2f2' : '#f0fdf4' },
          { icon:'🧾', value:_fmt(totals.totalSales), label:'Total Sales', color:'#7c3aed', bg:'#f5f3ff' },
        ])

      + '<div style="display:grid;grid-template-columns:1fr 320px;gap:16px;align-items:start">'

      +   '<div class="au-panel" style="padding:0;overflow:hidden">'
      +     '<div style="padding:12px 16px;border-bottom:1px solid var(--border-l)"><span style="font-weight:700;font-size:13px">📊 MONTHLY OUTPUT TAX BREAKDOWN</span></div>'
      +     '<div style="overflow-x:auto">'
      +     '<table class="au-tbl">'
      +       '<thead><tr>'
      +         '<th style="padding:8px 14px;text-align:left;color:var(--muted);font-weight:600">Month</th>'
      +         '<th style="padding:8px 14px;text-align:right;color:var(--muted);font-weight:600">Invoices</th>'
      +         '<th style="padding:8px 14px;text-align:right;color:var(--muted);font-weight:600">Taxable Sales</th>'
      +         '<th style="padding:8px 14px;text-align:right;color:var(--muted);font-weight:600">Output Tax</th>'
      +       '</tr></thead>'
      +       '<tbody>' + _monthlyRows(totals.monthlyOutput) + '</tbody>'
      +       (Object.keys(totals.monthlyOutput).length > 0
          ? '<tfoot><tr style="background:var(--bg);border-top:2px solid var(--border);font-weight:700">'
          +   '<td style="padding:10px 14px">Total</td>'
          +   '<td style="padding:10px 14px;text-align:right">' + totals.invoiceCount + '</td>'
          +   '<td style="padding:10px 14px;text-align:right">' + _fmt(totals.taxableSales) + '</td>'
          +   '<td style="padding:10px 14px;text-align:right;color:#22c55e">' + _fmt(totals.outputTax) + '</td>'
          + '</tr></tfoot>'
          : '')
      +     '</table></div>'
      +   '</div>'

      +   '<div style="display:flex;flex-direction:column;gap:14px">'

      +     '<div class="au-panel">'
      +       '<div style="padding:12px 16px;border-bottom:1px solid var(--border-l)"><span style="font-weight:700;font-size:13px">🧾 TAX RETURN SUMMARY</span></div>'
      +       '<div style="padding:4px 0">'
      +         _returnRow('Sales (Taxable)', _fmt(totals.taxableSales))
      +         _returnRow('Output Tax (Sales)', _fmt(totals.outputTax), '#22c55e')
      +         _returnRow('Purchases', _fmt(totals.totalPurchases))
      +         _returnRow('Input Tax (Purchases)', _fmt(totals.inputTax), '#4338CA')
      +         expRow
      +         '<div style="border-top:2px solid var(--border);margin:8px 0"></div>'
      +         _returnRow(netLabel, _fmt(Math.abs(totals.netPayable)), netColor, true)
      +       '</div>'
      +     '</div>'

      +     '<div class="au-panel">'
      +       '<div style="padding:12px 16px;border-bottom:1px solid var(--border-l)"><span style="font-weight:700;font-size:13px">💡 FILING NOTES</span></div>'
      +       '<div style="padding:12px;font-size:12px;color:var(--muted);line-height:1.7">'
      +         '<div>&bull; Output Tax = Tax you <strong>collected</strong> from customers</div>'
      +         '<div>&bull; Input Tax = Tax you <strong>paid</strong> to suppliers</div>'
      +         '<div>&bull; Net Payable = Output &minus; Input (submit to FBR/Tax authority)</div>'
      +         glNote
      +         '<div style="margin-top:8px;padding:8px;background:var(--bg);border-radius:6px">&#127963;&#65039; File your GST return monthly via <strong>FBR IRIS</strong> portal or consult your tax advisor.</div>'
      +       '</div>'
      +     '</div>'

      +     '<button id="gst-print-btn" class="au-btn au-btn-primary" style="width:100%;height:38px;font-size:13px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;vertical-align:-2px"><use href="#ic-print"/></svg> Print / Export Summary</button>'
      +     '<button id="gst-export-json-btn" class="au-btn au-btn-ghost" style="width:100%;height:38px;font-size:13px;margin-top:8px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;vertical-align:-2px"><use href="#ic-invoice"/></svg> Export GSTR-1 JSON (FBR IRIS)</button>'

      +   '</div>'
      + '</div>'
      + '</div>';

    _bindEvents(pv);
  }


  function _sumCard(label, value, sub, color) {
    return '<div style="background:var(--card,#fff);border:1px solid var(--border);border-radius:8px;padding:16px;border-left:4px solid ' + color + '">' +
      '<div style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.4px">' + _esc(label) + '</div>' +
      '<div style="font-size:20px;font-weight:700;color:' + color + ';margin-top:4px">' + _esc(value) + '</div>' +
      '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + _esc(sub) + '</div>' +
    '</div>';
  }

  function _returnRow(label, value, color, bold) {
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 14px;border-bottom:1px solid var(--border-l)">' +
      '<span style="font-size:13px;color:var(--muted)' + (bold ? ';font-weight:700;color:var(--text)' : '') + '">' + _esc(label) + '</span>' +
      '<span style="font-size:13px;font-weight:700;color:' + (color || 'var(--text)') + '">' + _esc(value) + '</span>' +
    '</div>';
  }

  function _bindEvents(pv) {
    pv.querySelectorAll('.gst-period-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _period = btn.getAttribute('data-period');
        if (_period !== 'custom') { _customFrom = ''; _customTo = ''; }
        render();
      });
    });

    var applyBtn = document.getElementById('gst-custom-apply');
    if (applyBtn) {
      applyBtn.addEventListener('click', function () {
        _customFrom = (document.getElementById('gst-from') || {}).value || '';
        _customTo   = (document.getElementById('gst-to')   || {}).value || '';
        render();
      });
    }

    var printBtn = document.getElementById('gst-print-btn');
    if (printBtn) {
      printBtn.addEventListener('click', function () {
        if(window.RTP&&window.RTP._print){window.RTP._print('GST Report');}else{window.print();}
      });
    }

    var exportBtn = document.getElementById('gst-export-json-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        _exportGSTR1JSON();
      });
    }
  }

  function _exportGSTR1JSON() {
    try {
      var state    = ERP.getState ? ERP.getState() : {};
      var sales    = (state.data && state.data.sales) || [];
      var settings = state.settings || {};
      var biz      = state.biz || {};
      var taxRate  = settings.taxRate || 17;

      var filtered = sales.filter(function (s) { return _inRange(s.date || s.createdAt); });

      var b2cInvoices = filtered.map(function (s) {
        var items    = s.items || [];
        var totalAmt = items.reduce(function (a, i) { return a + ((i.q||1)*(i.p||0)-(i.d||0)); }, 0);
        var taxAmt   = s.taxAmt || s.tax || (totalAmt * taxRate / 100);
        return {
          invoice_no:     s.id || '',
          invoice_date:   s.date || '',
          customer_name:  s.customer || 'Walk-in',
          customer_ntn:   s.customerNTN || '',
          taxable_value:  Math.round(totalAmt * 100) / 100,
          tax_amount:     Math.round(taxAmt * 100) / 100,
          gross_total:    Math.round((totalAmt + taxAmt) * 100) / 100,
          tax_rate:       taxRate
        };
      });

      var hsnMap = {};
      filtered.forEach(function (s) {
        (s.items || []).forEach(function (i) {
          var hsn = i.hsn || i.hsnCode || 'GENERAL';
          if (!hsnMap[hsn]) hsnMap[hsn] = { hsn_code: hsn, description: i.n || '', taxable_value: 0, tax_amount: 0, qty: 0 };
          var lineAmt = (i.q||1)*(i.p||0)-(i.d||0);
          var lineTax = i.taxAmt || (lineAmt * taxRate / 100);
          hsnMap[hsn].taxable_value += lineAmt;
          hsnMap[hsn].tax_amount    += lineTax;
          hsnMap[hsn].qty           += (i.q || 1);
        });
      });
      var hsnSummary = Object.keys(hsnMap).map(function (k) {
        var h = hsnMap[k];
        return {
          hsn_code:      h.hsn_code,
          description:   h.description,
          qty:           Math.round(h.qty * 100) / 100,
          taxable_value: Math.round(h.taxable_value * 100) / 100,
          tax_amount:    Math.round(h.tax_amount * 100) / 100
        };
      });

      var totalTaxableValue = b2cInvoices.reduce(function(a,i){return a+i.taxable_value;}, 0);
      var totalTaxAmount    = b2cInvoices.reduce(function(a,i){return a+i.tax_amount;}, 0);

      var gstr1 = {
        return_type:    'GSTR-1',
        filing_period:  _period || 'custom',
        generated_at:   ERP.DateUtils.now(), 
        taxpayer: {
          business_name: biz.name || settings.bizName || '',
          ntn:           biz.ntn  || biz.gst || '',
          tax_year:      new Date().getFullYear()
        },
        summary: {
          total_invoices:    b2cInvoices.length,
          total_taxable_value: Math.round(totalTaxableValue * 100) / 100,
          total_tax_amount:    Math.round(totalTaxAmount    * 100) / 100,
          tax_rate_applied:    taxRate
        },
        b2c_invoices: b2cInvoices,
        hsn_summary:  hsnSummary,
        note: 'Generated by MH Autos ERP. Verify with tax consultant before filing on FBR IRIS portal.'
      };

      var json     = JSON.stringify(gstr1, null, 2);
      var blob     = new Blob([json], { type: 'application/json' });
      var url      = URL.createObjectURL(blob);
      var a        = document.createElement('a');
      var dateStr  = ERP.DateUtils.today(); 
      a.href       = url;
      a.download   = 'GSTR1-' + dateStr + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);

      if (ERP.ui && ERP.ui.toast) ERP.ui.toast('✅ GSTR-1 JSON downloaded — verify before uploading to FBR IRIS', 'success', 5000);
    } catch (e) {
      console.error('[gst.ui] exportGSTR1JSON failed:', e);
      if (ERP.ui && ERP.ui.toast) ERP.ui.toast('❌ Export failed: ' + e.message, 'error');
    }
  }

  function _boot() {
    if (ERP.registerRenderer) {
      ERP.registerRenderer('gst', function () { render(); });
    }

    ERP.gst = { render: render };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

})(typeof window !== 'undefined' ? window : globalThis);
