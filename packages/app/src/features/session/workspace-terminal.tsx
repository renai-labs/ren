import { use, useRef, useState } from "react"
import { RegistryContext } from "@effect/atom-react"
import { Terminal, type TerminalHandle } from "@wterm/react"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { Shell } from "@ren/schema/shell"
import { TerminalShell } from "./terminal-shell.js"
import { useMarkTerminalShell } from "./terminal-shells.js"

// oxlint-disable-next-line ren/no-comments -- The Terminal tab. wterm draws the terminal, and TerminalShell adds line editing, history and a working folder on top of Ren's call that runs one command. Commands run one at a time on the chat's computer. Closing the tab stops TerminalShell's reads.
export function TerminalTab(props: { root: Session.ID; focus: string | undefined; folder: string | undefined }) {
  const terminal = useRef<TerminalHandle>(null)
  const [shell, setShell] = useState<TerminalShell.TerminalShell>()
  const start = ChatReact.useAction(props.root, (opened, command: string) => opened.runShell(command))
  const atoms = ChatReact.useAtoms()
  const registry = use(RegistryContext)
  const info = ChatReact.useAction(props.root, (opened, shellID: Shell.ID) => opened.shell(props.root, shellID))
  const output = ChatReact.useAction(props.root, (opened, shellID: Shell.ID, cursor: number) =>
    opened.shellOutput(props.root, shellID, cursor),
  )
  const stop = ChatReact.useAction(props.root, (opened, shellID: Shell.ID) => opened.stopShell(props.root, shellID))
  const mark = useMarkTerminalShell(props.root)
  const io: TerminalShell.Io = {
    write: (data) => terminal.current?.write(data),
    start: (command) => {
      mark.starting(command)
      return start(command)
    },
    // oxlint-disable-next-line ren/no-comments -- A command ends with the shell.exited event that the chat already streams. A fast command can start and exit before this subscribes, so when the chat does not show the shell running, the tab asks Ren once for its status.
    exited: (shellID) => {
      const atom = atoms.shellRunning({ root: props.root, shellID })
      const watch = { seen: registry.get(atom), cancel: () => undefined as void }
      const done = new Promise<void>((resolve) => {
        watch.cancel = registry.subscribe(atom, (running) => {
          if (running) watch.seen = true
          else if (watch.seen) resolve()
        })
        if (!watch.seen)
          void info(shellID).then(
            (current) => (current.status === "running" ? undefined : resolve()),
            () => undefined,
          )
      })
      return { done, cancel: () => watch.cancel() }
    },
    output,
    stop,
    started: mark.started,
  }
  return (
    <div ref={() => shell?.open()} className="flex min-h-0 flex-1 flex-col">
      {/* oxlint-disable-next-line ren/no-comments -- Each request to open the tab remounts this span, which moves the terminal to the requested folder and focuses it. */}
      <span
        key={props.focus}
        hidden
        ref={() => {
          if (props.folder) shell?.moveTo(props.folder)
          terminal.current?.focus()
        }}
      />
      <Terminal
        ref={terminal}
        autoResize
        cursorBlink
        aria-label="Terminal"
        className="min-h-0 flex-1 rounded-none bg-transparent px-4 py-3 shadow-none [--term-bg:var(--background)] [--term-cursor:var(--foreground)] [--term-fg:var(--foreground)] [--term-font-family:var(--font-mono)] [--term-font-size:var(--ren-code-terminal-size)] [--term-row-height:calc(var(--ren-code-terminal-size)*1.5)]"
        onReady={() => {
          const next = TerminalShell.make({ folder: props.folder, io: () => io })
          next.attach()
          setShell(next)
          terminal.current?.focus()
        }}
        onData={(data) => shell?.input(data)}
      />
    </div>
  )
}
