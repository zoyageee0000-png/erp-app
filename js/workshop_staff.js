
var WorkshopStaff = (function () {
  'use strict';


  var CATEGORIES = [
    { id: 'mechanic',     label: 'Mechanic',     icon: '🔧', color: '#4338CA', bg: '#eff6ff' },
    { id: 'electrician',  label: 'Electrician',  icon: '⚡', color: '#d97706', bg: '#fffbeb' },
    { id: 'body-painter', label: 'Body/Painter',  icon: '🎨', color: '#7c3aed', bg: '#f5f3ff' },
    { id: 'ac-tech',      label: 'A/C Technician',icon: '❄️', color: '#0891b2', bg: '#ecfeff' },
    { id: 'welder',       label: 'Welder',        icon: '🔥', color: '#dc2626', bg: '#fef2f2' },
    { id: 'tyre',         label: 'Tyre/Wheel',    icon: '🛞', color: '#16a34a', bg: '#f0fdf4' },
    { id: 'helper',       label: 'Helper',        icon: '🙋', color: '#6b7280', bg: '#f9fafb' },
    { id: 'other',        label: 'Other Labour',  icon: '👷', color: '#92400e', bg: '#fef3c7' },
  ];

  
  var STATUSES = [
    { id: 'active',    label: 'Active',    color: '#16a34a', bg: '#f0fdf4' },
    { id: 'on-leave',  label: 'On Leave',  color: '#d97706', bg: '#fffbeb' },
    { id: 'inactive',  label: 'Inactive',  color: '#6b7280', bg: '#f9fafb' },
    { id: 'fired',     label: 'Fired',     color: '#dc2626', bg: '#fef2f2' },
  ];


  function _getAll() {
    var raw = window.mechanics;
    if (!Array.isArray(raw) || raw.length === 0) {
      try {
        var lsRaw = localStorage.getItem('mh_mechanics');
        if (lsRaw) {
          var parsed = JSON.parse(lsRaw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            window.mechanics = parsed;
            raw = parsed;
          }
        }
      } catch (_) {}
    }
    if (!Array.isArray(raw)) raw = [];
    return raw;
  }

  function _saveAll(arr) {
    window.mechanics = arr;
    try {
      // ARCHITECTURAL REFACTOR: single choke point for all IndexedDB writes.
      ERP.Persistence.schedule();
    } catch (e) {
      console.warn('[WorkshopStaff] storage error:', e);
    }
    try {
      if (window.updateMechanicDropdowns) window.updateMechanicDropdowns(arr);
    } catch (_) {}
    try {
      if (ERP && ERP.events && ERP.events.emit) {
        ERP.events.emit(ERP.events.NAMES.MECHANICS_CHANGED, { mechanics: arr });
      }
    } catch (_) {}
  }

  // FIX (root cause, audit #61-62): core.js (ERP.uid) loads first of 92
  // scripts, before this file -- a missing-ERP.uid fallback bought nothing
  // but a second, weaker ID scheme. Always use the canonical generator.
  function _genId() {
    return 'STF-' + ERP.uid();
  }

  function _getCat(id) {
    return CATEGORIES.find(function (c) { return c.id === id; }) || CATEGORIES[CATEGORIES.length - 1];
  }

  function _getStatus(id) {
    return STATUSES.find(function (s) { return s.id === id; }) || STATUSES[0];
  }

  function _fmt(n) {
    // FIX (root cause, audit #75): was a hardcoded 'Rs.' duplicate of ERP.fmt();
    // fallback kept only for a genuine load-order fluke.
    if (window.ERP && typeof window.ERP.fmt === 'function') return window.ERP.fmt(n);
    return 'Rs.' + (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function _esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
    });
  }


  function addStaff(data) {
    var arr = _getAll();
    var record = {
      id:             _genId(),
      name:           (data.name || '').trim(),
      category:       data.category || 'mechanic',
      phone:          (data.phone || '').trim(),
      cnic:           (data.cnic || '').trim(),
      address:        (data.address || '').trim(),
      dailyRate:      parseFloat(data.dailyRate) || 0,
      monthlyRate:    parseFloat(data.monthlyRate) || 0,
      perJobRate:     parseFloat(data.perJobRate) || 0,
      commissionRate: parseFloat(data.commissionRate) || 0,
      speciality:     (data.speciality || '').trim(),
      status:         data.status || 'active',
      joinDate:       data.joinDate || (function(){ var _d=new Date(); return _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0'); })(),
      notes:          (data.notes || '').trim(),
      createdAt:      new Date().toISOString(),
    };
    arr.unshift(record);
    _saveAll(arr);
    return record;
  }

  function updateStaff(id, data) {
    var arr = _getAll();
    var idx = arr.findIndex(function (s) { return s.id === id; });
    if (idx < 0) return null;
    var existing = arr[idx];
    arr[idx] = Object.assign({}, existing, {
      name:       (data.name || existing.name || '').trim(),
      category:   data.category   || existing.category,
      phone:      (data.phone     !== undefined ? data.phone     : existing.phone   || '').trim(),
      cnic:       (data.cnic      !== undefined ? data.cnic      : existing.cnic    || '').trim(),
      address:    (data.address   !== undefined ? data.address   : existing.address || '').trim(),
      dailyRate:  parseFloat(data.dailyRate   !== undefined ? data.dailyRate   : existing.dailyRate)   || 0,
      monthlyRate:parseFloat(data.monthlyRate !== undefined ? data.monthlyRate : existing.monthlyRate) || 0,
      perJobRate:     parseFloat(data.perJobRate  !== undefined ? data.perJobRate  : existing.perJobRate)  || 0,
      commissionRate: parseFloat(data.commissionRate !== undefined ? data.commissionRate : existing.commissionRate) || 0,
      speciality: (data.speciality !== undefined ? data.speciality : existing.speciality || '').trim(),
      status:     data.status   || existing.status,
      joinDate:   data.joinDate || existing.joinDate,
      notes:      (data.notes   !== undefined ? data.notes   : existing.notes || '').trim(),
      updatedAt:  new Date().toISOString(),
    });
    _saveAll(arr);
    return arr[idx];
  }

  function _doDeleteStaff(id) {
    var arr = _getAll().filter(function (s) { return s.id !== id; });
    _saveAll(arr);
    return true;
  }

  function deleteStaff(id) {
    var _delConfirm = (window.ERP && window.ERP.confirmDialog) || function(msg, ok) { if (window.confirm(msg)) ok(); };
    _delConfirm('Is staff member ko delete karna chahte hain?', function() { _doDeleteStaff(id); });
    return false;
  }

  function findStaff(id) {
    return _getAll().find(function (s) { return s.id === id; }) || null;
  }


  function _getJobsFor(staffName, prebuiltMap, staffId) {
    if (prebuiltMap) {
      if (staffId && prebuiltMap._byId && prebuiltMap._byId[staffId]) {
        return prebuiltMap._byId[staffId];
      }
      return prebuiltMap[(staffName || '').toLowerCase()] || [];
    }
    var jobs = [];
    try {
      if (window.JobState && typeof window.JobState.getAll === 'function') jobs = window.JobState.getAll();
      if (!jobs.length && window.ERP && window.ERP._internal) {
        var _st = window.ERP._internal.getState();
        if (_st && _st.data && Array.isArray(_st.data.jobs)) jobs = _st.data.jobs;
      }
    } catch (_) {}
    if (!jobs.length) jobs = Array.isArray(window.jobs) ? window.jobs : [];
    return jobs.filter(function (j) {
      if (staffId && j.mecId) return j.mecId === staffId;
      return (j.mec || '').toLowerCase() === (staffName || '').toLowerCase();
    });
  }

  function _calcEarnings(staff, prebuiltMap) {
    var jobs = _getJobsFor(staff.name, prebuiltMap, staff.id);
    var completed = jobs.filter(function (j) { return j.status === 'completed' || j.status === 'delivered'; });

    var totalLabour = 0;
    var commissionBreakdown = [];

    completed.forEach(function (j) {
      var jobLabour = 0;
      if (Array.isArray(j.labourLines) && j.labourLines.length) {
        j.labourLines.forEach(function (ll) {
          if ((ll.mec || '').toLowerCase() === (staff.name || '').toLowerCase()) {
            var amt = Number(ll.amt) || 0;
            jobLabour += amt;
          }
        });
        if (jobLabour === 0 && (j.mec || '').toLowerCase() === (staff.name || '').toLowerCase()) {
          var otherMecInLines = j.labourLines.some(function (ll) {
            return (ll.mec || '').trim() !== '' &&
                   (ll.mec || '').toLowerCase() !== (staff.name || '').toLowerCase();
          });
          if (!otherMecInLines) {
            jobLabour = Number(j.lab) || 0;
          }
        }
      } else {
        if ((j.mec || '').toLowerCase() === (staff.name || '').toLowerCase()) {
          jobLabour = Number(j.lab) || 0;
        }
      }

      var commRate = Number(staff.commissionRate) || 0;
      var commEarned = commRate > 0 ? Math.round(jobLabour * commRate / 100) : 0;

      totalLabour += jobLabour;
      if (jobLabour > 0) {
        commissionBreakdown.push({
          jobId:      j.id,
          car:        j.car,
          date:       j.date,
          labourAmt:  jobLabour,
          commRate:   commRate,
          commEarned: commEarned,
          status:     j.status,
        });
      }
    });

    var totalParts = completed.reduce(function (s, j) {
      return s + (Array.isArray(j.parts) ? j.parts.reduce(function (ps, p) { return ps + (Number(p.q)||1)*(Number(p.p)||0); }, 0) : 0);
    }, 0);

    var commRate        = Number(staff.commissionRate) || 0;
    var totalCommission = commissionBreakdown.reduce(function (s, b) { return s + b.commEarned; }, 0);
    var perJobEst       = staff.perJobRate ? (Number(staff.perJobRate) * completed.length) : 0;

    return {
      totalJobs:           jobs.length,
      completedJobs:       completed.length,
      pendingJobs:         jobs.filter(function (j) { return j.status === 'pending' || j.status === 'in-progress'; }).length,
      totalLabour:         totalLabour,
      totalRevenue:        totalLabour + totalParts,
      perJobEst:           perJobEst,
      commissionRate:      commRate,
      totalCommission:     totalCommission,
      commissionBreakdown: commissionBreakdown,
    };
  }


  function openModal(editId) {
    var existing = editId ? findStaff(editId) : null;
    var ea = existing;

    var catOptions = CATEGORIES.map(function (c) {
      var sel = (ea && ea.category === c.id) ? ' selected' : (!ea && c.id === 'mechanic' ? ' selected' : '');
      return '<option value="' + c.id + '"' + sel + '>' + c.label + '</option>';
    }).join('');

    var statusOptions = STATUSES.map(function (s) {
      var sel = (ea && ea.status === s.id) ? ' selected' : (!ea && s.id === 'active' ? ' selected' : '');
      return '<option value="' + s.id + '"' + sel + '>' + s.label + '</option>';
    }).join('');

    var _stale = document.getElementById('staffModal');
    if (_stale) _stale.remove();

    var overlay = document.createElement('div');
    overlay.id = 'staffModal';
    overlay.style.cssText = 'display:flex;position:fixed;inset:0;z-index:var(--zi-modal-bg,1000);background:rgba(0,0,0,.45);align-items:flex-start;justify-content:center;overflow-y:auto;padding:16px 0';

    overlay.innerHTML =
      '<style>' +
        '#staffModal .sm-fi{width:100%;border:1px solid var(--border,#d1d5db);border-radius:var(--r-lg,10px);padding:7px 10px;font-size:12px;background:var(--white,#fff);color:var(--text,#111);outline:none;box-sizing:border-box;font-family:var(--font,inherit)}' +
        '#staffModal .sm-fi:focus{border-color:var(--primary,#4338CA);box-shadow:0 0 0 3px rgba(27,79,140,0.15)}' +
        '#staffModal .sm-lbl{font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.45px;display:block;margin-bottom:3px}' +
        '#staffModal .sm-sec{font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.55px;padding:7px 16px;background:var(--bg);border-top:0.5px solid #e5e7eb;border-bottom:0.5px solid #e5e7eb;display:flex;align-items:center;gap:6px}' +
      '</style>' +
      '<div style="background:var(--white,#fff);border-radius:10px;width:98vw;max-width:780px;margin:auto;overflow:hidden;border:0.5px solid #e5e7eb">' +

        '<div style="background:#059669;padding:12px 16px;display:flex;align-items:center;justify-content:space-between">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<div style="width:32px;height:32px;border-radius:7px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:17px;height:17px;vertical-align:-3px;color:#fff"><use href="#ic-cog"/></svg>' +
            '</div>' +
            '<div>' +
              '<div style="color:#fff;font-size:14px;font-weight:600">' + (ea ? 'Edit staff member' : 'Add workshop staff') + '</div>' +
              '<div style="color:rgba(255,255,255,.7);font-size:11px">Mechanic · Electrician · Labour · Technician</div>' +
            '</div>' +
          '</div>' +
          '<button id="_staff-close" style="width:30px;height:30px;border-radius:7px;border:0.5px solid rgba(255,255,255,.3);background:rgba(255,255,255,.12);color:#fff;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;vertical-align:-2px"><use href="#ic-x"/></svg>' +
          '</button>' +
        '</div>' +

        '<div class="sm-sec"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-users"/></svg> Basic information</div>' +
        '<div style="padding:12px 16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:9px;border-bottom:0.5px solid #e5e7eb">' +
          '<div style="grid-column:1/3"><label class="sm-lbl">Full name <span style="color:#ef4444">*</span></label><input class="sm-fi" id="staff-name" value="' + _esc(ea ? ea.name : '') + '" placeholder="e.g. Usman Ahmed"></div>' +
          '<div><label class="sm-lbl">Category</label><select class="sm-fi" id="staff-cat">' + catOptions + '</select></div>' +
          '<div><label class="sm-lbl">Status</label><select class="sm-fi" id="staff-status">' + statusOptions + '</select></div>' +
          '<div><label class="sm-lbl">Phone</label><input class="sm-fi" id="staff-phone" type="tel" value="' + _esc(ea ? ea.phone || '' : '') + '" placeholder="03XX-XXXXXXX"></div>' +
          '<div><label class="sm-lbl">CNIC</label><input class="sm-fi" id="staff-cnic" value="' + _esc(ea ? ea.cnic || '' : '') + '" placeholder="12345-1234567-1"></div>' +
          '<div><label class="sm-lbl">Join date</label><input class="sm-fi" id="staff-join" type="date" value="' + _esc(ea ? ea.joinDate || '' : (function(){ var _d=new Date(); return _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0'); })()) + '"></div>' +
          '<div style="grid-column:1/-1"><label class="sm-lbl">Speciality / skills</label><input class="sm-fi" id="staff-spec" value="' + _esc(ea ? ea.speciality || '' : '') + '" placeholder="e.g. Engine repair, AC, Brake specialist"></div>' +
        '</div>' +

        '<div class="sm-sec"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-money"/></svg> Rate / salary</div>' +
        '<div style="padding:12px 16px;display:grid;grid-template-columns:repeat(4,1fr);gap:9px;border-bottom:0.5px solid #e5e7eb">' +
          '<div><label class="sm-lbl">Daily rate (Rs.)</label><input class="sm-fi" id="staff-daily" type="number" min="0" value="' + (ea ? ea.dailyRate || '' : '') + '" placeholder="0"></div>' +
          '<div><label class="sm-lbl">Monthly rate (Rs.)</label><input class="sm-fi" id="staff-monthly" type="number" min="0" value="' + (ea ? ea.monthlyRate || '' : '') + '" placeholder="0"></div>' +
          '<div><label class="sm-lbl">Per job rate (Rs.)</label><input class="sm-fi" id="staff-perjob" type="number" min="0" value="' + (ea ? ea.perJobRate || '' : '') + '" placeholder="0"></div>' +
          '<div><label class="sm-lbl">Commission % (labour)</label><input class="sm-fi" id="staff-commission" type="number" min="0" max="100" value="' + (ea ? ea.commissionRate || '' : '') + '" placeholder="e.g. 40"></div>' +
        '</div>' +

        '<div style="padding:12px 16px;display:grid;grid-template-columns:1fr 1fr;gap:9px;border-bottom:0.5px solid #e5e7eb">' +
          '<div><label class="sm-lbl">Address</label><input class="sm-fi" id="staff-addr" value="' + _esc(ea ? ea.address || '' : '') + '" placeholder="Ghar ka pata"></div>' +
          '<div><label class="sm-lbl">Notes</label><textarea class="sm-fi" id="staff-notes" rows="2" style="resize:none">' + _esc(ea ? ea.notes || '' : '') + '</textarea></div>' +
        '</div>' +

        '<div style="padding:11px 16px;display:flex;justify-content:flex-end;gap:8px">' +
          '<button id="_staff-cancel" style="padding:8px 16px;border-radius:7px;border:0.5px solid #d1d5db;background:var(--white,#fff);color:#374151;font-weight:500;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:5px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-3px"><use href="#ic-x"/></svg> Cancel</button>' +
          '<button id="_staff-save" style="padding:8px 20px;border-radius:7px;border:none;background:#059669;color:#fff;font-weight:600;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:5px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-3px"><use href="#ic-dl"/></svg> Save staff</button>' +
        '</div>' +

      '</div>';

    document.body.appendChild(overlay);

    overlay.querySelector('#_staff-close').onclick  = function () { overlay.remove(); };
    overlay.querySelector('#_staff-cancel').onclick = function () { overlay.remove(); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#_staff-save').onclick = function () {
      var name = (document.getElementById('staff-name').value || '').trim();
      if (!name) { alert('Staff name is required!'); return; }
      var data = {
        name:           name,
        category:       document.getElementById('staff-cat').value,
        phone:          document.getElementById('staff-phone').value,
        cnic:           document.getElementById('staff-cnic').value,
        address:        document.getElementById('staff-addr').value,
        speciality:     document.getElementById('staff-spec').value,
        status:         document.getElementById('staff-status').value,
        joinDate:       document.getElementById('staff-join').value,
        dailyRate:      document.getElementById('staff-daily').value,
        monthlyRate:    document.getElementById('staff-monthly').value,
        perJobRate:     document.getElementById('staff-perjob').value,
        commissionRate: parseFloat(document.getElementById('staff-commission').value) || 0,
        notes:          document.getElementById('staff-notes').value,
      };
      if (ea) { updateStaff(ea.id, data); } else { addStaff(data); }
      overlay.remove();
      render();
      _showToast((ea ? 'Staff update' : 'Staff add') + ' ho gaya ✅', 'success');
    };

    setTimeout(function () { var el = document.getElementById('staff-name'); if (el) el.focus(); }, 80);
  }

  function _field(label, id, type, value, placeholder) {
    return '<div><label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:5px">' + label + '</label>' +
      '<input id="' + id + '" type="' + type + '" class="fi" value="' + _esc(value) + '" placeholder="' + _esc(placeholder) + '" style="width:100%;box-sizing:border-box" ' + (type === 'number' ? 'min="0"' : '') + '></div>';
  }

  function _showToast(msg, type) {
    if (window.showToast) { window.showToast(msg, type || 'success', 3000); return; }
    var t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:10px;background:' + (type === 'error' ? '#dc2626' : '#16a34a') + ';color:#fff;font-weight:600;z-index:var(--zi-toast,1020);font-size:14px';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3000);
  }


  function openReport(staffId) {
    var staff = findStaff(staffId);
    if (!staff) return;
    var cat   = _getCat(staff.category);
    var stat  = _getStatus(staff.status);
    var stats = _calcEarnings(staff);
    var jobs  = _getJobsFor(staff.name, null, staff.id);

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.id = 'staffReportModal';

    var jobRows = jobs.length
      ? jobs.map(function (j) {
          var myLabour = 0;
          if (Array.isArray(j.labourLines) && j.labourLines.length) {
            j.labourLines.forEach(function (ll) {
              if ((ll.mec || '').toLowerCase() === (staff.name || '').toLowerCase()) {
                myLabour += Number(ll.amt) || 0;
              }
            });
            if (myLabour === 0 && (j.mec || '').toLowerCase() === (staff.name || '').toLowerCase()) {
              var otherMecInLines = j.labourLines.some(function (ll) {
                return (ll.mec || '').trim() !== '' &&
                       (ll.mec || '').toLowerCase() !== (staff.name || '').toLowerCase();
              });
              if (!otherMecInLines) myLabour = Number(j.lab) || 0;
            }
          } else {
            if ((j.mec || '').toLowerCase() === (staff.name || '').toLowerCase()) {
              myLabour = Number(j.lab) || 0;
            }
          }
          var parts   = Array.isArray(j.parts) ? j.parts.reduce(function (s, p) { return s + (Number(p.q)||1)*(Number(p.p)||0); }, 0) : 0;
          var commRate = Number(staff.commissionRate) || 0;
          var commEarned = commRate > 0 ? Math.round(myLabour * commRate / 100) : null;
          var isPaid  = j.status === 'completed' || j.status === 'delivered';
          var statusC = { pending:'#d97706', 'in-progress':'#4338CA', completed:'#16a34a', delivered:'#059669', cancelled:'#dc2626' }[j.status] || '#6b7280';
          return '<tr style="border-bottom:1px solid #f1f5f9">' +
            '<td style="padding:9px 12px;font-weight:600;color:#4338CA;font-size:12px">' + _esc(j.id || '—') + '</td>' +
            '<td style="padding:9px 12px;font-size:13px">' + _esc(j.car || '—') + '</td>' +
            '<td style="padding:9px 12px;font-family:monospace;font-size:12px">' + _esc(j.plate || '—') + '</td>' +
            '<td style="padding:9px 12px;font-size:12px;color:var(--muted,#64748b)">' + _esc(j.date || '—') + '</td>' +
            '<td style="padding:9px 12px"><span style="background:' + statusC + '22;color:' + statusC + ';padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600">' + _esc(j.status || '—') + '</span></td>' +
            '<td style="padding:9px 12px;text-align:right;color:#059669;font-weight:600">' + _fmt(myLabour) + '</td>' +
            (commEarned !== null
              ? '<td style="padding:9px 12px;text-align:right;font-weight:700;color:' + (isPaid ? '#7c3aed' : '#94a3b8') + '">' + (isPaid ? _fmt(commEarned) : '<span title="Pending payment">~' + _fmt(commEarned) + '</span>') + '</td>'
              : '<td style="padding:9px 12px;text-align:right;color:#94a3b8;font-size:12px">—</td>'
            ) +
          '</tr>';
        }).join('')
      : '<tr><td colspan="7" style="padding:32px;text-align:center;color:#9ca3af">No jobs assigned</td></tr>';

    var commRate = Number(staff.commissionRate) || 0;
    var commBlock = commRate > 0
      ? '<div style="background:linear-gradient(135deg,#f5f3ff,#ede9fe);border:1px solid var(--border)6fe;border-radius:12px;padding:16px;margin-bottom:20px">' +
          '<div style="font-weight:700;font-size:14px;color:#7c3aed;margin-bottom:12px">💜 Commission Summary (' + commRate + '% of Labour)</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">' +
            '<div style="background:var(--white,#fff);border-radius:8px;padding:12px;text-align:center">' +
              '<div style="font-size:10px;color:var(--muted,#64748b);text-transform:uppercase;margin-bottom:4px">Total Labour</div>' +
              '<div style="font-size:18px;font-weight:800;color:#059669">' + _fmt(stats.totalLabour) + '</div>' +
            '</div>' +
            '<div style="background:var(--white,#fff);border-radius:8px;padding:12px;text-align:center">' +
              '<div style="font-size:10px;color:var(--muted,#64748b);text-transform:uppercase;margin-bottom:4px">Commission Rate</div>' +
              '<div style="font-size:18px;font-weight:800;color:#7c3aed">' + commRate + '%</div>' +
            '</div>' +
            '<div style="background:#7c3aed;border-radius:8px;padding:12px;text-align:center">' +
              '<div style="font-size:10px;color:rgba(255,255,255,.75);text-transform:uppercase;margin-bottom:4px">Commission Earned</div>' +
              '<div style="font-size:18px;font-weight:800;color:#fff">' + _fmt(stats.totalCommission) + '</div>' +
            '</div>' +
          '</div>' +
        '</div>'
      : (staff.perJobRate
          ? '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:14px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center">' +
              '<div>' +
                '<div style="font-weight:700;font-size:13px;color:#16a34a">💵 Per-Job Rate Estimate</div>' +
                '<div style="font-size:12px;color:#064e3b;margin-top:2px">' + stats.completedJobs + ' jobs × ' + _fmt(staff.perJobRate) + '</div>' +
              '</div>' +
              '<div style="font-size:20px;font-weight:800;color:#16a34a">' + _fmt(stats.perJobEst) + '</div>' +
            '</div>'
          : ''
        );

    overlay.innerHTML = [
      '<div class="modal" style="max-width:820px;max-height:94vh;border-radius:16px;overflow:hidden;display:flex;flex-direction:column">',

        '<div style="background:linear-gradient(135deg,' + cat.color + ',' + cat.color + 'bb);color:#fff;padding:20px 24px;flex-shrink:0">',
          '<div style="display:flex;align-items:center;justify-content:space-between">',
            '<div style="display:flex;align-items:center;gap:14px">',
              '<div style="width:56px;height:56px;background:rgba(255,255,255,.25);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:28px">' + cat.icon + '</div>',
              '<div>',
                '<h2 style="margin:0;font-size:20px;font-weight:800;color:#fff">' + _esc(staff.name) + '</h2>',
                '<p style="margin:3px 0 0;opacity:.85;font-size:13px">' + cat.label + (staff.speciality ? ' · ' + _esc(staff.speciality) : '') + '</p>',
                '<span style="display:inline-block;margin-top:5px;background:rgba(255,255,255,.25);padding:3px 12px;border-radius:20px;font-size:12px;font-weight:600">' + stat.label + '</span>',
              '</div>',
            '</div>',
            '<button id="_rpt-close" style="width:34px;height:34px;border-radius:8px;border:none;background:rgba(255,255,255,.2);color:#fff;font-size:18px;cursor:pointer">✕</button>',
          '</div>',
        '</div>',

        '<div style="overflow-y:auto;flex:1;padding:20px 24px">',

          '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:20px">',
            _rCard('Total Jobs',    stats.totalJobs,                    '#4338CA', '#eff6ff',  '📋'),
            _rCard('Completed',     stats.completedJobs,                '#16a34a', '#f0fdf4',  '✅'),
            _rCard('Pending',       stats.pendingJobs,                  '#d97706', '#fffbeb',  '🕐'),
            _rCard('Labour Earned', _fmt(stats.totalLabour),            '#059669', '#ecfdf5',  '💰'),
            _rCard('Commission',    _fmt(stats.totalCommission || 0),   '#7c3aed', '#f5f3ff',  '💜'),
          '</div>',

          commBlock,

          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">',
            '<div style="background:var(--bg,#f8fafc);border-radius:12px;padding:16px">',
              '<div style="font-weight:700;font-size:13px;color:#374151;margin-bottom:12px">📞 Contact</div>',
              _infoRow('Phone',     staff.phone    || '—'),
              _infoRow('CNIC',      staff.cnic     || '—'),
              _infoRow('Address',   staff.address  || '—'),
              _infoRow('Join Date', staff.joinDate || '—'),
            '</div>',
            '<div style="background:var(--bg,#f8fafc);border-radius:12px;padding:16px">',
              '<div style="font-weight:700;font-size:13px;color:#374151;margin-bottom:12px">💵 Pay Structure</div>',
              _infoRow('Daily Rate',      _fmt(staff.dailyRate   || 0)),
              _infoRow('Monthly Rate',    _fmt(staff.monthlyRate || 0)),
              _infoRow('Per Job Rate',    _fmt(staff.perJobRate  || 0)),
              _infoRow('Commission %',    (commRate > 0 ? commRate + '% of labour' : 'Not set')),
              _infoRow('Total Earned',    _fmt(stats.totalCommission || stats.perJobEst || 0)),
            '</div>',
          '</div>',

          '<div style="font-weight:700;font-size:14px;color:var(--text,#1e293b);margin-bottom:10px">📋 Job History</div>',
          '<div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">',
            '<table style="width:100%;border-collapse:collapse;font-size:13px">',
              '<thead><tr style="background:var(--bg,#f8fafc)">',
                '<th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--muted,#64748b)">JOB#</th>',
                '<th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--muted,#64748b)">VEHICLE</th>',
                '<th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--muted,#64748b)">PLATE</th>',
                '<th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--muted,#64748b)">DATE</th>',
                '<th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--muted,#64748b)">STATUS</th>',
                '<th style="padding:9px 12px;text-align:right;font-size:11px;font-weight:700;color:var(--muted,#64748b)">MY LABOUR</th>',
                '<th style="padding:9px 12px;text-align:right;font-size:11px;font-weight:700;color:#7c3aed">' + (commRate > 0 ? 'COMMISSION' : 'RATE') + '</th>',
              '</tr></thead>',
              '<tbody>' + jobRows + '</tbody>',
            '</table>',
          '</div>',

          (staff.notes ? '<div style="margin-top:16px;padding:14px;background:#fffbeb;border-radius:10px;border-left:4px solid #d97706"><span style="font-weight:600;font-size:13px">📝 Notes:</span> <span style="color:#374151;font-size:13px">' + _esc(staff.notes) + '</span></div>' : ''),

        '</div>',

        '<div style="padding:14px 24px;background:var(--bg,#f8fafc);border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;flex-shrink:0">',
          '<button onclick="WorkshopStaff.printReport(\'' + staffId + '\')" style="padding:10px 18px;border-radius:8px;border:1px solid #d1d5db;background:var(--white,#fff);color:#374151;font-weight:600;cursor:pointer;font-size:13px">🖨️ Print Report</button>',
          '<button id="_rpt-close2" style="padding:10px 20px;border-radius:8px;border:none;background:#1e293b;color:#fff;font-weight:600;cursor:pointer;font-size:14px">Close</button>',
        '</div>',

      '</div>'
    ].join('');

    document.body.appendChild(overlay);
    overlay.querySelector('#_rpt-close').onclick  = function () { overlay.remove(); };
    overlay.querySelector('#_rpt-close2').onclick = function () { overlay.remove(); };
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }

  function _rCard(label, value, color, bg, icon) {
    return '<div style="background:' + bg + ';border-radius:12px;padding:16px;text-align:center">' +
      '<div style="font-size:24px;margin-bottom:6px">' + icon + '</div>' +
      '<div style="font-size:20px;font-weight:800;color:' + color + '">' + value + '</div>' +
      '<div style="font-size:12px;color:var(--muted,#64748b);font-weight:600;margin-top:2px">' + label + '</div>' +
    '</div>';
  }

  function _infoRow(label, value) {
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #f1f5f9">' +
      '<span style="font-size:12px;color:var(--muted,#64748b)">' + label + '</span>' +
      '<span style="font-size:13px;font-weight:600;color:var(--text,#1e293b)">' + _esc(String(value)) + '</span>' +
    '</div>';
  }


  function printReport(staffId) {
    var staff = findStaff(staffId);
    if (!staff) return;
    var cat   = _getCat(staff.category);
    var stats = _calcEarnings(staff);
    var jobs  = _getJobsFor(staff.name, null, staff.id);

    var rows = jobs.map(function (j) {
      var labour = 0;
      if (Array.isArray(j.labourLines) && j.labourLines.length) {
        j.labourLines.forEach(function (ll) {
          if ((ll.mec || '').toLowerCase() === (staff.name || '').toLowerCase()) {
            labour += Number(ll.amt) || 0;
          }
        });
        if (labour === 0 && (j.mec || '').toLowerCase() === (staff.name || '').toLowerCase()) {
          var otherMec = j.labourLines.some(function (ll) {
            return (ll.mec || '').trim() !== '' &&
                   (ll.mec || '').toLowerCase() !== (staff.name || '').toLowerCase();
          });
          if (!otherMec) labour = Number(j.lab) || 0;
        }
      } else {
        if ((j.mec || '').toLowerCase() === (staff.name || '').toLowerCase()) {
          labour = Number(j.lab) || 0;
        }
      }
      var parts  = Array.isArray(j.parts) ? j.parts.reduce(function (s, p) { return s + (Number(p.q)||1)*(Number(p.p)||0); }, 0) : 0;
      return '<tr><td>' + _esc(j.id||'—') + '</td><td>' + _esc(j.car||'—') + '</td><td>' + _esc(j.plate||'—') + '</td>' +
        '<td>' + _esc(j.date||'—') + '</td><td>' + _esc(j.status||'—') + '</td>' +
        '<td style="text-align:right">' + _fmt(labour) + '</td><td style="text-align:right">' + _fmt(labour+parts) + '</td></tr>';
    }).join('');

    var w = window.open('', '_blank');
    w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Staff Report - ' + staff.name + '</title>' +
      '<style>body{font-family:Arial,sans-serif;margin:20px;color:#111}h1{color:' + cat.color + '}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border:1px solid var(--border);padding:8px 10px;text-align:left}th{background:#f5f5f5;font-weight:700}tr:nth-child(even){background:#fafafa}.stats{display:flex;gap:16px;margin:16px 0}.stat-box{flex:1;border:1px solid var(--border);padding:12px;border-radius:6px;text-align:center}.stat-val{font-size:22px;font-weight:800}.stat-lbl{font-size:12px;color:#666}@media print{button{display:none}}</style>' +
      '</head><body>' +
      '<h1>' + cat.icon + ' ' + _esc(staff.name) + '</h1>' +
      '<p>' + cat.label + (staff.speciality ? ' · ' + _esc(staff.speciality) : '') + ' | Phone: ' + _esc(staff.phone||'—') + ' | Join: ' + _esc(staff.joinDate||'—') + '</p>' +
      '<div class="stats">' +
        '<div class="stat-box"><div class="stat-val">' + stats.totalJobs + '</div><div class="stat-lbl">Total Jobs</div></div>' +
        '<div class="stat-box"><div class="stat-val">' + stats.completedJobs + '</div><div class="stat-lbl">Completed</div></div>' +
        '<div class="stat-box"><div class="stat-val">' + _fmt(stats.totalLabour) + '</div><div class="stat-lbl">Labour Earned</div></div>' +
        '<div class="stat-box"><div class="stat-val">' + _fmt(staff.perJobRate * stats.completedJobs) + '</div><div class="stat-lbl">Per-Job Estimate</div></div>' +
      '</div>' +
      '<table><thead><tr><th>Job#</th><th>Vehicle</th><th>Plate</th><th>Date</th><th>Status</th><th>Labour</th><th>Total</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="7" style="text-align:center">No jobs</td></tr>') + '</tbody></table>' +
      '<p style="margin-top:20px;font-size:12px;color:#888">Print Date: ' + new Date().toLocaleString('en-PK') + ' | MH Autos ERP</p>' +
      '<button onclick="window.print()" style="margin-top:12px;padding:10px 20px;background:#333;color:#fff;border:none;border-radius:6px;cursor:pointer">🖨️ Print</button>' +
      '</body></html>');
    w.document.close();
  }


  var _currentFilter = 'all';
  var _searchQ = '';

  function render() {
    var pv = document.getElementById('pv-staff');
    if (!pv) return;

    var allStaff = _getAll();
    var filtered = allStaff.filter(function (s) {
      var matchCat    = _currentFilter === 'all' || s.category === _currentFilter;
      var matchSearch = !_searchQ || (s.name + ' ' + s.speciality + ' ' + s.phone).toLowerCase().includes(_searchQ);
      return matchCat && matchSearch;
    });

    var totalActive   = allStaff.filter(function (s) { return s.status === 'active'; }).length;
    var totalInactive = allStaff.filter(function (s) { return s.status !== 'active'; }).length;
    var catCounts = {};
    CATEGORIES.forEach(function (c) { catCounts[c.id] = 0; });
    allStaff.forEach(function (s) { if (catCounts[s.category] !== undefined) catCounts[s.category]++; });

    var allJobs = [];
    try {
      if (window.ERP && window.ERP._internal) {
        var _wst = window.ERP._internal.getState();
        if (_wst && _wst.data && Array.isArray(_wst.data.jobs)) allJobs = _wst.data.jobs;
      }
      if (!allJobs.length && window.JobState && typeof window.JobState.getAll === 'function') allJobs = window.JobState.getAll();
    } catch (_) {}
    if (!allJobs.length) allJobs = Array.isArray(window.jobs) ? window.jobs : [];
    var totalJobs = allJobs.length;

    var statCards = window.renderStatCards([
      { label:'Total Staff', value: allStaff.length, color:'#4338CA', bg:'#eff6ff', icon:'👷' },
      { label:'Active',      value: totalActive,      color:'#16a34a', bg:'#f0fdf4', icon:'✅' },
      { label:'Leave/Off',   value: totalInactive,    color:'#d97706', bg:'#fffbeb', icon:'⏸️' },
      { label:'Total Jobs',  value: totalJobs,        color:'#7c3aed', bg:'#f5f3ff', icon:'🔧' },
    ], { wrap:false });

    var pills = [{ id:'all', label:'All', icon:'👷' }].concat(CATEGORIES).map(function (c) {
      var count = c.id === 'all' ? allStaff.length : (catCounts[c.id] || 0);
      var active = _currentFilter === c.id;
      return '<button onclick="WorkshopStaff.setFilter(\'' + c.id + '\')" style="padding:7px 14px;border-radius:20px;border:' +
        (active ? '2px solid #4338CA;background:#eff6ff;color:#4338CA' : '1px solid #e5e7eb;background:#fff;color:#374151') +
        ';font-weight:' + (active ? '700' : '500') + ';font-size:13px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:5px">' +
        (c.icon || '') + ' ' + c.label + ' <span style="background:' + (active?'#4338CA':'#e5e7eb') + ';color:' + (active?'#fff':'#6b7280') + ';padding:1px 7px;border-radius:10px;font-size:11px;font-weight:700">' + count + '</span></button>';
    }).join('');

    var _staffJobsMap = {};
    allJobs.forEach(function (j) {
      var mec = (j.mec || '').toLowerCase();
      if (mec) {
        if (!_staffJobsMap[mec]) _staffJobsMap[mec] = [];
        _staffJobsMap[mec].push(j);
      }
      if (j.mecId) {
        if (!_staffJobsMap._byId) _staffJobsMap._byId = {};
        if (!_staffJobsMap._byId[j.mecId]) _staffJobsMap._byId[j.mecId] = [];
        _staffJobsMap._byId[j.mecId].push(j);
      }
    });

    var cards = filtered.length
      ? filtered.map(function (s) {
          var cat   = _getCat(s.category);
          var stat  = _getStatus(s.status);
          var stats = _calcEarnings(s, _staffJobsMap);
          return '<div style="background:var(--white,#fff);border-radius:14px;border:1px solid #e5e7eb;overflow:hidden;transition:box-shadow .2s" onmouseover="this.style.boxShadow=\'0 4px 20px rgba(0,0,0,.1)\'" onmouseout="this.style.boxShadow=\'none\'">' +
            '<div style="background:linear-gradient(135deg,' + cat.color + ',' + cat.color + 'aa);padding:16px;display:flex;align-items:center;gap:12px">' +
              '<div style="width:48px;height:48px;background:rgba(255,255,255,.3);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">' + cat.icon + '</div>' +
              '<div style="flex:1;min-width:0">' +
                '<div style="font-weight:800;font-size:15px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _esc(s.name) + '</div>' +
                '<div style="font-size:12px;color:rgba(255,255,255,.85);margin-top:2px">' + cat.label + '</div>' +
              '</div>' +
              '<span style="background:' + stat.bg + ';color:' + stat.color + ';padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;flex-shrink:0">' + stat.label + '</span>' +
            '</div>' +
            '<div style="padding:14px 16px">' +
              (s.speciality ? '<div style="font-size:12px;color:var(--muted,#64748b);margin-bottom:10px;display:flex;align-items:center;gap:4px">🔩 ' + _esc(s.speciality) + '</div>' : '') +
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">' +
                _miniStat('Jobs', stats.totalJobs, '#4338CA') +
                _miniStat('Done', stats.completedJobs, '#16a34a') +
                _miniStat('Labour', _fmt(stats.totalLabour), '#059669') +
                _miniStat('Rate/Job', _fmt(s.perJobRate), '#7c3aed') +
              '</div>' +
              (s.phone ? '<div style="font-size:12px;color:#374151;margin-bottom:4px">📞 ' + _esc(s.phone) + '</div>' : '') +
            '</div>' +
            '<div style="padding:10px 16px;background:var(--bg,#f8fafc);border-top:1px solid #f1f5f9;display:flex;gap:8px">' +
              '<button onclick="WorkshopStaff.openReport(\'' + s.id + '\')" style="flex:1;padding:8px;border-radius:8px;border:1px solid #e5e7eb;background:var(--white,#fff);color:#374151;font-weight:600;font-size:12px;cursor:pointer">📊 Report</button>' +
              '<button onclick="WorkshopStaff.openModal(\'' + s.id + '\')" style="flex:1;padding:8px;border-radius:8px;border:1px solid #4338CA;background:#eff6ff;color:#4338CA;font-weight:600;font-size:12px;cursor:pointer">✏️ Edit</button>' +
              '<button onclick="WorkshopStaff._safeDelete(\'' + s.id + '\')" style="width:36px;padding:8px;border-radius:8px;border:1px solid #fee2e2;background:var(--white,#fff);color:#dc2626;font-weight:600;font-size:14px;cursor:pointer">🗑</button>' +
            '</div>' +
          '</div>';
        }).join('')
      : '<div style="grid-column:1/-1;padding:60px;text-align:center;color:#9ca3af">' +
          '<div style="font-size:48px;margin-bottom:12px">👷</div>' +
          '<div style="font-size:16px;font-weight:600;margin-bottom:6px">Koi Staff Nahi Mila</div>' +
          '<div style="font-size:13px">Upar "Add Staff" button dabayein</div>' +
        '</div>';

    pv.innerHTML = [
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px">' + statCards + '</div>',

      '<div style="background:var(--white,#fff);border-radius:12px;border:1px solid #e5e7eb;padding:16px;margin-bottom:20px">',
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">',
          '<div style="display:flex;align-items:center;gap:8px;background:var(--bg,#f8fafc);border:1px solid #e5e7eb;border-radius:8px;padding:6px 12px;flex:1;max-width:320px">',
            '<span style="color:#9ca3af">🔍</span>',
            '<input id="staff-search" placeholder="Naam ya speciality search karein…" value="' + _esc(_searchQ) + '" oninput="WorkshopStaff.search(this.value)" style="border:none;background:transparent;outline:none;font-size:14px;width:100%">',
          '</div>',
          '<button onclick="WorkshopStaff.openModal()" style="padding:10px 20px;border-radius:8px;border:none;background:linear-gradient(135deg,#059669,#047857);color:#fff;font-weight:700;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;box-shadow:0 2px 8px rgba(5,150,105,.3)">➕ Add Staff</button>',
        '</div>',
        '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">' + pills + '</div>',
      '</div>',

      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">' + cards + '</div>',

    ].join('');
  }

  function _miniStat(label, value, color) {
    return '<div style="background:var(--bg,#f8fafc);border-radius:8px;padding:8px 10px">' +
      '<div style="font-size:14px;font-weight:800;color:' + color + '">' + value + '</div>' +
      '<div style="font-size:11px;color:#9ca3af;margin-top:1px">' + label + '</div>' +
    '</div>';
  }

  function setFilter(cat) {
    _currentFilter = cat;
    render();
  }

  function search(q) {
    _searchQ = (q || '').toLowerCase().trim();
    render();
  }

  var _ATTEND_KEY = 'mh_staff_attendance';
  var ANNUAL_LEAVE_DAYS = 14;

  function _getAttendanceStore() {
    try { return JSON.parse(localStorage.getItem(_ATTEND_KEY) || '{}'); } catch (_) { return {}; }
  }

  function _saveAttendanceStore(store) {
    try { localStorage.setItem(_ATTEND_KEY, JSON.stringify(store)); } catch (e) {
      console.warn('[WorkshopStaff] attendance save error:', e);
    }
  }

  function markAttendance(staffId, date, status) {
    if (!staffId || !date || !status) return { ok: false, error: 'staffId, date, status required' };
    var validStatuses = ['present', 'absent', 'leave', 'holiday', 'half-day'];
    if (validStatuses.indexOf(status) === -1) return { ok: false, error: 'Invalid status: ' + status };
    var store = _getAttendanceStore();
    if (!store[staffId]) store[staffId] = {};
    store[staffId][date] = status;
    _saveAttendanceStore(store);
    return { ok: true };
  }

  function getAttendance(staffId, month) {
    var store = _getAttendanceStore();
    var records = store[staffId] || {};
    if (!month) return records;
    var filtered = {};
    Object.keys(records).forEach(function (d) {
      if (d.startsWith(month)) filtered[d] = records[d];
    });
    return filtered;
  }

  function getLeaveBalance(staffId, year) {
    var y = year || new Date().getFullYear();
    var store = _getAttendanceStore();
    var records = store[staffId] || {};
    var usedLeave = Object.keys(records).filter(function (d) {
      return d.startsWith(String(y)) && records[d] === 'leave';
    }).length;
    return {
      total:     ANNUAL_LEAVE_DAYS,
      used:      usedLeave,
      remaining: Math.max(0, ANNUAL_LEAVE_DAYS - usedLeave)
    };
  }

  function calcMonthlyPayroll(staffId, month) {
    var staff = findStaff(staffId);
    if (!staff) return { ok: false, error: 'Staff not found' };
    var attendance = getAttendance(staffId, month);
    var days = Object.keys(attendance);
    var halfDayCount = days.filter(function (d) { return attendance[d] === 'half-day'; }).length;
    var fullPresentDays = days.filter(function (d) { return attendance[d] === 'present'; }).length;
    var presentDays = fullPresentDays + (halfDayCount * 0.5);
    var absentDays  = days.filter(function (d) { return attendance[d] === 'absent'; }).length;
    var workingDaysInMonth = 26;
    var baseSalary  = parseFloat(staff.monthlyRate || 0) ||
                      (parseFloat(staff.dailyRate || 0) * workingDaysInMonth);
    var dailyRate   = baseSalary > 0 ? (baseSalary / workingDaysInMonth)
                                     : (parseFloat(staff.dailyRate || 0));

    var halfDayDays = days.filter(function (d) { return attendance[d] === 'half-day'; }).length;
    var deductions  = (absentDays * dailyRate) + (halfDayDays * dailyRate * 0.5);
    var netPay      = Math.max(0, baseSalary - deductions);
    return {
      ok:           true,
      staffId:      staffId,
      staffName:    staff.name,
      month:        month,
      baseSalary:   Math.round(baseSalary),
      presentDays:  presentDays,
      absentDays:   absentDays,
      halfDayDays:  halfDayDays,
      deductions:   Math.round(deductions),
      netPay:       Math.round(netPay),
      dailyRate:    Math.round(dailyRate)
    };
  }

  function syncToExpenses(staffId, month) {
    var payroll = calcMonthlyPayroll(staffId, month);
    if (!payroll.ok) return { ok: false, error: payroll.error };
    if (!payroll.netPay || payroll.netPay <= 0) return { ok: false, error: 'Net pay is zero — nothing to sync' };
    var _payrollDateObj = new Date();
    var expDate = _payrollDateObj.getFullYear() + '-' + String(_payrollDateObj.getMonth() + 1).padStart(2, '0') + '-' + String(_payrollDateObj.getDate()).padStart(2, '0');
    var expEntry = {
      id:    'SAL-' + staffId + '-' + month.replace('-', ''),
      date:  expDate,
      amt:   payroll.netPay,
      cat:   'Staff Salary',
      desc:  payroll.staffName + ' — ' + month + ' salary (present:' + payroll.presentDays + ' absent:' + payroll.absentDays + ')',
      ref:   staffId,
      type:  'salary'
    };
    try {
      if (window.ERP && ERP.state) {
        var setState = (ERP.setState && typeof ERP.setState === 'function') ? ERP.setState : (ERP._internal && ERP._internal.setState);
        if (setState) {
          setState(function (s) {
            if (!s.data.expenses) s.data.expenses = [];
            s.data.expenses = s.data.expenses.filter(function (e) { return e.id !== expEntry.id; });
            s.data.expenses.unshift(expEntry);
          }, 'staff:salary:' + staffId + ':' + month);
          ERP.Persistence.save('expenses', ERP._internal.getState().data.expenses || []).catch(function(e){ console.error('[WorkshopStaff] salary expense persist failed:', e && e.message || e); if (window.ERP && ERP.ui && ERP.ui.toast) ERP.ui.toast('Salary recorded, but save to disk failed — please verify after reload.', 'warning', 6000); });

          var ACC = window.AccountingCore;
          if (ACC && ACC.JournalService && ACC.SYSTEM_ACCOUNTS) {
            var salaryPaisa = Math.round(payroll.netPay * 100);
            var glSourceId  = expEntry.id;
            var salaryEntries = [
              { accountId: ACC.SYSTEM_ACCOUNTS.SALARY || 'acc-5201', debit: salaryPaisa, credit: 0,           description: expEntry.desc },
              { accountId: ACC.SYSTEM_ACCOUNTS.CASH   || 'acc-1001', debit: 0,           credit: salaryPaisa, description: 'Salary paid: ' + payroll.staffName }
            ];
            var _postSalaryJournal = function () {
              ACC.JournalService.post({
                date:         expDate,
                reference:    glSourceId,
                sourceModule: 'expenses',
                sourceId:     glSourceId,
                memo:         expEntry.desc,
                entries:      salaryEntries
              }, 'system').catch(function (e) {
                console.warn('[workshop_staff] Salary GL post failed:', e && e.message);
              });
            };
            if (ACC.AccountingState && !ACC.AccountingState.journalExistsForSource(glSourceId)) {
              _postSalaryJournal();
            } else {
              var _pe = window.ERP && window.ERP.PostingEngine;
              var _RI = _pe && _pe._ReversalIndex;
              var _existingJournals = (_pe && typeof _pe.getByDocument === 'function') ? _pe.getByDocument(glSourceId) : [];
              var _activeJournal = _existingJournals.filter(function (j) {
                return !(_RI && typeof _RI.isReversed === 'function' && _RI.isReversed(j.id));
              }).pop();
              var _activeSalaryLine = _activeJournal && Array.isArray(_activeJournal.entries)
                ? _activeJournal.entries.find(function (e) { return (e.debit || 0) > 0; })
                : null;
              var _activeSalaryPaisa = _activeSalaryLine ? (_activeSalaryLine.debit || 0) : null;
              if (_activeJournal && _activeSalaryPaisa !== null && _activeSalaryPaisa !== salaryPaisa && _pe && typeof _pe.reverse === 'function') {
                _pe.reverse(glSourceId, { reason: 'Attendance corrected — re-syncing salary: ' + glSourceId, actor: 'system' })
                  .then(_postSalaryJournal)
                  .catch(function (e) {
                    console.warn('[workshop_staff] Salary GL reversal (for correction) failed:', e && e.message);
                  });
              }
            }
          }

          return { ok: true, expEntry: expEntry };
        }
      }
      return { ok: false, error: 'ERP.state not available — cannot sync' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }


  return {
    render:           render,
    openModal:        openModal,
    openReport:       openReport,
    printReport:      printReport,
    addStaff:         addStaff,
    updateStaff:      updateStaff,
    deleteStaff:      deleteStaff,
    findStaff:        findStaff,
    setFilter:        setFilter,
    search:           search,
    getAll:           _getAll,
    CATEGORIES:       CATEGORIES,
    markAttendance:   markAttendance,
    getAttendance:    getAttendance,
    getLeaveBalance:  getLeaveBalance,
    calcMonthlyPayroll: calcMonthlyPayroll,
    syncToExpenses:   syncToExpenses,
    _safeDelete: function (id) { deleteStaff(id); render(); },
  };

})();

(function _registerStaffRenderer() {
  function _reg() {
    if (typeof ERP !== 'undefined' && typeof ERP.registerRenderer === 'function') {
      ERP.registerRenderer('staff', function () { WorkshopStaff.render(); });
    } else {
      setTimeout(_reg, 80);
    }
  }
  _reg();
}());
