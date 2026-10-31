import { type ChatAtoms, PatchFiles, TimelineText, ToolDisplay, ToolState } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import type { Shell } from "@ren/schema/shell"
import { Button } from "@ren/ui/button"
import { CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from "@ren/ui/code-block"
import { ImageLightbox } from "@ren/ui/image-lightbox"
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
import { IconBrain, IconChevronRight, IconInfoCircle } from "@tabler/icons-react"
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

export function Reasoning(props: { text: string; streaming: boolean; open?: boolean }) {
  const text = props.text.trim()
  return (
    <Step
      icon={<IconBrain />}
      title={props.streaming ? "Thinking" : "Thought"}
      status={props.streaming ? "running" : undefined}
      defaultOpen={props.open === true}
    >
      {text ? (
        <Markdown streaming={props.streaming} className="leading-relaxed text-muted-foreground">
          {text}
        </Markdown>
      ) : null}
    </Step>
  )
}

const lineVariants = { addition: "added", deletion: "removed", context: "default" } as const

function FileChanges(props: { tool: SessionMessage.Tool; files: ReadonlyArray<PatchFiles.File>; open: boolean }) {
  const additions = props.files.reduce((total, file) => total + file.additions, 0)
  const deletions = props.files.reduce((total, file) => total + file.deletions, 0)
  return (
    <Step
      icon={ToolIcons.of(ToolDisplay.kind(props.tool))}
      title={ToolDisplay.label(props.tool)}
      subject={ToolDisplay.subtitle(props.tool)}
      detail={`+${additions} −${deletions}`}
      defaultOpen={props.open}
    >
      {props.files.map((file) => (
        <CodeBlock key={file.path} size="sm">
          {props.files.length > 1 ? (
            <CodeBlockHeader>
              <CodeBlockTitle>{file.path}</CodeBlockTitle>
            </CodeBlockHeader>
          ) : null}
          <CodeBlockContent wrap className="max-h-64" aria-label={`Changes in ${file.path}`}>
            {file.view.diff.hunks
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

const subjectOf = (tool: SessionMessage.Tool) =>
  [ToolDisplay.subtitle(tool), ToolDisplay.matches(tool)].filter(Boolean).join(" · ") || undefined

function ToolRow(props: {
  tool: SessionMessage.Tool
  status: ToolDisplay.Status
  output: string | undefined
  open: boolean
}) {
  const tool = props.tool
  const failed = props.status === "failed"
  const output = ToolDisplay.error(tool) ?? props.output
  const pictures = images(tool)
  const shown = output && !(pictures.length > 0 && output === "Image read successfully") ? output : undefined
  return (
    <Step
      icon={ToolIcons.of(ToolDisplay.kind(tool))}
      title={ToolDisplay.label(tool)}
      subject={subjectOf(tool)}
      status={statusOf(props.status)}
      defaultOpen={props.open}
    >
      {shown || pictures.length > 0 ? (
        <>
          {pictures.map((image) => (
            <ImageLightbox key={image.uri} src={image.uri} alt={image.name?.split("/").at(-1) ?? "Image"}>
              <img
                src={image.uri}
                alt={image.name ?? "Image"}
                className="max-h-64 w-fit max-w-full rounded-md border bg-muted object-contain"
              />
            </ImageLightbox>
          ))}
          {shown ? <Output text={shown} failed={failed} /> : null}
        </>
      ) : undefined}
    </Step>
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
          <TraceDescription className="min-w-0 shrink truncate">{card.description ?? card.title}</TraceDescription>
          {card.activity && status === "running" ? (
            <TraceDescription className="min-w-0 shrink truncate font-mono text-xs">{card.activity}</TraceDescription>
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
  const shellID = ToolState.liveShellID(tool)
  if (shellID) return <ShellTool tool={tool} view={props.view} shellID={shellID} open={props.open} />
  if (tool.name === "subagent" || tool.name === "task")
    return <Subagent view={props.view} tool={tool} onOpen={props.onOpenChild} />
  const changed =
    PatchFiles.isFileChange(tool) && ToolDisplay.status(tool) === "completed"
      ? PatchFiles.patchFiles(PatchFiles.toolFiles(tool))
      : []
  if (changed.length > 0) return <FileChanges tool={tool} files={changed} open={props.open} />
  return <ToolRow tool={tool} status={ToolDisplay.status(tool)} output={ToolDisplay.output(tool)} open={props.open} />
}
