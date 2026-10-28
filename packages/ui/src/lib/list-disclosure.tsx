import { Collapsible } from "@base-ui/react/collapsible"
import type { ReactNode } from "react"
import { composeClasses } from "./compose-classes.js"

export type DisclosureState = {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  locked?: boolean
  disabled?: boolean
}

export function DisclosureRoot(props: DisclosureState & { entrance?: "none" | "animated"; children: ReactNode }) {
  return (
    <Collapsible.Root
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- List.Root and the rows are divs, so a disclosure row cannot be an <li>
      role="listitem"
      open={props.open}
      defaultOpen={props.defaultOpen}
      onOpenChange={(next) => {
        if (props.locked !== true) props.onOpenChange?.(next)
      }}
      disabled={props.disabled === true || props.locked === true}
      className={composeClasses("flex min-w-0 flex-col", props.entrance === "animated" && "animate-entrance")}
    >
      {props.children}
    </Collapsible.Root>
  )
}
