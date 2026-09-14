from backend import llm_briefing


def test_is_configured_false_without_any_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(llm_briefing, "LLM_PROVIDER", "anthropic")
    assert llm_briefing.is_configured() is False


def test_is_configured_true_with_anthropic_key(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-fake")
    monkeypatch.setattr(llm_briefing, "LLM_PROVIDER", "anthropic")
    assert llm_briefing.is_configured() is True


def test_generate_briefing_degrades_gracefully_when_not_configured(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(llm_briefing, "LLM_PROVIDER", "anthropic")

    result = llm_briefing.generate_briefing(
        "AAPL",
        indicators={"rsi": 50, "macd": 0, "signal_line": 0, "ema_20": 100, "current_price": 100},
        sentiment={"overall_score": 0, "label": "Neutral", "positive_pct": 0, "neutral_pct": 100, "negative_pct": 0, "headlines": []},
        prediction={"predicted_price": 100, "direction": "up", "directional_accuracy": None},
    )
    assert result["available"] is False
    assert "not configured" in result["text"].lower()


def test_generate_briefing_never_raises_on_api_error(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-fake")
    monkeypatch.setattr(llm_briefing, "LLM_PROVIDER", "anthropic")

    class _BoomClient:
        def __init__(self, api_key):
            raise RuntimeError("simulated SDK failure")

    monkeypatch.setattr("anthropic.Anthropic", _BoomClient)

    result = llm_briefing.generate_briefing(
        "AAPL",
        indicators={"rsi": 50, "macd": 0, "signal_line": 0, "ema_20": 100, "current_price": 100},
        sentiment={"overall_score": 0, "label": "Neutral", "positive_pct": 0, "neutral_pct": 100, "negative_pct": 0, "headlines": []},
        prediction={"predicted_price": 100, "direction": "up", "directional_accuracy": None},
    )
    assert result["available"] is False
    assert "failed" in result["text"].lower()
