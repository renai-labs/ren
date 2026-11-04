import { useRef } from "react"
import type { TaskInfo } from "@ren/client"
import { EditorContent, useEditor } from "@tiptap/react"
import { StarterKit } from "@tiptap/starter-kit"
import { Markdown } from "@tiptap/markdown"
import { Placeholder } from "@tiptap/extensions"
import { Image } from "@tiptap/extension-image"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { TableKit } from "@tiptap/extension-table"
import { cn } from "cn"
import { RouterContext } from "../../lib/router-context.js"

const prose = cn(
  // oxlint-disable-next-line ren/require-companion-class -- the description edits in place like Linear: the caret shows focus, a ring would box the text
  "text-md/7 [&_.tiptap]:outline-none",
  "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:font-medium",
  "[&_li]:my-1 [&_li::marker]:text-muted-foreground [&_li>p]:my-0 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6",
  "[&_a]:cursor-pointer [&_a]:underline [&_a]:decoration-muted-foreground [&_a]:underline-offset-3 [&_a:hover]:decoration-foreground",
  "[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm",
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:overscroll-contain [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_hr]:my-4 [&_img]:my-2 [&_img]:rounded-lg [&_img]:border",
  "[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:gap-2",
  "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium",
  "[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
)

function DescriptionEditor(props: {
  description: string
  editable: boolean
  onChange: (description: string | null) => void
}) {
  const { platform } = RouterContext.useRouterContext()
  const baseline = useRef("")
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true, HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" } },
      }),
      Image,
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit,
      Markdown,
      Placeholder.configure({ placeholder: "Add description…" }),
    ],
    content: props.description,
    contentType: "markdown",
    editable: props.editable,
    editorProps: { attributes: { "aria-label": "Task description" } },
    onCreate: (event) => {
      baseline.current = event.editor.getMarkdown()
    },
    onBlur: (event) => {
      const next = event.editor.getMarkdown()
      if (next !== baseline.current) props.onChange(next.trim() || null)
    },
  })
  return (
    <EditorContent
      editor={editor}
      className={cn(prose, props.editable && "cursor-text")}
      onMouseDownCapture={(event) => {
        if (event.target instanceof Element && event.target.closest("a")) event.preventDefault()
      }}
      onClickCapture={(event) => {
        const link = event.target instanceof Element ? event.target.closest("a") : null
        if (!link) return
        event.preventDefault()
        platform.openExternal(link.href)
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        editor.commands.setContent(props.description, { contentType: "markdown" })
        editor.commands.blur()
      }}
    />
  )
}

export function TaskDescription(props: { task: TaskInfo; onChange: (description: string | null) => void }) {
  const description = props.task.description ?? ""
  if (!description && !props.task.canUpdate) return null
  return (
    <DescriptionEditor
      key={description}
      description={description}
      editable={props.task.canUpdate}
      onChange={props.onChange}
    />
  )
}
