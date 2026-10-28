import {
  ChannelReply,
  type ChatState,
  Projection,
  type TimelineDetail,
  TimelineOpen,
  type TimelineRow,
  TimelineText,
  ToolDisplay,
} from "@ren/chat"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { AppMention } from "@ren/ui/app-mention"
import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { Bubble, BubbleContent } from "@ren/ui/bubble"
import { Button } from "@ren/ui/button"
import { CopyButton } from "@ren/ui/copy-button"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@ren/ui/input-group"
import { Markdown } from "@ren/ui/markdown"
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from "@ren/ui/message"
import { Time } from "@ren/ui/time"
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
import { Initials } from "@ren/util/initials"
import { IconClock, IconPencil, IconRestore, IconTool } from "@tabler/icons-react"
import { DateTime } from "effect"
import { useState } from "react"
import { Countdown } from "../../lib/countdown.js"
import { Platform } from "../../platform/platform.js"
import { ChannelMessageHeader, ChannelReplyMessage } from "./channel-message.js"
import { ScheduleMessageHeader } from "./schedule-message.js"
import { Separator, TranscriptError, TranscriptNotice, TranscriptShell, Working } from "./transcript-notice.js"
import { FileChanges, Note, Output, Reasoning, Step, Tool } from "./transcript-tool.js"

export type PendingAction = "queue" | "cancel"

export interface Person {
  readonly name: string
  readonly image: string | undefined
}

export interface Shared {
  readonly root: Session.ID
  readonly sessionID: Session.ID
  readonly part: string | undefined
  readonly reverting: boolean
  readonly detail: TimelineDetail.Detail | undefined
  readonly onRevert: ((message: SessionMessage.User) => void) | undefined
  readonly onEdit: ((message: SessionMessage.User, text: string) => void) | undefined
  readonly onPending: ((action: PendingAction, message: SessionMessage.User) => void) | undefined
  readonly onOpenChild: (sessionID: Session.ID) => void
  readonly onOpenSession: ((sessionID: string) => void) | undefined
  readonly apps: ReadonlyArray<AppMention.App>
}

export interface RowData {
  readonly message?: SessionMessage.Info | undefined
  readonly messages?: ReadonlyArray<SessionMessage.Info | undefined>
  readonly status?: ChatState.PendingStatus | undefined
  readonly caption?: string | undefined
  readonly sender?: string | undefined
  readonly senderImage?: string | undefined
  readonly updating?: boolean
  readonly working?: boolean
  readonly copy?: string | undefined
  readonly meta?: string | undefined
  readonly retry?: TimelineText.Retry | undefined
}

const reasoningDuration = (content: SessionMessage.Reasoning) =>
  content.time?.completed
    ? TimelineText.duration(
        DateTime.toEpochMillis(content.time.completed) - DateTime.toEpochMillis(content.time.created),
      )
    : undefined

const streaming = (message: SessionMessage.Info | undefined) => message?.type === "assistant" && !message.time.completed

