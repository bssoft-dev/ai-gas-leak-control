"""
M_LLMFareEstimator: 거리·물품 정보를 받아 LLM으로 예상 배송비(원) 산정
- FARE_CALCULATE 이벤트 수신 (payload: distance_km, item_size, item_weight_kg 등)
- LLM 호출 후 FARE_CALCULATED 발행 (estimated_fare, breakdown)
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
#LLM_MODEL = os.getenv("LLM_MODEL", "gpt-oss-20b")
LLM_MODEL = "gpt-oss-20b"
CHAT_URL = f"{LLM_API_BASE.rstrip('/')}/chat"


class LLMFareEstimatorModule(Module):
    """거리·물품 정보로 LLM 기반 예상 배송비 산정"""

    name = "M_LLMFareEstimator"
    description = "LLM으로 예상 배송비(원) 산정"
    capabilities = ["FARE_CALCULATE"]

    def __init__(self, api_base: str = "", api_key: str = "", model: str = ""):
        super().__init__()
        self.api_base = (api_base or LLM_API_BASE).rstrip("/")
        self.chat_url = f"{self.api_base}/chat"
        self.api_key = api_key or LLM_API_KEY
        self.model = model or LLM_MODEL

    def can_handle(self, event: Event) -> float:
        if event.type != "FARE_CALCULATE":
            return 0.0
        return 1.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "FARE_CALCULATE":
            return []
        if not requests:
            return []
        p = event.payload or {}
        distance_km = float(p.get("distance_km") or 0)
        item_size = p.get("item_size") or "medium"
        item_weight_kg = float(p.get("item_weight_kg") or 0)
        base_fare = p.get("base_fare", 3000)
        per_km = p.get("per_km", 500)

        prompt = f"""다음 조건으로 동네 배송(당배) 예상 비용을 원(krw)으로 추정해 주세요.
- 이동 거리: {distance_km} km (차량 기준)
- 물품 크기: {item_size} (small/medium/large)
- 물품 무게: {item_weight_kg} kg
- 참고: 기본료 약 {base_fare}원, km당 약 {per_km}원 수준을 참고하되, 합리적인 금액으로 한 개 숫자만 답하세요.
답변은 반드시 숫자 하나만 작성하세요 (예: 15000). 단위나 설명 없이 숫자만."""
        print(f"[{self.name}] → prompt: {prompt}")
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
            print(f"[{self.name}] → response: {r.text}")
            r.raise_for_status()
            data = r.json()
            content = self._extract_content(data)
            fare = self._parse_fare(content)
            if fare is None:
                fare = max(5000, int(base_fare + distance_km * per_km))
            return [
                Event(
                    type="FARE_CALCULATED",
                    payload={
                        "estimated_fare": fare,
                        "breakdown": {
                            "base_fare": base_fare,
                            "distance_km": distance_km,
                            "item_size": item_size,
                            "item_weight_kg": item_weight_kg,
                            "total_fare": fare,
                            "note": "LLM 기반 산정",
                        },
                    },
                    source_module=self.name,
                )
            ]
        except Exception as e:
            fallback = max(5000, int(base_fare + distance_km * per_km))
            return [
                Event(
                    type="FARE_CALCULATED",
                    payload={
                        "estimated_fare": fallback,
                        "breakdown": {
                            "base_fare": base_fare,
                            "distance_km": distance_km,
                            "total_fare": fallback,
                            "note": f"LLM 산정 실패, 기본식 적용: {e}",
                        },
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

    def _parse_fare(self, text: str) -> int | None:
        if not text:
            return None
        match = re.search(r"(\d+(?:,\d+)*)", text.replace(" ", ""))
        if match:
            return int(match.group(1).replace(",", ""))
        return None
