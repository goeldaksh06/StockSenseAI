"""Live next-day prediction for a single symbol, using the direction-target
XGBoost classifier (the variant that actually showed a competitive
risk-adjusted backtest — see ml/pipeline.py and ml/backtest.py) plus the
return-target regressor for a price estimate.

Trains on all available history each call. For a class project this is
acceptable; for real deployment you'd cache/retrain on a schedule instead.
"""
from datetime import datetime

import numpy as np
import pandas as pd
import yfinance as yf
from xgboost import XGBClassifier, XGBRegressor

from backend.ml.pipeline import (
    FEATURE_COLUMNS,
    XGB_CLASSIFIER_PARAMS,
    XGB_PARAMS,
    _download_with_retry,
    _flatten_yf_columns,
    load_features,
)
from ta.momentum import RSIIndicator, ROCIndicator
from ta.trend import MACD, SMAIndicator, EMAIndicator
from ta.volatility import BollingerBands, AverageTrueRange
from ta.volume import OnBalanceVolumeIndicator


def _latest_feature_row(symbol: str, start: str = "2018-01-01") -> pd.Series:
    """Same indicator computation as pipeline.load_features, but keeps the
    most recent row even though its Target_* columns are NaN (there's no
    "tomorrow" yet to know the true target for) — that row is what we predict
    on. pipeline.load_features intentionally drops it via dropna(), which is
    correct for training/evaluation but wrong for live prediction.
    """
    data = _download_with_retry(symbol, start=start, end=datetime.today().strftime("%Y-%m-%d"), auto_adjust=True, progress=False)
    data = _flatten_yf_columns(data)

    close, high, low, volume = data["Close"], data["High"], data["Low"], data["Volume"]
    data["SMA5"] = SMAIndicator(close, window=5).sma_indicator()
    data["SMA10"] = SMAIndicator(close, window=10).sma_indicator()
    data["SMA20"] = SMAIndicator(close, window=20).sma_indicator()
    data["SMA50"] = SMAIndicator(close, window=50).sma_indicator()
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

    data = data.dropna(subset=FEATURE_COLUMNS)
    return data.iloc[-1]


def predict_next_day(symbol: str) -> dict:
    symbol = symbol.upper()
    train_df = load_features(symbol)
    if len(train_df) < 50:
        raise ValueError(f"Not enough historical data for {symbol} to train a model")

    latest = _latest_feature_row(symbol)
    X_latest = pd.DataFrame([latest[FEATURE_COLUMNS]])

    clf = XGBClassifier(**XGB_CLASSIFIER_PARAMS)
    clf.fit(train_df[FEATURE_COLUMNS], train_df["Target_Direction"])
    direction_prob_up = float(clf.predict_proba(X_latest)[0][1])
    predicted_direction = "up" if direction_prob_up >= 0.5 else "down"

    reg = XGBRegressor(**XGB_PARAMS)
    reg.fit(train_df[FEATURE_COLUMNS], train_df["Target_Return"])
    predicted_return = float(reg.predict(X_latest)[0])
    current_price = float(latest["Close"])
    predicted_price = current_price * (1 + predicted_return)

    return {
        "symbol": symbol,
        "current_price": round(current_price, 2),
        "predicted_price": round(predicted_price, 2),
        "predicted_return_pct": round(predicted_return * 100, 2),
        "direction": predicted_direction,
        "direction_confidence": round(direction_prob_up if predicted_direction == "up" else 1 - direction_prob_up, 3),
        "indicators": {
            "rsi": round(float(latest["RSI"]), 2),
            "macd": round(float(latest["MACD"]), 4),
            "signal_line": round(float(latest["MACD_Signal"]), 4),
            "ema_20": round(float(latest["SMA20"]), 2),
            "current_price": round(current_price, 2),
        },
        "as_of_date": str(latest.name.date()),
    }
