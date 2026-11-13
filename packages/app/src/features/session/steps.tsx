import { createContext, use, type ReactNode } from "react"
import {
  PatchFiles,
  TimelineDetail,
  TimelineOpen,
  TimelineText,
  ToolDisplay,
  ToolState,
  type ChatAtoms,
} from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { cn } from "cn"
import { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import type { Shell } from "@ren/schema/shell"
import {
  IconBrain,
  IconChevronRight,
  IconClock,
  IconFolder,
  IconInfoCircle,
  IconPencil,
  IconTool,
} from "@tabler/icons-react"
import { AsyncResult } from "effect/reactivity"
import { Button } from "@ren/ui/button"
import { CodeBlock, CodeBlockContent, CodeBlockLine, useHighlightedCode } from "@ren/ui/code-block"
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
import { Markdown } from "../../components/markdown.js"
import { toolIcons } from "./tool-icons.js"
import { useSubagentCard } from "./chat-view.js"
import { ImageThumbnail } from "../../components/image-set.js"
import type { CatalogApp } from "../../lib/apps.js"
import { useSmoothText } from "../../lib/use-smooth-text.js"
import { WorkspaceImage } from "./workspace-image.js"
import { InlineFile } from "./file-chip.js"
import { DiffFile } from "./diff-file.js"
import { OpenPanel } from "./open-panel.js"
import { workspacePath } from "./workspace-edits.js"
import { TranscriptBlocks } from "./transcript-blocks.js"

function Output(props: { text: string; failed?: boolean | undefined; quotable?: string | undefined }) {
  return (
    <CodeBlock size="sm" variant={props.failed ? "destructive" : "default"}>
      <CodeBlockContent wrap className="max-h-64" data-quotable={props.quotable}>
        {props.text}
      </CodeBlockContent>
    </CodeBlock>
  )
}

const traceStatus = (state: { running?: boolean | undefined; failed?: boolean | undefined }) => {
  if (state.running) return "running"
  return state.failed ? "error" : undefined
}

type Step = TranscriptBlocks.Step

const leaves = TranscriptBlocks.leaves

interface Timeline {
  readonly view: ChatAtoms.View
  readonly detail: TimelineDetail.Detail
  readonly files: boolean
  readonly onOpenChild: (sessionID: Session.ID) => void
}

const TimelineContext = createContext<Timeline | null>(null)

const OpenContext = createContext(false)

export function StepsProvider(input: Timeline & { children: ReactNode }) {
  return (
    <TimelineContext
      value={{ view: input.view, detail: input.detail, files: input.files, onOpenChild: input.onOpenChild }}
    >
      {input.children}
    </TimelineContext>
  )
}

function useTimeline() {
  const value = use(TimelineContext)
  if (value === null) throw new Error("Steps must be used inside StepsProvider")
  return value
}

function Expandable(props: { content: ReactNode; className?: string | undefined; children: ReactNode }) {
  const open = use(OpenContext)
  if (!props.content) return props.children
  return (
    <TraceCollapsible key={String(open)} defaultOpen={open}>
      <TraceCollapsibleTrigger>{props.children}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className={props.className}>{props.content}</TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

function CommandOutput(props: {
  command: string
  output: string | undefined
  failed: boolean | undefined
  quotable: string
}) {
  const lines = useHighlightedCode(props.command, "bash")
  return (
    <CodeBlock size="sm">
      <CodeBlockContent wrap className="max-h-48 shrink-0">
        {lines.map((line, index) => (
          // oxlint-disable-next-line react/no-array-index-key -- a line's position is its identity in highlighted code
          <CodeBlockLine key={index}>
            {index === 0 ? <span className="text-muted-foreground select-none">$ </span> : null}
            {line}
          </CodeBlockLine>
        ))}
      </CodeBlockContent>
      {props.output ? (
        <CodeBlockContent
          wrap
          data-quotable={props.quotable}
          className={cn("max-h-64 pt-0 text-muted-foreground", props.failed && "text-destructive")}
        >
          {props.output}
        </CodeBlockContent>
      ) : null}
    </CodeBlock>
  )
}

function StepDetail(props: {
  quotable: string
  command: string | undefined
  output: string | undefined
  failed: boolean | undefined
  images: ReadonlyArray<SessionMessage.ToolFileContent>
}) {
  const images = props.images
  if (props.command)
    return (
      <CommandOutput command={props.command} output={props.output} failed={props.failed} quotable={props.quotable} />
    )
  return (
    <>
      {images.map((image) => (
        <ImageThumbnail
          key={image.uri}
          src={image.uri}
          name={image.name?.split("/").at(-1) ?? "Image"}
          className="max-h-64 w-fit max-w-full rounded-md border bg-muted object-contain"
        />
      ))}
      {props.output && !(images.length > 0 && props.output === "Image read successfully") ? (
        <Output text={props.output} failed={props.failed} quotable={props.quotable} />
      ) : null}
    </>
  )
}

function StepRow(props: {
  icon: ReactNode
  verb: string
  subject?: string | undefined
  running?: boolean
  failed?: boolean
  command?: string | undefined
  output?: string | undefined
  images?: ReadonlyArray<SessionMessage.ToolFileContent> | undefined
}) {
  const images = props.images ?? []
  const detail =
    props.command || props.output || images.length > 0 ? (
      <StepDetail
        command={props.command}
        output={props.output}
        failed={props.failed}
        images={images}
        quotable={`the output of ${props.subject ?? props.verb}`}
      />
    ) : undefined
  return (
    <Trace>
      <Expandable content={detail} className="flex flex-col gap-2">
        <TraceLine status={traceStatus(props)}>
          <TraceIcon>{props.running ? <Spinner /> : props.icon}</TraceIcon>
          <TraceTitle className="shrink-0">{props.verb}</TraceTitle>
          {props.subject ? (
            <TraceDescription
              className={cn(
                "min-w-0 shrink truncate font-mono text-xs",
                props.command && "group-aria-expanded/trace-collapsible-trigger:hidden",
              )}
            >
              {props.subject}
            </TraceDescription>
          ) : null}
        </TraceLine>
      </Expandable>
    </Trace>
  )
}

function DiffStep(props: { tool: SessionMessage.Tool; icon: ReactNode; files: ReadonlyArray<PatchFiles.File> }) {
  const openPanel = use(OpenPanel)
  const additions = props.files.reduce((total, file) => total + file.additions, 0)
  const deletions = props.files.reduce((total, file) => total + file.deletions, 0)
  const open = use(OpenContext)
  return (
    <Trace>
      <TraceCollapsible key={String(open)} defaultOpen={open}>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>{props.icon}</TraceIcon>
            <TraceTitle className="shrink-0">{ToolDisplay.label(props.tool)}</TraceTitle>
            <TraceDescription className="min-w-0 shrink truncate font-mono text-xs">
              {ToolDisplay.subtitle(props.tool)}
            </TraceDescription>
            <TraceDescription>
              +{additions} −{deletions}
            </TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-2">
          {props.files.map((file) => (
            <DiffFile
              key={file.path}
              view={file.view}
              capped
              action={
                openPanel ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-mr-2 text-muted-foreground"
                    onClick={() => openPanel({ kind: "changes", path: workspacePath(file.path) })}
                  >
                    Open in Changes
                  </Button>
                ) : undefined
              }
            />
          ))}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

function shellVerb(tool: SessionMessage.Tool, options: { readonly running: boolean }) {
  if (!ToolState.backgrounded(tool)) return ToolDisplay.label(tool)
  return options.running ? "Running in background" : "Ran in background"
}

function LiveShell(props: { tool: SessionMessage.Tool; shellID: Shell.ID }) {
  const view = useTimeline().view
  const pending = props.tool.state.status === "streaming" || props.tool.state.status === "running"
  const live = ChatReact.useShellRunning(view.root, props.shellID)
  const running = pending || live
  const streamed = AsyncResult.getOrElse(
    ChatReact.useShellOutput({ ...view, shellID: props.shellID, running }),
    () => "",
  )
  const failed = !running && ToolDisplay.status(props.tool) === "failed"
  return (
    <StepRow
      icon={<toolIcons.command />}
      verb={shellVerb(props.tool, { running })}
      subject={ToolDisplay.subtitle(props.tool)}
      command={ToolDisplay.command(props.tool)}
      running={running}
      failed={failed}
      output={streamed ? TimelineText.shellOutput(streamed) : ToolDisplay.output(props.tool)}
    />
  )
}

type Card = ReturnType<typeof useSubagentCard>

function subagentTitle(card: Card) {
  if (card.needsInput) return "Needs your input"
  if (card.status === "failed") return "Failed to delegate"
  if (card.background) return card.status === "running" ? "Running in background" : "Ran in background"
  return card.status === "running" || card.status === "delegating" ? "Delegating" : "Delegated"
}

function subagentState(card: Card, tool: SessionMessage.Tool) {
  const failed = card.status === "failed"
  return {
    child: card.child?.startsWith("ses_") ? Session.ID.make(card.child) : undefined,
    running: card.status === "running" || card.status === "delegating",
    failed,
    error: failed ? (ToolDisplay.error(tool) ?? ToolDisplay.output(tool)) : undefined,
  }
}

function SubagentError(props: { error: string; onOpen: (() => void) | undefined }) {
  return (
    <>
      <Output text={props.error} failed />
      {props.onOpen ? (
        <Button variant="link" size="sm" className="px-0" onClick={props.onOpen}>
          Open subagent
        </Button>
      ) : null}
    </>
  )
}

function Opener(props: { label: string; onOpen: (() => void) | undefined; children: ReactNode }) {
  if (!props.onOpen) return props.children
  return (
    // oxlint-disable-next-line react/forbid-elements -- the whole trace line opens the subagent, and Trace styles its button
    <button type="button" aria-label={props.label} onClick={props.onOpen}>
      {props.children}
    </button>
  )
}

function SubagentStep(props: { tool: SessionMessage.Tool }) {
  const timeline = useTimeline()
  const card = useSubagentCard(timeline.view, props.tool)
  const state = subagentState(card, props.tool)
  const child = state.child
  const open = child ? () => timeline.onOpenChild(child) : undefined
  const error = state.error
  const running = state.running
  return (
    <Trace>
      <Opener label={`Open ${card.title}`} onOpen={error ? undefined : open}>
        <Expandable
          content={error ? <SubagentError error={error} onOpen={open} /> : undefined}
          className="flex flex-col items-start gap-2"
        >
          <TraceLine status={traceStatus(state)}>
            <TraceIcon>{running ? <Spinner /> : <toolIcons.agent />}</TraceIcon>
            <TraceTitle className="shrink-0">{subagentTitle(card)}</TraceTitle>
            <TraceDescription className="min-w-0 shrink truncate">{card.description ?? card.title}</TraceDescription>
            {card.activity && running ? (
              <TraceDescription className="min-w-0 shrink truncate font-mono text-xs">{card.activity}</TraceDescription>
            ) : null}
            {open && !error ? (
              <TraceIcon>
                <IconChevronRight />
              </TraceIcon>
            ) : null}
          </TraceLine>
        </Expandable>
      </Opener>
    </Trace>
  )
}

function ToolStep(props: { tool: SessionMessage.Tool }) {
  const tool = props.tool
  const shellID = ToolState.liveShellID(tool)
  if (shellID) return <LiveShell tool={tool} shellID={shellID} />
  const status = ToolDisplay.status(tool)
  const error = ToolDisplay.error(tool)
  const Icon = toolIcons[ToolDisplay.kind(tool)]
  if (tool.name === "subagent" || tool.name === "task") return <SubagentStep tool={tool} />
  const changed =
    PatchFiles.isFileChange(tool) && status === "completed" ? PatchFiles.patchFiles(PatchFiles.toolFiles(tool)) : []
  if (changed.length > 0) return <DiffStep tool={tool} icon={<Icon />} files={changed} />
  return (
    <StepRow
      icon={<Icon />}
      verb={ToolDisplay.label(tool)}
      subject={[ToolDisplay.subtitle(tool), ToolDisplay.matches(tool)].filter(Boolean).join(" · ") || undefined}
      command={ToolDisplay.command(tool)}
      running={status === "running"}
      failed={status === "failed"}
      output={error ?? ToolDisplay.output(tool)}
      images={
        "content" in tool.state
          ? tool.state.content.filter(
              (item): item is SessionMessage.ToolFileContent => item.type === "file" && item.mime.startsWith("image/"),
            )
          : []
      }
    />
  )
}

function ReasoningStep(props: { step: Extract<Step, { kind: "reasoning" }> }) {
  const text = props.step.content.text.trim()
  return (
    <Trace>
      <Expandable content={text ? <Markdown className="text-sm/relaxed">{text}</Markdown> : undefined}>
        <TraceLine status={props.step.running ? "running" : undefined}>
          <TraceIcon>
            <IconBrain />
          </TraceIcon>
          <TraceTitle>{props.step.running ? "Thinking" : "Thought"}</TraceTitle>
        </TraceLine>
      </Expandable>
    </Trace>
  )
}

function ShellStep(props: { message: SessionMessage.Shell }) {
  const message = props.message
  const error = TimelineText.shellError(message)
  return (
    <StepRow
      icon={<toolIcons.command />}
      verb={message.status === "running" ? "Running" : "Ran"}
      subject={message.command}
      command={message.command}
      running={message.status === "running"}
      failed={Boolean(error)}
      output={message.output?.output ? TimelineText.shellOutput(message.output.output) : (error ?? "No output")}
    />
  )
}

function NoticeStep(props: { message: SessionMessage.Info }) {
  const notice = TimelineText.notice(props.message)
  if (!notice) return null
  return (
    <Trace>
      <TraceLine>
        <TraceIcon>
          <IconInfoCircle />
        </TraceIcon>
        <TraceTitle>{notice.title}</TraceTitle>
        {notice.detail ? (
          <TraceDescription className="min-w-0 shrink truncate">{notice.detail}</TraceDescription>
        ) : null}
      </TraceLine>
    </Trace>
  )
}

function stepOpen(step: Exclude<Step, { kind: "group" | "text" }>, detail: TimelineDetail.Detail) {
  if (step.kind === "reasoning") return TimelineOpen.defaultOpen(step.content, detail)
  if (step.kind === "tool") return TimelineOpen.defaultOpen(step.tool, detail)
  return step.kind === "shell" && detail.shell.details === "expanded"
}

function StepBody(props: { step: Exclude<Step, { kind: "group" | "text" }> }) {
  const step = props.step
  if (step.kind === "reasoning") return <ReasoningStep step={step} />
  if (step.kind === "tool") return <ToolStep tool={step.tool} />
  if (step.kind === "shell") return <ShellStep message={step.message} />
  return <NoticeStep message={step.message} />
}

function StepItem(props: { step: Step }) {
  const step = props.step
  const detail = useTimeline().detail
  if (step.kind === "group") return <GroupStep step={step} />
  if (step.kind === "text") return null
  return (
    <OpenContext value={stepOpen(step, detail)}>
      <StepBody step={step} />
    </OpenContext>
  )
}

export function StepRuns(props: { steps: ReadonlyArray<Step> }) {
  const timeline = useTimeline()
  const runs = props.steps.reduce<Array<{ key: string; text?: Extract<Step, { kind: "text" }>; steps: Step[] }>>(
    (all, step) => {
      const last = all.at(-1)
      if (step.kind === "text") all.push({ key: step.key, text: step, steps: [] })
      else if (last && !last.text) last.steps.push(step)
      else all.push({ key: step.key, steps: [step] })
      return all
    },
    [],
  )
  return runs.map((run) =>
    run.text ? (
      <SmoothMarkdown
        key={run.key}
        text={run.text.text}
        streaming={run.text.streaming}
        root={timeline.view.root}
        files={timeline.files}
        className="text-sm/relaxed text-foreground"
      />
    ) : (
      <Trace key={run.key}>
        {run.steps.map((step) => (
          <StepItem key={step.key} step={step} />
        ))}
      </Trace>
    ),
  )
}

function groupItems(step: Extract<Step, { kind: "group" }>) {
  return leaves(step.steps).flatMap((item): ToolDisplay.GroupItem[] => {
    if (item.kind === "reasoning") return [item.content]
    if (item.kind === "tool") return [item.tool]
    if (item.kind === "shell") return [{ type: "shell" }]
    if (item.kind === "notice") return [{ type: "notice" }]
    return item.kind === "text" ? [{ type: "text", text: item.text }] : []
  })
}

function groupTitle(step: Extract<Step, { kind: "group" }>, items: ReadonlyArray<ToolDisplay.GroupItem>) {
  const count = items.length
  if (step.type === "read") return count === 1 ? "Explored 1 file" : `Explored ${count} files`
  if (step.type === "file") return count === 1 ? "Edited 1 file" : `Edited ${count} files`
  return ToolDisplay.group(items).title
}

const stepRunning = (step: Step) => {
  if (step.kind === "reasoning") return step.running
  if (step.kind === "tool") return ToolDisplay.status(step.tool) === "running"
  return step.kind === "shell" && step.message.status === "running"
}

function GroupStep(props: { step: Extract<Step, { kind: "group" }> }) {
  const detail = useTimeline().detail
  const steps = props.step.steps
  const items = groupItems(props.step)
  const Icon = { context: IconTool, read: IconFolder, file: IconPencil }[props.step.type]
  const open = props.step.type === "file" && detail.edit.details === "expanded"
  if (ToolDisplay.standsAlone(items)) return steps.map((step) => <StepItem key={step.key} step={step} />)
  return (
    <Trace>
      <TraceCollapsible key={String(open)} defaultOpen={open}>
        <TraceCollapsibleTrigger>
          <TraceLine status={leaves(steps).some(stepRunning) ? "running" : undefined}>
            <TraceIcon>
              <Icon />
            </TraceIcon>
            <TraceTitle>{groupTitle(props.step, items)}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-3">
          <StepRuns steps={steps} />
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

export function Steps(props: { steps: ReadonlyArray<Step>; workedFor: string | undefined }) {
  const backgrounded = props.steps.filter((step) => step.kind === "tool" && ToolState.backgrounded(step.tool))
  const steps = props.steps.filter((step) => step.kind !== "tool" || !ToolState.backgrounded(step.tool))
  const count = leaves(steps).filter((step) => step.kind !== "text").length
  return (
    <Trace>
      {steps.length > 0 ? (
        <TraceCollapsible>
          <TraceCollapsibleTrigger>
            <TraceLine>
              <TraceIcon>
                <IconClock />
              </TraceIcon>
              <TraceTitle>{props.workedFor ? `Worked for ${props.workedFor}` : "Worked"}</TraceTitle>
              <TraceDescription>{count === 1 ? "1 step" : `${count} steps`}</TraceDescription>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="flex flex-col gap-3">
            <StepRuns steps={steps} />
          </TraceCollapsibleContent>
        </TraceCollapsible>
      ) : null}
      {backgrounded.map((step) => (
        <StepItem key={step.key} step={step} />
      ))}
    </Trace>
  )
}

export function SmoothMarkdown(props: {
  text: string
  streaming: boolean
  className: string
  apps?: ReadonlyArray<CatalogApp> | undefined
  root?: Session.ID | undefined
  files?: boolean | undefined
  images?: ReadonlyMap<string, string> | undefined
}) {
  const text = useSmoothText(props.text, { streaming: props.streaming })
  const root = props.root
  return (
    <Markdown
      streaming={props.streaming || text.length < props.text.length}
      apps={props.apps}
      className={props.className}
      workspaceImage={
        root
          ? (path, alt, options) => (
              <WorkspaceImage root={root} path={path} alt={alt} src={props.images?.get(path)} inline={options.inline} />
            )
          : undefined
      }
      fileReference={
        root && props.files && !props.streaming
          ? (text, code) => <InlineFile root={root} text={text} code={code} />
          : undefined
      }
    >
      {text}
    </Markdown>
  )
}
