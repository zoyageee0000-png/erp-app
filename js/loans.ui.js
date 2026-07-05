'use strict';

(function (root) {
  'use strict';

  var ACC = root.AccountingCore;
  var ERP = root.ERP;

  if (!ACC)  { console.error('[loans.ui] AccountingCore missing — load accounting.constants.js first.'); return; }
  if (!ERP)  { console.error('[loans.ui] ERP namespace missing.'); return; }

  var Money = ACC.Money;

  function _toast(msg, type) {
    if (ERP.ui && ERP.ui.toast) ERP.ui.toast(msg, type || 'info');
    else if (root.DEBUG_MODE) console.log('[loans]', msg);
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function _fmt(paisa) { return Money.toDisplay(paisa); }

  function _currentUser() {
    try { return (ERP.getState().session.user && ERP.getState().session.user.name) || 'user'; }
    catch (e) { console.warn('[loans.ui] _currentUser error:', e); return 'user'; }
  }

  var MODAL_ID     = 'acc-loan-modal';
  var PMT_MODAL_ID = 'acc-loan-pmt-modal';
  var SCH_MODAL_ID = 'acc-loan-sch-modal';

  var _modalHandlers = {};
  function _closeModal(id) {
    var m = document.getElementById(id);
    if (m) {
      if (_modalHandlers[id]) {
        _modalHandlers[id].forEach(function(h) { m.removeEventListener(h.type, h.fn); });
        delete _modalHandlers[id];
      }
      m.remove();
    }
    document.body.style.overflow = '';
  }
  function _trackHandler(id, type, fn) {
    if (!_modalHandlers[id]) _modalHandlers[id] = [];
    _modalHandlers[id].push({ type: type, fn: fn });
  }

  function _closeAll() {
    [MODAL_ID, PMT_MODAL_ID, SCH_MODAL_ID].forEach(_closeModal);
  }

  function render() {
    var pv = document.getElementById('pv-loans');
    if (!pv) return;

    var loans = [];
    try { loans = ACC.LoanService.getAllLoans(); } catch (e) { console.warn('[loans.ui] getAllLoans error:', e); }

    var activeLoans = [];
    try { activeLoans = ACC.LoanService.getActiveLoans(); } catch (e) { console.warn('[loans.ui] getActiveLoans error:', e); activeLoans = loans.filter(function (l) { return l.status === 'active'; }); }
    var closedLoans  = loans.filter(function (l) { return l.status === 'closed'; });

    var totalLiability = 0;
    try { totalLiability = ACC.LoanService.getTotalLiabilityPaisa(); } catch (e) { console.warn('[loans.ui] getTotalLiabilityPaisa error:', e); }

    pv.innerHTML =
      window.renderStatCards([
        { icon:'🏦', value: loans.length,        label:'Total Loans',     color:'#4338CA', bg:'#eff6ff' },
        { icon:'⚡', value: activeLoans.length,   label:'Active',          color:'#d97706', bg:'#fffbeb' },
        { icon:'✅', value: closedLoans.length,   label:'Closed',          color:'#16a34a', bg:'#f0fdf4' },
        { icon:'💰', value: _fmt(totalLiability), label:'Total Liability', color:'#dc2626', bg:'#fef2f2' },
      ]) +

      '<div class="au-toolbar">' +
        '<div class="au-toolbar-left"></div>' +
        '<div class="au-toolbar-right">' +
          '<button class="au-btn au-btn-primary" id="acc-loan-add-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> New Loan</button>' +
        '</div>' +
      '</div>' +

      '<div class="au-panel" style="margin-bottom:16px">' +
        '<div class="au-tbl-wrap">' +
        '<table class="au-tbl">' +
          '<thead>' +
            '<tr>' +
              '<th>Lender</th>' +
              '<th style="text-align:right">Principal</th>' +
              '<th style="text-align:right">Outstanding</th>' +
              '<th style="text-align:right">EMI</th>' +
              '<th style="text-align:center">Rate %</th>' +
              '<th style="text-align:center">Start Date</th>' +
              '<th style="text-align:center">Payments</th>' +
              '<th style="text-align:center">Actions</th>' +
            '</tr>' +
          '</thead>' +
          '<tbody id="acc-loans-active-tbody">' +
            (activeLoans.length
              ? activeLoans.map(_loanRow).join('')
              : '<tr><td colspan="8"><div class="au-empty"><div class="au-empty-icon">🏦</div><div class="au-empty-title">No Active Loans</div><div class="au-empty-sub">Click "New Loan" to add one</div></div></td></tr>'
            ) +
          '</tbody>' +
        '</table></div>' +
      '</div>' +

      (closedLoans.length ? (
        '<div class="au-panel">' +
          '<div class="au-tbl-wrap">' +
          '<table class="au-tbl">' +
            '<thead>' +
              '<tr>' +
                '<th>Lender</th>' +
                '<th style="text-align:right">Principal</th>' +
                '<th style="text-align:center">Start Date</th>' +
                '<th style="text-align:center">Closed At</th>' +
                '<th style="text-align:center">Payments</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' +
              closedLoans.map(_closedLoanRow).join('') +
            '</tbody>' +
          '</table></div>' +
        '</div>'
      ) : '');

    _bindTableEvents(pv);
  }

  function _summaryCard(label, value, color) {
    return '<div style="background:var(--white,#fff);border:1px solid var(--border);border-radius:8px;padding:16px;border-left:4px solid ' + color + '">' +
      '<div style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.5px">' + _esc(label) + '</div>' +
      '<div style="font-size:22px;font-weight:700;color:var(--text);margin-top:4px">' + _esc(String(value)) + '</div>' +
    '</div>';
  }

  function _loanRow(loan) {
    var outstanding = 0;
    try { outstanding = ACC.AccountingState.getLoanOutstandingBalance(loan.id); } catch (e) { console.warn('[loans.ui] getLoanOutstandingBalance error:', e); }
    var pmtCount = (loan.payments || []).length;

    return '<tr style="border-bottom:1px solid var(--border-l)" data-loan-id="' + _esc(loan.id) + '">' +
      '<td style="padding:10px 12px;font-weight:600">' + _esc(loan.lenderName) + '</td>' +
      '<td style="padding:10px 12px;text-align:right">' + _fmt(loan.principalPaisa) + '</td>' +
      '<td style="padding:10px 12px;text-align:right;color:var(--danger);font-weight:600">' + _fmt(outstanding) + '</td>' +
      '<td style="padding:10px 12px;text-align:right">' + _fmt(loan.emiPaisa) + '</td>' +
      '<td style="padding:10px 12px;text-align:center">' + _esc(loan.annualRatePercent) + '%</td>' +
      '<td style="padding:10px 12px;text-align:center;color:var(--muted)">' + _esc(loan.startDate) + '</td>' +
      '<td style="padding:10px 12px;text-align:center">' +
        '<span class="badge" style="background:var(--primary);color:#fff">' + pmtCount + ' paid</span>' +
      '</td>' +
      '<td style="padding:10px 12px;text-align:center">' +
        '<button class="au-btn au-btn-primary acc-loan-pay-btn" style="height:28px;font-size:11px;padding:0 10px" data-loan-id="' + _esc(loan.id) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-money"/></svg> Pay EMI</button>' +
        '<button class="au-btn au-btn-ghost" style="height:28px;font-size:11px;padding:0 10px" data-loan-schedule="' + _esc(loan.id) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-cal"/></svg> Schedule</button>' +
      '</td>' +
    '</tr>';
  }

  function _closedLoanRow(loan) {
    var pmtCount  = (loan.payments || []).length;
    var _caD = loan.closedAt ? new Date(typeof loan.closedAt === 'string' && loan.closedAt.length === 10 ? loan.closedAt + 'T12:00:00' : loan.closedAt) : null;
    var closedAt = _caD ? (_caD.getFullYear() + '-' + String(_caD.getMonth() + 1).padStart(2, '0') + '-' + String(_caD.getDate()).padStart(2, '0')) : '—';
    return '<tr style="border-bottom:1px solid var(--border-l);opacity:.7">' +
      '<td style="padding:10px 12px">' + _esc(loan.lenderName) + '</td>' +
      '<td style="padding:10px 12px;text-align:right">' + _fmt(loan.principalPaisa) + '</td>' +
      '<td style="padding:10px 12px;text-align:center;color:var(--muted)">' + _esc(loan.startDate) + '</td>' +
      '<td style="padding:10px 12px;text-align:center;color:var(--muted)">' + _esc(closedAt) + '</td>' +
      '<td style="padding:10px 12px;text-align:center">' + pmtCount + '</td>' +
    '</tr>';
  }

  function _bindTableEvents(pv) {
    var addBtn = pv.querySelector('#acc-loan-add-btn');
    if (addBtn) addBtn.addEventListener('click', openAdd);

    pv.querySelectorAll('.acc-loan-pay-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var loanId = btn.getAttribute('data-loan-id');
        openPayment(loanId);
      });
    });

    pv.querySelectorAll('[data-loan-schedule]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var loanId = btn.getAttribute('data-loan-schedule');
        openSchedule(loanId);
      });
    });
  }

  function openAdd() {
    if (document.getElementById(MODAL_ID)) return;
    _closeAll();

    var today = (function(){ var _d=new Date(); return _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0'); })();

    var modal = document.createElement('div');
    modal.id  = MODAL_ID;
    modal.className = 'modal-bg open';

    modal.innerHTML =
      '<div class="modal sm">' +
        '<div class="modal-head">' +
          '<h2>📋 New Loan</h2>' +
          '<button id="acc-loan-close" class="modal-x"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#ic-x"/></svg></button>' +
        '</div>' +
        '<div class="modal-body">' +
          _field('Lender / Bank Name', 'acc-loan-lender', 'text', 'e.g. HBL, MCB', true) +
          _field('Principal Amount (Rs.)', 'acc-loan-principal', 'number', '0', true) +
          _field('Annual Interest Rate (%)', 'acc-loan-rate', 'number', '12') +
          _field('Tenure (Months)', 'acc-loan-tenure', 'number', '12', true) +
          _field('Start Date', 'acc-loan-date', 'date', '', true, today) +
          _field('Notes (optional)', 'acc-loan-notes', 'text', '') +
          '<div id="acc-loan-emi-preview" style="display:none;background:var(--bg);border-radius:var(--r-lg);padding:12px;margin-top:4px;font-size:13px;color:var(--muted)">' +
            'Estimated EMI: <strong id="acc-loan-emi-val" style="color:var(--text)"></strong>' +
          '</div>' +
          '<div id="acc-loan-err" style="display:none;margin-top:10px;color:var(--danger);font-size:13px;text-align:center"></div>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<button id="acc-loan-cancel-btn" class="btn btn-ghost">Cancel</button>' +
          '<button id="acc-loan-save-btn" class="btn btn-primary">Save Loan</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    var closeBtn = document.getElementById('acc-loan-close');
    if (closeBtn) closeBtn.onclick = function () { _closeModal(MODAL_ID); };
    var cancelBtn = document.getElementById('acc-loan-cancel-btn');
    if (cancelBtn) cancelBtn.onclick = function () { _closeModal(MODAL_ID); };
    var _modalClickAdd = function (e) { if (e.target === modal) _closeModal(MODAL_ID); };
    modal.addEventListener('click', _modalClickAdd);
    _trackHandler(MODAL_ID, 'click', _modalClickAdd);

    ['acc-loan-principal', 'acc-loan-rate', 'acc-loan-tenure'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', _updateEMIPreview);
    });

    var saveBtn = document.getElementById('acc-loan-save-btn');
    if (saveBtn) saveBtn.onclick = _saveLoan;

    var fl = document.getElementById('acc-loan-lender');
    if (fl) setTimeout(function () { fl.focus(); }, 50);
  }

  function _field(label, id, type, placeholder, required, defaultVal) {
    return '<div class="fgrp" style="margin-bottom:12px">' +
      '<label>' + _esc(label) + (required ? ' <span style="color:var(--danger)">*</span>' : '') + '</label>' +
      '<input id="' + id + '" type="' + type + '" class="fi"' +
        ' placeholder="' + _esc(placeholder || '') + '"' +
        (defaultVal !== undefined ? ' value="' + _esc(String(defaultVal)) + '"' : '') + '>' +
    '</div>';
  }

  function _updateEMIPreview() {
    try {
      var p = Money.toPaisa(parseFloat(document.getElementById('acc-loan-principal').value) || 0);
      var r = parseFloat(document.getElementById('acc-loan-rate').value)    || 0;
      var t = parseInt(document.getElementById('acc-loan-tenure').value, 10) || 0;
      var preview = document.getElementById('acc-loan-emi-preview');
      var emiVal  = document.getElementById('acc-loan-emi-val');
      if (p > 0 && t > 0) {
        var emi = ACC.LoanService.calculateEMIPaisa(p, r, t);
        if (emiVal) emiVal.textContent = _fmt(emi);
        if (preview) preview.style.display = '';
      } else {
        if (preview) preview.style.display = 'none';
      }
    } catch (e) { console.warn('[loans.ui] _updateEMIPreview error:', e); }
  }

  var _loanSaving = false;

  function _saveLoan() {
    if (_loanSaving) return;
    _loanSaving = true;
    var btn = document.getElementById('acc-loan-save-btn');
    var err = document.getElementById('acc-loan-err');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    if (err) { err.style.display = 'none'; }

    try {
      var lenderEl    = document.getElementById('acc-loan-lender');
      var principalEl = document.getElementById('acc-loan-principal');
      var rateEl      = document.getElementById('acc-loan-rate');
      var tenureEl    = document.getElementById('acc-loan-tenure');
      var dateEl      = document.getElementById('acc-loan-date');
      var notesEl     = document.getElementById('acc-loan-notes');

      var lenderName     = (lenderEl ? lenderEl.value : '').trim();
      var principalRs    = parseFloat(principalEl ? principalEl.value : '') || 0;
      var annualRate     = parseFloat(rateEl ? rateEl.value : '') || 0;
      var tenureMonths   = parseInt(tenureEl ? tenureEl.value : '', 10) || 0;
      var startDate      = (dateEl ? dateEl.value : '').trim();
      var notes          = (notesEl ? notesEl.value : '').trim();

      if (!lenderName)        throw new Error('Lender name is required.');
      if (principalRs <= 0)   throw new Error('Principal must be greater than 0.');
      if (annualRate < 0)     throw new Error('Interest rate cannot be negative.');
      if (tenureMonths <= 0)  throw new Error('Tenure must be at least 1 month.');
      if (!startDate)         throw new Error('Start date is required.');

      var principalPaisa = Money.toPaisa(principalRs);

      ACC.LoanService.createLoan({
        lenderName,
        principalPaisa,
        annualRatePercent: annualRate,
        tenureMonths,
        startDate,
        notes,
      }, _currentUser()).then(function (loan) {
        _loanSaving = false;
        _closeModal(MODAL_ID);
        _toast('Loan from "' + loan.lenderName + '" saved — ' + _fmt(loan.principalPaisa), 'success');
        render();
      }).catch(function (e) {
        _loanSaving = false;
        if (err) { err.textContent = e.message; err.style.display = ''; }
        if (btn) { btn.disabled = false; btn.textContent = 'Save Loan'; }
      });

    } catch (e) {
      _loanSaving = false;
      if (err) { err.textContent = e.message; err.style.display = ''; }
      if (btn) { btn.disabled = false; btn.textContent = 'Save Loan'; }
    }
  }

  function openPayment(loanId) {
    if (document.getElementById(PMT_MODAL_ID)) return;
    _closeAll();

    var loan = null;
    try { loan = ACC.LoanService.getLoanStatement(loanId); } catch (e) { console.warn('[loans.ui] getLoanStatement error:', e); }
    if (!loan) { _toast('Loan not found.', 'error'); return; }

    var today = (function(){ var _d=new Date(); return _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0'); })();
    var outstanding = loan.outstandingPaisa || 0;

    var suggestedPaisa = Math.min(loan.emiPaisa || 0, outstanding);
    var suggestedRs    = (suggestedPaisa / 100).toFixed(2);

    var modal = document.createElement('div');
    modal.id  = PMT_MODAL_ID;
    modal.className = 'modal-bg open';

    modal.innerHTML =
      '<div class="modal sm">' +
        '<div class="modal-head">' +
          '<h2>💰 Pay EMI</h2>' +
          '<button id="acc-pmt-close" class="modal-x"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#ic-x"/></svg></button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div style="background:var(--bg);border-radius:var(--r-lg);padding:12px;margin-bottom:14px;font-size:13px">' +
            '<div style="display:flex;justify-content:space-between;margin-bottom:4px">' +
              '<span style="color:var(--muted)">Lender:</span>' +
              '<strong>' + _esc(loan.lenderName) + '</strong>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;margin-bottom:4px">' +
              '<span style="color:var(--muted)">Outstanding:</span>' +
              '<strong style="color:var(--danger)">' + _fmt(outstanding) + '</strong>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between">' +
              '<span style="color:var(--muted)">Monthly EMI:</span>' +
              '<strong>' + _fmt(loan.emiPaisa) + '</strong>' +
            '</div>' +
          '</div>' +

          _field('Payment Date', 'acc-pmt-date', 'date', '', true, today) +
          _field('Total Amount (Rs.)', 'acc-pmt-total', 'number', '0', true, suggestedRs) +

          '<div class="fgrp" style="margin-bottom:12px">' +
            '<label>Payment Method</label>' +
            '<select id="acc-pmt-method" class="fi">' +
              '<option value="Cash">Cash</option>' +
              '<option value="Bank Transfer" selected>Bank Transfer</option>' +
              '<option value="Cheque">Cheque</option>' +
            '</select>' +
          '</div>' +

          _field('Notes (optional)', 'acc-pmt-notes', 'text', '') +

          '<div id="acc-pmt-split" style="background:var(--bg);border-radius:var(--r-lg);padding:10px;margin-bottom:4px;font-size:12px;color:var(--muted);display:none">' +
            'Principal: <strong id="acc-pmt-principal-val">—</strong> &nbsp;|&nbsp; Interest: <strong id="acc-pmt-interest-val">—</strong>' +
          '</div>' +
          '<div id="acc-pmt-err" style="display:none;margin-top:10px;color:var(--danger);font-size:13px;text-align:center"></div>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<button id="acc-pmt-cancel-btn" class="btn btn-ghost">Cancel</button>' +
          '<button id="acc-pmt-save-btn" class="btn btn-success">Record Payment</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    var closeBtn = document.getElementById('acc-pmt-close');
    if (closeBtn) closeBtn.onclick = function () { _closeModal(PMT_MODAL_ID); };
    var cancelBtn = document.getElementById('acc-pmt-cancel-btn');
    if (cancelBtn) cancelBtn.onclick = function () { _closeModal(PMT_MODAL_ID); };
    var _modalClickPmt = function (e) { if (e.target === modal) _closeModal(PMT_MODAL_ID); };
    modal.addEventListener('click', _modalClickPmt);
    _trackHandler(PMT_MODAL_ID, 'click', _modalClickPmt);

    var totalInput = document.getElementById('acc-pmt-total');
    if (totalInput) totalInput.addEventListener('input', function () {
      _updatePaymentSplit(loan);
    });
    _updatePaymentSplit(loan);

    var pmtSaveBtn = document.getElementById('acc-pmt-save-btn');
    if (pmtSaveBtn) pmtSaveBtn.onclick = function () { _savePayment(loanId, loan); };
  }

  function _updatePaymentSplit(loan) {
    try {
      var totalRs    = parseFloat(document.getElementById('acc-pmt-total').value) || 0;
      var totalPaisa = Money.toPaisa(totalRs);
      var split      = document.getElementById('acc-pmt-split');
      if (totalPaisa <= 0) { if (split) split.style.display = 'none'; return; }

      var outstanding  = 0;
      try { outstanding = ACC.AccountingState.getLoanOutstandingBalance(loan.id); } catch (e) { console.warn('[loans.ui] getLoanOutstandingBalance error:', e); }

      var interestPaisa;
      if (loan.repaymentType === 'flat') {
        var paidMonths = (loan.payments || []).length;
        var nextEntry  = (loan.schedule || [])[paidMonths];
        interestPaisa  = nextEntry ? nextEntry.interestPaisa : 0;
      } else {
        var monthlyRate = loan.annualRatePercent / 12 / 100;
        interestPaisa = loan.annualRatePercent > 0 ? Math.round(outstanding * monthlyRate) : 0;
      }
      var principalPaisa = totalPaisa - interestPaisa;

      var pv = document.getElementById('acc-pmt-principal-val');
      var iv = document.getElementById('acc-pmt-interest-val');
      if (pv) pv.textContent = _fmt(Math.max(0, principalPaisa));
      if (iv) iv.textContent = _fmt(interestPaisa);
      if (split) split.style.display = '';
    } catch (e) { console.warn('[loans.ui] _updatePaymentSplit error:', e); }
  }

  var _pmtSaving = false;
  function _savePayment(loanId, loan) {
    if (_pmtSaving) return;
    _pmtSaving = true;
    var btn = document.getElementById('acc-pmt-save-btn');
    var err = document.getElementById('acc-pmt-err');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    if (err) { err.style.display = 'none'; }

    try {
      var dateEl   = document.getElementById('acc-pmt-date');
      var totalEl  = document.getElementById('acc-pmt-total');
      var methodEl = document.getElementById('acc-pmt-method');
      var notesEl  = document.getElementById('acc-pmt-notes');

      var date    = (dateEl ? dateEl.value : '').trim();
      var totalRs = parseFloat(totalEl ? totalEl.value : '') || 0;
      var method  = (methodEl ? methodEl.value : '') || 'Cash';
      var notes   = (notesEl ? notesEl.value : '').trim();

      if (!date)         { _pmtSaving = false; if (btn) { btn.disabled = false; btn.textContent = 'Record Payment'; } throw new Error('Payment date is required.'); }
      if (totalRs <= 0)  { _pmtSaving = false; if (btn) { btn.disabled = false; btn.textContent = 'Record Payment'; } throw new Error('Amount must be greater than 0.'); }

      var totalPaisa = Money.toPaisa(totalRs);

      ACC.LoanService.recordPayment({
        loanId,
        date,
        totalPaisa,
        paymentMethod: method,
        notes,
      }, _currentUser()).then(function () {
        _pmtSaving = false;
        _closeModal(PMT_MODAL_ID);
        _toast('Payment recorded — ' + _fmt(totalPaisa), 'success');
        render();
      }).catch(function (e) {
        _pmtSaving = false;
        if (err) { err.textContent = e.message; err.style.display = ''; }
        if (btn) { btn.disabled = false; btn.textContent = 'Record Payment'; }
      });

    } catch (e) {
      _pmtSaving = false;
      if (err) { err.textContent = e.message; err.style.display = ''; }
      if (btn) { btn.disabled = false; btn.textContent = 'Record Payment'; }
    }
  }

  function openSchedule(loanId) {
    if (document.getElementById(SCH_MODAL_ID)) return;
    _closeAll();

    var loan = null;
    try { loan = ACC.LoanService.getLoanStatement(loanId); } catch (e) { console.warn('[loans.ui] getLoanStatement error:', e); }
    if (!loan || !loan.schedule) { _toast('Schedule not available.', 'error'); return; }

    var paidMonths = (loan.payments || []).length;

    var modal = document.createElement('div');
    modal.id  = SCH_MODAL_ID;
    modal.className = 'modal-bg open';

    var rows = loan.schedule.map(function (s) {
      var isPaid = s.month <= paidMonths;
      var color  = isPaid ? 'color:var(--muted);' : '';
      var tick   = isPaid ? '✅' : '';
      return '<tr style="border-bottom:1px solid var(--border-l);' + color + '">' +
        '<td style="padding:7px 10px;text-align:center">' + tick + ' ' + s.month + '</td>' +
        '<td style="padding:7px 10px;text-align:center">' + _esc(s.dueDate) + '</td>' +
        '<td style="padding:7px 10px;text-align:right">' + _fmt(s.emiPaisa) + '</td>' +
        '<td style="padding:7px 10px;text-align:right">' + _fmt(s.principalPaisa) + '</td>' +
        '<td style="padding:7px 10px;text-align:right">' + _fmt(s.interestPaisa) + '</td>' +
        '<td style="padding:7px 10px;text-align:right">' + _fmt(s.closingBalancePaisa) + '</td>' +
      '</tr>';
    }).join('');

    modal.innerHTML =
      '<div class="modal lg">' +
        '<div class="modal-head">' +
          '<h2>📅 Amortization — ' + _esc(loan.lenderName) + '</h2>' +
          '<button id="acc-sch-close" class="modal-x"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#ic-x"/></svg></button>' +
        '</div>' +
        '<div class="modal-body" style="padding:0;overflow-x:auto">' +
          '<table class="au-tbl">' +
            '<thead><tr>' +
              '<th style="text-align:center">#</th>' +
              '<th style="text-align:center">Due Date</th>' +
              '<th style="text-align:right">EMI</th>' +
              '<th style="text-align:right">Principal</th>' +
              '<th style="text-align:right">Interest</th>' +
              '<th style="text-align:right">Balance</th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>' +
        '<div class="modal-foot">' +
          '<button id="acc-sch-close-btn" class="btn btn-ghost">Close</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    var schCloseBtn = document.getElementById('acc-sch-close');
    if (schCloseBtn) schCloseBtn.onclick = function () { _closeModal(SCH_MODAL_ID); };
    var schCloseBtn2 = document.getElementById('acc-sch-close-btn');
    if (schCloseBtn2) schCloseBtn2.onclick = function () { _closeModal(SCH_MODAL_ID); };
    var _modalClickSch = function (e) { if (e.target === modal) _closeModal(SCH_MODAL_ID); };
    modal.addEventListener('click', _modalClickSch);
    _trackHandler(SCH_MODAL_ID, 'click', _modalClickSch);
  }

  function _boot() {
    if (ERP.registerRenderer) {
      ERP.registerRenderer('loans', function () { render(); });
    }

    ERP.loans = {
      render:  render,
      openAdd: openAdd,
    };

    _initAccounting();
  }

  function _initAccounting() {
    if (!ACC.AccountingState || !ACC.LoanService) {
      console.warn('[loans.ui] AccountingState or LoanService not loaded yet — skipping init.');
      return;
    }

    if (!ACC.AccountingState.isInitialized()) {
      try {
        ACC.AccountingState.initialize();
      } catch (e) {
        console.warn('[loans.ui] AccountingState init error:', e);
      }
    }

    if (ACC.AccountingStore && typeof ACC.AccountingStore.getAll === 'function') {
      ACC.AccountingStore.getAll(ACC.IDB_STORES.LOANS).then(function (loans) {
        if (Array.isArray(loans)) {
          loans.forEach(function (l) { ACC.AccountingState.addLoan(l); });
        }
        render();
      }).catch(function (e) {
        console.warn('[loans.ui] IDB hydration error:', e);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

})(typeof window !== 'undefined' ? window : globalThis);
