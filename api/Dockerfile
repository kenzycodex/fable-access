# Fable API — FastAPI backend
FROM python:3.12-slim

WORKDIR /app

# Install deps first for layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

# Railway/Render inject $PORT; default to 8010 for local `docker run`
ENV PORT=8010
EXPOSE 8010

# Shell form so $PORT expands at runtime
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT}
