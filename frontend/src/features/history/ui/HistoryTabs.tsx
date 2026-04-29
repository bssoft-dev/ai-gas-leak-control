import { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

const HISTORY_TAB_ITEMS = [
  { to: '/history/ai', label: 'AI 판단 이력' },
  { to: '/history/control-alarm', label: '제어·알람 이력' },
] as const

type HistoryTabsProps = {
  className?: string
  actions?: ReactNode
}

export function HistoryTabs({ className, actions }: HistoryTabsProps) {
  return (
    <div className={className ?? 'mb-[16px] flex flex-wrap items-center justify-between gap-[12px]'}>
      <div className="flex flex-wrap items-center gap-[8px]">
        {HISTORY_TAB_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              isActive
                ? 'inline-flex h-[40px] items-center justify-center rounded-[9999px] border border-[#61a0e1] bg-[#e6f3fb] px-[16px] font-[Pretendard,sans-serif] text-[14px] font-semibold text-[#4370ac]'
                : 'inline-flex h-[40px] items-center justify-center rounded-[9999px] border border-[#e2e8f0] bg-white px-[16px] font-[Pretendard,sans-serif] text-[14px] font-medium text-[#485b77] hover:bg-[#f8fafc]'
            }
          >
            {item.label}
          </NavLink>
        ))}
      </div>
      {actions ? <div className="flex items-center gap-[8px]">{actions}</div> : null}
    </div>
  )
}
