import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from backend.ml.pipeline import SymbolNotFoundError
from backend.research import market, risk, technicals

_WINDOW_S, _MAX_REQ = 60, 120
_hits: dict[str, deque] = defaultdict(deque)


def _limit(request: Request) -> None:
    """Per-IP cap: each uncached request fans out to Yahoo Finance, so keep abuse cheap to refuse."""
    key = request.client.host if request.client else "?"
    now = time.monotonic()
    q = _hits[key]
    while q and now - q[0] > _WINDOW_S:
        q.popleft()
    if len(q) >= _MAX_REQ:
        raise HTTPException(status_code=429, detail="Too many requests, slow down for a minute.")
    q.append(now)


router = APIRouter(prefix="/research", tags=["Research"], dependencies=[Depends(_limit)])


def _run(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except SymbolNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Data provider error: {e}")


@router.get("/search")
def search(q: str = Query(min_length=1, max_length=40)):
    return {"results": market.search(q)}


@router.get("/compare")
def compare(symbols: str = Query(min_length=1, max_length=120), years: int = Query(3, ge=1, le=5)):
    syms = [s for s in (x.strip() for x in symbols.split(",")) if s]
    if len(syms) < 2:
        raise HTTPException(status_code=400, detail="Provide at least two comma-separated symbols.")
    return _run(risk.compare, syms, years)


@router.get("/{symbol}/profile")
def profile(symbol: str):
    return _run(market.profile, symbol)


@router.get("/{symbol}/fundamentals")
def fundamentals(symbol: str):
    return _run(market.fundamentals, symbol)


@router.get("/{symbol}/statements")
def statements(symbol: str):
    return _run(market.statements, symbol)


@router.get("/{symbol}/analysts")
def analysts(symbol: str):
    return _run(market.analysts, symbol)


@router.get("/{symbol}/ownership")
def ownership(symbol: str):
    return _run(market.ownership, symbol)


@router.get("/{symbol}/risk")
def risk_report(symbol: str, benchmark: str | None = Query(None, max_length=15), years: int = Query(3, ge=1, le=5)):
    return _run(risk.risk_report, symbol, benchmark, years)


@router.get("/{symbol}/technicals")
def technical(symbol: str, days: int = Query(504, ge=60, le=1260)):
    return _run(technicals.technicals, symbol, days)


@router.get("/{symbol}/news")
def news(symbol: str):
    return _run(market.news, symbol)
