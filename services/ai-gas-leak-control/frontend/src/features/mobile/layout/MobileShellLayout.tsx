import { Outlet } from 'react-router-dom'

import { useGasLeakNotifications } from '../../../pwa/useGasLeakNotifications'
import { useMobileGasState } from '../model/useMobileGasState'
import { MobileBottomNav } from './MobileBottomNav'

export default function MobileShellLayout() {
  const { state } = useMobileGasState()

  useGasLeakNotifications(
    state
      ? {
          riskLevel: state.riskLevel,
          riskMessage: state.riskMessage,
          valveClosed: state.valveClosed,
        }
      : null,
  )

  return (
    <div className="min-h-[100dvh] bg-[#f8fafc] pb-[calc(64px+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-20 border-b border-[#e2e8f0] bg-[#0b1828] px-4 pb-3 pt-[calc(12px+env(safe-area-inset-top))] text-white">
        <p className="text-[11px] font-medium uppercase tracking-wide text-[#94a3b8]">SagoHub</p>
        <h1 className="font-['Pretendard',sans-serif] text-[18px] font-semibold">가스 누출 모바일</h1>
      </header>
      <main className="mx-auto max-w-lg px-4 py-4">
        <Outlet />
      </main>
      <MobileBottomNav />
    </div>
  )
}
