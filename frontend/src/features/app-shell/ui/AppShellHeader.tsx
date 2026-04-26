import { appShellAssets } from '../assets/appShellAssets'

type AppShellHeaderProps = {
  sidebarWidth: number
  isResizingSidebar: boolean
}

export function AppShellHeader({ sidebarWidth, isResizingSidebar }: AppShellHeaderProps) {
  const { imgRunDot, imgEmergencyCaret } = appShellAssets

  return (
    <header
      className={`fixed right-0 top-0 h-[64px] border-b border-[var(--gray_sidebar_stroke,#e2e8f0)] bg-white z-10 ${
        isResizingSidebar ? '' : 'transition-[left] duration-200'
      }`}
      style={{ left: sidebarWidth }}
    >
      <div className="flex h-full items-center justify-end gap-[12px] pl-[24px] pr-[24px]">
        <div className="flex h-[42px] items-center gap-[8px] rounded-[4px] border border-[#e2e8f0] bg-[#f8fafc] px-[13px] py-[5px]">
          <span className="whitespace-nowrap font-['Pretendard',sans-serif] text-[16px] font-medium leading-[15px] tracking-[-0.25px] text-[color:var(--black_title,#0b1828)]">
            MES 설비 가동
          </span>
          <span className="flex items-center gap-[6px]">
            <span className="h-[6px] w-[6px]">
              <img alt="" className="block h-full w-full" src={imgRunDot} />
            </span>
            <span className="whitespace-nowrap font-['Pretendard',sans-serif] text-[16px] font-medium leading-[15px] tracking-[-0.25px] text-[#22c55e]">
              RUN
            </span>
          </span>
        </div>

        <div className="flex h-[41px] items-center">
          <button
            type="button"
            className="h-[40px] rounded-bl-[4px] rounded-tl-[4px] border border-[rgba(226,232,240,0.1)] bg-[#ef4444] px-[13px] py-[7px] font-['Pretendard',sans-serif] text-[16px] font-medium leading-[15px] tracking-[-0.25px] text-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
          >
            비상 제어
          </button>
          <button
            type="button"
            className="flex h-[40px] items-center justify-center rounded-br-[4px] rounded-tr-[4px] bg-[#ef4444] p-[6px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
            aria-label="비상 제어 메뉴"
          >
            <img alt="" className="block h-[3.7px] w-[6px]" src={imgEmergencyCaret} />
          </button>
        </div>
      </div>
    </header>
  )
}
