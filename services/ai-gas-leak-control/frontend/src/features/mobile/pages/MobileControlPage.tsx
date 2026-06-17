import { useState } from 'react'

import { publishGasEvent } from '../api/mobileApi'
import { RiskBanner } from '../components/RiskBanner'
import { useMobileGasState } from '../model/useMobileGasState'

type ControlResult = { ok: boolean; message: string } | null

export default function MobileControlPage() {
  const { state, refresh } = useMobileGasState()
  const [pending, setPending] = useState<string | null>(null)
  const [result, setResult] = useState<ControlResult>(null)

  const run = async (key: string, type: string, payload: Record<string, unknown>, successMsg: string) => {
    setPending(key)
    setResult(null)
    try {
      await publishGasEvent(type, payload)
      setResult({ ok: true, message: successMsg })
      await refresh()
    } catch (e: unknown) {
      setResult({ ok: false, message: e instanceof Error ? e.message : '제어 명령 실패' })
    } finally {
      setPending(null)
    }
  }

  return (
    <section className="space-y-4">
      <RiskBanner state={state} />

      {result && (
        <p
          className={`rounded-[8px] px-3 py-2 text-[13px] ${
            result.ok ? 'bg-[#ecfdf5] text-[#047857]' : 'bg-[#fef2f2] text-[#b91c1c]'
          }`}
        >
          {result.message}
        </p>
      )}

      <div className="grid gap-3">
        <ControlButton
          label="비상 밸브 차단"
          description="즉시 가스 차단"
          danger
          loading={pending === 'stop'}
          onClick={() =>
            void run('stop', 'GAS_LEAK_EMERGENCY_STOP', { reason: 'mobile_manual' }, '비상 차단 명령을 전송했습니다.')
          }
        />
        <ControlButton
          label="밸브 수동 해제"
          description="차단 해제"
          loading={pending === 'reset'}
          onClick={() => void run('reset', 'GAS_LEAK_VALVE_RESET', {}, '밸브 해제 명령을 전송했습니다.')}
        />
        <ControlButton
          label="자동 차단 취소"
          description="유예 카운트다운 중지"
          loading={pending === 'cancel'}
          onClick={() =>
            void run(
              'cancel',
              'GAS_LEAK_CANCEL_AUTO_SHUTDOWN',
              {},
              '자동 차단 유예를 취소했습니다.',
            )
          }
        />
        <ControlButton
          label="관리자 호출"
          description="안전관리자 알림"
          loading={pending === 'call'}
          onClick={() => void run('call', 'GAS_LEAK_CALL_MANAGER', {}, '관리자 호출을 요청했습니다.')}
        />
      </motion>
    </section>
  )
}

function ControlButton({
  label,
  description,
  danger,
  loading,
  onClick,
}: {
  label: string
  description: string
  danger?: boolean
  loading?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      className={`flex w-full flex-col rounded-[12px] border px-4 py-3 text-left disabled:opacity-60 ${
        danger
          ? 'border-[#fecaca] bg-[#fef2f2] text-[#991b1b]'
          : 'border-[#e2e8f0] bg-white text-[#0b1828]'
      }`}
    >
      <span className="text-[15px] font-semibold">{label}</span>
      <span className="text-[12px] opacity-80">{description}</span>
      {loading && <span className="mt-1 text-[12px]">처리 중…</span>}
    </button>
  )
}
