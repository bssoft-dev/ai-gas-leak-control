import { HistoryTabs } from '../ui/HistoryTabs'

export default function ControlAlarmHistoryPage() {
  return (
    <div className="px-[24px] py-[24px]">
      <HistoryTabs />
      <div className="rounded-[12px] border border-[#e2e8f0] bg-white px-[24px] py-[28px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.04)]">
        <h1 className="font-['Pretendard',sans-serif] text-[24px] font-semibold leading-[1.3] text-[#0b1828]">
          제어·알람 이력
        </h1>
        <p className="mt-[8px] font-['Pretendard',sans-serif] text-[14px] leading-[1.6] text-[#64748b]">
          제어 이벤트와 알람 이력을 표시할 영역입니다.
        </p>
      </div>
    </div>
  )
}
