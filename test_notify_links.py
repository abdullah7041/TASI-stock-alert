"""Regression coverage for human-facing links in Discord digests."""

import os
import subprocess
import sys

import pytest


@pytest.mark.parametrize("public_url", ["", "https://owner.example/"])
def test_discord_links_never_use_machine_gateway(public_url):
    env = dict(os.environ, COCKPIT_ORIGIN="https://machine-gateway.example",
               COCKPIT_PUBLIC_URL=public_url)
    result = subprocess.run(
        [sys.executable, "-c",
         "import notify; print(notify.build_digest_embeds([], regime='neutral', trade_date='2026-09-09')[0]['description'])"],
        env=env, text=True, capture_output=True, check=True,
    )
    expected = public_url.rstrip("/") or "https://tasi-action-cockpit.ronaldinho1415.workers.dev"
    assert f"[Open TASI Action Cockpit]({expected})" in result.stdout
    assert "machine-gateway" not in result.stdout
