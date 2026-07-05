const AppointmentService = (function () {
  'use strict';

  let _state   = null;
  let _storage = null;
  let _bus     = null;
  let _deps    = {};
  let _initialized = false;
  let _isSaving = false;
  let _pendingJobSavedListener = null;

  function init(state, storage, bus, deps) {
    if (_initialized) {
      console.warn('[ApptService] init() called more than once — ignored');
      return false;
    }
    if (!state || !storage || !bus) {
      throw new Error('[ApptService] init: state, storage, and bus are required');
    }
    _state   = state;
    _storage = storage;
    _bus     = bus;
    _deps    = deps || {};
    _initialized = true;
    return true;
  }

  function _notReady(fn) {
    if (!_initialized) {
      console.error('[ApptService] ' + fn + ': not initialized');
      return true;
    }
    return false;
  }

  function _toast(msg, type, dur) {
    if (typeof _deps.showToast === 'function') _deps.showToast(msg, type || 'info', dur);
  }

  // FIX (root cause, found by independent verification): deleteAppointment was
  // only ever RBAC-gated at the window.deleteAppointment wrapper in
  // module_init.js — but the app's own delete button (appointment_ui.js's
  // delegated click handler) calls AppointmentService.deleteAppointment()
  // directly, bypassing that wrapper entirely. That meant the real, only
  // user-facing path to delete an appointment had zero auth/role check.
  // Matches job_service.js's own established convention: authorization must be
  // enforced at the service entry point itself, not just at a UI-layer wrapper
  // that a real call path can (and does) route around. Fails CLOSED (blocks)
  // if Auth or permissions modules are missing.
  function _authBlocked(fnName, action) {
    var auth = window.ERP && window.ERP.Auth;
    if (!auth || typeof auth.isAuthenticated !== 'function') {
      console.warn('[Security] Auth module unavailable — blocking call to AppointmentService.' + fnName);
      _toast('You must be logged in to perform this action', 'error');
      return true;
    }
    if (!auth.isAuthenticated()) {
      console.warn('[Security] Unauthorized call to AppointmentService.' + fnName);
      _toast('You must be logged in to perform this action', 'error');
      return true;
    }
    if (action) {
      var perms = window.ERP && window.ERP.permissions;
      if (!perms || typeof perms.canDo !== 'function' || !perms.canDo(action)) {
        console.warn('[Security] Permission denied for AppointmentService.' + fnName + ' (action: ' + action + ')');
        _toast('You do not have permission to perform this action', 'error');
        return true;
      }
    }
    return false;
  }

  function _persist() {
    let storageOk = true;
    try {
      const providers = _deps.getProviders ? (_deps.getProviders() || {}) : (_deps.providers || {});
      _storage.schedule(providers);
    } catch (e) {
      storageOk = false;
      console.error('[ApptService] storage.schedule failed:', e);
      _bus.emit(_bus.EVENTS.STORAGE_ERROR, { error: e });
      _toast('Save failed! Data may be lost on refresh.', 'error');
    }
    if (storageOk) {
      _bus.emit(_bus.EVENTS.APPOINTMENTS_CHANGED, {
        appointments: _state.getAppointments(),
      });
    }
    return storageOk;
  }

  function _vehicleExists(plate) {
    if (!plate) return true;
    try {
      const vState = typeof VehicleState !== 'undefined' ? VehicleState : null;
      if (!vState || typeof vState.getVehicles !== 'function') return true;
      const vehs = vState.getVehicles() || [];
      const norm = String(plate).toUpperCase().trim();
      return vehs.some(function (v) { return (v.plate || '').toUpperCase().trim() === norm; });
    } catch (e) {
      console.warn('[ApptService] _vehicleExists: lookup failed, allowing booking to proceed', e);
      return true;
    }
  }

  function _readForm() {
    function _v(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }

    const time24  = _v('a-time');
    const cust    = _v('a-cust');
    const service = _v('a-service');
    const date    = _v('a-date');

    if (!time24 || !cust || !service || !date) {
      return { error: 'Date, Time, Customer aur Service zaroori hain!', data: null };
    }

    const parts = time24.split(':');
    let h = parseInt(parts[0], 10);
    const mm = (parts[1] || '00').padStart(2, '0');
    if (h === 24) h = 0;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12  = h % 12 || 12;
    const displayTime = h12 + ':' + mm + ' ' + ampm;

    const mechanic  = _v('appt-mechanic') || _v('a-mec') || '';
    const bufferMin = parseInt(_v('a-buffer'), 10) || 30;
    const vehicle   = _v('a-vehicle') || '';

    return {
      error: null,
      data: {
        date,
        time:      displayTime,
        time24:    time24,
        cust,
        vehicle,
        service,
        mechanic,
        bufferMin,
      },
    };
  }

  function saveAppointment(btn, editId) {
    if (_notReady('saveAppointment')) return;
    if (_isSaving) {
      _toast('Please wait, saving in progress...', 'warning');
      return;
    }
    _isSaving = true;
    try {
      const form = _readForm();
      if (form.error) {
        _toast(form.error, 'error');
        _isSaving = false;
        return;
      }

      const fd = form.data;

      if (fd.vehicle && !_vehicleExists(fd.vehicle)) {
        _toast('Vehicle plate "' + fd.vehicle + '" not found in vehicle registry', 'error', 5000);
        _isSaving = false;
        return;
      }

      const conflict = fd.mechanic && _state.findConflict(fd.date, fd.time, fd.mechanic, editId, fd.bufferMin);
      if (conflict) {
        _toast(
          '⚠️ Conflict: ' + fd.mechanic + ' already has an appointment at ' +
          fd.time + ' on ' + fd.date + ' (Ref: ' + conflict.id + ')',
          'error', 6000
        );
        _isSaving = false;
        return;
      }

      if (typeof _deps.snapshot === 'function') {
        try {
          _deps.snapshot('Appointment saved: ' + fd.cust + ' ' + fd.date);
        } catch (e) {
          console.warn('[ApptService] saveAppointment: snapshot() failed', e);
        }
      }

      let saved;
      if (editId) {
        const existing = _state.findAppt(editId);
        const merged = Object.assign({}, fd, {
          id:        editId,
          status:    existing ? existing.status : 'pending',
          createdAt: existing ? existing.createdAt : ERP.DateUtils.now(),
          updatedAt: ERP.DateUtils.now(),
        });
        saved = _state.updateAppt(editId, merged);
      } else {
        const newAppt = Object.assign({}, fd, {
          status:    'pending',
          createdAt: ERP.DateUtils.now(),
        });
        saved = _state.addAppt(newAppt);
      }

      if (!saved) {
        _toast('Appointment could not be saved', 'error');
        _isSaving = false;
        return;
      }

      const persisted = _persist();

      if (persisted) {
        if (btn && btn.closest) {
          const overlay = btn.closest('.modal-overlay');
          if (overlay) overlay.remove();
        }
        _toast('Appointment ' + (editId ? 'updated' : 'booked') + '!', 'success');
      }
      _isSaving = false;

    } catch (e) {
      console.error('[ApptService] saveAppointment error:', e);
      _toast('Failed to save appointment', 'error');
      _isSaving = false;
    }
  }

  function updateApptStatus(id, status) {
    if (_notReady('updateApptStatus')) return;
    try {
      if (!_state.VALID_STATUSES.includes(status)) {
        _toast('Invalid status: ' + status, 'error');
        return;
      }
      const updated = _state.setApptStatus(id, status);
      if (!updated) { _toast('Appointment not found', 'error'); return; }
      if (_persist()) _toast('Status updated', 'success');
    } catch (e) {
      console.error('[ApptService] updateApptStatus error:', e);
    }
  }

  function deleteAppointment(id) {
    if (_notReady('deleteAppointment')) return;
    if (_authBlocked('deleteAppointment', 'deleteAppointment')) return;
    const _apptConfirm = (window.ERP && window.ERP.confirmDialog) || function(msg, ok) { if (window.confirm(msg)) ok(); };
    _apptConfirm('Is appointment ko delete karna chahte hain?', function() {
      try {
        const removed = _state.deleteAppt(id);
        if (!removed) { _toast('Appointment not found', 'error'); return; }
        if (_persist()) _toast('Appointment deleted', 'success');
      } catch (e) {
        console.error('[ApptService] deleteAppointment error:', e);
      }
    });
  }

  function convertApptToJob(apptId) {
    if (_notReady('convertApptToJob')) return;
    try {
      const appt = _state.findAppt(apptId);
      if (!appt) { _toast('Appointment not found', 'error'); return; }

      if (typeof _deps.openJobModal === 'function') {
        _deps.openJobModal();
      }

      const prefill = function () {
        if (typeof _deps.prefillJobForm === 'function') {
          _deps.prefillJobForm(appt);
        } else {
          _fillJobFormFromAppt(appt);
        }
      };

      let filled = false;
      const observer = new MutationObserver(function () {
        const jobModal = document.getElementById('jobModal') ||
                         document.querySelector('.modal-overlay.open .modal');
        if (jobModal && document.getElementById('j-car')) {
          observer.disconnect();
          if (!filled) { filled = true; prefill(); }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(function () {
        observer.disconnect();
        if (!filled) { filled = true; prefill(); }
      }, 500);

      const _convToken = 'CONV-' + apptId + '-' + Date.now();
      try {
        const modalEl = document.getElementById('jobModal') ||
                      document.querySelector('.modal-overlay');
        if (modalEl) {
          modalEl.dataset.fromApptId    = apptId;
          modalEl.dataset.convToken     = _convToken;
        }
        window._convertingApptId    = apptId;
        window._convertingApptToken = _convToken;
      } catch (e2) {
        console.warn('[ApptService] convertApptToJob: failed to set modal conversion token', e2);
      }

      let _onJobSaved = null;
      if (_bus && _bus.EVENTS && _bus.EVENTS.JOBS_CHANGED) {

        if (_pendingJobSavedListener) {
          try {
            _bus.off(_bus.EVENTS.JOBS_CHANGED, _pendingJobSavedListener);
          } catch (eOld) {
            console.warn('[ApptService] convertApptToJob: failed to unsubscribe stale JOBS_CHANGED listener', eOld);
          }
          _pendingJobSavedListener = null;
        }

        _onJobSaved = function (payload) {
          try {
            _bus.off(_bus.EVENTS.JOBS_CHANGED, _onJobSaved);
          } catch (e3) {
            console.warn('[ApptService] convertApptToJob: failed to unsubscribe JOBS_CHANGED listener', e3);
          }
          if (_pendingJobSavedListener === _onJobSaved) _pendingJobSavedListener = null;
          const tokenOk = (window._convertingApptToken === _convToken);
          window._convertingApptId    = null;
          window._convertingApptToken = null;
          if (!tokenOk) return;
          const jobId = (payload && (payload.id || payload.jobId)) || null;
          _state.markConverted(apptId, jobId);
          _persist();
        };
        _pendingJobSavedListener = _onJobSaved;
        _bus.once(_bus.EVENTS.JOBS_CHANGED, _onJobSaved);
      }

      _toast('Appointment converted to job — fill details and save', 'info', 4000);

    } catch (e) {
      console.error('[ApptService] convertApptToJob error:', e);
    }
  }

  function _sanitizeStr(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function (c) {
      switch (c) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case "'": return '&#x27;';
        default:  return c;
      }
    });
  }

  function _fillJobFormFromAppt(appt) {
    const plate = _sanitizeStr(appt.vehicle || '').toUpperCase();
    let carName = plate ? plate + ' Vehicle' : 'Vehicle';
    try {
      const vState = typeof VehicleState !== 'undefined' ? VehicleState : null;
      const vehs   = vState && typeof vState.getVehicles === 'function' ? vState.getVehicles() : [];
      const v      = vehs.find(function (x) { return (x.plate || '').toUpperCase() === plate; });
      if (v && v.model) carName = v.model + (v.year ? ' ' + v.year : '');
    } catch (e2) {
      console.warn('[ApptService] _fillJobFormFromAppt: vehicle lookup failed', e2);
    }

    const fields = [
      ['j-car',   carName],
      ['j-plate', plate],
      ['j-cust',  _sanitizeStr(appt.cust    || '')],
      ['j-prob',  _sanitizeStr(appt.service || '')],
    ];
    fields.forEach(function (pair) {
      const el = document.getElementById(pair[0]);
      if (el) el.value = pair[1];
    });
    const mecEl = document.getElementById('job-mechanic');
    if (mecEl && appt.mechanic) mecEl.value = _sanitizeStr(appt.mechanic);
    const delEl = document.getElementById('j-del');

    if (delEl) {
      let y, mo, d;
      if (typeof ERP !== 'undefined' && ERP.DateUtils && typeof ERP.DateUtils.today === 'function') {
        const _td = ERP.DateUtils.today().split('-');
        y = parseInt(_td[0], 10);
        mo = parseInt(_td[1], 10) - 1;
        d = parseInt(_td[2], 10);
      } else {
        console.warn('[ApptService] _fillJobFormFromAppt: ERP.DateUtils.today() unavailable, falling back to local date');
        const now = new Date();
        y = now.getFullYear();
        mo = now.getMonth();
        d = now.getDate();
      }
      const _tomorrow = new Date(y, mo, d + 1);
      delEl.value = _tomorrow.getFullYear() + '-' +
        String(_tomorrow.getMonth() + 1).padStart(2, '0') + '-' +
        String(_tomorrow.getDate()).padStart(2, '0');
    }
  }

  return {
    init,
    saveAppointment,
    updateApptStatus,
    deleteAppointment,
    convertApptToJob,
  };

})();

if (typeof window !== "undefined") window.AppointmentService = AppointmentService;
