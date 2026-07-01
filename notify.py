"""Discord webhook sender. One POST, no bot token needed."""
import os
import requests

COLORS = {"BUY": 0x2ecc71, "SELL": 0xe74c3c, "TRIM": 0xe67e22,
          "STOP": 0xc0392b, "INFO": 0x3498db}


def send(alert, webhook_url=None):
    """
    alert: dict with keys action, symbol, name, price, message, fields(optional list of (name,value)).
    Returns True on success.
    """
    webhook_url = webhook_url or os.environ.get("DISCORD_WEBHOOK_URL")
    if not webhook_url:
        raise RuntimeError("Missing DISCORD_WEBHOOK_URL")

    action = alert.get("action", "INFO")
    embed = {
        "title": f"{action} - {alert['name']} ({alert['symbol']})",
        "description": alert.get("message", ""),
        "color": COLORS.get(action, COLORS["INFO"]),
        "fields": [{"name": n, "value": str(v), "inline": True}
                   for n, v in alert.get("fields", [])],
        "footer": {"text": "TASI alert - analysis, not advice. Verify live before trading."},
    }
    r = requests.post(webhook_url, json={"embeds": [embed]}, timeout=15)
    r.raise_for_status()
    return True


def send_text(text, webhook_url=None):
    webhook_url = webhook_url or os.environ.get("DISCORD_WEBHOOK_URL")
    r = requests.post(webhook_url, json={"content": text}, timeout=15)
    r.raise_for_status()
    return True
