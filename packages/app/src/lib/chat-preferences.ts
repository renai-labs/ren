export * as ChatPreferences from "./chat-preferences.js"

import { ComposerHistory } from "@ren/chat"
import { SessionModel } from "@ren/schema/session/model"
import { Schema } from "effect"
import { Preference } from "./preference.js"

export const detail = Preference.make("chat.detail.v1", Schema.Literals(["compact", "detailed"]), "compact")

export const followUp = Preference.make("chat.follow-up.v1", Schema.Literals(["steer", "queue"]), "queue")

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

export const model = Preference.make("chat.model.v1", Schema.NullOr(SessionModel.Ref), null)

export const homeSpace = Preference.make("chat.home-space.v1", Schema.NullOr(Schema.String), null)

export const shellHistory = Preference.make("chat.shell-history.v1", Schema.Array(ComposerHistory.Entry), [])
