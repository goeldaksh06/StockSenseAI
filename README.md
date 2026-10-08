# StockSense AI

FastAPI app that predicts next-day stock moves with ML, **honestly benchmarks them against simple baselines**, backtests a strategy, scores news sentiment, and writes an LLM plain-English briefing.

> Educational project, not financial advice.

## What it is
A research platform for any listed stock (US, India, most major exchanges, via Yahoo Finance) plus an honest test of whether price-based forecasting works.

- **Research** (`/stock/{ticker}`): Overview with a rule-based screen, Financials (income, balance sheet, cash flow, annual/quarterly, YoY, CSV export), Valuation (multiples, analyst targets, interactive DCF with sensitivity table and reverse-DCF), Risk (volatility, drawdown, beta/correlation/alpha vs an index, VaR/CVaR), Technicals, Analysts (targets, ratings, estimates, earnings surprises), Ownership and insiders, News tone, Forecast.
- **Compare** (`/compare`): up to six tickers: rebased performance, risk, fundamentals side by side, correlation map.
- **Evidence** (`/evidence`): walk-forward test of the direction model across ~45 stocks versus an "always up" baseline, with bootstrap intervals, AUC, Brier skill and calibration.
- **Forecast lab** (`/analyze`, `/models`, `/backtest`): next-day model call, AI briefing, model scoreboard, backtest. Labelled experimental.
- **Ask** copilot on every page: answers only from the page's data, the glossary and the method notes.

## Honest results
Tested through time on dozens of stocks, the direction model does not reliably beat "always up", and its probabilities are overconfident. See the Evidence page (regenerate with `python -m backend.ml.walkforward`, about 20 minutes).

## Features
- Auth (JWT, bcrypt, min 8-char passwords, login rate limiting) and per-user watchlist
- `/research/*` data endpoints (cached, 404 for unknown tickers), `/analysis/*`, `/ml/predict`, `/briefing/{symbol}`, `/copilot`
- `/health`, interactive API docs at `/docs`

## Frontend
Multi-page, no build step: Jinja templates in `frontend/templates`, vanilla ES modules in `frontend/static/js` (`core/` API, auth, storage, formatting, DCF maths, CSV; `components/` charts, tables, ticker search, copilot; `pages/` one module per page and `pages/stock/` one module per research tab, loaded on demand).

## Run locally
```bash
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env    # fill in secrets
uvicorn backend.main:app --reload
pytest -q
```

## Configuration
See `.env.example`. With `ENV=production` the app refuses to start without `JWT_SECRET`. Generate one: `python -c "import secrets; print(secrets.token_hex(32))"`.

## Deploy
`render.yaml` (Render blueprint) and `Procfile` (Heroku/Railway) are included. Set `DATABASE_URL` (hosted Postgres), `ALLOWED_ORIGINS`, `NEWS_API_KEY` and an LLM key. CI runs `pytest` on every push.
