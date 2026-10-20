import { code } from "@streamdown/code"
import type { HighlightResult } from "@streamdown/code"
import { use } from "react"
import { DiffView } from "./diff-view.js"
import type { DiffHunk, DiffToken, HunkTokens } from "./diff-view.js"

const sideLimit = 500_000
const lineLimit = 1000
const cacheLimit = 64

const cache = new Map<string, Promise<HighlightResult>>()

const combined = new Map<
  string,
  Promise<ReadonlyArray<readonly [HighlightResult | undefined, HighlightResult | undefined]>>
>()

const languages = code.getSupportedLanguages()

const separator = /[\\/]/

const languageOf = (file: string) => {
  const name = file.split(separator).at(-1)?.toLowerCase() ?? ""
  const extension = name.includes(".") ? name.split(".").at(-1) : name
  return languages.find((language) => language === extension)
}

const highlight = (text: string, language: NonNullable<ReturnType<typeof languageOf>>) => {
  const key = `${language}\0${text}`
  const hit = cache.get(key)
  if (hit) return hit
  const promise = new Promise<HighlightResult>((resolve) => {
    const ready = code.highlight({ code: text, language, themes: code.getThemes() }, resolve)
    if (ready) resolve(ready)
  })
  cache.set(key, promise)
  while (cache.size > cacheLimit) cache.delete(cache.keys().next().value ?? key)
  return promise
}

const tokenStyle = (style: Record<string, string> | undefined) => {
  const light = style?.color
  const dark = style?.["--shiki-dark"]
  return light || dark
    ? Object.fromEntries([
        ["--shiki-light", light ?? ""],
        ["--shiki-dark", dark ?? ""],
      ])
    : undefined
}

const toTokens = (result: HighlightResult | undefined, row: number): ReadonlyArray<DiffToken> | undefined =>
  result?.tokens[row]?.map((token) => ({
    content: token.content,
    offset: token.offset,
    style: tokenStyle(token.htmlStyle),
  }))

const mapHunk = (
  hunk: DiffHunk,
  before: HighlightResult | undefined,
  after: HighlightResult | undefined,
): HunkTokens => {
  const rows = hunk.lines.reduce<{ tokens: Array<ReadonlyArray<DiffToken> | undefined>; old: number; new: number }>(
    (state, line) => {
      const deletion = line.type === "deletion"
      const tokens = deletion ? toTokens(before, state.old) : toTokens(after, state.new)
      state.tokens.push(line.text.length > lineLimit ? undefined : tokens)
      if (line.type !== "addition") state.old += 1
      if (!deletion) state.new += 1
      return state
    },
    { tokens: [], old: 0, new: 0 },
  )
  return rows.tokens
}

export function HighlightedDiff(props: { file: string; label: string; hunks: ReadonlyArray<DiffHunk> }) {
  const language = languageOf(props.file)
  const texts = props.hunks.map((hunk) => ({
    before: hunk.lines.flatMap((line) => (line.type === "addition" ? [] : [line.text])).join("\n"),
    after: hunk.lines.flatMap((line) => (line.type === "deletion" ? [] : [line.text])).join("\n"),
  }))
  const size = texts.reduce((total, side) => Math.max(total, side.before.length, side.after.length), 0)
  if (!language || size > sideLimit) return <DiffView label={props.label} hunks={props.hunks} />
  const key = `${language}\0${texts.map((side) => `${side.before}\0${side.after}`).join("\0\u0001")}`
  const cached = combined.get(key)
  const pending =
    cached ??
    Promise.all(
      texts.map((side) =>
        Promise.all([
          highlight(side.before, language).catch(() => undefined),
          highlight(side.after, language).catch(() => undefined),
        ] as const),
      ),
    )
  if (!cached) {
    combined.set(key, pending)
    while (combined.size > cacheLimit) combined.delete(combined.keys().next().value ?? key)
  }
  const results = use(pending)
  return (
    <DiffView
      label={props.label}
      hunks={props.hunks}
      tokens={props.hunks.map((hunk, index) => mapHunk(hunk, results[index]?.[0], results[index]?.[1]))}
    />
  )
}
