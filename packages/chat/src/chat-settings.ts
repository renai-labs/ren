export * as ChatSettings from "./chat-settings.js"

import { SessionModel } from "@ren/schema/session/model"
import { Schema } from "effect"
import { TimelineDetail } from "./timeline-detail.js"

export interface Setting<A> {
  readonly key: `${string}.v${number}`
  readonly schema: Schema.Codec<A>
  readonly fallback: A
}

const setting = <A>(key: `${string}.v${number}`, schema: Schema.Codec<A>, fallback: A): Setting<A> => ({
  key,
  schema,
  fallback,
})

export const timelineDetail = setting("chat.timeline-detail.v1", TimelineDetail.Detail, TimelineDetail.compact)

export const foldTurns = setting("chat.fold-turns.v1", Schema.Boolean, true)

export const foldMessages = setting("chat.fold-messages.v1", Schema.Boolean, true)

export const model = setting("chat.model.v1", Schema.NullOr(SessionModel.Ref), null)
