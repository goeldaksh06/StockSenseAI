"""Walk-forward evaluation of the direction model across many tickers.

Question answered: across a broad basket of stocks, and re-training through time
(not one lucky split), does the XGBoost direction classifier beat naive baselines,
and does adding market-wide inputs (index returns, volatility index) help?

Method
- Expanding window: train on all data up to day t, predict the next STEP days, repeat.
- Baselines per ticker: always-up accuracy; buy-and-hold for the trading simulation.
- Feature sets: "price" (the 21 price-derived features) vs "price+market" (adds index
  momentum, relative strength and a volatility-index level/change).
- Reported with uncertainty: per-ticker accuracy edge vs always-up, bootstrap CI of the
  mean edge across tickers, Brier skill vs base rate, and calibration bins.

Run:  python -m backend.ml.walkforward            (writes backend/ml/results/walkforward.json)
"""
import json
import sys
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf
from sklearn.metrics import brier_score_loss, roc_auc_score
from xgboost import XGBClassifier

from backend.data_fetch import download
from backend.ml.pipeline import FEATURE_COLUMNS, XGB_CLASSIFIER_PARAMS, _flatten_yf_columns, load_features

warnings.filterwarnings("ignore")

RESULTS_PATH = Path(__file__).parent / "results" / "walkforward.json"
INITIAL_TRAIN = 750
STEP = 63
COST = 0.001
THRESHOLDS = (0.5, 0.55)
MARKET_FEATURES = ["MKT_RET1", "MKT_RET5", "REL_STRENGTH5", "VOL_IDX", "VOL_IDX_CHG5"]

DEFAULT_TICKERS = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "JPM", "BAC", "V", "MA", "UNH", "JNJ", "PFE",
    "LLY", "XOM", "CVX", "WMT", "COST", "HD", "PG", "KO", "PEP", "DIS", "NFLX", "INTC", "AMD", "CSCO", "ORCL",
    "CRM", "ADBE", "BA", "CAT", "GE", "MMM", "T", "VZ", "MRK", "ABBV", "NEE",
    "RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS", "ICICIBANK.NS",
]


def market_tickers(symbol: str) -> tuple[str, str]:
    if symbol.endswith((".NS", ".BO")):
        return "^NSEI", "^INDIAVIX"
    return "SPY", "^VIX"


def _close(ticker: str, start: str) -> pd.Series:
    df = download(ticker, start=start, auto_adjust=True)
    df = _flatten_yf_columns(df)
    s = df["Close"].dropna()
    s.index = pd.to_datetime(s.index).tz_localize(None)
    return s


def build_frame(symbol: str, start: str = "2018-01-01") -> pd.DataFrame:
    df = load_features(symbol, start=start).copy()
    df.index = pd.to_datetime(df.index).tz_localize(None)
    mkt_t, vol_t = market_tickers(symbol)
    mkt, vol = _close(mkt_t, start), _close(vol_t, start)
    m1 = mkt.pct_change()
    m5 = mkt.pct_change(5)
    own5 = df["Close"].pct_change(5)
    extra = pd.DataFrame({
        "MKT_RET1": m1, "MKT_RET5": m5,
        "VOL_IDX": vol, "VOL_IDX_CHG5": vol.pct_change(5),
    })
    df = df.join(extra, how="left")
    df["REL_STRENGTH5"] = own5 - df["MKT_RET5"]
    df[MARKET_FEATURES] = df[MARKET_FEATURES].ffill()
    return df.dropna(subset=MARKET_FEATURES + FEATURE_COLUMNS)


def walk_forward(df: pd.DataFrame, features: list[str]) -> pd.DataFrame:
    """Out-of-sample probability of 'up' for every row after the initial training window."""
    probs = pd.Series(np.nan, index=df.index)
    for i in range(INITIAL_TRAIN, len(df), STEP):
        train, test = df.iloc[:i], df.iloc[i:i + STEP]
        if train["Target_Direction"].nunique() < 2:
            continue
        clf = XGBClassifier(**XGB_CLASSIFIER_PARAMS)
        clf.fit(train[features], train["Target_Direction"])
        probs.loc[test.index] = clf.predict_proba(test[features])[:, 1]
    out = df[["Target_Direction", "Target_Return"]].copy()
    out["p_up"] = probs
    return out.dropna()


