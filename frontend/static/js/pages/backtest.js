import { $, h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { money, pct, num, signedPct, tone } from '../core/format.js';
import { progress, errorBox } from '../core/ui.js';
import { symbolBar } from '../components/symbolBar.js';
import { segmented } from '../components/table.js';
import { lineChart } from '../components/chart.js';
import { term, explainBox } from '../components/explain.js';
import { setPageContext, round } from '../core/pageContext.js';

const out = $('#out');
let runId = 0;
let variant = 'direction';

const capital = h('input', { type: 'number', min: 100, step: 100, value: 10000, style: 'width:110px' });
const cost = h('input', { type: 'number', min: 0, max: 5, step: 0.05, value: 0.1, style: 'width:80px' });
const extra = [
  h('div', { class: 'field' }, 'Signal', segmented(
    [{ label: 'Direction', value: 'direction' }, { label: 'Return', value: 'return' }, { label: 'Price', value: 'price' }],
    variant, (v) => { variant = v; }, 'Signal model')),
  h('label', { class: 'field' }, 'Capital ($)', capital),
  h('label', { class: 'field' }, 'Cost per trade (%)', cost),
];
const bar = symbolBar({ initial: 'AAPL', onSubmit: load, extra, submitLabel: 'Run backtest' });
$('#bar').append(bar.el);

async function load(symbol) {
  const id = ++runId;
  const cap = Math.max(100, Number(capital.value) || 10000);
  const c = Math.min(5, Math.max(0, Number(cost.value) || 0)) / 100;
  const wait = progress(`Training and simulating ${symbol} (about 10 to 40s)...`);
  mount(out, wait);
  try {
    const d = await api.backtest(symbol, { variant, capital: cap, cost: c });
    if (id !== runId) return;
    wait.stop();
    render(symbol, d, cap);
  } catch (e) {
    if (id !== runId) return;
    wait.stop();
    mount(out, errorBox(e, () => load(symbol)));
  }
}

function tile(label, key, a, b, fmt, higherBetter = true) {
  const better = higherBetter ? a > b : a < b;
  return h('div', {}, h('dt', {}, term(label, key)),
    h('dd', { class: better ? 'up' : '' }, fmt(a), h('small', {}, ` vs ${fmt(b)}`)));
}

function render(symbol, d, cap) {
  const st = d.strategy, bh = d.buy_and_hold, cv = d.curve;
  const chart = lineChart({
    series: [
      { name: 'Signal strategy', color: 'accent', dates: cv.dates, values: cv.strategy },
      { name: 'Buy and hold', color: 'ink', dates: cv.dates, values: cv.buy_and_hold, dash: true },
    ],
    baseline: cap, yFormat: (v) => '$' + Math.round(v).toLocaleString('en-US'), label: 'Equity curve',
  });
  const lost = st.total_return_pct < bh.total_return_pct;
  const pack = (x) => ({ total_return_pct: round(x.total_return_pct), sharpe: round(x.sharpe_ratio), max_drawdown_pct: round(x.max_drawdown_pct), win_rate_days_held_pct: round(x.win_rate_pct, 1), time_invested_pct: round(x.pct_time_invested, 1) });
  setPageContext({ page: 'backtest', symbol, data: { signal_model: variant, test_period: d.test_period, starting_capital_usd: cap, strategy: pack(st), buy_and_hold: pack(bh) } });
  mount(out,
    explainBox('How to read this', [
      'Each tile shows the signal strategy first, then buy and hold (just owning the stock the whole time) after "vs". Green marks the better one.',
      'The chart shows what the starting money would have grown to. The dashed line is buy and hold; the dotted line is your starting capital.',
    ]),
    h('p', { style: 'margin-top:20px' },
      h('strong', {}, lost ? 'The signal underperformed buy and hold.' : 'The signal beat buy and hold in this window.'),
      h('span', { class: 'muted' }, ` ${d.test_period.start} to ${d.test_period.end}, ${d.test_period.n_days} trading days. The first figure is the strategy, the second is buy and hold.`)),
    h('dl', { class: 'kv' },
      tile('Total return', 'total_return', st.total_return_pct, bh.total_return_pct, (v) => signedPct(v, 1)),
      tile('Sharpe ratio', 'sharpe', st.sharpe_ratio, bh.sharpe_ratio, (v) => num(v, 2)),
      tile('Max drawdown', 'drawdown', st.max_drawdown_pct, bh.max_drawdown_pct, (v) => pct(v, 1), true),
      tile('Win rate (days held)', 'winrate', st.win_rate_pct, bh.win_rate_pct, (v) => pct(v, 0)),
      h('div', {}, h('dt', {}, term('Time invested', 'invested')), h('dd', {}, pct(st.pct_time_invested, 1), h('small', {}, ' vs 100%')))),
    h('section', { class: 'panel' }, h('h3', {}, `Growth of ${money(cap)}`), chart),
    st.pct_time_invested < 15 && h('p', { class: 'muted prose' },
      `The ${variant} model was invested only ${pct(st.pct_time_invested, 1)} of the time, so its return says little about skill. Win rate here counts only days the strategy held the stock.`),
    h('p', { class: 'muted', style: 'font-size:.78rem' }, `Total return ${tone(st.total_return_pct) === 'up' ? 'positive' : 'not positive'} for the signal. Costs and sizing are inputs; slippage and taxes are not modelled.`));
}
