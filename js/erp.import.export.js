'use strict';

var ERP = window.ERP || {};

(function (ERP) {
  'use strict';

  var SYSTEM_ACCOUNTS = (ERP.SYSTEM_ACCOUNTS) || {
    ACCOUNTS_RECEIVABLE: 'acc-1100',
    ACCOUNTS_PAYABLE:    'acc-2001',
    OWNER_EQUITY:        'acc-3001'
  };

  var DOWNLOAD_LINK_CLEANUP_DELAY_MS = 1000;
  var GL_BACKLOG_RETRY_DELAY_MS      = 2000;
  var MAX_CSV_FILE_SIZE_BYTES        = 10 * 1024 * 1024;

  function _gs()          { return ERP.getState(); }
  function _st(fn, tag)   { return ERP.setState(fn, tag); }
  // ARCHITECTURAL REFACTOR: single choke point for all IndexedDB writes.
  function _persistArr(storeName, data) {
    return ERP.Persistence.save(storeName, data || [], { retries: 1, silent: true });
  }
  function _toast(m,t,d)  { if (ERP.ui) ERP.ui.toast(m, t, d); }
  function _e(s)          { return ERP.escapeHtml ? ERP.escapeHtml(String(s === null || s === undefined ? '' : s)) : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _inv()         { return _gs().data.inventory  || []; }
  function _custs()       { return _gs().data.customers  || []; }
  function _sups()        { return _gs().data.suppliers  || []; }
  function _serverNowISO() {
    return (ERP.ServerTime && typeof ERP.ServerTime.nowISO === 'function')
      ? ERP.ServerTime.nowISO()
      : new Date().toISOString();
  }
  function _todayDateStr() {
    if (ERP.DateUtils && typeof ERP.DateUtils.today === 'function') return ERP.DateUtils.today();
    var d = (ERP.ServerTime && typeof ERP.ServerTime.now === 'function') ? new Date(ERP.ServerTime.now()) : new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  var _CSV = {
    parse: function (text) {
      var rows    = [];
      var row     = [];
      var field   = '';
      var inQuote = false;
      var i       = 0;
      var len     = text.length;
      while (i < len) {
        var ch = text[i];
        if (inQuote) {
          if (ch === '"') {
            if (i + 1 < len && text[i + 1] === '"') { field += '"'; i += 2; continue; }
            inQuote = false; i++; continue;
          }
          field += ch; i++; continue;
        }
        if (ch === '"') { inQuote = true; i++; continue; }
        if (ch === ',') { row.push(field.trim()); field = ''; i++; continue; }
        if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
          row.push(field.trim()); field = '';
          if (row.some(function (c) { return c !== ''; })) rows.push(row);
          row = []; if (ch === '\r') i++;
          i++; continue;
        }
        if (ch === '\r') { row.push(field.trim()); field = ''; if (row.some(function (c) { return c !== ''; })) rows.push(row); row = []; i++; continue; }
        field += ch; i++;
      }
      if (field.trim() !== '' || row.length > 0) { row.push(field.trim()); if (row.some(function (c) { return c !== ''; })) rows.push(row); }
      return rows;
    },

    headerMap: function (headerRow) {
      var map = {};
      headerRow.forEach(function (h, idx) {
        map[h.toLowerCase().replace(/[^a-z0-9]/g, '')] = idx;
      });
      return map;
    },

    field: function (row, map, key, fallback) {
      var idx = map[key];
      if (idx === undefined) return fallback !== undefined ? fallback : '';
      return (row[idx] || '').trim();
    },

    download: function (filename, rows) {
      var csv = rows.map(function (r) {
        return r.map(function (v) {
          var s = String(v === null || v === undefined ? '' : v);
          if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
            return '"' + s.replace(/"/g, '""') + '"';
          }
          return s;
        }).join(',');
      }).join('\r\n');
      var bom = '\uFEFF';
      var blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href     = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, DOWNLOAD_LINK_CLEANUP_DELAY_MS);
    }
  };

  function _genBC() {
    return 'ERP-' + Date.now().toString(36).toUpperCase().slice(-4)
           + Math.random().toString(36).slice(2, 5).toUpperCase();
  }

  function _uniqueBC(existingBCs) {
    var bc;
    do { bc = _genBC(); } while (existingBCs.indexOf(bc) !== -1);
    existingBCs.push(bc);
    return bc;
  }

  var _modal = {
    open: function (html, title, onConfirm, confirmLabel, confirmClass) {
      var existing = document.getElementById('ie-modal-bg');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

      var bg = document.createElement('div');
      bg.id = 'ie-modal-bg';
      bg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.52);z-index:var(--zi-critical,1100);display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto';

      var dlg = document.createElement('div');
      dlg.style.cssText = 'background:var(--surface,#fff);border-radius:14px;width:100%;max-width:720px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.24);overflow:hidden';

      var header = document.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-l,#e2e8f0)';

      var titleEl = document.createElement('h3');
      titleEl.style.cssText = 'margin:0;font-size:15px;font-weight:700;color:var(--text,#1e293b)';
      titleEl.textContent = (title === null || title === undefined) ? '' : String(title);

      var closeBtn = document.createElement('button');
      closeBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:18px;color:var(--muted,#64748b);padding:4px 8px;border-radius:6px';
      closeBtn.title = 'Close';
      closeBtn.textContent = '✕';

      header.appendChild(titleEl);
      header.appendChild(closeBtn);

      var body = document.createElement('div');
      body.style.cssText = 'flex:1;overflow-y:auto;padding:20px';
      body.innerHTML = html;

      var footer = document.createElement('div');
      footer.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;padding:14px 20px;border-top:1px solid var(--border-l,#e2e8f0)';

      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn-ghost';
      cancelBtn.textContent = 'Cancel';
      footer.appendChild(cancelBtn);

      var confirmBtn = null;
      if (onConfirm) {
        confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn ' + (confirmClass || 'btn-primary');
        confirmBtn.textContent = confirmLabel || 'Confirm';
        footer.appendChild(confirmBtn);
      }

      dlg.appendChild(header);
      dlg.appendChild(body);
      dlg.appendChild(footer);

      bg.appendChild(dlg);
      document.body.appendChild(bg);
      document.body.style.overflow = 'hidden';

      function onBgClick(e) { if (e.target === bg) close(); }

      function close() {
        closeBtn.removeEventListener('click', close);
        cancelBtn.removeEventListener('click', close);
        bg.removeEventListener('click', onBgClick);
        if (confirmBtn) confirmBtn.removeEventListener('click', onConfirmClick);
        if (bg.parentNode) bg.parentNode.removeChild(bg);
        document.body.style.overflow = '';
      }

      function onConfirmClick() {
        close();
        onConfirm();
      }

      closeBtn.addEventListener('click', close);
      cancelBtn.addEventListener('click', close);
      bg.addEventListener('click', onBgClick);
      if (confirmBtn) confirmBtn.addEventListener('click', onConfirmClick);

      return { close: close };
    }
  };

  function _pickCSV(callback) {
    var input = document.createElement('input');
    input.type   = 'file';
    input.accept = '.csv,text/csv,text/plain';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var file = input.files[0];
      document.body.removeChild(input);
      if (!file) return;
      if (file.size > MAX_CSV_FILE_SIZE_BYTES) {
        callback(new Error('File too large (' + (file.size / (1024 * 1024)).toFixed(1) + 'MB). Maximum allowed is ' + (MAX_CSV_FILE_SIZE_BYTES / (1024 * 1024)) + 'MB.'));
        return;
      }
      var reader = new FileReader();
      reader.onload = function (e) {
        try { callback(null, e.target.result, file.name); }
        catch (err) { callback(err); }
      };
      reader.onerror = function () { callback(new Error('File read failed.')); };
      reader.readAsText(file, 'UTF-8');
    });
    input.click();
  }

  var _importingItems   = false;
  var _importingParties = false;

  function importItems() {
    if (_importingItems) { _toast('⚠️ Import already in progress.', 'warning'); return; }
    _importingItems = true;
    _pickCSV(function (err, text, filename) {
      if (err) { _importingItems = false; _toast('❌ File read error: ' + err.message, 'error'); return; }

      var rows = _CSV.parse(text);
      if (!rows || rows.length < 2) {
        _importingItems = false;
        _toast('❌ CSV must have a header row + at least one data row.', 'error'); return;
      }
      var hdr = rows[0];
      var map = _CSV.headerMap(hdr);

      var REQ_COLS = ['name', 'saleprice'];
      var missingCols = REQ_COLS.filter(function (k) { return map[k] === undefined; });
      if (missingCols.length) {
        _importingItems = false;
        _toast('❌ Missing required columns: ' + missingCols.join(', '), 'error'); return;
      }

      function F(row, key, def) { return _CSV.field(row, map, key, def !== undefined ? def : ''); }
      function N(row, key, def) { var v = parseFloat(F(row, key, '')); return isNaN(v) ? (def || 0) : v; }

      var existingBCs   = _inv().map(function (i) { return i.bc; });
      var existingByName = {};
      _inv().forEach(function (i) {
        var key = (i.n || '').toLowerCase();
        if (key) existingByName[key] = i;
      });
      var usedBCs = existingBCs.slice();

      var toAdd    = [];
      var skipped  = [];
      var errors   = [];

      rows.slice(1).forEach(function (row, ri) {
        var rowNum = ri + 2;
        var name   = F(row, 'name');
        var sp     = N(row, 'saleprice');

        if (!name || name.length < 2) {
          errors.push({ row: rowNum, reason: 'Name missing or too short' }); return;
        }
        if (isNaN(sp) || sp < 0) {
          errors.push({ row: rowNum, name: name, reason: 'SalePrice invalid' }); return;
        }

        var existingItem = existingByName[name.toLowerCase()];
        if (existingItem) {
          var incomingUnit = (F(row, 'unit') || 'PCS');
          var incomingCat  = (F(row, 'category') || 'Other');
          var unitDiffers  = (existingItem.unit || 'PCS') !== incomingUnit;
          var catDiffers   = (existingItem.cat  || 'Other') !== incomingCat;
          var reason = 'Already exists in inventory';
          if (unitDiffers || catDiffers) {
            reason = 'Already exists in inventory, but CSV row has a different '
              + (unitDiffers && catDiffers ? 'unit and category' : unitDiffers ? 'unit' : 'category')
              + ' — review manually, not auto-imported';
          }
          skipped.push({ row: rowNum, name: name, reason: reason }); return;
        }

        var bc = (F(row, 'barcode') || '').trim();
        if (!bc) {
          bc = _uniqueBC(usedBCs);
        } else if (usedBCs.indexOf(bc) !== -1) {
          skipped.push({ row: rowNum, name: name, reason: 'Barcode "' + bc + '" already taken — row skipped' }); return;
        } else {
          usedBCs.push(bc);
        }

        var st     = N(row, 'stock', 0);
        var pp     = N(row, 'purchaseprice', 0);
        var minSt  = N(row, 'minstock', 5);
        var tax    = N(row, 'tax', 0);
        var mrp    = N(row, 'mrp', 0);

        if (tax < 0 || tax > 100) { errors.push({ row: rowNum, name: name, reason: 'Tax% must be 0–100' }); return; }
        if (pp < 0)               { errors.push({ row: rowNum, name: name, reason: 'PurchasePrice cannot be negative' }); return; }

        var newItem = {
          n:          name,
          bc:         bc,
          sku:        F(row, 'sku') || F(row, 'partno'),
          cat:        F(row, 'category') || 'Other',
          sp:         sp,
          pp:         pp,
          st:         Math.max(0, Math.floor(st)),
          minSt:      Math.max(0, Math.floor(minSt)),
          unit:       F(row, 'unit') || 'PCS',
          mrp:        mrp,
          tax:        tax,
          hsn:        F(row, 'hsn') || F(row, 'hsncode'),
          loc:        F(row, 'location') || F(row, 'loc'),
          desc:       F(row, 'description') || F(row, 'desc'),
          image:      null,
          importedAt: _serverNowISO(),
          createdAt:  Date.now(),
          // FIX (root cause): was preferring ERP.ID.generate('INV') -- a
          // whole separate, undocumented ID-generator module (erp.system.guard.js)
          // duplicating ERP.uid()'s job. That module is being removed (traced:
          // 3 of its 4 methods had zero callers app-wide); use the one
          // canonical generator directly.
          id:         'INV-' + ERP.uid()
        };

        existingByName[name.toLowerCase()] = newItem;
        toAdd.push(newItem);
      });

      if (toAdd.length === 0 && errors.length === 0 && skipped.length === 0) {
        _importingItems = false;
        _toast('⚠️ CSV had no usable rows — nothing to import.', 'warning'); return;
      }

      var previewHtml = _buildItemPreviewHTML(filename, toAdd, skipped, errors);

      if (toAdd.length === 0) {
        _importingItems = false;
        _modal.open(previewHtml, '📦 Import Items Preview — ' + filename, null, null, null);
        return;
      }

      _modal.open(
        previewHtml,
        '📦 Import Items Preview — ' + filename,
        function () { _commitItems(toAdd); },
        '✅ Import ' + toAdd.length + ' Item' + (toAdd.length !== 1 ? 's' : ''),
        'btn-primary'
      );
    });
  }

  function _buildItemPreviewHTML(filename, toAdd, skipped, errors) {
    var html = '';

    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">'
      + '<span style="background:#dcfce7;color:#15803d;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700">✅ ' + toAdd.length + ' to import</span>'
      + (skipped.length ? '<span style="background:#fef9c3;color:#854d0e;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700">⚠️ ' + skipped.length + ' skipped (duplicate)</span>' : '')
      + (errors.length  ? '<span style="background:#fee2e2;color:#b91c1c;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700">❌ ' + errors.length + ' error rows</span>' : '')
      + '</div>';

    if (toAdd.length) {
      html += '<div style="margin-bottom:14px"><div style="font-size:12px;font-weight:700;color:var(--muted,#64748b);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Items to be imported</div>'
        + '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">'
        + '<thead><tr style="background:var(--bg,#f8fafc)">'
        + '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border-l,#e2e8f0)">Name</th>'
        + '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border-l,#e2e8f0)">Barcode</th>'
        + '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border-l,#e2e8f0)">Category</th>'
        + '<th style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--border-l,#e2e8f0)">Sale Rs.</th>'
        + '<th style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--border-l,#e2e8f0)">Stock</th>'
        + '</tr></thead><tbody>';

      toAdd.forEach(function (it) {
        html += '<tr style="border-bottom:1px solid var(--border-l,#f1f5f9)">'
          + '<td style="padding:5px 8px;font-weight:600">' + _e(it.n) + '</td>'
          + '<td style="padding:5px 8px;font-family:var(--font-mono,monospace);font-size:11px;color:var(--muted,#64748b)">' + _e(it.bc) + '</td>'
          + '<td style="padding:5px 8px"><span style="background:#dbeafe;color:#4338CA;border-radius:4px;padding:1px 6px;font-size:11px">' + _e(it.cat) + '</span></td>'
          + '<td style="padding:5px 8px;text-align:right;font-weight:600">' + ((window.ERP && typeof window.ERP.fmt === 'function') ? window.ERP.fmt(it.sp || 0) : 'Rs.' + (it.sp || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + '</td>'
          + '<td style="padding:5px 8px;text-align:right">' + (it.st || 0) + '</td>'
          + '</tr>';
      });
      html += '</tbody></table></div></div>';
    }

    if (skipped.length) {
      html += '<div style="margin-bottom:14px"><div style="font-size:12px;font-weight:700;color:var(--muted,#64748b);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Skipped rows (duplicates)</div>'
        + '<div style="background:#fefce8;border:1px solid #fef08a;border-radius:8px;padding:10px 14px">';
      skipped.forEach(function (s) {
        html += '<div style="font-size:12px;margin-bottom:4px"><b>Row ' + s.row + ':</b> ' + _e(s.name || '—') + ' — <i>' + _e(s.reason) + '</i></div>';
      });
      html += '</div></div>';
    }

    if (errors.length) {
      html += '<div style="margin-bottom:14px"><div style="font-size:12px;font-weight:700;color:var(--muted,#64748b);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Error rows (will NOT be imported)</div>'
        + '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px">';
      errors.forEach(function (err) {
        html += '<div style="font-size:12px;margin-bottom:4px"><b>Row ' + err.row + ':</b> ' + _e(err.name || '—') + ' — <i>' + _e(err.reason) + '</i></div>';
      });
      html += '</div></div>';
    }

    html += '<div style="margin-top:14px;padding:10px 14px;background:var(--bg,#f8fafc);border-radius:8px;font-size:11px;color:var(--muted,#64748b)">'
      + '💡 Need the template? Use <b>Export Items</b> to download the correct CSV format, then fill in new rows.'
      + '</div>';

    return html;
  }

  function _commitItems(toAdd) {
    if (!toAdd || !toAdd.length) { _importingItems = false; return; }

    if (window.ERP && ERP.PeriodLock && typeof ERP.PeriodLock.check === 'function') {
      var _today = _todayDateStr();
      var _lockCheck = ERP.PeriodLock.check(_today);
      if (_lockCheck && _lockCheck.locked) {
        _toast('⚠️ Import blocked: current period is locked (' + _lockCheck.periodId + '). Unlock the period first.', 'error', 7000);
        _importingItems = false;
        return;
      }
    }

    _st(function (s) {
      s.data.inventory      = s.data.inventory      || [];
      s.data.stockBatches   = s.data.stockBatches   || [];
      s.data.stockMovements = s.data.stockMovements || [];

      toAdd.forEach(function (item) {
        s.data.inventory.push(item);

        if (item.st > 0) {
          var alreadyImported = (s.data.stockMovements || []).some(function (m) {
            return m.ref === 'IMPORT_CSV' && m.bc === item.bc;
          });
          if (alreadyImported) return;

          var batchId = Date.now() + '_imp_' + Math.random().toString(36).slice(2, 6);
          s.data.stockBatches.push({
            id:          batchId,
            bc:          item.bc,
            qty:         item.st,
            remaining:   item.st,
            costPerUnit: item.pp || 0,
            purchaseRef: 'IMPORT_CSV',
            note:        'Opening stock via CSV import',
            createdAt:   item.importedAt
          });
          s.data.stockMovements.push({
            id:   batchId + '_mv',
            bc:   item.bc,
            type: 'IN',
            qty:  item.st,
            cpu:  item.pp || 0,
            ref:  'IMPORT_CSV',
            ts:   item.importedAt
          });
        }
      });
    }, 'inventory:import');

    var saveInv  = _persistArr('inventory',      _gs().data.inventory      || []);
    var saveBat  = _persistArr('stockBatches',   _gs().data.stockBatches   || []);
    var saveMov  = _persistArr('stockMovements', _gs().data.stockMovements || []);

    Promise.all([saveInv, saveBat, saveMov])
      .then(function () {
        _importingItems = false;
        ERP.events.emit(ERP.events.NAMES.INVENTORY_UPDATED);

        if (window.ERP && ERP.Ledger && ERP.Ledger.StockLedger &&
            typeof ERP.Ledger.StockLedger.postStockReceipt === 'function') {
          var _today2 = _todayDateStr();
          var _glFailedItems = [];
          var _glPosts = toAdd.filter(function (item) {
            return item.st > 0 && item.pp > 0;
          }).map(function (item) {
            var _costPaisa = Math.round(item.st * item.pp * 100);
            return ERP.Ledger.StockLedger.postStockReceipt({
              sourceId:    'IMPORT-' + item.bc,
              amountPaisa: _costPaisa,
              date:        (item.importedAt || _today2).slice(0, 10),
              memo:        'Opening stock import: ' + (item.n || item.bc),
              cash:        false
            }, 'system').catch(function (_glErr) {
              _glFailedItems.push(item.n || item.bc);
              try {
                var _gk = 'erp_import_gl_backlog';
                var _gb = JSON.parse(localStorage.getItem(_gk) || '[]');
                _gb.push({ bc: item.bc, costPaisa: _costPaisa, ts: _today2 });
                localStorage.setItem(_gk, JSON.stringify(_gb));
              } catch (_backlogErr) {
                console.error('[ERP import items] failed to persist GL backlog entry for', item.bc, _backlogErr);
              }
            });
          });
          Promise.all(_glPosts).then(function () {
            if (_glFailedItems.length) {
              _toast('⚠️ GL posting failed for ' + _glFailedItems.length + ' imported item(s): ' + _glFailedItems.join(', ') + '. Stock was added but not posted to GL — fix manually.', 'error', 9000);
            }
          }).catch(function (_glAggErr) {
            console.error('[ERP import items] unexpected error while reconciling GL posts:', _glAggErr);
            _toast('⚠️ GL posting reconciliation failed unexpectedly. Check console.', 'error', 9000);
          });
        }

        _toast('✅ ' + toAdd.length + ' items imported successfully!', 'success', 4000);
        if (ERP.inventory && ERP.inventory.render) ERP.inventory.render();
      })
      .catch(function (e) {
        _importingItems = false;
        console.error('[ERP import items] DB save failed:', e);
        _toast('⚠️ Items added to memory but DB save failed. Backup your data!', 'warning', 5000);
        ERP.events.emit(ERP.events.NAMES.INVENTORY_UPDATED);
      });
  }

  function exportItems() {
    var inv = _inv();
    if (!inv.length) { _toast('No inventory to export.', 'warning'); return; }

    var header = [
      'Name', 'Barcode', 'SKU', 'Category',
      'SalePrice', 'PurchasePrice', 'Stock', 'MinStock',
      'Unit', 'MRP', 'Tax%', 'HSN', 'Location', 'Description',
      'StockStatus', 'StockValue', 'ImportedAt'
    ];

    var rows = [header];
    inv.forEach(function (p) {
      var st  = p.st  || 0;
      var min = p.minSt || 5;
      var status = st <= 0 ? 'Out of Stock' : st <= min ? 'Low Stock' : 'In Stock';
      rows.push([
        p.n   || '',  p.bc  || '',  p.sku  || '',  p.cat  || '',
        p.sp  || 0,   p.pp  || 0,   st,             min,
        p.unit || '',  p.mrp || 0,   p.tax  || 0,   p.hsn  || '',
        p.loc || '',  p.desc || '',  status,
        ((p.pp || 0) * st).toFixed(2),
        p.importedAt || p.createdAt ? new Date(p.importedAt || p.createdAt).toLocaleDateString('en-PK') : ''
      ]);
    });

    _CSV.download('inventory-export-' + _dateStamp() + '.csv', rows);
    _toast('✅ ' + inv.length + ' items exported.', 'success');
  }

  function importParties() {
    if (_importingParties) { _toast('⚠️ Import already in progress.', 'warning'); return; }
    _importingParties = true;
    _pickCSV(function (err, text, filename) {
      if (err) { _importingParties = false; _toast('❌ File read error: ' + err.message, 'error'); return; }

      var rows = _CSV.parse(text);
      if (!rows || rows.length < 2) {
        _importingParties = false;
        _toast('❌ CSV must have a header row + at least one data row.', 'error'); return;
      }

      var hdr = rows[0];
      var map = _CSV.headerMap(hdr);

      if (map['name'] === undefined) {
        _importingParties = false;
        _toast('❌ CSV missing required "Name" column.', 'error'); return;
      }
      if (map['type'] === undefined) {
        _importingParties = false;
        _toast('❌ CSV missing required "Type" column (customer / supplier).', 'error'); return;
      }

      function F(row, key, def) { return _CSV.field(row, map, key, def !== undefined ? def : ''); }
      function N(row, key, def) { var v = parseFloat(F(row, key, '')); return isNaN(v) ? (def || 0) : v; }

      var existingCustNames = _custs().map(function (c) { return (c.n || '').toLowerCase(); });
      var existingSupNames  = _sups().map(function (s)  { return (s.n || '').toLowerCase(); });

      var toAddCust  = [];
      var toAddSup   = [];
      var skipped    = [];
      var errors     = [];

      rows.slice(1).forEach(function (row, ri) {
        var rowNum = ri + 2;
        var name   = F(row, 'name');
        var type   = F(row, 'type').toLowerCase().trim();

        if (!name || name.length < 2) {
          errors.push({ row: rowNum, reason: 'Name missing or too short' }); return;
        }
        if (type !== 'customer' && type !== 'supplier') {
          errors.push({ row: rowNum, name: name, reason: 'Type must be "customer" or "supplier" (got: "' + type + '")' }); return;
        }

        var phone   = F(row, 'phone') || F(row, 'ph');
        var address = F(row, 'address') || F(row, 'addr') || F(row, 'city');
        var email   = F(row, 'email');
        var vehicle = F(row, 'vehicle') || F(row, 'veh');
        var gstin   = F(row, 'gstin')   || F(row, 'ntn');
        var obStr   = F(row, 'openingbalance') || F(row, 'balance') || F(row, 'opening');
        var ob      = parseFloat(obStr) || 0;

        if (type === 'customer') {
          if (existingCustNames.indexOf(name.toLowerCase()) !== -1) {
            skipped.push({ row: rowNum, name: name, type: 'customer', reason: 'Customer already exists' }); return;
          }
          existingCustNames.push(name.toLowerCase());
          // FIX (root cause, audit #61-64): was randomUUID-or-Date.now+random, a
          // 3rd/4th competing scheme alongside parties.js's identical pattern
          // and everything else. Route through the one canonical generator.
          var uid = ERP.uid();
          toAddCust.push({
            id:           uid,
            n:            name,
            ph:           phone,
            veh:          vehicle,
            addr:         address,
            email:        email,
            gstin:        gstin,
            bday:         null,
            creditLimit:  0,
            sales:        0,
            credit:       0,
            pts:          0,
            openingBal:   ob,
            importedFrom: 'csv',
            created:      _serverNowISO()
          });
        } else {
          if (existingSupNames.indexOf(name.toLowerCase()) !== -1) {
            skipped.push({ row: rowNum, name: name, type: 'supplier', reason: 'Supplier already exists' }); return;
          }
          existingSupNames.push(name.toLowerCase());
          toAddSup.push({
            id:           ERP.uid(), // FIX (root cause, audit #61-64): was randomUUID-or-Date.now+random; route through the one canonical generator.
            n:            name,
            ph:           phone,
            phone:        phone,
            addr:         address,
            address:      address,
            city:         address,
            email:        email,
            gstin:        gstin,
            owe:          Math.max(0, ob),
            openingBal:   ob,
            purchases:    0,
            importedFrom: 'csv',
            created:      _serverNowISO()
          });
        }
      });

      var totalAdd = toAddCust.length + toAddSup.length;

      if (totalAdd === 0 && errors.length === 0) {
        _importingParties = false;
        _toast('⚠️ All rows already exist — nothing to import.', 'warning'); return;
      }

      var previewHtml = _buildPartyPreviewHTML(filename, toAddCust, toAddSup, skipped, errors);

      _modal.open(
        previewHtml,
        '👥 Import Parties Preview — ' + filename,
        totalAdd ? function () { _commitParties(toAddCust, toAddSup); } : null,
        '✅ Import ' + totalAdd + ' Part' + (totalAdd !== 1 ? 'ies' : 'y'),
        'btn-primary'
      );
    });
  }

  function _buildPartyPreviewHTML(filename, custs, sups, skipped, errors) {
    var totalAdd = custs.length + sups.length;
    var html = '';

    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">'
      + '<span style="background:#dcfce7;color:#15803d;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700">✅ ' + custs.length + ' customer' + (custs.length !== 1 ? 's' : '') + '</span>'
      + '<span style="background:#dbeafe;color:#4338CA;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700">🏭 ' + sups.length + ' supplier' + (sups.length !== 1 ? 's' : '') + '</span>'
      + (skipped.length ? '<span style="background:#fef9c3;color:#854d0e;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700">⚠️ ' + skipped.length + ' skipped</span>' : '')
      + (errors.length  ? '<span style="background:#fee2e2;color:#b91c1c;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700">❌ ' + errors.length + ' errors</span>' : '')
      + '</div>';

    function _partyTable(list, label, color) {
      if (!list.length) return '';
      return '<div style="margin-bottom:14px"><div style="font-size:12px;font-weight:700;color:var(--muted,#64748b);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">' + label + '</div>'
        + '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">'
        + '<thead><tr style="background:var(--bg,#f8fafc)">'
        + '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border-l,#e2e8f0)">Name</th>'
        + '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border-l,#e2e8f0)">Phone</th>'
        + '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border-l,#e2e8f0)">Address</th>'
        + '<th style="text-align:right;padding:6px 8px;border-bottom:1px solid var(--border-l,#e2e8f0)">Opening Bal</th>'
        + '</tr></thead><tbody>'
        + list.map(function (p) {
          var ob = p.openingBal || 0;
          var obColor = ob > 0 ? '#ef4444' : ob < 0 ? '#16a34a' : 'inherit';
          // FIX (root cause, audit #75): magnitude formatting was a hardcoded
          // 'Rs.' duplicate of ERP.fmt(); the Dr/Cr suffix convention (this
          // file's own accounting-sign display, distinct from parens-negative
          // used elsewhere) is preserved untouched.
          var _fmtAmt = function (v) { return (window.ERP && typeof window.ERP.fmt === 'function') ? window.ERP.fmt(v) : 'Rs.' + v.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
          var obText  = ob > 0 ? _fmtAmt(ob) + ' Dr' : ob < 0 ? _fmtAmt(Math.abs(ob)) + ' Cr' : '\u2014';
          return '<tr style="border-bottom:1px solid var(--border-l,#f1f5f9)">'
            + '<td style="padding:5px 8px;font-weight:600">' + _e(p.n) + '</td>'
            + '<td style="padding:5px 8px">' + _e(p.ph || p.phone || '—') + '</td>'
            + '<td style="padding:5px 8px;color:var(--muted,#64748b)">' + _e(p.addr || p.address || '—') + '</td>'
            + '<td style="padding:5px 8px;text-align:right;font-weight:600;color:' + obColor + '">' + obText + '</td>'
            + '</tr>';
        }).join('')
        + '</tbody></table></div></div>';
    }

    html += _partyTable(custs, 'Customers to be imported', '#16a34a');
    html += _partyTable(sups,  'Suppliers to be imported', '#4338CA');

    if (skipped.length) {
      html += '<div style="margin-bottom:14px"><div style="font-size:12px;font-weight:700;color:var(--muted,#64748b);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Skipped rows</div>'
        + '<div style="background:#fefce8;border:1px solid #fef08a;border-radius:8px;padding:10px 14px">';
      skipped.forEach(function (s) {
        html += '<div style="font-size:12px;margin-bottom:4px"><b>Row ' + s.row + ' [' + s.type + ']:</b> ' + _e(s.name || '—') + ' — <i>' + _e(s.reason) + '</i></div>';
      });
      html += '</div></div>';
    }

    if (errors.length) {
      html += '<div style="margin-bottom:14px"><div style="font-size:12px;font-weight:700;color:var(--muted,#64748b);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Error rows</div>'
        + '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px">';
      errors.forEach(function (e) {
        html += '<div style="font-size:12px;margin-bottom:4px"><b>Row ' + e.row + ':</b> ' + _e(e.name || '—') + ' — <i>' + _e(e.reason) + '</i></div>';
      });
      html += '</div></div>';
    }

    html += '<div style="margin-top:14px;padding:10px 14px;background:var(--bg,#f8fafc);border-radius:8px;font-size:11px;color:var(--muted,#64748b)">'
      + '💡 Template columns: <b>Name, Phone, Type (customer|supplier), Address, Email, Vehicle, GSTIN, OpeningBalance</b>. '
      + 'Use <b>Export Parties</b> to download an example.'
      + '</div>';

    return html;
  }

  function _commitParties(toAddCust, toAddSup) {
    _st(function (s) {
      s.data.customers      = s.data.customers  || [];
      s.data.suppliers      = s.data.suppliers  || [];
      s.data.customerLedger = s.data.customerLedger || [];

      toAddCust.forEach(function (c) {
        var entry = Object.assign({}, c);
        delete entry.openingBal;
        s.data.customers.push(Object.assign(entry, { sales: 0, credit: 0, pts: 0 }));
      });

      toAddSup.forEach(function (s_) {
        var entry = Object.assign({}, s_);
        delete entry.openingBal;
        s.data.suppliers.push(entry);
      });
    }, 'parties:import');

    var saves = [
      _persistArr('customers', _gs().data.customers || []),
      _persistArr('suppliers', _gs().data.suppliers || [])
    ];

    var pe       = window.ERP && (ERP.PostingEngine || (ERP.getModule && ERP.getModule('PostingEngine'))) || null;
    var today    = _todayDateStr();
    var glFailed = [];

    function _postCustomerOB(c) {
      var ob = c.openingBal || 0;
      if (ob === 0) return Promise.resolve();
      var custId = String(c.id || c.n || '');
      var obPaisa = Math.round(Math.abs(ob) * 100);
      if (!pe || typeof pe.post !== 'function') { glFailed.push(c.n); return Promise.resolve(); }
      return pe.post({
        documentId:   'OB-CUST-' + custId,
        documentType: 'OPENING_BALANCE',
        date:         today,
        description:  'Opening balance (CSV import): ' + c.n,
        entries: ob > 0
          ? [{ accountId: SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE, debit: obPaisa, credit: 0, description: 'Customer OB: ' + c.n },
             { accountId: SYSTEM_ACCOUNTS.OWNER_EQUITY, debit: 0, credit: obPaisa, description: 'Equity offset' }]
          : [{ accountId: SYSTEM_ACCOUNTS.OWNER_EQUITY, debit: obPaisa, credit: 0, description: 'Equity offset' },
             { accountId: SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE, debit: 0, credit: obPaisa, description: 'Customer advance: ' + c.n }]
      }).then(function () {
        if (!ERP._Ledger || !ERP._Ledger.createOpeningBalance) return;
        var obEntry = ERP._Ledger.createOpeningBalance(custId, ob);
        _st(function (s) { s.data.customerLedger.push(obEntry); }, 'parties:import:cust-ob:' + custId);
      }).catch(function (e) {
        console.error('[ERP import parties] customer OB GL post failed:', c.n, e);
        glFailed.push(c.n);
      });
    }

    function _postSupplierOB(s_) {
      var ob = s_.openingBal || 0;
      if (ob === 0) return Promise.resolve();
      var supKey = String(s_.n || '').toLowerCase().trim();
      var obPaisa = Math.round(Math.abs(ob) * 100);
      if (!pe || typeof pe.post !== 'function') { glFailed.push(s_.n); return Promise.resolve(); }
      return pe.post({
        documentId:   'OB-SUP-' + supKey,
        documentType: 'OPENING_BALANCE',
        date:         today,
        description:  'Opening balance (CSV import): ' + s_.n,
        entries: ob > 0
          ? [{ accountId: SYSTEM_ACCOUNTS.OWNER_EQUITY, debit: obPaisa, credit: 0, description: 'Equity offset' },
             { accountId: SYSTEM_ACCOUNTS.ACCOUNTS_PAYABLE, debit: 0, credit: obPaisa, description: 'Supplier OB: ' + s_.n }]
          : [{ accountId: SYSTEM_ACCOUNTS.ACCOUNTS_PAYABLE, debit: obPaisa, credit: 0, description: 'Supplier advance: ' + s_.n },
             { accountId: SYSTEM_ACCOUNTS.OWNER_EQUITY, debit: 0, credit: obPaisa, description: 'Equity offset' }]
      }).then(function () {
        var ps = window.PurchaseState;
        if (!ps || typeof ps.writeLedgerEntry !== 'function') return;
        ps.writeLedgerEntry({
          supplierId:  supKey,
          type:        'OPENING_BALANCE',
          debit:       ob < 0 ? obPaisa : 0,
          credit:      ob > 0 ? obPaisa : 0,
          referenceId: 'OB-SUP-' + supKey,
          date:        today,
          note:        'Opening balance (CSV import)'
        });
      }).catch(function (e) {
        console.error('[ERP import parties] supplier OB GL post failed:', s_.n, e);
        glFailed.push(s_.n);
      });
    }

    Promise.all(saves)
      .then(function () {
        var obPosts = toAddCust.map(_postCustomerOB).concat(toAddSup.map(_postSupplierOB));
        return Promise.all(obPosts);
      })
      .then(function () {
        return _persistArr('customerLedger', _gs().data.customerLedger || []);
      })
      .then(function () {
        _importingParties = false;
        ERP.events.emit('customers:updated');
        ERP.events.emit('suppliers:updated');
        var msg = [];
        if (toAddCust.length) msg.push(toAddCust.length + ' customer' + (toAddCust.length !== 1 ? 's' : ''));
        if (toAddSup.length)  msg.push(toAddSup.length  + ' supplier' + (toAddSup.length  !== 1 ? 's' : ''));
        _toast('✅ Imported: ' + msg.join(', '), 'success', 4000);
        if (glFailed.length) {
          _toast('⚠️ Opening balance GL posting failed for: ' + glFailed.join(', ') + '. Balances saved but not in GL — fix manually.', 'error', 9000);
        }
      })
      .catch(function (e) {
        _importingParties = false;
        console.error('[ERP import parties] DB save failed:', e);
        _toast('⚠️ Parties added in memory but DB save failed. Please backup!', 'warning', 5000);
        ERP.events.emit('customers:updated');
        ERP.events.emit('suppliers:updated');
      });
  }

  function exportParties() {
    var custs = _custs();
    var sups  = _sups();

    if (!custs.length && !sups.length) {
      _toast('No parties to export.', 'warning'); return;
    }

    var header = ['Name', 'Phone', 'Type', 'Address', 'Email', 'Vehicle', 'GSTIN', 'OpeningBalance', 'LoyaltyPoints', 'Status'];
    var rows   = [header];

    custs.forEach(function (c) {
      var ob = c.openingBal || 0;
      rows.push([
        c.n || '', c.ph || '', 'customer',
        c.addr || c.address || '',
        c.email || '', c.veh || '', c.gstin || '', ob,
        c.pts || 0, 'Active'
      ]);
    });

    sups.forEach(function (s) {
      rows.push([
        s.n || '', s.ph || s.phone || '', 'supplier',
        s.addr || s.address || s.city || '',
        s.email || '', '', s.gstin || '', s.owe || 0,
        0, 'Active'
      ]);
    });

    _CSV.download('parties-export-' + _dateStamp() + '.csv', rows);
    _toast('✅ ' + (custs.length + sups.length) + ' parties exported.', 'success');
  }

  function downloadItemTemplate() {
    _CSV.download('items-import-template.csv', [[
      'Name', 'Barcode', 'SKU', 'Category', 'SalePrice', 'PurchasePrice',
      'Stock', 'MinStock', 'Unit', 'MRP', 'Tax%', 'HSN', 'Location', 'Description'
    ], [
      'Engine Oil Filter 10W40', '', 'EF-001', 'Filters', '850', '600',
      '50', '5', 'PCS', '900', '0', '', 'A-12', 'Heavy duty oil filter'
    ]]);
    _toast('📄 Items template downloaded.', 'info');
  }

  function downloadPartyTemplate() {
    _CSV.download('parties-import-template.csv', [[
      'Name', 'Phone', 'Type', 'Address', 'Email', 'Vehicle', 'GSTIN', 'OpeningBalance'
    ], [
      'Ali Motors', '0300-1234567', 'customer', 'Lahore', 'ali@example.com', 'Toyota Corolla 2020', '', '5000'
    ], [
      'Punjab Auto Parts', '0321-9876543', 'supplier', 'Faisalabad', 'parts@punjab.com', '', '', '15000'
    ]]);
    _toast('📄 Parties template downloaded.', 'info');
  }

  function _dateStamp() {
    return _todayDateStr();
  }

  ERP.importExport = {
    importItems:           importItems,
    exportItems:           exportItems,
    importParties:         importParties,
    exportParties:         exportParties,
    downloadItemTemplate:  downloadItemTemplate,
    downloadPartyTemplate: downloadPartyTemplate
  };

  function _renderImportItemsPage() {
    var pv = document.getElementById('pv-import-items');
    if (!pv) return;

    pv.innerHTML =
      '<div style="max-width:640px;margin:0 auto;padding:8px 0">'
      + '<div style="margin-bottom:18px">'
      + '<div style="font-size:18px;font-weight:700;color:var(--text,#1e293b)">📥 Import Items</div>'
      + '<div style="font-size:13px;color:var(--muted,#64748b);margin-top:4px">CSV file se inventory items bulk import karein. Pehle template download karein, fill karein, phir upload karein.</div>'
      + '</div>'
      + '<div class="panel" style="padding:18px 20px">'
      + '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px">'
      + '<button class="btn btn-primary" id="ie-btn-import-items">📂 Choose CSV &amp; Import</button>'
      + '<button class="btn btn-ghost" id="ie-btn-template-items">📄 Download Template</button>'
      + '</div>'
      + '<div style="background:#dbeafe;border:1px solid #93c5fd;border-radius:10px;padding:12px 16px;font-size:12px;color:#4338CA">'
      + '💡 Required columns: <b>Name</b>, <b>SalePrice</b>. Optional: Barcode, SKU, Category, PurchasePrice, Stock, MinStock, Unit, MRP, Tax%, HSN, Location, Description. Agar Name pehle se inventory mein maujood ho to wo row skip ho jayegi.'
      + '</div>'
      + '</div>'
      + '</div>';

    var importBtn = document.getElementById('ie-btn-import-items');
    if (importBtn) importBtn.addEventListener('click', function () {
      if (ERP.importExport && ERP.importExport.importItems) ERP.importExport.importItems();
    });

    var templateBtn = document.getElementById('ie-btn-template-items');
    if (templateBtn) templateBtn.addEventListener('click', function () {
      if (ERP.importExport && ERP.importExport.downloadItemTemplate) ERP.importExport.downloadItemTemplate();
    });
  }

  if (typeof ERP.registerRenderer === 'function') {
    ERP.registerRenderer('import-items', _renderImportItemsPage);
  }

  function _renderExportItemsPage() {
    var pv = document.getElementById('pv-export-items');
    if (!pv) return;

    var count = _inv().length;

    pv.innerHTML =
      '<div style="max-width:640px;margin:0 auto;padding:8px 0">'
      + '<div style="margin-bottom:18px">'
      + '<div style="font-size:18px;font-weight:700;color:var(--text,#1e293b)">📤 Export Items</div>'
      + '<div style="font-size:13px;color:var(--muted,#64748b);margin-top:4px">Apni saari inventory ek CSV file mein download karein (backup, sharing, ya Excel mein dekhne ke liye).</div>'
      + '</div>'
      + '<div class="panel" style="padding:18px 20px">'
      + '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:14px">'
      + '<button class="btn btn-primary" id="ie-btn-export-items">📤 Export ' + count + ' Item' + (count !== 1 ? 's' : '') + '</button>'
      + '</div>'
      + '<div style="background:#dbeafe;border:1px solid #93c5fd;border-radius:10px;padding:12px 16px;font-size:12px;color:#4338CA">'
      + '💡 CSV mein Name, Barcode, SKU, Category, SalePrice, PurchasePrice, Stock, MinStock, Unit, MRP, Tax%, HSN, Location, Description, StockStatus, StockValue aur ImportedAt shamil honge.'
      + '</div>'
      + '</div>'
      + '</div>';

    var exportBtn = document.getElementById('ie-btn-export-items');
    if (exportBtn) exportBtn.addEventListener('click', function () {
      if (ERP.importExport && ERP.importExport.exportItems) ERP.importExport.exportItems();
    });
  }

  if (typeof ERP.registerRenderer === 'function') {
    ERP.registerRenderer('export-items', _renderExportItemsPage);
  }

  function _renderImportPartiesPage() {
    var pv = document.getElementById('pv-import-parties');
    if (!pv) return;

    pv.innerHTML =
      '<div style="max-width:640px;margin:0 auto;padding:8px 0">'
      + '<div style="margin-bottom:18px">'
      + '<div style="font-size:18px;font-weight:700;color:var(--text,#1e293b)">📥 Import Parties</div>'
      + '<div style="font-size:13px;color:var(--muted,#64748b);margin-top:4px">CSV file se Customers aur Suppliers bulk import karein. Pehle template download karein, fill karein, phir upload karein.</div>'
      + '</div>'
      + '<div class="panel" style="padding:18px 20px">'
      + '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px">'
      + '<button class="btn btn-primary" id="ie-btn-import-parties">📂 Choose CSV &amp; Import</button>'
      + '<button class="btn btn-ghost" id="ie-btn-template-parties">📄 Download Template</button>'
      + '</div>'
      + '<div style="background:#dbeafe;border:1px solid #93c5fd;border-radius:10px;padding:12px 16px;font-size:12px;color:#4338CA">'
      + '💡 Required columns: <b>Name</b>, <b>Type</b> (customer ya supplier). Optional: Phone, Address, Email, Vehicle, GSTIN, OpeningBalance. Same Name ek hi Type mein pehle se ho to wo row skip ho jayegi — ek hi CSV mein customers aur suppliers dono ho sakte hain (Type column se pehchana jayega).'
      + '</div>'
      + '</div>'
      + '</div>';

    var importBtn = document.getElementById('ie-btn-import-parties');
    if (importBtn) importBtn.addEventListener('click', function () {
      if (ERP.importExport && ERP.importExport.importParties) ERP.importExport.importParties();
    });

    var templateBtn = document.getElementById('ie-btn-template-parties');
    if (templateBtn) templateBtn.addEventListener('click', function () {
      if (ERP.importExport && ERP.importExport.downloadPartyTemplate) ERP.importExport.downloadPartyTemplate();
    });
  }

  if (typeof ERP.registerRenderer === 'function') {
    ERP.registerRenderer('import-parties', _renderImportPartiesPage);
  }

  function _retryImportGLBacklog() {
    var _gk = 'erp_import_gl_backlog';
    var _gb;
    try {
      _gb = JSON.parse(localStorage.getItem(_gk) || '[]');
    } catch (_parseErr) {
      console.error('[importExport] GL backlog read failed, treating as empty:', _parseErr);
      return;
    }
    if (!Array.isArray(_gb) || !_gb.length) return;
    if (!ERP.Ledger || !ERP.Ledger.StockLedger || typeof ERP.Ledger.StockLedger.postStockReceipt !== 'function') return;
    var remaining = [];
    var retried = 0;
    var promises = _gb.map(function(entry) {
      if (!entry || !entry.bc || !entry.costPaisa) { return Promise.resolve('skip'); }
      return ERP.Ledger.StockLedger.postStockReceipt({
        sourceId:    'IMPORT-' + entry.bc,
        amountPaisa: entry.costPaisa,
        date:        (entry.ts || _serverNowISO()).slice(0, 10),
        memo:        'Opening stock import (retry): ' + entry.bc,
        cash:        false
      }, 'system').then(function() {
        retried++;
      }).catch(function() {
        remaining.push(entry);
      });
    });
    Promise.all(promises).then(function() {
      try {
        if (remaining.length !== _gb.length) {
          localStorage.setItem(_gk, JSON.stringify(remaining));
        }
        if (retried > 0) {
          console.log('[importExport] GL backlog retry: ' + retried + ' item(s) posted successfully.');
        }
      } catch (_writeErr) {
        console.error('[importExport] failed to persist updated GL backlog:', _writeErr);
      }
    }).catch(function (_aggErr) {
      console.error('[importExport] GL backlog retry failed unexpectedly:', _aggErr);
    });
  }

  if (typeof window !== 'undefined') {
    var _prevIEHook = typeof window.onModuleLoginSuccess === 'function' ? window.onModuleLoginSuccess : null;
    window.onModuleLoginSuccess = function() {
      if (_prevIEHook) _prevIEHook();
      setTimeout(_retryImportGLBacklog, GL_BACKLOG_RETRY_DELAY_MS);
    };
  }

})(ERP);

window.ERP = ERP;
