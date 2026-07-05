'use strict';

var ERP = window.ERP || {};

(function (ERP) {
  'use strict';

  function _toast(msg, type, dur) {
    if (ERP.ui && ERP.ui.toast) ERP.ui.toast(msg, type, dur);
    else console.warn('[camera toast]', msg);
  }

  function _emit(evt, data) {
    if (ERP.events && ERP.events.emit) ERP.events.emit(evt, data);
  }

  var _camStream = null;

  var camera = {

    _facingMode: 'environment',
    _scanTimer:  null,

    open: function () {

      if (!document.getElementById('cam-overlay')) {
        var ov = document.createElement('div');
        ov.id = 'cam-overlay';
        ov.dataset.cameraReady = 'false';
        ov.style.cssText = [
          'display:none',
          'position:fixed',
          'inset:0',
          'z-index:var(--zi-critical)',
          'background:#000',
          'flex-direction:column',
          'align-items:center',
          'justify-content:center'
        ].join(';');

        ov.innerHTML =
            '<div style="position:relative;width:100%;max-width:480px">'
          +   '<video id="cam-video" autoplay playsinline style="width:100%;border-radius:12px;display:block"></video>'
          +   '<canvas id="cam-canvas" style="display:none"></canvas>'
          +   '<div id="cam-scan-line" style="position:absolute;left:10%;right:10%;height:2px;background:rgba(252,211,77,.8);top:50%;animation:cam-scan 2s ease-in-out infinite"></div>'
          + '</div>'
          + '<div style="display:flex;gap:12px;margin-top:20px;flex-wrap:wrap;justify-content:center">'
          +   '<button data-action="camera:snap"      style="background:#FCD34D;color:#0a1628;border:none;border-radius:10px;padding:12px 24px;font-size:14px;font-weight:700;cursor:pointer">📸 Capture</button>'
          +   '<button data-action="camera:switchCam" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:10px;padding:12px 20px;font-size:14px;cursor:pointer">🔄 Flip</button>'
          +   '<button data-action="camera:close"     style="background:rgba(239,68,68,.3);color:#fff;border:1px solid rgba(239,68,68,.5);border-radius:10px;padding:12px 20px;font-size:14px;cursor:pointer">✕ Close</button>'
          + '</div>'
          + '<div id="cam-result" style="color:#FCD34D;margin-top:14px;font-size:14px;font-weight:600;text-align:center;min-height:22px"></div>'
          + '<div style="color:rgba(255,255,255,.5);font-size:11px;margin-top:8px">Point at barcode to scan, or capture photo</div>';

        document.body.appendChild(ov);

        if (!document.getElementById('cam-css')) {
          var st = document.createElement('style');
          st.id  = 'cam-css';
          st.textContent = '@keyframes cam-scan{0%,100%{top:20%}50%{top:80%}}';
          document.head.appendChild(st);
        }
      }

      var ov2 = document.getElementById('cam-overlay');
      if (ov2) {
        ov2.style.display = 'flex';
        if (ov2.dataset.prevOverflow === undefined) {
          ov2.dataset.prevOverflow = document.body.style.overflow || '';
        }
      }
      document.body.style.overflow = 'hidden';

      camera._startStream();
    },

    _streamGen: 0,

    _startStream: function () {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        _toast('Camera not supported on this device', 'error');
        return;
      }

      if (_camStream) {
        _camStream.getTracks().forEach(function (t) { t.stop(); });
        _camStream = null;
      }

      var myGen = ++camera._streamGen;

      function _doGetStream() {
        navigator.mediaDevices
        .getUserMedia({ video: { facingMode: camera._facingMode }, audio: false })
        .then(function (stream) {
          if (myGen !== camera._streamGen) {
            // A newer _startStream call superseded this one; discard this stream.
            stream.getTracks().forEach(function (t) { t.stop(); });
            return;
          }
          _camStream = stream;
          var vid = document.getElementById('cam-video');
          if (vid) vid.srcObject = stream;
          camera._scanLoop();
        })
        .catch(function (e) {
          if (myGen !== camera._streamGen) return;
          _camStream = null;
          _toast('Camera error: ' + (e && e.message ? e.message : e), 'error');
          camera.close();
        });
      }
      _doGetStream();
    },

    _scanLoop: function () {
      ERP.TimerRegistry.clear('camera.scanLoop');
      camera._scanTimer = null;

      if (!window.jsQR) {
        var res = document.getElementById('cam-result');
        if (res) res.textContent = 'Barcode scanning unavailable — jsQR not loaded';
        return;
      }

      camera._scanTimer = ERP.TimerRegistry.start('camera.scanLoop', function () {
        var vid = document.getElementById('cam-video');
        var cvs = document.getElementById('cam-canvas');
        if (!vid || !cvs || !vid.videoWidth) return;

        cvs.width  = vid.videoWidth;
        cvs.height = vid.videoHeight;
        var ctx = cvs.getContext('2d');
        ctx.drawImage(vid, 0, 0);

        var imgData = ctx.getImageData(0, 0, cvs.width, cvs.height);
        var code    = window.jsQR(imgData.data, imgData.width, imgData.height);
        if (code && code.data) {
          var res = document.getElementById('cam-result');
          if (res) res.textContent = '✅ Scanned: ' + code.data;

          _emit('barcode:scanned', code.data);

          _toast('Barcode: ' + code.data, 'success');
        }
      }, 500);
    },

    snap: function () {
      var vid = document.getElementById('cam-video');
      var cvs = document.getElementById('cam-canvas');
      if (!vid || !cvs || vid.readyState < 2) {
        _toast('Camera not ready yet', 'warning');
        return;
      }

      cvs.width  = vid.videoWidth;
      cvs.height = vid.videoHeight;
      cvs.getContext('2d').drawImage(vid, 0, 0);

      var dataUrl = cvs.toDataURL('image/jpeg', 0.85);

      _emit('camera:snap', dataUrl);

      _toast('Photo captured ✅', 'success');

      var res = document.getElementById('cam-result');
      if (res) res.textContent = '📸 Photo captured';
    },

    switchCam: function () {
      camera._facingMode = camera._facingMode === 'environment' ? 'user' : 'environment';
      camera._startStream();
    },

    close: function () {
      camera._streamGen++;

      if (camera._scanTimer) {
        ERP.TimerRegistry.clear('camera.scanLoop');
        camera._scanTimer = null;
      }

      if (_camStream) {
        _camStream.getTracks().forEach(function (t) { t.stop(); });
        _camStream = null;
      }

      var ov = document.getElementById('cam-overlay');
      if (ov) {
        ov.style.display = 'none';
        if (ov.dataset.prevOverflow !== undefined) {
          document.body.style.overflow = ov.dataset.prevOverflow;
          delete ov.dataset.prevOverflow;
        }
      }

      document.body.style.overflow = '';

      var btn = document.getElementById('btn-camera');
      if (btn) btn.style.background = '';
    }
  };

  ERP.camera = camera;

})(ERP);

window.ERP = ERP;
