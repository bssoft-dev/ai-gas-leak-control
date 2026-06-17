"""
이벤트 시스템: 모든 일은 이벤트로
Event = 표준화된 메시지(JSON Payload)
EventBus = 이벤트 흐름 관리
"""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, TYPE_CHECKING

if TYPE_CHECKING:
    from .module import Module


@dataclass
class Event:
    """모든 일은 이벤트로"""

    type: str  # "E_FileCreated", "E_DraftReady", "E_UserApproved" 등
    payload: Dict[str, Any]
    timestamp: datetime = field(default_factory=datetime.now)
    source_module: str = ""
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """직렬화용 딕셔너리 (service_id는 metadata·payload에서 유도해 최상위에 포함)"""
        sid = ""
        if isinstance(self.metadata, dict):
            sid = self.metadata.get("service_id") or ""
        if not sid and isinstance(self.payload, dict):
            sid = self.payload.get("service_id") or ""
        tmods: List[str] = []
        if isinstance(self.metadata, dict):
            tm = self.metadata.get("target_modules")
            if isinstance(tm, list):
                tmods = [str(x) for x in tm]
        return {
            "event_id": self.event_id,
            "type": self.type,
            "payload": self.payload,
            "timestamp": self.timestamp.isoformat(),
            "source_module": self.source_module,
            "metadata": self.metadata,
            "service_id": sid,
            "target_modules": tmods,
        }

    def to_json(self) -> str:
        """JSON 문자열로 직렬화"""
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Event":
        """딕셔너리에서 복원 (최상위 service_id는 metadata.service_id로 병합)"""
        ts = d.get("timestamp")
        if isinstance(ts, str):
            ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        metadata = dict(d.get("metadata") or {})
        sid = d.get("service_id")
        if sid is not None and str(sid).strip() != "" and "service_id" not in metadata:
            metadata["service_id"] = str(sid).strip()
        return cls(
            type=d["type"],
            payload=d.get("payload", {}),
            timestamp=ts or datetime.now(),
            source_module=d.get("source_module", ""),
            event_id=d.get("event_id", str(uuid.uuid4())),
            metadata=metadata,
        )


class EventBus:
    """이벤트 흐름 관리"""

    def __init__(self):
        self.subscribers: Dict[str, List[Any]] = {}  # event_type -> [Module or Pipeline]
        self.event_log: List[Event] = []

    def publish(self, event: Event, processor: Any = None) -> List[Event]:
        """
        이벤트 발행.
        processor가 주어지면 해당 processor만 호출하고,
        없으면 해당 type에 구독한 모든 모듈/파이프라인에 전달.
        
        Returns: 새로 생성된 이벤트 목록
        """
        print(f"[Event] PUBLISH: {event}")
        print(f"[Event] PROCESSOR: {processor}")
        self.event_log.append(event)

        targets = self.subscribers.get(event.type, [])
        if processor is not None:
            targets = [processor]

        all_new_events: List[Event] = []
        
        print(f"[Event] TARGETS: {targets}")
        print(f"[Event] PROCESSOR: {processor}")
        for target in targets:
            try:
                if hasattr(target, "process"):
                    new_events = target.process(event)
                elif hasattr(target, "execute"):
                    new_events = target.execute(event)
                else:
                    continue
                
                for new_event in new_events or []:
                    if isinstance(new_event, Event):
                        all_new_events.append(new_event)
                        # 재귀적으로 발행
                        recursive_events = self.publish(new_event)
                        all_new_events.extend(recursive_events)
            except Exception as e:
                error_event = Event(
                    type="MODULE_ERROR",
                    payload={
                        "module": getattr(target, "__class__", type(target)).__name__,
                        "error": str(e),
                        "original_event": event.to_dict(),
                    },
                    source_module="EventBus",
                )
                all_new_events.append(error_event)
                recursive_events = self.publish(error_event)
                all_new_events.extend(recursive_events)
        
        return all_new_events

    def subscribe(self, event_type: str, handler: Any):
        """이벤트 타입에 핸들러(모듈 또는 파이프라인) 등록"""
        print(f"이벤트 타입에 핸들러(모듈 또는 파이프라인) 등록: {event_type}\n")
        print(f"EVENT_TYPE: {event_type}\n")
        print(f"HANDLER: \n")
        print(handler)
        print(f"SUBSCRIBERS: \n")
        for key, value in self.subscribers.items():
            print(f"KEY: {key}")
            print(f"VALUE: {value}")
        
        if event_type not in self.subscribers:
            self.subscribers[event_type] = []
        self.subscribers[event_type].append(handler)

    def unsubscribe(self, event_type: str, handler: Any):
        """구독 해제"""
        if event_type in self.subscribers:
            try:
                self.subscribers[event_type].remove(handler)
            except ValueError:
                pass
