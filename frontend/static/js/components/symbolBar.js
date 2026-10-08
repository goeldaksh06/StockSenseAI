import { h } from '../core/dom.js';
import { cleanSymbol } from '../core/format.js';
import { recentSymbols, pushRecent } from '../core/store.js';

/**
 * Symbol input + recent chips. onSubmit(symbol) fires on submit or chip click.
 * Extra controls can be passed in `extra` and render beside the input.
 */
export function symbolBar({ initial = '', onSubmit, extra = [], submitLabel = 'Analyze' }) {
  const input = h('input', { id: 'sym', name: 'symbol', value: initial, placeholder: 'AAPL', autocomplete: 'off', spellcheck: 'false', maxlength: 12, style: 'width:130px;font-family:var(--font-mono);text-transform:uppercase' });
  const chips = h('div', { class: 'chips' });

  function go(raw) {
    const sym = cleanSymbol(raw);
    if (!sym) { input.focus(); return; }
    input.value = sym;
    pushRecent(sym);
    drawChips();
    onSubmit(sym);
  }
  function drawChips() {
    const list = recentSymbols();
    chips.replaceChildren(...list.map((sy) => h('button', { type: 'button', class: 'chip', onclick: () => go(sy) }, sy)));
  }
  drawChips();

  const form = h('form', { class: 'toolbar', onsubmit: (e) => { e.preventDefault(); go(input.value); } },
    h('label', { class: 'field' }, 'Ticker', input),
    ...extra,
    h('button', { class: 'btn', type: 'submit' }, submitLabel),
    chips);
  return { el: form, input, go };
}
