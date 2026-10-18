export * as Outbox from "./outbox.js"

// oxlint-disable typescript/no-misused-spread -- schema types are plain readonly structs; Struct.assign would widen the literal tags these updates keep

import type { Session } from "@ren/schema/session"
import type { SessionInbox } from "@ren/schema/session-inbox"
import type { SessionMessage } from "@ren/schema/session-message"
import type { DateTime } from "effect"
import { ChatState } from "./chat-state.js"
import { Reducer } from "./reducer.js"

export interface Prompt {
  readonly sessionID: Session.ID
  readonly id: SessionMessage.ID
  readonly text: string
  readonly delivery: SessionInbox.Delivery
  readonly sender?: SessionMessage.Sender
}

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
      payload: { text: prompt.text, ...(prompt.sender && { sender: prompt.sender }) },
    },
  )
}

export const rollback = (state: ChatState.State, sessionID: string, id: string): ChatState.State => {
  if (!state.outbox.has(id)) return state
  return Reducer.retract({ ...state, outbox: new Set([...state.outbox].filter((item) => item !== id)) }, sessionID, id)
}

export const acknowledge = (state: ChatState.State, id: string): ChatState.State =>
  state.outbox.has(id) ? { ...state, outbox: new Set([...state.outbox].filter((item) => item !== id)) } : state
