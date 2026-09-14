from fastapi import APIRouter, HTTPException

from backend.ml.predict import predict_next_day
from backend.sentiment import aggregate_sentiment
from backend.llm_briefing import generate_briefing

router = APIRouter(prefix="/briefing", tags=["LLM Briefing"])


@router.get("/{symbol}")
def get_briefing(symbol: str, headline: str | None = None):
    """Distinct feature from /ml/predict: takes the model's prediction,
    technical indicators, and news sentiment, and asks an LLM to explain
    *why* the prediction looks the way it does, in plain English. This does
    not change or influence the prediction itself.
    """
    symbol = symbol.upper()
    try:
        prediction = predict_next_day(symbol)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {e}")

    sentiment = aggregate_sentiment(symbol, headline=headline)

    briefing = generate_briefing(
        symbol,
        indicators=prediction["indicators"],
        sentiment=sentiment,
        prediction={
            "predicted_price": prediction["predicted_price"],
            "direction": prediction["direction"],
            "directional_accuracy": None,
        },
    )

    return {
        "symbol": symbol,
        "prediction": prediction,
        "sentiment": sentiment,
        "briefing": briefing,
    }
