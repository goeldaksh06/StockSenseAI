import { h } from '../core/dom.js';
import { cleanSymbol } from '../core/format.js';

/**
 * Ticker input with debounced autocomplete against /research/search.
 * onPick(symbol, name) fires on selection or Enter. Keyboard: up/down/enter/escape.
 */
export function tickerSearch({ onPick, placeholder = 'Search any company or ticker', value = '', autofocus = false, width = '320px' }) {
  const input = h('input', {
    type: 'text', value, placeholder, autocomplete: 'off', spellcheck: 'false', role: 'combobox',
    'aria-expanded': 'false', 'aria-autocomplete': 'list', 'aria-label': 'Search companies', style: `width:${width}`,
  });
  const list = h('ul', { class: 'ts-list', role: 'listbox', hidden: true });
  const root = h('div', { class: 'ts' }, input, list);
  let items = [], active = -1, timer, seq = 0;

  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const pick = (sym, name = '') => { close(); onPick(cleanSymbol(sym), name); };
  const paint = () => {
    list.replaceChildren(...items.map((it, i) =>
      h('li', { role: 'option', 'aria-selected': String(i === active), class: i === active ? 'on' : '', onmousedown: (e) => { e.preventDefault(); pick(it.symbol, it.name); } },
        h('b', { class: 'mono' }, it.symbol), h('span', { class: 'muted' }, ' ' + it.name), h('small', { class: 'muted' }, it.exchange))));
    list.hidden = !items.length;
    input.setAttribute('aria-expanded', String(!!items.length));
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 1) { items = []; paint(); return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const res = await fetch('/research/search?q=' + encodeURIComponent(q));
        const data = await res.json();
        if (mine !== seq) return; // a newer keystroke superseded this response
        items = (data.results || []).slice(0, 7);
        active = -1;
        paint();
      } catch { /* offline: leave the box usable for direct ticker entry */ }
    }, 220);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(-1, active - 1); paint(); }
    else if (e.key === 'Escape') close();
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && items[active]) pick(items[active].symbol, items[active].name);
      else if (input.value.trim()) pick(input.value);
    }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  if (autofocus) queueMicrotask(() => input.focus());
  root.input = input;
  return root;
}
