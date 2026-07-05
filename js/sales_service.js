'use strict';

(function (ERP) {

  // Single source of truth: all error classes come from the canonical,
  // frozen ERP.errors registry defined in core.js. Do not redefine them here —
  // local copies previously drifted from the registry (different stack-capture
  // behavior) even though core.js loads before this file in index.html.
  if (!ERP.errors) throw new Error('[SalesService] ERP.errors missing. Load core.js first.');
  var ValidationError         = ERP.errors.ValidationError;
  var ConcurrencyError        = ERP.errors.ConcurrencyError;
  var InsufficientStockError  = ERP.errors.InsufficientStockError;
  var PermissionError         = ERP.errors.PermissionError;

  // Thin wrapper kept for call-site compatibility; delegates enrichment
  // to the canonical ERP.mkError so metadata format never diverges.
  function _mkError(Cls, msg, module, operation, documentId, txId) {
    return ERP.mkError(Cls, msg, module, operation, documentId, txId);
  }

  var State   = function(){ return ERP._salesState;   };
  var Storage = function(){ return ERP._salesStorage; };
  var _ok     = function(d,m){ return ERP._salesOk(d,m);   };
  var _fail   = function(e,m){ return ERP._salesFail(e,m); };

  function _gs()    { return ERP._internal.getState(); }
  function _st(fn,tag){ return ERP._internal.setState(fn,tag); }

  function _now()   { return (ERP.DateUtils && typeof ERP.DateUtils.now === 'function') ? ERP.DateUtils.now() : (function(){ var d=new Date(); var p=function(n){ return String(n).padStart(2,'0'); }; return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds()); }()); }
  function _today() { return ERP.DateUtils ? ERP.DateUtils.today() : (function(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }()); }

  function _snapshot(key){
    return _deepClone(_gs().data[key] || []);
  }

  function _deepClone(val){
    try{ return JSON.parse(JSON.stringify(val)); }
    catch(e){
      if(typeof structuredClone === 'function'){
        try{ return structuredClone(val); }catch(e2){ if(window.DEBUG_MODE) console.error('[deepClone] structuredClone failed', e2); }
      }
      if(window.DEBUG_MODE) console.error('[deepClone] failed, returning empty fallback', e);
      return Array.isArray(val) ? [] : {};
    }
  }

  function _money(n){
    var v = typeof n === 'number' ? n : parseFloat(n);
    if(isNaN(v)) return 0;
    return Math.round((v + Number.EPSILON) * 100) / 100;
  }

  function _persist(key, preSnapshot){
    var _currentData = _gs().data[key];
    return Storage().save(key, _currentData)
      .then(function(res){
        var ok = !res || res.success !== false;
        if(!ok && preSnapshot !== undefined && preSnapshot !== null){
          try{ _st(function(s){ s.data[key] = preSnapshot; }, 'persist:rollback:' + key); }
          catch(re){ if(window.DEBUG_MODE) console.error(re); }
        }
        return res || { success: true };
      })
      .catch(function(e){
        if(window.DEBUG_MODE) console.error('[_persist]', key, e);
        if(preSnapshot !== undefined && preSnapshot !== null){
          try{ _st(function(s){ s.data[key] = preSnapshot; }, 'persist:rollback:' + key); }
          catch(re){ if(window.DEBUG_MODE) console.error(re); }
        }
        return { success:false, error: (e && e.message) || ('persist threw for store: ' + key) };
      });
  }

  var _idInFlight = {};
  function _nextId(arr, pfx){
    var mx = 0;
    (arr || []).forEach(function(r){
      var m = String(r.id || '').match(/(\d+)$/);
      if(m) mx = Math.max(mx, parseInt(m[1], 10));
    });
    var now = Date.now();
    Object.keys(_idInFlight).forEach(function(k){
      if(now - _idInFlight[k] > 30000){ delete _idInFlight[k]; return; }
      if(k.indexOf(pfx) === 0){ var m = k.match(/(\d+)$/); if(m) mx = Math.max(mx, parseInt(m[1], 10)); }
    });
    var id = pfx + String(mx + 1).padStart(3, '0');
    while(
      (arr || []).some(function(r){ return r.id === id; }) ||
      _idInFlight[id]
    ) {
      mx++;
      id = pfx + String(mx + 1).padStart(3, '0');
    }
    _idInFlight[id] = now;
    return id;
  }

  function _invPrefix() {
    try { var s = (_gs().settings) || {}; return (s.invoicePrefix || 'INV') + '-'; } catch(e) { return 'INV-'; }
  }
  function _jobInvPrefix() {
    try { var s = (_gs().settings) || {}; return (s.jobPrefix || 'JOB') + '-'; } catch(e) { return 'JOB-'; }
  }

  function _requireTx(tx, module, operation) {
    if (!tx || !tx.txId || !tx.actor) {
      throw _mkError(ValidationError, 'Transaction context (tx) required', module, operation, null, null);
    }
  }

  function _requireAdmin(tx, operation) {
    if (!ERP.Auth || !ERP.Auth.isAdmin(tx.actor)) {
      throw _mkError(PermissionError, 'Admin role required for: ' + operation,
        'PermissionGuard', operation, tx.documentId, tx.txId);
    }
  }

  function _audit(tx, action, module, before, after, severity) {
    try {
      ERP.AuditLog && ERP.AuditLog.write({
        id:         ERP.uid ? ERP.uid() : (_now() + Math.random()),
        txId:       tx.txId,
        actor:      tx.actor,
        action:     action,
        module:     module,
        documentId: tx.documentId,
        before:     before || null,
        after:      after  || null,
        timestamp:  _now(),
        severity:   severity || 'info'
      });
    } catch(e){ if(window.DEBUG_MODE) console.error(e); }
  }

  var _erp_channel = null;
  try { _erp_channel = new BroadcastChannel('erp-sync'); } catch(e){ if(window.DEBUG_MODE) console.error(e); }
  function _broadcast(storeName, documentId, version) {
    try {
      if (_erp_channel) _erp_channel.postMessage({ type:'committed', store:storeName, documentId:documentId, _v:version });
    } catch(e){ if(window.DEBUG_MODE) console.error(e); }
  }

  function _totals(items){
    var sP=0, dP=0, tP=0;
    (items || []).forEach(function(i){
      var q    = (typeof i.q      === 'number' && !isNaN(i.q))      ? i.q    : 0;
      var p    = (typeof i.p      === 'number' && !isNaN(i.p))      ? i.p    : 0;
      var disc = (typeof i.d      === 'number' && !isNaN(i.d))      ? i.d    : 0;
      var tax  = (typeof i.taxAmt === 'number' && !isNaN(i.taxAmt)) ? i.taxAmt : 0;
      sP += Math.round(q * p    * 100);
      dP += Math.round(disc     * 100);
      tP += Math.round(tax      * 100);
    });
    var grandP   = sP - dP + tP;
    var grand    = grandP / 100;
    return Object.freeze({ sub: sP/100, disc: dP/100, tax: tP/100, grand: grand, grandPaisa: grandP, isCredit: grand < 0 });
  }

  // FIX (root cause, not a patch): buildEstimate() and delivery-challan capture never
  // collect a per-line tax rate in the UI (estimates/challans are quotes/delivery notes,
  // not tax documents), so their items are built with taxAmt:0. That's fine for the
  // estimate/challan itself, but convertToInvoice() for both was carrying that taxAmt:0
  // straight through onto a REAL invoice -- meaning any invoice created via either
  // conversion flow charged zero GST regardless of the item's actual rate. This applies
  // the business's configured default rate (the same ERP.TaxEngine.getRate() every other
  // GST-aware code path uses) through the same paisa-rounded calculateLineItem() math as
  // a normal point-of-sale invoice line, so a converted invoice's tax matches what a
  // manually-entered one would produce. Fails closed (returns null) if TaxEngine isn't
  // loaded, rather than silently shipping another zero-tax invoice.
  function _applyDefaultTaxToItems(items){
    if (!ERP.TaxEngine || typeof ERP.TaxEngine.calculateLineItem !== 'function' || typeof ERP.TaxEngine.getRate !== 'function') {
      return null;
    }
    var rate = ERP.TaxEngine.getRate();
    return (items || []).map(function(i){
      var qty   = typeof i.q === 'number' ? i.q : (parseFloat(i.q) || 1);
      var price = parseFloat(i.p) || 0;
      var basePaisa = Math.round(qty * price * 100);
      var existingDiscPaisa = Math.round((parseFloat(i.d) || 0) * 100);
      var discPct = (basePaisa > 0 && existingDiscPaisa > 0) ? (existingDiscPaisa / basePaisa * 100) : 0;
      var calc = ERP.TaxEngine.calculateLineItem({ qty: qty, price: price, discountPct: discPct, taxRate: rate });
      return Object.assign({}, i, {
        d:      calc.discountPaisa / 100,
        tax:    rate,
        taxPct: rate,
        taxAmt: calc.taxPaisa / 100,
        taxableAmount: calc.netBasePaisa / 100
      });
    });
  }

  function _checkStock(items, prevQtyMap){
    var parts, moduleAvailable = false;
    try { parts = State().getParts(); moduleAvailable = true; } catch(e){ if(window.DEBUG_MODE) console.error(e); }
    if (!moduleAvailable || !Array.isArray(parts)) return { bypass: true, reason: 'module_unavailable', errors: [] };
    if (parts.length === 0) return { bypass: true, reason: 'empty_inventory', errors: [] };
    var errors = [];
    (items || []).forEach(function(item){
      var qVal = parseFloat(item.q || item.qty || 0);
      if (isNaN(qVal) || qVal < 0) {
        errors.push(Object.assign(
          _mkError(ValidationError, 'Invalid quantity for item: ' + (item.n || item.name || 'unnamed'),
            'InventoryService', 'validate', null, null),
          { barcode: item.barcode || item.sku || item.n, need: item.q, have: 0 }
        ));
        return;
      }
      var bc = (item.barcode || item.sku || item.n || '').toLowerCase();
      var part = parts.find(function(p){ return (p.barcode||p.sku||p.n||'').toLowerCase() === bc; });
      if(!part) return;
      var isService = part.type==='service' || part.isService===true || part.stockable===false || part.trackStock===false || part.inventoryTracked===false;
      if(isService) return;
      var available;
      if (ERP.InventoryService && typeof ERP.InventoryService.getBalance === 'function') {
        available = ERP.InventoryService.getBalance(part.bc || part.barcode || part.sku || bc);
      } else {
        available = part.st || part.stock || part.quantity || part.qty || part.currentStock || 0;
      }
      var prevQty   = (prevQtyMap || {})[bc] || 0;
      var netNeed   = qVal - prevQty;
      if(netNeed > available)
        errors.push(Object.assign(
          _mkError(InsufficientStockError, 'Insufficient stock for barcode: ' + (item.barcode || item.n || bc),
            'InventoryService', 'deduct', null, null),
          { barcode: item.barcode || item.sku || item.n, need: netNeed, have: available }
        ));
    });
    return { bypass: false, errors: errors };
  }

  function _resolveStockEntryCost(item, bc, matchedPart){
    if(item.unitCostPaisa !== undefined && item.unitCostPaisa !== null && !isNaN(item.unitCostPaisa))
      return Math.round(item.unitCostPaisa);
    var svc = ERP.InventoryService;
    if(bc && svc && typeof svc.getAvgCost === 'function'){
      var avg = svc.getAvgCost(bc);
      if(avg > 0) return Math.round(avg * 100);
    }
    if(matchedPart){
      var fallback = parseFloat(matchedPart.pp) || 0;
      if(fallback > 0) return Math.round(fallback * 100);
    }
    return 0;
  }

  function _resolveStockEntries(items, opts){
    opts = opts || {};
    var invParts = opts.parts || (State().getParts ? State().getParts() : []);
    return (items || []).map(function(item){
      var bc = (item.barcode || item.sku || item.bc || '').trim();
      var matched = null;
      if(bc){
        matched = invParts.find(function(p){ return !p._archived && (p.bc || p.barcode) === bc; });
      } else if(item.n || item.name){
        var nm = (item.n || item.name || '').toLowerCase();
        matched = invParts.find(function(p){ return !p._archived && (p.n || '').toLowerCase() === nm; });
        if(matched) bc = matched.bc || matched.barcode || '';
      }
      return {
        barcode: bc,
        sku: item.n || item.name || '',
        n: item.n || item.name || '',
        qty: item.q || item.qty || 0,
        q: item.q || item.qty || 0,
        unitCostPaisa: _resolveStockEntryCost(item, bc, matched)
      };
    }).filter(function(entry){ return !!entry.barcode && entry.qty > 0; });
  }

  function _runStockMutation(method, items, meta){
    var entries = _resolveStockEntries(items);
    return Promise.resolve().then(function(){
      if(!entries.length) return _ok(null, { skipped: true, reason: 'no_trackable_items' });
      if(!(ERP.InventoryService && typeof ERP.InventoryService[method] === 'function'))
        return _fail('No inventory backend');
      return Promise.resolve(ERP.InventoryService[method](entries, meta)).then(
        function(res){
          if(res && res.ok === false)      return _fail(res.error || (method + ' failed'));
          if(res && res.success === false) return _fail(res.error || (method + ' failed'));
          return _ok(res);
        },
        function(e){ return _fail(e); }
      );
    }).catch(function(e){ return _fail(e); });
  }

  var InventorySvc = {
    resolveEntries: _resolveStockEntries,
    deduct:  function(items, meta){ return _runStockMutation('deduct',  items, meta); },
    restore: function(items, meta){ return _runStockMutation('restore', items, meta); }
  };

  function _numWordsInt(n){
    n = Math.floor(n || 0);
    if(!isFinite(n) || n < 0) return '';
    if(n === 0) return 'Zero';
    var ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
                'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen',
                'Seventeen','Eighteen','Nineteen'];
    var tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
    if(n < 20)         return ones[n];
    if(n < 100)        return tens[Math.floor(n/10)] + (n%10 ? ' ' + ones[n%10] : '');
    if(n < 1000)       return ones[Math.floor(n/100)] + ' Hundred' + (_numWordsInt(n%100) ? ' ' + _numWordsInt(n%100) : '');
    if(n < 100000)     return _numWordsInt(Math.floor(n/1000)) + ' Thousand' + (_numWordsInt(n%1000) ? ' ' + _numWordsInt(n%1000) : '');
    if(n < 10000000)   return _numWordsInt(Math.floor(n/100000)) + ' Lakh' + (_numWordsInt(n%100000) ? ' ' + _numWordsInt(n%100000) : '');
    if(n < 1000000000) return _numWordsInt(Math.floor(n/10000000)) + ' Crore' + (_numWordsInt(n%10000000) ? ' ' + _numWordsInt(n%10000000) : '');
    if(n < 100000000000) return _numWordsInt(Math.floor(n/1000000000)) + ' Arab' + (_numWordsInt(n%1000000000) ? ' ' + _numWordsInt(n%1000000000) : '');
    return _numWordsInt(Math.floor(n/100000000000)) + ' Kharab' + (_numWordsInt(n%100000000000) ? ' ' + _numWordsInt(n%100000000000) : '');
  }
  function _numWords(n){
    n = n || 0;
    var isNeg = n < 0;
    n = Math.abs(n);
    var whole  = Math.floor(n);
    var paise  = Math.round((n - whole) * 100);
    var result = (isNeg ? 'Minus ' : '') + (_numWordsInt(whole) || 'Zero');
    if(paise > 0) result += ' and ' + _numWordsInt(paise) + ' Paise';
    return result;
  }

  var _Ledger = {
    _ledgerIdCounter: null,
    _nextLedgerId: function(entries) {
      if (this._ledgerIdCounter === null) {
        var mx = 0;
        (entries || []).forEach(function(e) {
          var m = String(e.id || '').match(/(\d+)$/);
          if(m) mx = Math.max(mx, parseInt(m[1], 10));
        });
        this._ledgerIdCounter = mx;
      }
      this._ledgerIdCounter++;
      return 'LE-' + String(this._ledgerIdCounter).padStart(3, '0');
    },

    _buildEntry: function(customerId, type, ref, debitRupees, creditRupees, runningBalRupees, date, note) {
      var entries = _gs().data.customerLedger || [];
      var debitP  = Math.round((debitRupees  || 0) * 100);
      var creditP = Math.round((creditRupees || 0) * 100);
      var balP    = Math.round((runningBalRupees || 0) * 100);
      return {
        id:         _Ledger._nextLedgerId(entries),
        customerId: customerId,
        type:       type,
        ref:        ref || '',
        debit:      debitP  / 100,
        credit:     creditP / 100,
        balance:    balP    / 100,
        date:       date || _today(),
        note:       note || '',
        createdAt:  _now()
      };
    },

    getForCustomer: function(customerId) {
      var all = _gs().data.customerLedger || [];
      return all.filter(function(e){ return e.customerId === String(customerId); })
        .slice()
        .sort(function(a, b){
          var ta = a.createdAt ? (Date.parse(a.createdAt) || 0) : (a.date ? (Date.parse(a.date) || 0) : 0);
          var tb = b.createdAt ? (Date.parse(b.createdAt) || 0) : (b.date ? (Date.parse(b.date) || 0) : 0);
          if (ta !== tb) return ta - tb;
          return (a.id||'') < (b.id||'') ? -1 : (a.id||'') > (b.id||'') ? 1 : 0;
        });
    },

    recalculate: function(customerId) {
      var entries = _Ledger.getForCustomer(customerId);
      var runningP = 0;
      var updatedIds = {};
      entries.forEach(function(e) {
        runningP += Math.round((e.debit  || 0) * 100);
        runningP -= Math.round((e.credit || 0) * 100);
        updatedIds[e.id] = runningP / 100;
      });
      _st(function(s){
        (s.data.customerLedger || []).forEach(function(e){
          if(e.customerId === String(customerId) && updatedIds.hasOwnProperty(e.id)){
            e.balance = updatedIds[e.id];
          }
        });
      }, 'ledger:recalculate:' + customerId);
      return _Ledger.getForCustomer(customerId);
    },

    getBalance: function(customerId, pendingEntries) {
      var entries = _Ledger.getForCustomer(customerId);
      if (Array.isArray(pendingEntries)) {
        pendingEntries.forEach(function(e) { if (e.customerId === String(customerId)) entries.push(e); });
      }
      if(!entries.length) return 0;
      var runningP = 0;
      entries.forEach(function(e){ runningP += Math.round((e.debit||0)*100); runningP -= Math.round((e.credit||0)*100); });
      return runningP / 100;
    },

    createInvoiceEntry: function(customerId, invoiceId, invoiceTotal, date, pendingEntries) {
      var currentP = Math.round(_Ledger.getBalance(customerId, pendingEntries) * 100);
      var debitP   = Math.round(Math.abs(invoiceTotal) * 100);
      var newBalP  = currentP + debitP;
      return _Ledger._buildEntry(customerId, 'INVOICE', invoiceId, debitP/100, 0, newBalP/100, date || _today(), 'Invoice ' + invoiceId);
    },

    createPaymentEntry: function(customerId, paymentId, amount, date, pendingEntries) {
      var currentP = Math.round(_Ledger.getBalance(customerId, pendingEntries) * 100);
      var creditP  = Math.round(Math.abs(amount) * 100);
      var newBalP  = currentP - creditP;
      return _Ledger._buildEntry(customerId, 'PAYMENT', paymentId, 0, creditP/100, newBalP/100, date || _today(), 'Payment ' + paymentId);
    },

    createVoidEntry: function(customerId, originalPaymentId, amount, date, pendingEntries) {
      var currentP = Math.round(_Ledger.getBalance(customerId, pendingEntries) * 100);
      var debitP   = Math.round(Math.abs(amount) * 100);
      var newBalP  = currentP + debitP;
      return _Ledger._buildEntry(customerId, 'PAYMENT_VOID', originalPaymentId, debitP/100, 0, newBalP/100, date || _today(), 'Void of ' + originalPaymentId);
    },

    createInvoiceVoidEntry: function(customerId, invoiceId, invoiceTotal, date, pendingEntries) {
      var currentP = Math.round(_Ledger.getBalance(customerId, pendingEntries) * 100);
      var creditP  = Math.round(Math.abs(invoiceTotal) * 100);
      var newBalP  = currentP - creditP;
      return _Ledger._buildEntry(customerId, 'INVOICE_VOID', invoiceId, 0, creditP/100, newBalP/100, date || _today(), 'Invoice Deleted ' + invoiceId);
    },

    createSaleReturnEntry: function(customerId, cnId, returnGrand, date, pendingEntries) {
      var currentP = Math.round(_Ledger.getBalance(customerId, pendingEntries) * 100);
      var creditP  = Math.round(Math.abs(returnGrand) * 100);
      var newBalP  = currentP - creditP;
      return _Ledger._buildEntry(customerId, 'CREDIT_NOTE', cnId, 0, creditP/100, newBalP/100, date || _today(), 'Sale Return / Credit Note ' + cnId);
    },

    createRefundEntry: function(customerId, refundId, amount, date, pendingEntries) {
      var currentP = Math.round(_Ledger.getBalance(customerId, pendingEntries) * 100);
      var creditP  = Math.round(Math.abs(amount) * 100);
      var newBalP  = currentP - creditP;
      return _Ledger._buildEntry(customerId, 'CUSTOMER_REFUND', refundId, 0, creditP/100, newBalP/100, date || _today(), 'Refund Paid ' + refundId);
    },

    createRefundVoidEntry: function(customerId, originalRefundId, amount, date, pendingEntries) {
      var currentP = Math.round(_Ledger.getBalance(customerId, pendingEntries) * 100);
      var debitP   = Math.round(Math.abs(amount) * 100);
      var newBalP  = currentP + debitP;
      return _Ledger._buildEntry(customerId, 'CUSTOMER_REFUND_VOID', originalRefundId, debitP/100, 0, newBalP/100, date || _today(), 'Refund Void ' + originalRefundId);
    },

    createPaymentVoidEntry: function(customerId, originalPaymentId, amount, date, pendingEntries) {
      var currentP = Math.round(_Ledger.getBalance(customerId, pendingEntries) * 100);
      var debitP   = Math.round(Math.abs(amount) * 100);
      var newBalP  = currentP + debitP;
      return _Ledger._buildEntry(customerId, 'PAYMENT_VOID', originalPaymentId, debitP/100, 0, newBalP/100, date || _today(), 'Payment Void ' + originalPaymentId);
    },

    createOpeningBalance: function(customerId, balance, date) {
      var balP    = Math.round((balance || 0) * 100);
      var debitP  = balP > 0 ? balP : 0;
      var creditP = balP < 0 ? Math.abs(balP) : 0;
      return _Ledger._buildEntry(customerId, 'OPENING_BALANCE', 'OB', debitP/100, creditP/100, balance || 0, date || _today(), 'Opening Balance');
    }
  };

  var _Allocator = {
    _allocIdCounter: null,
    _nextAllocId: function() {
      if (this._allocIdCounter === null) {
        var entries = _gs().data.paymentAllocations || [];
        var mx = 0;
        entries.forEach(function(e){ var m = String(e.id || '').match(/(\d+)$/); if(m) mx = Math.max(mx, parseInt(m[1], 10)); });
        this._allocIdCounter = mx;
      }
      this._allocIdCounter++;
      return 'PA-' + String(this._allocIdCounter).padStart(3, '0');
    },

    _calcStatus: function(totalPaisa, paidPaisa) {
      if(totalPaisa <= 0)              return 'paid';
      if(paidPaisa <= 0)               return 'unpaid';
      if(paidPaisa > totalPaisa + 1)   return 'overpaid';
      if(paidPaisa >= totalPaisa)      return 'paid';
      return 'partial';
    },

    getUnpaidInvoices: function(customerName) {
      var nm = (customerName || '').trim().toLowerCase();
      var allocs = _gs().data.paymentAllocations || [];
      var allPayIn = _gs().data.payIn || [];

      var voidedPayIds = {};
      allPayIn.forEach(function(pi){ if(pi.voided) voidedPayIds[pi.id] = true; });
      var paidPaisaById = {};
      allocs.forEach(function(a) {
        if (!a.invoiceId) return;
        if (voidedPayIds[a.paymentId] && !a._isReturnDeduction) return;
        paidPaisaById[a.invoiceId] = (paidPaisaById[a.invoiceId] || 0) + Math.round((a.amountAllocated || 0) * 100);
      });
      return (_gs().data.sales || [])
        .filter(function(inv){
          if (inv.deleted) return false;
          var invCust = (inv.customer || '').trim().toLowerCase();
          var invCustId = String(inv.customerId || '').toLowerCase();
          if (invCust !== nm && invCustId !== nm) return false;
          if (inv.status === 'returned' || inv.status === 'cancelled' || inv.status === 'voided') return false;
          var totalP = Math.round((inv.total || inv.grand || 0) * 100);
          var paidP  = paidPaisaById[inv.id] || 0;
          return paidP < totalP;
        })
        .slice()
        .sort(function(a, b){
          if((a.date||'') < (b.date||'')) return -1;
          if((a.date||'') > (b.date||'')) return 1;
          var na = parseInt((a.id || '').replace(/\D/g, ''), 10) || 0;
          var nb = parseInt((b.id || '').replace(/\D/g, ''), 10) || 0;
          return na - nb;
        });
    },

    allocateFIFO: function(customerName, paymentAmount, paymentId, date, targetInvoiceId) {
      var unpaid      = _Allocator.getUnpaidInvoices(customerName);
      var allocations = [];
      var updatedInvoices = [];
      var remainingP  = Math.round(paymentAmount * 100);

      var _allAllocs2 = _gs().data.paymentAllocations || [];
      var _allPayIn2  = _gs().data.payIn || [];
      var _voidedIds2 = {};
      _allPayIn2.forEach(function(pi){ if(pi.voided) _voidedIds2[pi.id] = true; });
      var _paidPaisa2 = {};
      _allAllocs2.forEach(function(a){
        if(!a.invoiceId) return;
        if(_voidedIds2[a.paymentId] && !a._isReturnDeduction) return;
        _paidPaisa2[a.invoiceId] = (_paidPaisa2[a.invoiceId] || 0) + Math.round((a.amountAllocated || 0) * 100);
      });

      if(targetInvoiceId) {
        var _tIdx = -1;
        for(var _i = 0; _i < unpaid.length; _i++){ if(unpaid[_i].id === targetInvoiceId){ _tIdx = _i; break; } }
        if(_tIdx > 0) { var _tInv = unpaid.splice(_tIdx, 1)[0]; unpaid.unshift(_tInv); }
      }

      unpaid.forEach(function(inv) {
        if(remainingP <= 0) return;
        var totResult  = _totals(inv.items || []);
        var invTotalP  = inv.roundOff ? Math.round(totResult.grand) * 100 : totResult.grandPaisa;
        var invPaidP   = (_paidPaisa2[inv.id] !== undefined)
          ? Math.max(0, _paidPaisa2[inv.id])
          : Math.round((inv.paid || 0) * 100);
        var invRemP    = invTotalP - invPaidP;
        if(invRemP <= 0) return;

        var allocateP = Math.min(remainingP, invRemP);
        allocations.push({
          id:              _Allocator._nextAllocId(),
          paymentId:       paymentId,
          invoiceId:       inv.id,
          amountAllocated: allocateP / 100,
          date:            date || _today(),
          createdAt:       _now()
        });

        var newPaidP = invPaidP + allocateP;
        updatedInvoices.push({
          id:        inv.id,
          paid:      newPaidP / 100,
          remaining: Math.max(0, invTotalP - newPaidP) / 100,
          status:    _Allocator._calcStatus(invTotalP, newPaidP)
        });

        remainingP -= allocateP;
      });

      return { allocations: allocations, updatedInvoices: updatedInvoices, unallocated: remainingP / 100 };
    },

    reverseAllocations: function(paymentId) {
      var allocs = (_gs().data.paymentAllocations || [])
        .filter(function(a){ return a.paymentId === paymentId; });

      var byInvoice = {};
      allocs.forEach(function(a) {
        byInvoice[a.invoiceId] = (byInvoice[a.invoiceId] || 0) + (a.amountAllocated || 0);
      });

      var patches = [];
      Object.keys(byInvoice).forEach(function(invoiceId) {
        var inv = (_gs().data.sales || []).find(function(x){ return x.id === invoiceId; });
        if(!inv) return;
        var totResult = _totals(inv.items || []);
        var invTotalP = inv.roundOff ? Math.round(totResult.grand) * 100 : totResult.grandPaisa;
        var reverseP  = Math.round(byInvoice[invoiceId] * 100);
        var newPaidP  = Math.max(0, Math.round((inv.paid || 0) * 100) - reverseP);
        patches.push({
          id:        inv.id,
          paid:      newPaidP / 100,
          remaining: Math.max(0, invTotalP - newPaidP) / 100,
          status:    (inv.status === 'returned' || inv.status === 'partial') ? inv.status : _Allocator._calcStatus(invTotalP, newPaidP)
        });
      });
      return patches;
    },

    reverseAllocationsForInvoice: function(invoiceId) {
      var allocs = (_gs().data.paymentAllocations || [])
        .filter(function(a){ return a.invoiceId === invoiceId; });
      var allocIdsToRemove = allocs.map(function(a){ return a.id; });
      var paymentPatches = [];
      allocs.forEach(function(a) {
        var pi = (_gs().data.payIn || []).find(function(x){ return x.id === a.paymentId && !x.voided; });
        if(!pi) return;
        var restoredP = Math.round(((pi.unallocatedAmount || 0) + a.amountAllocated) * 100);
        paymentPatches.push({ id: pi.id, unallocatedAmount: restoredP / 100 });
      });
      return { allocIdsToRemove: allocIdsToRemove, paymentPatches: paymentPatches };
    }
  };

  function _calcCustomerOutstanding(customerIdOrName) {
    var idStr = String(customerIdOrName || '');
    var balance = _Ledger.getBalance(idStr);
    if(balance === 0) {
      var custRec = (_gs().data.customers || []).find(function(c){
        return (c.n||c.name||'').toLowerCase() === idStr.toLowerCase();
      });
      if(custRec && custRec.id && String(custRec.id) !== idStr) {
        balance = _Ledger.getBalance(String(custRec.id));
      }
    }
    return Math.max(0, balance);
  }

  function _walPersistEntry(entry) {
    if (!entry) return;
    if (!window.ERP || !ERP.Persistence || typeof ERP.Persistence.saveRecord !== 'function') {
      if (window.DEBUG_MODE) console.warn('[WAL] ERP.Persistence unavailable — entry ' + entry.id + ' relying on in-memory state only.');
      return;
    }
    ERP.Persistence.saveRecord('walEntries', entry, { retries: 5, silent: true }).catch(function(e){
      if (window.DEBUG_MODE) console.warn('[WAL] persist failed for entry ' + entry.id + ':', e && e.message || e);
    });
  }

  function _walWrite(txId, type, steps, payload) {
    var entry = {
      id:             ERP.uid ? ERP.uid() : txId + '-wal',
      txId:           txId,
      type:           type,
      status:         'pending',
      steps:          steps.slice(),
      completedSteps: [],
      payload:        payload || null,
      timestamp:      _now()
    };
    _st(function(s){
      s.data.walEntries = (s.data.walEntries || []).concat([entry]);
    }, 'wal:write:' + txId);
    _walPersistEntry(entry);
    return entry;
  }

  function _walUpdate(txId, completedStep, finalStatus) {
    var updated = null;
    _st(function(s){
      var wal = (s.data.walEntries || []).find(function(w){ return w.txId === txId; });
      if(!wal) return;
      if(completedStep && wal.completedSteps.indexOf(completedStep) < 0)
        wal.completedSteps.push(completedStep);
      if(finalStatus) wal.status = finalStatus;
      updated = wal;
    }, 'wal:update:' + txId);
    _walPersistEntry(updated);
  }

  function _atomicSave(steps, txId) {
    if(!Array.isArray(steps) || steps.length === 0) return { success:false, error:'no_steps' };
    var snapshots = steps.map(function(step){
      return { store: step.store, snapshot: _deepClone(_gs().data[step.store] || []) };
    });

    function _rollback() {
      snapshots.forEach(function(snap){
        _st(function(s){ s.data[snap.store] = snap.snapshot; }, 'atomicSave:rollback:' + snap.store);
        Storage().save(snap.store, snap.snapshot).catch(function(e){ console.error('[_atomicSave rollback] persist failed for store', snap.store, '— in-memory state was rolled back but disk copy may be stale until next successful write:', e && e.message || e); });
      });
    }

    _st(function(s){
      steps.forEach(function(step){
        if(Array.isArray(step.data)){
          s.data[step.store] = step.data;
        } else if((step.op === 'add' || step.op === 'push') && step.record) {
          s.data[step.store] = [step.record].concat(s.data[step.store] || []);
        } else if(step.op === 'pushAll' && step.records) {
          s.data[step.store] = (s.data[step.store] || []).concat(step.records);
        } else if(step.op === 'patchMany' && step.patches) {
          step.patches.forEach(function(patch){
            var arr = s.data[step.store] || [];
            var idx = arr.findIndex(function(x){ return x.id === patch.id; });
            if(idx >= 0) arr[idx] = Object.assign({}, arr[idx], patch);
          });
        }
      });
    }, 'atomicSave:batch');

    var chain = Promise.resolve(_ok());
    steps.forEach(function(step) {
      chain = chain.then(function(prev){
        if(!prev.success) return prev;
        return Storage().save(step.store, _gs().data[step.store])
          .then(function(res){
            if(!res || !res.success){ _rollback(); return _fail('Atomic save failed at store: ' + step.store); }
            if(txId) _walUpdate(txId, 'saved:' + step.store);
            var _storeArr = _gs().data[step.store] || [];
            var _broadcastRec = step.op === 'pushAll'
              ? _storeArr[_storeArr.length - 1]
              : _storeArr[0];
            if(_broadcastRec) _broadcast(step.store, _broadcastRec.id, _broadcastRec._v);
            return _ok();
          })
          .catch(function(e){
            if(window.DEBUG_MODE) console.error('[atomicSave step]', step.store, e);
            _rollback();
            return _fail((e && e.message) || ('Atomic save threw at store: ' + step.store));
          });
      });
    });

    return chain.then(function(result) {
      if(txId) _walUpdate(txId, null, result.success ? 'committed' : 'rolled_back');
      return result;
    }).catch(function(e){
      if(window.DEBUG_MODE) console.error('[atomicSave]', e);
      _rollback();
      if(txId) _walUpdate(txId, null, 'rolled_back');
      return _fail((e && e.message) || 'Atomic save failed unexpectedly');
    });
  }

  function _reconciliationCheck() {
    try {
      var customers = _gs().data.customers || [];
      var healed = [];
      customers.forEach(function(c) {
        var custId   = String(c.id || c.n || '');
        var custName = (c.n || c.name || '').toLowerCase();

        var ledgerBalance = _Ledger.getBalance(custId);
        if(ledgerBalance === 0 && custId !== custName) {
          var balByName = _Ledger.getBalance(custName);
          if(balByName !== 0) ledgerBalance = balByName;
        }

        var allSales = (_gs().data.sales || []).filter(function(inv){
          return !inv.deleted &&
            ((inv.customer||'').toLowerCase() === custName || String(inv.customerId||'') === custId);
        });
        var totalInvoicedP = allSales.reduce(function(sum, inv){
          var g = inv.roundOff ? Math.round(_totals(inv.items||[]).grand) * 100 : _totals(inv.items||[]).grandPaisa;
          return sum + g;
        }, 0);

        var allPayments = (_gs().data.payIn || []).filter(function(pi){
          return !pi.voided && (
            (pi.party||'').toLowerCase() === custName ||
            String(pi.customerId||'').toLowerCase() === custId.toLowerCase()
          );
        });
        var totalPaymentsP = allPayments.reduce(function(sum, pi){ return sum + Math.round((pi.amount||0)*100); }, 0);

        var allReturns = (_gs().data.saleReturns || []).filter(function(r){
          return !r.voided && !r.cancelled &&
                 (r.customer||'').toLowerCase() === custName;
        });
        var totalCreditP = allReturns.reduce(function(sum, r){ return sum + Math.round((r.returnGrand||r.amount||0)*100); }, 0);

        var allRefunds = (_gs().data.customerPayOut || []).filter(function(r){
          return !r.voided && (
            (r.customer||'').toLowerCase() === custName ||
            String(r.customerId||'').toLowerCase() === custId.toLowerCase()
          );
        });
        var totalRefundsP = allRefunds.reduce(function(sum, r){ return sum + Math.round((r.amount||0)*100); }, 0);

        var expectedP = totalInvoicedP - totalPaymentsP - totalCreditP - totalRefundsP;
        var ledgerP   = Math.round(ledgerBalance * 100);

        if(Math.abs(ledgerP - expectedP) > 1) {
          try {
            var ledgerAll = _gs().data.customerLedger || [];
            var cleaned = ledgerAll.filter(function(e){
              var eid = String(e.customerId || '');
              return eid !== custId && eid.toLowerCase() !== custName;
            });
            var preserved = ledgerAll.filter(function(e){
              return String(e.customerId||'') === custId &&
                     (e.type === 'OPENING_BALANCE' || e.type === 'ADJUSTMENT');
            });
            var events = [];
            preserved.forEach(function(e){ events.push({ id: e.id, date:e.date||'', createdAt:e.createdAt||'', type:e.type, ref:e.ref, debitP:Math.round((e.debit||0)*100), creditP:Math.round((e.credit||0)*100) }); });
            allSales.forEach(function(inv){
              var gP = inv.roundOff ? Math.round(_totals(inv.items||[]).grand)*100 : _totals(inv.items||[]).grandPaisa;
              events.push({ id: inv.id + '-inv', date:inv.date||'', createdAt:inv.createdAt||'', type:'INVOICE', ref:inv.id, debitP:gP, creditP:0 });
            });
            allPayments.forEach(function(pi){
              events.push({ id: pi.id + '-pay', date:pi.date||'', createdAt:pi.createdAt||'', type:'PAYMENT', ref:pi.id, debitP:0, creditP:Math.round((pi.amount||0)*100) });
            });
            allReturns.forEach(function(r){
              events.push({ id: r.id + '-ret', date:r.date||'', createdAt:r.createdAt||'', type:'CREDIT_NOTE', ref:r.id, debitP:0, creditP:Math.round((r.returnGrand||r.amount||0)*100) });
            });
            allRefunds.forEach(function(r){
              events.push({ id: r.id + '-ref', date:r.date||'', createdAt:r.createdAt||'', type:'CUSTOMER_REFUND', ref:r.id, debitP:0, creditP:Math.round((r.amount||0)*100) });
            });
            events.sort(function(a,b){
              var ta = a.createdAt ? (Date.parse(a.createdAt)||0) : (a.date ? (Date.parse(a.date)||0) : 0);
              var tb = b.createdAt ? (Date.parse(b.createdAt)||0) : (b.date ? (Date.parse(b.date)||0) : 0);
              if(ta !== tb) return ta - tb;
              return (a.ref||'') < (b.ref||'') ? -1 : 1;
            });
            var runningP = 0;
            var newEntries = events.map(function(ev,i){
              runningP += ev.debitP; runningP -= ev.creditP;
              return { id: ev.id || ('LE-HEAL-'+custId+'-'+String(i+1).padStart(3,'0')),
                customerId:custId, type:ev.type, ref:ev.ref,
                debit:ev.debitP/100, credit:ev.creditP/100,
                balance:runningP/100, date:ev.date,
                note:ev.type+' '+ev.ref+' [auto-healed]', createdAt:_now() };
            });
            var healed_ledger = cleaned.concat(newEntries);
            _st(function(s){ s.data.customerLedger = healed_ledger; }, 'ledger:heal:'+custId);
            Storage().save('customerLedger', healed_ledger).catch(function(e){ console.error('[ledger:heal] persist failed for', custId, e && e.message || e); });
            healed.push(c.n || custId);
          } catch(healErr){ if(window.DEBUG_MODE) console.error(healErr); }
        }
      });
    } catch(e){ if(window.DEBUG_MODE) console.error(e); }
  }

  var Svc = {

    sales: {
      getAll:  function(){ return State().getSales(); },
      search:  function(q){
        if(!q) return this.getAll();
        var lq = q.toLowerCase();
        return this.getAll().filter(function(s){
          return (s.customer||'').toLowerCase().includes(lq) ||
                 (s.id||'').toLowerCase().includes(lq) ||
                 String(s.ph||'').replace(/\s/g,'').includes(q.replace(/\s/g,''));
        });
      },

      meta: function(id){
        var linkedReturns = State().getReturns()
          .filter(function(r){ return r.originalInv === id; }).length;
        return _ok(null, { id:id, linkedReturns:linkedReturns });
      },

      del: function(id){
        var linkedReturns = State().getReturns()
          .filter(function(r){ return r.originalInv === id; }).length;
        var next = State().getSales().filter(function(x){ return x.id !== id; });
        return _ok({ sales:next }, { id:id, linkedReturns:linkedReturns });
      },

      add: function(record){
        if(record.opKey){
          var existing = (_gs().data.sales||[]).find(function(x){ return x.opKey === record.opKey; });
          if(existing){
            return _persist('sales', null);
          }
        }
        if(record.id){
          var existsById = (_gs().data.sales||[]).find(function(x){ return x.id === record.id; });
          if(existsById){
            return _persist('sales', null);
          }
        }
        var snap = _snapshot('sales');
        State().update(function(s){
          s.data.sales = [record].concat(s.data.sales || []);
        }, 'sales:add');
        return _persist('sales', snap).then(function(res) {
          var ok = !res || res.success !== false;
          if (ok) {
            var _emitOk = false;
            try {
              if (ERP.EventBus && typeof ERP.EventBus.emit === 'function') {
                ERP.EventBus.emit('sales:added', record);
                _emitOk = true;
              } else if (ERP.events && typeof ERP.events.emit === 'function') {
                ERP.events.emit('sales:added', record);
                _emitOk = true;
              }
            } catch(e) {
              _emitOk = false;
            }
            if(typeof window !== 'undefined' && window.ERP && !_emitOk && ERP.SalesPostingLock && typeof ERP.SalesPostingLock.postSale === 'function') {
              try { ERP.SalesPostingLock.postSale(record); }
              catch(glE){ if(window.DEBUG_MODE) console.error(glE); }
            }
            (function(saleId) {
              try {
                var _walKey = 'erp_gl_pending_sales';
                var _walQ = [];
                try { _walQ = JSON.parse(localStorage.getItem(_walKey) || '[]'); } catch(_){ if(window.DEBUG_MODE) console.error(_); }
                if (!_walQ.find(function(w){ return w.id === saleId; })) {
                  _walQ.push({ id: saleId, type: 'sale_gl', status: 'pending', createdAt: _now() });
                  try { localStorage.setItem(_walKey, JSON.stringify(_walQ)); } catch(_){ if(window.DEBUG_MODE) console.error(_); }
                }
                if (window.ERP && ERP.PostingEngine && typeof ERP.PostingEngine.isPosted === 'function') {
                  if (ERP.PostingEngine.isPosted('SALE-REV-' + saleId)) {
                    _walQ = _walQ.filter(function(w){ return w.id !== saleId; });
                    try { localStorage.setItem(_walKey, JSON.stringify(_walQ)); } catch(_){ if(window.DEBUG_MODE) console.error(_); }
                  }
                }
              } catch(_){ if(window.DEBUG_MODE) console.error(_); }
            })(record.id);
          }
          return res;
        }).catch(function(e){
          if(window.DEBUG_MODE) console.error('[sales.add]', e);
          return _fail((e && e.message) || 'sales.add failed unexpectedly');
        });
      },

      update: function(id, patch){
        var current = (_gs().data.sales||[]).find(function(x){ return x.id === id; });
        if(current && patch._v !== undefined && current._v !== undefined && patch._v !== current._v) {
          return Promise.resolve(_fail(_mkError(ConcurrencyError,
            'Invoice ' + id + ' was modified by another operation', 'SalesService', 'update', id, null)));
        }
        var snap = _snapshot('sales');
        State().update(function(s){
          var a = s.data.sales || [];
          var i = a.findIndex(function(x){ return x.id === id; });
          if(i >= 0) {
            var nextV = ((a[i]._v || 0) + 1);
            var cleanPatch = Object.assign({}, patch);
            delete cleanPatch._v;
            a[i] = Object.assign({}, a[i], cleanPatch, { _v: nextV, updatedAt: _now() });
          }
        }, 'sales:update');
        return _persist('sales', snap);
      },

      applyDel: function(nextSales){
        var snap = _snapshot('sales');
        State().update(function(s){ s.data.sales = nextSales; }, 'sales:del');
        return _persist('sales', snap);
      },

      softDelete: function(id, actor, reason) {
        var snap = _snapshot('sales');
        State().update(function(s){
          var a = s.data.sales || [];
          var i = a.findIndex(function(x){ return x.id === id; });
          if(i >= 0) {
            a[i] = Object.assign({}, a[i], {
              deleted:      true,
              deletedAt:    _now(),
              deletedBy:    actor || 'system',
              deleteReason: reason || '',
              _v:           ((a[i]._v || 0) + 1)
            });
          }
        }, 'sales:softDelete');
        return _persist('sales', snap);
      },

      deleteInvoice: function(id, tx) {
        _requireTx(tx, 'SalesService', 'deleteInvoice');
        _requireAdmin(tx, 'deleteInvoice');

        var inv = (_gs().data.sales || []).find(function(x){ return x.id === id && !x.deleted; });
        if (!inv) return Promise.resolve(_fail('Invoice not found: ' + id));

        var linkedReturns = State().getReturns().filter(function(r){ return r.originalInv === id && !r.voided && !r.cancelled; }).length;
        if (linkedReturns > 0) {
          return Promise.resolve(_fail('Cannot delete invoice ' + id + ': ' + linkedReturns + ' linked return(s) exist. Void returns first.'));
        }

        var custId = String(inv.customerId || '');
        if (!custId && inv.customer && inv.customer !== 'Walk-in Customer') {
          var custRec = (_gs().data.customers || []).find(function(c){
            return (c.n || c.name || '').toLowerCase() === inv.customer.toLowerCase();
          });
          custId = custRec ? String(custRec.id || custRec.n) : inv.customer;
        }

        var totResult = _totals(inv.items || []);
        var invTotal  = inv.roundOff ? Math.round(totResult.grand) : totResult.grand;
        var isWalkIn  = !custId || inv.customer === 'Walk-in Customer';

        _walWrite(tx.txId, 'deleteInvoice',
          ['softDelete', 'restoreInventory', 'reverseAllocations', 'voidLedger'], { id: id });

        var allocResult = _Allocator.reverseAllocationsForInvoice(id);
        var allocIdsSet = {};
        allocResult.allocIdsToRemove.forEach(function(aid){ allocIdsSet[aid] = true; });
        var _preDeleteAllocations = (_gs().data.paymentAllocations || []).slice();
        var nextAllocations = _preDeleteAllocations
          .filter(function(a){ return !allocIdsSet[a.id]; });
        var _preDeletePaymentSnapshot = {};
        allocResult.paymentPatches.forEach(function(p){
          var origPi = (_gs().data.payIn || []).find(function(x){ return x.id === p.id; });
          if (origPi) _preDeletePaymentSnapshot[p.id] = { unallocatedAmount: origPi.unallocatedAmount };
        });

        var steps = [];
        if (!isWalkIn) {
          var voidEntry = _Ledger.createInvoiceVoidEntry(custId, id, invTotal, _today());
          steps.push({ store: 'customerLedger', op: 'pushAll', records: [voidEntry] });
        }
        steps.push({ store: 'payIn',              op: 'patchMany', patches: allocResult.paymentPatches });
        steps.push({ store: 'paymentAllocations', data: nextAllocations });

        var deletedInv = Object.assign({}, inv, {
          deleted: true, deletedAt: _now(), deletedBy: tx.actor,
          deleteReason: 'Invoice deleted by ' + tx.actor,
          _v: ((inv._v || 0) + 1)
        });
        var nextSales = (_gs().data.sales || []).map(function(x){ return x.id === id ? deletedInv : x; });
        steps.push({ store: 'sales', data: nextSales });

        return _atomicSave(steps, tx.txId).then(function(res){
          if (!res.success) {
            _walUpdate(tx.txId, null, 'rolled_back');
            return res;
          }

          if (custId && !isWalkIn) _Ledger.recalculate(custId);

          var invModule = ERP.InventoryService || (typeof window !== 'undefined' && window.ERP && window.ERP.InventoryService);
          var inventoryRestoreChain = Promise.resolve();
          var restoreEntries = [];
          if (invModule && typeof invModule.restore === 'function' && (inv.items || []).length > 0) {
            restoreEntries = (inv.items || []).map(function(item) {
              return {
                barcode: item.barcode || item.bc || item.sku || '',
                qty: Math.max(0, parseFloat(item.qty || item.q || 0)),
                unitCostPaisa: (item.unitCostPaisa !== undefined && item.unitCostPaisa !== null) ? item.unitCostPaisa : 0
              };
            });
            inventoryRestoreChain = invModule.restore(restoreEntries, {
              sourceModule: 'sales',
              documentId: id,
              actor: tx.actor
            }).then(function(res) { return Promise.resolve(res); }).catch(function(e) {
              return Promise.resolve();
            });
          }

          return inventoryRestoreChain.then(function(){
            var pe = ERP.PostingEngine || (typeof window !== 'undefined' && window.ERP && window.ERP.PostingEngine);
            var revPosted  = pe && typeof pe.isPosted === 'function' && pe.isPosted('SALE-REV-'  + id);
            var cogsPosted = pe && typeof pe.isPosted === 'function' && pe.isPosted('SALE-COGS-' + id);

            var glChain = Promise.resolve();
            if (revPosted)  glChain = glChain.then(function(){ return pe.reverse('SALE-REV-'  + id, { reason: 'Invoice deleted: ' + id, actor: tx.actor }); });
            if (cogsPosted) glChain = glChain.then(function(){ return pe.reverse('SALE-COGS-' + id, { reason: 'Invoice deleted COGS: ' + id, actor: tx.actor }); });

            return glChain.then(function(){
              _audit(tx, 'invoice_deleted', 'SalesService', inv, null, 'warning');
              _walUpdate(tx.txId, null, 'committed');
              return res;
            }).catch(function(glErr){
              var reDeductChain = Promise.resolve();
              if (invModule && typeof invModule.deduct === 'function' && restoreEntries.length > 0) {
                reDeductChain = invModule.deduct(restoreEntries, {
                  sourceModule: 'sales', documentId: id, actor: tx.actor, skipGLBridge: true
                }).catch(function(reDeductErr){
                  console.error('[deleteInvoice] re-deduct during GL-failure rollback also failed — stock may be over-restored for', id, reDeductErr && reDeductErr.message || reDeductErr);
                });
              }
              return reDeductChain.then(function(){
                var rollbackSteps = [];
                if (!isWalkIn) {
                  var filteredLedger = (_gs().data.customerLedger || []).filter(function(e){
                    return !(e.type === 'INVOICE_VOID' && e.ref === id && String(e.customerId) === String(custId));
                  });
                  rollbackSteps.push({ store: 'customerLedger', data: filteredLedger });
                }
                var rollbackPaymentPatches = allocResult.paymentPatches.map(function(p){
                  var snap = _preDeletePaymentSnapshot[p.id];
                  return snap ? { id: p.id, unallocatedAmount: snap.unallocatedAmount } : p;
                });
                rollbackSteps.push({ store: 'payIn', op: 'patchMany', patches: rollbackPaymentPatches });
                rollbackSteps.push({ store: 'paymentAllocations', data: _preDeleteAllocations });
                var restoredSales = (_gs().data.sales || []).map(function(x){ return x.id === id ? inv : x; });
                rollbackSteps.push({ store: 'sales', data: restoredSales });

                return _atomicSave(rollbackSteps, tx.txId).then(function(){
                  if (custId && !isWalkIn) _Ledger.recalculate(custId);
                  _walUpdate(tx.txId, null, 'rolled_back');
                  return _fail('Invoice delete failed: GL reversal could not be completed (' +
                    (glErr && glErr.message || 'unknown error') +
                    '). Invoice has been restored.');
                });
              });
            });
          });
        }).catch(function(e){
          if(window.DEBUG_MODE) console.error('[deleteInvoice]', e);
          return _fail((e && e.message) || 'deleteInvoice failed unexpectedly');
        });
      }
    },

    est: {
      getAll: function(){ return State().getEstimates(); },
      meta:   function(id){ return _ok(null, { id:id }); },
      del: function(id){
        var next = State().getEstimates().filter(function(x){ return x.id !== id; });
        return _ok({ estimates:next }, { id:id });
      },
      add: function(record){
        if(record.opKey){
          var dupKey = (_gs().data.estimates||[]).find(function(x){ return x.opKey === record.opKey; });
          if(dupKey){ return _persist('estimates', null); }
        }
        if(record.id){
          var dupId = (_gs().data.estimates||[]).find(function(x){ return x.id === record.id; });
          if(dupId){ return _persist('estimates', null); }
        }
        var snap = _snapshot('estimates');
        State().update(function(s){ s.data.estimates = [record].concat(s.data.estimates || []); }, 'est:add');
        return _persist('estimates', snap);
      },
      update: function(id, patch){
        var snap = _snapshot('estimates');
        State().update(function(s){
          var a = s.data.estimates || []; var i = a.findIndex(function(x){ return x.id === id; });
          if(i >= 0) a[i] = Object.assign({}, a[i], patch, { updatedAt: _now() });
        }, 'est:update');
        return _persist('estimates', snap);
      },
      applyDel: function(nextEstimates){
        var snap = _snapshot('estimates');
        State().update(function(s){ s.data.estimates = nextEstimates; }, 'est:del');
        return _persist('estimates', snap);
      }
    },

    so: {
      getAll: function(){ return State().getSaleOrders(); },
      meta:   function(id){ return _ok(null, { id:id }); },
      del: function(id){
        var next = State().getSaleOrders().filter(function(x){ return x.id !== id; });
        return _ok({ saleOrders:next }, { id:id });
      },
      add: function(record){
        if(record.opKey){
          var dupKey = (_gs().data.saleOrders||[]).find(function(x){ return x.opKey === record.opKey; });
          if(dupKey){ return _persist('saleOrders', null); }
        }
        if(record.id){
          var dupId = (_gs().data.saleOrders||[]).find(function(x){ return x.id === record.id; });
          if(dupId){ return _persist('saleOrders', null); }
        }
        var snap = _snapshot('saleOrders');
        State().update(function(s){ s.data.saleOrders = [record].concat(s.data.saleOrders || []); }, 'so:add');
        return _persist('saleOrders', snap);
      },
      update: function(id, patch){
        var snap = _snapshot('saleOrders');
        State().update(function(s){
          var a = s.data.saleOrders || []; var i = a.findIndex(function(x){ return x.id === id; });
          if(i >= 0) a[i] = Object.assign({}, a[i], patch, { updatedAt: _now() });
        }, 'so:update');
        return _persist('saleOrders', snap);
      },
      applyDel: function(next){
        var snap = _snapshot('saleOrders');
        State().update(function(s){ s.data.saleOrders = next; }, 'so:del');
        return _persist('saleOrders', snap);
      }
    },

    payin: {
      getAll: function(){ return (State().getPayIn() || []).filter(function(x){ return !x._deleted; }); },
      meta:   function(id){ return _ok(null, { id:id }); },
      del: function(id){
        var now = _now();
        var actor = '';
        try { actor = (_gs().session && _gs().session.user && _gs().session.user.name) || ''; } catch(_){ if(window.DEBUG_MODE) console.error(_); }
        var next = State().getPayIn().map(function(x){
          return x.id === id
            ? Object.assign({}, x, { _deleted: true, _deletedAt: now, _deletedBy: actor })
            : x;
        });
        return _ok({ payIn:next }, { id:id });
      },
      add: function(record){
        if(record.id){
          var exists = ((_gs().data.payIn)||[]).find(function(x){ return x.id === record.id; });
          if(exists){
            return _persist('payIn', null);
          }
        }
        var snap = _snapshot('payIn');
        State().update(function(s){ s.data.payIn = [record].concat(s.data.payIn || []); }, 'payin:add');
        return _persist('payIn', snap);
      },
      applyDel: function(next){
        var snap = _snapshot('payIn');
        State().update(function(s){ s.data.payIn = next; }, 'payin:del');
        return _persist('payIn', snap);
      },
      applyAndPersist: function(invoiceId, newPaid){
        var snap = _snapshot('sales');
        State().update(function(s){
          var inv = (s.data.sales||[]).find(function(x){ return x.id === invoiceId; });
          if(!inv) return;
          var totResult = _totals(inv.items||[]);
          var grandP    = inv.roundOff ? Math.round(totResult.grand)*100 : totResult.grandPaisa;
          var newPaidP  = Math.round(newPaid * 100);
          inv.paid      = newPaidP / 100;
          inv.status    = inv.status === 'returned' ? 'returned' : _Allocator._calcStatus(grandP, newPaidP);
          inv.updatedAt = _now();
          inv._v        = (inv._v || 0) + 1;
        }, 'payIn:applyToInvoice');
        return _persist('sales', snap);
      },

      voidPayment: function(paymentId, tx) {
        _requireTx(tx, 'PayInService', 'voidPayment');
        _requireAdmin(tx, 'voidPayment');
        var pi = (_gs().data.payIn || []).find(function(x){ return x.id === paymentId; });
        if(!pi)     return Promise.resolve(_fail('Payment not found: ' + paymentId));
        if(pi.voided) return Promise.resolve(_fail('Payment already voided: ' + paymentId));

        var custId = pi.customerId || pi.party;
        var walEntry = _walWrite(tx.txId, 'voidPayment', ['voidLedger', 'reverseAllocations', 'patchPayIn'], { paymentId: paymentId });

        var voidEntry      = _Ledger.createVoidEntry(custId, paymentId, pi.amount, _today());
        var invoicePatches = _Allocator.reverseAllocations(paymentId);
        var _preVoidInvSnapshot = {};
        invoicePatches.forEach(function(p){
          var orig = (_gs().data.sales || []).find(function(x){ return x.id === p.id; });
          if(orig) _preVoidInvSnapshot[p.id] = { paid: orig.paid, remaining: orig.remaining, status: orig.status };
        });

        var steps = [
          { store: 'customerLedger', op: 'pushAll',  records: [voidEntry] },
          { store: 'sales',          op: 'patchMany', patches: invoicePatches },
          { store: 'payIn',          op: 'patchMany', patches: [{ id: paymentId, voided: true, voidedAt: _now(), _v: (pi._v||0)+1 }] }
        ];

        return _atomicSave(steps, tx.txId).then(function(res){
          if(res.success) {
            _Ledger.recalculate(String(custId));
            var _glRevVoid = (ERP.PostingEngine && typeof ERP.PostingEngine.reverse === 'function')
              ? ERP.PostingEngine.reverse('PAYIN-' + paymentId, { reason: 'Payment voided: ' + paymentId, actor: tx.actor })
              : Promise.resolve();

            return _glRevVoid
              .then(function() {
                _audit(tx, 'payment_voided', 'PayInService', pi, null, 'warning');
                _walUpdate(tx.txId, null, 'committed');
                return res;
              })
              .catch(function(glErr) {
                var rollbackPatches = [{ id: paymentId, voided: false, voidedAt: '', _v: pi._v || 0 }];
                var rollbackLedger = (_gs().data.customerLedger || []).filter(function(e){
                  return !(e.type === 'PAYMENT_VOID' && e.ref === paymentId && String(e.customerId) === String(custId));
                });
                var rollbackInvPatches = invoicePatches.map(function(p){
                  var snap = _preVoidInvSnapshot[p.id];
                  return snap ? { id: p.id, paid: snap.paid, remaining: snap.remaining, status: snap.status } : p;
                });
                var rollbackSteps = [
                  { store: 'payIn',          op: 'patchMany', patches: rollbackPatches },
                  { store: 'customerLedger', data: rollbackLedger },
                  { store: 'sales',          op: 'patchMany', patches: rollbackInvPatches }
                ];
                return _atomicSave(rollbackSteps, tx.txId).then(function() {
                  _walUpdate(tx.txId, null, 'rolled_back');
                  return _fail('Payment void failed: GL reversal could not be completed (' +
                    (glErr && glErr.message || 'unknown error') +
                    '). Payment has been restored.');
                });
              });
          } else {
            _walUpdate(tx.txId, null, 'rolled_back');
            return res;
          }
        }).catch(function(e){
          if(window.DEBUG_MODE) console.error('[voidPayment]', e);
          return _fail((e && e.message) || 'voidPayment failed unexpectedly');
        });
      }
    },

    dc: {
      getAll: function(){ return State().getChallans(); },
      add: function(record){
        if(record.opKey){
          var dupKey = (_gs().data.deliveryChallans||[]).find(function(x){ return x.opKey === record.opKey; });
          if(dupKey){ return _persist('deliveryChallans', null); }
        }
        if(record.id){
          var dupId = (_gs().data.deliveryChallans||[]).find(function(x){ return x.id === record.id; });
          if(dupId){ return _persist('deliveryChallans', null); }
        }
        var snap = _snapshot('deliveryChallans');
        State().update(function(s){ s.data.deliveryChallans = [record].concat(s.data.deliveryChallans || []); }, 'dc:add');
        return _persist('deliveryChallans', snap);
      },
      update: function(id, patch){
        var snap = _snapshot('deliveryChallans');
        State().update(function(s){
          var a = s.data.deliveryChallans || []; var i = a.findIndex(function(x){ return x.id === id; });
          if(i >= 0) a[i] = Object.assign({}, a[i], patch, { updatedAt: _now() });
        }, 'dc:update');
        return _persist('deliveryChallans', snap);
      }
    },

    ret: {
      getAll: function(){ return (State().getReturns() || []).filter(function(x){ return !x._deleted; }); },
      meta:   function(id){ return _ok(null, { id:id }); },
      del: function(id){
        var now = _now();
        var actor = '';
        try { actor = (_gs().session && _gs().session.user && _gs().session.user.name) || ''; } catch(_){ if(window.DEBUG_MODE) console.error(_); }
        var next = State().getReturns().map(function(x){
          return x.id === id
            ? Object.assign({}, x, { _deleted: true, _deletedAt: now, _deletedBy: actor })
            : x;
        });
        return _ok({ saleReturns:next }, { id:id });
      },
      add: function(record){
        if(record.opKey){
          var existing = (_gs().data.saleReturns||[]).find(function(x){ return x.opKey === record.opKey; });
          if(existing){ return _persist('saleReturns', null); }
        }
        if(record.id){
          var existsById = (_gs().data.saleReturns||[]).find(function(x){ return x.id === record.id; });
          if(existsById){ return _persist('saleReturns', null); }
        }
        var snap = _snapshot('saleReturns');
        State().update(function(s){ s.data.saleReturns = [record].concat(s.data.saleReturns || []); }, 'ret:add');
        return _persist('saleReturns', snap);
      },
      applyDel: function(next){
        var snap = _snapshot('saleReturns');
        State().update(function(s){ s.data.saleReturns = next; }, 'ret:del');
        return _persist('saleReturns', snap);
      },
      restoreInvoice: function(originalInvId, refundAmount){
        var snap = _snapshot('sales');
        State().update(function(s){
          var inv = (s.data.sales||[]).find(function(x){ return x.id === originalInvId; });
          if(!inv || inv.deleted) return;
          var totResult = _totals(inv.items||[]);
          var grandP    = inv.roundOff ? Math.round(totResult.grand)*100 : totResult.grandPaisa;
          var restoredP = Math.min(grandP, Math.round((refundAmount||0)*100));
          inv.paid      = restoredP / 100;
          inv.status    = _Allocator._calcStatus(grandP, restoredP);
          inv.updatedAt = _now();
          inv._v        = (inv._v || 0) + 1;
        }, 'ret:restoreInvoice');
        return _persist('sales', snap);
      }
    },

    customers: {
      getAll: function(){ return State().getCustomers(); },

      addInline: function(custObj){
        if(!custObj || !(custObj.n||'').trim()) return Promise.resolve({ success:false, error:'Customer name required', data:null, meta:{} });
        var nm = (custObj.n||'').trim().toLowerCase();
        var existing = (_gs().data.customers||[]).find(function(c){
          return (c.n||c.name||c.customer||'').trim().toLowerCase() === nm;
        });
        if(existing){
          return Promise.resolve(_ok(existing, { skipped:true, reason:'duplicate' }));
        }
        var snap = _snapshot('customers');
        State().update(function(s){ s.data.customers = [custObj].concat(s.data.customers || []); }, 'customers:inline');
        return _persist('customers', snap);
      },

      updateBalance: function(customerName, patch){
        if(!customerName) return Promise.resolve(_fail('no customerName'));
        if(!patch || !patch.hasOwnProperty('creditLimit')) return Promise.resolve(_ok());
        var snap = _snapshot('customers');
        State().update(function(s){
          var nm = (customerName || '').toLowerCase();
          var c  = (s.data.customers || []).find(function(x){
            return (x.n || x.name || x.customer || '').toLowerCase() === nm;
          });
          if(c && typeof patch.creditLimit === 'number') c.creditLimit = patch.creditLimit;
        }, 'customers:creditLimit');
        return _persist('customers', snap);
      }
    },

    invoice: {

      buildSale: function(formData, editId){
        var items  = formData.items || [];
        var totals = _totals(items);
        var grand  = formData.roundOff ? Math.round(totals.grand) : totals.grand;
        var grandP = Math.round(grand * 100);

        var payType = formData.payType || 'Cash';
        var recValP = Math.round(Math.max(0, formData.receivedAmount || 0) * 100);
        var initialPayment = null;

        if(formData.receivedChecked && recValP > 0 && grandP > 0) {
          initialPayment = { amount: Math.min(recValP, grandP) / 100 };
        }

        var id = editId || _nextId(Svc.sales.getAll(), _invPrefix());
        if(formData.customId && formData.customId.trim()){
          var proposedId = formData.customId.trim();
          if(!editId){
            var idExists = Svc.sales.getAll().some(function(inv){ return inv.id === proposedId && !inv.deleted; });
            if(idExists) return _fail('Invoice ID "' + proposedId + '" already exists.');
          }
          id = proposedId;
        }

        var _invSvc = ERP.InventoryService || (typeof window !== 'undefined' && window.ERP && window.ERP.InventoryService);
        var _invPartsForCost = State().getParts ? State().getParts() : [];
        var costedItems = items.map(function(it){
          var costed = Object.assign({}, it);
          if (costed.unitCostPaisa !== undefined && costed.unitCostPaisa !== null) return costed;
          var bc = (costed.barcode || costed.sku || costed.bc || '').trim();
          if (!bc && costed.n) {
            var matched = _invPartsForCost.find(function(p){ return (p.n||'').toLowerCase() === (costed.n||'').toLowerCase(); });
            if (matched && matched.bc) bc = matched.bc;
          }
          if (bc && _invSvc && typeof _invSvc.getAvgCost === 'function') {
            var avgCost = _invSvc.getAvgCost(bc);
            if (avgCost > 0) costed.unitCostPaisa = Math.round(avgCost * 100);
          }
          return costed;
        });

        return _ok({
          sale: {
            id:            id,
            _v:            1,
            opKey:         id + '@' + Date.now(),
            customer:      (formData.customer || '').trim() || (payType !== 'Credit' ? 'Walk-in Customer' : ''),
            customerId:    formData.customerId || '',
            ph:            formData.phone || '',
            veh:           '',
            notes:         formData.notes || '',
            items:         _deepClone(costedItems),
            pay:           payType,
            paid:          0,
            total:         grand,
            grand:         grand,
            remaining:     grand,
            status:        grandP <= 0 ? 'paid' : 'unpaid',
            date:          formData.date || _today(),
            state:         formData.supplyState || '',
            roundOff:      !!formData.roundOff,
            qrCode:        formData.qrCode || null,
            imgAttachment: formData.imgAttachment || null,
            deleted:       false,
            updatedAt:     _now(),
            createdAt:     _now(),
            createdBy:     (ERP.user && ERP.user.name) || 'system'
          },
          totals:         totals,
          grand:          grand,
          initialPayment: initialPayment
        });
      },

      validate: function(formData, editId){
        var isCredit = (formData.payType || 'Cash') === 'Credit';
        if(isCredit && !(formData.customer || '').trim())
          return _fail('Customer is required for credit sales');
        if(!formData.items || !formData.items.length)
          return _fail('Please add at least one item');

        var qtyErrors = [];
        var unnamedErrors = [];
        (formData.items || []).forEach(function(item) {
          var q = parseFloat(item.q || item.qty || 0);
          var n = (item.n || item.name || '').trim();
          if (!n && q > 0) {
            unnamedErrors.push('Unnamed item has quantity ' + q);
            return;
          }
          if (!n) return;
          if (q <= 0) qtyErrors.push('"' + n + '" quantity must be greater than 0 (got: ' + q + ')');
        });
        if (unnamedErrors.length) return _fail('Unnamed items found: ' + unnamedErrors.join('; '));
        if (qtyErrors.length) return _fail('Invalid quantities: ' + qtyErrors.join('; '));

        if(formData.customId && formData.customId.trim()){
          if(/[^a-zA-Z0-9\-_]/.test(formData.customId.trim()))
            return _fail('Invoice number can only contain letters, numbers, - and _');
          var existing = Svc.sales.getAll().find(function(inv){
            return inv.id === formData.customId.trim() && !inv.deleted &&
                   (editId === null || editId === undefined || inv.id !== editId);
          });
          if(existing) return _fail('Invoice ID ' + formData.customId.trim() + ' already exists!');
        }

        var prevQtyMap = {};
        if(editId){
          var origInv = Svc.sales.getAll().find(function(x){ return x.id === editId; });
          if(origInv){
            (origInv.items || []).forEach(function(i){
              var bc = (i.barcode || i.sku || i.n || '').toLowerCase();
              prevQtyMap[bc] = (prevQtyMap[bc] || 0) + (i.q || 0);
            });
          }
        }
        var stockErrors = _checkStock(formData.items, prevQtyMap);
        if(!stockErrors.bypass && stockErrors.errors && stockErrors.errors.length)
          return _fail('Insufficient stock: ' + stockErrors.errors.map(function(e){ return e.message; }).join(', '));

        return _ok();
      },

      computeRestorations: function(editId, newItems){
        var origInv = Svc.sales.getAll().find(function(x){ return x.id === editId; });
        if(!origInv) return { restorations: [], deductions: [] };

        var _invParts = State().getParts ? State().getParts() : [];
        function _resolveBC(item){
          var bc = (item.barcode || item.sku || item.bc || '').trim();
          if(!bc && (item.n || item.name)){
            var nm = (item.n || item.name || '').toLowerCase();
            var found = _invParts.find(function(p){ return (p.n||'').toLowerCase() === nm; });
            if(found && found.bc) bc = found.bc;
          }
          return bc;
        }

        var newMap = {};
        newItems.forEach(function(i){
          var bc = _resolveBC(i);
          if(!bc) return;
          newMap[bc.toLowerCase()] = i.q || 0;
        });

        var retQtyMap = {};
        (_gs().data.saleReturns || []).filter(function(r){ return r.originalInv === editId; })
          .forEach(function(r){
            (r.items || []).forEach(function(ri){
              var bc = (_resolveBC(ri) || '').toLowerCase();
              if(bc) retQtyMap[bc] = (retQtyMap[bc] || 0) + (ri.q || 0);
            });
          });

        function _resolveCostPaisa(item, bc){
          var matched = _invParts.find(function(p){ return !p._archived && (p.bc || p.barcode) === bc; });
          return _resolveStockEntryCost(item, bc, matched);
        }

        var restorations = [];
        var deductions   = [];

        (origInv.items || []).forEach(function(origItem){
          var bc = _resolveBC(origItem);
          if(!bc) return;
          var bcL        = bc.toLowerCase();
          var origQty    = origItem.q || 0;
          var retQty     = retQtyMap[bcL] || 0;
          var netOrigQty = Math.max(0, origQty - retQty);
          var newQty     = bcL in newMap ? newMap[bcL] : 0;
          var delta      = newQty - netOrigQty;
          if(delta < 0){
            restorations.push({ barcode: bc, sku:origItem.n, n:origItem.n, qty:-delta, q:-delta,
              unitCostPaisa: _resolveCostPaisa(origItem, bc) });
          } else if(delta > 0){
            deductions.push({ barcode: bc, sku:origItem.n, n:origItem.n, qty:delta, q:delta,
              unitCostPaisa: _resolveCostPaisa(origItem, bc) });
          }
        });

        newItems.forEach(function(newItem){
          var bc  = _resolveBC(newItem);
          var bcL = (bc || '').toLowerCase();
          var isNew = !(origInv.items || []).some(function(oi){ return (_resolveBC(oi)||'').toLowerCase() === bcL; });
          if(isNew && (newItem.q || 0) > 0 && bc){
            deductions.push({ barcode: bc, sku:newItem.n, n:newItem.n, qty:newItem.q, q:newItem.q,
              unitCostPaisa: _resolveCostPaisa(newItem, bc) });
          }
        });

        return { restorations: restorations, deductions: deductions };
      },

      updateCustomerLedger: function(customerId, invoiceId, invoiceTotal, date){
        if(!customerId || customerId === 'Walk-in Customer') return Promise.resolve(_ok());
        var entry = _Ledger.createInvoiceEntry(String(customerId), invoiceId, invoiceTotal, date);
        var isBackdated = date && date < _today();
        var snap = _snapshot('customerLedger');
        State().update(function(s){
          s.data.customerLedger = (s.data.customerLedger || []).concat([entry]);
        }, 'ledger:invoice:' + invoiceId);
        return Storage().save('customerLedger', _gs().data.customerLedger).then(function(res){
          if(isBackdated){ _Ledger.recalculate(String(customerId)); }
          return res;
        }).catch(function(e){
          if(window.DEBUG_MODE) console.error('[updateCustomerLedger]', e);
          return _fail((e && e.message) || 'updateCustomerLedger failed unexpectedly');
        });
      }
    },

    estimate: {
      buildEstimate: function(formData){
        var items = (formData.items || []).filter(function(r){ return r.n && r.n.trim(); })
          .map(function(r){ return { n:r.n.trim(), q:r.q||1, p:r.p||0, d:0, taxAmt:0 }; });
        if(!items.length) return _fail('Add items');
        var id = _nextId(Svc.est.getAll(), 'EST-');
        var validTill = formData.validTill;
        if (!validTill && ERP.DateUtils && typeof ERP.DateUtils.addDays === 'function') {
          validTill = ERP.DateUtils.addDays(_today(), 30);
        } else if (!validTill) {
          var d = new Date(); d.setDate(d.getDate() + 30);
          validTill = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
        }
        return _ok({
          est: {
            id:        id,
            customer:  (formData.customer || '').trim(),
            customerId: formData.customerId || '',
            ph:        formData.phone || '',
            date:      formData.date || _today(),
            validTill: validTill,
            notes:     formData.notes || '',
            items:     items,
            grand:     _totals(items).grand,
            status:    'pending',
            opKey:     id + '@est@' + Date.now(),
            createdAt: _now()
          }
        });
      },
      convertToInvoice: function(estId){
        var est = Svc.est.getAll().find(function(e){ return e.id === estId; });
        if(!est) return _fail('Estimate not found');
        var id  = _nextId(Svc.sales.getAll(), _invPrefix());
        var convItems = _applyDefaultTaxToItems(_deepClone(est.items || []));
        if (!convItems) return _fail('Cannot convert estimate to invoice: tax engine is not loaded, refusing to create an untaxed invoice.');
        return _ok({
          inv: {
            id:        id,
            _v:        1,
            opKey:     id + '@est:convert@' + Date.now(),
            customer:  est.customer,
            customerId: est.customerId || '',
            ph:        est.ph || '',
            veh:       '',
            notes:     'From Estimate ' + estId,
            items:     convItems,
            grand:     _totals(convItems).grand,
            pay:       'Credit',
            paid:      0,
            date:      _today(),
            deleted:   false,
            status:    'unpaid'
          },
          estId: estId
        });
      }
    },

    saleOrder: {
      buildSO: function(formData){
        var items = (formData.items || []).filter(function(r){ return r.n && r.n.trim(); })
          .map(function(r){ return { n:r.n.trim(), q:r.q||1, p:r.p||0, d:0, taxAmt:0 }; });
        if(!items.length) return _fail('Add items');
        var soId = _nextId(Svc.so.getAll(), 'SO-');
        return _ok({
          so: {
            id:        soId,
            customer:  (formData.customer || '').trim(),
            customerId: formData.customerId || '',
            date:      formData.date || _today(),
            notes:     formData.notes || '',
            items:     items,
            grand:     _totals(items).grand,
            status:    'pending',
            opKey:     soId + '@so@' + Date.now(),
            createdAt: _now()
          }
        });
      },
      fulfill: function(soId){
        var so = Svc.so.getAll().find(function(o){ return o.id === soId; });
        if(!so) return _fail('Sale order not found');
        // FIX (duplicate-invoice bug): fulfill() never checked whether the
        // SO had already been converted. Combined with no in-progress lock
        // in the controller, a double-click (or a slow first call) could
        // fulfil the same Sale Order twice, creating two invoices and
        // deducting stock twice for one order.
        if (so.status === 'fulfilled' || so.converted)
          return _fail('Sale Order ' + soId + ' has already been fulfilled.');
        var stockErrors = _checkStock(so.items || [], {});
        if(!stockErrors.bypass && stockErrors.errors && stockErrors.errors.length)
          return _fail('Insufficient stock:\n' + stockErrors.errors.map(function(e){ return e.message; }).join('\n'));
        var soItems = _deepClone(so.items || []);
        var soInvId = _nextId(Svc.sales.getAll(), _invPrefix());
        var inv = {
          id:      soInvId,
          _v:      1,
          opKey:   soInvId + '@so:fulfill@' + Date.now(),
          customer:so.customer,
          customerId: so.customerId || '',
          ph:      so.phone || so.ph || '',
          veh:     '',
          notes:   'From Sale Order ' + soId,
          items:   soItems,
          grand:   _totals(soItems).grand,
          pay:     'Credit',
          paid:    0,
          date:    _today(),
          deleted: false,
          status:  'unpaid'
        };
        var _soDeductItems = _resolveStockEntries(so.items || []);
        return _ok({ inv:inv, soId:soId, deductItems: _soDeductItems });
      }
    },

    payIn: {
      buildPayment: function(formData){
        if(!(formData.party || '').trim()) return _fail('Party name required');
        var amt = parseFloat(formData.amount);
        if(isNaN(amt) || amt <= 0) return _fail('Enter valid amount');
        var customers = _gs().data.customers || [];
        var custNm = (formData.party || '').trim().toLowerCase();
        var cust = customers.find(function(c){ return (c.n || c.name || '').toLowerCase() === custNm; });
        var custId = cust ? String(cust.id || cust.n || '') : formData.party;
        var amountP = Math.round(amt * 100);
        return _ok({
          pi: {
            id:               _nextId(Svc.payin.getAll(), 'PI-'),
            _v:               1,
            party:            (formData.party || '').trim(),
            customerId:       custId,
            amount:           amountP / 100,
            mode:             formData.mode || 'Cash',
            date:             formData.date || _today(),
            against:          formData.against || '',
            notes:            formData.notes || '',
            opKey:            (formData.against || formData.party || '') + '@pi@' + Date.now(),
            unallocatedAmount:amountP / 100,
            voided:           false,
            createdAt:        _now()
          }
        });
      },

      applyToInvoice: function(customerName, paymentId, amount, date){
        var result = _Allocator.allocateFIFO(customerName, amount, paymentId, date);
        return _ok({
          allocations:     result.allocations,
          updatedInvoices: result.updatedInvoices,
          unallocated:     result.unallocated
        });
      },

      voidPayment: function(paymentId, tx){
        return Svc.payin.voidPayment(paymentId, tx);
      }
    },

    challan: {
      buildChallan: function(formData){
        var items = (formData.items || []).filter(function(r){ return r.n && r.n.trim(); })
          .map(function(r){ return { n:r.n.trim(), q:r.q||1 }; });
        if(!items.length) return _fail('Add items');
        var dcId = _nextId(Svc.dc.getAll(), 'DC-');
        return _ok({
          dc: {
            id:        dcId,
            customer:  (formData.customer || '').trim(),
            customerId: formData.customerId || '',
            date:      formData.date || _today(),
            addr:      formData.addr || '',
            notes:     formData.notes || '',
            items:     items,
            converted: false,
            opKey:     dcId + '@dc@' + Date.now(),
            createdAt: _now()
          }
        });
      },
      convertToInvoice: function(dcId){
        var c = Svc.dc.getAll().find(function(x){ return x.id === dcId; });
        if(!c) return _fail('Challan not found');
        var parts   = State().getParts();
        var noPrice = [];
        var rawItems = (c.items || []).map(function(i){
          var part  = parts.find(function(p){ return p.n === i.n; });
          var price = (part && (part.sp || part.price || part.sellingPrice)) || 0;
          if(price === 0) noPrice.push(i.n);
          return { n:i.n, q:i.q, p:price, d:0, taxAmt:0 };
        });
        var items = _applyDefaultTaxToItems(rawItems);
        if (!items) return _fail('Cannot convert challan to invoice: tax engine is not loaded, refusing to create an untaxed invoice.');
        var challanInvId = _nextId(Svc.sales.getAll(), _invPrefix());
        var inv = {
          id:      challanInvId,
          _v:      1,
          opKey:   challanInvId + '@dc:convert@' + Date.now(),
          customer:c.customer,
          customerId: c.customerId || '',
          ph:      c.ph || '',
          veh:     '',
          addr:    c.addr || '',
          notes:   'From Challan ' + dcId + (c.addr ? '\nDelivery: ' + c.addr : ''),
          items:   items,
          grand:   _totals(items).grand,
          pay:     'Credit',
          paid:    0,
          date:    _today(),
          deleted: false,
          status:  'unpaid'
        };
        return _ok({ inv:inv, dcId:dcId, noPriceItems:noPrice });
      }
    },

    saleReturn: {
      buildReturn: function(invoiceId, formData){
        var s = Svc.sales.getAll().find(function(x){ return x.id === invoiceId && !x.deleted; });
        if(!s) return _fail('Invoice not found');

        var returnItems = formData.returnItems || [];
        if(!returnItems.length) return _fail('Please select at least one item to return');

        var prevReturns = Svc.ret.getAll().filter(function(r){ return r.originalInv === invoiceId && !r.voided && !r.cancelled; });
        var alreadyReturnedQty = {};
        prevReturns.forEach(function(r){
          (r.items || []).forEach(function(ri){
            var key = ri.bc || ri.barcode || ri.sku || (ri.n || '').toLowerCase();
            alreadyReturnedQty[key] = (alreadyReturnedQty[key] || 0) + (ri.q || 0);
          });
        });

        var origItems = s.items || [];
        var allItemsFullyReturned = true;
        var validatedItems = [];
        for(var ri = 0; ri < returnItems.length; ri++){
          var rItem = returnItems[ri];
          if(!rItem.q || rItem.q <= 0) continue;
          var _rbc = rItem.bc || rItem.barcode || rItem.sku || '';
          var origItem = _rbc
            ? (origItems.find(function(x){ return (x.bc||x.barcode||x.sku||'') === _rbc; }) || origItems.find(function(x){ return x.n === rItem.n; }))
            : origItems.find(function(x){ return x.n === rItem.n; });
          if(!origItem) return _fail('Item "' + rItem.n + '" not found in original invoice');
          var key = rItem.bc || rItem.barcode || rItem.sku || (rItem.n || '').toLowerCase();
          var alreadyRet   = alreadyReturnedQty[key] || 0;
          var maxReturnable = origItem.q - alreadyRet;
          if(maxReturnable <= 0) return _fail('"' + rItem.n + '" already fully returned (' + alreadyRet + '/' + origItem.q + ')');
          if(rItem.q > maxReturnable) return _fail('Return qty for "' + rItem.n + '" exceeds returnable qty (' + maxReturnable + ' remaining)');
          var _scaleFactor = origItem.q > 0 ? rItem.q / origItem.q : 1;
          validatedItems.push(Object.assign({}, origItem, {
            q:      rItem.q,
            d:      Math.round((origItem.d      || 0) * _scaleFactor * 100) / 100,
            taxAmt: Math.round((origItem.taxAmt || 0) * _scaleFactor * 100) / 100
          }));
        }
        if(!validatedItems.length) return _fail('Please enter a return quantity greater than 0');

        var grandResult  = _totals(s.items || []);
        var grandP       = s.roundOff ? Math.round(grandResult.grand) * 100 : grandResult.grandPaisa;
        var retResult    = _totals(validatedItems);
        var returnGrandP = retResult.grandPaisa;
        var returnGrand  = returnGrandP / 100;

        var prevReturnedAmt = prevReturns.reduce(function(sum, r){ return sum + Math.round((r.returnGrand||r.amount||0)*100); }, 0);
        if (prevReturnedAmt + returnGrandP > grandP + 1) { 
          return _fail('Returns exceed invoice total! Invoice: ' + ERP.fmt(grandP/100) + ', Already returned: ' + ERP.fmt(prevReturnedAmt/100) + ', This return: ' + ERP.fmt(returnGrand));
        }

        var keptValueP   = grandP - returnGrandP;
        var paidP        = Math.round((s.paid || 0) * 100);
        var rawRefundP   = paidP - keptValueP;
        var refundAmtP   = Math.min(Math.max(rawRefundP, 0), returnGrandP);
        var refundAmount = refundAmtP / 100;

        origItems.forEach(function(oi){
          var k = (oi.bc || oi.barcode || oi.sku || (oi.n || '').toLowerCase());
          var prevRet = alreadyReturnedQty[k] || 0;
          var vi = validatedItems.find(function(x){ return x.n === oi.n; });
          var thisRet = vi ? (vi.q || 0) : 0;
          if (Math.round((prevRet + thisRet) * 1000) < Math.round(oi.q * 1000)) {
            allItemsFullyReturned = false;
          }
        });

        var ret = {
          id:          _nextId(Svc.ret.getAll(), 'CN-'),
          _v:          1,
          opKey:       invoiceId + '@return@' + Date.now(),
          customer:    s.customer || s.cust || '',
          customerId:  s.customerId || '',
          originalInv: invoiceId,
          date:        _today(),
          items:       _deepClone(validatedItems),
          amount:      refundAmount,
          returnGrand: returnGrand,
          cashPaidOut: Math.min(Math.max(0, formData.cashPaidOut || refundAmount), returnGrand),
          reason:      formData.reason || '',
          mode:        formData.mode || 'Cash Refund',
          partial:     !allItemsFullyReturned
        };

        return _ok({
          ret:          ret,
          amount:       refundAmount,
          returnGrand:  returnGrand,
          customer:     s.customer,
          allReturned:  allItemsFullyReturned,
          restoreItems: _resolveStockEntries(validatedItems.map(function(i){
            return { n: i.n, q: i.q, barcode: i.barcode || i.bc || i.sku || '', unitCostPaisa: i.unitCostPaisa || Math.round((i.pp||i.cp||0)*100) };
          }))
        });
      }
    },

    waText: function(inv){
      var totals = _totals(inv.items || []);
      var paid   = inv.paid || 0;
      var bal    = Math.max(0, totals.grand - paid);
      var bz     = State().getBiz();
      var fmt    = ERP._salesFmt || function(n){ return 'Rs '+(n||0); };
      var rows   = (inv.items || []).map(function(i, n){
        var lineP = Math.round(((i.q||0)*(i.p||0)*100) - ((i.d||0)*100)) / 100;
        return (n+1) + '. *' + (i.n||'') + '* — ' + (i.q||0) + ' x ' + fmt(i.p||0) +
               ' = *' + fmt(lineP) + '*' +
               (i.taxAmt ? ' (Tax: ' + fmt(i.taxAmt) + ')' : '');
      }).join('\n');
      return '🔧 *' + (bz.name||'') + '*\n*Invoice: ' + (inv.id||'') + '* | ' + (inv.date||'') +
        '\n👤 *' + (inv.customer||'Walk-in') + '*' + (inv.ph ? '\n📞 ' + inv.ph : '') +
        '\n─────────────\n' + rows + '\n─────────────\n' +
        (totals.disc > 0 ? 'Discount: -' + fmt(totals.disc) + '\n' : '') +
        (totals.tax  > 0 ? 'Tax: '       + fmt(totals.tax)  + '\n' : '') +
        '💰 *Total: ' + fmt(totals.grand) + '*\n' +
        (paid > 0 ? '✅ Paid: '     + fmt(paid) + '\n' : '') +
        (bal  > 0 ? '⚠️ *Balance: ' + fmt(bal)  + '*\n' : '') +
        '📍 ' + (bz.addr||'') + '\n📞 ' + (bz.phone||'');
    },

    _totals:    _totals,
    _numWords:  _numWords,
    _nextId:    _nextId,
    _checkStock:_checkStock,
    inventory:  InventorySvc,

    customerPayOut: {
      getAll: function(){ return (_gs().data.customerPayOut || []).filter(function(x){ return !x._deleted; }); },
      add: function(record){
        if(record.id){
          var exists = (_gs().data.customerPayOut||[]).find(function(x){ return x.id === record.id; });
          if(exists){ return _persist('customerPayOut', null); }
        }
        var snap = _snapshot('customerPayOut');
        State().update(function(s){ s.data.customerPayOut = [record].concat(s.data.customerPayOut || []); }, 'cpo:add');
        return _persist('customerPayOut', snap);
      },
      update: function(id, patch){
        var snap = _snapshot('customerPayOut');
        _st(function(s){
          var arr = s.data.customerPayOut || [];
          var idx = arr.findIndex(function(x){ return x.id === id; });
          if(idx >= 0) arr[idx] = Object.assign({}, arr[idx], patch, { updatedAt: _now() });
        }, 'cpo:update:' + id);
        return _persist('customerPayOut', snap);
      },
      getById: function(id){ return (_gs().data.customerPayOut||[]).find(function(x){ return x.id === id; }) || null; }
    }
  };

  var _bootstrapAttempted = false;
  function _checkBootstrap(){
    if(_bootstrapAttempted) return;
    _bootstrapAttempted = true;
    var sales = _gs().data.sales;
    if(Array.isArray(sales) && sales.length > 0) return;
    Storage().recoverFromIDB('sales')
      .then(function(res){
        if(res.success && Array.isArray(res.data) && res.data.length > 0){
          _st(function(s){ s.data.sales = res.data; }, 'bootstrap:recover:sales');
          setTimeout(function(){
            try{ if(ERP._salesUI && ERP._salesUI.sales) ERP._salesUI.sales.render(); }
            catch(e){ if(window.DEBUG_MODE) console.error(e); }
          }, 50);
        }
      }).catch(function(e){ if(window.DEBUG_MODE) console.error('[_checkBootstrap] IDB recovery failed:', e && e.message || e); });
  }

  if(ERP.BootIntegrityCheck) ERP.BootIntegrityCheck.register(_checkBootstrap);
  else _checkBootstrap();

  if(ERP.BootIntegrityCheck) ERP.BootIntegrityCheck.register(function(){ try{ _reconciliationCheck(); } catch(e){ if(window.DEBUG_MODE) console.error(e); } });
  else { try{ _reconciliationCheck(); } catch(e){ if(window.DEBUG_MODE) console.error(e); } }

  ERP._svc          = Svc;
  ERP._salesSvc     = Svc;
  ERP._salesToday   = _today;
  ERP._Ledger       = _Ledger;
  ERP._Allocator    = _Allocator;
  ERP._atomicSave   = _atomicSave;
  ERP._walWrite     = _walWrite;
  ERP._walUpdate    = _walUpdate;
  ERP._calcCustomerOutstanding = _calcCustomerOutstanding;
  ERP._reconciliationCheck     = _reconciliationCheck;

  ERP._services                  = ERP._services || {};
  ERP._services.sales            = Svc.sales;
  ERP._services.estimates        = Svc.est;
  ERP._services.saleOrders       = Svc.so;
  ERP._services.payIn            = Svc.payin;
  ERP._services.deliveryChallans = Svc.dc;
  ERP._services.saleReturns      = Svc.ret;
  ERP._services.customerPayOut   = Svc.customerPayOut;

  ERP.inventory = ERP.inventory || {};
  ERP.inventory.deductStock = function() {
    return ERP.InventoryService ? ERP.InventoryService.deduct.apply(ERP.InventoryService, arguments) : Promise.resolve();
  };

  // Reconciles the 'erp_gl_pending_sales' queue (written on every sale add as
  // a safety-net marker in case the sales:added event never gets picked up
  // by a GL-posting listener). Previously nothing ever read this queue back,
  // so an entry that was still genuinely pending at write-time stayed in
  // localStorage forever, un-rechecked, until a manual settings reset wiped
  // it. Called from ERP.WALRecovery.run() on boot alongside the main WAL sweep.
  Svc.recoverPendingGLPostings = function () {
    var _walKey = 'erp_gl_pending_sales';
    var result = { checked: 0, recovered: 0, retried: 0, dropped: 0 };
    try {
      var _walQ = [];
      try { _walQ = JSON.parse(localStorage.getItem(_walKey) || '[]'); } catch (_) { _walQ = []; }
      if (!_walQ.length) return result;
      result.checked = _walQ.length;

      var pe    = (typeof window !== 'undefined' && window.ERP) ? ERP.PostingEngine : null;
      var sales = (_gs().data.sales || []);
      var remaining = [];

      _walQ.forEach(function (entry) {
        if (!entry || !entry.id) return;

        var fullyPosted = pe && typeof pe.isPosted === 'function' &&
          pe.isPosted('SALE-REV-' + entry.id) && pe.isPosted('SALE-COGS-' + entry.id);
        if (fullyPosted) { result.recovered++; return; }

        var sale = sales.find(function (s) { return s.id === entry.id; });
        if (!sale) { result.dropped++; return; }

        if (ERP.SalesPostingLock && typeof ERP.SalesPostingLock.postSale === 'function') {
          try { ERP.SalesPostingLock.postSale(sale); result.retried++; } catch (_e) {}
        }
        remaining.push(entry);
      });

      try { localStorage.setItem(_walKey, JSON.stringify(remaining)); } catch (_) {}
    } catch (e) {
      if (window.DEBUG_MODE) console.error('[SalesService.recoverPendingGLPostings]', e);
    }
    return result;
  };

  ERP.SalesService = Svc;

})(window.ERP = window.ERP || {});
