const Logger=(function(){'use strict';
const LEVELS={DEBUG:0,INFO:1,WARN:2,ERROR:3};
function _isDev(){return typeof window!=='undefined'&&(!!window._mhDebug||window.location.hostname==='localhost'||window.location.hostname==='127.0.0.1');}
function _minLevel(){return _isDev()?LEVELS.DEBUG:LEVELS.WARN;}
function _log(level,levelName,args){if(level<_minLevel())return;const prefix='[MH-ERP '+new Date().toTimeString().slice(0,8)+'] ['+levelName+']';if(level===LEVELS.ERROR){console.error(prefix,...args);}else if(level===LEVELS.WARN){console.warn(prefix,...args);}else if(_isDev()){console.log(prefix,...args);}}
return{debug:function(){_log(LEVELS.DEBUG,'DEBUG',Array.from(arguments));},info:function(){_log(LEVELS.INFO,'INFO',Array.from(arguments));},warn:function(){_log(LEVELS.WARN,'WARN',Array.from(arguments));},error:function(){_log(LEVELS.ERROR,'ERROR',Array.from(arguments));},setDebug:function(on){if(typeof window!=='undefined')window._mhDebug=!!on;}};
})();
if(typeof window!=='undefined')window.Logger=Logger;
if(typeof globalThis!=='undefined')globalThis.Logger=Logger;

// --- Phase 1, Step 1 pilot conversion (see MH_ERP migration plan) ---
// Purely additive: the two window/globalThis assignments above are
// UNCHANGED, so every not-yet-converted file that reads window.Logger
// keeps working exactly as before. This export exists only so that
// files converted AFTER this one can `import { Logger } from './logger.js'`
// once the whole codebase is bundled by esbuild instead of loaded as
// raw <script> tags.
export { Logger };