import { $, h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { cleanSymbol, compact, fmtKind, isNum, pct, num, signedPct } from '../core/format.js';
import { metricMap, panel } from '../core/research.js';
import { downloadCsv } from '../core/csv.js';
import { errorBox } from '../core/ui.js';
import { setPageContext } from '../core/pageContext.js';
import { tickerSearch } from '../components/tickerSearch.js';
import { segmented } from '../components/table.js';
import { lineChart } from '../components/chart.js';

const COLORS = ['ink', 'accent', 'up', 'warn', 'down', 'ink-3'];
const out = $('#out');
let symbols = (new URLSearchParams(location.search).get('symbols') || '').split(',').map(cleanSymbol).filter(Boolean).slice(0, 6);
let years = 3;
let runId = 0;

const chips = h('div', { class: 'chips', style: 'align-self:center' });
const picker = tickerSearch({ placeholder: 'Add a ticker or company', width: 'min(320px, 80vw)', onPick: (s) => { if (s && !symbols.includes(s) && symbols.length < 6) { symbols.push(s); sync(); } picker.input.value = ''; } });
mount($('#picker'),
  h('div', { class: 'field' }, 'Add', picker), chips,
  h('div', { class: 'field' }, 'Window', segmented([1, 3, 5].map((v) => ({ label: v + 'Y', value: v })), years, (v) => { years = v; load(); }, 'Window')));

function sync() {
  history.replaceState(null, '', symbols.length ? '/compare?symbols=' + symbols.join(',') : '/compare');
  mount(chips, ...symbols.map((s, i) => h('button', { class: 'chip', type: 'button', title: 'Remove ' + s, onclick: () => { symbols.splice(i, 1); sync(); } }, s + '  x')));
  load();
}

// Best value per metric: 'high' or 'low' wins; null = no judgement.
const ROWS = [
  ['Valuation', [['trailingPE', 'P/E (trailing)', 'x', 'low'], ['forwardPE', 'P/E (forward)', 'x', 'low'], ['trailingPegRatio', 'PEG', 'x', 'low'], ['priceToBook', 'Price / Book', 'x', null], ['enterpriseToEbitda', 'EV / EBITDA', 'x', 'low']]],
  ['Quality', [['grossMargins', 'Gross margin', 'frac', 'high'], ['operatingMargins', 'Operating margin', 'frac', 'high'], ['profitMargins', 'Net margin', 'frac', 'high'], ['returnOnEquity', 'Return on equity', 'frac', 'high']]],
  ['Growth', [['revenueGrowth', 'Revenue growth', 'frac', 'high'], ['earningsGrowth', 'Earnings growth', 'frac', 'high']]],
  ['Balance sheet', [['debtToEquity', 'Debt / equity', 'pct', 'low'], ['currentRatio', 'Current ratio', 'x', 'high'], ['freeCashflow', 'Free cash flow', 'money', null]]],
];

async function load() {
  const id = ++runId;
  if (symbols.length < 2) {
    mount(out, h('p', { class: 'state' }, symbols.length ? 'Add at least one more ticker to compare.' : 'Add two or more tickers, e.g. AAPL, MSFT, GOOGL, or Indian names like TCS.NS and INFY.NS.'));
    return;
  }
  mount(out, h('div', { class: 'state' }, 'Loading comparison...'));
  try {
    const [cmp, ...funds] = await Promise.all([api.compare(symbols, years), ...symbols.map((s) => api.fundamentals(s).catch(() => null)), ...symbols.map((s) => api.profile(s).catch(() => null))]);
    if (id !== runId) return;
    const fund = funds.slice(0, symbols.length), profs = funds.slice(symbols.length);
    render(cmp, fund, profs);
  } catch (e) {
    if (id !== runId) return;
    mount(out, e.status === 404 || e.status === 400 ? h('div', { class: 'state err' }, e.message) : errorBox(e, load));
  }
}

function render(cmp, fund, profs) {
  const syms = cmp.symbols;
  const maps = syms.map((s) => metricMap(fund[symbols.indexOf(s)]));
  const chart = lineChart({
    series: syms.map((s, i) => ({ name: s, color: COLORS[i % COLORS.length], dates: cmp.dates, values: cmp.series[s] })),
    baseline: 100, yFormat: (v) => v.toFixed(0), label: 'Rebased performance',
  });

  const statRows = [
    ['Total return', 'total_return_pct', (v) => signedPct(v, 1), 'high'], ['Annualised return', 'annualized_return_pct', (v) => signedPct(v, 1), 'high'],
    ['Volatility', 'volatility_pct', (v) => pct(v, 1), 'low'], ['Sharpe', 'sharpe', (v) => num(v, 2), 'high'], ['Max drawdown', 'max_drawdown_pct', (v) => pct(v, 1), 'high'],
  ];
  const best = (vals, dir) => {
    const ok = vals.filter(isNum);
    if (!dir || ok.length < 2) return null;
    return dir === 'high' ? Math.max(...ok) : Math.min(...ok);
  };
  const row = (label, vals, fmt, dir) => {
    const b = best(vals, dir);
    return h('tr', {}, h('td', {}, label), ...vals.map((v) => h('td', { class: 'num', style: isNum(v) && v === b ? 'font-weight:600;background:var(--paper-2)' : '' }, isNum(v) ? fmt(v) : '-')));
  };
  // A DOM node can live in only one place, so each table gets its own header row.
  const head = () => h('tr', {}, h('th', {}, ''), ...syms.map((s) => h('th', {}, s)));

  const risk = panel(`Risk and return, ${cmp.start} to ${cmp.end}`, h('div', { class: 'scroll-x' }, h('table', { class: 'data' }, h('thead', {}, head()),
    h('tbody', {}, ...statRows.map(([l, k, f, d]) => row(l, syms.map((s) => cmp.stats[s][k]), f, d))))));

  const fundTable = panel('Fundamentals', h('div', { class: 'scroll-x' }, h('table', { class: 'data' }, h('thead', {}, head()),
    h('tbody', {},
      row('Market cap', profs.map((p, i) => profs[symbols.indexOf(syms[i])]?.market_cap), (v) => compact(v), null),
      ...ROWS.flatMap(([title, items]) => [
        h('tr', {}, h('td', { colspan: syms.length + 1, style: 'text-align:left;font:500 .7rem var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);padding-top:14px' }, title)),
        ...items.map(([k, label, kind, dir]) => row(label, maps.map((m) => m[k]), (v) => fmtKind(v, kind), dir)),
      ])))),
    h('p', { class: 'muted', style: 'font-size:.75rem' }, 'Shaded = best of the group where "better" is unambiguous (lower valuation, higher margins and growth, lower debt). Cross-currency market caps are in each listing currency.'));

  const labels = cmp.correlation.labels, mat = cmp.correlation.matrix;
  const heat = panel('Correlation of daily returns',
    h('div', { class: 'heat', style: `grid-template-columns:70px repeat(${labels.length},1fr)` },
      h('div', {}), ...labels.map((l) => h('div', { class: 'muted' }, l)),
      ...labels.flatMap((l, i) => [h('div', { class: 'muted', style: 'text-align:left' }, l),
        ...mat[i].map((v) => h('div', { style: `background:color-mix(in srgb, var(--accent) ${Math.max(0, (v ?? 0)) * 70}%, var(--paper));color:${(v ?? 0) > 0.6 ? '#fff' : 'inherit'}` }, isNum(v) ? v.toFixed(2) : '-'))])),
    h('p', { class: 'muted', style: 'font-size:.78rem;margin-top:8px' }, 'Closer to 1 means the stocks move together, so holding both adds less diversification.'));

  mount(out,
    h('div', { style: 'margin-top:16px' }, panel(`Performance, rebased to 100 (${cmp.start} to ${cmp.end})`, chart)),
    risk, fundTable, heat,
    h('button', { class: 'btn ghost small', type: 'button', onclick: () => downloadCsv(`compare_${syms.join('_')}.csv`, ['Metric', ...syms], [
      ...statRows.map(([l, k]) => [l, ...syms.map((s) => cmp.stats[s][k])]),
      ...ROWS.flatMap(([, items]) => items.map(([k, label]) => [label, ...maps.map((m) => m[k])]))]) }, 'Export CSV'));

  setPageContext({ page: 'compare', symbol: syms.join(','), data: {
    window: { start: cmp.start, end: cmp.end },
    risk_return: cmp.stats,
    fundamentals: Object.fromEntries(syms.map((s, i) => [s, Object.fromEntries(ROWS.flatMap(([, items]) => items.map(([k, label]) => [label, maps[i][k] ?? null])))])),
    correlation: Object.fromEntries(labels.map((l, i) => [l, Object.fromEntries(labels.map((m, j) => [m, mat[i][j] != null ? +mat[i][j].toFixed(2) : null]))])),
  } });
}

sync();
