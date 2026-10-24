"""The API's own log lines reach stdout, as JSON in production, scrubbed."""
import json
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_production_logs_are_json_lines_without_secrets(capsys, monkeypatch):
    from core import logs

    monkeypatch.delenv("FABLE_LOG_FORMAT", raising=False)
    logs.configure("production")
    logging.getLogger("fable.test").info("retention removed %s rows; key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123", 3)
    line = capsys.readouterr().out.strip().splitlines()[-1]
    entry = json.loads(line)
    assert entry["level"] == "INFO" and entry["logger"] == "fable.test"
    assert "3 rows" in entry["message"] and "abcdefghijklmnop" not in entry["message"]
    logs.configure("development")
