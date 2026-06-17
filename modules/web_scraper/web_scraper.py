"""
M_WebScraper: 웹 크롤링 모듈
- WEB_SCRAPE: URL에서 물품 정보 및 이미지 추출 (당근마켓, 중고나라 등)
재활용 가능한 웹 크롤링 시스템
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    requests = None
    BeautifulSoup = None

from SagoHub.core.event import Event
from SagoHub.core.module import Module


class WebScraperModule(Module):
    """범용 웹 크롤링 모듈 (당근마켓, 중고나라 등)"""

    name = "M_WebScraper"
    description = "웹 크롤링 모듈 (당근마켓, 중고나라 URL에서 물품 정보 추출)"
    capabilities = ["WEB_SCRAPE"]

    def can_handle(self, event: Event) -> float:
        if event.type == "WEB_SCRAPE":
            return 1.0
        return 0.0

    def process(self, event: Event) -> List[Event]:
        if event.type != "WEB_SCRAPE":
            return []
        
        if not requests or not BeautifulSoup:
            return [
                Event(
                    type="WEB_SCRAPE_ERROR",
                    payload={"error": "requests or BeautifulSoup not available"},
                    source_module=self.name,
                )
            ]
        
        p = event.payload or {}
        url = p.get("url", "").strip()
        if not url:
            return []

        try:
            # User-Agent 설정
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
            response = requests.get(url, headers=headers, timeout=10)
            if response.status_code != 200:
                return [
                    Event(
                        type="WEB_SCRAPE_ERROR",
                        payload={"url": url, "error": f"HTTP {response.status_code}"},
                        source_module=self.name,
                    )
                ]

            html = response.text
            soup = BeautifulSoup(html, "html.parser")

            # 당근마켓 또는 중고나라 URL 감지
            if "daangn.com" in url or "karrotmarket.com" in url:
                result = self._scrape_daangn(soup, url)
            elif "joongnara.com" in url or "joonggo" in url:
                result = self._scrape_joongnara(soup, url)
            else:
                # 일반적인 크롤링 시도
                result = self._scrape_generic(soup, url)

            return [
                Event(
                    type="WEB_SCRAPE_RESULT",
                    payload={"url": url, **result},
                    source_module=self.name,
                )
            ]
        except Exception as e:
            return [
                Event(
                    type="WEB_SCRAPE_ERROR",
                    payload={"url": url, "error": str(e)},
                    source_module=self.name,
                )
            ]

    def _scrape_daangn(self, soup: Any, url: str) -> Dict[str, Any]:
        """당근마켓 크롤링"""
        result = {
            "item_title": "",
            "item_price": "",
            "item_description": "",
            "item_images": [],
            "item_location": "",
        }

        # 제목 추출
        title_elem = soup.select_one("h1.article-title, .article-title, h1")
        if title_elem:
            result["item_title"] = title_elem.get_text(strip=True)

        # 가격 추출
        price_elem = soup.select_one(".article-price, .price, [class*='price']")
        if price_elem:
            price_text = price_elem.get_text(strip=True)
            result["item_price"] = re.sub(r"[^\d]", "", price_text)

        # 설명 추출
        desc_elem = soup.select_one(".article-detail, .article-content, [class*='content']")
        if desc_elem:
            result["item_description"] = desc_elem.get_text(strip=True)[:500]

        # 이미지 추출
        img_elems = soup.select("img[src], img[data-src]")
        for img in img_elems[:5]:  # 최대 5개
            src = img.get("src") or img.get("data-src", "")
            if src and ("http" in src or src.startswith("//")):
                if src.startswith("//"):
                    src = "https:" + src
                result["item_images"].append(src)

        # 위치 추출
        location_elem = soup.select_one(".article-location, [class*='location']")
        if location_elem:
            result["item_location"] = location_elem.get_text(strip=True)

        return result

    def _scrape_joongnara(self, soup: Any, url: str) -> Dict[str, Any]:
        """중고나라 크롤링"""
        result = {
            "item_title": "",
            "item_price": "",
            "item_description": "",
            "item_images": [],
            "item_location": "",
        }

        # 제목 추출
        title_elem = soup.select_one("h1, .title, [class*='title']")
        if title_elem:
            result["item_title"] = title_elem.get_text(strip=True)

        # 가격 추출
        price_elem = soup.select_one(".price, [class*='price']")
        if price_elem:
            price_text = price_elem.get_text(strip=True)
            result["item_price"] = re.sub(r"[^\d]", "", price_text)

        # 설명 추출
        desc_elem = soup.select_one(".content, .description, [class*='content']")
        if desc_elem:
            result["item_description"] = desc_elem.get_text(strip=True)[:500]

        # 이미지 추출
        img_elems = soup.select("img[src], img[data-src]")
        for img in img_elems[:5]:
            src = img.get("src") or img.get("data-src", "")
            if src and ("http" in src or src.startswith("//")):
                if src.startswith("//"):
                    src = "https:" + src
                result["item_images"].append(src)

        return result

    def _scrape_generic(self, soup: Any, url: str) -> Dict[str, Any]:
        """일반적인 크롤링"""
        result = {
            "item_title": "",
            "item_price": "",
            "item_description": "",
            "item_images": [],
            "item_location": "",
        }

        # 제목 추출 (og:title 또는 h1)
        title_elem = soup.select_one('meta[property="og:title"]')
        if title_elem:
            result["item_title"] = title_elem.get("content", "")
        else:
            h1 = soup.select_one("h1")
            if h1:
                result["item_title"] = h1.get_text(strip=True)

        # 가격 추출 (og:price 또는 일반 가격 요소)
        price_elem = soup.select_one('meta[property="product:price:amount"]')
        if price_elem:
            result["item_price"] = price_elem.get("content", "")

        # 설명 추출 (og:description)
        desc_elem = soup.select_one('meta[property="og:description"]')
        if desc_elem:
            result["item_description"] = desc_elem.get("content", "")[:500]

        # 이미지 추출 (og:image 또는 일반 이미지)
        img_elem = soup.select_one('meta[property="og:image"]')
        if img_elem:
            img_url = img_elem.get("content", "")
            if img_url:
                result["item_images"].append(img_url)

        return result
