import type { ReactNode } from "react"
import { FileLabel } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import { AsyncResult } from "effect/reactivity"
import { FileChip } from "@ren/ui/file-chip"
import { dirsOf, isPath } from "./file-paths.js"

type FileEntries = ReadonlyMap<string, "file" | "directory">

export type RenderFile = (input: string, fallback: ReactNode) => ReactNode

const stripSlash = (path: string) => path.replace(/\/$/u, "")

function ResolveFiles(props: {
  root: Session.ID
  inputs: ReadonlyArray<string>
  found: FileEntries
  children: (found: FileEntries) => ReactNode
}) {
  const [input, ...rest] = props.inputs
  if (input === undefined) return <>{props.children(props.found)}</>
  return <ResolveFile {...props} input={input} rest={rest} />
}

function ResolveFile(props: {
  root: Session.ID
  input: string
  rest: ReadonlyArray<string>
  found: FileEntries
  children: (found: FileEntries) => ReactNode
}) {
  const parsed = FileLabel.parse(props.input)
  const listed = ChatReact.useFolder({
    root: props.root,
    path: parsed.path.includes("/") ? `${parsed.path.slice(0, parsed.path.lastIndexOf("/"))}/` : "",
  })
  const entry = AsyncResult.isSuccess(listed.result)
    ? listed.result.value.find((each) => stripSlash(each.path) === parsed.path)
    : undefined
  const found = entry
    ? new Map(props.found).set(parsed.path, entry.type === "directory" ? "directory" : "file")
    : props.found
  return (
    <ResolveFiles root={props.root} inputs={props.rest} found={found}>
      {props.children}
    </ResolveFiles>
  )
}

export function WorkspaceFiles(props: {
  root: Session.ID
  inputs: ReadonlyArray<string>
  children: (chip: RenderFile) => ReactNode
}) {
  const inputs = props.inputs.filter(isPath)
  return (
    <ResolveFiles root={props.root} inputs={inputs} found={new Map()}>
      {(found) => {
        const existing = inputs.filter((input) => found.has(FileLabel.parse(input).path))
        const dirs = dirsOf(existing)
        return props.children((input, fallback) => {
          const parsed = FileLabel.parse(input)
          const kind = found.get(parsed.path)
          if (!kind) return fallback
          return (
            <FileChip
              path={parsed.path}
              name={parsed.name}
              line={kind === "directory" ? undefined : parsed.line}
              dir={dirs.get(parsed.path)}
              folder={kind === "directory"}
            />
          )
        })
      }}
    </ResolveFiles>
  )
}

const mention = /(^|\s)@(\S+)/gu

export function FileMentions(props: { text: string; root: Session.ID; plain: (text: string) => ReactNode }) {
  const text = props.text
  const plain = props.plain
  const found = [...text.matchAll(mention)].flatMap((match) => {
    const input = (match[2] ?? "").replace(/[.,;:!?)]+$/u, "")
    return isPath(input) ? [{ input, start: match.index + (match[1] ?? "").length }] : []
  })
  if (found.length === 0) return <>{plain(text)}</>
  return (
    <WorkspaceFiles root={props.root} inputs={found.map((item) => item.input)}>
      {(chip) => {
        const built = found.reduce<{ from: number; nodes: ReadonlyArray<ReactNode> }>(
          (all, item) => {
            const end = item.start + item.input.length + 1
            return {
              from: end,
              nodes: [
                ...all.nodes,
                <span key={`t${item.start}`}>{plain(text.slice(all.from, item.start))}</span>,
                <span key={`f${item.start}`}>{chip(item.input, text.slice(item.start, end))}</span>,
              ],
            }
          },
          { from: 0, nodes: [] },
        )
        return (
          <>
            {built.nodes}
            {plain(text.slice(built.from))}
          </>
        )
      }}
    </WorkspaceFiles>
  )
}
