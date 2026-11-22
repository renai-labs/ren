import { useRef, useState } from "react"
import { Activity, PatchFiles, TimelineDetail, TimelineText, ToolDisplay, ToolState } from "@ren/chat"
import { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { IconBrain, IconChevronRight, IconMessage, IconTimeline } from "@tabler/icons-react"
import { DateTime } from "effect"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
  useHighlightedCode,
} from "@ren/ui/code-block"
import { Link } from "@ren/ui/link"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { formatClock } from "@ren/ui/time"
import { cn } from "cn"
import { AppIcon } from "../../components/app-icon.js"
import { Markdown } from "../../components/markdown.js"
import { LinkIcon } from "../../components/markdown-link.js"
import { ChatPreferences } from "../../lib/chat-preferences.js"
import { Preference } from "../../lib/preference.js"
import { useApp } from "../../lib/use-app.js"
import { usePinToEnd } from "../../lib/use-pin-to-end.js"
import { ShellDetail, WorkProvider, WorkSections, type ShellReport } from "./activity-work.js"
import { useTerminalShells } from "./terminal-shells.js"
import { SubagentThread } from "./subagent-thread.js"
import { DiffFile } from "./diff-file.js"
import { toolIcons } from "./tool-icons.js"

type Item =
  | {
      readonly kind: "thinking"
      readonly key: string
      readonly text: string
      readonly running: boolean
      readonly millis: number | undefined
    }
  | { readonly kind: "tool"; readonly key: string; readonly tool: SessionMessage.Tool }
  | { readonly kind: "shell"; readonly key: string; readonly message: SessionMessage.Shell }
  | { readonly kind: "update"; readonly key: string; readonly text: string }

interface Turn {
  readonly id: string
  readonly prompt: string
  readonly at: number
  readonly items: ReadonlyArray<Item>
  readonly listed?: number
}

const millis = (time: DateTime.Utc) => DateTime.toEpochMillis(time)

type Step = Extract<Item, { kind: "tool" | "shell" }>

const thinkingOf = (message: SessionMessage.Assistant, content: SessionMessage.Reasoning, key: string): Item => {
  const time = content.time
  return {
    kind: "thinking",
    key,
    text: content.text.trim(),
    running: !time?.completed && !message.time.completed,
    millis: time?.completed ? millis(time.completed) - millis(time.created) : undefined,
  }
}

const itemsOf = (message: SessionMessage.Info, detail: TimelineDetail.Detail): ReadonlyArray<Item> => {
  if (message.type === "shell")
    return detail.shell.placement === "hidden" ? [] : [{ kind: "shell", key: message.id, message }]
  if (message.type !== "assistant") return []
  return message.content.flatMap((content, index): ReadonlyArray<Item> => {
    const key = `${message.id}:${index}`
    const category = TimelineDetail.category(content)
    if (category && detail[category].placement === "hidden") return []
    if (content.type === "reasoning") return [thinkingOf(message, content, key)]
    if (content.type === "text") return content.text.trim() ? [{ kind: "update", key, text: content.text.trim() }] : []
    return Activity.listed(content) ? [{ kind: "tool", key, tool: content }] : []
  })
}

// oxlint-disable-next-line ren/no-comments -- What Ren wrote before a tool call is an update and stays in the turn; text after the last tool call is the answer, which the chat shows, so it leaves.
const withUpdates = (items: ReadonlyArray<Item>) => {
  const lastWork = items.findLastIndex((item) => item.kind === "tool" || item.kind === "shell")
  return items.filter((item, index) => item.kind !== "update" || index < lastWork)
}

const turnsOf = (messages: ReadonlyArray<SessionMessage.Info>, detail: TimelineDetail.Detail): ReadonlyArray<Turn> =>
  messages
    .reduce<Array<{ id: string; prompt: string; at: number; items: Array<Item> }>>((turns, message) => {
      if (message.type === "user") {
        turns.push({ id: message.id, prompt: message.text, at: millis(message.time.created), items: [] })
        return turns
      }
      const items = itemsOf(message, detail)
      if (items.length === 0) return turns
      const last = turns.at(-1)
      if (last) last.items.push(...items)
      else turns.push({ id: message.id, prompt: "", at: millis(message.time.created), items: [...items] })
      return turns
    }, [])
    .map((turn) => Object.assign(turn, { items: withUpdates(turn.items) }))

