import { IconFile, IconFolder } from "@tabler/icons-react"
import { cn } from "cn"
import { Badge } from "#components/badge"

export interface FileChipProps {
  readonly path: string
  readonly name: string
  readonly line?: number | undefined
  readonly dir?: string | undefined
  readonly folder?: boolean | undefined
  readonly onOpen?: ((path: string, line: number | undefined) => void) | undefined
  readonly className?: string | undefined
}

function FileChip(props: FileChipProps) {
  const dot = props.folder ? -1 : props.name.lastIndexOf(".")
  const stem = dot > 0 ? props.name.slice(0, dot) : props.name
  const extension = dot > 0 ? props.name.slice(dot) : ""
  const Icon = props.folder ? IconFolder : IconFile
  const onOpen = props.onOpen
  return (
    <Badge
      variant="secondary"
      data-path={props.path}
      title={props.path}
      className={cn("h-[1.25em] max-w-64 min-w-0 gap-1 px-1.5 align-text-bottom font-normal", props.className)}
      render={
        onOpen ? (
          <button
            type="button"
            aria-label={props.path}
            onClick={() => onOpen(props.path, props.line)}
            className="cursor-pointer"
          />
        ) : undefined
      }
    >
      <Icon aria-hidden className="text-muted-foreground" />
      <span aria-hidden className="flex min-w-0 select-none">
        <span className="truncate">{stem}</span>
        {extension ? <span className="shrink-0">{extension}</span> : null}
        {props.line === undefined ? null : <span className="shrink-0">:{props.line}</span>}
        {props.dir ? <span className="ml-1.5 shrink-0 text-muted-foreground">{props.dir}</span> : null}
      </span>
      <span className="sr-only">{props.line === undefined ? props.path : `${props.path}:${props.line}`}</span>
    </Badge>
  )
}

export { FileChip }
