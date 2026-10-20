"""Logging for the API process: one handler on stdout, scrubbed of secrets.

Before this, the app's own loggers (fable.*) had no handler, so only warnings
reached the output through Python's fallback, and every INFO line (retention
passes, coarsened rows, deploy-time migrations) was dropped.

FABLE_LOG_FORMAT=json gives one JSON object per line (the default in
production, for log shipping); "text" is the default elsewhere.
FABLE_LOG_LEVEL sets the level (INFO).
"""
from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "time": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False)


def configure(environment: str) -> None:
    from core.secrets import ScrubFilter

    fmt = (os.getenv("FABLE_LOG_FORMAT") or ("json" if environment == "production" else "text")).lower()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if fmt == "json"
                         else logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    handler.addFilter(ScrubFilter())
    fable = logging.getLogger("fable")
    fable.handlers = [handler]
    fable.setLevel((os.getenv("FABLE_LOG_LEVEL") or "INFO").upper())
