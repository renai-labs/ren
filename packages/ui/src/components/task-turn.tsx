import { composeClasses } from "../lib/compose-classes.js"
import { Icon } from "./icon.js"
import { StatusDot } from "./status-dot.js"

export type TaskTurnProps = (
  | { state: "not_started" | "owner_working" | "done" | "dismissed"; name?: string | undefined }
  | { state: "working" | "idle" | "stopped"; name: string }
  | { state: "needs_you"; name?: string | undefined; reason: string }
) & { truncation?: "none" | "single-line" }

export function TaskTurn(props: TaskTurnProps) {
  const single = props.truncation === "single-line"
  const text = composeClasses("min-w-0", single ? "truncate" : "wrap-break-word")
  if (props.state === "needs_you") {
    return (
      <span
        data-slot="task-turn"
        className={composeClasses(
          "flex min-w-0 gap-1 text-xs text-status-warning",
          single ? "items-center" : "items-start",
        )}
      >
        <Icon glyph="Hand" size="extra-small" />
        <span className={text}>
          Needs {props.name ?? "you"}
          {props.reason ? ` · ${props.reason.split("\n")[0]}` : ""}
        </span>
      </span>
    )
  }
  const label = {
    not_started: props.name ? `${props.name} · Not started` : "Not started",
    working: `${props.name} is working`,
    owner_working: `${props.name ?? "A space member"} is working`,
    idle: `${props.name} · Idle`,
    stopped: `${props.name} · Stopped`,
    done: "Done",
    dismissed: "Dismissed",
  }[props.state]
  return (
    <span data-slot="task-turn" className="flex min-w-0 items-center gap-1 text-xs text-text-secondary">
      {props.state === "working" ? <StatusDot tone="success" /> : null}
      {props.state === "done" ? <Icon glyph="Check" size="extra-small" /> : null}
      {props.state === "dismissed" ? <Icon glyph="X" size="extra-small" /> : null}
      <span className={text}>{label}</span>
    </span>
  )
}
