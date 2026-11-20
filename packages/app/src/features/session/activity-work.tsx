import { useState, type ReactNode } from "react"
import { TimelineText } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { Shell } from "@ren/schema/shell"
import { IconAlertCircle, IconChevronDown, IconPlayerStopFilled } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { CodeBlock, CodeBlockContent } from "@ren/ui/code-block"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ren/ui/collapsible"
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { cn } from "cn"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { errorMessage } from "../../lib/errors.js"
import { useNow } from "../../lib/use-now.js"
import { useShellRun } from "./activity-pill.js"
import { customAgent, useWork, type ShellRun, type SubagentRun } from "./chat-view.js"
import { useTerminalShells } from "./terminal-shells.js"
import { toolIcons } from "./tool-icons.js"

type Bulk = "subagents" | "shells"

const confirmations = {
  subagents: {
    title: "Stop all subagents?",
    description: "Every running subagent stops where it is. Ren gets what each one finished so far.",
    action: "Stop subagents",
  },
  shells: {
    title: "Stop all background commands?",
    description: "Every background command is killed. Its output so far stays readable.",
    action: "Stop commands",
  },
} as const

// oxlint-disable-next-line ren/no-comments -- A command the person stopped here can come back as an error from the harness, which lost it; it still reads as stopped.
const ending = (run: ShellRun, options: { readonly stopped: boolean }) => {
  if (run.running) return { text: "Running", failed: false }
  if (options.stopped || run.state === "cancelled") return { text: "Stopped", failed: false }
  if (run.timeout) return { text: "Timed out", failed: true }
  if (run.state === "error") return { text: "Failed", failed: true }
  if (run.exit !== undefined && run.exit !== 0) return { text: `Exited with code ${run.exit}`, failed: true }
  return { text: "Exited", failed: false }
}

// oxlint-disable-next-line ren/no-comments -- Under a turn, lists only the subagents and background commands that the turn's tool calls started.
export function WorkSections(props: {
  root: Session.ID
  tools: ReadonlySet<string> | undefined
  onOpenAgent: (run: SubagentRun) => void
  onOpenShell: (run: ShellRun) => void
}) {
  const work = useWork(props.root)
  const now = useNow(1000)
  const [stopping, setStopping] = useState<ReadonlySet<string>>(() => new Set())
  const [confirming, setConfirming] = useState<Bulk>()
  const stopSession = ChatReact.useAction(props.root, (opened, id: Session.ID) => opened.stop(id))
  const stopShell = ChatReact.useAction(props.root, (opened, sessionID: Session.ID, shellID: Shell.ID) =>
    opened.stopShell(sessionID, shellID),
  )
  const terminal = useTerminalShells(props.root)
  const tools = props.tools
  const subagents = tools ? work.subagents.filter((run) => tools.has(run.tool)) : work.subagents
  const background = work.shells.filter((run) => !terminal.has({ id: run.id, command: run.command }))
  const shells = tools ? background.filter((run) => run.tool !== undefined && tools.has(run.tool)) : background
  if (subagents.length === 0 && shells.length === 0) return null
  const stop = (key: string, run: () => Promise<unknown>, failure: string) => {
    if (stopping.has(key)) return Promise.resolve()
    setStopping((current) => new Set([...current, key]))
    return run().catch((error: unknown) => {
      setStopping((current) => new Set([...current].filter((each) => each !== key)))
      toast.error(failure, { description: errorMessage(error) })
    })
  }
  const stopAgent = (run: SubagentRun) => {
    const child = run.child
    if (!child) return Promise.resolve()
    return stop(run.key, () => stopSession(child), "Could not stop the subagent")
  }
  const stopCommand = (run: ShellRun) =>
    stop(
      run.key,
      () => stopShell(Session.ID.make(run.sessionID), Shell.ID.make(run.id)),
      "Could not stop the background command",
    )
  const runningAgents = subagents.filter((run) => run.running && run.child)
  const runningShells = shells.filter((run) => run.running)
  return (
    <div className="flex flex-col gap-3 pt-5">
      {subagents.length > 0 ? (
        <Section
          title="Subagents"
          count={subagents.length}
          running={runningAgents.length}
          onStopAll={runningAgents.length > 0 ? () => setConfirming("subagents") : undefined}
        >
          {subagents.map((run) => (
            <AgentRow
              key={run.key}
              run={run}
              now={now}
              stopping={run.running && stopping.has(run.key)}
              onOpen={() => props.onOpenAgent(run)}
              onStop={() => void stopAgent(run)}
            />
          ))}
        </Section>
      ) : null}
      {shells.length > 0 ? (
        <Section
          title="Background commands"
          count={shells.length}
          running={runningShells.length}
          onStopAll={runningShells.length > 0 ? () => setConfirming("shells") : undefined}
        >
          {shells.map((run) => (
            <ShellRow
              key={run.key}
              run={run}
              now={now}
              stopping={run.running && stopping.has(run.key)}
              stopped={stopping.has(run.key)}
              onOpen={() => props.onOpenShell(run)}
              onStop={() => void stopCommand(run)}
            />
          ))}
        </Section>
      ) : null}
      <ConfirmDialog
        open={confirming !== undefined}
        onOpenChange={(open) => (open ? undefined : setConfirming(undefined))}
        confirmation={confirmations[confirming ?? "subagents"]}
        onConfirm={() =>
          confirming === "shells"
            ? Promise.all(runningShells.map(stopCommand))
            : Promise.all(runningAgents.map(stopAgent))
        }
      />
    </div>
  )
}

