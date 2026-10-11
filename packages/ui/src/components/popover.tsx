export * as Popover from "./popover.js"

import { Popover } from "@base-ui/react/popover"
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

export type Placement = "top" | "right" | "bottom"
export type Alignment = "start" | "end"
export type Padding = "small" | "medium" | "large"

export type RootProps = {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}

export function Root(props: RootProps) {
  return (
    <Popover.Root open={props.open} defaultOpen={props.defaultOpen} onOpenChange={(next) => props.onOpenChange?.(next)}>
      {props.children}
    </Popover.Root>
  )
}

export function Trigger(props: { render: ReactElement }) {
  return <Popover.Trigger render={props.render} />
}

export type ContentProps = {
  placement?: Placement
  alignment?: Alignment
  padding?: Padding
  label?: string
  children: ReactNode
}

export function Content(props: ContentProps) {
  return (
    <Popover.Portal>
      <Popover.Positioner
        data-ren-layer=""
        side={props.placement ?? "bottom"}
        align={props.alignment ?? "start"}
        sideOffset={4}
        collisionPadding={8}
        collisionAvoidance={{ align: "shift" }}
        className="z-50"
      >
        <Popover.Popup
          data-slot="popover"
          aria-label={props.label}
          className={composeClasses(popupVariants({ padding: props.padding }))}
        >
          {props.children}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  )
}

export function Close(props: { render: ReactElement }) {
  return <Popover.Close render={props.render} />
}
