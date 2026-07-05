'use strict';

(function (ERP) {

  function _ok(data, meta)  { return { success:true,  data:data||null, error:null,        meta:meta||{} }; }
  function _fail(error,meta){ return { success:false, data:null,       error:error||null, meta:meta||{} }; }

  function _gs(){ return ERP._internal.getState(); }
  function _st(fn, tag){ return ERP._internal.setState(fn, tag); }

  function _copy(val){
    
    try{ return JSON.parse(JSON.stringify(val)); }
    catch(e){
      if(typeof structuredClone === 'function'){
        try{ return structuredClone(val); }
        catch(e2){ if(window.DEBUG_MODE) console.error(e2); }
      }
      try{
        var _seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
        var safe = JSON.stringify(val, function(key, value){
          if(_seen && typeof value === 'object' && value !== null){
            if(_seen.has(value)) return undefined;
            _seen.add(value);
          }
          return value;
        });
        return JSON.parse(safe);
      } catch(e3){ if(window.DEBUG_MODE) console.error(e3); }
      if(window.DEBUG_MODE) console.error('[sales.state._copy] All clone strategies failed — returning empty fallback. DATA MAY BE LOST.', e, val);
      return Array.isArray(val) ? [] : {};
    }
  }

  var State = {
    getSales:       function(){ return _copy(_gs().data.sales         || []); },
    getEstimates:   function(){ return _copy(_gs().data.estimates     || []); },
    getSaleOrders:  function(){ return _copy(_gs().data.saleOrders    || []); },
    getPayIn:       function(){ return _copy(_gs().data.payIn         || []); },
    getReturns:     function(){ return _copy(_gs().data.saleReturns   || []); },
    getChallans:    function(){ return _copy(_gs().data.deliveryChallans || []); },
    getCustomers:   function(){ return _copy(_gs().data.customers     || []); },
    getParts:       function(){ return _copy(_gs().data.inventory     || []); },
    getBiz:         function(){
      var b  = _gs().biz || {};
      var pc = (window.ERP && ERP.printer && ERP.printer.getConfig) ? ERP.printer.getConfig() : {};
      var _tw = pc.thermalWidth || b.thermalWidth
             || (b.printerSize==='4inch'?768:b.printerSize==='3inch'?576:b.printerSize==='2inch'?384:576);
      return {
        name:          b.name          || 'MH Autos',
        phone:         b.phone         || '',
        addr:          b.address       || b.addr       || '',
        address:       b.address       || b.addr       || '',
        gst:           b.gst           || '',
        ntn:           b.ntn           || b.gst        || '',
        email:         b.email         || '',
        website:       b.website       || '',
        city:          b.city          || '',
        logo:          b.logo          || '',
        currency:      b.currency      || 'Rs',
        locale:        b.locale        || (typeof navigator!=='undefined'?navigator.language:'en-PK')||'en-PK',
        taxLabel:      b.taxLabel      || 'GST',
        defaultTax:    typeof b.defaultTax==='number' ? b.defaultTax : 0,
        bankName:      b.bankName      || '',
        bankTitle:     b.bankTitle     || '',
        bankAcc:       b.bankAcc       || '',
        bankIban:      b.bankIban      || '',
        bankUpi:       b.bankUpi       || '',
        qrCode:        b.qrCode        || '',
        thermalWidth:        _tw,
        printerType:         pc.printerType        || b.printerType        || 'thermal',
        printerSize:         pc.printerSize        || b.printerSize        || '3inch',
        defaultPrintMode:    pc.defaultPrintMode   || b.defaultPrintMode   || 'auto',
        autoPrint:           (pc.autoPrint         !== undefined) ? pc.autoPrint         : (b.autoPrint         !== false),
        printCopies:         pc.printCopies        || b.printCopies        || 1,
        printLanguage:       pc.printLanguage      || b.printLanguage      || 'en',
        thermalFontSize:     pc.thermalFontSize    || b.thermalFontSize    || 'medium',
        thermalFooter:       pc.thermalFooter      || b.thermalFooter      || 'Thank you! آپ کا شکریہ',
        thermalHeader:       pc.thermalHeader      || b.thermalHeader      || '',
        invoiceTemplate:     pc.invoiceTemplate    || b.invoiceTemplate    || 'modern',
        dateFormat:          pc.dateFormat         || b.dateFormat         || 'dd/mm/yyyy',
        showLogoOnPrint:     (pc.showLogoOnPrint   !== undefined) ? pc.showLogoOnPrint   : (b.showLogoOnPrint   !== false),
        showQROnPrint:       (pc.showQROnPrint     !== undefined) ? pc.showQROnPrint     : (b.showQROnPrint     !== false),
        showStampOnPrint:    (pc.showStampOnPrint  !== undefined) ? pc.showStampOnPrint  : (b.showStampOnPrint  !== false),
        showSignatureBox:    (pc.showSignatureBox  !== undefined) ? pc.showSignatureBox  : (b.showSignatureBox  || false),
        paperMargin:         pc.paperMargin        || b.paperMargin        || 'normal',
        paperOrientation:    pc.paperOrientation   || b.paperOrientation   || 'portrait',
        connectionType:      pc.connectionType     || b.connectionType     || 'default',
        networkPrinterIP:    pc.networkPrinterIP   || b.networkPrinterIP   || ''
      };
    },

    update: function(mutatorFn, tag){
      try{
        _st(mutatorFn, tag || 'state:update');
        return _ok();
      }catch(e){
        if(window.DEBUG_MODE) console.error('[sales.state.update] mutation threw:', tag, e);
        return _fail(e);
      }
    }
  };

  function _custs()    { return State.getCustomers(); }
  function _invParts() { return State.getParts();     }

  ERP._salesState   = State;
  ERP._salesOk      = _ok;
  ERP._salesFail    = _fail;
  ERP._salesCusts   = _custs;
  ERP._salesParts   = _invParts;

})(window.ERP = window.ERP || {});
