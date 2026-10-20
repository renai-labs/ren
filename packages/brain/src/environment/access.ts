export * as EnvironmentAccess from "./access.js"

import type { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Context, type Effect, Schema } from "effect"

export class NotFound extends Schema.TaggedError<NotFound>()("EnvironmentAccess.NotFound", {
  sessionId: Session.ID,
  message: Schema.String,
}) {}

export class Unavailable extends Schema.TaggedError<Unavailable>()("EnvironmentAccess.Unavailable", {
  sessionId: Session.ID,
  message: Schema.String,
}) {}

export interface Interface {
  readonly open: (sessionId: Session.ID) => Effect.Effect<Environment.Access, NotFound | Unavailable>
  readonly release: (sessionId: Session.ID) => Effect.Effect<void, Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/brain/EnvironmentAccess") {}
