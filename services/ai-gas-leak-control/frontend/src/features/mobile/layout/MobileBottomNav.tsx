import { NavLink } from 'react-router-dom'

const tabs = [
  { to: '/mobile/home', label: '현황', icon: 'sensors' },
  { to: '/mobile/control', label: '제어', icon: 'tune' },
  { to: '/mobile/alerts', label: '알림', icon: 'notifications' },
  { to: '/mobile/settings', label: '설정', icon: 'settings' },
] as const

export function MobileBottomNav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 border-t border-[#e2e8f0] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      aria-label="모바일 메뉴"
    >
      <ul className="mx-auto flex max-w-lg">
        {tabs.map((tab) => (
          <li key={tab.to} className="flex-1">
            <NavLink
              to={tab.to}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                  isActive ? 'text-[#2563eb]' : 'text-[#64748b]'
                }`
              }
            >
              <span className="material-symbols-rounded text-[22px]">{tab.icon}</span>
              {tab.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
