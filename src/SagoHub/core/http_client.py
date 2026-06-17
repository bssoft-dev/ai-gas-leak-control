"""
HTTP 클라이언트: 모듈이 SagoHub와 HTTP로 통신
"""
import json
from typing import Any, Dict, List, Optional
import requests
from .event import Event


class EventBusHTTPClient:
    """SagoHub HTTP 클라이언트"""
    
    def __init__(self, base_url: Optional[str] = None):
        self.base_url = (base_url or "http://localhost:8000").rstrip("/")
        self.session = requests.Session()
    
    def publish(self, event: Event) -> List[Event]:
        """
        이벤트 발행
        Returns: 새로 생성된 이벤트 목록
        """
        url = f"{self.base_url}/publish"
        print(f"[{event.source_module}] PUBLISH EVENT TO EVENT BUS URL: {url} \n")
        print(f"[{event.source_module}] PUBLISH EVENT TO EVENT BUS EVENT: {event} \n")
        response = self.session.post(
            url,
            json=event.to_dict(),
            headers={"Content-Type": "application/json"}
        )
        response.raise_for_status()
        result = response.json()
        # 새로 생성된 이벤트 목록 반환
        new_events = []
        if "new_events" in result:
            for evt_dict in result["new_events"]:
                new_events.append(Event.from_dict(evt_dict))
        return new_events
    
    def register_module(self, module_info: Dict[str, Any]) -> Dict[str, Any]:
        """모듈 등록"""
        url = f"{self.base_url}/modules"
        response = self.session.post(url, json=module_info)
        response.raise_for_status()
        return response.json()
    
    def get_module(self, module_id: str) -> Dict[str, Any]:
        """모듈 정보 조회"""
        url = f"{self.base_url}/modules/{module_id}"
        response = self.session.get(url)
        response.raise_for_status()
        return response.json()
    
    def list_modules(self) -> List[Dict[str, Any]]:
        """모듈 목록 조회"""
        url = f"{self.base_url}/modules"
        response = self.session.get(url)
        response.raise_for_status()
        return response.json()
    
    def update_module(self, module_id: str, module_info: Dict[str, Any]) -> Dict[str, Any]:
        """모듈 정보 수정"""
        url = f"{self.base_url}/modules/{module_id}"
        response = self.session.put(url, json=module_info)
        response.raise_for_status()
        return response.json()
    
    def delete_module(self, module_id: str) -> bool:
        """모듈 삭제"""
        url = f"{self.base_url}/modules/{module_id}"
        response = self.session.delete(url)
        response.raise_for_status()
        return response.status_code == 200
    
    def register_service(self, service_info: Dict[str, Any]) -> Dict[str, Any]:
        """파이프라인 등록"""
        url = f"{self.base_url}/services"
        response = self.session.post(url, json=service_info)
        response.raise_for_status()
        return response.json()
    
    def get_service(self, service_id: str) -> Dict[str, Any]:
        """서비스 정보 조회"""
        url = f"{self.base_url}/services/{service_id}"
        response = self.session.get(url)
        response.raise_for_status()
        return response.json()
    
    def list_services(self) -> List[Dict[str, Any]]:
        """서비스 목록 조회"""
        url = f"{self.base_url}/services"
        response = self.session.get(url)
        response.raise_for_status()
        return response.json()
    
    def update_service(self, service_id: str, service_info: Dict[str, Any]) -> Dict[str, Any]:
        """서비스 정보 수정"""
        url = f"{self.base_url}/services/{service_id}"
        response = self.session.put(url, json=service_info)
        response.raise_for_status()
        return response.json()
    
    def delete_service(self, service_id: str) -> bool:
        """서비스 삭제"""
        url = f"{self.base_url}/services/{service_id}"
        response = self.session.delete(url)
        response.raise_for_status()
        return response.status_code == 200
