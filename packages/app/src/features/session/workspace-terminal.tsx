import { lazy, Suspense, useState } from "react"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { Shell } from "@ren/schema/shell"
import { IconTerminal2 } from "@tabler/icons-react"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Spinner } from "@ren/ui/spinner"
import { ShellTerminal } from "../../lib/shell-terminal.js"

const TerminalView = lazy(() => import("./terminal-view.js").then((module) => ({ default: module.TerminalView })))

interface Followed {
  readonly shell: Shell.Info
  readonly mine: boolean
}

function Follow(props: { terminal: ShellTerminal.ShellTerminal; root: Session.ID; shell: Shell.Info }) {
  ShellTerminal.useFollow(props.terminal, props.root, props.shell)
  return null
}

export function TerminalTab(props: { root: Session.ID }) {
  const runShell = ChatReact.useAction(props.root, (opened, text: string) => opened.runShell(text))
  const stopShell = ChatReact.useAction(props.root, (opened, shell: Shell.Info) =>
    opened.stopShell(shell.sessionID, shell.id),
  )
  const terminal = ShellTerminal.of(props.root)
  const [followed, setFollowed] = useState<ReadonlyArray<Followed>>(() => terminal.following())
  const [failed, setFailed] = useState(false)
  const unseen = Object.values(ChatReact.useRunningShells(props.root) ?? {}).filter(
    (shell) => !followed.some((item) => item.shell.id === shell.id),
  )
  if (unseen.length > 0) setFollowed((previous) => [...previous, ...unseen.map((shell) => ({ shell, mine: false }))])
  ShellTerminal.useOptions(terminal, {
    run: async (command) => {
      const shell = await runShell(command)
      setFollowed((previous) => [...previous.filter((item) => item.shell.id !== shell.id), { shell, mine: true }])
      return shell
    },
    interrupt: (shell) => void stopShell(shell).catch(() => undefined),
  })
  if (failed)
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia className="text-muted-foreground [&_svg]:size-6">
            <IconTerminal2 />
          </EmptyMedia>
          <EmptyTitle>Ren couldn’t start the terminal</EmptyTitle>
          <EmptyDescription>Reload the page to try again.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return (
    <div data-slot="terminal" className="flex min-h-0 flex-1 flex-col">
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <TerminalView terminal={terminal} onError={() => setFailed(true)} />
      </Suspense>
      {followed.map((item) => (
        <Follow
          key={`${item.shell.id}:${item.mine ? "mine" : "ren"}`}
          terminal={terminal}
          root={props.root}
          shell={item.shell}
        />
      ))}
    </div>
  )
}
