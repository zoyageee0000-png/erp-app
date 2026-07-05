'use strict';

window.ToastManager = (function () {

  function show(type, title, message, duration) {
    if (duration === undefined || duration === null) duration = 3500;
    if (window.ERP && window.ERP.ui && typeof window.ERP.ui.toast === 'function') {
      window.ERP.ui.toast(type, title, message, duration);
      return;
    }
    _fallbackToast(type, title, message, duration);
  }

  function _fallbackToast(type, title, message, duration) {
    var box = document.getElementById('toast-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toast-box';
      box.style.cssText = [
        'position:fixed','top:20px','right:16px','z-index:var(--zi-toast,1020)',
        'display:flex','flex-direction:column','gap:10px','pointer-events:none'
      ].join(';');
      document.body.appendChild(box);
    }
    var icons   = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
    var colors  = { success:'#16a34a', error:'#dc2626', warning:'#d97706', info:'#4338CA' };
    var bgColors= { success:'#dcfce7', error:'#fee2e2', warning:'#fef3c7', info:'#dbeafe' };

    var t = document.createElement('div');
    t.style.cssText = [
      'background:#fff','border-radius:10px','box-shadow:0 6px 24px rgba(0,0,0,.13)',
      'display:flex','align-items:stretch','min-width:300px','max-width:380px',
      'font-family:var(--font,system-ui,sans-serif)','overflow:hidden','pointer-events:auto',
      'border:1px solid rgba(0,0,0,.07)',
      'animation:toast-in .32s cubic-bezier(.22,.68,0,1.2) both'
    ].join(';');

    t.innerHTML =
      '<div style="width:44px;display:flex;align-items:center;justify-content:center;' +
        'font-size:17px;flex-shrink:0;background:' + bgColors[type] + '">' +
        (icons[type] || 'ℹ️') +
      '</div>' +
      '<div style="flex:1;padding:10px 12px">' +
        '<div style="font-size:12.5px;font-weight:700;color:' + colors[type] + '">' +
          _esc(title || type) +
        '</div>' +
        (message ? '<div style="font-size:12px;color:#64748b;margin-top:2px">' + _esc(message) + '</div>' : '') +
      '</div>' +
      '<span style="display:flex;align-items:center;padding:0 10px;cursor:pointer;' +
        'color:#94a3b8;font-size:15px;border-left:1px solid rgba(0,0,0,.06)"' +
        ' onclick="this.parentNode.remove()">×</span>';

    box.appendChild(t);
    if (duration > 0) setTimeout(function () { if (t.parentNode) t.remove(); }, duration);
  }

  function _esc(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return {
    show:    show,
    success: function (title, msg, dur) { show('success', title, msg, dur); },
    error:   function (title, msg, dur) { show('error',   title, msg, dur); },
    warning: function (title, msg, dur) { show('warning', title, msg, dur); },
    info:    function (title, msg, dur) { show('info',    title, msg, dur); }
  };
})();


