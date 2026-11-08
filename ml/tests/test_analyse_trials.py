"""analyse_trials.py reads the app's export format (fixture made by make_sample_run.mjs)."""

import json
import subprocess
import sys
from pathlib import Path

FIXTURE = Path(__file__).parent / "fixtures" / "sample_run.json"
SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "analyse_trials.py"


def test_analyse_trials_writes_tables_and_charts(tmp_path):
    result = subprocess.run(  # noqa: S603 - fixed arguments.
        [sys.executable, str(SCRIPT), str(FIXTURE), "--out", str(tmp_path)],
        capture_output=True,
        text=True,
        check=True,
    )
    summary = json.loads((tmp_path / "summary.json").read_text(encoding="utf8"))
    accuracy = summary["accuracy"]
    # Fixture: 6 known (4 right, 1 wrong lock, 1 timeout), 2 unknown (1 false accept).
    assert (accuracy["known"], accuracy["unknown"]) == (6, 2)
    assert (accuracy["top1"]["k"], accuracy["top1"]["n"]) == (4, 6)
    assert (accuracy["false_accept"]["k"], accuracy["false_accept"]["n"]) == (1, 2)
    assert (accuracy["precision"]["k"], accuracy["precision"]["n"]) == (4, 5)
    # Every frame of every trial, pooled; frames after a lock are not counted: 6 trials lock
    # on their 9th frame, 2 never lock and run all 12.
    assert summary["stages"]["detect"]["n"] == 6 * 9 + 2 * 12
    assert summary["end_to_end"]["Start -> locked match"]["median"] == 1125

    tables = (tmp_path / "chapter4_5.md").read_text(encoding="utf8")
    for heading in ("Evaluation setup", "Recognition accuracy", "per stage", "Isolated model"):
        assert heading in tables
    assert "Detector inference" in result.stdout
    rows = (tmp_path / "trials.csv").read_text(encoding="utf8").strip().splitlines()
    assert len(rows) == 1 + 8
    for chart in ("latency_stages", "time_to_lock", "product_accuracy", "confusion"):
        assert (tmp_path / f"{chart}.png").stat().st_size > 1000
