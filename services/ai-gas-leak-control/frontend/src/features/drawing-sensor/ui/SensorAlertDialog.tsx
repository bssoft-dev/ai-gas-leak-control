type SensorAlertDialogProps = {
  message: string | null
  onClose: () => void
}

export function SensorAlertDialog({ message, onClose }: SensorAlertDialogProps) {
  if (!message) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 px-[24px]"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="sensor-label-alert-title"
    >
      <div className="w-full max-w-[360px] rounded-[12px] bg-white p-[24px] shadow-[0px_12px_40px_rgba(0,0,0,0.18)]">
        <div
          id="sensor-label-alert-title"
          className="font-['Pretendard',sans-serif] text-[16px] font-semibold leading-[1.4] text-[color:var(--black_title,#0b1828)]"
        >
          알림
        </div>
        <p className="mt-[12px] font-['Pretendard',sans-serif] text-[14px] leading-[1.5] text-[color:var(--black_500,#485b77)]">
          {message}
        </p>
        <div className="mt-[20px] flex justify-end">
          <button
            type="button"
            className="h-[40px] rounded-[8px] bg-[var(--blue_icon,#1392ec)] px-[20px] font-['Pretendard',sans-serif] text-[14px] leading-[20px] text-white"
            onClick={onClose}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  )
}
