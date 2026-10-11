export * as Identifier from "./identifier.js"

import { Schema } from "effect"
import { monotonicFactory } from "ulid"

const ulid = monotonicFactory()

export const make = <const Brand extends string>(prefix: string, brand: Parameters<typeof Schema.brand<Brand>>[0]) => {
  const schema = Schema.String.check(Schema.isStartingWith(`${prefix}_`)).pipe(
    Schema.brand<Brand>(brand),
    Schema.annotate({ identifier: brand }),
  )
  return Object.assign(schema, { create: () => schema.make(`${prefix}_${ulid()}`) })
}
