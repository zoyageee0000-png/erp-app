
'use strict';

(function (root) {
  'use strict';

  var ACC = root.AccountingCore;
  var ERP = root.ERP;

  if (!ACC) { console.error('[banking.ui] AccountingCore missing — load accounting.constants.js first.'); return; }
  if (!ERP) { console.error('[banking.ui] ERP namespace missing.'); return; }

  var Money = ACC.Money;

  function _toast(msg, type) {
    if (ERP.ui && ERP.ui.toast) ERP.ui.toast(msg, type || 'info');
    else if(window.DEBUG_MODE)console.log('[banking]', msg);
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function _fmt(paisa) { return Money.toDisplay(paisa); }

  // FIX (root cause, audit #61-62): core.js (ERP.uid) is the first of 92
  // scripts loaded, before this file -- if it's missing the app already
  // failed to boot, so the local fallback bought nothing but a second,
  // weaker ID scheme. Always use the one canonical, collision-safe generator.
  function _uid() {
    return 'bank-' + ERP.uid();
  }

  
  function _today() { return ERP.DateUtils && ERP.DateUtils.today ? ERP.DateUtils.today() : new Date().toISOString().slice(0, 10); }

  function _currentUser() {
    try { return (ERP.getState().session.user && ERP.getState().session.user.name) || 'user'; } catch (e) { return 'user'; }
  }

  function _getAccounts() {
    try { return ACC.AccountingState.getAllBankAccounts(); } catch (e) { return []; }
  }

  function _getAllTx() {
    try { return ACC.AccountingState.getAllBankTransactions(); } catch (e) { return []; }
  }

  function _getTxByAccount(accountId) {
    return _getAllTx().filter(function (t) { return t.bankAccountId === accountId; });
  }

  function _calcBalance(account) {
    var bal = account.openingBalancePaisa || 0;
    _getTxByAccount(account.id).forEach(function (t) {
      if (t.reversed) return;
      var amt = t.amountPaisa || 0;
      bal += (t.type === 'credit') ? amt : -amt;
    });
    return bal;
  }

  var ACCT_MODAL_ID = 'acc-bank-acct-modal';
  var TX_MODAL_ID   = 'acc-bank-tx-modal';

  function _closeModal(id) {
    var m = document.getElementById(id);
    if (m) m.remove();
    document.body.style.overflow = '';
  }

  function _closeAll() {
    [ACCT_MODAL_ID, TX_MODAL_ID].forEach(_closeModal);
  }

  var _selectedAccountId = null;

  function render() {
    var pv = document.getElementById('pv-bank');
    if (!pv) return;

    var accounts = _getAccounts();

    if (_selectedAccountId && !accounts.find(function (a) { return a.id === _selectedAccountId; })) {
      _selectedAccountId = null;
    }

    if (!_selectedAccountId && accounts.length > 0) {
      _selectedAccountId = accounts[0].id;
    }

    pv.innerHTML =
      '<div style="padding:16px">' +

      _renderSummaryCards(accounts) +

      '<div style="display:grid;grid-template-columns:260px 1fr;gap:16px;align-items:start">' +

        _renderAccountList(accounts) +

        _renderLedger(accounts) +

      '</div>' +
      '</div>';

    _bindEvents(pv, accounts);
  }

  function _renderSummaryCards(accounts) {
    var totalBalance = 0;
    var totalCredit  = 0;
    var totalDebit   = 0;

    accounts.forEach(function (a) {
      var bal = _calcBalance(a);
      totalBalance += bal;
      _getTxByAccount(a.id).forEach(function (t) {
        if (t.reversed) return;
        var amt = t.amountPaisa || 0;
        if (t.type === 'credit') totalCredit += amt;
        else totalDebit += amt;
      });
    });

    return window.renderStatCards([
      { icon:'🏦', value: accounts.length,           label:'Total Accounts', color:'#4338CA', bg:'#eff6ff' },
      { icon:'💰', value: _fmt(totalBalance),         label:'Total Balance',  color: totalBalance >= 0 ? '#16a34a' : '#dc2626', bg: totalBalance >= 0 ? '#f0fdf4' : '#fef2f2' },
      { icon:'⬇️', value: _fmt(totalCredit),          label:'Total Credits',  color:'#16a34a', bg:'#f0fdf4' },
      { icon:'🚚', value: _fmt(totalDebit),           label:'Total Debits',   color:'#dc2626', bg:'#fef2f2' },
    ], { marginBottom: 16 });
  }

  function _renderAccountList(accounts) {
    var rows = accounts.length === 0
      ? '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">No bank accounts yet.<br>Click "+ Add Account" to create one.</div>'
      : accounts.map(function (a) {
          var bal     = _calcBalance(a);
          var active  = a.id === _selectedAccountId;
          var txCount = _getTxByAccount(a.id).filter(function (t) { return !t.reversed; }).length;
          return '<div class="bk-acct-row" data-acct-id="' + _esc(a.id) + '" style="' +
            'padding:12px 14px;cursor:pointer;border-bottom:1px solid var(--border-l);' +
            'background:' + (active ? 'var(--primary-bg,#eff6ff)' : 'transparent') + ';' +
            'border-left:3px solid ' + (active ? 'var(--primary,#4338CA)' : 'transparent') + '">' +
            '<div style="font-weight:600;font-size:13px;color:var(--text)">' + _esc(a.name) + '</div>' +
            '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + _esc(a.bankName || '—') +
              (a.accountNumber ? ' · ' + _esc(a.accountNumber) : '') + '</div>' +
            '<div style="margin-top:6px;display:flex;justify-content:space-between;align-items:center">' +
              '<span style="font-size:13px;font-weight:700;color:' + (bal >= 0 ? '#22c55e' : '#ef4444') + '">' + _fmt(bal) + '</span>' +
              '<span style="font-size:11px;color:var(--muted)">' + txCount + ' tx</span>' +
            '</div>' +
          '</div>';
        }).join('');

    return '<div class="au-panel" style="padding:0;overflow:hidden">' +
      '<div style="padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border-l)">' +
        '<span style="font-weight:700;font-size:13px;display:flex;align-items:center;gap:6px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><use href="#ic-bank"/></svg> ACCOUNTS</span>' +
        '<button id="bk-add-acct-btn" class="btn btn-sm btn-primary" style="font-size:11px;padding:4px 10px">+ Add Account</button>' +
      '</div>' +
      rows +
    '</div>';
  }

  function _renderLedger(accounts) {
    if (accounts.length === 0) {
      return '<div class="au-panel" style="display:flex;align-items:center;justify-content:center;min-height:300px;color:var(--muted);font-size:13px;text-align:center;flex-direction:column;gap:8px">' +
        '<div style="font-size:36px">🏦</div>' +
        '<div>Add a bank account to get started</div>' +
      '</div>';
    }

    var acct = accounts.find(function (a) { return a.id === _selectedAccountId; });
    if (!acct) {
      return '<div class="au-panel" style="padding:32px;text-align:center;color:var(--muted)">Select an account</div>';
    }

    var txList = _getTxByAccount(acct.id).slice().sort(function (a, b) {
      return b.date > a.date ? 1 : b.date < a.date ? -1 : 0;
    });
    var bal = _calcBalance(acct);

    var rows = txList.length === 0
      ? '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--muted)">No transactions yet. Click "+ New Transaction" to add one.</td></tr>'
      : txList.map(function (t) {
          var isCredit  = t.type === 'credit';
          var amtColor  = isCredit ? '#22c55e' : '#ef4444';
          var amtSign   = isCredit ? '+' : '−';
          var reversed  = t.reversed;
          var style     = reversed ? 'opacity:.45;text-decoration:line-through;' : '';

          return '<tr style="border-bottom:1px solid var(--border-l);' + style + '" data-tx-id="' + _esc(t.id) + '">' +
            '<td style="padding:10px 12px;color:var(--muted);font-size:12px;white-space:nowrap">' + _esc(t.date) + '</td>' +
            '<td style="padding:10px 12px;font-size:13px">' +
              '<div style="font-weight:500">' + _esc(t.description || '—') + '</div>' +
              (t.reference ? '<div style="font-size:11px;color:var(--muted)">' + _esc(t.reference) + '</div>' : '') +
            '</td>' +
            '<td style="padding:10px 12px;text-align:center">' +
              '<span style="font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;' +
                'background:' + (isCredit ? '#dcfce7' : '#fee2e2') + ';' +
                'color:' + (isCredit ? '#166534' : '#991b1b') + '">' +
                (isCredit ? 'Credit' : 'Debit') +
              '</span>' +
            '</td>' +
            '<td style="padding:10px 12px;text-align:right;font-weight:700;color:' + amtColor + '">' +
              amtSign + _fmt(t.amountPaisa || 0) +
            '</td>' +
            '<td style="padding:10px 12px;text-align:center">' +
              (t.reconciled
                ? '<span style="color:#22c55e;font-size:12px" title="Reconciled">✅</span>'
                : '<button class="btn btn-sm bk-reconcile-btn" data-tx-id="' + _esc(t.id) + '" style="font-size:11px;padding:3px 8px;border:1px solid var(--border)">Reconcile</button>') +
            '</td>' +
            '<td style="padding:10px 12px;text-align:center">' +
              (!reversed
                ? '<button class="btn btn-sm bk-reverse-btn" data-tx-id="' + _esc(t.id) + '" style="font-size:11px;padding:3px 8px;border:1px solid var(--border);color:var(--danger)">Reverse</button>'
                : '<span style="font-size:11px;color:var(--muted)">Reversed</span>') +
            '</td>' +
          '</tr>';
        }).join('');

    return '<div class="au-panel" style="padding:0;overflow:hidden">' +
      '<div style="padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border-l)">'+
        '<div>' +
          '<span style="font-weight:700;font-size:13px;display:flex;align-items:center;gap:6px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><use href="#ic-receipt"/></svg>' + _esc((acct.name || 'Unnamed account').toUpperCase()) + '</span>' +
          '<span style="margin-left:10px;font-size:12px;color:var(--muted)">' + _esc(acct.bankName || '') + (acct.accountNumber ? ' · ' + _esc(acct.accountNumber) : '') + '</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:13px;font-weight:700;color:' + (bal >= 0 ? '#22c55e' : '#ef4444') + '">' + _fmt(bal) + '</span>' +
          '<button id="bk-add-tx-btn" class="btn btn-sm btn-primary" style="font-size:11px;padding:4px 10px">+ New Transaction</button>' +
        '</div>' +
      '</div>' +
      '<div class="au-tbl-wrap">' +
      '<table class="au-tbl">' +
        '<thead>' +
          '<tr style="background:var(--bg);border-bottom:2px solid var(--border)">' +
            '<th style="padding:8px 12px;text-align:left;color:var(--muted);font-weight:600;white-space:nowrap">Date</th>' +
            '<th style="padding:8px 12px;text-align:left;color:var(--muted);font-weight:600">Description</th>' +
            '<th style="padding:8px 12px;text-align:center;color:var(--muted);font-weight:600">Type</th>' +
            '<th style="padding:8px 12px;text-align:right;color:var(--muted);font-weight:600">Amount</th>' +
            '<th style="padding:8px 12px;text-align:center;color:var(--muted);font-weight:600">Reconciled</th>' +
            '<th style="padding:8px 12px;text-align:center;color:var(--muted);font-weight:600">Actions</th>' +
          '</tr>' +
        '</thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
      '</div>' +
    '</div>';
  }

  function _bindEvents(pv, accounts) {
    pv.querySelectorAll('.bk-acct-row').forEach(function (row) {
      row.addEventListener('click', function () {
        _selectedAccountId = row.getAttribute('data-acct-id');
        render();
      });
    });

    var addAcctBtn = document.getElementById('bk-add-acct-btn');
    if (addAcctBtn) addAcctBtn.addEventListener('click', openAddAccount);

    var addTxBtn = document.getElementById('bk-add-tx-btn');
    if (addTxBtn) addTxBtn.addEventListener('click', function () { openAddTransaction(_selectedAccountId); });

    pv.querySelectorAll('.bk-reconcile-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var txId = btn.getAttribute('data-tx-id');
        _reconcile(txId);
      });
    });

    pv.querySelectorAll('.bk-reverse-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var txId = btn.getAttribute('data-tx-id');
        _reverse(txId);
      });
    });
  }

  function _reconcile(txId) {
    try {
      ACC.AccountingState.reconcileBankTransaction(txId, new Date().toISOString());
      _persistOneTx(txId);
      _toast('Transaction reconciled ✓', 'success');
      render();
    } catch (e) {
      _toast('Reconcile failed: ' + e.message, 'error');
    }
  }

  var _pendingReversals = {};

  function _reverse(txId) {
    if (_pendingReversals[txId]) return;
    var _rvConfirm = (window.ERP && window.ERP.confirmDialog) || function(msg, ok) { if (typeof ok === 'function' && window.confirm(msg)) ok(); };
    _rvConfirm('Reverse this transaction? This cannot be undone.', function() {
      if (_pendingReversals[txId]) return;
      _pendingReversals[txId] = true;
      try {
        var txAll = _getAllTx();
        var tx    = txAll.find(function (t) { return t.id === txId; });
        if (!tx)         { _toast('Transaction not found', 'error');   delete _pendingReversals[txId]; return; }
        if (tx.reversed) { _toast('Already reversed',     'warning');  delete _pendingReversals[txId]; return; }

      if (ACC.JournalService) {
        var ACCTS2      = ACC.SYSTEM_ACCOUNTS || {};
        var bankAcctId  = ACCTS2.BANK  || 'acc-1002';
        var otherAcctId = (tx.type === 'credit')
          ? (ACCTS2.AR           || 'acc-1100')
          : (ACCTS2.BANK_CHARGES || 'acc-6100');
        var amtP = tx.amountPaisa || 0;
        var revEntries = (tx.type === 'credit')
          ? [
              { accountId: bankAcctId,  debit: 0,    credit: amtP, description: 'REVERSAL: ' + (tx.description || txId) },
              { accountId: otherAcctId, debit: amtP, credit: 0,    description: 'REVERSAL: ' + (tx.description || txId) }
            ]
          : [
              { accountId: otherAcctId, debit: 0,    credit: amtP, description: 'REVERSAL: ' + (tx.description || txId) },
              { accountId: bankAcctId,  debit: amtP, credit: 0,    description: 'REVERSAL: ' + (tx.description || txId) }
            ];
        ACC.JournalService.post({
          date:         (function(){ var _d=new Date(); return _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0'); })(),
          reference:    'REV-' + txId,
          sourceModule: (ACC.SOURCE_MODULE || {}).BANKING || 'banking',
          sourceId:     'REV-' + txId,
          memo:         'Bank transaction reversed: ' + (tx.description || txId),
          entries:      revEntries
        }, 'system').then(function () {
          ACC.AccountingState.markBankTransactionReversed(txId, null);
          _persistOneTx(txId);
          _toast('Transaction reversed', 'info');
          render();
        }).catch(function (e) {
          console.error('[banking.ui] GL reversal failed — state NOT marked reversed:', e && e.message);
          _toast('Reversal failed — GL journal post failed: ' + (e && e.message || 'unknown'), 'error', 0);
        }).finally(function () {
          delete _pendingReversals[txId];
        });
      } else {
        ACC.AccountingState.markBankTransactionReversed(txId, null);
        _persistOneTx(txId);
        _toast('Transaction reversed (no GL)', 'info');
        render();
        delete _pendingReversals[txId];
      }
      } catch (e) {
        _toast('Reverse failed: ' + e.message, 'error');
        delete _pendingReversals[txId];
      }
    });
  }


  function openAddAccount() {
    _closeAll();

    var modal = document.createElement('div');
    modal.id  = ACCT_MODAL_ID;
    modal.className = 'modal-bg open';

    modal.innerHTML =
      '<div class="modal sm">' +
        '<div class="modal-head">' +
          '<h2>🏦 Add Bank Account</h2>' +
          '<button id="bk-acct-close" class="modal-x"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#ic-x"/></svg></button>' +
        '</div>' +
        '<div class="modal-body">' +
          _field('Account Name *', 'bk-acct-name', 'text', 'e.g. HBL Current Account') +
          _field('Bank Name', 'bk-acct-bank', 'text', 'e.g. HBL, MCB, UBL') +
          _field('Account Number', 'bk-acct-num', 'text', 'Optional') +
          _field('Opening Balance (Rs.)', 'bk-acct-opening', 'number', '0') +
          _field('Opening Date', 'bk-acct-date', 'date', '', _today()) +
          '<div id="bk-acct-err" style="display:none;margin-top:10px;color:var(--danger);font-size:13px;text-align:center"></div>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<button id="bk-acct-cancel" class="btn btn-ghost">Cancel</button>' +
          '<button id="bk-acct-save" class="btn btn-primary">Save Account</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    document.getElementById('bk-acct-close').onclick  = function () { _closeModal(ACCT_MODAL_ID); };
    document.getElementById('bk-acct-cancel').onclick = function () { _closeModal(ACCT_MODAL_ID); };
    modal.addEventListener('click', function (e) { if (e.target === modal) _closeModal(ACCT_MODAL_ID); });
    document.getElementById('bk-acct-save').onclick = _saveAccount;

    setTimeout(function () {
      var f = document.getElementById('bk-acct-name');
      if (f) f.focus();
    }, 50);
  }

  function _saveAccount() {
    var btn = document.getElementById('bk-acct-save');
    var err = document.getElementById('bk-acct-err');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    if (err) { err.style.display = 'none'; }

    try {
      var name    = (document.getElementById('bk-acct-name').value    || '').trim();
      var bank    = (document.getElementById('bk-acct-bank').value    || '').trim();
      var num     = (document.getElementById('bk-acct-num').value     || '').trim();
      var openRs  = Math.round((parseFloat(document.getElementById('bk-acct-opening').value) || 0) * 100) / 100;
      var date    = (document.getElementById('bk-acct-date').value    || '').trim() || _today();

      if (!name) throw new Error('Account name is required.');

      var existing = _getAccounts();
      var dupe = existing.find(function (a) { return a.name && a.name.trim().toLowerCase() === name.toLowerCase(); });
      if (dupe) throw new Error('An account named "' + name + '" already exists.');

      var account = Object.freeze({
        id:                   _uid(),
        name:                 name,
        bankName:             bank,
        accountNumber:        num,
        openingBalancePaisa:  Money.toPaisa(openRs),
        openingDate:          date,
        isActive:             true,
        createdAt:            new Date().toISOString(),
        createdBy:            _currentUser(),
      });

      ACC.AccountingState.addBankAccount(account);

      if (ACC.AccountingStore) {
        ACC.AccountingStore.putOne(ACC.IDB_STORES.BANK_ACCOUNTS, account)
          .catch(function (e) { console.warn('[banking.ui] IDB write failed:', e); });
      }

      _selectedAccountId = account.id;
      _closeModal(ACCT_MODAL_ID);
      _toast('"' + _esc(account.name) + '" account added ✓', 'success');
      render();

    } catch (e) {
      if (err) { err.textContent = e.message; err.style.display = ''; }
      if (btn) { btn.disabled = false; btn.textContent = 'Save Account'; }
    }
  }

  function openAddTransaction(accountId) {
    _closeAll();

    var accounts = _getAccounts();
    if (accounts.length === 0) {
      _toast('Add a bank account first', 'warning');
      return;
    }

    var acctId = accountId || (accounts[0] && accounts[0].id);

    var acctOptions = accounts.map(function (a) {
      var selected = a.id === acctId ? ' selected' : '';
      return '<option value="' + _esc(a.id) + '"' + selected + '>' + _esc(a.name) + '</option>';
    }).join('');

    var modal = document.createElement('div');
    modal.id  = TX_MODAL_ID;
    modal.className = 'modal-bg open';

    modal.innerHTML =
      '<div class="modal sm">' +
        '<div class="modal-head">' +
          '<h2>💳 New Transaction</h2>' +
          '<button id="bk-tx-close" class="modal-x"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#ic-x"/></svg></button>' +
        '</div>' +
        '<div class="modal-body">' +

          '<div style="margin-bottom:14px">' +
            '<label style="display:block;font-size:11px;font-weight:600;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">Bank Account <span style="color:var(--danger)">*</span></label>' +
            '<select id="bk-tx-account" class="fi">' +
              acctOptions +
            '</select>' +
          '</div>' +

          '<div style="margin-bottom:14px">' +
            '<label style="display:block;font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Type <span style="color:var(--danger)">*</span></label>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
              '<label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid var(--border);border-radius:var(--r-lg);cursor:pointer" id="bk-credit-label">' +
                '<input type="radio" name="bk-tx-type" value="credit" checked id="bk-type-credit" style="accent-color:var(--primary)"> ' +
                '<span style="font-size:13px;font-weight:600;color:#22c55e">📥 Credit (Money In)</span>' +
              '</label>' +
              '<label style="display:flex;align-items:center;gap:8px;padding:10px;border:1px solid var(--border);border-radius:var(--r-lg);cursor:pointer" id="bk-debit-label">' +
                '<input type="radio" name="bk-tx-type" value="debit" id="bk-type-debit" style="accent-color:var(--primary)"> ' +
                '<span style="font-size:13px;font-weight:600;color:#ef4444">📤 Debit (Money Out)</span>' +
              '</label>' +
            '</div>' +
          '</div>' +

          _field('Amount (Rs.) *', 'bk-tx-amount', 'number', '0') +
          _field('Date *', 'bk-tx-date', 'date', '', _today()) +
          _field('Description *', 'bk-tx-desc', 'text', 'e.g. Salary payment, Cash deposit') +
          _field('Reference / Cheque No.', 'bk-tx-ref', 'text', 'Optional') +

          '<div style="margin-bottom:14px" id="bk-gl-cat-wrap">' +
            '<label style="display:block;font-size:11px;font-weight:600;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">GL Category <span style="color:var(--danger)">*</span></label>' +
            '<select id="bk-tx-gl-cat" class="fi">' +
              '<optgroup label="Credit (Money In)">' +
                '<option value="AR" data-type="credit">Customer Receipt → Accounts Receivable</option>' +
                '<option value="BANK_LOANS" data-type="credit">Loan Received → Bank Loans Payable</option>' +
                '<option value="EQUITY" data-type="credit">Capital / Equity Injection → Owner Equity</option>' +
                '<option value="SERVICE_REV" data-type="credit">Service / Other Income → Revenue</option>' +
              '</optgroup>' +
              '<optgroup label="Debit (Money Out)">' +
                '<option value="BANK_CHARGES" data-type="debit">Bank Charge / Expense → Bank Charges</option>' +
                '<option value="BANK_LOANS_REP" data-type="debit">Loan Repayment → Bank Loans Payable</option>' +
                '<option value="AP" data-type="debit">Supplier Payment → Accounts Payable</option>' +
              '</optgroup>' +
            '</select>' +
          '</div>' +

          '<div id="bk-tx-err" style="display:none;margin-top:10px;color:var(--danger);font-size:13px;text-align:center"></div>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<button id="bk-tx-cancel" class="btn btn-ghost">Cancel</button>' +
          '<button id="bk-tx-save" class="btn btn-primary">Save Transaction</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    document.getElementById('bk-tx-close').onclick  = function () { _closeModal(TX_MODAL_ID); };
    document.getElementById('bk-tx-cancel').onclick = function () { _closeModal(TX_MODAL_ID); };
    modal.addEventListener('click', function (e) { if (e.target === modal) _closeModal(TX_MODAL_ID); });
    document.getElementById('bk-tx-save').onclick = _saveTransaction;

    function _syncGLCatOptions() {
      var typeEl  = document.querySelector('input[name="bk-tx-type"]:checked');
      var selType = typeEl ? typeEl.value : 'credit';
      var catSel  = document.getElementById('bk-tx-gl-cat');
      if (!catSel) return;
      var opts = catSel.querySelectorAll('option');
      opts.forEach(function (opt) {
        var optType = opt.getAttribute('data-type');
        opt.hidden = optType ? (optType !== selType) : false;
      });
      var firstVisible = null;
      opts.forEach(function (opt) { if (!opt.hidden && !firstVisible) firstVisible = opt; });
      if (firstVisible && catSel.options[catSel.selectedIndex] && catSel.options[catSel.selectedIndex].hidden) {
        catSel.value = firstVisible.value;
      }
    }
    _syncGLCatOptions();
    var typeRadios = modal.querySelectorAll('input[name="bk-tx-type"]');
    typeRadios.forEach(function (r) { r.addEventListener('change', _syncGLCatOptions); });

    setTimeout(function () {
      var f = document.getElementById('bk-tx-amount');
      if (f) { f.focus(); f.select(); }
    }, 50);
  }

  function _saveTransaction() {
    var btn = document.getElementById('bk-tx-save');
    var err = document.getElementById('bk-tx-err');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    if (err) { err.style.display = 'none'; }

    try {
      var acctId  = document.getElementById('bk-tx-account').value;
      var typeEl  = document.querySelector('input[name="bk-tx-type"]:checked');
      var type    = typeEl ? typeEl.value : 'credit';
      var amtRs   = Math.round((parseFloat(document.getElementById('bk-tx-amount').value) || 0) * 100) / 100;
      var date    = (document.getElementById('bk-tx-date').value  || '').trim();
      var desc    = (document.getElementById('bk-tx-desc').value  || '').trim();
      var ref     = (document.getElementById('bk-tx-ref').value   || '').trim();

      if (!acctId)  throw new Error('Select a bank account.');
      if (amtRs <= 0) throw new Error('Amount must be greater than 0.');
      if (amtRs > 10000000000) throw new Error('Amount looks too large — please check for extra digits.');
      if (!date)    throw new Error('Date is required.');
      if (!desc)    throw new Error('Description is required.');

      var tx = Object.freeze({
        id:            _uid(),
        date:          date,
        bankAccountId: acctId,
        type:          type,
        amountPaisa:   Money.toPaisa(amtRs),
        description:   desc,
        reference:     ref,
        reconciled:    false,
        reconciledAt:  null,
        reversed:      false,
        reversalJournalId: null,
        journalId:     null,
        createdAt:     new Date().toISOString(),
        createdBy:     _currentUser(),
      });

      ACC.AccountingState.addBankTransaction(tx);

      if (ACC.AccountingStore) {
        ACC.AccountingStore.putOne(ACC.IDB_STORES.BANK_TRANSACTIONS, tx)
          .catch(function (e) { console.warn('[banking.ui] IDB write failed:', e); });
      }

      try {
        if (ACC.JournalService) {
          var ACCTS2 = ACC.SYSTEM_ACCOUNTS || {};
          var bankAcctId = ACCTS2.BANK || 'acc-1002';
          var _glCatEl = document.getElementById('bk-tx-gl-cat');
          var _glCat = _glCatEl ? _glCatEl.value : (type === 'credit' ? 'AR' : 'BANK_CHARGES');
          var _glCatMap = {
            AR:           ACCTS2.AR            || 'acc-1100',
            BANK_LOANS:   ACCTS2.BANK_LOANS    || 'acc-2100',
            EQUITY:       ACCTS2.EQUITY         || 'acc-3001',
            SERVICE_REV:  ACCTS2.SERVICE_REV    || 'acc-4002',
            BANK_CHARGES: ACCTS2.BANK_CHARGES   || 'acc-6100',
            BANK_LOANS_REP: ACCTS2.BANK_LOANS   || 'acc-2100',
            AP:           ACCTS2.AP             || 'acc-2001',
          };
          var otherAcctId = _glCatMap[_glCat] || (type === 'credit' ? ACCTS2.AR : ACCTS2.BANK_CHARGES);
          var glEntries = type === 'credit'
            ? [
                { accountId: bankAcctId,  debit: tx.amountPaisa, credit: 0,                description: desc },
                { accountId: otherAcctId, debit: 0,              credit: tx.amountPaisa,   description: desc },
              ]
            : [
                { accountId: otherAcctId, debit: tx.amountPaisa, credit: 0,                description: desc },
                { accountId: bankAcctId,  debit: 0,              credit: tx.amountPaisa,   description: desc },
              ];
          ACC.JournalService.post({
            date:         date,
            reference:    ref || tx.id,
            sourceModule: (ACC.SOURCE_MODULE || {}).BANKING || 'banking',
            sourceId:     tx.id,
            memo:         (type === 'credit' ? 'Bank Credit: ' : 'Bank Debit: ') + desc,
            entries:      glEntries,
          }, 'system').catch(function (e) {
            
            try {
              var _bk = 'erp_banking_gl_backlog';
              var _bl = JSON.parse(localStorage.getItem(_bk) || '[]');
              _bl.push({ txId: tx.id, type: type, amountPaisa: tx.amountPaisa, date: date, desc: desc, ts: new Date().toISOString(), error: e && e.message });
              localStorage.setItem(_bk, JSON.stringify(_bl));
            } catch (backlogErr) {
              console.warn('[banking.ui] Failed to queue GL backlog entry:', backlogErr && backlogErr.message);
            }
            if (window.DEBUG_MODE) console.warn('[banking.ui] GL journal post failed (queued):', e && e.message);
          });
        }
      } catch (glErr) {
        
        try {
          var _bk2 = 'erp_banking_gl_backlog';
          var _bl2 = JSON.parse(localStorage.getItem(_bk2) || '[]');
          _bl2.push({ txId: tx.id, type: type, amountPaisa: tx.amountPaisa, date: date, desc: desc, ts: new Date().toISOString(), error: glErr && glErr.message });
          localStorage.setItem(_bk2, JSON.stringify(_bl2));
        } catch (backlogErr2) {
          console.warn('[banking.ui] Failed to queue GL backlog entry:', backlogErr2 && backlogErr2.message);
        }
        if (window.DEBUG_MODE) console.warn('[banking.ui] GL post error (queued):', glErr);
      }

      _selectedAccountId = acctId;
      _closeModal(TX_MODAL_ID);
      _toast((type === 'credit' ? '📥 Credit' : '📤 Debit') + ' of ' + _fmt(tx.amountPaisa) + ' saved ✓', 'success');
      render();

    } catch (e) {
      if (err) { err.textContent = e.message; err.style.display = ''; }
      if (btn) { btn.disabled = false; btn.textContent = 'Save Transaction'; }
    }
  }

  function _persistOneTx(txId) {
    if (!ACC.AccountingStore) return;
    var tx = _getAllTx().find(function (t) { return t.id === txId; });
    if (!tx) return;
    ACC.AccountingStore.putOne(ACC.IDB_STORES.BANK_TRANSACTIONS, tx)
      .catch(function (e) { console.warn('[banking.ui] IDB write failed:', e); });
  }

  function _field(label, id, type, placeholder, defaultVal) {
    return '<div class="fgrp" style="margin-bottom:12px">' +
      '<label>' + _esc(label) + '</label>' +
      '<input id="' + id + '" type="' + type + '" class="fi"' +
        ' placeholder="' + _esc(placeholder || '') + '"' +
        (defaultVal !== undefined ? ' value="' + _esc(String(defaultVal)) + '"' : '') + '>' +
    '</div>';
  }

  function _boot() {
    if (ERP.registerRenderer) {
      ERP.registerRenderer('bank', function () { render(); });
    }

    ERP.bank = {
      render:  render,
      openAdd: openAddTransaction,
    };

    _initAccounting();
  }

  function _initAccounting() {
    if (!ACC.AccountingState) {
      console.warn('[banking.ui] AccountingState not loaded yet.');
      return;
    }

    if (!ACC.AccountingState.isInitialized()) {
      try {
        ACC.AccountingState.initialize();
      } catch (e) {
        console.warn('[banking.ui] AccountingState init error:', e);
      }
    }

    
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

})(typeof window !== 'undefined' ? window : globalThis);
