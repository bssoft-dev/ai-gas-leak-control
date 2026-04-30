import { useCallback, useEffect, useState } from 'react'

import { OpenAPI } from '../../../api/core/OpenAPI'
import { DefaultService } from '../../../api/services/DefaultService'
import { Toast } from '../../../shared/ui/feedback/Toast'

type PolicyForm = {
  level1_warning_pct: string
  level2_siren_pct: string
  level3_valve_pct: string
  grace_seconds: string
}

type PolicyPayload = {
  level1_warning_pct: number
  level2_siren_pct: number
  level3_valve_pct: number
  grace_seconds: number
}

const EMPTY_FORM: PolicyForm = {
  level1_warning_pct: '0',
  level2_siren_pct: '0',
  level3_valve_pct: '0',
  grace_seconds: '0',
}

function toFormValue(value: unknown) {
  if (value == null) return '0'
  const nextValue = Number(value)
  return Number.isFinite(nextValue) ? String(nextValue) : '0'
}

function extractPolicy(stateResponse: any): Partial<PolicyPayload> {
  const policy = stateResponse?.policy ?? {}

  return {
    level1_warning_pct: Number(policy.level1_warning_pct ?? policy.level1WarningPct),
    level2_siren_pct: Number(policy.level2_siren_pct ?? policy.level2SirenPct),
    level3_valve_pct: Number(policy.level3_valve_pct ?? policy.level3ValvePct),
    grace_seconds: Number(policy.grace_seconds ?? policy.graceSeconds),
  }
}

function normalizePolicyForm(policy: Partial<PolicyPayload>): PolicyForm {
  return {
    level1_warning_pct: toFormValue(policy.level1_warning_pct),
    level2_siren_pct: toFormValue(policy.level2_siren_pct),
    level3_valve_pct: toFormValue(policy.level3_valve_pct),
    grace_seconds: toFormValue(policy.grace_seconds),
  }
}

function validateAndBuildPayload(form: PolicyForm): PolicyPayload {
  const payload = {
    level1_warning_pct: Number(form.level1_warning_pct),
    level2_siren_pct: Number(form.level2_siren_pct),
    level3_valve_pct: Number(form.level3_valve_pct),
    grace_seconds: Number(form.grace_seconds),
  }

  if (
    !Number.isFinite(payload.level1_warning_pct) ||
    !Number.isFinite(payload.level2_siren_pct) ||
    !Number.isFinite(payload.level3_valve_pct) ||
    !Number.isFinite(payload.grace_seconds)
  ) {
    throw new Error('모든 정책 값을 숫자로 입력해 주세요.')
  }

  if (
    payload.level1_warning_pct < 0 ||
    payload.level2_siren_pct < 0 ||
    payload.level3_valve_pct < 0 ||
    payload.grace_seconds < 0
  ) {
    throw new Error('정책 값은 0 이상이어야 합니다.')
  }

  return payload
}

