export * as ChatState from "./chat-state.js"

import type { Form } from "@ren/schema/form"
import type { Permission } from "@ren/schema/permission"
import type { SessionInbox } from "@ren/schema/session-inbox"
import type { SessionInfo } from "@ren/schema/session-info"
import type { SessionMessage } from "@ren/schema/session-message"
import { DateTime } from "effect"

export type Activity = "idle" | "running"

export type PendingStatus = "starting" | "steering" | "stranded" | "queued"

export type PendingUpdate = SessionInbox.Info | SessionInbox.Delivery | undefined

export interface State {
  readonly info: Readonly<Record<string, SessionInfo.Info>>
  readonly active: Readonly<Record<string, Activity>>
  readonly messages: Readonly<Record<string, ReadonlyArray<SessionMessage.Info>>>
  readonly cursor: Readonly<Record<string, string>>
  readonly pending: Readonly<Record<string, ReadonlyArray<SessionInbox.Info>>>
  readonly permissions: Readonly<Record<string, ReadonlyArray<Permission.Request>>>
  readonly forms: Readonly<Record<string, ReadonlyArray<Form.Info>>>
  readonly outbox: ReadonlySet<string>
  readonly connection: number
  readonly activeOverlay: ReadonlyMap<string, Activity | undefined> | undefined
  readonly pendingOverlay: Readonly<Record<string, ReadonlyMap<string, PendingUpdate>>>
}

export const empty: State = {
  info: {},
  active: {},
  messages: {},
  cursor: {},
  pending: {},
  permissions: {},
  forms: {},
  outbox: new Set(),
  connection: 0,
  activeOverlay: undefined,
  pendingOverlay: {},
}

const none: ReadonlyArray<never> = []

export const set = <V>(record: Readonly<Record<string, V>>, id: string, value: V): Readonly<Record<string, V>> => ({
  ...record,
  [id]: value,
})

export const drop = <V>(record: Readonly<Record<string, V>>, id: string): Readonly<Record<string, V>> =>
  Object.fromEntries(Object.entries(record).filter(([key]) => key !== id))

export const messages = (state: State, sessionID: string): ReadonlyArray<SessionMessage.Info> =>
  state.messages[sessionID] ?? none

export const pending = (state: State, sessionID: string): ReadonlyArray<SessionInbox.Info> =>
  state.pending[sessionID] ?? none

export const activity = (state: State, sessionID: string): Activity => state.active[sessionID] ?? "idle"

export const inputs = (state: State, sessionID: string) =>
  pending(state, sessionID).flatMap((item) => (item.type === "compaction" ? [] : [item.id]))

export const hasInput = (state: State, sessionID: string, inboxID: string) =>
  pending(state, sessionID).some((item) => item.id === inboxID && item.type !== "compaction")

export const pendingStatus = (state: State, sessionID: string, inboxID: string): PendingStatus | undefined => {
  const items = pending(state, sessionID)
  const item = items.find((entry) => entry.id === inboxID && entry.type === "user")
  if (!item) return undefined
  if (item.delivery === "queue") return "queued"
  const list = messages(state, sessionID)
  const boundary = list.findLastIndex((entry) => entry.type === "idle")
  const idle = list[boundary]
  if (activity(state, sessionID) === "idle")
    return idle && DateTime.isLessThanOrEqualTo(item.time.created, idle.time.created) ? "stranded" : "starting"
  return list
    .slice(boundary + 1)
    .some((entry) => entry.type === "user" && !items.some((other) => other.id === entry.id))
    ? "steering"
    : "starting"
}

export const cost = (state: State, sessionID: string) => {
  const session = state.info[sessionID]
  if (!session) return 0
  if (session.parentID) return session.cost
  return Object.values(state.info).reduce((total, info) => total + info.cost, 0)
}

export const running = (state: State) =>
  Object.entries(state.active).flatMap(([id, activity]) => (activity === "running" ? [id] : []))
