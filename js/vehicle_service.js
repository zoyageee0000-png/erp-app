
const VehicleService = (function () {
  'use strict';

  let _state   = null;
  let _storage = null;
  let _bus     = null;
  let _deps    = {};
  let _initialized = false;

  function init(state, storage, bus, deps) {
    if (_initialized) {
      console.warn('[VehicleService] init() called more than once — ignored');
      return;
    }
    if (!state || !storage || !bus) {
      throw new Error('[VehicleService] init: state, storage, and bus are required');
    }
    _state   = state;
    _storage = storage;
    _bus     = bus;
    _deps    = deps || {};
    _initialized = true;
  }

  function _notReady(fn) {
    if (!_initialized) { console.error('[VehicleService] ' + fn + ': not initialized'); return true; }
    return false;
  }

  // FIX (root cause, found by independent verification): deleteVehicle was only
  // ever RBAC-gated at the window.deleteVehicle wrapper in module_init.js — but
  // the app's own delete button (vehicle_ui.js's delegated click handler) calls
  // VehicleService.deleteVehicle() directly, bypassing that wrapper entirely.
  // That meant the real, only user-facing path to delete a vehicle had zero
  // auth/role check. Matches job_service.js's own established convention:
  // authorization must be enforced at the service entry point itself, not just
  // at a UI-layer wrapper that a real call path can (and does) route around.
  // Fails CLOSED (blocks) if Auth or permissions modules are missing, same as
  // job_service.js's _authBlocked() and PostingEngine's fail-closed checks.
  function _authBlocked(fnName, action) {
    var auth = window.ERP && window.ERP.Auth;
    if (!auth || typeof auth.isAuthenticated !== 'function') {
      console.warn('[Security] Auth module unavailable — blocking call to VehicleService.' + fnName);
      _toast('You must be logged in to perform this action', 'error');
      return true;
    }
    if (!auth.isAuthenticated()) {
      console.warn('[Security] Unauthorized call to VehicleService.' + fnName);
      _toast('You must be logged in to perform this action', 'error');
      return true;
    }
    if (action) {
      var perms = window.ERP && window.ERP.permissions;
      if (!perms || typeof perms.canDo !== 'function' || !perms.canDo(action)) {
        console.warn('[Security] Permission denied for VehicleService.' + fnName + ' (action: ' + action + ')');
        _toast('You do not have permission to perform this action', 'error');
        return true;
      }
    }
    return false;
  }

  function _toast(msg, type, dur) {
    if (typeof _deps.showToast === 'function') _deps.showToast(msg, type || 'info', dur);
  }

  function _esc(str) {
    if (typeof _deps.escapeHtml === 'function') return _deps.escapeHtml(str);
    return String(str || '').replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
    });
  }

  // ARCHITECTURAL REFACTOR: single choke point for all IndexedDB +
  // localStorage writes. This is also what closed the old gap where
  // 'vehicles' reached localStorage but never IndexedDB.
  function _persist() {
    try {
      ERP.Persistence.schedule();
    } catch (e) {
      console.error('[VehicleService] persist failed:', e);
      _bus.emit(_bus.EVENTS.STORAGE_ERROR, { error: e });
      _toast('Save failed!', 'error');
    }
    _bus.emit(_bus.EVENTS.VEHICLES_CHANGED, { vehicles: _state.getVehicles() });
  }

  function _readForm() {
    function _v(id1, id2) {
      const el = document.getElementById(id1) || (id2 ? document.getElementById(id2) : null);
      return el ? el.value.trim() : '';
    }

    const plateEl = document.getElementById('v-plate') || document.getElementById('veh-plate');
    let plate = plateEl ? plateEl.value.trim().toUpperCase() : '';
    if (plateEl) plateEl.value = plate;

    const scoreEl = document.getElementById('v-score') || document.getElementById('v-condition') || document.getElementById('veh-condition');
    let score = parseFloat(scoreEl ? scoreEl.value : '5') || 5;
    score = Math.min(10, Math.max(1, score));
    if (scoreEl) scoreEl.value = score;

    const model = _v('v-model', 'veh-model');

    if (!plate) return { error: 'Plate number zaroori hai', data: null };
    if (!model) return { error: 'Model zaroori hai', data: null };

    const lastService = _v('v-last', 'v-last-service');

    let nextService = _v('v-next');
    if (!nextService && lastService) {
      const d = new Date(lastService + 'T12:00:00');
      d.setMonth(d.getMonth() + 6);
      const _dd = d;
      nextService = _dd.getFullYear() + '-' + String(_dd.getMonth() + 1).padStart(2, '0') + '-' + String(_dd.getDate()).padStart(2, '0');
    }

    return {
      error: null,
      data: {
        plate,
        model,
        year:          parseInt(_v('v-year'), 10) || '',
        cust:          _v('v-cust'),
        chassis:       _v('v-chassis'),
        engine:        _v('v-engine'),
        km:            parseInt(_v('v-km'), 10) || 0,
        conditionScore: score,
        conditionScoreManual: true,
        lastService,
        nextService,
        notes:         _v('v-notes'),
      },
    };
  }

  var _vehicleSaving = false;
  function saveVehicle(btn, editPlate) {
    if (_notReady('saveVehicle')) return;
    if (_vehicleSaving) return;
    _vehicleSaving = true;
    if (btn) { btn.disabled = true; }
    try {
      const form = _readForm();
      if (form.error) { _toast(form.error, 'error'); return; }

      const fd = form.data;

      if (_state.plateExists(fd.plate, editPlate)) {
        _toast('⚠️ Vehicle with plate "' + fd.plate + '" already exists!', 'error');
        const plateEl = document.getElementById('v-plate');
        if (plateEl) plateEl.focus();
        return;
      }

      if (typeof _deps.snapshot === 'function') {
        try { _deps.snapshot('Vehicle saved: ' + fd.plate); } catch (e) {}
      }

      if (editPlate) {
        const existing = _state.findVehicle(editPlate);
        const kmHist   = (existing ? existing.kmHistory : null) || [];

        const mergedKmHist = kmHist.slice();
        if (fd.km > 0 && existing && fd.km !== existing.km &&
            !mergedKmHist.some(function (h) { return h.km === fd.km; })) {
          mergedKmHist.push({ km: fd.km, date: (function(){ var _d=new Date(); return _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0'); })() });
        }

        const merged = Object.assign({}, fd, {
          kmHistory: mergedKmHist,
          chassis:   fd.chassis || (existing ? existing.chassis : ''),
          engine:    fd.engine  || (existing ? existing.engine  : ''),
        });

        if (editPlate && fd.plate !== editPlate.trim().toUpperCase()) {
          const oldPlate = editPlate.trim().toUpperCase();
          const newPlate = fd.plate;
          try {
            const updateJobFn = (typeof JobState !== 'undefined' && typeof JobState.updateJob === 'function')
              ? function (id) { JobState.updateJob(id, { plate: newPlate }); }
              : null;
            const getJobsFn = _deps.getJobs ||
              (typeof JobState !== 'undefined' ? JobState.getJobs : null);
            if (typeof getJobsFn === 'function' && updateJobFn) {
              getJobsFn().forEach(function (j) {
                if ((j.plate || '').trim().toUpperCase() === oldPlate) {
                  updateJobFn(j.id);
                }
              });
            }
          } catch (_plateErr) {
            console.warn('[VehicleService] plate-change job update error (non-fatal):', _plateErr);
          }
        }

        _state.updateVehicle(editPlate, merged);
        _toast('Vehicle updated!', 'success');
      } else {
        const newVehicle = Object.assign({}, fd, {
          kmHistory: fd.km > 0
            ? [{ km: fd.km, date: (function(){ var _d=new Date(); return _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0'); })() }]
            : [],
        });
        _state.addVehicle(newVehicle);
        _toast('Vehicle added!', 'success');
      }

      _persist();

      if (btn && btn.closest) {
        const overlay = btn.closest('.modal-overlay');
        if (overlay) overlay.remove();
      }

    } catch (e) {
      console.error('[VehicleService] saveVehicle error:', e);
      _toast('Failed to save vehicle: ' + (e.message || e), 'error');
    } finally {
      _vehicleSaving = false;
      if (btn) { btn.disabled = false; }
    }
  }

  function deleteVehicle(plate) {
    if (_notReady('deleteVehicle')) return;
    if (_authBlocked('deleteVehicle', 'deleteVehicle')) return;

    try {
      const activeJobs = (typeof JobState !== 'undefined')
        ? JobState.getJobs().filter(function (j) {
            return (j.plate || '').trim().toUpperCase() === plate.trim().toUpperCase() &&
                   j.status !== 'delivered' && j.status !== 'cancelled';
          })
        : [];
      var _msg = activeJobs.length > 0
        ? 'Vehicle ' + plate + ' ke ' + activeJobs.length + ' active job(s) hain: ' + activeJobs.map(function(j){return j.id;}).join(', ') + '. Delete karne se in jobs ka vehicle reference remove ho jayega. Phir bhi delete karein?'
        : 'Vehicle ' + plate + ' delete karein?';
      var _confirmFn = (window.ERP && window.ERP.confirmDialog) || function(msg, ok) { if (window.confirm(msg)) ok(); };
      _confirmFn(_msg, function() { _doDeleteVehicle(plate); });
    } catch (e) {
      var _fallbackConfirm = (window.ERP && window.ERP.confirmDialog) || function(msg, ok) { if (window.confirm(msg)) ok(); };
      _fallbackConfirm('Vehicle ' + plate + ' delete karein?', function() { _doDeleteVehicle(plate); });
    }
  }

  function _doDeleteVehicle(plate) {
    try {
      const removed = _state.deleteVehicle(plate);
      if (!removed) { _toast('Vehicle not found', 'error'); return; }
      _persist();
      _toast('Vehicle deleted', 'success');
      if (typeof AuditTrail !== 'undefined') {
        AuditTrail.record('vehicles', plate, 'delete', { plate: plate }, null);
      }
    } catch (e) {
      console.error('[VehicleService] deleteVehicle error:', e);
    }
  }

  function saveVehicleKm(plate, btn) {
    if (_notReady('saveVehicleKm')) return;
    try {
      const kmEl = document.getElementById('km-input');
      const km   = parseInt(kmEl ? kmEl.value : '0', 10) || 0;
      if (km <= 0) { _toast('KM value 0 se zyada honi chahiye', 'error'); return; }

      const updated = _state.updateKm(plate, km);
      if (!updated) { _toast('Vehicle not found', 'error'); return; }

      if (km > 0 && !updated.conditionScoreManual) {
        const penalty   = Math.floor(km / 50000);
        const absScore  = Math.max(1, Math.min(10, 10 - penalty));
        const curScore  = updated.conditionScore !== undefined ? updated.conditionScore : 10;
        if (absScore !== curScore) {
          _state.updateVehicle(plate, Object.assign({}, updated, { conditionScore: absScore }));
        }
      }

      _persist();

      if (btn && btn.closest) {
        const overlay = btn.closest('.modal-overlay');
        if (overlay) overlay.remove();
      }
      _toast('KM updated', 'success');
    } catch (e) {
      console.error('[VehicleService] saveVehicleKm error:', e);
    }
  }

  function buildHistoryHtml(plate) {
    try {
      const v       = _state.findVehicle(plate);
      if (!v) return null;
      const relJobs = _state.getJobsForPlate(plate);
      const stConf  = _deps.statusConf || {};

      let html =
        '<div style="padding:20px">' +
        '<h3 style="margin-bottom:12px">📋 Vehicle History: ' + _esc(plate) + ' — ' + _esc(v.model) + '</h3>' +
        '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:16px;font-size:13px">' +
          '<div><b>Owner:</b> '        + _esc(v.cust || '')        + '</div>' +
          '<div><b>Year:</b> '         + _esc(v.year || '')        + '</div>' +
          '<div><b>Current KM:</b> '   + (v.km || 0).toLocaleString() + ' km</div>' +
          '<div><b>Condition:</b> '    + (v.conditionScore ? v.conditionScore + '/10' : 'N/A') + '</div>' +
          '<div><b>Last Service:</b> ' + _esc(v.lastService || '—') + '</div>' +
          '<div><b>Next Service:</b> ' + _esc(v.nextService || '—') + '</div>' +
        '</div>';

      if (relJobs.length) {
        html += '<h4 style="margin-bottom:8px">Service History (' + relJobs.length + ' jobs)</h4>' +
          '<table class="dt"><thead><tr>' +
            '<th>Job ID</th><th>Date</th><th>Problem</th><th>Status</th><th>Total</th>' +
          '</tr></thead><tbody>';

        relJobs.forEach(function (j) {
          const partsTotal = (j.parts || []).reduce(function (s, p) {
            const q = Number(p.q) || 0;
            const pr = Number(p.p) || 0;
            return s + q * pr;
          }, 0);
          const lab = Number(j.lab) || 0;
          const dis = Number(j.dis) || 0;
          const total = Math.max(0, partsTotal + lab - dis);
          const displayTotal = isNaN(total) ? 0 : total;
          const sc = stConf[j.status] || { cls: 'b-gray', l: j.status || 'unknown' };
          html +=
            '<tr>' +
              '<td class="mono">' + _esc(j.id) + '</td>' +
              '<td>' + _esc(j.date || '—') + '</td>' +
              '<td>' + _esc((j.prob || '').substring(0, 35)) + (j.prob && j.prob.length > 35 ? '...' : '') + '</td>' +
              '<td><span class="badge ' + sc.cls + '">' + sc.l + '</span></td>' +
              '<td class="mono">' + ((window.ERP && typeof window.ERP.fmt === 'function') ? window.ERP.fmt(displayTotal) : 'Rs.' + displayTotal.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + '</td>' +
            '</tr>';
        });
        html += '</tbody></table>';
      } else {
        html += '<p style="color:var(--muted)">No service history found</p>';
      }
      html += '</div>';
      return html;
    } catch (e) {
      console.error('[VehicleService] buildHistoryHtml error:', e);
      return null;
    }
  }

  function sendVehicleHistoryWA(plate) {
    try {
      const v = _state.findVehicle(plate);
      if (!v) { _toast('Vehicle not found', 'error'); return; }

      const relJobs = _state.getJobsForPlate(plate).slice(0, 8);
      let msg = '*' + (_deps.bizName || 'MH Autos Workshop') + ' — Vehicle History*\n\n';
      msg += '*Vehicle:* ' + (v.model || '') + ' ' + (v.year || '') + '\n';
      msg += '*Plate:* '   + plate + '\n';
      msg += '*Owner:* '   + (v.cust || '') + '\n';
      msg += '*Current KM:* ' + (v.km || 0).toLocaleString() + ' km\n';
      if (v.lastService) msg += '*Last Service:* ' + v.lastService + '\n';
      if (v.nextService) msg += '*Next Service Due:* ' + v.nextService + '\n';

      if (relJobs.length) {
        msg += '\n*Service History (' + relJobs.length + ' jobs):*\n';
        relJobs.forEach(function (j) {
          const partsTotal = (j.parts || []).reduce(function (s, p) {
            return s + (Number(p.q) || 0) * (Number(p.p) || 0);
          }, 0);
          const total = Math.max(0, partsTotal + (Number(j.lab) || 0) - (Number(j.dis) || 0));
          msg += '• ' + j.id + ' | ' + j.date + ' | ' +
            (j.prob || '').substring(0, 35) + '... | ' + ((window.ERP && typeof window.ERP.fmt === 'function') ? window.ERP.fmt(total) : 'Rs.' + total.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + '\n';
        });
      } else {
        msg += '\nNo service history found.\n';
      }
      msg += '\n_Sent from MH Autos ERP_';

      let phone = '';
      if (v.cust && typeof _deps.getCustomers === 'function') {
        const customers = _deps.getCustomers();
        const custObj   = customers && customers.find(function (c) {
          return (c.name || c.n || '').toLowerCase() === (v.cust || '').toLowerCase();
        });
        if (custObj) {
          const ph = custObj.phone || custObj.ph || '';
          if (typeof _deps.formatPhone === 'function') {
            phone = _deps.formatPhone(ph) || '';
          } else {
            const cleaned = String(ph).replace(/[^0-9+]/g, '');
            if (/^03\d{9}$/.test(cleaned)) {
              phone = '92' + cleaned.substring(1);
            } else if (cleaned.startsWith('+')) {
              phone = cleaned.substring(1);
            } else {
              phone = cleaned;
            }
          }
        }
      }

      // FIX (root cause, audit #96): route through the one canonical wa.me builder/opener
      // (this also gains the pop-up-blocked fallback the other call sites already had).
      if (window.ERP && ERP.WhatsAppLink && typeof ERP.WhatsAppLink.open === 'function') {
        ERP.WhatsAppLink.open(phone, msg);
      } else {
        window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(msg), '_blank');
      }
    } catch (e) {
      console.error('[VehicleService] sendVehicleHistoryWA error:', e);
      _toast('Failed to open WhatsApp', 'error');
    }
  }

  function exportVehiclesExcel() {
    try {
      if (typeof XLSX === 'undefined') {
        _toast('Excel library (SheetJS) not loaded. Please ensure the XLSX script is included in your HTML.', 'error', 6000);
        return;
      }
      const data = _state.getVehicles().map(function (v) {
        return {
          Plate:        v.plate,
          Model:        v.model,
          Year:         v.year,
          Customer:     v.cust,
          KM:           v.km || 0,
          Condition:    v.conditionScore || '',
          LastService:  v.lastService,
          NextService:  v.nextService,
          Chassis:      v.chassis || '',
          Engine:       v.engine  || '',
        };
      });
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Vehicles');
      XLSX.writeFile(wb, 'MH_Vehicles.xlsx');
      _toast('Excel exported', 'success');
    } catch (e) {
      console.error('[VehicleService] exportVehiclesExcel error:', e);
      _toast('Excel export failed', 'error');
    }
  }

  function printVehicleDetails(plate) {
    try {
      const html = buildHistoryHtml(plate);
      if (!html) { _toast('Vehicle not found', 'error'); return; }

      const _phEsc = function (s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      };

      const pw = window.open('', '_blank', 'width=840,height=680');
      if (!pw) { window.print(); return; }

      const ph =
        '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Vehicle History: ' + _phEsc(plate) + '</title>' +
        '<style>body{font-family:Segoe UI,Inter,system-ui,Arial,sans-serif;padding:20px;color:#0f172a}' +
        'table{width:100%;border-collapse:collapse;font-size:12px}' +
        'th{background:#f1f5f9;padding:7px 10px;text-align:left;border-bottom:2px solid #e2e8f0}' +
        'td{padding:7px 10px;border-bottom:1px solid #f1f5f9}' +
        '.badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700}' +
        '@media print{.noprint{display:none}}</style></head><body>' +
        html +
        '<div class="noprint" style="text-align:center;padding:14px">' +
        '<button onclick="window.print()" style="background:#1e3a5f;color:#fff;border:none;padding:9px 24px;border-radius:8px;font-size:13px;cursor:pointer;margin:4px">&#128438; Print</button>' +
        '<button onclick="window.close()" style="background:#64748b;color:#fff;border:none;padding:9px 18px;border-radius:8px;font-size:13px;cursor:pointer;margin:4px">&times; Close</button>' +
        '</div></body></html>';

      pw.document.open();
      pw.document.write(ph);
      pw.document.close();
    } catch (e) {
      console.error('[VehicleService] printVehicleDetails error:', e);
      _toast('Print failed', 'error');
    }
  }

  return {
    init,
    saveVehicle,
    deleteVehicle,
    saveVehicleKm,
    buildHistoryHtml,
    printVehicleDetails,
    sendVehicleHistoryWA,
    exportVehiclesExcel,
  };

})();

if (typeof window !== "undefined") window.VehicleService = VehicleService;
