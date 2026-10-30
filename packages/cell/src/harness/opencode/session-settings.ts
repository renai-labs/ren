export * as SessionSettings from "./session-settings.js"

import type { Session } from "@opencode/client/effect"
import { Model } from "@ren/schema/session"
import { ModelTypes } from "@ren/schema/model-types"
import { Option, Schema } from "effect"

const Saved = Schema.Struct({
  start: Schema.NullOr(Model),
  model: Schema.NullOr(Model),
  defaultModels: Schema.optionalKey(ModelTypes.Defaults),
  interactive: Schema.Boolean,
})

export const savedOf = (session: Session.Info) => Schema.decodeUnknownOption(Saved)(session.metadata?.ren)

export const metadata = (session: Option.Option<Session.Info>, saved: typeof Saved.Type) => ({
  ...Option.getOrUndefined(session)?.metadata,
  ren: Schema.encodeSync(Saved)(saved),
})
