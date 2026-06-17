# ThinkingOS Supplement UI

ThinkingOS 보충 정보 자동 생성 서비스를 위한 전용 React UI입니다.

## 기능

- 📚 Obsidian 폴더 설정 및 모니터링 시작/중지
- 📊 실시간 처리 통계 표시
  - 원본 파일 감지
  - 요청사항 추출
  - 보충 파일 생성
  - 질문 답변
  - 반영/삭제 완료
- 🔔 실시간 이벤트 스트림 (SSE)
- 🎨 이벤트 타입별 색상 구분 및 아이콘 표시

## 개발

```bash
npm install
npm run dev
```

## 빌드

```bash
npm run build
```

## 기술 스택

- React 18
- Vite
- Server-Sent Events (SSE) for real-time updates
