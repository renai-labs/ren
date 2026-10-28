export * as LayoutShift from "./layout-shift.js"

interface Entry extends PerformanceEntry {
  readonly value: number
  readonly hadRecentInput: boolean
  readonly sources?: ReadonlyArray<{ readonly node?: Node | null }>
}

const isUnexpected = (entry: PerformanceEntry): entry is Entry =>
  entry.entryType === "layout-shift" && "hadRecentInput" in entry && entry.hadRecentInput === false

export function watch() {
  if (!PerformanceObserver.supportedEntryTypes.includes("layout-shift")) return
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries().filter(isUnexpected))
      // oxlint-disable-next-line no-console -- development only: reports every layout shift so it gets fixed
      console.warn(
        `Layout shift ${entry.value.toFixed(4)} on ${window.location.pathname}`,
        entry.sources?.map((source) => source.node),
      )
  }).observe({ type: "layout-shift", buffered: true })
}
