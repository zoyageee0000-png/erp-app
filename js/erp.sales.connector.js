
'use strict';

(function (root) {
  'use strict';

  var ERP = root.ERP = root.ERP || {};

  if (ERP.SalesConnector && ERP.SalesConnector.__phase4) return;

  function _try(fn, fallback, tag) {
    try { return fn(); }
    catch (e) {
      if (root.DEBUG_MODE || root._mhDebug)
        console.warn('[ERP.SalesConnector][' + (tag || '?') + ']', e);
      return (typeof fallback === 'function') ? fallback(e) : fallback;
    }
  }

  function _logger() {
    return ERP.Logger || { info: function(){}, warn: function(){}, error: function(){} };
  }

  function _AccState() {
    var a = root.AccountingCore || null;
    return a ? a.AccountingState : null;
  }

  function _SA() {
    var a = root.AccountingCore || null;
    return a ? a.SYSTEM_ACCOUNTS : null;
  }

  function _debitAccountForPayType(payType) {
    var sa = _SA();
    if (!sa) return 'acc-1100';
    var pt = (payType || 'Credit').trim().toLowerCase();
    if (pt === 'cash') return sa.CASH;
    if (pt === 'jazzcash' || pt === 'easypaisa' ||
        pt === 'bank transfer' || pt === 'cheque') return sa.BANK;
    return sa.AR;
  }

  function _debitLabelForPayType(payType) {
    var pt = (payType || 'Credit').trim().toLowerCase();
    if (pt === 'cash')          return 'Cash received';
    if (pt === 'jazzcash')      return 'JazzCash received';
    if (pt === 'easypaisa')     return 'EasyPaisa received';
    if (pt === 'bank transfer') return 'Bank transfer received';
    if (pt === 'cheque')        return 'Cheque received';
    return 'Invoice receivable';
  }

  function _postedPersist(key) {
    var as = _AccState();
    if (!as || typeof as.journalExistsForSource !== 'function') return false;
    return _try(function () { return !!as.journalExistsForSource(key); }, false, '_postedPersist');
  }


  ERP.SalesConnector = {
    __phase4: true,

    isPosted: function (saleId) {
      var pe = root.ERP && root.ERP.PostingEngine;
      if (pe && typeof pe.isPosted === 'function') {
        return {
          revenue: pe.isPosted('SALE-REV-'  + saleId) || _postedPersist('P6-REV-' + saleId) || _postedPersist('P4-REV-' + saleId) || _postedPersist(saleId),
          cogs:    pe.isPosted('SALE-COGS-' + saleId) || _postedPersist('P6-COGS-' + saleId) || _postedPersist('P4-COGS-' + saleId) || _postedPersist(saleId + '-COGS')
        };
      }
      return {
        revenue: _postedPersist('SALE-REV-' + saleId) || _postedPersist('P6-REV-' + saleId) || _postedPersist('P4-REV-' + saleId) || _postedPersist(saleId),
        cogs:    _postedPersist('SALE-COGS-' + saleId) || _postedPersist('P6-COGS-' + saleId) || _postedPersist('P4-COGS-' + saleId) || _postedPersist(saleId + '-COGS')
      };
    },

    postSale: function (sale) {
      if (!sale || !sale.id) {
        _logger().warn('[ERP.SalesConnector.postSale] sale object with id required.');
        return;
      }
      var spl = ERP.SalesPostingLock;
      if (spl && typeof spl.postSale === 'function') {
        return spl.postSale(sale);
      } else {
        _logger().warn('[ERP.SalesConnector.postSale] SalesPostingLock not ready — queuing for retry:', sale.id);
        var _retryQ = ERP._salesPostQueue || (ERP._salesPostQueue = []);
        if (!_retryQ.some(function(s) { return s.id === sale.id; })) _retryQ.push(sale);
        _try(function() {
          if (ERP.EventBus && ERP.EventBus.emit) ERP.EventBus.emit('sales:post:deferred', { saleId: sale.id });
        });
        return { ok: false, error: 'LOCK_NOT_READY' };
      }
    },

    backfillAll: function () {
      var spl = ERP.SalesPostingLock;
      if (spl && typeof spl.backfill === 'function') {
        spl.backfill();
        _logger().info('[ERP.SalesConnector.backfillAll] Delegated to ERP.SalesPostingLock.backfill()');
      } else {
        _logger().warn('[ERP.SalesConnector.backfillAll] SalesPostingLock not ready.');
      }
    },

    auditPostings: function () {
      var results = [];
      _try(function () {
        var s     = ERP._internal && ERP._internal.getState ? ERP._internal.getState() : {};
        var sales = (s.data && s.data.sales) ? s.data.sales : (ERP.getState ? (ERP.getState().data && ERP.getState().data.sales) || [] : []);
        var pe    = root.ERP && root.ERP.PostingEngine;
        for (var i = 0; i < sales.length; i++) {
          var sale = sales[i];
          if (!sale || !sale.id || sale.voided) continue;
          var revPosted  = (pe && typeof pe.isPosted === 'function') ? pe.isPosted('SALE-REV-'  + sale.id) : _postedPersist('SALE-REV-'  + sale.id);
          var cogsPosted = (pe && typeof pe.isPosted === 'function') ? pe.isPosted('SALE-COGS-' + sale.id) : _postedPersist('SALE-COGS-' + sale.id);
          var p6r  = _postedPersist('P6-REV-'  + sale.id);
          var p6c  = _postedPersist('P6-COGS-' + sale.id);
          var p4r  = _postedPersist('P4-REV-'  + sale.id);
          var p4c  = _postedPersist('P4-COGS-' + sale.id);
          var legR = _postedPersist(sale.id);
          results.push({
            id:           sale.id,
            customer:     sale.customer || '',
            date:         sale.date || '',
            revenue:      revPosted,
            cogs:         cogsPosted,
            p6_revenue:   p6r,
            p6_cogs:      p6c,
            p4_revenue:   p4r,
            p4_cogs:      p4c,
            legacy_rev:   legR,
            ok:           revPosted && cogsPosted
          });
        }
      }, null, 'auditPostings');
      console.table(results);
      return results;
    },

    debitAccountForPayType: _debitAccountForPayType,
    debitLabelForPayType:   _debitLabelForPayType
  };

  _logger().info('[ERP.SalesConnector] v44 — P4 posting logic removed. P6 (SalesPostingLock) is sole authority.');

})(window);
