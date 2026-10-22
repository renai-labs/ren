import type { TaskInfo } from "@ren/client"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"

export function ArchiveTasksDialog(props: {
  tasks: ReadonlyArray<TaskInfo>
  onClose: () => void
  onArchiveMany: (tasks: ReadonlyArray<TaskInfo>) => Promise<unknown>
}) {
  const single = props.tasks.length === 1 ? props.tasks[0] : undefined
  return (
    <ConfirmationDialog
      open={props.tasks.length > 0}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={single ? "Archive task?" : `Archive ${props.tasks.length} tasks?`}
      description={single ? `“${single.title}” will be removed from Tasks.` : "These tasks will be removed from Tasks."}
      confirmLabel="Archive"
      tone="danger"
      onConfirm={() => props.onArchiveMany(props.tasks)}
    />
  )
}
