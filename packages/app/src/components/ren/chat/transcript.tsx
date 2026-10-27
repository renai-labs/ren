import { useState, type ReactNode } from "react"
import { useAtomValue } from "@effect/atom-react"
import {
  ChatState,
  Family,
  PatchFiles,
  Projection,
  TimelineRow,
  TimelineText,
  ToolDisplay,
  ToolState,
  type ChatAtoms,
} from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import type { Shell } from "@ren/schema/shell"
import {
  IconAlertTriangle,
  IconClipboardText,
  IconFile,
  IconBrain,
  IconChevronRight,
  IconClock,
  IconCode,
  IconCopy,
  IconFileText,
  IconGhost,
  IconInfoCircle,
  IconPencil,
  IconRefresh,
  IconSearch,
  IconTool,
  IconWorld,
} from "@tabler/icons-react"
import { AsyncResult } from "effect/reactivity"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment"
import { CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from "@/components/ui/code-block"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { Spinner } from "@/components/ui/spinner"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace"
import { Markdown } from "@/components/ren/chat/markdown"
import { EmptyState } from "@/components/ren/empty-state"

interface Person {
  readonly name: string
  readonly image: string | undefined
}

export interface TranscriptProps {
  readonly view: ChatAtoms.View
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly rows: ReadonlyArray<TimelineRow.Row>
  readonly activeMessageID: string | undefined
  readonly busy: boolean
  readonly working: boolean
  readonly statuses: ReadonlyMap<string, ChatState.PendingStatus>
  readonly viewer: Person & { readonly id: string }
  readonly people: ReadonlyMap<string, Person>
  readonly more: boolean
  readonly loadingHistory: boolean
  readonly onLoadMore: () => void
  readonly onOpenChild: (sessionID: Session.ID) => void
  readonly onEdit?: ((message: SessionMessage.User, text: string) => void) | undefined
  readonly expanded?: boolean | undefined
  readonly modelNames?: ReadonlyMap<string, string> | undefined
  readonly empty?: string | undefined
}

type Step =
  | {
      readonly kind: "reasoning"
      readonly key: string
      readonly content: SessionMessage.Reasoning
      readonly running: boolean
    }
  | { readonly kind: "tool"; readonly key: string; readonly tool: SessionMessage.Tool }
  | { readonly kind: "shell"; readonly key: string; readonly message: SessionMessage.Shell }
  | { readonly kind: "notice"; readonly key: string; readonly message: SessionMessage.Info }
  | { readonly kind: "text"; readonly key: string; readonly text: string; readonly streaming: boolean }

type Block =
  | { readonly kind: "user"; readonly key: string; readonly message: SessionMessage.User }
  | { readonly kind: "steps"; readonly key: string; readonly turn: string; readonly steps: Step[] }
  | {
      readonly kind: "answer"
      readonly key: string
      readonly turn: string
      readonly text: string
      readonly streaming: boolean
    }
  | { readonly kind: "row"; readonly key: string; readonly row: TimelineRow.Row }

const streaming = (message: SessionMessage.Info | undefined) => message?.type === "assistant" && !message.time.completed

function stepsOf(row: TimelineRow.Row, byId: ReadonlyMap<string, SessionMessage.Info>): Step[] | undefined {
  if (row._tag === "Thinking") {
    const content = Projection.resolveContent(byId.get(row.ref.messageID), row.ref.partID)
    return content?.type === "reasoning"
      ? [{ kind: "reasoning", key: TimelineRow.key(row), content, running: true }]
      : []
  }
  if (row._tag === "Shell") {
    const message = byId.get(row.messageID)
    return message?.type === "shell" ? [{ kind: "shell", key: TimelineRow.key(row), message }] : []
  }
  if (row._tag !== "AssistantPart") return undefined
  const group = row.group
  const refs = group.type === "part" ? [group.ref] : group.refs
  return refs.flatMap((reference): Step[] => {
    const message = byId.get(reference.messageID)
    const key = `${reference.messageID}:${reference.partID}`
    if (reference.partID === reference.messageID) {
      if (message?.type === "shell") return [{ kind: "shell", key, message }]
      return message ? [{ kind: "notice", key, message }] : []
    }
    const content = Projection.resolveContent(message, reference.partID)
    if (content?.type === "reasoning")
      return [{ kind: "reasoning", key, content, running: streaming(message) && !content.time?.completed }]
    if (content?.type === "tool") return ToolDisplay.hidden(content) ? [] : [{ kind: "tool", key, tool: content }]
    return []
  })
}

function blocksOf(rows: ReadonlyArray<TimelineRow.Row>, byId: ReadonlyMap<string, SessionMessage.Info>) {
  return rows.reduce<Block[]>((blocks, row) => {
    if (row._tag === "TurnGap") return blocks
    if (row._tag === "UserMessage") {
      const message = byId.get(row.userMessageID)
      if (message?.type === "user") blocks.push({ kind: "user", key: TimelineRow.key(row), message })
      return blocks
    }
    if (row._tag === "AssistantPart" && row.group.type === "part") {
      const message = byId.get(row.group.ref.messageID)
      const content = Projection.resolveContent(message, row.group.ref.partID)
      if (content?.type === "text") {
        blocks.push({
          kind: "answer",
          key: TimelineRow.key(row),
          turn: row.userMessageID,
          text: content.text,
          streaming: streaming(message),
        })
        return blocks
      }
    }
    const steps = stepsOf(row, byId)
    if (!steps) {
      blocks.push({ kind: "row", key: TimelineRow.key(row), row })
      return blocks
    }
    const last = blocks.at(-1)
    if (last?.kind === "steps" && last.turn === row.userMessageID) last.steps.push(...steps)
    else if (steps.length > 0) blocks.push({ kind: "steps", key: TimelineRow.key(row), turn: row.userMessageID, steps })
    return blocks
  }, [])
}

function groupTurns(blocks: ReadonlyArray<Block>) {
  const lastSteps = new Map(
    blocks.flatMap((block, index) => (block.kind === "steps" ? [[block.turn, index] as const] : [])),
  )
  return blocks.reduce<Block[]>((grouped, block, index) => {
    if (block.kind !== "steps" && block.kind !== "answer") {
      grouped.push(block)
      return grouped
    }
    if (block.kind === "answer" && (lastSteps.get(block.turn) ?? -1) < index) {
      grouped.push(block)
      return grouped
    }
    const items: Step[] =
      block.kind === "steps"
        ? block.steps
        : [{ kind: "text", key: block.key, text: block.text, streaming: block.streaming }]
    const last = grouped.at(-1)
    if (last?.kind === "steps" && last.turn === block.turn) last.steps.push(...items)
    else grouped.push({ kind: "steps", key: block.key, turn: block.turn, steps: [...items] })
    return grouped
  }, [])
}

const isPasteBlock = (text: string) => text.length >= 2000 || text.split("\n").length >= 20

function splitPasted(text: string) {
  const separator = text.indexOf("\n\n")
  const head = separator === -1 ? text : text.slice(0, separator)
  const tail = separator === -1 ? "" : text.slice(separator + 2)
  if (tail && isPasteBlock(tail) && !isPasteBlock(head)) return { typed: head, pasted: tail }
  if (isPasteBlock(text)) return { typed: "", pasted: text }
  return { typed: text, pasted: undefined }
}

function PastedChip(props: { text: string }) {
  const [open, setOpen] = useState(false)
  const lines = props.text.split("\n").length
  return (
    <div className="flex flex-col items-end gap-2">
      <Attachment size="sm">
        <AttachmentMedia>
          <IconClipboardText />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>Pasted text</AttachmentTitle>
          <AttachmentDescription className="tabular-nums">
            {lines === 1 ? "1 line" : `${lines} lines`}
          </AttachmentDescription>
        </AttachmentContent>
        <AttachmentTrigger aria-label={open ? "Hide pasted text" : "Show pasted text"} onClick={() => setOpen(!open)} />
      </Attachment>
      {open ? (
        <CodeBlock size="sm" className="w-full">
          <CodeBlockContent wrap className="max-h-64">
            {props.text}
          </CodeBlockContent>
        </CodeBlock>
      ) : null}
    </div>
  )
}

function FileChips(props: { files: ReadonlyArray<SessionMessage.FileAttachment> }) {
  return (
    <AttachmentGroup className="justify-end">
      {props.files.map((file, index) => {
        const image = file.mime.startsWith("image/") && file.source.type === "inline" && file.data
        return (
          // oxlint-disable-next-line react/no-array-index-key -- two attachments can share a name and type
          <Attachment key={`${file.name ?? file.mime}-${index}`} size="sm">
            {image ? (
              <AttachmentMedia variant="image">
                <img src={`data:${file.mime};base64,${file.data}`} alt={file.name ?? "Image"} />
              </AttachmentMedia>
            ) : (
              <AttachmentMedia>
                <IconFile />
              </AttachmentMedia>
            )}
            <AttachmentContent>
              <AttachmentTitle>{file.name ?? "Attachment"}</AttachmentTitle>
              <AttachmentDescription>{file.mime}</AttachmentDescription>
            </AttachmentContent>
          </Attachment>
        )
      })}
    </AttachmentGroup>
  )
}

function EditPrompt(props: { text: string; onCancel: () => void; onSave: (text: string) => void }) {
  const [text, setText] = useState(props.text)
  const save = () => {
    if (text.trim()) props.onSave(text.trim())
  }
  return (
    <div className="flex flex-col gap-1.5">
      <InputGroup className="rounded-xl bg-card dark:bg-card">
        <InputGroupTextarea
          value={text}
          aria-label="Edit message"
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the editor opens because the person asked to edit
          autoFocus
          className="max-h-60 min-h-16 px-4 pt-3 text-base/relaxed"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") props.onCancel()
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
            event.preventDefault()
            save()
          }}
        />
        <InputGroupAddon align="block-end" className="justify-end gap-2 px-3 pt-0 pb-3">
          <Button variant="ghost" size="sm" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button size="sm" disabled={!text.trim() || text.trim() === props.text.trim()} onClick={save}>
            Send
          </Button>
        </InputGroupAddon>
      </InputGroup>
      <p className="px-1 text-xs text-muted-foreground">
        Sending replaces this message and removes everything after it.
      </p>
    </div>
  )
}

