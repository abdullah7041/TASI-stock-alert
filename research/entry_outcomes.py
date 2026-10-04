from __future__ import annotations

import math

def label_entry_outcome(df, decision_index: int, atr: float, max_hold: int = 60):
    if (not math.isfinite(atr) or atr <= 0 or decision_index < 0 or max_hold < 1
            or decision_index + max_hold >= len(df)): return None
    # Require the entire horizon even for early hits: otherwise tail inclusion
    # would depend on the outcome. Missing settlement/history remains censored.
    horizon = df.iloc[decision_index + 1:decision_index + 1 + max_hold]
    if not all(math.isfinite(float(value)) and float(value) > 0
               for value in horizon[["Open", "High", "Low", "Close"]].to_numpy().flat): return None
    entry = float(df.iloc[decision_index + 1]["Open"])
    target, stop = entry + 3 * atr, entry - 1.5 * atr
    for offset, (_, bar) in enumerate(horizon.iterrows(), 1):
        hit_target, hit_stop = float(bar["High"]) >= target, float(bar["Low"]) <= stop
        if hit_stop: return {"outcome": "stop", "entry": entry, "exit": stop, "bars_held": offset}
        if hit_target: return {"outcome": "target", "entry": entry, "exit": target, "bars_held": offset}
    close = float(horizon.iloc[-1]["Close"])
    return {"outcome": "neither", "entry": entry, "exit": close, "bars_held": max_hold}