function Section(props: {
  title: string
  count: number
  running: number
  onStopAll: (() => void) | undefined
  children: ReactNode
}) {
  return (
    <Collapsible defaultOpen>
      <section aria-label={props.title} className="flex flex-col">
        <div className="flex h-7 items-center gap-2">
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="group/trigger -ml-2 text-sm font-normal text-muted-foreground aria-expanded:bg-transparent"
              />
            }
          >
            <span className="font-medium text-foreground/90">{props.title}</span>
            <span className="tabular-nums">{props.running > 0 ? `${props.running} running` : props.count}</span>
            <IconChevronDown
              data-icon="inline-end"
              className="-rotate-90 transition-transform duration-150 ease-out group-aria-expanded/trigger:rotate-0 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
          {props.onStopAll ? (
            <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={props.onStopAll}>
              Stop all
            </Button>
          ) : null}
        </div>
        <CollapsibleContent>
          <ul className="flex flex-col pt-1">{props.children}</ul>
        </CollapsibleContent>
      </section>
    </Collapsible>
  )
}

function Row(props: {
  icon: ReactNode
  title: ReactNode
  detail: ReactNode
  end: ReactNode
  running: boolean
  stopping: boolean
  stopLabel: string
  openLabel: string
  onOpen: (() => void) | undefined
  onStop: () => void
}) {
  const body = (
    <>
      <span aria-hidden className="grid size-6 shrink-0 place-items-center text-muted-foreground">
        {props.icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="min-w-0 truncate text-sm text-foreground/90 group-hover/row:text-foreground">
          {props.title}
        </span>
        {props.detail ? <span className="min-w-0 truncate text-xs text-muted-foreground">{props.detail}</span> : null}
      </span>
    </>
  )
  return (
    <li className="group/row -mx-2 flex min-h-9 items-center gap-1 rounded-md px-2 transition-colors hover:bg-muted/60">
      {props.onOpen ? (
        // oxlint-disable-next-line react/forbid-elements -- the whole row opens its subagent or command, as the Activity steps do; a Button would add padding and a fill
        <button
          type="button"
          aria-label={props.openLabel}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm py-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={props.onOpen}
        >
          {body}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 py-1">{body}</span>
      )}
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{props.end}</span>
      {props.running ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={props.stopLabel}
          disabled={props.stopping}
          className="size-6 shrink-0 text-muted-foreground hover:text-destructive [&_svg:not([class*='size-'])]:size-3"
          onClick={props.onStop}
        >
          {props.stopping ? <Spinner className="size-3.5" /> : <IconPlayerStopFilled />}
        </Button>
      ) : null}
    </li>
  )
}

