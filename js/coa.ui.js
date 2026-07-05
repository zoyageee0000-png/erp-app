'use strict';

(function (root) {
  'use strict';

  var ACC = root.AccountingCore;
  var ERP = root.ERP;

  if (!ACC) { console.error('[coa.ui] AccountingCore missing.'); return; }
  if (!ERP) { console.error('[coa.ui] ERP namespace missing.'); return; }

  function _toast(msg, type) {
    if (ERP.ui && ERP.ui.toast) ERP.ui.toast(msg, type || 'info');
    else if (window.DEBUG_MODE) console.log('[coa]', msg);
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // FIX (root cause, audit #61-62): core.js (ERP.uid) loads first of 92
  // scripts, before this file -- a missing-ERP.uid fallback bought nothing
  // but a second, weaker ID scheme. Always use the canonical generator.
  function _uid() {
    return 'coa-' + ERP.uid();
  }

  function _serverTimeISO() {
    try {
      if (ERP.getServerTime) return new Date(ERP.getServerTime()).toISOString();
      if (ERP.serverTime)    return new Date(ERP.serverTime()).toISOString();
    } catch (e) {
      console.warn('[coa.ui] server time unavailable, falling back to client clock:', e);
    }
    return new Date().toISOString();
  }

  function _currentUser() {
    try { return (ERP.getState().session.user && ERP.getState().session.user.name) || 'user'; } catch (e) { return 'user'; }
  }

  var GROUP_ORDER  = ['Assets', 'Liabilities', 'Equity', 'Revenue', 'Expenses'];
  var GROUP_COLORS = {
    Assets:      '#4338CA',
    Liabilities: '#ef4444',
    Equity:      '#8b5cf6',
    Revenue:     '#22c55e',
    Expenses:    '#f59e0b',
  };
  var GROUP_ICONS = {
    Assets:      '🏦',
    Liabilities: '💳',
    Equity:      '🏛️',
    Revenue:     '📈',
    Expenses:    '📤',
  };
  var TYPE_LABELS = {
    asset:     'Asset',
    liability: 'Liability',
    equity:    'Equity',
    revenue:   'Revenue',
    expense:   'Expense',
  };
  var GROUP_TYPE_MAP = {
    Assets:      'asset',
    Liabilities: 'liability',
    Equity:      'equity',
    Revenue:     'revenue',
    Expenses:    'expense',
  };
  var GROUP_COLORS = {
    Assets:      { color:'#4338CA', bg:'#eff6ff' },
    Liabilities: { color:'#dc2626', bg:'#fef2f2' },
    Equity:      { color:'#16a34a', bg:'#f0fdf4' },
    Revenue:     { color:'#7c3aed', bg:'#f5f3ff' },
    Expenses:    { color:'#d97706', bg:'#fffbeb' },
  };

  var MODAL_ID = 'acc-coa-modal';

  function _closeModal() {
    var m = document.getElementById(MODAL_ID);
    if (m) m.remove();
    document.body.style.overflow = '';
  }

  var _searchQuery     = '';
  var _filterGroup     = 'all';
  var _collapsedGroups = {};

  function _isVisibleAccount(a) {
    return !!a && !!a.group && a.isActive !== false;
  }

  function _getGroupedAccounts() {
    var accounts = [];
    try { accounts = ACC.AccountingState.getAllCOAAccounts() || []; } catch (e) { console.warn('[coa.ui] getAllCOAAccounts failed:', e); }

    var grouped = {};
    GROUP_ORDER.forEach(function (g) { grouped[g] = []; });
    accounts.forEach(function (a) {
      if (!_isVisibleAccount(a)) return;
      if (GROUP_ORDER.indexOf(a.group) === -1) {
        console.warn('[coa.ui] account "' + a.name + '" (id: ' + a.id + ') has unknown group "' + a.group + '" — it will not be shown in any group panel.');
        return;
      }
      grouped[a.group].push(a);
    });
    return grouped;
  }

  function render() {
    var pv = document.getElementById('pv-coa');
    if (!pv) return;

    var grouped = _getGroupedAccounts();

    var totalByGroup = {};
    GROUP_ORDER.forEach(function (g) { totalByGroup[g] = (grouped[g] || []).length; });

    pv.innerHTML =
      window.renderStatCards(GROUP_ORDER.map(function (g) {
        var c = GROUP_COLORS[g] || { color:'#4338CA', bg:'#eff6ff' };
        return { icon: GROUP_ICONS[g], value: totalByGroup[g], label: g, color: c.color, bg: c.bg, cls:'coa-group-card', dataAttrs:'data-group="' + _esc(g) + '"' };
      })) +

      '<div class="au-toolbar">' +
        '<div class="au-toolbar-left">' +
          '<div class="au-search"><svg><use href="#ic-search"/></svg><input id="coa-search" type="text" placeholder="Search accounts…" value="' + _esc(_searchQuery) + '"></div>' +
          '<select class="au-select" id="coa-filter-group">' +
            '<option value="all"' + (_filterGroup === 'all' ? ' selected' : '') + '>All Groups</option>' +
            GROUP_ORDER.map(function (g) {
              return '<option value="' + _esc(g) + '"' + (_filterGroup === g ? ' selected' : '') + '>' + GROUP_ICONS[g] + ' ' + _esc(g) + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +
        '<div class="au-toolbar-right">' +
          '<button id="coa-add-btn" class="au-btn au-btn-primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Account</button>' +
        '</div>' +
      '</div>' +

      '<div id="coa-groups-wrap">' +
        _renderGroups(grouped) +
      '</div>';

    _bindEvents(pv);
  }

  function _renderGroups(grouped) {
    var q = _searchQuery.toLowerCase();

    var _glBalances = {};
    try {
      if (ACC.AccountingState && typeof ACC.AccountingState.isInitialized === 'function' && ACC.AccountingState.isInitialized()) {
        var _journals = ACC.AccountingState.getAllJournals ? (ACC.AccountingState.getAllJournals() || []) : [];
        _journals.forEach(function (j) {
          if (!j || j.status === 'reversed' || j.status === 'void') return;
          (j.entries || []).forEach(function (e) {
            if (!e || !e.accountId) return;
            if (!_glBalances[e.accountId]) _glBalances[e.accountId] = { dr: 0, cr: 0 };
            _glBalances[e.accountId].dr += (Number(e.debit)  || 0);
            _glBalances[e.accountId].cr += (Number(e.credit) || 0);
          });
        });
      }
    } catch (e) { console.warn('[coa.ui] GL balance calc failed:', e); }

    function _fmtBal(accountId, type) {
      var b = _glBalances[accountId];
      if (!b) return '<span style="color:var(--muted);font-size:11px">—</span>';
      var debitNormal = (type === 'asset' || type === 'expense');
      var dr = Number(b.dr) || 0;
      var cr = Number(b.cr) || 0;
      var bal = debitNormal ? (dr - cr) : (cr - dr);
      var rupees = bal / 100;
      var color = bal > 0 ? 'var(--text)' : bal < 0 ? '#ef4444' : 'var(--muted)';
      // FIX (root cause, found by independent verification): this was a
      // hardcoded 'Rs.' reimplementation of ERP.fmt(), the exact Category L
      // duplication this codebase already fixed in every other file (audit
      // #75) — it silently ignored a configured non-default business
      // currency. Fallback kept only for a genuine load-order fluke.
      var fmt = (window.ERP && typeof window.ERP.fmt === 'function')
        ? window.ERP.fmt(Math.abs(rupees))
        : 'Rs.' + Math.abs(rupees).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return '<span style="font-size:12px;font-weight:600;color:' + color + '">' + (bal < 0 ? '(' : '') + fmt + (bal < 0 ? ')' : '') + '</span>';
    }

    return GROUP_ORDER.map(function (g) {
      if (_filterGroup !== 'all' && _filterGroup !== g) return '';

      var accounts = (grouped[g] || []).filter(function (a) {
        if (!q) return true;
        var aName = String(a.name || '').toLowerCase();
        var aCode = String(a.code || '').toLowerCase();
        return aName.includes(q) || aCode.includes(q);
      });

      if (accounts.length === 0 && q) return '';

      var collapsed = _collapsedGroups[g] && !q;
      var color = GROUP_COLORS[g];
      var icon  = GROUP_ICONS[g];

      var rows = collapsed ? '' : (
        accounts.length === 0
          ? '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">No accounts in this group.</div>'
          : '<table class="au-tbl">' +
              '<thead>' +
                '<tr>' +
                  '<th style="width:100px">Code</th>' +
                  '<th>Account Name</th>' +
                  '<th style="text-align:right;width:130px">GL Balance</th>' +
                  '<th style="text-align:center;width:90px">Type</th>' +
                  '<th style="text-align:center;width:80px">System</th>' +
                  '<th style="padding:8px 14px;text-align:center;color:var(--muted);font-weight:600;width:80px">Actions</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>' +
                accounts.slice().sort(function (a, b) { return String(a.code).localeCompare(String(b.code)); }).map(function (a) {
                  return '<tr style="border-bottom:1px solid var(--border-l)" data-acct-id="' + _esc(a.id) + '">' +
                    '<td style="padding:10px 14px;font-family:monospace;font-size:12px;color:var(--muted)">' + _esc(a.code) + '</td>' +
                    '<td style="padding:10px 14px;font-weight:500">' + _esc(a.name) + '</td>' +
                    '<td style="padding:10px 14px;text-align:right">' + _fmtBal(a.id, a.type) + '</td>' +
                    '<td style="padding:10px 14px;text-align:center">' +
                      '<span style="font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600;background:' + color + '22;color:' + color + '">' +
                        (TYPE_LABELS[a.type] || _esc(a.type)) +
                      '</span>' +
                    '</td>' +
                    '<td style="padding:10px 14px;text-align:center">' +
                      (a.isSystem
                        ? '<span style="color:#22c55e;font-size:13px" title="System account — cannot be deleted">🔒</span>'
                        : '<span style="color:var(--muted);font-size:12px">—</span>') +
                    '</td>' +
                    '<td style="padding:10px 14px;text-align:center">' +
                      (!a.isSystem
                        ? '<button class="btn btn-sm coa-del-btn" data-acct-id="' + _esc(a.id) + '" data-acct-name="' + _esc(a.name) + '" ' +
                            'style="font-size:11px;padding:3px 8px;border:1px solid var(--danger);color:var(--danger)">Remove</button>'
                        : '<span style="color:var(--muted);font-size:11px">—</span>') +
                    '</td>' +
                  '</tr>';
                }).join('') +
              '</tbody>' +
            '</table>'
      );

      return '<div class="au-panel" style="margin-bottom:14px;padding:0;overflow:hidden">' +
        '<div class="coa-grp-hdr" data-grp="' + _esc(g) + '" style="' +
          'padding:12px 16px;display:flex;justify-content:space-between;align-items:center;' +
          'cursor:pointer;border-left:4px solid ' + color + '">' +
          '<span style="font-weight:700;font-size:13px">' + icon + ' ' + _esc(g) +
            ' <span style="font-size:12px;font-weight:400;color:var(--muted);margin-left:6px">' + accounts.length + ' accounts</span>' +
          '</span>' +
          '<span style="color:var(--muted);font-size:14px">' + (collapsed ? '▶' : '▼') + '</span>' +
        '</div>' +
        rows +
      '</div>';
    }).join('');
  }

  function _bindEvents(pv) {
    var searchEl = document.getElementById('coa-search');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        _searchQuery = searchEl.value;
        _refreshGroups();
      });
    }

    var filterEl = document.getElementById('coa-filter-group');
    if (filterEl) {
      filterEl.addEventListener('change', function () {
        _filterGroup = filterEl.value;
        _refreshGroups();
      });
    }

    var addBtn = document.getElementById('coa-add-btn');
    if (addBtn) addBtn.addEventListener('click', openAddModal);

    pv.querySelectorAll('.coa-group-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var g = card.getAttribute('data-group');
        _filterGroup = (_filterGroup === g) ? 'all' : g;
        var filterEl2 = document.getElementById('coa-filter-group');
        if (filterEl2) filterEl2.value = _filterGroup;
        _refreshGroups();
      });
    });

    _bindGroupsWrapEvents();
  }

  function _bindGroupsWrapEvents() {
    var wrap = document.getElementById('coa-groups-wrap');
    if (!wrap) return;

    wrap.querySelectorAll('.coa-grp-hdr').forEach(function (hdr) {
      hdr.addEventListener('click', function () {
        var g = hdr.getAttribute('data-grp');
        _collapsedGroups[g] = !_collapsedGroups[g];
        _refreshGroups();
      });
    });

    wrap.querySelectorAll('.coa-del-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-acct-id');
        var name = btn.getAttribute('data-acct-name');
        try {
          var acct = (ACC.AccountingState.getAllCOAAccounts() || []).filter(function (a) { return a && a.id === id; })[0];
          if (acct && acct.name) name = acct.name;
        } catch (err) {}
        _deactivateAccount(id, name);
      });
    });
  }

  function _refreshGroups() {
    var grouped = _getGroupedAccounts();
    var wrap = document.getElementById('coa-groups-wrap');
    if (wrap) wrap.innerHTML = _renderGroups(grouped);

    _bindGroupsWrapEvents();
  }

  var _deactivatingIds = {};

  function _deactivateAccount(id, name) {
    if (_deactivatingIds[id]) return;
    _deactivatingIds[id] = true;

    function _release() { delete _deactivatingIds[id]; }

    try {
      var _cu = window.ERP && ERP.getState && ERP.getState().session && ERP.getState().session.user;
      if (!_cu || (_cu.role || '').toLowerCase() !== 'admin') {
        _toast('❌ Only Admin can deactivate COA accounts', 'error'); _release(); return;
      }
    } catch (e) {
      console.warn('[coa.ui] permission check failed, blocking deactivation:', e);
      _toast('❌ Permission check failed — account cannot be deactivated', 'error');
      _release();
      return;
    }

    try {
      if (ACC.AccountingState && typeof ACC.AccountingState.getAccountBalance === 'function') {
        var bal = ACC.AccountingState.getAccountBalance(id);
        if (bal && Math.abs((bal.debit || 0) - (bal.credit || 0)) > 0) {
          _toast('⚠️ Account "' + _esc(name) + '" deactivate nahi ho sakta — outstanding balance hai', 'error'); _release(); return;
        }
      }
    } catch (e) {
      console.warn('[coa.ui] balance check failed, blocking deactivation:', e);
      _toast('❌ Balance check failed — account cannot be deactivated', 'error');
      _release();
      return;
    }

    try {
      if (ACC.AccountingState && typeof ACC.AccountingState.getAllJournals === 'function') {
        var allJournals = ACC.AccountingState.getAllJournals() || [];
        var hasEntries  = allJournals.some(function (j) {
          return j && Array.isArray(j.entries) && j.entries.some(function (e) { return e && e.accountId === id; });
        });
        if (hasEntries) {
          _toast('⚠️ Account "' + _esc(name) + '" mein journal entries maujood hain — isay deactivate nahi kiya ja sakta jab tak related entries reverse/void na ho jayen.', 'error');
          _release();
          return;
        }
      }
    } catch (e) {
      console.warn('[coa.ui] journal entries check failed, blocking deactivation:', e);
      _toast('❌ Journal entries check failed — account cannot be deactivated', 'error');
      _release();
      return;
    }

    var _coaConfirm = (window.ERP && window.ERP.confirmDialog) || function (msg, ok) { if (window.confirm(msg)) ok(); };
    _release();
    _coaConfirm('Remove "' + _esc(name) + '" from Chart of Accounts?\n\nThis account will be deactivated (existing journal entries are preserved).', function () {
      try {
        ACC.AccountingState.deactivateCOAAccount(id);
        if (ACC.AccountingStore) {
          var updated = (ACC.AccountingState.getAllCOAAccounts() || []).filter(function (a) { return a && a.id === id; })[0];
          if (updated) {
            ACC.AccountingStore.putOne(ACC.IDB_STORES.COA, updated)
              .catch(function (e) { console.warn('[coa.ui] IDB write failed:', e); });
          }
        }
        _toast('"' + _esc(name) + '" removed ✓', 'success');
        render();
      } catch (e) {
        _toast('Error: ' + _esc(e.message), 'error');
      }
    });
  }

  function openAddModal() {
    _closeModal();

    var groupOptions = GROUP_ORDER.map(function (g) {
      return '<option value="' + _esc(g) + '">' + GROUP_ICONS[g] + ' ' + _esc(g) + '</option>';
    }).join('');

    var typeOptions = [
      ['asset', 'Asset'], ['liability', 'Liability'],
      ['equity', 'Equity'], ['revenue', 'Revenue'], ['expense', 'Expense']
    ].map(function (pair) {
      return '<option value="' + pair[0] + '">' + pair[1] + '</option>';
    }).join('');

    var modal = document.createElement('div');
    modal.id        = MODAL_ID;
    modal.className = 'modal-bg open';

    modal.innerHTML =
      '<div class="modal sm">' +
        '<div class="modal-head">' +
          '<h2>📒 Add Account</h2>' +
          '<button id="coa-modal-close" class="modal-x"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#ic-x"/></svg></button>' +
        '</div>' +
        '<div class="modal-body">' +

          _field('Account Name *', 'coa-f-name', 'text', 'e.g. Petty Cash') +
          _field('Account Code *', 'coa-f-code', 'text', 'e.g. 1-1050') +

          '<div class="fg" style="margin-bottom:0">' +
            '<div class="fgrp">' +
              '<label>Group <span style="color:var(--danger)">*</span></label>' +
              '<select id="coa-f-group" class="fi">' + groupOptions + '</select>' +
            '</div>' +
            '<div class="fgrp">' +
              '<label>Type <span style="color:var(--danger)">*</span></label>' +
              '<select id="coa-f-type" class="fi">' + typeOptions + '</select>' +
            '</div>' +
          '</div>' +

          '<div style="background:var(--bg,#f8fafc);border-radius:var(--r-lg);padding:10px 12px;font-size:12px;color:var(--muted);margin-top:12px">' +
            '💡 <strong>Tip:</strong> Assets = 1, Liabilities = 2, Equity = 3, Revenue = 4, Expenses = 5.' +
          '</div>' +
          '<div id="coa-modal-err" style="display:none;margin-top:10px;color:var(--danger);font-size:13px;text-align:center"></div>' +

        '</div>' +
        '<div class="modal-foot">' +
          '<button id="coa-modal-cancel" class="btn btn-ghost">Cancel</button>' +
          '<button id="coa-modal-save" class="btn btn-primary">Save Account</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    document.getElementById('coa-modal-close').onclick  = _closeModal;
    document.getElementById('coa-modal-cancel').onclick = _closeModal;
    modal.addEventListener('click', function (e) { if (e.target === modal) _closeModal(); });
    document.getElementById('coa-modal-save').onclick   = _saveAccount;

    document.getElementById('coa-f-group').addEventListener('change', function () {
      var g = this.value;
      var typeEl = document.getElementById('coa-f-type');
      if (typeEl && GROUP_TYPE_MAP[g]) typeEl.value = GROUP_TYPE_MAP[g];
    });

    setTimeout(function () {
      var f = document.getElementById('coa-f-name');
      if (f) f.focus();
    }, 50);
  }

  function _field(label, id, type, placeholder) {
    return '<div class="fgrp" style="margin-bottom:12px">' +
      '<label>' + _esc(label) + '</label>' +
      '<input id="' + id + '" type="' + type + '" placeholder="' + _esc(placeholder || '') + '" class="fi">' +
    '</div>';
  }

  function _saveAccount() {
    var btn = document.getElementById('coa-modal-save');
    var err = document.getElementById('coa-modal-err');
    if (btn && btn.disabled) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    if (err) { err.style.display = 'none'; }

    try {
      var name  = (document.getElementById('coa-f-name').value  || '').trim();
      var code  = (document.getElementById('coa-f-code').value  || '').trim();
      var group = document.getElementById('coa-f-group').value;
      var type  = document.getElementById('coa-f-type').value;

      if (!name) throw new Error('Account name is required.');
      if (!code) throw new Error('Account code is required.');
      if (GROUP_TYPE_MAP[group] !== type) throw new Error('Selected Type does not match the selected Group.');

      var existing = ACC.AccountingState.getCOAByCode(code);
      if (!existing) {
        try {
          var allAccts = ACC.AccountingState.getAllCOAAccounts() || [];
          existing = allAccts.filter(function (a) {
            return a && String(a.code || '').trim().toLowerCase() === code.toLowerCase();
          })[0];
        } catch (e) {}
      }
      if (existing) throw new Error('Code "' + code + '" already exists: ' + existing.name);

      var account = ({
        id:        _uid(),
        code:      code,
        name:      name,
        group:     group,
        type:      type,
        parentId:  null,
        isSystem:  false,
        isActive:  true,
        createdAt: _serverTimeISO(),
        createdBy: _currentUser(),
      });

      ACC.AccountingState.addCOAAccount(account);

      if (ACC.AccountingStore) {
        ACC.AccountingStore.putOne(ACC.IDB_STORES.COA, account)
          .catch(function (e) { console.warn('[coa.ui] IDB write failed:', e); });
      }

      _closeModal();
      _toast('"' + _esc(account.name) + '" added to Chart of Accounts ✓', 'success');
      render();

    } catch (e) {
      if (err) { err.textContent = e.message; err.style.display = 'block'; }
      if (btn) { btn.disabled = false; btn.textContent = 'Save Account'; }
    }
  }

  function _boot() {
    if (ERP.registerRenderer) {
      ERP.registerRenderer('coa', function () { render(); });
    }

    ERP.coa = {
      render:   render,
      openAdd:  openAddModal,
    };

    _initAccounting();
  }

  function _initAccounting() {
    if (!ACC.AccountingState) {
      console.warn('[coa.ui] AccountingState not loaded yet.');
      return;
    }

    if (typeof ACC.AccountingState.isInitialized !== 'function') {
      console.warn('[coa.ui] AccountingState.isInitialized is not available — skipping init check.');
      return;
    }

    if (!ACC.AccountingState.isInitialized()) {
      try { ACC.AccountingState.initialize(); } catch (e) { console.warn('[coa.ui] init error:', e); }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }

})(typeof window !== 'undefined' ? window : globalThis);
