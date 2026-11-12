export * as TimeZone from "./time-zone.js"

import { Schema } from "effect"
import { Preference } from "./preference.js"

export const chosen = Preference.make("time-zone.v1", Schema.NullOr(Schema.String), null)
