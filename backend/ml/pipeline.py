"""
Rigorous ML pipeline for StockSenseAI: feature engineering, chronological
splitting, leakage-safe scaling, baseline models, metrics, and a model
comparison harness. Kept separate from train_model.py by design.
"""

import time

import numpy as np
import pandas as pd
import yfinance as yf
from datetime import datetime

from backend.data_fetch import download
from ta.momentum import RSIIndicator, ROCIndicator
from ta.trend import MACD, SMAIndicator, EMAIndicator
from ta.volatility import BollingerBands, AverageTrueRange
from ta.volume import OnBalanceVolumeIndicator

from sklearn.preprocessing import MinMaxScaler
from sklearn.linear_model import LinearRegression
from sklearn.metrics import (
    mean_absolute_error,
    mean_squared_error,
    median_absolute_error,
    r2_score,
)

from sklearn.metrics import accuracy_score, precision_score, recall_score

from xgboost import XGBRegressor, XGBClassifier

XGB_PARAMS = dict(
    n_estimators=300,
    learning_rate=0.05,
    max_depth=6,
    subsample=0.8,
    colsample_bytree=0.8,
    random_state=42,
    n_jobs=-1,
)

XGB_CLASSIFIER_PARAMS = dict(
    n_estimators=300,
    learning_rate=0.05,
    max_depth=6,
    subsample=0.8,
    colsample_bytree=0.8,
    random_state=42,
    n_jobs=-1,
)


class SymbolNotFoundError(ValueError):
    """Yahoo Finance has no price data for this ticker (typo, delisted, unsupported)."""


def _flatten_yf_columns(data: pd.DataFrame) -> pd.DataFrame:
    if isinstance(data.columns, pd.MultiIndex):
        data.columns = [c[0] for c in data.columns]
    return data.astype(float)


def _download_with_retry(symbol: str, retries: int = 1, **kwargs) -> pd.DataFrame:
    """yfinance occasionally returns an empty frame on a transient Yahoo
    Finance hiccup rather than raising — retry a couple times before giving
    up, since a live demo shouldn't hard-fail on a one-off blip.
    """
    last_error = None
    for attempt in range(retries + 1):
        try:
            data = download(symbol, **kwargs)
            if not data.empty:
                return data
            last_error = SymbolNotFoundError(f"No price data found for '{symbol}'. Check the ticker symbol.")
        except Exception as e:
            last_error = e
        if attempt < retries:
            time.sleep(1.5 * (attempt + 1))
    if isinstance(last_error, SymbolNotFoundError):
        raise last_error
    raise RuntimeError(f"Could not fetch data for {symbol}: {last_error}")


def load_features(symbol: str, start: str = "2018-01-01", end: str | None = None) -> pd.DataFrame:
    symbol = symbol.upper()
    end = end or datetime.today().strftime("%Y-%m-%d")

    data = _download_with_retry(symbol, start=start, end=end, auto_adjust=True, progress=False)
    data = _flatten_yf_columns(data)

    close = data["Close"]
    high = data["High"]
    low = data["Low"]
    volume = data["Volume"]

    data["SMA5"] = SMAIndicator(close, window=5).sma_indicator()
    data["SMA10"] = SMAIndicator(close, window=10).sma_indicator()
    data["SMA20"] = SMAIndicator(close, window=20).sma_indicator()
    data["SMA50"] = SMAIndicator(close, window=50).sma_indicator()
    # SMA200 needs 200 days of prior history to produce its first value; combined
    # with dropna() below this can shrink an already-short history a lot, so we
    # print a warning if the resulting frame looks too small to train on.
    data["SMA200"] = SMAIndicator(close, window=200).sma_indicator()
    data["EMA12"] = EMAIndicator(close, window=12).ema_indicator()
    data["EMA26"] = EMAIndicator(close, window=26).ema_indicator()

    data["RSI"] = RSIIndicator(close, window=14).rsi()
    macd = MACD(close)
    data["MACD"] = macd.macd()
    data["MACD_Signal"] = macd.macd_signal()
    data["ROC"] = ROCIndicator(close).roc()

    bb = BollingerBands(close, window=20, window_dev=2)
    data["BB_Upper"] = bb.bollinger_hband()
    data["BB_Lower"] = bb.bollinger_lband()
    data["BB_Width"] = data["BB_Upper"] - data["BB_Lower"]
    data["ATR"] = AverageTrueRange(high, low, close, window=14).average_true_range()

    data["OBV"] = OnBalanceVolumeIndicator(close, volume).on_balance_volume()

    data["Target_Close"] = data["Close"].shift(-1)
    data["Target_Return"] = data["Close"].pct_change().shift(-1)
    data["Target_Direction"] = (data["Target_Return"] > 0).astype(int)

    before = len(data)
    data = data.dropna().copy()
    after = len(data)
    if after < 300:
        print(
            f"WARNING: only {after} usable rows left for {symbol} after indicator "
            f"warmup + dropna (started with {before}). SMA200/BB/ATR need long "
            f"warmup periods; consider an earlier `start` date for more data."
        )

    return data


