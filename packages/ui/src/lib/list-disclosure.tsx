import { Collapsible } from "@base-ui/react/collapsible"
import type { ReactNode } from "react"
import { Icon } from "../components/icon.js"
import { Text } from "../components/text.js"
import { composeClasses } from "./compose-classes.js"
import { itemVariants, leadingSlot } from "./list-chrome.js"
import type { ListDensity } from "./list-chrome.js"

export type DisclosureState = {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  locked?: boolean
  disabled?: boolean
}

export type DisclosureItemProps = DisclosureState & {
  density?: ListDensity
  leading?: ReactNode
  title: ReactNode
  description?: ReactNode
  trailing?: ReactNode
  label?: string
  children?: ReactNode
}

export function DisclosureRoot(props: DisclosureState & { children: ReactNode }) {
  return (
    <Collapsible.Root
      open={props.open}
      defaultOpen={props.defaultOpen}
      onOpenChange={(next) => {
        if (props.locked !== true) props.onOpenChange?.(next)
      }}
      disabled={props.disabled === true || props.locked === true}
      className="flex min-w-0 flex-col"
    >
      {props.children}
    </Collapsible.Root>
  )
}

export function DisclosureItem(props: DisclosureItemProps) {
  const disabled = props.disabled === true
  return (
    <DisclosureRoot {...props}>
      <Collapsible.Trigger
        aria-label={props.label}
        className={composeClasses(
          itemVariants({ density: props.density ?? "compact", interactive: !disabled }),
          "group/disclosure",
        )}
      >
        {props.leading === undefined ? null : <span className={leadingSlot}>{props.leading}</span>}
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="min-w-0 shrink-0 truncate">{props.title}</span>
          {props.description === undefined ? null : (
            <Text purpose="caption" element="span" truncation="single-line">
              {props.description}
            </Text>
          )}
        </span>
        {props.trailing === undefined ? null : (
          <span className="flex shrink-0 items-center gap-2 text-xs text-text-secondary">{props.trailing}</span>
        )}
        {disabled || props.locked === true ? null : (
          <span className="flex shrink-0 text-text-secondary transition-standard group-data-panel-open/disclosure:rotate-90 motion-reduce:transition-none">
            <Icon glyph="ChevronRight" />
          </span>
        )}
      </Collapsible.Trigger>
      <Collapsible.Panel className="ml-3 flex min-w-0 flex-col gap-1 border-l border-border-primary py-1 pl-3">
        {props.children}
      </Collapsible.Panel>
    </DisclosureRoot>
  )
}
