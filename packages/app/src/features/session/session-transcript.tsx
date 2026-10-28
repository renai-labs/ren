import {
  ChannelReply,
  type ChatState,
  Projection,
  TimelineOpen,
  TimelineRow,
  TimelineText,
  ToolDisplay,
} from "@ren/chat"
import type { SessionMessage } from "@ren/schema/session/message"
import { AppMention } from "@ren/ui/app-mention"
import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { Bubble, BubbleContent } from "@ren/ui/bubble"
import { Button } from "@ren/ui/button"
import { CopyButton } from "@ren/ui/copy-button"
import { InputGroupAddon } from "@ren/ui/input-group"
import { Markdown } from "@ren/ui/markdown"
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from "@ren/ui/message"
import { PromptInput } from "@ren/ui/prompt-input"
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
import { TranscriptContext } from "./transcript-context.js"
import { Separator, TranscriptError, TranscriptNotice, TranscriptShell } from "./transcript-notice.js"
import { FileChanges, Note, Output, Reasoning, Step, Tool } from "./transcript-tool.js"

export interface Person {
  readonly name: string
  readonly image: string | undefined
}

export interface RowData {
  readonly message?: SessionMessage.Info | undefined
  readonly content?: SessionMessage.Content | undefined
  readonly streaming?: boolean
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

function Response(props: { data: RowData; text: string }) {
  const platform = Platform.usePlatform()
  const transcript = TranscriptContext.useValue()
  const write = platform.writeClipboardText
  const copy = props.data.copy
  return (
    <Message>
      <MessageContent>
        <Bubble variant="ghost">
          <BubbleContent>
            <Markdown
              size="lg"
              streaming={props.data.streaming === true}
              onOpenSession={transcript.actions.onOpenSession}
              apps={transcript.state.apps}
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

function Part(props: { data: RowData }) {
  const transcript = TranscriptContext.useValue()
  const content = props.data.content
  if (!content) return null
  if (content.type === "text") return <Response data={props.data} text={content.text} />
  if (content.type === "reasoning")
    return (
      <Reasoning
        text={content.text}
        streaming={props.data.streaming === true && !content.time?.completed}
        duration={reasoningDuration(content)}
        open={TimelineOpen.defaultOpen(content, transcript.state.detail)}
      />
    )
  if (ChannelReply.shown(content))
    return <ChannelReplyMessage tool={content} onOpenSession={transcript.actions.onOpenSession} />
  return (
    <Tool
      tool={content}
      view={{ root: transcript.state.root, sessionID: transcript.state.sessionID }}
      open={transcript.state.part === content.id || TimelineOpen.defaultOpen(content, transcript.state.detail)}
      onOpenChild={transcript.actions.onOpenChild}
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

const isTool = (item: ToolDisplay.GroupItem): item is SessionMessage.Tool => item.type === "tool"

function RunItem(props: { item: ToolDisplay.GroupItem; entries: ReadonlyArray<Entry> }) {
  const message = props.entries.find((candidate) => candidate.item === props.item)?.message
  if (props.item.type === "reasoning")
    return (
      <Reasoning
        text={props.item.text}
        streaming={message?.type === "assistant" && !message.time.completed && !props.item.time?.completed}
        duration={reasoningDuration(props.item)}
      />
    )
  if (message?.type === "shell") return <TranscriptShell message={message} />
  const notice = message && TimelineText.notice(message)
  return notice ? <Note title={notice.title} detail={notice.detail} /> : null
}

function Run(props: { run: ToolDisplay.Run; entries: ReadonlyArray<Entry> }) {
  const transcript = TranscriptContext.useValue()
  const run = props.run
  if (run.type === "item") return <RunItem item={run.item} entries={props.entries} />
  const first = run.tools.at(0)
  if (run.kind === "single")
    return first ? (
      <Tool
        tool={first}
        view={{ root: transcript.state.root, sessionID: transcript.state.sessionID }}
        open={transcript.state.part === first.id}
        onOpenChild={transcript.actions.onOpenChild}
      />
    ) : null
  if (run.kind === "file")
    return <FileChanges tools={run.tools} open={run.tools.some((tool) => tool.id === transcript.state.part)} />
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

function GroupSteps(props: { group: Exclude<TimelineRow.PartGroup, { type: "part" }>; entries: ReadonlyArray<Entry> }) {
  const transcript = TranscriptContext.useValue()
  const items = props.entries.map((entry) => entry.item)
  if (props.group.type === "file")
    return (
      <FileChanges
        tools={items.filter(isTool)}
        open={props.group.refs.some((reference) => reference.partID === transcript.state.part)}
      />
    )
  return ToolDisplay.runs(items).map((run, index) => (
    <Run
      key={run.type === "item" ? `item:${index}` : (run.tools.at(0)?.id ?? `run:${index}`)}
      run={run}
      entries={props.entries}
    />
  ))
}

function Group(props: { data: RowData; group: Exclude<TimelineRow.PartGroup, { type: "part" }> }) {
  const transcript = TranscriptContext.useValue()
  const group = props.group
  const found = entries(group.refs, props.data.messages ?? [])
  const items = found.map((entry) => entry.item)
  const working = props.data.working === true || running(items.filter(isTool))
  const [choice, setChoice] = useState<{ working: boolean; open: boolean }>()
  const revealed = group.refs.some((reference) => reference.partID === transcript.state.part)
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
          <GroupSteps group={group} entries={found} />
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

function UserActions(props: { message: SessionMessage.User; pending: boolean; refocus: boolean; onEdit: () => void }) {
  const platform = Platform.usePlatform()
  const transcript = TranscriptContext.useValue()
  const write = props.message.text ? platform.writeClipboardText : undefined
  const revert = props.pending ? undefined : transcript.actions.onRevert
  const message = props.message
  if (!write && !revert) return null
  return (
    <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100 pointer-coarse:opacity-100">
      {!props.pending && transcript.actions.onEdit !== undefined && message.text !== "" ? (
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          aria-label="Edit message"
          disabled={transcript.state.reverting}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- closing the editor removed the focused field, so focus returns to the button that opened it
          autoFocus={props.refocus}
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
          disabled={transcript.state.reverting}
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

function PendingActions(props: { message: SessionMessage.User; updating: boolean }) {
  const act = TranscriptContext.useValue().actions.onPending
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
  return (
    <div className="flex w-full flex-col gap-1.5">
      <PromptInput.Root
        label="Edit your message"
        layout="stacked"
        onSubmit={() => {
          if (!text.trim() || text.trim() === props.text.trim()) props.onCancel()
          else props.onSave(text.trim())
        }}
      >
        <PromptInput.Group>
          <PromptInput.Textarea
            value={text}
            aria-label="Edit message"
            focusOnMount
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") props.onCancel()
            }}
          />
          <InputGroupAddon align="block-end" className="justify-end gap-2 px-3 pt-0 pb-3">
            <Button type="button" variant="ghost" size="sm" onClick={props.onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Send
            </Button>
          </InputGroupAddon>
        </PromptInput.Group>
      </PromptInput.Root>
      <p className="px-1 text-xs text-muted-foreground">
        Sending replaces this message and removes everything after it.
      </p>
    </div>
  )
}

function UserMessage(props: { data: RowData }) {
  const transcript = TranscriptContext.useValue()
  const [editor, setEditor] = useState<"closed" | "open" | "returned">("closed")
  const message = props.data.message
  if (message?.type !== "user") return null
  const pending = steerable.has(props.data.status)
  const onEdit = transcript.actions.onEdit
  if (editor === "open" && onEdit)
    return (
      <Message align="end">
        <MessageContent>
          <EditMessage
            text={message.text}
            onCancel={() => setEditor("returned")}
            onSave={(text) => {
              setEditor("returned")
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
            <UserText text={message.text} highlights={TimelineText.mentions(message)} apps={transcript.state.apps} />
          </BubbleContent>
        </Bubble>
        <MessageFooter className="min-h-6 gap-1 px-0">
          <span className="tabular-nums">
            {props.data.caption ? `${props.data.caption} · ` : ""}
            <Time value={DateTime.toEpochMillis(message.time.created)} format="time-of-day" />
          </span>
          <UserActions
            message={message}
            pending={pending}
            refocus={editor === "returned"}
            onEdit={() => setEditor("open")}
          />
        </MessageFooter>
        {pending ? <PendingActions message={message} updating={props.data.updating === true} /> : null}
      </MessageContent>
    </Message>
  )
}

function Retry(props: { retry: TimelineText.Retry }) {
  const remaining = Countdown.useUntil(props.retry.next)
  return (
    <output className="flex min-w-0 flex-col gap-1 text-sm">
      <span className="text-foreground">{props.retry.message}</span>
      <span className="shimmer text-muted-foreground motion-reduce:shimmer-none">
        {`Attempt ${props.retry.attempt}, retrying `}
        <span aria-hidden>{remaining > 0 ? `in ${remaining}s` : "now"}</span>
      </span>
    </output>
  )
}

function TurnStep(props: { data: RowData; row: TimelineRow.Row }) {
  const transcript = TranscriptContext.useValue()
  const row = props.row
  const content = props.data.content
  if (row._tag === "AssistantPart" && row.group.type !== "part")
    return <GroupSteps group={row.group} entries={entries(row.group.refs, props.data.messages ?? [])} />
  if (row._tag !== "AssistantPart" || content?.type !== "text") return <TranscriptRow data={props.data} row={row} />
  return (
    <div data-searchable className="min-w-0">
      <Markdown
        streaming={props.data.streaming === true}
        onOpenSession={transcript.actions.onOpenSession}
        apps={transcript.state.apps}
      >
        {content.text}
      </Markdown>
    </div>
  )
}

export function TurnGroup(props: {
  rows: ReadonlyArray<{ readonly row: TimelineRow.Row; readonly data: RowData }>
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
            <TraceTitle>
              {props.running ? "Working" : `Worked${props.workedFor ? ` for ${props.workedFor}` : ""}`}
            </TraceTitle>
            <TraceDescription>{props.steps === 1 ? "1 step" : `${props.steps} steps`}</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-3">
          {props.rows.map((item) => (
            <div
              key={TimelineRow.key(item.row)}
              data-row-key={TimelineRow.key(item.row)}
              className="flex min-w-0 flex-col gap-3 empty:hidden"
            >
              <TurnStep data={item.data} row={item.row} />
            </div>
          ))}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

function AssistantPart(props: { data: RowData; group: TimelineRow.PartGroup }) {
  if (props.group.type === "part") return <Part data={props.data} />
  return <Group data={props.data} group={props.group} />
}

function ShellRow(props: { message: SessionMessage.Info | undefined }) {
  return props.message?.type === "shell" ? <TranscriptShell message={props.message} /> : null
}

function Thinking(props: { content: SessionMessage.Content | undefined }) {
  return props.content?.type === "reasoning" ? <Reasoning text={props.content.text} streaming /> : null
}

export function TranscriptRow(props: { data: RowData; row: TimelineRow.Row }) {
  const row = props.row
  switch (row._tag) {
    case "UserMessage":
      return <UserMessage data={props.data} />
    case "AssistantPart":
      return <AssistantPart data={props.data} group={row.group} />
    case "Notice":
      return <TranscriptNotice message={props.data.message} />
    case "Shell":
      return <ShellRow message={props.data.message} />
    case "Thinking":
      return <Thinking content={props.data.content} />
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
