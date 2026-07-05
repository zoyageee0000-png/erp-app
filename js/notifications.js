'use strict';

var ERP = window.ERP || {};

(function (ERP) {

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  function _getState() {
    try {
      return ERP.state.get();
    } catch (e) {
      return {};
    }
  }

  function _setState(fn) {
    return ERP.state.set(fn);
  }

  function _safeRun(fn, mod) {
    return ERP.safeRun ? ERP.safeRun(fn, mod) : fn();
  }

  // Monotonic counter so two notifications created in the same millisecond
  // never end up with the same id (Date.now() alone can collide when
  // check() fires several notify.add() calls back-to-back).
  var _lastId = 0;
  function _nextId() {
    var now = Date.now();
    _lastId = now > _lastId ? now : _lastId + 1;
    return _lastId;
  }

  // ---------------------------------------------------------------------
  // Core notify object
  // ---------------------------------------------------------------------

  var notify = {

    add: function (type, msg) {
      var entry = {
        id: _nextId(),
        type: type,
        msg: msg,
        read: false,
        ts: new Date().toISOString()
      };

      _setState(function (s) {
        s.notifications = [entry].concat((s.notifications || []).slice(0, 49));
      });

      notify.updateBadge();

      var toastType = (type === 'error' || type === 'warning') ? type : 'info';
      ERP.ui.toast(msg, toastType, 5000);
    },

    updateBadge: function () {
      var unread = (_getState().notifications || []).filter(function (n) {
        return !n.read;
      }).length;

      var dot = document.getElementById('notif-dot');
      if (dot) dot.style.display = unread > 0 ? 'block' : 'none';
    },

    showPanel: function () {
      var panel = document.getElementById('notif-panel');
      if (!panel) return;
      var showing = panel.classList.contains('show');
      if (showing) { panel.classList.remove('show'); return; }

      notify._render();

      _setState(function (s) {
        (s.notifications || []).forEach(function (n) { n.read = true; });
      });
      notify.updateBadge();

      panel.classList.add('show');
      setTimeout(function () {
        function _close(e) {
          var btn = document.getElementById('notif-btn');
          if (!panel.contains(e.target) && !(btn && btn.contains(e.target))) {
            panel.classList.remove('show');
            document.removeEventListener('click', _close);
          }
        }
        document.addEventListener('click', _close);
      }, 10);
    },

    clearAll: function () {
      _setState(function (s) { s.notifications = []; });
      notify.updateBadge();
      notify._render();
    },

    _render: function () {
      var list = document.getElementById('np-list');
      if (!list) return;
      var notifications = _getState().notifications || [];

      if (!notifications.length) {
        list.innerHTML = '<div class="np-empty">🔔 No notifications yet</div>';
        return;
      }

      var iconByType = { error: '⚠️', warning: '📦', info: 'ℹ️' };

      list.innerHTML = notifications.map(function (n) {
        var t = n.type === 'error' || n.type === 'warning' ? n.type : 'info';
        var when = '';
        try { when = new Date(n.ts).toLocaleString(); } catch (e) {}
        return '<div class="np-item' + (n.read ? '' : ' unread') + '">' +
          '<div class="np-ico ' + t + '">' + (iconByType[t] || 'ℹ️') + '</div>' +
          '<div class="np-body"><div class="np-msg">' + n.msg + '</div>' +
          '<div class="np-time">' + when + '</div></div></div>';
      }).join('');
    },

    check: function () {
      _safeRun(function () {
        _checkStock();
        _checkPendingJobs();
        _safeRun(_checkDeadStock, 'notify.deadStock');
        _refreshDashboardIfVisible();
      }, 'notify.check');
    }
  };

  // ---------------------------------------------------------------------
  // check() sub-routines
  // ---------------------------------------------------------------------

  function _checkStock() {
    var state = _getState();
    var inv = (state.data && state.data.inventory) || [];
    var settings = state.settings || {};

    // settings.lowStockAlert may legitimately be 0 ("alert only when fully
    // out of stock"), so check for undefined/null explicitly instead of
    // relying on truthiness (which would silently override 0 with 5).
    var lowThreshold = (settings.lowStockAlert === undefined || settings.lowStockAlert === null)
      ? 5
      : settings.lowStockAlert;

    var out = inv.filter(function (p) {
      return p && typeof p.st === 'number' && !isNaN(p.st) && p.st === 0;
    });

    var low = inv.filter(function (p) {
      return p && typeof p.st === 'number' && !isNaN(p.st) && p.st > 0 && p.st <= lowThreshold;
    });

    // Out-of-stock and low-stock are independent conditions: an out-of-stock
    // item shouldn't hide a separate low-stock warning for other items.
    if (out.length) {
      notify.add('error', '⚠️ ' + out.length + ' item(s) OUT OF STOCK');
    }
    if (low.length) {
      notify.add('warning', '📦 ' + low.length + ' item(s) low stock');
    }
  }

  function _checkPendingJobs() {
    var state = _getState();
    var jobs = (state.data && state.data.jobs) || [];

    var pending = jobs.filter(function (j) {
      return j && j.status && (j.status === 'pending' || j.status === 'waiting-parts');
    }).length;

    if (pending) {
      notify.add('info', '🔧 ' + pending + ' repair jobs pending');
    }
  }

  function _checkDeadStock() {
    var state = _getState();
    var d = state.data || {};
    var inv = d.inventory || [];
    var jobs = d.jobs || [];

    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    var lastMoveMap = _buildLastMoveMap(d, jobs);

    var dead = inv.filter(function (p) {
      if (!p || typeof p.st !== 'number' || p.st <= 0) return false;

      var bc = p.bc || p.n || null;
      var lastMove = (bc && lastMoveMap[bc]) || p.lastMoved || p.lastSale || p.updatedAt || p.purchaseDate || null;
      if (!lastMove) return false;

      var moveDate = new Date(lastMove);
      return !isNaN(moveDate.getTime()) && moveDate < cutoff;
    });

    if (dead.length > 0) {
      var sample = dead.slice(0, 3).map(function (p) {
        return p.n || p.bc || '?';
      }).join(', ');

      notify.add(
        'warning',
        '📦 Dead Stock: ' + dead.length + ' item(s) 90+ days se koi movement nahi — ' +
        sample + (dead.length > 3 ? ' ...' : '')
      );
    }
  }

  // Builds a map of barcode/name -> most recent movement date, scanning
  // both sales and completed repair jobs. Dates are parsed (not compared
  // as raw strings) so mixed date formats (ISO vs locale strings, etc.)
  // still compare correctly.
  function _buildLastMoveMap(d, jobs) {
    var lastMoveMap = {};

    function record(bc, dateStr) {
      if (!bc || !dateStr) return;
      var parsed = new Date(dateStr).getTime();
      if (isNaN(parsed)) return;

      var existing = lastMoveMap[bc] ? new Date(lastMoveMap[bc]).getTime() : -Infinity;
      if (parsed > existing) lastMoveMap[bc] = dateStr;
    }

    var sales = (d.sales || []).filter(function (s) {
      return !s.deleted;
    });

    sales.forEach(function (sale) {
      var sDate = sale.date || sale.createdAt || null;
      if (!sDate) return;
      (sale.items || []).forEach(function (item) {
        record(item.bc || item.n || null, sDate);
      });
    });

    jobs.forEach(function (job) {
      var jDate = job.completedDate || job.date || null;
      if (!jDate) return;
      (job.parts || []).forEach(function (p) {
        record(p && p.bc ? p.bc : null, jDate);
      });
    });

    return lastMoveMap;
  }

  function _refreshDashboardIfVisible() {
    var state = _getState();
    if (!(state.ui && state.ui.page === 'dashboard')) return;

    _safeRun(function () {
      if (ERP.dash && ERP.dash.render) {
        ERP.dash.render();
      } else if (ERP.dashboard && ERP.dashboard.renderWidgets) {
        ERP.dashboard.renderWidgets();
      }
    }, 'widgets');
  }

  // ---------------------------------------------------------------------
  // Public API (unchanged surface)
  // ---------------------------------------------------------------------

  ERP.notifications = {
    add: function (type, msg) { return notify.add(type, msg); },
    check: function () { return notify.check(); },
    showPanel: function () { return notify.showPanel(); },
    updateBadge: function () { return notify.updateBadge(); }
  };

  if (!ERP.notify) ERP.notify = notify;

})(ERP);

window.ERP = ERP;
