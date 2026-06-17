import React, { useEffect, useRef, useState } from 'react'

/**
 * 카메라 기반 QR/바코드 스캐너 (html5-qrcode)
 * - 카메라 1개만 실행 (React Strict Mode / effect 중복 방지)
 * - stopWhen 시 즉시 카메라 종료
 */
function QRScanner({ onScan, onError, stopWhen }) {
  const containerRef = useRef(null)
  const [status, setStatus] = useState('idle') // idle | starting | scanning | error
  const [errorMsg, setErrorMsg] = useState('')
  const [retryKey, setRetryKey] = useState(0)
  const scannerRef = useRef(null)
  const onScanRef = useRef(onScan)
  const onErrorRef = useRef(onError)
  onScanRef.current = onScan
  onErrorRef.current = onError

  useEffect(() => {
    if (stopWhen && scannerRef.current?.isScanning) {
      scannerRef.current.stop().catch(() => {})
      scannerRef.current = null
      setStatus('idle')
    }
  }, [stopWhen])

  useEffect(() => {
    if (!containerRef.current || !onScanRef.current) return
    let scanner = null
    let cancelled = false

    const startScanner = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode')
        if (cancelled) return
        setStatus('starting')
        const elementId = containerRef.current.id || 'qr-reader'
        scanner = new Html5Qrcode(elementId)
        const config = { fps: 10, qrbox: { width: 250, height: 250 } }
        const onSuccess = (decodedText) => {
          setStatus('scanning')
          onScanRef.current?.(decodedText)
        }
        const onFail = () => {}

        // 1) 사용 가능한 카메라 목록 조회 후 첫 번째 카메라만 사용
        let started = false
        try {
          const cameras = await Html5Qrcode.getCameras()
          if (cameras && cameras.length > 0 && !cancelled) {
            const backCam = cameras.find((c) => (c.label || '').toLowerCase().includes('back') || (c.label || '').toLowerCase().includes('후면'))
            const camId = (backCam || cameras[0]).id
            await scanner.start(camId, config, onSuccess, onFail)
            started = true
          }
        } catch (_) {}

        // 2) getCameras 실패 시 facingMode 시도: environment(후면) -> user(전면)
        if (!started && !cancelled) {
          for (const facing of ['environment', 'user']) {
            try {
              await scanner.start({ facingMode: facing }, config, onSuccess, onFail)
              started = true
              break
            } catch (_) {}
          }
        }

        if (cancelled && scanner?.isScanning) {
          scanner.stop().catch(() => {})
          return
        }
        if (!started) throw new Error('카메라에 접근할 수 없습니다.')

        scannerRef.current = scanner
        setStatus('scanning')
        setErrorMsg('')
      } catch (err) {
        if (!cancelled) {
          setStatus('error')
          let msg = err.message || '카메라를 사용할 수 없습니다.'
          if (!window.isSecureContext && window.location.protocol !== 'https:') {
            msg += ' (카메라는 HTTPS 또는 localhost에서만 사용 가능합니다.)'
          }
          setErrorMsg(msg)
          onErrorRef.current?.(err)
        }
      }
    }
    startScanner()

    return () => {
      cancelled = true
      const ours = scanner
      if (ours?.isScanning) {
        ours.stop().catch(() => {})
      }
      if (scannerRef.current === ours) {
        scannerRef.current = null
      }
    }
  }, [retryKey])

  return (
    <div className="et-scanner">
      <div
        ref={containerRef}
        id="qr-reader"
        className="et-scanner-container"
        style={{ minHeight: status === 'scanning' ? 300 : 120 }}
      />
      {status === 'starting' && <p className="et-scanner-status">카메라 시작 중…</p>}
      {status === 'error' && (
        <div className="et-scanner-error-wrap">
          <p className="et-scanner-error">{errorMsg}</p>
          <button type="button" className="et-btn et-btn--secondary" onClick={() => setRetryKey((k) => k + 1)}>
            다시 시도
          </button>
        </div>
      )}
    </div>
  )
}

export default QRScanner
