import { cva } from "class-variance-authority"
import { composeClasses } from "../lib/compose-classes.js"
import { glyphs } from "../lib/glyphs.js"
import type { Glyph } from "../lib/glyphs.js"
import { toneText } from "../lib/tone.js"

export type { Glyph }

export type IconSize = "extra-small" | "small" | "medium" | "large" | "extra-large"
export type IconTone = "primary" | "secondary" | "accent" | "success" | "warning" | "danger" | "inherit"

const iconVariants = cva("shrink-0", {
  variants: {
    size: {
      "extra-small": "size-3",
      small: "size-4",
      medium: "size-5",
      large: "size-6",
      "extra-large": "size-8",
    },
    tone: {
      primary: toneText.primary,
      secondary: toneText.secondary,
      accent: toneText.accent,
      success: toneText.success,
      warning: toneText.warning,
      danger: toneText.danger,
      inherit: "",
    },
  },
})

export function Icon(props: {
  glyph: Glyph
  size?: IconSize
  tone?: IconTone
  label?: string
  "data-icon"?: "inline-start" | "inline-end"
}) {
  const tone = props.tone ?? "inherit"
  const Svg = glyphs[props.glyph]
  return (
    <Svg
      data-slot="icon"
      data-icon={props["data-icon"]}
      data-tone={tone === "inherit" ? undefined : tone}
      aria-hidden={props.label === undefined ? true : undefined}
      aria-label={props.label}
      role={props.label === undefined ? undefined : "img"}
      className={composeClasses(iconVariants({ size: props.size ?? "small", tone }))}
    />
  )
}
