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
import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { Bubble, BubbleContent } from "@ren/ui/bubble"
import { Button } from "@ren/ui/button"
import { CopyButton } from "@ren/ui/copy-button"
import { Markdown } from "@ren/ui/markdown"
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from "@ren/ui/message"
import { Time } from "@ren/ui/time"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@ren/ui/trace"
import { Initials } from "@ren/util/initials"
import { IconClock, IconRestore, IconTool } from "@tabler/icons-react"
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
  readonly onPending: ((action: PendingAction, message: SessionMessage.User) => void) | undefined
  readonly onOpenChild: (sessionID: Session.ID) => void
  readonly onOpenSession: ((sessionID: string) => void) | undefined
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
            <Markdown size="lg" streaming={streaming(props.data.message)} onOpenSession={props.shared.onOpenSession}>
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
          {group.type === "file" ? (
            <FileChanges tools={tools} open={revealed} />
          ) : (
            ToolDisplay.runs(items).map((run, index) => (
              <Run
                key={run.type === "item" ? `item:${index}` : (run.tools.at(0)?.id ?? `run:${index}`)}
                shared={props.shared}
                run={run}
                entries={found}
              />
            ))
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

const steerable = new Set<ChatState.PendingStatus | undefined>(["starting", "steering", "stranded"])

function UserText(props: { text: string; highlights: ReadonlyArray<{ start: number; end: number }> }) {
  const ranges = props.highlights
  return (
    <>
      {ranges.map((range, index) => (
        <span key={range.start}>
          {props.text.slice(ranges[index - 1]?.end ?? 0, range.start)}
          <span data-highlight="" className="font-medium text-primary">
            {props.text.slice(range.start, range.end)}
          </span>
        </span>
      ))}
      {props.text.slice(ranges.at(-1)?.end ?? 0)}
    </>
  )
}

function UserActions(props: { shared: Shared; message: SessionMessage.User; pending: boolean }) {
  const platform = Platform.usePlatform()
  const write = props.message.text ? platform.writeClipboardText : undefined
  const revert = props.pending ? undefined : props.shared.onRevert
  const message = props.message
  if (!write && !revert) return null
  return (
    <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100 pointer-coarse:opacity-100">
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

function UserMessage(props: { shared: Shared; data: RowData }) {
  const message = props.data.message
  if (message?.type !== "user") return null
  const pending = steerable.has(props.data.status)
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
            <UserText text={message.text} highlights={TimelineText.mentions(message)} />
          </BubbleContent>
        </Bubble>
        <MessageFooter className="min-h-6 gap-1 px-0">
          <span className="tabular-nums">
            {props.data.caption ? `${props.data.caption} · ` : ""}
            <Time value={DateTime.toEpochMillis(message.time.created)} format="time-of-day" />
          </span>
          <UserActions shared={props.shared} message={message} pending={pending} />
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
