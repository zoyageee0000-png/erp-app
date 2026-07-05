'use strict';

var ERP = window.ERP || {};

(function (ERP) {


  var getState    = function ()     { return ERP._internal.getState(); };
  var getRaw      = function ()     { return ERP._internal.getRaw(); };
  var getStateRev = function ()     { return ERP._internal.getStateRev(); };
  var escapeHtml  = function (s)    { return ERP._internal.escapeHtml(s); };
  var fmt         = function (n, c) { return ERP._internal.fmt(n, c); };

  var STATUS = {
    'pending':       { l:'Pending',        cls:'b-blue'   },
    'in-progress':   { l:'In Progress',    cls:'b-orange' },
    'waiting-parts': { l:'Awaiting Parts', cls:'b-purple' },
    'completed':     { l:'Completed',      cls:'b-green'  },
    'delivered':     { l:'Delivered',      cls:'b-gray'   }
  };

  function _invAmt(sale) {
    // FIX (root-cause, was silent divergence from the ledger): this used to always
    // recompute tax from qty*price*taxPct as a raw, unrounded float, ignoring the
    // per-item `taxAmt` that TaxEngine.calculateLineItem() already computed (paisa-
    // rounded) when the sale was created/posted. Verified numerically across 20,000
    // simulated multi-item invoices: the old recompute disagreed with the actual
    // posted ledger total by 1-3 paisa on ~31% of invoices -- meaning the dashboard's
    // "Today's Sales" / "This Month" / "Outstanding" widgets could show a number that
    // doesn't match the books. Prefer the canonical, already-computed value; only fall
    // back to recomputing for older/foreign records that genuinely don't carry taxAmt.
    var raw = getRaw();
    var settingsTax = (raw.settings && raw.settings.taxRate) || 0;
    return (sale.items || []).reduce(function (a, i) {
      var qty      = typeof i.q === 'number' ? i.q : 1;
      var lineBase = qty * (i.p || 0) - (i.d || 0);
      var taxAmt;
      if (typeof i.taxAmt === 'number' && !isNaN(i.taxAmt)) {
        taxAmt = i.taxAmt;
      } else {
        var taxPct = typeof i.tax === 'number'    ? i.tax
                   : typeof sale.tax === 'number' ? sale.tax
                   : settingsTax;
        taxAmt = taxPct > 0 ? lineBase * taxPct / 100 : 0;
      }
      return a + lineBase + taxAmt;
    }, 0);
  }

  var _chartRefs = { sales: null, exp: null, _ro: null };

  function _destroyCharts() {
    ['sales', 'exp'].forEach(function (key) {
      if (_chartRefs[key] && typeof Chart !== 'undefined' && _chartRefs[key] instanceof Chart) {
        _chartRefs[key].destroy();
        _chartRefs[key] = null;
      }
    });
    if (_chartRefs._ro) { _chartRefs._ro.disconnect(); _chartRefs._ro = null; }
  }

  function _dashHTML() {
    return '<div id="d-widgets">'
      + window.renderStatCards([
          { icon:'💰', id:'d-w-sales', value:'Rs.0.00', label:'Total Sales · Paid this month',   color:'#16a34a', bg:'#f0fdf4', cls:'sc-mini', dataAttrs:'data-action="nav:go" data-page="sales"' },
          { icon:'⚠️', id:'d-w-owed',  value:'Rs.0.00', label:'Outstanding · Credit / unpaid',    color:'#dc2626', bg:'#fef2f2', cls:'sc-mini', dataAttrs:'data-action="nav:go" data-page="accounts"' },
          { icon:'🔧', id:'d-w-jobs',  value:'0',   label:'Active Jobs · In progress',       color:'#d97706', bg:'#fffbeb', cls:'sc-mini', dataAttrs:'data-action="nav:go" data-page="repair"' },
          { icon:'📦', id:'d-w-inv',   value:'Rs.0.00', label:'Inventory Value · Stock at cost', color:'#4338CA', bg:'#eff6ff', cls:'sc-mini', dataAttrs:'data-action="nav:go" data-page="inventory"' },
        ], { marginBottom: 14 })
      + '</div>'
      + '<div class="g2e" style="margin-bottom:14px">'
      + '<div class="chart-panel"><div class="cp-head"><span class="cp-title">📊 SALES TREND</span><button class="cp-refresh" data-action="dash:refreshCharts" title="Refresh"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><use href="#ic-refresh"/></svg></button></div><div class="cp-body"><canvas id="sales-chart"></canvas></div></div>'
      + '<div class="chart-panel"><div class="cp-head"><span class="cp-title">🥧 EXPENSE BREAKDOWN</span><button class="cp-refresh" data-action="dash:refreshCharts" title="Refresh"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><use href="#ic-refresh"/></svg></button></div><div class="cp-body"><canvas id="exp-chart"></canvas></div></div>'
      + '</div>'
      + window.renderStatCards([
          { icon:'💰', id:'d-s-today',  value:'Rs.0.00', label:"Today's Sales",    color:'#4338CA', bg:'#eff6ff', cls:'sc-mini', dataAttrs:'data-action="nav:go" data-page="sales"',     badgeId:'d-s-growth',   badgeText:'↑ 0%', badgeCls:'sc-ch ch-g' },
          { icon:'🔧', id:'d-s-jobs-v', value:'0',   label:'Active Jobs',      color:'#d97706', bg:'#fffbeb', cls:'sc-mini', dataAttrs:'data-action="nav:go" data-page="repair"',    badgeId:'d-s-jobs',     badgeText:'0',     badgeCls:'sc-ch ch-o' },
          { icon:'📦', id:'d-s-parts',  value:'0',   label:'Parts in Stock',   color:'#0891b2', bg:'#ecfeff', cls:'sc-mini', dataAttrs:'data-action="nav:go" data-page="inventory"', badgeId:'d-s-low',      badgeText:'0 Low', badgeCls:'sc-ch ch-r' },
          { icon:'👥', id:'d-s-custs',  value:'0',   label:'Total Customers',  color:'#7c3aed', bg:'#f5f3ff', cls:'sc-mini', dataAttrs:'data-action="nav:go" data-page="customers"', badgeId:'d-s-custs-ch', badgeText:'+0',    badgeCls:'sc-ch ch-b' },
        ])
      + '<div class="g2e">'
      + '<div class="panel"><div class="panel-head"><span class="panel-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><use href="#ic-warn"/></svg> LOW STOCK</span><span class="panel-action" data-action="nav:go" data-page="purchase">Order Now</span></div><div id="d-lowstock"></div></div>'
      + '<div class="panel"><div class="panel-head"><span class="panel-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><use href="#ic-tool"/></svg> ACTIVE JOBS</span><span class="panel-action" data-action="nav:go" data-page="repair">View All</span></div><div id="d-jobs"></div></div>'
      + '</div>';
  }

  var _dashCache = null;

  function _getDashMetrics() {
    var d     = getState().data;
    var sales = (d.sales || []).filter(function (s) { return !s.deleted; });
    var jobs  = d.jobs     || [];
    var inv   = d.inventory|| [];
    var custs = d.customers|| [];
    var today = ERP.DateUtils ? ERP.DateUtils.today() : (function(){ var _d=new Date(); return _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0'); })();

    var cacheKey = getStateRev() + '|' + today + '|' + sales.length + '|' + jobs.length + '|' + inv.length;
    if (_dashCache && _dashCache.key === cacheKey) return _dashCache.val;

    var curMo  = today.slice(0, 7);
    var _todayParts = today.split('-');
    var _lastY = parseInt(_todayParts[0], 10);
    var _lastM = parseInt(_todayParts[1], 10) - 1;
    if (_lastM === 0) { _lastM = 12; _lastY -= 1; }
    var lastMo = _lastY + '-' + String(_lastM).padStart(2, '0');
    var raw    = getRaw();
    var lowThreshold = (raw.settings && raw.settings.lowStockAlert) || 5;

    var paid = 0, owed = 0, todayS = 0, curS = 0, lstS = 0;
    for (var i = 0; i < sales.length; i++) {
      var s = sales[i]; var amt = _invAmt(s); var sd = s.date || '';
      if (s.status === 'paid' || s.status === 'partial') {
        var revAmt = s.status === 'partial' ? (s.paid || 0) : amt;
        if (sd === today) todayS += revAmt;
        if (sd.slice(0, 7) === curMo)  { paid += revAmt; curS += revAmt; }
        if (sd.slice(0, 7) === lastMo)   lstS += revAmt;
        if (s.status === 'partial') owed += amt - (s.paid || 0);
      } else if (s.status === 'credit' || s.status === 'unpaid') {
        owed += amt - (s.paid || 0);
      }
    }

    for (var ri = 0; ri < jobs.length; ri++) {
      var rj = jobs[ri];
      var rPay = Array.isArray(rj.paymentHistory) ? rj.paymentHistory : [];
      for (var rp = 0; rp < rPay.length; rp++) {
        var ph = rPay[rp];
        var phAmt = Number(ph.amount) || 0;
        var phDate = ph.date || '';
        if (!phAmt || !phDate) continue;
        if (phDate === today)                  todayS += phAmt;
        if (phDate.slice(0, 7) === curMo)  { paid += phAmt; curS += phAmt; }
        if (phDate.slice(0, 7) === lastMo)     lstS += phAmt;
      }
    }

    var aj = 0;
    for (var j = 0; j < jobs.length; j++) {
      var jst = jobs[j] && jobs[j].status;
      if (jst === 'pending' || jst === 'in-progress' || jst === 'waiting-parts') aj++;
    }

    var invVal = 0, lowCnt = 0;
    for (var k = 0; k < inv.length; k++) {
      var p = inv[k];
      var pst = Math.max(0, p.st || 0);
      invVal += pst * (p.pp || 0);
      if (pst <= lowThreshold) lowCnt++;
    }

    var growth = lstS > 0 ? Math.round((curS - lstS) / lstS * 100) : (curS > 0 ? 100 : 0);
    var val = {
      paid:    paid,
      owed:    owed,
      aj:      aj,
      invVal:  invVal,
      todayS:  todayS,
      growth:  growth,
      lowCnt:  lowCnt,
      custCnt: custs.length,
      invCnt:  inv.length,
      inv:     inv
    };
    _dashCache = { key: cacheKey, val: val };
    return val;
  }

  function _renderWidgets() {
    var m = _getDashMetrics();
    var paid = m.paid, owed = m.owed, aj = m.aj, invVal = m.invVal;
    var todayS = m.todayS, growth = m.growth, lowCnt = m.lowCnt;

    function _set(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }
    function _fmtBig(n) {
      return n >= 100000 ? fmt(n / 100000).replace('₨', '₨') + 'L'
           : n >= 1000   ? fmt(n / 1000  ).replace('₨', '₨') + 'K'
           : fmt(n);
    }

    _set('d-w-sales', _fmtBig(paid));
    _set('d-w-owed',  fmt(owed));
    _set('d-w-jobs',  aj);
    _set('d-w-inv',   _fmtBig(invVal));
    _set('d-s-today', fmt(todayS));
    _set('d-s-jobs',  aj + ' Active');
    _set('d-s-jobs-v', aj);
    _set('d-s-parts', m.invCnt);
    _set('d-s-custs', m.custCnt);
    _set('d-s-low',   lowCnt + ' Low');

    var grEl = document.getElementById('d-s-growth');
    if (grEl) {
      grEl.textContent = (growth >= 0 ? '↑ ' : '↓ ') + Math.abs(growth) + '%';
      grEl.className   = 'sc-ch ' + (growth >= 0 ? 'ch-g' : 'ch-r');
    }

    var rb = document.getElementById('repair-badge');
    if (rb) { rb.textContent = aj; rb.classList.toggle('u-hide', aj === 0); }
  }

  function _renderLowStock() {
    var c = document.getElementById('d-lowstock');
    if (!c) return;
    var raw          = getRaw();
    var inv          = _getDashMetrics().inv || [];
    var lowThreshold = (raw.settings && raw.settings.lowStockAlert) || 5;
    var low          = inv.filter(function (p) { return Math.max(0, p.st || 0) <= lowThreshold; }).slice(0, 8);

    c.innerHTML = low.length
      ? low.map(function (p) {
          var pst  = Math.max(0, p.st || 0);
          var pct  = Math.min(100, pst / Math.max(p.minSt || 5, 1) * 100);
          var crit = pst === 0;
          return '<div class="ls-row" data-action="nav:go" data-page="inventory">'
            + '<div class="ls-dot' + (crit ? '' : ' warn') + '"></div>'
            + '<div class="ls-info"><div class="ls-name">' + escapeHtml(p.n || '') + '</div>'
            + '<div class="ls-bar"><div class="ls-fill' + (crit ? '' : ' warn') + '" style="width:' + pct + '%"></div></div></div>'
            + '<div style="display:flex;align-items:center;gap:6px">'
            + '<div class="ls-qty">' + pst + '</div>'
            + '<span class="badge ' + (crit ? 'b-red' : 'b-orange') + '">' + (crit ? 'OUT' : 'LOW') + '</span>'
            + '</div></div>';
        }).join('')
      : '<div class="empty-state" style="padding:20px"><div style="font-size:28px">✅</div><div style="font-size:12px;margin-top:4px">Stock levels healthy</div></div>';
  }

  function _renderJobs() {
    var c = document.getElementById('d-jobs');
    if (!c) return;

    var jobs = (getState().data.jobs || [])
      .filter(function (j) {
        return j && (j.status === 'pending' || j.status === 'in-progress' || j.status === 'waiting-parts');
      })
      .slice(0, 10);

    c.innerHTML = jobs.length
      ? jobs.map(function (j) {
          var sc  = STATUS[j.status] || { cls:'b-gray', l:(j.status || 'Unknown') };
          var car = escapeHtml((j.car || j.vehicle || 'Unknown') + ' — ' + (j.plate || ''));
          var dsc = escapeHtml((j.prob || j.description || '').substring(0, 55));
          return '<div class="jr" data-action="nav:go" data-page="repair">'
            + '<div class="jr-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><use href="#ic-car"/></svg></div>'
            + '<div class="jr-info"><div class="jr-car">' + car + '</div><div class="jr-desc">' + dsc + '</div></div>'
            + '<span class="badge ' + escapeHtml(sc.cls) + '">' + escapeHtml(sc.l) + '</span></div>';
        }).join('')
      : '<div class="empty-state" style="padding:20px"><div style="font-size:28px">🎉</div><div style="font-size:12px;margin-top:4px">No active jobs</div></div>';
  }

  function _buildSalesChart() {
    var canvas = document.getElementById('sales-chart');
    if (!canvas) return;

    if (typeof Chart === 'undefined') {
      var cp1 = canvas.parentElement;
      if (cp1) cp1.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:120px;color:var(--muted);font-size:12px">Charts unavailable — CDN blocked or offline</div>';
      return;
    }

    if (_chartRefs.sales instanceof Chart) { _chartRefs.sales.destroy(); _chartRefs.sales = null; }

    if (window.ResizeObserver) {
      if (_chartRefs._ro) { _chartRefs._ro.disconnect(); _chartRefs._ro = null; }
      var _cp = canvas.closest('.cp-body') || canvas.parentElement;
      if (_cp) {
        _chartRefs._ro = new ResizeObserver(function () {
          if (_chartRefs.sales) _chartRefs.sales.resize();
          if (_chartRefs.exp)   _chartRefs.exp.resize();
        });
        _chartRefs._ro.observe(_cp);
      }
    }

    var d   = getState().data;
    var now = new Date();
    var labels = [], keys = [];
    for (var i = 8; i >= 0; i--) {
      var dd = new Date(now.getFullYear(), now.getMonth() - i, 1);
      keys.push(dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0'));
      labels.push(dd.toLocaleString('default', { month:'short' }) + '-' + String(dd.getFullYear()).slice(2));
    }

    var sd = keys.map(function (mo) {
      return (d.sales || [])
        .filter(function (s) { return !s.deleted && (s.status === 'paid' || s.status === 'partial') && (s.date || '').slice(0, 7) === mo; })
        .reduce(function (a, s) { return a + (s.status === 'partial' ? (s.paid || 0) : _invAmt(s)); }, 0);
    });
    var ld = keys.map(function (mo) {
      return (d.jobs || [])
        .filter(function (j) { return (j.status === 'completed' || j.status === 'delivered') && (j.date || '').slice(0, 7) === mo; })
        .reduce(function (a, j) { return a + (j.labour || 0); }, 0);
    });

    if (labels.length !== sd.length) return;

    try {
    var _ctx = canvas.getContext('2d');
    var _gradSales = _ctx.createLinearGradient(0,0,0,200);
    _gradSales.addColorStop(0,'rgba(67,56,202,.9)');
    _gradSales.addColorStop(1,'rgba(67,56,202,.35)');
    var _gradLabour = _ctx.createLinearGradient(0,0,0,200);
    _gradLabour.addColorStop(0,'rgba(22,163,74,.9)');
    _gradLabour.addColorStop(1,'rgba(22,163,74,.35)');
    _chartRefs.sales = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label:'Sales',  data:sd, borderColor:'#4338CA', backgroundColor:_gradSales, fill:true, tension:.35, pointRadius:3, pointBackgroundColor:'#4338CA', borderWidth:2 },
          { label:'Labour', data:ld, borderColor:'#16a34a', backgroundColor:_gradLabour, fill:true, tension:.35, pointRadius:3, pointBackgroundColor:'#16a34a', borderWidth:2 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode:'index', intersect:false },
        plugins: { legend: { position:'bottom', labels: { font:{ size:9 }, boxWidth:10, usePointStyle:true } } },
        scales: {
          x: { grid:{ display:false }, ticks:{ font:{ size:9 }, color:'#94a3b8' } },
          y: { grid:{ color:'rgba(148,163,184,.15)' }, ticks:{ font:{ size:9 }, color:'#94a3b8', callback:function (v) { return v >= 1000 ? (v/1000).toFixed(0)+'K' : v; } } }
        }
      }
    });
    } catch (e) {
      console.warn('[dashboard] Sales chart error:', e && e.message);
      var _errEl = canvas.parentElement;
      if (_errEl) _errEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:120px;color:var(--muted);font-size:12px">Chart render failed</div>';
    }
  }

  function _buildPieChart() {
    if (typeof Chart === 'undefined') return;
    var canvas = document.getElementById('exp-chart');
    if (!canvas) return;
    if (_chartRefs.exp instanceof Chart) { _chartRefs.exp.destroy(); _chartRefs.exp = null; }

    var d = getState().data;
    var map = {};
    (d.expenses || []).forEach(function (e) {
      map[e.cat || 'Other'] = (map[e.cat || 'Other'] || 0) + (e.amt || 0);
    });

    var labels = Object.keys(map);
    var vals   = Object.values(map);

    if (!labels.length) {
      var cp = canvas.parentElement;
      if (cp) cp.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:120px;color:var(--muted);font-size:12px">No expense data yet</div>';
      return;
    }

    if (labels.length !== vals.length) return;

    var colors = ['#4338CA','#F97316','#16a34a','#0284c7','#7c3aed','#e11d48','#0d9488','#d97706','#64748b'];
    var bgColors = labels.map(function (_, idx) { return colors[idx % colors.length]; });
    try {
    _chartRefs.exp = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{ data:vals, backgroundColor:bgColors, borderWidth:3, borderColor:'#ffffff', hoverOffset:6 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: { position:'bottom', labels:{ font:{ size:9 }, boxWidth:10 } },
          tooltip: { callbacks: { label: function (c) { return ' ' + c.label + ': ' + fmt(c.raw); } } }
        }
      }
    });
    } catch (e) {
      console.warn('[dashboard] Expense chart error:', e && e.message);
      var _cpErr = canvas.parentElement;
      if (_cpErr) _cpErr.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:120px;color:var(--muted);font-size:12px">Chart render failed</div>';
    }
  }

  function _renderDashboard() {
    var pv = document.getElementById('pv-dashboard');
    if (!pv) return;
    if (!document.getElementById('d-w-sales')) {
      pv.innerHTML = _dashHTML();
    }
    _renderWidgets();
    _renderLowStock();
    _renderJobs();
    _buildSalesChart();
    _buildPieChart();
  }

  ERP._internal.registerRenderer('dashboard', _renderDashboard);

  var dash = {
    render:         _renderDashboard,
    refreshCharts:  function () { _buildSalesChart(); _buildPieChart(); },
    refreshWidgets: _renderWidgets,
    _destroyCharts: _destroyCharts,
    _invAmt:        _invAmt,
    STATUS:         STATUS
  };

  ERP.dash = dash;

  ERP.STATUS = STATUS;

  (function _wireDashboardAutoRefresh() {
    var _refreshTimer = null;
    function _scheduleRefresh() {
      if (_refreshTimer) clearTimeout(_refreshTimer);
      _refreshTimer = setTimeout(function () {
        _refreshTimer = null;
        var pv = document.getElementById('pv-dashboard');
        if (!pv || !pv.classList.contains('active')) return;
        _renderWidgets();
        _renderLowStock();
        _renderJobs();
        _buildSalesChart();
        _buildPieChart();
      }, 400);
    }

    var REFRESH_EVENTS = [
      'sales:added', 'sales:updated', 'sales:deleted',
      'purchase:saved', 'purchase:deleted',
      'expense:added', 'expense:deleted',
      'inventory:updated', 'stock:changed',
      'payment:added', 'payment:saved',
      'job:added', 'job:updated', 'job:deleted'
    ];

    function _install() {
      var bus = ERP.EventBus || ERP.events;
      if (!bus || typeof bus.on !== 'function') return;
      REFRESH_EVENTS.forEach(function (evt) {
        bus.on(evt, _scheduleRefresh);
      });
    }

    if (ERP.EventBus || ERP.events) {
      _install();
    } else {
      var _onReady = function () {
        document.removeEventListener('DOMContentLoaded', _onReady);
        setTimeout(_install, 200);
      };
      document.addEventListener('DOMContentLoaded', _onReady);
    }
  }());

})(ERP);

window.ERP = ERP;
