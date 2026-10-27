interface LayoutShift extends PerformanceEntry {
  readonly value: number
  readonly hadRecentInput: boolean
  readonly sources?: ReadonlyArray<{ readonly node?: Node | null }>
}

const isLayoutShift = (entry: PerformanceEntry): entry is LayoutShift => entry.entryType === "layout-shift"

const layoutShifts: Array<{ readonly value: number; readonly at: number; readonly path: string }> = []

export function watchLayoutShift() {
  if (!PerformanceObserver.supportedEntryTypes.includes("layout-shift")) return
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries().filter(isLayoutShift)) {
      if (entry.hadRecentInput) continue
      layoutShifts.push({ value: entry.value, at: entry.startTime, path: window.location.pathname })
      // oxlint-disable-next-line no-console -- development only: reports every layout shift so it gets fixed
      console.warn(`Layout shift ${entry.value.toFixed(4)} on ${window.location.pathname}`, entry.sources)
    }
  }).observe({ type: "layout-shift", buffered: true })
  Object.assign(window, { __layoutShifts: layoutShifts })
}
