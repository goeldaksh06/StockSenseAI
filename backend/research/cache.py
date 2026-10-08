"""Small thread-safe TTL cache so repeated page views do not hammer Yahoo Finance."""
import functools
import threading
import time

_lock = threading.Lock()
_store: dict[tuple, tuple[float, object]] = {}
_key_locks: dict[tuple, threading.Lock] = {}
MAX_ENTRIES = 500


def _is_empty(v) -> bool:
    """None, empty containers and empty DataFrames/Series count as 'nothing to cache'."""
    if v is None:
        return True
    if hasattr(v, 'empty'):
        return bool(v.empty)
    try:
        return len(v) == 0
    except TypeError:
        return False  # numbers, bools, etc.


def ttl_cache(seconds: int):
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(*args):
            key = (fn.__module__, fn.__name__, *args)
            now = time.monotonic()
            with _lock:
                hit = _store.get(key)
                if hit and now - hit[0] < seconds:
                    return hit[1]
                klock = _key_locks.setdefault(key, threading.Lock())
            # One in-flight fetch per key: concurrent requests wait for the first rather than duplicating it.
            with klock:
                with _lock:
                    hit = _store.get(key)
                    if hit and time.monotonic() - hit[0] < seconds:
                        return hit[1]
                value = fn(*args)
                if _is_empty(value):
                    return value  # never cache empty results: they are usually transient provider failures
                with _lock:
                    if len(_store) >= MAX_ENTRIES:
                        oldest = min(_store, key=lambda k: _store[k][0])
                        _store.pop(oldest, None)
                        _key_locks.pop(oldest, None)
                    _store[key] = (time.monotonic(), value)
                return value

        wrapper.cache_clear = lambda: _store.clear()
        return wrapper

    return deco
