from fastapi import APIRouter, HTTPException

from backend.ml.pipeline import compare_models, compare_models_v2
from backend.ml.backtest import run_backtest

router = APIRouter(prefix="/analysis", tags=["Analysis"])


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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/backtest/{symbol}")
def backtest(symbol: str, model_variant: str = "direction"):
    if model_variant not in ("price", "return", "direction"):
        raise HTTPException(status_code=400, detail="model_variant must be one of: price, return, direction")
    try:
        return run_backtest(symbol.upper(), model_variant=model_variant)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
