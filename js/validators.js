
const Validators = (function () {
  'use strict';


  function _ok()       { return { ok: true,  error: null }; }
  function _fail(msg)  { return { ok: false, error: msg  }; }

  function _str(val, field, minLen) {
    if (!val || typeof val !== 'string' || !val.trim()) {
      return _fail(field + ' zaroori hai (khali nahi ho sakta)');
    }
    if (minLen && val.trim().length < minLen) {
      return _fail(field + ' kam az kam ' + minLen + ' characters ka hona chahiye');
    }
    return null;
  }

  function _numField(val, field, min, max) {
    const n = Number(val);
    if (isNaN(n) || !isFinite(n)) return _fail(field + ' valid number hona chahiye');
    if (min !== undefined && n < min) return _fail(field + ' ' + min + ' se kam nahi ho sakta');
    if (max !== undefined && n > max) return _fail(field + ' ' + max + ' se zyada nahi ho sakta');
    return null;
  }


  const VALID_JOB_STATUSES = ['pending', 'in-progress', 'waiting-parts', 'completed', 'delivered', 'cancelled'];

  function job(data) {
    if (!data || typeof data !== 'object') return _fail('Job data missing');

    var e;
    if ((e = _str(data.car,   'Vehicle name', 2)))  return e;
    if ((e = _str(data.plate, 'Plate number', 2)))  return e;

    if (data.lab !== undefined) {
      if ((e = _numField(data.lab, 'Labour charges', 0))) return e;
    }
    if (data.dis !== undefined) {
      if ((e = _numField(data.dis, 'Discount', 0))) return e;
      const partsTotal = Array.isArray(data.parts)
        ? data.parts.reduce(function (s, p) { return s + (p.q || 1) * (p.p || 0); }, 0)
        : 0;
      if (data.dis > partsTotal + (data.lab || 0)) {
        return _fail('Discount total amount (' + (partsTotal + (data.lab || 0)) + ') se zyada nahi ho sakta');
      }
    }
    if (data.status && !VALID_JOB_STATUSES.includes(data.status)) {
      return _fail('Invalid status: ' + data.status);
    }
    if (data.parts !== undefined && !Array.isArray(data.parts)) {
      return _fail('Parts list array hona chahiye');
    }
    if (Array.isArray(data.parts)) {
      for (var i = 0; i < data.parts.length; i++) {
        var p = data.parts[i];
        if (!p.n || !p.n.trim()) return _fail('Part #' + (i + 1) + ' ka naam zaroori hai');
        if ((e = _numField(p.q, 'Part #' + (i + 1) + ' quantity', 1))) return e;
        if ((e = _numField(p.p, 'Part #' + (i + 1) + ' price', 0))) return e;
      }
    }
    return _ok();
  }


  function vehicle(data) {
    if (!data || typeof data !== 'object') return _fail('Vehicle data missing');
    var e;
    if ((e = _str(data.plate, 'Plate number', 2))) return e;
    if ((e = _str(data.model, 'Vehicle model', 2))) return e;
    if (data.km !== undefined) {
      if ((e = _numField(data.km, 'Odometer reading', 0))) return e;
    }
    return _ok();
  }


  const VALID_APPT_STATUSES = ['pending', 'in-progress', 'completed', 'cancelled'];

  function appointment(data) {
    if (!data || typeof data !== 'object') return _fail('Appointment data missing');
    var e;
    if ((e = _str(data.cust, 'Customer name', 2))) return e;
    if (!data.date || typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
      return _fail('Valid date zaroori hai (YYYY-MM-DD format)');
    }
    if (data.status && !VALID_APPT_STATUSES.includes(data.status)) {
      return _fail('Invalid appointment status: ' + data.status);
    }
    return _ok();
  }


  function phone(ph) {
    if (!ph) return _ok();
    const cleaned = String(ph).replace(/[^0-9+]/g, '');
    if (!/[0-9]/.test(cleaned)) return _fail('Phone number mein kam az kam 1 digit hona chahiye');
    if (cleaned.length < 7) return _fail('Phone number bahut chota hai');
    if (cleaned.length > 15) return _fail('Phone number bahut lamba hai');
    return _ok();
  }

  function email(val) {
    if (!val) return _ok();
    var s = String(val).trim();
    if (s.length > 254) return _fail('Email bahut lamba hai (max 254 chars)');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,63}$/.test(s)) return _fail('Valid email address enter karein (e.g. name@domain.com)');
    return _ok();
  }

  function pan(val) {
    if (!val) return _ok();
    var s = String(val).trim().toUpperCase();
    var validEntityTypes = ['C','P','H','F','A','T','B','L','J','G'];
    if (validEntityTypes.indexOf(s.charAt(3)) === -1) return _fail('Valid PAN number enter karein — 4th character galat hai');
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(s)) return _fail('Valid PAN number enter karein (e.g. ABCDE1234F)');
    return _ok();
  }

  function gst(val) {
    if (!val) return _ok();
    var s = String(val).trim().toUpperCase();
    if (s.length !== 15) return _fail('GSTIN 15 characters ka hona chahiye');
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(s))
      return _fail('Valid GSTIN enter karein (e.g. 27ABCDE1234F1Z5)');
    var stateCode = parseInt(s.slice(0, 2), 10);
    if (stateCode < 1 || stateCode > 38) return _fail('Invalid state code in GSTIN');
    return _ok();
  }

  function ifsc(val) {
    if (!val) return _ok();
    var s = String(val).trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(s)) return _fail('Valid IFSC code enter karein (e.g. SBIN0001234)');
    return _ok();
  }

  function date(val, opts) {
    var allowFuture = opts && opts.allowFuture === true;
    if (!val) return _fail('Date zaroori hai');
    var s = String(val).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return _fail('Date YYYY-MM-DD format mein honi chahiye');
    var d = new Date(s + 'T00:00:00Z');
    if (isNaN(d.getTime())) return _fail('Invalid date — yeh calendar mein exist nahi karti');
    var y = d.getFullYear();
    if (y < 1900 || y > 2100) return _fail('Date 1900 aur 2100 ke darmiyan honi chahiye');
    var _tenYearsOut = new Date().getFullYear() + 10;
    if (y > _tenYearsOut) return _fail('Date ' + _tenYearsOut + ' se aage nahi ho sakti — please check');
    var parts = s.split('-');
    if (d.getUTCMonth() + 1 !== parseInt(parts[1], 10)) return _fail('Invalid date — mahina galat hai');
    if (d.getDate()       !== parseInt(parts[2], 10)) return _fail('Invalid date — din galat hai');
    if (!allowFuture) {
      var today = new Date(); today.setHours(0, 0, 0, 0);
      if (d > today) return _fail('Future date enter nahi ki ja sakti');
    }
    return _ok();
  }

  function amount(val, opts) {
    var allowZero = opts && opts.allowZero === true;
    var max       = (opts && opts.max) || 1e12;
    if (val === '' || val === null || val === undefined) return _fail('Amount zaroori hai');
    var n = Number(val);
    if (isNaN(n) || !isFinite(n)) return _fail('Amount valid number hona chahiye (text nahi)');
    if (n < 0) return _fail('Amount negative nahi ho sakta');
    if (!allowZero && n === 0) return _fail('Amount zero se zyada hona chahiye');
    if (n > max) return _fail('Amount ' + max.toLocaleString() + ' se zyada nahi ho sakta');
    return _ok();
  }

  function quantity(val, opts) {
    var allowZero    = opts && opts.allowZero    === true;
    var _decimalUnits = ['LITRE', 'LITER', 'KG', 'KILOGRAM', 'GRAM', 'METER', 'METRE', 'ML', 'L', 'G'];
    var _itemUnit = opts && opts.unit ? String(opts.unit).toUpperCase().trim() : '';
    var allowDecimal = (opts && opts.allowDecimal === true) || (_itemUnit && _decimalUnits.indexOf(_itemUnit) !== -1);
    var max          = (opts && opts.max) || 999999;
    if (val === '' || val === null || val === undefined) return _fail('Quantity zaroori hai');
    var n = Number(val);
    if (isNaN(n) || !isFinite(n)) return _fail('Quantity valid number hona chahiye');
    if (n < 0) return _fail('Quantity negative nahi ho sakti');
    if (!allowZero && n === 0) return _fail('Quantity zero se zyada honi chahiye');
    if (!allowDecimal && n !== Math.floor(n)) return _fail('Yeh item decimal quantity accept nahi karta (whole units only)');
    if (n > max) return _fail('Quantity ' + max + ' se zyada nahi ho sakti');
    return _ok();
  }

  function password(val, opts) {
    var minLen = (opts && opts.minLen) || 6;
    if (!val) return _fail('Password zaroori hai');
    var s = String(val);
    if (s.length < minLen) return _fail('Password kam az kam ' + minLen + ' characters ka hona chahiye');
    if (s.length > 128)    return _fail('Password 128 characters se zyada nahi ho sakta');
    var score = 0;
    if (s.length >= 8)           score++;
    if (/[A-Z]/.test(s))         score++;
    if (/[0-9]/.test(s))         score++;
    if (/[^A-Za-z0-9]/.test(s))  score++;
    if (opts && opts.requireStrong && score < 2)
      return _fail('Password zyada strong hona chahiye — numbers aur uppercase letters shamil karein');
    return _ok();
  }

  function username(val) {
    if (!val) return _fail('Username zaroori hai');
    var s = String(val).trim();
    if (s.length < 3)  return _fail('Username kam az kam 3 characters ka hona chahiye');
    if (s.length > 50) return _fail('Username 50 characters se zyada nahi ho sakta');
    if (!/^[a-zA-Z0-9_]+$/.test(s))
      return _fail('Username mein sirf letters, numbers aur underscore allowed hain');
    if (/^[0-9]/.test(s)) return _fail('Username number se shuru nahi ho sakta');
    return _ok();
  }

  function price(val, opts) {
    var allowZero = opts && opts.allowZero === true;
    var max       = (opts && opts.max) || 1e12;
    if (val === '' || val === null || val === undefined) return _fail('Price zaroori hai');
    var n = Number(val);
    if (isNaN(n) || !isFinite(n)) return _fail('Price valid number hona chahiye');
    if (n < 0) return _fail('Price negative nahi ho sakti');
    if (!allowZero && n === 0) return _fail('Price zero se zyada honi chahiye');
    if (n > max) return _fail('Price ' + max.toLocaleString() + ' se zyada nahi ho sakti');
    return _ok();
  }

  return { job, vehicle, appointment, phone, email, pan, gst, ifsc, date, amount, quantity, password, username, price };
})();
