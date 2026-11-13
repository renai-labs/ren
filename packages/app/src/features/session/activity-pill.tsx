import { useState, type RefObject } from "react"
import { Family, ShellOutput, TimelineText } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { Shell } from "@ren/schema/shell"
import { IconArrowLeft, IconPlayerStopFilled, IconTerminal2 } from "@tabler/icons-react"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { Button } from "@ren/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@ren/ui/message-scroller"
import { Spinner } from "@ren/ui/spinner"
import { toast } from "@ren/ui/sonner"
import { cn } from "cn"
import { errorMessage } from "../../lib/errors.js"
import { useNow } from "../../lib/use-now.js"
import { useWhen } from "../../lib/use-when.js"

export type ActivityAlign = "left" | "center" | "right"

const tailLines = 14

const aligns = { left: "start", center: "center", right: "end" } as const

const justify = { left: "justify-start", center: "justify-center", right: "justify-end" } as const

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

const summary = (items: ReadonlyArray<Family.Activity>) => {
  const counts = Family.counts(items)
  return [
    counts.subagents > 0 && plural(counts.subagents, "subagent"),
    counts.shells > 0 && plural(counts.shells, "shell"),
  ]
    .filter(Boolean)
    .join(" · ")
}

const stoppable = (item: Family.Activity) => item.id !== undefined && item.sessionID !== undefined

function Elapsed(props: { className?: string | undefined; millis: number }) {
  return (
    <span className={cn("text-xs text-muted-foreground tabular-nums", props.className)}>
      {TimelineText.elapsed(props.millis)}
    </span>
  )
}

function RowEnd(props: { item: Family.Activity; label: string; now: number; stopping: boolean; onStop: () => void }) {
  const hover = "group-hover/dropdown-menu-item:invisible group-focus/dropdown-menu-item:invisible"
  return (
    <span className="relative flex h-5 w-14 shrink-0 items-center justify-end">
      {props.stopping ? (
        <Spinner className="size-3.5" aria-label="Stopping" />
      ) : (
        <>
          <Elapsed millis={props.now - props.item.started} className={stoppable(props.item) ? hover : undefined} />
          {stoppable(props.item) ? (
            <Button
              variant="ghost"
              size="icon-sm"
              tabIndex={-1}
              aria-label={props.label}
              className="absolute inset-y-0 right-0 hidden size-5 group-hover/dropdown-menu-item:flex group-focus/dropdown-menu-item:flex [&_svg:not([class*='size-'])]:size-3.5"
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                props.onStop()
              }}
            >
              <IconPlayerStopFilled />
            </Button>
          ) : null}
        </>
      )}
    </span>
  )
}

function Row(props: {
  item: Family.Activity
  now: number
  stopping: boolean
  onSelect: () => void
  onStop: () => void
}) {
  const item = props.item
  const subagent = item.type === "subagent"
  return (
    <DropdownMenuGroup>
      <DropdownMenuItem
        closeOnClick={subagent && item.id !== undefined}
        onClick={props.onSelect}
        onKeyDown={(event) => {
          if ((event.key !== "Delete" && event.key !== "Backspace") || !stoppable(item)) return
          event.preventDefault()
          props.onStop()
        }}
      >
        {subagent ? <Spinner className="size-3.5" /> : <IconTerminal2 />}
        {subagent ? (
          <span className="shrink-0 font-medium">
            {item.agent ? `${item.agent.slice(0, 1).toUpperCase()}${item.agent.slice(1)}` : "Agent"}
          </span>
        ) : null}
        <span className={cn("min-w-0 flex-1 truncate", subagent ? "text-muted-foreground" : "font-mono text-xs/5")}>
          {item.label}
        </span>
        <RowEnd
          item={item}
          label={subagent ? "Interrupt subagent" : "Kill shell command"}
          now={props.now}
          stopping={props.stopping}
          onStop={props.onStop}
        />
      </DropdownMenuItem>
    </DropdownMenuGroup>
  )
}

function ending(shell: Shell.Info | undefined, options: { readonly missing: boolean }) {
  if (options.missing || shell?.status === "killed") return { text: "Stopped", failed: false }
  if (shell?.status === "timeout") return { text: "Timed out", failed: true }
  if (shell?.exit) return { text: `Exited with code ${shell.exit}`, failed: true }
  return { text: "Exited", failed: false }
}

function useShellRun(root: Session.ID, item: Family.Activity) {
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
    tail: ShellOutput.tail(output, tailLines),
    end: running ? undefined : ending(shell, { missing }),
    completed: shell?.time.completed,
  }
}