// oxlint-disable-next-line ren/no-comments -- A running subagent or command shows a spinner. Otherwise the row shows the kind's icon, red when it failed.
function agentIcon(run: SubagentRun) {
  if (run.needsInput) return <IconAlertCircle className="size-3.5 text-chart-3" />
  if (run.running) return <Spinner className="size-3.5" />
  return (
    <toolIcons.agent
      className={cn("size-3.5", (run.status === "failed" || run.status === "denied") && "text-destructive")}
    />
  )
}

function agentDetail(run: SubagentRun) {
  const state = (() => {
    if (run.needsInput) return "Needs your input"
    if (run.running) return run.activity ?? "Running"
    if (run.status === "failed") return "Failed"
    if (run.status === "denied") return "Not allowed"
    return "Done"
  })()
  const agent = customAgent(run.agent)
  return agent ? `${agent} · ${state}` : state
}

function AgentRow(props: { run: SubagentRun; now: number; stopping: boolean; onOpen: () => void; onStop: () => void }) {
  const run = props.run
  const ended = run.ended
  return (
    <Row
      icon={agentIcon(run)}
      title={run.description}
      detail={agentDetail(run)}
      end={
        run.running
          ? TimelineText.elapsed(props.now - run.started)
          : ended && TimelineText.duration(ended - run.started)
      }
      running={run.running && run.child !== undefined}
      stopping={props.stopping}
      stopLabel={`Stop ${run.description}`}
      openLabel={`Open ${run.description}`}
      onOpen={run.child ? props.onOpen : undefined}
      onStop={props.onStop}
    />
  )
}

function ShellRow(props: {
  run: ShellRun
  now: number
  stopping: boolean
  stopped: boolean
  onOpen: () => void
  onStop: () => void
}) {
  const run = props.run
  const ended = run.ended
  const end = ending(run, { stopped: props.stopped })
  return (
    <Row
      icon={
        run.running ? (
          <Spinner className="size-3.5" />
        ) : (
          <toolIcons.command className={cn("size-3.5", end.failed && "text-destructive")} />
        )
      }
      title={
        <span dir="ltr" className="font-mono text-xs">
          {run.command}
        </span>
      }
      detail={<span className={cn(end.failed && "text-destructive")}>{end.text}</span>}
      end={
        run.running
          ? TimelineText.elapsed(props.now - run.started)
          : ended && TimelineText.duration(ended - run.started)
      }
      running={run.running}
      stopping={props.stopping}
      stopLabel={`Stop ${run.command}`}
      openLabel={`Open ${run.command}`}
      onOpen={props.onOpen}
      onStop={props.onStop}
    />
  )
}

// oxlint-disable-next-line ren/no-comments -- A background command opened from its row: the command, and its output as it streams.
export function ShellDetail(props: { root: Session.ID; run: ShellRun }) {
  const shell = useShellRun(props.root, { sessionID: props.run.sessionID, id: props.run.id })
  const end = shell.end
  return (
    <div className="flex flex-col gap-3">
      <CodeBlock size="sm" className="border-0 bg-muted dark:bg-muted">
        <CodeBlockContent wrap>{props.run.command}</CodeBlockContent>
      </CodeBlock>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {shell.running ? <Spinner className="size-3.5" /> : null}
        <span className={cn(end?.failed && "text-destructive")}>{shell.running ? "Running" : end?.text}</span>
      </div>
      <CodeBlock size="sm">
        <CodeBlockContent wrap className="min-h-24">
          {shell.output || (
            <span className="text-muted-foreground">{shell.running ? "No output yet" : "No output"}</span>
          )}
        </CodeBlockContent>
      </CodeBlock>
    </div>
  )
}
