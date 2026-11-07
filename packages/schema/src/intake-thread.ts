export * as IntakeThread from "./intake-thread.js"

import { Identifier } from "./identifier.js"

export const ID = Identifier.make("cth", "IntakeThread.ID")
export type ID = typeof ID.Type
