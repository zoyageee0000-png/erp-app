'use strict';

(function (root) {
  'use strict';

  if (root.__crossServiceLoaded && root.CrossService) { return; }

  var _deps = {
    jobState:     null,
    jobService:   null,
    apptState:    null,
    storage:      null,
    bus:          null,
    providers:    null,
    getProviders: null,
    showToast:    null,
    openJobModal: null,
    renderJobForm:null,
  };

  function _safe(fn, tag) {
    try { return { ok: true, val: fn() }; }
    catch (e) {
      var L = root.Logger;
      if (L && typeof L.warn === 'function') {
        L.warn('[CrossService][' + (tag || '?') + ']', e && e.message || e);
      } else if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('[CrossService][' + (tag || '?') + ']', e && e.message || e);
      }
      return { ok: false, err: e };
    }
  }

  function _toast(msg, type) {
    _safe(function () {
      if (typeof _deps.showToast === 'function') { _deps.showToast(msg, type || 'info'); return; }
      if (root.ERP && root.ERP.ui && typeof root.ERP.ui.toast === 'function') { root.ERP.ui.toast(msg, type); return; }
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('[CrossService][toast]', msg);
      }
    }, 'toast');
  }


  function init(config) {
    _safe(function () {
      if (!config || typeof config !== 'object') { return; }
      Object.keys(_deps).forEach(function (key) {
        if (config[key] !== undefined) { _deps[key] = config[key]; }
      });
    }, 'init');
  }

  function convertApptToJob(apptId) {
    _safe(function () {
      if (!apptId) { return; }

      var AS = root.AppointmentService || (root.window && root.window.AppointmentService);
      if (AS && typeof AS.convertToJob === 'function') {
        AS.convertToJob(apptId);
        return;
      }

      var apptState = _deps.apptState || root.AppointmentState;
      if (!apptState) {
        _toast('Appointment system not ready', 'error');
        return;
      }
      var appt;
      if (typeof apptState.getById === 'function') {
        appt = apptState.getById(apptId);
      } else if (typeof apptState.getAppointments === 'function') {
        var _list = apptState.getAppointments();
        appt = Array.isArray(_list) ? _list.find(function (a) { return a.id === apptId; }) : null;
      }
      if (!appt) {
        _toast('Appointment not found: ' + apptId, 'error');
        return;
      }

      fillJobFormFromAppt(appt);

      if (typeof _deps.openJobModal === 'function') { _deps.openJobModal(); }
      else if (root.JobUI && typeof root.JobUI.openJobModal === 'function') { root.JobUI.openJobModal(); }
    }, 'convertApptToJob');
  }

  function fillJobFormFromAppt(appt) {
    _safe(function () {
      if (!appt) { return; }

      if (typeof _deps.renderJobForm === 'function') { _deps.renderJobForm(appt); return; }
      var JUI = root.JobUI || _deps.jobService;
      if (JUI && typeof JUI.populateJobForm === 'function') { JUI.populateJobForm(appt); return; }

      _safe(function () {
        var fields = {
          'job-cust':  appt.customerName || appt.cust || '',
          'job-phone': appt.phone        || appt.ph   || '',
          'job-car':   appt.vehicle      || appt.car  || '',
          'job-plate': appt.plate        || '',
          'job-notes': appt.notes        || appt.desc || '',
        };
        Object.keys(fields).forEach(function (id) {
          var el = document.getElementById(id);
          if (el) { el.value = fields[id]; }
        });
      }, 'fillJobFormFromAppt.directFill');
    }, 'fillJobFormFromAppt');
  }

  function markConvertedJob(apptId, jobId) {
    _safe(function () {
      if (!apptId) { return; }

      var apptState = _deps.apptState || root.AppointmentState;
      if (!apptState) { return; }

      if (typeof apptState.markConverted === 'function') {
        apptState.markConverted(apptId, jobId);
        return;
      }

      if (typeof apptState.updateAppointment === 'function') {
        var _now = (root.ERP && root.ERP.DateUtils && typeof root.ERP.DateUtils.now === 'function')
          ? root.ERP.DateUtils.now()
          : new Date().toISOString();
        apptState.updateAppointment(apptId, { status: 'converted', jobId: jobId, convertedAt: _now });
        return;
      }

      if (typeof apptState.update === 'function') {
        apptState.update(apptId, { status: 'converted', jobId: jobId });
      }
    }, 'markConvertedJob');
  }

  function updateMechanicDropdowns(mechanics) {
    _safe(function () {
      if (!Array.isArray(mechanics)) { return; }
      var cleanMechanics = mechanics.filter(function (m) { return m !== null && m !== undefined; });

      var JUI = root.JobUI || (_deps.jobService);
      if (JUI && typeof JUI.updateMechanicDropdowns === 'function') {
        JUI.updateMechanicDropdowns(cleanMechanics);
        return;
      }

      var selectors = [
        'select[data-mechanic-select]',
        'select#job-mechanic',
        'select.mechanic-select',
        'select[name="mechanic"]'
      ];
      selectors.forEach(function (sel) {
        _safe(function () {
          document.querySelectorAll(sel).forEach(function (el) {
            var current = el.value;
            var ph = el.querySelector('option[value=""]');
            var nonMech = [];
            el.querySelectorAll('option').forEach(function(o) {
              var v = o.value;
              if (v !== '' && !cleanMechanics.some(function(m){ return (m.n || m.name || m).toString() === v; })) {
                nonMech.push(o);
              }
            });
            el.innerHTML = '';
            if (ph) { el.appendChild(ph); }
            else {
              var blank = document.createElement('option');
              blank.value = '';
              blank.textContent = '-- Select Mechanic --';
              el.appendChild(blank);
            }
            nonMech.forEach(function(o) { el.appendChild(o); });
            cleanMechanics.forEach(function (m) {
              var opt = document.createElement('option');
              var name = (m.n || m.name || m).toString();
              opt.value = name;
              opt.textContent = name;
              if (name === current) { opt.selected = true; }
              el.appendChild(opt);
            });
          });
        }, 'updateMechanicDropdowns.el');
      });
    }, 'updateMechanicDropdowns');
  }

  var CrossService = {
    __crossService: true,

    init:                   init,
    fillJobFormFromAppt:    fillJobFormFromAppt,
    convertApptToJob:       convertApptToJob,
    markConvertedJob:       markConvertedJob,
    updateMechanicDropdowns:updateMechanicDropdowns,

    status: function () {
      return {
        depsInjected: Object.keys(_deps).filter(function (k) { return !!_deps[k]; }),
        depsMissing:  Object.keys(_deps).filter(function (k) { return !_deps[k]; })
      };
    }
  };

  root.CrossService = CrossService;
  root.__crossServiceLoaded = true;

}(window));
