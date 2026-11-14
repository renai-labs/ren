export * as AppPreferences from "./app-preferences.js"

import { Schema } from "effect"
import { Preference } from "./preference.js"

export const ownerSpace = Preference.make("apps.owner-space.v1", Schema.String, "")
