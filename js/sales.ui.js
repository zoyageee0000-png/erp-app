'use strict';
(function (ERP) {
  var Z = (function(){
    var s = getComputedStyle(document.documentElement);
    var zi = function(v,fb){ return parseInt(s.getPropertyValue(v))||fb; };
    return {
      modal:      zi('--zi-modal',    1010),
      printModal: zi('--zi-login',    1050) + 5,
      partyModal: zi('--zi-login',    1050) + 10,
      overlay:    zi('--zi-critical', 1100) + 10
    };
  })();
  function _svc()  { return ERP._salesSvc; }
  var _renderTimers = {};
  function _scheduleRender(key, fn, delay){
    if(_renderTimers[key]) clearTimeout(_renderTimers[key]);
    _renderTimers[key] = setTimeout(function(){
      delete _renderTimers[key];
      fn();
    }, delay || 16);
  }
  var _modalCache = {};
  function _getModal(id){
    if(_modalCache[id] && !document.body.contains(_modalCache[id])){
      delete _modalCache[id];
    }
    if(!_modalCache[id]){
      _modalCache[id] = document.getElementById(id);
    }
    return _modalCache[id];
  }
  function _tryStatUpdate(pv, total, paid, credit, overpaid, revenue){
    var tbody = pv.querySelector('.dt tbody');
    if(!tbody) return false;
    var rowCount = tbody.querySelectorAll('tr[data-inv-id]').length;
    if(rowCount !== total) return false;
    var vals = pv.querySelectorAll('.sc-val');
    if(vals.length < 1) return false;
    if(vals[0]) vals[0].textContent = total;
    if(vals[1]) vals[1].textContent = paid;
    if(vals[2]) vals[2].textContent = credit;
    if(vals[3]) vals[3].textContent = overpaid;
    if(vals[4]) vals[4].textContent = _fmt(isNaN(revenue) ? 0 : revenue);
    return true;
  }
  function _tmpl() { return ERP._salesTemplates || {}; }
  function _fmt(n) {
    var fn = (_tmpl().fmt) || function (v) {
      var num = (typeof v === 'number' && isFinite(v) && !isNaN(v)) ? v : 0;
      return 'Rs ' + Math.round(num * 100) / 100;
    };
    return fn(n);
  }
  function _esc(s){
    var fn = (ERP._salesTemplates && ERP._salesTemplates.esc)
      || function(v){ return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); };
    return fn(s);
  }
  function _today() { return ERP.DateUtils ? ERP.DateUtils.today() : (function(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })(); }
  function _toast(m,t,d){ if(ERP.ui&&ERP.ui.toast) ERP.ui.toast(m,t,d); else alert(m); }
  function _oModal(id)  { if(ERP.ui&&ERP.ui.openModal)  ERP.ui.openModal(id);  }
  function _cModal(id)  { if(ERP.ui&&ERP.ui.closeModal) ERP.ui.closeModal(id); }
  function _custDD(idPrefix, labelText){
    var custs = ERP._salesCusts ? ERP._salesCusts() : [];
    return '<div class="fgrp">' +
      '<label for="' + idPrefix + '">' + labelText + '</label>' +
      '<select class="fi" id="' + idPrefix + '" onchange="if(this.value===\'__add__\'){ERP.parties&&ERP.parties.openAdd?ERP.parties.openAdd(\'customer\'):null;this.value=\'\'}">' +
        '<option value="">Select Customer *</option>' +
        '<option value="__add__">+ Add New Customer</option>' +
        custs.map(function(c){
          var n = c.n || c.name || c.customer || '';
          return '<option value="' + _esc(n) + '">' + _esc(n) + '</option>';
        }).join('') +
      '</select>' +
    '</div>';
  }
  function _invDL(idPrefix){
    var parts = ERP._salesParts ? ERP._salesParts() : [];
    return '<datalist id="' + idPrefix + '-inv-dl">' +
      parts.map(function(p){ return '<option value="' + _esc(p.n||'') + '">'; }).join('') +
    '</datalist>';
  }
  function _refreshItemDatalist(){
    var dl = document.getElementById('sale-inv-datalist');
    if(!dl) return;
    var parts = ERP._salesParts ? ERP._salesParts() : [];
    var opts = '<option value="__add_item__">+ Add Item to Inventory</option>' +
      parts.map(function(p){ return '<option value="' + _esc(p.n||'') + '">'; }).join('');
    dl.innerHTML = opts;
  }
  var _printModalBuilt = false;
  function _buildCreditLimitModal(){
    if(document.getElementById('creditLimitModal')) return;
    var el = document.createElement('div');
    el.innerHTML =
      '<div id="creditLimitModal" class="modal-bg" style="z-index:' + Z.overlay + ';align-items:center;justify-content:center;padding:16px">' +
        '<div style="background:var(--white);border-radius:20px;width:100%;max-width:460px;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.22);overflow:hidden;font-family:inherit">' +
          '<div class="modal-head mh-red" style="padding:24px 28px 20px;position:relative">' +
            '<div style="display:flex;align-items:center;gap:14px">' +
              '<div style="width:48px;height:48px;background:rgba(255,255,255,.18);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">⚠️</div>' +
              '<div>' +
                '<div style="color:#fff;font-size:17px;font-weight:800;line-height:1.2">Credit Limit Exceeded</div>' +
                '<div style="color:rgba(255,255,255,.75);font-size:12px;margin-top:3px">Customer ka credit balance full ho gaya hai</div>' +
              '</div>' +
            '</div>' +
            '<button onclick="ERP.ui&&ERP.ui.closeModal&&ERP.ui.closeModal(\'creditLimitModal\')" ' +
              'style="position:absolute;top:14px;right:14px;width:28px;height:28px;background:rgba(255,255,255,.15);border:none;border-radius:8px;color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center">✕</button>' +
          '</div>' +
          '<div style="flex:1;overflow-y:auto;min-height:0">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:var(--border)">' +
            '<div style="background:var(--white);padding:16px 14px;text-align:center">' +
              '<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:6px">Credit Limit</div>' +
              '<div id="clm-limit" style="font-size:18px;font-weight:800;color:var(--text);font-family:monospace">—</div>' +
            '</div>' +
            '<div style="background:var(--white);padding:16px 14px;text-align:center">' +
              '<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:6px">Outstanding</div>' +
              '<div id="clm-outstanding" style="font-size:18px;font-weight:800;color:var(--danger);font-family:monospace">—</div>' +
            '</div>' +
            '<div style="background:var(--white);padding:16px 14px;text-align:center">' +
              '<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:6px">This Invoice</div>' +
              '<div id="clm-invoice" style="font-size:18px;font-weight:800;color:var(--warning);font-family:monospace">—</div>' +
            '</div>' +
          '</div>' +
          '<div style="padding:18px 24px 14px">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
              '<span style="font-size:12px;color:var(--muted);font-weight:600">Credit Used</span>' +
              '<span id="clm-pct" style="font-size:12px;font-weight:800;color:var(--danger)">—%</span>' +
            '</div>' +
            '<div style="height:8px;background:var(--hover);border-radius:99px;overflow:hidden">' +
              '<div id="clm-bar" style="height:100%;border-radius:99px;background:linear-gradient(90deg,var(--warning),var(--danger));transition:width .4s ease;width:0%"></div>' +
            '</div>' +
          '</div>' +
          '<div style="margin:0 24px 16px;background:var(--warning-m);border:1.5px solid var(--warning-l);border-radius:14px;padding:18px">' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">' +
              '<div style="width:28px;height:28px;background:var(--warning);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px">🔝</div>' +
              '<div style="font-size:13px;font-weight:800;color:var(--warning-d)">Credit Limit Increase</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--white);border-radius:10px;border:1px solid var(--warning-l);margin-bottom:8px">' +
              '<span style="font-size:12px;color:var(--muted);font-weight:600">Current Limit</span>' +
              '<span id="clm-cur-lmt" style="font-size:14px;font-weight:800;color:var(--text);font-family:monospace">—</span>' +
            '</div>' +
            '<div style="margin-bottom:8px">' +
              '<div style="font-size:11px;color:var(--warning-d);font-weight:700;margin-bottom:6px">Kitna Increase Karen (Rs.)</div>' +
              '<div style="display:flex;gap:8px">' +
                '<button onclick="ERP.sales._clmChip(10000)" style="padding:7px 10px;border:1.5px solid var(--warning-l);border-radius:8px;background:var(--white);font-size:12px;font-weight:700;color:var(--warning-d);cursor:pointer">+10K</button>' +
                '<button onclick="ERP.sales._clmChip(25000)" style="padding:7px 10px;border:1.5px solid var(--warning-l);border-radius:8px;background:var(--white);font-size:12px;font-weight:700;color:var(--warning-d);cursor:pointer">+25K</button>' +
                '<button onclick="ERP.sales._clmChip(50000)" style="padding:7px 10px;border:1.5px solid var(--warning-l);border-radius:8px;background:var(--white);font-size:12px;font-weight:700;color:var(--warning-d);cursor:pointer">+50K</button>' +
                '<button onclick="ERP.sales._clmChip(100000)" style="padding:7px 10px;border:1.5px solid var(--warning-l);border-radius:8px;background:var(--white);font-size:12px;font-weight:700;color:var(--warning-d);cursor:pointer">+1L</button>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;border:1.5px solid var(--warning-l);border-radius:10px;background:var(--white);overflow:hidden;margin-bottom:8px">' +
              '<span style="padding:11px 8px 11px 12px;font-size:13px;color:var(--muted);font-weight:700;white-space:nowrap;flex-shrink:0">+ Rs.</span>' +
              '<input id="clm-increase-val" type="number" min="0" step="1000" placeholder="Enter increase amount..." ' +
                'oninput="ERP.sales._clmCalc()" ' +
                'style="flex:1;min-width:0;padding:11px 12px 11px 4px;border:none;font-size:14px;font-weight:700;font-family:monospace;outline:none;background:transparent" ' +
                'onfocus="this.parentNode.style.borderColor=\'var(--warning)\'" onblur="this.parentNode.style.borderColor=\'var(--warning-l)\'">' +
            '</div>' +
            '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:linear-gradient(135deg,var(--success-m),var(--success-l));border-radius:10px;border:1px solid var(--success-l);margin-bottom:12px">' +
              '<div>' +
                '<div style="font-size:10px;color:var(--success-d);font-weight:700;text-transform:uppercase;letter-spacing:.5px">Nai Limit Hogi</div>' +
                '<div id="clm-new-lmt" style="font-size:20px;font-weight:900;color:var(--success-d);font-family:monospace">—</div>' +
              '</div>' +
              '<div style="text-align:right">' +
                '<div style="font-size:10px;color:var(--success-d);font-weight:700;text-transform:uppercase;letter-spacing:.5px">Invoice Allow Hogi</div>' +
                '<div id="clm-allow" style="font-size:13px;font-weight:700;color:var(--success)">—</div>' +
              '</div>' +
            '</div>' +
            '<button onclick="ERP.sales._applyCreditTopup()" ' +
              'style="width:100%;background:linear-gradient(135deg,var(--success),var(--success-d));color:#fff;border:none;padding:12px;border-radius:10px;font-size:14px;font-weight:800;cursor:pointer;letter-spacing:.3px">' +
              '✅ Limit Increase Karo &amp; Invoice Save Karo' +
            '</button>' +
          '</div>' +
          '</div>' +
          '<div style="display:flex;gap:10px;padding:14px 24px;border-top:1px solid var(--hover);flex-shrink:0">' +
            '<button onclick="ERP.ui&&ERP.ui.closeModal&&ERP.ui.closeModal(\'creditLimitModal\')" ' +
              'style="flex:1;padding:11px;border:1.5px solid var(--border);border-radius:10px;background:var(--white);color:var(--muted);font-size:13px;font-weight:700;cursor:pointer">Cancel</button>' +
            '<button onclick="ERP.sales._forceSaveOverLimit()" ' +
              'style="flex:1;padding:11px;border:none;border-radius:10px;background:var(--text);color:#fff;font-size:13px;font-weight:700;cursor:pointer">Save Anyway ›</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el.firstElementChild);
  }
  ERP._salesBuildCreditLimitModal = _buildCreditLimitModal;
    function _buildPrintModal(){
    if(document.getElementById('invPrintModal')) return;
    var colors  = [['#4338CA','Blue'],['#16a34a','Green'],['#7c3aed','Purple'],['#d97706','Orange'],['#dc2626','Red'],['#0d9488','Teal'],['#00d4ff','Cyan (Neon)'],['#f43f5e','Rose'],['#6366f1','Indigo']];
    var themes  = [['modern','Modern'],['classic','Classic'],['minimal','Minimal'],['corporate','Corporate'],['elegant','Elegant'],['neon','Neon'],['retro','Retro'],['pastel','Pastel'],['pro','Pro (Dark)']];
    var el = document.createElement('div');
    el.innerHTML =
      '<div id="invPrintModal" class="modal-bg" style="align-items:stretch;z-index:' + Z.printModal + '">' +
        '<div style="width:100%;height:100%;display:flex;flex-direction:column;background:#1e293b;border-radius:0">' +
          '<div style="background:#0f172a;padding:0 20px;height:52px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">' +
            '<div style="display:flex;align-items:center;gap:12px">' +
              '<span id="inv-modal-title" style="color:#fff;font-size:14px;font-weight:700">Invoice</span>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:10px">' +
              '<button onclick="ERP.sales._printNow()" style="background:#4338CA;color:#fff;border:none;padding:7px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">🖨️ Print</button>' +
              '<button onclick="ERP.sales._waShare()" class="btn btn-wa btn-sm">💬 WhatsApp</button>' +
              '<button onclick="ERP.ui&&ERP.ui.closeModal&&ERP.ui.closeModal(\'invPrintModal\');var im=document.getElementById(\'invModal\');if(im&&im._wasOpen)im.style.display=\'flex\'" style="width:32px;height:32px;background:rgba(255,255,255,.1);border:none;border-radius:6px;color:#94a3b8;font-size:18px;cursor:pointer">✕</button>' +
            '</div>' +
          '</div>' +
          '<div style="flex:1;overflow:hidden;display:flex">' +
            '<div style="width:140px;background:#0f172a;padding:12px 0;overflow-y:auto;flex-shrink:0;border-right:1px solid rgba(255,255,255,.06)">' +
              '<div style="padding:0 12px;margin-bottom:12px"><span style="font-size:9px;font-weight:700;color:#475569;letter-spacing:1px;text-transform:uppercase">SELECT THEME</span></div>' +
              '<div id="inv-theme-list">' +
                themes.map(function(t){
                  return '<button id="inv-tpl-' + t[0] + '" onclick="ERP.sales._setTheme(\'' + t[0] + '\')" style="display:block;width:100%;text-align:left;padding:9px 14px;background:none;border:none;color:#94a3b8;font-size:12px;cursor:pointer" onmouseover="this.style.color=\'#fff\'" onmouseout="this.style.color=\'#94a3b8\'">' + t[1] + '</button>';
                }).join('') +
              '</div>' +
              '<div style="padding:16px 12px 8px"><span style="font-size:9px;font-weight:700;color:#475569;letter-spacing:1px;text-transform:uppercase">SELECT COLOR</span></div>' +
              '<div style="padding:0 12px;display:flex;flex-direction:column;gap:8px" id="inv-color-list">' +
                colors.map(function(c){
                  return '<button onclick="ERP.sales._setColor(\'' + c[0] + '\')" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:6px 0;background:none;border:none;cursor:pointer" id="inv-clr-btn-' + c[0].replace('#','') + '">' +
                    '<div style="width:20px;height:20px;border-radius:50%;background:' + c[0] + ';flex-shrink:0;border:2px solid transparent" id="inv-clr-dot-' + c[0].replace('#','') + '"></div>' +
                    '<span style="font-size:11px;color:#94a3b8" id="inv-clr-lbl-' + c[0].replace('#','') + '">' + c[1] + '</span>' +
                  '</button>';
                }).join('') +
              '</div>' +
            '</div>' +
            '<div style="flex:1;overflow-y:auto;background:#94a3b8;padding:20px 28px;display:flex;justify-content:flex-start;align-items:flex-start" id="inv-preview-wrap">' +
              '<div id="inv-full-preview" style="width:100%;max-width:860px;box-shadow:0 8px 40px rgba(0,0,0,.25);border-radius:4px;overflow:visible;flex-shrink:0"></div>' +
            '</div>' +
            '<div style="width:220px;background:var(--white);overflow-y:auto;flex-shrink:0;border-left:1px solid var(--border)">' +
              '<div style="padding:16px;border-bottom:1px solid var(--hover)">' +
                '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:12px">Share Invoice</div>' +
                '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px">' +
                  [['ERP.sales._waShare()','💬','WhatsApp'],['ERP.sales._gmailShare()','📧','Gmail'],['ERP.sales._smsShare()','💌','Message'],
                   ['ERP.sales._downloadPDF()','⬇️','PDF'],['ERP.sales._downloadImage()','🖼️','Image'],['ERP.sales._printThermal()','🖨️','Thermal'],
                   ['ERP.sales._printNow()','🖨️','Print']].map(function(a){
                    return '<button onclick="' + a[0] + '" style="display:flex;flex-direction:column;align-items:center;gap:4px;background:none;border:1px solid var(--hover);border-radius:8px;padding:10px 6px;cursor:pointer"><span style="font-size:22px">' + a[1] + '</span><span style="font-size:10px;color:var(--muted)">' + a[2] + '</span></button>';
                  }).join('') +
                '</div>' +
              '</div>' +
              '<div style="padding:12px 16px;text-align:center">' +
                '<div style="font-size:11px;color:var(--gray-l)"><span id="inv-autosave-lbl">Auto-saved</span></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el.firstElementChild);
    _printModalBuilt = true;
  }
  function _buildInvModal(){
    if(document.getElementById('invModal')) return;
    var custs   = ERP._salesCusts ? ERP._salesCusts() : [];
    var parts   = ERP._salesParts ? ERP._salesParts() : [];
    var custOpts= custs.map(function(c){ return '<option value="' + _esc(c.n||c.name||'') + '">'; }).join('');
    var invOpts = parts.map(function(p){ return '<option value="' + _esc(p.n||'') + '">'; }).join('');
    var el = document.createElement('div');
    el.innerHTML =
      '<div id="invModal" style="display:none;position:fixed;inset:0;z-index:' + Z.modal + ';background:var(--bg);flex-direction:column;overflow:hidden;font-family:inherit">' +
        '<div style="background:var(--white);border-bottom:1px solid var(--border);padding:0 20px;height:52px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;box-shadow:0 1px 3px rgba(0,0,0,.05)">' +
          '<div style="display:flex;align-items:center;gap:16px">' +
            '<span id="vym-title" style="font-size:18px;font-weight:800;color:var(--text)">Sale</span>' +
            '<button id="vym-credit-btn" onclick="ERP.sales._setCredit()" style="color:var(--danger);font-size:13px;font-weight:700;background:none;border:none;cursor:pointer;padding:0">Credit</button>' +
            '<div id="vym-toggle" onclick="ERP.sales._togglePay()" style="width:40px;height:22px;background:var(--border);border-radius:11px;cursor:pointer;position:relative;transition:background .2s;flex-shrink:0" role="switch" aria-checked="false">' +
              '<div id="vym-thumb" style="position:absolute;top:3px;left:3px;width:16px;height:16px;background:var(--white,#fff);border-radius:50%;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.25)"></div>' +
            '</div>' +
            '<button id="vym-cash-btn" onclick="ERP.sales._setCash()" style="color:var(--muted);font-size:13px;font-weight:600;background:none;border:none;cursor:pointer;padding:0">Cash</button>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:12px">' +
            '<div style="display:flex;align-items:center;gap:6px"><label for="vym-inv-num" style="font-size:11px;color:var(--muted);white-space:nowrap">Invoice Number</label><input id="vym-inv-num" name="vym-inv-num" autocomplete="off" placeholder="Auto" style="border:1px solid var(--border);border-radius:6px;padding:5px 9px;font-size:12px;width:90px;outline:none;font-family:inherit;transition:border .15s;color:var(--primary);font-weight:600" onfocus="this.style.borderColor=\'var(--primary)\'" onblur="this.style.borderColor=\'var(--border)\'"></div>' +
            '<div style="display:flex;align-items:center;gap:6px"><label for="vym-date" style="font-size:11px;color:var(--muted);white-space:nowrap">Invoice Date</label><input type="date" id="vym-date" name="vym-date" autocomplete="off" style="border:1px solid var(--border);border-radius:6px;padding:5px 9px;font-size:12px;outline:none;font-family:inherit;transition:border .15s" onfocus="this.style.borderColor=\'var(--primary)\'" onblur="this.style.borderColor=\'var(--border)\'"></div>' +
            '<div style="display:flex;align-items:center;gap:6px"><label for="vym-state" style="font-size:11px;color:var(--muted);white-space:nowrap">State of supply</label><select id="vym-state" name="vym-state" autocomplete="off" style="border:1px solid var(--border);border-radius:6px;padding:5px 9px;font-size:12px;outline:none;background:var(--white);font-family:inherit"><option value="">Select</option><option>Punjab</option><option>Sindh</option><option>KPK</option><option>Balochistan</option><option>Islamabad</option></select></div>' +
            '<button onclick="ERP.sales.closeModal()" style="width:32px;height:32px;background:var(--danger-m);border:none;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--danger);font-size:16px;font-weight:700" onmouseover="this.style.background=\'var(--danger)\';this.style.color=\'#fff\'" onmouseout="this.style.background=\'var(--danger-m)\';this.style.color=\'var(--danger)\'">✕</button>' +
          '</div>' +
        '</div>' +
        '<div style="flex:1;overflow-y:auto;overflow-x:hidden;padding:14px 20px">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">' +
            '<div style="position:relative;width:240px;flex-shrink:0">' +
              '<select id="vym-cust-sel" style="width:100%;border:2px solid var(--primary);border-radius:8px;padding:9px 36px 9px 12px;font-size:13px;outline:none;background:var(--white);font-family:inherit;-webkit-appearance:none;cursor:pointer;color:var(--text)" onchange="ERP.sales._onCustSelect(this)" aria-label="Select Customer">' +
                '<option value="">Search by Name/Phone *</option>' +
                '<option value="__add__">+ Add New Customer</option>' +
                custOpts +
              '</select>' +
              '<svg style="position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none;width:10px;height:10px;fill:#94a3b8" viewBox="0 0 10 6"><path d="M0 0l5 6 5-6z"/></svg>' +
            '</div>' +
            '<input class="vym-fi" id="vym-ph" name="vym-ph" autocomplete="tel" placeholder="Phone No." style="border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:13px;outline:none;width:180px;flex-shrink:0;box-sizing:border-box;font-family:inherit;background:var(--white)" onfocus="this.style.borderColor=\'var(--primary)\'" onblur="this.style.borderColor=\'var(--border)\'">' +
          '</div>' +
          '<input type="hidden" id="vym-cust">' +
          '<div style="overflow-x:auto;border:1px solid var(--border);border-radius:10px;background:var(--white);margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.04)">' +
            '<table id="vym-table" style="width:100%;border-collapse:collapse;min-width:980px">' +
              '<thead style="background:var(--bg)"><tr style="border-bottom:2px solid var(--border)">' +
                '<th style="padding:9px 8px;font-size:10px;font-weight:700;color:var(--muted);text-align:center;width:30px">#</th>' +
                '<th style="padding:9px 8px;font-size:10px;font-weight:700;color:var(--muted);text-align:left">ITEM</th>' +
                '<th style="padding:9px 8px;font-size:10px;font-weight:700;color:var(--muted);text-align:left;width:80px">COLOUR</th>' +
                '<th style="padding:9px 8px;font-size:10px;font-weight:700;color:var(--muted);text-align:right;width:60px">QTY</th>' +
                '<th style="padding:9px 8px;font-size:10px;font-weight:700;color:var(--muted);width:80px">UNIT</th>' +
                '<th style="padding:9px 8px;font-size:10px;font-weight:700;color:var(--muted);text-align:center;width:100px"><div>PRICE/UNIT</div><div style="font-size:9px;font-weight:500;color:var(--primary);cursor:pointer" title="Toggle tax mode">Without Tax ↓</div></th>' +
                '<th colspan="2" style="padding:9px 8px;font-size:10px;font-weight:700;color:var(--muted);text-align:center">DISCOUNT<br><span style="font-size:8.5px;font-weight:400;color:var(--gray-l)">%&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;AMOUNT</span></th>' +
                '<th colspan="2" style="padding:9px 8px;font-size:10px;font-weight:700;color:var(--muted);text-align:center">TAX<br><span style="font-size:8.5px;font-weight:400;color:var(--gray-l)">%(Select ya Type)&nbsp;&nbsp;AMOUNT</span></th>' +
                '<th style="padding:9px 8px;font-size:10px;font-weight:700;color:var(--text);text-align:right;width:90px">AMOUNT</th>' +
                '<th style="padding:9px;width:36px"><button onclick="ERP.sales._addRow()" style="width:22px;height:22px;border-radius:50%;background:var(--primary);border:none;color:#fff;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center" aria-label="Add Row">+</button></th>' +
              '</tr></thead>' +
              '<tbody id="vym-items"></tbody>' +
              '<tfoot style="background:var(--bg);border-top:2px solid var(--border)">' +
                '<td style="padding:8px 6px;font-size:11px;color:var(--gray-l)"></td>' +
                '<td style="padding:8px 6px;font-size:11px;color:var(--gray-l)"></td>' +
                '<td style="padding:8px 6px;font-size:11px;color:var(--gray-l)"></td>' +
                '<td style="padding:8px 10px;font-size:11px;font-weight:700;color:var(--muted)">TOTAL</td>' +
                '<td style="padding:8px 6px"></td>' +
                '<td style="padding:8px;text-align:right;font-size:12px;font-weight:700;color:var(--text)" id="vym-ftotal">0</td>' +
                '<td style="padding:8px;text-align:right;font-size:11px;font-weight:700;color:var(--muted)" id="vym-fdisc">0.00</td>' +
                '<td style="padding:8px;text-align:right;font-size:11px;font-weight:700;color:var(--muted)" id="vym-fdisc-amt">0.00</td>' +
                '<td style="padding:8px 6px"></td>' +
                '<td style="padding:8px;text-align:right;font-size:11px;font-weight:700;color:var(--info)" id="vym-ftax">0.00</td>' +
                '<td style="padding:8px 10px;text-align:right;font-size:13px;font-weight:800;color:var(--text)" id="vym-famt">0.00</td>' +
                '<td></td>' +
              '</tfoot>' +
            '</table>' +
            '<datalist id="sale-inv-datalist"><option value="__add_item__">+ Add Item to Inventory</option>' + invOpts + '</datalist>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">' +
            '<div>' +
              '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:0px">' +
                '<div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;margin-bottom:10px;letter-spacing:.5px">Payment Type</div>' +
                '<select id="vym-pay-type" name="vym-pay-type" autocomplete="off" onchange="ERP.sales._updatePayType()" style="border:1.5px solid var(--border);border-radius:8px;padding:7px 32px 7px 12px;font-size:13px;outline:none;background:var(--white);font-family:inherit;min-width:140px;cursor:pointer;-webkit-appearance:none;appearance:none;background-image:url(\"data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'%2394a3b8\'/%3E%3C/svg%3E\");background-repeat:no-repeat;background-position:right 10px center" onfocus="this.style.borderColor=\'var(--primary)\'" onblur="this.style.borderColor=\'var(--border)\'" aria-label="Payment Type">' +
                  '<option>Credit</option><option>Cash</option><option>JazzCash</option><option>EasyPaisa</option><option>Bank Transfer</option><option>Cheque</option>' +
                '</select>' +
              '</div>' +
              '<button onclick="ERP.sales._addPayType&&ERP.sales._addPayType()" style="background:none;border:none;color:var(--primary);font-size:12px;font-weight:600;cursor:pointer;padding:8px 2px;text-align:left;display:block">+ Add Payment type</button>' +
              '<div id="vym-desc-wrap" style="display:none;margin-bottom:10px"><textarea id="vym-notes" name="vym-notes" rows="2" placeholder="Notes / terms…" style="width:100%;box-sizing:border-box;border:1.5px solid var(--border);border-radius:8px;padding:9px 12px;font-size:12px;outline:none;font-family:inherit;resize:vertical" onfocus="this.style.borderColor=\'var(--primary)\'" onblur="this.style.borderColor=\'var(--border)\'"></textarea></div>' +
              '<div style="display:flex;flex-direction:column;gap:6px">' +
                '<button onclick="ERP.sales._toggleDesc()" style="background:var(--white);border:1.5px dashed var(--border);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--muted);cursor:pointer;text-align:left;display:flex;align-items:center;gap:8px">📄 Add Notes / Terms</button>' +
                '<input type="file" id="_vymQRF" accept="image/*" style="display:none" onchange="ERP.sales._onQRUpload(this)">' +
                '<button onclick="document.getElementById(\'_vymQRF\').click()" style="background:var(--white);border:1.5px dashed var(--border);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--muted);cursor:pointer;text-align:left;display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box">📱 Override QR Code (this invoice only)</button>' +
                '<div id="_vymQRprev" style="display:none;margin-top:4px;padding:6px;background:var(--bg);border-radius:6px;border:1px solid var(--border);align-items:center;gap:8px">' +
                  '<img id="_vymQRImg" style="width:64px;height:64px;border-radius:4px;object-fit:contain">' +
                  '<span style="font-size:11px;color:var(--muted)">Invoice QR override</span>' +
                  '<button onclick="ERP.sales._clearQR()" style="background:none;border:none;color:var(--danger);font-size:11px;cursor:pointer">✕ Clear</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.05)">' +
              '<div style="display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:12px 16px;border-bottom:1px solid var(--hover)">' +
                '<input type="checkbox" id="vym-ro-chk" onchange="ERP.sales._calc()" style="width:15px;height:15px;accent-color:var(--primary);cursor:pointer" checked>' +
                '<label for="vym-ro-chk" style="font-size:13px;font-weight:500;color:var(--text);cursor:pointer;white-space:nowrap">Round Off</label>' +
                '<span style="font-size:11px;color:var(--gray-l);cursor:help" title="Rounds off to nearest whole number">ⓘ</span>' +
                '<span id="vym-ro-val" style="font-size:13px;color:var(--muted);font-family:monospace;min-width:40px;text-align:right">0.00</span>' +
                '<span style="font-size:13px;font-weight:700;color:var(--text);margin-left:8px">Total</span>' +
                '<span id="vym-grand" style="font-size:14px;font-weight:800;color:var(--text);font-family:monospace;border:1px solid var(--border);border-radius:6px;padding:4px 12px;min-width:80px;text-align:right;background:var(--bg)">0.00</span>' +
              '</div>' +
              '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--hover)">' +
                '<div style="display:flex;align-items:center;gap:8px">' +
                  '<input type="checkbox" id="vym-rec-chk" onchange="ERP.sales._toggleRec(this)" style="width:15px;height:15px;accent-color:var(--primary);cursor:pointer">' +
                  '<label for="vym-rec-chk" style="font-size:13px;font-weight:500;color:var(--text);cursor:pointer">Received</label>' +
                  '<span style="font-size:11px;color:var(--gray-l);cursor:help" title="Amount received from customer">ⓘ</span>' +
                '</div>' +
                '<input type="number" id="vym-rec-val" placeholder="0" style="border:1.5px solid var(--border);border-radius:6px;padding:4px 10px;font-size:14px;width:120px;text-align:right;outline:none;font-family:monospace;transition:border .15s;background:var(--white)" oninput="ERP.sales._updateBal()" onfocus="this.style.borderColor=\'var(--primary)\'" onblur="this.style.borderColor=\'var(--border)\'">' +
              '</div>' +
              '<div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px">' +
                '<span style="font-size:14px;font-weight:700;color:var(--text)">Balance</span>' +
                '<span id="vym-bal" style="font-size:20px;font-weight:800;color:var(--success);font-family:monospace">0.00</span>' +
              '</div>' +
              '<div style="display:none"><span id="vym-sub">0</span></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div style="background:var(--white);border-top:1px solid var(--border);padding:10px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">' +
          '<span style="font-size:11px;color:var(--gray-l);padding:5px 10px;border:1px dashed var(--border);border-radius:8px" title="e-Invoice - Coming Soon">e-Invoice (Coming Soon)</span>' +
          '<div style="display:flex;gap:8px">' +
            '<div style="display:flex;align-items:center;gap:0">' +
              '<button onclick="ERP.sales._openFormPreview()" style="background:var(--white);border:1.5px solid var(--border);padding:7px 14px;border-radius:8px 0 0 8px;font-size:13px;color:var(--muted);cursor:pointer;font-weight:600;border-right:none">Share</button>' +
              '<button onclick="ERP.sales._shareMenu(this)" style="background:var(--white);border:1.5px solid var(--border);padding:7px 10px;border-radius:0 8px 8px 0;font-size:12px;color:var(--muted);cursor:pointer">▾</button>' +
            '</div>' +
            '<button onclick="ERP.sales._saveInv()" style="background:var(--primary);color:#fff;border:none;padding:7px 28px;font-size:13px;font-weight:700;border-radius:8px;cursor:pointer;box-shadow:0 2px 8px rgba(27,79,140,.3)" onmouseover="this.style.background=\'var(--primary-d)\'" onmouseout="this.style.background=\'var(--primary)\'">Save</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el.firstElementChild);
  }
  var _estimateModalBuilt = false;
  function _buildEstimateModal(){
    if(document.getElementById('estimateModal')) return;
    var el = document.createElement('div');
    el.innerHTML =
      '<div id="estimateModal" class="modal-bg">' +
        '<div class="modal lg" style="max-height:90vh;display:flex;flex-direction:column">' +
          '<div class="modal-head" style="border-radius:16px 16px 0 0">' +
            '<div style="display:flex;align-items:center;gap:12px">' +
              '<div style="width:40px;height:40px;background:rgba(255,255,255,.2);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px">📋</div>' +
              '<div><h2 style="color:#fff;font-size:15px;margin:0;font-weight:700">New Estimate / Quotation</h2><p style="color:rgba(255,255,255,.7);font-size:11px;margin:0">Create a quote for customer approval</p></div>' +
            '</div>' +
            '<button class="modal-x" onclick="ERP.ui.closeModal(\'estimateModal\')" style="border-color:rgba(255,255,255,.3);color:#fff"><svg><use href="#ic-x"/></svg></button>' +
          '</div>' +
          '<div class="modal-body" style="overflow:auto;flex:1">' +
            '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:16px">' +
              _custDD('est-cust','Customer *') +
              '<div class="fgrp"><label for="est-ph">Phone</label><input class="fi" id="est-ph" placeholder="Phone"></div>' +
              '<div class="fgrp"><label for="est-date">Date</label><input class="fi" type="date" id="est-date"></div>' +
              '<div class="fgrp"><label for="est-valid">Valid Till</label><input class="fi" type="date" id="est-valid"></div>' +
            '</div>' +
            '<div id="est-rows-wrap" style="margin-bottom:8px"></div>' +
            '<button class="btn btn-ghost btn-sm" onclick="ERP.sales._subAddRow(\'est\')" style="margin-bottom:12px;border-style:dashed">+ Add Item</button>' +
            '<div class="fgrp"><label for="est-notes">Notes / Terms</label><textarea class="fi" id="est-notes" rows="2" placeholder="Terms and conditions…"></textarea></div>' +
          '</div>' +
          '<div class="modal-foot">' +
            '<button class="btn btn-ghost" onclick="ERP.ui.closeModal(\'estimateModal\')">Cancel</button>' +
            '<button class="btn btn-primary" onclick="ERP.sales._saveEst()" style="min-width:140px">💾 Save Estimate</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el.firstElementChild);
  }
  function _buildSOModal(){
    if(document.getElementById('saleOrderModal')) return;
    var el = document.createElement('div');
    el.innerHTML =
      '<div id="saleOrderModal" class="modal-bg">' +
        '<div class="modal lg" style="max-height:90vh;display:flex;flex-direction:column">' +
          '<div class="modal-head mh-cyan" style="border-radius:16px 16px 0 0">' +
            '<div style="display:flex;align-items:center;gap:12px">' +
              '<div style="width:40px;height:40px;background:rgba(255,255,255,.2);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px">📦</div>' +
              '<div><h2 style="color:#fff;font-size:15px;margin:0;font-weight:700">New Sale Order</h2><p style="color:rgba(255,255,255,.7);font-size:11px;margin:0">Create a confirmed sale order</p></div>' +
            '</div>' +
            '<button class="modal-x" onclick="ERP.ui.closeModal(\'saleOrderModal\')" style="border-color:rgba(255,255,255,.3);color:#fff"><svg><use href="#ic-x"/></svg></button>' +
          '</div>' +
          '<div class="modal-body" style="overflow:auto;flex:1">' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">' +
              _custDD('so-cust','Customer *') +
              '<div class="fgrp"><label for="so-date">Date</label><input class="fi" type="date" id="so-date"></div>' +
            '</div>' +
            '<div id="so-rows-wrap" style="margin-bottom:8px"></div>' +
            '<button class="btn btn-ghost btn-sm" onclick="ERP.sales._subAddRow(\'so\')" style="margin-bottom:12px;border-style:dashed">+ Add Item</button>' +
            '<div class="fgrp"><label for="so-notes">Notes</label><textarea class="fi" id="so-notes" rows="2" placeholder="Order notes…"></textarea></div>' +
          '</div>' +
          '<div class="modal-foot">' +
            '<button class="btn btn-ghost" onclick="ERP.ui.closeModal(\'saleOrderModal\')">Cancel</button>' +
            '<button class="btn btn-primary" onclick="ERP.sales._saveSO()" style="min-width:140px">💾 Save Order</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el.firstElementChild);
  }
  function _buildChallanModal(){
    if(document.getElementById('challanModal')) return;
    var el = document.createElement('div');
    el.innerHTML =
      '<div id="challanModal" class="modal-bg">' +
        '<div class="modal lg" style="max-height:90vh;display:flex;flex-direction:column">' +
          '<div class="modal-head mh-teal" style="border-radius:16px 16px 0 0">' +
            '<div style="display:flex;align-items:center;gap:12px">' +
              '<div style="width:40px;height:40px;background:rgba(255,255,255,.2);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px">🚚</div>' +
              '<div><h2 style="color:#fff;font-size:15px;margin:0;font-weight:700">New Delivery Challan</h2><p style="color:rgba(255,255,255,.7);font-size:11px;margin:0">Create a delivery note for goods dispatch</p></div>' +
            '</div>' +
            '<button class="modal-x" onclick="ERP.ui.closeModal(\'challanModal\')" style="border-color:rgba(255,255,255,.3);color:#fff"><svg><use href="#ic-x"/></svg></button>' +
          '</div>' +
          '<div class="modal-body" style="overflow:auto;flex:1">' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">' +
              _custDD('dc-cust','Customer *') +
              '<div class="fgrp"><label for="dc-date">Date</label><input class="fi" type="date" id="dc-date"></div>' +
            '</div>' +
            '<div class="fgrp" style="margin-bottom:14px"><label for="dc-addr">Delivery Address</label><input class="fi" id="dc-addr" placeholder="Full delivery address"></div>' +
            '<div id="dc-rows-wrap" style="margin-bottom:8px"></div>' +
            '<button class="btn btn-ghost btn-sm" onclick="ERP.sales._subAddRow(\'dc\')" style="margin-bottom:12px;border-style:dashed">+ Add Item</button>' +
            '<div class="fgrp"><label for="dc-notes">Notes</label><input class="fi" id="dc-notes" placeholder="Delivery notes…"></div>' +
          '</div>' +
          '<div class="modal-foot">' +
            '<button class="btn btn-ghost" onclick="ERP.ui.closeModal(\'challanModal\')">Cancel</button>' +
            '<button class="btn btn-info" onclick="ERP.sales._saveChallan()" style="min-width:140px">💾 Create Challan</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el.firstElementChild);
  }
  function _buildPayInModal(){
    var _existingPayIn = document.getElementById('payInModal');
    if(_existingPayIn) {
      var _sel = _existingPayIn.querySelector('#pin-against');
      if(_sel) {
        var _curVal = _sel.value;
        var _allSalesForModal = (_svc() ? _svc().sales.getAll() : []);
        try {
          var _knownInvJobIds = {};
          _allSalesForModal.forEach(function (s) { if (s.jobId) _knownInvJobIds[s.jobId] = true; });
          var _jobsArr = (function(){ try { if(window.JobState) return window.JobState.getAll(); } catch(_){ if(window.DEBUG_MODE) console.error(_); } return Array.isArray(window.jobs) ? window.jobs : []; })();
          var _orphanJobs = _jobsArr.filter(function (j) {
            return (j.status === 'completed' || j.status === 'delivered') &&
                   !j.invoiceId && !_knownInvJobIds[j.id];
          });
          if (_orphanJobs.length) {
            var _piToday = _today();
            var _stubs = _orphanJobs.map(function (j) {
              var _t = (j.parts||[]).reduce(function(s,p){ return s+(Number(p.q)||0)*(Number(p.p)||0); },0);
              var _llArr = Array.isArray(j.labourLines) ? j.labourLines : [];
              var _l = _llArr.length ? _llArr.reduce(function(s,ll){ return s+(Number(ll.amount)||0); },0) : (Number(j.lab)||0);
              _t = Math.max(0, _t + _l - (Number(j.dis)||0));
              var _pd = (Array.isArray(j.paymentHistory)?j.paymentHistory:[]).reduce(function(s,p){ return s+(Number(p.amount)||0); },0);
              var _due = Math.max(0, _t - _pd);
              if (_due <= 0) return null;
              return { id:'JOB-'+j.id, jobId:j.id, cust:j.cust, customer:j.cust,
                       status:'unpaid', paid:_pd, total:_t, due:_due,
                       date:j.createdAt||j.date||_piToday, _isJobStub:true };
            }).filter(Boolean);
            if (_stubs.length) _allSalesForModal = _allSalesForModal.concat(_stubs);
          }
        } catch(_e){ if(window.DEBUG_MODE) console.error(_e); }
        var invOpts = _allSalesForModal
          .filter(function(s){ return s.status!=='paid'&&s.status!=='returned'&&s.status!=='overpaid'&&!s.voided; })
          .slice().sort(function(a,b){ return (b.date||'')<(a.date||'')?-1:(b.date||'')>(a.date||'')?1:0; })
          .map(function(s){ return '<option value="' + _esc(s.id||'') + '">' + _esc(s.id) + ' — ' + _esc(s.customer||s.cust||'') + '</option>'; }).join('');
        _sel.innerHTML = '<option value="">-- None / Walk-in --</option>' + invOpts;
        _sel.value = _curVal;
        return;
      }
      _existingPayIn.remove();
    }
    var _allSalesForModal = (_svc() ? _svc().sales.getAll() : []);
    try {
      var _knownInvJobIds = {};
      _allSalesForModal.forEach(function (s) { if (s.jobId) _knownInvJobIds[s.jobId] = true; });
      var _jobsArr = (function(){ try { if(window.JobState) return window.JobState.getAll(); } catch(_){ if(window.DEBUG_MODE) console.error(_); } return Array.isArray(window.jobs) ? window.jobs : []; })();
      var _orphanJobs = _jobsArr.filter(function (j) {
        return (j.status === 'completed' || j.status === 'delivered') &&
               !j.invoiceId && !_knownInvJobIds[j.id];
      });
      if (_orphanJobs.length) {
        var _piToday = _today();
        var _stubs = _orphanJobs.map(function (j) {
          var _t = (j.parts||[]).reduce(function(s,p){ return s+(Number(p.q)||0)*(Number(p.p)||0); },0);
          var _llArr = Array.isArray(j.labourLines) ? j.labourLines : [];
              var _l = _llArr.length ? _llArr.reduce(function(s,ll){ return s+(Number(ll.amount)||0); },0) : (Number(j.lab)||0);
          _t = Math.max(0, _t + _l - (Number(j.dis)||0));
          var _pd = (Array.isArray(j.paymentHistory)?j.paymentHistory:[]).reduce(function(s,p){ return s+(Number(p.amount)||0); },0);
          var _due = Math.max(0, _t - _pd);
          if (_due <= 0) return null;
          return { id:'JOB-'+j.id, jobId:j.id, cust:j.cust, customer:j.cust,
                   status:'unpaid', paid:_pd, total:_t, due:_due,
                   date:j.createdAt||j.date||_piToday, _isJobStub:true };
        }).filter(Boolean);
        if (_stubs.length) _allSalesForModal = _allSalesForModal.concat(_stubs);
      }
    } catch(_e){ if(window.DEBUG_MODE) console.error(_e); }
    var invOpts = _allSalesForModal
      .filter(function(s){ return s.status!=='paid'&&s.status!=='returned'&&s.status!=='overpaid'&&!s.voided; })
      .slice().sort(function(a,b){ return (b.date||'')<(a.date||'')?-1:(b.date||'')>(a.date||'')?1:0; })
      .map(function(s){ return '<option value="' + _esc(s.id||'') + '">' + _esc(s.id) + ' — ' + _esc(s.customer||s.cust||'') + '</option>'; }).join('');
    var custOptsDL = (function(){
      if(!_svc()) return '';
      var seen={}; return _svc().customers.getAll().map(function(c){ var n=(c.n||c.name||c.customer||'').trim(); return (n && !seen[n.toLowerCase()]) ? (seen[n.toLowerCase()]=1, '<option value="'+_esc(n)+'">') : ''; }).join('');
    })();
    var el = document.createElement('div');
    el.innerHTML =
      '<div id="payInModal" class="modal-bg">' +
        '<div class="modal" style="max-width:460px">' +
          '<div class="modal-head mh-green" style="border-radius:16px 16px 0 0">' +
            '<div style="display:flex;align-items:center;gap:12px">' +
              '<div style="width:40px;height:40px;background:rgba(255,255,255,.2);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px">💵</div>' +
              '<div><h2 style="color:#fff;font-size:15px;margin:0;font-weight:700">Receive Payment</h2></div>' +
            '</div>' +
            '<button class="modal-x" onclick="ERP.ui.closeModal(\'payInModal\')" style="border-color:rgba(255,255,255,.3);color:#fff"><svg><use href="#ic-x"/></svg></button>' +
          '</div>' +
          '<div class="modal-body" style="display:flex;flex-direction:column;gap:12px">' +
            '<div class="fgrp"><label for="pin-against">Against Invoice</label>' +
              '<select class="fi" id="pin-against" name="pin-against" autocomplete="off" onchange="ERP.sales._payInInvSelected()">' +
                '<option value="">-- None / Walk-in --</option>' + invOpts +
              '</select>' +
            '</div>' +
            '<div id="pin-inv-info" style="display:none;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;font-size:12px"></div>' +
            '<div class="fgrp"><label for="pin-party">Party Name *</label><input class="fi" id="pin-party" name="pin-party" autocomplete="name" placeholder="Customer / Party name" list="pin-party-dl"><datalist id="pin-party-dl">' + custOptsDL + '</datalist></div>' +
            '<div class="fgrp"><label for="pin-amount">Amount Received *</label><input class="fi" type="number" id="pin-amount" name="pin-amount" autocomplete="off" placeholder="0.00" min="0" step="0.01" oninput="ERP.sales._payInCalcBal()"></div>' +
            '<div id="pin-bal-info" style="display:none;font-size:12px;color:var(--muted,#64748b);padding:0 2px"></div>' +
            '<div class="fgrp"><label for="pin-mode">Payment Mode</label><select class="fi" id="pin-mode" name="pin-mode" autocomplete="off"><option>Cash</option><option>JazzCash</option><option>EasyPaisa</option><option>Bank Transfer</option><option>Cheque</option></select></div>' +
            '<div class="fgrp"><label for="pin-date">Date</label><input class="fi" type="date" id="pin-date" name="pin-date" autocomplete="off"></div>' +
            '<div class="fgrp"><label for="pin-notes">Notes / Reference</label><input class="fi" id="pin-notes" name="pin-notes" autocomplete="off" placeholder="Cheque no., transfer ref…"></div>' +
          '</div>' +
          '<div class="modal-foot">' +
            '<button class="btn btn-ghost" onclick="ERP.ui.closeModal(\'payInModal\')">Cancel</button>' +
            '<button id="pin-save-btn" class="btn btn-success" onclick="ERP.sales._savePayIn()" style="min-width:140px">💾 Save Receipt</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el.firstElementChild);
  }
  var UI = {
    sales: {
      render: function(list){
        var pv = document.getElementById('pv-sales'); if(!pv) return;
        if(!_svc()) return;
        _buildInvModal(); _buildPrintModal();
        var _rawData = list || _svc().sales.getAll();
        var _showDeleted = (typeof _showDeletedSales !== 'undefined') && _showDeletedSales;
        var data = _showDeleted
          ? _rawData
          : _rawData.filter(function(s){ return !s.deleted && !s.voided; });
        try {
          var _slKnown = {};
          data.forEach(function (s) { if (s.jobId) _slKnown[s.jobId] = true; });
          var _slJobsArr = (function(){ try { if(window.JobState) return window.JobState.getAll(); } catch(_){ if(window.DEBUG_MODE) console.error(_); } return Array.isArray(window.jobs) ? window.jobs : []; })();
          var _slOrphans = _slJobsArr.filter(function (j) {
            return (j.status === 'completed' || j.status === 'delivered') &&
                   !j.invoiceId && !_slKnown[j.id];
          });
          if (_slOrphans.length) {
            var _slToday = _today();
            var _slStubs = _slOrphans.map(function (j) {
              var _t = (j.parts||[]).reduce(function(s,p){ return s+(Number(p.q)||0)*(Number(p.p)||0); },0);
              var _llArr = Array.isArray(j.labourLines) ? j.labourLines : [];
              var _l = _llArr.length ? _llArr.reduce(function(s,ll){ return s+(Number(ll.amount)||0); },0) : (Number(j.lab)||0);
              _t = Math.max(0, _t + _l - (Number(j.dis)||0));
              var _pd = (Array.isArray(j.paymentHistory)?j.paymentHistory:[]).reduce(function(s,p){ return s+(Number(p.amount)||0); },0);
              var _due = Math.max(0, _t - _pd);
              return { id:'JOB-'+j.id, jobId:j.id, cust:j.cust, customer:j.cust,
                       status: _due <= 0 ? 'paid' : 'unpaid',
                       paid:_pd, total:_t, grand:_t, due:_due,
                       date:j.createdAt||j.date||_slToday,
                       items: (j.parts||[]).map(function(p){ return {n:p.n,q:p.q,p:p.p,d:0}; }),
                       _isJobStub:true };
            });
            data = data.concat(_slStubs);
          }
        } catch(_slErr){ if(window.DEBUG_MODE) console.error(_slErr); }
        if(ERP._internal && ERP._atomicSave) {
          try {
            var _stateData = ERP._internal.getState().data;
            var _allAllocs = _stateData.paymentAllocations || [];
            var _allPayIn  = _stateData.payIn || [];
            var _healPatches = [];
            data.forEach(function(s) {
              var _invAllocs = _allAllocs.filter(function(a) {
                if(a.invoiceId !== s.id) return false;
                var _pi = _allPayIn.find(function(x){ return x.id === a.paymentId; });
                return !(_pi && _pi.voided);
              });
              if(_invAllocs.length === 0) return;
              var _rawAllocSum = Math.round(_invAllocs.reduce(function(acc, a){ return acc + (a.amountAllocated || 0); }, 0) * 100) / 100;
              var _g2 = (typeof s.grand === 'number' && !isNaN(s.grand)) ? s.grand : (typeof _svc()._totals === 'function' ? _svc()._totals(s.items||[]) : {grand:0}).grand;
              if(s.roundOff) _g2 = Math.round(_g2);
              var _allocSum = Math.max(0, Math.min(_rawAllocSum, _g2 + 0.009));
              var _storedPaid = (typeof s.paid === 'number' && !isNaN(s.paid)) ? s.paid : 0;
              var _hasReturnDeduction = _invAllocs.some(function(a){ return a._isReturnDeduction || (a.paymentId && String(a.paymentId).indexOf('RD-') === 0) || (a.amountAllocated < 0); });
              if(_hasReturnDeduction) return;
              if(Math.abs(_allocSum - _storedPaid) > 0.009) {
                var _newRemaining = Math.max(0, Math.round((_g2 - _allocSum) * 100) / 100);
                var _newStatus = s.status === 'returned' ? 'returned'
                  : (_allocSum > _g2 + 0.009  ? 'overpaid'
                  : _allocSum >= _g2           ? 'paid'
                  : _allocSum > 0              ? 'partial' : 'unpaid');
                _healPatches.push({ id: s.id, paid: _allocSum, remaining: _newRemaining, status: _newStatus, updatedAt: new Date().toISOString() });
                if(window.DEBUG_MODE && _rawAllocSum > _g2) console.warn('[sales.render] over-allocation detected for', s.id, '— raw:', _rawAllocSum, 'capped at:', _g2);
              }
            });
            if(_healPatches.length > 0) {
              if(window.DEBUG_MODE) console.warn('[sales.render] self-heal: patching', _healPatches.length, 'stale invoice(s):', _healPatches.map(function(p){ return p.id; }));
              ERP._atomicSave([{ store: 'sales', op: 'patchMany', patches: _healPatches }])
                .catch(function(e){ if(window.DEBUG_MODE) console.warn('[sales.render] self-heal persist failed', e); });
              _healPatches.forEach(function(patch) {
                var idx = data.findIndex(function(x){ return x.id === patch.id; });
                if(idx >= 0) data[idx] = Object.assign({}, data[idx], patch);
              });
            }
          } catch(e) { if(window.DEBUG_MODE) console.warn('[sales.render] self-heal error', e); }
        }
        var _allReturns = (_svc().ret ? _svc().ret.getAll() : []);
        var paid     = data.filter(function(s){ return s.status==='paid'; }).length;
        var overpaid = data.filter(function(s){ return s.status==='overpaid'; }).length;
        var credit   = data.filter(function(s){ return s.status==='credit'||s.status==='unpaid'||s.status==='partial'; }).length;
        var revenue  = data.reduce(function(a,s){
          if(s.status === 'returned') return a;
          var g = (typeof s.grand === 'number' && !isNaN(s.grand)) ? s.grand : (typeof _svc()._totals === 'function' ? _svc()._totals(s.items||[]) : {grand:0}).grand;
          if(s.roundOff) g = Math.round(g);
          var retVal = _allReturns.filter(function(r){ return r.originalInv === s.id && !r.voided; })
                         .reduce(function(x,r){ return x + (r.returnGrand||0); }, 0);
          return a + Math.max(0, g - retVal);
        }, 0);
        pv.innerHTML =
          window.renderStatCards([
            { icon:'🧾', value:data.length,    label:'Total Invoices',   color:'#4338CA', bg:'#eff6ff', valCls:'sc-val', cls:'sc-mini', onClick:"ERP.sales.render()" },
            { icon:'✅', value:paid,           label:'Paid',             color:'#16a34a', bg:'#f0fdf4', valCls:'sc-val', cls:'sc-mini', onClick:"ERP.sales.filter('paid')" },
            { icon:'⚠️', value:credit,         label:'Credit / Unpaid',  color:'#d97706', bg:'#fffbeb', valCls:'sc-val', cls:'sc-mini', onClick:"ERP.sales.filter('credit')" },
            { icon:'🔄', value:overpaid,       label:'Overpaid / CR',    color:'#7c3aed', bg:'#f5f3ff', valCls:'sc-val', cls:'sc-mini', onClick:"ERP.sales.filter('overpaid')" },
            { icon:'💰', value:_fmt(revenue),  label:'Total Revenue',    color:'#7c3aed', bg:'#f5f3ff', valCls:'sc-val' },
          ], { cols:5 }) +
          '<div class="toolbar">' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
              '<div class="search-box"><svg><use href="#ic-search"/></svg><input id="search-sales" name="search-sales" placeholder="Search invoices…" oninput="ERP.sales.search(this.value)"></div>' +
              '<button class="btn btn-ghost btn-sm" onclick="ERP.sales.render()">All</button>' +
              '<button class="btn btn-ghost btn-sm" onclick="ERP.sales.filter(\'paid\')">Paid</button>' +
              '<button class="btn btn-ghost btn-sm" onclick="ERP.sales.filter(\'credit\')">Credit</button>' +
              '<button class="btn btn-ghost btn-sm" onclick="ERP.sales.filter(\'partial\')">Partial</button>' +
            '</div>' +
            '<div style="display:flex;gap:8px">' +
              '<button class="btn btn-ghost btn-sm" onclick="ERP.sales._openReturn()" style="color:#7c3aed;border-color:#ddd6fe">↩ Sale Return</button>' +
              '<button class="btn btn-ghost btn-sm" title="Fix over-allocated invoices" onclick="ERP.sales.repairAllocations()" style="color:#f59e0b;border-color:#fde68a;font-size:11px">🔧 Repair Data</button>' +
              '<button class="btn btn-primary btn-sm" onclick="ERP.sales.openAdd()" style="font-weight:700"><svg><use href="#ic-plus"/></svg> New Invoice</button>' +
            '</div>' +
          '</div>' +
          '<div class="panel"><table class="dt"><thead><tr>' +
            '<th>Invoice #</th><th>Customer</th><th>Items</th><th>Total</th><th>Paid</th><th>Remaining</th><th>Payment</th><th>Status</th><th>Date</th><th>Actions</th>' +
          '</tr></thead><tbody>' +
          (data.length
            ? data.map(function(s){ return _tmpl().invoiceRowHTML(s, _fmt); }).join('')
            : '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--muted)"><div style="font-size:32px;opacity:.4;margin-bottom:10px">🧾</div><div style="font-size:14px;font-weight:600">No invoices yet</div><div style="font-size:12px;margin-top:4px">Click "+ New Invoice" to create your first sale</div></td></tr>') +
          '</tbody></table></div>';
      },
      renderFiltered: function(list){ this.render(list); }
    },
    est: {
      render: function(){
        var pv = document.getElementById('pv-estimates'); if(!pv) return;
        _buildEstimateModal();
        var data    = _svc().est.getAll();
        var today   = _today();
        var pending = data.filter(function(e){ return e.status==='pending'; }).length;
        var approved= data.filter(function(e){ return e.status==='approved'; }).length;
        var expired = data.filter(function(e){ return e.validTill && e.validTill < today && e.status!=='approved'; }).length;
        var totalVal= data.reduce(function(a,e){ var g=typeof e.grand==='number'&&!isNaN(e.grand)?e.grand:_svc()._totals(e.items).grand; return a+g; }, 0);
        pv.innerHTML =
          window.renderStatCards([
            { icon:'🧾', value:data.length, label:'Total Estimates', color:'#4338CA', bg:'#eff6ff' },
            { icon:'⚠️', value:pending,     label:'Pending',         color:'#d97706', bg:'#fffbeb' },
            { icon:'✅', value:approved,    label:'Approved',        color:'#16a34a', bg:'#f0fdf4' },
            { icon:'⏰', value:expired,     label:'Expired',         color:'#dc2626', bg:'#fef2f2' },
          ]) +
          '<div class="toolbar">' +
            '<div class="search-box"><svg><use href="#ic-search"/></svg><input id="search-estimates" name="search-estimates" placeholder="Search estimates…" oninput="ERP.sales._filterTable(this.value,\'pv-estimates\')"></div>' +
            '<button class="btn btn-primary btn-sm" onclick="ERP.sales.openEstimateModal()" style="font-weight:700"><svg><use href="#ic-plus"/></svg> New Estimate</button>' +
          '</div>' +
          '<div class="panel"><table class="dt"><thead><tr>' +
            '<th>Estimate #</th><th>Customer</th><th>Date</th><th>Valid Till</th><th>Amount</th><th>Status</th><th>Actions</th>' +
          '</tr></thead><tbody>' +
          (data.length ? data.map(function(e){ return _tmpl().estimateRowHTML(e); }).join('') : '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--muted)"><div style="font-size:32px;opacity:.4;margin-bottom:10px">📋</div><div style="font-size:14px;font-weight:600">No estimates yet</div></td></tr>') +
          '</tbody></table></div>' +
          '';
      }
    },
    so: {
      render: function(){
        var pv = document.getElementById('pv-saleorders'); if(!pv) return;
        _buildSOModal();
        var data      = _svc().so.getAll();
        var pending   = data.filter(function(o){ return o.status==='pending'; }).length;
        var fulfilled = data.filter(function(o){ return o.status==='fulfilled'; }).length;
        var totalVal  = data.reduce(function(a,o){ var g=typeof o.grand==='number'&&!isNaN(o.grand)?o.grand:_svc()._totals(o.items).grand; return a+g; }, 0);
        pv.innerHTML =
          window.renderStatCards([
            { icon:'🛒', value:data.length,    label:'Total Orders', color:'#4338CA', bg:'#eff6ff' },
            { icon:'⚠️', value:pending,        label:'Pending',      color:'#d97706', bg:'#fffbeb' },
            { icon:'✅', value:fulfilled,      label:'Fulfilled',    color:'#16a34a', bg:'#f0fdf4' },
            { icon:'💰', value:_fmt(totalVal), label:'Total Value',  color:'#7c3aed', bg:'#f5f3ff' },
          ]) +
          '<div class="toolbar">' +
            '<div class="search-box"><svg><use href="#ic-search"/></svg><input id="search-orders" name="search-orders" placeholder="Search orders…" oninput="ERP.sales._filterTable(this.value,\'pv-saleorders\')"></div>' +
            '<button class="btn btn-primary btn-sm" onclick="ERP.sales.openSaleOrderModal()" style="font-weight:700"><svg><use href="#ic-plus"/></svg> New Sale Order</button>' +
          '</div>' +
          '<div class="panel"><table class="dt"><thead><tr>' +
            '<th>Order #</th><th>Customer</th><th>Date</th><th>Items</th><th>Amount</th><th>Status</th><th>Actions</th>' +
          '</tr></thead><tbody>' +
          (data.length ? data.map(function(o){ return _tmpl().soRowHTML(o); }).join('') : '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--muted)"><div style="font-size:32px;opacity:.4;margin-bottom:10px">📦</div><div style="font-size:14px;font-weight:600">No sale orders yet</div></td></tr>') +
          '</tbody></table></div>' +
          '';
      }
    },
    payin: {
      rowsHTML: function(data){
        return (data || []).map(function(p){ return _tmpl().payinRowHTML(p); }).join('');
      },
      render: function(){
        var pv = document.getElementById('pv-payin'); if(!pv) return;
        if(!_svc()) return;
        var data    = _svc().payin.getAll();
        var total   = data.reduce(function(a,p){ return a+(p.amount||0); }, 0);
        var today   = _today();
        var todayRec= data.filter(function(p){ return p.date===today; }).reduce(function(a,p){ return a+(p.amount||0); }, 0);
        pv.innerHTML =
          window.renderStatCards([
            { icon:'💰', value:_fmt(total),   label:'Total Received', color:'#16a34a', bg:'#f0fdf4' },
            { icon:'🧾', value:data.length,    label:'Total Receipts', color:'#4338CA', bg:'#eff6ff' },
            { icon:'📅', value:_fmt(todayRec), label:'Today',          color:'#7c3aed', bg:'#f5f3ff' },
          ]) +
          '<div class="toolbar">' +
            '<div class="search-box"><svg><use href="#ic-search"/></svg><input id="search-payin" name="search-payin" placeholder="Search receipts…" oninput="ERP.sales._filterPayIn(this.value)"></div>' +
            '<button class="btn btn-primary btn-sm" onclick="ERP.sales.openPayInModal()" style="font-weight:700"><svg><use href="#ic-plus"/></svg> New Receipt</button>' +
          '</div>' +
          '<div class="panel"><table class="dt"><thead><tr>' +
            '<th>Receipt #</th><th>Party</th><th>Amount</th><th>Mode</th><th>Date</th><th>Invoice(s)</th><th>Allocated</th><th>Unallocated</th><th>Cust. Balance</th><th>Notes</th><th></th>' +
          '</tr></thead><tbody id="payin-tbody">' +
          this.rowsHTML(data) +
          '</tbody></table></div>' +
          '';
        _buildPayInModal();
      }
    },
    payOut: {
      render: function(){
        var pvSales    = document.getElementById('pv-salespayout');
        var pvPurchase = document.getElementById('pv-payout');
        if (pvPurchase && pvPurchase.classList.contains('active')) {
          var PS = (typeof PurchaseState !== 'undefined') ? PurchaseState : null;
          var supPayments = PS ? PS.getAllPayments() : [];
          var spActive    = supPayments.filter(function(p){ return !p.voided; });
          var spTotal     = spActive.reduce(function(a,p){ return a+(p.amount||0); }, 0);
          var spToday     = _today();
          var spTodayAmt  = spActive.filter(function(p){ return p.date===spToday; }).reduce(function(a,p){ return a+(p.amount||0); }, 0);
          var _esc2 = function(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); };
          pvPurchase.innerHTML =
            window.renderStatCards([
              { icon:'💰', value:_fmt(spTotal),    label:'Total Paid Out', color:'#7c3aed', bg:'#f5f3ff' },
              { icon:'🧾', value:spActive.length,  label:'Total Payments', color:'#4338CA', bg:'#eff6ff' },
              { icon:'📅', value:_fmt(spTodayAmt), label:'Today',          color:'#d97706', bg:'#fffbeb' },
            ]) +
            '<div class="toolbar">' +
              '<div class="search-box"><svg><use href="#ic-search"/></svg><input id="search-sup-payouts" name="search-sup-payouts" placeholder="Search payments…" oninput="ERP.sales._filterTable(this.value,\'pv-payout\')"></div>' +
              '<button class="btn btn-sm" style="background:#0284c7;color:#fff;border-color:#0284c7;font-weight:700" onclick="if(typeof openPaymentOutModal===\'function\')openPaymentOutModal();else if(typeof renderPaymentOutPage===\'function\')renderPaymentOutPage();"><svg><use href="#ic-plus"/></svg> New Payment</button>' +
            '</div>' +
            '<div class="panel"><table class="dt"><thead><tr>' +
              '<th>Pay #</th><th>Supplier</th><th>Amount</th><th>Method</th><th>Date</th><th>Reference</th><th>Notes</th><th>Status</th><th></th>' +
            '</tr></thead><tbody>' +
            (supPayments.length
              ? supPayments.map(function(p){
                  var voided = p.voided ? ' style="opacity:.5;text-decoration:line-through"' : '';
                  var badge  = p.voided ? '<span style="background:var(--danger);color:#fff;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:700">VOID</span>' : '<span style="background:#e8f5e9;color:#2e7d32;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:700">Active</span>';
                  return '<tr' + voided + '>' +
                    '<td style="font-weight:600;color:#0284c7">' + _esc2(p.id||'—') + '</td>' +
                    '<td>' + _esc2(p.supplierName||p.supplierId||'—') + '</td>' +
                    '<td style="font-weight:700">' + _fmt(p.amount||0) + '</td>' +
                    '<td>' + _esc2(p.method||'Cash') + '</td>' +
                    '<td>' + _esc2(p.date||'—') + '</td>' +
                    '<td>' + _esc2(p.reference||'—') + '</td>' +
                    '<td>' + _esc2(p.notes||'—') + '</td>' +
                    '<td>' + badge + '</td>' +
                    '<td style="white-space:nowrap">' +
                      (!p.voided ? '<button class="btn btn-xs btn-ghost" onclick="if(typeof printPaymentOut===\'function\')printPaymentOut(\'' + _esc2(p.id) + '\')" title="Print">🖨</button> ' +
                      '<button class="btn btn-xs" style="background:var(--danger);color:#fff;border-color:var(--danger)" onclick="if(typeof voidPaymentOut===\'function\')voidPaymentOut(\'' + _esc2(p.id) + '\')" title="Void">Void</button>' : '—') +
                    '</td>' +
                  '</tr>';
                }).join('')
              : '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--muted)"><div style="font-size:32px;opacity:.4;margin-bottom:10px">💸</div><div style="font-size:14px;font-weight:600">No supplier payments yet</div><div style="font-size:12px;margin-top:6px">Click "+ New Payment" to add one</div></td></tr>') +
            '</tbody></table></div>';
          return;
        }
        var pv = pvSales || pvPurchase;
        if(!pv) return;
        if(!_svc()) return;
        var data     = (_svc().customerPayOut ? _svc().customerPayOut.getAll() : []);
        var active   = data.filter(function(p){ return !p.voided; });
        var total    = active.reduce(function(a,p){ return a+(p.amount||0); }, 0);
        var today    = _today();
        var todayAmt = active.filter(function(p){ return p.date===today; }).reduce(function(a,p){ return a+(p.amount||0); }, 0);
        pv.innerHTML =
          window.renderStatCards([
            { icon:'💰', value:_fmt(total),    label:'Total Refunded', color:'#7c3aed', bg:'#f5f3ff' },
            { icon:'🧾', value:active.length,  label:'Total Refunds',  color:'#4338CA', bg:'#eff6ff' },
            { icon:'📅', value:_fmt(todayAmt), label:'Today',          color:'#d97706', bg:'#fffbeb' },
          ]) +
          '<div class=\"toolbar\">' +
            '<div class=\"search-box\"><svg><use href=\"#ic-search\"/></svg><input id="search-payouts" name="search-payouts" placeholder=\"Search refunds…\" oninput=\"ERP.sales._filterPayOut(this.value)\"></div>' +
            '<button class=\"btn btn-sm btn-warning\" style=\"font-weight:700\" onclick=\"ERP.sales.openPayOutModal()\"><svg><use href=\"#ic-plus\"/></svg> New Refund</button>' +
          '</div>' +
          '<div class=\"panel\"><table class=\"dt\"><thead><tr>' +
            '<th>Ref #</th><th>Customer</th><th>Amount</th><th>Mode</th><th>Date</th><th>Credit Note</th><th>Notes</th><th></th>' +
          '</tr></thead><tbody id=\"cpayout-tbody\">' +
          (data.length
            ? data.map(function(p){ return _tmpl().payoutRowHTML(p); }).join('')
            : '<tr><td colspan=\"8\" style=\"text-align:center;padding:40px;color:var(--muted)\"><div style=\"font-size:32px;opacity:.4;margin-bottom:10px\">💸</div><div style=\"font-size:14px;font-weight:600\">No refunds yet</div></td></tr>') +
          '</tbody></table></div>';
      }
    },
    dc: {
      render: function(){
        var pv = document.getElementById('pv-deliverychallan'); if(!pv) return;
        var data = _svc().dc.getAll();
        pv.innerHTML =
          window.renderStatCards([
            { icon:'🛒', value:data.length, label:'Total Challans', color:'#4338CA', bg:'#eff6ff' },
            { icon:'✅', value:data.filter(function(c){ return c.converted; }).length,  label:'Converted', color:'#16a34a', bg:'#f0fdf4' },
            { icon:'⚠️', value:data.filter(function(c){ return !c.converted; }).length, label:'Pending',   color:'#d97706', bg:'#fffbeb' },
          ]) +
          '<div class="toolbar">' +
            '<div class="search-box"><svg><use href="#ic-search"/></svg><input id="search-challans" name="search-challans" placeholder="Search challans…" oninput="ERP.sales._filterTable(this.value,\'pv-deliverychallan\')"></div>' +
            '<button class="btn btn-info btn-sm" onclick="ERP.sales.openChallanModal()" style="font-weight:700"><svg><use href="#ic-plus"/></svg> New Challan</button>' +
          '</div>' +
          '<div class="panel"><table class="dt"><thead><tr>' +
            '<th>Challan #</th><th>Customer</th><th>Date</th><th>Items</th><th>Address</th><th>Status</th><th>Actions</th>' +
          '</tr></thead><tbody>' +
          (data.length ? data.map(function(c){ return _tmpl().dcRowHTML(c); }).join('') : '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--muted)"><div style="font-size:32px;opacity:.4;margin-bottom:10px">🚚</div><div style="font-size:14px;font-weight:600">No delivery challans yet</div></td></tr>') +
          '</tbody></table></div>' +
          '';
        _buildChallanModal();
      }
    },
    ret: {
      render: function(){
        var pv = document.getElementById('pv-salereturns'); if(!pv) return;
        if(!_svc()) return;
        var data     = _svc().ret.getAll();
        var total    = data.reduce(function(a,r){ return a+(r.returnGrand||r.amount||0); }, 0);
        var thisMonth= data.filter(function(r){ return (r.date||'').startsWith(_today().substr(0,7)); }).length;
        pv.innerHTML =
          window.renderStatCards([
            { icon:'🔄', value:data.length,  label:'Total Returns',  color:'#d97706', bg:'#fffbeb' },
            { icon:'💰', value:_fmt(total),  label:'Total Refunded', color:'#dc2626', bg:'#fef2f2' },
            { icon:'📅', value:thisMonth,    label:'This Month',     color:'#4338CA', bg:'#eff6ff' },
          ]) +
          '<div class="toolbar">' +
            '<div class="search-box"><svg><use href="#ic-search"/></svg><input id="search-returns" name="search-returns" placeholder="Search returns…" oninput="ERP.sales._filterTable(this.value,\'pv-salereturns\')"></div>' +
            '<button class="btn btn-warning btn-sm" onclick="ERP.sales._openReturn()" style="font-weight:700"><svg><use href="#ic-plus"/></svg> New Sale Return</button>' +
          '</div>' +
          '<div class="panel"><table class="dt"><thead><tr>' +
            '<th>Credit Note #</th><th>Customer</th><th>Original Invoice</th><th>Items Returned</th><th>Amount</th><th>Mode</th><th>Cash Paid Out</th><th>Date</th><th>Reason</th><th></th>' +
          '</tr></thead><tbody>' +
          (data.length ? data.map(function(r){ return _tmpl().retRowHTML(r); }).join('') : '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--muted)"><div style="font-size:32px;opacity:.4;margin-bottom:10px">↩</div><div style="font-size:14px;font-weight:600">No returns yet</div></td></tr>') +
          '</tbody></table></div>';
      }
    }
  };
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape' && e.keyCode !== 27) return;
    var salesModals = ['invPrintModal','invModal','estimateModal','saleOrderModal','payInModal','challanModal','saleReturnModal','creditLimitModal'];
    for(var mi=0; mi<salesModals.length; mi++){
      var m = document.getElementById(salesModals[mi]);
      if(m && m.style.display !== 'none' && m.style.display !== '') return;
    }
    if (typeof ERP !== 'undefined' && typeof ERP.go === 'function') {
      ERP.go('dashboard');
    }
  });
  ERP._salesUI = UI;
  ERP._salesBuildInvModal      = _buildInvModal;
  ERP._salesBuildPrintModal    = _buildPrintModal;
  ERP._salesBuildEstimateModal = _buildEstimateModal;
  ERP._salesBuildSOModal       = _buildSOModal;
  ERP._salesBuildChallanModal  = _buildChallanModal;
  ERP._salesBuildPayInModal    = _buildPayInModal;
  ERP._salesToast           = _toast;
  ERP._salesOModal          = _oModal;
  ERP._salesCModal          = _cModal;
  ERP._salesCustDD          = _custDD;
  ERP._salesInvDL           = _invDL;
  ERP._salesRefreshItemDL    = _refreshItemDatalist;
  if (ERP.events && ERP.events.on) {
    ERP.events.on(ERP.events.NAMES.INVENTORY_UPDATED, function () {
      try { _refreshItemDatalist(); } catch(_){ if(window.DEBUG_MODE) console.error(_); }
    });
    ERP.events.on('customers:updated', function () {
      try {
        if (ERP.sales && typeof ERP.sales._refreshCustList === 'function')
          ERP.sales._refreshCustList();
      } catch(_){ if(window.DEBUG_MODE) console.error(_); }
    });
  }
})(window.ERP = window.ERP || {});