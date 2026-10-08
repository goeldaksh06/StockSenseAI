"""Company research data from Yahoo Finance, normalised into JSON-safe shapes.

Yahoo is an unofficial source: fields go missing, units change between library
versions, and some tickers (ETFs, foreign listings) lack whole sections. Every
function therefore degrades to empty/None sections instead of raising, and only
`require_symbol` raises (for symbols Yahoo does not know at all).
"""
import time
import warnings

import pandas as pd
import yfinance as yf

from backend.data_fetch import LOCK, download
from backend.ml.pipeline import SymbolNotFoundError
from backend.research.cache import ttl_cache
from backend.research.util import clean, num

warnings.filterwarnings("ignore", category=FutureWarning)


def _norm(symbol: str) -> str:
    s = symbol.strip().upper()
    if not s or len(s) > 15 or not all(c.isalnum() or c in ".-^=" for c in s):
        raise SymbolNotFoundError(f"'{symbol}' is not a valid ticker symbol.")
    return s


@ttl_cache(60 * 15)
def _info(symbol: str) -> dict:
    for attempt in range(2):
        try:
            with LOCK:
                info = yf.Ticker(symbol).info or {}
            if info:
                return info
        except Exception:
            pass
        time.sleep(0.8)
    return {}  # not cached (empty), so the next request retries


def require_symbol(symbol: str) -> str:
    """Normalise and confirm Yahoo knows the symbol; raises SymbolNotFoundError otherwise."""
    s = _norm(symbol)
    info = _info(s)
    has_price = any(info.get(k) is not None for k in ("regularMarketPrice", "currentPrice", "previousClose"))
    if not info or not (info.get("longName") or info.get("shortName") or has_price):
        # The info endpoint is flaky; before declaring the ticker unknown, check whether it has any prices.
        try:
            probe = download(s, period="5d", auto_adjust=True)
            if probe is not None and not probe.empty:
                return s
        except Exception:
            pass
        raise SymbolNotFoundError(f"No data found for '{s}'. Check the ticker (add .NS for NSE, .BO for BSE, .L for London).")
    return s


@ttl_cache(60 * 60)
def search(query: str) -> list[dict]:
    q = query.strip()
    if len(q) < 1 or len(q) > 40:
        return []
    try:
        with LOCK:
            quotes = yf.Search(q, max_results=8, news_count=0).quotes
    except Exception:
        return []
    out = []
    for x in quotes:
        if x.get("symbol") and x.get("quoteType") in ("EQUITY", "ETF", "INDEX", "MUTUALFUND", None):
            out.append({
                "symbol": x["symbol"],
                "name": x.get("shortname") or x.get("longname") or "",
                "exchange": x.get("exchDisp") or "",
                "type": x.get("quoteType") or "",
            })
    return out


def profile(symbol: str) -> dict:
    s = require_symbol(symbol)
    i = _info(s)
    price = num(i.get("currentPrice")) or num(i.get("regularMarketPrice"))
    prev = num(i.get("previousClose")) or num(i.get("regularMarketPreviousClose"))
    change = (price - prev) if price is not None and prev else None
    return clean({
        "symbol": s,
        "name": i.get("longName") or i.get("shortName") or s,
        "sector": i.get("sector"),
        "industry": i.get("industry"),
        "country": i.get("country"),
        "exchange": i.get("fullExchangeName") or i.get("exchange"),
        "currency": i.get("currency") or "USD",
        "quote_type": i.get("quoteType"),
        "website": i.get("website"),
        "employees": i.get("fullTimeEmployees"),
        "summary": i.get("longBusinessSummary"),
        "price": price,
        "previous_close": prev,
        "change": change,
        "change_pct": (change / prev * 100) if change is not None and prev else None,
        "market_cap": num(i.get("marketCap")),
        "day_low": num(i.get("dayLow")),
        "day_high": num(i.get("dayHigh")),
        "week52_low": num(i.get("fiftyTwoWeekLow")),
        "week52_high": num(i.get("fiftyTwoWeekHigh")),
        "avg_volume": num(i.get("averageVolume")),
        "beta": num(i.get("beta")),
    })


