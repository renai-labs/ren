import { IconCopy, IconFile, IconFolder, IconFolderOpen } from "@tabler/icons-react"
import { cn } from "cn"

import {
  Attachment,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "#components/attachment"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "#components/context-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "#components/tooltip"

function FileChip({
  path,
  line,
  onOpen,
  onCopy,
  className,
}: {
  path: string
  line?: number | undefined
  onOpen?: (() => void) | undefined
  onCopy: () => void
  className?: string | undefined
}) {
  const label = line ? `${path}:${line}` : path
  const Icon = path.endsWith("/") ? IconFolder : IconFile
  return (
    <ContextMenu>
      <Attachment data-slot="file-chip" size="sm" className={className}>
        <AttachmentMedia>
          <Icon />
        </AttachmentMedia>
        <AttachmentContent className="self-center">
          <AttachmentTitle className="font-mono">{path.replace(/\/$/u, "").split("/").at(-1)}</AttachmentTitle>
        </AttachmentContent>
        <Tooltip>
          <ContextMenuTrigger
            render={
              <TooltipTrigger
                delay={500}
                render={
                  <AttachmentTrigger aria-label={label} className={cn(onOpen ? "cursor-pointer" : "cursor-default")} />
                }
              />
            }
            onClick={onOpen}
          />
          <TooltipContent className="max-w-[480px] font-mono break-all">{label}</TooltipContent>
        </Tooltip>
      </Attachment>
      <ContextMenuContent>
        <ContextMenuItem onClick={onCopy}>
          <IconCopy />
          Copy path
        </ContextMenuItem>
        {onOpen ? (
          <ContextMenuItem onClick={onOpen}>
            <IconFolderOpen />
            Open in Files
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}

export { FileChip }
