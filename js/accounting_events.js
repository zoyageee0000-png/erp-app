'use strict';

(function (root) {

  var ACC = root.AccountingCore;
  if (!ACC || typeof ACC !== 'object') {
    throw new Error('[AccountingEvents] AccountingCore missing. Load accounting_constants.js first.');
  }

  if (ACC.AccountingEvents && ACC.AccountingEvents.__v1) {
    return;
  }

  var _listeners = {};

  function _assertString(val, name) {
    if (typeof val !== 'string' || !val) {
      throw new Error('[AccountingEvents] ' + name + ' must be a non-empty string, got: ' + val);
    }
  }

  function _assertFunction(val, name) {
    if (typeof val !== 'function') {
      throw new Error('[AccountingEvents] ' + name + ' must be a function, got: ' + typeof val);
    }
  }

  var AccountingEvents = {

    __v1: true,
    __bridging: false,

    on: function (eventName, fn) {
      _assertString(eventName, 'eventName');
      _assertFunction(fn, 'callback');

      if (!_listeners[eventName]) _listeners[eventName] = [];
      if (_listeners[eventName].indexOf(fn) === -1) {
        _listeners[eventName].push(fn);
      }
      return function () { AccountingEvents.off(eventName, fn); };
    },

    off: function (eventName, fn) {
      _assertString(eventName, 'eventName');
      _assertFunction(fn, 'callback');

      if (!_listeners[eventName]) return;
      _listeners[eventName] = _listeners[eventName].filter(function (f) { return f !== fn; });
      if (_listeners[eventName].length === 0) delete _listeners[eventName];
    },

    once: function (eventName, fn) {
      _assertString(eventName, 'eventName');
      _assertFunction(fn, 'callback');

      var wrapper = function (payload) {
        AccountingEvents.off(eventName, wrapper);
        try {
          fn.call(this, payload);
        } catch (e) {
          console.error('[AccountingEvents] once error for ' + eventName + ':', e);
        }
      };
      AccountingEvents.on(eventName, wrapper);
      return function () { AccountingEvents.off(eventName, wrapper); };
    },

    removeAll: function (eventName) {
      if (eventName) {
        _assertString(eventName, 'eventName');
        delete _listeners[eventName];
      } else {
        Object.keys(_listeners).forEach(function (k) { delete _listeners[k]; });
      }
    },

    emit: function (eventName, payload) {
      if (typeof eventName !== 'string' || !eventName) {
        console.warn('[AccountingEvents] emit() ignored — invalid eventName:', eventName);
        return;
      }

      var fns = (_listeners[eventName] || []).slice();
      fns.forEach(function (fn) {
        if (typeof fn !== 'function') {
          console.warn('[AccountingEvents] Skipping non-function listener for', eventName);
          return;
        }
        try {
          fn.call(AccountingEvents, payload);
        } catch (e) {
          console.error('[AccountingEvents] emit error for ' + eventName + ':', e);
        }
      });

      if (root.ERP && root.ERP.events && typeof root.ERP.events.emit === 'function' && root.ERP.events !== AccountingEvents) {
        if (!AccountingEvents.__bridging) {
          AccountingEvents.__bridging = true;
          try {
            root.ERP.events.emit(eventName, payload);
          } catch (e) {
            console.warn('[AccountingEvents] Bridge error to ERP.events:', e);
          } finally {
            AccountingEvents.__bridging = false;
          }
        }
      }
    },

    emitAsync: function (eventName, payload) {
      var self = this;
      Promise.resolve()
        .then(function () { self.emit(eventName, payload); })
        .catch(function (e) {
          console.error('[AccountingEvents] emitAsync error for ' + eventName + ':', e);
        });
    },

    _listenerCounts: function () {
      var counts = {};
      Object.keys(_listeners).forEach(function (k) { counts[k] = _listeners[k].length; });
      return counts;
    },
  };

  ACC.AccountingEvents = AccountingEvents;

})(typeof window !== 'undefined' && window !== null ? window : globalThis);