const titleOf = (item: Step) => (item.kind === "shell" ? `Ran ${item.message.command}` : Activity.of(item.tool).text)

const changes = (tool: SessionMessage.Tool) =>
  PatchFiles.isFileChange(tool) && ToolDisplay.status(tool) === "completed"
    ? PatchFiles.patchFiles(PatchFiles.toolFiles(tool))
    : []

const pageOf = (tool: SessionMessage.Tool | undefined) => {
  const url = tool?.name === "webfetch" ? ToolState.input(tool).url : undefined
  return typeof url === "string" && URL.canParse(url) ? url : undefined
}

function StepIcon(props: { tool: SessionMessage.Tool | undefined }) {
  const line = props.tool ? Activity.of(props.tool) : undefined
  const app = useApp(line?.app).app
  const page = pageOf(props.tool)
  if (app) return <AppIcon name={app.name} icon={app.icon} className="size-4 rounded-sm" />
  if (page) return <LinkIcon href={page} streaming={false} className="size-4 shrink-0" />
  const Icon = props.tool ? toolIcons[ToolDisplay.kind(props.tool)] : toolIcons.command
  return <Icon className="size-3.5" />
}

function Connector(props: { last: boolean }) {
  if (props.last) return null
  return <div aria-hidden className="absolute top-6 bottom-0 left-3 w-px -translate-x-1/2 bg-border" />
}

const thoughtTitle = (item: Extract<Item, { kind: "thinking" }>) => {
  if (item.running) return "Thinking"
  const took = item.millis === undefined ? undefined : TimelineText.duration(item.millis)
  return took && took !== "0s" ? `Thought for ${took}` : "Thought"
}

function ThinkingStep(props: { item: Extract<Item, { kind: "thinking" }>; last: boolean }) {
  const [open, setOpen] = useState(false)
  const item = props.item
  const text = item.text
  const title = (
    <>
      <span aria-hidden className="grid size-6 shrink-0 place-items-center">
        <IconBrain className="size-3.5" />
      </span>
      <span
        className={cn(
          "min-w-0 truncate font-medium text-foreground/80",
          text &&
            "underline decoration-border decoration-1 underline-offset-3 transition-colors group-hover/step:text-foreground group-hover/step:decoration-muted-foreground/60",
          item.running && "shimmer motion-reduce:shimmer-none",
        )}
      >
        {thoughtTitle(item)}
      </span>
    </>
  )
  return (
    <div className="relative pb-2">
      <Connector last={props.last} />
      {text ? (
        // oxlint-disable-next-line react/forbid-elements -- a step is a plain underlined line, as in the reference design; a Button would add padding and a fill
        <button
          type="button"
          aria-expanded={open}
          className={cn(
            "group/step flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm text-left text-sm text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            !open && "before:absolute before:inset-0",
          )}
          onClick={() => setOpen((current) => !current)}
        >
          {title}
        </button>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">{title}</div>
      )}
      {text && !open ? (
        <Markdown className="max-h-15 overflow-hidden mask-b-from-40% pl-7.5 text-sm/5 text-muted-foreground/90 italic">
          {text}
        </Markdown>
      ) : null}
      {text && open ? <Markdown className="pl-7.5 text-sm/5 text-muted-foreground">{text}</Markdown> : null}
    </div>
  )
}

