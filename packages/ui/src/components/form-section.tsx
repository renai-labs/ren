import { Collapsible } from "@base-ui/react/collapsible"
import type { ReactNode } from "react"
import { Icon } from "./icon.js"
import { Text } from "./text.js"

export function FormSection(props: {
  title: ReactNode
  description?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <Collapsible.Root
      data-slot="form-section"
      open={props.open}
      onOpenChange={props.onOpenChange}
      className="flex flex-col border-t border-border-primary pt-4"
    >
      <Collapsible.Trigger className="group/disclosure -mx-2 flex items-center justify-between gap-4 rounded-control px-2 py-1 transition-standard outline-none hover:bg-fill-primary focus-visible:outline-2 focus-visible:outline-accent-primary">
        <span className="flex min-w-0 flex-col gap-1 text-start">
          <Text purpose="label" element="span">
            {props.title}
          </Text>
          {props.description === undefined ? null : (
            <Text purpose="caption" element="span" truncation="single-line">
              {props.description}
            </Text>
          )}
        </span>
        <span className="flex shrink-0 text-text-secondary transition-standard group-data-panel-open/disclosure:rotate-180">
          <Icon glyph="ChevronDown" />
        </span>
      </Collapsible.Trigger>
      <Collapsible.Panel className="flex flex-col gap-4 overflow-hidden pt-4 transition-standard data-ending-style:h-0 data-starting-style:h-0">
        {props.children}
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
