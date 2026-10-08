import { h, mount } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { pct, num } from '../../core/format.js';
import { panel, kv } from '../../core/research.js';
import { segmented } from '../../components/table.js';
import { term } from '../../components/explain.js';

const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);

export async function render(root, ctx) {
  const d = await api.news(ctx.symbol);
  const s = d.sentiment;
  if (!d.articles.length) {
    mount(root, h('p', { class: 'state' }, 'No recent headlines naming this company were found (or news is not configured on this server).'));
    ctx.setContext('news', { articles: 0 });
    return;
  }
  let filter = 'All';
  const list = h('ul', { class: 'list' });
  const draw = () => mount(list, ...d.articles.filter((a) => filter === 'All' || a.label === filter).map((a) => {
    const url = safeUrl(a.url);
    return h('li', { style: 'align-items:flex-start' },
      h('span', {}, url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, a.title) : a.title,
        h('br'), h('span', { class: 'muted', style: 'font-size:.75rem' }, [a.source, a.published_at?.slice(0, 10)].filter(Boolean).join(' · '))),
      h('span', { class: 'tag ' + (a.label === 'Positive' ? 'up' : a.label === 'Negative' ? 'down' : 'muted') }, a.label));
  }));
  draw();
  mount(root,
    kv([[term('Tone', 'sentiment'), `${s.label} (${num(s.overall_score, 2)})`, s.overall_score > 0.05 ? 'up' : s.overall_score < -0.05 ? 'down' : ''], ['Positive', pct(s.positive_pct, 0), 'up'], ['Neutral', pct(s.neutral_pct, 0)], ['Negative', pct(s.negative_pct, 0), 'down'], ['Articles', String(s.article_count)]], 5),
    h('p', { class: 'muted', style: 'font-size:.78rem;margin:8px 0' }, 'Headlines from the last 14 days that name the company, scored for tone by a word-based model (it reads wording, not facts or context). Not used by the forecast model.'),
    panel('Headlines', segmented(['All', 'Positive', 'Neutral', 'Negative'].map((v) => ({ label: v, value: v })), filter, (v) => { filter = v; draw(); }, 'Filter'), list));
  ctx.setContext('news', { sentiment: s, headline_count: d.articles.length });
}
