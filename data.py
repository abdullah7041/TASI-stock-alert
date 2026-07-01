"""
Data layer. Yahoo Finance primary (free: daily history + ~15-min delayed quote),
SAHMK Free as a fallback quote source. Tadawul code 2222 maps to '2222.SR' on Yahoo.

Rationale: a 6-12 month swing system computes RSI / support / resistance on daily
closes and acts on prices that are 15 min old without harm, so licensed realtime
(SAHMK Starter, 149/mo) isn't needed. Yahoo covers this for 0 SAR. SAHMK Free stays
wired as a fallback for any symbol Yahoo doesn't cover.
"""
import yfinance as yf


def yahoo_symbol(sym):
    return f"{sym}.SR"


def _period_for_days(days):
    if days <= 35:
        return "1mo"
    if days <= 95:
        return "3mo"
    if days <= 185:
        return "6mo"
    if days <= 370:
        return "1y"
    return "2y"


class DataProvider:
    def __init__(self, sahmk=None):
        self.sahmk = sahmk  # optional SAHMK client for fallback quotes

    def history_closes(self, symbol, days=180):
        """Daily closes oldest->newest from Yahoo. [] if unavailable."""
        try:
            df = yf.Ticker(yahoo_symbol(symbol)).history(
                period=_period_for_days(days), interval="1d")
            if len(df):
                return [float(x) for x in df["Close"].dropna().tolist()]
        except Exception:
            pass
        return []

    def quote(self, symbol):
        """Latest (delayed) price. Yahoo primary, SAHMK Free fallback. Dict or None."""
        try:
            t = yf.Ticker(yahoo_symbol(symbol))
            price = None
            try:
                price = float(t.fast_info["last_price"])
            except Exception:
                df = t.history(period="5d", interval="1d")
                if len(df):
                    price = float(df["Close"].dropna().iloc[-1])
            if price and price > 0:
                return {"symbol": symbol, "price": round(price, 2),
                        "is_delayed": True, "source": "yahoo"}
        except Exception:
            pass
        if self.sahmk:
            q = self.sahmk.quote(symbol)
            if q and q.get("price") is not None:
                q["source"] = "sahmk"
                return q
        return None

    def quotes(self, symbols):
        out = {}
        for s in symbols:
            q = self.quote(s)
            if q:
                out[s] = q
        return out
