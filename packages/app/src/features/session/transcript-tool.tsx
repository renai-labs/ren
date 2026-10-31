import { type ChatAtoms, PatchFiles, TimelineText, ToolDisplay, ToolState } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import type { Shell } from "@ren/schema/shell"
import { Button } from "@ren/ui/button"
import { CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from "@ren/ui/code-block"
import { ImageLightbox } from "@ren/ui/image-lightbox"
import { Link } from "@ren/ui/link"
import { Markdown } from "@ren/ui/markdown"
import { Spinner } from "@ren/ui/spinner"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@ren/ui/trace"
import { IconBrain, IconChevronRight, IconExternalLink, IconInfoCircle } from "@tabler/icons-react"
import { AsyncResult } from "effect/reactivity"
import type { ReactNode } from "react"
import { ChatView } from "./chat-view.js"
import { ToolIcons } from "./tool-icons.js"

type Status = "running" | "error" | undefined

const statusOf = (status: ToolDisplay.Status): Status => {
  if (status === "running") return "running"
  return status === "failed" ? "error" : undefined
}

export function Output(props: { text: string; failed?: boolean | undefined; title?: string | undefined }) {
  return (
    <CodeBlock size="sm" variant={props.failed ? "destructive" : "default"}>
      {props.title ? (
        <CodeBlockHeader>
          <CodeBlockTitle>{props.title}</CodeBlockTitle>
        </CodeBlockHeader>
      ) : null}
      <CodeBlockContent wrap className="max-h-64">
        {props.text}
      </CodeBlockContent>
    </CodeBlock>
  )
}

function Expandable(props: { content: ReactNode; defaultOpen: boolean; children: ReactNode }) {
  if (!props.content) return props.children
  return (
    <TraceCollapsible defaultOpen={props.defaultOpen}>
      <TraceCollapsibleTrigger>{props.children}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-2">{props.content}</TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

export function Step(props: {
  icon: ReactNode
  title: string
  subject?: string | undefined
  detail?: string | undefined
  status?: Status
  defaultOpen?: boolean
  children?: ReactNode
}) {
  return (
    <Trace>
      <Expandable content={props.children} defaultOpen={props.defaultOpen === true}>
        <TraceLine status={props.status}>
          <TraceIcon>{props.status === "running" ? <Spinner /> : props.icon}</TraceIcon>
          <TraceTitle className="shrink-0">{props.title}</TraceTitle>
          {props.subject ? (
            <TraceDescription className="min-w-0 shrink truncate font-mono text-xs" title={props.subject}>
              {props.subject}
            </TraceDescription>
          ) : null}
          {props.detail ? <TraceDescription>{props.detail}</TraceDescription> : null}
        </TraceLine>
      </Expandable>
    </Trace>
  )
}

export function Note(props: { title: string; detail?: string | undefined }) {
  return (
    <Trace>
      <TraceLine>
        <TraceIcon>
          <IconInfoCircle />
        </TraceIcon>
        <TraceTitle>{props.title}</TraceTitle>
        {props.detail ? <TraceDescription className="min-w-0 shrink truncate">{props.detail}</TraceDescription> : null}
      </TraceLine>
    </Trace>
  )
}

export function Reasoning(props: { text: string; streaming: boolean; duration?: string | undefined; open?: boolean }) {
  const text = props.text.trim()
  return (
    <Step
      icon={<IconBrain />}
      title={props.streaming ? "Thinking" : "Thought"}
      detail={props.streaming ? undefined : props.duration}
      status={props.streaming ? "running" : undefined}
      defaultOpen={props.open === true}
    >
      {text ? (
        <Markdown streaming={props.streaming} className="text-muted-foreground">
          {text}
        </Markdown>
      ) : null}
    </Step>
  )
}

function Diff(props: { group: PatchFiles.Group; titled: boolean }) {
  return props.group.views.map((view) => (
    <CodeBlock key={view.diff.cacheKey} size="sm">
      {props.titled ? (
        <CodeBlockHeader>
          <CodeBlockTitle>{props.group.path}</CodeBlockTitle>
        </CodeBlockHeader>
      ) : null}
      <CodeBlockContent wrap className="max-h-64" aria-label={`Changes in ${view.file}`}>
        {view.diff.hunks
          .flatMap((hunk) => hunk.lines)
          .map((line, index) => (
            <CodeBlockLine
              // oxlint-disable-next-line react/no-array-index-key -- diff lines have no identity besides their place
              key={index}
              variant={lineVariants[line.type]}
            >
              {line.text.replace(/\n$/u, "")}
            </CodeBlockLine>
          ))}
      </CodeBlockContent>
    </CodeBlock>
  ))
}

const lineVariants = { addition: "added", deletion: "removed", context: "default" } as const

const changeLabel: Readonly<Record<PatchFiles.Kind, string>> = { add: "Created", delete: "Deleted", update: "Edited" }

export function FileChanges(props: { tools: ReadonlyArray<SessionMessage.Tool>; open?: boolean }) {
  const groups = PatchFiles.groups(props.tools)
  const first = groups.at(0)
  if (!first) return null
  const additions = groups.reduce((total, group) => total + group.additions, 0)
  const deletions = groups.reduce((total, group) => total + group.deletions, 0)
  return (
    <Step
      icon={ToolIcons.of("edit")}
      title={groups.length === 1 ? changeLabel[first.type] : `Edited ${groups.length} files`}
      subject={groups.length === 1 ? first.path : undefined}
      detail={`+${additions} −${deletions}`}
      defaultOpen={props.open === true}
    >
      {groups.map((group) => (
        <Diff key={group.path} group={group} titled={groups.length > 1} />
      ))}
    </Step>
  )
}

const images = (tool: SessionMessage.Tool) =>
  "content" in tool.state
    ? tool.state.content.flatMap((item) =>
        item.type === "file" && item.mime.startsWith("image/") && /^(data:|https?:)/.test(item.uri) ? [item] : [],
      )
    : []

const subjectOf = (tool: SessionMessage.Tool) => {
  const subject = ToolDisplay.subtitle(tool)
  if (tool.name === "shell" && tool.state.status === "streaming" && !subject) return "Writing command…"
  return [subject, ToolDisplay.matches(tool)].filter(Boolean).join(" · ") || undefined
}

const inputShown: ReadonlySet<ToolDisplay.Kind> = new Set(["tool", "web", "agent"])

function ToolBody(props: { tool: SessionMessage.Tool; output: string | undefined; failed: boolean }) {
  const tool = props.tool
  const error = ToolDisplay.error(tool)
  const answers = ToolDisplay.answers(tool)
  const links = ToolDisplay.links(tool)
  const pictures = images(tool)
  const input = ToolState.input(tool)
  return (
    <>
      {inputShown.has(ToolDisplay.kind(tool)) && Object.keys(input).length > 0 ? (
        <Output title="Input" text={JSON.stringify(input, null, 2)} />
      ) : null}
      {answers.length > 0 ? (
        <dl className="flex min-w-0 flex-col gap-2">
          {answers.map((item) => (
            <div key={item.question} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">{item.question}</dt>
              <dd className="text-sm whitespace-pre-wrap text-foreground">{item.answer}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {links.length > 0 ? (
        <nav aria-label="Search results" className="flex min-w-0 flex-col gap-1">
          {links.map((url) => (
            <Link key={url} href={url} appearance="quiet" external>
              <span className="flex min-w-0 items-center gap-1 text-xs">
                <span className="truncate">{url}</span>
                <IconExternalLink className="size-3 shrink-0" />
              </span>
            </Link>
          ))}
        </nav>
      ) : null}
      {pictures.map((image) => (
        <ImageLightbox key={image.uri} src={image.uri} alt={image.name ?? ToolDisplay.subtitle(tool) ?? "Image"}>
          <img
            src={image.uri}
            alt={image.name ?? "Image"}
            className="max-h-64 w-fit max-w-full rounded-md border bg-muted object-contain"
          />
        </ImageLightbox>
      ))}
      {!props.failed && props.output ? <Output text={props.output} /> : null}
      {error ? <Output text={error} failed /> : null}
    </>
  )
}

const hasBody = (tool: SessionMessage.Tool, output: string | undefined) =>
  Boolean(ToolDisplay.error(tool) ?? output) ||
  images(tool).length > 0 ||
  ToolDisplay.answers(tool).length > 0 ||
  (inputShown.has(ToolDisplay.kind(tool)) && Object.keys(ToolState.input(tool)).length > 0)

function ToolRow(props: {
  tool: SessionMessage.Tool
  status: ToolDisplay.Status
  output: string | undefined
  open: boolean
}) {
  const tool = props.tool
  const error = ToolDisplay.error(tool)
  const loaded = ToolDisplay.loaded(tool)
  const failed = props.status === "failed"
  return (
    <>
      <Step
        icon={ToolIcons.of(ToolDisplay.kind(tool))}
        title={ToolDisplay.label(tool)}
        subject={subjectOf(tool)}
        detail={failed && error ? ToolDisplay.errorSummary(tool.name, error) : undefined}
        status={statusOf(props.status)}
        defaultOpen={
          props.open ||
          ToolDisplay.answers(tool).length > 0 ||
          (ToolState.defaultOpen(tool, { shell: false, edit: false }) ?? false)
        }
      >
        {hasBody(tool, props.output) ? <ToolBody tool={tool} output={props.output} failed={failed} /> : undefined}
      </Step>
      {loaded.length > 0 ? <Note title={`Loaded ${loaded.join(", ")}`} /> : null}
    </>
  )
}

function ShellTool(props: { tool: SessionMessage.Tool; view: ChatAtoms.View; shellID: Shell.ID; open: boolean }) {
  const pending = props.tool.state.status === "streaming" || props.tool.state.status === "running"
  const live = ChatReact.useShellRunning(props.view.root, props.shellID)
  const running = pending || live
  const streamed = AsyncResult.getOrElse(
    ChatReact.useShellOutput({ ...props.view, shellID: props.shellID, running }),
    () => "",
  )
  return (
    <ToolRow
      tool={props.tool}
      status={running ? "running" : ToolDisplay.status(props.tool)}
      output={streamed ? TimelineText.shellOutput(streamed) : ToolDisplay.output(props.tool)}
      open={props.open}
    />
  )
}

type Card = ReturnType<typeof ChatView.useSubagent>

const subagentTitle = (card: Card) => {
  if (card.needsInput) return "Needs your input"
  if (card.status === "denied") return "Denied"
  if (card.status === "failed") return "Failed to delegate"
  return card.status === "running" || card.status === "delegating" ? "Delegating" : "Delegated"
}

const subagentStatus = (card: Card): Status => {
  if (card.needsInput) return undefined
  if (card.status === "running" || card.status === "delegating") return "running"
  return card.status === "failed" || card.status === "denied" ? "error" : undefined
}

const subagentDetail = (card: Card) =>
  [
    card.status === "running" || card.status === "delegating" ? card.activity : undefined,
    card.retry ? "Retrying" : undefined,
    card.tools > 0 ? `${card.tools} ${card.tools === 1 ? "tool call" : "tool calls"}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ")

const childOf = (card: Card) => (card.child?.startsWith("ses_") ? Session.ID.make(card.child) : undefined)

function Opener(props: { onOpen: (() => void) | undefined; children: ReactNode }) {
  if (!props.onOpen) return props.children
  return (
    // oxlint-disable-next-line react/forbid-elements -- the whole trace line opens the subagent, and Trace styles its button
    <button type="button" onClick={props.onOpen}>
      {props.children}
    </button>
  )
}

function Subagent(props: { view: ChatAtoms.View; tool: SessionMessage.Tool; onOpen: (sessionID: Session.ID) => void }) {
  const card = ChatView.useSubagent(props.view.root, props.view.sessionID, props.tool)
  const child = childOf(card)
  const status = subagentStatus(card)
  const detail = subagentDetail(card)
  const error = status === "error" ? (ToolDisplay.error(props.tool) ?? ToolDisplay.output(props.tool)) : undefined
  if (error)
    return (
      <Step
        icon={ToolIcons.of("agent")}
        title={subagentTitle(card)}
        subject={card.description ?? card.title}
        status="error"
      >
        <Output text={error} failed />
        {child ? (
          <Button variant="link" size="sm" className="self-start px-0" onClick={() => props.onOpen(child)}>
            Open subagent
          </Button>
        ) : null}
      </Step>
    )
  return (
    <Trace data-testid="message-subagent-task">
      <Opener onOpen={child ? () => props.onOpen(child) : undefined}>
        <TraceLine status={status}>
          <TraceIcon>{status === "running" ? <Spinner /> : ToolIcons.of("agent")}</TraceIcon>
          <TraceTitle className="shrink-0">{subagentTitle(card)}</TraceTitle>
          <TraceDescription className="min-w-0 shrink truncate">
            {[card.title, card.description].filter(Boolean).join(" · ")}
            {card.background ? " (background)" : ""}
          </TraceDescription>
          {detail ? (
            <TraceDescription className="min-w-0 shrink truncate font-mono text-xs">{detail}</TraceDescription>
          ) : null}
          {child ? (
            <TraceIcon>
              <IconChevronRight />
            </TraceIcon>
          ) : null}
        </TraceLine>
      </Opener>
    </Trace>
  )
}

export function Tool(props: {
  tool: SessionMessage.Tool
  view: ChatAtoms.View
  open: boolean
  onOpenChild: (sessionID: Session.ID) => void
}) {
  const tool = props.tool
  if (ToolDisplay.hidden(tool)) return null
  if (ToolDisplay.dismissed(tool)) return <Note title="Questions dismissed" />
  if (tool.name === "subagent" || tool.name === "task")
    return <Subagent view={props.view} tool={tool} onOpen={props.onOpenChild} />
  if (PatchFiles.isFileChange(tool) && ToolDisplay.status(tool) === "completed")
    return <FileChanges tools={[tool]} open={props.open} />
  const shellID = ToolState.liveShellID(tool)
  if (shellID) return <ShellTool tool={tool} view={props.view} shellID={shellID} open={props.open} />
  return <ToolRow tool={tool} status={ToolDisplay.status(tool)} output={ToolDisplay.output(tool)} open={props.open} />
}
