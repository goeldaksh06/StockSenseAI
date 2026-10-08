import { $, h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { currentUser } from '../core/auth.js';
import { money, signedPct, tone, compact, fmtKind, cleanSymbol, currencySymbol } from '../core/format.js';
import { toast, errorBox } from '../core/ui.js';
import { setPageContext } from '../core/pageContext.js';
import { metricMap, rangeBar } from '../core/research.js';
import { tickerSearch } from '../components/tickerSearch.js';
import { term } from '../components/explain.js';

const TABS = [
  ['overview', 'Overview', () => import('./stock/overview.js')],
  ['financials', 'Financials', () => import('./stock/financials.js')],
  ['valuation', 'Valuation', () => import('./stock/valuation.js')],
  ['risk', 'Risk', () => import('./stock/risk.js')],
  ['technicals', 'Technicals', () => import('./stock/technicals.js')],
  ['analysts', 'Analysts', () => import('./stock/analysts.js')],
  ['ownership', 'Ownership', () => import('./stock/ownership.js')],
  ['news', 'News', () => import('./stock/news.js')],
  ['forecast', 'Forecast', () => import('./stock/forecast.js')],
];

const symbol = cleanSymbol(document.body.dataset.symbol);
const searchRow = $('#searchRow');
searchRow.append(tickerSearch({ onPick: (s) => location.assign('/stock/' + s), value: '', autofocus: !symbol, width: 'min(420px, 90vw)' }));

if (symbol) start();

async function start() {
  const head = $('#head');
  mount(head, h('div', { class: 'state' }, `Loading ${symbol}...`));
  let profile, fundamentals;
  try {
    [profile, fundamentals] = await Promise.all([api.profile(symbol), api.fundamentals(symbol).catch(() => null)]);
  } catch (e) {
    mount(head, e.status === 404
      ? h('div', { class: 'state err' }, e.message)
      : errorBox(e, start));
    return;
  }
  document.title = `${profile.name} (${profile.symbol}) | StockSense`;
  const ctx = {
    symbol: profile.symbol, profile, fundamentals, currency: profile.currency, metrics: metricMap(fundamentals),
    setContext: (tab, data) => setPageContext({ page: 'stock:' + tab, symbol: profile.symbol, data: { company: summary(profile, fundamentals), ...data } }),
  };
  ctx.setContext('header', {});
  renderHead(head, ctx);
  buildTabs(ctx);
}

const summary = (p, f) => {
  const m = metricMap(f);
  return {
    name: p.name, sector: p.sector, industry: p.industry, currency: p.currency, price: p.price, change_pct: p.change_pct,
    market_cap: p.market_cap, week52_low: p.week52_low, week52_high: p.week52_high, beta: p.beta,
    pe_trailing: m.trailingPE, pe_forward: m.forwardPE, ev_ebitda: m.enterpriseToEbitda,
  };
};

function renderHead(head, { profile: p, metrics: m, fundamentals: f, currency }) {
  const cur = currency;
  const divYield = f?.dividend_yield;
  const watch = h('button', { class: 'btn ghost small', type: 'button' }, 'Add to watchlist');
  watch.onclick = async () => {
    if (!(await currentUser())) { location.assign('/login?next=' + encodeURIComponent(location.pathname)); return; }
    try { await api.addWatch(p.symbol); toast(`${p.symbol} added to watchlist`); watch.disabled = true; } catch (e) { toast(e.message, true); }
  };
  const stat = (label, node) => h('div', {}, h('dt', {}, label), h('dd', {}, node));
  mount(head,
    h('div', { class: 'stockhead' },
      h('div', {},
        h('div', { class: 'eyebrow' }, [p.exchange, p.quote_type, currency].filter(Boolean).join(' · ')),
        h('h1', {}, p.name, ' ', h('span', { class: 'muted mono', style: 'font-size:1.2rem' }, p.symbol)),
        h('div', { class: 'muted' }, [p.sector, p.industry, p.country].filter(Boolean).join(' · '))),
      h('div', { style: 'text-align:right' },
        h('div', { class: 'px' }, currencySymbol(cur) + (p.price ?? 0).toFixed(2)),
        h('div', { class: 'num ' + tone(p.change) }, p.change != null ? `${p.change > 0 ? '+' : ''}${p.change.toFixed(2)} (${signedPct(p.change_pct)}) today` : ''),
        h('div', { style: 'margin-top:8px;display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap' },
          watch,
          h('a', { class: 'btn ghost small', href: '/compare?symbols=' + p.symbol }, 'Compare'),
          h('a', { class: 'btn ghost small', href: '/analyze/' + p.symbol }, 'Forecast lab')))),
    h('dl', { class: 'kv', style: 'margin-top:14px' },
      stat('Market cap', compact(p.market_cap, cur)),
      stat(term('P/E', 'pe'), m.trailingPE ? m.trailingPE.toFixed(1) + 'x' : '-'),
      stat('Forward P/E', m.forwardPE ? m.forwardPE.toFixed(1) + 'x' : '-'),
      stat('Dividend yield', divYield ? (divYield * 100).toFixed(2) + '%' : '-'),
      stat('Beta', p.beta != null ? p.beta.toFixed(2) : '-'),
      h('div', {}, h('dt', {}, '52-week range'),
        h('dd', { style: 'font-size:.85rem' }, `${money(p.week52_low).replace('$', currencySymbol(cur))} to ${money(p.week52_high).replace('$', currencySymbol(cur))}`,
          rangeBar({ low: p.week52_low, high: p.week52_high, marks: [{ value: p.price, label: 'Price' }] })))));
}

function buildTabs(ctx) {
  const tabsEl = $('#tabs'), panelEl = $('#panel');
  tabsEl.hidden = false;
  const wanted = new URLSearchParams(location.search).get('tab');
  let current = TABS.some(([k]) => k === wanted) ? wanted : 'overview';
  let token = 0;

  async function show(key) {
    current = key;
    const mine = ++token;
    history.replaceState(null, '', `/stock/${ctx.symbol}?tab=${key}`);
    tabsEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.key === key)));
    mount(panelEl, h('div', { class: 'state' }, 'Loading...'));
    try {
      const mod = await TABS.find(([k]) => k === key)[2]();
      if (mine !== token) return;
      const root = h('div', {});
      mount(panelEl, root);
      await mod.render(root, ctx);
    } catch (e) {
      if (mine !== token) return;
      mount(panelEl, errorBox(e, () => show(key)));
    }
  }
  mount(tabsEl, ...TABS.map(([key, label]) =>
    h('button', { role: 'tab', 'data-key': key, 'aria-selected': 'false', onclick: () => show(key) }, label)));
  show(current);
}
