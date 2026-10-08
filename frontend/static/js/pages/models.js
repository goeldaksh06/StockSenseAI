import { $, h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { money, pct, num, isNum } from '../core/format.js';
import { progress, errorBox } from '../core/ui.js';
import { symbolBar } from '../components/symbolBar.js';
import { dataTable, segmented } from '../components/table.js';
import { barList } from '../components/chart.js';
import { term, explainBox } from '../components/explain.js';
import { setPageContext, round } from '../core/pageContext.js';

const out = $('#out');
let runId = 0;
const bar = symbolBar({ initial: document.body.dataset.symbol || 'AAPL', onSubmit: load, submitLabel: 'Evaluate' });
$('#bar').append(bar.el);

const LABELS = {
  previous_close: 'Previous close (baseline)',
  moving_average: 'Moving average (20d)',
  linear_regression: 'Linear regression',
  xgboost_price_target: 'XGBoost, price target',
  xgboost_return_target: 'XGBoost, return target',
  xgboost_direction_target: 'XGBoost, direction classifier',
  always_up: 'Always say "up" (baseline)',
};

async function load(symbol) {
  const id = ++runId;
  history.replaceState(null, '', '/models?symbol=' + symbol);
  const wait = progress(`Training models on ${symbol} (about 10 to 40s)...`);
  mount(out, wait);
  try {
    const d = await api.modelCompare(symbol);
    if (id !== runId) return;
    wait.stop();
    render(symbol, d);
  } catch (e) {
    if (id !== runId) return;
    wait.stop();
    mount(out, errorBox(e, () => load(symbol)));
  }
}

function render(symbol, d) {
  const models = { ...d.price_target.models, ...(d.fixed_targets.models || {}) };
  delete models.xgboost; // same model as xgboost_price_target, listed twice by the API
  const rows = Object.entries(models).map(([key, m]) => ({
    key, name: LABELS[key] || key,
    mae: m.mae, rmse: m.rmse, mape: m.mape, r2: m.r2,
    dir: key === 'previous_close' ? null : m.directional_accuracy,
    isBaseline: key === 'previous_close' || key === 'always_up',
    isPriceBase: key === 'previous_close',
  }));
  const base = rows.find((r) => r.isPriceBase);
  const upBase = rows.find((r) => r.key === 'always_up');
  const nDays = d.fixed_targets.test_period?.n_days || d.price_target.test_period?.n_days;
  const dirModel = rows.find((r) => r.key === 'xgboost_direction_target');
  const tp = d.price_target.test_period;

  let metric = 'dir';
  const chartSlot = h('div', {});
  const drawChart = () => {
    if (metric === 'dir') {
      mount(chartSlot, barList({
        rows: rows.filter((r) => isNum(r.dir)).map((r) => ({ label: r.name, value: r.dir * 100, tone: r.dir > 0.5 ? 'up' : 'down' })),
        max: 100, reference: 50, referenceLabel: '50% = coin flip', format: (v) => pct(v, 1),
      }));
    } else {
      mount(chartSlot, barList({
        rows: rows.filter((r) => isNum(r.mae) && !r.key.includes('direction')).map((r) => ({ label: r.name, value: r.mae, tone: r.isBaseline ? 'accent' : r.mae <= base.mae ? 'up' : 'down' })),
        reference: base.mae, referenceLabel: 'baseline error (lower is better)', format: (v) => '$' + num(v, 2),
      }));
    }
  };
  drawChart();

  const beating = rows.filter((r) => !r.isBaseline && isNum(r.mae) && r.mae < base.mae).map((r) => r.name);
  const ci = nDays ? 1.96 * Math.sqrt(0.25 / nDays) * 100 : null;
  const dirPct = dirModel ? dirModel.dir * 100 : null;
  const upPct = upBase ? upBase.dir * 100 : null;
  const sig = ci != null && dirPct != null && Math.abs(dirPct - 50) < ci;

  const plain = [
    beating.length
      ? `On price error, ${beating.join(' and ')} beat the do-nothing baseline.`
      : 'On price error, no model beat the do-nothing baseline (guessing that tomorrow closes where today did).',
    dirPct != null && `On direction, the classifier was right ${pct(dirPct, 1)} of ${nDays} test days. A coin flip gets 50%${upPct != null ? `, and simply saying "up" every day would have got ${pct(upPct, 1)} because ${symbol} rose on that share of days` : ''}.`,
    ci != null && sig && `With only ${nDays} days, the margin of error is about +/-${num(ci, 1)} points, so ${pct(dirPct, 1)} cannot be told apart from a coin flip. It is not evidence the model is bad or good.`,
  ].filter(Boolean);

  setPageContext({ page: 'models', symbol, data: { test_period: tp, test_days: nDays, margin_of_error_points: ci && round(ci, 1), models: rows.map((r) => ({ model: r.name, is_baseline: r.isBaseline, mae_usd: round(r.mae), rmse_usd: round(r.rmse), mape_pct: round(r.mape), r2: round(r.r2, 3), direction_accuracy_pct: isNum(r.dir) ? round(r.dir * 100, 1) : null })) } });
  mount(out,
    explainBox(`What you are looking at: ${symbol}, ${tp.start} to ${tp.end}`, plain, {
      title: 'Why is accuracy so low?',
      items: [
        'Daily price moves are mostly noise. Everything the model sees (past prices, moving averages, RSI) is already known to every trader, so it is largely priced in. Professional funds with far more data typically find edges of one or two percentage points, not twenty.',
        'Only 21 inputs, all derived from the same price series, so they are highly redundant. The trees are deep (depth 6) and fit on a few thousand noisy days, which makes them good at memorising the past and poor at the future.',
        'One stock, one test window. A strong uptrend such as this one makes "always up" look good and punishes models that sometimes say "down".',
        'Honest results look like this. A model showing 70% direction accuracy on stock data has usually leaked future information into training.',
      ],
    }),
    h('section', { class: 'panel' },
      h('h3', {}, 'Scoreboard ', h('span', { class: 'muted', style: 'font:.75rem var(--font-mono)' }, 'hover a column name for its meaning; click to sort')),
      dataTable([
        { key: 'name', label: 'Model', cls: '' },
        { key: 'mae', label: term('MAE', 'mae'), fmt: (v) => (isNum(v) ? money(v) : '-') },
        { key: 'rmse', label: term('RMSE', 'rmse'), fmt: (v) => (isNum(v) ? money(v) : '-') },
        { key: 'mape', label: term('MAPE', 'mape'), fmt: (v) => (isNum(v) ? pct(v, 2) : '-') },
        { key: 'r2', label: term('R2', 'r2'), fmt: (v) => (isNum(v) ? num(v, 3) : '-') },
        { key: 'dir', label: term('Direction', 'direction'), fmt: (v, r) => (r.key === 'previous_close' ? 'n/a' : pct(v * 100, 1)) },
      ], rows, { best: (r) => r.isBaseline })),
    h('p', { class: 'muted', style: 'font-size:.8rem' }, 'Shaded rows are baselines the models must beat: ', term('previous close', 'baseline'), ' (for price) and ', term('always up', 'always_up'), ' (for direction).'),
    h('section', { class: 'panel' },
      h('h3', {}, 'Compare visually',
        segmented([{ label: 'Direction accuracy', value: 'dir' }, { label: 'Price error', value: 'mae' }], metric, (v) => { metric = v; drawChart(); }, 'Metric')),
      chartSlot));
}

const q = new URLSearchParams(location.search).get('symbol');
if (q) bar.go(q);
