"""
M_FareCalculator: 배송비 계산 모듈 (운송수단·인부 자동 판별)
- FARE_CALCULATE: 가로/세로/높이·무게·거리·시간 등으로 예상 배송비 계산
- 운송수단: 무게<=20kg & 부피<=0.1m³ → 오토바이, 그 외 차량
- 추가 인부: 무게>=50kg 또는 부피>=0.5m³ → +20,000원
- 화물 요금: 구간별 고정 할증제 (선형 점수 방식 폐지)
- item_list 지원: 다중 품목 수량(qty) × 무게·부피 누적 합산
"""
from __future__ import annotations

from typing import Any, Dict, List

from SagoHub.core.event import Event
from SagoHub.core.module import Module

# 크기 미지정 시 부피 추정 (m³): small/medium/large
VOLUME_BY_SIZE = {"small": 0.03, "medium": 0.06, "large": 0.15}

# 기본 요금 상수 (config에서 덮어쓸 수 있음)
DEFAULT_MOTORCYCLE_BASE = 5000
DEFAULT_MOTORCYCLE_PER_KM = 900
DEFAULT_MOTORCYCLE_PER_MIN = 50
DEFAULT_VEHICLE_BASE = 15000
DEFAULT_VEHICLE_PER_KM = 1800
DEFAULT_VEHICLE_PER_MIN = 80
DEFAULT_WORKER_FEE = 20000
DEFAULT_MIN_TOTAL = 7000
DEFAULT_FLOOR_FEE = 3000
DEFAULT_URGENT_FEE = 5000

# 자동 판별 기준
MOTORCYCLE_MAX_WEIGHT_KG = 20
MOTORCYCLE_MAX_VOLUME_M3 = 0.1
WORKER_MIN_WEIGHT_KG = 50
WORKER_MIN_VOLUME_M3 = 0.5


