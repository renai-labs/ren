export * as HandAccess from "./access.js"

import type { Hand } from "@ren/schema/hand"
import { Session } from "@ren/schema/session"
import { Context, type Effect, Schema } from "effect"

export class NotFound extends Schema.TaggedError<NotFound>()("HandAccess.NotFound", {
  sessionId: Session.ID,
  message: Schema.String,
}) {}

export class Unavailable extends Schema.TaggedError<Unavailable>()("HandAccess.Unavailable", {
  sessionId: Session.ID,
  message: Schema.String,
}) {}

export interface Interface {
  // oxlint-disable-next-line ren/no-comments -- `unreachable` when the last connection to the session's environment got no answer.
  readonly open: (
    sessionId: Session.ID,
    options: { readonly unreachable: boolean },
  ) => Effect.Effect<Hand.Access, NotFound | Unavailable>
  readonly release: (sessionId: Session.ID) => Effect.Effect<void, Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/brain/HandAccess") {}
