export * as Document from "./document.js"

import { cva } from "class-variance-authority"
import { lazy, Suspense } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { CodeOutput } from "./code-output.js"
import type { CodeOutputProps } from "./code-output.js"

export { Media } from "./media.js"

export function preload() {
  return import("../lib/markdown-renderer.js")
}

const MarkdownRenderer = lazy(() => preload().then((module) => ({ default: module.MarkdownRenderer })))

const documentVariants = cva("min-w-0", {
  variants: {
    scale: { compact: "text-sm", standard: "text-base" },
    tone: { primary: "text-text-primary", secondary: "text-text-secondary" },
  },
})

export type MarkdownProps = {
  content: string
  source?: "static" | "streaming"
  scale?: "compact" | "standard"
  tone?: "primary" | "secondary"
  reveal?: "none" | "gradual"
}

export function Markdown(props: MarkdownProps) {
  const source = props.source ?? "static"
  const scale = props.scale ?? "compact"
  return (
    <div
      data-slot="document"
      data-source={source}
      data-scale={scale}
      className={composeClasses(documentVariants({ scale, tone: props.tone ?? "primary" }))}
    >
      <Suspense
        fallback={
          <div>
            <p className="whitespace-pre-wrap">{props.content}</p>
          </div>
        }
      >
        <MarkdownRenderer content={props.content} source={source} reveal={props.reveal ?? "none"} />
      </Suspense>
    </div>
  )
}

export function Code(props: CodeOutputProps) {
  return <CodeOutput {...props} />
}
