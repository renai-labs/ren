import {
  type ChatAtoms,
  ChatState,
  Family,
  Projection,
  type TimelineDetail,
  TimelineOpen,
  TimelineRow,
  TimelineText,
  ToolDisplay,
} from "@ren/chat"
import { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session-message"
import type { SessionModel } from "@ren/schema/session-model"
import { Avatar } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { ConversationShell } from "@ren/ui/conversation-shell"
import { CopyButton } from "@ren/ui/copy-button"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { List } from "@ren/ui/list"
import { Separator } from "@ren/ui/separator"
import { Text } from "@ren/ui/text"
import { Time } from "@ren/ui/time"
import { Transcript } from "@ren/ui/transcript"
import { DateTime } from "effect"
import { Platform } from "../../platform/platform.js"
import { TranscriptError, TranscriptNotice, TranscriptNoticeItem, TranscriptShell } from "./transcript-notice.js"
import { FileChanges, TranscriptTool } from "./transcript-tool.js"
import { TranscriptTurn } from "./transcript-turn.js"

export type PendingAction = "queue" | "cancel"

export interface Person {
  readonly name: string
  readonly image: string | undefined
}

export interface Timeline {
  readonly view: ChatAtoms.View | undefined
  readonly state: ChatState.State
  readonly messages: ReadonlyMap<string, SessionMessage.Info>
  readonly turns: ReadonlyMap<string, ReadonlyArray<SessionMessage.Assistant>>
  readonly lastGroups: ReadonlyMap<string, string>
  readonly contexts: ReadonlyMap<string, { readonly agent: string; readonly model: SessionModel.Ref }>
  readonly modelNames: ReadonlyMap<string, string>
  readonly activeMessageID: string | undefined
  readonly busy: boolean
  readonly part: string | undefined
  readonly reverting: boolean
  readonly updating: ReadonlySet<string>
  readonly onRevert: ((message: SessionMessage.User) => void) | undefined
  readonly onPending: ((action: PendingAction, message: SessionMessage.User) => void) | undefined
  readonly onOpenChild: (sessionID: Session.ID) => void
  readonly onOpenSession: ((sessionID: string) => void) | undefined
  readonly detail: TimelineDetail.Detail | undefined
  readonly viewer: string | undefined
  readonly people: ReadonlyMap<string, Person>
}

const isSubagent = (tool: SessionMessage.Tool) => tool.name === "subagent" || tool.name === "task"

function Subagent(props: { timeline: Timeline; tool: SessionMessage.Tool }) {
  const card = Family.subagent(props.timeline.state, props.timeline.view?.sessionID ?? "", props.tool)
  const child = card.child
  const openChild = props.timeline.onOpenChild
  return (
    <Transcript.Subagent
      title={card.title}
      description={card.description}
      status={card.status}
      background={card.background}
      needsInput={card.needsInput}
      failure={ToolDisplay.error(props.tool)}
      tools={card.tools}
      activity={card.activity}
      onOpen={child?.startsWith("ses_") ? () => openChild(Session.ID.make(child)) : undefined}
    />
  )
}

function Tool(props: { timeline: Timeline; tool: SessionMessage.Tool }) {
  if (isSubagent(props.tool)) return <Subagent timeline={props.timeline} tool={props.tool} />
  return (
    <TranscriptTool
      tool={props.tool}
      view={props.timeline.view}
      open={props.timeline.part === props.tool.id || TimelineOpen.defaultOpen(props.tool, props.timeline.detail)}
    />
  )
}

const reasoningDuration = (content: SessionMessage.Reasoning) =>
  content.time?.completed
    ? TimelineText.duration(
        DateTime.toEpochMillis(content.time.completed) - DateTime.toEpochMillis(content.time.created),
      )
    : undefined

function Reasoning(props: { content: SessionMessage.Reasoning; streaming: boolean; open?: boolean }) {
  return (
    <Transcript.Reasoning
      defaultOpen={props.open ?? false}
      content={props.content.text}
      streaming={props.streaming}
      heading={Projection.reasoningHeading(props.content.text)}
      duration={reasoningDuration(props.content)}
    />
  )
}

const responseMeta = (turn: SessionMessage.Info | undefined, assistants: ReadonlyArray<SessionMessage.Assistant>) => {
  const duration = TimelineText.duration(
    TimelineText.turnDuration(turn?.type === "user" ? turn : undefined, assistants) ?? -1,
  )
  const interrupted = Projection.isInterrupted(assistants.at(-1)?.error)
  return [duration, interrupted ? "Interrupted" : undefined].filter(Boolean).join(" · ")
}

function Response(props: { timeline: Timeline; turnID: string; messageID: string; partID: string; text: string }) {
  const platform = Platform.usePlatform()
  const message = props.timeline.messages.get(props.messageID)
  const streaming = message?.type === "assistant" && !message.time.completed
  const assistants = props.timeline.turns.get(props.turnID) ?? []
  const copy = TimelineText.copyText(assistants)
  const write = platform.writeClipboardText
  const response = (
    <Transcript.Response content={props.text} streaming={streaming} onOpenSession={props.timeline.onOpenSession} />
  )
  const copyable = write && copy?.partID === props.partID && !TranscriptTurn.working(props.timeline, props.turnID)
  const meta = copyable ? responseMeta(props.timeline.messages.get(props.turnID), assistants) : undefined
  return (
    <ConversationShell.Message
      author="assistant"
      actions={
        copyable ? (
          <>
            <CopyButton value={copy.text} onCopy={write} label="Copy response" size="extra-small" />
            {meta ? (
              <Text purpose="caption" tone="secondary" element="span">
                {meta}
              </Text>
            ) : null}
          </>
        ) : undefined
      }
    >
      {response}
    </ConversationShell.Message>
  )
}

function Part(props: { timeline: Timeline; turnID: string; reference: TimelineRow.PartRef }) {
  const message = props.timeline.messages.get(props.reference.messageID)
  const content = Projection.resolveContent(message, props.reference.partID)
  const streaming = message?.type === "assistant" && !message.time.completed
  if (content?.type === "text")
    return (
      <Response
        timeline={props.timeline}
        turnID={props.turnID}
        messageID={props.reference.messageID}
        partID={props.reference.partID}
        text={content.text}
      />
    )
  if (content?.type === "reasoning")
    return (
      <List.Root>
        <Reasoning
          content={content}
          streaming={streaming && !content.time?.completed}
          open={TimelineOpen.defaultOpen(content, props.timeline.detail)}
        />
      </List.Root>
    )
  if (content?.type === "tool")
    return (
      <List.Root>
        <Tool timeline={props.timeline} tool={content} />
      </List.Root>
    )
  return null
}

interface Entry {
  readonly reference: TimelineRow.PartRef
  readonly message: SessionMessage.Info | undefined
  readonly item: ToolDisplay.GroupItem
}

const entries = (timeline: Timeline, refs: ReadonlyArray<TimelineRow.PartRef>): ReadonlyArray<Entry> =>
  refs.flatMap((reference): ReadonlyArray<Entry> => {
    const message = timeline.messages.get(reference.messageID)
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
  const entry = props.entries.find((candidate) => candidate.item === props.item)
  const message = entry?.message
  if (props.item.type === "reasoning") {
    const streaming = message?.type === "assistant" && !message.time.completed && !props.item.time?.completed
    return <Reasoning content={props.item} streaming={streaming} />
  }
  return message ? <TranscriptNoticeItem message={message} /> : null
}

function ReadRun(props: { tools: ReadonlyArray<SessionMessage.Tool>; names: string }) {
  return (
    <Transcript.Tool
      kind="file"
      title="Read"
      subtitle={props.names}
      status={running(props.tools) ? "running" : "completed"}
    >
      {props.tools.map((tool) => (
        <Transcript.ToolDetail
          key={tool.id}
          label={ToolDisplay.subtitle(tool) ?? "Output"}
          value={ToolDisplay.output(tool) ?? "No output"}
        />
      ))}
    </Transcript.Tool>
  )
}

function Run(props: { timeline: Timeline; run: ToolDisplay.Run; entries: ReadonlyArray<Entry> }) {
  const run = props.run
  if (run.type === "item") return <RunItem item={run.item} entries={props.entries} />
  const first = run.tools.at(0)
  if (run.kind === "single") return first ? <Tool timeline={props.timeline} tool={first} /> : null
  if (run.kind === "file")
    return (
      <FileChanges
        tools={run.tools}
        placement="list-item"
        open={run.tools.some((tool) => tool.id === props.timeline.part)}
      />
    )
  const names = run.tools.flatMap((tool) => ToolDisplay.subtitle(tool) ?? []).join(", ")
  if (run.kind === "skill")
    return <List.TranscriptItem leading={<Icon glyph="Wrench" />} title="Loaded skills" description={names} />
  return <ReadRun tools={run.tools} names={names} />
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

function AssistantPart(props: { timeline: Timeline; row: TimelineRow.AssistantPart }) {
  const group = props.row.group
  if (group.type === "part")
    return <Part timeline={props.timeline} turnID={props.row.userMessageID} reference={group.ref} />
  const found = entries(props.timeline, group.refs)
  const items = found.map((entry) => entry.item)
  const tools = items.filter((item): item is SessionMessage.Tool => item.type === "tool")
  const busy =
    (TranscriptTurn.working(props.timeline, props.row.userMessageID) &&
      props.timeline.lastGroups.get(props.row.userMessageID) === group.key) ||
    running(tools)
  const revealed = group.refs.some((reference) => reference.partID === props.timeline.part)
  return (
    <List.Root>
      <Transcript.ToolGroup title={groupTitle(group, items)} working={busy} defaultOpen={revealed}>
        {group.type === "file" ? (
          <FileChanges tools={tools} placement="list-item" open={revealed} />
        ) : (
          ToolDisplay.runs(items).map((run, index) => (
            <Run
              key={run.type === "item" ? `item:${index}` : (run.tools.at(0)?.id ?? `run:${index}`)}
              timeline={props.timeline}
              run={run}
              entries={found}
            />
          ))
        )}
      </Transcript.ToolGroup>
    </List.Root>
  )
}

const steerable = new Set<ChatState.PendingStatus | undefined>(["starting", "steering", "stranded"])

function UserMeta(props: { timeline: Timeline; message: SessionMessage.User; pending: boolean }) {
  const context = props.timeline.contexts.get(props.message.id)
  const model = context ? TimelineText.modelLabel(context.model, props.timeline.modelNames) : undefined
  const head = [props.pending ? "Pending" : undefined, model].filter(Boolean).join(" · ")
  return (
    <Text purpose="caption" tone="secondary" element="span">
      {head ? `${head} · ` : ""}
      <Time value={DateTime.toEpochMillis(props.message.time.created)} format="time-of-day" />
    </Text>
  )
}

function PendingActions(props: { timeline: Timeline; message: SessionMessage.User }) {
  const act = props.timeline.onPending
  if (!act) return null
  const updating = props.timeline.updating.has(props.message.id)
  return (
    <div className="flex items-center gap-1">
      <Button
        appearance="plain"
        size="small"
        disabled={updating}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => act("queue", props.message)}
      >
        Move to queue
      </Button>
      <Button
        appearance="plain"
        size="small"
        disabled={updating}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => act("cancel", props.message)}
      >
        Delete pending
      </Button>
    </div>
  )
}

function UserActions(props: { timeline: Timeline; message: SessionMessage.User; pending: boolean }) {
  const platform = Platform.usePlatform()
  const message = props.message
  const write = message.text ? platform.writeClipboardText : undefined
  const revert = props.pending ? undefined : props.timeline.onRevert
  if (!write && !revert) return null
  return (
    <>
      {revert ? (
        <IconButton
          label="Revert to this message"
          size="extra-small"
          disabled={props.timeline.reverting}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => revert(message)}
        >
          <Icon glyph="Restore" />
        </IconButton>
      ) : null}
      {write ? <CopyButton value={message.text} onCopy={write} label="Copy message" size="extra-small" /> : null}
    </>
  )
}

