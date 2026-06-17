"""
M_AlttulFare: 알뜰배송 견적 모듈
- 1:1 즉시 배송 대비 묶음 배송으로 저렴한 견적 제공 (기본 약 60% 수준)
- FARE_CALCULATE 수신 → fare_calculator로 1:1 기준액 산출 후 할인 적용 → FARE_CALCULATED 발행
- 당배 핵심 가치: 알뜰배송(중고거래·묶음 배송·저렴한 단가)
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List

# 프로젝트 루트를 path에 추가 (모듈 로더는 modules/ 하위만 검색하므로)
_project_root = Path(__file__).resolve().parent.parent.parent
if str(_project_root) not in sys.path:
    sys.path.insert(0, str(_project_root))

from SagoHub.core.event import Event
from SagoHub.core.module import Module

# 기존 fare_calculator를 내부 사용 (코어 수정 없음)
from modules.fare_calculator.fare_calculator import FareCalculatorModule

# 알뜰 할인율 (1:1 대비). 0.6 = 약 40% 절감
DEFAULT_DISCOUNT_RATE = 0.6
# 알뜰 최소 견적 (원). 0이면 할인 후 금액 그대로
DEFAULT_MIN_ALTTUL = 0


class AlttulFareModule(Module):
    """알뜰배송 견적: 1:1 기준 요금에 할인을 적용해 묶음 배송 가격 제공"""

    name = "M_AlttulFare"
    description = "알뜰배송 견적 (1:1 대비 약 40% 절감, 묶음 배송)"
    capabilities = ["FARE_CALCULATE"]

    def __init__(self, discount_rate: float = 0.0, min_alttul: int = -1):
        super().__init__()
        self.discount_rate = discount_rate if discount_rate > 0 else DEFAULT_DISCOUNT_RATE
        self.min_alttul = min_alttul if min_alttul >= 0 else DEFAULT_MIN_ALTTUL
        self._fare_calc = FareCalculatorModule()

    def can_handle(self, event: Event) -> float:
        if event.type == "FARE_CALCULATE":
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "FARE_CALCULATE":
            return []

        # 1) 1:1 기준 요금 산출 (기존 fare_calculator 로직)
        one_to_one_events = self._fare_calc.process(event)
        if not one_to_one_events or one_to_one_events[0].type != "FARE_CALCULATED":
            return one_to_one_events or []

        raw_payload = event.payload or {}
        _ex = raw_payload.get("express_1to1")
        express_1to1 = _ex is True or str(_ex).strip().lower() in ("true", "1", "yes")

        payload = one_to_one_events[0].payload or {}
        original_fare = int(payload.get("estimated_fare") or 0)
        breakdown: Dict[str, Any] = dict(payload.get("breakdown") or {})

        # 신속 배송(1:1)만 선택 시 할인 없이 1:1 요금 그대로
        if express_1to1:
            breakdown["original_1to1_fare"] = original_fare
            breakdown["discount_rate"] = 1.0
            breakdown["alttul_note"] = "신속 배송 (1:1 즉시 배송 기준 요금)"
            breakdown["total_fare"] = original_fare
            return [
                Event(
                    type="FARE_CALCULATED",
                    payload={
                        "estimated_fare": original_fare,
                        "breakdown": breakdown,
                        "original_1to1_fare": original_fare,
                        "alttul_note": breakdown["alttul_note"],
                    },
                    source_module=self.name,
                )
            ]

        # 2) 알뜰 할인 적용
        discounted = int(original_fare * self.discount_rate)
        if self.min_alttul > 0 and discounted < self.min_alttul:
            discounted = self.min_alttul
        savings_pct = int((1 - self.discount_rate) * 100)

        breakdown["original_1to1_fare"] = original_fare
        breakdown["discount_rate"] = self.discount_rate
        breakdown["alttul_note"] = f"알뜰배송 (묶음 배송, 1:1 대비 약 {savings_pct}% 절감)"
        breakdown["total_fare"] = discounted

        return [
            Event(
                type="FARE_CALCULATED",
                payload={
                    "estimated_fare": discounted,
                    "breakdown": breakdown,
                    "original_1to1_fare": original_fare,
                    "alttul_note": breakdown["alttul_note"],
                },
                source_module=self.name,
            )
        ]
