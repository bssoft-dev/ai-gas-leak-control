"""
M_LLMItemEstimator: 물품명(텍스트)을 받아 LLM으로 배송 크기·무게 추정
- ITEM_DESCRIPTION_ESTIMATE 이벤트 수신 (payload: item_title)
- LLM 호출 후 ITEM_ESTIMATE_RESULT 발행 (estimated_size, estimated_weight_kg, item_name)
"""
from __future__ import annotations

import json
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
#LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")
LLM_MODEL = "openai/gpt-oss-20b"
CHAT_URL = f"{LLM_API_BASE.rstrip('/')}/chat"


class LLMItemEstimatorModule(Module):
    """물품 설명으로 LLM 기반 크기·무게 추정"""

    name = "M_LLMItemEstimator"
    description = "LLM으로 물품명 기반 배송 크기·무게 추정"
    capabilities = ["ITEM_DESCRIPTION_ESTIMATE"]

    def __init__(self, api_base: str = "", api_key: str = "", model: str = ""):
        super().__init__()
        self.api_base = (api_base or LLM_API_BASE).rstrip("/")
        self.chat_url = f"{self.api_base}/chat"
        self.api_key = api_key or LLM_API_KEY
        self.model = model or LLM_MODEL

    def can_handle(self, event: Event) -> float:
        if event.type != "ITEM_DESCRIPTION_ESTIMATE":
            return 0.0
        p = event.payload or {}
        if p.get("item_title") or p.get("item_description"):
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "ITEM_DESCRIPTION_ESTIMATE":
            return []
        if not requests:
            return []
        p = event.payload or {}
        item_title = (p.get("item_title") or p.get("item_description") or "").strip()
        if not item_title:
            return []

        prompt = f"""다음 물품을 배송하려고 합니다. 배송 비용 산정을 위해 아래 항목을 추정해 주세요.
물품: {item_title}

다음 JSON 형식으로만 답하세요. 다른 설명 없이 JSON만 작성하세요.
- estimated_size: small/medium/large 중 하나
- estimated_weight_kg: 숫자(kg)
- item_name: 물품명
- vehicle_type: 오토바이 가능(20kg·0.1m³ 이하)이면 "motorcycle", 아니면 "vehicle"
- need_extra_worker: 50kg 이상 또는 부피 0.5m³ 이상이면 true, 아니면 false
- note: 추론 상세(한글, 존댓말)

예시: {{"estimated_size":"medium","estimated_weight_kg":15,"item_name":"책상","vehicle_type":"vehicle","need_extra_worker":false,"suggested_floor_count":2,"has_elevator":true,"recipient_helps":false,"note":"일반 가정용 책상으로 추정됩니다."}}"""

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
            print(f"[{self.name}] → prompt: {prompt}")
            print(f"[{self.name}] → response: {r.text}")
            r.raise_for_status()
            data = r.json()
            content = self._extract_content(data)
            print(f"[{self.name}] → content: {content}")
            parsed = self._parse_response(content, item_title)
            size = parsed.get("estimated_size", "medium")
            weight_kg = parsed.get("estimated_weight_kg", 5.0)
            name = parsed.get("item_name") or item_title
            note = parsed.get("note", "")
            return [
                Event(
                    type="ITEM_ESTIMATE_RESULT",
                    payload={
                        "estimated_size": size,
                        "estimated_weight_kg": weight_kg,
                        "item_name": name,
                        "note": note,
                        "vehicle_type": parsed.get("vehicle_type", "vehicle"),
                        "need_extra_worker": parsed.get("need_extra_worker", False),
                        "suggested_floor_count": parsed.get("suggested_floor_count", 1),
                        "has_elevator": parsed.get("has_elevator", True),
                        "recipient_helps": parsed.get("recipient_helps", False),
                    },
                    source_module=self.name,
                )
            ]
        except Exception as e:
            return [
                Event(
                    type="ITEM_ESTIMATE_RESULT",
                    payload={
                        "estimated_size": "medium",
                        "estimated_weight_kg": 5.0,
                        "item_name": item_title,
                        "note": "",
                        "vehicle_type": "vehicle",
                        "need_extra_worker": False,
                        "suggested_floor_count": 1,
                        "has_elevator": True,
                        "recipient_helps": False,
                        "error": str(e),
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
        if "message" in data:
            return (data["message"] or "").strip()
        return ""

    def _parse_response(self, text: str, default_name: str) -> Dict[str, Any]:
        out = {
            "estimated_size": "medium",
            "estimated_weight_kg": 5.0,
            "item_name": default_name,
            "note": "추론 실패: 기본값 응답",
            "vehicle_type": "vehicle",
            "need_extra_worker": False,
            "suggested_floor_count": 1,
            "has_elevator": True,
            "recipient_helps": False,
        }
        if not text:
            return out
        try:
            json_match = re.search(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", text, re.DOTALL)
            if not json_match:
                json_match = re.search(r"\{[^{}]*\}", text, re.DOTALL)
            if json_match:
                obj = json.loads(json_match.group())
                size = obj.get("estimated_size", "medium")
                if size not in ("small", "medium", "large"):
                    size = "medium"
                out["estimated_size"] = size
                w = obj.get("estimated_weight_kg")
                if w is not None:
                    out["estimated_weight_kg"] = float(w)
                out["item_name"] = obj.get("item_name", default_name)
                out["note"] = obj.get("note", out["note"])
                vt = obj.get("vehicle_type", "").lower()
                if vt in ("motorcycle", "vehicle"):
                    out["vehicle_type"] = vt
                out["need_extra_worker"] = bool(obj.get("need_extra_worker", False))
                fc = obj.get("suggested_floor_count")
                if fc is not None:
                    try:
                        out["suggested_floor_count"] = max(1, min(50, int(fc)))
                    except (TypeError, ValueError):
                        pass
                out["has_elevator"] = bool(obj.get("has_elevator", True))
                out["recipient_helps"] = bool(obj.get("recipient_helps", False))
        except (json.JSONDecodeError, TypeError, ValueError):
            pass
        return out
