import type { DrawingFileKind } from '../lib/drawingFileKind'

type DrawingMediaProps = {
  alt: string
  src?: string
  fileKind?: DrawingFileKind
}

export function DrawingMedia({ alt, src, fileKind = 'image' }: DrawingMediaProps) {
  if (!src) return null

  if (fileKind === 'pdf') {
    return (
      <object
        aria-label={alt}
        className="absolute inset-0 h-full w-full pointer-events-none"
        data={src}
        type="application/pdf"
      >
        <div className="absolute inset-0 flex items-center justify-center bg-[#f8fafc] text-center text-[14px] text-[#64748b]">
          PDF 미리보기를 표시할 수 없습니다.
        </div>
      </object>
    )
  }

  return <img alt={alt} className="absolute inset-0 h-full w-full object-contain" src={src} draggable={false} />
}
