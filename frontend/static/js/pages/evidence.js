import { $, h, mount, s } from '../core/dom.js';
import { api } from '../core/api.js';
import { pct, num, isNum } from '../core/format.js';
import { panel, kv } from '../core/research.js';
import { downloadCsv } from '../core/csv.js';
import { errorBox } from '../core/ui.js';
import { setPageContext } from '../core/pageContext.js';
import { term, explainBox } from '../components/explain.js';
import { dataTable, segmented } from '../components/table.js';

const out = $('#out');

const ci = (lo, hi, f) => `${f(lo)} to ${f(hi)}`;
const p1 = (v) => pct(v * 100, 1);
const pp = (v) => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + ' pts';

function calibrationChart(bins) {
  const W = 360, H = 300, M = 40;
  const x = (v) => M + v * (W - 2 * M), y = (v) => H - M - v * (H - 2 * M);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Calibration: predicted probability vs actual frequency of up days', style: 'max-width:420px' });
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    svg.append(
      s('line', { x1: M, x2: W - M, y1: y(t), y2: y(t), style: 'stroke:var(--rule)' }),
      s('text', { x: M - 6, y: y(t) + 4, 'text-anchor': 'end', style: 'fill:var(--ink-3);font:10px var(--font-mono)' }, (t * 100).toFixed(0) + '%'),
      s('text', { x: x(t), y: H - M + 16, 'text-anchor': 'middle', style: 'fill:var(--ink-3);font:10px var(--font-mono)' }, (t * 100).toFixed(0) + '%'));
  }
  svg.append(
    s('line', { x1: x(0), y1: y(0), x2: x(1), y2: y(1), style: 'stroke:var(--ink-3);stroke-dasharray:4 4' }),
    s('text', { x: W / 2, y: H - 6, 'text-anchor': 'middle', style: 'fill:var(--ink-2);font:11px var(--font-sans)' }, 'Model said (probability of up)'),
    s('text', { x: 12, y: H / 2, transform: `rotate(-90 12 ${H / 2})`, 'text-anchor': 'middle', style: 'fill:var(--ink-2);font:11px var(--font-sans)' }, 'Actually went up'));
  const maxN = Math.max(...bins.map((b) => b.n));
  const pts = bins.filter((b) => b.n >= 20);
  svg.append(s('polyline', { points: pts.map((b) => `${x(b.mean_pred)},${y(b.actual_up)}`).join(' '), fill: 'none', style: 'stroke:var(--accent);stroke-width:1.5' }));
  for (const b of pts) {
    const dot = s('circle', { cx: x(b.mean_pred), cy: y(b.actual_up), r: 3 + (b.n / maxN) * 6, style: 'fill:var(--accent);opacity:.8' });
    dot.append(s('title', {}, `Model said ${(b.mean_pred * 100).toFixed(0)}% | actually up ${(b.actual_up * 100).toFixed(0)}% | ${b.n} days`));
    svg.append(dot);
  }
  return svg;
}

