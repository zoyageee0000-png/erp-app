const AppointmentUI = (function () {
  'use strict';

  let _state   = null;
  let _service = null;
  let _bus     = null;
  let _deps    = {};
  let _initialized = false;
  let _apptChangedHandler = null;

  let _delegatedWired = false;
  let _delegatedClickHandler = null;
  let _searchEl = null;
  let _searchKeyupHandler = null;

  let _calDelegated = false;
  let _calClickHandler = null;

  const COLOR_TEXT_SECONDARY = '#374151';

  function init(state, service, bus, deps) {
    if (_initialized) return false;
    if (!state || !service || !bus) {
      throw new Error('[ApptUI] init: state, service, and bus are required');
    }
    _state   = state;
    _service = service;
    _bus     = bus;
    _deps    = deps || {};
    _initialized = true;
    _apptChangedHandler = function () { renderAppointments(); };
    _bus.on(_bus.EVENTS.APPOINTMENTS_CHANGED, _apptChangedHandler);

    _wireDelegated();
    _wireCalendarDelegated();
    return true;
  }

  function destroy() {
    if (_bus && _apptChangedHandler) {
      _bus.off(_bus.EVENTS.APPOINTMENTS_CHANGED, _apptChangedHandler);
      _apptChangedHandler = null;
    }

    if (_delegatedClickHandler) {
      document.removeEventListener('click', _delegatedClickHandler);
      _delegatedClickHandler = null;
    }
    if (_searchEl && _searchKeyupHandler) {
      _searchEl.removeEventListener('keyup', _searchKeyupHandler);
    }
    _searchEl = null;
    _searchKeyupHandler = null;

    if (_calClickHandler) {
      document.removeEventListener('click', _calClickHandler);
      _calClickHandler = null;
    }

    _initialized   = false;
    _delegatedWired = false;
    _calDelegated  = false;
  }

  function _esc(str) {
    if (typeof _deps.escapeHtml === 'function') return _deps.escapeHtml(str);
    return String(str || '').replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
    });
  }

  function _el(id) { return document.getElementById(id); }

  function _serverToday() {
    let d;
    if (typeof ERP !== 'undefined' && ERP.DateUtils && typeof ERP.DateUtils.now === 'function') {
      d = new Date(ERP.DateUtils.now());
    } else {
      d = new Date();
    }
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function _setText(id, val) {
    const e = _el(id);
    if (!e) return;
    e.textContent = val;
  }

  function _wireDelegated() {
    if (_delegatedWired) return;
    _delegatedWired = true;

    _delegatedClickHandler = function (e) {
      const btn = e.target.closest('[data-appt-action]');
      if (!btn) return;

      const action = btn.dataset.apptAction;
      const id     = btn.dataset.apptId;

      switch (action) {
        case 'status-inprogress': _service.updateApptStatus(id, 'in-progress'); break;
        case 'status-completed':  _service.updateApptStatus(id, 'completed');   break;
        case 'status-cancelled':  _service.updateApptStatus(id, 'cancelled');   break;
        case 'convert':           (typeof _deps.convertApptToJob === 'function' ? _deps.convertApptToJob(id) : _service.convertApptToJob(id)); break;
        case 'edit':              openAppointmentModal(id);                      break;
        case 'delete':            _service.deleteAppointment(id);               break;
        case 'day-done':          _service.updateApptStatus(id, 'completed'); renderCalendar(); break;
        case 'day-job':           (typeof _deps.convertApptToJob === 'function' ? _deps.convertApptToJob(id) : _service.convertApptToJob(id)); break;
        default: break;
      }
    };
    document.addEventListener('click', _delegatedClickHandler);

    _searchEl = _el('appt-search');
    if (_searchEl) {
      _searchKeyupHandler = function () {
        _state.setSearchQuery(this.value);
        renderAppointments();
      };
      _searchEl.addEventListener('keyup', _searchKeyupHandler);
    }
  }

  function _wireCalendarDelegated() {
    if (_calDelegated) return;
    _calDelegated = true;

    _calClickHandler = function (e) {
      const cell = e.target.closest('[data-cal-date]');
      if (!cell) return;
      const calEl = _el('appt-calendar');
      if (!calEl || !calEl.contains(cell)) return;
      openApptDayModal(cell.dataset.calDate);
    };
    document.addEventListener('click', _calClickHandler);
  }

  function _renderStatCards() {
    const s = _state.getTodayStats();
    _setText('appt-today',       s.today);
    _setText('appt-inprogress',  s.inProgress);
    _setText('appt-completed',   s.completed);
    _setText('appt-cancelled',   s.cancelled);
  }

  function renderAppointments() {
    try {
      _renderStatCards();

      const tbody = _el('appt-tbody');
      if (!tbody) return;

      const appts = _state.getFiltered();

      if (!appts.length) {
        tbody.innerHTML =
          '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--muted)">No appointments found</td></tr>';
        if (_state.getCurrentView() === 'calendar') renderCalendar();
        return;
      }

      const stConf = _state.STATUS_CONF;

      const APPT_BADGE = {
        'booked':      'au-b-booked',
        'confirmed':   'au-b-confirmed',
        'in-progress': 'au-b-inprogress',
        'completed':   'au-b-completed',
        'cancelled':   'au-b-cancelled',
        'pending':     'au-b-pending'
      };

      tbody.innerHTML = appts.map(function (a) {
        const sc  = stConf[a.status] || { l: a.status, cls: 'b-gray' };
        const id  = _esc(a.id);
        const badgeCls = APPT_BADGE[a.status] || 'au-b-gray';

        return '<tr>' +
          '<td class="au-fw">' + _esc(a.date || '') + '</td>' +
          '<td class="au-dim">' + _esc(a.time || '') + '</td>' +
          '<td class="au-fw"><span style="display:inline-flex;align-items:center;gap:5px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-3px;color:var(--muted,#64748b)"><use href="#ic-users"/></svg>' + _esc(a.cust || '') + '</span></td>' +
          '<td>' + _esc(a.vehicle || '—') + '</td>' +
          '<td class="au-hide-md au-dim">' + _esc(a.service || '') + '</td>' +
          '<td class="au-hide-md au-dim"><span style="display:inline-flex;align-items:center;gap:5px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px;color:#9ca3af"><use href="#ic-tool"/></svg>' + _esc(a.mechanic || '') + '</span></td>' +
          '<td><span class="au-badge ' + badgeCls + '">' + _esc(sc.l) + '</span></td>' +
          '<td>' +
            '<div class="au-row-actions">' +
              '<button class="au-act au-act-warn"    data-appt-action="status-inprogress" data-appt-id="' + id + '">Start</button>' +
              '<button class="au-act au-act-success" data-appt-action="status-completed"  data-appt-id="' + id + '">Done</button>' +
              '<button class="au-act au-act-view"    data-appt-action="convert"           data-appt-id="' + id + '">→ Job</button>' +
              '<button class="au-act au-act-edit"    data-appt-action="edit"              data-appt-id="' + id + '">Edit</button>' +
              '<button class="au-act au-act-delete"  data-appt-action="status-cancelled"  data-appt-id="' + id + '">Cancel</button>' +
            '</div>' +
          '</td>' +
        '</tr>';
      }).join('');

      if (_state.getCurrentView() === 'calendar') renderCalendar();

    } catch (e) {
      console.error('[ApptUI] renderAppointments error:', e);
    }
  }

  function renderCalendar() {
    try {
      const el = _el('appt-calendar');
      if (!el) return;

      const calMonth = _state.getCalMonth();
      const y = calMonth.getFullYear();
      const m = calMonth.getMonth();

      const labelEl = _el('cal-month-label');
      if (labelEl) {
        labelEl.textContent = calMonth.toLocaleString('default', {
          month: 'long', year: 'numeric',
        });
      }

      const firstDay    = new Date(y, m, 1).getDay();
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const today       = _serverToday();

      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

      const stColors = {
        'completed':   'var(--success,#22c55e)',
        'in-progress': 'var(--secondary,#f59e0b)',
        'cancelled':   'var(--danger,#ef4444)',
        'pending':     'var(--info,#3b82f6)',
      };

      const allAppts = _state.getFiltered({ includeConverted: true });
      const byDate = {};
      allAppts.forEach(function (a) {
        if (!a.date) return;
        if (!byDate[a.date]) byDate[a.date] = [];
        byDate[a.date].push(a);
      });

      let html = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">';

      dayNames.forEach(function (d) {
        html += '<div style="text-align:center;font-size:11px;font-weight:600;padding:4px;color:var(--muted)">' + d + '</div>';
      });

      for (let i = 0; i < firstDay; i++) html += '<div></div>';

      for (let d = 1; d <= daysInMonth; d++) {
        const ds = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        const dayAppts = byDate[ds] || [];
        const isToday  = ds === today;

        const cellBg    = isToday ? 'var(--info-m, #bfdbfe)' : 'var(--white, #ffffff)';
        const borderClr = isToday ? 'var(--primary)' : 'var(--border)';
        const dayColor  = isToday ? 'var(--primary)' : 'var(--text)';
        const dayWeight = isToday ? '700' : '500';

        const dots = dayAppts.slice(0, 3).map(function (a) {
          const bg = stColors[a.status] || 'var(--muted,#64748b)';
          return '<div style="font-size:9px;background:' + bg +
            ';color:#fff;border-radius:3px;padding:1px 3px;margin-top:2px;' +
            'overflow:hidden;white-space:nowrap;text-overflow:ellipsis">' +
            _esc(a.time) + ' ' + _esc(a.cust) + '</div>';
        }).join('');

        const more = dayAppts.length > 3
          ? '<div style="font-size:9px;color:var(--muted)">+' + (dayAppts.length - 3) + ' more</div>'
          : '';

        html +=
          '<div data-cal-date="' + ds + '" style="min-height:60px;border:1px solid ' + borderClr +
          ';border-radius:6px;padding:4px;cursor:pointer;background:' + cellBg + '">' +
            '<div style="font-size:12px;font-weight:' + dayWeight + ';color:' + dayColor + '">' + d + '</div>' +
            dots + more +
          '</div>';
      }

      html += '</div>';
      el.innerHTML = html;

    } catch (e) {
      console.error('[ApptUI] renderCalendar error:', e);
    }
  }

  function openApptDayModal(dateStr) {
    try {
      const dayAppts = _state.getByDate(dateStr);
      const overlay  = document.createElement('div');
      overlay.className = 'modal-overlay open';

      const rows = dayAppts.length
        ? dayAppts.map(function (a) {
            const id = _esc(a.id);
            return '<div style="padding:8px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px">' +
              '<div style="font-weight:600">' + _esc(a.time) + ' — ' + _esc(a.cust) + '</div>' +
              '<div style="font-size:12px;color:var(--muted)">' + _esc(a.service) + ' · ' + _esc(a.mechanic || '') + '</div>' +
              '<div style="display:flex;gap:4px;margin-top:6px">' +
                '<button class="btn btn-sm btn-success" data-appt-action="day-done" data-appt-id="' + id + '">✅ Done</button>' +
                '<button class="btn btn-sm btn-primary" data-appt-action="day-job"  data-appt-id="' + id + '">🔧 Job</button>' +
              '</div>' +
            '</div>';
          }).join('')
        : '<div style="color:var(--muted);text-align:center;padding:20px">No appointments on this day</div>';

      overlay.innerHTML =
        '<div class="modal sm">' +
          '<div class="modal-head">' +
            '<h2>📅 ' + _esc(dateStr) + '</h2>' +
            '<button class="modal-close" id="_day-close-btn"><svg><use href="#ic-x"/></svg></button>' +
          '</div>' +
          '<div class="modal-body">' + rows + '</div>' +
          '<div class="modal-foot">' +
            '<button class="btn btn-ghost" id="_day-cancel-btn">Close</button>' +
            '<button class="btn btn-primary" id="_day-new-btn">+ New Booking</button>' +
          '</div>' +
        '</div>';

      document.body.appendChild(overlay);

      const dayCloseBtn  = overlay.querySelector('#_day-close-btn');
      const dayCancelBtn = overlay.querySelector('#_day-cancel-btn');
      const dayNewBtn    = overlay.querySelector('#_day-new-btn');

      if (dayCloseBtn)  dayCloseBtn.addEventListener('click', function () { overlay.remove(); });
      if (dayCancelBtn) dayCancelBtn.addEventListener('click', function () { overlay.remove(); });
      if (dayNewBtn) {
        dayNewBtn.addEventListener('click', function () {
          overlay.remove();
          openAppointmentModal();
        });
      }

    } catch (e) {
      console.error('[ApptUI] openApptDayModal error:', e);
    }
  }

  function openAppointmentModal(editId) {
    try {
      if (!_initialized || !_state) {
        if (typeof window.showToast === 'function') window.showToast('Appointment module initializing… please try again in a moment.', 'info', 2500);
        else console.warn('[AppointmentUI] openAppointmentModal called before init()');
        return;
      }
      const ea        = editId ? _state.findAppt(editId) : null;
      if (editId && !ea) {
        if (typeof window.showToast === 'function') window.showToast('Appointment not found — may have been deleted', 'error');
        return;
      }
      const mechanics = typeof _deps.getMechanics === 'function' ? _deps.getMechanics() : [];

      let time24 = '';
      if (ea && ea.time) {
        const match = ea.time.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (match) {
          let h = parseInt(match[1], 10);
          const mn  = match[2];
          const ap  = match[3].toUpperCase();
          if (ap === 'PM' && h < 12) h += 12;
          if (ap === 'AM' && h === 12) h = 0;
          time24 = String(h).padStart(2, '0') + ':' + mn;
        } else if (/^\d{2}:\d{2}$/.test(ea.time)) {
          time24 = ea.time;
        }
      }

      const mechOptions = mechanics.map(function (m) {
        const sel = ea && ea.mechanic === m.name ? ' selected' : '';
        return '<option' + sel + '>' + _esc(m.name) + '</option>';
      }).join('');

      const today = _serverToday();

      const _stale = document.getElementById('apptModal');
      if (_stale) _stale.remove();

      const overlay = document.createElement('div');
      overlay.id = 'apptModal-overlay';
      overlay.className = 'modal-overlay open';
      overlay.style.cssText = 'display:flex;position:fixed;inset:0;z-index:var(--zi-modal-bg,1000);background:rgba(0,0,0,.45);align-items:flex-start;justify-content:center;overflow-y:auto;padding:16px 0';

      overlay.innerHTML =
        '<div class="modal" id="apptModal" style="width:98vw;max-width:680px;margin:auto;">' +

          '<div style="background:#7c3aed;padding:12px 16px;display:flex;align-items:center;justify-content:space-between">' +
            '<div style="display:flex;align-items:center;gap:10px">' +
              '<div style="width:32px;height:32px;border-radius:7px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:17px;height:17px;vertical-align:-3px;color:#fff"><use href="#ic-cal"/></svg>' +
              '</div>' +
              '<div>' +
                '<div style="color:#fff;font-size:14px;font-weight:600">' + (ea ? 'Edit appointment' : 'New appointment') + '</div>' +
                '<div style="color:rgba(255,255,255,.7);font-size:11px">' + (ea ? 'Editing booking for ' + _esc(ea.cust || '') : 'Fill in booking details below') + '</div>' +
              '</div>' +
            '</div>' +
            '<button id="_appt-close-btn" style="width:30px;height:30px;border-radius:7px;border:0.5px solid rgba(255,255,255,.3);background:rgba(255,255,255,.12);color:#fff;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;vertical-align:-2px"><use href="#ic-x"/></svg>' +
            '</button>' +
          '</div>' +

          '<div class="am-sec"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-cal"/></svg> Schedule</div>' +
          '<div style="padding:12px 16px;display:grid;grid-template-columns:repeat(3,1fr);gap:9px;border-bottom:0.5px solid #e5e7eb">' +
            '<div><label class="am-lbl">Date <span style="color:#ef4444">*</span></label><input class="am-fi" type="date" id="a-date" value="' + _esc(ea ? ea.date : today) + '"></div>' +
            '<div><label class="am-lbl">Time <span style="color:#ef4444">*</span></label><input class="am-fi" type="time" id="a-time" value="' + _esc(time24) + '"></div>' +
            '<div><label class="am-lbl">Buffer time (min)</label><input class="am-fi" type="number" id="a-buffer" value="' + (ea ? (ea.bufferMin || 30) : 30) + '" min="0" step="15"></div>' +
          '</div>' +

          '<div class="am-sec"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-users"/></svg> Customer &amp; vehicle</div>' +
          '<div style="padding:12px 16px;display:grid;grid-template-columns:1fr 1fr;gap:9px;border-bottom:0.5px solid #e5e7eb">' +
            '<div style="grid-column:1/-1"><label class="am-lbl">Customer name <span style="color:#ef4444">*</span></label><input class="am-fi" id="a-cust" list="appt-cust-datalist" placeholder="Customer name" value="' + _esc(ea ? ea.cust : '') + '"><datalist id="appt-cust-datalist"></datalist></div>' +
            '<div><label class="am-lbl">Vehicle plate</label><input class="am-fi" id="a-vehicle" placeholder="ABC-123" value="' + _esc(ea ? (ea.vehicle || '') : '') + '"></div>' +
            '<div><label class="am-lbl">Service type <span style="color:#ef4444">*</span></label><input class="am-fi" id="a-service" placeholder="Oil change, AC service…" value="' + _esc(ea ? ea.service : '') + '"></div>' +
          '</div>' +

          '<div class="am-sec"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-tool"/></svg> Assignment</div>' +
          '<div style="padding:12px 16px;border-bottom:0.5px solid #e5e7eb">' +
            '<label class="am-lbl">Mechanic</label>' +
            '<select class="am-fi" id="appt-mechanic" style="max-width:300px"><option value="">— Select Mechanic —</option>' + mechOptions + '</select>' +
          '</div>' +

          '<div style="padding:11px 16px;display:flex;justify-content:flex-end;gap:8px">' +
            '<button id="_appt-cancel-btn" style="padding:8px 16px;border-radius:7px;border:0.5px solid #d1d5db;background:var(--white,#fff);color:' + COLOR_TEXT_SECONDARY + ';font-weight:500;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:5px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-3px"><use href="#ic-x"/></svg> Cancel</button>' +
            '<button id="_appt-save-btn" style="padding:8px 20px;border-radius:7px;border:none;background:#7c3aed;color:#fff;font-weight:600;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:5px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-3px"><use href="#ic-cal"/></svg> Book appointment</button>' +
          '</div>' +

        '</div>';

      document.body.appendChild(overlay);

      const closeBtn  = overlay.querySelector('#_appt-close-btn');
      const cancelBtn = overlay.querySelector('#_appt-cancel-btn');
      const saveBtn   = overlay.querySelector('#_appt-save-btn');

      if (closeBtn)  closeBtn.addEventListener('click', function () { overlay.remove(); });
      if (cancelBtn) cancelBtn.addEventListener('click', function () { overlay.remove(); });
      if (saveBtn) {
        saveBtn.addEventListener('click', function () {
          _service.saveAppointment(this, editId || undefined);
        });
      }
      overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

      setTimeout(function () {
        const firstField = overlay.querySelector('#a-date');
        if (firstField) firstField.focus();
      }, 60);

    } catch (e) {
      console.error('[ApptUI] openAppointmentModal error:', e);
    }
  }

  function switchApptView(view, btn) {
    try {
      _state.setCurrentView(view);
      const listEl = _el('appt-list-view');
      const calEl  = _el('appt-calendar-view');
      if (listEl) listEl.style.display = view === 'list'     ? 'block' : 'none';
      if (calEl)  calEl.style.display  = view === 'calendar' ? 'block' : 'none';

      const listBtn = _el('appt-view-list');
      const calBtn  = _el('appt-view-cal');
      if (listBtn) listBtn.classList.toggle('active', view === 'list');
      if (calBtn)  calBtn.classList.toggle('active', view === 'calendar');

      if (view === 'calendar') {
        renderCalendar();
      } else if (view === 'list') {
        renderAppointments();
      }
    } catch (e) {
      console.error('[ApptUI] switchApptView error:', e);
    }
  }

  function changeCalMonth(dir) {
    _state.stepCalMonth(dir);
    renderCalendar();
  }

  function jumpCalToday() {
    _state.resetCalMonth();
    renderCalendar();
  }

  function searchAppointments(query) {
    _state.setSearchQuery(query);
    renderAppointments();
  }

  return {
    init,
    destroy,

    renderAppointments,
    renderCalendar,

    openAppointmentModal,
    openApptDayModal,

    switchApptView,
    changeCalMonth,
    jumpCalToday,

    searchAppointments,
  };

})();

if (typeof window !== "undefined") window.AppointmentUI = AppointmentUI;
