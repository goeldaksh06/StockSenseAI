"""JSON-safety helpers: Yahoo data is full of NaN, numpy scalars, Timestamps and dates."""
import datetime as dt
import math

import numpy as np
import pandas as pd


def clean(v):
    """Recursively convert pandas/numpy/NaN values into plain JSON-safe Python."""
    if v is None:
        return None
    if isinstance(v, dict):
        return {str(k): clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple, set)):
        return [clean(x) for x in v]
    if isinstance(v, (pd.Timestamp, dt.datetime)):
        return v.isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        f = float(v)
        return f if math.isfinite(f) else None
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, pd.Series):
        return clean(v.to_dict())
    if isinstance(v, pd.DataFrame):
        return clean(v.to_dict(orient="records"))
    if v is pd.NaT:
        return None
    return v


def num(v):
    """Float or None (rejects NaN/inf/non-numeric)."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None
