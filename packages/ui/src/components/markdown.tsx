import { cn } from "cn"
import { lazy, Suspense } from "react"

const MarkdownRenderer = lazy(() =>
  import("../lib/markdown-renderer.js").then((module) => ({ default: module.MarkdownRenderer })),
)

export function Markdown(props: {
  children: string
  streaming?: boolean | undefined
  size?: "default" | "lg"
  className?: string | undefined
  onOpenSession?: ((sessionID: string) => void) | undefined
}) {
  const size = props.size ?? "default"
  return (
    <div
      data-slot="markdown"
      data-size={size}
      className={cn("min-w-0 text-foreground", size === "lg" ? "text-base" : "text-sm", props.className)}
    >
      <Suspense fallback={<p className="whitespace-pre-wrap">{props.children}</p>}>
        <MarkdownRenderer
          content={props.children}
          streaming={props.streaming === true}
          onOpenSession={props.onOpenSession}
        />
      </Suspense>
    </div>
  )
}