const senderOf = (timeline: Timeline, message: SessionMessage.User) => {
  const userId = message.sender?.userId
  if (!userId || userId === timeline.viewer) return
  return timeline.people.get(userId) ?? { name: "Member", image: undefined }
}

const identity = (timeline: Timeline, message: SessionMessage.User) => {
  const sender = senderOf(timeline, message)
  return sender
    ? {
        sender: sender.name,
        avatar: <Avatar.Root name={sender.name} image={sender.image} size="medium" tone="inverse" decorative />,
      }
    : {}
}

function UserMessage(props: { timeline: Timeline; message: SessionMessage.Info | undefined }) {
  const platform = Platform.usePlatform()
  const message = props.message
  if (message?.type !== "user") return null
  const sessionID = props.timeline.view?.sessionID
  const status = sessionID ? ChatState.pendingStatus(props.timeline.state, sessionID, message.id) : undefined
  const pending = steerable.has(status)
  const actionable = Boolean((message.text && platform.writeClipboardText) || (!pending && props.timeline.onRevert))
  return (
    <ConversationShell.Message
      author="user"
      {...identity(props.timeline, message)}
      actions={actionable ? <UserActions timeline={props.timeline} message={message} pending={pending} /> : undefined}
    >
      <ConversationShell.Bubble>
        <Transcript.UserText text={message.text} highlights={TimelineText.mentions(message)} />
      </ConversationShell.Bubble>
      <UserMeta timeline={props.timeline} message={message} pending={status === "steering" || status === "stranded"} />
      {pending ? <PendingActions timeline={props.timeline} message={message} /> : null}
    </ConversationShell.Message>
  )
}

