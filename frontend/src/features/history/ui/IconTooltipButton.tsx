type IconTooltipButtonProps = {
  label: string
  onClick: () => void
  disabled?: boolean
  spin?: boolean
  icon?: 'refresh' | 'reset'
}

export function IconTooltipButton({
  label,
  onClick,
  disabled = false,
  spin = false,
  icon = 'refresh',
}: IconTooltipButtonProps) {
  return (
    <div className="group relative flex items-center">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="inline-flex h-[40px] w-[40px] items-center justify-center rounded-full border border-[#d7e1ee] bg-white text-[#607a9f] transition hover:border-[#61a0e1] hover:text-[#4370ac] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {icon === 'refresh' ? (
          <span
            className={`material-symbols-rounded text-[20px] ${spin ? 'animate-spin' : ''}`}
            aria-hidden="true"
          >
            refresh
          </span>
        ) : (
          <span className="material-symbols-rounded text-[20px]" aria-hidden="true">
            filter_alt_off
          </span>
        )}
      </button>
      <div className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-[8px] bg-[#23344d] px-[10px] py-[6px] text-[12px] font-medium text-white opacity-0 shadow-[0_8px_20px_rgba(15,23,42,0.18)] transition group-hover:opacity-100">
        {label}
      </div>
    </div>
  )
}

