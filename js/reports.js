'use strict';
;(function(ERP,global){
if(ERP._reportsLoaded)return;
ERP._reportsLoaded=true;

function _esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function PKR(n){var _n=Number(n);var neg=!isNaN(_n)&&_n<0;var v=isNaN(_n)?0:Math.abs(_n);var s='Rs.'+v.toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2});return neg?'('+s+')':s;}
function PCT(n){return (Math.round((Number(n)||0)*10)/10)+'%';}
function _today(){
  if(ERP.DateUtils&&typeof ERP.DateUtils.today==='function'){
    try{return ERP.DateUtils.today();}catch(_e){}
  }
  var d=new Date(Date.now()+5*60*60*1000);
  return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');
}
function _monthStart(){return _today().slice(0,7)+'-01';}
function _ts(s){if(!s)return NaN;var p=String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);if(p){var d=Date.UTC(+p[1],+p[2]-1,+p[3]);return d;}var _n=String(s).substring(0,10);var _p2=_n.match(/^(\d{4})-(\d{2})-(\d{2})/);if(_p2){var d2=Date.UTC(+_p2[1],+_p2[2]-1,+_p2[3]);return d2;}var _f3=String(s).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);if(_f3){var d3=Date.UTC(+_f3[1],+_f3[2]-1,+_f3[3],+_f3[4],+_f3[5],+_f3[6]);return d3;}return NaN;}
function _D(s){if(!s)return '—';var p=String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);if(!p)return String(s);var y=+p[1],m=+p[2],d=+p[3];var M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];return(String(d).padStart(2,'0')+'-'+M[m-1]+'-'+y);}
function _daysDiff(a,b){var t1=_ts(a),t2=_ts(b||_today());return isNaN(t1)?0:Math.floor((t2-t1)/86400000);}
function _el(id){return document.getElementById(id);}
function _pill(status){var M={paid:'green',credit:'orange',unpaid:'red',partial:'blue',overpaid:'purple',completed:'green',delivered:'teal','in-progress':'orange',pending:'blue','waiting-parts':'purple',cancelled:'red',returned:'red',received:'teal',draft:'gray',complete:'green',active:'green',closed:'gray','no-show':'red',low:'red',critical:'red',ok:'green',warning:'orange',expired:'red'};var c=M[(status||'').toLowerCase()]||'gray';return '<span class="rpt-pill rpt-pill-'+c+'">'+_esc(status||'—')+'</span>';}
function _fromPaisa(p){var acc=global.AccountingCore;if(!acc||!acc.Money)throw new Error('[Reports] ACC.Money missing. Load accounting_constants.js first.');return acc.Money.fromPaisa(p);}

function _Ledger(){return(ERP.Ledger&&ERP.Ledger.__phase2)?ERP.Ledger:null;}
function _GL(){var l=_Ledger();return l?l.GeneralLedger:null;}
function _SL(){var l=_Ledger();return l?l.StockLedger:null;}
function _VL(){var l=_Ledger();return l?l.VendorLedger:null;}
function _ACC(){return global.AccountingCore||null;}
function _SA(){var a=_ACC();return a?a.SYSTEM_ACCOUNTS:null;}
function _AccState(){var a=_ACC();return(a&&a.AccountingState)?a.AccountingState:null;}
function _ledgerReady(){
  var l=_Ledger(),as=_AccState();
  if(!l||!as)return false;
  if(typeof as.isInitialized==='function'&&!as.isInitialized()){
    try{as.initialize();}catch(_e){return false;}
    if(typeof as.isInitialized==='function'&&!as.isInitialized())return false;
  }
  return true;
}
function _tryL(fn,fb){try{return fn();}catch(_e){return fb;}}
var _warnedPrivateReversalIndex=false;
function _isJournalReversed(pe,journalId){
  if(!pe)return false;
  if(typeof pe.isReversed==='function'){
    try{return !!pe.isReversed(journalId);}catch(_e){return false;}
  }
  if(pe._ReversalIndex&&typeof pe._ReversalIndex.isReversed==='function'){
    if(!_warnedPrivateReversalIndex){
      _warnedPrivateReversalIndex=true;
      console.warn('[reports.js] PostingEngine has no public isReversed(id) method — falling back to the private PostingEngine._ReversalIndex API. Add a public isReversed() to PostingEngine to remove this fragile coupling.');
    }
    try{return !!pe._ReversalIndex.isReversed(journalId);}catch(_e){return false;}
  }
  return false;
}
function _journalsInRange(from,to){var as=_AccState();if(!as||typeof as.getAllJournals!=='function')return[];return _tryL(function(){var fTs=from?_ts(from):-Infinity,tTs=to?_ts(to+'T23:59:59'):Infinity;var pe=window.ERP&&window.ERP.PostingEngine;return as.getAllJournals().filter(function(j){if(_isJournalReversed(pe,j.id))return false;var jTs=_ts(j.date);return !isNaN(jTs)&&jTs>=fTs&&jTs<=tTs;});},[]);}
function _sumDr(j,a){return _tryL(function(){var t=0;j.forEach(function(jj){(jj.entries||[]).forEach(function(e){if(e.accountId===a)t+=(Number(e.debit)||0);});});return t;},0);}
function _sumCr(j,a){return _tryL(function(){var t=0;j.forEach(function(jj){(jj.entries||[]).forEach(function(e){if(e.accountId===a)t+=(Number(e.credit)||0);});});return t;},0);}

var _GLQ={
  balance:function(acct){if(!_ledgerReady())return 0;return _tryL(function(){return _fromPaisa(_GL().getBalance(acct));},0);},
  systemBalances:function(){if(!_ledgerReady())return{};return _tryL(function(){var raw=_Ledger().getSystemAccountBalances(),r={};Object.keys(raw).forEach(function(k){r[k]=_fromPaisa(raw[k]);});return r;},{});},
  trialBalance:function(pid){if(!_ledgerReady())return[];return _tryL(function(){return(_GL().getTrialBalance(pid)||[]).map(function(row){return{accountId:row.accountId,code:row.code,name:row.name,type:row.type,totalDebit:_fromPaisa(row.totalDebit),totalCredit:_fromPaisa(row.totalCredit),balance:_fromPaisa(row.balance)};});},[]); },
  revenueForPeriod:function(f,t){if(!_ledgerReady())return 0;return _tryL(function(){var sa=_SA();if(!sa)return 0;var j=_journalsInRange(f,t);var primary=sa.SALES_REV||'acc-4001';var secondary=sa.SERVICE_REV||sa.LABOUR_REV||'acc-4002';var total=_sumCr(j,primary);if(secondary!==primary)total+=_sumCr(j,secondary);return _fromPaisa(total);},0);},
  cogsForPeriod:function(f,t){if(!_ledgerReady())return 0;return _tryL(function(){var sa=_SA();if(!sa)return 0;return _fromPaisa(_sumDr(_journalsInRange(f,t),sa.COGS||'acc-5100'));},0);},
  expensesForPeriod:function(f,t){if(!_ledgerReady())return 0;return _tryL(function(){var sa=_SA();var cogsAcct=(sa&&sa.PURCHASE_EXP)||'acc-5100';var j=_journalsInRange(f,t);var total=0;j.forEach(function(jn){(jn.entries||[]).forEach(function(e){if(e.accountId&&e.accountId.match(/^acc-5/)&&e.accountId!==cogsAcct&&_CALC.num(e.debit)>0)total+=_CALC.num(e.debit);});});return _fromPaisa(total);},0);},
  gstPayable:function(){if(!_ledgerReady())return 0;return _tryL(function(){var sa=_SA();return sa?_fromPaisa(_GL().getBalance(sa.GST_PAYABLE||'acc-2200')):0;},0);},
  gstReceivable:function(){if(!_ledgerReady())return 0;return _tryL(function(){var sa=_SA();return sa?_fromPaisa(_GL().getBalance(sa.GST_RECEIVABLE||'acc-1300')):0;},0);},
  isBalanced:function(pid){if(!_ledgerReady())return true;return _tryL(function(){return _Ledger().isLedgerBalanced(pid);},true);}
};
var _SLQ={
  inventoryValue:function(){if(!_ledgerReady())return 0;return _tryL(function(){return _fromPaisa(_SL().getInventoryBalance());},0);},
  totalCOGS:function(){if(!_ledgerReady())return 0;return _tryL(function(){return _fromPaisa(_SL().getCOGS());},0);},
  cogsForPeriod:function(f,t){return _GLQ.cogsForPeriod(f,t);},
  stockReceivedForPeriod:function(f,t){if(!_ledgerReady())return 0;return _tryL(function(){return _fromPaisa(_sumDr(_journalsInRange(f,t),'acc-1200'));},0);},
  stockConsumedForPeriod:function(f,t){if(!_ledgerReady())return 0;return _tryL(function(){return _fromPaisa(_sumCr(_journalsInRange(f,t),'acc-1200'));},0);},
  grossMarginPct:function(f,t){return _tryL(function(){var rev=_GLQ.revenueForPeriod(f,t),cogs=_SLQ.cogsForPeriod(f,t);return rev>0?Math.round(((rev-cogs)/rev)*1000)/10:0;},0);}
};
var _VLQ={
  totalReceivable:function(){if(!_ledgerReady())return 0;return _tryL(function(){return _fromPaisa(_VL().getTotalReceivable());},0);},
  totalPayable:function(){if(!_ledgerReady())return 0;return _tryL(function(){return _fromPaisa(_VL().getTotalPayable());},0);},
  partyLedger:function(name){if(!_ledgerReady()||!name)return[];return _tryL(function(){return(_VL().getPartyLedger(name)||[]).map(function(j){return Object.assign({},j,{runningBalance:_fromPaisa(j.runningBalance||0)});});},[]); },
  arRaisedForPeriod:function(f,t){if(!_ledgerReady())return 0;return _tryL(function(){var sa=_SA();return sa?_fromPaisa(_sumDr(_journalsInRange(f,t),sa.AR||'acc-1100')):0;},0);},
  cashCollectedForPeriod:function(f,t){if(!_ledgerReady())return 0;return _tryL(function(){var sa=_SA();return sa?_fromPaisa(_sumCr(_journalsInRange(f,t),sa.AR||'acc-1100')):0;},0);},
  apRaisedForPeriod:function(f,t){if(!_ledgerReady())return 0;return _tryL(function(){var sa=_SA();return sa?_fromPaisa(_sumCr(_journalsInRange(f,t),sa.AP||'acc-2001')):0;},0);},
  vendorPaymentsForPeriod:function(f,t){if(!_ledgerReady())return 0;return _tryL(function(){var sa=_SA();return sa?_fromPaisa(_sumDr(_journalsInRange(f,t),sa.AP||'acc-2001')):0;},0);}
};

var _CALC={
  num:function(v){var n=Number(v);return isNaN(n)?0:n;},
  saleTotal:function(s){return _CALC.num(s.total||s.grand||s.amt||0);},
  salePaid:function(s){return _CALC.num(s.paid||s.paidAmount||0);},
  _returnsByInvoiceCache:null,
  _returnsByInvoiceCacheKey:null,
  _returnsByInvoice:function(state){
    var allReturns = (state && state.data && state.data.saleReturns)
      ? state.data.saleReturns
      : (function(){ try{ return (window.ERP&&ERP._salesSvc)?ERP._salesSvc.ret.getAll():[]; }catch(_){ return []; } }());
    var cacheKey = allReturns;
    if(_CALC._returnsByInvoiceCache && _CALC._returnsByInvoiceCacheKey===cacheKey){
      return _CALC._returnsByInvoiceCache;
    }
    var map={};
    allReturns.forEach(function(r){
      if(r.voided) return;
      var inv=r.originalInv;
      if(inv===undefined||inv===null) return;
      map[inv]=(map[inv]||0)+_CALC.num(r.returnGrand||r.amount||0);
    });
    _CALC._returnsByInvoiceCache=map;
    _CALC._returnsByInvoiceCacheKey=cacheKey;
    return map;
  },
  saleOutstanding:function(s, state){
    var total = _CALC.saleTotal(s);
    var paid  = _CALC.salePaid(s);
    var byInvoice = _CALC._returnsByInvoice(state);
    var returnDeductions = _CALC.num(byInvoice[s.id], 0);
    return total - paid - returnDeductions;
  },
  saleDiscount:function(s){return(s.items||[]).reduce(function(a,i){return a+_CALC.num(i.d||0);},0);},
  purTotal:function(p){return _CALC.num(p.total||p.amt||0);},
  purPaid:function(p){
    if(typeof p.paidPaisa==='number')return Math.round(p.paidPaisa)/100;
    return _CALC.num(p.paid||p.paidAmount||0);
  },
  purOutstanding:function(p, state){
    var base;
    if(typeof p.remainingPaisa==='number')base=Math.round(p.remainingPaisa)/100;
    else if(typeof p.remaining==='number')base=p.remaining;
    else base=_CALC.purTotal(p)-_CALC.purPaid(p);
    var allReturns=_st(state,'purchaseReturns')||[];
    var returnDeductions=allReturns.reduce(function(s,r){
      return (!r._deleted&&String(r.purchaseId)===String(p.id))?s+_CALC.num(r.total||0):s;
    },0);
    return base - returnDeductions;
  },
  customerOutstanding:function(custId,custName,state){
    if(custId===undefined||custId===null||custId==='')return _CALC.customerOutstandingFromSales(custId,custName,state);
    var ledger=_st(state,'customerLedger').filter(function(e){return e.customerId!==undefined&&e.customerId!==null&&String(e.customerId)===String(custId);});
    if(ledger.length){return ledger.reduce(function(s,e){return s+(Number(e.debit)||0)-(Number(e.credit)||0);},0);}
    return _CALC.customerOutstandingFromSales(custId,custName,state);
  },
  customerOutstandingFromSales:function(custId,custName,state){
    var sales=_st(state,'sales').filter(function(s){
      return !s.deleted&&(String(s.customerId)===String(custId)||(s.customer||'').toLowerCase()===(custName||'').toLowerCase());
    });
    return sales.reduce(function(s,x){return s+_CALC.saleOutstanding(x,state);},0);
  },
  dateFilter:function(arr,from,to,field){field=field||'date';var fTs=from?_ts(from):-Infinity,tTs=to?_ts(to):Infinity;return arr.filter(function(r){var t=_ts(r[field]);return !isNaN(t)&&t>=fTs&&t<=tTs;});},
  avgDailySales:function(bc,sales){
    var todayTs=_ts(_today()),cutoff=todayTs-(90*86400000),qty=0,days=new Set();
    var earliestTs=Infinity;
    sales.forEach(function(s){
      var sTs=_ts(s.date);
      if(!isNaN(sTs)&&sTs>=cutoff&&sTs<earliestTs)earliestTs=sTs;
      if(sTs<cutoff)return;
      (s.items||[]).forEach(function(i){if((i.bc||i.sku)===bc){qty+=_CALC.num(i.q);days.add(s.date);}});
    });
    if(days.size===0)return 0;
    var windowDays=Math.max(1,Math.min(90,Math.round((todayTs-earliestTs)/86400000)+1));
    return qty/windowDays;
  },
  daysOfStock:function(item,sales){var avg=_CALC.avgDailySales(item.bc,sales);if(avg<=0)return Infinity;var st=Math.max(0,_CALC.num(item.st));return Math.floor(st/avg);},
  jobProfit:function(job,inv){var r=(job.parts||[]).reduce(function(s,p){return s+_CALC.num(p.p||p.sp||0)*_CALC.num(p.q||1);},0);var c=(job.parts||[]).reduce(function(s,p){var historicalCost=_CALC.num(p.costPrice||p.cp||0);if(historicalCost>0)return s+historicalCost*_CALC.num(p.q||1);var item=(inv||[]).find(function(i){return i.bc===(p.bc||p.sku)||i.n===p.n;});return s+(item?_CALC.num(item.pp):0)*_CALC.num(p.q||1);},0);return r+_CALC.num(job.labour||0)-c;},
  itemMargin:function(item){var sp=_CALC.num(item.sp),pp=_CALC.num(item.pp);if(sp>0)return((sp-pp)/sp)*100;return pp>0?-100:0;},
  agingBucket:function(days){if(days<=0)return'current';if(days<=30)return'1-30';if(days<=60)return'31-60';if(days<=90)return'61-90';if(days<=180)return'91-180';if(days<=365)return'181-365';return'365+';}
};

function _kpiIcon(cls){
  cls = cls || '';
  if (cls.indexOf('red') > -1)   return { icon:'📉', color:'#dc2626', bg:'#fef2f2' };
  if (cls.indexOf('green') > -1) return { icon:'📈', color:'#16a34a', bg:'#f0fdf4' };
  return { icon:'📊', color:'#4338CA', bg:'#eff6ff' };
}
function _kpis(cards){
  return window.renderStatCards(cards.map(function(c){
    var m = _kpiIcon(c.cls);
    var lbl = _esc(c.label) + (c.sub ? '<br><span style="font-weight:500;opacity:.75">'+_esc(c.sub)+'</span>' : '');
    return { icon:m.icon, color:m.color, bg:m.bg, label:lbl, value: c.html || _esc(String(c.value||0)) };
  }), { cols: Math.min(cards.length, 5), gridCls:'rpt-kpi-row' });
}
function _filters(id,fields){return '<div class="rpt-filter-strip">'+fields.map(function(f){if(f.type==='select'){return '<label class="rpt-filter-label">'+_esc(f.label||'')+' <select id="'+_esc(id+'-'+f.key)+'" class="rpt-filter-input" onchange="RTP._rerun()">'+( f.options||[]).map(function(o){return'<option value="'+_esc(o.v||o)+'">'+_esc(o.l||o)+'</option>';}).join('')+'</select></label>';}return'<label class="rpt-filter-label">'+_esc(f.label||'')+' <input id="'+_esc(id+'-'+f.key)+'" type="'+(f.type||'text')+'" class="rpt-filter-input" placeholder="'+_esc(f.ph||'')+'"'+(f.val?' value="'+_esc(f.val)+'"':'')+' onchange="RTP._rerun()" oninput="'+(f.live?'RTP._rerun()':'')+'">'+'</label>';}).join('')+'</div>';}
function _table(heads,rows,foot){var ths=heads.map(function(h){return'<th class="'+(h.r?'r':'')+'">'+_esc(h.l||h)+'</th>';}).join('');var tds=rows.length?rows.map(function(r){return'<tr>'+r.map(function(c){var cls=(c&&c.r?'r ':'')+(c&&c.fw?'fw ':'')+(c&&c.mono?'mono ':'');var val=c&&c.html?c.html:_esc(c&&c.v!==undefined?c.v:(c||''));return'<td class="'+cls.trim()+'">'+val+'</td>';}).join('')+'</tr>';}).join(''):'<tr><td colspan="'+heads.length+'" style="text-align:center;padding:28px;color:var(--muted);font-size:13px">No records found for this period</td></tr>';var tfoot=foot?'<tfoot><tr>'+foot.map(function(f,i){var cls=(f&&f.r?'r ':(i>0?'r ':''))+(f&&f.fw?'fw ':'');var val=f&&typeof f==='object'?(f.html||_esc(String(f.v!==undefined?f.v:''))):_esc(String(f||''));return'<td class="'+cls.trim()+'">'+val+'</td>';}).join('')+'</tr></tfoot>':'';return'<div style="overflow-x:auto"><table class="rpt-table"><thead><tr>'+ths+'</tr></thead><tbody>'+tds+'</tbody>'+tfoot+'</table></div>';}
function _section(title,meta,body){if(body===undefined){body=meta;meta='';}return'<div class="rpt-section"><div class="rpt-section-head"><span class="rpt-section-title">'+title+'</span><span class="rpt-section-meta">'+(meta||'')+'</span></div><div class="rpt-section-body">'+body+'</div></div>';}
function _waBtn(phone,message){if(!phone)return'';var ph=(window.ERP&&ERP.WhatsAppLink&&typeof ERP.WhatsAppLink.normalize==='function')?ERP.WhatsAppLink.normalize(phone):String(phone).replace(/\D/g,'');if(!ph)return'';/* FIX: this was the reference normalization logic (10-digit / leading-0 / >12-digit rules); now centralized in erp.whatsapp.link.js — see audit finding #96 */return'<a href="https://wa.me/'+ph+'?text='+encodeURIComponent(message||'Hello')+'" target="_blank" class="btn btn-whatsapp btn-xs" title="Send WhatsApp">📱</a>';}
function _printBtn(t){return'<button class="btn btn-ghost btn-sm rpt-print-btn" onclick="RTP._print(\''+_esc(t)+'\')" title="Print / Save PDF">Print / PDF</button>';}
function _lo(title,kpis,from,to,source){var per=(from||to)?'<span style="font-size:10px;color:var(--muted,#64748b);margin-left:8px">'+_esc((from||'')+((from&&to)?' → ':'')+(to||''))+'</span>':'';return'<div class="p8-overlay"><div class="p8-overlay-head"><span class="p8-overlay-icon">⚖️</span><span class="p8-overlay-title">'+_esc(title)+'</span>'+per+'<span class="p8-overlay-badge">LEDGER</span></div>'+window.renderStatCards(kpis.map(function(k){var m=_kpiIcon(k.cls);return{icon:m.icon,color:m.color,bg:m.bg,label:_esc(k.label),value:_esc(k.value),cls:'p8-kpi',valCls:'p8-kpi-value',labelCls:'p8-kpi-label'};}),{cols:Math.min(kpis.length,5),gridCls:'p8-kpi-row'})+(source?'<div class="p8-overlay-source">'+_esc(source)+'</div>':'')+'</div>';}

function _st(state,key){
  var d=(state&&state.data)?state.data:{};
  var arr=Array.isArray(d[key])?d[key]:[];
  if(!arr.length){
    try{if(key==='sales'&&global.ERP&&global.ERP._services&&global.ERP._services.invoice&&typeof global.ERP._services.invoice.list==='function'){var sl=global.ERP._services.invoice.list();if(Array.isArray(sl)&&sl.length)return sl;}
    }catch(_e0){}
    try{if(key==='expenses'&&global.ERP&&global.ERP._services&&global.ERP._services.expenses&&typeof global.ERP._services.expenses.list==='function'){var exl=global.ERP._services.expenses.list();if(Array.isArray(exl)&&exl.length)return exl;}
    }catch(_e1){}
    try{
      if(key==='purchases'){
        var pur=d['purchases']||[];
        if(Array.isArray(pur)&&pur.length)return pur;
        if(global.PurchaseState&&typeof global.PurchaseState.getAllPurchases==='function'){var purl=global.PurchaseState.getAllPurchases();if(Array.isArray(purl)&&purl.length)return purl;}
      }
      if(key==='purchaseReturns'){
        var prr=d['purchaseReturns']||[];
        if(Array.isArray(prr)&&prr.length)return prr;
        if(global.PurchaseState&&typeof global.PurchaseState.getAllReturns==='function'){var prl=global.PurchaseState.getAllReturns();if(Array.isArray(prl)&&prl.length)return prl;}
      }
      if(key==='inventory'){
        if(global.ERP&&global.ERP.InventoryService&&typeof global.ERP.InventoryService.getAll==='function')return global.ERP.InventoryService.getAll();
        if(global.ERP&&global.ERP.state&&global.ERP.state.selectors&&typeof global.ERP.state.selectors.inventory==='function')return global.ERP.state.selectors.inventory()||[];
      }
      if(key==='saleReturns'){
        var sr=d['saleReturns']||d['salesReturns']||d['returns']||[];
        if(Array.isArray(sr)&&sr.length)return sr;
        if(global.ERP&&global.ERP.SalesState&&typeof global.ERP.SalesState.getReturns==='function'){var srr=global.ERP.SalesState.getReturns();if(Array.isArray(srr)&&srr.length)return srr;}
        try{if(global.ERP&&global.ERP._services&&global.ERP._services.saleReturns&&typeof global.ERP._services.saleReturns.list==='function'){var srl=global.ERP._services.saleReturns.list();if(Array.isArray(srl)&&srl.length)return srl;}
        }catch(_e3){}
      }
      if(key==='payIn'){
        var pi=d['payIn']||d['paymentsIn']||d['receipts']||[];
        if(Array.isArray(pi)&&pi.length)return pi;
        try{if(global.ERP&&global.ERP._services&&global.ERP._services.payIn&&typeof global.ERP._services.payIn.list==='function'){var pil=global.ERP._services.payIn.list();if(Array.isArray(pil)&&pil.length)return pil;}
        }catch(_e2){}
      }
      if(key==='payOut'){
        var po=d['payOut']||d['paymentOuts']||d['paymentsOut']||[];
        if(Array.isArray(po)&&po.length)return po;
        try{if(global.PurchaseState&&typeof global.PurchaseState.getAllPayments==='function'){var pol=global.PurchaseState.getAllPayments();if(Array.isArray(pol)&&pol.length)return pol.filter(function(p){return !p.voided;});}
        }catch(_e4){}
      }
      if(key==='stockMovements'){
        var sm=d['stockMovements']||d['movements']||[];
        if(Array.isArray(sm)&&sm.length)return sm;
        try{if(global.ERP&&global.ERP.state&&global.ERP.state.selectors&&typeof global.ERP.state.selectors.stockMovements==='function')return global.ERP.state.selectors.stockMovements()||[];}catch(_e2){}
      }
    }catch(_e){}
  }
  return arr;
}

var ReportQuery={};

