import { Autocomplete } from "@base-ui/react/autocomplete"
import { Input } from "@base-ui/react/input"
import { cva } from "class-variance-authority"
import type { ComponentPropsWithoutRef, ReactNode, Ref } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { controlOutline, controlSize } from "../lib/control-chrome.js"

export type TextFieldSize = "small" | "compact" | "medium" | "large"
export type TextFieldAppearance = "outline" | "filled"
export type TextFieldWidth = "full" | "fill" | "compact"
type TextFieldTypeface = "sans" | "mono"

const fieldSurfaceVariants = cva(
  "group/text-field flex min-w-0 items-center gap-2 transition-standard has-[input:disabled]:opacity-disabled has-[textarea:disabled]:opacity-disabled [&_svg]:size-4",
  {
    variants: {
      appearance: {
        outline: `${controlOutline} focus-within:inset-ring-accent-primary has-aria-invalid:inset-ring-status-danger`,
        filled:
          "rounded-control bg-fill-primary inset-ring-1 inset-ring-transparent focus-within:inset-ring-accent-primary hover:bg-fill-secondary has-aria-invalid:inset-ring-status-danger",
      },
      width: { full: "w-full", fill: "min-w-0 flex-1", compact: "w-52" },
      size: controlSize,
    },
    defaultVariants: { appearance: "outline", width: "full", size: "medium" },
  },
)

const inputVariants = cva(
  // oxlint-disable-next-line ren/require-companion-class -- the surface draws the focus ring with focus-within
  "size-full min-w-0 flex-1 bg-transparent placeholder-muted text-text-primary outline-none disabled:cursor-not-allowed max-sm:text-base [&::-webkit-search-cancel-button]:appearance-none",
  { variants: { typeface: { sans: "", mono: "font-mono" } }, defaultVariants: { typeface: "sans" } },
)

export type TextFieldProps = {
  type?: "text" | "email" | "password" | "search" | "url" | "number" | "tel"
  size?: TextFieldSize
  appearance?: TextFieldAppearance
  typeface?: TextFieldTypeface
  width?: TextFieldWidth
  leading?: ReactNode
  trailing?: ReactNode
  invalid?: boolean
  suggestions?: readonly string[]
  onSuggestionSelect?: (suggestion: string) => void
  ref?: Ref<HTMLInputElement>
} & Omit<ComponentPropsWithoutRef<"input">, "className" | "style" | "size" | "type">

export function TextField(props: TextFieldProps) {
  const {
    size,
    appearance,
    typeface,
    width,
    leading,
    trailing,
    invalid,
    suggestions,
    onSuggestionSelect,
    "aria-invalid": ariaInvalid,
    ...rest
  } = props
  const input = {
    "data-slot": "text-field-input",
    "aria-invalid": invalid === true || ariaInvalid === true || ariaInvalid === "true" || undefined,
    className: composeClasses(inputVariants({ typeface })),
    ...rest,
  }
  const surface = { appearance, size, width, leading, trailing }
  if (suggestions === undefined) {
    return (
      <Surface {...surface}>
        <Input {...input} />
      </Surface>
    )
  }
  return (
    <Autocomplete.Root
      items={suggestions}
      value={typeof rest.value === "string" ? rest.value : undefined}
      onValueChange={(next, details) => {
        if (details.reason === "item-press" || details.reason === "list-navigation") onSuggestionSelect?.(next)
      }}
    >
      <Surface {...surface}>
        <Autocomplete.Input {...input} />
      </Surface>
      <Autocomplete.Portal>
        <Autocomplete.Positioner data-ren-layer="" sideOffset={4} align="start" className="z-50">
          <Autocomplete.Popup className="max-h-56 w-(--anchor-width) overflow-y-auto overscroll-contain rounded-control border border-border-primary bg-background-secondary p-1 shadow-overlay empty:hidden">
            <Autocomplete.List>
              {(suggestion: string) => (
                <Autocomplete.Item
                  key={suggestion}
                  value={suggestion}
                  className={composeClasses(
                    // oxlint-disable-next-line ren/require-companion-class -- focus stays in the input; data-highlighted marks the active option
                    "flex h-8 cursor-default items-center rounded-control px-2 text-sm text-text-primary outline-none select-none data-highlighted:bg-fill-primary",
                    typeface === "mono" && "font-mono text-xs",
                  )}
                >
                  {suggestion}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  )
}

function Surface(props: {
  appearance: TextFieldAppearance | undefined
  size: TextFieldSize | undefined
  width: TextFieldWidth | undefined
  leading: ReactNode
  trailing: ReactNode
  children: ReactNode
}) {
  return (
    <span
      data-slot="text-field"
      className={composeClasses(
        fieldSurfaceVariants({ appearance: props.appearance, size: props.size, width: props.width }),
      )}
    >
      {props.leading ? <span className="flex shrink-0 items-center text-text-secondary">{props.leading}</span> : null}
      {props.children}
      {props.trailing ? <span className="flex shrink-0 items-center text-text-secondary">{props.trailing}</span> : null}
    </span>
  )
}
