import { Icon } from "../components/icon.js"
import { composeClasses } from "./compose-classes.js"

type SelectionMarkProps = {
  kind: "checkbox" | "radio"
  checked: boolean
  indeterminate?: boolean
  size?: "small" | "medium"
}

export function SelectionMark(props: SelectionMarkProps) {
  const filled = props.checked || props.indeterminate === true
  return (
    <span
      aria-hidden
      data-slot="selection-mark"
      className={composeClasses(
        "flex shrink-0 items-center justify-center border transition-standard",
        props.size === "small" ? "mx-1 size-3.5" : "size-4",
        props.kind === "radio" ? "rounded-full" : "rounded-small",
        filled ? "border-border-strong bg-fill-inverse text-text-inverse" : "border-border-secondary",
      )}
    >
      <Mark kind={props.kind} checked={props.checked} indeterminate={props.indeterminate === true} />
    </span>
  )
}

function Mark(props: { kind: "checkbox" | "radio"; checked: boolean; indeterminate: boolean }) {
  if (props.kind === "radio")
    return props.checked ? <span className="size-2 rounded-full bg-background-primary" /> : null
  if (props.indeterminate) return <Icon glyph="Minus" size="extra-small" />
  return props.checked ? <Icon glyph="Check" size="extra-small" /> : null
}
