#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

export PYTHONPATH="${PROJECT_ROOT}/src:${PROJECT_ROOT}:${PYTHONPATH:-}"
export EVENT_BUS_URL="${EVENT_BUS_URL:-http://localhost:8000}"

python -m SagoHub.module_runner \
  --module traceability_pdf_vision.TraceabilityPdfVisionModule \
  --host 0.0.0.0 \
  --port "${PORT:-0}" \
  --event-bus-url "${EVENT_BUS_URL}"

