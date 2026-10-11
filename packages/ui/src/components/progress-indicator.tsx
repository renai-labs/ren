import { IconLoader2 } from "@tabler/icons-react"
import { cva } from "class-variance-authority"
import { composeClasses } from "../lib/compose-classes.js"

const spinnerVariants = cva("shrink-0 animate-rotation", {
  variants: {
    size: { "extra-small": "size-3", small: "size-4", medium: "size-5", large: "size-8" },
    tone: { secondary: "text-text-secondary", inherit: "text-current" },
  },
})

export function ProgressIndicator(props: {
  size?: "extra-small" | "small" | "medium" | "large"
  tone?: "secondary" | "inherit"
  label?: string
}) {
  return (
    <IconLoader2
      data-slot="progress-indicator"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the spinner is the glyph itself, and an <output> cannot be an svg
      role="status"
      aria-label={props.label ?? "Loading"}
      className={composeClasses(spinnerVariants({ size: props.size ?? "small", tone: props.tone ?? "secondary" }))}
    />
  )
}
