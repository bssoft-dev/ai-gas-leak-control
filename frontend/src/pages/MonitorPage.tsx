import { monitorAssets } from '../assets/monitor/monitorAssets'
import { useActiveDrawing } from '../state/activeDrawing'
import { DefaultService } from '../api/services/DefaultService'
import { useEffect, useState } from 'react'

type ChartCard = {
  id: string
  title: string
  valueText: string
  headerBg: string
  variant: 'green' | 'yellow'
}

export default function MonitorPage() {
  const { drawings, activeDrawingId, activeIndex, total, goPrev, goNext } = useActiveDrawing()

  // Dummy data (backend 연동 전)
  const drawingName = drawings.find((d) => d.id === activeDrawingId)?.name ?? '도면'
  const page = total <= 0 ? 0 : activeIndex + 1
  const totalPages = total

  const [indexHtml, setIndexHtml] = useState<string | null>(null)
  const [indexError, setIndexError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    DefaultService.indexGet()
      .then((res) => {
        if (!mounted) return
        setIndexHtml(res)
        setIndexError(null)
      })
      .catch((e) => {
        if (!mounted) return
        setIndexError(e?.message ?? String(e))
      })
    return () => {
      mounted = false
    }
  }, [])

  const cards: ChartCard[] = [
    { id: 'c1', title: '압력 센서 1', valueText: '11.92 MPa', headerBg: '#f1f7ea', variant: 'green' },
    { id: 'c2', title: '압력 센서 2', valueText: '11.92 MPa', headerBg: '#f1f7ea', variant: 'green' },
    { id: 'c3', title: '압력 센서 3', valueText: '11.92 MPa', headerBg: '#f1f7ea', variant: 'green' },
    { id: 'c4', title: '압력 센서 4', valueText: '11.92 MPa', headerBg: '#fbf6e9', variant: 'yellow' },
    { id: 'c5', title: '압력 센서 5', valueText: '11.92 MPa', headerBg: '#fbf6e9', variant: 'yellow' },
  ]

  const SensorDot = ({
    left,
    top,
    variant,
  }: {
    left: number
    top: number
    variant: 'green' | 'yellow'
  }) => {
    const color = variant === 'green' ? '#7cbf6a' : '#caa23d'
    const halo = variant === 'green' ? 'rgba(124,191,106,0.55)' : 'rgba(202,162,61,0.55)'
    const haloMid = variant === 'green' ? 'rgba(124,191,106,0.25)' : 'rgba(202,162,61,0.25)'

    return (
      <div className="absolute" style={{ left, top, width: 14, height: 14 }}>
        {/* halo */}
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
        {/* inner circle */}
        <div className="absolute left-[2px] top-[2px] w-[10px] h-[10px] rounded-full" style={{ backgroundColor: color }} />
      </div>
    )
  }

  return (
    <div className="w-full bg-white px-[24px] pt-[26px] pb-[24px]">
      <div className="grid grid-cols-[1fr_245px] gap-[24px] items-start">
        {/* Left: drawing section */}
        <section className="min-w-0">
          <div className="font-['Pretendard',sans-serif] font-semibold text-[16px] leading-[1.2] text-[#4370ac] uppercase">
            도면 명
          </div>

          {/* API 연동 확인 (GET /) */}
          <div className="mt-[6px] font-['Pretendard',sans-serif] text-[12px] leading-[16px] text-[#7a89a1]">
            {indexError ? (
              <span className="text-[#ef4444]">API(GET /) 오류: {indexError}</span>
            ) : indexHtml ? (
              <span>API(GET /) 응답 수신: {indexHtml.length.toLocaleString()} chars</span>
            ) : (
              <span>API(GET /) 호출 중...</span>
            )}
          </div>

          <div className="mt-[12px] relative bg-white rounded-[8px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.3),0px_1px_3px_1px_rgba(0,0,0,0.15)] overflow-hidden">
            <div className="h-[786px] relative">
              {/* Drawing image */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <img
                  alt={drawingName}
                  className="absolute left-0 top-[19.35%] w-full h-[61.3%] object-contain"
                  src={monitorAssets.imgDrawing}
                />
              </div>

              {/* Overlay control icons (top-right) */}
              <div className="absolute top-[5px] left-[596px] flex items-center gap-[4px] px-[7px] py-[6px]">
                <button type="button" className="w-[20px] h-[20px] rounded-[6px] flex items-center justify-center">
                  <img alt="" className="block w-[20px] h-[20px]" src={monitorAssets.imgAddCircle} />
                </button>
                <button type="button" className="w-[20px] h-[20px] flex items-center justify-center">
                  <img alt="" className="block w-[20px] h-[20px]" src={monitorAssets.imgDoNotDisturbOn} />
                </button>
                <button type="button" className="w-[20px] h-[20px] flex items-center justify-center">
                  <img alt="" className="block w-[20px] h-[20px]" src={monitorAssets.imgEditSquare} />
                </button>
              </div>

              {/* Dummy sensor dots */}
              <SensorDot left={545} top={441} variant="green" />
              <SensorDot left={572} top={403} variant="yellow" />
            </div>
          </div>

          {/* Pagination */}
          <div className="mt-[18px] flex items-center justify-center gap-[51px] text-[16px] text-[#0b1828]">
            <button type="button" className="w-[20px] h-[20px] flex items-center justify-center" onClick={goPrev}>
              <img alt="" className="-scale-x-100 block w-[20px] h-[20px]" src={monitorAssets.imgChevronLeft} />
            </button>
            <div className="font-['Pretendard',sans-serif] font-normal leading-[20px]">
              {page} / {totalPages}
            </div>
            <button type="button" className="w-[20px] h-[20px] flex items-center justify-center" onClick={goNext}>
              <img alt="" className="block w-[20px] h-[20px]" src={monitorAssets.imgChevronRight} />
            </button>
          </div>
        </section>

        {/* Right: chart list */}
        <aside className="w-[245px]">
          <div className="font-['Pretendard',sans-serif] font-semibold text-[16px] leading-[1.2] text-[#4370ac] uppercase -translate-y-[2px]">
            실시간 차트
          </div>

          <div className="mt-[10px] bg-white rounded-[8px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.3),0px_1px_3px_1px_rgba(0,0,0,0.15)] overflow-hidden">
            <div className="py-[8px] flex flex-col items-center justify-between gap-[12px]">
              {cards.map((c) => (
                <div key={c.id} className="w-[226px]">
                  <div
                    className="border-t border-l border-r border-[#e2e8f0] rounded-tl-[8px] rounded-tr-[8px] px-[12px] py-[4px]"
                    style={{ backgroundColor: c.headerBg }}
                  >
                    <div className="font-['Pretendard',sans-serif] text-[10px] leading-[15px] tracking-[0.5px] text-[#485b77]">
                      {c.title} : {c.valueText}
                    </div>
                  </div>
                  <div className="bg-white border border-[#e2e8f0] rounded-bl-[4px] rounded-br-[4px] rounded-tr-[4px] overflow-hidden">
                    <div className="w-[224px] h-[120px] p-px">
                      {c.variant === 'green' ? (
                        <img alt="" className="block w-full h-full object-cover" src={monitorAssets.imgLineChart} />
                      ) : (
                        <div className="relative w-full h-full bg-white">
                          <img alt="" className="absolute inset-0 w-full h-full object-contain" src={monitorAssets.imgChartYellowVector1} />
                          <img alt="" className="absolute inset-0 w-full h-full object-contain" src={monitorAssets.imgChartYellowVector2} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div className="h-[4px]" />
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

