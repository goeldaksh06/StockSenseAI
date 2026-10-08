import { h, mount } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { isNum, currencySymbol, pct } from '../../core/format.js';
import { panel, kv, rangeBar } from '../../core/research.js';
import { barChart } from '../../components/columns.js';

const COLORS = { strongBuy: '#1f6f43', buy: '#5fa97f', hold: '#8a8474', sell: '#c9775f', strongSell: '#a8321f' };
const LABELS = { strongBuy: 'Strong buy', buy: 'Buy', hold: 'Hold', sell: 'Sell', strongSell: 'Strong sell' };
const PERIOD = { '0m': 'Now', '-1m': '1 month ago', '-2m': '2 months ago', '-3m': '3 months ago' };

export async function render(root, ctx) {
  const d = await api.analysts(ctx.symbol);
  const cs = currencySymbol(ctx.currency);
  const t = d.price_targets || {};
  const upside = isNum(t.mean) && isNum(t.price) ? (t.mean / t.price - 1) * 100 : null;

  const header = kv([
    ['Consensus', (d.consensus.key || 'n/a').replace('_', ' ')],
    ['Rating score (1 = strong buy, 5 = sell)', isNum(d.consensus.mean) ? d.consensus.mean.toFixed(2) : '-'],
    ['Analysts', isNum(d.consensus.analysts) ? String(Math.round(d.consensus.analysts)) : '-'],
    ['Next earnings', d.next_earnings ? d.next_earnings.slice(0, 10) : '-'],
  ], 4);

  const targets = isNum(t.mean)
    ? panel('Price targets',
      rangeBar({ low: t.low, high: t.high, marks: [{ value: t.price, label: 'Price' }, { value: t.mean, label: 'Mean', cls: 't' }, { value: t.median, label: 'Median', cls: 't' }] }),
      h('div', { class: 'muted num', style: 'display:flex;justify-content:space-between;font-size:.8rem' },
        h('span', {}, `Low ${cs}${t.low?.toFixed(2)}`), h('span', {}, `Mean ${cs}${t.mean.toFixed(2)}`), h('span', {}, `High ${cs}${t.high?.toFixed(2)}`)),
      upside != null && h('p', { class: upside >= 0 ? 'up' : 'down', style: 'margin-top:10px' }, `${upside >= 0 ? '+' : ''}${upside.toFixed(1)}% from ${cs}${t.price.toFixed(2)} to the mean target`))
    : null;

  const trend = d.ratings_trend?.length
    ? panel('Ratings distribution',
      ...d.ratings_trend.map((r) => {
        const total = Object.keys(COLORS).reduce((a, k) => a + (r[k] || 0), 0) || 1;
        return h('div', { style: 'margin:8px 0' },
          h('div', { class: 'muted', style: 'font-size:.78rem' }, PERIOD[r.period] || r.period),
          h('div', { class: 'stack' }, ...Object.keys(COLORS).filter((k) => r[k]).map((k) =>
            h('div', { style: `width:${(r[k] / total) * 100}%;background:${COLORS[k]}`, title: `${LABELS[k]}: ${r[k]}` }, String(r[k])))));
      }),
      h('div', { class: 'legend' }, ...Object.entries(LABELS).map(([k, l]) => h('span', {}, h('i', { style: `border-top-color:${COLORS[k]};border-top-width:6px` }), l))))
    : null;

  const estimates = d.estimates?.length
    ? panel('Earnings per share estimates', h('div', { class: 'scroll-x' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, ...['Period', 'Average', 'Low', 'High', 'Year ago', 'Analysts', 'Growth'].map((x) => h('th', {}, x)))),
      h('tbody', {}, ...d.estimates.map((e) => h('tr', {}, h('td', {}, e.period),
        ...[e.avg, e.low, e.high, e.year_ago].map((v) => h('td', { class: 'num' }, isNum(v) ? v.toFixed(2) : '-')),
        h('td', { class: 'num' }, isNum(e.analysts) ? String(Math.round(e.analysts)) : '-'),
        h('td', { class: 'num ' + (e.growth > 0 ? 'up' : 'down') }, isNum(e.growth) ? pct(e.growth * 100, 1) : '-')))))))
    : null;

  const hist = d.earnings_history?.length
    ? panel('Earnings surprises (reported vs estimate)',
      barChart({ bars: [...d.earnings_history].reverse().map((e) => ({ label: e.date.slice(2, 7), value: e.surprise_pct })), height: 190, format: (v) => v.toFixed(1) + '%', label: 'EPS surprise percent' }),
      h('p', { class: 'muted', style: 'font-size:.8rem' }, isNum(d.beat_rate) ? `Beat estimates in ${(d.beat_rate * 100).toFixed(0)}% of the last ${d.earnings_history.length} reports. ` : '',
        'Companies usually guide analysts to beatable numbers, so a high beat rate is common and not by itself a sign of strength.'))
    : null;

  const changes = d.changes?.length
    ? panel('Recent rating changes', h('div', { class: 'scroll-x' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, ...['Date', 'Firm', 'Action', 'From', 'To', 'Target'].map((x) => h('th', {}, x)))),
      h('tbody', {}, ...d.changes.map((c) => h('tr', {}, h('td', { class: 'num' }, c.date), h('td', {}, c.firm || '-'), h('td', {}, c.action || '-'),
        h('td', {}, c.from || '-'), h('td', {}, c.to || '-'),
        h('td', { class: 'num' }, isNum(c.price_target) ? `${cs}${c.price_target.toFixed(0)}${isNum(c.prior_target) && c.prior_target !== c.price_target ? ` (was ${c.prior_target.toFixed(0)})` : ''}` : '-')))))))
    : null;

  mount(root, header,
    h('p', { class: 'muted', style: 'font-size:.78rem;margin:8px 0' }, 'Analyst opinions are third-party views aggregated by Yahoo Finance. They are often optimistic and lag price moves.'),
    h('div', { class: 'two', style: 'margin-top:12px' }, h('div', {}, targets, trend), h('div', {}, hist, estimates)),
    changes);
  if (![targets, trend, estimates, hist, changes].some(Boolean)) mount(root, h('p', { class: 'state' }, 'No analyst coverage data available for this security.'));

  ctx.setContext('analysts', {
    consensus: d.consensus, price_targets: t, upside_to_mean_pct: upside, next_earnings: d.next_earnings, beat_rate: d.beat_rate,
    estimates: d.estimates, last_earnings: d.earnings_history.slice(0, 4), recent_changes: d.changes.slice(0, 6),
  });
}
