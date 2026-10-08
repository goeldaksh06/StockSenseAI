/** What the current page is showing, so the copilot answers from the same numbers the user sees. */
let ctx = { page: '', symbol: '', data: {} };

export const setPageContext = (next) => { ctx = { page: '', symbol: '', data: {}, ...next }; };
export const getPageContext = () => ctx;

const round = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(d) : v);
export { round };
