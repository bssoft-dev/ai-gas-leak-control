type SensorDeleteDialogProps = {
  open: boolean
  onClose: () => void
  onConfirm: () => void
}

export function SensorDeleteDialog({ open, onClose, onConfirm }: SensorDeleteDialogProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40 px-[24px]"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="sensor-delete-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[500px] rounded-[12px] bg-white p-[40px] shadow-[0px_12px_40px_rgba(0,0,0,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center">
          <div className="flex h-[48px] w-[48px] items-center justify-center rounded-full bg-[#fef2f2]" aria-hidden>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" />
            </svg>
          </div>
        </div>
        <h2
          id="sensor-delete-title"
          className="mt-[24px] text-center font-['Pretendard',sans-serif] text-[18px] font-semibold leading-[1.35] text-[color:var(--black_title,#0b1828)]"
        >
          해당 센서를 삭제하시겠습니까?
        </h2>
        <p className="mt-[12px] text-center font-['Pretendard',sans-serif] text-[14px] leading-[1.5] text-[color:var(--black_500,#485b77)]">
          삭제 후에는 등록된 센서 정보를 되돌릴 수 없습니다.
        </p>
        <div className="mt-[28px] flex gap-[12px]">
          <button
            type="button"
            className="h-[52px] flex-1 rounded-[8px] border border-[#e2e8f0] bg-white font-['Pretendard',sans-serif] text-[16px] font-medium text-[color:var(--black_700,#2c3c53)]"
            onClick={onClose}
          >
            취소
          </button>
          <button
            type="button"
            className="h-[52px] flex-1 rounded-[8px] bg-[#ef4444] font-['Pretendard',sans-serif] text-[16px] font-medium text-white shadow-[0px_1px_2px_rgba(0,0,0,0.05)]"
            onClick={onConfirm}
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  )
}
