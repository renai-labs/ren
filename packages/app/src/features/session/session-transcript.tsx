import { useAtomValue } from "@effect/atom-react"
import {
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
import type { SessionMessage } from "@ren/schema/session/message"
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
import { ChatReact } from "@ren/chat/react"
import { DateTime } from "effect"
import { AsyncResult } from "effect/reactivity"
import { Platform } from "../../platform/platform.js"
import { TranscriptError, TranscriptNotice, TranscriptNoticeItem, TranscriptShell } from "./transcript-notice.js"
import { FileChanges, TranscriptTool } from "./transcript-tool.js"

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

const isSubagent = (tool: SessionMessage.Tool) => tool.name === "subagent" || tool.name === "task"

function Subagent(props: { shared: Shared; tool: SessionMessage.Tool }) {
  const state = AsyncResult.getOrElse(useAtomValue(ChatReact.useAtoms().state(props.shared.root)), () => ChatState.empty)
  const card = Family.subagent(state, props.shared.sessionID, props.tool)
  const child = card.child
  const openChild = props.shared.onOpenChild
  return (
    <Transcript.Subagent
      title={card.title}
      description={card.description}
      status={card.status}
      background={card.background}
      needsInput={card.needsInput}
      failure={ToolDisplay.error(props.tool)}
      retry={card.retry}
      tools={card.tools}
      activity={card.activity}
      onOpen={child?.startsWith("ses_") ? () => openChild(Session.ID.make(child)) : undefined}
    />
  )
}

function Tool(props: { shared: Shared; tool: SessionMessage.Tool }) {
  if (isSubagent(props.tool)) return <Subagent shared={props.shared} tool={props.tool} />
  return (
    <TranscriptTool
      tool={props.tool}
      view={{ root: props.shared.root, sessionID: props.shared.sessionID }}
      open={props.shared.part === props.tool.id || TimelineOpen.defaultOpen(props.tool, props.shared.detail)}
    />
  )
}

const reasoningDuration = (content: SessionMessage.Reasoning) =>
  content.time?.completed
    ? TimelineText.duration(
        DateTime.toEpochMillis(content.time.completed) - DateTime.toEpochMillis(content.time.created),
      )
    : undefined

const streaming = (message: SessionMessage.Info | undefined) =>
  message?.type === "assistant" && !message.time.completed

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

function Response(props: { shared: Shared; data: RowData; text: string }) {
  const platform = Platform.usePlatform()
  const write = platform.writeClipboardText
  const copy = props.data.copy
  return (
    <ConversationShell.Message
      author="assistant"
      actions={
        !write || copy === undefined ? undefined : (
          <>
            <CopyButton value={copy} onCopy={write} label="Copy response" size="extra-small" />
            {props.data.meta ? (
              <Text purpose="caption" tone="secondary" element="span">
                {props.data.meta}
              </Text>
            ) : null}
          </>
        )
      }
    >
      <Transcript.Response
        content={props.text}
        streaming={streaming(props.data.message)}
        onOpenSession={props.shared.onOpenSession}
      />
    </ConversationShell.Message>
  )
}

function Part(props: { shared: Shared; data: RowData; reference: TimelineRow.PartRef }) {
  const content = Projection.resolveContent(props.data.message, props.reference.partID)
  if (content?.type === "text") return <Response shared={props.shared} data={props.data} text={content.text} />
  if (content?.type === "reasoning")
    return (
      <List.Root>
        <Reasoning
          content={content}
          streaming={streaming(props.data.message) && !content.time?.completed}
          open={TimelineOpen.defaultOpen(content, props.shared.detail)}
        />
      </List.Root>
    )
  if (content?.type === "tool")
    return (
      <List.Root>
        <Tool shared={props.shared} tool={content} />
      </List.Root>
    )
  return null
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
    return <Reasoning content={props.item} streaming={streaming(message) && !props.item.time?.completed} />
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

function Run(props: { shared: Shared; run: ToolDisplay.Run; entries: ReadonlyArray<Entry> }) {
  const run = props.run
  if (run.type === "item") return <RunItem item={run.item} entries={props.entries} />
  const first = run.tools.at(0)
  if (run.kind === "single") return first ? <Tool shared={props.shared} tool={first} /> : null
  if (run.kind === "file")
    return (
      <FileChanges
        tools={run.tools}
        placement="list-item"
        open={run.tools.some((tool) => tool.id === props.shared.part)}
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

function AssistantPart(props: { shared: Shared; data: RowData; row: TimelineRow.AssistantPart }) {
  const group = props.row.group
  if (group.type === "part") return <Part shared={props.shared} data={props.data} reference={group.ref} />
  const found = entries(group.refs, props.data.messages ?? [])
  const items = found.map((entry) => entry.item)
  const tools = items.filter((item): item is SessionMessage.Tool => item.type === "tool")
  const revealed = group.refs.some((reference) => reference.partID === props.shared.part)
  return (
    <List.Root>
      <Transcript.ToolGroup
        title={groupTitle(group, items)}
        working={props.data.working === true || running(tools)}
        defaultOpen={revealed}
      >
        {group.type === "file" ? (
          <FileChanges tools={tools} placement="list-item" open={revealed} />
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
      </Transcript.ToolGroup>
    </List.Root>
  )
}

const steerable = new Set<ChatState.PendingStatus | undefined>(["starting", "steering", "stranded"])

function PendingActions(props: { shared: Shared; message: SessionMessage.User; updating: boolean }) {
  const act = props.shared.onPending
  if (!act) return null
  return (
    <div className="flex items-center gap-1">
      <Button
        appearance="plain"
        size="small"
        disabled={props.updating}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => act("queue", props.message)}
      >
        Move to queue
      </Button>
      <Button
        appearance="plain"
        size="small"
        disabled={props.updating}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => act("cancel", props.message)}
      >
        Delete pending
      </Button>
    </div>
  )
}

function UserMessage(props: { shared: Shared; data: RowData }) {
  const platform = Platform.usePlatform()
  const message = props.data.message
  if (message?.type !== "user") return null
  const status = props.data.status
  const pending = steerable.has(status)
  const write = message.text ? platform.writeClipboardText : undefined
  const revert = pending ? undefined : props.shared.onRevert
  return (
    <ConversationShell.Message
      author="user"
      {...(props.data.sender && {
        sender: props.data.sender,
        avatar: (
          <Avatar.Root
            name={props.data.sender}
            image={props.data.senderImage}
            size="medium"
            tone="inverse"
            decorative
          />
        ),
      })}
      actions={
        write || revert ? (
          <>
            {revert ? (
              <IconButton
                label="Revert to this message"
                size="extra-small"
                disabled={props.shared.reverting}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => revert(message)}
              >
                <Icon glyph="Restore" />
              </IconButton>
            ) : null}
            {write ? <CopyButton value={message.text} onCopy={write} label="Copy message" size="extra-small" /> : null}
          </>
        ) : undefined
      }
    >
      <ConversationShell.Bubble>
        <Transcript.UserText text={message.text} highlights={TimelineText.mentions(message)} />
      </ConversationShell.Bubble>
      <Text purpose="caption" tone="secondary" element="span">
        {props.data.caption ? `${props.data.caption} · ` : ""}
        <Time value={DateTime.toEpochMillis(message.time.created)} format="time-of-day" />
      </Text>
      {pending ? <PendingActions shared={props.shared} message={message} updating={props.data.updating === true} /> : null}
    </ConversationShell.Message>
  )
}

function Thinking(props: { data: RowData; reference: TimelineRow.PartRef }) {
  const content = Projection.resolveContent(props.data.message, props.reference.partID)
  if (content?.type !== "reasoning") return null
  return (
    <List.Root>
      <Reasoning content={content} streaming />
    </List.Root>
  )
}

function Shell(props: { message: SessionMessage.Info | undefined }) {
  if (props.message?.type !== "shell") return null
  return (
    <List.Root>
      <TranscriptShell message={props.message} />
    </List.Root>
  )
}

export function TranscriptRow(props: { shared: Shared; data: RowData; row: TimelineRow.Row }) {
  const row = props.row
  switch (row._tag) {
    case "UserMessage":
      return <UserMessage shared={props.shared} data={props.data} />
    case "AssistantPart":
      return <AssistantPart shared={props.shared} data={props.data} row={row} />
    case "Notice":
      return <TranscriptNotice message={props.data.message} />
    case "Shell":
      return <Shell message={props.data.message} />
    case "Thinking":
      return <Thinking data={props.data} reference={row.ref} />
    case "Retry":
      return props.data.retry ? (
        <Transcript.Retry
          attempt={props.data.retry.attempt}
          message={props.data.retry.message}
          next={props.data.retry.next}
        />
      ) : null
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
