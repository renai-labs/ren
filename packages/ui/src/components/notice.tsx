import { cva } from "class-variance-authority"
import type { ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { Icon } from "./icon.js"
import type { Glyph, IconTone } from "./icon.js"
import { Text } from "./text.js"

type NoticeTone = "information" | "warning" | "danger" | "neutral"
type NoticePlacement = "inline" | "banner"

const noticeVariants = cva("flex w-full min-w-0 items-start gap-3", {
  variants: {
    tone: { neutral: "", information: "", warning: "", danger: "" },
    placement: {
      inline: "text-sm",
      banner: "rounded-container border px-4 py-3 text-sm",
    },
  },
  compoundVariants: [
    { tone: "neutral", placement: "banner", className: "border-border-primary bg-background-secondary" },
    { tone: "information", placement: "banner", className: "border-accent-primary/disabled bg-accent-primary/tint" },
    { tone: "warning", placement: "banner", className: "border-status-warning/disabled bg-status-warning/tint" },
    { tone: "danger", placement: "banner", className: "border-status-danger/disabled bg-status-danger/tint" },
  ],
})

const glyph: Record<NoticeTone, { glyph: Glyph; tone: IconTone }> = {
  neutral: { glyph: "Info", tone: "secondary" },
  information: { glyph: "Info", tone: "accent" },
  warning: { glyph: "AlertTriangle", tone: "warning" },
  danger: { glyph: "AlertCircle", tone: "danger" },
}

const empty = (node: ReactNode) => node === null || node === undefined || node === false || node === ""

export type NoticeProps = {
  tone?: NoticeTone
  placement?: NoticePlacement
  layout?: "stacked" | "inline"
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
}

export function Notice(props: NoticeProps) {
  const tone = props.tone ?? "information"
  const placement = props.placement ?? "banner"
  if (empty(props.title) && empty(props.children)) return null
  return (
    <div
      data-slot="notice"
      role={tone === "danger" ? "alert" : "status"}
      className={composeClasses(noticeVariants({ tone, placement }))}
    >
      <span className="flex h-lh shrink-0 items-center">
        <Icon glyph={glyph[tone].glyph} tone={glyph[tone].tone} />
      </span>
      {props.layout === "inline" ? (
        <InlineBody title={props.title}>{props.children}</InlineBody>
      ) : (
        <StackedBody title={props.title} placement={placement} tone={tone}>
          {props.children}
        </StackedBody>
      )}
      {empty(props.action) ? null : <div className="flex shrink-0 items-center gap-2">{props.action}</div>}
    </div>
  )
}

function InlineBody(props: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <Text purpose="body" tone="secondary" truncation="single-line" element="div">
        {empty(props.title) ? null : (
          <Text purpose="label" element="span">
            {props.title}
          </Text>
        )}{" "}
        {props.children}
      </Text>
    </div>
  )
}

function StackedBody(props: { title: ReactNode; placement: NoticePlacement; tone: NoticeTone; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      {empty(props.title) ? null : <Text purpose="label">{props.title}</Text>}
      {empty(props.children) ? null : (
        <Text
          purpose={props.placement === "inline" ? "body" : "caption"}
          tone={props.placement === "inline" && props.tone === "danger" ? "danger" : "secondary"}
          element="div"
        >
          {props.children}
        </Text>
      )}
    </div>
  )
}
