
const VehicleUI = (function () {
  'use strict';

  let _state   = null;
  let _service = null;
  let _bus     = null;
  let _deps    = {};
  let _initialized = false;
  let _vehiclesChangedHandler = null;


  function init(state, service, bus, deps) {
    if (_initialized) return;
    if (!state || !service || !bus) {
      throw new Error('[VehicleUI] init: state, service, and bus are required');
    }
    _state   = state;
    _service = service;
    _bus     = bus;
    _deps    = deps || {};
    _initialized = true;
    _vehiclesChangedHandler = function () { renderVehicles(); };
    _bus.on(_bus.EVENTS.VEHICLES_CHANGED, _vehiclesChangedHandler);

    _wireDelegated();
  }

  function destroy() {
    if (_bus && _vehiclesChangedHandler) {
      _bus.off(_bus.EVENTS.VEHICLES_CHANGED, _vehiclesChangedHandler);
      _vehiclesChangedHandler = null;
    }
    _initialized = false;
  }

  function _esc(str) {
    if (typeof _deps.escapeHtml === 'function') return _deps.escapeHtml(str);
    return String(str || '').replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
    });
  }

  function _el(id) { return document.getElementById(id); }

  function _setText(id, val) {
    const e = _el(id);
    if (e) e.textContent = val;
  }

  function _wireDelegated() {
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-veh-action]');
      if (!btn) return;

      const action = btn.dataset.vehAction;
      const plate  = btn.dataset.vehPlate;

      switch (action) {
        case 'history': viewVehicleHistory(plate);            break;
        case 'km':      openVehicleKmModal(plate);            break;
        case 'edit':    openVehicleModal(plate);              break;
        case 'delete':  _service.deleteVehicle(plate);        break;
        case 'wa':      _service.sendVehicleHistoryWA(plate); break;
        default: break;
      }
    });

    const searchEl = _el('vehicle-search');
    if (searchEl) {
      searchEl.addEventListener('keyup', function () {
        _state.setSearchQuery(this.value);
        renderVehicles();
      });
    }
  }

  function _renderStatCards() {
    const s = _state.getStats();
    _setText('veh-total',       s.total);
    _setText('veh-due',         s.due);
    _setText('veh-ok',          s.ok);
    _setText('veh-active-jobs', s.activeJobs);
  }

  function renderVehicles() {
    try {
      _renderStatCards();

      const tbody = _el('vehicle-tbody');
      if (!tbody) return;

      const vehicles = _state.getFiltered();

      if (!vehicles.length) {
        tbody.innerHTML =
          '<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--muted)">No vehicles found</td></tr>';
        return;
      }

      const today = (function(){ var _d=new Date(); return _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0'); })();

      const activeJobMap = {};
      vehicles.forEach(function (v) {
        activeJobMap[v.plate] = _state.getActiveJob(v.plate);
      });

      tbody.innerHTML = vehicles.map(function (v) {
        const overdue     = v.nextService && v.nextService <= today;
        const score       = v.conditionScore || 0;
        const scoreFill   = score >= 7 ? 'var(--success)' : score >= 4 ? 'var(--warning)' : 'var(--danger)';
        const activeJob   = activeJobMap[v.plate];
        const plate       = _esc(v.plate);

        var scoreHtml = score
          ? '<div class="au-score">' +
              '<span class="au-score-num" style="color:' + scoreFill + '">' + score + '</span>' +
              '<div class="au-score-bar"><div class="au-score-fill" style="width:' + (score*10) + '%;background:' + scoreFill + '"></div></div>' +
            '</div>'
          : '<span class="au-dim">—</span>';

        var jobBadge = activeJob
          ? '<span class="au-badge au-b-active">Active Job</span>'
          : '<span class="au-badge au-b-clear">Clear</span>';

        var nextSvcHtml = v.nextService
          ? '<span style="color:' + (overdue ? 'var(--danger)' : 'var(--success)') + ';font-weight:600">' +
              _esc(v.nextService) + (overdue ? ' ⚠' : '') + '</span>'
          : '<span class="au-dim">—</span>';

        return '<tr class="clickable" data-veh-action="history" data-veh-plate="' + plate + '">' +
          '<td><span class="au-plate">' + plate + '</span></td>' +
          '<td class="au-fw">' + _esc(v.model) + '</td>' +
          '<td class="au-hide-md au-dim">' + _esc(v.year || '—') + '</td>' +
          '<td class="au-fw">' + _esc(v.cust || '') + '</td>' +
          '<td class="au-hide-md au-dim au-mono">' + (v.km || 0).toLocaleString() + ' km</td>' +
          '<td>' + scoreHtml + '</td>' +
          '<td class="au-hide-md au-dim">' + _esc(v.lastService || '—') + '</td>' +
          '<td>' + nextSvcHtml + '</td>' +
          '<td>' + jobBadge + '</td>' +
          '<td>' +
            '<div class="au-row-actions">' +
              '<button class="au-act" data-veh-action="history" data-veh-plate="' + plate + '">History</button>' +
              '<button class="au-act" data-veh-action="km"      data-veh-plate="' + plate + '">KM</button>' +
              '<button class="au-act au-act-edit" data-veh-action="edit" data-veh-plate="' + plate + '">Edit</button>' +
              '<button class="au-act btn-wa-ghost" data-veh-action="wa" data-veh-plate="' + plate + '" title="WhatsApp">WA</button>' +
              '<button class="au-act au-act-delete" data-veh-action="delete" data-veh-plate="' + plate + '">Delete</button>' +
            '</div>' +
          '</td>' +
        '</tr>';
      }).join('');

    } catch (e) {
      console.error('[VehicleUI] renderVehicles error:', e);
    }
  }

  function openVehicleModal(editPlate) {
    try {
      if (!_initialized || !_state) {
        if (typeof window.showToast === 'function') window.showToast('Vehicle module initializing… please try again in a moment.', 'info', 2500);
        else console.warn('[VehicleUI] openVehicleModal called before init()');
        return;
      }
      const ev = editPlate ? _state.findVehicle(editPlate) : null;

      var _stale = document.getElementById('vehicleModal');
      if (_stale) _stale.remove();

      const overlay = document.createElement('div');
      overlay.id = 'vehicleModal';
      overlay.className = 'modal-overlay open';
      overlay.style.cssText = 'display:flex;position:fixed;inset:0;z-index:var(--zi-modal-bg,1000);background:rgba(0,0,0,.45);align-items:flex-start;justify-content:center;overflow-y:auto;padding:16px 0';

      overlay.innerHTML =
        '<style>' +
          '#vehicleModal .vm-fi{width:100%;border:0.5px solid #d1d5db;border-radius:6px;padding:7px 10px;font-size:12px;background:#fff;color:#111;outline:none;box-sizing:border-box;font-family:inherit}' +
          '#vehicleModal .vm-fi:focus{border-color:#0f766e;box-shadow:0 0 0 2px rgba(15,118,110,.12)}' +
          '#vehicleModal .vm-lbl{font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.45px;display:block;margin-bottom:3px}' +
          '#vehicleModal .vm-sec{font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.55px;padding:7px 16px;background:var(--bg);border-top:0.5px solid #e5e7eb;border-bottom:0.5px solid #e5e7eb;display:flex;align-items:center;gap:6px}' +
        '</style>' +
        '<div style="background:var(--white,#fff);border-radius:10px;width:98vw;max-width:780px;margin:auto;overflow:hidden;border:0.5px solid #e5e7eb">' +

          '<div style="background:#0f766e;padding:12px 16px;display:flex;align-items:center;justify-content:space-between">' +
            '<div style="display:flex;align-items:center;gap:10px">' +
              '<div style="width:32px;height:32px;border-radius:7px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:17px;height:17px;vertical-align:-3px;color:#fff"><use href="#ic-car"/></svg>' +
              '</div>' +
              '<div>' +
                '<div style="color:#fff;font-size:14px;font-weight:600">' + (ev ? 'Edit vehicle' : 'Add vehicle') + '</div>' +
                '<div style="color:rgba(255,255,255,.7);font-size:11px">' + (ev ? 'Plate: ' + _esc(ev.plate) : 'Fill in vehicle details below') + '</div>' +
              '</div>' +
            '</div>' +
            '<button id="_veh-close-btn" style="width:30px;height:30px;border-radius:7px;border:0.5px solid rgba(255,255,255,.3);background:rgba(255,255,255,.12);color:#fff;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;vertical-align:-2px"><use href="#ic-x"/></svg>' +
            '</button>' +
          '</div>' +

          '<div class="vm-sec"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-car"/></svg> Vehicle identity</div>' +
          '<div style="padding:12px 16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:9px;border-bottom:0.5px solid #e5e7eb">' +
            '<div><label class="vm-lbl">Plate no. <span style="color:#ef4444">*</span></label><input class="vm-fi mono" id="v-plate" placeholder="ABC-123" value="' + _esc(ev ? ev.plate : '') + '"' + (ev ? ' readonly style="background:var(--bg,#f1f5f9);box-sizing:border-box;text-transform:uppercase"' : ' style="text-transform:uppercase"') + '></div>' +
            '<div><label class="vm-lbl">Model <span style="color:#ef4444">*</span></label><input class="vm-fi" id="v-model" placeholder="Toyota Corolla" value="' + _esc(ev ? ev.model : '') + '"></div>' +
            '<div><label class="vm-lbl">Year</label><input class="vm-fi" type="number" id="v-year" placeholder="2020" value="' + _esc(ev ? ev.year || '' : '') + '" min="1970" max="2100"></div>' +
            '<div><label class="vm-lbl">Current KM</label><input class="vm-fi" type="number" id="v-km" placeholder="0" value="' + (ev ? ev.km || 0 : 0) + '" min="0"></div>' +
            '<div><label class="vm-lbl">Chassis no.</label><input class="vm-fi mono" id="v-chassis" placeholder="JT2AE94…" value="' + _esc(ev ? ev.chassis || '' : '') + '"></div>' +
            '<div><label class="vm-lbl">Engine no.</label><input class="vm-fi mono" id="v-engine" placeholder="1AZFE-…" value="' + _esc(ev ? ev.engine || '' : '') + '"></div>' +
          '</div>' +

          '<div class="vm-sec"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-users"/></svg> Owner &amp; service</div>' +
          '<div style="padding:12px 16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:9px;border-bottom:0.5px solid #e5e7eb">' +
            '<div style="grid-column:1/-1"><label class="vm-lbl">Customer / owner</label><input class="vm-fi" id="v-cust" list="veh-cust-datalist" placeholder="Owner name" value="' + _esc(ev ? ev.cust || '' : '') + '"><datalist id="veh-cust-datalist"></datalist></div>' +
            '<div><label class="vm-lbl">Last service date</label><input class="vm-fi" type="date" id="v-last" value="' + _esc(ev ? ev.lastService || '' : '') + '"></div>' +
            '<div><label class="vm-lbl">Next service date</label><input class="vm-fi" type="date" id="v-next" value="' + _esc(ev ? ev.nextService || '' : '') + '"></div>' +
            '<div><label class="vm-lbl">Condition score (1–10)</label><input class="vm-fi" type="number" id="v-score" placeholder="7" value="' + (ev ? ev.conditionScore || 5 : 5) + '" min="1" max="10"></div>' +
            '<div style="grid-column:1/-1"><label class="vm-lbl">Notes</label><textarea class="vm-fi" id="v-notes" rows="2" style="resize:none" placeholder="Any notes about this vehicle...">' + _esc(ev ? ev.notes || '' : '') + '</textarea></div>' +
          '</div>' +

          '<div style="padding:11px 16px;display:flex;justify-content:flex-end;gap:8px">' +
            '<button id="_veh-cancel-btn" style="padding:8px 16px;border-radius:7px;border:0.5px solid #d1d5db;background:var(--white,#fff);color:#374151;font-weight:500;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:5px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-3px"><use href="#ic-x"/></svg> Cancel</button>' +
            '<button id="_veh-save-btn" style="padding:8px 20px;border-radius:7px;border:none;background:#0f766e;color:#fff;font-weight:600;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:5px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-3px"><use href="#ic-dl"/></svg> Save vehicle</button>' +
          '</div>' +

        '</div>';

      document.body.appendChild(overlay);

      overlay.querySelector('#_veh-close-btn').addEventListener('click',  function () { overlay.remove(); });
      overlay.querySelector('#_veh-cancel-btn').addEventListener('click', function () { overlay.remove(); });
      overlay.querySelector('#_veh-save-btn').addEventListener('click', function () {
        _service.saveVehicle(this, editPlate || undefined);
      });
      overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

      setTimeout(function () {
        var firstField = overlay.querySelector(ev ? '#v-model' : '#v-plate');
        if (firstField) firstField.focus();
      }, 60);

    } catch (e) {
      console.error('[VehicleUI] openVehicleModal error:', e);
    }
  }

  function openVehicleKmModal(plate) {
    try {
      const v = _state.findVehicle(plate);
      if (!v) { return; }

      const hist = (v.kmHistory || []).slice(-5).reverse();

      const histHtml = hist.length
        ? '<div style="margin-top:12px">' +
          '<b style="font-size:12px">Recent History</b>' +
          '<div style="margin-top:6px">' +
          hist.map(function (h) {
            return '<div style="font-size:12px;border-bottom:1px solid var(--border-l);padding:4px 0">' +
              '<b>' + (h.km || 0).toLocaleString() + ' km</b> — ' + _esc(h.date) + '</div>';
          }).join('') +
          '</div></div>'
        : '';

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay open';
      overlay.innerHTML =
        '<div class="modal sm">' +
          '<div class="modal-head">' +
            '<h2>📏 KM Update — ' + _esc(plate) + '</h2>' +
            '<button class="modal-close" id="_km-close-btn"><svg><use href="#ic-x"/></svg></button>' +
          '</div>' +
          '<div class="modal-body">' +
            '<div class="fgrp"><label>Current KM Reading</label>' +
              '<input class="fi" type="number" id="km-input" value="' + (v.km || 0) + '" min="1" required></div>' +
            histHtml +
          '</div>' +
          '<div class="modal-foot">' +
            '<button class="btn btn-ghost" id="_km-cancel-btn">Cancel</button>' +
            '<button class="btn btn-primary" id="_km-save-btn">💾 Update KM</button>' +
          '</div>' +
        '</div>';

      document.body.appendChild(overlay);

      overlay.querySelector('#_km-close-btn').addEventListener('click',  function () { overlay.remove(); });
      overlay.querySelector('#_km-cancel-btn').addEventListener('click', function () { overlay.remove(); });
      overlay.querySelector('#_km-save-btn').addEventListener('click', function () {
        _service.saveVehicleKm(plate, this);
      });

    } catch (e) {
      console.error('[VehicleUI] openVehicleKmModal error:', e);
    }
  }

  function viewVehicleHistory(plate) {
    try {
      const html = _service.buildHistoryHtml(plate);
      if (!html) { return; }

      const p = _esc(plate);

      const previewEl = _el('inv-full-preview');
      if (previewEl) {
        previewEl.innerHTML = html;
        const titleEl = _el('inv-modal-title');
        if (titleEl) titleEl.textContent = '📋 Vehicle History: ' + plate;

        const modalHead = document.querySelector('#invPrintModal .modal-head');
        if (modalHead) {
          let waDiv = modalHead.querySelector('.wa-hist-btn');
          if (!waDiv) {
            waDiv = document.createElement('div');
            waDiv.className = 'wa-hist-btn';
            waDiv.style.cssText = 'margin-left:auto;margin-right:6px';
            const closeBtn = modalHead.querySelector('.modal-close, button:last-child');
            if (closeBtn) modalHead.insertBefore(waDiv, closeBtn);
            else modalHead.appendChild(waDiv);
          }
          waDiv.innerHTML =
            '<button class="btn btn-sm btn-wa" style="' +
            'padding:6px 14px;border-radius:8px;cursor:pointer;font-weight:600;font-size:12px" ' +
            'data-veh-action="wa" data-veh-plate="' + p + '" title="Send on WhatsApp">&#128232; WhatsApp</button>';
        }

        if (typeof openModal === 'function') openModal('invPrintModal');
        return;
      }

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay open';
      overlay.innerHTML =
        '<div class="modal" style="max-width:780px;max-height:92vh;overflow-y:auto">' +
          '<div class="modal-head" style="display:flex;align-items:center;gap:8px">' +
            '<span style="font-weight:700">📋 Vehicle History</span>' +
            '<span style="flex:1"></span>' +
            '<button class="btn btn-sm btn-wa" style="' +
            'padding:6px 14px;border-radius:8px;cursor:pointer;font-weight:600;font-size:12px" ' +
            'data-veh-action="wa" data-veh-plate="' + p + '">&#128232; WhatsApp</button>' +
            '<button class="modal-close" id="_hist-close-btn" style="margin-left:4px">✕</button>' +
          '</div>' +
          html +
        '</div>';

      document.body.appendChild(overlay);
      overlay.querySelector('#_hist-close-btn').addEventListener('click', function () { overlay.remove(); });

    } catch (e) {
      console.error('[VehicleUI] viewVehicleHistory error:', e);
    }
  }

  function searchVehicles(query) {
    _state.setSearchQuery(query);
    renderVehicles();
  }

  return {
    init,
    destroy,

    renderVehicles,

    openVehicleModal,
    openVehicleKmModal,
    viewVehicleHistory,

    searchVehicles,
  };

})();

if (typeof window !== "undefined") window.VehicleUI = VehicleUI;