function Sources(props: { tool: SessionMessage.Tool }) {
  const links = ToolDisplay.links(props.tool).filter((link) => URL.canParse(link))
  if (links.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1 pt-1 pl-7.5">
      {links.slice(0, 8).map((link) => (
        <Link
          key={link}
          href={link}
          external
          appearance="plain"
          title={link}
          className="inline-flex max-w-56 items-center gap-1.5 rounded-md bg-muted py-0.5 pr-2 pl-1.5 text-xs text-foreground outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <LinkIcon href={link} streaming={false} className="size-3.5 shrink-0" />
          <span className="truncate">{new URL(link).hostname.replace(/^www\./u, "")}</span>
        </Link>
      ))}
    </div>
  )
}

function Answers(props: { tool: SessionMessage.Tool }) {
  const answers = ToolDisplay.answers(props.tool)
  if (answers.length === 0) return null
  return (
    <div className="flex flex-col gap-1 pt-0.5 pl-7.5 text-sm text-muted-foreground">
      {answers.map((each) => (
        <span key={each.question} className="line-clamp-1">
          {each.question}: {each.answer}
        </span>
      ))}
    </div>
  )
}

function Changed(props: { tool: SessionMessage.Tool }) {
  const files = changes(props.tool)
  if (files.length === 0) return null
  const additions = files.reduce((total, file) => total + file.additions, 0)
  const deletions = files.reduce((total, file) => total + file.deletions, 0)
  return (
    <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
      +{additions} −{deletions}
    </span>
  )
}

// oxlint-disable-next-line ren/no-comments -- What Ren wrote between tool calls, grey and in line with the step titles.
function UpdateStep(props: { text: string; last: boolean }) {
  return (
    <div className="relative pb-2">
      <Connector last={props.last} />
      <Markdown className="pl-7.5 text-sm/relaxed text-muted-foreground">{props.text}</Markdown>
    </div>
  )
}

function ToolStep(props: {
  item: Step
  last: boolean
  onOpen: () => void
  onOpenAgent: (id: Session.ID, title: string) => void
}) {
  const tool = props.item.kind === "tool" ? props.item.tool : undefined
  const status = tool ? ToolDisplay.status(tool) : statusOfShell(props.item)
  const child = tool && ToolDisplay.kind(tool) === "agent" ? ToolState.metadata(tool).sessionID : undefined
  const title = titleOf(props.item)
  const open =
    typeof child === "string" && child.startsWith("ses_")
      ? () => props.onOpenAgent(Session.ID.make(child), title)
      : props.onOpen
  return (
    <div className="relative pb-2">
      <Connector last={props.last} />
      <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
        {/* oxlint-disable-next-line react/forbid-elements -- a step is a plain underlined line, as in the reference design; a Button would add padding and a fill */}
        <button
          type="button"
          className="group/step flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={open}
        >
          <span aria-hidden className="grid size-6 shrink-0 place-items-center">
            <StepIcon tool={tool} />
          </span>
          <span
            className={cn(
              "min-w-0 truncate font-medium text-foreground/80 underline decoration-border decoration-1 underline-offset-3 transition-colors group-hover/step:text-foreground group-hover/step:decoration-muted-foreground/60",
              status === "running" && "shimmer motion-reduce:shimmer-none",
              status === "failed" && "text-destructive decoration-destructive/40",
            )}
          >
            {title}
          </span>
        </button>
        {tool ? <Changed tool={tool} /> : null}
      </div>
      {tool ? <Answers tool={tool} /> : null}
      {tool ? <Sources tool={tool} /> : null}
    </div>
  )
}

const statusOfShell = (item: Step): ToolDisplay.Status => {
  if (item.kind !== "shell") return "completed"
  if (item.message.status === "running") return "running"
  return item.message.exit !== undefined && item.message.exit !== 0 ? "failed" : "completed"
}

function Steps(props: {
  items: ReadonlyArray<Item>
  closed: boolean
  onOpen: (key: string) => void
  onOpenAgent: (id: Session.ID, title: string) => void
}) {
  return props.items.map((item, index) => {
    const last = props.closed && index === props.items.length - 1
    if (item.kind === "thinking") return <ThinkingStep key={item.key} item={item} last={last} />
    if (item.kind === "update") return <UpdateStep key={item.key} text={item.text} last={last} />
    return (
      <ToolStep
        key={item.key}
        item={item}
        last={last}
        onOpen={() => props.onOpen(item.key)}
        onOpenAgent={props.onOpenAgent}
      />
    )
  })
}

