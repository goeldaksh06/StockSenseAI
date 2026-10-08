import { h, s } from '../core/dom.js';
import { isNum } from '../core/format.js';

const DEFAULT_W = 800;
const M = { t: 10, r: 10, b: 28, l: 58 };

/**
 * Vertical bar chart with hover tooltip. bars: [{ label, value, tone? }]; negative bars use `--down`.
 * Draws at the container's real width (re-draws on resize) so labels stay legible in narrow columns.
 * opts: { height, format, label, sign, color, maxLabels }.
 */
export function barChart({ bars, height = 220, format = (v) => String(v), label = 'Bar chart', sign = true, color = 'ink', maxLabels = 8 }) {
  const vals = bars.map((b) => b.value).filter(isNum);
  if (!vals.length) return h('div', { class: 'state' }, 'No data.');
  const root = h('div', { class: 'chart' });
  const tip = h('div', { class: 'tip', hidden: true });
  let W = DEFAULT_W;
  const widthNow = () => { const w = Math.round(root.clientWidth); return w >= 200 ? Math.min(w, 1400) : DEFAULT_W; };

  function draw() {
    W = widthNow();
    const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
    const span = hi - lo || 1;
    const y = (v) => M.t + (1 - (v - lo) / span) * (height - M.t - M.b);
    const slot = (W - M.l - M.r) / bars.length;
    const bw = Math.max(3, Math.min(48, slot * 0.62));
    const svg = s('svg', { viewBox: `0 0 ${W} ${height}`, role: 'img', 'aria-label': label });
    for (const t of [lo, (lo + hi) / 2, hi]) {
      svg.append(
        s('line', { x1: M.l, x2: W - M.r, y1: y(t), y2: y(t), style: 'stroke:var(--rule)' }),
        s('text', { x: M.l - 8, y: y(t) + 4, 'text-anchor': 'end', style: 'fill:var(--ink-3);font:11px var(--font-sans)' }, format(t)),
      );
    }
    svg.append(s('line', { x1: M.l, x2: W - M.r, y1: y(0), y2: y(0), style: 'stroke:var(--rule-strong)' }));
    const every = Math.ceil(bars.length / maxLabels);
    bars.forEach((b, i) => {
      const x = M.l + slot * i + (slot - bw) / 2;
      if (isNum(b.value)) {
        const top = Math.min(y(b.value), y(0)), hgt = Math.max(1, Math.abs(y(b.value) - y(0)));
        const col = b.tone || (sign && b.value < 0 ? 'down' : color === 'ink' ? 'accent' : color);
        svg.append(s('rect', { x, y: top, width: bw, height: hgt, rx: Math.min(6, bw / 3), style: `fill:var(--${col})` }));
        const hit = s('rect', { x: M.l + slot * i, y: M.t, width: slot, height: height - M.t - M.b, fill: 'transparent' });
        hit.addEventListener('pointerenter', () => {
          tip.hidden = false;
          tip.replaceChildren(h('div', {}, b.label), h('div', {}, format(b.value)));
          tip.style.left = `${((x + bw / 2) / W) * 100}%`;
          tip.style.top = `${(top / height) * 100}%`;
        });
        hit.addEventListener('pointerleave', () => { tip.hidden = true; });
        svg.append(hit);
      }
      if (i % every === 0) {
        svg.append(s('text', { x: x + bw / 2, y: height - 8, 'text-anchor': 'middle', style: 'fill:var(--ink-3);font:11px var(--font-sans)' }, b.label));
      }
    });
    root.replaceChildren(svg, tip);
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (Math.abs(widthNow() - W) > 8) draw(); }).observe(root);
  document.addEventListener('themechange', draw);
  draw();
  return root;
}
