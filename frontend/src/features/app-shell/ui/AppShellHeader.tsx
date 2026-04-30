import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { DefaultService } from '../../../api/services/DefaultService'
import { appShellAssets } from '../assets/appShellAssets'

type AppShellHeaderProps = {
  sidebarWidth: number
  isResizingSidebar: boolean
  isMobileViewport: boolean
  onOpenMobileSidebar: () => void
}

type HeaderActionItem = {
  key: string
  label: string
  description: string
  danger?: boolean
  onClick: () => Promise<void>
}

function extractMesEquipmentRunning(stateResponse: any): boolean | null {
  const rawValue = stateResponse?.mes_equipment_running ?? stateResponse?.mesEquipmentRunning
  return typeof rawValue === 'boolean' ? rawValue : null
}

export function AppShellHeader({
  sidebarWidth,
  isResizingSidebar,
  isMobileViewport,
  onOpenMobileSidebar,
}: AppShellHeaderProps) {
  const { imgRunDot } = appShellAssets
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [mesEquipmentRunning, setMesEquipmentRunning] = useState<boolean | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const fetchMesState = useCallback(async () => {
    try {
      const response = await DefaultService.getGasLeakStateApiGasLeakStateGet()
      const nextValue = extractMesEquipmentRunning(response)
      if (nextValue !== null) {
        setMesEquipmentRunning(nextValue)
      }
    } catch {
      // Keep the latest visible state when polling fails.
    }
  }, [])

  useEffect(() => {
    void fetchMesState()
    const intervalId = window.setInterval(() => {
      void fetchMesState()
    }, 2000)
    return () => window.clearInterval(intervalId)
  }, [fetchMesState])

  useEffect(() => {
    if (!isMenuOpen) return

    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsMenuOpen(false)
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMenuOpen(false)
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isMenuOpen])

  useEffect(() => {
    if (!toastMessage && !errorMessage) return
    const timeoutId = window.setTimeout(() => {
      setToastMessage(null)
      setErrorMessage(null)
    }, 3200)
    return () => window.clearTimeout(timeoutId)
  }, [toastMessage, errorMessage])

  const publishHeaderEvent = async (type: string, payload: Record<string, any>) => {
    await DefaultService.publishEventApiEventsPublishPost({ type, payload })
  }

  const emergencyActions = useMemo<HeaderActionItem[]>(
    () => [
      {
        key: 'emergency-stop',
        label: '비상 차단',
        description: '비상 밸브 차단 이벤트를 발행합니다.',
        danger: true,
        onClick: () => publishHeaderEvent('GAS_LEAK_EMERGENCY_STOP', { reason: 'manual' }),
      },
      {
        key: 'valve-reset',
        label: '밸브 수동 해제',
        description: '밸브 리셋 이벤트를 발행합니다.',
        onClick: () => publishHeaderEvent('GAS_LEAK_VALVE_RESET', {}),
      },
      {
        key: 'alarm-off',
        label: '경광등·사이렌 해제',
        description: '경광등과 사이렌 OFF 이벤트를 발행합니다.',
        onClick: () =>
          publishHeaderEvent('GAS_LEAK_ALARM_CONTROL', {
            beacon_on: false,
            siren_on: false,
          }),
      },
    ],
    [],
  )

  const opsActions = useMemo<HeaderActionItem[]>(
    () => [
      {
        key: 'call-manager',
        label: '관리자 호출',
        description: '관리자 호출 이벤트를 발행합니다.',
        onClick: () => publishHeaderEvent('GAS_LEAK_CALL_MANAGER', {}),
      },
    ],
    [],
  )

  const runAction = async (action: HeaderActionItem) => {
    setPendingActionKey(action.key)
    setToastMessage(null)
    setErrorMessage(null)
    try {
      await action.onClick()
      setToastMessage(`${action.label} 요청을 전송했습니다.`)
      setIsMenuOpen(false)
    } catch (error: any) {
      setErrorMessage(error?.message ?? `${action.label} 요청 전송에 실패했습니다.`)
    } finally {
      setPendingActionKey(null)
    }
  }

  const renderSection = (title: string, items: HeaderActionItem[]) => (
    <div className="flex flex-col gap-[6px]">
      <div className="px-[4px] font-['Pretendard',sans-serif] text-[12px] font-semibold text-[#7a89a1]">
        {title}
      </div>
      {items.map((item) => {
        const isPending = pendingActionKey === item.key
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => void runAction(item)}
            disabled={pendingActionKey != null}
            className={`flex w-full flex-col items-start gap-[2px] rounded-[8px] px-[12px] py-[10px] text-left transition ${
              item.danger ? 'bg-[#fff5f5] hover:bg-[#fee2e2]' : 'bg-white hover:bg-[#f8fafc]'
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <span
              className={`font-['Pretendard',sans-serif] text-[14px] font-semibold ${
                item.danger ? 'text-[#dc2626]' : 'text-[#0b1828]'
              }`}
            >
              {isPending ? `${item.label} 전송 중...` : item.label}
            </span>
            <span className="font-['Pretendard',sans-serif] text-[12px] leading-[1.5] text-[#7a89a1]">
              {item.description}
            </span>
          </button>
        )
      })}
    </div>
  )

  const mesStatusText = mesEquipmentRunning === false ? 'STOP' : 'RUN'
  const mesStatusColor = mesEquipmentRunning === false ? '#64748b' : '#22c55e'

  return (
    <header
      className={`fixed right-0 top-0 z-10 h-[64px] border-b border-[var(--gray_sidebar_stroke,#e2e8f0)] bg-white ${
        isResizingSidebar ? '' : 'transition-[left] duration-200'
      }`}
      style={{ left: sidebarWidth }}
    >
      <div className="relative flex h-full items-center gap-[6px] px-[12px] sm:gap-[10px] sm:px-[16px] lg:justify-end lg:gap-[12px] lg:px-[24px]">
        {isMobileViewport && (
          <button
            type="button"
            className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[8px] border border-[#e2e8f0] bg-white text-[#485b77]"
            aria-label="사이드바 열기"
            onClick={onOpenMobileSidebar}
          >
            <span className="material-symbols-rounded sidebar-icon text-[22px]" aria-hidden="true">
              menu
            </span>
          </button>
        )}

        <div className="ml-auto flex min-w-0 items-center justify-end gap-[8px] sm:gap-[12px]">
        <div className="flex h-[40px] min-w-0 items-center gap-[6px] rounded-[4px] border border-[#e2e8f0] bg-[#f8fafc] px-[10px] py-[5px] sm:h-[42px] sm:gap-[8px] sm:px-[13px]">
          <span className="whitespace-nowrap font-['Pretendard',sans-serif] text-[14px] font-medium leading-[15px] tracking-[-0.25px] text-[color:var(--black_title,#0b1828)] max-[480px]:hidden sm:text-[16px]">
            MES 설비 가동
          </span>
          <span className="flex items-center gap-[6px]">
            <span className="relative h-[6px] w-[6px] shrink-0">
              <img alt="" className="block h-full w-full opacity-0" src={imgRunDot} />
              <span className="absolute inset-0 rounded-full" style={{ backgroundColor: mesStatusColor }} />
            </span>
            <span
              className="whitespace-nowrap font-['Pretendard',sans-serif] text-[14px] font-medium leading-[15px] tracking-[-0.25px] sm:text-[16px]"
              style={{ color: mesStatusColor }}
            >
              {mesStatusText}
            </span>
          </span>
        </div>

        <div ref={menuRef} className="relative flex h-[41px] shrink-0 items-center">
          <button
            type="button"
            onClick={() => setIsMenuOpen((open) => !open)}
            className="h-[40px] rounded-bl-[4px] rounded-tl-[4px] border border-[rgba(226,232,240,0.1)] bg-[#ef4444] px-[10px] py-[7px] font-['Pretendard',sans-serif] text-[14px] font-medium leading-[15px] tracking-[-0.25px] text-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] sm:px-[13px] sm:text-[16px]"
          >
            비상 제어
          </button>
          <button
            type="button"
            onClick={() => setIsMenuOpen((open) => !open)}
            className="flex h-[40px] items-center justify-center rounded-br-[4px] rounded-tr-[4px] bg-[#ef4444] p-[6px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
            aria-label="비상 제어 메뉴"
            aria-expanded={isMenuOpen}
          >
            <span
              aria-hidden
              className={`material-symbols-rounded text-[18px] leading-none text-white transition-transform ${
                isMenuOpen ? 'rotate-180' : ''
              }`}
            >
              expand_more
            </span>
          </button>

          {isMenuOpen && (
            <div className="absolute right-0 top-[52px] z-20 w-[min(calc(100vw-24px),312px)] rounded-[10px] border border-[#e2e8f0] bg-white p-[12px] shadow-[0px_16px_40px_rgba(15,23,42,0.14)]">
              <div className="flex flex-col gap-[12px]">
                {renderSection('긴급 제어', emergencyActions)}
                <div className="h-px w-full bg-[#eef2f7]" />
                {renderSection('운영 액션', opsActions)}
              </div>
            </div>
          )}
        </div>
        </div>

        {(toastMessage || errorMessage) && (
          <div
            className={`absolute right-[24px] top-[72px] rounded-[8px] px-[14px] py-[10px] font-['Pretendard',sans-serif] text-[13px] shadow-[0px_12px_24px_rgba(15,23,42,0.12)] ${
              errorMessage ? 'bg-[#fff1f2] text-[#be123c]' : 'bg-[#0f172a] text-white'
            }`}
          >
            {errorMessage ?? toastMessage}
          </div>
        )}
      </div>
    </header>
  )
}
