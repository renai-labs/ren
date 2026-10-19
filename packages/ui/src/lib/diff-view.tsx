import { cva } from "class-variance-authority"
import type { CSSProperties, ReactNode } from "react"
import { composeClasses } from "./compose-classes.js"

export type DiffLine = {
  type: "context" | "addition" | "deletion"
  text: string
  oldLine: number | undefined
  newLine: number | undefined
}

export type DiffHunk = {
  collapsedBefore: number
  lines: ReadonlyArray<DiffLine>
}

export type DiffToken = { content: string; offset: number; style: CSSProperties | undefined }

export type HunkTokens = ReadonlyArray<ReadonlyArray<DiffToken> | undefined>

const lineVariants = cva("flex w-max min-w-full", {
  variants: {
    change: {
      addition: "bg-status-success/tint",
      deletion: "bg-status-danger/tint",
      context: "",
    },
  },
})

const markVariants = cva("w-5 shrink-0 text-center select-none", {
  variants: {
    change: {
      addition: "text-status-success",
      deletion: "text-status-danger",
      context: "text-text-secondary",
    },
  },
})

const marks = { addition: "+", deletion: "-", context: " " } as const

const lineNumber = "w-10 shrink-0 pr-2 text-end text-text-secondary tabular-nums select-none @max-[40rem]/diff:hidden"

const hunkKey = (hunk: DiffHunk) => {
  const first = hunk.lines.at(0)
  return `${hunk.collapsedBefore}:${first?.oldLine ?? ""}:${first?.newLine ?? ""}`
}

const unchanged = (count: number) => `${count} unchanged ${count === 1 ? "line" : "lines"}`

export function DiffView(props: {
  label: string
  hunks: ReadonlyArray<DiffHunk>
  tokens?: ReadonlyArray<HunkTokens> | undefined
}) {
  return (
    <section
      data-slot="diff"
      aria-label={props.label}
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the diff can overflow, so keyboard users need to reach it to scroll
      tabIndex={0}
      data-scrollable
      className="@container/diff max-h-96 min-w-0 overflow-auto overscroll-contain rounded-control border border-border-primary bg-background-primary py-1 font-mono text-xs/base outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-primary"
    >
      {props.hunks.map((hunk, index) => (
        <div key={hunkKey(hunk)} className="w-max min-w-full">
          {hunk.collapsedBefore > 0 ? (
            <div className="px-3 py-1 text-text-secondary">{unchanged(hunk.collapsedBefore)}</div>
          ) : null}
          {hunk.lines.map((line, at) => (
            <div
              key={`${line.type}:${line.oldLine ?? ""}:${line.newLine ?? ""}`}
              data-slot="diff-line"
              data-change={line.type}
              className={composeClasses(lineVariants({ change: line.type }))}
            >
              <span className={lineNumber}>
                {line.oldLine === undefined || line.type === "addition" ? "" : line.oldLine}
              </span>
              <span className={lineNumber}>
                {line.newLine === undefined || line.type === "deletion" ? "" : line.newLine}
              </span>
              <span className={composeClasses(markVariants({ change: line.type }))}>{marks[line.type]}</span>
              <code className="pr-3 whitespace-pre text-text-primary">
                <LineText text={line.text} tokens={props.tokens?.[index]?.[at]} />
              </code>
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}

function LineText(props: { text: string; tokens: ReadonlyArray<DiffToken> | undefined }): ReactNode {
  if (!props.tokens) return props.text || " "
  return props.tokens.map((token) => (
    <span key={token.offset} style={token.style}>
      {token.content}
    </span>
  ))
}
