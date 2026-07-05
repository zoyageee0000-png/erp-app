'use strict';

var ERP = window.ERP || {};

(function (ERP) {


  if (ERP.registerRenderer) {
    ERP.registerRenderer('repair', function () {
      if (window.JobUI && typeof window.JobUI.renderJobs === 'function') {
        window.JobUI.renderJobs();
      }
    });

    ERP.registerRenderer('pv-purchasereturn', function () {
      if (ERP.purchase && typeof ERP.purchase.renderReturns === 'function') {
        ERP.purchase.renderReturns();
      } else if (ERP.purchasereturns && typeof ERP.purchasereturns.render === 'function') {
        ERP.purchasereturns.render();
      }
    });
  }

})(ERP);

window.ERP = ERP;
