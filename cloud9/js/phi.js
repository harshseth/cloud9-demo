/* Cortex demo — PHI controls: redacted by default, justified reveal. Team Cloud 9. */
window.CORTEX = window.CORTEX || {};

CORTEX.phi = (function () {
  'use strict';
  var util = CORTEX.util, rbac = CORTEX.rbac, app = CORTEX.app, redact = CORTEX.redact, data = CORTEX.data;
  var esc = util.esc;

  var REVEAL_MS = 60000;
  var reveals = {};        // "recordId::fieldKey" -> { until, justification, reason }
  var preview = false;     // redaction-preview toggle
  var pending = null;      // field awaiting a justification
  var ticker = null;

  var REASON_CODES = [
    'Treatment — direct patient care',
    'Payment — claim or billing resolution',
    'Health care operations — quality review',
    'Security investigation — incident response',
    'Patient request — record access'
  ];

  function key(rid, fkey) { return rid + '::' + fkey; }

  function isRevealed(rid, fkey) {
    var r = reveals[key(rid, fkey)];
    return !!(r && r.until > Date.now());
  }

  function sweepExpired() {
    var now = Date.now();
    var changed = false;
    Object.keys(reveals).forEach(function (k) {
      var r = reveals[k];
      if (r.until <= now && !r.logged) {
        r.logged = true;
        changed = true;
        app.log('PHI_REVEAL_EXPIRED', {
          object: k.replace('::', ' / '),
          tier: 'PHI',
          inputs: { window_seconds: REVEAL_MS / 1000 },
          outputs: { field_state: 'auto re-redacted' },
          justification: 'Time-boxed reveal elapsed; the field re-masked without user action.',
          lineage: 'phi-controls -> ui'
        });
        delete reveals[k];
      }
    });
    return changed;
  }

  function startTicker() {
    if (ticker) return;
    ticker = setInterval(function () {
      var live = Object.keys(reveals).length > 0;
      if (sweepExpired()) app.render();
      else if (live && app.state.tab === 'phi') renderCountdowns();
      if (!Object.keys(reveals).length) { clearInterval(ticker); ticker = null; }
    }, 1000);
  }

  /* ------------------------------------------------------------- reveal flow */

  function requestReveal(rid, fkey) {
    if (!rbac.can(app.state.role, 'reveal_phi')) {
      return app.deny('reveal_phi', rid + ' / ' + fkey, 'Field stayed redacted.');
    }
    pending = { rid: rid, fkey: fkey };
    app.render();
    var ta = util.$('#justifyText');
    if (ta) ta.focus();
  }

  function confirmReveal() {
    if (!pending) return;
    var reason = util.$('#reasonCode').value;
    var text = (util.$('#justifyText').value || '').trim();
    if (text.length < 20) {
      app.toast('Justification must be at least 20 characters. It is stored verbatim in the audit log.');
      return;
    }
    var k = key(pending.rid, pending.fkey);
    reveals[k] = { until: Date.now() + REVEAL_MS, justification: text, reason: reason };
    app.log('PHI_REVEALED', {
      object: pending.rid + ' / ' + pending.fkey,
      tier: 'PHI',
      inputs: { reason_code: reason, field: pending.fkey, record: pending.rid,
                step_up: 'IdP-enforced (SAML/OIDC) — federated to St. Catherine\'s' },
      outputs: { revealed: true, scope: 'single field', expires_in_seconds: REVEAL_MS / 1000 },
      justification: text,
      lineage: 'phi-vault -> reveal-gate -> ui'
    });
    pending = null;
    startTicker();
    app.toast('Revealed for 60 seconds, then it re-redacts automatically. Logged with your justification.');
    app.render();
  }

  function cancelReveal() { pending = null; app.render(); }

  function hideNow(rid, fkey) {
    delete reveals[key(rid, fkey)];
    app.log('PHI_REHIDDEN', {
      object: rid + ' / ' + fkey, tier: 'PHI',
      inputs: {}, outputs: { field_state: 'redacted' },
      justification: 'Manually re-redacted by ' + app.actor() + '.',
      lineage: 'phi-controls -> ui'
    });
    app.render();
  }

  /* ------------------------------------------------------------------ render */

  function fieldRow(rec, f) {
    var revealed = isRevealed(rec.id, f.key);
    var sensitive = !!f.detector;
    var body, ctrl = '';

    if (!sensitive) {
      body = '<span class="val">' + esc(f.value) + '</span>';
      ctrl = '<span class="muted small">not classified as PHI</span>';
    } else if (revealed) {
      var left = Math.ceil((reveals[key(rec.id, f.key)].until - Date.now()) / 1000);
      body = '<span class="val revealed">' + esc(f.value) + '</span>' +
             '<span class="countdown" data-cd="' + esc(key(rec.id, f.key)) + '">re-redacts in ' + left + 's</span>';
      ctrl = '<button class="btn tiny" data-phi="hide" data-rid="' + esc(rec.id) + '" data-fkey="' + esc(f.key) + '">Hide now</button>';
    } else {
      body = '<span class="val"><span class="redacted">' + redact.mask(f.value) + '</span>' +
             '<span class="det">' + esc(f.detector) + '</span></span>';
      var can = rbac.can(app.state.role, 'reveal_phi');
      ctrl = '<button class="btn tiny" data-phi="reveal" data-rid="' + esc(rec.id) + '" data-fkey="' + esc(f.key) + '"' +
        (can ? '' : ' disabled title="' + esc(rbac.denial(app.state.role, 'reveal_phi')) + '"') + '>Reveal…</button>';
      if (!can) ctrl += '<span class="deny-note">' + esc(rbac.denial(app.state.role, 'reveal_phi')) + '</span>';
    }
    return '<tr><th>' + esc(f.key) + '</th><td>' + body + '</td><td class="ctrl">' + ctrl + '</td></tr>';
  }

  function recordCard(rec) {
    var raw = rec.fields.map(function (f) { return f.key + ': ' + f.value; }).join('\n');
    var pv = preview ? redact.previewHTML(raw) : null;
    return '<article class="card">' +
      '<header class="card-head"><div><span class="oid">' + esc(rec.id) + '</span>' +
      '<h3>Patient record</h3></div><span class="badge phi">PHI — redacted by default</span></header>' +
      '<table class="fields">' + rec.fields.map(function (f) { return fieldRow(rec, f); }).join('') + '</table>' +
      (pv ? '<div class="preview"><div class="preview-head">Redaction preview — raw text with every detected span highlighted</div>' +
        '<pre class="preview-body">' + pv.html + '</pre>' +
        '<div class="muted small">' + Object.keys(redact.summarize(pv.spans)).map(function (t) {
          return esc(t) + ' ×' + redact.summarize(pv.spans)[t];
        }).join(' · ') + ' — this is what the redactor removes before anything leaves the UI.</div></div>' : '') +
      '</article>';
  }

  function renderCountdowns() {
    util.$$('[data-cd]').forEach(function (el) {
      var r = reveals[el.dataset.cd];
      if (!r) return;
      el.textContent = 're-redacts in ' + Math.max(0, Math.ceil((r.until - Date.now()) / 1000)) + 's';
    });
  }

  function renderScratch() {
    var ta = util.$('#scratchInput');
    if (!ta) return;
    var text = ta.value;
    var out = util.$('#scratchOut');
    if (!text.trim()) { out.innerHTML = '<div class="muted small">Type or paste text above.</div>'; return; }
    var pv = redact.previewHTML(text);
    var counts = redact.summarize(pv.spans);
    out.innerHTML =
      '<div class="scratch-col"><div class="preview-head">Detected (' + pv.spans.length + ' spans)</div>' +
        '<pre class="preview-body">' + pv.html + '</pre></div>' +
      '<div class="scratch-col"><div class="preview-head">What Cortex stores / displays</div>' +
        '<pre class="preview-body">' + redact.redactedHTML(text).html + '</pre>' +
        '<div class="muted small">Only the identifier is replaced — surrounding words are passed ' +
        'through unchanged.</div></div>' +
      '<div class="muted small">' + (pv.spans.length
        ? Object.keys(counts).map(function (t) { return esc(t) + ' ×' + counts[t]; }).join(' · ')
        : 'No direct identifiers matched.') + '</div>';
  }

  function render() {
    var host = util.$('#phiRecords');
    if (!host) return;

    util.$('#previewToggle').textContent = preview ? 'Hide redaction preview' : 'Show redaction preview';
    util.$('#previewToggle').classList.toggle('primary', preview);

    host.innerHTML = data.records.map(recordCard).join('');

    var modal = util.$('#revealModal');
    if (pending) {
      util.$('#revealTarget').textContent = pending.rid + ' / ' + pending.fkey;
      util.$('#reasonCode').innerHTML = REASON_CODES.map(function (r) {
        return '<option>' + esc(r) + '</option>';
      }).join('');
      modal.hidden = false;
    } else {
      modal.hidden = true;
      var jt = util.$('#justifyText'); if (jt) jt.value = '';
    }
    renderScratch();
  }

  function init() {
    util.$('#phiRecords').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-phi]');
      if (!b) return;
      if (b.dataset.phi === 'reveal') requestReveal(b.dataset.rid, b.dataset.fkey);
      if (b.dataset.phi === 'hide') hideNow(b.dataset.rid, b.dataset.fkey);
    });
    util.$('#previewToggle').addEventListener('click', function () { preview = !preview; app.render(); });
    util.$('#revealConfirm').addEventListener('click', confirmReveal);
    util.$('#revealCancel').addEventListener('click', cancelReveal);
    util.$('#justifyText').addEventListener('input', function () {
      var n = this.value.trim().length;
      util.$('#justifyCount').textContent = n + ' / 20 characters minimum';
      util.$('#revealConfirm').disabled = n < 20;
    });
    var scratch = util.$('#scratchInput');
    scratch.value = data.sampleFreeText;
    scratch.addEventListener('input', renderScratch);
    util.$('#scratchSample').addEventListener('click', function () {
      scratch.value = data.sampleFreeText; renderScratch();
    });
    util.$('#scratchClear').addEventListener('click', function () {
      scratch.value = ''; renderScratch();
    });
    app.onRender(render);
  }

  return { init: init };
})();
