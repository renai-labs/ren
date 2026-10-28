import { lazy, Suspense } from "react"
import { Empty, EmptyHeader, EmptyMedia } from "./empty.js"
import { Spinner } from "./spinner.js"

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
    <Suspense
      fallback={
        <Empty className="min-h-40">
          <EmptyHeader>
            <EmptyMedia>
              <Spinner />
            </EmptyMedia>
          </EmptyHeader>
        </Empty>
      }
    >
      <Editor {...props} />
    </Suspense>
  )
}
