import type { ReactNode } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { ProgressIndicator } from "./progress-indicator.js"
import { stateMessageVariants } from "./state-message.js"
import type { StateMessagePlacement } from "./state-message.js"
import { Text } from "./text.js"

export type LoadingMessageProps = {
  placement?: StateMessagePlacement
  title?: ReactNode
  description?: ReactNode
}

export function LoadingMessage(props: LoadingMessageProps) {
  const placement = props.placement ?? "section"
  const visible = (node: ReactNode) =>
    placement !== "inline" && node !== undefined && node !== null && node !== false && node !== ""
  return (
    <output
      data-slot="state-message"
      data-state="loading"
      aria-label={typeof props.title === "string" ? props.title : "Loading"}
      className={composeClasses(stateMessageVariants({ placement }))}
    >
      <ProgressIndicator size={placement === "page" ? "large" : "medium"} />
      {visible(props.title) ? (
        <Text purpose="caption" element="span">
          {props.title}
        </Text>
      ) : null}
      {visible(props.description) ? (
        <Text purpose="caption" alignment="center" element="span">
          {props.description}
        </Text>
      ) : null}
    </output>
  )
}
