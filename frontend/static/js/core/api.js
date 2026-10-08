import { local, cached, putCache } from './store.js';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export const token = () => local.get('token');

async function request(path, { method = 'GET', body, auth = false, timeout = 180000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token()) headers.Authorization = 'Bearer ' + token();
  try {
    const res = await fetch(path, {
      method,
      headers,
      signal: ctl.signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const d = data.detail;
      const msg = typeof d === 'string' ? d : Array.isArray(d) ? d.map((e) => e.msg).join('; ') : `Request failed (${res.status})`;
      throw new ApiError(msg, res.status);
    }
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e.name === 'AbortError') throw new ApiError('Request timed out', 0);
    throw new ApiError('Network error. Is the server reachable?', 0);
  } finally {
    clearTimeout(timer);
  }
}

/** Slow ML endpoints are cached per tab so switching pages does not retrain models. */
async function cachedGet(path, ttl) {
  const hit = cached(path, ttl);
  if (hit) return hit;
  const data = await request(path);
  putCache(path, data);
  return data;
}

export const api = {
  history: (sym, days = 365) => cachedGet(`/history/${sym}?days=${days}`, 5 * 60e3),
  predict: (sym) => request('/ml/predict', { method: 'POST', body: { symbol: sym } }),
  briefing: (sym) => request(`/briefing/${sym}`),
  modelCompare: (sym) => cachedGet(`/analysis/compare/${sym}`, 30 * 60e3),
  backtest: (sym, { variant, capital, cost }) =>
    cachedGet(
      `/analysis/backtest/${sym}?model_variant=${variant}&initial_capital=${capital}&transaction_cost_pct=${cost}`,
      30 * 60e3,
    ),
  search: (q) => request(`/research/search?q=${encodeURIComponent(q)}`),
  profile: (sym) => cachedGet(`/research/${sym}/profile`, 5 * 60e3),
  fundamentals: (sym) => cachedGet(`/research/${sym}/fundamentals`, 10 * 60e3),
  statements: (sym) => cachedGet(`/research/${sym}/statements`, 30 * 60e3),
  analysts: (sym) => cachedGet(`/research/${sym}/analysts`, 15 * 60e3),
  ownership: (sym) => cachedGet(`/research/${sym}/ownership`, 30 * 60e3),
  riskReport: (sym, bench, years) => cachedGet(`/research/${sym}/risk?years=${years}${bench ? '&benchmark=' + encodeURIComponent(bench) : ''}`, 10 * 60e3),
  technicals: (sym, days = 1260) => cachedGet(`/research/${sym}/technicals?days=${days}`, 10 * 60e3),
  news: (sym) => cachedGet(`/research/${sym}/news`, 15 * 60e3),
  compare: (symbols, years) => cachedGet(`/research/compare?symbols=${symbols.join(',')}&years=${years}`, 10 * 60e3),
  evidence: () => cachedGet('/analysis/evidence', 10 * 60e3),
  register: (email, password) => request('/users/register', { method: 'POST', body: { email, password } }),
  login: (email, password) => request('/users/login', { method: 'POST', body: { email, password } }),
  me: () => request('/users/me', { auth: true }),
  watchlist: () => request('/users/watchlist', { auth: true }),
  addWatch: (symbol) => request('/users/watchlist', { method: 'POST', body: { symbol }, auth: true }),
  removeWatch: (symbol) => request(`/users/watchlist/${symbol}`, { method: 'DELETE', auth: true }),
};
