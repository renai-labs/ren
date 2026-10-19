export * as HandAccess from "./hand-access.js"

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
  readonly open: (sessionId: Session.ID) => Effect.Effect<Hand.Access, NotFound | Unavailable>
  readonly release: (sessionId: Session.ID) => Effect.Effect<void, Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/brain/HandAccess") {}