FEATURE_COLUMNS = [
    "Open", "High", "Low", "Close", "Volume",
    "SMA5", "SMA10", "SMA20", "SMA50", "SMA200", "EMA12", "EMA26",
    "RSI", "MACD", "MACD_Signal", "ROC",
    "BB_Upper", "BB_Lower", "BB_Width", "ATR", "OBV",
]


def chronological_split(df: pd.DataFrame, train_frac: float = 0.7, val_frac: float = 0.15):
    """Pure positional slicing — the data is already time-ordered by yfinance.

    Shuffling a time series before splitting would let the model train on rows
    that occur *after* rows in the validation/test set, leaking future
    information (e.g. via overlapping indicator windows) into training. So we
    never shuffle here, and any downstream sampling must preserve order.
    """
    n = len(df)
    train_end = int(n * train_frac)
    val_end = int(n * (train_frac + val_frac))
    train_df = df.iloc[:train_end].copy()
    val_df = df.iloc[train_end:val_end].copy()
    test_df = df.iloc[val_end:].copy()
    return train_df, val_df, test_df


def fit_scaler(train_df: pd.DataFrame, feature_cols: list[str]) -> MinMaxScaler:
    scaler = MinMaxScaler()
    scaler.fit(train_df[feature_cols])
    return scaler


def apply_scaler(scaler: MinMaxScaler, df: pd.DataFrame, feature_cols: list[str]) -> pd.DataFrame:
    out = df.copy()
    out[feature_cols] = scaler.transform(df[feature_cols])
    return out


def baseline_previous_close(df: pd.DataFrame) -> np.ndarray:
    return df["Close"].values


def baseline_moving_average(df: pd.DataFrame, window: int = 20) -> np.ndarray:
    return df["Close"].rolling(window=window, min_periods=1).mean().values


def baseline_linear_regression(
    train_df: pd.DataFrame, test_df: pd.DataFrame, feature_cols: list[str], target_col: str
) -> np.ndarray:
    model = LinearRegression()
    model.fit(train_df[feature_cols], train_df[target_col])
    return model.predict(test_df[feature_cols])


def compute_metrics(y_true, y_pred) -> dict:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    mape = float(np.mean(np.abs((y_true - y_pred) / y_true)) * 100)
    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "mape": mape,
        "r2": float(r2_score(y_true, y_pred)),
        "median_ae": float(median_absolute_error(y_true, y_pred)),
    }


def directional_accuracy(y_true_prices, y_pred_prices, previous_prices) -> float:
    """Fraction of correct up/down calls, each measured against the same
    previously-known price (not against each other), so a model that just
    echoes yesterday's trend doesn't get free credit.
    """
    y_true_prices = np.asarray(y_true_prices, dtype=float)
    y_pred_prices = np.asarray(y_pred_prices, dtype=float)
    previous_prices = np.asarray(previous_prices, dtype=float)

    actual_dir = np.sign(y_true_prices - previous_prices)
    pred_dir = np.sign(y_pred_prices - previous_prices)
    correct = actual_dir == pred_dir
    return float(np.mean(correct))


