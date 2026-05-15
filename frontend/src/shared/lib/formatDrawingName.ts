const DRAWING_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|bmp|pdf)$/i

export function formatDrawingName(name: string | null | undefined) {
  const safeName = String(name ?? '').trim()
  if (!safeName) return ''
  return safeName.replace(DRAWING_EXTENSION_PATTERN, '')
}
