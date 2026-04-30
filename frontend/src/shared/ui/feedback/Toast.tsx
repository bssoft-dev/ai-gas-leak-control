type ToastProps = {
  message: string | null
  position?: 'top-center' | 'bottom-center'
}

export function Toast({ message, position = 'top-center' }: ToastProps) {
  if (!message) return null

  const positionClass =
    position === 'top-center'
      ? 'top-[92px] -translate-x-1/2'
      : 'bottom-[28px] -translate-x-1/2'

  return (
    <div
      className={`pointer-events-none fixed left-1/2 z-[400] max-w-[min(92vw,420px)] rounded-[10px] bg-[#0f172a] px-[18px] py-[12px] text-center font-['Pretendard',sans-serif] text-[14px] leading-[1.45] text-white shadow-[0px_8px_24px_rgba(15,23,42,0.22)] ${positionClass}`}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  )
}

