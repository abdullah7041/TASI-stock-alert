"""
Thin SAHMK API client. Docs: https://www.sahmk.sa/en/developers/docs
Handles Free vs Starter gracefully: methods that need a paid tier return None on 403
so the caller can degrade instead of crashing.
"""
import os
import requests

BASE = "https://app.sahmk.sa/api/v1"


class SahmkError(Exception):
    pass


class Sahmk:
    def __init__(self, api_key=None, data_mode="realtime", timeout=15):
        self.api_key = api_key or os.environ.get("SAHMK_API_KEY")
        if not self.api_key:
            raise SahmkError("Missing SAHMK_API_KEY")
        self.data_mode = data_mode  # 'realtime' (Starter+) or 'delayed' (Free)
        self.timeout = timeout
        self.s = requests.Session()
        self.s.headers.update({"X-API-Key": self.api_key})

    def _get(self, path, params=None, tolerate_plan_limit=True):
        r = self.s.get(f"{BASE}{path}", params=params, timeout=self.timeout)
        if r.status_code == 403 and tolerate_plan_limit:
            return None  # PLAN_LIMIT: feature not on this tier
        if r.status_code == 404:
            return None
        if r.status_code == 429:
            raise SahmkError("Rate limited (429). Slow down or upgrade.")
        if r.status_code == 401:
            raise SahmkError("Invalid API key (401).")
        r.raise_for_status()
        return r.json()

    def resolve_symbol(self, query):
        """Find a real TASI symbol from a name or alias. Returns symbol str or None."""
        data = self._get("/companies/", {"search": query, "market": "TASI", "limit": 5})
        if not data or not data.get("results"):
            return None
        return data["results"][0]["symbol"]

    def quote(self, symbol):
        """Single quote (Free tier OK). Returns dict or None."""
        return self._get(f"/quote/{symbol}/", {"data_mode": self.data_mode})

    def quotes(self, symbols):
        """Bulk quotes (Starter+). Falls back to per-symbol quote() on Free."""
        data = self._get("/quotes/", {"symbols": ",".join(symbols), "data_mode": self.data_mode})
        if data and "quotes" in data:
            return {q["symbol"]: q for q in data["quotes"]}
        # Free-tier fallback: loop single quotes
        out = {}
        for sym in symbols:
            q = self.quote(sym)
            if q:
                out[q["symbol"]] = q
        return out

    def history_closes(self, symbol, days=120):
        """Daily close list oldest->newest (Starter+). Returns [] on Free/unavailable."""
        from datetime import date, timedelta
        frm = (date.today() - timedelta(days=days)).isoformat()
        data = self._get(f"/historical/{symbol}/",
                         {"from": frm, "to": date.today().isoformat(), "interval": "1d"})
        if not data or "data" not in data:
            return []
        return [row["close"] for row in data["data"] if row.get("close") is not None]

    def market_summary(self):
        """TASI index snapshot (Free tier OK). Returns dict or None."""
        return self._get("/market/summary/", {"index": "TASI", "data_mode": self.data_mode})
