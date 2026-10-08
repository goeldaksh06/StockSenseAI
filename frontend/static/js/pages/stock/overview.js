import { h, mount } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { compact, fmtKind, isNum, currencySymbol } from '../../core/format.js';
import { panel, kv } from '../../core/research.js';
import { lineChart } from '../../components/chart.js';
import { barChart } from '../../components/columns.js';
import { segmented } from '../../components/table.js';
import { yearLabel } from '../../core/research.js';

/** Transparent rule-based screen: every row shows the rule it applied. */
export function buildChecklist({ m, tech, analysts, price }) {
  const rows = [];
  const add = (label, rule, value, pass) => rows.push({ label, rule, value, pass });
  const pe = (v, k) => (isNum(v) ? fmtKind(v, k) : null);
  add('Profitable', 'Net margin above 0', pe(m.profitMargins, 'frac'), isNum(m.profitMargins) ? m.profitMargins > 0 : null);
  add('Revenue growing', 'Revenue growth (YoY) above 0', pe(m.revenueGrowth, 'frac'), isNum(m.revenueGrowth) ? m.revenueGrowth > 0 : null);
  add('Healthy operating margin', 'Operating margin above 10%', pe(m.operatingMargins, 'frac'), isNum(m.operatingMargins) ? m.operatingMargins > 0.1 : null);
  add('Generates free cash', 'Free cash flow above 0', pe(m.freeCashflow, 'money'), isNum(m.freeCashflow) ? m.freeCashflow > 0 : null);
  add('Moderate leverage', 'Debt / equity below 100%', pe(m.debtToEquity, 'pct'), isNum(m.debtToEquity) ? m.debtToEquity < 100 : null);
  add('Liquidity', 'Current ratio above 1', pe(m.currentRatio, 'x'), isNum(m.currentRatio) ? m.currentRatio > 1 : null);
  add('Growth-adjusted valuation', 'PEG ratio between 0 and 2', pe(m.trailingPegRatio, 'x'), isNum(m.trailingPegRatio) ? m.trailingPegRatio > 0 && m.trailingPegRatio < 2 : null);
  const r = Object.fromEntries((tech?.readings || []).map((x) => [x.name, x]));
  const s200 = r['Price vs 200-day average'];
  add('Long-term uptrend', 'Price above 200-day average', s200 ? s200.state : null, s200 ? s200.state === 'Above' : null);
  const lv = tech?.levels;
  if (lv && isNum(price)) add('Near 52-week high', 'Within 15% of the 52-week high', `${(((lv.week52_high - price) / lv.week52_high) * 100).toFixed(1)}% below`, price >= lv.week52_high * 0.85);
  const t = analysts?.price_targets;
  if (t && isNum(t.mean) && isNum(price)) add('Analyst upside', 'Mean target above current price', `${(((t.mean / price) - 1) * 100).toFixed(1)}% to mean target`, t.mean > price);
  return rows;
}

