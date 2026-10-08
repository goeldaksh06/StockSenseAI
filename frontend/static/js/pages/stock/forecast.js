import { h, mount } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { pct, money, signedPct, tone } from '../../core/format.js';
import { panel, kv } from '../../core/research.js';
import { progress, errorBox } from '../../core/ui.js';
import { term } from '../../components/explain.js';

export async function render(root, ctx) {
  const { symbol } = ctx;
  const out = h('div', {});
  const run = async () => {
    const wait = progress(`Training the model on ${symbol} (up to 40s)...`);
    mount(out, wait);
    try {
      const p = await api.predict(symbol);
      wait.stop();
      const up = p.direction === 'up';
      mount(out, kv([
        ['Model direction call', up ? 'Up' : 'Down', up ? 'up' : 'down'],
        [term('Confidence', 'confidence'), pct(p.direction_confidence * 100, 0)],
        ['Implied move', signedPct(p.predicted_return_pct), tone(p.predicted_return_pct)],
        ['Implied close', money(p.predicted_price)],
      ], 4),
      h('p', { class: 'muted', style: 'font-size:.78rem;margin-top:8px' }, `As of ${p.as_of_date}. Prices in USD formatting regardless of listing currency.`));
      ctx.setContext('forecast', { direction: p.direction, confidence: p.direction_confidence, implied_move_pct: p.predicted_return_pct, as_of: p.as_of_date });
    } catch (e) { wait.stop(); mount(out, errorBox(e, run)); }
  };
  mount(root,
    h('div', { class: 'banner' }, h('b', {}, 'Experimental. '),
      'Tested across dozens of stocks, this model has not shown a reliable edge over simply assuming the stock goes up, and its confidence scores are overconfident. See the ',
      h('a', { href: '/evidence' }, 'Evidence page'), '. Use it as a curiosity, not a signal.'),
    panel('Next-day model call', out, h('button', { class: 'btn', type: 'button', onclick: run }, 'Run the forecast model')),
    h('p', { class: 'muted' }, 'For the full lab with prediction history, baselines and a backtest, open the ',
      h('a', { href: '/analyze/' + symbol }, 'forecast lab'), ' or the ', h('a', { href: '/models?symbol=' + symbol }, 'model scoreboard'), '.'));
  ctx.setContext('forecast', { note: 'Forecast not run yet; model has no demonstrated edge (see Evidence page).' });
}
