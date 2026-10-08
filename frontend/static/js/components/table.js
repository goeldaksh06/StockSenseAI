import { h } from '../core/dom.js';

/**
 * Sortable table. columns: [{ key, label, fmt?, sortable?, cls? }]; rows are plain objects.
 * opts.best(row) -> boolean highlights a row.
 */
export function dataTable(columns, rows, opts = {}) {
  let sortKey = opts.sortKey ?? null;
  let dir = opts.dir ?? -1;
  const table = h('table', { class: 'data' });

  function render() {
    const sorted = [...rows];
    if (sortKey) {
      sorted.sort((a, b) => {
        const x = a[sortKey], y = b[sortKey];
        if (x == null) return 1;
        if (y == null) return -1;
        return (x > y ? 1 : x < y ? -1 : 0) * dir;
      });
    }
    table.replaceChildren(
      h('thead', {}, h('tr', {}, ...columns.map((c) =>
        h('th', {
          'data-sort': c.sortable === false ? null : '',
          'aria-sort': sortKey === c.key ? (dir > 0 ? 'ascending' : 'descending') : null,
          onclick: c.sortable === false ? null : () => {
            dir = sortKey === c.key ? -dir : -1;
            sortKey = c.key;
            render();
          },
        }, c.label, sortKey === c.key ? (dir > 0 ? ' ▲' : ' ▼') : '')))),
      h('tbody', {}, ...sorted.map((r) =>
        h('tr', { class: opts.best?.(r) ? 'best' : '' }, ...columns.map((c) =>
          h('td', { class: c.cls || 'num' }, c.fmt ? c.fmt(r[c.key], r) : r[c.key]))))),
    );
  }
  render();
  return h('div', { class: 'scroll-x' }, table);
}

export function segmented(options, value, onChange, label) {
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  const draw = () => el.replaceChildren(...options.map((o) =>
    h('button', {
      type: 'button',
      'aria-pressed': String(o.value === value),
      onclick: () => { value = o.value; draw(); onChange(value); },
    }, o.label)));
  draw();
  return el;
}