function ShellView(props: {
  root: Session.ID
  item: Family.Activity
  now: number
  stopping: boolean
  onBack: () => void
  onStop: () => void
}) {
  const item = props.item
  const run = useShellRun(props.root, item)
  const end = run.end
  const finished = run.completed ?? props.now
  return (
    <>
      <div className="flex items-center gap-2 border-b px-1 pb-1">
        <DropdownMenuGroup>
          <DropdownMenuItem
            aria-label="Back to background work"
            closeOnClick={false}
            className="size-6 shrink-0 justify-center p-0"
            onClick={props.onBack}
          >
            <IconArrowLeft />
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <span dir="ltr" className="min-w-0 flex-1 truncate font-mono text-xs/5">
          {item.label}
        </span>
        <Elapsed millis={(end ? finished : props.now) - item.started} />
        {end ? (
          <output className={cn("px-2 text-xs", end.failed ? "text-destructive" : "text-muted-foreground")}>
            {end.text}
          </output>
        ) : (
          <DropdownMenuGroup>
            <DropdownMenuItem
              closeOnClick={false}
              disabled={props.stopping}
              className="h-6 shrink-0 gap-1.5 px-2 text-xs text-destructive data-highlighted:text-destructive [&_svg:not([class*='size-'])]:size-3"
              onClick={props.onStop}
            >
              <IconPlayerStopFilled />
              {props.stopping ? "Stopping…" : "Stop"}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        )}
      </div>
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="h-60">
          <MessageScrollerViewport>
            <MessageScrollerContent className="px-3 py-2">
              <MessageScrollerItem messageId="output">
                {run.tail ? (
                  <div className="font-mono text-xs/5 wrap-break-word whitespace-pre-wrap">{run.tail}</div>
                ) : (
                  <span className="text-xs text-muted-foreground">No output yet</span>
                )}
              </MessageScrollerItem>
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
    </>
  )
}

function Panel(props: {
  root: Session.ID
  items: ReadonlyArray<Family.Activity>
  shell: Family.Activity | undefined
  stopping: ReadonlySet<string>
  onShell: (item: Family.Activity | undefined) => void
  onOpenChild: (id: Session.ID) => void
  onStop: (item: Family.Activity) => void
}) {
  const now = useNow(1000)
  const shell = props.shell
  if (shell)
    return (
      <ShellView
        root={props.root}
        item={shell}
        now={now}
        stopping={props.stopping.has(shell.key)}
        onBack={() => props.onShell(undefined)}
        onStop={() => props.onStop(shell)}
      />
    )
  return (
    <>
      {props.items.map((item) => (
        <Row
          key={item.key}
          item={item}
          now={now}
          stopping={props.stopping.has(item.key)}
          onSelect={() => {
            if (item.id === undefined) return
            if (item.type === "shell") props.onShell(item)
            else props.onOpenChild(Session.ID.make(item.id))
          }}
          onStop={() => props.onStop(item)}
        />
      ))}
    </>
  )
}

export function ActivityPill(props: {
  root: Session.ID
  items: ReadonlyArray<Family.Activity>
  align: ActivityAlign
  composer: RefObject<HTMLElement | null>
  onOpenChild: (id: Session.ID) => void
}) {
  const [open, setOpen] = useState(false)
  const [shell, setShell] = useState<Family.Activity>()
  const [stopping, setStopping] = useState<ReadonlySet<string>>(() => new Set())
  const [interrupted, setInterrupted] = useState<ReadonlySet<string>>(() => new Set())
  const items = props.items.filter((item) => item.sessionID === undefined || !interrupted.has(item.sessionID))
  const [resting, setResting] = useState(items.length > 0)
  const stopSession = ChatReact.useAction(props.root, (opened, id: Session.ID) => opened.stop(id))
  const stopShell = ChatReact.useAction(props.root, (opened, sessionID: Session.ID, shellID: Shell.ID) =>
    opened.stopShell(sessionID, shellID),
  )
  const visible = items.length > 0 || shell !== undefined
  if (!visible && resting) setResting(false)
  useWhen({
    condition: open && !visible,
    run: () => {
      setOpen(false)
      props.composer.current?.querySelector<HTMLElement>("textarea")?.focus()
    },
  })
  if (!visible) return null
  const stop = (item: Family.Activity) => {
    if (!item.id || !item.sessionID || stopping.has(item.key)) return
    setStopping((current) => new Set([...current, item.key]))
    const sessionID = Session.ID.make(item.sessionID)
    const stopped = item.type === "shell" ? stopShell(sessionID, Shell.ID.make(item.id)) : stopSession(sessionID)
    if (item.type === "subagent") void stopped.then(() => setInterrupted((current) => new Set([...current, sessionID])))
    stopped.catch((error: unknown) => {
      setStopping((current) => new Set([...current].filter((key) => key !== item.key)))
      toast.error(item.type === "shell" ? "Could not kill the shell command" : "Could not interrupt the subagent", {
        description: errorMessage(error),
      })
    })
  }
  return (
    <div className={cn("flex min-w-0", justify[props.align])}>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setShell(undefined)
        }}
      >
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              aria-label={summary(items)}
              className={cn(
                "max-w-full rounded-full text-muted-foreground tabular-nums duration-150 ease-out motion-reduce:animate-none",
                !resting && "animate-in fade-in-0",
              )}
            />
          }
        >
          <Spinner className="size-3.5" aria-hidden />
          <span className="truncate">{summary(items)}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align={aligns[props.align]}
          aria-label={summary(items)}
          className="w-96 max-w-(--available-width)"
        >
          <Panel
            root={props.root}
            items={items}
            shell={shell}
            stopping={stopping}
            onShell={setShell}
            onOpenChild={props.onOpenChild}
            onStop={stop}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
