"""
서비스: 비즈니스 로직의 집합 (파이프라인 → 서비스 개념 확장)
이벤트와 모듈, UI, 파이프라인을 포괄적으로 관리
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple, TYPE_CHECKING

if TYPE_CHECKING:
    from .event import Event
    from .module import Module
    from .http_client import EventBusHTTPClient

def eval_pattern(pattern: str, event: "Event") -> bool:
    """
    간단한 패턴 평가.
    - "E_FileCreated"
    - "E_FileCreated.path.endswith('.md')"
    - "payload.path.endswith('.txt')"
    """
    if not pattern or not pattern.strip():
        return False
    pattern = pattern.strip()
    # 타입만 비교
    if pattern == event.type:
        return True
    if not pattern.startswith(event.type):
        return False
    rest = pattern[len(event.type) :].strip()
    if not rest or not rest.startswith("."):
        return True
    # payload.path.endswith('.md') 형태
    try:
        expr = rest.lstrip(".")
        expr = re.sub(r"^payload\.", "event.payload.get(", expr)
        # endswith('.md') -> payload.get('path','').endswith('.md')
        if "event.payload.get(" in expr:
            # payload.path -> event.payload.get('path','')
            parts = expr.split(",", 1)
            if len(parts) == 1:
                expr = "event.payload.get('path','')" + expr[expr.index(".") + len("path") :]
            else:
                pass
        # 간단 치환: payload.xxx -> event.payload.get('xxx','')
        def repl(m):
            key = m.group(1)
            return f"event.payload.get({repr(key)}, '')"
        expr = re.sub(r"payload\.(\w+)", repl, expr)
        # 나머지 .endswith 등은 그대로
        return bool(eval(expr, {"event": event, "repr": repr}))
    except Exception:
        return False


class EventMatcher:
    """이벤트 매칭 조건"""

    def __init__(self, pattern: str):
        self.pattern = pattern.strip()

    def matches(self, event: "Event") -> bool:
        return eval_pattern(self.pattern, event)


class Service:
    """
    서비스: 여러 파이프라인, 모듈, UI, 설정 등을 포괄적으로 관리
    (파이프라인 -> 서비스로 개념 확장)
    """

    def __init__(
        self,
        name: str,
        pipelines: Optional[List["Pipeline"]] = None,
        modules: Optional[List["Module"]] = None,
        interfaces: Optional[List[Any]] = None,
        config: Optional[Dict[str, Any]] = None,
        http_client: Optional["EventBusHTTPClient"] = None,
    ):
        self.name = name
        self.pipelines: List[Pipeline] = pipelines if pipelines is not None else []
        self.modules: List["Module"] = modules if modules is not None else []
        self.interfaces = interfaces or []
        self.config = config or {}
        self.http_client = http_client
        self.active = True

    def add_pipeline(self, pipeline: "Pipeline"):
        self.pipelines.append(pipeline)

    def add_module(self, module: "Module"):
        self.modules.append(module)

    def can_handle(self, event: "Event") -> bool:
        """
        서비스 내의 파이프라인 중 해당 이벤트를 처리할 수 있는 것이 있는지 확인
        """
        for pipeline in self.pipelines:
            if pipeline.can_handle(event):
                return True
        return False

    def process(self, event: "Event") -> List["Event"]:
        """
        서비스 전체 처리: 이벤트를 받아 처리 가능한 파이프라인/모듈에 순차적으로 전달
        마지막 단계의 모든 결과 이벤트를 반환
        """
        if not self.active:
            return []
        all_results: List["Event"] = []
        for pipeline in self.pipelines:
            if pipeline.can_handle(event):
                results = pipeline.process(event)
                all_results.extend(results or [])
        return all_results

class Pipeline:
    """이벤트 흐름 정의: 트리거 → 모듈 체인"""

    def __init__(self, name: str, http_client: Optional["EventBusHTTPClient"] = None):
        self.name = name
        self.steps: List[Tuple[EventMatcher, "Module"]] = []
        self.trigger_event: str = ""  # 첫 단계 트리거 이벤트 타입
        self.active = True
        self.http_client = http_client  # HTTP 클라이언트 (모듈이 이벤트를 HTTP로 발행할 수 있도록)

    def add_step(self, matcher: EventMatcher, module: "Module"):
        self.steps.append((matcher, module))

    def can_handle(self, event: "Event") -> bool:
        if not self.steps:
            return False
        matcher, _ = self.steps[0]
        return matcher.matches(event)

    def process(self, event: "Event") -> List["Event"]:
        """파이프라인 실행: 단계별로 이벤트 전달, 마지막 모듈이 뱉은 이벤트 반환"""
        if not self.active:
            return []
        current_events: List["Event"] = [event]
        for matcher, module in self.steps:
            next_events: List["Event"] = []
            for evt in current_events:
                if matcher.matches(evt):
                    enriched_event = evt
                    if hasattr(module, '_step_def') and hasattr(module, '_pipeline_def') and hasattr(module, '_adapter'):
                        enriched_event = module._adapter._enrich_event_with_step_args(evt, module._step_def, module._pipeline_def)

                    if self.http_client and not hasattr(module, '_http_client'):
                        module._http_client = self.http_client

                    result = module.process(enriched_event)

                    if self.http_client and result:
                        for new_event in result:
                            try:
                                self.http_client.publish(new_event)
                            except Exception as e:
                                print(f"❌ 서비스에서 이벤트 발행 실패: {e}")

                    next_events.extend(result or [])
            current_events = next_events
        return current_events