ReportQuery.salesMain=function(p,state){
  var from=p.from||_today().slice(0,4)+'-01-01',to=p.to||_today(),cust=(p.cust||'').toLowerCase(),user=(p.user||'').toLowerCase(),cat=(p.cat||'').toLowerCase(),payM=p.pay||'',status=p.status||'',warn=[];p.from=from;p.to=to;
  var sales=_st(state,'sales').filter(function(s){return !s.deleted;});
  var all=_CALC.dateFilter(sales,from,to);
  if(!all.length&&sales.length)warn.push('No sales found in the selected period — check the dates');
  else if(!sales.length)warn.push('No sales recorded yet');
  if(cust)all=all.filter(function(s){return(s.customer||'').toLowerCase().includes(cust);});
  if(user)all=all.filter(function(s){return(s.createdBy||'').toLowerCase().includes(user);});
  if(payM)all=all.filter(function(s){return(s.pay||'')===payM;});
  if(status)all=all.filter(function(s){return(s.status||'')===status;});
  if(cat)all=all.filter(function(s){return(s.items||[]).some(function(i){return(i.cat||'').toLowerCase().includes(cat);});});
  var gross=all.reduce(function(s,x){return s+_CALC.saleTotal(x);},0);
  var collected=all.reduce(function(s,x){return s+_CALC.salePaid(x);},0);
  var discTotal=all.reduce(function(s,x){return s+_CALC.saleDiscount(x);},0);
  
  var _filteredSaleIds={}; all.forEach(function(s){_filteredSaleIds[s.id]=true;});
  var returnAmt=_st(state,'saleReturns').filter(function(r){
    var linkedInv=r.originalInv||r.originalId||'';
    if(linkedInv) return !!_filteredSaleIds[linkedInv];
    var rd=r.date||''; return (!from||rd>=from)&&rd<=to;
  }).reduce(function(s,r){return s+_CALC.num(r.returnGrand||r.amount||0);},0);
  var payBreakdown={};
  all.forEach(function(s){var m=s.pay||'Cash';if(!payBreakdown[m])payBreakdown[m]={count:0,amount:0};payBreakdown[m].count++;payBreakdown[m].amount+=_CALC.saleTotal(s);});
  var customers=_st(state,'customers');
  var rows=all.slice().sort(function(a,b){return(b.date||'').localeCompare(a.date||'');}).map(function(s){var due=_CALC.saleOutstanding(s,state);var cr=customers.find(function(c){return String(c.id)===String(s.customerId)||(c.n||'').toLowerCase()===(s.customer||'').toLowerCase();});return{date:s.date,id:s.id,customer:s.customer,createdBy:s.createdBy,pay:s.pay,total:_CALC.saleTotal(s),paid:_CALC.salePaid(s),due:due,status:s.status,phone:s.ph||(cr?cr.ph:'')||''};});
  return{data:{rows:rows,payBreakdown:payBreakdown},totals:{gross:gross,collected:collected,outstanding:gross-returnAmt-collected,discTotal:discTotal,returnAmt:returnAmt,netSales:gross-returnAmt},warnings:warn};
};

ReportQuery.saleLedger=function(p,state){
  var from=p.from||_monthStart(),to=p.to||_today(),cust=p.cust||'',warn=[];p.from=from;p.to=to;
  var sales=_st(state,'sales').filter(function(s){return !s.deleted;});if(!sales.length)warn.push('sales data unavailable');
  var custLC=cust.toLowerCase();
  var filtered=_CALC.dateFilter(sales,from,to).filter(function(s){return !cust||(s.customer||'').toLowerCase().includes(custLC);});
  var totalInvoiced=filtered.reduce(function(s,x){return s+_CALC.saleTotal(x);},0);
  var totalPaid=filtered.reduce(function(s,x){return s+_CALC.salePaid(x);},0);
  var customers=_st(state,'customers');
  var rows=filtered.slice().sort(function(a,b){return(a.date||'').localeCompare(b.date||'');}).map(function(s){var due=_CALC.saleOutstanding(s,state);var co=customers.find(function(c){return(c.n||'').toLowerCase()===(s.customer||'').toLowerCase();});return{date:s.date,id:s.id,customer:s.customer,total:_CALC.saleTotal(s),paid:_CALC.salePaid(s),due:due,daysOld:_daysDiff(s.date),status:s.status,phone:co?(co.ph||''):''};});
  var totalDue=rows.reduce(function(s,r){return s+r.due;},0);
  var collRate=totalInvoiced>0?(totalPaid/totalInvoiced*100).toFixed(1):'0.0';
  var ledger={ready:_ledgerReady()};
  if(ledger.ready){
    ledger.raised=_VLQ.arRaisedForPeriod(from,to);ledger.collected=_VLQ.cashCollectedForPeriod(from,to);ledger.arBalance=_VLQ.totalReceivable();
    if(Math.abs(totalInvoiced-ledger.raised)>1){
      warn.push('GL/sub-ledger mismatch: GL AR raised='+ledger.raised.toFixed(2)+' sale-record total='+totalInvoiced.toFixed(2)+' period='+from+'..'+to);
    }
    if(Math.abs(totalPaid-ledger.collected)>1){
      warn.push('GL/sub-ledger mismatch: GL cash collected='+ledger.collected.toFixed(2)+' sale-record collected='+totalPaid.toFixed(2)+' period='+from+'..'+to);
    }
  }
  return{data:{rows:rows,ledger:ledger},totals:{totalInvoiced:totalInvoiced,totalPaid:totalPaid,totalDue:totalDue,collRate:collRate},warnings:warn};
};

ReportQuery.aging=function(p,state){
  var type=p.type||'customers',today=_today(),warn=[];
  if(type==='customers'){
    var customers=_st(state,'customers');
    
    var sales=_st(state,'sales').filter(function(s){
      var st=(s.status||'').toLowerCase();
      if(s.deleted || st==='returned' || st==='cancelled') return false;
      var due = _CALC.saleOutstanding(s,state);
      return due > 0.001;
    });
    if(!sales.length)warn.push('sales data unavailable');
    var cMap={};
    sales.forEach(function(s){var key=s.customerId||s.customer||'Unknown';if(!cMap[key]){var c=customers.find(function(c){return String(c.id)===String(s.customerId)||c.n===s.customer;});cMap[key]={name:s.customer||key,ph:c?c.ph:'',buckets:{current:0,'1-30':0,'31-60':0,'61-90':0,'91-180':0,'181-365':0,'365+':0},total:0};}var days=_daysDiff(s.date,today);var bkt=_CALC.agingBucket(days);var due=_CALC.saleOutstanding(s,state);cMap[key].buckets[bkt]+=due;cMap[key].total+=due;});
    var grandTotal=Object.values(cMap).reduce(function(s,c){return s+c.total;},0);
    var ledger={ready:_ledgerReady()};if(ledger.ready){ledger.ar=_VLQ.totalReceivable();ledger.ap=_VLQ.totalPayable();}
    return{data:{type:'customers',custMap:cMap,ledger:ledger},totals:{grandTotal:grandTotal},warnings:warn};
  }
  // NOTE: previously filtered out purchases whose workflow status was 'complete'/'completed'. That status
  // field means "stock received", NOT "fully paid" — the "Mark Paid" action actually just receives stock,
  // so a received-but-unpaid bill was wrongly disappearing from Payables Aging. Filter on the real
  // outstanding balance (purOutstanding, driven by remainingPaisa) instead, so unpaid bills always show
  // regardless of their fulfillment status. Cancelled/returned bills are still excluded since they carry no debt.
  var purchases=_st(state,'purchases').filter(function(p){var st=(p.status||p.st||'').toLowerCase();return !p._deleted&&st!=='returned'&&st!=='cancelled'&&_CALC.purOutstanding(p,state)>0.001;});
  if(!purchases.length)warn.push('purchases data unavailable');
  var sMap={};
  purchases.forEach(function(p){var key=p.supplierName||p.sup||'Unknown';if(!sMap[key])sMap[key]={name:key,buckets:{current:0,'1-30':0,'31-60':0,'61-90':0,'91-180':0,'181-365':0,'365+':0},total:0};var days=_daysDiff(p.date,today);var bkt=_CALC.agingBucket(days);var due=_CALC.purOutstanding(p,state);sMap[key].buckets[bkt]+=due;sMap[key].total+=due;});
  var supTotal=Object.values(sMap).reduce(function(s,c){return s+c.total;},0);
  return{data:{type:'suppliers',supMap:sMap},totals:{supTotal:supTotal},warnings:warn};
};

ReportQuery.partyStatement=function(p,state){
  var custName=p.cust||'',from=p.from||'',to=p.to||_today(),warn=[];
  var custLC=custName.toLowerCase();
  var customers=_st(state,'customers');
  var custObj=customers.find(function(c){return(c.n||'').toLowerCase()===custLC;});
  var sales=_st(state,'sales').filter(function(s){return !s.deleted&&(!custName||(s.customer||'').toLowerCase()===custLC)&&_ts(s.date)>=(from?_ts(from):-Infinity)&&_ts(s.date)<=_ts(to);}).sort(function(a,b){return(a.date||'').localeCompare(b.date||'');});
  var payIn=_st(state,'payIn').filter(function(p){return !p.voided&&(!custName||(p.customer||'').toLowerCase()===custLC||(custObj&&String(p.customerId)===String(custObj.id)))&&_ts(p.date)>=(from?_ts(from):-Infinity)&&_ts(p.date)<=_ts(to);});
  var entries=[];
  sales.forEach(function(s){entries.push({date:s.date,type:'Invoice',ref:s.id,debit:_CALC.saleTotal(s),credit:0,note:''}); });
  payIn.forEach(function(p){entries.push({date:p.date,type:'Payment',ref:p.id,debit:0,credit:_CALC.num(p.amount),note:p.note||p.method||''}); });
  
  var saleIds={}; sales.forEach(function(s){saleIds[s.id]=true;});
  _st(state,'saleReturns').filter(function(r){
    if(r.voided) return false;
    var linkedInv=r.originalInv||r.originalId||'';
    var rdate=r.date||''; var inPeriod=(!from||rdate>=from)&&rdate<=to;
    var forThisCust=!custName||(r.customer||'').toLowerCase()===custLC||(linkedInv&&saleIds[linkedInv]);
    return inPeriod&&forThisCust;
  }).forEach(function(r){entries.push({date:r.date,type:'Credit Note',ref:r.id,debit:0,credit:_CALC.num(r.returnGrand||r.amount||0),note:r.reason||'Return'});});
  _st(state,'customerPayOut').filter(function(p){
    if(p.voided) return false;
    var pdate=p.date||''; var inPeriod=(!from||pdate>=from)&&pdate<=to;
    var forThisCust=!custName||(p.customer||'').toLowerCase()===custLC;
    return inPeriod&&forThisCust;
  }).forEach(function(p){
    entries.push({date:p.date,type:'Cash Refund',ref:p.id,debit:_CALC.num(p.amount||0),credit:0,note:'Refund paid ('+_esc(p.mode||'Cash')+')'+(p.linkedCN?' for '+p.linkedCN:'')});
  });
  entries.sort(function(a,b){return(a.date||'').localeCompare(b.date||'');});
  var running=0;
  var rows=entries.map(function(e){running+=e.debit-e.credit;return Object.assign({},e,{balance:running});});
  if(!sales.length&&!payIn.length)warn.push('No transactions found for this customer/period');
  return{data:{rows:rows,custObj:custObj,custName:custName,running:running},totals:{totalDebit:entries.reduce(function(s,e){return s+e.debit;},0),totalCredit:entries.reduce(function(s,e){return s+e.credit;},0),closingBalance:running},warnings:warn};
};

ReportQuery.customers=function(p,state){
  var search=(p.search||'').toLowerCase(),sortBy=p.sortBy||'outstanding',warn=[];
  var customers=_st(state,'customers').filter(function(c){return !search||(c.n||'').toLowerCase().includes(search)||(c.ph||'').includes(search);});
  var sales=_st(state,'sales').filter(function(s){return !s.deleted;});
  var byId={},byName={};
  sales.forEach(function(s){
    var id=s.customerId!==undefined&&s.customerId!==null?String(s.customerId):'';
    var nm=(s.customer||'').toLowerCase();
    if(id){if(!byId[id])byId[id]=[];byId[id].push(s);}
    if(nm){if(!byName[nm])byName[nm]=[];byName[nm].push(s);}
  });
  var staleLedgerCount=0;
  var enriched=customers.map(function(c){
    var custId=String(c.id||c.n||''),custName=(c.n||'').toLowerCase();
    var seen={};var custSales=[];
    (byId[custId]||[]).forEach(function(s){if(!seen[s.id]){seen[s.id]=true;custSales.push(s);}});
    (byName[custName]||[]).forEach(function(s){if(!seen[s.id]){seen[s.id]=true;custSales.push(s);}});
    var totalRev=custSales.reduce(function(s,x){return s+_CALC.saleTotal(x);},0);
    var outstanding=_CALC.customerOutstanding(custId,c.n,state);
    var salesDerived=custSales.reduce(function(s,x){return s+_CALC.saleOutstanding(x,state);},0);
    if(Math.abs(outstanding-salesDerived)>1)staleLedgerCount++;
    var last=custSales.length?custSales.slice().sort(function(a,b){return(b.date||'').localeCompare(a.date||'');})[0]:null;
    var lastDate=last?last.date:null;
    var daysSince=lastDate?_daysDiff(lastDate):Infinity;
    return{c:c,totalRev:totalRev,outstanding:outstanding,lastDate:lastDate,daysSince:daysSince,atRisk:daysSince>60&&custSales.length>0,txCount:custSales.length};
  });
  if(staleLedgerCount>0)warn.push(staleLedgerCount+' customer(s) have a ledger balance that disagrees with the sales-derived balance by more than Rs.1 — the ledger entry is being shown but may be stale. Check customerLedger sync.');
  enriched.sort(function(a,b){
    var primary=0;
    if(sortBy==='revenue')primary=b.totalRev-a.totalRev;
    else if(sortBy==='outstanding')primary=b.outstanding-a.outstanding;
    else if(sortBy==='lastSale')primary=(b.lastDate||'').localeCompare(a.lastDate||'');
    else return(a.c.n||'').localeCompare(b.c.n||'');
    return primary!==0?primary:(a.c.n||'').localeCompare(b.c.n||'');
  });
  return{data:{enriched:enriched},totals:{totalOutstanding:enriched.reduce(function(s,e){return s+e.outstanding;},0)},warnings:warn};
};

ReportQuery.saleSummary=function(p,state){
  var from=p.from||_monthStart(),to=p.to||_today(),groupBy=p.groupBy||'day',warn=[];p.from=from;p.to=to;
  var sales=_CALC.dateFilter(_st(state,'sales').filter(function(s){return !s.deleted;}),from,to);
  var allReturns=_CALC.dateFilter(_st(state,'saleReturns'),from,to);
  var totalReturns=allReturns.reduce(function(s,r){return s+_CALC.num(r.returnGrand||r.amount||0);},0);
  var groups={};
  sales.forEach(function(s){var key,d=s.date||'';if(groupBy==='day')key=d;else if(groupBy==='week'){var _dts=_ts(d);if(!isNaN(_dts)){var _yd=new Date(_dts);var _y=_yd.getUTCFullYear(),_m=_yd.getUTCMonth(),_dd=_yd.getUTCDate();var _tmpD=Date.UTC(_y,_m,_dd);var _dow=(new Date(_tmpD).getUTCDay()||7);var _tmp2=_tmpD+((4-_dow)*86400000);var _ys=Date.UTC(_y,0,1);var _wn=Math.ceil(((_tmp2-_ys)/86400000+1)/7);key=_y+'-W'+String(_wn).padStart(2,'0');}else{key=d.slice(0,7);}}else key=d.slice(0,7);if(!groups[key])groups[key]={count:0,total:0,paid:0,returns:0};groups[key].count++;groups[key].total+=_CALC.saleTotal(s);groups[key].paid+=_CALC.salePaid(s);});
  allReturns.forEach(function(r){var rd=r.date||'';var key;if(groupBy==='day')key=rd;else if(groupBy==='week'){var _dts2=_ts(rd);if(!isNaN(_dts2)){var _yd2=new Date(_dts2);var _y2=_yd2.getUTCFullYear(),_m2=_yd2.getUTCMonth(),_dd2=_yd2.getUTCDate();var _tmpD2=Date.UTC(_y2,_m2,_dd2);var _dow2=(new Date(_tmpD2).getUTCDay()||7);var _tmp3=_tmpD2+((4-_dow2)*86400000);var _ys2=Date.UTC(_y2,0,1);var _wn2=Math.ceil(((_tmp3-_ys2)/86400000+1)/7);key=_y2+'-W'+String(_wn2).padStart(2,'0');}else{key=rd.slice(0,7);}}else key=rd.slice(0,7);if(key&&groups[key]){groups[key].returns=(groups[key].returns||0)+_CALC.num(r.returnGrand||r.amount||0);}});
  var PKT_OFFSET_HOURS=5;
  var hourMap={};sales.forEach(function(s){var sd=s.date||s.updatedAt||s.createdAt||'';if(sd){var hr=_ts(sd);if(!isNaN(hr)){var _hd=new Date(hr);hr=(_hd.getUTCHours()+PKT_OFFSET_HOURS)%24;}else{hr=0;}hourMap[hr]=(hourMap[hr]||0)+1;}});
  var peakHr=Object.keys(hourMap).sort(function(a,b){return hourMap[b]-hourMap[a];})[0];
  var grandTotal=sales.reduce(function(s,x){return s+_CALC.saleTotal(x);},0),grandPaid=sales.reduce(function(s,x){return s+_CALC.salePaid(x);},0);
  return{data:{groups:groups,groupBy:groupBy,peakHr:peakHr,totalReturns:totalReturns},totals:{grandTotal:grandTotal,grandPaid:grandPaid,count:sales.length,totalReturns:totalReturns,netSales:grandTotal-totalReturns},warnings:warn};
};

ReportQuery.discount=function(p,state){
  var from=p.from||_monthStart(),to=p.to||_today(),warn=[];p.from=from;p.to=to;
  var sales=_CALC.dateFilter(_st(state,'sales').filter(function(s){return !s.deleted;}),from,to);if(!_st(state,'sales').length)warn.push('sales data unavailable');
  var rows=[];sales.forEach(function(s){(s.items||[]).forEach(function(i){var disc=_CALC.num(i.d||0);if(disc<=0)return;var lineAmt=_CALC.num(i.q||0)*_CALC.num(i.p||i.sp||0);rows.push({date:s.date,invoiceId:s.id,customer:s.customer,itemName:i.n,qty:i.q||0,lineAmt:lineAmt,disc:disc,createdBy:s.createdBy});});});
  return{data:{rows:rows},totals:{totalDisc:sales.reduce(function(s,x){return s+_CALC.saleDiscount(x);},0)},warnings:warn};
};

ReportQuery.saleReturns=function(p,state){
  var from=p.from||_today().slice(0,4)+'-01-01',to=p.to||_today(),warn=[];p.from=from;p.to=to;
  var _allReturns=_st(state,'saleReturns');var _salesMap={};_st(state,'sales').forEach(function(s){_salesMap[s.id]=s;});var returns=_allReturns.filter(function(r){var orig=r.invoiceDate||((_salesMap[r.originalInv]&&_salesMap[r.originalInv].date)||r.date||'');return orig>=from&&orig<=to;});
  if(!_st(state,'saleReturns').length)warn.push('saleReturns data unavailable');
  var totalReturnValue=returns.reduce(function(s,r){return s+_CALC.num(r.returnGrand||r.amount||0);},0);
  var totalCashOut=returns.reduce(function(s,r){return s+_CALC.num(r.cashPaidOut||0);},0);
  var totalStoreCredit=returns.reduce(function(s,r){
    var rv=_CALC.num(r.returnGrand||r.amount||0);
    var cp=_CALC.num(r.cashPaidOut||0);
    return s+Math.max(0,rv-cp);
  },0);
  return{data:{rows:returns.slice().sort(function(a,b){return(b.date||'').localeCompare(a.date||'');})},
         totals:{totalReturnValue:totalReturnValue,totalCashOut:totalCashOut,totalStoreCredit:totalStoreCredit,totalRefund:totalReturnValue},
         warnings:warn};
};

ReportQuery.payIn=function(p,state){
  var from=p.from||_monthStart(),to=p.to||_today(),method=p.method||'',warn=[];p.from=from;p.to=to;
  var payments=_CALC.dateFilter(_st(state,'payIn').filter(function(p){return !p.voided;}),from,to);if(!_st(state,'payIn').length)warn.push('payIn data unavailable');
  if(method)payments=payments.filter(function(p){return(p.method||'').toLowerCase()===method.toLowerCase();});
  var total=payments.reduce(function(s,p){return s+_CALC.num(p.amount);},0);
  return{data:{rows:payments.slice().sort(function(a,b){return(b.date||'').localeCompare(a.date||'');})},totals:{total:total},warnings:warn};
};

ReportQuery.lowStock=function(p,state){
  var threshold=parseInt(p.threshold||'0',10),warn=[];
  var inventory=_st(state,'inventory'),suppliers=_st(state,'suppliers'),sales=_st(state,'sales');
  if(!inventory.length)warn.push('inventory data unavailable');
  var items=inventory.filter(function(i){if(i._archived)return false;var m=_CALC.num(i.minSt||5);return _CALC.num(i.st)<=(threshold>0?threshold:m);}).slice().sort(function(a,b){return _CALC.num(a.st)-_CALC.num(b.st);});
  var rows=items.map(function(item){var sup=suppliers.find(function(s){return String(s.id)===String(item.supplierId);});return{item:item,sup:sup||null,daysOfStock:_CALC.daysOfStock(item,sales)};});
  return{data:{rows:rows},totals:{lowStockCount:items.length,outOfStockCount:items.filter(function(i){return i.st<=0;}).length},warnings:warn};
};

ReportQuery.stockValuation=function(p,state){
  var catFilter=(p.cat||'').toLowerCase(),warn=[];
  var inventory=_st(state,'inventory'),sales=_st(state,'sales');
  if(!inventory.length)warn.push('inventory data unavailable');
  var items=inventory.filter(function(i){return !i._archived&&(!catFilter||(i.cat||'').toLowerCase().includes(catFilter));});
  var lastSaleMap={};sales.forEach(function(s){(s.items||[]).forEach(function(si){var bc=si.bc||si.sku;if(!bc)return;if(!lastSaleMap[bc]||s.date>lastSaleMap[bc])lastSaleMap[bc]=s.date;});});
  var rows=items.map(function(item){var st=_CALC.num(item.st),pp=_CALC.num(item.pp),sp=_CALC.num(item.sp);var last=lastSaleMap[item.bc];var daysSince=last?_daysDiff(last):Infinity;return{item:item,costVal:st*pp,mktVal:st*sp,potProfit:st*sp-st*pp,margin:_CALC.itemMargin(item),lastSale:last,daysSince:daysSince,isDead:daysSince>90&&st>0};});
  var totalCost=rows.reduce(function(s,r){return s+r.costVal;},0),totalMkt=rows.reduce(function(s,r){return s+r.mktVal;},0);
  var ledger={ready:_ledgerReady()};
  if(ledger.ready){ledger.glValue=_SLQ.inventoryValue();ledger.received=_SLQ.stockReceivedForPeriod(_monthStart(),_today());ledger.consumed=_SLQ.stockConsumedForPeriod(_monthStart(),_today());ledger.totalCOGS=_SLQ.totalCOGS();}
  return{data:{rows:rows,ledger:ledger},totals:{totalCost:totalCost,totalMkt:totalMkt,potProfit:totalMkt-totalCost,deadItemCount:rows.filter(function(r){return r.isDead;}).length},warnings:warn};
};

ReportQuery.itemPL=function(p,state){
  var from=p.from||_monthStart(),to=p.to||_today(),warn=[];p.from=from;p.to=to;
  var sales=_CALC.dateFilter(_st(state,'sales').filter(function(s){return !s.deleted;}),from,to),returns=_CALC.dateFilter(_st(state,'saleReturns'),from,to),inv=_st(state,'inventory');
  var itemMap={};inv.forEach(function(i){itemMap[i.bc]=i;});
  var salesMap={};
  var nameMap={};inv.forEach(function(i){if(i.n)nameMap[i.n.toLowerCase()]=i;});
  sales.forEach(function(s){(s.items||[]).forEach(function(si){var key=si.bc||si.sku;if(!key){var nm=(si.n||'').toLowerCase();var match=nameMap[nm];if(match&&match.bc){key=match.bc;}else{warn.push('Item missing barcode in invoice '+s.id+': '+si.n+' — use item name as key');key='NAME:'+nm;}}if(!salesMap[key])salesMap[key]={name:si.n,qty:0,revenue:0,cost:0,disc:0};salesMap[key].qty+=_CALC.num(si.q);salesMap[key].revenue+=_CALC.num(si.q)*_CALC.num(si.p||si.sp||0);salesMap[key].disc+=_CALC.num(si.d||0);salesMap[key].cost+=_CALC.num(si.q)*(itemMap[key]?_CALC.num(itemMap[key].pp):0);});});
  returns.forEach(function(r){(r.items||[]).forEach(function(ri){var key=ri.bc||ri.sku;if(!key){var nm=(ri.n||'').toLowerCase();var match=nameMap[nm];if(match&&match.bc){key=match.bc;}else{key='NAME:'+nm;}}if(!salesMap[key])return;salesMap[key].revenue=Math.max(0,salesMap[key].revenue-_CALC.num(ri.q)*_CALC.num(ri.p||0));salesMap[key].qty=Math.max(0,salesMap[key].qty-_CALC.num(ri.q));salesMap[key].cost=Math.max(0,salesMap[key].cost-_CALC.num(ri.q)*(itemMap[key]?_CALC.num(itemMap[key].pp):0));});});
  var rows=Object.keys(salesMap).map(function(k){return Object.assign({bc:k},salesMap[k]);}).sort(function(a,b){return(b.revenue-b.cost-b.disc)-(a.revenue-a.cost-a.disc);});
  var totRev=Object.values(salesMap).reduce(function(s,x){return s+x.revenue;},0),totCost=Object.values(salesMap).reduce(function(s,x){return s+x.cost;},0),totDisc=Object.values(salesMap).reduce(function(s,x){return s+x.disc;},0),totQty=Object.values(salesMap).reduce(function(s,x){return s+x.qty;},0);
  var ledger={ready:_ledgerReady()};
  if(ledger.ready){ledger.revenue=_GLQ.revenueForPeriod(from,to);ledger.cogs=_SLQ.cogsForPeriod(from,to);ledger.gross=ledger.revenue-ledger.cogs;ledger.margin=_SLQ.grossMarginPct(from,to);}
  return{data:{rows:rows,ledger:ledger},totals:{totRev:totRev,totCost:totCost,totDisc:totDisc,totQty:totQty,totProfit:totRev-totCost-totDisc},warnings:warn};
};

