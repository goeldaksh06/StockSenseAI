"""Technical indicator series for charting, plus plain-language readings.

Readings describe current conditions; they are not buy/sell recommendations.
"""
import numpy as np
import pandas as pd
from ta.momentum import RSIIndicator
from ta.trend import MACD, EMAIndicator, SMAIndicator
from ta.volatility import BollingerBands

from backend.research.market import require_symbol
from backend.research.risk import prices
from backend.research.util import clean, num


def _series(s: pd.Series, d: int = 2):
    return [None if pd.isna(v) else round(float(v), d) for v in s]


def technicals(symbol: str, days: int = 504) -> dict:
    sym = require_symbol(symbol)
    df = prices(sym, 5).copy()
    close, high, low, vol = df["Close"], df["High"], df["Low"], df["Volume"]

    sma20 = SMAIndicator(close, 20).sma_indicator()
    sma50 = SMAIndicator(close, 50).sma_indicator()
    sma200 = SMAIndicator(close, 200).sma_indicator()
    ema12 = EMAIndicator(close, 12).ema_indicator()
    bb = BollingerBands(close, 20, 2)
    rsi = RSIIndicator(close, 14).rsi()
    macd = MACD(close)
    macd_line, macd_sig, macd_hist = macd.macd(), macd.macd_signal(), macd.macd_diff()

    last = close.iloc[-1]
    y = close[close.index >= close.index[-1] - pd.DateOffset(years=1)]
    lo52, hi52 = float(y.min()), float(y.max())
    recent = df.tail(60)
    readings = []

    def add(name, state, detail, tone):
        readings.append({"name": name, "state": state, "detail": detail, "tone": tone})

    if not pd.isna(sma50.iloc[-1]):
        above = last > sma50.iloc[-1]
        add("Price vs 50-day average", "Above" if above else "Below",
            f"Close {last:.2f} vs SMA50 {sma50.iloc[-1]:.2f}", "up" if above else "down")
    if not pd.isna(sma200.iloc[-1]):
        above = last > sma200.iloc[-1]
        add("Price vs 200-day average", "Above" if above else "Below",
            f"Close {last:.2f} vs SMA200 {sma200.iloc[-1]:.2f}", "up" if above else "down")
        if not pd.isna(sma50.iloc[-1]):
            golden = sma50.iloc[-1] > sma200.iloc[-1]
            add("50 vs 200-day trend", "Golden cross zone" if golden else "Death cross zone",
                "50-day average is " + ("above" if golden else "below") + " the 200-day", "up" if golden else "down")
    r = rsi.iloc[-1]
    if not pd.isna(r):
        zone, tone = ("Overbought (>70)", "down") if r > 70 else ("Oversold (<30)", "up") if r < 30 else ("Neutral", "")
        add("RSI (14)", zone, f"RSI {r:.1f}", tone)
    if not pd.isna(macd_line.iloc[-1]):
        pos = macd_line.iloc[-1] > macd_sig.iloc[-1]
        add("MACD", "Above signal" if pos else "Below signal",
            f"MACD {macd_line.iloc[-1]:.2f} vs signal {macd_sig.iloc[-1]:.2f}", "up" if pos else "down")
    if not pd.isna(bb.bollinger_hband().iloc[-1]):
        pb = float(bb.bollinger_pband().iloc[-1])
        state = "Near upper band" if pb > 0.8 else "Near lower band" if pb < 0.2 else "Mid-range"
        add("Bollinger position", state, f"{pb * 100:.0f}% of the way from lower to upper band", "")
    pos52 = (last - lo52) / (hi52 - lo52) if hi52 > lo52 else None
    if pos52 is not None:
        add("52-week range", f"{pos52 * 100:.0f}% of range", f"Low {lo52:.2f} / high {hi52:.2f}", "")
    avg_vol20 = vol.tail(20).mean()
    if avg_vol20 and not pd.isna(avg_vol20):
        add("Volume (20d vs 3m avg)", f"{avg_vol20 / vol.tail(63).mean():.2f}x", "Recent average volume relative to the last three months", "")

    n = min(days, len(df))
    idx = df.index[-n:]
    return clean({
        "symbol": sym,
        "dates": [d.date().isoformat() for d in idx],
        "open": _series(df["Open"].tail(n)), "high": _series(high.tail(n)), "low": _series(low.tail(n)),
        "close": _series(close.tail(n)), "volume": [int(v) if not pd.isna(v) else None for v in vol.tail(n)],
        "sma20": _series(sma20.tail(n)), "sma50": _series(sma50.tail(n)), "sma200": _series(sma200.tail(n)),
        "ema12": _series(ema12.tail(n)),
        "bb_upper": _series(bb.bollinger_hband().tail(n)), "bb_lower": _series(bb.bollinger_lband().tail(n)),
        "rsi": _series(rsi.tail(n), 1),
        "macd": _series(macd_line.tail(n), 3), "macd_signal": _series(macd_sig.tail(n), 3), "macd_hist": _series(macd_hist.tail(n), 3),
        "levels": {"support_60d": num(recent["Low"].min()), "resistance_60d": num(recent["High"].max()),
                   "week52_low": lo52, "week52_high": hi52},
        "readings": readings,
    })
