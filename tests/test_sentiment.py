import pytest

from backend import sentiment


def test_score_text_positive():
    assert sentiment.score_text("Apple stock soars to record high, investors thrilled") > 0.1


def test_score_text_negative():
    assert sentiment.score_text("Apple stock plunges amid fraud investigation, investors panic") < -0.1


def test_score_text_empty_is_neutral():
    assert sentiment.score_text("") == 0.0
    assert sentiment.score_text(None) == 0.0


def test_label_for_score_thresholds():
    assert sentiment.label_for_score(0.5) == "Positive"
    assert sentiment.label_for_score(-0.5) == "Negative"
    assert sentiment.label_for_score(0.0) == "Neutral"
    assert sentiment.label_for_score(0.1) == "Neutral"   # boundary is exclusive
    assert sentiment.label_for_score(0.11) == "Positive"


def test_aggregate_sentiment_no_headlines_or_api_key_returns_neutral_default(monkeypatch):
    monkeypatch.setenv("NEWS_API_KEY", "")
    result = sentiment.aggregate_sentiment("AAPL", headline=None)
    assert result["overall_score"] == 0.0
    assert result["label"] == "Neutral"
    assert result["headlines"] == []


def test_aggregate_sentiment_uses_explicit_headline_even_without_api_key(monkeypatch):
    monkeypatch.setenv("NEWS_API_KEY", "")
    result = sentiment.aggregate_sentiment("AAPL", headline="Great earnings beat expectations")
    assert result["overall_score"] > 0
    assert result["label"] == "Positive"
    assert len(result["headlines"]) == 1


def test_aggregate_sentiment_combines_headline_and_fetched_articles(monkeypatch):
    monkeypatch.setattr(
        sentiment,
        "fetch_headlines",
        lambda symbol, as_of=None, lookback_days=7, max_articles=25: [
            {"title": "Company announces record profits", "published_at": None, "source": "test"},
            {"title": "Regulators launch investigation into fraud", "published_at": None, "source": "test"},
        ],
    )
    result = sentiment.aggregate_sentiment("AAPL", headline="Neutral market update today")
    assert len(result["headlines"]) == 3
    total_pct = result["positive_pct"] + result["neutral_pct"] + result["negative_pct"]
    assert total_pct == pytest.approx(100.0, abs=0.5)  # rounding to 1 decimal each can be off by <=0.3


def test_fetch_headlines_returns_empty_list_without_api_key(monkeypatch):
    monkeypatch.setenv("NEWS_API_KEY", "")
    assert sentiment.fetch_headlines("AAPL") == []


def test_fetch_headlines_handles_request_failure_gracefully(monkeypatch):
    monkeypatch.setenv("NEWS_API_KEY", "fake-key")

    def _raise(*args, **kwargs):
        raise ConnectionError("network down")

    monkeypatch.setattr(sentiment.requests, "get", _raise)
    assert sentiment.fetch_headlines("AAPL") == []
