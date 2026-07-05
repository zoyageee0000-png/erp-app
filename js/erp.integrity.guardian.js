
'use strict';

(function (root) {
  'use strict';

  if (root.ERP && root.ERP.__p11_guardian) return;

  var ERP = root.ERP = root.ERP || {};


  function _try(fn, fallback, tag) {
    try { return fn(); }
    catch (e) {
      if (root.DEBUG_MODE || root._mhDebug)
        console.warn('[ERP.Guardian][' + (tag || '?') + '] ' + (e && e.message || e));
      return (typeof fallback === 'function') ? fallback(e)
           : (fallback !== undefined ? fallback : null);
    }
  }

  function _now() { return new Date().toISOString(); }

  function _getLocalStorageBytes() {
    var totalBytes = 0;
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k === null || k === undefined) continue;
      var v = localStorage.getItem(k) || '';
      totalBytes += (k.length + v.length) * 2;
    }
    return totalBytes;
  }

  function _logger() {
    return root.Logger || ERP.Logger || {
      info:  function (m) { if (root.DEBUG_MODE) console.info(m); },
      warn:  function (m) { console.warn(m); },
      error: function (m) { console.error(m); }
    };
  }

  function _audit(action, detail) {
    _try(function () {
      if (root.AuditTrail && typeof root.AuditTrail.record === 'function') {
        root.AuditTrail.record('integrity_guardian', 'system', action, detail, null, 'ERP.Guardian');
      }
    }, null, '_audit');
  }

  function _auditPermission(action, detail) {
    _try(function () {
      if (root.AuditTrail && typeof root.AuditTrail.record === 'function') {
        root.AuditTrail.record('permission_audit', 'system', action, detail, null, 'ERP.Guardian');
      }
    }, null, '_auditPermission');
  }

  function _emit(event, payload) {
    _try(function () {
      if (ERP.EventBus && typeof ERP.EventBus.emit === 'function') {
        ERP.EventBus.emit(event, payload || {});
      } else if (root.EventBus && typeof root.EventBus.emit === 'function') {
        root.EventBus.emit(event, payload || {});
      }
    }, null, '_emit:' + event);
  }

  function _on(event, handler) {
    _try(function () {
      if (ERP.EventBus && typeof ERP.EventBus.on === 'function') {
        ERP.EventBus.on(event, handler);
      } else if (root.EventBus && typeof root.EventBus.on === 'function') {
        root.EventBus.on(event, handler);
      }
    }, null, '_on:' + event);
  }

  function _toast(msg, type, duration) {
    _try(function () {
      if (ERP.ui && typeof ERP.ui.toast === 'function') {
        ERP.ui.toast(msg, type || 'warning', duration !== undefined ? duration : 8000);
      } else {
        console.warn('[ERP.Guardian][TOAST] ' + msg);
      }
    }, null, '_toast');
  }

  function _disableFlag(flagKey, reason) {
    _try(function () {
      if (!ERP.FeatureFlags || typeof ERP.FeatureFlags.set !== 'function') return;
      var SAFE = ['storage_guardian', 'audit_archive', 'backup_engine', 'backup_reminder'];
      if (SAFE.indexOf(flagKey) !== -1) return;
      ERP.FeatureFlags.set(flagKey, false);
      _audit('FLAG_DISABLED', { flag: flagKey, reason: reason });
      _logger().error('[ERP.Guardian] Flag disabled: ' + flagKey + ' — ' + reason);
    }, null, '_disableFlag:' + flagKey);
  }

  function _quarantine(storeName, payload) {
    _try(function () {
      var key = 'mh_quarantine_' + storeName;
      var existing = _try(function () {
        return JSON.parse(localStorage.getItem(key) || '[]');
      }, [], '_quarantine.read');
      if (!Array.isArray(existing)) existing = [];
      existing.push({ ts: _now(), payload: payload });
      if (existing.length > 20) existing = existing.slice(-20);
      localStorage.setItem(key, JSON.stringify(existing));
      _logger().error('[ERP.Guardian] Quarantine snapshot written: ' + key);
    }, null, '_quarantine:' + storeName);
  }

  // This was the most robust of the 5 duplicate parsers (accounting-notation
  // aware), so its logic became the canonical ACC.Money.toPaisa
  // (accounting_constants.js). Delegate here so there's only one copy left.
  // Guard moved from module-load-time to call-time: a load-time throw here
  // would crash this entire file (and everything after it in the script
  // order) if it were ever loaded before accounting_constants.js, instead
  // of failing only the one operation that actually needed money parsing.
  function _acc() {
    var ACC = root.AccountingCore;
    if (!ACC || !ACC.Money) throw new Error('[ERP.Guardian] ACC.Money missing. Load accounting_constants.js first.');
    return ACC;
  }
  function _toPaisa(v) {
    return _acc().Money.toPaisa(v);
  }


  var _incidents = [];
  var _incidentCounter = 0;

  function _recordIncident(domain, severity, title, detail, autoAction) {
    var inc = {
      id:         'INC-' + Date.now() + '-' + (++_incidentCounter).toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase(),
      ts:         _now(),
      domain:     domain,
      severity:   severity,
      title:      title,
      detail:     detail || {},
      autoAction: autoAction || null,
      acknowledged: false
    };
    _incidents.push(inc);
    if (_incidents.length > 200) _incidents = _incidents.slice(-200);

    _audit('INCIDENT_RECORDED', { id: inc.id, domain: domain, severity: severity, title: title });
    _emit('integrity:failure', { incident: inc });

    if (severity === 'CRITICAL') {
      _logger().error('[ERP.Guardian][CRITICAL] ' + domain + ': ' + title);
    } else {
      _logger().warn('[ERP.Guardian][' + severity + '] ' + domain + ': ' + title);
    }
    return inc;
  }


  var _wiredOnce = {};

  function _wireOnce(name, fn) {
    if (_wiredOnce[name]) return;
    _wiredOnce[name] = true;
    fn();
  }

  var _persistentState = {
    drCr: false,
    stockGl: false,
    bug001: false,
    storageSizeCritical: false,
    jsonCorruptKeys: {},
    envStatic: { localStorage: null, idb: null, bc: null, privateMode: null },
    auditArchiveCooldownUntil: 0,
    storageCriticalBackupCooldownUntil: 0,
    gstState: {},
    yearEndState: {}
  };

  var _config = {
    financialCheckIntervalMs:  30 * 60 * 1000,
    storageAlertThresholdBytes: 4.5 * 1024 * 1024,
    auditArchiveTriggerCount:  400,
    backupReminderDays:        1,
    backupEscalateDays:        7,
    gstWarningDays:            5,
    txRollbackFloodCount:      3,
    txRollbackFloodWindowMs:   60 * 1000,
    perfThresholdMs:           3000,
    perfCriticalMultiplier:    2,
    yearEndMonth:              6,
    yearEndDay:                30,
    yearEndWarnDays:           14,
    knownBugPattern:           'STOCK-RCV-P5-'
  };


  function _checkFinancialIntegrity() {
    _try(function () {
      var log = _logger();
      log.info('[ERP.Guardian] Financial integrity check starting...');

      _try(function () {
        if (!ERP.Ledger || !ERP.Ledger.GeneralLedger || typeof ERP.Ledger.GeneralLedger.isBalanced !== 'function') return;
        var result = ERP.Ledger.GeneralLedger.isBalanced();
        if (!result || typeof result !== 'object' || result.balanced !== true) {
          var diff = Math.abs((result && result.difference) || 0);
          var inc = _recordIncident('FINANCIAL_INTEGRITY', 'CRITICAL',
            'Journal imbalance detected: DR ≠ CR',
            { totalDebit: result && result.totalDebit, totalCredit: result && result.totalCredit, differencePaisa: diff }
          );
          if (!_persistentState.drCr) {
            _persistentState.drCr = true;
            _disableFlag('shadow_sales',    'FINANCIAL_IMBALANCE — DR≠CR');
            _disableFlag('shadow_reports',  'FINANCIAL_IMBALANCE — DR≠CR');
            _quarantine('journals', { type: 'dr_cr_mismatch', diff: diff, ts: _now() });
            _toast('🚨 CRITICAL: Journal imbalance detected (DR≠CR). ID: ' + inc.id, 'error', 0);
          }
        } else {
          _persistentState.drCr = false;
        }
      }, null, 'fin.dr_cr');

      _try(function () {
        if (!ERP.Ledger || typeof ERP.Ledger.getAccountBalance !== 'function') return;
        if (!ERP.Inventory || typeof ERP.Inventory.getValuation !== 'function') return;
        var glInventoryPaisa = ERP.Ledger.getAccountBalance('acc-1200');
        if (typeof glInventoryPaisa !== 'number' || isNaN(glInventoryPaisa)) return;
        var valuation    = ERP.Inventory.getValuation(null);
        var physicalPaisa = valuation && typeof valuation.totalPaisa === 'number' ? valuation.totalPaisa : null;
        if (physicalPaisa === null) return;
        if (glInventoryPaisa === 0 && physicalPaisa > 0) {
          _recordIncident('FINANCIAL_INTEGRITY', 'WARNING',
            'Physical stock has value but GL Inventory Asset (acc-1200) is zero — ledger may not have been initialised',
            { glInventoryPaisa: glInventoryPaisa, physicalPaisa: physicalPaisa }
          );
          return;
        }
        var drift = Math.abs(glInventoryPaisa - physicalPaisa);
        if (drift > 100) {
          _recordIncident('FINANCIAL_INTEGRITY', 'CRITICAL',
            'Stock ledger ≠ GL Inventory Asset (acc-1200)',
            { glInventoryPaisa: glInventoryPaisa, physicalPaisa: physicalPaisa, driftPaisa: drift }
          );
          if (!_persistentState.stockGl) {
            _persistentState.stockGl = true;
            _quarantine('inventory', { gl: glInventoryPaisa, physical: physicalPaisa, drift: drift, ts: _now() });
            _toast('🚨 Stock GL drift detected. Run ERPCleaner.runAll() to investigate.', 'error', 0);
          }
        } else {
          _persistentState.stockGl = false;
        }
      }, null, 'fin.stock_gl');

      _try(function () {
        if (!ERP.Ledger || typeof ERP.Ledger.getAccountBalance !== 'function') return;
        if (!window.PurchaseState || typeof PurchaseState.getDashboardStats !== 'function') return;
        var glAP = ERP.Ledger.getAccountBalance('acc-2001');
        if (typeof glAP !== 'number' || isNaN(glAP)) return;
        var stats = PurchaseState.getDashboardStats();
        var unpaidSumPaisa = Math.round(((stats && stats.totalPayable) || 0) * 100);
        if (Math.abs(glAP - unpaidSumPaisa) > 100) {
          _recordIncident('FINANCIAL_INTEGRITY', 'WARNING',
            'Vendor AP (acc-2001) ≠ unpaid bills sum',
            { glAPPaisa: glAP, unpaidBillsPaisa: unpaidSumPaisa, diffPaisa: Math.abs(glAP - unpaidSumPaisa) }
          );
          _toast('⚠️ Vendor AP drift detected. Check purchase ledger.', 'warning');
        }
      }, null, 'fin.ap_bills');

      _try(function () {
        var state = ERP.getState && ERP.getState();
        var invoices = (state && state.data && Array.isArray(state.data.invoices))
          ? state.data.invoices : [];
        if (invoices.length === 0) return;

        var nums = [];
        var dupCheck = {};
        var dups = [];
        invoices.forEach(function (inv) {
          if (!inv || inv._deleted) return;
          var num = (inv.invoiceNumber !== undefined && inv.invoiceNumber !== null && inv.invoiceNumber !== '') ? inv.invoiceNumber
                  : (inv.number !== undefined && inv.number !== null && inv.number !== '') ? inv.number
                  : inv.id;
          if (num === undefined || num === null || num === '') return;
          if (dupCheck[num]) dups.push(num);
          dupCheck[num] = true;
          var match = String(num).match(/(\d+)$/);
          if (match) nums.push(parseInt(match[1], 10));
        });

        if (dups.length > 0) {
          _recordIncident('FINANCIAL_INTEGRITY', 'CRITICAL',
            'Duplicate invoice numbers detected',
            { duplicates: dups.slice(0, 20) }
          );
          _quarantine('invoices', { type: 'duplicates', dups: dups, ts: _now() });
          _toast('🚨 Duplicate invoice numbers found: ' + dups.slice(0, 3).join(', '), 'error', 0);
        }

        if (nums.length > 1) {
          var uniqueNums = nums.filter(function (n, idx, arr) { return arr.indexOf(n) === idx; });
          uniqueNums.sort(function (a, b) { return a - b; });
          var gaps = [];
          for (var i = 1; i < uniqueNums.length; i++) {
            if (uniqueNums[i] - uniqueNums[i - 1] > 1) {
              var missing = [];
              var missingCount = uniqueNums[i] - uniqueNums[i - 1] - 1;
              for (var m = uniqueNums[i - 1] + 1; m < uniqueNums[i] && missing.length < 50; m++) {
                missing.push(m);
              }
              gaps.push({ from: uniqueNums[i - 1], to: uniqueNums[i], missingCount: missingCount, missingSample: missing });
            }
          }
          if (gaps.length > 0) {
            _recordIncident('FINANCIAL_INTEGRITY', 'WARNING',
              'Invoice sequence gaps detected (' + gaps.length + ' gap(s))',
              { gaps: gaps.slice(0, 10) }
            );
          }
        }
      }, null, 'fin.invoice_seq');

      _try(function () {
        if (!ERP.Ledger || typeof ERP.Ledger.getAccountBalance !== 'function') return;
        var glGSTPayable = ERP.Ledger.getAccountBalance('acc-2200');
        if (typeof glGSTPayable !== 'number' || isNaN(glGSTPayable)) return;
        var state = ERP.getState && ERP.getState();
        var invoices = (state && state.data && Array.isArray(state.data.invoices))
          ? state.data.invoices : [];
        var invoiceTaxPaisa = 0;
        invoices.forEach(function (inv) {
          if (!inv || inv._deleted || inv.status === 'cancelled') return;
          var taxRaw = (inv.tax !== undefined && inv.tax !== null) ? inv.tax
                     : (inv.taxAmount !== undefined && inv.taxAmount !== null) ? inv.taxAmount
                     : (inv.gstAmount !== undefined && inv.gstAmount !== null) ? inv.gstAmount
                     : 0;
          invoiceTaxPaisa += _toPaisa(taxRaw);
        });
        if (Math.abs(glGSTPayable - invoiceTaxPaisa) > 100) {
          _recordIncident('FINANCIAL_INTEGRITY', 'WARNING',
            'GST Payable (acc-2200) ≠ invoice tax sum',
            { glGSTPayablePaisa: glGSTPayable, invoiceTaxPaisa: invoiceTaxPaisa,
              diffPaisa: Math.abs(glGSTPayable - invoiceTaxPaisa) }
          );
        }
      }, null, 'fin.tax_ledger');

      log.info('[ERP.Guardian] Financial integrity check complete.');
    }, null, 'checkFinancialIntegrity');
  }


  function _checkStorageHealth() {
    _try(function () {
      _try(function () {
        var totalBytes = _getLocalStorageBytes();
        if (totalBytes >= _config.storageAlertThresholdBytes) {
          _recordIncident('STORAGE_HEALTH', 'CRITICAL',
            'localStorage approaching 5MB limit',
            { usedBytes: totalBytes, thresholdBytes: _config.storageAlertThresholdBytes,
              usedPct: ((totalBytes / (5 * 1024 * 1024)) * 100).toFixed(1) + '%' }
          );
          if (!_persistentState.storageSizeCritical) {
            _persistentState.storageSizeCritical = true;
            _toast('🚨 Storage critical: ' + (totalBytes / 1024 / 1024).toFixed(2) + 'MB used. Archive audit log immediately.', 'error', 0);
          }
        } else {
          _persistentState.storageSizeCritical = false;
        }
      }, null, 'storage.size');

      _try(function () {
        var raw = _try(function () {
          return JSON.parse(localStorage.getItem('mh_audit_log') || '[]');
        }, [], 'storage.audit_read');
        var entries = Array.isArray(raw) ? raw : [];
        if (entries.length >= _config.auditArchiveTriggerCount) {
          var nowTs = Date.now();
          if (nowTs >= _persistentState.auditArchiveCooldownUntil) {
            _persistentState.auditArchiveCooldownUntil = nowTs + (5 * 60 * 1000);
            _logger().warn('[ERP.Guardian] Audit log at ' + entries.length + ' entries — triggering archive.');
            if (ERP.AuditArchive && typeof ERP.AuditArchive.archiveNow === 'function') {
              ERP.AuditArchive.archiveNow();
            }
            _emit('audit:archive:trigger', { count: entries.length });
            _audit('AUDIT_ARCHIVE_TRIGGERED', { count: entries.length });
          }
        }
      }, null, 'storage.audit_count');

      _try(function () {
        var quarantineStores = ['journals', 'invoices', 'inventory', 'sales', 'purchase', 'reports'];
        quarantineStores.forEach(function (store) {
          var key = 'mh_quarantine_' + store;
          var raw = localStorage.getItem(key);
          if (!raw) return;
          var items = _try(function () { return JSON.parse(raw); }, null, 'storage.quarantine.parse');
          if (items && Array.isArray(items) && items.length > 0) {
            _recordIncident('STORAGE_HEALTH', 'WARNING',
              'Quarantine store non-empty: ' + key,
              { store: key, count: items.length, oldest: items[0] && items[0].ts }
            );
            _toast('⚠️ Quarantine data found in ' + key + '. Manual review required.', 'warning');
          }
        });
      }, null, 'storage.quarantine');

      _try(function () {
        var _mainKey  = (ERP.CONSTANTS && ERP.CONSTANTS.STORAGE_KEYS && ERP.CONSTANTS.STORAGE_KEYS.MAIN)  || 'mh_erp_data';
        var _auditKey = (ERP.CONSTANTS && ERP.CONSTANTS.STORAGE_KEYS && ERP.CONSTANTS.STORAGE_KEYS.AUDIT) || 'mh_audit_log';
        var criticalKeys = [
          _mainKey, _auditKey, 'mh_supplier_ledger',
          'mh_purchase_store', 'mh_purchase_meta', 'mh_paymentOuts',
          'mh_mechanics', 'mh_biz_info', 'erp_guard_invoices_v1',
          'erp_edit_locks_v1', 'mh_session', 'erp_feature_flags', 'acc_journals',
          'acc_expenses'
        ];
        criticalKeys.forEach(function (key) {
          var raw = localStorage.getItem(key);
          if (!raw) { delete _persistentState.jsonCorruptKeys[key]; return; }
          _try(function () {
            JSON.parse(raw);
            delete _persistentState.jsonCorruptKeys[key];
          }, function () {
            _recordIncident('STORAGE_HEALTH', 'CRITICAL',
              'Malformed JSON in critical key: ' + key,
              { key: key, rawPreview: raw.slice(0, 100) }
            );
            _quarantine(key.replace(/[^a-z0-9_]/gi, '_'), { type: 'malformed_json', key: key, ts: _now() });
            if (!_persistentState.jsonCorruptKeys[key]) {
              _persistentState.jsonCorruptKeys[key] = true;
              _toast('🚨 CRITICAL: Corrupted data key: ' + key + '. Do NOT reload. Run ERP_Monitor.backup() now.', 'error', 0);
            }
          }, 'storage.json_parse.' + key);
        });
      }, null, 'storage.json_check');

    }, null, 'checkStorageHealth');
  }


  function _checkShadowDrift() {
    _try(function () {
      var shadows = [
        { key: 'shadow_sales',      obj: 'ShadowSales' },
        { key: 'shadow_purchase',   obj: 'ShadowPurchase' },
        { key: 'shadow_inventory',  obj: 'ShadowInventory' },
        { key: 'shadow_reports',    obj: 'ShadowReports' }
      ];
      shadows.forEach(function (s) {
        _try(function () {
          var on = ERP.FeatureFlags && ERP.FeatureFlags.get(s.key);
          if (!on) return;
          var mod = root[s.obj] || (ERP[s.obj]);
          if (!mod || typeof mod.getLog !== 'function') return;
          var log = mod.getLog(100);
          if (!Array.isArray(log)) return;
          var mismatches = log.filter(function (e) { return e && !e.matched; });
          if (mismatches.length > 0) {
            _recordIncident('SHADOW_DRIFT', 'CRITICAL',
              s.obj + ' shadow mismatch detected (' + mismatches.length + ' events)',
              { module: s.obj, mismatchCount: mismatches.length, sample: mismatches.slice(0, 3) }
            );
            _disableFlag(s.key, 'SHADOW_DRIFT — ' + mismatches.length + ' mismatches');
            _quarantine(s.key, { type: 'shadow_drift', mismatches: mismatches.slice(0, 10), ts: _now() });
            _toast('🚨 ' + s.obj + ' mismatch — flag disabled. Check ERP_Guardian.getIncidents().', 'error', 0);
          }
        }, null, 'shadow.' + s.key);
      });
    }, null, 'checkShadowDrift');
  }


  function _monitorKnownRisks() {
    _try(function () {
      if (typeof root._ps === 'function' && root._ps !== root.__guardian_ps_wrapped) {
        var _original_ps = root._ps;
        var _wrapped_ps = function () {
          var args = Array.prototype.slice.call(arguments);
          if (args[0] === null || args[0] === undefined) {
            _recordIncident('KNOWN_RISK', 'WARNING',
              'RISK-001: _ps() called with null/undefined key',
              { args: args, stack: (new Error()).stack && (new Error()).stack.split('\n').slice(1, 4).join(' | ') }
            );
          }
          return _original_ps.apply(this, args);
        };
        root._ps = _wrapped_ps;
        root.__guardian_ps_wrapped = _wrapped_ps;
        _logger().info('[ERP.Guardian] RISK-001 hook active on _ps().');
      }

      _try(function () {
        var journalsRaw = (ERP.Ledger && ERP.Ledger.GeneralLedger && typeof ERP.Ledger.GeneralLedger.getAllJournals === 'function')
          ? ERP.Ledger.GeneralLedger.getAllJournals() : [];
        var journals = Array.isArray(journalsRaw) ? journalsRaw : [];
        var stockRcvIds = journals
          .filter(function (j) { return j && j.documentId && typeof j.documentId === 'string' && j.documentId.indexOf(_config.knownBugPattern) === 0; })
          .map(function (j) { return j.documentId; });
        var seen = {};
        var dups = [];
        stockRcvIds.forEach(function (id) {
          if (seen[id]) dups.push(id);
          seen[id] = true;
        });
        if (dups.length > 0) {
          _recordIncident('KNOWN_RISK', 'CRITICAL',
            'BUG-001: Duplicate journal documentId detected: ' + _config.knownBugPattern + '*',
            { duplicateIds: dups.slice(0, 10) }
          );
          if (!_persistentState.bug001) {
            _persistentState.bug001 = true;
            _quarantine('journals', { type: 'bug001_dup_source', dups: dups, ts: _now() });
            _toast('🚨 BUG-001: Duplicate STOCK-RCV journals. Do NOT post again. Run ERP_Guardian.getIncidents().', 'error', 0);
          }
        } else {
          _persistentState.bug001 = false;
        }
      }, null, 'risk.bug001');

    }, null, 'monitorKnownRisks');
  }


  var _txRollbackTimestamps = [];

  function _monitorConcurrency() {
    _try(function () {
      _wireOnce('concurrency', function () {
        _on('ledger:journal:rollback', function (payload) {
          _try(function () {
            var now = Date.now();
            _txRollbackTimestamps.push(now);
            _txRollbackTimestamps = _txRollbackTimestamps.filter(function (ts) {
              return now - ts <= _config.txRollbackFloodWindowMs;
            });
            if (_txRollbackTimestamps.length >= _config.txRollbackFloodCount) {
              _recordIncident('CONCURRENCY', 'CRITICAL',
                'Transaction rollback flood: ' + _txRollbackTimestamps.length + ' rollbacks in 60s',
                { count: _txRollbackTimestamps.length, windowMs: _config.txRollbackFloodWindowMs, payload: payload }
              );
              _disableFlag('concurrency_guard', 'TX_ROLLBACK_FLOOD');
              _toast('🚨 Concurrency flood detected — concurrency_guard disabled. Close other tabs immediately.', 'error', 0);
              _txRollbackTimestamps = [];
            }
          }, null, 'concurrency.rollback_handler');
        });
      });
    }, null, 'monitorConcurrency');
  }


  function _checkBrowserEnvironment() {
    _try(function () {
      var issues = [];

      var lsAvailable = _try(function () {
        var testKey = '__erp_guardian_test__';
        localStorage.setItem(testKey, '1');
        localStorage.removeItem(testKey);
        return true;
      }, false, 'env.ls_test');

      if (!lsAvailable) {
        if (_persistentState.envStatic.localStorage !== false) {
          _persistentState.envStatic.localStorage = false;
          _recordIncident('BROWSER_ENV', 'CRITICAL',
            'localStorage unavailable — ALL financial operations blocked',
            { reason: 'private mode or storage disabled' }
          );
          _toast('🚨 CRITICAL: localStorage unavailable. ERP cannot run safely in private/incognito mode.', 'error', 0);
          var financialFlags = ['tax_engine', 'gst_engine', 'period_lock', 'shadow_sales', 'shadow_purchase', 'shadow_inventory', 'shadow_reports'];
          financialFlags.forEach(function (f) { _disableFlag(f, 'BROWSER_ENV — localStorage unavailable'); });
        }
        return;
      }
      _persistentState.envStatic.localStorage = true;

      var idbAvailable = _try(function () {
        return !!(root.indexedDB || root.webkitIndexedDB || root.mozIndexedDB);
      }, false, 'env.idb');
      if (!idbAvailable) {
        issues.push('IndexedDB not available — audit archive degraded');
        if (_persistentState.envStatic.idb !== false) {
          _persistentState.envStatic.idb = false;
          _recordIncident('BROWSER_ENV', 'WARNING', 'IndexedDB unavailable', {});
        }
      } else {
        _persistentState.envStatic.idb = true;
      }

      var bcAvailable = _try(function () {
        return typeof root.BroadcastChannel === 'function';
      }, false, 'env.bc');
      if (!bcAvailable) {
        issues.push('BroadcastChannel not available — concurrency guard degraded to single-tab mode');
        if (_persistentState.envStatic.bc !== false) {
          _persistentState.envStatic.bc = false;
          _recordIncident('BROWSER_ENV', 'WARNING', 'BroadcastChannel unavailable — concurrency degraded', {});
        }
      } else {
        _persistentState.envStatic.bc = true;
      }

      _try(function () {
        if (root.navigator && root.navigator.storage && typeof root.navigator.storage.estimate === 'function') {
          root.navigator.storage.estimate().then(function (est) {
            if (est && est.quota && est.quota < 120 * 1024 * 1024) {
              if (_persistentState.envStatic.privateMode !== true) {
                _persistentState.envStatic.privateMode = true;
                _recordIncident('BROWSER_ENV', 'WARNING',
                  'Private/incognito mode suspected — storage quota very low',
                  { quotaBytes: est.quota }
                );
                _toast('⚠️ Private mode detected. Data may not persist. Use normal browser mode for ERP.', 'warning');
              }
            } else {
              _persistentState.envStatic.privateMode = false;
            }
          }).catch(function () {
          });
        }
      }, null, 'env.private_mode');

      _try(function () {
        var totalBytes = _getLocalStorageBytes();
        _logger().info('[ERP.Guardian] localStorage: ' + (totalBytes / 1024).toFixed(1) + 'KB used.');
      }, null, 'env.ls_size');

      if (issues.length === 0) {
        _logger().info('[ERP.Guardian] Browser environment: OK');
      }

    }, null, 'checkBrowserEnvironment');
  }


  function _checkReportIntegrity() {
    _try(function () {
      _wireOnce('reportIntegrity', function () {
        _on('report:generated', function (payload) {
          _try(function () {
            if (!ERP.Ledger || !ERP.Ledger.GeneralLedger || typeof ERP.Ledger.GeneralLedger.isBalanced !== 'function') return;
            var bal = ERP.Ledger.GeneralLedger.isBalanced();
            if (!bal || typeof bal !== 'object' || bal.balanced !== true) {
              _recordIncident('REPORT_INTEGRITY', 'CRITICAL',
                'Report generated but GL is unbalanced',
                { reportType: payload && payload.type, differencePaisa: bal.difference }
              );
              _try(function () {
                if (ERP.ReportCache && typeof ERP.ReportCache.clear === 'function') {
                  ERP.ReportCache.clear();
                  _logger().warn('[ERP.Guardian] Stale report cache cleared after GL imbalance.');
                }
              }, null, 'report.cache_clear');
              _toast('🚨 Report integrity: GL imbalance after report generation. Cache cleared.', 'error', 0);
            }
          }, null, 'report.integrity_check');
        });
      });
    }, null, 'monitorReportIntegrity');
  }


  function _monitorPermissions() {
    _try(function () {
      _wireOnce('permissions', function () {
        _on('auth:permission:denied', function (payload) {
          _try(function () {
            _auditPermission('PERMISSION_DENIED', payload || {});
            _logger().warn('[ERP.Guardian][PERMISSION] Denied: ' + JSON.stringify(payload));
            if (payload && payload.attempted_bypass) {
              _recordIncident('PERMISSION_AUDIT', 'CRITICAL',
                'Permission bypass attempt detected',
                payload
              );
              _toast('🚨 SECURITY: Permission bypass attempt logged. See AuditTrail.', 'error', 0);
            }
          }, null, 'perm.denied');
        });

        _on('auth:dangerous:operation', function (payload) {
          _try(function () {
            _auditPermission('DANGEROUS_OPERATION_ATTEMPTED', payload || {});
            _recordIncident('PERMISSION_AUDIT', 'WARNING',
              'Dangerous operation attempted: ' + (payload && payload.operation),
              payload
            );
          }, null, 'perm.dangerous');
        });

        _on('auth:role:escalation', function (payload) {
          _try(function () {
            _auditPermission('ROLE_ESCALATION_ATTEMPTED', payload || {});
            _recordIncident('PERMISSION_AUDIT', 'CRITICAL',
              'Role escalation attempt: ' + (payload && payload.from) + ' → ' + (payload && payload.to),
              payload
            );
            _toast('🚨 SECURITY: Role escalation attempt detected and logged.', 'error', 0);
          }, null, 'perm.escalation');
        });
      });
    }, null, 'monitorPermissions');
  }


  function _checkBackupReminder() {
    _try(function () {
      if (!ERP.BackupEngine || typeof ERP.BackupEngine.checkReminderDue !== 'function') return;
      var check = ERP.BackupEngine.checkReminderDue();
      if (!check || !check.shouldRemind) return;

      var isInfinite = !!check.neverBackedUp || check.daysSinceLastBackup == null || !isFinite(Number(check.daysSinceLastBackup));
      var days = isInfinite ? Infinity : Number(check.daysSinceLastBackup);
      var agoLabel   = isInfinite ? 'never' : days.toFixed(1) + ' day(s) ago';
      var sinceLabel = isInfinite ? 'ever'  : days.toFixed(1) + ' day(s)';

      _audit('BACKUP_REMINDER', { daysSinceLastBackup: days });

      if (isInfinite || days >= _config.backupEscalateDays) {
        _recordIncident('BACKUP_REMINDER', 'CRITICAL',
          'No backup for ' + sinceLabel + ' — ESCALATED ALERT',
          { daysSinceLastBackup: days, action: 'modal_required' }
        );
        _try(function () {
          if (ERP.ui && typeof ERP.ui.modal === 'function') {
            ERP.ui.modal(
              '🚨 Backup Required',
              'Last backup: ' + agoLabel + '.\n\nRun ERP_Monitor.backup() from the browser console (F12) immediately.\n\nThis alert cannot be dismissed without acknowledging.',
              [{ label: 'I will backup now', action: function () {
                ERP.BackupEngine.exportToFile && ERP.BackupEngine.exportToFile();
              }}]
            );
          } else {
            _toast('🚨 BACKUP OVERDUE: ' + agoLabel + '. Run ERP_Monitor.backup() now!', 'error', 0);
          }
        }, null, 'backup.modal');
      } else {
        _recordIncident('BACKUP_REMINDER', 'WARNING',
          'Backup reminder: last backup ' + agoLabel,
          { daysSinceLastBackup: days }
        );
        _toast('⚠️ Backup reminder: Last backup ' + agoLabel + '. Run ERP_Monitor.backup() soon.', 'warning');
        _try(function () {
          if (ERP.Logger && typeof ERP.Logger.warn === 'function') {
            ERP.Logger.warn('[BACKUP_REMINDER] Last backup ' + agoLabel + '. Consider running ERP_Monitor.backup().');
          }
        }, null, 'backup.kernel_log');
      }
    }, null, 'checkBackupReminder');
  }


  function _checkGSTFilingReminder() {
    _try(function () {
      if (!ERP.FeatureFlags || !ERP.FeatureFlags.get('gst_engine')) return;
      if (!ERP.GSTEngine) return;

      var now = new Date();
      var currentPeriod = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

      var periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      var daysLeft = Math.ceil((periodEnd - now) / (1000 * 60 * 60 * 24));

      if (daysLeft > _config.gstWarningDays) return;

      var reconResult = null;
      _try(function () {
        if (typeof ERP.GSTEngine.getPeriodSummary === 'function') {
          reconResult = ERP.GSTEngine.getPeriodSummary(currentPeriod);
        }
      }, null, 'gst.recon');

      var reconOk = !!(reconResult && reconResult.balanced);
      var stateKey = currentPeriod + ':' + (reconOk ? 'ok' : 'fail');

      if (_persistentState.gstState[currentPeriod] === stateKey) return;
      _persistentState.gstState[currentPeriod] = stateKey;

      if (!reconOk) {
        _recordIncident('GST_FILING', 'CRITICAL',
          'GST reconciliation FAILED — filing deadline in ' + daysLeft + ' day(s)',
          { period: currentPeriod, daysLeft: daysLeft, reconResult: reconResult }
        );
        _toast('🚨 CRITICAL: GST reconciliation failed! Filing due in ' + daysLeft + ' day(s). Do not file until fixed.', 'error', 0);
        _audit('GST_RECON_FAILED_PRE_DEADLINE', { period: currentPeriod, daysLeft: daysLeft });
      } else {
        _recordIncident('GST_FILING', 'WARNING',
          'GST return due in ' + daysLeft + ' day(s) — please verify and export',
          { period: currentPeriod, daysLeft: daysLeft, reconResult: reconResult }
        );
        _toast('⚠️ GST return due in ' + daysLeft + ' day(s). Verify and export from GST module.', 'warning');
        _audit('GST_FILING_REMINDER', { period: currentPeriod, daysLeft: daysLeft });
      }
    }, null, 'checkGSTFilingReminder');
  }


  var _perfHistory = [];

  function _monitorPerformance() {
    _try(function () {
      _wireOnce('performance', function () {
        _on('report:generated', function (payload) {
          _try(function () {
            var durationMs = payload && Number(payload.durationMs);
            var reportType = (payload && payload.type) || 'unknown';
            if (!durationMs || isNaN(durationMs) || durationMs <= 0) return;

            _perfHistory.push({ ts: _now(), reportType: reportType, durationMs: durationMs });
            if (_perfHistory.length > 100) _perfHistory = _perfHistory.slice(-100);

            var threshold = _config.perfThresholdMs;

            if (durationMs >= threshold * _config.perfCriticalMultiplier) {
              _recordIncident('PERFORMANCE', 'CRITICAL',
                'Report generation critically slow: ' + durationMs + 'ms (' + reportType + ')',
                { durationMs: durationMs, thresholdMs: threshold, reportType: reportType,
                  suggestion: 'Run ERP.AuditArchive.archiveNow() to reduce data volume.' }
              );
              _toast('🚨 Performance CRITICAL: Report took ' + durationMs + 'ms. Consider archiving data.', 'error', 0);
            } else if (durationMs >= threshold) {
              _recordIncident('PERFORMANCE', 'WARNING',
                'Report generation slow: ' + durationMs + 'ms (' + reportType + ')',
                { durationMs: durationMs, thresholdMs: threshold, reportType: reportType }
              );
              _logger().warn('[ERP.Guardian] Performance WARNING: ' + reportType + ' took ' + durationMs + 'ms');
            }

            if (_perfHistory.length >= 5) {
              var recent = _perfHistory.slice(-5).map(function (h) { return h.durationMs; });
              var trend = true;
              for (var i = 1; i < recent.length; i++) {
                if (recent[i] <= recent[i - 1]) { trend = false; break; }
              }
              if (trend && recent[recent.length - 1] > threshold * 0.75) {
                _logger().warn('[ERP.Guardian] Performance trend: last 5 reports show increasing duration. Consider archival.');
                _audit('PERF_TREND_WARNING', { recent: recent });
              }
            }
          }, null, 'perf.report_handler');
        });
      });
    }, null, 'monitorPerformance');
  }


  var _NON_BUSINESS_DATA_KEYS = { users: true, templates: true, coa: true };

  function _hasRealBusinessData() {
    return _try(function () {
      var state = ERP.getState && ERP.getState();
      var data = state && state.data;
      if (!data || typeof data !== 'object') return false;
      return Object.keys(data).some(function (k) {
        return !_NON_BUSINESS_DATA_KEYS[k] && Array.isArray(data[k]) && data[k].length > 0;
      });
    }, false, 'hasRealBusinessData');
  }

  function _clampDayToMonth(year, monthIndex, day) {
    var daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    return Math.min(day, daysInMonth);
  }

  function _checkYearEndReminder() {
    _try(function () {
      if (!_hasRealBusinessData()) return;

      var settings = (ERP.getState && ERP.getState().settings) || {};
      var yem = (typeof settings.yearEndMonth === 'number' && settings.yearEndMonth >= 1 && settings.yearEndMonth <= 12)
        ? settings.yearEndMonth : _config.yearEndMonth;
      var yed = (typeof settings.yearEndDay === 'number' && settings.yearEndDay >= 1 && settings.yearEndDay <= 31)
        ? settings.yearEndDay : _config.yearEndDay;

      var now = new Date();
      var monthIndex = yem - 1;
      var clampedDay = _clampDayToMonth(now.getFullYear(), monthIndex, yed);
      var yearEnd = new Date(now.getFullYear(), monthIndex, clampedDay);
      if (now > yearEnd) {
        clampedDay = _clampDayToMonth(now.getFullYear() + 1, monthIndex, yed);
        yearEnd = new Date(now.getFullYear() + 1, monthIndex, clampedDay);
      }
      var daysLeft = Math.ceil((yearEnd - now) / (1000 * 60 * 60 * 24));
      if (daysLeft > _config.yearEndWarnDays) return;

      var dayKey = now.toISOString().slice(0, 10);
      if (_persistentState.yearEndState.warnDay !== dayKey) {
        _persistentState.yearEndState.warnDay = dayKey;
        _recordIncident('YEAR_END', 'WARNING',
          'Financial year-end approaching in ' + daysLeft + ' day(s)',
          { yearEnd: yearEnd.toISOString().slice(0, 10), daysLeft: daysLeft }
        );
        _toast('⚠️ Financial year-end in ' + daysLeft + ' day(s). Prepare year-end close. Phase 12 procedure applies.', 'warning');
        _audit('YEAR_END_REMINDER', { yearEnd: yearEnd.toISOString().slice(0, 10), daysLeft: daysLeft });
      }

      _try(function () {
        if (ERP.YearEnd && typeof ERP.YearEnd.runPreCloseChecklist === 'function') {
          var checkResult = ERP.YearEnd.runPreCloseChecklist();
          var checklistKey = checkResult && !checkResult.ok
            ? (dayKey + ':fail:' + ((checkResult.blockers && checkResult.blockers.length) || 0))
            : (dayKey + ':ok');
          if (_persistentState.yearEndState.checklist === checklistKey) return;
          _persistentState.yearEndState.checklist = checklistKey;
          if (checkResult && !checkResult.ok) {
            _recordIncident('YEAR_END', 'CRITICAL',
              'Pre-close checklist FAILED — ' + (checkResult.blockers && checkResult.blockers.length) + ' blocker(s)',
              { blockers: checkResult.blockers }
            );
            _toast('🚨 Year-end pre-close checklist failed. Blockers: ' + (checkResult.blockers || []).join(', '), 'error', 0);
          }
        }
      }, null, 'yearend.checklist');
    }, null, 'checkYearEndReminder');
  }


  function _wireAutoResponse() {
    _try(function () {
      _wireOnce('autoResponse', function () {
        _on('shadow:diff', function (payload) {
          _try(function () {
            var flag = payload && payload.flag;
            if (!flag) return;
            _disableFlag(flag, 'AUTO_RESPONSE — shadow:diff event');
            _quarantine(flag, { type: 'shadow_diff', payload: payload, ts: _now() });
            _recordIncident('AUTO_RESPONSE', 'CRITICAL',
              'Shadow mismatch auto-response: ' + flag + ' disabled',
              payload
            );
            _toast('🚨 Auto-response: ' + flag + ' disabled on shadow:diff. No financial data modified.', 'error', 0);
          }, null, 'auto.shadow_diff');
        });

        _on('storage:critical', function (payload) {
          _try(function () {
            _recordIncident('AUTO_RESPONSE', 'CRITICAL', 'Storage critical — emergency backup triggered', payload);
            var nowTs = Date.now();
            if (nowTs >= _persistentState.storageCriticalBackupCooldownUntil) {
              _persistentState.storageCriticalBackupCooldownUntil = nowTs + (2 * 60 * 1000);
              if (ERP.BackupEngine && typeof ERP.BackupEngine.exportToFile === 'function') {
                ERP.BackupEngine.exportToFile();
              }
              _toast('🚨 Storage critical — emergency backup triggered automatically.', 'error', 0);
            }
          }, null, 'auto.storage_critical');
        });

        _on('selftest:fail', function (payload) {
          _try(function () {
            _recordIncident('AUTO_RESPONSE', 'CRITICAL',
              'SelfTest FAIL/CORRUPT detected at startup',
              payload
            );
            _audit('SELFTEST_FAIL_DETECTED', payload || {});
            _toast('🚨 CRITICAL: ERP SelfTest failed. Run ERP_Monitor.disableAll() if corruption is confirmed.', 'error', 0);
          }, null, 'auto.selftest_fail');
        });

        _on('integrity:failure', function (payload) {
          _try(function () {
            var inc = payload && payload.incident;
            if (!inc) return;
            _audit('INTEGRITY_FAILURE_EVENT', {
              incidentId: inc.id,
              domain: inc.domain,
              severity: inc.severity,
              title: inc.title
            });
          }, null, 'auto.integrity_failure');
        });
      });
    }, null, 'wireAutoResponse');
  }


  function _runAll() {
    _try(function () {
      _logger().info('[ERP.Guardian] Full integrity check started at ' + _now());

      _try(function () { if (root.MH_Health) root.MH_Health.check(); }, null, 'extend.mh_health');
      _try(function () { if (root.ERPCleaner) root.ERPCleaner.runAll(); }, null, 'extend.erp_cleaner');
      _try(function () { if (ERP.SelfTest) ERP.SelfTest.run(); }, null, 'extend.self_test');

      _checkBrowserEnvironment();
      _checkStorageHealth();
      _checkFinancialIntegrity();
      _checkShadowDrift();
      _monitorKnownRisks();
      _checkBackupReminder();
      _checkGSTFilingReminder();
      _checkYearEndReminder();

      _logger().info('[ERP.Guardian] Full check complete. Incidents this session: ' + _incidents.length);

      _emit('guardian:check:complete', {
        ts: _now(),
        incidentCount: _incidents.length,
        criticals: _incidents.filter(function (i) { return i.severity === 'CRITICAL' && !i.acknowledged; }).length
      });
    }, null, 'runAll');
  }


  function _status() {
    _try(function () {
      var GREEN  = 'color:#a6e3a1;font-weight:bold';
      var RED    = 'color:#f38ba8;font-weight:bold';
      var YELLOW = 'color:#f9e2af;font-weight:bold';
      var DIM    = 'color:#6c7a9c';
      var HEAD   = 'color:#e6edf3;font-weight:bold;font-size:1.1em';

      console.log('%c📡 MH Autos ERP — Integrity Guardian [' + _now() + ']', HEAD);
      console.log('%c════════════════════ INCIDENTS ════════════════════', DIM);

      var criticals = _incidents.filter(function (i) { return i.severity === 'CRITICAL'; });
      var warnings  = _incidents.filter(function (i) { return i.severity === 'WARNING'; });

      console.log('%c  Criticals : ' + criticals.length, criticals.length ? RED : GREEN);
      console.log('%c  Warnings  : ' + warnings.length, warnings.length ? YELLOW : GREEN);
      console.log('%c  Total     : ' + _incidents.length, DIM);

      if (_incidents.length > 0) {
        console.log('%c════════════════════ RECENT ════════════════════', DIM);
        _incidents.slice(-5).forEach(function (inc) {
          var css = inc.severity === 'CRITICAL' ? RED : (inc.severity === 'WARNING' ? YELLOW : GREEN);
          console.log('%c  [' + inc.severity + '] ' + inc.domain + ': ' + inc.title, css);
          console.log('%c  ' + inc.id + ' | ' + inc.ts, DIM);
        });
      }

      console.log('%c════════════════════ MONITORS ════════════════════', DIM);
      console.log('%c  Financial  : every 30 min | next run auto-scheduled', DIM);
      var storageCritical = _incidents.some(function (i) {
        return i.domain === 'STORAGE_HEALTH' && i.severity === 'CRITICAL' && !i.acknowledged;
      });
      console.log('%c  Storage    : ' + (storageCritical ? 'CRITICAL — see incidents above' : 'OK') + ' (run ERP_Guardian.runAll() to refresh)', storageCritical ? RED : DIM);
      console.log('%c  Perf log   : ' + _perfHistory.length + ' report(s) tracked', DIM);

      console.log('%c════════════════════ COMMANDS ════════════════════', DIM);
      console.log('%c  ERP_Guardian.runAll()        — manual full check', DIM);
      console.log('%c  ERP_Guardian.getIncidents()  — all incidents this session', DIM);
      console.log('%c  ERP_Guardian.setConfig({})   — override config', DIM);
    }, null, 'status');
  }


  function _startPeriodicChecks() {
    _try(function () {
      
      ERP._guardianInterval = ERP.TimerRegistry.start('integrityGuardian.periodicChecks', function () {
        _try(_checkFinancialIntegrity, null, 'periodic.financial');
        _try(_checkStorageHealth, null, 'periodic.storage');
        _try(_checkShadowDrift, null, 'periodic.shadow_drift');
        _try(_monitorKnownRisks, null, 'periodic.known_risks');
        _try(_checkBackupReminder, null, 'periodic.backup');
        _try(_checkGSTFilingReminder, null, 'periodic.gst');
        _try(_checkYearEndReminder, null, 'periodic.yearend');
      }, _config.financialCheckIntervalMs);
      _logger().info('[ERP.Guardian] Periodic checks scheduled every 30 minutes.');
    }, null, '_startPeriodicChecks');
  }


  ERP.IntegrityGuardian = {
    status:        _status,
    runAll:        _runAll,
    getIncidents:  function () { return _incidents.slice(); },
    clearIncidents: function () {
      _incidents = [];
      _logger().info('[ERP.Guardian] Incident log cleared.');
    },
    setConfig: function (overrides) {
      _try(function () {
        if (!overrides || typeof overrides !== 'object') return;
        var safeOverrides = {};
        Object.keys(overrides).forEach(function (key) {
          if (!(key in _config)) return;
          var val = overrides[key];
          var existing = _config[key];
          if (typeof existing === 'number') {
            if (typeof val !== 'number' || isNaN(val) || val < 0) return;
            if (key === 'financialCheckIntervalMs' && val < 1000) return;
          } else if (typeof existing === 'string') {
            if (typeof val !== 'string') return;
          }
          safeOverrides[key] = val;
        });
        var intervalChanged = ('financialCheckIntervalMs' in safeOverrides) &&
          safeOverrides.financialCheckIntervalMs !== _config.financialCheckIntervalMs;
        Object.assign(_config, safeOverrides);
        _logger().info('[ERP.Guardian] Config updated: ' + JSON.stringify(safeOverrides));
        if (intervalChanged) _startPeriodicChecks();
      }, null, 'setConfig');
    },
    getConfig: function () { return Object.assign({}, _config); },
    getPerfHistory: function () { return _perfHistory.slice(); },
    acknowledgeIncident: function (incidentId) {
      return _try(function () {
        var inc = _incidents.find(function (i) { return i.id === incidentId; });
        if (!inc) return false;
        inc.acknowledged = true;
        _audit('INCIDENT_ACKNOWLEDGED', { id: inc.id, domain: inc.domain, severity: inc.severity });
        return true;
      }, false, 'acknowledgeIncident');
    }
  };

  root.ERP_Guardian = ERP.IntegrityGuardian;


  ERP.IntegrityGuardian.incidentReport = function (incidentId) {
    return _try(function () {
      var inc = _incidents.find(function (i) { return i.id === incidentId; });
      if (!inc) {
        console.warn('[ERP.Guardian] Incident not found: ' + incidentId);
        return null;
      }
      var seenRefs = [];
      var detailJson = _try(function () {
        return JSON.stringify(inc.detail, function (k, v) {
          if (v && typeof v === 'object') {
            if (seenRefs.indexOf(v) !== -1) return '[circular]';
            seenRefs.push(v);
          }
          return v;
        }, 2);
      }, '"[unserializable]"', 'incidentReport.stringify');
      var report = [
        '══════════════════════════════════════════════════════',
        'MH AUTOS ERP — INTEGRITY INCIDENT REPORT',
        '══════════════════════════════════════════════════════',
        'Incident ID    : ' + inc.id,
        'Timestamp      : ' + inc.ts,
        'Domain         : ' + inc.domain,
        'Severity       : ' + inc.severity,
        'Title          : ' + inc.title,
        '──────────────────────────────────────────────────────',
        'Detail         :',
        detailJson,
        '──────────────────────────────────────────────────────',
        'Auto Action    : ' + (inc.autoAction || 'None'),
        'Acknowledged   : ' + (inc.acknowledged ? 'Yes' : 'No'),
        '──────────────────────────────────────────────────────',
        'Reported By    : ERP.IntegrityGuardian (automated)',
        'Recovery Steps :',
        '  1. Run ERP_Guardian.getIncidents() — full log',
        '  2. Run ERP.flags.getAll()          — flag states',
        '  3. Run ERP.SelfTest.run()          — re-run self test',
        '  4. Check mh_quarantine_* in localStorage',
        '  5. Run ERP_Monitor.backup()        — take immediate backup',
        '  6. DO NOT auto-repair financial records',
        '  7. Re-enable flags one-by-one after root cause fixed',
        '══════════════════════════════════════════════════════'
      ].join('\n');
      console.log(report);
      return report;
    }, null, 'incidentReport');
  };


  ERP.__p11_guardian = true;

  setTimeout(function () {
    _try(function () {
      _logger().info('[ERP.Guardian] Initialising boot checks...');
      _wireAutoResponse();
      _monitorConcurrency();
      _monitorPerformance();
      _monitorPermissions();
      _checkBrowserEnvironment();
      _checkStorageHealth();
      _checkFinancialIntegrity();
      _checkShadowDrift();
      _monitorKnownRisks();
      _checkBackupReminder();
      _checkGSTFilingReminder();
      _checkYearEndReminder();
      _checkReportIntegrity();
      _startPeriodicChecks();
      _logger().info('[ERP.Guardian] ✅ Integrity Guardian ACTIVE. Use ERP_Guardian.status() for dashboard.');
      console.log('%c[ERP.Guardian] ✅ Integrity Guardian ACTIVE', 'color:#a6e3a1;font-weight:bold');
    }, null, 'boot');
  }, 2500);

}(window));
