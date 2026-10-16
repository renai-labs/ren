export * as Brain from "./brain.js"

import { Identifier } from "./identifier.js"

export const ID = Identifier.make("brn", "Brain.ID")
export type ID = typeof ID.Type
