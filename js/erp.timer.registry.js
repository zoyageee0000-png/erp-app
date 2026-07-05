'use strict';

// Root-cause fix for audit Category N (#85-87): 21 independent setInterval
// timers were scattered across 9 files with no central registry -- each one
// a candidate for a leak if its owning module is ever torn down without the
// interval being cleared, and no single place to see what's actually running.
//
// This is a minimal, behavior-preserving wrapper, not a scheduler rewrite:
// TimerRegistry.start() still just calls the real setInterval() and returns
// the real interval id (so any existing `clearInterval(x)` call site that
// still holds that id keeps working unchanged if it isn't migrated), while
// also recording {name, id, ms, startedAt} so the interval can be inspected
// or stopped by name. Named timers are keyed by name: starting a timer under
// a name that's already running clears the old one first, so re-arming a
// countdown (e.g. a lockout timer) can never leak a duplicate interval under
// the same name.
var ERP = window.ERP || {};

(function (ERP) {

  var _timers = {}; // name -> { id, ms, startedAt }

  function _logger() {
    return (ERP.Logger) || {
      warn:  function () { if (window.DEBUG_MODE) console.warn.apply(console, arguments); },
      info:  function () { if (window.DEBUG_MODE) console.info.apply(console, arguments); }
    };
  }

  var TimerRegistry = {

    // Starts a named interval. Returns the real interval id (native
    // clearInterval(id) still works on it if a call site isn't migrated).
    start: function (name, fn, ms) {
      if (!name || typeof name !== 'string') {
        throw new Error('[TimerRegistry] start() requires a string name (2nd/3rd args: fn, ms).');
      }
      if (typeof fn !== 'function') {
        throw new Error('[TimerRegistry] start("' + name + '"): fn must be a function.');
      }
      if (_timers[name]) {
        // Re-arm: clear the previous interval under this name before starting
        // a new one, so the same name never accumulates more than one live
        // interval (this is what auth.js's lockout countdowns rely on --
        // they call start() again each time a new lockout begins).
        try { clearInterval(_timers[name].id); } catch (_) {}
      }
      var id = setInterval(fn, ms);
      _timers[name] = { id: id, ms: ms, startedAt: Date.now() };
      return id;
    },

    // Clears a named interval and removes it from the registry. Safe to call
    // on a name that isn't running (no-op, returns false).
    clear: function (name) {
      var t = _timers[name];
      if (!t) return false;
      clearInterval(t.id);
      delete _timers[name];
      return true;
    },

    // Emergency/teardown stop-all. Clears every interval this registry knows
    // about. Does not throw even if a given id was already cleared natively.
    stopAll: function () {
      var names = Object.keys(_timers);
      for (var i = 0; i < names.length; i++) {
        try { clearInterval(_timers[names[i]].id); } catch (_) {}
      }
      _timers = {};
      _logger().info('[TimerRegistry] stopAll(): cleared ' + names.length + ' interval(s).');
      return names;
    },

    // Returns a snapshot list of every interval currently tracked, for
    // debugging/visibility -- the thing Category N's audit finding said this
    // codebase had no way to do.
    list: function () {
      return Object.keys(_timers).map(function (name) {
        var t = _timers[name];
        return { name: name, ms: t.ms, startedAt: t.startedAt, ageMs: Date.now() - t.startedAt };
      });
    },

    isRunning: function (name) {
      return !!_timers[name];
    }
  };

  ERP.TimerRegistry = TimerRegistry;
  window.ERP = ERP;

})(ERP);
