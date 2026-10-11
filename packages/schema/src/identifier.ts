export * as Identifier from "./identifier.js"

import { Schema } from "effect"
import { monotonicFactory } from "ulid"

export const ulid = monotonicFactory()

export const make = <const Brand extends string>(prefix: string, brand: Parameters<typeof Schema.brand<Brand>>[0]) => {
  const schema = Schema.String.check(Schema.isPattern(new RegExp(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`, "u"))).pipe(
    Schema.brand<Brand>(brand),
    Schema.annotate({ identifier: brand }),
  )
  return Object.assign(schema, { prefix, create: () => schema.make(`${prefix}_${ulid()}`) })
}
