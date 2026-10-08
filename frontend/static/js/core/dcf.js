/**
 * Two-stage discounted cash flow, deliberately simple and transparent.
 * Stage 1: `years` of free cash flow growing at `growth`, fading linearly to `terminal` by the final year.
 * Stage 2: Gordon-growth terminal value on the final year's cash flow.
 * Returns equity value per share. Pure functions so they can be unit tested.
 */
export function dcfValue({ fcf, growth, terminal, discount, years = 10, cash = 0, debt = 0, shares }) {
  if (!(fcf > 0) || !(shares > 0) || discount <= terminal) return null;
  let cf = fcf;
  let pv = 0;
  for (let t = 1; t <= years; t++) {
    const g = growth + ((terminal - growth) * (t - 1)) / Math.max(years - 1, 1);
    cf *= 1 + g;
    pv += cf / (1 + discount) ** t;
  }
  const tv = (cf * (1 + terminal)) / (discount - terminal);
  const enterprise = pv + tv / (1 + discount) ** years;
  const equity = enterprise + cash - debt;
  return { perShare: equity / shares, enterprise, equity, terminalShare: tv / (1 + discount) ** years / enterprise };
}

/** Growth rate the market price implies, found by bisection on the DCF. Null if no solution in range. */
export function impliedGrowth(params, price) {
  let lo = -0.2, hi = 0.6;
  const f = (g) => (dcfValue({ ...params, growth: g })?.perShare ?? NaN) - price;
  if (!(f(lo) < 0 && f(hi) > 0)) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** CAPM cost of equity with simple defaults, clamped to a sane band for the calculator. */
export function costOfEquity(beta, riskFree = 0.04, premium = 0.05) {
  const b = Number.isFinite(beta) ? beta : 1;
  return Math.min(0.15, Math.max(0.06, riskFree + b * premium));
}
