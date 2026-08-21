"""
Chart rendering for the pre-open digest.

You asked to read charts. Until now nothing in this repo drew one: the engine
computed RSI, ATR, trend and support/resistance and shipped them all as text.
A number tells you RSI is 50.6. A chart tells you the shape that produced it,
and where today sits against the stop you would actually trade.

Rendered headless with matplotlib in GitHub Actions, attached to the Discord
digest as PNGs. Pre-open only, never on the ~20 session runs -- eleven images
on every one of those would be slow, pointless and rate-limited.
"""

from __future__ import annotations

from pathlib import Path

import matplotlib
matplotlib.use("Agg")  # no display in Actions; must precede pyplot.
import matplotlib.pyplot as plt  # noqa: E402
import matplotlib.dates as mdates  # noqa: E402

# Dark, because Discord's default theme is. A white chart in a dark client is
# the visual equivalent of shouting.
BG = "#2b2d31"
FG = "#dbdee1"
GRID = "#3f4147"
UP = "#2ecc71"
DOWN = "#e74c3c"
LEVEL_COLORS = {"stop": "#e74c3c", "trim": "#f1c40f", "target": "#2ecc71"}

DEFAULT_BARS = 90
# Volume bars past this multiple of the median get highlighted, matching
# analyze.volume_read's own "unusual" threshold so the chart and the text
# cannot disagree about which day was busy.
VOLUME_HIGHLIGHT_RATIO = 2.0


def _style(ax):
    ax.set_facecolor(BG)
    ax.tick_params(colors=FG, labelsize=8)
    ax.grid(True, color=GRID, linewidth=0.5, alpha=0.6)
    for spine in ax.spines.values():
        spine.set_color(GRID)


def render(code: str, name: str, df, levels: dict | None, out_dir: Path,
           bars: int = DEFAULT_BARS) -> Path | None:
    """Candlestick + volume for one name. Returns the PNG path, or None.

    None rather than an exception when there is too little history: a missing
    chart must degrade the digest to text, never take delivery down. The caller
    ships the embed either way.
    """
    if df is None or df.empty or len(df) < 5:
        return None
    window = df.tail(bars)
    if window.empty:
        return None

    fig, (price_ax, vol_ax) = plt.subplots(
        2, 1, figsize=(9, 5.2), sharex=True,
        gridspec_kw={"height_ratios": [3, 1], "hspace": 0.08})
    fig.patch.set_facecolor(BG)

    xs = mdates.date2num(window.index.to_pydatetime())
    width = 0.6
    for x, (_, row) in zip(xs, window.iterrows()):
        rising = row["Close"] >= row["Open"]
        color = UP if rising else DOWN
        price_ax.vlines(x, row["Low"], row["High"], color=color, linewidth=0.8)
        lower = min(row["Open"], row["Close"])
        price_ax.add_patch(plt.Rectangle(
            (x - width / 2, lower), width, max(abs(row["Close"] - row["Open"]), 1e-9),
            facecolor=color, edgecolor=color, linewidth=0.5))

    # Room on the right for the level labels, which are annotated at the last
    # bar and otherwise print over the axis edge and get clipped.
    span = (xs[-1] - xs[0]) or 1.0
    price_ax.set_xlim(xs[0] - span * 0.02, xs[-1] + span * 0.12)

    last = float(window["Close"].iloc[-1])
    for label, value in (levels or {}).items():
        if label not in LEVEL_COLORS or value is None:
            continue
        # hlines, not axhline: the line must stop at the last bar so the label
        # sits in clear space instead of printing on top of its own line.
        price_ax.hlines(float(value), xs[0], xs[-1], color=LEVEL_COLORS[label],
                        linestyle="--", linewidth=1.0, alpha=0.9)
        price_ax.annotate(f"{label} {float(value):.2f}",
                          xy=(xs[-1], float(value)), xytext=(6, 0),
                          textcoords="offset points", color=LEVEL_COLORS[label],
                          fontsize=7, va="center", fontweight="bold")

    price_ax.set_title(f"{code} {name} — {last:.2f} SAR, last {len(window)} sessions",
                       color=FG, fontsize=10, loc="left")
    _style(price_ax)

    turnover = window["Close"] * window["Volume"]
    median = float(turnover.median()) or 1.0
    vol_colors = ["#f1c40f" if t >= median * VOLUME_HIGHLIGHT_RATIO
                  else (UP if c >= o else DOWN)
                  for t, c, o in zip(turnover, window["Close"], window["Open"])]
    vol_ax.bar(xs, window["Volume"], width=width, color=vol_colors, alpha=0.85)
    vol_ax.set_ylabel("vol", color=FG, fontsize=8)
    _style(vol_ax)

    vol_ax.xaxis.set_major_formatter(mdates.DateFormatter("%d %b"))
    fig.autofmt_xdate(rotation=0, ha="center")

    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{code}.png"
    fig.savefig(path, facecolor=BG, dpi=110, bbox_inches="tight")
    plt.close(fig)
    return path
