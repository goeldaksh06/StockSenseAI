import { h, mount } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { currencySymbol } from '../../core/format.js';
import { panel } from '../../core/research.js';
import { segmented } from '../../components/table.js';
import { lineChart } from '../../components/chart.js';
import { term } from '../../components/explain.js';

export async function render(root, ctx) {
  const d = await api.technicals(ctx.symbol);
  const cs = currencySymbol(ctx.currency);
  let range = 252;
  const on = { sma20: true, sma50: true, sma200: false, bb: false };
  const charts = h('div', {});

  const cut = (arr, from) => arr.slice(from);
  const draw = () => {
    const from = Math.max(0, d.close.length - range);
    const dates = cut(d.dates, from);
    const price = [{ name: 'Close', color: 'ink', dates, values: cut(d.close, from) }];
    if (on.sma20) price.push({ name: 'SMA 20', color: 'accent', dates, values: cut(d.sma20, from), width: 1.2 });
    if (on.sma50) price.push({ name: 'SMA 50', color: 'warn', dates, values: cut(d.sma50, from), width: 1.2 });
    if (on.sma200) price.push({ name: 'SMA 200', color: 'down', dates, values: cut(d.sma200, from), width: 1.2, dash: true });
    if (on.bb) price.push({ name: 'BB upper', color: 'ink-3', dates, values: cut(d.bb_upper, from), width: 1, dash: true }, { name: 'BB lower', color: 'ink-3', dates, values: cut(d.bb_lower, from), width: 1, dash: true });
    mount(charts,
      panel('Price and moving averages', lineChart({ series: price, yFormat: (v) => cs + v.toFixed(2), label: 'Price with overlays' })),
      panel('Volume', lineChart({ series: [{ name: 'Volume', type: 'bars', color: 'ink', dates, values: cut(d.volume, from) }], height: 120, yFormat: (v) => (v >= 1e6 ? (v / 1e6).toFixed(0) + 'M' : (v / 1e3).toFixed(0) + 'K'), label: 'Volume' })),
      h('div', { class: 'two' },
        panel(h('span', {}, term('RSI (14)', 'rsi')), lineChart({ series: [{ name: 'RSI', color: 'accent', dates, values: cut(d.rsi, from) }], height: 170, yFormat: (v) => v.toFixed(0), refLines: [{ value: 70, label: '70' }, { value: 30, label: '30' }], label: 'RSI' })),
        panel(h('span', {}, term('MACD', 'macd')), lineChart({ series: [
          { name: 'Histogram', type: 'bars', color: 'ink', dates, values: cut(d.macd_hist, from) },
          { name: 'MACD', color: 'accent', dates, values: cut(d.macd, from), width: 1.3 },
          { name: 'Signal', color: 'warn', dates, values: cut(d.macd_signal, from), width: 1.3 }], height: 170, yFormat: (v) => v.toFixed(1), label: 'MACD' }))));
  };
  const box = (key, label) => h('label', { class: 'field', style: 'flex-direction:row;align-items:center;gap:6px' },
    h('input', { type: 'checkbox', checked: on[key], onchange: (e) => { on[key] = e.target.checked; draw(); } }), label);

  const lv = d.levels;
  const readings = panel('Current readings',
    h('table', { class: 'data' }, h('tbody', {}, ...d.readings.map((r) => h('tr', {},
      h('td', {}, r.name), h('td', { style: 'text-align:right' }, h('span', { class: r.tone }, r.state)),
      h('td', { class: 'muted', style: 'text-align:right;font-size:.8rem' }, r.detail))))),
    h('p', { class: 'muted', style: 'font-size:.75rem' }, `60-day support ${cs}${lv.support_60d?.toFixed(2)} and resistance ${cs}${lv.resistance_60d?.toFixed(2)} (lowest low and highest high). These describe conditions; they are not signals to trade.`));

  mount(root,
    h('div', { class: 'toolbar', style: 'padding-top:0' },
      segmented([['3M', 63], ['6M', 126], ['1Y', 252], ['2Y', 504], ['5Y', 1260]].map(([label, value]) => ({ label, value })), range, (v) => { range = v; draw(); }, 'Range'),
      box('sma20', 'SMA 20'), box('sma50', 'SMA 50'), box('sma200', 'SMA 200'), box('bb', 'Bollinger bands')),
    h('div', { class: 'cols' }, charts, readings));
  draw();

  ctx.setContext('technicals', { readings: d.readings.map((r) => ({ indicator: r.name, state: r.state, detail: r.detail })), levels: d.levels });
}
