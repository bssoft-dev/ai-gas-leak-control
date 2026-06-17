import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'

import { useMobileAuth } from '../auth/MobileAuthContext'

export default function MobileLoginPage() {
  const { auth, loginWithBiometric, loginWithPin } = useMobileAuth()
  const navigate = useNavigate()
  const [userId, setUserId] = useState('operator')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (auth) {
    return <Navigate to="/mobile/home" replace />
  }

  const onBiometric = async () => {
    setError(null)
    setLoading(true)
    try {
      await loginWithBiometric()
      navigate('/mobile/home', { replace: true })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '생체 인증에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const onPinLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await loginWithPin(userId, pin)
      navigate('/mobile/home', { replace: true })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-sm flex-col justify-center gap-6">
      <div className="text-center">
        <img src="/icons/logo.svg" alt="" className="mx-auto h-14 w-14" />
        <h2 className="mt-4 font-['Pretendard',sans-serif] text-[22px] font-semibold text-[#0b1828]">
          모바일 로그인
        </h2>
        <p className="mt-2 text-[14px] text-[#64748b]">생체 인증 또는 PIN으로 현장 앱에 접속합니다.</p>
      </div>

      {error && (
        <p className="rounded-[8px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b91c1c]">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={loading}
        onClick={() => void onBiometric()}
        className="flex h-[48px] items-center justify-center gap-2 rounded-[10px] bg-[#2563eb] text-[15px] font-semibold text-white disabled:opacity-60"
      >
        <span className="material-symbols-rounded text-[22px]">fingerprint</span>
        생체 인증 로그인
      </button>

      <form onSubmit={(e) => void onPinLogin(e)} className="space-y-3 rounded-[12px] border border-[#e2e8f0] bg-white p-4">
        <label className="block text-[13px] font-medium text-[#475569]">
          아이디
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="mt-1 h-[44px] w-full rounded-[8px] border border-[#d8e1ec] px-3 text-[15px]"
            autoComplete="username"
          />
        </label>
        <label className="block text-[13px] font-medium text-[#475569]">
          PIN
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="mt-1 h-[44px] w-full rounded-[8px] border border-[#d8e1ec] px-3 text-[15px]"
            autoComplete="current-password"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="h-[44px] w-full rounded-[8px] border border-[#2563eb] bg-white text-[15px] font-semibold text-[#2563eb] disabled:opacity-60"
        >
          PIN 로그인
        </button>
      </form>

      <p className="text-center text-[12px] text-[#94a3b8]">
        <a href="#/" className="underline">
          데스크톱 관제로 이동
        </a>
      </p>
    </div>
  )
}
