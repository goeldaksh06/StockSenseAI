from fastapi import APIRouter, HTTPException, Query

from backend.ml.pipeline import SymbolNotFoundError, compare_models, compare_models_v2
from backend.ml.backtest import run_backtest

router = APIRouter(prefix="/analysis", tags=["Analysis"])


@router.get("/evidence")
def evidence():
    """Pre-computed walk-forward results across many tickers (see ml/walkforward.py)."""
    import json

    from backend.ml.walkforward import RESULTS_PATH

    if not RESULTS_PATH.exists():
        raise HTTPException(status_code=404, detail="Walk-forward results have not been generated yet. Run: python -m backend.ml.walkforward")
    return json.loads(RESULTS_PATH.read_text(encoding="utf-8"))


@router.get("/compare/{symbol}")
def compare(symbol: str):
    """Model-vs-baseline comparison, both naive price-target XGBoost (which
    fails, documented deliberately) and the fixed return/direction targets.
    """
    try:
        return {
            "price_target": compare_models(symbol.upper()),
            "fixed_targets": compare_models_v2(symbol.upper()),
        }
    except SymbolNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/backtest/{symbol}")
def backtest(
    symbol: str,
    model_variant: str = "direction",
    initial_capital: float = Query(10000, gt=0, le=1_000_000_000),
    transaction_cost_pct: float = Query(0.001, ge=0, le=0.05),
):
    if model_variant not in ("price", "return", "direction"):
        raise HTTPException(status_code=400, detail="model_variant must be one of: price, return, direction")
    try:
        return run_backtest(
            symbol.upper(),
            initial_capital=initial_capital,
            transaction_cost_pct=transaction_cost_pct,
            model_variant=model_variant,
        )
    except SymbolNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