ReportQuery.stockMovement=function(p,state){
  var from=p.from||_monthStart(),to=p.to||_today(),itemFilter=(p.item||'').toLowerCase(),warn=[];p.from=from;p.to=to;
  var movements=_CALC.dateFilter(_st(state,'stockMovements'),from,to);
  if(!_st(state,'stockMovements').length)warn.push('stockMovements data unavailable');
  if(itemFilter)movements=movements.filter(function(m){return(m.itemName||m.n||m.bc||'').toLowerCase().includes(itemFilter);});
  var rows=movements.slice().sort(function(a,b){return(b.date||'').localeCompare(a.date||'');});
  var stockIn=rows.filter(function(m){return m.qty>0;}).reduce(function(s,m){return s+m.qty;},0);
  var stockOut=rows.filter(function(m){return m.qty<0;}).reduce(function(s,m){return s+m.qty;},0);stockOut=Math.abs(stockOut);
  return{data:{rows:rows},totals:{count:rows.length,stockIn:stockIn,stockOut:stockOut},warnings:warn};
};

ReportQuery.batchExpiry=function(p,state){
  var days=parseInt(p.days||'30',10),now=_ts(_today()),cutoff=now+days*86400000,warn=[];
  var batches=_st(state,'stockBatches');if(!batches.length)warn.push('stockBatches data unavailable');
  var enriched=batches.map(function(b){var expTs=b.expiry?_ts(b.expiry):Infinity,daysLeft=expTs===Infinity?Infinity:Math.floor((expTs-now)/86400000);return Object.assign({},b,{_expTs:expTs,_daysLeft:daysLeft});});
  var expiring=enriched.filter(function(b){return b._expTs<=cutoff&&b._expTs>0;});
  var expired=expiring.filter(function(b){return b._daysLeft<=0;});
  return{data:{rows:expiring.slice().sort(function(a,b){return a._expTs-b._expTs;})},totals:{expiringCount:expiring.length,expiredCount:expired.length},warnings:warn};
};

ReportQuery.purchaseLedger=function(p,state){
  var from=p.from||_today().slice(0,4)+'-01-01',to=p.to||_today(),supFilter=(p.sup||'').toLowerCase(),statusFilter=p.status||'',warn=[];p.from=from;p.to=to;
  var allPurchases=_st(state,'purchases').filter(function(x){return !x._deleted;});
  if(!allPurchases.length)warn.push('purchases data unavailable');
  var purchases=_CALC.dateFilter(allPurchases,from,to);
  if(supFilter)purchases=purchases.filter(function(p){return(p.supplierName||p.sup||'').toLowerCase().includes(supFilter);});
  if(statusFilter){
    purchases=purchases.filter(function(p){
      var st=(p.status||p.payStatus||'').toLowerCase();
      var stFilter=statusFilter.toLowerCase();
      return st===stFilter||(stFilter==='complete'&&(st==='paid'||st==='complete'||st==='completed'))||(stFilter==='partial'&&st==='partial');
    });
  }
  purchases=purchases.slice().sort(function(a,b){return(a.date||'').localeCompare(b.date||'');});
  purchases=purchases.map(function(p){return Object.assign({},p,{_due:_CALC.purOutstanding(p,state)});});
  var totPurchase=purchases.reduce(function(s,p){return s+_CALC.purTotal(p);},0);
  var totPaid=purchases.reduce(function(s,p){return s+_CALC.purPaid(p);},0);
  var totDue=purchases.reduce(function(s,p){return s+_CALC.purOutstanding(p,state);},0);
  var ledger={ready:_ledgerReady()};if(ledger.ready){ledger.apRaised=_VLQ.apRaisedForPeriod(from,to);ledger.apPaid=_VLQ.vendorPaymentsForPeriod(from,to);ledger.apBalance=_VLQ.totalPayable();}
  return{data:{rows:purchases,ledger:ledger},totals:{totPurchase:totPurchase,totPaid:totPaid,totDue:totDue},warnings:warn};
};

ReportQuery.suppliers=function(p,state){
  var search=(p.search||'').toLowerCase(),from=p.from||'',to=p.to||_today(),warn=[];
  var suppliers=_st(state,'suppliers').filter(function(s){return !search||(s.n||'').toLowerCase().includes(search)||(s.ph||'').includes(search);});
  var purchases=_st(state,'purchases').filter(function(x){return !x._deleted;});
  var returns=_st(state,'purchaseReturns')||[];
  if(!suppliers.length)warn.push('suppliers data unavailable');
  var rows=suppliers.map(function(sup){
    var sn=(sup.n||'').toLowerCase().trim().replace(/\s+/g,' ');
    var trueId=String(sup.id||'').toLowerCase().trim().replace(/\s+/g,' ');
    // FIX (Accounts Payable / triple-ledger-drift bug): purchases, POs, payments
    // and returns now always carry the supplier's real, stable party.id as their
    // supplierId (see ERP.parties.resolveSupplierId / migrateSupplierIds), so id
    // is the primary match. Name matching is kept only as a defensive fallback
    // for any pre-migration record that might have slipped through, and blank
    // names never fall back to a shared '' key (that used to silently merge
    // every blank-name supplier's purchases into one report row).
    var sid=trueId||sn;
    var sp=purchases.filter(function(p){
      var st=(p.status||p.st||'').toLowerCase();
      var pName=(p.supplierName||p.sup||'').toLowerCase().trim().replace(/\s+/g,' ');
      var pSid=String(p.supplierId||'').toLowerCase().trim().replace(/\s+/g,' ');
      var idMatch=trueId&&pSid===trueId;
      var nameMatch=!trueId&&((sn&&pName===sn)||(sid&&pSid===sid));
      return (idMatch||nameMatch)&&st!=='cancelled'&&(!from||_ts(p.date)>=_ts(from))&&_ts(p.date)<=_ts(to);
    });
    var tp=sp.reduce(function(s,p){return s+_CALC.purTotal(p);},0);
    var supReturns=returns.filter(function(r){
      var rSup=(r.supplierName||r.sup||'').toLowerCase().trim().replace(/\s+/g,' ');
      var rSid=String(r.supplierId||'').toLowerCase().trim().replace(/\s+/g,' ');
      var idMatch=trueId&&rSid===trueId;
      var nameMatch=!trueId&&((sn&&rSup===sn)||(sid&&rSid===sid));
      return idMatch||nameMatch;
    });
    var totalReturned=supReturns.reduce(function(s,r){return s+_CALC.num(r.total||0);},0);
    var tout=0;
    try{
      if(global.PurchaseState&&typeof global.PurchaseState.getLedgerBalance==='function'){
        var lb=global.PurchaseState.getLedgerBalance(sid);
        tout=lb/100;
      }else{
        tout=sp.reduce(function(s,p){return s+_CALC.purOutstanding(p,state);},0);
      }
    }catch(_le){tout=sp.reduce(function(s,p){return s+_CALC.purOutstanding(p,state);},0);}
    var tpd=sp.reduce(function(s,p){return s+_CALC.purPaid(p);},0);
    var supStatus=tout<=0?'Clear':'Outstanding';
    var last=sp.length?sp.slice().sort(function(a,b){return(b.date||'').localeCompare(a.date||'');})[0].date:null;
    return{sup:sup,txCount:sp.length,totalPurchase:tp,totalPaid:tpd,outstanding:tout,totalReturned:totalReturned,lastPurchase:last,status:supStatus};
  });
  var totalPayable=rows.reduce(function(s,r){return s+r.outstanding;},0);
  var ledger={ready:_ledgerReady()};if(ledger.ready){ledger.glAP=_VLQ.totalPayable();ledger.subTotal=totalPayable;}
  return{data:{rows:rows,ledger:ledger},totals:{supplierCount:suppliers.length,totalPayable:totalPayable},warnings:warn};
};

ReportQuery.purchaseReturns=function(p,state){
  var from=p.from||_today().slice(0,4)+'-01-01',to=p.to||_today(),warn=[];p.from=from;p.to=to;
  var returns=_CALC.dateFilter(_st(state,'purchaseReturns'),from,to);if(!_st(state,'purchaseReturns').length)warn.push('purchaseReturns data unavailable');
  var reasonMap={},supMap={};
  returns.forEach(function(r){var k=r.reason||'Not specified';reasonMap[k]=(reasonMap[k]||0)+1;var s=r.supplierName||r.sup||'Unknown';if(!supMap[s])supMap[s]=0;supMap[s]+=_CALC.num(r.total||0);});
  var totalRefund=returns.reduce(function(s,r){return s+_CALC.num(r.total||0);},0);
  return{data:{rows:returns.slice().sort(function(a,b){return(b.date||'').localeCompare(a.date||'');}),reasonMap:reasonMap,supMap:supMap},totals:{count:returns.length,totalRefund:totalRefund},warnings:warn};
};

ReportQuery.pl=function(p,state){
  var from=p.from||_monthStart(),to=p.to||_today(),warn=[];p.from=from;p.to=to;
  var sales=_CALC.dateFilter(_st(state,'sales').filter(function(s){return !s.deleted;}),from,to),returns=_CALC.dateFilter(_st(state,'saleReturns'),from,to),purchases=_CALC.dateFilter(_st(state,'purchases'),from,to),expenses=_CALC.dateFilter(_st(state,'expenses'),from,to);
  var invAll=_st(state,'inventory'),invMap={};invAll.forEach(function(i){invMap[i.bc]=i;});
  var jobs=_st(state,'jobs').filter(function(j){return(j.closedAt||j.date)&&_ts(j.closedAt||j.date)>=_ts(from)&&_ts(j.closedAt||j.date)<=_ts(to);});
  var labourRev=jobs.reduce(function(s,j){return s+_CALC.num(j.labour||0);},0);
  var ledgerActive=_ledgerReady();
  var grossSales,returnAmt,cogs;
  returnAmt=returns.reduce(function(s,r){return s+_CALC.num(r.returnGrand||r.amount||0);},0);
  if(ledgerActive){
    var _rawGLRev=_GLQ.revenueForPeriod(from,to)||0;
    var _glRetDR=0;var _glDiscDR=0;
    try{var _glJ=_GL()&&typeof _GL().getAllJournals==='function'?_GL().getAllJournals():[]; _glJ.forEach(function(j){if(!j||j.status==='reversed')return;var d=j.date||'';if(d<from||d>to)return;(j.entries||[]).forEach(function(e){if(e.accountId==='acc-4001'&&_CALC.num(e.debit)>0)_glRetDR+=_CALC.num(e.debit);if(e.accountId==='acc-4003'&&_CALC.num(e.debit)>0)_glDiscDR+=_CALC.num(e.debit);});});}catch(_){}
    grossSales=Math.max(0,_rawGLRev-_glRetDR-_glDiscDR);cogs=_SLQ.cogsForPeriod(from,to)||0;
    var _naiveSales=sales.reduce(function(s,x){return s+_CALC.saleTotal(x);},0);
    if(Math.abs(_naiveSales-(grossSales+returnAmt))>1){var _mismatchMsg='GL/sub-ledger mismatch: GL revenue(net of returns/disc)='+(grossSales+returnAmt).toFixed(2)+' sales-record total='+_naiveSales.toFixed(2)+' period='+from+'..'+to;console.warn('[ReportQuery.pl] '+_mismatchMsg);warn.push(_mismatchMsg);}
  } else {
    grossSales=sales.reduce(function(s,x){return s+_CALC.saleTotal(x);},0);cogs=0;sales.forEach(function(s){if(s.id&&s.id.toString().indexOf('JINV-')===0)return;(s.items||[]).forEach(function(si){var key=si.bc||si.sku;var item=key?invMap[key]:invAll.find(function(x){return x.n===si.n;});cogs+=(item?_CALC.num(item.pp):0)*_CALC.num(si.q);});});
  }
  var netRevenue=ledgerActive?(grossSales+labourRev):(grossSales-returnAmt+labourRev),grossProfit=netRevenue-cogs;
  var expByCategory={};expenses.forEach(function(e){var cat=e.cat||'General';var amt=e.amtPaisa!=null?e.amtPaisa/100:_CALC.num(e.amt||0);expByCategory[cat]=(expByCategory[cat]||0)+amt;});
  var totalExpenses=expenses.reduce(function(s,e){var amt=e.amtPaisa!=null?e.amtPaisa/100:_CALC.num(e.amt||0);return s+amt;},0);
  var jobPartsCost=jobs.reduce(function(s,j){return s+(j.parts||[]).reduce(function(ps,p){var historicalCost=_CALC.num(p.costPrice||p.cp||0);if(historicalCost>0)return ps+historicalCost*_CALC.num(p.q||1);var item=invMap[p.bc||p.sku]||invAll.find(function(x){return x.n===p.n;});return ps+(item?_CALC.num(item.pp):0)*_CALC.num(p.q||1);},0);},0);
  var _openingCostMissing=0;
  var openingStock=invAll.reduce(function(s,i){var qty=_CALC.num(i.openingSt||0);if(qty<=0)return s;var unitCost=(typeof i.openingCost==='number')?_CALC.num(i.openingCost):null;if(unitCost===null){unitCost=_CALC.num(i.pp||0);_openingCostMissing++;}return s+qty*unitCost;},0);
  if(_openingCostMissing>0)warn.push(_openingCostMissing+' item(s) have no recorded opening cost — current purchase price was used as an estimate, which may not reflect the true historical cost.');
  var closingStock=invAll.reduce(function(s,i){return s+(_CALC.num(i.st||0)*_CALC.num(i.pp||0));},0);
  var purchasesAmt=purchases.reduce(function(s,p){return s+_CALC.num(p.total||p.amt||0);},0);
  var depreciationAmt=expenses.filter(function(e){return(e.cat||'').toLowerCase().indexOf('depreciation')!==-1;}).reduce(function(s,e){var amt=e.amtPaisa!=null?e.amtPaisa/100:_CALC.num(e.amt||0);return s+amt;},0);
  var cogsTraditional=openingStock+purchasesAmt-closingStock;
  if(ledgerActive){var _glAPCr=_GLQ.apRaisedForPeriod(from,to)||0;var _naivePur=purchases.reduce(function(s,p){return s+_CALC.num(p.total||p.amt||0);},0);if(Math.abs(_naivePur-_glAPCr)>1){var _purMismatch='GL/sub-ledger mismatch (purchases): GL AP raised='+_glAPCr.toFixed(2)+' purchase-record total='+_naivePur.toFixed(2)+' period='+from+'..'+to;console.warn('[ReportQuery.pl] '+_purMismatch);warn.push(_purMismatch);}}
  var netProfit=grossProfit-totalExpenses-(ledgerActive?0:jobPartsCost);
  if(!_st(state,'sales').length)warn.push('sales data unavailable');
  return{data:{ledgerActive:ledgerActive,grossSales:grossSales,returnAmt:returnAmt,labourRev:labourRev,netRevenue:netRevenue,cogs:cogs,cogsTraditional:cogsTraditional,openingStock:openingStock,closingStock:closingStock,purchasesAmt:purchasesAmt,depreciationAmt:depreciationAmt,grossProfit:grossProfit,expByCategory:expByCategory,totalExpenses:totalExpenses,jobPartsCost:jobPartsCost,netProfit:netProfit},totals:{netProfit:netProfit,netRevenue:netRevenue},warnings:warn};
};

ReportQuery.balanceSheet=function(p,state){
  var asOf=p.asOf||_today(),warn=[];
  var ledgerActive=_ledgerReady()&&!!_GL()&&!!_VL();
  var invValue,totalAR,totalCash,totalAP;
  if(ledgerActive){totalCash=_GLQ.balance('acc-1001')+_GLQ.balance('acc-1002');totalAR=_VLQ.totalReceivable();invValue=_SLQ.inventoryValue();totalAP=_VLQ.totalPayable();}
  else{var inv=_st(state,'inventory'),customers=_st(state,'customers'),purchases=_st(state,'purchases'),bankTxns=_st(state,'bankTransactions');invValue=inv.reduce(function(s,i){return s+_CALC.num(i.st)*_CALC.num(i.pp);},0);totalAR=customers.reduce(function(s,c){return s+_CALC.customerOutstanding(String(c.id||c.n),c.n,state);},0);var cashSales=_CALC.dateFilter(_st(state,'sales'),null,asOf).filter(function(s){return !s.deleted&&s.pay!=='Credit';}).reduce(function(s,x){return s+_CALC.salePaid(x);},0);
var bkDeps=bankTxns.filter(function(t){return(t.type||'')==='deposit';}).reduce(function(s,t){return s+_CALC.num(t.amount);},0);var bkWith=bankTxns.filter(function(t){return(t.type||'')==='withdrawal';}).reduce(function(s,t){return s+_CALC.num(t.amount);},0);totalCash=cashSales+(bkDeps-bkWith);totalAP=_st(state,'suppliers').reduce(function(s,sup){var sn=(sup.n||'').toLowerCase();return s+purchases.filter(function(p){var st=(p.status||p.st||'').toLowerCase();return(p.supplierName||p.sup||'').toLowerCase()===sn&&st!=='cancelled'&&st!=='returned';}).reduce(function(s,p){return s+_CALC.purOutstanding(p,state);},0);},0);
warn.push('Ledger not ready — figures from raw state data');}
  if(ledgerActive&&!_GLQ.isBalanced()){warn.push('GL integrity check failed — ledger debits do not equal credits. Figures below may be unreliable.');}
  if(ledgerActive){var _PS=window.PurchaseState||null;if(_PS&&typeof _PS.getLedgerBalance==='function'&&typeof _PS.PurchaseParties!=='undefined'){var _sups=(_PS.PurchaseParties&&typeof _PS.PurchaseParties.getSuppliers==='function')?_PS.PurchaseParties.getSuppliers():(_st(state,'suppliers')||[]);var _subLedgerAP=_sups.reduce(function(s,sup){try{return s+Math.max(0,_PS.getLedgerBalance(String(sup.id||sup.n||'').toLowerCase().trim())/100);}catch(_){return s;}},0);var _apDiff=Math.abs(totalAP-_subLedgerAP);if(_apDiff>1){var _apMismatch='GL/sub-ledger AP mismatch: GL acc-2001='+totalAP.toFixed(2)+' purchase sub-ledger total='+_subLedgerAP.toFixed(2)+' (delta='+_apDiff.toFixed(2)+')';console.warn('[ReportQuery.bs] '+_apMismatch);warn.push(_apMismatch);}}}
  var loans=(state&&state.data&&state.data.loans)||[];
  var expPay=_CALC.dateFilter(_st(state,'expenses'),null,asOf).reduce(function(s,e){return s+_CALC.num(e.amt);},0);
  var loanBal=loans.reduce(function(s,l){return s+_CALC.num(l.amount)-_CALC.num(l.paid);},0);
  var totalAssets=invValue+totalAR+totalCash,totalLiabilities=totalAP+loanBal+expPay;
  return{data:{ledgerActive:!!ledgerActive,invValue:invValue,totalAR:totalAR,totalCash:totalCash,totalAP:totalAP,loanBal:loanBal,expPay:expPay},totals:{totalAssets:totalAssets,totalLiabilities:totalLiabilities,equity:totalAssets-totalLiabilities},warnings:warn};
};

ReportQuery.cashFlow=function(p,state){
  var from=p.from||_monthStart(),to=p.to||_today(),warn=[];p.from=from;p.to=to;
  var bankTxns=_st(state,'bankTransactions');
  var _isBankLikeMethod=function(m){m=(m||'').toLowerCase().trim();return m==='bank'||m==='bank transfer'||m.indexOf('bank')!==-1||m==='cheque'||m==='check'||m==='upi'||m==='online';};
  var _allPayIn=_CALC.dateFilter(_st(state,'payIn').filter(function(p){return !p.voided;}),from,to);var cashIn=_allPayIn.filter(function(p){var m=(p.mode||'').toLowerCase();return m==='cash'||m===''||m==='online'||m==='jazzcash'||m==='easypaisa';}).reduce(function(s,p){return s+_CALC.num(p.amount);},0);
  var _allPayOut=_CALC.dateFilter(_st(state,'payOut').filter(function(p){return !p.voided;}),from,to);
  var cashOut=_allPayOut.filter(function(p){return !_isBankLikeMethod(p.method||p.mode);}).reduce(function(s,p){return s+_CALC.num(p.amount);},0);
  var _bankPayOut=_allPayOut.filter(function(p){return _isBankLikeMethod(p.method||p.mode);}).reduce(function(s,p){return s+_CALC.num(p.amount);},0);
  var expOut=_CALC.dateFilter(_st(state,'expenses'),from,to).reduce(function(s,e){return s+_CALC.num(e.amt);},0);
  var _bankPayIn=_allPayIn.filter(function(p){var m=(p.mode||'').toLowerCase();return m==='bank transfer'||m==='cheque'||m==='bank';}).reduce(function(s,p){return s+_CALC.num(p.amount);},0);var bankIn=_CALC.dateFilter(bankTxns,from,to).filter(function(t){return(t.type||'')==='deposit';}).reduce(function(s,t){return s+_CALC.num(t.amount);},0)+_bankPayIn;
  var bankOut=_CALC.dateFilter(bankTxns,from,to).filter(function(t){return(t.type||'')==='withdrawal';}).reduce(function(s,t){return s+_CALC.num(t.amount);},0)+_bankPayOut;
  var netCash=cashIn+bankIn-cashOut-expOut-bankOut;
  var ledger={ready:_ledgerReady()};
  if(ledger.ready){var sa=_SA();if(sa){var j=_journalsInRange(from,to);ledger.cashIn=_fromPaisa(_sumDr(j,sa.CASH||'acc-1001'));ledger.cashOut=_fromPaisa(_sumCr(j,sa.CASH||'acc-1001'));ledger.bankIn=_fromPaisa(_sumDr(j,sa.BANK||'acc-1002'));ledger.bankOut=_fromPaisa(_sumCr(j,sa.BANK||'acc-1002'));ledger.netCash=(ledger.cashIn+ledger.bankIn)-(ledger.cashOut+ledger.bankOut);}}
  return{data:{cashIn:cashIn,cashOut:cashOut,expOut:expOut,bankIn:bankIn,bankOut:bankOut,ledger:ledger},totals:{netCash:netCash},warnings:warn};
};

ReportQuery.expenses=function(p,state){
  var from=p.from||_monthStart(),to=p.to||_today(),cat=(p.cat||'').toLowerCase(),warn=[];p.from=from;p.to=to;
  var expenses=_CALC.dateFilter(_st(state,'expenses'),from,to);if(!_st(state,'expenses').length)warn.push('expenses data unavailable');
  if(cat)expenses=expenses.filter(function(e){return(e.cat||'').toLowerCase().includes(cat);});
  var catMap={};expenses.forEach(function(e){var k=e.cat||'General';if(!catMap[k])catMap[k]=0;catMap[k]+=_CALC.num(e.amt);});
  var total=expenses.reduce(function(s,e){return s+_CALC.num(e.amt);},0);
  return{data:{rows:expenses.slice().sort(function(a,b){return(b.date||'').localeCompare(a.date||'');}),catMap:catMap},totals:{total:total},warnings:warn};
};

ReportQuery.dailyCashBook=function(p,state){
  var date=p.date||_today(),warn=[];
  var from=date,to=date;
  var allPayIn=_CALC.dateFilter(_st(state,'payIn').filter(function(x){return !x.voided;}),from,to);
  var cashIn=allPayIn.filter(function(x){var m=(x.mode||x.method||'Cash').toLowerCase();return m==='cash'||m==='jazzcash'||m==='easypaisa'||m==='online'||m==='cash in hand';});
  var totalCashIn=cashIn.reduce(function(s,x){return s+_CALC.num(x.amount);},0);
  var allPayOut=_CALC.dateFilter(_st(state,'payOut').filter(function(x){return !x.voided;}),from,to);
  var totalCashOut=allPayOut.reduce(function(s,x){return s+_CALC.num(x.amount||x.amt);},0);
  var expRows=_CALC.dateFilter(_st(state,'expenses'),from,to).filter(function(e){var m=(e.method||'Cash').toLowerCase();return m==='cash'||m==='cash in hand';});
  var totalExpOut=expRows.reduce(function(s,e){return s+_CALC.num(e.amt);},0);
  var cpoRows=_CALC.dateFilter((_st(state,'customerPayOut')||[]).filter(function(x){return !x.voided;}),from,to).filter(function(x){var m=(x.mode||'Cash').toLowerCase();return m==='cash'||m==='cash in hand';});
  var totalRefundOut=cpoRows.reduce(function(s,x){return s+_CALC.num(x.amount);},0);
  var cashSales=_CALC.dateFilter(_st(state,'sales').filter(function(s){return !s.deleted&&(s.pay||'Cash').toLowerCase()==='cash'&&(s.paid||0)>0;}),from,to);
  var totalSalesCash=cashSales.reduce(function(s,x){return s+_CALC.num(x.paid||0);},0);
  var netCash=totalCashIn+totalSalesCash-totalCashOut-totalExpOut-totalRefundOut;
  if(!cashIn.length&&!cashSales.length&&!allPayOut.length&&!expRows.length&&!cpoRows.length)warn.push('Is date ka koi cash transaction nahi mila');
  return{
    data:{date:date,cashIn:cashIn,cashSales:cashSales,payOut:allPayOut,expenses:expRows,refunds:cpoRows},
    totals:{totalCashIn:totalCashIn,totalSalesCash:totalSalesCash,totalCashOut:totalCashOut,totalExpOut:totalExpOut,totalRefundOut:totalRefundOut,netCash:netCash},
    warnings:warn
  };
};

