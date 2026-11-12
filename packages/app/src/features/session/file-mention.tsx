import type { ReactNode } from "react"
import { FileLabel } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import { AsyncResult } from "effect/reactivity"
import { FileChip } from "@ren/ui/file-chip"
import { dirsOf, isPath } from "./file-paths.js"

export function WorkspaceFileChip(props: {
  root: Session.ID
  input: string
  dirs: ReadonlyMap<string, string | undefined>
  fallback: ReactNode
}) {
  const parsed = FileLabel.parse(props.input)
  const listed = ChatReact.useFolder({
    root: props.root,
    path: parsed.path.includes("/") ? `${parsed.path.slice(0, parsed.path.lastIndexOf("/"))}/` : "",
  })
  const entry = AsyncResult.isSuccess(listed.result)
    ? listed.result.value.find((each) => stripSlash(each.path) === parsed.path)
    : undefined
  if (!entry) return props.fallback
  return (
    <FileChip
      path={parsed.path}
      name={parsed.name}
      line={entry.type === "directory" ? undefined : parsed.line}
      dir={props.dirs.get(parsed.path)}
      folder={entry.type === "directory"}
    />
  )
}

const stripSlash = (path: string) => path.replace(/\/$/u, "")

const mention = /(^|\s)@(\S+)/gu

export function FileMentions(props: { text: string; root: Session.ID; plain: (text: string) => ReactNode }) {
  const text = props.text
  const plain = props.plain
  const root = props.root
  const found = [...text.matchAll(mention)].flatMap((match) => {
    const input = (match[2] ?? "").replace(/[.,;:!?)]+$/u, "")
    return isPath(input) ? [{ input, start: match.index + (match[1] ?? "").length }] : []
  })
  if (found.length === 0) return <>{plain(text)}</>
  const dirs = dirsOf(found.map((item) => item.input))
  const built = found.reduce<{ from: number; nodes: ReadonlyArray<ReactNode> }>(
    (all, item) => {
      const end = item.start + item.input.length + 1
      return {
        from: end,
        nodes: [
          ...all.nodes,
          <span key={`t${item.start}`}>{plain(text.slice(all.from, item.start))}</span>,
          <WorkspaceFileChip
            key={`f${item.start}`}
            root={root}
            input={item.input}
            dirs={dirs}
            fallback={text.slice(item.start, end)}
          />,
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
}
