export * as Translate from "./translate.js"

import { Form } from "@ren/schema/form"
import { Permission } from "@ren/schema/permission"
import { SessionEvent } from "@ren/schema/session-event"
import type { SessionCapabilities } from "@ren/schema/session-capabilities"
import { SessionInbox } from "@ren/schema/session-inbox"
import { SessionInfo } from "@ren/schema/session-info"
import { SessionMessage } from "@ren/schema/session-message"
import { Option, Predicate, Schema } from "effect"

const UserID = Schema.Struct({ metadata: Schema.Struct({ userID: Schema.String }) })
const decodeUserID = Schema.decodeUnknownOption(UserID)

const withSender = (value: unknown): unknown => {
  if (!Predicate.isObject(value)) return value
  return Option.match(decodeUserID(value), {
    onNone: () => value,
    onSome: (found) => ({ ...value, sender: { userId: found.metadata.userID } }),
  })
}

const nested = (value: unknown, key: string, update: (inner: unknown) => unknown): unknown =>
  Predicate.hasProperty(value, key) ? { ...value, [key]: update(value[key]) } : value

const decodeEvent = Schema.decodeUnknownOption(SessionEvent.Event)
const decodeMessage = Schema.decodeUnknownOption(SessionMessage.Info)
const decodeInbox = Schema.decodeUnknownOption(SessionInbox.Info)
const decodePermission = Schema.decodeUnknownOption(Permission.Request)
const decodeForm = Schema.decodeUnknownOption(Form.Info)
const decodeSession = Schema.decodeUnknownOption(SessionInfo.Info)

const Typed = Schema.Struct({ type: Schema.String })
const decodeTyped = Schema.decodeUnknownOption(Typed)

export const isAllowed = (raw: unknown) =>
  Option.match(decodeTyped(raw), { onNone: () => false, onSome: (typed) => SessionEvent.types.has(typed.type) })

export const event = (raw: unknown): Option.Option<SessionEvent.Event> => {
  if (!isAllowed(raw)) return Option.none()
  return decodeEvent(nested(raw, "data", (data) => nested(data, "item", (item) => nested(item, "payload", withSender))))
}

export const message = (raw: unknown) => decodeMessage(withSender(raw))

export const inbox = (raw: unknown) => decodeInbox(nested(raw, "payload", withSender))

export const permission = decodePermission

export const form = decodeForm

export const session = (raw: unknown, capabilities: SessionCapabilities.Info) =>
  Predicate.isObject(raw) ? decodeSession({ ...raw, capabilities }) : Option.none()