function Response(props: { shared: Shared; data: RowData; text: string }) {
  const platform = Platform.usePlatform()
  const write = platform.writeClipboardText
  const copy = props.data.copy
  return (
    <Message>
      <MessageContent>
        <Bubble variant="ghost">
          <BubbleContent>
            <Markdown
              size="lg"
              streaming={streaming(props.data.message)}
              onOpenSession={props.shared.onOpenSession}
              apps={props.shared.apps}
            >
              {props.text}
            </Markdown>
          </BubbleContent>
        </Bubble>
        {write && copy !== undefined ? (
          <MessageFooter className="gap-1 px-0">
            <CopyButton value={copy} onCopy={write} label="Copy response" size="extra-small" />
            {props.data.meta ? <span className="tabular-nums">{props.data.meta}</span> : null}
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  )
}

function Part(props: { shared: Shared; data: RowData; reference: TimelineRow.PartRef }) {
  const content = Projection.resolveContent(props.data.message, props.reference.partID)
  if (!content) return null
  if (content.type === "text") return <Response shared={props.shared} data={props.data} text={content.text} />
  if (content.type === "reasoning")
    return (
      <Reasoning
        text={content.text}
        streaming={streaming(props.data.message) && !content.time?.completed}
        duration={reasoningDuration(content)}
        open={TimelineOpen.defaultOpen(content, props.shared.detail)}
      />
    )
  if (ChannelReply.shown(content))
    return <ChannelReplyMessage tool={content} onOpenSession={props.shared.onOpenSession} />
  return (
    <Tool
      tool={content}
      view={{ root: props.shared.root, sessionID: props.shared.sessionID }}
      open={props.shared.part === content.id || TimelineOpen.defaultOpen(content, props.shared.detail)}
      onOpenChild={props.shared.onOpenChild}
    />
  )
}

interface Entry {
  readonly reference: TimelineRow.PartRef
  readonly message: SessionMessage.Info | undefined
  readonly item: ToolDisplay.GroupItem
}

const entries = (
  refs: ReadonlyArray<TimelineRow.PartRef>,
  messages: ReadonlyArray<SessionMessage.Info | undefined>,
): ReadonlyArray<Entry> =>
  refs.flatMap((reference, index): ReadonlyArray<Entry> => {
    const message = messages[index]
    if (reference.partID === reference.messageID)
      return message
        ? [
            {
              reference,
              message,
              item: message.type === "shell" ? { type: "shell" as const } : { type: "notice" as const },
            },
          ]
        : []
    const content = Projection.resolveContent(message, reference.partID)
    return content ? [{ reference, message, item: content }] : []
  })

const running = (tools: ReadonlyArray<SessionMessage.Tool>) =>
  tools.some((tool) => ToolDisplay.status(tool) === "running")

function RunItem(props: { item: ToolDisplay.GroupItem; entries: ReadonlyArray<Entry> }) {
  const message = props.entries.find((candidate) => candidate.item === props.item)?.message
  if (props.item.type === "reasoning")
    return (
      <Reasoning
        text={props.item.text}
        streaming={streaming(message) && !props.item.time?.completed}
        duration={reasoningDuration(props.item)}
      />
    )
  if (message?.type === "shell") return <TranscriptShell message={message} />
  const notice = message && TimelineText.notice(message)
  return notice ? <Note title={notice.title} detail={notice.detail} /> : null
}

function Run(props: { shared: Shared; run: ToolDisplay.Run; entries: ReadonlyArray<Entry> }) {
  const run = props.run
  if (run.type === "item") return <RunItem item={run.item} entries={props.entries} />
  const first = run.tools.at(0)
  if (run.kind === "single")
    return first ? (
      <Tool
        tool={first}
        view={{ root: props.shared.root, sessionID: props.shared.sessionID }}
        open={props.shared.part === first.id}
        onOpenChild={props.shared.onOpenChild}
      />
    ) : null
  if (run.kind === "file")
    return <FileChanges tools={run.tools} open={run.tools.some((tool) => tool.id === props.shared.part)} />
  const names = run.tools.flatMap((tool) => ToolDisplay.subtitle(tool) ?? []).join(", ")
  if (run.kind === "skill") return <Note title="Loaded skills" detail={names} />
  return (
    <Step icon={<IconTool />} title="Read" subject={names} status={running(run.tools) ? "running" : undefined}>
      {run.tools.map((tool) => (
        <Output
          key={tool.id}
          title={ToolDisplay.subtitle(tool) ?? "Output"}
          text={ToolDisplay.output(tool) ?? "No output"}
        />
      ))}
    </Step>
  )
}

const groupTitle = (
  group: Exclude<TimelineRow.PartGroup, { readonly type: "part" }>,
  items: ReadonlyArray<ToolDisplay.GroupItem>,
) => {
  if (group.type === "context") return ToolDisplay.group(items).title
  const subjects = items.flatMap((item) => {
    const subject = item.type === "tool" ? ToolDisplay.subtitle(item) : undefined
    return subject ? [subject] : []
  })
  return `${group.type === "read" ? "Read" : "Edited"} ${subjects.join(", ")}`
}

function GroupSteps(props: { shared: Shared; data: RowData; group: Exclude<TimelineRow.PartGroup, { type: "part" }> }) {
  const found = entries(props.group.refs, props.data.messages ?? [])
  const items = found.map((entry) => entry.item)
  if (props.group.type === "file")
    return (
      <FileChanges
        tools={items.filter((item): item is SessionMessage.Tool => item.type === "tool")}
        open={props.group.refs.some((reference) => reference.partID === props.shared.part)}
      />
    )
  return ToolDisplay.runs(items).map((run, index) => (
    <Run
      key={run.type === "item" ? `item:${index}` : (run.tools.at(0)?.id ?? `run:${index}`)}
      shared={props.shared}
      run={run}
      entries={found}
    />
  ))
}

function Group(props: { shared: Shared; data: RowData; group: Exclude<TimelineRow.PartGroup, { type: "part" }> }) {
  const group = props.group
  const found = entries(group.refs, props.data.messages ?? [])
  const items = found.map((entry) => entry.item)
  const tools = items.filter((item): item is SessionMessage.Tool => item.type === "tool")
  const working = props.data.working === true || running(tools)
  const [choice, setChoice] = useState<{ working: boolean; open: boolean }>()
  const revealed = group.refs.some((reference) => reference.partID === props.shared.part)
  const open = working || (choice?.working === working ? choice.open : revealed)
  return (
    <Trace>
      <TraceCollapsible open={open} onOpenChange={(next) => setChoice({ working, open: next })}>
        <TraceCollapsibleTrigger>
          <TraceLine status={working ? "running" : undefined}>
            <TraceIcon>
              <IconClock />
            </TraceIcon>
            <TraceTitle>{groupTitle(group, items)}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-2">
          <GroupSteps shared={props.shared} data={props.data} group={group} />
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

const steerable = new Set<ChatState.PendingStatus | undefined>(["starting", "steering", "stranded"])

function UserText(props: {
  text: string
  highlights: ReadonlyArray<{ start: number; end: number }>
  apps: ReadonlyArray<AppMention.App>
}) {
  const ranges = props.highlights
  return (
    <>
      {ranges.map((range, index) => (
        <span key={range.start}>
          {AppMention.withMentions(props.text.slice(ranges[index - 1]?.end ?? 0, range.start), props.apps)}
          <span data-highlight="" className="font-medium text-primary">
            {props.text.slice(range.start, range.end)}
          </span>
        </span>
      ))}
      {AppMention.withMentions(props.text.slice(ranges.at(-1)?.end ?? 0), props.apps)}
    </>
  )
}

function UserActions(props: { shared: Shared; message: SessionMessage.User; pending: boolean; onEdit: () => void }) {
  const platform = Platform.usePlatform()
  const write = props.message.text ? platform.writeClipboardText : undefined
  const revert = props.pending ? undefined : props.shared.onRevert
  const editable = !props.pending && props.shared.onEdit !== undefined && props.message.text !== ""
  const message = props.message
  if (!write && !revert) return null
  return (
    <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100 pointer-coarse:opacity-100">
      {editable ? (
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          aria-label="Edit message"
          disabled={props.shared.reverting}
          onClick={props.onEdit}
        >
          <IconPencil />
        </Button>
      ) : null}
      {revert ? (
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          aria-label="Revert to this message"
          disabled={props.shared.reverting}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => revert(message)}
        >
          <IconRestore />
        </Button>
      ) : null}
      {write ? <CopyButton value={message.text} onCopy={write} label="Copy message" size="extra-small" /> : null}
    </span>
  )
}

function PendingActions(props: { shared: Shared; message: SessionMessage.User; updating: boolean }) {
  const act = props.shared.onPending
  if (!act) return null
  return (
    <span className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="xs"
        disabled={props.updating}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => act("queue", props.message)}
      >
        Move to queue
      </Button>
      <Button
        variant="ghost"
        size="xs"
        disabled={props.updating}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => act("cancel", props.message)}
      >
        Delete pending
      </Button>
    </span>
  )
}

function EditMessage(props: { text: string; onCancel: () => void; onSave: (text: string) => void }) {
  const [text, setText] = useState(props.text)
  const save = () => {
    if (!text.trim() || text.trim() === props.text.trim()) props.onCancel()
    else props.onSave(text.trim())
  }
  return (
    <div className="flex w-full flex-col gap-1.5">
      <InputGroup className="rounded-xl bg-card shadow-composer dark:bg-card">
        <InputGroupTextarea
          value={text}
          aria-label="Edit message"
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the editor opens because the person asked to edit
          autoFocus
          className="max-h-60 min-h-16 px-4 pt-3 text-base/relaxed md:text-sm/relaxed"
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
          <Button size="sm" onClick={save}>
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

function UserMessage(props: { shared: Shared; data: RowData }) {
  const [editing, setEditing] = useState(false)
  const message = props.data.message
  if (message?.type !== "user") return null
  const pending = steerable.has(props.data.status)
  const onEdit = props.shared.onEdit
  if (editing && onEdit)
    return (
      <Message align="end">
        <MessageContent>
          <EditMessage
            text={message.text}
            onCancel={() => setEditing(false)}
            onSave={(text) => {
              setEditing(false)
              onEdit(message, text)
            }}
          />
        </MessageContent>
      </Message>
    )
  return (
    <Message align="end">
      {props.data.sender ? (
        <MessageAvatar className="mb-7 min-w-6">
          <Avatar size="sm" aria-hidden>
            <AvatarImage src={props.data.senderImage} alt="" />
            <AvatarFallback className="bg-secondary text-xs">{Initials.of(props.data.sender)}</AvatarFallback>
          </Avatar>
        </MessageAvatar>
      ) : null}
      <MessageContent className="max-w-5/6 items-end">
        {props.data.sender ? <MessageHeader className="px-0">{props.data.sender}</MessageHeader> : null}
        <ChannelMessageHeader origin={message.channel} />
        <ScheduleMessageHeader origin={message.schedule} />
        <Bubble variant="muted" align="end">
          <BubbleContent className="rounded-tr-lg px-4 text-base/relaxed whitespace-pre-wrap">
            <UserText text={message.text} highlights={TimelineText.mentions(message)} apps={props.shared.apps} />
          </BubbleContent>
        </Bubble>
        <MessageFooter className="min-h-6 gap-1 px-0">
          <span className="tabular-nums">
            {props.data.caption ? `${props.data.caption} · ` : ""}
            <Time value={DateTime.toEpochMillis(message.time.created)} format="time-of-day" />
          </span>
          <UserActions shared={props.shared} message={message} pending={pending} onEdit={() => setEditing(true)} />
        </MessageFooter>
        {pending ? (
          <PendingActions shared={props.shared} message={message} updating={props.data.updating === true} />
        ) : null}
      </MessageContent>
    </Message>
  )
}

function Thinking(props: { data: RowData; reference: TimelineRow.PartRef }) {
  const content = Projection.resolveContent(props.data.message, props.reference.partID)
  if (content?.type !== "reasoning") return null
  return <Reasoning text={content.text} streaming />
}

function Retry(props: { retry: TimelineText.Retry }) {
  const remaining = Countdown.useUntil(props.retry.next)
  return (
    <output className="flex min-w-0 flex-col gap-1 text-sm">
      <span className="text-foreground">{props.retry.message}</span>
      <span className="shimmer text-muted-foreground motion-reduce:shimmer-none">
        {remaining > 0
          ? `Attempt ${props.retry.attempt}, retrying in ${remaining}s`
          : `Attempt ${props.retry.attempt}, retrying now`}
      </span>
    </output>
  )
}

function AssistantPart(props: { shared: Shared; data: RowData; group: TimelineRow.PartGroup }) {
  if (props.group.type === "part") return <Part shared={props.shared} data={props.data} reference={props.group.ref} />
  return <Group shared={props.shared} data={props.data} group={props.group} />
}

function ShellRow(props: { message: SessionMessage.Info | undefined }) {
  return props.message?.type === "shell" ? <TranscriptShell message={props.message} /> : null
}

function StepText(props: { shared: Shared; data: RowData; reference: TimelineRow.PartRef }) {
  const content = Projection.resolveContent(props.data.message, props.reference.partID)
  if (content?.type !== "text") return null
  return (
    <div data-searchable className="min-w-0">
      <Markdown
        streaming={streaming(props.data.message)}
        onOpenSession={props.shared.onOpenSession}
        apps={props.shared.apps}
      >
        {content.text}
      </Markdown>
    </div>
  )
}

function TurnStep(props: { shared: Shared; data: RowData; row: TimelineRow.Row }) {
  const row = props.row
  if (row._tag !== "AssistantPart") return <TranscriptRow shared={props.shared} data={props.data} row={row} />
  const group = row.group
  if (group.type !== "part") return <GroupSteps shared={props.shared} data={props.data} group={group} />
  const content = Projection.resolveContent(props.data.message, group.ref.partID)
  if (content?.type === "text") return <StepText shared={props.shared} data={props.data} reference={group.ref} />
  return <TranscriptRow shared={props.shared} data={props.data} row={row} />
}

const workedTitle = (turn: { readonly running: boolean; readonly duration: string | undefined }) => {
  if (turn.running) return "Working"
  return turn.duration ? `Worked for ${turn.duration}` : "Worked"
}

export function TurnGroup(props: {
  shared: Shared
  rows: ReadonlyArray<{ readonly key: string; readonly row: TimelineRow.Row; readonly data: RowData }>
  running: boolean
  workedFor: string | undefined
  steps: number
  revealed: boolean
}) {
  const [open, setOpen] = useState<boolean>()
  return (
    <Trace>
      <TraceCollapsible open={open ?? props.revealed} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={props.running ? "running" : undefined}>
            <TraceIcon>
              <IconClock />
            </TraceIcon>
            <TraceTitle>{workedTitle({ running: props.running, duration: props.workedFor })}</TraceTitle>
            <TraceDescription>{props.steps === 1 ? "1 step" : `${props.steps} steps`}</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-3">
          {props.rows.map((item) => (
            <div key={item.key} data-row-key={item.key} className="flex min-w-0 flex-col gap-3 empty:hidden">
              <TurnStep shared={props.shared} data={item.data} row={item.row} />
            </div>
          ))}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

export function TranscriptRow(props: { shared: Shared; data: RowData; row: TimelineRow.Row }) {
  const row = props.row
  switch (row._tag) {
    case "UserMessage":
      return <UserMessage shared={props.shared} data={props.data} />
    case "AssistantPart":
      return <AssistantPart shared={props.shared} data={props.data} group={row.group} />
    case "Notice":
      return <TranscriptNotice message={props.data.message} />
    case "Shell":
      return <ShellRow message={props.data.message} />
    case "Thinking":
      return <Thinking data={props.data} reference={row.ref} />
    case "Retry":
      return props.data.retry ? <Retry retry={props.data.retry} /> : null
    case "Error":
      return <TranscriptError kind={row.kind} text={row.text} />
    case "TurnDivider":
      return <Separator label="Interrupted" />
    case "CompactionQueued":
      return <Separator label="Session compaction queued" />
    case "TurnGap":
      return null
  }
}

export { Working }
