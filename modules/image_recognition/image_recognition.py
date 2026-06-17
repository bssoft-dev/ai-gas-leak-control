"""
M_ImageRecognition: 이미지 인식 모듈
- IMAGE_ANALYZE: 이미지 분석하여 물품 정보 추론 (크기, 무게 포함)
재활용 가능한 이미지 인식 시스템
"""
from __future__ import annotations

import base64
import os
from typing import Any, Dict, List, Optional

try:
    import requests
except ImportError:
    requests = None

from SagoHub.core.event import Event
from SagoHub.core.module import Module

# 환경변수
LLM_API_BASE = os.getenv("LLM_API_BASE", "https://llm-api.bs-soft.co.kr")
LLM_MODEL = os.getenv("LLM_MODEL", "openai/gpt-oss-120b")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_API_URL = f"{LLM_API_BASE.rstrip('/')}/chat"


class ImageRecognitionModule(Module):
    """범용 이미지 인식 모듈 (물품 추론)"""

    name = "M_ImageRecognition"
    description = "이미지 인식 모듈 (물품 정보 추론: 종류, 크기, 무게)"
    capabilities = ["IMAGE_ANALYZE"]

    def __init__(self, api_url: str = "", model: str = "", api_key: str = ""):
        super().__init__()
        self.api_url = api_url or LLM_API_URL
        self.model = model or LLM_MODEL
        self.api_key = api_key or LLM_API_KEY

    def can_handle(self, event: Event) -> float:
        if event.type == "IMAGE_ANALYZE":
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "IMAGE_ANALYZE":
            return []
        
        p = event.payload or {}
        image_url = p.get("image_url", "")
        image_base64 = p.get("image_base64", "")
        
        if not image_url and not image_base64:
            return []

        try:
            # 이미지 다운로드 (URL인 경우)
            image_data = None
            if image_url:
                if requests:
                    response = requests.get(image_url, timeout=10)
                    if response.status_code == 200:
                        image_data = base64.b64encode(response.content).decode("utf-8")
                else:
                    return [
                        Event(
                            type="IMAGE_ANALYZE_ERROR",
                            payload={"error": "requests library not available"},
                            source_module=self.name,
                        )
                    ]
            elif image_base64:
                image_data = image_base64

            if not image_data:
                return []

            # LLM API로 이미지 분석 요청
            if requests:
                response = requests.post(
                    self.api_url,
                    json={
                        "model": self.model,
                        "messages": [
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": """이 이미지를 분석하여 물품 정보를 추론해주세요.
다음 형식으로 JSON 응답해주세요:
{
  "item_name": "물품명",
  "item_category": "카테고리 (가구/전자제품/의류/기타)",
  "estimated_size": "small|medium|large",
  "estimated_weight_kg": 숫자,
  "description": "물품 설명"
}""",
                                    },
                                    {
                                        "type": "image_url",
                                        "image_url": {"url": f"data:image/jpeg;base64,{image_data}"},
                                    },
                                ],
                            }
                        ],
                    },
                    headers={"Authorization": f"Bearer {self.api_key}"} if self.api_key else {},
                    timeout=30,
                )
                
                if response.status_code == 200:
                    data = response.json()
                    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                    
                    # JSON 파싱 시도
                    import json
                    try:
                        item_info = json.loads(content)
                    except:
                        # JSON이 아닌 경우 텍스트에서 추출 시도
                        item_info = {
                            "item_name": "인식된 물품",
                            "item_category": "기타",
                            "estimated_size": "medium",
                            "estimated_weight_kg": 5,
                            "description": content[:200],
                        }
                    
                    return [
                        Event(
                            type="IMAGE_ANALYZE_RESULT",
                            payload={
                                "image_url": image_url,
                                "item_info": item_info,
                            },
                            source_module=self.name,
                        )
                    ]
        except Exception as e:
            return [
                Event(
                    type="IMAGE_ANALYZE_ERROR",
                    payload={"error": str(e)},
                    source_module=self.name,
                )
            ]
        return []
