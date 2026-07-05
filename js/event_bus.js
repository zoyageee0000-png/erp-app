
if (typeof Map === 'undefined' || typeof Set === 'undefined') {
  throw new Error('[EventBus] ES6 Map/Set required. Upgrade browser or add polyfills before loading event_bus.js.');
}
const EventBus = (function () {
  'use strict';


  const _listeners = new Map();

  const _onceMap = new Map();


  function _assertEvent(event) {
    if (typeof event !== 'string' || event.trim() === '') {
      throw new TypeError('[EventBus] event name must be a non-empty string, got: ' + typeof event);
    }
  }

  function _assertListener(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('[EventBus] listener must be a function, got: ' + typeof listener);
    }
  }


  const MAX_LISTENERS_PER_EVENT = 50;

  function on(event, listener) {
    _assertEvent(event);
    _assertListener(listener);

    if (!_listeners.has(event)) {
      _listeners.set(event, new Set());
    }
    const set = _listeners.get(event);
    if (set.size >= MAX_LISTENERS_PER_EVENT) {
      console.warn(
        '[EventBus] WARNING: ' + set.size + ' listeners on "' + event +
        '" — possible memory leak. Call off() to clean up.'
      );
    }
    set.add(listener);
  }

  function off(event, listener) {
    _assertEvent(event);
    _assertListener(listener);

    const onceListeners = _onceMap.get(event);
    if (onceListeners && onceListeners.has(listener)) {
      const wrapper = onceListeners.get(listener);
      const set = _listeners.get(event);
      if (set) {
        set.delete(wrapper);
        if (set.size === 0) _listeners.delete(event);
      }
      onceListeners.delete(listener);
      if (onceListeners.size === 0) _onceMap.delete(event);
      return;
    }

    const set = _listeners.get(event);
    if (set) {
      set.delete(listener);
      if (set.size === 0) _listeners.delete(event);
    }
  }

  function emit(event, payload) {
    _assertEvent(event);

    const set = _listeners.get(event);
    if (!set || set.size === 0) return 0;

    let count = 0;

    const snapshot = Array.from(set);

    for (let i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i](payload);
        count++;
      } catch (e) {
        console.error(
          '[EventBus] Listener error on "' + event + '" (index ' + i + '):', e
        );
      }
    }

    return count;
  }

  function once(event, listener) {
    _assertEvent(event);
    _assertListener(listener);

    if (!_onceMap.has(event)) {
      _onceMap.set(event, new Map());
    }
    const onceListeners = _onceMap.get(event);

    const existingWrapper = onceListeners.get(listener);
    if (existingWrapper) {
      const set = _listeners.get(event);
      if (set) set.delete(existingWrapper);
    }

    function _wrapper(payload) {
      const set = _listeners.get(event);
      if (set) {
        set.delete(_wrapper);
        if (set.size === 0) _listeners.delete(event);
      }
      try {
        listener(payload);
      } catch (e) {
        console.error('[EventBus] once() listener error on "' + event + '":', e);
      } finally {
        const map = _onceMap.get(event);
        if (map) {
          map.delete(listener);
          if (map.size === 0) _onceMap.delete(event);
        }
      }
    }
    onceListeners.set(listener, _wrapper);

    on(event, _wrapper);
  }

  function clear(event) {
    if (event !== undefined) {
      _assertEvent(event);
      _listeners.delete(event);
      _onceMap.delete(event);
    } else {
      _listeners.clear();
      _onceMap.clear();
    }
  }

  function listenerCount(event) {
    _assertEvent(event);
    const set = _listeners.get(event);
    return set ? set.size : 0;
  }



  const EVENTS = Object.freeze({


    JOBS_CHANGED: 'jobs:changed',

    JOBS_STATUS_CHANGED: 'jobs:statusChanged',

    JOBS_DELETED: 'jobs:deleted',

    JOBS_SELECTED: 'jobs:selected',


    VEHICLES_CHANGED: 'vehicles:changed',

    VEHICLES_DELETED: 'vehicles:deleted',


    APPOINTMENTS_CHANGED: 'appointments:changed',

    APPOINTMENTS_CONVERTED: 'appointments:converted',


    MECHANICS_CHANGED: 'mechanics:changed',

    MECHANICS_DELETED: 'mechanics:deleted',


    STORAGE_SAVED: 'storage:saved',

    STORAGE_ERROR: 'storage:error',

    STORAGE_LOADED: 'storage:loaded',


    STORAGE_CRITICAL:       'storage:critical',
    STORAGE_WARNING:        'storage:warning',
    AUDIT_NEAR_CAP:         'audit:nearCap',
    FLAG_CHANGED:           'flag:changed',
    BACKUP_REMINDER:        'backup:reminder',
    INTEGRITY_FAILURE:      'integrity:failure',
    CLEANER_STARTING:       'cleaner:starting',
    SELFTEST_FAIL:          'selftest:fail',
    TRANSACTION_ROLLBACK:   'transaction:rollback',
    LEDGER_ROLLBACK:        'ledger:journal:rollback',
    SALES_POST_DEFERRED:    'sales:post:deferred',

  });


  return {
    on,
    off,
    emit,
    once,
    clear,
    listenerCount,
    EVENTS,
  };

})();

if (typeof window !== 'undefined') window.EventBus = EventBus;
