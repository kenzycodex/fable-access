"""Whether this process can write its SQLite database, said plainly.

The image runs as an unprivileged user (uid 10001, see the Dockerfile). If the
data folder on the host still belongs to root, every write fails and the logs
used to fill with "OperationalError" from each startup task and scheduler
tick, with nothing saying why. This names the problem once: the path, the
owner, and the uid this process runs as.
"""
from __future__ import annotations

import os


def write_problem(db_path: str) -> str | None:
    """None when the database (and its folder, for the -wal and -shm files) is
    writable by this process, else one sentence saying what is wrong."""
    folder = os.path.dirname(os.path.abspath(db_path)) or "."
    uid = os.getuid() if hasattr(os, "getuid") else None
    me = f"uid {uid}" if uid is not None else "this process"
    targets = [folder] + [p for p in (db_path, db_path + "-wal", db_path + "-shm") if os.path.exists(p)]
    for path in targets:
        if not os.access(path, os.W_OK):
            try:
                st = os.stat(path)
                owner = f"owned by uid {st.st_uid}, gid {st.st_gid}"
            except OSError:
                owner = "owner unknown"
            return (f"The database is not writable: {path} is {owner}, and the API runs as {me}. "
                    f"Fix the data folder's ownership (chown -R 10001:10001 on it), then restart.")
    return None
