export * as ScheduleActions from "./schedule-actions.js"

import type { ScheduleInfo } from "@ren/client"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import { Toast } from "@ren/ui/toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { RouterContext } from "../lib/router-context.js"
import { ScheduleDialog } from "./schedule-dialog.js"

// oxlint-disable-next-line ren/no-comments -- A paused schedule resumes, an active one pauses, an ended one does neither.
const toggleOf = (schedule: ScheduleInfo, actions: { readonly resume: () => void; readonly pause: () => void }) => {
  if (schedule.pausedReason) return { label: "Resume", glyph: "Restore", onSelect: actions.resume } as const
  if (schedule.status === "active") return { label: "Pause", glyph: "Stop", onSelect: actions.pause } as const
  return null
}

// oxlint-disable-next-line ren/no-comments -- schedules S23, S24: run now, pause or resume, edit and archive, for the row menu and the detail.
export function useActions(schedule: ScheduleInfo, options: { readonly onArchived?: () => void } = {}) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: context.api.schedule.list.queryKey() })
    await queryClient.invalidateQueries({ queryKey: context.api.schedule.get.queryKey() })
    await queryClient.invalidateQueries({ queryKey: context.api["schedule-run"].list.queryKey() })
  }
  const failed = (title: string) => (error: Error) =>
    Toast.manager.add({ type: "error", title, description: error.message })
  const run = useMutation({
    ...context.api.schedule.run.mutationOptions(),
    onSuccess: () => {
      Toast.manager.add({ type: "success", title: `${schedule.name} is running` })
      return refresh()
    },
    onError: failed("Couldn’t run the schedule"),
  })
  const pause = useMutation({
    ...context.api.schedule.pause.mutationOptions(),
    onSuccess: refresh,
    onError: failed("Couldn’t pause the schedule"),
  })
  const resume = useMutation({
    ...context.api.schedule.resume.mutationOptions(),
    onSuccess: refresh,
    onError: failed("Couldn’t resume the schedule"),
  })
  const archive = useMutation(context.api.schedule.archive.mutationOptions())
  const id = schedule.id
  const toggle = toggleOf(schedule, {
    resume: () => resume.mutate({ id }),
    pause: () => pause.mutate({ id }),
  })
  return {
    run: () => run.mutate({ id }),
    isRunning: run.isPending,
    toggle,
    edit: () => setEditing(true),
    archive: () => setArchiving(true),
    dialogs: (
      <>
        {editing ? <ScheduleDialog schedule={schedule} onClose={() => setEditing(false)} /> : null}
        <ConfirmationDialog
          open={archiving}
          onOpenChange={setArchiving}
          title={`Archive ${schedule.name}?`}
          description="It stops running. Chats it started stay."
          confirmLabel="Archive"
          tone="danger"
          onConfirm={async () => {
            await archive.mutateAsync({ id })
            await refresh()
          }}
          onConfirmed={() => {
            Toast.manager.add({ type: "success", title: `${schedule.name} archived` })
            options.onArchived?.()
          }}
        />
      </>
    ),
  }
}