ReportQuery.bankStatement=function(p,state){
  var from=p.from||_monthStart(),to=p.to||_today(),warn=[];p.from=from;p.to=to;
  var txns=_CALC.dateFilter(_st(state,'bankTransactions'),from,to).slice().sort(function(a,b){return(a.date||'').localeCompare(b.date||'');});
  if(!_st(state,'bankTransactions').length)warn.push('bankTransactions data unavailable');
  var running=0;
  var rows=txns.map(function(t){var amt=_CALC.num(t.amount),isIn=(t.type||'').toLowerCase()==='deposit';if(isIn)running+=amt;else running-=amt;return Object.assign({},t,{_amt:amt,_isIn:isIn,_balance:running});});
  var totalIn=txns.filter(function(t){return(t.type||'').toLowerCase()==='deposit';}).reduce(function(s,t){return s+_CALC.num(t.amount);},0);
  var totalOut=txns.filter(function(t){return(t.type||'').toLowerCase()!=='deposit';}).reduce(function(s,t){return s+_CALC.num(t.amount);},0);
  return{data:{rows:rows},totals:{totalIn:totalIn,totalOut:totalOut,closingBalance:running},warnings:warn};
};

ReportQuery.jobs=function(p,state){
  var from=p.from||_monthStart(),to=p.to||_today(),mechFilter=(p.mech||'').toLowerCase(),statusFilter=p.status||'',warn=[];p.from=from;p.to=to;
  var inventory=_st(state,'inventory');
  var jobs=_st(state,'jobs').filter(function(j){var d=j.date||j.openedAt||'';return _ts(d)>=_ts(from)&&_ts(d)<=_ts(to);});
  if(!_st(state,'jobs').length)warn.push('jobs data unavailable');
  if(mechFilter)jobs=jobs.filter(function(j){return(j.mechanic||'').toLowerCase().includes(mechFilter);});
  if(statusFilter)jobs=jobs.filter(function(j){return(j.status||'')===statusFilter;});
  var statusCount={};jobs.forEach(function(j){var st=j.status||'pending';statusCount[st]=(statusCount[st]||0)+1;});
  var rows=jobs.slice().sort(function(a,b){return(b.date||b.openedAt||'').localeCompare(a.date||a.openedAt||'');}).map(function(j){var open=j.openedAt||j.date||'',close=j.closedAt||(j.status==='delivered'?j.updatedAt:null)||'';var dur=(open&&close)?_daysDiff(open.slice(0,10),close.slice(0,10)):null;return Object.assign({},j,{_profit:_CALC.jobProfit(j,inventory),_duration:dur});});
  var totalRev=jobs.reduce(function(s,j){return s+_CALC.num(j.labour||0);},0),totalProfit=rows.reduce(function(s,j){return s+j._profit;},0);
  return{data:{rows:rows,statusCount:statusCount},totals:{count:jobs.length,totalRev:totalRev,totalProfit:totalProfit},warnings:warn};
};

ReportQuery.mechanicPerformance=function(p,state){
  var from=p.from||_monthStart(),to=p.to||_today(),warn=[];p.from=from;p.to=to;
  var inventory=_st(state,'inventory');
  var jobs=_st(state,'jobs').filter(function(j){var d=j.date||j.openedAt||'';return _ts(d)>=_ts(from)&&_ts(d)<=_ts(to)&&j.mechanic;});
  if(!_st(state,'jobs').length)warn.push('jobs data unavailable');
  var mMap={};
  jobs.forEach(function(j){var m=j.mechanic||'Unknown';if(!mMap[m])mMap[m]={name:m,jobs:0,revenue:0,profit:0,completedJobs:0,totalDays:0,closedJobs:0};mMap[m].jobs++;mMap[m].revenue+=_CALC.num(j.labour||0);mMap[m].profit+=_CALC.jobProfit(j,inventory);var jStatus=(j.status||'').toLowerCase();if(jStatus==='delivered'||jStatus==='completed'){mMap[m].completedJobs++;var op=j.openedAt||j.date||'',cl=j.closedAt||'';if(op&&cl){mMap[m].totalDays+=_daysDiff(op.slice(0,10),cl.slice(0,10));mMap[m].closedJobs++;}}});
  return{data:{rows:Object.values(mMap).slice().sort(function(a,b){return b.revenue-a.revenue;})},totals:{},warnings:warn};
};

ReportQuery.vehicleHistory=function(p,state){
  var plate=(p.plate||'').toUpperCase().trim(),warn=[];
  if(!plate)return{data:{plate:''},totals:{},warnings:warn};
  var vehicles=_st(state,'vehicles'),jobs=_st(state,'jobs').filter(function(j){return(j.plate||'').toUpperCase()===plate;});
  var vehicle=vehicles.find(function(v){return(v.plate||'').toUpperCase()===plate;});
  var totalSpend=jobs.reduce(function(s,j){return s+_CALC.num(j.labour||0)+(j.parts||[]).reduce(function(ps,p){return ps+_CALC.num(p.p||0)*_CALC.num(p.q||1);},0);},0);
  var rows=jobs.slice().sort(function(a,b){return(b.date||b.openedAt||'').localeCompare(a.date||a.openedAt||'');}).map(function(j){var parts=(j.parts||[]).map(function(p){return p.n+' x'+p.q;}).join(', ');var jobTotal=_CALC.num(j.labour||0)+(j.parts||[]).reduce(function(s,p){return s+_CALC.num(p.p||0)*_CALC.num(p.q||1);},0);return Object.assign({},j,{_parts:parts,_jobTotal:jobTotal});});
  return{data:{plate:plate,vehicle:vehicle||null,rows:rows},totals:{visitCount:jobs.length,totalSpend:totalSpend},warnings:warn};
};

ReportQuery.appointments=function(p,state){
  var from=p.from||_monthStart(),to=p.to||_today(),warn=[];p.from=from;p.to=to;
  var appts=_CALC.dateFilter(_st(state,'appointments'),from,to);if(!_st(state,'appointments').length)warn.push('appointments data unavailable');
  var noShow=appts.filter(function(a){return a.showedUp===false||a.status==='cancelled';}).length;
  var completed=appts.filter(function(a){return a.status==='completed'||a.status==='delivered';}).length;
  var sourceMap={};appts.forEach(function(a){var s=a.bookingSource||'Walk-in';sourceMap[s]=(sourceMap[s]||0)+1;});
  return{data:{rows:appts.slice().sort(function(a,b){return(b.date||'').localeCompare(a.date||'');}),sourceMap:sourceMap},totals:{total:appts.length,noShow:noShow,completed:completed},warnings:warn};
};

ReportQuery.monthlyComparison=function(p,state){
  var year=parseInt(p.year||_today().slice(0,4),10),warn=[];
  var sales=_st(state,'sales').filter(function(s){return !s.deleted;}),expenses=_st(state,'expenses');if(!sales.length)warn.push('sales data unavailable');
  var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var allRet=_st(state,'saleReturns');
  var data=months.map(function(m,i){var mm=String(i+1).padStart(2,'0'),prefix=year+'-'+mm;var mS=sales.filter(function(s){return(s.date||'').startsWith(prefix);});var mE=expenses.filter(function(e){return(e.date||'').startsWith(prefix);});var mR=allRet.filter(function(r){return(r.date||'').startsWith(prefix);});var gross=mS.reduce(function(s,x){return s+_CALC.saleTotal(x);},0),retAmt=mR.reduce(function(s,r){return s+_CALC.num(r.returnGrand||r.amount||0);},0),exp=mE.reduce(function(s,e){return s+_CALC.num(e.amt);},0),rev=gross-retAmt;return{month:m,gross:gross,retAmt:retAmt,rev:rev,exp:exp,profit:rev-exp,count:mS.length};});
  var rolling=data.map(function(d,i){var prev3=data.slice(Math.max(0,i-2),i+1);return Math.round(prev3.reduce(function(s,x){return s+x.rev;},0)/prev3.length);});
  var yearTotal=data.reduce(function(s,d){return s+d.rev;},0);
  return{data:{data:data,rolling:rolling,year:year,sales:sales},totals:{yearTotal:yearTotal},warnings:warn};
};

ReportQuery.yearComparison=function(p,state){
  var yearA=parseInt(p.year1||(parseInt(_today().slice(0,4),10)-1),10),yearB=parseInt(p.year2||_today().slice(0,4),10),warn=[];
  var sales=_st(state,'sales').filter(function(s){return !s.deleted;});if(!sales.length)warn.push('sales data unavailable');
  var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var totA=0,totB=0;
  var rows=months.map(function(m,i){var mm=String(i+1).padStart(2,'0');var revA=sales.filter(function(s){return(s.date||'').startsWith(yearA+'-'+mm);}).reduce(function(s,x){return s+_CALC.saleTotal(x);},0);var revB=sales.filter(function(s){return(s.date||'').startsWith(yearB+'-'+mm);}).reduce(function(s,x){return s+_CALC.saleTotal(x);},0);totA+=revA;totB+=revB;return{month:m,revA:revA,revB:revB};});
  return{data:{rows:rows,yearA:yearA,yearB:yearB},totals:{totA:totA,totB:totB},warnings:warn};
};

ReportQuery.plVariance=function(p,state){
  var month=p.month||_today().slice(0,7),warn=[];
  var _pm=month.split('-');var _py=+_pm[0],_pmm=+_pm[1];_pmm-=1;if(_pmm<1){_pmm=12;_py-=1;}var prevMo=_py+'-'+String(_pmm).padStart(2,'0');
  var sales=_st(state,'sales').filter(function(s){return !s.deleted;}),expenses=_st(state,'expenses');
  function _moExp(pfx){return expenses.filter(function(e){return(e.date||'').startsWith(pfx);}).reduce(function(s,x){return s+_CALC.num(x.amt);},0);}
  function _moRev(pfx){return sales.filter(function(s){return(s.date||'').startsWith(pfx);}).reduce(function(s,x){return s+_CALC.saleTotal(x);},0);}
  var curRev=_moRev(month),prevRev=_moRev(prevMo),curExp=_moExp(month),prevExp=_moExp(prevMo);
  var curProfit=curRev-curExp,prevProfit=prevRev-prevExp;
  var ledger={ready:_ledgerReady()};if(ledger.ready){ledger.balanced=_GLQ.isBalanced();ledger.gstPayable=_GLQ.gstPayable();ledger.gstRec=_GLQ.gstReceivable();ledger.netGST=ledger.gstPayable-ledger.gstRec;}
  return{data:{month:month,prevMo:prevMo,curRev:curRev,prevRev:prevRev,curExp:curExp,prevExp:prevExp,curProfit:curProfit,prevProfit:prevProfit,ledger:ledger},totals:{},warnings:warn};
};


var ReportRenderer={};

ReportRenderer.salesMain=function(data,params){
  var from=params.from||_monthStart(),to=params.to||_today(),t=params._totals||{};
  var rows=(data.rows||[]).map(function(s){return[{v:_D(s.date)},{v:s.id,mono:true},{v:s.customer||'Walk-in'},{v:s.createdBy||'—'},{v:s.pay||'—'},{v:PKR(s.total),r:true,fw:true},{v:PKR(s.paid),r:true},{html:s.due>0?'<span class="u-red fw">'+PKR(s.due)+'</span>':(s.due<0?'<span class="u-green fw">'+PKR(Math.abs(s.due))+' Cr</span>':PKR(0)),r:true},{html:_pill(s.status)},{html:_waBtn(s.phone,'Dear '+_esc(s.customer||'Customer')+', your invoice '+s.id+' of '+PKR(s.total)+' is pending. Please clear your dues.')}];});
  var payRows=Object.keys(data.payBreakdown||{}).map(function(m){var b=data.payBreakdown[m];return[{v:m},{v:b.count,r:true},{v:PKR(b.amount),r:true,fw:true}];});
  var html=_filters('rpt-s1',[{key:'from',label:'From',type:'date',val:from},{key:'to',label:'To',type:'date',val:to},{key:'cust',label:'Customer',type:'text',ph:'Filter by customer…',live:true},{key:'user',label:'User',type:'text',ph:'Filter by user…',live:true},{key:'cat',label:'Category',type:'text',ph:'e.g. Tyres…',live:true},{key:'pay',label:'Pay Method',type:'select',options:[{v:'',l:'All Methods'},{v:'Cash',l:'Cash'},{v:'Credit',l:'Credit'},{v:'Bank Transfer',l:'Bank Transfer'},{v:'JazzCash',l:'JazzCash'},{v:'EasyPaisa',l:'EasyPaisa'},{v:'Card',l:'Card'}]},{key:'status',label:'Status',type:'select',options:[{v:'',l:'All'},{v:'paid',l:'Paid'},{v:'unpaid',l:'Unpaid'},{v:'partial',l:'Partial'},{v:'credit',l:'Credit'}]}]);
  html+=_kpis([{label:'Gross Sales',html:'<span class="u-green fw">'+PKR(t.gross||0)+'</span>'},{label:'Net Sales',html:'<span class="fw">'+PKR(t.netSales||0)+'</span>',sub:(t.returnAmt>0?'After returns: -'+PKR(t.returnAmt):'No returns in period')},{label:'Collected',html:'<span class="u-green">'+PKR(t.collected||0)+'</span>'},{label:'Outstanding',html:'<span class="'+(( t.outstanding||0)>0?'u-red':'u-green')+' fw">'+PKR(t.outstanding||0)+'</span>'},{label:'Discounts Given',html:'<span class="u-red">'+PKR(t.discTotal||0)+'</span>'},{label:'Invoices',value:(data.rows||[]).length,sub:'in period'}]);
  html+=_section('Sales Transactions ('+(data.rows||[]).length+')',_printBtn('Sales Report'),_table([{l:'Date'},{l:'Invoice'},{l:'Customer'},{l:'User'},{l:'Method'},{l:'Total',r:true},{l:'Paid',r:true},{l:'Due',r:true},{l:'Status'},{l:'WA'}],rows,[{v:'TOTAL',fw:true},'','','','',{v:PKR(t.gross||0),r:true,fw:true},{v:PKR(t.collected||0),r:true},{v:PKR(t.outstanding||0),r:true,fw:true},'','']));
  if(payRows.length)html+=_section('Payment Method Breakdown',_table([{l:'Method'},{l:'Transactions',r:true},{l:'Amount',r:true}],payRows));
  return html;
};

ReportRenderer.saleLedger=function(data,params){
  var from=params.from||_monthStart(),to=params.to||_today(),t=params._totals||{};
  var rows=(data.rows||[]).map(function(s){return[{v:_D(s.date)},{v:s.id,mono:true},{v:s.customer||'Walk-in'},{v:PKR(s.total),r:true},{v:PKR(s.paid),r:true},{html:s.due>0?'<span class="u-red fw">'+PKR(s.due)+'</span><br><span style="font-size:10px;color:var(--muted)">'+s.daysOld+' days</span>':'—',r:true},{html:_pill(s.status)},{html:s.phone?_waBtn(s.phone,'Dear '+_esc(s.customer||'Customer')+', your invoice '+s.id+' of '+PKR(s.total)+' has '+PKR(s.due)+' outstanding. Kindly clear dues.'):''} ];});
  var html=_filters('rpt-s2',[{key:'cust',label:'Customer',type:'text',ph:'Customer name…',live:true},{key:'from',label:'From',type:'date',val:from},{key:'to',label:'To',type:'date',val:to}]);
  html+=_kpis([{label:'Total Invoiced',html:'<span class="fw">'+PKR(t.totalInvoiced||0)+'</span>'},{label:'Collected',html:'<span class="u-green fw">'+PKR(t.totalPaid||0)+'</span>'},{label:'Outstanding',html:'<span class="'+((t.totalDue||0)>0?'u-red':'u-green')+' fw">'+PKR(t.totalDue||0)+'</span>'},{label:'Collection Rate',html:'<span class="'+(Number(t.collRate||0)>=80?'u-green':'u-red')+' fw">'+(t.collRate||'0.0')+'%</span>'}]);
  if(data.ledger&&data.ledger.ready)html+=_lo('Sale Ledger — Vendor Ledger View',[{label:'Invoices Raised (GL)',value:PKR(data.ledger.raised||0),cls:'p8-muted'},{label:'Cash Collected (GL)',value:PKR(data.ledger.collected||0),cls:'p8-green'},{label:'Total AR Balance (GL)',value:PKR(data.ledger.arBalance||0),cls:(data.ledger.arBalance||0)>0?'p8-red p8-fw':'p8-green p8-fw'}],from,to,'Source: Vendor Ledger acc-1100 (Accounts Receivable)');
  html+=_section('Sale Ledger',_printBtn('Sale Ledger'),_table([{l:'Date'},{l:'Invoice'},{l:'Customer'},{l:'Total',r:true},{l:'Paid',r:true},{l:'Overdue',r:true},{l:'Status'},{l:'Remind'}],rows,[{v:'TOTAL',fw:true},'','',{v:PKR(t.totalInvoiced||0),r:true,fw:true},{v:PKR(t.totalPaid||0),r:true},{v:PKR(t.totalDue||0),r:true,fw:true},'','']));
  return html;
};

ReportRenderer.aging=function(data,params){
  var type=params.type||'customers';
  var fHtml=_filters('rpt-s3',[{key:'type',label:'View',type:'select',options:[{v:'customers',l:'Customer Aging (Receivables)'},{v:'suppliers',l:'Supplier Aging (Payables)'}]}]);
  if(type==='customers'){
    var cMap=data.custMap||{},grandTotal=Object.values(cMap).reduce(function(s,c){return s+c.total;},0);
    var rows=Object.keys(cMap).filter(function(k){return cMap[k].total>0;}).sort(function(a,b){return cMap[b].total-cMap[a].total;}).map(function(k){var c=cMap[k];function ab(bkt,col){return c.buckets[bkt]>0?'<span class="'+col+'">'+PKR(c.buckets[bkt])+'</span>':'—';}return[{v:c.name},{html:ab('current','u-green'),r:true},{html:ab('1-30','u-green'),r:true},{html:ab('31-60','u-orange'),r:true},{html:ab('61-90','u-red'),r:true},{html:ab('91-180','u-red fw'),r:true},{html:ab('181-365','u-red fw'),r:true},{html:c.buckets['365+']>0?'<span style="color:#7c3aed;font-weight:700">'+PKR(c.buckets['365+'])+'</span>':'—',r:true},{v:PKR(c.total),r:true,fw:true},{html:_waBtn(c.ph,'Dear Customer, you have an outstanding balance of '+PKR(c.total)+'. Kindly clear your dues.')}];});
    var html=fHtml;
    if(data.ledger&&data.ledger.ready)html+=_lo('Aging — Vendor Ledger View',[{label:'Total AR (GL)',value:PKR(data.ledger.ar||0),cls:(data.ledger.ar||0)>0?'p8-red':'p8-green'},{label:'Total AP (GL)',value:PKR(data.ledger.ap||0),cls:(data.ledger.ap||0)>0?'p8-red':'p8-green'},{label:'Net Position',value:PKR((data.ledger.ar||0)-(data.ledger.ap||0)),cls:((data.ledger.ar||0)-(data.ledger.ap||0))>=0?'p8-green p8-fw':'p8-red p8-fw'}],null,null,'Source: Vendor Ledger acc-1100 (AR) + acc-2001 (AP)');
    html+=_kpis([{label:'Total Receivables',html:'<span class="u-red fw">'+PKR(grandTotal)+'</span>'},{label:'Customers Owing',value:Object.keys(cMap).filter(function(k){return cMap[k].total>0;}).length},{label:'Critical (90+ days)',html:'<span class="u-red fw">'+PKR(Object.values(cMap).reduce(function(s,c){return s+c.buckets['91-180']+c.buckets['181-365']+c.buckets['365+'];},0))+'</span>'}]);
    html+=_section('Customer Aging — Receivables',_printBtn('Customer Aging'),_table([{l:'Customer'},{l:'Current',r:true},{l:'1-30 days',r:true},{l:'31-60 days',r:true},{l:'61-90 days',r:true},{l:'91-180 days',r:true},{l:'181-365 days',r:true},{l:'365+ days',r:true},{l:'Total',r:true},{l:'WA'}],rows,[{v:'TOTAL',fw:true},'','','','','','','',{v:PKR(grandTotal),r:true,fw:true},'']));
    return html;
  }
  var sMap=data.supMap||{},supTotal=Object.values(sMap).reduce(function(s,c){return s+c.total;},0);
  var sRows=Object.keys(sMap).filter(function(k){return sMap[k].total>0;}).sort(function(a,b){return sMap[b].total-sMap[a].total;}).map(function(k){var c=sMap[k];function ab(bkt,col){return c.buckets[bkt]>0?'<span class="'+col+'">'+PKR(c.buckets[bkt])+'</span>':'—';}return[{v:c.name},{html:ab('current','u-green'),r:true},{html:ab('1-30','u-green'),r:true},{html:ab('31-60','u-orange'),r:true},{html:ab('61-90','u-red'),r:true},{html:ab('91-180','u-red fw'),r:true},{html:ab('181-365','u-red fw'),r:true},{html:c.buckets['365+']>0?'<span style="color:#7c3aed;font-weight:700">'+PKR(c.buckets['365+'])+'</span>':'—',r:true},{v:PKR(c.total),r:true,fw:true}];});
  var sHtml=fHtml;sHtml+=_kpis([{label:'Total Payables',html:'<span class="u-red fw">'+PKR(supTotal)+'</span>'},{label:'Suppliers with Dues',value:Object.keys(sMap).filter(function(k){return sMap[k].total>0;}).length}]);
  sHtml+=_section('Supplier Aging — Payables',_printBtn('Supplier Aging'),_table([{l:'Supplier'},{l:'Current',r:true},{l:'1-30 days',r:true},{l:'31-60 days',r:true},{l:'61-90 days',r:true},{l:'91-180 days',r:true},{l:'181-365 days',r:true},{l:'365+ days',r:true},{l:'Total',r:true}],sRows,[{v:'TOTAL',fw:true},'','','','','','','',{v:PKR(supTotal),r:true,fw:true}]));
  return sHtml;
};

ReportRenderer.partyStatement=function(data,params){
  var from=params.from||'',to=params.to||_today(),t=params._totals||{};
  var biz=(params._biz)||{};
  var header='<div style="margin-bottom:16px;padding:16px;background:var(--bg);border-radius:8px;display:flex;justify-content:space-between;align-items:flex-start"><div><strong>'+_esc(biz.name||'MH Autos')+'</strong><br><span style="font-size:12px;color:var(--muted)">'+_esc(biz.address||'')+(biz.phone?' | '+biz.phone:'')+'</span></div><div style="text-align:right"><strong>Party Statement</strong><br><span style="font-size:12px;color:var(--muted)">'+(data.custObj?_esc(data.custObj.n)+(data.custObj.ph?' | '+data.custObj.ph:''):_esc(data.custName||'All Customers'))+'<br>'+(from?_D(from)+' to ':' Up to ')+_D(to)+'</span></div></div>';
  var rows=(data.rows||[]).map(function(e){var isCN=e.type==='Credit Note';return[{v:_D(e.date)},{html:isCN?'<span style="color:#b91c1c;font-weight:700">↩ Credit Note</span>':_esc(e.type)},{v:e.ref,mono:true},{v:e.debit>0?PKR(e.debit):'—',r:true},{html:e.credit>0?'<span class="u-red fw">'+PKR(e.credit)+'</span>':'—',r:true},{html:'<span class="'+(e.balance>0?'u-red':'u-green')+' fw">'+PKR(Math.abs(e.balance))+(e.balance>0?' Dr':' Cr')+'</span>',r:true},{v:e.note}];});
  var closing=data.running||0;
  var html=_filters('rpt-s4',[{key:'cust',label:'Customer',type:'text',ph:'Exact name…',live:true},{key:'from',label:'From',type:'date',val:from},{key:'to',label:'To',type:'date',val:to}]);
  html+=header;
  html+=_section('Account Statement',_printBtn('Party Statement'),_table([{l:'Date'},{l:'Type'},{l:'Reference'},{l:'Debit',r:true},{l:'Credit',r:true},{l:'Balance',r:true},{l:'Note'}],rows,[{v:'Closing Balance',fw:true},'','',{v:PKR(t.totalDebit||0),r:true},{v:PKR(t.totalCredit||0),r:true},{html:'<span class="'+(closing>0?'u-red':'u-green')+' fw">'+PKR(Math.abs(closing))+(closing>0?' Dr':' Cr')+'</span>',r:true},'']));
  return html;
};

