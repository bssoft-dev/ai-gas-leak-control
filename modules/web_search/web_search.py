"""
M_WebSearch: 웹 검색 모듈 (RAG용)
- EVT_WEB_SEARCH_REQUEST 수신 시 검색 수행 후 EVT_WEB_SEARCH_RESPONSE 발행
- Todo 실행 등에서 정보 보완 시 사용
"""
from __future__ import annotations

from typing import Any, Dict, List

from SagoHub.core.event import Event
from SagoHub.core.module import Module

try:
    from ddgs import DDGS
except ImportError:
    DDGS = None


# 이벤트 타입 상수
EVT_WEB_SEARCH_REQUEST = "EVT_WEB_SEARCH_REQUEST"
EVT_WEB_SEARCH_RESPONSE = "EVT_WEB_SEARCH_RESPONSE"

# 기본 검색 결과 개수
DEFAULT_MAX_RESULTS = 5


class WebSearchModule(Module):
    """웹 검색 요청을 받아 검색 결과를 이벤트로 반환하는 모듈"""

    name = "M_WebSearch"
    description = "웹 검색 요청 수신 시 검색 수행 후 EVT_WEB_SEARCH_RESPONSE 발행 (RAG용)"
    capabilities = [EVT_WEB_SEARCH_REQUEST]

    def can_handle(self, event: Event) -> float:
        if event.type == EVT_WEB_SEARCH_REQUEST:
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type != EVT_WEB_SEARCH_REQUEST:
            return []

        payload = event.payload or {}
        query = (payload.get("query") or "").strip()
        request_id = payload.get("request_id", "")
        max_results = int(payload.get("max_results", DEFAULT_MAX_RESULTS))
        # todo_executor 등에서 전달한 컨텍스트 유지
        passthrough = {k: v for k, v in payload.items() if k not in ("query", "request_id", "max_results")}

        if not query:
            return [
                Event(
                    type=EVT_WEB_SEARCH_RESPONSE,
                    payload={
                        "request_id": request_id,
                        "success": False,
                        "error": "query is empty",
                        "results": [],
                        **passthrough,
                    },
                    source_module=self.name,
                )
            ]

        if DDGS is None:
            return [
                Event(
                    type=EVT_WEB_SEARCH_RESPONSE,
                    payload={
                        "request_id": request_id,
                        "success": False,
                        "error": "ddgs package not installed",
                        "results": [],
                        **passthrough,
                    },
                    source_module=self.name,
                )
            ]

        try:
            ddgs = DDGS()
            raw = list(ddgs.text(query, max_results=min(max_results, 10)))
            results: List[Dict[str, Any]] = []
            for r in raw:
                results.append({
                    "title": r.get("title", ""),
                    "href": r.get("href", ""),
                    "body": r.get("body", ""),
                })
            return [
                Event(
                    type=EVT_WEB_SEARCH_RESPONSE,
                    payload={
                        "request_id": request_id,
                        "success": True,
                        "query": query,
                        "results": results,
                        **passthrough,
                    },
                    source_module=self.name,
                )
            ]
        except Exception as e:
            return [
                Event(
                    type=EVT_WEB_SEARCH_RESPONSE,
                    payload={
                        "request_id": request_id,
                        "success": False,
                        "error": str(e),
                        "query": query,
                        "results": [],
                        **passthrough,
                    },
                    source_module=self.name,
                )
            ]
