
'use strict';

var ERP = window.ERP || {};

(function (ERP) {
  const getState = function ()       { return ERP._internal.getState(); };
  const setState = function (fn, tag){ return ERP._internal.setState(fn, tag); };
  const escapeHtml = function (s)      { return ERP._internal.escapeHtml(s); };

  function _now() {
    return (ERP.DateUtils && ERP.DateUtils.now)
      ? ERP.DateUtils.now()
      : new Date().toISOString(); 
  }

  function _err(ErrorClass, msg, ctx) {
    const E = (ERP.errors && ERP.errors[ErrorClass]) || Error;
    return Object.assign(new E(msg), {
      name:       ErrorClass,
      module:     ctx.module     || 'Auth',
      operation:  ctx.operation  || 'unknown',
      documentId: ctx.documentId || null,
      txId:       ctx.txId       || null,
      timestamp:  _now()
    });
  }

  // Root-cause fix for audit Category N (#85-87): auth.js was the last file
  // with raw setInterval() calls not going through ERP.TimerRegistry (8 other
  // files were already migrated in a prior pass). These three lockout
  // countdowns (password-login, PIN-login, screen-lock PIN) are cosmetic UI
  // timers, not the actual security control (the real lockout is the
  // lockUntil timestamp check in _isLocked()/equivalent, which still works
  // even if this falls back), so a graceful fallback to raw setInterval/
  // clearInterval if TimerRegistry isn't loaded is safe here -- unlike the
  // fail-closed pattern used for financial posting checks.
  function _timerStart(name, fn, ms) {
    return (ERP.TimerRegistry && typeof ERP.TimerRegistry.start === 'function')
      ? ERP.TimerRegistry.start(name, fn, ms)
      : setInterval(fn, ms);
  }
  function _timerClear(name, id) {
    if (ERP.TimerRegistry && typeof ERP.TimerRegistry.clear === 'function') {
      ERP.TimerRegistry.clear(name);
    } else if (id) {
      clearInterval(id);
    }
  }

  // Single source of truth: delegates to ERP.Auth (core.js). Previously this
  // compared user.role !== 'Admin' (case-sensitive) while other modules'
  // admin checks compare role.toLowerCase() === 'admin' — a role value of
  // 'admin' (lowercase) would pass everywhere else but silently fail here.
  function _requireAdmin(operation) {
    if (!ERP.Auth.isAdminRole()) {
      throw _err('PermissionError', 'Admin role required for: ' + operation, { module: 'Auth', operation: operation });
    }
    return ERP.Auth.currentUser();
  }

  const _AUTH = {
    USERS_KEY:   'mh_users_v1',
    SESSION_KEY: 'mh_sess_v1',
    AUDIT_KEY:   'mh_audit_v1',
    SETUP_KEY:   'mh_setup_v1',
    REMEMBER_KEY:'mh_rem_v1',
    MAX_TRIES:   5,
    LOCK_MS:     300000,
    PIN_MAX:     5,
    PIN_LOCK_MS: 30000,
    TIMEOUT_MS:  30 * 60 * 1000,
    WARN_MS:     2  * 60 * 1000
  };

  const _SECQ = Object.freeze({
    q1: 'Aapki Ammi ka naam kya hai?',
    q2: 'Aap ki pehli school ka naam?',
    q3: 'Aapka favourite colour kya hai?',
    q4: 'Aapki pehli car ka model?',
    q5: 'Aapke gaon / shehar ka naam?'
  });

  var _aSt = {
    attempts:        0,
    lockUntil:       0,
    pinBuf:          '',
    pinTries:        0,
    pinLockUntil:    0,
    pinLockInterval: null,
    lockoutInterval: null
  };

  (function _restoreLockState() {
    try {
      const saved = JSON.parse(localStorage.getItem('mh_login_lock') || 'null');
      if (saved && saved.lockUntil && saved.lockUntil > Date.now()) {
        _aSt.lockUntil = saved.lockUntil;
        _aSt.attempts  = saved.attempts || 5;

        _aSt._pendingLockRestore = true;
      }
    } catch (_) {}
  }());

  var _timerH = null, _warnH = null;

  var _lsUnavailableWarned = false;
  var _cryptoUnavailableWarned = false;

  function _lsGet(k) {
    try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; }
  }

  function _lsSet(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {
      const isQuota = e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);
      if (isQuota) {
        try {
          const audit = JSON.parse(localStorage.getItem(_AUTH.AUDIT_KEY) || '[]');
          if (audit.length > 20) { audit.length = 20; localStorage.setItem(_AUTH.AUDIT_KEY, JSON.stringify(audit)); }
          else localStorage.removeItem(_AUTH.AUDIT_KEY);
          localStorage.setItem(k, JSON.stringify(v));
          return;
        } catch (e2) { if (typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.warn('[ls] eviction retry failed', k, e2); }
      }
      if (!_lsUnavailableWarned) {
        _lsUnavailableWarned = true;
        setTimeout(function () {
          if (ERP.ui && ERP.ui.toast)
            ERP.ui.toast('⚠️ Browser storage blocked — session & settings will not persist across page reloads.', 'warning');
        }, 800);
      }
      if (typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.warn('[ls] write failed', k, e);
    }
  }

  function _lsDel(k) {
    try { localStorage.removeItem(k); } catch (e) {
      if (typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.warn('[ls] delete failed', k, e);
    }
  }

  function _hmac(message, secret) {
    const msg = String(message);
    const sec = String(secret);
    if (typeof window !== "undefined" && window !== null && window.crypto && window.crypto.subtle) {
      const enc = new TextEncoder();
      return window.crypto.subtle.importKey('raw', enc.encode(sec), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
        .then(function (key) { return window.crypto.subtle.sign('HMAC', key, enc.encode(msg)); })
        .then(function (buf) { return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join(''); });
    }
    
    const s = msg + ':' + sec;
    var h = 0x811c9dc5 | 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h = ((typeof Math.imul === "function" ? Math.imul(h ^ c, 0x01000193) : ((h ^ c) * 0x01000193))) | 0;
    }
    return Promise.resolve('weak_' + (h >>> 0).toString(16).padStart(8, '0'));
  }

  function _constantTimeEqual(a, b) {
    a = String(a); b = String(b);
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  var _usersCache = null;
  var _creatingAdmin = false;

  function _getUsers() {
    if (_usersCache !== null) return _usersCache;
    return _lsGet(_AUTH.USERS_KEY) || [];
  }

  function _saveUsers(arr) {
    _usersCache = arr;
    
    _lsSet(_AUTH.USERS_KEY, arr);
    // ARCHITECTURAL REFACTOR: single choke point for all IndexedDB writes.
    ERP.Persistence.save('users', arr).catch(function (e) {
      if (typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.warn('[auth] users IDB save failed:', e);
    });
  }

  function _findUser(un) {
    return _getUsers().find(function (u) {
      return u.username === (un || '').toLowerCase().trim();
    });
  }

  function _migrateUsersFromLS() {
    const lsUsers = _lsGet(_AUTH.USERS_KEY);
    if (!Array.isArray(lsUsers) || lsUsers.length === 0) return;
    ERP.Persistence.load('users').then(function (idbUsers) {
      if (Array.isArray(idbUsers) && idbUsers.length > 0) {
        
        _usersCache = idbUsers;
        _lsSet(_AUTH.USERS_KEY, idbUsers);
        return;
      }
      
      _usersCache = lsUsers;
      ERP.Persistence.save('users', lsUsers).then(function () {
        if (typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.log('[auth] users migrated LS → IDB:', lsUsers.length);
        
      }).catch(function (e) { console.warn('[auth] users migration save failed:', e); });
    }).catch(function (e) { console.warn('[auth] users migration load failed:', e); });
  }

  if (ERP._db && ERP._db._registerUsersMigration) ERP._db._registerUsersMigration(_migrateUsersFromLS);
  if (ERP._db && ERP._db._registerSetUsersCache)   ERP._db._registerSetUsersCache(function (arr) { _usersCache = arr; });

  function _hash(plain, salt) {
    if (typeof window !== "undefined" && window !== null && window.crypto && window.crypto.subtle) {
      const useSalt = salt || Array.from(window.crypto.getRandomValues(new Uint8Array(16)))
        .map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      const enc = new TextEncoder();
      return window.crypto.subtle.importKey('raw', enc.encode(plain), 'PBKDF2', false, ['deriveBits'])
        .then(function (key) {
          return window.crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: enc.encode(useSalt), iterations: 100000, hash: 'SHA-256' },
            key, 256
          );
        })
        .then(function (buf) {
          var hex = Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
          return useSalt + ':' + hex;
        });
    }
    
    if (!_cryptoUnavailableWarned) {
      _cryptoUnavailableWarned = true;
      setTimeout(function () {
        if (ERP.ui && ERP.ui.toast)
          ERP.ui.toast('⚠️ Your browser does not support secure hashing. Please upgrade for better security.', 'warning', 8000);
      }, 1200);
    }
    const _saltStr = salt || (function () {
      var bytes = [];
      for (var n = 0; n < 16; n++) bytes.push(Math.floor(Math.random() * 256));
      return bytes.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }());
    const s = plain + ':' + _saltStr;
    var h0 = 0x811c9dc5 | 0;  
    var h1 = 0xdeadbeef | 0;  
    const ROUNDS = 10000;
    for (var r = 0; r < ROUNDS; r++) {
      for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        h0 = ((typeof Math.imul === "function" ? Math.imul(h0 ^ c, 0x01000193) : ((h0 ^ c) * 0x01000193))) | 0;  
        h1 = ((typeof Math.imul === "function" ? Math.imul(h1 ^ c, 0x16777619) : ((h1 ^ c) * 0x16777619))) | 0;  
      }
      
      if (r % 1000 === 999) { var tmp = h0; h0 = h1 ^ (tmp >>> 5); h1 = tmp ^ (h1 << 3); }
    }
    const _h0hex = (h0 >>> 0).toString(16).padStart(8, '0');
    const _h1hex = (h1 >>> 0).toString(16).padStart(8, '0');
    return Promise.resolve('fb2_' + _saltStr + ':' + _h0hex + _h1hex);
  }

  function _verifyHash(plain, stored) {
    if (!stored) return Promise.resolve(false);
    
    if (stored.startsWith('fb_')) {
      
      var _legacySalt = stored.slice(3, stored.indexOf(':')); 
      var _s2 = plain + (_legacySalt || 'mh_salt_2024');
      var _hh = 0;
      for (var _li = 0; _li < _s2.length; _li++) _hh = (Math.imul(31, _hh) + _s2.charCodeAt(_li)) | 0;
      var _legacyComputed = 'fb_' + (_legacySalt || '') + ':' + Math.abs(_hh).toString(16);
      return Promise.resolve(_constantTimeEqual(_legacyComputed, stored));
    }
    const colonIdx = stored.indexOf(':');
    if (colonIdx === -1) {
      return _hash(plain, 'mh_salt_2024').then(function (h) { return _constantTimeEqual(h, stored); });
    }
    const salt = stored.slice(0, colonIdx);
    
    const hashSalt = salt.startsWith('fb2_') ? salt.slice(4) : salt;
    return _hash(plain, hashSalt).then(function (h) {
      return _constantTimeEqual(h, stored);
    });
  }

  function _audit(entry, extra1, extra2) {
    
    let normalised;
    if (typeof entry === 'string') {
      normalised = { event: entry, detail1: extra1, detail2: extra2 };
    } else {
      normalised = entry || {};
    }

    const record = {
      id:         ERP.uid ? ERP.uid() : ('AL-' + Date.now()),
      txId:       normalised.txId       || null,
      actor:      normalised.actor      || (function () { try { return getState().session.user && getState().session.user.username; } catch (_) { return null; } })(),
      action:     normalised.event      || normalised.action || 'auth:unknown',
      module:     'Auth',
      documentId: normalised.documentId || null,
      before:     normalised.before     || null,
      after:      normalised.after      || { detail1: normalised.detail1, detail2: normalised.detail2 },
      timestamp:  _now(),
      severity:   normalised.severity   || 'info'
    };

    let log = _lsGet(_AUTH.AUDIT_KEY) || [];
    log.unshift(record);
    if (log.length > 200) log.length = 200;
    _lsSet(_AUTH.AUDIT_KEY, log);

    ERP.Persistence.save('auditLog', log).catch(function (e) {
      if (typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.warn('[audit] IDB save failed:', e);
    });

    if (ERP.AuditLog && ERP.AuditLog.write) {
      try { ERP.AuditLog.write(record); } catch (_) {}
    }
  }

  function _sessionFingerprint(user, dbUser) {
    if (!user) return Promise.resolve('');
    var secret = (dbUser && (dbUser.remSecret || dbUser.pwdHash)) || _AUTH.SESSION_KEY;
    return _hmac(user.username + '|' + user.role, secret);
  }

  function _saveSession() {
    var _raw = ERP._internal && ERP._internal._raw ? ERP._internal._raw : null;
    var u = _raw && _raw.session ? _raw.session.user : getState().session.user;
    var dbUser = u ? _findUser(u.username) : null;
    return _sessionFingerprint(u, dbUser).then(function (fp) {
      _lsSet(_AUTH.SESSION_KEY, {
        logged:  _raw && _raw.session ? _raw.session.loggedIn : getState().session.loggedIn,
        user:    u,
        fp:      fp,
        savedAt: _now()
      });
    });
  }

  function _lockBody()   { document.body.style.overflow = 'hidden'; }
  function _unlockBody() { document.body.style.overflow = ''; }

  function _showApp() {
    const lp = document.getElementById('login-page');
    const app = document.getElementById('app');
    if (lp)  lp.classList.remove('show');
    if (app) app.style.display = 'block';
    _unlockBody();
  }

  function _showLogin(shake) {
    const lp = document.getElementById('login-page');
    const app = document.getElementById('app');
    if (app) app.style.display = 'none';
    if (lp)  { lp.classList.add('show'); _lockBody(); }
    if (shake) {
      const c = document.getElementById('login-card');
      if (c) { c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); }
    }
    setTimeout(function () { var u = document.getElementById('l-user'); if (u) u.focus(); }, 80);

    _fixLoginPage();
  }

  function _setErr(msg) {
    const eb = document.getElementById('login-err');
    if (!eb) return;
    eb.textContent = msg || '';
    eb.style.display = msg ? 'block' : 'none';
  }

  function _fixLoginPage() {
    const forgotBtn = document.querySelector('[data-action="auth:showForgot"]');
    if (forgotBtn && !forgotBtn.__enhanced__) {
      forgotBtn.style.cssText = [
        'background:none', 'border:none', 'color:#4338CA', 'font-size:12px',
        'cursor:pointer', 'font-weight:700', 'text-decoration:underline',
        'padding:2px 4px', 'border-radius:4px', 'transition:opacity .15s',
        'visibility:visible', 'opacity:1'
      ].join(';');
      forgotBtn.__enhanced__ = true;
    }
    
    const authRoot = document.getElementById('auth-root');
    if (authRoot && !authRoot.__forgotStyleObs__) {
      new MutationObserver(function () { _fixLoginPage(); })
        .observe(authRoot, { childList: true, subtree: true });
      authRoot.__forgotStyleObs__ = true;
    }
    
    const pinCard = document.getElementById('pin-card');
    if (pinCard && !pinCard.__hintAdded__) {
      const hint = document.createElement('div');
      hint.style.cssText = 'color:rgba(255,255,255,.4);font-size:10px;margin-top:8px;text-align:center';
      hint.textContent = 'PIN Settings > Security mein set karein';
      pinCard.appendChild(hint);
      pinCard.__hintAdded__ = true;
    }
  }

  function _isLocked() {
    if (_aSt._pendingLockRestore) {
      _aSt._pendingLockRestore = false;
      
      const lb = document.getElementById('login-lock');
      if (lb) lb.style.display = 'block';
      const cd = document.getElementById('lock-cd');
      let rem = Math.ceil((_aSt.lockUntil - Date.now()) / 1000);
      if (rem > 0 && !_aSt.lockoutInterval) {
        _aSt.lockoutInterval = _timerStart('auth:passwordLockout', function () {
          rem--;
          if (cd) cd.textContent = '(' + rem + 's)';
          if (rem <= 0) {
            _timerClear('auth:passwordLockout', _aSt.lockoutInterval);
            _aSt.lockoutInterval = null;
            _aSt.attempts = 0; _aSt.lockUntil = 0;
            try { localStorage.removeItem('mh_login_lock'); } catch (_) {}
            if (lb) lb.style.display = 'none';
            _setErr(null);
          }
        }, 1000);
      }
    }
    if (_aSt.lockUntil > Date.now()) return true;
    _aSt.lockUntil = 0; return false;
  }

  function _startLockout() {
    _aSt.lockUntil = Date.now() + _AUTH.LOCK_MS;
    _lsSet('mh_login_lock', { attempts: _aSt.attempts, lockUntil: _aSt.lockUntil });
    _audit({ event: 'account_locked', severity: 'warning' });
    const lb = document.getElementById('login-lock');
    if (lb) lb.style.display = 'block';
    let rem = _AUTH.LOCK_MS / 1000;
    var cd  = document.getElementById('lock-cd');
    if (_aSt.lockoutInterval) _timerClear('auth:passwordLockout', _aSt.lockoutInterval);
    _aSt.lockoutInterval = _timerStart('auth:passwordLockout', function () {
      rem--;
      if (cd) cd.textContent = '(' + rem + 's)';
      if (rem <= 0) {
        _timerClear('auth:passwordLockout', _aSt.lockoutInterval);
        _aSt.lockoutInterval = null;
        _aSt.attempts = 0; _aSt.lockUntil = 0;
        if (lb) lb.style.display = 'none';
        _setErr(null);
      }
    }, 1000);
  }

  function _startTimer() {
    _clearTimers();
    if (!getState().session.loggedIn) return;
    _warnH = setTimeout(function () {
      const tb = document.getElementById('timeout-bar');
      if (tb) tb.classList.add('show');
    }, _AUTH.TIMEOUT_MS - _AUTH.WARN_MS);
    _timerH = setTimeout(function () { auth.logout(true); }, _AUTH.TIMEOUT_MS);
  }

  function _clearTimers() {
    if (_timerH) clearTimeout(_timerH);
    if (_warnH)  clearTimeout(_warnH);
    _timerH = _warnH = null;
    if (_aSt.lockoutInterval) { clearInterval(_aSt.lockoutInterval); _aSt.lockoutInterval = null; }
    if (_aSt.pinLockInterval) { clearInterval(_aSt.pinLockInterval); _aSt.pinLockInterval = null; }
    const tb = document.getElementById('timeout-bar');
    if (tb) tb.classList.remove('show');
  }

  function _updPinDots() {
    for (var i = 0; i < 4; i++) {
      const d = document.getElementById('pd' + i);
      if (d) d.classList.toggle('on', i < _aSt.pinBuf.length);
    }
  }

  function _pinLocked() {
    if (_aSt.pinLockUntil > Date.now()) return true;
    _aSt.pinLockUntil = 0; return false;
  }

  function _renderAudit() {
    const log = _lsGet(_AUTH.AUDIT_KEY) || [];
    const list = document.getElementById('audit-list');
    if (!list) return;
    if (!log.length) { list.innerHTML = '<div style="color:var(--muted);padding:16px;text-align:center">No audit entries yet.</div>'; return; }
    list.innerHTML = log.slice(0, 100).map(function (e) {
      var ts = e.timestamp || e.ts || '';
      if (ts) { try { ts = new Date(ts).toLocaleString('en-PK'); } catch (_) {} }
      const actor = escapeHtml(e.actor  || '—');
      const action = escapeHtml(e.action || e.event || '—');
      return '<div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;gap:12px;align-items:flex-start">'
        + '<div style="flex:1"><div style="font-weight:600;font-size:13px">' + action + '</div>'
        + '<div style="font-size:11px;color:var(--muted)">' + actor + ' · ' + escapeHtml(ts) + '</div></div>'
        + '</div>';
    }).join('');
  }

  async function _postLogin() {
    var u  = getState().session.user;
    const av = document.getElementById('tn-av');   if (av) av.textContent = (u.name || u.username || 'A')[0].toUpperCase();
    const nm = document.getElementById('tn-uname');if (nm) nm.textContent = u.name || u.username;
    const rl = document.getElementById('tn-urole');if (rl) rl.textContent = u.role || 'Staff';
    const un = document.getElementById('um-name'); if (un) un.textContent = u.name || u.username;
    const ur = document.getElementById('um-role'); if (ur) ur.textContent = u.role || 'Staff';
    _showApp();

    setState(function (s) { s.ui.loading = true; });
    if (ERP.ui && ERP.ui.spinner) ERP.ui.spinner(true, 'Loading data...');
    try {
      await ERP._db.open();
      await ERP._db.hydrate();
    } catch (e) {
      if (typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.warn('[init]', e);
      const idbMsg = (String(e) || '').indexOf('blocked') !== -1 || (String(e) || '').indexOf('private') !== -1
        ? '🔴 Database unavailable (private mode?) — accounting data will NOT be saved. Use normal browser mode.'
        : '🔴 Database unavailable — accounting data will NOT be saved. Contact support if this persists.';
      if (ERP.ui && ERP.ui.toast) ERP.ui.toast(idbMsg, 'error', 0);
    } finally {
      setState(function (s) { s.ui.loading = false; });
      if (ERP.ui && ERP.ui.spinner) ERP.ui.spinner(false);
    }
    ERP._db.startAutoBackup();

    try {
      if (ERP.settings && ERP.settings.updateHeader) ERP.settings.updateHeader();
    } catch (_e) { if (typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.warn('[auth] updateHeader failed', _e); }

    _applySettingsFixes();

    if (ERP.notify) ERP.notify.check();
    const hash = (window.location.hash || '#dashboard').slice(1);
    ERP.go(hash || 'dashboard');
    _startTimer();
    try { if (typeof window !== "undefined" && window !== null && typeof window.onModuleLoginSuccess === 'function') window.onModuleLoginSuccess(); } catch (e) {}
  }

  function _injectPrinterTab() {
    const tabBar = document.getElementById('sets-tabs');
    if (!tabBar) return false;
    if (tabBar.querySelector('[data-sets-tab="printer"]')) return true;

    const printerTabBtn = document.createElement('button');
    printerTabBtn.setAttribute('data-sets-tab', 'printer');
    printerTabBtn.onclick = function () {
      if (ERP.settings && ERP.settings._switchTab) ERP.settings._switchTab('printer');
    };
    printerTabBtn.style.cssText = [
      'flex:1', 'border:none', 'background:transparent', 'padding:11px 8px',
      'font-size:12px', 'font-weight:400', 'color:#64748b', 'cursor:pointer',
      'border-bottom:2px solid transparent', 'transition:all .15s',
      'white-space:nowrap', 'display:flex', 'align-items:center',
      'justify-content:center', 'gap:4px'
    ].join(';');
    printerTabBtn.innerHTML = '🖨️ <span>Printer</span>';
    tabBar.appendChild(printerTabBtn);

    const container = tabBar.closest('div[style*="max-width:820px"]') || tabBar.parentElement;
    if (!container) return false;
    if (document.getElementById('sets-pnl-printer')) return true;

    const panel = document.createElement('div');
    panel.id = 'sets-pnl-printer';
    panel.className = 'sets-panel';
    panel.style.display = 'none';
    panel.innerHTML = [
      '<div style="margin-bottom:16px">',
        '<div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.6px;margin-bottom:12px;display:flex;align-items:center;gap:8px">',
          '<span style="width:3px;height:16px;background:var(--primary,#4338CA);border-radius:2px;display:inline-block"></span>',
          '🖨️ Printer Configuration',
        '</div>',
        '<div class="panel" style="margin-bottom:14px"><div class="modal-body" style="padding:12px 0 0">',
          '<div style="background:#dbeafe;border:1px solid #93c5fd;border-radius:10px;padding:12px 16px;margin-bottom:14px;font-size:12px;color:#4338CA">',
            '💡 Full printer settings alag page par hain.',
          '</div>',
          '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">',
            '<button class="btn btn-primary" onclick="if(window.ERP&&ERP.go)ERP.go(\'printer\')" style="display:flex;align-items:center;gap:6px">🖨️ Open Full Printer Settings</button>',
          '</div>',
        '</div></div>',
      '</div>',
      '<div style="margin-bottom:16px">',
        '<div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.6px;margin-bottom:12px;display:flex;align-items:center;gap:8px">',
          '<span style="width:3px;height:16px;background:var(--primary,#4338CA);border-radius:2px;display:inline-block"></span>',
          '⚙️ Current Printer Config',
        '</div>',
        '<div class="panel" style="margin-bottom:14px"><div class="modal-body" style="padding:0">',
          '<div id="sets-printer-summary" style="padding:12px">' + _buildPrinterSummaryHTML() + '</div>',
          '<div style="padding:0 12px 12px">',
            '<button class="btn btn-ghost" style="font-size:12px" onclick="window._refreshPrinterSummary&&window._refreshPrinterSummary()">🔄 Refresh</button>',
          '</div>',
        '</div></div>',
      '</div>'
    ].join('');
    container.appendChild(panel);

    window._refreshPrinterSummary = function () {
      var el = document.getElementById('sets-printer-summary');
      if (el) el.innerHTML = _buildPrinterSummaryHTML();
    };

    window._saveQuickPrinterSettings = function () {
      try {
        var autoPrint = !!(document.getElementById('qp-auto-print') && document.getElementById('qp-auto-print').checked);
        var copies    = parseInt((document.getElementById('qp-copies') || {}).value) || 1;
        var type      = (document.getElementById('qp-type') || {}).value || 'thermal';
        if (copies < 1 || copies > 10) { if (ERP.ui && ERP.ui.toast) ERP.ui.toast('Copies 1-10 honi chahiye', 'error'); return; }
        if (ERP.printer && ERP.printer.getConfig && ERP.printer._save) {
          var cfg = ERP.printer.getConfig();
          cfg.autoPrint = autoPrint; cfg.printCopies = copies; cfg.printerType = type;
          ERP.printer._save(cfg);
          if (ERP.ui && ERP.ui.toast) ERP.ui.toast('✅ Printer settings saved!', 'success');
          window._refreshPrinterSummary && window._refreshPrinterSummary();
        } else if (ERP.settings && ERP.settings.saveBiz) {
          ERP.settings.saveBiz({ autoPrint: autoPrint, printCopies: copies, printerType: type });
          if (ERP.ui && ERP.ui.toast) ERP.ui.toast('✅ Printer settings saved!', 'success');
          window._refreshPrinterSummary && window._refreshPrinterSummary();
        }
      } catch (e) {
        if (ERP.ui && ERP.ui.toast) ERP.ui.toast('Save failed: ' + (e.message || e), 'error');
      }
    };

    return true;
  }

  function _applySettingsFixes() {
    try {
      const sets = ERP.settings;
      if (!sets) return;

      if (!sets.__printerTabPatched__) {
        sets.__printerTabPatched__ = true;
        const _origSwitchTab = sets._switchTab;
        sets._switchTab = function (id) {
          if (_origSwitchTab) _origSwitchTab.call(sets, id);
          if (id === 'printer') {
            var pnl = document.getElementById('sets-pnl-printer');
            if (!pnl) {
              _injectPrinterTab();
              pnl = document.getElementById('sets-pnl-printer');
            }
            if (pnl) {
              document.querySelectorAll('.sets-panel').forEach(function (p) { p.style.display = 'none'; });
              pnl.style.display = '';
              
              setTimeout(function () {
                var summary = document.getElementById('sets-printer-summary');
                if (summary) summary.innerHTML = _buildPrinterSummaryHTML();
              }, 50);
            }
            
            document.querySelectorAll('[data-sets-tab]').forEach(function (t) {
              var active = t.getAttribute('data-sets-tab') === 'printer';
              t.style.background   = active ? '#fff'                             : 'transparent';
              t.style.color        = active ? 'var(--primary,#4338CA)'          : '#64748b';
              t.style.borderBottom = active ? '2px solid var(--primary,#4338CA)': '2px solid transparent';
              t.style.fontWeight   = active ? '700'                              : '400';
            });
          }
        };
      }

      if (!sets.__securityTabPatched__) {
        sets.__securityTabPatched__ = true;
        const _origRender = sets.render || sets._render;
        if (_origRender) {
          var _wrappedRender = function () {
            _origRender.apply(sets, arguments);
            setTimeout(function () {
              _injectPrinterTab();
              _fixPinSetupInSecurityTab();
            }, 50);
          };
          if (sets.render)  sets.render  = _wrappedRender;
          if (sets._render) sets._render = _wrappedRender;
        }
      }

      if (document.getElementById('sets-tabs')) {
        _injectPrinterTab();
        _fixPinSetupInSecurityTab();
      }

      if (ERP.EventBus && ERP.EventBus.on) {
        ERP.EventBus.on('settings:rendered', function () {
          setTimeout(function () {
            _injectPrinterTab();
            _fixPinSetupInSecurityTab();
          }, 60);
        });
      }

      const setsContainer = document.getElementById('pv-settings');
      if (setsContainer && !setsContainer.__authFixObserver__) {
        const obs = new MutationObserver(function () {
          if (document.getElementById('sets-tabs') && !document.getElementById('sets-pnl-printer')) {
            _injectPrinterTab();
          }
          _fixPinSetupInSecurityTab();
          _fixLoginPage();
        });
        obs.observe(setsContainer, { childList: true, subtree: false });
        setsContainer.__authFixObserver__ = obs;
      }
    } catch (e) {
      if (typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.warn('[auth] _applySettingsFixes failed:', e);
    }
  }

  function _fixPinSetupInSecurityTab() {
    
    document.querySelectorAll('button').forEach(function (btn) {
      var txt = (btn.textContent || '').trim();
      if (txt === 'Set Screen Lock PIN' || txt === 'Manage Screen Lock PIN') {
        if (!btn.__pinWired__) {
          btn.__pinWired__ = true;
          btn.onclick = function (e) {
            e.preventDefault();
            auth.showPinSetup();
          };
        }
      }
    });

    const secPanel = document.getElementById('sets-pnl-security');
    if (!secPanel) return;
    if (secPanel.querySelector('#sets-remove-pin-btn')) return;

    try {
      const sessionUser = getState().session && getState().session.user;
      if (!sessionUser) return;
      const fullUser = _findUser(sessionUser.username);
      const hasPIN = !!(fullUser && fullUser.pinHash);
      if (!hasPIN) return;

      const pinBtns = secPanel.querySelector('.modal-body div[style*="flex"]');
      if (!pinBtns) return;
      const removeBtn = document.createElement('button');
      removeBtn.id          = 'sets-remove-pin-btn';
      removeBtn.className   = 'btn btn-ghost';
      removeBtn.style.cssText = 'font-size:12px;color:#dc2626';
      removeBtn.textContent = '🗑️ Remove PIN';
      removeBtn.onclick = function () { auth.removePin(); };
      pinBtns.appendChild(removeBtn);
    } catch (e) {
      if (typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.warn('[auth] _fixPinSetupInSecurityTab:', e);
    }
  }

  function _buildPrinterSummaryHTML() {
    try {
      const cfg = (ERP.printer && ERP.printer.getConfig) ? ERP.printer.getConfig() : null;
      if (!cfg || !cfg.printerType) return '<div style="color:#94a3b8;font-size:12px;padding:8px 0">Printer config load nahi hua — Printer Settings page par jain.</div>';
      const rows = [
        ['Type',        cfg.printerType || '—'],
        ['Size',        cfg.printerType === 'thermal' ? (cfg.printerSize || '3inch') : cfg.printerType.toUpperCase()],
        ['Copies',      cfg.printCopies || 1],
        ['Auto Print',  cfg.autoPrint !== false ? '✅ ON' : '❌ OFF'],
        ['Template',    cfg.invoiceTemplate || 'modern'],
        ['Orientation', cfg.paperOrientation || 'portrait'],
        ['Connection',  cfg.connectionType || 'default'],
        ['Logo on Print', cfg.showLogoOnPrint !== false ? '✅ Yes' : '❌ No'],
        ['QR on Print',   cfg.showQROnPrint  !== false ? '✅ Yes' : '❌ No']
      ];
      return '<table style="width:100%;border-collapse:collapse;font-size:12px">'
        + rows.map(function (r, i) {
            return '<tr style="border-bottom:1px solid #f1f5f9;' + (i % 2 ? 'background:#fafbfc' : '') + '">'
              + '<td style="padding:7px 12px;font-weight:600;color:#64748b;width:50%">' + r[0] + '</td>'
              + '<td style="padding:7px 12px;color:#0f172a;font-weight:600">' + r[1] + '</td></tr>';
          }).join('')
        + '</table>';
    } catch (e) {
      return '<div style="color:#dc2626;font-size:12px">Config load error: ' + (e.message || e) + '</div>';
    }
  }

  var _LAST_USER_KEY  = 'mh_last_user_v1';
  var _PIN_LOGIN_LOCK_KEY = 'mh_pin_login_lock_v1';
  let _pinLoginBuf = '';
  let _pinLoginTries = 0;
  let _pinLoginLocked = false;
  let _pinLoginLockUntil = 0;
  let _pinLoginLockInterval = null;

  function _saveLastUser(username, name, hasPIN) {
    try {
      localStorage.setItem(_LAST_USER_KEY, JSON.stringify({
        username: username,
        name:     name || username,
        hasPIN:   !!hasPIN,
        ts:       Date.now()
      }));
    } catch (_) {}
  }

  function _readLastUser() {
    try {
      var raw = localStorage.getItem(_LAST_USER_KEY);
      if (!raw) return null;
      var u = JSON.parse(raw);
      if (!u || !u.username) return null;
      if (Date.now() - u.ts > 7 * 24 * 3600 * 1000) {
        localStorage.removeItem(_LAST_USER_KEY);
        return null;
      }
      return u;
    } catch (_) { return null; }
  }

  function _pk(k, lbl, bg, col) {
    lbl = lbl || k; bg = bg || '#EFF6FF'; col = col || '#1A2340';
    return '<button onclick="window._lplKey(\'' + k + '\')" style="'
      + 'background:' + bg + ';color:' + col + ';'
      + 'border:none;border-radius:10px;padding:14px 0;'
      + 'font-size:17px;font-weight:700;cursor:pointer;'
      + 'transition:transform .1s,opacity .1s;user-select:none">' + lbl + '</button>';
  }

  function _updPinLoginDots() {
    for (var i = 0; i < 4; i++) {
      const d = document.getElementById('lpl-d' + i);
      if (d) d.style.background = i < _pinLoginBuf.length ? '#4338CA' : 'transparent';
    }
  }

  function _renderPinLoginSection() {
    const lastUser = _readLastUser();
    const loginCard = document.getElementById('login-card');
    const lpLogin = document.getElementById('lp-login');

    const old = document.getElementById('lp-pin-login');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    if (!lastUser || !lastUser.hasPIN || !loginCard || !lpLogin) {
      if (lpLogin) lpLogin.style.display = 'block';
      return;
    }

    const div = document.createElement('div');
    div.id = 'lp-pin-login';
    div.innerHTML = [
      '<div style="margin-top:16px;padding-top:16px;border-top:1px solid #f1f5f9">',
        '<div style="text-align:center;margin-bottom:14px">',
          '<div style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:.6px;text-transform:uppercase;margin-bottom:8px">Quick PIN Login</div>',
          '<div style="font-size:13px;font-weight:700;color:#1A2340;margin-bottom:3px">👤 ' + escapeHtml(lastUser.name) + '</div>',
          '<div style="font-size:11px;color:#6B7A99">4-digit PIN darj karein</div>',
        '</div>',
        '<div style="display:flex;justify-content:center;gap:12px;margin-bottom:12px">',
          '<div id="lpl-d0" style="width:14px;height:14px;border-radius:50%;border:2px solid #4338CA;background:transparent;transition:background .12s"></div>',
          '<div id="lpl-d1" style="width:14px;height:14px;border-radius:50%;border:2px solid #4338CA;background:transparent;transition:background .12s"></div>',
          '<div id="lpl-d2" style="width:14px;height:14px;border-radius:50%;border:2px solid #4338CA;background:transparent;transition:background .12s"></div>',
          '<div id="lpl-d3" style="width:14px;height:14px;border-radius:50%;border:2px solid #4338CA;background:transparent;transition:background .12s"></div>',
        '</div>',
        '<div id="lpl-err" style="text-align:center;font-size:12px;color:#B91C1C;min-height:18px;margin-bottom:6px"></div>',
        '<div id="lpl-lock" style="display:none;text-align:center;font-size:12px;color:#B91C1C;font-weight:700;padding:6px;background:#FEF2F2;border-radius:8px;margin-bottom:8px">🔒</div>',
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">',
          _pk('1'),_pk('2'),_pk('3'),
          _pk('4'),_pk('5'),_pk('6'),
          _pk('7'),_pk('8'),_pk('9'),
          _pk('C','⌫','#FEE2E2','#B91C1C'),
          _pk('0'),
          _pk('OK','✔','#D1FAE5','#065f46'),
        '</div>',
        '<div style="text-align:center;display:flex;justify-content:center;gap:12px;font-size:11px">',
          '<button onclick="window._lplPassword&&window._lplPassword()" style="background:none;border:none;color:#6B7A99;cursor:pointer;text-decoration:underline;font-size:11px">🔑 Password use karein</button>',
          '<span style="color:#e2e8f0">|</span>',
          '<button onclick="window._lplClear&&window._lplClear()" style="background:none;border:none;color:#B91C1C;cursor:pointer;text-decoration:underline;font-size:11px">👤 Account change karein</button>',
        '</div>',
      '</div>'
    ].join('');

    loginCard.appendChild(div);
    lpLogin.style.display = 'none';
    _pinLoginBuf = ''; _pinLoginTries = 0;

    const _savedLock = _lsGet(_PIN_LOGIN_LOCK_KEY);
    if (_savedLock && _savedLock.until > Date.now()) {
      _pinLoginLockUntil = _savedLock.until;
      _pinLoginLocked = true;
      const lockEl = document.getElementById('lpl-lock');
      const grid   = document.querySelector('#lp-pin-login div[style*="grid"]');
      var rem = Math.ceil((_pinLoginLockUntil - Date.now()) / 1000);
      if (lockEl) { lockEl.textContent = '🔒 Bahut zyada galat tries — ' + rem + 's wait'; lockEl.style.display = 'block'; }
      if (grid)   grid.style.opacity = '0.35';
      if (_pinLoginLockInterval) _timerClear('auth:pinLoginLockout', _pinLoginLockInterval);
      _pinLoginLockInterval = _timerStart('auth:pinLoginLockout', function () {
        rem--;
        if (lockEl) lockEl.textContent = '🔒 Bahut zyada galat tries — ' + Math.max(rem, 0) + 's wait';
        if (rem <= 0) {
          _timerClear('auth:pinLoginLockout', _pinLoginLockInterval); _pinLoginLockInterval = null;
          _pinLoginLocked = false; _pinLoginLockUntil = 0; _pinLoginTries = 0;
          _lsDel(_PIN_LOGIN_LOCK_KEY);
          if (lockEl) lockEl.style.display = 'none';
          if (grid)   grid.style.opacity = '1';
        }
      }, 1000);
    } else {
      _pinLoginLocked = false; _pinLoginLockUntil = 0;
      _lsDel(_PIN_LOGIN_LOCK_KEY);
    }
    _updPinLoginDots();
  }

  (function _watchLoginPage() {
    function _attach() {
      var lp = document.getElementById('login-page');
      if (!lp) return;
      if (lp.classList.contains('show')) {
        var lu = _readLastUser();
        if (lu && lu.hasPIN) setTimeout(_renderPinLoginSection, 200);
      }
      if (!lp.__v2Obs__) {
        let last = lp.classList.contains('show');
        new MutationObserver(function () {
          var now = lp.classList.contains('show');
          if (now && !last) setTimeout(_renderPinLoginSection, 120);
          last = now;
        }).observe(lp, { attributes: true, attributeFilter: ['class'] });
        lp.__v2Obs__ = true;
      }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _attach);
    else _attach();
  }());

  window._lplKey = function (k) {
    if (_pinLoginLocked) return;
    const errEl = document.getElementById('lpl-err');
    if (k === 'C') { _pinLoginBuf = ''; _updPinLoginDots(); if (errEl) errEl.textContent = ''; return; }
    if (k !== 'OK') { if (_pinLoginBuf.length < 4) { _pinLoginBuf += k; _updPinLoginDots(); } return; }
    
    if (_pinLoginBuf.length < 4) { if (errEl) errEl.textContent = '❌ 4 digits enter karein'; return; }

    var pin      = _pinLoginBuf;
    var lastUser = _readLastUser();
    if (!lastUser) { if (errEl) errEl.textContent = '❌ Session timeout — password use karein'; return; }

    try {
      const allUsers = ERP._auth_internal.getUsersFull();
      const user = allUsers && allUsers.find(function (u) { return u.username === lastUser.username; });
      if (!user || !user.pinHash) { if (errEl) errEl.textContent = '❌ PIN set nahi hai — password use karein'; return; }

      _verifyHash(pin, user.pinHash).then(function (match) {
        if (match) {
          localStorage.removeItem(_LAST_USER_KEY);
          _lsDel(_PIN_LOGIN_LOCK_KEY);
          ERP._internal.setState(function (s) {
            s.session.loggedIn = true;
            s.session.user = { username: user.username, name: user.name, role: user.role };
          });
          _saveSession().catch(function (_e) {
            if (typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.warn('[auth] PIN-login session save failed', _e);
          });
          ERP._auth_internal.postLogin();
        } else {
          _pinLoginBuf = ''; _pinLoginTries++;
          _updPinLoginDots();
          var left = 5 - _pinLoginTries;
          if (_pinLoginTries >= 5) {
            _pinLoginLockUntil = Date.now() + 30000;
            _pinLoginLocked = true;
            _lsSet(_PIN_LOGIN_LOCK_KEY, { until: _pinLoginLockUntil });
            var lockEl = document.getElementById('lpl-lock');
            var grid   = document.querySelector('#lp-pin-login div[style*="grid"]');
            if (lockEl) { lockEl.textContent = '🔒 Bahut zyada galat tries — 30 second wait'; lockEl.style.display = 'block'; }
            if (grid)   grid.style.opacity = '0.35';
            if (errEl)  errEl.textContent = '';
            if (_pinLoginLockInterval) _timerClear('auth:pinLoginLockout', _pinLoginLockInterval);
            _pinLoginLockInterval = _timerStart('auth:pinLoginLockout', function () {
              if (Date.now() >= _pinLoginLockUntil) {
                _timerClear('auth:pinLoginLockout', _pinLoginLockInterval); _pinLoginLockInterval = null;
                _pinLoginLocked = false; _pinLoginTries = 0; _pinLoginLockUntil = 0;
                _lsDel(_PIN_LOGIN_LOCK_KEY);
                if (lockEl) lockEl.style.display = 'none';
                if (grid)   grid.style.opacity = '1';
                if (errEl)  errEl.textContent = '';
              }
            }, 1000);
          } else {
            if (errEl) errEl.textContent = '❌ Galat PIN — ' + left + ' tr' + (left === 1 ? 'y' : 'ies') + ' baki';
          }
        }
      }).catch(function (e) {
        if (errEl) errEl.textContent = '❌ Verify error — password use karein';
      });
    } catch (e) {
      if (errEl) errEl.textContent = '❌ Error: ' + (e.message || e);
    }
  };

  window._lplPassword = function () {
    var sec = document.getElementById('lp-pin-login');
    const lp = document.getElementById('lp-login');
    if (sec) sec.style.display = 'none';
    if (lp)  lp.style.display  = 'block';
    setTimeout(function () { var u = document.getElementById('l-user'); if (u) u.focus(); }, 60);
  };

  window._lplClear = function () {
    localStorage.removeItem(_LAST_USER_KEY);
    var sec = document.getElementById('lp-pin-login');
    if (sec && sec.parentNode) sec.parentNode.removeChild(sec);
    var lp = document.getElementById('lp-login');
    if (lp) lp.style.display = 'block';
    setTimeout(function () { var u = document.getElementById('l-user'); if (u) u.focus(); }, 60);
  };

  (function _initUsernameRecovery() {
    var _unrSecQAttempts = {};
    var _UNR_MAX_TRIES = 5;
    var _UNR_LOCK_MS = 5 * 60 * 1000;

    function _mask(u) {
      if (!u) return u;
      if (u.length <= 2) return u[0] + '*'.repeat(u.length - 1);
      if (u.length === 3) return u[0] + '**';
      return u.slice(0, 2) + '*'.repeat(u.length - 3) + u.slice(-1);
    }

    function _buildRecoveryPanel() {
      const loginCard = document.getElementById('login-card');
      if (!loginCard) return false;
      if (document.getElementById('lp-uname-recovery')) return true;

      const panel = document.createElement('div');
      panel.id = 'lp-uname-recovery';
      panel.style.display = 'none';
      panel.innerHTML = [
        '<div style="text-align:center;margin-bottom:20px">',
          '<div style="font-size:32px;margin-bottom:6px">🔍</div>',
          '<h3 style="margin:0;color:#1A2340;font-size:17px;font-weight:700">Username Dhundein</h3>',
          '<p style="margin:6px 0 0;color:#6B7A99;font-size:12px">Apna naam ya security question se username pata karein</p>',
        '</div>',
        '<div id="unr-step1">',
          '<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#4338CA">',
            '💡 Apna <strong>poora naam</strong> likhen jaise account banate waqt diya tha.',
          '</div>',
          '<div class="u-mb12">',
            '<label style="display:block;font-size:11px;font-weight:700;color:#3D5080;margin-bottom:7px;letter-spacing:.6px;text-transform:uppercase">Aapka Poora Naam</label>',
            '<input id="unr-name" class="a-input" type="text" placeholder="e.g. Muhammad Hassan" autocomplete="name" spellcheck="false">',
          '</div>',
          '<div id="unr-err1" style="display:none;background:#FEF2F2;color:#B91C1C;border-radius:8px;padding:9px 12px;margin-bottom:12px;font-size:12px;border:1px solid rgba(239,68,68,.2)"></div>',
          '<div id="unr-res1" style="display:none;margin-bottom:14px"></div>',
          '<button onclick="window._unrSearchByName&&window._unrSearchByName()" style="width:100%;background:linear-gradient(135deg,#4338CA,#2563EB);color:#fff;border:none;border-radius:12px;padding:13px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:10px">🔍 Naam Se Dhundein</button>',
          '<div style="text-align:center;padding:10px 0;color:#94a3b8;font-size:11px">— ya —</div>',
          '<button onclick="window._unrGoSecQ&&window._unrGoSecQ()" style="width:100%;background:linear-gradient(135deg,#7c3aed,#8B5CF6);color:#fff;border:none;border-radius:12px;padding:13px;font-size:14px;font-weight:700;cursor:pointer">🔐 Security Question Se Verify Karein</button>',
        '</div>',
        '<div id="unr-step2" style="display:none">',
          '<div class="u-mb12">',
            '<label style="display:block;font-size:11px;font-weight:700;color:#3D5080;margin-bottom:7px;letter-spacing:.6px;text-transform:uppercase">Aapka Naam (Pehle Confirm Karein)</label>',
            '<input id="unr-name2" class="a-input" type="text" placeholder="e.g. Muhammad Hassan" autocomplete="name" spellcheck="false">',
          '</div>',
          '<div id="unr-secq-wrap" style="display:none;margin-bottom:14px">',
            '<label style="display:block;font-size:11px;font-weight:700;color:#3D5080;margin-bottom:8px;letter-spacing:.6px;text-transform:uppercase">🔐 Security Question</label>',
            '<div id="unr-secq-text" style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:11px 14px;font-size:13px;color:#4338CA;font-weight:600;margin-bottom:10px"></div>',
            '<input id="unr-seca" class="a-input" type="text" placeholder="Apna jawab likhen" autocomplete="off" spellcheck="false">',
          '</div>',
          '<div id="unr-err2" style="display:none;background:#FEF2F2;color:#B91C1C;border-radius:8px;padding:9px 12px;margin-bottom:12px;font-size:12px;border:1px solid rgba(239,68,68,.2)"></div>',
          '<div id="unr-res2" style="display:none;margin-bottom:14px"></div>',
          '<button onclick="window._unrVerifySecQ&&window._unrVerifySecQ()" style="width:100%;background:linear-gradient(135deg,#059669,#10B981);color:#fff;border:none;border-radius:12px;padding:13px;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:10px">✔ Verify & Username Dikhao</button>',
          '<button onclick="window._unrBack&&window._unrBack()" style="width:100%;background:none;border:1.5px solid #e2e8f0;border-radius:12px;padding:11px;font-size:13px;font-weight:600;color:#64748b;cursor:pointer">← Wapis</button>',
        '</div>',
        '<div style="text-align:center;margin-top:18px">',
          '<button onclick="window._unrClose&&window._unrClose()" style="background:none;border:none;color:#4338CA;font-size:13px;font-weight:600;cursor:pointer">← Login par wapis jao</button>',
        '</div>'
      ].join('');
      loginCard.appendChild(panel);
      return true;
    }

    function _unrClearResults() {
      ['unr-err1','unr-res1','unr-err2','unr-res2'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) { el.style.display = 'none'; el.innerHTML = ''; }
      });
    }

    function _unrReset() {
      const s1 = document.getElementById('unr-step1'); if (s1) s1.style.display = 'block';
      const s2 = document.getElementById('unr-step2'); if (s2) { s2.style.display = 'none'; delete s2.dataset.targetUser; }
      _unrClearResults();
      ['unr-name','unr-name2','unr-seca'].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; });
      const sw = document.getElementById('unr-secq-wrap'); if (sw) sw.style.display = 'none';
    }

    function _unrShowPanel() {
      _buildRecoveryPanel();
      ['lp-login','lp-forgot','lp-setup','lp-pin-login'].forEach(function (id) {
        var el = document.getElementById(id); if (el) el.style.display = 'none';
      });
      var p = document.getElementById('lp-uname-recovery'); if (p) p.style.display = 'block';
      _unrReset();
      setTimeout(function () { var n = document.getElementById('unr-name'); if (n) n.focus(); }, 80);
    }

    window._unrClose = function () {
      var p = document.getElementById('lp-uname-recovery'); if (p) p.style.display = 'none';
      
      if (ERP.auth && ERP.auth.showPanel) ERP.auth.showPanel('login');
      else { var lp = document.getElementById('lp-login'); if (lp) lp.style.display = 'block'; }
    };

    window._unrBack = function () {
      const s1 = document.getElementById('unr-step1'); const s2 = document.getElementById('unr-step2');
      if (s2) { s2.style.display = 'none'; delete s2.dataset.targetUser; } if (s1) s1.style.display = 'block';
      _unrClearResults();
      setTimeout(function () { var n = document.getElementById('unr-name'); if (n) n.focus(); }, 60);
    };

    window._unrGoSecQ = function () {
      const s1 = document.getElementById('unr-step1'); const s2 = document.getElementById('unr-step2');
      var n1val = (document.getElementById('unr-name') || {}).value || '';
      var n2inp = document.getElementById('unr-name2'); if (n2inp && n1val) n2inp.value = n1val;
      _unrClearResults();
      if (s2) delete s2.dataset.targetUser;
      if (s1) s1.style.display = 'none'; if (s2) s2.style.display = 'block';
      const sw = document.getElementById('unr-secq-wrap'); if (sw) sw.style.display = 'none';
      setTimeout(function () { var n = document.getElementById('unr-name2'); if (n) n.focus(); }, 60);
    };

    window._unrSearchByName = function () {
      var nameInp = document.getElementById('unr-name');
      const query = (nameInp && nameInp.value || '').trim();
      var errEl   = document.getElementById('unr-err1');
      const resEl = document.getElementById('unr-res1');
      if (errEl) errEl.style.display = 'none';
      if (resEl) resEl.style.display = 'none';
      if (!query || query.length < 2) {
        if (errEl) { errEl.textContent = '❌ Naam kam se kam 2 characters ka hona chahiye.'; errEl.style.display = 'block'; }
        return;
      }
      if (!ERP._auth_internal || !ERP._auth_internal.getUsersFull) {
        if (errEl) { errEl.textContent = '❌ System ready nahi — thodi der baad try karein.'; errEl.style.display = 'block'; }
        return;
      }
      const allUsers = ERP._auth_internal.getUsersFull();
      const ql = query.toLowerCase();
      const matches = (allUsers || []).filter(function (u) { return u.name && u.name.toLowerCase().indexOf(ql) !== -1; });
      if (!matches.length) {
        if (errEl) { errEl.innerHTML = '❌ <strong>"' + escapeHtml(query) + '"</strong> naam se koi account nahi mila.'; errEl.style.display = 'block'; }
        return;
      }
      const rows = matches.map(function (u) {
        var hasSecQ = !!u.secqKey;
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#F8FAFF;border:1px solid #BFDBFE;border-radius:10px;margin-bottom:8px">'
          + '<div><div style="font-weight:700;font-size:14px;color:#1A2340;letter-spacing:1px;font-family:monospace">' + escapeHtml(_mask(u.username)) + '</div>'
          + '<div style="font-size:11px;color:#64748b;margin-top:2px">' + escapeHtml(u.name) + ' · ' + escapeHtml(u.role)
          + (u.pinHash ? ' · 📱 PIN set' : '') + (hasSecQ ? ' · 🔐 SecQ set' : '') + '</div></div>'
          + (hasSecQ ? '<button onclick="window._unrRevealBySecQ(\'' + escapeHtml(u.username) + '\')" style="background:#7c3aed;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer">Full Dikhao →</button>'
                     : '<span style="font-size:10px;color:#94a3b8">SecQ nahi — Admin se poochein</span>')
          + '</div>';
      }).join('');
      if (resEl) {
        resEl.innerHTML = '<div style="font-size:12px;font-weight:700;color:#065f46;background:#F0FDF9;border:1px solid #A7F3D0;border-radius:8px;padding:8px 12px;margin-bottom:10px">✅ ' + matches.length + ' account' + (matches.length > 1 ? 's' : '') + ' mile — username masked hai</div>' + rows;
        resEl.style.display = 'block';
      }
    };

    window._unrRevealBySecQ = function (username) {
      const allUsers = ERP._auth_internal.getUsersFull();
      const user = allUsers && allUsers.find(function (u) { return u.username === username; });
      if (!user || !user.secqKey) return;
      const s1 = document.getElementById('unr-step1'); const s2 = document.getElementById('unr-step2');
      _unrClearResults();
      if (s1) s1.style.display = 'none'; if (s2) s2.style.display = 'block';
      const n2 = document.getElementById('unr-name2'); if (n2) n2.value = user.name || '';
      s2.dataset.targetUser = username;
      const sw = document.getElementById('unr-secq-wrap'); const qt = document.getElementById('unr-secq-text');
      if (sw) sw.style.display = 'block';
      if (qt) qt.textContent = _SECQ[user.secqKey] || user.secqKey;
      setTimeout(function () { var sa = document.getElementById('unr-seca'); if (sa) sa.focus(); }, 80);
    };

    window._unrVerifySecQ = function () {
      const errEl = document.getElementById('unr-err2'); const resEl = document.getElementById('unr-res2');
      if (errEl) errEl.style.display = 'none'; if (resEl) resEl.style.display = 'none';
      const s2 = document.getElementById('unr-step2');
      const nameVal = ((document.getElementById('unr-name2') || {}).value || '').trim();
      const ansVal = ((document.getElementById('unr-seca')  || {}).value || '').trim();
      if (!nameVal) { if (errEl) { errEl.textContent = '❌ Naam darj karein.'; errEl.style.display = 'block'; } return; }
      if (!ansVal)  { if (errEl) { errEl.textContent = '❌ Security question ka jawab darj karein.'; errEl.style.display = 'block'; } return; }

      const targetUsername = s2 && s2.dataset.targetUser;

      const allUsers = ERP._auth_internal.getUsersFull();
      const candidates = targetUsername
        ? (allUsers || []).filter(function (u) { return u.username === targetUsername; })
        : (allUsers || []).filter(function (u) { return u.name && u.name.toLowerCase().indexOf(nameVal.toLowerCase()) !== -1 && u.secqKey && u.secqHash; });

      if (!candidates.length) {
        if (errEl) { errEl.textContent = '❌ Koi account nahi mila. Naam check karein ya Admin se rabta karein.'; errEl.style.display = 'block'; }
        return;
      }
      if (candidates.length === 1) {
        const sw = document.getElementById('unr-secq-wrap'); const qt = document.getElementById('unr-secq-text');
        if (sw && sw.style.display === 'none') {
          if (sw) sw.style.display = 'block';
          if (qt) qt.textContent = _SECQ[candidates[0].secqKey] || candidates[0].secqKey;
          if (errEl) { errEl.textContent = 'Upar security question ka jawab darj karein.'; errEl.style.display = 'block'; }
          return;
        }
      }
      const pending = candidates.filter(function (u) { return u.secqHash; });
      if (!pending.length) { if (errEl) { errEl.textContent = '❌ Security question set nahi hai — Admin se poochein.'; errEl.style.display = 'block'; } return; }

      const _lockedNow = pending.some(function (u) {
        const r = _unrSecQAttempts[u.username];
        return r && r.lockedUntil > Date.now();
      });
      if (_lockedNow) {
        if (errEl) { errEl.textContent = '🔒 Bahut zyada galat tries — kuch der baad try karein.'; errEl.style.display = 'block'; }
        return;
      }

      let verified = null; let checked = 0;
      pending.forEach(function (user) {
        _verifyHash(ansVal, user.secqHash).then(function (match) {
          checked++;
          if (match && !verified) verified = user;
          if (checked === pending.length) {
            if (verified) {
              delete _unrSecQAttempts[verified.username];
              if (resEl) {
                resEl.innerHTML = '<div style="background:#F0FDF9;border:1px solid #A7F3D0;border-radius:12px;padding:16px;text-align:center">'
                  + '<div style="font-size:13px;color:#065f46;margin-bottom:8px">✅ Identity verify ho gayi!</div>'
                  + '<div style="font-size:11px;color:#64748b;margin-bottom:6px">Aapka username hai:</div>'
                  + '<div style="font-size:22px;font-weight:900;color:#4338CA;letter-spacing:3px;font-family:monospace;background:#EFF6FF;border-radius:8px;padding:10px 20px;display:inline-block;margin-bottom:12px">' + escapeHtml(verified.username) + '</div>'
                  + '<div style="font-size:11px;color:#94a3b8;margin-bottom:12px">' + escapeHtml(verified.name) + ' · ' + escapeHtml(verified.role) + '</div>'
                  + '<button onclick="window._unrUseUsername&&window._unrUseUsername(\'' + escapeHtml(verified.username) + '\')" style="background:linear-gradient(135deg,#4338CA,#2563EB);color:#fff;border:none;border-radius:10px;padding:10px 20px;font-size:13px;font-weight:700;cursor:pointer">🔑 Is username se Login Karein</button>'
                  + '</div>';
                resEl.style.display = 'block';
                if (errEl) errEl.style.display = 'none';
              }
            } else {
              var _anyLocked = false;
              pending.forEach(function (u) {
                const r = _unrSecQAttempts[u.username] || { tries: 0, lockedUntil: 0 };
                r.tries++;
                if (r.tries >= _UNR_MAX_TRIES) {
                  r.lockedUntil = Date.now() + _UNR_LOCK_MS;
                  r.tries = 0;
                  _anyLocked = true;
                }
                _unrSecQAttempts[u.username] = r;
              });
              if (_anyLocked) {
                if (errEl) { errEl.textContent = '🔒 Bahut zyada galat tries — kuch der baad try karein.'; errEl.style.display = 'block'; }
              } else {
                var _worstLeft = _UNR_MAX_TRIES;
                pending.forEach(function (u) {
                  const r = _unrSecQAttempts[u.username];
                  _worstLeft = Math.min(_worstLeft, _UNR_MAX_TRIES - r.tries);
                });
                if (errEl) { errEl.textContent = '❌ Galat jawab — ' + _worstLeft + ' tries baki.'; errEl.style.display = 'block'; }
              }
            }
          }
        }).catch(function () { checked++; });
      });
    };

    window._unrUseUsername = function (username) {
      window._unrClose();
      setTimeout(function () {
        var uInp = document.getElementById('l-user');
        if (uInp) { uInp.value = username; uInp.dispatchEvent(new Event('input')); }
        var pInp = document.getElementById('l-pass'); if (pInp) pInp.focus();
      }, 100);
    };

    function _patchUnameHintButton() {
      const btn = document.querySelector('[data-action="auth:toggleFrgtUnameHint"]');
      if (btn && !btn.__unrPatched__) {
        btn.textContent = '🔍 Username bhool gaye? Dhundein';
        btn.style.cssText = 'background:none;border:none;color:#7c3aed;font-size:12px;cursor:pointer;font-weight:700;text-decoration:underline;padding:2px 6px';
        btn.setAttribute('data-action', '');
        btn.onclick = function (e) { e.preventDefault(); _unrShowPanel(); };
        btn.__unrPatched__ = true;
      }
      
      var lpLogin = document.getElementById('lp-login');
      const loginCard = document.getElementById('login-card');
      if (lpLogin && loginCard && !loginCard.__unrLinkAdded__) {
        if (!document.getElementById('unr-login-link')) {
          var linkDiv = document.createElement('div');
          linkDiv.id = 'unr-login-link';
          linkDiv.style.cssText = 'text-align:center;margin-top:10px';
          linkDiv.innerHTML = '<button onclick="window._unrShowFromLogin()" style="background:none;border:none;color:#4338CA;font-size:12px;cursor:pointer;font-weight:600;text-decoration:underline">🔍 Username bhool gaye?</button>';
          lpLogin.appendChild(linkDiv);
        }
        loginCard.__unrLinkAdded__ = true;
      }
    }

    function _patchForgotPanel() {
      var hintDiv = document.getElementById('frgt-uname-hint');
      if (hintDiv && !hintDiv.__unrPatched__) {
        hintDiv.innerHTML = '<div style="margin-bottom:8px">💡 <strong>Username bhool gaye?</strong></div>'
          + '<div style="margin-bottom:8px"><button onclick="window._unrShowFromLogin&&window._unrShowFromLogin()" style="background:none;border:none;color:#4338CA;font-size:12px;cursor:pointer;font-weight:700;text-decoration:underline">🔍 Khud Dhundein (Security Question se) →</button></div>'
          + '<div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:8px 12px;font-size:11px;color:#92400e">👨‍💼 <strong>Admin se poochhein:</strong> Admin, Settings → Users tab mein jaye — wahan har user ka @username clearly dikh raha hota hai.</div>';
        hintDiv.style.display = 'block';
        hintDiv.__unrPatched__ = true;
      }
    }

    window._unrShowFromLogin = _unrShowPanel;

    function _unrInit() {
      _buildRecoveryPanel();
      _patchUnameHintButton();
      _patchForgotPanel();
      const authRoot = document.getElementById('auth-root');
      if (authRoot && !authRoot.__unrObs__) {
        new MutationObserver(function () { _patchUnameHintButton(); _patchForgotPanel(); })
          .observe(authRoot, { childList: true, subtree: true });
        authRoot.__unrObs__ = true;
      }
      var lpForgot = document.getElementById('lp-forgot');
      if (lpForgot && !lpForgot.__unrObs__) {
        new MutationObserver(function () { _patchUnameHintButton(); _patchForgotPanel(); })
          .observe(lpForgot, { attributes: true });
        lpForgot.__unrObs__ = true;
      }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _unrInit);
    else _unrInit();

  }());

  
  function _setupFormHandlers() {
    
    var lUser = document.getElementById('l-user');
    var lPass = document.getElementById('l-pass');
    if (lUser) {
      lUser.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); if (lPass) lPass.focus(); }
      });
    }
    if (lPass) {
      lPass.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); auth.doLogin(); }
      });
    }

    var sName  = document.getElementById('s-name');
    var sUser  = document.getElementById('s-user');
    var sPass  = document.getElementById('s-pass');
    var sPass2 = document.getElementById('s-pass2');
    var sSecq  = document.getElementById('s-secq');
    var sSeca  = document.getElementById('s-seca');

    if (sName)  sName.addEventListener('keydown',  function (e) { if (e.key === 'Enter') { e.preventDefault(); if (sUser)  sUser.focus();  } });
    if (sUser)  sUser.addEventListener('keydown',  function (e) { if (e.key === 'Enter') { e.preventDefault(); if (sPass)  sPass.focus();  } });
    if (sPass)  sPass.addEventListener('keydown',  function (e) { if (e.key === 'Enter') { e.preventDefault(); if (sPass2) sPass2.focus(); } });
    if (sPass2) sPass2.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (sSecq)  sSecq.focus();  } });
    if (sSecq)  sSecq.addEventListener('keydown',  function (e) { if (e.key === 'Enter') { e.preventDefault(); if (sSeca)  sSeca.focus();  } });
    if (sSeca)  sSeca.addEventListener('keydown',  function (e) { if (e.key === 'Enter') { e.preventDefault(); auth.createAdmin();        } });

    var t1 = document.getElementById('l-show-pass');
    if (t1 && !t1.__wired__) {
      t1.__wired__ = true;
      t1.addEventListener('click', function (e) { e.preventDefault(); auth.togglePassword('login'); });
    }
    var t2 = document.getElementById('s-show-pass');
    if (t2 && !t2.__wired__) {
      t2.__wired__ = true;
      t2.addEventListener('click', function (e) { e.preventDefault(); auth.togglePassword('setup'); });
    }
  }
  var auth = {
    init: async function () {
      
      const saved = _lsGet(_AUTH.SESSION_KEY);
      if (saved && saved.logged && saved.user && saved.user.username) {
        const dbUser = _findUser(saved.user.username);
        if (dbUser && dbUser.role === saved.user.role) {
          const expectedFp = await _sessionFingerprint(saved.user, dbUser);
          if (_constantTimeEqual(saved.fp || '', expectedFp)) {
            setState(function (s) { s.session.loggedIn = true; s.session.user = { username: dbUser.username, name: dbUser.name, role: dbUser.role }; });
            _setupFormHandlers();
            _postLogin();
            return;
          }
        }
        _lsDel(_AUTH.SESSION_KEY);
      }
      
      const rem = _lsGet(_AUTH.REMEMBER_KEY);
      if (rem && rem.expires > Date.now() && rem.username && rem.token && rem.hmac) {
        const remUser = _findUser(rem.username);
        if (remUser && remUser.remSecret) {
          const _tokenPayload = rem.username + ':' + rem.expires + ':' + rem.token;
          const _expectedHmac = await _hmac(_tokenPayload, remUser.remSecret);
          if (_constantTimeEqual(_expectedHmac, rem.hmac)) {
            setState(function (s) { s.session.loggedIn = true; s.session.user = { username: remUser.username, name: remUser.name, role: remUser.role }; });
            await _saveSession();
            _setupFormHandlers();
            _postLogin();
            return;
          }
        }
        _lsDel(_AUTH.REMEMBER_KEY);
      }
      
      const users = _getUsers();
      if (!users.length) {
        _showLogin(false);
        auth.showPanel('setup');
      } else {
        _showLogin(false);
      }
      _setupFormHandlers();
    },

    login: async function (username, password) {
      username = (username || '').toLowerCase().trim();
      if (!username || !password) { _setErr('Enter username and password.'); return; }
      
      if (_isLocked()) { _setErr('Account locked. Please wait.'); return; }
      
      if (_usersCache === null && ERP._db && ERP._db._isOpen && ERP._db._isOpen()) {
        try {
          var idbUsers = await ERP.Persistence.load('users');
          if (Array.isArray(idbUsers) && idbUsers.length > 0) {
            _usersCache = idbUsers;
            _lsSet(_AUTH.USERS_KEY, idbUsers);
          } else {
            var lsFallback = _lsGet(_AUTH.USERS_KEY);
            if (Array.isArray(lsFallback) && lsFallback.length > 0) _usersCache = lsFallback;
          }
        } catch (_e) {
          var lsFallback2 = _lsGet(_AUTH.USERS_KEY);
          if (Array.isArray(lsFallback2) && lsFallback2.length > 0) _usersCache = lsFallback2;
        }
      }
      const user = _findUser(username);
      if (!user) {
        _aSt.attempts++;
        _audit({ event: 'login_failed', actor: username, severity: 'warning' });
        if (_aSt.attempts >= _AUTH.MAX_TRIES) _startLockout();
        else _setErr('Invalid username or password. (' + (_AUTH.MAX_TRIES - _aSt.attempts) + ' tries left)');
        _showLogin(true); return;
      }
      try {
        const match = await _verifyHash(password, user.pwdHash);
        if (!match) {
          _aSt.attempts++;
          _audit({ event: 'login_failed', actor: username, severity: 'warning' });
          if (_aSt.attempts >= _AUTH.MAX_TRIES) _startLockout();
          else _setErr('Invalid username or password. (' + (_AUTH.MAX_TRIES - _aSt.attempts) + ' tries left)');
          _showLogin(true); return;
        }
        _aSt.attempts = 0;
        _lsDel('mh_login_lock');
        setState(function (s) {
          s.session.loggedIn = true;
          s.session.user = { username: user.username, name: user.name, role: user.role };
        });
        await _saveSession();
        const remEl = document.getElementById('l-remember');
        if (remEl && remEl.checked) {
          try {
            var remSecret = user.remSecret;
            if (!remSecret) {
              remSecret = Array.from(window.crypto.getRandomValues(new Uint8Array(32)))
                .map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
              const _usersForSecret = _getUsers();
              _saveUsers(_usersForSecret.map(function (x) { return x.username === user.username ? Object.assign({}, x, { remSecret: remSecret }) : x; }));
            }
            const _remExpires = Date.now() + 24 * 60 * 60 * 1000;
            const _remToken = Array.from(window.crypto.getRandomValues(new Uint8Array(16)))
              .map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
            const _tokenPayload = user.username + ':' + _remExpires + ':' + _remToken;
            const _remHmac = await _hmac(_tokenPayload, remSecret);
            _lsSet(_AUTH.REMEMBER_KEY, { expires: _remExpires, token: _remToken, username: user.username, hmac: _remHmac });
          } catch (_remErr) {
            if (typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.warn('[auth] remember-me failed', _remErr);
          }
        }
        _audit({ event: 'login_ok', actor: username, after: { role: user.role }, severity: 'info' });
        _postLogin();
      } catch (e) {
        if (typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.warn('[auth] login failed', e);
        if (ERP.ui && ERP.ui.toast) ERP.ui.toast('Login error — please try again. If this keeps happening, contact support.', 'error');
      }
    },

    logout: function (timedOut) {
      
      try {
        const cu = getState().session && getState().session.user;
        if (cu && cu.username) {
          let hasPIN = false;
          try {
            const _fullRec = _findUser(cu.username);
            hasPIN = !!(_fullRec && _fullRec.pinHash);
          } catch (_) {}
          _saveLastUser(cu.username, cu.name, hasPIN);
        }
      } catch (_) {}

      setState(function (s) { s.session.loggedIn = false; s.session.user = null; });
      _lsDel(_AUTH.REMEMBER_KEY);
      _lsDel(_AUTH.SESSION_KEY);
      _clearTimers();
      if (ERP._db && ERP._db.stopAutoBackup) ERP._db.stopAutoBackup();
      if (typeof ERP !== 'undefined') {
        if (ERP._dateInterval)     { clearInterval(ERP._dateInterval);     ERP._dateInterval     = null; }
        if (ERP._guardianInterval) { clearInterval(ERP._guardianInterval); ERP._guardianInterval = null; }
        if (ERP._storageInterval)  { clearInterval(ERP._storageInterval);  ERP._storageInterval  = null; }
      }
      _audit({ event: timedOut ? 'timeout' : 'logout', severity: 'info' });
      const po = document.getElementById('pin-overlay');
      if (po) { po.classList.remove('show'); _unlockBody(); }
      _showLogin(false);
      
      setTimeout(_renderPinLoginSection, 150);
    },

    lockScreen: function () {
      const _savedPinLock = _lsGet('mh_pin_lock');
      if (_savedPinLock && _savedPinLock.until > Date.now()) {
        _aSt.pinLockUntil = _savedPinLock.until;
      } else {
        _aSt.pinLockUntil = 0; _lsDel('mh_pin_lock');
      }
      const sessionUser = getState().session.user;
      const u = sessionUser ? _findUser(sessionUser.username) : null;
      if (u && u.pinHash) {
        _aSt.pinBuf = ''; _aSt.pinTries = 0;
        const po = document.getElementById('pin-overlay');
        if (po) { po.classList.add('show'); _lockBody(); }
        var lbl = document.getElementById('pin-user-lbl');
        if (lbl) lbl.textContent = 'Hello ' + (u.name || u.username) + ' — enter PIN';
        _updPinDots();
      } else {
        if (ERP.ui && ERP.ui.toast) ERP.ui.toast('PIN not set. Go to Settings → Security to set one.', 'info');
      }
    },

    extendSession: function () {
      if (!getState().session.loggedIn) return;
      _clearTimers(); _startTimer();
      const tb = document.getElementById('timeout-bar');
      if (tb) tb.classList.remove('show');
      if (ERP.ui && ERP.ui.toast) ERP.ui.toast('Session extended!', 'success');
    },

    pinKey: function (k) {
      if (_pinLocked()) return;
      const sessionUser = getState().session.user;
      const u = sessionUser ? _findUser(sessionUser.username) : null;
      if (k === 'C') { _aSt.pinBuf = ''; _updPinDots(); return; }
      if (k !== 'OK' && _aSt.pinBuf.length < 4) { _aSt.pinBuf += k; _updPinDots(); }
      if (k === 'OK' && _aSt.pinBuf.length < 4) {
        const pe0 = document.getElementById('pin-err'); if (pe0) pe0.textContent = '❌ 4 digits enter karein';
        return;
      }
      var shouldCheck = k === 'OK' || _aSt.pinBuf.length === 4;
      if (!shouldCheck) return;
      if (!u || !u.pinHash) { _aSt.pinBuf = ''; _updPinDots(); return; }
      const pin = _aSt.pinBuf;
      _verifyHash(pin, u.pinHash).then(function (match) {
        if (match) {
          _aSt.pinTries = 0;
          const po = document.getElementById('pin-overlay');
          if (po) { po.classList.remove('show'); _unlockBody(); }
          const pe = document.getElementById('pin-err'); if (pe) pe.textContent = '';
          if (ERP.ui && ERP.ui.toast) ERP.ui.toast('Screen unlocked ✅', 'success');
          _startTimer();
        } else {
          _aSt.pinTries++;
          const pe2 = document.getElementById('pin-err');
          if (_aSt.pinTries >= _AUTH.PIN_MAX) {
            _aSt.pinLockUntil = Date.now() + _AUTH.PIN_LOCK_MS;
            _aSt.pinTries = 0;
            _lsSet('mh_pin_lock', { until: _aSt.pinLockUntil });
            if (pe2) pe2.textContent = 'Too many tries — locked 30s';
            const lo = document.getElementById('pin-lockout'); if (lo) lo.style.display = 'block';
            var rem = _AUTH.PIN_LOCK_MS / 1000;
            if (_aSt.pinLockInterval) { _timerClear('auth:pinScreenLockout', _aSt.pinLockInterval); _aSt.pinLockInterval = null; }
            _aSt.pinLockInterval = _timerStart('auth:pinScreenLockout', function () {
              rem--;
              const lo2 = document.getElementById('pin-lockout');
              if (lo2) lo2.textContent = '🔒 Locked ' + rem + 's';
              if (rem <= 0) {
                _timerClear('auth:pinScreenLockout', _aSt.pinLockInterval); _aSt.pinLockInterval = null;
                _lsDel('mh_pin_lock');
                if (lo2) lo2.style.display = 'none';
                if (pe2) pe2.textContent = '';
              }
            }, 1000);
          } else {
            if (pe2) pe2.textContent = '❌ Wrong PIN (' + (_AUTH.PIN_MAX - _aSt.pinTries) + ' left)';
          }
          _aSt.pinBuf = ''; _updPinDots();
        }
      });
    },

    showPanel: function (panel) {
      ['login','forgot','setup','pin-login'].forEach(function (p) {
        var el = document.getElementById('lp-' + p);
        if (el) el.style.display = p === panel ? 'block' : 'none';
      });
      if (panel === 'setup')  setTimeout(function () { var n = document.getElementById('s-name'); if (n) n.focus(); }, 80);
      if (panel === 'login')  setTimeout(function () { var u = document.getElementById('l-user'); if (u) u.focus(); }, 80);
      if (panel === 'forgot') {
        const s1 = document.getElementById('frgt-step1');
        const s2 = document.getElementById('frgt-step2');
        const s3 = document.getElementById('frgt-step3');
        if (s1) s1.style.display = 'block';
        if (s2) s2.style.display = 'none';
        if (s3) s3.style.display = 'none';
        
        var _sp1 = document.getElementById('frgt-prog-1'); var _sp2 = document.getElementById('frgt-prog-2'); var _sp3 = document.getElementById('frgt-prog-3');
        if (_sp1) { _sp1.classList.add('active'); _sp1.classList.remove('done'); }
        if (_sp2) { _sp2.classList.remove('active','done'); }
        if (_sp3) { _sp3.classList.remove('active','done'); }
        auth.frgtClearErr();
        ['l-frgt','l-frgt-seca','l-frgt-np','l-frgt-np2'].forEach(function (id) {
          var el = document.getElementById(id); if (el) el.value = '';
        });
        ['frgt-err2','frgt-err3'].forEach(function (id) {
          var el = document.getElementById(id); if (el) { el.style.display = 'none'; el.textContent = ''; }
        });
        var hint = document.getElementById('frgt-uname-hint'); if (hint) hint.style.display = 'none';
        setTimeout(function () { var uinp = document.getElementById('l-frgt'); if (uinp) uinp.focus(); }, 80);
      }
    },

    createAdmin: async function () {
      const name = (document.getElementById('s-name')  || {}).value || '';
      const uname = (document.getElementById('s-user')  || {}).value || '';
      const pass = (document.getElementById('s-pass')  || {}).value || '';
      const pass2 = (document.getElementById('s-pass2') || {}).value || '';
      const errEl = document.getElementById('setup-err');
      function _sErr(msg) { if (errEl) { errEl.textContent = msg; errEl.style.display = msg ? 'block' : 'none'; } }
      if (_creatingAdmin)            { return; }
      if (!name || !uname || !pass) { _sErr('All fields required.'); return; }
      if (pass.length < 6)          { _sErr('Password min 6 characters.'); return; }
      if (pass !== pass2)           { _sErr('Passwords do not match.'); return; }
      if (!/^[a-z0-9_]+$/.test(uname.toLowerCase())) { _sErr('Username: only letters, numbers, underscore.'); return; }
      if (_getUsers().length > 0)   { _sErr('Setup already complete.'); return; }
      _creatingAdmin = true;
      const _createBtn = document.getElementById('s-create-admin-btn');
      if (_createBtn) _createBtn.disabled = true;
      _sErr(null);
      try {
        const secqKey = (document.getElementById('s-secq') || {}).value || '';
        const secaVal = ((document.getElementById('s-seca') || {}).value || '').trim().toLowerCase();
        if (!secqKey) { _sErr('Security question select karein.'); return; }
        if (!secaVal) { _sErr('Security answer enter karein.'); return; }
        if (_getUsers().length > 0)   { _sErr('Setup already complete.'); return; }
        const h = await _hash(pass);
        const secaH = await _hash(secaVal);
        if (_getUsers().length > 0)   { _sErr('Setup already complete.'); return; }
        _saveUsers([{
          username: uname.toLowerCase(), name: name.trim(), role: 'Admin',
          pwdHash: h, pinHash: null, secqKey: secqKey, secqHash: secaH,
          createdAt: _now()
        }]);
        _lsSet(_AUTH.SETUP_KEY, true);
        if (ERP.ui && ERP.ui.toast) ERP.ui.toast('Admin account created! Logging in...', 'success');
        await auth.login(uname, pass);
      } catch (e) { _sErr('Error: ' + e); }
      finally { _creatingAdmin = false; if (_createBtn) _createBtn.disabled = false; }
    },

    frgtClearErr: function () {
      const e1 = document.getElementById('frgt-err1');
      if (e1) { e1.style.display = 'none'; e1.textContent = ''; }
    },
    _frgtShowErr1: function (msg) { var e = document.getElementById('frgt-err1'); if (e) { e.textContent = msg; e.style.display = 'block'; } },
    _frgtShowErr2: function (msg) { var e = document.getElementById('frgt-err2'); if (e) { e.textContent = msg; e.style.display = 'block'; } },
    toggleFrgtUnameHint: function () { var h = document.getElementById('frgt-uname-hint'); if (h) h.style.display = h.style.display === 'none' ? 'block' : 'none'; },

    frgtStep1: function () {
      const uInp = document.getElementById('l-frgt');
      const uname = (uInp && uInp.value || '').trim().toLowerCase();
      auth.frgtClearErr();
      if (!uname) { auth._frgtShowErr1('❌ Username enter karein'); if (uInp) uInp.focus(); return; }
      if (uname.length < 3) { auth._frgtShowErr1('❌ Username kam az kam 3 characters ka hona chahiye'); return; }
      const user = _findUser(uname);
      if (!user) {
        auth._frgtShowErr1('❌ Yeh username registered nahi hai');
        if (uInp) { uInp.classList.add('shake'); setTimeout(function () { uInp.classList.remove('shake'); }, 400); }
        return;
      }
      
      if (!user.secqKey) {
        const e1 = document.getElementById('frgt-err1');
        if (e1) {
          e1.innerHTML = '<strong>⚠️ Self-reset unavailable</strong><br>Is account par security question set nahi tha jab account bana tha.<br>Admin se naya password set karwayein, ya PIN se login karein agar PIN set hai.';
          e1.style.display = 'block';
        }
        return;
      }
      const fnEl = document.getElementById('frgt-found-name'); if (fnEl) fnEl.textContent = user.name || user.username;
      const qText = document.getElementById('frgt-secq-text');
      if (qText) qText.textContent = (_SECQ[user.secqKey]) ? _SECQ[user.secqKey] : '⚠️ Security question set nahi hai — Admin se rabta karein';
      const s1 = document.getElementById('frgt-step1'); if (s1) s1.style.display = 'none';
      const s2 = document.getElementById('frgt-step2'); if (s2) s2.style.display = 'block';
      const s3 = document.getElementById('frgt-step3'); if (s3) s3.style.display = 'none';
      
      const _p1 = document.getElementById('frgt-prog-1'); const _p2 = document.getElementById('frgt-prog-2'); const _p3 = document.getElementById('frgt-prog-3');
      if (_p1) { _p1.classList.remove('active'); _p1.classList.add('done'); }
      if (_p2) { _p2.classList.add('active'); _p2.classList.remove('done'); }
      if (_p3) { _p3.classList.remove('active','done'); }
      const secaInp = document.getElementById('l-frgt-seca');
      if (secaInp) { secaInp.value = ''; secaInp.focus(); }
      const e2 = document.getElementById('frgt-err2'); if (e2) { e2.style.display = 'none'; e2.textContent = ''; }
    },

    frgtStep2: async function () {
      if (!_aSt._secQAttempts) _aSt._secQAttempts = {};
      const uname = (document.getElementById('l-frgt') && document.getElementById('l-frgt').value || '').trim().toLowerCase();
      const _secQRec = _aSt._secQAttempts[uname];
      if (_secQRec && _secQRec.lockedUntil > Date.now()) {
        var _secQRemMs = _secQRec.lockedUntil - Date.now();
        auth._frgtShowErr2('🔒 Bahut zyada galat tries — ' + Math.ceil(_secQRemMs / 1000) + 's wait karein');
        return;
      }
      if (_secQRec && _secQRec.lockedUntil && _secQRec.lockedUntil <= Date.now()) {
        _aSt._secQAttempts[uname] = { tries: 0, lockedUntil: 0 };
      }
      const secaInp = document.getElementById('l-frgt-seca');
      const answer = ((secaInp && secaInp.value) || '').trim().toLowerCase();
      const e2 = document.getElementById('frgt-err2'); if (e2) { e2.style.display = 'none'; e2.textContent = ''; }
      if (!answer) { auth._frgtShowErr2('❌ Jawab enter karein'); if (secaInp) secaInp.focus(); return; }
      const user = _findUser(uname);
      if (!user || !user.secqHash) { auth._frgtShowErr2('❌ Account ka security question set nahi hai'); return; }
      try {
        var match = await _verifyHash(answer, user.secqHash);
        if (!match) {
          var _rec = _aSt._secQAttempts[uname] || { tries: 0, lockedUntil: 0 };
          _rec.tries++;
          if (_rec.tries >= 5) {
            _rec.lockedUntil = Date.now() + _AUTH.LOCK_MS;
            _rec.tries = 0;
            _aSt._secQAttempts[uname] = _rec;
            _audit({ event: 'pwd_reset_locked', actor: uname, severity: 'warning' });
            if (secaInp) { secaInp.value = ''; secaInp.classList.add('shake'); setTimeout(function () { secaInp.classList.remove('shake'); }, 400); }
            auth._frgtShowErr2('🔒 Bahut zyada galat tries — ' + Math.ceil(_AUTH.LOCK_MS / 1000) + 's wait karein');
            return;
          }
          _aSt._secQAttempts[uname] = _rec;
          var _secQLeft = 5 - _rec.tries;
          _audit({ event: 'pwd_reset_wrong_answer', actor: uname, severity: 'warning' });
          if (secaInp) { secaInp.value = ''; secaInp.classList.add('shake'); setTimeout(function () { secaInp.classList.remove('shake'); }, 400); }
          auth._frgtShowErr2('❌ Jawab galat hai — ' + _secQLeft + ' tries baki');
          return;
        }
        const s2 = document.getElementById('frgt-step2'); if (s2) s2.style.display = 'none';
        const s3 = document.getElementById('frgt-step3'); if (s3) s3.style.display = 'block';
        const _p2b = document.getElementById('frgt-prog-2'); const _p3b = document.getElementById('frgt-prog-3');
        if (_p2b) { _p2b.classList.remove('active'); _p2b.classList.add('done'); }
        if (_p3b) { _p3b.classList.add('active'); _p3b.classList.remove('done'); }
        const np = document.getElementById('l-frgt-np');  if (np)  { np.value = ''; np.focus(); }
        const np2 = document.getElementById('l-frgt-np2'); if (np2)  np2.value = '';
        const e3 = document.getElementById('frgt-err3');  if (e3)  { e3.style.display = 'none'; e3.textContent = ''; }
        delete _aSt._secQAttempts[uname];
        if (!_aSt._secQVerified) _aSt._secQVerified = {};
        _aSt._secQVerified[uname] = Date.now() + 5 * 60 * 1000;
      } catch (e) { auth._frgtShowErr2('❌ Error: ' + e); }
    },

    frgtStep3: async function () {
      const uname = (document.getElementById('l-frgt') && document.getElementById('l-frgt').value || '').trim().toLowerCase();
      const np = document.getElementById('l-frgt-np');
      const np2 = document.getElementById('l-frgt-np2');
      const e3 = document.getElementById('frgt-err3');
      function _err3(msg) { if (e3) { e3.textContent = msg; e3.style.display = 'block'; } }
      if (e3) { e3.style.display = 'none'; e3.textContent = ''; }
      const _verifiedUntil = _aSt._secQVerified && _aSt._secQVerified[uname];
      if (!_verifiedUntil || _verifiedUntil < Date.now()) {
        _err3('❌ Security verification expired — wapis se shuru karein');
        auth.frgtBack();
        return;
      }
      const pwd1 = (np && np.value || '');
      const pwd2 = (np2 && np2.value || '');
      if (!pwd1)           { _err3('❌ Naya password enter karein'); if (np) np.focus(); return; }
      if (pwd1.length < 6) { _err3('❌ Password kam az kam 6 characters ka hona chahiye'); return; }
      if (pwd1 !== pwd2)   { _err3('❌ Dono passwords match nahi kar rahe'); if (np2) np2.focus(); return; }
      try {
        const h = await _hash(pwd1);
        const users = _getUsers();
        _saveUsers(users.map(function (x) { return x.username === uname ? Object.assign({}, x, { pwdHash: h, remSecret: null }) : x; }));
        _lsDel(_AUTH.REMEMBER_KEY);
        if (_aSt._secQVerified) delete _aSt._secQVerified[uname];
        _audit({ event: 'pwd_reset_self', actor: uname, severity: 'info' });
        if (ERP.ui && ERP.ui.toast) ERP.ui.toast('✅ Password reset successful! Please log in now.', 'success', 5000);
        auth.showPanel('login');
        var lu = document.getElementById('l-user'); if (lu) lu.value = uname;
        var lp = document.getElementById('l-pass'); if (lp) { lp.value = ''; lp.focus(); }
      } catch (e) {
        if (typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.warn('[auth] frgtStep3 failed', e);
        _err3('❌ Password reset nahi ho saka — dobara try karein.');
      }
    },

    frgtBack: function () {
      const _backUname = (document.getElementById('l-frgt') && document.getElementById('l-frgt').value || '').trim().toLowerCase();
      if (_aSt._secQVerified && _backUname) delete _aSt._secQVerified[_backUname];
      const s1 = document.getElementById('frgt-step1'); if (s1) s1.style.display = 'block';
      const s2 = document.getElementById('frgt-step2'); if (s2) s2.style.display = 'none';
      const s3 = document.getElementById('frgt-step3'); if (s3) s3.style.display = 'none';
      
      var _pb1 = document.getElementById('frgt-prog-1'); var _pb2 = document.getElementById('frgt-prog-2'); var _pb3 = document.getElementById('frgt-prog-3');
      if (_pb1) { _pb1.classList.add('active'); _pb1.classList.remove('done'); }
      if (_pb2) { _pb2.classList.remove('active','done'); }
      if (_pb3) { _pb3.classList.remove('active','done'); }
      const e1 = document.getElementById('frgt-err1'); if (e1) { e1.style.display = 'none'; e1.textContent = ''; }
      const secaInp = document.getElementById('l-frgt-seca'); if (secaInp) secaInp.value = '';
    },

    frgtValidateStrength: function () {
      const np = document.getElementById('l-frgt-np');
      var bar = document.getElementById('frgt-strength-bar');
      var lbl = document.getElementById('frgt-strength-lbl');
      if (!np || !bar || !lbl) return;
      const v = np.value;
      let score = 0;
      if (v.length >= 6)             score++;
      if (v.length >= 10)            score++;
      if (/[A-Z]/.test(v))           score++;
      if (/[0-9]/.test(v))           score++;
      if (/[^A-Za-z0-9]/.test(v))   score++;
      const colors = ['#EF4444','#F97316','#EAB308','#22C55E','#16A34A'];
      const labels = ['Very Weak','Weak','Fair','Strong','Very Strong'];
      bar.style.width      = (score * 20) + '%';
      bar.style.background = colors[score - 1] || '#e2e8f0';
      lbl.textContent      = score ? labels[score - 1] : '';
      lbl.style.color      = colors[score - 1] || '#94a3b8';
    },

    _pinSetupBuf:   '',
    _pinSetupFirst: '',
    _pinSetupStep:  1,

    showPinSetup: function () {
      const modal = document.getElementById('pin-setup-modal');
      if (!modal) {
        if (ERP.ui && ERP.ui.toast) ERP.ui.toast('📱 PIN setup modal not found — please reload the page', 'error', 4000);
        return;
      }
      auth._pinSetupBuf   = '';
      auth._pinSetupFirst = '';
      auth._pinSetupStep  = 1;

      for (var i = 0; i < 4; i++) {
        const d = document.getElementById('psd' + i); if (d) d.classList.remove('on');
      }
      const si1 = document.getElementById('ps-step1-ind'); if (si1) si1.style.background = '#4338CA';
      const si2 = document.getElementById('ps-step2-ind'); if (si2) si2.style.background = '#e2e8f0';

      const title = document.getElementById('pin-setup-title'); if (title) title.textContent = 'Set Screen Lock PIN';
      const sub = document.getElementById('pin-setup-sub');   if (sub)   sub.textContent   = 'Enter a 4-digit PIN for quick screen lock';
      const err = document.getElementById('pin-setup-err');   if (err)   err.textContent   = '';

      try {
        const sessionUser = getState().session && getState().session.user;
        if (sessionUser) {
          const fullUser = _findUser(sessionUser.username);
          if (fullUser && fullUser.pinHash && sub) {
            sub.textContent = '⚠️ PIN already set — enter new PIN to replace it';
          }
        }
      } catch (_) {}

      modal.style.removeProperty('display');
      modal.style.display = 'flex';
      modal.classList.add('show');
      _lockBody();
    },

    closePinSetup: function () {
      const modal = document.getElementById('pin-setup-modal');
      if (modal) {
        modal.classList.remove('show');
        modal.style.display = 'none';
        _unlockBody();
      }
      auth._pinSetupBuf   = '';
      auth._pinSetupFirst = '';
      auth._pinSetupStep  = 1;
    },

    _psUpdateDots: function () {
      for (var i = 0; i < 4; i++) {
        const d = document.getElementById('psd' + i);
        if (d) d.classList.toggle('on', i < auth._pinSetupBuf.length);
      }
    },

    pinSetupKey: function (k) {
      if (k === 'C') { auth._pinSetupBuf = ''; auth._psUpdateDots(); return; }
      if (k !== 'OK' && auth._pinSetupBuf.length < 4) { auth._pinSetupBuf += k; auth._psUpdateDots(); }
      if (auth._pinSetupBuf.length < 4) return;
      var err = document.getElementById('pin-setup-err'); if (err) err.textContent = '';

      if (auth._pinSetupStep === 1) {
        auth._pinSetupFirst = auth._pinSetupBuf; auth._pinSetupBuf = ''; auth._pinSetupStep = 2;
        auth._psUpdateDots();
        const title = document.getElementById('pin-setup-title'); if (title) title.textContent = 'Confirm PIN';
        const sub = document.getElementById('pin-setup-sub');   if (sub)   sub.textContent   = 'Step 2 of 2 — Confirm your PIN';
        var i1 = document.getElementById('ps-step1-ind'); if (i1) i1.style.background = '#22C55E';
        var i2 = document.getElementById('ps-step2-ind'); if (i2) i2.style.background = '#4338CA';
        return;
      }
      if (auth._pinSetupBuf !== auth._pinSetupFirst) {
        if (err) err.textContent = '❌ PINs do not match — please start over';
        auth._pinSetupBuf = ''; auth._pinSetupFirst = ''; auth._pinSetupStep = 1;
        auth._psUpdateDots();
        var t2 = document.getElementById('pin-setup-title'); if (t2) t2.textContent = 'Set Screen Lock PIN';
        const s2 = document.getElementById('pin-setup-sub');   if (s2) s2.textContent = 'Step 1 of 2 — Enter a 4-digit PIN';
        var i1b = document.getElementById('ps-step1-ind'); if (i1b) i1b.style.background = '#4338CA';
        var i2b = document.getElementById('ps-step2-ind'); if (i2b) i2b.style.background = '#e2e8f0';
        return;
      }
      var pin = auth._pinSetupBuf;
      _hash(pin).then(function (h) {
        var u       = getState().session.user;
        const updated = _getUsers().map(function (x) { return x.username === u.username ? Object.assign({}, x, { pinHash: h }) : x; });
        _saveUsers(updated);
        _audit({ event: 'pin_set', actor: u.username, severity: 'info' });
        auth.closePinSetup();
        if (ERP.ui && ERP.ui.toast) ERP.ui.toast('PIN set successfully! Use it on the lock screen.', 'success', 4000);
        
        requestAnimationFrame(_fixPinSetupInSecurityTab);
      });
    },

    removePin: function () {
      const u = getState().session.user;
      if (!u) return;
      const updated = _getUsers().map(function (x) { return x.username === u.username ? Object.assign({}, x, { pinHash: null }) : x; });
      _saveUsers(updated);
      _audit({ event: 'pin_removed', actor: u.username, severity: 'info' });
      if (ERP.ui && ERP.ui.toast) ERP.ui.toast('PIN has been removed', 'info');
      
      var btn = document.getElementById('sets-remove-pin-btn');
      if (btn) btn.remove();
    },

    changePassword: async function (username, oldPwd, newPwd) {
      username = (username || '').toLowerCase().trim();
      const users = _getUsers();
      const u = users.find(function (x) { return x.username === username; });
      if (!u) throw _err('ValidationError', 'User not found', { module: 'Auth', operation: 'changePassword' });
      var oldMatch = await _verifyHash(oldPwd, u.pwdHash);
      if (!oldMatch) throw _err('ValidationError', 'Wrong current password', { module: 'Auth', operation: 'changePassword' });
      if (!newPwd || newPwd.length < 6) throw _err('ValidationError', 'New password must be at least 6 characters', { module: 'Auth', operation: 'changePassword' });
      var nh = await _hash(newPwd);
      _saveUsers(users.map(function (x) { return x.username === username ? Object.assign({}, x, { pwdHash: nh, remSecret: null }) : x; }));
      _audit({ event: 'pwd_changed', actor: username, severity: 'info' });
    },

    showAudit: function () {
      var p = document.getElementById('audit-panel');
      if (p) { p.classList.add('show'); _renderAudit(); }
      if (ERP.ui && ERP.ui.closeUserMenu) ERP.ui.closeUserMenu();
    },
    closeAudit: function () { var p = document.getElementById('audit-panel'); if (p) p.classList.remove('show'); },
    exportAudit: function () {
      const data = JSON.stringify(_lsGet(_AUTH.AUDIT_KEY) || [], null, 2);
      const b = new Blob([data], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'audit-' + Date.now() + '.json';
      a.click();
    },
    clearAudit: function () {
      const btn = document.querySelector('[data-action="auth:clearAudit"]');
      if (btn && btn.dataset.confirm !== '1') {
        btn.dataset.confirm = '1'; btn.textContent = '⚠️ Click again to confirm';
        setTimeout(function () { btn.dataset.confirm = '0'; btn.textContent = '🗑 Clear'; }, 30000);
        return;
      }
      if (btn) { btn.dataset.confirm = '0'; btn.textContent = '🗑 Clear'; }
      _lsDel(_AUTH.AUDIT_KEY);
      _renderAudit();
    },

    getUsers: function () {
      return _getUsers().map(function (u) {
        return { username: u.username, name: u.name, role: u.role };
      });
    },

    addUser: async function (uname, pwd, name, role, secqKey, secaVal) {
      var actingUser = _requireAdmin('addUser');
      if (_findUser(uname)) throw _err('ValidationError', 'Username exists', { module: 'Auth', operation: 'addUser' });
      if (!pwd || pwd.length < 6) throw _err('ValidationError', 'Password too short (min 6)', { module: 'Auth', operation: 'addUser' });
      var _allowedRoles = ['Admin','Manager','Staff','Accountant','Sales','Workshop','Viewer'];
      if (ERP.RBAC && typeof ERP.RBAC === 'object') {
        var _rbacRoles = Object.keys(ERP.RBAC);
        if (_rbacRoles.length > 0) _allowedRoles = _rbacRoles;
      }
      var _assignedRole = role || 'Staff';
      if (_allowedRoles.indexOf(_assignedRole) === -1) throw _err('ValidationError', 'Invalid role: ' + _assignedRole + '. Allowed: ' + _allowedRoles.join(', '), { module: 'Auth', operation: 'addUser' });
      var h = await _hash(pwd);
      const users = _getUsers();
      var secqHash = null;
      if (secqKey && secaVal) secqHash = await _hash(secaVal.trim().toLowerCase());
      users.push({
        username: uname.toLowerCase().trim(), name: name, role: _assignedRole,
        pwdHash: h, pinHash: null, secqKey: secqKey || null, secqHash: secqHash,
        createdAt: _now()
      });
      _saveUsers(users);
      _audit({ event: 'user_added', actor: actingUser.username, after: { username: uname.toLowerCase().trim(), role: _assignedRole }, severity: 'warning' });
    },

    deleteUser: function (username) {
      _requireAdmin('deleteUser');
      username = (username || '').toLowerCase().trim();
      var session = getState().session;
      var me = session && session.user && session.user.username;
      if (me && me === username) throw _err('ValidationError', 'Cannot delete your own account', { module: 'Auth', operation: 'deleteUser' });
      const users = _getUsers();
      const idx = users.findIndex(function (u) { return u.username === username; });
      if (idx === -1) throw _err('ValidationError', 'User not found: ' + username, { module: 'Auth', operation: 'deleteUser' });
      var _targetUser = users[idx];
      if (_targetUser && _targetUser.role === 'Admin') {
        var _remainingAdmins = users.filter(function (u) { return u.role === 'Admin' && u.username !== username; });
        if (_remainingAdmins.length === 0) throw _err('ValidationError', 'Cannot delete the last Admin account. Assign Admin role to another user first.', { module: 'Auth', operation: 'deleteUser' });
      }
      users.splice(idx, 1);
      _saveUsers(users);
      _audit({ event: 'user_deleted', actor: me, after: { deleted: username }, severity: 'warning' });
    },

    updateRole: function (username, newRole) {
      var actingUser = _requireAdmin('updateRole');
      username = (username || '').toLowerCase().trim();
      var allowed = ['Admin','Manager','Staff','Accountant','Sales','Workshop','Viewer'];
      if (ERP.RBAC && typeof ERP.RBAC === 'object') {
        var rbacRoles = Object.keys(ERP.RBAC);
        if (rbacRoles.length > 0) allowed = rbacRoles;
      }
      if (allowed.indexOf(newRole) === -1) throw _err('ValidationError', 'Invalid role: ' + newRole, { module: 'Auth', operation: 'updateRole' });
      const users = _getUsers();
      const u = users.find(function (x) { return x.username === username; });
      if (!u) throw _err('ValidationError', 'User not found: ' + username, { module: 'Auth', operation: 'updateRole' });
      const oldRole = u.role;
      if (oldRole === 'Admin' && newRole !== 'Admin') {
        var _remainingAdmins = users.filter(function (x) { return x.role === 'Admin' && x.username !== username; });
        if (_remainingAdmins.length === 0) throw _err('ValidationError', 'Cannot change the last Admin\u2019s role. Assign Admin role to another user first.', { module: 'Auth', operation: 'updateRole' });
      }
      u.role = newRole;
      _saveUsers(users);
      _audit({ event: 'role_changed', actor: actingUser.username, after: { username: username, from: oldRole, to: newRole }, severity: 'warning' });
    },

    adminResetPassword: async function (username, newPwd) {
      var actingUser = _requireAdmin('adminResetPassword');
      username = (username || '').toLowerCase().trim();
      if (!newPwd || newPwd.length < 6) throw _err('ValidationError', 'Password too short (min 6)', { module: 'Auth', operation: 'adminResetPassword' });
      const users = _getUsers();
      const u = users.find(function (x) { return x.username === username; });
      if (!u) throw _err('ValidationError', 'User not found: ' + username, { module: 'Auth', operation: 'adminResetPassword' });
      const h = await _hash(newPwd);
      u.pwdHash = h;
      u.remSecret = null;
      _saveUsers(users);
      _audit({ event: 'admin_reset_password', actor: actingUser.username, after: { target: username }, severity: 'warning' });
    },

    showSetup: function () { _showLogin(false); auth.showPanel('setup'); },
    doLogin:   function () {
      var u = document.getElementById('l-user');
      var p = document.getElementById('l-pass');
      auth.login((u && u.value) || '', (p && p.value) || '');
    },
    doReset:   function () { auth.frgtStep1(); },
    focusPass: function () { var p = document.getElementById('l-pass'); if (p) p.focus(); },

    togglePassword: function (form) {
      var inpId = form === 'setup' ? 's-pass' : 'l-pass';
      var inp = document.getElementById(inpId);
      var btn = document.getElementById(form === 'setup' ? 's-show-pass' : 'l-show-pass');
      if (!inp) return;
      var isHidden = inp.type === 'password';
      inp.type = isHidden ? 'text' : 'password';
      if (btn) {
        btn.textContent = isHidden ? '🙈' : '👁️';
        btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
      }
    },

    _startTimer:  _startTimer,
    _clearTimers: _clearTimers,

    updateTimeout: function (ms) {
      if (typeof ms !== 'number' || ms < 60000) ms = 30 * 60 * 1000;
      _AUTH.TIMEOUT_MS = ms;
      _startTimer();
    }
  };

  
  function _checkCapsLock(el) {
    const cw = document.getElementById('caps-warn');
    if (!cw || !el) return;
    try { cw.style.display = el.getModifierState && el.getModifierState('CapsLock') ? 'block' : 'none'; } catch (x) {
      if (typeof window !== "undefined" && window !== null && window.DEBUG_MODE) console.warn('[capsLock]', x);
    }
  }
  document.addEventListener('keyup', function (e) { _checkCapsLock(e.target); });
  document.addEventListener('focusin', function (e) {
    if (e.target && (e.target.id === 'l-pass' || e.target.id === 's-pass' || e.target.id === 's-pass2')) {
      _checkCapsLock(e.target);
    }
  });

  document.addEventListener('keydown', function (e) {
    const tag = (e.target.tagName || '').toLowerCase();
    const inInput = tag === 'input' || tag === 'textarea' || tag === 'select';

    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault();
      const s = document.getElementById('gs-input'); if (s) { s.focus(); s.select(); }
      return;
    }

    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-bg.open').forEach(function (m) {
        m.classList.remove('open'); document.body.style.overflow = '';
      });
      const sp = document.getElementById('shortcuts-panel'); if (sp) sp.style.display = 'none';
      const um = document.getElementById('user-menu');       if (um) um.style.display = 'none';
      if (ERP.search) ERP.search.hide();
      document.body.style.overflow = '';
      return;
    }

    if (inInput) return;

    if (e.altKey) {
      switch (e.key.toLowerCase()) {
        case 'd': e.preventDefault(); ERP.go('dashboard'); break;
        case 's': e.preventDefault(); ERP.go('sales'); break;
        case 'p': e.preventDefault(); ERP.go('purchase'); break;
        case 'i': e.preventDefault(); ERP.go('inventory'); break;
        case 'r': e.preventDefault(); ERP.go('parties'); break;
        case 'e': e.preventDefault(); ERP.go('expenses'); break;
        case 't': e.preventDefault(); ERP.go('reports'); break;
        case 'n':
          e.preventDefault(); ERP.go('sales');
          requestAnimationFrame(function () { const btn = document.querySelector('#pv-sales .btn-primary'); if (btn) btn.click(); });
          break;
        case 'c': e.preventDefault(); if (ERP.parties) ERP.parties.openAdd('customer'); break;
        case 'm': e.preventDefault(); if (ERP.actions && ERP.actions.inventory) ERP.actions.inventory.openAdd(); break;
        case 'b': e.preventDefault(); if (ERP._db) ERP._db.backup(); break;
        case '\\': e.preventDefault(); if (ERP.sidebar) ERP.sidebar.toggle(); break;
      }
    }
  });

  ERP.auth = auth;

  ERP._auth_internal = {
    getUsers:     function () { return _getUsers().map(function (u) { return { username: u.username, name: u.name, role: u.role }; }); },
    getUsersFull: function () {
      return _getUsers().map(function (u) {
        return {
          username: u.username, name: u.name, role: u.role,
          pinHash: u.pinHash, secqKey: u.secqKey, secqHash: u.secqHash,
          createdAt: u.createdAt
        };
      });
    },
    findUser:     function (un) { var u = _findUser(un); return u ? { username: u.username, name: u.name, role: u.role } : null; },
    verifyHash:   _verifyHash,
    audit:        _audit,
    AUTH:         _AUTH,
    startTimer:   _startTimer,
    clearTimers:  _clearTimers,
    postLogin:    _postLogin 
  };

})(ERP);

window.ERP = ERP;
