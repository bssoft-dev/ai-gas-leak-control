import React, { useEffect, useRef, useState } from 'react'

function QRScanner({ onScan, onError, stopWhen, elementId = 'qdg-qr-reader' }) {
  const containerRef = useRef(null)
  const [status, setStatus] = useState('idle')
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
    // stopWhen=true 인 동안은 카메라를 시작하지 않습니다.
    if (stopWhen) {
      setStatus('idle')
      return
    }
    let scanner = null
    let cancelled = false

    const startScanner = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode')
        if (cancelled) return
        setStatus('starting')
        scanner = new Html5Qrcode(elementId)
        const config = { fps: 10, qrbox: { width: 260, height: 260 } }
        const onSuccess = (decodedText) => {
          setStatus('scanning')
          onScanRef.current?.(decodedText)
        }
        const onFail = () => {}

        let started = false
        try {
          const cameras = await Html5Qrcode.getCameras()
          if (cameras && cameras.length > 0 && !cancelled) {
            const backCam = cameras.find(
              (c) =>
                (c.label || '').toLowerCase().includes('back') ||
                (c.label || '').toLowerCase().includes('후면')
            )
            const camId = (backCam || cameras[0]).id
            await scanner.start(camId, config, onSuccess, onFail)
            started = true
          }
        } catch (_) {}

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
            msg += ' (HTTPS 또는 localhost 필요)'
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
  }, [retryKey, elementId, stopWhen])

  return (
    <div className="qdg-scanner">
      <div
        ref={containerRef}
        id={elementId}
        className="qdg-scanner-container"
        style={{ minHeight: status === 'scanning' ? 300 : 120 }}
      />
      {status === 'starting' && <p className="qdg-muted">카메라 시작 중…</p>}
      {status === 'error' && (
        <div>
          <p className="qdg-error">{errorMsg}</p>
          <button type="button" className="qdg-btn qdg-btn--ghost" onClick={() => setRetryKey((k) => k + 1)}>
            다시 시도
          </button>
        </div>
      )}
    </div>
  )
}

export default QRScanner
