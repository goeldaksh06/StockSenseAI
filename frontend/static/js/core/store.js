/** Safe wrappers: storage can throw (private mode), so fall back to memory. */
const mem = new Map();

export const local = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return mem.has(key) ? mem.get(key) : fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { mem.set(key, value); }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    mem.delete(key);
  },
};

export function cached(key, ttlMs) {
  try {
    const raw = sessionStorage.getItem('c:' + key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    return Date.now() - t < ttlMs ? v : null;
  } catch { return null; }
}

export function putCache(key, value) {
  try { sessionStorage.setItem('c:' + key, JSON.stringify({ t: Date.now(), v: value })); } catch { /* quota */ }
}

export const recentSymbols = () => local.get('recent', []);

export function pushRecent(sym) {
  const list = [sym, ...recentSymbols().filter((x) => x !== sym)].slice(0, 8);
  local.set('recent', list);
  return list;
}
