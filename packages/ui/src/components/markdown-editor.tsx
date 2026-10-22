import { lazy, Suspense } from "react"
import { LoadingMessage } from "./loading-message.js"

export interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
  readOnly?: boolean
}

const Editor = lazy(() =>
  import("../lib/markdown-editor-view.js").then((module) => ({ default: module.MarkdownEditorView })),
)

export function MarkdownEditor(props: MarkdownEditorProps) {
  return (
    <Suspense fallback={<LoadingMessage placement="section" />}>
      <Editor {...props} />
    </Suspense>
  )
}
