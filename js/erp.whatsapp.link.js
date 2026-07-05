/* erp.whatsapp.link.js
 * Single source of truth for building wa.me links, replacing 11 independently
 * duplicated implementations (see audit finding #96) that disagreed on phone
 * normalization — some added the '92' country code for local (0-prefixed /
 * 10-digit) numbers, some didn't, so the same customer number could produce a
 * working link on one screen and a broken one on another.
 *
 * Rule (matches the majority/most-complete existing implementation, from
 * reports.js's _waBtn): strip all non-digits, then:
 *   - 10 digits              -> prefix with '92' (local number missing leading 0)
 *   - starts with '0'        -> replace leading 0 with '92'
 *   - already has country code (>12 digits) -> keep the last 12 digits
 *   - otherwise              -> leave as-is (already looks like it has a country code)
 */
(function (root) {
  'use strict';

  function normalize(phone) {
    var digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 10) return '92' + digits;
    if (digits.charAt(0) === '0') return '92' + digits.slice(1);
    if (digits.length > 12) return digits.slice(-12);
    return digits;
  }

  function build(phone, message) {
    var ph = normalize(phone);
    if (!ph) return null;
    return 'https://wa.me/' + ph + (message ? '?text=' + encodeURIComponent(message) : '');
  }

  // Opens the link, falling back to same-tab navigation if the popup was blocked
  // (same fallback pattern already used consistently across the codebase).
  function open(phone, message, onBlocked) {
    var url = build(phone, message);
    if (!url) return false;
    var w = window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) {
      if (typeof onBlocked === 'function') onBlocked();
      else window.location.href = url;
    }
    return true;
  }

  var ERP = root.ERP = root.ERP || {};
  ERP.WhatsAppLink = { normalize: normalize, build: build, open: open };
})(window);
