import type { ReactNode } from "react"
import { FileLabel } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import { FileChip } from "@ren/ui/file-chip"
import { dirsOf, isPath } from "./file-paths.js"

export type RenderFile = (input: string, fallback: ReactNode) => ReactNode

const parentOf = (path: string) => (path.includes("/") ? `${path.slice(0, path.lastIndexOf("/"))}/` : "")

export function WorkspaceFiles(props: {
  root: Session.ID
  inputs: ReadonlyArray<string>
  children: (chip: RenderFile) => ReactNode
}) {
  const inputs = props.inputs.filter(isPath)
  const listed = ChatReact.useEntries({
    root: props.root,
    dirs: [...new Set(inputs.map((input) => parentOf(FileLabel.parse(input).path)))].toSorted(),
  })
  const existing = inputs.filter((input) => listed.has(FileLabel.parse(input).path))
  const dirs = dirsOf(existing)
  return props.children((input, fallback) => {
    const parsed = FileLabel.parse(input)
    const kind = listed.get(parsed.path)
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
