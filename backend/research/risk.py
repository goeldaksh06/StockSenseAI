"""Risk and performance statistics computed from price history (no forecasting)."""
import numpy as np
import pandas as pd
import yfinance as yf

from backend.data_fetch import download
from backend.ml.pipeline import SymbolNotFoundError, _flatten_yf_columns
from backend.research.cache import ttl_cache
from backend.research.market import _norm, require_symbol
from backend.research.util import clean, num

TRADING_DAYS = 252


def default_benchmark(symbol: str) -> str:
    s = symbol.upper()
    if s.endswith((".NS", ".BO")):
        return "^NSEI"
    if s.endswith(".L"):
        return "^FTSE"
    if s.endswith(".T"):
        return "^N225"
    return "SPY"


@ttl_cache(60 * 15)
def prices(symbol: str, years: int = 5) -> pd.DataFrame:
    start = (pd.Timestamp.today() - pd.DateOffset(years=years, days=10)).strftime("%Y-%m-%d")
    df = download(symbol, start=start, auto_adjust=True)
    if df is None or df.empty:
        raise SymbolNotFoundError(f"No price data found for '{symbol}'.")
    df = _flatten_yf_columns(df)
    df.index = pd.to_datetime(df.index).tz_localize(None)
    return df


def _period_returns(close: pd.Series) -> dict:
    last, out = close.iloc[-1], {}
    for label, days in (("1M", 21), ("3M", 63), ("6M", 126), ("1Y", 252), ("3Y", 756), ("5Y", 1260)):
        if len(close) > days:
            out[label] = float(last / close.iloc[-1 - days] - 1) * 100
    ytd = close[close.index.year == close.index[-1].year]
    prev = close[close.index.year < close.index[-1].year]
    if len(ytd) and len(prev):
        out["YTD"] = float(last / prev.iloc[-1] - 1) * 100
    return out


def _weekly(s: pd.Series) -> pd.Series:
    return s.resample("W-FRI").last().dropna()


def risk_report(symbol: str, benchmark: str | None = None, years: int = 3) -> dict:
    s = require_symbol(symbol)
    bench = _norm((benchmark or default_benchmark(s)))
    df = prices(s, 5)
    close = df["Close"].dropna()
    if len(close) < 60:
        raise SymbolNotFoundError(
            f"{s} only has {len(close)} trading days of price history (since {close.index[0].date().isoformat()}). "
            "Risk statistics need at least 60 days, so this works for established listings but not brand-new ones."
        )

    window = close[close.index >= close.index[-1] - pd.DateOffset(years=years)]
    rets = window.pct_change().dropna()

    drawdown = window / window.cummax() - 1
    ann_vol = float(rets.std() * np.sqrt(TRADING_DAYS))
    ann_ret = float((window.iloc[-1] / window.iloc[0]) ** (TRADING_DAYS / max(len(rets), 1)) - 1)
    var95 = float(-np.percentile(rets, 5))
    var99 = float(-np.percentile(rets, 1))
    cvar95 = float(-rets[rets <= np.percentile(rets, 5)].mean())

    beta = corr = r2 = alpha = None
    bench_series = None
    try:
        b_close = prices(bench, 5)["Close"].dropna()
        b_window = b_close[b_close.index >= window.index[0]]
        joined = pd.concat([window.pct_change(), b_window.pct_change()], axis=1, join="inner").dropna()
        joined.columns = ["a", "b"]
        if len(joined) > 60:
            cov = np.cov(joined["a"], joined["b"])
            beta = float(cov[0, 1] / cov[1, 1])
            corr = float(joined["a"].corr(joined["b"]))
            r2 = corr ** 2
            alpha = float((joined["a"].mean() - beta * joined["b"].mean()) * TRADING_DAYS)
            both = pd.concat([window, b_window], axis=1, join="inner").dropna()
            both.columns = ["a", "b"]
            both = both / both.iloc[0] * 100
            wk = both.resample("W-FRI").last().dropna()
            bench_series = {"dates": [d.date().isoformat() for d in wk.index],
                            "asset": [round(v, 2) for v in wk["a"]], "benchmark": [round(v, 2) for v in wk["b"]]}
    except Exception:
        pass

    roll = rets.rolling(60).std().dropna() * np.sqrt(TRADING_DAYS) * 100
    roll_w, dd_w = _weekly(roll), _weekly(drawdown * 100)

    best = rets.nlargest(3)
    worst = rets.nsmallest(3)
    return clean({
        "symbol": s,
        "benchmark": bench,
        "window_years": years,
        "stats": {
            "annualized_return_pct": ann_ret * 100,
            "annualized_volatility_pct": ann_vol * 100,
            "sharpe": (ann_ret / ann_vol) if ann_vol else None,
            "max_drawdown_pct": float(drawdown.min() * 100),
            "current_drawdown_pct": float(drawdown.iloc[-1] * 100),
            "var95_1d_pct": var95 * 100,
            "var99_1d_pct": var99 * 100,
            "cvar95_1d_pct": cvar95 * 100,
            "beta": beta, "correlation": corr, "r_squared": r2, "alpha_annual_pct": (alpha * 100) if alpha is not None else None,
            "positive_days_pct": float((rets > 0).mean() * 100),
            "best_day": {"date": best.index[0].date().isoformat(), "pct": float(best.iloc[0] * 100)},
            "worst_day": {"date": worst.index[0].date().isoformat(), "pct": float(worst.iloc[0] * 100)},
        },
        "returns": _period_returns(close),
        "series": {
            "vol": {"dates": [d.date().isoformat() for d in roll_w.index], "values": [round(v, 2) for v in roll_w]},
            "drawdown": {"dates": [d.date().isoformat() for d in dd_w.index], "values": [round(v, 2) for v in dd_w]},
            "vs_benchmark": bench_series,
        },
        "histogram": _histogram(rets * 100),
    })


