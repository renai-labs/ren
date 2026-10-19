export * as Hydrate from "./hydrate.js"

// oxlint-disable typescript/no-misused-spread -- schema types are plain readonly structs; Struct.assign would widen the literal tags these updates keep

import type { Form } from "@ren/schema/form"
import type { Permission } from "@ren/schema/permission"
import type { SessionInbox } from "@ren/schema/session-inbox"
import type { SessionInfo } from "@ren/schema/session-info"
import type { SessionMessage } from "@ren/schema/session-message"
import type { SessionStatus } from "@ren/schema/session-status"
import { ChatState } from "./chat-state.js"
import { Reducer } from "./reducer.js"

export const status = (state: ChatState.State, family: SessionStatus.Family, connection: number): ChatState.State => {
  const overlay = state.activeOverlay
  if (!overlay || state.connection !== connection) return state
  const snapshot = [...overlay].reduce(
    (active, [id, activity]) => {
      if (activity) active.set(id, activity)
      else active.delete(id)
      return active
    },
    new Map<string, ChatState.Activity>(
      Object.entries(family).flatMap(([id, status]) => (status.type === "idle" ? [] : [[id, "running"] as const])),
    ),
  )
  return { ...state, active: Object.fromEntries(snapshot), activeOverlay: undefined }
}

export const statusFailed = (state: ChatState.State, connection: number): ChatState.State =>
  state.activeOverlay && state.connection === connection ? { ...state, activeOverlay: undefined } : state

export const info = (state: ChatState.State, sessions: ReadonlyArray<SessionInfo.Info>): ChatState.State => ({
  ...state,
  info: sessions.reduce((record, session) => ChatState.set(record, session.id, session), state.info),
})

export const rename = (state: ChatState.State, sessionID: string, title: string): ChatState.State => {
  const info = state.info[sessionID]
  if (!info || info.title === title) return state
  return { ...state, info: ChatState.set(state.info, sessionID, { ...info, title }) }
}

export const startPending = (state: ChatState.State, sessionID: string): ChatState.State => ({
  ...state,
  pendingOverlay: ChatState.set(state.pendingOverlay, sessionID, new Map()),
})

export const endPending = (state: ChatState.State, sessionID: string): ChatState.State => ({
  ...state,
  pendingOverlay: ChatState.drop(state.pendingOverlay, sessionID),
})

export const pending = (
  state: ChatState.State,
  sessionID: string,
  snapshot: ReadonlyArray<SessionInbox.Info>,
): ChatState.State => {
  const current = [...(state.pendingOverlay[sessionID] ?? [])].reduce(
    (items, [id, update]) => {
      const existing = items.get(id)
      if (!update) items.delete(id)
      else if (typeof update !== "string") items.set(id, update)
      else if (existing) items.set(id, { ...existing, delivery: update })
      return items
    },
    new Map<string, SessionInbox.Info>(snapshot.map((item) => [item.id, item])),
  )
  const read = [...current.values()]
  const acknowledged = new Set<string>([
    ...read.map((item) => item.id),
    ...(read.some((item) => item.type === "compaction")
      ? ChatState.pending(state, sessionID).flatMap((item) => (item.type === "compaction" ? [item.id] : []))
      : []),
  ])
  const outbox = new Set([...state.outbox].filter((id) => !acknowledged.has(id)))
  const inflight = ChatState.pending(state, sessionID).filter((item) => outbox.has(item.id))
  const merged = [...read, ...inflight]
  return endPending(
    merged.reduce<ChatState.State>((next, item) => Reducer.admit(next, item), {
      ...state,
      outbox,
      pending: ChatState.set(state.pending, sessionID, []),
    }),
    sessionID,
  )
}

export const messages = (state: ChatState.State, sessionID: string, page: SessionMessage.Page): ChatState.State => {
  const fetched = page.items.toReversed()
  const ids = new Set(fetched.map((item) => item.id))
  const admitted = new Set(
    ChatState.pending(state, sessionID).flatMap((item) =>
      item.type === "user" || item.type === "synthetic" ? [item.id] : [],
    ),
  )
  const local = ChatState.messages(state, sessionID).filter(
    (item) => !ids.has(item.id) && (state.outbox.has(item.id) || admitted.has(item.id)),
  )
  return {
    ...state,
    messages: ChatState.set(state.messages, sessionID, [...fetched, ...local]),
    cursor: page.cursor.next
      ? ChatState.set(state.cursor, sessionID, page.cursor.next)
      : ChatState.drop(state.cursor, sessionID),
  }
}

export const older = (
  state: ChatState.State,
  sessionID: string,
  items: ReadonlyArray<SessionMessage.Info>,
  next: string | undefined,
): ChatState.State => {
  const existing = ChatState.messages(state, sessionID)
  const ids = new Set(existing.map((item) => item.id))
  return {
    ...state,
    messages: ChatState.set(state.messages, sessionID, [
      ...items.toReversed().filter((item) => !ids.has(item.id)),
      ...existing,
    ]),
    cursor: next ? ChatState.set(state.cursor, sessionID, next) : ChatState.drop(state.cursor, sessionID),
  }
}

export const message = (state: ChatState.State, sessionID: string, item: SessionMessage.Info): ChatState.State => {
  const list = ChatState.messages(state, sessionID)
  return {
    ...state,
    messages: ChatState.set(
      state.messages,
      sessionID,
      list.some((entry) => entry.id === item.id)
        ? list.map((entry) => (entry.id === item.id ? item : entry))
        : [...list, item],
    ),
  }
}

export const permissions = (
  state: ChatState.State,
  sessionID: string,
  requests: ReadonlyArray<Permission.Request>,
): ChatState.State => ({ ...state, permissions: ChatState.set(state.permissions, sessionID, requests) })

export const forms = (state: ChatState.State, sessionID: string, list: ReadonlyArray<Form.Info>): ChatState.State => ({
  ...state,
  forms: ChatState.set(state.forms, sessionID, list),
})
