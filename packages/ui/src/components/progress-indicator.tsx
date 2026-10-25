import { IconLoader2 } from "@tabler/icons-react"
import { cva } from "class-variance-authority"
import { composeClasses } from "../lib/compose-classes.js"

const spinnerVariants = cva("shrink-0 animate-rotation", {
  variants: {
    size: { "extra-small": "size-3", small: "size-4", medium: "size-5", large: "size-8" },
    tone: { secondary: "text-text-secondary", inherit: "text-current" },
  },
})

const barFillVariants = cva("block h-full rounded-full transition-extended", {
  variants: {
    tone: { primary: "bg-fill-inverse", accent: "bg-accent-primary", danger: "bg-status-danger" },
  },
})

type SpinnerProps = {
  presentation?: "spinner"
  size?: "extra-small" | "small" | "medium" | "large"
  tone?: "secondary" | "inherit"
  label?: string
  announcement?: "status" | "none"
}

type BarProps = {
  presentation: "bar"
  value: number
  tone: "primary" | "accent" | "danger"
  label: string
}

export function ProgressIndicator(props: SpinnerProps | BarProps) {
  if (props.presentation === "bar") {
    return (
      <span
        data-slot="progress-indicator"
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a native <meter> draws its own bar per browser and cannot take the fill tokens
        role="meter"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(props.value)}
        className="block h-1 w-full overflow-hidden rounded-full bg-fill-secondary"
      >
        <span
          className={composeClasses(barFillVariants({ tone: props.tone }))}
          style={{ width: `${Math.min(100, Math.max(0, props.value))}%` }}
        />
      </span>
    )
  }
  const announced = props.announcement !== "none"
  return (
    <IconLoader2
      data-slot="progress-indicator"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the spinner is the glyph itself, and an <output> cannot be an svg
      role={announced ? "status" : undefined}
      aria-label={announced ? (props.label ?? "Loading") : undefined}
      aria-hidden={announced ? undefined : true}
      className={composeClasses(spinnerVariants({ size: props.size ?? "small", tone: props.tone ?? "secondary" }))}
    />
  )
}
