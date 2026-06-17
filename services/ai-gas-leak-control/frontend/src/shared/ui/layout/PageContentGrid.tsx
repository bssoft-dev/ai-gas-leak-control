import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
}

/** 관제·도면/센서 공통: 12col stretch, gutter 20px, 반응형 좌우 마진(최대 200px) */
export function PageContentGrid({ children }: Props) {
  return (
    <div className="w-full bg-white pb-[20px] pt-[18px] md:pb-[24px] md:pt-[24px] xl:pt-[26px]">
      <div className="mx-auto w-full max-w-[1920px] px-[12px] sm:px-4 md:px-8 lg:px-10 xl:px-16 2xl:px-[200px]">
        <div className="grid min-h-0 grid-cols-12 gap-x-5 gap-y-6 xl:items-stretch xl:gap-y-0">
          {children}
        </div>
      </div>
    </div>
  )
}
