import type { TaskInfo } from "@ren/client"
import { MarkdownEditor } from "../../components/markdown-editor.js"
import { useTaskUploads } from "../../lib/task-files.js"

export function TaskDescription(props: { task: TaskInfo; onChange: (description: string | null) => void }) {
  const upload = useTaskUploads()
  const description = props.task.description ?? ""
  if (!description && !props.task.canUpdate) return null
  return (
    <MarkdownEditor
      key={description}
      value={description}
      label="Task description"
      placeholder="Add description…"
      editable={props.task.canUpdate}
      media={props.task.canUpdate && upload ? (files) => upload(props.task, files) : undefined}
      onCommit={(next) => props.onChange(next.trim() || null)}
    />
  )
}
