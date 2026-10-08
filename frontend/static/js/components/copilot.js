import { h, mount } from '../core/dom.js';
import { getPageContext } from '../core/pageContext.js';

const SUGGESTIONS = {
  analyze: ['What does this forecast mean?', 'Why is the confidence not higher?', 'What does the RSI tell me here?'],
  models: ['Did any model beat the baseline?', 'Why is accuracy so low?', 'What is "always up"?'],
  backtest: ['Did the strategy beat buy and hold?', 'What does Sharpe ratio mean?', 'Why was it barely invested?'],
  default: ['How does this site work?', 'Why is accuracy low?', 'What is a baseline?'],
  stock: ['Summarise this company from the data here', 'Which checks does it fail?', 'What does this metric mean?'],
  compare: ['Which looks cheapest on these numbers?', 'Which has the best risk-adjusted return?', 'How correlated are they?'],
  evidence: ['Does the model beat the baseline?', 'What is Brier skill?', 'Why not trust the confidence score?'],
};

/** The server caps page data at 8KB; drop the largest sections first rather than failing. */
function fit(data, limit = 7500) {
  const copy = { ...data };
  while (JSON.stringify(copy).length > limit) {
    const biggest = Object.keys(copy).sort((a, b) => JSON.stringify(copy[b]).length - JSON.stringify(copy[a]).length)[0];
    if (!biggest) break;
    delete copy[biggest];
  }
  return copy;
}

async function ask(question, history) {
  const { page, symbol, data } = getPageContext();
  const trimmed = fit(data);
  const res = await fetch('/copilot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, page, symbol, context: trimmed, history }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 404) throw new Error('The assistant is not available on this server version. Restart the server to enable it.');
  if (!res.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'The assistant is unavailable right now.');
  return body.answer;
}

export function initCopilot() {
  const history = [];
  const log = h('div', { class: 'cp-log', role: 'log', 'aria-live': 'polite' });
  const input = h('input', { type: 'text', maxlength: 500, placeholder: 'Ask about what you see here', 'aria-label': 'Your question' });
  const sendBtn = h('button', { class: 'btn small', type: 'submit' }, 'Ask');
  const chips = h('div', { class: 'chips' });
  let busy = false;

  const add = (role, text, extra = '') => {
    const el = h('div', { class: `cp-msg ${role} ${extra}` }, text);
    log.append(el);
    log.scrollTop = log.scrollHeight;
    return el;
  };

  async function send(q) {
    q = q.trim();
    if (!q || busy) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = '';
    chips.hidden = true;
    add('user', q);
    const pending = add('bot', 'Thinking...', 'pending');
    try {
      const answer = await ask(q, history.slice(-6));
      pending.textContent = answer;
      pending.className = 'cp-msg bot';
      history.push({ role: 'user', content: q }, { role: 'assistant', content: answer });
    } catch (e) {
      pending.textContent = e.message;
      pending.className = 'cp-msg bot err';
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  const panel = h('section', { class: 'cp-panel', hidden: true, 'aria-label': 'Site assistant' },
    h('header', {}, h('strong', {}, 'Ask about this page'),
      h('button', { class: 'cp-x', type: 'button', 'aria-label': 'Close assistant', onclick: () => toggle(false) }, 'x')),
    h('p', { class: 'muted', style: 'font-size:.75rem;margin:0 0 8px' },
      'Answers come only from this site\'s data and method notes, not the wider internet. Not financial advice.'),
    log, chips,
    h('form', { class: 'cp-form', onsubmit: (e) => { e.preventDefault(); send(input.value); } }, input, sendBtn));

  const fab = h('button', { class: 'cp-fab btn', type: 'button', 'aria-expanded': 'false', onclick: () => toggle(panel.hidden) }, 'Ask');

  function toggle(open) {
    panel.hidden = !open;
    fab.setAttribute('aria-expanded', String(open));
    if (open) {
      const key = (getPageContext().page || '').split(':')[0];
      mount(chips, ...(SUGGESTIONS[key] || SUGGESTIONS.default).map((q) =>
        h('button', { type: 'button', class: 'chip', onclick: () => send(q) }, q)));
      if (!log.childElementCount) add('bot', 'Ask me about the numbers on this page, what a term means, or how the models were tested.');
      input.focus();
    }
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) toggle(false); });
  document.body.append(panel, fab);
}
