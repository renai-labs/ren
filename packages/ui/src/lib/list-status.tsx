import type { ReactNode } from "react"
import { LoadingMessage } from "../components/loading-message.js"
import { StateMessage } from "../components/state-message.js"
import type { ListState } from "./list-chrome.js"

export type ListStatusProps = {
  state?: ListState
  emptyMessage?: ReactNode
  failureMessage?: ReactNode
  onRetry?: () => void
}

export function ListStatus(props: ListStatusProps) {
  if (props.state === "loading") return <LoadingMessage />
  if (props.state === "failed") {
    return (
      <StateMessage state="failed" title={props.failureMessage ?? "Couldn’t load this list."} onRetry={props.onRetry} />
    )
  }
  return <StateMessage state="empty" title={props.emptyMessage ?? "Nothing here yet."} />
}
