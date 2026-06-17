import React, { useState, useEffect } from 'react'
import './FileExplorer.css'

function FileExplorer({ 
  initialPath = '.',
  onPathSelect,
  onPatternSelect,
  selectedPattern = '**/*.md'
}) {
  const [currentPath, setCurrentPath] = useState(initialPath)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [pattern, setPattern] = useState(selectedPattern)
  const [showPatternInput, setShowPatternInput] = useState(false)
  const [patternInput, setPatternInput] = useState(selectedPattern)

  // 파일 패턴 프리셋
  const patternPresets = [
    { label: '모든 마크다운', value: '**/*.md' },
    { label: '모든 파일', value: '**/*' },
    { label: '루트 마크다운만', value: '*.md' },
    { label: '하위 폴더 포함', value: '**/*.md' },
    { label: '텍스트 파일', value: '**/*.txt' },
  ]

  useEffect(() => {
    loadDirectory(currentPath)
  }, [currentPath])

  const loadDirectory = async (path) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/files/list?path=${encodeURIComponent(path)}&pattern=${encodeURIComponent(pattern)}`)
      if (!response.ok) {
        throw new Error(`Failed to load directory: ${response.statusText}`)
      }
      const data = await response.json()
      setItems(data.items || [])
    } catch (err) {
      setError(err.message)
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  const handleItemClick = (item) => {
    if (item.is_dir) {
      setCurrentPath(item.path)
      // 디렉토리 선택 시 경로 전달
      if (onPathSelect) {
        onPathSelect(item.path)
      }
    } else {
      // 파일 선택 시 부모 디렉토리 경로 전달
      if (onPathSelect) {
        // 파일의 부모 디렉토리 경로 추출
        const pathParts = item.path.split('/')
        pathParts.pop() // 파일명 제거
        const parentPath = pathParts.join('/') || '.'
        onPathSelect(parentPath)
      }
    }
  }
  
  const handlePathSelectFromInput = (path) => {
    // 경로 입력에서 직접 선택한 경우
    if (onPathSelect) {
      onPathSelect(path)
    }
  }

  const handlePathChange = (e) => {
    setCurrentPath(e.target.value)
  }

  const handlePathSubmit = (e) => {
    e.preventDefault()
    loadDirectory(currentPath)
    handlePathSelectFromInput(currentPath)
  }

  const handleGoUp = () => {
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '.'
    setCurrentPath(parentPath)
  }

  const handlePatternPreset = (presetValue) => {
    setPattern(presetValue)
    setPatternInput(presetValue)
    if (onPatternSelect) {
      onPatternSelect(presetValue)
    }
    loadDirectory(currentPath)
  }

  const handlePatternSubmit = (e) => {
    e.preventDefault()
    setPattern(patternInput)
    if (onPatternSelect) {
      onPatternSelect(patternInput)
    }
    setShowPatternInput(false)
    loadDirectory(currentPath)
  }

  return (
    <div className="file-explorer">
      {/* 경로 입력 및 네비게이션 */}
      <div className="explorer-header">
        <form onSubmit={handlePathSubmit} className="path-form">
          <button 
            type="button" 
            className="btn-icon"
            onClick={handleGoUp}
            disabled={currentPath === '.' || currentPath === '/'}
            title="상위 폴더"
          >
            ↑
          </button>
          <input
            type="text"
            className="path-input"
            value={currentPath}
            onChange={handlePathChange}
            placeholder="경로 입력..."
          />
          <button type="submit" className="btn-icon" title="이동">
            →
          </button>
        </form>
      </div>

      {/* 파일 패턴 선택 */}
      <div className="pattern-section">
        <div className="pattern-presets">
          {patternPresets.map((preset) => (
            <button
              key={preset.value}
              className={`pattern-preset-btn ${pattern === preset.value ? 'active' : ''}`}
              onClick={() => handlePatternPreset(preset.value)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="pattern-input-section">
          {showPatternInput ? (
            <form onSubmit={handlePatternSubmit} className="pattern-form">
              <input
                type="text"
                className="pattern-input"
                value={patternInput}
                onChange={(e) => setPatternInput(e.target.value)}
                placeholder="Glob 패턴 입력 (예: **/*.md)"
                autoFocus
              />
              <button type="submit" className="btn-small">적용</button>
              <button 
                type="button" 
                className="btn-small btn-secondary"
                onClick={() => {
                  setShowPatternInput(false)
                  setPatternInput(pattern)
                }}
              >
                취소
              </button>
            </form>
          ) : (
            <div className="pattern-display">
              <span className="pattern-label">패턴:</span>
              <span className="pattern-value">{pattern}</span>
              <button 
                className="btn-small"
                onClick={() => setShowPatternInput(true)}
              >
                변경
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 파일 목록 */}
      <div className="explorer-content">
        {loading && (
          <div className="explorer-loading">
            <div className="spinner-small"></div>
            <span>로딩 중...</span>
          </div>
        )}
        
        {error && (
          <div className="explorer-error">
            <span>⚠️ {error}</span>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="explorer-empty">
            <span>폴더가 비어있습니다.</span>
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <div className="file-list">
            {items.map((item, index) => (
              <div
                key={`${item.path}-${index}`}
                className={`file-item ${item.is_dir ? 'directory' : 'file'}`}
                onClick={() => handleItemClick(item)}
                title={item.path}
              >
                <span className="file-icon">
                  {item.is_dir ? '📁' : '📄'}
                </span>
                <span className="file-name">{item.name}</span>
                {item.is_file && (
                  <span className="file-size">
                    {(item.size / 1024).toFixed(1)} KB
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 현재 선택된 경로 표시 */}
      <div className="explorer-footer">
        <span className="current-path-label">선택된 경로:</span>
        <span className="current-path-value">{currentPath}</span>
      </div>
    </div>
  )
}

export default FileExplorer
