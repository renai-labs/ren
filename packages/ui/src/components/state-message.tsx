import { cva } from "class-variance-authority"
import type { ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { Button } from "./button.js"
import { Icon } from "./icon.js"
import type { Glyph, IconTone } from "./icon.js"
import { Text } from "./text.js"
import type { TextTone } from "./text.js"

export type StateMessagePlacement = "inline" | "section" | "page" | "overlay"

type State = "complete" | "empty" | "no-results" | "failed" | "unavailable"

export const stateMessageVariants = cva("flex w-full flex-col items-center justify-center gap-3 text-center", {
  variants: {
    placement: {
      inline: "min-h-10 flex-row gap-2 py-2",
      section: "min-h-40 px-4 py-12",
      page: "min-h-[60vh] flex-1 px-6 py-12",
      overlay: "absolute inset-0 z-10 px-4",
    },
  },
})

const defaultTitle: Record<State, string> = {
  complete: "Done",
  empty: "Nothing here yet.",
  "no-results": "No results match your search.",
  failed: "Unable to load this.",
  unavailable: "This is no longer available.",
}

const defaultGlyph: Partial<Record<State, { glyph: Glyph; tone: IconTone }>> = {
  failed: { glyph: "AlertCircle", tone: "danger" },
  complete: { glyph: "CheckCircle", tone: "success" },
  unavailable: { glyph: "Info", tone: "secondary" },
}

export type StateMessageProps = {
  state: State
  placement?: StateMessagePlacement
  title?: ReactNode
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  onRetry?: () => void
  retryLabel?: string
}

export function StateMessage(props: StateMessageProps) {
  const placement = props.placement ?? "section"
  return (
    <div
      data-slot="state-message"
      data-state={props.state}
      role={props.state === "failed" ? "alert" : undefined}
      className={composeClasses(stateMessageVariants({ placement }))}
    >
      {placement === "inline" ? null : <StateGlyph state={props.state} icon={props.icon} />}
      <div className="flex max-w-dialog flex-col items-center gap-1">
        <Text
          purpose={placement === "page" ? "heading" : "body"}
          tone={titleTone(props.state, placement)}
          alignment="center"
        >
          {props.title ?? defaultTitle[props.state]}
        </Text>
        {props.description === undefined || props.description === null ? null : (
          <Text purpose="caption" alignment="center">
            {props.description}
          </Text>
        )}
      </div>
      {props.onRetry === undefined && props.action === undefined ? null : (
        <div className="flex items-center gap-2">
          {props.onRetry === undefined ? null : (
            <Button appearance="outline" size="small" onClick={props.onRetry}>
              {props.retryLabel ?? "Try again"}
            </Button>
          )}
          {props.action}
        </div>
      )}
    </div>
  )
}

function StateGlyph(props: { state: State; icon: ReactNode }) {
  const glyph = defaultGlyph[props.state]
  if (props.icon !== undefined) return props.icon
  if (glyph === undefined) return null
  return <Icon glyph={glyph.glyph} tone={glyph.tone} size="large" />
}

function titleTone(state: State, placement: StateMessagePlacement): TextTone {
  if (state === "failed" && placement === "inline") return "danger"
  if (placement === "page") return "primary"
  return "secondary"
}
