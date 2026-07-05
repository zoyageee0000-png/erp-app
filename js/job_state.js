
const JobState = (function () {
  'use strict';


  const VALID_JOB_STATUSES = Object.freeze([
    'pending',
    'in-progress',
    'waiting-parts',
    'completed',
    'delivered',
    'cancelled',
  ]);

  const STATUS_ORDER = Object.freeze([
    'pending',
    'in-progress',
    'waiting-parts',
    'completed',
    'delivered',
  ]);

  const STAGES_7 = Object.freeze([
    { key: 'received',    label: 'Received',      icon: '📥', color: 'var(--muted,#64748b)' },
    { key: 'diagnosed',   label: 'Diagnosed',     icon: '🔍', color: 'var(--info,#3b82f6)' },
    { key: 'parts-order', label: 'Parts Ordered', icon: '📦', color: 'var(--secondary,#f59e0b)' },
    { key: 'in-progress', label: 'In Progress',   icon: '🔧', color: '#8b5cf6' },
    { key: 'testing',     label: 'Testing',       icon: '🧪', color: '#06b6d4' },
    { key: 'ready',       label: 'Ready',         icon: '✅', color: 'var(--success,#22c55e)' },
    { key: 'delivered',   label: 'Delivered',     icon: '🚗', color: 'var(--primary,#1e3a5f)' },
  ]);

  const STATUS_CONF = Object.freeze({
    'pending':       { l: 'Pending',        cls: 'b-blue',   icon: 'ic-calendar' },
    'in-progress':   { l: 'In Progress',    cls: 'b-orange', icon: 'ic-tool' },
    'waiting-parts': { l: 'Awaiting Parts', cls: 'b-purple', icon: 'ic-box' },
    'completed':     { l: 'Completed',      cls: 'b-green',  icon: 'ic-check' },
    'delivered':     { l: 'Delivered',      cls: 'b-gray',   icon: 'ic-car' },
    'cancelled':     { l: 'Cancelled',      cls: 'b-red',    icon: 'ic-x' },
  });


  let _jobs = [];
  let _jobsById = {};
  let _frozenCache = new WeakMap();
  let _curJob = null;
  let _jobCount = 1;
  let _currentFilter = 'all';
  let _bulkMode = false;
  let _bulkSelected = new Set();
  let _bus = null;


  function _deepClone(job) {
    if (typeof structuredClone === 'function') {
      try { return structuredClone(job); } catch (e) { console.warn('[JobState] _deepClone: structuredClone failed, falling back:', e); }
    }
    try {
      return JSON.parse(JSON.stringify(job));
    } catch (e) {
      console.warn('[JobState] _deepClone: clone failed, using shallow:', e);
      return Object.assign({}, job);
    }
  }

  function _cloneById(id) {
    const found = _jobsById[id];
    return found ? _deepClone(found) : null;
  }

  function _resyncCurJob() {
    if (_curJob === null) return;
    const updated = _jobs.find(function (j) { return j.id === _curJob.id; });
    _curJob = updated ? _deepClone(updated) : null;
  }

  function _rebuildIndex() {
    _jobsById = {};
    for (var i = 0; i < _jobs.length; i++) {
      if (_jobs[i] && _jobs[i].id) _jobsById[_jobs[i].id] = _jobs[i];
    }
  }

  function _emit(eventName, payload) {
    if (_bus && typeof _bus.emit === 'function') {
      try {
        _bus.emit(eventName, payload);
      } catch (e) {
        console.warn('[JobState] EventBus emit failed for "' + eventName + '":', e);
      }
    }
  }


  function _ok(data)  { return { ok: true,  data: data, error: null }; }
  function _err(msg)  { return { ok: false, data: null, error: new Error(msg) }; }

  function _today() {
    if (typeof ERP !== 'undefined' && ERP && ERP.DateUtils && typeof ERP.DateUtils.today === 'function') {
      return ERP.DateUtils.today();
    }
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    var map = {};
    parts.forEach(function (p) { map[p.type] = p.value; });
    return map.year + '-' + map.month + '-' + map.day;
  }



  function _validateJob(data, context) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return '[JobState] ' + (context || 'validateJob') + ': data must be a plain object';
    }
    // Delegate field/business-rule checks to the canonical Validators.job()
    // (single source of truth for job validation, including the discount-vs-total
    // check). Contract preserved: returns a string message on failure, null on
    // success (caller only console.warn's this, doesn't block — behavior unchanged).
    //
    // FIX (root-cause, was fail-open): this used to silently fall back to a local
    // re-implementation missing the discount-vs-total check if Validators wasn't
    // loaded — the exact bug this delegation was introduced to close, reopened
    // silently under a load-order hiccup. Validators.job() already covers every
    // check the old fallback did (required fields, status, parts) plus the
    // discount rule, so there is nothing the fallback could still validate that
    // Validators can't — refuse instead of validating with a known-weaker copy.
    if (typeof Validators === 'undefined') {
      return '[JobState] ' + (context || 'validateJob') +
        ': Validators module not loaded — refusing to validate with a weaker fallback ' +
        '(would silently skip the discount-vs-total check).';
    }
    var _v = Validators.job(data);
    if (!_v.ok) {
      return '[JobState] ' + (context || 'validateJob') + ': ' + _v.error;
    }
    return null;
  }



  function init(eventBus) {
    if (eventBus && typeof eventBus.emit === 'function') {
      _bus = eventBus;
    } else {
      console.warn('[JobState] init: invalid or missing eventBus — events will not be emitted');
    }
  }


  function _deepFreeze(obj, seen) {
    if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
      seen = seen || new WeakSet();
      if (seen.has(obj)) return obj;
      seen.add(obj);
      Object.getOwnPropertyNames(obj).forEach(function (key) {
        _deepFreeze(obj[key], seen);
      });
      Object.freeze(obj);
    }
    return obj;
  }

  function getJobs() {
    return _jobs.map(function (j) {
      if (!j) return _deepFreeze(_deepClone(j));
      if (!_frozenCache.has(j)) _frozenCache.set(j, _deepFreeze(_deepClone(j)));
      return _frozenCache.get(j);
    });
  }

  function setJobs(arr) {
    if (!Array.isArray(arr)) {
      console.warn('[JobState] setJobs: expected Array, got ' + typeof arr);
      return;
    }
    _jobs = arr
      .filter(function (j) { return j && typeof j === 'object' && !Array.isArray(j); })
      .map(function (j) { return _deepClone(j); })
      .sort(function(a, b) {
        var da = (a && a.date) || (a && a.createdAt) || '';
        var db = (b && b.date) || (b && b.createdAt) || '';
        var ta = Date.parse(da);
        var tb = Date.parse(db);
        if (!isNaN(ta) && !isNaN(tb)) {
          if (tb !== ta) return tb - ta;
        } else {
          if (db > da) return 1;
          if (db < da) return -1;
        }
        var na = (a && a.id) ? parseInt((a.id.match(/\d+/) || [0])[0], 10) : 0;
        var nb = (b && b.id) ? parseInt((b.id.match(/\d+/) || [0])[0], 10) : 0;
        return nb - na;
      });
    _rebuildIndex();
    _resyncCurJob();
    var maxN = 0;
    _jobs.forEach(function (j) {
      var m = j.id && j.id.match(/^JOB-(\d+)$/);
      if (m) {
        var n = parseInt(m[1], 10);
        if (n > maxN) maxN = n;
      }
    });
    if (maxN + 1 > _jobCount) {
      _jobCount = maxN + 1;
    }
  }

  function _addJob(job) {
    if (!job || typeof job !== 'object' || Array.isArray(job) || !job.id) {
      console.warn('[JobState] addJob: invalid job object (missing id)');
      return false;
    }
    if (_jobsById[job.id]) {
      console.warn('[JobState] addJob: duplicate id "' + job.id + '" rejected');
      return false;
    }
    _jobs.unshift(_deepClone(job));
    _rebuildIndex();
    _emit((_bus && _bus.EVENTS && _bus.EVENTS.JOBS_CHANGED) || 'jobs:changed', { jobs: _jobs.slice() });
    return true;
  }

  function _isPlainObject(v) {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
    var proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  }

  function _deepMergePatch(base, patch) {
    var out = Object.assign({}, base);
    Object.keys(patch).forEach(function (key) {
      var pv = patch[key];
      var bv = base[key];
      if (_isPlainObject(pv) && _isPlainObject(bv)) {
        out[key] = _deepMergePatch(bv, pv);
      } else {
        out[key] = pv;
      }
    });
    return out;
  }

  function updateJob(id, patch) {
    if (!id || !patch || typeof patch !== 'object' || Array.isArray(patch)) {
      console.warn('[JobState] updateJob: invalid arguments');
      return;
    }
    let found = false;
    _jobs = _jobs.map(function (j) {
      if (j.id === id) {
        found = true;
        var merged = _deepMergePatch(j, patch);
        merged.id = id;
        return merged;
      }
      return j;
    });
    if (!found) {
      console.warn('[JobState] updateJob: job "' + id + '" not found');
    }
    _rebuildIndex();
    if (_curJob && _curJob.id === id) {
      _resyncCurJob();
    }
    _emit((_bus && _bus.EVENTS && _bus.EVENTS.JOBS_CHANGED) || 'jobs:changed', { jobs: _jobs.slice() });
  }

  function deleteJob(id) {
    const before = _jobs.length;
    _jobs = _jobs.filter(function (j) { return j.id !== id; });
    const removed = _jobs.length < before;
    _rebuildIndex();
    if (_curJob && _curJob.id === id) {
      _curJob = null;
    }
    _bulkSelected.delete(id);
    if (removed) {
      _emit((_bus && _bus.EVENTS && _bus.EVENTS.JOBS_DELETED) || 'jobs:deleted', { jobId: id });
      _emit((_bus && _bus.EVENTS && _bus.EVENTS.JOBS_CHANGED) || 'jobs:changed', { jobs: _jobs.slice() });
    }
    return removed;
  }

  function bulkDeleteJobs(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return 0;
    const idSet = new Set(ids);
    const existingIds = _jobs.filter(function (j) { return j && idSet.has(j.id); }).map(function (j) { return j.id; });
    const before = _jobs.length;
    _jobs = _jobs.filter(function (j) { return !idSet.has(j.id); });
    if (_curJob && idSet.has(_curJob.id)) {
      _curJob = null;
    }
    ids.forEach(function (id) { _bulkSelected.delete(id); });
    const count = before - _jobs.length;
    _rebuildIndex();
    if (count > 0) {
      existingIds.forEach(function (id) {
        _emit((_bus && _bus.EVENTS && _bus.EVENTS.JOBS_DELETED) || 'jobs:deleted', { jobId: id });
      });
      _emit((_bus && _bus.EVENTS && _bus.EVENTS.JOBS_CHANGED) || 'jobs:changed', { jobs: _jobs.slice() });
    }
    return count;
  }

  function bulkUpdateJobs(ids, patch) {
    if (!Array.isArray(ids) || ids.length === 0 || !patch || typeof patch !== 'object' || Array.isArray(patch)) return 0;
    const idSet = new Set(ids);
    let count = 0;
    _jobs = _jobs.map(function (j) {
      if (!idSet.has(j.id)) return j;
      count++;
      var merged = _deepMergePatch(j, patch);
      merged.id = j.id;
      return merged;
    });
    _rebuildIndex();
    _resyncCurJob();
    if (count > 0) {
      _emit((_bus && _bus.EVENTS && _bus.EVENTS.JOBS_CHANGED) || 'jobs:changed', { jobs: _jobs.slice() });
    }
    return count;
  }

  function findJob(id) {
    return _cloneById(id);
  }


  function getCurJob() {
    return _curJob ? _deepClone(_curJob) : null;
  }

  function openJob(id) {
    const found = _cloneById(id);
    if (!found) {
      console.warn('[JobState] openJob: job "' + id + '" not found, current job unchanged');
      return null;
    }
    _curJob = found;
    return _deepClone(_curJob);
  }

  function clearCurJob() {
    _curJob = null;
  }

  function resyncCurJob() {
    _resyncCurJob();
  }


  function getJobCount() {
    return _jobCount;
  }

  function nextJobId() {
    let maxN = 0;
    for (var i = 0; i < _jobs.length; i++) {
      var m = _jobs[i] && _jobs[i].id && _jobs[i].id.match(/^JOB-(\d+)$/);
      if (m) {
        var n = parseInt(m[1], 10);
        if (n > maxN) maxN = n;
      }
    }
    if (maxN + 1 > _jobCount) {
      _jobCount = maxN + 1;
    }
    const candidate = 'JOB-' + String(_jobCount).padStart(3, '0');
    _jobCount++;
    return candidate;
  }


  function getCurrentFilter() {
    return _currentFilter;
  }

  function setCurrentFilter(filter) {
    if (typeof filter !== 'string' || filter.trim() === '') {
      console.warn('[JobState] setCurrentFilter: invalid filter "' + filter + '"');
      return;
    }
    _currentFilter = filter.trim();
  }


  function isBulkMode() {
    return _bulkMode;
  }

  function setBulkMode(active) {
    _bulkMode = Boolean(active);
    if (!_bulkMode) {
      _bulkSelected.clear();
    }
  }

  function getBulkSelected() {
    return new Set(_bulkSelected);
  }

  function toggleBulkSelect(id) {
    if (!id) {
      console.warn('[JobState] toggleBulkSelect: invalid id "' + id + '"');
      return;
    }
    const next = new Set(_bulkSelected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    _bulkSelected = next;
  }

  function clearBulkSelection() {
    _bulkSelected.clear();
    _bulkMode = false;
  }

  function selectAllJobs(list) {
    var source = Array.isArray(list) ? list : _jobs;
    _bulkSelected = new Set(source.filter(function (j) { return j && j.id; }).map(function (j) { return j.id; }));
  }

  function deselectAllJobs() {
    _bulkSelected.clear();
  }


  function countByStatus(status) {
    return _jobs.filter(function (j) { return j.status === status; }).length;
  }

  function getActiveBadgeCount() {
    return _jobs.filter(function (j) {
      return j.status !== 'delivered' && j.status !== 'cancelled';
    }).length;
  }

  function countCompletedToday() {
    const today = _today();
    return _jobs.filter(function (j) {
      return (j.status === 'completed' || j.status === 'delivered') &&
             (j.date || '').startsWith(today);
    }).length;
  }

  function getMonthlyLabour() {
    const currMo = _today().slice(0, 7);
    return _jobs
      .filter(function (j) {
        return (j.status === 'completed' || j.status === 'delivered') &&
               (j.date || '').startsWith(currMo);
      })
      .reduce(function (sum, j) {
        var lab = (Array.isArray(j.labourLines) && j.labourLines.length)
          ? j.labourLines.reduce(function (s, ll) { return s + (Number(ll.amt) || 0); }, 0)
          : (Number(j.lab) || 0);
        return sum + lab;
      }, 0);
  }

  function reset(keepBus) {
    _jobs          = [];
    _jobsById      = {};
    _curJob        = null;
    _jobCount      = 1;
    _currentFilter = 'all';
    _bulkMode      = false;
    _bulkSelected  = new Set();
    if (!keepBus) _bus = null;
  }


  return {
    init,

    VALID_JOB_STATUSES,
    STATUS_ORDER,
    STAGES_7,
    STATUS_CONF,

    getJobs,
    setJobs,
    updateJob,
    deleteJob,
    bulkDeleteJobs,
    bulkDeleteByIds: bulkDeleteJobs,
    bulkUpdateJobs,
    findJob,

    getCurJob,
    openJob,
    clearCurJob,
    resyncCurJob,

    getJobCount,
    nextJobId,

    getCurrentFilter,
    setCurrentFilter,

    isBulkMode,
    setBulkMode,
    getBulkSelected,
    toggleBulkSelect,
    clearBulkSelection,
    selectAllJobs,
    deselectAllJobs,

    countByStatus,
    getActiveBadgeCount,
    countCompletedToday,
    getMonthlyLabour,

    reset,


    getAll: getJobs,
    getById: findJob,

    replaceJob: function replaceJob(id, data) {
      if (!id || !data || typeof data !== 'object') {
        console.warn('[JobState] replaceJob: invalid arguments');
        return null;
      }
      let found = false;
      _jobs = _jobs.map(function (j) {
        if (j.id === id) {
          found = true;
          return _deepClone(Object.assign({}, data, { id: id }));
        }
        return j;
      });
      if (!found) {
        console.warn('[JobState] replaceJob: job "' + id + '" not found');
        return null;
      }
      if (_curJob && _curJob.id === id) {
        _resyncCurJob();
      }
      _rebuildIndex();
      _emit((_bus && _bus.EVENTS && _bus.EVENTS.JOBS_CHANGED) || 'jobs:changed', { jobs: _jobs.slice() });
      return findJob(id);
    },

    addJob: function addJobWithReturn(jobData) {
      if (!jobData || typeof jobData !== 'object' || Array.isArray(jobData)) {
        console.warn('[JobState] addJob: invalid job object');
        return null;
      }
      if (!jobData.id) {
        jobData = Object.assign({}, jobData, { id: nextJobId() });
      }
      var validErr = _validateJob(jobData, 'addJob');
      // DECISION (deliberate behavior change, documented): previously logged validErr
      // and proceeded to save regardless. job_service.js (the UI save path) already
      // blocks on this identical Validators.job() check — leaving this lower-level API
      // non-blocking meant any caller that isn't the UI form (imports, sync, direct
      // JobState.addJob() calls) could still write a job with an invalid discount
      // straight into state, fully bypassing the validation this consolidation exists
      // to enforce. Blocking here closes that gap. If this ever rejects a save you
      // expect to succeed, the message in the returned null path (via console.warn)
      // will say exactly which business rule failed.
      if (validErr) { console.warn(validErr); return null; }
      var added = _addJob(jobData);
      if (!added) return null;
      return findJob(jobData.id);
    },

    setJobStatus: function setJobStatus(id, status) {
      if (!VALID_JOB_STATUSES.includes(status)) {
        console.warn('[JobState] setJobStatus: invalid status "' + status + '"');
        return null;
      }
      const job = _jobs.find(function (j) { return j.id === id; });
      if (!job) {
        console.warn('[JobState] setJobStatus: job "' + id + '" not found');
        return null;
      }
      const patch = { status: status };
      if (status === 'completed' || status === 'delivered') {
        patch.completedDate = _today();
      }
      if (status === 'cancelled') {
        patch.cancelledDate = _today();
      }
      updateJob(id, patch);
      _emit((_bus && _bus.EVENTS && _bus.EVENTS.JOBS_STATUS_CHANGED) || 'jobs:statusChanged',
            { jobId: id, status: status });
      return findJob(id);
    },

    approveJob: function approveJob() {
      if (!_curJob) return false;
      if (_curJob.customerApproved) return false;
      const patch = {
        customerApproved: true,
        approvedAt: new Date().toISOString(),
      };
      updateJob(_curJob.id, patch);
      return true;
    },

    bulkDelete: function bulkDelete() {
      const ids = Array.from(_bulkSelected);
      if (!ids.length) return 0;
      return bulkDeleteJobs(ids);
    },

    bulkSetStatus: function bulkSetStatus(status) {
      if (!VALID_JOB_STATUSES.includes(status)) {
        console.warn('[JobState] bulkSetStatus: invalid status "' + status + '"');
        return 0;
      }
      const ids = Array.from(_bulkSelected);
      if (!ids.length) return 0;
      const patch = { status: status };
      if (status === 'completed' || status === 'delivered') {
        patch.completedDate = _today();
      }
      if (status === 'cancelled') {
        patch.cancelledDate = _today();
      }
      const count = bulkUpdateJobs(ids, patch);
      if (count > 0) {
        ids.forEach(function (id) {
          _emit((_bus && _bus.EVENTS && _bus.EVENTS.JOBS_STATUS_CHANGED) || 'jobs:statusChanged',
                { jobId: id, status: status });
        });
      }
      return count;
    },

    getBulkCount: function getBulkCount() {
      return _bulkSelected.size;
    },

    getActiveCount: getActiveBadgeCount,

    deleteJobPart: function deleteJobPart(idx) {
      if (!_curJob) return false;
      const job = _jobs.find(function (j) { return j.id === _curJob.id; });
      if (!job || !Array.isArray(job.parts)) return false;
      if (idx < 0 || idx >= job.parts.length) return false;
      const newParts = job.parts.slice();
      newParts.splice(idx, 1);
      _jobs = _jobs.map(function (j) {
        return j.id === job.id ? Object.assign({}, job, { parts: newParts }) : j;
      });
      _rebuildIndex();
      _resyncCurJob();
      _emit((_bus && _bus.EVENTS && _bus.EVENTS.JOBS_CHANGED) || 'jobs:changed', { jobs: _jobs.slice() });
      return true;
    },

    getBulkMode: isBulkMode,

    toggleBulkMode: function toggleBulkMode() {
      setBulkMode(!_bulkMode);
    },

    toggleBulkItem: toggleBulkSelect,

    clearBulk: clearBulkSelection,

    VALID_STATUSES: VALID_JOB_STATUSES,

    STATUS_CONFIG: STATUS_CONF,


    labourClockStart: function (id) {
      var job = _jobs.find(function (j) { return j.id === id; });
      if (!job) { console.warn('[JobState] labourClockStart: job not found:', id); return null; }
      if (job.labourClock && job.labourClock.endTime) {
        console.warn('[JobState] labourClockStart: clock already ended for', id); return null;
      }
      var now = new Date().toISOString();
      var existing = job.labourClock || {};
      var patch = {
        labourClock: Object.assign({}, existing, {
          startTime:   existing.startTime || now,
          lastResumed: now,
          paused:      false,
          pausedMs:    existing.pausedMs    || 0,
          pauseStart:  null,
        })
      };
      updateJob(id, patch);
      return findJob(id);
    },

    labourClockPause: function (id) {
      var job = _jobs.find(function (j) { return j.id === id; });
      if (!job || !job.labourClock || !job.labourClock.startTime) return null;
      if (job.labourClock.endTime) return null;
      if (job.labourClock.paused) return null;
      var now = new Date().toISOString();
      var patch = {
        labourClock: Object.assign({}, job.labourClock, {
          paused:     true,
          pauseStart: now,
        })
      };
      updateJob(id, patch);
      return findJob(id);
    },

    labourClockResume: function (id) {
      var job = _jobs.find(function (j) { return j.id === id; });
      if (!job || !job.labourClock || !job.labourClock.paused) return null;
      var now = new Date();
      var pausedMs = job.labourClock.pausedMs || 0;
      if (job.labourClock.pauseStart) {
        var pStart = new Date(job.labourClock.pauseStart);
        if (!isNaN(pStart.getTime())) {
          pausedMs += (now - pStart);
        } else {
          console.warn('[JobState] labourClockResume: invalid pauseStart for job "' + id + '", pause duration not counted');
        }
      } else {
        console.warn('[JobState] labourClockResume: missing pauseStart for job "' + id + '", pause duration not counted');
      }
      var patch = {
        labourClock: Object.assign({}, job.labourClock, {
          paused:      false,
          pauseStart:  null,
          pausedMs:    pausedMs,
          lastResumed: now.toISOString(),
        })
      };
      updateJob(id, patch);
      return findJob(id);
    },

    labourClockEnd: function (id) {
      var job = _jobs.find(function (j) { return j.id === id; });
      if (!job || !job.labourClock || !job.labourClock.startTime) return null;
      var now      = new Date();
      var clk      = job.labourClock;
      var pausedMs = clk.pausedMs || 0;
      if (clk.paused && clk.pauseStart) {
        var _pStart = new Date(clk.pauseStart);
        if (!isNaN(_pStart.getTime())) {
          pausedMs += now - _pStart;
        } else {
          console.warn('[JobState] labourClockEnd: invalid pauseStart for job "' + id + '", ignoring open pause segment');
        }
      }
      var startMs   = new Date(clk.startTime).getTime();
      var totalMs   = now.getTime() - startMs - pausedMs;
      var MS_PER_HOUR = 3600000;
      var actualHrs = Math.max(0, Math.round((totalMs / MS_PER_HOUR) * 100) / 100);
      var patch = {
        labourClock: Object.assign({}, clk, {
          endTime:   now.toISOString(),
          pausedMs:  pausedMs,
          actualHrs: actualHrs,
          paused:    false,
          pauseStart: null,
        })
      };
      updateJob(id, patch);
      return findJob(id);
    },

    labourClockGetStats: function (id) {
      var job = _jobs.find(function (j) { return j.id === id; });
      if (!job) return null;
      var clk        = job.labourClock || {};
      var actualHrs  = clk.actualHrs || 0;
      var SHOP_RATE_PER_HR = 500;
      try {
        var _settings = (window.ERP && window.ERP.state && window.ERP.state.selectors)
          ? (window.ERP.state.selectors.settings() || {}) : {};
        if (_settings.labourRate && Number(_settings.labourRate) > 0) {
          SHOP_RATE_PER_HR = Number(_settings.labourRate);
        }
      } catch (_e) { console.warn('[JobState] labourClockGetStats: failed to read labour rate from settings:', _e); }
      var billedHrs  = (job.labourLines || []).reduce(function (s, ll) {
        if (Number(ll.hrs) > 0) return s + Number(ll.hrs);
        if (Number(ll.amt) > 0) return s + (Number(ll.amt) / SHOP_RATE_PER_HR);
        return s;
      }, 0);
      var efficiency = (actualHrs > 0 && billedHrs > 0)
        ? Math.round((billedHrs / actualHrs) * 100)
        : null;
      return {
        startTime:  clk.startTime  || null,
        endTime:    clk.endTime    || null,
        paused:     !!clk.paused,
        actualHrs:  actualHrs,
        billedHrs:  billedHrs,
        efficiency: efficiency,
        running:    !!(clk.startTime && !clk.endTime),
      };
    },

  };

})();

if (typeof window !== "undefined") window.JobState = JobState;