ReportRenderer.customers=function(data,params){
  var enriched=data.enriched||[],t=params._totals||{};
  var rows=enriched.map(function(e,i){return[{v:i+1,r:true},{v:e.c.n||'—',fw:true},{v:e.c.ph||'—'},{v:e.txCount,r:true},{v:PKR(e.totalRev),r:true},{html:e.outstanding>0?'<span class="u-red fw">'+PKR(e.outstanding)+' Dr</span>':(e.outstanding<0?'<span class="u-green fw">'+PKR(Math.abs(e.outstanding))+' Cr</span>':'<span class="u-green">—</span>'),r:true},{v:e.lastDate?_D(e.lastDate):'—'},{html:e.atRisk?_pill('At Risk'):(e.daysSince===Infinity?_pill('New'):_pill('Active'))},{html:_waBtn(e.c.ph,'Dear '+_esc(e.c.n||'Customer')+', you have an outstanding balance of '+PKR(e.outstanding)+'. Kindly clear your dues.')}];});
  var top10=enriched.slice(0,10).map(function(e,i){return[{v:i+1,r:true},{v:e.c.n},{v:PKR(e.totalRev),r:true,fw:true},{v:e.txCount,r:true}];});
  var html=_filters('rpt-s5',[{key:'search',label:'Customer Name',type:'text',ph:'Customer name…',live:true},{key:'sort',label:'Sort by',type:'select',options:[{v:'outstanding',l:'Outstanding'},{v:'revenue',l:'Revenue'},{v:'lastSale',l:'Last Sale'},{v:'name',l:'Name'}]}]);
  html+=_kpis([{label:'Total Customers',value:enriched.length},{label:'Active (60 days)',value:enriched.filter(function(e){return e.daysSince<=60;}).length},{label:'At Risk (60+ days)',html:'<span class="u-red fw">'+enriched.filter(function(e){return e.atRisk;}).length+'</span>'},{label:'Total Outstanding',html:'<span class="u-red fw">'+PKR(t.totalOutstanding||0)+'</span>'}]);
  html+=_section('Top 10 Customers by Revenue',_table([{l:'#',r:true},{l:'Customer'},{l:'Revenue',r:true},{l:'Orders',r:true}],top10));
  html+=_section('All Customers ('+enriched.length+')',_printBtn('Customer Report'),_table([{l:'#',r:true},{l:'Name'},{l:'Phone'},{l:'Orders',r:true},{l:'Revenue',r:true},{l:'Outstanding',r:true},{l:'Last Sale'},{l:'Status'},{l:'WA'}],rows));
  return html;
};

ReportRenderer.saleSummary=function(data,params){
  var from=params.from||_monthStart(),to=params.to||_today(),t=params._totals||{};
  var groups=data.groups||{},groupBy=data.groupBy||'day';
  var peakLabel=data.peakHr!==undefined?(data.peakHr+':00 – '+data.peakHr+':59'):'—';
  var rows=Object.keys(groups).sort().reverse().map(function(k){var g=groups[k];var retAmt=g.returns||0;return[{v:k},{v:g.count,r:true},{v:PKR(g.total),r:true,fw:true},{html:retAmt>0?'<span class="u-red">-'+PKR(retAmt)+'</span>':'—',r:true},{v:PKR(g.total-retAmt),r:true},{v:PKR(g.paid),r:true},{v:PKR(g.total-g.paid-retAmt),r:true},{v:g.count>0?PKR(g.total/g.count):'—',r:true}];});
  var html=_filters('rpt-s6',[{key:'from',label:'From',type:'date',val:from},{key:'to',label:'To',type:'date',val:to},{key:'group',label:'Group by',type:'select',options:[{v:'day',l:'Day'},{v:'week',l:'Week'},{v:'month',l:'Month'}]}]);
  html+=_kpis([{label:'Gross Sales',html:'<span class="fw">'+PKR(t.grandTotal||0)+'</span>'},{label:'Sale Returns',html:'<span class="u-red">'+PKR(t.totalReturns||0)+'</span>'},{label:'Net Sales',html:'<span class="u-green fw">'+PKR(t.netSales||0)+'</span>'},{label:'Invoices',value:t.count||0},{label:'Peak Hour',html:'<span class="fw">'+_esc(peakLabel)+'</span>'}]);
  html+=_section('Sale Summary by '+groupBy.charAt(0).toUpperCase()+groupBy.slice(1),_printBtn('Sale Summary'),_table([{l:groupBy==='day'?'Date':groupBy==='week'?'Week':'Month'},{l:'Invoices',r:true},{l:'Gross',r:true},{l:'Returns',r:true},{l:'Net Sales',r:true},{l:'Collected',r:true},{l:'Outstanding',r:true},{l:'Avg Invoice',r:true}],rows,[{v:'TOTAL',fw:true},{v:t.count||0,r:true},{v:PKR(t.grandTotal||0),r:true,fw:true},{html:'<span class="u-red">'+PKR(t.totalReturns||0)+'</span>',r:true},{v:PKR(t.netSales||0),r:true,fw:true},{v:PKR(t.grandPaid||0),r:true},{v:PKR((t.grandTotal||0)-(t.grandPaid||0)),r:true},'']));
  return html;
};

ReportRenderer.discount=function(data,params){
  var from=params.from||_monthStart(),to=params.to||_today(),t=params._totals||{};
  var rows=(data.rows||[]).map(function(r){var pct=r.lineAmt>0?(r.disc/r.lineAmt*100).toFixed(1)+'%':'—';return[{v:_D(r.date)},{v:r.invoiceId,mono:true},{v:r.customer||'Walk-in'},{v:r.itemName||'—'},{v:r.qty,r:true},{v:PKR(r.lineAmt),r:true},{v:PKR(r.disc),r:true,fw:true},{v:pct,r:true},{v:r.createdBy||'—'}];});
  var html=_filters('rpt-s7',[{key:'from',label:'From',type:'date',val:from},{key:'to',label:'To',type:'date',val:to}]);
  html+=_kpis([{label:'Total Discounts',html:'<span class="u-red fw">'+PKR(t.totalDisc||0)+'</span>'},{label:'Discount Lines',value:(data.rows||[]).length}]);
  html+=_section('Discount Report',_printBtn('Discount Report'),_table([{l:'Date'},{l:'Invoice'},{l:'Customer'},{l:'Item'},{l:'Qty',r:true},{l:'Line Amt',r:true},{l:'Discount',r:true},{l:'Disc %',r:true},{l:'Given By'}],rows));
  return html;
};

ReportRenderer.saleReturns=function(data,params){
  var from=params.from||_monthStart(),to=params.to||_today(),t=params._totals||{};
  var partialCount=(data.rows||[]).filter(function(r){return r.partial;}).length;
  var fullCount=(data.rows||[]).length-partialCount;
  var rows=(data.rows||[]).map(function(r){
    var rv=_CALC.num(r.returnGrand||r.amount||0);
    var cp=_CALC.num(r.cashPaidOut||0);
    var sc=Math.max(0,rv-cp);
    var modeColor=(r.mode||'').indexOf('Cash')>=0?'#16a34a':(r.mode||'').indexOf('Bank')>=0?'#0284c7':'#7c3aed';
    var modeBg  =(r.mode||'').indexOf('Cash')>=0?'#dcfce7':(r.mode||'').indexOf('Bank')>=0?'#dbeafe':'#f3e8ff';
    return[
      {v:_D(r.date)},
      {v:r.id,mono:true},
      {v:r.originalInv||r.originalId||'—',mono:true},
      {v:r.customer||'—'},
      {v:(r.items||[]).map(function(i){return i.n+' x'+i.q;}).join(', ')||'—'},
      {html:'<span style="background:'+modeBg+';color:'+modeColor+';border-radius:4px;padding:1px 7px;font-size:11px;font-weight:700">'+_esc(r.mode||'Cash Refund')+'</span>'},
      {html:r.partial?'<span style="color:#b45309;font-size:11px;font-weight:600">Partial</span>':'<span style="color:#065f46;font-size:11px;font-weight:600">Full</span>'},
      {v:r.reason||'—'},
      {v:PKR(rv),r:true,fw:true},
      {v:cp>0?PKR(cp):'—',r:true},
      {v:sc>0?PKR(sc):'—',r:true}
    ];
  });
  var html=_filters('rpt-s8',[{key:'from',label:'From',type:'date',val:from},{key:'to',label:'To',type:'date',val:to}]);
  html+=_kpis([
    {label:'Total Returns',value:(data.rows||[]).length,sub:'Full: '+fullCount+' | Partial: '+partialCount},
    {label:'Return Value',html:'<span class="u-red fw">'+PKR(t.totalReturnValue||t.totalRefund||0)+'</span>'},
    {label:'Cash Paid Out',html:'<span class="u-red fw">'+PKR(t.totalCashOut||0)+'</span>'},
    {label:'Store Credit Issued',html:'<span class="u-orange fw">'+PKR(t.totalStoreCredit||0)+'</span>'}
  ]);
  html+=_section('Sale Returns ('+(data.rows||[]).length+')',_printBtn('Sale Returns'),
    _table(
      [{l:'Date'},{l:'Return ID'},{l:'Orig Invoice'},{l:'Customer'},{l:'Items'},{l:'Mode'},{l:'Type'},{l:'Reason'},{l:'Return Value',r:true},{l:'Cash Out',r:true},{l:'Store Credit',r:true}],
      rows,
      [{v:'TOTAL',fw:true},'','','','','','','',
       {v:PKR(t.totalReturnValue||t.totalRefund||0),r:true,fw:true},
       {v:PKR(t.totalCashOut||0),r:true},
       {v:PKR(t.totalStoreCredit||0),r:true}]
    )
  );
  return html;
};

ReportRenderer.payIn=function(data,params){
  var from=params.from||_monthStart(),to=params.to||_today(),t=params._totals||{};
  var rows=(data.rows||[]).map(function(p){return[{v:_D(p.date)},{v:p.id,mono:true},{v:p.customer||'—'},{v:p.method||'Cash'},{v:p.note||'—'},{v:PKR(_CALC.num(p.amount)),r:true,fw:true}];});
  var html=_filters('rpt-s9',[{key:'from',label:'From',type:'date',val:from},{key:'to',label:'To',type:'date',val:to},{key:'method',label:'Method',type:'select',options:[{v:'',l:'All'},{v:'Cash',l:'Cash'},{v:'Bank Transfer',l:'Bank Transfer'},{v:'JazzCash',l:'JazzCash'},{v:'EasyPaisa',l:'EasyPaisa'},{v:'Card',l:'Card'}]}]);
  html+=_kpis([{label:'Total Received',html:'<span class="u-green fw">'+PKR(t.total||0)+'</span>'},{label:'Receipts',value:(data.rows||[]).length}]);
  html+=_section('Payment Received ('+(data.rows||[]).length+')',_printBtn('Payment In'),_table([{l:'Date'},{l:'Receipt #'},{l:'Customer'},{l:'Method'},{l:'Note'},{l:'Amount',r:true}],rows,[{v:'TOTAL',fw:true},'','','','',{v:PKR(t.total||0),r:true,fw:true}]));
  return html;
};

ReportRenderer.lowStock=function(data,params){
  var t=params._totals||{};
  var rows=(data.rows||[]).map(function(r){var item=r.item,sup=r.sup,days=r.daysOfStock,dl=days===Infinity?'No sales':days+' days',dc=days<7?'u-red':days<14?'u-orange':'u-green';return[{v:item.bc,mono:true},{v:item.n||'—',fw:true},{v:item.cat||'—'},{html:'<span class="'+(item.st<=0?'u-red fw':'u-orange')+'">'+_esc(String(_CALC.num(item.st)))+'</span>',r:true},{v:_CALC.num(item.minSt||5),r:true},{html:'<span class="'+dc+'">'+_esc(dl)+'</span>'},{v:sup?sup.n:'—'},{v:sup?(sup.ph||'—'):'—'},{html:item.st<=0?_pill('Out'):_pill('Low')}];});
  var html=_filters('rpt-i1',[{key:'thresh',label:'Max Stock Level',type:'number',ph:'0 = use item min level',val:params.threshold||''}]);
  html+=_kpis([{label:'Low Stock Items',html:'<span class="u-red fw">'+(t.lowStockCount||0)+'</span>'},{label:'Out of Stock',html:'<span class="u-red fw">'+(t.outOfStockCount||0)+'</span>'}]);
  html+=_section('Low Stock Alert ('+(data.rows||[]).length+' items)',_printBtn('Low Stock Alert'),_table([{l:'Code'},{l:'Item'},{l:'Category'},{l:'Stock',r:true},{l:'Min Level',r:true},{l:'Days Remaining'},{l:'Supplier'},{l:'Supplier Phone'},{l:'Status'}],rows));
  return html;
};

ReportRenderer.stockValuation=function(data,params){
  var t=params._totals||{};
  var rows=(data.rows||[]).map(function(r){var item=r.item;return[{v:item.bc,mono:true},{v:item.n||'—'},{v:item.cat||'—'},{v:_CALC.num(item.st),r:true},{v:PKR(_CALC.num(item.pp)),r:true},{v:PKR(_CALC.num(item.sp)),r:true},{v:PKR(r.costVal),r:true,fw:true},{html:'<span class="'+(r.potProfit>=0?'u-green':'u-red')+'">'+PKR(r.potProfit)+'</span>',r:true},{html:'<span>'+PCT(r.margin)+'</span>',r:true},{html:r.lastSale?_D(r.lastSale):'<span class="u-red">Never</span>'},{html:r.isDead?_pill('Dead Stock'):_pill('Active')}];});
  var html=_filters('rpt-i2',[{key:'cat',label:'Category',type:'text',ph:'Filter by category…',live:true}]);
  if(data.ledger&&data.ledger.ready){var diff=Math.abs((data.ledger.glValue||0)-(t.totalCost||0));html+=_lo('Stock Valuation — Ledger View',[{label:'Inventory Asset (acc-1200)',value:PKR(data.ledger.glValue||0),cls:'p8-fw'},{label:'Stock Received (MTD)',value:PKR(data.ledger.received||0),cls:'p8-green'},{label:'Stock Consumed (MTD)',value:PKR(data.ledger.consumed||0),cls:'p8-red'},{label:'COGS Recognized (Total)',value:PKR(data.ledger.totalCOGS||0),cls:'p8-muted'}],null,null,'Source: Stock Ledger acc-1200 + acc-5100');if(diff>100)html+='<div style="margin-top:12px;padding:12px 16px;border-radius:8px;background:var(--warning-light,#fef3c7);border:1px solid var(--warning,#f59e0b);font-size:13px;overflow-wrap:break-word;word-break:break-word;max-width:100%;box-sizing:border-box"><strong>⚠️ GL Inventory Variance:</strong> Stock Report value = '+PKR(t.totalCost||0)+' — GL Inventory Asset (acc-1200) = '+PKR(data.ledger.glValue||0)+' — Difference: <strong>'+PKR(diff)+'</strong>. Run <code>ERP.SelfTest.run()</code> → STK-3C for details.</div>';}
  html+=_kpis([{label:'Total Items',value:(data.rows||[]).length},{label:'Cost Value',html:'<span class="fw">'+PKR(t.totalCost||0)+'</span>'},{label:'Market Value',html:'<span class="u-green fw">'+PKR(t.totalMkt||0)+'</span>'},{label:'Potential Profit',html:'<span class="u-green">'+PKR(t.potProfit||0)+'</span>'},{label:'Dead Stock Items',html:'<span class="u-red fw">'+(t.deadItemCount||0)+'</span>',sub:'90+ days no sale'}]);
  html+=_section('Stock Valuation ('+(data.rows||[]).length+' items)',_printBtn('Stock Valuation'),_table([{l:'Code'},{l:'Item'},{l:'Category'},{l:'Stock',r:true},{l:'Cost Price',r:true},{l:'Sale Price',r:true},{l:'Stock Value',r:true},{l:'Pot. Profit',r:true},{l:'Margin %',r:true},{l:'Last Sale'},{l:'Status'}],rows,[{v:'TOTAL',fw:true},'','','','','',{v:PKR(t.totalCost||0),r:true,fw:true},{v:PKR(t.potProfit||0),r:true},'','','']));
  return html;
};

ReportRenderer.itemPL=function(data,params){
  var from=params.from||_monthStart(),to=params.to||_today(),t=params._totals||{};
  var rows=(data.rows||[]).map(function(it){var gp=it.revenue-it.cost-it.disc,margin=it.revenue>0?(gp/it.revenue*100):0;return[{v:(it.bc||'').indexOf('NAME:')===0?'—':it.bc,mono:true},{v:it.name||'—',fw:true},{v:it.qty,r:true},{v:PKR(it.revenue),r:true},{v:PKR(it.cost),r:true},{v:PKR(it.disc),r:true},{html:'<span class="'+(gp>=0?'u-green':'u-red')+' fw">'+PKR(gp)+'</span>',r:true},{html:'<span class="'+(margin>=20?'u-green':margin>=10?'':'u-red')+'">'+PCT(margin)+'</span>',r:true}];});
  var html=_filters('rpt-i3',[{key:'from',label:'From',type:'date',val:from},{key:'to',label:'To',type:'date',val:to}]);
  if(data.ledger&&data.ledger.ready)html+=_lo('Item P&L — Ledger View',[{label:'Sales Revenue (GL)',value:PKR(data.ledger.revenue||0),cls:'p8-green'},{label:'COGS (GL)',value:PKR(data.ledger.cogs||0),cls:'p8-muted'},{label:'Gross Profit (GL)',value:PKR(data.ledger.gross||0),cls:(data.ledger.gross||0)>=0?'p8-green p8-fw':'p8-red p8-fw'},{label:'Gross Margin %',value:(data.ledger.margin||0)+'%',cls:(data.ledger.margin||0)>=20?'p8-green':'p8-red'}],from,to,'Source: GL acc-4001 + acc-5100');
  html+=_kpis([{label:'Items Sold',value:(data.rows||[]).length},{label:'Revenue',html:'<span class="fw">'+PKR(t.totRev||0)+'</span>'},{label:'COGS',html:'<span>'+PKR(t.totCost||0)+'</span>'},{label:'Gross Profit',html:'<span class="'+((t.totProfit||0)>=0?'u-green':'u-red')+' fw">'+PKR(t.totProfit||0)+'</span>'},{label:'Gross Margin',html:'<span>'+PCT((t.totRev||0)>0?(t.totProfit||0)/(t.totRev||1)*100:0)+'</span>'}]);
  html+=_section('Item Wise P&L',_printBtn('Item P&L'),_table([{l:'Code'},{l:'Item'},{l:'Qty Sold',r:true},{l:'Revenue',r:true},{l:'COGS',r:true},{l:'Discounts',r:true},{l:'Gross Profit',r:true},{l:'Margin %',r:true}],rows,[{v:'TOTAL',fw:true},'',{v:t.totQty||0,r:true},{v:PKR(t.totRev||0),r:true,fw:true},{v:PKR(t.totCost||0),r:true},{v:PKR(t.totDisc||0),r:true},{v:PKR(t.totProfit||0),r:true,fw:true},'']));
  return html;
};

ReportRenderer.stockMovement=function(data,params){
  var from=params.from||_monthStart(),to=params.to||_today(),t=params._totals||{};
  var rows=(data.rows||[]).map(function(m){return[{v:_D(m.date)},{v:m.bc||m.sku||'—',mono:true},{v:m.itemName||m.n||'—'},{html:_pill(m.type||'adjustment')},{html:m.qty>0?'<span class="u-green">+'+m.qty+'</span>':'<span class="u-red">'+m.qty+'</span>',r:true},{v:m.reason||m.type||'—'},{v:m.ref||'—',mono:true},{v:m.note||'—'}];});
  var html=_filters('rpt-i4',[{key:'from',label:'From',type:'date',val:from},{key:'to',label:'To',type:'date',val:to},{key:'item',label:'Item',type:'text',ph:'Filter by item…',live:true}]);
  html+=_kpis([{label:'Movements',value:t.count||0},{label:'Stock In',html:'<span class="u-green">'+(t.stockIn||0)+' units</span>'},{label:'Stock Out',html:'<span class="u-red">'+(t.stockOut||0)+' units</span>'}]);
  html+=_section('Stock Movement ('+(t.count||0)+')',_printBtn('Stock Movement'),_table([{l:'Date'},{l:'Code'},{l:'Item'},{l:'Type'},{l:'Qty',r:true},{l:'Reason'},{l:'Reference'},{l:'Note'}],rows));
  return html;
};

ReportRenderer.batchExpiry=function(data,params){
  var t=params._totals||{};
  var rows=(data.rows||[]).map(function(b){var color=b._daysLeft<=0?'u-red':b._daysLeft<=7?'u-orange':'';return[{v:b.id,mono:true},{v:b.bc||'—',mono:true},{v:b.name||'—'},{v:b.remainQty||0,r:true},{v:_D(b.expiry)||'—'},{html:'<span class="'+color+' fw">'+(b._daysLeft<=0?'EXPIRED':b._daysLeft+' days')+'</span>'},{html:b._daysLeft<=0?_pill('expired'):b._daysLeft<=7?_pill('critical'):_pill('warning')}];});
  var html=_filters('rpt-i5',[{key:'days',label:'Expiring within (days)',type:'number',val:params.days||30,ph:'30'}]);
  html+=_kpis([{label:'Expiring Soon',html:'<span class="u-orange fw">'+(t.expiringCount||0)+'</span>'},{label:'Already Expired',html:'<span class="u-red fw">'+(t.expiredCount||0)+'</span>'}]);
  html+=_section('Batch / Expiry Report',_printBtn('Batch Expiry'),_table([{l:'Batch ID'},{l:'Item Code'},{l:'Item'},{l:'Qty',r:true},{l:'Expiry Date'},{l:'Days Left'},{l:'Status'}],rows));
  return html;
};

ReportRenderer.purchaseLedger=function(data,params){
  var from=params.from||_monthStart(),to=params.to||_today(),t=params._totals||{};
  var rows=(data.rows||[]).map(function(p){
    var total=_CALC.purTotal(p),paid=_CALC.purPaid(p),due=(p._due!==undefined?p._due:_CALC.purOutstanding(p));
    var pst=(p.payStatus||'').toLowerCase();
    var wst=(p.status||'').toLowerCase();
    var ds=pst==='paid'?'paid':pst==='partial'?'partial':pst==='unpaid'?'unpaid':(wst==='complete'||wst==='completed'?'paid':wst||'draft');
    return[{v:_D(p.date)},{v:p.billNo||p.id,mono:true},{v:p.supplierName||p.sup||'\u2014',fw:true},{v:(p.items||p.itemsList||[]).length,r:true},{v:PKR(total),r:true},{v:PKR(paid),r:true},{html:due>0?'<span class=\"u-red fw\">'+PKR(due)+'</span>':'<span class=\"u-green\">\u2014</span>',r:true},{html:_pill(ds)}];
  });
  var html=_filters('rpt-p1',[{key:'from',label:'From',type:'date',val:from},{key:'to',label:'To',type:'date',val:to},{key:'sup',label:'Supplier',type:'text',ph:'Filter\u2026',live:true},{key:'status',label:'Status',type:'select',options:[{v:'',l:'All'},{v:'paid',l:'Paid'},{v:'unpaid',l:'Unpaid'},{v:'partial',l:'Partial'},{v:'complete',l:'Complete'},{v:'draft',l:'Draft'}]}]);
  if(data.ledger&&data.ledger.ready)html+=_lo('Purchase Ledger \u2014 Vendor Ledger View',[{label:'Bills Received (GL)',value:PKR(data.ledger.apRaised||0),cls:'p8-muted'},{label:'Payments Made (GL)',value:PKR(data.ledger.apPaid||0),cls:'p8-green'},{label:'Total AP Balance (GL)',value:PKR(data.ledger.apBalance||0),cls:(data.ledger.apBalance||0)>0?'p8-red p8-fw':'p8-green p8-fw'}],from,to,'Source: Vendor Ledger acc-2001 (Accounts Payable)');
  html+=_kpis([{label:'Total Purchase',html:'<span class=\"fw\">'+PKR(t.totPurchase||0)+'</span>'},{label:'Paid',html:'<span class=\"u-green\">'+PKR(t.totPaid||0)+'</span>'},{label:'Outstanding (Payable)',html:'<span class=\"u-red fw\">'+PKR(t.totDue||0)+'</span>'},{label:'Bills',value:(data.rows||[]).length}]);
  html+=_section('Purchase Ledger ('+(data.rows||[]).length+')',_printBtn('Purchase Ledger'),_table([{l:'Date'},{l:'Bill #'},{l:'Supplier'},{l:'Items',r:true},{l:'Total',r:true},{l:'Paid',r:true},{l:'Payable',r:true},{l:'Status'}],rows,[{v:'TOTAL',fw:true},'','','',{v:PKR(t.totPurchase||0),r:true,fw:true},{v:PKR(t.totPaid||0),r:true},{v:PKR(t.totDue||0),r:true,fw:true},'']));
  return html;
}
ReportRenderer.suppliers=function(data,params){
  var t=params._totals||{};
  var rows=(data.rows||[]).map(function(r){
    var statusHtml=r.outstanding>0?'<span class="rpt-pill rpt-pill-red">Outstanding</span>':(r.outstanding<0?'<span class="rpt-pill rpt-pill-blue">Advance Paid</span>':'<span class="rpt-pill rpt-pill-green">Clear</span>');
    return[{v:r.sup.n||'—',fw:true},{v:r.sup.ph||'—'},{v:r.txCount,r:true},{v:PKR(r.totalPurchase),r:true},{v:PKR(r.totalReturned||0),r:true},{v:PKR(r.totalPaid),r:true},{html:r.outstanding>0?'<span class="u-red fw">'+PKR(r.outstanding)+'</span>':(r.outstanding<0?'<span class="u-green fw">'+PKR(Math.abs(r.outstanding))+' Cr</span>':'<span class="u-green">—</span>'),r:true},{html:statusHtml},{v:r.lastPurchase?_D(r.lastPurchase):'—'}];
  });
  var html=_filters('rpt-p2',[{key:'search',label:'Search',type:'text',ph:'Name or phone…',live:true},{key:'from',label:'From',type:'date'},{key:'to',label:'To',type:'date',val:params.to||_today()}]);
  html+=_kpis([{label:'Total Suppliers',value:t.supplierCount||0},{label:'Total Payable',html:'<span class="u-red fw">'+PKR(t.totalPayable||0)+'</span>'}]);
  html+=_section('Supplier Master ('+(data.rows||[]).length+')',_printBtn('Supplier Report'),_table([{l:'Supplier'},{l:'Phone'},{l:'Orders',r:true},{l:'Total Purchased',r:true},{l:'Returns',r:true},{l:'Paid',r:true},{l:'Payable',r:true},{l:'Status'},{l:'Last Order'}],rows));
  if(data.ledger&&data.ledger.ready){var diff=Math.abs((data.ledger.glAP||0)-(t.totalPayable||0));if(diff>100)html+='<div style="margin-top:12px;padding:12px 16px;border-radius:8px;background:var(--warning-light,#fef3c7);border:1px solid var(--warning,#f59e0b);font-size:13px;overflow-wrap:break-word;word-break:break-word;max-width:100%;box-sizing:border-box"><strong>⚠️ GL AP Variance:</strong> Supplier sub-ledger = '+PKR(t.totalPayable||0)+' — GL AP (acc-2001) = '+PKR(data.ledger.glAP||0)+' — Difference: <strong>'+PKR(diff)+'</strong>.</div>';}
  return html;
};

