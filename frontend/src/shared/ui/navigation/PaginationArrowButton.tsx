type PaginationArrowButtonProps = {
  direction: 'prev' | 'next'
  onClick: () => void
  disabled?: boolean
  ariaLabel: string
}

export function PaginationArrowButton({
  direction,
  onClick,
  disabled = false,
  ariaLabel,
}: PaginationArrowButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="inline-flex h-[20px] w-[20px] items-center justify-center text-[#8ea1bb] transition hover:text-[#4370ac] disabled:cursor-not-allowed disabled:opacity-35"
    >
      <svg
        viewBox="0 0 20 20"
        className={`h-[20px] w-[20px] ${direction === 'prev' ? '-scale-x-100' : ''}`}
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M7 4.5L12.5 10L7 15.5"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