function CopyButton(props: { text: string }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground"
      aria-label="Copy"
      onClick={() => void navigator.clipboard.writeText(props.text)}
    >
      <IconCopy />
    </Button>
  )
}

function UserMessage(props: {
  message: SessionMessage.User
  person: Person
  pending: boolean
  editing: boolean
  onEdit?: (() => void) | undefined
  onCancel: () => void
  onSave: (text: string) => void
}) {
  const parts = splitPasted(props.message.text)
  return (
    <Message align="end" className={props.editing ? "-mr-13.5 w-full" : "-mr-13.5 w-auto"}>
      <MessageAvatar className="ml-3.5">
        <Avatar size="sm">
          {props.person.image ? <AvatarImage src={props.person.image} alt="" /> : null}
          <AvatarFallback className="bg-secondary">{props.person.name.charAt(0)}</AvatarFallback>
        </Avatar>
      </MessageAvatar>
      <MessageContent className={props.editing ? "w-full" : undefined}>
        <MessageHeader className="px-0">{props.person.name}</MessageHeader>
        {props.editing ? (
          <EditPrompt text={props.message.text} onCancel={props.onCancel} onSave={props.onSave} />
        ) : (
          <>
            {props.message.files && props.message.files.length > 0 ? <FileChips files={props.message.files} /> : null}
            {parts.typed ? (
              <Bubble variant="muted" align="end">
                <BubbleContent className="rounded-xl rounded-tr-lg px-4 py-2 text-base leading-[1.6] whitespace-pre-wrap">
                  {parts.typed}
                </BubbleContent>
              </Bubble>
            ) : null}
            {parts.pasted ? <PastedChip text={parts.pasted} /> : null}
          </>
        )}
        {props.editing ? null : (
          <MessageFooter className="justify-end gap-1">
            {props.pending ? <span className="px-1 text-xs text-muted-foreground">Pending</span> : null}
            {props.onEdit ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label="Edit"
                onClick={props.onEdit}
              >
                <IconPencil />
              </Button>
            ) : null}
            <CopyButton text={props.message.text} />
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  )
}

const toolIcons: Record<ToolDisplay.Kind, typeof IconCode> = {
  command: IconCode,
  file: IconFileText,
  edit: IconPencil,
  search: IconSearch,
  web: IconWorld,
  agent: IconGhost,
  tool: IconTool,
}

function Output(props: { text: string; failed?: boolean | undefined }) {
  return (
    <CodeBlock size="sm" variant={props.failed ? "destructive" : "default"}>
      <CodeBlockContent wrap className="max-h-64">
        {props.text}
      </CodeBlockContent>
    </CodeBlock>
  )
}

function StepRow(props: {
  icon: ReactNode
  verb: string
  subject?: string | undefined
  running?: boolean
  failed?: boolean
  output?: string | undefined
}) {
  const line = (
    <TraceLine status={props.running ? "running" : props.failed ? "error" : undefined}>
      <TraceIcon>{props.running ? <Spinner /> : props.icon}</TraceIcon>
      <TraceTitle className="shrink-0">{props.verb}</TraceTitle>
      {props.subject ? (
        <TraceDescription className="min-w-0 shrink truncate font-mono text-xs">{props.subject}</TraceDescription>
      ) : null}
    </TraceLine>
  )
  if (!props.output) return line
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Output text={props.output} failed={props.failed} />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

function DiffStep(props: { tool: SessionMessage.Tool; icon: ReactNode; files: ReadonlyArray<PatchFiles.File> }) {
  const additions = props.files.reduce((total, file) => total + file.additions, 0)
  const deletions = props.files.reduce((total, file) => total + file.deletions, 0)
  return (
    <TraceCollapsible>
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
          <CodeBlock key={file.path} size="sm">
            {props.files.length > 1 ? (
              <CodeBlockHeader>
                <CodeBlockTitle>{file.path}</CodeBlockTitle>
              </CodeBlockHeader>
            ) : null}
            <CodeBlockContent wrap className="max-h-64">
              {file.view.diff.hunks
                .flatMap((hunk) => hunk.lines)
                .map((line, index) => (
                  <CodeBlockLine
                    // oxlint-disable-next-line react/no-array-index-key -- diff lines have no identity besides their place
                    key={index}
                    variant={line.type === "addition" ? "added" : line.type === "deletion" ? "removed" : "default"}
                  >
                    {line.text.replace(/\n$/u, "")}
                  </CodeBlockLine>
                ))}
            </CodeBlockContent>
          </CodeBlock>
        ))}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

function LiveShell(props: { tool: SessionMessage.Tool; view: ChatAtoms.View; shellID: Shell.ID }) {
  const pending = props.tool.state.status === "streaming" || props.tool.state.status === "running"
  const live = ChatReact.useShellRunning(props.view.root, props.shellID)
  const running = pending || live
  const streamed = AsyncResult.getOrElse(
    ChatReact.useShellOutput({ ...props.view, shellID: props.shellID, running }),
    () => "",
  )
  const failed = !running && ToolDisplay.status(props.tool) === "failed"
  return (
    <StepRow
      icon={<IconCode />}
      verb={ToolDisplay.label(props.tool)}
      subject={ToolDisplay.subtitle(props.tool)}
      running={running}
      failed={failed}
      output={streamed ? TimelineText.shellOutput(streamed) : ToolDisplay.output(props.tool)}
    />
  )
}

function SubagentStep(props: {
  tool: SessionMessage.Tool
  view: ChatAtoms.View
  onOpenChild: (id: Session.ID) => void
}) {
  const state = AsyncResult.getOrElse(useAtomValue(ChatReact.useAtoms().state(props.view.root)), () => ChatState.empty)
  const card = Family.subagent(state, props.view.sessionID, props.tool)
  const child = card.child?.startsWith("ses_") ? Session.ID.make(card.child) : undefined
  const running = card.status === "running" || card.status === "delegating"
  const failed = card.status === "failed"
  const error = failed ? (ToolDisplay.error(props.tool) ?? ToolDisplay.output(props.tool)) : undefined
  const line = (trailing: boolean) => (
    <TraceLine status={running ? "running" : failed ? "error" : undefined}>
      <TraceIcon>{running ? <Spinner /> : <IconGhost />}</TraceIcon>
      <TraceTitle className="shrink-0">
        {card.needsInput ? "Needs your input" : failed ? "Failed to delegate" : running ? "Delegating" : "Delegated"}
      </TraceTitle>
      <TraceDescription className="min-w-0 shrink truncate">{card.description ?? card.title}</TraceDescription>
      {card.activity && running ? (
        <TraceDescription className="min-w-0 shrink truncate font-mono text-xs">{card.activity}</TraceDescription>
      ) : null}
      {trailing ? (
        <TraceIcon>
          <IconChevronRight />
        </TraceIcon>
      ) : null}
    </TraceLine>
  )
  if (error)
    return (
      <TraceCollapsible>
        <TraceCollapsibleTrigger>{line(false)}</TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col items-start gap-2">
          <Output text={error} failed />
          {child ? (
            <Button variant="link" size="xs" className="px-0" onClick={() => props.onOpenChild(child)}>
              Open subagent
            </Button>
          ) : null}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    )
  if (!child) return line(false)
  return (
    <button type="button" aria-label={`Open ${card.title}`} onClick={() => props.onOpenChild(child)}>
      {line(true)}
    </button>
  )
}

function ToolStep(props: { tool: SessionMessage.Tool; view: ChatAtoms.View; onOpenChild: (id: Session.ID) => void }) {
  const tool = props.tool
  const shellID = ToolState.liveShellID(tool)
  if (shellID) return <LiveShell tool={tool} view={props.view} shellID={shellID} />
  const status = ToolDisplay.status(tool)
  const error = ToolDisplay.error(tool)
  const Icon = toolIcons[ToolDisplay.kind(tool)]
  if (tool.name === "subagent" || tool.name === "task")
    return <SubagentStep tool={tool} view={props.view} onOpenChild={props.onOpenChild} />
  const changed =
    PatchFiles.isFileChange(tool) && status === "completed" ? PatchFiles.patchFiles(PatchFiles.toolFiles(tool)) : []
  if (changed.length > 0) return <DiffStep tool={tool} icon={<Icon />} files={changed} />
  return (
    <StepRow
      icon={<Icon />}
      verb={ToolDisplay.label(tool)}
      subject={[ToolDisplay.subtitle(tool), ToolDisplay.matches(tool)].filter(Boolean).join(" · ") || undefined}
      running={status === "running"}
      failed={status === "failed"}
      output={error ?? ToolDisplay.output(tool)}
    />
  )
}

function StepItem(props: { step: Step; view: ChatAtoms.View; onOpenChild: (id: Session.ID) => void }) {
  const step = props.step
  if (step.kind === "reasoning") {
    const text = step.content.text.trim()
    const line = (
      <TraceLine status={step.running ? "running" : undefined}>
        <TraceIcon>
          <IconBrain />
        </TraceIcon>
        <TraceTitle>{step.running ? "Thinking" : "Thought"}</TraceTitle>
      </TraceLine>
    )
    if (!text) return line
    return (
      <TraceCollapsible>
        <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="whitespace-pre-wrap">{text}</TraceCollapsibleContent>
      </TraceCollapsible>
    )
  }
  if (step.kind === "tool") return <ToolStep tool={step.tool} view={props.view} onOpenChild={props.onOpenChild} />
  if (step.kind === "text") return null
  if (step.kind === "shell") {
    const message = step.message
    const error = TimelineText.shellError(message)
    return (
      <StepRow
        icon={<IconCode />}
        verb={message.status === "running" ? "Running" : "Ran"}
        subject={message.command}
        running={message.status === "running"}
        failed={Boolean(error)}
        output={message.output?.output ? TimelineText.shellOutput(message.output.output) : (error ?? "No output")}
      />
    )
  }
  const notice = TimelineText.notice(step.message)
  if (!notice) return null
  return (
    <TraceLine>
      <TraceIcon>
        <IconInfoCircle />
      </TraceIcon>
      <TraceTitle>{notice.title}</TraceTitle>
      {notice.detail ? <TraceDescription className="min-w-0 shrink truncate">{notice.detail}</TraceDescription> : null}
    </TraceLine>
  )
}

function Steps(props: {
  expanded?: boolean | undefined
  steps: ReadonlyArray<Step>
  workedFor: string | undefined
  running: boolean
  view: ChatAtoms.View
  onOpenChild: (id: Session.ID) => void
}) {
  const count = props.steps.filter((step) => step.kind !== "text").length
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
  return (
    <Trace>
      <TraceCollapsible defaultOpen={props.expanded === true}>
        <TraceCollapsibleTrigger>
          <TraceLine status={props.running ? "running" : undefined}>
            <TraceIcon>
              <IconClock />
            </TraceIcon>
            <TraceTitle>
              {props.running ? "Working" : props.workedFor ? `Worked for ${props.workedFor}` : "Worked"}
            </TraceTitle>
            <TraceDescription>{count === 1 ? "1 step" : `${count} steps`}</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-3">
          {runs.map((run) =>
            run.text ? (
              <Markdown key={run.key} streaming={run.text.streaming} className="text-sm/relaxed text-foreground">
                {run.text.text}
              </Markdown>
            ) : (
              <Trace key={run.key}>
                {run.steps.map((step) => (
                  <StepItem key={step.key} step={step} view={props.view} onOpenChild={props.onOpenChild} />
                ))}
              </Trace>
            ),
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

function SystemRow(props: { row: TimelineRow.Row; context: Context }) {
  const row = props.row
  if (row._tag === "Error") {
    const title = TimelineText.errorTitle(row.kind)
    const parts = TimelineText.errorParts(row.text)
    return (
      <Marker className="items-start text-destructive">
        <MarkerIcon>
          <IconAlertTriangle />
        </MarkerIcon>
        <MarkerContent className="whitespace-pre-wrap">
          {title ?? (parts.head || "Ren hit an error. Send your message again to retry.")}
          {title ? null : parts.body.trim() ? `\n${parts.body.trim()}` : null}
        </MarkerContent>
      </Marker>
    )
  }
  if (row._tag === "Retry") {
    if (props.context.activeMessageID !== row.userMessageID) return null
    const retry = TimelineText.retryStatus(props.context.turns.get(row.userMessageID) ?? [])
    if (!retry) return null
    return (
      <Marker>
        <MarkerIcon>
          <IconRefresh />
        </MarkerIcon>
        <MarkerContent>
          Retrying (attempt {retry.attempt}) · {retry.message}
        </MarkerContent>
      </Marker>
    )
  }
  if (row._tag === "TurnDivider")
    return (
      <Marker variant="separator">
        <MarkerContent>Interrupted</MarkerContent>
      </Marker>
    )
  if (row._tag === "CompactionQueued")
    return (
      <Marker variant="separator">
        <MarkerContent>Session compaction queued</MarkerContent>
      </Marker>
    )
  if (row._tag !== "Notice") return null
  const message = props.context.byId.get(row.messageID)
  if (!message) return null
  if (message.type === "compaction")
    return (
      <Marker variant="separator">
        <MarkerContent>{TimelineText.compaction(message)}</MarkerContent>
      </Marker>
    )
  if (message.type === "model-switched") {
    const variant = message.model.variant && message.model.variant !== "default" ? message.model.variant : undefined
    return (
      <Marker variant="separator">
        <MarkerContent>
          {props.context.modelNames.get(message.model.id) ?? message.model.id}
          {variant ? ` · ${variant.charAt(0).toUpperCase()}${variant.slice(1)}` : null}
        </MarkerContent>
      </Marker>
    )
  }
  const notice = TimelineText.notice(message)
  if (!notice) return null
  return (
    <Marker variant="default">
      <MarkerContent>{notice.detail ? `${notice.title} · ${notice.detail}` : notice.title}</MarkerContent>
    </Marker>
  )
}

function LoadEarlier(props: { onVisible: () => void }) {
  return (
    <div
      aria-hidden
      className="h-px"
      ref={(node) => {
        if (!node) return
        const observer = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) props.onVisible()
        })
        observer.observe(node)
        return () => observer.disconnect()
      }}
    />
  )
}

interface Context {
  readonly modelNames: ReadonlyMap<string, string>
  readonly byId: ReadonlyMap<string, SessionMessage.Info>
  readonly turns: ReadonlyMap<string, ReadonlyArray<SessionMessage.Assistant>>
  readonly activeMessageID: string | undefined
}

export function Transcript(props: TranscriptProps) {
  const byId: ReadonlyMap<string, SessionMessage.Info> = new Map(props.messages.map((message) => [message.id, message]))
  const turns = Projection.assistantMessagesByParent(props.messages)
  const context: Context = {
    modelNames: props.modelNames ?? new Map(),
    byId,
    turns,
    activeMessageID: props.activeMessageID,
  }
  const blocks = groupTurns(blocksOf(props.rows, byId))
  const [editing, setEditing] = useState<string>()
  const lastAnswer = new Map(
    blocks.flatMap((block) => (block.kind === "answer" ? [[block.turn, block.key] as const] : [])),
  )
  const activeTurn = props.busy ? props.activeMessageID : undefined
  const workedFor = (turn: string) => {
    const user = byId.get(turn)
    const milliseconds = TimelineText.turnDuration(user?.type === "user" ? user : undefined, turns.get(turn) ?? [])
    return milliseconds === undefined ? undefined : TimelineText.duration(milliseconds)
  }
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="flex-1">
        <MessageScrollerViewport
          preserveScrollOnPrepend
          className="scrollbar-gutter-both! outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--color-border)]"
        >
          <MessageScrollerContent className="relative mx-auto w-full max-w-3xl p-6">
            {props.more ? (
              <MessageScrollerItem messageId="history" className="absolute inset-x-6 top-1">
                {props.loadingHistory ? (
                  <Marker variant="separator">
                    <MarkerIcon>
                      <Spinner />
                    </MarkerIcon>
                  </Marker>
                ) : (
                  <LoadEarlier onVisible={props.onLoadMore} />
                )}
              </MessageScrollerItem>
            ) : null}
            {blocks.map((block) => {
              if (block.kind === "user") {
                const message = block.message
                const status = props.statuses.get(message.id)
                const pending = status === "starting" || status === "steering" || status === "stranded"
                const senderId = message.sender?.userId
                const person =
                  senderId && senderId !== props.viewer.id
                    ? (props.people.get(senderId) ?? { name: "Member", image: undefined })
                    : props.viewer
                const edit = props.onEdit
                return (
                  <MessageScrollerItem key={block.key} messageId={block.key} scrollAnchor className="-mr-13.5 pr-13.5">
                    <UserMessage
                      message={message}
                      person={person}
                      pending={pending}
                      editing={editing === message.id}
                      onEdit={edit && !pending ? () => setEditing(message.id) : undefined}
                      onCancel={() => setEditing(undefined)}
                      onSave={(text) => {
                        setEditing(undefined)
                        edit?.(message, text)
                      }}
                    />
                  </MessageScrollerItem>
                )
              }
              if (block.kind === "steps")
                return (
                  <MessageScrollerItem key={block.key} messageId={block.key}>
                    <Message>
                      <MessageContent>
                        <Steps
                          expanded={props.expanded}
                          steps={block.steps}
                          running={activeTurn === block.turn}
                          workedFor={workedFor(block.turn)}
                          view={props.view}
                          onOpenChild={props.onOpenChild}
                        />
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                )
              if (block.kind === "answer") {
                const copy =
                  lastAnswer.get(block.turn) === block.key && activeTurn !== block.turn
                    ? TimelineText.copyText(turns.get(block.turn) ?? [])?.text
                    : undefined
                return (
                  <MessageScrollerItem key={block.key} messageId={block.key}>
                    <Message>
                      <MessageContent>
                        <Bubble variant="ghost">
                          <BubbleContent className="text-base leading-[1.7]">
                            <Markdown streaming={block.streaming} className="text-base leading-[1.7]">
                              {block.text}
                            </Markdown>
                          </BubbleContent>
                        </Bubble>
                        {copy ? (
                          <MessageFooter>
                            <CopyButton text={copy} />
                          </MessageFooter>
                        ) : null}
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                )
              }
              return (
                <MessageScrollerItem key={block.key} messageId={block.key}>
                  <SystemRow row={block.row} context={context} />
                </MessageScrollerItem>
              )
            })}
            {props.empty && blocks.length === 0 && !props.busy && !props.more && !props.loadingHistory ? (
              <MessageScrollerItem messageId="empty">
                <EmptyState>{props.empty}</EmptyState>
              </MessageScrollerItem>
            ) : null}
            {props.working ? (
              <MessageScrollerItem messageId="working">
                <Marker>
                  <MarkerContent>Working on the next step</MarkerContent>
                </Marker>
              </MessageScrollerItem>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
