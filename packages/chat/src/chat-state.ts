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

export interface Compacting {
  readonly id: string
  readonly observed: ReadonlySet<string>
}

export interface State {
  readonly info: Readonly<Record<string, SessionInfo.Info>>
  readonly active: Readonly<Record<string, Activity>>
  readonly messages: Readonly<Record<string, ReadonlyArray<SessionMessage.Info>>>
  readonly cursor: Readonly<Record<string, string>>
  readonly pending: Readonly<Record<string, ReadonlyArray<SessionInbox.Info>>>
  readonly permissions: Readonly<Record<string, ReadonlyArray<Permission.Request>>>
  readonly forms: Readonly<Record<string, ReadonlyArray<Form.Info>>>
  readonly outbox: ReadonlySet<string>
  readonly compacting: Readonly<Record<string, Compacting>>
  readonly history: ReadonlySet<string>
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
  compacting: {},
  history: new Set(),
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

export const visibleMessages = (
  list: ReadonlyArray<SessionMessage.Info>,
  inbox: ReadonlyArray<SessionInbox.Info>,
  revertMessageID?: string,
): ReadonlyArray<SessionMessage.Info> => {
  const queued = new Set(inbox.flatMap((item) => (item.type === "user" && item.delivery === "queue" ? [item.id] : [])))
  const inputs = new Set(
    inbox.flatMap((item) =>
      (item.type === "user" && item.delivery === "steer") || item.type === "synthetic" ? [item.id] : [],
    ),
  )
  if (queued.size === 0 && inputs.size === 0 && !revertMessageID) return list
  const visible = list.filter((item) => !queued.has(item.id) && (!revertMessageID || item.id < revertMessageID))
  if (inputs.size === 0) return visible
  const sink = (items: ReadonlyArray<SessionMessage.Info>) => [
    ...items.filter((item) => !inputs.has(item.id)),
    ...items.filter((item) => inputs.has(item.id)),
  ]
  const tail = visible.at(-1)
  if (tail?.type !== "idle" || tail.outcome !== "failed") return sink(visible)
  const rest = visible.slice(0, -1)
  const turn = rest.slice(rest.findLastIndex((item) => item.type === "idle") + 1)
  return turn.some((item) => inputs.has(item.id)) && !turn.some((item) => item.type === "assistant")
    ? [...sink(rest), tail]
    : sink(visible)
}

export const revertMessageID = (state: State, sessionID: string) => state.info[sessionID]?.revert?.messageID

export const visible = (state: State, sessionID: string) =>
  visibleMessages(messages(state, sessionID), pending(state, sessionID), revertMessageID(state, sessionID))

export const userMessages = (state: State, sessionID: string) =>
  messages(state, sessionID).filter((item): item is SessionMessage.User => item.type === "user")

export const visibleUserMessages = (state: State, sessionID: string) => {
  const boundary = revertMessageID(state, sessionID)
  const users = userMessages(state, sessionID)
  return boundary ? users.filter((item) => item.id < boundary) : users
}

export const cost = (state: State, sessionID: string) => {
  const session = state.info[sessionID]
  if (!session) return 0
  if (session.parentID) return session.cost
  return Object.values(state.info).reduce((total, info) => total + info.cost, 0)
}

export const running = (state: State) =>
  Object.entries(state.active).flatMap(([id, activity]) => (activity === "running" ? [id] : []))

export const more = (state: State, sessionID: string) => Boolean(state.cursor[sessionID])

export const loadingHistory = (state: State, sessionID: string) => state.history.has(sessionID)

const asking = (record: Readonly<Record<string, ReadonlyArray<unknown>>>) =>
  Object.entries(record).flatMap(([id, items]) => (items.length > 0 ? [id] : []))

export const permissionSessions = (state: State) => asking(state.permissions)

export const formSessions = (state: State) => asking(state.forms)
