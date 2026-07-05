
'use strict';

(function (root) {
  'use strict';

  if (root.ERP && root.ERP.__phase11_backup) return;

  var ERP = root.ERP = root.ERP || {};

  function _logger() {
    return root.Logger || ERP.Logger || {
      info:  function () {},
      warn:  function (m) { console.warn(m); },
      error: function (m) { console.error(m); }
    };
  }

  function _try(fn, fallback) {
    try { return fn(); }
    catch (e) { _logger().warn('[ERP.BackupEngine] _try: ' + (e && e.message || e)); return (fallback !== undefined ? fallback : null); }
  }

  // Single source of truth: delegates to ERP.Auth (core.js). This was
  // byte-for-byte duplicated across 4 files (erp.backup.engine.js,
  // erp.feature.flags.js, erp.period.lock.js, erp.user.lifecycle.js) —
  // a role-check rule change would have needed manual sync across all 4.
  function _currentUser() {
    return _try(function () { return ERP.Auth.currentUser(); }, null);
  }

  function _isAdmin() {
    return _try(function () { return ERP.Auth.isAdminRole(); }, false);
  }

  function _auditRecord(action, detail) {
    _try(function () {
      if (root.AuditTrail && typeof root.AuditTrail.record === 'function') {
        var u = _currentUser();
        root.AuditTrail.record('backup', 'system', action, detail, null, (u && u.username) || 'System');
      }
    });
  }

  var BACKUP_REMINDER_KEY  = 'erp_backup_reminder';
  var DEFAULT_REMINDER_DAYS = 7;
  var BACKUP_VERSION        = '1.0';
  var BYTES_PER_KB          = 1024;
  var MAX_SESSION_SNAPSHOT_CHARS = 1000000;
  var BOOT_REMINDER_CHECK_DELAY_MS = 2000;

  // This file loads after constants.js in index.html, so ERP.CONSTANTS is
  // available — still guarded with a literal fallback for robustness.
  function _mainKey()  { return (ERP.CONSTANTS && ERP.CONSTANTS.STORAGE_KEYS && ERP.CONSTANTS.STORAGE_KEYS.MAIN)  || 'mh_erp_data'; }
  function _auditKey() { return (ERP.CONSTANTS && ERP.CONSTANTS.STORAGE_KEYS && ERP.CONSTANTS.STORAGE_KEYS.AUDIT) || 'mh_audit_log'; }

  var EXPORT_KEYS = [
    _mainKey(),
    _auditKey(),
    'mh_supplier_ledger',
    'mh_purchase_store',
    'mh_purchase_meta',
    'mh_paymentOuts',
    'mh_mechanics',
    'mh_biz_info',
    'erp_guard_invoices_v1',
    'erp_edit_locks_v1',
    'mh_session'
  ];

  var IDB_EXPORT_STORES = [
    'acc_journals',
    'acc_ledger',
    'acc_expenses',
    'walEntries',
    'reversalIndex',
    'stockJournal',
    'customerLedger',
    'paymentAllocations',
    'acc_coa',
    'acc_periods',
    'acc_bankAccounts',
    'acc_auditLog'
  ];

  function _nowISO() {
    return _try(function () {
      if (ERP.DateUtils && typeof ERP.DateUtils.now === 'function') {
        var result = ERP.DateUtils.now();
        if (result instanceof Date) return result.toISOString();
        if (typeof result === 'string') return result;
        if (result && typeof result.toISOString === 'function') return result.toISOString();
      }
      if (ERP.DateUtils && typeof ERP.DateUtils.today === 'function') {
        var result2 = ERP.DateUtils.today();
        if (result2 instanceof Date) return result2.toISOString();
        if (typeof result2 === 'string') return result2;
        if (result2 && typeof result2.toISOString === 'function') return result2.toISOString();
      }
      return new Date().toISOString();
    }, new Date().toISOString());
  }

  function _todayStr() {
    return _try(function () {
      if (ERP.DateUtils && typeof ERP.DateUtils.today === 'function') {
        var d = ERP.DateUtils.today();
        if (d instanceof Date) {
          return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        }
        if (typeof d === 'string') {
          var parsed = new Date(d);
          if (!isNaN(parsed.getTime())) {
            return parsed.getFullYear() + '-' + String(parsed.getMonth() + 1).padStart(2, '0') + '-' + String(parsed.getDate()).padStart(2, '0');
          }
          return d;
        }
      }
      var _d = new Date();
      return _d.getFullYear() + '-' + String(_d.getMonth() + 1).padStart(2, '0') + '-' + String(_d.getDate()).padStart(2, '0');
    }, function () {
      var _d = new Date();
      return _d.getFullYear() + '-' + String(_d.getMonth() + 1).padStart(2, '0') + '-' + String(_d.getDate()).padStart(2, '0');
    }());
  }

  function _readIDBStore(storeName) {
    return new Promise(function (resolve) {
      var resolved = false;
      function _resolve(val) {
        if (!resolved) { resolved = true; resolve(val); }
      }
      _try(function () {
        var db = ERP._db;
        if (!db || typeof db.load !== 'function') {
          _logger().warn('[ERP.BackupEngine] _readIDBStore: db.load unavailable for ' + storeName);
          _resolve([]);
          return;
        }
        db.load(storeName).then(function (records) {
          _resolve(Array.isArray(records) ? records : []);
        }).catch(function (err) {
          _logger().error('[ERP.BackupEngine] _readIDBStore failed for ' + storeName + ': ' + (err && err.message || err));
          _resolve([]);
        });
      }, null);
      setTimeout(function () {
        if (!resolved) {
          _logger().warn('[ERP.BackupEngine] _readIDBStore timeout for ' + storeName);
          _resolve([]);
        }
      }, 3000);
    });
  }

  function _writeIDBStore(storeName, records) {
    return new Promise(function (resolve, reject) {
      var resolved = false;
      var timeoutId = setTimeout(function () {
        if (!resolved) {
          resolved = true;
          _logger().error('[ERP.BackupEngine] _writeIDBStore timeout for ' + storeName);
          reject(new Error('IDB_WRITE_TIMEOUT:' + storeName));
        }
      }, 10000);

      _try(function () {
        var db = ERP._db;
        if (!db || typeof db.save !== 'function') {
          clearTimeout(timeoutId);
          if (!resolved) { resolved = true; reject(new Error('IDB_SAVE_UNAVAILABLE:' + storeName)); }
          return;
        }
        if (!Array.isArray(records) || !records.length) {
          clearTimeout(timeoutId);
          if (!resolved) { resolved = true; resolve(); }
          return;
        }
        var chain = Promise.resolve();
        var savedCount = 0;
        var errors = [];
        records.forEach(function (record) {
          chain = chain.then(function () {
            return db.save(storeName, record).then(function () {
              savedCount++;
            }).catch(function (err) {
              errors.push({ store: storeName, error: err && err.message || String(err) });
            });
          });
        });
        chain.then(function () {
          clearTimeout(timeoutId);
          if (!resolved) {
            resolved = true;
            if (errors.length) {
              _logger().warn('[ERP.BackupEngine] _writeIDBStore partial failure for ' + storeName + ': ' + errors.length + ' errors');
            }
            resolve({ saved: savedCount, errors: errors });
          }
        }).catch(function (err) {
          clearTimeout(timeoutId);
          if (!resolved) {
            resolved = true;
            _logger().error('[ERP.BackupEngine] _writeIDBStore chain error for ' + storeName + ': ' + (err && err.message || err));
            reject(err);
          }
        });
      }, null);
    });
  }

  function _djb2(str) {
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
  }

  function _stableStringify(obj) {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) {
      return '[' + obj.map(_stableStringify).join(',') + ']';
    }
    var keys = Object.keys(obj).sort();
    var parts = keys.map(function (k) {
      return JSON.stringify(k) + ':' + _stableStringify(obj[k]);
    });
    return '{' + parts.join(',') + '}';
  }

  function _buildExport() {
    var keys   = {};
    var errors = [];

    EXPORT_KEYS.forEach(function (k) {
      _try(function () {
        var raw = localStorage.getItem(k);
        if (raw === null) return;
        keys[k] = JSON.parse(raw);
      });
      if (!(k in keys)) {
        _try(function () {
          var raw = localStorage.getItem(k);
          if (raw !== null && raw.length > 0) {
            keys[k] = raw;
            errors.push(k + ':raw');
          }
        });
      }
    });

    var keysJson  = _stableStringify(keys);
    var checksum  = _djb2(keysJson);
    var timestamp = _nowISO();

    var envelope = {
      erp_backup_version: BACKUP_VERSION,
      timestamp:          timestamp,
      app:                'MH Autos ERP',
      keys:               keys,
      checksum:           checksum
    };

    envelope.idb = {};

    return {
      envelope:     envelope,
      json:         JSON.stringify(envelope, null, 2),
      keysExported: Object.keys(keys).length,
      errors:       errors,
      timestamp:    timestamp,
      checksum:     checksum,
      version:      BACKUP_VERSION
    };
  }

  function _buildExportWithIDB() {
    var idbPromises = IDB_EXPORT_STORES.map(function (store) {
      return _readIDBStore(store).then(function (records) {
        return { store: store, records: Array.isArray(records) ? records : [] };
      });
    });
    return Promise.all(idbPromises).then(function (idbResults) {
      var base = _buildExport();
      var idb = {};
      idbResults.forEach(function (r) {
        if (r.records.length) idb[r.store] = r.records;
      });
      base.envelope.idb = idb;
      base.json = JSON.stringify(base.envelope, null, 2);
      base.keysExported += Object.keys(idb).length;
      return base;
    });
  }

  function _writeIDBStores(idbData) {
    if (!idbData || typeof idbData !== 'object') return Promise.resolve({ saved: 0, errors: [] });
    var db = ERP._db;
    if (!db || typeof db.save !== 'function') {
      _logger().warn('[ERP.BackupEngine] _writeIDBStores: db.save unavailable');
      return Promise.resolve({ saved: 0, errors: ['DB_SAVE_UNAVAILABLE'] });
    }
    var promises = [];
    Object.keys(idbData).forEach(function (store) {
      var records = idbData[store];
      if (!Array.isArray(records)) return;
      promises.push(_writeIDBStore(store, records));
    });
    return Promise.all(promises).then(function (results) {
      var totalSaved = 0;
      var allErrors = [];
      results.forEach(function (r) {
        if (r && typeof r.saved === 'number') totalSaved += r.saved;
        if (r && Array.isArray(r.errors)) allErrors = allErrors.concat(r.errors);
      });
      return { saved: totalSaved, errors: allErrors };
    });
  }

  function _download(json, filename) {
    _try(function () {
      var blob = new Blob([json], { type: 'application/json' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href     = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        if (a.parentNode) document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    });
  }

  ERP.BackupEngine = {
    _buildExport: function () { return _buildExport(); },
    __phase11_backup: true,
    VERSION: '11.9.2',

    exportToFile: function () {
      return _buildExportWithIDB().then(function (result) {
        var sizeBytes = 0;
        for (var i = 0; i < result.json.length; i++) {
          var code = result.json.charCodeAt(i);
          sizeBytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
        }
        var sizeKB = Math.round(sizeBytes / BYTES_PER_KB * 10) / 10;
        var dateStr = _todayStr();
        var filename = 'mh-autos-backup-' + dateStr + '.json';

        _download(result.json, filename);
        ERP.BackupEngine.recordBackupTaken();

        _auditRecord('export', {
          filename: filename,
          keysExported: result.keysExported,
          sizeKB: sizeKB,
          checksum: result.checksum
        });

        _logger().info('[ERP.BackupEngine] Export complete — ' + result.keysExported + ' keys, ' + sizeKB + 'KB → ' + filename);

        return {
          ok:           true,
          keysExported: result.keysExported,
          sizeKB:       sizeKB,
          filename:     filename,
          checksum:     result.checksum,
          timestamp:    result.timestamp,
          error:        null
        };
      }).catch(function (e) {
        _logger().error('[ERP.BackupEngine] Export failed:', e && e.message);
        return { ok: false, keysExported: 0, sizeKB: 0, error: 'EXPORT_FAILED: ' + (e && e.message || 'Unknown') };
      });
    },

    validateBackup: function (backupJson) {
      return _try(function () {
        var errors   = [];
        var envelope = typeof backupJson === 'string' ? JSON.parse(backupJson) : backupJson;

        if (!envelope || typeof envelope !== 'object') {
          return { valid: false, errors: ['NOT_AN_OBJECT'], keysFound: [] };
        }
        if (envelope.erp_backup_version !== BACKUP_VERSION) {
          errors.push('VERSION_MISMATCH: expected ' + BACKUP_VERSION + ', got ' + envelope.erp_backup_version);
        }
        if (!envelope.keys || typeof envelope.keys !== 'object') {
          errors.push('MISSING_KEYS_OBJECT');
          return { valid: false, errors: errors, keysFound: [] };
        }

        var keysJson         = _stableStringify(envelope.keys);
        var expectedChecksum = _djb2(keysJson);

        var legacyKeysJson    = JSON.stringify(envelope.keys, Object.keys(envelope.keys).sort());
        var legacyChecksum    = _djb2(legacyKeysJson);

        if (envelope.checksum !== expectedChecksum && envelope.checksum !== legacyChecksum) {
          errors.push('CHECKSUM_MISMATCH: file may be corrupted');
        }

        var CRITICAL = [_mainKey(), _auditKey(), 'mh_supplier_ledger',
                        'mh_purchase_store', 'mh_paymentOuts'];
        CRITICAL.forEach(function (k) {
          if (k in envelope.keys) {
            if (envelope.keys[k] === null || envelope.keys[k] === undefined) {
              errors.push(k + ': NULL_VALUE');
            }
          }
        });

        _try(function () {
          var d = envelope.keys[_mainKey()];
          if (d && typeof d !== 'object') errors.push(_mainKey() + ': NOT_AN_OBJECT');
        });

        _try(function () {
          var a = envelope.keys[_auditKey()];
          if (a !== undefined && !Array.isArray(a)) errors.push(_auditKey() + ': NOT_AN_ARRAY');
        });

        var keysFound = Object.keys(envelope.keys);
        return {
          valid:     errors.length === 0,
          errors:    errors,
          keysFound: keysFound
        };
      }, { valid: false, errors: ['VALIDATION_EXCEPTION'], keysFound: [] });
    },

    importFromFile: function (file) {
      return new Promise(function (resolve) {
        if (!_isAdmin()) {
          _logger().warn('[ERP.BackupEngine] Import blocked — Admin role required.');
          return resolve({ ok: false, keysRestored: 0, error: 'PERMISSION_DENIED' });
        }

        var reader = new FileReader();
        reader.onload = function (e) {
          var json;
          var envelope;
          try {
            json = e.target.result;
            envelope = JSON.parse(json);
          } catch (parseErr) {
            _logger().error('[ERP.BackupEngine] Import failed — invalid JSON: ' + (parseErr && parseErr.message || 'Unknown'));
            return resolve({ ok: false, keysRestored: 0, error: 'JSON_PARSE_ERROR: ' + (parseErr && parseErr.message || 'Unknown') });
          }

          var validation = ERP.BackupEngine.validateBackup(envelope);

          if (!validation.valid) {
            _logger().error('[ERP.BackupEngine] Import aborted — validation failed: ' + validation.errors.join(', '));
            return resolve({ ok: false, keysRestored: 0, error: 'VALIDATION_FAILED: ' + validation.errors.join('; ') });
          }

          var preImport = {};
          var preImportIDB = {};
          validation.keysFound.forEach(function (k) {
            _try(function () { preImport[k] = localStorage.getItem(k); });
          });

          var idbCapturePromises = [];
          if (envelope.idb && typeof envelope.idb === 'object') {
            Object.keys(envelope.idb).forEach(function (store) {
              idbCapturePromises.push(
                _readIDBStore(store).then(function (records) {
                  preImportIDB[store] = records;
                }).catch(function () {
                  preImportIDB[store] = [];
                })
              );
            });
          }

          Promise.all(idbCapturePromises).then(function () {
            var keysRestored = 0;
            var writeError   = null;

            try {
              var tx = ERP.transaction;
              if (tx && typeof tx === 'function') {
                keysRestored = tx(function () {
                  var count = 0;
                  validation.keysFound.forEach(function (k) {
                    _try(function () {
                      var val = envelope.keys[k];
                      if (val === undefined || val === null) return;
                      localStorage.setItem(k, typeof val === 'string' ? val : JSON.stringify(val));
                      count++;
                    });
                  });
                  return count;
                }, 'p11:backup:import');
              } else {
                validation.keysFound.forEach(function (k) {
                  var val = envelope.keys[k];
                  if (val === undefined || val === null) return;
                  localStorage.setItem(k, typeof val === 'string' ? val : JSON.stringify(val));
                  keysRestored++;
                });
              }
            } catch (we) {
              writeError = we.message || String(we);
            }

            if (writeError) {
              Object.keys(preImport).forEach(function (k) {
                _try(function () {
                  if (preImport[k] === null) { localStorage.removeItem(k); }
                  else { localStorage.setItem(k, preImport[k]); }
                });
              });
              _logger().error('[ERP.BackupEngine] Import write failed, rolled back: ' + writeError);
              return resolve({ ok: false, keysRestored: 0, error: 'WRITE_FAILED: ' + writeError });
            }

            var idbRestorePromise = (envelope.idb && typeof envelope.idb === 'object')
              ? _writeIDBStores(envelope.idb)
              : Promise.resolve({ saved: 0, errors: [] });

            idbRestorePromise.then(function (idbResult) {
              if (idbResult.errors && idbResult.errors.length) {
                _logger().warn('[ERP.BackupEngine] IDB restore had ' + idbResult.errors.length + ' errors');
              }
              _auditRecord('import', { keysRestored: keysRestored, idbSaved: idbResult.saved, sourceTimestamp: envelope.timestamp });
              _logger().info('[ERP.BackupEngine] Import complete — ' + keysRestored + ' keys restored, ' + (idbResult.saved || 0) + ' IDB records.');
              _try(function () {
                if (window.ERP && ERP.PostingEngine && ERP.PostingEngine._LockManager) {
                  ERP.PostingEngine._LockManager._persistentIndexBuilt = false;
                }
              });
              resolve({ ok: true, keysRestored: keysRestored, idbSaved: idbResult.saved || 0, error: null });
            }).catch(function (idbErr) {
              var rollbackPromises = [];
              Object.keys(preImportIDB).forEach(function (store) {
                rollbackPromises.push(
                  _writeIDBStore(store, preImportIDB[store]).catch(function (rbErr) { console.error('[BackupEngine] rollback write failed for store', store, '— database may be partially restored:', rbErr && rbErr.message || rbErr); })
                );
              });
              Promise.all(rollbackPromises).then(function () {
                Object.keys(preImport).forEach(function (k) {
                  _try(function () {
                    if (preImport[k] === null) { localStorage.removeItem(k); }
                    else { localStorage.setItem(k, preImport[k]); }
                  });
                });
                _logger().error('[ERP.BackupEngine] IDB restore failed, full rollback executed: ' + (idbErr && idbErr.message || 'Unknown'));
                resolve({ ok: false, keysRestored: 0, error: 'IDB_RESTORE_FAILED: ' + (idbErr && idbErr.message || 'Unknown') });
              }).catch(function (rollbackErr) {
                _logger().error('[ERP.BackupEngine] Rollback itself failed: ' + (rollbackErr && rollbackErr.message || rollbackErr));
                resolve({ ok: false, keysRestored: 0, error: 'ROLLBACK_FAILED: ' + (rollbackErr && rollbackErr.message || 'Unknown') });
              });
            });
          }).catch(function (captureErr) {
            _logger().error('[ERP.BackupEngine] Import aborted during pre-restore capture: ' + (captureErr && captureErr.message || captureErr));
            resolve({ ok: false, keysRestored: 0, error: 'CAPTURE_FAILED: ' + (captureErr && captureErr.message || 'Unknown') });
          });
        };
        reader.onerror = function () {
          _logger().error('[ERP.BackupEngine] File read error');
          resolve({ ok: false, keysRestored: 0, error: 'FILE_READ_ERROR' });
        };
        reader.readAsText(file);
      });
    },

    checkReminderDue: function () {
      return _try(function () {
        var raw = localStorage.getItem(BACKUP_REMINDER_KEY);

        if (!raw) {
          var hasData = _try(function () {
            var NON_BUSINESS_KEYS = { users: true, templates: true, coa: true };

            var erpData = _try(function () {
              var v = localStorage.getItem(_mainKey());
              return v ? JSON.parse(v) : null;
            }, null);
            if (erpData && typeof erpData === 'object') {
              var hasErpData = Object.keys(erpData).some(function (k) {
                return !NON_BUSINESS_KEYS[k] && Array.isArray(erpData[k]) && erpData[k].length > 0;
              });
              if (hasErpData) return true;
            }

            var purchaseStore = _try(function () {
              var v = localStorage.getItem('mh_purchase_store');
              return v ? JSON.parse(v) : null;
            }, null);
            if (purchaseStore && purchaseStore.data && typeof purchaseStore.data === 'object') {
              var hasPurchaseData = Object.keys(purchaseStore.data).some(function (k) {
                return !NON_BUSINESS_KEYS[k] && Array.isArray(purchaseStore.data[k]) && purchaseStore.data[k].length > 0;
              });
              if (hasPurchaseData) return true;
            }

            return false;
          }, false);
          if (!hasData) return { shouldRemind: false, daysSinceLastBackup: 0 };
          return { shouldRemind: true, daysSinceLastBackup: null, neverBackedUp: true };
        }

        var lastTs  = parseInt(raw, 10);
        if (isNaN(lastTs) || lastTs <= 0) {
          return { shouldRemind: true, daysSinceLastBackup: null, neverBackedUp: true };
        }
        var nowTs   = Date.now();
        var diffMs  = nowTs - lastTs;
        var diffDays = diffMs / (1000 * 60 * 60 * 24);

        var reminderDays = DEFAULT_REMINDER_DAYS;
        _try(function () {
          var biz = JSON.parse(localStorage.getItem('mh_biz_info') || '{}');
          if (typeof biz.backupReminderDays === 'number' && biz.backupReminderDays > 0) {
            reminderDays = biz.backupReminderDays;
          }
        });

        return {
          shouldRemind:        diffDays >= reminderDays,
          daysSinceLastBackup: Math.round(diffDays * 10) / 10,
          reminderIntervalDays: reminderDays
        };
      }, { shouldRemind: false, daysSinceLastBackup: 0 });
    },

    recordBackupTaken: function () {
      _try(function () {
        localStorage.setItem(BACKUP_REMINDER_KEY, String(Date.now()));
      });
    }
  };

  var _hookedEvents = [];
  (function _wireAutoBackupHooks() {
    _try(function () {
      var bus = ERP.EventBus;
      if (!bus || typeof bus.on !== 'function') return;

      function _sessionSnapshot(reason) {
        _try(function () {
          var result = _buildExport();
          var snapshotData = result.json;
          var maxSnapshotSize = MAX_SESSION_SNAPSHOT_CHARS;

          if (snapshotData.length > maxSnapshotSize) {
            _logger().error('[ERP.BackupEngine] Pre-bulk snapshot for "' + reason + '" exceeds size limit (' +
              snapshotData.length + ' chars) — refusing to store a truncated/unreliable snapshot.');
            bus.emit && bus.emit('backup:snapshotFailed', {
              reason: reason,
              sizeChars: snapshotData.length,
              urgentMessage: 'Pre-bulk safety snapshot for "' + reason + '" could not be saved (too large). ' +
                'Export a full backup manually before proceeding.'
            });
          } else {
            try {
              sessionStorage.setItem(
                'mh_erp_pre_bulk_snapshot',
                JSON.stringify({ reason: reason, ts: Date.now(), data: snapshotData, truncated: false })
              );
              _logger().info('[ERP.BackupEngine] Pre-bulk snapshot stored for: ' + reason);
            } catch (quotaErr) {
              _logger().warn('[ERP.BackupEngine] Pre-bulk snapshot failed (quota exceeded) for: ' + reason);
              bus.emit && bus.emit('backup:snapshotFailed', {
                reason: reason,
                error: 'QUOTA_EXCEEDED',
                urgentMessage: 'Pre-bulk safety snapshot for "' + reason + '" could not be saved (storage full). ' +
                  'Export a full backup manually before proceeding.'
              });
            }
          }

          var check = ERP.BackupEngine.checkReminderDue();
          if (check.shouldRemind) {
            bus.emit && bus.emit('backup:reminder', {
              reason: reason,
              daysSinceLastBackup: check.daysSinceLastBackup,
              urgentMessage: 'Bulk operation "' + reason + '" starting — backup overdue (' + Math.round(check.daysSinceLastBackup || 0) + ' days). Export a backup before proceeding.'
            });
          }
        }, null, '_sessionSnapshot');
      }

      var events = [
        { name: 'period:closing',   handler: function () { _sessionSnapshot('period_close'); } },
        { name: 'yearend:starting', handler: function () { _sessionSnapshot('year_end'); } },
        { name: 'import:starting',  handler: function () { _sessionSnapshot('bulk_import'); } },
        { name: 'cleaner:starting', handler: function () { _sessionSnapshot('erp_cleaner'); } }
      ];

      events.forEach(function (ev) {
        bus.on(ev.name, ev.handler);
        _hookedEvents.push({ bus: bus, event: ev.name, handler: ev.handler });
      });
    }, null, '_wireAutoBackupHooks');
  }());

  ERP.BackupEngine._cleanupHooks = function () {
    _hookedEvents.forEach(function (h) {
      _try(function () {
        if (h.bus && typeof h.bus.off === 'function') {
          h.bus.off(h.event, h.handler);
        }
      });
    });
    _hookedEvents = [];
  };

  ERP.__phase11_backup = true;

  function _bootReminderCheck() {
    _try(function () {
      var flagOff = ERP.FeatureFlags &&
                    typeof ERP.FeatureFlags.get === 'function' &&
                    ERP.FeatureFlags.get('backup_reminder') === false;
      if (flagOff) return;

      var check = ERP.BackupEngine.checkReminderDue();
      if (check.shouldRemind) {
        var daysSummary = (check.neverBackedUp ? 'ever' : check.daysSinceLastBackup + ' days');
        _logger().warn(
          '[ERP.BackupEngine] Backup reminder: no backup for ' + daysSummary +
          '. Please export a backup.'
        );
        ERP.EventBus && ERP.EventBus.emit &&
          ERP.EventBus.emit('backup:reminder', { daysSinceLastBackup: check.daysSinceLastBackup });
      }
    });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(_bootReminderCheck, BOOT_REMINDER_CHECK_DELAY_MS);
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(_bootReminderCheck, BOOT_REMINDER_CHECK_DELAY_MS);
    });
  }

  _logger().info('[ERP.BackupEngine] Phase 11.9 loaded — v11.9.2 (FIXED)');

}(window));
