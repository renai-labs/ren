export * as TimeZone from "./time-zone.js"

import { Schema } from "effect"
import type { Platform } from "../platform/platform.js"
import { Preference } from "./preference.js"
import { localTimeZone } from "./schedules.js"

export const chosen = Preference.make("time-zone.v1", Schema.NullOr(Schema.String), null)

export const current = (storage: Platform.Storage) => chosen.read(storage) ?? localTimeZone()
