import { cva } from "class-variance-authority"
import { composeClasses } from "../lib/compose-classes.js"
import { toneFill } from "../lib/tone.js"

export type StatusTone = "neutral" | "muted" | "accent" | "success" | "warning" | "danger"

const statusDotVariants = cva("inline-block size-2 shrink-0 rounded-full", {
  variants: {
    tone: {
      neutral: toneFill.secondary,
      muted: toneFill.secondary,
      accent: toneFill.accent,
      success: toneFill.success,
      warning: toneFill.warning,
      danger: toneFill.danger,
    },
    activity: { none: "", pulse: "animate-pulsation" },
  },
  defaultVariants: { tone: "neutral", activity: "none" },
})

export function StatusDot(props: {
  tone?: StatusTone | undefined
  label?: string
  activity?: "none" | "pulse"
  frame?: "none" | "icon"
}) {
  const dot = (
    <span
      data-slot="badge-marker"
      role={props.label === undefined ? undefined : "img"}
      aria-label={props.label}
      aria-hidden={props.label === undefined ? true : undefined}
      className={composeClasses(statusDotVariants({ tone: props.tone, activity: props.activity }))}
    />
  )
  if (props.frame !== "icon") return dot
  return <span className="grid size-4 shrink-0 place-items-center">{dot}</span>
}
