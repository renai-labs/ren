export * as Outbox from "./outbox.js"

// oxlint-disable typescript/no-misused-spread -- schema types are plain readonly structs; Struct.assign would widen the literal tags these updates keep

import type { Session } from "@ren/schema/session"
import { SessionInbox } from "@ren/schema/session/inbox"
import { SessionMessage } from "@ren/schema/session/message"
import { type DateTime, Schema } from "effect"
import { ChatState } from "./chat-state.js"
import { Reducer } from "./reducer.js"

export interface Prompt {
  readonly sessionID: Session.ID
  readonly id: SessionMessage.ID
  readonly text: string
  readonly delivery: SessionInbox.Delivery
  readonly sender?: SessionMessage.Sender
  readonly agents?: ReadonlyArray<SessionMessage.AgentAttachment>
}

// oxlint-disable-next-line ren/no-comments -- A message the brain has not accepted yet, as the host keeps it in browser storage per chat (E118).
export interface Kept extends Schema.Schema.Type<typeof Kept> {}
export const Kept = Schema.Struct({
  id: SessionMessage.ID,
  text: Schema.String,
  delivery: SessionInbox.Delivery,
  agents: Schema.optionalKey(Schema.Array(SessionMessage.AgentAttachment)),
  skills: Schema.optionalKey(
    Schema.Array(Schema.Struct({ id: Schema.String, mention: Schema.optionalKey(SessionMessage.Mention) })),
  ),
})

export const isFresh = (state: ChatState.State, sessionID: string, id: string) =>
  !ChatState.messages(state, sessionID).some((item) => item.id === id) &&
  !ChatState.pending(state, sessionID).some((item) => item.id === id)

export const admit = (state: ChatState.State, prompt: Prompt, now: DateTime.Utc): ChatState.State => {
  if (!isFresh(state, prompt.sessionID, prompt.id)) return state
  return Reducer.admit(
    { ...state, outbox: new Set([...state.outbox, prompt.id]) },
    {
      id: prompt.id,
      sessionID: prompt.sessionID,
      time: { created: now },
      type: "user",
      delivery: prompt.delivery,
      payload: {
        text: prompt.text,
        ...(prompt.sender && { sender: prompt.sender }),
        ...(prompt.agents && { agents: prompt.agents }),
      },
    },
  )
}

export const rollback = (state: ChatState.State, sessionID: string, id: string): ChatState.State => {
  if (!state.outbox.has(id)) return state
  return Reducer.retract({ ...state, outbox: new Set([...state.outbox].filter((item) => item !== id)) }, sessionID, id)
}

export const acknowledge = (state: ChatState.State, id: string): ChatState.State =>
  state.outbox.has(id) ? { ...state, outbox: new Set([...state.outbox].filter((item) => item !== id)) } : state

export const propose = (
  state: ChatState.State,
  sessionID: Session.ID,
  id: SessionMessage.ID,
  now: DateTime.Utc,
): ChatState.State => {
  const compacting = ChatState.set(state.compacting, sessionID, { id, observed: new Set<string>() })
  if (ChatState.pending(state, sessionID).some((item) => item.type === "compaction")) return { ...state, compacting }
  return Reducer.admit(
    { ...state, compacting, outbox: new Set([...state.outbox, id]) },
    { id, sessionID, time: { created: now }, type: "compaction", delivery: "steer", payload: {} },
  )
}

const settle = (state: ChatState.State, sessionID: string, id: string): ChatState.State =>
  state.compacting[sessionID]?.id === id ? { ...state, compacting: ChatState.drop(state.compacting, sessionID) } : state

export const compacted = (
  state: ChatState.State,
  sessionID: string,
  id: string,
  item: SessionInbox.Compaction,
): ChatState.State => {
  const observed = state.compacting[sessionID]?.observed
  const acknowledged = acknowledge(state, id)
  const retired = item.id === id ? acknowledged : Reducer.removePending(acknowledged, sessionID, id)
  const admitted =
    observed?.has(item.id) || ChatState.messages(retired, sessionID).some((message) => message.id === item.id)
      ? retired
      : Reducer.admit(retired, item)
  return settle(admitted, sessionID, id)
}

export const compactFailed = (state: ChatState.State, sessionID: string, id: string): ChatState.State =>
  settle(state.outbox.has(id) ? Reducer.removePending(acknowledge(state, id), sessionID, id) : state, sessionID, id)