export async function render(root, ctx) {
  const { symbol, profile: p, metrics: m, currency } = ctx;
  const cs = currencySymbol(currency);
  const [tech, st, an] = await Promise.all([
    api.technicals(symbol).catch(() => null),
    api.statements(symbol).catch(() => null),
    api.analysts(symbol).catch(() => null),
  ]);

  // --- price chart with range selector
  let range = 252;
  const pricePanel = panel('Price');
  const drawPrice = () => {
    if (!tech) { mount(pricePanel, h('h3', {}, 'Price'), h('p', { class: 'state' }, 'Price history unavailable.')); return; }
    const from = Math.max(0, tech.close.length - range);
    const chart = lineChart({
      series: [
        { name: 'Close', color: 'ink', dates: tech.dates.slice(from), values: tech.close.slice(from) },
        { name: 'SMA 200', color: 'warn', dates: tech.dates.slice(from), values: tech.sma200.slice(from), dash: true, width: 1.2 },
      ],
      yFormat: (v) => cs + v.toFixed(2), label: `${symbol} price`,
    });
    const first = tech.close[from], last = tech.close.at(-1);
    mount(pricePanel, h('h3', {}, 'Price ', h('span', { class: 'num ' + (last >= first ? 'up' : 'down'), style: 'font-size:.9rem' }, `${last >= first ? '+' : ''}${((last / first - 1) * 100).toFixed(1)}% over range`)),
      segmented([['1M', 21], ['6M', 126], ['1Y', 252], ['3Y', 756], ['5Y', 1260]].map(([label, value]) => ({ label, value })), range, (v) => { range = v; drawPrice(); }, 'Range'), chart);
  };
  drawPrice();

  // --- checklist
  const checks = buildChecklist({ m, tech, analysts: an, price: p.price });
  const scored = checks.filter((c) => c.pass !== null);
  const passed = scored.filter((c) => c.pass).length;
  const checklist = panel(`Quick screen: ${passed} of ${scored.length} pass`,
    h('ul', { class: 'checks' }, ...checks.map((c) => h('li', {},
      h('span', { class: c.pass === null ? 'na' : c.pass ? 'ok' : 'no' }, c.pass === null ? '-' : c.pass ? 'Yes' : 'No'),
      h('span', {}, h('b', {}, c.label), h('br'), h('span', { class: 'muted', style: 'font-size:.78rem' }, c.rule)),
      h('span', { class: 'num' }, c.value ?? 'n/a')))),
    h('p', { class: 'muted', style: 'font-size:.75rem' }, 'A rule-based checklist of facts, not a recommendation. Thresholds are simple conventions and vary by industry.'));

  // --- business summary
  let expanded = false;
  const summaryP = h('p', { class: 'prose', style: 'margin:0' });
  const toggle = h('button', { class: 'btn ghost small', type: 'button', style: 'margin-top:8px' });
  const drawSummary = () => {
    const text = p.summary || 'No business description available.';
    summaryP.textContent = expanded || text.length < 420 ? text : text.slice(0, 420) + '...';
    toggle.hidden = text.length < 420;
    toggle.textContent = expanded ? 'Show less' : 'Read more';
  };
  toggle.onclick = () => { expanded = !expanded; drawSummary(); };
  drawSummary();
  const about = panel('Business', summaryP, toggle,
    h('p', { class: 'muted', style: 'font-size:.8rem;margin-top:10px' },
      [p.employees ? `${compact(p.employees)} employees` : null, p.website ? h('a', { href: p.website, target: '_blank', rel: 'noopener noreferrer' }, p.website.replace(/^https?:\/\//, '')) : null]
        .filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x]))));

  // --- financial snapshot
  const annual = (st?.trends?.annual || []).slice(-5);
  const snap = annual.length
    ? panel('Five-year snapshot', h('div', { class: 'two' },
      h('div', {}, h('div', { class: 'muted', style: 'font-size:.8rem' }, 'Revenue'), barChart({ bars: annual.map((a) => ({ label: yearLabel(a.period), value: a.revenue })), height: 170, format: (v) => compact(v), sign: false, label: 'Revenue by year' })),
      h('div', {}, h('div', { class: 'muted', style: 'font-size:.8rem' }, 'Net income'), barChart({ bars: annual.map((a) => ({ label: yearLabel(a.period), value: a.net_income })), height: 170, format: (v) => compact(v), label: 'Net income by year' })),
      h('div', {}, h('div', { class: 'muted', style: 'font-size:.8rem' }, 'Free cash flow'), barChart({ bars: annual.map((a) => ({ label: yearLabel(a.period), value: a.fcf })), height: 170, format: (v) => compact(v), label: 'Free cash flow by year' })),
      h('div', {}, h('div', { class: 'muted', style: 'font-size:.8rem' }, 'Operating margin'), barChart({ bars: annual.map((a) => ({ label: yearLabel(a.period), value: a.operating_margin != null ? a.operating_margin * 100 : null })), height: 170, format: (v) => v.toFixed(0) + '%', sign: false, label: 'Operating margin by year' }))))
    : null;

  // --- analyst snapshot
  const t = an?.price_targets;
  const upside = t && isNum(t.mean) && isNum(p.price) ? (t.mean / p.price - 1) * 100 : null;
  const analystPanel = an && (an.consensus?.key || t?.mean)
    ? panel('Analyst view', kv([
      ['Consensus', (an.consensus.key || 'n/a').replace('_', ' '), ''],
      ['Mean target', t?.mean ? cs + t.mean.toFixed(2) : '-', ''],
      ['Upside to target', upside != null ? `${upside > 0 ? '+' : ''}${upside.toFixed(1)}%` : '-', upside > 0 ? 'up' : upside < 0 ? 'down' : ''],
      ['Analysts', an.consensus.analysts ? String(Math.round(an.consensus.analysts)) : '-', ''],
    ], 2), h('p', { class: 'muted', style: 'font-size:.75rem' }, 'Third-party opinions via Yahoo Finance. See the Analysts tab for ranges, revisions and earnings history.'))
    : null;

  // --- key metrics
  const keyMetrics = panel('Key metrics', kv([
    ['P/E (trailing)', fmtKind(m.trailingPE, 'x')], ['Forward P/E', fmtKind(m.forwardPE, 'x')], ['EV / EBITDA', fmtKind(m.enterpriseToEbitda, 'x')],
    ['Net margin', fmtKind(m.profitMargins, 'frac')], ['Return on equity', fmtKind(m.returnOnEquity, 'frac')], ['Revenue growth', fmtKind(m.revenueGrowth, 'frac')],
    ['Free cash flow', fmtKind(m.freeCashflow, 'money', currency)], ['Debt / equity', fmtKind(m.debtToEquity, 'pct')],
  ], 4));

  mount(root,
    h('div', { class: 'cols' }, h('div', {}, pricePanel, snap, keyMetrics), h('div', {}, checklist, analystPanel, about)));

  ctx.setContext('overview', {
    checklist: checks.map((c) => ({ check: c.label, rule: c.rule, value: c.value, pass: c.pass })),
    key_metrics: { pe: m.trailingPE, forward_pe: m.forwardPE, ev_ebitda: m.enterpriseToEbitda, net_margin: m.profitMargins, roe: m.returnOnEquity, revenue_growth: m.revenueGrowth, fcf: m.freeCashflow, debt_to_equity_pct: m.debtToEquity },
    annual_trend: annual.map((a) => ({ year: a.period.slice(0, 4), revenue: a.revenue, net_income: a.net_income, fcf: a.fcf, operating_margin: a.operating_margin })),
    analyst: an ? { consensus: an.consensus.key, mean_target: t?.mean, high: t?.high, low: t?.low, upside_pct: upside } : null,
    business_summary_excerpt: (p.summary || '').slice(0, 500),
  });
}
