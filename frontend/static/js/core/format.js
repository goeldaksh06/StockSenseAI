const nf = (d) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const money = (v) => (isNum(v) ? '$' + nf(2).format(v) : '-');
export const num = (v, d = 2) => (isNum(v) ? nf(d).format(v) : '-');
export const pct = (v, d = 1) => (isNum(v) ? nf(d).format(v) + '%' : '-');
export const signedPct = (v, d = 2) => (isNum(v) ? (v > 0 ? '+' : '') + nf(d).format(v) + '%' : '-');
export const tone = (v) => (!isNum(v) || v === 0 ? '' : v > 0 ? 'up' : 'down');
export const shortDate = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
export const cleanSymbol = (v) =>
  String(v || '').trim().toUpperCase().replace(/[^A-Z0-9.\-^=]/g, '').slice(0, 12);

const SYMBOLS = { USD: '$', INR: '₹', EUR: '€', GBP: '£', JPY: '¥', CAD: 'C$', AUD: 'A$', HKD: 'HK$', CNY: '¥' };
export const currencySymbol = (c) => SYMBOLS[c] ?? (c ? c + ' ' : '');

/** 1234567890 -> 1.23B. Keeps sign; null-safe. */
export function compact(v, currency = '') {
  if (!isNum(v)) return '-';
  const abs = Math.abs(v);
  const sym = currency ? currencySymbol(currency) : '';
  const [div, suffix] = abs >= 1e12 ? [1e12, 'T'] : abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'K'] : [1, ''];
  return (v < 0 ? '-' : '') + sym + String(Number((abs / div).toFixed(2))) + suffix;
}

/** Format a fundamentals value by its declared kind. */
export function fmtKind(v, kind, currency = 'USD') {
  if (!isNum(v)) return '-';
  switch (kind) {
    case 'money': return compact(v, currency);
    case 'price': return currencySymbol(currency) + v.toFixed(2);
    case 'frac': return (v * 100).toFixed(1) + '%';
    case 'pct': return v.toFixed(1) + '%';
    case 'x': return v.toFixed(2) + 'x';
    case 'int': return compact(v);
    default: return String(v);
  }
}
