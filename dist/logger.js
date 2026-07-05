(() => {
  // js/logger.js
  var Logger = (function() {
    "use strict";
    const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
    function _isDev() {
      return typeof window !== "undefined" && (!!window._mhDebug || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    }
    function _minLevel() {
      return _isDev() ? LEVELS.DEBUG : LEVELS.WARN;
    }
    function _log(level, levelName, args) {
      if (level < _minLevel()) return;
      const prefix = "[MH-ERP " + (/* @__PURE__ */ new Date()).toTimeString().slice(0, 8) + "] [" + levelName + "]";
      if (level === LEVELS.ERROR) {
        console.error(prefix, ...args);
      } else if (level === LEVELS.WARN) {
        console.warn(prefix, ...args);
      } else if (_isDev()) {
        console.log(prefix, ...args);
      }
    }
    return { debug: function() {
      _log(LEVELS.DEBUG, "DEBUG", Array.from(arguments));
    }, info: function() {
      _log(LEVELS.INFO, "INFO", Array.from(arguments));
    }, warn: function() {
      _log(LEVELS.WARN, "WARN", Array.from(arguments));
    }, error: function() {
      _log(LEVELS.ERROR, "ERROR", Array.from(arguments));
    }, setDebug: function(on) {
      if (typeof window !== "undefined") window._mhDebug = !!on;
    } };
  })();
  if (typeof window !== "undefined") window.Logger = Logger;
  if (typeof globalThis !== "undefined") globalThis.Logger = Logger;
})();
