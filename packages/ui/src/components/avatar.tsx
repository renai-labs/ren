export * as Avatar from "./avatar.js"

import { Avatar } from "@base-ui/react/avatar"
import { cva } from "class-variance-authority"
import type { ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { glyphs } from "../lib/glyphs.js"
import type { Glyph } from "../lib/glyphs.js"
import { toneTint } from "../lib/tone.js"

export type AvatarSize = "extra-small" | "compact" | "small" | "medium" | "large" | "extra-large" | "feature" | "hero"
export type AvatarTone = "neutral" | "inverse" | "accent" | "subtle"
export type AvatarTint = "neutral" | "contrast" | "accent" | "success" | "warning" | "danger"

const avatarVariants = cva("relative inline-grid shrink-0 place-items-center overflow-hidden select-none", {
  variants: {
    size: {
      "extra-small": "size-4 text-2xs [&_svg]:size-3",
      compact: "size-4.5 text-2xs [&_svg]:size-3",
      small: "size-5 text-xs tracking-tight [&_svg]:size-3",
      medium: "size-6 text-xs [&_svg]:size-4",
      large: "size-8 text-sm [&_svg]:size-5",
      "extra-large": "size-12 text-base [&_svg]:size-8",
      feature: "size-10 text-sm [&_svg]:size-6",
      hero: "size-20 text-title [&_svg]:size-12",
    },
    shape: { circle: "rounded-full", square: "rounded-control" },
  },
  defaultVariants: { size: "medium", shape: "circle" },
  compoundVariants: [{ shape: "square", size: ["extra-large", "feature", "hero"], className: "rounded-container" }],
})

const toneClass: Record<AvatarTone, string> = {
  neutral: "bg-fill-secondary text-text-primary",
  inverse: "bg-fill-inverse text-text-inverse",
  accent: "bg-accent-primary text-text-inverse",
  subtle: "bg-fill-primary text-text-primary",
}

const tintClass: Record<AvatarTint, string> = {
  neutral: "bg-fill-secondary text-text-secondary",
  contrast: "bg-fill-secondary text-text-primary",
  accent: toneTint.accent,
  success: toneTint.success,
  warning: toneTint.warning,
  danger: toneTint.danger,
}

const imageVariants = cva("", {
  variants: {
    fit: { cover: "size-full object-cover", contain: "size-3/4 object-contain", inset: "size-2/3 object-contain" },
  },
  defaultVariants: { fit: "cover" },
})

export type RootProps = {
  name: string
  image?: string
  glyph?: Glyph
  emoji?: string
  size?: AvatarSize
  shape?: "circle" | "square"
  imageFit?: "cover" | "contain" | "inset"
  tone?: AvatarTone
  tint?: AvatarTint
  decorative?: boolean
}

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function Frame(props: { label: string | undefined; className: string; children: ReactNode }) {
  return (
    <span
      data-slot="avatar"
      aria-label={props.label}
      role={props.label === undefined ? undefined : "img"}
      className={props.className}
    >
      {props.children}
    </span>
  )
}

function glyphClass(props: RootProps) {
  if (props.tint !== undefined) return tintClass[props.tint]
  const tone = props.tone ?? "neutral"
  return tone === "neutral" ? tintClass.neutral : toneClass[tone]
}

function surfaceClass(props: RootProps) {
  if (props.tint !== undefined) return tintClass[props.tint]
  return toneClass[props.tone ?? "neutral"]
}

export function Root(props: RootProps) {
  const label = props.decorative === true || props.name === "" ? undefined : props.name
  const frame = avatarVariants({ size: props.size, shape: props.shape })
  if (props.emoji !== undefined) {
    return (
      <Frame label={label} className={composeClasses(frame, toneClass.subtle)}>
        <span className="leading-none">{props.emoji}</span>
      </Frame>
    )
  }
  if (props.glyph !== undefined) {
    const Svg = glyphs[props.glyph]
    return (
      <Frame label={label} className={composeClasses(frame, glyphClass(props))}>
        <Svg aria-hidden stroke={props.tint === undefined ? 2 : 1.75} />
      </Frame>
    )
  }
  return (
    <Avatar.Root
      data-slot="avatar"
      aria-label={label}
      role={label === undefined ? undefined : "img"}
      className={composeClasses(frame, surfaceClass(props))}
    >
      {props.image === undefined ? null : (
        <Avatar.Image src={props.image} alt="" className={imageVariants({ fit: props.imageFit })} />
      )}
      <Avatar.Fallback delay={props.image === undefined ? 0 : 300} className="grid size-full place-items-center">
        <span className="leading-none font-medium">{initialsOf(props.name) || "?"}</span>
      </Avatar.Fallback>
    </Avatar.Root>
  )
}

export type GroupItem = { key: string; name: string; image?: string }

export function Group(props: { items: ReadonlyArray<GroupItem>; limit?: number; size?: "extra-small" | "small" }) {
  if (props.items.length === 0) return null
  const size = props.size ?? "small"
  const capacity = Math.max(2, props.limit ?? 4)
  const shown = props.items.length <= capacity ? props.items : props.items.slice(0, capacity - 1)
  const remainder = props.items.slice(shown.length)
  const backing = "-my-0.5 inline-grid shrink-0 rounded-full bg-background-secondary p-0.5 *:text-2xs"
  return (
    <span
      data-slot="avatar-group"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the group names its members once, and an <img> cannot hold the avatars
      role="img"
      aria-label={props.items.map((item) => item.name).join(", ")}
      className={composeClasses(
        "-mx-0.5 flex shrink-0 items-center",
        props.items.every((item) => item.image !== undefined) && "-space-x-2",
      )}
    >
      {shown.map((item) => (
        <span key={item.key} className={backing}>
          <Root name={item.name} image={item.image} size={size} decorative />
        </span>
      ))}
      {remainder.length > 0 ? (
        <span className={backing}>
          <span
            title={remainder.map((item) => item.name).join(", ")}
            className={composeClasses(avatarVariants({ size }), "bg-fill-secondary text-text-secondary")}
          >
            +{remainder.length}
          </span>
        </span>
      ) : null}
    </span>
  )
}
