import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
}

/** 관제·도면/센서 공통: 12col stretch, gutter 20px, 반응형 좌우 마진(최대 200px) */
export function PageContentGrid({ children }: Props) {
  return (
    <div className="w-full bg-white pt-[26px] pb-[24px]">
      <div className="mx-auto w-full max-w-[1920px] px-4 md:px-12 lg:px-16 xl:px-24 2xl:px-[200px]">
        <div className="grid min-h-0 grid-cols-12 gap-x-5 gap-y-8 lg:items-stretch lg:gap-y-0">
          {children}
        </div>
      </div>
    </div>
  )
}
