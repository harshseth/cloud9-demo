/* Cortex demo — PHI detection and redaction. Redacted by default, always. Team Cloud 9. */
window.CORTEX = window.CORTEX || {};

CORTEX.redact = (function () {
  'use strict';
  var esc = CORTEX.util.esc;

  // Order is priority order: an earlier detector wins an overlap. Address before NAME so
  // "48 Harborview Street" is not partly claimed by the name matcher.
  var DETECTORS = [
    { type: 'SSN', re: /\b\d{3}-\d{2}-\d{4}\b/g },
    { type: 'MRN', re: /\bMRN[:#]?\s*[A-Z0-9]{2,}-?[A-Z0-9]{2,}\b/gi },
    { type: 'EMAIL', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
    { type: 'PHONE', re: /(?:\+1[-. ]?)?(?:\(\d{3}\)|\b\d{3})[-. ]?\d{3}[-. ]?\d{4}\b/g },
    { type: 'DOB', re: /\b(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b/g },
    { type: 'DOB', re: /\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/g },
    { type: 'INSURANCE_ID', re: /\b[A-Z]{3}\d{6,10}\b/g },
    { type: 'ADDRESS', re: /\b\d{1,5}\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\b\.?(?:\s*,\s*[A-Z][A-Za-z]+\s+[A-Z]{2})?/g },
    // Name with an honorific/role cue — the name itself is captured in group 1.
    { type: 'NAME', re: /\b(?:Mr|Mrs|Ms|Dr|Patient|patient|Pt)\.?\s+([A-Z][a-z]+(?:\s+[A-Z]\.)?(?:\s+[A-Z][a-z]+(?:-[A-Z][a-z]+)?)?)/g, group: 1 },
    // Bare full name: First [M.] Last, optionally hyphenated.
    { type: 'NAME', re: /\b[A-Z][a-z]{2,}(?:\s+[A-Z]\.)?\s+[A-Z][a-z]{2,}(?:-[A-Z][a-z]+)?\b/g }
  ];

  function detect(text) {
    if (!text) return [];
    var found = [];
    DETECTORS.forEach(function (d, priority) {
      var re = new RegExp(d.re.source, d.re.flags);
      var m;
      while ((m = re.exec(text)) !== null) {
        if (m[0] === '') { re.lastIndex++; continue; }
        var value = d.group ? m[d.group] : m[0];
        var start = d.group ? m.index + m[0].indexOf(m[d.group]) : m.index;
        found.push({ type: d.type, value: value, start: start, end: start + value.length, priority: priority });
      }
    });
    // Resolve overlaps: earliest start wins; ties break to the higher-priority detector,
    // then to the longer span.
    found.sort(function (a, b) {
      return a.start - b.start || a.priority - b.priority || (b.end - b.start) - (a.end - a.start);
    });
    var kept = [];
    var cursor = -1;
    found.forEach(function (f) {
      if (f.start >= cursor) { kept.push(f); cursor = f.end; }
    });
    return kept;
  }

  function mask(value) {
    var n = Math.min(String(value).length, 18);
    return new Array(Math.max(n, 4) + 1).join('█');
  }

  // Plain-text redaction: what leaves the UI when nothing is revealed.
  function redactText(text) {
    var spans = detect(text);
    var out = '';
    var last = 0;
    spans.forEach(function (s) {
      out += text.slice(last, s.start) + mask(s.value);
      last = s.end;
    });
    return { text: out + text.slice(last), spans: spans };
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

  function redactedHTML(text) {
    var r = redactText(text);
    return { html: esc(r.text).replace(/█+/g, function (m) { return '<span class="redacted">' + m + '</span>'; }), spans: r.spans };
  }

  function summarize(spans) {
    var counts = {};
    spans.forEach(function (s) { counts[s.type] = (counts[s.type] || 0) + 1; });
    return counts;
  }

  return { DETECTORS: DETECTORS, detect: detect, mask: mask, redactText: redactText,
           previewHTML: previewHTML, redactedHTML: redactedHTML, summarize: summarize };
})();
