'use strict';

(function (root) {
  'use strict';

  var ACC = root.AccountingCore;
  var ERP = root.ERP;

  if (!ACC) { console.error('[expenses.ui] AccountingCore missing'); return; }
  if (!ERP) { console.error('[expenses.ui] ERP missing'); return; }

  var Money         = ACC.Money;
  var SOURCE_MODULE = ACC.SOURCE_MODULE;
  var ACCTS         = ACC.SYSTEM_ACCOUNTS;

  var DEFAULT_CATS = [
    { name: 'Salary / Wages',  debit: 'acc-5210', memo: 'Payroll — Salary/Wages' },
    { name: 'Rent',            debit: 'acc-5220', memo: 'Operating Expense — Rent' },
    { name: 'Utilities',       debit: 'acc-5230', memo: 'Operating Expense — Utilities' },
    { name: 'Office Supplies', debit: 'acc-5200', memo: 'Admin Expense — Office Supplies' },
    { name: 'Travel',          debit: 'acc-5240', memo: 'Operating Expense — Travel' },
    { name: 'Marketing',       debit: 'acc-5250', memo: 'Operating Expense — Marketing' },
    { name: 'Repairs',         debit: 'acc-5260', memo: 'Operating Expense — Repairs & Maintenance' },
    { name: 'Cost of Goods',   debit: 'acc-5100', memo: 'Cost of Goods Sold' },
    { name: 'Bank Charges',    debit: 'acc-5400', memo: 'Bank Charges & Fees' },
    { name: 'Loan Interest',   debit: 'acc-5300', memo: 'Finance Cost — Loan Interest' },
    { name: 'Other',           debit: 'acc-5200', memo: 'Admin Expense — Other' },
  ];

  function _toast(msg, type, dur) {
    if (ERP.ui && ERP.ui.toast) ERP.ui.toast(msg, type || 'info', dur);
    else if(window.DEBUG_MODE)console.log('[expenses]', msg);
  }
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function _fmt(paisa) {
    return Money.toDisplay(paisa);
  }
  function _fmtRs(amt) {
    return ERP.fmt ? ERP.fmt(amt) : 'Rs.' + (amt || 0).toFixed(2);
  }
  // FIX (root cause, audit #61-62): core.js (ERP.uid) loads first of 92
  // scripts, before this file -- a missing-ERP.uid fallback bought nothing
  // but a second, weaker ID scheme. Always use the canonical generator.
  function _uid() {
    return 'EXP-' + ERP.uid();
  }
  
  function _today() { return ERP.DateUtils.today(); }
  function _currentUser() {
    try { return (ERP.getState().session.user && ERP.getState().session.user.name) || 'user'; }
    catch(e) { return 'user'; }
  }

  function _getCategories() {
    try {
      var saved = (ERP.getState().settings || {}).expenseCategories;
      if (Array.isArray(saved) && saved.length > 0) return saved;
    } catch(e) {}
    return DEFAULT_CATS.map(function(c) { return { name: c.name, debit: c.debit, memo: c.memo }; });
  }

  function _saveCategories(cats) {
    try {
      ERP.setState(function(s) {
        if (!s.settings) s.settings = {};
        s.settings.expenseCategories = cats;
      });
      var rec = { key: 'expenseCategories', value: cats };
      if (ERP._db && ERP._db.save) ERP._db.save('settings', rec);
    } catch(e) { console.warn('[expenses] category save failed:', e); }
  }

  function _getCreditAccount(method) {
    if (method === 'Bank Transfer' || method === 'Cheque') return ACCTS.BANK;
    return ACCTS.CASH;
  }

  function _erpExpenses() {
    var s = ERP.getState();
    if (!s.data.expenses) {
      ERP.setState(function(st) { if (!st.data.expenses) st.data.expenses = []; });
      s = ERP.getState();
    }
    return s.data.expenses || [];
  }

  var MODAL_ID    = 'acc-exp-modal';
  var CAT_MODAL   = 'acc-exp-cat-modal';

  function _closeModal(id) {
    var m = document.getElementById(id);
    if (m) m.remove();
    document.body.style.overflow = '';
  }

  function render() {
    var pv = document.getElementById('pv-expenses');
    if (!pv) return;

    var expenses  = _erpExpenses().slice().reverse();
    var totalAmt  = expenses.reduce(function(s,e){ return s + (e.amt||0); }, 0);
    var thisMonth = _today().slice(0,7);
    var monthAmt  = expenses.filter(function(e){ return (e.date||'').slice(0,7)===thisMonth; })
                            .reduce(function(s,e){ return s+(e.amt||0); }, 0);

    var byCat = {};
    expenses.forEach(function(e){ byCat[e.cat||'Other'] = (byCat[e.cat||'Other']||0) + (e.amt||0); });
    var topCat = Object.keys(byCat).sort(function(a,b){ return byCat[b]-byCat[a]; })[0] || '—';

    var rows = expenses.length
      ? expenses.map(function(e) {
          return '<tr style="border-bottom:1px solid var(--border-l)">' +
            '<td style="padding:10px 12px;color:var(--muted);font-size:12px">' + _esc(e.date||'') + '</td>' +
            '<td style="padding:10px 12px">' +
              '<span class="au-badge" style="background:#ede9fe;color:#7c3aed">' + _esc(e.cat||'—') + '</span>' +
            '</td>' +
            '<td style="padding:10px 12px;text-align:right;font-weight:700">' + _esc(_fmtRs(e.amt)) + '</td>' +
            '<td style="padding:10px 12px;color:var(--muted);font-size:12px">' + _esc(e.method||'Cash') + '</td>' +
            '<td style="padding:10px 12px;color:var(--muted);font-size:12px;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _esc(e.note||'—') + '</td>' +
            '<td style="padding:10px 12px;text-align:center">' +
              '<button class="btn btn-sm acc-exp-del-btn au-btn" data-exp-id="' + _esc(e.id) + '"' +
              ' style="color:var(--danger);border-color:#fee2e2;height:28px;font-size:11px;padding:0 10px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-trash"/></svg></button>' +
            '</td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--muted)">No expense records yet. Click "Add Expense" to get started.</td></tr>';

    pv.innerHTML =
      window.renderStatCards([
        { icon:'💰', value: _esc(_fmtRs(totalAmt)), label:'Total Expenses', color:'#dc2626', bg:'#fef2f2' },
        { icon:'📅', value: _esc(_fmtRs(monthAmt)), label:'This Month',     color:'#d97706', bg:'#fffbeb' },
        { icon:'🧾', value: expenses.length,        label:'Records',        color:'#4338CA', bg:'#eff6ff' },
        { icon:'🏷️', value: _esc(topCat),           label:'Top Category',   color:'#7c3aed', bg:'#f5f3ff' },
      ]) +

      '<div class="au-toolbar">' +
        '<div class="au-toolbar-left"></div>' +
        '<div class="au-toolbar-right">' +
          '<button id="exp-cat-btn" class="au-btn au-btn-ghost"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#ic-cog"/></svg> Categories (' + _getCategories().length + ')</button>' +
          '<button id="exp-add-btn" class="au-btn au-btn-primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Expense</button>' +
        '</div>' +
      '</div>' +

      '<div class="au-panel">' +
        '<div class="au-tbl-wrap">' +
        '<table class="au-tbl">' +
          '<thead>' +
            '<tr>' +
              '<th>Date</th>' +
              '<th>Category</th>' +
              '<th style="text-align:right">Amount</th>' +
              '<th>Method</th>' +
              '<th>Note</th>' +
              '<th>Action</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div>' +
      '</div>';

    document.getElementById('exp-add-btn').onclick = openAdd;
    document.getElementById('exp-cat-btn').onclick = openCategoryManager;

    pv.querySelectorAll('.acc-exp-del-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { _confirmDelete(btn.getAttribute('data-exp-id')); });
    });
  }

  function openCategoryManager() {
    _closeModal(CAT_MODAL);
    var cats = _getCategories();

    function _buildCatList(cats) {
      if (!cats.length) return '<div style="text-align:center;padding:20px;color:var(--muted)">No categories yet</div>';
      return cats.map(function(c, i) {
        var isDefault = DEFAULT_CATS.some(function(d){ return d.name === c.name; });
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border-l)">' +
          '<div>' +
            '<span style="font-weight:500;font-size:13px">' + _esc(c.name) + '</span>' +
            (isDefault ? '<span style="margin-left:6px;font-size:10px;color:var(--muted,#64748b);background:var(--bg,#f1f5f9);padding:1px 6px;border-radius:10px">system</span>' : '') +
          '</div>' +
          (!isDefault
            ? '<button class="btn btn-sm exp-cat-del" data-idx="' + i + '" style="color:var(--danger);border:1px solid var(--danger);background:transparent;font-size:11px;padding:2px 8px">Delete</button>'
            : '<span style="font-size:11px;color:var(--muted)">built-in</span>') +
        '</div>';
      }).join('');
    }

    var modal = document.createElement('div');
    modal.id        = CAT_MODAL;
    modal.className = 'modal-bg open';

    modal.innerHTML =
      '<div class="modal sm">' +
        '<div class="modal-head">' +
          '<h2>⚙️ Manage Categories</h2>' +
          '<button id="exp-cat-close" class="modal-x"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#ic-x"/></svg></button>' +
        '</div>' +
        '<div class="modal-body" style="padding:0">' +
          '<div id="exp-cat-list">' + _buildCatList(cats) + '</div>' +
          '<div style="padding:14px 20px;border-top:1px solid var(--border)">' +
            '<div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">New Category</div>' +
            '<div style="display:flex;gap:8px">' +
              '<input id="exp-new-cat-name" type="text" placeholder="Category name..." class="fi" style="flex:1">' +
              '<button id="exp-cat-add-btn" class="btn btn-primary">Add</button>' +
            '</div>' +
            '<div id="exp-cat-err" style="display:none;color:var(--danger);font-size:12px;margin-top:6px"></div>' +
          '</div>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<button class="btn btn-ghost" onclick="document.getElementById(\'' + CAT_MODAL + '\').remove();document.body.style.overflow=\'\'">Close</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    document.getElementById('exp-cat-close').onclick = function() { _closeModal(CAT_MODAL); };
    modal.addEventListener('click', function(e) { if (e.target === modal) _closeModal(CAT_MODAL); });

    function _rebind() {
      var cats2 = _getCategories();
      document.getElementById('exp-cat-list').innerHTML = _buildCatList(cats2);
      document.querySelectorAll('.exp-cat-del').forEach(function(btn) {
        btn.onclick = function() {
          var idx = parseInt(btn.getAttribute('data-idx'));
          var cats3 = _getCategories();
          cats3.splice(idx, 1);
          _saveCategories(cats3);
          _rebind();
          render();
        };
      });
    }
    _rebind();

    document.getElementById('exp-cat-add-btn').onclick = function() {
      var nameEl = document.getElementById('exp-new-cat-name');
      var errEl  = document.getElementById('exp-cat-err');
      var name   = (nameEl.value || '').trim();
      errEl.style.display = 'none';
      if (!name) { errEl.textContent = 'Category name likhein.'; errEl.style.display = ''; return; }
      var cats4 = _getCategories();
      if (cats4.some(function(c){ return c.name.toLowerCase() === name.toLowerCase(); })) {
        errEl.textContent = 'Yeh category pehle se exist karti hai.'; errEl.style.display = ''; return;
      }
      cats4.push({ name: name, debit: 'acc-5200', memo: 'Admin Expense — ' + name });
      _saveCategories(cats4);
      nameEl.value = '';
      _rebind();
      render();
      _toast('Category "' + name + '" add ho gayi ✓', 'success');
    };

    var nameEl = document.getElementById('exp-new-cat-name');
    if (nameEl) nameEl.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') document.getElementById('exp-cat-add-btn').click();
    });
  }

  function openAdd() {
    _closeModal(MODAL_ID);
    var cats = _getCategories();

    var catOptions = cats.map(function(c) {
      return '<option value="' + _esc(c.name) + '">' + _esc(c.name) + '</option>';
    }).join('');

    var modal = document.createElement('div');
    modal.id        = MODAL_ID;
    modal.className = 'modal-bg open';

    modal.innerHTML =
      '<div class="modal sm">' +
        '<div class="modal-head">' +
          '<h2>💸 Add Expense</h2>' +
          '<button id="acc-exp-close" class="modal-x"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#ic-x"/></svg></button>' +
        '</div>' +
        '<div class="modal-body">' +

          _fld('Date', 'acc-exp-date', 'date', _today(), true) +

          '<div class="fgrp" style="margin-bottom:12px">' +
            '<label>Category <span style="color:var(--danger)">*</span></label>' +
            '<div style="display:flex;gap:6px">' +
              '<select id="acc-exp-cat" class="fi" style="flex:1">' +
                '<option value="">— Select Category —</option>' + catOptions +
              '</select>' +
              '<button id="acc-exp-newcat" class="btn btn-sm" title="New category add karein" style="height:36px;padding:0 10px">+ New</button>' +
            '</div>' +
          '</div>' +

          _fld('Amount (Rs.)', 'acc-exp-amt', 'number', '', true, '0.00') +

          '<div class="fgrp" style="margin-bottom:12px">' +
            '<label>Payment Method</label>' +
            '<select id="acc-exp-method" class="fi">' +
              '<option value="Cash" selected>Cash</option>' +
              '<option value="Bank Transfer">Bank Transfer</option>' +
              '<option value="Cheque">Cheque</option>' +
            '</select>' +
          '</div>' +

          _fld('Note (optional)', 'acc-exp-note', 'text', 'Description…') +

          '<div id="acc-exp-gl-preview" style="display:none;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--r-lg);padding:10px;font-size:12px;color:#166534">' +
            'GL Entry: <strong>DR</strong> <span id="acc-exp-gl-dr"></span> &nbsp;/&nbsp; <strong>CR</strong> <span id="acc-exp-gl-cr"></span>' +
          '</div>' +
          '<div id="acc-exp-err" style="display:none;color:var(--danger);font-size:13px;text-align:center;margin-top:8px"></div>' +

        '</div>' +
        '<div class="modal-foot">' +
          '<button id="acc-exp-cancel-btn" class="btn btn-ghost">Cancel</button>' +
          '<button id="acc-exp-save-btn" class="btn btn-primary">Save Expense</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    document.getElementById('acc-exp-close').onclick      = function() { _closeModal(MODAL_ID); };
    document.getElementById('acc-exp-cancel-btn').onclick = function() { _closeModal(MODAL_ID); };
    modal.addEventListener('click', function(e) { if (e.target === modal) _closeModal(MODAL_ID); });

    document.getElementById('acc-exp-cat').addEventListener('change', _updateGL);
    document.getElementById('acc-exp-method').addEventListener('change', _updateGL);
    document.getElementById('acc-exp-save-btn').onclick = _saveExpense;

    document.getElementById('acc-exp-newcat').onclick = function() {
      var name = (prompt('Nai category ka naam:') || '').trim();
      if (!name) return;
      var cats2 = _getCategories();
      if (cats2.some(function(c){ return c.name.toLowerCase()===name.toLowerCase(); })) {
        _toast('Category already exists', 'warning'); return;
      }
      cats2.push({ name: name, debit: 'acc-5200', memo: 'Admin Expense — ' + name });
      _saveCategories(cats2);
      var sel = document.getElementById('acc-exp-cat');
      var opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      sel.appendChild(opt);
      sel.value = name;
      _updateGL();
      _toast('Category "' + name + '" add ho gayi ✓', 'success');
    };

    var amtEl = document.getElementById('acc-exp-amt');
    if (amtEl) setTimeout(function() { amtEl.focus(); }, 50);
  }

  function _fld(label, id, type, def, req, placeholder) {
    return '<div class="fgrp" style="margin-bottom:12px">' +
      '<label>' + _esc(label) + (req ? ' <span style="color:var(--danger)">*</span>' : '') + '</label>' +
      '<input id="' + id + '" type="' + type + '" class="fi"' +
        (def         !== undefined ? ' value="'       + _esc(String(def))   + '"' : '') +
        (placeholder !== undefined ? ' placeholder="' + _esc(placeholder)   + '"' : '') + '>' +
    '</div>';
  }

  function _updateGL() {
    var cat     = (document.getElementById('acc-exp-cat')    || {}).value || '';
    var method  = (document.getElementById('acc-exp-method') || {}).value || 'Cash';
    var preview = document.getElementById('acc-exp-gl-preview');
    var drEl    = document.getElementById('acc-exp-gl-dr');
    var crEl    = document.getElementById('acc-exp-gl-cr');
    if (!preview || !cat) { if(preview) preview.style.display='none'; return; }

    var cats    = _getCategories();
    var catObj  = cats.find(function(c){ return c.name === cat; });
    var drAccId = catObj ? catObj.debit : 'acc-5200';
    var crAccId = _getCreditAccount(method);

    var drName = drAccId;
    var crName = crAccId;
    try {
      if (ACC.AccountingState && ACC.AccountingState.isInitialized()) {
        var drAcc = ACC.AccountingState.getCOAAccount(drAccId);
        var crAcc = ACC.AccountingState.getCOAAccount(crAccId);
        if (drAcc) drName = drAcc.code + ' ' + drAcc.name;
        if (crAcc) crName = crAcc.code + ' ' + crAcc.name;
      }
    } catch(e) {}

    if (drEl) drEl.textContent = drName;
    if (crEl) crEl.textContent = crName;
    preview.style.display = '';
  }

  function _saveExpense() {
    var btn = document.getElementById('acc-exp-save-btn');
    var err = document.getElementById('acc-exp-err');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    if (err) { err.style.display = 'none'; }

    try {
      var date   = (document.getElementById('acc-exp-date').value  || '').trim();
      var cat    = (document.getElementById('acc-exp-cat').value   || '').trim();
      var amtRs  = parseFloat(document.getElementById('acc-exp-amt').value) || 0;
      var method = (document.getElementById('acc-exp-method').value || 'Cash');
      var note   = (document.getElementById('acc-exp-note').value  || '').trim();

      if (!date)      throw new Error('Date zaroori hai.');
      if (!cat)       throw new Error('Category select karein.');
      if (amtRs <= 0) throw new Error('Amount 0 se zyada hona chahiye.');

      if (window.ERP && ERP.PeriodLock) {
        var _plCheck = ERP.PeriodLock.check(date);
        if (_plCheck && _plCheck.locked) {
          throw new Error('Period ' + _plCheck.periodId + ' closed hai — expense post nahi ho sakta.');
        }
      }

      var amtPaisa   = Money.toPaisa(amtRs);
      var id         = _uid();
      var actor      = _currentUser();
      var cats       = _getCategories();
      var catObj     = cats.find(function(c){ return c.name === cat; });
      var drAccId    = catObj ? catObj.debit : 'acc-5200';
      var drMemo     = (catObj && catObj.memo) ? catObj.memo : cat;
      var crAccId    = _getCreditAccount(method);

      var journalData = {
        date:         date,
        reference:    id,
        sourceModule: SOURCE_MODULE.EXPENSES,
        sourceId:     id,
        memo:         drMemo + (note ? ' — ' + note : '') + (method !== 'Cash' ? ' [' + method + ']' : ''),
        party:        '',
        entries: [
          { accountId: drAccId, debit: amtPaisa, credit: 0,        description: drMemo + (note ? ': '+note : '') },
          { accountId: crAccId, debit: 0,        credit: amtPaisa, description: 'Paid via ' + method },
        ],
      };

      var _doPost = function() {
        if (!ACC.JournalService) return Promise.resolve(null);
        if (!ACC.AccountingState.isInitialized()) ACC.AccountingState.initialize();
        return ACC.JournalService.post(journalData, actor);
      };

      
      _doPost().then(function(journal) {
        ERP.setState(function(s) {
          if (!s.data.expenses) s.data.expenses = [];
          s.data.expenses.push({ id:id, date:date, cat:cat, amtPaisa:amtPaisa, amt:amtRs, note:note, method:method });
        });
        if (ERP._db && ERP._db.save) {
          ERP.Persistence.save('expenses', ERP.getState().data.expenses)
            .catch(function(e){ console.warn('[expenses] IDB save failed:', e); });
        }

        try {
          if (ACC.AccountingState) {
            ACC.AccountingState.addExpense({
              id: id, date: date, category: cat, description: note||cat,
              amountPaisa: amtPaisa, paymentMethod: method,
              paymentAccountId: crAccId, journalId: journal ? journal.id : null,
              status: 'posted', createdAt: Date.now(), createdBy: actor,
            });
          }
        } catch(e) { console.warn('[expenses] addExpense error:', e); }

        _closeModal(MODAL_ID);
        _toast('✅ Expense saved — ' + cat + ' ' + _fmt(amtPaisa), 'success', 3000);
        render();
        try { if (ERP.dash && ERP.dash.render) ERP.dash.render(); } catch(e){}
      }).catch(function(glErr) {
        
        console.error('[expenses] GL error:', glErr);
        if (err) { err.textContent = 'GL post failed: ' + (glErr && glErr.message); err.style.display = ''; }
        if (btn) { btn.disabled = false; btn.textContent = 'Save Expense'; }
        _toast('❌ Expense NOT saved — GL error: ' + (glErr && glErr.message), 'error', 0);
      });

    } catch(e) {
      if (err) { err.textContent = e.message; err.style.display = ''; }
      if (btn) { btn.disabled = false; btn.textContent = 'Save Expense'; }
    }
  }

  function _confirmDelete(id) {
    if (!id) return;
    var rec = _erpExpenses().find(function(e){ return e.id === id; });
    if (!rec) { _toast('Record not found.', 'error'); return; }

    var _expMsg = 'Delete expense?\n' + (rec.cat||'') + ' — ' + _fmtRs(rec.amt||0) +
                 '\nDate: ' + (rec.date||'') + '\n\nGL journal bhi reverse hoga.';
    var _expConfirm = (window.ERP && window.ERP.confirmDialog) || function(msg, ok) { if (window.confirm(msg)) ok(); };
    _expConfirm(_expMsg, function() {
    if (ACC.JournalService && ACC.AccountingState) {
      try {
        var journal = ACC.AccountingState.getAllJournals()
          .find(function(j){ return j.sourceId === id && j.status !== 'reversed'; });
        if (journal) {
          ACC.JournalService.reverse(journal.id, 'Expense deleted: ' + id, _currentUser())
            .then(function() {
              ERP.setState(function(s) {
                s.data.expenses = (s.data.expenses||[]).filter(function(e){ return e.id !== id; });
              });
              if (ERP._db && ERP._db.save) {
                ERP.Persistence.save('expenses', ERP.getState().data.expenses)
                  .catch(function(e){ console.warn('[expenses] IDB delete failed:', e); });
              }
              _toast('Expense deleted.', 'success');
              render();
            })
            .catch(function(e) {
              console.error('[expenses] GL reversal failed:', e);
              _toast('❌ Expense could not be deleted — GL reversal failed: ' + (e && e.message), 'error', 0);
            });
          return;
        }
      } catch(e) {
        console.error('[expenses] GL reversal setup error:', e);
        _toast('❌ Expense could not be deleted — GL reversal error: ' + (e && e.message), 'error', 0);
        return;
      }
    }

    ERP.setState(function(s) {
      s.data.expenses = (s.data.expenses||[]).filter(function(e){ return e.id !== id; });
    });
    if (ERP._db && ERP._db.save) {
      ERP.Persistence.save('expenses', ERP.getState().data.expenses)
        .catch(function(e){ console.warn('[expenses] IDB delete failed:', e); });
    }
    render();
    try { if (ERP.dash && ERP.dash.render) ERP.dash.render(); } catch(e){}
    });
  }

  function _initAccounting() {
    if (!ACC.AccountingState) return;
    if (!ACC.AccountingState.isInitialized()) {
      try { ACC.AccountingState.initialize(); } catch(e) { console.warn('[expenses] init error:', e); }
    }
    
  }

  function _boot() {
    if (ERP.registerRenderer) ERP.registerRenderer('expenses', function() { render(); });
    ERP.expenses = { render: render, openAdd: openAdd };
    _initAccounting();
    if (window.DEBUG_MODE) console.log('[expenses.ui] v3 ready — custom categories + GL connected');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

})(typeof window !== 'undefined' ? window : globalThis);
