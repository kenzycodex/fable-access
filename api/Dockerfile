# Fable API — FastAPI backend
# The base image is pinned by digest, so a rebuild cannot silently pick up a
# different Python or OS layer. Update the digest deliberately.
FROM python:3.12-slim@sha256:423ed6ab25b1921a477529254bfeeabf5855151dc2c3141699a1bfc852199fbf

# Logs appear immediately, and no .pyc clutter in the image.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Install deps first for layer caching, at the exact versions in the lock.
COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock

# Run as an unprivileged user. /data (the SQLite volume) must be writable by
# it: on an existing server, run once `sudo chown -R 10001:10001 data` next to
# docker-compose.yml before the first deploy of this image.
RUN groupadd --system --gid 10001 fable && useradd --system --uid 10001 --gid fable --no-create-home fable     && mkdir -p /data && chown fable:fable /data

# Copy source
COPY --chown=fable:fable . .
USER fable

# Railway/Render inject $PORT; default to 8010 for local `docker run`
ENV PORT=8010
EXPOSE 8010

# Healthy means /health answers 200. Compose and `docker ps` show it, so a
# container that is up but broken no longer looks fine.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT','8010'), timeout=4)" || exit 1

# Shell form so $PORT expands at runtime, with `exec` so uvicorn replaces the
# shell as PID 1. Without it the stop signal never reached uvicorn and every
# `docker compose stop` waited 10 seconds, then killed it.
#
# --proxy-headers makes the client address the real caller's (from Nginx's
# X-Forwarded-For) instead of the proxy's own. Without it every request looked
# like one client: everyone shared one rate-limit bucket and login throttling
# could not tell callers apart. Trusting any forwarder is safe only because the
# port is published on 127.0.0.1 alone (docker-compose.yml), so nothing but the
# local proxy can reach it.
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips '*'
