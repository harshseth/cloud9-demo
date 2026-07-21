/* Cortex demo — PHI detection and redaction. Redacted by default, always. Team Cloud 9. */
window.CORTEX = window.CORTEX || {};

CORTEX.redact = (function () {
  'use strict';
  var esc = CORTEX.util.esc;

  // Capitalized words that routinely sit next to a name but are not part of one. A candidate
  // bare name containing any of these is rejected, so "Patient Smith" never masks "Patient"
  // and "Bravo Team" is left alone entirely.
  var NOT_NAME = ('patient pt member subscriber guarantor provider doctor nurse clinician ' +
    'team health hospital clinic center centre medical group system systems services service ' +
    'department dept unit ward room suite floor building campus ' +
    'street st avenue ave road rd drive dr court ct lane ln boulevard blvd place pl way ' +
    'north south east west new old saint mount lake port fort ' +
    'monday tuesday wednesday thursday friday saturday sunday ' +
    'january february march april may june july august september october november december ' +
    'emergency laboratory lab imaging radiology cardiology oncology pharmacy surgery nursing ' +
    'insurance payer plan policy claim record report note order result results portal ' +
    'prior auth authorization referral encounter admission discharge care ' +
    'cortex epic beaker radiant kronos workday snowflake').split(' ');

  function looksLikeName(value) {
    var words = value.split(/\s+/);
    for (var i = 0; i < words.length; i++) {
      var w = words[i].replace(/[.,]/g, '').toLowerCase();
      if (NOT_NAME.indexOf(w) !== -1) return false;
    }
    return true;
  }

  // Order is priority order: a more precise detector claims its span first and a looser one
  // can no longer overlap it. Address before NAME so "48 Harborview Street" is not partly
  // claimed by the name matcher, and cue-based NAME before bare NAME so the cue word survives.
  var DETECTORS = [
    { type: 'SSN', re: /\b\d{3}-\d{2}-\d{4}\b/g },
    { type: 'MRN', re: /\bMRN[:#]?\s*[A-Z0-9]{2,}-?[A-Z0-9]{2,}\b/gi },
    { type: 'EMAIL', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
    { type: 'PHONE', re: /(?:\+1[-. ]?)?(?:\(\d{3}\)|\b\d{3})[-. ]?\d{3}[-. ]?\d{4}\b/g },
    { type: 'DOB', re: /\b(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b/g },
    { type: 'DOB', re: /\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/g },
    { type: 'INSURANCE_ID', re: /\b[A-Z]{3}\d{6,10}\b/g },
    { type: 'ADDRESS', re: /\b\d{1,5}\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\b\.?(?:\s*,\s*[A-Z][A-Za-z]+\s+[A-Z]{2})?/g },
    // Name introduced by an honorific or role cue. Only group 1 — the name itself — is
    // redacted; the cue word ("Patient", "Dr.") is non-sensitive context and is preserved.
    { type: 'NAME', group: 1,
      re: /\b(?:Mr|Mrs|Ms|Mx|Dr|Patient|patient|Pt|Member|member)\.?\s+([A-Z][a-z]+(?:\s+[A-Z]\.)?(?:\s+[A-Z][a-z]+(?:-[A-Z][a-z]+)?)?)/g },
    // Bare full name with no cue: First [M.] Last. Guarded by NOT_NAME so ordinary
    // capitalized phrases ("Bravo Team", "Emergency Department") are not masked.
    { type: 'NAME', guard: looksLikeName,
      re: /\b[A-Z][a-z]{2,}(?:\s+[A-Z]\.)?\s+[A-Z][a-z]{2,}(?:-[A-Z][a-z]+)?\b/g }
  ];

  // Claim spans in detector-priority order, never in text order. A precise detector takes its
  // span first; a looser detector may then only claim text nobody else wanted. This is what
  // keeps a cue word like "Patient" out of the mask when it sits in front of a name.
  function detect(text) {
    if (!text) return [];
    var claimed = [];

    function taken(start, end) {
      for (var i = 0; i < claimed.length; i++) {
        if (start < claimed[i].end && end > claimed[i].start) return true;
      }
      return false;
    }

    DETECTORS.forEach(function (d) {
      var re = new RegExp(d.re.source, d.re.flags);
      var m;
      while ((m = re.exec(text)) !== null) {
        if (m[0] === '') { re.lastIndex++; continue; }
        var value = d.group ? m[d.group] : m[0];
        if (value === undefined || value === '') continue;
        if (d.guard && !d.guard(value)) continue;
        var start = d.group ? m.index + m[0].indexOf(value) : m.index;
        var end = start + value.length;
        if (taken(start, end)) continue;
        claimed.push({ type: d.type, value: value, start: start, end: end });
      }
    });

    claimed.sort(function (a, b) { return a.start - b.start; });
    return claimed;
  }

  function mask(value) {
    var n = Math.min(String(value).length, 18);
    return new Array(Math.max(n, 4) + 1).join('█');
  }

  // Plain-text redaction: what leaves the UI when nothing is revealed. Only the identifier
  // itself is replaced — every surrounding character is passed through byte-for-byte, and the
  // placeholder names the detector so a reader can tell what was removed and why.
  function redactText(text) {
    var spans = detect(text);
    var out = '';
    var last = 0;
    spans.forEach(function (s) {
      out += text.slice(last, s.start) + '[' + s.type + ' REDACTED]';
      last = s.end;
    });
    return { text: out + text.slice(last), spans: spans };
  }

  // Everything that is NOT redacted, for verifying context is preserved.
  function preservedText(text) {
    var spans = detect(text);
    var out = '';
    var last = 0;
    spans.forEach(function (s) { out += text.slice(last, s.start); last = s.end; });
    return out + text.slice(last);
  }

  // The "visible redaction preview" — raw text with every detected span highlighted and
  // labelled by the detector that claimed it.
  function previewHTML(text) {
    var spans = detect(text);
    var out = '';
    var last = 0;
    spans.forEach(function (s) {
      out += esc(text.slice(last, s.start));
      out += '<mark class="span span-' + esc(s.type) + '" title="detector: ' + esc(s.type) + '">' +
             esc(s.value) + '<sup>' + esc(s.type) + '</sup></mark>';
      last = s.end;
    });
    out += esc(text.slice(last));
    return { html: out, spans: spans };
  }

  // The redacted output, with the placeholders marked so preserved context is visibly intact.
  function redactedHTML(text) {
    var spans = detect(text);
    var out = '';
    var last = 0;
    spans.forEach(function (s) {
      out += esc(text.slice(last, s.start));
      out += '<span class="redacted-tag">[' + esc(s.type) + ' REDACTED]</span>';
      last = s.end;
    });
    out += esc(text.slice(last));
    return { html: out, spans: spans };
  }

  function summarize(spans) {
    var counts = {};
    spans.forEach(function (s) { counts[s.type] = (counts[s.type] || 0) + 1; });
    return counts;
  }

  return { DETECTORS: DETECTORS, detect: detect, mask: mask, redactText: redactText,
           preservedText: preservedText,
           previewHTML: previewHTML, redactedHTML: redactedHTML, summarize: summarize };
})();
