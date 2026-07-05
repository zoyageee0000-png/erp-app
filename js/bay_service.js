
'use strict';

var BayService = (function () {

  var _state    = null;
  var _storage  = null;
  var _bus      = null;
  var _deps     = {};
  var _inited   = false;

  var DEFAULT_BAY_COUNT = 4;

  function init(state, storage, bus, deps) {
    _state   = state;
    _storage = storage;
    _bus     = bus;
    _deps    = deps || {};
    if (!_inited) {
      _inited = true;
      _seedBays();
    }
  }

  function _toast(msg, type, dur) {
    if (typeof _deps.showToast === 'function') _deps.showToast(msg, type || 'info', dur);
    else if (ERP && ERP.ui && typeof ERP.ui.toast === 'function') ERP.ui.toast(msg, type || 'info');
  }

  function _esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
    });
  }

  function _getBays() {
    try {
      var st = ERP && ERP.state && ERP.state.get ? ERP.state.get() : null;
      if (st && st.settings && st.settings.bays) {
        return st.settings.bays;
      }
      return [];
    } catch (e) { return []; }
  }

  function _setBays(bays) {
    try {
      if (ERP && ERP.state && typeof ERP.state.set === 'function') {
        ERP.state.set(function (s) {
          if (!s.settings) s.settings = {};
          s.settings.bays = bays;
        });
      }
      if (_storage && typeof _storage.schedule === 'function') {
        var prov = _deps.getProviders ? _deps.getProviders() : (_deps.providers || {});
        _storage.schedule(prov);
      }
    } catch (e) { console.error('[BayService] _setBays error:', e); }
  }

  function _seedBays() {
    try {
      var existing = _getBays();
      if (existing.length > 0) return;
      var bays = [];
      for (var i = 1; i <= DEFAULT_BAY_COUNT; i++) {
        bays.push({
          id:         'BAY-' + String(i).padStart(2, '0'),
          name:       'Bay ' + i,
          status:     'free',
          jobId:      null,
          assignedAt: null,
          notes:      '',
        });
      }
      _setBays(bays);
    } catch (e) { console.error('[BayService] _seedBays error:', e); }
  }


  function getBays() {
    return _getBays();
  }

  function getBayById(bayId) {
    return _getBays().find(function (b) { return b.id === bayId; }) || null;
  }

  function getJobBay(jobId) {
    return _getBays().find(function (b) { return b.jobId === jobId; }) || null;
  }

  function getFreeBayCount() {
    return _getBays().filter(function (b) { return b.status === 'free'; }).length;
  }

  function assignBay(bayId, jobId) {
    if (!bayId || !jobId) { _toast('Bay ID and Job ID are required', 'error'); return null; }
    var bays = _getBays();
    var idx  = bays.findIndex(function (b) { return b.id === bayId; });
    if (idx === -1) { _toast('Bay not found: ' + bayId, 'error'); return null; }

    var bay = bays[idx];
    if (bay.status === 'occupied') {
      _toast('Bay is already occupied — release it first', 'warning'); return null;
    }
    if (bay.status === 'maintenance') {
      _toast('Bay is under maintenance', 'warning'); return null;
    }

    var existing = getJobBay(jobId);
    if (existing) {
      _toast('Job already ' + existing.id + ' mein assigned hai', 'warning'); return null;
    }

    bays[idx] = Object.assign({}, bay, {
      status:     'occupied',
      jobId:      jobId,
      assignedAt: new Date().toISOString(),
    });
    _setBays(bays);
    _toast('✅ Job ' + jobId + ' → ' + bay.name, 'success');
    if (_bus && _bus.emit) _bus.emit('bays:changed', { bays: bays });
    return bays[idx];
  }

  function releaseBay(bayId) {
    if (!bayId) return null;
    var bays = _getBays();
    var idx  = bays.findIndex(function (b) { return b.id === bayId; });
    if (idx === -1) { _toast('Bay not found: ' + bayId, 'error'); return null; }

    bays[idx] = Object.assign({}, bays[idx], {
      status:     'free',
      jobId:      null,
      assignedAt: null,
    });
    _setBays(bays);
    _toast(bays[idx].name + ' free ho gayi', 'info');
    if (_bus && _bus.emit) _bus.emit('bays:changed', { bays: bays });
    return bays[idx];
  }

  function setBayMaintenance(bayId, onOff) {
    var bays = _getBays();
    var idx  = bays.findIndex(function (b) { return b.id === bayId; });
    if (idx === -1) return null;
    var currentStatus = bays[idx].status;
    if (onOff && currentStatus === 'occupied') {
      _toast('Bay is occupied — release it first', 'warning'); return null;
    }
    if (!onOff && currentStatus !== 'maintenance') {
      return bays[idx];
    }
    bays[idx] = Object.assign({}, bays[idx], {
      status: onOff ? 'maintenance' : 'free',
      jobId:  null, assignedAt: null,
    });
    _setBays(bays);
    if (_bus && _bus.emit) _bus.emit('bays:changed', { bays: bays });
    return bays[idx];
  }

  function addBay(name) {
    var bays = _getBays();
    var num  = bays.length + 1;
    var newBay = {
      id:         'BAY-' + String(num).padStart(2, '0') + '-' + ERP.uid(), // FIX (root cause, audit #61-62): was Date.now()+Math.random(); route through the one canonical generator, keep the meaningful bay-number prefix.
      name:       name || ('Bay ' + num),
      status:     'free',
      jobId:      null,
      assignedAt: null,
      notes:      '',
    };
    bays.push(newBay);
    _setBays(bays);
    if (_bus && _bus.emit) _bus.emit('bays:changed', { bays: bays });
    return newBay;
  }

  function renderBayPanel(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;

    var bays  = _getBays();
    var jobs  = [];
    try {
      var st = ERP && ERP.state && ERP.state.get ? ERP.state.get() : null;
      jobs   = (st && st.data && st.data.jobs) ? st.data.jobs : [];
    } catch (e) {}

    var STATUS_MAP = {
      free:        { border: '#16a34a', bg: '#f0fdf4', text: '#166534', label: 'Free',        dot: '#16a34a' },
      occupied:    { border: '#d97706', bg: '#fffbeb', text: '#92400e', label: 'Occupied',     dot: '#d97706' },
      reserved:    { border: '#6366f1', bg: '#eef2ff', text: '#3730a3', label: 'Reserved',     dot: '#6366f1' },
      maintenance: { border: '#dc2626', bg: '#fef2f2', text: '#991b1b', label: 'Maintenance',  dot: '#dc2626' },
    };

    var freeCnt = bays.filter(function (b) { return b.status === 'free'; }).length;
    var occCnt  = bays.filter(function (b) { return b.status === 'occupied'; }).length;
    var mntCnt  = bays.filter(function (b) { return b.status === 'maintenance'; }).length;

    var cards = bays.map(function (bay) {
      var sc  = STATUS_MAP[bay.status] || STATUS_MAP.free;
      var job = bay.jobId ? jobs.find(function (j) { return j.id === bay.jobId; }) : null;

      var jobInfo = job
        ? '<div style="margin-top:7px;padding:7px 9px;background:rgba(0,0,0,.04);border-radius:5px;font-size:11px;color:' + sc.text + '">' +
            '<div style="font-weight:600;margin-bottom:2px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;vertical-align:-3px"><use href="#ic-car"/></svg>' + _esc(job.car || '') + ' &nbsp;<span style="font-family:monospace;background:rgba(0,0,0,.08);padding:1px 5px;border-radius:3px">' + _esc(job.plate || '') + '</span></div>' +
            '<div style="color:' + sc.text + ';opacity:.8"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px;vertical-align:-3px"><use href="#ic-users"/></svg>' + _esc(job.cust || '') + '</div>' +
          '</div>'
        : '';

      var btns = '';
      if (bay.status === 'free') {
        var assignableJobs = jobs.filter(function (j) {
          return (j.status === 'pending' || j.status === 'in-progress') && !getJobBay(j.id);
        });
        if (assignableJobs.length > 0) {
          btns +=
            '<div style="display:flex;gap:5px;margin-top:8px;align-items:center">' +
              '<select id="bay-assign-' + _esc(bay.id) + '" style="flex:1;font-size:11px;padding:4px 6px;border:0.5px solid #d1d5db;border-radius:5px;outline:none;background:var(--white,#fff)">' +
                '<option value="">Assign job…</option>' +
                assignableJobs.map(function (j) {
                  return '<option value="' + _esc(j.id) + '">' + _esc(j.id) + ' — ' + _esc(j.car || '') + '</option>';
                }).join('') +
              '</select>' +
              '<button class="bay-assign-btn" data-bay-id="' + _esc(bay.id) + '" data-container-id="' + _esc(containerId) + '" style="padding:4px 8px;border-radius:5px;border:none;background:#16a34a;color:#fff;font-size:11px;cursor:pointer;font-weight:600"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;vertical-align:-3px"><use href="#ic-check"/></svg></button>' +
            '</div>';
        }
        btns += '<button class="bay-maint-btn" data-bay-id="' + _esc(bay.id) + '" data-on="true" style="margin-top:6px;width:100%;padding:5px;border-radius:5px;border:0.5px solid #fca5a5;background:var(--white,#fff);color:#dc2626;font-size:10px;font-weight:600;cursor:pointer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px;vertical-align:-3px"><use href="#ic-tool"/></svg> Set Maintenance</button>';
      } else if (bay.status === 'occupied') {
        btns = '<button class="bay-release-btn" data-bay-id="' + _esc(bay.id) + '" data-container-id="' + _esc(containerId) + '" style="margin-top:8px;width:100%;padding:5px;border-radius:5px;border:0.5px solid #86efac;background:#f0fdf4;color:#16a34a;font-size:10px;font-weight:600;cursor:pointer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px;vertical-align:-3px"><use href="#ic-lock"/></svg> Release Bay</button>';
      } else if (bay.status === 'maintenance') {
        btns = '<button class="bay-maint-btn" data-bay-id="' + _esc(bay.id) + '" data-on="false" data-container-id="' + _esc(containerId) + '" style="margin-top:8px;width:100%;padding:5px;border-radius:5px;border:0.5px solid #a5b4fc;background:#eef2ff;color:#4338ca;font-size:10px;font-weight:600;cursor:pointer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px;vertical-align:-3px"><use href="#ic-check"/></svg> Mark Free</button>';
      }

      return '<div style="border:0.5px solid ' + sc.border + ';background:' + sc.bg + ';border-radius:8px;padding:11px 12px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">' +
          '<span style="font-weight:600;font-size:13px;color:' + sc.text + '">' + _esc(bay.name) + '</span>' +
          '<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;color:' + sc.text + '">' +
            '<span style="width:7px;height:7px;border-radius:50%;background:' + sc.dot + ';display:inline-block"></span>' +
            sc.label +
          '</span>' +
        '</div>' +
        jobInfo + btns +
      '</div>';
    }).join('');

    el.innerHTML =
      '<style>' +
        '#' + _esc(containerId) + ' .bp-stat{background:var(--white,#fff);border:0.5px solid var(--border,#e5e7eb);border-radius:7px;padding:8px 12px;display:flex;align-items:center;gap:8px;font-size:12px}' +
      '</style>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">' +
        '<div style="font-size:13px;font-weight:600;color:var(--text,#1e293b);display:flex;align-items:center;gap:6px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;vertical-align:-3px;color:#4338CA"><use href="#ic-box"/></svg> Bay Management</div>' +
        '<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">' +
          '<div class="bp-stat"><span style="width:8px;height:8px;border-radius:50%;background:#16a34a;display:inline-block"></span><span>Free: <strong>' + freeCnt + '</strong></span></div>' +
          '<div class="bp-stat"><span style="width:8px;height:8px;border-radius:50%;background:#d97706;display:inline-block"></span><span>Busy: <strong>' + occCnt + '</strong></span></div>' +
          '<div class="bp-stat"><span style="width:8px;height:8px;border-radius:50%;background:#dc2626;display:inline-block"></span><span>Maint: <strong>' + mntCnt + '</strong></span></div>' +
          '<button class="bay-add-btn" style="padding:6px 12px;border-radius:6px;border:0.5px solid #bfdbfe;background:#eff6ff;color:#4338CA;font-size:11px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:4px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;vertical-align:-3px"><use href="#ic-plus"/></svg> Add Bay</button>' +
        '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(195px,1fr));gap:10px">' + (cards || '<div style="grid-column:1/-1;padding:32px;text-align:center;color:#9ca3af;font-size:12px">No bays configured</div>') + '</div>';
    _setupBayEvents(containerId);
  }


  function _setupBayEvents(containerId) {
    var el = document.getElementById(containerId);
    if (!el || el._bayEventsSetup) return;
    el._bayEventsSetup = true;
    el.addEventListener('click', function(e) {
      var btn = e.target.closest('.bay-assign-btn');
      if (btn) {
        var bayId = btn.getAttribute('data-bay-id');
        var cId = btn.getAttribute('data-container-id');
        var sel = document.getElementById('bay-assign-' + bayId);
        if (sel && sel.value) {
          assignBay(bayId, sel.value);
          if (cId) renderBayPanel(cId);
        } else {
          _toast('Job select karo', 'warning');
        }
        return;
      }
      btn = e.target.closest('.bay-release-btn');
      if (btn) {
        var bayId = btn.getAttribute('data-bay-id');
        var cId = btn.getAttribute('data-container-id');
        releaseBay(bayId);
        if (cId) renderBayPanel(cId);
        return;
      }
      btn = e.target.closest('.bay-maint-btn');
      if (btn) {
        var bayId = btn.getAttribute('data-bay-id');
        var onOff = btn.getAttribute('data-on') === 'true';
        setBayMaintenance(bayId, onOff);
        var cId = btn.getAttribute('data-container-id') || containerId;
        if (cId) renderBayPanel(cId);
        return;
      }
      btn = e.target.closest('.bay-add-btn');
      if (btn) {
        addBay();
        renderBayPanel(containerId);
        return;
      }
    });
  }

  function _assignFromSelect(bayId, containerId) {
    var sel = document.getElementById('bay-assign-' + bayId);
    if (!sel || !sel.value) { _toast('Job select karo', 'warning'); return; }
    assignBay(bayId, sel.value);
    if (containerId) renderBayPanel(containerId);
  }

  return {
    init,
    getBays,
    getBayById,
    getJobBay,
    getFreeBayCount,
    assignBay,
    releaseBay,
    setBayMaintenance,
    addBay: function (name) {
      var b = addBay(name || prompt('Bay ka naam:') || undefined);
      var panel = document.querySelector('[data-bay-panel]');
      if (panel) renderBayPanel(panel.id);
      return b;
    },
    renderBayPanel,
    _assignFromSelect,
    _toast: function (m, t) { _toast(m, t); },
  };

})();
