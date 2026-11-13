import type { ReactNode } from "react"
import { IconCopy, IconFolderOpen } from "@tabler/icons-react"
import { cn } from "cn"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "#components/context-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "#components/tooltip"

function FileChip({
  path,
  children,
  onOpen,
  onCopy,
  className,
}: {
  path: string
  children: ReactNode
  onOpen?: (() => void) | undefined
  onCopy?: (() => void) | undefined
  className?: string | undefined
}) {
  return (
    <ContextMenu>
      <Tooltip>
        <ContextMenuTrigger
          render={
            <TooltipTrigger
              delay={500}
              render={
                <button
                  type="button"
                  data-slot="file-chip"
                  aria-label={path}
                  disabled={!onOpen && !onCopy}
                  onClick={onOpen}
                  className={cn(
                    "rounded-sm font-mono underline decoration-muted-foreground/60 decoration-dotted underline-offset-2 outline-none hover:decoration-solid focus-visible:ring-2 focus-visible:ring-ring/50 enabled:cursor-pointer",
                    className,
                  )}
                />
              }
            />
          }
        >
          {children}
        </ContextMenuTrigger>
        <TooltipContent className="max-w-[480px] font-mono break-all">{path}</TooltipContent>
      </Tooltip>
      <ContextMenuContent>
        {onCopy ? (
          <ContextMenuItem onClick={onCopy}>
            <IconCopy />
            Copy path
          </ContextMenuItem>
        ) : null}
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