async function load() {
  let d;
  try { d = await api.evidence(); } catch (e) { mount(out, e.status === 404 ? h('div', { class: 'state' }, e.message) : errorBox(e, load)); return; }
  let set = 'price';
  const body = h('div', {});
  mount(out, body);

  const draw = () => {
    const a = d.aggregate[set];
    const [elo, ehi] = a.edge_ci95;
    const verdict = a.n_tickers < 10
      ? `Only ${a.n_tickers} stocks have been tested, which is too few for a meaningful interval. Rerun the walk-forward job on a wider basket before drawing conclusions.`
      : ehi < 0
      ? `Across ${a.n_tickers} stocks the model was right less often than simply assuming "up" every day. The gap is outside the margin of error.`
      : elo > 0
        ? `Across ${a.n_tickers} stocks the model beat "always up", and the gap is outside the margin of error.`
        : `Across ${a.n_tickers} stocks the model's edge over "always up" is statistically indistinguishable from zero.`;
    const test = Object.values(d.tickers).reduce((n, t) => n + t[set].n_test_days, 0);

    mount(body,
      explainBox('Verdict', [
        verdict,
        `Average direction accuracy ${p1(a.mean_accuracy)} against ${p1(a.mean_always_up_accuracy)} for always-up (edge ${pp(a.mean_edge_vs_always_up)}, 95% interval ${ci(elo * 100, ehi * 100, (v) => (v >= 0 ? '+' : '') + v.toFixed(1))} pts). It beat always-up on ${a.tickers_beating_always_up} of ${a.n_tickers} stocks.`,
        isNum(a.mean_auc) ? `Its ranking skill (AUC) averaged ${a.mean_auc.toFixed(3)}, where 0.5 means none. Its probabilities were ${a.mean_brier_skill < 0 ? 'worse than just quoting the stock\'s historical up-frequency (negative Brier skill): they are overconfident' : 'better than quoting the base rate'}.` : '',
      ].filter(Boolean), {
        title: 'How was this tested?',
        items: [
          `Expanding-window walk-forward: train on all history up to a date, predict the next ${d.method.retrain_every_days} trading days, then repeat. Each prediction is made only with data that existed at the time. About ${test.toLocaleString()} out-of-sample predictions in total.`,
          'The "always up" benchmark scores whatever share of days the stock rose. It is the honest baseline because most stocks rise on more than half of days.',
          'Intervals are bootstrap 95% intervals across stocks. Stocks in the same market are correlated, so treat them as optimistic (the real uncertainty is larger).',
          `Costs: ${(d.method.cost_per_switch * 100).toFixed(1)}% per position switch. Tickers: ${d.tickers.map((t) => t.symbol).join(', ')}.`,
        ],
      }),
      h('div', { class: 'toolbar', style: 'padding-top:0' },
        h('div', { class: 'field' }, 'Feature set', segmented([{ label: 'Price only (21 features)', value: 'price' }, { label: 'Price + market (26)', value: 'price+market' }], set, (v) => { set = v; draw(); }, 'Feature set')),
        h('p', { class: 'muted', style: 'font-size:.8rem;margin:0;align-self:center' }, 'The market set adds index momentum, relative strength and a volatility index.')),
      kv([
        ['Stocks tested', String(a.n_tickers)],
        [term('Accuracy edge vs always-up', 'edge'), pp(a.mean_edge_vs_always_up), a.mean_edge_vs_always_up > 0 ? 'up' : 'down'],
        [term('AUC', 'auc'), a.mean_auc.toFixed(3), a.mean_auc > 0.52 ? 'up' : ''],
        [term('Brier skill', 'brier'), num(a.mean_brier_skill, 2), a.mean_brier_skill > 0 ? 'up' : 'down'],
      ], 4),
      h('div', { class: 'two', style: 'margin-top:16px' },
        panel('Calibration: does "70% up" mean 70%?', calibrationChart(d.calibration[set]),
          h('p', { class: 'muted', style: 'font-size:.78rem' }, 'Points on the dashed diagonal would mean trustworthy probabilities. A flat line means the model\'s confidence carries little information. Dot size is the number of predictions.')),
        panel('If you traded the signal',
          h('div', { class: 'scroll-x' }, h('table', { class: 'data' },
            h('thead', {}, h('tr', {}, ...['Threshold', 'Signal Sharpe', 'Buy-hold Sharpe', 'Difference', 'Invested', 'Beat buy-hold'].map((x) => h('th', {}, x)))),
            h('tbody', {}, ...Object.entries(a.sim).map(([th, r]) => h('tr', {},
              h('td', {}, `p(up) > ${th}`), h('td', { class: 'num' }, num(r.mean_strategy_sharpe, 2)), h('td', { class: 'num' }, num(r.mean_buyhold_sharpe, 2)),
              h('td', { class: 'num ' + (r.mean_sharpe_diff >= 0 ? 'up' : 'down') }, `${num(r.mean_sharpe_diff, 2)} [${r.sharpe_diff_ci95.map((v) => v.toFixed(2)).join(', ')}]`),
              h('td', { class: 'num' }, pct(r.mean_pct_invested, 0)), h('td', { class: 'num' }, `${r.tickers_strategy_beats_buyhold_return}/${a.n_tickers}`)))))),
          h('p', { class: 'muted', style: 'font-size:.78rem' }, `Long-only, after ${(d.method.cost_per_switch * 100).toFixed(1)}% costs per switch. Brackets are 95% intervals for the Sharpe difference.`))),
      panel('Every stock tested', dataTable([
        { key: 'symbol', label: 'Ticker', cls: 'mono' },
        { key: 'acc', label: 'Accuracy', fmt: (v) => p1(v) },
        { key: 'up', label: 'Always-up', fmt: (v) => p1(v) },
        { key: 'edge', label: 'Edge', fmt: (v) => h('span', { class: v >= 0 ? 'up' : 'down' }, pp(v)) },
        { key: 'auc', label: term('AUC', 'auc'), fmt: (v) => num(v, 3) },
        { key: 'skill', label: term('Brier skill', 'brier'), fmt: (v) => num(v, 2) },
        { key: 'sh', label: 'Signal Sharpe', fmt: (v) => num(v, 2) },
        { key: 'bh', label: 'Buy-hold Sharpe', fmt: (v) => num(v, 2) },
      ], d.tickers.map((t) => ({ symbol: t.symbol, acc: t[set].accuracy, up: t[set].always_up_accuracy, edge: t[set].edge_vs_always_up, auc: t[set].auc, skill: t[set].brier_skill, sh: t[set].sim['0.55'].strategy.sharpe, bh: t[set].sim['0.55'].buy_hold.sharpe })), { sortKey: 'edge', dir: -1 }),
      h('button', { class: 'btn ghost small', type: 'button', style: 'margin-top:10px', onclick: () => downloadCsv('walkforward_by_ticker.csv',
        ['Ticker', 'Accuracy', 'AlwaysUp', 'Edge', 'AUC', 'BrierSkill'], d.tickers.map((t) => [t.symbol, t[set].accuracy, t[set].always_up_accuracy, t[set].edge_vs_always_up, t[set].auc, t[set].brier_skill])) }, 'Export CSV')),
      h('p', { class: 'muted', style: 'font-size:.78rem' }, `Generated ${d.generated_at.slice(0, 10)}. Rerun with: python -m backend.ml.walkforward. ${d.failed.length ? `${d.failed.length} tickers failed to download: ${d.failed.map((f) => f.symbol).join(', ')}.` : ''}`));

    setPageContext({ page: 'evidence', symbol: '', data: {
      feature_set: set, n_stocks: a.n_tickers,
      mean_accuracy_pct: +(a.mean_accuracy * 100).toFixed(1), mean_always_up_accuracy_pct: +(a.mean_always_up_accuracy * 100).toFixed(1),
      edge_points: +(a.mean_edge_vs_always_up * 100).toFixed(2), edge_ci95_points: a.edge_ci95.map((v) => +(v * 100).toFixed(2)),
      stocks_beating_always_up: a.tickers_beating_always_up, mean_auc: +a.mean_auc.toFixed(3), mean_brier_skill: +a.mean_brier_skill.toFixed(2),
      trading_sim: a.sim, method: d.method,
    } });
  };
  draw();
}

load();
