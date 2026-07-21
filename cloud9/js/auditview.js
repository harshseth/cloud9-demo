/* Cortex demo — audit log view: filter, verify chain, export. Team Cloud 9. */
window.CORTEX = window.CORTEX || {};

CORTEX.auditview = (function () {
  'use strict';
  var util = CORTEX.util, rbac = CORTEX.rbac, app = CORTEX.app, audit = CORTEX.audit;
  var esc = util.esc;

  var expanded = {};

  function filters() {
    return {
      q: util.$('#auditQ').value.trim(),
      actor: util.$('#auditActor').value,
      action: util.$('#auditAction').value,
      tier: util.$('#auditTier').value
    };
  }

  function rows() {
    return audit.filter(filters()).slice().reverse(); // newest first
  }

  function row(e) {
    var open = expanded[e.seq];
    return '<tr class="arow' + (open ? ' open' : '') + '" data-seq="' + e.seq + '">' +
        '<td class="mono">' + e.seq + '</td>' +
        '<td class="mono nowrap">' + esc(util.iso(e.ts)) + '</td>' +
        '<td>' + esc(e.actor) + '<div class="muted small">' + esc(e.role) + '</div></td>' +
        '<td><span class="act act-' + esc(e.action.toLowerCase()) + '">' + esc(e.action) + '</span></td>' +
        '<td class="mono">' + esc(e.object) + '</td>' +
        '<td><span class="badge tier-badge t-' + esc(String(e.tier).toLowerCase()) + '">' + esc(e.tier) + '</span></td>' +
        '<td class="mono small hashcell">' + esc(e.hash.slice(0, 10)) + '…</td>' +
      '</tr>' +
      (open ? '<tr class="adetail"><td colspan="7">' +
        '<div class="kvgrid">' +
          '<div><b>Inputs</b><pre>' + esc(JSON.stringify(e.inputs, null, 2)) + '</pre></div>' +
          '<div><b>Outputs</b><pre>' + esc(JSON.stringify(e.outputs, null, 2)) + '</pre></div>' +
        '</div>' +
        (e.justification ? '<div class="just"><b>Justification:</b> ' + esc(e.justification) + '</div>' : '') +
        (e.lineage ? '<div class="just"><b>Lineage:</b> <code>' + esc(e.lineage) + '</code></div>' : '') +
        '<div class="chain"><b>Chain:</b> <code>prev ' + esc(e.prevHash) + '</code> → <code>' + esc(e.hash) + '</code></div>' +
        '</td></tr>' : '');
  }

  function fillSelect(sel, values, label) {
    var cur = sel.value;
    sel.innerHTML = '<option value="">' + esc(label) + '</option>' +
      values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
    if (values.indexOf(cur) !== -1) sel.value = cur;
  }

  function render() {
    var host = util.$('#auditBody');
    if (!host) return;

    fillSelect(util.$('#auditActor'), audit.actors(), 'All actors');
    fillSelect(util.$('#auditAction'), audit.actions(), 'All actions');

    var list = rows();
    host.innerHTML = list.length
      ? list.map(row).join('')
      : '<tr><td colspan="7" class="muted">No entries match these filters.</td></tr>';
    util.$('#auditCount').textContent = list.length + ' of ' + audit.all().length + ' entries';

    // Auditors and viewers get evidence access without any mutating control.
    var canExport = rbac.can(app.state.role, 'export_audit');
    util.$$('.audit-export').forEach(function (b) {
      b.disabled = !canExport;
      b.title = canExport ? '' : rbac.denial(app.state.role, 'export_audit');
    });
  }

  function verify(announce) {
    var v = audit.verify();
    var el = util.$('#chainStatus');
    if (v.ok) {
      el.className = 'chain-status ok';
      el.textContent = '✔ INTACT — ' + v.count + ' entries verified, hash chain unbroken.';
    } else {
      el.className = 'chain-status bad';
      el.textContent = '✕ TAMPERING DETECTED at entry #' + v.seq + ' — ' + v.reason;
    }
    if (announce) {
      app.log('AUDIT_CHAIN_VERIFIED', {
        object: 'audit-log', tier: 'n/a',
        inputs: { entries: audit.all().length },
        outputs: v.ok ? { result: 'INTACT' } : { result: 'TAMPERED', first_bad_seq: v.seq },
        justification: 'Chain verification run by ' + app.actor() + '.',
        lineage: 'audit-store -> verifier'
      });
      render();
      // Re-evaluate after the verification entry is itself appended.
      var again = audit.verify();
      if (!again.ok) {
        el.className = 'chain-status bad';
        el.textContent = '✕ TAMPERING DETECTED at entry #' + again.seq + ' — ' + again.reason;
      }
    }
  }

  function init() {
    ['#auditQ', '#auditActor', '#auditAction', '#auditTier'].forEach(function (s) {
      util.$(s).addEventListener('input', render);
      util.$(s).addEventListener('change', render);
    });

    util.$('#auditBody').addEventListener('click', function (ev) {
      var tr = ev.target.closest('.arow');
      if (!tr) return;
      var seq = Number(tr.dataset.seq);
      expanded[seq] = !expanded[seq];
      render();
    });

    util.$('#verifyChain').addEventListener('click', function () { verify(true); });

    util.$('#tamperSim').addEventListener('click', function () {
      var seq = audit.tamper();
      if (!seq) return;
      app.save();
      app.toast('Entry #' + seq + ' was altered directly in storage, bypassing Cortex. Now re-run "Verify chain".');
      render();
      var el = util.$('#chainStatus');
      el.className = 'chain-status warn';
      el.textContent = 'Entry #' + seq + ' altered out-of-band. Click "Verify chain" to see detection.';
    });

    util.$('#exportCSV').addEventListener('click', function () {
      if (!rbac.can(app.state.role, 'export_audit')) return app.deny('export_audit', 'audit-log');
      var list = rows();
      audit.exportCSV(list);
      app.log('AUDIT_EXPORTED', {
        object: 'audit-log', tier: 'n/a',
        inputs: { format: 'CSV', filters: filters() },
        outputs: { rows: list.length },
        justification: 'Compliance export by ' + app.actor() + '.',
        lineage: 'audit-store -> export'
      });
      render();
    });

    util.$('#exportJSON').addEventListener('click', function () {
      if (!rbac.can(app.state.role, 'export_audit')) return app.deny('export_audit', 'audit-log');
      var list = rows();
      audit.exportJSON(list);
      app.log('AUDIT_EXPORTED', {
        object: 'audit-log', tier: 'n/a',
        inputs: { format: 'JSON', filters: filters() },
        outputs: { rows: list.length },
        justification: 'Compliance export by ' + app.actor() + '.',
        lineage: 'audit-store -> export'
      });
      render();
    });

    app.onRender(function () { render(); verify(false); });
  }

  return { init: init };
})();
