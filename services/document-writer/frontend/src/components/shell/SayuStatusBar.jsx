import React from 'react'

/**
 * 앱 상단: 서비스 식별 · 볼트 문맥 · 인덱스 지표
 */
export default function SayuStatusBar({ serviceName, vaultPath, indexState, statusLabel }) {
  return (
    <header className="sayu-status-bar sayu-topbar" role="banner">
      <div className="sayu-topbar__brand" aria-label="서비스">
        <span
          className={indexState.status === 'indexing' ? 'sayu-status-dot pulse' : 'sayu-status-dot'}
          title={statusLabel}
        />
        <span className="sayu-topbar__title">{serviceName || 'Sa-Yu'}</span>
      </div>
      <div className="sayu-topbar__context" title={vaultPath || '볼트'}>
        <span className="sayu-topbar__label">볼트</span>
        <span className="sayu-topbar__path">{vaultPath || '경로를 불러오는 중…'}</span>
      </div>
      <div className="sayu-topbar__stats" aria-live="polite">
        {indexState.file_count != null && <span>파일 {indexState.file_count}</span>}
        {indexState.chunk_count != null && <span>· 청크 {indexState.chunk_count}</span>}
        {indexState.status === 'indexing' && <span className="sayu-topbar__badge">인덱싱</span>}
        {indexState.status === 'error' && <span className="sayu-topbar__badge sayu-topbar__badge--warn">인덱스</span>}
      </div>
    </header>
  )
}
