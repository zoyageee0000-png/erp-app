
const VehicleState = (function () {
  'use strict';

  let _vehicles = [];
  let _searchQuery = '';
  let _bus = null;
  let _getJobs = null;

  function _emit(key, payload) {
    if (!_bus || typeof _bus.emit !== 'function') return;
    const name = (_bus.EVENTS && _bus.EVENTS[key]) || key;
    try { _bus.emit(name, payload); } catch (e) {
      console.warn('[VehicleState] emit failed for "' + key + '":', e);
    }
  }

  let _updateJob = null;

  function init(eventBus, getJobsFn, updateJobFn) {
    if (eventBus && typeof eventBus.emit === 'function') _bus = eventBus;
    if (typeof getJobsFn   === 'function') _getJobs   = getJobsFn;
    if (typeof updateJobFn === 'function') _updateJob = updateJobFn;
  }

  function getVehicles() {
    return _vehicles.slice();
  }

  function setVehicles(arr) {
    if (!Array.isArray(arr)) {
      console.warn('[VehicleState] setVehicles: expected Array, got ' + typeof arr);
      return;
    }
    _vehicles = arr.map(function (v) {
      const plate = (v.plate || '').trim().toUpperCase();
      return Object.assign({}, v, {
        plate: plate,
        id: v.id || ('VEH-' + plate),
      });
    });
  }

  function findVehicle(plate) {
    if (!plate) return null;
    const p = plate.trim().toUpperCase();
    return _vehicles.find(function (v) { return v.plate === p; }) || null;
  }

  function plateExists(plate, excludePlate) {
    const p  = (plate        || '').trim().toUpperCase();
    const ex = (excludePlate || '').trim().toUpperCase();
    return _vehicles.some(function (v) {
      return v.plate === p && v.plate !== ex;
    });
  }

  function addVehicle(vData) {
    if (!vData || !vData.plate) {
      console.warn('[VehicleState] addVehicle: missing plate');
      return null;
    }
    const plate = vData.plate.trim().toUpperCase();
    if (plateExists(plate)) {
      console.warn('[VehicleState] addVehicle: duplicate plate rejected:', plate);
      return null;
    }
    const v = Object.assign({}, vData, {
      plate: plate,
      id: vData.id || ('VEH-' + plate),
    });
    _vehicles.unshift(v);
    _emit('VEHICLES_CHANGED', { vehicles: _vehicles });
    return v;
  }

  function updateVehicle(plate, vData) {
    const p   = (plate || '').trim().toUpperCase();
    let found = false;

    _vehicles = _vehicles.map(function (v) {
      if (v.plate !== p) return v;
      found = true;
      const newPlate = (vData.plate || p).trim().toUpperCase();
      return Object.assign({}, v, vData, {
        plate: newPlate,
        id: vData.id || v.id || ('VEH-' + newPlate),
      });
    });

    if (!found) {
      console.warn('[VehicleState] updateVehicle: plate "' + p + '" not found');
      return null;
    }
    _emit('VEHICLES_CHANGED', { vehicles: _vehicles });
    return findVehicle((vData.plate || p));
  }

  function deleteVehicle(plate) {
    const p      = (plate || '').trim().toUpperCase();
    const before = _vehicles.length;
    _vehicles    = _vehicles.filter(function (v) { return v.plate !== p; });
    const removed = _vehicles.length < before;

    if (removed) {
      if (typeof _getJobs === 'function') {
        _getJobs().forEach(function (j) {
          if (j.plate !== p) return;
          if (typeof _updateJob === 'function') {
            _updateJob(j.id, { _vehicleDeleted: true });
          }
        });
      }
      _emit('VEHICLES_DELETED', { plate: p });
      _emit('VEHICLES_CHANGED', { vehicles: _vehicles });
      _emit('JOBS_CHANGED', { jobs: typeof _getJobs === 'function' ? _getJobs() : [] });
    }
    return removed;
  }

  function updateKm(plate, km) {
    const p  = (plate || '').trim().toUpperCase();
    const kn = parseInt(km, 10) || 0;
    if (kn <= 0) return null;
    let result = null;
    let found = false;

    _vehicles = _vehicles.map(function (v) {
      if (v.plate !== p) return v;
      found = true;
      const hist = (v.kmHistory || []).slice();
      if (kn > 0 && kn !== v.km && !hist.some(function (h) { return h.km === kn; })) {
        hist.push({ km: kn, date: (function(){ var _d=new Date(); return _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0'); })() });
      }
      result = Object.assign({}, v, { km: kn, kmHistory: hist });
      return result;
    });

    if (!found) return null;

    _emit('VEHICLES_CHANGED', { vehicles: _vehicles });
    return result;
  }

  function getSearchQuery() { return _searchQuery; }

  function setSearchQuery(q) { _searchQuery = (q || '').trim().toLowerCase(); }

  function getFiltered() {
    if (!_searchQuery) return _vehicles.slice();
    return _vehicles.filter(function (v) {
      return (
        (v.plate   || '').toLowerCase().includes(_searchQuery) ||
        (v.model   || '').toLowerCase().includes(_searchQuery) ||
        (v.cust    || '').toLowerCase().includes(_searchQuery) ||
        (v.chassis || '').toLowerCase().includes(_searchQuery) ||
        (v.engine  || '').toLowerCase().includes(_searchQuery)
      );
    });
  }

  function getStats() {
    const today = (function(){ var _d=new Date(); return _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0'); })();
    const jobs  = (typeof _getJobs === 'function' ? _getJobs() : null) || [];

    return {
      total:      _vehicles.length,
      due:        _vehicles.filter(function (v) { return v.nextService && v.nextService <= today; }).length,
      ok:         _vehicles.filter(function (v) { return v.nextService && v.nextService > today; }).length,
      activeJobs: _vehicles.filter(function (v) {
        return jobs.some(function (j) {
          return j.plate === v.plate && j.status !== 'delivered' && j.status !== 'cancelled';
        });
      }).length,
    };
  }

  function getJobsForPlate(plate) {
    const p = (plate || '').trim().toUpperCase();
    if (typeof _getJobs !== 'function') return [];
    return _getJobs().filter(function (j) {
      return (j.plate || '').trim().toUpperCase() === p;
    });
  }

  function getActiveJob(plate) {
    const p    = (plate || '').trim().toUpperCase();
    const jobs = (typeof _getJobs === 'function' ? _getJobs() : null) || [];
    return jobs.find(function (j) {
      return (j.plate || '').trim().toUpperCase() === p &&
             j.status !== 'delivered' && j.status !== 'cancelled';
    }) || null;
  }

  function reset(keepBus) {
    _vehicles    = [];
    _searchQuery = '';
    if (!keepBus) { _bus = null; _getJobs = null; _updateJob = null; }
  }

  return {
    init,

    getVehicles,
    setVehicles,
    findVehicle,
    plateExists,
    addVehicle,
    updateVehicle,
    deleteVehicle,
    updateKm,

    getSearchQuery,
    setSearchQuery,

    getFiltered,
    getStats,
    getJobsForPlate,
    getActiveJob,

    reset,
  };

})();

if (typeof window !== "undefined") window.VehicleState = VehicleState;
