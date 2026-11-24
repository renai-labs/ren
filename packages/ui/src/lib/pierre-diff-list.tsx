import { useEffect, useRef, type ReactNode } from "react"
import { parseDiffFromFile, processFile, type CodeViewDiffItem, type FileDiffMetadata } from "@pierre/diffs"
import { CodeView, WorkerPoolContext, type CodeViewHandle } from "@pierre/diffs/react"
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react"
import { cn } from "cn"
import type { FileDiffStyle } from "../components/file-diff.js"
import css from "./pierre-diff-list.css?raw"
import { longLine } from "./highlighter.js"
import type { Source } from "./pierre-diff.js"
import { preferredHighlighter, theme, workerPool } from "./worker-pool.js"

export interface DiffListFile {
  readonly id: string
  readonly path: string
  readonly source: Source
  readonly key: string
  readonly additions: number
  readonly deletions: number
  readonly status: "added" | "deleted" | "modified"
}

// oxlint-disable-next-line ren/no-comments -- The header and separator heights match pierre-diff-list.css: the virtualizer places rows from them.
const metrics = { diffHeaderHeight: 36, hunkSeparatorHeight: 28, spacing: 0, paddingTop: 0, paddingBottom: 8 }

const layout = { paddingTop: 0, paddingBottom: 0, gap: 0 }

const parsed = new Map<string, FileDiffMetadata>()

const types = { added: "new", deleted: "deleted", modified: "change" } as const

const contentsOf = (path: string, text: string, key: string) =>
  text ? { name: path, contents: text, cacheKey: key } : null

const parse = (file: DiffListFile) => {
  const source = file.source
  if (source.kind === "patch")
    return source.patch
      ? processFile(source.patch, { cacheKey: file.key, isGitDiff: source.patch.startsWith("diff --git") })
      : null
  if (!source.before && !source.after) return null
  return parseDiffFromFile(
    contentsOf(file.path, source.before, `${file.key}:before`),
    contentsOf(file.path, source.after, `${file.key}:after`),
  )
}

const fileDiffOf = (file: DiffListFile) => {
  const cached = parsed.get(file.key)
  if (cached) return cached
  const found = parse(file)
  const empty = { name: file.path, contents: "" }
  const made = { ...(found ?? parseDiffFromFile(empty, empty)), name: file.path, type: types[file.status] }
  parsed.set(file.key, made)
  if (parsed.size > 400) parsed.delete(parsed.keys().next().value ?? file.key)
  return made
}

// oxlint-disable-next-line ren/no-comments -- CodeView redraws an item only when its version changes, so the version follows the file's contents and whether it is folded.
const versionOf = (text: string) =>
  Array.from(text, (char) => char.codePointAt(0) ?? 0).reduce((hash, code) => (Math.imul(31, hash) + code) | 0, 0)

export function PierreDiffList(props: {
  files: ReadonlyArray<DiffListFile>
  collapsed: ReadonlySet<string>
  onToggle: (path: string) => void
  diffStyle: FileDiffStyle
  wrap: boolean
  theme: "system" | "light" | "dark"
  reveal: { readonly id: string } | undefined
  action?: ((path: string) => ReactNode) | undefined
  className?: string | undefined
}) {
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null)
  const reveal = props.reveal
  useEffect(() => {
    if (reveal) viewer.current?.scrollTo({ type: "item", id: reveal.id, align: "start" })
  }, [reveal])
  const items = props.files.map((file): CodeViewDiffItem => ({
    id: file.id,
    type: "diff",
    fileDiff: fileDiffOf(file),
    collapsed: props.collapsed.has(file.id),
    version: versionOf(`${file.key}:${props.collapsed.has(file.id)}`),
  }))
  const byId = new Map(props.files.map((file) => [file.id, file]))
  return (
    <WorkerPoolContext.Provider value={workerPool()}>
      <CodeView
        ref={viewer}
        items={items}
        className={cn(props.className)}
        options={{
          theme,
          themeType: props.theme,
          preferredHighlighter,
          diffStyle: props.diffStyle,
          diffIndicators: "bars",
          lineDiffType: "word-line",
          maxLineDiffLength: longLine,
          tokenizeMaxLineLength: longLine,
          overflow: props.wrap ? "wrap" : "scroll",
          hunkSeparators: "line-info-basic",
          expansionLineCount: 20,
          stickyHeaders: true,
          unsafeCSS: css,
          itemMetrics: metrics,
          layout,
        }}
        // ast-grep-ignore: no-render-props -- CodeView hands back the file whose header it draws
        renderHeaderPrefix={(item) => {
          const collapsed = props.collapsed.has(item.id)
          return (
            <button
              type="button"
              aria-label={collapsed ? `Expand ${item.id}` : `Collapse ${item.id}`}
              aria-expanded={!collapsed}
              onClick={() => props.onToggle(item.id)}
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {collapsed ? <IconChevronRight className="size-4" /> : <IconChevronDown className="size-4" />}
            </button>
          )
        }}
        // ast-grep-ignore: no-render-props -- CodeView hands back the file whose header it draws
        renderHeaderFilenameSuffix={(item) => (
          <>
            {item.type === "diff" && item.fileDiff.hunks.length === 0 ? (
              <span className="text-muted-foreground">No text changes</span>
            ) : null}
            {props.action?.(byId.get(item.id)?.path ?? item.id)}
          </>
        )}
        // ast-grep-ignore: no-render-props -- CodeView hands back the file whose header it draws
        renderHeaderMetadata={(item) => (
          <span className="flex items-center gap-2 text-xs tabular-nums">
            <span className="text-chart-2">+{byId.get(item.id)?.additions ?? 0}</span>
            <span className="text-chart-4">−{byId.get(item.id)?.deletions ?? 0}</span>
          </span>
        )}
      />
    </WorkerPoolContext.Provider>
  )
}
