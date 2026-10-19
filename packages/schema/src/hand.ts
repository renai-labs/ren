export * as Hand from "./hand.js"

import { Identifier } from "./identifier.js"

export const ID = Identifier.make("hnd", "Hand.ID")
export type ID = typeof ID.Type
