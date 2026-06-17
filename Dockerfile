# SagoHub — Python 코어 (이벤트 버스, 모듈 로더, services/modules 마운트)
# 빌드: docker build -t sagohub:latest .
# 실행: docker compose up -d

FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# 패키지: PYTHONPATH=/app/src → import SagoHub
# COPY src/SagoHub ./src/SagoHub
# 모듈 스캔용 (get_module_map)
# COPY modules ./modules

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/src

# 이벤트 버스 HTTP (compose에서 호스트 포트만 매핑, 컨테이너는 26010)
# document-writer 프론트 Vite dev (vite.config.js server.port 6016)
EXPOSE 26010 6016

COPY scripts/docker-entrypoint-document-writer.sh /usr/local/bin/docker-entrypoint-document-writer.sh
RUN chmod +x /usr/local/bin/docker-entrypoint-document-writer.sh

WORKDIR /app/src/SagoHub/runner

# 기본: 코어 (이벤트 버스 스레드 + 헬스 루프). compose에서 덮어쓸 수 있음.
CMD ["python", "main_core.py"]
