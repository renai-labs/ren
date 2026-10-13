import { OTPField } from "@base-ui/react/otp-field"
import { composeClasses } from "../lib/compose-classes.js"
import { controlOutline } from "../lib/control-chrome.js"

const slotClasses = composeClasses(
  controlOutline,
  // oxlint-disable-next-line ren/require-companion-class -- each slot shows focus with focus:inset-ring, so pointer users also see the active slot
  "h-12 w-0 min-w-0 flex-1 text-center text-title font-medium text-text-primary tabular-nums caret-text-primary transition-standard outline-none",
  "focus:inset-ring-accent-primary disabled:cursor-not-allowed disabled:opacity-disabled aria-invalid:inset-ring-status-danger",
)

export type CodeFieldProps = {
  length?: number
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  onValueComplete?: (value: string) => void
  invalid?: boolean
  disabled?: boolean
  readOnly?: boolean
  autoFocus?: boolean
  name?: string
  slotLabel?: string
  "aria-labelledby"?: string
  "aria-describedby"?: string | undefined
}

export function CodeField(props: CodeFieldProps) {
  const length = props.length ?? 6
  return (
    <OTPField.Root
      data-slot="code-field"
      name={props.name}
      length={length}
      value={props.value}
      defaultValue={props.defaultValue}
      disabled={props.disabled}
      readOnly={props.readOnly}
      onValueChange={props.onValueChange}
      onValueComplete={props.onValueComplete}
      className="flex w-full gap-2"
    >
      {Array.from({ length }, (_, index) => (
        <OTPField.Input
          key={index}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- forwards the caller's choice to the first slot
          autoFocus={props.autoFocus === true && index === 0}
          aria-label={index === 0 ? undefined : `${props.slotLabel ?? "Digit"} ${index + 1} of ${length}`}
          aria-labelledby={index === 0 ? props["aria-labelledby"] : undefined}
          aria-describedby={props["aria-describedby"]}
          {...(props.invalid === true ? { "aria-invalid": true } : {})}
          className={slotClasses}
        />
      ))}
    </OTPField.Root>
  )
}
