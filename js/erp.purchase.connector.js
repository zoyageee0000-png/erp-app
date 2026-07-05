
(function (root) {
  'use strict';

  var ERP = root.ERP = root.ERP || {};
  if (ERP.PurchaseConnector && ERP.PurchaseConnector.__phase5) return;

  function _try(fn, fallback, tag) {
    try { return fn(); }
    catch (e) {
      if (root.DEBUG_MODE || root._mhDebug)
        console.warn('[ERP.PurchaseConnector][' + (tag || '?') + ']', e);
      return (typeof fallback === 'function') ? fallback(e) : fallback;
    }
  }

  function _num(v, def) {
    var n = parseFloat(v);
    return (isNaN(n) || !isFinite(n)) ? (def !== undefined ? def : 0) : n;
  }

  function _today() {
    return ERP.DateUtils ? ERP.DateUtils.today() : (function(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })();
  }

  // Single source of truth: delegates to ACC.Money (accounting_constants.js).
  // The previous local version used parseFloat() directly on the raw value,
  // which breaks on comma-formatted strings like "1,234.50" (parseFloat stops
  // at the comma) and doesn't handle parentheses-negative notation.
  // Guard moved from module-load-time to call-time: a load-time throw here
  // would crash this entire file (and everything after it in the script
  // order) if it were ever loaded before accounting_constants.js, instead
  // of failing only the one operation that actually needed money parsing.
  function _accMoney() {
    var ACC = root.AccountingCore;
    if (!ACC || !ACC.Money) throw new Error('[ERP.PurchaseConnector] ACC.Money missing. Load accounting_constants.js first.');
    return ACC;
  }
  function _toPaisa(rupees) {
    return _accMoney().Money.toPaisa(rupees);
  }

  function _lc(s) { return (s || '').toLowerCase().trim(); }

  function _logger() {
    return (ERP.Logger) || (root.Logger) || { info: function() {}, warn: function() {}, error: function() {} };
  }

  function _ledger() {
    return (ERP.Ledger && ERP.Ledger.__phase2) ? ERP.Ledger : null;
  }

  function _accCore() {
    return root.AccountingCore || null;
  }

  function _SA() {
    var a = root.AccountingCore || null;
    return a ? a.SYSTEM_ACCOUNTS : null;
  }

  function _ps() {
    return root.PurchaseState || null;
  }

  function _accInitialized() {
    var ACC = _accCore();
    if (!ACC) return false;
    if (ACC.AccountingState && typeof ACC.AccountingState.isInitialized === 'function') {
      if (!ACC.AccountingState.isInitialized()) {
        try { ACC.AccountingState.initialize(); } catch(_) {}
      }
      return ACC.AccountingState.isInitialized();
    }
    return !!ACC.JournalService;
  }

  var _postedSourceIds = null;
  var _postedIndexBuilt = false;

  function _buildPostedIndex() {
    if (_postedIndexBuilt) return;
    _postedIndexBuilt = true;
    _postedSourceIds = new Set();
    _try(function () {
      var ACC = _accCore();
      if (!ACC || !ACC.AccountingState) return;
      if (typeof ACC.AccountingState.getAllJournals !== 'function') return;
      var journals = ACC.AccountingState.getAllJournals();
      if (!Array.isArray(journals)) return;
      for (var i = 0; i < journals.length; i++) {
        var j = journals[i];
        if (j && j.documentId) _postedSourceIds.add(j.documentId);
      }
    }, null, '_buildPostedIndex');
  }

  function _markPosted(sourceId) {
    if (_postedSourceIds) _postedSourceIds.add(sourceId);
  }

  function _hasAnyPrefix(sourceId) {
    return sourceId.indexOf('P5-') === 0 || sourceId.indexOf('STOCK-RCV-') === 0 ||
           sourceId.indexOf('VL-BILL-') === 0 || sourceId.indexOf('VL-VPMT-') === 0;
  }

  function _alreadyPosted(sourceId) {
    return _try(function () {
      var ACC = _accCore();
      if (!ACC || !ACC.AccountingState) return false;
      var hasPrefix = _hasAnyPrefix(sourceId);

      _buildPostedIndex();
      if (typeof ACC.AccountingState.getAllJournals === 'function') {
        if (_postedSourceIds.has(sourceId)) return true;
        if (!hasPrefix) {
          if (_postedSourceIds.has('P5-STOCK-RCV-' + sourceId)) return true;
          if (_postedSourceIds.has('P5-VL-BILL-'   + sourceId)) return true;
          if (_postedSourceIds.has('P5-VL-VPMT-'   + sourceId)) return true;
          if (_postedSourceIds.has('STOCK-RCV-' + sourceId)) return true;
          if (_postedSourceIds.has('VL-BILL-'   + sourceId)) return true;
          if (_postedSourceIds.has('VL-VPMT-'   + sourceId)) return true;
        }
        return false;
      }

      var exists = ACC.AccountingState.journalExistsForSource;
      if (typeof exists !== 'function') return false;
      if (exists.call(ACC.AccountingState, sourceId)) return true;
      if (!hasPrefix) {
        if (exists.call(ACC.AccountingState, 'P5-STOCK-RCV-' + sourceId)) return true;
        if (exists.call(ACC.AccountingState, 'P5-VL-BILL-'   + sourceId)) return true;
        if (exists.call(ACC.AccountingState, 'P5-VL-VPMT-'   + sourceId)) return true;
        if (exists.call(ACC.AccountingState, 'STOCK-RCV-' + sourceId)) return true;
        if (exists.call(ACC.AccountingState, 'VL-BILL-'   + sourceId)) return true;
        if (exists.call(ACC.AccountingState, 'VL-VPMT-'   + sourceId)) return true;
      }
      return false;
    }, false, '_alreadyPosted');
  }

  var _postedPOIds      = Object.create(null);
  var _postedBillIds    = Object.create(null);
  var _postedPaymentIds = Object.create(null);

  function _postPOReceiveJournals(po, actor) {
    if (!po || !po.id) return;

    var poId = po.id;

    if (_postedPOIds[poId]) {
      _logger().info('[ERP.PurchaseConnector._postPOReceiveJournals] already posted (session):', poId);
      return;
    }

    var stockKey = 'P5-STOCK-RCV-' + poId;

    if (_alreadyPosted(stockKey)) {
      _postedPOIds[poId] = true;
      _logger().info('[ERP.PurchaseConnector._postPOReceiveJournals] already posted (GL):', poId);
      return;
    }

    if (!_accInitialized()) {
      _logger().warn('[ERP.PurchaseConnector._postPOReceiveJournals] AccountingCore not ready, skipping:', poId);
      return;
    }

    var ledger = _ledger();
    if (!ledger) {
      _logger().warn('[ERP.PurchaseConnector._postPOReceiveJournals] ERP.Ledger not ready, skipping:', poId);
      return;
    }

    var supName    = po.supplierName || po.sup || po.supplier || '';
    var poTotal    = _num(po.total || po.amt || 0, 0);
    var poTax      = _num(po.tax   || po.gst  || 0, 0);
    var totalPaisa = _toPaisa(poTotal);
    var taxPaisa   = Math.min(_toPaisa(poTax), totalPaisa);
    var netPaisa   = totalPaisa - taxPaisa;
    var poDate     = po.receivedAt || po.date || _today();

    if (totalPaisa <= 0) {
      _logger().warn('[ERP.PurchaseConnector._postPOReceiveJournals] Zero-value PO, skipping GL post:', poId);
      _postedPOIds[poId] = true;
      return;
    }

    _postedPOIds[poId] = true;

    function _doStockPost() {
      if (!_alreadyPosted(stockKey)) {
        _try(function () {
          var sa = _SA();
          if (taxPaisa > 0 && sa) {
            ERP.PostingEngine.post({
              documentId:   stockKey,
              documentType: 'purchase',
              sourceModule: 'purchase',
              date:         poDate,
              reference:    poId,
              memo:         'PO received: ' + supName + ' — ' + poId,
              actor:        actor || 'system',
              entries: [
                { accountId: sa.INVENTORY    || 'acc-1200', debit: netPaisa,   credit: 0,          description: 'Inventory received (net)' },
                { accountId: sa.GST_RECEIVABLE || 'acc-1300', debit: taxPaisa, credit: 0,          description: 'GST input tax recoverable' },
                { accountId: sa.AP           || 'acc-2001', debit: 0,          credit: totalPaisa, description: 'Stock receipt AP payable' },
              ]
            }).then(function () {
              _markPosted(stockKey);
              _logger().info('[ERP.PurchaseConnector] Stock receipt (GST split) posted:', { poId: poId, netPaisa: netPaisa, taxPaisa: taxPaisa });
            }).catch(function (e) {
              _logger().warn('[ERP.PurchaseConnector] Stock receipt (GST split) failed:', e && e.message);
            });
          } else {
            ledger.StockLedger.postStockReceipt({
              sourceId:    poId,
              date:        poDate,
              reference:   poId,
              amountPaisa: totalPaisa,
              memo:        'PO received: ' + supName + ' — ' + poId,
              cash:        false
            }, actor || 'system').then(function () {
              _markPosted(stockKey);
              _logger().info('[ERP.PurchaseConnector] Stock receipt journal posted:', { poId: poId, totalPaisa: totalPaisa });
            }).catch(function (e) {
              _logger().warn('[ERP.PurchaseConnector] StockLedger.postStockReceipt failed:', e && e.message);
            });
          }
        }, null, '_postPOReceiveJournals.stock');
      }
    }

    var cg = ERP.ConcurrencyGuard;
    if (cg && typeof cg.acquireLock === 'function') {
      _try(function () {
        cg.acquireLock('po_receive:' + poId).then(function (lockResult) {
          if (!lockResult.acquired) {
            _logger().warn('[ERP.PurchaseConnector] Could not acquire write-lock for PO ' +
              poId + ' — reason: ' + (lockResult.error || 'unknown') +
              '. Skipping stock receipt post.');
            delete _postedPOIds[poId];
            return;
          }
          try {
            _doStockPost();
          } finally {
            _try(function () { cg.releaseLock(lockResult.lockId); },
                 null, '_postPOReceiveJournals.releaseLock');
          }
        }).catch(function (e) {
          _logger().warn('[ERP.PurchaseConnector] acquireLock rejected (' +
            (e && e.message || e) + ') — falling back to unlocked post.');
          _doStockPost();
        });
      }, function () {
        _doStockPost();
      }, '_postPOReceiveJournals.acquireLock');
    } else {
      _doStockPost();
    }
  }

  function _postPurchaseBillJournals(purchase, actor) {
    if (!purchase || !purchase.id) return;

    var billId = purchase.id;

    if (_postedBillIds[billId]) {
      _logger().info('[ERP.PurchaseConnector._postPurchaseBillJournals] already posted (session):', billId);
      return;
    }

    // Cross-check against the OTHER posting path (purchase_services.js pmSave(), which
    // posts directly with documentId = billId, not the 'P5-STOCK-BILL-' prefixed key
    // this module uses). Without this check, a bill that pmSave already posted could get
    // posted a second time here under a different documentId, since PostingEngine's
    // duplicate guard only catches exact documentId matches.
    if (purchase._glDocId ||
        (root.ERP && ERP.PostingEngine && typeof ERP.PostingEngine.isPosted === 'function' && ERP.PostingEngine.isPosted(billId))) {
      _postedBillIds[billId] = true;
      return;
    }

    var stockKey = 'P5-STOCK-BILL-' + billId;

    if (_alreadyPosted(stockKey)) {
      _postedBillIds[billId] = true;
      return;
    }

    if (!_accInitialized()) {
      _logger().warn('[ERP.PurchaseConnector._postPurchaseBillJournals] AccountingCore not ready, skipping:', billId);
      return;
    }

    var supName    = purchase.supplierName || purchase.sup || purchase.supplier || '';
    var poTotal    = _num(purchase.total || purchase.grand || purchase.amt || 0, 0);
    var poTax      = _num(purchase.tax   || purchase.gst  || purchase.taxAmt || 0, 0);
    var totalPaisa = _toPaisa(poTotal);
    var taxPaisa   = Math.min(_toPaisa(poTax), totalPaisa);
    var netPaisa   = totalPaisa - taxPaisa;
    var billDate   = purchase.date || _today();

    if (totalPaisa <= 0) {
      _postedBillIds[billId] = true;
      return;
    }

    _postedBillIds[billId] = true;

    _try(function () {
      var sa = _SA();
      var hasLinkedPO = !!(purchase.poId || purchase.po_id || purchase.purchaseOrderId);
      var entries = [];
      if (!hasLinkedPO) {
        entries.push({ accountId: (sa && sa.INVENTORY) || 'acc-1200', debit: netPaisa, credit: 0, description: 'Inventory received (net) — direct bill' });
        if (taxPaisa > 0) {
          entries.push({ accountId: (sa && sa.GST_RECEIVABLE) || 'acc-1300', debit: taxPaisa, credit: 0, description: 'GST input tax recoverable' });
        }
      } else {
        var clearingAcct = (sa && sa.PURCHASE_CLEARING) || (sa && sa.INVENTORY) || 'acc-1200';
        entries.push({ accountId: clearingAcct, debit: netPaisa, credit: 0, description: 'PO bill recognition (clearing)' });
        if (taxPaisa > 0) {
          entries.push({ accountId: (sa && sa.GST_RECEIVABLE) || 'acc-1300', debit: taxPaisa, credit: 0, description: 'GST input tax recoverable' });
        }
      }
      entries.push({ accountId: (sa && sa.AP) || 'acc-2001', debit: 0, credit: totalPaisa, description: 'Vendor AP payable' });

      ERP.PostingEngine.post({
        documentId:   stockKey,
        documentType: 'purchase',
        sourceModule: 'purchase',
        date:         billDate,
        reference:    billId,
        memo:         'Purchase bill: ' + supName + ' — ' + billId,
        actor:        actor || 'system',
        entries:      entries
      }).then(function () {
        _markPosted(stockKey);
        _logger().info('[ERP.PurchaseConnector] Bill journal posted (single):', { billId: billId, totalPaisa: totalPaisa });
      }).catch(function (e) {
        _logger().warn('[ERP.PurchaseConnector] Bill journal post failed:', e && e.message);
      });
    }, null, '_postPurchaseBillJournals.post');
  }

  function _postVendorPaymentJournal(payment, actor) {
    if (!payment || !payment.id) return;

    var payId = payment.id;

    if (_postedPaymentIds[payId]) {
      _logger().info('[ERP.PurchaseConnector._postVendorPaymentJournal] already posted (session):', payId);
      return;
    }

    var pmtKey = 'P5-VL-VPMT-' + payId;

    if (_alreadyPosted(pmtKey)) {
      _postedPaymentIds[payId] = true;
      _logger().info('[ERP.PurchaseConnector._postVendorPaymentJournal] already posted (GL):', payId);
      return;
    }

    if (!_accInitialized()) {
      _logger().warn('[ERP.PurchaseConnector._postVendorPaymentJournal] AccountingCore not ready, skipping:', payId);
      return;
    }

    var ledger = _ledger();
    if (!ledger) {
      _logger().warn('[ERP.PurchaseConnector._postVendorPaymentJournal] ERP.Ledger not ready, skipping:', payId);
      return;
    }

    var supName     = payment.supplierName || payment.party || payment.sup || '';
    var amount      = _num(payment.amount || 0, 0);
    var amountPaisa = _toPaisa(amount);
    var payDate     = payment.date || _today();
    var method      = _lc(payment.method || payment.mode || 'cash');
    var useBank     = (method === 'bank' || method === 'bank transfer' || method === 'cheque' || method === 'upi');

    if (amountPaisa <= 0) {
      _logger().warn('[ERP.PurchaseConnector._postVendorPaymentJournal] Zero-amount payment, skipping:', payId);
      _postedPaymentIds[payId] = true;
      return;
    }

    _postedPaymentIds[payId] = true;

    function _doPaymentPost() {
      _try(function () {
        ledger.VendorLedger.postVendorPayment({
          sourceId:    pmtKey,
          date:        payDate,
          reference:   payment.reference || payId,
          party:       supName,
          amountPaisa: amountPaisa,
          bank:        useBank,
          memo:        'Payment to vendor: ' + supName +
                       ' | Method: ' + (payment.method || 'cash') +
                       ' | Ref: ' + (payment.reference || payId),
        }, actor || 'system').then(function () {
          _markPosted(pmtKey);
          _logger().info('[ERP.PurchaseConnector] Vendor payment journal posted:', {
            payId:       payId,
            amountPaisa: amountPaisa,
            bank:        useBank,
            party:       supName,
          });
        }).catch(function (e) {
          _logger().warn('[ERP.PurchaseConnector] VendorLedger.postVendorPayment failed:', e && e.message);
        });
      }, null, '_postVendorPaymentJournal');
    }

    var cg = ERP.ConcurrencyGuard;
    if (cg && typeof cg.acquireLock === 'function') {
      _try(function () {
        cg.acquireLock('vendor_pmt:' + payId).then(function (lockResult) {
          if (!lockResult.acquired) {
            _logger().warn('[ERP.PurchaseConnector] Could not acquire write-lock for payment ' +
              payId + ' — reason: ' + (lockResult.error || 'unknown') +
              '. Skipping vendor payment post.');
            delete _postedPaymentIds[payId];
            return;
          }
          try {
            _doPaymentPost();
          } finally {
            _try(function () { cg.releaseLock(lockResult.lockId); },
                 null, '_postVendorPaymentJournal.releaseLock');
          }
        }).catch(function (e) {
          _logger().warn('[ERP.PurchaseConnector] acquireLock rejected (' +
            (e && e.message || e) + ') — falling back to unlocked post.');
          _doPaymentPost();
        });
      }, function () {
        _doPaymentPost();
      }, '_postVendorPaymentJournal.acquireLock');
    } else {
      _doPaymentPost();
    }
  }

  var _deferredHooks = [];
  var _poHookFrozenSkip = false;
  var _poEventHookInstalled = false;
  var _hookRetryTimer = null;

  function _onPurchaseOrderReceivedEvent(e) {
    var po = e && e.detail && e.detail.po;
    if (!po) return;
    _try(function () { _postPOReceiveJournals(po, 'system'); }, null, '_onPurchaseOrderReceivedEvent');
  }

  function _deferHook(installFn, targetName) {
    _deferredHooks.push({ fn: installFn, name: targetName, attempts: 0 });
    if (!_hookRetryTimer) {
      _hookRetryTimer = ERP.TimerRegistry.start('purchaseConnector.hookRetry', function () {
        var remaining = [];
        for (var i = 0; i < _deferredHooks.length; i++) {
          var h = _deferredHooks[i];
          h.attempts++;
          var success = false;
          try { success = h.fn(); } catch (_) {}
          if (!success && h.attempts < 5) {
            remaining.push(h);
          } else if (!success) {
            if (h.name === 'PurchaseOrders.receive') {
              var _poExists = (typeof window !== 'undefined' && window.PurchaseOrders && typeof window.PurchaseOrders.receive === 'function');
              if (_poExists) {
                _logger().warn('[ERP.PurchaseConnector] Hook "' + h.name + '" failed after 5 attempts — giving up.');
              }
            } else {
              _logger().warn('[ERP.PurchaseConnector] Hook "' + h.name + '" failed after 5 attempts — giving up.');
            }
          }
        }
        _deferredHooks = remaining;
        if (_deferredHooks.length === 0 && _hookRetryTimer) {
          ERP.TimerRegistry.clear('purchaseConnector.hookRetry');
          _hookRetryTimer = null;
        }
      }, 250);
    }
  }

  function _installPurchaseOrdersHook() {
    return _try(function () {
      var PO = (typeof window !== 'undefined' && window.PurchaseOrders) ? window.PurchaseOrders : root.PurchaseOrders;
      if (!PO || typeof PO.receive !== 'function') return false;
      if (PO.receive._p5Hooked) return true;
      if (Object.isFrozen(PO)) {
        if (!_poEventHookInstalled) {
          document.addEventListener('purchase:po:received', _onPurchaseOrderReceivedEvent);
          _poEventHookInstalled = true;
          _logger().info('[ERP.PurchaseConnector] PurchaseOrders is frozen — subscribed to purchase:po:received for real-time GL posting.');
        }
        _poHookFrozenSkip = true;
        return true;
      }

      var _orig = PO.receive;
      PO.receive = function (id) {
        var PS = _ps();
        var poBefore = PS ? PS.getPOById(id) : null;
        var statusBefore = poBefore ? _lc((poBefore.status || poBefore.st) || '') : '';

        _orig.apply(this, arguments);

        _try(function () {
          var PS2 = _ps();
          var poAfter = PS2 ? PS2.getPOById(id) : null;
          if (!poAfter) return;
          var statusAfter = _lc((poAfter.status || poAfter.st) || '');
          if (statusAfter === 'received' && statusBefore !== 'received') {
            _postPOReceiveJournals(poAfter, 'system');
          }
        }, null, '_installPurchaseOrdersHook.postReceive');
      };
      PO.receive._p5Hooked = true;
      PO.receive._origFn = _orig;

      _logger().info('[ERP.PurchaseConnector] PurchaseOrders.receive hook installed.');
      return true;
    }, false, '_installPurchaseOrdersHook');
  }

  var _BACKFILL_STAMP_KEY  = 'erp_p5_backfill_ts';
  var _BACKFILL_RETRY_KEY  = 'erp_p5_retry_failed';

  function _getBackfillStamp() {
    try { return parseInt(localStorage.getItem(_BACKFILL_STAMP_KEY) || '0', 10) || 0; } catch (_) { return 0; }
  }

  function _setBackfillStamp() {
    try { localStorage.setItem(_BACKFILL_STAMP_KEY, String(Date.now())); } catch (_) {}
  }

  function _getRetryFailed() {
    try { return JSON.parse(localStorage.getItem(_BACKFILL_RETRY_KEY) || '[]'); } catch (_) { return []; }
  }

  function _addRetryFailed(id, type) {
    try {
      var list = _getRetryFailed();
      if (!list.find(function(r){ return r.id === id; })) {
        list.push({ id: id, type: type || 'bill', addedAt: Date.now() });
        localStorage.setItem(_BACKFILL_RETRY_KEY, JSON.stringify(list));
      }
    } catch (_) {}
  }

  function _removeRetryFailed(id) {
    try {
      var list = _getRetryFailed().filter(function(r){ return r.id !== id; });
      localStorage.setItem(_BACKFILL_RETRY_KEY, JSON.stringify(list));
    } catch (_) {}
  }

  function _isNewerThanStamp(record, stamp) {
    if (!stamp) return true;
    var ts = record._ts;
    if (ts === undefined || ts === null) ts = record.createdAt;
    if (ts === undefined || ts === null) ts = record.date;
    if (ts === undefined || ts === null || ts === '') return true;
    try {
      var t = typeof ts === 'number' ? ts : new Date(ts).getTime();
      return isNaN(t) ? true : t > stamp;
    } catch (_) { return true; }
  }

  function _backfillExisting() {
    setTimeout(function () {
      _try(function () {
        if (!_accInitialized() || !_ledger()) return;

        var PS = _ps();
        if (!PS) return;

        var stamp = _getBackfillStamp();
        var posted = 0;

        _try(function () {
          var allPOs = PS.getAllPurchaseOrders ? PS.getAllPurchaseOrders() : (root.purchaseOrders || []);
          allPOs.forEach(function (po) {
            if (!po || !po.id) return;
            var stockKey = 'P5-STOCK-RCV-' + po.id;
            var billKey  = 'P5-VL-BILL-'   + po.id;
            if (stamp && !_isNewerThanStamp(po, stamp) && _alreadyPosted(stockKey) && _alreadyPosted(billKey)) return;
            var status = _lc((po.status || po.st) || '');
            if ((status === 'received' || po.received) && !_postedPOIds[po.id]) {
              if (!_alreadyPosted(stockKey) || !_alreadyPosted(billKey)) {
                _postPOReceiveJournals(po, 'backfill');
                posted++;
              }
            }
          });
        }, null, '_backfillExisting.POs');

        _try(function () {
          var allPayments = PS.getAllPayments ? PS.getAllPayments() : (root.paymentOuts || []);
          allPayments.forEach(function (pmt) {
            if (!pmt || !pmt.id || pmt.voided) return;
            var pmtKey = 'P5-VL-VPMT-' + pmt.id;
            if (stamp && !_isNewerThanStamp(pmt, stamp) && _alreadyPosted(pmtKey)) return;
            if (!_postedPaymentIds[pmt.id] && !_alreadyPosted(pmtKey)) {
              _postVendorPaymentJournal(pmt, 'backfill');
              posted++;
            }
          });
        }, null, '_backfillExisting.payments');

        _setBackfillStamp();

        _try(function () {
          var retryList = _getRetryFailed();
          var PS3 = _ps();
          retryList.forEach(function (entry) {
            if (entry.type === 'bill' && PS3 && PS3.getAllPurchases) {
              var bill = PS3.getAllPurchases().find(function(b){ return b.id === entry.id; });
              if (bill && !_alreadyPosted('P5-STOCK-BILL-' + bill.id)) {
                _postPurchaseBillJournals(bill, 'backfill-retry');
                _removeRetryFailed(entry.id);
              }
            } else if (entry.type === 'payment' && PS3 && PS3.getAllPayments) {
              var pmt = PS3.getAllPayments().find(function(p){ return p.id === entry.id; });
              if (pmt && !_alreadyPosted('P5-VL-VPMT-' + pmt.id)) {
                _postVendorPaymentJournal(pmt, 'backfill-retry');
                _removeRetryFailed(entry.id);
              }
            }
          });
        }, null, '_backfillExisting.retryFailed');

        _logger().info('[ERP.PurchaseConnector] Backfill scan complete. Posted: ' + posted);

      }, null, '_backfillExisting');
    }, 1200);
  }

  function _init() {
    _try(function () {
      var hooks = [
        { fn: _installPurchaseOrdersHook, name: 'PurchaseOrders.receive' }
      ];

      for (var i = 0; i < hooks.length; i++) {
        var success = false;
        try { success = hooks[i].fn(); } catch (_) {}
        if (!success) {
          _deferHook(hooks[i].fn, hooks[i].name);
        }
      }

      var _poPollInterval = null;
      if (typeof window !== 'undefined' && !window.PurchaseOrders) {
        _poPollInterval = ERP.TimerRegistry.start('purchaseConnector.poPoll', function() {
          if (window.PurchaseOrders && typeof window.PurchaseOrders.receive === 'function') {
            ERP.TimerRegistry.clear('purchaseConnector.poPoll');
            _poPollInterval = null;
            try {
              if (_installPurchaseOrdersHook()) {
                _deferredHooks = _deferredHooks.filter(function(h) { return h.name !== 'PurchaseOrders.receive'; });
                _logger().info('[ERP.PurchaseConnector] PurchaseOrders hook installed via polling.');
              }
            } catch (_) {}
          }
        }, 250);
        setTimeout(function() {
          if (_poPollInterval) {
            ERP.TimerRegistry.clear('purchaseConnector.poPoll');
            _poPollInterval = null;
          }
        }, 10000);
      }

      try {
        document.addEventListener('purchaseorders:ready', function () {
          try { _installPurchaseOrdersHook(); } catch (_) {}
        });
        document.addEventListener('module:purchaseorders:ready', function () {
          try { _installPurchaseOrdersHook(); } catch (_) {}
        });
      } catch (_) {}

      _logger().info('[ERP.PurchaseConnector] Phase 5 initialized — Purchase → Accounting + Inventory wired.');
    }, null, '_init');
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(_init, 0);
    } else {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(_init, 0); });
    }
  } else {
    _init();
  }

  ERP.PurchaseConnector = {
    __phase5: true,

    postPOReceive: function (po) {
      if (!po || !po.id) {
        console.warn('[ERP.PurchaseConnector.postPOReceive] po object with id required.');
        return;
      }
      _postPOReceiveJournals(po, 'system');
    },

    postBill: function (bill) {
      if (!bill || !bill.id) {
        console.warn('[ERP.PurchaseConnector.postBill] bill object with id required.');
        return;
      }
      _postPurchaseBillJournals(bill, 'system');
    },

    postPayment: function (payment) {
      if (!payment || !payment.id) {
        console.warn('[ERP.PurchaseConnector.postPayment] payment object with id required.');
        return;
      }
      _postVendorPaymentJournal(payment, 'system');
    },

    isPosted: function (type, id) {
      if (type === 'po_receive') {
        return {
          stock:         _alreadyPosted('P5-STOCK-RCV-'  + id),
          vendorBill:    false,
          vendorPayment: false,
        };
      }
      if (type === 'bill') {
        return {
          stock:         _alreadyPosted('P5-STOCK-BILL-' + id),
          vendorBill:    _alreadyPosted('P5-VL-BILL-'    + id),
          vendorPayment: false,
        };
      }
      if (type === 'payment') {
        return {
          stock:         false,
          vendorBill:    false,
          vendorPayment: _alreadyPosted('P5-VL-VPMT-' + id),
        };
      }
      return { stock: false, vendorBill: false, vendorPayment: false };
    },

    backfill: function () {
      _backfillExisting();
    },

    resetCaches: function () {
      _postedSourceIds  = null;
      _postedIndexBuilt = false;
      var k;
      for (k in _postedPOIds)      delete _postedPOIds[k];
      for (k in _postedBillIds)    delete _postedBillIds[k];
      for (k in _postedPaymentIds) delete _postedPaymentIds[k];
    },

    _diagnostics: function () {
      return {
        postedPOs:      Object.keys(_postedPOIds).length,
        postedBills:    Object.keys(_postedBillIds).length,
        postedPayments: Object.keys(_postedPaymentIds).length,
        ledgerReady:    !!_ledger(),
        accReady:       _accInitialized(),
        psReady:        !!_ps(),
        poHookFrozenSkip: _poHookFrozenSkip,
      };
    },

    _addRetryFailed: function (id, type) {
      _addRetryFailed(id, type);
    },
  };

})(typeof window !== 'undefined' ? window : globalThis);
