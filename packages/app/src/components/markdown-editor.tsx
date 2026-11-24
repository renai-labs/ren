import { useRef, useState, type ReactNode } from "react"
import { Drive } from "@ren/schema/drive"
import { Button } from "@ren/ui/button"
import { Input } from "@ren/ui/input"
import {
  EditorContent,
  Extension,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type Editor,
  type ReactNodeViewProps,
} from "@tiptap/react"
import { StarterKit } from "@tiptap/starter-kit"
import { Markdown } from "@tiptap/markdown"
import { Placeholder } from "@tiptap/extensions"
import { Image } from "@tiptap/extension-image"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { TableKit } from "@tiptap/extension-table"
import { Plugin } from "@tiptap/pm/state"
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view"
import { cn } from "cn"
import { RouterContext } from "../lib/router-context.js"
import { DriveImage, useOpenDriveFile } from "./drive-file.js"
import { VideoUrl } from "../lib/video-url.js"

export interface Attached {
  readonly name: string
  readonly link: string
  readonly image: boolean
}

export type Upload = (files: ReadonlyArray<File>) => Promise<ReadonlyArray<Attached | undefined>>

const textOf = (value: unknown) => (typeof value === "string" ? value : "")

function EditorImage(props: ReactNodeViewProps) {
  const src = textOf(props.node.attrs["src"])
  const alt = textOf(props.node.attrs["alt"])
  const path = Drive.linkedPath(src)
  return (
    <NodeViewWrapper className="w-fit max-w-full">
      {path ? <DriveImage path={path} alt={alt} /> : <img src={src} alt={alt} className="max-w-full" />}
    </NodeViewWrapper>
  )
}

const VideoLinks = Extension.create({
  name: "videoLinks",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: (state) => {
            const widgets: Array<Decoration> = []
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "paragraph") return true
              const parts = node.content.content.filter((child) => !child.isText || child.text?.trim())
              const link = parts.length === 1 ? parts[0]?.marks.find((mark) => mark.type.name === "link") : undefined
              const href = textOf(link?.attrs["href"])
              if (VideoUrl.is(href))
                widgets.push(
                  Decoration.widget(
                    pos + node.nodeSize,
                    () => {
                      const video = document.createElement("video")
                      video.src = href
                      video.controls = true
                      video.preload = "metadata"
                      video.playsInline = true
                      video.contentEditable = "false"
                      video.className = VideoUrl.className
                      video.setAttribute("aria-label", parts[0]?.text ?? href)
                      return video
                    },
                    { key: `video:${href}`, side: 1, ignoreSelection: true, stopEvent: () => true },
                  ),
                )
              return false
            })
            return DecorationSet.create(state.doc, widgets)
          },
        },
      }),
    ]
  },
})

const Media = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(EditorImage)
  },
})

const prose = cn(
  // oxlint-disable-next-line ren/require-companion-class -- the editor edits in place like Linear: the caret shows focus, a ring would box the text
  "text-md/7 [&_.tiptap]:outline-none",
  "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:font-medium",
  "[&_li]:my-1 [&_li::marker]:text-muted-foreground [&_li>p]:my-0 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6",
  "[&_a]:cursor-pointer [&_a]:underline [&_a]:decoration-muted-foreground [&_a]:underline-offset-3 [&_a:hover]:decoration-foreground",
  "[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm",
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:overscroll-contain [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_hr]:my-4",
  "[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:gap-2 [&_ul[data-type=taskList]_li>div]:min-w-0 [&_ul[data-type=taskList]_li>div]:flex-1",
  "[&_.tableWrapper]:my-3 [&_.tableWrapper]:overflow-x-auto [&_.tableWrapper]:overscroll-x-contain [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium",
  "[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
)

