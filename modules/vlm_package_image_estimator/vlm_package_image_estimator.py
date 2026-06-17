"""
M_VLMPackageImageEstimator: NIM VLM API로 배송 물품 이미지에서 크기·무게 추정
- IMAGE_ANALYZE: image_base64 또는 image_url
- POST {VLM_API_BASE}/chat/vlm/nim (image_url) 또는 /chat/vlm/nim/upload (multipart)
- IMAGE_ANALYZE_RESULT / IMAGE_ANALYZE_ERROR 발행 (기존 위젯과 호환)
"""
from __future__ import annotations

import base64
import io
import json
import os
import re
from typing import Any, Dict, List, Optional

try:
    import requests
except ImportError:
    requests = None

from SagoHub.core.event import Event
from SagoHub.core.module import Module

VLM_API_BASE = os.getenv("VLM_API_BASE", os.getenv("LLM_API_BASE", "https://llm-api.bs-soft.co.kr"))
VLM_NIM_MODEL = os.getenv("VLM_NIM_MODEL", "mistralai/mistral-small-4-119b-2603")
VLM_API_KEY = os.getenv("VLM_API_KEY", os.getenv("LLM_API_KEY", ""))
VLM_UPLOAD_PATH = "/chat/vlm/nim/upload"
VLM_JSON_PATH = "/chat/vlm/nim"

DEFAULT_PROMPT = """이 이미지의 물품을 배송 관점에서 분석하세요.
다음 JSON만 출력하세요 (다른 설명 없이 JSON만):
{"item_name":"물품명","estimated_size":"small 또는 medium 또는 large","estimated_weight_kg":숫자,"note":"한 줄 요약(존댓말)"}
small/medium/large는 박스·가전·가구 등 배송 부피 기준으로 판단하세요."""


