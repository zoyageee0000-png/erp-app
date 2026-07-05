'use strict';

var ERP = window.ERP || {};

(function (ERP) {

  var _sTimer = null;
  var _sToken = 0;

  var escapeHtml = ERP.escapeHtml || function (s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  };

  var getState = function () { return ERP._internal.getState(); };

  var fmt = function (n) {
    // FIX (root cause, audit #75): was re-deriving the same currency-symbol +
    // toLocaleString logic ERP.fmt() already does (Category L duplication) --
    // not a bug in itself since it already read the configured currency, but
    // two implementations of one fact. Fallback kept for a genuine load-order
    // fluke only.
    if (window.ERP && typeof window.ERP.fmt === 'function') return window.ERP.fmt(n);
    var cur = (getState().biz && getState().biz.currency) || 'Rs.';
    return cur + (n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  function go(page) {
    if (ERP.actions && ERP.actions.nav && ERP.actions.nav.go) ERP.actions.nav.go(page);
  }

  var _search = {

    query: function (q) {
      clearTimeout(_sTimer);
      if (!q || q.length < 2) { _search.hide(); return; }
      var token = ++_sToken;
      _sTimer = setTimeout(function () { _search._run(q.toLowerCase().trim(), token); }, 220);
    },

    hide: function () {
      var d = document.getElementById('search-dropdown');
      if (d) d.style.display = 'none';
    },

    _show: function (results, q) {
      var dd = document.getElementById('search-dropdown');
      if (!dd) return;
      if (!results.length) {
        dd.innerHTML = '<div style="padding:12px 16px;color:var(--muted);font-size:13px;text-align:center">No results for "' + escapeHtml(q) + '"</div>';
        dd.style.display = 'block';
        setTimeout(_search.hide, 2000);
        return;
      }

      dd.innerHTML = results.slice(0, 40).map(function (r, i) {
        return '<div class="sd-item" data-idx="' + i + '" style="cursor:pointer">'
          + '<span style="font-size:16px;flex-shrink:0">' + escapeHtml(r.icon) + '</span>'
          + '<div><div style="font-size:13px;font-weight:500">' + escapeHtml(r.title) + '</div>'
          + '<div style="font-size:11px;color:var(--muted)">' + escapeHtml(r.sub) + '</div></div></div>';
      }).join('');

      if (dd._sdClickHandler) dd.removeEventListener('click', dd._sdClickHandler);
      dd._sdClickHandler = function(e) {
        var item = e.target.closest('.sd-item');
        if (!item) return;
        var idx = parseInt(item.getAttribute('data-idx'), 10);
        _search.hide();
        if (!isNaN(idx) && results[idx]) results[idx].action();
      };
      dd.addEventListener('click', dd._sdClickHandler);
      dd.style.display = 'block';
    },

    _run: function (q, token) {
      var d   = getState().data;
      var res = [];

      (d.customers || []).forEach(function (c) {
        if ((c.n || '').toLowerCase().includes(q) || (c.ph || '').includes(q))
          res.push({ icon: '👤', title: c.n || '', sub: c.ph || '', action: function () { go('customers'); } });
      });

      (d.inventory || []).forEach(function (p) {
        if ((p.n || '').toLowerCase().includes(q) || (p.bc || '').toLowerCase().includes(q))
          res.push({ icon: '📦', title: p.n || '', sub: 'Stock: ' + (p.st || 0) + '  ' + fmt(p.sp || 0), action: function () { go('inventory'); } });
      });

      (d.sales || []).forEach(function (sl) {
        if (sl.deleted) return;
        if ((sl.id || '').toLowerCase().includes(q) || (sl.customer || '').toLowerCase().includes(q))
          res.push({ icon: '🧾', title: (sl.id || '') + ' — ' + (sl.customer || ''), sub: sl.date || '', action: function () { go('sales'); } });
      });

      (d.jobs || []).forEach(function (j) {
        if ((j.id || '').toLowerCase().includes(q) || (j.car || '').toLowerCase().includes(q) || (j.plate || '').toLowerCase().includes(q))
          res.push({ icon: '🔧', title: (j.id || '') + ' ' + (j.car || ''), sub: j.plate || '', action: function () { go('repair'); } });
      });

      (d.purchases || []).forEach(function (p) {
        if ((p.supplierName || p.sup || '').toLowerCase().includes(q) || (p.ref || p.id || '').toLowerCase().includes(q))
          res.push({ icon: '🚚', title: (p.ref || p.id || '') + ' — ' + (p.supplierName || p.sup || ''), sub: p.date || '', action: function () { go('purchase'); } });
      });

      (d.suppliers || []).forEach(function (s) {
        if ((s.n || '').toLowerCase().includes(q) || (s.ph || '').includes(q))
          res.push({ icon: '🏭', title: s.n || '', sub: s.ph || '', action: function () { go('supplier'); } });
      });

      if (token !== _sToken) return;
      _search._show(res, q);
    }
  };


  ERP.actions        = ERP.actions || {};
  ERP.actions.search = {
    query: function (q) { _search.query(q); },
    hide:  function ()  { _search.hide(); }
  };

  ERP.search = _search;

})(ERP);

window.ERP = ERP;
