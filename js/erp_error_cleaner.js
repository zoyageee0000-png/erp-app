
'use strict';

var ERPCleaner = (function () {


  function _gs() {
    return (window.ERP && window.ERP.getState) ? window.ERP.getState() : {};
  }

  function _st(fn, tag) {
    if (window.ERP && window.ERP.setState) window.ERP.setState(fn, tag);
  }

  function _toast(msg, type) {
    if (window.ERP && window.ERP.ui && window.ERP.ui.toast) {
      window.ERP.ui.toast(msg, type || 'info');
    } else {
      if(window.DEBUG_MODE)console.log('[ERPCleaner]', type || 'info', msg);
    }
  }

  function _save(key, dataOverride) {
    if (window.ERP && window.ERP._db) {
      var payload = dataOverride !== undefined ? dataOverride : (function () {
        var st = _gs();
        return st.data && st.data[key];
      })();
      // ARCHITECTURAL REFACTOR: array-type stores go through ERP.Persistence
      // (single choke point for all IndexedDB writes). Non-array records
      // (e.g. 'settings') are a genuinely different data shape this repair
      // tool can also touch, so they go straight to db.save — this is a
      // type-based branch, not a legacy-compatibility fallback.
      if (Array.isArray(payload)) {
        ERP.Persistence.save(key, payload, { retries: 1, silent: true }).catch(function (e) {
          console.warn('[ERPCleaner] save failed for', key, e);
        });
        return;
      }
      window.ERP._db.save(key, payload).catch(function (e) {
        console.warn('[ERPCleaner] save failed for', key, e);
      });
    }
  }

  function _isValidDate(str) {
    if (!str || typeof str !== 'string') return false;
    var d = new Date(str);
    return !isNaN(d.getTime());
  }

  var _report = [];
  var _fixCount = 0;
  var _skipCount = 0;

  function _log(category, issue, action, fixed) {
    _report.push({ category: category, issue: issue, action: action, fixed: fixed, ts: new Date().toISOString() });
    if (fixed) _fixCount++; else _skipCount++;
    if(window.DEBUG_MODE)console.log('[ERPCleaner][' + category + ']', fixed ? '✅ FIXED' : '⚠️ SKIP', '|', issue, '→', action);
  }


  function cleanAccounting() {
    var st = _gs();
    var acc = window.AccountingCore && window.AccountingCore.AccountingState;
    if (!acc) {
      _log('Accounting', 'AccountingState not loaded', 'Skipped — module not ready', false);
      return;
    }

    var journals = acc.getAllJournals ? acc.getAllJournals() : [];
    var badJournals = [];
    journals.forEach(function (j) {
      if (!j || !Array.isArray(j.entries)) {
        badJournals.push(j && j.id);
        return;
      }
      var dr = j.entries.reduce(function (s, e) { return s + (Number(e.debit)  || 0); }, 0);
      var cr = j.entries.reduce(function (s, e) { return s + (Number(e.credit) || 0); }, 0);
      if (Math.abs(dr - cr) > 1) {
        badJournals.push(j.id);
      }
    });
    if (badJournals.length) {
      _log('Accounting', 'Unbalanced journals: ' + badJournals.length + ' found', 'Flagged for review — auto-fix not safe for DR/CR', false);
    } else {
      _log('Accounting', 'Journal balance check', 'All journals balanced ✅', true);
    }

    var ledger = acc.getAllLedgerEntries ? acc.getAllLedgerEntries() : [];
    var journalIds = new Set(journals.map(function (j) { return j && j.id; }));
    var orphanLedger = ledger.filter(function (l) { return l && !journalIds.has(l.journalId); });
    if (orphanLedger.length) {
      _log('Accounting', 'Orphan ledger entries: ' + orphanLedger.length, 'Flagged — manual review needed', false);
    } else {
      _log('Accounting', 'Ledger orphan check', 'No orphan ledger entries ✅', true);
    }

    var missingAccId = journals.filter(function (j) {
      return j && Array.isArray(j.entries) && j.entries.some(function (e) { return !e.accountId; });
    });
    if (missingAccId.length) {
      _log('Accounting', 'Entries missing accountId: ' + missingAccId.length + ' journals', 'Flagged for review', false);
    } else {
      _log('Accounting', 'AccountId check', 'All entries have accountId ✅', true);
    }

    var jIdCounts = {};
    journals.forEach(function (j) { if (j && j.id) jIdCounts[j.id] = (jIdCounts[j.id] || 0) + 1; });
    var dupJournals = Object.keys(jIdCounts).filter(function (k) { return jIdCounts[k] > 1; });
    if (dupJournals.length) {
      _log('Accounting', 'Duplicate journal IDs: ' + dupJournals.join(', '), 'Flagged — de-duplicate manually', false);
    } else {
      _log('Accounting', 'Duplicate journal ID check', 'No duplicates ✅', true);
    }
  }


  function cleanSales() {
    var st = _gs();
    var rawSales = (st.data && st.data.sales) || window.sales || [];
    if (!rawSales.length) {
      _log('Sales', 'No sales data found', 'Nothing to clean', true);
      return;
    }

    var sales;
    try { sales = JSON.parse(JSON.stringify(rawSales)); }
    catch(e) { sales = rawSales.map(function(s){ try{ return JSON.parse(JSON.stringify(s)); }catch(_){ return s; } }); }

    var cleaned = [];
    var removed = 0;
    var fixed = 0;

    var invoiceNums = {};

    sales.forEach(function (s) {
      if (!s) { removed++; return; }

      var issues = [];

      if (!s.customer && !s.customerId && !s.party) {
        issues.push('missing customer');
      }

      if (s.grand !== undefined && (isNaN(Number(s.grand)) || Number(s.grand) < 0)) {
        s.grand = Math.abs(Number(s.grand) || 0);
        issues.push('negative total → fixed to ' + s.grand);
        fixed++;
      }

      if (Array.isArray(s.items) && s.items.length === 0) {
        issues.push('sale has zero items');
      }

      if (Array.isArray(s.items)) {
        s.items.forEach(function (item, idx) {
          if (item && (isNaN(Number(item.qty)) || Number(item.qty) <= 0)) {
            item.qty = 1;
            issues.push('item[' + idx + '] zero qty → fixed to 1');
            fixed++;
          }
          if (item && Number(item.price) < 0) {
            item.price = Math.abs(Number(item.price));
            issues.push('item[' + idx + '] negative price → fixed');
            fixed++;
          }
        });
      }

      if (s.date && !_isValidDate(s.date)) {
        s.date = (window.ERP && window.ERP.DateUtils && typeof window.ERP.DateUtils.today === 'function') ? window.ERP.DateUtils.today() : (function(){ var _d=new Date(); return _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0'); })();
        issues.push('invalid date → reset to today');
        fixed++;
      }

      if (s.invNo || s.invoiceNo) {
        var inv = s.invNo || s.invoiceNo;
        if (invoiceNums[inv]) {
          issues.push('duplicate invoice #' + inv);
        }
        invoiceNums[inv] = true;
      }

      if (s.discount !== undefined && Number(s.discount) < 0) {
        s.discount = 0;
        issues.push('negative discount → reset to 0');
        fixed++;
      }

      if (s.discount !== undefined && s.grand !== undefined) {
        if (Number(s.discount) > Number(s.grand)) {
          s.discount = 0;
          issues.push('discount > total → reset to 0');
          fixed++;
        }
      }

      if (issues.length) {
        _log('Sales', 'Sale #' + (s.invNo || s.id || '?') + ': ' + issues.join('; '), issues.some(function(i){ return i.includes('→'); }) ? 'Auto-fixed' : 'Flagged', issues.some(function(i){ return i.includes('→'); }));
      }

      cleaned.push(s);
    });

    if (removed > 0 || fixed > 0) {
      _st(function (state) {
        if (state.data) state.data.sales = cleaned;
      }, 'erp_cleaner:sales');
      _save('sales', cleaned);
      _log('Sales', 'Removed ' + removed + ' null entries, fixed ' + fixed + ' field errors', 'Applied to state', true);
    } else {
      _log('Sales', 'Sales data check', 'No auto-fixable errors found ✅', true);
    }
  }


  function cleanPurchases() {
    var st = _gs();
    var rawPurchases = (st.data && st.data.purchases) || [];
    if (!rawPurchases.length && window.PurchaseState && typeof window.PurchaseState.getAllPurchases === 'function') {
      rawPurchases = window.PurchaseState.getAllPurchases();
    }
    if (!rawPurchases.length) {
      _log('Purchase', 'No purchase data found', 'Nothing to clean', true);
      return;
    }

    var purchases;
    try { purchases = JSON.parse(JSON.stringify(rawPurchases)); }
    catch(e) { purchases = rawPurchases.map(function(p){ try{ return JSON.parse(JSON.stringify(p)); }catch(_){ return p; } }); }

    var cleaned = [];
    var removed = 0;
    var fixed = 0;
    var poNums = {};

    purchases.forEach(function (p) {
      if (!p) { removed++; return; }

      var issues = [];

      if (!p.vendor && !p.supplier && !p.party && !p.supplierId && !p.supplierName) {
        issues.push('missing vendor/supplier');
      }

      if (p.total !== undefined && (isNaN(Number(p.total)) || Number(p.total) < 0)) {
        p.total = Math.abs(Number(p.total) || 0);
        issues.push('negative total → fixed');
        fixed++;
      }

      if (p.date && !_isValidDate(p.date)) {
        p.date = (window.ERP && window.ERP.DateUtils && typeof window.ERP.DateUtils.today === 'function') ? window.ERP.DateUtils.today() : (function(){ var _d=new Date(); return _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0'); })();
        issues.push('invalid date → reset to today');
        fixed++;
      }

      if (p.poNo || p.orderNo || p.billNo) {
        var po = p.poNo || p.orderNo || p.billNo;
        if (poNums[po]) {
          issues.push('duplicate PO/Bill #' + po);
        }
        poNums[po] = true;
      }

      if (Array.isArray(p.items)) {
        p.items.forEach(function (item, idx) {
          if (item && (isNaN(Number(item.qty)) || Number(item.qty) <= 0)) {
            item.qty = 1;
            issues.push('item[' + idx + '] zero qty → fixed to 1');
            fixed++;
          }
          if (item && Number(item.rate) < 0) {
            item.rate = Math.abs(Number(item.rate));
            issues.push('item[' + idx + '] negative rate → fixed');
            fixed++;
          }
        });
      }

      if (issues.length) {
        _log('Purchase', 'PO #' + (p.poNo || p.billNo || p.id || '?') + ': ' + issues.join('; '), issues.some(function(i){ return i.includes('→'); }) ? 'Auto-fixed' : 'Flagged', issues.some(function(i){ return i.includes('→'); }));
      }

      cleaned.push(p);
    });

    if (removed > 0 || fixed > 0) {
      _st(function (state) {
        if (state.data) state.data.purchases = cleaned;
      }, 'erp_cleaner:purchases');
      _save('purchases', cleaned);
      _log('Purchase', 'Removed ' + removed + ' null entries, fixed ' + fixed + ' errors', 'Applied to state', true);
    } else {
      _log('Purchase', 'Purchase data check', 'No auto-fixable errors ✅', true);
    }
  }

  function cleanInventory() {
    var st = _gs();
    var inventory = (st.data && st.data.inventory) || window.inventory || [];
    if (!inventory.length) {
      _log('Inventory', 'No inventory data found', 'Nothing to clean', true);
      return;
    }

    var fixed = 0;
    var removed = 0;
    var barcodes = {};
    var cleaned = [];

    inventory.forEach(function (item) {
      if (!item) { removed++; return; }

      var issues = [];

      if (item.qty !== undefined && Number(item.qty) < 0) {
        item.qty = 0;
        issues.push('negative stock → reset to 0');
        fixed++;
      }

      if (!item.name && !item.desc && !item.description) {
        issues.push('missing item name — flagged');
      }

      if (item.price !== undefined && Number(item.price) < 0) {
        item.price = Math.abs(Number(item.price));
        issues.push('negative price → fixed');
        fixed++;
      }
      if (item.cost !== undefined && Number(item.cost) < 0) {
        item.cost = Math.abs(Number(item.cost));
        issues.push('negative cost → fixed');
        fixed++;
      }

      if (item.price !== undefined && item.cost !== undefined) {
        if (Number(item.price) < Number(item.cost)) {
          issues.push('sale price (' + item.price + ') below cost (' + item.cost + ') — flagged');
        }
      }

      if (item.barcode || item.bc) {
        var bc = item.barcode || item.bc;
        if (barcodes[bc]) {
          issues.push('duplicate barcode: ' + bc + ' — flagged');
        }
        barcodes[bc] = true;
      }

      if (item.reorder !== undefined && Number(item.reorder) < 0) {
        item.reorder = 0;
        issues.push('negative reorder level → reset to 0');
        fixed++;
      }

      if (issues.length) {
        _log('Inventory', 'Item [' + (item.name || item.bc || item.id || '?') + ']: ' + issues.join('; '), issues.some(function(i){ return i.includes('→'); }) ? 'Auto-fixed' : 'Flagged', issues.some(function(i){ return i.includes('→'); }));
      }

      cleaned.push(item);
    });

    if (removed > 0 || fixed > 0) {
      _st(function (state) {
        if (state.data) state.data.inventory = cleaned;
      }, 'erp_cleaner:inventory');
      _save('inventory', cleaned);
      _log('Inventory', 'Removed ' + removed + ' null entries, fixed ' + fixed + ' errors', 'Applied to state', true);
    } else {
      _log('Inventory', 'Inventory data check', 'No auto-fixable errors ✅', true);
    }
  }


  function cleanJobs() {
    var jobs = [];
    if (window.JobState && window.JobState.getAll) {
      jobs = window.JobState.getAll();
    } else {
      var st = _gs();
      jobs = (st.data && st.data.jobs) || window.jobs || [];
    }

    if (!jobs.length) {
      _log('Jobs', 'No job data found', 'Nothing to clean', true);
      return;
    }

    var VALID_STATUSES = ['pending', 'in-progress', 'waiting-parts', 'completed', 'delivered', 'cancelled'];
    var fixed = 0;
    var removed = 0;
    var cleaned = [];

    jobs.forEach(function (j) {
      if (!j) { removed++; return; }
      var issues = [];

      if (j.status && VALID_STATUSES.indexOf(j.status) === -1) {
        j.status = 'pending';
        issues.push('invalid status → reset to pending');
        fixed++;
      }

      if (!j.car && !j.vehicle && !j.vehicleName) {
        issues.push('missing vehicle info — flagged');
      }

      if (j.lab !== undefined && Number(j.lab) < 0) {
        j.lab = 0;
        issues.push('negative labour → 0');
        fixed++;
      }

      if (j.dis !== undefined && Number(j.dis) < 0) {
        j.dis = 0;
        issues.push('negative discount → reset to 0');
        fixed++;
      }

      if (j.dis !== undefined) {
        var partsTotal = Array.isArray(j.parts)
          ? j.parts.reduce(function (s, p) { return s + (Number(p.q) || 1) * (Number(p.p) || 0); }, 0)
          : 0;
        var total = partsTotal + (Number(j.lab) || 0);
        if (Number(j.dis) > total) {
          j.dis = 0;
          issues.push('discount > total → reset to 0');
          fixed++;
        }
      }

      if (Array.isArray(j.parts)) {
        j.parts.forEach(function (p, idx) {
          if (p && Number(p.p) < 0) {
            p.p = 0;
            issues.push('part[' + idx + '] negative price → 0');
            fixed++;
          }
          if (p && Number(p.q) <= 0) {
            p.q = 1;
            issues.push('part[' + idx + '] zero qty → 1');
            fixed++;
          }
        });
      }

      if (j.date && !_isValidDate(j.date)) {
        j.date = (window.ERP && window.ERP.DateUtils && typeof window.ERP.DateUtils.today === 'function') ? window.ERP.DateUtils.today() : (function(){ var _d=new Date(); return _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0'); })();
        issues.push('invalid date → today');
        fixed++;
      }

      if (issues.length) {
        _log('Jobs', 'Job #' + (j.id || '?') + ' [' + (j.car || j.vehicle || 'unknown') + ']: ' + issues.join('; '), issues.some(function(i){ return i.includes('→'); }) ? 'Auto-fixed' : 'Flagged', issues.some(function(i){ return i.includes('→'); }));
      }

      cleaned.push(j);
    });

    if (removed > 0 || fixed > 0) {
      if (window.JobState && window.JobState.setJobs) {
        window.JobState.setJobs(cleaned);
      }
      _st(function (state) {
        if (state.data) state.data.jobs = cleaned;
      }, 'erp_cleaner:jobs');
      _save('jobs', cleaned);
      _log('Jobs', 'Removed ' + removed + ' null entries, fixed ' + fixed + ' errors', 'Applied to state', true);
    } else {
      _log('Jobs', 'Job data check', 'No auto-fixable errors ✅', true);
    }
  }


  function cleanStockMovements() {
    var st = _gs();
    var movements = (st.data && st.data.stockMovements) || window.stockMovements || [];
    if (!movements.length) {
      _log('Stock', 'No stock movement data', 'Nothing to clean', true);
      return;
    }

    var VALID_TYPES = ['in', 'out', 'adjustment', 'return', 'transfer'];
    var fixed = 0;
    var removed = 0;
    var cleaned = movements.filter(function (m) {
      if (!m) { removed++; return false; }

      var issues = [];

      if (m.type && VALID_TYPES.indexOf(m.type) === -1) {
        var oldType = m.type;
        m.type = 'adjustment';
        issues.push('invalid type "' + oldType + '" → reset to adjustment');
        fixed++;
      }

      if (m.qty !== undefined && (isNaN(Number(m.qty)) || Number(m.qty) < 0)) {
        var oldQty = m.qty;
        m.qty = Math.abs(Number(m.qty) || 0);
        issues.push('invalid/negative qty (' + oldQty + ') → fixed to ' + m.qty);
        fixed++;
      }

      if (issues.length) {
        _log('Stock', 'Movement [' + (m.id || m.refId || '?') + ']: ' + issues.join('; '), 'Auto-fixed', true);
      }

      if (m.qty !== undefined && Number(m.qty) === 0) {
        _log('Stock', 'Movement [' + (m.id || m.refId || '?') + ']: zero qty', 'Removed — zero-quantity movement carries no stock effect', true);
        removed++;
        fixed++;
        return false;
      }

      return true;
    });

    if (fixed > 0 || removed > 0) {
      _st(function (state) {
        if (state.data) state.data.stockMovements = cleaned;
      }, 'erp_cleaner:stockMovements');
      _save('stockMovements', cleaned);
      _log('Stock', 'Fixed ' + fixed + ', removed ' + removed + ' invalid stock movements', 'Applied', true);
    } else {
      _log('Stock', 'Stock movement check', 'All movements valid ✅', true);
    }
  }


  
  function runAll() {
    try {
      var txPending = localStorage.getItem('mh_erp_tx_pending');
      if (txPending) {
        var pendingData = JSON.parse(txPending);
        var age = Date.now() - (pendingData.ts || 0);
        if (age < 30000) {
          _toast('⛔ Cannot clean: a transaction is in-flight. Wait and retry.', 'error');
          return Promise.resolve({ report: [], fixed: 0, flagged: 0, total: 0, summary: 'Aborted — transaction in-flight.' });
        }
        localStorage.removeItem('mh_erp_tx_pending');
      }
    } catch (e) {
      console.warn('[ERPCleaner] runAll: tx-pending check failed:', e && e.message || e);
    }

    var hasGuard = !!(window.ERP && ERP.ConcurrencyGuard && typeof ERP.ConcurrencyGuard.acquireLock === 'function');
    var lockPromise = hasGuard
      ? ERP.ConcurrencyGuard.acquireLock('erp_cleaner_runAll').catch(function (e) {
          console.warn('[ERPCleaner] runAll: acquireLock threw:', e && e.message || e);
          return { acquired: false, lockId: null, error: 'LOCK_EXCEPTION' };
        })
      : Promise.resolve({ acquired: true, lockId: 'passthrough', error: null });

    return lockPromise.then(function (lockResult) {
      if (!lockResult || !lockResult.acquired) {
        _toast('⛔ Cannot clean: another tab holds the write lock.', 'error');
        return { report: [], fixed: 0, flagged: 0, total: 0, summary: 'Aborted — could not acquire write lock.' };
      }

      var lockId = lockResult.lockId;

      try {
        _report   = [];
        _fixCount  = 0;
        _skipCount = 0;

        if (window.DEBUG_MODE) console.log('[ERPCleaner] 🧹 Starting full ERP error scan...');
        cleanAccounting();
        cleanSales();
        cleanPurchases();
        cleanInventory();
        cleanJobs();
        cleanStockMovements();

        try {
          if (_fixCount > 0 && window.AuditTrail && typeof AuditTrail.record === 'function') {
            AuditTrail.record('erp_cleaner', 'runAll', 'auto_fix',
              null,
              { fixed: _fixCount, flagged: _skipCount, summary: _report.map(function(r){ return r.msg || r; }) },
              (window._currentUser || 'System'));
          }
        } catch (e) {
          console.warn('[ERPCleaner] runAll: audit record failed:', e && e.message || e);
        }

        var result = {
          report:   _report,
          fixed:    _fixCount,
          flagged:  _skipCount,
          total:    _report.length,
          summary:  '[ERPCleaner] Done. Fixed: ' + _fixCount + ' | Flagged for review: ' + _skipCount + ' | Total checks: ' + _report.length
        };

        if (window.DEBUG_MODE) console.log(result.summary);
        _toast('✅ Error scan complete — Fixed: ' + _fixCount + ', Flagged: ' + _skipCount, _fixCount > 0 ? 'success' : 'info');

        return result;
      } finally {
        try {
          if (hasGuard && lockId) {
            ERP.ConcurrencyGuard.releaseLock(lockId);
          }
        } catch (e) {
          console.warn('[ERPCleaner] runAll: releaseLock failed:', e && e.message || e);
        }
      }
    });
  }

  function getReport() { return _report.slice(); }

  return {
    runAll:       runAll,
    getReport:    getReport,
    cleanAccounting:    cleanAccounting,
    cleanSales:         cleanSales,
    cleanPurchases:     cleanPurchases,
    cleanInventory:     cleanInventory,
    cleanJobs:          cleanJobs,
    cleanStockMovements: cleanStockMovements,
  };

})();

window.ERPCleaner = ERPCleaner;
