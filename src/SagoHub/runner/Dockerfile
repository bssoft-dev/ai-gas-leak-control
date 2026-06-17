# SagoHub Runner Dockerfile
# Build context: project root (so COPY src/... works)

FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# src/SagoHub -> /app/src/SagoHub (PYTHONPATH=/app/src)
COPY src/SagoHub/ ./src/SagoHub/
# Runner scripts
COPY src/SagoHub/runner/main.py .
COPY src/SagoHub/runner/module_runner.py .
COPY src/SagoHub/runner/service_runner.py .
COPY src/SagoHub/runner/service_ui_runner.py .

VOLUME ["/services", "/watch"]
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/src
ENV PIPELINES_DIR=/services
ENV SERVICES_DIR=/services
ENV LOCAL_MOUNT_POINT=/watch

CMD ["python", "main.py"]
