export * as Translate from "./translate.js"

import { Form } from "@ren/schema/form"
import { Permission } from "@ren/schema/permission"
import { SessionEvent } from "@ren/schema/session/event"
import type { SessionCapabilities } from "@ren/schema/session/capabilities"
import { SessionCatalog } from "@ren/schema/session/catalog"
import { SessionInbox } from "@ren/schema/session/inbox"
import { SessionInfo } from "@ren/schema/session/info"
import { SessionMessage } from "@ren/schema/session/message"
import { Shell } from "@ren/schema/shell"
import { Option, Predicate, pipe, Schema } from "effect"

const UserID = Schema.Struct({
  metadata: Schema.Struct({ userID: Schema.String, displayText: Schema.optionalKey(Schema.String) }),
})
const decodeUserID = Schema.decodeUnknownOption(UserID)

const withSender = (value: unknown): unknown => {
  if (!Predicate.isObject(value)) return value
  return Option.match(decodeUserID(value), {
    onNone: () => value,
    onSome: (found) => ({
      ...value,
      ...(Predicate.isString(found.metadata.displayText) && { text: found.metadata.displayText }),
      sender: { userId: found.metadata.userID },
    }),
  })
}

const Kind = Schema.Struct({ metadata: Schema.Struct({ kind: Schema.String }) })
const decodeKind = Schema.decodeUnknownOption(Kind)

const withKind = (value: unknown): unknown => {
  if (!Predicate.isObject(value)) return value
  return Option.match(decodeKind(value), {
    onNone: () => value,
    onSome: (found) => ({ ...value, kind: found.metadata.kind }),
  })
}

const Owner = Schema.Struct({ metadata: Schema.Struct({ sessionID: Schema.String }) })
const decodeOwner = Schema.decodeUnknownOption(Owner)

const withOwner = (value: unknown): unknown => {
  if (!Predicate.isObject(value)) return value
  return Option.match(decodeOwner(value), {
    onNone: () => value,
    onSome: (found) => ({ ...value, sessionID: found.metadata.sessionID }),
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
const decodeShell = Schema.decodeUnknownOption(Shell.Info)

const Typed = Schema.Struct({ type: Schema.String })
const decodeTyped = Schema.decodeUnknownOption(Typed)

export const isAllowed = (raw: unknown) =>
  Option.match(decodeTyped(raw), { onNone: () => false, onSome: (typed) => SessionEvent.types.has(typed.type) })

const decodeConnected = Schema.decodeUnknownOption(
  Schema.Struct({ id: Schema.String, type: Schema.Literal("server.connected") }),
)

export const frame = (
  raw: unknown,
  created: number,
): Option.Option<SessionEvent.Event | typeof SessionEvent.Connected.Type> =>
  Option.match(decodeConnected(raw), {
    onNone: () => event(raw),
    onSome: (connected) => Option.some({ id: connected.id, created, type: connected.type, data: {} }),
  })

export const event = (raw: unknown): Option.Option<SessionEvent.Event> => {
  if (!isAllowed(raw)) return Option.none()
  return decodeEvent(
    nested(raw, "data", (data) =>
      pipe(
        data,
        (value) => nested(value, "item", (item) => nested(item, "payload", withSender)),
        (value) => nested(value, "form", withKind),
        (value) => nested(value, "info", withOwner),
      ),
    ),
  )
}

export const message = (raw: unknown) => decodeMessage(withSender(raw))

export const inbox = (raw: unknown) => decodeInbox(nested(raw, "payload", withSender))

export const permission = decodePermission

export const form = (raw: unknown) => decodeForm(withKind(raw))

export const shell = (raw: unknown) => decodeShell(withOwner(raw))

export const session = (raw: unknown, capabilities: SessionCapabilities.Info) =>
  Predicate.isObject(raw) ? decodeSession({ ...raw, capabilities }) : Option.none()

export const agent = Schema.decodeUnknownOption(SessionCatalog.Agent)

export const skill = Schema.decodeUnknownOption(SessionCatalog.Skill)

export const command = Schema.decodeUnknownOption(SessionCatalog.Command)

export const file = Schema.decodeUnknownOption(SessionCatalog.File)
