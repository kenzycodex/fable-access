#!/bin/sh
# Backend tests and lint on Linux, in the production base image, with the
# packages from the "fable-pydeps" volume (see docs/DEPLOYMENT.md, "Running on
# Linux"). Read-only on the source; nothing is written to the repository.
#   docker run --rm -v fable-pydeps:/deps -v "$PWD/api:/app:ro" -w /app python:3.12-slim sh scripts/linux_check.sh [pytest args]
set -e
export PYTHONDONTWRITEBYTECODE=1
/deps/venv/bin/ruff check --no-cache .
/deps/venv/bin/python -m pytest -q -p no:cacheprovider tests "$@"
