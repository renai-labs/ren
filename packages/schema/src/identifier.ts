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

const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const clock = { last: 0, counter: 0 }

export const ascending = (timestamp = Date.now()) => {
  clock.counter = timestamp === clock.last ? clock.counter + 1 : 1
  clock.last = timestamp
  const value = BigInt(timestamp) * 0x1000n + BigInt(clock.counter)
  const time = Array.from({ length: 6 }, (_, index) =>
    Number((value >> BigInt(40 - 8 * index)) & 0xffn)
      .toString(16)
      .padStart(2, "0"),
  ).join("")
  return time + Array.from(crypto.getRandomValues(new Uint8Array(14)), (byte) => chars[byte % 62]).join("")
}

export const makeAscending = <const Brand extends string>(
  prefix: string,
  brand: Parameters<typeof Schema.brand<Brand>>[0],
) => {
  const schema = Schema.String.check(Schema.isStartingWith(`${prefix}_`)).pipe(
    Schema.brand<Brand>(brand),
    Schema.annotate({ identifier: brand }),
  )
  return Object.assign(schema, { create: () => schema.make(`${prefix}_${ascending()}`) })
}
