const HealthMonitor = (function () {
  'use strict';

  function storageUsage() {
    try {
      let totalBytes = 0;
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k === null || k === undefined) continue;
        const v = localStorage.getItem(k) || '';
        const bytes = (k.length + v.length) * 2;
        totalBytes += bytes;
        keys.push({ key: k, bytes: bytes, kb: (bytes / 1024).toFixed(1) });
      }
      keys.sort(function (a, b) { return b.bytes - a.bytes; });
      const totalKb = (totalBytes / 1024).toFixed(1);
      const limitKb = 5 * 1024;
      const usedPct = ((totalBytes / (limitKb * 1024)) * 100).toFixed(1);
      return { totalKb: totalKb, usedPercent: usedPct + '%', keys: keys.slice(0, 10) };
    } catch (e) {
      return { error: e.message };
    }
  }

  function stateIntegrity() {
    const issues = [];
    try {
      const jobs = (typeof JobState !== 'undefined') ? JobState.getJobs() : [];
      const vehs = (typeof VehicleState !== 'undefined') ? VehicleState.getVehicles() : [];
      const apts = (typeof AppointmentState !== 'undefined') ? AppointmentState.getAppointments() : [];

      jobs.forEach(function (j) {
        if (!j.id) issues.push({ type: 'job', severity: 'HIGH', msg: 'Job without ID found' });
      });

      const jobIds = jobs.map(function (j) { return j.id; }).filter(function (id) { return !!id; });
      const seen = new Set();
      const dupSet = new Set();
      jobIds.forEach(function (id) {
        if (seen.has(id)) dupSet.add(id);
        seen.add(id);
      });
      if (dupSet.size) issues.push({ type: 'job', severity: 'CRITICAL', msg: 'Duplicate job IDs: ' + Array.from(dupSet).join(', ') });

      const plateset = new Set(vehs.map(function (v) { return v.plate; }));
      jobs.forEach(function (j) {
        if (j.plate && j.plate !== '—' && !plateset.has(j.plate)) {
          issues.push({ type: 'job', severity: 'MEDIUM', msg: 'Job ' + j.id + ' references unknown plate: ' + j.plate });
        }
      });

      const jobIdSet = new Set(jobIds);
      apts.forEach(function (a) {
        if (a.sourceJobId && !jobIdSet.has(a.sourceJobId)) {
          issues.push({ type: 'appointment', severity: 'MEDIUM', msg: 'Appt ' + a.id + ' sourceJobId ' + a.sourceJobId + ' not found in jobs' });
        }
      });

      const validStatuses = ['pending', 'in-progress', 'waiting-parts', 'completed', 'delivered', 'cancelled'];
      jobs.forEach(function (j) {
        if (j.status && !validStatuses.includes(j.status)) {
          issues.push({ type: 'job', severity: 'MEDIUM', msg: 'Job ' + j.id + ' has invalid status: ' + j.status });
        }
      });
    } catch (e) {
      issues.push({ type: 'system', severity: 'ERROR', msg: 'Integrity check failed: ' + e.message });
    }
    return {
      ok: issues.length === 0,
      issues: issues,
      summary: issues.length === 0 ? '✅ No integrity issues found' : '⚠️ ' + issues.length + ' issue(s) found',
    };
  }

  function eventBusMetrics() {
    if (typeof EventBus === 'undefined') return { error: 'EventBus not loaded' };
    const events = ['jobs:changed', 'jobs:selected', 'vehicles:changed', 'appointments:changed', 'storage:error'];
    const result = {};
    events.forEach(function (e) {
      try {
        result[e] = typeof EventBus.listenerCount === 'function' ? EventBus.listenerCount(e) : 'N/A';
      } catch (err) {
        result[e] = 'error: ' + err.message;
      }
    });
    return result;
  }

  function safeCount(getter) {
    try {
      return getter();
    } catch (e) {
      return 'N/A';
    }
  }

  function check() {
    const report = {
      timestamp: new Date().toISOString(),
      storage: storageUsage(),
      integrity: stateIntegrity(),
      eventBus: eventBusMetrics(),
      counts: {
        jobs: safeCount(function () { return (typeof JobState !== 'undefined') ? JobState.getJobs().length : 'N/A'; }),
        vehicles: safeCount(function () { return (typeof VehicleState !== 'undefined') ? VehicleState.getVehicles().length : 'N/A'; }),
        appointments: safeCount(function () { return (typeof AppointmentState !== 'undefined') ? AppointmentState.getAppointments().length : 'N/A'; }),
      },
    };
    console.group('🔍 MH Autos ERP Health Report — ' + report.timestamp);
    if (window.DEBUG_MODE) console.log('Storage:', report.storage);
    if (window.DEBUG_MODE) console.log('Integrity:', report.integrity.summary, report.integrity.issues);
    if (window.DEBUG_MODE) console.log('EventBus Listeners:', report.eventBus);
    if (window.DEBUG_MODE) console.log('Record Counts:', report.counts);
    console.groupEnd();
    return report;
  }

  function accountingReconcile() {
    const issues = [];
    try {
      const ledger = window.ERP && ERP.Ledger && ERP.Ledger.GeneralLedger && typeof ERP.Ledger.GeneralLedger.getAllJournals === 'function'
        ? ERP.Ledger.GeneralLedger.getAllJournals() : null;
      if (ledger) {
        ledger.forEach(function (j) {
          const dr = (j.entries || []).reduce(function (s, e) { return s + (Number(e.debit) || 0); }, 0);
          const cr = (j.entries || []).reduce(function (s, e) { return s + (Number(e.credit) || 0); }, 0);
          if (Math.abs(dr - cr) > 0) {
            issues.push({ type: 'IMBALANCED_JOURNAL', id: j.id, dr, cr, diff: dr - cr });
          }
        });
      }

      const inv = window.ERP && typeof ERP.getState === 'function'
        ? ((ERP.getState().data || {}).inventory || []) : [];
      inv.forEach(function (item) {
        if ((Number(item.st) || 0) < 0) {
          issues.push({ type: 'NEGATIVE_STOCK', bc: item.bc, name: item.n, qty: item.st });
        }
      });

      if (ledger) {
        const revKeys = new Set(ledger.filter(function (j) { return (j.documentId || '').indexOf('SALE-REV-') === 0; }).map(function (j) { return j.documentId.replace('SALE-REV-', ''); }));
        const cogsKeys = new Set(ledger.filter(function (j) { return (j.documentId || '').indexOf('SALE-COGS-') === 0; }).map(function (j) { return j.documentId.replace('SALE-COGS-', ''); }));
        revKeys.forEach(function (id) {
          if (!cogsKeys.has(id)) issues.push({ type: 'MISSING_COGS_JOURNAL', saleId: id });
        });
        cogsKeys.forEach(function (id) {
          if (!revKeys.has(id)) issues.push({ type: 'MISSING_REV_JOURNAL', saleId: id });
        });
      }

      if (window.AuditTrail && typeof AuditTrail.verifyChain === 'function') {
        AuditTrail.verifyChain().then(function (result) {
          if (!result.ok && result.breaks.length > 0) {
            if (window.ERP && ERP.Logger) ERP.Logger.error('[HealthMonitor] Audit chain breaks:', result.breaks);
          }
      }).catch(function (e) { if (window.DEBUG_MODE) console.warn('[HealthMonitor] audit chain verify failed:', e && e.message || e); });
      }
    } catch (e) {
      issues.push({ type: 'RECONCILE_ERROR', msg: e.message });
    }

    return {
      ok: issues.length === 0,
      issues: issues,
      summary: issues.length === 0 ? '✅ Accounting reconciliation passed' : '🔴 ' + issues.length + ' reconciliation issue(s)',
    };
  }

  (function _wirePostTransactionChecks() {
    let attempts = 0;
    const maxAttempts = 20;
    const retryDelayMs = 250;

    function attachListeners(bus) {
      let throttle = null;
      function debouncedReconcile() {
        if (throttle) clearTimeout(throttle);
        throttle = setTimeout(function () {
          throttle = null;
          const result = accountingReconcile();
          if (!result.ok) {
            result.issues.forEach(function (issue) {
              if (window.ERP && ERP.Logger) ERP.Logger.warn('[HealthMonitor][PostTx]', issue);
            });
          }
        }, 1500);
      }
      bus.on('posting:journal:posted', debouncedReconcile);
      bus.on('posting:journal:reversed', debouncedReconcile);
    }

    function tryWire() {
      try {
        const bus = window.ERP && ERP.EventBus;
        if (bus && typeof bus.on === 'function') {
          attachListeners(bus);
          return;
        }
      } catch (_) {}
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(tryWire, retryDelayMs);
      }
    }

    tryWire();
  }());

  const api = { check, storageUsage, stateIntegrity, eventBusMetrics, accountingReconcile };

  if (typeof window !== 'undefined') {
    window.MH_Health = api;
  }

  return api;
})();