def simulate(pred: pd.DataFrame, threshold: float) -> dict:
    """Long-only: hold the next day when p_up > threshold. Cost charged on each switch."""
    want = (pred["p_up"] > threshold).astype(float).values
    ret = pred["Target_Return"].values
    switches = np.abs(np.diff(np.concatenate([[0.0], want])))
    strat = want * ret - switches * COST
    bh = ret.copy()
    bh[0] -= COST

    def stats(r):
        eq = np.cumprod(1 + r)
        years = len(r) / 252
        sd = r.std()
        peak = np.maximum.accumulate(eq)
        return {
            "total_return_pct": float((eq[-1] - 1) * 100),
            "annualized_pct": float((eq[-1] ** (1 / years) - 1) * 100) if years > 0 else 0.0,
            "sharpe": float(r.mean() / sd * np.sqrt(252)) if sd > 0 else 0.0,
            "max_drawdown_pct": float(((eq - peak) / peak).min() * 100),
        }

    return {"strategy": stats(strat), "buy_hold": stats(bh), "pct_invested": float(want.mean() * 100)}


def evaluate_ticker(symbol: str) -> dict:
    df = build_frame(symbol)
    if len(df) < INITIAL_TRAIN + STEP * 3:
        raise ValueError(f"only {len(df)} usable rows")
    result = {"symbol": symbol, "rows": int(len(df))}
    for name, feats in (("price", FEATURE_COLUMNS), ("price+market", FEATURE_COLUMNS + MARKET_FEATURES)):
        pred = walk_forward(df, feats)
        y, p = pred["Target_Direction"].values, pred["p_up"].values
        base_rate = float(y.mean())
        acc = float(((p > 0.5) == (y == 1)).mean())
        always_up = base_rate  # 'always up' scores the share of up days
        brier = float(brier_score_loss(y, p))
        brier_base = float(brier_score_loss(y, np.full_like(p, y.mean())))
        entry = {
            "n_test_days": int(len(y)),
            "accuracy": acc,
            "always_up_accuracy": always_up,
            "edge_vs_always_up": acc - always_up,
            "auc": float(roc_auc_score(y, p)) if len(set(y)) > 1 else None,
            "brier": brier, "brier_baserate": brier_base, "brier_skill": 1 - brier / brier_base,
            "sim": {str(t): simulate(pred, t) for t in THRESHOLDS},
            "p_mean": float(p.mean()),
        }
        result[name] = entry
        result[f"_pred_{name}"] = pred  # stripped before saving; used for pooled calibration
    return result