# (key, label, format) — formats: money (compact currency), price, frac (0.27 -> 27%), pct (already %), x (ratio), int, text
_FUNDAMENTAL_GROUPS = [
    ("Valuation", [
        ("trailingPE", "P/E (trailing)", "x"), ("forwardPE", "P/E (forward)", "x"), ("trailingPegRatio", "PEG", "x"),
        ("priceToSalesTrailing12Months", "Price / Sales", "x"), ("priceToBook", "Price / Book", "x"),
        ("enterpriseToEbitda", "EV / EBITDA", "x"), ("enterpriseToRevenue", "EV / Revenue", "x"),
        ("enterpriseValue", "Enterprise value", "money"),
    ]),
    ("Profitability", [
        ("grossMargins", "Gross margin", "frac"), ("operatingMargins", "Operating margin", "frac"),
        ("profitMargins", "Net margin", "frac"), ("ebitdaMargins", "EBITDA margin", "frac"),
        ("returnOnEquity", "Return on equity", "frac"), ("returnOnAssets", "Return on assets", "frac"),
    ]),
    ("Growth (YoY)", [
        ("revenueGrowth", "Revenue growth", "frac"), ("earningsGrowth", "Earnings growth", "frac"),
        ("earningsQuarterlyGrowth", "Quarterly earnings growth", "frac"),
        ("totalRevenue", "Revenue (TTM)", "money"), ("trailingEps", "EPS (trailing)", "price"), ("forwardEps", "EPS (forward)", "price"),
    ]),
    ("Financial health", [
        ("totalCash", "Cash", "money"), ("totalDebt", "Total debt", "money"), ("debtToEquity", "Debt / equity", "pct"),
        ("currentRatio", "Current ratio", "x"), ("quickRatio", "Quick ratio", "x"),
        ("operatingCashflow", "Operating cash flow", "money"), ("freeCashflow", "Free cash flow", "money"),
    ]),
    ("Dividends & shares", [
        ("dividendRate", "Dividend per share", "price"), ("payoutRatio", "Payout ratio", "frac"),
        ("sharesOutstanding", "Shares outstanding", "int"), ("floatShares", "Float", "int"),
        ("shortPercentOfFloat", "Short % of float", "frac"), ("heldPercentInsiders", "Held by insiders", "frac"),
        ("heldPercentInstitutions", "Held by institutions", "frac"),
    ]),
]


def fundamentals(symbol: str) -> dict:
    s = require_symbol(symbol)
    i = _info(s)
    price = num(i.get("currentPrice")) or num(i.get("regularMarketPrice"))
    groups = []
    for title, fields in _FUNDAMENTAL_GROUPS:
        items = []
        for key, label, fmt in fields:
            v = i.get(key)
            if isinstance(v, str):
                v = num(v)
            v = num(v) if v is not None else None
            if v is not None:
                items.append({"key": key, "label": label, "value": v, "format": fmt})
        if items:
            groups.append({"title": title, "items": items})
    # Yahoo's dividendYield changed units across versions; derive it from rate and price instead.
    rate = num(i.get("dividendRate"))
    div_yield = (rate / price) if rate and price else None
    # Inputs a client-side DCF needs, so the valuation calculator never refetches.
    dcf = {
        "fcf": num(i.get("freeCashflow")),
        "shares": num(i.get("sharesOutstanding")),
        "cash": num(i.get("totalCash")),
        "debt": num(i.get("totalDebt")),
        "price": price,
        "beta": num(i.get("beta")),
        "revenue_growth": num(i.get("revenueGrowth")),
        "earnings_growth": num(i.get("earningsGrowth")),
    }
    return clean({"symbol": s, "groups": groups, "dividend_yield": div_yield, "dcf_inputs": dcf})


