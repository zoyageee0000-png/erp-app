
'use strict';

var ERP = window.ERP || {};

(function (ERP) {

  const BIO = Object.freeze({
    STORE_KEY:  'mh_bio_creds_v1',
    LS_KEY:     'mh_bio_creds_v1',
    RP_ID:      (typeof window !== "undefined" && window !== null && window.location) ? window.location.hostname : 'localhost',
    RP_NAME:    'MH Autos ERP',
    TIMEOUT:    60000,
    ALG_ES256:  -7,
    ALG_RS256:  -257,
    MAX_CREDS:  3
  });

  let _pendingUsername = '';
  let _btnEl = null;
  let _statusEl = null;

  function _toast(msg, type, dur) {
    try { ERP.ui && ERP.ui.toast && ERP.ui.toast(msg, type || 'info', dur); }
    catch (e) {
      console.warn('[bio toast]', msg);
      if (typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.warn('[bio] toast threw:', e);
    }
  }

  function _audit(event, username, extra) {
    try {
      if (ERP._auth_internal && ERP._auth_internal.audit) {
        ERP._auth_internal.audit(Object.assign({ event: event, username: username || '' }, extra || {}));
      }
    } catch (e) {
      if (typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.warn('[bio] audit failed:', e);
    }
  }

  function _b64url(buffer) {
    const bytes = new Uint8Array(buffer);
    let str = '';
    for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return (typeof btoa === "function" ? btoa(str) : '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  function _b64urlToBuffer(b64url) {
    let padded = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (padded.length % 4) padded += '=';
    const raw = (typeof atob === "function" ? atob(padded) : "");
    const buf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
    return buf.buffer;
  }

  function _randomChallenge() {
    const arr = new Uint8Array(32);
    (typeof window !== "undefined" && window !== null && window.crypto) ? window.crypto.getRandomValues(arr) : arr;
    return arr.buffer;
  }

  function _randomUserId() {
    const arr = new Uint8Array(16);
    (typeof window !== "undefined" && window !== null && window.crypto) ? window.crypto.getRandomValues(arr) : arr;
    return arr.buffer;
  }

  function _loadAllCreds() {
    return new Promise(function (resolve) {
      if (ERP._db && ERP._db._isOpen && ERP._db._isOpen()) {
        ERP._db.load(BIO.STORE_KEY).then(function (rows) {
          resolve(Array.isArray(rows) ? rows : []);
        }).catch(function () {
          try { resolve(JSON.parse(localStorage.getItem(BIO.LS_KEY)) || []); }
          catch (e) { resolve([]); }
        });
      } else {
        try { resolve(JSON.parse(localStorage.getItem(BIO.LS_KEY)) || []); }
        catch (e) { resolve([]); }
      }
    });
  }

  function _saveAllCreds(creds) {
    try { localStorage.setItem(BIO.LS_KEY, JSON.stringify(creds)); }
    catch (e) {
      if (typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.warn('[bio] localStorage save failed:', e);
    }
    if (ERP._db && ERP._db._isOpen && ERP._db._isOpen()) {
      ERP._db.save(BIO.STORE_KEY, creds).catch(function (e) {
        if (typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.warn('[bio] IDB save failed:', e);
      });
    }
  }

  function _getCredsForUser(username) {
    return _loadAllCreds().then(function (all) {
      return all.filter(function (c) { return c.username === username; });
    });
  }

  function _addCred(credObj) {
    if (!credObj || typeof credObj !== 'object' || !credObj.username || !credObj.rawId || !credObj.id) {
      return Promise.reject(new Error('invalid credential object'));
    }
    return _loadAllCreds().then(function (all) {
      const userCreds = all.filter(function (c) { return c.username === credObj.username; });
      if (userCreds.length >= BIO.MAX_CREDS) {
        const oldest = userCreds.sort(function (a, b) { return a.ts - b.ts; })[0];
        if (oldest) {
          all = all.filter(function (c) { return c.id !== oldest.id; });
        }
      }
      all.push(credObj);
      _saveAllCreds(all);
    });
  }

  function _removeCredsForUser(username) {
    return _loadAllCreds().then(function (all) {
      const updated = all.filter(function (c) { return c.username !== username; });
      _saveAllCreds(updated);
    });
  }

  const bio = {

    isSupported: function () {
      return !!(
        (typeof window !== "undefined" && window !== null && window.PublicKeyCredential) &&
        (typeof navigator !== "undefined" && navigator !== null && navigator.credentials) &&
        (typeof navigator !== "undefined" && navigator !== null && navigator.credentials && navigator.credentials.create) &&
        (typeof navigator !== "undefined" && navigator !== null && navigator.credentials && navigator.credentials.get) &&
        (typeof window !== "undefined" && window !== null && window.crypto) &&
        (typeof window !== "undefined" && window !== null && window.crypto && window.crypto.subtle)
      );
    },

    isPlatformAvailable: function () {
      if (!bio.isSupported()) return Promise.resolve(false);
      try {
        const p = (typeof PublicKeyCredential !== "undefined" && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable)
          ? PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
          : Promise.resolve(false);
        return p
          .then(function (result) { return !!result; })
          .catch(function () { return false; });
      } catch (e) {
        return Promise.resolve(false);
      }
    },

    register: async function (username) {
      if (!bio.isSupported()) {
        _toast('❌ Your browser does not support WebAuthn. Please use Chrome/Edge/Safari.', 'error', 6000);
        return { success: false, error: 'unsupported' };
      }

      let userObj = null;
      try {
        userObj = ERP._auth_internal && ERP._auth_internal.findUser
          ? ERP._auth_internal.findUser(username)
          : null;
      } catch (e) {   }

      if (!userObj) {
        _toast('❌ User "' + username + '" nahi mila. Pehle login karein.', 'error');
        return { success: false, error: 'user_not_found' };
      }

      const existing = await _getCredsForUser(username);
      if (existing.length >= BIO.MAX_CREDS) {
        _toast('⚠️ Maximum ' + BIO.MAX_CREDS + ' biometric registrations allowed. Pehle purani remove karein.', 'warning', 5000);
        return { success: false, error: 'max_creds' };
      }

      const userId = _randomUserId();
      const challenge = _randomChallenge();

      const createOptions = {
        publicKey: {
          rp: {
            id:   BIO.RP_ID,
            name: BIO.RP_NAME
          },
          user: {
            id:          userId,
            name:        username,
            displayName: userObj.name || username
          },
          challenge: challenge,
          pubKeyCredParams: [
            { type: 'public-key', alg: BIO.ALG_ES256 },
            { type: 'public-key', alg: BIO.ALG_RS256 }
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            requireResidentKey:      false,
            userVerification:        'required'
          },
          attestation: 'none',
          timeout:     BIO.TIMEOUT,
          excludeCredentials: existing.map(function (c) {
            return { type: 'public-key', id: _b64urlToBuffer(c.rawId) };
          })
        }
      };

      try {
        _toast('🔐 Starting biometric registration...', 'info', 2000);

        const credential = await navigator.credentials.create(createOptions);

        if (!credential) {
          _toast('❌ Registration was cancelled.', 'error');
          return { success: false, error: 'cancelled' };
        }

        const credRecord = {
          id:        credential.id,
          rawId:     _b64url(credential.rawId),
          username:  username,
          type:      credential.type,
          device:    (typeof navigator !== "undefined" && navigator !== null ? navigator.userAgent : '').indexOf('Win') !== -1 ? 'Windows Hello'
                   : (typeof navigator !== "undefined" && navigator !== null ? navigator.userAgent : '').indexOf('iPhone') !== -1 || (typeof navigator !== "undefined" && navigator !== null ? navigator.userAgent : '').indexOf('iPad') !== -1 ? 'Face/Touch ID'
                   : (typeof navigator !== "undefined" && navigator !== null ? navigator.userAgent : '').indexOf('Android') !== -1 ? 'Android Biometric'
                   : 'Platform Authenticator',
          ts:        Date.now(),
          label:     'Device ' + (existing.length + 1)
        };

        await _addCred(credRecord);
        _audit('biometric_registered', username, { device: credRecord.device });
        _toast('✅ Biometric registered successfully! You can now log in with fingerprint/face.', 'success', 5000);

        bio._updateLoginBtn();

        return { success: true, credId: credential.id };

      } catch (err) {
        const errMsg = err && err.name ? err.name : String(err);
        let userMsg = '';

        if (errMsg === 'NotAllowedError') {
          userMsg = '❌ Permission denied — biometric dialog cancel ho gayi ya timeout.';
        } else if (errMsg === 'InvalidStateError') {
          userMsg = '⚠️ Yeh device already registered hai is account ke liye.';
        } else if (errMsg === 'NotSupportedError') {
          userMsg = '❌ Platform biometric available nahi. Windows Hello / Fingerprint sensor check karein.';
        } else if (errMsg === 'SecurityError') {
          userMsg = '❌ Security error — HTTPS connection required (ya localhost).';
        } else {
          userMsg = '❌ Registration failed: ' + errMsg;
        }

        _audit('biometric_register_fail', username, { error: errMsg });
        _toast(userMsg, 'error', 6000);
        if (typeof window !== "undefined" && window !== null && typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.error('[bio.register]', err);
        return { success: false, error: errMsg };
      }
    },

    authenticate: async function (username) {
      if (!bio.isSupported()) {
        _toast('❌ Your browser does not support biometrics.', 'error');
        return false;
      }

      const userCreds = await _getCredsForUser(username);
      if (!userCreds.length) {
        _toast('⚠️ No biometric registered for this account. Please register in Settings first.', 'warning', 5000);
        return false;
      }

      const challenge = _randomChallenge();

      const getOptions = {
        publicKey: {
          challenge:        challenge,
          rpId:             BIO.RP_ID,
          timeout:          BIO.TIMEOUT,
          userVerification: 'required',
          allowCredentials: userCreds.map(function (c) {
            return {
              type: 'public-key',
              id:   _b64urlToBuffer(c.rawId),
              transports: ['internal']
            };
          })
        }
      };

      try {
        _setBioStatus('loading', '🔐 Biometric verify ho rahi hai...');

        const assertion = await navigator.credentials.get(getOptions);

        if (!assertion) {
          _setBioStatus('error', '❌ Verify cancel ho gayi');
          return false;
        }


        const userObj = ERP._auth_internal && ERP._auth_internal.findUser
          ? ERP._auth_internal.findUser(username)
          : null;

        if (!userObj) {
          _toast('❌ Account not found. It may have been deleted.', 'error');
          _setBioStatus('error', '❌ Account not found');
          _audit('biometric_login_fail', username, { reason: 'user_deleted' });
          return false;
        }

        const fullUser = ERP._auth_internal.getUsersFull
          ? (ERP._auth_internal.getUsersFull().find(function (u) { return u.username === username; }) || userObj)
          : userObj;

        if (ERP._internal && ERP._internal.setState) {
          ERP._internal.setState(function (s) {
            s.session.loggedIn = true;
            s.session.user     = {
              username: fullUser.username,
              name:     fullUser.name,
              role:     fullUser.role
            };
          }, 'biometric:login');
        }

        if (ERP._auth_internal && ERP._auth_internal.saveSession) {
          ERP._auth_internal.saveSession();
        }

        _audit('biometric_login_ok', username, { credId: assertion.id });
        _setBioStatus('success', '✅ Biometric verified!');

        setTimeout(function () {
          try {
            if (ERP._auth_internal && ERP._auth_internal.postLogin) {
              ERP._auth_internal.postLogin();
            } else if (ERP.auth && ERP.auth._postLogin) {
              ERP.auth._postLogin();
            }
          } catch (e) {
            if (typeof window !== "undefined" && window !== null && typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.warn('[bio] postLogin failed, reloading:', e);
            window.location.reload();
          }
        }, 700);

        return true;

      } catch (err) {
        const errName = err && err.name ? err.name : String(err);
        let msg = '';

        if (errName === 'NotAllowedError') {
          msg = '❌ Biometric cancel ho gayi ya timeout. Dobara try karein.';
        } else if (errName === 'SecurityError') {
          msg = '❌ Security error — HTTPS required.';
        } else if (errName === 'InvalidStateError') {
          msg = '❌ Credential invalid ho gaya. Dobara register karein.';
        } else {
          msg = '❌ Biometric failed: ' + errName;
        }

        _audit('biometric_login_fail', username, { error: errName });
        _setBioStatus('error', msg);
        _toast(msg, 'error', 5000);
        if (typeof window !== "undefined" && window !== null && typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.error('[bio.authenticate]', err);
        return false;
      }
    },

    removeCreds: async function (username) {
      await _removeCredsForUser(username);
      _audit('biometric_removed', username);
      _toast('🗑 Biometric credentials remove ho gaye.', 'info');
      bio._updateLoginBtn();
      bio._updateSettingsPanel();
    },

    listCreds: function (username) {
      return _getCredsForUser(username);
    },

    _updateLoginBtn: async function () {
      const btn = document.getElementById('bio-login-btn');
      if (!btn) return;

      const supported = bio.isSupported();
      const platform = supported ? await bio.isPlatformAvailable() : false;

      if (!supported || !platform) {
        btn.style.display = 'none';
        return;
      }

      btn.style.display = 'flex';
    },

    _updateSettingsPanel: async function () {
      const panel = document.getElementById('bio-settings-panel');
      if (!panel) return;

      const session = ERP._internal && ERP._internal.getState
        ? ERP._internal.getState().session
        : null;
      const username = session && session.user ? session.user.username : '';
      if (!username) return;

      const creds = await _getCredsForUser(username);
      const listEl = document.getElementById('bio-creds-list');
      if (!listEl) return;

      if (!bio.isSupported()) {
        listEl.innerHTML = '<div style="padding:12px;color:#b91c1c;font-size:13px;background:#fef2f2;border-radius:8px">❌ Aapka browser WebAuthn support nahi karta.</div>';
        return;
      }

      const platform = await bio.isPlatformAvailable();
      if (!platform) {
        listEl.innerHTML = '<div style="padding:12px;color:#92400e;font-size:13px;background:#fffbeb;border-radius:8px">⚠️ Is device par koi biometric sensor nahi mila (fingerprint/face/Windows Hello).</div>';
        return;
      }

      if (!creds.length) {
        listEl.innerHTML = '<div style="padding:12px;color:#6b7280;font-size:13px;text-align:center">Koi biometric registered nahi — neeche register karein.</div>';
        return;
      }

      listEl.innerHTML = creds.map(function (c, i) {
        const dt = new Date(c.ts).toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' });
        const deviceLabel = c.device || 'Platform Authenticator';
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;margin-bottom:8px">'
          + '<div style="display:flex;align-items:center;gap:10px">'
          + '<div style="font-size:22px">' + (deviceLabel.indexOf('Windows') !== -1 ? '🪟' : deviceLabel.indexOf('Android') !== -1 ? '📱' : '🍎') + '</div>'
          + '<div><div style="font-size:13px;font-weight:600;color:#1a2340">' + _esc(deviceLabel) + '</div>'
          + '<div style="font-size:11px;color:#6b7280">Registered: ' + dt + '</div></div></div>'
          + '<button class="bio-remove-btn" data-raw-id="' + _esc(c.rawId) + '" data-username="' + _esc(username) + '" '
          + 'style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:600;color:#dc2626;cursor:pointer">🗑 Remove</button>'
          + '</div>';
      }).join('');

      if (!listEl.dataset.delegated) {
        listEl.dataset.delegated = 'true';
        listEl.addEventListener('click', function (ev) {
          const btn = ev.target.closest('.bio-remove-btn');
          if (!btn) return;
          bio._removeSingle(btn.dataset.rawId, btn.dataset.username);
        });
      }
    },

    _removeSingle: async function (rawId, username) {
      const all = await _loadAllCreds();
      const updated = all.filter(function (c) { return !(c.rawId === rawId && c.username === username); });
      _saveAllCreds(updated);
      _audit('biometric_removed_single', username, { rawId: rawId });
      _toast('Credential removed.', 'info');
      bio._updateSettingsPanel();
    },

    loginWithBiometric: async function () {
      const userInput = document.getElementById('l-user');
      const username = (userInput && userInput.value ? userInput.value : '').trim().toLowerCase();

      if (!username) {
        _setBioStatus('error', '⚠️ Pehle username enter karein');
        _toast('⚠️ Please enter your username in the username field for biometric login.', 'warning', 4000);
        if (userInput) userInput.focus();
        return;
      }

      _pendingUsername = username;
      bio.authenticate(username);
    },

    registerFromSettings: async function () {
      const session = ERP._internal && ERP._internal.getState
        ? ERP._internal.getState().session : null;
      const username = session && session.user ? session.user.username : '';
      if (!username) {
        _toast('❌ Session not found — please log in again.', 'error');
        return;
      }
      const result = await bio.register(username);
      if (result && result.success) {
        bio._updateSettingsPanel();
      }
    },

    init: function () {
      bio._updateLoginBtn();

      const userInput = document.getElementById('l-user');
      if (userInput) {
        userInput.addEventListener('input', function () {
          const hasBioBtn = document.getElementById('bio-login-btn');
          if (!hasBioBtn) return;
          const hint = document.getElementById('bio-username-hint');
          if (hint) {
            hint.style.display = userInput.value.trim() ? 'none' : 'block';
          }
        });
      }

      if (typeof window !== "undefined" && window !== null && typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.log('[biometric] init done — WebAuthn supported:', bio.isSupported());
    }
  };

  function _setBioStatus(type, msg) {
    const el = document.getElementById('bio-status');
    if (!el) return;
    el.style.display  = msg ? 'block' : 'none';
    el.textContent    = msg || '';
    el.style.color    = type === 'error' ? '#dc2626' : type === 'success' ? '#16a34a' : '#4338CA';
    el.style.background = type === 'error' ? '#fef2f2' : type === 'success' ? '#f0fdf4' : '#eff6ff';
    el.style.border   = '1px solid ' + (type === 'error' ? '#fecaca' : type === 'success' ? '#bbf7d0' : '#bfdbfe');

    clearTimeout(el._clearTimer);
    if (type !== 'loading') {
      el._clearTimer = setTimeout(function () {
        el.style.display = 'none';
      }, 4000);
    }
  }

  function _esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  ERP.biometric = bio;

})(ERP);

window.ERP = ERP;
