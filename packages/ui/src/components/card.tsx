export * as Card from "./card.js"

import { cva } from "class-variance-authority"
import { createContext, use } from "react"
import type { CSSProperties, ReactElement, ReactNode } from "react"
import { CardBody } from "../lib/card-body.js"
import type { CardBodyProps } from "../lib/card-body.js"
import { composeClasses } from "../lib/compose-classes.js"
import { InteractiveFrame } from "../lib/interactive-frame.js"
import type { InteractiveTarget } from "../lib/interactive-frame.js"

type Interaction = "none" | "link" | "button" | "selection"
type Width = "fill" | "limited"

const frameVariants = cva("relative flex min-w-0 flex-col", {
  variants: { width: { fill: "", limited: "max-w-70" } },
  defaultVariants: { width: "fill" },
})

const cardVariants = cva(
  "group/card relative flex min-w-0 rounded-container border text-start transition-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary",
  {
    variants: {
      layout: { tile: "flex-col", row: "flex-row items-center", feature: "flex-col" },
      interaction: {
        none: "",
        link: "cursor-pointer hover:bg-fill-primary active:scale-99",
        button: "cursor-pointer hover:bg-fill-primary active:scale-99",
        selection:
          "cursor-pointer hover:bg-fill-primary aria-checked:border-border-strong aria-checked:bg-fill-primary",
      },
      density: { compact: "gap-2 p-3", regular: "gap-3 p-4", spacious: "gap-4 p-6" },
      emphasis: {
        standard: "border-border-primary bg-background-secondary",
        muted: "border-border-primary bg-fill-primary",
      },
      disabled: { true: "pointer-events-none opacity-disabled", false: "" },
      width: { fill: "", limited: "max-w-70" },
    },
    compoundVariants: [{ layout: "feature", density: "regular", className: "min-h-26" }],
    defaultVariants: {
      layout: "tile",
      interaction: "none",
      density: "regular",
      emphasis: "standard",
      disabled: false,
      width: "fill",
    },
  },
)

export type RootProps = Omit<CardBodyProps, "layout" | "interaction"> & {
  layout?: "tile" | "row" | "feature"
  interaction?: Interaction
  density?: "compact" | "regular" | "spacious"
  emphasis?: "standard" | "muted"
  width?: Width
  actions?: ReactNode
  actionPlacement?: "corner" | "footer"
  disabled?: boolean
  onSelect?: () => void
  render?: ReactElement
  label?: string
  appearanceOrder?: number
}

export function Root(props: RootProps) {
  const layout = props.layout ?? "tile"
  const interaction = props.interaction ?? "none"
  const classes = composeClasses(
    cardVariants({
      layout,
      interaction,
      density: props.density,
      emphasis: props.emphasis,
      disabled: props.disabled === true,
      width: props.width,
    }),
    props.appearanceOrder !== undefined && "animate-entrance",
  )
  const style =
    props.appearanceOrder === undefined
      ? undefined
      : { animationDelay: `${Math.min(props.appearanceOrder * 30, 240)}ms` }
  return (
    <InteractiveFrame
      frame={{ className: composeClasses(frameVariants({ width: props.width })) }}
      target={cardTarget(props, interaction, classes, style)}
      actions={
        props.actions === undefined ? null : (
          <span
            className={composeClasses(
              "z-10 flex shrink-0 items-center gap-1",
              actionPosition(layout, props.actionPlacement ?? "corner"),
            )}
          >
            {props.actions}
          </span>
        )
      }
    >
      <CardBody {...props} layout={layout} interaction={interaction} />
    </InteractiveFrame>
  )
}

function actionPosition(layout: "tile" | "row" | "feature", placement: "corner" | "footer") {
  if (layout === "row") return "relative"
  return placement === "footer" ? "absolute right-3 bottom-3" : "absolute top-3 right-3"
}

function cardTarget(
  props: RootProps,
  interaction: Interaction,
  classes: string,
  style: CSSProperties | undefined,
): InteractiveTarget {
  const surface = { "data-slot": "card", "aria-label": props.label, style }
  if (interaction === "link" && props.render !== undefined) {
    return { kind: "link", render: props.render, props: { ...surface, className: composeClasses(classes, "flex-1") } }
  }
  if (interaction === "button" || interaction === "selection") {
    return {
      kind: "button",
      props: {
        ...surface,
        role: interaction === "selection" ? "radio" : undefined,
        "aria-checked": interaction === "selection" ? props.selected === true : undefined,
        disabled: props.disabled === true,
        onClick: props.onSelect,
        className: composeClasses(classes, "w-full flex-1"),
      },
    }
  }
  return { kind: "static", props: { "data-slot": "card", className: classes, style } }
}

const SelectedContext = createContext(false)

export type DividedProps = {
  selected?: boolean
  children: ReactNode
}

export function Divided(props: DividedProps) {
  const selected = props.selected === true
  return (
    <SelectedContext value={selected}>
      <div
        data-slot="card"
        data-selected={selected || undefined}
        className={composeClasses(
          "relative flex min-w-0 flex-col overflow-hidden rounded-control border border-border-primary bg-background-secondary shadow-raised",
          selected && "ring-2 ring-accent-primary",
        )}
      >
        {props.children}
      </div>
    </SelectedContext>
  )
}

export type HeaderProps = {
  media?: ReactNode
  actions?: ReactNode
  children: ReactNode
}

export function Header(props: HeaderProps) {
  return (
    <div className="flex h-10 min-w-0 items-center gap-2 border-b border-border-primary px-4 text-sm">
      {props.media === undefined ? null : <span className="flex shrink-0 items-center">{props.media}</span>}
      <span className="block min-w-0 truncate">{props.children}</span>
      {props.actions === undefined ? null : (
        <span className="ml-auto flex shrink-0 items-center gap-1">{props.actions}</span>
      )}
    </div>
  )
}

export type SectionProps = {
  metadata?: ReactNode
  disabled?: boolean
  onSelect?: () => void
  label?: string
  children?: ReactNode
}

export function Section(props: SectionProps) {
  const selected = use(SelectedContext)
  return (
    <button
      type="button"
      onClick={props.onSelect}
      disabled={props.disabled === true || props.onSelect === undefined}
      aria-label={props.label}
      aria-pressed={props.onSelect === undefined ? undefined : selected}
      className="flex h-10 w-full min-w-0 items-center gap-2 px-4 text-start text-sm font-medium transition-standard hover:bg-fill-primary focus-visible:bg-fill-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-primary disabled:cursor-default disabled:hover:bg-transparent"
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{props.children}</span>
      {props.metadata === undefined ? null : (
        <span className="flex shrink-0 items-center gap-2 text-text-secondary">{props.metadata}</span>
      )}
    </button>
  )
}
