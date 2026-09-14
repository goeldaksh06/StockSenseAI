"""Daily briefing: a distinct, LLM-generated feature that explains a
prediction in plain English by synthesizing technical indicators, model
performance, and news sentiment. This is explanation, not the prediction
itself — the prediction still comes from the ML pipeline.
"""
import os

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "anthropic").lower()
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
GROQ_BASE_URL = "https://api.groq.com/openai/v1"


def _build_prompt(symbol: str, indicators: dict, sentiment: dict, prediction: dict) -> str:
    return f"""You are a financial analysis assistant. Write a short (4-6 sentence),
plain-English daily briefing for {symbol} explaining WHY the model's prediction
looks the way it does, grounded only in the numbers below. Do not invent facts
not present here. Do not give investment advice or tell the reader to buy/sell.
End with the standard disclaimer sentence: "This is an educational model output,
not financial advice."

Technical indicators:
- RSI (14): {indicators.get('rsi')}
- MACD: {indicators.get('macd')} (signal line: {indicators.get('signal_line')})
- EMA-20: {indicators.get('ema_20')}
- Current price: {indicators.get('current_price')}

News sentiment:
- Overall score: {sentiment.get('overall_score')} ({sentiment.get('label')})
- Breakdown: {sentiment.get('positive_pct')}% positive, {sentiment.get('neutral_pct')}% neutral, {sentiment.get('negative_pct')}% negative
- Sample headlines: {[h['title'] for h in sentiment.get('headlines', [])[:3]]}

Model prediction:
- Predicted next-day price: {prediction.get('predicted_price')}
- Predicted direction: {prediction.get('direction')}
- Model's historical directional accuracy on this stock: {prediction.get('directional_accuracy')}
"""


def is_configured() -> bool:
    if LLM_PROVIDER == "anthropic":
        return bool(os.getenv("ANTHROPIC_API_KEY"))
    if LLM_PROVIDER == "openai":
        return bool(os.getenv("OPENAI_API_KEY"))
    if LLM_PROVIDER == "groq":
        return bool(os.getenv("GROQ_API_KEY"))
    return False


def generate_briefing(symbol: str, indicators: dict, sentiment: dict, prediction: dict) -> dict:
    """Returns {'available': bool, 'text': str, 'provider': str}.

    Never raises — a missing key or an API error degrades to a clearly
    labeled unavailable state instead of breaking the rest of the response.
    """
    if not is_configured():
        return {
            "available": False,
            "text": "LLM briefing not configured — set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GROQ_API_KEY with a matching LLM_PROVIDER to enable this feature.",
            "provider": LLM_PROVIDER,
        }

    prompt = _build_prompt(symbol, indicators, sentiment, prediction)

    try:
        if LLM_PROVIDER == "anthropic":
            import anthropic

            client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
            resp = client.messages.create(
                model=ANTHROPIC_MODEL,
                max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.content[0].text
        elif LLM_PROVIDER == "groq":
            from openai import OpenAI

            client = OpenAI(api_key=os.getenv("GROQ_API_KEY"), base_url=GROQ_BASE_URL)
            resp = client.chat.completions.create(
                model=GROQ_MODEL,
                max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.choices[0].message.content
        else:
            from openai import OpenAI

            client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
            resp = client.chat.completions.create(
                model=OPENAI_MODEL,
                max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            )
            text = resp.choices[0].message.content

        return {"available": True, "text": text.strip(), "provider": LLM_PROVIDER}
    except Exception as e:
        return {
            "available": False,
            "text": f"Briefing generation failed: {e}",
            "provider": LLM_PROVIDER,
        }
