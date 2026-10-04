/* Solar Investment Dashboard: front-end
 * Every input change recalculates the shared model (window.SolarModel) instantly in the browser.
 * The same model runs on the server at /api/calculate.
 */
(function () {
  'use strict';
  const M = window.SolarModel;
  const C = { dark: '#0E1A6B', blue: '#1F36C7', mid: '#5B6FE0', light: '#B9C3F2', pale: '#EEF1FD', grey: '#5A6380', soft: '#8A93B5',
    bad: '#B3261E', peach: '#FBE3D6', line: '#E1E5F2' };
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------- Input definitions (display units) ----------------
  const GROUPS = [
    { id: 'site', title: 'Site and grid', fields: [
      { key: 'annualSpend', label: 'Yearly power bill', min: 1, max: 10, step: 0.1, scale: 1e-6, dec: 1, pre: '€', suf: 'M', src: 'Case' },
      { key: 'gridPrice', label: 'Grid price, € per kWh', min: 0.04, max: 0.2, step: 0.001, scale: 1, dec: 3, pre: '€', src: 'Assumption' },
      { key: 'gridEscalation', label: 'Grid price rise a year', min: 0, max: 8, step: 0.1, scale: 100, dec: 1, suf: '%', src: 'Assumption' },
      { key: 'demandChange', label: 'Change in site demand', min: -70, max: 50, step: 5, scale: 100, dec: 0, suf: '%', src: 'Scenario' }
    ] },
    { id: 'solar', title: 'Solar plant output', fields: [
      { key: 'plantMW', label: 'Plant size, MW', min: 1, max: 15, step: 0.5, scale: 1, dec: 1, src: 'Case' },
      { key: 'sunnyDays', label: 'Sunny days a year', min: 150, max: 365, step: 1, scale: 1, dec: 0, src: 'Assumption' },
      { key: 'sunnyHours', label: 'Peak hours, sunny day', min: 4, max: 12, step: 0.5, scale: 1, dec: 1, src: 'Assumption' },
      { key: 'lowSunHours', label: 'Peak hours, other days', min: 0, max: 8, step: 0.5, scale: 1, dec: 1, src: 'Assumption' },
      { key: 'outputFactor', label: 'Output vs plan', min: 40, max: 120, step: 5, scale: 100, dec: 0, suf: '%', src: 'Scenario' }
    ], info: 'info-solar' },
    { id: 'a', title: 'Option A: Solar as a Service', cls: 'a', fields: [
      { key: 'tariffA', label: 'Year 1 tariff, € per kWh', min: 0.04, max: 0.15, step: 0.001, scale: 1, dec: 3, pre: '€', src: 'Case' },
      { key: 'escalationA', label: 'Tariff rise a year', min: 0, max: 6, step: 0.1, scale: 100, dec: 1, suf: '%', src: 'Case' },
      { key: 'termA', label: 'Contract term, years', min: 5, max: 25, step: 1, scale: 1, dec: 0, src: 'Case' }
    ], toggle: { key: 'gridCapA', label: 'Contract caps tariff at grid price' } },
    { id: 'b', title: 'Option B: Own the plant', cls: 'b', fields: [
      { key: 'capexB', label: 'Upfront investment', min: 2, max: 15, step: 0.1, scale: 1e-6, dec: 1, pre: '€', suf: 'M', src: 'Case' },
      { key: 'runCostB', label: 'Running cost, € per kWh', min: 0, max: 0.12, step: 0.001, scale: 1, dec: 3, pre: '€', src: 'Case' },
      { key: 'runInflationB', label: 'Running cost rise a year', min: 0, max: 6, step: 0.1, scale: 100, dec: 1, suf: '%', src: 'Scenario' },
      { key: 'lifeB', label: 'Plant life, years', min: 10, max: 30, step: 1, scale: 1, dec: 0, src: 'Case' }
    ] },
    { id: 'fin', title: 'Finance', fields: [
      { key: 'discountRate', label: 'Discount rate (hurdle)', min: 2, max: 25, step: 0.5, scale: 100, dec: 1, suf: '%', src: 'Assumption' }
    ] }
  ];
  const SRC_TITLE = { Case: 'Value from the case', Assumption: 'Our assumption', Scenario: 'Stress test, base is no change' };
  const FIELD = {};
  GROUPS.forEach(g => g.fields.forEach(f => { FIELD[f.key] = f; }));

  const PRESETS = {
    base: { name: 'Case base', set: {} },
    cheapCapital: { name: 'Capital at 10%', set: { discountRate: 0.10 } },
    lowOutput: { name: 'Output 80%', set: { outputFactor: 0.8 } },
    costRise: { name: 'B costs rise 2.5%', set: { runInflationB: 0.025 } },
    demandDrop: { name: 'Demand falls 60%', set: { demandChange: -0.6 } }
  };

  const clone = o => JSON.parse(JSON.stringify(o));
  let state = clone(M.DEFAULTS);
  let view = 'pv';

  // ---------------- Formatting ----------------
  const eurM = v => (v < 0 ? '-€' : '€') + Math.abs(v / 1e6).toFixed(2) + 'M';
  const eurK = v => (v < 0 ? '-€' : '€') + Math.round(Math.abs(v) / 1e3).toLocaleString('en-GB') + 'K';
  const signedK = v => (v > 0 ? '+' : v < 0 ? '-' : '') + Math.round(Math.abs(v) / 1e3).toLocaleString('en-GB');
  const pct = (v, d = 1) => (v * 100).toFixed(d) + '%';
  const kwhM = v => (v / 1e6).toFixed(1) + 'M';
  const eur3 = v => '€' + v.toFixed(3);
  const $ = id => document.getElementById(id);
  const nb = x => '<span class="nb">' + x + '</span>';
  const fmtField = (f, raw) => (f.pre || '') + (raw * f.scale).toFixed(f.dec) + (f.suf || '');
  const fmtTip = (fmt, v) => fmt === 'pct' ? pct(v) : fmt === 'pct0' ? pct(v, 0) : fmt === 'eurM' ? eurM(v) : eur3(v);

  // ---------------- Build input controls ----------------
  function buildControls() {
    const host = $('controls-body');
    const legend = document.createElement('p');
    legend.className = 'legend';
    legend.innerHTML = '<span><span class="src src-case"></span>From case</span><span><span class="src src-assumption"></span>Our assumption</span><span><span class="src src-scenario"></span>Stress test</span>';
    host.appendChild(legend);
    GROUPS.forEach(g => {
      const box = document.createElement('div');
      box.className = 'group' + (g.cls ? ' ' + g.cls : '');
      box.innerHTML = '<h3>' + g.title + '</h3>';
      g.fields.forEach(f => {
        const id = 'in-' + f.key;
        const row = document.createElement('div');
        row.className = 'field'; row.id = 'f-' + f.key;
        row.innerHTML =
          '<div class="field-top"><label for="' + id + '" title="' + f.label + '"><span class="src src-' + f.src.toLowerCase() + '" title="' + SRC_TITLE[f.src] + '"></span>' + f.label + '</label>' +
          '<input class="val" id="v-' + f.key + '" type="text" inputmode="decimal" aria-label="' + f.label + ' value"></div>' +
          '<input type="range" id="' + id + '" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '">';
        box.appendChild(row);
      });
      if (g.toggle) {
        const t = document.createElement('label');
        t.className = 'toggle';
        t.innerHTML = '<input type="checkbox" id="in-' + g.toggle.key + '"> ' + g.toggle.label;
        box.appendChild(t);
      }
      if (g.info) { const p = document.createElement('p'); p.className = 'info'; p.id = g.info; box.appendChild(p); }
      host.appendChild(box);
    });
    Object.values(FIELD).forEach(f => {
      const slider = $('in-' + f.key), box = $('v-' + f.key);
      slider.addEventListener('input', () => { state[f.key] = Number(slider.value) / f.scale; schedule(); });
      const commit = () => {
        const n = parseFloat(String(box.value).replace(/[^0-9.\-]/g, ''));
        if (!isNaN(n)) state[f.key] = Math.min(f.max, Math.max(f.min, n)) / f.scale;
        schedule();
      };
      box.addEventListener('change', commit);
      box.addEventListener('keydown', e => { if (e.key === 'Enter') { commit(); box.blur(); } });
    });
    $('in-gridCapA').addEventListener('change', e => { state.gridCapA = e.target.checked; schedule(); });
  }

  function syncControls() {
    Object.values(FIELD).forEach(f => {
      const v = state[f.key], slider = $('in-' + f.key), box = $('v-' + f.key);
      slider.value = (v * f.scale).toFixed(6);
      if (document.activeElement !== box) box.value = fmtField(f, v);
      $('f-' + f.key).classList.toggle('changed', Math.abs(v - M.DEFAULTS[f.key]) > 1e-9);
    });
    $('in-gridCapA').checked = !!state.gridCapA;
  }

  // ---------------- URL state ----------------
  function writeURL() {
    const q = new URLSearchParams();
    Object.keys(FIELD).forEach(k => { if (Math.abs(state[k] - M.DEFAULTS[k]) > 1e-9) q.set(k, +state[k].toFixed(6)); });
    if (state.gridCapA !== M.DEFAULTS.gridCapA) q.set('gridCapA', state.gridCapA ? 1 : 0);
    Object.keys(state.weights).forEach(k => { if (state.weights[k] !== M.DEFAULTS.weights[k]) q.set('w_' + k, state.weights[k]); });
    if (view === 'cash') q.set('chart', 'cash');
    if (document.body.classList.contains('present')) q.set('view', 'present');
    const s = q.toString();
    history.replaceState(null, '', s ? '?' + s : location.pathname);
  }
  function readURL() {
    const q = new URLSearchParams(location.search);
    const raw = {}, w = {};
    q.forEach((v, k) => { if (k.startsWith('w_')) w[k.slice(2)] = v; else raw[k] = v; });
    raw.weights = w;
    state = M.sanitize(raw);
    if (q.get('chart') === 'cash') view = 'cash';
    if (q.get('view') === 'present') setPresent(true);
  }

  // ---------------- Chart plugins ----------------
  Chart.defaults.font.family = 'Arial, Helvetica, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = C.dark;
  Chart.defaults.animation = reduceMotion ? false : { duration: 250 };

  function pill(ctx, x, y, text, fill, color, font) {
    ctx.font = font || 'bold 12px Arial';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = fill; ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, 17, 8); else ctx.rect(x, y, w, 17);
    ctx.fill();
    ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(text, x + 5, y + 9);
    return w;
  }

  // Labels at the end of the cumulative lines, kept apart
  const endLabels = {
    id: 'endLabels',
    afterDatasetsDraw(chart, args, opts) {
      if (!opts || !opts.enabled) return;
      const ctx = chart.ctx, area = chart.chartArea;
      const items = [];
      chart.data.datasets.forEach((ds, i) => {
        if (!ds.endLabel || !chart.isDatasetVisible(i)) return;
        const meta = chart.getDatasetMeta(i);
        let idx = -1;
        for (let k = ds.data.length - 1; k >= 0; k--) if (ds.data[k] !== null && ds.data[k] !== undefined) { idx = k; break; }
        if (idx >= 0 && meta.data[idx]) items.push({ ds, pt: meta.data[idx] });
      });
      items.sort((a, b) => a.pt.y - b.pt.y);
      ctx.save();
      items.forEach((it, j) => {
        ctx.font = 'bold 12px Arial';
        const w = ctx.measureText(it.ds.endLabel).width + 10;
        let y = j === 0 ? it.pt.y - 22 : it.pt.y + 5;
        y = Math.max(area.top, Math.min(y, area.bottom - 18));
        pill(ctx, Math.min(it.pt.x - w + 2, area.right - w), y, it.ds.endLabel, it.ds.labelFill, it.ds.labelText);
      });
      ctx.restore();
    }
  };
  // Dashed vertical event markers (payback, contract end, crossover)
  const vlines = {
    id: 'vlines',
    afterDatasetsDraw(chart, args, opts) {
      if (!opts || !opts.lines || !opts.lines.length) return;
      const ctx = chart.ctx, area = chart.chartArea, xs = chart.scales.x;
      ctx.save();
      ctx.font = 'bold 12px Arial';
      const rows = [[], [], []];
      opts.lines.slice().sort((p, q) => p.index - q.index).forEach(ln => {
        const x = xs.getPixelForValue(ln.index);
        if (isNaN(x)) return;
        const w = ctx.measureText(ln.text).width + 10;
        const fit = v => Math.max(area.left, Math.min(v, area.right - w));
        const cands = [fit(x - w / 2), fit(x + 3), fit(x - w - 3)];
        const free = (r, lx) => r.every(seg => lx > seg[1] + 4 || lx + w < seg[0] - 4);
        let row = -1, lx = cands[0];
        for (let rr = 0; rr < 3 && row < 0; rr++) { const c = cands.find(c => free(rows[rr], c)); if (c !== undefined) { row = rr; lx = c; } }
        if (row < 0) row = 2;
        rows[row].push([lx, lx + w]);
        const py = area.top - (opts.lines.length >= 3 ? 57 : 38) + row * 19;
        ctx.strokeStyle = ln.color; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(x, py + 17); ctx.lineTo(x, area.bottom); ctx.stroke(); ctx.setLineDash([]);
        pill(ctx, lx, py, ln.text, ln.color, '#fff');
      });
      ctx.restore();
    }
  };
  // Value labels on floating (waterfall) and stacked bars
  const barText = {
    id: 'barText',
    afterDatasetsDraw(chart, args, opts) {
      if (!opts || !opts.enabled) return;
      const ctx = chart.ctx;
      ctx.save(); ctx.textAlign = 'center';
      if (opts.mode === 'waterfall') {
        const ds = chart.data.datasets[0], meta = chart.getDatasetMeta(0);
        // connectors
        ctx.strokeStyle = C.soft; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        for (let i = 0; i < meta.data.length - 1; i++) {
          const b = meta.data[i], n = meta.data[i + 1];
          const lvl = opts.levels[i];
          const y = chart.scales.y.getPixelForValue(lvl);
          ctx.beginPath(); ctx.moveTo(b.x + b.width / 2, y); ctx.lineTo(n.x - n.width / 2, y); ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.font = 'bold 12px Arial';
        meta.data.forEach((b, i) => {
          const top = Math.min(b.y, b.base);
          ctx.fillStyle = opts.colors[i];
          ctx.fillText(ds.valueText[i], b.x, top - 5);
        });
      } else if (opts.mode === 'stack') {
        const m0 = chart.getDatasetMeta(0), m1 = chart.getDatasetMeta(1);
        m0.data.forEach((b, i) => {
          const total = (chart.data.datasets[0].data[i] || 0) + (chart.data.datasets[1].data[i] || 0);
          const topBar = (chart.data.datasets[1].data[i] || 0) > 0 ? m1.data[i] : b;
          ctx.font = 'bold 13px Arial'; ctx.fillStyle = C.dark;
          ctx.fillText(eur3(total), b.x, topBar.y - 6);
          if ((chart.data.datasets[1].data[i] || 0) > 0) {
            ctx.font = 'bold 12px Arial';
            const h0 = Math.abs(b.base - b.y), h1 = Math.abs(m1.data[i].base - m1.data[i].y);
            if (h0 > 30) { ctx.fillStyle = '#fff'; ctx.fillText('run', b.x, b.y + h0 / 2 - 2); ctx.fillText(eur3(chart.data.datasets[0].data[i]), b.x, b.y + h0 / 2 + 12); }
            if (h1 > 30) { ctx.fillStyle = C.bad; ctx.fillText('capital', b.x, m1.data[i].y + h1 / 2 - 2); ctx.fillText(eur3(chart.data.datasets[1].data[i]), b.x, m1.data[i].y + h1 / 2 + 12); }
            else if (h1 > 14) { ctx.fillStyle = C.bad; ctx.fillText(eur3(chart.data.datasets[1].data[i]), b.x, m1.data[i].y + h1 / 2 + 4); }
          }
        });
      }
      ctx.restore();
    }
  };
  Chart.register(endLabels, vlines, barText);

  const axis = extra => Object.assign({ grid: { color: C.line }, border: { display: false }, ticks: { color: C.grey } }, extra || {});
  const legendCfg = { position: 'bottom', labels: { boxWidth: 12, boxHeight: 8, padding: 8 } };
  let chValue, chWf, chPrice, chLev;

  function buildCharts() {
    chValue = new Chart($('c-value'), {
      data: { labels: [], datasets: [
        { type: 'bar', label: 'A yearly', data: [], yAxisID: 'y2', backgroundColor: 'rgba(91,111,224,0.75)', borderRadius: 2, order: 3, barPercentage: 0.9, categoryPercentage: 0.8 },
        { type: 'bar', label: 'B yearly', data: [], yAxisID: 'y2', backgroundColor: 'rgba(14,26,107,0.22)', borderRadius: 2, order: 3, barPercentage: 0.9, categoryPercentage: 0.8 },
        { type: 'line', label: 'A cumulative', data: [], yAxisID: 'y', borderColor: C.blue, backgroundColor: 'rgba(31,54,199,0.10)', fill: 'origin', borderWidth: 3, pointRadius: 0, tension: 0.25, order: 1, labelFill: C.blue, labelText: '#fff' },
        { type: 'line', label: 'B cumulative', data: [], yAxisID: 'y', borderColor: C.dark, backgroundColor: 'rgba(179,38,30,0.07)', fill: 'origin', borderWidth: 3, pointRadius: 0, tension: 0.25, order: 1, borderDash: [], labelFill: C.dark, labelText: '#fff' }
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, layout: { padding: { top: 40 } },
        plugins: { legend: legendCfg, endLabels: { enabled: true }, vlines: { lines: [] },
          tooltip: { callbacks: { label: c => c.dataset.label + ': ' + (c.raw === null ? 'n/a' : (c.dataset.yAxisID === 'y2' ? eurK(c.raw * 1e3) : eurM(c.raw * 1e6))) } } },
        scales: {
          x: axis({ grid: { display: false }, ticks: { color: C.grey, autoSkip: false, maxRotation: 0, callback: (v, i) => (i % 5 === 0 ? 'Y' + i : '') } }),
          y: axis({ position: 'left', title: { display: true, text: 'Cumulative, €M', color: C.grey }, ticks: { color: C.grey, callback: v => v } }),
          y2: axis({ position: 'right', min: 0, grid: { display: false }, title: { display: true, text: 'Each year, €K', color: C.grey }, ticks: { color: C.grey, callback: v => v } })
        } }
    });

    chWf = new Chart($('c-wf'), {
      type: 'bar',
      data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderColor: [], borderWidth: 1.5, borderRadius: 3, valueText: [], barPercentage: 0.78 }] },
      options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 18 } },
        plugins: { legend: { display: false }, barText: { enabled: true, mode: 'waterfall', levels: [], colors: [] },
          tooltip: { callbacks: { label: c => c.dataset.valueText[c.dataIndex] + 'M' } } },
        scales: { x: axis({ grid: { display: false }, ticks: { color: C.dark, maxRotation: 0, autoSkip: false } }),
          y: axis({ ticks: { color: C.grey, callback: v => v } }) } }
    });

    chPrice = new Chart($('c-price'), {
      type: 'line',
      data: { labels: [], datasets: [
        { label: 'Grid', data: [], borderColor: C.soft, borderWidth: 2.5, pointRadius: 0 },
        { label: 'A tariff', data: [], borderColor: C.blue, backgroundColor: 'rgba(31,54,199,0.16)', fill: '-1', borderWidth: 3, pointRadius: 0 },
        { label: 'B running', data: [], borderColor: C.dark, borderWidth: 2, borderDash: [5, 4], pointRadius: 0 },
        { label: 'B with capital', data: [], borderColor: C.bad, borderWidth: 2, borderDash: [2, 3], pointRadius: 0 }
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: legendCfg, tooltip: { callbacks: { label: c => c.dataset.label + ': ' + (c.raw === null ? 'n/a' : eur3(c.raw)) } } },
        scales: { x: axis({ grid: { display: false }, ticks: { color: C.grey, autoSkip: false, maxRotation: 0, callback: (v, i) => ((i + 1) % 5 === 0 || i === 0 ? 'Y' + (i + 1) : '') } }),
          y: axis({ ticks: { color: C.grey, callback: v => '€' + Number(v).toFixed(2) } }) } }
    });

    chLev = new Chart($('c-lev'), {
      type: 'bar',
      data: { labels: ['A', 'Grid', 'B'], datasets: [
        { label: 'Energy or running cost', data: [], backgroundColor: [C.blue, C.soft, C.dark], borderRadius: 3, stack: 's' },
        { label: 'Capital charge', data: [], backgroundColor: C.peach, borderColor: C.bad, borderWidth: 1.5, borderRadius: 3, stack: 's' }
      ] },
      options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 20 } },
        plugins: { legend: { display: false }, barText: { enabled: true, mode: 'stack' }, tooltip: { callbacks: { label: c => c.dataset.label + ': ' + eur3(c.raw) } } },
        scales: { x: axis({ stacked: true, grid: { display: false }, ticks: { color: C.dark, font: { weight: 'bold' } } }),
          y: axis({ stacked: true, beginAtZero: true, ticks: { color: C.grey, callback: v => '€' + Number(v).toFixed(2) } }) } }
    });
  }

  // ---------------- Small visuals ----------------
  function sparkSVG(vals, stroke, zeroColor) {
    const n = vals.length, lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = hi - lo || 1;
    const X = i => (i / (n - 1)) * 100, Y = v => 19 - ((v - lo) / span) * 18;
    const d = vals.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(2) + ' ' + Y(v).toFixed(2)).join(' ');
    return '<svg viewBox="0 0 100 20" preserveAspectRatio="none"><line x1="0" x2="100" y1="' + Y(0).toFixed(2) + '" y2="' + Y(0).toFixed(2) +
      '" stroke="' + zeroColor + '" stroke-width="0.8" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/><path d="' + d +
      '" fill="none" stroke="' + stroke + '" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>';
  }
  const setW = (id, frac) => { $(id).style.width = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + '%'; };
  const setL = (id, frac) => { $(id).style.left = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + '%'; };

  // ---------------- Render ----------------
  function render() {
    const R = M.calculate(state);
    const r = R.results, e = R.energy, p = R.inputs, sc = R.scorecard;
    const FW = R.verdict.financialWinner, REC = R.verdict.recommended;
    const Y = R.years;
    syncControls();

    $('info-solar').innerHTML = 'Output <b>' + kwhM(e.generation) + ' kWh</b> a year from ' + Math.round(e.fullHours).toLocaleString('en-GB') +
      ' peak hours, <b>' + pct(e.solarShare, 0) + '</b> of ' + kwhM(e.demand) + ' kWh demand. Grid supplies ' + kwhM(e.gridKwh) + ' kWh.' +
      (e.unusedSolar > 1 ? ' <b>' + kwhM(e.unusedSolar) + ' kWh</b> of solar cannot be used.' : '');

    // ----- KPIs
    const neg = v => v < 0 ? ' class="neg"' : '';
    $('k-npvA').innerHTML = '<span' + neg(r.npvA) + '>' + eurM(r.npvA) + '</span>';
    $('k-npvA-s').textContent = eurK(r.eaA) + ' a year, ' + p.termA + ' years';
    $('sp-a').innerHTML = sparkSVG(Y.map(y => y.dcumA), '#FFFFFF', 'rgba(255,255,255,.6)');
    $('k-npvB').innerHTML = '<span' + neg(r.npvB) + '>' + eurM(r.npvB) + '</span>';
    $('k-npvB-s').textContent = eurK(r.eaB) + ' a year, ' + p.lifeB + ' years';
    $('sp-b').innerHTML = sparkSVG(Y.map(y => y.dcumB), '#FFB4AB', 'rgba(255,255,255,.6)');
    $('k-gap').textContent = eurM(Math.abs(r.npvGap));
    $('k-gap-s').textContent = (r.eaGap >= 0 ? 'A' : 'B') + ' ahead ' + eurK(Math.abs(r.eaGap)) + ' a year';
    setW('kb-gap', Math.abs(r.npvGap) / p.capexB);
    $('kb-gap').title = 'Gap as a share of B\'s investment';
    $('k-y1').innerHTML = eurK(r.saveY1A) + ' <small>vs ' + eurK(r.saveY1B) + '</small>';
    $('k-y1-s').textContent = 'A vs B, before capital';
    const y1max = Math.max(Math.abs(r.saveY1A), Math.abs(r.saveY1B), 1);
    setW('kb-y1a', r.saveY1A / y1max); setW('kb-y1b', r.saveY1B / y1max);
    $('k-irr').innerHTML = r.irrB === null ? 'n/a' : '<span' + (r.irrB < p.discountRate ? ' class="neg"' : '') + '>' + pct(r.irrB) + '</span>';
    $('k-irr-s').textContent = 'Hurdle ' + pct(p.discountRate, 0) + (r.paybackB ? ', payback Y' + r.paybackB : ', no payback');
    setW('kb-irr', (r.irrB || 0) / 0.25); setL('km-irr', p.discountRate / 0.25);
    let beDir;
    if (r.breakEvenRate !== null) {
      const lowSide = Object.assign(clone(state), { discountRate: Math.max(0.02, r.breakEvenRate - 0.01) });
      beDir = M.calculate(lowSide).results.eaGap < 0 ? 'B' : 'A';
      $('k-be').textContent = pct(r.breakEvenRate);
      $('k-be-s').textContent = (beDir === 'B' ? 'B wins below' : 'A wins below') + ', now ' + pct(p.discountRate, 0);
      setW('kz-be', r.breakEvenRate / 0.25);
    } else {
      beDir = null; $('k-be').textContent = 'None'; $('k-be-s').textContent = FW + ' wins at every rate'; setW('kz-be', 0);
    }
    setL('km-be', p.discountRate / 0.25); $('km-be').style.background = C.blue;
    $('k-share').textContent = pct(e.solarShare, 0);
    $('k-share-s').textContent = kwhM(e.solarUsed) + ' of ' + kwhM(e.demand) + ' kWh';
    setW('kb-share', e.solarShare);

    // ----- Value chart (combo)
    const isPV = view === 'pv';
    chValue.data.labels = Y.map(y => 'Y' + y.year);
    chValue.data.datasets[0].data = Y.map(y => (y.year === 0 || y.saveA === null) ? null : +((isPV ? y.pvA : y.saveA) / 1e3).toFixed(1));
    chValue.data.datasets[1].data = Y.map(y => (y.year === 0 || y.saveB === null) ? null : +((isPV ? y.pvB : y.saveB) / 1e3).toFixed(1));
    chValue.data.datasets[2].data = Y.map(y => +((isPV ? y.dcumA : y.cumA) / 1e6).toFixed(3));
    chValue.data.datasets[3].data = Y.map(y => +((isPV ? y.dcumB : y.cumB) / 1e6).toFixed(3));
    const endA = isPV ? r.npvA : Y[Y.length - 1].cumA, endB = isPV ? r.npvB : Y[Y.length - 1].cumB;
    chValue.data.datasets[2].endLabel = 'A ' + eurM(endA);
    chValue.data.datasets[3].endLabel = 'B ' + eurM(endB);
    const barMax = Math.max(1, ...chValue.data.datasets[0].data.concat(chValue.data.datasets[1].data).filter(v => v !== null).map(Math.abs));
    chValue.options.scales.y2.max = Math.ceil(barMax * 2.4 / 100) * 100;
    let cross = null;
    for (let t = 1; t < Y.length; t++) {
      const a = isPV ? Y[t].dcumA : Y[t].cumA, b = isPV ? Y[t].dcumB : Y[t].cumB;
      const a0 = isPV ? Y[t - 1].dcumA : Y[t - 1].cumA, b0 = isPV ? Y[t - 1].dcumB : Y[t - 1].cumB;
      if (b >= a && b0 < a0) { cross = t; break; }
    }
    const lines = [];
    if (r.paybackB) lines.push({ index: r.paybackB, text: 'B payback Y' + r.paybackB, color: C.dark });
    if (p.termA < Y.length - 1) lines.push({ index: p.termA, text: 'A ends Y' + p.termA, color: C.blue });
    if (cross) lines.push({ index: cross, text: 'B ahead Y' + cross, color: C.bad });
    chValue.options.plugins.vlines.lines = lines;
    chValue.options.layout.padding.top = lines.length >= 3 ? 59 : lines.length ? 40 : 6;
    chValue.update();
    const df20 = 1 / Math.pow(1 + p.discountRate, 20);
    $('t-value').innerHTML = isPV
      ? (cross ? 'In today\'s money B overtakes A in <b>Year ' + cross + '</b>.' : 'In today\'s money B never catches A. It ends <b>' + nb(eurM(Math.abs(r.npvA - r.npvB))) + '</b> behind.')
      : 'In cash B ' + (cross ? 'overtakes A in <b>Year ' + cross + '</b>' : 'never overtakes A') + ', but €1 in Year 20 is worth <b>' + nb('€' + df20.toFixed(2)) + '</b> today.';
    document.querySelectorAll('.seg-b').forEach(b => { const on = b.dataset.view === view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });

    // ----- Waterfall
    const w = r.waterfall, cM = w.capital / 1e6, eM = w.extraInTerm / 1e6, aM = w.afterTerm / 1e6, gM = w.gap / 1e6;
    const l1 = cM, l2 = cM - eM, l3 = l2 - aM;
    const span = (x, y) => [Math.min(x, y), Math.max(x, y)];
    chWf.data.labels = [['Capital', 'avoided'], ['B extra', 'to Y' + p.termA], ['B after', 'Y' + p.termA], ['Net', 'edge']];
    chWf.data.datasets[0].data = [span(0, l1), span(l1, l2), span(l2, l3), span(0, gM)];
    const stepCol = v => v >= 0 ? C.peach : C.light, stepBorder = v => v >= 0 ? C.bad : C.mid;
    chWf.data.datasets[0].backgroundColor = [C.blue, stepCol(eM), stepCol(aM), gM >= 0 ? C.dark : C.bad];
    chWf.data.datasets[0].borderColor = [C.blue, stepBorder(eM), stepBorder(aM), gM >= 0 ? C.dark : C.bad];
    chWf.data.datasets[0].valueText = ['+' + cM.toFixed(2), (eM >= 0 ? '-' : '+') + Math.abs(eM).toFixed(2), (aM >= 0 ? '-' : '+') + Math.abs(aM).toFixed(2), gM.toFixed(2)];
    chWf.options.plugins.barText.levels = [l1, l2, l3];
    chWf.options.plugins.barText.colors = [C.blue, eM >= 0 ? C.bad : C.blue, aM >= 0 ? C.bad : C.blue, gM >= 0 ? C.dark : C.bad];
    chWf.update();
    $('n-wf').innerHTML = 'A avoids ' + nb(eurM(w.capital)) + ' of capital. B wins back ' + nb(eurM(w.extraInTerm)) + ' by Year ' + p.termA + ' and ' +
      nb(eurM(w.afterTerm)) + ' after, so <b>' + (gM >= 0 ? 'A' : 'B') + ' stays ' + nb(eurM(Math.abs(w.gap))) + ' ahead</b>.';

    // ----- Price chart and Year 1 bills
    const yrs = Y.slice(1);
    chPrice.data.labels = yrs.map(y => 'Y' + y.year);
    chPrice.data.datasets[0].data = yrs.map(y => y.grid);
    chPrice.data.datasets[1].data = yrs.map(y => y.tariffA);
    chPrice.data.datasets[2].data = yrs.map(y => y.runB);
    chPrice.data.datasets[3].data = yrs.map(y => (y.runB !== null && r.levB !== null ? r.levB : null));
    chPrice.update();
    const y1 = r.year1, bmax = Math.max(y1.current, y1.billA, y1.billB);
    const billRow = (lab, solar, cls, total) => '<span class="bill-l">' + lab + '</span><div class="bill-track"><div class="bill-grid" style="width:' +
      (y1.gridPart / bmax * 100).toFixed(1) + '%"></div><div class="bill-solar ' + cls + '" style="width:' + (solar / bmax * 100).toFixed(1) +
      '%"></div></div><span class="bill-v">' + eurM(total) + '</span>';
    $('bills').innerHTML = billRow('Today', y1.solarCurrent, 'now', y1.current) + billRow('A', y1.solarA, '', y1.billA) + billRow('B', y1.solarB, 'b', y1.billB) +
      '<span class="bills-cap">Year 1 bill: grid part (light) plus solar part. B leaves out its ' + eurM(p.capexB) + '.</span>';

    // ----- Cost per solar kWh
    chLev.data.datasets[0].data = [r.levA, r.levGrid, r.levBrun];
    chLev.data.datasets[1].data = [0, 0, r.levBcap];
    chLev.update();
    $('n-lev').innerHTML = 'B: ' + nb(eur3(r.levBrun)) + ' running plus ' + nb(eur3(r.levBcap)) + ' capital at ' + pct(p.discountRate) +
      ' = <b>' + nb(eur3(r.levB)) + '</b>. A: <b>' + nb(eur3(r.levA)) + '</b> all in.';

    // ----- Heat map
    const sens = R.sensitivity;
    let nowCol = -1, best = 1;
    sens.rates.forEach((rt, i) => { const d = Math.abs(rt - p.discountRate); if (d < best && d <= 0.0101) { best = d; nowCol = i; } });
    let aWins = 0, total = 0;
    let h = '<thead><tr><th class="corner">Output</th>' + sens.rates.map((rt, i) => '<th' + (i === nowCol ? ' class="now"' : '') + '>' + (rt * 100).toFixed(0) + '%</th>').join('') + '</tr></thead><tbody>';
    sens.outputs.forEach((o, ri) => {
      h += '<tr><th class="rowh">' + Math.round(o * p.outputFactor * 100) + '%</th>';
      sens.edge[ri].forEach((v, ci) => {
        total++; if (v >= 0) aWins++;
        let bg, fg;
        if (v < 0) { bg = C.peach; fg = C.bad; } else if (v > 250000) { bg = C.blue; fg = '#fff'; } else if (v > 100000) { bg = C.mid; fg = '#fff'; } else { bg = C.light; fg = C.dark; }
        h += '<td' + (ci === nowCol && o === 1 ? ' class="now" title="Current inputs"' : '') + ' style="background:' + bg + ';color:' + fg + '">' + signedK(v) + '</td>';
      });
      h += '</tr>';
    });
    $('heat').innerHTML = h + '</tbody>';
    $('n-heat').innerHTML = 'Rows: output vs plan. Columns: discount rate. A wins <b>' + aWins + ' of ' + total + '</b>; red cells mean owning wins.';

    // ----- Tipping points
    const tips = R.tipping, firstFlip = tips.find(t => t.flip !== null);
    const other = FW === 'A' ? 'owning' : 'the service';
    if (firstFlip) {
      const mv = firstFlip.fmt.startsWith('pct') ? (Math.abs(firstFlip.flip - firstFlip.now) * 100).toFixed(1) + ' points' : Math.round(Math.abs(firstFlip.flip / firstFlip.now - 1) * 100) + '%';
      $('tip-head').innerHTML = 'Closest: <b>' + firstFlip.label.toLowerCase() + ' at ' + nb(fmtTip(firstFlip.fmt, firstFlip.flip)) + '</b> makes ' + other + ' cheaper (now ' +
        nb(fmtTip(firstFlip.fmt, firstFlip.now)) + ', ' + mv + ' away). Each input moved alone.';
    } else $('tip-head').textContent = 'No single input in its range makes ' + other + ' cheaper.';
    const host = $('tips');
    host.innerHTML = tips.map(t => {
      const pos = v => ((v - t.lo) / (t.hi - t.lo) * 100).toFixed(1);
      let zone = '', meta;
      if (t.flip !== null) {
        const z0 = t.now < t.flip ? t.flip : t.lo, z1 = t.now < t.flip ? t.hi : t.flip;
        zone = '<div class="tip-zone' + (FW === 'B' ? ' a' : '') + '" style="left:' + pos(z0) + '%;width:' + (pos(z1) - pos(z0)).toFixed(1) + '%"></div><div class="tip-flip" style="left:' + pos(t.flip) + '%"></div>';
        meta = '<span class="tip-m' + (t.share < 0.15 ? ' close' : '') + '">' + fmtTip(t.fmt, t.now) + ' now, flips ' + fmtTip(t.fmt, t.flip) + '</span>';
      } else meta = '<span class="tip-m none">' + fmtTip(t.fmt, t.now) + ' now, no flip</span>';
      return '<div class="tip"><span class="tip-l" title="' + t.label + '">' + t.label + '</span>' + meta +
        '<div class="tip-track">' + zone + '<div class="tip-now" style="left:' + pos(t.now) + '%"></div></div></div>';
    }).join('');
    requestAnimationFrame(() => { while (host.children.length > 3 && host.scrollHeight > host.clientHeight + 1) host.removeChild(host.lastElementChild); });

    // ----- Scorecard
    const dots = n => '●'.repeat(n) + '○'.repeat(5 - n);
    let s = '<thead><tr><th>Criterion</th><th class="c">Weight</th><th>A</th><th>B</th></tr></thead><tbody>';
    sc.rows.forEach(row => {
      const aw = row.a > row.b, bw = row.b > row.a;
      s += '<tr><td class="lab" title="' + row.label + '">' + row.label + '</td>' +
        '<td class="c"><input type="number" min="0" max="100" step="1" data-w="' + row.key + '" value="' + state.weights[row.key] + '" aria-label="Weight for ' + row.label + '"></td>' +
        '<td class="' + (aw ? 'win' : '') + '" title="' + row.noteA + '"><span class="dots ' + (aw ? 'on' : 'off') + '">' + dots(row.a) + '</span></td>' +
        '<td class="' + (bw ? 'win' : '') + '" title="' + row.noteB + '"><span class="dots ' + (bw ? 'on' : 'off') + '">' + dots(row.b) + '</span></td></tr>';
    });
    s += '</tbody><tfoot><tr><td>Weighted score</td><td class="c">' + Math.round(sc.weightSum) + '</td><td class="tA">' + sc.totalA.toFixed(2) + '</td><td class="tB">' + sc.totalB.toFixed(2) + '</td></tr></tfoot>';
    const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.w : null;
    const wA = sc.rows.filter(x => x.a > x.b).length, wB = sc.rows.filter(x => x.b > x.a).length;
    s += '<caption>A leads on ' + wA + ' criteria, B on ' + wB + ', ' + (sc.rows.length - wA - wB) + ' tied. Hover a row to see why.</caption>';
    $('score').innerHTML = s;
    $('score').querySelectorAll('input[data-w]').forEach(inp => {
      inp.addEventListener('change', () => { const n = Number(inp.value); state.weights[inp.dataset.w] = isNaN(n) ? 0 : Math.min(100, Math.max(0, n)); schedule(); });
    });
    if (focused) { const el = $('score').querySelector('input[data-w="' + focused + '"]'); if (el) el.focus(); }

    // ----- Verdict
    $('v-main').textContent = 'Recommend ' + (REC === 'A' ? 'Option A: Solar as a Service' : 'Option B: own the plant');
    $('verdict').classList.toggle('b-wins', REC === 'B');
    let why;
    if (FW === 'A' && REC === 'A') {
      why = 'A wins on money and on risk: ' + nb(eurM(r.npvA)) + ' at ' + nb(pct(p.discountRate)) + ' with no capital, against ' + nb(eurM(r.npvB)) + ' for owning. ' +
        (r.breakEvenRate !== null && beDir === 'B' ? 'Owning only pays below a ' + nb(pct(r.breakEvenRate)) + ' discount rate.' : 'Owning does not catch up at any rate tested.');
    } else if (FW === 'B' && REC === 'A') {
      why = 'Owning is cheaper by ' + nb(eurK(-r.eaGap)) + ' a year here, but A still wins once capital and risk are weighed. Use the gap to push for a lower A tariff.';
    } else if (FW === 'B' && REC === 'B') {
      why = 'Owning wins on money and on the risk-adjusted score here. That needs cheap capital and output close to plan. Test both before committing ' + nb(eurM(p.capexB)) + '.';
    } else {
      why = 'A is better value by ' + nb(eurK(r.eaGap)) + ' a year, but the current weights favour owning. Check whether control and asset value deserve this weight.';
    }
    $('v-why').innerHTML = why;
    const needs = tips.filter(t => t.flip !== null).slice(0, 3);
    $('needs-h').textContent = needs.length ? (FW === 'A' ? 'Owning wins only if, on its own:' : 'The service wins back only if, on its own:') : 'No single input change flips the winner.';
    $('needs').innerHTML = needs.map(t => {
      const dir = t.flip < t.now ? 'falls to ' : 'rises to ';
      return '<li><b>' + t.label + '</b> ' + dir + nb(fmtTip(t.fmt, t.flip)) + '</li>';
    }).join('');
    setW('vb-a', sc.totalA / 5); setW('vb-b', sc.totalB / 5);
    $('vb-a-v').textContent = sc.totalA.toFixed(2); $('vb-b-v').textContent = sc.totalB.toFixed(2);
    $('vm-a').textContent = eurK(r.eaA) + ' a year'; $('vm-b').textContent = eurK(r.eaB) + ' a year';
    $('vf-bond').textContent = eurM(r.bondA);
    $('vf-rev').textContent = eurM(r.revenueA);
    $('vf-tariff').textContent = eur3(r.tariffEndA) + ' vs ' + eur3(Y[p.termA].grid);
    $('vf-cap').textContent = REC === 'A' ? eurM(p.capexB) : '€0.00M';

    // ----- Live verdict strip
    let presetName = null;
    Object.keys(PRESETS).forEach(k => { if (sameAs(Object.assign(clone(M.DEFAULTS), PRESETS[k].set))) presetName = PRESETS[k].name; });
    const changes = Object.keys(FIELD).filter(k => Math.abs(state[k] - M.DEFAULTS[k]) > 1e-9).length +
      (state.gridCapA !== M.DEFAULTS.gridCapA ? 1 : 0) + Object.keys(state.weights).filter(k => state.weights[k] !== M.DEFAULTS.weights[k]).length;
    $('sv-inputs').textContent = presetName || (changes + ' change' + (changes === 1 ? '' : 's') + ' from case');
    $('sv-money').textContent = (r.eaGap >= 0 ? 'A' : 'B') + ' ahead ' + eurK(Math.abs(r.eaGap)) + ' a year';
    $('sv-stress').textContent = 'A wins ' + aWins + ' of ' + total;
    $('sv-tip').textContent = firstFlip ? firstFlip.label + ' ' + fmtTip(firstFlip.fmt, firstFlip.flip) : 'None in range';
    $('sv-risk').textContent = 'A ' + sc.totalA.toFixed(2) + ' vs B ' + sc.totalB.toFixed(2);
    $('sv-rec').textContent = REC === 'A' ? 'Option A: Solar as a Service' : 'Option B: Own the plant';
    $('chev-money').classList.toggle('flag-b', r.eaGap < 0);
    $('chev-stress').classList.toggle('flag-b', aWins < total / 2);
    $('chev-tip').classList.toggle('flag-b', !!firstFlip && firstFlip.now !== 0 && Math.abs(firstFlip.flip - firstFlip.now) / Math.abs(firstFlip.now) < 0.1);
    $('chev-risk').classList.toggle('flag-b', sc.totalB > sc.totalA);
    $('chev-rec').classList.toggle('flag-b', REC === 'B');

    document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', sameAs(Object.assign(clone(M.DEFAULTS), PRESETS[c.dataset.preset].set))));
    writeURL();
  }

  function sameAs(target) {
    if (Object.keys(FIELD).some(k => Math.abs(state[k] - target[k]) > 1e-9)) return false;
    if (state.gridCapA !== target.gridCapA) return false;
    return Object.keys(target.weights).every(k => state.weights[k] === target.weights[k]);
  }

  let pending = false;
  function schedule() { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; render(); }); }

  // ---------------- Buttons ----------------
  function setPresent(on) {
    document.body.classList.toggle('present', on);
    const b = $('btn-toggle'); b.textContent = on ? 'Show inputs' : 'Hide inputs'; b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function toast(msg) { const t = $('toast'); t.textContent = msg; clearTimeout(toast.h); toast.h = setTimeout(() => { t.textContent = ''; }, 2200); }

  function wire() {
    document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => { state = Object.assign(clone(M.DEFAULTS), PRESETS[c.dataset.preset].set); schedule(); }));
    document.querySelectorAll('.seg-b').forEach(b => b.addEventListener('click', () => { view = b.dataset.view; schedule(); }));
    $('btn-reset').addEventListener('click', () => { state = clone(M.DEFAULTS); schedule(); });
    $('btn-toggle').addEventListener('click', () => {
      setPresent(!document.body.classList.contains('present')); writeURL();
      setTimeout(() => { [chValue, chWf, chPrice, chLev].forEach(ch => ch.resize()); render(); }, 60);
    });
    $('btn-link').addEventListener('click', () => {
      const url = location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => toast('Link copied'), () => toast('Copy this link: ' + url));
      else toast('Copy this link: ' + url);
    });
    let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 120); });
  }

  // ---------------- Start ----------------
  readURL();
  buildControls();
  buildCharts();
  wire();
  render();
})();
