/* Cortex demo — seed data. Team Cloud 9. */
window.CORTEX = window.CORTEX || {};

CORTEX.data = (function () {
  'use strict';

  // Ops / risk queue seed. Every item carries the evidence the review team asked for:
  // confidence, impact, the "why", and lineage.
  var items = [
    {
      id: 'OPS-4471',
      title: 'Auto-reschedule 14 no-show follow-ups',
      summary: 'Cardiology follow-ups missed in the last 7 days have open slots within their clinical window.',
      dept: 'Cardiology',
      tier: 'LOW',
      phi: false,
      confidence: 0.96,
      model: 'cortex-sched-v2.4.1',
      impact: { records: 14, dollars: 4200, reversible: true, safety: false },
      why: {
        signals: [
          { label: 'Open slot inside clinical window', weight: 0.41 },
          { label: 'Patient historically accepts reschedule', weight: 0.27 },
          { label: 'Referring provider availability matches', weight: 0.18 },
          { label: 'No conflicting appointment', weight: 0.10 }
        ],
        rule: 'AUTO_EXECUTE if tier = LOW and confidence >= 0.90 and reversible = true',
        counter: 'A same-day cancellation by the referring provider, or any patient with an active care-plan hold, would drop this below threshold and route it to human approval.'
      },
      lineage: ['Epic Cadence (scheduling)', 'no-show normalizer v1.2', 'cortex-sched-v2.4.1', 'proposed: reschedule x14'],
      inputs: { source: 'Epic Cadence', window: '2026-07-14..2026-07-21', candidates: 21, eligible: 14 },
      outputs: { rescheduled: 14, notices_queued: 14, slots_consumed: 14 },
      status: 'auto_executed'
    },
    {
      id: 'OPS-4472',
      title: 'Release 3 lab results to the patient portal',
      summary: 'Results are past the 72h information-blocking hold and contain no critical flags.',
      dept: 'Laboratory',
      tier: 'HIGH',
      phi: true,
      confidence: 0.81,
      model: 'cortex-release-v1.9.0',
      impact: { records: 3, dollars: 0, reversible: false, safety: true },
      why: {
        signals: [
          { label: 'Past 72h regulatory hold', weight: 0.38 },
          { label: 'No critical / panic value present', weight: 0.31 },
          { label: 'Ordering provider signed off', weight: 0.22 },
          { label: 'Patient portal consent on file', weight: 0.09 }
        ],
        rule: 'BLOCK_AND_ESCALATE if patient_safety = true — dual control required regardless of confidence',
        counter: 'One result sits 0.2 mmol/L under the panic threshold. If the reference range is updated, or the ordering provider revokes sign-off, this becomes a clinician-only release.'
      },
      lineage: ['Beaker LIS', 'result classifier v3.0', 'cortex-release-v1.9.0', 'proposed: portal release x3'],
      inputs: { source: 'Beaker LIS', results: 3, holds_cleared: 3, panic_flags: 0 },
      outputs: { released: 3, patients_notified: 3 },
      status: 'pending'
    },
    {
      id: 'OPS-4473',
      title: 'Merge suspected duplicate patient record',
      summary: 'Two MRNs share DOB, surname, and insurance ID; demographics differ by one transposed digit.',
      dept: 'Health Information Mgmt',
      tier: 'HIGH',
      phi: true,
      confidence: 0.74,
      model: 'cortex-mpi-v4.2.0',
      impact: { records: 2, dollars: 0, reversible: false, safety: true },
      why: {
        signals: [
          { label: 'Exact DOB + surname match', weight: 0.35 },
          { label: 'Identical insurance member ID', weight: 0.29 },
          { label: 'Address edit distance = 1', weight: 0.16 },
          { label: 'Overlapping encounter history', weight: 0.11 }
        ],
        rule: 'BLOCK if action is irreversible and confidence < 0.85 — human merge required',
        counter: 'Confidence is below our irreversible-action floor of 0.85. A distinct first name and non-overlapping encounters would indicate twins, a known false-positive class in MPI matching.'
      },
      lineage: ['Master Patient Index', 'demographic normalizer v2.1', 'cortex-mpi-v4.2.0', 'proposed: merge 2 records'],
      inputs: { source: 'MPI', mrn_a: 'MRN 44-2910', mrn_b: 'MRN 44-2901', match_score: 0.74 },
      outputs: { merged_into: 'MRN 44-2910', records_relinked: 38 },
      status: 'pending'
    },
    {
      id: 'OPS-4474',
      title: 'Approve $12,400 sterile supply reorder',
      summary: 'Par level for sterile drape kits will breach in 4 days against forecast OR volume.',
      dept: 'Supply Chain',
      tier: 'MEDIUM',
      phi: false,
      confidence: 0.91,
      model: 'cortex-forecast-v3.1.2',
      impact: { records: 1, dollars: 12400, reversible: true, safety: false },
      why: {
        signals: [
          { label: 'Projected stockout in 4 days', weight: 0.44 },
          { label: 'OR schedule up 12% vs 4-week mean', weight: 0.26 },
          { label: 'Vendor lead time 6 days', weight: 0.21 }
        ],
        rule: 'REQUIRE_APPROVAL if dollars > $5,000',
        counter: 'Two elective blocks are provisional. If both release, projected demand falls under par and this reorder is unnecessary.'
      },
      lineage: ['Workday Supply', 'demand aggregator v1.8', 'cortex-forecast-v3.1.2', 'proposed: PO $12,400'],
      inputs: { source: 'Workday Supply', sku: 'DRP-4410', on_hand: 180, par: 260, lead_days: 6 },
      outputs: { po_number: 'PO-88213', units: 400, cost_usd: 12400 },
      status: 'pending'
    },
    {
      id: 'OPS-4475',
      title: 'Resubmit 27 denied claims with corrected modifier',
      summary: 'Denials share CARC 4; the modifier fix is deterministic and payer-approved.',
      dept: 'Revenue Cycle',
      tier: 'MEDIUM',
      phi: true,
      confidence: 0.93,
      model: 'cortex-rcm-v2.0.3',
      impact: { records: 27, dollars: 61300, reversible: true, safety: false },
      why: {
        signals: [
          { label: 'Denial code CARC 4 on all 27', weight: 0.40 },
          { label: 'Modifier rule matches payer policy 8.3', weight: 0.33 },
          { label: 'Inside 90-day resubmission window', weight: 0.20 }
        ],
        rule: 'REQUIRE_APPROVAL if dollars > $5,000',
        counter: 'Payer policy 8.3 is under revision effective next quarter. Any claim past its 90-day window would be excluded rather than resubmitted.'
      },
      lineage: ['Epic Resolute', '835 parser v2.2', 'cortex-rcm-v2.0.3', 'proposed: resubmit x27'],
      inputs: { source: 'Epic Resolute', denials: 27, carc: '4', window_days: 90 },
      outputs: { resubmitted: 27, expected_recovery_usd: 61300 },
      status: 'pending'
    },
    {
      id: 'OPS-4476',
      title: 'Quarantine export containing unmasked PHI',
      summary: 'A scheduled analytics export matched 1,204 direct identifiers against an unapproved destination.',
      dept: 'Security Operations',
      tier: 'HIGH',
      phi: true,
      confidence: 0.99,
      model: 'cortex-dlp-v5.0.1',
      impact: { records: 1204, dollars: 0, reversible: true, safety: false },
      why: {
        signals: [
          { label: 'Direct identifiers in payload (MRN, SSN)', weight: 0.46 },
          { label: 'Destination outside approved egress list', weight: 0.34 },
          { label: 'No de-identification job in lineage', weight: 0.15 }
        ],
        rule: 'QUARANTINE_AND_ESCALATE if PHI leaves an approved boundary — always dual control to release',
        counter: 'If the destination were added to the approved egress list with a signed BAA, this would downgrade to a logged transfer rather than a quarantine.'
      },
      lineage: ['Snowflake export job', 'DLP scanner v5.0.1', 'cortex-dlp-v5.0.1', 'proposed: quarantine export'],
      inputs: { source: 'analytics-export-nightly', identifiers: 1204, destination: 's3://vendor-sftp-stage' },
      outputs: { quarantined: true, egress_blocked: true, soc_ticket: 'SOC-2291' },
      status: 'pending'
    },
    {
      id: 'OPS-4477',
      title: 'Draft prior-auth packet for 6 imaging orders',
      summary: 'Assembles the payer packet. Drafts only — nothing is submitted without a human.',
      dept: 'Utilization Mgmt',
      tier: 'LOW',
      phi: true,
      confidence: 0.95,
      model: 'cortex-doc-v1.6.0',
      impact: { records: 6, dollars: 0, reversible: true, safety: false },
      why: {
        signals: [
          { label: 'Order type requires prior auth for payer', weight: 0.42 },
          { label: 'Clinical criteria present in note', weight: 0.30 },
          { label: 'Template match for payer form', weight: 0.19 }
        ],
        rule: 'AUTO_EXECUTE if output is a draft and no external system is mutated',
        counter: 'A missing clinical indication in the note would leave the packet incomplete and route it to a UM nurse instead.'
      },
      lineage: ['Epic Radiant', 'note extractor v1.4', 'cortex-doc-v1.6.0', 'drafted: 6 packets'],
      inputs: { source: 'Epic Radiant', orders: 6, payer: 'Meridian Health Plan' },
      outputs: { drafts_created: 6, submitted: 0 },
      status: 'auto_executed'
    },
    {
      id: 'OPS-4478',
      title: 'Downgrade nurse staffing for Tue night shift',
      summary: 'Forecast census falls 9% below the staffing trigger for 3W.',
      dept: 'Nursing Operations',
      tier: 'HIGH',
      phi: false,
      confidence: 0.68,
      model: 'cortex-forecast-v3.1.2',
      impact: { records: 1, dollars: 3800, reversible: true, safety: true },
      why: {
        signals: [
          { label: 'Forecast census 9% under trigger', weight: 0.37 },
          { label: 'Elective schedule light Tue', weight: 0.24 },
          { label: 'Historical Tue variance low', weight: 0.15 }
        ],
        rule: 'BLOCK if patient_safety = true — staffing changes are never automated',
        counter: 'Census forecasts carry a +/- 11% band at this horizon, which spans the trigger. Any ED boarding surge invalidates this entirely.'
      },
      lineage: ['Kronos', 'census forecaster v3.1', 'cortex-forecast-v3.1.2', 'proposed: -1 RN Tue night'],
      inputs: { source: 'Kronos', unit: '3W', shift: 'Tue 19:00-07:00', forecast_census: 22, trigger: 24 },
      outputs: { rn_delta: -1, cost_avoided_usd: 3800 },
      status: 'pending'
    }
  ];

  // Patient records. Raw values live here; the UI never renders them unredacted
  // without an explicit, justified, logged reveal.
  var records = [
    {
      id: 'PT-10032',
      fields: [
        { key: 'Patient name', value: 'Rosalind M. Achebe', detector: 'NAME' },
        { key: 'MRN', value: 'MRN 44-2910', detector: 'MRN' },
        { key: 'Date of birth', value: '03/14/1968', detector: 'DOB' },
        { key: 'SSN', value: '412-88-9033', detector: 'SSN' },
        { key: 'Phone', value: '(617) 555-0148', detector: 'PHONE' },
        { key: 'Email', value: 'r.achebe@examplemail.com', detector: 'EMAIL' },
        { key: 'Address', value: '48 Harborview Street, Boston MA', detector: 'ADDRESS' },
        { key: 'Insurance ID', value: 'MHP4471902', detector: 'INSURANCE_ID' },
        { key: 'Encounter', value: 'Cardiology follow-up, 2026-07-09', detector: null },
        { key: 'Care team note', value: 'Pt reports improved exertional tolerance. Continue current regimen.', detector: null }
      ]
    },
    {
      id: 'PT-10033',
      fields: [
        { key: 'Patient name', value: 'Daniel Okonkwo-Reyes', detector: 'NAME' },
        { key: 'MRN', value: 'MRN 44-2901', detector: 'MRN' },
        { key: 'Date of birth', value: '11/02/1955', detector: 'DOB' },
        { key: 'SSN', value: '509-22-1847', detector: 'SSN' },
        { key: 'Phone', value: '617-555-0192', detector: 'PHONE' },
        { key: 'Email', value: 'd.okonkwo@examplemail.com', detector: 'EMAIL' },
        { key: 'Address', value: '1120 Vernon Avenue, Quincy MA', detector: 'ADDRESS' },
        { key: 'Insurance ID', value: 'MHP4471955', detector: 'INSURANCE_ID' },
        { key: 'Encounter', value: 'Laboratory, 2026-07-18', detector: null },
        { key: 'Care team note', value: 'Repeat metabolic panel ordered. Results pending review.', detector: null }
      ]
    }
  ];

  var sampleFreeText =
    'Called patient Rosalind M. Achebe (MRN 44-2910, DOB 03/14/1968) at (617) 555-0148 ' +
    'regarding her 03/14/1968 record. Member ID MHP4471902, SSN 412-88-9033. ' +
    'Mail to 48 Harborview Street, Boston MA or r.achebe@examplemail.com.';

  // 12 weeks of history per department, used by the moving-average forecast.
  var demand = {
    'Emergency Dept': [412, 398, 441, 455, 430, 468, 472, 449, 461, 488, 495, 507],
    'Operating Room': [88, 92, 85, 97, 101, 94, 99, 108, 104, 112, 109, 118],
    'Laboratory': [1320, 1288, 1401, 1377, 1420, 1455, 1398, 1462, 1490, 1478, 1533, 1561],
    'Imaging': [244, 251, 238, 262, 270, 259, 274, 281, 268, 290, 296, 302]
  };

  return {
    items: items,
    records: records,
    demand: demand,
    sampleFreeText: sampleFreeText,
    clone: function (v) { return JSON.parse(JSON.stringify(v)); }
  };
})();
