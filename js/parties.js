'use strict';

var ERP = window.ERP || {};

(function (ERP) {
  'use strict';

  // ARCHITECTURAL FIX: this file previously called ERP.storage.save(...)
  // directly (db.js's thin wrapper around db.save()) for 'customers',
  // 'suppliers', and 'customerLedger' — three canonical stores — bypassing
  // ERP.Persistence entirely. This wasn't a data-loss bug (ERP.storage.save
  // and ERP.Persistence.save both bottom out in the same db.save()
  // primitive), but it meant these three stores got a single-attempt write
  // with no retry/backoff and never surfaced a failure toast or recorded
  // into _persistFailures the way every other store does. All 16 call sites
  // below now go through ERP.Persistence.save(), the same single choke
  // point as the rest of the app.

  var _e  = function (s) { return ERP.escapeHtml(s); };
  var _gs = function ()        { return ERP.state.get(); };
  var _st = function (fn, mod) { return ERP.state.set(fn, mod); };

  var ACC_OPENING_BALANCE_EQUITY = 'acc-3900';
  var ACC_ACCOUNTS_RECEIVABLE    = 'acc-1100';
  var ACC_ACCOUNTS_PAYABLE       = 'acc-2001';
  var ACC_SALES_REVENUE          = 'acc-4001';
  var ACC_SUPPLIER_ADJ_EXPENSE   = 'acc-5200';

  function _dateCompare(aStr, bStr) {
    var aT = aStr ? new Date(aStr).getTime() : NaN;
    var bT = bStr ? new Date(bStr).getTime() : NaN;
    var aOk = !isNaN(aT);
    var bOk = !isNaN(bT);
    if (aOk && bOk) return aT - bT;
    if (aOk) return -1;
    if (bOk) return 1;
    return String(aStr || '').localeCompare(String(bStr || ''));
  }

  function _findById(list, id, name) {
    if (!list || !list.length) return -1;
    var sId = id != null ? String(id) : '';
    if (sId) {
      for (var i = 0; i < list.length; i++) {
        var itemId = list[i].id;
        if (String(itemId != null ? itemId : '') === sId) return i;
      }
    }
    var nName = (name || '').trim().toLowerCase();
    if (!nName) return -1;
    for (var j = 0; j < list.length; j++) {
      if ((list[j].n || list[j].name || '').trim().toLowerCase() === nName) return j;
    }
    return -1;
  }

  function _canManageParties(action) {
    try {
      if (ERP.permissions && typeof ERP.permissions.can === 'function') {
        return !!ERP.permissions.can(action || 'parties:manage');
      }
    } catch (_permErr) { }
    return true;
  }

  function _bizName() {
    try {
      var biz = _gs().biz;
      return (biz && biz.name) ? biz.name : 'Hamari Dukaan';
    } catch (_bizErr) { return 'Hamari Dukaan'; }
  }

  function _partyTextMatch(fields, q) {
    var lc = (q || '').toLowerCase().trim();
    if (!lc) return true;
    for (var i = 0; i < fields.length; i++) {
      var f = (fields[i] || '').toString().toLowerCase();
      if (f.indexOf(lc) !== -1) return true;
    }
    return false;
  }

  function _waPhone(raw) {
    var ph = (raw || '').trim();
    ph = ph.replace(/[\s\-\.]/g, '');
    if (ph.charAt(0) === '+') ph = ph.slice(1);
    ph = ph.replace(/\D/g, '');
    if (!ph) return '';
    if (ph.slice(0, 4) === '0092') ph = ph.slice(2);
    else if (ph.slice(0, 3) === '092') ph = ph.slice(1);
    if (ph.slice(0, 2) === '92' && ph.length >= 12) return ph.length <= 13 ? ph : '';
    if (ph.charAt(0) === '0') ph = '92' + ph.slice(1);
    else if (ph.slice(0, 2) !== '92') ph = '92' + ph;
    if (ph.length < 12 || ph.length > 13) return '';
    return ph;
  }

  function _openPrintWindow(title, summaryHtml, tableHtml) {
    var w = window.open('', '_blank', 'width=820,height=900');
    if (!w) { ERP.ui.toast('⚠️ Pop-up blocked — please allow pop-ups for this site to print', 'warning'); return; }
    var safeTitle = ERP.escapeHtml ? ERP.escapeHtml(title || '') : (title || '');
    var css = ':root{--red:#ef4444;--green:#16a34a;--muted:#64748b;--border:#e2e8f0;--dark:#0f172a;--gold:#caa454}'
      + 'body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;padding:24px;margin:0}'
      + 'h2{margin:0 0 14px;font-size:16px}'
      + '.mono{font-family:monospace}'
      + 'table{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px}'
      + 'th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}'
      + 'th{background:#f1f5f9}'
      + '@media print{@page{margin:14mm}}';
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + safeTitle + '</title><style>' + css + '</style></head><body>'
      + '<h2>' + safeTitle + '</h2>' + (summaryHtml || '') + (tableHtml || '') + '</body></html>');
    w.document.close();
    w.focus();
    setTimeout(function () { w.print(); }, 200);
  }

  var VALID_LEDGER_ENTRY_TYPES = { OPENING_BALANCE: true, ADJUSTMENT: true, INVOICE: true, PAYMENT: true, CREDIT_NOTE: true, PAYMENT_VOID: true };

  function _validateLedgerEntry(payload) {
    if (!payload || typeof payload !== 'object') return 'Ledger entry payload missing';
    if (!payload.supplierId || typeof payload.supplierId !== 'string') return 'supplierId is required and must be a string';
    if (!payload.type || !VALID_LEDGER_ENTRY_TYPES[payload.type]) return 'Unknown ledger entry type: ' + payload.type;
    if (typeof payload.debit !== 'number' || isNaN(payload.debit) || payload.debit < 0) return 'debit must be a non-negative number';
    if (typeof payload.credit !== 'number' || isNaN(payload.credit) || payload.credit < 0) return 'credit must be a non-negative number';
    if (payload.debit === 0 && payload.credit === 0) return 'Either debit or credit must be greater than zero';
    if (!payload.referenceId) return 'referenceId is required';
    if (!payload.date || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) return 'date must be in YYYY-MM-DD format';
    return null;
  }

  function _balDrCr(bal, colorMode) {
    var amount = ERP.fmt(Math.abs(bal || 0));
    if (colorMode === 'hex') {
      var color = bal > 0 ? '#ef4444' : bal < 0 ? '#16a34a' : '#64748b';
      var text  = bal > 0 ? amount + ' Dr' : bal < 0 ? amount + ' Cr' : amount;
      return { color: color, text: text };
    }
    var colorVar = bal > 0 ? '#ef4444' : bal < 0 ? '#16a34a' : 'var(--dark)';
    var textVar  = bal > 0 ? amount + ' Dr' : bal < 0 ? amount + ' Cr' : amount;
    return { color: colorVar, text: textVar };
  }

  ERP.cust = (function () {
    'use strict';

    var _custs = function () { return _gs().data.customers || []; };

    function _bdayParts(bday) {
      if (!bday) return null;
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(bday).trim());
      if (m) return { month: parseInt(m[2], 10) - 1, date: parseInt(m[3], 10) };
      try {
        var d = new Date(bday);
        if (isNaN(d.getTime())) return null;
        return { month: d.getMonth(), date: d.getDate() };
      } catch (e) { return null; }
    }

    var _MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    function _bdayDisplay(bday) {
      var parts = _bdayParts(bday);
      if (!parts) return '—';
      return parts.date + ' ' + (_MONTH_SHORT[parts.month] || '');
    }

    function _isToday(bday) {
      var parts = _bdayParts(bday);
      if (!parts) return false;
      var now = new Date();
      return parts.month === now.getMonth() && parts.date === now.getDate();
    }

    function _row(c, idx, salesMap) {
      var sfn         = _e(c.n || '');
      var custId      = String(c.id || c.n || '');
      var outstanding = ERP._calcCustomerOutstanding ? ERP._calcCustomerOutstanding(custId) : 0;
      var ledgerBal   = ERP._Ledger ? ERP._Ledger.getBalance(custId) : outstanding;
      var isAdvance   = ledgerBal < 0;
      var dispAmt     = isAdvance ? Math.abs(ledgerBal) : outstanding;
      var balLabel    = isAdvance ? '<span style="color:var(--green);font-weight:600">' + ERP.fmt(dispAmt)+' Cr</span>'
                      : outstanding > 0 ? '<span style="color:var(--red);font-weight:600">' + ERP.fmt(dispAmt)+'</span>'
                      : '<span class="muted">—</span>';
      var custNmLc    = (c.n || '').toLowerCase();
      var entry       = (salesMap && (salesMap[custId] || salesMap['n:' + custNmLc])) || { gross: 0, returned: 0 };
      var totalSales  = Math.max(0, entry.gross - entry.returned);
      return '<tr>'
        + '<td class="fw">' + sfn + '</td>'
        + '<td>' + _e(c.ph || '') + '</td>'
        + '<td class="muted">' + _e(c.veh || '') + '</td>'
        + '<td class="mono" style="color:var(--gold);font-weight:600">' + ERP.fmt(Math.round(totalSales)) + '</td>'
        + '<td class="mono">' + balLabel + '</td>'
        + '<td><span class="badge ' + ((c.pts || 0) > 300 ? 'b-gold' : (c.pts || 0) > 150 ? 'b-blue' : 'b-gray') + '">' + (c.pts || 0) + ' pts</span></td>'
        + '<td>' + _bdayDisplay(c.bday) + '</td>'
        + '<td><span class="badge b-green">Active</span></td>'
        + '<td><div style="display:flex;gap:4px;flex-wrap:wrap">'
          + '<button class="btn btn-ghost btn-sm" data-action="cust:ledger" data-idx="' + idx + '"><svg><use href="#ic-receipt"/></svg> Ledger</button>'
          + '<button class="btn btn-whatsapp btn-sm" data-action="cust:wa" data-idx="' + idx + '"><svg style="width:12px;height:12px"><use href="#ic-whatsapp"/></svg></button>'
          + '<button class="btn btn-ghost btn-sm" data-action="cust:edit" data-idx="' + idx + '"><svg><use href="#ic-edit"/></svg></button>'
          + '<button class="btn btn-danger btn-sm" data-confirm="0" data-action="cust:del" data-idx="' + idx + '"><svg><use href="#ic-trash"/></svg></button>'
          + '</div></td>'
        + '</tr>';
    }

    function _buildCustSalesMap(custs) {
      var map = {};
      var stData  = ERP._internal ? ERP._internal.getState().data : _gs().data;
      var allInv  = stData.sales || [];
      var allRets = stData.saleReturns || [];
      var custInvIds = {};

      var keysByName = {};
      custs.forEach(function (c) {
        var nmLc = (c.n || '').toLowerCase();
        var custId = String(c.id || c.n || '');
        if (!map[custId]) map[custId] = { gross: 0, returned: 0 };
        if (nmLc) keysByName[nmLc] = custId;
      });

      allInv.forEach(function (inv) {
        if (inv.deleted) return;
        var invNmLc = (inv.customer || '').toLowerCase();
        var invCustId = String(inv.customerId || '');
        var matchId = (invCustId && map[invCustId]) ? invCustId : (keysByName[invNmLc] || null);
        if (!matchId) return;
        custInvIds[String(inv.id || '')] = matchId;
        var grand = inv.total || inv.gt || (ERP._salesSvc ? ERP._salesSvc._totals(inv.items || []).grand : (inv.items || []).reduce(function (s2, i) { return s2 + (i.q || 0) * (i.p || 0) - (i.d || 0); }, 0));
        map[matchId].gross += (inv.roundOff ? Math.round(grand) : grand);
      });

      allRets.forEach(function (r) {
        var rNmLc = (r.customer || r.cust || '').toLowerCase();
        var rCustId = String(r.customerId || '');
        var rOrigInv = String(r.originalInv || r.originalId || '');
        var matchId = (rCustId && map[rCustId]) ? rCustId : (custInvIds[rOrigInv] || keysByName[rNmLc] || null);
        if (!matchId) return;
        map[matchId].returned += (r.returnGrand || r.amount || r.total || 0);
      });

      custs.forEach(function (c) {
        var nmLc = (c.n || '').toLowerCase();
        if (nmLc && !map['n:' + nmLc]) map['n:' + nmLc] = map[String(c.id || c.n || '')];
      });

      return map;
    }

    function render(list) {
      try {
        var custs        = list || _custs();
        var tb           = document.getElementById('cust-tbody');
        if (!tb) return;
        var MAX_CUST_ROWS = 200;
        if (!custs.length) {
          tb.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:28px;color:var(--muted)">No customers yet — <button class="btn btn-ghost btn-sm" data-action="party:addCustomer">+ Add First Customer</button></td></tr>';
        } else {
          var visible = custs.slice(0, MAX_CUST_ROWS);
          var fullList = _custs();
          var salesMap = _buildCustSalesMap(fullList);
          tb.innerHTML = visible.map(function (c) {
            var realIdx = fullList.indexOf(c);
            if (realIdx < 0) realIdx = _findById(fullList, c.id, c.n);
            return _row(c, realIdx, salesMap);
          }).join('');
          if (custs.length > MAX_CUST_ROWS) {
            tb.innerHTML += '<tr><td colspan="9" style="text-align:center;padding:10px;color:var(--muted);font-size:12px">Showing first ' + MAX_CUST_ROWS + ' of ' + custs.length + ' — use search to filter</td></tr>';
          }
        }

        var all         = _custs();
        var tot         = document.getElementById('cust-total-cnt');
        if (tot) tot.textContent = all.length;
        var outstanding = all.reduce(function (s, c) {
          var custId = String(c.id || c.n || '');
          var due = ERP._Ledger ? ERP._Ledger.getBalance(custId) : (ERP._calcCustomerOutstanding ? ERP._calcCustomerOutstanding(custId) : 0);
          return s + Math.max(0, due);
        }, 0);
        var outEl       = document.getElementById('cust-outstanding');
        if (outEl) outEl.textContent = ERP.fmt(Math.round(outstanding));
        var vip         = all.filter(function (c) { return (c.pts || 0) > 300; }).length;
        var vipEl       = document.getElementById('cust-vip-cnt');
        if (vipEl) vipEl.textContent = vip;

        var bdays     = all.filter(function (c) { return _isToday(c.bday); });
        var bdEl      = document.getElementById('cust-bday-cnt');
        if (bdEl) bdEl.textContent = bdays.length;
        var bdCountEl = document.getElementById('bday-count');
        if (bdCountEl) bdCountEl.textContent = bdays.length;
        var bdList    = document.getElementById('bday-list');
        if (bdList) {
          bdList.innerHTML = bdays.map(function (c) {
            return '<div class="jr"><div class="jr-icon">🎂</div><div class="jr-info"><div class="jr-car">' + _e(c.n || '') + '</div><div class="jr-desc">Birthday: ' + _bdayDisplay(c.bday) + '</div></div></div>';
          }).join('') || '';
        }

        var dl = document.getElementById('cust-datalist');
        if (dl) {
          dl.innerHTML = all.map(function (c) {
            var _dcId = String(c.id || c.n || '');
            var _dcBal = ERP._calcCustomerOutstanding ? ERP._calcCustomerOutstanding(_dcId) : 0;
            return '<option value="' + _e(c.n || '') + '" data-ph="' + _e(c.ph || '') + '" data-credit="' + _dcBal + '">';
          }).join('');
        }
      } catch (e) { console.error('[ERP.cust render]', e); }
    }

    function search(q) {
      if (!(q || '').trim()) { render(); return; }
      render(_custs().filter(function (c) {
        return _partyTextMatch([c.n, c.ph, c.veh], q);
      }));
    }

    function filterVIP() {
      render(_custs().filter(function (c) { return (c.pts || 0) > 300; }));
      ERP.ui.toast('Showing VIP customers (pts > 300)', 'info');
    }

    function filterCredit() {
      render(_custs().filter(function (c) {
        var custId = String(c.id || c.n || '');
        var bal = ERP._calcCustomerOutstanding ? ERP._calcCustomerOutstanding(custId) : 0;
        return bal > 0;
      }));
      ERP.ui.toast('Showing customers with outstanding balance', 'info');
    }

    function openAdd() {
      if (ERP.parties && ERP.parties.openAdd) { ERP.parties.openAdd('customer'); return; }
      ERP.ui.toast('Add Customer unavailable — parties module failed to load. Please reload the page.', 'error');
    }

    function openEdit(idx) {
      if (ERP.parties && ERP.parties.openEdit) { ERP.parties.openEdit('customer', idx); return; }
      ERP.ui.toast('Edit unavailable — parties module failed to load. Please reload the page.', 'error');
    }

    function closeModal() {
      if (ERP.parties && ERP.parties.closeAdd) ERP.parties.closeAdd();
    }

    async function save() {
      if (ERP.parties && ERP.parties.saveNew) { return await ERP.parties.saveNew(); }

      var nameEl  = document.getElementById('apm-name');
      var phoneEl = document.getElementById('apm-phone');
      var addrEl  = document.getElementById('apm-address');
      var emailEl = document.getElementById('apm-email');
      var bdayEl  = document.getElementById('apm-birthday');
      var credEl  = document.getElementById('apm-credit');
      var vehEl   = document.getElementById('apm-vehicle');

      var n = (nameEl && nameEl.value || '').trim();
      if (!n || n.length < 2) { ERP.ui.toast('Customer name is required (min 2 chars)', 'error'); return; }
      var ph     = (phoneEl && phoneEl.value || '').trim();
      if (ph && !/^[0-9\-\+\s]{7,15}$/.test(ph)) { ERP.ui.toast('Invalid phone number — e.g. 03001234567', 'error'); return; }
      var veh    = (vehEl   && vehEl.value   || '').trim();
      var addr   = (addrEl  && addrEl.value  || '').trim();
      var email  = (emailEl && emailEl.value || '').trim();
      var bday   = (bdayEl  && bdayEl.value  || '').trim();
      var climit = parseFloat(credEl && credEl.value || '0') || 0;
      var editIdx = (nameEl && typeof nameEl.dataset.editIdx !== 'undefined' && nameEl.dataset.editIdx !== '')
        ? parseInt(nameEl.dataset.editIdx, 10) : -1;

      var dup = _custs().findIndex(function (c, i) {
        return i !== editIdx && (c.n || '').toLowerCase() === n.toLowerCase();
      });
      if (dup !== -1) { ERP.ui.toast('A customer with this name already exists!', 'error'); return; }

      if (editIdx >= 0) {
        _st(function (s) {
          var c = s.data.customers[editIdx];
          if (!c) return;
          c.n = n; c.ph = ph; c.veh = veh; c.addr = addr;
          c.email = email; c.bday = bday || null; c.creditLimit = climit;
        }, 'customers');
        ERP.Persistence.save('customers', _custs()).catch(function (e) { console.warn('[cust.save]', e); });
        ERP.ui.toast('Customer updated!', 'success');
      } else {
        var newC = {
          id: ERP.uid(), // FIX (root cause, audit #61-64): was randomUUID-or-Date.now+random; route through the one canonical generator.
          email: email, bday: bday || null, creditLimit: climit,
          sales: 0, credit: 0, pts: 0, created: new Date().toISOString()
        };
        _st(function (s) { s.data.customers.unshift(newC); }, 'customers');
        ERP.Persistence.save('customers', _custs()).catch(function (e) { console.warn('[cust.save]', e); });
        ERP.ui.toast('Customer saved!', 'success');
      }
      ERP.events.emit('customers:updated');
      closeModal();
    }

    function del(idx, btn) {
      var c = _custs()[idx];
      if (!c) return;
      if (!_canManageParties('customers:delete')) {
        ERP.ui.toast('You do not have permission to delete customers', 'error');
        return;
      }
      if (btn && btn.dataset.confirm !== '1') {
        btn.dataset.confirm = '1';
        btn.innerHTML = '⚠️ Sure?';
        setTimeout(function () { if (btn) { btn.dataset.confirm = '0'; btn.innerHTML = '<svg><use href="#ic-trash"/></svg>'; } }, 3000);
        return;
      }
      if (btn) { btn.dataset.confirm = '0'; btn.innerHTML = '<svg><use href="#ic-trash"/></svg>'; }
      try {
        var custId = String(c.id || c.n || '');
        var sales = ERP.getState ? (ERP.getState().data.sales || []) : [];
        var openInvoices = sales.filter(function(inv) {
          return !inv.deleted && String(inv.customerId || inv.party || '') === custId &&
                 (inv.status || '').toLowerCase() !== 'paid' && (inv.status || '').toLowerCase() !== 'cancelled';
        });
        if (openInvoices.length > 0) {
          ERP.ui.toast('❌ Customer cannot be deleted — ' + openInvoices.length + ' unpaid invoice(s) hain. Pehle invoices settle karein.', 'error', 0);
          return;
        }
        if (!ERP._Ledger) {
          ERP.ui.toast('❌ Customer cannot be deleted — balance could not be verified (ledger module unavailable). Please reload the page.', 'error', 0);
          return;
        }
        var ledgerBal = ERP._Ledger.getBalance(custId);
        if (Math.abs(ledgerBal) > 0) {
          ERP.ui.toast('❌ Customer cannot be deleted — outstanding balance ' + ERP.fmt(Math.abs(ledgerBal)) + ' hai. Pehle balance clear karein.', 'error', 0);
          return;
        }
      } catch (checkErr) { console.warn('[cust.del] balance check failed:', checkErr); ERP.ui.toast('Delete check failed — please try again', 'error'); return; }
      _st(function (s) {
        var freshIdx = _findById(s.data.customers, c.id, c.n);
        if (freshIdx >= 0) s.data.customers.splice(freshIdx, 1);
      }, 'customers');
      ERP.Persistence.save('customers', _custs()).catch(function (e) { console.warn('[cust.del]', e); });
      try { window.customers = _custs(); } catch (_) {}
      ERP.events.emit('customers:updated');
      ERP.ui.toast('Customer deleted', 'success');
    }

    function viewLedger(idx) {
      var c = _custs()[idx];
      if (!c) return;
      var custId      = String(c.id || c.n || '');
      var ledgerBal   = ERP._Ledger   ? ERP._Ledger.getBalance(custId)            : 0;
      var outstanding = ERP._calcCustomerOutstanding ? ERP._calcCustomerOutstanding(custId) : 0;
      var advance     = ledgerBal < 0 ? Math.abs(ledgerBal) : 0;
      var availCredit = Math.max(0, (c.creditLimit || 0) - outstanding);

      var balLabel = ledgerBal > 0  ? '<span style="color:var(--red);font-weight:700">' + ERP.fmt(Math.abs(ledgerBal))+' Dr</span>'
                  : ledgerBal < 0  ? '<span style="color:var(--green);font-weight:700">' + ERP.fmt(advance)+' Cr (Advance)</span>'
                  :                  '<span style="color:var(--green);font-weight:700">All Settled</span>';

      var entries = (ERP._Ledger ? ERP._Ledger.getForCustomer(custId) : []).slice().sort(function (a, b) {
        var d = _dateCompare(a.date, b.date);
        return d !== 0 ? d : (a.id || a.ref || '').localeCompare(b.id || b.ref || '');
      });

      var rows = entries.map(function(e) {
        var typeLabel = _e({ OPENING_BALANCE:'Opening Balance', INVOICE:'Invoice', PAYMENT:'Payment',
                          CREDIT_NOTE:'Credit Note', PAYMENT_VOID:'Payment Void', ADJUSTMENT:'Adjustment' }[e.type] || e.type || '');
        var balColor  = (e.balance || 0) > 0 ? 'var(--red)' : (e.balance || 0) < 0 ? 'var(--green)' : '';
        return '<tr>'
          + '<td>' + _e(e.date || '') + '</td>'
          + '<td>' + typeLabel + '</td>'
          + '<td class="mono">' + _e(e.ref || '') + '</td>'
          + '<td class="mono" style="color:var(--red)">'   + (e.debit  > 0 ? ERP.fmt(e.debit)  : '—') + '</td>'
          + '<td class="mono" style="color:var(--green)">' + (e.credit > 0 ? ERP.fmt(e.credit) : '—') + '</td>'
          + '<td class="mono fw" style="color:' + balColor + '">' + ERP.fmt(Math.abs(e.balance || 0)) + (e.balance < 0 ? ' Cr' : e.balance > 0 ? ' Dr' : '') + '</td>'
          + '</tr>';
      }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:20px">No ledger entries found</td></tr>';

      var html = '<div style="padding:14px">'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;font-size:13px">'
        + '<div><b>Phone:</b> ' + _e(c.ph || '—') + '</div>'
        + '<div><b>Vehicle:</b> ' + _e(c.veh || '—') + '</div>'
        + '<div><b>Balance:</b> ' + balLabel + '</div>'
        + '<div><b>Loyalty Points:</b> ' + (c.pts || 0) + ' pts</div>'
        + '<div><b>Outstanding (unpaid invoices):</b> <span style="color:var(--red)">' + ERP.fmt(outstanding) + '</span></div>'
        + (advance > 0 ? '<div><b>Advance Available:</b> <span style="color:var(--green)">' + ERP.fmt(advance) + '</span></div>' : '')
        + (c.creditLimit ? '<div><b>Available Credit:</b> ' + ERP.fmt(availCredit) + ' of ' + ERP.fmt(c.creditLimit) + '</div>' : '')
        + '</div>'
        + '<table class="dt"><thead><tr><th>Date</th><th>Type</th><th>Ref</th><th style="color:var(--red)">Debit</th><th style="color:var(--green)">Credit</th><th>Balance</th></tr></thead>'
        + '<tbody>' + rows + '</tbody></table>'
        + '<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">'
        + '<span style="font-size:12px;color:var(--muted)">Current Balance: ' + balLabel + '</span>'
        + '<div style="display:flex;gap:8px">'
        + '<button id="ledger-print-btn" style="background:#475569;color:#fff;border:none;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">🖨️ Print</button>'
        + '<button data-action="cust:creditReturn" data-cust-id="' + _e(String(c.id || '')) + '" data-cust-name="' + _e(c.n || '') + '" style="background:#0369a1;color:#fff;border:none;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">↩️ Issue Refund / Credit Return</button>'
        + '</div></div></div>';

      var titleEl = document.getElementById('ledger-modal-title');
      var bodyEl  = document.getElementById('ledger-modal-body');
      if (titleEl) titleEl.textContent = 'Customer Ledger: ' + (c.n || '');
      if (bodyEl)  bodyEl.innerHTML = html;
      var printBtn = document.getElementById('ledger-print-btn');
      if (printBtn) printBtn.addEventListener('click', function () {
        _openPrintWindow('Customer Ledger: ' + (c.n || ''),
          '<div style="margin-bottom:8px;font-size:13px"><b>Phone:</b> ' + _e(c.ph || '—') + ' &nbsp; <b>Vehicle:</b> ' + _e(c.veh || '—') + ' &nbsp; <b>Balance:</b> ' + balLabel + '</div>',
          '<table><thead><tr><th>Date</th><th>Type</th><th>Ref</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>' + rows + '</tbody></table>');
      });
      var modal = document.getElementById('ledgerModal');
      if (modal) { modal.classList.add('open'); document.body.style.overflow = 'hidden'; }
    }

    function sendWA(idx) {
      var c = _custs()[idx];
      if (!c || !c.ph) { ERP.ui.toast('This customer has no phone number', 'warning'); return; }
      var ph = _waPhone(c.ph);
      if (!ph) { ERP.ui.toast('This customer\u2019s phone number looks invalid', 'warning'); return; }
      var biz = _gs().biz;
      var msg = 'السلام علیکم ' + c.n + ',\n\n' + _bizName() + ' mein tashreef lane ka shukriya!\n\nOutstanding: ' + ERP.fmt(((ERP._calcCustomerOutstanding ? ERP._calcCustomerOutstanding(String(c.id||c.n||'')) : 0))) + '\nLoyalty Points: ' + (c.pts || 0) + '\n\n' + (biz.phone || '');
      // FIX (root cause, audit #96): route through the one canonical wa.me builder/opener.
      if (window.ERP && ERP.WhatsAppLink && typeof ERP.WhatsAppLink.open === 'function') {
        ERP.WhatsAppLink.open(ph, msg);
      } else {
        (function (u) { var w = window.open(u, '_blank', 'noopener,noreferrer'); if (!w) { window.location.href = u; } }('https://wa.me/' + ph + '?text=' + encodeURIComponent(msg)));
      }
    }

    function sendBirthdayWishes() {
      var bdays = _custs().filter(function (c) { return _isToday(c.bday) && c.ph; }).filter(function (c) { return !!_waPhone(c.ph); });
      if (!bdays.length) { ERP.ui.toast('No birthdays today', 'info'); return; }
      var bizName = _bizName();
      bdays.forEach(function (c, i) {
        setTimeout(function () {
          var ph = _waPhone(c.ph);
          var msg = 'Happy Birthday ' + c.n + '! 🎂\n\n' + bizName + ' ki taraf se dil se mubarak ho!\nAap hamesha humari special customer hain. 🚗';
          // FIX (root cause, audit #96): route through the one canonical wa.me builder/opener,
          // preserving the per-customer pop-up-blocked toast via the onBlocked callback.
          if (window.ERP && ERP.WhatsAppLink && typeof ERP.WhatsAppLink.open === 'function') {
            ERP.WhatsAppLink.open(ph, msg, function () {
              ERP.ui.toast('⚠️ Pop-up blocked for ' + (c.n || 'a customer') + ' — please allow pop-ups to send all wishes', 'warning');
            });
          } else {
            var u = 'https://wa.me/' + ph + '?text=' + encodeURIComponent(msg);
            var w = window.open(u, '_blank', 'noopener,noreferrer');
            if (!w) ERP.ui.toast('⚠️ Pop-up blocked for ' + (c.n || 'a customer') + ' — please allow pop-ups to send all wishes', 'warning');
          }
        }, i * 600);
      });
      ERP.ui.toast('Sending birthday wishes to ' + bdays.length + ' customer(s)…', 'success');
    }

    function sendServiceReminders() {
      var custs = _custs().filter(function (c) { return c.ph; });
      if (!custs.length) { ERP.ui.toast('No customers found with phone numbers', 'info'); return; }
      var bizName = _bizName();
      var bizPhone = _gs().biz.phone || '';
      var validCusts = custs.filter(function (c) { return !!_waPhone(c.ph); });
      validCusts.forEach(function (c, i) {
        setTimeout(function () {
          var ph = _waPhone(c.ph);
          var msg = 'السلام علیکم ' + c.n + ',\n\nAap ke vehicle ki service ka time aa gaya hai. ' + bizName + ' mein appointment book karein!\n\nAaj hi call karein: ' + bizPhone;
          // FIX (root cause, audit #96): route through the one canonical wa.me builder/opener,
          // preserving the per-customer pop-up-blocked toast via the onBlocked callback.
          if (window.ERP && ERP.WhatsAppLink && typeof ERP.WhatsAppLink.open === 'function') {
            ERP.WhatsAppLink.open(ph, msg, function () {
              ERP.ui.toast('⚠️ Pop-up blocked for ' + (c.n || 'a customer') + ' — please allow pop-ups to send all reminders', 'warning');
            });
          } else {
            var u = 'https://wa.me/' + ph + '?text=' + encodeURIComponent(msg);
            var w = window.open(u, '_blank', 'noopener,noreferrer');
            if (!w) ERP.ui.toast('⚠️ Pop-up blocked for ' + (c.n || 'a customer') + ' — please allow pop-ups to send all reminders', 'warning');
          }
        }, i * 600);
      });
      ERP.ui.toast('Sending service reminders to ' + validCusts.length + ' customer(s)…', 'success');
    }

    ERP.events.on('customers:updated', function () {
      if (_gs().ui.page === 'customers') render();
    });

    ERP.registerRenderer('customers', function () { render(); });

    return {
      render: render, search: search, openAdd: openAdd,
      openEdit: openEdit, closeModal: closeModal, save: save, del: del,
      viewLedger: viewLedger, sendWA: sendWA, filterVIP: filterVIP,
      filterCredit: filterCredit, sendBirthdayWishes: sendBirthdayWishes,
      sendServiceReminders: sendServiceReminders
    };
  }());

  ERP.sup = (function () {
    'use strict';

    var _sups = function () { return _gs().data.suppliers  || []; };
    var _purs = function () {
      if (typeof PurchaseState !== 'undefined' && typeof PurchaseState.getAllPurchases === 'function')
        return PurchaseState.getAllPurchases();
      return _gs().data.purchases || [];
    };
    var _purPayments = function () {
      if (typeof PurchaseState !== 'undefined' && typeof PurchaseState.getAllPayments === 'function')
        return PurchaseState.getAllPayments();
      return [];
    };
    var _purReturns = function () {
      if (typeof PurchaseState !== 'undefined' && typeof PurchaseState.getAllReturns === 'function')
        return PurchaseState.getAllReturns();
      return [];
    };

    function _liveSupOwe(s) {
      var _ps4h = window.PurchaseState || null;
      var _liveOwePaisa = (_ps4h && typeof _ps4h.getLedgerBalance === 'function')
        ? _ps4h.getLedgerBalance((s.id || s.n || '').toString().toLowerCase().trim())
        : null;
      return (_liveOwePaisa !== null) ? Math.round(_liveOwePaisa) / 100 : (s.owe || 0);
    }

    function render(list) {
      try {
        var sups         = list || _sups();
        var tb           = document.getElementById('sup-tbody');
        if (!tb) return;
        var MAX_SUP_ROWS = 200;
        if (!sups.length) {
          tb.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--muted)">No suppliers yet — <button class="btn btn-ghost btn-sm" data-action="party:addSupplier">+ Add First Supplier</button></td></tr>';
        } else {
          var visibleSups = sups.slice(0, MAX_SUP_ROWS);
          var fullSupList = _sups();
          tb.innerHTML = visibleSups.map(function (s) {
            var i = fullSupList.indexOf(s);
            if (i < 0) i = _findById(fullSupList, s.id, s.n);
            var _rawOwe = _liveSupOwe(s);
            var _isAdvance = _rawOwe < 0;
            var _dispOwe = Math.abs(_rawOwe);
            var _balCell = _isAdvance
              ? '<td class="mono" style="color:var(--green);font-weight:600">' + ERP.fmt(_dispOwe) + ' Cr</td>'
              : _rawOwe > 0
                ? '<td class="mono" style="color:var(--red);font-weight:600">' + ERP.fmt(_dispOwe) + '</td>'
                : '<td class="mono muted">—</td>';
            return '<tr>'
              + '<td class="fw">' + _e(s.n || '') + '</td>'
              + '<td>' + _e(s.ph || s.phone || '') + '</td>'
              + '<td class="muted">' + _e(s.addr || s.address || s.city || '') + '</td>'
              + '<td class="mono" style="color:var(--gold);font-weight:600">' + ERP.fmt((s.purchases || 0)) + '</td>'
              + _balCell
              + '<td><span class="badge b-green">Active</span></td>'
              + '<td><div style="display:flex;gap:4px;flex-wrap:wrap">'
                + '<button class="btn btn-ghost btn-sm" data-action="sup:view"   data-idx="' + i + '"><svg><use href="#ic-eye"/></svg> View</button>'
                + '<button class="btn btn-ghost btn-sm" data-action="sup:ledger" data-idx="' + i + '"><svg><use href="#ic-receipt"/></svg> Ledger</button>'
                + '<button class="btn btn-ghost btn-sm" data-action="sup:edit"   data-idx="' + i + '"><svg><use href="#ic-edit"/></svg></button>'
                + (s.ph || s.phone ? '<button class="btn btn-whatsapp btn-sm" data-action="sup:wa" data-idx="' + i + '"><svg style="width:12px;height:12px"><use href="#ic-whatsapp"/></svg></button>' : '')
                + '<button class="btn btn-danger btn-sm" data-confirm="0" data-action="sup:del" data-idx="' + i + '"><svg><use href="#ic-trash"/></svg></button>'
                + '</div></td>'
              + '</tr>';
          }).join('');
          if (sups.length > MAX_SUP_ROWS) {
            tb.innerHTML += '<tr><td colspan="7" style="text-align:center;padding:10px;color:var(--muted);font-size:12px">Showing first ' + MAX_SUP_ROWS + ' of ' + sups.length + ' — use search to filter</td></tr>';
          }
        }

        var all          = _sups();
        var totalPayable = all.reduce(function (s, sup) { return s + Math.max(0, _liveSupOwe(sup)); }, 0);
        var purs         = _purs();
        var pending      = purs.filter(function (p) { var st=(p.st||p.status||'').toLowerCase(); return st!=='completed'&&st!=='complete'&&st!=='returned'; }).length;
        var completed    = purs.filter(function (p) { var st=(p.st||p.status||'').toLowerCase(); return st==='completed'||st==='complete'; }).length;
        var el;
        el = document.getElementById('sup-total-cnt');      if (el) el.textContent = all.length;
        el = document.getElementById('sup-payable');        if (el) el.textContent = ERP.fmt(totalPayable);
        el = document.getElementById('sup-pending-orders'); if (el) el.textContent = pending;
        el = document.getElementById('sup-completed-orders'); if (el) el.textContent = completed;

        var dl = document.getElementById('sup-datalist');
        if (dl) {
          dl.innerHTML = all.map(function (s) {
            return '<option value="' + _e(s.n || '') + '" data-ph="' + _e(s.ph || '') + '">';
          }).join('');
        }
      } catch (e) { console.error('[ERP.sup render]', e); }
    }

    function search(q) {
      if (!(q || '').trim()) { render(); return; }
      render(_sups().filter(function (s) {
        return _partyTextMatch([s.n, s.ph, s.addr], q);
      }));
    }

    function openAdd() {
      if (ERP.parties && ERP.parties.openAdd) { ERP.parties.openAdd('supplier'); return; }
      ERP.ui.toast('Add Supplier unavailable — parties module failed to load. Please reload the page.', 'error');
    }

    function openEdit(idx) {
      if (ERP.parties && ERP.parties.openEdit) { ERP.parties.openEdit('supplier', idx); return; }
      ERP.ui.toast('Edit unavailable — parties module failed to load. Please reload the page.', 'error');
    }

    function closeModal() {
      if (ERP.parties && ERP.parties.closeAdd) ERP.parties.closeAdd();
    }

    async function save() {
      if (ERP.parties && ERP.parties.saveNew) { return await ERP.parties.saveNew(); }
      ERP.ui.toast('Save unavailable — parties module failed to load. Please reload the page.', 'error');
    }

    function del(idx, btn) {
      var s = _sups()[idx];
      if (!s) return;
      if (!_canManageParties('suppliers:delete')) {
        ERP.ui.toast('You do not have permission to delete suppliers', 'error');
        return;
      }
      if (btn && btn.dataset.confirm !== '1') {
        btn.dataset.confirm = '1';
        btn.innerHTML = '⚠️ Sure?';
        setTimeout(function () { if (btn) { btn.dataset.confirm = '0'; btn.innerHTML = '<svg><use href="#ic-trash"/></svg>'; } }, 3000);
        return;
      }
      if (btn) { btn.dataset.confirm = '0'; btn.innerHTML = '<svg><use href="#ic-trash"/></svg>'; }
      try {
        var supId = String(s.id || '');
        var supNameLc = (s.n || '').toLowerCase().trim();
        var purchases = ERP.getState ? (ERP.getState().data.purchases || []) : [];
        var openPOs = purchases.filter(function(p) {
          if (p.deleted) return false;
          var pSupRef = String(p.supplierId || p.supplierName || '').toLowerCase().trim();
          var matches = (supId && pSupRef === supId.toLowerCase()) || (supNameLc && pSupRef === supNameLc);
          if (!matches) return false;
          return (p.status || '').toLowerCase() !== 'paid' && (p.status || '').toLowerCase() !== 'cancelled';
        });
        if (openPOs.length > 0) {
          ERP.ui.toast('❌ Supplier cannot be deleted — ' + openPOs.length + ' unpaid bill(s) hain. Pehle bills settle karein.', 'error', 0);
          return;
        }
        var liveOwe = _liveSupOwe(s);
        if (Math.abs(liveOwe) > 0) {
          ERP.ui.toast('❌ Supplier cannot be deleted — outstanding balance ' + ERP.fmt(Math.abs(liveOwe)) + ' hai. Pehle balance clear karein.', 'error', 0);
          return;
        }
      } catch (checkErr) { console.warn('[sup.del] balance check failed:', checkErr); ERP.ui.toast('Delete check failed — please try again', 'error'); return; }
      _st(function (st) {
        var freshIdx = _findById(st.data.suppliers, s.id, s.n);
        if (freshIdx >= 0) st.data.suppliers.splice(freshIdx, 1);
      }, 'suppliers');
      ERP.Persistence.save('suppliers', _sups()).catch(function (e) { console.warn('[sup.del]', e); });
      try { window.suppliers = _sups(); } catch (_) {}
      ERP.events.emit('suppliers:updated');
      ERP.ui.toast('Supplier deleted', 'success');
    }

    function viewDetail(idx) {
      var s    = _sups()[idx];
      if (!s) return;
      var _supId = String(s.id || '');
      var _supNameLc = (s.n || '').toLowerCase();
      var purs = _purs().filter(function (p) {
        if (_supId && p.supplierId && String(p.supplierId) === _supId) return true;
        return (p.sup || p.supplierName || p.supplier || '').toLowerCase() === _supNameLc;
      });
      var html = '<div style="padding:14px">'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;font-size:13px">'
        + '<div><b>Phone:</b> '          + _e(s.ph   || '—') + '</div>'
        + '<div><b>Address:</b> '        + _e(s.addr || '—') + '</div>'
        + '<div><b>Total Purchases:</b> ' + ERP.fmt((s.purchases || 0)) + '</div>'
        + (function () {
            var _rawOwe = _liveSupOwe(s);
            if (_rawOwe < 0) return '<div><b>Advance Paid:</b> <span style="color:var(--green)">' + ERP.fmt(Math.abs(_rawOwe)) + '</span></div>';
            return '<div><b>Outstanding:</b> ' + ERP.fmt(_rawOwe) + '</div>';
          })()
        + '</div>'
        + '<h4 style="margin:0 0 8px;font-size:13px">Purchase History</h4>'
        + '<table class="dt"><thead><tr><th>PO #</th><th>Date</th><th>Items</th><th>Amount</th><th>Status</th></tr></thead><tbody>'
        + (purs.map(function (p) {
            var stMap = { completed: 'b-green', partial: 'b-orange', pending: 'b-blue', returned: 'b-red', paid: 'b-green' };
            var _stKey = (p.st || p.status || '').toLowerCase();
            var _itemCount = Array.isArray(p.itemsList) ? p.itemsList.length : Array.isArray(p.items) ? p.items.length : (typeof p.itemCount === 'number' ? p.itemCount : 0);
            return '<tr><td class="mono">' + _e(p.id || '') + '</td><td>' + _e(p.date || '—') + '</td>'
              + '<td>' + _itemCount + ' items</td>'
              + '<td class="mono">' + ERP.fmt((p.amt || 0)) + '</td>'
              + '<td><span class="badge ' + (stMap[_stKey] || 'b-gray') + '">' + _e(p.st || p.status || '—') + '</span></td></tr>';
          }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:16px">No purchases yet</td></tr>')
        + '</tbody></table></div>';

      var titleEl = document.getElementById('ledger-modal-title');
      var bodyEl  = document.getElementById('ledger-modal-body');
      if (titleEl) titleEl.textContent = 'Supplier Details: ' + (s.n || '');
      if (bodyEl)  bodyEl.innerHTML = html;
      var modal = document.getElementById('ledgerModal');
      if (modal) { modal.classList.add('open'); document.body.style.overflow = 'hidden'; }
    }

    function viewLedger(idx) {
      var s    = _sups()[idx];
      if (!s) return;
      var _sid2  = String(s.id || '');
      var _sName = (s.n || '').toLowerCase();

      var _matchSup = function (p) {
        if (p._deleted || p.deleted || p.voided) return false;
        var nameMatch = (p.supplierName || p.sup || p.supplier || p.supplierId || '').toLowerCase() === _sName;
        var idMatch   = _sid2 && ((String(p.supplierId || '') === _sid2) || (p.supplierId || '').toLowerCase() === _sName);
        return nameMatch || idMatch;
      };

      var purs     = _purs().filter(_matchSup).sort(function (a, b) { return _dateCompare(a.date, b.date); });
      var payments = _purPayments().filter(_matchSup).sort(function (a, b) { return _dateCompare(a.date, b.date); });
      var returns  = _purReturns().filter(_matchSup).sort(function (a, b) { return _dateCompare(a.date, b.date); });

      var allTxns = [];
      var _standaloneRefs = {};
      payments.forEach(function (p) {
        var refs = [p.referenceId, p.purchaseId, p.poId, p.billId];
        refs.forEach(function (ref) {
          if (ref) _standaloneRefs[String(ref)] = true;
        });
      });

      purs.forEach(function (p) {
        var total = p.total || p.amt || p.grand || 0;
        var paid  = p.paid  || p.paidAmount || 0;
        allTxns.push({ type: 'purchase', date: p.date || '', id: p.id || '', desc: 'Purchase Bill — ' + ((p.itemsList || p.items || []).length) + ' items', payable: total, credit: 0 });
        if (paid > 0 && !_standaloneRefs[String(p.id)]) {
          allTxns.push({ type: 'payment_on_bill', date: p.date || '', id: p.id + '-pay', desc: 'Payment on Bill: ' + p.id + ' (' + (p.payType || 'Cash') + ')', payable: 0, credit: paid });
        }
      });
      payments.forEach(function (p) {
        allTxns.push({ type: 'payment', date: p.date || '', id: p.id || '', desc: 'Payment Out' + (p.reference ? ' — Ref: ' + p.reference : '') + (p.method ? ' (' + p.method + ')' : ''), payable: 0, credit: p.amount || p.amt || 0 });
      });
      returns.forEach(function (r) {
        allTxns.push({ type: 'return', date: r.date || '', id: r.id || '', desc: 'Purchase Return' + (r.purchaseId ? ' — ' + r.purchaseId : '') + (r.reason ? ': ' + r.reason : ''), payable: 0, credit: r.total || 0 });
      });

      var _psVL = window.PurchaseState || null;
      if (_psVL && typeof _psVL.getSupplierLedgerEntries === 'function') {
        var _obAdjKey = (s.id || s.n || '').toString().toLowerCase().trim();
        _psVL.getSupplierLedgerEntries(_obAdjKey).filter(function (e) {
          return e.type === 'OPENING_BALANCE' || e.type === 'ADJUSTMENT';
        }).forEach(function (e) {
          allTxns.push({
            type: e.type === 'OPENING_BALANCE' ? 'opening_balance' : 'adjustment',
            date: e.date || '',
            id: e.referenceId || e.id || '',
            desc: (e.type === 'OPENING_BALANCE' ? 'Opening Balance' : 'Balance Adjustment') + (e.note ? ' — ' + e.note : ''),
            payable: (e.credit || 0) / 100,
            credit: (e.debit || 0) / 100
          });
        });
      }

      allTxns.sort(function (a, b) {
        var d = _dateCompare(a.date, b.date);
        return d !== 0 ? d : (a.id || '').localeCompare(b.id || '');
      });

      var bal  = 0;
      var rows = [];
      allTxns.forEach(function (t) {
        bal += (t.payable || 0) - (t.credit || 0);
        var balColor = bal > 0 ? 'var(--red)' : 'var(--green)';
        rows.push('<tr>'
          + '<td>' + _e(t.date || '—') + '</td>'
          + '<td class="mono">' + _e(t.id || '') + '</td>'
          + '<td>' + _e(t.desc || '') + '</td>'
          + '<td class="mono" style="color:var(--red)">' + (t.payable > 0 ? ERP.fmt(Math.round(t.payable)) : '—') + '</td>'
          + '<td class="mono" style="color:var(--green)">' + (t.credit > 0 ? ERP.fmt(Math.round(t.credit)) : '—') + '</td>'
          + '<td class="mono fw" style="color:' + balColor + '">' + ERP.fmt(Math.abs(Math.round(bal))) + (bal > 0 ? ' Dr' : bal < 0 ? ' Cr' : '') + '</td>'
          + '</tr>');
      });
      if (!rows.length) rows.push('<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:16px">No transactions found</td></tr>');

      var balLabel = bal > 0 ? 'We Owe (Payable)' : bal < 0 ? 'Advance Paid' : 'Settled';
      var balColorFinal = bal > 0 ? 'var(--red)' : bal < 0 ? 'var(--green)' : '#888';
      var html = '<div style="padding:14px">'
        + '<div style="margin-bottom:10px;font-size:13px;display:flex;gap:20px;flex-wrap:wrap;align-items:center">'
        + '<span><b>Phone:</b> ' + _e(s.ph || '—') + '</span>'
        + '<span><b>' + _e(balLabel) + ':</b> <span style="color:' + balColorFinal + ';font-weight:700">' + ERP.fmt(Math.abs(Math.round(bal))) + '</span></span>'
        + '<button id="ledger-print-btn" style="margin-left:auto;background:#475569;color:#fff;border:none;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">🖨️ Print</button>'
        + '</div>'
        + '<table class="dt"><thead><tr><th>Date</th><th>Ref #</th><th>Description</th><th style="color:var(--red)">Payable (Dr)</th><th style="color:var(--green)">Paid/Return (Cr)</th><th>Balance</th></tr></thead>'
        + '<tbody>' + rows.join('') + '</tbody></table></div>';

      var titleEl = document.getElementById('ledger-modal-title');
      var bodyEl  = document.getElementById('ledger-modal-body');
      if (titleEl) titleEl.textContent = 'Supplier Ledger: ' + (s.n || '');
      if (bodyEl)  bodyEl.innerHTML = html;
      var printBtn = document.getElementById('ledger-print-btn');
      if (printBtn) printBtn.addEventListener('click', function () {
        _openPrintWindow('Supplier Ledger: ' + (s.n || ''),
          '<div style="margin-bottom:8px;font-size:13px"><b>Phone:</b> ' + _e(s.ph || '—') + ' &nbsp; <b>' + _e(balLabel) + ':</b> ' + ERP.fmt(Math.abs(Math.round(bal))) + '</div>',
          '<table><thead><tr><th>Date</th><th>Ref #</th><th>Description</th><th>Payable (Dr)</th><th>Paid/Return (Cr)</th><th>Balance</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>');
      });
      var modal = document.getElementById('ledgerModal');
      if (modal) { modal.classList.add('open'); document.body.style.overflow = 'hidden'; }
    }

    function sendWA(idx) {
      var s = _sups()[idx];
      var rawPh = s && (s.ph || s.phone);
      if (!s || !rawPh) { ERP.ui.toast('This supplier has no phone number', 'warning'); return; }
      var ph = _waPhone(rawPh);
      if (!ph) { ERP.ui.toast('This supplier\u2019s phone number looks invalid', 'warning'); return; }
      var owe = Math.max(0, _liveSupOwe(s));
      var msg = 'السلام علیکم ' + (s.n || '') + ',\n\n' + _bizName() + ' ki taraf se sampark.\n\nOutstanding Payable: ' + ERP.fmt(owe) + '\n\n' + (_gs().biz.phone || '');
      // FIX (root cause, audit #96): route through the one canonical wa.me builder/opener.
      if (window.ERP && ERP.WhatsAppLink && typeof ERP.WhatsAppLink.open === 'function') {
        ERP.WhatsAppLink.open(ph, msg);
      } else {
        (function (u) { var w = window.open(u, '_blank', 'noopener,noreferrer'); if (!w) { window.location.href = u; } }('https://wa.me/' + ph + '?text=' + encodeURIComponent(msg)));
      }
    }

    ERP.events.on('suppliers:updated', function () {
      if (ERP.state.get().ui.page === 'supplier') render();
    });

    ERP.registerRenderer('supplier', function () { render(); });

    return {
      render: render, search: search, openAdd: openAdd,
      openEdit: openEdit, closeModal: closeModal, save: save, del: del,
      viewDetail: viewDetail, viewLedger: viewLedger, sendWA: sendWA
    };
  }());

  ERP.parties = (function () {
    'use strict';

    var _custs = function () { return _gs().data.customers || []; };
    var _sups  = function () { return _gs().data.suppliers || []; };

    var _tab            = 'customers';
    var _apmType        = 'customer';
    var _selectedParty  = null;
    var _editIdx        = -1;
    var _partyListData  = [];

    function _getList() {
      if (_tab === 'customers') {
        var _seenNames = {};
        var _dedupedCusts = _custs().filter(function (c) {
          var k = (c.n || c.name || '').trim().toLowerCase();
          if (!k || _seenNames[k]) return false;
          _seenNames[k] = true;
          return true;
        });
        return _dedupedCusts.map(function (c) {
          var _lbal = ERP._Ledger ? ERP._Ledger.getBalance(String(c.id || c.n || '')) : 0;
          return { name: c.n || '', phone: c.ph || '', veh: c.veh || '', bal: _lbal, type: 'customer', raw: c };
        });
      } else {
        var _seenSupNames = {};
        var _dedupedSups = _sups().filter(function (s) {
          var k = (s.n || s.name || '').trim().toLowerCase();
          if (!k || _seenSupNames[k]) return false;
          _seenSupNames[k] = true;
          return true;
        });
        return _dedupedSups.map(function (s) {
          var _psList = window.PurchaseState || null;
          var _liveBalPaisa = (_psList && typeof _psList.getLedgerBalance === 'function')
            ? _psList.getLedgerBalance((s.id || s.n || '').toString().toLowerCase().trim())
            : null;
          var _supBal = (_liveBalPaisa !== null) ? _liveBalPaisa / 100 : (s.owe || 0);
          return { name: s.n || '', phone: s.ph || s.phone || '', bal: _supBal, type: 'supplier', raw: s };
        });
      }
    }

    function renderList(filter) {
      var body = document.getElementById('party-list-body');
      if (!body) return;
      var list = _getList();
      if (filter) {
        list = list.filter(function (p) {
          return _partyTextMatch([p.name, p.phone, p.veh], filter);
        });
      }
      if (!list.length) {
        body.innerHTML = '<div class="party-list-empty">'
          + '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>'
          + '<p>No ' + _tab + ' found.</p>'
          + '<button class="btn-add-first" data-action="party:addCustomer">+ Add First Party</button>'
          + '</div>';
        return;
      }
      body.innerHTML = list.map(function (p, idx) {
        var init  = ERP.escapeHtml((p.name || '?').charAt(0).toUpperCase());
        var balUI = _balDrCr(p.bal, 'hex');
        return '<div class="party-list-item" data-action="party:select" data-idx="' + idx + '" id="party-item-' + idx + '">'
          + '<div class="party-avatar">' + init + '</div>'
          + '<div class="party-info"><div class="party-name">' + ERP.escapeHtml(p.name || 'Unknown') + '</div>'
            + (p.phone ? '<div class="party-phone">📞 ' + ERP.escapeHtml(p.phone) + '</div>' : '')
          + '</div>'
          + '<div class="party-bal" style="color:' + balUI.color + '">' + balUI.text + '</div>'
          + '</div>';
      }).join('');
      _partyListData = list;
    }

    function filterList(val) { renderList(val); }

    function switchTab(tab) {
      _tab = tab;
      _apmType = (tab === 'customers') ? 'customer' : 'supplier';
      ['customers', 'suppliers'].forEach(function (t) {
        var el = document.getElementById('party-tab-' + t);
        if (el) { if (t === tab) el.classList.add('active'); else el.classList.remove('active'); }
      });
      _selectedParty = null;
      var empty   = document.getElementById('party-detail-empty');
      var content = document.getElementById('party-detail-content');
      if (empty)   empty.style.display   = '';
      if (content) content.style.display = 'none';
      renderList();
    }

    function selectParty(idx) {
      document.querySelectorAll('.party-list-item').forEach(function (el) { el.classList.remove('active'); });
      var item = document.getElementById('party-item-' + idx);
      if (item) item.classList.add('active');
      var party = _partyListData && _partyListData[idx];
      if (!party) return;
      _selectedParty = party;
      renderDetail(party);
    }

    function renderDetail(party) {
      var empty   = document.getElementById('party-detail-empty');
      var content = document.getElementById('party-detail-content');
      if (empty) empty.style.display = 'none';
      if (!content) return;
      content.style.display = 'block';

      var txns  = [];
      var _data = _gs().data || {};
      var sales = _data.sales    || [];
      var purs  = _data.purchases || [];
      var payIns  = _data.payIn   || [];
      var payOuts = _data.payOut  || [];
      var saleRets = _data.saleReturns || [];
      var purRets  = (_data.purchaseReturns) || [];
      try{ if(!purs.length&&window.PurchaseState&&typeof window.PurchaseState.getAllPurchases==='function')purs=window.PurchaseState.getAllPurchases(); }catch(_e){}
      try{ if(!purRets.length&&window.PurchaseState&&typeof window.PurchaseState.getAllReturns==='function')purRets=window.PurchaseState.getAllReturns(); }catch(_e){}
      if (party.type === 'customer') {
        var pnLC = (party.name || '').toLowerCase();
        var pid  = String((party.raw && party.raw.id) || '');
        var custSales = sales.filter(function(s){
          if(s.deleted) return false;
          var sn=(s.customer||s.cust||s.cn||'').toLowerCase();
          var si=String(s.customerId||'');
          return sn===pnLC||(pid&&si===pid);
        });
        custSales.forEach(function(s){
          var amt=s.total||s.gt||(s.items||[]).reduce(function(sum,i){return sum+(i.q||0)*(i.p||0)-(i.d||0);},0)||0;
          var txnStatus=s.status==='paid'?'Paid':s.status==='partial'?'Partial':'Unpaid';
          txns.push({type:'Sale',date:s.date||'',amount:amt,status:txnStatus,color:'txn-sale'});
        });
        payIns.filter(function(p){
          if(p.voided) return false;
          var pn=(p.customer||p.cust||'').toLowerCase();
          var pi=String(p.customerId||'');
          return pn===pnLC||(pid&&pi===pid);
        }).forEach(function(p){
          txns.push({type:'Payment',date:p.date||'',amount:p.amount||0,status:'Received',color:'txn-payment'});
        });
        saleRets.filter(function(r){
          if (r.voided || r.deleted) return false;
          var rn=(r.customer||r.cust||'').toLowerCase();
          var ri=String(r.customerId||'');
          var matchInv=custSales.some(function(s){return s.id===(r.originalInv||r.originalId);});
          return rn===pnLC||(pid&&ri===pid)||matchInv;
        }).forEach(function(r){
          txns.push({type:'Return',date:r.date||'',amount:r.returnGrand||r.amount||0,status:'Returned',color:'txn-return'});
        });
      } else {
        var spnLC = (party.name || '').toLowerCase();
        var spid  = String((party.raw && party.raw.id) || '');
        purs.filter(function(p){
          if(p.deleted) return false;
          var pn=(p.sup||p.supplierName||p.supplier||'').toLowerCase();
          var pi=String(p.supplierId||'');
          return pn===spnLC||(spid&&pi===spid);
        }).forEach(function(p){
          var st=(p.status||p.st||'').toLowerCase();
          var txnStatus=st==='complete'||st==='completed'||st==='paid'?'Paid':st==='partial'?'Partial':'Pending';
          txns.push({type:'Purchase',date:p.date||'',amount:p.total||p.amt||0,status:txnStatus,color:'txn-purchase'});
        });
        payOuts.filter(function(p){
          if(p.voided) return false;
          var pn=(p.supplier||p.supplierName||p.sup||'').toLowerCase();
          var pi=String(p.supplierId||'');
          return pn===spnLC||(spid&&pi===spid);
        }).forEach(function(p){
          txns.push({type:'Payment Out',date:p.date||'',amount:p.amount||p.amt||0,status:'Paid',color:'txn-payment'});
        });
        purRets.filter(function(r){
          var rn=(r.supplierName||r.sup||'').toLowerCase();
          var ri=String(r.supplierId||'');
          return rn===spnLC||(spid&&ri===spid);
        }).forEach(function(r){
          txns.push({type:'Return',date:r.date||'',amount:r.total||0,status:'Returned',color:'txn-return'});
        });
      }
      txns.sort(function (a, b) { return _dateCompare(b.date, a.date); });

      var balUI    = _balDrCr(party.bal, 'var');
      var balColor = balUI.color;
      var balText  = balUI.text;
      var balSub   = party.type === 'customer'
        ? (party.bal > 0 ? 'You will receive' : party.bal < 0 ? 'You will pay' : 'All settled')
        : (party.bal > 0 ? 'You will pay' : party.bal < 0 ? 'You will receive' : 'All settled');
      var init     = ERP.escapeHtml((party.name || '?').charAt(0).toUpperCase());
      var pname    = ERP.escapeHtml(party.name || 'Party');
      var ph       = party.phone || '';

      content.innerHTML =
        '<div class="party-card">'
        + '<div class="party-card-header">'
        +   '<div class="party-card-name-row">'
        +     '<div class="party-big-avatar">' + init + '</div>'
        +     '<div><div class="party-card-name">' + pname + '</div>'
        +     '<span class="party-card-type">' + (party.type === 'customer' ? 'Customer' : 'Supplier') + '</span></div>'
        +   '</div>'
        +   '<div class="party-card-action-row">'
        +     '<button class="btn-party-edit"     data-action="party:edit">✏️ Edit</button>'
        +     '<button class="btn-party-stmt"     data-action="party:statement">📄 Statement</button>'
        +     (ph ? '<button class="btn-party-whatsapp" data-action="party:whatsapp" data-phone="' + ph.replace(/\D/g, '') + '">💬 WhatsApp</button>' : '')
        +   '</div>'
        + '</div>'
        + '<div class="party-info-grid">'
        +   '<div class="party-info-cell"><div class="party-info-label">Phone</div><div class="party-info-value">'  + ERP.escapeHtml(ph || '—') + '</div></div>'
        +   '<div class="party-info-cell"><div class="party-info-label">Email</div><div class="party-info-value">'  + ERP.escapeHtml((party.raw && party.raw.email)  || '—') + '</div></div>'
        +   '<div class="party-info-cell"><div class="party-info-label">GSTIN / NTN</div><div class="party-info-value">' + ERP.escapeHtml((party.raw && party.raw.gstin) || '—') + '</div></div>'
        + '</div>'
        + '<div class="party-balance-banner">'
        +   '<div><div class="party-bal-label">Outstanding Balance</div>'
        +   '<div class="party-bal-amount" style="color:' + balColor + '">' + balText + '</div>'
        +   '<div class="party-bal-sub">' + balSub + '</div></div>'
        +   '<button class="btn-adj-bal" data-action="party:adjustBalance">⚖️ Adjust Balance</button>'
        + '</div>'
        + '<div class="party-txn-section">'
        +   '<div class="party-txn-header"><div class="party-txn-title">Transactions</div></div>'
        +   '<table class="txn-table"><thead><tr><th>Type</th><th>Date</th><th class="r">Amount</th><th>Status</th></tr></thead><tbody>'
        +   (txns.length === 0
            ? '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:20px;font-size:13px">No transactions yet</td></tr>'
            : txns.map(function (t) {
                return '<tr>'
                  + '<td><span class="txn-type-pill ' + t.color + '">' + t.type + '</span></td>'
                  + '<td style="color:var(--muted)">' + _e(t.date || '—') + '</td>'
                  + '<td class="r" style="font-weight:700">' + ERP.fmt((t.amount || 0)) + '</td>'
                  + '<td>' + (t.status ? '<span style="color:' + (t.status === 'Paid' ? '#16a34a' : t.status === 'Partial' ? '#f59e0b' : '#ef4444') + ';font-weight:700;font-size:11px">' + t.status + '</span>' : '') + '</td>'
                  + '</tr>';
              }).join(''))
        +   '</tbody></table>'
        + '</div></div>';
    }

    function openAdd(tab) {
      _editIdx  = -1;
      _apmType  = tab ? tab : (_tab === 'customers' ? 'customer' : 'supplier');
      ['apm-name', 'apm-phone', 'apm-email', 'apm-address', 'apm-gstin', 'apm-vehicle', 'apm-birthday'].forEach(function (id) {
        var el = document.getElementById(id); if (el) el.value = '';
      });
      var bal  = document.getElementById('apm-bal');    if (bal)  bal.value  = '0';
      var cred = document.getElementById('apm-credit'); if (cred) cred.value = '0';

      var hTitle = document.querySelector('#addPartyModal-bg .modal [style*="font-size:18px"]');
      if (hTitle) hTitle.textContent = 'Add New Party';
      _switchApmTab(_apmType);
      var bg = document.getElementById('addPartyModal-bg');
      if (bg) { bg.classList.add('open'); document.body.style.overflow = 'hidden'; }
      setTimeout(function () { var el = document.getElementById('apm-name'); if (el) el.focus(); }, 80);
    }

    function openEdit(type, idx) {
      _editIdx = idx;
      _apmType = type;
      var party = type === 'customer' ? _custs()[idx] : _sups()[idx];
      if (!party) return;

      _switchApmTab(type);

      var set = function (id, v) { var el = document.getElementById(id); if (el) el.value = v || ''; };
      set('apm-name',     party.n    || party.name    || '');
      set('apm-phone',    party.ph   || party.phone   || '');
      set('apm-email',    party.email  || '');
      set('apm-address',  party.addr || party.address || '');
      set('apm-gstin',    party.gstin  || '');
      set('apm-vehicle',  party.veh  || party.vehicle || '');
      set('apm-birthday', party.bday || party.birthday|| '');

      var custIdForBal = String(party.id || party.n || '');
      var rawBal;
      if (type === 'customer') {
        if (ERP._Ledger && typeof ERP._Ledger.getBalance === 'function') {
          rawBal = ERP._Ledger.getBalance(custIdForBal);
        } else {
          rawBal = typeof party.credit === 'number' && party.credit !== 0 ? party.credit
                 : typeof party.bal    === 'number' ? party.bal : 0;
        }
      } else {
        var _psBal = window.PurchaseState || null;
        if (_psBal && typeof _psBal.getLedgerBalance === 'function') {
          var _rawPaisa = _psBal.getLedgerBalance((party.id || party.n || '').toString().toLowerCase().trim());
          rawBal = _rawPaisa !== null ? Math.round(_rawPaisa) / 100 : (party.owe || party.bal || 0);
        } else {
          rawBal = typeof party.owe === 'number' && party.owe !== 0 ? party.owe
                 : typeof party.bal === 'number' ? party.bal : 0;
        }
      }
      var balEl  = document.getElementById('apm-bal');
      var btEl   = document.getElementById('apm-bal-type');
      if (balEl) balEl.value = Math.abs(rawBal);
      if (btEl) {
        if (type === 'customer') btEl.value = rawBal >= 0 ? 'dr' : 'cr';
        else                     btEl.value = rawBal >= 0 ? 'cr' : 'dr';
      }
      if (type === 'customer') {
        var cred = document.getElementById('apm-credit');
        if (cred) cred.value = party.creditLimit || 0;
      }

      var hTitle = document.querySelector('#addPartyModal-bg .modal [style*="font-size:18px"]');
      if (hTitle) hTitle.textContent = 'Edit ' + (type === 'customer' ? 'Customer' : 'Supplier');
      var bg = document.getElementById('addPartyModal-bg');
      if (bg) { bg.classList.add('open'); document.body.style.overflow = 'hidden'; }
      setTimeout(function () { var el = document.getElementById('apm-name'); if (el) el.focus(); }, 80);
    }

    function closeAdd() {
      var bg = document.getElementById('addPartyModal-bg');
      if (bg) { bg.classList.remove('open'); document.body.style.overflow = ''; }
    }

    function _apmSetErr(id, msg) {
      var el = document.getElementById(id);
      if (!el) return;
      el.style.borderColor = '#ef4444';
      el.style.boxShadow   = '0 0 0 3px rgba(239,68,68,.12)';
      var errId = id + '-err';
      var old = document.getElementById(errId);
      if (old) old.remove();
      var err = document.createElement('div');
      err.id = errId;
      err.style.cssText = 'font-size:11px;color:#ef4444;margin-top:4px;display:flex;align-items:center;gap:4px;font-weight:600';
      err.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>' + msg;
      el.parentNode.appendChild(err);
    }

    function _apmClearErr(id) {
      var el = document.getElementById(id);
      if (el) { el.style.borderColor = ''; el.style.boxShadow = ''; }
      var old = document.getElementById(id + '-err');
      if (old) old.remove();
    }

    function _switchApmTab(type) {
      _apmType = type;
      ['customer', 'supplier'].forEach(function (t) {
        var el = document.getElementById('apm-tab-' + t);
        if (el) { if (t === type) el.classList.add('active'); else el.classList.remove('active'); }
      });
      var isCust = (type === 'customer');

      var balTypeEl = document.getElementById('apm-bal-type');
      if (balTypeEl) {
        balTypeEl.innerHTML = isCust
          ? '<option value="dr">To Receive (Dr) — Customer owes you</option><option value="cr">To Pay (Cr) — You owe customer (refund)</option>'
          : '<option value="cr">To Pay (Cr) — You owe supplier</option><option value="dr">To Receive (Dr) — Supplier owes you</option>';
      }

      var creditRow = document.getElementById('apm-credit-row');
      if (creditRow) creditRow.style.display = isCust ? '' : 'none';

      var finTitle = document.getElementById('apm-fin-title');
      if (finTitle) finTitle.textContent = isCust ? 'Customer Financial Details' : 'Supplier Financial Details';

      var nameEl = document.getElementById('apm-name');
      if (nameEl) nameEl.placeholder = isCust ? 'Customer full name' : 'Supplier / company name';

      var tipTitle = document.getElementById('apm-tip-title');
      var tipText  = document.getElementById('apm-tip-text');
      if (tipTitle && tipText) {
        if (isCust) {
          tipTitle.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg> For Customer';
          tipText.textContent = 'After saving, manage sales invoices, payments and ledger from the customer detail panel.';
          var tipBox = document.getElementById('apm-tip-box');
          if (tipBox) { tipBox.style.background = '#EEF4FF'; tipBox.style.borderColor = '#BFDBFE'; }
          tipTitle.style.color = '#4338CA';
          tipText.style.color  = '#4338CA';
        } else {
          tipTitle.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg> For Supplier';
          tipText.textContent = 'After saving, track purchase orders, payments and outstanding dues from the supplier detail panel.';
          var tipBox2 = document.getElementById('apm-tip-box');
          if (tipBox2) { tipBox2.style.background = '#f0fdf4'; tipBox2.style.borderColor = '#bbf7d0'; }
          tipTitle.style.color = '#16a34a';
          tipText.style.color  = '#166534';
        }
      }

      var vehRow = document.getElementById('apm-vehicle-row');
      var bdRow  = document.getElementById('apm-birthday-row');
      if (vehRow) vehRow.style.display = isCust ? '' : 'none';
      if (bdRow)  bdRow.style.display  = isCust ? '' : 'none';

      ['apm-name', 'apm-phone', 'apm-email', 'apm-bal'].forEach(function (id) { _apmClearErr(id); });
    }

    function _currentUser() {
      try {
        var s = ERP.getState && ERP.getState();
        var u = s && s.session && s.session.user;
        if (!u) return 'system';
        if (typeof u === 'string') return u;
        return u.username || u.name || u.n || 'system';
      } catch (_) { return 'system'; }
    }

    function _getPostingEngine() {
      return window.ERP && (ERP.PostingEngine || (ERP.getModule && ERP.getModule('PostingEngine'))) || null;
    }

    function _postGL(pe, payload) {
      if (!pe || typeof pe.post !== 'function') {
        return Promise.resolve({ ok: false, error: new Error('PostingEngine unavailable') });
      }
      return Promise.resolve()
        .then(function () { return pe.post(payload); })
        .then(function (journal) { return { ok: true, journal: journal }; })
        .catch(function (err) { return { ok: false, error: err }; });
    }

    function _reverseGL(pe, documentId, opts) {
      if (!pe || typeof pe.reverse !== 'function') {
        return Promise.resolve({ ok: false, error: new Error('PostingEngine unavailable') });
      }
      return Promise.resolve()
        .then(function () { return pe.reverse(documentId, opts); })
        .then(function (journal) { return { ok: true, journal: journal }; })
        .catch(function (err) { return { ok: false, error: err }; });
    }

    var _partySaving = false;
    var _balAdjInProgress = false;

    function _normPartyName(s) { return (s || '').toString().trim().replace(/\s+/g, ' ').toLowerCase(); }
    function _normPartyPhone(s) { return (s || '').toString().replace(/\D/g, ''); }
    function _dupGate(list, kind, name, phone, gstin, excludeIdx) {
      return new Promise(function (resolve) {
        var nName  = _normPartyName(name);
        var nPhone = _normPartyPhone(phone);
        var nGstin = (gstin || '').trim().toUpperCase();
        var label  = kind === 'customer' ? 'Customer' : 'Supplier';

        if (nGstin) {
          var gstHit = list.find(function (p, i) {
            if (i === excludeIdx) return false;
            return (p.gstin || '').trim().toUpperCase() === nGstin;
          });
          if (gstHit) {
            ERP.ui.toast('⚠️ GSTIN/NTN ' + gstin + ' is already registered to "' + (gstHit.n || gstHit.name || '') + '".', 'error', 6000);
            resolve(false);
            return;
          }
          var crossList = kind === 'customer' ? (_gs().data.suppliers || []) : (_gs().data.customers || []);
          var crossHit = crossList.find(function (p) {
            return (p.gstin || '').trim().toUpperCase() === nGstin;
          });
          if (crossHit) {
            ERP.ui.toast('⚠️ GSTIN/NTN ' + gstin + ' is already registered to ' + (kind === 'customer' ? 'supplier' : 'customer') + ' "' + (crossHit.n || crossHit.name || '') + '".', 'error', 6000);
            resolve(false);
            return;
          }
        }

        var exactHit = list.find(function (p, i) {
          if (i === excludeIdx) return false;
          var sameName  = _normPartyName(p.n || p.name) === nName;
          var samePhone = nPhone && _normPartyPhone(p.ph || p.phone) === nPhone;
          return sameName && (!nPhone || samePhone);
        });
        if (exactHit) {
          ERP.ui.toast('⚠️ ' + label + ' "' + name + '" already exists.', 'warning');
          resolve(false);
          return;
        }

        var nameOnlyHit = list.find(function (p, i) {
          if (i === excludeIdx) return false;
          return _normPartyName(p.n || p.name) === nName;
        });
        if (nameOnlyHit) {
          var existingPhone = nameOnlyHit.ph || nameOnlyHit.phone || 'no phone on file';
          var _c = (window.ERP && window.ERP.confirmDialog) || function (msg, ok) { if (window.confirm(msg)) ok(); };
          _c('A ' + label.toLowerCase() + ' named "' + name + '" already exists (phone: ' + existingPhone + '). Save this as a separate party anyway?',
            function () { resolve(true); },
            function () { resolve(false); });
          return;
        }

        if (nPhone) {
          var phoneOnlyHit = list.find(function (p, i) {
            if (i === excludeIdx) return false;
            return _normPartyPhone(p.ph || p.phone) === nPhone;
          });
          if (phoneOnlyHit) {
            var existingName = phoneOnlyHit.n || phoneOnlyHit.name || 'unknown name';
            var _c2 = (window.ERP && window.ERP.confirmDialog) || function (msg, ok) { if (window.confirm(msg)) ok(); };
            _c2('This phone number is already saved under "' + existingName + '". Save "' + name + '" as a separate ' + label.toLowerCase() + ' anyway?',
              function () { resolve(true); },
              function () { resolve(false); });
            return;
          }
        }

        resolve(true);
      });
    }

    async function saveNew() {
      if (!_canManageParties('parties:save')) {
        ERP.ui.toast('You do not have permission to add or edit parties', 'error');
        return;
      }
      var nameEl  = document.getElementById('apm-name');
      var phoneEl = document.getElementById('apm-phone');
      var emailEl = document.getElementById('apm-email');
      var addrEl  = document.getElementById('apm-address');
      var gstEl   = document.getElementById('apm-gstin');
      var vehEl   = document.getElementById('apm-vehicle');
      var bdEl    = document.getElementById('apm-birthday');
      var balEl   = document.getElementById('apm-bal');
      var btEl    = document.getElementById('apm-bal-type');
      var credEl  = document.getElementById('apm-credit');

      var name    = (nameEl  ? nameEl.value  : '').trim();
      var phone   = (phoneEl ? phoneEl.value : '').trim();
      var email   = (emailEl ? emailEl.value : '').trim();
      var addr    = (addrEl  ? addrEl.value  : '').trim();
      var gstin   = (gstEl   ? gstEl.value   : '').trim();
      var vehicle = (vehEl   ? vehEl.value   : '').trim();
      var birthday= (bdEl    ? bdEl.value    : '');
      var bal     = parseFloat((balEl  ? balEl.value  : '') || '0') || 0;
      var btype   = (btEl    ? btEl.value    : '') || 'dr';
      var credit  = parseFloat((credEl ? credEl.value : '') || '0') || 0;

      var hasErr = false;
      ['apm-name', 'apm-phone', 'apm-email', 'apm-bal'].forEach(function (id) { _apmClearErr(id); });

      if (_partySaving) return;
      _partySaving = true;
      try {

      if (!name) {
        _apmSetErr('apm-name', 'Party name is required');
        if (nameEl) nameEl.focus();
        hasErr = true;
      }
      if (phone && !/^[0-9\-\+\s]{7,15}$/.test(phone)) {
        _apmSetErr('apm-phone', 'Invalid phone number — e.g. 03001234567');
        if (!hasErr && phoneEl) { phoneEl.focus(); hasErr = true; }
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        _apmSetErr('apm-email', 'Invalid email address format');
        if (!hasErr && emailEl) { emailEl.focus(); hasErr = true; }
      }
      if (isNaN(bal) || bal < 0) {
        _apmSetErr('apm-bal', 'Balance must be 0 or greater');
        if (!hasErr && balEl) { balEl.focus(); hasErr = true; }
      }
      if (hasErr) { _partySaving = false; return; }

      var balFinal = _apmType === 'supplier'
        ? (btype === 'cr' ? Math.abs(bal) : -Math.abs(bal))
        : (btype === 'cr' ? -Math.abs(bal) : Math.abs(bal));

      if (_editIdx >= 0) {
        if (_apmType === 'customer') {
          var _custDupOkEdit = await _dupGate(_gs().data.customers || [], 'customer', name, phone, gstin, _editIdx);
          if (!_custDupOkEdit) { _partySaving = false; return; }

          _st(function (s) {
            var c = s.data.customers[_editIdx];
            if (!c) return;
            c.n = name; c.name = name; c.ph = phone; c.phone = phone;
            c.email = email; c.addr = addr; c.address = addr; c.gstin = gstin;
            c.veh = vehicle; c.vehicle = vehicle; c.bday = birthday; c.birthday = birthday;
            c.creditLimit = credit;
          }, 'customers');
          try { await ERP.Persistence.save('customers', _custs()); }
          catch (eCustSave) { console.warn('[parties.saveNew edit cust]', eCustSave); }

          var custOBSucceeded = true;

          if (ERP._Ledger) {
            var c = _custs()[_editIdx];
            var custId = String(c.id || c.n || '');
            var obDocId = 'OB-CUST-' + custId;
            var pe_cob = _getPostingEngine();
            var cobGlOk = true;
            var cobGlErr = null;

            if (pe_cob) {
              if (pe_cob.isPosted && pe_cob.isPosted(obDocId)) {
                var cobRev = await _reverseGL(pe_cob, obDocId, { reason: 'Customer opening balance reset', actor: _currentUser() });
                if (!cobRev.ok) { cobGlOk = false; cobGlErr = cobRev.error; }
              }
              if (cobGlOk && balFinal !== 0) {
                var obPaisa = Math.round(Math.abs(balFinal) * 100);
                var cobPost = await _postGL(pe_cob, {
                  documentId: obDocId,
                  documentType: 'OPENING_BALANCE',
                  date: new Date().toISOString().slice(0, 10),
                  description: 'Opening balance: ' + name,
                  entries: balFinal > 0
                    ? [{ accountId: ACC_ACCOUNTS_RECEIVABLE, debit: obPaisa, credit: 0, description: 'Customer OB: ' + name },
                       { accountId: ACC_OPENING_BALANCE_EQUITY, debit: 0, credit: obPaisa, description: 'Opening Balance Equity offset' }]
                    : [{ accountId: ACC_OPENING_BALANCE_EQUITY, debit: obPaisa, credit: 0, description: 'Opening Balance Equity offset' },
                       { accountId: ACC_ACCOUNTS_RECEIVABLE, debit: 0, credit: obPaisa, description: 'Customer advance: ' + name }]
                });
                cobGlOk = cobPost.ok;
                cobGlErr = cobPost.error;
              }
            }

            if (cobGlOk) {
              _st(function(s){
                s.data.customerLedger = (s.data.customerLedger || []).filter(function(e){
                  return !(String(e.customerId||'') === custId &&
                    (e.type === 'OPENING_BALANCE' || e.type === 'ADJUSTMENT'));
                });
              }, 'ledger:ob-clear:'+custId);
              if (balFinal !== 0) {
                var freshOB = ERP._Ledger.createOpeningBalance(custId, balFinal);
                _st(function(s){ s.data.customerLedger = (s.data.customerLedger || []).concat([freshOB]); }, 'ledger:ob-reset:'+custId);
              }
              try { await ERP.Persistence.save('customerLedger', _gs().data.customerLedger); }
              catch (eLedSave) { console.warn('[saveNew OB reset]', eLedSave); }
              ERP._Ledger.recalculate(custId);
            } else {
              custOBSucceeded = false;
              console.error('[parties.saveNew cust OB GL]', cobGlErr);
              ERP.ui.toast('⚠️ Customer saved, but opening balance was NOT posted to GL: ' + (cobGlErr && cobGlErr.message ? cobGlErr.message : 'posting failed'), 'error');
            }
          }
          try { window.customers = _custs(); } catch (_) {}
          ERP.events.emit('customers:updated');
          _tab = 'customers';
          if (custOBSucceeded) {
            ERP.ui.toast('✅ Customer updated!', 'success');
          }
        } else {
          var _supDupOk = await _dupGate(_gs().data.suppliers || [], 'supplier', name, phone, gstin, _editIdx);
          if (!_supDupOk) { _partySaving = false; return; }

          var _supPreEdit = (_gs().data.suppliers || [])[_editIdx];
          var supId = String((_supPreEdit && _supPreEdit.id) || name || '');

          _st(function (s) {
            var sup = s.data.suppliers[_editIdx];
            if (!sup) return;
            sup.n = name; sup.name = name; sup.ph = phone; sup.phone = phone;
            sup.email = email; sup.addr = addr; sup.address = addr; sup.gstin = gstin;
          }, 'suppliers');
          try { await ERP.Persistence.save('suppliers', _sups()); }
          catch (eSupSave) { console.warn('[parties.saveNew edit sup]', eSupSave); }

          var sobDocId = 'OB-SUP-' + supId.toLowerCase().trim().replace(/\s+/g, '_');
          var pe_sob = _getPostingEngine();
          var sobGlOk = true;
          var sobGlErr = null;

          if (pe_sob) {
            if (pe_sob.isPosted && pe_sob.isPosted(sobDocId)) {
              var sobRev = await _reverseGL(pe_sob, sobDocId, { reason: 'Supplier opening balance reset', actor: _currentUser() });
              if (!sobRev.ok) { sobGlOk = false; sobGlErr = sobRev.error; }
            }
            if (sobGlOk && balFinal !== 0) {
              var sobPaisa = Math.round(Math.abs(balFinal) * 100);
              var sobPost = await _postGL(pe_sob, {
                documentId: sobDocId,
                documentType: 'OPENING_BALANCE',
                date: new Date().toISOString().slice(0, 10),
                description: 'Opening balance: ' + name,
                entries: balFinal > 0
                  ? [{ accountId: ACC_OPENING_BALANCE_EQUITY, debit: sobPaisa, credit: 0, description: 'Opening Balance Equity offset' },
                     { accountId: ACC_ACCOUNTS_PAYABLE, debit: 0, credit: sobPaisa, description: 'Supplier OB: ' + name }]
                  : [{ accountId: ACC_ACCOUNTS_PAYABLE, debit: sobPaisa, credit: 0, description: 'Supplier advance: ' + name },
                     { accountId: ACC_OPENING_BALANCE_EQUITY, debit: 0, credit: sobPaisa, description: 'Opening Balance Equity offset' }]
              });
              sobGlOk = sobPost.ok;
              sobGlErr = sobPost.error;
            }
          }

          if (sobGlOk) {
            _st(function (s) {
              var sup = s.data.suppliers[_editIdx];
              if (sup) { sup.owe = balFinal; sup.bal = balFinal; }
            }, 'suppliers');
            try { await ERP.Persistence.save('suppliers', _sups()); }
            catch (eSupSave2) { console.warn('[parties.saveNew edit sup bal]', eSupSave2); }

            if (balFinal !== 0) {
              var _psSOB = window.PurchaseState || null;
              if (_psSOB && typeof _psSOB.writeLedgerEntry === 'function') {
                var sobLedPayload = {
                  supplierId: supId,
                  type: 'OPENING_BALANCE',
                  debit: balFinal < 0 ? Math.round(Math.abs(balFinal) * 100) : 0,
                  credit: balFinal > 0 ? Math.round(Math.abs(balFinal) * 100) : 0,
                  referenceId: sobDocId,
                  date: new Date().toISOString().slice(0, 10),
                  note: 'Opening balance'
                };
                var sobLedErr = _validateLedgerEntry(sobLedPayload);
                if (sobLedErr) {
                  console.error('[parties.saveNew sup OB ledger] invalid payload:', sobLedErr, sobLedPayload);
                } else {
                  try { _psSOB.writeLedgerEntry(sobLedPayload); }
                  catch (eLedSOB) { console.error('[parties.saveNew sup OB ledger]', eLedSOB); }
                }
              }
            }
            ERP.ui.toast('✅ Supplier updated!', 'success');
          } else {
            console.error('[parties.saveNew sup OB GL]', sobGlErr);
            ERP.ui.toast('⚠️ Supplier saved, but opening balance was NOT posted to GL: ' + (sobGlErr && sobGlErr.message ? sobGlErr.message : 'posting failed'), 'error');
          }
          try { window.suppliers = _sups(); } catch (_) {}
          ERP.events.emit('suppliers:updated');
          _tab = 'suppliers';
        }
      } else {
        var newParty = {
          id: ERP.uid(), // FIX (root cause, audit #61-64): was randomUUID-or-Date.now+random; route through the one canonical generator.
          email: email, address: addr, addr: addr, gstin: gstin,
          vehicle: vehicle, veh: vehicle, birthday: birthday, bday: birthday,
          bal: 0, creditLimit: credit, created: new Date().toISOString()
        };
        if (_apmType === 'customer') {
          var _custDupOk = await _dupGate(_gs().data.customers || [], 'customer', name, phone, gstin, -1);
          if (!_custDupOk) { _partySaving = false; return; }

          var newCustId = String(newParty.id);
          var ncobGlOk = true;
          var ncobGlErr = null;
          if (balFinal !== 0) {
            var pe_ncob = _getPostingEngine();
            var ncobPaisa = Math.round(Math.abs(balFinal) * 100);
            var ncobPost = await _postGL(pe_ncob, {
              documentId: 'OB-CUST-' + newCustId,
              documentType: 'OPENING_BALANCE',
              date: new Date().toISOString().slice(0, 10),
              description: 'Opening balance: ' + name,
              entries: balFinal > 0
                ? [{ accountId: ACC_ACCOUNTS_RECEIVABLE, debit: ncobPaisa, credit: 0, description: 'Customer OB: ' + name },
                   { accountId: ACC_OPENING_BALANCE_EQUITY, debit: 0, credit: ncobPaisa, description: 'Opening Balance Equity offset' }]
                : [{ accountId: ACC_OPENING_BALANCE_EQUITY, debit: ncobPaisa, credit: 0, description: 'Opening Balance Equity offset' },
                   { accountId: ACC_ACCOUNTS_RECEIVABLE, debit: 0, credit: ncobPaisa, description: 'Customer advance: ' + name }]
            });
            ncobGlOk = ncobPost.ok;
            ncobGlErr = ncobPost.error;
          }

          _st(function (s) { s.data.customers.unshift(Object.assign({}, newParty, { sales: 0, credit: 0, pts: 0 })); }, 'customers');
          try { await ERP.Persistence.save('customers', _custs()); }
          catch (eNCustSave) { console.warn('[parties.saveNew cust]', eNCustSave); }

          var newPartyOBSucceeded = true;

          if (ncobGlOk && balFinal !== 0 && ERP._Ledger) {
            var obEntry = ERP._Ledger.createOpeningBalance(newCustId, balFinal);
            _st(function(s){ s.data.customerLedger = (s.data.customerLedger || []).concat([obEntry]); }, 'ledger:ob:'+newCustId);
            try { await ERP.Persistence.save('customerLedger', _gs().data.customerLedger); }
            catch (eNLedSave) { console.warn('[saveNew OB]', eNLedSave); }
          } else if (!ncobGlOk) {
            newPartyOBSucceeded = false;
            console.error('[parties.saveNew new cust OB GL]', ncobGlErr);
            ERP.ui.toast('⚠️ Customer added, but opening balance was NOT posted to GL: ' + (ncobGlErr && ncobGlErr.message ? ncobGlErr.message : 'posting failed'), 'error');
          } else if (balFinal !== 0 && !ERP._Ledger) {
            newPartyOBSucceeded = false;
            console.error('[parties.saveNew new cust OB ledger] ERP._Ledger unavailable — GL posted but customer ledger not updated');
            ERP.ui.toast('⚠️ Customer added and opening balance posted to GL, but the ledger module is unavailable — balance display may be out of sync until reload', 'error');
          }

          ERP.events.emit('customers:updated');
          _tab = 'customers';
        } else {
          var _newSupDupOk = await _dupGate(_gs().data.suppliers || [], 'supplier', name, phone, gstin, -1);
          if (!_newSupDupOk) { _partySaving = false; return; }

          var nsobKey = newParty.id.toString().toLowerCase().replace(/\s+/g, '_');
          var nsobGlOk = true;
          var nsobGlErr = null;
          if (balFinal !== 0) {
            var pe_nsob = _getPostingEngine();
            var nsobPaisa = Math.round(Math.abs(balFinal) * 100);
            var nsobPost = await _postGL(pe_nsob, {
              documentId: 'OB-SUP-' + nsobKey,
              documentType: 'OPENING_BALANCE',
              date: new Date().toISOString().slice(0, 10),
              description: 'Opening balance: ' + name,
              entries: balFinal > 0
                ? [{ accountId: ACC_OPENING_BALANCE_EQUITY, debit: nsobPaisa, credit: 0, description: 'Opening Balance Equity offset' },
                   { accountId: ACC_ACCOUNTS_PAYABLE, debit: 0, credit: nsobPaisa, description: 'Supplier OB: ' + name }]
                : [{ accountId: ACC_ACCOUNTS_PAYABLE, debit: nsobPaisa, credit: 0, description: 'Supplier advance: ' + name },
                   { accountId: ACC_OPENING_BALANCE_EQUITY, debit: 0, credit: nsobPaisa, description: 'Opening Balance Equity offset' }]
            });
            nsobGlOk = nsobPost.ok;
            nsobGlErr = nsobPost.error;
          }

          var nsobFinalBal = nsobGlOk ? balFinal : 0;
          _st(function (s) { s.data.suppliers.unshift(Object.assign({}, newParty, { purchases: 0, owe: nsobFinalBal, bal: nsobFinalBal })); }, 'suppliers');
          try { await ERP.Persistence.save('suppliers', _sups()); }
          catch (eNSupSave) { console.warn('[parties.saveNew sup]', eNSupSave); }

          if (nsobGlOk && balFinal !== 0) {
            var _psNSOB = window.PurchaseState || null;
            if (_psNSOB && typeof _psNSOB.writeLedgerEntry === 'function') {
              var nsobLedPayload = {
                supplierId: String(newParty.id),
                type: 'OPENING_BALANCE',
                debit: balFinal < 0 ? Math.round(Math.abs(balFinal) * 100) : 0,
                credit: balFinal > 0 ? Math.round(Math.abs(balFinal) * 100) : 0,
                referenceId: 'OB-SUP-' + nsobKey,
                date: new Date().toISOString().slice(0, 10),
                note: 'Opening balance'
              };
              var nsobLedErr = _validateLedgerEntry(nsobLedPayload);
              if (nsobLedErr) {
                console.error('[parties.saveNew new sup OB ledger] invalid payload:', nsobLedErr, nsobLedPayload);
              } else {
                try { _psNSOB.writeLedgerEntry(nsobLedPayload); }
                catch (eNLedSOB) { console.error('[parties.saveNew new sup OB ledger]', eNLedSOB); }
              }
            }
          } else if (!nsobGlOk) {
            newPartyOBSucceeded = false;
            console.error('[parties.saveNew new sup OB GL]', nsobGlErr);
            ERP.ui.toast('⚠️ Supplier added, but opening balance was NOT posted to GL: ' + (nsobGlErr && nsobGlErr.message ? nsobGlErr.message : 'posting failed'), 'error');
          }

          try { window.suppliers = _sups(); } catch (_) {}
          ERP.events.emit('suppliers:updated');
          _tab = 'suppliers';
        }
        if (newPartyOBSucceeded) {
          ERP.ui.toast('✅ ' + name + ' added!', 'success');
        }
      }
      closeAdd();
      switchTab(_tab);
      } finally {
        _partySaving = false;
      }
    }

    function adjustBalance() {
      if (!_selectedParty) { ERP.ui.toast('No party selected', 'warning'); return; }
      var existing = document.getElementById('_bal-adj-dialog');
      if (existing) existing.remove();
      var dlg = document.createElement('div');
      dlg.id = '_bal-adj-dialog';
      dlg.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--white,#fff);border:1px solid var(--border,#e2e8f0);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.18);padding:18px 20px;z-index:var(--zi-modal,1010);min-width:280px;display:flex;flex-direction:column;gap:10px';
      dlg.innerHTML = '<div style="font-size:13px;font-weight:700;color:var(--text,#0f172a)">Balance Adjustment</div>'
        + '<input id="_bal-adj-inp" type="number" placeholder="+ve add, -ve subtract" style="border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px;font-size:14px;width:100%">'
        + '<input id="_bal-adj-reason" type="text" placeholder="Reason for adjustment (required)" style="border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px;font-size:14px;width:100%">'
        + '<div id="_bal-adj-err" style="font-size:12px;color:#dc2626;display:none"></div>'
        + '<div style="display:flex;gap:8px;justify-content:flex-end">'
        + '<button id="_bal-adj-cancel" style="padding:6px 14px;border-radius:6px;border:1px solid #e2e8f0;background:var(--bg,#f8fafc);font-size:13px;cursor:pointer">Cancel</button>'
        + '<button id="_bal-adj-ok" style="padding:6px 14px;border-radius:6px;border:none;background:#4338CA;color:#fff;font-size:13px;font-weight:700;cursor:pointer">Apply</button>'
        + '</div>';
      document.body.appendChild(dlg);
      var inp = document.getElementById('_bal-adj-inp');
      var reasonInp = document.getElementById('_bal-adj-reason');
      var errEl = document.getElementById('_bal-adj-err');
      if (inp) inp.focus();
      function _cleanup() { var d = document.getElementById('_bal-adj-dialog'); if (d) d.remove(); }
      var cancelBtn = document.getElementById('_bal-adj-cancel');
      if (cancelBtn) cancelBtn.addEventListener('click', _cleanup);
      var okBtn = document.getElementById('_bal-adj-ok');
      if (okBtn) okBtn.addEventListener('click', function () {
        var rawAmt = inp ? inp.value : '';
        var reason = (reasonInp ? reasonInp.value : '').trim();
        var val = parseFloat(rawAmt);
        if (isNaN(val) || val === 0) {
          if (errEl) { errEl.textContent = 'Enter a non-zero amount'; errEl.style.display = ''; }
          if (inp) inp.focus();
          return;
        }
        if (!reason) {
          if (errEl) { errEl.textContent = 'Reason is required'; errEl.style.display = ''; }
          if (reasonInp) reasonInp.focus();
          return;
        }
        _cleanup();
        _applyBalanceAdjustment(val, reason);
      });
    }

    async function _applyBalanceAdjustment(val, reason) {
      if (_balAdjInProgress) return;
      var party = _selectedParty;
      if (!party) return;
      if (!_canManageParties('parties:adjustBalance')) {
        ERP.ui.toast('You do not have permission to adjust party balances', 'error');
        return;
      }
      if (typeof val !== 'number' || isNaN(val) || val === 0) { ERP.ui.toast('Invalid adjustment amount', 'error'); return; }
      if (!reason || !reason.trim()) { ERP.ui.toast('Adjustment reason is required', 'error'); return; }
      reason = reason.trim();
      _balAdjInProgress = true;
      try {

      try {
        if (ERP.PeriodLock && typeof ERP.PeriodLock.isLocked === 'function') {
          var _adjToday = new Date().toISOString().slice(0, 10);
          if (ERP.PeriodLock.isLocked(_adjToday)) {
            ERP.ui.toast('⚠️ Today\u2019s accounting period is locked — balance adjustments are not allowed.', 'error', 6000);
            _balAdjInProgress = false;
            return;
          }
        }
      } catch (_plAdjErr) {   }

      if (party.type === 'customer') {
        if (!ERP._Ledger || !ERP._internal) {
          ERP.ui.toast('Ledger module unavailable — adjustment not applied', 'error');
          _balAdjInProgress = false;
          return;
        }
        var custIdx0 = _findById(_custs(), party.raw && party.raw.id, party.name);
        var custRec = custIdx0 >= 0 ? _custs()[custIdx0] : null;
        if (!custRec) { ERP.ui.toast('Customer record not found', 'error'); _balAdjInProgress = false; return; }
        var custId4 = String(custRec.id || custRec.n || '');
        var pe_cadj = _getPostingEngine();
        var cadjPaisa = Math.round(Math.abs(val) * 100);
        var cadjDocId = 'ADJ-CUST-' + custId4 + '-' + Date.now();
        var cadjResult = await _postGL(pe_cadj, {
          documentId: cadjDocId,
          documentType: 'BALANCE_ADJUSTMENT',
          date: new Date().toISOString().slice(0, 10),
          description: 'Balance adjustment: ' + party.name + ' — ' + reason,
          entries: val > 0
            ? [{ accountId: ACC_ACCOUNTS_RECEIVABLE, debit: cadjPaisa, credit: 0, description: 'Customer balance increase (AR): ' + party.name },
               { accountId: ACC_OPENING_BALANCE_EQUITY, debit: 0, credit: cadjPaisa, description: 'Opening balance reserve offset' }]
            : [{ accountId: ACC_SALES_REVENUE, debit: cadjPaisa, credit: 0, description: 'Customer balance write-off: ' + party.name },
               { accountId: ACC_ACCOUNTS_RECEIVABLE, debit: 0, credit: cadjPaisa, description: 'Customer AR reduced: ' + party.name }]
        });
        if (!cadjResult.ok) {
          console.error('[parties.adjustBalance cust GL]', cadjResult.error);
          ERP.ui.toast('⚠️ Adjustment NOT applied — GL posting failed: ' + (cadjResult.error && cadjResult.error.message ? cadjResult.error.message : 'posting failed'), 'error');
          _balAdjInProgress = false;
          return;
        }
        var curBal4 = ERP._Ledger.getBalance(custId4);
        var adjDebit4  = val > 0 ? val : 0;
        var adjCredit4 = val < 0 ? Math.abs(val) : 0;
        var newBal4    = Math.round((curBal4 + adjDebit4 - adjCredit4) * 100) / 100;
        var adjEntry4  = ERP._Ledger._buildEntry(custId4, 'ADJUSTMENT', 'ADJ', adjDebit4, adjCredit4, newBal4, null, reason);
        ERP._internal.setState(function(s){ s.data.customerLedger = (s.data.customerLedger || []).concat([adjEntry4]); }, 'ledger:adj:'+custId4);
        try { await ERP.Persistence.save('customerLedger', ERP._internal.getState().data.customerLedger); }
        catch (eAdjLedSave) { console.warn('[parties.adjustBalance ledger]', eAdjLedSave); }
      } else {
        var supIdx0 = _findById(_sups(), party.raw && party.raw.id, party.name);
        var supRecCheck = supIdx0 >= 0 ? _sups()[supIdx0] : null;
        if (!supRecCheck) { ERP.ui.toast('Supplier record not found', 'error'); _balAdjInProgress = false; return; }
        var pe_sadj = _getPostingEngine();
        var sadjPaisa = Math.round(Math.abs(val) * 100);
        var sadjDocId = 'ADJ-SUP-' + party.name.toLowerCase().replace(/\s+/g, '_') + '-' + Date.now();
        var sadjResult = await _postGL(pe_sadj, {
          documentId: sadjDocId,
          documentType: 'BALANCE_ADJUSTMENT',
          date: new Date().toISOString().slice(0, 10),
          description: 'Balance adjustment: ' + party.name + ' — ' + reason,
          entries: val > 0
            ? [{ accountId: ACC_SUPPLIER_ADJ_EXPENSE, debit: sadjPaisa, credit: 0, description: 'Supplier balance adjustment expense: ' + party.name },
               { accountId: ACC_ACCOUNTS_PAYABLE, debit: 0, credit: sadjPaisa, description: 'Supplier balance increase (AP): ' + party.name }]
            : [{ accountId: ACC_ACCOUNTS_PAYABLE, debit: sadjPaisa, credit: 0, description: 'Supplier balance decrease (AP): ' + party.name },
               { accountId: ACC_SUPPLIER_ADJ_EXPENSE, debit: 0, credit: sadjPaisa, description: 'Supplier balance adjustment credit: ' + party.name }]
        });
        if (!sadjResult.ok) {
          console.error('[parties.adjustBalance sup GL]', sadjResult.error);
          ERP.ui.toast('⚠️ Adjustment NOT applied — GL posting failed: ' + (sadjResult.error && sadjResult.error.message ? sadjResult.error.message : 'posting failed'), 'error');
          _balAdjInProgress = false;
          return;
        }
        _st(function (s) {
          var supIdx1 = _findById(s.data.suppliers, supRecCheck.id, supRecCheck.n);
          var sup = supIdx1 >= 0 ? s.data.suppliers[supIdx1] : null;
          if (sup) { sup.owe = (sup.owe || 0) + val; sup.bal = (sup.bal || 0) + val; }
        }, 'suppliers');
        try { await ERP.Persistence.save('suppliers', _sups()); }
        catch (eAdjSupSave) { console.warn('[parties.adjustBalance sup]', eAdjSupSave); }
        var _psAdj = window.PurchaseState || null;
        if (_psAdj && typeof _psAdj.writeLedgerEntry === 'function') {
          var sadjLedPayload = {
            supplierId: (supRecCheck.id || supRecCheck.n || '').toString().toLowerCase().trim(),
            type: 'ADJUSTMENT',
            debit: val > 0 ? 0 : Math.round(Math.abs(val) * 100),
            credit: val > 0 ? Math.round(Math.abs(val) * 100) : 0,
            referenceId: sadjDocId,
            date: new Date().toISOString().slice(0, 10),
            note: reason
          };
          var sadjLedErr = _validateLedgerEntry(sadjLedPayload);
          if (sadjLedErr) {
            console.error('[parties.adjustBalance sup ledger] invalid payload:', sadjLedErr, sadjLedPayload);
          } else {
            try { _psAdj.writeLedgerEntry(sadjLedPayload); }
            catch (eAdjLedSADJ) { console.error('[parties.adjustBalance sup ledger]', eAdjLedSADJ); }
          }
        }
      }

      ERP.ui.toast('Balance adjusted by ' + ERP.fmt(val), 'success');
      renderList();
      var updated = Object.assign({}, _selectedParty, { bal: (_selectedParty.bal || 0) + val });
      _selectedParty = updated;
      renderDetail(updated);

      } finally {
        _balAdjInProgress = false;
      }
    }

    function editSelected() {
      if (!_selectedParty) return;
      var sp = _selectedParty;
      if (sp.type === 'customer') {
        var idx = _findById(_custs(), sp.raw && sp.raw.id, sp.name);
        if (idx >= 0) openEdit('customer', idx);
      } else {
        var sidx = _findById(_sups(), sp.raw && sp.raw.id, sp.name);
        if (sidx >= 0) openEdit('supplier', sidx);
      }
    }

    function showStatement() {
      if (!_selectedParty) return;
      var sp = _selectedParty;
      var isCust = sp.type === 'customer';
      var idx = isCust
        ? _findById(_custs(), sp.raw && sp.raw.id, sp.name)
        : _findById(_sups(), sp.raw && sp.raw.id, sp.name);
      if (idx < 0) return;
      if (isCust) ERP.cust.viewLedger(idx);
      else        ERP.sup.viewLedger(idx);
    }

    function renderPage() { switchTab(_tab); }

    function _refreshSelectedParty(type) {
      if (!_selectedParty || _selectedParty.type !== type) return;
      var rawList  = type === 'customer' ? _custs() : _sups();
      var freshIdx = _findById(rawList, _selectedParty.raw && _selectedParty.raw.id, _selectedParty.name);
      if (freshIdx < 0) {
        _selectedParty = null;
        var empty   = document.getElementById('party-detail-empty');
        var content = document.getElementById('party-detail-content');
        if (empty)   empty.style.display   = '';
        if (content) content.style.display = 'none';
        return;
      }
      var freshRecord = rawList[freshIdx];
      var rebuilt = _getList().filter(function (p) { return p.raw === freshRecord; })[0];
      if (rebuilt) {
        _selectedParty = rebuilt;
        renderDetail(rebuilt);
      }
    }

    ERP.events.on('customers:updated', function () {
      try { window.customers = _custs(); } catch (_) {}
      if (_gs().ui.page === 'parties') { renderList(); _refreshSelectedParty('customer'); }
    });
    ERP.events.on('suppliers:updated', function () {
      try { window.suppliers = _sups(); } catch (_) {}
      if (_gs().ui.page === 'parties') { renderList(); _refreshSelectedParty('supplier'); }
    });

    ERP.registerRenderer('parties', function () { renderPage(); });

    function exportCSV() {
      var custs = _custs();
      var sups  = _sups();
      var rows  = [['Type', 'Name', 'Phone', 'Email', 'Address', 'GSTIN', 'Vehicle', 'Birthday', 'Credit Limit']];

      custs.forEach(function (c) {
        rows.push(['Customer', c.n || c.name || '', c.ph || c.phone || '',
                   c.email || '', c.address || c.addr || '', c.gstin || '',
                   c.vehicle || c.veh || '', c.birthday || c.bday || '',
                   c.creditLimit || 0]);
      });
      sups.forEach(function (s) {
        rows.push(['Supplier', s.n || s.name || '', s.ph || s.phone || '',
                   s.email || '', s.address || s.addr || '', s.gstin || '',
                   '', '', '']);
      });

      var csv = rows.map(function (r) {
        return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
      }).join('\n');

      var a  = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      a.download = 'parties-' + Date.now() + '.csv';
      a.click();
      ERP.ui.toast('✅ Parties exported — ' + custs.length + ' customers, ' + sups.length + ' suppliers', 'success');
    }

    function downloadTemplate() {
      var header = ['Type', 'Name', 'Phone', 'Email', 'Address', 'GSTIN', 'Vehicle', 'Birthday', 'Credit Limit'];
      var sample = [
        ['Customer', 'Ali Ahmed', '03001234567', 'ali@example.com', 'Karachi', '', 'Toyota Corolla', '1990-05-15', '50000'],
        ['Supplier', 'ABC Trading', '02134567890', 'abc@example.com', 'Lahore', '12ABCDE3456F7Z8', '', '', '']
      ];
      var csv = [header].concat(sample).map(function (r) {
        return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
      }).join('\n');
      var a  = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      a.download = 'parties-template.csv';
      a.click();
      ERP.ui.toast('Template downloaded — fill it and use Import ✅', 'success');
    }

    var _importSaving = false;
    function importCSV() {
      if (_importSaving) return;
      _importSaving = true;
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv,text/csv';
      input.style.display = 'none';
      document.body.appendChild(input);

      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        input.remove();
        if (!file) { _importSaving = false; return; }

        var reader = new FileReader();
        reader.onload = function (ev) {
          try {
            function splitCsvRows(text) {
              var rows = [], cur = '', inQ = false;
              for (var i = 0; i < text.length; i++) {
                var ch = text[i];
                if (ch === '"') {
                  if (inQ && text[i + 1] === '"') { cur += '""'; i++; }
                  else { inQ = !inQ; cur += '"'; }
                } else if ((ch === '\n' || ch === '\r') && !inQ) {
                  if (ch === '\r' && text[i + 1] === '\n') i++;
                  rows.push(cur);
                  cur = '';
                } else {
                  cur += ch;
                }
              }
              if (cur) rows.push(cur);
              return rows;
            }

            var lines = splitCsvRows(ev.target.result || '').filter(Boolean);
            if (lines.length < 2) { _importSaving = false; ERP.ui.toast('CSV is empty or has only headers', 'error'); return; }

            function parseRow(line) {
              var result = [], cur = '', inQ = false;
              for (var i = 0; i < line.length; i++) {
                var ch = line[i];
                if (ch === '"') {
                  if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
                  else inQ = !inQ;
                } else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
                else cur += ch;
              }
              result.push(cur.trim());
              return result;
            }

            var headers = parseRow(lines[0]).map(function (h) { return h.toLowerCase().replace(/\s+/g, ''); });
            var col = function (name) { return headers.indexOf(name); };
            var typeIdx = col('type'), nIdx = col('name'), phIdx = col('phone');
            var emailIdx = col('email'), addrIdx = col('address'), gstIdx = col('gstin');
            var vehIdx = col('vehicle'), bdayIdx = col('birthday'), clIdx = col('creditlimit');

            if (nIdx === -1) { _importSaving = false; ERP.ui.toast('CSV must have a "Name" column', 'error'); return; }

            var custAdded = 0, supAdded = 0, skipped = 0;
            var existingCusts = _custs();
            var existingSups  = _sups();
            var seenCustKeys = {};
            var seenSupKeys  = {};

            function _dupKeyMatch(list, seenKeys, nameLc, phoneDigits, gstinUpper) {
              if (seenKeys[nameLc]) return true;
              if (gstinUpper && list.some(function (p) { return (p.gstin || '').trim().toUpperCase() === gstinUpper; })) return true;
              if (list.some(function (p) { return (p.n || '').toLowerCase() === nameLc; })) return true;
              if (phoneDigits && list.some(function (p) { return ((p.ph || p.phone || '').replace(/\D/g, '')) === phoneDigits; })) return true;
              return false;
            }

            lines.slice(1).forEach(function (line) {
              if (!line.trim()) return;
              var r    = parseRow(line);
              var name = (r[nIdx] || '').replace(/\s+/g, ' ');
              var type = (r[typeIdx] || 'customer').toLowerCase();
              if (!name) { skipped++; return; }
              var nameLc = name.toLowerCase();
              var phoneDigits = (r[phIdx] || '').replace(/\D/g, '');
              var gstinUpper  = (r[gstIdx] || '').trim().toUpperCase();

              // FIX (root cause, audit #61-64): was randomUUID-or-Date.now+random; route through the one canonical generator.
              var id = ERP.uid();

              if (type === 'supplier' || type === 'sup') {
                if (_dupKeyMatch(existingSups, seenSupKeys, nameLc, phoneDigits, gstinUpper)) {
                  skipped++; return;
                }
                seenSupKeys[nameLc] = true;
                var newSup = {
                  id: id, n: name, name: name,
                  ph: r[phIdx] || '', phone: r[phIdx] || '',
                  email: r[emailIdx] || '', address: r[addrIdx] || '', addr: r[addrIdx] || '',
                  gstin: r[gstIdx] || '', bal: 0, owe: 0, purchases: 0,
                  created: new Date().toISOString()
                };
                _st(function (s) { s.data.suppliers.unshift(newSup); }, 'suppliers');
                supAdded++;
              } else {
                if (_dupKeyMatch(existingCusts, seenCustKeys, nameLc, phoneDigits, gstinUpper)) {
                  skipped++; return;
                }
                seenCustKeys[nameLc] = true;
                var newCust = {
                  id: id, n: name, name: name,
                  ph: r[phIdx] || '', phone: r[phIdx] || '',
                  email: r[emailIdx] || '', address: r[addrIdx] || '', addr: r[addrIdx] || '',
                  gstin: r[gstIdx] || '', vehicle: r[vehIdx] || '', veh: r[vehIdx] || '',
                  birthday: r[bdayIdx] || '', bday: r[bdayIdx] || '',
                  creditLimit: parseFloat(r[clIdx]) || 0,
                  bal: 0, credit: 0, pts: 0, sales: 0,
                  created: new Date().toISOString()
                };
                _st(function (s) { s.data.customers.unshift(newCust); }, 'customers');
                custAdded++;
              }
            });

            ERP.Persistence.save('customers', _custs()).catch(function (e) { console.warn('[party:importCSV] cust persist', e); });
            ERP.Persistence.save('suppliers', _sups()).catch(function (e) { console.warn('[party:importCSV] sup persist', e); });
            renderPage();
            _importSaving = false;
            ERP.ui.toast('✅ Import complete — ' + custAdded + ' customers, ' + supAdded + ' suppliers added, ' + skipped + ' skipped', 'success', 5000);
          } catch (err) {
            _importSaving = false;
            ERP.ui.toast('CSV parse failed: ' + (err && err.message || err), 'error');
          }
        };
        reader.readAsText(file);
      });

      input.click();
    }

    function _normSupName(n) {
      return (n || '').toString().toLowerCase().trim().replace(/\s+/g, ' ');
    }

    // Finds the real supplier party record for a typed/selected name and
    // returns its stable, unique party.id — creating a minimal supplier
    // record on the fly if none exists yet (e.g. a name typed directly into
    // a purchase form without going through "+ Add Supplier"). This is now
    // the ONE canonical identifier purchases/POs/payments/returns/ledger
    // entries should carry, instead of a name-derived string.
    function resolveSupplierId(name) {
      var nm = (name || '').toString().trim();
      if (!nm) return null;
      var key = _normSupName(nm);
      var sups = _sups();
      var match = sups.find(function (s) { return _normSupName(s.n || s.name) === key; });
      if (match && match.id) return String(match.id);

      // FIX (root cause, audit #61-64): was randomUUID-or-Date.now+random; route through the one canonical generator.
      var newId = ERP.uid();
      var newSup = {
        id: newId, n: nm, name: nm, ph: '', phone: '',
        bal: 0, owe: 0, purchases: 0,
        created: new Date().toISOString(),
        _autoCreated: true // flag: created implicitly from a purchase/PO/payment form, not via Add Supplier
      };
      try {
        _st(function (s) {
          s.data.suppliers = s.data.suppliers || [];
          s.data.suppliers.push(newSup);
        }, 'suppliers:auto-resolve');
        try { ERP.Persistence && ERP.Persistence.save && ERP.Persistence.save('suppliers', _sups(), { retries: 2, silent: true }); } catch (_) {}
        try { ERP.events && ERP.events.emit && ERP.events.emit('suppliers:updated'); } catch (_) {}
      } catch (e) {
        console.error('[ERP.parties.resolveSupplierId] failed to auto-create supplier:', e);
      }
      return newId;
    }

    // One-time migration: every purchase/PO/return/payment record — and the
    // PurchaseState internal ledger — used to key supplierId off a
    // normalized NAME string instead of the party's real id. Two different
    // suppliers with similar/blank names could merge in reports, and
    // renaming a supplier could silently orphan its whole purchase history.
    // This walks every record once, resolves the true party id, and moves
    // both the record and its ledger entries onto that id. Safe to call
    // repeatedly — records already on a true id are left untouched.
    function migrateSupplierIds() {
      try {
        var ps = window.PurchaseState;
        if (!ps || typeof ps.getAllPurchases !== 'function') return { ok: false, error: 'PurchaseState not ready' };

        var doneKey = 'mh_supplier_id_migration_v1_done';
        try { if (localStorage.getItem(doneKey) === '1') return { ok: true, skipped: true }; } catch (_) {}

        var sups = _sups();
        var idSet = {};
        sups.forEach(function (s) { if (s.id) idSet[String(s.id)] = true; });

        function trueIdFor(name, currentId) {
          if (currentId && idSet[String(currentId)]) return String(currentId); // already migrated
          return resolveSupplierId(name);
        }

        var stats = { purchases: 0, pos: 0, returns: 0, payments: 0, ledgerKeysMoved: 0 };

        (ps.getAllPurchases() || []).forEach(function (p) {
          var trueId = trueIdFor(p.supplierName || p.sup, p.supplierId);
          if (trueId && trueId !== p.supplierId) {
            var oldId = p.supplierId;
            ps.updatePurchase(p.id, { supplierId: trueId });
            if (oldId) { ps.renameLedgerKey(oldId, trueId); stats.ledgerKeysMoved++; }
            stats.purchases++;
          }
        });

        if (typeof ps.getAllPurchaseOrders === 'function') {
          (ps.getAllPurchaseOrders() || []).forEach(function (po) {
            var trueId = trueIdFor(po.supplierName || po.sup, po.supplierId);
            if (trueId && trueId !== po.supplierId) {
              var oldId = po.supplierId;
              ps.updatePO(po.id, { supplierId: trueId });
              if (oldId) ps.renameLedgerKey(oldId, trueId);
              stats.pos++;
            }
          });
        }

        if (typeof ps.getAllReturns === 'function') {
          (ps.getAllReturns() || []).forEach(function (r) {
            var trueId = trueIdFor(r.supplierName || r.sup, r.supplierId);
            if (trueId && trueId !== r.supplierId) {
              var oldId = r.supplierId;
              ps.updateReturn(r.id, { supplierId: trueId });
              if (oldId) ps.renameLedgerKey(oldId, trueId);
              stats.returns++;
            }
          });
        }

        if (typeof ps.getAllPayments === 'function') {
          (ps.getAllPayments() || []).forEach(function (pay) {
            var trueId = trueIdFor(pay.supplierName || pay.sup, pay.supplierId);
            if (trueId && trueId !== pay.supplierId) {
              var oldId = pay.supplierId;
              ps.updatePayment(pay.id, { supplierId: trueId });
              if (oldId) ps.renameLedgerKey(oldId, trueId);
              stats.payments++;
            }
          });
        }

        try { localStorage.setItem(doneKey, '1'); } catch (_) {}
        console.info('[ERP.parties.migrateSupplierIds] done:', stats);
        return { ok: true, stats: stats };
      } catch (e) {
        console.error('[ERP.parties.migrateSupplierIds] failed:', e);
        return { ok: false, error: e && e.message };
      }
    }

    return {
      renderPage:    renderPage,
      renderList:    renderList,
      filterList:    filterList,
      switchTab:     switchTab,
      selectParty:   selectParty,
      renderDetail:  renderDetail,
      openAdd:       openAdd,
      openEdit:      openEdit,
      closeAdd:      closeAdd,
      saveNew:       saveNew,
      adjustBalance: adjustBalance,
      editSelected:  editSelected,
      showStatement: showStatement,

      exportCSV:        exportCSV,
      importCSV:        importCSV,
      downloadTemplate: downloadTemplate,
      _switchApmTab: _switchApmTab,
      _apmClearErr:  _apmClearErr,
      _apmSetErr:    _apmSetErr,

      resolveSupplierId:  resolveSupplierId,
      migrateSupplierIds: migrateSupplierIds
    };
  }());

})(ERP);

window.ERP = ERP;