# ---- financial statements -------------------------------------------------

_KEY_ROWS = {
    "income": ["Total Revenue", "Gross Profit", "Operating Income", "EBITDA", "Net Income", "Diluted EPS"],
    "balance": ["Total Assets", "Total Liabilities Net Minority Interest", "Stockholders Equity",
                "Cash And Cash Equivalents", "Total Debt", "Working Capital"],
    "cashflow": ["Operating Cash Flow", "Capital Expenditure", "Free Cash Flow",
                 "Repurchase Of Capital Stock", "Cash Dividends Paid"],
}


def _frame_to_table(df: pd.DataFrame | None, kind: str) -> dict:
    if df is None or df.empty:
        return {"periods": [], "rows": []}
    df = df.dropna(how="all")
    df = df[sorted(df.columns, reverse=True)]  # newest first
    periods = [pd.Timestamp(c).date().isoformat() for c in df.columns]
    key = _KEY_ROWS[kind]
    rows = []
    for name, series in df.iterrows():
        rows.append({
            "item": str(name),
            "key": str(name) in key,
            "values": [num(v) for v in series.tolist()],
        })
    rows.sort(key=lambda r: (not r["key"], key.index(r["item"]) if r["key"] else 0))
    return {"periods": periods, "rows": rows}


@ttl_cache(60 * 60 * 6)
def _statement_frames(symbol: str) -> dict:
    with LOCK:
        t = yf.Ticker(symbol)
        out = {}
        for kind, annual, quarterly in [
            ("income", "income_stmt", "quarterly_income_stmt"),
            ("balance", "balance_sheet", "quarterly_balance_sheet"),
            ("cashflow", "cashflow", "quarterly_cashflow"),
        ]:
            for freq, attr in (("annual", annual), ("quarterly", quarterly)):
                try:
                    out[(kind, freq)] = getattr(t, attr)
                except Exception:
                    out[(kind, freq)] = None
    return out


def _row(df, *names):
    if df is None or df.empty:
        return None
    for n in names:
        if n in df.index:
            return df.loc[n]
    return None


def _div(a, b):
    a, b = num(a), num(b)
    return None if a is None or b in (None, 0) else a / b


def statements(symbol: str) -> dict:
    s = require_symbol(symbol)
    frames = _statement_frames(s)
    result = {"symbol": s}
    for kind in ("income", "balance", "cashflow"):
        result[kind] = {freq: _frame_to_table(frames.get((kind, freq)), kind) for freq in ("annual", "quarterly")}

    # Per-year trend series (oldest -> newest) for charting.
    trends = {}
    for freq in ("annual", "quarterly"):
        inc, cf = frames.get(("income", freq)), frames.get(("cashflow", freq))
        if inc is None or inc.empty:
            trends[freq] = []
            continue
        cols = sorted(inc.columns)
        rev, gp, op, ni, eps = (_row(inc, *n) for n in (("Total Revenue",), ("Gross Profit",), ("Operating Income",), ("Net Income",), ("Diluted EPS",)))
        fcf = _row(cf, "Free Cash Flow")
        pts = []
        for idx, c in enumerate(cols):
            r = num(rev[c]) if rev is not None else None
            prev_r = num(rev[cols[idx - 1]]) if rev is not None and idx > 0 else None
            pts.append({
                "period": pd.Timestamp(c).date().isoformat(),
                "revenue": r,
                "revenue_growth": _div(r - prev_r, prev_r) if r is not None and prev_r else None,
                "gross_margin": _div(gp[c], r) if gp is not None else None,
                "operating_margin": _div(op[c], r) if op is not None else None,
                "net_margin": _div(ni[c], r) if ni is not None else None,
                "net_income": num(ni[c]) if ni is not None else None,
                "eps": num(eps[c]) if eps is not None else None,
                "fcf": num(fcf[c]) if fcf is not None and c in fcf.index else None,
            })
        trends[freq] = pts
    result["trends"] = trends
    return clean(result)


