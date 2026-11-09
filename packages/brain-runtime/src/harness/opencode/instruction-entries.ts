export * as InstructionEntries from "./instruction-entries.js"

export const changes = (
  current: ReadonlyArray<{ readonly key: string; readonly value: unknown }>,
  wanted: Readonly<Record<string, string>>,
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
