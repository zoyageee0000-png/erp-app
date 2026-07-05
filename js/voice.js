'use strict';

var ERP = window.ERP || {};

(function (ERP) {
  'use strict';

  function _toast(msg, type, dur) {
    if (ERP.ui && ERP.ui.toast) ERP.ui.toast(msg, type, dur);
    else console.warn('[voice toast]', msg);
  }

  function _go(page) {
    if (ERP.go) ERP.go(page);
  }

  var _voiceRec = null;
  var _voiceOn  = false;

  var voice = {

    _cmds: {
      'open sales'     : function () { _go('sales'); },
      'new sale'       : function () { _go('sales'); },
      'open purchase'  : function () { _go('purchase'); },
      'new purchase'   : function () { _go('purchase'); },
      'open inventory' : function () { _go('inventory'); },
      'open repair'    : function () { _go('repair'); },
      'new job'        : function () { _go('repair'); },
      'open dashboard' : function () { _go('dashboard'); },
      'open customers' : function () { _go('customers'); },
      'open reports'   : function () { _go('reports'); },
      'open settings'  : function () { _go('settings'); },
      'open expenses'  : function () { _go('expenses'); },
      'logout'         : function () { if (ERP.auth && ERP.auth.logout)      ERP.auth.logout(); },
      'lock screen'    : function () { if (ERP.auth && ERP.auth.lockScreen)  ERP.auth.lockScreen(); },
      'backup'         : function () { if (ERP._db  && ERP._db.backup)       ERP._db.backup(); }
    },

    toggle: function () {
      if (_voiceOn) voice.stop();
      else          voice.start();
    },

    start: function () {
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        _toast('Voice commands not supported in this browser', 'warning');
        return;
      }

      if (_voiceRec) {
        try { _voiceRec.abort(); } catch (e) {   }
        _voiceRec = null;
      }

      _voiceRec = new SR();
      _voiceRec.continuous      = false;
      _voiceRec.lang            = 'en-US';
      _voiceRec.interimResults  = false;

      _voiceRec.onstart = function () {
        _voiceOn = true;
        var btn = document.getElementById('btn-voice');
        if (btn) btn.style.background = 'rgba(239,68,68,.35)';
        _toast('🎤 Listening...', 'info', 2000);
        voice._showIndicator(true);
      };

      _voiceRec.onresult = function (e) {
        var transcript = e.results[0][0].transcript.toLowerCase().trim();
        voice._showIndicator(false);

        var matched = false;
        Object.keys(voice._cmds).forEach(function (cmd) {
          if (transcript.indexOf(cmd) !== -1) {
            voice._cmds[cmd]();
            matched = true;
          }
        });

        if (!matched) _toast('Command not recognized: "' + transcript + '"', 'warning');
        else          _toast('✅ "' + transcript + '"', 'success');

        _voiceOn = false;
        var btn = document.getElementById('btn-voice');
        if (btn) btn.style.background = '';
      };

      _voiceRec.onerror = function (e) {
        _voiceOn = false;
        var btn = document.getElementById('btn-voice');
        if (btn) btn.style.background = '';
        voice._showIndicator(false);
        if (e.error !== 'no-speech') _toast('Voice error: ' + e.error, 'error');
      };

      _voiceRec.onend = function () {
        _voiceOn = false;
        var btn = document.getElementById('btn-voice');
        if (btn) btn.style.background = '';
        voice._showIndicator(false);
      };

      _voiceRec.start();
    },

    stop: function () {
      if (_voiceRec) {
        try { _voiceRec.stop(); } catch (e) {
          if (window.DEBUG_MODE) console.warn('[voice.stop]', e);
        }
        _voiceRec = null;
      }
      _voiceOn = false;
      var btn = document.getElementById('btn-voice');
      if (btn) btn.style.background = '';
      voice._showIndicator(false);
    },

    _showIndicator: function (show) {
      var ind = document.getElementById('voice-indicator');

      if (!ind && show) {
        ind = document.createElement('div');
        ind.id = 'voice-indicator';
        ind.style.cssText =
          'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);'
          + 'background:linear-gradient(135deg,#dc2626,#ef4444);color:#fff;'
          + 'border-radius:30px;padding:10px 22px;font-size:14px;font-weight:700;'
          + 'z-index:var(--zi-toast);box-shadow:0 4px 20px rgba(220,38,38,.4);'
          + 'display:flex;align-items:center;gap:8px;animation:slide-r .2s ease';
        ind.innerHTML =
          '<span style="width:10px;height:10px;background:#fff;border-radius:50%;'
          + 'animation:spin .8s linear infinite;display:inline-block"></span>'
          + ' 🎤 Listening...';
        document.body.appendChild(ind);

      } else if (ind && !show) {
        ind.remove();
      }
    },

    get isOn() { return _voiceOn; }
  };

  ERP.voice = voice;

})(ERP);

window.ERP = ERP;
