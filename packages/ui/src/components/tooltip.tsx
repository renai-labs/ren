export * as Tooltip from "./tooltip.js"

import { Tooltip } from "@base-ui/react/tooltip"
import type { ReactElement, ReactNode } from "react"

export function Provider(props: { children: ReactNode }) {
  return <Tooltip.Provider delay={500}>{props.children}</Tooltip.Provider>
}

export type RootProps = {
  content: ReactNode
  placement?: "top" | "right" | "bottom"
  alignment?: "start" | "center"
  delay?: number
  open?: boolean
  children: ReactElement
}

export function Root(props: RootProps) {
  if (props.content === null || props.content === undefined || props.content === "") return props.children
  return (
    <Tooltip.Root open={props.open}>
      <Tooltip.Trigger delay={props.delay} render={props.children} />
      <Tooltip.Portal>
        <Tooltip.Positioner
          data-ren-layer=""
          side={props.placement ?? "top"}
          align={props.alignment ?? "center"}
          sideOffset={4}
          className="z-50"
        >
          <Tooltip.Popup
            data-slot="tooltip"
            className="max-w-64 origin-(--transform-origin) rounded-control bg-fill-inverse px-2 py-1 text-xs text-balance text-text-inverse transition-standard data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-95 data-starting-style:opacity-0"
          >
            {props.content}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
