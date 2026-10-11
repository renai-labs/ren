import { Field } from "@base-ui/react/field"
import { cva } from "class-variance-authority"
import type { ComponentPropsWithoutRef, Ref } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { controlOutline } from "../lib/control-chrome.js"

const textAreaVariants = cva(
  "block w-full min-w-0 placeholder-muted text-text-primary transition-standard outline-none disabled:cursor-not-allowed disabled:opacity-disabled",
  {
    variants: {
      appearance: {
        outline: `${controlOutline} focus-visible:inset-ring-accent-primary aria-invalid:inset-ring-status-danger`,
        plain: "bg-transparent",
      },
      size: {
        medium: "px-3 py-2 text-base sm:text-sm",
        reading: "text-base/base",
        title: "text-title/title font-medium tracking-tight",
        display: "text-display/display font-reading-semibold tracking-tight",
      },
      height: {
        fixed: "min-h-20 resize-y",
        automatic: "field-sizing-content resize-none",
        growing: "field-sizing-content min-h-20 resize-none",
        expanded: "field-sizing-content min-h-80 resize-none",
      },
      typeface: { sans: "", mono: "font-mono" },
      masking: { none: "", concealed: "[-webkit-text-security:disc]" },
    },
    compoundVariants: [
      { appearance: "plain", className: "p-0" },
      { height: "automatic", size: "medium", className: "min-h-10" },
    ],
    defaultVariants: { appearance: "outline", size: "medium", height: "fixed", typeface: "sans", masking: "none" },
  },
)

export type TextAreaProps = {
  size?: "medium" | "reading" | "title" | "display"
  appearance?: "outline" | "plain"
  height?: "fixed" | "automatic" | "growing" | "expanded"
  typeface?: "sans" | "mono"
  masking?: "none" | "concealed"
  invalid?: boolean
  ref?: Ref<HTMLTextAreaElement>
} & Omit<ComponentPropsWithoutRef<"textarea">, "className" | "style">

export function TextArea(props: TextAreaProps) {
  const {
    size,
    appearance,
    height,
    typeface,
    masking,
    invalid,
    value,
    defaultValue,
    disabled,
    id,
    name,
    autoFocus,
    "aria-invalid": ariaInvalid,
    ...rest
  } = props
  return (
    <Field.Control
      value={value}
      defaultValue={defaultValue}
      disabled={disabled}
      id={id}
      name={name}
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- forwards the caller's choice to the control
      autoFocus={autoFocus}
      aria-invalid={invalid === true || ariaInvalid === true || ariaInvalid === "true" || undefined}
      render={
        <textarea
          data-slot="text-area"
          className={composeClasses(textAreaVariants({ appearance, size, height, typeface, masking }))}
          {...rest}
        />
      }
    />
  )
}
