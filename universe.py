"""
TASI ticker universe discovery.

The backtest needs a broad sample of Tadawul names, not just your watchlist —
eight names through a narrow gate produce too few BUY events to tune anything.
Yahoo has no TASI constituent list, so we probe the 4-digit code blocks Tadawul
actually uses and keep whatever returns recent bars.

This is a one-time job (~30 min). The result lives in universe.json and is
committed, so nothing re-probes on a normal run.

Survivorship warning: probing today finds only currently-listed names. Anything
delisted is invisible here, which flatters every backtest built on it.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import data as dat

HERE = Path(__file__).parent
UNIVERSE_FILE = HERE / "universe.json"

# Tadawul 4-digit code blocks, by sector group. Ranges are inclusive and
# deliberately a little wider than the known listings — a miss costs one slot
# in a batch request, a gap costs a whole sector.
CODE_BLOCKS = [
    (1010, 1835),   # banks, materials, energy
    (2001, 2382),   # materials, industrials, utilities
    (3001, 3092),   # cement
    (4001, 4348),   # retail, health care, real estate, media
    (6001, 6099),   # food & beverage, consumer services
    (7010, 7204),   # telecom, tech
    (8010, 8320),   # insurance
]

BATCH_SIZE = 100
PROBE_PERIOD = "1mo"   # recent bars only, so a delisted name does not qualify.


def candidate_codes(blocks: list | None = None) -> list:
    """Every code in the configured blocks, as strings."""
    out = []
    for lo, hi in (blocks or CODE_BLOCKS):
        out.extend(str(c) for c in range(lo, hi + 1))
    return out


def _probe_batch(codes: list, period: str = PROBE_PERIOD) -> list:
    """One batched Yahoo download. Returns the codes that came back with bars."""
    import yfinance as yf

    symbols = {dat.yahoo_symbol(c): c for c in codes}
    try:
        batch = yf.download(list(symbols), period=period, auto_adjust=True,
                            group_by="ticker", threads=True, progress=False)
    except Exception:
        return []
    if batch is None or batch.empty:
        return []

    hits = []
    for sym, code in symbols.items():
        try:
            part = batch[sym].dropna(how="all")
            if len(part) > 0:
                hits.append(code)
        except Exception:
            continue
    return sorted(hits)


def discover(blocks: list | None = None, batch_size: int = BATCH_SIZE,
             progress=print) -> list:
    """Probe every candidate block and return the listed codes.

    Writes universe.json after each batch, so an interrupted run keeps what it
    already found instead of starting over.
    """
    cands = candidate_codes(blocks)
    found: list = []
    started = time.time()

    for i in range(0, len(cands), batch_size):
        chunk = cands[i:i + batch_size]
        hits = _probe_batch(chunk)
        found.extend(hits)
        _write(found, partial=True)
        elapsed = time.time() - started
        done = min(i + batch_size, len(cands))
        progress(f"  {done:>5}/{len(cands)} probed | {len(found):>4} listed "
                 f"| {elapsed / 60:.1f} min elapsed")

    _write(found, partial=False)
    return found


def _write(codes: list, partial: bool) -> None:
    UNIVERSE_FILE.write_text(json.dumps({
        "codes": sorted(set(codes)),
        "count": len(set(codes)),
        "probed_on": time.strftime("%Y-%m-%d"),
        "complete": not partial,
    }, indent=2), encoding="utf-8")


def load() -> list:
    """Codes from universe.json. Empty list if it has not been built yet."""
    if not UNIVERSE_FILE.exists():
        return []
    try:
        return json.loads(UNIVERSE_FILE.read_text(encoding="utf-8")).get("codes", [])
    except Exception:
        return []
