"""
M_MapService: 카카오 기반 지도 서비스 모듈
- LOCATION_SEARCH: 키워드/주소로 위치 검색 (카카오 로컬 API)
- ROUTE_CALCULATE: 두 위치 간 거리 계산 (카카오 맵 direction API → 실패 시 하버사인)
- GET_MY_LOCATION: IP 기반 현재 위치 조회
카카오 지도/로컬 API 사용. REST API 키는 KAKAO_REST_API_KEY 환경변수로 설정.
"""
from __future__ import annotations

import math
import os
from typing import Any, Dict, List, Optional

try:
    import requests
except ImportError:
    requests = None

from SagoHub.core.event import Event
from SagoHub.core.module import Module

# 환경변수: 카카오 REST API 키 (개발자 콘솔에서 REST API 키 발급)
# 기본값은 현재 프로젝트에서 사용하는 REST API 키
KAKAO_REST_API_KEY = os.getenv("KAKAO_REST_API_KEY", "618121204194a80240d7461521bbe40b")
KAKAO_API_BASE = "https://dapi.kakao.com"
IP_API_URL = os.getenv("IP_API_URL", "http://ip-api.com/json")


class MapServiceModule(Module):
    """카카오 기반 지도 서비스 모듈 (위치 검색, 경로 거리, 현재 위치)"""

    name = "M_MapService"
    description = "카카오 지도 서비스 모듈 (위치 검색, 거리 계산, 현재 위치 조회)"
    capabilities = ["LOCATION_SEARCH", "ROUTE_CALCULATE", "GET_MY_LOCATION"]

    def __init__(self, kakao_rest_api_key: str = ""):
        super().__init__()
        self.kakao_key = kakao_rest_api_key or KAKAO_REST_API_KEY

    def can_handle(self, event: Event) -> float:
        if event.type in self.capabilities:
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type == "LOCATION_SEARCH":
            return self._process_location_search(event)
        if event.type == "ROUTE_CALCULATE":
            return self._process_route_calculate(event)
        if event.type == "GET_MY_LOCATION":
            return self._process_get_my_location(event)
        return []

    def _kakao_headers(self) -> Dict[str, str]:
        return {"Authorization": f"KakaoAK {self.kakao_key}"}

    def _process_location_search(self, event: Event) -> List[Event]:
        """키워드/주소로 위치 검색 (카카오 로컬 키워드 검색) → LOCATION_SEARCH_RESULT 발행"""
        if not requests:
            print("[MapService] ❌ requests 라이브러리가 없습니다. LOCATION_SEARCH 처리 불가.")
            return []

        p = event.payload or {}
        query = p.get("query", "").strip()
        if not query:
            print("[MapService] ⚠️ 빈 query 로 LOCATION_SEARCH 요청이 들어왔습니다. 무시합니다.")
            return []

        print(f"[MapService] 📍 LOCATION_SEARCH 수신: query='{query}' kakao_key={self.kakao_key[:6]}***")
        try:
            url = f"{KAKAO_API_BASE}/v2/local/search/keyword.json"
            params = {"query": query, "size": 5}
            print(f"[MapService] → Kakao LOCAL 요청: {url} params={params}")
            response = requests.get(
                url, headers=self._kakao_headers(), params=params, timeout=5
            )
            print(f"[MapService] ← Kakao LOCAL 응답: status={response.status_code}")
            if response.status_code != 200:
                body = response.text
                snippet = body[:500] + ("..." if len(body) > 500 else "")
                print(f"[MapService] ❌ LOCATION_SEARCH 실패: status={response.status_code} body={snippet}")
                return [
                    Event(
                        type="LOCATION_SEARCH_ERROR",
                        payload={"query": query, "error": snippet},
                        source_module=self.name,
                    )
                ]

            data = response.json()
            documents = data.get("documents", [])
            print(f"[MapService] ✅ Kakao LOCAL 문서 개수: {len(documents)}")
            results = []
            for doc in documents:
                # 카카오 API: x=경도(lng), y=위도(lat)
                lng = doc.get("x")
                lat = doc.get("y")
                if lng and lat:
                    results.append({
                        "name": doc.get("place_name", ""),
                        "address": doc.get("address_name", "") or doc.get("road_address_name", ""),
                        "road_address": doc.get("road_address_name", ""),
                        "lat": float(lat),
                        "lng": float(lng),
                    })

            print(f"[MapService] ✅ LOCATION_SEARCH 결과 개수: {len(results)}")
            return [
                Event(
                    type="LOCATION_SEARCH_RESULT",
                    payload={"query": query, "results": results},
                    source_module=self.name,
                )
            ]
        except Exception as e:
            import traceback
            print(f"[MapService] ❌ LOCATION_SEARCH 예외 발생: {e}")
            print(traceback.format_exc())
            return [
                Event(
                    type="LOCATION_SEARCH_ERROR",
                    payload={"query": query, "error": str(e)},
                    source_module=self.name,
                )
            ]

    def _process_route_calculate(self, event: Event) -> List[Event]:
        """두 위치 간 거리 계산 (카카오 맵 direction API, 실패 시 하버사인) → ROUTE_CALCULATED 발행"""
        p = event.payload or {}
        origin_lat = p.get("origin_lat")
        origin_lng = p.get("origin_lng")
        dest_lat = p.get("dest_lat")
        dest_lng = p.get("dest_lng")

        if None in (origin_lat, origin_lng, dest_lat, dest_lng):
            return []

        olat, olng = float(origin_lat), float(origin_lng)
        dlat, dlng = float(dest_lat), float(dest_lng)

        distance_km, duration_sec, note, route_path = self._fetch_kakao_direction(
            olat, olng, dlat, dlng
        )
        if distance_km is None:
            distance_km = self._haversine_distance(olat, olng, dlat, dlng)
            duration_sec = None
            note = "직선 거리 (하버사인, API 실패)"
            route_path = None

        route_payload = None
        if route_path and len(route_path) >= 2:
            route_payload = {"path": route_path}

        return [
            Event(
                type="ROUTE_CALCULATED",
                payload={
                    "origin": {"lat": origin_lat, "lng": origin_lng},
                    "dest": {"lat": dest_lat, "lng": dest_lng},
                    "distance_km": round(distance_km, 2),
                    "distance_m": int(distance_km * 1000),
                    "duration_sec": duration_sec,
                    "route": route_payload,
                    "note": note,
                },
                source_module=self.name,
            )
        ]

    def _process_get_my_location(self, event: Event) -> List[Event]:
        """브라우저 GPS(client_lat/lng) 또는 IP 기반 위치 → MY_LOCATION_RESULT (target: origin|dest)"""
        if not requests:
            return []

        p = event.payload or {}
        target = p.get("target") or "origin"
        ip = p.get("ip")
        clat, clng = p.get("client_lat"), p.get("client_lng")

        try:
            # 모바일/브라우저 geolocation으로 넘긴 좌표 우선
            if clat is not None and clng is not None:
                lat_f, lng_f = float(clat), float(clng)
                address = self._reverse_geocode(lat_f, lng_f)
                return [
                    Event(
                        type="MY_LOCATION_RESULT",
                        payload={
                            "lat": lat_f,
                            "lng": lng_f,
                            "address": address or f"{lat_f:.5f}, {lng_f:.5f}",
                            "target": target,
                        },
                        source_module=self.name,
                    )
                ]

            url = IP_API_URL if not ip else f"{IP_API_URL}/{ip}"
            response = requests.get(url, timeout=5)
            if response.status_code != 200:
                return []

            data = response.json()
            lat = data.get("lat")
            lon = data.get("lon")
            city = data.get("city", "")
            region = data.get("regionName", "")
            country = data.get("country", "")

            if lat is None or lon is None:
                return []

            address = self._reverse_geocode(float(lat), float(lon))
            return [
                Event(
                    type="MY_LOCATION_RESULT",
                    payload={
                        "lat": lat,
                        "lng": lon,
                        "address": address or f"{city}, {region}, {country}",
                        "city": city,
                        "region": region,
                        "country": country,
                        "ip": data.get("query", ""),
                        "target": target,
                    },
                    source_module=self.name,
                )
            ]
        except Exception as e:
            return [
                Event(
                    type="MY_LOCATION_ERROR",
                    payload={"error": str(e), "target": target},
                    source_module=self.name,
                )
            ]

    def _reverse_geocode(self, lat: float, lng: float) -> Optional[str]:
        """좌표를 주소로 변환 (카카오 좌표→주소 API)"""
        if not requests or not self.kakao_key:
            return None
        try:
            url = f"{KAKAO_API_BASE}/v2/local/geo/coord2address.json"
            params = {"x": lng, "y": lat, "input_coord": "WGS84"}
            response = requests.get(
                url, headers=self._kakao_headers(), params=params, timeout=5
            )
            if response.status_code != 200:
                return None
            data = response.json()
            documents = data.get("documents", [])
            if documents:
                doc = documents[0]
                addr = doc.get("address")
                if addr:
                    region1 = addr.get("region_1depth_name", "")
                    region2 = addr.get("region_2depth_name", "")
                    region3 = addr.get("region_3depth_name", "")
                    return f"{region1} {region2} {region3}".strip()
                road = doc.get("road_address")
                if road:
                    return road.get("address_name", "")
        except Exception:
            pass
        return None

    @staticmethod
    def _extract_path_from_kakao_direction(data: Dict[str, Any]) -> Optional[List[List[float]]]:
        """카카오 /v2/maps/direction 응답에서 도로 좌표열 추출. vertexes: [lng,lat,lng,lat,...]"""
        routes = data.get("routes") or data.get("route") or []
        if isinstance(routes, dict):
            routes = [routes]
        if not routes:
            return None
        r0 = routes[0] if isinstance(routes[0], dict) else {}
        sections = r0.get("sections") or []
        path: List[List[float]] = []
        def _append_vertexes(vx: Any) -> None:
            if not vx or not isinstance(vx, list):
                return
            for i in range(0, len(vx) - 1, 2):
                try:
                    lng_f = float(vx[i])
                    lat_f = float(vx[i + 1])
                    if path and path[-1][0] == lat_f and path[-1][1] == lng_f:
                        continue
                    path.append([lat_f, lng_f])
                except (ValueError, TypeError, IndexError):
                    continue

        for sec in sections:
            if not isinstance(sec, dict):
                continue
            for road in sec.get("roads") or []:
                if not isinstance(road, dict):
                    continue
                vx = road.get("vertexes") or road.get("vertices")
                _append_vertexes(vx)
            # 일부 응답: section 단위 vertexes
            svx = sec.get("vertexes") or sec.get("vertices")
            _append_vertexes(svx)
        return path if len(path) >= 2 else None

    def _fetch_kakao_direction(
        self, origin_lat: float, origin_lng: float, dest_lat: float, dest_lng: float
    ) -> tuple[Optional[float], Optional[int], str, Optional[List[List[float]]]]:
        """카카오 direction API로 거리·시간·경로 좌표. 실패 시 (None, None, '', None)."""
        if not requests or not self.kakao_key:
            return (None, None, "", None)

        # 1) dapi.kakao.com/v2/maps/direction (start=경도,위도 & goal=경도,위도)
        url = f"{KAKAO_API_BASE}/v2/maps/direction"
        params = {
            "start": f"{origin_lng},{origin_lat}",
            "goal": f"{dest_lng},{dest_lat}",
        }
        try:
            resp = requests.get(
                url, headers=self._kakao_headers(), params=params, timeout=10
            )
            if resp.status_code != 200:
                raise Exception(f"Kakao DIRECTION 응답 실패: status={resp.status_code}")

            data = resp.json()
            # 응답 구조에 따라 파싱 (routes[].summary.distance 등 다양한 형태 대응)
            routes = data.get("routes") or data.get("route") or []
            if isinstance(routes, dict):
                routes = [routes]
            if routes:
                r = routes[0] if isinstance(routes[0], dict) else {}
                summary = r.get("summary") or r
                dist_m = summary.get("distance") or summary.get("distance_m") or summary.get("distanceMeters")
                dur_sec = summary.get("duration") or summary.get("duration_sec") or summary.get("durationSec") or summary.get("durationSeconds")
                if dist_m is not None:
                    dist_km = float(dist_m) / 1000.0
                    dur = int(dur_sec) if dur_sec is not None else None
                    path = self._extract_path_from_kakao_direction(data)
                    return (dist_km, dur, "카카오 맵 경로(도로)", path)
        except Exception as e:
            print(f"[MapService] ❌ Kakao DIRECTION 예외 발생: {e}")
            pass

        # 2) 카카오모빌리티 directions API (동일 키로 시도)
        try:
            navi_url = "https://apis-navi.kakaomobility.com/v1/waypoints/directions"
            payload = {
                "origin": {"x": str(origin_lng), "y": str(origin_lat)},
                "destination": {"x": str(dest_lng), "y": str(dest_lat)},
            }
            r2 = requests.post(
                navi_url, headers=self._kakao_headers(), json=payload, timeout=10
            )
            print(f"[MapService] ← Kakao NAVI 응답: status={r2.status_code}")
            if r2.status_code == 200:
                d2 = r2.json()
                routes = d2.get("routes") or []
                if routes:
                    s = (routes[0].get("summary") or routes[0])
                    dist_m = s.get("distance") or s.get("distance_m")
                    dur_sec = s.get("duration") or s.get("duration_sec")
                    if dist_m is not None:
                        path = self._extract_path_from_kakao_direction(d2)
                        return (
                            float(dist_m) / 1000.0,
                            int(dur_sec) if dur_sec else None,
                            "카카오맵 경로(도로)",
                            path,
                        )
        except Exception:
            pass

        return (None, None, "", None)

    def _haversine_distance(
        self, lat1: float, lon1: float, lat2: float, lon2: float
    ) -> float:
        """하버사인 공식으로 두 좌표 간 직선 거리 (km)"""
        R = 6371
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = (
            math.sin(dlat / 2) ** 2
            + math.cos(math.radians(lat1))
            * math.cos(math.radians(lat2))
            * math.sin(dlon / 2) ** 2
        )
        c = 2 * math.asin(math.sqrt(a))
        return R * c
