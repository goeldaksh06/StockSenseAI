import { h, mount } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { pct, num, isNum, signedPct, tone } from '../../core/format.js';
import { panel, kv } from '../../core/research.js';
import { term } from '../../components/explain.js';
import { segmented } from '../../components/table.js';
import { lineChart } from '../../components/chart.js';
import { barChart } from '../../components/columns.js';

export async function render(root, ctx) {
  const { symbol } = ctx;
  let years = 3, bench = '';
  const body = h('div', {});
  const benchInput = h('input', { placeholder: 'auto', style: 'width:110px;font-family:var(--font-mono);text-transform:uppercase', 'aria-label': 'Benchmark ticker' });

  async function load() {
    mount(body, h('div', { class: 'state' }, 'Computing risk statistics...'));
    let d;
    try { d = await api.riskReport(symbol, bench, years); } catch (e) { mount(body, h('div', { class: 'state err' }, e.message)); return; }
    const s = d.stats;
    const vb = d.series.vs_benchmark;
    const periods = Object.entries(d.returns);
    mount(body,
      kv([
        [term('Annualised return', 'ann_return'), signedPct(s.annualized_return_pct, 1), tone(s.annualized_return_pct)],
        [term('Volatility', 'volatility'), pct(s.annualized_volatility_pct, 1)],
        [term('Sharpe', 'sharpe'), num(s.sharpe, 2)],
        [term('Max drawdown', 'drawdown'), pct(s.max_drawdown_pct, 1), 'down'],
        [term('Beta', 'beta') , isNum(s.beta) ? `${num(s.beta, 2)} vs ${d.benchmark}` : '-'],
        [term('Correlation', 'correlation'), isNum(s.correlation) ? num(s.correlation, 2) : '-'],
        [term('Alpha (annual)', 'alpha'), isNum(s.alpha_annual_pct) ? signedPct(s.alpha_annual_pct, 1) : '-', tone(s.alpha_annual_pct)],
        [term('VaR 95% (1 day)', 'var'), pct(s.var95_1d_pct, 2)],
        ['CVaR 95% (1 day)', pct(s.cvar95_1d_pct, 2)],
        ['Positive days', pct(s.positive_days_pct, 1)],
        ['Best day', `${signedPct(s.best_day.pct, 1)} (${s.best_day.date})`, 'up'],
        ['Worst day', `${signedPct(s.worst_day.pct, 1)} (${s.worst_day.date})`, 'down'],
      ], 4),
      h('p', { class: 'muted', style: 'font-size:.78rem;margin:8px 0 0' }, `Daily returns over ${d.window_years} years, benchmark ${d.benchmark}, risk-free rate taken as 0% in Sharpe. Past risk is not a guarantee of future risk.`),
      h('div', { class: 'two', style: 'margin-top:14px' },
        panel(`Performance vs ${d.benchmark} (rebased to 100)`, vb ? lineChart({
          series: [{ name: symbol, color: 'ink', dates: vb.dates, values: vb.asset }, { name: d.benchmark, color: 'accent', dates: vb.dates, values: vb.benchmark, dash: true }],
          yFormat: (v) => v.toFixed(0), label: 'Performance vs benchmark', baseline: 100 }) : h('p', { class: 'state' }, 'Benchmark data unavailable.')),
        panel('Drawdown from peak', lineChart({ series: [{ name: 'Drawdown', color: 'down', dates: d.series.drawdown.dates, values: d.series.drawdown.values }], yFormat: (v) => v.toFixed(0) + '%', label: 'Drawdown', baseline: 0 }))),
      h('div', { class: 'two' },
        panel('Rolling 60-day volatility (annualised)', lineChart({ series: [{ name: 'Volatility', color: 'warn', dates: d.series.vol.dates, values: d.series.vol.values }], yFormat: (v) => v.toFixed(0) + '%', label: 'Rolling volatility' })),
        panel('Distribution of daily returns', barChart({
          bars: d.histogram.counts.map((c, i) => ({ label: ((d.histogram.edges[i] + d.histogram.edges[i + 1]) / 2).toFixed(1) + '%', value: c, tone: d.histogram.edges[i] + d.histogram.edges[i + 1] < 0 ? 'down' : 'up' })),
          height: 200, format: (v) => String(Math.round(v)), maxLabels: 6, label: 'Histogram of daily returns' }),
        h('p', { class: 'muted', style: 'font-size:.75rem' }, 'Tails beyond the 1st/99th percentile are grouped into the end bars.'))),
      panel('Trailing returns', barChart({ bars: periods.map(([k, v]) => ({ label: k, value: v })), height: 190, format: (v) => v.toFixed(0) + '%', label: 'Trailing returns' })));
    ctx.setContext('risk', { window_years: d.window_years, benchmark: d.benchmark, stats: s, trailing_returns_pct: d.returns });
  }

  mount(root,
    h('div', { class: 'toolbar', style: 'padding-top:0' },
      h('div', { class: 'field' }, 'Window', segmented([1, 3, 5].map((v) => ({ label: v + 'Y', value: v })), years, (v) => { years = v; load(); }, 'Window')),
      h('label', { class: 'field' }, 'Benchmark', benchInput),
      h('button', { class: 'btn small', type: 'button', onclick: () => { bench = benchInput.value.trim().toUpperCase(); load(); } }, 'Apply')),
    body);
  await load();
}
