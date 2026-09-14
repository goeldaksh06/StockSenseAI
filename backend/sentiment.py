"""Single canonical sentiment pipeline.

Previously this project scored sentiment two different, inconsistent ways
(VADER in main.py, TextBlob in ml_router.py). This module replaces both.
"""
import os
from datetime import datetime, timedelta, timezone

import requests
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

_analyzer = SentimentIntensityAnalyzer()

POSITIVE_THRESHOLD = 0.1
NEGATIVE_THRESHOLD = -0.1


def score_text(text: str) -> float:
    if not text:
        return 0.0
    return _analyzer.polarity_scores(text)["compound"]


def label_for_score(score: float) -> str:
    if score > POSITIVE_THRESHOLD:
        return "Positive"
    if score < NEGATIVE_THRESHOLD:
        return "Negative"
    return "Neutral"


def fetch_headlines(symbol: str, as_of: datetime | None = None, lookback_days: int = 7, max_articles: int = 25) -> list[dict]:
    """Fetch recent headlines for `symbol` from NewsAPI.

    `as_of` bounds the query to articles published on or before that date,
    so this can be reused for historical/backtest sentiment without leaking
    future news into a past prediction. Defaults to now for live use.
    """
    api_key = os.getenv("NEWS_API_KEY")
    if not api_key:
        return []

    as_of = as_of or datetime.now(timezone.utc)
    from_date = (as_of - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    to_date = as_of.strftime("%Y-%m-%d")

    url = (
        "https://newsapi.org/v2/everything"
        f"?q={symbol}&from={from_date}&to={to_date}"
        f"&language=en&sortBy=publishedAt&pageSize={max_articles}&apiKey={api_key}"
    )
    try:
        resp = requests.get(url, timeout=8)
        resp.raise_for_status()
        articles = resp.json().get("articles", [])
    except Exception:
        return []

    return [
        {"title": a.get("title", ""), "published_at": a.get("publishedAt"), "source": (a.get("source") or {}).get("name")}
        for a in articles
        if a.get("title")
    ]


def aggregate_sentiment(symbol: str, headline: str | None = None, as_of: datetime | None = None) -> dict:
    """Aggregate sentiment across recent headlines (plus an optional explicit
    headline) into an overall score and a positive/neutral/negative breakdown.
    """
    scored = []

    if headline:
        scored.append({"title": headline, "score": score_text(headline)})

    for article in fetch_headlines(symbol, as_of=as_of):
        scored.append({"title": article["title"], "score": score_text(article["title"])})

    if not scored:
        return {
            "overall_score": 0.0,
            "label": "Neutral",
            "positive_pct": 0.0,
            "neutral_pct": 0.0,
            "negative_pct": 0.0,
            "headlines": [],
        }

    for item in scored:
        item["label"] = label_for_score(item["score"])

    n = len(scored)
    positive = sum(1 for s in scored if s["label"] == "Positive")
    negative = sum(1 for s in scored if s["label"] == "Negative")
    neutral = n - positive - negative
    overall = sum(s["score"] for s in scored) / n

    return {
        "overall_score": round(overall, 3),
        "label": label_for_score(overall),
        "positive_pct": round(100 * positive / n, 1),
        "neutral_pct": round(100 * neutral / n, 1),
        "negative_pct": round(100 * negative / n, 1),
        "headlines": scored[:10],
    }
