import type { ScheduleInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Icon } from "@ren/ui/icon"
import { Spinner } from "@ren/ui/spinner"
import { Text } from "@ren/ui/text"
import { toast } from "@ren/ui/toast"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { ScheduleDialog } from "../../components/schedule-dialog.js"
import { RouterContext } from "../../lib/router-context.js"
import { ScheduleCard } from "./schedule-card.js"

const reservedRows = 3

const widestColumnCount = 3

const reservedSlot = (position: number) => {
  if (position < reservedRows) return "invisible"
  if (position < reservedRows * 2) return "hidden invisible sm:block"
  return "hidden invisible lg:block"
}

// oxlint-disable-next-line ren/no-comments -- ren-v1's schedules grid: cards that edit on click, one delete confirmation, and the load, failure and empty states.
export function SchedulesGrid(props: {
  status: "pending" | "error" | "success"
  schedules: readonly ScheduleInfo[]
  spaceNames: ReadonlyMap<string, string>
  pageCount: number
  filtered: boolean
  spaceCount: number
  onRetry: () => void
}) {
  const context = RouterContext.useRouterContext()
  const [editing, setEditing] = useState<ScheduleInfo>()
  const [deleting, setDeleting] = useState<{ schedule: ScheduleInfo; open: boolean }>()
  const archive = useMutation(context.api.schedule.archive.mutationOptions())
  if (props.status === "pending")
    return (
      <div className="flex min-h-10 w-full items-center justify-center py-2">
        <Spinner className="size-5" />
      </div>
    )
  const subject = deleting?.schedule
  return (
    <>
      {props.status === "error" ? (
        <div role="alert" className="flex min-h-10 w-full items-center justify-center gap-2 py-2 text-center">
          <Text purpose="body" tone="danger" alignment="center">
            Couldn’t load every schedule.
          </Text>
          <Button variant="outline" size="sm" onClick={props.onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
      {props.status === "error" && props.schedules.length === 0 ? null : (
        <section aria-label="Schedules" aria-live="polite" className="mt-4">
          {props.schedules.length > 0 ? (
            <Cards
              schedules={props.schedules}
              spaceNames={props.spaceNames}
              pageCount={props.pageCount}
              onEdit={setEditing}
              onDelete={(schedule) => setDeleting({ schedule, open: true })}
            />
          ) : (
            <NoSchedules filtered={props.filtered} spaceCount={props.spaceCount} />
          )}
        </section>
      )}
      {editing ? <ScheduleDialog schedule={editing} onClose={() => setEditing(undefined)} /> : null}
      <ConfirmationDialog
        open={deleting?.open ?? false}
        onOpenChange={(open) => setDeleting((current) => current && { ...current, open })}
        title={`Delete ${subject?.name ?? "schedule"}?`}
        description="It stops running. Chats it started stay."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => subject && archive.mutateAsync({ id: subject.id })}
        onConfirmed={() => toast.add({ type: "success", title: `${subject?.name ?? "Schedule"} deleted` })}
      />
    </>
  )
}

function Cards(props: {
  schedules: readonly ScheduleInfo[]
  spaceNames: ReadonlyMap<string, string>
  pageCount: number
  onEdit: (schedule: ScheduleInfo) => void
  onDelete: (schedule: ScheduleInfo) => void
}) {
  const first = props.schedules[0]
  return (
    <div className="grid grid-cols-1 content-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {props.schedules.map((schedule, index) => (
        <ScheduleCard
          key={schedule.id}
          schedule={schedule}
          spaceName={props.spaceNames.get(schedule.spaceId) ?? "—"}
          index={index}
          onEdit={() => props.onEdit(schedule)}
          onDelete={() => props.onDelete(schedule)}
        />
      ))}
      {first && props.pageCount > 1
        ? Array.from({ length: reservedRows * widestColumnCount - props.schedules.length }, (_, offset) => {
            const position = props.schedules.length + offset
            return (
              <div key={`reserved-${position}`} className={reservedSlot(position)} aria-hidden inert>
                <ScheduleCard
                  schedule={first}
                  spaceName={props.spaceNames.get(first.spaceId) ?? "—"}
                  index={position}
                  onEdit={() => undefined}
                  onDelete={() => undefined}
                />
              </div>
            )
          })
        : null}
    </div>
  )
}

function NoSchedules(props: { filtered: boolean; spaceCount: number }) {
  const unfiltered =
    props.spaceCount > 0 ? "Create one to run a prompt on a recurring cadence." : "Join a space to create a schedule."
  return (
    <Empty className="min-h-40 gap-3 rounded-none px-4 py-12">
      <EmptyHeader className="max-w-dialog gap-3">
        <EmptyMedia className="mb-0">
          <Icon glyph="Clock" size="medium" tone="secondary" />
        </EmptyMedia>
        <div className="flex flex-col items-center gap-1">
          <EmptyTitle className="font-normal tracking-normal text-muted-foreground">
            {props.filtered ? "No matching schedules" : "No schedules yet"}
          </EmptyTitle>
          <EmptyDescription className="text-xs">
            {props.filtered ? "Try a different search or filter." : unfiltered}
          </EmptyDescription>
        </div>
      </EmptyHeader>
    </Empty>
  )
}
