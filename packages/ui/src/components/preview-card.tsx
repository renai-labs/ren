export * as PreviewCard from "./preview-card.js"

import { PreviewCard } from "@base-ui/react/preview-card"
import { cva } from "class-variance-authority"
import type { ReactElement, ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { popupSurface } from "../lib/control-chrome.js"

const popupVariants = cva(
  composeClasses(
    popupSurface,
    "max-h-(--available-height) w-72 max-w-[calc(100vw-var(--ren-spacing-8))] overflow-y-auto overscroll-contain",
  ),
  {
    variants: { padding: { small: "p-1", medium: "p-3", large: "p-4" } },
    defaultVariants: { padding: "medium" },
  },
)

export type RootProps = {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: ((open: boolean) => void) | undefined
  children: ReactNode
}

export function Root(props: RootProps) {
  return (
    <PreviewCard.Root
      open={props.open}
      defaultOpen={props.defaultOpen}
      onOpenChange={(next) => props.onOpenChange?.(next)}
    >
      {props.children}
    </PreviewCard.Root>
  )
}

export function Trigger(props: { render: ReactElement }) {
  return <PreviewCard.Trigger render={props.render} />
}

export type ContentProps = {
  placement?: "top" | "right" | "bottom"
  alignment?: "start" | "end"
  padding?: "small" | "medium" | "large"
  children: ReactNode
}

export function Content(props: ContentProps) {
  return (
    <PreviewCard.Portal>
      <PreviewCard.Positioner
        data-ren-layer=""
        side={props.placement ?? "bottom"}
        align={props.alignment ?? "start"}
        sideOffset={8}
        className="z-50"
      >
        <PreviewCard.Popup data-slot="popover" className={composeClasses(popupVariants({ padding: props.padding }))}>
          {props.children}
        </PreviewCard.Popup>
      </PreviewCard.Positioner>
    </PreviewCard.Portal>
  )
}
