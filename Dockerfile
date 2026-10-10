# One container: React build served by FastAPI. Detectors run with onnxruntime (no PyTorch), ~400 MB RAM.
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend backend
COPY data/demo data/demo
COPY --from=web /web/dist frontend/dist
RUN chmod -R a+rwX /app
ENV PARK_DB=/tmp/parking.sqlite3 ORT_THREADS=2
WORKDIR /app/backend
EXPOSE 10000
# Render (and most hosts) pass the port in $PORT
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
