import { $, h, mount } from '../core/dom.js';
import { api } from '../core/api.js';
import { requireAuth } from '../core/auth.js';
import { cleanSymbol, money, signedPct, tone, isNum } from '../core/format.js';
import { toast, errorBox } from '../core/ui.js';

const out = $('#out');

function spark(values) {
  const w = 160, hgt = 34;
  const lo = Math.min(...values), hi = Math.max(...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(hgt - 2 - ((v - lo) / (hi - lo || 1)) * (hgt - 4)).toFixed(1)}`).join(' ');
  const up = values.at(-1) >= values[0];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', hgt);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  pl.setAttribute('points', pts);
  pl.setAttribute('fill', 'none');
  pl.setAttribute('style', `stroke:var(--${up ? 'up' : 'down'});stroke-width:1.5;vector-effect:non-scaling-stroke`);
  svg.append(pl);
  return svg;
}

function row(item, list) {
  const price = h('span', { class: 'num hide-s' }, '...');
  const chg = h('span', { class: 'num hide-s' }, '');
  const sparkSlot = h('div', {}, '');
  api.history(item.symbol, 60).then((d) => {
    const c = d.close;
    if (c.length < 2) return;
    sparkSlot.replaceChildren(spark(c));
    price.textContent = money(c.at(-1));
    const ch = (c.at(-1) / c[0] - 1) * 100;
    chg.textContent = signedPct(ch, 1) + ' (60d)';
    chg.className = 'num hide-s ' + tone(ch);
  }).catch(() => { price.textContent = 'n/a'; });
  return h('div', { class: 'wl-row' },
    h('a', { href: '/analyze/' + item.symbol, class: 'mono', style: 'font-weight:500' }, item.symbol),
    sparkSlot, price, chg,
    h('button', { class: 'btn ghost small', 'aria-label': 'Remove ' + item.symbol, onclick: async (e) => {
      e.currentTarget.disabled = true;
      try { await api.removeWatch(item.symbol); toast(item.symbol + ' removed'); load(); }
      catch (err) { toast(err.message, true); e.currentTarget.disabled = false; }
    } }, 'Remove'));
}

async function load() {
  let data;
  try { data = await api.watchlist(); } catch (e) { mount(out, errorBox(e, load)); return; }
  const items = data.watchlist || [];
  const input = h('input', { placeholder: 'Add ticker', maxlength: 12, style: 'width:130px;font-family:var(--font-mono);text-transform:uppercase' });
  const form = h('form', { class: 'toolbar', onsubmit: async (e) => {
    e.preventDefault();
    const s = cleanSymbol(input.value);
    if (!s) return;
    if (items.some((i) => i.symbol === s)) { toast(s + ' is already on your list', true); return; }
    try { await api.addWatch(s); input.value = ''; load(); } catch (err) { toast(err.message, true); }
  } }, h('label', { class: 'field' }, 'Ticker', input), h('button', { class: 'btn', type: 'submit' }, 'Add'));
  mount(out, form,
    items.length
      ? h('div', {}, ...items.map((i) => row(i, items)))
      : h('p', { class: 'state' }, 'Nothing here yet. Add a ticker above, or use "Add to watchlist" on the Analyze page.'));
}

if (await requireAuth()) await load();
