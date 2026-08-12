from __future__ import annotations

import math

def label_entry_outcome(df, decision_index: int, atr: float, max_hold: int = 60):
    if not math.isfinite(atr) or atr <= 0 or decision_index + 1 >= len(df): return None
    entry = float(df.iloc[decision_index + 1]["Open"])
    target, stop = entry + 3 * atr, entry - 1.5 * atr
    for offset, (_, bar) in enumerate(df.iloc[decision_index + 1:decision_index + 1 + max_hold].iterrows(), 1):
        hit_target, hit_stop = float(bar["High"]) >= target, float(bar["Low"]) <= stop
        if hit_stop: return {"outcome": "stop", "entry": entry, "exit": stop, "bars_held": offset}
        if hit_target: return {"outcome": "target", "entry": entry, "exit": target, "bars_held": offset}
    close = float(df.iloc[min(decision_index + max_hold, len(df) - 1)]["Close"])
    return {"outcome": "neither", "entry": entry, "exit": close, "bars_held": min(max_hold, len(df) - decision_index - 1)}
