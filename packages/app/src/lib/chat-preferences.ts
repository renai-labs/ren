export * as ChatPreferences from "./chat-preferences.js"

import { TimelineDetail } from "@ren/chat/timeline-detail"
import { SessionModel } from "@ren/schema/session/model"
import { Schema } from "effect"
import { Preference } from "./preference.js"

const details = ["standard", ...TimelineDetail.presets.map((preset) => preset.id)] as const

export type Detail = (typeof details)[number]

export const detail = Preference.make("chat.detail.v1", Schema.Literals(details), "standard")

export const detailValue = (value: Detail) => TimelineDetail.presets.find((preset) => preset.id === value)?.value

const followUps = ["steer", "queue"] as const

export type FollowUp = (typeof followUps)[number]

export const followUp = Preference.make("chat.follow-up.v1", Schema.Literals(followUps), "steer")

export const notify = Preference.make("chat.notify.v1", Schema.Boolean, true)

export const model = Preference.make("chat.model.v1", Schema.NullOr(SessionModel.Ref), null)
