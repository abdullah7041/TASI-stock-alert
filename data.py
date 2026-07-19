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
import time
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


# --- Yahoo -----------------------------------------------------------------
def _yahoo_history(symbol: str, period: str) -> pd.DataFrame:
    import yfinance as yf  # imported lazily so tests can run without it.
    df = yf.Ticker(symbol).history(period=period, auto_adjust=False)
    if df is None or df.empty:
        return pd.DataFrame()
    df = df.rename(columns=str.title)  # normalize column casing.
    keep = [c for c in ["Open", "High", "Low", "Close", "Volume"] if c in df.columns]
    return df[keep].dropna()


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
    data = _sahmk_get("/quotes/", {"symbols": code})
    if not data:
        return None
    # SAHMK returns a list of quote objects; shape-tolerant parse.
    rows = data if isinstance(data, list) else data.get("data") or data.get("results") or []
    if not rows:
        return None
    row = rows[0]
    price = row.get("price") or row.get("last") or row.get("close")
    if price is None:
        return None
    return Quote(
        code=str(code),
        price=float(price),
        ts=str(row.get("timestamp") or row.get("time") or time.strftime("%Y-%m-%dT%H:%M:%S")),
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