def _print_comparison_table(symbol: str, results: dict) -> None:
    headers = ["model", "mae", "rmse", "mape", "r2", "directional_accuracy"]
    print(f"\nModel comparison for {symbol}")
    print("-" * 90)
    print(f"{headers[0]:<20}{headers[1]:>12}{headers[2]:>12}{headers[3]:>12}{headers[4]:>10}{headers[5]:>18}")
    print("-" * 90)
    for name, m in results.items():
        print(
            f"{name:<20}{m['mae']:>12.4f}{m['rmse']:>12.4f}{m['mape']:>11.2f}%"
            f"{m['r2']:>10.4f}{m['directional_accuracy']:>17.2%}"
        )
    print("-" * 90)


def compare_models(symbol: str, start: str = "2018-01-01", end: str | None = None) -> dict:
    symbol = symbol.upper()
    df = load_features(symbol, start=start, end=end)
    train_df, val_df, test_df = chronological_split(df)
    train_full_df = pd.concat([train_df, val_df])

    prev_prices_test = test_df["Close"].values
    true_prices_test = test_df["Target_Close"].values

    results = {}

    pred_prev_close = baseline_previous_close(test_df)
    results["previous_close"] = {
        **compute_metrics(true_prices_test, pred_prev_close),
        "directional_accuracy": directional_accuracy(true_prices_test, pred_prev_close, prev_prices_test),
    }

    pred_ma = baseline_moving_average(test_df, window=20)
    results["moving_average"] = {
        **compute_metrics(true_prices_test, pred_ma),
        "directional_accuracy": directional_accuracy(true_prices_test, pred_ma, prev_prices_test),
    }

    pred_lr = baseline_linear_regression(train_full_df, test_df, FEATURE_COLUMNS, "Target_Close")
    results["linear_regression"] = {
        **compute_metrics(true_prices_test, pred_lr),
        "directional_accuracy": directional_accuracy(true_prices_test, pred_lr, prev_prices_test),
    }

    xgb_model = XGBRegressor(**XGB_PARAMS)
    xgb_model.fit(train_full_df[FEATURE_COLUMNS], train_full_df["Target_Close"])
    pred_xgb = xgb_model.predict(test_df[FEATURE_COLUMNS])
    results["xgboost"] = {
        **compute_metrics(true_prices_test, pred_xgb),
        "directional_accuracy": directional_accuracy(true_prices_test, pred_xgb, prev_prices_test),
    }

    _print_comparison_table(symbol, results)

    return {
        "symbol": symbol,
        "test_period": {
            "start": str(test_df.index[0].date()),
            "end": str(test_df.index[-1].date()),
            "n_days": int(len(test_df)),
        },
        "models": results,
    }


