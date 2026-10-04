/*
 * Solar Energy Investment Model
 * Shared by the browser (window.SolarModel) and the Node server (require).
 * Option A: Solar Energy as a Service. Option B: CapEx ownership.
 * Only the solar kWh differ between the options; grid power for the rest of demand is the same in both.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SolarModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Case base values (case statement plus the team's stated assumptions)
  const DEFAULTS = {
    annualSpend: 4800000,     // EUR per year, case
    gridPrice: 0.085,         // EUR per kWh today, team assumption used in the deck
    gridEscalation: 0.025,    // per year, team assumption
    demandChange: 0,          // change in site demand vs today, scenario input
    plantMW: 8,               // case
    sunnyDays: 290,           // team assumption
    sunnyHours: 10,           // full-output hours on sunny days, team assumption
    lowSunHours: 4,           // full-output hours on other days, team assumption
    outputFactor: 1,          // scales solar output for stress tests
    tariffA: 0.079,           // EUR per kWh, case
    escalationA: 0.025,       // case
    termA: 15,                // years, case
    gridCapA: true,           // contract clause: tariff never above grid
    capexB: 7600000,          // EUR, case
    runCostB: 0.061,          // EUR per kWh, case (read as running cost)
    runInflationB: 0,         // case: "operating cost inflation only"; 0 is generous to B
    lifeB: 25,                // years, case says 20 to 25
    discountRate: 0.14,       // hurdle rate for capital, team assumption
    weights: { value: 25, capital: 15, perfRisk: 15, techRisk: 10, flexibility: 10, control: 10, assetValue: 5, renewable: 10 }
  };

  const LIMITS = {
    annualSpend: [1000000, 10000000], gridPrice: [0.04, 0.2], gridEscalation: [0, 0.08], demandChange: [-0.7, 0.5],
    plantMW: [1, 15], sunnyDays: [150, 365], sunnyHours: [4, 12], lowSunHours: [0, 8], outputFactor: [0.4, 1.2],
    tariffA: [0.04, 0.15], escalationA: [0, 0.06], termA: [5, 25], capexB: [2000000, 15000000], runCostB: [0, 0.12],
    runInflationB: [0, 0.06], lifeB: [10, 30], discountRate: [0.02, 0.25]
  };

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function sanitize(raw) {
    const p = JSON.parse(JSON.stringify(DEFAULTS));
    raw = raw || {};
    Object.keys(LIMITS).forEach(k => {
      if (raw[k] !== undefined && raw[k] !== null && raw[k] !== '' && !isNaN(Number(raw[k]))) {
        p[k] = clamp(Number(raw[k]), LIMITS[k][0], LIMITS[k][1]);
      }
    });
    if (raw.gridCapA !== undefined) {
      p.gridCapA = raw.gridCapA === true || raw.gridCapA === 'true' || raw.gridCapA === 1 || raw.gridCapA === '1';
    }
    p.termA = Math.round(p.termA); p.lifeB = Math.round(p.lifeB); p.sunnyDays = Math.round(p.sunnyDays);
    if (raw.weights && typeof raw.weights === 'object') {
      Object.keys(p.weights).forEach(k => {
        if (raw.weights[k] !== undefined && !isNaN(Number(raw.weights[k]))) p.weights[k] = clamp(Number(raw.weights[k]), 0, 100);
      });
    }
    return p;
  }

  function annuityFactor(r, n) { let s = 0; for (let t = 1; t <= n; t++) s += 1 / Math.pow(1 + r, t); return s; }

  // Core financial engine for one discount rate and one output factor
  function core(p, r, outputFactor) {
    const demandToday = p.annualSpend / p.gridPrice;
    const demand = demandToday * (1 + p.demandChange);
    const fullHours = p.sunnyDays * p.sunnyHours + (365 - p.sunnyDays) * p.lowSunHours;
    const generation = p.plantMW * 1000 * fullHours * outputFactor;
    const solarUsed = Math.min(generation, demand); // kWh the site can actually use
    const horizon = Math.max(p.termA, p.lifeB);
    const grid = t => p.gridPrice * Math.pow(1 + p.gridEscalation, t - 1);
    const tariffA = t => {
      const raw = p.tariffA * Math.pow(1 + p.escalationA, t - 1);
      return p.gridCapA ? Math.min(raw, grid(t)) : raw;
    };
    const runB = t => p.runCostB * Math.pow(1 + p.runInflationB, t - 1);

    const years = [{ year: 0, grid: p.gridPrice, tariffA: null, runB: null, saveA: 0, saveB: -p.capexB, df: 1, pvA: 0, pvB: -p.capexB,
      cumA: 0, cumB: -p.capexB, dcumA: 0, dcumB: -p.capexB }];
    let npvA = 0, npvB = -p.capexB, cumA = 0, cumB = -p.capexB, dcumA = 0, dcumB = -p.capexB;
    let costPvA = 0, kwhPvA = 0, costPvB = p.capexB, runPvB = 0, kwhPvB = 0, gridPvA = 0, dfSumA = 0, pvSavBInTerm = 0, pvSavBAfter = 0;
    const cashB = [-p.capexB];
    for (let t = 1; t <= horizon; t++) {
      const df = 1 / Math.pow(1 + r, t);
      const inA = t <= p.termA, inB = t <= p.lifeB;
      const saveA = inA ? solarUsed * (grid(t) - tariffA(t)) : 0;
      // Owner pays running cost on every kWh generated, but only saves on kWh the site uses
      const saveB = inB ? solarUsed * grid(t) - generation * runB(t) : 0;
      if (inA) {
        npvA += saveA * df; costPvA += tariffA(t) * solarUsed * df; kwhPvA += solarUsed * df;
        gridPvA += grid(t) * df; dfSumA += df;
      }
      if (inB) {
        npvB += saveB * df; costPvB += generation * runB(t) * df; runPvB += generation * runB(t) * df; kwhPvB += solarUsed * df; cashB.push(saveB);
        if (t <= p.termA) pvSavBInTerm += saveB * df; else pvSavBAfter += saveB * df;
      }
      cumA += saveA; cumB += saveB; dcumA += saveA * df; dcumB += saveB * df;
      years.push({ year: t, grid: grid(t), tariffA: inA ? tariffA(t) : null, runB: inB ? runB(t) : null,
        saveA: inA ? saveA : null, saveB: inB ? saveB : null, df, pvA: inA ? saveA * df : null, pvB: inB ? saveB * df : null,
        cumA, cumB, dcumA, dcumB });
    }
    const afA = annuityFactor(r, p.termA), afB = annuityFactor(r, p.lifeB);
    return {
      demandToday, demand, fullHours, generation, solarUsed, solarShare: demand ? solarUsed / demand : 0,
      gridKwh: demand - solarUsed, unusedSolar: generation - solarUsed,
      npvA, npvB, eaA: npvA / afA, eaB: npvB / afB, afA, afB,
      levA: kwhPvA ? costPvA / kwhPvA : null, levB: kwhPvB ? costPvB / kwhPvB : null, levGrid: dfSumA ? gridPvA / dfSumA : null,
      levBrun: kwhPvB ? runPvB / kwhPvB : null, levBcap: kwhPvB ? p.capexB / kwhPvB : null, pvSavBInTerm, pvSavBAfter,
      years, cashB
    };
  }

  function npvAt(cash, r) { return cash.reduce((s, c, t) => s + c / Math.pow(1 + r, t), 0); }

  function irr(cash) {
    let lo = -0.99, hi = 1.0;
    let fLo = npvAt(cash, lo);
    const fHi = npvAt(cash, hi);
    if (fLo * fHi > 0) return null;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2, f = npvAt(cash, mid);
      if (Math.abs(f) < 1e-6) return mid;
      if (f * fLo < 0) { hi = mid; } else { lo = mid; fLo = f; }
    }
    return (lo + hi) / 2;
  }

  // Discount rate at which both options give the same yearly value
  function breakEvenRate(p) {
    const f = r => { const c = core(p, r, p.outputFactor); return c.eaA - c.eaB; };
    const pts = [];
    for (let r = 0.005; r <= 0.40001; r += 0.005) pts.push(r);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = f(pts[i]), b = f(pts[i + 1]);
      if (a === 0) return pts[i];
      if (a * b < 0) {
        let lo = pts[i], hi = pts[i + 1], fl = a;
        for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2, fm = f(m); if (fm * fl < 0) hi = m; else { lo = m; fl = fm; } }
        return (lo + hi) / 2;
      }
    }
    return null;
  }

  // How far each input must move, others held fixed, before the cheaper option changes
  const TIP_VARS = [
    { key: 'discountRate', label: 'Discount rate', fmt: 'pct' },
    { key: 'tariffA', label: 'A tariff', fmt: 'eur3' },
    { key: 'escalationA', label: 'A tariff rise', fmt: 'pct' },
    { key: 'capexB', label: 'B investment', fmt: 'eurM' },
    { key: 'runCostB', label: 'B running cost', fmt: 'eur3' },
    { key: 'outputFactor', label: 'Solar output', fmt: 'pct0' },
    { key: 'gridEscalation', label: 'Grid price rise', fmt: 'pct' }
  ];
  function tippingPoints(p) {
    return TIP_VARS.map(v => {
      const lo = LIMITS[v.key][0], hi = LIMITS[v.key][1], now = p[v.key];
      const f = x => { const q = Object.assign({}, p); q[v.key] = x; const c = core(q, q.discountRate, q.outputFactor); return c.eaA - c.eaB; };
      const fNow = f(now);
      const n = 80; let best = null;
      let prevX = lo, prevF = f(lo);
      for (let i = 1; i <= n; i++) {
        const x = lo + (hi - lo) * i / n, fx = f(x);
        if (prevF === 0 || prevF * fx < 0) {
          let a = prevX, b = x, fa = prevF;
          for (let k = 0; k < 50; k++) { const m = (a + b) / 2, fm = f(m); if (fm * fa <= 0) b = m; else { a = m; fa = fm; } }
          const root = (a + b) / 2;
          if (best === null || Math.abs(root - now) < Math.abs(best - now)) best = root;
        }
        prevX = x; prevF = fx;
      }
      return { key: v.key, label: v.label, fmt: v.fmt, now, flip: best, lo, hi, winnerNow: fNow >= 0 ? 'A' : 'B',
        share: best === null ? null : Math.abs(best - now) / (hi - lo) };
    }).sort((x, y) => (x.share === null ? 9 : x.share) - (y.share === null ? 9 : y.share));
  }

  function fmtEurM(v) { const s = Math.abs(v / 1e6).toFixed(2); return (v < 0 ? '-€' : '€') + s + 'M'; }

  function scorecard(p, base) {
    const gap = base.eaA - base.eaB; // EUR per year
    let vA = 3, vB = 3;
    if (gap > 50000) { vA = 4; vB = 2; } else if (gap < -50000) { vA = 2; vB = 4; }
    if (gap > 400000) { vA = 5; vB = 1; } else if (gap < -400000) { vA = 1; vB = 5; }
    const flexB = base.unusedSolar > 1 ? 1 : 2; // an owned plant wastes output if demand falls below it
    const rows = [
      { key: 'value', label: 'Value at hurdle', a: vA, b: vB, noteA: fmtEurM(base.npvA) + ' NPV', noteB: fmtEurM(base.npvB) + ' NPV' },
      { key: 'capital', label: 'Upfront capital', a: 5, b: 1, noteA: '€0', noteB: fmtEurM(p.capexB) },
      { key: 'perfRisk', label: 'Output risk', a: 4, b: 2, noteA: 'Provider, guaranteed', noteB: 'Company' },
      { key: 'techRisk', label: 'Tech and upkeep', a: 4, b: 2, noteA: 'Provider', noteB: 'Company' },
      { key: 'flexibility', label: 'Volume flexibility', a: 4, b: flexB, noteA: 'Pay per kWh', noteB: flexB === 1 ? 'Output wasted' : 'Capital locked' },
      { key: 'control', label: 'Design control', a: 3, b: 5, noteA: 'Approval rights', noteB: 'Full control' },
      { key: 'assetValue', label: 'Asset value', a: 2, b: 5, noteA: 'Buy-out Year 10', noteB: 'Keeps plant' },
      { key: 'renewable', label: 'Renewable claim', a: 4, b: 4, noteA: 'RECs ours', noteB: 'Direct' }
    ];
    const wSum = rows.reduce((s, r) => s + (p.weights[r.key] || 0), 0) || 1;
    let totA = 0, totB = 0;
    rows.forEach(r => { r.weight = (p.weights[r.key] || 0) / wSum; totA += r.weight * r.a; totB += r.weight * r.b; });
    return { rows, totalA: totA, totalB: totB, weightSum: wSum };
  }

  function calculate(raw) {
    const p = sanitize(raw);
    const base = core(p, p.discountRate, p.outputFactor);
    const irrB = irr(base.cashB);
    let payback = null;
    { let c = 0; for (let t = 0; t < base.cashB.length; t++) { c += base.cashB[t]; if (t > 0 && c >= 0) { payback = t; break; } } }
    const be = breakEvenRate(p);
    const rates = [0.06, 0.08, 0.10, 0.12, 0.14, 0.16];
    const outputs = [1.1, 1.0, 0.8, 0.6];
    const edge = outputs.map(o => rates.map(r => { const c = core(p, r, p.outputFactor * o); return c.eaA - c.eaB; }));
    const sc = scorecard(p, base);
    const y1 = base.years[1];
    const y1TariffA = y1 && y1.tariffA !== null ? y1.tariffA : 0;
    let revenueA = 0; base.years.forEach(y => { if (y.year >= 1 && y.tariffA !== null) revenueA += y.tariffA * base.solarUsed; });
    const tEnd = base.years[p.termA];
    return {
      inputs: p,
      energy: { demandToday: base.demandToday, demand: base.demand, generation: base.generation, solarUsed: base.solarUsed,
        solarShare: base.solarShare, gridKwh: base.gridKwh, unusedSolar: base.unusedSolar, fullHours: base.fullHours },
      results: {
        npvA: base.npvA, npvB: base.npvB, npvGap: base.npvA - base.npvB, eaA: base.eaA, eaB: base.eaB, eaGap: base.eaA - base.eaB,
        levA: base.levA, levB: base.levB, levGrid: base.levGrid, levBrun: base.levBrun, levBcap: base.levBcap, irrB, paybackB: payback, breakEvenRate: be,
        waterfall: { capital: p.capexB, extraInTerm: base.pvSavBInTerm - base.npvA, afterTerm: base.pvSavBAfter, gap: base.npvA - base.npvB },
        saveY1A: base.years[1] ? base.years[1].saveA || 0 : 0, saveY1B: base.years[1] ? base.years[1].saveB || 0 : 0,
        bondA: base.solarUsed * y1TariffA, revenueA, tariffEndA: tEnd ? tEnd.tariffA : null,
        year1: {
          current: base.demand * p.gridPrice,
          billA: base.solarUsed * y1TariffA + base.gridKwh * p.gridPrice,
          billB: base.generation * p.runCostB + base.gridKwh * p.gridPrice,
          gridPart: base.gridKwh * p.gridPrice, solarCurrent: base.solarUsed * p.gridPrice,
          solarA: base.solarUsed * y1TariffA, solarB: base.generation * p.runCostB
        }
      },
      years: base.years,
      sensitivity: { rates, outputs, edge },
      tipping: tippingPoints(p),
      scorecard: sc,
      verdict: { financialWinner: base.eaA >= base.eaB ? 'A' : 'B', recommended: sc.totalA >= sc.totalB ? 'A' : 'B' }
    };
  }

  return { DEFAULTS, LIMITS, calculate, sanitize };
});
