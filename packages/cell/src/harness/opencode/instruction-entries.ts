export * as InstructionEntries from "./instruction-entries.js"

import type { Session } from "@ren/schema/session"

export const changes = (
  current: ReadonlyArray<{ readonly key: string; readonly value: unknown }>,
  wanted: Session.Instructions,
) => {
  const existing = new Map(current.map((item) => [item.key, item.value]))
  return {
    put: Object.entries(wanted)
      .filter(([key, value]) => existing.get(key) !== value)
      .map(([key, value]) => ({ key, value }))
      .toSorted((left, right) => (left.key < right.key ? -1 : 1)),
    remove: current
      .map((item) => item.key)
      .filter((key) => !Object.hasOwn(wanted, key))
      .toSorted(),
  }
}
