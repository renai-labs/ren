import { Toggle } from "@base-ui/react/toggle"
import { ToggleGroup } from "@base-ui/react/toggle-group"
import { cva } from "class-variance-authority"
import type { ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { Tooltip } from "./tooltip.js"

export type SegmentedControlOption<Value extends string> = {
  value: Value
  label: ReactNode
  disabled?: boolean
  description?: string
}

const segmentVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-control px-2 font-medium whitespace-nowrap text-text-secondary transition-standard not-data-pressed:hover:text-text-primary data-disabled:pointer-events-none data-disabled:opacity-disabled data-pressed:bg-fill-secondary data-pressed:text-text-primary [&_svg]:size-4",
  {
    variants: { size: { small: "h-6 text-xs", medium: "h-7 text-sm" } },
    defaultVariants: { size: "medium" },
  },
)

const groupVariants = cva("shrink-0 gap-1 rounded-control bg-fill-primary p-1", {
  variants: { width: { content: "inline-grid", full: "grid w-full" } },
  defaultVariants: { width: "content" },
})

export type SegmentedControlProps<Value extends string> = {
  value: Value
  onValueChange: (value: Value) => void
  options: readonly SegmentedControlOption<Value>[]
  label: string
  size?: "small" | "medium" | undefined
  width?: "content" | "full" | undefined
}

export function SegmentedControl<Value extends string>(props: SegmentedControlProps<Value>) {
  return (
    <ToggleGroup<Value>
      value={[props.value]}
      onValueChange={(next) => {
        const selected = next.at(-1)
        if (selected) props.onValueChange(selected)
      }}
      aria-label={props.label}
      data-slot="segmented-control"
      className={composeClasses(groupVariants({ width: props.width }))}
      style={{ gridTemplateColumns: `repeat(${props.options.length}, minmax(0, 1fr))` }}
    >
      {props.options.map((option) => (
        <Tooltip.Root key={option.value} content={option.description}>
          <Toggle<Value>
            value={option.value}
            disabled={option.disabled}
            className={composeClasses(segmentVariants({ size: props.size }))}
          >
            {option.label}
          </Toggle>
        </Tooltip.Root>
      ))}
    </ToggleGroup>
  )
}
