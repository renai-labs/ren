import { Tooltip } from "@base-ui/react/tooltip"
import type { ReactElement, ReactNode } from "react"
import { cn } from "../../lib/utils.js"

export const TooltipProvider = Tooltip.Provider

function TooltipControl({
  children,
  content,
  align,
  className,
}: {
  children: ReactElement
  content: ReactNode
  align?: "start" | "center"
  className?: string
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner side="top" align={align} sideOffset={4} className="z-50">
          <Tooltip.Popup
            className={cn(
              "w-fit origin-(--transform-origin) rounded-md bg-foreground px-3 py-2 text-xs text-balance text-background transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-95 data-starting-style:opacity-0",
              className,
            )}
          >
            {content}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export { TooltipControl as Tooltip }
