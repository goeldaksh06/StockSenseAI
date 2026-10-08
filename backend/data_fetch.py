"""Thread-safe wrapper for yfinance price downloads.

yf.download keeps results in module-level shared state, so concurrent calls (FastAPI runs
sync endpoints in a thread pool) can return the SAME data for different tickers. We observed
six parallel downloads all returning one ticker's prices. Serialising downloads behind one
lock removes the race; the cost is that two simultaneous cold downloads queue briefly.
"""
import threading

import yfinance as yf

# Reentrant so a locked helper may call another locked helper. Also guards yfinance's cookie/crumb
# handshake, which fails with "Invalid Crumb" when several threads race it.
LOCK = threading.RLock()
_LOCK = LOCK


def download(symbol: str, **kwargs):
    kwargs.setdefault("progress", False)
    with _LOCK:
        return yf.download(symbol, **kwargs)