class FareCalculatorModule(Module):
    """운송수단·인부 자동 판별 + 요금 계산 (다중 품목 수량 반영 및 화물 요금 현실화)"""

    name = "M_FareCalculator"
    description = "배송비 계산 (오토바이/차량·추가인부 자동 결정, 거리·시간·화물·층·긴급 반영)"
    capabilities = ["FARE_CALCULATE"]

    def can_handle(self, event: Event) -> float:
        if event.type == "FARE_CALCULATE":
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "FARE_CALCULATE":
            return []

        p = event.payload or {}
        distance_km = float(p.get("distance_km") or 0)
        duration_sec = p.get("duration_sec")
        duration_min = (int(duration_sec) / 60) if duration_sec is not None else 0

        # 기본값 세팅 (item_list가 없을 때를 대비)
        weight_kg = float(p.get("item_weight_kg") or p.get("weight_kg") or 0)
        item_size = p.get("item_size") or "medium"
        volume_m3 = p.get("volume_m3")

        # ── [수정] item_list 처리: 무게와 부피를 수량(qty)에 맞게 누적 합산 ──
        item_list = p.get("item_list")
        item_list_summary: list = []

        if item_list and isinstance(item_list, list) and len(item_list) > 0:
            size_rank = {"small": 1, "medium": 2, "large": 3}
            total_weight = 0.0
            total_volume = 0.0  # 부피 누적을 위한 변수 추가
            max_size = ""

            for it in item_list:
                qty = max(1, int(it.get("qty") or 1))
                w = float(it.get("weight_kg") or 0)
                sz = str(it.get("size") or "medium").lower()
                if sz not in size_rank:
                    sz = "medium"

                # 단품 부피 계산
                single_volume = VOLUME_BY_SIZE.get(sz, 0.06)

                # 수량을 반영하여 총합 누적
                total_weight += w * qty
                total_volume += single_volume * qty  # 각 품목 개수만큼 부피 누적

                if not max_size or size_rank.get(sz, 0) > size_rank.get(max_size, 0):
                    max_size = sz

                item_list_summary.append({
                    "name": str(it.get("name") or ""),
                    "size": sz,
                    "weight_kg": w,
                    "qty": qty,
                    "subtotal_weight_kg": round(w * qty, 2),
                    "subtotal_volume_m3": round(single_volume * qty, 4),
                })

            weight_kg = total_weight
            volume_m3 = total_volume
            if max_size:
                item_size = max_size

        # 단일 품목 입력 시 가로/세로/높이(m) 부피 계산 우선 처리
        w_m = p.get("width_m")
        h_m = p.get("height_m")
        d_m = p.get("depth_m")
        if w_m is not None and h_m is not None and d_m is not None:
            try:
                volume_m3 = float(w_m) * float(h_m) * float(d_m)
            except (TypeError, ValueError):
                pass
        elif volume_m3 is None:
            volume_m3 = VOLUME_BY_SIZE.get(item_size, 0.06)
        else:
            volume_m3 = float(volume_m3)

        floor_count = int(p.get("floor_count") or 0)
        has_elevator = bool(p.get("has_elevator", True))
        is_urgent = bool(p.get("is_urgent", False))
        recipient_helps = bool(p.get("recipient_helps", False))

        # config 오버라이드 (payload로 전달된 값 사용)
        motorcycle_base = int(p.get("motorcycle_base") or DEFAULT_MOTORCYCLE_BASE)
        motorcycle_per_km = int(p.get("motorcycle_per_km") or DEFAULT_MOTORCYCLE_PER_KM)
        motorcycle_per_min = int(p.get("motorcycle_per_min") or DEFAULT_MOTORCYCLE_PER_MIN)
        vehicle_base = int(p.get("vehicle_base") or DEFAULT_VEHICLE_BASE)
        vehicle_per_km = int(p.get("vehicle_per_km") or DEFAULT_VEHICLE_PER_KM)
        vehicle_per_min = int(p.get("vehicle_per_min") or DEFAULT_VEHICLE_PER_MIN)
        worker_fee = int(p.get("worker_fee") or DEFAULT_WORKER_FEE)
        min_total = int(p.get("min_total") or DEFAULT_MIN_TOTAL)
        floor_fee = int(p.get("floor_fee") or DEFAULT_FLOOR_FEE)
        urgent_fee = int(p.get("urgent_fee") or DEFAULT_URGENT_FEE)

        # 1) 운송수단 자동 결정
        if weight_kg <= MOTORCYCLE_MAX_WEIGHT_KG and volume_m3 <= MOTORCYCLE_MAX_VOLUME_M3:
            vehicle_type = "motorcycle"
            vehicle_base_fee = motorcycle_base
            per_km = motorcycle_per_km
            per_min = motorcycle_per_min
        else:
            vehicle_type = "vehicle"
            vehicle_base_fee = vehicle_base
            per_km = vehicle_per_km
            per_min = vehicle_per_min

        distance_fee = int(distance_km * per_km)
        time_fee = int(duration_min * per_min)

        # 2) 추가 인부 자동 투입 (받는사람 직접 도움 시 0원)
        if recipient_helps:
            worker_fee_amount = 0
        elif weight_kg >= WORKER_MIN_WEIGHT_KG or volume_m3 >= WORKER_MIN_VOLUME_M3:
            worker_fee_amount = worker_fee
        else:
            worker_fee_amount = 0

        # 3) [수정] 화물 요금 산정: 구간별 고정 할증 제도
        #    무게 및 부피 중 더 높은 구간 기준 적용
        if weight_kg > 100 or volume_m3 > 0.8:
            cargo_fee = 25000   # 초대형 / 초중량 화물
        elif weight_kg > 50 or volume_m3 > 0.4:
            cargo_fee = 12000   # 대형 중량 화물
        elif weight_kg > 20 or volume_m3 > 0.1:
            cargo_fee = 5000    # 일반 차량 화물 (오토바이 규격 초과)
        else:
            cargo_fee = 0       # 소형 일반 화물 (면제)

        # 4) 층당 요금 (엘리베이터 없을 때만)
        if not has_elevator and floor_count > 0:
            floor_fee_amount = floor_count * floor_fee
        else:
            floor_fee_amount = 0

        # 5) 긴급 요금
        urgent_fee_amount = urgent_fee if is_urgent else 0

        total = (
            vehicle_base_fee
            + distance_fee
            + time_fee
            + cargo_fee
            + floor_fee_amount
            + urgent_fee_amount
            + worker_fee_amount
        )
        if total < min_total:
            total = min_total

        breakdown: Dict[str, Any] = {
            "vehicle_type": vehicle_type,
            "vehicle_base": vehicle_base_fee,
            "distance_km": round(distance_km, 2),
            "distance_fee": distance_fee,
            "duration_min": round(duration_min, 1),
            "time_fee": time_fee,
            "cargo_fee": cargo_fee,
            "floor_count": floor_count,
            "floor_fee": floor_fee_amount,
            "urgent_fee": urgent_fee_amount,
            "worker_fee": worker_fee_amount,
            "total_fare": total,
            "weight_kg": round(weight_kg, 2),
            "volume_m3": round(volume_m3, 4),
            "item_size": item_size,
            "item_count": sum(it["qty"] for it in item_list_summary) if item_list_summary else None,
            "item_list": item_list_summary if item_list_summary else None,
            "min_total_applied": total == min_total and (
                total - urgent_fee_amount - worker_fee_amount
                - floor_fee_amount - cargo_fee - time_fee
                - distance_fee - vehicle_base_fee
            ) < min_total,
            # 기존 호환성 유지용 (필요 시 제거 가능)
            "cargo_score": round(weight_kg * 0.6 + volume_m3 * 400, 1),
        }

        return [
            Event(
                type="FARE_CALCULATED",
                payload={
                    "estimated_fare": total,
                    "breakdown": breakdown,
                },
                source_module=self.name,
            )
        ]