ReportRenderer.purchaseReturns=function(data,params){
  var from=params.from||_monthStart(),to=params.to||_today(),t=params._totals||{};
  var rows=(data.rows||[]).map(function(r){return[{v:_D(r.date)},{v:r.id,mono:true},{v:r.purchaseId||r.originalId||'—',mono:true},{v:r.supplierName||r.sup||'—'},{v:r.reason||'—'},{v:PKR(_CALC.num(r.total||0)),r:true,fw:true}];});
  var reasonRows=Object.keys(data.reasonMap||{}).sort(function(a,b){return(data.reasonMap[b]||0)-(data.reasonMap[a]||0);}).map(function(k){return[{v:k},{v:data.reasonMap[k],r:true,fw:true}];});
  var html=_filters('rpt-p3',[{key:'from',label:'From',type:'date',val:from},{key:'to',label:'To',type:'date',val:to}]);
  html+=_kpis([{label:'Total Returns',value:t.count||0},{label:'Total Refund',html:'<span class="u-red fw">'+PKR(t.totalRefund||0)+'</span>'}]);
  if(reasonRows.length)html+=_section('Returns by Reason',_table([{l:'Reason'},{l:'Count',r:true}],reasonRows));
  html+=_section('Purchase Returns ('+(t.count||0)+')',_printBtn('Purchase Returns'),_table([{l:'Date'},{l:'Return ID'},{l:'Original Bill'},{l:'Supplier'},{l:'Reason'},{l:'Refund',r:true}],rows));
  return html;
};

ReportRenderer.pl=function(data,params){
  var from=params.from||_monthStart(),to=params.to||_today(),d=data;
  var html=_filters('rpt-f1',[{key:'from',label:'From',type:'date',val:from},{key:'to',label:'To',type:'date',val:to}]);
  if(d.ledgerActive)html+=_lo('P&L — Ledger View',[{label:'Revenue (GL)',value:PKR(d.grossSales||0),cls:'p8-green'},{label:'COGS (GL)',value:PKR(d.cogs||0),cls:'p8-muted'},{label:'Gross Profit',value:PKR(d.grossProfit||0),cls:(d.grossProfit||0)>=0?'p8-green':'p8-red'},{label:'Net Profit (GL)',value:PKR(d.netProfit||0),cls:(d.netProfit||0)>=0?'p8-green p8-fw':'p8-red p8-fw'}],from,to,'Source: GL acc-4001 / acc-5100 / acc-5200');
  html+='<div class="rpt-pl-sheet">';
  html+=_section('Revenue',_printBtn('P&L Statement'),'<div style="padding:4px 8px"><div class="rpt-pl-row"><span>Gross Sales</span><span>'+PKR(d.grossSales||0)+'</span></div><div class="rpt-pl-row u-red"><span>Less: Returns</span><span>('+PKR(d.returnAmt||0)+')</span></div><div class="rpt-pl-row"><span>Workshop Labour Revenue</span><span>'+PKR(d.labourRev||0)+'</span></div><div class="rpt-pl-row fw" style="border-top:2px solid var(--border);margin-top:8px;padding-top:8px"><span>Net Revenue</span><span>'+PKR(d.netRevenue||0)+'</span></div>');
  html+=_section('Cost of Goods Sold',((d.openingStock||0)>0?'<div class="rpt-pl-row"><span>Opening Stock</span><span>'+PKR(d.openingStock)+'</span></div>':'')+'<div class="rpt-pl-row"><span>Purchases (Period)</span><span>'+PKR(d.purchasesAmt||0)+'</span></div>'+((d.closingStock||0)>0?'<div class="rpt-pl-row u-green"><span>Less: Closing Stock</span><span>('+PKR(d.closingStock)+')</span></div>':'')+'<div class="rpt-pl-row"><span>COGS (Ledger / Calculated)</span><span>'+PKR(d.ledgerActive?(d.cogs||0):(d.cogsTraditional||0))+'</span></div><div class="rpt-pl-row"><span>Workshop Parts Cost</span><span>'+PKR(d.jobPartsCost||0)+'</span></div>'+((d.depreciationAmt||0)>0?'<div class="rpt-pl-row"><span>Depreciation</span><span>'+PKR(d.depreciationAmt)+'</span></div>':'')+'<div class="rpt-pl-row fw '+(( d.grossProfit||0)>=0?'u-green':'u-red')+'" style="border-top:2px solid var(--border);margin-top:8px;padding-top:8px"><span>Gross Profit</span><span>'+PKR(d.grossProfit||0)+'</span></div>');
  var expRows=Object.keys(d.expByCategory||{}).map(function(cat){return'<div class="rpt-pl-row"><span>'+_esc(cat)+'</span><span>'+PKR(d.expByCategory[cat])+'</span></div>';}).join('');
  html+=_section('Operating Expenses',expRows+'<div class="rpt-pl-row fw" style="border-top:2px solid var(--border);margin-top:8px;padding-top:8px"><span>Total Expenses</span><span>'+PKR(d.totalExpenses||0)+'</span></div>');
  var netProfit=d.netProfit||0;
  html+='<div style="padding:20px;border-radius:12px;background:'+(netProfit>=0?'var(--success-light,#86efac)':'var(--danger-light,#fca5a5)')+';text-align:center;margin-top:16px"><div style="font-size:13px;font-weight:600;margin-bottom:4px">'+(netProfit>=0?'Net Profit':'Net Loss')+'</div><div style="font-size:28px;font-weight:900;color:'+(netProfit>=0?'var(--success-dark)':'var(--danger-dark)')+'">'+PKR(Math.abs(netProfit))+'</div></div>';
  html+='</div>';
  html+=d.ledgerActive?'<div style="margin-top:8px;padding:8px 16px;border-radius:8px;background:var(--success-light,#dcfce7);border:1px solid var(--success,#22c55e);font-size:12px;color:var(--success-dark,#166534)">✓ <strong>Ledger-Verified:</strong> Revenue and COGS sourced from General Ledger.</div>':'<div style="margin-top:8px;padding:8px 16px;border-radius:8px;background:var(--warning-light,#fef3c7);border:1px solid var(--warning,#f59e0b);font-size:12px;overflow-wrap:break-word;word-break:break-word;max-width:100%;box-sizing:border-box">⚠️ <strong>Ledger Not Ready:</strong> Figures calculated from raw invoice data. Run <code>ERP.SalesPostingLock.backfill()</code> to post to GL.</div>';
  return html;
};

ReportRenderer.balanceSheet=function(data,params){
  var asOf=params.asOf||_today(),d=data,t=params._totals||{};
  var html=_filters('rpt-f2',[{key:'date',label:'As of Date',type:'date',val:asOf}]);
  if(d.ledgerActive){var bal=_GLQ.systemBalances();var tlA=(bal.cash||0)+(bal.bank||0)+(bal.ar||0)+(bal.inventory||0);var tlL=(bal.ap||0)+(bal.loans||0)+(bal.gstPayable||0);html+=_lo('Balance Sheet — Ledger View',[{label:'Cash & Bank',value:PKR((bal.cash||0)+(bal.bank||0)),cls:'p8-green'},{label:'AR (acc-1100)',value:PKR(bal.ar||0),cls:'p8-muted'},{label:'Inventory',value:PKR(bal.inventory||0),cls:'p8-muted'},{label:'Total Assets',value:PKR(tlA),cls:'p8-fw'},{label:'AP + Loans',value:PKR(tlL),cls:'p8-red'},{label:'Equity (GL)',value:PKR(tlA-tlL),cls:(tlA-tlL)>=0?'p8-green p8-fw':'p8-red p8-fw'}],null,null,'Source: General Ledger all accounts — real-time');}
  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:800px">';
  html+=_section('Assets','<div class="rpt-pl-row"><span>Cash &amp; Bank</span><span class="fw">'+PKR(d.totalCash)+'</span></div><div class="rpt-pl-row"><span>Accounts Receivable</span><span>'+PKR(d.totalAR)+'</span></div><div class="rpt-pl-row"><span>Inventory</span><span>'+PKR(d.invValue)+'</span></div><div class="rpt-pl-row fw" style="border-top:2px solid var(--border);margin-top:8px;padding-top:8px"><span>Total Assets</span><span>'+PKR(t.totalAssets||0)+'</span></div>');
  html+=_section('Liabilities & Equity','<div class="rpt-pl-row"><span>Accounts Payable</span><span>'+PKR(d.totalAP)+'</span></div><div class="rpt-pl-row"><span>Loans Payable</span><span>'+PKR(d.loanBal)+'</span></div><div class="rpt-pl-row"><span>Accrued Expenses</span><span>'+PKR(d.expPay)+'</span></div><div class="rpt-pl-row fw" style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px"><span>Total Liabilities</span><span>'+PKR(t.totalLiabilities||0)+'</span></div><div class="rpt-pl-row u-green fw" style="border-top:2px solid var(--border);margin-top:8px;padding-top:8px"><span>Owner Equity</span><span>'+PKR(t.equity||0)+'</span></div>');
  html+='</div>';
  html+='<div style="text-align:center;padding:8px;font-size:11px;color:var(--muted);margin-top:4px">Balance Sheet as of <strong>'+_D(asOf)+'</strong></div>';
  return html;
};

ReportRenderer.cashFlow=function(data,params){
  var from=params.from||_monthStart(),to=params.to||_today(),d=data;
  var netCash=(d.cashIn||0)+(d.bankIn||0)-(d.cashOut||0)-(d.expOut||0)-(d.bankOut||0);
  var html=_filters('rpt-f3',[{key:'from',label:'From',type:'date',val:from},{key:'to',label:'To',type:'date',val:to}]);
  if(d.ledger&&d.ledger.ready)html+=_lo('Cash Flow — Ledger View',[{label:'Cash In (GL)',value:PKR(d.ledger.cashIn||0),cls:'p8-green'},{label:'Cash Out (GL)',value:PKR(d.ledger.cashOut||0),cls:'p8-red'},{label:'Bank In (GL)',value:PKR(d.ledger.bankIn||0),cls:'p8-green'},{label:'Bank Out (GL)',value:PKR(d.ledger.bankOut||0),cls:'p8-red'},{label:'Net Cash (GL)',value:PKR(d.ledger.netCash||0),cls:(d.ledger.netCash||0)>=0?'p8-green p8-fw':'p8-red p8-fw'}],from,to,'Source: GL acc-1001 (Cash) + acc-1002 (Bank)');
  html+=_kpis([{label:'Cash In',html:'<span class="u-green fw">'+PKR((d.cashIn||0)+(d.bankIn||0))+'</span>'},{label:'Cash Out',html:'<span class="u-red fw">'+PKR((d.cashOut||0)+(d.expOut||0)+(d.bankOut||0))+'</span>'},{label:'Net Cash Flow',html:'<span class="'+(netCash>=0?'u-green':'u-red')+' fw">'+PKR(Math.abs(netCash))+(netCash>=0?' ↑':' ↓')+'</span>'}]);
  html+=_section('Cash Flow Statement',_printBtn('Cash Flow'),'<div class="rpt-pl-row"><span>Operating — Cash Received</span><span class="u-green">'+PKR(d.cashIn||0)+'</span></div><div class="rpt-pl-row"><span>Bank Deposits</span><span class="u-green">'+PKR(d.bankIn||0)+'</span></div><div class="rpt-pl-row u-red"><span>Cash Payments Out</span><span>('+PKR(d.cashOut||0)+')</span></div><div class="rpt-pl-row u-red"><span>Expenses Paid</span><span>('+PKR(d.expOut||0)+')</span></div><div class="rpt-pl-row u-red"><span>Bank Withdrawals</span><span>('+PKR(d.bankOut||0)+')</span></div><div class="rpt-pl-row fw '+(netCash>=0?'u-green':'u-red')+'" style="border-top:2px solid var(--border);margin-top:8px;padding-top:8px"><span>Net Cash Position</span><span>'+PKR(netCash)+'</span></div>');
  return html;
};

ReportRenderer.expenses=function(data,params){
  var from=params.from||_monthStart(),to=params.to||_today(),t=params._totals||{};
  var rows=(data.rows||[]).map(function(e){return[{v:_D(e.date)},{v:e.id,mono:true},{v:e.cat||'—'},{v:e.note||'—'},{v:PKR(_CALC.num(e.amt)),r:true,fw:true}];});
  var catRows=Object.keys(data.catMap||{}).sort(function(a,b){return(data.catMap[b]||0)-(data.catMap[a]||0);}).map(function(k){return[{v:k},{v:PKR(data.catMap[k]),r:true,fw:true},{html:'<div style="background:var(--primary);height:8px;border-radius:4px;width:'+Math.round((data.catMap[k]||0)/((t.total||1))*100)+'%"></div>'}];});
  var html=_filters('rpt-f4',[{key:'from',label:'From',type:'date',val:from},{key:'to',label:'To',type:'date',val:to},{key:'cat',label:'Category',type:'text',ph:'Filter…',live:true}]);
  html+=_kpis([{label:'Total Expenses',html:'<span class="u-red fw">'+PKR(t.total||0)+'</span>'},{label:'Entries',value:(data.rows||[]).length}]);
  html+=_section('Expenses by Category',_table([{l:'Category'},{l:'Amount',r:true},{l:''}],catRows));
  html+=_section('All Expenses',_printBtn('Expense Report'),_table([{l:'Date'},{l:'ID'},{l:'Category'},{l:'Note'},{l:'Amount',r:true}],rows,[{v:'TOTAL',fw:true},'','','',{v:PKR(t.total||0),r:true,fw:true}]));
  return html;
};

ReportRenderer.bankStatement=function(data,params){
  var from=params.from||_monthStart(),to=params.to||_today(),t=params._totals||{};
  var rows=(data.rows||[]).map(function(tx){return[{v:_D(tx.date)},{v:tx.id,mono:true},{v:tx.type||'—'},{v:tx.note||tx.description||'—'},{html:tx._isIn?'<span class="u-green">'+PKR(tx._amt)+'</span>':'—',r:true},{html:!tx._isIn?'<span class="u-red">'+PKR(tx._amt)+'</span>':'—',r:true},{html:'<span class="'+(tx._balance>=0?'u-green':'u-red')+' fw">'+PKR(Math.abs(tx._balance))+'</span>',r:true,mono:true}];});
  var html=_filters('rpt-f5',[{key:'from',label:'From',type:'date',val:from},{key:'to',label:'To',type:'date',val:to}]);
  html+=_kpis([{label:'Total In',html:'<span class="u-green fw">'+PKR(t.totalIn||0)+'</span>'},{label:'Total Out',html:'<span class="u-red fw">'+PKR(t.totalOut||0)+'</span>'},{label:'Net Balance',html:'<span class="'+((t.closingBalance||0)>=0?'u-green':'u-red')+' fw">'+PKR(Math.abs(t.closingBalance||0))+'</span>'}]);
  html+=_section('Bank Statement',_printBtn('Bank Statement'),_table([{l:'Date'},{l:'Ref'},{l:'Type'},{l:'Description'},{l:'In (Cr)',r:true},{l:'Out (Dr)',r:true},{l:'Balance',r:true}],rows,[{v:'TOTAL',fw:true},'','','',{v:PKR(t.totalIn||0),r:true,fw:true},{v:PKR(t.totalOut||0),r:true},{v:PKR(Math.abs(t.closingBalance||0)),r:true,fw:true}]));
  return html;
};

ReportRenderer.dailyCashBook=function(data,params){
  var t=params._totals||{},date=data.date||_today();
  var html='<div style="margin-bottom:12px;display:flex;align-items:center;gap:10px">';
  html+='<label style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Date</label>';
  html+='<input type="date" class="rpt-filter-input" id="rpt-dcb-date" value="'+_esc(date)+'" onchange="RTP._rerun()">';
  html+='</div>';
  html+=_kpis([
    {label:'Cash Sales',html:'<span class="u-green fw">'+PKR(t.totalSalesCash||0)+'</span>'},
    {label:'Receipts (PayIn)',html:'<span class="u-green">'+PKR(t.totalCashIn||0)+'</span>'},
    {label:'Supplier Payments',html:'<span class="u-red">'+PKR(t.totalCashOut||0)+'</span>'},
    {label:'Cash Expenses',html:'<span class="u-red">'+PKR(t.totalExpOut||0)+'</span>'},
    {label:'Customer Refunds',html:'<span class="u-red">'+PKR(t.totalRefundOut||0)+'</span>'},
    {label:'Net Cash',html:'<span class="'+(( t.netCash||0)>=0?'u-green':'u-red')+' fw">'+PKR(t.netCash||0)+'</span>'}
  ]);
  var sRows=(data.cashSales||[]).map(function(s){return[{v:s.id,mono:true},{v:s.customer||'Walk-in'},{v:PKR(s.paid||0),r:true,fw:true},{html:'<span class="rpt-pill rpt-pill-green">Cash Sale</span>'}];});
  html+=_section('Cash Sales ('+((data.cashSales||[]).length)+')',_table([{l:'Invoice'},{l:'Customer'},{l:'Cash Paid',r:true},{l:'Type'}],sRows,[{v:'TOTAL',fw:true},'',{v:PKR(t.totalSalesCash||0),r:true,fw:true},'']));
  var piRows=(data.cashIn||[]).map(function(p){return[{v:p.id,mono:true},{v:p.party||'—'},{v:p.mode||'Cash'},{v:PKR(p.amount||0),r:true,fw:true},{v:p.against||'—'}];});
  html+=_section('Receipts / Payment In ('+((data.cashIn||[]).length)+')',_table([{l:'Receipt ID'},{l:'Party'},{l:'Mode'},{l:'Amount',r:true},{l:'Against'}],piRows,[{v:'TOTAL',fw:true},'','',{v:PKR(t.totalCashIn||0),r:true,fw:true},'']));
  var poRows=(data.payOut||[]).map(function(p){return[{v:p.id,mono:true},{v:p.supplier||p.party||p.sup||'—'},{v:p.mode||'Cash'},{v:PKR(p.amount||p.amt||0),r:true,fw:true},{v:p.against||p.ref||'—'}];});
  html+=_section('Supplier Payments ('+((data.payOut||[]).length)+')',_table([{l:'Payment ID'},{l:'Supplier'},{l:'Mode'},{l:'Amount',r:true},{l:'Against'}],poRows,[{v:'TOTAL',fw:true},'','',{v:PKR(t.totalCashOut||0),r:true,fw:true},'']));
  var expRows=(data.expenses||[]).map(function(e){return[{v:e.id,mono:true},{v:e.cat||'General'},{v:e.note||'—'},{v:PKR(e.amt||0),r:true,fw:true}];});
  html+=_section('Cash Expenses ('+((data.expenses||[]).length)+')',_table([{l:'ID'},{l:'Category'},{l:'Note'},{l:'Amount',r:true}],expRows,[{v:'TOTAL',fw:true},'','',{v:PKR(t.totalExpOut||0),r:true,fw:true}]));
  var refRows=(data.refunds||[]).map(function(r){return[{v:r.id,mono:true},{v:r.customer||'—'},{v:r.mode||'Cash'},{v:PKR(r.amount||0),r:true,fw:true},{v:r.notes||r.linkedCN||'—'}];});
  if(refRows.length)html+=_section('Customer Refunds ('+refRows.length+')',_table([{l:'ID'},{l:'Customer'},{l:'Mode'},{l:'Amount',r:true},{l:'Note'}],refRows,[{v:'TOTAL',fw:true},'','',{v:PKR(t.totalRefundOut||0),r:true,fw:true},'']));
  return html;
};

ReportRenderer.jobs=function(data,params){
  var from=params.from||_monthStart(),to=params.to||_today(),t=params._totals||{},statusCount=data.statusCount||{};
  var rows=(data.rows||[]).map(function(j){return[{v:j.id,mono:true},{v:_D(j.date||j.openedAt)},{v:j.plate||'—'},{v:j.mechanic||'—'},{v:j.status==='delivered'&&j.closedAt?_D(j.closedAt.slice(0,10)):'—'},{v:j._duration!==null?j._duration+' days':'—'},{v:PKR(_CALC.num(j.labour||0)),r:true},{html:'<span class="'+(j._profit>=0?'u-green':'u-red')+'">'+PKR(j._profit)+'</span>',r:true},{html:_pill(j.status)}];});
  var funnel='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">'+['pending','in-progress','waiting-parts','completed','delivered','cancelled'].map(function(st){var cnt=statusCount[st]||0;return'<div style="text-align:center;padding:8px 14px;border-radius:8px;background:var(--bg);border:1px solid var(--border)"><div style="font-size:18px;font-weight:700">'+cnt+'</div><div style="font-size:10px;color:var(--muted);text-transform:uppercase">'+st+'</div></div>';}).join('')+'</div>';
  var html=_filters('rpt-w1',[{key:'from',label:'From',type:'date',val:from},{key:'to',label:'To',type:'date',val:to},{key:'mech',label:'Mechanic',type:'text',ph:'Filter…',live:true},{key:'status',label:'Status',type:'select',options:[{v:'',l:'All'},{v:'pending',l:'Pending'},{v:'in-progress',l:'In Progress'},{v:'completed',l:'Completed'},{v:'delivered',l:'Delivered'},{v:'cancelled',l:'Cancelled'}]}]);
  html+=_kpis([{label:'Total Jobs',value:t.count||0},{label:'Labour Revenue',html:'<span class="fw">'+PKR(t.totalRev||0)+'</span>'},{label:'Profit',html:'<span class="'+((t.totalProfit||0)>=0?'u-green':'u-red')+' fw">'+PKR(t.totalProfit||0)+'</span>'}]);
  html+=funnel;
  html+=_section('Jobs ('+(t.count||0)+')',_printBtn('Jobs Report'),_table([{l:'Job #'},{l:'Date'},{l:'Plate'},{l:'Mechanic'},{l:'Closed'},{l:'Duration'},{l:'Labour',r:true},{l:'Profit',r:true},{l:'Status'}],rows));
  return html;
};

ReportRenderer.mechanicPerformance=function(data,params){
  var from=params.from||_monthStart(),to=params.to||_today();
  var rows=(data.rows||[]).map(function(m){var cr=m.jobs>0?((m.completedJobs/m.jobs)*100).toFixed(0)+'%':'—';var avg=m.closedJobs>0?(m.totalDays/m.closedJobs).toFixed(1):'—';return[{v:m.name,fw:true},{v:m.jobs,r:true},{v:m.completedJobs,r:true},{v:cr,r:true},{v:PKR(m.revenue),r:true},{html:'<span class="'+(m.profit>=0?'u-green':'u-red')+'">'+PKR(m.profit)+'</span>',r:true},{v:avg!=='—'?avg+' days':'—',r:true}];});
  var html=_filters('rpt-w2',[{key:'from',label:'From',type:'date',val:from},{key:'to',label:'To',type:'date',val:to}]);
  html+=_section('Mechanic Performance',_printBtn('Mechanic Performance'),_table([{l:'Mechanic'},{l:'Jobs',r:true},{l:'Completed',r:true},{l:'Completion %',r:true},{l:'Labour Revenue',r:true},{l:'Profit',r:true},{l:'Avg Time',r:true}],rows));
  return html;
};

ReportRenderer.vehicleHistory=function(data,params){
  var plate=data.plate||'';
  if(!plate)return'<div class="rpt-filter-strip"><label class="rpt-filter-label">Number Plate <input id="rpt-w3-plate" type="text" class="rpt-filter-input" placeholder="e.g. LEA-1234" style="text-transform:uppercase" onkeydown="if(event.key===\'Enter\')RTP._rerun()"></label><button class="btn btn-primary btn-sm" onclick="RTP._rerun()" style="margin-top:16px">🔍 Search</button></div><div style="text-align:center;padding:40px;color:var(--muted)">Enter a number plate and click Search</div>';
  var vehicle=data.vehicle,t=params._totals||{};
  var vehInfo=vehicle?'<div style="padding:12px;background:var(--bg);border-radius:8px;margin-bottom:12px;display:flex;gap:20px;flex-wrap:wrap"><span><strong>Make:</strong> '+_esc(vehicle.make||'—')+'</span><span><strong>Model:</strong> '+_esc(vehicle.model||'—')+'</span><span><strong>Year:</strong> '+_esc(vehicle.year||'—')+'</span><span><strong>Color:</strong> '+_esc(vehicle.color||'—')+'</span></div>':'<div style="padding:8px;color:var(--muted);font-size:12px">Vehicle not in records — showing jobs only</div>';
  var jobRows=(data.rows||[]).map(function(j){return[{v:_D(j.date||j.openedAt)},{v:j.id,mono:true},{v:j.mechanic||'—'},{v:(j._parts||'').slice(0,60)||'—'},{v:PKR(_CALC.num(j.labour||0)),r:true},{v:PKR(j._jobTotal||0),r:true,fw:true},{html:_pill(j.status)}];});
  var html='<div class="rpt-filter-strip"><label class="rpt-filter-label">Number Plate <input id="rpt-w3-plate" type="text" class="rpt-filter-input" placeholder="e.g. LEA-1234" value="'+_esc(plate)+'" style="text-transform:uppercase" onkeydown="if(event.key===\'Enter\')RTP._rerun()"></label><button class="btn btn-primary btn-sm" onclick="RTP._rerun()" style="margin-top:16px">🔍 Search</button></div>';
  html+=_kpis([{label:'Total Visits',value:t.visitCount||0},{label:'Total Spend',html:'<span class="fw">'+PKR(t.totalSpend||0)+'</span>'}]);
  html+=vehInfo;
  html+=_section('Job History — '+_esc(plate),_printBtn('Vehicle History'),_table([{l:'Date'},{l:'Job #'},{l:'Mechanic'},{l:'Parts Used'},{l:'Labour',r:true},{l:'Total',r:true},{l:'Status'}],jobRows));
  return html;
};

