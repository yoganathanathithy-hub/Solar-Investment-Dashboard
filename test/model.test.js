// Checks that the dashboard model reproduces the numbers in the presentation deck.
const assert = require('assert');
const M = require('../shared/model.js');

const r = M.calculate({});
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b}`);

near(r.energy.generation, 25.6e6, 1, 'Solar output (kWh)');
near(r.energy.solarShare, 0.4533, 0.001, 'Solar share of demand');
near(r.results.npvA, 1064646, 1000, 'NPV Option A');
near(r.results.npvB, -736697, 1000, 'NPV Option B');
near(r.results.eaA, 173334, 500, 'Yearly value A');
near(r.results.eaB, -107188, 500, 'Yearly value B');
near(r.results.irrB, 0.12798, 0.0005, 'Return on B');
assert.strictEqual(r.results.paybackB, 9, 'Cash payback B (year)');
near(r.results.levA, 0.08915, 0.0002, 'Cost per solar kWh A');
near(r.results.levB, 0.10419, 0.0002, 'Cost per solar kWh B');
near(r.results.levGrid, 0.09592, 0.0002, 'Grid cost per kWh over A term');
near(r.results.breakEvenRate, 0.1084, 0.001, 'Break-even discount rate');
near(r.scorecard.totalA, 3.95, 0.001, 'Weighted score A');
near(r.scorecard.totalB, 2.50, 0.001, 'Weighted score B');
near(r.sensitivity.edge[1][4], 281000, 1500, 'Edge at 14%, 100% output');
near(r.sensitivity.edge[3][1], 134000, 1500, 'Edge at 8%, 60% output');
near(r.sensitivity.edge[1][1], -252000, 1500, 'Edge at 8%, 100% output');
assert.strictEqual(r.verdict.financialWinner, 'A');
assert.strictEqual(r.verdict.recommended, 'A');

// Stress: B with 2.5% running-cost inflation (deck appendix: -2.63M)
near(M.calculate({ runInflationB: 0.025 }).results.npvB, -2631699, 2000, 'B with running-cost inflation');
// Stress: 80% output (deck appendix: B -2.11M, A +0.85M)
const o80 = M.calculate({ outputFactor: 0.8 });
near(o80.results.npvB, -2110000, 10000, 'B at 80% output');
near(o80.results.npvA, 850000, 10000, 'A at 80% output');

const w = r.results.waterfall;
near(w.capital - w.extraInTerm - w.afterTerm, w.gap, 1, 'Waterfall adds up');
near(w.extraInTerm, 4426000, 5000, 'B extra savings Years 1 to 15');
near(w.afterTerm, 1372000, 5000, 'B savings after Year 15');
near(r.results.levBrun + r.results.levBcap, r.results.levB, 1e-9, 'Cost split adds up');
near(r.results.levBcap, 0.0432, 0.0005, 'Capital charge per kWh');
near(r.tipping.find(t => t.key === 'discountRate').flip, 0.1084, 0.001, 'Tipping point on discount rate');
console.log('All model checks match the deck.');
