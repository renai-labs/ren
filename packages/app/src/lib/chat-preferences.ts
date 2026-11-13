export * as ChatPreferences from "./chat-preferences.js"

import { ComposerHistory, TimelineDetail } from "@ren/chat"
import { SessionModel } from "@ren/schema/session/model"
import { Schema } from "effect"
import { Preference } from "./preference.js"

export const timelineDetail = Preference.make("chat.timeline-detail.v1", TimelineDetail.Detail, TimelineDetail.compact)

export const timelineWidth = Preference.make(
  "chat.timeline-width.v1",
  Schema.Literals(["comfortable", "wide"]),
  "comfortable",
)

export const foldTurns = Preference.make("chat.fold-turns.v1", Schema.Boolean, true)

export const followUp = Preference.make("chat.follow-up.v1", Schema.Literals(["steer", "queue"]), "queue")

export const fileWrap = Preference.make("chat.file-wrap.v1", Schema.Boolean, false)

export const diffStyle = Preference.make("chat.diff-style.v1", Schema.Literals(["unified", "split"]), "unified")

export const backgroundActivity = Preference.make(
  "chat.background-activity.v1",
  Schema.Literals(["off", "left", "center", "right"]),
  "left",
)

export const notifications = Preference.make(
  "chat.notifications.v1",
  Schema.Struct({
    finished: Schema.Boolean,
    permissions: Schema.Boolean,
    questions: Schema.Boolean,
    errors: Schema.Boolean,
    sound: Schema.Boolean,
  }),
  { finished: false, permissions: true, questions: true, errors: false, sound: true },
)

export type NotificationKind = "finished" | "permissions" | "questions" | "errors"
export const foldMessages = Preference.make("chat.fold-messages.v1", Schema.Boolean, true)

export const model = Preference.make("chat.model.v1", Schema.NullOr(SessionModel.Ref), null)

export const homeSpace = Preference.make("chat.home-space.v1", Schema.NullOr(Schema.String), null)

export const shellHistory = Preference.make("chat.shell-history.v1", Schema.Array(ComposerHistory.Entry), [])
