const AppointmentState = (function () {
  'use strict';

  const VALID_STATUSES = Object.freeze([
    'pending',
    'in-progress',
    'completed',
    'cancelled',
  ]);

  const STATUS_CONF = Object.freeze({
    'pending':     { l: 'Pending',     cls: 'b-blue',   icon: '🕐' },
    'in-progress': { l: 'In Progress', cls: 'b-orange',  icon: '🔧' },
    'completed':   { l: 'Completed',   cls: 'b-green',  icon: '✅' },
    'cancelled':   { l: 'Cancelled',   cls: 'b-red',    icon: '✕'  },
  });

  function _serverDate() {
    if (typeof ERP !== 'undefined' && ERP.DateUtils && typeof ERP.DateUtils.now === 'function') {
      const ts = ERP.DateUtils.now();
      return new Date(ts);
    }
    return new Date();
  }

  let _appointments = [];
  let _apptCount = 1;
  let _currentView = 'list';

  let _calMonth = _serverDate();

  let _searchQuery = '';
  let _bus = null;

  function _emit(eventName, payload) {
    if (_bus && typeof _bus.emit === 'function') {
      try { _bus.emit(eventName, payload); } catch (e) {
        console.warn('[ApptState] emit failed for "' + eventName + '":', e);
      }
    }
  }

  function _evName(key) {
    return (_bus && _bus.EVENTS && _bus.EVENTS[key]) || (
      { APPOINTMENTS_CHANGED: 'appointments:changed', APPOINTMENTS_CONVERTED: 'appointments:converted' }[key] || key
    );
  }

  function _migrate(arr) {
    return arr.map(function (a, i) {
      if (a.id) return a;
      return Object.assign({}, a, {
        id: 'APT-' + String(i + 1).padStart(3, '0'),
      });
    });
  }

  function _recalibrate() {
    let maxN = 0;
    _appointments.forEach(function (a) {
      const m = a.id && a.id.match(/APT-(\d+)/);
      if (!m) return;
      const n = parseInt(m[1], 10);
      if (n > maxN) maxN = n;
    });
    if (maxN >= _apptCount) {
      _apptCount = maxN + 5;
    }
  }

  function init(eventBus) {
    if (eventBus && typeof eventBus.emit === 'function') {
      _bus = eventBus;
      return true;
    }
    return false;
  }

  function getAppointments() {
    return _appointments.slice();
  }

  function setAppointments(arr) {
    if (!Array.isArray(arr)) {
      console.warn('[ApptState] setAppointments: expected Array, got ' + typeof arr);
      return false;
    }
    _appointments = _migrate(arr);
    _recalibrate();
    return true;
  }

  function nextApptId() {
    const existing = new Set(_appointments.map(function (a) { return a.id; }));
    var candidate;
    let attempts = 0;
    do {
      if (attempts++ > 10000) throw new Error('[ApptState] nextApptId: cannot find unique ID');
      candidate = 'APT-' + String(_apptCount++).padStart(3, '0');
    } while (existing.has(candidate));
    return candidate;
  }

  function findAppt(id) {
    return _appointments.find(function (a) { return a.id === id; }) || null;
  }

  function addAppt(appt) {
    if (!appt || typeof appt !== 'object') {
      console.warn('[ApptState] addAppt: invalid object');
      return null;
    }
    if (!appt.id) {
      appt = Object.assign({}, appt, { id: nextApptId() });
    }
    _appointments.push(appt);
    _emit(_evName('APPOINTMENTS_CHANGED'), { appointments: _appointments });
    return appt;
  }

  function updateAppt(id, data) {
    var found = false;
    _appointments = _appointments.map(function (a) {
      if (a.id !== id) return a;
      found = true;
      return Object.assign({}, a, data, { id: id });
    });
    if (!found) {
      console.warn('[ApptState] updateAppt: id "' + id + '" not found');
      return null;
    }
    _emit(_evName('APPOINTMENTS_CHANGED'), { appointments: _appointments });
    return findAppt(id);
  }

  function deleteAppt(id) {
    const before = _appointments.length;
    _appointments = _appointments.filter(function (a) { return a.id !== id; });
    const removed = _appointments.length < before;
    if (removed) {
      _emit(_evName('APPOINTMENTS_CHANGED'), { appointments: _appointments });
    }
    return removed;
  }

  function setApptStatus(id, status) {
    return updateAppt(id, { status: status });
  }

  function markConverted(apptId, jobId) {
    updateAppt(apptId, { status: 'completed', sourceJobId: jobId });
    _emit(_evName('APPOINTMENTS_CONVERTED'), { apptId: apptId, jobId: jobId });
  }

  function getCurrentView() { return _currentView; }

  function setCurrentView(v) {
    if (v === 'list' || v === 'calendar') _currentView = v;
  }

  function getCalMonth() { return new Date(_calMonth); }

  function stepCalMonth(dir) {
    const next = new Date(_calMonth);
    next.setMonth(next.getMonth() + dir);
    _calMonth = next;
  }

  function resetCalMonth() {
    _calMonth = _serverDate();
  }

  function getSearchQuery() { return _searchQuery; }

  function setSearchQuery(q) { _searchQuery = (q || '').trim().toLowerCase(); }

  function getFiltered(opts) {
    const includeConverted = opts && opts.includeConverted;
    const list = _appointments.filter(function (a) {
      if (!includeConverted && a.status === 'completed' && a.sourceJobId) return false;
      return true;
    });
    if (!_searchQuery) return list;
    return list.filter(function (a) {
      return (
        (a.cust    || '').toLowerCase().includes(_searchQuery) ||
        (a.vehicle || '').toLowerCase().includes(_searchQuery) ||
        (a.service || '').toLowerCase().includes(_searchQuery) ||
        (a.mechanic|| '').toLowerCase().includes(_searchQuery)
      );
    });
  }

  function getByDate(dateStr) {
    return _appointments.filter(function (a) { return a.date === dateStr; });
  }

  function getTodayStats() {
    const today = (function(){ const _d=_serverDate(); return _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0'); })();
    const todayAppts = _appointments.filter(function (a) {
      return a.date === today;
    });
    return {
      today:      todayAppts.length,
      inProgress: todayAppts.filter(function (a) { return a.status === 'in-progress'; }).length,
      completed:  todayAppts.filter(function (a) { return a.status === 'completed';   }).length,
      cancelled:  todayAppts.filter(function (a) { return a.status === 'cancelled';   }).length,
    };
  }

  function _timeToMinutes(timeStr) {
    if (!timeStr) return null;
    const m = String(timeStr).match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const mins = parseInt(m[2], 10);
    const ap = m[3].toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return h * 60 + mins;
  }

  function findConflict(date, time, mechanic, excludeId, bufferMin) {
    if (!date || !time || !mechanic) return null;

    const newStart = _timeToMinutes(time);
    const buffer = Number.isFinite(bufferMin) ? bufferMin : 30;

    return _appointments.find(function (a) {
      if (
        a.id !== excludeId &&
        a.date === date &&
        a.mechanic === mechanic &&
        a.status !== 'cancelled' &&
        a.status !== 'completed'
      ) {

        if (a.time === time) return true;

        const existingStart = _timeToMinutes(a.time);
        if (newStart === null || existingStart === null) return false;

        const existingBuffer = Number.isFinite(a.bufferMin) ? a.bufferMin : 30;
        const requiredGap = Math.max(buffer, existingBuffer);

        return Math.abs(newStart - existingStart) < requiredGap;
      }
      return false;
    }) || null;
  }

  function reset(keepBus) {
    _appointments = [];
    _apptCount    = 1;
    _currentView  = 'list';
    _calMonth     = _serverDate();
    _searchQuery  = '';
    if (!keepBus) _bus = null;
  }

  return {
    init,

    VALID_STATUSES,
    STATUS_CONF,

    getAppointments,
    setAppointments,
    nextApptId,
    findAppt,
    addAppt,
    updateAppt,
    deleteAppt,
    setApptStatus,
    markConverted,

    getCurrentView,
    setCurrentView,
    getCalMonth,
    stepCalMonth,
    resetCalMonth,
    getSearchQuery,
    setSearchQuery,

    getFiltered,
    getByDate,
    getTodayStats,
    findConflict,

    reset,
  };

})();

if (typeof window !== "undefined") window.AppointmentState = AppointmentState;
