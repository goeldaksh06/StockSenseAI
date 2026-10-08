import { h } from '../core/dom.js';
import { GLOSSARY } from '../core/glossary.js';

/** Dotted-underline label with a plain-English definition on hover or keyboard focus. */
export function term(label, key) {
  return h('span', { class: 'term', tabindex: '0', 'data-tip': GLOSSARY[key] || '' }, label);
}

/** Collapsible "how to read this" box. */
export function explainBox(title, paragraphs, details) {
  return h('aside', { class: 'explain' },
    h('h3', {}, title),
    ...paragraphs.map((p) => h('p', {}, p)),
    details && h('details', {}, h('summary', {}, details.title), ...details.items.map((p) => h('p', { class: 'muted' }, p))));
}