ReportRenderer.appointments=function(data,params){
  var from=params.from||_monthStart(),to=params.to||_today(),t=params._totals||{};
  var rows=(data.rows||[]).map(function(a){return[{v:_D(a.date)},{v:a.id,mono:true},{v:a.plate||'—'},{v:a.customerName||a.customer||'—'},{v:a.ph||'—'},{v:a.bookingSource||'Walk-in'},{v:a.note||'—'},{html:_pill(a.status)}];});
  var html=_filters('rpt-w4',[{key:'from',label:'From',type:'date',val:from},{key:'to',label:'To',type:'date',val:to}]);
  html+=_kpis([{label:'Total Appointments',value:t.total||0},{label:'Completed',html:'<span class="u-green fw">'+(t.completed||0)+'</span>'},{label:'No-show / Cancelled',html:'<span class="u-red fw">'+(t.noShow||0)+'</span>'},{label:'Show Rate',html:'<span>'+((t.total||0)>0?((1-(t.noShow||0)/(t.total||1))*100).toFixed(0)+'%':'—')+'</span>'}]);
  var sourceMap=data.sourceMap||{};if(Object.keys(sourceMap).length>1)html+=_section('Booking Source',_table([{l:'Source'},{l:'Count',r:true}],Object.keys(sourceMap).map(function(k){return[{v:k},{v:sourceMap[k],r:true}];})));
  html+=_section('Appointments ('+(t.total||0)+')',_printBtn('Appointments'),_table([{l:'Date'},{l:'ID'},{l:'Plate'},{l:'Customer'},{l:'Phone'},{l:'Source'},{l:'Note'},{l:'Status'}],rows));
  return html;
};

ReportRenderer.monthlyComparison=function(data,params){
  var year=data.year||parseInt(_today().slice(0,4),10),t=params._totals||{};
  var rawData=data.data||[],rolling=data.rolling||[],sales=data.sales||[];
  var best=rawData.reduce(function(b,d){return d.rev>b.rev?d:b;},rawData[0]||{});
  var ytdCum=0;
  var rows=rawData.map(function(d,i){ytdCum+=d.rev;var prevRev=sales.filter(function(s){return(s.date||'').startsWith((year-1)+'-'+String(i+1).padStart(2,'0'));}).reduce(function(s,x){return s+_CALC.saleTotal(x);},0);var yoy=prevRev>0?PCT((d.rev-prevRev)/prevRev*100):'—';var isBest=best&&d.month===best.month;return[
    {html:'<span class="fw">'+d.month+(isBest?' 🌟':'')+'</span>'},
    {v:d.count,r:true},
    {v:PKR(d.gross||d.rev),r:true},
    {html:d.retAmt>0?'<span class="u-red">-'+PKR(d.retAmt)+'</span>':'—',r:true},
    {html:'<span class="'+(isBest?'u-green fw':'')+'">'+PKR(d.rev)+'</span>',r:true},
    {v:PKR(d.exp),r:true},
    {html:'<span class="'+(d.profit>=0?'u-green':'u-red')+'">'+PKR(d.profit)+'</span>',r:true},
    {v:PKR(rolling[i]||0),r:true},
    {v:PKR(ytdCum),r:true,fw:true},
    {html:'<span class="'+(yoy.startsWith('-')?'u-red':(yoy==='—'?'':'u-green'))+'">'+_esc(yoy)+'</span>',r:true}
  ];});
  var html=_filters('rpt-a1',[{key:'year',label:'Year',type:'number',val:year,ph:'2024'}]);
  html+=_kpis([{label:'Best Month',html:'<span class="u-green fw">'+_esc(best?best.month+' ('+PKR(best.rev)+')':'—')+'</span>'},{label:'Net Revenue (Year)',html:'<span class="fw">'+PKR(t.yearTotal||0)+'</span>'}]);
  html+=_section('Monthly Comparison — '+year,_printBtn('Monthly Comparison'),_table(
    [{l:'Month'},{l:'Orders',r:true},{l:'Gross',r:true},{l:'Returns',r:true},{l:'Net Rev',r:true},{l:'Expenses',r:true},{l:'Profit',r:true},{l:'3M Avg',r:true},{l:'YTD',r:true},{l:'YoY %',r:true}],
    rows,
    [{v:'TOTAL',fw:true},'',{v:PKR(rawData.reduce(function(s,d){return s+(d.gross||d.rev);},0)),r:true},{html:'<span class="u-red">'+PKR(rawData.reduce(function(s,d){return s+(d.retAmt||0);},0))+'</span>',r:true},{v:PKR(t.yearTotal||0),r:true,fw:true},'','','','','']
  ));
  return html;
};

ReportRenderer.yearComparison=function(data,params){
  var yearA=data.yearA,yearB=data.yearB,t=params._totals||{};
  var rows=(data.rows||[]).map(function(r){var diff=r.revA>0?PCT((r.revB-r.revA)/r.revA*100):'—';var isUp=!diff.startsWith('-')&&diff!=='—';return[{v:r.month},{v:PKR(r.revA),r:true},{v:PKR(r.revB),r:true,fw:true},{html:'<span class="'+(isUp?'u-green':diff==='—'?'':'u-red')+'">'+_esc(diff)+'</span>',r:true}];});
  var html=_filters('rpt-a2',[{key:'year1',label:'Year A',type:'number',val:yearA},{key:'year2',label:'Year B',type:'number',val:yearB}]);
  html+=_kpis([{label:yearA+' Total',html:'<span>'+PKR(t.totA||0)+'</span>'},{label:yearB+' Total',html:'<span class="fw">'+PKR(t.totB||0)+'</span>'},{label:'Change',html:'<span class="'+((t.totB||0)>=(t.totA||0)?'u-green':'u-red')+' fw">'+((t.totA||0)>0?PCT(((t.totB||0)-(t.totA||0))/(t.totA||1)*100):'—')+'</span>'}]);
  html+=_section('Year Comparison: '+yearA+' vs '+yearB,_printBtn('Year Comparison'),_table([{l:'Month'},{l:yearA,r:true},{l:yearB,r:true},{l:'Change %',r:true}],rows,[{v:'TOTAL',fw:true},{v:PKR(t.totA||0),r:true},{v:PKR(t.totB||0),r:true,fw:true},{html:'<span class="'+((t.totB||0)>=(t.totA||0)?'u-green':'u-red')+'">'+((t.totA||0)>0?PCT(((t.totB||0)-(t.totA||0))/(t.totA||1)*100):'—')+'</span>',r:true}]));
  return html;
};

ReportRenderer.plVariance=function(data,params){
  var d=data;
  function _var(cur,prev){var diff=cur-prev,pct=prev!==0?PCT(diff/prev*100):'—';return{diff:diff,pct:pct};}
  var vR=_var(d.curRev,d.prevRev),vE=_var(d.curExp,d.prevExp),vP=_var(d.curProfit,d.prevProfit);
  var rows=[['Revenue',PKR(d.prevRev),PKR(d.curRev),PKR(vR.diff),vR.pct,vR.diff>=0?'✅':'⚠️'],['Expenses',PKR(d.prevExp),PKR(d.curExp),PKR(vE.diff),vE.pct,vE.diff<=0?'✅':'⚠️'],['Net Profit',PKR(d.prevProfit),PKR(d.curProfit),PKR(vP.diff),vP.pct,vP.diff>=0?'✅':'🚨']].map(function(r){return r.map(function(v){return{v:v};});});
  var html=_filters('rpt-a3',[{key:'month',label:'Current Month',type:'month',val:d.month}]);
  if(d.ledger&&d.ledger.ready)html+=_lo('GL Integrity — Ledger View',[{label:'Ledger Balanced',value:d.ledger.balanced?'YES ✓':'NO ✗',cls:d.ledger.balanced?'p8-green p8-fw':'p8-red p8-fw'},{label:'GST Payable (GL)',value:PKR(d.ledger.gstPayable||0),cls:'p8-muted'},{label:'GST Receivable (GL)',value:PKR(d.ledger.gstRec||0),cls:'p8-muted'},{label:'Net GST Liability (GL)',value:PKR(d.ledger.netGST||0),cls:(d.ledger.netGST||0)>0?'p8-red':'p8-green'}],null,null,'Source: General Ledger — double-entry balance check');
  html+=_kpis([{label:'Revenue Change',html:'<span class="'+(vR.diff>=0?'u-green':'u-red')+' fw">'+_esc(vR.pct)+'</span>'},{label:'Profit Change',html:'<span class="'+(vP.diff>=0?'u-green':'u-red')+' fw">'+_esc(vP.pct)+'</span>'}]);
  html+=_section('P&L Variance: '+d.prevMo+' → '+d.month,_printBtn('P&L Variance'),_table([{l:'Metric'},{l:d.prevMo,r:true},{l:d.month,r:true},{l:'Change Rs.',r:true},{l:'Change %',r:true},{l:'Status'}],rows));
  return html;
};


var _P={
  salesMain:         function(){return{from:(_el('rpt-s1-from')||{}).value||'',to:(_el('rpt-s1-to')||{}).value||'',cust:(_el('rpt-s1-cust')||{}).value||'',user:(_el('rpt-s1-user')||{}).value||'',cat:(_el('rpt-s1-cat')||{}).value||'',pay:(_el('rpt-s1-pay')||{}).value||'',status:(_el('rpt-s1-status')||{}).value||''};},
  saleLedger:        function(){return{from:(_el('rpt-s2-from')||{}).value||'',to:(_el('rpt-s2-to')||{}).value||'',cust:(_el('rpt-s2-cust')||{}).value||''};},
  aging:             function(){return{type:(_el('rpt-s3-type')||{}).value||'customers'};},
  partyStatement:    function(){return{cust:(_el('rpt-s4-cust')||{}).value||'',from:(_el('rpt-s4-from')||{}).value||'',to:(_el('rpt-s4-to')||{}).value||''};},
  customers:         function(){return{search:(_el('rpt-s5-search')||{}).value||'',sortBy:(_el('rpt-s5-sort')||{}).value||'outstanding'};},
  saleSummary:       function(){return{from:(_el('rpt-s6-from')||{}).value||'',to:(_el('rpt-s6-to')||{}).value||'',groupBy:(_el('rpt-s6-group')||{}).value||'day'};},
  discount:          function(){return{from:(_el('rpt-s7-from')||{}).value||'',to:(_el('rpt-s7-to')||{}).value||''};},
  saleReturns:       function(){return{from:(_el('rpt-s8-from')||{}).value||'',to:(_el('rpt-s8-to')||{}).value||''};},
  payIn:             function(){return{from:(_el('rpt-s9-from')||{}).value||'',to:(_el('rpt-s9-to')||{}).value||'',method:(_el('rpt-s9-method')||{}).value||''};},
  lowStock:          function(){return{threshold:(_el('rpt-i1-thresh')||{}).value||''};},
  stockValuation:    function(){return{cat:(_el('rpt-i2-cat')||{}).value||''};},
  itemPL:            function(){return{from:(_el('rpt-i3-from')||{}).value||'',to:(_el('rpt-i3-to')||{}).value||''};},
  stockMovement:     function(){return{from:(_el('rpt-i4-from')||{}).value||'',to:(_el('rpt-i4-to')||{}).value||'',item:(_el('rpt-i4-item')||{}).value||''};},
  batchExpiry:       function(){return{days:(_el('rpt-i5-days')||{}).value||'30'};},
  purchaseLedger:    function(){return{from:(_el('rpt-p1-from')||{}).value||'',to:(_el('rpt-p1-to')||{}).value||'',sup:(_el('rpt-p1-sup')||{}).value||'',status:(_el('rpt-p1-status')||{}).value||''};},
  suppliers:         function(){return{search:(_el('rpt-p2-search')||{}).value||'',from:(_el('rpt-p2-from')||{}).value||'',to:(_el('rpt-p2-to')||{}).value||''};},
  purchaseReturns:   function(){return{from:(_el('rpt-p3-from')||{}).value||'',to:(_el('rpt-p3-to')||{}).value||''};},
  pl:                function(){return{from:(_el('rpt-f1-from')||{}).value||'',to:(_el('rpt-f1-to')||{}).value||''};},
  balanceSheet:      function(){return{asOf:(_el('rpt-f2-date')||{}).value||''};},
  cashFlow:          function(){return{from:(_el('rpt-f3-from')||{}).value||'',to:(_el('rpt-f3-to')||{}).value||''};},
  expenses:          function(){return{from:(_el('rpt-f4-from')||{}).value||'',to:(_el('rpt-f4-to')||{}).value||'',cat:(_el('rpt-f4-cat')||{}).value||''};},
  bankStatement:     function(){return{from:(_el('rpt-f5-from')||{}).value||'',to:(_el('rpt-f5-to')||{}).value||''};},
  jobs:              function(){return{from:(_el('rpt-w1-from')||{}).value||'',to:(_el('rpt-w1-to')||{}).value||'',mech:(_el('rpt-w1-mech')||{}).value||'',status:(_el('rpt-w1-status')||{}).value||''};},
  mechanicPerformance:function(){return{from:(_el('rpt-w2-from')||{}).value||'',to:(_el('rpt-w2-to')||{}).value||''};},
  vehicleHistory:    function(){return{plate:(_el('rpt-w3-plate')||{}).value||''};},
  appointments:      function(){return{from:(_el('rpt-w4-from')||{}).value||'',to:(_el('rpt-w4-to')||{}).value||''};},
  monthlyComparison: function(){return{year:(_el('rpt-a1-year')||{}).value||''};},
  yearComparison:    function(){return{year1:(_el('rpt-a2-year1')||{}).value||'',year2:(_el('rpt-a2-year2')||{}).value||''};},
  plVariance:        function(){return{month:(_el('rpt-a3-month')||{}).value||''};},
  dailyCashBook:     function(){return{date:(_el('rpt-dcb-date')||{}).value||_today()};}
};

var REPORTS=[
  {id:'sales_main',      cat:'SALE',      label:'Sales Report',         icon:'📊',qk:'salesMain',           rk:'salesMain'},
  {id:'sale_ledger',     cat:'SALE',      label:'Sale Ledger',          icon:'📒',qk:'saleLedger',          rk:'saleLedger'},
  {id:'aging',           cat:'SALE',      label:'Aging Report',         icon:'⏳',qk:'aging',               rk:'aging'},
  {id:'party_stmt',      cat:'SALE',      label:'Party Statement',      icon:'🧾',qk:'partyStatement',      rk:'partyStatement'},
  {id:'customers',       cat:'SALE',      label:'Customer Report',      icon:'👥',qk:'customers',           rk:'customers'},
  {id:'sale_summary',    cat:'SALE',      label:'Sale Summary',         icon:'📅',qk:'saleSummary',         rk:'saleSummary'},
  {id:'discount',        cat:'SALE',      label:'Discount Report',      icon:'🏷️',qk:'discount',            rk:'discount'},
  {id:'sale_returns',    cat:'SALE',      label:'Sale Returns',         icon:'↩️',qk:'saleReturns',         rk:'saleReturns'},
  {id:'pay_in',          cat:'SALE',      label:'Payment Received',     icon:'💰',qk:'payIn',               rk:'payIn'},
  {id:'low_stock',       cat:'INVENTORY', label:'Low Stock Alert',      icon:'⚠️',qk:'lowStock',            rk:'lowStock'},
  {id:'stock_val',       cat:'INVENTORY', label:'Stock Valuation',      icon:'📦',qk:'stockValuation',      rk:'stockValuation'},
  {id:'item_pl',         cat:'INVENTORY', label:'Item Wise P&L',        icon:'📈',qk:'itemPL',              rk:'itemPL'},
  {id:'stock_movement',  cat:'INVENTORY', label:'Stock Movement',       icon:'🔄',qk:'stockMovement',       rk:'stockMovement'},
  {id:'batch_expiry',    cat:'INVENTORY', label:'Batch / Expiry',       icon:'🗓️',qk:'batchExpiry',         rk:'batchExpiry'},
  {id:'purchase_ledger', cat:'PURCHASE',  label:'Purchase Ledger',      icon:'🛒',qk:'purchaseLedger',      rk:'purchaseLedger'},
  {id:'suppliers',       cat:'PURCHASE',  label:'Supplier Report',      icon:'🏭',qk:'suppliers',           rk:'suppliers'},
  {id:'purchase_returns',cat:'PURCHASE',  label:'Purchase Returns',     icon:'↩️',qk:'purchaseReturns',     rk:'purchaseReturns'},
  {id:'pl',              cat:'FINANCIAL', label:'P&L Statement',        icon:'💹',qk:'pl',                  rk:'pl'},
  {id:'balance_sheet',   cat:'FINANCIAL', label:'Balance Sheet',        icon:'⚖️',qk:'balanceSheet',        rk:'balanceSheet'},
  {id:'cash_flow',       cat:'FINANCIAL', label:'Cash Flow',            icon:'💸',qk:'cashFlow',            rk:'cashFlow'},
  {id:'expenses',        cat:'FINANCIAL', label:'Expense Report',       icon:'🧾',qk:'expenses',            rk:'expenses'},
  {id:'bank_stmt',       cat:'FINANCIAL', label:'Bank Statement',       icon:'🏦',qk:'bankStatement',       rk:'bankStatement'},
  {id:'daily_cashbook',  cat:'FINANCIAL', label:'Daily Cash Book',       icon:'📒',qk:'dailyCashBook',       rk:'dailyCashBook'},
  {id:'jobs',            cat:'WORKSHOP',  label:'Jobs Report',          icon:'🔧',qk:'jobs',                rk:'jobs'},
  {id:'mech_perf',       cat:'WORKSHOP',  label:'Mechanic Performance', icon:'👨‍🔧',qk:'mechanicPerformance', rk:'mechanicPerformance'},
  {id:'vehicle_hist',    cat:'WORKSHOP',  label:'Vehicle History',      icon:'🚗',qk:'vehicleHistory',      rk:'vehicleHistory'},
  {id:'appointments',    cat:'WORKSHOP',  label:'Appointments',         icon:'📅',qk:'appointments',        rk:'appointments'},
  {id:'monthly_cmp',     cat:'ANALYSIS',  label:'Monthly Comparison',   icon:'📆',qk:'monthlyComparison',   rk:'monthlyComparison'},
  {id:'year_cmp',        cat:'ANALYSIS',  label:'Year Comparison',      icon:'📊',qk:'yearComparison',      rk:'yearComparison'},
  {id:'pl_variance',     cat:'ANALYSIS',  label:'P&L Variance',         icon:'📉',qk:'plVariance',          rk:'plVariance'}
];

function _injectCSS(){
  if(document.getElementById('rpt-css'))return;
  var s=document.createElement('style');s.id='rpt-css';
  s.textContent=[
'.rpt-shell{display:flex;height:100%;min-height:calc(100vh - 52px);background:#f4f6f9;font-family:inherit}',
'.rpt-sidebar{width:220px;min-width:200px;background:linear-gradient(180deg,#0f172a 0%,#131b2e 100%);border-right:none;overflow-y:auto;flex-shrink:0;display:flex;flex-direction:column;padding:14px 0}',
'.rpt-sidebar-logo{padding:8px 16px 14px;border-bottom:1px solid rgba(255,255,255,.07);margin-bottom:8px;display:flex;align-items:center;gap:10px}',
'.rpt-sidebar-logo::before{content:"";width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#4338CA,#38bdf8);flex-shrink:0}',
'.rpt-sidebar-logo-title{font-size:13px;font-weight:800;color:#fff;letter-spacing:-.2px}',
'.rpt-sidebar-logo-sub{font-size:10px;color:#64748b;margin-top:1px}',
'.rpt-content-area{flex:1;overflow-y:auto;padding:22px 26px 60px;background:#f8fafc;scroll-behavior:smooth;overflow-x:hidden;min-width:0}',
'.rpt-cat-label{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#4b5a76;padding:14px 18px 6px}',
'.rpt-nav-item{display:flex;align-items:center;gap:10px;padding:9px 18px;font-size:13px;cursor:pointer;color:#a3b0c7;font-weight:500;border-left:3px solid transparent;transition:all .15s}',
'.rpt-nav-item:hover{background:rgba(99,102,241,.08);color:#fff}',
'.rpt-nav-item.active{background:linear-gradient(90deg,rgba(67,56,202,.28),rgba(67,56,202,0));color:#fff;border-left-color:#6366f1;font-weight:700}',
'.rpt-nav-icon{font-size:14px;width:18px;text-align:center;flex-shrink:0}',
'.rpt-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:10px;padding:16px 20px;background:#fff;border:1px solid #eef1f6;border-radius:12px;box-shadow:0 1px 3px rgba(15,23,42,.04)}',
'.rpt-title{font-size:18px;font-weight:800;color:#0f172a;display:flex;align-items:center;gap:10px;letter-spacing:-.3px}',
'.rpt-filter-strip{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;background:#fff;border:1px solid #eef1f6;border-radius:12px;padding:16px 18px;margin-bottom:18px;box-shadow:0 1px 3px rgba(15,23,42,.04)}',
'.rpt-filter-label{font-size:10.5px;font-weight:700;color:#94a3b8;display:flex;flex-direction:column;gap:6px;letter-spacing:.05em;text-transform:uppercase}',
'.rpt-filter-input{height:36px;border:1.5px solid #e2e8f0;border-radius:8px;padding:0 12px;font-size:13px;background:#fafbfc;color:#0f172a;min-width:150px;outline:none;transition:border-color .15s;font-family:inherit;font-weight:500}',
'.rpt-filter-input:focus{border-color:#6366f1;background:#fff;box-shadow:0 0 0 3px rgba(99,102,241,.12)}',
'.rpt-kpi-row{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:18px}',
'.rpt-kpi{background:#fff;border:1px solid #eef1f6;border-radius:12px;padding:16px 18px;min-width:150px;flex:1;cursor:default;position:relative;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.04);transition:transform .12s,box-shadow .12s}',
'.rpt-kpi:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(15,23,42,.08)}',
'.rpt-kpi::before{content:"";position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#4338CA,#818cf8)}',
'.rpt-kpi:nth-child(4n+2)::before{background:linear-gradient(90deg,#0891b2,#38bdf8)}',
'.rpt-kpi:nth-child(4n+3)::before{background:linear-gradient(90deg,#15803d,#4ade80)}',
'.rpt-kpi:nth-child(4n+4)::before{background:linear-gradient(90deg,#b91c1c,#f87171)}',
'.rpt-kpi-label{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-bottom:7px}',
'.rpt-kpi-value{font-size:21px;font-weight:800;color:#0f172a;line-height:1.2;overflow-wrap:break-word;word-break:break-word;letter-spacing:-.4px}',
'.rpt-kpi-sub{font-size:11px;color:#94a3b8;margin-top:4px;font-weight:600}',
'.rpt-section{background:#fff;border:1px solid #eef1f6;border-radius:12px;margin-bottom:16px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.04)}',
'.rpt-section-head{display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-bottom:1px solid #f1f5f9;background:#fafbfc}',
'.rpt-section-title{font-size:12.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#0f172a}',
'.rpt-section-meta{font-size:11.5px;color:#94a3b8;font-weight:600}',
'.rpt-section-body{padding:0;overflow-x:auto;max-width:100%;box-sizing:border-box}',
'.rpt-table{width:100%;border-collapse:collapse;font-size:13px}',
'.rpt-table thead tr{background:#fafbfc}',
'.rpt-table th{padding:11px 16px;text-align:left;font-size:10.5px;font-weight:700;color:#64748b;letter-spacing:.05em;border-bottom:1.5px solid #eef1f6;white-space:nowrap;text-transform:uppercase}',
'.rpt-table th.r{text-align:right}',
'.rpt-table td{padding:11px 16px;border-bottom:1px solid #f5f7fa;vertical-align:middle;color:#1e293b}',
'.rpt-table td.r{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}',
'.rpt-table td.fw{font-weight:700}',
'.rpt-table td.mono{font-family:monospace;font-size:11.5px;color:#64748b}',
'.rpt-table tbody tr:last-child td{border-bottom:none}',
'.rpt-table tbody tr:hover td{background:#fafbff}',
'.rpt-table tfoot tr{background:#f8fafc}',
'.rpt-table tfoot td{font-weight:800;font-size:13px;border-top:2px solid #4338CA;padding:11px 16px;color:#0f172a}',
'.rpt-table tfoot td.r{text-align:right;font-variant-numeric:tabular-nums}',
'.rpt-pill{display:inline-flex;align-items:center;padding:3px 11px;border-radius:9999px;font-size:11.5px;font-weight:700}',
'.rpt-pill-green{background:#ecfdf5;color:#15803d}',
'.rpt-pill-red{background:#fef2f2;color:#b91c1c}',
'.rpt-pill-orange{background:#fffbeb;color:#b45309}',
'.rpt-pill-blue{background:#eef2ff;color:#4338CA}',
'.rpt-pill-purple{background:#f5f3ff;color:#6d28d9}',
'.rpt-pill-teal{background:#f0fdfa;color:#0f766e}',
'.rpt-pill-gray{background:#f1f5f9;color:#64748b}',
'.rpt-pl-sheet{max-width:640px;margin:0 auto;padding:6px 0}',
'.rpt-pl-row{display:flex;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #f5f7fa;font-size:13.5px;transition:background .1s;border-radius:6px}',
'.rpt-pl-row:hover{background:#fafbff}',
'.rpt-pl-row:last-child{border-bottom:none}',
'.rpt-pl-row.fw{font-weight:800;font-size:14px;background:#fafbfc}',
'.p8-overlay{background:var(--white,#fff);color:var(--text,#0f172a);border-radius:10px;padding:14px 16px 12px;margin-bottom:14px;border:0.5px solid var(--border,#e2e8f0)}',
'.p8-overlay-head{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}',
'.p8-overlay-icon{font-size:15px}',
'.p8-overlay-title{font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.07em;color:var(--primary,#4338CA)}',
'.p8-overlay-badge{margin-left:auto;background:#4F46E5;color:#fff;font-size:9px;font-weight:500;letter-spacing:.07em;text-transform:uppercase;padding:3px 9px;border-radius:20px}',
'.p8-kpi-row{display:flex;flex-wrap:wrap;gap:10px}',
'.p8-kpi{background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;padding:9px 12px;min-width:120px;flex:1}',
'.p8-kpi-label{font-size:9px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-bottom:4px}',
'.p8-kpi-value{font-size:14px;font-weight:500;color:#e2e8f0}',
'.p8-green{color:#4ade80!important}',
'.p8-red{color:#f87171!important}',
'.p8-muted{color:#94a3b8!important}',
'.p8-fw{font-weight:500!important}',
'.p8-overlay-source{font-size:9px;color:var(--muted,#64748b);margin-top:8px;padding-top:6px;border-top:0.5px solid var(--border,#e2e8f0)}',
'.u-red{color:#a32d2d}.u-green{color:#3b6d11}.u-orange{color:#ba7517}.fw{font-weight:500}',
'.rpt-print-btn{font-size:12px!important;font-weight:700!important;padding:8px 16px!important;border-radius:8px!important;border:none!important;background:linear-gradient(135deg,#4338CA,#6366f1)!important;color:#fff!important;cursor:pointer;transition:all .15s;box-shadow:0 2px 10px rgba(67,56,202,.3)}',
'.rpt-print-btn:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(67,56,202,.4)}',
'@page{size:A4 portrait;margin:10mm 12mm 14mm 12mm}',
'@media print{',
'.rpt-sidebar,.rpt-header .rpt-actions,.rpt-filter-strip,.rpt-print-btn,.sb,.topbar,#toast-box,#spinner{display:none!important}',
'.rpt-shell{display:block}.rpt-content-area{padding:0;overflow:visible;background:#fff}',
'.rpt-table{font-size:9pt}.rpt-section{break-inside:avoid;border-radius:0;border:0.5px solid #dbe4f0}',
'.rpt-kpi{border-radius:0;break-inside:avoid}',
'.p8-overlay{background:#f8fafc!important;color:#0B1220!important;border:0.5px solid #dbe4f0!important;border-radius:0}',
'.p8-kpi{background:#fff!important;border:0.5px solid #dbe4f0!important}',
'.p8-kpi-label{color:#8fa8c8!important}.p8-kpi-value{color:#0B1220!important}',
'.p8-green{color:#3b6d11!important}.p8-red{color:#a32d2d!important}',
'.btn-whatsapp{display:none!important}',
'.rpt-header{border:0.5px solid #dbe4f0!important;border-radius:0}',
'body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}',
'@media(max-width:640px){',
'.rpt-shell{flex-direction:column}',
'.rpt-sidebar{width:100%;min-width:unset;border-right:none;border-bottom:0.5px solid #dbe4f0;max-height:52px;overflow:hidden;flex-direction:row;flex-wrap:wrap}',
'.rpt-sidebar-logo{display:none}.rpt-cat-label{display:none}',
'.rpt-nav-item{border-radius:20px;padding:5px 12px;font-size:11px;flex-shrink:0;margin:2px 4px;border-left:none}',
'.rpt-kpi{min-width:130px}.p8-kpi{min-width:100px}}'
  ].join('');
  document.head.appendChild(s);
}


