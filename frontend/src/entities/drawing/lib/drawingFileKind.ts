export type DrawingFileKind = 'image' | 'pdf'

export function getDrawingFileKind(fileType?: string | null, name?: string | null) {
  const normalizedFileType = String(fileType ?? '').toLowerCase()
  if (normalizedFileType === 'pdf' || normalizedFileType === 'application/pdf') {
    return 'pdf' as const
  }

  const normalizedName = String(name ?? '').toLowerCase()
  if (normalizedName.endsWith('.pdf')) {
    return 'pdf' as const
  }

  return 'image' as const
}
