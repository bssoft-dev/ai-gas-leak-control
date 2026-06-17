"""
M_LLMRouteEstimator: 출발지·목적지 주소를 받아 LLM으로 차량 이동 거리(km) 추정
- ROUTE_CALCULATE 이벤트 수신 (payload: origin_address, dest_address)
- LLM 호출 후 ROUTE_CALCULATED 발행 (distance_km, note)
"""
from __future__ import annotations

import os
import re
from typing import Any, Dict, List

try:
    import requests
except ImportError:
    requests = None

from SagoHub.core.event import Event
from SagoHub.core.module import Module

LLM_API_BASE = os.getenv("LLM_API_BASE", "https://llm-api.bs-soft.co.kr")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")
CHAT_URL = f"{LLM_API_BASE.rstrip('/')}/chat"


class LLMRouteEstimatorModule(Module):
    """출발지·목적지 주소로 LLM 기반 차량 이동 거리 추정"""

    name = "M_LLMRouteEstimator"
    description = "LLM으로 출발지·목적지 간 차량 이동 거리(km) 추정"
    capabilities = ["ROUTE_CALCULATE"]

    def __init__(self, api_base: str = "", api_key: str = "", model: str = ""):
        super().__init__()
        self.api_base = (api_base or LLM_API_BASE).rstrip("/")
        self.chat_url = f"{self.api_base}/chat"
        self.api_key = api_key or LLM_API_KEY
        self.model = model or LLM_MODEL

    def can_handle(self, event: Event) -> float:
        if event.type != "ROUTE_CALCULATE":
            return 0.0
        p = event.payload or {}
        if p.get("origin_address") or p.get("dest_address"):
            return 1.0
        if p.get("origin_lat") is not None and p.get("dest_lat") is not None:
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "ROUTE_CALCULATE":
            return []
        if not requests:
            return []
        p = event.payload or {}
        origin_address = (p.get("origin_address") or "").strip() or "출발지"
        dest_address = (p.get("dest_address") or "").strip() or "목적지"
        origin_lat = p.get("origin_lat")
        origin_lng = p.get("origin_lng")
        dest_lat = p.get("dest_lat")
        dest_lng = p.get("dest_lng")

        prompt = f"""다음 출발지와 목적지 사이를 차량(자동차)으로 이동할 때 예상 이동 거리를 km 단위로 추정해 주세요.
출발지: {origin_address}
목적지: {dest_address}
답변은 반드시 숫자 하나만 작성하세요 (예: 15.5). 단위나 설명 없이 숫자만."""

        try:
            headers = {"Content-Type": "application/json"}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            r = requests.post(
                self.chat_url,
                json={"model": self.model, "messages": [{"role": "user", "content": prompt}], "stream": False},
                headers=headers,
                timeout=60,
            )
            r.raise_for_status()
            data = r.json()
            content = self._extract_content(data)
            distance_km = self._parse_km(content)
            if distance_km is None:
                distance_km = 10.0
            distance_m = int(distance_km * 1000)
            return [
                Event(
                    type="ROUTE_CALCULATED",
                    payload={
                        "origin": {"lat": origin_lat, "lng": origin_lng},
                        "dest": {"lat": dest_lat, "lng": dest_lng},
                        "distance_km": round(distance_km, 2),
                        "distance_m": distance_m,
                        "duration_sec": None,
                        "route": None,
                        "note": "LLM 기반 차량 이동 거리 추정",
                    },
                    source_module=self.name,
                )
            ]
        except Exception as e:
            return [
                Event(
                    type="ROUTE_CALCULATED",
                    payload={
                        "origin": {"lat": origin_lat, "lng": origin_lng},
                        "dest": {"lat": dest_lat, "lng": dest_lng},
                        "distance_km": 10.0,
                        "distance_m": 10000,
                        "duration_sec": None,
                        "route": None,
                        "note": f"LLM 추정 실패, 기본값 사용: {e}",
                    },
                    source_module=self.name,
                )
            ]

    def _extract_content(self, data: dict) -> str:
        if "choices" in data and len(data["choices"]) > 0:
            c = data["choices"][0]
            if "message" in c and "content" in c["message"]:
                return (c["message"]["content"] or "").strip()
        if "content" in data:
            return (data["content"] or "").strip()
        return ""

    def _parse_km(self, text: str) -> float | None:
        if not text:
            return None
        match = re.search(r"(\d+(?:\.\d+)?)", text.replace(",", ""))
        if match:
            return float(match.group(1))
        return None
