
'use strict';

(function (root) {
  'use strict';

  if (root.ERP && root.ERP.__phase11_gst) return;

  var ERP = root.ERP = root.ERP || {};

  function _logger() {
    return root.Logger || ERP.Logger || {
      info:  function () {},
      warn:  function (m) { console.warn(m); },
      error: function (m) { console.error(m); }
    };
  }

  function _try(fn, fallback) {
    try { return fn(); }
    catch (e) {
      _logger().warn('[ERP.GSTEngine] _try: ' + (e && e.message || e));
      return (fallback !== undefined ? fallback : null);
    }
  }

  function _accCore() {
    return _try(function () { return root.AccountingCore || null; }, null);
  }

  // Guard moved from module-load-time to call-time: a load-time throw here
  // would crash this entire file (and everything after it in the script
  // order) if it were ever loaded before accounting_constants.js, instead
  // of failing only the one operation that actually needed money parsing.
  function _acc() {
    var ACC = root.AccountingCore;
    if (!ACC || !ACC.Money) throw new Error('[ERP.GSTEngine] ACC.Money missing. Load accounting_constants.js first.');
    return ACC;
  }

  function _num(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return isNaN(v) ? 0 : v;
    var s = String(v).trim();
    s = s.replace(/[A-Za-z₨\$€£]+\.?\s*/g, '');
    s = s.replace(/,/g, '');
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  // Single source of truth: delegates to ACC.Money (accounting_constants.js).
  // Previously this tried ERP.TaxEngine.toPaisa/fromPaisa first, but TaxEngine
  // never actually exposed those as public methods — that branch was always
  // dead code, silently falling through to a naive local parser that didn't
  // handle parentheses-negative amounts.
  function _toPaisa(r) {
    return _acc().Money.toPaisa(r);
  }

  function _toRs(paisa) {
    return _acc().Money.fromPaisa(paisa);
  }

  var ACC_GST_OUTPUT_FALLBACK = 'acc-2200';
  var ACC_GST_INPUT_FALLBACK  = 'acc-1300';

  function _gstOutputAccountId() {
    return _try(function () {
      var ACC = _accCore();
      var sys = ACC && ACC.SYSTEM_ACCOUNTS;
      if (sys && sys.GST_OUTPUT) return sys.GST_OUTPUT;
      return ACC_GST_OUTPUT_FALLBACK;
    }, ACC_GST_OUTPUT_FALLBACK);
  }

  function _gstInputAccountId() {
    return _try(function () {
      var ACC = _accCore();
      var sys = ACC && ACC.SYSTEM_ACCOUNTS;
      if (sys && sys.GST_INPUT) return sys.GST_INPUT;
      return ACC_GST_INPUT_FALLBACK;
    }, ACC_GST_INPUT_FALLBACK);
  }

  function _toYYYYMM(dateStr) {
    return _try(function () {
      var d = new Date(dateStr);
      if (isNaN(d.getTime())) return null;
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }, null);
  }

  function _inPeriod(dateStr, period) {
    return _toYYYYMM(dateStr) === period;
  }

  function _computeFromGL(period) {
    return _try(function () {
      var ACC = _accCore();
      if (!ACC || !ACC.AccountingState) return null;
      if (typeof ACC.AccountingState.getAllJournals !== 'function') return null;

      var journals = ACC.AccountingState.getAllJournals();
      if (!Array.isArray(journals)) return null;

      var outputTax = 0;
      var inputTax  = 0;
      var _seenSaleJournals = new Set();
      var _seenPurchJournals = new Set();
      var outputAccId = _gstOutputAccountId();
      var inputAccId  = _gstInputAccountId();

      journals.forEach(function (j) {
        if (!j || !j.date || !_inPeriod(j.date, period)) return;
        if (!Array.isArray(j.entries)) return;

        j.entries.forEach(function (e) {
          if (!e) return;
          if (e.accountId === outputAccId && e.credit > 0) {
            outputTax += e.credit;
            _seenSaleJournals.add(j.id || j.documentId || ('j-' + outputTax));
          }
          if (e.accountId === inputAccId && e.debit > 0) {
            inputTax += e.debit;
            _seenPurchJournals.add(j.id || j.documentId || ('j-' + inputTax));
          }
        });
      });

      return {
        outputTaxPaisa:  outputTax,
        inputTaxPaisa:   inputTax,
        netPayablePaisa: outputTax - inputTax,
        seenSaleJournals:  _seenSaleJournals.size,
        seenPurchJournals: _seenPurchJournals.size,
        source:          'GL'
      };
    }, null);
  }

  function _computeLegacy(period) {
    return _try(function () {
      var state    = ERP.getState && ERP.getState();
      var sales    = (state && state.data && state.data.sales) || [];
      var taxRate  = ERP.TaxEngine ? ERP.TaxEngine.getRate() : 0;

      var outputTax = 0;
      var salesCount = 0;
      sales.forEach(function (s) {
        if (!s || s.deleted || !_inPeriod(s.date || s.createdAt, period)) return;
        var tax = s.taxAmt || s.tax || s.taxTotal || 0;
        outputTax += _toPaisa(tax);
        salesCount++;
      });

      var purchases = _try(function () {
        var raw = localStorage.getItem('mh_purchase_store');
        return raw ? JSON.parse(raw) : {};
      }, {});

      var bills = (purchases && purchases.data && Array.isArray(purchases.data.purchases))
        ? purchases.data.purchases
        : [];

      var inputTax = 0;
      var purchaseCount = 0;
      bills.forEach(function (b) {
        if (!b || b._deleted || !_inPeriod(b.date || b.createdAt, period)) return;
        var tax = b.tax || b.taxAmt || 0;
        inputTax += _toPaisa(tax);
        purchaseCount++;
      });

      return {
        outputTaxPaisa:  outputTax,
        inputTaxPaisa:   inputTax,
        netPayablePaisa: outputTax - inputTax,
        seenSaleJournals:  salesCount,
        seenPurchJournals: purchaseCount,
        source:          'LEGACY'
      };
    }, null);
  }

  function _getSummary(period) {
    var glResult     = _computeFromGL(period);
    var legacyResult = _computeLegacy(period);

    var glOutputOk = glResult && glResult.seenSaleJournals > 0;
    var glInputOk  = glResult && glResult.seenPurchJournals > 0;

    var result;
    if (!glResult && !legacyResult) {
      result = null;
    } else {
      // Pick the output (sales) tax figure and input (purchase) tax figure
      // independently — each defaults to GL when GL has activity for that
      // side, and falls back to the Legacy (mh_purchase_store / sales
      // records) source otherwise. This prevents one side's silently-failed
      // GL post from wiping out a correct figure on the other side.
      var outputTaxPaisa    = glOutputOk ? glResult.outputTaxPaisa   : (legacyResult ? legacyResult.outputTaxPaisa   : 0);
      var inputTaxPaisa     = glInputOk  ? glResult.inputTaxPaisa    : (legacyResult ? legacyResult.inputTaxPaisa    : 0);
      var seenSaleJournals  = glOutputOk ? glResult.seenSaleJournals : (legacyResult ? legacyResult.seenSaleJournals : 0);
      var seenPurchJournals = glInputOk  ? glResult.seenPurchJournals: (legacyResult ? legacyResult.seenPurchJournals: 0);

      result = {
        outputTaxPaisa:  outputTaxPaisa,
        inputTaxPaisa:   inputTaxPaisa,
        netPayablePaisa: outputTaxPaisa - inputTaxPaisa,
        seenSaleJournals:  seenSaleJournals,
        seenPurchJournals: seenPurchJournals,
        source: (glOutputOk === glInputOk) ? (glOutputOk ? 'GL' : 'LEGACY') : 'MIXED'
      };
    }

    if (!result) {
      return {
        period:          period,
        outputTaxPaisa:  0,
        inputTaxPaisa:   0,
        netPayablePaisa: 0,
        outputTaxRs:     0,
        inputTaxRs:      0,
        netPayableRs:    0,
        seenSaleJournals:  0,
        seenPurchJournals: 0,
        source:          'ERROR'
      };
    }
    return Object.assign({ period: period }, result, {
      outputTaxRs:  _toRs(result.outputTaxPaisa),
      inputTaxRs:   _toRs(result.inputTaxPaisa),
      netPayableRs: _toRs(result.netPayablePaisa)
    });
  }

  function _periodRange(fromYYYYMM, toYYYYMM) {
    var periods = [];
    var cur = new Date(fromYYYYMM + '-01');
    var end = new Date(toYYYYMM  + '-01');
    while (cur <= end) {
      var y = cur.getFullYear();
      var m = String(cur.getMonth() + 1).padStart(2, '0');
      periods.push(y + '-' + m);
      cur.setMonth(cur.getMonth() + 1);
    }
    return periods;
  }

  function _toCSV(summaries) {
    var header = 'Period,Output GST (Rs),Input GST/ITC (Rs),Net Payable (Rs),Sales Count,Purchase Count,Source';
    var rows = summaries.map(function (s) {
      return [s.period, s.outputTaxRs, s.inputTaxRs, s.netPayableRs,
              s.seenSaleJournals, s.seenPurchJournals, s.source].join(',');
    });
    return [header].concat(rows).join('\n');
  }

  function _download(content, filename, mime) {
    return _try(function () {
      var blob = new Blob([content], { type: mime });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
      return true;
    }, false);
  }

  var _ENABLED_KEY = 'mh_gst_engine_enabled';

  function _isEnabled() {
    return _try(function () {
      var v = localStorage.getItem(_ENABLED_KEY);
      return v === null ? true : v === '1';
    }, true);
  }

  function _setEnabled(val) {
    return _try(function () {
      localStorage.setItem(_ENABLED_KEY, val ? '1' : '0');
      return true;
    }, false);
  }

  ERP.GSTEngine = {
    __phase11_gst: true,
    VERSION: '11.11.1',

    isEnabled: function () { return _isEnabled(); },

    setEnabled: function (val) {
      _setEnabled(!!val);
      _logger().info('[ERP.GSTEngine] enabled = ' + !!val);
      return true;
    },

    getPeriodSummary: function (period) {
      return _try(function () {
        if (!_isEnabled()) {
          return { period: period || '', outputTaxPaisa: 0, inputTaxPaisa: 0, netPayablePaisa: 0,
                   outputTaxRs: 0, inputTaxRs: 0, netPayableRs: 0,
                   seenSaleJournals: 0, seenPurchJournals: 0, source: 'DISABLED' };
        }
        if (!period) return _getSummary('');
        return _getSummary(period);
      }, { period: period, outputTaxPaisa: 0, inputTaxPaisa: 0, netPayablePaisa: 0,
           outputTaxRs: 0, inputTaxRs: 0, netPayableRs: 0,
           seenSaleJournals: 0, seenPurchJournals: 0, source: 'ERROR' });
    },

    getYearlySummary: function (fromYYYYMM, toYYYYMM) {
      return _try(function () {
        return _periodRange(fromYYYYMM, toYYYYMM).map(_getSummary);
      }, []);
    },

    reconcile: function (period) {
      return _try(function () {
        var glResult     = _computeFromGL(period);
        var legacyResult = _computeLegacy(period);

        if (!glResult) return { reconciled: false, error: 'GL_UNAVAILABLE' };
        if (!legacyResult) return { reconciled: false, error: 'LEGACY_SCAN_FAILED' };

        var outputDiff = glResult.outputTaxPaisa - legacyResult.outputTaxPaisa;
        var inputDiff  = glResult.inputTaxPaisa  - legacyResult.inputTaxPaisa;

        return {
          reconciled:       outputDiff === 0 && inputDiff === 0,
          glOutputPaisa:    glResult.outputTaxPaisa,
          legacyOutputPaisa: legacyResult.outputTaxPaisa,
          outputDiffPaisa:  outputDiff,
          glInputPaisa:     glResult.inputTaxPaisa,
          legacyInputPaisa: legacyResult.inputTaxPaisa,
          inputDiffPaisa:   inputDiff
        };
      }, { reconciled: false, error: 'RECONCILE_EXCEPTION' });
    },

    exportForFiling: function (fromYYYYMM, toYYYYMM) {
      return _try(function () {
        var summaries = ERP.GSTEngine.getYearlySummary(fromYYYYMM, toYYYYMM)
          .filter(function (s) { return s.seenSaleJournals > 0 || s.seenPurchJournals > 0; });

        if (summaries.length === 0) return { ok: false, error: 'NO_DATA' };

        var dateStr = _try(function () {
          if (ERP.DateUtils && typeof ERP.DateUtils.today === 'function') {
            var d = ERP.DateUtils.today();
            if (d instanceof Date) {
              return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            }
            if (typeof d === 'string') return d;
          }
          var _d = new Date();
          return _d.getFullYear() + '-' + String(_d.getMonth() + 1).padStart(2, '0') + '-' + String(_d.getDate()).padStart(2, '0');
        }, (function () {
          var _d = new Date();
          return _d.getFullYear() + '-' + String(_d.getMonth() + 1).padStart(2, '0') + '-' + String(_d.getDate()).padStart(2, '0');
        }()));
        var baseName = 'mh-gst-' + fromYYYYMM + '-to-' + toYYYYMM + '-' + dateStr;

        var jsonOk = _download(JSON.stringify(summaries, null, 2), baseName + '.json', 'application/json');
        var csvOk  = _download(_toCSV(summaries), baseName + '.csv', 'text/csv');

        if (!jsonOk || !csvOk) {
          _logger().error('[ERP.GSTEngine] Export download failed for ' + baseName);
          return { ok: false, filename: baseName, periodsExported: 0, error: 'DOWNLOAD_FAILED' };
        }

        _logger().info('[ERP.GSTEngine] Exported ' + summaries.length + ' periods for filing.');
        return { ok: true, filename: baseName, periodsExported: summaries.length, error: null };
      }, { ok: false, error: 'EXPORT_EXCEPTION' });
    },

    listActivePeriods: function () {
      return _try(function () {
        var ACC = _accCore();
        if (!ACC || !ACC.AccountingState) return [];
        var journals = ACC.AccountingState.getAllJournals && ACC.AccountingState.getAllJournals();
        if (!Array.isArray(journals)) return [];
        var periods = {};
        journals.forEach(function (j) {
          if (!j || !j.date) return;
          var m = _toYYYYMM(j.date);
          if (m) periods[m] = true;
        });
        return Object.keys(periods).sort();
      }, []);
    }
  };

  ERP.__phase11_gst = true;

  _logger().info('[ERP.GSTEngine] Phase 11.11 loaded — v11.11.1');

}(window));
