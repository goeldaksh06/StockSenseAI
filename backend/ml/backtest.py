"""
Simple long-only backtester driven by the XGBoost model's directional
predictions on the held-out chronological test set, compared against a
buy-and-hold baseline over the same period.
"""

import numpy as np
import pandas as pd
from xgboost import XGBRegressor, XGBClassifier

from backend.ml.pipeline import (
    FEATURE_COLUMNS,
    XGB_PARAMS,
    XGB_CLASSIFIER_PARAMS,
    chronological_split,
    load_features,
)

TRADING_DAYS_PER_YEAR = 252
VALID_MODEL_VARIANTS = ("price", "return", "direction")


def _predict_test_set(
    symbol: str,
    start: str = "2018-01-01",
    end: str | None = None,
    model_variant: str = "price",
):
    if model_variant not in VALID_MODEL_VARIANTS:
        raise ValueError(f"model_variant must be one of {VALID_MODEL_VARIANTS}, got {model_variant!r}")

    df = load_features(symbol, start=start, end=end)
    train_df, val_df, test_df = chronological_split(df)
    train_full_df = pd.concat([train_df, val_df])

    result = test_df[["Close"]].copy()
    result["Actual_Next_Close"] = test_df["Target_Close"].values

    if model_variant == "price":
        model = XGBRegressor(**XGB_PARAMS)
        model.fit(train_full_df[FEATURE_COLUMNS], train_full_df["Target_Close"])
        predicted_next_close = model.predict(test_df[FEATURE_COLUMNS])
        result["Predicted_Next_Close"] = predicted_next_close
        result["Predicted_Up"] = predicted_next_close > result["Close"].values

    elif model_variant == "return":
        model = XGBRegressor(**XGB_PARAMS)
        model.fit(train_full_df[FEATURE_COLUMNS], train_full_df["Target_Return"])
        predicted_return = model.predict(test_df[FEATURE_COLUMNS])
        predicted_next_close = result["Close"].values * (1 + predicted_return)
        result["Predicted_Next_Close"] = predicted_next_close
        result["Predicted_Up"] = predicted_return > 0

    else:  # direction
        model = XGBClassifier(**XGB_CLASSIFIER_PARAMS)
        model.fit(train_full_df[FEATURE_COLUMNS], train_full_df["Target_Direction"])
        predicted_direction = model.predict(test_df[FEATURE_COLUMNS])
        # No price reconstruction is meaningful for a pure classifier; keep the
        # column for interface consistency but it's unused by the simulator.
        result["Predicted_Next_Close"] = np.nan
        result["Predicted_Up"] = predicted_direction.astype(bool)

    return result


def _max_drawdown_pct(equity_curve: np.ndarray) -> float:
    running_max = np.maximum.accumulate(equity_curve)
    drawdowns = (equity_curve - running_max) / running_max
    return float(drawdowns.min() * 100)


def _sharpe_ratio(daily_returns: np.ndarray) -> float:
    std = daily_returns.std()
    if std == 0:
        return 0.0
    return float((daily_returns.mean() / std) * np.sqrt(TRADING_DAYS_PER_YEAR))


def _simulate_long_only(
    prices: np.ndarray, in_market: np.ndarray, initial_capital: float, transaction_cost_pct: float
):
    """in_market[i] says whether the strategy wants to hold shares between
    close[i] and close[i+1]. A trade (and its cost) fires whenever this flag
    flips relative to the previous day.
    """
    cash = initial_capital
    shares = 0.0
    holding = False
    equity_curve = [initial_capital]

    for i in range(len(prices) - 1):
        want_holding = bool(in_market[i])
        price_today = prices[i]

        if want_holding and not holding:
            cost = cash * transaction_cost_pct
            cash -= cost
            shares = cash / price_today
            cash = 0.0
            holding = True
        elif not want_holding and holding:
            proceeds = shares * price_today
            cost = proceeds * transaction_cost_pct
            cash = proceeds - cost
            shares = 0.0
            holding = False

        price_tomorrow = prices[i + 1]
        equity = cash + shares * price_tomorrow
        equity_curve.append(equity)

    if holding:
        final_proceeds = shares * prices[-1]
        cash = final_proceeds * (1 - transaction_cost_pct)
        shares = 0.0
        equity_curve[-1] = cash

    return np.array(equity_curve)


def _summarize(equity_curve: np.ndarray, n_days: int) -> dict:
    total_return_pct = float((equity_curve[-1] / equity_curve[0] - 1) * 100)
    years = n_days / TRADING_DAYS_PER_YEAR
    annualized_return_pct = (
        float(((equity_curve[-1] / equity_curve[0]) ** (1 / years) - 1) * 100) if years > 0 else 0.0
    )
    daily_returns = np.diff(equity_curve) / equity_curve[:-1]
    wins = daily_returns > 0
    return {
        "total_return_pct": total_return_pct,
        "annualized_return_pct": annualized_return_pct,
        "sharpe_ratio": _sharpe_ratio(daily_returns),
        "max_drawdown_pct": _max_drawdown_pct(equity_curve),
        "win_rate_pct": float(np.mean(wins) * 100) if len(wins) else 0.0,
    }


def run_backtest(
    symbol: str,
    initial_capital: float = 10000,
    transaction_cost_pct: float = 0.001,
    start: str = "2018-01-01",
    end: str | None = None,
    model_variant: str = "price",
) -> dict:
    symbol = symbol.upper()
    test_df = _predict_test_set(symbol, start=start, end=end, model_variant=model_variant)

    prices = test_df["Close"].values
    predicted_up = test_df["Predicted_Up"].values

    strategy_equity = _simulate_long_only(prices, predicted_up, initial_capital, transaction_cost_pct)
    buy_and_hold_signal = np.ones(len(prices), dtype=bool)
    buy_and_hold_equity = _simulate_long_only(prices, buy_and_hold_signal, initial_capital, transaction_cost_pct)

    n_days = len(prices)
    return {
        "symbol": symbol,
        "model_variant": model_variant,
        "test_period": {
            "start": str(test_df.index[0].date()),
            "end": str(test_df.index[-1].date()),
            "n_days": n_days,
        },
        "strategy": _summarize(strategy_equity, n_days),
        "buy_and_hold": _summarize(buy_and_hold_equity, n_days),
    }


if __name__ == "__main__":
    import json

    print(json.dumps(run_backtest("AAPL"), indent=2, default=str))
