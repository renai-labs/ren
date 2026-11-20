import { ShellOutput, TimelineText } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { Shell } from "@ren/schema/shell"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"

const tailLines = 14

const endOf = (shell: Shell.Info | undefined, options: { readonly missing: boolean }) =>
  TimelineText.shellEnd({
    state: options.missing || shell?.status === "killed" ? "cancelled" : undefined,
    timeout: shell?.status === "timeout",
    exit: shell?.exit,
  })

export function useShellRun(
  root: Session.ID,
  item: { readonly sessionID: string | undefined; readonly id: string | undefined },
) {
  const view = {
    root,
    sessionID: Session.ID.make(item.sessionID ?? root),
    shellID: Shell.ID.make(item.id ?? ""),
  }
  const info = ChatReact.useShell(view)
  const live = ChatReact.useShellRunning(root, view.shellID)
  const shell = Option.getOrUndefined(AsyncResult.value(info))
  const missing = AsyncResult.isFailure(info)
  const running = !missing && (live || !shell || shell.status === "running")
  const output = AsyncResult.getOrElse(ChatReact.useShellOutput({ ...view, running }), () => "")
  return {
    output,
    running,
    tail: ShellOutput.tail(output, tailLines),
    end: running ? undefined : endOf(shell, { missing }),
    completed: shell?.time.completed,
  }
}
