# Role: PWA & 오프라인 아키텍처 전문가

## Context
나는 웹 프론트엔드 페이지를 PWABuilder를 통해 안드로이드 APK 및 iOS 앱으로 배포하려고 한다. 
단순한 웹 래핑을 넘어, 일렉트론(Electron) 앱처럼 서버가 다운되어도 기기 내 데이터를 기반으로 
핵심 기능을 수행할 수 있는 '오프라인 퍼스트(Offline-First)' 앱을 구축하는 것이 목표다.

## Goals
1. 서비스 워커(Service Worker)를 활용한 지능형 캐싱 전략 수립 (업데이트 지연 문제 해결 포함).
2. IndexedDB를 사용하여 서버 다운 시에도 기기 내 데이터를 표시하는 로직 구현.
3. PWABuilder 호환성을 위한 매니페스트(manifest.json) 및 메타 데이터 최적화.

## Core Technical Requirements

### 1. 서비스 워커 전략 (Update vs Offline)
- **Stale-While-Revalidate 전략**: UI 구성 요소(JS, CSS, HTML)는 일단 캐시에서 즉시 로드하여 실행 속도를 높이되, 백그라운드에서 업데이트를 확인하여 다음 실행 시 반영되도록 한다.
- **Network-First 전략**: 데이터 API 호출 시에는 항상 최신 서버 데이터를 시도하고, 실패(서버 다운) 시에만 캐시나 IndexedDB 데이터를 반환한다.
- **Offline Fallback**: 네트워크 연결이 아예 없을 때 보여줄 전용 '오프라인 기능 모드' UI를 정의한다.

### 2. 데이터 영속성 (Data Persistence)
- 단순 Cache Storage가 아닌 **IndexedDB**를 사용하여 구조화된 데이터를 로컬에 저장하는 로직을 작성하라.
- 서버에서 데이터를 가져올 때마다 로컬 IndexedDB를 동기화(Sync)하는 미들웨어를 제안하라.

### 3. PWABuilder 전용 최적화
- iOS App Store 심사 가이드라인(4.2항)을 통과할 수 있도록, 웹사이트처럼 보이지 않게 하는 네이티브 스타일(Pull-to-refresh 방지, 터치 하이라이트 제거 등) CSS와 설정을 포함하라.
- `manifest.json` 내의 `display: standalone`, `shortcuts`, `screenshots` 설정을 스토어 규격에 맞게 작성하라.

### 4. 앱 아이콘(고정 자산)
- 앱 아이콘 원본은 반드시 첨부 파일을 사용한다:  
  `/home/bssoft/.cursor/projects/home-bssoft-SagoHub-2601/assets/____________CI-a5530646-8ee2-4abe-97fe-560681c4844a.png`
- 위 원본을 기준으로 PWA 아이콘 세트를 생성한다(최소 `192x192`, `512x512`, `maskable 512x512`).
- `manifest.json`의 `icons` 항목은 위 이미지에서 생성한 아이콘 파일들로 연결한다.

## Implementation Task
지금부터 내가 작성한 웹 코드(또는 기술 스택)를 바탕으로, 위 기능들이 통합된 `sw.js` (서비스 워커) 파일과 `db.js` (IndexedDB 관리) 파일의 초안을 작성하고, 기존 웹 앱에 어떻게 주입(Injection)해야 하는지 단계별로 가이드하라.

## PWABuilder
Manifest 설정
