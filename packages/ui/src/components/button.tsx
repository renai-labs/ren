import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva } from "class-variance-authority"
import type { ReactElement, ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { controlSize } from "../lib/control-chrome.js"
import { ProgressIndicator } from "./progress-indicator.js"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center gap-2 font-medium whitespace-nowrap transition-standard select-none active:scale-95 disabled:pointer-events-none disabled:opacity-disabled aria-disabled:pointer-events-none aria-disabled:opacity-disabled [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      appearance: {
        primary:
          "bg-fill-inverse text-text-inverse hover:bg-fill-inverse/disabled data-popup-open:bg-fill-inverse/disabled",
        secondary: "bg-fill-secondary text-text-primary hover:bg-fill-primary data-popup-open:bg-fill-primary",
        outline:
          "border border-border-primary bg-transparent text-text-secondary hover:bg-fill-primary hover:text-text-primary data-popup-open:bg-fill-primary data-popup-open:text-text-primary",
        ghost: "bg-transparent text-text-primary hover:bg-fill-primary data-popup-open:bg-fill-primary",
        plain:
          "bg-transparent text-text-secondary hover:bg-fill-primary hover:text-text-primary data-popup-open:bg-fill-primary data-popup-open:text-text-primary",
        danger: "bg-status-danger text-text-inverse hover:bg-status-danger/disabled",
        link: "bg-transparent font-medium text-text-primary underline-offset-2 hover:underline active:scale-100",
        text: "min-w-0 rounded-control bg-transparent text-start text-text-primary outline-none focus-visible:outline-2 focus-visible:outline-accent-primary active:scale-100",
      },
      size: {
        small: "h-6.5 gap-1 rounded-control px-2 text-xs [&_svg]:size-4",
        compact: `${controlSize.compact} gap-1 rounded-control [&_svg]:size-4`,
        medium: `${controlSize.medium} rounded-control [&_svg]:size-4`,
        large: "h-10 rounded-control px-4 text-sm [&_svg]:size-4",
      },
      width: {
        content: "",
        shrink: "max-w-full min-w-0 shrink overflow-hidden",
        fill: "min-w-0 flex-1",
        full: "w-full",
      },
      alignment: { center: "justify-center", start: "justify-start" },
      shape: { rounded: "", pill: "rounded-full" },
      labelVisibility: { always: "", "on-container-hover": "group/button px-2" },
      wrapping: { none: "", normal: "" },
    },
    defaultVariants: {
      appearance: "secondary",
      size: "medium",
      width: "content",
      alignment: "center",
      shape: "rounded",
      labelVisibility: "always",
      wrapping: "none",
    },
    compoundVariants: [
      { appearance: "link", className: "h-auto px-0" },
      { appearance: "text", className: "h-auto max-w-full shrink truncate px-0" },
      { appearance: "text", wrapping: "normal", className: "text-sm/sm wrap-break-word whitespace-normal" },
      { shape: "pill", size: "small", className: "px-2" },
      { shape: "pill", size: "medium", className: "px-4" },
    ],
  },
)

const collapsibleLabel =
  "hidden items-center gap-2 group-focus-within/action-labels:inline-flex group-hover/action-labels:inline-flex group-data-popup-open/button:inline-flex [@media(hover:none)]:inline-flex"

type LabelVisibility = "always" | "on-container-hover"

export type ButtonProps = Omit<useRender.ComponentProps<"button">, "className" | "style"> & {
  appearance?: "primary" | "secondary" | "outline" | "ghost" | "plain" | "danger" | "link" | "text"
  size?: "small" | "compact" | "medium" | "large"
  width?: "content" | "shrink" | "fill" | "full"
  alignment?: "center" | "start"
  shape?: "rounded" | "pill"
  labelVisibility?: LabelVisibility
  wrapping?: "none" | "normal"
  pending?: boolean
  pendingLabel?: ReactNode
  leadingIcon?: ReactElement
  trailingIcon?: ReactElement
}

export function Button(props: ButtonProps) {
  const {
    appearance,
    size,
    width,
    alignment,
    shape,
    labelVisibility,
    wrapping,
    pending,
    pendingLabel,
    leadingIcon,
    trailingIcon,
    disabled,
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
        "data-slot": "button",
        type: native ? "button" : undefined,
        disabled: native ? inert : undefined,
        "aria-disabled": native ? undefined : inert || undefined,
        "aria-busy": pending === true || undefined,
        className: composeClasses(
          buttonVariants({ appearance, size, width, alignment, shape, labelVisibility, wrapping }),
        ),
        children: (
          <>
            {pending === true ? <ProgressIndicator size="small" tone="inherit" /> : leadingIcon}
            <Label visibility={labelVisibility ?? "always"}>
              {pending === true && pendingLabel !== undefined ? (
                pendingLabel
              ) : (
                <Content truncate={appearance === "text" && wrapping !== "normal"}>{children}</Content>
              )}
              {trailingIcon}
            </Label>
          </>
        ),
      },
      rest,
    ),
  })
}

function Label(props: { visibility: LabelVisibility; children: ReactNode }) {
  if (props.visibility === "on-container-hover") return <span className={collapsibleLabel}>{props.children}</span>
  return props.children
}

function Content(props: { truncate: boolean; children: ReactNode }) {
  const plain = typeof props.children === "string" || typeof props.children === "number"
  if (props.truncate && plain) return <span className="truncate">{props.children}</span>
  return props.children
}
