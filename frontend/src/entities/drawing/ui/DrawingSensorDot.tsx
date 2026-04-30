import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  leftPct: number
  topPct: number
  variant: 'green' | 'yellow'
  label?: string
}

export function DrawingSensorDot({ leftPct, topPct, variant, label }: Props) {
  // 관제 화면에서 눈에 띄는 선명한 톤 (초록/노랑) + 과하지 않은 그림자
  const color = variant === 'green' ? '#34d399' : '#fbbf24'
  const halo = variant === 'green' ? 'rgba(52,211,153,0.42)' : 'rgba(251,191,36,0.42)'
  const haloMid = variant === 'green' ? 'rgba(52,211,153,0.16)' : 'rgba(251,191,36,0.16)'
  const badgeBg = variant === 'green' ? '#34d399' : '#fbbf24'
  const badgeText = '#0b1828'
  const isInteractive = Boolean(label)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const [isHovering, setIsHovering] = useState(false)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number } | null>(null)

  const tooltipNode = useMemo(() => {
    if (!label || !isHovering || !tooltipPos) return null

    const { left, top } = tooltipPos

    return createPortal(
      <div
        ref={tooltipRef}
        className="pointer-events-none fixed z-[500] opacity-0 transition-opacity duration-150"
        style={{
          left,
          top,
          transform: 'translateX(-50%)',
          opacity: 1,
        }}
        role="status"
        aria-live="polite"
      >
        <div
          className="mx-auto h-0 w-0 border-x-[6px] border-b-[6px] border-x-transparent"
          style={{ borderBottomColor: badgeBg }}
        />
        <div
          className="inline-block max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap rounded-[9999px] px-[10px] py-[5px] text-[12px] font-semibold shadow-[0_10px_22px_rgba(15,23,42,0.10)]"
          style={{ backgroundColor: badgeBg, color: badgeText }}
          title={label}
        >
          {label}
        </div>
      </div>,
      document.body,
    )
  }, [badgeBg, badgeText, isHovering, label, tooltipPos])

  useLayoutEffect(() => {
    if (!isInteractive || !isHovering) return

    const update = () => {
      const el = anchorRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const top = rect.bottom + 8

      const viewportW = window.innerWidth
      const padding = 14
      setTooltipPos({ left: centerX, top })

      // 렌더된 실제 폭 기준으로 좌우 클램프 (텍스트보다 툴팁이 길어지는 현상 방지)
      requestAnimationFrame(() => {
        const tip = tooltipRef.current
        if (!tip) return
        const tipWidth = tip.getBoundingClientRect().width
        const clampedLeft = Math.min(
          Math.max(centerX, padding + tipWidth / 2),
          viewportW - padding - tipWidth / 2,
        )
        setTooltipPos((prev) => (prev ? { ...prev, left: clampedLeft } : prev))
      })
    }

    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)

    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [isHovering, isInteractive])

  return (
    <div
      ref={anchorRef}
      className={`absolute ${isInteractive ? 'pointer-events-auto' : 'pointer-events-none'}`}
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
        transform: 'translate(-50%, -50%)',
        width: 14,
        height: 14,
      }}
      onMouseEnter={isInteractive ? () => setIsHovering(true) : undefined}
      onMouseLeave={isInteractive ? () => setIsHovering(false) : undefined}
    >
      <div
        className="absolute rounded-full"
        style={{
          left: -6,
          top: -6,
          width: 26,
          height: 26,
          background: `radial-gradient(circle, ${halo} 0%, ${haloMid} 45%, rgba(0,0,0,0) 70%)`,
          filter: 'blur(0.2px)',
        }}
      />
      <div className="absolute left-[2px] top-[2px] h-[10px] w-[10px] rounded-full" style={{ backgroundColor: color }} />
      {tooltipNode}
    </div>
  )
}
