"""
Data layer.

Primary source: Yahoo Finance (yfinance) — free, no key. Daily history +
~15-min delayed quotes. Tadawul code 2222 maps to Yahoo symbol '2222.SR'.

Fallback: SAHMK Free REST API — used only if Yahoo returns nothing for a symbol,
and for the TASI index if Yahoo's index symbol misbehaves. Needs SAHMK_API_KEY.

Every quote carries a timestamp and a `delayed` flag so an alert always tells you
what it is acting on.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import pandas as pd

SAHMK_BASE = "https://app.sahmk.sa/api/v1"


@dataclass
class Quote:
    code: str
    price: float
    ts: str          # ISO timestamp of the price
    delayed: bool     # True on free/delayed data
    source: str       # 'yahoo' or 'sahmk'


def yahoo_symbol(code: str) -> str:
    """Tadawul code -> Yahoo symbol. '2222' -> '2222.SR'. Index symbols
    already starting with '^' pass through."""
    code = str(code).strip()
    if code.startswith("^"):
        return code
    return f"{code}.SR"


def _naive_index(df: pd.DataFrame) -> pd.DataFrame:
    """Force a tz-naive DatetimeIndex.

    yfinance's batch download (yf.download) and its per-symbol fallback
    (yf.Ticker(...).history()) disagree on tz-awareness — the batch path
    comes back naive, the per-symbol one tz-aware (observed live: ^TASI.SR
    fell back to the per-symbol path while other codes used the batch path,
    and mixing the two made Series.asof raise). Normalizing every path
    through here kills that whole class of mismatch before it reaches a
    caller.
    """
    if df is None or df.empty:
        return df
    idx = pd.to_datetime(df.index, errors="coerce")
    # Keep the exchange's local calendar date. Converting an Asia/Riyadh
    # midnight to UTC before dropping its timezone would turn it into 21:00
    # on the preceding day, which corrupts daily-bar labels.
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    df = df.copy()
    df.index = idx.normalize()
    return df[df.index.notna()]


# --- Yahoo -----------------------------------------------------------------
def _yahoo_history(symbol: str, period: str) -> pd.DataFrame:
    import yfinance as yf  # imported lazily so tests can run without it.
    df = yf.Ticker(symbol).history(period=period, auto_adjust=False)
    if df is None or df.empty:
        return pd.DataFrame()
    df = df.rename(columns=str.title)  # normalize column casing.
    keep = [c for c in ["Open", "High", "Low", "Close", "Volume"] if c in df.columns]
    return _naive_index(df[keep].dropna())


def _yahoo_history_adjusted(symbol: str, period: str) -> pd.DataFrame:
    """Same as _yahoo_history but split/dividend-adjusted (auto_adjust=True)."""
    import yfinance as yf  # imported lazily so tests can run without it.
    df = yf.Ticker(symbol).history(period=period, auto_adjust=True)
    if df is None or df.empty:
        return pd.DataFrame()
    df = df.rename(columns=str.title)  # normalize column casing.
    keep = [c for c in ["Open", "High", "Low", "Close", "Volume"] if c in df.columns]
    return _naive_index(df[keep].dropna())


# --- SAHMK fallback --------------------------------------------------------
def _sahmk_get(path: str, params: dict | None = None) -> dict | None:
    key = os.environ.get("SAHMK_API_KEY")
    if not key:
        return None
    import requests
    try:
        r = requests.get(
            f"{SAHMK_BASE}{path}",
            params=params or {},
            headers={"X-API-Key": key},
            timeout=15,
        )
        if r.status_code != 200:
            return None
        return r.json()
    except Exception:
        return None


def _sahmk_quote(code: str) -> Quote | None:
    data = _sahmk_get(f"/quote/{code}/")
    if not data:
        return None
    # The single-symbol endpoint returns one quote object. Retain support for
    # wrapped responses so a provider envelope change fails closed, not loudly.
    if isinstance(data, dict) and any(key in data for key in ("price", "last", "close")):
        row = data
    else:
        rows = data if isinstance(data, list) else data.get("data") or data.get("results") or []
        row = rows[0] if rows else None
    if not isinstance(row, dict):
        return None
    price = next((row[key] for key in ("price", "last", "close") if row.get(key) is not None), None)
    timestamp = row.get("timestamp") or row.get("time")
    if price is None or not timestamp:
        return None
    return Quote(
        code=str(code),
        price=float(price),
        ts=str(timestamp),
        delayed=True,  # Free/Starter delayed unless you know you are on realtime.
        source="sahmk",
    )


# --- Public API ------------------------------------------------------------
# In-run memo: (code, period) -> DataFrame. One process = one run, so a plain
# module dict is enough; nothing is fetched twice within a run.
_HISTORY_CACHE: dict = {}


def _clean_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    df = df.rename(columns=str.title)
    keep = [c for c in ["Open", "High", "Low", "Close", "Volume"] if c in df.columns]
    return df[keep].dropna()


def get_histories(codes: list, period: str = "1y") -> dict:
    """Daily OHLCV history for many codes in ONE Yahoo request (threaded batch
    download) instead of a serial per-ticker loop. Results are cached for the
    rest of the run, so later get_history() calls are free.

    Returns {code: DataFrame}; a code with no data maps to an empty frame.
    """
    todo = [c for c in codes if (c, period) not in _HISTORY_CACHE]
    if todo:
        import yfinance as yf
        symbols = {yahoo_symbol(c): c for c in todo}
        try:
            batch = yf.download(list(symbols), period=period, auto_adjust=False,
                                group_by="ticker", threads=True, progress=False)
        except Exception:
            batch = None
        for sym, code in symbols.items():
            df = pd.DataFrame()
            if batch is not None and not batch.empty:
                try:
                    part = batch[sym] if isinstance(batch.columns, pd.MultiIndex) else batch
                    df = _clean_ohlcv(part)
                except Exception:
                    df = pd.DataFrame()
            if df.empty:
                # Per-code retry covers symbols the batch call dropped.
                try:
                    df = _yahoo_history(sym, period)
                except Exception:
                    df = pd.DataFrame()
            _HISTORY_CACHE[(code, period)] = df
    return {c: _HISTORY_CACHE[(c, period)] for c in codes}


# Separate in-run memo for adjusted history. Kept apart from _HISTORY_CACHE
# because both dicts would otherwise share the same (code, period) key space
# — whichever function ran first for a given key would silently hand its
# (adjusted or unadjusted) result to the other, depending on call order.
_HISTORY_CACHE_ADJUSTED: dict = {}


def get_histories_adjusted(codes: list, period: str = "1y") -> dict:
    """Split/dividend-adjusted daily OHLCV for many codes, batched like get_histories().

    Exists separately from get_histories() (which hardcodes auto_adjust=False,
    so a stock split shows up as a phantom price jump) and from
    backtest.load_adjusted() (which is correctly adjusted but caches to disk
    forever — right for a static 5-year research corpus, wrong for a live
    scanner that needs today's actual bar on every run). No disk cache here:
    every call hits the network for any code not already fetched this run.

    Returns {code: DataFrame}; a code with no data maps to an empty frame.
    """
    todo = [c for c in codes if (c, period) not in _HISTORY_CACHE_ADJUSTED]
    if todo:
        import yfinance as yf
        symbols = {yahoo_symbol(c): c for c in todo}
        try:
            batch = yf.download(list(symbols), period=period, auto_adjust=True,
                                group_by="ticker", threads=True, progress=False)
        except Exception:
            batch = None
        for sym, code in symbols.items():
            df = pd.DataFrame()
            if batch is not None and not batch.empty:
                try:
                    part = batch[sym] if isinstance(batch.columns, pd.MultiIndex) else batch
                    df = _clean_ohlcv(part)
                except Exception:
                    df = pd.DataFrame()
            if df.empty:
                # Per-code retry covers symbols the batch call dropped.
                try:
                    df = _yahoo_history_adjusted(sym, period)
                except Exception:
                    df = pd.DataFrame()
            _HISTORY_CACHE_ADJUSTED[(code, period)] = df
    return {c: _HISTORY_CACHE_ADJUSTED[(c, period)] for c in codes}


def get_history(code: str, period: str = "1y") -> pd.DataFrame:
    """Daily OHLCV history. Yahoo first, empty DataFrame if unavailable.
    (SAHMK Free has no history, so no history fallback here.)"""
    key = (code, period)
    if key in _HISTORY_CACHE:
        return _HISTORY_CACHE[key]
    try:
        df = _yahoo_history(yahoo_symbol(code), period)
    except Exception:
        df = pd.DataFrame()
    _HISTORY_CACHE[key] = df
    return df


def get_quote(code: str, delayed_default: bool = True) -> Quote | None:
    """Latest price. Yahoo first (from the most recent daily bar), SAHMK fallback."""
    try:
        df = _yahoo_history(yahoo_symbol(code), "5d")
        if not df.empty:
            last = df.iloc[-1]
            return Quote(
                code=str(code),
                price=float(last["Close"]),
                ts=str(df.index[-1]),
                delayed=delayed_default,
                source="yahoo",
            )
    except Exception:
        pass
    return _sahmk_quote(code)


# --- Symbol integrity ------------------------------------------------------
# Config codes are hand-entered and many were best-guesses (verified:False).
# A wrong code silently resolves to a real, tradeable, WRONG company — e.g.
# 6015 is Americana Restaurants, not Jahez. These helpers catch that by
# comparing the config name to the company name Yahoo returns for the code.
_NAME_NOISE = {
    "company", "co", "plc", "inc", "ltd", "limited", "corporation", "corp",
    "group", "holding", "holdings", "international", "factory", "industries",
    "industrial", "the", "and", "for", "of", "saudi", "arabia", "arabian",
}


def _norm_tokens(name: str) -> set:
    """Lowercase, strip punctuation and generic corporate words -> token set."""
    if not name:
        return set()
    cleaned = "".join(ch if ch.isalnum() or ch.isspace() else " " for ch in name.lower())
    return {t for t in cleaned.split() if t and t not in _NAME_NOISE}


def verify_symbol(config_name: str, yahoo_name: str) -> tuple[bool, str]:
    """Pure name check. Returns (verified, reason). No network.

    Verified when the config name's distinctive tokens are all present in the
    Yahoo name (or vice-versa for short names). Handles suffix noise ('Nahdi
    Medical' vs 'Nahdi Medical Company'). Does NOT handle brand-vs-legal-name
    cases (Avalon Pharma == 'Middle East Pharmaceutical Industries') — those
    are confirmed once by the user in symbols.json and skip this function.
    """
    if not yahoo_name:
        return False, "no company name from data source"
    cfg = _norm_tokens(config_name)
    yah = _norm_tokens(yahoo_name)
    if not cfg or not yah:
        return False, f"unmatchable names (cfg '{config_name}' / yahoo '{yahoo_name}')"
    # All of the smaller token set present in the larger => same company.
    small, large = (cfg, yah) if len(cfg) <= len(yah) else (yah, cfg)
    if small <= large:
        return True, "name match"
    overlap = cfg & yah
    if overlap and len(overlap) >= max(1, min(len(cfg), len(yah)) - 1):
        return True, "name match (partial)"
    return False, f"cfg '{config_name}' != Yahoo '{yahoo_name}'"


def _yahoo_name(code: str) -> str:
    """Company long name for a code, '' on failure. One network call."""
    try:
        import yfinance as yf
        info = yf.Ticker(yahoo_symbol(code)).get_info()
        return (info.get("longName") or info.get("shortName") or "").strip()
    except Exception:
        return ""


def get_index_history(index_code: str, period: str = "6mo") -> pd.DataFrame:
    """TASI index daily history for the regime filter."""
    try:
        df = _yahoo_history(yahoo_symbol(index_code), period)
        if not df.empty:
            return df
    except Exception:
        pass
    # SAHMK index summary fallback (single point, wrapped as a 1-row frame).
    data = _sahmk_get("/index/", {"symbol": "TASI"})
    if data:
        val = (data.get("value") or data.get("last") or data.get("close")
               if isinstance(data, dict) else None)
        if val is not None:
            return pd.DataFrame({"Close": [float(val)]})
    return pd.DataFrame()