def bootstrap_ci(values: np.ndarray, n: int = 5000, seed: int = 0) -> tuple[float, float]:
    rng = np.random.default_rng(seed)
    means = rng.choice(values, size=(n, len(values)), replace=True).mean(axis=1)
    return float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def aggregate(per_ticker: list[dict]) -> dict:
    agg = {}
    for name in ("price", "price+market"):
        rows = [t[name] for t in per_ticker]
        edge = np.array([r["edge_vs_always_up"] for r in rows])
        acc = np.array([r["accuracy"] for r in rows])
        skill = np.array([r["brier_skill"] for r in rows])
        auc = np.array([r["auc"] for r in rows if r["auc"] is not None])
        lo, hi = bootstrap_ci(edge)
        slo, shi = bootstrap_ci(skill)
        entry = {
            "n_tickers": len(rows),
            "mean_accuracy": float(acc.mean()),
            "mean_always_up_accuracy": float(np.mean([r["always_up_accuracy"] for r in rows])),
            "mean_edge_vs_always_up": float(edge.mean()), "edge_ci95": [lo, hi],
            "tickers_beating_always_up": int((edge > 0).sum()),
            "mean_auc": float(auc.mean()), "auc_above_0.5_tickers": int((auc > 0.5).sum()),
            "mean_brier_skill": float(skill.mean()), "brier_skill_ci95": [slo, shi],
            "sim": {},
        }
        for th in map(str, THRESHOLDS):
            s = [r["sim"][th] for r in rows]
            sharpe_diff = np.array([x["strategy"]["sharpe"] - x["buy_hold"]["sharpe"] for x in s])
            ret_diff = np.array([x["strategy"]["total_return_pct"] - x["buy_hold"]["total_return_pct"] for x in s])
            dlo, dhi = bootstrap_ci(sharpe_diff)
            entry["sim"][th] = {
                "mean_strategy_sharpe": float(np.mean([x["strategy"]["sharpe"] for x in s])),
                "mean_buyhold_sharpe": float(np.mean([x["buy_hold"]["sharpe"] for x in s])),
                "mean_sharpe_diff": float(sharpe_diff.mean()), "sharpe_diff_ci95": [dlo, dhi],
                "mean_return_diff_pct": float(ret_diff.mean()),
                "tickers_strategy_beats_buyhold_return": int((ret_diff > 0).sum()),
                "mean_pct_invested": float(np.mean([x["pct_invested"] for x in s])),
                "mean_drawdown_strategy": float(np.mean([x["strategy"]["max_drawdown_pct"] for x in s])),
                "mean_drawdown_buyhold": float(np.mean([x["buy_hold"]["max_drawdown_pct"] for x in s])),
            }
        agg[name] = entry
    return agg


def calibration(per_ticker: list[dict], name: str, bins: int = 10) -> list[dict]:
    pooled = pd.concat([t[f"_pred_{name}"] for t in per_ticker])
    pooled["bin"] = pd.cut(pooled["p_up"], np.linspace(0, 1, bins + 1), include_lowest=True)
    out = []
    for b, g in pooled.groupby("bin", observed=True):
        out.append({"lo": float(b.left), "hi": float(b.right), "n": int(len(g)),
                    "mean_pred": float(g["p_up"].mean()), "actual_up": float(g["Target_Direction"].mean())})
    return out


def main(tickers: list[str] | None = None) -> dict:
    tickers = tickers or DEFAULT_TICKERS
    per_ticker, failed = [], []
    t0 = time.time()
    for k, sym in enumerate(tickers, 1):
        try:
            r = evaluate_ticker(sym)
            per_ticker.append(r)
            p = r["price"]
            print(f"[{k}/{len(tickers)}] {sym:<12} acc={p['accuracy']:.3f} always_up={p['always_up_accuracy']:.3f} "
                  f"auc={p['auc']:.3f} | +market acc={r['price+market']['accuracy']:.3f}  ({time.time() - t0:.0f}s)", flush=True)
        except Exception as e:
            failed.append({"symbol": sym, "error": str(e)[:120]})
            print(f"[{k}/{len(tickers)}] {sym:<12} FAILED: {e}", flush=True)
    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {"initial_train_days": INITIAL_TRAIN, "retrain_every_days": STEP, "cost_per_switch": COST,
                   "thresholds": list(THRESHOLDS), "window": "expanding", "model": "XGBClassifier (same params as live app)",
                   "feature_sets": {"price": len(FEATURE_COLUMNS), "price+market": len(FEATURE_COLUMNS) + len(MARKET_FEATURES)}},
        "failed": failed,
        "aggregate": aggregate(per_ticker),
        "calibration": {n: calibration(per_ticker, n) for n in ("price", "price+market")},
        "tickers": [{k: v for k, v in t.items() if not k.startswith("_pred_")} for t in per_ticker],
    }
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULTS_PATH.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"\nWrote {RESULTS_PATH} in {time.time() - t0:.0f}s")
    return out


if __name__ == "__main__":
    main(sys.argv[1:] or None)
