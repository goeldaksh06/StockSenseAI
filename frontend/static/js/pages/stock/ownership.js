import { h, mount } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { compact, isNum, pct, currencySymbol } from '../../core/format.js';
import { panel, kv } from '../../core/research.js';

export async function render(root, ctx) {
  const d = await api.ownership(ctx.symbol);
  const b = d.breakdown || {};
  const p = (v) => (isNum(v) ? pct(v * 100, 1) : '-');
  const cs = currencySymbol(ctx.currency);

  const tiles = kv([
    ['Held by insiders', p(b.insidersPercentHeld)],
    ['Held by institutions', p(b.institutionsPercentHeld)],
    ['Institutions of float', p(b.institutionsFloatPercentHeld)],
    ['Institutional holders', isNum(b.institutionsCount) ? compact(b.institutionsCount) : '-'],
  ], 4);

  const inst = d.institutions.length
    ? panel('Top institutional holders', h('div', { class: 'scroll-x' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, ...['Holder', 'Shares', 'Value', '% held', 'Change', 'Reported'].map((x) => h('th', {}, x)))),
      h('tbody', {}, ...d.institutions.map((r) => h('tr', {},
        h('td', {}, r.holder), h('td', { class: 'num' }, compact(r.shares)), h('td', { class: 'num' }, compact(r.value, ctx.currency)),
        h('td', { class: 'num' }, p(r.pct_held)), h('td', { class: 'num ' + (r.pct_change > 0 ? 'up' : r.pct_change < 0 ? 'down' : '') }, isNum(r.pct_change) ? (r.pct_change > 0 ? '+' : '') + (r.pct_change * 100).toFixed(1) + '%' : '-'),
        h('td', { class: 'num' }, r.date || '-')))))))
    : h('p', { class: 'state' }, 'No institutional holder data for this security.');

  const ins = d.insiders.length
    ? panel(`Recent insider transactions (${d.insider_sales} sales, ${d.insider_purchases} purchases in the last ${d.insiders.length})`,
      h('div', { class: 'scroll-x' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, ...['Date', 'Insider', 'Role', 'Type', 'Shares', 'Value'].map((x) => h('th', {}, x)))),
        h('tbody', {}, ...d.insiders.map((r) => h('tr', {},
          h('td', { class: 'num' }, r.date || '-'), h('td', {}, r.insider), h('td', {}, r.position || '-'),
          h('td', {}, h('span', { class: r.kind === 'Sale' ? 'down' : r.kind === 'Purchase' ? 'up' : 'muted' }, r.kind)),
          h('td', { class: 'num' }, compact(r.shares)), h('td', { class: 'num' }, r.value ? cs + compact(r.value).replace(/^\$/, '') : '-')))))),
      h('p', { class: 'muted', style: 'font-size:.78rem' }, 'Most insider sales are routine (pre-scheduled plans, tax withholding, diversification). Open-market purchases are rarer and usually more informative.'))
    : null;

  mount(root, tiles, h('div', { style: 'margin-top:14px' }, inst), ins);
  ctx.setContext('ownership', { breakdown: b, top_institutions: d.institutions.slice(0, 5).map((r) => ({ holder: r.holder, pct_held: r.pct_held, pct_change: r.pct_change })), insider_sales: d.insider_sales, insider_purchases: d.insider_purchases });
}
