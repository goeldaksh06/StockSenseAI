import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import yfinance as yf
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.templating import Jinja2Templates
from fastapi.requests import Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from backend.database import Base, engine
from backend.routers import analysis_router, briefing_router, stock_router, user_router
from backend.ml.predict import predict_next_day
from backend.ml.pipeline import _flatten_yf_columns
from backend.sentiment import aggregate_sentiment

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        Base.metadata.create_all(bind=engine)
        print("Database tables ensured")
    except Exception as e:
        print("Could not create tables:", e)
    yield


app = FastAPI(title="StockSense AI Backend", debug=os.getenv("ENV") != "production", lifespan=lifespan)

templates = Jinja2Templates(directory="frontend/templates")

allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://127.0.0.1:8000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(user_router.router)
app.include_router(stock_router.router)
app.include_router(analysis_router.router)
app.include_router(briefing_router.router)


class PredictRequest(BaseModel):
    symbol: str
    headline: str | None = None


@app.post("/ml/predict")
def predict(data: PredictRequest):
    """Prediction only (fast). For the plain-English explanation of *why*,
    see /briefing/{symbol} — a distinct, LLM-backed feature.
    """
    try:
        prediction = predict_next_day(data.symbol)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {e}")

    sentiment = aggregate_sentiment(data.symbol, headline=data.headline)

    return {
        **prediction,
        "sentiment_score": sentiment["overall_score"],
        "sentiment_label": sentiment["label"],
    }


@app.get("/history/{symbol}")
def history(symbol: str, days: int = 180):
    """Actual closing prices only. Deliberately does NOT show a model
    'prediction' line here — a model evaluated on the same data it saw during
    training looks deceptively accurate. Use /analysis/compare/{symbol} for a
    real, test-set-only accuracy comparison instead.
    """
    symbol = symbol.upper()
    # yfinance's `period` only accepts fixed values ("1d", "1mo", "max", ...),
    # not arbitrary "{days}d" strings — passing an invalid one silently falls
    # back to returning the entire history, so use explicit start/end instead.
    start = (datetime.today() - timedelta(days=days)).strftime("%Y-%m-%d")
    try:
        df = yf.download(symbol, start=start, interval="1d", auto_adjust=True, progress=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if df.empty:
        raise HTTPException(status_code=404, detail=f"No data for {symbol}")

    df = _flatten_yf_columns(df)
    return {
        "symbol": symbol,
        "dates": [d.strftime("%Y-%m-%d") for d in df.index],
        "close": df["Close"].round(2).tolist(),
    }


@app.get("/", response_class=HTMLResponse)
def landing(request: Request):
    return templates.TemplateResponse(request, "landing.html")


@app.get("/dashboard", response_class=HTMLResponse)
def dashboard(request: Request):
    return templates.TemplateResponse(request, "index.html")


@app.get("/health")
def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    print(f"Starting StockSense AI backend on http://127.0.0.1:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
