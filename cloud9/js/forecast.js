/* Cortex demo — moving-average demand forecast. Team Cloud 9. */
window.CORTEX = window.CORTEX || {};

CORTEX.forecast = (function () {
  'use strict';
  var util = CORTEX.util, rbac = CORTEX.rbac, app = CORTEX.app, data = CORTEX.data;
  var esc = util.esc;

  var dept = 'Emergency Dept';
  var WINDOW = 4, HORIZON = 4;

  // Deliberately simple and disclosable: a 4-week moving average with a band drawn from
  // historical residuals. No black box to explain away.
  function project(series) {
    var work = series.slice();
    var out = [];
    for (var h = 0; h < HORIZON; h++) {
      var w = work.slice(-WINDOW);
      var mean = w.reduce(function (a, b) { return a + b; }, 0) / w.length;
      out.push(mean);
      work.push(mean);
    }
    var resid = [];
    for (var i = WINDOW; i < series.length; i++) {
      var m = series.slice(i - WINDOW, i).reduce(function (a, b) { return a + b; }, 0) / WINDOW;
      resid.push(Math.abs(series[i] - m));
    }
    var mae = resid.length ? resid.reduce(function (a, b) { return a + b; }, 0) / resid.length : 0;
    return { points: out, band: mae * 1.6, mae: mae };
  }

  function chart(series, f) {
    var all = series.concat(f.points);
    var hi = Math.max.apply(null, all) + f.band, lo = Math.min.apply(null, all) - f.band;
    var W = 720, H = 240, pad = 34;
    var n = all.length;
    function x(i) { return pad + (i * (W - pad * 2)) / (n - 1); }
    function y(v) { return H - pad - ((v - lo) / (hi - lo || 1)) * (H - pad * 2); }

    var histPath = series.map(function (v, i) { return (i ? 'L' : 'M') + x(i) + ' ' + y(v); }).join(' ');
    var fcStart = series.length - 1;
    var fcPath = 'M' + x(fcStart) + ' ' + y(series[fcStart]) + ' ' +
      f.points.map(function (v, i) { return 'L' + x(fcStart + 1 + i) + ' ' + y(v); }).join(' ');
    var bandTop = [], bandBot = [];
    f.points.forEach(function (v, i) {
      bandTop.push(x(fcStart + 1 + i) + ' ' + y(v + f.band));
      bandBot.unshift(x(fcStart + 1 + i) + ' ' + y(v - f.band));
    });
    var band = 'M' + x(fcStart) + ' ' + y(series[fcStart]) + ' L' + bandTop.join(' L') +
               ' L' + bandBot.join(' L') + ' Z';

    var dots = f.points.map(function (v, i) {
      return '<circle cx="' + x(fcStart + 1 + i) + '" cy="' + y(v) + '" r="4" class="fc-dot"><title>Week +' +
        (i + 1) + ': ' + Math.round(v) + ' (± ' + Math.round(f.band) + ')</title></circle>';
    }).join('');

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="' +
      esc(dept) + ' demand forecast">' +
      '<line x1="' + pad + '" y1="' + (H - pad) + '" x2="' + (W - pad) + '" y2="' + (H - pad) + '" class="axis"/>' +
      '<line x1="' + x(fcStart) + '" y1="' + pad + '" x2="' + x(fcStart) + '" y2="' + (H - pad) + '" class="divider"/>' +
      '<path d="' + band + '" class="fc-band"/>' +
      '<path d="' + histPath + '" class="hist-line"/>' +
      '<path d="' + fcPath + '" class="fc-line"/>' + dots +
      '<text x="' + pad + '" y="' + (H - 10) + '" class="axis-label">12 weeks history</text>' +
      '<text x="' + (W - pad) + '" y="' + (H - 10) + '" text-anchor="end" class="axis-label">' + HORIZON + '-week forecast</text>' +
      '</svg>';
  }

  function render() {
    var host = util.$('#forecastPanel');
    if (!host) return;
    var series = data.demand[dept];
    var f = project(series);
    var last = series[series.length - 1];
    var delta = ((f.points[HORIZON - 1] - last) / last) * 100;

    util.$('#deptSelect').value = dept;
    host.innerHTML =
      chart(series, f) +
      '<div class="fc-stats">' +
        '<div><span>Next week</span><b>' + Math.round(f.points[0]) + '</b></div>' +
        '<div><span>Week +' + HORIZON + '</span><b>' + Math.round(f.points[HORIZON - 1]) + '</b></div>' +
        '<div><span>Band (±)</span><b>' + Math.round(f.band) + '</b></div>' +
        '<div><span>Trend</span><b class="' + (delta >= 0 ? 'ok' : 'bad') + '">' +
          (delta >= 0 ? '+' : '') + delta.toFixed(1) + '%</b></div>' +
      '</div>' +
      '<div class="why">' +
        '<div class="why-head">Why this forecast</div>' +
        '<div class="why-rule"><b>Method:</b> <code>' + WINDOW + '-week moving average, projected ' + HORIZON +
          ' weeks; band = 1.6 × mean absolute error (' + f.mae.toFixed(1) + ') of the same method on history</code></div>' +
        '<div class="why-counter"><b>Limits:</b> this method carries no seasonality or event awareness. ' +
          'It should not be used alone for staffing decisions that touch patient safety — ' +
          'OPS-4478 in the queue is blocked for exactly that reason.</div>' +
        '<div class="why-lineage"><b>Lineage:</b> <span class="chip">' + esc(dept) + ' census feed</span>' +
          '<span class="arrow">→</span><span class="chip">weekly aggregator</span>' +
          '<span class="arrow">→</span><span class="chip">cortex-forecast-v3.1.2</span></div>' +
      '</div>';
  }

  function init() {
    var sel = util.$('#deptSelect');
    sel.innerHTML = Object.keys(data.demand).map(function (d) {
      return '<option>' + esc(d) + '</option>';
    }).join('');
    sel.addEventListener('change', function () { dept = sel.value; app.render(); });

    util.$('#acceptForecast').addEventListener('click', function () {
      if (!rbac.can(app.state.role, 'approve_medium')) return app.deny('approve_medium', 'forecast/' + dept);
      var series = data.demand[dept];
      var f = project(series);
      app.log('MODEL_DECISION_ACCEPTED', {
        object: 'forecast/' + dept, tier: 'MEDIUM',
        inputs: { method: WINDOW + '-week moving average', history_weeks: series.length, series: series },
        outputs: { horizon_weeks: HORIZON, points: f.points.map(Math.round), band: Math.round(f.band) },
        justification: 'Forecast accepted into planning by ' + app.actor() +
          '. Recorded as a model decision with its full input series.',
        lineage: dept + ' census feed -> weekly aggregator -> cortex-forecast-v3.1.2 -> planning'
      });
      app.toast('Forecast accepted into planning and written to the audit trail with its inputs.');
      app.render();
    });

    app.onRender(render);
  }

  return { init: init };
})();