function Thinking(props: { timeline: Timeline; reference: TimelineRow.PartRef }) {
  const content = Projection.resolveContent(
    props.timeline.messages.get(props.reference.messageID),
    props.reference.partID,
  )
  if (content?.type !== "reasoning") return null
  return (
    <List.Root>
      <Reasoning content={content} streaming />
    </List.Root>
  )
}

function Retry(props: { timeline: Timeline; turnID: string }) {
  const retry = TimelineText.retryStatus(props.timeline.turns.get(props.turnID) ?? [], undefined)
  if (!retry || props.timeline.activeMessageID !== props.turnID) return null
  return <Transcript.Retry attempt={retry.attempt} message={retry.message} next={retry.next} />
}

function Shell(props: { message: SessionMessage.Info | undefined }) {
  if (props.message?.type !== "shell") return null
  return (
    <List.Root>
      <TranscriptShell message={props.message} />
    </List.Root>
  )
}

export function TranscriptRow(props: { timeline: Timeline; row: TimelineRow.Row }) {
  const row = props.row
  switch (row._tag) {
    case "UserMessage":
      return <UserMessage timeline={props.timeline} message={props.timeline.messages.get(row.userMessageID)} />
    case "AssistantPart":
      return <AssistantPart timeline={props.timeline} row={row} />
    case "Notice":
      return <TranscriptNotice message={props.timeline.messages.get(row.messageID)} />
    case "Shell":
      return <Shell message={props.timeline.messages.get(row.messageID)} />
    case "Thinking":
      return <Thinking timeline={props.timeline} reference={row.ref} />
    case "Retry":
      return <Retry timeline={props.timeline} turnID={row.userMessageID} />
    case "Error":
      return <TranscriptError text={row.text} />
    case "TurnDivider":
      return <Separator label="Interrupted" />
    case "CompactionQueued":
      return <Separator label="Session compaction queued" />
    case "TurnGap":
      return null
  }
}
