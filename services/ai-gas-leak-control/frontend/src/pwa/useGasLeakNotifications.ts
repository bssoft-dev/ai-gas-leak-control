import { useCallback, useEffect, useRef } from 'react'

import { isPushEnabled } from './mobileStorage'

type RiskState = {
  riskLevel: number
  riskMessage: string | null
  valveClosed: boolean
}

function vibrateEmergency(): void {
  if (!('vibrate' in navigator)) return
  navigator.vibrate([200, 100, 200, 100, 400])
}

export function useGasLeakNotifications(risk: RiskState | null) {
  const lastLevelRef = useRef(0)

  const notify = useCallback(async (title: string, body: string, level: number) => {
    if (!isPushEnabled()) return
    if (level >= 2) vibrateEmergency()

    if (!('Notification' in window)) return
    if (Notification.permission === 'granted') {
      new Notification(title, {
        body,
        icon: '/icons/logo.svg',
        tag: `gas-risk-${level}`,
      })
      return
    }

    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification(title, {
        body,
        icon: '/icons/logo.svg',
        tag: `gas-risk-${level}`,
        data: { url: '/#/mobile/alerts' },
      })
    }
  }, [])

  useEffect(() => {
    if (!risk) return
    const level = risk.riskLevel ?? 0
    if (level <= 0 || level <= lastLevelRef.current) {
      lastLevelRef.current = level
      return
    }
    lastLevelRef.current = level
    const title =
      level >= 3 ? '위험 — 자동 차단 예정' : level >= 2 ? '경고 — 사이렌' : '주의 — 가스 농도 상승'
    void notify(title, risk.riskMessage || '가스 누출 위험이 감지되었습니다.', level)
  }, [risk, notify])

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) return 'unsupported' as const
    const result = await Notification.requestPermission()
    return result
  }, [])

  return { requestPermission, notify }
}
