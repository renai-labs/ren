import { useRef, useState, type ComponentProps } from "react"
import type { ExtraProps } from "streamdown"
import { IconCopy, IconExternalLink } from "@tabler/icons-react"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@ren/ui/context-menu"
import { Link } from "@ren/ui/link"
import { toast } from "@ren/ui/sonner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { errorMessage } from "../lib/errors.js"
import { Platform } from "../platform/platform.js"

export function MarkdownLink({ node: _node, href, children, className, ...rest }: ComponentProps<"a"> & ExtraProps) {
  const platform = Platform.usePlatform()
  const [menuOpen, setMenuOpen] = useState(false)
  const [tipOpen, setTipOpen] = useState(false)
  const anchor = useRef<HTMLAnchorElement>(null)
  if (!href)
    return (
      <Link className={className} {...rest}>
        {children}
      </Link>
    )
  const copy = (value: string, message: string) =>
    void platform.writeClipboardText?.(value).then(
      () => toast.success(message),
      (error: unknown) => toast.error("Could not copy", { description: errorMessage(error) }),
    )
  return (
    <ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <Tooltip open={tipOpen && !menuOpen} onOpenChange={setTipOpen}>
        <TooltipTrigger
          render={
            <ContextMenuTrigger
              render={<Link ref={anchor} href={href} external className={className} {...rest} />}
              onContextMenu={(event) => {
                if (event.button !== 2 || !event.shiftKey) return
                event.nativeEvent.stopPropagation()
                event.preventBaseUIHandler()
              }}
            />
          }
        >
          {children}
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={10} arrow={false} className="max-w-90 break-all">
          {href}
        </TooltipContent>
      </Tooltip>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => platform.openExternal(href)}>
          <IconExternalLink />
          Open link
        </ContextMenuItem>
        {platform.writeClipboardText ? (
          <>
            <ContextMenuItem onClick={() => copy(href, "Link copied")}>
              <IconCopy />
              Copy link
            </ContextMenuItem>
            <ContextMenuItem onClick={() => copy(anchor.current?.textContent ?? "", "Link text copied")}>
              Copy link text
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  )
}
