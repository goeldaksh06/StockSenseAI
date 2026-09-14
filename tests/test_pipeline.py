import numpy as np
import pandas as pd
import pytest

from backend.ml.pipeline import (
    baseline_moving_average,
    baseline_previous_close,
    chronological_split,
    compute_metrics,
    directional_accuracy,
)


def _synthetic_price_df(n=100, start_price=100.0, daily_change=1.0):
    closes = start_price + np.arange(n) * daily_change
    dates = pd.date_range("2024-01-01", periods=n, freq="D")
    df = pd.DataFrame({"Close": closes}, index=dates)
    df["Target_Close"] = df["Close"].shift(-1)
    return df.iloc[:-1]


def test_chronological_split_preserves_order_and_proportions():
    df = _synthetic_price_df(100)
    train, val, test = chronological_split(df, train_frac=0.7, val_frac=0.15)

    assert len(train) == 69
    assert len(val) == 15
    assert len(test) == 100 - 1 - 69 - 15

    assert train.index[-1] < val.index[0]
    assert val.index[-1] < test.index[0]


def test_chronological_split_never_shuffles():
    df = _synthetic_price_df(50)
    train, _, _ = chronological_split(df)
    assert list(train.index) == sorted(train.index)


def test_baseline_previous_close_predicts_todays_close():
    df = _synthetic_price_df(10)
    preds = baseline_previous_close(df)
    np.testing.assert_allclose(preds, df["Close"].values)


def test_baseline_moving_average_matches_rolling_mean():
    df = _synthetic_price_df(30)
    preds = baseline_moving_average(df, window=5)
    expected = df["Close"].rolling(window=5, min_periods=1).mean().values
    np.testing.assert_allclose(preds, expected)


def test_compute_metrics_perfect_prediction_is_zero_error():
    y_true = np.array([100.0, 101.0, 102.0])
    metrics = compute_metrics(y_true, y_true)
    assert metrics["mae"] == pytest.approx(0.0)
    assert metrics["rmse"] == pytest.approx(0.0)
    assert metrics["mape"] == pytest.approx(0.0)
    assert metrics["r2"] == pytest.approx(1.0)


def test_compute_metrics_known_error():
    y_true = np.array([100.0, 200.0])
    y_pred = np.array([110.0, 190.0])
    metrics = compute_metrics(y_true, y_pred)
    assert metrics["mae"] == pytest.approx(10.0)


def test_directional_accuracy_all_correct():
    prev = np.array([100.0, 100.0])
    y_true = np.array([110.0, 90.0])   # up, down
    y_pred = np.array([105.0, 95.0])   # up, down
    assert directional_accuracy(y_true, y_pred, prev) == pytest.approx(1.0)


def test_directional_accuracy_all_wrong():
    prev = np.array([100.0, 100.0])
    y_true = np.array([110.0, 90.0])   # up, down
    y_pred = np.array([95.0, 105.0])   # down, up
    assert directional_accuracy(y_true, y_pred, prev) == pytest.approx(0.0)


def test_directional_accuracy_previous_close_baseline_is_zero_when_price_always_moves():
    """previous_close always predicts prev == pred, so sign(pred - prev) is
    always 0; it only "matches" the actual direction on days where the price
    didn't move at all — an expected artifact of the metric definition, not
    a bug (see ml/pipeline.py docs)."""
    prev = np.array([100.0, 100.0, 100.0])
    y_true = np.array([105.0, 95.0, 110.0])  # never flat
    pred_prev_close = prev.copy()
    assert directional_accuracy(y_true, pred_prev_close, prev) == pytest.approx(0.0)
