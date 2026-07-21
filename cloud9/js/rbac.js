/* Cortex demo — role-based access control. Least privilege by default. Team Cloud 9. */
window.CORTEX = window.CORTEX || {};

CORTEX.rbac = (function () {
  'use strict';

  // Every capability the UI gates on. A role holds exactly what it needs, nothing more.
  var CAPABILITIES = [
    { key: 'view_queue', label: 'View ops queue' },
    { key: 'view_phi_masked', label: 'View records (redacted)' },
    { key: 'reveal_phi', label: 'Reveal PHI (justified)' },
    { key: 'approve_medium', label: 'Approve MEDIUM risk' },
    { key: 'approve_high', label: 'Approve HIGH risk (1st of 2)' },
    { key: 'second_approval', label: 'Give 2nd approval (dual control)' },
    { key: 'reject', label: 'Reject / escalate' },
    { key: 'rollback', label: 'Roll back executed action' },
    { key: 'view_audit', label: 'View audit log' },
    { key: 'export_audit', label: 'Export audit log' },
    { key: 'export_evidence', label: 'Export evidence pack' }
  ];

  var ROLES = [
    {
      key: 'viewer',
      name: 'Viewer',
      actor: 'j.lindqvist@stcatherines.org',
      title: 'Ward Coordinator',
      note: 'Read-only. Cannot approve anything and cannot unmask PHI.',
      caps: ['view_queue', 'view_phi_masked', 'view_audit']
    },
    {
      key: 'analyst',
      name: 'Ops Analyst',
      actor: 'm.tran@stcatherines.org',
      title: 'Operations Analyst',
      note: 'Triages the queue and escalates. Cannot approve or unmask.',
      caps: ['view_queue', 'view_phi_masked', 'reject', 'view_audit', 'export_audit']
    },
    {
      key: 'approver',
      name: 'Approver',
      actor: 'p.nakamura@stcatherines.org',
      title: 'Clinical Ops Manager',
      note: 'Approves MEDIUM outright; HIGH only as the first of two approvals.',
      caps: ['view_queue', 'view_phi_masked', 'reveal_phi', 'approve_medium', 'approve_high',
             'reject', 'rollback', 'view_audit', 'export_audit']
    },
    {
      key: 'auditor',
      name: 'Auditor',
      actor: 'k.duval@stcatherines.org',
      title: 'Compliance Auditor',
      note: 'Evidence access only. Deliberately holds no approval rights.',
      caps: ['view_queue', 'view_phi_masked', 'view_audit', 'export_audit']
    },
    {
      key: 'ciso',
      name: 'CISO',
      actor: 'a.osei@stcatherines.org',
      title: 'Chief Information Security Officer',
      note: 'Dual-control counter-signature and evidence-pack export.',
      caps: ['view_queue', 'view_phi_masked', 'reveal_phi', 'approve_medium', 'second_approval',
             'reject', 'rollback', 'view_audit', 'export_audit', 'export_evidence']
    }
  ];

  function role(key) {
    for (var i = 0; i < ROLES.length; i++) if (ROLES[i].key === key) return ROLES[i];
    return ROLES[0];
  }

  function can(roleKey, cap) {
    return role(roleKey).caps.indexOf(cap) !== -1;
  }

  // Human-readable reason a control is disabled — the review team asked to see *why*
  // an action is unavailable, not just that it is greyed out.
  function denial(roleKey, cap) {
    var r = role(roleKey);
    var c = null;
    for (var i = 0; i < CAPABILITIES.length; i++) if (CAPABILITIES[i].key === cap) c = CAPABILITIES[i];
    return 'Denied: role "' + r.name + '" does not hold capability "' + (c ? c.label : cap) + '".';
  }

  return { CAPABILITIES: CAPABILITIES, ROLES: ROLES, role: role, can: can, denial: denial };
})();