export default function SettingsPage() {
  const [form, setForm] = useState<PolicyForm>(EMPTY_FORM)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const fetchState = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const response = await DefaultService.getGasLeakStateApiGasLeakStateGet()
      setForm(normalizePolicyForm(extractPolicy(response)))
    } catch (error: any) {
      setErrorMessage(error?.message ?? '현재 정책 값을 불러오지 못했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!successMessage) return
    const timeoutId = window.setTimeout(() => setSuccessMessage(null), 3000)
    return () => window.clearTimeout(timeoutId)
  }, [successMessage])

  const updateField = (field: keyof PolicyForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const onSavePolicy = async () => {
    setErrorMessage(null)
    setSuccessMessage(null)

    let payload: PolicyPayload
    try {
      payload = validateAndBuildPayload(form)
    } catch (error: any) {
      setErrorMessage(error?.message ?? '정책 값을 확인해 주세요.')
      return
    }

    setIsSaving(true)

    try {
      const response = await fetch(`${OpenAPI.BASE}/api/gas-leak/policy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(`정책 저장에 실패했습니다. (${response.status})`)
      }

      await fetchState()
      setSuccessMessage('정책이 저장되었습니다.')
    } catch (error: any) {
      setErrorMessage(error?.message ?? '정책 저장에 실패했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="px-[24px] py-[24px]">
      <Toast message={successMessage} position="top-center" />
      <div className="rounded-[8px] border border-[#e2e8f0] bg-[#fbfdff] px-[20px] py-[20px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.04)]">
        <h2 className="font-['Pretendard',sans-serif] text-[18px] font-semibold leading-[1.4] text-[#0b1828]">
          정책 · 임계치
        </h2>

        <div className="mt-[20px] grid grid-cols-1 gap-[14px] md:grid-cols-2 xl:grid-cols-4">
          <label className="flex flex-col gap-[6px]">
            <span className="font-['Pretendard',sans-serif] text-[13px] font-medium text-[#485b77]">
              Level1 주의 (%)
            </span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={form.level1_warning_pct}
              onChange={(event) => updateField('level1_warning_pct', event.target.value)}
              disabled={isLoading || isSaving}
              className="h-[44px] rounded-[8px] border border-[#d8e1ec] bg-white px-[12px] font-['Pretendard',sans-serif] text-[15px] text-[#0b1828] outline-none transition focus:border-[#61a0e1] disabled:cursor-not-allowed disabled:bg-[#f8fafc] disabled:text-[#94a3b8]"
            />
          </label>

          <label className="flex flex-col gap-[6px]">
            <span className="font-['Pretendard',sans-serif] text-[13px] font-medium text-[#485b77]">
              Level2 경고 · 사이렌 (%)
            </span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={form.level2_siren_pct}
              onChange={(event) => updateField('level2_siren_pct', event.target.value)}
              disabled={isLoading || isSaving}
              className="h-[44px] rounded-[8px] border border-[#d8e1ec] bg-white px-[12px] font-['Pretendard',sans-serif] text-[15px] text-[#0b1828] outline-none transition focus:border-[#61a0e1] disabled:cursor-not-allowed disabled:bg-[#f8fafc] disabled:text-[#94a3b8]"
            />
          </label>

          <label className="flex flex-col gap-[6px]">
            <span className="font-['Pretendard',sans-serif] text-[13px] font-medium text-[#485b77]">
              Level3 위험 · 차단 (%)
            </span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={form.level3_valve_pct}
              onChange={(event) => updateField('level3_valve_pct', event.target.value)}
              disabled={isLoading || isSaving}
              className="h-[44px] rounded-[8px] border border-[#d8e1ec] bg-white px-[12px] font-['Pretendard',sans-serif] text-[15px] text-[#0b1828] outline-none transition focus:border-[#61a0e1] disabled:cursor-not-allowed disabled:bg-[#f8fafc] disabled:text-[#94a3b8]"
            />
          </label>

          <label className="flex flex-col gap-[6px]">
            <span className="font-['Pretendard',sans-serif] text-[13px] font-medium text-[#485b77]">
              차단 유예 시간 (초)
            </span>
            <input
              type="number"
              min="0"
              step="1"
              value={form.grace_seconds}
              onChange={(event) => updateField('grace_seconds', event.target.value)}
              disabled={isLoading || isSaving}
              className="h-[44px] rounded-[8px] border border-[#d8e1ec] bg-white px-[12px] font-['Pretendard',sans-serif] text-[15px] text-[#0b1828] outline-none transition focus:border-[#61a0e1] disabled:cursor-not-allowed disabled:bg-[#f8fafc] disabled:text-[#94a3b8]"
            />
          </label>
        </div>

        <div className="mt-[18px] flex flex-wrap items-center gap-[10px]">
          <button
            type="button"
            onClick={onSavePolicy}
            disabled={isLoading || isSaving}
            className="inline-flex h-[44px] items-center justify-center rounded-[8px] bg-[#1392ec] px-[18px] font-['Pretendard',sans-serif] text-[15px] font-medium text-white transition hover:bg-[#0f82d5] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? '정책 저장 중...' : '정책 저장'}
          </button>

          {isLoading ? (
            <span className="font-['Pretendard',sans-serif] text-[13px] text-[#7a89a1]">
              현재 정책을 불러오는 중입니다.
            </span>
          ) : null}

          {errorMessage ? (
            <span className="font-['Pretendard',sans-serif] text-[13px] text-[#dc2626]">{errorMessage}</span>
          ) : null}
        </div>

        <p className="mt-[16px] font-['Pretendard',sans-serif] text-[13px] leading-[1.6] text-[#7a89a1]">
          Level1(주의) → Level2(경고·사이렌) → Level3(위험·차단) 순서로 적용되며, 농도는 % 기준입니다.
        </p>
      </div>
    </div>
  )
}
