
const JobService = (function () {
  'use strict';

  let _state   = null;
  let _storage = null;
  let _bus     = null;
  let _deps    = {};
  let _initialized = false;


  function init(state, storage, bus, deps) {
    if (_initialized) {
      console.warn('[JobService] init() called more than once — ignored');
      return;
    }
    if (state && typeof state === 'object' && state.state) {
      const cfg = Object.assign({}, state);
      bus     = cfg.bus;
      storage = cfg.storage;
      state   = cfg.state;
      delete cfg.state;
      delete cfg.storage;
      delete cfg.bus;
      deps = cfg;
    }
    if (!state || !storage || !bus) {
      throw new Error('[JobService] init: state, storage, and bus are required');
    }
    _state   = state;
    _storage = storage;
    _bus     = bus;
    _deps    = deps || {};

    const recommended = ['showToast', 'closeModal', 'escapeHtml', 'formatCurrency'];
    const missing = recommended.filter(function (r) { return typeof (_deps[r]) !== 'function'; });
    if (missing.length) {
      console.warn('[JobService] Missing recommended deps:', missing);
    }

    _initialized = true;
  }

  function _notReady(fnName) {
    if (!_initialized) {
      console.error('[JobService] ' + fnName + ': Not initialized. Call init() first.');
      return true;
    }
    return false;
  }

  function _authBlocked(fnName, action) {
    // FIX (root cause, found by independent verification of the prior pass):
    // this used to only ever block when `auth` existed AND was not authenticated
    // (`auth && ... && !auth.isAuthenticated()`), which silently fails OPEN if
    // window.ERP.Auth is missing entirely (auth is falsy -> whole condition is
    // false -> falls through). For the functions gated with no `action` param
    // (updateJobStatus, updateJobStage, bulkUpdateStatus, collectPayment,
    // convertJobToInvoice), that meant a missing Auth module let the call
    // through completely unauthenticated -- the exact silent-fail-open-on-
    // missing-dependency pattern this whole audit exists to close. Now matches
    // _requireAuth() in module_init.js: missing/broken Auth module blocks,
    // same as "authenticated() === false" does.
    var auth = window.ERP && window.ERP.Auth;
    if (!auth || typeof auth.isAuthenticated !== 'function') {
      console.warn('[Security] Auth module unavailable — blocking call to JobService.' + fnName);
      _toast('You must be logged in to perform this action', 'error');
      return true;
    }
    if (!auth.isAuthenticated()) {
      console.warn('[Security] Unauthorized call to JobService.' + fnName);
      _toast('You must be logged in to perform this action', 'error');
      return true;
    }
    // Root-cause fix (audit #55): authentication alone ("is someone logged in")
    // is not authorization ("is this user allowed to do this"). For actions
    // passed an explicit RBAC `action` name, require ERP.permissions.canDo()
    // to actually allow it. Fail CLOSED (block) if the permissions module
    // hasn't loaded yet, matching the fail-closed pattern already used for
    // PostingEngine's period-lock/COA/ConcurrencyGuard checks — a missing
    // dependency should never silently widen access.
    if (action) {
      var perms = window.ERP && window.ERP.permissions;
      if (!perms || typeof perms.canDo !== 'function' || !perms.canDo(action)) {
        console.warn('[Security] Permission denied for JobService.' + fnName + ' (action: ' + action + ')');
        _toast('You do not have permission to perform this action', 'error');
        return true;
      }
    }
    return false;
  }


  function _toast(msg, type, dur) {
    if (typeof _deps.showToast === 'function') _deps.showToast(msg, type || 'info', dur);
  }

  function _closeModal(id) {
    if (typeof _deps.closeModal === 'function') _deps.closeModal(id);
  }

  function _currentUserName(fallback) {
    if (typeof window === 'undefined') return fallback;
    var u = window.currentUser || window._currentUser;
    if (!u) return fallback;
    return (typeof u === 'string') ? u : (u.name || fallback);
  }

  function _esc(str) {
    if (typeof _deps.escapeHtml === 'function') return _deps.escapeHtml(str);
    return String(str || '').replace(/[&<>"'`]/g, function (c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;' })[c];
    });
  }

  function _fmt(n) {
    if (typeof _deps.formatCurrency === 'function') return _deps.formatCurrency(n);
    let num = Number(n);
    if (!isFinite(num)) num = 0;
    if (num < 0) return '-Rs.' + Math.abs(num).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return 'Rs.' + num.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
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

  function _nowISO() {
    if (typeof ERP !== 'undefined' && ERP && ERP.DateUtils && typeof ERP.DateUtils.now === 'function') {
      return ERP.DateUtils.now();
    }
    return new Date().toISOString();
  }

  function _randomSuffix(len) {
    var n = len || 6;
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') {
      var bytes = new Uint8Array(n);
      crypto.getRandomValues(bytes);
      var chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      var out = '';
      for (var i = 0; i < n; i++) out += chars[bytes[i] % chars.length];
      return out;
    }
    return Math.random().toString(36).slice(2, 2 + n).toUpperCase();
  }


  function _labTotal(job) {
    if (Array.isArray(job.labourLines) && job.labourLines.length) {
      return job.labourLines.reduce(function (s, ll) { return s + (Number(ll.amt) || 0); }, 0);
    }
    return Number(job.lab) || 0;
  }

  function _grandTotal(job) {
    const pt = (job.parts || []).reduce(function (s, p) { return s + (Number(p.q)||0) * (Number(p.p)||0); }, 0);
    const taxAmt = Number(job.taxAmt) || 0;
    return Math.max(0, pt + _labTotal(job) - (Number(job.dis) || 0) + taxAmt);
  }


  function _checkInventoryStock(parts) {
    var settings = {};
    try {
      if (typeof ERP !== 'undefined' && ERP && ERP.state && ERP.state.selectors) {
        settings = ERP.state.selectors.settings() || {};
      }
    } catch (e) { console.error(e); }

    if (settings.allowNegativeStock) return { ok: true };

    var inv = [];
    try {
      if (typeof ERP !== 'undefined' && ERP && ERP.state && ERP.state.selectors) {
        inv = ERP.state.selectors.inventory() || [];
      }
    } catch (e) { console.error(e); }

    if (!inv.length && Array.isArray(window.inventory) && window.inventory.length) {
      inv = window.inventory;
    }

    var partList = (parts || []).filter(function (p) { return (p.n || '').trim(); });
    var invModuleLoaded = !!(typeof ERP !== 'undefined' && ERP && ERP.state && ERP.state.selectors) && inv.length > 0;
    if (!inv.length) {
      if (!invModuleLoaded) return { ok: true, errors: [], warnings: [] };
      if (!partList.length) return { ok: true, errors: [], warnings: [] };
      var emptyErrors = partList.map(function (p) {
        return {
          part:      (p.n || '').trim(),
          needed:    Math.max(1, parseInt(p.q, 10) || 1),
          available: 0,
          message:   '\u201c' + (p.n || '').trim() + '\u201d: inventory mein koi item registered nahi \u2014 pehle Purchase section se stock mangwayein'
        };
      });
      return { ok: false, errors: emptyErrors, warnings: [] };
    }

    if (!partList.length) return { ok: true, errors: [], warnings: [] };

    var errors = [];
    var warnings = [];

    partList.forEach(function (part) {
      var name = (part.n || '').trim();

      var invItem = inv.find(function (i) {
        return (i.n || '').toLowerCase() === name.toLowerCase();
      });

      if (!invItem) {
        errors.push({
          part:      name,
          needed:    Math.max(1, parseInt(part.q, 10) || 1),
          available: 0,
          message:   '\u201c' + name + '\u201d inventory mein registered nahi \u2014 pehle Purchase section se yeh item khareedein'
        });
        return;
      }

      var available = Math.max(0, parseFloat(invItem.st) || 0);
      var needed    = Math.max(1, parseInt(part.q, 10) || 1);

      if (available < needed) {
        errors.push({
          part:      name,
          needed:    needed,
          available: available,
          message:   '\u201c' + name + '\u201d: zaroorat ' + needed + ', inventory mein sirf ' + available + ' hai \u2014 pehle purchase karein'
        });
      } else if ((available - needed) < (settings.lowStockAlert || 2)) {
        warnings.push('\u201c' + name + '\u201d: stock low ho jayega \u2014 sirf ' + (available - needed) + ' bachega');
      }
    });

    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  let _persistTimer = null;
  let _savePending    = false;

  function _persist(eventPayload, onComplete) {
    void eventPayload;
    _savePending = true;
    if (_persistTimer) clearTimeout(_persistTimer);
    _persistTimer = setTimeout(function () {
      _persistTimer = null;

      let storageSuccess = true;
      try {
        _storage.schedule(_deps.getProviders ? _deps.getProviders() : (_deps.providers || {}));
      } catch (e) {
        storageSuccess = false;
        console.error('[JobService] storage.schedule failed:', e);
        _bus.emit(_bus.EVENTS.STORAGE_ERROR, { error: e });
        _toast('Failed to save! Data may be lost on refresh.', 'error');
      }

      _savePending = false;

      if (storageSuccess) {
        _bus.emit(_bus.EVENTS.JOBS_CHANGED, { jobs: _state.getAll() });
      }
      _updateBadge();
      if (typeof onComplete === 'function') {
        try { onComplete(storageSuccess); } catch (_cbErr) { console.error('[JobService] _persist onComplete error:', _cbErr); }
      }
      return storageSuccess;
    }, 50);
  }

  function _updateBadge() {
    try {
      const el = typeof _deps.getBadgeEl === 'function' ? _deps.getBadgeEl() : null;
      if (el) el.textContent = _state.getActiveCount();
    } catch (e) { console.error(e); }
  }
  function _readPartsFromDOM() {
    const tbody = document.getElementById('j-parts-body') ||
                  document.querySelector('#j-parts tbody') ||
                  document.getElementById('j-parts');
    const rows = tbody
      ? (tbody.tagName === 'TBODY'
          ? tbody.querySelectorAll('tr')
          : tbody.querySelectorAll('tbody tr'))
      : [];

    var inv = [];
    try {
      if (typeof ERP !== 'undefined' && ERP && ERP.state && ERP.state.selectors) {
        inv = ERP.state.selectors.inventory() || [];
      }
    } catch (e) { console.error(e); }
    if (!inv.length && Array.isArray(window.inventory) && window.inventory.length) {
      inv = window.inventory;
    }
    var invLoaded = inv.length > 0;

    var allowNeg = false;
    try {
      if (typeof ERP !== 'undefined' && ERP && ERP.state && ERP.state.selectors) {
        allowNeg = !!(ERP.state.selectors.settings() || {}).allowNegativeStock;
      }
    } catch (e) { console.error(e); }

    const parts = [];
    let error = null;

    Array.from(rows).forEach(function (row) {
      if (error) return;
      if (row.parentElement && row.parentElement.tagName === 'THEAD') return;
      const ins = row.querySelectorAll('input');
      if (!ins[0] || !ins[0].value.trim()) return;

      const partName = ins[0].value.trim();

      if (!allowNeg && invLoaded && ins[0].dataset && ins[0].dataset.stockBlocked === 'true') {
        error = '\u201c' + partName + '\u201d blocked hai \u2014 yeh item inventory mein nahi ya out of stock hai. Pehle Purchase section se stock mangwayein.';
        return;
      }

      var foundInInv = inv.find(function (i) {
        return (i.n || '').toLowerCase() === partName.toLowerCase();
      });

      if (!allowNeg && invLoaded) {
        if (!foundInInv) {
          error = '\u201c' + partName + '\u201d inventory mein registered nahi \u2014 pehle Purchase section se yeh item khareedein, phir job mein add karein.';
          return;
        }
        var availStock = Math.max(0, parseFloat(foundInInv.st) || 0);
        if (availStock <= 0) {
          error = '\u201c' + partName + '\u201d out of stock hai (stock: 0) \u2014 pehle Purchase section se stock mangwayein.';
          return;
        }
      }

      const qRaw = parseInt(ins[1] ? ins[1].value : '1', 10);
      const pRaw = parseFloat(ins[2] ? ins[2].value : '0');

      if (isNaN(qRaw)) {
        error = 'Invalid quantity — please enter numbers only';
        return;
      }
      if (isNaN(pRaw)) {
        error = 'Invalid price — please enter numbers only';
        return;
      }
      if (pRaw < 0) {
        error = 'Part price manfi (negative) nahi ho sakti';
        return;
      }
      const _qtyCeiling = 10000;
      if (qRaw > _qtyCeiling) {
        error = '\u201c' + partName + '\u201d ki quantity (' + qRaw + ') bohat zyada hai \u2014 dobara check karein';
        return;
      }

      const imgEl = row.querySelector('img.thumbnail');
      var _invMatch = invLoaded ? foundInInv : inv.find(function (i) { return (i.n || '').toLowerCase() === partName.toLowerCase(); });
      var _costPrice = _invMatch ? (parseFloat(_invMatch.pp) || parseFloat(_invMatch.cp) || 0) : 0;
      var _bc = _invMatch ? (_invMatch.bc || '') : '';
      parts.push({
        n:         partName,
        q:         Math.max(1, qRaw),
        p:         Math.max(0, pRaw),
        sp:        Math.max(0, pRaw),
        pp:        _costPrice,
        costPrice: _costPrice,
        bc:        _bc,
        sku:       _bc,
        image:     (imgEl && imgEl.style.display !== 'none') ? imgEl.src : null,
      });
    });

    return { parts: parts, error: error };
  }

  function _readJobForm() {
    function _val(id)  { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
    function _data(id, attr) { const el = document.getElementById(id); return el ? (el.dataset[attr] || '') : ''; }

    const car   = _val('j-car');
    const plate = _val('j-plate').toUpperCase();

    if (!car || !plate) return { error: 'Vehicle name aur plate number zaroori hain!', data: null };
    if (car.length < 2) return { error: 'Vehicle name kam az kam 2 characters ka hona chahiye!', data: null };

    const partsResult = _readPartsFromDOM();
    if (partsResult.error) return { error: partsResult.error, data: null };

    const labourRows = document.querySelectorAll('#j-labour-body tr.labour-row');
    var labourLines = [];
    var labVal = 0;
    var ldVal  = 'Labour charges';

    if (labourRows.length > 0) {
      labourRows.forEach(function (row) {
        var inputs  = row.querySelectorAll('input');
        var selects = row.querySelectorAll('select');
        var desc = (inputs[0] ? inputs[0].value.trim() : '') || 'Labour';
        var mec  = (selects[0] ? selects[0].value.trim() : '');
        var amt  = Math.max(0, parseFloat(inputs[1] ? inputs[1].value : '0') || 0);
        labourLines.push({ desc: desc, mec: mec, amt: amt });
        labVal += amt;
      });
      ldVal = labourLines.map(function (l) { return l.desc; }).join(', ');
    } else {
      labVal = Math.max(0, parseFloat(_val('j-lab')) || 0);
      ldVal  = _val('j-ld') || 'Labour charges';
      if (labVal > 0) labourLines = [{ desc: ldVal, mec: '', amt: labVal }];
    }

    const disVal = Math.max(0, parseFloat(_val('j-dis')) || 0);

    // FIX (root-cause, was fail-open): this used to silently skip validation entirely
    // (including the discount-vs-total check) if Validators wasn't loaded, letting an
    // invalid job through the one path that's actually supposed to block bad saves.
    // Refuse to save instead — this is the real gate; skipping it silently is worse
    // here than in job_state.js's non-blocking layer.
    if (typeof Validators === 'undefined') {
      return { error: '[JobService] Validators module not loaded — refusing to save job without business-rule validation.', data: null };
    }
    var _vCheck = Validators.job({ car: car, plate: plate, lab: labVal, dis: disVal, parts: partsResult.parts });
    if (!_vCheck.ok) {
      return { error: _vCheck.error, data: null };
    }

    const mechanicEl = document.getElementById('job-mechanic') || document.getElementById('j-mechanic');
    const mechanic = (mechanicEl && mechanicEl.value && mechanicEl.value.trim())
      ? mechanicEl.value.trim()
      : 'Unassigned';
    const mechanicId = (mechanicEl && mechanicEl.selectedOptions && mechanicEl.selectedOptions[0] &&
      mechanicEl.selectedOptions[0].getAttribute('data-staff-id')) || '';

    const editId = _data('j-car', 'editId');

    const probRaw = _val('j-prob') || 'No description';
    const prob = probRaw.substring(0, 500);

    return {
      error: null,
      data: {
        _editId:   editId || null,
        car:       car,
        plate:     plate,
        eng:       _val('j-eng') || '—',
        col:       _val('j-col') || '—',
        cust:      _val('j-cust') || 'Customer',
        ph:        _val('j-ph')  || '—',
        mec:       mechanic,
        mecId:     mechanicId || '',
        del:       _val('j-del'),
        prob:      prob,
        status:    _val('j-status') || 'pending',
        ld:        ldVal,
        parts:     partsResult.parts,
        lab:       labVal,
        labourLines: labourLines,
        dis:       disVal,
      },
    };
  }


  function saveJob() {
    if (_notReady('saveJob')) return;
    try {
      const form = _readJobForm();
      if (form.error) { _toast(form.error, 'error'); return; }

      const fd      = form.data;
      const isEdit  = !!(fd._editId);

      if (fd.parts && fd.parts.length) {
        var partsToCheck = fd.parts;
        if (isEdit) {
          var _existingJob = _state.getById(fd._editId);
          if (_existingJob && _existingJob._stockDeducted && Array.isArray(_existingJob.parts)) {
            var _oldQtyMap = {};
            _existingJob.parts.forEach(function(p) {
              var key = (p.n || '').trim().toLowerCase();
              if (key) _oldQtyMap[key] = (_oldQtyMap[key] || 0) + (parseInt(p.q, 10) || 1);
            });
            partsToCheck = fd.parts.filter(function(p) {
              var key = (p.n || '').trim().toLowerCase();
              var newQty = parseInt(p.q, 10) || 1;
              var oldQty = _oldQtyMap[key] || 0;
              return newQty > oldQty;
            }).map(function(p) {
              var key = (p.n || '').trim().toLowerCase();
              var oldQty = _oldQtyMap[key] || 0;
              return Object.assign({}, p, { q: (parseInt(p.q, 10) || 1) - oldQty });
            }).filter(function(p) { return p.q > 0; });
          }
        }
        if (partsToCheck.length) {
          var stockCheck = _checkInventoryStock(partsToCheck);
          if (!stockCheck.ok) {
            var errLines = stockCheck.errors.map(function (e) { return '\u2022 ' + e.message; }).join('\n');
            _toast('\u26a0\ufe0f Stock Insufficient \u2014 Job cannot be saved:\n\n' + errLines, 'error', 8000);
            return;
          } else if (stockCheck.warnings && stockCheck.warnings.length) {
            _toast('\u26a0\ufe0f Low stock warning: ' + stockCheck.warnings[0], 'warning', 5000);
          }
        }
      }

      const targetJob = isEdit ? _state.getById(fd._editId) : null;
      if (isEdit && !targetJob) {
        _toast('Job not found for editing', 'error');
        return;
      }

      const today = _today() ;

      const jobData = Object.assign({}, fd, {
        date:            fd.date || (targetJob ? targetJob.date : today) || today,
        photos:          isEdit ? (targetJob.photos      || []) : [],
        notes:           isEdit ? (targetJob.notes       || []) : [],
        labourLines:     fd.labourLines && fd.labourLines.length ? fd.labourLines : (isEdit ? (targetJob.labourLines || []) : []),
        customerApproved: isEdit ? !!targetJob.customerApproved  : false,
        approvedAt:       isEdit ? (targetJob.approvedAt || null) : null,
        conditionScore:   isEdit ? (targetJob.conditionScore || 0): 0,
        _glWIP:           isEdit ? (targetJob._glWIP || false)     : false,
        invoiceId:        isEdit ? (targetJob.invoiceId || null)   : null,
      });
      if (typeof _deps.snapshot === 'function') {
        try { _deps.snapshot('Job saved: ' + jobData.car); } catch (e) {
          console.warn('[JobService] snapshot hook threw (non-fatal):', e);
        }
      }

      let savedJob;
      if (isEdit) {
        savedJob = _state.replaceJob(targetJob.id, jobData);
      } else {
        savedJob = _state.addJob(jobData);
      }

      if (!savedJob) {
        _toast('Job could not be saved — ID not found', 'error');
        return;
      }


      if (typeof AuditTrail !== 'undefined') {
        AuditTrail.record(
          'jobs',
          isEdit ? targetJob.id : (savedJob && savedJob.id),
          isEdit ? 'update' : 'create',
          isEdit ? targetJob : null,
          savedJob,
          _currentUserName('System')
        );
      }

      _persist({ jobs: _state.getAll() }, function (storageSuccess) {
        const jCarEl = document.getElementById('j-car');
        if (jCarEl) delete jCarEl.dataset.editId;

        _closeModal('jobModal');
        if (storageSuccess) {
          _toast('Repair job ' + (isEdit ? 'updated' : 'saved') + '!', 'success');
        }
      });

      try { if (typeof _deps.renderDashJobs    === 'function') _deps.renderDashJobs();    } catch (e) { console.error(e); }
      try { if (typeof _deps.renderDashWidgets === 'function') _deps.renderDashWidgets(); } catch (e) { console.error(e); }

      if (!isEdit) {
        try {
          _checkComeback(savedJob);
        } catch (e) {
          console.warn('[JobService] comeback check error (non-fatal):', e);
        }
      }

    } catch (e) {
      console.error('[JobService] saveJob error:', e);
      _toast('Failed to save job', 'error');
    }
  }

  function _restoreJobStock(parts, documentId) {
    if (!Array.isArray(parts) || !parts.length) return;
    try {
      var inv = (window.ERP && window.ERP._internal)
        ? (window.ERP._internal.getState().data.inventory || [])
        : (Array.isArray(window.inventory) ? window.inventory : []);
      var entries = [];
      parts
        .filter(function (p) { return (p.n || '').trim() && !(p.n || '').toLowerCase().includes('labour'); })
        .forEach(function (p) {
          var qty = Math.max(1, parseInt(p.q, 10) || 1);
          var bc = p.bc || p.barcode || p.sku || '';
          if (!bc) {
            var match = inv.find(function (i) { return (i.n || '').toLowerCase() === (p.n || '').toLowerCase(); });
            if (match) bc = match.bc;
          }
          if (!bc) return;
          entries.push({ barcode: bc, qty: qty, unitCostPaisa: 0 });
        });
      if (!entries.length) return;
      var actor = _currentUserName('System');
      if (window.ERP && window.ERP.InventoryService && typeof window.ERP.InventoryService.restore === 'function') {
        window.ERP.InventoryService.restore(entries, {
          sourceModule: 'job',
          documentId: documentId || ('JOB-RESTORE-' + Date.now()),
          actor: actor
        });
      }
    } catch (e) {
      console.warn('[JobService] _restoreJobStock error (non-fatal):', e);
    }
  }

  function _reverseJobFinancials(jobSnapshot, id, reasonPrefix) {
    if (!jobSnapshot) return Promise.resolve();
    var _erp = typeof ERP !== 'undefined' ? ERP : null;
    var _pe  = _erp && _erp.PostingEngine;
    var _promises = [];

    if (Array.isArray(jobSnapshot.paymentHistory) && jobSnapshot.paymentHistory.length && _pe && typeof _pe.reverse === 'function') {
      jobSnapshot.paymentHistory.forEach(function(pEntry) {
        if (!pEntry || pEntry.voided) return;
        var _glId = 'JOB-PAY-' + pEntry.id;
        _promises.push(
          _pe.reverse(_glId, { reason: reasonPrefix + id, actor: 'system' })
            .catch(function(e) {
              if (e && e.name !== 'NotFoundError')
                console.warn('[JobService] ' + reasonPrefix + 'GL reverse failed for', _glId, e && e.message);
            })
        );
      });
    }

    if (jobSnapshot._stockDeducted && _pe && typeof _pe.reverse === 'function' && typeof _pe.isPosted === 'function') {
      if (jobSnapshot.invoiceId && _pe.isPosted('SALE-REV-' + jobSnapshot.invoiceId)) {
        _promises.push(
          _pe.reverse('SALE-REV-' + jobSnapshot.invoiceId, { reason: reasonPrefix + id, actor: 'system' })
            .catch(function(e) { console.warn('[JobService] ' + reasonPrefix + 'Revenue reversal error:', e && e.message); })
        );
      }
      if (jobSnapshot.invoiceId && _pe.isPosted('SALE-COGS-' + jobSnapshot.invoiceId)) {
        _promises.push(
          _pe.reverse('SALE-COGS-' + jobSnapshot.invoiceId, { reason: reasonPrefix + id, actor: 'system' })
            .catch(function(e) { console.warn('[JobService] ' + reasonPrefix + 'COGS reversal error:', e && e.message); })
        );
      }
      if (_pe.isPosted('JOB-COGS-' + id)) {
        _promises.push(
          _pe.reverse('JOB-COGS-' + id, { reason: reasonPrefix + id, actor: 'system' })
            .catch(function(e) { console.warn('[JobService] ' + reasonPrefix + 'JOB-COGS reversal error:', e && e.message); })
        );
      }
    }

    if (Array.isArray(jobSnapshot.paymentHistory) && jobSnapshot.paymentHistory.length) {
      try {
        var _custName = jobSnapshot.cust || jobSnapshot.customer || '';
        var _paidTotal = jobSnapshot.paymentHistory.reduce(function(s, p) {
          return s + (p && !p.voided ? (Number(p.amount) || 0) : 0);
        }, 0);
        var _pubLedger = _erp && (_erp.Ledger || _erp._Ledger);
        if (_custName && _paidTotal > 0 && _pubLedger && typeof _pubLedger.createInvoiceVoidEntry === 'function') {
          var _custObj = (_erp._internal ? _erp._internal.getState().data.customers : (window.customers || []) || [])
            .find(function(c) { return (c.n || c.name || '').toLowerCase() === _custName.toLowerCase(); });
          var _custId = _custObj ? String(_custObj.id || _custObj.n || _custName) : _custName;
          var _voidEntry = _pubLedger.createInvoiceVoidEntry(_custId, id, _paidTotal, _today());
          if (_voidEntry && (_erp._atomicSave || _erp.atomicSave)) {
            _promises.push(
              _erp._atomicSave([{ store: 'customerLedger', op: 'pushAll', records: [_voidEntry] }], null)
                .then(function() { if (_pubLedger.recalculate) _pubLedger.recalculate(_custId); })
                .catch(function(e) { console.warn('[JobService] ' + reasonPrefix + 'customer ledger reversal failed:', e && e.message); })
            );
          }
        }
      } catch (_ledErr) {
        console.warn('[JobService] ' + reasonPrefix + 'ledger reversal error (non-fatal):', _ledErr && _ledErr.message);
      }
    }

    return Promise.all(_promises);
  }

  function _doDeleteJob(id) {
    try {
      const jobSnapshot = _state.getById(id);
      try {
        if (jobSnapshot && Array.isArray(jobSnapshot.parts) &&
            typeof ERP !== 'undefined' && ERP && ERP.InventoryService &&
            typeof ERP.InventoryService.unreserve === 'function') {
          jobSnapshot.parts.forEach(function (p) {
            if (p.bc) ERP.InventoryService.unreserve({ bc: p.bc, jobId: id });
          });
        }
      } catch (_unresErr) {
        console.warn('[JobService] deleteJob: unreserve error (non-fatal):', _unresErr);
      }

      const removed = _state.deleteJob(id);
      if (!removed) { _toast('Job not found', 'error'); return; }

      var _stockWasRestored = false;
      if (jobSnapshot && jobSnapshot._stockDeducted && Array.isArray(jobSnapshot.parts) && jobSnapshot.parts.length) {
        try {
          _restoreJobStock(jobSnapshot.parts, 'JOB-DEL-' + id);
          _stockWasRestored = true;
        } catch (restoreErr) {
          console.warn('[JobService] deleteJob: stock restore error (non-fatal):', restoreErr);
        }
      }

      _reverseJobFinancials(jobSnapshot, id, 'Job deleted: ');

      _persist({ jobs: _state.getAll() });
      _bus.emit(_bus.EVENTS.JOBS_SELECTED, { jobId: null });

      _toast('Job deleted', 'success');
    } catch (e) {
      console.error('[JobService] deleteJob error:', e);
      _toast('Delete failed', 'error');
    }
  }

  function deleteJob(id) {

    if (_notReady('deleteJob')) return;
    if (_authBlocked('deleteJob', 'deleteJob')) return;
    if (!id) return;
    var _djConfirm = (window.ERP && window.ERP.confirmDialog) || function(msg, ok) { if (window.confirm(msg)) ok(); };
    _djConfirm('Is job ko delete karna chahte hain?', function() { _doDeleteJob(id); });
  }
  function updateJobStatus(id, newStatus) {
    if (_notReady('updateJobStatus')) return;
    if (_authBlocked('updateJobStatus')) return;
    try {
      if (!_state.VALID_STATUSES.includes(newStatus)) {
        console.warn('[JobService] updateJobStatus: invalid status "' + newStatus + '" — ignored');
        _toast('Invalid status: ' + newStatus, 'error');
        return;
      }

      const job = _state.getById(id);
      if (job) {
        const lockedTransitions = {
          'cancelled': [],
          'delivered': [],
          'completed': ['delivered'],
        };
        if (Object.prototype.hasOwnProperty.call(lockedTransitions, job.status)) {
          const allowed = lockedTransitions[job.status];
          if (!allowed.includes(newStatus)) {
            _toast('Cannot change status from "' + job.status + '" to "' + newStatus + '"', 'error');
            return;
          }
        }
      }

      const updated = _state.setJobStatus(id, newStatus);
      if (!updated) { _toast('Job status update failed', 'error'); return; }
      if (newStatus === 'cancelled') {
        try {
          var _cancelJob = _state.getById(id);
          if (typeof ERP !== 'undefined' && ERP && ERP.InventoryService && typeof ERP.InventoryService.unreserve === 'function') {
            (_cancelJob && _cancelJob.parts || []).forEach(function (p) {
              if (p.bc) ERP.InventoryService.unreserve({ bc: p.bc, jobId: id });
            });
          }
        } catch (_unresErr) {
          console.warn('[JobService] updateJobStatus: unreserve on cancel error (non-fatal):', _unresErr);
        }
      }

      if (newStatus === 'completed') {
        var _freshJob = _state.getById(id);
        if (_freshJob && !_freshJob.invoiceId &&
            typeof _deps.bumpInvCount === 'function' &&
            typeof _deps.getSales    === 'function') {
          try {
            var _autoInvId   = 'INV-' + String(_deps.bumpInvCount()).padStart(4, '0');
            var _invDate     = (typeof ERP !== 'undefined' && ERP.DateUtils && typeof ERP.DateUtils.today === 'function') ? ERP.DateUtils.today() : _today();
            var _autoItems   = (_freshJob.parts || []).map(function (p) {
              return { n: p.n, q: p.q, p: p.p, d: 0, image: p.image || null, bc: p.bc || null, sku: p.sku || null, pp: p.pp || 0, costPrice: p.costPrice || p.pp || 0 };
            });
            var _autoLabAmt  = _labTotal(_freshJob);
            if (_autoLabAmt > 0) {
              var _autoLabDesc = Array.isArray(_freshJob.labourLines) && _freshJob.labourLines.length
                ? _freshJob.labourLines.map(function (ll) { return ll.desc || 'Labour'; }).join(', ')
                : (_freshJob.ld || 'Labour Charges');
              _autoItems.push({ n: _autoLabDesc, q: 1, p: _autoLabAmt, d: 0, image: null });
            }
            var _autoTotal   = _grandTotal(_freshJob);
            var _autoInvoice = {
              id:             _autoInvId,
              jobId:          _freshJob.id,
              cust:           _freshJob.cust,
              customer:       _freshJob.cust,
              ph:             _freshJob.ph   || '',
              items:          _autoItems,
              pay:            'Cash',
              paid:           0,
              total:          _autoTotal,
              due:            _autoTotal,
              date:           _invDate,
              status:         'unpaid',
              photos:         _freshJob.photos || [],
              paymentHistory: [],
            };
            
            
            
            var _jobToStamp = _state.getById(id);
            if (_jobToStamp) {
              _state.replaceJob(id, Object.assign({}, _jobToStamp, { invoiceId: _autoInvId }));
            }
            _persist({ jobs: _state.getAll() });

            if (typeof ERP !== 'undefined' && ERP && ERP.SalesService && ERP.SalesService.sales &&
                typeof ERP.SalesService.sales.add === 'function') {
              ERP.SalesService.sales.add(_autoInvoice).then(function (_addRes) {
                var _addOk = !_addRes || _addRes.success !== false;
                if (!_addOk) {
                  console.warn('[JobService] auto-invoice: SalesService.sales.add reported failure for ' + _autoInvId, _addRes);
                  _toast('⚠️ There was a problem saving the invoice — please refresh and check', 'error', 8000);
                  return;
                }
                try { window.sales = window.ERP._internal.getState().data.sales; } catch (_e) { console.error(_e); }
                try { if (typeof _deps.renderSales === 'function') _deps.renderSales(); } catch (_e) { console.error(_e); }
              }).catch(function (_addErr) {
                console.warn('[JobService] auto-invoice creation failed (non-fatal) — invoice number ' + 'may have been consumed without a matching invoice:', _addErr);
                _toast('⚠️ Invoice could not be created — the invoice number was consumed, please try again or create the invoice manually', 'error', 8000);
              });
            } else {
              console.warn('[JobService] auto-invoice: ERP.SalesService.sales.add unavailable — invoice not created for ' + _autoInvId);
              _toast('⚠️ Sales module not ready — invoice could not be created (please reload the page)', 'error', 8000);
            }
          } catch (_autoErr) {
            console.warn('[JobService] auto-invoice on complete failed (non-fatal) — invoice number ' + 'may have been consumed without a matching invoice:', _autoErr);
          }
        }
      }

      _bus.emit(_bus.EVENTS.JOBS_STATUS_CHANGED, { jobId: id, status: newStatus });
      _persist({ jobs: _state.getAll() });

      const curJob = _state.getCurJob();
      if (curJob && curJob.id === id) {
        _bus.emit(_bus.EVENTS.JOBS_SELECTED, { jobId: id });
      }

      if (newStatus === 'completed' || newStatus === 'delivered') {
        try {
          var _waJob = _state.getById(id);
          if (_waJob && _waJob.ph) {
            var _waPhone = _formatPhone(_waJob.ph);
            if (_waPhone) {
              var _bizName = _waSanitize((_deps.bizName || 'MH Autos').trim());
              var _waMsg   = newStatus === 'completed'
                ? '*' + _bizName + '*\n✅ Aapki gaari *ready* hai!\n\nVehicle: ' + _waSanitize(_waJob.car) + ' (' + _waSanitize(_waJob.plate || '') + ')\nJob: ' + _waJob.id + '\n\nPickup ke liye tashah ayen.'
                : '*' + _bizName + '*\n🚗 Aapki gaari *deliver* ho gayi!\n\nJob: ' + _waJob.id + '\nShukria aapka!';
              // FIX (root cause, audit #96): was a local wa.me string build with its own
              // phone handling, independent of the other 10 call sites — route through
              // the one canonical builder so normalization can't silently diverge again.
              var _waUrl = (window.ERP && ERP.WhatsAppLink && typeof ERP.WhatsAppLink.build === 'function')
                ? ERP.WhatsAppLink.build(_waPhone, _waMsg)
                : 'https://wa.me/' + encodeURIComponent(_waPhone) + '?text=' + encodeURIComponent(_waMsg);

              _toast(
                (newStatus === 'completed' ? '✅ Job ready! ' : '🚗 Delivered! ') +
                'WhatsApp button pe click karein customer ko notify karne ke liye.',
                'success', 10000
              );

              try {
                var _waBtn = document.querySelector('[data-job-action="wa"][data-job-id="' + id + '"]');
                if (_waBtn) {
                  _waBtn.dataset.waReadyUrl = _waUrl;
                  _waBtn.classList.add('btn-wa');
                  _waBtn.style.color        = '#fff';
                  _waBtn.title = 'Customer notify karo — ready message already loaded';
                }
              } catch (_domErr) { console.error(_domErr); }
            }
          }
        } catch (_waErr) {
          console.warn('[JobService] WA ready notification error (non-fatal):', _waErr);
        }
      }

      try { if (typeof _deps.renderDashWidgets === 'function') _deps.renderDashWidgets(); } catch (e) { console.error(e); }

    } catch (e) {
      console.error('[JobService] updateJobStatus error:', e);
      _toast('Status update failed', 'error');
    }
  }


  
  
  
  
  
  function updateJobStage(id, newStage) {
    if (_notReady('updateJobStage')) return;
    if (_authBlocked('updateJobStage')) return;
    try {
      if (!id) return;
      var stageKeys = (_state.STAGES || []).map(function (s) { return s.key; });
      if (stageKeys.indexOf(newStage) === -1) {
        console.warn('[JobService] updateJobStage: invalid stage "' + newStage + '" — ignored');
        _toast('Invalid stage: ' + newStage, 'error');
        return;
      }

      const job = _state.getById(id);
      if (!job) {
        _toast('Job not found', 'error');
        return;
      }
      if (job.status === 'cancelled') {
        _toast('Cannot change stage of a cancelled job', 'error');
        return;
      }

      const updated = _state.setJobStage(id, newStage);
      if (!updated) { _toast('Stage update failed', 'error'); return; }

      _bus.emit(_bus.EVENTS.JOBS_CHANGED, { jobs: _state.getAll() });
      _persist({ jobs: _state.getAll() });

      const curJob = _state.getCurJob();
      if (curJob && curJob.id === id) {
        _bus.emit(_bus.EVENTS.JOBS_SELECTED, { jobId: id });
      }

      try { if (typeof _deps.renderDashWidgets === 'function') _deps.renderDashWidgets(); } catch (e) { console.error(e); }
    } catch (e) {
      console.error('[JobService] updateJobStage error:', e);
      _toast('Stage update failed', 'error');
    }
  }


  function bulkDeleteJobs() {
    if (_notReady('bulkDeleteJobs')) return;
    if (_authBlocked('bulkDeleteJobs', 'deleteJob')) return;
    const count = _state.getBulkCount();
    if (!count) { _toast('No job selected', 'warning'); return; }
    var selected = _state.getBulkSelected();
    var _bjConfirm = (window.ERP && window.ERP.confirmDialog) || function(msg, ok) { if (window.confirm(msg)) ok(); };
    var _msg = count > 50
      ? 'WARNING: ' + count + ' jobs delete hone wale hain. Yeh action undo nahi ho sakti.'
      : count + ' jobs delete karna chahte hain?';
    _bjConfirm(_msg, function() { _doBulkDeleteSelected(selected); });
  }

  async function _doBulkDeleteSelected(selected) {
    try {
      const selectedIds = Array.from(selected || _state.getBulkSelected());
      if (!selectedIds.length) { _toast('No job selected', 'warning'); return; }

      const currentSelectionIds = Array.from(_state.getBulkSelected());
      const idsMatch = selectedIds.length === currentSelectionIds.length &&
        selectedIds.every(function (id) { return currentSelectionIds.indexOf(id) !== -1; });
      if (!idsMatch) {
        console.error('[JobService] bulkDeleteJobs: selection changed since confirmation — aborting to avoid deleting the wrong jobs');
        _toast('Selection has changed — please try again', 'error');
        return;
      }

      const _reversalPromises = [];
      selectedIds.forEach(function (id) {
        var jobSnap = _state.getById(id);
        try {
          if (jobSnap && jobSnap._stockDeducted && Array.isArray(jobSnap.parts) && jobSnap.parts.length) {
            _restoreJobStock(jobSnap.parts, 'JOB-BULK-DEL-' + id);
          }
        } catch (_restErr) {
          console.warn('[JobService] bulkDeleteJobs: stock restore error for ' + id + ' (non-fatal):', _restErr);
        }
        try {
          _reversalPromises.push(_reverseJobFinancials(jobSnap, id, 'Job bulk-deleted: '));
        } catch (_revErr) {
          console.warn('[JobService] bulkDeleteJobs: financial reversal error for ' + id + ' (non-fatal):', _revErr);
        }
      });

      try {
        await Promise.all(_reversalPromises);
      } catch (_awaitErr) {
        console.warn('[JobService] bulkDeleteJobs: one or more financial reversals failed (already logged individually):', _awaitErr);
      }

      const deleted = typeof _state.bulkDeleteByIds === 'function'
        ? _state.bulkDeleteByIds(selectedIds)
        : _state.bulkDelete();
      _persist({ jobs: _state.getAll() });
      _toast(deleted + ' jobs delete ho gaye', 'success');
    } catch (e) {
      console.error('[JobService] bulkDeleteJobs error:', e);
      _toast('Bulk delete failed', 'error');
    }
  }
  function bulkUpdateStatus(newStatus) {
    if (_notReady('bulkUpdateStatus')) return;
    if (_authBlocked('bulkUpdateStatus')) return;
    if (!_state.VALID_STATUSES.includes(newStatus)) return;
    const count = _state.getBulkCount();
    if (!count) { _toast('No job selected', 'warning'); return; }

    try {
      const updated = _state.bulkSetStatus(newStatus);
      _persist({ jobs: _state.getAll() });
      _toast(updated + ' jobs updated to "' + newStatus + '"', 'success');
    } catch (e) {
      console.error('[JobService] bulkUpdateStatus error:', e);
      _toast('Bulk update failed', 'error');
    }
  }


  function customerApproveJob() {
    if (_notReady('customerApproveJob')) return;
    try {
      const curJob = _state.getCurJob();
      if (!curJob) { _toast('No job is open', 'error'); return; }
      if (curJob.customerApproved) { _toast('Already approved', 'warning'); return; }

      const ok = _state.approveJob();
      if (!ok) { _toast('Approval failed', 'error'); return; }

      _persist({ jobs: _state.getAll() });
      try {
        var _approvedJob = _state.getById(curJob.id) || curJob;
        var _reserveErrors = [];
        (_approvedJob.parts || []).forEach(function (p) {
          if (!p.bc || !(p.q > 0)) return;
          var res = ERP.InventoryService.reserve({ bc: p.bc, qty: p.q, jobId: curJob.id });
          if (res && !res.ok) _reserveErrors.push(p.n || p.bc);
        });
        if (_reserveErrors.length) {
          _toast('⚠️ Some parts could not be reserved (check stock): ' + _reserveErrors.join(', '), 'warning', 7000);
        }
      } catch (_resErr) {
        console.warn('[JobService] reserve on approval error (non-fatal):', _resErr);
      }

      _bus.emit(_bus.EVENTS.JOBS_SELECTED, { jobId: curJob.id });
      _toast('Customer approval recorded ✅', 'success');
    } catch (e) {
      console.error('[JobService] customerApproveJob error:', e);
    }
  }


  function deleteJobPart(idx) {
    if (_notReady('deleteJobPart')) return;
    try {
      idx = parseInt(idx, 10);
      if (isNaN(idx) || idx < 0) {
        console.warn('[JobService] deleteJobPart: invalid index', idx);
        return;
      }
      const curJob = _state.getCurJob();
      if (!curJob) { _toast('No job selected — please open a job first', 'error'); return; }

      const ok = _state.deleteJobPart(idx);
      if (!ok) { _toast('Part could not be deleted — part not found', 'error'); return; }

      _persist({ jobs: _state.getAll() });
      _bus.emit(_bus.EVENTS.JOBS_SELECTED, { jobId: curJob.id });
    } catch (e) {
      console.error('[JobService] deleteJobPart error:', e);
    }
  }

  function collectPayment(jobId) {
    if (_notReady('collectPayment')) return;
    if (_authBlocked('collectPayment')) return;
    try {
      const job = _state.getById(jobId) || _state.getCurJob();
      if (!job) { _toast('Job not found', 'error'); return; }

      const total       = _grandTotal(job);
      const payHistory  = Array.isArray(job.paymentHistory) ? job.paymentHistory : [];
      const totalPaid   = payHistory.reduce(function (s, p) { return s + (p.voided ? 0 : (Number(p.amount) || 0)); }, 0);
      const balanceDue  = Math.max(0, total - totalPaid);

      var histHtml = '';
      if (payHistory.length) {
        histHtml =
          '<div style="margin-bottom:14px">' +
            '<div style="font-weight:600;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Payment History</div>' +
            '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
              '<thead><tr style="background:var(--bg)">' +
                '<th style="padding:5px 8px;text-align:left">Date</th>' +
                '<th style="padding:5px 8px;text-align:left">Method</th>' +
                '<th style="padding:5px 8px;text-align:right">Amount</th>' +
                '<th style="padding:5px 8px;text-align:left">Note</th>' +
              '</tr></thead><tbody>' +
              payHistory.map(function (ph) {
                return '<tr style="border-top:1px solid var(--hover)">' +
                  '<td style="padding:4px 8px;color:var(--muted)">' + _esc(ph.date || '') + '</td>' +
                  '<td style="padding:4px 8px"><span style="background:var(--info-m);color:var(--info-d);padding:1px 6px;border-radius:8px;font-size:11px">' + _esc(ph.method || 'Cash') + '</span></td>' +
                  '<td style="padding:4px 8px;text-align:right;font-weight:600;color:var(--success)">' + _fmt(ph.amount) + '</td>' +
                  '<td style="padding:4px 8px;color:var(--muted)">' + _esc(ph.note || '') + '</td>' +
                '</tr>';
              }).join('') +
            '</tbody></table>' +
          '</div>';
      }

      var alreadyFullyPaid = balanceDue <= 0 && (payHistory.length > 0 || total <= 0);

      const modal = document.createElement('div');
      modal.className = 'modal-overlay open';
      modal.innerHTML =
        '<div class="modal" style="max-width:480px">' +
          '<div class="modal-head">' +
            '<h2>💰 Collect Payment</h2>' +
            '<button class="modal-close js-pay-close">✕</button>' +
          '</div>' +
          '<div class="modal-body" style="padding:16px">' +

            '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">' +
              '<div style="background:var(--bg);border-radius:8px;padding:10px;text-align:center">' +
                '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Job Total</div>' +
                '<div style="font-size:16px;font-weight:700;color:var(--text)">' + _fmt(total) + '</div>' +
              '</div>' +
              '<div style="background:var(--success-m);border-radius:8px;padding:10px;text-align:center">' +
                '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Paid So Far</div>' +
                '<div style="font-size:16px;font-weight:700;color:var(--success-d)">' + _fmt(totalPaid) + '</div>' +
              '</div>' +
              '<div style="background:' + (balanceDue > 0 ? 'var(--warning-m)' : 'var(--success-m)') + ';border-radius:8px;padding:10px;text-align:center">' +
                '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Balance Due</div>' +
                '<div style="font-size:16px;font-weight:700;color:' + (balanceDue > 0 ? 'var(--warning-d)' : 'var(--success-d)') + '">' + _fmt(balanceDue) + '</div>' +
              '</div>' +
            '</div>' +

            histHtml +

            (alreadyFullyPaid
              ? '<div style="background:var(--success-m);border:1px solid var(--success-l);border-radius:8px;padding:14px;text-align:center;color:var(--success-d);font-weight:600">✅ Fully Paid — No balance remaining</div>'
              : '<div>' +
                  '<div class="fgrp">' +
                    '<label style="font-weight:600">Amount Receiving Now</label>' +
                    '<input class="fi js-pay-amount" type="number" value="' + balanceDue + '" min="1" step="1" style="font-size:18px;font-weight:700">' +
                    '<small style="color:var(--muted)">Enter less than balance for partial payment</small>' +
                  '</div>' +
                  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
                    '<div class="fgrp">' +
                      '<label style="font-weight:600">Payment Method</label>' +
                      '<select class="fi js-pay-method">' +
                        '<option>Cash</option>' +
                        '<option>Bank Transfer</option>' +
                        '<option>JazzCash</option>' +
                        '<option>EasyPaisa</option>' +
                        '<option>Card</option>' +
                        '<option>Cheque</option>' +
                        '<option>Credit</option>' +
                      '</select>' +
                    '</div>' +
                    '<div class="fgrp">' +
                      '<label style="font-weight:600">Reference / Note</label>' +
                      '<input class="fi js-pay-note" type="text" placeholder="Cheque no, transfer ref..." style="width:100%">' +
                    '</div>' +
                  '</div>' +
                  '<div class="js-pay-preview" style="background:var(--bg);border-radius:8px;padding:10px;font-size:13px;color:var(--muted);margin-top:4px">After payment: balance = ' + _fmt(balanceDue) + '</div>' +
                '</div>'
            ) +

          '</div>' +
          '<div class="modal-foot">' +
            '<button class="btn btn-ghost js-pay-cancel">Cancel</button>' +
            (alreadyFullyPaid ? '' : '<button class="btn btn-primary js-pay-process">✅ Record Payment</button>') +
          '</div>' +
        '</div>';

      document.body.appendChild(modal);

      modal.querySelector('.js-pay-close').addEventListener('click',  function () { modal.remove(); });
      modal.querySelector('.js-pay-cancel').addEventListener('click', function () { modal.remove(); });
      modal.addEventListener('keydown', function (e) { if (e.key === 'Escape') modal.remove(); });

      if (!alreadyFullyPaid) {
        const amountInput  = modal.querySelector('.js-pay-amount');
        const previewEl    = modal.querySelector('.js-pay-preview');

        if (amountInput && previewEl) {
          amountInput.addEventListener('input', function () {
            var freshJob  = _state.getById(jobId) || job;
            var freshHist = Array.isArray(freshJob.paymentHistory) ? freshJob.paymentHistory : [];
            var freshPaid = freshHist.reduce(function (s, p) { return s + (p.voided ? 0 : (Number(p.amount) || 0)); }, 0);
            var freshDue  = Math.max(0, _grandTotal(freshJob) - freshPaid);
            var entered   = Math.max(0, parseFloat(this.value) || 0);
            var remaining = Math.max(0, freshDue - entered);
            previewEl.innerHTML = entered >= freshDue
              ? '<span style="color:var(--success);font-weight:600">✅ Fully paid after this payment</span>'
              : 'After this payment: <b style="color:var(--warning-d)">' + _fmt(remaining) + '</b> still outstanding';
          });
          amountInput.addEventListener('change', function () {
            if (parseFloat(this.value) < 0) this.value = 0;
          });
        }

        const btn = modal.querySelector('.js-pay-process');
        if (btn) {
          btn.addEventListener('click', function () {
            if (btn.disabled) return;
            btn.disabled = true;
            btn.textContent = 'Processing...';
            try {
              processPayment(job.id, btn, modal);
            } catch (e) {
              btn.disabled = false;
              btn.textContent = '✅ Record Payment';
            }
          });
        }
      }
    } catch (e) {
      console.error('[JobService] collectPayment error:', e);
    }
  }
  var _processPaymentInProgress = {};
  function processPayment(jobId, btn, modalEl) {
    if (_processPaymentInProgress[jobId]) return;
    _processPaymentInProgress[jobId] = true;
    try {
      const amountEl = modalEl ? modalEl.querySelector('.js-pay-amount') : null;
      const methodEl = modalEl ? modalEl.querySelector('.js-pay-method') : null;
      const noteEl   = modalEl ? modalEl.querySelector('.js-pay-note')   : null;
      const amount   = Math.max(0, parseFloat(amountEl ? amountEl.value : '0') || 0);
      const method   = methodEl ? methodEl.value : 'Cash';
      const note     = noteEl   ? (noteEl.value || '').trim()           : '';

      if (!amount || amount <= 0) {
        _toast('Amount 0 se zyada hona chahiye', 'error');
        if (btn) { btn.disabled = false; btn.textContent = '✅ Record Payment'; }
        return;
      }

      const job = _state.getById(jobId);
      if (!job) { _toast('Job not found', 'error'); return; }

      const totalDue     = _grandTotal(job);
      const payHistory   = Array.isArray(job.paymentHistory) ? job.paymentHistory : [];
      const alreadyPaid  = payHistory.reduce(function (s, p) { return s + (p.voided ? 0 : (Number(p.amount) || 0)); }, 0);
      const balanceDue   = Math.max(0, totalDue - alreadyPaid);
      const isFirstPayment = payHistory.filter(function(p){ return !p.voided; }).length === 0;
      const stockAlreadyDeducted = !!job._stockDeducted;

      if (balanceDue <= 0) {
        _toast('This job has already been paid in full', 'warning');
        if (modalEl) modalEl.remove();
        return;
      }

      if (amount > balanceDue) {
        _toast('Amount exceeds balance (' + _fmt(balanceDue) + ')', 'error');
        if (btn) { btn.disabled = false; btn.textContent = '✅ Record Payment'; }
        return;
      }
      const snapshot = JSON.parse(JSON.stringify(job));

      try {
        const today = _today() ;
        let invId = job.invoiceId;

        const newPayEntry = {
          id:     'PAY-' + ERP.uid(), // FIX (root cause, audit #61-62): was Date.now()+_randomSuffix(), a 5th competing scheme; route through the one canonical generator.
          date:   today,
          amount: amount,
          method: method,
          note:   note,
        };
        const updatedHistory = payHistory.concat([newPayEntry]);
        const newTotalPaid   = alreadyPaid + amount;
        const newBalance     = Math.max(0, totalDue - newTotalPaid);
        const isFullyPaid    = newBalance <= 0;

        if (isFirstPayment) {
          if (isFullyPaid) {
            _state.setJobStatus(jobId, 'completed');
          }
          try {
            if (typeof ERP !== 'undefined' && ERP && ERP.InventoryService && typeof ERP.InventoryService.unreserve === 'function') {
              (job.parts || []).forEach(function (p) {
                if (p.bc) ERP.InventoryService.unreserve({ bc: p.bc, jobId: jobId });
              });
            }
          } catch (_unresErr) {
            console.warn('[JobService] collectPayment: unreserve error (non-fatal):', _unresErr);
          }
        } else if (isFullyPaid) {
          // A later (non-first) payment can also complete the balance —
          // mark the job completed then too, since "fully paid" is now the
          // only signal that drives this status.
          _state.setJobStatus(jobId, 'completed');
        }

        const items = (job.parts || []).map(function (p) {
          return { n: p.n, q: p.q, p: p.p, d: 0, image: p.image || null };
        });
        const _labAmt = _labTotal(job);
        if (_labAmt > 0) {
          const _labDesc = Array.isArray(job.labourLines) && job.labourLines.length
            ? job.labourLines.map(function(ll){ return ll.desc||'Labour'; }).join(', ')
            : (job.ld || 'Labour Charges');
          items.push({ n: _labDesc, q: 1, p: _labAmt, d: 0, image: null, _isLabour: true });
        }

        if (typeof _deps.bumpInvCount === 'function' && typeof _deps.getSales === 'function') {
          invId = job.invoiceId;

          var _autoInvAlreadyExists = false;
          if (isFirstPayment && invId) {
            var _salesArr = typeof _deps.getSales === 'function' ? _deps.getSales() : [];
            _autoInvAlreadyExists = _salesArr.some(function (s) { return s.id === invId; });
          }

          if (isFirstPayment && !_autoInvAlreadyExists) {
            invId = 'INV-' + String(_deps.bumpInvCount()).padStart(4, '0');
            const newInvoice = {
              id:       invId,
              jobId:    job.id,
              cust:     job.cust,
              customer: job.cust,
              ph:       job.ph,
              items:    items,
              pay:      method,
              paid:     newTotalPaid,
              total:    totalDue,
              due:      newBalance,
              date:     today,
              status:   isFullyPaid ? 'paid' : 'partial',
              photos:   job.photos || [],
              paymentHistory: updatedHistory,
            };
            _deps.getSales().unshift(newInvoice);
            try {
              if (window.ERP && window.ERP._internal && typeof window.ERP._internal.setState === 'function') {
                window.ERP._internal.setState(function (s) {
                  s.data.sales = [newInvoice].concat((s.data.sales || []).filter(function(x){ return x.id !== invId; }));
                }, 'job:invoice:create:' + invId);
                try { window.sales = window.ERP._internal.getState().data.sales; } catch (_e) { console.error(_e); }
              }
            } catch (_stateErr) {
              console.warn('[JobService] ERP state sync failed (non-fatal):', _stateErr);
            }
            try {
              if (window.ERP && window.ERP._salesStorage && typeof window.ERP._salesStorage.save === 'function') {
                var _idbSalesCreate = (window.ERP._internal ? window.ERP._internal.getState().data.sales : null)
                                    || _deps.getSales();
                window.ERP._salesStorage.save('sales', _idbSalesCreate).catch(function(e){
                  if (window.DEBUG_MODE) console.warn('[JobService] IDB sales persist (create) failed:', e);
                });
              }
            } catch (_idbErr) {
              if (window.DEBUG_MODE) console.warn('[JobService] IDB sales persist (create) threw:', _idbErr);
            }
          } else if (invId) {
            const sales = typeof _deps.getSales === 'function' ? _deps.getSales() : [];
            const invIdx = sales.findIndex(function (s) { return s.id === invId; });
            if (invIdx !== -1) {
              sales[invIdx].paid           = newTotalPaid;
              sales[invIdx].due            = newBalance;
              sales[invIdx].status         = isFullyPaid ? 'paid' : 'partial';
              sales[invIdx].paymentHistory = updatedHistory;
              if (_autoInvAlreadyExists && items.length > 0) {
                sales[invIdx].items = items;
                sales[invIdx].total = totalDue;
              }
            }
            try {
              if (window.ERP && window.ERP._internal && typeof window.ERP._internal.setState === 'function') {
                window.ERP._internal.setState(function (s) {
                  var stateIdx = (s.data.sales || []).findIndex(function (x) { return x.id === invId; });
                  if (stateIdx !== -1) {
                    s.data.sales[stateIdx].paid           = newTotalPaid;
                    s.data.sales[stateIdx].due            = newBalance;
                    s.data.sales[stateIdx].status         = isFullyPaid ? 'paid' : 'partial';
                    s.data.sales[stateIdx].paymentHistory = updatedHistory;
                    if (_autoInvAlreadyExists && items.length > 0) {
                      s.data.sales[stateIdx].items = items;
                      s.data.sales[stateIdx].total = totalDue;
                    }
                  }
                }, 'job:invoice:update:' + invId);
              }
            } catch (_stateErr) {
              console.warn('[JobService] ERP state sync (subsequent) failed (non-fatal):', _stateErr);
            }
            try {
              if (window.ERP && window.ERP._salesStorage && typeof window.ERP._salesStorage.save === 'function') {
                var _idbSalesUpdate = (window.ERP._internal ? window.ERP._internal.getState().data.sales : null)
                                     || _deps.getSales();
                window.ERP._salesStorage.save('sales', _idbSalesUpdate).catch(function(e){
                  if (window.DEBUG_MODE) console.warn('[JobService] IDB sales persist (update) failed:', e);
                });
              }
            } catch (_idbErr) {
              if (window.DEBUG_MODE) console.warn('[JobService] IDB sales persist (update) threw:', _idbErr);
            }
          }

          const updatedJob = _state.getById(jobId);
          if (updatedJob) {
            _state.replaceJob(jobId, Object.assign({}, updatedJob, {
              invoiceId:      invId || updatedJob.invoiceId,
              paidAmount:     newTotalPaid,
              payMethod:      method,
              paidAt:         today,
              paymentHistory: updatedHistory,
            }));
          }
        }

        try {
          var _custSvc = (ERP && ERP._svc && ERP._svc.customers) ? ERP._svc.customers : null;
          var _custName = job.cust || '';
          if (_custSvc && typeof _custSvc.updateBalance === 'function') {
            _custSvc.updateBalance(_custName, {
              salesDelta:  amount,
              ptsDelta:    Math.floor(amount / 100),
              creditDelta: method === 'Credit' ? -amount : 0,
            });
          }
          if (ERP._Ledger && typeof ERP._Ledger.createPaymentEntry === 'function') {
            var _custId2 = job.customerId || _custName;
            var _pmEntry = ERP._Ledger.createPaymentEntry(String(_custId2), invId || jobId, amount, today);
            if (_pmEntry) {
              ERP._atomicSave([{ store: 'customerLedger', op: 'pushAll', records: [_pmEntry] }]).catch(function(le){ console.warn('[JobService] ledger entry save failed:', le); });
            }
          }
        } catch (custErr) {
          console.warn('[JobService] processPayment: customer ledger update failed:', custErr);
        }

        try {
          var ACC = window.AccountingCore;
          if (ACC && ACC.AccountingState && ACC.AccountingState.isInitialized && ACC.AccountingState.isInitialized()) {
            var SA = ACC.SYSTEM_ACCOUNTS;

            var bankAcctId;
            var methodLower = (method || '').toLowerCase();
            if (methodLower === 'cash') {
              bankAcctId = SA.CASH;
            } else if (methodLower === 'bank transfer') {
              bankAcctId = SA.BANK;
            } else if (methodLower === 'jazzcash' || methodLower === 'easypaisa' || methodLower === 'card') {
              bankAcctId = SA.BANK;
            } else if (methodLower === 'cheque') {
              bankAcctId = SA.BANK;
            } else if (methodLower === 'credit') {
              bankAcctId = null;
            } else {
              bankAcctId = SA.CASH;
            }

            if (bankAcctId) {
              var bankTxId = 'BTX-' + ERP.uid(); // FIX (root cause, audit #61-62): was Date.now()+_randomSuffix(); route through the one canonical generator.
              var bankTx = {
                id:            bankTxId,
                date:          today,
                bankAccountId: bankAcctId,
                type:          'deposit',
                amountPaisa:   Math.round(amount * 100),
                description:   'Repair Payment — ' + (job.cust || 'Customer') + ' — Job ' + jobId,
                reference:     invId || jobId,
                reconciled:    false,
                reconciledAt:  null,
                reversed:      false,
                reversalJournalId: null,
                journalId:     null,
                sourceModule:  'sales',
                createdAt:     _nowISO(),
                createdBy:     _currentUserName('system'),
              };
              ACC.AccountingState.addBankTransaction(bankTx);

              if (!Array.isArray(window.bankTransactions)) window.bankTransactions = [];
              window.bankTransactions.unshift(bankTx);

              if (ACC.AccountingStore && ACC.IDB_STORES) {
                ACC.AccountingStore.putOne(ACC.IDB_STORES.BANK_TRANSACTIONS, bankTx)
                  .catch(function (e) { console.warn('[JobService] Banking IDB write failed:', e); });
              }
            }

            if (bankAcctId) {
              var glSourceId = 'JOB-PAY-' + newPayEntry.id;
              var amountPaisa = Math.round(amount * 100);
              var _pe = window.ERP && window.ERP.PostingEngine;
              if (_pe && typeof _pe.post === 'function') {
                if (!_pe.isPosted(glSourceId)) {
                  _pe.post({
                    documentId:   glSourceId,
                    documentType: 'payment',
                    sourceModule: 'sales',
                    date:         today,
                    reference:    invId || jobId,
                    memo:         'Job payment received — ' + (job.cust || 'Customer') + ' — ' + (invId || jobId),
                    party:        job.cust || '',
                    entries: [
                      { accountId: bankAcctId, debit: amountPaisa, credit: 0,           description: method + ' received — ' + (job.cust || 'Customer') },
                      { accountId: SA.AR,      debit: 0,           credit: amountPaisa, description: 'AR cleared — ' + (invId || jobId) },
                    ],
                    actor: 'system',
                  }).catch(function (e) { console.warn('[JobService] GL post error (payment):', e); });
                }
              } else if (ACC.JournalService && !ACC.AccountingState.journalExistsForSource(glSourceId)) {
                ACC.JournalService.post({
                  date: today, reference: invId || jobId,
                  sourceModule: 'sales', sourceId: glSourceId,
                  memo: 'Job payment received — ' + (job.cust || 'Customer') + ' — ' + (invId || jobId),
                  party: job.cust || '',
                  entries: [
                    { accountId: bankAcctId, debit: amountPaisa, credit: 0,           description: method + ' received — ' + (job.cust || 'Customer') },
                    { accountId: SA.AR,      debit: 0,           credit: amountPaisa, description: 'AR cleared — ' + (invId || jobId) },
                  ],
                }, 'system').catch(function (e) { console.warn('[JobService] GL post error (payment):', e); });
              }
            }

            if (isFirstPayment && invId) {
              try {
                var _sc = window.ERP && window.ERP.SalesPostingLock;
                if (_sc && typeof _sc.postSale === 'function') {
                  var _invArr = typeof _deps.getSales === 'function' ? _deps.getSales() : [];
                  var _invRec = _invArr.find(function (s) { return s.id === invId; });
                  var _peGlobal = window.ERP && window.ERP.PostingEngine;
                  var _alreadyPosted = _peGlobal && typeof _peGlobal.isPosted === 'function' &&
                    (_peGlobal.isPosted('SALE-REV-' + invId) || _peGlobal.isPosted('SALE-COGS-' + invId));
                  if (_invRec && !_alreadyPosted) {
                    _sc.postSale(_invRec).catch(function (e) {
                      console.warn('[JobService] SalesConnector.postSaleJournals error:', e && e.message);
                    });
                  }
                }
              } catch (_scErr) {
                console.warn('[JobService] SalesConnector trigger error (non-fatal):', _scErr);
              }
            }

          }
        } catch (accErr) {
          console.warn('[JobService] Accounting entry error (non-fatal):', accErr);
        }


        if (!stockAlreadyDeducted && typeof _deps.updateStockOnSale === 'function') {
          var finalStockCheck = _checkInventoryStock(job.parts || []);
          if (!finalStockCheck.ok) {
            var stockErrList = finalStockCheck.errors.map(function (e) { return '\u2022 ' + e.message; }).join('\n');
            _toast('\u26a0\ufe0f Stock insufficient — payment cannot be recorded without adjustment first:\n' + stockErrList, 'error', 9000);
            console.warn('[JobService] processPayment: stock insufficient, blocking payment:', stockErrList);
            _processPaymentInProgress[jobId] = false;
            if (btn) { btn.disabled = false; btn.textContent = '✅ Record Payment'; }
            return;
          }
          try {
            _deps.updateStockOnSale(items, jobId);
            const _jobAfterDeduct = _state.getById(jobId);
            if (_jobAfterDeduct) {
              _state.replaceJob(jobId, Object.assign({}, _jobAfterDeduct, { _stockDeducted: true }));
            }
            try {
              var _sl = window.ERP && window.ERP.Ledger && window.ERP.Ledger.StockLedger;
              if (!job.invoiceId && _sl && typeof _sl.postStockConsumption === 'function') {
                var _totalCost = items.reduce(function (s, it) {
                  if (it._isLabour) return s;
                  var inv = (function(){ try { if(window.ERP&&window.ERP._internal){var _s=window.ERP._internal.getState();if(_s&&_s.data&&Array.isArray(_s.data.inventory))return _s.data.inventory;} } catch (_) { console.error(_); } return Array.isArray(window.inventory)?window.inventory:[]; }());
                  var part = inv.find(function (p) { return (p.n || '').toLowerCase() === (it.n || '').toLowerCase(); });
                  var cost = part ? (parseFloat(part.pp) || parseFloat(part.cp) || 0) : 0;
                  return s + cost * (Number(it.q) || 1);
                  }, 0);
                if (_totalCost > 0) {
                  _sl.postStockConsumption({
                    sourceId:  'JOB-COGS-' + jobId,
                    costPaisa: Math.round(_totalCost * 100),
                    date:      today,
                    reference: invId || jobId,
                    memo:      'COGS — Job ' + jobId + ' — ' + (job.cust || ''),
                  }, 'system').catch(function (e) { console.warn('[JobService] COGS GL error:', e); });
                }
              }
            } catch (_cogErr) {
              console.warn('[JobService] COGS post error (non-fatal):', _cogErr);
            }
          } catch (e) { console.warn('[JobService] stock update error:', e); }
        }

        _persist({ jobs: _state.getAll() });
        _bus.emit(_bus.EVENTS.JOBS_STATUS_CHANGED, { jobId: jobId, status: 'completed' });

        setTimeout(function() {
          try { if (typeof _deps.renderSales === 'function') _deps.renderSales(); } catch (e) { console.error(e); }
        }, 300);
        try { if (typeof _deps.renderInvList     === 'function') _deps.renderInvList();     } catch (e) { console.error(e); }
        try { if (typeof _deps.renderSaleLedger  === 'function') _deps.renderSaleLedger();  } catch (e) { console.error(e); }
        try { if (typeof _deps.renderCustomers   === 'function') _deps.renderCustomers();   } catch (e) { console.error(e); }
        try { if (typeof _deps.renderDashWidgets === 'function') _deps.renderDashWidgets(); } catch (e) { console.error(e); }
        try { if (typeof _deps.buildCharts       === 'function') _deps.buildCharts();       } catch (e) { console.error(e); }

        if (modalEl) {
          modalEl.remove();
        } else if (btn && btn.closest) {
          const overlay = btn.closest('.modal-overlay');
          if (overlay) overlay.remove();
        }

        _toast(
          'Payment ' + _fmt(amount) + ' (' + method + ') received!' +
          (newBalance > 0 ? ' Balance: ' + _fmt(newBalance) : ' ✅ Fully Paid'),
          'success', 6000
        );

        const curJob = _state.getCurJob();
        if (curJob && curJob.id === jobId) {
          _bus.emit(_bus.EVENTS.JOBS_SELECTED, { jobId: jobId });
          try {
            if (typeof _deps.showCustomerCreditInfo === 'function') {
              _deps.showCustomerCreditInfo(job.cust);
            }
          } catch (e) { console.error(e); }
        }

      } catch (innerErr) {
        console.error('[JobService] processPayment inner error, rolling back:', innerErr);
        try { _state.replaceJob(jobId, snapshot); } catch (e2) { console.error(e2); }
        _toast('Payment processing failed — rolled back', 'error');
        if (btn) { btn.disabled = false; btn.textContent = '✅ Record Payment'; }
      }

    } catch (e) {
      console.error('[JobService] processPayment error:', e);
      _toast('Payment processing failed', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '✅ Record Payment'; }
    } finally {
      delete _processPaymentInProgress[jobId];
    }
  }

  var COMEBACK_DAYS = 30;
  var _COMEBACK_STOPWORDS = ['door', 'left', 'work', 'part', 'back', 'heat', 'leak', 'burn', 'wire', 'side', 'noise', 'check', 'engine', 'problem', 'issue'];

  function _checkComeback(newJob) {
    if (!newJob || !newJob.plate) return;
    if (newJob.comeback) return;

    var plate       = (newJob.plate || '').toUpperCase().trim();
    var newProb     = (newJob.prob  || '').toLowerCase().trim();
    var newDate     = new Date(newJob.date || _today());
    var cutoff      = new Date(newDate);
    cutoff.setDate(cutoff.getDate() - COMEBACK_DAYS);

    var allJobs     = _state.getAll ? _state.getAll() : [];
    var closedStatuses = ['completed', 'delivered'];

    var matched = allJobs.filter(function (j) {
      if (j.id === newJob.id) return false;
      if ((j.plate || '').toUpperCase().trim() !== plate) return false;
      if (closedStatuses.indexOf(j.status) === -1) return false;
      var jDate = new Date(j.completedDate || j.date || 0);
      if (isNaN(jDate.getTime()) || jDate < cutoff) return false;
      return true;
    });

    if (!matched.length) return;

    var probWords   = newProb.split(/\W+/).filter(function (w) {
      return w.length >= 5 && _COMEBACK_STOPWORDS.indexOf(w) === -1;
    });
    var sameComplaintJob = matched.find(function (j) {
      var oldProb = (j.prob || '').toLowerCase();
      return probWords.some(function (w) { return oldProb.indexOf(w) !== -1; });
    });
    var sameComplaint = !!sameComplaintJob;
    var refJob = sameComplaintJob || matched[0];

    var patch = { comeback: true, comebackRef: refJob.id, comebackDate: _nowISO() };
    if (sameComplaint) patch.comebackSameComplaint = true;

    var _freshNewJob = _state.getById(newJob.id) || newJob;
    _state.replaceJob(newJob.id, Object.assign({}, _freshNewJob, patch));
    _persist({ jobs: _state.getAll() });

    var msg = '⚠️ Comeback detected! ' + plate + ' pichle ' + COMEBACK_DAYS +
              ' din mein wapas aya — Ref: ' + refJob.id +
              (sameComplaint ? ' (same complaint)' : '');
    _toast(msg, 'warning', 8000);

    try {
      if (typeof ERP !== 'undefined' && ERP && ERP.notifications && typeof ERP.notifications.add === 'function') {
        ERP.notifications.add('warning', msg);
      } else if (typeof ERP !== 'undefined' && ERP && ERP.notify && typeof ERP.notify.add === 'function') {
        ERP.notify.add('warning', msg);
      }
    } catch (e) { console.error(e); }
  }

  function _waSanitize(str) {
    return String(str || '').replace(/[*_~`]/g, '');
  }

  function openJobWA() {
    if (_notReady('openJobWA')) return;
    try {
      const job = _state.getCurJob();
      if (!job) { _toast('No job is open', 'error'); return; }

      const partsTotal = (job.parts || []).reduce(function (s, p) { return s + p.q * p.p; }, 0);
      const total      = _grandTotal(job);
      const sc         = _state.STATUS_CONFIG[job.status || 'pending'] || { l: job.status || 'pending' };
      const bizName    = _waSanitize((_deps.bizName  || 'MH Autos').trim());
      const bizPhone   = _deps.bizPhone || '';
      const dis        = Number(job.dis) || 0;

      const msg =
        '*' + bizName + '*\n━━━━━━━━━━━━━━━\n📋 *Job Status*\n━━━━━━━━━━━━━━━\n' +
        'Vehicle: ' + _waSanitize(job.car) + ' (' + _waSanitize(job.plate) + ')\n' +
        'Customer: ' + _waSanitize(job.cust) + '\n' +
        'Status: ' + _waSanitize(sc.l || job.status || 'pending') + '\n' +
        '━━━━━━━━━━━━━━━\n' +
        'Parts Total: ' + _fmt(partsTotal) + '\n' +
        'Labour: '      + _fmt(_labTotal(job)) + '\n' +
        (dis > 0 ? 'Discount: -' + _fmt(dis) + '\n' : '') +
        '━━━━━━━━━━━━━━━\n' +
        '*TOTAL: ' + _fmt(total) + '*\n' +
        '━━━━━━━━━━━━━━━\n' +
        (bizPhone ? '📞 ' + bizPhone : '');

      const phone = _formatPhone(job.ph);
      if (!phone) {
        _toast('Valid phone number not found — WhatsApp link cannot be opened', 'error');
        return;
      }
      // FIX (root cause, audit #96): route through the one canonical wa.me
      // builder/opener instead of a local window.open() call.
      if (window.ERP && ERP.WhatsAppLink && typeof ERP.WhatsAppLink.open === 'function') {
        ERP.WhatsAppLink.open(phone, msg);
      } else {
        window.open('https://wa.me/' + encodeURIComponent(phone) + '?text=' + encodeURIComponent(msg), '_blank');
      }
    } catch (e) {
      console.error('[JobService] openJobWA error:', e);
    }
  }

  function _formatPhone(ph) {
    if (typeof _deps.formatPhone === 'function') return _deps.formatPhone(ph);
    const str = String(ph || '').trim();
    if (!str) return null;
    const cleaned = str.replace(/[^0-9+]/g, '');
    if (!cleaned) return null;
    if (/^03\d{9}$/.test(cleaned)) {
      return '92' + cleaned.substring(1);
    }
    if (cleaned.startsWith('+')) {
      const digitsOnly = cleaned.substring(1);
      if (digitsOnly.length < 7) return null;
      return digitsOnly;
    }
    const digitsOnly = cleaned.replace(/\+/g, '');
    if (digitsOnly.length < 7) return null;
    return cleaned;
  }


  function _buildJobInvObject(job) {
    var items = [];

    (job.parts || []).forEach(function (p) {
      items.push({ n: p.n || 'Part', q: Number(p.q) || 1, p: Number(p.sp || p.p || 0), d: 0, image: p.image || null });
    });

    var labLines = Array.isArray(job.labourLines) && job.labourLines.length ? job.labourLines : [];
    if (labLines.length) {
      labLines.forEach(function (ll) {
        var amt = (ll.amt !== undefined) ? Number(ll.amt) : ((Number(ll.hrs) || 1) * (Number(ll.rate || ll.fixed) || 0));
        var desc = (ll.desc || 'Labour') + (ll.mec ? ' (' + ll.mec + ')' : '');
        if (amt > 0) items.push({ n: desc, q: 1, p: amt, d: 0, image: null });
      });
    } else if (Number(job.lab) > 0) {
      items.push({ n: job.ld || 'Labour Charges', q: 1, p: Number(job.lab), d: 0, image: null });
    }

    if (Number(job.dis) > 0) {
      items.push({ n: 'Discount', q: 1, p: -(Number(job.dis)), d: 0, image: null });
    }

    var payHist   = Array.isArray(job.paymentHistory) ? job.paymentHistory : [];
    var totalPaid = payHist.reduce(function (s, p) { return s + (p.voided ? 0 : (Number(p.amount) || 0)); }, 0);
    var lastMethod = payHist.length ? (payHist[payHist.length - 1].method || 'Cash') : (job.payMethod || 'Cash');

    var vehStr = [job.car, job.plate, job.eng].filter(Boolean).join(' | ');

    return {
      id:             job.invoiceId || ('JOB-' + job.id),
      customer:       job.cust  || '',
      ph:             job.ph    || '',
      veh:            vehStr,
      date:           job.date  || _today() ,
      pay:            lastMethod,
      items:          items,
      paid:           totalPaid,
      roundOff:       false,
      terms:          job.terms || '',
      paymentHistory: payHist,
      jobId:          job.id,
      mechanic:       job.mec   || '',
      plate:          job.plate || '',
    };
  }

  function _openJobInvoicePrintWindow(job, docTitle) {
    var biz   = (typeof _deps.getSettings === 'function' && _deps.getSettings()) || {};

    function _doOpen(theme, color) {
      theme = theme || 'modern';
      color = color || '#4338CA';

      var ST = (typeof SalesTemplates !== 'undefined') ? SalesTemplates
             : (window.ERP && window.ERP._salesTemplates) ? window.ERP._salesTemplates
             : null;

      if (ST && typeof ST.buildInvoiceHTML === 'function') {
        var invObj = null;
        if (job.invoiceId && typeof _deps.getSales === 'function') {
          var _allSales = _deps.getSales() || [];
          invObj = _allSales.find(function (s) { return s.id === job.invoiceId; }) || null;

          if (!invObj && window.ERP && window.ERP._internal) {
            try {
              var _stSales = window.ERP._internal.getState().data.sales || [];
              invObj = _stSales.find(function (s) { return s.id === job.invoiceId; }) || null;
            } catch (_e) { console.error(_e); }
          }
        }

        if (!invObj) invObj = _buildJobInvObject(job);

        if (!invObj.customer) invObj.customer = job.cust || '';
        if (!invObj.ph)       invObj.ph       = job.ph   || '';

        var html = ST.buildInvoiceHTML(invObj, theme, color, biz);
        var win  = window.open('', '_blank');
        if (win) {
          win.document.write(
            '<!DOCTYPE html><html><head><meta charset="utf-8">' +
            '<title>' + (docTitle || ('Job Invoice — ' + job.id)) + '</title>' +
            '<style>' +
              'body{margin:0;padding:20px;background:#f1f5f9;font-family:system-ui,sans-serif}' +
              '@media print{body{padding:0;background:#fff}.no-print{display:none!important}}' +
            '</style></head><body>' +
            html +
            '<div class="no-print" style="text-align:center;padding:24px 0 10px">' +
              '<button onclick="window.print()" style="background:' + color + ';color:#fff;border:none;padding:12px 32px;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;margin-right:12px">🖨️ Print / Save PDF</button>' +
              '<button onclick="window.close()" style="background:var(--bg,#f1f5f9);color:#334155;border:1px solid #cbd5e1;padding:12px 24px;border-radius:10px;font-size:14px;cursor:pointer">✕ Close</button>' +
            '</div>' +
            '</body></html>'
          );
          win.document.close();
          _toast('Invoice window opened', 'success');
        } else {
          _toast('Popup blocked — please allow popups for this site', 'warning', 5000);
        }
        return;
      }

      _openJobCardFallbackPrint(job, biz);
    }

    try {
      var _SA = (typeof SalesStorageAdapter !== 'undefined') ? SalesStorageAdapter
              : (window.ERP && window.ERP._salesStorage) ? window.ERP._salesStorage
              : null;

      if (window.ERP && window.ERP.sales && typeof window.ERP.sales.buildInvoiceHTML === 'function') {
        var _erpHtml = window.ERP.sales.buildInvoiceHTML(_buildJobInvObject(job));
        var _win2 = window.open('', '_blank');
        if (_win2) {
          _win2.document.write(
            '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + (docTitle || ('Job Invoice — ' + job.id)) + '</title>' +
            '<style>body{margin:0;padding:20px;background:#f1f5f9}@media print{body{padding:0;background:#fff}.no-print{display:none!important}}</style></head><body>' +
            _erpHtml +
            '<div class="no-print" style="text-align:center;padding:24px 0 10px">' +
              '<button onclick="window.print()" style="background:#1574d0;color:#fff;border:none;padding:12px 32px;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;margin-right:12px">🖨️ Print / Save PDF</button>' +
              '<button onclick="window.close()" style="background:var(--bg,#f1f5f9);color:#334155;border:1px solid #cbd5e1;padding:12px 24px;border-radius:10px;font-size:14px;cursor:pointer">✕ Close</button>' +
            '</div>' +
            '</body></html>'
          );
          _win2.document.close();
          _toast('Invoice window opened', 'success');
          return;
        }
      }

      if (_SA && typeof _SA.getTheme === 'function') {
        var tRes = _SA.getTheme();
        var cRes = _SA.getColor();
        var _resolvedTheme = 'modern';
        var _resolvedColor = '#4338CA';
        var _pending = 2;
        function _tryOpen() { if (--_pending === 0) _doOpen(_resolvedTheme, _resolvedColor); }
        if (tRes && typeof tRes.then === 'function') {
          tRes.then(function (v) { if (v) _resolvedTheme = v; _tryOpen(); }).catch(function () { _tryOpen(); });
        } else { if (tRes) _resolvedTheme = tRes; _pending--; }
        if (cRes && typeof cRes.then === 'function') {
          cRes.then(function (v) { if (v) _resolvedColor = v; _tryOpen(); }).catch(function () { _tryOpen(); });
        } else { if (cRes) _resolvedColor = cRes; _pending--; }
        if (_pending === 0) _doOpen(_resolvedTheme, _resolvedColor);
      } else {
        _doOpen('modern', '#4338CA');
      }
    } catch (_loadErr) {
      console.warn('[JobService] _openJobInvoicePrintWindow theme load error:', _loadErr);
      _doOpen('modern', '#4338CA');
    }
  }

  function printJobCard() {
    if (_notReady('printJobCard')) return;
    try {
      var job = _state.getCurJob();
      if (!job) { _toast('No job open', 'error'); return; }
      _openJobInvoicePrintWindow(job, 'Job Card — ' + job.id);
    } catch (e) {
      console.error('[JobService] printJobCard error:', e);
      _toast('Print failed', 'error');
    }
  }
  function exportJobPDF() {
    if (_notReady('exportJobPDF')) return;
    try {
      var job = _state.getCurJob();
      if (!job) { _toast('No job is selected', 'warning'); return; }
      _openJobInvoicePrintWindow(job, 'Invoice — ' + (job.invoiceId || job.id));
    } catch (e) {
      console.error('[JobService] exportJobPDF error:', e);
      _toast('PDF export failed', 'error');
    }
  }
  function _openJobCardFallbackPrint(job, biz) {
    var bizName  = (biz && biz.name)  || _deps.bizName || 'MH Autos Workshop';
    var parts    = job.parts || [];
    var grand    = _grandTotal(job);
    var labLines = job.labourLines || [];
    var sc       = _state.STATUS_CONFIG[job.status] || { l: job.status };
    var partsTotal = parts.reduce(function (s, p) { return s + (Number(p.q)||0) * (Number(p.p)||0); }, 0);

    var _partsVisible = parts.length > 50 ? parts.slice(0, 50) : parts;
    var _partsHidden  = parts.length > 50 ? parts.slice(50)     : [];
    var partsRows = parts.length
      ? _partsVisible.map(function (p) {
          // FIX (root cause, found by independent verification): these receipt
          // rows hardcoded the ₨ symbol with a bare toLocaleString() (no fixed
          // decimals), bypassing this file's own _fmt() (and ERP.fmt()) entirely
          // — inconsistent with every other amount on the same receipt and with
          // any configured non-default business currency.
          return '<tr><td>' + _esc(p.n) + '</td><td style="text-align:center">' + p.q +
            '</td><td style="text-align:right">' + _fmt(Number(p.p||0)) +
            '</td><td style="text-align:right;font-weight:700">' + _fmt((Number(p.q)||0)*(Number(p.p)||0)) + '</td></tr>';
        }).join('') +
        (_partsHidden.length ? '<tr id="jd-parts-more"><td colspan="4" style="text-align:center;padding:8px;cursor:pointer;color:var(--primary,#4338CA)" data-job-action="show-more-parts">' +
          '▼ Show ' + _partsHidden.length + ' more parts</td></tr>' : '')
      : '<tr><td colspan="4" style="text-align:center;color:var(--gray-l);padding:10px">No parts recorded</td></tr>';

    var labRows = labLines.length
      ? labLines.map(function (ll) {
          var amt = ll.amt !== undefined ? Number(ll.amt) : ((Number(ll.hrs)||1) * (Number(ll.rate||ll.fixed)||0));
          return '<tr><td>' + _esc(ll.desc||'Labour') + (ll.mec?' ('+_esc(ll.mec)+')':'') +
            '</td><td></td><td style="text-align:right;font-weight:700">' + _fmt(amt||0) + '</td></tr>';
        }).join('')
      : '<tr><td>General Labour</td><td></td><td style="text-align:right">' + _fmt(_labTotal(job)) + '</td></tr>';

    var discRow = (Number(job.dis)||0) > 0
      ? '<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--danger);padding:3px 0"><span>Discount</span><span>-' + _fmt(Number(job.dis)) + '</span></div>'
      : '';

    var payH = Array.isArray(job.paymentHistory) ? job.paymentHistory : [];
    var paidAmt = payH.reduce(function(s,p){ return s+(p.voided?0:(Number(p.amount)||0)); }, 0);
    var balAmt  = Math.max(0, grand - paidAmt);

    var html =
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Job Card ' + job.id + '</title>' +
      '<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Segoe UI,Inter,system-ui,Arial,sans-serif;background:#f8fafc;padding:20px;color:#0f172a}' +
      '.card{max-width:820px;margin:0 auto;background:#fff;border:2px solid #1e3a5f;border-radius:14px;overflow:hidden}' +
      '.hd{background:linear-gradient(135deg,#1e3a5f,#2d5282);color:#fff;padding:20px 26px;display:flex;justify-content:space-between;align-items:flex-start}' +
      '.hd h1{font-size:22px;font-weight:800;margin-bottom:5px}.hd .sub{font-size:12px;opacity:.8}' +
      '.sec{padding:14px 22px;border-bottom:1px solid #e2e8f0}.sec h4{font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.6px;margin-bottom:9px}' +
      '.g2{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:13px}.lbl{font-size:11px;color:#64748b;margin-bottom:2px}.val{font-weight:600;font-size:13px}' +
      'table{width:100%;border-collapse:collapse;font-size:12px}th{background:#f1f5f9;padding:7px 10px;text-align:left;font-size:10.5px;color:#64748b;font-weight:700;border-bottom:2px solid #e2e8f0}td{padding:7px 10px;border-bottom:1px solid #f1f5f9}' +
      '.tots{background:#f8fafc;padding:16px 22px}.tr{display:flex;justify-content:space-between;padding:4px 0;font-size:13px}' +
      '.grand{font-size:18px;font-weight:800;color:#1e3a5f;border-top:2px solid #1e3a5f;padding-top:9px;margin-top:6px}' +
      '.footer{text-align:center;padding:14px;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0}' +
      '.np{text-align:center;padding:16px;background:#f1f5f9}.btn-p{background:#1e3a5f;color:#fff;border:none;padding:10px 28px;border-radius:8px;font-size:14px;cursor:pointer;margin:4px;font-weight:600}' +
      '@media print{.np{display:none}body{background:#fff;padding:0}.card{box-shadow:none;border:1px solid #ccc}}</style></head><body>' +
      '<div class="card">' +
        '<div class="hd"><div><h1>&#128295; Job Card</h1><div class="sub">' + job.id + ' &bull; ' + (job.date||'') + '</div><div class="sub">Delivery: ' + _esc(job.del||'—') + '</div></div>' +
        '<div style="text-align:right"><div style="font-size:16px;font-weight:800">' + _esc(bizName) + '</div><div style="font-size:11px;opacity:.8;margin-top:4px">Status: ' + _esc(sc.l||job.status) + '</div></div></div>' +
        '<div class="sec"><h4>Vehicle &amp; Customer</h4><div class="g2">' +
          '<div><div class="lbl">Vehicle</div><div class="val">' + _esc(job.car||'') + '</div></div>' +
          '<div><div class="lbl">Plate</div><div class="val">' + _esc(job.plate||'') + '</div></div>' +
          '<div><div class="lbl">Customer</div><div class="val">' + _esc(job.cust||'') + '</div></div>' +
          '<div><div class="lbl">Phone</div><div class="val">' + _esc(job.ph||'') + '</div></div>' +
          '<div><div class="lbl">Mechanic</div><div class="val">' + _esc(job.mec||'—') + '</div></div>' +
          '<div><div class="lbl">Engine</div><div class="val">' + _esc(job.eng||'—') + '</div></div>' +
        '</div></div>' +
        (job.prob ? '<div class="sec"><h4>Problem / Work</h4><div style="font-size:13px;white-space:pre-wrap">' + _esc(job.prob) + '</div></div>' : '') +
        '<div class="sec"><h4>Parts &amp; Materials</h4><table><thead><tr><th>Part</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit</th><th style="text-align:right">Total</th></tr></thead><tbody>' + partsRows + '</tbody></table></div>' +
        '<div class="sec"><h4>Labour</h4><table><thead><tr><th>Description</th><th>Details</th><th style="text-align:right">Amount</th></tr></thead><tbody>' + labRows + '</tbody></table></div>' +
        '<div class="tots">' +
          '<div class="tr"><span>Parts Total</span><span>' + _fmt(partsTotal) + '</span></div>' +
          '<div class="tr"><span>Labour</span><span>' + _fmt(_labTotal(job)) + '</span></div>' +
          discRow +
          '<div class="tr grand"><span>GRAND TOTAL</span><span>' + _fmt(grand) + '</span></div>' +
          (paidAmt > 0 ? '<div class="tr" style="color:#16a34a;font-weight:600"><span>Paid</span><span>' + _fmt(paidAmt) + '</span></div>' : '') +
          (balAmt > 0  ? '<div class="tr" style="color:#ea580c;font-weight:700"><span>Balance Due</span><span>' + _fmt(balAmt) + '</span></div>' : '') +
        '</div>' +
        '<div class="footer">' + _esc(bizName) + ' &mdash; Thank you for your business</div>' +
      '</div>' +
      '<div class="np"><button class="btn-p" onclick="if(window.print){window.print();}else{alert(\'Print not supported\');}">&#128438; Print</button>' +
      '<button style="background:#64748b;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer;margin:4px" onclick="window.close()">&#10005; Close</button></div>' +
      '</body></html>';

    var pw = window.open('', '_blank', 'width=940,height=740');
    if (!pw) { _toast('Pop-ups blocked — please allow pop-ups and retry.', 'error'); return; }
    pw.document.open();
    pw.document.write(html);
    pw.document.close();
  }

  function exportJobsExcel() {
    if (_notReady('exportJobsExcel')) return;
    try {
      if (typeof XLSX === 'undefined') {
        _toast('Excel library (SheetJS) not loaded. Please ensure the XLSX script is included in your HTML.', 'error', 6000);
        return;
      }

      const data = _state.getAll().map(function (j) {
        const pt = (j.parts || []).reduce(function (s, p) { return s + p.q * p.p; }, 0);
        return {
          ID:       j.id,
          Vehicle:  j.car,
          Plate:    j.plate,
          Customer: j.cust,
          Phone:    j.ph,
          Mechanic: j.mec,
          Status:   j.status,
          Date:     j.date,
          Delivery: j.del,
          Parts:    pt,
          Labour:   _labTotal(j),
          Discount: j.dis || 0,
          Tax:      j.taxAmt || 0,
          Total:    _grandTotal(j),
        };
      });

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Jobs');
      XLSX.writeFile(wb, 'MH_Jobs.xlsx');
      _toast('Excel exported', 'success');
    } catch (e) {
      console.error('[JobService] exportJobsExcel error:', e);
      _toast('Excel export failed', 'error');
    }
  }

  function exportJobsPDF() {
    _toast('Generating PDF... please wait', 'info');
    setTimeout(function () { window.print(); }, 300);
  }


  function openJobTemplates() {
    if (_notReady('openJobTemplates')) return;
    try {
      const templates = typeof _deps.JOB_TEMPLATES === 'function' ? _deps.JOB_TEMPLATES() : _deps.JOB_TEMPLATES;
      if (!Array.isArray(templates) || !templates.length) {
        _toast('No templates available', 'info');
        return;
      }

      const catColors = {
        'Maintenance': '#0d9488', 'Safety':      '#dc2626',
        'Comfort':     '#0284c7', 'Drivetrain':  '#7c3aed',
        'Electrical':  '#d97706', 'Chassis':     '#475569',
        'Engine':      '#ea580c', 'Tyres':       '#16a34a',
      };

      const cardsHtml = templates.map(function (t, i) {
        const partsTotal = (t.parts || []).reduce(function (s, p) { return s + p.q * p.p; }, 0);
        const totalEst   = partsTotal + (t.lab || 0);
        const catColor   = catColors[t.category] || '#64748b';
        return '<div style="border:1px solid var(--border);border-radius:10px;padding:14px 16px;cursor:pointer;' +
          'background:#fff;position:relative;overflow:hidden" ' +
          'data-tpl-idx="' + i + '">' +
          '<div style="position:absolute;top:0;left:0;width:4px;height:100%;background:' + catColor + '"></div>' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-left:8px">' +
          '<div>' +
          '<div style="font-weight:700;font-size:14px;margin-bottom:3px">' + _esc(t.icon || '🔧') + ' ' + _esc(t.name) + '</div>' +
          '<div style="font-size:11px;font-weight:600;color:' + catColor + ';text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">' + _esc(t.category) + '</div>' +
          '<div style="font-size:12px;color:var(--muted);line-height:1.5;max-width:380px">' + _esc((t.prob || '').substring(0, 80)) + '...</div>' +
          '</div>' +
          '<div style="text-align:right;white-space:nowrap;margin-left:12px">' +
          '<div style="font-size:11px;color:var(--gray-l)">Est. Total</div>' +
          '<div style="font-weight:800;font-size:15px;color:' + catColor + '">' + _fmt(totalEst) + '</div>' +
          '<div style="font-size:10px;color:var(--gray-l)">' + (t.parts || []).length + ' parts &bull; Labour ' + _fmt(t.lab || 0) + '</div>' +
          '<div style="margin-top:8px;font-size:11px;color:' + catColor + ';font-weight:600">Apply &rarr;</div>' +
          '</div></div></div>';
      }).join('');

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay open';
      overlay.id = 'jobTplModal';
      overlay.innerHTML =
        '<div class="modal" style="max-width:640px;max-height:88vh">' +
          '<div class="modal-head">' +
            '<span style="font-size:15px;font-weight:700">&#128203; Professional Job Templates</span>' +
            '<button class="modal-close" id="_tpl-close-btn"><svg><use href="#ic-x"/></svg></button>' +
          '</div>' +
          '<div style="padding:8px 16px;background:var(--bg);border-bottom:1px solid var(--border);font-size:12px;color:var(--muted)">' +
            templates.length + ' templates — click any template to auto-fill the job form' +
          '</div>' +
          '<div style="overflow-y:auto;max-height:65vh;padding:16px;display:flex;flex-direction:column;gap:10px" id="_tpl-list">' +
            cardsHtml +
          '</div>' +
          '<div class="modal-foot">' +
            '<button class="btn btn-ghost" id="_tpl-cancel-btn">Cancel</button>' +
          '</div>' +
        '</div>';

      document.body.appendChild(overlay);

      overlay.querySelector('#_tpl-close-btn').addEventListener('click',  function () { overlay.remove(); });
      overlay.querySelector('#_tpl-cancel-btn').addEventListener('click', function () { overlay.remove(); });

      overlay.querySelector('#_tpl-list').addEventListener('click', function (e) {
        const card = e.target.closest('[data-tpl-idx]');
        if (!card) return;
        const idx = parseInt(card.dataset.tplIdx, 10);
        applyJobTemplate(idx);
        overlay.remove();
      });

    } catch (e) {
      console.error('[JobService] openJobTemplates error:', e);
    }
  }

  function _buildPartRowEl(p) {
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td');

    const imgDiv = document.createElement('div');
    imgDiv.className = 'item-image';
    const imgBtn = document.createElement('button');
    imgBtn.className = 'btn btn-sm btn-ghost';
    imgBtn.setAttribute('onclick', 'uploadPartImage(this)');
    imgBtn.innerHTML = '<svg><use href="#ic-camera"/></svg>';
    imgDiv.appendChild(imgBtn);

    const nameInput = document.createElement('input');
    nameInput.type  = 'text';
    nameInput.value = p.n;

    const qtyTd = document.createElement('td');
    const qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.value = parseInt(p.q, 10) || 1;
    qtyInput.min = '1';
    qtyInput.setAttribute('onchange', 'calcJob()');

    const priceTd = document.createElement('td');
    const priceInput = document.createElement('input');
    priceInput.type = 'number';
    priceInput.value = parseFloat(p.p) || 0;
    priceInput.setAttribute('onchange', 'calcJob()');

    const totalTd = document.createElement('td');
    totalTd.className = 'mono';
    totalTd.style.fontWeight = '600';
    totalTd.style.color = 'var(--gold)';
    totalTd.textContent = _fmt((p.q || 1) * (p.p || 0));

    const delTd = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.className = 'del-btn';
    delBtn.setAttribute('onclick', 'delRow(this)');
    delBtn.innerHTML = '<svg><use href="#ic-x"/></svg>';

    nameTd.appendChild(imgDiv);
    nameTd.appendChild(nameInput);
    qtyTd.appendChild(qtyInput);
    priceTd.appendChild(priceInput);
    delTd.appendChild(delBtn);

    tr.appendChild(nameTd);
    tr.appendChild(qtyTd);
    tr.appendChild(priceTd);
    tr.appendChild(totalTd);
    tr.appendChild(delTd);

    return tr;
  }

  function applyJobTemplate(idx) {
    try {
      const templates = typeof _deps.JOB_TEMPLATES === 'function' ? _deps.JOB_TEMPLATES() : _deps.JOB_TEMPLATES;
      if (!Array.isArray(templates) || !templates[idx]) { _toast('Template not found — check the templates list', 'error'); return; }
      const t = templates[idx];

      if (!t.name) {
        _toast('Template invalid — name missing', 'error');
        return;
      }

      const probEl = document.getElementById('j-prob');
      const labEl  = document.getElementById('j-lab');
      const tbody  = document.getElementById('j-parts');

      if (!probEl || !labEl || !tbody) {
        _toast('Job form is not open. Please open the Add/Edit Job modal first.', 'error');
        return;
      }
      const existingRows = tbody.tagName === 'TBODY'
        ? tbody.querySelectorAll('tr')
        : tbody.querySelectorAll('tbody tr');

      const hasExistingData = (probEl.value.trim() && probEl.value.trim() !== 'No description') ||
                              (existingRows.length > 0);
      if (hasExistingData) {
        var _tplConfirm = (window.ERP && window.ERP.confirmDialog) || function(msg, ok) { if (window.confirm(msg)) ok(); };
        _tplConfirm('Current form data overwrite ho jaye ga. Continue?', function() {
          if (probEl) probEl.value = t.prob || '';
          if (labEl)  labEl.value  = t.lab  || 0;
          const targetTbody2 = (tbody.tagName === 'TBODY') ? tbody : (tbody.querySelector('tbody') || tbody);
          targetTbody2.innerHTML = '';
          (t.parts || []).forEach(function (p) {
            targetTbody2.appendChild(_buildPartRowEl(p));
          });
        });
        return;
      }
      if (probEl) probEl.value = t.prob || '';
      if (labEl)  labEl.value  = t.lab  || 0;

      const targetTbody = (tbody.tagName === 'TBODY') ? tbody : (tbody.querySelector('tbody') || tbody);
      targetTbody.innerHTML = '';

      (t.parts || []).forEach(function (p) {
        targetTbody.appendChild(_buildPartRowEl(p));
      });

      if (typeof window.calcJob === 'function') window.calcJob();

    } catch (e) {
      console.error('[JobService] applyJobTemplate error:', e);
    }
  }

  function showJobsReport() {
    if (_notReady('showJobsReport')) return;
    try {
      const allJobs    = _state.getAll();
      const total      = allJobs.length;
      const completed  = allJobs.filter(function (j) {
        return j.status === 'completed' || j.status === 'delivered';
      }).length;
      const cancelled  = allJobs.filter(function (j) { return j.status === 'cancelled'; }).length;
      const pending    = allJobs.filter(function (j) {
        return j.status !== 'completed' && j.status !== 'delivered' && j.status !== 'cancelled';
      }).length;
      const totalLabour = allJobs.reduce(function (s, j) { return s + _labTotal(j); }, 0);

      const stColors = {
        pending:        'var(--secondary,#f59e0b)',
        'in-progress':  'var(--info,#3b82f6)',
        completed:      'var(--success,#22c55e)',
        delivered:      '#8b5cf6',
        cancelled:      'var(--danger,#ef4444)',
        'on-hold':      '#d97706',
        'waiting-parts':'#7c3aed',
      };

      const html =
        '<div style="padding:16px">' +
          '<h2 style="margin:0 0 14px;color:var(--navy)">🔧 Repair Jobs Report</h2>' +
          '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">' +
            '<div style="background:var(--info);color:#fff;border-radius:8px;padding:12px;text-align:center">' +
              '<div style="font-size:22px;font-weight:900">' + total + '</div>' +
              '<div style="font-size:11px">Total Jobs</div></div>' +
            '<div style="background:var(--success);color:#fff;border-radius:8px;padding:12px;text-align:center">' +
              '<div style="font-size:22px;font-weight:900">' + completed + '</div>' +
              '<div style="font-size:11px">Completed</div></div>' +
            '<div style="background:var(--warning);color:#fff;border-radius:8px;padding:12px;text-align:center">' +
              '<div style="font-size:22px;font-weight:900">' + pending + '</div>' +
              '<div style="font-size:11px">Pending</div></div>' +
            '<div style="background:var(--danger);color:#fff;border-radius:8px;padding:12px;text-align:center">' +
              '<div style="font-size:22px;font-weight:900">' + cancelled + '</div>' +
              '<div style="font-size:11px">Cancelled</div></div>' +
          '</div>' +
          '<div style="background:var(--primary);color:#fff;border-radius:8px;padding:10px 12px;text-align:center;margin-bottom:16px">' +
            '<span style="font-size:18px;font-weight:900">&#8360;' + (totalLabour / 1000).toFixed(1) + 'K</span>' +
            '<span style="font-size:11px;margin-left:8px">Total Labour</span>' +
          '</div>' +
          '<table class="dt" style="width:100%">' +
            '<thead><tr><th>Job#</th><th>Customer</th><th>Vehicle</th><th>Status</th>' +
            '<th style="text-align:right">Labour</th><th>Date</th></tr></thead>' +
            '<tbody>' +
            allJobs.map(function (j) {
              const sc = stColors[j.status] || 'var(--muted,#64748b)';
              return '<tr>' +
                '<td class="mono">#' + _esc(j.id) + '</td>' +
                '<td>' + _esc(j.cust || '—') + '</td>' +
                '<td>' + _esc(j.car  || '—') + '</td>' +
                '<td><span style="background:' + sc + '20;color:' + sc + ';padding:2px 8px;border-radius:20px;font-size:11px">' +
                  _esc(j.status || 'pending') + '</span></td>' +
                '<td style="text-align:right">' + _fmt(j.lab || 0) + '</td>' +
                '<td style="color:var(--muted);font-size:12px">' + _esc(j.date || '—') + '</td>' +
              '</tr>';
            }).join('') +
            '</tbody>' +
          '</table>' +
        '</div>';
      const modalEl = typeof _deps.openModalWithContent === 'function' ? document.getElementById('modal-main') : null;
      if (!modalEl) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay open';
        overlay.innerHTML =
          '<div class="modal" style="max-width:820px;max-height:92vh;overflow-y:auto">' +
            '<div class="modal-head">' +
              '<span style="font-weight:700">🔧 Jobs Report</span>' +
              '<button class="modal-close" id="_rep-close-btn">✕</button>' +
            '</div>' +
            html +
          '</div>';
        document.body.appendChild(overlay);
        overlay.querySelector('#_rep-close-btn').addEventListener('click', function () { overlay.remove(); });
        return;
      }
      _deps.openModalWithContent('modal-main', 'Jobs Report', html);
    } catch (e) {
      console.error('[JobService] showJobsReport error:', e);
      _toast('Jobs Report error: ' + e.message, 'error');
    }
  }


  function processAutoInvoice(jobId) {
    try {
      var job = _state.getById(jobId) || _state.getCurJob();
      if (!job) return null;
      if (job.invoiceId) return job.invoiceId;

      if (typeof _deps.bumpInvCount !== 'function' || typeof _deps.getSales !== 'function') return null;

      var autoId   = 'INV-' + String(_deps.bumpInvCount()).padStart(4, '0');
      var today    = _today() ;
      var items    = (job.parts || []).map(function (p) {
        return { n: p.n, q: p.q, p: p.p, d: 0, image: p.image || null };
      });
      var labAmt   = _labTotal(job);
      if (labAmt > 0) {
        var labDesc = Array.isArray(job.labourLines) && job.labourLines.length
          ? job.labourLines.map(function (ll) { return ll.desc || 'Labour'; }).join(', ')
          : (job.ld || 'Labour Charges');
        items.push({ n: labDesc, q: 1, p: labAmt, d: 0, image: null });
      }
      var total  = _grandTotal(job);
      var paid   = (Array.isArray(job.paymentHistory) ? job.paymentHistory : [])
                   .reduce(function (s, p) { return s + (p.voided ? 0 : (Number(p.amount) || 0)); }, 0);
      var inv    = {
        id: autoId, jobId: job.id, cust: job.cust, customer: job.cust,
        ph: job.ph || '', items: items, pay: 'Cash',
        paid: paid, total: total, due: Math.max(0, total - paid),
        date: today, status: paid >= total ? 'paid' : 'unpaid',
        photos: job.photos || [], paymentHistory: job.paymentHistory || [],
      };
      _deps.getSales().unshift(inv);
      try {
        if (window.ERP && window.ERP._internal && typeof window.ERP._internal.setState === 'function') {
          window.ERP._internal.setState(function (s) {
            s.data.sales = [inv].concat((s.data.sales || []).filter(function (x) { return x.id !== autoId; }));
          }, 'processAutoInvoice:' + autoId);
          try { window.sales = window.ERP._internal.getState().data.sales; } catch (_e) { console.error(_e); }
        }
      } catch (_e) { console.error(_e); }
      try {
        if (window.ERP && window.ERP._salesStorage && typeof window.ERP._salesStorage.save === 'function') {
          var _list = (window.ERP._internal ? window.ERP._internal.getState().data.sales : null) || _deps.getSales();
          window.ERP._salesStorage.save('sales', _list).catch(function (e) { console.error(e); });
        }
      } catch (_e) { console.error(_e); }
      var jobNow = _state.getById(jobId);
      if (jobNow) _state.replaceJob(jobId, Object.assign({}, jobNow, { invoiceId: autoId }));
      _persist({ jobs: _state.getAll() });
      return autoId;
    } catch (_e) {
      console.warn('[JobService] processAutoInvoice failed:', _e);
      return null;
    }
  }

  function convertJobToInvoice(jobId) {
    if (_notReady('convertJobToInvoice')) return;
    if (_authBlocked('convertJobToInvoice')) return;
    try {
      const job = _state.getById(jobId) || _state.getCurJob();
      if (!job) { _toast('Job not found', 'error'); return; }

      if (job.invoiceId) {
        var _invInState = false;
        try {
          var _stSales = window.ERP && window.ERP._internal
            ? (window.ERP._internal.getState().data.sales || [])
            : [];
          _invInState = _stSales.some(function (s) { return s.id === job.invoiceId; });
        } catch (_e) { console.error(_e); }

        if (_invInState && window.ERP && window.ERP.sales && typeof window.ERP.sales.view === 'function') {
          window.ERP.sales.view(job.invoiceId);
          return;
        }
        _openJobInvoicePrintWindow(job, 'Invoice — ' + job.invoiceId);
        return;
      }

      var _jobInvData = _buildJobInvObject(job);
      
      

      if (window.ERP && window.ERP.sales && typeof window.ERP.sales.openFromJob === 'function') {
        window.ERP.sales.openFromJob(_jobInvData);
        _toast('Invoice form opened — review and click Save', 'info', 3500);
        return;
      }

      _openJobInvoicePrintWindow(job, 'Job Invoice — ' + job.id);
      return;

    } catch (e) {
      console.error('[JobService] convertJobToInvoice error:', e);
      _toast('Convert to invoice failed', 'error');
    }
  }

  function addInternalNote(text) {
    if (_notReady('addInternalNote')) return;
    const curJob = _state.getCurJob();
    if (!curJob) { _toast('Please select a job before adding a note', 'error'); return; }
    if (!text || !text.trim()) { _toast('Note cannot be empty', 'error'); return; }
    const notes = (curJob.notes || []).slice();
    notes.push({
      text:   text.trim(),
      author: (_deps && (_deps.currentUser || (_deps.getCurrentUser && _deps.getCurrentUser()))) || _currentUserName('Admin'),
      ts:     _nowISO(),
    });
    _state.replaceJob(curJob.id, Object.assign({}, curJob, { notes: notes }));
    _persist();
    _bus.emit(_bus.EVENTS.JOBS_SELECTED, { jobId: curJob.id });
    _toast('Note added', 'success');
  }


  function addLabourLine(line) {
    if (_notReady('addLabourLine')) return;
    const curJob = _state.getCurJob();
    if (!curJob) { _toast('Please select a job before adding labour', 'error'); return; }
    const lines = (curJob.labourLines || []).slice();
    var amt = Number(line.amt) || (Number(line.hrs || 0) * Number(line.rate || line.fixed || 0)) || 0;
    lines.push({ desc: line.desc || '', mec: line.mec || '', amt: amt });
    _state.replaceJob(curJob.id, Object.assign({}, curJob, { labourLines: lines }));
    _persist();
    _bus.emit(_bus.EVENTS.JOBS_SELECTED, { jobId: curJob.id });
    _toast('Labour line added', 'success');
  }

  function deleteLabourLine(idx) {
    if (_notReady('deleteLabourLine')) return;
    const curJob = _state.getCurJob();
    if (!curJob || !curJob.labourLines) { _toast('No job selected or no labour lines exist', 'error'); return; }
    const lines = curJob.labourLines.slice();
    if (idx < 0 || idx >= lines.length) { _toast('Labour line not found — please reload', 'error'); return; }
    lines.splice(idx, 1);
    _state.replaceJob(curJob.id, Object.assign({}, curJob, { labourLines: lines }));
    _persist();
    _bus.emit(_bus.EVENTS.JOBS_SELECTED, { jobId: curJob.id });
  }


  function uploadJobPhotoEnhanced(type) {
    if (_notReady('uploadJobPhotoEnhanced')) return;
    const curJob = _state.getCurJob();
    if (!curJob) { _toast('Please select a job before uploading a photo', 'error'); return; }
    const jobId = curJob.id;

    const input    = document.createElement('input');
    input.type     = 'file';
    input.accept   = 'image/*';
    input.multiple = true;

    input.onchange = async function (e) {
      try {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        const caption = type === 'before' ? 'Before repair' : type === 'after' ? 'After repair' : '';

        const freshJob = _state.getById(jobId);
        if (!freshJob) {
          _toast('Job not found — may have been deleted', 'error');
          return;
        }

        const newPhotos = [];
        const failedFiles = [];
        for (let i = 0; i < files.length; i++) {
          try {
            let data;
            if (typeof _deps.compressImage === 'function') {
              data = await _deps.compressImage(files[i], 800, 0.75);
            } else {
              data = await _compressImage(files[i], 800, 0.75);
            }
            newPhotos.push({ data: data, type: type, caption: caption, uploadedAt: _nowISO() });
          } catch (fileErr) {
            console.warn('[JobService] photo compress failed for ' + (files[i] && files[i].name) + ':', fileErr);
            failedFiles.push(files[i] && files[i].name);
          }
        }

        if (!newPhotos.length) {
          _toast('Photo upload failed — no valid images', 'error');
          return;
        }

        const latestJob = _state.getById(jobId) || freshJob;
        const photos = (latestJob.photos || []).slice().concat(newPhotos);

        _state.replaceJob(jobId, Object.assign({}, latestJob, { photos: photos }));
        _state.resyncCurJob();
        _persist();
        _bus.emit(_bus.EVENTS.JOBS_SELECTED, { jobId: jobId });
        if (failedFiles.length) {
          _toast('⚠️ ' + newPhotos.length + ' uploaded, ' + failedFiles.length + ' failed (' + failedFiles.join(', ') + ')', 'warning', 7000);
        } else {
          _toast('✅ ' + newPhotos.length + ' photo(s) uploaded', 'success');
        }
      } catch (err) {
        console.error('[JobService] uploadJobPhotoEnhanced error:', err);
        _toast('Photo upload failed', 'error');
      }
    };
    input.click();
  }

  function _compressImage(file, maxSize, quality) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function (e) {
        const img    = new Image();
        img.onload   = function () {
          const canvas = document.createElement('canvas');
          let w = img.width, h = img.height;
          if (w > maxSize || h > maxSize) {
            if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
            else       { w = Math.round(w * maxSize / h); h = maxSize; }
          }
          canvas.width  = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = function () {
          reject(new Error('Image decode failed for file: ' + (file && file.name)));
        };
        img.src = e.target.result;
      };
      reader.onerror = function () {
        reject(reader.error || new Error('File read failed for: ' + (file && file.name)));
      };
      reader.readAsDataURL(file);
    });
  }
  function deleteJobPhotoEnhanced(jobId, photoIndex) {
    if (_notReady('deleteJobPhotoEnhanced')) return;
    var _photoConfirm = (window.ERP && window.ERP.confirmDialog) || function(msg, ok) { if (window.confirm(msg)) ok(); };
    _photoConfirm('Delete this photo?', function() {
      try {
        const job = _state.getById(jobId);
        if (!job || !job.photos) { _toast('Job or photos not found — please reload the page', 'error'); return; }
        const idx = parseInt(photoIndex, 10);
        if (isNaN(idx) || idx < 0 || idx >= job.photos.length) {
          _toast('Photo not found — please reload the page', 'error');
          return;
        }
        const photos = job.photos.slice();
        photos.splice(idx, 1);
        _state.replaceJob(jobId, Object.assign({}, job, { photos: photos }));
        _state.resyncCurJob();
        _persist();
        _bus.emit(_bus.EVENTS.JOBS_SELECTED, { jobId: jobId });
        _toast('Photo deleted', 'success');
      } catch (e) {
        console.error('[JobService] deleteJobPhotoEnhanced error:', e);
      }
    });
  }
  function editPhotoCaption(jobId, photoIndex) {
    if (_notReady('editPhotoCaption')) return;
    try {
      const job = _state.getById(jobId);
      if (!job || !job.photos || !job.photos[photoIndex]) { _toast('Photo not found — please reload the page', 'error'); return; }
      const rawCap = window.prompt('Caption:', job.photos[photoIndex].caption || '');
      if (rawCap === null) return;
      const cap = rawCap.replace(/<[^>]*>/g, '').substring(0, 200).trim();
      const photos = job.photos.slice();
      photos[photoIndex] = Object.assign({}, photos[photoIndex], { caption: cap });
      _state.replaceJob(jobId, Object.assign({}, job, { photos: photos }));
      _state.resyncCurJob();
      _persist();
      _bus.emit(_bus.EVENTS.JOBS_SELECTED, { jobId: jobId });
    } catch (e) {
      console.error('[JobService] editPhotoCaption error:', e);
    }
  }

  function openWarrantyJob(jobId) {
    if (_notReady('openWarrantyJob')) return;
    try {
      const job = jobId
        ? (_state.getById(jobId) || _state.getCurJob())
        : _state.getCurJob();
      if (!job) { _toast('No job is open', 'error'); return; }
      if (job.isWarranty === true) { _toast('This job is already marked as warranty', 'warning'); return; }

      const partsCost = (job.parts || []).reduce(function (s, p) {
        var unitCost = Number(p.pp || p.costPrice) || 0;
        return s + (Number(p.q) || 0) * unitCost;
      }, 0);
      const labTotal = _labTotal(job);
      const warrantyCost = partsCost + labTotal;

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay open';
      overlay.innerHTML =
        '<div class="modal" style="max-width:480px">' +
          '<div class="modal-head mh-purple" style="border-radius:12px 12px 0 0">' +
            '<h2 style="color:#fff;margin:0">🛡️ Warranty Job</h2>' +
            '<button class="modal-close js-wj-close" style="color:#fff;background:rgba(255,255,255,.2);border:none;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:16px">✕</button>' +
          '</div>' +
          '<div class="modal-body" style="padding:20px">' +
            '<div style="background:var(--purple-l);border:1px solid var(--info-l);border-radius:10px;padding:14px;margin-bottom:16px">' +
              '<div style="font-weight:700;color:var(--purple);margin-bottom:8px">⚠️ Warranty Claim — Customer Se Kuch Nahi Lena</div>' +
              '<div style="font-size:13px;color:var(--muted)">Is job ka invoice zero hoga. Parts aur labour ka kharcha shop ki taraf se warranty expense mein jaye ga.</div>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px">' +
              '<div style="background:var(--bg);border-radius:8px;padding:12px;text-align:center">' +
                '<div style="font-size:10px;color:var(--muted);text-transform:uppercase">Parts Cost</div>' +
                '<div style="font-size:16px;font-weight:700;color:var(--text)">' + _fmt(partsCost) + '</div>' +
              '</div>' +
              '<div style="background:var(--bg);border-radius:8px;padding:12px;text-align:center">' +
                '<div style="font-size:10px;color:var(--muted);text-transform:uppercase">Labour Cost</div>' +
                '<div style="font-size:16px;font-weight:700;color:var(--text)">' + _fmt(labTotal) + '</div>' +
              '</div>' +
              '<div style="background:var(--purple-l);border-radius:8px;padding:12px;text-align:center">' +
                '<div style="font-size:10px;color:var(--muted);text-transform:uppercase">Total Expense</div>' +
                '<div style="font-size:16px;font-weight:700;color:var(--purple)">' + _fmt(warrantyCost) + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="fgrp">' +
              '<label style="font-weight:600">Warranty Reason / Note</label>' +
              '<input class="fi js-wj-note" type="text" placeholder="e.g. Same part failed within 30 days..." style="width:100%">' +
            '</div>' +
          '</div>' +
          '<div class="modal-foot">' +
            '<button class="btn btn-ghost js-wj-cancel">Cancel</button>' +
            '<button class="btn btn-warning js-wj-confirm">🛡️ Mark as Warranty & Post Expense</button>' +
          '</div>' +
        '</div>';

      document.body.appendChild(overlay);
      overlay.querySelector('.js-wj-close').onclick   = function () { overlay.remove(); };
      overlay.querySelector('.js-wj-cancel').onclick  = function () { overlay.remove(); };

      overlay.querySelector('.js-wj-confirm').onclick = function () {
        const btn  = this;
        const note = (overlay.querySelector('.js-wj-note').value || '').trim();
        btn.disabled = true;
        btn.textContent = 'Processing...';

        try {
          const today = _today() ;

          const updatedJob = _state.getById(job.id);
          if (!updatedJob) {
            _toast('Job not found — it may have been deleted', 'error');
            btn.disabled = false;
            btn.textContent = '🛡️ Mark as Warranty & Post Expense';
            return;
          }
          _state.replaceJob(job.id, Object.assign({}, updatedJob, {
            isWarranty:    true,
            warrantyNote:  note,
            warrantyDate:  today,
            status:        'completed',
          }));

          var _glPosted = false;
          try {
            var ACC = window.AccountingCore;
            if (ACC && ACC.AccountingState && ACC.AccountingState.isInitialized() && warrantyCost > 0) {
              var glSourceId = 'WARRANTY-' + job.id;
              if (!ACC.AccountingState.journalExistsForSource(glSourceId)) {
                var amtPaisa = Math.round(warrantyCost * 100);
                _glPosted = true;
                var _warrantyExpAcct = (ACC.SYSTEM_ACCOUNTS && ACC.SYSTEM_ACCOUNTS.WARRANTY_EXP) || 'acc-5500';
                ACC.JournalService.post({
                  date:         today,
                  reference:    job.id,
                  sourceModule: 'sales',
                  sourceId:     glSourceId,
                  memo:         'Warranty expense — Job ' + job.id + (note ? ' — ' + note : ''),
                  party:        job.cust || '',
                  entries: [
                    {
                      accountId:   _warrantyExpAcct,
                      debit:       amtPaisa,
                      credit:      0,
                      description: 'Warranty cost — Parts + Labour',
                    },
                    {
                      accountId:   ACC.SYSTEM_ACCOUNTS.AR,
                      debit:       0,
                      credit:      amtPaisa,
                      description: 'AR waived — Warranty claim Job ' + job.id,
                    },
                  ],
                }, 'system')
                .catch(function (e) { console.warn('[JobService] Warranty GL error:', e); });
              } else {
                _glPosted = true;
              }
            }
          } catch (accErr) {
            console.warn('[JobService] Warranty GL entry error (non-fatal):', accErr);
          }

          _persist({ jobs: _state.getAll() });
          _bus.emit(_bus.EVENTS.JOBS_SELECTED, { jobId: job.id });
          try { if (typeof _deps.renderDashWidgets === 'function') _deps.renderDashWidgets(); } catch (e) { console.error(e); }

          overlay.remove();
          if (warrantyCost > 0 && !_glPosted) {
            _toast('⚠️ Warranty job marked, but the expense GL post failed — please have accounts check manually', 'warning', 8000);
          } else if (warrantyCost <= 0) {
            _toast('✅ Warranty job processed — no expense (parts/labour cost is zero)', 'success', 6000);
          } else {
            _toast('✅ Warranty job processed — ' + _fmt(warrantyCost) + ' expense posted', 'success', 6000);
          }
        } catch (e) {
          console.error('[JobService] Warranty job error:', e);
          btn.disabled = false;
          btn.textContent = '🛡️ Mark as Warranty & Post Expense';
          _toast('Warranty processing failed', 'error');
        }
      };

    } catch (e) {
      console.error('[JobService] openWarrantyJob error:', e);
    }
  }

  function voidPayment(jobId, payEntryId) {
    if (_notReady('voidPayment')) return;
    if (_authBlocked('voidPayment', 'voidPayment')) return;
    try {
      const job = _state.getById(jobId);
      if (!job) { _toast('Job not found', 'error'); return; }

      const payHistory = Array.isArray(job.paymentHistory) ? job.paymentHistory : [];
      const payIdx     = payHistory.findIndex(function (p) { return String(p.id) === String(payEntryId); });
      if (payIdx === -1) { _toast('Payment entry not found', 'error'); return; }

      const entry = payHistory[payIdx];
      if (entry.voided) { _toast('This payment is already void', 'warning'); return; }

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay open';
      overlay.innerHTML =
        '<div class="modal" style="max-width:440px">' +
          '<div class="modal-head mh-red" style="border-radius:12px 12px 0 0">' +
            '<h2 style="color:#fff;margin:0">🚫 Void Payment</h2>' +
            '<button class="js-void-close" style="color:#fff;background:rgba(255,255,255,.2);border:none;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:16px">✕</button>' +
          '</div>' +
          '<div class="modal-body" style="padding:20px">' +
            '<div style="background:var(--danger-m);border:1px solid var(--danger-l);border-radius:10px;padding:14px;margin-bottom:16px">' +
              '<div style="font-weight:700;color:var(--danger);margin-bottom:6px">⚠️ Yeh action reversible nahi hai</div>' +
              '<div style="font-size:13px;color:var(--danger-d)">Original entry void mark ho jaye gi aur GL reversal entry post ho gi. Customer balance adjust ho ga.</div>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">' +
              '<div style="background:var(--bg);border-radius:8px;padding:12px">' +
                '<div style="font-size:10px;color:var(--muted);text-transform:uppercase">Payment Date</div>' +
                '<div style="font-size:14px;font-weight:700">' + _esc(entry.date || '') + '</div>' +
              '</div>' +
              '<div style="background:var(--bg);border-radius:8px;padding:12px">' +
                '<div style="font-size:10px;color:var(--muted);text-transform:uppercase">Method</div>' +
                '<div style="font-size:14px;font-weight:700">' + _esc(entry.method || 'Cash') + '</div>' +
              '</div>' +
              '<div style="background:var(--danger-m);border-radius:8px;padding:12px;grid-column:1/-1">' +
                '<div style="font-size:10px;color:var(--muted);text-transform:uppercase">Amount Being Voided</div>' +
                '<div style="font-size:20px;font-weight:800;color:var(--danger)">' + _fmt(entry.amount) + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="fgrp">' +
              '<label style="font-weight:600">Void Reason (required)</label>' +
              '<input class="fi js-void-reason" type="text" placeholder="e.g. Galat amount darj hua tha..." style="width:100%">' +
            '</div>' +
          '</div>' +
          '<div class="modal-foot">' +
            '<button class="btn btn-ghost js-void-cancel">Cancel</button>' +
            '<button class="btn btn-danger js-void-confirm">🚫 Void This Payment</button>' +
          '</div>' +
        '</div>';

      document.body.appendChild(overlay);
      overlay.querySelector('.js-void-close').onclick  = function () { overlay.remove(); };
      overlay.querySelector('.js-void-cancel').onclick = function () { overlay.remove(); };

      overlay.querySelector('.js-void-confirm').onclick = function () {
        const reason = (overlay.querySelector('.js-void-reason').value || '').trim();
        if (!reason) { _toast('A void reason is required', 'error'); return; }

        const btn = this;
        btn.disabled = true;
        btn.textContent = 'Processing...';

        try {
          const today = _today() ;
          const freshJob = _state.getById(jobId);
          if (!freshJob) {
            _toast('Job not found', 'error');
            btn.disabled = false;
            btn.textContent = '🚫 Void This Payment';
            return;
          }

          const freshHistory = Array.isArray(freshJob.paymentHistory) ? freshJob.paymentHistory.slice() : [];
          const freshIdx     = freshHistory.findIndex(function (p) { return String(p.id) === String(payEntryId); });
          if (freshIdx === -1) {
            _toast('Payment entry not found', 'error');
            btn.disabled = false;
            btn.textContent = '🚫 Void This Payment';
            return;
          }

          freshHistory[freshIdx] = Object.assign({}, freshHistory[freshIdx], {
            voided:     true,
            voidedAt:   today,
            voidReason: reason,
          });

          const newTotalPaid = freshHistory.reduce(function (s, p) {
            return s + (p.voided ? 0 : (Number(p.amount) || 0));
          }, 0);
          const totalDue  = _grandTotal(freshJob);
          const newBal    = Math.max(0, totalDue - newTotalPaid);
          const newStatus = newBal <= 0 ? 'completed' : (freshJob.status === 'completed' ? 'in-progress' : freshJob.status);

          _state.replaceJob(jobId, Object.assign({}, freshJob, {
            paymentHistory: freshHistory,
            paidAmount:     newTotalPaid,
            status:         newStatus,
          }));

          if (freshJob.invoiceId && typeof _deps.getSales === 'function') {
            const sales  = _deps.getSales();
            const invIdx = sales.findIndex(function (s) { return s.id === freshJob.invoiceId; });
            if (invIdx !== -1) {
              sales[invIdx].paid   = newTotalPaid;
              sales[invIdx].due    = newBal;
              sales[invIdx].status = newBal <= 0 ? 'paid' : 'partial';
              sales[invIdx].paymentHistory = freshHistory;
            }
            try {
              if (window.ERP && window.ERP._internal && typeof window.ERP._internal.setState === 'function') {
                window.ERP._internal.setState(function (st) {
                  var stIdx = (st.data.sales || []).findIndex(function (x) { return x.id === freshJob.invoiceId; });
                  if (stIdx !== -1) {
                    st.data.sales[stIdx].paid           = newTotalPaid;
                    st.data.sales[stIdx].due            = newBal;
                    st.data.sales[stIdx].status         = newBal <= 0 ? 'paid' : 'partial';
                    st.data.sales[stIdx].paymentHistory = freshHistory;
                  }
                }, 'job:void:' + payEntryId);
              }
            } catch (_stErr) {
              console.warn('[JobService] voidPayment ERP state sync failed (non-fatal):', _stErr);
            }
            try {
              if (window.ERP && window.ERP._salesStorage && typeof window.ERP._salesStorage.save === 'function') {
                var _idbVoidSales = (window.ERP._internal ? window.ERP._internal.getState().data.sales : null)
                                   || sales;
                window.ERP._salesStorage.save('sales', _idbVoidSales).catch(function (e) {
                  if (window.DEBUG_MODE) console.warn('[JobService] voidPayment IDB persist failed:', e);
                });
              }
            } catch (_idbErr) {
              if (window.DEBUG_MODE) console.warn('[JobService] voidPayment IDB persist threw:', _idbErr);
            }
          }

          try {
            var _pe2Void = window.ERP && window.ERP.PostingEngine;
            if (_pe2Void && typeof _pe2Void.reverse === 'function') {
              var _origPayDocId = 'JOB-PAY-' + payEntryId;
              if (typeof _pe2Void.isPosted === 'function' && _pe2Void.isPosted(_origPayDocId)) {
                _pe2Void.reverse(_origPayDocId, { reason: 'Payment voided: ' + payEntryId, actor: 'system' })
                  .catch(function (e) { console.warn('[JobService] voidPayment PE reverse error:', e && e.message); });
              }
            }
          } catch (accErr) {
            console.warn('[JobService] Void GL entry error (non-fatal):', accErr);
          }

          if (freshJob._stockDeducted && newTotalPaid <= 0) {
            try {
              var _pe2 = window.ERP && window.ERP.PostingEngine;
              if (_pe2 && typeof _pe2.reverse === 'function') {
                if (freshJob.invoiceId && typeof _pe2.isPosted === 'function' && _pe2.isPosted('SALE-REV-' + freshJob.invoiceId)) {
                  _pe2.reverse('SALE-REV-' + freshJob.invoiceId, { reason: 'Payment voided: ' + payEntryId, actor: 'system' })
                    .catch(function (e) { console.warn('[JobService] Void Revenue reversal error:', e && e.message); });
                }
                if (freshJob.invoiceId && typeof _pe2.isPosted === 'function' && _pe2.isPosted('SALE-COGS-' + freshJob.invoiceId)) {
                  _pe2.reverse('SALE-COGS-' + freshJob.invoiceId, { reason: 'Payment voided: ' + payEntryId, actor: 'system' })
                    .catch(function (e) { console.warn('[JobService] Void COGS reversal error:', e && e.message); });
                }
                if (typeof _pe2.isPosted === 'function' && _pe2.isPosted('JOB-COGS-' + jobId)) {
                  _pe2.reverse('JOB-COGS-' + jobId, { reason: 'Payment voided: ' + payEntryId, actor: 'system' })
                    .catch(function (e) { console.warn('[JobService] Void JOB-COGS reversal error:', e && e.message); });
                }
              }
            } catch (_revErr) {
              console.warn('[JobService] Void GL reversal error (non-fatal):', _revErr);
            }
          }

          if (typeof _deps.getCustomers === 'function') {
            const customers = _deps.getCustomers();
            const custObj   = customers && customers.find(function (cu) {
              return (cu.n || '').toLowerCase() === (freshJob.cust || '').toLowerCase();
            });
            if (custObj) {
              var _custSvcVoid = (typeof ERP !== 'undefined' && ERP && ERP._svc && ERP._svc.customers) ? ERP._svc.customers : null;
              if (_custSvcVoid && typeof _custSvcVoid.updateBalance === 'function') {
                _custSvcVoid.updateBalance(custObj.n || freshJob.cust, { salesDelta: -entry.amount });
              } else {
                custObj.sales = Math.max(0, (custObj.sales || 0) - entry.amount);
              }
            }
          }
          if (window.ERP && ERP._Ledger && typeof ERP._Ledger.createPaymentVoidEntry === 'function') {
            try {
              var _voidCustId = freshJob.customerId || freshJob.cust || '';
              var _voidLedgerEntry = ERP._Ledger.createPaymentVoidEntry(String(_voidCustId), payEntryId, entry.amount, today);
              if (_voidLedgerEntry) {
                ERP._atomicSave([{ store: 'customerLedger', op: 'pushAll', records: [_voidLedgerEntry] }])
                  .catch(function (e) { console.warn('[JobService] voidPayment ledger entry save failed:', e); });
              }
            } catch (_ledVoidErr) {
              console.warn('[JobService] voidPayment ledger entry error (non-fatal):', _ledVoidErr);
            }
          }

          _persist({ jobs: _state.getAll() });
          _bus.emit(_bus.EVENTS.JOBS_SELECTED, { jobId: jobId });

          try {
            const _jobAfterVoid = _state.getById(jobId);
            if (_jobAfterVoid && _jobAfterVoid._stockDeducted && newTotalPaid <= 0) {
              var _invSvcVoid = window.ERP && window.ERP.InventoryService;
              if (_invSvcVoid && typeof _invSvcVoid.restore === 'function') {
                var _partsToRestore = (_jobAfterVoid.parts || []).filter(function (p) { return p.bc && !p._isLabour; });
                if (_partsToRestore.length > 0) {
                  var _restoreEntriesVoid = _partsToRestore.map(function (p) {
                    return { barcode: p.bc, qty: Number(p.q || p.qty || 1), unitCostPaisa: Math.round((p.pp || p.costPrice || 0) * 100) };
                  });
                  _invSvcVoid.restore(_restoreEntriesVoid, {
                    sourceModule: 'job_void', documentId: 'VOID-' + payEntryId, actor: 'system'
                  });
                  _state.replaceJob(jobId, Object.assign({}, _jobAfterVoid, { _stockDeducted: false }));
                }
              }
            }
          } catch (_voidStockErr) {
            console.warn('[JobService] voidPayment: stock restore error (non-fatal):', _voidStockErr);
          }
          try { if (typeof _deps.renderDashWidgets === 'function') _deps.renderDashWidgets(); } catch (e) { console.error(e); }
          try { if (typeof _deps.renderCustomers   === 'function') _deps.renderCustomers();   } catch (e) { console.error(e); }
          setTimeout(function() { try { if (typeof _deps.renderSales === 'function') _deps.renderSales(); } catch (e) { console.error(e); } }, 300);

          overlay.remove();
          _toast('🚫 Payment voided — ' + _fmt(entry.amount) + ' reversed', 'success', 6000);
        } catch (e) {
          console.error('[JobService] voidPayment confirm error:', e);
          btn.disabled = false;
          btn.textContent = '🚫 Void This Payment';
          _toast('Void failed', 'error');
        }
      };

    } catch (e) {
      console.error('[JobService] voidPayment error:', e);
    }
  }

  var _creditReturnInProgress = {};
  function issueCreditReturn(customerId) {
    if (_notReady('issueCreditReturn')) return;
    if (_authBlocked('issueCreditReturn', 'issueCreditReturn')) return;
    try {
      let custObj = null;

      if (typeof _deps.getCustomers === 'function') {
        const customers = _deps.getCustomers();
        if (customerId) {
          custObj = customers.find(function (c) { return c.id === customerId || c.n === customerId; });
        }
      }

      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay open';

      const custName  = custObj ? (custObj.n || custObj.name || '') : '';
      const custBal   = custObj ? Math.max(0, Number(custObj.credit) || 0) : 0;

      overlay.innerHTML =
        '<div class="modal" style="max-width:480px">' +
          '<div class="modal-head mh-teal" style="border-radius:12px 12px 0 0">' +
            '<h2 style="color:#fff;margin:0">↩️ Credit Return / Refund</h2>' +
            '<button class="js-cr-close" style="color:#fff;background:rgba(255,255,255,.2);border:none;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:16px">✕</button>' +
          '</div>' +
          '<div class="modal-body" style="padding:20px">' +
            '<div style="background:var(--info-m);border:1px solid var(--info-l);border-radius:10px;padding:14px;margin-bottom:16px">' +
              '<div style="font-weight:700;color:var(--info-d);margin-bottom:4px">ℹ️ Customer ko paisa wapas karna</div>' +
              '<div style="font-size:13px;color:var(--muted)">Cash ya bank se customer ko refund dein. GL mein Refund Expense debit aur Cash/Bank credit ho ga.</div>' +
            '</div>' +

            '<div class="fgrp" style="margin-bottom:12px">' +
              '<label style="font-weight:600">Customer Name</label>' +
              '<input class="fi js-cr-cust" type="text" value="' + _esc(custName) + '" placeholder="Customer ka naam likhen..." style="width:100%">' +
            '</div>' +

            (custBal > 0
              ? '<div style="background:var(--success-m);border:1px solid var(--success-l);border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">' +
                  '<span style="font-size:13px;color:var(--success-d);font-weight:600">💳 Credit Balance Available</span>' +
                  '<span style="font-size:16px;font-weight:800;color:var(--success)">' + _fmt(custBal) + '</span>' +
                '</div>'
              : ''
            ) +

            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
              '<div class="fgrp">' +
                '<label style="font-weight:600">Refund Amount</label>' +
                '<input class="fi js-cr-amount" type="number" min="1" step="1"' +
                  (custBal > 0 ? ' value="' + custBal + '"' : '') +
                  ' placeholder="Rs. amount..." style="font-size:18px;font-weight:700">' +
              '</div>' +
              '<div class="fgrp">' +
                '<label style="font-weight:600">Return Method</label>' +
                '<select class="fi js-cr-method">' +
                  '<option>Cash</option>' +
                  '<option>Bank Transfer</option>' +
                  '<option>JazzCash</option>' +
                  '<option>EasyPaisa</option>' +
                '</select>' +
              '</div>' +
            '</div>' +

            '<div class="fgrp">' +
              '<label style="font-weight:600">Reference / Note</label>' +
              '<input class="fi js-cr-note" type="text" placeholder="Cheque no, transfer ref, reason..." style="width:100%">' +
            '</div>' +
          '</div>' +
          '<div class="modal-foot">' +
            '<button class="btn btn-ghost js-cr-cancel">Cancel</button>' +
            '<button class="btn btn-info js-cr-confirm">↩️ Issue Refund</button>' +
          '</div>' +
        '</div>';

      document.body.appendChild(overlay);
      overlay.querySelector('.js-cr-close').onclick  = function () { overlay.remove(); };
      overlay.querySelector('.js-cr-cancel').onclick = function () { overlay.remove(); };

      overlay.querySelector('.js-cr-confirm').onclick = async function () {
        const btn        = this;
        const custName   = (overlay.querySelector('.js-cr-cust').value   || '').trim();
        const amount     = Math.max(0, parseFloat(overlay.querySelector('.js-cr-amount').value) || 0);
        const method     = overlay.querySelector('.js-cr-method').value;
        const note       = (overlay.querySelector('.js-cr-note').value || '').trim();

        if (!custName) { _toast('Customer naam likhein', 'error'); return; }
        if (!amount)   { _toast('Amount 0 se zyada hona chahiye', 'error'); return; }
        if (_creditReturnInProgress[custName]) return;
        _creditReturnInProgress[custName] = true;

        btn.disabled    = true;
        btn.textContent = 'Processing...';

        var _glPostOk = true;

        try {
          const today = _today() ;
          const _refundId = 'JOBREF-' + ERP.uid(); // FIX (root cause, audit #61-62): was Date.now()+_randomSuffix(); route through the one canonical generator.

          var _refundCustId = '';
          if (typeof _deps.getCustomers === 'function') {
            const customers = _deps.getCustomers();
            const cu = customers.find(function (c) {
              return (c.n || c.name || '').toLowerCase() === custName.toLowerCase();
            });
            if (cu) {
              var _custSvcRefund = (typeof ERP !== 'undefined' && ERP && ERP._svc && ERP._svc.customers) ? ERP._svc.customers : null;
              if (_custSvcRefund && typeof _custSvcRefund.updateBalance === 'function') {
                _custSvcRefund.updateBalance(cu.n || custName, { creditDelta: -amount });
              } else {
                cu.credit = Math.max(0, (Number(cu.credit) || 0) - amount);
                _persist();
              }
              _refundCustId = String(cu.id || cu.n || custName);
            }
          }
          if (!_refundCustId) _refundCustId = custName;
          if (window.ERP && ERP._Ledger && typeof ERP._Ledger.createRefundEntry === 'function') {
            try {
              var _refundLedgerEntry = ERP._Ledger.createRefundEntry(_refundCustId, _refundId, amount, today);
              if (_refundLedgerEntry) {
                ERP._atomicSave([{ store: 'customerLedger', op: 'pushAll', records: [_refundLedgerEntry] }])
                  .catch(function (e) { console.warn('[JobService] issueCreditReturn ledger entry save failed:', e); });
              }
            } catch (_refLedErr) {
              console.warn('[JobService] issueCreditReturn ledger entry error (non-fatal):', _refLedErr);
            }
          }

          try {
            var ACC = window.AccountingCore;
            if (ACC && ACC.AccountingState && ACC.AccountingState.isInitialized()) {
              var SA = ACC.SYSTEM_ACCOUNTS;
              var bankAcctId = (method || '').toLowerCase() === 'cash' ? SA.CASH : SA.BANK;
              var bankTxId   = 'BTX-' + _refundId;
              var bankTx = {
                id:            bankTxId,
                date:          today,
                bankAccountId: bankAcctId,
                type:          'withdrawal',
                amountPaisa:   Math.round(amount * 100),
                description:   'Refund to customer: ' + custName + (note ? ' — ' + note : ''),
                reference:     'REFUND-' + today,
                reconciled:    false,
                reversed:      false,
                sourceModule:  'sales',
                createdAt:     _nowISO(),
                createdBy:     _currentUserName('system'),
              };
              ACC.AccountingState.addBankTransaction(bankTx);
              if (!Array.isArray(window.bankTransactions)) window.bankTransactions = [];
              window.bankTransactions.unshift(bankTx);

              var glSourceId = 'REFUND-' + _refundId;
              if (!ACC.AccountingState.journalExistsForSource(glSourceId)) {
                var amtPaisa = Math.round(amount * 100);
                var _refundExpAcct = SA.SALES_RETURNS;
                try {
                  await ACC.JournalService.post({
                    date:         today,
                    reference:    'REFUND-' + today,
                    sourceModule: 'sales',
                    sourceId:     glSourceId,
                    memo:         'Credit return to ' + custName + (note ? ' — ' + note : ''),
                    party:        custName,
                    entries: [
                      {
                        accountId:   _refundExpAcct,
                        debit:       amtPaisa,
                        credit:      0,
                        description: 'Refund issued — ' + custName,
                      },
                      {
                        accountId:   bankAcctId,
                        debit:       0,
                        credit:      amtPaisa,
                        description: method + ' paid out to ' + custName,
                      },
                    ],
                  }, 'system');
                } catch (glPostErr) {
                  _glPostOk = false;
                  console.warn('[JobService] Refund GL error:', glPostErr);
                }
              }
            }
          } catch (accErr) {
            _glPostOk = false;
            console.warn('[JobService] Credit return GL error (non-fatal):', accErr);
          }

          try { if (typeof _deps.renderCustomers   === 'function') _deps.renderCustomers();   } catch (e) { console.error(e); }
          try { if (typeof _deps.renderDashWidgets === 'function') _deps.renderDashWidgets(); } catch (e) { console.error(e); }

          overlay.remove();
          if (_glPostOk) {
            _toast('✅ Refund ' + _fmt(amount) + ' (' + method + ') issued to ' + custName, 'success', 6000);
          } else {
            _toast('⚠️ Refund ' + _fmt(amount) + ' recorded for ' + custName + ', lekin GL post fail hua — accounts ko manually check karayein (ref: ' + _refundId + ')', 'error', 9000);
          }
          delete _creditReturnInProgress[custName];
        } catch (e) {
          console.error('[JobService] issueCreditReturn confirm error:', e);
          btn.disabled    = false;
          btn.textContent = '↩️ Issue Refund';
          _toast('Refund failed', 'error');
          delete _creditReturnInProgress[custName];
        }
      };

    } catch (e) {
      console.error('[JobService] issueCreditReturn error:', e);
    }
  }

  return {
    init,

    saveJob,
    deleteJob,
    updateJobStatus,
    updateJobStage,

    bulkDeleteJobs,
    bulkUpdateStatus,

    customerApproveJob,

    deleteJobPart,

    collectPayment,
    processPayment,
    processAutoInvoice,

    openJobWA,

    printJobCard,
    exportJobPDF,
    exportJobsExcel,
    exportJobsPDF,

    openJobTemplates,
    applyJobTemplate,

    showJobsReport,
    convertJobToInvoice,

    addInternalNote,

    labTotal: _labTotal,
    grandTotal: _grandTotal,

    addLabourLine,
    deleteLabourLine,

    uploadJobPhotoEnhanced,
    deleteJobPhotoEnhanced,
    editPhotoCaption,

    openWarrantyJob,
    voidPayment,
    issueCreditReturn,

    checkComeback: _checkComeback,
  };

})();

if (typeof window !== "undefined") window.JobService = JobService;