function TurnHeader(props: { turn: Turn; onOpen: () => void }) {
  return (
    // oxlint-disable-next-line react/forbid-elements -- the header reads as a caption; a Button would add padding and a fill
    <button
      type="button"
      className="group/turn mt-4 mb-2 flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm text-left text-sm text-muted-foreground outline-none first:mt-0 focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={props.onOpen}
    >
      <IconMessage aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate text-foreground/90 group-hover/turn:text-foreground">
        {props.turn.prompt || "Ren’s own work"}
      </span>
      <span className="ml-auto shrink-0 tabular-nums">{formatClock(props.turn.at)}</span>
    </button>
  )
}

function Crumbs(props: {
  trail: ReadonlyArray<{ readonly label: string; readonly onOpen?: (() => void) | undefined }>
}) {
  return (
    <nav aria-label="Activity location" className="flex min-w-0 items-center gap-1 text-sm">
      {props.trail.map((crumb, index) => (
        <span key={crumb.label} className="flex min-w-0 items-center gap-1">
          {index > 0 ? <IconChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /> : null}
          {crumb.onOpen ? (
            // oxlint-disable-next-line react/forbid-elements -- a breadcrumb link inside the panel
            <button
              type="button"
              className="min-w-0 cursor-pointer truncate rounded-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={crumb.onOpen}
            >
              {crumb.label}
            </button>
          ) : (
            <span className="min-w-0 truncate text-foreground" aria-current="page">
              {crumb.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  )
}

function CommandInput(props: { command: string }) {
  const lines = useHighlightedCode(props.command, "bash")
  return (
    <CodeBlock size="sm">
      <CodeBlockHeader>
        <CodeBlockTitle>Input</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={props.command} aria-label="Copy input" />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent wrap lineNumbers className="max-h-64">
        {lines.map((line, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- a line's position is its identity in highlighted code
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  )
}

function Pane(props: { title: string; text: string; failed?: boolean | undefined }) {
  return (
    <CodeBlock size="sm" variant={props.failed ? "destructive" : "default"}>
      <CodeBlockHeader>
        <CodeBlockTitle>{props.title}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={props.text} aria-label={`Copy ${props.title.toLowerCase()}`} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent wrap className="max-h-[50dvh]">
        {props.text}
      </CodeBlockContent>
    </CodeBlock>
  )
}

const inputText = (tool: SessionMessage.Tool) => {
  const input = Object.fromEntries(Object.entries(ToolState.input(tool)).filter((entry) => entry[0] !== "activity"))
  const code = input.code
  return typeof code === "string" ? code : JSON.stringify(input, null, 2)
}

function StepDetail(props: { item: Step }) {
  const item = props.item
  if (item.kind === "shell")
    return (
      <>
        <CommandInput command={item.message.command} />
        <Pane title="Output" text={item.message.output?.output || "No output"} />
      </>
    )
  const tool = item.tool
  const command = ToolDisplay.command(tool)
  const error = ToolDisplay.error(tool)
  const output = error ?? ToolDisplay.output(tool)
  const files = changes(tool)
  return (
    <>
      {command ? <CommandInput command={command} /> : <Pane title="Input" text={inputText(tool)} />}
      {files.map((file) => (
        <DiffFile key={file.path} view={file.view} capped />
      ))}
      {output ? <Pane title={error ? "Error" : "Output"} text={output} failed={Boolean(error)} /> : null}
      {!output && ToolDisplay.status(tool) === "running" ? (
        <p className="shimmer text-sm text-muted-foreground motion-reduce:shimmer-none">Running…</p>
      ) : null}
    </>
  )
}

const preview = (text: string) => {
  const line = text.replaceAll(/\s+/gu, " ").trim()
  return line.length > 48 ? `${line.slice(0, 47)}…` : line
}

interface Agent {
  readonly id: Session.ID
  readonly title: string
  readonly turn: string | undefined
}

type View = {
  readonly turn?: string | undefined
  readonly step?: string | undefined
  readonly agent?: Agent | undefined
  readonly shell?: { readonly id: string; readonly sessionID?: string | undefined; readonly command: string }
  readonly report?: ShellReport | undefined
}

const located = (turns: ReadonlyArray<Turn>, view: View) => {
  const owner = view.step ? turns.find((each) => each.items.some((item) => item.key === view.step)) : undefined
  const step = owner?.items.find((item) => item.key === view.step)
  return {
    turn: view.turn ? turns.find((each) => each.id === view.turn) : owner,
    step: step?.kind === "thinking" || step?.kind === "update" ? undefined : step,
  }
}

function Timeline(props: {
  turns: ReadonlyArray<Turn>
  turn: Turn | undefined
  live: boolean
  onTurn: (id: string) => void
  onStep: (key: string) => void
  onOpenAgent: (id: Session.ID, title: string, turn: string) => void
}) {
  const shown = props.turn
  if (shown?.items.length === 0 && !shown.listed)
    return (
      <p className="py-2 text-sm text-muted-foreground">
        {props.live && props.turns.at(-1)?.id === shown.id ? "No steps yet." : "No steps to show in this turn."}
      </p>
    )
  if (shown)
    return (
      <Steps
        items={shown.items}
        closed={!props.live}
        onOpen={props.onStep}
        onOpenAgent={(id, title) => props.onOpenAgent(id, title, shown.id)}
      />
    )
  return props.turns.map((turn, index) => (
    <section key={turn.id} aria-label={turn.prompt || "Ren’s own work"}>
      <TurnHeader turn={turn} onOpen={() => props.onTurn(turn.id)} />
      <Steps
        items={turn.items}
        closed={!props.live || index < props.turns.length - 1}
        onOpen={props.onStep}
        onOpenAgent={(id, title) => props.onOpenAgent(id, title, turn.id)}
      />
    </section>
  ))
}

const toolsOf = (turn: Turn): ReadonlySet<string> =>
  new Set(turn.items.flatMap((item) => (item.kind === "tool" ? [item.tool.id] : [])))

const turnLabel = (turn: Turn) => preview(turn.prompt) || "Ren’s own work"

type Crumb = { readonly label: string; readonly onOpen?: (() => void) | undefined }

const all = (go: (view: View) => void): Crumb => ({ label: "All activity", onOpen: () => go({}) })

const trailOf = (place: ReturnType<typeof located>, go: (view: View) => void): ReadonlyArray<Crumb> => {
  const turn = place.turn
  const step = place.step
  if (!turn && !step) return [{ label: "All activity" }]
  if (!step) return [all(go), { label: turn ? turnLabel(turn) : "" }]
  return [
    all(go),
    ...(turn ? [{ label: turnLabel(turn), onOpen: () => go({ turn: turn.id }) }] : []),
    { label: titleOf(step) },
  ]
}

const agentTrail = (
  agent: Agent,
  input: { readonly parent: Turn | undefined; readonly go: (view: View) => void },
): ReadonlyArray<Crumb> => {
  const parent = input.parent
  return [
    all(input.go),
    ...(parent ? [{ label: turnLabel(parent), onOpen: () => input.go({ turn: parent.id }) }] : []),
    { label: agent.title },
  ]
}

type Request = { readonly id: string; readonly turn?: string | undefined; readonly shell?: ShellReport | undefined }

const viewOf = (request: Request | undefined): View => {
  const report = request?.shell
  return report ? { shell: report, report } : { turn: request?.turn }
}

export function ActivityTab(props: {
  root: Session.ID
  messages: ReadonlyArray<SessionMessage.Info>
  request?: Request | undefined
  running: boolean
}) {
  const [view, setView] = useState<View>(() => viewOf(props.request))
  const [handled, setHandled] = useState(props.request?.id)
  if (props.request && props.request.id !== handled) {
    setHandled(props.request.id)
    setView(viewOf(props.request))
  }
  const go = (next: View) => setView(next)
  const agent = view.agent
  const shell = view.shell
  const terminal = useTerminalShells(props.root)
  const detail = Preference.usePreference(ChatPreferences.timelineDetail)
  const turns = turnsOf(
    props.messages.filter((message) => !terminal.message(message)),
    detail,
  )
  if (shell)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center border-b px-4">
          <Crumbs trail={[all(go), { label: preview(shell.command) }]} />
        </div>
        <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto overscroll-contain px-4 py-3">
          <ShellDetail root={props.root} shell={shell} report={view.report} />
        </div>
      </div>
    )
  if (agent)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center border-b px-4">
          <Crumbs trail={agentTrail(agent, { parent: turns.find((turn) => turn.id === agent.turn), go })} />
        </div>
        <SubagentThread
          root={props.root}
          child={agent.id}
          onOpenChild={(id) => go({ agent: { id, title: "Subagent", turn: agent.turn } })}
        />
      </div>
    )
  return <ActivityList root={props.root} turns={turns} view={view} go={go} running={props.running} />
}

function ActivityList(props: {
  root: Session.ID
  turns: ReadonlyArray<Turn>
  view: View
  go: (view: View) => void
  running: boolean
}) {
  const place = located(props.turns, props.view)
  const go = props.go
  return (
    <WorkProvider
      root={props.root}
      tools={place.turn ? toolsOf(place.turn) : undefined}
      onOpenAgent={(run) => {
        if (!run.child) return
        const turn = props.turns.find((each) => toolsOf(each).has(run.tool))
        go({ agent: { id: run.child, title: run.description, turn: turn?.id } })
      }}
      onOpenShell={(run) => go({ shell: run })}
    >
      {(listed) => <ActivityBody {...props} listed={listed} />}
    </WorkProvider>
  )
}

function ActivityBody(props: {
  turns: ReadonlyArray<Turn>
  view: View
  go: (view: View) => void
  running: boolean
  listed: ReadonlySet<string>
}) {
  const [pinned, setPinned] = useState(true)
  const list = useRef<HTMLDivElement>(null)
  const view = props.view
  const go = props.go
  const place = located(props.turns, view)
  const count = props.turns.reduce((total, turn) => total + turn.items.length, 0)
  usePinToEnd(list, { pinned: pinned && !place.step, count })
  const turns = props.turns.map((turn) => {
    const items = turn.items.filter((item) => item.kind !== "tool" || !props.listed.has(item.tool.id))
    return { ...turn, items, listed: turn.items.length - items.length }
  })
  const turn = place.turn ? turns.find((each) => each.id === place.turn?.id) : undefined
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center border-b px-4">
        <Crumbs trail={trailOf(place, go)} />
      </div>
      {props.turns.length === 0 && !place.step ? (
        <ActivityEmpty />
      ) : (
        <div
          ref={list}
          className="min-h-0 flex-1 scrollbar-thin overflow-y-auto overscroll-contain px-4 py-3"
          onScroll={(event) => {
            const node = event.currentTarget
            const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24
            if (pinned !== atBottom) setPinned(atBottom)
          }}
        >
          {place.step ? (
            <div className="flex flex-col gap-3">
              <StepDetail item={place.step} />
            </div>
          ) : (
            <>
              <div role="log" aria-label="Activity" className="flex flex-col">
                <Timeline
                  turns={turns}
                  turn={turn}
                  live={props.running}
                  onTurn={(id) => go({ turn: id })}
                  onStep={(key) => go({ ...view, step: key })}
                  onOpenAgent={(id, title, at) => go({ agent: { id, title, turn: at } })}
                />
              </div>
              <WorkSections className="pt-5" />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ActivityEmpty() {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia className="text-muted-foreground [&_svg]:size-6">
          <IconTimeline />
        </EmptyMedia>
        <EmptyTitle>Nothing yet</EmptyTitle>
        <EmptyDescription>Every step Ren takes in this chat shows up here.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
