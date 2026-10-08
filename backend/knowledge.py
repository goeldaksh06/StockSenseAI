"""Everything the copilot may know besides the live numbers on the user's screen.
Keep GLOSSARY keys in sync with frontend/static/js/core/glossary.js (a test enforces this).
"""

GLOSSARY = {
    "mae": "Mean absolute error: on average, how many dollars the predicted close was off from the real close. Lower is better.",
    "rmse": "Like MAE but punishes big misses more. Lower is better.",
    "mape": "Average error as a percent of the price, so stocks at different price levels can be compared.",
    "r2": "How much of the price movement the model explains. Near 1 sounds great, but prices move slowly day to day, so even 'tomorrow = today' scores about 0.98. A high R2 alone means little.",
    "direction": "How often the model correctly said up or down. 50% is a coin flip. Also compare with 'always up', because stocks often rise on most days.",
    "baseline": "The do-nothing rival: predict that tomorrow closes where today closed. A model that cannot beat this adds no value.",
    "always_up": "Never thinks, always says 'up'. Its score is the share of test days the stock rose. A model must beat this, not just 50%.",
    "confidence": "How strongly the classifier leans one way. It is not a probability you can bet on: these scores are usually overconfident.",
    "rsi": "Relative strength index, 0 to 100. Above 70 is often called overbought, below 30 oversold. A description of recent moves, not a prediction.",
    "macd": "Gap between a fast and a slow moving average. Above its signal line means recent momentum is up.",
    "sma": "Simple moving average: the average closing price over the last N days. Smooths noise to show the trend.",
    "sharpe": "Return per unit of risk (annualised). Above 1 is good, near 0 means the return was not worth the swings, negative means worse than cash.",
    "drawdown": "The worst peak-to-trough fall during the period.",
    "winrate": "Of the days actually holding the stock, the share where it went up. Days in cash are not counted.",
    "invested": "Share of days the strategy held the stock. Very low means it mostly sat in cash, so its return is not a test of skill.",
    "total_return": "Gain or loss over the whole test window after trading costs.",
    "sentiment": "A score of how positive or negative recent news headlines sound (VADER word-based scoring). It reads tone, not facts, and is not used by the prediction model.",
    "pe": "Price to earnings: the share price divided by the last twelve months of earnings per share. Higher means investors pay more for each unit of profit, usually because they expect growth. Only meaningful against similar companies.",
    "peg": "P/E divided by expected earnings growth. Around 1 is often read as fairly priced for its growth; well above 2 suggests growth is expensive. Unreliable when growth estimates are low or volatile.",
    "ev_ebitda": "Enterprise value (market cap plus debt minus cash) divided by EBITDA (earnings before interest, tax, depreciation and amortisation). A debt-neutral way to compare what the whole business costs relative to its operating profit.",
    "fcf": "Free cash flow: cash from operations minus capital spending. The cash left over for dividends, buybacks, debt paydown or reinvestment. Hard to fake, so analysts watch it closely.",
    "margin_of_safety": "How far the calculated intrinsic value sits above (positive) or below (negative) the market price. It is only as reliable as the assumptions you entered.",
    "implied_growth": "The yearly free-cash-flow growth rate that would make the DCF value equal today's price. A reverse-engineered view of what the market is already assuming.",
    "ann_return": "The steady yearly return that would produce the same total gain over the window (compound annual growth rate).",
    "volatility": "How much the price swings, as the annualised standard deviation of daily returns. 30% means a typical year moves roughly 30% up or down around its average.",
    "beta": "Sensitivity to the benchmark index. Beta 1.2 means the stock has tended to move 20% more than the index on the same day; below 1 means calmer than the index.",
    "correlation": "How closely daily moves track the benchmark, from -1 to 1. Near 1 the stock mostly just follows the market; near 0 it moves on its own.",
    "alpha": "Return left over after accounting for the stock's market exposure (beta), annualised. Positive means it did better than its risk alone would suggest over this window; it is noisy and rarely persistent.",
    "var": "Value at risk: the daily loss that was exceeded on only 5% of days historically. 2.5% means on the worst 1 day in 20 the stock lost at least 2.5%.",
    "auc": "How well the model ranks up days above down days, from 0 to 1. 0.5 is a coin flip; real stock models usually score 0.50 to 0.53.",
    "brier": "Brier skill scores the model's probabilities against simply quoting the stock's average up-frequency. Above 0 is better than that baseline; negative means the probabilities are overconfident and do more harm than good.",
    "edge": "Model accuracy minus the accuracy of always guessing up, in percentage points. Positive means the model added something beyond the stock's general upward drift.",
}

METHOD = """\
- Data: daily prices from Yahoo Finance (from 2018), turned into 21 features: SMA 5/10/20/50/200, EMA 12/26, RSI, MACD and signal, ROC, Bollinger bands and width, ATR, OBV, plus raw price and volume columns.
- Split: chronological train / validation / test, never shuffled; scalers fit on training data only. The test period is strictly later than anything the model learned from.
- Models: XGBoost classifier (next-day direction), XGBoost regressor (next-day return, converted to a price), an XGBoost price-target model kept as a deliberate failure case, and baselines: previous close, 20-day moving average, linear regression, and 'always up' for direction.
- Backtest: the daily up/down call becomes a long-only strategy with transaction costs, compared with buy and hold on the test period only. Win rate counts only days invested.
- Finding: XGBoost on raw price lost badly to 'tomorrow = today' because trees cannot extrapolate past the training price range. Reframing as return or direction fixed that but created no reliable edge: direction accuracy is typically 45 to 50 percent and the backtest trails buy and hold.
- Why accuracy is low: daily moves are mostly noise; all inputs are public price history and largely priced in; features are redundant and deep trees overfit a few thousand noisy days; one stock and one test window is a small sample (about 300 days gives roughly +/-5.6 points of margin on accuracy).
- The AI briefing explains the numbers in words and does not influence the prediction. News sentiment is shown for context and is not a model input.
- Research pages (any listed stock, from Yahoo Finance): Overview has a rule-based screen where every check shows its rule; Financials shows the income statement, balance sheet and cash flow, annual and quarterly; Valuation has multiples, analyst targets and an interactive two-stage DCF (ten years of free cash flow growing at the chosen rate and fading to the terminal rate, discounted at a CAPM-style rate) plus a reverse-DCF showing the growth the price implies; Risk uses daily returns for volatility, drawdown, beta and correlation versus an index, VaR and CVaR; Technicals shows moving averages, Bollinger bands, RSI and MACD with plain-language readings; Analysts and Ownership show third-party opinions and holdings; News scores headline tone only.
- Evidence page: the direction model re-trained through time (expanding-window walk-forward) across dozens of stocks, compared with 'always up', with bootstrap intervals, AUC, Brier skill and a calibration chart.
- Limits: backtests ignore slippage, taxes and market impact. This is an educational project, not financial advice.
"""
