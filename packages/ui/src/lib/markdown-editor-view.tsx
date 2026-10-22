// oxlint-disable-next-line no-restricted-imports -- this renderer is only imported by MarkdownEditor's lazy boundary
import {
  MDXEditor,
  codeBlockPlugin,
  codeMirrorPlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
} from "@mdxeditor/editor"
import { useRef, useEffect } from "react"
// oxlint-disable-next-line no-restricted-imports -- type-only import from the lazy editor dependency
import type { MDXEditorMethods } from "@mdxeditor/editor"
import type { MarkdownEditorProps } from "../components/markdown-editor.js"
// oxlint-disable-next-line no-restricted-imports -- editor styles load with this lazy renderer
import "@mdxeditor/editor/style.css"
import "../styles/markdown-editor.css"

const plugins = [
  headingsPlugin(),
  listsPlugin(),
  quotePlugin(),
  thematicBreakPlugin(),
  linkPlugin(),
  linkDialogPlugin(),
  tablePlugin(),
  imagePlugin({ disableImageResize: true, disableImageSettingsButton: true }),
  codeBlockPlugin({ defaultCodeBlockLanguage: "txt" }),
  codeMirrorPlugin({
    codeBlockLanguages: {
      txt: "Plain text",
      bash: "Shell",
      json: "JSON",
      js: "JavaScript",
      jsx: "JavaScript (React)",
      ts: "TypeScript",
      tsx: "TypeScript (React)",
      css: "CSS",
      html: "HTML",
      markdown: "Markdown",
      python: "Python",
    },
  }),
  markdownShortcutPlugin(),
]

export function MarkdownEditorView(props: MarkdownEditorProps) {
  const editor = useRef<MDXEditorMethods>(null)
  const last = useRef(props.value)
  useEffect(() => {
    if (props.value === last.current) return
    last.current = props.value
    editor.current?.setMarkdown(props.value)
  }, [props.value])
  return (
    <div data-slot="markdown-editor" className="flex min-w-0 flex-col">
      <MDXEditor
        ref={editor}
        contentEditableClassName="ren-markdown-editor-content"
        // oxlint-disable-next-line better-tailwindcss/no-unknown-classes -- the lazy editor stylesheet scopes third-party CSS with this public hook
        className="ren-markdown-editor"
        markdown={props.value}
        readOnly={props.readOnly ?? false}
        translation={(key, fallback, values = {}) =>
          key === "contentArea.editableMarkdown"
            ? props.label
            : Object.entries(values).reduce(
                (text, entry) => text.replaceAll(`{{${entry[0]}}}`, String(entry[1])),
                fallback,
              )
        }
        onChange={(value, initial) => {
          if (initial) return
          last.current = value
          props.onChange(value)
        }}
        placeholder={props.placeholder}
        plugins={plugins}
      />
    </div>
  )
}
