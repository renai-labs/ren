import { Button } from "@base-ui/react/button"
import { cva } from "class-variance-authority"
import type { ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { toneTint } from "../lib/tone.js"
import { Icon } from "./icon.js"
import { StatusDot } from "./status-dot.js"
import type { StatusTone } from "./status-dot.js"

export type BadgeTone = Exclude<StatusTone, "muted">

const badgeVariants = cva(
  "inline-flex max-w-full shrink-0 items-center gap-1 whitespace-nowrap [&_img]:size-4 [&_img]:rounded-control [&_img]:object-contain [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      tone: { neutral: "", muted: "", accent: "", success: "", warning: "", danger: "" },
      appearance: {
        subtle: "",
        outline: "border bg-transparent",
        tag: "gap-2 border border-border-primary bg-fill-primary text-text-primary transition-standard hover:border-border-secondary",
      },
      size: {
        small: "h-5 px-2 text-xs",
        medium: "h-6 px-2 text-xs",
        large: "h-6 px-2 text-sm",
        control: "h-7 px-3 text-xs [&_svg]:size-3.5",
      },
      shape: { rounded: "rounded-control", pill: "rounded-full" },
      typeface: { sans: "font-medium", mono: "font-mono" },
    },
    defaultVariants: { tone: "neutral", appearance: "subtle", size: "small", shape: "rounded", typeface: "sans" },
    compoundVariants: [
      { tone: "neutral", appearance: "subtle", className: "bg-fill-secondary text-text-primary" },
      { tone: "muted", appearance: "tag", className: "text-text-secondary" },
      { appearance: "tag", size: "medium", className: "max-w-40" },
      { tone: "neutral", appearance: "outline", className: "border-border-primary text-text-secondary" },
      { tone: "muted", appearance: "subtle", className: "bg-fill-primary text-text-secondary" },
      { tone: "muted", appearance: "outline", className: "border-border-primary text-text-secondary" },
      { tone: "accent", appearance: "subtle", className: toneTint.accent },
      { tone: "accent", appearance: "outline", className: "border-accent-primary text-accent-primary" },
      { tone: "success", appearance: "subtle", className: toneTint.success },
      { tone: "success", appearance: "outline", className: "border-status-success text-status-success" },
      { tone: "warning", appearance: "subtle", className: toneTint.warning },
      { tone: "warning", appearance: "outline", className: "border-status-warning text-status-warning" },
      { tone: "danger", appearance: "subtle", className: toneTint.danger },
      { tone: "danger", appearance: "outline", className: "border-status-danger text-status-danger" },
    ],
  },
)

export type BadgeProps = {
  tone?: StatusTone
  appearance?: "subtle" | "outline" | "tag"
  size?: "small" | "medium" | "large" | "control"
  shape?: "rounded" | "pill"
  typeface?: "sans" | "mono"
  marker?: "none" | "dot"
  markerTone?: StatusTone
  icon?: ReactNode
  onRemove?: () => void
  removeLabel?: string
  children: ReactNode
}

export function Badge(props: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={composeClasses(
        badgeVariants({
          tone: props.tone,
          appearance: props.appearance,
          size: props.size,
          shape: props.shape,
          typeface: props.typeface,
        }),
      )}
    >
      {props.marker === "dot" ? <StatusDot tone={props.markerTone ?? props.tone} /> : props.icon}
      <span className="truncate">{props.children}</span>
      {props.onRemove === undefined ? null : (
        <Button
          aria-label={props.removeLabel ?? "Remove"}
          onClick={props.onRemove}
          className="-mr-1 grid size-4 place-items-center rounded-full opacity-disabled transition-standard hover:opacity-100"
        >
          <Icon glyph="X" />
        </Button>
      )}
    </span>
  )
}
