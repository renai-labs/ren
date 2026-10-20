export * as FileDiff from "./file-diff.js"

import { parsePatch, structuredPatch } from "diff"
import type { StructuredPatchHunk } from "diff"
import { Option } from "effect"

export type Status = "added" | "deleted" | "modified"

export interface Source {
  readonly file: string
  readonly patch?: string | null | undefined
  readonly before?: string | undefined
  readonly after?: string | undefined
}

export interface Line {
  readonly type: "context" | "addition" | "deletion"
  readonly text: string
  readonly oldLine: number | undefined
  readonly newLine: number | undefined
}

export interface Hunk {
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  readonly collapsedBefore: number
  readonly additions: number
  readonly deletions: number
  readonly lines: ReadonlyArray<Line>
}

export interface Diff {
  readonly name: string
  readonly partial: boolean
  readonly hunks: ReadonlyArray<Hunk>
  readonly deletionLines: ReadonlyArray<string>
  readonly additionLines: ReadonlyArray<string>
  readonly cacheKey: string
}

export interface View {
  readonly file: string
  readonly additions: number
  readonly deletions: number
  readonly status?: Status | undefined
  readonly diff: Diff
}

export interface Input extends Source {
  readonly additions: number
  readonly deletions: number
  readonly status?: Status | undefined
}

const cacheLimit = 16
const hunkContext = 4
const fullHeader = /^--- [^\n]*\t\r?\n\+\+\+ [^\n]*\t(?:\r?\n|$)/m

const cache = new Map<string, Diff>()

const parse = Option.liftThrowable(parsePatch)

const checksum = (value: string) =>
  Array.from({ length: value.length }, (_, index) => value.charCodeAt(index)).reduce(
    (hash, code) => Math.imul(hash ^ code, 16_777_619),
    2_166_136_261,
  ) >>> 0

const highlightKey = (value: string) => `${value.length}:${checksum(value)}`

const splitLines = (text: string) => (text ? text.split(/(?<=\n)/) : [])

const changeBlocks = (rows: ReadonlyArray<string>) => {
  const blocks = rows.reduce<{ done: Array<string>; removed: Array<string>; added: Array<string> }>(
    (state, row) => {
      if (row.startsWith("-")) state.removed.push(row)
      else if (row.startsWith("+")) state.added.push(row)
      else {
        state.done.push(...state.removed, ...state.added, row)
        state.removed = []
        state.added = []
      }
      return state
    },
    { done: [], removed: [], added: [] },
  )
  return [...blocks.done, ...blocks.removed, ...blocks.added]
}

const toHunk = (hunk: StructuredPatchHunk, previous: StructuredPatchHunk | undefined): Hunk => {
  const rows = changeBlocks(hunk.lines.filter((line) => !line.startsWith("\\")))
  const numbered = rows.reduce<{ lines: Array<Line>; old: number; new: number }>(
    (state, row) => {
      const mark = row.slice(0, 1)
      const text = row.slice(1)
      if (mark === "+") state.lines.push({ type: "addition", text, oldLine: undefined, newLine: state.new++ })
      else if (mark === "-") state.lines.push({ type: "deletion", text, oldLine: state.old++, newLine: undefined })
      else state.lines.push({ type: "context", text, oldLine: state.old++, newLine: state.new++ })
      return state
    },
    { lines: [], old: hunk.oldStart, new: hunk.newStart },
  )
  return {
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    collapsedBefore: Math.max(0, hunk.oldStart - (previous ? previous.oldStart + previous.oldLines : 1)),
    additions: numbered.lines.filter((line) => line.type === "addition").length,
    deletions: numbered.lines.filter((line) => line.type === "deletion").length,
    lines: numbered.lines,
  }
}

const toHunks = (hunks: ReadonlyArray<StructuredPatchHunk>) =>
  hunks.map((hunk, index) => toHunk(hunk, hunks[index - 1]))

const empty = (file: string): Diff => ({
  name: file,
  partial: true,
  hunks: [],
  deletionLines: [],
  additionLines: [],
  cacheKey: highlightKey(`${file}\0`),
})

interface Entry {
  readonly text: string
  newline: boolean
}

interface Sides {
  readonly before: Array<Entry>
  readonly after: Array<Entry>
  previous: string | undefined
  valid: boolean
}

const endsWithoutNewline = (state: Sides) => {
  const before = state.previous === "-" || state.previous === " " ? state.before.at(-1) : undefined
  const after = state.previous === "+" || state.previous === " " ? state.after.at(-1) : undefined
  if (before) before.newline = false
  if (after) after.newline = false
}

const readLine = (state: Sides, line: string) => {
  const mark = line.slice(0, 1)
  if (mark === "\\") {
    endsWithoutNewline(state)
    return state
  }
  const text = line.slice(1)
  if (mark === "-" || mark === " ") state.before.push({ text, newline: true })
  if (mark === "+" || mark === " ") state.after.push({ text, newline: true })
  if (mark !== "-" && mark !== "+" && mark !== " ") state.valid = false
  state.previous = mark
  return state
}