def _histogram(daily_pct: pd.Series, bins: int = 31) -> dict:
    lim = float(max(abs(daily_pct.quantile(0.01)), abs(daily_pct.quantile(0.99))))
    counts, edges = np.histogram(daily_pct.clip(-lim, lim), bins=bins, range=(-lim, lim))
    return {"edges": [round(float(e), 3) for e in edges], "counts": [int(c) for c in counts]}


def compare(symbols: list[str], years: int = 3) -> dict:
    """Normalised performance, per-asset risk stats and the return correlation matrix."""
    syms = []
    for raw in symbols[:6]:
        s = require_symbol(raw)
        if s not in syms:
            syms.append(s)
    series = {s: prices(s, 5)["Close"].dropna() for s in syms}
    start = max(max(v.index[0] for v in series.values()), pd.Timestamp.today() - pd.DateOffset(years=years))
    frame = pd.concat({s: v[v.index >= start] for s, v in series.items()}, axis=1, join="inner").dropna()
    if len(frame) < 30:
        # Name the culprit instead of a generic failure: usually a recent IPO or a newly listed fund.
        shortest = min(series, key=lambda k: len(series[k]))
        n, first = len(series[shortest]), series[shortest].index[0].date().isoformat()
        raise SymbolNotFoundError(
            f"{shortest} only has {n} trading days of price history (since {first}). "
            f"Comparison needs at least 30 days in common, so remove {shortest} or wait for more history."
        )
    rets = frame.pct_change().dropna()
    norm = frame / frame.iloc[0] * 100
    wk = norm.resample("W-FRI").last().dropna()
    stats = {}
    for s in syms:
        r, c = rets[s], frame[s]
        dd = c / c.cummax() - 1
        vol = float(r.std() * np.sqrt(TRADING_DAYS))
        ann = float((c.iloc[-1] / c.iloc[0]) ** (TRADING_DAYS / len(r)) - 1)
        stats[s] = {"total_return_pct": float(c.iloc[-1] / c.iloc[0] - 1) * 100, "annualized_return_pct": ann * 100,
                    "volatility_pct": vol * 100, "sharpe": (ann / vol) if vol else None,
                    "max_drawdown_pct": float(dd.min() * 100)}
    corr = rets.corr()
    return clean({
        "symbols": syms, "start": frame.index[0].date().isoformat(), "end": frame.index[-1].date().isoformat(),
        "dates": [d.date().isoformat() for d in wk.index],
        "series": {s: [round(v, 2) for v in wk[s]] for s in syms},
        "stats": stats,
        "correlation": {"labels": syms, "matrix": [[num(corr.loc[a, b]) for b in syms] for a in syms]},
    })
