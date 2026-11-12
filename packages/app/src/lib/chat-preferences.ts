export * as ChatPreferences from "./chat-preferences.js"

import { TimelineDetail } from "@ren/chat"
import { SessionModel } from "@ren/schema/session/model"
import { Schema } from "effect"
import { Preference } from "./preference.js"

export const timelineDetail = Preference.make(
  "chat.timeline-detail.v1",
  TimelineDetail.Detail,
  TimelineDetail.presets[2].value,
)

export const foldTurns = Preference.make("chat.fold-turns.v1", Schema.Boolean, true)

export const followUp = Preference.make("chat.follow-up.v1", Schema.Literals(["steer", "queue"]), "steer")

export const notify = Preference.make("chat.notify.v1", Schema.Boolean, true)

export const model = Preference.make("chat.model.v1", Schema.NullOr(SessionModel.Ref), null)

export const homeSpace = Preference.make("chat.home-space.v1", Schema.NullOr(Schema.String), null)
