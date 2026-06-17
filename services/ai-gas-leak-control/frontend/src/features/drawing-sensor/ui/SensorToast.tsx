type SensorToastProps = {
  message: string | null
}

export function SensorToast({ message }: SensorToastProps) {
  if (!message) return null

  return (
    <div
      className="pointer-events-none fixed bottom-[28px] left-1/2 z-[300] max-w-[min(92vw,420px)] -translate-x-1/2 rounded-[10px] bg-[#2f2f2f] px-[18px] py-[12px] text-center font-['Pretendard',sans-serif] text-[14px] leading-[1.45] text-white shadow-[0px_8px_24px_rgba(0,0,0,0.22)]"
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  )
}
