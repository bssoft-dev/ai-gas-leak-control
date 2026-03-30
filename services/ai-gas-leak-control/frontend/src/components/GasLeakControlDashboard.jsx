import React, { useState, useEffect, useRef } from 'react'
import './GasLeakControlDashboard.css'

const ZONE_STATUS_COLOR = { normal: '#3fb950', warning: '#d29922', critical: '#f85149' }
const SENSOR_UNITS = { pressure: 'MPa', flow: 'L/min', concentration: '%' }

function GasLeakControlDashboard({ onAction, events }) {
  const [state, setState] = useState({
    valve_closed: false,
    zones: [],
    emergency_at: null,
    alarm_beacon_on: false,
    alarm_siren_on: false,
    mes_equipment_running: true,
    mes_updated_at: null,
    mes_work_order_id: null,
    policy: { level1_warning_pct: 1.5, level2_siren_pct: 2.5, level3_valve_pct: 3, grace_seconds: 3 },
    risk_level: 0,
    auto_shutdown_deadline: null,
  })
  const [sensors, setSensors] = useState([])
  const [timeseries, setTimeseries] = useState({ pressure: [], flow: [] })
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState(null)
  const [activeTab, setActiveTab] = useState('monitor')
  const [drawings, setDrawings] = useState([])
  const [selectedDrawingId, setSelectedDrawingId] = useState(() => localStorage.getItem('gl_selected_drawing_id') || null)
  const [drawingDetail, setDrawingDetail] = useState(null) // { drawing, sensors }
  const [sensorForm, setSensorForm] = useState({ label: '', sensor_type: 'pressure' })
  const [pendingSensorPos, setPendingSensorPos] = useState(null) // { x, y } 0-1
  const [uploading, setUploading] = useState(false)
  const [savingSensors, setSavingSensors] = useState(false)
  const [aiHistory, setAiHistory] = useState([])
  const [controlHistory, setControlHistory] = useState([])
  const [dailyUsage, setDailyUsage] = useState(null)
  const [policyForm, setPolicyForm] = useState({ level1_warning_pct: 1.5, level2_siren_pct: 2.5, level3_valve_pct: 3, grace_seconds: 3 })
  const [mapMode, setMapMode] = useState('sensor')
  const [pendingValvePos, setPendingValvePos] = useState(null)
  const [valveForm, setValveForm] = useState({ label: '' })
  const [editSensorIndex, setEditSensorIndex] = useState(null)
  const [editForm, setEditForm] = useState({ label: '', sensor_type: 'pressure' })
  const [graceLeftSec, setGraceLeftSec] = useState(null)
  const fileInputRef = useRef(null)
  const pollRef = useRef(null)
  const notifiedRiskRef = useRef(0)

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
        if (data.policy) {
          setPolicyForm((p) => ({
            ...p,
            level1_warning_pct: data.policy.level1_warning_pct ?? p.level1_warning_pct,
            level2_siren_pct: data.policy.level2_siren_pct ?? p.level2_siren_pct,
            level3_valve_pct: data.policy.level3_valve_pct ?? p.level3_valve_pct,
            grace_seconds: data.policy.grace_seconds ?? p.grace_seconds,
          }))
        }
      }
      if (sensorsRes.ok) setSensors(await sensorsRes.json())
      if (tsRes.ok) setTimeseries(await tsRes.json())
    } catch (_) {}
    setLoading(false)
  }

  const fetchAiHistory = async () => {
    try {
      const res = await fetch('/api/gas-leak/ai-history')
      if (res.ok) setAiHistory(await res.json())
    } catch (_) {}
  }

  const fetchControlHistory = async () => {
    try {
      const res = await fetch('/api/gas-leak/control-history')
      if (res.ok) setControlHistory(await res.json())
    } catch (_) {}
  }

  const fetchDailyUsage = async () => {
    try {
      const res = await fetch('/api/gas-leak/daily-usage')
      if (res.ok) setDailyUsage(await res.json())
    } catch (_) {}
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
      if (res.ok) {
        const data = await res.json()
        setDrawingDetail({
          ...data,
          sensors: data.sensors || [],
          valves: data.valves || [],
        })
      }
    } catch (_) {
      setDrawingDetail(null)
    }
  }

  useEffect(() => {
    fetchState()
    fetchDrawings()
    fetchAiHistory()
    fetchControlHistory()
    fetchDailyUsage()
    pollRef.current = setInterval(() => {
      fetchState()
      fetchDailyUsage()
    }, 2000)
    const histIv = setInterval(() => {
      fetchAiHistory()
      fetchControlHistory()
    }, 5000)
    return () => {
      clearInterval(pollRef.current)
      clearInterval(histIv)
    }
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
        if (ev.type === 'GAS_LEAK_POLICY_SAVE_RESULT' && ev.payload?.success) {
          setMessage('정책이 저장되었습니다.')
          fetchState()
          setTimeout(() => setMessage(null), 3000)
        }
        if (ev.type === 'GAS_LEAK_CANCEL_AUTO_SHUTDOWN_RESULT' && ev.payload?.success) {
          setMessage('자동 차단 유예가 취소되었습니다.')
          fetchState()
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

  const handlePolicySave = async () => {
    try {
      await fetch('/api/gas-leak/policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policyForm),
      })
      setMessage('정책이 저장되었습니다.')
      fetchState()
      setTimeout(() => setMessage(null), 3000)
    } catch (_) {}
  }

  const handleCancelAutoShutdown = () => {
    onAction?.('onCancelAutoShutdown', {})
  }

  useEffect(() => {
    if (!state.auto_shutdown_deadline) {
      setGraceLeftSec(null)
      return
    }
    const tick = () => {
      try {
        const raw = state.auto_shutdown_deadline.endsWith('Z')
          ? state.auto_shutdown_deadline.slice(0, -1)
          : state.auto_shutdown_deadline
        const d = new Date(raw)
        setGraceLeftSec(Math.max(0, Math.ceil((d.getTime() - Date.now()) / 1000)))
      } catch (_) {
        setGraceLeftSec(null)
      }
    }
    tick()
    const iv = setInterval(tick, 500)
    return () => clearInterval(iv)
  }, [state.auto_shutdown_deadline])

  useEffect(() => {
    const r = state.risk_level || 0
    if (typeof Notification === 'undefined') return
    if (r >= 2 && notifiedRiskRef.current < r) {
      if (Notification.permission === 'granted') {
        try {
          new Notification('가스 누출 관제', { body: `위험 단계 ${r} — 화면을 확인하세요.` })
        } catch (_) {}
      }
      notifiedRiskRef.current = r
    }
    if (r < 2) notifiedRiskRef.current = 0
  }, [state.risk_level])

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
    if (mapMode === 'valve') {
      setPendingValvePos({ x, y })
      setPendingSensorPos(null)
    } else {
      setPendingSensorPos({ x, y })
      setPendingValvePos(null)
    }
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

  const handleAddValve = () => {
    if (!pendingValvePos || !selectedDrawingId || !drawingDetail) return
    const list = [...(drawingDetail.valves || [])]
    const newId = `V${Date.now()}`
    list.push({
      id: newId,
      label: valveForm.label || newId,
      x: pendingValvePos.x,
      y: pendingValvePos.y,
    })
    setDrawingDetail({ ...drawingDetail, valves: list })
    setPendingValvePos(null)
    setValveForm({ label: '' })
  }

  const handleRemoveValve = (index) => {
    if (!drawingDetail?.valves) return
    const list = drawingDetail.valves.filter((_, i) => i !== index)
    setDrawingDetail({ ...drawingDetail, valves: list })
  }

  const handleSaveSensors = () => {
    if (!selectedDrawingId || !drawingDetail?.sensors) return
    setSavingSensors(true)
    onAction?.('onSensorsSave', {
      drawing_id: selectedDrawingId,
      sensors: drawingDetail.sensors,
      valves: drawingDetail.valves || [],
    })
  }

  const saveSensorEdit = () => {
    if (editSensorIndex == null || !drawingDetail?.sensors) return
    const st = editForm.sensor_type || 'pressure'
    const list = [...drawingDetail.sensors]
    list[editSensorIndex] = {
      ...list[editSensorIndex],
      label: editForm.label || list[editSensorIndex].id,
      sensor_type: st,
      unit: SENSOR_UNITS[st] || 'MPa',
    }
    setDrawingDetail({ ...drawingDetail, sensors: list })
    setEditSensorIndex(null)
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
  const mapValves = drawingDetail?.valves || []
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
        <button type="button" className={activeTab === 'drawing' ? 'active' : ''} onClick={() => setActiveTab('drawing')}>도면 / 센서</button>
        <button type="button" className={activeTab === 'history' ? 'active' : ''} onClick={() => setActiveTab('history')}>이력</button>
        <button type="button" className={activeTab === 'settings' ? 'active' : ''} onClick={() => setActiveTab('settings')}>설정</button>
      </div>

      {activeTab === 'monitor' && (
        <>
          <section className="gl-section gl-risk-strip">
            <h2>실시간 위험·알림 요약</h2>
            <div className="gl-risk-row">
              <span className={`gl-risk-badge ${(state.risk_level || 0) >= 2 ? 'critical' : (state.risk_level || 0) >= 1 ? 'warn' : 'ok'}`}>
                단계 {(state.risk_level ?? 0)} (1:주의 / 2:경고·사이렌 / 3:차단)
              </span>
              <span className="gl-risk-count">
                최근 이상감지 건수: {aiHistory.filter((h) => h.type === 'anomaly_detected').slice(0, 50).length}
              </span>
              {dailyUsage && (
                <span className="gl-daily-usage">
                  금일 가스 유량 적산(추정): {Number(dailyUsage.cumulative_liters || 0).toFixed(1)} L
                </span>
              )}
            </div>
            {state.auto_shutdown_deadline && graceLeftSec != null && (
              <div className="gl-grace-bar">
                <span className="gl-grace-text">Level3 자동 차단까지 약 <strong>{graceLeftSec}</strong>초</span>
                <button type="button" className="gl-btn gl-btn-secondary gl-btn-sm" onClick={handleCancelAutoShutdown}>유예 취소</button>
              </div>
            )}
          </section>

          <section className="gl-section gl-twin">
            <h2>디지털 트윈 (구역 현황)</h2>
            {selectedDrawingId ? (
              <div className="gl-map gl-map-with-image">
                <div
                  className="gl-map-image-wrap"
                  style={{ backgroundImage: `url(/api/gas-leak/drawings/${selectedDrawingId}/file)` }}
                  title="공장 도면"
                >
                  {mapValves.map((v) => (
                    <div
                      key={v.id}
                      className="gl-map-valve-marker"
                      style={{ left: `${v.x * 100}%`, top: `${v.y * 100}%` }}
                      title={v.label}
                    >
                      <span className="gl-valve-square" />
                      <span className="gl-marker-label">{v.label}</span>
                    </div>
                  ))}
                  {mapSensors.map((s) => (
                    <div
                      key={s.id}
                      className={`gl-map-sensor-marker ${(state.risk_level || 0) >= 2 ? 'gl-blink' : ''}`}
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
              <div className="gl-map-mode">
                <span className="gl-drawing-map-label">배치 모드:</span>
                <button type="button" className={mapMode === 'sensor' ? 'gl-btn-sm active' : 'gl-btn-sm'} onClick={() => { setMapMode('sensor'); setPendingValvePos(null) }}>센서</button>
                <button type="button" className={mapMode === 'valve' ? 'gl-btn-sm active' : 'gl-btn-sm'} onClick={() => { setMapMode('valve'); setPendingSensorPos(null) }}>밸브</button>
              </div>
              <div className="gl-drawing-map-label">
                {mapMode === 'valve' ? '도면을 클릭하여 솔레노이드 밸브 위치를 등록합니다.' : '도면을 클릭하여 센서 설치 위치를 등록합니다.'}
              </div>
              <div
                className="gl-map gl-map-editable"
                style={{ backgroundImage: `url(/api/gas-leak/drawings/${selectedDrawingId}/file)` }}
                onClick={handleMapClick}
              >
                {(drawingDetail.valves || []).map((v) => (
                  <div key={v.id} className="gl-map-valve-marker editable" style={{ left: `${v.x * 100}%`, top: `${v.y * 100}%` }}>
                    <span className="gl-valve-square" />
                    <span className="gl-marker-label">{v.label}</span>
                  </div>
                ))}
                {mapSensors.map((s) => (
                  <div key={s.id} className="gl-map-sensor-marker editable" style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%` }}>
                    <span className="gl-marker-dot" />
                    <span className="gl-marker-label">{s.label}</span>
                  </div>
                ))}
                {pendingSensorPos && mapMode === 'sensor' && (
                  <div className="gl-map-sensor-marker pending" style={{ left: `${pendingSensorPos.x * 100}%`, top: `${pendingSensorPos.y * 100}%` }}>
                    <span className="gl-marker-dot" /> 새 센서
                  </div>
                )}
                {pendingValvePos && mapMode === 'valve' && (
                  <div className="gl-map-valve-marker pending" style={{ left: `${pendingValvePos.x * 100}%`, top: `${pendingValvePos.y * 100}%` }}>
                    <span className="gl-valve-square" /> 새 밸브
                  </div>
                )}
              </div>
              {pendingSensorPos && mapMode === 'sensor' && (
                <div className="gl-sensor-form">
                  <label>라벨 <input value={sensorForm.label} onChange={(e) => setSensorForm((f) => ({ ...f, label: e.target.value }))} placeholder="예: 압력-1" /></label>
                  <label>유형
                    <select value={sensorForm.sensor_type} onChange={(e) => setSensorForm((f) => ({ ...f, sensor_type: e.target.value }))}>
                      <option value="pressure">압력 (MPa)</option>
                      <option value="flow">유량 (L/min)</option>
                      <option value="concentration">가스 농도 (%)</option>
                    </select>
                  </label>
                  <button type="button" className="gl-btn gl-btn-primary" onClick={handleAddSensor}>추가</button>
                  <button type="button" className="gl-btn gl-btn-secondary" onClick={() => setPendingSensorPos(null)}>취소</button>
                </div>
              )}
              {pendingValvePos && mapMode === 'valve' && (
                <div className="gl-sensor-form">
                  <label>밸브 라벨 <input value={valveForm.label} onChange={(e) => setValveForm((f) => ({ ...f, label: e.target.value }))} placeholder="예: 메인 밸브" /></label>
                  <button type="button" className="gl-btn gl-btn-primary" onClick={handleAddValve}>밸브 추가</button>
                  <button type="button" className="gl-btn gl-btn-secondary" onClick={() => setPendingValvePos(null)}>취소</button>
                </div>
              )}
              <div className="gl-sensors-list">
                <span className="gl-sensors-list-title">등록된 센서 ({mapSensors.length})</span>
                {editSensorIndex != null && mapSensors[editSensorIndex] && (
                  <div className="gl-sensor-form gl-edit-form">
                    <label>라벨 <input value={editForm.label} onChange={(e) => setEditForm((f) => ({ ...f, label: e.target.value }))} /></label>
                    <label>유형
                      <select value={editForm.sensor_type} onChange={(e) => setEditForm((f) => ({ ...f, sensor_type: e.target.value }))}>
                        <option value="pressure">압력</option>
                        <option value="flow">유량</option>
                        <option value="concentration">가스 농도</option>
                      </select>
                    </label>
                    <button type="button" className="gl-btn gl-btn-primary" onClick={saveSensorEdit}>저장</button>
                    <button type="button" className="gl-btn gl-btn-secondary" onClick={() => setEditSensorIndex(null)}>닫기</button>
                  </div>
                )}
                <ul>
                  {mapSensors.map((s, i) => (
                    <li key={s.id}>
                      {s.label} — {s.sensor_type === 'pressure' ? '압력' : s.sensor_type === 'concentration' ? '가스 농도' : '유량'} ({s.unit}), ({(s.x * 100).toFixed(0)}%, {(s.y * 100).toFixed(0)}%)
                      <button type="button" className="gl-btn-sm" onClick={() => { setEditSensorIndex(i); setEditForm({ label: s.label, sensor_type: s.sensor_type || 'pressure' }) }}>수정</button>
                      <button type="button" className="gl-btn-sm gl-btn-danger-sm" onClick={() => handleRemoveSensor(i)}>삭제</button>
                    </li>
                  ))}
                </ul>
                <span className="gl-sensors-list-title">등록된 밸브 ({(drawingDetail.valves || []).length})</span>
                <ul>
                  {(drawingDetail.valves || []).map((v, i) => (
                    <li key={v.id}>
                      {v.label} ({(v.x * 100).toFixed(0)}%, {(v.y * 100).toFixed(0)}%)
                      <button type="button" className="gl-btn-sm gl-btn-danger-sm" onClick={() => handleRemoveValve(i)}>삭제</button>
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
        <>
          <section className="gl-section gl-history">
            <h2>제어·알람 이력</h2>
            <div className="gl-history-toolbar">
              <button type="button" className="gl-btn gl-btn-secondary" onClick={fetchControlHistory}>새로고침</button>
            </div>
            {controlHistory.length === 0 ? (
              <p className="gl-sensors-empty">제어 이력이 없습니다.</p>
            ) : (
              <div className="gl-history-table-wrap">
                <table className="gl-history-table">
                  <thead>
                    <tr>
                      <th>시각</th>
                      <th>동작</th>
                      <th>내용</th>
                      <th>단계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {controlHistory.map((row, i) => (
                      <tr key={i}>
                        <td>{row.at ? new Date(row.at).toLocaleString('ko-KR') : '-'}</td>
                        <td>{row.action ?? '-'}</td>
                        <td>{row.detail ?? '-'}</td>
                        <td>{row.level ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
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
        </>
      )}

      {activeTab === 'settings' && (
        <section className="gl-section gl-settings">
          <h2>정책·임계치 (3단계 자동 차단)</h2>
          <p className="gl-settings-desc">Level1(주의) → Level2(경고·사이렌) → Level3(위험·유예 후 밸브). 값은 가스 농도(%) 기준입니다.</p>
          <div className="gl-settings-grid">
            <label>Level1 주의 (%)
              <input type="number" step="0.1" min="0" max="100" value={policyForm.level1_warning_pct} onChange={(e) => setPolicyForm((p) => ({ ...p, level1_warning_pct: parseFloat(e.target.value) || 0 }))} />
            </label>
            <label>Level2 경고·사이렌 (%)
              <input type="number" step="0.1" min="0" max="100" value={policyForm.level2_siren_pct} onChange={(e) => setPolicyForm((p) => ({ ...p, level2_siren_pct: parseFloat(e.target.value) || 0 }))} />
            </label>
            <label>Level3 위험·차단 (%)
              <input type="number" step="0.1" min="0" max="100" value={policyForm.level3_valve_pct} onChange={(e) => setPolicyForm((p) => ({ ...p, level3_valve_pct: parseFloat(e.target.value) || 0 }))} />
            </label>
            <label>차단 유예 시간 (초)
              <input type="number" step="1" min="0" max="3600" value={policyForm.grace_seconds} onChange={(e) => setPolicyForm((p) => ({ ...p, grace_seconds: parseInt(e.target.value, 10) || 0 }))} />
            </label>
          </div>
          <button type="button" className="gl-btn gl-btn-primary" onClick={handlePolicySave}>정책 저장</button>

          <h3 className="gl-settings-sub">브라우저 알림 (1단계 주의 대체)</h3>
          <p className="gl-settings-desc">위험 단계 2 이상 시 브라우저 알림을 표시합니다.</p>
          {typeof Notification !== 'undefined' && Notification.permission !== 'granted' && (
            <button type="button" className="gl-btn gl-btn-secondary" onClick={() => Notification.requestPermission()}>알림 권한 요청</button>
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
