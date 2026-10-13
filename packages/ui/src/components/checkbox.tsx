import { Checkbox } from "@base-ui/react/checkbox"
import { useId } from "react"
import type { ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { revealOnContainerHover } from "../lib/control-chrome.js"
import { SelectionMark } from "../lib/selection-mark.js"

export type CheckboxProps = {
  checked?: boolean
  indeterminate?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean | undefined
  label?: string
  labelVisibility?: "assistive" | "visible"
  description?: ReactNode
  id?: string
  size?: "small" | "medium" | undefined
  visibility?: "always" | "on-container-hover"
}

function CheckboxControl(props: CheckboxProps) {
  const id = useId()
  const visible = props.labelVisibility === "visible"
  const size = props.size ?? "medium"
  const box = (
    <Checkbox.Root
      id={props.id}
      checked={props.checked}
      indeterminate={props.indeterminate}
      onCheckedChange={(next) => props.onCheckedChange?.(next)}
      disabled={props.disabled}
      aria-label={visible ? undefined : props.label}
      aria-labelledby={visible ? `${id}-label` : undefined}
      aria-describedby={visible && props.description ? `${id}-description` : undefined}
      data-slot="checkbox"
      className={composeClasses(
        "inline-grid shrink-0 rounded-small bg-background-secondary transition-standard data-disabled:opacity-disabled",
        size === "small" ? "mx-1 size-3.5" : "size-4",
        props.visibility === "on-container-hover" && revealOnContainerHover,
      )}
      render={(rootProps, state) => (
        <span {...rootProps}>
          <SelectionMark kind="checkbox" checked={state.checked} indeterminate={state.indeterminate} size={size} />
        </span>
      )}
    />
  )
  if (!visible) return box
  return (
    <label className="flex cursor-default items-start gap-2 text-sm">
      <span className="flex h-lh shrink-0 items-center">{box}</span>
      <span className={composeClasses("flex min-w-0 flex-col gap-1", props.disabled === true && "opacity-disabled")}>
        <span id={`${id}-label`} className="text-text-primary">
          {props.label}
        </span>
        {props.description ? (
          <span id={`${id}-description`} className="text-xs text-text-secondary">
            {props.description}
          </span>
        ) : null}
      </span>
    </label>
  )
}

export { CheckboxControl as Checkbox }
