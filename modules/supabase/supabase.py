"""
M_Supabase: Supabase를 이용한 데이터 저장/조회 모듈
- SUPABASE_INSERT: 테이블에 삽입
- SUPABASE_SELECT: 테이블 조회
- SUPABASE_UPDATE: 테이블 업데이트
- SUPABASE_DELETE: 테이블 삭제
.env의 SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY 사용
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from SagoHub.core.event import Event
from SagoHub.core.module import Module

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_ORDERS_TABLE = os.getenv("SUPABASE_ORDERS_TABLE", "orders")


class SupabaseModule(Module):
    """Supabase 테이블 insert/select/update/delete"""

    name = "M_Supabase"
    description = "Supabase 데이터 저장/조회 (insert, select, update, delete)"
    capabilities = [
        "SUPABASE_INSERT",
        "SUPABASE_SELECT",
        "SUPABASE_UPDATE",
        "SUPABASE_DELETE",
        "DANGBAE_ORDER_CREATED",  # order_manager 주문 생성 시 파이프라인으로 저장
    ]

    def __init__(
        self,
        url: str = "",
        anon_key: str = "",
        service_role_key: str = "",
    ):
        super().__init__()
        self.url = (url or SUPABASE_URL).rstrip("/")
        self.anon_key = anon_key or SUPABASE_ANON_KEY
        self.service_role_key = service_role_key or SUPABASE_SERVICE_ROLE_KEY
        self._client = None
        self._orders_table = os.getenv("SUPABASE_ORDERS_TABLE", SUPABASE_ORDERS_TABLE)

    def _get_client(self):
        if self._client is not None:
            return self._client
        try:
            from supabase import create_client
            key = self.service_role_key or self.anon_key
            if not self.url or not key:
                return None
            self._client = create_client(self.url, key)
            return self._client
        except ImportError:
            return None

    def can_handle(self, event: Event) -> float:
        if event.type in self.capabilities:
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        client = self._get_client()
        if not client:
            return [
                Event(
                    type=f"{event.type}_RESULT",
                    payload={"ok": False, "error": "Supabase client not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)"},
                    source_module=self.name,
                )
            ]
        if event.type == "SUPABASE_INSERT":
            return self._process_insert(client, event)
        if event.type == "SUPABASE_SELECT":
            return self._process_select(client, event)
        if event.type == "SUPABASE_UPDATE":
            return self._process_update(client, event)
        if event.type == "SUPABASE_DELETE":
            return self._process_delete(client, event)
        if event.type == "DANGBAE_ORDER_CREATED":
            return self._process_order_created(client, event)
        return []

    def _process_order_created(self, client, event: Event) -> List[Event]:
        """DANGBAE_ORDER_CREATED: order_manager에서 생성된 주문을 Supabase orders 테이블에 저장"""
        payload = event.payload or {}
        if not payload:
            return [
                Event(
                    type="SUPABASE_ORDER_SAVED",
                    payload={"ok": False, "error": "empty payload"},
                    source_module=self.name,
                )
            ]
        table = self._orders_table
        insert_event = Event(
            type="SUPABASE_INSERT",
            payload={"table": table, "data": payload},
            source_module=self.name,
        )
        result = self._process_insert(client, insert_event)
        if result and result[0].type == "SUPABASE_INSERT_RESULT":
            result[0].type = "SUPABASE_ORDER_SAVED"
        return result or []

    def _process_insert(self, client, event: Event) -> List[Event]:
        p = event.payload or {}
        table = (p.get("table") or "").strip()
        data = p.get("data")
        if not table or data is None:
            return [
                Event(
                    type="SUPABASE_INSERT_RESULT",
                    payload={"ok": False, "error": "table and data required"},
                    source_module=self.name,
                )
            ]
        try:
            if isinstance(data, list):
                r = client.table(table).insert(data).execute()
            else:
                r = client.table(table).insert(data).execute()
            return [
                Event(
                    type="SUPABASE_INSERT_RESULT",
                    payload={"ok": True, "data": r.data},
                    source_module=self.name,
                )
            ]
        except Exception as e:
            return [
                Event(
                    type="SUPABASE_INSERT_RESULT",
                    payload={"ok": False, "error": str(e)},
                    source_module=self.name,
                )
            ]

    def _process_select(self, client, event: Event) -> List[Event]:
        p = event.payload or {}
        table = (p.get("table") or "").strip()
        if not table:
            return [
                Event(
                    type="SUPABASE_SELECT_RESULT",
                    payload={"ok": False, "error": "table required"},
                    source_module=self.name,
                )
            ]
        columns = p.get("columns") or "*"
        limit = p.get("limit")
        order = p.get("order")
        eq_filter = p.get("eq")  # {"column": value}
        try:
            q = client.table(table).select(columns)
            if isinstance(eq_filter, dict):
                for col, val in eq_filter.items():
                    q = q.eq(col, val)
            if order:
                if isinstance(order, str):
                    q = q.order(order)
                elif isinstance(order, dict):
                    q = q.order(order.get("column", "id"), desc=order.get("desc", False))
            if limit is not None:
                q = q.limit(int(limit))
            r = q.execute()
            return [
                Event(
                    type="SUPABASE_SELECT_RESULT",
                    payload={"ok": True, "data": r.data},
                    source_module=self.name,
                )
            ]
        except Exception as e:
            return [
                Event(
                    type="SUPABASE_SELECT_RESULT",
                    payload={"ok": False, "error": str(e)},
                    source_module=self.name,
                )
            ]

    def _process_update(self, client, event: Event) -> List[Event]:
        p = event.payload or {}
        table = (p.get("table") or "").strip()
        data = p.get("data")
        eq_filter = p.get("eq")  # {"column": value}
        if not table or data is None or not isinstance(eq_filter, dict) or not eq_filter:
            return [
                Event(
                    type="SUPABASE_UPDATE_RESULT",
                    payload={"ok": False, "error": "table, data and eq (filter) required"},
                    source_module=self.name,
                )
            ]
        try:
            q = client.table(table).update(data)
            for col, val in eq_filter.items():
                q = q.eq(col, val)
            r = q.execute()
            return [
                Event(
                    type="SUPABASE_UPDATE_RESULT",
                    payload={"ok": True, "data": r.data},
                    source_module=self.name,
                )
            ]
        except Exception as e:
            return [
                Event(
                    type="SUPABASE_UPDATE_RESULT",
                    payload={"ok": False, "error": str(e)},
                    source_module=self.name,
                )
            ]

    def _process_delete(self, client, event: Event) -> List[Event]:
        p = event.payload or {}
        table = (p.get("table") or "").strip()
        eq_filter = p.get("eq")  # {"column": value}
        if not table or not isinstance(eq_filter, dict) or not eq_filter:
            return [
                Event(
                    type="SUPABASE_DELETE_RESULT",
                    payload={"ok": False, "error": "table and eq (filter) required"},
                    source_module=self.name,
                )
            ]
        try:
            q = client.table(table).delete()
            for col, val in eq_filter.items():
                q = q.eq(col, val)
            r = q.execute()
            return [
                Event(
                    type="SUPABASE_DELETE_RESULT",
                    payload={"ok": True, "data": r.data},
                    source_module=self.name,
                )
            ]
        except Exception as e:
            return [
                Event(
                    type="SUPABASE_DELETE_RESULT",
                    payload={"ok": False, "error": str(e)},
                    source_module=self.name,
                )
            ]
