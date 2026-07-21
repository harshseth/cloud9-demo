/* Cortex demo — append-only, hash-chained audit log. Team Cloud 9. */
window.CORTEX = window.CORTEX || {};

CORTEX.audit = (function () {
  'use strict';
  var util = CORTEX.util;

  var entries = [];
  var GENESIS = '0000000000000000';

  // Canonical serialization — what the chain hash actually commits to. Any field mutated
  // after the fact breaks verification at that row.
  function canonical(e) {
    return [e.seq, e.ts, e.actor, e.role, e.action, e.object, e.tier,
            JSON.stringify(e.inputs || {}), JSON.stringify(e.outputs || {}),
            e.justification || '', e.lineage || '', e.prevHash].join('|');
  }

  function append(entry) {
    var prev = entries.length ? entries[entries.length - 1].hash : GENESIS;
    var e = {
      seq: entries.length + 1,
      ts: entry.ts || Date.now(),
      actor: entry.actor,
      role: entry.role,
      action: entry.action,
      object: entry.object || '',
      tier: entry.tier || 'n/a',
      inputs: entry.inputs || {},
      outputs: entry.outputs || {},
      justification: entry.justification || '',
      lineage: entry.lineage || '',
      prevHash: prev
    };
    e.hash = util.hash(canonical(e));
    entries.push(e);
    return e;
  }

  function verify() {
    var prev = GENESIS;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.prevHash !== prev) {
        return { ok: false, seq: e.seq, reason: 'broken link: prevHash does not match the preceding entry' };
      }
      var expect = util.hash(canonical(e));
      if (expect !== e.hash) {
        return { ok: false, seq: e.seq, reason: 'content altered: recomputed hash ' + expect + ' != stored ' + e.hash };
      }
      prev = e.hash;
    }
    return { ok: true, count: entries.length };
  }

  // Deliberately rewrites a row's content *without* re-hashing, so a reviewer can watch
  // verification fail. Evidence beats assurance.
  function tamper() {
    if (entries.length < 2) return null;
    var idx = Math.floor(entries.length / 2);
    var e = entries[idx];
    e.outputs = Object.assign({}, e.outputs, { _altered_offline: true });
    e.justification = (e.justification || '') + ' [record edited outside Cortex]';
    return e.seq;
  }

  function filter(opts) {
    opts = opts || {};
    var q = (opts.q || '').toLowerCase();
    return entries.filter(function (e) {
      if (opts.actor && e.actor !== opts.actor) return false;
      if (opts.action && e.action !== opts.action) return false;
      if (opts.tier && e.tier !== opts.tier) return false;
      if (opts.from && e.ts < opts.from) return false;
      if (opts.to && e.ts > opts.to) return false;
      if (q) {
        var hay = [e.actor, e.role, e.action, e.object, e.tier, e.justification, e.lineage,
                   JSON.stringify(e.inputs), JSON.stringify(e.outputs)].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function flatten(rows) {
    return rows.map(function (e) {
      return {
        seq: e.seq,
        timestamp_utc: util.iso(e.ts),
        actor: e.actor,
        role: e.role,
        action: e.action,
        object: e.object,
        risk_tier: e.tier,
        inputs: JSON.stringify(e.inputs),
        outputs: JSON.stringify(e.outputs),
        justification: e.justification,
        lineage: e.lineage,
        prev_hash: e.prevHash,
        hash: e.hash
      };
    });
  }

  var COLUMNS = ['seq', 'timestamp_utc', 'actor', 'role', 'action', 'object', 'risk_tier',
                 'inputs', 'outputs', 'justification', 'lineage', 'prev_hash', 'hash'];

  function exportCSV(rows) {
    util.download('cortex-audit-' + Date.now() + '.csv', util.toCSV(flatten(rows), COLUMNS), 'text/csv;charset=utf-8');
  }

  function exportJSON(rows) {
    var payload = {
      exported_at: new Date().toISOString(),
      tenant: "St. Catherine's Health",
      vendor: 'Cortex (Team Cloud 9)',
      chain_verification: verify(),
      entry_count: rows.length,
      entries: flatten(rows)
    };
    util.download('cortex-audit-' + Date.now() + '.json', JSON.stringify(payload, null, 2), 'application/json');
  }

  function actions() {
    var seen = {};
    entries.forEach(function (e) { seen[e.action] = true; });
    return Object.keys(seen).sort();
  }

  function actors() {
    var seen = {};
    entries.forEach(function (e) { seen[e.actor] = true; });
    return Object.keys(seen).sort();
  }

  function all() { return entries; }
  function load(saved) { entries = saved || []; }
  function reset() { entries = []; }

  return { append: append, verify: verify, tamper: tamper, filter: filter, flatten: flatten,
           COLUMNS: COLUMNS, exportCSV: exportCSV, exportJSON: exportJSON,
           actions: actions, actors: actors, all: all, load: load, reset: reset };
})();
