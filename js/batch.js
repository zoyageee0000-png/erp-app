'use strict';

var ERP = window.ERP || {};

(function (ERP) {
  'use strict';

  var getState = function () { return ERP.getState ? ERP.getState() : {}; };
  var setState = function (fn, tag) { if (ERP.setState) ERP.setState(fn, tag); };
  var _esc = function (s) { return ERP.escapeHtml ? ERP.escapeHtml(s) : String(s || ''); };
  var _fmt = function (n) { return ERP.fmt ? ERP.fmt(n) : 'Rs.' + (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var _today = function () { return ERP.DateUtils ? ERP.DateUtils.today() : (function () { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })(); };
  var _toast = function (m, t, d) { if (ERP.ui && ERP.ui.toast) ERP.ui.toast(m, t, d); };
  var _uid = function () { return 'BATCH-' + ERP.uid(); }; // FIX (root cause, audit #61-62): core.js loads first of 92 scripts, before this file -- fallback bought nothing but a second, weaker ID scheme.
  var _getBatches = function () { var s = getState(); return (s && s.data && s.data.batches) || []; };

  var MODAL_ID = 'batchModal';
  var _editId = null;

  function _ensureModal() {
    if (document.getElementById(MODAL_ID)) return;
    var el = document.createElement('div');
    el.id = MODAL_ID;
    el.className = 'modal-bg';
    el.innerHTML =
      '<div class="modal" style="max-width:480px">' +
        '<div class="modal-head">' +
          '<h2 id="batchModalTitle">Add Batch / HSN</h2>' +
          '<button class="modal-x" data-action="batch:close" aria-label="Close">×</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div class="form-row">' +
            '<label class="form-label">Batch / HSN Code *</label>' +
            '<input id="batch-code" class="form-input" placeholder="e.g. HSN-8708" maxlength="60" />' +
          '</div>' +
          '<div class="form-row">' +
            '<label class="form-label">Description *</label>' +
            '<input id="batch-desc" class="form-input" placeholder="Batch description" maxlength="120" />' +
          '</div>' +
          '<div class="form-row">' +
            '<label class="form-label">Item / Product</label>' +
            '<input id="batch-item" class="form-input" placeholder="Associated inventory item (optional)" maxlength="120" />' +
          '</div>' +
          '<div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
            '<div>' +
              '<label class="form-label">Quantity</label>' +
              '<input id="batch-qty" class="form-input" type="number" min="0" step="1" placeholder="0" />' +
            '</div>' +
            '<div>' +
              '<label class="form-label">Unit Cost (Rs.)</label>' +
              '<input id="batch-cost" class="form-input" type="number" min="0" step="0.01" placeholder="0.00" />' +
            '</div>' +
          '</div>' +
          '<div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
            '<div>' +
              '<label class="form-label">Mfg Date</label>' +
              '<input id="batch-mfg" class="form-input" type="date" />' +
            '</div>' +
            '<div>' +
              '<label class="form-label">Expiry Date</label>' +
              '<input id="batch-exp" class="form-input" type="date" />' +
            '</div>' +
          '</div>' +
          '<div class="form-row">' +
            '<label class="form-label">Notes</label>' +
            '<textarea id="batch-notes" class="form-input" rows="2" placeholder="Optional notes"></textarea>' +
          '</div>' +
        '</div>' +
        '<div class="modal-footer">' +
          '<button class="btn btn-ghost" data-action="batch:close">Cancel</button>' +
          '<button class="btn btn-primary" data-action="batch:save" id="batch-save-btn">Save Batch</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);

    el.querySelectorAll('[data-action="batch:close"]').forEach(function (btn) {
      btn.addEventListener('click', closeAdd);
    });
    document.getElementById('batch-save-btn').addEventListener('click', save);
  }

  function openAdd(editId) {
    _ensureModal();
    _editId = (editId !== undefined && editId !== null) ? editId : null;
    var titleEl = document.getElementById('batchModalTitle');
    if (titleEl) titleEl.textContent = (_editId !== null) ? 'Edit Batch / HSN' : 'Add Batch / HSN';

    ['batch-code', 'batch-desc', 'batch-item', 'batch-qty', 'batch-cost', 'batch-mfg', 'batch-exp', 'batch-notes'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });

    if (_editId !== null) {
      var batches = _getBatches();
      var b = batches.find(function (x) { return x.id === _editId; });
      if (b) {
        var _set = function (id, val) { var el = document.getElementById(id); if (el && val !== undefined && val !== null) el.value = val; };
        _set('batch-code', b.code);
        _set('batch-desc', b.desc);
        _set('batch-item', b.item);
        _set('batch-qty', b.qty);
        _set('batch-cost', b.cost);
        _set('batch-mfg', b.mfgDate);
        _set('batch-exp', b.expDate);
        _set('batch-notes', b.notes);
      }
    }

    var modal = document.getElementById(MODAL_ID);
    if (modal) { modal.classList.add('open'); document.body.style.overflow = 'hidden'; }
    setTimeout(function () { var el = document.getElementById('batch-code'); if (el) el.focus(); }, 80);
  }

  function closeAdd() {
    var modal = document.getElementById(MODAL_ID);
    if (modal) { modal.classList.remove('open'); document.body.style.overflow = ''; }
    _editId = null;
  }

  function save() {
    var code = (document.getElementById('batch-code') || {}).value || '';
    var desc = (document.getElementById('batch-desc') || {}).value || '';
    if (!code.trim()) { _toast('Batch/HSN code required', 'warning'); return; }
    if (!desc.trim()) { _toast('Description required', 'warning');     return; }

    var codeTrim = code.trim();
    var dupe = _getBatches().find(function (x) { return x.id !== _editId && x.code && x.code.trim().toLowerCase() === codeTrim.toLowerCase(); });
    if (dupe) { _toast('Batch/HSN code "' + codeTrim + '" already exists', 'warning'); return; }

    var existing = (_editId !== null)
      ? _getBatches().find(function (x) { return x.id === _editId; })
      : null;

    var batch = {
      id:      (existing && existing.id) || _uid(),
      code:    code.trim(),
      desc:    desc.trim(),
      item:    (document.getElementById('batch-item')  || {}).value || '',
      qty:     parseFloat((document.getElementById('batch-qty')  || {}).value)  || 0,
      cost:    parseFloat((document.getElementById('batch-cost') || {}).value)  || 0,
      mfgDate: (document.getElementById('batch-mfg')   || {}).value || '',
      expDate: (document.getElementById('batch-exp')   || {}).value || '',
      notes:   (document.getElementById('batch-notes') || {}).value || '',
      date:    _today(),
      updatedAt: ERP.DateUtils ? ERP.DateUtils.now() : new Date().toISOString()
    };

    if (existing) {
      setState(function (s) {
        var idx = (s.data.batches || []).findIndex(function (x) { return x.id === batch.id; });
        if (idx !== -1) {
          s.data.batches[idx] = Object.assign({}, s.data.batches[idx], batch);
        }
      }, 'batchtrack');
      _toast('Batch updated — ' + batch.code, 'success', 2500);
    } else {
      batch.createdAt = batch.updatedAt;
      setState(function (s) {
        if (!Array.isArray(s.data.batches)) s.data.batches = [];
        s.data.batches.unshift(batch);
      }, 'batchtrack');
      _toast('Batch saved — ' + batch.code, 'success', 2500);
    }

    // ARCHITECTURAL REFACTOR: single choke point for all IndexedDB writes.
    ERP.Persistence.save('batches', _getBatches()).catch(function (e) {
      if (window.DEBUG_MODE) console.warn('[ERP.batch.save]', e);
    });

    closeAdd();
    render();
  }

  function del(id, btnEl) {
    var batches = _getBatches();
    var b = batches.find(function (x) { return x.id === id; });
    if (!b) return;
    var _batchConfirm = (window.ERP && window.ERP.confirmDialog) || function(msg, ok) { if (window.confirm(msg)) ok(); };
    _batchConfirm('Delete batch "' + b.code + '"?\nYeh action undo nahi ho sakta.', function() {
      setState(function (s) {
        s.data.batches = (s.data.batches || []).filter(function (x) { return x.id !== id; });
      }, 'batchtrack');

      ERP.Persistence.save('batches', _getBatches()).catch(function (e) {
        if (window.DEBUG_MODE) console.warn('[ERP.batch.del]', e);
      });

      _toast('Batch deleted', 'info', 2000);
      render();
    });
  }

  function render() {
    var pv = document.getElementById('pv-batchtrack');
    if (!pv) return;

    var batches = _getBatches();
    var today = _today();

    var rows = batches.map(function (b, i) {
      var isExpired = b.expDate && b.expDate < today;
      var expiringSoon = !isExpired && b.expDate && b.expDate <= (function () {
        var dt = ERP.DateUtils ? ERP.DateUtils.today().split('-') : today.split('-');
        var d30 = new Date(parseInt(dt[0]), parseInt(dt[1]) - 1, parseInt(dt[2]) + 30);
        return d30.getFullYear() + '-' + String(d30.getMonth() + 1).padStart(2, '0') + '-' + String(d30.getDate()).padStart(2, '0');
      })();

      var expBadge = isExpired
        ? '<span class="badge b-red" style="font-size:10px">EXPIRED</span>'
        : expiringSoon
          ? '<span class="badge b-orange" style="font-size:10px">Expiring Soon</span>'
          : '';

      return '<tr>' +
        '<td style="font-weight:600">' + _esc(b.code) + '</td>' +
        '<td>' + _esc(b.desc) + '</td>' +
        '<td>' + _esc(b.item || '—') + '</td>' +
        '<td style="text-align:right">' + (b.qty || 0) + '</td>' +
        '<td style="text-align:right">' + _fmt(b.cost || 0) + '</td>' +
        '<td>' + _esc(b.mfgDate || '—') + '</td>' +
        '<td>' + _esc(b.expDate || '—') + ' ' + expBadge + '</td>' +
        '<td>' + _esc(b.date || '') + '</td>' +
        '<td>' +
          '<button class="btn btn-ghost btn-xs" data-action="batch:edit" data-id="' + _esc(b.id) + '" style="margin-right:4px">Edit</button>' +
          '<button class="btn btn-danger btn-xs" data-action="batch:del" data-id="' + _esc(b.id) + '">Delete</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    pv.innerHTML =
      '<div class="panel">' +
        '<div class="panel-head">' +
          '<span class="panel-title">Batch / HSN Tracking</span>' +
          '<span style="font-size:13px;color:var(--muted)">' + batches.length + ' batch(es)</span>' +
        '</div>' +
        (batches.length === 0
          ? '<div style="text-align:center;padding:40px;color:var(--muted)">No batches yet — click <b>Add Batch</b> to start.</div>'
          : '<div class="table-wrap"><table class="dt"><thead><tr>' +
              '<th>Code / HSN</th><th>Description</th><th>Item</th><th style="text-align:right">Qty</th>' +
              '<th style="text-align:right">Unit Cost</th><th>Mfg Date</th><th>Expiry</th><th>Added</th><th>Actions</th>' +
            '</tr></thead><tbody>' + rows + '</tbody></table></div>') +
      '</div>';

    pv.querySelectorAll('[data-action="batch:edit"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openAdd(btn.getAttribute('data-id'));
      });
    });

    pv.querySelectorAll('[data-action="batch:del"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        del(btn.getAttribute('data-id'));
      });
    });
  }

  if (ERP.registerRenderer) {
    ERP.registerRenderer('batchtrack', render);
  }

  ERP.batch = {
    openAdd:  openAdd,
    closeAdd: closeAdd,
    save:     save,
    del:      del,
    render:   render
  };

})(ERP);

window.ERP = ERP;
