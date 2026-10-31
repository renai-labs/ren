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
import { IconClock, IconPencil, IconRestore } from "@tabler/icons-react"
import { useState } from "react"
import { Platform } from "../../platform/platform.js"
import { ChannelMessageHeader, ChannelReplyMessage } from "./channel-message.js"
import { ScheduleMessageHeader } from "./schedule-message.js"
import { TranscriptContext } from "./transcript-context.js"
import { Separator, TranscriptNotice, TranscriptShell } from "./transcript-notice.js"
import { TurnFailed, TurnRetrying } from "./turn-problem.js"
import { UserBody } from "./user-attachments.js"
import { Note, Reasoning, Tool } from "./transcript-tool.js"

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
  readonly sender?: string | undefined
  readonly senderImage?: string | undefined
  readonly updating?: boolean
  readonly working?: boolean
  readonly copy?: string | undefined
  readonly retry?: TimelineText.Retry | undefined
  readonly provider?: string | undefined
  readonly model?: string | undefined
  readonly midTurn?: boolean
  readonly prompt?: string | undefined
}

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
            <CopyButton value={copy} onCopy={write} label="Copy response" />
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

function GroupItem(props: { entry: Entry }) {
  const transcript = TranscriptContext.useValue()
  const item = props.entry.item
  const message = props.entry.message
  if (item.type === "tool")
    return (
      <Tool
        tool={item}
        view={{ root: transcript.state.root, sessionID: transcript.state.sessionID }}
        open={transcript.state.part === item.id}
        onOpenChild={transcript.actions.onOpenChild}
      />
    )
  if (item.type === "reasoning")
    return (
      <Reasoning
        text={item.text}
        streaming={message?.type === "assistant" && !message.time.completed && !item.time?.completed}
      />
    )
  if (message?.type === "shell") return <TranscriptShell message={message} />
  const notice = message && TimelineText.notice(message)
  return notice ? <Note title={notice.title} detail={notice.detail} /> : null
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
    <span className="flex items-center gap-1">
      {!props.pending && transcript.actions.onEdit !== undefined && message.text !== "" ? (
        <Button
          variant="ghost"
          size="icon-sm"
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
          size="icon-sm"
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
        size="sm"
        disabled={props.updating}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => act("queue", props.message)}
      >
        Move to queue
      </Button>
      <Button
        variant="ghost"
        size="sm"
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
    <Message align="end" className="w-auto @min-transcript:-mr-13.5">
      {props.data.sender ? (
        <MessageAvatar className="ml-3.5">
          <Avatar size="sm" aria-hidden>
            {props.data.senderImage ? <AvatarImage src={props.data.senderImage} alt="" /> : null}
            <AvatarFallback className="bg-secondary">{props.data.sender.charAt(0)}</AvatarFallback>
          </Avatar>
        </MessageAvatar>
      ) : null}
      <MessageContent>
        {props.data.sender ? <MessageHeader className="px-0">{props.data.sender}</MessageHeader> : null}
        <ChannelMessageHeader origin={message.channel} />
        <ScheduleMessageHeader origin={message.schedule} />
        <UserBody message={message}>
          {(typed) => (
            <Bubble variant="muted" align="end">
              <BubbleContent className="rounded-xl rounded-tr-lg px-4 py-2 text-base leading-[1.6] whitespace-pre-wrap">
                <UserText text={typed} highlights={TimelineText.mentions(message)} apps={transcript.state.apps} />
              </BubbleContent>
            </Bubble>
          )}
        </UserBody>
        <MessageFooter className="justify-end gap-1">
          {pending ? <span className="px-1 text-xs text-muted-foreground">Pending</span> : null}
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

function ProblemRow(props: { data: RowData; row: TimelineRow.Row }) {
  const problems = TranscriptContext.useValue().actions.problems ?? { admin: false }
  const data = props.data
  const prompt = data.prompt
  const tryAgain = problems.onTryAgain
  const handlers = {
    onTryAgain: tryAgain && prompt ? () => tryAgain(prompt) : undefined,
    onContinue: problems.onContinue,
    onChangeModel: problems.onChangeModel,
    onStop: problems.onStop,
  }
  const provider = data.provider ?? "the model provider"
  if (props.row._tag === "Retry")
    return data.retry ? (
      <TurnRetrying
        text={data.retry.message}
        provider={provider}
        next={data.retry.next}
        attempt={data.retry.attempt}
        handlers={handlers}
      />
    ) : null
  if (props.row._tag !== "Error") return null
  return (
    <TurnFailed
      kind={props.row.kind}
      text={props.row.text}
      provider={provider}
      model={data.model ?? "This model"}
      midTurn={data.midTurn === true}
      admin={problems.admin}
      handlers={handlers}
    />
  )
}

function TurnStep(props: { data: RowData; row: TimelineRow.Row }) {
  const transcript = TranscriptContext.useValue()
  const row = props.row
  const content = props.data.content
  if (row._tag !== "AssistantPart" || content?.type !== "text") return <TranscriptRow data={props.data} row={row} />
  return (
    <div data-searchable className="min-w-0">
      <Markdown
        streaming={props.data.streaming === true}
        onOpenSession={transcript.actions.onOpenSession}
        apps={transcript.state.apps}
        className="leading-relaxed"
      >
        {content.text}
      </Markdown>
    </div>
  )
}

type TurnItem = { readonly row: TimelineRow.Row; readonly data: RowData }

const isText = (item: TurnItem) => item.row._tag === "AssistantPart" && item.data.content?.type === "text"

const runsOf = (items: ReadonlyArray<TurnItem>) =>
  items.reduce<Array<{ key: string; text: boolean; items: Array<TurnItem> }>>((all, item) => {
    const last = all.at(-1)
    if (last && !last.text && !isText(item)) last.items.push(item)
    else all.push({ key: TimelineRow.key(item.row), text: isText(item), items: [item] })
    return all
  }, [])

function StepRun(props: { items: ReadonlyArray<TurnItem> }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {props.items.map((item) => (
        <div
          key={TimelineRow.key(item.row)}
          data-row-key={TimelineRow.key(item.row)}
          className="flex min-w-0 flex-col gap-2 empty:hidden"
        >
          <TurnStep data={item.data} row={item.row} />
        </div>
      ))}
    </div>
  )
}

export function TurnGroup(props: {
  rows: ReadonlyArray<TurnItem>
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
          {runsOf(props.rows).map((run) => (
            <StepRun key={run.key} items={run.items} />
          ))}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

function AssistantPart(props: { data: RowData; group: TimelineRow.PartGroup }) {
  if (props.group.type === "part") return <Part data={props.data} />
  return entries(props.group.refs, props.data.messages ?? []).map((entry) => (
    <GroupItem key={`${entry.reference.messageID}:${entry.reference.partID}`} entry={entry} />
  ))
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
    case "Error":
      return <ProblemRow data={props.data} row={row} />
    case "TurnDivider":
      return <Separator label="Interrupted" />
    case "CompactionQueued":
      return <Separator label="Session compaction queued" />
    case "TurnGap":
      return null
  }
}
