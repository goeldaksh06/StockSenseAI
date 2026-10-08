import { h, s } from '../core/dom.js';
import { shortDate, isNum } from '../core/format.js';

const DEFAULT_W = 800;
const M = { t: 12, r: 12, b: 26, l: 56 };

function niceTicks(min, max, n = 5) {
  if (min === max) { min -= 1; max += 1; }
  const step0 = (max - min) / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= step0);
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/**
 * Line chart with hover crosshair.
 * series: [{ name, color: css var name, dates: [iso], values: [n|null], dash?: bool }]
 * All series share the first series' x axis when `dates` match in length; otherwise each uses its own.
 * Returns the root element; call .update(nextOpts) to redraw (e.g. after a range change).
 */
export function lineChart(opts) {
  const root = h('div', { class: 'chart' });
  const tip = h('div', { class: 'tip', hidden: true });
  const legend = h('div', { class: 'legend' });
  let cur = opts;
  let W = DEFAULT_W;
  // Draw at the container's real pixel width so axis text stays 11px instead of shrinking with the viewBox.
  const widthNow = () => { const w = Math.round(root.clientWidth); return w >= 280 ? Math.min(w, 1400) : DEFAULT_W; };

  function draw() {
    W = widthNow();
    const { series, height = 320, yFormat = (v) => v.toFixed(2), baseline, refLines = [] } = cur;
    const H = height;
    const base = series[0].dates;
    const n = base.length;
    const all = series.flatMap((x) => x.values).filter(isNum);
    if (!n || !all.length) {
      root.replaceChildren(h('div', { class: 'state' }, 'No data to chart.'));
      return;
    }
    let lo = Math.min(...all), hi = Math.max(...all);
    if (isNum(baseline)) { lo = Math.min(lo, baseline); hi = Math.max(hi, baseline); }
    for (const r of refLines) { lo = Math.min(lo, r.value); hi = Math.max(hi, r.value); }
    if (series.some((x) => x.type === 'bars')) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    const pad = (hi - lo) * 0.06 || 1;
    lo -= pad; hi += pad;
    const ticks = niceTicks(lo, hi);
    const x = (i) => M.l + (n === 1 ? 0 : (i / (n - 1)) * (W - M.l - M.r));
    const y = (v) => M.t + (1 - (v - lo) / (hi - lo)) * (H - M.t - M.b);

    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': cur.label || 'Line chart' });
    for (const t of ticks) {
      svg.append(
        s('line', { x1: M.l, x2: W - M.r, y1: y(t), y2: y(t), style: 'stroke:var(--rule);stroke-width:1' }),
        s('text', { x: M.l - 8, y: y(t) + 4, 'text-anchor': 'end', style: 'fill:var(--ink-3);font:11px var(--font-sans)' }, yFormat(t)),
      );
    }
    const labelIdx = [0, Math.floor((n - 1) / 3), Math.floor((2 * (n - 1)) / 3), n - 1];
    for (const i of new Set(labelIdx)) {
      svg.append(s('text', { x: x(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle', style: 'fill:var(--ink-3);font:11px var(--font-sans)' }, shortDate(base[i])));
    }
    if (isNum(baseline)) {
      svg.append(s('line', { x1: M.l, x2: W - M.r, y1: y(baseline), y2: y(baseline), style: 'stroke:var(--ink-3);stroke-dasharray:2 4' }));
    }
    for (const r of refLines) {
      svg.append(
        s('line', { x1: M.l, x2: W - M.r, y1: y(r.value), y2: y(r.value), style: 'stroke:var(--ink-3);stroke-dasharray:3 3' }),
        s('text', { x: W - M.r - 2, y: y(r.value) - 3, 'text-anchor': 'end', style: 'fill:var(--ink-3);font:10px var(--font-sans)' }, r.label || String(r.value)),
      );
    }
    for (const sr of series) {
      if (sr.type === 'bars') {
        const bw = Math.max(1, ((W - M.l - M.r) / n) * 0.7);
        sr.values.forEach((v, i) => {
          if (!isNum(v)) return;
          svg.append(s('rect', { x: x(i) - bw / 2, y: Math.min(y(v), y(0)), width: bw, height: Math.max(0.5, Math.abs(y(v) - y(0))), style: `fill:var(--${v >= 0 ? 'up' : 'down'});opacity:.75` }));
        });
        continue;
      }
      let d = '';
      sr.values.forEach((v, i) => { if (isNum(v)) d += (d ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); });
      svg.append(s('path', { d, fill: 'none', style: `stroke:var(--${sr.color});stroke-width:${sr.width || 1.6};${sr.dash ? 'stroke-dasharray:5 4;' : ''}stroke-linejoin:round` }));
    }
    const cross = s('line', { y1: M.t, y2: H - M.b, style: 'stroke:var(--ink);stroke-width:1', visibility: 'hidden' });
    const dots = series.filter((sr) => sr.type !== 'bars').map((sr) => s('circle', { r: 3.5, style: `fill:var(--${sr.color});stroke:var(--paper);stroke-width:1.5`, visibility: 'hidden' }));
    svg.append(cross, ...dots);

    const hit = s('rect', { x: M.l, y: M.t, width: W - M.l - M.r, height: H - M.t - M.b, fill: 'transparent', style: 'cursor:crosshair;touch-action:pan-y' });
    svg.append(hit);

    function move(ev) {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - M.l) / (W - M.l - M.r)) * (n - 1))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      series.filter((sr) => sr.type !== 'bars').forEach((sr, k) => {
        const v = sr.values[i];
        if (isNum(v)) { dots[k].setAttribute('cx', x(i)); dots[k].setAttribute('cy', y(v)); dots[k].setAttribute('visibility', 'visible'); }
        else dots[k].setAttribute('visibility', 'hidden');
      });
      tip.hidden = false;
      tip.replaceChildren(
        h('div', {}, shortDate(base[i])),
        ...series.map((sr) => h('div', {}, `${sr.name}: ${isNum(sr.values[i]) ? yFormat(sr.values[i]) : '-'}`)),
      );
      tip.style.left = `${(x(i) / W) * 100}%`;
      tip.style.top = `${(y(series[0].values[i] ?? hi) / H) * 100}%`;
    }
    function leave() {
      cross.setAttribute('visibility', 'hidden');
      dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
      tip.hidden = true;
    }
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerleave', leave);

    root.replaceChildren(svg, tip);
    legend.replaceChildren(...series.map((sr) =>
      h('span', {}, h('i', { style: `border-top-color:var(--${sr.color});${sr.dash ? 'border-top-style:dashed' : ''}` }), sr.name)));
  }

  const wrap = h('div', {}, root, legend);
  wrap.update = (next) => { cur = { ...cur, ...next }; draw(); };
  document.addEventListener('themechange', draw);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (Math.abs(widthNow() - W) > 8) draw(); }).observe(root);
  draw();
  return wrap;
}

/** Horizontal bar list: rows [{label, value, note?, tone?}] with optional reference line. */
export function barList({ rows, max, format = (v) => String(v), reference, referenceLabel }) {
  const top = max ?? Math.max(...rows.map((r) => r.value), reference || 0) * 1.1;
  return h('div', { class: 'bars' },
    ...rows.map((r) =>
      h('div', { style: 'display:grid;grid-template-columns:150px 1fr 70px;gap:12px;align-items:center;padding:6px 0' },
        h('span', { style: 'font-size:.85rem' }, r.label),
        h('div', { class: 'meter', style: 'height:14px;background:var(--paper-2)' },
          h('div', { style: `position:absolute;left:0;top:0;bottom:0;width:${Math.max(0, (r.value / top) * 100)}%;background:var(--${r.tone || 'ink'})` }),
          isNum(reference) && h('i', { style: `left:${(reference / top) * 100}%`, title: referenceLabel || '' })),
        h('span', { class: 'num', style: 'text-align:right' }, format(r.value)))),
    isNum(reference) && referenceLabel && h('div', { class: 'muted', style: 'font-size:.75rem;margin-top:4px' }, `| ${referenceLabel}`),
  );
}
