import { h } from './dom.js';
import { isNum } from './format.js';

/** Flatten grouped fundamentals into { key: value } for quick lookups. */
export function metricMap(fundamentals) {
  const out = {};
  for (const g of fundamentals?.groups || []) for (const it of g.items) out[it.key] = it.value;
  return out;
}

/** A labelled low..high bar with markers, e.g. the 52-week range with the current price. */
export function rangeBar({ low, high, marks = [] }) {
  if (!isNum(low) || !isNum(high) || high <= low) return null;
  const pos = (v) => Math.max(0, Math.min(100, ((v - low) / (high - low)) * 100));
  return h('div', { class: 'rangebar' }, ...marks.filter((m) => isNum(m.value)).map((m) =>
    h('i', { class: m.cls || '', style: `left:${pos(m.value)}%`, title: `${m.label}: ${m.value}` })));
}

/** Tile grid from [[label, valueNode|string, tone?]] */
export function kv(items, cols) {
  return h('dl', { class: 'kv', style: cols ? `grid-template-columns:repeat(${cols},1fr)` : null },
    ...items.map(([label, value, tone]) => h('div', {}, h('dt', {}, label), h('dd', { class: tone || '' }, value))));
}

export const panel = (title, ...body) => h('section', { class: 'panel' }, title && h('h3', {}, title), ...body);

/** Month/period label for chart axes from an ISO date. */
export const yearLabel = (iso, quarterly = false) => {
  const d = new Date(iso + 'T00:00:00');
  return quarterly ? `${d.toLocaleString('en-US', { month: 'short' })} '${String(d.getFullYear()).slice(2)}` : String(d.getFullYear());
};
