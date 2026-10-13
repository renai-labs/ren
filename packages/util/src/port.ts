export * as Port from "./port.js"

import { Schema } from "effect"

export const FromString = Schema.NumberFromString.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 65535 }),
)
