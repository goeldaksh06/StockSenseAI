import { h, mount } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { compact, fmtKind, isNum, currencySymbol } from '../../core/format.js';
import { panel, kv, rangeBar } from '../../core/research.js';
import { dcfValue, impliedGrowth, costOfEquity } from '../../core/dcf.js';
import { term, explainBox } from '../../components/explain.js';

function slider(label, { min, max, step, value, fmt, onInput }) {
  const out = h('span', { class: 'num', style: 'text-align:right' }, fmt(value));
  const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label });
  input.addEventListener('input', () => { out.textContent = fmt(+input.value); onInput(+input.value); });
  return h('div', { class: 'slider' }, h('label', {}, label), input, out);
}

export async function render(root, ctx) {
  const { symbol, currency, fundamentals: f } = ctx;
  const cs = currencySymbol(currency);
  const an = await api.analysts(symbol).catch(() => null);
  const inp = f?.dcf_inputs || {};

  // ---- multiples
  const valGroup = f?.groups.find((g) => g.title === 'Valuation');
  const multiples = valGroup
    ? panel('Valuation multiples', h('table', { class: 'data' }, h('tbody', {}, ...valGroup.items.map((it) =>
      h('tr', {}, h('td', {}, it.label), h('td', { class: 'num' }, fmtKind(it.value, it.format, currency)))))),
    h('p', { class: 'muted', style: 'font-size:.75rem' }, 'Compare against peers on the Compare tab; multiples only mean something relative to similar companies and growth.'))
    : null;

  // ---- analyst targets
  const t = an?.price_targets;
  const targets = t && isNum(t.mean)
    ? panel('Analyst price targets',
      rangeBar({ low: t.low, high: t.high, marks: [{ value: t.price, label: 'Price' }, { value: t.mean, label: 'Mean target', cls: 't' }] }),
      h('div', { class: 'muted num', style: 'display:flex;justify-content:space-between;font-size:.8rem' }, h('span', {}, `Low ${cs}${t.low?.toFixed(2)}`), h('span', {}, `Mean ${cs}${t.mean.toFixed(2)}`), h('span', {}, `High ${cs}${t.high?.toFixed(2)}`)),
      h('p', { class: 'muted', style: 'font-size:.78rem' }, 'Black marker: current price. Blue marker: mean analyst target.'))
    : null;

  // ---- DCF
  const dcfBox = h('div', {});
  const baseGrowth = isNum(inp.revenue_growth) ? Math.min(0.2, Math.max(0.02, inp.revenue_growth)) : 0.06;
  const st = {
    fcf: inp.fcf, growth: baseGrowth, terminal: 0.025, discount: costOfEquity(inp.beta), years: 10,
    cash: inp.cash || 0, debt: inp.debt || 0, shares: inp.shares,
  };
  const out = h('div', {});

  const recompute = () => {
    const r = dcfValue(st);
    if (!r) {
      mount(out, h('p', { class: 'banner' }, !(st.fcf > 0) ? 'A DCF needs positive free cash flow. Enter a normalised figure below if this company is temporarily negative.' : 'Discount rate must exceed terminal growth, and shares must be positive.'));
      return;
    }
    const price = inp.price;
    const mos = isNum(price) ? (r.perShare / price - 1) * 100 : null;
    const ig = isNum(price) ? impliedGrowth(st, price) : null;
    const sens = [-0.02, -0.01, 0, 0.01, 0.02].map((dd) => [0.015, 0.02, 0.025, 0.03, 0.035].map((tg) => dcfValue({ ...st, discount: st.discount + dd, terminal: tg })?.perShare));
    mount(out,
      kv([
        ['Intrinsic value / share', `${cs}${r.perShare.toFixed(2)}`, ''],
        ['Current price', isNum(price) ? `${cs}${price.toFixed(2)}` : '-', ''],
        [term('Margin of safety', 'margin_of_safety'), mos != null ? `${mos > 0 ? '+' : ''}${mos.toFixed(0)}%` : '-', mos > 0 ? 'up' : 'down'],
        [term('Market-implied growth', 'implied_growth'), ig != null ? `${(ig * 100).toFixed(1)}%/yr` : 'out of range', ''],
      ], 4),
      r.terminalShare > 0.75 && h('p', { class: 'banner' }, `${(r.terminalShare * 100).toFixed(0)}% of the value comes from the terminal value beyond year ${st.years}. The estimate is very sensitive to the discount and terminal growth assumptions.`),
      h('h3', { style: 'margin-top:18px;font-size:1rem' }, 'Sensitivity: value per share'),
      h('div', { class: 'scroll-x' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Discount rate \\ terminal growth'), ...[1.5, 2, 2.5, 3, 3.5].map((x) => h('th', {}, x + '%')))),
        h('tbody', {}, ...sens.map((row, i) => h('tr', {}, h('td', {}, ((st.discount + [-0.02, -0.01, 0, 0.01, 0.02][i]) * 100).toFixed(1) + '%'),
          ...row.map((v, j) => h('td', { class: 'num ' + (v && isNum(price) ? (v > price ? 'up' : 'down') : '') , style: i === 2 && j === 2 ? 'font-weight:600' : '' }, v ? cs + v.toFixed(0) : '-'))))))));
    ctx.setContext('valuation', {
      dcf_assumptions: { starting_fcf: st.fcf, growth_stage1_pct: +(st.growth * 100).toFixed(1), terminal_growth_pct: +(st.terminal * 100).toFixed(1), discount_rate_pct: +(st.discount * 100).toFixed(1), years: st.years, net_debt: st.debt - st.cash, shares: st.shares },
      dcf_result: { intrinsic_per_share: +r.perShare.toFixed(2), price, margin_of_safety_pct: mos != null ? +mos.toFixed(1) : null, market_implied_growth_pct: ig != null ? +(ig * 100).toFixed(1) : null, terminal_value_share_pct: +(r.terminalShare * 100).toFixed(0) },
      multiples: Object.fromEntries((valGroup?.items || []).map((i) => [i.key, i.value])),
      analyst_targets: t ? { low: t.low, mean: t.mean, high: t.high } : null,
    });
  };

  const B = 1e9;
  const fcfInput = h('input', { type: 'number', value: st.fcf != null ? +(st.fcf / B).toFixed(3) : '', step: 'any', style: 'width:140px', 'aria-label': 'Starting free cash flow in billions', placeholder: 'e.g. 100' });
  fcfInput.addEventListener('input', () => { st.fcf = Number(fcfInput.value) * B; recompute(); });
  const sharesInput = h('input', { type: 'number', value: st.shares != null ? +(st.shares / B).toFixed(3) : '', step: 'any', style: 'width:140px', 'aria-label': 'Shares outstanding in billions', placeholder: 'e.g. 15' });
  sharesInput.addEventListener('input', () => { st.shares = Number(sharesInput.value) * B; recompute(); });

  mount(dcfBox,
    explainBox('How to read this calculator', [
      'It projects free cash flow for ten years, fading growth toward a long-run rate, then discounts everything back to today. Change any assumption and the result updates.',
      'The point is to see what you have to believe. The "market-implied growth" figure is the yearly cash-flow growth that would justify today\'s price.',
    ]),
    h('div', { class: 'two' },
      h('div', {},
        h('div', { class: 'toolbar', style: 'border:0;padding:0 0 10px' },
          h('label', { class: 'field' }, `Free cash flow (${currency} billions)`, fcfInput), h('label', { class: 'field' }, 'Shares (billions)', sharesInput)),
        slider('Growth, years 1 to 10', { min: -0.05, max: 0.35, step: 0.005, value: st.growth, fmt: (v) => (v * 100).toFixed(1) + '%', onInput: (v) => { st.growth = v; recompute(); } }),
        slider('Terminal growth', { min: 0, max: 0.04, step: 0.0025, value: st.terminal, fmt: (v) => (v * 100).toFixed(2) + '%', onInput: (v) => { st.terminal = v; recompute(); } }),
        slider('Discount rate', { min: 0.05, max: 0.16, step: 0.0025, value: st.discount, fmt: (v) => (v * 100).toFixed(2) + '%', onInput: (v) => { st.discount = v; recompute(); } }),
        h('p', { class: 'muted', style: 'font-size:.78rem' }, `Defaults: growth from reported revenue growth (clamped 2 to 20%), discount rate from CAPM (4% risk-free + beta ${isNum(inp.beta) ? inp.beta.toFixed(2) : '1.00'} x 5% premium, clamped 6 to 15%). Net debt ${compact(st.debt - st.cash, currency)}.`)),
      out),
    h('p', { class: 'muted', style: 'font-size:.75rem' }, 'Educational model, not a price target. Uses reported TTM free cash flow, which can be unrepresentative; financial companies and cyclical earners need different approaches.'));
  recompute();

  mount(root, panel('Discounted cash flow', dcfBox), h('div', { class: 'two' }, h('div', {}, multiples), h('div', {}, targets)));
}
