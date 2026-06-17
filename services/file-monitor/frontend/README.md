# File Monitor UI

File Monitor 서비스를 위한 React 기반 프론트엔드 애플리케이션입니다.

## 개발 환경 설정

### 필수 요구사항
- Node.js 18 이상
- npm 또는 yarn

### 설치 및 실행

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 프로덕션 빌드
npm run build

# 빌드 결과물 미리보기
npm run preview
```

## 구조

```
frontend/
├── src/
│   ├── components/
│   │   └── FileMonitorWidget.jsx  # 메인 위젯 컴포넌트
│   ├── App.jsx                     # 앱 진입점
│   ├── App.css
│   ├── main.jsx                    # React 렌더링
│   └── index.css                   # 전역 스타일
├── index.html
├── package.json
├── vite.config.js
└── README.md
```

## API 통신

이 프론트엔드는 UI 서버(`http://localhost:8080`)와 통신합니다:

- `GET /api/service` - 서비스 정보
- `GET /api/interfaces` - 인터페이스 정의 (props 포함)
- `GET /api/config` - 설정 스키마 및 값
- `POST /api/config` - 설정 업데이트
- `POST /api/events/publish` - 이벤트 발행

## 컴포넌트 Props

`FileMonitorWidget` 컴포넌트는 다음 props를 받습니다:

- `target_folder`: 감시할 폴더 경로
- `watch_pattern`: 파일 패턴 (Glob 형식)
- `show_content`: 파일 내용 출력 여부
- `is_logging`: 로그 파일 저장 여부
- `onAction`: 이벤트 핸들러 함수
- `events`: 이벤트 매핑 객체

## 이벤트

- `onSave`: 설정 저장 시 `PATH_SET` 이벤트 발행
- `subscribe`: `FILE_CREATED`, `fs.read.success` 이벤트 구독 (향후 구현)
