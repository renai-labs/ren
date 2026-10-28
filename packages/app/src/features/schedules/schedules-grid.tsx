import type { ScheduleInfo } from "@ren/client"
import { Alert, AlertAction, AlertDescription } from "@ren/ui/alert"
import { Button, buttonVariants } from "@ren/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Icon } from "@ren/ui/icon"
import { Skeleton } from "@ren/ui/skeleton"
import { Link } from "@tanstack/react-router"
import { ScheduleCard } from "./schedule-card.js"

const reservedRows = 3

const reservedSlot = (position: number) => {
  if (position < reservedRows) return ""
  if (position < reservedRows * 2) return "hidden sm:block"
  return "hidden lg:block"
}

// oxlint-disable-next-line ren/no-comments -- ren-v1's schedules grid with its load, failure and empty states. A short last page keeps empty slots up to three rows at the current column count, and `auto-rows-fr` sizes them as the cards, so the pager doesn't move.
export function SchedulesGrid(props: {
  status: "pending" | "error" | "success"
  schedules: readonly ScheduleInfo[]
  spaceNames: ReadonlyMap<string, string>
  pageCount: number
  filtered: boolean
  spaceCount: number
  onRetry: () => void
  onCreate: () => void
  onClearFilters: () => void
}) {
  if (props.status === "pending")
    return (
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <output className="sr-only">Loading schedules</output>
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} aria-hidden className="h-38 rounded-xl" />
        ))}
      </div>
    )
  const start =
    props.spaceCount > 0
      ? {
          description: "Create one to run a prompt on a recurring cadence.",
          action: (
            <Button variant="outline" size="sm" onClick={props.onCreate}>
              Create schedule
            </Button>
          ),
        }
      : {
          description: "Join a space to create a schedule.",
          action: (
            <Link to="/spaces" className={buttonVariants({ variant: "outline", size: "sm" })}>
              View spaces
            </Link>
          ),
        }
  return (
    <>
      {props.status === "error" ? (
        <Alert variant="destructive">
          <Icon glyph="AlertCircle" />
          <AlertDescription>Couldn’t load every schedule.</AlertDescription>
          <AlertAction>
            <Button variant="outline" size="sm" onClick={props.onRetry}>
              Try again
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
      {props.status === "error" && props.schedules.length === 0 ? null : (
        <section aria-label="Schedules" className="mt-4">
          {props.schedules.length > 0 ? (
            <div className="grid auto-rows-fr grid-cols-1 content-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {props.schedules.map((schedule) => (
                <ScheduleCard
                  key={schedule.id}
                  schedule={schedule}
                  spaceName={props.spaceNames.get(schedule.spaceId) ?? "—"}
                />
              ))}
              {props.pageCount > 1
                ? Array.from({ length: reservedRows * 3 - props.schedules.length }, (_, offset) => {
                    const position = props.schedules.length + offset
                    return <div key={`reserved-${position}`} aria-hidden className={reservedSlot(position)} />
                  })
                : null}
            </div>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Icon glyph="Clock" />
                </EmptyMedia>
                <EmptyTitle>{props.filtered ? "No matching schedules" : "No schedules yet"}</EmptyTitle>
                <EmptyDescription>
                  {props.filtered ? "Try a different search or filter." : start.description}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {props.filtered ? (
                  <Button variant="outline" size="sm" onClick={props.onClearFilters}>
                    Clear filters
                  </Button>
                ) : (
                  start.action
                )}
              </EmptyContent>
            </Empty>
          )}
        </section>
      )}
    </>
  )
}
