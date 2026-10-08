import { h, mount } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { compact, isNum } from '../../core/format.js';
import { panel, yearLabel } from '../../core/research.js';
import { downloadCsv } from '../../core/csv.js';
import { segmented } from '../../components/table.js';
import { barChart } from '../../components/columns.js';
import { lineChart } from '../../components/chart.js';

const STATEMENTS = [['income', 'Income statement'], ['balance', 'Balance sheet'], ['cashflow', 'Cash flow']];
const PER_SHARE = /EPS|per share/i;

export async function render(root, ctx) {
  const { symbol, currency } = ctx;
  const data = await api.statements(symbol);
  let kind = 'income', freq = 'annual', showAll = false, yoy = false;
  const body = h('div', {});

  const trendBlock = () => {
    const pts = (data.trends[freq] || []).slice(-(freq === 'annual' ? 5 : 8));
    if (!pts.length) return null;
    const lab = (a) => yearLabel(a.period, freq === 'quarterly');
    return h('div', { class: 'two' },
      panel('Revenue and growth', barChart({ bars: pts.map((a) => ({ label: lab(a), value: a.revenue })), height: 200, format: (v) => compact(v), sign: false, label: 'Revenue' }),
        h('div', { class: 'muted num', style: 'font-size:.78rem;margin-top:6px' }, 'Growth: ' + pts.map((a) => (a.revenue_growth == null ? '-' : (a.revenue_growth * 100).toFixed(1) + '%')).join('  '))),
      panel('Margins', lineChart({
        series: [
          { name: 'Gross', color: 'accent', dates: pts.map((a) => a.period), values: pts.map((a) => (a.gross_margin ?? NaN) * 100) },
          { name: 'Operating', color: 'ink', dates: pts.map((a) => a.period), values: pts.map((a) => (a.operating_margin ?? NaN) * 100) },
          { name: 'Net', color: 'up', dates: pts.map((a) => a.period), values: pts.map((a) => (a.net_margin ?? NaN) * 100) },
        ], height: 200, yFormat: (v) => v.toFixed(0) + '%', label: 'Margins',
      })));
  };

  const table = () => {
    const t = data[kind][freq];
    if (!t.rows.length) return h('p', { class: 'state' }, 'No statement data available for this company.');
    const rows = t.rows.filter((r) => showAll || r.key);
    const fmt = (v, item) => (v == null ? '-' : PER_SHARE.test(item) ? v.toFixed(2) : compact(v));
    const change = (v, prev) => (isNum(v) && isNum(prev) && prev !== 0 ? ((v - prev) / Math.abs(prev)) * 100 : null);
    return h('div', { class: 'scroll-x' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, `${currency}, newest first`), ...t.periods.map((d) => h('th', {}, d)))),
      h('tbody', {}, ...rows.map((r) => h('tr', { style: r.key ? 'font-weight:500' : '' },
        h('td', {}, r.item),
        ...r.values.map((v, i) => {
          if (yoy) {
            const c = change(v, r.values[i + 1]);
            return h('td', { class: 'num ' + (c == null ? 'muted' : c >= 0 ? 'up' : 'down') }, c == null ? '-' : (c > 0 ? '+' : '') + c.toFixed(1) + '%');
          }
          return h('td', { class: 'num' }, fmt(v, r.item));
        }))))));
  };

  const draw = () => {
    const t = data[kind][freq];
    mount(body, trendBlock(),
      panel(null,
        h('div', { class: 'toolbar', style: 'padding-top:0' },
          segmented(STATEMENTS.map(([value, label]) => ({ value, label })), kind, (v) => { kind = v; draw(); }, 'Statement'),
          segmented([{ value: 'annual', label: 'Annual' }, { value: 'quarterly', label: 'Quarterly' }], freq, (v) => { freq = v; draw(); }, 'Frequency'),
          segmented([{ value: false, label: 'Values' }, { value: true, label: 'YoY change' }], yoy, (v) => { yoy = v; draw(); }, 'Display'),
          h('label', { class: 'field', style: 'flex-direction:row;align-items:center;gap:6px' },
            h('input', { type: 'checkbox', checked: showAll, onchange: (e) => { showAll = e.target.checked; draw(); } }), 'All line items'),
          h('button', { class: 'btn ghost small', type: 'button', disabled: !t.rows.length, onclick: () => downloadCsv(`${symbol}_${kind}_${freq}.csv`, ['Item', ...t.periods], t.rows.map((r) => [r.item, ...r.values])) }, 'Export CSV')),
        table(),
        h('p', { class: 'muted', style: 'font-size:.75rem' }, 'YoY change compares each period with the one to its right (the prior period). Source: Yahoo Finance, as reported; figures in the company reporting currency.')));
  };
  draw();
  mount(root, body);

  const last = (data.trends.annual || []).slice(-4);
  ctx.setContext('financials', {
    annual_trend: last.map((a) => ({ year: a.period.slice(0, 4), revenue: a.revenue, revenue_growth: a.revenue_growth, gross_margin: a.gross_margin, operating_margin: a.operating_margin, net_margin: a.net_margin, net_income: a.net_income, eps: a.eps, fcf: a.fcf })),
  });
}
