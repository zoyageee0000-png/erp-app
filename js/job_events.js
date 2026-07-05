
(function () {
  'use strict';

  if (window._jobEventsModuleInitDone) {
    if (window.DEBUG_MODE) console.log('[job.events] job_events.js already ran — skipping init');
    return;
  }
  window._jobEventsModuleInitDone = true;

  var REQUIRED = [
    'EventBus', 'StorageAdapter',
    'JobState', 'JobService', 'JobUI',
    'VehicleState', 'VehicleService', 'VehicleUI',
    'AppointmentState', 'AppointmentService', 'AppointmentUI',
    'CrossService',
  ];

  var missing = REQUIRED.filter(function (name) {
    return typeof window[name] === 'undefined';
  });

  if (missing.length) {
    console.error('[job.events] Missing modules — check script load order:', missing);
  }


  function _providers() {
    return {
      jobs:             function () { return JobState.getJobs(); },
      vehicles:         function () { return VehicleState.getVehicles(); },
      appointments:     function () { return AppointmentState.getAppointments(); },
      mechanics:        function () { return typeof mechanics !== 'undefined' ? mechanics : []; },
      inventory:        function () { return typeof inventory        !== 'undefined' ? inventory        : []; },
      customers:        function () { return typeof customers        !== 'undefined' ? customers        : []; },
      suppliers:        function () { return typeof suppliers        !== 'undefined' ? suppliers        : []; },
      sales:            function () { return typeof sales            !== 'undefined' ? sales            : []; },
      purchases:        function () { return typeof purchases        !== 'undefined' ? purchases        : []; },
      expenses:         function () { return typeof expenses         !== 'undefined' ? expenses         : []; },
      bankTransactions: function () { return typeof bankTransactions !== 'undefined' ? bankTransactions : []; },
      cheques:          function () { return typeof cheques          !== 'undefined' ? cheques          : []; },
      stockMovements:   function () { return typeof stockMovements   !== 'undefined' ? stockMovements   : []; },
      invCount:         function () { return typeof invCount         !== 'undefined' ? invCount         : 0;  },
      jobCount:         function () { return JobState.getJobCount(); },
      partCount:        function () {
        if (typeof partCount !== 'undefined') return partCount;
        if (typeof inventory !== 'undefined' && Array.isArray(inventory)) {
          return inventory.filter(function (i) { return i.type === 'part' || !i.type; }).length;
        }
        return 0;
      },
    };
  }


  var _tabId = 'tab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

  StorageAdapter.init(_tabId, function onExternalChange() {
    var result, snap;
    try {
      result = StorageAdapter.load();
    } catch (e) {
      console.warn('[job.events] onExternalChange load failed:', e);
      if (typeof showToast === 'function') {
        showToast('⚠️ Failed to sync latest data. Please refresh.', 'error', 6000);
      }
      return;
    }
    if (!result || !result.data) return;
    snap = result.data;
    var hasJobs = Array.isArray(snap.jobs);
    var hasVehicles = Array.isArray(snap.vehicles);
    var hasAppointments = Array.isArray(snap.appointments);
    var failed = false;

    if (hasJobs) {
      try {
        JobState.setJobs(snap.jobs);
        EventBus.emit(EventBus.EVENTS.JOBS_CHANGED, { jobs: JobState.getJobs() });
      } catch (e) {
        failed = true;
        console.warn('[job.events] onExternalChange jobs sync failed:', e);
      }
    }
    if (hasVehicles) {
      try {
        VehicleState.setVehicles(snap.vehicles);
        EventBus.emit(EventBus.EVENTS.VEHICLES_CHANGED, { vehicles: VehicleState.getVehicles() });
      } catch (e) {
        failed = true;
        console.warn('[job.events] onExternalChange vehicles sync failed:', e);
      }
    }
    if (hasAppointments) {
      try {
        AppointmentState.setAppointments(snap.appointments);
        EventBus.emit(EventBus.EVENTS.APPOINTMENTS_CHANGED, { appointments: AppointmentState.getAppointments() });
      } catch (e) {
        failed = true;
        console.warn('[job.events] onExternalChange appointments sync failed:', e);
      }
    }
    if (failed && typeof showToast === 'function') {
      showToast('⚠️ Failed to sync latest data. Please refresh.', 'error', 6000);
    }
  });


  JobState.init(EventBus);


  VehicleState.init(
    EventBus,
    function () { return JobState.getJobs(); },
    function (id, patch) { JobState.updateJob(id, patch); }
  );


  AppointmentState.init(EventBus);


  JobService.init({
    state:   JobState,
    storage: StorageAdapter,
    bus:     EventBus,
    getProviders: _providers,
    showToast:    function (m, t, d) { if (typeof showToast    === 'function') showToast(m, t, d); },
    closeModal:   function (id)      { if (typeof closeModal   === 'function') closeModal(id);    },
    openModal:    function (id)      { if (typeof openModal    === 'function') openModal(id);     },
    escapeHtml:   function (str)     { if (typeof escapeHtml   === 'function') return escapeHtml(str); return String(str || '').replace(/[&<>"']/g, function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);}); },
    formatCurrency: function (n)     { return '\u20a8' + (Number(n) || 0).toLocaleString(); },
    snapshot:     function (label)   { if (typeof _snapshot    === 'function') _snapshot(label);  },
    renderDashJobs:    function () { if (typeof renderDashJobs    === 'function') renderDashJobs();    },
    renderDashWidgets: function () { if (typeof renderDashWidgets === 'function') renderDashWidgets(); },
    getBadgeEl:   function ()        { return document.getElementById('repair-badge'); },
    bizName:      typeof bizName  !== 'undefined' ? bizName  : 'MH Autos',
    bizPhone:     typeof bizPhone !== 'undefined' ? bizPhone : '',
    getSales:     function ()        { return typeof sales     !== 'undefined' ? sales     : []; },
    getCustomers: function ()        { return typeof customers !== 'undefined' ? customers : []; },
    bumpInvCount: function ()        {
      if (typeof bumpInvCount === 'function') return bumpInvCount();
      window._invCount = (window._invCount || 0) + 1;
      StorageAdapter.schedule(_providers());
      return window._invCount;
    },
    openInvModal: function ()        { if (typeof openInvModal === 'function') openInvModal(); },
    addInvRow:    function ()        { if (typeof addInvRow    === 'function') addInvRow();    },
    renderSales:       function () { if (typeof renderSales       === 'function') renderSales();       },
    renderInvList:     function () { if (typeof renderInvList     === 'function') renderInvList();     },
    renderSaleLedger:  function () { if (typeof renderSaleLedger  === 'function') renderSaleLedger();  },
    renderCustomers:   function () { if (typeof renderCustomers   === 'function') renderCustomers();   },
    buildCharts:       function () { if (typeof buildCharts       === 'function') buildCharts();       },
    updateStockOnSale: function (items, docId) { if (typeof updateStockOnSale === 'function') updateStockOnSale(items, docId); },
    openModalWithContent: function (id, title, html) { if (typeof openModalWithContent === 'function') openModalWithContent(id, title, html); },
    formatPhone:  function (ph)      { return typeof formatPhone === 'function' ? formatPhone(ph) : ph; },
    JOB_TEMPLATES: function() { return typeof JOB_TEMPLATES !== 'undefined' ? JOB_TEMPLATES : []; },
  });


  VehicleService.init(VehicleState, StorageAdapter, EventBus, {
    getProviders: _providers,
    showToast:  function (m, t, d) { if (typeof showToast  === 'function') showToast(m, t, d); },
    closeModal: function (id)      { if (typeof closeModal  === 'function') closeModal(id);    },
    formatPhone: function (ph)     { return typeof formatPhone === 'function' ? formatPhone(ph) : ph; },
    getCustomers: function ()      { return typeof customers !== 'undefined' ? customers : []; },
    bizName:      typeof bizName  !== 'undefined' ? bizName  : 'MH Autos',
  });


  AppointmentService.init(
    AppointmentState,
    StorageAdapter,
    EventBus,
    {
      showToast:    function (m, t, d) { if (typeof showToast  === 'function') showToast(m, t, d); },
      getMechanics: function ()        {
        try {
          return (typeof WorkshopStaff !== 'undefined' && WorkshopStaff && typeof WorkshopStaff.getAll === 'function')
            ? WorkshopStaff.getAll()
            : (typeof mechanics !== 'undefined' ? mechanics : []);
        } catch (e) {
          console.warn('[job.events] getMechanics failed:', e);
          return typeof mechanics !== 'undefined' ? mechanics : [];
        }
      },
      getProviders: _providers,
      snapshot:     function (label)   { if (typeof _snapshot   === 'function') _snapshot(label);  },
      openJobModal: function ()        { JobUI.openJobModal(); },
      prefillJobForm: function (appt)  { CrossService.fillJobFormFromAppt && CrossService.fillJobFormFromAppt(appt); },
    }
  );


  JobUI.init(JobState, JobService, EventBus, {
    renderDashJobs:    function () { if (typeof renderDashJobs    === 'function') renderDashJobs();    },
    renderDashWidgets: function () { if (typeof renderDashWidgets === 'function') renderDashWidgets(); },
    showToast:  function (m, t, d) { if (typeof showToast  === 'function') showToast(m, t, d); },
    closeModal: function (id)      { if (typeof closeModal  === 'function') closeModal(id);    },
    openModal:  function (id)      { if (typeof openModal   === 'function') openModal(id);     },
    escapeHtml: function (str)     { if (typeof escapeHtml  === 'function') return escapeHtml(str); return String(str || '').replace(/[&<>"']/g, function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);}); },
    formatCurrency: function (n)   { return '\u20a8' + (Number(n) || 0).toLocaleString(); },
    labTotal:  function (job)        { return JobService.labTotal ? JobService.labTotal(job) : 0; },
    bizName:  function () { return typeof bizName  !== 'undefined' ? bizName  : 'MH Autos'; },
    bizPhone: function () { return typeof bizPhone !== 'undefined' ? bizPhone : '';        },
    persistNow: function () { try { StorageAdapter.schedule(_providers()); } catch (e) { console.warn('[job.events] persistNow failed:', e); } },
  });


  VehicleUI.init(VehicleState, VehicleService, EventBus, {
    showToast:  function (m, t, d) { if (typeof showToast  === 'function') showToast(m, t, d); },
    closeModal: function (id)      { if (typeof closeModal  === 'function') closeModal(id);    },
    openModal:  function (id)      { if (typeof openModal   === 'function') openModal(id);     },
    escapeHtml: function (str)     { if (typeof escapeHtml  === 'function') return escapeHtml(str); return String(str || ''); },
    formatCurrency: function (n)   { return '\u20a8' + (Number(n) || 0).toLocaleString(); },
    bizName:  function () { return typeof bizName  !== 'undefined' ? bizName  : 'MH Autos'; },
    bizPhone: function () { return typeof bizPhone !== 'undefined' ? bizPhone : '';        },
  });


  AppointmentUI.init(AppointmentState, AppointmentService, EventBus, {
    showToast:    function (m, t, d) { if (typeof showToast    === 'function') showToast(m, t, d); },
    closeModal:   function (id)      { if (typeof closeModal   === 'function') closeModal(id);    },
    openModal:    function (id)      { if (typeof openModal    === 'function') openModal(id);     },
    getMechanics: function ()        { return typeof mechanics !== 'undefined' ? mechanics : []; },
    escapeHtml:   function (str)     { if (typeof escapeHtml   === 'function') return escapeHtml(str); return String(str || ''); },
    convertApptToJob: function (id)  { CrossService.convertApptToJob(id); },
  });


  CrossService.init({
    jobState:   JobState,
    jobService: JobService,
    apptState:  AppointmentState,
    storage:    StorageAdapter,
    bus:        EventBus,
    providers:  _providers,
    showToast:  function (m, t, d) { if (typeof showToast  === 'function') showToast(m, t, d); },
    openJobModal:   function ()     { JobUI.openJobModal(); },
    renderJobForm:  function (appt) { JobUI.populateJobForm && JobUI.populateJobForm(appt); },
  });


  EventBus.on(EventBus.EVENTS.MECHANICS_CHANGED, function (p) {
    try {
      CrossService.updateMechanicDropdowns(p && p.mechanics ? p.mechanics : []);
    } catch (e) {
      console.warn('[job.events] MECHANICS_CHANGED handler failed:', e);
    }
  });

  EventBus.on(EventBus.EVENTS.STORAGE_ERROR, function (p) {
    console.error('[job.events] Storage error:', p && p.error);
    if (typeof showToast === 'function') {
      showToast('⚠️ Data save failed! Check storage space.', 'error', 6000);
    }
  });

  EventBus.on(EventBus.EVENTS.STORAGE_LOADED, function (p) {
    if(window.DEBUG_MODE)console.log('[job.events] Storage loaded from:', p && p.source);
    try {
      EventBus.emit(EventBus.EVENTS.JOBS_CHANGED,         { jobs:         JobState.getJobs()               });
      EventBus.emit(EventBus.EVENTS.VEHICLES_CHANGED,     { vehicles:     VehicleState.getVehicles()        });
      EventBus.emit(EventBus.EVENTS.APPOINTMENTS_CHANGED, { appointments: AppointmentState.getAppointments() });
      CrossService.updateMechanicDropdowns(p && Array.isArray(p.mechanics) ? p.mechanics : (typeof mechanics !== 'undefined' ? mechanics : []));
    } catch (e) {
      console.warn('[job.events] STORAGE_LOADED handler failed:', e);
    }
  });

  EventBus.on(EventBus.EVENTS.APPOINTMENTS_CONVERTED, function (p) {
    if (p && p.apptId && p.jobId) {
      try {
        CrossService.markConvertedJob(p.apptId, p.jobId);
      } catch (e) {
        console.warn('[job.events] APPOINTMENTS_CONVERTED handler failed:', e);
      }
    }
  });


  window.filterJobs        = function (status, el)  { JobUI.filterJobs(status, el);       };
  window.searchJobs        = function (q)            { JobUI.applyJobFilters();             };
  window.applyJobFilters   = function ()             { JobUI.applyJobFilters();             };
  window.clearJobFilters   = function ()             { JobUI.clearJobFilters();             };
  window.openJobModal      = function ()             { JobUI.openJobModal();                };
  window.saveJob           = function ()             { JobUI.saveJobFromModal();            };
  window.editCurJob        = function ()             { JobUI.editCurJob();                  };
  window.showJobList       = function ()             { JobUI.showJobList();                 };
  window.showJobDetail     = function (id)           { JobUI.showJobDetail(id);             };
  window.editJobById       = function (id)           { JobUI.editJobById(id);               };
  window.addJobPart        = function ()             { JobUI.addJobPart();                  };
  window.delRow            = function (btn)          { JobUI.delRow && JobUI.delRow(btn);   };
  window.addLabourRow      = function ()             { JobUI.addLabourRow && JobUI.addLabourRow(); };
  window.delLabourRow      = function (btn)          { JobUI.delLabourRow && JobUI.delLabourRow(btn); };
  window.calcJob           = function ()             { JobUI.calcJob();                     };
  window.toggleBulkMode    = function ()             { JobUI.toggleBulkMode();              };
  window.bulkUpdateStatus  = _requireAuth('bulkUpdateStatus', function (status)       { JobUI.bulkUpdateStatus(status);      });
  window.bulkDeleteJobs    = _requireAuth('bulkDeleteJobs', function ()             { JobUI.bulkDeleteJobs();              });
  window.clearBulkSelection = function ()            { JobUI.clearBulkSelection();          };


  function _requireAuth(fnName, fn) {
    return function() {
      var auth = window.ERP && window.ERP.Auth;
      if (!auth || typeof auth.isAuthenticated !== 'function') {
        console.warn('[Security] Auth module unavailable — blocking call to window.' + fnName);
        return;
      }
      if (!auth.isAuthenticated()) {
        console.warn('[Security] Unauthorized call to window.' + fnName);
        return;
      }
      return fn.apply(this, arguments);
    };
  }

  window.deleteJob           = _requireAuth('deleteJob', function (id) { JobService.deleteJob(id); });
  window.updateJobStatus     = _requireAuth('updateJobStatus', function (id, status) { JobService.updateJobStatus(id, status); });
  window.customerApproveJob  = function ()           { JobService.customerApproveJob();                 };
  window.collectPayment = _requireAuth('collectPayment', function (jobId)      { JobService.collectPayment(jobId);                });
  window.printJobCard        = function ()           { JobService.printJobCard();                       };
  window.exportJobPDF        = function ()           { JobService.exportJobPDF();                       };
  window.exportJobsExcel     = function ()           { JobService.exportJobsExcel();                    };
  window.exportJobsPDF       = function ()           { JobService.exportJobsPDF();                      };
  window.openJobWA           = function ()           { JobService.openJobWA();                          };
  window.convertJobToInvoice = _requireAuth('convertJobToInvoice', function (jobId)      { JobService.convertJobToInvoice(jobId);           });
  window.openJobTemplates    = function ()           { JobService.openJobTemplates && JobService.openJobTemplates(); };
  window.applyJobTemplate    = function (idx)        { JobService.applyJobTemplate && JobService.applyJobTemplate(idx); };

  window.addInternalNote          = function ()              { JobUI.addInternalNote && JobUI.addInternalNote();                  };
  window.addLabourLineFromDetail  = function ()              { JobUI.addLabourLineFromDetail && JobUI.addLabourLineFromDetail();  };
  window.deleteLabourLine         = function (idx)           { JobService.deleteLabourLine(idx);                                 };
  window.uploadJobPhotoEnhanced   = function (type)          { JobService.uploadJobPhotoEnhanced(type);                         };
  window.deleteJobPhotoEnhanced   = function (jobId, idx)    { JobService.deleteJobPhotoEnhanced(jobId, idx);                   };
  window.editPhotoCaption         = function (jobId, idx)    { JobService.editPhotoCaption(jobId, idx);                         };
  window.uploadPartImage          = function (btn)           { JobUI.uploadPartImage && JobUI.uploadPartImage(btn);              };

  window.renderJobPhotos     = function (j)          { JobUI.renderJobPhotos(j);                        };
  window.openLightbox        = function (jobId, idx) { JobUI.openLightbox(jobId, idx);                  };

  window.openVehicleModal    = function (editPlate)  { VehicleUI.openVehicleModal(editPlate);           };
  window.editVehicle         = function (plate)      { VehicleUI.openVehicleModal(plate);               };
  window.openVehicleKmModal  = function (plate)      { VehicleUI.openVehicleKmModal(plate);             };
  window.viewVehicleHistory  = function (plate)      { VehicleUI.viewVehicleHistory(plate);             };
  window.searchVehicles      = function (q)          { VehicleUI.searchVehicles(q);                     };
  window.deleteVehicle       = function (plate)      { VehicleService.deleteVehicle(plate);             };
  window.saveVehicle         = function (btn, editP) { VehicleService.saveVehicle(btn, editP);          };
  window.saveVehicleKm       = function (plate, btn) { VehicleService.saveVehicleKm(plate, btn);        };
  window.exportVehiclesExcel = function ()           { VehicleService.exportVehiclesExcel();            };
  window.printVehicleDetails = function (plate)      { VehicleService.printVehicleDetails(plate);       };
  window.sendVehicleHistoryWA = function (plate)     { VehicleService.sendVehicleHistoryWA(plate);      };

  window.openAppointmentModal = function (editId)    { AppointmentUI.openAppointmentModal(editId);      };
  window.saveAppointment      = function (btn, editId){ AppointmentService.saveAppointment(btn, editId);}; 
  window.deleteAppointment    = function (id)        { AppointmentService.deleteAppointment(id);        };
  window.updateApptStatus     = function (id, status){ AppointmentService.updateApptStatus(id, status); };
  window.convertApptToJob     = function (id)        { CrossService.convertApptToJob(id);               };
  window.switchApptView       = function (view, btn) { AppointmentUI.switchApptView(view, btn);         };
  window.changeCalMonth       = function (dir)       { AppointmentUI.changeCalMonth(dir);               };
  window.jumpCalToday         = function ()          { AppointmentUI.jumpCalToday();                    };
  window.searchAppointments   = function (q)         { AppointmentUI.searchAppointments(q);             };

  window.updateMechanicDropdowns = function (arr) {
    CrossService.updateMechanicDropdowns(
      Array.isArray(arr) ? arr : (typeof mechanics !== 'undefined' ? mechanics : [])
    );
  };

  window.renderJobs         = function (list)  { JobUI.renderJobs(list);              };
  window.renderVehicles     = function ()      { VehicleUI.renderVehicles();          };
  window.renderAppointments = function ()      { AppointmentUI.renderAppointments();  };


  function _flushOnUnload() {
    try {
      StorageAdapter.saveImmediate(_providers());
    } catch (e) {
      console.warn('[job.events] beforeunload flush failed:', e);
    }
  }
  window.addEventListener('beforeunload', _flushOnUnload);


  if(window.DEBUG_MODE)console.log('[job.events] ✅ All modules initialized and wired.');

})();
