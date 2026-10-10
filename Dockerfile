# One container: React build served by FastAPI. Port 7860 = Hugging Face Spaces default.
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r backend/requirements.txt
COPY backend backend
COPY data/demo data/demo
COPY --from=web /web/dist frontend/dist
RUN chmod -R a+rwX /app
ENV PARK_DB=/tmp/parking.sqlite3 YOLO_CONFIG_DIR=/tmp/Ultralytics
WORKDIR /app/backend
EXPOSE 7860
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
