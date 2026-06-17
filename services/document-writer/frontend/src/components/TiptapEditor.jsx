import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { useCallback, forwardRef, useImperativeHandle } from 'react'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { parseMarkdownToHtml } from '../markdownRender'

const turndown = new TurndownService({ headingStyle: 'atx' })
try {
  turndown.use(gfm)
} catch {
  /* */
}

const TiptapEditor = forwardRef(function TiptapEditor(
  { initialMarkdown, onChange, placeholder, viewMode = 'continuous' },
  ref,
) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        Table.configure({
          resizable: true,
        }),
        TableRow,
        TableHeader,
        TableCell,
        Placeholder.configure({
          placeholder: placeholder || '작성을 시작하세요…',
        }),
        Link.configure({ openOnClick: true, autolink: true }),
      ],
      content: parseMarkdownToHtml(initialMarkdown),
      onUpdate: ({ editor: ed }) => {
        if (onChange) onChange(turndown.turndown(ed.getHTML()))
      },
    },
    [],
  )

  const insertFromMarkdown = useCallback(
    (md) => {
      if (!editor) return
      const html = parseMarkdownToHtml(md)
      editor.chain().focus().insertContent(String(html)).run()
    },
    [editor],
  )

  const getMarkdown = useCallback(() => {
    if (!editor) return ''
    return turndown.turndown(editor.getHTML())
  }, [editor])

  useImperativeHandle(
    ref,
    () => ({
      insertFromMarkdown,
      getMarkdown,
      focus: () => editor?.chain().focus().run(),
    }),
    [insertFromMarkdown, getMarkdown, editor],
  )

  const wrapClass =
    'sayu-tiptap-wrap' +
    (viewMode === 'paged' ? ' sayu-tiptap-wrap--paged' : ' sayu-tiptap-wrap--continuous')

  if (!editor) {
    return <div className={wrapClass} />
  }
  return (
    <div className={wrapClass}>
      <EditorContent editor={editor} />
    </div>
  )
})

export default TiptapEditor
