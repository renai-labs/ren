import { Collapsible } from "@base-ui/react/collapsible"
import { cva } from "class-variance-authority"
import type { ReactNode } from "react"
import { Icon } from "../components/icon.js"
import { Text } from "../components/text.js"
import { composeClasses } from "./compose-classes.js"
import { InteractiveFrame } from "./interactive-frame.js"
import { DisclosureRoot } from "./list-disclosure.js"
import type { DisclosureState } from "./list-disclosure.js"

type Appearance = "transcript" | "summary" | "event"

const rowVariants = cva(
  "relative flex min-w-0 gap-2 text-start text-text-secondary transition-standard focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-primary",
  {
    variants: {
      appearance: {
        transcript: "w-full rounded-control px-2 py-1 text-sm",
        summary: "w-fit max-w-full items-center rounded-small py-1 text-sm font-medium",
        event: "min-h-6 w-full items-start gap-0 py-1 text-xs/xs",
      },
      interactive: { true: "hover:text-text-primary", false: "" },
      lines: { single: "", stacked: "" },
    },
    compoundVariants: [
      { appearance: "transcript", interactive: true, className: "hover:bg-fill-primary" },
      { appearance: "transcript", lines: "single", className: "min-h-8 items-center" },
      { appearance: "transcript", lines: "stacked", className: "items-start" },
    ],
  },
)

const titleVariants = cva("min-w-0", {
  variants: {
    appearance: { transcript: "max-w-1/2 shrink-0 truncate", summary: "truncate", event: "flex-1" },
  },
})

const glyph = "flex shrink-0 items-center [&_svg]:size-3.5"

type RowProps = {
  leading?: ReactNode
  title: ReactNode
  description?: ReactNode
  trailing?: ReactNode
  disabled?: boolean
  label?: string
}

export type TranscriptItemProps = RowProps & {
  appearance?: "transcript" | "event"
  onActivate?: () => void
  children?: ReactNode
}

export function TranscriptItem(props: TranscriptItemProps) {
  const appearance = props.appearance ?? "transcript"
  const stacked = appearance === "transcript"
  const classes = composeClasses(
    rowVariants({
      appearance,
      interactive: props.onActivate !== undefined && props.disabled !== true,
      lines: stacked ? "stacked" : "single",
    }),
  )
  const body = (
    <>
      {props.leading === undefined ? null : (
        <span
          className={
            appearance === "event"
              ? "relative flex h-4 w-9 shrink-0 items-center justify-center bg-background-primary [&_svg]:size-3.5"
              : composeClasses(glyph, "h-6")
          }
        >
          {props.leading}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={composeClasses("flex min-w-0 items-center gap-2", stacked && "h-6")}>
          <Heading appearance={appearance} title={props.title} description={props.description} />
        </span>
        {props.children}
      </span>
      {props.trailing === undefined ? null : (
        <span className={composeClasses(glyph, "gap-2", stacked && "h-6")}>{props.trailing}</span>
      )}
    </>
  )
  return (
    <InteractiveFrame
      frame={{ role: "listitem" }}
      target={
        props.onActivate === undefined
          ? { kind: "static", props: { role: "listitem", className: classes } }
          : {
              kind: "button",
              props: {
                "aria-label": props.label,
                disabled: props.disabled,
                onClick: props.onActivate,
                className: classes,
              },
            }
      }
    >
      {body}
    </InteractiveFrame>
  )
}

function Heading(props: { appearance: Appearance; title: ReactNode; description: ReactNode }) {
  return (
    <>
      <span className={composeClasses(titleVariants({ appearance: props.appearance }))}>{props.title}</span>
      {props.description === undefined ? null : (
        <Text purpose="caption" tone="inherit" element="span" truncation="single-line">
          {props.description}
        </Text>
      )}
    </>
  )
}

export type TranscriptDisclosureProps = RowProps &
  DisclosureState & {
    appearance?: "transcript" | "summary"
    actions?: ReactNode
    children?: ReactNode
  }

export function TranscriptDisclosure(props: TranscriptDisclosureProps) {
  const appearance = props.appearance ?? "transcript"
  const interactive = props.disabled !== true && (appearance === "summary" || props.locked !== true)
  const row = composeClasses(rowVariants({ appearance, interactive, lines: "single" }))
  const heading = (
    <>
      {props.leading === undefined ? null : <span className={glyph}>{props.leading}</span>}
      <span
        className={composeClasses(
          "flex min-w-0 items-center gap-2",
          (appearance !== "summary" || props.actions !== undefined) && "flex-1",
        )}
      >
        <Heading appearance={appearance} title={props.title} description={props.description} />
      </span>
    </>
  )
  const end = (
    <>
      {props.trailing === undefined ? null : <span className="flex shrink-0 items-center gap-2">{props.trailing}</span>}
      {interactive ? (
        <span
          className={composeClasses(
            "flex shrink-0 transition-standard group-data-panel-open/disclosure:rotate-90 motion-reduce:transition-none",
            appearance === "summary" ? "[&_svg]:size-4" : "[&_svg]:size-3.5",
          )}
        >
          <Icon glyph="ChevronRight" />
        </span>
      ) : null}
    </>
  )
  return (
    <DisclosureRoot {...props}>
      {props.actions === undefined ? (
        <Collapsible.Trigger aria-label={props.label} className={composeClasses(row, "group/disclosure")}>
          {heading}
          {end}
        </Collapsible.Trigger>
      ) : (
        <div className={row}>
          <Collapsible.Trigger
            aria-label={props.label}
            className="flex min-w-0 shrink items-center gap-2 text-start focus-visible:outline-2 focus-visible:outline-accent-primary"
          >
            {heading}
          </Collapsible.Trigger>
          <span className="flex min-w-0 items-center gap-2">{props.actions}</span>
          <Collapsible.Trigger
            aria-hidden
            tabIndex={-1}
            // oxlint-disable-next-line ren/require-companion-class -- a pointer-only target that never takes focus; the first trigger draws the ring
            className="group/disclosure flex min-w-0 flex-1 items-center justify-end gap-2 self-stretch outline-none"
          >
            {end}
          </Collapsible.Trigger>
        </div>
      )}
      <Collapsible.Panel
        role={appearance === "summary" ? "list" : undefined}
        className={composeClasses(panelVariants({ appearance }))}
      >
        {props.children}
      </Collapsible.Panel>
    </DisclosureRoot>
  )
}

const panelVariants = cva("flex min-w-0 flex-col", {
  variants: {
    appearance: {
      transcript: "pt-1 pb-2 transition-standard data-starting-style:opacity-0",
      summary: "gap-1 border-l border-border-primary py-1 pl-3",
    },
  },
})
