import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva } from "class-variance-authority"
import type { ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { ProgressIndicator } from "./progress-indicator.js"

const iconButtonVariants = cva(
  "relative inline-grid shrink-0 place-items-center transition-standard select-none active:scale-95 disabled:pointer-events-none disabled:opacity-disabled aria-disabled:pointer-events-none aria-disabled:opacity-disabled [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      appearance: {
        plain:
          "bg-transparent text-text-secondary hover:bg-fill-primary hover:text-text-primary aria-pressed:bg-fill-secondary aria-pressed:text-text-primary data-popup-open:bg-fill-primary data-popup-open:text-text-primary",
        secondary:
          "bg-fill-primary text-text-primary hover:bg-fill-secondary aria-pressed:bg-fill-secondary data-popup-open:bg-fill-secondary",
        outline:
          "border border-border-primary bg-transparent text-text-secondary hover:border-border-secondary hover:text-text-primary data-popup-open:bg-fill-secondary data-popup-open:text-text-primary",
        primary: "bg-fill-inverse text-text-inverse hover:bg-fill-inverse/disabled",
        overlay: "bg-overlay-primary text-text-inverse hover:bg-overlay-primary/disabled",
      },
      size: {
        "extra-small": "size-5 [&_svg]:size-3",
        compact: "size-6 [&_svg]:size-3.5",
        small: "size-7 [&_svg]:size-4",
        medium: "size-8 [&_svg]:size-4",
        large: "size-10 [&_svg]:size-5",
      },
      shape: { square: "rounded-control", circle: "rounded-full" },
      glyphMotion: {
        none: "",
        "turn-when-open": "[&_svg]:transition-standard data-popup-open:[&_svg]:rotate-45",
      },
    },
    defaultVariants: { appearance: "plain", size: "small", shape: "square", glyphMotion: "none" },
  },
)

export type IconButtonSize = "extra-small" | "compact" | "small" | "medium" | "large"

export type IconButtonProps = Omit<useRender.ComponentProps<"button">, "className" | "style" | "children"> & {
  label: string
  appearance?: "plain" | "secondary" | "outline" | "primary" | "overlay"
  size?: IconButtonSize
  shape?: "square" | "circle"
  glyphMotion?: "none" | "turn-when-open"
  indicator?: "none" | "attention"
  pending?: boolean
  children: ReactNode
}

export function IconButton(props: IconButtonProps) {
  const {
    label,
    appearance,
    size,
    shape,
    glyphMotion,
    indicator,
    pending,
    disabled,
    title,
    children,
    render,
    ...rest
  } = props
  const native = render === undefined
  const inert = disabled === true || pending === true
  return useRender({
    defaultTagName: "button",
    render,
    props: mergeProps(
      {
        "data-slot": "icon-button",
        type: native ? "button" : undefined,
        "aria-label": label,
        title: title ?? label,
        disabled: native ? inert : undefined,
        "aria-disabled": native ? undefined : inert || undefined,
        "aria-busy": pending === true || undefined,
        className: composeClasses(iconButtonVariants({ appearance, size, shape, glyphMotion })),
        children: (
          <>
            {pending === true ? <ProgressIndicator size="small" tone="inherit" /> : children}
            {indicator === "attention" ? (
              <span aria-hidden className="absolute top-0.5 right-0.5 rounded-full bg-background-primary p-0.5">
                <span className="block size-2 rounded-full bg-accent-primary" />
              </span>
            ) : null}
          </>
        ),
      },
      rest,
    ),
  })
}