var _currentReport=null;

function _buildSidebar(){
  var cats=['SALE','INVENTORY','PURCHASE','FINANCIAL','WORKSHOP','ANALYSIS'];
  var catLabels={SALE:'Sales',INVENTORY:'Inventory',PURCHASE:'Purchase',FINANCIAL:'Financial',WORKSHOP:'Workshop',ANALYSIS:'Analysis'};
  var bizName=(ERP.getState&&ERP.getState().data&&ERP.getState().data.biz&&ERP.getState().data.biz.name)||'MH Autos';
  var logoHtml='<div class="rpt-sidebar-logo"><div class="rpt-sidebar-logo-title">'+_esc(bizName)+'</div><div class="rpt-sidebar-logo-sub">Business Reports &amp; Analytics</div></div>';
  return logoHtml+cats.map(function(cat){var items=REPORTS.filter(function(r){return r.cat===cat;});return'<div class="rpt-cat-label">'+_esc(catLabels[cat])+'</div>'+items.map(function(r){return'<div class="rpt-nav-item'+(r.id===_currentReport?' active':'')+'" onclick="RTP.show(\''+r.id+'\')" data-rpt-id="'+r.id+'"><span class="rpt-nav-icon">'+r.icon+'</span><span>'+_esc(r.label)+'</span></div>';}).join('');}).join('');
}

function _runReport(id){
  var rpt=REPORTS.find(function(r){return r.id===id;});
  if(!rpt)return'<div style="padding:40px;text-align:center;color:var(--muted)">Report "'+_esc(id)+'" not found</div>';
  var t0=Date.now();
  try{
    var state=ERP.getState?ERP.getState():{data:{}};
    var params=_P[rpt.qk]?_P[rpt.qk]():{};params._biz=(state.data&&state.data.biz)||{};
    var result=ReportQuery[rpt.qk](params,state);
    params._totals=result.totals;
    var html=ReportRenderer[rpt.rk](result.data,params);
    var elapsed=Date.now()-t0;
    var warn=result.warnings&&result.warnings.length?'<div style="margin:8px 0;padding:8px 14px;background:var(--warning-light,#fef3c7);border:1px solid var(--warning,#f59e0b);border-radius:8px;font-size:12px">⚠️ '+result.warnings.map(_esc).join(' · ')+'</div>':'';
    var syncWarn='';
    try{if(global.ERP&&global.ERP.PostingEngine&&typeof global.ERP.PostingEngine.hasStateSyncFailures==='function'&&global.ERP.PostingEngine.hasStateSyncFailures()){syncWarn='<div style="margin:8px 0;padding:8px 14px;background:var(--danger-light,#fee2e2);border:1px solid var(--danger,#dc2626);border-radius:8px;font-size:12px">⚠️ <strong>Data may be incomplete:</strong> some GL postings failed to sync into in-memory state. Reload the app to refresh figures, or check Settings → Diagnostics.</div>';}}catch(_sw){}
    var perf=elapsed>3000?'<div style="margin:8px 0;padding:8px 14px;background:var(--warning-light,#fef3c7);border:1px solid var(--warning,#f59e0b);border-radius:8px;font-size:12px">⚠️ <strong>Slow Report:</strong> Took '+(elapsed/1000).toFixed(1)+'s — try narrowing the date range.</div>':'';
    return'<div class="rpt-header"><div class="rpt-title">'+rpt.icon+' '+_esc(rpt.label)+'</div><div class="rpt-actions" style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" onclick="RTP._rerun()">Refresh</button><button class="btn btn-ghost btn-sm" onclick="RTP._print(\''+_esc(rpt.label)+'\')">Print / PDF</button></div></div>'+syncWarn+warn+perf+html;
  }catch(e){
    var elapsed2=Date.now()-t0;
    console.error('[reports.js] Error in report: '+id,e);
    var isMemErr=e instanceof RangeError||(e.message&&e.message.toLowerCase().indexOf('memory')!==-1);
    return'<div style="padding:40px;text-align:center;color:var(--danger)">❌ Report error: '+(isMemErr?'Data bahut zyada hai — date range narrow karein.':_esc(e.message||'Unknown error'))+'<br><small style="color:var(--muted)">'+_esc(id)+' ('+elapsed2+'ms)</small></div>';
  }
}

function _renderPanel(){
  _injectCSS();
  var panel=_el('pv-reports');if(!panel)return;
  if(!panel.querySelector('.rpt-shell')){panel.innerHTML='<div class="rpt-shell"><div class="rpt-sidebar" id="rpt-sidebar"></div><div class="rpt-content-area" id="rpt-content-area"><div id="rpt-content"><div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:320px;padding:60px 24px;text-align:center"><div style="width:48px;height:48px;background:#e6f1fb;border-radius:9px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div><div style="font-size:16px;font-weight:500;color:#0B1220;margin-bottom:8px">Business Reports</div><div style="font-size:12px;color:#8fa8c8;max-width:300px;margin:0 auto;line-height:1.7">Select a report from the sidebar to view analytics, summaries and print-ready documents.</div><div style="margin-top:10px;font-size:11px;color:#b5d4f4">'+REPORTS.length+' reports across 6 categories</div></div></div></div></div>';}
  var sb=_el('rpt-sidebar');if(sb)sb.innerHTML=_buildSidebar();
  if(_currentReport){var ct=_el('rpt-content');if(ct)ct.innerHTML=_runReport(_currentReport);}
}

var RTP={
  _rerunTimer:null,

  show:function(id){
    _currentReport=id;
    if(typeof ERP.go==='function')ERP.go('reports');else if(typeof global.go==='function')global.go('reports');
    var _t0=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
    setTimeout(function(){
      _renderPanel();
      var ai=document.querySelector('.rpt-nav-item.active');if(ai)ai.scrollIntoView({block:'nearest',behavior:'smooth'});
      var ca=_el('rpt-content-area');if(ca)ca.scrollTop=0;
      var _t1=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
      if(ERP.EventBus&&typeof ERP.EventBus.emit==='function')ERP.EventBus.emit('report:generated',{type:id,durationMs:Math.round(_t1-_t0)});
    },100);
  },

  _rerun:function(){
    if(!_currentReport)return;
    var ct=_el('rpt-content');if(!ct)return;
    if(RTP._rerunTimer)clearTimeout(RTP._rerunTimer);
    RTP._rerunTimer=setTimeout(function(){RTP._rerunTimer=null;try{ct.innerHTML=_runReport(_currentReport);}catch(e){console.error('[RTP._rerun]',e);}},250);
  },

  _print:function(title){
    var ct=_el('rpt-content');if(!ct){window.print();return;}
    var bizState=ERP.getState?ERP.getState().data:{},biz=bizState.biz||{};
    var bizName=biz.name||'MH Autos ERP';
    var bizAddr=biz.address||biz.addr||'';
    var bizPhone=biz.phone||biz.ph||'';
    var bizFax=biz.fax||'';
    var bizEmail=biz.email||'';
    var bizNTN=biz.ntn||biz.taxNo||'';
    var bizWeb=biz.website||biz.web||'';
    var bizLogo=(biz.logo||'').trim();
    var rptLabel=title||_currentReport||'Report';

    var _td=_today();var _nowStr=(ERP.DateUtils&&typeof ERP.DateUtils.now==='function')?ERP.DateUtils.now():_td+'T00:00:00';
    var pad=function(n){return String(n).padStart(2,'0');};
    var rptDate=pad(parseInt(_td.slice(8,10),10))+'-'+pad(parseInt(_td.slice(5,7),10))+'-'+parseInt(_td.slice(0,4),10);
    var _tMatch=_nowStr.match(/T(\d{2}):(\d{2})/);var rptTime=_tMatch?_tMatch[1]+':'+_tMatch[2]:'00:00';

    ct.querySelectorAll('canvas').forEach(function(canvas){
      try{
        var img=document.createElement('img');
        img.src=canvas.toDataURL('image/png');
        img.style.cssText='max-width:100%;height:auto;display:block;margin:8px auto;border-radius:4px;';
        img.setAttribute('data-was-canvas','1');
        canvas.parentNode.insertBefore(img,canvas);
        canvas.style.display='none';
        canvas.setAttribute('data-print-hidden','1');
      }catch(e){ }
    });

    var rptCSS='';var rptCssEl=document.getElementById('rpt-css');if(rptCssEl)rptCSS=rptCssEl.textContent||rptCssEl.innerText||'';
    var clone=ct.cloneNode(true);

    ct.querySelectorAll('canvas[data-print-hidden]').forEach(function(c){
      c.style.display='';c.removeAttribute('data-print-hidden');
    });
    ct.querySelectorAll('img[data-was-canvas]').forEach(function(i){i.parentNode.removeChild(i);});

    clone.querySelectorAll('.rpt-actions,.rpt-header,.rpt-print-btn,button,.btn,.rpt-nav-item,.rpt-filter-strip').forEach(function(el){el.remove();});
    clone.querySelectorAll('.p8-overlay').forEach(function(el){
      el.style.cssText='background:#f1f5f9;color:#0f172a;border:1px solid #cbd5e1;border-radius:6px;padding:10px 14px;margin-bottom:10px;';
      el.querySelectorAll('.p8-kpi').forEach(function(k){k.style.cssText='background:#fff;border:1px solid #e2e8f0;border-radius:4px;padding:6px 10px;';});
      el.querySelectorAll('.p8-kpi-label').forEach(function(k){k.style.color='#64748b';});
      el.querySelectorAll('.p8-kpi-value').forEach(function(k){k.style.color='#0f172a';});
      el.querySelectorAll('.p8-overlay-badge').forEach(function(k){k.style.cssText='background:#4338CA;color:#fff;font-size:9px;font-weight:900;padding:2px 8px;border-radius:9999px;';});
      el.querySelectorAll('.p8-overlay-title').forEach(function(k){k.style.color='#4338CA';});
    });

    var contactParts=[];
    if(bizPhone)contactParts.push('📞 '+bizPhone);
    if(bizFax)contactParts.push('Fax: '+bizFax);
    if(bizEmail)contactParts.push('✉ '+bizEmail);
    if(bizNTN)contactParts.push('NTN: '+bizNTN);
    if(bizWeb)contactParts.push('🌐 '+bizWeb);
    var contactHTML=contactParts.join('&nbsp;&nbsp;|&nbsp;&nbsp;');

    var pw=window.open('','_blank','width=1024,height=800,scrollbars=yes');
    if(!pw){window.print();return;}
    pw.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>'+bizName+' \u2014 '+rptLabel+'</title><style>'
      +'@page{size:A4 portrait;margin:12mm 14mm 16mm 14mm}'
      +'@page{counter-increment:page}'
      +'*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}'
      +'body{font-family:"Segoe UI","Inter",Arial,sans-serif;font-size:10pt;color:#0f172a;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
      +'.ph-wrap{display:flex;justify-content:space-between;align-items:flex-start;padding:0 0 10px;gap:16px}'
      +'.ph-left{flex:1;min-width:0;display:flex;gap:12px;align-items:center}'
      +'.ph-logo{width:44px;height:44px;border-radius:11px;flex-shrink:0;object-fit:contain;background:linear-gradient(135deg,#4338CA,#38bdf8)}'
      +'.ph-logo-fallback{width:44px;height:44px;border-radius:11px;flex-shrink:0;background:linear-gradient(135deg,#4338CA,#38bdf8);display:flex;align-items:center;justify-content:center;color:#fff;font-size:19px;font-weight:900}'
      +'.ph-company{font-size:22pt;font-weight:900;color:#0f172a;letter-spacing:-1.3px;line-height:1;font-family:Segoe UI,Inter,system-ui,Arial,sans-serif}'
      +'.ph-company-sub{font-size:8.5pt;color:#64748b;margin-top:4px;font-weight:500;line-height:1.6}'
      +'.ph-contact{font-size:8pt;color:#94a3b8;margin-top:2px;line-height:1.8}'
      +'.ph-right{text-align:right;flex-shrink:0;min-width:180px}'
      +'.ph-rpt-title{font-size:15pt;font-weight:800;color:#fff;letter-spacing:-.3px;line-height:1;background:linear-gradient(135deg,#0f172a,#1e293b);padding:8px 16px;border-radius:8px;display:inline-block}'
      +'.ph-rpt-meta{font-size:8pt;color:#94a3b8;margin-top:8px;line-height:1.8;text-align:right;font-weight:600}'
      +'.ph-sign{margin-top:28px;display:flex;justify-content:space-between;padding:0 10px;page-break-inside:avoid}'
      +'.ph-sign-line{width:150px;border-top:1px solid #cbd5e1;padding-top:5px;font-size:7.5pt;color:#94a3b8;text-align:center;font-weight:600}'
      +'.ph-divider{border:none;height:3px;background:linear-gradient(90deg,#0f172a 0%,#4338CA 50%,#38bdf8 100%);margin:8px 0 12px;border-radius:2px}'
      +'.ph-divider-thin{border:none;border-top:1px solid #e2e8f0;margin:4px 0 8px}'
      +'.rpt-kpi-row{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap}'
      +'.rpt-kpi{background:#f8fafc;border:1px solid #e2e8f0;border-top:3px solid #4338CA;border-radius:4px;padding:8px 12px;flex:1;min-width:110px;break-inside:avoid}'
      +'.rpt-kpi-label{font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:3px}'
      +'.rpt-kpi-value{font-size:13pt;font-weight:800;color:#0f172a;font-family:Segoe UI,Inter,system-ui,Arial,sans-serif}'
      +'.rpt-kpi-sub{font-size:7pt;color:#94a3b8;margin-top:2px}'
      +'.rpt-section{margin-bottom:10px;page-break-inside:avoid;border:1px solid #e2e8f0;border-radius:4px;overflow:hidden}'
      +'.rpt-section-head{background:#f1f5f9;padding:6px 10px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center}'
      +'.rpt-section-title{font-size:8pt;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#374151}'
      +'.rpt-section-meta{font-size:7.5pt;color:#94a3b8}'
      +'.rpt-section-body{padding:0;overflow:visible}'
      +'.rpt-table{width:100%;border-collapse:collapse;font-size:8.5pt}'
      +'.rpt-table thead{display:table-header-group}'
      +'.rpt-table th{padding:6px 8px;font-size:7.5pt;font-weight:700;color:#374151;border:1px solid #cbd5e1;background:#f1f5f9;text-align:left;white-space:nowrap;text-transform:uppercase;letter-spacing:.4px}'
      +'.rpt-table th.r{text-align:right}'
      +'.rpt-table td{padding:5px 8px;border:1px solid #e2e8f0;vertical-align:middle;color:#0f172a}'
      +'.rpt-table td.r{text-align:right;font-variant-numeric:tabular-nums;font-family:"Courier New",Courier,monospace}'
      +'.rpt-table td.fw{font-weight:700}'
      +'.rpt-table td.mono{font-family:"Courier New",Courier,monospace;font-size:8pt;color:#475569}'
      +'.rpt-table tbody tr:nth-child(even) td{background:#fafafa}'
      +'.rpt-table tfoot tr td{background:#f1f5f9;font-weight:800;font-size:9pt;border-top:2px solid #4338CA;padding:5px 8px;color:#0f172a}'
      +'.rpt-table tfoot tr td.r{text-align:right;font-family:"Courier New",Courier,monospace}'
      +'.rpt-pl-sheet{max-width:100%}'
      +'.rpt-pl-row{display:flex;justify-content:space-between;padding:6px 4px;border-bottom:1px solid #f1f5f9;font-size:9.5pt}'
      +'.rpt-pl-row.fw{font-weight:700;font-size:10.5pt;border-top:2px solid #e2e8f0;padding-top:8px}'
      +'.rpt-pill{display:inline-flex;padding:2px 7px;border-radius:9999px;font-size:7.5pt;font-weight:700}'
      +'.rpt-pill-green{background:#dcfce7;color:#15803d}.rpt-pill-red{background:#fee2e2;color:#b91c1c}'
      +'.rpt-pill-orange{background:#fef3c7;color:#b45309}.rpt-pill-blue{background:#dbeafe;color:#1d4ed8}'
      +'.rpt-pill-purple{background:#ede9fe;color:#6d28d9}.rpt-pill-teal{background:#ccfbf1;color:#0f766e}.rpt-pill-gray{background:#f1f5f9;color:#64748b}'
      +'.u-red{color:#b91c1c}.u-green{color:#15803d}.u-orange{color:#b45309}.fw{font-weight:700}'
      +'.p8-overlay{background:#f1f5f9!important;color:#0f172a!important;border:1px solid #cbd5e1;border-radius:4px;padding:10px 14px;margin-bottom:10px;page-break-inside:avoid}'
      +'.p8-kpi{background:#fff!important;border:1px solid #e2e8f0;border-radius:3px;padding:7px 10px}'
      +'.p8-kpi-label{color:#64748b!important;font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px}'
      +'.p8-kpi-value{color:#0f172a!important;font-size:12pt;font-weight:800}'
      +'.p8-overlay-title{color:#4338CA!important;font-size:9pt;font-weight:800;text-transform:uppercase;letter-spacing:.5px}'
      +'.p8-overlay-badge{background:#4338CA!important;color:#fff!important;font-size:8pt;font-weight:700;padding:2px 8px;border-radius:9999px}'
      +'.p8-green{color:#15803d!important}.p8-red{color:#b91c1c!important}.p8-muted{color:#64748b!important}.p8-fw{font-weight:900!important}'
      +'.p8-kpi-row{display:flex;flex-wrap:wrap;gap:8px}'
      +'.p8-overlay-head{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}'
      +'.p8-overlay-source{font-size:7.5pt;color:#94a3b8;margin-top:6px;padding-top:4px;border-top:1px solid #e2e8f0}'
      +'img[data-was-canvas]{max-width:100%;height:auto;display:block;margin:8px auto;page-break-inside:avoid}'
      +'.btn-whatsapp,.rpt-header,.rpt-actions,.rpt-filter-strip,.rpt-print-btn,.rpt-nav-item,.rpt-sidebar,.rpt-cat-label,button,.btn{display:none!important}'
      +'.ph-footer{position:fixed;bottom:6mm;left:14mm;right:14mm;display:flex;justify-content:space-between;font-size:7.5pt;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:3px}'
      +'</style></head><body>'
      +'<div style="height:4px;background:linear-gradient(90deg,#0f172a 0%,#4338CA 50%,#38bdf8 100%);"></div>'
      +'<div class="ph-wrap" style="padding-top:10px">'
      +'<div class="ph-left">'
      +(bizLogo?'<img class="ph-logo" src="'+bizLogo.replace(/"/g,'&quot;')+'">':'<div class="ph-logo-fallback">'+_esc((bizName||'B').trim().charAt(0).toUpperCase())+'</div>')
      +'<div>'
      +'<div class="ph-company">'+bizName+'</div>'
      +(bizAddr?'<div class="ph-company-sub">📍 '+bizAddr+'</div>':'')
      +(contactHTML?'<div class="ph-contact">'+contactHTML+'</div>':'')
      +'</div>'
      +'</div>'
      +'<div class="ph-right">'
      +'<div class="ph-rpt-title">'+rptLabel+'</div>'
      +'<div class="ph-rpt-meta">'
      +'Printed: '+rptDate+' &bull; '+rptTime
      +'</div>'
      +'</div>'
      +'</div>'
      +'<hr class="ph-divider">'
      +'<div id="rpt-print-body">'+clone.innerHTML+'</div>'
      +'<div class="ph-sign"><div class="ph-sign-line">Prepared By</div><div class="ph-sign-line">Authorized Signature</div></div>'
      +'<div class="ph-footer"><span>'+bizName+' &mdash; Powered by MH Autos ERP</span><span>Printed: '+rptDate+' '+rptTime+'</span></div>'
      +'<script>window.onload=function(){'
      +'  document.querySelectorAll(".rpt-actions,.rpt-header,button,.btn,.rpt-print-btn,.rpt-filter-strip,.rpt-nav-item").forEach(function(el){el.style.display="none";});'
      +'  setTimeout(function(){window.print();},500);'
      +'  window.onafterprint=function(){window.close();};'
      +'};<\/script>'
      +'</body></html>');
    pw.document.close();
  },

  _render:function(opts){if(opts&&opts.id)RTP.show(opts.id);}
};

ERP.reports={
  render:function(){_renderPanel();},
  getSummary:function(){var state=ERP.getState?ERP.getState():{data:{}};var sales=_st(state,'sales').filter(function(s){return !s.deleted;});return{totalSales:sales.length,totalRevenue:sales.reduce(function(s,x){return s+_CALC.saleTotal(x);},0),totalOutstanding:sales.reduce(function(s,x){return s+_CALC.saleOutstanding(x,state);},0),lowStockCount:_st(state,'inventory').filter(function(i){return !i._archived&&i.st<=(i.minSt||5);}).length,reportsAvailable:REPORTS.length};},
  show:function(id){RTP.show(id);},
  list:function(){return REPORTS.map(function(r){return{id:r.id,label:r.label,cat:r.cat};});}
};

if(ERP.registerRenderer&&typeof ERP.registerRenderer==='function')ERP.registerRenderer('reports',function(){_renderPanel();});
if(ERP.actions&&ERP.actions.reports)ERP.actions.reports.render=function(){_renderPanel();};

global.showPurchaseReport=function(){RTP.show('purchase_ledger');};
global.showPurchaseLedgerReport=function(){RTP.show('purchase_ledger');};
global.showSupplierReport=function(){RTP.show('suppliers');};

global.RTP=RTP;
global.ReportQuery=ReportQuery;
ERP.ReportQuery=ReportQuery;
global.ReportRenderer=ReportRenderer;

if(global.DEBUG_MODE)console.log('[reports.js] Loaded — '+REPORTS.length+' reports registered');

})(window.ERP=window.ERP||{},window);
