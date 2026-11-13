import { useState } from "react"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { SessionCatalog } from "@ren/schema/session/catalog"
import { IconArrowLeft, IconFile, IconFiles, IconFolder, IconRefresh } from "@tabler/icons-react"
import { Cause } from "effect"
import { AsyncResult } from "effect/reactivity"
import { Button } from "@ren/ui/button"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
  useHighlightedCode,
} from "@ren/ui/code-block"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { cn } from "cn"
import { formatBytes } from "../../lib/format.js"
import { errorStatus } from "../../lib/errors.js"
import { WorkspacePending } from "./workspace-state.js"
import type { PanelRequest } from "./workspace-panel.js"

const highlightLimit = 256 * 1024

const nameOf = (path: string) => path.replace(/\/$/u, "").split("/").at(-1) ?? path

const parentOf = (folder: string) => folder.replace(/[^/]+\/$/u, "")

function Folder(props: {
  root: Session.ID
  folder: string
  selected: string | undefined
  onFolder: (folder: string) => void
  onFile: (path: string) => void
}) {
  const listed = ChatReact.useFolder({ root: props.root, path: props.folder })
  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-1 pr-1.5 pl-3 text-xs text-muted-foreground">
        {props.folder ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open the parent folder"
            className="-ml-1.5 text-muted-foreground"
            onClick={() => props.onFolder(parentOf(props.folder))}
          >
            <IconArrowLeft />
          </Button>
        ) : null}
        <span className="min-w-0 flex-1 truncate font-mono" title={props.folder || "/"}>
          {props.folder || "/"}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh files"
          className="text-muted-foreground"
          onClick={listed.refresh}
        >
          <IconRefresh />
        </Button>
      </div>
      {AsyncResult.isSuccess(listed.result) ? (
        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2">
          {listed.result.value.map((entry: SessionCatalog.File) => (
            <li key={entry.path}>
              <Button
                variant="ghost"
                size="sm"
                aria-current={entry.path === props.selected || undefined}
                onClick={() => (entry.type === "directory" ? props.onFolder(entry.path) : props.onFile(entry.path))}
                className={cn(
                  "w-full justify-start font-normal aria-current:bg-secondary",
                  entry.type === "directory" ? "text-foreground" : "text-muted-foreground aria-current:text-foreground",
                )}
              >
                {entry.type === "directory" ? (
                  <IconFolder data-icon="inline-start" />
                ) : (
                  <IconFile data-icon="inline-start" />
                )}
                <span className="min-w-0 truncate">{nameOf(entry.path)}</span>
              </Button>
            </li>
          ))}
          {listed.result.value.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">This folder is empty</li>
          ) : null}
        </ul>
      ) : (
        <WorkspacePending
          result={listed.result}
          icon={<IconFiles />}
          title="Could not list the files"
          onRetry={listed.refresh}
        />
      )}
    </>
  )
}

function TextFile(props: { file: SessionCatalog.FileContent }) {
  const lines = useHighlightedCode(
    props.file.content,
    props.file.size > highlightLimit ? "" : (props.file.path.split(".").at(-1) ?? ""),
  )
  return (
    <CodeBlockContent lineNumbers className="min-h-0 flex-1 rounded-none">
      {lines.map((line, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- a line's position is its identity in highlighted code
        <CodeBlockLine key={index}>{line}</CodeBlockLine>
      ))}
    </CodeBlockContent>
  )
}

function Preview(props: { file: SessionCatalog.FileContent }) {
  if (props.file.encoding === "utf8") return <TextFile file={props.file} />
  if (props.file.mime.startsWith("image/") && !props.file.truncated)
    return (
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto overscroll-contain p-4">
        <img
          src={`data:${props.file.mime};base64,${props.file.content}`}
          alt={nameOf(props.file.path)}
          className="max-w-full rounded-md border bg-muted object-contain"
        />
      </div>
    )
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia className="text-muted-foreground [&_svg]:size-6">
          <IconFile />
        </EmptyMedia>
        <EmptyTitle>No preview</EmptyTitle>
        <EmptyDescription>This file is not text ({props.file.mime}).</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function OpenFile(props: { root: Session.ID; path: string }) {
  const read = ChatReact.useFile({ root: props.root, path: props.path })
  if (AsyncResult.isFailure(read.result) && errorStatus(Cause.squash(read.result.cause)) === 404)
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyDescription>No file at {props.path}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  if (!AsyncResult.isSuccess(read.result))
    return (
      <WorkspacePending
        result={read.result}
        icon={<IconFile />}
        title="Could not open the file"
        onRetry={read.refresh}
      />
    )
  const file = read.result.value
  return (
    <CodeBlock size="sm" className="min-h-0 flex-1 rounded-none border-0 dark:bg-transparent">
      <CodeBlockHeader className="h-9 pt-0">
        <CodeBlockTitle className="font-mono" title={file.path}>
          {file.path}
        </CodeBlockTitle>
        <span className="shrink-0 text-xs tabular-nums">
          {file.truncated ? `${formatBytes(file.size)}, showing the start` : formatBytes(file.size)}
        </span>
        <CodeBlockActions>
          {file.encoding === "utf8" ? <CodeBlockCopyButton value={file.content} /> : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Reload the file"
            className="text-muted-foreground"
            onClick={read.refresh}
          >
            <IconRefresh />
          </Button>
        </CodeBlockActions>
      </CodeBlockHeader>
      <Preview file={file} />
    </CodeBlock>
  )
}

export function FilesTab(props: { root: Session.ID; request: Extract<PanelRequest, { kind: "files" }> | undefined }) {
  const [folder, setFolder] = useState("")
  const [opened, setOpened] = useState<string>()
  const [handled, setHandled] = useState<string>()
  if (props.request && props.request.id !== handled) {
    const path = props.request.path.trim().replace(/^\/+/u, "")
    setHandled(props.request.id)
    setOpened(path || undefined)
    setFolder(path.replace(/[^/]+$/u, ""))
  }
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-56 shrink-0 flex-col border-r">
        <Folder root={props.root} folder={folder} selected={opened} onFolder={setFolder} onFile={setOpened} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {opened ? (
          <OpenFile root={props.root} path={opened} />
        ) : (
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyMedia className="text-muted-foreground [&_svg]:size-6">
                <IconFiles />
              </EmptyMedia>
              <EmptyTitle>Files</EmptyTitle>
              <EmptyDescription>Open a file from this chat’s environment to read it here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  )
}
