import { lazy, Suspense } from "react"
import type { CalendarGridProps } from "../lib/calendar-grid.js"
import { ProgressIndicator } from "./progress-indicator.js"

const CalendarGrid = lazy(() => import("../lib/calendar-grid.js").then((module) => ({ default: module.CalendarGrid })))

export type CalendarProps = CalendarGridProps

export function Calendar(props: CalendarProps) {
  return (
    <Suspense
      fallback={
        <span className="flex h-72 w-full items-center justify-center">
          <ProgressIndicator size="small" />
        </span>
      }
    >
      <CalendarGrid {...props} />
    </Suspense>
  )
}
