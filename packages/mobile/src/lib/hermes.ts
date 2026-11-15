export * as Hermes from "./hermes.js"

Object.defineProperty(Array.prototype, "toSorted", {
  value: function toSorted<T>(this: ReadonlyArray<T>, compare?: (left: T, right: T) => number) {
    // oxlint-disable-next-line unicorn/no-array-sort -- this is the toSorted polyfill Hermes lacks; it sorts a copy
    return [...this].sort(compare)
  },
  configurable: true,
  writable: true,
})
