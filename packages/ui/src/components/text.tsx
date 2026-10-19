import { cva } from "class-variance-authority"
import type { HTMLAttributes, ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { toneText } from "../lib/tone.js"

type Purpose = "display" | "title" | "heading" | "body" | "label" | "caption" | "code"
type Element = "h1" | "h2" | "h3" | "h4" | "p" | "span" | "div" | "label" | "code" | "time" | "dt" | "dd" | "li"

export type TextTone = "primary" | "secondary" | "inverse" | "accent" | "success" | "warning" | "danger" | "inherit"

const textVariants = cva("", {
  variants: {
    purpose: {
      display: "text-display font-reading-semibold tracking-tight text-balance",
      title: "text-title font-medium tracking-tight text-balance",
      heading: "text-base font-medium text-balance",
      body: "text-sm text-pretty",
      label: "text-sm font-medium",
      caption: "text-xs text-pretty",
      code: "font-mono text-xs",
    },
    tone: { ...toneText, inherit: "" },
    weight: { regular: "font-regular", medium: "font-medium", unset: "" },
    truncation: {
      none: "",
      "single-line": "block truncate text-nowrap",
      "two-lines": "line-clamp-2",
      "three-lines": "line-clamp-3",
    },
    wrapping: {
      normal: "",
      anywhere: "wrap-anywhere",
      preserved: "wrap-break-word whitespace-pre-wrap",
      none: "whitespace-nowrap",
      balanced: "text-balance",
    },
    alignment: { start: "text-start", center: "text-center", end: "text-end" },
    numerals: { proportional: "", tabular: "tabular-nums" },
    activity: { none: "", active: "animate-ink-pulsation motion-reduce:animate-none", shimmer: "animate-shimmer" },
    visibility: { visible: "", assistive: "sr-only" },
    letterCase: { unchanged: "", uppercase: "tracking-normal uppercase", capitalized: "capitalize" },
  },
  defaultVariants: {
    purpose: "body",
    weight: "unset",
    truncation: "none",
    wrapping: "normal",
    alignment: "start",
    numerals: "proportional",
    activity: "none",
    visibility: "visible",
    letterCase: "unchanged",
  },
})

const defaultElement: Record<Purpose, Element> = {
  display: "h1",
  title: "h1",
  heading: "h2",
  body: "p",
  label: "span",
  caption: "p",
  code: "code",
}

export type TextProps = Omit<HTMLAttributes<HTMLElement>, "className" | "style" | "children"> & {
  purpose?: Purpose
  tone?: TextTone
  weight?: "regular" | "medium"
  truncation?: "none" | "single-line" | "two-lines" | "three-lines"
  wrapping?: "normal" | "anywhere" | "preserved" | "none" | "balanced"
  alignment?: "start" | "center" | "end"
  numerals?: "proportional" | "tabular"
  activity?: "none" | "active" | "shimmer"
  visibility?: "visible" | "assistive"
  letterCase?: "unchanged" | "uppercase" | "capitalized"
  element?: Element
  leadingIcon?: ReactNode
  htmlFor?: string
  dateTime?: string
  children?: ReactNode
}

export function Text(props: TextProps) {
  const {
    purpose = "body",
    tone,
    weight,
    truncation,
    wrapping,
    alignment,
    numerals,
    activity,
    visibility,
    letterCase,
    element,
    leadingIcon,
    children,
    ...rest
  } = props
  const Tag = element ?? defaultElement[purpose]
  return (
    <Tag
      data-slot="text"
      className={composeClasses(
        textVariants({
          purpose,
          tone: activity === "shimmer" ? "inherit" : (tone ?? (purpose === "caption" ? "secondary" : "primary")),
          weight,
          truncation,
          wrapping,
          alignment,
          numerals,
          activity,
          visibility,
          letterCase,
        }),
      )}
      aria-busy={activity === "active" || activity === "shimmer" || undefined}
      {...rest}
    >
      {leadingIcon === undefined ? (
        children
      ) : (
        <span className="flex min-w-0 items-center gap-2">
          {leadingIcon}
          {children}
        </span>
      )}
    </Tag>
  )
}
