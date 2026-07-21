/* Cortex demo — ops/risk queue with human-in-the-loop approvals. Team Cloud 9. */
window.CORTEX = window.CORTEX || {};

CORTEX.queue = (function () {
  'use strict';
  var util = CORTEX.util, rbac = CORTEX.rbac, app = CORTEX.app, redact = CORTEX.redact;
  var esc = util.esc;

  var STATUS = {
    pending: { label: 'Pending approval', cls: 'st-pending' },
    awaiting_second: { label: 'Awaiting 2nd approval', cls: 'st-second' },
    executed: { label: 'Executed', cls: 'st-exec' },
    auto_executed: { label: 'Auto-executed (LOW tier)', cls: 'st-auto' },
    rejected: { label: 'Rejected', cls: 'st-rejected' },
    escalated: { label: 'Escalated', cls: 'st-escalated' },
    rolled_back: { label: 'Rolled back', cls: 'st-rollback' }
  };

  var openWhy = {};   // itemId -> bool
  var openForm = {};  // itemId -> 'reject' | 'escalate' | null

  function find(id) {
    var items = app.state.items;
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }

  /* ------------------------------------------------------------------ actions */

  function approve(item) {
    var high = item.tier === 'HIGH';
    var cap = high ? (item.status === 'awaiting_second' ? 'second_approval' : 'approve_high') : 'approve_medium';
    if (!rbac.can(app.state.role, cap)) return app.deny(cap, item.id, 'Item ' + item.id + ' remains pending.');

    var me = app.actor();
    item.approvals = item.approvals || [];

    if (item.status === 'awaiting_second') {
      // Dual control: the second signature must come from a different person.
      if (item.approvals.some(function (a) { return a.actor === me; })) {
        app.log('DUAL_CONTROL_BLOCKED', {
          object: item.id, tier: item.tier,
          inputs: { first_approver: item.approvals[0].actor, attempted_by: me },
          outputs: { executed: false },
          justification: 'Dual control requires two distinct approvers. Self-countersignature refused.',
          lineage: 'policy-engine -> ops-queue'
        });
        app.toast('Dual control: the second approval must come from a different person. Logged.');
        return app.render();
      }
      item.approvals.push({ actor: me, role: rbac.role(app.state.role).name, ts: Date.now() });
      item.status = 'executed';
      item.executedAt = Date.now();
      app.log('APPROVED_AND_EXECUTED', {
        object: item.id, tier: item.tier, inputs: item.inputs, outputs: item.outputs,
        justification: 'Dual control satisfied: ' + item.approvals.map(function (a) { return a.actor; }).join(' + '),
        lineage: item.lineage.join(' -> ')
      });
      app.toast(item.id + ' executed after dual-control approval.');
    } else if (high) {
      item.approvals.push({ actor: me, role: rbac.role(app.state.role).name, ts: Date.now() });
      item.status = 'awaiting_second';
      app.log('FIRST_APPROVAL', {
        object: item.id, tier: item.tier, inputs: item.inputs,
        outputs: { executed: false, awaiting: 'second approver' },
        justification: 'HIGH tier requires two distinct approvers before execution.',
        lineage: item.lineage.join(' -> ')
      });
      app.toast(item.id + ' holds at "Awaiting 2nd approval" — HIGH tier is never executed on one signature.');
    } else {
      item.approvals.push({ actor: me, role: rbac.role(app.state.role).name, ts: Date.now() });
      item.status = 'executed';
      item.executedAt = Date.now();
      app.log('APPROVED_AND_EXECUTED', {
        object: item.id, tier: item.tier, inputs: item.inputs, outputs: item.outputs,
        justification: 'Approved by ' + me,
        lineage: item.lineage.join(' -> ')
      });
      app.toast(item.id + ' approved and executed.');
    }
    app.save();
    app.render();
  }

  function decide(item, kind, reason) {
    if (!rbac.can(app.state.role, 'reject')) return app.deny('reject', item.id);
    item.status = kind === 'reject' ? 'rejected' : 'escalated';
    item.decisionReason = reason;
    app.log(kind === 'reject' ? 'REJECTED' : 'ESCALATED', {
      object: item.id, tier: item.tier, inputs: item.inputs,
      outputs: { executed: false, status: item.status },
      justification: reason,
      lineage: item.lineage.join(' -> ')
    });
    openForm[item.id] = null;
    app.toast(item.id + ' ' + item.status + '.');
    app.save();
    app.render();
  }

  function rollback(item) {
    if (!rbac.can(app.state.role, 'rollback')) return app.deny('rollback', item.id);
    var priorStatus = item.status;
    item.status = 'rolled_back';
    item.rolledBackAt = Date.now();
    app.log('ROLLED_BACK', {
      object: item.id, tier: item.tier,
      inputs: { reverting: item.outputs, prior_status: priorStatus },
      outputs: { restored_state: 'pre-execution', side_effects_reversed: true },
      justification: 'One-click rollback by ' + app.actor() + '. Paired with the original execution entry.',
      lineage: item.lineage.join(' -> ') + ' -> rollback'
    });
    app.toast(item.id + ' rolled back. Prior state restored.');
    app.save();
    app.render();
  }

  /* ------------------------------------------------------------------ render */

  function confidenceBar(item) {
    var pct = Math.round(item.confidence * 100);
    return '<div class="conf"><div class="conf-bar"><i style="width:' + pct + '%" class="' +
      (item.confidence >= 0.9 ? 'hi' : item.confidence >= 0.8 ? 'mid' : 'lo') + '"></i></div>' +
      '<span class="conf-num">' + (item.confidence).toFixed(2) + '</span>' +
      '<span class="muted">' + esc(item.model) + '</span></div>';
  }

  function whyPanel(item) {
    var max = Math.max.apply(null, item.why.signals.map(function (s) { return s.weight; }));
    var bars = item.why.signals.map(function (s) {
      return '<div class="sig"><span class="sig-label">' + esc(s.label) + '</span>' +
        '<span class="sig-bar"><i style="width:' + Math.round((s.weight / max) * 100) + '%"></i></span>' +
        '<span class="sig-w">' + s.weight.toFixed(2) + '</span></div>';
    }).join('');
    return '<div class="why">' +
      '<div class="why-head">Why this decision</div>' + bars +
      '<div class="why-rule"><b>Policy that fired:</b> <code>' + esc(item.why.rule) + '</code></div>' +
      '<div class="why-counter"><b>What would change this:</b> ' + esc(item.why.counter) + '</div>' +
      '<div class="why-lineage"><b>Lineage:</b> ' + item.lineage.map(function (l) {
        return '<span class="chip">' + esc(l) + '</span>';
      }).join('<span class="arrow">→</span>') + '</div>' +
      '<div class="why-io"><b>Inputs:</b> <code>' + esc(redact.redactText(util.kv(item.inputs)).text) + '</code><br>' +
      '<b>Proposed outputs:</b> <code>' + esc(redact.redactText(util.kv(item.outputs)).text) + '</code>' +
      '<div class="muted small">PHI in inputs/outputs is redacted in this view by default.</div></div>' +
      '</div>';
  }

  function actionsFor(item) {
    var role = app.state.role;
    var out = [];
    var canApproveNow, cap;

    if (item.status === 'pending' || item.status === 'awaiting_second') {
      if (item.tier === 'HIGH') {
        cap = item.status === 'awaiting_second' ? 'second_approval' : 'approve_high';
      } else {
        cap = 'approve_medium';
      }
      canApproveNow = rbac.can(role, cap);
      var label = item.status === 'awaiting_second' ? 'Counter-sign (2nd approval)'
        : item.tier === 'HIGH' ? 'Approve (1 of 2)' : 'Approve';
      out.push('<button class="btn primary" data-act="approve" data-id="' + item.id + '"' +
        (canApproveNow ? '' : ' disabled title="' + esc(rbac.denial(role, cap)) + '"') + '>' + label + '</button>');

      var canReject = rbac.can(role, 'reject');
      out.push('<button class="btn" data-act="reject" data-id="' + item.id + '"' +
        (canReject ? '' : ' disabled title="' + esc(rbac.denial(role, 'reject')) + '"') + '>Reject</button>');
      out.push('<button class="btn" data-act="escalate" data-id="' + item.id + '"' +
        (canReject ? '' : ' disabled title="' + esc(rbac.denial(role, 'reject')) + '"') + '>Escalate</button>');
      if (!canApproveNow) {
        out.push('<span class="deny-note">' + esc(rbac.denial(role, cap)) + '</span>');
      }
    } else if (item.status === 'executed' || item.status === 'auto_executed') {
      var canRoll = rbac.can(role, 'rollback');
      out.push('<button class="btn warn" data-act="rollback" data-id="' + item.id + '"' +
        (canRoll ? '' : ' disabled title="' + esc(rbac.denial(role, 'rollback')) + '"') + '>↺ Roll back</button>');
      if (!canRoll) out.push('<span class="deny-note">' + esc(rbac.denial(role, 'rollback')) + '</span>');
    } else {
      out.push('<span class="muted small">No further action available in state "' +
        esc(STATUS[item.status].label) + '".</span>');
    }
    return out.join('');
  }

  function card(item) {
    var st = STATUS[item.status];
    var appr = (item.approvals || []).map(function (a) {
      return '<span class="chip sig-chip">✔ ' + esc(a.actor) + ' (' + esc(a.role) + ')</span>';
    }).join('');
    var form = '';
    if (openForm[item.id]) {
      var kind = openForm[item.id];
      form = '<div class="inline-form"><label>Reason (required, min 15 chars)</label>' +
        '<textarea data-reason="' + item.id + '" rows="2" placeholder="Why are you ' +
        (kind === 'reject' ? 'rejecting' : 'escalating') + ' ' + item.id + '?"></textarea>' +
        '<div class="row"><button class="btn primary" data-act="confirm-' + kind + '" data-id="' + item.id + '">Confirm ' + kind + '</button>' +
        '<button class="btn" data-act="cancel-form" data-id="' + item.id + '">Cancel</button>' +
        '<span class="muted small">Recorded verbatim in the audit trail.</span></div></div>';
    }

    return '<article class="card tier-' + item.tier.toLowerCase() + '">' +
      '<header class="card-head">' +
        '<div><span class="oid">' + esc(item.id) + '</span> <h3>' + esc(item.title) + '</h3></div>' +
        '<div class="badges">' +
          '<span class="badge tier-badge t-' + item.tier.toLowerCase() + '">' + esc(item.tier) + '</span>' +
          (item.phi ? '<span class="badge phi">PHI</span>' : '') +
          (item.impact.safety ? '<span class="badge safety">PATIENT SAFETY</span>' : '') +
          '<span class="badge status ' + st.cls + '">' + esc(st.label) + '</span>' +
        '</div>' +
      '</header>' +
      '<p class="summary">' + esc(item.summary) + '</p>' +
      confidenceBar(item) +
      '<div class="impact">' +
        '<div><span>Records</span><b>' + item.impact.records.toLocaleString('en-US') + '</b></div>' +
        '<div><span>Financial</span><b>' + (item.impact.dollars ? util.money(item.impact.dollars) : '—') + '</b></div>' +
        '<div><span>Reversible</span><b class="' + (item.impact.reversible ? 'ok' : 'bad') + '">' +
          (item.impact.reversible ? 'Yes' : 'No') + '</b></div>' +
        '<div><span>Dept</span><b>' + esc(item.dept) + '</b></div>' +
      '</div>' +
      (appr ? '<div class="approvals">' + appr + '</div>' : '') +
      (item.decisionReason ? '<div class="decision">Reason on file: “' + esc(item.decisionReason) + '”</div>' : '') +
      '<button class="link-btn" data-act="why" data-id="' + item.id + '">' +
        (openWhy[item.id] ? '▾ Hide the why' : '▸ Why? confidence, signals, lineage') + '</button>' +
      (openWhy[item.id] ? whyPanel(item) : '') +
      '<footer class="card-actions">' + actionsFor(item) + form + '</footer>' +
      '</article>';
  }

  function render() {
    var host = util.$('#queueList');
    if (!host) return;
    var items = app.state.items;

    var counts = { pending: 0, awaiting_second: 0, executed: 0, other: 0 };
    items.forEach(function (i) {
      if (i.status === 'pending') counts.pending++;
      else if (i.status === 'awaiting_second') counts.awaiting_second++;
      else if (i.status === 'executed' || i.status === 'auto_executed') counts.executed++;
      else counts.other++;
    });
    util.$('#queueStats').innerHTML =
      '<span><b>' + counts.pending + '</b> pending human approval</span>' +
      '<span><b>' + counts.awaiting_second + '</b> awaiting dual control</span>' +
      '<span><b>' + counts.executed + '</b> executed</span>' +
      '<span><b>' + counts.other + '</b> rejected / escalated / rolled back</span>';

    host.innerHTML = items.map(card).join('');
  }

  function onClick(ev) {
    var b = ev.target.closest('[data-act]');
    if (!b) return;
    var item = find(b.dataset.id);
    if (!item) return;
    var act = b.dataset.act;

    if (act === 'why') { openWhy[item.id] = !openWhy[item.id]; return app.render(); }
    if (act === 'approve') return approve(item);
    if (act === 'rollback') return rollback(item);
    if (act === 'reject' || act === 'escalate') {
      if (!rbac.can(app.state.role, 'reject')) return app.deny('reject', item.id);
      openForm[item.id] = act; return app.render();
    }
    if (act === 'cancel-form') { openForm[item.id] = null; return app.render(); }
    if (act === 'confirm-reject' || act === 'confirm-escalate') {
      var ta = util.$('[data-reason="' + item.id + '"]');
      var reason = (ta && ta.value || '').trim();
      if (reason.length < 15) {
        app.toast('A reason of at least 15 characters is required — it goes into the audit record.');
        if (ta) ta.focus();
        return;
      }
      return decide(item, act === 'confirm-reject' ? 'reject' : 'escalate', reason);
    }
  }

  function init() {
    util.$('#queueList').addEventListener('click', onClick);
    app.onRender(render);
  }

  return { init: init };
})();
