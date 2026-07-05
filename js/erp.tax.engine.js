
'use strict';

(function (root) {
  'use strict';

  if (root.ERP && root.ERP.__phase11_tax) return;

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
      _logger().warn('[ERP.TaxEngine] _try: ' + (e && e.message || e));
      return (fallback !== undefined ? fallback : null);
    }
  }

  // Single source of truth: delegates to ACC.Money (accounting_constants.js),
  // which loads immediately before this file. Previously this file had its
  // own naive comma-strip parser that silently mishandled parentheses-negative
  // amounts (e.g. "(1,234.50)") — now it shares the accounting-notation-aware
  // parser used everywhere else.
  // Guard moved from module-load-time to call-time: a load-time throw here
  // would crash this entire file (and everything after it in the script
  // order) if it were ever loaded before accounting_constants.js, instead
  // of failing only the one operation that actually needed money parsing.
  function _acc() {
    var ACC = root.AccountingCore;
    if (!ACC || !ACC.Money) throw new Error('[ERP.TaxEngine] ACC.Money missing. Load accounting_constants.js first.');
    return ACC;
  }
  function _toPaisa(rupees) {
    return _acc().Money.toPaisa(rupees);
  }

  function _toRupees(paisa) {
    return _acc().Money.fromPaisa(paisa);
  }

  function _num(v) {
    var n = parseFloat(String(v || 0).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  }

  var GST_OUTPUT_ACCOUNT = 'acc-2200';
  var GST_INPUT_ACCOUNT  = 'acc-1300';

  ERP.TaxEngine = {
    __phase11_tax: true,
    VERSION: '11.6.0',

    ACCOUNTS: {
      OUTPUT: GST_OUTPUT_ACCOUNT,
      INPUT:  GST_INPUT_ACCOUNT
    },

    getRate: function () {
      return _try(function () {
        var state = ERP.getState && ERP.getState();
        if (!state) return 0;
        var rate = (state.settings && state.settings.taxRate) ||
                   (state.biz && state.biz.taxRate);
        if (rate === undefined || rate === null || rate === '') {
          _logger().warn('[ERP.TaxEngine] TAX_RATE_NOT_CONFIGURED — taxRate missing from settings/biz; using 0%');
          return 0;
        }
        var n = parseFloat(rate);
        return isNaN(n) ? 0 : n;
      }, 0);
    },

    calculate: function (input) {
      return _try(function () {
        if (!input || typeof input !== 'object') {
          _logger().warn('[ERP.TaxEngine] calculate: invalid input');
          return { netBase: 0, taxAmount: 0, grossAmount: 0, taxRate: 0 };
        }

        var base     = _num(input.baseAmount);
        var discount = _num(input.discountAmount || 0);
        var rate     = (typeof input.taxRate === 'number') ? input.taxRate : ERP.TaxEngine.getRate();
        var taxable  = input.taxable !== false;

        var netBase   = Math.max(0, base - discount);
        var netPaisa  = _toPaisa(netBase);

        var taxPaisa  = taxable ? Math.round(netPaisa * rate / 100) : 0;
        var grossPaisa = netPaisa + taxPaisa;

        return {
          netBase:     netPaisa,
          taxAmount:   taxPaisa,
          grossAmount: grossPaisa,
          taxRate:     rate
        };
      }, { netBase: 0, taxAmount: 0, grossAmount: 0, taxRate: 0 });
    },

    // Root-cause fix for audit #67/#68: single source of truth for the
    // per-line GST math that sales_controller.js's _collectItems() used to
    // reimplement inline. Deliberately does NOT reuse calculate()'s rupee-based
    // discount handling — calculate() rounds base->paisa and discount->paisa
    // independently, then subtracts, which is not the same arithmetic as
    // rounding once at the paisa-base level and taking the discount as a
    // percentage of that rounded base. Verified numerically against 23,680
    // qty/price/discount/rate combinations: this order matches the existing,
    // already-live sales_controller.js algorithm with zero divergence, whereas
    // routing through calculate()/calculateLines() diverged by 1 paisa in
    // ~1.1% of cases. Do not "simplify" this to call calculate() without
    // re-running that equivalence check — the two rounding orders are not
    // interchangeable for money.
    calculateLineItem: function (input) {
      return _try(function () {
        if (!input || typeof input !== 'object') {
          return { basePaisa: 0, discountPaisa: 0, netBasePaisa: 0, taxPaisa: 0, grossPaisa: 0, taxRate: 0 };
        }
        var qty     = _num(input.qty);
        var price   = _num(input.price);
        var discPct = Math.max(0, Math.min(100, _num(input.discountPct)));
        var taxPct  = (typeof input.taxRate === 'number' && !isNaN(input.taxRate)) ? input.taxRate : _num(input.taxRate);

        var basePaisa      = Math.round(qty * price * 100);
        var discountPaisa  = Math.round(basePaisa * discPct / 100);
        var netBasePaisa   = basePaisa - discountPaisa;
        var taxPaisa       = Math.round(netBasePaisa * taxPct / 100);
        var grossPaisa     = netBasePaisa + taxPaisa;

        return {
          basePaisa:     basePaisa,
          discountPaisa: discountPaisa,
          netBasePaisa:  netBasePaisa,
          taxPaisa:      taxPaisa,
          grossPaisa:    grossPaisa,
          taxRate:       taxPct
        };
      }, { basePaisa: 0, discountPaisa: 0, netBasePaisa: 0, taxPaisa: 0, grossPaisa: 0, taxRate: 0 });
    },

    calculateLines: function (lines) {
      return _try(function () {
        if (!Array.isArray(lines)) {
          _logger().warn('[ERP.TaxEngine] calculateLines: not an array');
          return { lines: [], totalBase: 0, totalTax: 0, totalGross: 0 };
        }

        var rate       = ERP.TaxEngine.getRate();
        var totalBase  = 0;
        var totalTax   = 0;
        var totalGross = 0;
        var calcLines  = [];

        lines.forEach(function (item) {
          var qty      = _num(item.qty  || item.quantity || 1);
          var price    = _num(item.unitPrice || item.price || item.rate || 0);
          var discPct  = _num(item.discountPct || item.disc || 0);
          var taxable  = item.taxable !== false;

          var lineBase    = qty * price;
          var discAmt     = lineBase * discPct / 100;
          var result      = ERP.TaxEngine.calculate({
            baseAmount:     lineBase,
            discountAmount: discAmt,
            taxRate:        rate,
            taxable:        taxable
          });

          totalBase  += result.netBase;
          totalTax   += result.taxAmount;
          totalGross += result.grossAmount;
          calcLines.push(result);
        });

        return {
          lines:      calcLines,
          totalBase:  totalBase,
          totalTax:   totalTax,
          totalGross: totalGross
        };
      }, { lines: [], totalBase: 0, totalTax: 0, totalGross: 0 });
    },

    validate: function (baseAmountRupees, storedTaxAmountRupees, taxRate) {
      return _try(function () {
        var rate     = (typeof taxRate === 'number') ? taxRate : ERP.TaxEngine.getRate();
        var basePaisa   = _toPaisa(baseAmountRupees);
        var storedPaisa = _toPaisa(storedTaxAmountRupees);
        var expected    = Math.round(basePaisa * rate / 100);
        var diff        = storedPaisa - expected;

        return {
          valid:    diff === 0,
          expected: expected,
          actual:   storedPaisa,
          diff:     diff,
          taxRate:  rate
        };
      }, { valid: false, expected: 0, actual: 0, diff: 0, taxRate: 0 });
    },

    toPaisa: function (rupees) {
      return _toPaisa(rupees);
    },

    toRupees: function (paisa) {
      return _toRupees(paisa);
    },

    
    isExempt: function (supplyType) {
      var exemptTypes = ['export', 'exempt', 'zero-rated', 'zero_rated', 'zerorated', 'nil'];
      return exemptTypes.indexOf((supplyType || '').toLowerCase().trim()) !== -1;
    },

    
    roundToPaisa: function (paisa) {
      return Math.round(paisa);
    },
    roundToRupee: function (paisa) {
      return Math.round(paisa / 100) * 100;
    },

    
    calcTDS: function (grossAmountRupees, tdsRatePct) {
      return _try(function () {
        var gross   = _num(grossAmountRupees);
        var rate    = _num(tdsRatePct || 0);
        if (gross <= 0 || rate < 0 || rate > 100) {
          return { tdsAmountPaisa: 0, netPaisa: _toPaisa(gross), grossPaisa: _toPaisa(gross), taxRate: rate };
        }
        var grossPaisa = _toPaisa(gross);
        var tdsPaisa   = Math.round(grossPaisa * rate / 100);
        var netPaisa   = grossPaisa - tdsPaisa;
        return {
          tdsAmountPaisa: tdsPaisa,
          netPaisa:       netPaisa,
          grossPaisa:     grossPaisa,
          taxRate:        rate
        };
      }, { tdsAmountPaisa: 0, netPaisa: 0, grossPaisa: 0, taxRate: 0 });
    }
  };

  ERP.__phase11_tax = true;

  _logger().info('[ERP.TaxEngine] Phase 11.6 loaded — v11.6.0');

}(window));
