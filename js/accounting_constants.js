'use strict';

(function (root) {

  root.AccountingCore = root.AccountingCore || {};
  const ACC = root.AccountingCore;

  ACC.SCHEMA_VERSION = '1.0.0';

  ACC.PERIOD_STATUS = Object.freeze({
    OPEN:   'open',
    CLOSED: 'closed',
  });

  ACC.SOURCE_MODULE = Object.freeze({
    BANKING:  'banking',
    LOANS:    'loans',
    EXPENSES: 'expenses',
    SALES:    'sales',
    PURCHASE: 'purchase',
    MANUAL:   'manual',
  });

  ACC.IDB_STORES = Object.freeze({
    JOURNALS:          'acc_journals',
    LEDGER:            'acc_ledger',
    LOANS:             'acc_loans',
    BANK_ACCOUNTS:     'acc_bankAccounts',
    BANK_TRANSACTIONS: 'acc_bankTransactions',
    AUDIT_LOG:         'acc_auditLog',
    PERIODS:           'acc_periods',
    COA:               'acc_coa',
    EXPENSES:          'acc_expenses',
    WAL_ENTRIES:       'walEntries',
    WAL_ARCHIVE:       'walArchive',
    REVERSAL_INDEX:    'reversalIndex',
  });

  ACC.ACCOUNTING_EVENTS = Object.freeze({
    LOAN_CREATED:          'accounting:loan:created',
    LOAN_PAYMENT_POSTED:   'accounting:loan:payment_posted',
    LOAN_CLOSED:           'accounting:loan:closed',
    BANK_ACCOUNT_CREATED:  'accounting:bank:account_created',
    BANK_TRANSACTION_POSTED:  'accounting:bank:tx_posted',
    BANK_TRANSACTION_REVERSED: 'accounting:bank:tx_reversed',
    BANK_RECONCILED:       'accounting:bank:reconciled',
    JOURNAL_POSTED:        'accounting:journal:posted',
    JOURNAL_REVERSED:      'accounting:journal:reversed',
    SALE_POSTED:           'accounting:sale:posted',
    PURCHASE_POSTED:       'accounting:purchase:posted',
  });

  ACC.SYSTEM_ACCOUNTS = Object.freeze({
    CASH:         'acc-1001',
    BANK:         'acc-1002',
    AR:           'acc-1100',
    EQUITY:       'acc-3001',
    OPENING_BALANCE_EQUITY: 'acc-3900',
    SALES_REV:    'acc-4001',
    BANK_LOANS:   'acc-2100',
    LOAN_INT:     'acc-5300',
    ADMIN:        'acc-5200',
    BANK_CHARGES: 'acc-5400',
    SALARY:       'acc-5201',
    WARRANTY_EXP: 'acc-5500',
    GST_PAYABLE:      'acc-2200',
    GST_RECEIVABLE:   'acc-1300',
    PURCHASE_EXP:     'acc-5101',
    AP:               'acc-2001',
    SUNDRY_CREDITORS: 'acc-2002',
    SUNDRY_DEBTORS:   'acc-1101',
    TDS_PAYABLE:      'acc-2300',
    TDS_RECEIVABLE:   'acc-1400',
    SALES_DISC:       'acc-4003',
    SALES_RETURNS:    'acc-4004',
    CUST_ADVANCES:    'acc-2050',
    INVENTORY:           'acc-1200',
    INVENTORY_WRITEOFF:  'acc-5102',
    COGS:                'acc-5100',
    STOCK_SURPLUS:       'acc-3003',
  });

  function deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    Object.freeze(obj);
    Object.keys(obj).forEach(function (key) {
      deepFreeze(obj[key]);
    });
    return obj;
  }

  ACC.TAX_RATES = deepFreeze([
    { rate: 0,  label: 'Exempt (0%)',      hsn: 'Various',  description: 'Tax-exempt items (exports, basic foods)' },
    { rate: 5,  label: '5% GST',           hsn: 'Ch 1-24',  description: 'Essential goods, agriculture' },
    { rate: 10, label: '10% GST',          hsn: 'Various',  description: 'Selected goods' },
    { rate: 17, label: '17% Standard GST', hsn: 'Various',  description: 'Standard rate — most goods & services (FBR)' },
    { rate: 18, label: '18% GST',          hsn: 'Various',  description: 'Selected luxury/special items' },
    { rate: 25, label: '25% GST',          hsn: 'Ch 87',    description: 'Motor vehicles, luxury items' },
  ]);

  ACC.DEFAULT_COA = deepFreeze([
    { id:'acc-1001', code:'1-1001', name:'Cash in Hand',       group:'Assets',      type:'asset',   parentId:null, isSystem:true },
    { id:'acc-1002', code:'1-1002', name:'Bank Account',       group:'Assets',      type:'asset',   parentId:null, isSystem:true },
    { id:'acc-1100', code:'1-1100', name:'Accounts Receivable',group:'Assets',      type:'asset',   parentId:null, isSystem:true },
    { id:'acc-1101', code:'1-1101', name:'Sundry Debtors',     group:'Assets',      type:'asset',   parentId:null, isSystem:true },
    { id:'acc-1200', code:'1-1200', name:'Inventory Asset',    group:'Assets',      type:'asset',   parentId:null, isSystem:true },

    { id:'acc-1300', code:'1-1300', name:'GST / Input Tax Receivable', group:'Assets', type:'asset', parentId:null, isSystem:true },
    { id:'acc-1400', code:'1-1400', name:'TDS / WHT Receivable', group:'Assets',    type:'asset',   parentId:null, isSystem:true },

    { id:'acc-2001', code:'2-2001', name:'Accounts Payable',   group:'Liabilities', type:'liability',parentId:null, isSystem:true },
    { id:'acc-2002', code:'2-2002', name:'Sundry Creditors',   group:'Liabilities', type:'liability',parentId:null, isSystem:true },
    { id:'acc-2050', code:'2-2050', name:'Customer Advances',  group:'Liabilities', type:'liability',parentId:null, isSystem:true },
    { id:'acc-2100', code:'2-2100', name:'Bank Loans Payable', group:'Liabilities', type:'liability',parentId:null, isSystem:true },
    { id:'acc-2200', code:'2-2200', name:'GST / Output Tax Payable', group:'Liabilities', type:'liability',parentId:null, isSystem:true },
    { id:'acc-2300', code:'2-2300', name:'TDS / WHT Payable',  group:'Liabilities', type:'liability',parentId:null, isSystem:true },

    { id:'acc-3001', code:'3-3001', name:'Owner Equity',       group:'Equity',      type:'equity',  parentId:null, isSystem:true },
    { id:'acc-3002', code:'3-3002', name:'Retained Earnings',  group:'Equity',      type:'equity',  parentId:null, isSystem:true },
    { id:'acc-3003', code:'3-3003', name:'Stock Surplus Reserve', group:'Equity',   type:'equity',  parentId:null, isSystem:true },
    { id:'acc-3900', code:'3-3900', name:'Opening Balance Equity Reserve', group:'Equity', type:'equity', parentId:null, isSystem:true },

    { id:'acc-4001', code:'4-4001', name:'Sales Revenue',      group:'Revenue',     type:'revenue', parentId:null, isSystem:true },
    { id:'acc-4002', code:'4-4002', name:'Service Revenue',    group:'Revenue',     type:'revenue', parentId:null, isSystem:true },
    { id:'acc-4003', code:'4-4003', name:'Sales Discount',     group:'Revenue',     type:'revenue', parentId:null, isSystem:true },
    { id:'acc-4004', code:'4-4004', name:'Sales Returns & Allowances', group:'Revenue', type:'contra-revenue', parentId:null, isSystem:true },

    { id:'acc-5100', code:'5-5100', name:'Cost of Goods Sold', group:'Expenses',    type:'expense', parentId:null, isSystem:true },
    { id:'acc-5101', code:'5-5101', name:'Purchase Expense',   group:'Expenses',    type:'expense', parentId:null, isSystem:true },
    { id:'acc-5102', code:'5-5102', name:'Inventory Write-off', group:'Expenses',   type:'expense', parentId:null, isSystem:true },
    { id:'acc-5200', code:'5-5200', name:'Admin Expenses',     group:'Expenses',    type:'expense', parentId:null, isSystem:true },
    { id:'acc-5300', code:'5-5300', name:'Loan Interest Expense', group:'Expenses', type:'expense', parentId:null, isSystem:true },
    { id:'acc-5400', code:'5-5400', name:'Bank Charges',       group:'Expenses',    type:'expense', parentId:null, isSystem:true },

    { id:'acc-5201', code:'5-5201', name:'Salaries & Wages',    group:'Expenses',    type:'expense', parentId:null, isSystem:true },
    { id:'acc-5500', code:'5-5500', name:'Warranty Expense',    group:'Expenses',    type:'expense', parentId:null, isSystem:true },
  ]);

  ACC.configure = function (overrides) {
    if (!overrides || typeof overrides !== 'object') return;

    if (overrides.SYSTEM_ACCOUNTS && typeof overrides.SYSTEM_ACCOUNTS === 'object') {
      ACC.SYSTEM_ACCOUNTS = Object.freeze(
        Object.assign({}, ACC.SYSTEM_ACCOUNTS, overrides.SYSTEM_ACCOUNTS)
      );
    }

    if (Array.isArray(overrides.TAX_RATES)) {
      overrides.TAX_RATES.forEach(function (t) {
        if (!t || typeof t.rate !== 'number' || !t.label) {
          throw new Error('[AccountingConstants] TAX_RATES override entries require rate and label');
        }
      });
      ACC.TAX_RATES = deepFreeze(overrides.TAX_RATES.slice());
    }

    if (Array.isArray(overrides.DEFAULT_COA)) {
      var merged = {};
      ACC.DEFAULT_COA.forEach(function (a) { merged[a.id] = a; });
      overrides.DEFAULT_COA.forEach(function (a) {
        if (!a || !a.id || !a.code) {
          throw new Error('[AccountingConstants] DEFAULT_COA override entries require id and code');
        }
        merged[a.id] = a;
      });
      ACC.DEFAULT_COA = deepFreeze(Object.keys(merged).map(function (k) { return merged[k]; }));
    }
  };

  ACC.Money = Object.freeze({

    // Single source of truth for rupees-string -> integer-paisa conversion.
    // Accounting-notation aware: handles "(1,234.50)" and trailing/leading
    // minus signs as negative amounts, and strips currency letters/symbols
    // (e.g. "Rs. 1,234.50"). Previously 5 different modules each had their
    // own partial version of this parser and disagreed on negative-amount
    // handling, which could silently turn a negative amount into 0.
    toPaisa: function (rupees) {
      if (rupees === null || rupees === undefined || rupees === '') return 0;
      var raw = String(rupees).trim();

      var isParenNegative = /^\(.*\)$/.test(raw);
      if (isParenNegative) raw = raw.slice(1, -1).trim();

      // Strip currency letters/symbols (e.g. "Rs.", "PKR") but keep digits,
      // separators, and any leading/trailing sign.
      raw = raw.replace(/[A-Za-z]+\.?\s*/g, '');

      var isLeadingNegative  = /^-/.test(raw);
      var isTrailingNegative = /-\s*$/.test(raw);
      var isNegative = isParenNegative || isLeadingNegative || isTrailingNegative;

      var digitsOnly = raw.replace(/,/g, '').replace(/[^0-9.]/g, '');
      var firstDot = digitsOnly.indexOf('.');
      if (firstDot !== -1) {
        digitsOnly = digitsOnly.slice(0, firstDot + 1) + digitsOnly.slice(firstDot + 1).replace(/\./g, '');
      }

      var n = parseFloat(digitsOnly);
      if (isNaN(n) || !isFinite(n)) return 0;
      if (isNegative) n = -Math.abs(n);
      return Math.round(n * 100);
    },

    // Single source of truth for integer-paisa -> rupees-float conversion
    // (the inverse of toPaisa). Modules previously each had their own
    // "_fromPaisa" / "_toRs" / "_toRupees" copy of this one-liner.
    fromPaisa: function (paisa) {
      var n = Number(paisa);
      if (isNaN(n) || !isFinite(n)) return 0;
      return Math.round(n) / 100;
    },

    toDisplay: function (paisa) {
      if (!Number.isFinite(paisa)) return 'Rs.0.00';
      var rupees = paisa / 100;
      try {
        return 'Rs.' + rupees.toLocaleString('en-PK', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
      } catch (e) {
        return 'Rs.' + rupees.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      }
    },

    add: function (a, b) { return (Number(a) || 0) + (Number(b) || 0); },

    subtract: function (a, b) { return (Number(a) || 0) - (Number(b) || 0); },

    sum: function (arr) {
      return (arr || []).reduce(function (s, v) { return s + (Number(v) || 0); }, 0);
    },

    _assertPaisa: function (v) {
      if (!Number.isInteger(v)) {
        throw new Error('[Money] Expected integer paisa, got: ' + v +
          '. Use Money.toPaisa() to convert rupees.');
      }
    },
  });

})(typeof window !== 'undefined' && window !== null ? window : globalThis);
