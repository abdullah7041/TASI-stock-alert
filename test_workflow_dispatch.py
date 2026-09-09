"""Exercise the workflow's real mode-selection shell and the runtime gate."""
from datetime import datetime, timezone
import os
from pathlib import Path
import shutil
import subprocess

import pytest
import yaml
import main


@pytest.mark.parametrize("mode", ["digest", "digest-guard"])
def test_manual_recovery_dispatch_reaches_runtime_after_close(tmp_path, mode):
    workflow = yaml.safe_load(Path(".github/workflows/tasi.yml").read_text(encoding="utf-8"))
    script = next(step["run"] for step in workflow["jobs"]["watch"]["steps"] if step.get("name") == "Pick mode")
    for key, value in {"github.event_name": "workflow_dispatch", "github.event.inputs.mode": mode,
                       "github.event.schedule": ""}.items():
        script = script.replace("${{ " + key + " }}", value)
    bash = r"C:\Program Files\Git\bin\bash.exe" if os.name == "nt" else shutil.which("bash")
    assert bash, "The production workflow requires Bash."
    clock = "date() { printf '%s\\n' '2026-09-09T18:37:00Z'; };\n"
    result = subprocess.run([bash, "-c", clock + script], cwd=tmp_path,
                            env={**os.environ, "GITHUB_OUTPUT": "output.txt"},
                            text=True, capture_output=True)
    assert result.returncode == 0, result.stderr
    outputs = dict(line.split("=", 1) for line in (tmp_path / "output.txt").read_text().splitlines())
    assert outputs["mode"] == mode
    assert main.gate_or_none(mode, now=datetime(2026, 9, 9, 18, 37, tzinfo=timezone.utc),
                             scheduled_for=outputs["scheduled_for"]) is None
    assert outputs["actual_utc"].endswith("Z")
