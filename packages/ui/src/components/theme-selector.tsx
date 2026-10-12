import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import { useState } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { Button } from "./button.js"
import { Text } from "./text.js"
import type { Theme } from "./theme.js"

type Preference = Theme.Preference

const primary: ReadonlyArray<{ value: Preference; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]
const additional: ReadonlyArray<{ value: Preference; label: string }> = [{ value: "girliepop", label: "Girliepop" }]

const isPreference = (value: unknown): value is Preference =>
  value === "system" || value === "light" || value === "dark" || value === "girliepop"

function Preview(props: { theme: Exclude<Preference, "system"> }) {
  return (
    <span
      aria-hidden
      data-theme-preview={props.theme}
      className={composeClasses(props.theme, "absolute inset-0 flex flex-col items-center bg-background-primary pt-4")}
    >
      <span className="h-2 w-2/5 rounded-full border-4 border-border-secondary" />
      <span className="mt-1 h-1 w-3/5 rounded-full border-2 border-border-primary" />
      <span className="mt-3 flex w-4/5 flex-1 flex-col divide-y divide-border-primary rounded-t-container bg-background-secondary">
        {[0, 1, 2].map((row) => (
          <span key={row} className="flex flex-col gap-1 p-2">
            <span className="h-1 w-1/3 rounded-full border-2 border-border-secondary" />
            <span className="h-1 w-1/2 rounded-full border-2 border-border-primary" />
          </span>
        ))}
      </span>
    </span>
  )
}

export function ThemeSelector(props: { value: Preference; onValueChange: (value: Preference) => void }) {
  const additionalSelected = additional.some((option) => option.value === props.value)
  const [expanded, setExpanded] = useState(additionalSelected)
  const options = expanded || additionalSelected ? [...primary, ...additional] : primary
  return (
    <div data-slot="theme-selector" className="flex flex-col gap-3">
      <RadioGroup
        aria-label="Theme"
        value={props.value}
        onValueChange={(next) => {
          if (isPreference(next)) props.onValueChange(next)
        }}
        className="grid grid-cols-3 gap-3"
      >
        {options.map((option) => (
          // oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the label wraps its Base UI radio
          <label key={option.value} className="group/theme flex cursor-pointer flex-col items-center gap-2">
            <Radio.Root
              value={option.value}
              className="relative block aspect-16/9 w-full overflow-hidden rounded-container border border-border-primary transition-standard outline-none group-hover/theme:border-border-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary data-checked:border-border-strong data-checked:ring-1 data-checked:ring-border-strong"
            >
              {option.value === "system" ? (
                <span className="absolute inset-0 grid grid-cols-2">
                  <span className="relative overflow-hidden">
                    <Preview theme="light" />
                  </span>
                  <span className="relative overflow-hidden">
                    <Preview theme="dark" />
                  </span>
                </span>
              ) : (
                <Preview theme={option.value} />
              )}
            </Radio.Root>
            <Text
              element="span"
              tone={option.value === props.value ? "primary" : "secondary"}
              weight={option.value === props.value ? "medium" : "regular"}
            >
              {option.label}
            </Text>
          </label>
        ))}
      </RadioGroup>
      {additionalSelected ? null : (
        <Button appearance="link" size="small" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
          {expanded ? "Show less" : "Show more"}
        </Button>
      )}
    </div>
  )
}
