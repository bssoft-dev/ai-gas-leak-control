"""
이벤트 집계기: 여러 모듈의 응답을 수집하고 충돌 해결 전략에 따라 처리
"""
from typing import Dict, List, Any, Optional
from datetime import datetime
from enum import Enum
from .event import Event


class ConflictResolutionStrategy(str, Enum):
    """충돌 해결 전략"""
    INDEPENDENT = "INDEPENDENT"  # 독립: 각 모듈이 서로 다른 영역 처리
    PRIORITY = "PRIORITY"  # 우선순위: 높은 우선순위 모듈 우선
    LATEST = "LATEST"  # 최신: 가장 최근에 도착한 이벤트 우선
    MERGE = "MERGE"  # 합병: 모든 결과를 합침


class EventAggregator:
    """이벤트 집계 및 충돌 해결"""
    
    def __init__(self, strategy: ConflictResolutionStrategy = ConflictResolutionStrategy.INDEPENDENT, 
                 options: Optional[Dict[str, Any]] = None):
        self.strategy = strategy
        self.options = options or {}
        self.pending_events: Dict[str, List[Dict[str, Any]]] = {}  # event_id -> [responses]
        self.priority_map: Dict[str, int] = self.options.get("priority_order", {})
        self.wait_window_ms: int = self.options.get("wait_window_ms", 500)  # 기본 0.5초 대기
    
    def add_response(self, event_id: str, module_id: str, response_event: Event, priority: int = 0):
        """모듈 응답 추가"""
        if event_id not in self.pending_events:
            self.pending_events[event_id] = []
        
        self.pending_events[event_id].append({
            "module_id": module_id,
            "event": response_event,
            "timestamp": datetime.now(),
            "priority": self.priority_map.get(module_id, priority)
        })
    
    def resolve(self, event_id: str) -> Optional[List[Event]]:
        """충돌 해결 및 최종 이벤트 반환"""
        if event_id not in self.pending_events:
            return None
        
        responses = self.pending_events[event_id]
        if not responses:
            return None
        
        if self.strategy == ConflictResolutionStrategy.INDEPENDENT:
            # 독립: 모든 응답 반환 (각 모듈이 다른 영역 처리)
            return [r["event"] for r in responses]
        
        elif self.strategy == ConflictResolutionStrategy.PRIORITY:
            # 우선순위: 가장 높은 우선순위만 반환
            responses.sort(key=lambda x: x["priority"], reverse=True)
            return [responses[0]["event"]]
        
        elif self.strategy == ConflictResolutionStrategy.LATEST:
            # 최신: 가장 최근에 도착한 이벤트 반환
            responses.sort(key=lambda x: x["timestamp"], reverse=True)
            return [responses[0]["event"]]
        
        elif self.strategy == ConflictResolutionStrategy.MERGE:
            # 합병: 모든 결과를 합침
            merged_payload = {}
            merged_metadata = {}
            
            for r in responses:
                merged_payload.update(r["event"].payload)
                merged_metadata.update(r["event"].metadata)
            
            # 첫 번째 이벤트를 기반으로 새 이벤트 생성
            base_event = responses[0]["event"]
            merged_event = Event(
                type=base_event.type,
                payload=merged_payload,
                timestamp=datetime.now(),
                source_module="EventAggregator",
                metadata=merged_metadata
            )
            return [merged_event]
        
        # 기본: 모든 응답 반환
        return [r["event"] for r in responses]
    
    def clear(self, event_id: str):
        """처리 완료된 이벤트 제거"""
        if event_id in self.pending_events:
            del self.pending_events[event_id]
