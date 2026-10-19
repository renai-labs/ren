import { type ChatAtoms, Projection, TimelineRow, TimelineText, ToolDisplay } from "@ren/chat"
import type { SessionMessage } from "@ren/schema/session-message"
import { ConversationShell } from "@ren/ui/conversation-shell"
import { CopyButton } from "@ren/ui/copy-button"
import { List } from "@ren/ui/list"
import { Separator } from "@ren/ui/separator"
import { Text } from "@ren/ui/text"
import { Transcript } from "@ren/ui/transcript"
import { DateTime } from "effect"
import { Platform } from "../../platform/platform.js"
import { TranscriptError, TranscriptNotice, TranscriptNoticeItem, TranscriptShell } from "./transcript-notice.js"
import { TranscriptTool } from "./transcript-tool.js"

interface Timeline {
  readonly view: ChatAtoms.View | undefined
  readonly messages: ReadonlyMap<string, SessionMessage.Info>
  readonly turns: ReadonlyMap<string, ReadonlyArray<SessionMessage.Assistant>>
  readonly lastGroups: ReadonlyMap<string, string>
  readonly activeMessageID: string | undefined
  readonly busy: boolean
}

const working = (timeline: Timeline, turnID: string) => {
  const last = timeline.turns.get(turnID)?.at(-1)
  return timeline.busy && timeline.activeMessageID === turnID && Boolean(last) && !last?.time.completed
}

const reasoningDuration = (content: SessionMessage.Reasoning) =>
  content.time?.completed
    ? TimelineText.duration(
        DateTime.toEpochMillis(content.time.completed) - DateTime.toEpochMillis(content.time.created),
      )
    : undefined

function Reasoning(props: { content: SessionMessage.Reasoning; streaming: boolean }) {
  return (
    <Transcript.Reasoning
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
  if (!write || copy?.partID !== props.partID || working(props.timeline, props.turnID))
    return <Transcript.Response content={props.text} streaming={streaming} />
  const meta = responseMeta(props.timeline.messages.get(props.turnID), assistants)
  return (
    <ConversationShell.Message
      author="assistant"
      actions={
        <>
          <CopyButton value={copy.text} onCopy={write} label="Copy response" size="extra-small" />
          {meta ? (
            <Text purpose="caption" tone="secondary" element="span">
              {meta}
            </Text>
          ) : null}
        </>
      }
    >
      <Transcript.Response content={props.text} streaming={streaming} />
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
        <Reasoning content={content} streaming={streaming && !content.time?.completed} />
      </List.Root>
    )
  if (content?.type === "tool")
    return (
      <List.Root>
        <TranscriptTool tool={content} view={props.timeline.view} />
      </List.Root>
    )
  return null
}

function GroupItem(props: { timeline: Timeline; reference: TimelineRow.PartRef }) {
  const message = props.timeline.messages.get(props.reference.messageID)
  if (props.reference.partID === props.reference.messageID)
    return message ? <TranscriptNoticeItem message={message} /> : null
  const content = Projection.resolveContent(message, props.reference.partID)
  if (content?.type === "tool") return <TranscriptTool tool={content} view={props.timeline.view} />
  if (content?.type === "reasoning")
    return (
      <Reasoning
        content={content}
        streaming={message?.type === "assistant" && !message.time.completed && !content.time?.completed}
      />
    )
  return null
}

const groupItem = (timeline: Timeline, reference: TimelineRow.PartRef): ReadonlyArray<ToolDisplay.GroupItem> => {
  const message = timeline.messages.get(reference.messageID)
  if (reference.partID === reference.messageID)
    return message ? [message.type === "shell" ? { type: "shell" } : { type: "notice" }] : []
  const content = Projection.resolveContent(message, reference.partID)
  return content ? [content] : []
}

const groupTitle = (timeline: Timeline, group: Exclude<TimelineRow.PartGroup, { readonly type: "part" }>) => {
  const items = group.refs.flatMap((reference) => groupItem(timeline, reference))
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
  const busy =
    (working(props.timeline, props.row.userMessageID) &&
      props.timeline.lastGroups.get(props.row.userMessageID) === group.key) ||
    group.refs.some((reference) => {
      const content = Projection.resolveContent(props.timeline.messages.get(reference.messageID), reference.partID)
      return content?.type === "tool" && ToolDisplay.status(content) === "running"
    })
  return (
    <List.Root>
      <Transcript.ToolGroup title={groupTitle(props.timeline, group)} working={busy}>
        {group.refs.map((reference) => (
          <GroupItem key={reference.partID} timeline={props.timeline} reference={reference} />
        ))}
      </Transcript.ToolGroup>
    </List.Root>
  )
}

function UserMessage(props: { message: SessionMessage.Info | undefined }) {
  if (props.message?.type !== "user") return null
  return (
    <ConversationShell.Message author="user">
      <ConversationShell.Bubble>
        <Text wrapping="preserved">{props.message.text}</Text>
      </ConversationShell.Bubble>
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

function Row(props: { timeline: Timeline; row: TimelineRow.Row }) {
  const row = props.row
  switch (row._tag) {
    case "UserMessage":
      return <UserMessage message={props.timeline.messages.get(row.userMessageID)} />
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

export function SessionTranscript(props: {
  view?: ChatAtoms.View
  messages: ReadonlyArray<SessionMessage.Info>
  rows: ReadonlyArray<TimelineRow.Row>
  activeMessageID: string | undefined
  busy: boolean
}) {
  const timeline: Timeline = {
    view: props.view,
    messages: new Map(props.messages.map((message) => [message.id, message])),
    turns: Projection.assistantMessagesByParent(props.messages),
    lastGroups: Projection.indexes(props.rows).lastAssistantGroupKey,
    activeMessageID: props.activeMessageID,
    busy: props.busy,
  }
  const last = props.rows.at(-1)
  return (
    <>
      {props.rows.map((row) => (
        <Row key={TimelineRow.key(row)} timeline={timeline} row={row} />
      ))}
      {props.busy && last?._tag === "UserMessage" ? <Transcript.Working /> : null}
    </>
  )
}
