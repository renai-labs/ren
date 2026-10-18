export * as Fixture from "./fixture.js"

import { Session } from "@ren/schema/session"
import { SessionEvent } from "@ren/schema/session-event"
import { SessionInbox } from "@ren/schema/session-inbox"
import { SessionInfo } from "@ren/schema/session-info"
import { SessionMessage } from "@ren/schema/session-message"
import { DateTime, Schema } from "effect"

export const sessionID = Session.ID.make("ses_refresh")

export const at = (millis: number) => DateTime.makeUnsafe(millis)

export const model = { id: "model", providerID: "provider" }

export const tokens = { input: 10, output: 4, reasoning: 0, cache: { read: 3, write: 0 } }

const decodeEvent = Schema.decodeUnknownSync(SessionEvent.Event)
const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Info)
const decodeInbox = Schema.decodeUnknownSync(SessionInbox.Info)
const decodeInfo = Schema.decodeUnknownSync(SessionInfo.Info)

export const event = (input: {
  readonly id: string
  readonly created: number
  readonly type: SessionEvent.Type
  readonly data: object
}) => decodeEvent(input)

export const ids = (...values: ReadonlyArray<string>) => values.map((value) => SessionMessage.ID.make(value))

export const message = (input: object) => decodeMessage(input)

export const inbox = (input: object) => decodeInbox(input)

export const page = (items: ReadonlyArray<SessionMessage.Info>, next?: string): SessionMessage.Page => ({
  items,
  cursor: next ? { next } : {},
})

export const user = (id: string, created: number, text = id) => message({ id, type: "user", text, time: { created } })

export const session = (id: string, fields: object = {}) =>
  decodeInfo({
    id,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
    capabilities: {
      steer: true,
      queue: true,
      interrupt: true,
      model: true,
      permissions: true,
      forms: true,
      revert: false,
      fork: false,
      compact: false,
      shell: false,
      commands: false,
      rename: false,
      files: false,
    },
    ...fields,
  })
