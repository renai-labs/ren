import { type ReactNode, lazy, Suspense } from "react"
import { IconFileCode } from "@tabler/icons-react"
import { cn } from "cn"
import type { Source } from "../lib/pierre-diff.js"

const PierreDiff = lazy(() => import("../lib/pierre-diff.js").then((module) => ({ default: module.PierreDiff })))

const windowLines = 200

const statusLabels = { added: "Added", deleted: "Deleted" } as const

interface Line {
  readonly type: "context" | "addition" | "deletion"
  readonly text: string
}

function PlainLines(props: { lines: ReadonlyArray<Line> }) {
  return (
    <div className="font-mono text-xs leading-5">
      {props.lines.slice(0, 120).map((line, index) => (
        <div
          // oxlint-disable-next-line react/no-array-index-key -- diff lines have no identity besides their place
          key={index}
          className={cn(
            "px-3 break-all whitespace-pre-wrap",
            line.type === "addition" && "bg-chart-2/10",
            line.type === "deletion" && "bg-chart-4/10",
          )}
        >
          {line.text.replace(/\n$/u, "") || " "}
        </div>
      ))}
    </div>
  )
}

function FileDiffView({
  path,
  status,
  additions,
  deletions,
  source,
  lines,
  theme,
  capped = false,
  action,
  className,
}: {
  path: string
  status?: "added" | "deleted" | "modified" | undefined
  additions: number
  deletions: number
  source: Source
  lines: ReadonlyArray<Line>
  theme: "system" | "light" | "dark"
  capped?: boolean | undefined
  action?: ReactNode
  className?: string
}) {
  const name = path.split("/").at(-1) ?? path
  const folder = path.slice(0, path.length - name.length).replace(/\/$/u, "")
  const empty = source.kind === "patch" ? !source.patch : source.before === source.after
  const windowed = Math.max(additions, deletions) > windowLines
  return (
    <figure data-slot="file-diff" className={cn("overflow-hidden rounded-lg border bg-background", className)}>
      <figcaption className="flex h-9 items-center gap-2 border-b px-3 text-xs">
        <IconFileCode className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium">{name}</span>
        {folder ? <span className="min-w-0 truncate text-muted-foreground">{folder}</span> : null}
        {status && status !== "modified" ? (
          <span className="shrink-0 text-muted-foreground">{statusLabels[status]}</span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-2 tabular-nums">
          <span className="text-chart-2">+{additions}</span>
          <span className="text-chart-4">−{deletions}</span>
        </span>
        {action}
      </figcaption>
      {empty ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">No text changes</p>
      ) : (
        <Suspense
          fallback={
            <div className={cn(capped && "max-h-120 overflow-y-auto overscroll-contain")}>
              <PlainLines lines={lines} />
            </div>
          }
        >
          <PierreDiff path={path} source={source} theme={theme} capped={capped} windowed={windowed} />
        </Suspense>
      )}
    </figure>
  )
}

export { FileDiffView, type Source as FileDiffSource }
