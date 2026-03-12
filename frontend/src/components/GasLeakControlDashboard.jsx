import React, { useState, useEffect, useRef } from 'react'
import './GasLeakControlDashboard.css'

const ZONE_STATUS_COLOR = { normal: '#3fb950', warning: '#d29922', critical: '#f85149' }
const SENSOR_UNITS = { pressure: 'MPa', flow: 'L/min', concentration: '%' }

function GasLeakControlDashboard({ onAction, events }) {
  const [state, setState] = useState({ valve_closed: false, zones: [], emergency_at: null, alarm_beacon_on: false, alarm_siren_on: false, mes_equipment_running: true, mes_updated_at: null, mes_work_order_id: null })
  const [sensors, setSensors] = useState([])
  const [timeseries, setTimeseries] = useState({ pressure: [], flow: [] })
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState(null)
  const [activeTab, setActiveTab] = useState('monitor') // 'monitor' | 'drawing'
  const [drawings, setDrawings] = useState([])
  const [selectedDrawingId, setSelectedDrawingId] = useState(() => localStorage.getItem('gl_selected_drawing_id') || null)
  const [drawingDetail, setDrawingDetail] = useState(null) // { drawing, sensors }
  const [sensorForm, setSensorForm] = useState({ label: '', sensor_type: 'pressure' })
  const [pendingSensorPos, setPendingSensorPos] = useState(null) // { x, y } 0-1
  const [uploading, setUploading] = useState(false)
  const [savingSensors, setSavingSensors] = useState(false)
  const [aiHistory, setAiHistory] = useState([])
  const fileInputRef = useRef(null)
  const pollRef = useRef(null)

  useEffect(() => {
    if (selectedDrawingId) localStorage.setItem('gl_selected_drawing_id', selectedDrawingId)
    else localStorage.removeItem('gl_selected_drawing_id')
  }, [selectedDrawingId])

  const fetchState = async () => {
    try {
      const [stateRes, sensorsRes, tsRes] = await Promise.all([
        fetch('/api/gas-leak/state'),
        fetch('/api/gas-leak/sensors'),
        fetch('/api/gas-leak/timeseries'),
      ])
      if (stateRes.ok) {
        const data = await stateRes.json()
        setState(s => ({ ...s, ...data }))
      }
      if (sensorsRes.ok) setSensors(await sensorsRes.json())
      if (tsRes.ok) setTimeseries(await tsRes.json())
    } catch (_) {}
    setLoading(false)
  }

  const fetchDrawings = async () => {
    try {
      const res = await fetch('/api/gas-leak/drawings')
      if (res.ok) setDrawings(await res.json())
    } catch (_) {}
  }

  const fetchDrawingDetail = async (id) => {
    if (!id) return
    try {
      const res = await fetch(`/api/gas-leak/drawings/${id}`)
      if (res.ok) setDrawingDetail(await res.json())
    } catch (_) {
      setDrawingDetail(null)
    }
  }

  useEffect(() => {
    fetchState()
    fetchDrawings()
    pollRef.current = setInterval(fetchState, 2000)
    return () => clearInterval(pollRef.current)
  }, [])

  useEffect(() => {
    if (selectedDrawingId) fetchDrawingDetail(selectedDrawingId)
    else setDrawingDetail(null)
  }, [selectedDrawingId])

  useEffect(() => {
    if (!events?.subscribe?.length) return
    const es = new EventSource('/api/events/stream')
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data)
        if (!events.subscribe.includes(ev.type)) return
        if (ev.type === 'GAS_LEAK_EMERGENCY_STOP_RESULT' || ev.type === 'GAS_LEAK_VALVE_RESET_RESULT') {
          fetchState()
          setMessage(ev.type === 'GAS_LEAK_EMERGENCY_STOP_RESULT' ? '비상 밸브 차단 완료' : '밸브 해제 완료')
          setTimeout(() => setMessage(null), 3000)
        }
        if (ev.type === 'GAS_LEAK_DRAWING_UPLOADED' && ev.payload?.success) {
          setUploading(false)
          setMessage('도면이 업로드되었습니다.')
          fetchDrawings()
          setTimeout(() => setMessage(null), 3000)
        }
        if (ev.type === 'GAS_LEAK_DRAWING_DELETED' && ev.payload?.success) {
          if (ev.payload.drawing_id === selectedDrawingId) setSelectedDrawingId(null)
          setDrawingDetail(null)
          fetchDrawings()
          setMessage('도면이 삭제되었습니다.')
          setTimeout(() => setMessage(null), 3000)
        }
        if (ev.type === 'GAS_LEAK_SENSORS_SAVED' && ev.payload?.success) {
          setSavingSensors(false)
          setMessage('센서 위치가 저장되었습니다.')
          fetchDrawingDetail(selectedDrawingId)
          fetchState()
          setTimeout(() => setMessage(null), 3000)
        }
        if (ev.type === 'GAS_LEAK_CALL_MANAGER_RESULT' && ev.payload?.success) {
          setMessage('관리자 호출 요청이 기록되었습니다.')
          fetchAiHistory()
          setTimeout(() => setMessage(null), 3000)
        }
      } catch (_) {}
    }
    return () => es.close()
  }, [events?.subscribe, selectedDrawingId])

  const handleEmergencyStop = () => {
    if (!window.confirm('전체 가스 밸브를 비상 차단하시겠습니까?')) return
    onAction?.('onEmergencyStop', { reason: 'manual' })
  }

  const handleValveReset = () => {
    if (!window.confirm('밸브를 수동 해제하시겠습니까?')) return
    onAction?.('onValveReset', {})
  }

  const handleCallManager = () => {
    onAction?.('onCallManager', {})
  }

  const handleAlarmOff = () => {
    onAction?.('onAlarmControl', { beacon_on: false, siren_on: false })
  }

  const handleFileChange = (e) => {
    const file = e.target?.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result || '').split(',')[1]
      if (!base64) return
      setUploading(true)
      onAction?.('onDrawingUpload', { name: file.name, filename: file.name, file_base64: base64 })
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleDeleteDrawing = (id) => {
    if (!window.confirm('이 도면을 삭제하시겠습니까?')) return
    onAction?.('onDrawingDelete', { drawing_id: id })
  }

  const handleMapClick = (e) => {
    if (activeTab !== 'drawing' || !drawingDetail?.drawing) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    setPendingSensorPos({ x, y })
  }

  const handleAddSensor = () => {
    if (!pendingSensorPos || !selectedDrawingId || !drawingDetail) return
    const list = [...(drawingDetail.sensors || [])]
    const newId = `S${Date.now()}`
    const st = sensorForm.sensor_type || 'pressure'
    list.push({
      id: newId,
      label: sensorForm.label || newId,
      zone_id: 'zone1',
      x: pendingSensorPos.x,
      y: pendingSensorPos.y,
      unit: SENSOR_UNITS[st] || 'MPa',
      sensor_type: st,
    })
    setDrawingDetail({ ...drawingDetail, sensors: list })
    setPendingSensorPos(null)
    setSensorForm({ label: '', sensor_type: 'pressure' })
  }

  const handleRemoveSensor = (index) => {
    if (!drawingDetail) return
    const list = drawingDetail.sensors.filter((_, i) => i !== index)
    setDrawingDetail({ ...drawingDetail, sensors: list })
  }

  const handleSaveSensors = () => {
    if (!selectedDrawingId || !drawingDetail?.sensors) return
    setSavingSensors(true)
    onAction?.('onSensorsSave', { drawing_id: selectedDrawingId, sensors: drawingDetail.sensors })
  }

  const sensorsById = sensors.reduce((acc, s) => { acc[s.id] = s; return acc }, {})

  if (loading && !state.zones?.length && !drawings.length) {
    return <div className="gl-loading">상태 로딩 중...</div>
  }

  const zones = state.zones?.length ? state.zones : [
    { id: 'zone1', name: 'Zone 1', status: 'normal', x: 20, y: 30 },
    { id: 'zone2', name: 'Zone 2', status: 'normal', x: 50, y: 30 },
    { id: 'zone3', name: 'Zone 3', status: 'normal', x: 80, y: 30 },
  ]

  const mapSensors = drawingDetail?.sensors || []
  const mapSensorValues = sensorsById
  // 실시간 센서: 도면에 등록된 센서만 표시, API에서 받은 현재값(value/status) 병합
  const displaySensors = mapSensors.map((s) => ({
    ...s,
    value: sensorsById[s.id]?.value ?? '-',
    status: sensorsById[s.id]?.status ?? 'normal',
  }))

  return (
    <div className="gl-dashboard">
      {message && <div className="gl-toast">{message}</div>}

      <div className="gl-tabs">
        <button type="button" className={activeTab === 'monitor' ? 'active' : ''} onClick={() => setActiveTab('monitor')}>관제</button>
        <button type="button" className={activeTab === 'drawing' ? 'active' : ''} onClick={() => setActiveTab('drawing')}>도면 / 센서 등록</button>
      </div>

      {activeTab === 'monitor' && (
        <>
          <section className="gl-section gl-twin">
            <h2>디지털 트윈 (구역 현황)</h2>
            {selectedDrawingId ? (
              <div className="gl-map gl-map-with-image">
                <div
                  className="gl-map-image-wrap"
                  style={{ backgroundImage: `url(/api/gas-leak/drawings/${selectedDrawingId}/file)` }}
                  title="공장 도면"
                >
                  {mapSensors.map((s) => (
                    <div
                      key={s.id}
                      className="gl-map-sensor-marker"
                      style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%` }}
                      title={`${s.label}: ${(mapSensorValues[s.id]?.value ?? '-')} ${s.unit}`}
                    >
                      <span className="gl-marker-dot" style={{ background: ZONE_STATUS_COLOR[mapSensorValues[s.id]?.status] || ZONE_STATUS_COLOR.normal }} />
                      <span className="gl-marker-label">{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="gl-map">
                <svg viewBox="0 0 100 60" className="gl-map-svg">
                  <defs>
                    <linearGradient id="pipeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#3fb950" />
                      <stop offset="100%" stopColor="#58a6ff" />
                    </linearGradient>
                  </defs>
                  <path d="M 5 30 H 95" stroke="url(#pipeGrad)" strokeWidth="2" fill="none" />
                  <path d="M 50 30 V 55" stroke="url(#pipeGrad)" strokeWidth="1.5" fill="none" />
                  {zones.map((z) => (
                    <g key={z.id}>
                      <circle cx={z.x ?? 50} cy={z.y ?? 25} r="8" fill={ZONE_STATUS_COLOR[z.status] || ZONE_STATUS_COLOR.normal} stroke="#1a2332" strokeWidth="1" className="gl-zone-dot" />
                      <text x={z.x ?? 50} y={(z.y ?? 25) + 14} textAnchor="middle" className="gl-zone-label">{z.name}</text>
                    </g>
                  ))}
                </svg>
              </div>
            )}
            <div className="gl-zone-legend">
              {zones.map((z) => (
                <span key={z.id} className="gl-zone-badge" data-status={z.status}>
                  {z.name}: {z.status === 'critical' ? '이상' : z.status === 'warning' ? '경고' : '정상'}
                </span>
              ))}
            </div>
          </section>

          <section className="gl-section gl-charts">
            <h2>실시간 센서 (압력 / 유량)</h2>
            {displaySensors.length === 0 ? (
              <p className="gl-sensors-empty">
                {selectedDrawingId
                  ? '도면에 등록된 센서가 없습니다. 「도면 / 센서 등록」 탭에서 센서를 등록하면 여기에 그래프가 표시됩니다.'
                  : '표시할 도면을 선택해 주세요. 「도면 / 센서 등록」 탭에서 도면을 업로드·선택한 뒤 센서를 등록하면 센서별 그래프가 표시됩니다.'}
              </p>
            ) : (
              <div className="gl-chart-per-sensor">
                {displaySensors.map((s) => (
                  <div key={s.id} className="gl-chart-box gl-chart-sensor">
                    <div className="gl-chart-title">{s.label} ({s.unit})</div>
                    <TimeSeriesChart data={timeseries.sensors?.[s.id] || []} color={s.sensor_type === 'pressure' ? '#58a6ff' : s.sensor_type === 'concentration' ? '#d29922' : '#3fb950'} />
                  </div>
                ))}
              </div>
            )}
            <div className="gl-sensors-grid">
              {displaySensors.length === 0 ? (
                <p className="gl-sensors-empty">
                  {selectedDrawingId
                    ? '도면에 등록된 센서가 없습니다. 「도면 / 센서 등록」 탭에서 센서를 등록해 주세요.'
                    : '표시할 도면을 선택해 주세요. 「도면 / 센서 등록」 탭에서 도면을 업로드·선택한 뒤 센서를 등록하면 여기에 실시간 수치가 표시됩니다.'}
                </p>
              ) : (
                displaySensors.map((s) => (
                  <div key={s.id} className="gl-sensor-card" data-status={s.status || 'normal'}>
                    <span className="gl-sensor-label">{s.label}</span>
                    <span className="gl-sensor-value">{s.value} {s.unit}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="gl-section gl-mes">
            <h2>MES 연동 (오탐지 방지)</h2>
            <div className="gl-mes-status">
              <span className="gl-mes-label">설비 가동:</span>
              <span className={`gl-mes-value ${state.mes_equipment_running !== false ? 'run' : 'stop'}`}>
                {state.mes_equipment_running !== false ? 'Run' : 'Stop'}
              </span>
              {state.mes_work_order_id && <span className="gl-mes-work">작업지시: {state.mes_work_order_id}</span>}
              {state.mes_updated_at && <span className="gl-mes-at">갱신: {new Date(state.mes_updated_at).toLocaleString('ko-KR')}</span>}
            </div>
            <p className="gl-mes-desc">MES에서 설비 가동 신호를 수신하면 비가동 중 가스 유입 시 누출로 판단합니다. POST /api/gas-leak/mes-status 로 연동.</p>
          </section>

          <section className="gl-section gl-control">
            <h2>비상 제어</h2>
            <div className="gl-valve-status">
              <span className="gl-valve-label">메인 밸브:</span>
              <span className={`gl-valve-value ${state.valve_closed ? 'closed' : 'open'}`}>
                {state.valve_closed ? '차단됨' : '개방'}
              </span>
              {state.emergency_at && (
                <span className="gl-emergency-at">비상 차단 시각: {new Date(state.emergency_at).toLocaleString('ko-KR')}</span>
              )}
            </div>
            <div className="gl-alarm-status">
              <span className="gl-valve-label">경광등:</span>
              <span className={state.alarm_beacon_on ? 'gl-alarm-on' : 'gl-alarm-off'}>{state.alarm_beacon_on ? 'ON' : 'OFF'}</span>
              <span className="gl-valve-label gl-alarm-sep">사이렌:</span>
              <span className={state.alarm_siren_on ? 'gl-alarm-on' : 'gl-alarm-off'}>{state.alarm_siren_on ? 'ON' : 'OFF'}</span>
              {(state.alarm_beacon_on || state.alarm_siren_on) && (
                <button type="button" className="gl-btn gl-btn-secondary gl-btn-alarm-off" onClick={handleAlarmOff}>경광등/사이렌 해제</button>
              )}
            </div>
            <div className="gl-buttons">
              <button type="button" className="gl-btn gl-btn-emergency" onClick={handleEmergencyStop} disabled={state.valve_closed}>Emergency STOP</button>
              <button type="button" className="gl-btn gl-btn-reset" onClick={handleValveReset} disabled={!state.valve_closed}>밸브 수동 해제</button>
              <button type="button" className="gl-btn gl-btn-call-manager" onClick={handleCallManager}>관리자 호출 (Call Manager)</button>
            </div>
          </section>
        </>
      )}

      {activeTab === 'drawing' && (
        <section className="gl-section gl-drawing">
          <h2>도면 관리 · 센서 등록</h2>
          <div className="gl-drawing-upload">
            <input type="file" ref={fileInputRef} accept=".png,.jpg,.jpeg,.gif,.webp,.bmp" onChange={handleFileChange} className="gl-file-input" />
            <button type="button" className="gl-btn gl-btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? '업로드 중…' : '이미지 파일 업로드'}
            </button>
          </div>
          <div className="gl-drawing-list">
            <span className="gl-drawing-list-title">도면 목록</span>
            {drawings.length === 0 ? (
              <p className="gl-drawing-empty">등록된 도면이 없습니다. 위에서 이미지를 업로드하세요.</p>
            ) : (
              <ul>
                {drawings.map((d) => (
                  <li key={d.id}>
                    <span>{d.name || d.filename || d.id}</span>
                    <span className="gl-drawing-actions">
                      <button type="button" className="gl-btn-sm" onClick={() => { setSelectedDrawingId(d.id); fetchDrawingDetail(d.id) }}>선택</button>
                      <button type="button" className="gl-btn-sm gl-btn-danger-sm" onClick={() => handleDeleteDrawing(d.id)}>삭제</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {selectedDrawingId && drawingDetail?.drawing && (
            <>
              <div className="gl-drawing-map-label">도면 내 설치 위치 등록 (도면을 클릭하여 센서 추가)</div>
              <div
                className="gl-map gl-map-editable"
                style={{ backgroundImage: `url(/api/gas-leak/drawings/${selectedDrawingId}/file)` }}
                onClick={handleMapClick}
              >
                {mapSensors.map((s) => (
                  <div key={s.id} className="gl-map-sensor-marker editable" style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%` }}>
                    <span className="gl-marker-dot" />
                    <span className="gl-marker-label">{s.label}</span>
                  </div>
                ))}
                {pendingSensorPos && (
                  <div className="gl-map-sensor-marker pending" style={{ left: `${pendingSensorPos.x * 100}%`, top: `${pendingSensorPos.y * 100}%` }}>
                    <span className="gl-marker-dot" /> 새 센서
                  </div>
                )}
              </div>
              {pendingSensorPos && (
                <div className="gl-sensor-form">
                  <label>라벨 <input value={sensorForm.label} onChange={(e) => setSensorForm((f) => ({ ...f, label: e.target.value }))} placeholder="예: 압력-1" /></label>
                  <label>유형
                    <select value={sensorForm.sensor_type} onChange={(e) => setSensorForm((f) => ({ ...f, sensor_type: e.target.value }))}>
                      <option value="pressure">압력 (MPa)</option>
                      <option value="flow">유량 (L/min)</option>
                    </select>
                  </label>
                  <button type="button" className="gl-btn gl-btn-primary" onClick={handleAddSensor}>추가</button>
                  <button type="button" className="gl-btn gl-btn-secondary" onClick={() => setPendingSensorPos(null)}>취소</button>
                </div>
              )}
              <div className="gl-sensors-list">
                <span className="gl-sensors-list-title">등록된 센서 ({mapSensors.length})</span>
                <ul>
                  {mapSensors.map((s, i) => (
                    <li key={s.id}>
                      {s.label} — {s.sensor_type === 'pressure' ? '압력' : s.sensor_type === 'concentration' ? '가스 농도' : '유량'} ({s.unit}), ({(s.x * 100).toFixed(0)}%, {(s.y * 100).toFixed(0)}%)
                      <button type="button" className="gl-btn-sm gl-btn-danger-sm" onClick={() => handleRemoveSensor(i)}>삭제</button>
                    </li>
                  ))}
                </ul>
                {mapSensors.length > 0 && (
                  <button type="button" className="gl-btn gl-btn-primary" onClick={handleSaveSensors} disabled={savingSensors}>
                    {savingSensors ? '저장 중…' : '센서 위치 저장'}
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {activeTab === 'history' && (
        <section className="gl-section gl-history">
          <h2>AI 판단 이력</h2>
          <div className="gl-history-toolbar">
            <button type="button" className="gl-btn gl-btn-secondary" onClick={fetchAiHistory}>새로고침</button>
          </div>
          {aiHistory.length === 0 ? (
            <p className="gl-sensors-empty">기록된 AI 판단 이력이 없습니다.</p>
          ) : (
            <div className="gl-history-table-wrap">
              <table className="gl-history-table">
                <thead>
                  <tr>
                    <th>시각</th>
                    <th>유형</th>
                    <th>메시지</th>
                    <th>센서</th>
                    <th>값</th>
                  </tr>
                </thead>
                <tbody>
                  {aiHistory.map((row, i) => (
                    <tr key={i}>
                      <td>{row.at ? new Date(row.at).toLocaleString('ko-KR') : '-'}</td>
                      <td><span className={`gl-history-type gl-history-type-${row.type || ''}`}>{row.type === 'emergency_stop' ? '비상차단' : row.type === 'valve_reset' ? '밸브해제' : row.type === 'anomaly_detected' ? '이상감지' : row.type === 'call_manager' ? '관리자호출' : row.type || '-'}</span></td>
                      <td>{row.message ?? '-'}</td>
                      <td>{row.sensor_label ?? row.sensor_id ?? '-'}</td>
                      <td>{row.value != null ? `${row.value} ${row.unit || ''}` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function TimeSeriesChart({ data, color }) {
  if (!Array.isArray(data) || data.length === 0) {
    return <div className="gl-chart-empty">데이터 수집 중...</div>
  }
  const values = data.map((d) => (typeof d === 'object' && d !== null && 'v' in d ? d.v : d))
  const min = Math.min(...values)
  const max = Math.max(...values) || 1
  const range = max - min || 1
  const h = 80
  const w = 400
  const points = values.map((v, i) => {
    const x = values.length > 1 ? (i / (values.length - 1)) * w : 0
    const y = h - ((v - min) / range) * h
    return `${x},${y}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="gl-chart-svg" preserveAspectRatio="none">
      <polyline fill="none" stroke={color} strokeWidth="2" points={points} />
    </svg>
  )
}

export default GasLeakControlDashboard