const completeHunk = (patch: string) => {
  const parsed = Option.getOrUndefined(parse(patch))?.at(0)
  if (!parsed || (!parsed.index && !parsed.oldFileName && !parsed.newFileName)) return
  if (!patch.startsWith("diff --git ") && !fullHeader.test(patch)) return
  const hunk = parsed.hunks.length === 1 ? parsed.hunks.at(0) : undefined
  if (!hunk || hunk.oldStart > 1 || hunk.newStart > 1) return
  return hunk
}

const complete = (patch: string) => {
  const hunk = completeHunk(patch)
  if (!hunk) return
  const sides = hunk.lines.reduce(readLine, { before: [], after: [], previous: undefined, valid: true })
  if (!sides.valid) return
  const join = (lines: ReadonlyArray<Entry>) => lines.map((line) => line.text + (line.newline ? "\n" : "")).join("")
  return { before: join(sides.before), after: join(sides.after), lines: hunk.lines }
}

export const completePatchContents = (patch: string) => {
  const found = complete(patch)
  return found && { before: found.before, after: found.after }
}

const splitHunk = (lines: ReadonlyArray<string>): ReadonlyArray<StructuredPatchHunk> => {
  const rows = lines.filter((line) => !line.startsWith("\\"))
  const changes = rows.flatMap((row, index) => (row.startsWith(" ") ? [] : [index]))
  const ranges = changes.reduce<Array<{ start: number; end: number }>>((result, index) => {
    const previous = result.at(-1)
    const start = Math.max(0, index - hunkContext)
    const end = Math.min(rows.length - 1, index + hunkContext)
    if (previous && start <= previous.end + 1) previous.end = end
    else result.push({ start, end })
    return result
  }, [])
  const positions = rows.reduce<Array<{ old: number; new: number }>>(
    (result, row) => {
      const current = result.at(-1) ?? { old: 0, new: 0 }
      result.push({
        old: current.old + (row.startsWith("+") ? 0 : 1),
        new: current.new + (row.startsWith("-") ? 0 : 1),
      })
      return result
    },
    [{ old: 0, new: 0 }],
  )
  return ranges.map((range) => {
    const start = positions[range.start] ?? { old: 0, new: 0 }
    const end = positions[range.end + 1] ?? start
    return {
      oldStart: start.old + 1,
      oldLines: end.old - start.old,
      newStart: start.new + 1,
      newLines: end.new - start.new,
      lines: rows.slice(range.start, range.end + 1),
    }
  })
}

const patchInput = (file: string, patch: string) => {
  const parsed = Option.getOrUndefined(parse(patch))?.at(0)
  if (!parsed) return
  if (parsed.index || parsed.oldFileName || parsed.newFileName) return patch
  if (parsed.hunks.length === 0) return
  return `Index: ${file}\n===================================================================\n--- ${file}\t\n+++ ${file}\t\n${patch}`
}

const sideLines = (lines: ReadonlyArray<string>, other: string) =>
  lines.flatMap((line, index) =>
    line.startsWith(other) || line.startsWith("\\")
      ? []
      : [`${line.slice(1)}${lines[index + 1]?.startsWith("\\") ? "" : "\n"}`],
  )

const build = (file: string, patch: string, cacheKey: string): Diff => {
  const found = complete(patch)
  if (found)
    return {
      name: file,
      partial: false,
      hunks: toHunks(splitHunk(found.lines)),
      deletionLines: splitLines(found.before),
      additionLines: splitLines(found.after),
      cacheKey,
    }
  const input = patchInput(file, patch)
  const partial = input ? Option.getOrUndefined(parse(input))?.at(0) : undefined
  if (!partial) return { ...empty(file), cacheKey }
  return {
    name: file,
    partial: true,
    hunks: toHunks(partial.hunks),
    deletionLines: partial.hunks.flatMap((hunk) => sideLines(hunk.lines, "+")),
    additionLines: partial.hunks.flatMap((hunk) => sideLines(hunk.lines, "-")),
    cacheKey,
  }
}

const fromPatch = (file: string, patch: string): Diff => {
  const key = `${file}\0${patch}`
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const value = build(file, patch, highlightKey(key))
  cache.set(key, value)
  while (cache.size > cacheLimit) cache.delete(cache.keys().next().value ?? key)
  return value
}

export const fromContent = (file: string, before: string, after: string): Diff => {
  if (!before && !after) return empty(file)
  return {
    name: file,
    partial: false,
    hunks: toHunks(structuredPatch(file, file, before, after, "", "", { context: hunkContext }).hunks),
    deletionLines: splitLines(before),
    additionLines: splitLines(after),
    cacheKey: highlightKey(`${file}\0${before}\0${after}`),
  }
}

export const resolve = (source: Source): Diff =>
  typeof source.patch === "string"
    ? fromPatch(source.file, source.patch)
    : fromContent(source.file, source.before ?? "", source.after ?? "")

export const normalize = (input: Input): View => ({
  file: input.file,
  additions: input.additions,
  deletions: input.deletions,
  status: input.status,
  diff: resolve(input),
})

export const text = (view: View, side: "deletions" | "additions") =>
  (side === "deletions" ? view.diff.deletionLines : view.diff.additionLines).join("")