class VLMPackageImageEstimatorModule(Module):
    """NVIDIA NIM VLM 기반 배송 물품 크기·무게 추정"""

    name = "M_VLMPackageImageEstimator"
    description = "VLM(NIM) 이미지 분석으로 배송 물품 크기·무게 추정"
    capabilities = ["IMAGE_ANALYZE"]

    def __init__(self, api_base: str = "", model: str = "", api_key: str = ""):
        super().__init__()
        self.api_base = (api_base or VLM_API_BASE).rstrip("/")
        self.model = model or VLM_NIM_MODEL
        self.api_key = api_key or VLM_API_KEY

    def can_handle(self, event: Event) -> float:
        if event.type == "IMAGE_ANALYZE":
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "IMAGE_ANALYZE":
            return []
        if not requests:
            return [
                Event(
                    type="IMAGE_ANALYZE_ERROR",
                    payload={"error": "requests 라이브러리가 필요합니다."},
                    source_module=self.name,
                )
            ]

        p = event.payload or {}
        image_url = (p.get("image_url") or "").strip()
        image_base64 = p.get("image_base64") or ""
        image_base64_list = p.get("image_base64_list")

        has_list = isinstance(image_base64_list, list) and len(image_base64_list) > 0
        if not image_url and not image_base64 and not has_list:
            return []

        try:
            if has_list:
                # 여러 장 각각 분석 후 배송 관점에서 통합 (크기·무게는 보수적으로 큰 쪽)
                raw_list = [x for x in image_base64_list if x][:12]
                parsed_list: List[Dict[str, Any]] = []
                for b64 in raw_list:
                    text = self._call_vlm(image_url="", image_base64=b64)
                    if text:
                        parsed_list.append(self._parse_vlm_json(text))
                if not parsed_list:
                    return [
                        Event(
                            type="IMAGE_ANALYZE_ERROR",
                            payload={"error": "VLM 응답이 비어 있습니다."},
                            source_module=self.name,
                        )
                    ]
                item_info = self._merge_item_infos(parsed_list)
            else:
                text = self._call_vlm(image_url=image_url, image_base64=image_base64)
                if not text:
                    return [
                        Event(
                            type="IMAGE_ANALYZE_ERROR",
                            payload={"error": "VLM 응답이 비어 있습니다."},
                            source_module=self.name,
                        )
                    ]
                item_info = self._parse_vlm_json(text)
            result = {
                "item_name": item_info.get("item_name", "인식된 물품"),
                "estimated_size": item_info.get("estimated_size", "medium"),
                "estimated_weight_kg": float(item_info.get("estimated_weight_kg", 5)),
                "note": item_info.get("note", ""),
                "description": item_info.get("note", ""),
            }
            if result["estimated_size"] not in ("small", "medium", "large"):
                result["estimated_size"] = "medium"

            return [
                Event(
                    type="IMAGE_ANALYZE_RESULT",
                    payload={
                        "image_url": image_url or None,
                        "item_info": item_info,
                        "result": result,
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

    def _headers(self) -> Dict[str, str]:
        h = {}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    def _call_vlm(self, image_url: str, image_base64: str) -> str:
        """VLM API 호출 후 응답 본문에서 텍스트 추출."""
        if image_url and not image_base64:
            url = f"{self.api_base}{VLM_JSON_PATH}"
            body = {
                "prompt": DEFAULT_PROMPT,
                "image_url": image_url,
                "model": self.model,
                "max_tokens": 1024,
                "temperature": 0.2,
            }
            r = requests.post(url, json=body, headers={**self._headers(), "Content-Type": "application/json"}, timeout=120)
            r.raise_for_status()
            return self._extract_text_from_response(r.json())

        raw_b64, mime = self._decode_data_url(image_base64)
        img_bytes = base64.b64decode(raw_b64)
        upload_url = f"{self.api_base}{VLM_UPLOAD_PATH}"
        files = {"image": ("image.jpg", io.BytesIO(img_bytes), mime or "image/jpeg")}
        data = {
            "prompt": DEFAULT_PROMPT,
            "model": self.model,
            "max_tokens": "1024",
            "temperature": "0.2",
        }
        r = requests.post(upload_url, data=data, files=files, headers=self._headers(), timeout=120)
        r.raise_for_status()
        return self._extract_text_from_response(r.json())

    @staticmethod
    def _decode_data_url(image_base64: str) -> tuple:
        s = image_base64.strip()
        if s.startswith("data:"):
            m = re.match(r"data:([^;]+);base64,(.+)", s, re.DOTALL)
            if m:
                return m.group(2).strip(), m.group(1)
        return s, "image/jpeg"

    @staticmethod
    def _extract_text_from_response(data: Any) -> str:
        """API JSON에서 모델이 생성한 텍스트만 추출 (전체 응답을 note에 넣지 않도록)."""
        if isinstance(data, str):
            return data.strip()
        if not isinstance(data, dict):
            return ""

        def _content_from_message(msg: Any) -> str:
            if isinstance(msg, str):
                return msg.strip()
            if isinstance(msg, dict):
                c = msg.get("content")
                if isinstance(c, str):
                    return c.strip()
                if isinstance(c, list):
                    parts = []
                    for p in c:
                        if isinstance(p, dict) and p.get("type") == "text":
                            parts.append(str(p.get("text") or ""))
                    return "\n".join(parts).strip()
            return ""

        if "choices" in data:
            c = data["choices"]
            if c and isinstance(c[0], dict):
                t = _content_from_message(c[0].get("message"))
                if t:
                    return t

        # NIM/일부 게이트웨이: 최상위 message 문자열 또는 객체
        if "message" in data:
            t = _content_from_message(data["message"])
            if t:
                return t

        if "content" in data:
            t = data["content"]
            if isinstance(t, str) and t.strip():
                return t.strip()

        if "text" in data:
            t = data["text"]
            if isinstance(t, str) and t.strip():
                return t.strip()

        if "result" in data:
            r = data["result"]
            if isinstance(r, str) and r.strip():
                return r.strip()
            if isinstance(r, dict):
                t = _content_from_message(r.get("message")) or str(r.get("content") or "")
                if t.strip():
                    return t.strip()

        # 마지막 수단: 전체를 텍스트로 쓰지 않음 (파싱 실패 시 짧은 힌트만)
        return ""

    @staticmethod
    def _extract_balanced_json_object(s: str) -> Optional[str]:
        """첫 '{'부터 괄호 균형이 맞는 JSON 오브젝트 문자열 추출."""
        start = s.find("{")
        if start < 0:
            return None
        depth = 0
        in_str = False
        esc = False
        quote = ""
        for i in range(start, len(s)):
            ch = s[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == quote:
                    in_str = False
                continue
            if ch in "\"'":
                in_str = True
                quote = ch
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return s[start : i + 1]
        return None

    @classmethod
    def _item_fields_from_obj(cls, obj: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """배송 물품 필드가 있으면 정규화된 dict 반환."""
        if not isinstance(obj, dict):
            return None
        if "item_name" not in obj and "estimated_size" not in obj:
            return None
        out: Dict[str, Any] = {}
        if "item_name" in obj:
            out["item_name"] = str(obj["item_name"]).strip()
        if "estimated_size" in obj:
            out["estimated_size"] = str(obj["estimated_size"]).lower().strip()
        if "estimated_weight_kg" in obj:
            try:
                out["estimated_weight_kg"] = float(obj["estimated_weight_kg"])
            except (TypeError, ValueError):
                out["estimated_weight_kg"] = 5.0
        if "note" in obj and obj["note"] is not None:
            out["note"] = str(obj["note"]).strip()
        return out if out else None

    @staticmethod
    def _merge_item_infos(items: List[Dict[str, Any]]) -> Dict[str, Any]:
        """여러 이미지 분석 결과를 하나의 배송 추정으로 통합."""
        SIZE_RANK = {"small": 0, "medium": 1, "large": 2}
        if not items:
            return {
                "item_name": "인식된 물품",
                "estimated_size": "medium",
                "estimated_weight_kg": 5.0,
                "note": "",
            }

        def _rank(s: str) -> int:
            return SIZE_RANK.get(str(s).lower().strip(), 1)

        names: List[str] = []
        notes: List[str] = []
        best_size = "medium"
        best_rank = 1
        max_w = 0.0
        generic = ("인식된 물품", "물품", "")

        for it in items:
            nm = str(it.get("item_name") or "").strip()
            if nm and nm not in generic and nm not in names:
                names.append(nm)
            sz = str(it.get("estimated_size") or "medium").lower().strip()
            if sz not in SIZE_RANK:
                sz = "medium"
            r = _rank(sz)
            if r > best_rank:
                best_rank = r
                best_size = sz
            try:
                max_w = max(max_w, float(it.get("estimated_weight_kg") or 0))
            except (TypeError, ValueError):
                pass
            nt = str(it.get("note") or "").strip()
            if nt and nt not in notes:
                notes.append(nt)

        item_name = " · ".join(names) if names else str(items[0].get("item_name") or "복수 물품")
        note_joined = " | ".join(notes)[:800] if notes else ""
        if len(names) > 1 and note_joined:
            note_joined = f"({len(items)}장 분석) " + note_joined
        elif len(names) > 1:
            note_joined = f"총 {len(items)}장의 사진을 종합했습니다."

        return {
            "item_name": item_name,
            "estimated_size": best_size,
            "estimated_weight_kg": max_w if max_w > 0 else float(items[0].get("estimated_weight_kg") or 5),
            "note": note_joined,
        }

    @classmethod
    def _parse_vlm_json(cls, text: str, _depth: int = 0) -> Dict[str, Any]:
        """마크다운 코드블록 / 중첩 message / 괄호 균형 JSON에서 물품 필드 추출."""
        defaults: Dict[str, Any] = {
            "item_name": "인식된 물품",
            "estimated_size": "medium",
            "estimated_weight_kg": 5.0,
            "note": "",
        }
        out = dict(defaults)
        if not text or not str(text).strip():
            return out

        raw = str(text).strip()

        # ```json ... ``` 또는 ``` ... ```
        fence = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw, re.IGNORECASE)
        if fence:
            raw = fence.group(1).strip()

        candidates: List[str] = []
        if raw:
            candidates.append(raw)
        if text.strip() != raw:
            candidates.append(text.strip())

        for cand in candidates:
            if not cand:
                continue
            chunks: List[str] = []
            bal = cls._extract_balanced_json_object(cand)
            if bal:
                chunks.append(bal)
            if cand not in chunks:
                chunks.append(cand)

            for chunk in chunks:
                try:
                    obj = json.loads(chunk)
                except json.JSONDecodeError:
                    continue
                if not isinstance(obj, dict):
                    continue
                fields = cls._item_fields_from_obj(obj)
                if fields:
                    out.update(fields)
                    return out
                if _depth < 4 and isinstance(obj.get("message"), str):
                    inner = cls._parse_vlm_json(obj["message"], _depth + 1)
                    if inner.get("item_name") != defaults["item_name"]:
                        return inner
                    if inner.get("estimated_size") != defaults["estimated_size"]:
                        return inner
                    if inner.get("estimated_weight_kg") != defaults["estimated_weight_kg"]:
                        return inner
                    if inner.get("note"):
                        return inner

        # 파싱 실패: note에 원본 전체가 아닌 짧은 스니펫만
        out["note"] = (text[:400] + "…") if len(text) > 400 else text
        return out
