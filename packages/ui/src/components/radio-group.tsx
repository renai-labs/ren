export * as RadioGroup from "./radio-group.js"

import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import { useId } from "react"
import type { ReactNode } from "react"

export type RootProps<Value extends string> = {
  value?: Value
  onValueChange?: (value: Value) => void
  label?: string
  children: ReactNode
}

export function Root<Value extends string>(props: RootProps<Value>) {
  return (
    <RadioGroup<Value>
      value={props.value}
      onValueChange={(next) => props.onValueChange?.(next)}
      aria-label={props.label}
      data-slot="radio-group"
      className="grid grid-cols-2 gap-2"
    >
      {props.children}
    </RadioGroup>
  )
}

export type ItemProps = {
  value: string
  label: ReactNode
  description?: ReactNode
}

export function Item(props: ItemProps) {
  const id = useId()
  return (
    <label className="flex cursor-default items-start gap-3 rounded-container bg-background-secondary p-3 text-sm inset-ring-1 inset-ring-border-primary transition-standard hover:bg-fill-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent-primary data-checked:inset-ring-border-strong">
      <span className="flex h-lh shrink-0 items-center">
        <Radio.Root
          value={props.value}
          aria-labelledby={`${id}-label`}
          aria-describedby={props.description ? `${id}-description` : undefined}
          // oxlint-disable-next-line ren/require-companion-class -- the enclosing label draws the ring with has-focus-visible
          className="inline-grid size-4 shrink-0 place-items-center rounded-full bg-background-secondary inset-ring-1 inset-ring-border-secondary outline-none data-checked:inset-ring-border-strong"
        >
          <Radio.Indicator className="size-2 rounded-full bg-fill-inverse" />
        </Radio.Root>
      </span>
      <span className="flex min-w-0 flex-col gap-1">
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
