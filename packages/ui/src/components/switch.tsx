import { Switch } from "@base-ui/react/switch"
import { cva } from "class-variance-authority"
import { composeClasses } from "../lib/compose-classes.js"

const switchVariants = cva(
  "relative inline-flex shrink-0 items-center rounded-full bg-fill-secondary transition-standard data-checked:bg-fill-inverse data-disabled:opacity-disabled",
  { variants: { size: { small: "h-4 w-7", medium: "h-4.5 w-8" } }, defaultVariants: { size: "medium" } },
)

const thumbVariants = cva("block rounded-full bg-fill-inverse transition-standard data-checked:bg-background-primary", {
  variants: {
    size: {
      small: "size-3 translate-x-0.5 data-checked:translate-x-3.5",
      medium: "size-4 translate-x-px data-checked:translate-x-3.75",
    },
  },
  defaultVariants: { size: "medium" },
})

export type SwitchProps = {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean | undefined
  size?: "small" | "medium" | undefined
  label?: string
  id?: string
}

function SwitchControl(props: SwitchProps) {
  return (
    <Switch.Root
      id={props.id}
      checked={props.checked}
      onCheckedChange={(next) => props.onCheckedChange?.(next)}
      disabled={props.disabled}
      aria-label={props.label}
      data-slot="switch"
      // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- Switch.Root renders this button with its aria-label
      render={<button type="button" />}
      nativeButton
      className={composeClasses(switchVariants({ size: props.size }))}
    >
      <Switch.Thumb className={thumbVariants({ size: props.size })} />
    </Switch.Root>
  )
}

export { SwitchControl as Switch }
