type Props = {
  /** 이미지 슬롯(도면 영역) 기준 0~100% */
  leftPct: number
  topPct: number
  variant: 'green' | 'yellow'
}

export function DrawingSensorDot({ leftPct, topPct, variant }: Props) {
  const color = variant === 'green' ? '#7cbf6a' : '#caa23d'
  const halo = variant === 'green' ? 'rgba(124,191,106,0.55)' : 'rgba(202,162,61,0.55)'
  const haloMid = variant === 'green' ? 'rgba(124,191,106,0.25)' : 'rgba(202,162,61,0.25)'

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
        transform: 'translate(-50%, -50%)',
        width: 14,
        height: 14,
      }}
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
    </div>
  )
}
