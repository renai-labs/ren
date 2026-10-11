import { useRender } from "@base-ui/react/use-render"
import { composeClasses } from "../lib/compose-classes.js"

export type SeparatorProps = { orientation?: "horizontal"; label?: string } | { orientation: "vertical" }

export function Separator(props: SeparatorProps) {
  const orientation = props.orientation ?? "horizontal"
  const label = props.orientation === "vertical" ? undefined : props.label
  const rule = useRender({
    defaultTagName: "div",
    state: { orientation },
    props: {
      role: "separator",
      "aria-orientation": orientation,
      "data-slot": "separator",
      className: composeClasses(
        "shrink-0 border-border-primary",
        orientation === "horizontal" ? "w-full border-t" : "h-full self-stretch border-l",
        label === undefined ? "" : "min-w-0 flex-1",
      ),
    },
  })
  if (label === undefined) return rule
  return (
    <div data-slot="labeled-separator" className="flex w-full items-center gap-3">
      {rule}
      <span className="shrink-0 text-xs font-medium tracking-normal text-text-secondary uppercase">{label}</span>
      <span aria-hidden="true" className="min-w-0 flex-1 border-t border-border-primary" />
    </div>
  )
}
