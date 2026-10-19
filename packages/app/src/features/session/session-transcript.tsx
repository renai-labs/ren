import { Projection, TimelineRow, ToolState } from "@ren/chat"
import type { SessionMessage } from "@ren/schema/session-message"
import { ConversationShell } from "@ren/ui/conversation-shell"
import { Document } from "@ren/ui/document"
import { Icon } from "@ren/ui/icon"
import { List } from "@ren/ui/list"
import { Separator } from "@ren/ui/separator"
import { Text } from "@ren/ui/text"

type Messages = ReadonlyMap<string, SessionMessage.Info>

const subtitleKeys = ["description", "command", "filePath", "path", "pattern", "url", "query"]

const toolSubtitle = (tool: SessionMessage.Tool) => {
  const input = ToolState.input(tool)
  return subtitleKeys.map((key) => input[key]).find((value): value is string => typeof value === "string")
}

const toolTitle = (name: string) => name.slice(0, 1).toUpperCase() + name.slice(1).replaceAll(/[_-]+/g, " ")

const groupTitles = { context: "Gathered context", file: "Changed files", read: "Read files" }

function Tool(props: { tool: SessionMessage.Tool }) {
  const running = props.tool.state.status === "streaming" || props.tool.state.status === "running"
  const failed = props.tool.state.status === "error"
  const output = ToolState.output(props.tool)
  const subtitle = toolSubtitle(props.tool)
  return (
    <List.TranscriptDisclosure
      leading={<Icon glyph="Wrench" />}
      title={
        <Text purpose="label" tone="inherit" element="span" activity={running ? "shimmer" : "none"}>
          {toolTitle(props.tool.name)}
        </Text>
      }
      description={subtitle}
      trailing={
        failed ? (
          <Text tone="danger" element="span">
            Failed
          </Text>
        ) : undefined
      }
      label={`${toolTitle(props.tool.name)}${subtitle ? ` ${subtitle}` : ""}${running ? ", running" : ""}`}
    >
      <Text purpose="code" tone="secondary" element="div" wrapping="preserved">
        {failed ? ToolState.error(props.tool) : (output ?? JSON.stringify(ToolState.input(props.tool), null, 2))}
      </Text>
    </List.TranscriptDisclosure>
  )
}

function Part(props: { messages: Messages; reference: TimelineRow.PartRef }) {
  const message = props.messages.get(props.reference.messageID)
  const content = Projection.resolveContent(message, props.reference.partID)
  const streaming = message?.type === "assistant" && !message.time.completed
  if (content?.type === "text")
    return <Document.Markdown content={content.text} source={streaming ? "streaming" : "static"} scale="standard" />
  if (content?.type === "reasoning")
    return <Document.Markdown content={content.text} source={streaming ? "streaming" : "static"} tone="secondary" />
  if (content?.type === "tool")
    return (
      <List.Root>
        <Tool tool={content} />
      </List.Root>
    )
  return null
}

function AssistantPart(props: { messages: Messages; row: TimelineRow.AssistantPart }) {
  const group = props.row.group
  if (group.type === "part") return <Part messages={props.messages} reference={group.ref} />
  return (
    <List.Root>
      <List.TranscriptDisclosure appearance="summary" title={`${groupTitles[group.type]} (${group.refs.length})`}>
        {group.refs.flatMap((reference) => {
          const content = Projection.resolveContent(props.messages.get(reference.messageID), reference.partID)
          return content?.type === "tool" ? [<Tool key={reference.partID} tool={content} />] : []
        })}
      </List.TranscriptDisclosure>
    </List.Root>
  )
}

function noticeText(message: SessionMessage.Info | undefined): string | undefined {
  if (message?.type === "model-switched") return `Switched to ${message.model.id}`
  if (message?.type === "agent-switched") return "Agent changed"
  if (message?.type === "skill") return `Loaded the ${message.name} skill`
  if (message?.type === "synthetic" || message?.type === "system") return message.description ?? message.text
  return
}

function Notice(props: { messages: Messages; messageID: string }) {
  const message = props.messages.get(props.messageID)
  if (message?.type === "compaction")
    return <Separator label={message.status === "failed" ? "Compaction failed" : "Compaction"} />
  const text = noticeText(message)
  if (!text) return null
  return (
    <Text purpose="caption" tone="secondary">
      {text}
    </Text>
  )
}

function UserMessage(props: { messages: Messages; messageID: string }) {
  const message = props.messages.get(props.messageID)
  if (message?.type !== "user") return null
  return (
    <ConversationShell.Message author="user">
      <ConversationShell.Bubble>
        <Text wrapping="preserved">{message.text}</Text>
      </ConversationShell.Bubble>
    </ConversationShell.Message>
  )
}

function Shell(props: { messages: Messages; messageID: string }) {
  const message = props.messages.get(props.messageID)
  if (message?.type !== "shell") return null
  return (
    <List.Root>
      <List.TranscriptDisclosure
        leading={<Icon glyph="EnvVariable" />}
        title={message.command}
        description={message.status === "running" ? "Running" : undefined}
      >
        <Text purpose="code" tone="secondary" element="div" wrapping="preserved">
          {message.output?.output ?? ""}
        </Text>
      </List.TranscriptDisclosure>
    </List.Root>
  )
}

function Row(props: { messages: Messages; row: TimelineRow.Row }) {
  const row = props.row
  switch (row._tag) {
    case "UserMessage":
      return <UserMessage messages={props.messages} messageID={row.userMessageID} />
    case "AssistantPart":
      return <AssistantPart messages={props.messages} row={row} />
    case "Notice":
      return <Notice messages={props.messages} messageID={row.messageID} />
    case "Shell":
      return <Shell messages={props.messages} messageID={row.messageID} />
    case "Thinking":
      return (
        <Text tone="secondary" activity="shimmer">
          Thinking
        </Text>
      )
    case "Retry":
      return <Text tone="secondary">Retrying</Text>
    case "Error":
      return (
        <Text tone="danger" role="alert">
          {row.text}
        </Text>
      )
    case "TurnDivider":
      return <Separator label="Interrupted" />
    case "CompactionQueued":
      return <Separator label="Compaction queued" />
    case "TurnGap":
      return null
  }
}

export function SessionTranscript(props: {
  messages: ReadonlyArray<SessionMessage.Info>
  rows: ReadonlyArray<TimelineRow.Row>
}) {
  const messages: Messages = new Map(props.messages.map((message) => [message.id, message]))
  return props.rows.map((row) => <Row key={TimelineRow.key(row)} messages={messages} row={row} />)
}
