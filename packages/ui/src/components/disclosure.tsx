import { Collapsible } from "@base-ui/react/collapsible"
import type { ReactNode } from "react"
import { Icon } from "./icon.js"
import { Text } from "./text.js"

export function Disclosure(props: { summary: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <Collapsible.Root data-slot="disclosure" defaultOpen={props.defaultOpen ?? false} className="flex min-w-0 flex-col">
      <Collapsible.Trigger className="group/disclosure -mx-1 flex items-center gap-1 self-start rounded-control px-1 py-0.5 text-start text-text-secondary transition-standard outline-none hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-primary">
        <span className="flex shrink-0 transition-standard group-data-panel-open/disclosure:rotate-90 motion-reduce:transition-none">
          <Icon glyph="ChevronRight" size="extra-small" />
        </span>
        <Text purpose="body" tone="inherit" element="span">
          {props.summary}
        </Text>
      </Collapsible.Trigger>
      <Collapsible.Panel className="h-(--collapsible-panel-height) overflow-hidden transition-standard data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none">
        <div className="flex min-w-0 flex-col gap-3 pt-3">{props.children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
