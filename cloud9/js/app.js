/* Cortex demo — state, role switching, routing. Team Cloud 9. */
window.CORTEX = window.CORTEX || {};

CORTEX.app = (function () {
  'use strict';
  var util = CORTEX.util, rbac = CORTEX.rbac, audit = CORTEX.audit, data = CORTEX.data;

  var KEY = 'cortex.cloud9.v1';
  var state = { role: 'approver', items: [], tab: 'queue' };
  var listeners = [];

  /* ---------------------------------------------------------------- persistence */

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        role: state.role, tab: state.tab, items: state.items, audit: audit.all()
      }));
    } catch (e) { /* private browsing — demo still works in-memory */ }
  }

  function seed() {
    state.items = data.clone(data.items);
    audit.reset();
    var t0 = Date.now() - 1000 * 60 * 90;
    audit.append({
      ts: t0, actor: 'system@cortex', role: 'service', action: 'POLICY_LOADED',
      object: 'tenant/st-catherines', tier: 'n/a',
      inputs: { policy: 'phi-default-redact', version: '2026.07.1' },
      outputs: { detectors: CORTEX.redact.DETECTORS.length, dual_control: 'HIGH tier' },
      lineage: 'policy-store -> cortex-runtime'
    });
    // The two LOW-tier items that ran inside policy get their execution recorded.
    state.items.filter(function (i) { return i.status === 'auto_executed'; })
      .forEach(function (item, n) {
        audit.append({
          ts: t0 + (n + 1) * 1000 * 60 * 12,
          actor: 'cortex-agent@cortex', role: 'service', action: 'AUTO_EXECUTED',
          object: item.id, tier: item.tier, inputs: item.inputs, outputs: item.outputs,
          justification: item.why.rule,
          lineage: item.lineage.join(' -> ')
        });
      });
    audit.append({
      ts: t0 + 1000 * 60 * 40, actor: 'cortex-agent@cortex', role: 'service',
      action: 'BLOCKED_PENDING_APPROVAL', object: 'OPS-4472,OPS-4473,OPS-4476,OPS-4478',
      tier: 'HIGH',
      inputs: { reason: 'tier=HIGH' },
      outputs: { queued_for_human: 4, auto_executed: 0 },
      justification: 'Automation is not permitted to execute HIGH-tier or patient-safety actions.',
      lineage: 'policy-engine -> ops-queue'
    });
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (raw) {
      try {
        var s = JSON.parse(raw);
        if (s && s.items && s.items.length && s.audit) {
          state.role = s.role || 'approver';
          state.tab = s.tab || 'queue';
          state.items = s.items;
          audit.load(s.audit);
          return;
        }
      } catch (e) { /* fall through to a clean seed */ }
    }
    seed();
  }

  function reset() {
    seed();
    state.tab = 'queue';
    save();
    render();
  }

  /* ---------------------------------------------------------------- audit helper */

  function actor() { return rbac.role(state.role).actor; }

  function log(action, opts) {
    opts = opts || {};
    var e = audit.append({
      actor: opts.actor || actor(),
      role: opts.role || rbac.role(state.role).name,
      action: action,
      object: opts.object,
      tier: opts.tier,
      inputs: opts.inputs,
      outputs: opts.outputs,
      justification: opts.justification,
      lineage: opts.lineage
    });
    save();
    return e;
  }

  // Every refused action is still an audited event — denials are evidence too.
  function deny(cap, object, detail) {
    log('ACCESS_DENIED', {
      object: object || 'ui',
      tier: 'n/a',
      inputs: { requested_capability: cap, role: rbac.role(state.role).name },
      outputs: { permitted: false },
      justification: rbac.denial(state.role, cap) + (detail ? ' ' + detail : ''),
      lineage: 'rbac-policy -> ui'
    });
    toast(rbac.denial(state.role, cap) + ' Logged to the audit trail.');
    render();
  }

  /* ---------------------------------------------------------------- ui plumbing */

  var TABS = [
    { key: 'queue', label: 'Ops Queue' },
    { key: 'phi', label: 'PHI Controls' },
    { key: 'audit', label: 'Audit Log' },
    { key: 'forecast', label: 'Forecast' },
    { key: 'evidence', label: 'Evidence' }
  ];

  function toast(msg, kind) {
    var host = util.$('#toast');
    if (!host) return;
    host.className = 'toast show' + (kind ? ' ' + kind : '');
    host.textContent = msg;
    clearTimeout(host._t);
    host._t = setTimeout(function () { host.className = 'toast'; }, 4200);
  }

  function setRole(key) {
    var prev = rbac.role(state.role).name;
    state.role = key;
    log('ROLE_SWITCHED', {
      object: 'session',
      inputs: { from: prev, to: rbac.role(key).name },
      outputs: { capabilities: rbac.role(key).caps.length },
      justification: 'Demo role switch. In production this is an IdP assertion (SAML/OIDC), not a UI control.',
      lineage: 'idp -> session'
    });
    render();
  }

  function setTab(key) {
    state.tab = key;
    save();
    render();
  }

  function onRender(fn) { listeners.push(fn); }

  function renderChrome() {
    var r = rbac.role(state.role);
    var sel = util.$('#roleSelect');
    if (sel && sel.value !== state.role) sel.value = state.role;
    util.$('#roleActor').textContent = r.actor;
    util.$('#roleTitle').textContent = r.title;
    util.$('#roleNote').textContent = r.note;
    util.$('#roleCaps').innerHTML = rbac.CAPABILITIES.map(function (c) {
      var has = rbac.can(state.role, c.key);
      return '<span class="cap ' + (has ? 'on' : 'off') + '" title="' + util.esc(c.label) + '">' +
             (has ? '✔' : '✕') + ' ' + util.esc(c.label) + '</span>';
    }).join('');

    util.$$('#tabs .tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === state.tab);
    });
    util.$$('.panel').forEach(function (p) {
      p.hidden = p.dataset.panel !== state.tab;
    });
  }

  function render() {
    renderChrome();
    listeners.forEach(function (fn) {
      try { fn(state); } catch (e) { console.error('render failed', e); }
    });
  }

  function boot() {
    load();

    var sel = util.$('#roleSelect');
    sel.innerHTML = rbac.ROLES.map(function (r) {
      return '<option value="' + r.key + '">' + util.esc(r.name) + '</option>';
    }).join('');
    sel.value = state.role;
    sel.addEventListener('change', function () { setRole(sel.value); });

    util.$('#tabs').innerHTML = TABS.map(function (t) {
      return '<button class="tab" data-tab="' + t.key + '">' + util.esc(t.label) + '</button>';
    }).join('');
    util.$('#tabs').addEventListener('click', function (ev) {
      var b = ev.target.closest('.tab');
      if (b) setTab(b.dataset.tab);
    });

    util.$('#resetDemo').addEventListener('click', function () {
      if (confirm('Reset the demo? This clears all approvals and the audit trail.')) reset();
    });

    render();
  }

  return {
    state: state, save: save, reset: reset, log: log, deny: deny, actor: actor,
    setRole: setRole, setTab: setTab, onRender: onRender, render: render,
    toast: toast, boot: boot
  };
})();
