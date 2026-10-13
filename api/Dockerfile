# Fable API — FastAPI backend
FROM python:3.12-slim

# Logs appear immediately, and no .pyc clutter in the image.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Install deps first for layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

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
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT}