# ---- analysts -------------------------------------------------------------

@ttl_cache(60 * 60)
def _analyst_frames(symbol: str) -> dict:
    with LOCK:
        t = yf.Ticker(symbol)
        out = {}
        for name in ("analyst_price_targets", "recommendations", "upgrades_downgrades", "earnings_estimate", "earnings_dates", "calendar"):
            try:
                out[name] = getattr(t, name)
            except Exception:
                out[name] = None
    return out


def analysts(symbol: str) -> dict:
    s = require_symbol(symbol)
    f = _analyst_frames(s)
    i = _info(s)

    targets = f.get("analyst_price_targets") or {}
    recs = f.get("recommendations")
    rec_rows = []
    if isinstance(recs, pd.DataFrame) and not recs.empty:
        rec_rows = recs.to_dict(orient="records")

    ud = f.get("upgrades_downgrades")
    changes = []
    if isinstance(ud, pd.DataFrame) and not ud.empty:
        recent = ud.sort_index(ascending=False).head(15).reset_index()
        for _, r in recent.iterrows():
            changes.append({
                "date": pd.Timestamp(r.iloc[0]).date().isoformat(),
                "firm": r.get("Firm"), "from": r.get("FromGrade"), "to": r.get("ToGrade"),
                "action": r.get("Action"), "price_target": num(r.get("currentPriceTarget")),
                "prior_target": num(r.get("priorPriceTarget")),
            })

    est = f.get("earnings_estimate")
    est_rows = []
    if isinstance(est, pd.DataFrame) and not est.empty:
        labels = {"0q": "Current quarter", "+1q": "Next quarter", "0y": "Current year", "+1y": "Next year"}
        for period, r in est.iterrows():
            est_rows.append({"period": labels.get(period, period), "avg": num(r.get("avg")), "low": num(r.get("low")),
                             "high": num(r.get("high")), "year_ago": num(r.get("yearAgoEps")),
                             "analysts": num(r.get("numberOfAnalysts")), "growth": num(r.get("growth"))})

    history, next_date = [], None
    ed = f.get("earnings_dates")
    if isinstance(ed, pd.DataFrame) and not ed.empty:
        now = pd.Timestamp.now(tz=ed.index.tz)
        for idx, r in ed.sort_index(ascending=False).iterrows():
            rep = num(r.get("Reported EPS"))
            if rep is None:
                if idx >= now and (next_date is None or idx < pd.Timestamp(next_date)):
                    next_date = idx.isoformat()
                continue
            if len(history) < 8:
                history.append({"date": idx.date().isoformat(), "estimate": num(r.get("EPS Estimate")),
                                "actual": rep, "surprise_pct": num(r.get("Surprise(%)"))})
    beats = [h for h in history if h["surprise_pct"] is not None]
    return clean({
        "symbol": s,
        "consensus": {"key": i.get("recommendationKey"), "mean": num(i.get("recommendationMean")),
                      "analysts": num(i.get("numberOfAnalystOpinions"))},
        "price_targets": {**targets, "price": num(i.get("currentPrice")) or num(i.get("regularMarketPrice"))},
        "ratings_trend": rec_rows,
        "changes": changes,
        "estimates": est_rows,
        "earnings_history": history,
        "beat_rate": (sum(1 for h in beats if h["surprise_pct"] > 0) / len(beats)) if beats else None,
        "next_earnings": next_date,
    })


# ---- ownership ------------------------------------------------------------

@ttl_cache(60 * 60 * 6)
def _ownership_frames(symbol: str) -> dict:
    with LOCK:
        t = yf.Ticker(symbol)
        out = {}
        for name in ("major_holders", "institutional_holders", "insider_transactions"):
            try:
                out[name] = getattr(t, name)
            except Exception:
                out[name] = None
    return out


