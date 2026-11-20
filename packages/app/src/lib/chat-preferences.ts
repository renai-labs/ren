export * as ChatPreferences from "./chat-preferences.js"

import { ComposerHistory, TimelineDetail } from "@ren/chat"
import { Schema } from "effect"
import { Preference } from "./preference.js"

export const timelineDetail = Preference.make("chat.timeline-detail.v1", TimelineDetail.Detail, TimelineDetail.compact)

export const timelineWidth = Preference.make(
  "chat.timeline-width.v1",
  Schema.Literals(["comfortable", "wide"]),
  "comfortable",
)

export const steps = Preference.make("chat.steps.v1", Schema.Literals(["panel", "chat", "all"]), "panel")

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

export const homeSpace = Preference.make("chat.home-space.v1", Schema.NullOr(Schema.String), null)

export const shellHistory = Preference.make("chat.shell-history.v1", Schema.Array(ComposerHistory.Entry), [])

export const modelFavorites = Preference.make("chat.model-favorites.v1", Schema.Array(Schema.String), [])

export const modelRecent = Preference.make("chat.model-recent.v1", Schema.Array(Schema.String), [])

export const panelWidth = Preference.make("chat.panel-width.v1", Schema.NullOr(Schema.Number), null)

export const fileTree = Preference.make("chat.file-tree.v1", Schema.Boolean, true)

export const fileTreeWidth = Preference.make("chat.file-tree-width.v1", Schema.Number, 240)
