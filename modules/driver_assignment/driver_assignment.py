"""
M_DriverAssignment: 배송원 배정 처리 모듈
- DRIVER_ASSIGN: 배송원 배정 요청 처리
- 주문 상태 업데이트 (ORDER_UPDATE 이벤트 발행)
- 알림 이벤트 발행 (E_UserApproved 등)
재활용 가능한 배송원 배정 시스템
"""
from __future__ import annotations

from typing import Any, Dict, List

from SagoHub.core.event import Event
from SagoHub.core.module import Module


class DriverAssignmentModule(Module):
    """배송원 배정 처리 모듈 (재활용 가능)"""

    name = "M_DriverAssignment"
    description = "배송원 배정 처리 모듈 (주문 상태 업데이트 및 알림 발행)"
    capabilities = ["DRIVER_ASSIGN"]

    def can_handle(self, event: Event) -> float:
        if event.type == "DRIVER_ASSIGN":
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "DRIVER_ASSIGN":
            return []
        
        p = event.payload or {}
        order_id = p.get("order_id", "")
        driver_id = p.get("driver_id", "")
        driver_info = p.get("driver_info", {})  # 계좌 정보 등 추가 정보
        
        if not order_id or not driver_id:
            return []

        result = []

        # 1. 주문 상태 업데이트 (ORDER_UPDATE 이벤트 발행)
        result.append(
            Event(
                type="ORDER_UPDATE",
                payload={
                    "order_id": order_id,
                    "status": "assigned",
                    "driver_id": driver_id,
                    **driver_info,  # driver_account_msg 등
                },
                source_module=self.name,
            )
        )

        # 2. 배송원 배정 완료 이벤트 발행 (서비스별 커스텀 이벤트)
        custom_event_type = p.get("custom_event_type", "DRIVER_ASSIGNED")
        result.append(
            Event(
                type=custom_event_type,
                payload={
                    "order_id": order_id,
                    "driver_id": driver_id,
                    **driver_info,
                },
                source_module=self.name,
            )
        )

        # 3. 알림 이벤트 발행 (기존 mailer 모듈 활용)
        notification = p.get("notification")
        if notification:
            # notification: { to, subject, body }
            result.append(
                Event(
                    type="E_UserApproved",
                    payload={
                        "to": notification.get("to", ""),
                        "subject": notification.get("subject", ""),
                        "body": notification.get("body", ""),
                        "path": "",
                        "content": "",
                    },
                    source_module=self.name,
                )
            )

        return result
