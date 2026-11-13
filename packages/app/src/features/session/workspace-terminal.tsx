import { useState } from "react"
import { TimelineText } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { Shell } from "@ren/schema/shell"
import { IconPlayerStopFilled, IconTerminal2 } from "@tabler/icons-react"
import { AsyncResult } from "effect/reactivity"
import { Button } from "@ren/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@ren/ui/input-group"
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@ren/ui/message-scroller"
import { Spinner } from "@ren/ui/spinner"
import { errorMessage } from "../../lib/errors.js"

interface Run {
  readonly id: string
  readonly command: string
  readonly shell?: Shell.Info
  readonly error?: string
}

function Prompt(props: { command: string; byRen?: boolean | undefined }) {
  return (
    <div className="flex gap-2 whitespace-pre-wrap">
      <span className="shrink-0 text-muted-foreground select-none">{props.byRen ? "ren $" : "$"}</span>
      <span className="min-w-0 wrap-break-word">{props.command}</span>
    </div>
  )
}

function Command(props: { root: Session.ID; shell: Shell.Info; byRen?: boolean }) {
  const view = { root: props.root, sessionID: props.shell.sessionID, shellID: props.shell.id }
  const info = ChatReact.useShell(view)
  const current = AsyncResult.getOrElse(info, () => props.shell)
  const live = ChatReact.useShellRunning(props.root, props.shell.id)
  const running = !AsyncResult.isFailure(info) && (live || current.status === "running")
  const output = AsyncResult.getOrElse(ChatReact.useShellOutput({ ...view, running }), () => "")
  const stop = ChatReact.useAction(props.root, (opened) => opened.stopShell(props.shell.sessionID, props.shell.id))
  const end = AsyncResult.isFailure(info) ? "Cancelled" : TimelineText.shellError(current)
  return (
    <div className="flex flex-col gap-1">
      <Prompt command={props.shell.command} byRen={props.byRen} />
      {output ? <div className="wrap-break-word whitespace-pre-wrap">{TimelineText.shellOutput(output)}</div> : null}
      {running ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner className="size-3" />
          Running
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-muted-foreground"
            onClick={() => void stop().catch(() => undefined)}
          >
            <IconPlayerStopFilled data-icon="inline-start" />
            Stop
          </Button>
        </div>
      ) : null}
      {end ? <div className="text-destructive">{end}</div> : null}
    </div>
  )
}

function Starting(props: { command: string; error: string | undefined }) {
  return (
    <div className="flex flex-col gap-1">
      <Prompt command={props.command} />
      {props.error ? <div className="text-destructive">{props.error}</div> : <Spinner className="size-3" />}
    </div>
  )
}

export function TerminalTab(props: { root: Session.ID }) {
  const [runs, setRuns] = useState<ReadonlyArray<Run>>([])
  const [command, setCommand] = useState("")
  const runShell = ChatReact.useAction(props.root, (opened, text: string) => opened.runShell(text))
  const live = ChatReact.useRunningShells(props.root)
  const others = Object.values(live ?? {}).filter((shell) => !runs.some((run) => run.shell?.id === shell.id))
  const update = (id: string, change: Partial<Run>) =>
    setRuns((previous) => previous.map((run) => (run.id === id ? { ...run, ...change } : run)))
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {runs.length === 0 && others.length === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia className="text-muted-foreground [&_svg]:size-6">
              <IconTerminal2 />
            </EmptyMedia>
            <EmptyTitle>Terminal</EmptyTitle>
            <EmptyDescription>
              Commands you run here and the ones Ren is running show up with their output.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <MessageScrollerProvider autoScroll>
          <MessageScroller className="flex-1">
            <MessageScrollerViewport>
              <MessageScrollerContent className="gap-4 px-4 py-2 font-mono text-(length:--ren-code-terminal-size)/5">
                {others.map((shell) => (
                  <MessageScrollerItem key={shell.id} messageId={shell.id}>
                    <Command root={props.root} shell={shell} byRen />
                  </MessageScrollerItem>
                ))}
                {runs.map((run) => (
                  <MessageScrollerItem key={run.id} messageId={run.id}>
                    {run.shell ? (
                      <Command root={props.root} shell={run.shell} />
                    ) : (
                      <Starting command={run.command} error={run.error} />
                    )}
                  </MessageScrollerItem>
                ))}
              </MessageScrollerContent>
            </MessageScrollerViewport>
          </MessageScroller>
        </MessageScrollerProvider>
      )}
      <form
        className="shrink-0 px-3 pt-1 pb-3"
        onSubmit={(event) => {
          event.preventDefault()
          const text = command.trim()
          if (!text) return
          const id = crypto.randomUUID()
          setRuns((previous) => [...previous, { id, command: text }])
          setCommand("")
          runShell(text).then(
            (shell) => update(id, { shell }),
            (error: unknown) => update(id, { error: errorMessage(error) }),
          )
        }}
      >
        <InputGroup className="font-mono">
          <InputGroupAddon className="text-muted-foreground">$</InputGroupAddon>
          <InputGroupInput
            aria-label="Command"
            placeholder="ls -la"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </InputGroup>
      </form>
    </div>
  )
}
