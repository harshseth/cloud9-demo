/* Cortex demo — small shared helpers. Team Cloud 9. */
window.CORTEX = window.CORTEX || {};

CORTEX.util = (function () {
  'use strict';

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function iso(ts) { return new Date(ts).toISOString().replace('.000', ''); }

  function money(n) {
    return '$' + Number(n).toLocaleString('en-US');
  }

  function kv(obj) {
    return Object.keys(obj).map(function (k) {
      return k + '=' + (typeof obj[k] === 'object' ? JSON.stringify(obj[k]) : obj[k]);
    }).join('; ');
  }

  // Deterministic, synchronous 64-bit-ish hash (FNV-1a x2). Stands in for SHA-256 so the
  // audit chain can be verified inline without an async crypto call.
  function hash(str) {
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      h1 ^= c; h1 = (h1 * 0x01000193) >>> 0;
      h2 = ((h2 ^ c) * 0x85ebca6b) >>> 0;
      h2 = (h2 ^ (h2 >>> 13)) >>> 0;
    }
    function hex(n) { var s = (n >>> 0).toString(16); return '00000000'.slice(s.length) + s; }
    return hex(h1) + hex(h2);
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function csvCell(v) {
    var s = (typeof v === 'object' && v !== null) ? JSON.stringify(v) : String(v === undefined || v === null ? '' : v);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function toCSV(rows, columns) {
    var out = [columns.map(csvCell).join(',')];
    rows.forEach(function (r) {
      out.push(columns.map(function (c) { return csvCell(r[c]); }).join(','));
    });
    return out.join('\r\n');
  }

  return { esc: esc, $: $, $$: $$, iso: iso, money: money, kv: kv, hash: hash,
           download: download, toCSV: toCSV };
})();
