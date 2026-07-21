/* Cortex demo — vendor-risk evidence. Claims with artifacts attached. Team Cloud 9. */
window.CORTEX = window.CORTEX || {};

CORTEX.evidence = (function () {
  'use strict';
  var util = CORTEX.util, rbac = CORTEX.rbac, app = CORTEX.app, audit = CORTEX.audit;
  var esc = util.esc;

  var open = {};

  var CONTROLS = [
    {
      id: 'baa', control: 'Business Associate Agreement', status: 'Executed',
      claim: 'Cortex signs a BAA before any PHI is transmitted. Sandbox tenants carry a no-PHI restriction until it is countersigned.',
      artifact: 'BAA §3.2 — Permitted Uses\n  Business Associate shall not use or disclose Protected Health Information other than as\n  permitted by this Agreement or as Required by Law.\n\nBAA §4.1 — Safeguards\n  Business Associate shall implement administrative, physical, and technical safeguards that\n  reasonably and appropriately protect the confidentiality, integrity, and availability of\n  Electronic PHI, consistent with 45 CFR §164.308, §164.310, and §164.312.\n\nBAA §6.3 — Breach Notification\n  Notification to Covered Entity without unreasonable delay and in no case later than\n  15 calendar days after Discovery.\n\nBAA §9.1 — Return or Destruction\n  Upon termination, all PHI returned or destroyed within 30 days; certificate of destruction\n  provided on request.'
    },
    {
      id: 'crypto', control: 'Encryption in transit and at rest', status: 'Enforced',
      claim: 'TLS 1.3 in transit; AES-256-GCM at rest with per-tenant keys in a customer-visible KMS.',
      artifact: 'transport:\n  min_version: TLS1.3\n  ciphers: [TLS_AES_256_GCM_SHA384, TLS_CHACHA20_POLY1305_SHA256]\n  hsts: max-age=63072000; includeSubDomains; preload\n  mtls_required_for: [ehr-connector, lis-connector]\n\nat_rest:\n  algorithm: AES-256-GCM\n  key_hierarchy: tenant_dek -> tenant_kek -> hsm_root\n  key_rotation_days: 90\n  customer_managed_keys: available (BYOK via KMS grant)\n\nbackups:\n  encrypted: true\n  retention_days: 35\n  restore_tested: quarterly'
    },
    {
      id: 'lp', control: 'Least privilege / RBAC', status: 'Enforced', matrix: true,
      claim: 'Capabilities are granted per role and denied by default. The matrix below is read live from the running application, not typed into a slide.',
      artifact: null
    },
    {
      id: 'seg', control: 'Tenant data segregation', status: 'Enforced',
      claim: 'Separate schema, separate encryption key, and a tenant guard on every query path. No shared-table row-level-only isolation.',
      artifact: 'tenant: st-catherines\n  database_schema: tnt_stcath          (dedicated, not row-filtered)\n  object_store_prefix: s3://cortex-phi/tnt_stcath/\n  encryption_key: kms://cortex/tnt_stcath  (distinct DEK; no cross-tenant grant)\n  compute: pooled, tenant id asserted from signed session, enforced at the data-access layer\n  egress_allowlist: [stcath-vpn, stcath-sftp]\n\nenforcement:\n  query_guard: every statement requires tenant_id; unqualified queries are rejected at the driver\n  test: nightly cross-tenant read attempt -> expected DENY -> alert on any success'
    },
    {
      id: 'train', control: 'No training on customer data', status: 'Contractual + technical',
      claim: 'Customer PHI is never used to train, fine-tune, or evaluate models. Models are versioned artifacts shipped into the tenant, not learners that update from your data.',
      artifact: 'data_flow:\n  ingest -> de-identify (optional) -> inference -> audit -> tenant store\n  inference: stateless; no gradient updates; no prompt/response retention beyond audit\n\nprohibitions:\n  training_on_customer_data: false      (contract §7.4, technically enforced)\n  human_review_of_tenant_data: false    (no vendor employee access without a break-glass grant)\n  third_party_model_sharing: false\n\nretention:\n  inference_inputs: not retained (audit metadata only)\n  audit_records: tenant-controlled, default 7 years\n  deletion_sla_days: 30 from written request, certificate issued'
    },
    {
      id: 'hitl', control: 'Human-in-the-loop / automation ceiling', status: 'Enforced',
      claim: 'Automation cannot outrun oversight: irreversible, PHI-touching, or patient-safety actions are blocked from auto-execution regardless of model confidence.',
      artifact: 'policy: automation-ceiling v2026.07.1\n  LOW      -> auto-execute permitted (reversible only, confidence >= 0.90)\n  MEDIUM   -> single human approval required\n  HIGH     -> dual control: two distinct approvers, no self-countersignature\n  ANY tier with patient_safety = true  -> never auto-executed\n  ANY irreversible action with confidence < 0.85 -> blocked, human performs the action\n\nescape hatch:\n  one-click rollback on every executed action; rollback writes a paired audit entry\n  kill switch: tenant admin can suspend all automation in one action'
    },
    {
      id: 'phi', control: 'PHI minimization in the UI', status: 'Enforced',
      claim: 'PHI is redacted by default in every view. Reveal is per-field, requires a reason code plus a written justification, is time-boxed to 60 seconds, and is logged.',
      artifact: 'default_state: redacted\ndetectors: NAME, MRN, DOB, SSN, PHONE, EMAIL, ADDRESS, INSURANCE_ID\nreveal:\n  requires: [capability: reveal_phi, reason_code, justification >= 20 chars, IdP step-up]\n  scope: single field\n  ttl_seconds: 60 (auto re-redaction, logged)\n  logged: actor, field, reason code, justification verbatim, timestamp\nexports: redacted unless an explicit unmasked-export approval is on file'
    },
    {
      id: 'idp', control: 'Identity, step-up authentication, session', status: 'Federated',
      claim: 'Cortex holds no passwords. Authentication and MFA step-up are asserted by your IdP; Cortex consumes the assertion and records it.',
      artifact: 'federation:\n  protocols: [SAML 2.0, OIDC]\n  idp: customer-operated (Entra ID / Okta / Ping)\n  local_passwords: none stored\n  scim_provisioning: supported (deprovision propagates in < 5 min)\n\nstep_up:\n  trigger: PHI reveal, evidence export, dual-control countersignature\n  mechanism: AMR/ACR claim required on the assertion — Cortex verifies, your IdP enforces\n  note: in this demo build the step-up is represented by the justification gate; the\n        production gate additionally requires a fresh MFA claim from your IdP'
    },
    {
      id: 'audit', control: 'Tamper-evident audit trail', status: 'Enforced',
      claim: 'Every action and model decision is appended to a hash-chained log with inputs, outputs, and lineage. Exportable as CSV or JSON. Verification is in the product, not a promise.',
      artifact: 'record:\n  seq, timestamp_utc, actor, role, action, object, risk_tier,\n  inputs, outputs, justification, lineage, prev_hash, hash\n\nintegrity:\n  chain: hash(entry || prev_hash); any edit breaks verification at that row\n  production: entries additionally written to WORM storage with a daily anchored digest\n  verification: available to the customer on demand (see the Audit Log tab)\n\nexport:\n  formats: [CSV, JSON]\n  scope: the filtered view, with the verification result embedded in the JSON payload'
    },
    {
      id: 'ir', control: 'Incident response and breach notification', status: '15-day SLA',
      claim: '24/7 on-call security; customer notification within 15 days of discovery, materially faster for confirmed PHI exposure.',
      artifact: 'severity_1 (confirmed PHI exposure):\n  acknowledge: 30 minutes\n  customer notification: 24 hours (preliminary), 15 days (formal, per BAA §6.3)\n  forensics package: 10 business days\n\nseverity_2 (suspected exposure, no confirmation):\n  acknowledge: 2 hours\n  status cadence: every 12 hours until closed\n\nexercises:\n  tabletop: semi-annual, customer-observable\n  postmortems: blameless, shared with affected customers'
    },
    {
      id: 'attest', control: 'Third-party attestation and testing', status: 'SOC 2 Type II · HITRUST r2 in progress',
      claim: 'Independent attestation and annual third-party penetration testing, with reports available under NDA.',
      artifact: 'soc2_type_ii:\n  period: 2025-07-01 .. 2026-06-30\n  trust_criteria: [Security, Availability, Confidentiality]\n  exceptions: none material\n\nhitrust:\n  status: r2 assessment in progress, target Q4 2026\n\npenetration_testing:\n  cadence: annual + on major release\n  last: 2026-04, external firm\n  findings: 0 critical, 2 high (both remediated, retest passed 2026-05)\n\nvulnerability_management:\n  critical patch SLA: 7 days\n  dependency scanning: per-build'
    },
    {
      id: 'sub', control: 'Subprocessors', status: 'Disclosed · 30-day notice',
      claim: 'A short, disclosed subprocessor list. 30 days notice before any addition, with a right to object.',
      artifact: 'cloud_hosting: AWS (us-east-1, us-west-2) — BAA on file\nobservability: self-hosted, no PHI egress\nemail_notifications: metadata only, no PHI in message bodies\nmodel_inference: in-tenant VPC, no third-party model API receives PHI\n\nchange_policy:\n  notice_days: 30\n  right_to_object: yes; unresolved objection permits termination without penalty'
    }
  ];

  function matrixHTML() {
    var caps = rbac.CAPABILITIES, roles = rbac.ROLES;
    return '<div class="table-scroll"><table class="matrix"><thead><tr><th>Capability</th>' +
      roles.map(function (r) { return '<th>' + esc(r.name) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      caps.map(function (c) {
        return '<tr><td>' + esc(c.label) + '</td>' + roles.map(function (r) {
          var has = rbac.can(r.key, c.key);
          return '<td class="' + (has ? 'yes' : 'no') + '">' + (has ? '✔' : '✕') + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="muted small">Rendered live from <code>cloud9/js/rbac.js</code> — the same policy the UI enforces.</div>';
  }

  function row(c) {
    var isOpen = open[c.id];
    return '<article class="ev-row' + (isOpen ? ' open' : '') + '">' +
      '<button class="ev-head" data-ev="' + esc(c.id) + '">' +
        '<span class="ev-name">' + esc(c.control) + '</span>' +
        '<span class="ev-status">' + esc(c.status) + '</span>' +
        '<span class="ev-toggle">' + (isOpen ? '▾' : '▸') + ' evidence</span>' +
      '</button>' +
      '<p class="ev-claim">' + esc(c.claim) + '</p>' +
      (isOpen ? '<div class="ev-artifact">' +
        (c.matrix ? matrixHTML() : '<pre>' + esc(c.artifact) + '</pre>') + '</div>' : '') +
      '</article>';
  }

  function render() {
    var host = util.$('#evidenceList');
    if (!host) return;
    host.innerHTML = CONTROLS.map(row).join('');
    var can = rbac.can(app.state.role, 'export_evidence');
    var b = util.$('#exportEvidence');
    b.disabled = !can;
    b.title = can ? '' : rbac.denial(app.state.role, 'export_evidence');
    util.$('#evidenceNote').textContent = can
      ? 'Your role may export the full evidence pack.'
      : rbac.denial(app.state.role, 'export_evidence');
  }

  function exportPack() {
    if (!rbac.can(app.state.role, 'export_evidence')) return app.deny('export_evidence', 'evidence-pack');
    var pack = {
      generated_at: new Date().toISOString(),
      vendor: 'Cortex — Team Cloud9',
      customer: "St. Catherine's Health",
      generated_by: app.actor(),
      controls: CONTROLS.map(function (c) {
        return { control: c.control, status: c.status, claim: c.claim,
                 artifact: c.matrix ? 'see permission_matrix' : c.artifact };
      }),
      permission_matrix: rbac.ROLES.map(function (r) {
        return { role: r.name, actor: r.actor, capabilities: r.caps };
      }),
      audit_chain_verification: audit.verify(),
      audit_entries: audit.flatten(audit.all())
    };
    util.download('cortex-evidence-pack-' + Date.now() + '.json', JSON.stringify(pack, null, 2), 'application/json');
    app.log('EVIDENCE_PACK_EXPORTED', {
      object: 'evidence-pack', tier: 'n/a',
      inputs: { controls: CONTROLS.length, audit_entries: audit.all().length },
      outputs: { format: 'JSON', chain: audit.verify().ok ? 'INTACT' : 'TAMPERED' },
      justification: 'Vendor-risk evidence pack exported by ' + app.actor() + '.',
      lineage: 'control-register + rbac-policy + audit-store -> export'
    });
    app.toast('Evidence pack exported, including the live permission matrix and the verified audit chain.');
    app.render();
  }

  function init() {
    util.$('#evidenceList').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-ev]');
      if (!b) return;
      open[b.dataset.ev] = !open[b.dataset.ev];
      render();
    });
    util.$('#exportEvidence').addEventListener('click', exportPack);
    app.onRender(render);
  }

  return { init: init };
})();
