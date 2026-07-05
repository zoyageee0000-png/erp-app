'use strict';

(function (ERP) {

  function Svc()     { return ERP._salesSvc; }
  function UI()      { return ERP._salesUI; }
  function Tmpl()    { return ERP._salesTemplates; }
  function Storage() { return ERP._salesStorage; }
  function State()   { return ERP._salesState; }

  function _today() { return ERP.DateUtils.today(); }
  function _now()   { return ERP.DateUtils.now(); }

  function _mkTx(documentId, sourceModule) {
    // FIX (root cause, audit #61-66): this txId is passed straight through as
    // payload.txId into PostingEngine.post() (posting_engine.js uses it
    // verbatim instead of generating its own), so it ends up on the actual
    // ledger record -- same severity class as posting_engine.js's own id
    // generation. core.js (ERP.uid) is the first of 92 scripts loaded, before
    // this file, so a missing ERP.uid means the app already failed to boot;
    // fail closed rather than silently falling back to a different scheme.
    if (!ERP.uid || typeof ERP.uid !== 'function') {
      throw new Error('[SalesController] ERP.uid unavailable -- refusing to generate a transaction id from a fallback scheme.');
    }
    return {
      txId:         ERP.uid(),
      actor:        (ERP.user && ERP.user.name) || 'system',
      startedAt:    _now(),
      sourceModule: sourceModule || 'sales',
      documentId:   documentId || null
    };
  }

  function _toast(m,t,d) { if(d===undefined||d===null) d=3500; try{ if(window.ToastManager){ window.ToastManager.show(t,'',m,d); return; } ERP._salesToast(m,t,d); }catch(e){ if(window.DEBUG_MODE) console.warn('[toast]',m); } }
  function _toast2(type,title,msg,dur){ try{ if(window.ToastManager){ window.ToastManager.show(type,title,msg,dur); return; } _toast(msg||title,type,dur); }catch(e){ if(window.DEBUG_MODE) console.error(e); } }
  function _oModal(id) { ERP._salesOModal(id); }
  function _cModal(id) { ERP._salesCModal(id); }
  function _esc(s)     { return Tmpl().esc(s); }
  function _fmt(n)     { return Tmpl().fmt(n); }

  var _currentTheme = 'modern';
  var _currentDocType = 'invoice';
  var _suppressCreditReminder = false;
  var _currentColor = '#4338CA';

  (function _restorePrefs(){
    try{
      var tr=Storage().getTheme(); var cr=Storage().getColor();
      if(tr && typeof tr.then==='function') tr.then(function(v){ if(v) _currentTheme=v; }).catch(function(){});
      else if(tr) _currentTheme=tr;
      if(cr && typeof cr.then==='function') cr.then(function(v){ if(v) _currentColor=v; }).catch(function(){});
      else if(cr) _currentColor=cr;
    }catch(e){ if(window.DEBUG_MODE) console.error(e); }
  }());

  var _currentId  = null;
  var _currentInv = null;

  function _setPreviewContext(inv) { _currentInv = inv; }
  function _clearPreviewContext()  { _currentInv = null; }

  function _getActiveInv(){
    if(_currentId){
      var f = Svc().sales.getAll().find(function(x){ return x.id===_currentId && !x.deleted; });
      if(f) return f;
    }
    if(_currentInv) return _currentInv;
    return null;
  }

  function _setTheme(t){
    _currentTheme=t; Storage().saveTheme(t);
    ['classic','modern','minimal','corporate','elegant','neon','retro','pastel','pro'].forEach(function(n){
      var b=document.getElementById('inv-tpl-'+n); if(!b) return;
      b.classList.toggle('active',n===t);
      b.style.color      =(n===t)?'#fff':'#94a3b8';
      b.style.background =(n===t)?'rgba(255,255,255,0.12)':'none';
      b.style.borderRadius=(n===t)?'6px':'0';
    });
    _refreshPreview();
  }
  function _setColor(c){ _currentColor=c; Storage().saveColor(c); _refreshPreview(); }

  function _refreshPreview(){
    var el=document.getElementById('inv-full-preview'); if(!el) return;
    var inv=_getActiveInv(); var biz=State().getBiz();
    if(!inv){ el.innerHTML='<p style="padding:40px;color:var(--muted);text-align:center;font-size:14px">No invoice loaded</p>'; return; }
    if(_currentDocType==='estimate')   el.innerHTML=Tmpl().buildEstimateHTML(inv,_currentTheme,_currentColor,biz);
    else if(_currentDocType==='so')    el.innerHTML=Tmpl().buildSOHTML(inv,_currentTheme,_currentColor,biz);
    else                               el.innerHTML=Tmpl().buildInvoiceHTML(inv,_currentTheme,_currentColor,biz);
    var t=document.getElementById('inv-modal-title');
    if(t && _currentDocType==='invoice') t.textContent='Invoice: '+(inv.id||'Preview');
  }

  function _openPreview(id){
    var _rid=id||_currentId;
    ERP.sales._currentId=_rid; ERP._salesBuildPrintModal();
    _currentId=_rid; _currentDocType='invoice';
    var inState=Svc().sales.getAll().find(function(s){ return s.id===_rid && !s.deleted; });
    if(!inState && _rid){
      var _wInv=Array.isArray(window.sales)?window.sales.find(function(s){ return s.id===_rid; }):null;
      if(_wInv) _setPreviewContext(_wInv);
    }
    _refreshPreview();
    if(!_getActiveInv() && _rid) setTimeout(function(){ if(_currentId===_rid) _refreshPreview(); },350);
    _oModal('invPrintModal');
    var lbl=document.getElementById('inv-autosave-lbl');
    if(lbl){ var _now=new Date(); lbl.textContent='Auto-saved '+_now.getHours().toString().padStart(2,'0')+':'+_now.getMinutes().toString().padStart(2,'0')+' '+(_now.getHours()>=12?'pm':'am'); }
  }

  function _printNow(){
    var biz=State().getBiz(); var mode=biz.defaultPrintMode||'auto'; var type=biz.printerType||'thermal';
    if(mode==='thermal'||(mode==='auto'&&type==='thermal')){ _printThermal(); return; }
    var el=document.getElementById('inv-full-preview'); var html=(el&&el.innerHTML.trim())||'';
    if(!html){ var inv=_getActiveInv(); if(inv){ var tmpl=biz.invoiceTemplate||_currentTheme; if(_currentDocType==='estimate') html=Tmpl().buildEstimateHTML(inv,tmpl,_currentColor,biz); else if(_currentDocType==='so') html=Tmpl().buildSOHTML(inv,tmpl,_currentColor,biz); else html=Tmpl().buildInvoiceHTML(inv,tmpl,_currentColor,biz); } }
    if(!html){ _toast('No invoice to print','error'); return; }
    var marginMap={normal:'15mm',narrow:'8mm',none:'0mm'}; var margin=marginMap[biz.paperMargin]||'15mm';
    var orientation=(biz.paperOrientation==='landscape')?'landscape':'portrait'; var copies=parseInt(biz.printCopies)||1;
    var printCSS='@page{size:'+(biz.printerType==='a5'?'A5':'A4')+' '+orientation+';margin:'+margin+'}*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,"Segoe UI",Arial,sans-serif;background:#fff}.no-print{text-align:center;padding:14px;background:#f1f5f9;display:flex;gap:8px;justify-content:center;flex-wrap:wrap}.no-print button{background:#4338CA;color:#fff;border:none;padding:8px 18px;border-radius:7px;font-size:13px;cursor:pointer;font-weight:600}@media print{.no-print{display:none!important}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}';
    var bodyHtml=''; for(var c=0;c<copies;c++){ bodyHtml+=html; if(c<copies-1) bodyHtml+='<div style="page-break-after:always"></div>'; }
    var pw=window.open('','_blank','width=960,height=720'); if(!pw){ _toast('Pop-ups blocked','error',5000); return; }
    var cl=copies>1?' ('+copies+' copies)':'';
    pw.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoice'+cl+'</title><style>'+printCSS+'</style></head><body><div class="no-print"><button onclick="window.print()">&#128424; Print'+cl+'</button><button onclick="window.close()" style="background:#64748b">&#10005; Close</button></div>'+bodyHtml+'</body></html>');
    pw.document.close(); setTimeout(function(){ try{ pw.print(); }catch(e){ if(window.DEBUG_MODE) console.error(e); } },700);
  }

  function _printThermal(){
    var inv=_getActiveInv(); if(!inv){ _toast('No invoice loaded','error'); return; }
    var biz=State().getBiz(); var copies=parseInt(biz.printCopies)||1; var w=biz.thermalWidth||576;
    var bodyHtml=''; for(var c=0;c<copies;c++){ bodyHtml+=Tmpl().buildThermalHTML(inv,biz); if(c<copies-1) bodyHtml+='<div style="page-break-after:always;margin-bottom:8px"></div>'; }
    var pw=window.open('','_blank','width='+Math.min(w+80,600)+',height=650'); if(!pw){ _toast('Pop-ups blocked','error'); return; }
    var cl=copies>1?' ('+copies+' copies)':'';
    pw.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Thermal'+cl+'</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#fff}@page{size:'+w+'px auto;margin:4mm}@media print{.no-print{display:none!important}*{-webkit-print-color-adjust:exact!important}}</style></head><body><div class="no-print" style="text-align:center;padding:10px;display:flex;gap:8px;justify-content:center"><button onclick="window.print()" style="background:#4338CA;color:#fff;border:none;padding:7px 16px;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer">&#128424; Print'+cl+'</button><button onclick="window.close()" style="background:#64748b;color:#fff;border:none;padding:7px 12px;border-radius:7px;font-size:12px;cursor:pointer">&#10005; Close</button></div>'+bodyHtml+'</body></html>');
    pw.document.close(); setTimeout(function(){ try{ pw.print(); }catch(e){ if(window.DEBUG_MODE) console.error(e); } },600);
  }

  function _downloadPDF(){
    var inv=_getActiveInv(); if(!inv){ _toast('No invoice loaded','error'); return; }
    var biz=State().getBiz(); var html=Tmpl().buildInvoiceHTML(inv,_currentTheme,_currentColor,biz);
    var pw=window.open('','_blank','width=900,height=750'); if(!pw){ _toast('Pop-ups blocked','error',5000); return; }
    pw.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoice '+_esc(inv.id||'')+'</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,"Segoe UI",Arial,sans-serif;background:#fff}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}</style></head><body>'+html+'</body></html>');
    pw.document.close(); setTimeout(function(){ try{ pw.print(); }catch(e){ if(window.DEBUG_MODE) console.error(e); } },700);
    _toast('PDF ready \u2014 click Save as PDF','info',4000);
  }

  function _downloadImage(){
    var inv=_getActiveInv(); if(!inv){ _toast('No invoice loaded','error'); return; }
    var html=Tmpl().buildInvoiceHTML(inv,_currentTheme,_currentColor,State().getBiz());
    var fname='Invoice-'+_esc(inv.id||'invoice')+'.png';
    _toast('Preparing image...','info',8000);
    var script=document.createElement('script');
    script.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    script.onerror=function(){ _toast('Image export: CDN blocked. Try print to PDF.','warning',5000); };
    script.onload=function(){
      var host=document.createElement('div'); host.style.cssText='position:fixed;left:-9999px;top:0;width:860px;background:#fff;z-index:-1'; host.innerHTML=html; document.body.appendChild(host);
      html2canvas(host,{scale:2,useCORS:true,allowTaint:true,backgroundColor:'#ffffff',logging:false}).then(function(canvas){
        document.body.removeChild(host);
        canvas.toBlob(function(blob){ if(!blob){ _toast('\u274c Image export failed','error'); return; } var url=URL.createObjectURL(blob); var a=document.createElement('a'); a.href=url; a.download=fname; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function(){ URL.revokeObjectURL(url); },3000); _toast('\u2705 Image downloaded: '+fname,'success',3000); },'image/png');
      }).catch(function(){ document.body.removeChild(host); _toast('\u274c Image export failed','error'); });
    };
    document.head.appendChild(script);
  }

  function _waShare(){ var inv=_getActiveInv(); if(!inv){ _toast('No invoice to share','error'); return; } window.open('https://wa.me/?text='+encodeURIComponent(Svc().waText(inv)),'_blank'); }
  function _gmailShare(){ var inv=_getActiveInv(); if(!inv){ _toast('No invoice to share','error'); return; } var biz=State().getBiz(); var f=Svc()._totals(inv.items||[]); var bal=Math.max(0,f.grand-(inv.paid||0)); window.open('mailto:?subject='+encodeURIComponent('Invoice '+inv.id+' from '+biz.name)+'&body='+encodeURIComponent('Dear '+inv.customer+',\n\nInvoice '+inv.id+' for '+_fmt(f.grand)+'.\nBalance: '+_fmt(bal)+'\n\nRegards,\n'+biz.name),'_blank'); }
  function _smsShare(){ var inv=_getActiveInv(); if(!inv){ _toast('No invoice to share','error'); return; } var f=Svc()._totals(inv.items||[]); var bal=Math.max(0,f.grand-(inv.paid||0)); var biz=State().getBiz(); window.open('sms:?body='+encodeURIComponent(biz.name+' Invoice '+inv.id+' | Total: '+_fmt(f.grand)+(bal>0?' | Balance: '+_fmt(bal):'')),'_blank'); }
  function _waFromList(id)    { _currentId=id; _clearPreviewContext(); _waShare(); }
  function _printFromList(id) { _currentId=id; _clearPreviewContext(); _currentDocType='invoice'; ERP._salesBuildPrintModal(); _refreshPreview(); _printNow(); }

  function _vymRow(n){
    var bg=n%2===0?'#f8fafc':'#fff';
    var tdS='padding:0;height:38px;vertical-align:middle';
    var inpS='border:none;outline:none;width:100%;padding:6px 8px;background:transparent;font-size:12px;font-family:inherit';
    var numS='border:none;outline:none;width:100%;padding:6px 8px;background:transparent;font-size:12px;font-family:monospace;text-align:right';
    var dSpan='<span style="font-size:11px;color:var(--muted);font-family:monospace">0</span>';
    var txSpan='<span style="font-size:11px;color:var(--info);font-family:monospace">0</span>';
    var totSpan='<span style="font-size:12px;font-weight:700;color:var(--text);font-family:monospace">0</span>';
    var del='<button onclick="ERP.sales._delRow(this)" style="width:28px;height:28px;border:none;background:var(--danger-m);border-radius:6px;color:var(--danger);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;margin:0 4px" title="Remove">\u2715</button>';
    var units=['NONE','Pcs','Nos','Set','Pair','Kg','Ltr','Mtr','Box','Dozen','Roll'].map(function(u){ return '<option>'+u+'</option>'; }).join('');
    var unitSel='<select name="unit" style="border:none;outline:none;background:transparent;font-size:11px;font-family:inherit;width:100%;padding:4px 2px;cursor:pointer">'+units+'</select>';
    var _defTax = 0;
    try { _defTax = (ERP.getState && ERP.getState().settings && ERP.getState().settings.taxRate != null)
                   ? Number(ERP.getState().settings.taxRate) : 0; } catch(_){ if(window.DEBUG_MODE) console.error(_); }
    var taxSel='<div style="display:flex;gap:2px;align-items:center"><input type="number" name="disc" style="'+numS+';width:45px" placeholder="'+(_defTax||0)+'" value="" min="0" max="100" oninput="ERP.sales._calc()"><select name="tax-type" style="border:none;outline:none;background:transparent;font-size:10px;font-family:inherit;padding:2px;cursor:pointer"><option>Preset</option><option>%</option><option>GST</option><option>VAT</option><option>IGST</option></select></div>';
    return '<tr>'
      +'<td style="'+tdS+';background:'+bg+';text-align:center;color:var(--gray-l);font-size:11px;width:30px">'+n+'</td>'
      +'<td style="'+tdS+';background:'+bg+';min-width:160px"><input type="text" name="item-'+n+'" style="'+inpS+'" list="sale-inv-datalist" autocomplete="off" placeholder="Item / service\u2026" onchange="ERP.sales._fillPrice(this)" oninput="ERP.sales._calc()"></td>'
      +'<td style="'+tdS+';background:'+bg+';width:80px"><input type="text" name="colour" style="'+inpS+'" placeholder="Colour"></td>'
      +'<td style="'+tdS+';background:'+bg+';width:60px"><input type="number" name="qty" style="'+numS+'" placeholder="0" min="0" oninput="ERP.sales._calc()"></td>'
      +'<td style="'+tdS+';background:'+bg+';width:80px">'+unitSel+'</td>'
      +'<td style="'+tdS+';background:'+bg+';width:100px"><input type="number" name="price" style="'+numS+'" placeholder="0" min="0" step="0.01" oninput="ERP.sales._calc()"></td>'
      +'<td style="'+tdS+';background:'+bg+';width:60px"><input type="number" name="row-disc" style="'+numS+'" placeholder="0" min="0" max="100" step="0.01" oninput="ERP.sales._calc()"></td>'
      +'<td style="'+tdS+';background:'+bg+';width:80px;text-align:right;padding-right:8px">'+dSpan+'</td>'
      +'<td style="'+tdS+';background:'+bg+';min-width:110px">'+taxSel+'</td>'
      +'<td style="'+tdS+';background:'+bg+';width:80px;text-align:right;padding-right:8px">'+txSpan+'</td>'
      +'<td style="'+tdS+';background:'+bg+';width:90px;text-align:right;padding-right:8px">'+totSpan+'</td>'
      +'<td style="padding:0;height:38px;vertical-align:middle;background:'+bg+';width:36px">'+del+'</td>'
      +'</tr>';
  }

  var _calcTimer=null;
  function _calc(){ if(_calcTimer) clearTimeout(_calcTimer); _calcTimer=setTimeout(_doCalc,60); }
  function _doCalc(){
    _calcTimer=null;
    try{
      var tQ=0,tSub=0,tDisc=0,tTax=0,tAmt=0;
      document.querySelectorAll('#vym-items tr').forEach(function(row){
        var tds=row.querySelectorAll('td');
        var qI=tds[3]&&tds[3].querySelector('input'); var pI=tds[5]&&tds[5].querySelector('input');
        var dPctI=tds[6]&&tds[6].querySelector('input'); var txI=tds[8]&&tds[8].querySelector('input[type=number]');
        var dSpan=tds[7]&&tds[7].querySelector('span'); var txSpan=tds[9]&&tds[9].querySelector('span'); var amtSpan=tds[10]&&tds[10].querySelector('span');
        var q=Math.max(0,parseFloat(qI&&qI.value)||0); var p=Math.max(0,parseFloat(pI&&pI.value)||0);
        var dPct=Math.max(0,Math.min(100,parseFloat(dPctI&&dPctI.value)||0)); var tPct=Math.max(0,Math.min(100,parseFloat(txI&&txI.value)||0));
        var baseP=Math.round(q*p*100); var dAmtP=Math.round(baseP*dPct/100); var afterP=baseP-dAmtP; var tAmt2P=Math.round(afterP*tPct/100); var lineP=afterP+tAmt2P;
        if(dSpan) dSpan.textContent=dAmtP?(dAmtP/100).toFixed(2):'0';
        if(txSpan) txSpan.textContent=tAmt2P?(tAmt2P/100).toFixed(2):'0';
        if(amtSpan) amtSpan.textContent=lineP?(lineP/100).toFixed(2):'0';
        tQ+=q; tSub+=baseP; tDisc+=dAmtP; tTax+=tAmt2P; tAmt+=lineP;
      });
      var _se=function(id,v){ var e=document.getElementById(id); if(e) e.textContent=v; };
      _se('vym-ftotal',(tSub/100).toFixed(2)); _se('vym-fdisc',(tDisc/100).toFixed(2)); _se('vym-fdisc-amt',(tDisc/100).toFixed(2));
      _se('vym-ftax',(tTax/100).toFixed(2)); _se('vym-famt',(tAmt/100).toFixed(2));
      _se('vym-bar-qty',tQ||'0'); _se('vym-bar-price',(tSub/100).toFixed(2)); _se('vym-bar-disc',(tDisc/100).toFixed(2)); _se('vym-bar-amt',(tAmt/100).toFixed(2));
      _se('vym-sub',(tAmt/100).toFixed(2));
      var roC=document.getElementById('vym-ro-chk'); var roV=document.getElementById('vym-ro-val');
      if(roC&&roC.checked){ var rounded=Math.round(tAmt/100); var diffP=Math.round(rounded*100)-tAmt; if(roV) roV.textContent=(diffP/100).toFixed(2); tAmt=rounded*100; }
      else { if(roV) roV.textContent='0.00'; }
      _se('vym-grand',(tAmt/100).toFixed(2));
      var ptEl=document.getElementById('vym-pay-type'); var rcEl=document.getElementById('vym-rec-chk'); var rvEl=document.getElementById('vym-rec-val');
      if(ptEl&&ptEl.value!=='Credit'&&rcEl&&rvEl){ rcEl.checked=true; if(!_editId&&(!rvEl.dataset.manuallySet||parseFloat(rvEl.value)===0)) rvEl.value=(tAmt/100).toFixed(2); }
      _updateBal(tAmt/100);
    }catch(e){ if(window.DEBUG_MODE) console.warn('[_doCalc]',e); }
  }
  function _updateBal(grand){
    if(grand===undefined) grand=parseFloat((document.getElementById('vym-grand')||{}).textContent)||0;
    var rv=parseFloat((document.getElementById('vym-rec-val')||{}).value)||0;
    var bal=Math.max(0,Math.round((grand-rv)*100)/100);
    var bs=document.getElementById('vym-bal'); if(bs){ bs.textContent=bal.toFixed(2); bs.style.color=bal>0?'#ef4444':'#22c55e'; }
  }
  function _toggleRec(chk){ var rv=document.getElementById('vym-rec-val'); if(!rv) return; if(chk.checked){ var g=parseFloat((document.getElementById('vym-grand')||{}).textContent)||0; rv.value=g.toFixed(2); rv.focus(); } else rv.value=''; _updateBal(); }
  function _setCredit(){
    var th=document.getElementById('vym-thumb'),tog=document.getElementById('vym-toggle'),cb=document.getElementById('vym-credit-btn'),hb=document.getElementById('vym-cash-btn');
    if(th) th.style.left='3px'; if(tog){ tog.style.background='#cbd5e1'; tog.setAttribute('aria-checked','false'); }
    if(cb){ cb.style.color='#ef4444'; cb.style.fontWeight='700'; } if(hb){ hb.style.color='#94a3b8'; hb.style.fontWeight='600'; }
    var pt=document.getElementById('vym-pay-type'); if(pt) pt.value='Credit';
    if(!_suppressCreditReminder) setTimeout(function(){ var cv=document.getElementById('vym-cust'); var sv=document.getElementById('vym-cust-sel'); var val=(cv&&cv.value||'').trim()||(sv&&sv.value&&sv.value!=='__add__'?sv.value:''); if(!val){ var ex=document.getElementById('cust-remind'); if(!ex){ var modal=document.createElement('div'); modal.id='cust-remind'; modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:var(--zi-critical);display:flex;align-items:center;justify-content:center'; modal.innerHTML='<div style="background:var(--white);border-radius:16px;padding:28px 32px;max-width:360px;width:90vw;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.2)"><h3 style="margin:0 0 8px;font-size:17px;font-weight:700;color:var(--text)">Customer Required</h3><p style="margin:0 0 20px;font-size:13px;color:var(--muted)">A customer name is required for credit sales.</p><button onclick="document.getElementById(\'cust-remind\').remove()" style="padding:10px 28px;border:none;border-radius:8px;background:var(--primary);color:#fff;font-size:13px;font-weight:700;cursor:pointer">Got It</button></div>'; document.body.appendChild(modal); modal.addEventListener('click',function(e){ if(e.target===modal) modal.remove(); }); setTimeout(function(){ var m=document.getElementById('cust-remind'); if(m) m.remove(); },5000); } } },150);
  }
  function _setCash(){
    var th=document.getElementById('vym-thumb'),tog=document.getElementById('vym-toggle'),cb=document.getElementById('vym-credit-btn'),hb=document.getElementById('vym-cash-btn');
    if(th) th.style.left='21px'; if(tog){ tog.style.background='#22c55e'; tog.setAttribute('aria-checked','true'); }
    if(cb){ cb.style.color='#94a3b8'; cb.style.fontWeight='600'; } if(hb){ hb.style.color='#16a34a'; hb.style.fontWeight='700'; }
    var pt=document.getElementById('vym-pay-type'); if(pt&&pt.value==='Credit') pt.value='Cash';
    var rc=document.getElementById('vym-rec-chk'); if(rc) rc.checked=true;
    var g=parseFloat((document.getElementById('vym-grand')||{}).textContent)||0;
    var rv=document.getElementById('vym-rec-val'); if(g>0&&rv&&!rv.value) rv.value=g.toFixed(2); _updateBal(g);
  }
  function _togglePay(){ var pt=document.getElementById('vym-pay-type'); if(pt&&pt.value==='Credit') _setCash(); else _setCredit(); }
  function _updatePayType(){ var pt=document.getElementById('vym-pay-type'); if(pt&&pt.value==='Credit') _setCredit(); else _setCash(); }
  function _addPayType(){ var sel=document.getElementById('vym-pay-type'); if(!sel) return; var opts=['Cash','Credit','JazzCash','EasyPaisa','Bank Transfer','Cheque']; var menu=document.createElement('div'); menu.style.cssText='position:fixed;background:var(--white);border:1.5px solid var(--border);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:var(--zi-critical);min-width:180px;overflow:hidden'; var rect=sel.getBoundingClientRect(); menu.style.left=rect.left+'px'; menu.style.top=(rect.bottom+4)+'px'; menu.innerHTML=opts.map(function(o){ return '<button onclick="var s=document.getElementById(\'vym-pay-type\');if(s)s.value=\''+o+'\';ERP.sales._updatePayType();this.closest(\'div\').remove()" style="display:block;width:100%;text-align:left;padding:10px 16px;background:none;border:none;font-size:13px;color:var(--text);cursor:pointer">'+o+'</button>'; }).join(''); document.body.appendChild(menu); setTimeout(function(){ document.addEventListener('click',function h(){ menu.remove(); document.removeEventListener('click',h); }); },10); }
  function _toggleDesc(){ var b=document.getElementById('vym-desc-wrap'); if(!b) return; var shown=b.style.display==='block'; b.style.display=shown?'none':'block'; if(!shown){ var ta=b.querySelector('textarea'); if(ta) ta.focus(); } }
  function _addRow(){ var tb=document.getElementById('vym-items'); if(!tb) return; if(tb.querySelectorAll('tr').length>=100){ _toast('Maximum 100 items per invoice','warning'); return; } var n=tb.querySelectorAll('tr').length+1; tb.insertAdjacentHTML('beforeend',_vymRow(n)); var last=tb.lastElementChild; if(last){ var inp=last.querySelector('input[type=text]'); if(inp) setTimeout(function(){ inp.focus(); },20); } _calc(); }
  function _delRow(btn){ var row=btn.closest('tr'); if(!row) return; var tb=document.getElementById('vym-items'); if(tb&&tb.querySelectorAll('tr').length<=1){ _toast('At least one item required','warning'); return; } row.remove(); if(tb) tb.querySelectorAll('tr').forEach(function(r,i){ var c=r.querySelector('td:first-child'); if(c) c.textContent=i+1; }); _calc(); }

  function _fillPrice(inp){
    try{
      var name=(inp.value||'').trim(); if(!name) return;
      var parts=ERP._salesParts?ERP._salesParts():[]; var nameLc=name.toLowerCase();
      var part=parts.find(function(p){ return (p.n||'').toLowerCase()===nameLc||(p.sku||'').toLowerCase()===nameLc; });
      if(!part){ var td1=inp.closest('td'); var ex=td1&&td1.querySelector('.add-inv-tip'); if(!ex&&td1){ var tip=document.createElement('div'); tip.className='add-inv-tip'; tip.style.cssText='font-size:10px;color:var(--primary);cursor:pointer;padding:2px 0;white-space:nowrap;font-weight:600'; tip.textContent='+ Add to Inventory'; tip.onclick=function(){ tip.remove(); if(ERP.inventory&&ERP.inventory.openAdd) ERP.inventory.openAdd(); }; td1.appendChild(tip); setTimeout(function(){ if(tip.parentNode) tip.remove(); },6000); } return; }
      var row=inp.closest('tr'); if(!row) return;
      var tipEl=inp.closest('td')&&inp.closest('td').querySelector('.add-inv-tip'); if(tipEl) tipEl.remove();
      var allInps=document.querySelectorAll('#vym-items input[list="sale-inv-datalist"]'); var dupRow=0;
      allInps.forEach(function(r,ri){ if(r!==inp&&(r.value||'').trim().toLowerCase()===nameLc) dupRow=ri+1; });
      if(dupRow>0){ inp.value=''; _toast('"'+name+'" already in row '+dupRow+' \u2014 update the quantity there.','warning',3500); return; }
      var tds=row.querySelectorAll('td');
      var pi=tds[5]&&tds[5].querySelector('input'); if(pi&&(!pi.value||pi.value==='0')) pi.value=part.sp||part.price||0;
      var qi=tds[3]&&tds[3].querySelector('input'); if(qi&&(!qi.value||parseFloat(qi.value)===0)) qi.value=1;
      row.dataset.bc = part.bc || part.barcode || '';
      var td=inp.closest('td');
      if(td){ var bg=td.querySelector('.s-badge'); if(!bg){ bg=document.createElement('div'); bg.className='s-badge'; bg.style.cssText='font-size:10px;padding:1px 6px;border-radius:8px;margin-top:1px;display:inline-block;font-weight:600'; td.appendChild(bg); } var isService=part.type==='service'||part.isService===true||part.stockable===false||part.trackStock===false; if(isService){ bg.style.display='none'; } else { var stock=part.st||part.stock||0; if(stock<=0){ bg.style.background='var(--danger-m)'; bg.style.color='var(--danger)'; bg.textContent='Out of Stock'; } else if(stock<(part.min||5)){ bg.style.background='var(--warning-m)'; bg.style.color='var(--warning-d)'; bg.textContent='Low: '+stock; } else { bg.style.background='var(--success-m)'; bg.style.color='var(--success-d)'; bg.textContent='Stock: '+stock; } } }
      _calc();
    }catch(e){ if(window.DEBUG_MODE) console.warn('[_fillPrice]',e); }
  }

  function _collectItems(){
    var items=[];
    document.querySelectorAll('#vym-items tr').forEach(function(row){
      var tds=row.querySelectorAll('td');
      var nI=tds[1]&&tds[1].querySelector('input'); var cI=tds[2]&&tds[2].querySelector('input'); var qI=tds[3]&&tds[3].querySelector('input'); var pI=tds[5]&&tds[5].querySelector('input'); var dI=tds[6]&&tds[6].querySelector('input'); var txI=tds[8]&&tds[8].querySelector('input[type=number]'); var txS=tds[8]&&tds[8].querySelector('select'); var uS=tds[4]&&tds[4].querySelector('select');
      var n=(nI&&nI.value||'').trim(); if(!n) return;
      var qty=Math.max(0,parseFloat(qI&&qI.value)||0); if(qty<=0){ qty=1; if(qI) qI.value=1; }
      var price=Math.max(0,parseFloat(pI&&pI.value)||0); var dPct=Math.max(0,Math.min(100,parseFloat(dI&&dI.value)||0)); var tPct=parseFloat((txI&&txI.value)||(txS&&txS.value))||0;
      var baseP, dAmtP, discountedBaseP, tAmtP;
      // Root-cause fix (audit #67/#68): route through ERP.TaxEngine instead of
      // reimplementing this rounding here — previously this file was one of
      // several independent GST-math implementations the audit flagged.
      // Fallback below is intentionally identical math (not a security guard,
      // just resilience against a load-order fluke); it logs loudly so a real
      // load-order break is visible instead of silently reintroducing the
      // duplicate.
      if (ERP.TaxEngine && typeof ERP.TaxEngine.calculateLineItem === 'function') {
        var _calc = ERP.TaxEngine.calculateLineItem({ qty: qty, price: price, discountPct: dPct, taxRate: tPct });
        baseP = _calc.basePaisa; dAmtP = _calc.discountPaisa; discountedBaseP = _calc.netBasePaisa; tAmtP = _calc.taxPaisa;
      } else {
        if (window.DEBUG_MODE) console.warn('[sales_controller._collectItems] ERP.TaxEngine.calculateLineItem unavailable — using local fallback math. This should not happen; check script load order.');
        baseP=Math.round(qty*price*100); dAmtP=Math.round(baseP*dPct/100);
        discountedBaseP = baseP - dAmtP;
        tAmtP = Math.round(discountedBaseP * tPct / 100);
      }
      items.push({ n:n, col:cI&&cI.value||'', q:qty, u:uS&&uS.value||'NONE', p:price, d:dAmtP/100, discPct:dPct, tax:tPct, taxPct:tPct, taxAmt:tAmtP/100, taxableAmount:discountedBaseP/100, hsn:'', barcode:row.dataset.bc||'' });
    });
    return items;
  }

  function _collectFormData(){
    var hid=document.getElementById('vym-cust'); var sel=document.getElementById('vym-cust-sel');
    var cust=(hid&&hid.value||'')||(sel&&sel.value!=='__add__'?sel.value||'':'');
    var payType=(document.getElementById('vym-pay-type')||{}).value||'Cash';
    var recChk=document.getElementById('vym-rec-chk'); var recVal=Math.max(0,parseFloat((document.getElementById('vym-rec-val')||{}).value)||0);
    return { customer:cust, phone:(document.getElementById('vym-ph')||{}).value||'', customId:((document.getElementById('vym-inv-num')||{}).value||'').trim(), date:(document.getElementById('vym-date')||{}).value||_today(), supplyState:(document.getElementById('vym-state')||{}).value||'', notes:(document.getElementById('vym-notes')||{}).value||'', payType:payType, roundOff:!!(document.getElementById('vym-ro-chk')&&document.getElementById('vym-ro-chk').checked), receivedChecked:!!(recChk&&recChk.checked), receivedAmount:recVal, items:_collectItems(), qrCode:_attQR||null, imgAttachment:_attImg||null };
  }

  var _InventorySvc={
    deduct:  function(items,meta){ return Svc().inventory.deduct(items,meta); },
    restore: function(items,meta){ return Svc().inventory.restore(items,meta); }
  };

  var _invSaveInProgress=false;
  var _editId=null;
  var _pendingJobLinkId=null;

  function _saveInv(options){
    var _skipCreditCheck=!!(options&&options.skipCreditCheck);
    if(_invSaveInProgress){ if(window.DEBUG_MODE) console.warn('[_saveInv] reentrancy blocked'); return; }
    _invSaveInProgress=true;
    var saveBtn=document.getElementById('vym-save-btn')||document.querySelector('[data-action="saveInv"]');
    var origText=saveBtn?saveBtn.textContent:'Save';
    if(saveBtn){ saveBtn.setAttribute('data-saving','1'); saveBtn.textContent='Saving\u2026'; saveBtn.disabled=true; }
    function _restoreBtn(){ _invSaveInProgress=false; if(saveBtn){ saveBtn.removeAttribute('data-saving'); saveBtn.textContent=origText; saveBtn.disabled=false; } }

    try {
      var formData=_collectFormData();
      var validRes=Svc().invoice.validate(formData,_editId);
      if(!validRes.success){ _restoreBtn(); _toast2('error','Invoice Validation Failed',validRes.error,8000); return; }
      var buildRes=Svc().invoice.buildSale(formData,_editId);
      if(!buildRes.success){ _restoreBtn(); _toast('\u26a0\ufe0f '+buildRes.error,'error'); return; }
      var sale=buildRes.data.sale; var grand=buildRes.data.grand; var initialPayment=buildRes.data.initialPayment;

      if(!_skipCreditCheck&&sale.customer&&sale.customer!=='Walk-in Customer'&&!_editId){
        var customers=Svc().customers.getAll(); var custNmLc=sale.customer.toLowerCase();
        var custObj=customers.find(function(c){ return (c.n||c.name||'').toLowerCase()===custNmLc; });
        if(custObj&&custObj.creditLimit>0){
          var currentOutstanding=ERP._calcCustomerOutstanding?ERP._calcCustomerOutstanding(custObj.id||custObj.n):0;
          if(currentOutstanding+grand>custObj.creditLimit){
            _restoreBtn(); ERP._salesBuildCreditLimitModal&&ERP._salesBuildCreditLimitModal();
            ERP._creditLimitCtx={ custObj:custObj, currentOutstanding:currentOutstanding, invoiceGrand:grand };
            _oModal('creditLimitModal'); return;
          }
        }
      }

      var _resolvedCustId=null;
      if(sale.customer&&sale.customer!=='Walk-in Customer'){
        var _cr0=Svc().customers.getAll().find(function(c){ return (c.n||c.name||'').toLowerCase()===sale.customer.toLowerCase(); });
        _resolvedCustId=_cr0?String(_cr0.id||_cr0.n):sale.customer; sale.customerId=_resolvedCustId;
      }
      var tx=_mkTx(sale.id||_editId,'sales');

      if(_editId){
        try {
          if (ERP.PeriodLock && typeof ERP.PeriodLock.isLocked === 'function') {
            var _existing0 = Svc().sales.getAll().find(function(x){ return x.id === _editId; });
            var _origDate  = _existing0 && _existing0.date;
            var _newDate   = sale.date;
            if ((_origDate && ERP.PeriodLock.isLocked(_origDate)) ||
                (_newDate  && ERP.PeriodLock.isLocked(_newDate))) {
              _restoreBtn();
              _toast2('error','Period Locked','This invoice date is in a locked accounting period and cannot be edited.',6000);
              return;
            }
          }
        } catch(_plErr){ if(window.DEBUG_MODE) console.error(_plErr); }

        try {
          var _delta=Svc().invoice.computeRestorations(_editId,formData.items);
        } catch(deltaErr) {
          _restoreBtn();
          _toast2('error','Edit Failed',deltaErr.message||'Item barcode missing',5000);
          return;
        }
        var _restoreItems=_delta.restorations||[]; var _deductItems=_delta.deductions||[];
        var _meta={sourceModule:'sales',documentId:_editId,actor:tx.actor,skipGLBridge:true};
        var _existing=Svc().sales.getAll().find(function(x){ return x.id===_editId; });
        var _patch=Object.assign({},sale);
        delete _patch._v;
        if(_existing&&(_existing.paid||0)>0){ _patch.paid=_existing.paid; _patch.remaining=_existing.remaining; _patch.status=_existing.status; }
        if(ERP._walWrite) ERP._walWrite(tx.txId,'editInvoice',['updateInvoice','restoreStock','deductStock','reverseGL','repostGL'],{editId:_editId});
        Svc().sales.update(_editId,_patch).then(function(res){
          if(!res.success){ _restoreBtn(); _toast2('error','Save Failed',res.error||'Could not update',5000); return; }
          var rP=_InventorySvc.restore(_restoreItems,_meta);
          return rP.then(function(rRes){
            if(rRes&&!rRes.success) {
              Svc().sales.update(_editId, _existing);
              _restoreBtn();
              _toast2('error','Edit Failed','Stock restore failed — edit rolled back',5000);
              if(ERP._walUpdate) ERP._walUpdate(tx.txId, null, 'rolled_back');
              return;
            }
            var dP=_InventorySvc.deduct(_deductItems,_meta);
            return dP.then(function(dRes){
              if (dRes && !dRes.success) {
                Svc().sales.update(_editId, _existing);
                _restoreBtn();
                _toast2('error','Edit Failed','Stock deduction failed — edit rolled back. ' + (dRes.error && dRes.error.message || dRes.error || ''), 5000);
                if(ERP._walUpdate) ERP._walUpdate(tx.txId, null, 'rolled_back');
                return;
              }
              var _glReversePost = function() {
                if (!ERP.PostingEngine) { return Promise.resolve(); }
                var cogsDocId = 'SALE-COGS-' + _editId;
                var revDocId  = 'SALE-REV-'  + _editId;
                var revRev = ERP.PostingEngine.isPosted(revDocId)
                  ? ERP.PostingEngine.reverse(revDocId, {reason:'Invoice edited (by '+tx.actor+')', actor:'system'})
                  : Promise.resolve();
                return revRev.then(function() {
                    var cogsRev = ERP.PostingEngine.isPosted(cogsDocId)
                      ? ERP.PostingEngine.reverse(cogsDocId, {reason:'Invoice edit COGS reversal (by '+tx.actor+')', actor:'system'})
                      : Promise.resolve();
                    return cogsRev.then(function() {
                      if (!ERP.SalesPostingLock || typeof ERP.SalesPostingLock.postSale !== 'function') {
                        throw new Error('SalesPostingLock unavailable — refusing partial (revenue-only) GL repost');
                      }
                      return ERP.SalesPostingLock.postSale(_patch);
                    });
                  })
                  .catch(function(glErr) {
                    if (glErr && glErr.name === 'DuplicatePostingError') return;
                    ERP.AuditLog && ERP.AuditLog.write({id:ERP.uid?ERP.uid():(_now()+Math.random()),txId:tx.txId,actor:tx.actor,action:'gl_repost_failed',module:'sales',documentId:_editId,before:null,after:null,timestamp:_now(),severity:'error'});
                    _toast2('warning','GL Warning','Invoice updated but GL repost failed — notify admin',6000);
                  });
              };
              return _glReversePost().then(function() {
                if(_resolvedCustId) { Promise.resolve().then(function(){ try{ ERP._Ledger.recalculate(_resolvedCustId); }catch(e){ if(window.DEBUG_MODE) console.error(e); } }); }
                _restoreBtn(); _closeInvModal();
                _toast2('success','Invoice Updated','Invoice '+_editId+' updated',3500);
                UI().sales.render(); try{ if(ERP.dash&&ERP.dash.render) ERP.dash.render(); }catch(e){ if(window.DEBUG_MODE) console.error(e); }
                _currentId=_editId; _clearPreviewContext(); _openPreview(_editId);
              });
            });
          });
        }).catch(function(e){ _restoreBtn(); _toast2('error','Save Error',(e&&e.message||e)+'. Please retry.',5000); });
        return;
      }

      if(ERP._walWrite) ERP._walWrite(tx.txId,'newInvoice',['saveInvoice','deductStock','postLedger','postPayment'],{id:sale.id});
      Svc().sales.add(sale).then(function(addRes){
        if(!addRes.success){ _restoreBtn(); _toast2('error','Invoice Save Failed',addRes.error||'Could not save',5000); if(ERP._walUpdate) ERP._walUpdate(tx.txId,null,'rolled_back'); return; }
        var resolvedDeduct = _InventorySvc.resolveEntries(formData.items);
        var _unmatchedItems = formData.items.filter(function(i){
          return !resolvedDeduct.some(function(e){ return e.n === i.n; });
        }).map(function(i){ return i.n; }).filter(Boolean);
        if(_unmatchedItems.length){ _toast2('warning','Stock Not Tracked','No inventory match for: '+_unmatchedItems.join(', ')+'. Stock not deducted for these.',6000); }
        return _InventorySvc.deduct(formData.items,{sourceModule:'sales',documentId:sale.id,actor:tx.actor,skipGLBridge:true}).then(function(dRes){
          if(dRes&&!dRes.success){
            Svc().sales.softDelete(sale.id,tx.actor,'Stock deduction failed \u2014 invoice rolled back');
            _restoreBtn(); _toast2('error','Stock Deduction Failed','Invoice rolled back. Please retry.',6000);
            if(ERP._walUpdate) ERP._walUpdate(tx.txId,null,'rolled_back'); return;
          }
          if (window.ERP && ERP.SalesPostingLock && typeof ERP.SalesPostingLock.postSale === 'function') {
            try { ERP.SalesPostingLock.postSale(sale); } catch (_glE) { if (window.DEBUG_MODE) console.warn('[_saveInv] GL post failed (new):', _glE); }
          }
          if (_pendingJobLinkId) {
            try {
              if (typeof JobState !== 'undefined' && typeof JobState.updateJob === 'function') {
                JobState.updateJob(_pendingJobLinkId, { invoiceId: sale.id });
              }
            } catch (_jlErr) { if (window.DEBUG_MODE) console.warn('[_saveInv] job link update failed:', _jlErr); }
            _pendingJobLinkId = null;
          }
          if (_resolvedCustId) {
            try {
              var _clRes = Svc().invoice.updateCustomerLedger(_resolvedCustId, sale.id, grand, sale.date);
              if (_clRes && typeof _clRes.catch === 'function') {
                _clRes.catch(function(e) { if (window.DEBUG_MODE) console.warn('[_saveInv] customer ledger update failed:', e && e.message); });
              }
            } catch(_clE) { if (window.DEBUG_MODE) console.warn('[_saveInv] customer ledger error:', _clE && _clE.message); }
          }
          var payChain=(!_editId&&initialPayment)?_savePaymentAtomic(sale.customer,_resolvedCustId,initialPayment.amount,sale.id,sale.date,sale.pay,tx):Promise.resolve();
          return Promise.resolve(payChain).then(function(){
            _restoreBtn(); _closeInvModal();
            _toast2('success','Invoice Saved','Invoice '+sale.id+' saved successfully',3500);
            UI().sales.render(); try{ if(ERP.dash&&ERP.dash.render) ERP.dash.render(); }catch(e){ if(window.DEBUG_MODE) console.error(e); }
            _currentId=sale.id; _clearPreviewContext(); _openPreview(sale.id);
            setTimeout(function(){ try{ if(State().getBiz().autoPrint) _printNow(); }catch(e){ if(window.DEBUG_MODE) console.error(e); } },800);
            if(ERP._walUpdate) ERP._walUpdate(tx.txId,null,'committed');
          }).catch(function(e){
            _restoreBtn(); _closeInvModal();
            _toast2('warning','Payment Warning','Invoice saved but payment record failed: '+(e&&e.message||e)+'. Use \u26a0\ufe0f Retry Payment on this invoice to fix it.',7000);
            try {
              Svc().sales.update(sale.id, {
                _paymentRecordPending: true,
                _pendingPayment: {
                  amount: initialPayment && initialPayment.amount,
                  customerId: _resolvedCustId,
                  customerName: sale.customer,
                  mode: sale.pay,
                  date: sale.date,
                  failedAt: _now(),
                  error: e && e.message || String(e)
                }
              });
            } catch(_pE){ if(window.DEBUG_MODE) console.error(_pE); }
            try {
              ERP.AuditLog && ERP.AuditLog.write({
                id: ERP.uid ? ERP.uid() : (_now()+Math.random()),
                txId: tx.txId, actor: tx.actor, action: 'payment_record_failed',
                module: 'sales', documentId: sale.id, before: null,
                after: { amount: initialPayment && initialPayment.amount, error: e && e.message || String(e) },
                timestamp: _now(), severity: 'error'
              });
            } catch(_aE){ if(window.DEBUG_MODE) console.error(_aE); }
            _currentId=sale.id; _clearPreviewContext(); _openPreview(sale.id);
            if(ERP._walUpdate) ERP._walUpdate(tx.txId,null,'committed');
          });
        });
      }).catch(function(e){ _restoreBtn(); _toast2('error','Save Error',(e&&e.message||e)+'. Please retry.',5000); if(ERP._walUpdate) ERP._walUpdate(tx?tx.txId:'',null,'rolled_back'); });
    }catch(e){ if(window.DEBUG_MODE) console.error('[_saveInv]',e); _toast('\u26a0\ufe0f Save failed. ('+(e&&e.message||e)+')','error',5000); _restoreBtn(); }
  }

  function _clmChip(amount){ var inp=document.getElementById('clm-increase-val'); if(!inp) return; inp.value=(parseFloat(inp.value)||0)+amount; _clmCalc(); }
  function _clmCalc(){ var ctx=ERP._creditLimitCtx; if(!ctx) return; var inp=document.getElementById('clm-increase-val'); var increase=Math.max(0,parseFloat((inp&&inp.value)||0)||0); var newLimit=(ctx.custObj.creditLimit||0)+increase; var el_new=document.getElementById('clm-new-lmt'); var el_allow=document.getElementById('clm-allow'); if(el_new) el_new.textContent=increase>0?(_fmt(Math.round(newLimit))):'\u2014'; if(el_allow){ if(increase>0&&newLimit>=ctx.currentOutstanding+ctx.invoiceGrand){ el_allow.textContent='\u2705 Haan, save ho jaegi'; el_allow.style.color='var(--success)'; } else if(increase>0){ el_allow.textContent='\u274c Zyada increase karo'; el_allow.style.color='var(--danger)'; } else { el_allow.textContent='\u2014'; el_allow.style.color=''; } } }
  function _applyCreditTopup(){ var ctx=ERP._creditLimitCtx; if(!ctx||!ctx.custObj){ _cModal('creditLimitModal'); return; } var inp=document.getElementById('clm-increase-val'); var increase=Math.max(0,parseFloat((inp&&inp.value)||0)||0); var newLimit=(ctx.custObj.creditLimit||0)+increase; if(increase<=0){ _toast('\u26a0\ufe0f Please enter an increase amount','warning',3000); return; } if(newLimit<ctx.currentOutstanding+ctx.invoiceGrand){ _toast('\u26a0\ufe0f New limit must exceed outstanding + invoice','warning',4000); return; } Svc().customers.updateBalance(ctx.custObj.n||ctx.custObj.name,{creditLimit:newLimit}).then(function(){ ctx.custObj.creditLimit=newLimit; _cModal('creditLimitModal'); ERP._creditLimitCtx=null; _saveInv({skipCreditCheck:true}); }).catch(function(e){ _toast('\u26a0\ufe0f Limit update failed: '+(e&&e.message||e),'error',4000); }); }
  function _forceSaveOverLimit(){ _cModal('creditLimitModal'); ERP._creditLimitCtx=null; _saveInv({skipCreditCheck:true}); }

  function _savePaymentAtomic(customerName,customerId,amount,invoiceHint,date,payMode,tx){
    var buildRes=Svc().payIn.buildPayment({party:customerName,amount:amount,mode:payMode||'Cash',date:date||_today(),against:invoiceHint||'',notes:''});
    if(!buildRes.success) return Promise.resolve();
    var pi=buildRes.data.pi; if(customerId) pi.customerId=String(customerId);
    var _addRes=Svc().payin.add(pi);
    if(_addRes&&_addRes.success===false) return Promise.resolve();
    var result=ERP._Allocator.allocateFIFO(customerName,amount,pi.id,date,invoiceHint);
    var steps=[];
    var _pmLedgerEntry = ERP._Ledger && ERP._Ledger.createPaymentEntry(String(customerId||customerName),pi.id,amount,date||_today());
    if(_pmLedgerEntry){ steps.push({store:'customerLedger',op:'pushAll',records:[_pmLedgerEntry]}); }
    if(result.allocations.length) steps.push({store:'paymentAllocations',op:'pushAll',records:result.allocations});
    if(result.updatedInvoices.length) steps.push({store:'sales',op:'patchMany',patches:result.updatedInvoices.map(function(p){ return {id:p.id,paid:p.paid,remaining:p.remaining,status:p.status,updatedAt:_now()}; })});
    if(result.unallocated>0){ steps.push({store:'payIn',op:'patchMany',patches:[{id:pi.id,unallocatedAmount:result.unallocated}]}); _toast('\u2139\ufe0f '+_fmt(result.unallocated)+' credited as customer advance.','info',4000); }
    return steps.length?ERP._atomicSave(steps,tx?tx.txId:null):Promise.resolve();
  }

  function _retryPendingPayment(id){
    var inv=Svc().sales.getAll().find(function(x){ return x.id===id; });
    if(!inv){ _toast2('error','Not Found','Invoice '+id+' not found',4000); return; }
    if(!inv._paymentRecordPending || !inv._pendingPayment){ _toast2('info','Nothing to Retry','No pending payment recorded for this invoice',3500); return; }
    var p=inv._pendingPayment;
    var tx=_mkTx(id,'sales_payment_retry');
    _toast2('info','Retrying Payment','Recording '+_fmt(p.amount||0)+' for '+id+'\u2026',2500);
    Promise.resolve(_savePaymentAtomic(p.customerName,p.customerId,p.amount,id,p.date,p.mode,tx)).then(function(){
      return Svc().sales.update(id,{ _paymentRecordPending:false, _pendingPayment:null });
    }).then(function(){
      try{ if(p.customerId) ERP._Ledger&&ERP._Ledger.recalculate(p.customerId); }catch(_e){ if(window.DEBUG_MODE) console.error(_e); }
      try{
        ERP.AuditLog && ERP.AuditLog.write({
          id: ERP.uid?ERP.uid():(_now()+Math.random()), txId: tx.txId, actor: tx.actor,
          action:'payment_record_retry_succeeded', module:'sales', documentId:id,
          before:null, after:{amount:p.amount}, timestamp:_now(), severity:'info'
        });
      }catch(_aE){ if(window.DEBUG_MODE) console.error(_aE); }
      _toast2('success','Payment Recorded','Payment for '+id+' recorded successfully',4000);
      UI().sales.render(); try{ if(ERP.dash&&ERP.dash.render) ERP.dash.render(); }catch(e){ if(window.DEBUG_MODE) console.error(e); }
    }).catch(function(e){
      _toast2('error','Retry Failed','Payment retry failed: '+(e&&e.message||e)+'. Will need another retry.',6000);
    });
  }

  function _resetForm(){ var set=function(id,v){ var e=document.getElementById(id); if(e) e.value=v||''; }; var nextId=Svc()._nextId(Svc().sales.getAll(),'INV-'); var numEl=document.getElementById('vym-inv-num'); if(numEl){ numEl.value=''; numEl.placeholder=nextId+' (Auto)'; } set('vym-date',_today()); set('vym-ph',''); set('vym-cust',''); set('vym-notes',''); var sel=document.getElementById('vym-cust-sel'); if(sel) sel.value=''; var tb=document.getElementById('vym-items'); if(tb) tb.innerHTML=''; _addRow(); _addRow(); _suppressCreditReminder=true; _setCash(); _suppressCreditReminder=false; var roChk=document.getElementById('vym-ro-chk'); if(roChk) roChk.checked=true; var roVal=document.getElementById('vym-ro-val'); if(roVal) roVal.textContent='0.00'; var rc=document.getElementById('vym-rec-chk'); if(rc){ rc.checked=false; rc.disabled=false; } var rv=document.getElementById('vym-rec-val'); if(rv){ rv.value=''; delete rv.dataset.manuallySet; rv.readOnly=false; rv.title=''; rv.style.background=''; rv.style.color=''; rv.style.cursor=''; } var dw=document.getElementById('vym-desc-wrap'); if(dw) dw.style.display='none'; _editId=null; _pendingJobLinkId=null; _clearPreviewContext(); ERP._creditLimitCtx=null; _subData.est=[]; _subData.so=[]; _subData.dc=[]; try{ _clearImg(); }catch(e){ if(window.DEBUG_MODE) console.error(e); } try{ _clearDoc(); }catch(e){ if(window.DEBUG_MODE) console.error(e); } try{ _clearQR(); }catch(e){ if(window.DEBUG_MODE) console.error(e); } _calc(); _refreshCustList(); if(ERP._salesRefreshItemDL) ERP._salesRefreshItemDL(); }
  function _refreshCustList(){ var sel=document.getElementById('vym-cust-sel'); if(!sel) return; var cur=sel.value; var custs=ERP._salesCusts?ERP._salesCusts():[]; var seen={}; var unique=custs.filter(function(c){ var nm=(c.n||c.name||c.customer||'').trim().toLowerCase(); if(!nm||seen[nm]) return false; seen[nm]=true; return true; }); var opts='<option value="">Search by Name/Phone *</option><option value="__add__">+ Add New Customer</option>'; opts+=unique.map(function(c){ var n=c.n||c.name||c.customer||''; return '<option value="'+_esc(n)+'">'+_esc(n)+(c.ph||c.phone?' — '+(c.ph||c.phone):'')+'</option>'; }).join(''); sel.innerHTML=opts; if(cur&&cur!=='__add__') sel.value=cur; }
  function _onCustSelect(sel){ var v=sel.value; if(v==='__add__'){ sel.value=''; _showInlineAddCustomer(); return; } var hid=document.getElementById('vym-cust'); if(hid) hid.value=v; var custs=ERP._salesCusts?ERP._salesCusts():[]; var c=custs.find(function(x){ return (x.n||x.name||x.customer||'')===v; }); if(c){ var ph=document.getElementById('vym-ph'); if(ph) ph.value=c.ph||c.phone||''; } }
  function _fillModal(inv){ var set=function(id,v){ var e=document.getElementById(id); if(e) e.value=v||''; }; set('vym-date',inv.date||_today()); set('vym-inv-num',inv.id||''); set('vym-ph',inv.ph||''); set('vym-cust',inv.customer||''); set('vym-notes',inv.notes||''); var sel=document.getElementById('vym-cust-sel'); if(sel) sel.value=inv.customer||''; var tb=document.getElementById('vym-items'); if(tb) tb.innerHTML=''; var _retQtyMap={}; Svc().ret.getAll().filter(function(r){ return r.originalInv===inv.id; }).forEach(function(r){ (r.items||[]).forEach(function(ri){ var key=ri.n||''; _retQtyMap[key]=(_retQtyMap[key]||0)+(ri.q||0); }); }); (inv.items||[]).forEach(function(item){ _addRow(); var row=document.getElementById('vym-items').lastElementChild; var tds=row.querySelectorAll('td'); var s2=function(ti,v){ var inp=tds[ti]&&tds[ti].querySelector('input,select'); if(inp) inp.value=v||''; }; var retQty=_retQtyMap[item.n||'']||0; s2(1,item.n||''); s2(2,item.col||''); s2(3,Math.max(0,(item.q||1)-retQty)||1); s2(5,item.p||0); s2(6,item.discPct||0); if(item.taxPct){ var txI=tds[8]&&tds[8].querySelector('input[type=number]'); if(txI) txI.value=item.taxPct; } row.dataset.bc=item.barcode||''; }); _suppressCreditReminder=true; if(inv.pay==='Credit') _setCredit(); else _setCash(); _suppressCreditReminder=false; _attQR=inv.qrCode||null; _attImg=inv.imgAttachment||null; _editId=inv.id; var _rvEl=document.getElementById('vym-rec-val'); var _rcEl=document.getElementById('vym-rec-chk'); if(_rvEl){ var _eg=Svc()._totals(inv.items||[]).grand; if(inv.roundOff) _eg=Math.round(_eg); var _ep=Math.min(inv.paid||0,_eg); _rvEl.value=_ep>0?_ep.toFixed(2):''; _rvEl.dataset.manuallySet='1'; _rvEl.readOnly=true; _rvEl.title='Already paid — use Payment In to record more'; _rvEl.style.background='var(--bg)'; _rvEl.style.color='var(--muted)'; _rvEl.style.cursor='not-allowed'; } if(_rcEl){ _rcEl.checked=(inv.paid||0)>0; _rcEl.disabled=true; } _calc(); }
  function _openInvModal(){ ERP._salesBuildInvModal(); ERP._salesBuildPrintModal(); _resetForm(); var m=document.getElementById('invModal'); if(m){ m.style.display='flex'; document.body.style.overflow='hidden'; } var _rv=document.getElementById('vym-rec-val'); if(_rv && !_rv._manualListenerWired){ _rv.addEventListener('input',function(){ _rv.dataset.manuallySet='1'; }); _rv._manualListenerWired=true; } setTimeout(function(){ var e=document.getElementById('vym-cust-sel'); if(e) e.focus(); },80); }
  function _openEditModal(id){ var inv=Svc().sales.getAll().find(function(x){ return x.id===id&&!x.deleted; }); if(!inv){ _toast('Invoice not found','error'); return; } ERP._salesBuildInvModal(); ERP._salesBuildPrintModal(); _fillModal(inv); var m=document.getElementById('invModal'); if(m){ m.style.display='flex'; document.body.style.overflow='hidden'; } }
  function _closeInvModal(){ var m=document.getElementById('invModal'); if(m){ m.style.display='none'; document.body.style.overflow=''; } _editId=null; _pendingJobLinkId=null; _clearPreviewContext(); _subData.est=[]; _subData.so=[]; _subData.dc=[]; }

  
  
  
  
  function _prefillNewInvoice(data){
    if(!data) return;
    _resetForm();
    var set=function(id,v){ var e=document.getElementById(id); if(e) e.value=v||''; };
    set('vym-date', data.date||_today());
    set('vym-ph', data.ph||data.phone||'');
    set('vym-cust', data.customer||'');
    set('vym-notes', data.notes||'');
    var sel=document.getElementById('vym-cust-sel'); if(sel) sel.value=data.customer||'';
    var tb=document.getElementById('vym-items');
    if(tb && Array.isArray(data.items) && data.items.length){
      tb.innerHTML='';
      data.items.forEach(function(item){
        _addRow();
        var row=tb.lastElementChild;
        var tds=row.querySelectorAll('td');
        var s2=function(ti,v){ var inp=tds[ti]&&tds[ti].querySelector('input,select'); if(inp) inp.value=v||''; };
        s2(1,item.n||''); s2(2,item.col||''); s2(3,item.q||1); s2(5,item.p||0); s2(6,item.discPct||0);
        row.dataset.bc=item.barcode||'';
      });
    }
    _editId=null;
    _pendingJobLinkId=data.jobId||null;
    _calc();
    _refreshCustList();
    if(ERP._salesRefreshItemDL) ERP._salesRefreshItemDL();
  }

  function _openFromJob(data){
    _openInvModal();
    _prefillNewInvoice(data);
  }
  function _saveInlineCust(){ var name=(document.getElementById('_ic-name')||{}).value||''; if(!name.trim()){ _toast('Name required','warning'); return; } var cust={ n:name.trim(), ph:(document.getElementById('_ic-ph')||{}).value||'' }; var el=document.getElementById('_inlineCustForm'); if(el) el.remove(); Svc().customers.addInline(cust).then(function(){ _refreshCustList(); var s=document.getElementById('vym-cust-sel'); if(s) s.value=cust.n; var h=document.getElementById('vym-cust'); if(h) h.value=cust.n; _toast('Customer added!','success',3000); }).catch(function(e){ _toast('Customer save error: '+(e&&e.message||e),'error'); }); }
  function _showInlineAddCustomer(){ var existing=document.getElementById('_inlineCustForm'); if(existing){ existing.remove(); return; } var overlay=document.createElement('div'); overlay.id='_inlineCustForm'; overlay.style.cssText='position:fixed;inset:0;z-index:var(--zi-critical);background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center'; overlay.innerHTML='<div style="background:var(--white);border-radius:16px;padding:24px;width:360px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,.3)"><h3 style="font-size:16px;font-weight:800;color:var(--text);margin:0 0 16px">+ Add New Customer</h3><div style="display:flex;flex-direction:column;gap:10px"><input id="_ic-name" placeholder="Customer Name *" type="text" class="fi"><input id="_ic-ph" placeholder="Phone Number" type="text" class="fi"></div><div style="display:flex;gap:8px;margin-top:16px"><button onclick="document.getElementById(\'_inlineCustForm\').remove()" class="btn btn-ghost" style="flex:1">Cancel</button><button onclick="ERP.sales._saveInlineCust()" class="btn btn-primary" style="flex:1">+ Add</button></div></div>'; document.body.appendChild(overlay); setTimeout(function(){ var e=document.getElementById('_ic-name'); if(e) e.focus(); },50); }
  function _buildPreviewInv(){ var fd=_collectFormData(); var totals=Svc()._totals(fd.items); var grand=totals.grand; if(fd.roundOff) grand=Math.round(grand); var rc=document.getElementById('vym-rec-chk'); var paid=(rc&&rc.checked&&fd.receivedAmount>0)?Math.min(fd.receivedAmount,grand):0; var id=_editId||Svc()._nextId(Svc().sales.getAll(),'INV-'); if(fd.customId) id=fd.customId; return { id:id, customer:(fd.customer||'').trim(), ph:fd.phone||'', veh:'', notes:fd.notes||'', items:fd.items, pay:fd.payType||'Cash', paid:paid, roundOff:fd.roundOff, date:fd.date||_today(), status:paid>=grand?'paid':paid>0?'partial':'unpaid' }; }
  function _openFormPreview(){ var fd=_collectFormData(); if(!fd.items.length){ _toast('Please add at least one item','warning'); return; } _setPreviewContext(_buildPreviewInv()); _currentId=null; var im=document.getElementById('invModal'); if(im) im.style.display='none'; ERP._salesBuildPrintModal(); _currentDocType='invoice'; _refreshPreview(); _oModal('invPrintModal'); }
  function _formShare(type){ var fd=_collectFormData(); if(!fd.items.length){ _toast('Please add at least one item','warning'); return; } _setPreviewContext(_buildPreviewInv()); _currentId=null; if(type==='wa') _waShare(); else if(type==='email') _gmailShare(); else if(type==='pdf') _downloadPDF(); else if(type==='image') _downloadImage(); else if(type==='print'){ ERP._salesBuildPrintModal(); var el=document.getElementById('inv-full-preview'); if(el) el.innerHTML=Tmpl().buildInvoiceHTML(_currentInv,_currentTheme,_currentColor,State().getBiz()); _printNow(); } }
  function _eInvMenu(btn){ var menu=document.createElement('div'); menu.style.cssText='position:fixed;background:var(--white);border:1.5px solid var(--border);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:var(--zi-critical);min-width:200px;overflow:hidden'; var rect=btn.getBoundingClientRect(); menu.style.left=rect.left+'px'; menu.style.bottom=(window.innerHeight-rect.top+4)+'px'; menu.innerHTML=['IRN Generate','e-Invoice Cancel','Bulk e-Invoice'].map(function(t){ return '<button onclick="ERP.sales._toast(\''+t+' — Coming soon\',\'info\');this.closest(\'div\').remove()" style="display:block;width:100%;text-align:left;padding:10px 16px;background:none;border:none;font-size:13px;color:var(--text);cursor:pointer">'+t+'</button>'; }).join(''); document.body.appendChild(menu); setTimeout(function(){ document.addEventListener('click',function h(){ menu.remove(); document.removeEventListener('click',h); }); },10); }
  function _shareMenu(btn){ var menu=document.createElement('div'); menu.style.cssText='position:fixed;background:var(--white);border:1.5px solid var(--border);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:var(--zi-critical);min-width:180px;overflow:hidden'; var rect=btn.getBoundingClientRect(); menu.style.left=rect.left+'px'; menu.style.bottom=(window.innerHeight-rect.top+4)+'px'; var actions=[['WhatsApp',"ERP.sales._formShare('wa')"],['Email',"ERP.sales._formShare('email')"],['Download PDF',"ERP.sales._formShare('pdf')"],['Download Image',"ERP.sales._formShare('image')"],['Print',"ERP.sales._formShare('print')"],['Preview',"ERP.sales._openFormPreview()"]]; menu.innerHTML=actions.map(function(a){ return '<button onclick="'+a[1]+';this.closest(\'div\').remove()" style="display:block;width:100%;text-align:left;padding:10px 16px;background:none;border:none;font-size:13px;color:var(--text);cursor:pointer">'+a[0]+'</button>'; }).join(''); document.body.appendChild(menu); setTimeout(function(){ document.addEventListener('click',function h(){ menu.remove(); document.removeEventListener('click',h); }); },10); }

  var _attImg=null,_attDoc=null,_attQR=null;
  function _onImgUpload(inp){ if(!inp||!inp.files||!inp.files[0]) return; var file=inp.files[0]; if(file.size>5*1024*1024||!file.type.startsWith('image/')){ _toast('Valid image under 5MB required','error'); return; } var r=new FileReader(); r.onload=function(e){ _attImg=e.target.result; var th=document.getElementById('_vymImgThumb'),wr=document.getElementById('_vymImgWrap'); if(th) th.src=_attImg; if(wr) wr.style.display='block'; }; r.readAsDataURL(file); }
  function _clearImg(){ _attImg=null; var f=document.getElementById('_vymImgF'); if(f) f.value=''; var w=document.getElementById('_vymImgWrap'); if(w) w.style.display='none'; }
  function _onDocUpload(inp){ if(!inp||!inp.files||!inp.files[0]) return; _attDoc=inp.files[0].name; var nm=document.getElementById('_vymDocName'),wr=document.getElementById('_vymDocWrap'); if(nm) nm.textContent='doc: '+_attDoc; if(wr) wr.style.display='flex'; }
  function _clearDoc(){ _attDoc=null; var f=document.getElementById('_vymDocF'); if(f) f.value=''; var w=document.getElementById('_vymDocWrap'); if(w) w.style.display='none'; }
  function _onQRUpload(inp){ if(!inp||!inp.files||!inp.files[0]) return; var r=new FileReader(); r.onload=function(e){ _attQR=e.target.result; var d=document.getElementById('_vymQRprev'),img=document.getElementById('_vymQRImg'); if(img) img.src=_attQR; if(d) d.style.display='flex'; }; r.readAsDataURL(inp.files[0]); }
  function _clearQR(){ _attQR=null; var f=document.getElementById('_vymQRF'); if(f) f.value=''; var d=document.getElementById('_vymQRprev'),img=document.getElementById('_vymQRImg'); if(d) d.style.display='none'; if(img) img.removeAttribute('src'); }

  function _handleDbResult(dbRes,key){ if(!dbRes) return; if(typeof dbRes.then==='function'){ dbRes.then(function(res){ if(res&&!res.success) _toast('Save failed ('+key+'): '+(res.error&&res.error.message||res.error),'error',4000); }).catch(function(e){ _toast('Save error ('+key+'): '+(e&&e.message||e),'error',4000); }); } else if(dbRes&&!dbRes.success){ _toast('Save failed ('+key+'): '+(dbRes.error&&dbRes.error.message||dbRes.error),'error',4000); } }
  function _deleteSaleUI(id){ if(window.ERP&&ERP.UserLifecycle&&!ERP.UserLifecycle.check('delete_record').allowed){ _toast('Admin permission required.','error',5000); return; } var meta=Svc().sales.meta(id); if(!confirm('Delete Invoice '+id+'?')) return; if(meta.success&&meta.meta.linkedReturns){ if(!confirm('This invoice has '+meta.meta.linkedReturns+' return(s). Delete anyway?')) return; } var tx=_mkTx(id,'sales'); Svc().sales.deleteInvoice(id,tx).then(function(res){ if(!res.success){ _toast('Delete failed: '+(res.error&&res.error.message||res.error||'unknown'),'error',4000); return; } _toast('Invoice '+id+' deleted.','info',3000); UI().sales.render(); }).catch(function(e){ console.error('[_deleteSaleUI]', e); _toast('Delete hit an unexpected error — please refresh and verify.','error',6000); }); }
  function _deleteEstUI(id){ var _c=(window.ERP&&window.ERP.confirmDialog)||function(m,ok){if(window.confirm(m))ok();}; _c('Delete Estimate '+id+'?',function(){ var res=Svc().est.del(id); if(!res.success){ _toast('Delete failed','error'); return; } _handleDbResult(Svc().est.applyDel(res.data.estimates),'est:del'); UI().est.render(); }); }
  function _deleteSOUI(id){ var _c=(window.ERP&&window.ERP.confirmDialog)||function(m,ok){if(window.confirm(m))ok();}; _c('Delete Order '+id+'?',function(){ var res=Svc().so.del(id); if(!res.success){ _toast('Delete failed','error'); return; } _handleDbResult(Svc().so.applyDel(res.data.saleOrders),'so:del'); UI().so.render(); }); }
  function _deletePayInUI(id){ if(window.ERP&&ERP.UserLifecycle&&!ERP.UserLifecycle.check('void_invoice').allowed){ _toast('Admin permission required.','error',5000); return; } var pi=Svc().payin.getAll().find(function(x){ return x.id===id; }); if(!pi){ _toast('Receipt not found','error'); return; } if(pi.voided){ _toast('Receipt '+id+' already voided.','info'); return; } var _c=(window.ERP&&window.ERP.confirmDialog)||function(m,ok){if(window.confirm(m))ok();}; _c('Void Receipt '+id+'? Allocations will be reversed.',function(){ var tx=_mkTx(id,'sales'); Svc().payin.voidPayment(id,tx).then(function(res){ if(!res.success){ _toast('Void failed: '+(res.error&&res.error.message||res.error),'error',4000); return; } _toast('Receipt '+id+' voided.','info',5000); UI().payin.render(); UI().sales.render(); }).catch(function(e){ console.error('[_deletePayInUI]', e); _toast('Void hit an unexpected error — please refresh and verify.','error',6000); }); }); }
  function _deleteRetUI(id){
    var _retConfirm = (window.ERP && window.ERP.confirmDialog) || function(msg, ok) { if (window.confirm(msg)) ok(); };
    _retConfirm('Delete Credit Note ' + id + '?', function() {
    var ret = Svc().ret.getAll().find(function(x){ return x.id === id; });
    if (!ret) { _toast('Credit note not found', 'error'); return; }

    _InventorySvc.deduct(ret.items || [], { sourceModule: 'sales_return_delete', documentId: id, actor: 'system', skipGLBridge: true })
      .then(function(dr){
        if (!dr.success) {
          _toast('Delete cancelled — stock deduct failed: ' + ((dr.error && (dr.error.message || dr.error)) || 'unknown'), 'error');
          return;
        }

        var res = Svc().ret.del(id);
        if (!res.success) { _toast('Delete failed: ' + (res.error || 'unknown'), 'error'); return; }
        _handleDbResult(Svc().ret.applyDel(res.data.saleReturns), 'ret:del');

        if (ret.originalInv) {
          if (!ret.partial) {
            Svc().ret.restoreInvoice(ret.originalInv, ret.returnGrand || ret.amount)
              .then(function() { UI().sales.render(); });
          } else {
            var _pInv = Svc().sales.getAll().find(function(x) {
              return x.id === ret.originalInv && !x.deleted;
            });
            if (_pInv) {
              var _pTot    = Svc()._totals(_pInv.items || []);
              var _pGrand  = _pInv.roundOff ? Math.round(_pTot.grand) : _pTot.grand;
              var _pPaid   = Math.min(_pGrand, Math.max(0, (_pInv.paid || 0) + (ret.amount || 0)));
              var _pRem    = Math.max(0, Math.round((_pGrand - _pPaid) * 100) / 100);
              var _pStatus = _pPaid >= _pGrand ? 'paid' : _pPaid > 0 ? 'partial' : 'unpaid';
              Svc().sales.update(ret.originalInv, {
                paid: _pPaid, remaining: _pRem, status: _pStatus, updatedAt: _now()
              });
            }
          }
        }

        var origInvId = ret.originalInv || ret.invoiceId || ret.originalInvoice || '';
        var pe = window.ERP && ERP.PostingEngine;
        if (pe && origInvId) {
          var origInv = Svc().sales.getAll().find(function(x){ return x.id === origInvId && !x.deleted; });
          var SA     = (ERP.accounting && ERP.accounting.constants) || {};
          var drAcct = (origInv && (origInv.pay || '').toLowerCase() === 'cash') ? (SA.CASH || 'acc-1001') : (SA.AR || 'acc-1100');
          var crAcct = SA.SALES_REV || 'acc-4001';

          if (ret.partial) {
            var _pretDocId = 'SALE-PRET-' + id;
            if (pe.isPosted && pe.isPosted(_pretDocId)) {
              pe.reverse(_pretDocId, {
                reason: 'Partial CN deleted: ' + id, actor: 'system'
              }).catch(function(e) {
                console.warn('[_deleteRetUI] SALE-PRET reversal failed:', e && e.message);
                _toast('Credit note deleted but GL reversal failed — notify admin', 'warning', 6000);
                try {
                  if (ERP.AuditLog && typeof ERP.AuditLog.write === 'function') {
                    ERP.AuditLog.write('sale_pret_reversal_failed', { creditNoteId: id, docId: _pretDocId, error: e && e.message });
                  }
                } catch(_ae){ if(window.DEBUG_MODE) console.error(_ae); }
              });
            }
          } else {
            if (origInv && ERP.SalesPostingLock && typeof ERP.SalesPostingLock.postSale === 'function') {
              ERP.SalesPostingLock.postSale(origInv).catch(function(e) {
                console.warn('[_deleteRetUI] GL repost failed:', e && e.message);
              });
            } else if (origInv && typeof pe.post === 'function') {
              var t     = Svc()._totals(origInv.items || []);
              var grand = origInv.roundOff ? Math.round(t.grand) : t.grand;
              var paisa = Math.round(grand * 100);
              if (!pe.isPosted('SALE-REV-' + origInvId)) {
                pe.post({
                  documentId: 'SALE-REV-' + origInvId, documentType: 'invoice',
                  sourceModule: 'sale_return_delete', memo: 'Return deleted: ' + id, actor: 'system',
                  entries: [
                    { accountId: drAcct, debit: paisa, credit: 0 },
                    { accountId: crAcct, debit: 0,     credit: paisa }
                  ]
                }).catch(function(e) {
                  console.warn('[_deleteRetUI] GL repost failed:', e && e.message);
                });
              }
            }
          }
        }

        var retAmount = ret.returnGrand || ret.amount || 0;
        var retCust   = ret.customer || '';
        if (retAmount > 0 && retCust && ERP._Ledger) {
          try {
            var custRec = Svc().customers.getAll().find(function(c){ return (c.n || c.name || '').toLowerCase() === retCust.toLowerCase(); });
            var custId  = custRec ? String(custRec.id || custRec.n) : retCust;
            var voidEntry = ERP._Ledger.createRefundVoidEntry(custId, id + '-VOID', retAmount, _today());
            ERP._atomicSave([{ store:'customerLedger', op:'pushAll', records:[voidEntry] }]).catch(function(e){
              console.error('[_deleteRetUI] void ledger entry save failed:', e && e.message || e);
              _toast('Return deleted, but ledger reversal failed — please reconcile manually.', 'warning', 6000);
            });
            ERP._Ledger.recalculate(custId);
          } catch (e) {
            console.warn('[_deleteRetUI] ledger reversal failed:', e && e.message);
          }
        }

        UI().ret.render();
        UI().sales.render();
        _toast('Credit Note ' + id + ' deleted', 'info', 3000);
      }).catch(function(e){
        console.error('[_deleteRetUI]', e);
        _toast2('error','Unexpected Error','Return delete finished with an unexpected error — please refresh and verify.',6000);
      });
    });
  }
  var _returnSnapshot=null;
  function _printReceipt(id){ _printPayIn(id); }
  
  function _viewCreditNote(id){
    var ret=Svc().ret.getAll().find(function(x){ return x.id===id; });
    if(!ret){ _toast('Credit note not found','error'); return; }
    var rows=(ret.items||[]).map(function(i,n){
      var amt=Math.round(((i.q||0)*(i.p||0)-(i.d||0)+(i.taxAmt||0))*100)/100;
      return '<tr style="border-bottom:1px solid var(--hover)"><td style="padding:8px 10px">'+(n+1)+'</td><td style="padding:8px 10px;font-weight:600">'+_esc(i.n||'')+'</td><td style="padding:8px 10px;text-align:center">'+_esc(String(i.q||0))+'</td><td style="padding:8px 10px;text-align:right">'+_fmt(i.p||0)+'</td><td style="padding:8px 10px;text-align:right;font-weight:700;color:var(--purple)">'+_fmt(amt)+'</td></tr>';
    }).join('');
    var html=
      '<div style="padding:16px">'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;font-size:13px">'+
        '<div><strong>Credit Note #:</strong> '+_esc(ret.id)+'</div>'+
        '<div><strong>Date:</strong> '+_esc(ret.date||'')+'</div>'+
        '<div><strong>Customer:</strong> '+_esc(ret.customer||'—')+'</div>'+
        '<div><strong>Against Invoice:</strong> '+_esc(ret.originalInv||'—')+'</div>'+
        '<div><strong>Reason:</strong> '+_esc(ret.reason||'—')+'</div>'+
        '<div><strong>Method:</strong> '+_esc(ret.mode||'—')+'</div>'+
      '</div>'+
      '<table style="width:100%;border-collapse:collapse;font-size:12px">'+
        '<thead><tr style="background:var(--purple-l)"><th style="padding:8px 10px;text-align:left;color:var(--purple)">#</th><th style="padding:8px 10px;text-align:left;color:var(--purple)">Item</th><th style="padding:8px 10px;text-align:center;color:var(--purple)">Qty</th><th style="padding:8px 10px;text-align:right;color:var(--purple)">Price</th><th style="padding:8px 10px;text-align:right;color:var(--purple)">Amount</th></tr></thead>'+
        '<tbody>'+rows+'</tbody>'+
      '</table>'+
      '<div style="display:flex;justify-content:flex-end;margin-top:12px">'+
        '<div style="background:var(--purple-l);border-radius:8px;padding:12px 20px;text-align:right">'+
          '<div style="font-size:12px;color:var(--muted)">Return Value</div>'+
          '<div style="font-size:20px;font-weight:800;color:var(--purple)">'+_fmt(ret.returnGrand||ret.amount||0)+'</div>'+
        '</div>'+
      '</div>'+
      '</div>';
    _setPreviewContext(ret);
    var previewEl=document.getElementById('inv-full-preview');
    var modalId='invPrintModal';
    if(previewEl){ previewEl.innerHTML=html; _oModal(modalId); }
    else{ _toast('Preview not available','info'); }
  }

  function _printCreditNote(id){
    var ret=Svc().ret.getAll().find(function(x){ return x.id===id; });
    if(!ret){ _toast('Credit note not found','error'); return; }
    var biz=State().getBiz();
    var pw=window.open('','_blank');
    if(!pw){ _toast('Pop-ups blocked','error'); return; }
    var rows=(ret.items||[]).map(function(i,n){
      var amt=Math.round(((i.q||0)*(i.p||0)-(i.d||0)+(i.taxAmt||0))*100)/100;
      return '<tr><td>'+(n+1)+'</td><td>'+_esc(i.n||'')+'</td><td>'+i.q+'</td><td style="text-align:right">'+_fmt(i.p||0)+'</td><td style="text-align:right;font-weight:700;color:#7c3aed">'+_fmt(amt)+'</td></tr>';
    }).join('');
    var returnGrand = ret.returnGrand || ret.amount || 0;
    var cashOut = ret.cashPaidOut || 0;
    var storeCredit = Math.max(0, returnGrand - cashOut);
    var refundSection = cashOut > 0
      ? '<div style="display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid rgba(255,255,255,.2);margin-top:8px"><span>Cash Refunded</span><strong>'+_fmt(cashOut)+'</strong></div>'
          + (storeCredit > 0 ? '<div style="display:flex;justify-content:space-between;padding:4px 0"><span>Store Credit</span><strong>'+_fmt(storeCredit)+'</strong></div>' : '')
      : '';
    pw.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Credit Note '+_esc(ret.id)+'</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,"Segoe UI",Arial,sans-serif;padding:24px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:8px 10px;border-bottom:1px solid #f3f4f6}th{background:#f5f3ff;color:#7c3aed;font-weight:700;text-align:left}.rbox{margin:16px 0 0;background:#7c3aed;border-radius:10px;padding:14px 18px;color:#fff}.no-print{display:flex;gap:8px;justify-content:center;padding:16px}.no-print button{border:none;padding:9px 22px;border-radius:8px;font-size:13px;cursor:pointer;font-weight:600}@media print{.no-print{display:none!important}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}</style></head><body>'
      +'<div class="no-print"><button onclick="window.print()" style="background:#7c3aed;color:#fff">Print Credit Note</button><button onclick="window.close()" style="background:#64748b;color:#fff">Close</button></div>'
      +'<h2 style="color:#7c3aed;margin-bottom:8px">Credit Note: '+_esc(ret.id)+'</h2>'
      +'<p style="color:var(--muted,#64748b);font-size:12px;margin-bottom:16px">'+_esc(biz.name||'')+' | '+_esc(ret.date||'')+' | Customer: '+_esc(ret.customer||'')+(ret.reason?' | Reason: '+_esc(ret.reason):'')+' | Mode: '+_esc(ret.mode||'Cash Refund')+'</p>'
      +'<table><thead><tr><th>#</th><th>Item</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead><tbody>'+rows+'</tbody></table>'
      +'<div class="rbox"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:14px">Return Value (Goods)</span><strong style="font-size:20px">'+_fmt(returnGrand)+'</strong></div>'+refundSection+'</div>'
      +'</body></html>');
    pw.document.close();
    setTimeout(function(){ try{ pw.print(); }catch(e){ if(window.DEBUG_MODE) console.error(e); } },600);
  }


  function _buildRetModal(){
    var existing = document.getElementById('saleReturnModal');
    if(existing) existing.remove();

    var invoiceOptions = Svc().sales.getAll()
      .filter(function(s){ return !s.deleted && s.status !== 'returned'; })
      .slice().sort(function(a,b){ return (b.date||'') < (a.date||'') ? -1 : 1; })
      .map(function(s){ return '<option value="' + _esc(s.id||'') + '">' + _esc(s.id) + ' \u2014 ' + _esc(s.customer||'') + ' \u2014 ' + _fmt(s.total||s.grand||0) + '</option>'; }).join('');

    var oldStyle = document.getElementById('sr-modal-styles');
    if(oldStyle) oldStyle.remove();
    {
      var styleEl = document.createElement('style');
      styleEl.id = 'sr-modal-styles';
      styleEl.textContent = [
        '#saleReturnModal *{box-sizing:border-box;margin:0;padding:0}',
        '#saleReturnModal{background:#F4F5F7}',
        '#saleReturnModal .sr-wrap{display:flex;flex-direction:column;height:100vh;overflow:hidden}',
        '#saleReturnModal .sr-header{background:#fff;border-bottom:1px solid #E2E8F0;padding:0 24px;display:flex;align-items:center;justify-content:space-between;height:60px;flex-shrink:0;box-shadow:0 1px 3px rgba(0,0,0,.06)}',
        '#saleReturnModal .sr-hd-left{display:flex;align-items:center;gap:12px}',
        '#saleReturnModal .sr-logo{width:38px;height:38px;background:#7F77DD;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0}',
        '#saleReturnModal .sr-hd-title{font-size:15px;font-weight:600;color:#1A202C;line-height:1.2}',
        '#saleReturnModal .sr-hd-sub{font-size:12px;color:#718096;margin-top:1px}',
        '#saleReturnModal .sr-hd-right{display:flex;align-items:center;gap:8px}',
        '#saleReturnModal .sr-hbtn{height:34px;padding:0 14px;border:1px solid #E2E8F0;border-radius:8px;background:#fff;font-size:12px;color:#4A5568;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:var(--font);font-weight:500}',
        '#saleReturnModal .sr-hbtn:hover{background:#F7FAFC;border-color:#CBD5E0}',
        '#saleReturnModal .sr-kpi-row{background:#fff;border-bottom:1px solid #E2E8F0;padding:0 28px;display:flex;align-items:stretch;gap:0;flex-shrink:0}',
        '#saleReturnModal .sr-kpi{padding:14px 28px 14px 0;border-right:1px solid #EDF2F7;margin-right:28px;min-width:110px}',
        '#saleReturnModal .sr-kpi:last-child{border-right:none;margin-right:0}',
        '#saleReturnModal .sr-kpi-label{font-size:11px;color:#A0AEC0;letter-spacing:0.4px;text-transform:uppercase;margin-bottom:4px}',
        '#saleReturnModal .sr-kpi-val{font-size:22px;font-weight:600;color:#1A202C;line-height:1}',
        '#saleReturnModal .sr-kpi-tag{display:inline-flex;align-items:center;gap:4px;font-size:12px;padding:3px 10px;border-radius:20px;background:#EDE9FE;color:#5B21B6;font-weight:500;margin-top:4px}',
        '#saleReturnModal .sr-body{display:grid;grid-template-columns:1fr 320px;flex:1;min-height:0;overflow:hidden}',
        '#saleReturnModal .sr-left{padding:20px 16px 20px 24px;display:flex;flex-direction:column;gap:12px;overflow-y:auto;min-height:0}',
        '#saleReturnModal .sr-right{border-left:1px solid #E2E8F0;background:#fff;display:flex;flex-direction:column;overflow-y:auto;min-height:0}',
        '#saleReturnModal .sr-panel{background:#fff;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;flex-shrink:0;box-shadow:0 1px 3px rgba(0,0,0,.04)}',
        '#saleReturnModal .sr-panel-head{padding:12px 16px;border-bottom:1px solid #EDF2F7;display:flex;align-items:center;justify-content:space-between;background:#FAFBFC}',
        '#saleReturnModal .sr-step-pill{display:flex;align-items:center;gap:8px}',
        '#saleReturnModal .sr-snum{width:22px;height:22px;border-radius:50%;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:#EDE9FE;color:#5B21B6}',
        '#saleReturnModal .sr-snum.ok{background:#D1FAE5;color:#065F46}',
        '#saleReturnModal .sr-stitle{font-size:13px;font-weight:600;color:#2D3748}',
        '#saleReturnModal .sr-panel-body{padding:16px}',
        '#saleReturnModal .sr-inv-select{width:100%;padding:10px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:13px;color:#2D3748;background:#fff;font-family:var(--font);outline:none;cursor:pointer}',
        '#saleReturnModal .sr-inv-select:focus{border-color:#7F77DD;box-shadow:0 0 0 3px rgba(127,119,221,.1)}',
        '#saleReturnModal .sr-inv-card{margin-top:10px;background:#F8F7FF;border:1.5px solid #C4B5FD;border-radius:10px;padding:12px 14px}',
        '#saleReturnModal .sr-inv-card-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}',
        '#saleReturnModal .sr-iid{font-size:14px;font-weight:700;color:#5B21B6}',
        '#saleReturnModal .sr-icust{font-size:12px;color:#718096;margin-top:2px}',
        '#saleReturnModal .sr-iamts{display:flex;gap:16px}',
        '#saleReturnModal .sr-iamt-l{font-size:10px;color:#A0AEC0;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:2px}',
        '#saleReturnModal .sr-iamt-v{font-size:13px;font-weight:600;color:#2D3748}',
        '#saleReturnModal .sr-iamt-v.red{color:#E53E3E}',
        '#saleReturnModal .sr-item{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #F7FAFC;background:#fff;transition:background .1s}',
        '#saleReturnModal .sr-item:hover{background:#FAFBFC}',
        '#saleReturnModal .sr-item:last-child{border-bottom:none}',
        '#saleReturnModal .sr-chk{width:20px;height:20px;border-radius:5px;border:1.5px solid #CBD5E0;background:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:all .12s}',
        '#saleReturnModal .sr-chk.on{background:#7F77DD;border-color:#7F77DD}',
        '#saleReturnModal .sr-iname{font-size:13px;font-weight:500;color:#2D3748}',
        '#saleReturnModal .sr-imeta{font-size:11px;color:#A0AEC0;margin-top:2px;display:flex;align-items:center;gap:6px}',
        '#saleReturnModal .sr-prev-badge{font-size:10px;padding:1px 7px;border-radius:20px;background:#FED7D7;color:#C53030;font-weight:600}',
        '#saleReturnModal .sr-qty-row{display:flex;align-items:center;gap:6px;justify-content:flex-end}',
        '#saleReturnModal .sr-qb{width:26px;height:26px;border-radius:6px;border:1px solid #E2E8F0;background:#F7FAFC;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px;color:#4A5568;font-family:var(--font);line-height:1}',
        '#saleReturnModal .sr-qb:hover{background:#EDF2F7;border-color:#CBD5E0}',
        '#saleReturnModal .sr-qv{font-size:14px;font-weight:600;min-width:20px;text-align:center;color:#2D3748}',
        '#saleReturnModal .sr-ipr{font-size:13px;font-weight:600;color:#2D3748;min-width:70px;text-align:right;margin-top:3px}',
        '#saleReturnModal .sr-ipr-sub{font-size:10px;color:#A0AEC0;text-align:right}',
        '#saleReturnModal .sr-item.dimmed{opacity:0.38;pointer-events:none}',
        '#saleReturnModal .sr-methods{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px}',
        '#saleReturnModal .sr-mopt{padding:12px 8px;border:1.5px solid #E2E8F0;border-radius:10px;background:#fff;cursor:pointer;text-align:center;transition:all .15s}',
        '#saleReturnModal .sr-mopt:hover{border-color:#C4B5FD;background:#FAFAFE}',
        '#saleReturnModal .sr-mopt.on{border:2px solid #7F77DD;background:#F5F3FF}',
        '#saleReturnModal .sr-micon{color:#A0AEC0;margin-bottom:5px;display:flex;justify-content:center}',
        '#saleReturnModal .sr-mopt.on .sr-micon{color:#7F77DD}',
        '#saleReturnModal .sr-mlabel{font-size:11px;color:#718096;font-weight:500}',
        '#saleReturnModal .sr-mopt.on .sr-mlabel{color:#5B21B6;font-weight:600}',
        '#saleReturnModal .sr-fl{margin-bottom:14px}',
        '#saleReturnModal .sr-fl:last-child{margin-bottom:0}',
        '#saleReturnModal .sr-fl-label{font-size:10px;color:#718096;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;margin-bottom:6px;display:block}',
        '#saleReturnModal .sr-fl input,#saleReturnModal .sr-fl select,#saleReturnModal .sr-fl textarea{width:100%;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;background:#fff;font-size:13px;color:#2D3748;font-family:var(--font);outline:none}',
        '#saleReturnModal .sr-fl input:focus,#saleReturnModal .sr-fl select:focus,#saleReturnModal .sr-fl textarea:focus{border-color:#7F77DD;box-shadow:0 0 0 3px rgba(127,119,221,.1)}',
        '#saleReturnModal .sr-cur-wrap{position:relative}',
        '#saleReturnModal .sr-cur-sym{position:absolute;left:11px;top:50%;transform:translateY(-50%);font-size:12px;color:#A0AEC0;font-weight:600;pointer-events:none}',
        '#saleReturnModal .sr-fl input.cur{padding-left:28px}',
        '#saleReturnModal .sr-split-info{font-size:11px;color:#744210;margin-top:6px;padding:7px 11px;background:#FEFCBF;border:1px solid #F6E05E;border-radius:7px}',
        '#saleReturnModal .sr-sum-section{padding:18px 16px;border-bottom:1px solid #EDF2F7}',
        '#saleReturnModal .sr-sum-title{font-size:10px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:#A0AEC0;margin-bottom:12px}',
        '#saleReturnModal .sr-type-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:4px 10px;border-radius:20px;font-weight:600;background:#EDE9FE;color:#5B21B6;margin-bottom:14px}',
        '#saleReturnModal .sr-srow{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid #F7FAFC}',
        '#saleReturnModal .sr-srow:last-child{border-bottom:none}',
        '#saleReturnModal .sr-srow-l{font-size:12px;color:#718096}',
        '#saleReturnModal .sr-srow-v{font-size:13px;font-weight:600;color:#2D3748}',
        '#saleReturnModal .sr-srow-v.g{color:#276749}',
        '#saleReturnModal .sr-srow-v.o{color:#C05621}',
        '#saleReturnModal .sr-srow-v.p{color:#5B21B6}',
        '#saleReturnModal .sr-cn-preview{padding:16px;border-bottom:1px solid #EDF2F7;background:#F8F7FF}',
        '#saleReturnModal .sr-cn-title{font-size:10px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:#A0AEC0;margin-bottom:10px}',
        '#saleReturnModal .sr-cn-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #EDE9FE}',
        '#saleReturnModal .sr-cn-row:last-child{border-bottom:none}',
        '#saleReturnModal .sr-cn-key{font-size:12px;color:#718096}',
        '#saleReturnModal .sr-cn-val{font-size:12px;font-weight:600;color:#2D3748}',
        '#saleReturnModal .sr-cn-val.p{color:#5B21B6}',
        '#saleReturnModal .sr-actions{padding:16px;margin-top:auto;border-top:1px solid #EDF2F7}',
        '#saleReturnModal .sr-btn-confirm{width:100%;padding:12px;background:#7F77DD;color:#fff;border:none;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;font-family:var(--font);transition:background .15s;margin-bottom:8px;letter-spacing:0.2px}',
        '#saleReturnModal .sr-btn-confirm:hover:not(:disabled){background:#6C63CC}',
        '#saleReturnModal .sr-btn-confirm:disabled{opacity:0.4;cursor:not-allowed}',
        '#saleReturnModal .sr-btn-cancel{width:100%;padding:10px;background:transparent;color:#718096;border:1px solid #E2E8F0;border-radius:9px;font-size:12px;cursor:pointer;font-family:var(--font)}',
        '#saleReturnModal .sr-btn-cancel:hover{background:#F7FAFC}'
      ].join('\n');
      document.head.appendChild(styleEl);
    }

    var el = document.createElement('div');
    el.innerHTML =
      '<div id="saleReturnModal" style="display:none;position:fixed;inset:0;z-index:var(--zi-top,1200);background:var(--bg);font-family:var(--font);flex-direction:column">' +
        '<div class="sr-wrap">' +

          '<div class="sr-header">' +
            '<div class="sr-hd-left">' +
              '<div class="sr-logo">' +
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.95"/></svg>' +
              '</div>' +
              '<div>' +
                '<div class="sr-hd-title">Sale Return / Credit Note</div>' +
                '<div class="sr-hd-sub" id="ret-header-sub">MH Autos ERP &nbsp;\u00b7&nbsp; Invoice select karein</div>' +
              '</div>' +
            '</div>' +
            '<div class="sr-hd-right">' +
              '<button class="sr-hbtn" onclick="ERP.sales._closeReturnModal()">' +
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
                'Close' +
              '</button>' +
            '</div>' +
          '</div>' +

          '<div class="sr-kpi-row">' +
            '<div class="sr-kpi">' +
              '<div class="sr-kpi-label">Return value</div>' +
              '<div class="sr-kpi-val" id="ret-kpi-val">\u2014</div>' +
            '</div>' +
            '<div class="sr-kpi">' +
              '<div class="sr-kpi-label">Refund method</div>' +
              '<div class="sr-kpi-tag" id="ret-kpi-mode">Cash / Transfer</div>' +
            '</div>' +
            '<div class="sr-kpi">' +
              '<div class="sr-kpi-label">Items selected</div>' +
              '<div class="sr-kpi-val" id="ret-kpi-items">0</div>' +
            '</div>' +
          '</div>' +

          '<div class="sr-body">' +

            '<div class="sr-left">' +

              '<div class="sr-panel">' +
                '<div class="sr-panel-head">' +
                  '<div class="sr-step-pill">' +
                    '<div class="sr-snum" id="ret-step1-num">1</div>' +
                    '<span class="sr-stitle">Invoice</span>' +
                  '</div>' +
                '</div>' +
                '<div class="sr-panel-body" style="padding:12px">' +
                  '<div class="sr-inv-select-wrap">' +
                    '<select id="ret-id" class="sr-inv-select" onchange="ERP.sales._lookupRet()">' +
                      '<option value="">-- Invoice select karein --</option>' + invoiceOptions +
                    '</select>' +
                    '<div id="ret-inv-info" style="display:none">' +
                      '<div class="sr-inv-card">' +
                        '<div class="sr-inv-card-top">' +
                          '<div>' +
                            '<div class="sr-iid" id="ret-inv-id-lbl">\u2014</div>' +
                            '<div class="sr-icust" id="ret-inv-cust-lbl">\u2014</div>' +
                          '</div>' +
                          '<div class="sr-iamts">' +
                            '<div><div class="sr-iamt-l">Total</div><div class="sr-iamt-v" id="ret-inv-total">\u2014</div></div>' +
                            '<div><div class="sr-iamt-l">Paid</div><div class="sr-iamt-v" id="ret-inv-paid">\u2014</div></div>' +
                            '<div><div class="sr-iamt-l">Balance</div><div class="sr-iamt-v red" id="ret-inv-bal">\u2014</div></div>' +
                          '</div>' +
                        '</div>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
              '</div>' +

              '<div class="sr-panel" id="ret-items-wrap" style="display:none">' +
                '<div class="sr-panel-head">' +
                  '<div class="sr-step-pill">' +
                    '<div class="sr-snum" id="ret-step2-num">2</div>' +
                    '<span class="sr-stitle">Return items</span>' +
                  '</div>' +
                  '<div style="display:flex;align-items:center;gap:8px">' +
                    '<span style="font-size:11px;color:var(--muted)" id="ret-sel-count"></span>' +
                    '<button class="sr-hbtn" onclick="ERP.sales._retSelectAll()" style="font-size:11px;padding:3px 9px;height:auto">Select all</button>' +
                  '</div>' +
                '</div>' +
                '<div class="sr-panel-body" style="padding:0">' +
                  '<div id="ret-items-list"></div>' +
                '</div>' +
              '</div>' +

              '<div class="sr-panel" id="ret-config-wrap" style="display:none">' +
                '<div class="sr-panel-head">' +
                  '<div class="sr-step-pill">' +
                    '<div class="sr-snum" id="ret-step3-num">3</div>' +
                    '<span class="sr-stitle">Refund configuration</span>' +
                  '</div>' +
                '</div>' +
                '<div class="sr-panel-body">' +
                  '<div class="sr-fl"><span class="sr-fl-label">Refund method</span>' +
                    '<div class="sr-methods">' +
                      '<div class="sr-mopt on" id="ret-mb-cash" onclick="ERP.sales._retSetMode(\'Cash Refund\')">' +
                        '<div class="sr-micon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg></div>' +
                        '<div class="sr-mlabel">Cash / transfer</div>' +
                      '</div>' +
                      '<div class="sr-mopt" id="ret-mb-store" onclick="ERP.sales._retSetMode(\'Store Credit\')">' +
                        '<div class="sr-micon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 9l1-6h16l1 6"/><path d="M3 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0"/><path d="M5 9v12h14V9"/></svg></div>' +
                        '<div class="sr-mlabel">Store credit</div>' +
                      '</div>' +
                      '<div class="sr-mopt" id="ret-mb-bank" onclick="ERP.sales._retSetMode(\'Bank Transfer\')">' +
                        '<div class="sr-micon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 22V11M21 22V11M12 22V11"/><path d="M1 11L12 2l11 9"/><line x1="1" y1="22" x2="23" y2="22"/></svg></div>' +
                        '<div class="sr-mlabel">Bank transfer</div>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                  '<input type="hidden" id="ret-mode" value="Cash Refund">' +
                  '<div class="sr-fl" id="ret-cashpaid-wrap">' +
                    '<span class="sr-fl-label" id="ret-cashpaid-hint">Cash / transfer amount to customer</span>' +
                    '<div class="sr-cur-wrap">' +
                      '<span class="sr-cur-sym">\u20a8</span>' +
                      '<input type="number" class="cur" id="ret-cashpaid" min="0" step="0.01" placeholder="0.00" oninput="this.dataset.userEdited=1;ERP.sales._retCalcSummary()">' +
                    '</div>' +
                    '<div class="sr-split-info" id="ret-cashpaid-note" style="display:none"></div>' +
                  '</div>' +
                  '<div class="sr-fl">' +
                    '<span class="sr-fl-label">Return reason</span>' +
                    '<select id="ret-reason">' +
                      '<option value="">Reason select karein...</option>' +
                      '<option>Wrong item delivered</option>' +
                      '<option>Defective / damaged product</option>' +
                      '<option>Customer changed mind</option>' +
                      '<option>Excess quantity ordered</option>' +
                    '</select>' +
                  '</div>' +
                  '<div class="sr-fl">' +
                    '<span class="sr-fl-label">Internal note (optional)</span>' +
                    '<textarea id="ret-note" rows="2" placeholder="Note darj karein..." style="resize:none"></textarea>' +
                  '</div>' +
                '</div>' +
              '</div>' +

            '</div>' +

            '<div class="sr-right">' +

              '<div class="sr-sum-section">' +
                '<div class="sr-sum-title">Return summary</div>' +
                '<div class="sr-type-chip">' +
                  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>' +
                  '<span id="ret-return-type">Partial return</span>' +
                '</div>' +
                '<div class="sr-srow">' +
                  '<span class="sr-srow-l">Items returned</span>' +
                  '<span class="sr-srow-v p" id="sum-items">0 items</span>' +
                '</div>' +
                '<div class="sr-srow">' +
                  '<span class="sr-srow-l">Return value</span>' +
                  '<span class="sr-srow-v" id="sum-val">\u2014</span>' +
                '</div>' +
                '<div class="sr-srow" id="row-cash">' +
                  '<span class="sr-srow-l">Cash to customer</span>' +
                  '<span class="sr-srow-v g" id="sum-cash">\u2014</span>' +
                '</div>' +
                '<div class="sr-srow" id="row-credit" style="display:none">' +
                  '<span class="sr-srow-l">Store credit</span>' +
                  '<span class="sr-srow-v o" id="sum-credit">\u2014</span>' +
                '</div>' +
              '</div>' +

              '<div class="sr-cn-preview">' +
                '<div class="sr-cn-title">Credit note preview</div>' +
                '<div class="sr-cn-row"><span class="sr-cn-key">CN #</span><span class="sr-cn-val p">Auto-assigned</span></div>' +
                '<div class="sr-cn-row"><span class="sr-cn-key">Customer</span><span class="sr-cn-val" id="cn-cust">\u2014</span></div>' +
                '<div class="sr-cn-row"><span class="sr-cn-key">Against invoice</span><span class="sr-cn-val p" id="cn-inv">\u2014</span></div>' +
                '<div class="sr-cn-row"><span class="sr-cn-key">Date</span><span class="sr-cn-val" id="cn-date">' + _today() + '</span></div>' +
                '<div class="sr-cn-row"><span class="sr-cn-key">Amount</span><span class="sr-cn-val" id="cn-amt">\u2014</span></div>' +
              '</div>' +

              '<div class="sr-actions">' +
                '<button id="ret-ok" class="sr-btn-confirm" disabled onclick="ERP.sales._doReturn()">' +
                  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.95"/></svg>' +
                  'Confirm return' +
                '</button>' +
                '<button class="sr-btn-cancel" onclick="ERP.sales._closeReturnModal()">Cancel</button>' +
              '</div>' +

            '</div>' +

          '</div>' +

        '</div>' +
      '</div>';
    document.body.appendChild(el.firstElementChild);
  }

  function _closeReturnModal(){
    var m = document.getElementById('saleReturnModal');
    if(m){ m.style.display = 'none'; document.body.style.overflow = ''; }
    _doReturn._inProgress = false;
    _returnSnapshot = null;
  }

  function _openReturn(invId){
    _doReturn._inProgress = false;
    _returnSnapshot = null;
    _buildRetModal();
    var m = document.getElementById('saleReturnModal');
    if(m){ m.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
    _retSetMode('Cash Refund');
    var sel = document.getElementById('ret-id');
    if(sel && invId){ sel.value = invId; setTimeout(_lookupRet, 80); }
  }

  function _retSetMode(mode){
    var inp = document.getElementById('ret-mode');
    if(inp) inp.value = mode;
    var map = { 'Cash Refund':'ret-mb-cash', 'Store Credit':'ret-mb-store', 'Bank Transfer':'ret-mb-bank' };
    Object.keys(map).forEach(function(m){
      var btn = document.getElementById(map[m]);
      if(!btn) return;
      btn.classList.toggle('on', m === mode);
    });
    var cpWrap = document.getElementById('ret-cashpaid-wrap');
    var cpHint  = document.getElementById('ret-cashpaid-hint');
    if(cpWrap){
      var showCash = (mode === 'Cash Refund' || mode === 'Bank Transfer');
      cpWrap.style.display = showCash ? 'block' : 'none';
      if(showCash && cpHint){
        cpHint.textContent = mode === 'Bank Transfer'
          ? 'Bank mein transfer ki gai amount darj karein'
          : 'Cash / transfer amount to customer';
      }
      if(!showCash){
        var cpInp = document.getElementById('ret-cashpaid');
        if(cpInp){ cpInp.value = ''; delete cpInp.dataset.userEdited; }
      }
    }
    var kpiMode = document.getElementById('ret-kpi-mode');
    if(kpiMode) kpiMode.textContent = mode;
    _retCalcSummary();
  }

  function _lookupRet(){
    var id  = (document.getElementById('ret-id')||{}).value || '';
    var s   = Svc().sales.getAll().find(function(x){ return x.id===id && !x.deleted; });
    var wrap = document.getElementById('ret-items-wrap');
    var list = document.getElementById('ret-items-list');
    var info = document.getElementById('ret-inv-info');
    var cfg  = document.getElementById('ret-config-wrap');
    var sub  = document.getElementById('ret-header-sub');
    var rb   = document.getElementById('ret-ok');
    var step1 = document.getElementById('ret-step1-num');

    if(!s){
      if(wrap) wrap.style.display = 'none';
      if(info) info.style.display = 'none';
      if(cfg)  cfg.style.display  = 'none';
      if(rb){ rb.disabled=true; }
      if(sub) sub.textContent = 'MH Autos ERP \u00b7 Invoice select karein';
      if(step1){ step1.className='sr-snum'; step1.textContent='1'; }
      return;
    }
    if(s.status === 'returned'){
      if(list) list.innerHTML = '<div style="padding:14px;color:var(--danger);font-size:13px;font-weight:500">\u26a0\ufe0f This invoice has already been fully returned.</div>';
      if(wrap) wrap.style.display = 'block';
      if(rb){ rb.disabled=true; }
      return;
    }
    if(step1){ step1.className='sr-snum ok'; step1.innerHTML='<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'; }
    var grand = s.roundOff ? Math.round(Svc()._totals(s.items||[]).grand) : Svc()._totals(s.items||[]).grand;
    var bal   = Math.max(0, grand - (s.paid||0));
    if(info){
      info.style.display = 'block';
      var idLbl   = document.getElementById('ret-inv-id-lbl');
      var custLbl = document.getElementById('ret-inv-cust-lbl');
      var totLbl  = document.getElementById('ret-inv-total');
      var paidLbl = document.getElementById('ret-inv-paid');
      var balLbl  = document.getElementById('ret-inv-bal');
      if(idLbl)   idLbl.textContent   = s.id;
      if(custLbl) custLbl.textContent = _esc(s.customer||'') + ' \u00b7 ' + _esc(s.date||'');
      if(totLbl)  totLbl.textContent  = _fmt(grand);
      if(paidLbl) paidLbl.textContent = _fmt(s.paid||0);
      if(balLbl)  balLbl.textContent  = _fmt(bal);
    }
    if(sub) sub.textContent = 'MH Autos ERP \u00b7 ' + s.id + ' \u2014 ' + (s.customer||'');
    var cnCust = document.getElementById('cn-cust');
    var cnInv  = document.getElementById('cn-inv');
    if(cnCust) cnCust.textContent = s.customer||'';
    if(cnInv)  cnInv.textContent  = s.id;
    var prevRet = Svc().ret.getAll().filter(function(r){ return r.originalInv === id; });
    var alreadyRetQty = {};
    prevRet.forEach(function(r){
      (r.items||[]).forEach(function(ri){ var k=(ri.n||'').toLowerCase(); alreadyRetQty[k]=(alreadyRetQty[k]||0)+(ri.q||0); });
    });
    var rows = (s.items||[]).map(function(item, idx){
      var key = (item.n||'').toLowerCase();
      var alreadyRet = alreadyRetQty[key] || 0;
      var maxRet = Math.max(0, item.q - alreadyRet);
      var lineTotal = Svc()._totals([item]).grand;
      if(maxRet === 0){
        return '<div class="sr-item dimmed">' +
          '<div class="sr-chk"></div>' +
          '<div style="flex:1"><div class="sr-iname">' + _esc(item.n||'') + '</div>' +
          '<div class="sr-imeta"><span class="sr-prev-badge">Fully Returned</span></div></div>' +
          '<div style="text-align:right"><div class="sr-ipr">' + _fmt(lineTotal) + '</div></div>' +
          '</div>';
      }
      var prevBadge = alreadyRet > 0 ? '<span class="sr-prev-badge">' + alreadyRet + ' prev. returned</span>' : '';
      return '<div class="sr-item">' +
        '<div class="sr-chk on" data-chk-idx="' + idx + '" onclick="ERP.sales._retToggleItem(this,' + idx + ')">' +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' +
        '</div>' +
        '<div style="flex:1">' +
          '<div class="sr-iname">' + _esc(item.n||'') + '</div>' +
          '<div class="sr-imeta">' + _fmt(item.p||0) + ' &times; ' + prevBadge + '</div>' +
        '</div>' +
        '<div style="text-align:right">' +
          '<div class="sr-qty-row" style="justify-content:flex-end;margin-bottom:4px">' +
            '<button class="sr-qb" onclick="ERP.sales._retAdjQty(this,-1,' + idx + ',' + maxRet + ')" aria-label="decrease">\u2212</button>' +
            '<span class="sr-qv" id="ret-qv-' + idx + '" data-ret-item="' + idx + '" data-max-ret="' + maxRet + '">' + maxRet + '</span>' +
            '<button class="sr-qb" onclick="ERP.sales._retAdjQty(this,1,' + idx + ',' + maxRet + ')" aria-label="increase">+</button>' +
          '</div>' +
          '<div class="sr-ipr" id="ret-ipr-' + idx + '">' + _fmt(lineTotal) + '</div>' +
          '<div class="sr-ipr-sub">max: ' + maxRet + '</div>' +
        '</div>' +
        '</div>';
    }).join('');

    if(list) list.innerHTML = rows || '<div style="padding:14px;color:var(--gray-l);font-size:13px">No returnable items</div>';
    if(wrap) wrap.style.display = 'block';
    if(cfg)  cfg.style.display  = 'block';
    var _cpReset = document.getElementById('ret-cashpaid'); if(_cpReset){ _cpReset.value = ''; delete _cpReset.dataset.userEdited; }
    _retCalcSummary();
  }

  function _retToggleItem(el, idx){
    el.classList.toggle('on');
    if(el.classList.contains('on')){
      el.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
    } else {
      el.innerHTML = '';
    }
    _retCalcSummary();
  }

  function _retAdjQty(btn, delta, idx, maxRet){
    var span = document.getElementById('ret-qv-' + idx);
    if(!span) return;
    var cur = parseInt(span.textContent) || 1;
    var nv  = Math.max(1, Math.min(maxRet, cur + delta));
    span.textContent = nv;
    var id  = (document.getElementById('ret-id')||{}).value || '';
    var s   = Svc().sales.getAll().find(function(x){ return x.id===id && !x.deleted; });
    if(s && s.items && s.items[idx]){
      var item = s.items[idx];
      var origQ = item.q || 1;
      var lineTotal = Svc()._totals([{ n:item.n, q:nv, p:item.p||0, d:(item.d||0)*(nv/origQ), taxAmt:(item.taxAmt||0)*(nv/origQ) }]).grand;
      var ipr = document.getElementById('ret-ipr-' + idx);
      if(ipr) ipr.textContent = _fmt(lineTotal);
    }
    _retCalcSummary();
  }

  function _retSelectAll(){
    document.querySelectorAll('[data-chk-idx]').forEach(function(el){
      if(!el.classList.contains('on')){
        el.classList.add('on');
        el.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
      }
    });
    _retCalcSummary();
  }

  function _retCalcSummary(){
    var id = (document.getElementById('ret-id')||{}).value || '';
    var s  = Svc().sales.getAll().find(function(x){ return x.id===id && !x.deleted; });
    if(!s) return;
    var mode  = (document.getElementById('ret-mode')||{}).value || 'Cash Refund';
    var rb    = document.getElementById('ret-ok');
    var cpInp = document.getElementById('ret-cashpaid');

    var checkedItems = [];
    document.querySelectorAll('[data-chk-idx]').forEach(function(el){
      if(!el.classList.contains('on')) return;
      var idx = parseInt(el.getAttribute('data-chk-idx'), 10);
      var origItem = (s.items||[])[idx];
      if(!origItem) return;
      var qvSpan = document.getElementById('ret-qv-' + idx);
      var maxRet = parseInt((qvSpan && qvSpan.getAttribute('data-max-ret')) || origItem.q, 10);
      var retQty = Math.min(maxRet, Math.max(0, parseInt(qvSpan && qvSpan.textContent) || maxRet));
      if(retQty > 0) checkedItems.push({ n:origItem.n, q:retQty, p:origItem.p, d:(origItem.d||0)*(retQty/origItem.q), taxAmt:(origItem.taxAmt||0)*(retQty/origItem.q) });
    });

    var selCount = document.getElementById('ret-sel-count');
    var totalItems = document.querySelectorAll('[data-chk-idx]').length;
    if(selCount) selCount.textContent = checkedItems.length + ' of ' + totalItems + ' selected';

    var step2 = document.getElementById('ret-step2-num');
    if(step2 && checkedItems.length > 0){
      step2.className='sr-snum ok';
      step2.innerHTML='<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
    } else if(step2){
      step2.className='sr-snum'; step2.textContent='2';
    }

    if(!checkedItems.length){
      if(rb){ rb.disabled=true; }
      document.getElementById('sum-val') && (document.getElementById('sum-val').textContent = '\u2014');
      document.getElementById('sum-items') && (document.getElementById('sum-items').textContent = '0 items');
      document.getElementById('cn-amt') && (document.getElementById('cn-amt').textContent = '\u2014');
      document.getElementById('ret-kpi-val') && (document.getElementById('ret-kpi-val').textContent = '\u2014');
      document.getElementById('ret-kpi-items') && (document.getElementById('ret-kpi-items').textContent = '0');
      return;
    }

    var previewRes = Svc().saleReturn.buildReturn(id, { returnItems: checkedItems.map(function(i){ return {n:i.n,q:i.q}; }) });
    if(!previewRes.success){ if(rb){ rb.disabled=true; } return; }
    var d = previewRes.data;
    var returnGrand = d.returnGrand;
    var refundCalc  = d.amount;
    var isPartial   = !d.allReturned;
    var showCash    = (mode === 'Cash Refund' || mode === 'Bank Transfer');
    var cashPaid    = 0;
    if(showCash && cpInp){
      if(!cpInp.dataset.userEdited || parseFloat(cpInp.value) === 0){
        cpInp.value = refundCalc > 0 ? refundCalc.toFixed(2) : '0.00';
      }
      cashPaid = Math.min(Math.max(0, parseFloat(cpInp.value)||0), returnGrand);
    }
    var creditToCustomer = returnGrand - cashPaid;

    var sumItems    = document.getElementById('sum-items');
    var sumVal      = document.getElementById('sum-val');
    var sumCash     = document.getElementById('sum-cash');
    var sumCredit   = document.getElementById('sum-credit');
    var rowCash     = document.getElementById('row-cash');
    var rowCredit   = document.getElementById('row-credit');
    var retType     = document.getElementById('ret-return-type');
    var cnAmt       = document.getElementById('cn-amt');
    var splitInfo   = document.getElementById('ret-cashpaid-note');
    var kpiVal      = document.getElementById('ret-kpi-val');
    var kpiItems    = document.getElementById('ret-kpi-items');
    var step3       = document.getElementById('ret-step3-num');

    var totalQty = checkedItems.reduce(function(s,i){ return s+i.q; }, 0);
    if(sumItems)  sumItems.textContent  = totalQty + ' item' + (totalQty>1?'s':'');
    if(sumVal)    sumVal.textContent    = _fmt(returnGrand);
    if(cnAmt)     cnAmt.textContent     = _fmt(returnGrand);
    if(kpiVal)    kpiVal.textContent    = _fmt(returnGrand);
    if(kpiItems)  kpiItems.textContent  = String(checkedItems.length);
    if(retType)   retType.textContent   = isPartial ? 'Partial return' : 'Full return';

    if(mode === 'Store Credit'){
      if(rowCash)   rowCash.style.display   = 'none';
      if(rowCredit){ rowCredit.style.display='flex'; if(sumCredit) sumCredit.textContent=_fmt(returnGrand); }
    } else {
      if(rowCash){  rowCash.style.display='flex'; if(sumCash) sumCash.textContent=_fmt(cashPaid); }
      if(creditToCustomer > 0.005){
        if(rowCredit){ rowCredit.style.display='flex'; if(sumCredit) sumCredit.textContent=_fmt(creditToCustomer); }
        if(splitInfo){ splitInfo.style.display='block'; splitInfo.textContent='Remaining ' + _fmt(creditToCustomer) + ' store credit issue hogi.'; }
      } else {
        if(rowCredit) rowCredit.style.display = 'none';
        if(splitInfo) splitInfo.style.display = 'none';
      }
    }

    if(step3){ step3.className='sr-snum ok'; step3.innerHTML='<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'; }
    if(rb){ rb.disabled=false; }
  }

  function _doReturn(){
    if(_doReturn._inProgress){ if(window.DEBUG_MODE) console.warn('[_doReturn] reentrancy blocked'); return; }
    _doReturn._inProgress = true;
    var _retBtn = document.getElementById('ret-ok');
    if(_retBtn){
      if(_retBtn.getAttribute('data-saving')==='1'){ _doReturn._inProgress=false; return; }
      _retBtn.setAttribute('data-saving','1'); _retBtn.disabled=true; _retBtn.style.opacity='0.5';
      _retBtn.textContent = '⏳ Processing…';
    }
    function _restoreRetBtn(){
      _doReturn._inProgress = false;
      if(_retBtn){
        _retBtn.removeAttribute('data-saving'); _retBtn.disabled=false;
        _retBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.95"/></svg> Confirm return';
      }
    }

    var id          = (document.getElementById('ret-id')||{}).value || '';
    var _snapReason = (document.getElementById('ret-reason')||{}).value || '';
    var _snapMode   = (document.getElementById('ret-mode')||{}).value || 'Cash Refund';
    var _cpInp      = document.getElementById('ret-cashpaid');
    var _showCash   = (_snapMode === 'Cash Refund' || _snapMode === 'Bank Transfer');
    var _snapCashPaid = _showCash ? Math.max(0, parseFloat(_cpInp&&_cpInp.value)||0) : 0;

    var _snapItems = [];
    var _snapInv = Svc().sales.getAll().find(function(x){ return x.id===id && !x.deleted; });
    if(_snapInv){
      document.querySelectorAll('[data-chk-idx]').forEach(function(el){
        if(!el.classList.contains('on')) return;
        var idx = parseInt(el.getAttribute('data-chk-idx'), 10);
        var origItem = (_snapInv.items||[])[idx]; if(!origItem) return;
        var qvSpan = document.getElementById('ret-qv-' + idx);
        var maxRet = parseInt((qvSpan && qvSpan.getAttribute('data-max-ret')) || origItem.q, 10);
        var retQty = Math.min(maxRet, Math.max(0, parseInt(qvSpan && qvSpan.textContent) || maxRet));
        if(retQty > 0) _snapItems.push({ n:origItem.n, q:retQty, bc:origItem.barcode||origItem.bc||origItem.sku||'' });
      });
    }
    _returnSnapshot = { invoiceId:id, reason:_snapReason, mode:_snapMode, cashPaidOut:_snapCashPaid, returnItems:_snapItems };

    var s = Svc().sales.getAll().find(function(x){ return x.id===id && !x.deleted; });
    if(!s){ _restoreRetBtn(); return; }
    if(!_returnSnapshot.returnItems.length){ _toast('Please select at least one item to return','warning'); _restoreRetBtn(); return; }

    var buildRes = Svc().saleReturn.buildReturn(_returnSnapshot.invoiceId, {
      reason:      _returnSnapshot.reason,
      mode:        _returnSnapshot.mode,
      cashPaidOut: _returnSnapshot.cashPaidOut,
      returnItems: _returnSnapshot.returnItems
    });
    if(!buildRes.success){ _toast(buildRes.error,'error'); _restoreRetBtn(); return; }
    var d = buildRes.data;

    var actualCashOut = Math.min(_returnSnapshot.cashPaidOut, d.returnGrand);

    if(!confirm(
      'Confirm Return:\n' +
      (d.allReturned ? 'FULL RETURN' : 'PARTIAL RETURN') + ' — ' + _returnSnapshot.returnItems.length + ' item(s)\n' +
      'Return Value: ' + _fmt(d.returnGrand) + '\n' +
      (_showCash && actualCashOut > 0 ? 'Cash Paid Out: ' + _fmt(actualCashOut) + '\n' : '') +
      'Method: ' + _returnSnapshot.mode
    )){ _restoreRetBtn(); return; }

    var tx = _mkTx(_returnSnapshot.invoiceId, 'sales');
    if(ERP._walWrite) ERP._walWrite(tx.txId, 'saleReturn',
      ['restoreStock','updateInvoice','saveCN','postLedger','payOut'],
      { invoiceId:_returnSnapshot.invoiceId, cnId:d.ret.id });

    d.ret.cashPaidOut = actualCashOut;
    d.ret.mode        = _returnSnapshot.mode;

    _InventorySvc.restore(d.restoreItems, { sourceModule:'sales', documentId:_returnSnapshot.invoiceId, actor:tx.actor, skipGLBridge:true })
      .then(function(restoreRes){
        if(!restoreRes.success){
          _toast2('error','Return Failed','Stock restore failed',5000);
          _restoreRetBtn(); return;
        }

        var freshInv = Svc().sales.getAll().find(function(x){ return x.id===id && !x.deleted; });
        if(!freshInv){ _toast('Invoice not found','error'); _restoreRetBtn(); return; }

        var _retDeductPaisa = 0;
        var _salesPatch;
        if(d.allReturned){
          _retDeductPaisa = Math.round((freshInv.paid||0)*100);
          _salesPatch = { id:id, status:'returned', paid:0, remaining:0, updatedAt:_now() };
        } else {
          var origGrand = Svc()._totals(freshInv.items||[]).grand;
          if(freshInv.roundOff) origGrand = Math.round(origGrand);
          var keptValue = Math.round((origGrand - d.returnGrand)*100)/100;
          var refundAmt = d.refundAmount != null ? d.refundAmount : d.amount;
          if(refundAmt > (freshInv.paid||0) + 1) {
            refundAmt = freshInv.paid||0;
            _toast('\u26a0\ufe0f Refund amount capped to actual paid amount','warning',3500);
          }
          var newPaid   = Math.min(Math.max(0, Math.round(((freshInv.paid||0) - refundAmt)*100)/100), keptValue);
          var newRemaining = Math.max(0, Math.round((keptValue - newPaid)*100)/100);
          _retDeductPaisa = Math.round(refundAmt*100);
          var newStatus = newPaid >= keptValue ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';
          _salesPatch = { id:id, paid:newPaid, remaining:newRemaining, status:newStatus, updatedAt:_now() };
        }

        // Skip the return record itself if it's already been saved before (mirrors
        // the dedup check Svc().ret.add() used to do on its own, now folded in here
        // so the whole batch — including the invoice patch — stays consistent).
        var _existingRet = (d.ret.opKey && Svc().ret.getAll().find(function(x){ return x.opKey===d.ret.opKey; }))
                         || (d.ret.id && Svc().ret.getAll().find(function(x){ return x.id===d.ret.id; }));

        var _atomicSteps = [];
        _atomicSteps.push({ store:'sales', op:'patchMany', patches:[_salesPatch] });
        if(!_existingRet) _atomicSteps.push({ store:'saleReturns', op:'pushAll', records:[d.ret] });

        if(_retDeductPaisa > 0 && ERP._Allocator){
          var _rdRecord = { id:'RD-'+d.ret.id, paymentId:d.ret.id, invoiceId:id,
            amountAllocated:-(_retDeductPaisa/100), date:_today(), createdAt:_now(), _isReturnDeduction:true };
          _atomicSteps.push({ store:'paymentAllocations', op:'pushAll', records:[_rdRecord] });
        }

        var _retCNEntry = null, _retCustId = null;
        if(d.returnGrand > 0 && d.customer && ERP._Ledger){
          var _retCustRec = Svc().customers.getAll().find(function(c){
            return (c.n||c.name||'').toLowerCase() === d.customer.toLowerCase();
          });
          _retCustId = _retCustRec ? String(_retCustRec.id||_retCustRec.n) : d.customer;
          _retCNEntry = (ERP._Ledger.createSaleReturnEntry || ERP._Ledger.createInvoiceVoidEntry)(
            _retCustId, d.ret.id, d.returnGrand, _today()
          );
          if(_retCNEntry) _atomicSteps.push({ store:'customerLedger', op:'pushAll', records:[_retCNEntry] });
        }

        ERP._atomicSave(_atomicSteps, tx.txId).catch(function(e){
          console.error('[_doReturn] atomic return save failed:', e && e.message || e);
          _toast2('error','Return Not Saved','Stock was restored but the return record failed to save — everything was rolled back. Please retry.',7000);
        });

        if(actualCashOut > 0 && d.customer){
          try{
            var _cpoRec = Svc().customers.getAll().find(function(c){
              return (c.n||c.name||'').toLowerCase() === d.customer.toLowerCase();
            });
            var _cpoId = _cpoRec ? String(_cpoRec.id||_cpoRec.n) : d.customer;
            var cpoId = 'CPO-' + d.ret.id;
            ERP._atomicSave([{ store:'customerPayOut', op:'add', record:{
              id:cpoId, customer:d.customer, customerId:_cpoId,
              amount:actualCashOut, mode:_returnSnapshot.mode, date:_today(),
              notes:'Cash refund for return '+d.ret.id,
              linkedCN:d.ret.id, voided:false, createdAt:_now()
            }}]).catch(function(e){
              if(window.DEBUG_MODE) console.warn('[_doReturn] CPO save failed:', e && e.message || e);
            });
          }catch(cpoErr){
            if(window.DEBUG_MODE) console.warn('[_doReturn] CPO save failed:',cpoErr&&cpoErr.message);
          }
        }

        var _origInvForGL = Svc().sales.getAll().find(function(x) {
          return x.id === _returnSnapshot.invoiceId && !x.deleted;
        });

        var _ensurePosted = (window.ERP && ERP.SalesPostingLock && _origInvForGL &&
                             !ERP.SalesPostingLock.isPosted(_returnSnapshot.invoiceId))
          ? (function() {
              try { return ERP.SalesPostingLock.postSale(_origInvForGL) || Promise.resolve(); }
              catch(_e) { return Promise.resolve(); }
            }())
          : Promise.resolve();

        var _glReversal;
        if (window.ERP && ERP.PostingEngine) {
          _glReversal = Promise.resolve(_ensurePosted).then(function() {
            if (d.allReturned) {
              return ERP.PostingEngine.reverse(
                'SALE-REV-' + _returnSnapshot.invoiceId,
                { reason: 'Sale return (full): ' + d.ret.id + ' (by ' + tx.actor + ')', actor: 'system' }
              ).then(function() {
                if (ERP.PostingEngine.isPosted &&
                    ERP.PostingEngine.isPosted('SALE-COGS-' + _returnSnapshot.invoiceId)) {
                  return ERP.PostingEngine.reverse(
                    'SALE-COGS-' + _returnSnapshot.invoiceId,
                    { reason: 'Sale return COGS (full): ' + d.ret.id + ' (by ' + tx.actor + ')', actor: 'system' }
                  );
                }
                return Promise.resolve();
              });
            } else {
              var SA        = (window.ERP && ERP.accounting && ERP.accounting.constants) || {};
              var retPaisa  = Math.round(d.returnGrand * 100);
              var drRevAcct = SA.SALES_REV || 'acc-4001';
              var crArAcct  = (_origInvForGL && (_origInvForGL.pay || '').toLowerCase() === 'cash')
                ? (SA.CASH || 'acc-1001')
                : (SA.AR   || 'acc-1100');

              
              
              
              
              var totalCostPaisa = (d.ret.items || []).reduce(function(sum, it) {
                return sum + Math.round((it.q || 0) * (it.unitCostPaisa || 0));
              }, 0);

              var _pretEntries = [
                { accountId: drRevAcct, debit: retPaisa, credit: 0,
                  description: 'Revenue reduction: partial return ' + d.ret.id },
                { accountId: crArAcct,  debit: 0,        credit: retPaisa,
                  description: 'AR/Cash reduction: partial return ' + d.ret.id }
              ];

              if (totalCostPaisa > 0) {
                _pretEntries.push(
                  { accountId: SA.COGS || 'acc-5100', debit: 0, credit: totalCostPaisa,
                    description: 'COGS reversal: partial return ' + d.ret.id },
                  { accountId: SA.INVENTORY || 'acc-1200', debit: totalCostPaisa, credit: 0,
                    description: 'Inventory restored: partial return ' + d.ret.id }
                );
              } else if (window.DEBUG_MODE) {
                console.warn('[_doReturn] partial return ' + d.ret.id + ' has no unitCostPaisa on returned items — COGS reversal skipped, GL gross profit will be overstated for this return.');
              }

              return ERP.PostingEngine.post({
                documentId:   'SALE-PRET-' + d.ret.id,
                documentType: 'credit_note',
                sourceModule: 'sales_partial_return',
                memo:         'Partial return ' + d.ret.id + ' against ' + _returnSnapshot.invoiceId + ' (by ' + tx.actor + ')',
                actor:        'system',
                entries: _pretEntries
              }).catch(function(glPartialErr) {
                if (window.DEBUG_MODE) {
                  console.warn('[_doReturn] partial GL adjustment failed:',
                               glPartialErr && glPartialErr.message);
                }
              });
            }
          });
        } else {
          _glReversal = Promise.resolve();
        }

        _glReversal
          .then(function(){
            if(ERP._walUpdate) ERP._walUpdate(tx.txId, null, 'committed');
            _restoreRetBtn();
            if(_currentId===id||(_currentInv&&_currentInv.id===id)) _clearPreviewContext();
            _returnSnapshot = null;
            _closeReturnModal();
            _toast((d.allReturned?'Full':'Partial')+' return processed — Credit Note '+d.ret.id, 'success', 4000);
            UI().sales.render(); UI().ret.render();
            try{ if(ERP.dash&&ERP.dash.render) ERP.dash.render(); }catch(e){ if(window.DEBUG_MODE) console.error(e); }
          })
          .catch(function(glErr){
            ERP.AuditLog&&ERP.AuditLog.write({id:ERP.uid?ERP.uid():(_now()+Math.random()),txId:tx.txId,actor:tx.actor,action:'gl_reversal_failed',module:'sales',documentId:_returnSnapshot&&_returnSnapshot.invoiceId,before:null,after:null,timestamp:_now(),severity:'error'});
            if(ERP._walUpdate) ERP._walUpdate(tx.txId, null, 'partial');
            _restoreRetBtn();
            _toast2('error','GL Reversal Failed','Return saved but GL reversal failed — notify admin', 0);
          });
      }).catch(function(e){
        console.error('[_saveRet GL chain]', e);
        _toast2('error','Unexpected Error','Return processing hit an unexpected error — please refresh and verify the Credit Note.',6000);
      });
  }


  function _saveEst(){ var cust=(document.getElementById('est-cust')||{}).value||''; if(!cust.trim()){ _toast('Customer required','warning'); return; } var buildRes=Svc().estimate.buildEstimate({customer:cust,phone:(document.getElementById('est-ph')||{}).value||'',date:(document.getElementById('est-date')||{}).value||_today(),validTill:(document.getElementById('est-valid')||{}).value||'',notes:(document.getElementById('est-notes')||{}).value||'',items:_subData.est||[]}); if(!buildRes.success){ _toast(buildRes.error,'warning'); return; } _handleDbResult(Svc().est.add(buildRes.data.est),'est:add'); _cModal('estimateModal'); _toast('Estimate '+buildRes.data.est.id+' saved!','success',3000); UI().est.render(); }
  function _convEst(id){ var est=Svc().est.getAll().find(function(e){ return e.id===id; }); if(!est) return; var res=Svc().estimate.convertToInvoice(id); if(!res.success){ _toast(res.error,'error'); return; } _handleDbResult(Svc().sales.add(res.data.inv),'sales:add:fromEst'); _handleDbResult(Svc().est.update(id,{status:'approved',converted:true}),'est:update');
    _InventorySvc.deduct(res.data.inv.items,{sourceModule:'sales',documentId:res.data.inv.id,actor:(ERP.user&&ERP.user.name)||'system',skipGLBridge:true}).then(function(dRes){
      if(!dRes.success){
        Svc().sales.softDelete(res.data.inv.id,(ERP.user&&ERP.user.name)||'system','Stock deduction failed — conversion rolled back');
        Svc().est.update(id,{status:'pending',converted:false});
        _toast('Stock deduction failed — conversion rolled back: '+(dRes.error&&dRes.error.message||dRes.error||'unknown'),'error',6000);
        UI().est.render(); UI().sales.render();
        return;
      }
      try { if(window.ERP && ERP.SalesPostingLock && typeof ERP.SalesPostingLock.postSale === 'function') ERP.SalesPostingLock.postSale(res.data.inv); } catch(_glE){ if(window.DEBUG_MODE) console.warn('[_convEst] GL post failed:',_glE); }
      _toast('Converted to Invoice '+res.data.inv.id,'success',3000); UI().est.render(); UI().sales.render();
    }).catch(function(e){
      console.error('[_convEst]', e);
      _toast2('error','Unexpected Error','Estimate conversion hit an unexpected error — please refresh and verify.',6000);
    });
  }
  function _printEst(id){ var est=Svc().est.getAll().find(function(e){ return e.id===id; }); if(!est) return; _currentDocType='estimate'; _setPreviewContext(est); _currentId=null; ERP._salesBuildPrintModal(); _refreshPreview(); _oModal('invPrintModal'); }
  function _printPayIn(id){ var pi=Svc().payin.getAll().find(function(x){ return x.id===id; }); if(!pi){ _toast('Receipt not found','error'); return; } var biz=State().getBiz(); var html=Tmpl().buildReceiptHTML(pi,biz); var pw=window.open('','_blank','width=450,height=700,scrollbars=yes'); if(!pw){ _toast('Allow popups to print receipt','warning'); return; } pw.document.write(html); pw.document.close(); setTimeout(function(){ try{ pw.print(); }catch(e){ if(window.DEBUG_MODE) console.error(e); } },600); }
  function _printSO(id){ var so=Svc().so.getAll().find(function(o){ return o.id===id; }); if(!so) return; _currentDocType='so'; _setPreviewContext(so); _currentId=null; ERP._salesBuildPrintModal(); _refreshPreview(); _oModal('invPrintModal'); }
  function _printDoc(docObj,docType){ var biz=State().getBiz(); var html=docType==='so'?Tmpl().buildSOHTML(docObj,_currentTheme,'#0d9488',biz):Tmpl().buildEstimateHTML(docObj,_currentTheme,'#7c3aed',biz); var pw=window.open('','_blank'); if(!pw){ _toast('Pop-ups blocked','error'); return; } pw.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>'+(docType==='so'?'Sale Order':'Estimate')+' '+_esc(docObj.id||'')+'</title><style>body{margin:0;padding:16px;background:#94a3b8;font-family:system-ui,"Segoe UI",Arial,sans-serif}@media print{body{background:#fff;padding:0}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}</style></head><body>'+html+'</body></html>'); pw.document.close(); }

  function _saveSO(){ var cust=(document.getElementById('so-cust')||{}).value||''; if(!cust.trim()){ _toast('Customer required','warning'); return; } if(!(_subData.so||[]).filter(function(r){ return r.n&&r.n.trim(); }).length){ _toast('Please add at least one item','warning'); return; } var buildRes=Svc().saleOrder.buildSO({customer:cust,date:(document.getElementById('so-date')||{}).value||_today(),notes:(document.getElementById('so-notes')||{}).value||'',items:_subData.so||[]}); if(!buildRes.success){ _toast(buildRes.error,'warning'); return; } _handleDbResult(Svc().so.add(buildRes.data.so),'so:add'); _cModal('saleOrderModal'); _toast('Sale Order '+buildRes.data.so.id+' saved!','success',3000); UI().so.render(); }
  var _fulfillSO_inProgress = {};
  function _fulfillSO(id){
    // FIX (duplicate-invoice bug): previously nothing stopped a double-click
    // (or two rapid taps on mobile) from calling fulfill() twice for the
    // same Sale Order before the first call's status:'fulfilled' update had
    // landed — each call independently passed the (missing) status check,
    // creating two invoices and deducting stock twice from one order.
    if (_fulfillSO_inProgress[id]) { _toast('Fulfillment already in progress for '+id, 'warning', 3000); return; }
    _fulfillSO_inProgress[id] = true;
    var res=Svc().saleOrder.fulfill(id);
    if(!res.success){ _fulfillSO_inProgress[id] = false; _toast(res.error,'error',5000); return; }
    _handleDbResult(Svc().sales.add(res.data.inv),'sales:add:fromSO'); _handleDbResult(Svc().so.update(id,{status:'fulfilled',converted:true}),'so:update');
    _InventorySvc.deduct(res.data.deductItems,{sourceModule:'sales',documentId:res.data.inv.id,actor:(ERP.user&&ERP.user.name)||'system',skipGLBridge:true}).then(function(r){
      _fulfillSO_inProgress[id] = false;
      if(!r.success) {
        Svc().sales.softDelete(res.data.inv.id,(ERP.user&&ERP.user.name)||'system','Stock deduction failed — fulfillment rolled back');
        Svc().so.update(id,{status:'pending',converted:false});
        _toast('Stock deduction failed — fulfillment rolled back: '+(r.error&&r.error.message||r.error||'unknown'),'error',6000);
        UI().so.render(); UI().sales.render();
        return;
      }
      try { if(window.ERP && ERP.SalesPostingLock && typeof ERP.SalesPostingLock.postSale === 'function') ERP.SalesPostingLock.postSale(res.data.inv); } catch(_glE){ if(window.DEBUG_MODE) console.warn('[_fulfillSO] GL post failed:',_glE); }
      _toast('Fulfilled to Invoice '+res.data.inv.id,'success',3000); UI().so.render(); UI().sales.render();
    }).catch(function(e){
      _fulfillSO_inProgress[id] = false;
      console.error('[_fulfillSO]', e);
      _toast2('error','Unexpected Error','Sale Order fulfillment hit an unexpected error — please refresh and verify.',6000);
    });
  }

  function _payInInvSelected(){ var invId=(document.getElementById('pin-against')||{}).value||''; var info=document.getElementById('pin-inv-info'); var balDiv=document.getElementById('pin-bal-info'); if(!invId){ if(info){ info.style.display='none'; info.innerHTML=''; } if(balDiv) balDiv.style.display='none'; return; } var inv=Svc().sales.getAll().find(function(x){ return x.id===invId&&!x.deleted; }); if(!inv){ if(info) info.style.display='none'; return; } var partyInp=document.getElementById('pin-party'); if(partyInp&&!partyInp.value) partyInp.value=inv.customer||inv.cust||''; var grand=inv.roundOff?Math.round(Svc()._totals(inv.items||[]).grand):Svc()._totals(inv.items||[]).grand; var bal=Math.max(0,grand-(inv.paid||0)); var amtInp=document.getElementById('pin-amount'); if(amtInp&&(!amtInp.value||parseFloat(amtInp.value)===0)) amtInp.value=bal.toFixed(2); if(info){ info.style.display='block'; info.innerHTML='<b style="color:#1e3a5f">'+_esc(invId)+'</b> — <span>'+_esc(inv.customer||'')+'</span><br><span style="font-size:11px;color:#94a3b8">'+_esc(inv.date||'')+' · Total: '+_fmt(grand)+'</span><br><b style="color:'+(bal>0?'#dc2626':'#16a34a')+'">Balance: '+_fmt(bal)+'</b>'; } _payInCalcBal(); }
  function _payInCalcBal(){ var invId=(document.getElementById('pin-against')||{}).value||''; var balDiv=document.getElementById('pin-bal-info'); if(!invId||!balDiv){ if(balDiv) balDiv.style.display='none'; return; } var inv=Svc().sales.getAll().find(function(x){ return x.id===invId&&!x.deleted; }); if(!inv){ balDiv.style.display='none'; return; } var grand=inv.roundOff?Math.round(Svc()._totals(inv.items||[]).grand):Svc()._totals(inv.items||[]).grand; var entering=parseFloat((document.getElementById('pin-amount')||{}).value)||0; var remaining=Math.max(0,grand-(inv.paid||0)-entering); balDiv.style.display='block'; balDiv.textContent='After this payment — Balance: '+_fmt(remaining); }

  var _savePayIn_inProgress=false;
  function _savePayIn(){
    if(_savePayIn_inProgress) return; _savePayIn_inProgress=true;
    var payBtn=document.getElementById('pin-save-btn')||document.querySelector('[data-action="savePayIn"]');
    var _payOrigText=payBtn?payBtn.textContent:'Save';
    if(payBtn){ payBtn.setAttribute('data-saving','1'); payBtn.textContent='Saving...'; payBtn.disabled=true; }
    function _restorePayBtn(){ _savePayIn_inProgress=false; if(payBtn){ payBtn.removeAttribute('data-saving'); payBtn.textContent=_payOrigText; payBtn.disabled=false; } }
    var _asyncHandled=false;
    try{
      
      var _rawAmt = parseFloat((document.getElementById('pin-amount')||{}).value||0)||0;
      if(_rawAmt <= 0){ _restorePayBtn(); _toast('❌ Amount 0 se zyada hona chahiye','error'); return; }
      var buildRes=Svc().payIn.buildPayment({party:(document.getElementById('pin-party')||{}).value||'',amount:_rawAmt,mode:(document.getElementById('pin-mode')||{}).value||'Cash',date:(document.getElementById('pin-date')||{}).value||_today(),against:(document.getElementById('pin-against')||{}).value||'',notes:(document.getElementById('pin-notes')||{}).value||''});
      if(!buildRes.success){ _restorePayBtn(); _toast(buildRes.error,'warning'); return; }
      var pi=buildRes.data.pi; var custNmLc=(pi.party||'').toLowerCase(); var custObj=Svc().customers.getAll().find(function(c){ return (c.n||c.name||'').toLowerCase()===custNmLc; }); var custId=custObj?String(custObj.id||custObj.n):pi.party; pi.customerId=custId;
      var _piAddRes=Svc().payin.add(pi);
      if(_piAddRes&&_piAddRes.success===false){ _restorePayBtn(); _toast('Payment save failed — receipt could not be created. Please retry.','error',5000); return; }
      
      var _piLedgerEntry = ERP._Ledger && ERP._Ledger.createPaymentEntry(custId,pi.id,pi.amount,pi.date);
      var _allocParty=pi.party; if(pi.against){ var _hintInv=Svc().sales.getAll().find(function(x){ return x.id===pi.against&&!x.deleted; }); if(_hintInv&&_hintInv.customer) _allocParty=_hintInv.customer; } else if(custObj){ _allocParty=custObj.n||custObj.name||pi.party; }
      var result=ERP._Allocator.allocateFIFO(_allocParty,pi.amount,pi.id,pi.date,pi.against||'');
      var atomicStepsPI=[];
      if(_piLedgerEntry) atomicStepsPI.push({store:'customerLedger',op:'pushAll',records:[_piLedgerEntry]});
      if(result.allocations.length) atomicStepsPI.push({store:'paymentAllocations',op:'pushAll',records:result.allocations}); if(result.updatedInvoices.length) atomicStepsPI.push({store:'sales',op:'patchMany',patches:result.updatedInvoices.map(function(p){ return {id:p.id,paid:p.paid,remaining:p.remaining,status:p.status,updatedAt:_now()}; })}); if(result.unallocated>0) atomicStepsPI.push({store:'payIn',op:'patchMany',patches:[{id:pi.id,unallocatedAmount:result.unallocated}]});
      var _render=function(){ if(result.unallocated>0) _toast(_fmt(result.unallocated)+' credited as customer advance.','info',4000); _restorePayBtn(); _cModal('payInModal'); _toast('Receipt '+pi.id+' saved!','success',3000); UI().payin.render(); UI().sales.render();
        if(ERP.PostingEngine&&typeof ERP.PostingEngine.post==='function'){
          var SA2=(window.ERP && ERP.accounting && ERP.accounting.constants) || {};
          var isBank=(pi.mode==='Bank Transfer'||pi.mode==='Cheque');
          var debitAcct=isBank?(SA2.BANK||'acc-1002'):(SA2.CASH||'acc-1001');
          var totalPaisa=Math.round(pi.amount*100);
          var unallocPaisa=Math.round((result.unallocated||0)*100);
          var allocPaisa=Math.max(0,totalPaisa-unallocPaisa);
          var glEntries=[{accountId:debitAcct,debit:totalPaisa,credit:0,description:'Customer payment: '+pi.party}];
          if(allocPaisa>0) glEntries.push({accountId:(SA2.AR||'acc-1100'),debit:0,credit:allocPaisa,description:'AR cleared: '+pi.party});
          if(unallocPaisa>0) glEntries.push({accountId:(SA2.CUSTOMER_ADVANCE||'acc-2050'),debit:0,credit:unallocPaisa,description:'Customer advance (unallocated): '+pi.party});
          ERP.PostingEngine.post({documentId:'PAYIN-'+pi.id,documentType:'customer_payment',sourceModule:'sales',date:pi.date,reference:pi.id,memo:'Payment received: '+pi.party,party:pi.party,actor:'system',entries:glEntries}).catch(function(glErr){ if(window.DEBUG_MODE)console.warn('[_savePayIn] GL post failed:',glErr&&glErr.message); }); }
      };
      if(atomicStepsPI.length){
        _asyncHandled=true;
        ERP._atomicSave(atomicStepsPI)
          .then(function(res){
            if(!res||res.success===false){ _restorePayBtn(); _toast('Payment save failed — storage error. Please retry.','error',5000); return; }
            _render();
          })
          .catch(function(e){ _restorePayBtn(); _toast('Payment save failed: '+(e&&e.message||'Unknown error'),'error',5000); });
      } else { _render(); }
    }catch(e){ if(window.DEBUG_MODE) console.error('[_savePayIn]',e); _toast('Payment save failed.','error',5000); }
    finally{ if(!_asyncHandled) _restorePayBtn(); }
  }

  function _filterPayInTbl(q){ q=(q||'').toLowerCase(); var filtered=Svc().payin.getAll().filter(function(p){ return (p.party||'').toLowerCase().includes(q)||(p.id||'').toLowerCase().includes(q); }); var tb=document.getElementById('payin-tbody'); if(!tb) return; try{ tb.innerHTML=Tmpl().payinRowHTML?filtered.map(function(p){ return Tmpl().payinRowHTML(p); }).join(''):''; }catch(e){ if(window.DEBUG_MODE) console.error(e); } }

  function _openPayOutModal(presetCustomer,presetAmount){ var modal=document.createElement('div'); modal.id='customerPayOutModal'; modal.className='modal-bg'; modal.style.cssText='display:flex;align-items:center;justify-content:center;z-index:var(--zi-critical)'; var custOpts='<option value="">-- Select Customer --</option>'; var seen={}; (ERP._internal.getState().data.customers||[]).forEach(function(c){ var nm=c.n||c.name||''; if(!seen[nm]&&nm){ seen[nm]=true; custOpts+='<option value="'+_esc(nm)+'">'+_esc(nm)+'</option>'; } }); modal.innerHTML='<div class="modal" style="max-width:460px;width:96%"><div class="modal-head mh-purple"><span style="font-size:16px;font-weight:700;color:#fff">Customer Payment Out</span><button class="modal-x" onclick="document.getElementById(\'customerPayOutModal\').remove()" style="border-color:rgba(255,255,255,.3);color:#fff"><svg><use href="#ic-x"/></svg></button></div><div class="modal-body" style="padding:20px;display:flex;flex-direction:column;gap:14px"><div class="fgrp"><label for="cpo-customer">Customer</label><select class="fi" id="cpo-customer" onchange="ERP.sales._cpoOnCustChange()">'+custOpts+'</select></div><div class="fgrp"><label for="cpo-amount">Amount</label><input class="fi" type="number" id="cpo-amount" placeholder="0.00" min="0" step="0.01"></div><div class="fgrp"><label for="cpo-mode">Mode</label><select class="fi" id="cpo-mode"><option>Cash</option><option>Bank Transfer</option><option>Cheque</option><option>Online</option></select></div><div class="fgrp"><label for="cpo-date">Date</label><input class="fi" type="date" id="cpo-date" value="'+_today()+'"></div><div class="fgrp"><label for="cpo-notes">Notes</label><input class="fi" type="text" id="cpo-notes" placeholder="Refund reason..."></div><div style="background:var(--success-m);border:1px solid var(--success-l);border-radius:8px;padding:12px;display:flex;justify-content:space-between;align-items:center"><span style="font-size:12px;color:var(--success-d);font-weight:600">Customer Credit Balance</span><span id="cpo-bal-display" style="font-size:16px;font-weight:700;color:var(--success-d)">—</span></div></div><div class="modal-foot"><button class="btn btn-ghost" onclick="document.getElementById(\'customerPayOutModal\').remove()">Cancel</button><button class="btn btn-warning" style="font-weight:700" onclick="ERP.sales._savePayOut()">Save Refund</button></div></div>'; document.body.appendChild(modal); if(presetCustomer){ var cs=document.getElementById('cpo-customer'); if(cs){ cs.value=presetCustomer; _cpoOnCustChange(); } } if(presetAmount){ var am=document.getElementById('cpo-amount'); if(am) am.value=presetAmount; } }
  function _cpoOnCustChange(){ var cust=(document.getElementById('cpo-customer')||{}).value||''; var balEl=document.getElementById('cpo-bal-display'); if(!cust){ if(balEl) balEl.textContent='—'; return; } var custObj=(ERP._internal.getState().data.customers||[]).find(function(c){ return (c.n||c.name||'')===cust; }); var custId=custObj?String(custObj.id||custObj.n||cust):cust; var balance=ERP._Ledger?ERP._Ledger.getBalance(custId):0; if(balEl){ if(balance<0){ balEl.textContent=_fmt(Math.abs(balance))+' CR'; balEl.style.color='#7c3aed'; var amEl=document.getElementById('cpo-amount'); if(amEl&&!amEl.value) amEl.value=Math.abs(balance).toFixed(2); } else if(balance>0){ balEl.textContent=_fmt(balance)+' Dr'; balEl.style.color='#dc2626'; } else { balEl.textContent='Nil'; balEl.style.color='#94a3b8'; } } }
  function _cpoOnCNChange(){} function _cpoCalcBal(){}
  function _savePayOut(){ var customer=((document.getElementById('cpo-customer')||{}).value||'').trim(); var amtRaw=parseFloat((document.getElementById('cpo-amount')||{}).value||0); var mode=((document.getElementById('cpo-mode')||{}).value||'Cash').trim(); var date=((document.getElementById('cpo-date')||{}).value||_today()).trim(); var notes=((document.getElementById('cpo-notes')||{}).value||'').trim(); if(!customer){ _toast('Customer required!','warning'); return; } if(!amtRaw||amtRaw<=0){ _toast('Valid amount required!','warning'); return; } var amount=Math.round(amtRaw*100)/100; var custObj=(ERP._internal.getState().data.customers||[]).find(function(c){ return (c.n||c.name||'')===customer; }); var custId=custObj?String(custObj.id||custObj.n||customer):customer; var cpoId=Svc()._nextId(Svc().customerPayOut.getAll(),'CPO-'); var record={id:cpoId,customer:customer,customerId:custId,amount:amount,mode:mode,date:date,notes:notes,voided:false,createdAt:_now()}; var ledgerEntry=ERP._Ledger.createRefundEntry(custId,cpoId,amount,date); ERP._atomicSave([{store:'customerPayOut',op:'add',record:record},{store:'customerLedger',op:'pushAll',records:[ledgerEntry]}]).then(function(){ document.getElementById('customerPayOutModal')&&document.getElementById('customerPayOutModal').remove(); UI().sales.render(); _toast('Refund '+cpoId+' — '+_fmt(amount)+' saved for '+customer,'success',4000); }).catch(function(e){ _toast('Save failed: '+(e&&e.message||e),'error',5000); }); }
  function _voidPayOut(id){ var record=Svc().customerPayOut.getById(id); if(!record||record.voided){ _toast('Already voided or not found','warning'); return; } if(!confirm('Void CPO '+id+'?')) return; var custId=record.customerId||record.customer; var voidEntry=ERP._Ledger.createRefundVoidEntry(custId,id,record.amount,_today()); ERP._atomicSave([{store:'customerPayOut',op:'patchMany',patches:[{id:id,voided:true,voidedAt:_today()}]},{store:'customerLedger',op:'pushAll',records:[voidEntry]}]).then(function(){ UI().sales.render(); _toast('CPO '+id+' voided.','success',4000); }).catch(function(e){ _toast('Void failed: '+(e&&e.message||e),'error',5000); }); }
  function _filterPayOutTbl(q){ q=(q||'').toLowerCase(); var filtered=Svc().customerPayOut.getAll().filter(function(p){ return (p.customer||'').toLowerCase().includes(q)||(p.id||'').toLowerCase().includes(q); }); var tb=document.getElementById('cpayout-tbody'); if(!tb) return; try{ tb.innerHTML=Tmpl().payoutRowHTML?filtered.map(function(p){ return Tmpl().payoutRowHTML(p); }).join(''):''; }catch(e){ if(window.DEBUG_MODE) console.error(e); } }

  function _saveChallan(){ var cust=(document.getElementById('dc-cust')||{}).value||''; if(!cust.trim()){ _toast('Customer required','warning'); return; } if(!(_subData.dc||[]).filter(function(r){ return r.n&&r.n.trim(); }).length){ _toast('Please add at least one item','warning'); return; } var buildRes=Svc().challan.buildChallan({customer:cust,date:(document.getElementById('dc-date')||{}).value||_today(),addr:(document.getElementById('dc-addr')||{}).value||'',notes:(document.getElementById('dc-notes')||{}).value||'',items:_subData.dc||[]}); if(!buildRes.success){ _toast(buildRes.error,'warning'); return; } _handleDbResult(Svc().dc.add(buildRes.data.dc),'dc:add'); _cModal('challanModal'); _toast('Challan '+buildRes.data.dc.id+' saved!','success',3000); UI().dc.render(); }
  function _convChallan(id){
    
    var existingChallans = Svc().dc ? Svc().dc.getAll() : [];
    var challan = existingChallans.find(function(c){ return c.id === id; });
    if (challan && challan.converted) {
      _toast('Challan ' + id + ' already converted to invoice — double conversion prevented', 'warning', 4000);
      return;
    }
    var res=Svc().challan.convertToInvoice(id); if(!res.success){ _toast(res.error,'error'); return; } if(res.data.noPriceItems.length) _toast('No price for: '+res.data.noPriceItems.join(', '),'warning',3000); _handleDbResult(Svc().sales.add(res.data.inv),'sales:add:fromChallan'); _handleDbResult(Svc().dc.update(id,{converted:true}),'dc:update');
    _InventorySvc.deduct(res.data.inv.items,{sourceModule:'sales',documentId:res.data.inv.id,actor:(ERP.user&&ERP.user.name)||'system',skipGLBridge:true}).then(function(dRes){
      if(!dRes.success){
        Svc().sales.softDelete(res.data.inv.id,(ERP.user&&ERP.user.name)||'system','Stock deduction failed — conversion rolled back');
        Svc().dc.update(id,{converted:false});
        _toast('Stock deduction failed — conversion rolled back: '+(dRes.error&&dRes.error.message||dRes.error||'unknown'),'error',6000);
        UI().dc.render(); UI().sales.render();
        return;
      }
      try { if(window.ERP && ERP.SalesPostingLock && typeof ERP.SalesPostingLock.postSale === 'function') ERP.SalesPostingLock.postSale(res.data.inv); } catch(_glE){ if(window.DEBUG_MODE) console.warn('[_convChallan] GL post failed:',_glE); }
      _toast('Invoice '+res.data.inv.id+' created from Challan '+id,'success',3000); UI().dc.render(); UI().sales.render();
    }).catch(function(e){
      console.error('[_convChallan]', e);
      _toast2('error','Unexpected Error','Challan conversion hit an unexpected error — please refresh and verify.',6000);
    });
  }
  function _viewChallan(id){ var c=Svc().dc.getAll().find(function(x){ return x.id===id; }); if(!c) return; var ov=document.createElement('div'); ov.className='modal-bg open'; ov.innerHTML='<div class="modal"><div class="modal-head"><h2>Challan: '+_esc(c.id)+'</h2><button class="modal-x" onclick="this.closest(\'.modal-bg\').remove()"><svg><use href="#ic-x"/></svg></button></div><div class="modal-body"><div style="background:var(--bg,#f8fafc);border-radius:10px;padding:14px;margin-bottom:16px"><b>'+_esc(c.customer||'')+'</b><br><span style="font-size:12px;color:var(--muted,#64748b)">'+_esc(c.date||'')+(c.addr?' | '+_esc(c.addr):'')+'</span></div><table class="dt"><thead><tr><th>#</th><th>Item</th><th>Qty</th></tr></thead><tbody>'+(c.items||[]).map(function(item,i){ return '<tr><td>'+(i+1)+'</td><td>'+_esc(item.n||'')+'</td><td>'+item.q+'</td></tr>'; }).join('')+'</tbody></table></div><div style="display:flex;gap:8px;margin-top:14px"><button onclick="window.print()" class="btn btn-primary btn-sm">Print</button>'+(!c.converted?'<button onclick="ERP.sales._convChallan(\''+_esc(c.id)+'\');this.closest(\'.modal-bg\').remove()" class="btn btn-success btn-sm">Convert to Invoice</button>':'<span class="badge b-teal">Converted</span>')+'</div></div></div>'; document.body.appendChild(ov); }

  var _subData={est:[],so:[],dc:[]};
  function _subSyncFromDOM(prefix){ var data=_subData[prefix]||[]; for(var i=0;i<data.length;i++){ var nameInp=document.querySelector('[data-pfx="'+prefix+'"][data-idx="'+i+'"]'); var priceInp=document.getElementById(prefix+'-p-'+i); if(nameInp) data[i].n=nameInp.value||data[i].n; if(priceInp) data[i].p=parseFloat(priceInp.value)||data[i].p||0; } }
  function _subAddRow(prefix){ _subSyncFromDOM(prefix); _subData[prefix].push({n:'',q:1,p:0,hasPrice:prefix!=='dc'}); _subRefresh(prefix); setTimeout(function(){ var newIdx=_subData[prefix].length-1; var inp=document.querySelector('[data-pfx="'+prefix+'"][data-idx="'+newIdx+'"]'); if(inp) inp.focus(); },50); }
  function _subFillPriceEl(inp){ var prefix=inp.getAttribute('data-pfx')||''; var idx=parseInt(inp.getAttribute('data-idx'),10)||0; _subFillPrice(prefix,idx,inp); }
  function _subFillPrice(prefix,idx,inp){ var name=(inp.value||'').trim(); if(!_subData[prefix]) return; _subData[prefix][idx].n=name; var parts=ERP._salesParts?ERP._salesParts():[]; var lower=name.toLowerCase(); var part=null; for(var pi=0;pi<parts.length;pi++){ if((parts[pi].n||'').toLowerCase()===lower){ part=parts[pi]; break; } } if(part&&part.sp>0){ _subData[prefix][idx].p=part.sp; var priceInp=document.getElementById(prefix+'-p-'+idx); if(priceInp) priceInp.value=part.sp; } }
  function _subRefresh(prefix){ var wrap=document.getElementById(prefix+'-rows-wrap'); if(!wrap) return; var data=_subData[prefix]||[]; var hasPx=prefix!=='dc'; wrap.innerHTML='<div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;background:var(--white,#fff);margin-bottom:4px"><table class="dt" style="font-size:12px"><thead><tr><th style="width:32px">#</th><th>Item</th><th>Qty</th>'+(hasPx?'<th>Unit Price</th><th>Total</th>':'')+'<th style="width:32px"></th></tr></thead><tbody>'+data.map(function(r,i){ r.hasPrice=hasPx; return Tmpl().subRowHTML(prefix,i,r); }).join('')+'</tbody></table></div>'+ERP._salesInvDL(prefix); }

  var _filterTimers={};
  function _filterTable(q,pvId){ if(_filterTimers[pvId]) clearTimeout(_filterTimers[pvId]); _filterTimers[pvId]=setTimeout(function(){ q=(q||'').toLowerCase(); var tbody=document.querySelector('#'+pvId+' .dt tbody'); if(!tbody) return; var rows=tbody.querySelectorAll('tr'); for(var ri=0;ri<rows.length;ri++) rows[ri].style.display=rows[ri].textContent.toLowerCase().indexOf(q)>=0?'':'none'; },120); }

  function _openEstimateModal(){ if(ERP._salesBuildEstimateModal) ERP._salesBuildEstimateModal(); _subData.est=[{n:'',q:1,p:0,hasPrice:true}]; UI().est.render(); setTimeout(function(){ _subRefresh('est'); var d=document.getElementById('est-date'); if(d) d.value=_today();  var vd=new Date(); vd.setDate(vd.getDate()+30); var vi=document.getElementById('est-valid'); if(vi) vi.value=vd.getFullYear()+'-'+String(vd.getMonth()+1).padStart(2,'0')+'-'+String(vd.getDate()).padStart(2,'0'); _oModal('estimateModal'); },30); }
  function _openSOModal(){ if(ERP._salesBuildSOModal) ERP._salesBuildSOModal(); _subData.so=[{n:'',q:1,p:0,hasPrice:true}]; UI().so.render(); setTimeout(function(){ _subRefresh('so'); var d=document.getElementById('so-date'); if(d) d.value=_today(); _oModal('saleOrderModal'); },30); }
  function _openPayInModal(){ if(ERP._salesBuildPayInModal) ERP._salesBuildPayInModal(); UI().payin.render(); setTimeout(function(){ var d=document.getElementById('pin-date'); if(d) d.value=_today(); _oModal('payInModal'); },30); }
  function _openChallanModal(){ if(ERP._salesBuildChallanModal) ERP._salesBuildChallanModal(); _subData.dc=[{n:'',q:1,hasPrice:false}]; UI().dc.render(); setTimeout(function(){ _subRefresh('dc'); var d=document.getElementById('dc-date'); if(d) d.value=_today(); _oModal('challanModal'); },30); }

  // Single source of truth: ID generation for persisted business documents
  // (invoices, credit notes, etc.) lives in sales_service.js as Svc()._nextId,
  // which tracks in-flight IDs to avoid collisions on rapid/concurrent saves.
  // This file previously had its own weaker copy (no in-flight tracking) that
  // was actually used for a real persisted save (_savePayOut) — a genuine
  // collision risk on double-clicks. All call sites now use Svc()._nextId.

  window.renderSales=function(){ try{ UI().sales.render(); }catch(e){ if(window.DEBUG_MODE) console.error(e); } };
  if(ERP.registerRenderer){ ['sales','invoice'].forEach(function(k){ ERP.registerRenderer(k,function(){ UI().sales.render(); }); }); ERP.registerRenderer('estimates',function(){ UI().est.render(); }); ERP.registerRenderer('saleorders',function(){ UI().so.render(); }); ERP.registerRenderer('salereturns',function(){ UI().ret.render(); }); ERP.registerRenderer('payin',function(){ UI().payin.render(); }); ERP.registerRenderer('deliverychallan',function(){ UI().dc.render(); }); }

  ERP._salesZ={modal:1100,printModal:1150,partyModal:1200,overlay:1300};
  ERP.actions=ERP.actions||{};
  ERP.actions.sales={ openModal:_openInvModal, openEdit:_openEditModal, closeModal:_closeInvModal, render:function(){ UI().sales.render(); }, getAll:function(){ return Svc().sales.getAll(); } };

  ERP.sales={
    render:              function(list){ UI().sales.render(list); },
    search:(function(){ var _t=null; return function(q){ clearTimeout(_t); _t=setTimeout(function(){ UI().sales.render(Svc().sales.search(q)); },220); }; }()),
    filter:              function(st){ UI().sales.render(st==='all'?Svc().sales.getAll():Svc().sales.getAll().filter(function(x){ return x.status===st&&!x.deleted; })); },
    openAdd:             _openInvModal,
    openFromJob:         _openFromJob,
    _subFillPriceEl:     _subFillPriceEl,
    openEdit:            _openEditModal,
    closeModal:          _closeInvModal,
    view:                _openPreview,
    print:               function(id){ if(id){ _currentId=id; _openPreview(id); setTimeout(_printNow,500); } else _printNow(); },
    _setTheme:           _setTheme,
    _setColor:           _setColor,
    _printNow:           _printNow,
    _printThermal:       _printThermal,
    _downloadPDF:        _downloadPDF,
    _downloadImage:      _downloadImage,
    _waShare:            _waShare,
    _waFromList:         _waFromList,
    _printFromList:      _printFromList,
    _gmailShare:         _gmailShare,
    _smsShare:           _smsShare,
    _applyCreditTopup:   _applyCreditTopup,
    _forceSaveOverLimit: _forceSaveOverLimit,
    _clmChip:            _clmChip,
    _clmCalc:            _clmCalc,
    _calc:               _calc,
    _addRow:             _addRow,
    _delRow:             _delRow,
    _fillPrice:          _fillPrice,
    _updateBal:          _updateBal,
    _toggleRec:          _toggleRec,
    _toggleDesc:         _toggleDesc,
    _setCredit:          _setCredit,
    _setCash:            _setCash,
    _togglePay:          _togglePay,
    _updatePayType:      _updatePayType,
    _saveInv:            _saveInv,
    _retryPendingPayment: _retryPendingPayment,
    _openFormPreview:    _openFormPreview,
    _previewCurrent:     _openFormPreview,
    _formShare:          _formShare,
    _saveInlineCust:     _saveInlineCust,
    _refreshCustList:    _refreshCustList,
    _onImgUpload:        _onImgUpload,
    _clearImg:           _clearImg,
    _onDocUpload:        _onDocUpload,
    _clearDoc:           _clearDoc,
    _onQRUpload:         _onQRUpload,
    _clearQR:            _clearQR,
    _eInvMenu:           _eInvMenu,
    _shareMenu:          _shareMenu,
    _addPayType:         _addPayType,
    _onCustSelect:       _onCustSelect,
    get _currentId()     { return _currentId; },
    set _currentId(v)    { _currentId=v; },
    get _currentInv()    { return _currentInv; },
    set _currentInv(v)   { _currentInv=v; },
    _viewCreditNote:     _viewCreditNote,   
    _printCreditNote:    _printCreditNote,
    _printReceipt:       _printReceipt,
    _openReturn:         _openReturn,
    _closeReturnModal:   _closeReturnModal,
    _retSetMode:         _retSetMode,
    _lookupRet:          _lookupRet,
    _retSelectAll:       _retSelectAll,
    _retToggleItem:      _retToggleItem,
    _retAdjQty:          _retAdjQty,
    _retCalcSummary:     _retCalcSummary,
    _doReturn:           _doReturn,
    _filterRetByMode:    function(mode){
      var all = (ERP._salesSvc ? ERP._salesSvc.ret.getAll() : []);
      var filtered = mode ? all.filter(function(r){ return (r.mode||'').indexOf(mode) >= 0; }) : all;
      var tb = document.getElementById('ret-tbody');
      if(!tb) return;
      var tmpl = ERP._salesTemplates;
      tb.innerHTML = filtered.length
        ? filtered.map(function(r){ return tmpl.retRowHTML(r); }).join('')
        : '<tr><td colspan="10" style="text-align:center;padding:40px;color:#94a3b8">No returns found</td></tr>';
    },
    _filterRetTable:     function(q){
      q = (q||'').toLowerCase();
      var tb = document.getElementById('ret-tbody');
      if(!tb) return;
      var rows = tb.querySelectorAll('tr');
      rows.forEach(function(r){ r.style.display = r.textContent.toLowerCase().indexOf(q) >= 0 ? '' : 'none'; });
    },
    openEstimateModal:   _openEstimateModal,
    _saveEst:            _saveEst,
    _convEst:            _convEst,
    _printEst:           _printEst,
    _printSO:            _printSO,
    _printDoc:           _printDoc,
    openSaleOrderModal:  _openSOModal,
    _saveSO:             _saveSO,
    _fulfillSO:          _fulfillSO,
    openPayInModal:      _openPayInModal,
    _savePayIn:          _savePayIn,
    _payInInvSelected:   _payInInvSelected,
    _payInCalcBal:       _payInCalcBal,
    _printPayIn:         _printPayIn,
    _filterPayIn:        _filterPayInTbl,
    _filterPayInTbl:     _filterPayInTbl,
    openChallanModal:    _openChallanModal,
    _saveChallan:        _saveChallan,
    _convChallan:        _convChallan,
    _viewChallan:        _viewChallan,
    _filterTable:        _filterTable,
    _subData:            _subData,
    _subAddRow:          _subAddRow,
    _subSyncFromDOM:     _subSyncFromDOM,
    _subFillPrice:       _subFillPrice,
    _subRefresh:         _subRefresh,
    _deleteSaleUI:       _deleteSaleUI,
    _deleteEstUI:        _deleteEstUI,
    _deleteSOUI:         _deleteSOUI,
    _deletePayInUI:      _deletePayInUI,
    _deleteRetUI:        _deleteRetUI,
    _toast:              _toast,
    buildInvoiceHTML:    function(inv,theme,color){ return Tmpl().buildInvoiceHTML(inv,theme||_currentTheme,color||_currentColor,State().getBiz()); },
    buildThermalHTML:    function(inv){ return Tmpl().buildThermalHTML(inv,State().getBiz()); },
    openPayOutModal:     _openPayOutModal,
    _cpoOnCustChange:    _cpoOnCustChange,
    _cpoOnCNChange:      _cpoOnCNChange,
    _cpoCalcBal:         _cpoCalcBal,
    _savePayOut:         _savePayOut,
    _voidPayOut:         _voidPayOut,
    _filterPayOutTbl:    _filterPayOutTbl
  };

})(window.ERP=window.ERP||{});
