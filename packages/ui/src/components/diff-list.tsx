import { type ReactNode, lazy, Suspense } from "react"
import type { FileDiffStyle } from "#components/file-diff"
import { Spinner } from "#components/spinner"
import type { DiffListFile } from "../lib/pierre-diff-list.js"

const PierreDiffList = lazy(() =>
  import("../lib/pierre-diff-list.js").then((module) => ({ default: module.PierreDiffList })),
)

function DiffList(props: {
  files: ReadonlyArray<DiffListFile>
  collapsed: ReadonlySet<string>
  onToggle: (id: string) => void
  diffStyle: FileDiffStyle
  wrap: boolean
  theme: "system" | "light" | "dark"
  reveal: { readonly id: string } | undefined
  action?: ((path: string) => ReactNode) | undefined
  className?: string | undefined
}) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="text-muted-foreground" />
        </div>
      }
    >
      <PierreDiffList {...props} />
    </Suspense>
  )
}

export { DiffList, type DiffListFile }
