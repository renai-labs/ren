export * as Working from "./working.js"

import type { SessionMessage } from "@ren/schema/session-message"
import { Predicate } from "effect"
import { ChatState } from "./chat-state.js"
import { Family } from "./family.js"
import { Projection } from "./projection.js"
import type { TimelineRow } from "./timeline-row.js"
import { ToolState } from "./tool-state.js"

const running = (
  content: SessionMessage.Content | undefined,
  background: ReadonlySet<string>,
): content is SessionMessage.Tool => {
  if (content?.type !== "tool") return false
  if (content.state.status === "streaming" || content.state.status === "running") return true
  const task = ToolState.metadata(content)[content.name === "subagent" ? "sessionID" : "shellID"]
  return background.has(content.id) || (Predicate.isString(task) && background.has(task))
}

const hides = (
  row: TimelineRow.Row,
  messages: ReadonlyMap<string, SessionMessage.Info>,
  background: ReadonlySet<string>,
) => {
  if (Predicate.isTagged(row, "Thinking")) return true
  if (Predicate.isTagged(row, "Notice")) {
    const message = messages.get(row.messageID)
    return message?.type === "compaction" && message.status === "running"
  }
  if (!Predicate.isTagged(row, "AssistantPart") || row.group.type === "context" || row.group.type === "read")
    return false
  return (row.group.type === "part" ? [row.group.ref] : row.group.refs).some((reference) =>
    running(Projection.resolveContent(messages.get(reference.messageID), reference.partID), background),
  )
}

const waiting = (state: ChatState.State, sessionID: string, assistant: SessionMessage.Assistant | undefined) => {
  if (!assistant) return false
  if (assistant.retry) return true
  if (
    assistant.error &&
    !ChatState.pending(state, sessionID).some((item) => item.type === "user" && item.delivery === "steer")
  )
    return true
  const content = assistant.content.at(-1)
  return !assistant.time.completed && !assistant.time.streamed && content?.type === "text" && content.text.trim() !== ""
}

const asking = (state: ChatState.State, sessionID: string) =>
  (state.permissions[sessionID]?.length ?? 0) > 0 || (state.forms[sessionID]?.length ?? 0) > 0

export const show = (
  state: ChatState.State,
  sessionID: string,
  projection: Projection.Projection,
  owner = sessionID,
) => {
  const active = projection.activeMessageID
  if (ChatState.activity(state, sessionID) !== "running" || asking(state, sessionID) || !active) return false
  const messages = ChatState.visible(state, sessionID)
  if (waiting(state, sessionID, Projection.assistantMessagesByParent(messages).get(active)?.at(-1))) return false
  const background = new Set(Family.background(state, owner).tasks.map((task) => task.id))
  const byID = new Map(messages.map((message) => [message.id, message]))
  return !projection.rows.some((row) => row.userMessageID === active && hides(row, byID, background))
}