def ownership(symbol: str) -> dict:
    s = require_symbol(symbol)
    f = _ownership_frames(s)
    mh = f.get("major_holders")
    breakdown = {}
    if isinstance(mh, pd.DataFrame) and not mh.empty:
        breakdown = {str(k): num(v) for k, v in mh["Value"].items()}
    ih = f.get("institutional_holders")
    inst = []
    if isinstance(ih, pd.DataFrame) and not ih.empty:
        for _, r in ih.head(10).iterrows():
            inst.append({"holder": r.get("Holder"), "shares": num(r.get("Shares")), "value": num(r.get("Value")),
                         "pct_held": num(r.get("pctHeld")), "pct_change": num(r.get("pctChange")),
                         "date": pd.Timestamp(r["Date Reported"]).date().isoformat() if pd.notna(r.get("Date Reported")) else None})
    it = f.get("insider_transactions")
    insiders = []
    if isinstance(it, pd.DataFrame) and not it.empty:
        for _, r in it.head(15).iterrows():
            text = str(r.get("Text") or "")
            kind = "Sale" if "sale" in text.lower() else "Purchase" if "purchase" in text.lower() or "buy" in text.lower() else "Other"
            insiders.append({"insider": r.get("Insider"), "position": r.get("Position"), "shares": num(r.get("Shares")),
                             "value": num(r.get("Value")), "kind": kind, "text": text[:90],
                             "date": pd.Timestamp(r["Start Date"]).date().isoformat() if pd.notna(r.get("Start Date")) else None})
    sales = sum(1 for x in insiders if x["kind"] == "Sale")
    buys = sum(1 for x in insiders if x["kind"] == "Purchase")
    return clean({"symbol": s, "breakdown": breakdown, "institutions": inst, "insiders": insiders,
                  "insider_sales": sales, "insider_purchases": buys})


# ---- news -----------------------------------------------------------------

_SUFFIXES = ("incorporated", "inc", "corporation", "corp", "company", "co", "limited", "ltd", "plc", "holdings", "group", "the")


def _news_query(name: str, symbol: str) -> str:
    words = [w.strip(".,") for w in name.replace("&", " ").split()]
    core = [w for w in words if w.lower() not in _SUFFIXES]
    phrase = " ".join(core[:3]) or symbol
    return f'"{phrase}" AND (stock OR shares OR earnings OR revenue)'


@ttl_cache(60 * 30)
def news(symbol: str) -> dict:
    from backend.sentiment import fetch_headlines, label_for_score, score_text

    s = require_symbol(symbol)
    name = _info(s).get("longName") or _info(s).get("shortName") or s
    query = _news_query(name, s)
    articles = fetch_headlines(s, lookback_days=14, max_articles=30, query=query)
    core = query.split('"')[1].lower()
    ticker = s.split(".")[0].lower()
    items = []
    for a in articles:
        title = a["title"].lower()
        # Keyword search is loose ("Apple" matches fruit and recipes); keep titles that name the company or ticker.
        if core not in title and (len(ticker) < 3 or ticker not in title.split()):
            continue
        sc = score_text(a["title"])
        items.append({**a, "score": sc, "label": label_for_score(sc)})
    n = len(items)
    pos = sum(1 for x in items if x["label"] == "Positive")
    neg = sum(1 for x in items if x["label"] == "Negative")
    overall = (sum(x["score"] for x in items) / n) if n else 0.0
    sentiment = {"overall_score": round(overall, 3), "label": label_for_score(overall), "article_count": n,
                 "positive_pct": round(pos / n * 100, 1) if n else 0.0, "negative_pct": round(neg / n * 100, 1) if n else 0.0,
                 "neutral_pct": round((n - pos - neg) / n * 100, 1) if n else 0.0}
    return clean({"symbol": s, "query": query, "sentiment": sentiment, "articles": items})
