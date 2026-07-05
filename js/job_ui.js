
const JobUI = (function () {
  'use strict';

  let _state   = null;
  let _service = null;
  let _bus     = null;
  let _deps    = {};
  let _initialized = false;

  let _jobsChangedHandler    = null;
  let _jobSelectedHandler    = null;
  let _jobsStatusChangedHandler = null;
  let _delegatedWired = false;
  let _delegatedClickHandler = null;
  let _renderScheduled = false;
  let _globalDropdownCloserWired = false;
  let _closeAllDropdownsHandler = null;

  function _wireGlobalDropdownCloser() {
    if (_globalDropdownCloserWired) return;
    _globalDropdownCloserWired = true;
    _closeAllDropdownsHandler = function () {
      document.querySelectorAll('.jp-dropdown').forEach(function (dd) { dd.style.display = 'none'; });
    };
    window.addEventListener('scroll', _closeAllDropdownsHandler, { passive: true });
    window.addEventListener('resize', _closeAllDropdownsHandler, { passive: true });
  }

  function _unwireGlobalDropdownCloser() {
    if (!_globalDropdownCloserWired) return;
    if (_closeAllDropdownsHandler) {
      window.removeEventListener('scroll', _closeAllDropdownsHandler);
      window.removeEventListener('resize', _closeAllDropdownsHandler);
      _closeAllDropdownsHandler = null;
    }
    _globalDropdownCloserWired = false;
  }

  function _hasActiveJobFilter() {
    const searchEl     = _el('job-search');
    const statusDropEl = _el('job-status-filter');
    const dateDropEl   = _el('job-date-filter');
    const tabStatus    = _state.getCurrentFilter ? _state.getCurrentFilter() : 'all';
    return !!(
      (tabStatus && tabStatus !== 'all') ||
      (searchEl     && searchEl.value.trim()) ||
      (statusDropEl && statusDropEl.value) ||
      (dateDropEl   && dateDropEl.value)
    );
  }

  function _renderJobsPreservingFilter() {
    try {
      if (_hasActiveJobFilter()) applyJobFilters();
      else renderJobs();
    } catch (e) {
      console.error('[JobUI] render error:', e);
    }
  }

  function _getCurrentlyVisibleJobs() {
    return _hasActiveJobFilter() ? _getFilteredJobs() : _state.getJobs();
  }

  function _renderBulkSelectAllHeader(visibleList) {
    const th = _el('job-select-all-th');
    if (!th) return;
    if (!_state.isBulkMode()) { th.innerHTML = ''; return; }
    const ids = (visibleList || []).filter(function (j) { return j && j.id; }).map(function (j) { return j.id; });
    const selected = _state.getBulkSelected();
    const allSelected = ids.length > 0 && ids.every(function (id) { return selected.has(id); });
    th.innerHTML = '<input type="checkbox" class="au-check" ' + (allSelected ? 'checked' : '') +
      ' data-job-action="bulk-toggle-all" title="' + (allSelected ? 'Deselect all' : 'Select all') + '">';
  }

  function _scheduleRenderJobs() {
    if (_renderScheduled) return;
    _renderScheduled = true;
    Promise.resolve().then(function () {
      _renderScheduled = false;
      _renderJobsPreservingFilter();
    }).catch(function (e) {
      _renderScheduled = false;
      console.error('[JobUI] _scheduleRenderJobs error:', e);
    });
  }

  function init(state, service, bus, deps) {
    if (_initialized) return;
    if (!state || !service || !bus) {
      throw new Error('[JobUI] init: state, service, and bus are required');
    }
    _state   = state;
    _service = service;
    _bus     = bus;
    _deps    = deps || {};
    _initialized = true;

    _jobsChangedHandler = function () {
      _scheduleRenderJobs();
    };
    var _jobSelectedBusy = false;
    _jobSelectedHandler = function (p) {
      if (_jobSelectedBusy) return;
      _jobSelectedBusy = true;
      try {
        if (p && p.jobId !== undefined && p.jobId !== null) showJobDetail(p.jobId);
        else if (p && p.jobId === null) showJobList();
      } finally {
        _jobSelectedBusy = false;
      }
    };
    _jobsStatusChangedHandler = function () {
      _scheduleRenderJobs();
    };

    _bus.on(_bus.EVENTS.JOBS_CHANGED,        _jobsChangedHandler);
    _bus.on(_bus.EVENTS.JOBS_SELECTED,       _jobSelectedHandler);
    _bus.on(_bus.EVENTS.JOBS_STATUS_CHANGED, _jobsStatusChangedHandler);

    _wireDelegated();
  }
  function destroy() {
    if (_bus) {
      if (_jobsChangedHandler)       _bus.off(_bus.EVENTS.JOBS_CHANGED,        _jobsChangedHandler);
      if (_jobSelectedHandler)       _bus.off(_bus.EVENTS.JOBS_SELECTED,       _jobSelectedHandler);
      if (_jobsStatusChangedHandler) _bus.off(_bus.EVENTS.JOBS_STATUS_CHANGED, _jobsStatusChangedHandler);
    }
    if (_delegatedClickHandler) {
      document.removeEventListener('click', _delegatedClickHandler);
      _delegatedClickHandler = null;
    }
    _unwireGlobalDropdownCloser();
    _jobsChangedHandler        = null;
    _jobSelectedHandler        = null;
    _jobsStatusChangedHandler  = null;
    _initialized               = false;
    _delegatedWired            = false;
    _renderScheduled           = false;
  }

  function _esc(str) {
    if (typeof _deps.escapeHtml === 'function') return _deps.escapeHtml(str);
    return String(str || '').replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
    });
  }

  function _labTotalUI(job) {
    if (typeof _deps.labTotal === 'function') return _deps.labTotal(job);
    if (Array.isArray(job.labourLines) && job.labourLines.length) {
      return job.labourLines.reduce(function (s, ll) { return s + (Number(ll.amt) || 0); }, 0);
    }
    return Number(job.lab) || 0;
  }

  function _fmt(n) {
    // FIX (root cause, audit #75): already preferred the injected formatCurrency
    // dependency (which module_init.js wires to ERP.fmt), but the fallback path
    // (used only if that dependency isn't supplied) was still a hardcoded 'Rs.'
    // duplicate -- now also checks ERP.fmt directly before falling back.
    if (typeof _deps.formatCurrency === 'function') return _deps.formatCurrency(n);
    if (window.ERP && typeof window.ERP.fmt === 'function') return window.ERP.fmt(n);
    return 'Rs.' + (Number(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function _el(id) { return document.getElementById(id); }

  function _renderJobStatCards() {
    var pending    = _state.countByStatus('pending');
    var inProgress = _state.countByStatus('in-progress') + _state.countByStatus('waiting-parts');
    var completed  = _state.countByStatus('completed') + _state.countByStatus('delivered');

    var all = _state.getJobs() || [];
    var revenue = 0;
    for (var i = 0; i < all.length; i++) {
      var j = all[i];
      if (j.status === 'completed' || j.status === 'delivered') {
        revenue += (window.JobService && typeof window.JobService.grandTotal === 'function')
          ? window.JobService.grandTotal(j) : 0;
      }
    }

    var completedToday = _state.countCompletedToday ? _state.countCompletedToday() : 0;
    var monthlyLabour  = _state.getMonthlyLabour ? _state.getMonthlyLabour() : 0;

    var pEl  = _el('job-stat-pending');         if (pEl)  pEl.textContent  = pending;
    var iEl  = _el('job-stat-inprogress');      if (iEl)  iEl.textContent  = inProgress;
    var cEl  = _el('job-stat-completed');       if (cEl)  cEl.textContent  = completed;
    var rEl  = _el('job-stat-revenue');         if (rEl)  rEl.textContent  = _fmt(revenue);
    var ctEl = _el('job-stat-completedtoday');  if (ctEl) ctEl.textContent = completedToday;
    var mlEl = _el('job-stat-monthlylabour');   if (mlEl) mlEl.textContent = _fmt(monthlyLabour);
  }

  function _wireDelegated() {
    if (_delegatedWired) return;
    _delegatedWired = true;
    _delegatedClickHandler = function (e) {
      const jobPanel = e.target.closest(
        '#pv-repair, #job-detail-view, #job-list-container, [data-job-panel]'
      );
      if (!jobPanel) return;

      const btn = e.target.closest('[data-job-action]');
      if (!btn) return;

      e.stopPropagation();

      const action = btn.dataset.jobAction;
      const jobId  = btn.dataset.jobId;

      switch (action) {
        case 'open':      showJobDetail(jobId);                          break;
        case 'edit':      editJobById(jobId);                            break;
        case 'delete':    _service.deleteJob(jobId);                     break;
        case 'status':    _service.updateJobStatus(jobId, btn.dataset.jobStatus); break;
        case 'pay':       _service.collectPayment(jobId);                break;
        case 'print':     _service.printJobCard();                       break;
        case 'pdf':       _service.exportJobPDF();                       break;
        case 'wa':        _service.openJobWA();                          break;
        case 'convert-inv': _service.convertJobToInvoice(jobId);        break;
        case 'approve':   _service.customerApproveJob();                 break;
        case 'warranty':  _service.openWarrantyJob(jobId);               break;
        case 'del-part': {
          var _pIdx = parseInt(btn.dataset.partIdx, 10);
          if (!isNaN(_pIdx)) _service.deleteJobPart(_pIdx, jobId);
          break;
        }
        case 'del-labour': {
          var _lIdx = parseInt(btn.dataset.labourIdx, 10);
          if (!isNaN(_lIdx)) _service.deleteLabourLine(_lIdx, jobId);
          break;
        }
        case 'del-photo': {
          var _dpIdx = parseInt(btn.dataset.photoIdx, 10);
          if (!isNaN(_dpIdx)) _service.deleteJobPhotoEnhanced(jobId, _dpIdx);
          break;
        }
        case 'caption': {
          var _cpIdx = parseInt(btn.dataset.photoIdx, 10);
          if (!isNaN(_cpIdx)) _service.editPhotoCaption(jobId, _cpIdx);
          break;
        }
        case 'upload-photo': {
          if (_service && typeof _service.uploadJobPhotoEnhanced === 'function') {
            _service.uploadJobPhotoEnhanced(btn.dataset.photoType);
          }
          break;
        }
        case 'open-lightbox': {
          var _olIdx = parseInt(btn.dataset.photoIdx, 10);
          openLightbox(jobId, isNaN(_olIdx) ? 0 : _olIdx);
          break;
        }
        case 'bulk-toggle': toggleBulkSelect(jobId);                     break;
        case 'bulk-toggle-all': {
          var _visible = _getCurrentlyVisibleJobs();
          var _visibleIds = _visible.filter(function (j) { return j && j.id; }).map(function (j) { return j.id; });
          var _selected = _state.getBulkSelected();
          var _allSelected = _visibleIds.length > 0 && _visibleIds.every(function (id) { return _selected.has(id); });
          if (_allSelected) {
            _state.deselectAllJobs();
          } else {
            _state.selectAllJobs(_visible);
          }
          _renderJobsPreservingFilter();
          break;
        }
        case 'clock-start':  _labourClockAction('start',  jobId); break;
        case 'clock-pause':  _labourClockAction('pause',  jobId); break;
        case 'clock-resume': _labourClockAction('resume', jobId); break;
        case 'clock-end':    _labourClockAction('end',    jobId); break;
        case 'void-payment':     _service.voidPayment(jobId, btn.dataset.payId); break;
        case 'show-more-parts': {
          var _moreRow = document.getElementById('jd-parts-more');
          if (_moreRow) {
            var _tbody = _moreRow.closest('tbody');
            if (_tbody) {
              var _moreJob = _state.findJob(jobId);
              var _allParts = _moreJob && Array.isArray(_moreJob.parts) ? _moreJob.parts : null;
              if (!_allParts) { _moreRow.remove(); break; }
              var _html = _allParts.slice(50).map(function(p) {
                return '<tr><td>' + _esc(p.n||'') + '</td><td style="text-align:center">' + (Number(p.q)||0) +
                  '</td><td style="text-align:right">' + _fmt(Number(p.p)||0) +
                  '</td><td style="text-align:right;font-weight:700">' + _fmt((Number(p.q)||0)*(Number(p.p)||0)) + '</td></tr>';
              }).join('');
              _moreRow.insertAdjacentHTML('beforebegin', _html);
              _moreRow.remove();
            }
          }
          break;
        }
        default: break;
      }
    };
    document.addEventListener('click', _delegatedClickHandler);
  }

  function filterJobs(status, btn) {
    _state.setCurrentFilter(status || 'all');

    document.querySelectorAll('.filter-btn').forEach(function (b) {
      b.classList.remove('active');
    });
    if (btn) btn.classList.add('active');

    renderJobs();
  }
  function _getFilteredJobs() {
    const searchEl     = _el('job-search');
    const statusDropEl = _el('job-status-filter');
    const dateDropEl   = _el('job-date-filter');
    const q            = searchEl ? searchEl.value.trim().toLowerCase() : '';
    const tabStatus    = _state.getCurrentFilter ? _state.getCurrentFilter() : 'all';
    const dropStatus   = statusDropEl ? statusDropEl.value : '';
    const dateFilter   = dateDropEl   ? dateDropEl.value   : '';
    let jobs           = _state.getJobs();

    const effectiveStatus = tabStatus && tabStatus !== 'all' ? tabStatus : dropStatus;
    if (effectiveStatus) {
      jobs = jobs.filter(function (j) { return j.status === effectiveStatus; });
    }

    if (dateFilter) {
      const today = (function(){ var _d=new Date(); return _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0'); })();
      if (dateFilter === 'today') {
        jobs = jobs.filter(function (j) { return j.date === today; });
      } else if (dateFilter === 'week') {
        var _wa=new Date(Date.now()-7*86400000); const weekAgo=_wa.getFullYear()+'-'+String(_wa.getMonth()+1).padStart(2,'0')+'-'+String(_wa.getDate()).padStart(2,'0');
        jobs = jobs.filter(function (j) { return j.date >= weekAgo && j.date <= today; });
      } else if (dateFilter === 'month') {
        const monthPrefix = today.slice(0, 7);
        jobs = jobs.filter(function (j) { return (j.date || '').startsWith(monthPrefix); });
      }
    }

    if (q) {
      jobs = jobs.filter(function (j) {
        return (
          (j.id    || '').toLowerCase().includes(q) ||
          (j.car   || '').toLowerCase().includes(q) ||
          (j.plate || '').toLowerCase().includes(q) ||
          (j.cust  || '').toLowerCase().includes(q) ||
          (j.mec   || '').toLowerCase().includes(q) ||
          (j.prob  || '').toLowerCase().includes(q)
        );
      });
    }
    return jobs;
  }

  function applyJobFilters() {
    renderJobs(_getFilteredJobs());
  }

  function clearJobFilters() {
    _state.setCurrentFilter('all');
    const searchEl = _el('job-search');
    if (searchEl) searchEl.value = '';
    document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
    const allBtn = document.querySelector('.filter-btn[data-status="all"]');
    if (allBtn) allBtn.classList.add('active');
    renderJobs();
  }

  function renderJobs(jobs) {
    try {
    var _srEl = document.getElementById('job-search');
    if (_srEl && !_srEl._mhWired) {
      _srEl._mhWired = true;
      _srEl.addEventListener('keyup', function () { if(typeof applyJobFilters === 'function') applyJobFilters(); });
    }
      const tbody = _el('job-tbody');
      if (!tbody) return;

      const list = jobs || _state.getJobs();
      const SC   = _state.STATUS_CONFIG;

      _renderJobStatCards();
      _renderBulkSelectAllHeader(list);

      if (!list.length) {
        tbody.innerHTML =
          '<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--muted)">No jobs found</td></tr>';
        return;
      }

      var STATUS_BADGE = {
        'pending':       'au-b-pending',
        'in-progress':   'au-b-inprogress',
        'waiting-parts': 'au-b-waiting',
        'completed':     'au-b-completed',
        'delivered':     'au-b-delivered',
        'cancelled':     'au-b-cancelled'
      };

      tbody.innerHTML = list.map(function (j) {
        const sc  = SC[j.status] || { l: j.status, cls: 'b-gray' };
        const pt     = (j.parts || []).reduce(function (s, p) { return s + (Number(p.q)||0) * (Number(p.p)||0); }, 0);
        const labAmt = (Array.isArray(j.labourLines) && j.labourLines.length)
          ? j.labourLines.reduce(function (s, ll) { return s + (Number(ll.amt) || 0); }, 0)
          : (Number(j.lab) || 0);
        const tot    = Math.max(0, pt + labAmt - (Number(j.dis) || 0) + (Number(j.taxAmt) || 0));
        const id  = _esc(j.id);
        const badgeCls = STATUS_BADGE[j.status] || 'au-b-gray';

        const bulkCheckbox = _state.isBulkMode()
          ? '<input type="checkbox" class="au-check" ' + (_state.getBulkSelected().has(j.id) ? 'checked' : '') +
            ' data-job-action="bulk-toggle" data-job-id="' + id + '">'
          : '';

        return '<tr class="job-row clickable" data-job-action="open" data-job-id="' + _esc(j.id) + '">' +
          '<td style="width:36px">' + bulkCheckbox + '</td>' +
          '<td><span class="au-job-num">#' + id + '</span></td>' +
          '<td class="au-fw">' + _esc(j.car || '') + '</td>' +
          '<td><span class="au-plate">' + _esc(j.plate || '') + '</span></td>' +
          '<td class="au-hide-md"><span style="display:inline-flex;align-items:center;gap:5px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-3px;color:var(--muted,#64748b)"><use href="#ic-users"/></svg>' + _esc(j.cust || '') + '</span></td>' +
          '<td class="au-hide-md au-dim"><span style="display:inline-flex;align-items:center;gap:5px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px;color:#9ca3af"><use href="#ic-tool"/></svg>' + _esc(j.mec || '') + '</span></td>' +
          '<td>' +
            '<span class="au-badge ' + badgeCls + '">' + _esc(sc.l) + '</span>' +
            
            (j.comeback ? ' <span style="background:#fef2f2;color:#991b1b;border:1px solid #fca5a5;border-radius:10px;font-size:10px;font-weight:700;padding:1px 7px;margin-left:4px">⚠️ COMEBACK</span>' : '') +
            (function(){
              var _ph   = Array.isArray(j.paymentHistory) ? j.paymentHistory : [];
              var _paid = _ph.reduce(function(s,p){return s+(p.voided?0:(Number(p.amount)||0));},0);
              if (_paid <= 0) return '';
              var _balDue = Math.max(0, tot - _paid);
              if (_balDue > 0) {
                return ' <span style="background:#fef9c3;color:#854d0e;border:1px solid #fde047;border-radius:10px;font-size:10px;font-weight:700;padding:1px 7px;margin-left:4px">💛 Partial</span>';
              } else {
                return ' <span style="background:#dcfce7;color:#15803d;border:1px solid #86efac;border-radius:10px;font-size:10px;font-weight:700;padding:1px 7px;margin-left:4px">✅ Paid</span>';
              }
            }()) +
          '</td>' +
          '<td><span class="au-amount">' + _fmt(tot) + '</span></td>' +
          '<td>' +
            '<div class="au-row-actions">' +
              '<button class="au-act au-act-view" data-job-action="open" data-job-id="' + _esc(j.id) + '">View</button>' +
              '<button class="au-act au-act-edit"   data-job-action="edit"   data-job-id="' + id + '">Edit</button>' +
              '<button class="au-act au-act-delete" data-job-action="delete" data-job-id="' + id + '">Delete</button>' +
            '</div>' +
          '</td>' +
        '</tr>';
      }).join('');

    } catch (e) {
      console.error('[JobUI] renderJobs error:', e);
    }
  }

  function showJobList() {
    const listEl   = _el('job-list-container');
    const detailEl = _el('job-detail-view');
    if (listEl)   listEl.style.display   = 'block';
    if (detailEl) detailEl.style.display = 'none';
    _state.clearCurJob();
  }

  function showJobDetail(id) {
    var job = (typeof _state.openJob === 'function') ? _state.openJob(id) : (_state.findJob ? _state.findJob(id) : null);

    if (!job) {
      console.warn('[JobUI] showJobDetail: job "' + id + '" not in index — attempting re-index');
      try {
        var allJobs = _state.getJobs ? _state.getJobs() : [];
        if (allJobs.length && typeof _state.setJobs === 'function') {
          _state.setJobs(allJobs);
          job = (typeof _state.openJob === 'function') ? _state.openJob(id) : (_state.findJob ? _state.findJob(id) : null);
        }
      } catch (e) {
        console.warn('[JobUI] showJobDetail: re-index attempt failed:', e);
      }
    }

    if (!job) {
      console.warn('[JobUI] showJobDetail: job "' + id + '" not found after re-index');
      return;
    }

    const detailEl = _el('job-detail-view');
    const listEl   = _el('job-list-container');
    if (listEl)   listEl.style.display   = 'none';
    if (detailEl) detailEl.style.display = 'block';

    _renderJobDetail(job);
  }

  function _renderJobDetail(job) {
    try {
      const SC       = _state.STATUS_CONFIG;
      const sc       = SC[job.status] || { l: job.status, cls: 'b-gray' };
      const parts    = job.parts    || [];
      const notes    = job.notes    || [];
      const labLines = job.labourLines || [];
      const photos   = job.photos   || [];
      const partsTotal = parts.reduce(function (s, p) {
        return s + (Number(p.q)||0) * (Number(p.p)||0);
      }, 0);
      const grand = Math.max(0, partsTotal + _labTotalUI(job) - (Number(job.dis)||0) + (Number(job.taxAmt)||0));

      var payHistory = Array.isArray(job.paymentHistory) ? job.paymentHistory : [];
      var totalPaid  = payHistory.reduce(function (s, p) { return s + (p.voided ? 0 : (Number(p.amount)||0)); }, 0);
      var balance    = Math.max(0, grand - totalPaid);

      const el = _el('job-detail-view');
      if (!el) return;

      const STATUS_COLORS = {
        'pending':       '#d97706',
        'in-progress':   '#4338CA',
        'waiting-parts': '#7c3aed',
        'completed':     '#16a34a',
        'delivered':     '#059669',
        'cancelled':     '#dc2626'
      };
      const statusColor = STATUS_COLORS[job.status] || '#6b7280';

      const partsRows = parts.length
        ? parts.map(function (p, i) {
            return '<tr>' +
              '<td style="padding:6px 8px 6px 14px;font-size:12px">' + _esc(p.n) + '</td>' +
              '<td style="padding:6px 8px;text-align:center;font-size:12px">' + (Number(p.q)||0) + '</td>' +
              '<td style="padding:6px 8px;font-size:12px">' + _fmt(p.p) + '</td>' +
              '<td style="padding:6px 8px;font-weight:600;color:#4338CA;font-size:12px">' + _fmt((Number(p.q)||0)*(Number(p.p)||0)) + '</td>' +
              '<td style="padding:6px 8px;text-align:center">' +
                '<button style="border:none;background:none;cursor:pointer;color:#9ca3af;font-size:13px" data-job-action="del-part" data-part-idx="' + i + '" data-job-id="' + _esc(job.id) + '" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;vertical-align:-2px"><use href="#ic-trash"/></svg></button>' +
              '</td>' +
            '</tr>';
          }).join('')
        : '<tr><td colspan="5" style="padding:16px;text-align:center;color:#9ca3af;font-size:12px">No parts added</td></tr>';

      const labRows = labLines.length
        ? labLines.map(function (ll, li) {
            const a = ll.amt !== undefined ? ll.amt : ((Number(ll.hrs)||1) * (Number(ll.rate)||Number(ll.fixed)||0));
            return '<tr>' +
              '<td style="padding:6px 8px 6px 14px;font-size:12px">' + _esc(ll.desc || '') +
                (ll.mec ? ' <span style="color:#7c3aed;font-size:11px">(' + _esc(ll.mec) + ')</span>' : '') +
              '</td>' +
              '<td style="padding:6px 8px;font-weight:600;color:#7c3aed;font-size:12px;text-align:right">' + _fmt(a) + '</td>' +
              '<td style="padding:6px 8px;text-align:center">' +
                '<button style="border:none;background:none;cursor:pointer;color:#9ca3af;font-size:13px" data-job-action="del-labour" data-labour-idx="' + li + '" data-job-id="' + _esc(job.id) + '" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;vertical-align:-2px"><use href="#ic-trash"/></svg></button>' +
              '</td>' +
            '</tr>';
          }).join('')
        : '<tr><td colspan="3" style="padding:16px;text-align:center;color:#9ca3af;font-size:12px">No labour lines</td></tr>';

      const notesHtml = notes.length
        ? notes.map(function (n) {
            return '<div style="border-left:2px solid #4338CA;padding:6px 10px;margin-bottom:6px;background:var(--bg);border-radius:0 5px 5px 0">' +
              '<div style="font-size:10px;color:#9ca3af;margin-bottom:2px">[' + _esc(n.ts || '') + '] ' + _esc(n.author || '') + '</div>' +
              '<div style="font-size:12px;color:var(--text,#1e293b)">' + _esc(n.text || '') + '</div>' +
            '</div>';
          }).join('')
        : '<div style="color:#9ca3af;font-size:12px;padding:8px 0">No notes yet</div>';

      const photosHtml = renderJobPhotos(job, true);

      var phRows = payHistory.map(function (p) {
        var isVoided = !!p.voided;
        return '<tr style="border-bottom:0.5px solid #f3f4f6' + (isVoided ? ';opacity:.5' : '') + '">' +
          '<td style="padding:5px 8px;font-size:11px;color:var(--muted,#64748b)">' + _esc(p.date || '') + '</td>' +
          '<td style="padding:5px 8px"><span style="background:#dbeafe;color:#1d4ed8;padding:1px 7px;border-radius:8px;font-size:10px;font-weight:600">' + _esc(p.method || 'Cash') + '</span></td>' +
          '<td style="padding:5px 8px;font-weight:600;color:' + (isVoided ? '#9ca3af' : '#16a34a') + ';font-size:12px">' + (isVoided ? '<s>' : '') + _fmt(p.amount || 0) + (isVoided ? '</s>' : '') + '</td>' +
          '<td style="padding:5px 8px;font-size:11px;color:var(--muted,#64748b)">' + _esc(p.note || '') + '</td>' +
          '<td style="padding:5px 8px;text-align:center">' +
            (isVoided
              ? '<span style="background:#fee2e2;color:#dc2626;padding:1px 7px;border-radius:8px;font-size:10px;font-weight:600">VOID</span>'
              : '<button data-job-action="void-payment" data-job-id="' + _esc(job.id) + '" data-pay-id="' + _esc(p.id) + '" style="background:none;border:0.5px solid #fca5a5;color:#dc2626;padding:2px 8px;border-radius:5px;font-size:10px;cursor:pointer;font-weight:600">Void</button>') +
          '</td>' +
        '</tr>';
      }).join('');

      const STATUS_ICONS = { pending:'🕐','in-progress':'🔧','waiting-parts':'⏳',completed:'✅',delivered:'🚗',cancelled:'❌' };

      el.innerHTML =
        '<style>' +
          '#job-detail-view .jd-sec{font-size:10px;font-weight:600;color:var(--muted,#6b7280);text-transform:uppercase;letter-spacing:.55px;padding:7px 14px;background:var(--hover,#f8f9fa);border-top:0.5px solid var(--border,#e5e7eb);border-bottom:0.5px solid var(--border,#e5e7eb);display:flex;align-items:center;justify-content:space-between}' +
          '#job-detail-view .jd-card{background:#fff;border:0.5px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:12px}' +
          '#job-detail-view .jd-info-row{display:flex;justify-content:space-between;align-items:center;padding:5px 14px;border-bottom:0.5px solid #f3f4f6;font-size:12px}' +
          '#job-detail-view .jd-info-lbl{color:#6b7280;font-size:11px}' +
          '#job-detail-view .jd-info-val{font-weight:500;color:#111;font-size:12px}' +
          '#job-detail-view table{border-collapse:collapse;width:100%}' +
          '#job-detail-view thead th{font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.4px;padding:7px 8px;text-align:left;border-bottom:0.5px solid #e5e7eb;background:var(--bg)}' +
          '#job-detail-view thead th:first-child{padding-left:14px}' +
          '#job-detail-view tbody tr:hover{background:#fafafa}' +
          '#job-detail-view .jd-act-btn{padding:6px 12px;border-radius:6px;font-size:11px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:4px;border:0.5px solid #d1d5db;background:#fff;color:#374151}' +
          '#job-detail-view .jd-act-btn:hover{background:var(--bg)}' +
          '#job-detail-view .jd-act-primary{background:#4338CA;color:#fff;border-color:#4338CA}' +
          '#job-detail-view .jd-act-primary:hover{background:#1d4ed8}' +
          '#job-detail-view .jd-act-success{background:#16a34a;color:#fff;border-color:#16a34a}' +
          '#job-detail-view .jd-act-danger{color:#dc2626;border-color:#fca5a5}' +
        '</style>' +

        '<div style="padding:14px;max-width:1000px;margin:0 auto">' +

          '<div class="jd-card" style="margin-bottom:12px">' +
            '<div style="background:#4338CA;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">' +
              '<div style="display:flex;align-items:center;gap:10px">' +
                '<button style="background:rgba(255,255,255,.18);border:0.5px solid rgba(255,255,255,.3);color:#fff;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:11px;display:inline-flex;align-items:center;gap:4px" onclick="showJobList()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-refresh"/></svg> Back</button>' +
                '<div>' +
                  '<div style="color:#fff;font-size:15px;font-weight:600">Job #' + _esc(job.id) + ' — ' + _esc(job.car) + '</div>' +
                  '<div style="color:rgba(255,255,255,.7);font-size:11px">' + _esc(job.plate || '') + (job.cust ? ' · ' + _esc(job.cust) : '') + '</div>' +
                '</div>' +
              '</div>' +
              '<span style="background:' + statusColor + '22;color:' + statusColor + ';border:0.5px solid ' + statusColor + '44;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:600">' + (STATUS_ICONS[job.status] || '') + ' ' + _esc(sc.l) + '</span>' +
            '</div>' +

            '<div style="padding:10px 14px;display:flex;flex-wrap:wrap;gap:6px;border-bottom:0.5px solid #e5e7eb">' +
              '<button class="jd-act-btn jd-act-primary" data-job-action="edit" data-job-id="' + _esc(job.id) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-edit"/></svg> Edit</button>' +
              (function(){
                var ph2 = Array.isArray(job.paymentHistory) ? job.paymentHistory : [];
                var paid2 = ph2.reduce(function(s,p){return s+(p.voided?0:(Number(p.amount)||0));},0);
                return (grand > 0 && paid2 < grand)
                  ? '<button class="jd-act-btn jd-act-success" data-job-action="pay" data-job-id="' + _esc(job.id) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-money"/></svg> Payment</button>'
                  : '';
              }()) +
              '<button class="jd-act-btn btn-wa-ghost" data-job-action="wa" data-job-id="' + _esc(job.id) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-whatsapp"/></svg> WhatsApp</button>' +
              '<button class="jd-act-btn" data-job-action="print" data-job-id="' + _esc(job.id) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-print"/></svg> Print</button>' +
              '<button class="jd-act-btn" data-job-action="pdf" data-job-id="' + _esc(job.id) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-invoice"/></svg> PDF</button>' +
              '<button class="jd-act-btn" data-job-action="convert-inv" data-job-id="' + _esc(job.id) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-receipt"/></svg> ' + (job.invoiceId ? _esc(job.invoiceId) : 'Invoice') + '</button>' +
              (job.customerApproved ? '' : '<button class="jd-act-btn" data-job-action="approve" data-job-id="' + _esc(job.id) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-check"/></svg> Approve</button>') +
              (!job.isWarranty ? '<button class="jd-act-btn" data-job-action="warranty" data-job-id="' + _esc(job.id) + '" style="color:#7c3aed;border-color:#ddd6fe"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-check"/></svg> Warranty</button>' : '') +
              '<button class="jd-act-btn jd-act-danger" data-job-action="delete" data-job-id="' + _esc(job.id) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-trash"/></svg> Delete</button>' +
            '</div>' +

            (function () {
              const SC2 = _state.STATUS_CONFIG;
              const sts2 = _state.VALID_STATUSES;
              let sBtns = '';
              sts2.forEach(function (s) {
                if (s === job.status || s === 'cancelled') return;
                const sc2 = SC2[s] || { l: s };
                const sc2color = STATUS_COLORS[s] || '#6b7280';
                sBtns += '<button style="padding:4px 10px;border-radius:20px;border:0.5px solid ' + sc2color + '44;background:' + sc2color + '11;color:' + sc2color + ';font-size:10px;font-weight:600;cursor:pointer" data-job-action="status" data-job-id="' + _esc(job.id) + '" data-job-status="' + s + '">' + (STATUS_ICONS[s] || '') + ' ' + sc2.l + '</button>';
              });
              return sBtns
                ? '<div style="padding:8px 14px;display:flex;flex-wrap:wrap;gap:6px;align-items:center"><span style="font-size:10px;color:var(--muted,#64748b);font-weight:600;text-transform:uppercase;letter-spacing:.4px">Move to:</span>' + sBtns + '</div>'
                : '';
            }()) +

          '</div>' +

          _renderLabourClockCard(job) +

          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +

            '<div class="jd-card">' +
              '<div class="jd-sec"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;vertical-align:-3px"><use href="#ic-car"/></svg> Vehicle & customer</span></div>' +
              '<div class="jd-info-row"><span class="jd-info-lbl">Vehicle</span><span class="jd-info-val">' + _esc(job.car || '—') + '</span></div>' +
              '<div class="jd-info-row"><span class="jd-info-lbl">Plate</span><span class="jd-info-val" style="font-family:monospace">' + _esc(job.plate || '—') + '</span></div>' +
              '<div class="jd-info-row"><span class="jd-info-lbl">Engine</span><span class="jd-info-val" style="font-family:monospace">' + _esc(job.eng || '—') + '</span></div>' +
              '<div class="jd-info-row"><span class="jd-info-lbl">Color</span><span class="jd-info-val">' + _esc(job.col || '—') + '</span></div>' +
              '<div class="jd-info-row"><span class="jd-info-lbl">Customer</span><span class="jd-info-val">' + _esc(job.cust || '—') + '</span></div>' +
              '<div class="jd-info-row" style="border:none"><span class="jd-info-lbl">Phone</span><span class="jd-info-val">' + _esc(job.ph || '—') + '</span></div>' +
            '</div>' +

            '<div class="jd-card">' +
              '<div class="jd-sec"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;vertical-align:-3px"><use href="#ic-report"/></svg> Job details</span></div>' +
              '<div class="jd-info-row"><span class="jd-info-lbl">Date</span><span class="jd-info-val">' + _esc(job.date || '—') + '</span></div>' +
              '<div class="jd-info-row"><span class="jd-info-lbl">Delivery</span><span class="jd-info-val">' + _esc(job.del || '—') + '</span></div>' +
              '<div class="jd-info-row"><span class="jd-info-lbl">Mechanic</span><span class="jd-info-val">' + _esc(job.mec || '—') + '</span></div>' +
              '<div class="jd-info-row"><span class="jd-info-lbl">Invoice</span><span class="jd-info-val">' + _esc(job.invoiceId || 'Not generated') + '</span></div>' +
              '<div class="jd-info-row"><span class="jd-info-lbl">Approved</span><span class="jd-info-val">' + (job.customerApproved ? '✅ Yes' : '❌ No') + '</span></div>' +
              '<div class="jd-info-row" style="border:none"><span class="jd-info-lbl">Problem</span><span class="jd-info-val" style="max-width:200px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + _esc(job.prob || '') + '">' + _esc((job.prob || '').substring(0,40) + (job.prob && job.prob.length > 40 ? '…' : '')) + '</span></div>' +
            '</div>' +

          '</div>' +

          (payHistory.length || job.paidAmount ? (
            '<div class="jd-card" style="margin-bottom:12px">' +
              '<div class="jd-sec"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;vertical-align:-3px"><use href="#ic-money"/></svg> Payment</span></div>' +
              '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#e5e7eb">' +
                '<div style="background:var(--white,#fff);padding:10px;text-align:center"><div style="font-size:10px;color:var(--muted,#64748b);text-transform:uppercase;margin-bottom:3px">Total</div><div style="font-size:14px;font-weight:600;color:#4338CA">' + _fmt(grand) + '</div></div>' +
                '<div style="background:var(--white,#fff);padding:10px;text-align:center"><div style="font-size:10px;color:var(--muted,#64748b);text-transform:uppercase;margin-bottom:3px">Paid</div><div style="font-size:14px;font-weight:600;color:#16a34a">' + _fmt(totalPaid) + '</div></div>' +
                '<div style="background:var(--white,#fff);padding:10px;text-align:center"><div style="font-size:10px;color:var(--muted,#64748b);text-transform:uppercase;margin-bottom:3px">Balance</div><div style="font-size:14px;font-weight:600;color:' + (balance > 0 ? '#ea580c' : '#16a34a') + '">' + (balance > 0 ? _fmt(balance) : '✅ Paid') + '</div></div>' +
              '</div>' +
              (phRows ? '<table><thead><tr><th>Date</th><th>Method</th><th>Amount</th><th>Note</th><th>Action</th></tr></thead><tbody>' + phRows + '</tbody></table>' : '') +
            '</div>'
          ) : '') +

          '<div class="jd-card" style="margin-bottom:12px">' +
            '<div class="jd-sec"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;vertical-align:-3px"><use href="#ic-zap"/></svg> Parts & items</span></div>' +
            '<table>' +
              '<thead><tr><th>Part name</th><th style="text-align:center">Qty</th><th>Price</th><th>Amount</th><th style="width:28px"></th></tr></thead>' +
              '<tbody>' + partsRows + '</tbody>' +
            '</table>' +
          '</div>' +

          '<div class="jd-card" style="margin-bottom:12px">' +
            '<div class="jd-sec"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;vertical-align:-3px"><use href="#ic-cal"/></svg> Labour & charges</span><button class="jd-act-btn" style="padding:3px 10px;font-size:10px" onclick="addLabourLineFromDetail()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;vertical-align:-3px"><use href="#ic-plus"/></svg> Add</button></div>' +
            '<table>' +
              '<thead><tr><th>Description</th><th style="text-align:right;width:100px">Amount</th><th style="width:28px"></th></tr></thead>' +
              '<tbody>' + labRows + '</tbody>' +
            '</table>' +
          '</div>' +

          '<div class="jd-card" style="margin-bottom:12px">' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#e5e7eb">' +
              '<div style="background:var(--bg);padding:8px 14px;font-size:12px;color:var(--muted,#64748b)">Parts total<div style="font-size:13px;font-weight:600;color:#111;margin-top:2px">' + _fmt(partsTotal) + '</div></div>' +
              '<div style="background:var(--bg);padding:8px 14px;font-size:12px;color:var(--muted,#64748b)">Labour<div style="font-size:13px;font-weight:600;color:#111;margin-top:2px">' + _fmt(_labTotalUI(job)) + '</div></div>' +
              (job.dis ? '<div style="background:#fff7ed;padding:8px 14px;font-size:12px;color:#ea580c;grid-column:1/-1">Discount<div style="font-size:13px;font-weight:600;color:#ea580c;margin-top:2px">- ' + _fmt(job.dis) + '</div></div>' : '') +
              (Number(job.taxAmt) > 0 ? '<div style="background:#eff6ff;padding:8px 14px;font-size:12px;color:#4338CA;grid-column:1/-1">Tax<div style="font-size:13px;font-weight:600;color:#4338CA;margin-top:2px">+ ' + _fmt(job.taxAmt) + '</div></div>' : '') +
            '</div>' +
            '<div style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center;background:#4338CA">' +
              '<span style="color:rgba(255,255,255,.8);font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.5px">Grand Total</span>' +
              '<span style="color:#fff;font-size:18px;font-weight:700">' + _fmt(grand) + '</span>' +
            '</div>' +
          '</div>' +

          '<div class="jd-card" style="margin-bottom:12px">' +
            '<div class="jd-sec"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;vertical-align:-3px"><use href="#ic-camera"/></svg> Photos</span>' +
              '<div style="display:flex;gap:5px">' +
                '<button class="jd-act-btn" style="padding:3px 8px;font-size:10px" data-job-action="upload-photo" data-photo-type="before">Before</button>' +
                '<button class="jd-act-btn" style="padding:3px 8px;font-size:10px" data-job-action="upload-photo" data-photo-type="after">After</button>' +
                '<button class="jd-act-btn" style="padding:3px 8px;font-size:10px" data-job-action="upload-photo" data-photo-type="other">Other</button>' +
              '</div>' +
            '</div>' +
            '<div style="padding:10px 14px">' + photosHtml + '</div>' +
          '</div>' +

          '<div class="jd-card">' +
            '<div class="jd-sec"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;vertical-align:-3px"><use href="#ic-report"/></svg> Notes</span><button class="jd-act-btn" style="padding:3px 10px;font-size:10px" onclick="addInternalNote()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;vertical-align:-3px"><use href="#ic-plus"/></svg> Add</button></div>' +
            '<div style="padding:10px 14px">' + notesHtml + '</div>' +
          '</div>' +

        '</div>';

    } catch (e) {
      console.error('[JobUI] _renderJobDetail error:', e);
    }
  }

  function renderJobPhotos(job, returnHtml) {
    if (!job) return returnHtml ? '' : undefined;
    const photos = job.photos || [];

    if (!photos.length) {
      const html = '<div style="color:var(--muted);text-align:center;padding:16px">No photos</div>';
      if (returnHtml) return html;
      const el = _el('job-photos-container');
      if (el) el.innerHTML = html;
      return;
    }

    const html = '<div style="display:flex;flex-wrap:wrap;gap:10px">' +
      photos.map(function (ph, i) {
        const typeLabel = ph.type === 'before' ? '🔴 Before'
                        : ph.type === 'after'  ? '🟢 After'
                        :                        '📷 Photo';
        return '<div style="text-align:center;max-width:180px">' +
          '<img src="' + _esc(ph.data || '') + '" ' +
          'style="width:160px;height:120px;object-fit:cover;border-radius:8px;cursor:pointer;border:2px solid var(--border)" ' +
          'data-job-action="open-lightbox" data-job-id="' + _esc(job.id) + '" data-photo-idx="' + i + '" ' +
          'alt="' + _esc(ph.caption || typeLabel) + '">' +
          '<div style="font-size:10px;margin-top:3px;color:var(--muted)">' + _esc(typeLabel) + '</div>' +
          '<div style="font-size:10px;color:var(--muted);margin-top:1px">' + _esc((ph.caption || '').substring(0, 20)) + '</div>' +
          '<div style="display:flex;gap:4px;justify-content:center;margin-top:4px">' +
            '<button class="btn btn-sm btn-ghost" ' +
            'data-job-action="caption" data-job-id="' + _esc(job.id) + '" data-photo-idx="' + i + '">✏️</button>' +
            '<button class="btn btn-sm btn-danger" ' +
            'data-job-action="del-photo" data-job-id="' + _esc(job.id) + '" data-photo-idx="' + i + '">🗑️</button>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';

    if (returnHtml) return html;
    const el = _el('job-photos-container');
    if (el) el.innerHTML = html;
  }
  function openLightbox(jobId, photoIdx) {
    try {
      const job = _state.findJob ? _state.findJob(jobId) : (_state.getCurJob && _state.getCurJob());
      if (!job) return;
      const photos = job.photos || [];
      if (!photos.length || photoIdx < 0 || photoIdx >= photos.length) return;
      const existing = document.querySelectorAll('.lightbox-overlay');
      existing.forEach(function (el) { el.remove(); });

      let current = photoIdx;

      const overlay = document.createElement('div');
      overlay.className = 'lightbox-overlay';
      overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,.93);z-index:var(--zi-supreme,9999);' +
        'display:flex;align-items:center;justify-content:center;flex-direction:column';

      const render = function (idx) {
        const ph    = photos[idx];
        const total = photos.length;
        const label = ph.type === 'before' ? '🔴 Before'
                    : ph.type === 'after'  ? '🟢 After'
                    : '📷 Photo';

        overlay.innerHTML =
          '<div style="position:absolute;top:16px;right:16px">' +
            '<button id="_lb-close" style="background:rgba(255,255,255,.15);color:#fff;border:none;' +
            'border-radius:50%;width:36px;height:36px;font-size:20px;cursor:pointer">×</button>' +
          '</div>' +
          '<img src="' + _esc(ph.data || '') + '" ' +
          'style="max-width:90vw;max-height:80vh;object-fit:contain;border-radius:8px" ' +
          'alt="' + _esc(ph.caption || label) + '">' +
          '<div style="color:#fff;margin-top:12px;text-align:center">' +
            '<div>' + label + (ph.caption ? ' — ' + _esc(ph.caption) : '') + '</div>' +
            '<div style="font-size:12px;opacity:.6;margin-top:4px">' + (idx + 1) + ' / ' + total + '</div>' +
          '</div>' +
          (total > 1
            ? '<div style="display:flex;gap:16px;margin-top:12px">' +
              '<button id="_lb-prev" style="background:rgba(255,255,255,.15);color:#fff;border:none;' +
              'border-radius:8px;padding:8px 20px;font-size:16px;cursor:pointer">← Prev</button>' +
              '<button id="_lb-next" style="background:rgba(255,255,255,.15);color:#fff;border:none;' +
              'border-radius:8px;padding:8px 20px;font-size:16px;cursor:pointer">Next →</button>' +
              '</div>'
            : '');

        overlay.querySelector('#_lb-close').addEventListener('click', function () { overlay.remove(); });

        if (total > 1) {
          overlay.querySelector('#_lb-prev').addEventListener('click', function () {
            current = (current - 1 + total) % total;
            render(current);
          });
          overlay.querySelector('#_lb-next').addEventListener('click', function () {
            current = (current + 1) % total;
            render(current);
          });
        }
      };

      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) overlay.remove();
      });

      overlay.addEventListener('keydown', function (e) {
        if (e.key === 'Escape')     { overlay.remove(); return; }
        if (e.key === 'ArrowRight') { current = (current + 1) % photos.length; render(current); }
        if (e.key === 'ArrowLeft')  { current = (current - 1 + photos.length) % photos.length; render(current); }
      });

      document.body.appendChild(overlay);
      overlay.setAttribute('tabindex', '0');
      overlay.focus();
      render(current);

    } catch (e) {
      console.error('[JobUI] openLightbox error:', e);
    }
  }

  function delRow(btn) {
    try {
      var row = btn.closest('tr');
      if (row) {
        var tbody = row.closest('tbody');
        row.remove();
        calcJob();
        if (tbody) {
          tbody.querySelectorAll('.part-row').forEach(function(r, i) {
            var numCell = r.querySelector('[data-row-num]');
            if (numCell) numCell.textContent = i + 1;
          });
        }
      }
    } catch (e) {
      console.error('[JobUI] delRow error:', e);
    }
  }
  function openJobModal(editId) {
    try {
      if (!_initialized || !_state) {
        if (typeof window.showToast === 'function') window.showToast('Job module initializing… please try again in a moment.', 'info', 2500);
        else console.warn('[JobUI] openJobModal called before init()');
        return;
      }
      const ea = editId ? _state.findJob(editId) : null;

      var mechanics = [];
      try {
        if (typeof window.getMechanics === 'function') mechanics = window.getMechanics() || [];
        else if (Array.isArray(window.mechanics)) mechanics = window.mechanics;
      } catch (e) { console.warn('[JobUI] openJobModal: failed to read mechanics list:', e); }
      var mecOptions = '<option value="">— Select —</option>' +
        mechanics.map(function (m) {
          var name = (m && m.name) ? m.name : String(m || '');
          var mid  = (m && m.id) ? m.id : '';
          return '<option value="' + _esc(name) + '" data-staff-id="' + _esc(mid) + '"' + (ea && ea.mec === name ? ' selected' : '') + '>' + _esc(name) + '</option>';
        }).join('');

      var LOCKED_EDIT_STATUSES = ['cancelled', 'delivered'];
      var statusLocked = !!(ea && LOCKED_EDIT_STATUSES.indexOf(ea.status) !== -1);
      var statusOptions = _state.VALID_STATUSES.map(function (s) {
        var labels = { pending:'Pending', 'in-progress':'In progress', 'waiting-parts':'Waiting — parts', completed:'Completed', delivered:'Delivered', cancelled:'Cancelled' };
        return '<option value="' + s + '"' + (ea ? (ea.status === s ? ' selected' : '') : (s === 'pending' ? ' selected' : '')) + '>' + (labels[s] || s) + '</option>';
      }).join('');

      var existingParts = (ea && ea.parts)
        ? ea.parts.map(function (p, i) {
            return '<tr class="part-row">' +
              '<td style="padding:4px 8px 4px 16px;color:var(--jm-muted);font-size:11px;width:24px" data-row-num>' + (i+1) + '</td>' +
              '<td style="padding:4px 6px;position:relative">' +
                '<input type="text" class="jm-fi jp-name" autocomplete="off" value="' + _esc(p.n||'') + '" placeholder="Search inventory..." style="width:100%">' +
                '<div class="jp-dropdown" style="display:none;position:absolute;left:0;right:0;top:100%;background:var(--jm-bg);border:0.5px solid var(--jm-border-md);border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:var(--zi-supreme,9999);max-height:200px;overflow-y:auto;margin-top:2px"></div>' +
                '<div class="jp-stock-badge" style="display:none"></div>' +
              '</td>' +
              '<td style="padding:4px 6px;width:58px"><input type="number" class="jm-fi jp-qty" value="' + (Number(p.q)||1) + '" min="1" style="text-align:center;width:100%"></td>' +
              '<td style="padding:4px 6px;width:90px"><input type="number" class="jm-fi jp-price" value="' + (Number(p.p)||0) + '" placeholder="0" style="text-align:right;width:100%"></td>' +
              '<td class="part-total" style="padding:4px 8px;width:90px;text-align:right;font-weight:500;color:var(--jm-blue);font-size:12px">' + _fmt((Number(p.q)||0)*(Number(p.p)||0)) + '</td>' +
              '<td style="padding:4px 8px;width:28px;text-align:center"><button class="del-btn jm-icon-btn" onclick="delRow(this)" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-3px"><use href="#ic-trash"/></svg></button></td>' +
            '</tr>';
          }).join('')
        : '';

      var existingLabourLines = (ea && Array.isArray(ea.labourLines) && ea.labourLines.length)
        ? ea.labourLines
        : (ea && (Number(ea.lab) > 0 || ea.ld)) ? [{ desc: ea.ld || 'Labour charges', mec: ea.mec || '', amt: ea.lab || 0 }] : [];

      var existingLabourRows = existingLabourLines.map(function (ll) {
        var rowMecOpts = '<option value="">— Select —</option>' +
          mechanics.map(function (m) {
            var name = (m && m.name) ? m.name : String(m || '');
            return '<option value="' + _esc(name) + '"' + (ll.mec === name ? ' selected' : '') + '>' + _esc(name) + '</option>';
          }).join('');
        return '<tr class="labour-row">' +
          '<td style="padding:4px 8px 4px 16px"><input type="text" class="jm-fi" placeholder="e.g. Engine repair" value="' + _esc(ll.desc||'') + '" style="width:100%"></td>' +
          '<td style="padding:4px 6px;width:150px"><select class="jm-fi" style="width:100%">' + rowMecOpts + '</select></td>' +
          '<td style="padding:4px 6px;width:100px"><input type="number" class="jm-fi" value="' + (Number(ll.amt)||0) + '" min="0" oninput="calcJob()" placeholder="0" style="text-align:right;width:100%"></td>' +
          '<td style="padding:4px 8px;width:28px;text-align:center"><button onclick="delLabourRow(this)" class="jm-icon-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-3px"><use href="#ic-trash"/></svg></button></td>' +
        '</tr>';
      }).join('');

      var _stale = document.getElementById('jobModal');
      if (_stale) {
        var _staleCarEl = _stale.querySelector('#j-car');
        if (_staleCarEl && _staleCarEl.value.trim() &&
            !window.confirm('A job form with unsaved data is already open — close it and open a new one?')) {
          return;
        }
        _stale.remove();
      }

      const overlay = document.createElement('div');
      overlay.id = 'jobModal';
      overlay.style.cssText = 'display:flex;position:fixed;inset:0;z-index:var(--zi-modal-bg,1000);background:rgba(0,0,0,.45);align-items:flex-start;justify-content:center;overflow-y:auto;padding:16px 0';

      overlay.innerHTML =
        '<style>' +
          '#jobModal .jm-lbl{font-size:10px;font-weight:600;color:var(--muted,#6b7280);text-transform:uppercase;letter-spacing:.45px;display:block;margin-bottom:3px}' +
          '#jobModal .jm-sec{font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.55px;padding:7px 16px;background:var(--hover,#f8f9fa);border-top:0.5px solid var(--border,#e5e7eb);border-bottom:0.5px solid var(--border,#e5e7eb);display:flex;align-items:center;gap:6px}' +
          '#jobModal table{border-collapse:collapse;width:100%}' +
          '#jobModal thead th{font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.45px;padding:7px 8px;text-align:left;border-bottom:0.5px solid #e5e7eb;background:var(--bg)}' +
          '#jobModal thead th:first-child{padding-left:16px}' +
          '#jobModal tbody td{border-bottom:0.5px solid #f3f4f6}' +
          '#jobModal .jm-icon-btn{border:none;background:none;cursor:pointer;color:#9ca3af;padding:2px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;transition:color .15s}' +
          '#jobModal .jm-icon-btn:hover{color:#ef4444}' +
          '@media(max-width:640px){#jobModal .jm-grid{grid-template-columns:1fr 1fr!important}}' +
        '</style>' +

        '<div style="background:var(--white,#fff);border-radius:10px;width:98vw;max-width:1100px;margin:auto;overflow:hidden;border:0.5px solid #e5e7eb">' +

          '<div style="background:#4338CA;padding:12px 16px;display:flex;align-items:center;justify-content:space-between">' +
            '<div style="display:flex;align-items:center;gap:10px">' +
              '<div style="width:32px;height:32px;border-radius:7px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:17px;height:17px;vertical-align:-3px;color:#fff"><use href="#ic-tool"/></svg>' +
              '</div>' +
              '<div>' +
                '<div style="color:#fff;font-size:14px;font-weight:600">' + (ea ? 'Edit repair job' : 'New repair job') + '</div>' +
                '<div style="color:rgba(255,255,255,.7);font-size:11px">' + (ea ? 'Job #' + _esc(ea.id||'') : 'Fill vehicle &amp; job details below') + '</div>' +
              '</div>' +
            '</div>' +
            '<button id="_job-close-btn" style="width:30px;height:30px;border-radius:7px;border:0.5px solid rgba(255,255,255,.3);background:rgba(255,255,255,.12);color:#fff;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;vertical-align:-2px"><use href="#ic-x"/></svg>' +
            '</button>' +
          '</div>' +

          '<div style="padding:12px 16px;border-bottom:0.5px solid #e5e7eb;display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:9px;align-items:end" class="jm-grid">' +
            '<div><label class="jm-lbl">Vehicle name <span style="color:#ef4444">*</span></label><input class="jm-fi" id="j-car" placeholder="Toyota Corolla 2019" value="' + _esc(ea?ea.car:'') + '"></div>' +
            '<div><label class="jm-lbl">Plate no. <span style="color:#ef4444">*</span></label><input class="jm-fi mono" id="j-plate" placeholder="ABC-123" value="' + _esc(ea?ea.plate:'') + '" style="text-transform:uppercase"></div>' +
            '<div><label class="jm-lbl">Engine no.</label><input class="jm-fi mono" id="j-eng" placeholder="Engine number" value="' + _esc(ea?ea.eng||'':'') + '"></div>' +
            '<div><label class="jm-lbl">Color</label><input class="jm-fi" id="j-col" placeholder="e.g. White" value="' + _esc(ea?ea.col||'':'') + '"></div>' +
            '<div><label class="jm-lbl">Customer name</label><input class="jm-fi" id="j-cust" placeholder="Customer name" value="' + _esc(ea?ea.cust||'':'') + '"></div>' +
            '<div><label class="jm-lbl">Phone</label><input class="jm-fi" id="j-ph" type="tel" placeholder="03XX-XXXXXXX" value="' + _esc(ea?ea.ph||'':'') + '"></div>' +
            '<div><label class="jm-lbl">Mechanic</label><select class="jm-fi" id="job-mechanic">' + mecOptions + '</select></div>' +
            '<div><label class="jm-lbl">Delivery date</label><input class="jm-fi" id="j-del" type="date" value="' + _esc(ea?ea.del||'':'') + '"></div>' +
            '<div><label class="jm-lbl">Status</label><select class="jm-fi" id="j-status"' + (statusLocked ? ' disabled' : '') + '>' + statusOptions + '</select></div>' +
            '<div style="grid-column:1/-1"><label class="jm-lbl">Problem / work description</label><textarea class="jm-fi" id="j-prob" rows="2" placeholder="Describe the issue or work required..." style="resize:vertical">' + _esc(ea?ea.prob||'':'') + '</textarea></div>' +
          '</div>' +

          '<div class="jm-sec"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-zap"/></svg> Parts &amp; items</div>' +
          '<div style="overflow-x:auto">' +
            '<table>' +
              '<thead><tr>' +
                '<th style="width:24px;padding-left:16px">#</th>' +
                '<th>Part name</th>' +
                '<th style="width:58px;text-align:center">Qty</th>' +
                '<th style="width:95px;text-align:right">Price (Rs.)</th>' +
                '<th style="width:95px;text-align:right">Amount</th>' +
                '<th style="width:28px"></th>' +
              '</tr></thead>' +
              '<tbody id="j-parts-body">' + existingParts + '</tbody>' +
            '</table>' +
            (!existingParts ? '<div id="j-parts-empty" style="padding:14px 16px;font-size:12px;color:#9ca3af">No parts added yet</div>' : '') +
          '</div>' +
          '<div style="padding:8px 16px;border-bottom:0.5px solid #e5e7eb">' +
            '<button type="button" onclick="addJobPart()" style="border:0.5px dashed #bfdbfe;background:#eff6ff;color:#4338CA;border-radius:6px;padding:5px 12px;font-size:11px;font-weight:600;cursor:pointer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;vertical-align:-3px"><use href="#ic-plus"/></svg> Add part</button>' +
          '</div>' +

          '<div class="jm-sec"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:-3px"><use href="#ic-cal"/></svg> Labour &amp; charges</div>' +
          '<div style="overflow-x:auto">' +
            '<table id="j-labour-table">' +
              '<thead><tr>' +
                '<th style="padding-left:16px">Description</th>' +
                '<th style="width:150px">Mechanic</th>' +
                '<th style="width:105px;text-align:right">Amount (Rs.)</th>' +
                '<th style="width:28px"></th>' +
              '</tr></thead>' +
              '<tbody id="j-labour-body">' + existingLabourRows + '</tbody>' +
            '</table>' +
            (!existingLabourRows ? '<div id="j-labour-empty" style="padding:14px 16px;font-size:12px;color:#a855f7;opacity:.8">No labour lines yet</div>' : '') +
          '</div>' +
          '<div style="padding:8px 16px;border-bottom:0.5px solid #e5e7eb">' +
            '<button type="button" onclick="addLabourRow()" style="border:0.5px dashed #d8b4fe;background:#fdf4ff;color:#7c3aed;border-radius:6px;padding:5px 12px;font-size:11px;font-weight:600;cursor:pointer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;vertical-align:-3px"><use href="#ic-plus"/></svg> Add labour</button>' +
          '</div>' +

          '<div style="padding:10px 16px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;border-bottom:0.5px solid #e5e7eb;background:var(--bg)">' +
            '<div style="display:flex;gap:20px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--muted,#64748b)">' +
              '<span>Parts: <strong id="jm-parts-sum" style="color:#111">Rs.0.00</strong></span>' +
              '<span>Labour: <strong id="jm-lab-sum" style="color:#111">Rs.0.00</strong></span>' +
              '<span>Discount:' +
                '<input type="number" id="j-dis" value="' + (ea?ea.dis||0:0) + '" min="0" oninput="calcJob()" style="width:80px;border:0.5px solid #d1d5db;border-radius:5px;padding:4px 6px;font-size:12px;text-align:right;margin-left:6px;outline:none;background:var(--white,#fff)">' +
                '<span style="margin-left:3px">Rs.</span>' +
              '</span>' +
            '</div>' +
            '<div style="font-size:15px;font-weight:600;color:#4338CA">Grand total:&nbsp;<input id="j-total" readonly style="width:110px;border:none;background:transparent;font-size:15px;font-weight:600;color:#4338CA;outline:none;text-align:left"></div>' +
          '</div>' +

          '<div style="padding:11px 16px;display:flex;justify-content:flex-end;gap:8px;background:var(--white,#fff)">' +
            '<button id="_job-cancel-btn" style="padding:8px 16px;border-radius:7px;border:0.5px solid #d1d5db;background:var(--white,#fff);color:#374151;font-weight:500;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:5px">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-3px"><use href="#ic-x"/></svg> Cancel' +
            '</button>' +
            '<button type="button" onclick="openJobTemplates()" style="padding:8px 14px;border-radius:7px;border:0.5px solid #d1d5db;background:var(--white,#fff);color:#374151;font-weight:500;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:5px">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-3px"><use href="#ic-report"/></svg> Templates' +
            '</button>' +
            '<button id="_job-save-btn" style="padding:8px 20px;border-radius:7px;border:none;background:#4338CA;color:#fff;font-weight:600;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;gap:5px">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-3px"><use href="#ic-dl"/></svg> Save job' +
            '</button>' +
          '</div>' +

        '</div>';

      document.body.appendChild(overlay);

      overlay.querySelector('#_job-close-btn').addEventListener('click',  function () { overlay.remove(); });
      overlay.querySelector('#_job-cancel-btn').addEventListener('click', function () { overlay.remove(); });
      overlay.querySelector('#_job-save-btn').addEventListener('click',   function () { saveJobFromModal(); });
      overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

      if (ea) {
        var jCarEl = overlay.querySelector('#j-car');
        if (jCarEl) jCarEl.dataset.editId = editId;
      }

      var tbodyEl = overlay.querySelector('#j-parts-body');
      if (tbodyEl && ea && ea.parts && ea.parts.length) {
        tbodyEl.querySelectorAll('tr.part-row').forEach(function (row) {
          var inputs = row.querySelectorAll('input');
          if (inputs[0] && !inputs[0].classList.contains('jp-name')) inputs[0].classList.add('jp-name');
          if (inputs[1] && !inputs[1].classList.contains('jp-qty'))  inputs[1].classList.add('jp-qty');
          if (inputs[2] && !inputs[2].classList.contains('jp-price')) inputs[2].classList.add('jp-price');
          var nameTd = inputs[0] ? inputs[0].closest('td') : null;
          if (nameTd) {
            if (!nameTd.querySelector('.jp-dropdown')) {
              var dd = document.createElement('div'); dd.className = 'jp-dropdown';
              dd.style.cssText = 'display:none;position:absolute;left:0;right:0;top:100%;background:var(--white,#fff);border:0.5px solid var(--border,#d1d5db);border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:var(--zi-supreme,9999);max-height:200px;overflow-y:auto;margin-top:2px';
              nameTd.style.position = 'relative'; nameTd.appendChild(dd);
            }
            if (!nameTd.querySelector('.jp-stock-badge')) {
              var badge = document.createElement('div'); badge.className = 'jp-stock-badge'; badge.style.display = 'none'; nameTd.appendChild(badge);
            }
          }
          _attachPartRowHandlers(row);
        });
      }

      setTimeout(function () {
        calcJob();
        if (tbodyEl) {
          tbodyEl.querySelectorAll('tr.part-row').forEach(function (row) {
            var ni = row.querySelector('.jp-name');
            if (ni && ni.value) ni.dispatchEvent(new Event('change', { bubbles: false }));
          });
        }
        _attachVehicleAutocomplete(overlay);
        _attachCustomerAutocomplete(overlay);
        var firstEl = overlay.querySelector('#j-car');
        if (firstEl && !firstEl.value) firstEl.focus();
      }, 60);

    } catch (e) {
      console.error('[JobUI] openJobModal error:', e);
    }
  }

  function _attachVehicleAutocomplete(overlay) {
    var carInput   = overlay.querySelector('#j-car');
    var plateInput = overlay.querySelector('#j-plate');
    if (!carInput) return;

    function _getVehicles() {
      try {
        if (window.VehicleState && typeof window.VehicleState.getVehicles === 'function')
          return window.VehicleState.getVehicles() || [];
      } catch (e) { console.warn('[JobUI] _attachVehicleAutocomplete: failed to read vehicles:', e); }
      return [];
    }

    function _makeDropdown(anchor) {
      var dd = document.createElement('div');
      dd.className = 'jm-ac-dd';
      dd.style.cssText = [
        'display:none;position:absolute;left:0;right:0;top:calc(100% + 2px);min-width:260px',
        'background:#fff;border:1px solid #d1d5db;border-radius:8px',
        'box-shadow:0 8px 24px rgba(0,0,0,.13);z-index:var(--zi-supreme,9999)',
        'max-height:220px;overflow-y:auto;font-size:12px'
      ].join(';');
      var wrap = anchor.parentElement;
      if (wrap) { wrap.style.position = 'relative'; wrap.appendChild(dd); }
      return dd;
    }

    var dd = _makeDropdown(carInput);
    var _vMatches = [];
    var _vSelectedIdx = -1;

    function _vHighlight() {
      dd.querySelectorAll('.jm-ac-item').forEach(function (item, i) {
        item.style.background = (i === _vSelectedIdx) ? '#eff6ff' : '';
      });
    }

    function _show(list, onSelect) {
      _vMatches = list;
      _vSelectedIdx = -1;
      if (!list.length) { dd.style.display = 'none'; return; }
      dd.innerHTML = list.map(function (v, i) {
        return '<div class="jm-ac-item" data-idx="' + i + '" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #f3f4f6;display:flex;flex-direction:column;gap:2px">' +
          '<span style="font-weight:600;color:var(--text,#1e293b)">' + _esc(v.model || v.make || v.car || '') + '</span>' +
          '<span style="color:var(--muted,#64748b);font-size:11px">' + _esc(v.plate || '') +
            (v.color || v.col ? ' · ' + _esc(v.color || v.col) : '') + '</span>' +
          '</div>';
      }).join('');
      dd.style.display = 'block';
      dd.querySelectorAll('.jm-ac-item').forEach(function (item) {
        item.addEventListener('mousedown', function (e) {
          e.preventDefault();
          onSelect(list[parseInt(item.getAttribute('data-idx'), 10)]);
          dd.style.display = 'none';
          _vSelectedIdx = -1;
        });
      });
    }

    function _applyVehicle(v) {
      if (!v) return;
      carInput.value = v.model || v.make || v.car || '';
      var plateEl = overlay.querySelector('#j-plate');
      var engEl   = overlay.querySelector('#j-eng');
      var colEl   = overlay.querySelector('#j-col');
      if (plateEl && v.plate) plateEl.value = v.plate.toUpperCase();
      if (engEl   && v.eng)   engEl.value   = v.eng;
      if (colEl   && (v.color || v.col)) colEl.value = v.color || v.col;
      var _ownerName = v.custName || v.owner || v.cust || v.customer || v.ownerName || '';
      var _ownerPhone = v.custPhone || v.phone || v.ownerPhone || v.ph || '';
      if (_ownerName) {
        var custEl = overlay.querySelector('#j-cust');
        var phEl   = overlay.querySelector('#j-ph');
        if (custEl && !custEl.value) custEl.value = _ownerName;
        if (phEl   && !phEl.value  && _ownerPhone) phEl.value = _ownerPhone;
      }
      dd.style.display = 'none';
      _vSelectedIdx = -1;
    }

    carInput.addEventListener('input', function () {
      var q  = (carInput.value || '').toLowerCase().trim();
      if (!q) { dd.style.display = 'none'; return; }
      var vehicles = _getVehicles();
      var matches = vehicles.filter(function (v) {
        return (v.model || v.make || v.car || '').toLowerCase().indexOf(q) !== -1 ||
               (v.plate || '').toLowerCase().indexOf(q) !== -1;
      }).slice(0, 8);
      _show(matches, _applyVehicle);
    });

    carInput.addEventListener('keydown', function (e) {
      if (dd.style.display === 'none' || !_vMatches.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        _vSelectedIdx = Math.min(_vSelectedIdx + 1, _vMatches.length - 1);
        _vHighlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _vSelectedIdx = Math.max(_vSelectedIdx - 1, 0);
        _vHighlight();
      } else if (e.key === 'Enter') {
        if (_vSelectedIdx >= 0) {
          e.preventDefault();
          _applyVehicle(_vMatches[_vSelectedIdx]);
        }
      } else if (e.key === 'Escape') {
        dd.style.display = 'none';
        _vSelectedIdx = -1;
      }
    });

    if (plateInput) {
      plateInput.addEventListener('input', function () {
        var q = (plateInput.value || '').toLowerCase().trim();
        if (!q) return;
        var vehicles = _getVehicles();
        var match = vehicles.find(function (v) {
          return (v.plate || '').toLowerCase() === q;
        });
        if (match) {
          carInput.value = match.model || match.make || match.car || carInput.value;
          var engEl = overlay.querySelector('#j-eng');
          var colEl = overlay.querySelector('#j-col');
          if (engEl && match.eng)                 engEl.value = match.eng;
          if (colEl && (match.color || match.col)) colEl.value = match.color || match.col;
        }
      });
    }

    carInput.addEventListener('blur', function () {
      setTimeout(function () { dd.style.display = 'none'; }, 200);
    });
  }

  function _attachCustomerAutocomplete(overlay) {
    var custInput = overlay.querySelector('#j-cust');
    if (!custInput) return;

    function _getCustomers() {
      try {
        if (window.ERP && window.ERP._internal) {
          var _st = window.ERP._internal.getState();
          if (_st && _st.data && Array.isArray(_st.data.customers)) return _st.data.customers;
        }
      } catch (e) { console.warn('[JobUI] _attachCustomerAutocomplete: failed to read customers:', e); }
      return [];
    }

    var dd = document.createElement('div');
    dd.className = 'jm-ac-dd';
    dd.style.cssText = [
      'display:none;position:absolute;left:0;right:0;top:calc(100% + 2px)',
      'background:#fff;border:1px solid #d1d5db;border-radius:8px',
      'box-shadow:0 8px 24px rgba(0,0,0,.13);z-index:var(--zi-supreme,9999)',
      'max-height:200px;overflow-y:auto;font-size:12px'
    ].join(';');
    var wrap = custInput.parentElement;
    if (wrap) { wrap.style.position = 'relative'; wrap.appendChild(dd); }

    var _acMatches = [];
    var _acSelectedIdx = -1;

    function _acHighlight() {
      dd.querySelectorAll('.jm-ac-item').forEach(function (item, i) {
        item.style.background = (i === _acSelectedIdx) ? '#eff6ff' : '';
      });
    }

    function _acApply(cust) {
      if (!cust) return;
      custInput.value = cust.n || '';
      var phEl = overlay.querySelector('#j-ph');
      if (phEl && cust.ph) phEl.value = cust.ph;
      dd.style.display = 'none';
      _acSelectedIdx = -1;
    }

    custInput.addEventListener('input', function () {
      var q = (custInput.value || '').toLowerCase().trim();
      _acSelectedIdx = -1;
      if (!q) { dd.style.display = 'none'; _acMatches = []; return; }
      _acMatches = _getCustomers().filter(function (c) {
        return (c.n || '').toLowerCase().indexOf(q) !== -1 ||
               (c.ph || '').indexOf(q) !== -1;
      }).slice(0, 8);

      if (!_acMatches.length) { dd.style.display = 'none'; return; }
      dd.innerHTML = _acMatches.map(function (c, i) {
        return '<div class="jm-ac-item" data-idx="' + i + '" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #f3f4f6;display:flex;flex-direction:column;gap:2px">' +
          '<span style="font-weight:600;color:var(--text,#1e293b)">' + _esc(c.n || '') + '</span>' +
          (c.ph ? '<span style="color:var(--muted,#64748b);font-size:11px">📞 ' + _esc(c.ph) + '</span>' : '') +
          '</div>';
      }).join('');
      dd.style.display = 'block';
      dd.querySelectorAll('.jm-ac-item').forEach(function (item) {
        item.addEventListener('mousedown', function (e) {
          e.preventDefault();
          _acApply(_acMatches[parseInt(item.getAttribute('data-idx'), 10)]);
        });
      });
    });

    custInput.addEventListener('keydown', function (e) {
      if (dd.style.display === 'none' || !_acMatches.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        _acSelectedIdx = Math.min(_acSelectedIdx + 1, _acMatches.length - 1);
        _acHighlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _acSelectedIdx = Math.max(_acSelectedIdx - 1, 0);
        _acHighlight();
      } else if (e.key === 'Enter') {
        if (_acSelectedIdx >= 0) {
          e.preventDefault();
          _acApply(_acMatches[_acSelectedIdx]);
        }
      } else if (e.key === 'Escape') {
        dd.style.display = 'none';
        _acSelectedIdx = -1;
      }
    });

    custInput.addEventListener('blur', function () {
      setTimeout(function () { dd.style.display = 'none'; _acSelectedIdx = -1; }, 200);
    });
  }
  function saveJobFromModal() {
    const modalEl = document.getElementById('jobModal');
    if (!modalEl || !modalEl.querySelector('#j-car')) {
      console.warn('[JobUI] saveJobFromModal: modal is not open');
      return;
    }
    _service.saveJob();
  }

  function _uiToast(msg, type) {
    try {
      if (window.ERP && window.ERP.ui && window.ERP.ui.toast) window.ERP.ui.toast(msg, type || 'error');
      else if (window.ToastManager && window.ToastManager.show) window.ToastManager.show(type || 'error', msg);
      else console.warn('[JobUI]', msg);
    } catch (e) { console.warn('[JobUI] _uiToast failed:', e); }
  }

  function editCurJob() {
    const curJob = _state.getCurJob();
    if (!curJob) { _uiToast('Edit karne ke liye pehle job select karein', 'error'); return; }
    openJobModal(curJob.id);
  }

  function editJobById(id) {
    const job = _state.findJob(id);
    if (!job) { _uiToast('Job nahi mila — page reload karein', 'error'); return; }
    openJobModal(id);
  }

  function calcJob() {
    try {
      var tbodyEl = _el('j-parts-body');
      if (!tbodyEl) {
        var t = _el('j-parts');
        if (t) tbodyEl = t.tagName === 'TBODY' ? t : (t.querySelector('tbody') || t);
      }

      let partsTotal = 0;

      if (tbodyEl) {
        var allRows = tbodyEl.tagName === 'TBODY'
          ? tbodyEl.querySelectorAll('tr')
          : tbodyEl.querySelectorAll('tbody tr');

        allRows.forEach(function (row) {
          if (row.parentElement && row.parentElement.tagName === 'THEAD') return;
          var qtyInput   = row.querySelector('input.jp-qty');
          var priceInput = row.querySelector('input.jp-price');
          if (!qtyInput || !priceInput) return;
          var qRaw = parseInt(qtyInput.value, 10);
          var q = isNaN(qRaw) ? 0 : Math.max(0, qRaw);
          var p = parseFloat(priceInput.value) || 0;
          var rowTotal = q * p;
          var totalCell = row.querySelector('.part-total') || row.querySelector('td:nth-child(4)');
          if (totalCell) totalCell.textContent = _fmt(rowTotal);
          partsTotal += rowTotal;
        });
      }

      const partsSumEl = _el('jm-parts-sum');
      if (partsSumEl) partsSumEl.textContent = _fmt(partsTotal);

      const disEl   = _el('j-dis');
      const totalEl = _el('j-total');

      var labourTotal = 0;
      var labourRows = document.querySelectorAll('#j-labour-body tr.labour-row');
      labourRows.forEach(function (lr) {
        var amtInput = lr.querySelector('input[type="number"]');
        labourTotal += parseFloat(amtInput ? amtInput.value : '0') || 0;
      });
      if (labourRows.length === 0) {
        var legacyLab = _el('j-lab');
        labourTotal = parseFloat(legacyLab ? legacyLab.value : '0') || 0;
      }

      const labSumEl = _el('jm-lab-sum');
      if (labSumEl) labSumEl.textContent = _fmt(labourTotal);

      const dis = parseFloat(disEl ? disEl.value : '0') || 0;
      const grand = Math.max(0, partsTotal + labourTotal - dis);

      if (totalEl) totalEl.value = _fmt(grand);
    } catch (e) {
      console.error('[JobUI] calcJob error:', e);
    }
  }

  function _buildLabourRowMecOptions(selectedName) {
    var mechanics = [];
    try {
      if (typeof window.getMechanics === 'function') mechanics = window.getMechanics() || [];
      else if (Array.isArray(window.mechanics)) mechanics = window.mechanics;
    } catch (e) { console.warn('[JobUI] _buildLabourRowMecOptions: failed to read mechanics list:', e); }
    return mechanics.map(function (m) {
      var name = (m && m.name) ? m.name : String(m || '');
      var sel  = (selectedName && selectedName.trim().toLowerCase() === name.trim().toLowerCase()) ? ' selected' : '';
      return '<option value="' + _esc(name) + '"' + sel + '>' + _esc(name) + '</option>';
    }).join('');
  }

  function addLabourRow() {
    try {
      var tbody = document.getElementById('j-labour-body');
      if (!tbody) return;
      var emptyDiv = document.getElementById('j-labour-empty');
      if (emptyDiv) emptyDiv.remove();

      var tr = document.createElement('tr');
      tr.className = 'labour-row';
      tr.style.borderBottom = '1px solid #f3e8ff';
      tr.innerHTML =
        '<td style="padding:6px 8px">' +
          '<input type="text" class="fi" placeholder="e.g. Electrical work" style="width:100%">' +
        '</td>' +
        '<td style="padding:6px 8px">' +
          '<select class="fi" style="width:100%">' + _buildLabourRowMecOptions('') + '</select>' +
        '</td>' +
        '<td style="padding:6px 8px">' +
          '<input type="number" class="fi" value="0" min="0" oninput="calcJob()" onchange="calcJob()" placeholder="0" style="width:100%;text-align:right">' +
        '</td>' +
        '<td style="padding:6px 4px;text-align:center">' +
          '<button onclick="delLabourRow(this)" style="width:26px;height:26px;border-radius:6px;border:none;background:#fee2e2;color:#dc2626;cursor:pointer;font-size:14px;display:inline-flex;align-items:center;justify-content:center">✕</button>' +
        '</td>';
      tbody.appendChild(tr);
      tr.querySelector('input[type="text"]').focus();
    } catch (e) {
      console.error('[JobUI] addLabourRow error:', e);
    }
  }

  function delLabourRow(btn) {
    try {
      var row = btn.closest('tr');
      if (row) {
        row.remove();
        calcJob();
      }
      var tbody = document.getElementById('j-labour-body');
      if (tbody && tbody.querySelectorAll('tr').length === 0) {
        var table = document.getElementById('j-labour-table');
        if (table) {
          var hint = document.createElement('div');
          hint.id = 'j-labour-empty';
          hint.style.cssText = 'padding:20px;text-align:center;color:#a855f7;font-size:13px;opacity:.7';
          hint.innerHTML = 'No labour lines yet. Click <strong>＋ Add Labour</strong> above.';
          table.parentNode.insertBefore(hint, table.nextSibling);
        }
      }
    } catch (e) {
      console.error('[JobUI] delLabourRow error:', e);
    }
  }

  function _getInventoryList() {
    try {
      if (window.ERP && window.ERP._internal) {
        var _st = window.ERP._internal.getState();
        if (_st && _st.data && Array.isArray(_st.data.inventory)) return _st.data.inventory;
      }
      if (window.ERP && window.ERP.state && window.ERP.state.selectors)
        return window.ERP.state.selectors.inventory() || [];
    } catch (e) { console.warn('[JobUI] _getInventoryList: failed to read inventory:', e); }
    return [];
  }

  function _findInvItem(name) {
    return _getInventoryList().find(function (p) {
      return (p.n || '').toLowerCase() === (name || '').trim().toLowerCase();
    }) || null;
  }

  function _attachPartRowHandlers(tr) {
    var nameInput  = tr.querySelector('.jp-name');
    var qtyInput   = tr.querySelector('.jp-qty');
    var priceInput = tr.querySelector('.jp-price');
    var stockBadge = tr.querySelector('.jp-stock-badge');
    var dropdown   = tr.querySelector('.jp-dropdown');

    if (!nameInput || !qtyInput || !priceInput || !stockBadge || !dropdown) return;

    function _triggerCalc() { try { if (typeof calcJob === 'function') calcJob(); } catch (e) { console.warn('[JobUI] _triggerCalc failed:', e); } }

    function _refreshBadge() {
      var item  = _findInvItem(nameInput.value);
      if (!item) { stockBadge.style.display = 'none'; return; }
      var avail = Number(item.st) || 0;
      var qRaw  = parseInt(qtyInput.value, 10);
      var need  = isNaN(qRaw) ? 1 : Math.max(0, qRaw);
      var ok    = avail >= need;
      stockBadge.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-size:11px;' +
        'padding:3px 10px;border-radius:10px;margin-top:4px;font-weight:700;border:1px solid;' +
        (ok
          ? 'background:#dcfce7;color:#15803d;border-color:#bbf7d0'
          : 'background:#fee2e2;color:#dc2626;border-color:#fca5a5');
      stockBadge.textContent = ok
        ? '✓ Stock available: ' + avail
        : '✗ Stock: ' + avail + (need > 1 ? ' — Need: ' + need : ' — Out of stock');
    }

    function _applyItem(item) {
      if (item && !parseFloat(priceInput.value)) {
        priceInput.value = item.sp || item.pp || 0;
      }
      qtyInput.disabled   = false;
      priceInput.disabled = false;
      nameInput.style.borderColor = '';
      nameInput.dataset.stockBlocked = 'false';
      _refreshBadge();
      _triggerCalc();
    }

    function _showToastSafe(msg, type) {
      try {
        if (window.ERP && window.ERP.ui && window.ERP.ui.toast) window.ERP.ui.toast(msg, type);
        else if (window.ToastManager && window.ToastManager.show) window.ToastManager.show(type, msg);
      } catch (e) { console.warn('[JobUI] _showToastSafe failed:', e); }
      nameInput.value  = '';
      nameInput.style.borderColor = '';
      nameInput.title  = '';
      nameInput.dataset.stockBlocked = 'false';
      priceInput.value = '0';
      qtyInput.disabled   = false;
      priceInput.disabled = false;
      stockBadge.style.display = 'none';
      _triggerCalc();
    }

    function _showBlockedBadge(msg) {
      stockBadge.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-size:11px;' +
        'padding:3px 10px;border-radius:10px;margin-top:4px;font-weight:700;border:1px solid;' +
        'background:#fee2e2;color:#dc2626;border-color:#fca5a5';
      stockBadge.textContent = msg;
      nameInput.style.borderColor = '#ef4444';
      nameInput.dataset.stockBlocked = 'true';
    }

    function _showDropdown(q) {
      var inv    = _getInventoryList();
      var filter = (q || '').trim().toLowerCase();
      var matches = filter
        ? inv.filter(function (p) { return (p.n || '').toLowerCase().indexOf(filter) !== -1; })
        : inv.slice(0, 15);
      if (!matches.length) { dropdown.style.display = 'none'; return; }
      dropdown.innerHTML = matches.slice(0, 15).map(function (p) {
        var avail    = Number(p.st) || 0;
        var outStock = avail <= 0;
        return '<div class="jp-dd-item" ' +
          'data-name="'     + _esc(p.n||'') + '" ' +
          'data-price="'    + (p.sp || p.pp || 0) + '" ' +
          'data-stock="'    + avail + '" ' +
          'data-outstock="' + (outStock ? '1' : '0') + '" ' +
          'style="padding:8px 10px;cursor:' + (outStock ? 'not-allowed' : 'pointer') + ';' +
          'display:flex;justify-content:space-between;align-items:center;' +
          'border-bottom:1px solid #f1f5f9;font-size:13px;' +
          (outStock ? 'opacity:0.6;background:#fafafa;' : '') + '">' +
          '<span style="font-weight:500">' + _esc(p.n||'') + '</span>' +
          '<span style="display:flex;gap:8px;align-items:center">' +
            (outStock
              ? '<span style="font-size:11px;font-weight:700;padding:2px 7px;border-radius:8px;' +
                'background:#fee2e2;color:#dc2626;border:1px solid #fca5a5">' +
                '🚫 Out of Stock — Purchase karein</span>'
              : '<span style="color:#4338CA;font-weight:600">Rs ' + Number(p.sp||p.pp||0).toLocaleString() + '</span>' +
                '<span style="font-size:11px;font-weight:700;padding:2px 7px;border-radius:8px;' +
                'background:#dcfce7;color:#15803d;border:1px solid #bbf7d0">Stock: ' + avail + '</span>') +
          '</span></div>';
      }).join('');
      var rect = nameInput.getBoundingClientRect();
      dropdown.style.cssText = (
        'display:block;position:fixed;' +
        'left:' + rect.left + 'px;' +
        'top:'  + (rect.bottom + 2) + 'px;' +
        'width:' + rect.width + 'px;' +
        'background:#fff;border:1px solid #cbd5e1;border-radius:6px;' +
        'box-shadow:0 6px 20px rgba(0,0,0,.15);z-index:var(--zi-supreme,9999);' +
        'max-height:220px;overflow-y:auto;'
      );
    }

    dropdown.addEventListener('mousedown', function (e) {
      var ddItem = e.target.closest('.jp-dd-item');
      if (!ddItem) return;
      e.preventDefault();
      var outStock = ddItem.getAttribute('data-outstock') === '1';
      if (outStock) {
        _showToastSafe('🚫 "' + ddItem.getAttribute('data-name') + '" out of stock hai — pehle Purchase section se stock mangwayein', 'error');
        return;
      }
      nameInput.value  = ddItem.getAttribute('data-name');
      priceInput.value = ddItem.getAttribute('data-price') || 0;
      dropdown.style.display = 'none';
      nameInput.style.borderColor = '';
      _applyItem(_findInvItem(nameInput.value));
      qtyInput.focus();
    });

    dropdown.addEventListener('mouseover', function (e) {
      var it = e.target.closest('.jp-dd-item');
      if (it && it.getAttribute('data-outstock') !== '1') it.style.background = '#eff6ff';
    });
    dropdown.addEventListener('mouseout', function (e) {
      var it = e.target.closest('.jp-dd-item');
      if (it && it.getAttribute('data-outstock') !== '1') it.style.background = '';
    });

    nameInput.addEventListener('focus', function () { _showDropdown(nameInput.value); });
    nameInput.addEventListener('input', function () {
      nameInput.style.borderColor = '';
      _showDropdown(nameInput.value);
      var m = _findInvItem(nameInput.value);
      if (m) _applyItem(m); else { stockBadge.style.display = 'none'; _triggerCalc(); }
    });
    nameInput.addEventListener('change', function () {
      var m = _findInvItem(nameInput.value);
      if (m) _applyItem(m); else _triggerCalc();
    });
    nameInput.addEventListener('blur', function () {
      setTimeout(function () { dropdown.style.display = 'none'; }, 160);
      var typed = (nameInput.value || '').trim();
      if (!typed) return;
      var m   = _findInvItem(typed);
      var inv = _getInventoryList();
      var _invModuleLoaded = !!(window.ERP && window.ERP.state && window.ERP.state.selectors);
      if (!m && inv.length > 0) {
        _showBlockedBadge('🚫 Inventory mein nahi — pehle Purchase karein');
        qtyInput.value   = '';
        priceInput.value = '';
        qtyInput.disabled   = true;
        priceInput.disabled = true;
        _triggerCalc();
      } else if (!m && _invModuleLoaded && inv.length === 0) {
        _showBlockedBadge('\u26a0\ufe0f Inventory mein koi item nahi \u2014 pehle Purchase section se stock mangwayein');
        qtyInput.value   = '';
        priceInput.value = '';
        qtyInput.disabled   = true;
        priceInput.disabled = true;
        _triggerCalc();
      } else if (!m) {
        qtyInput.disabled   = false;
        priceInput.disabled = false;
        nameInput.style.borderColor = '';
        nameInput.dataset.stockBlocked = 'false';
        stockBadge.style.display = 'none';
        _triggerCalc();
      } else if ((Number(m.st) || 0) <= 0) {
        _showBlockedBadge('🚫 Out of stock — Purchase section se stock mangwayein');
        qtyInput.value   = '';
        priceInput.value = '';
        qtyInput.disabled   = true;
        priceInput.disabled = true;
        _triggerCalc();
      } else {
        qtyInput.disabled   = false;
        priceInput.disabled = false;
        nameInput.style.borderColor = '';
        _applyItem(m);
      }
    });

    qtyInput.addEventListener('input',  function () { _refreshBadge(); _triggerCalc(); });
    qtyInput.addEventListener('change', function () { _refreshBadge(); _triggerCalc(); });

    priceInput.addEventListener('input',  _triggerCalc);
    priceInput.addEventListener('change', _triggerCalc);

    function _onScroll() { dropdown.style.display = 'none'; }
    var _modalOverlay = document.getElementById('jobModal');
    if (_modalOverlay) _modalOverlay.addEventListener('scroll', _onScroll, { passive: true });
    _wireGlobalDropdownCloser();

    function _cleanup() {
      if (_modalOverlay) _modalOverlay.removeEventListener('scroll', _onScroll);
    }
    if (!tr._scrollCleanupRegistered) {
      tr._scrollCleanupRegistered = true;
      var _origRemove = tr.remove.bind(tr);
      tr.remove = function () { _cleanup(); _origRemove(); };
    }
  }

  function addJobPart() {
    try {
      var tbody = _el('j-parts-body') ||
                  (function () {
                    var t = _el('j-parts');
                    if (!t) return null;
                    return t.tagName === 'TBODY' ? t : (t.querySelector('tbody') || t);
                  }());
      if (!tbody) return;

      var emptyDiv = document.getElementById('j-parts-empty');
      if (emptyDiv) emptyDiv.remove();

      var tr = document.createElement('tr');
      tr.className = 'part-row';
      tr.innerHTML =
        '<td class="mono" style="padding:6px 8px;width:24px;padding-left:16px;color:#9ca3af;font-size:11px" data-row-num></td>' +
        '<td style="padding:4px;position:relative">' +
          '<input type="text" class="fi jp-name" autocomplete="off" ' +
            'placeholder="\uD83D\uDD0D Type part name to search inventory..." ' +
            'style="width:100%">' +
          '<div class="jp-dropdown" style="display:none;position:absolute;left:0;right:0;top:100%;' +
            'background:#fff;border:1px solid #cbd5e1;border-radius:6px;' +
            'box-shadow:0 6px 20px rgba(0,0,0,.13);z-index:var(--zi-dropdown,400);' +
            'max-height:220px;overflow-y:auto;margin-top:2px"></div>' +
          '<div class="jp-stock-badge" style="display:none"></div>' +
        '</td>' +
        '<td style="padding:4px;width:70px">' +
          '<input type="number" class="fi jp-qty" value="1" min="1" style="text-align:center;width:100%">' +
        '</td>' +
        '<td style="padding:4px;width:110px">' +
          '<input type="number" class="fi jp-price" value="0" placeholder="0" style="width:100%">' +
        '</td>' +
        '<td class="mono part-total" style="padding:6px 8px;width:100px;color:var(--primary,#4338CA);font-weight:600">\u20A80</td>' +
        '<td style="padding:4px;width:40px;text-align:center">' +
          '<button class="del-btn" onclick="delRow(this)" title="Remove part" ' +
            'style="width:28px;height:28px;border-radius:6px;border:none;background:#fee2e2;' +
            'color:#dc2626;cursor:pointer;font-size:15px;display:inline-flex;' +
            'align-items:center;justify-content:center">\u2715</button>' +
        '</td>';

      tbody.appendChild(tr);
      _attachPartRowHandlers(tr);

      var allRows = tbody.querySelectorAll('.part-row');
      allRows.forEach(function(r, i) {
        var numCell = r.querySelector('[data-row-num]');
        if (numCell) numCell.textContent = i + 1;
      });

      var inp = tr.querySelector('.jp-name');
      if (inp) inp.focus();
    } catch (e) {
      console.error('[JobUI] addJobPart error:', e);
    }
  }

  function populateJobForm(appt) {
    if (!appt) return;
    const fields = [
      ['j-car',   appt.vehicle || ''],
      ['j-plate', (appt.plate  || '').toUpperCase()],
      ['j-cust',  appt.cust    || ''],
      ['j-ph',    appt.phone   || appt.ph || ''],
      ['j-prob',  appt.service || ''],
    ];

    const hasExistingData = fields.some(function (pair) {
      const el = document.getElementById(pair[0]);
      return el && el.value.trim();
    });
    if (hasExistingData && !window.confirm('The form already has data — overwrite it with the appointment?')) {
      return;
    }

    fields.forEach(function (pair) {
      const el = document.getElementById(pair[0]);
      if (el) el.value = pair[1];
    });

    const mecEl = document.getElementById('job-mechanic');
    if (mecEl && appt.mechanic) {
      const wanted  = String(appt.mechanic).trim().toLowerCase();
      const matched = Array.prototype.find.call(mecEl.options, function (opt) {
        return opt.value.trim().toLowerCase() === wanted;
      });
      if (matched) mecEl.value = matched.value;
      else console.warn('[JobUI] populateJobForm: mechanic "' + appt.mechanic + '" not found in dropdown');
    }
  }

  function addInternalNote() {
    var _ov = document.createElement('div');
    _ov.className = 'modal-overlay open';
    _ov.innerHTML =
      '<div class="modal" style="max-width:360px;padding:20px">' +
        '<h3 style="margin:0 0 12px;font-size:14px">Internal Note</h3>' +
        '<textarea id="_note_ta" class="fi" rows="4" placeholder="Note likhein..." style="width:100%;resize:vertical;margin-bottom:12px"></textarea>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end">' +
          '<button class="btn" id="_note_cancel">Cancel</button>' +
          '<button class="btn btn-primary" id="_note_save">Save</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(_ov);
    setTimeout(function(){ var t=document.getElementById('_note_ta'); if(t) t.focus(); }, 50);
    var _noteCancelBtn = document.getElementById('_note_cancel');
    var _noteSaveBtn   = document.getElementById('_note_save');
    if (_noteCancelBtn) {
      _noteCancelBtn.addEventListener('click', function(){ if (_ov.parentNode) document.body.removeChild(_ov); });
    }
    if (_noteSaveBtn) {
      _noteSaveBtn.addEventListener('click', function(){
        var taEl = document.getElementById('_note_ta');
        var text = (taEl && taEl.value || '').trim();
        if (_ov.parentNode) document.body.removeChild(_ov);
        if (!text) return;
        _service.addInternalNote(text);
      });
    }
    _ov.addEventListener('click', function(e){ if (e.target === _ov && _ov.parentNode) document.body.removeChild(_ov); });
  }

  function addLabourLineFromDetail() {
    var _ov = document.createElement('div');
    _ov.className = 'modal-overlay open';
    _ov.innerHTML =
      '<div class="modal" style="max-width:380px;padding:20px">' +
        '<h3 style="margin:0 0 14px;font-size:14px">Add Labour Line</h3>' +
        '<label style="font-size:12px;font-weight:600">Description</label>' +
        '<input id="_ll_desc" class="fi" placeholder="e.g. Engine overhaul" style="margin:4px 0 10px;width:100%">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">' +
          '<div><label style="font-size:12px;font-weight:600">Hours</label><input id="_ll_hrs" class="fi" type="number" step="0.5" min="0" value="1" style="margin-top:4px;width:100%"></div>' +
          '<div><label style="font-size:12px;font-weight:600">Rate/hr (&#8360;)</label><input id="_ll_rate" class="fi" type="number" min="0" value="0" style="margin-top:4px;width:100%"></div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end">' +
          '<button class="btn" id="_ll_cancel">Cancel</button>' +
          '<button class="btn btn-primary" id="_ll_save">Add</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(_ov);
    setTimeout(function(){ var d=document.getElementById('_ll_desc'); if(d) d.focus(); }, 50);
    var _llCancelBtn = document.getElementById('_ll_cancel');
    var _llSaveBtn   = document.getElementById('_ll_save');
    if (_llCancelBtn) {
      _llCancelBtn.addEventListener('click', function(){ _ov.remove(); });
    }
    if (_llSaveBtn) {
      _llSaveBtn.addEventListener('click', function(){
        var descEl = document.getElementById('_ll_desc');
        var hrsEl  = document.getElementById('_ll_hrs');
        var rateEl = document.getElementById('_ll_rate');
        var desc = ((descEl && descEl.value) || '').trim();
        if (!desc) return;
        var hrs  = parseFloat((hrsEl  && hrsEl.value)  || '1') || 1;
        var rate = parseFloat((rateEl && rateEl.value) || '0') || 0;
        var amt = Math.round(hrs * rate);
        _service.addLabourLine({ desc: desc, mec: '', amt: amt });
        _ov.remove();
      });
    }
  }

  function toggleBulkMode() {
    _state.toggleBulkMode();
    _renderJobsPreservingFilter();
  }

  function toggleBulkSelect(id) {
    _state.toggleBulkItem(id);
    _renderJobsPreservingFilter();
  }

  function clearBulkSelection() {
    _state.clearBulk();
    _renderJobsPreservingFilter();
  }

  function bulkUpdateStatus(status) {
    _service.bulkUpdateStatus(status);
    clearBulkSelection();
  }

  function bulkDeleteJobs() {
    _service.bulkDeleteJobs();
    clearBulkSelection();
  }

  function uploadPartImage(btn) {
    try {
      const input = document.createElement('input');
      input.type  = 'file';
      input.accept = 'image/*';
      input.onchange = function (e) {
        const f = e.target.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onerror = function () {
          console.error('[JobUI] uploadPartImage: file read failed');
          if (_deps && typeof _deps.showToast === 'function') _deps.showToast('Image load nahi ho saki', 'error');
        };
        reader.onload = function (re) {
          const row = btn.closest('tr');
          if (!row) return;
          let img = row.querySelector('img.thumbnail');
          if (!img) {
            img = document.createElement('img');
            img.className = 'thumbnail';
            img.style.cssText = 'width:40px;height:30px;object-fit:cover;border-radius:4px;margin-left:4px;vertical-align:middle';
            const div = btn.closest('.item-image');
            if (div) div.appendChild(img);
          }
          img.src = re.target.result;
          img.style.display = 'inline-block';
        };
        reader.readAsDataURL(f);
      };
      input.click();
    } catch (e) {
      console.error('[JobUI] uploadPartImage error:', e);
    }
  }

  function _labourClockAction(action, jobId) {
    if (!_state || !jobId) return;
    try {
      var methodMap = {
        start:  'labourClockStart',
        pause:  'labourClockPause',
        resume: 'labourClockResume',
        end:    'labourClockEnd',
      };
      var methodName = methodMap[action];
      if (!methodName || typeof _state[methodName] !== 'function') return;
      var updated = _state[methodName](jobId);
      if (!updated) return;
      try {
        if (typeof _deps.persistNow === 'function') {
          _deps.persistNow();
        }
      } catch (e) { console.warn('[JobUI] _labourClockAction: persistNow failed:', e); }
      _updateLabourClockUI(jobId, updated);

      var msgs = { start: 'Clock started ⏱️', pause: 'Clock paused ⏸️', resume: 'Clock resumed ▶️', end: 'Clock stopped ⏹️' };
      if (_deps && typeof _deps.showToast === 'function') _deps.showToast(msgs[action] || 'Clock updated', 'info');
    } catch (e) {
      console.error('[JobUI] _labourClockAction error:', e);
    }
  }

  function _renderLabourClockCard(job) {
    if (!job) return '';
    var stats  = _state.labourClockGetStats ? _state.labourClockGetStats(job.id) : null;
    var clk    = job.labourClock || {};
    var running = !!(clk.startTime && !clk.endTime);
    var paused  = !!clk.paused;
    var ended   = !!clk.endTime;

    var comebackBadge = job.comeback
      ? '<span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;margin-left:8px">' +
        '⚠️ COMEBACK' + (job.comebackSameComplaint ? ' (same complaint)' : '') + '</span>'
      : '';

    var startBtn  = (!running && !ended)
      ? '<button class="btn btn-success btn-sm" data-job-action="clock-start" data-job-id="' + _esc(job.id) + '">▶️ Start Clock</button>'
      : '';
    var pauseBtn  = (running && !paused)
      ? '<button class="btn btn-ghost btn-sm" data-job-action="clock-pause" data-job-id="' + _esc(job.id) + '">⏸️ Pause</button>'
      : '';
    var resumeBtn = (running && paused)
      ? '<button class="btn btn-ghost btn-sm" data-job-action="clock-resume" data-job-id="' + _esc(job.id) + '">▶️ Resume</button>'
      : '';
    var endBtn    = (running)
      ? '<button class="btn btn-danger btn-sm" data-job-action="clock-end" data-job-id="' + _esc(job.id) + '">⏹️ Stop</button>'
      : '';

    var statsHtml = '';
    if (stats && stats.actualHrs > 0) {
      statsHtml =
        '<div style="display:flex;gap:16px;margin-top:8px;font-size:12px">' +
          '<span>⏱️ Actual: <strong>' + stats.actualHrs + ' hrs</strong></span>' +
          (stats.billedHrs > 0
            ? '<span>🧾 Billed: <strong>' + stats.billedHrs + ' hrs</strong></span>'
            : '') +
          (stats.efficiency !== null
            ? '<span style="color:' + (stats.efficiency >= 80 ? '#16a34a' : '#d97706') + '">📊 Efficiency: <strong>' + stats.efficiency + '%</strong></span>'
            : '') +
        '</div>';
    }

    var statusLabel = ended   ? '⏹️ Completed' :
                      paused  ? '⏸️ Paused'    :
                      running ? '▶️ Running'   : '⬜ Not started';

    return '<div id="labour-clock-card-' + _esc(job.id) + '" ' +
           'style="background:var(--bg-light,#f8fafc);border:1px solid var(--border-l,#e2e8f0);' +
           'border-radius:8px;padding:12px 16px;margin-bottom:10px">' +
             '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
               '<span style="font-weight:700;font-size:13px">⏱️ Labour Clock</span>' +
               '<span style="font-size:11px;color:var(--muted)">' + statusLabel + '</span>' +
               comebackBadge +
             '</div>' +
             '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
               startBtn + pauseBtn + resumeBtn + endBtn +
             '</div>' +
             statsHtml +
           '</div>';
  }

  function _updateLabourClockUI(jobId, updatedJob) {
    if (!jobId || !updatedJob) return;
    var cardEl = document.getElementById('labour-clock-card-' + jobId);
    if (cardEl) {
      cardEl.outerHTML = _renderLabourClockCard(updatedJob);
    } else {
      _renderJobDetail(updatedJob);
    }
  }

  return {
    init,
    destroy,

    filterJobs,
    applyJobFilters,
    clearJobFilters,

    renderJobs,
    showJobList,
    showJobDetail,

    openJobModal,
    saveJobFromModal,
    editCurJob,
    editJobById,

    calcJob,
    addJobPart,
    delRow,
    addLabourRow,
    delLabourRow,
    populateJobForm,

    addInternalNote,
    addLabourLineFromDetail,

    renderJobPhotos,
    openLightbox,

    toggleBulkMode,
    toggleBulkSelect,
    clearBulkSelection,
    bulkUpdateStatus,
    bulkDeleteJobs,

    uploadPartImage,
  };

})();

window.JobUI = JobUI;
