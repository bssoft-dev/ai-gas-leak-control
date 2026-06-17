import { marked } from 'marked'

/**
 * Tiptap 에디터와 동일: GFM, 줄바꿈=BR (TiptapEditor 와 shared)
 */
marked.setOptions({ gfm: true, breaks: true })

export function parseMarkdownToHtml(md) {
  return String(marked.parse(md || '', { async: false }))
}