const insert = (view: EditorView, upload: Upload, files: ReadonlyArray<File>, at?: number) => {
  if (files.length === 0) return false
  void upload(files).then((results) => {
    const attached = results.filter((file) => file !== undefined)
    if (view.isDestroyed || attached.length === 0) return
    const schema = view.state.schema
    const nodes = attached.flatMap((file) => {
      const node = file.image
        ? schema.nodes["image"]?.create({ src: file.link, alt: file.name })
        : schema.text(
            file.name,
            [schema.marks["link"]?.create({ href: file.link })].filter((mark) => mark !== undefined),
          )
      return node ? [node] : []
    })
    const tr =
      at === undefined
        ? view.state.tr.insert(view.state.selection.to, nodes)
        : view.state.tr.insert(Math.min(at, view.state.doc.content.size), nodes)
    view.dispatch(tr)
  })
  return true
}

const markdownOf = (editor: Editor) => editor.getMarkdown().replace(/\n+$/u, "")

function LinkField(props: { editor: Editor; onClose: () => void }) {
  const [href, setHref] = useState("")
  const close = () => {
    props.onClose()
    props.editor.commands.focus()
  }
  return (
    <form
      className="mt-2 flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        const url = href.trim()
        if (!url) return close()
        const chain = props.editor.chain().focus()
        if (props.editor.state.selection.empty)
          chain.insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }).run()
        else chain.extendMarkRange("link").setLink({ href: url }).run()
        props.onClose()
      }}
    >
      <Input
        ref={(node) => node?.focus()}
        value={href}
        type="url"
        aria-label="Link address"
        placeholder="https://example.com"
        className="h-8"
        onChange={(event) => setHref(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return
          event.preventDefault()
          event.stopPropagation()
          close()
        }}
      />
      <Button type="submit" size="sm">
        Add link
      </Button>
    </form>
  )
}

export function MarkdownEditor(props: {
  value: string
  label: string
  placeholder: string
  editable?: boolean
  className?: string
  media?: Upload | undefined
  onChange?: (markdown: string) => void
  onCommit?: (markdown: string) => void
  footer?: (attach: (files: ReadonlyArray<File>) => void) => ReactNode
}) {
  const { platform } = RouterContext.useRouterContext()
  const open = useOpenDriveFile()
  const editable = props.editable ?? true
  const baseline = useRef("")
  const [linking, setLinking] = useState(false)
  const upload = props.media
  const commit = (current: Editor) => {
    const next = markdownOf(current)
    if (next === baseline.current) return
    baseline.current = next
    props.onCommit?.(next)
  }
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          autolink: true,
          protocols: ["drive", "blob"],
          HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
        },
      }),
      Media,
      VideoLinks,
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit,
      Markdown,
      Placeholder.configure({ placeholder: props.placeholder }),
    ],
    content: props.value,
    contentType: "markdown",
    editable,
    editorProps: {
      attributes: { "aria-label": props.label },
      handlePaste: (view, event) => (upload ? insert(view, upload, [...(event.clipboardData?.files ?? [])]) : false),
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])]
        if (!upload || files.length === 0) return false
        event.preventDefault()
        return insert(view, upload, files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos)
      },
    },
    onCreate: (event) => {
      baseline.current = markdownOf(event.editor)
    },
    onUpdate: (event) => {
      props.onChange?.(markdownOf(event.editor))
      if (!event.editor.isFocused) commit(event.editor)
    },
    onBlur: (event) => commit(event.editor),
  })
  return (
    <>
      <EditorContent
        editor={editor}
        className={cn(prose, editable && "cursor-text", props.className)}
        onMouseDownCapture={(event) => {
          if (event.target instanceof Element && event.target.closest("a")) event.preventDefault()
        }}
        onClickCapture={(event) => {
          const link = event.target instanceof Element ? event.target.closest("a") : null
          if (!link) return
          event.preventDefault()
          const path = Drive.linkedPath(link.getAttribute("href") ?? "")
          if (path) open(path)
          else platform.openExternal(link.href)
        }}
        onKeyDown={(event) => {
          if (editable && event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            event.stopPropagation()
            setLinking(true)
            return
          }
          if (event.key !== "Escape") return
          editor.commands.setContent(props.value, { contentType: "markdown" })
          editor.commands.blur()
        }}
      />
      {linking ? <LinkField editor={editor} onClose={() => setLinking(false)} /> : null}
      {props.footer?.((files) => {
        if (upload) insert(editor.view, upload, files)
      })}
    </>
  )
}