def compare_models_v2(symbol: str, start: str = "2018-01-01", end: str | None = None) -> dict:
    """Same idea as compare_models, but adds XGBoost variants that predict
    Target_Return (reconstructed into prices) and Target_Direction, instead
    of predicting Target_Close (raw price) directly. Raw-price regression
    tends to just extrapolate the previous close (since Close is itself a
    feature), which is why it loses to the previous_close baseline; return
    and direction targets remove that shortcut.
    """
    symbol = symbol.upper()
    df = load_features(symbol, start=start, end=end)
    train_df, val_df, test_df = chronological_split(df)
    train_full_df = pd.concat([train_df, val_df])

    prev_prices_test = test_df["Close"].values
    true_prices_test = test_df["Target_Close"].values
    true_returns_test = test_df["Target_Return"].values
    true_direction_test = test_df["Target_Direction"].values

    results = {}

    # --- Baselines (price target) ---
    pred_prev_close = baseline_previous_close(test_df)
    results["previous_close"] = {
        **compute_metrics(true_prices_test, pred_prev_close),
        "directional_accuracy": directional_accuracy(true_prices_test, pred_prev_close, prev_prices_test),
    }

    pred_ma = baseline_moving_average(test_df, window=20)
    results["moving_average"] = {
        **compute_metrics(true_prices_test, pred_ma),
        "directional_accuracy": directional_accuracy(true_prices_test, pred_ma, prev_prices_test),
    }

    pred_lr = baseline_linear_regression(train_full_df, test_df, FEATURE_COLUMNS, "Target_Close")
    results["linear_regression"] = {
        **compute_metrics(true_prices_test, pred_lr),
        "directional_accuracy": directional_accuracy(true_prices_test, pred_lr, prev_prices_test),
    }

    # --- XGBoost on raw price target (for side-by-side comparison) ---
    xgb_price_model = XGBRegressor(**XGB_PARAMS)
    xgb_price_model.fit(train_full_df[FEATURE_COLUMNS], train_full_df["Target_Close"])
    pred_xgb_price = xgb_price_model.predict(test_df[FEATURE_COLUMNS])
    results["xgboost_price_target"] = {
        **compute_metrics(true_prices_test, pred_xgb_price),
        "directional_accuracy": directional_accuracy(true_prices_test, pred_xgb_price, prev_prices_test),
    }

    # --- XGBoost on return target, reconstructed into prices ---
    xgb_return_model = XGBRegressor(**XGB_PARAMS)
    xgb_return_model.fit(train_full_df[FEATURE_COLUMNS], train_full_df["Target_Return"])
    pred_returns = xgb_return_model.predict(test_df[FEATURE_COLUMNS])
    pred_price_from_return = prev_prices_test * (1 + pred_returns)

    return_regression_metrics = {
        "mae": float(mean_absolute_error(true_returns_test, pred_returns)),
        "rmse": float(np.sqrt(mean_squared_error(true_returns_test, pred_returns))),
        "r2": float(r2_score(true_returns_test, pred_returns)),
    }

    results["xgboost_return_target"] = {
        **compute_metrics(true_prices_test, pred_price_from_return),
        "directional_accuracy": directional_accuracy(true_prices_test, pred_price_from_return, prev_prices_test),
        "return_regression_metrics": return_regression_metrics,
    }

    # --- XGBoost classifier on direction target ---
    xgb_direction_model = XGBClassifier(**XGB_CLASSIFIER_PARAMS)
    xgb_direction_model.fit(train_full_df[FEATURE_COLUMNS], train_full_df["Target_Direction"])
    pred_direction = xgb_direction_model.predict(test_df[FEATURE_COLUMNS])

    results["xgboost_direction_target"] = {
        "accuracy": float(accuracy_score(true_direction_test, pred_direction)),
        "precision": float(precision_score(true_direction_test, pred_direction, zero_division=0)),
        "recall": float(recall_score(true_direction_test, pred_direction, zero_division=0)),
        "directional_accuracy": float(accuracy_score(true_direction_test, pred_direction)),
    }

    # Naive direction baseline: always call "up". Beating a coin flip is not enough if
    # the stock simply rose on most test days.
    results["always_up"] = {
        "directional_accuracy": float(np.mean(true_direction_test == 1)),
        "accuracy": float(np.mean(true_direction_test == 1)),
    }

    print(f"\nModel comparison v2 (price vs return vs direction targets) for {symbol}")
    print("-" * 90)
    for name, m in results.items():
        if "mae" in m:
            print(
                f"{name:<26}mae={m['mae']:.4f} rmse={m['rmse']:.4f} "
                f"mape={m.get('mape', float('nan')):.2f}% r2={m['r2']:.4f} "
                f"dir_acc={m['directional_accuracy']:.2%}"
            )
        else:
            print(
                f"{name:<26}accuracy={m['accuracy']:.2%} precision={m.get('precision', float('nan')):.2%} "
                f"recall={m.get('recall', float('nan')):.2%} dir_acc={m['directional_accuracy']:.2%}"
            )
    print("-" * 90)

    return {
        "symbol": symbol,
        "test_period": {
            "start": str(test_df.index[0].date()),
            "end": str(test_df.index[-1].date()),
            "n_days": int(len(test_df)),
        },
        "models": results,
    }


if __name__ == "__main__":
    import json

    print(json.dumps(compare_models("AAPL"), indent=2, default=str))
